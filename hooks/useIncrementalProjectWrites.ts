import { useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { WorkspaceStoreError, type LocalWorkspaceStore, type ProjectMetadataCommand, type WorkspaceProject } from '../services/localWorkspace/contracts';
import type { EditorDocumentEvent, EditorFoldBasis, EditorPreferenceMetadata, EditorScalarPreferencePatch, EditorSourceBinding } from '../services/document/contracts';
import { materializeLayerMappingsForTransfer } from '../services/document/layerFolds';
import { advanceInstalledProjectAuthorityFromAck, getInstalledProjectAuthorityLineage, getInstalledProjectAuthorityToken } from '../services/localWorkspace/projectAuthority';
import type { BulkDocumentAck, DocumentSaveAck, PreferenceSaveAck } from '../services/localWorkspace/normalized/schema';
import { getCommandQueueReceipt, type FoldBasis, type QueueSubmissionReceipt } from '../services/localWorkspace/incrementalQueue';
import { claimProjectWriteRecovery, createProjectWriteOwner, inspectProjectWriteRecovery, markProjectWriteAttachment, noteProjectWriteSubmission, retainProjectWrites,
  type ProjectWriteCheckpoint, type ProjectWriteCommand, type ProjectWriteRoute, type RetainedProjectWrites,
  type ProjectWriteOwner, type VerifiedProjectWriteRecovery } from '../services/localWorkspace/projectWriteRecovery';
import type { ProjectSaveState } from './useWorkspaceProjectWrites';

export interface IncrementalProjectWritesOptions {
  projectId: string;
  authorityEpoch: number;
  binding: EditorSourceBinding;
  store: Pick<LocalWorkspaceStore, 'commit'>;
  resolveAuthority(): WorkspaceProject | undefined;
  /** Store-owned scheduling control for this private integration, not raw storage. */
  flushPending(): Promise<void>;
}
export interface IncrementalProjectWrites {
  readonly writeOwner: ProjectWriteOwner;
  readonly documentState: Readonly<ProjectSaveState>;
  readonly preferenceState: Readonly<ProjectSaveState>;
  readonly hasUnsavedDocument: boolean;
  readonly hasPendingWrites: boolean;
  updateDocument(projectId: string, event: EditorDocumentEvent, expectedEpoch: number): Promise<boolean>;
  updatePreferences(projectId: string, patch: EditorScalarPreferencePatch, metadata: EditorPreferenceMetadata, expectedEpoch: number): Promise<boolean>;
  updateMetadata(projectId: string, patch: ProjectMetadataCommand['patch'], expectedEpoch: number): Promise<boolean>;
  flushPendingProject(projectId: string): Promise<boolean>;
  capturePersistenceCut(projectId: string, throughEditorGeneration: number): Promise<boolean>;
  retainForRecovery(): RetainedProjectWrites;
  readmit(recovery: VerifiedProjectWriteRecovery): Promise<boolean>;
}

type LaneName = 'document' | 'preferences';
interface Lane { latest: number; covered: number; pending: number; failure?: ProjectSaveState }
type Ack = DocumentSaveAck | PreferenceSaveAck | BulkDocumentAck;
const documentRevisionOf = (ack: DocumentSaveAck | BulkDocumentAck) => ack.type === 'document-replaced' ? ack.authority.documentRevision : ack.revision;
const foldOf = (ack: Ack) => ack.type === 'document-replaced' ? ack.authority.foldStructureGeneration : ack.foldStructureGeneration;
interface Submission { lane: LaneName; generation: number; localGeneration: number; command?: ProjectWriteCommand;
  replacement: boolean; receipt?: QueueSubmissionReceipt; epoch: object; persisted: boolean; promise: Promise<boolean>; resolve(success: boolean): void }
const submissionLanes = (submission: Submission): readonly LaneName[] => submission.replacement ? ['document', 'preferences'] : [submission.lane];
const safe = (value: number) => Number.isSafeInteger(value) && value >= 0;
const conflict = (message: string) => new WorkspaceStoreError(message, 'conflict');
const stateOf = (lane: Lane): ProjectSaveState => lane.failure ?? (lane.pending || lane.latest > lane.covered ? { status: 'saving' } : { status: 'saved' });
// A healthy queue never settles its failure signal. Keep this reaction outside
// readmit's closure so it cannot retain a completed session or its receipts.
const readmissionFailed = () => false;

function createOwner(initial: IncrementalProjectWritesOptions) {
  const { projectId, authorityEpoch, store } = initial;
  const { source, editorGenerationFloor: floor, foldStructureGeneration: initialFold } = initial.binding;
  if (!projectId || !safe(authorityEpoch) || !safe(floor) || !safe(initialFold)) throw new Error('Invalid write-source binding.');
  let options = { resolveAuthority: initial.resolveAuthority, flushPending: initial.flushPending };
  let localGeneration = floor; let writeGeneration = floor;
  let phase: 'active' | 'retained' | 'recovering' = 'active', persistenceEpoch = {};
  const unrepresented = new Set<LaneName>();
  let retaining = false;
  let recoveryRoute: ProjectWriteRoute | undefined, retained: RetainedProjectWrites | undefined, cancelReadmission: (() => void) | undefined;
  const writeOwner = createProjectWriteOwner(source, projectId, { retain: () => actions.retainForRecovery(),
    readmit: recovery => actions.readmit(recovery), cut: generation => actions.capturePersistenceCut(projectId, generation) });
  let incarnation: string | undefined; let revision: number | undefined;
  let structural: { local: number; write: number; type: 'after-structural' | 'after-replacement'; reboundFold?: number } | undefined;
  const lanes: Record<LaneName, Lane> = {
    document: { latest: floor, covered: floor, pending: 0 }, preferences: { latest: floor, covered: floor, pending: 0 },
  };
  const listeners = new Set<() => void>();
  const pending = new Set<Submission>();
  const unresolved = new Set<Submission>();
  let lifetime = {};
  let handedThrough = floor, completedThrough = floor, failedFrom: number | undefined;
  // Only unresolved receipts remain here. Settled successes compact into a watermark;
  // a gap/failure is one conservative boundary, not a lifetime event or payload log.
  const handoffs = new Map<number, Promise<boolean>>();
  function reserveHandoff(generation: number, lane: LaneName): ((success: boolean) => void) | undefined {
    if (!safe(generation) || generation <= handedThrough) return undefined;
    if (generation !== handedThrough + 1) { failedFrom = Math.min(failedFrom ?? generation, handedThrough + 1); unrepresented.add(lane); }
    handedThrough = generation;
    if (failedFrom !== undefined && generation >= failedFrom) return undefined;
    let resolve!: (success: boolean) => void, settled = false;
    handoffs.set(generation, new Promise<boolean>(done => { resolve = done; }));
    return success => {
      if (settled) return; settled = true;
      if (!success) failedFrom = Math.min(failedFrom ?? generation, generation);
      handoffs.delete(generation);
      const firstPending = handoffs.keys().next().value;
      completedThrough = Math.min(handedThrough, firstPending === undefined ? handedThrough : firstPending - 1,
        failedFrom === undefined ? handedThrough : failedFrom - 1);
      resolve(success);
    };
  }
  const groups: Submission[][] = []; let dispatching = false;
  const snapshot = () => {
    const documentState = stateOf(lanes.document); const preferenceState = stateOf(lanes.preferences);
    return { documentState, preferenceState, hasUnsavedDocument: documentState.status !== 'saved',
      hasPendingWrites: lanes.document.pending + lanes.preferences.pending > 0 };
  };
  let currentSnapshot = snapshot();
  const publish = () => { currentSnapshot = snapshot(); for (const listener of listeners) listener(); };
  function fail(lane: LaneName, error: unknown) {
    if (!listeners.size) return;
    const message = error instanceof Error ? error.message : 'Local save failed.';
    lanes[lane].failure ??= error instanceof WorkspaceStoreError && ['conflict', 'authority-lost'].includes(error.code)
      ? { status: 'conflict', message } : { status: 'failed', message };
    publish();
  }
  function refuseIntent(lane: LaneName) {
    unrepresented.add(lane);
    // Latch before notifying: a subscriber may synchronously deliver another
    // refused intent. Repeated refusal must not recursively publish forever.
    if (!lanes[lane].failure) fail(lane, conflict('Project save intent was refused while persistence is paused.'));
    return Promise.resolve(false);
  }
  function authority() {
    if (!listeners.size) return undefined;
    const project = (recoveryRoute?.resolveAuthority ?? options.resolveAuthority)();
    if (!listeners.size || !project || Object.getOwnPropertyDescriptor(project, 'id')?.value !== projectId
      || getInstalledProjectAuthorityToken(project) !== source) return undefined;
    const lineage = getInstalledProjectAuthorityLineage(project);
    if (!lineage || !safe(lineage.revision) || incarnation !== undefined && lineage.incarnation !== incarnation) return undefined;
    return { project, lineage };
  }
  function capture() {
    const found = authority();
    if (!found) throw conflict('Project editing source is no longer current.');
    incarnation ??= found.lineage.incarnation; revision ??= found.lineage.revision;
    if (found.lineage.revision !== revision) throw conflict('Project save lineage changed outside this write owner.');
    return found;
  }
  function stillCurrent(): boolean {
    try { return !!authority(); } catch { return false; }
  }
  const matches = (id: string, epoch: number, eventSource = source) => listeners.size > 0
    && id === projectId && epoch === authorityEpoch && eventSource === source;
  function allocate(editorGeneration?: number) {
    if (writeGeneration === Number.MAX_SAFE_INTEGER) throw new Error('Write generation exhausted.');
    if (editorGeneration !== undefined && (!safe(editorGeneration) || editorGeneration <= localGeneration)) throw conflict('Stale editor generation.');
    const next = Math.max(writeGeneration + 1, editorGeneration ?? 0);
    if (!safe(next)) throw new Error('Write generation exhausted.');
    if (editorGeneration !== undefined) localGeneration = editorGeneration;
    writeGeneration = next; return next;
  }
  function basis(value: EditorFoldBasis): FoldBasis {
    if (value.type === 'generation' && value.generation === initialFold) return { type: 'generation', generation: value.generation };
    if (value.type !== 'generation' && structural?.type === value.type && structural.local === value.editorGeneration) {
      if (structural.reboundFold !== undefined) return { type: 'generation', generation: structural.reboundFold };
      return { type: structural.type, editorGeneration: structural.write };
    }
    throw conflict('Unresolved editor structural or replacement dependency.');
  }
  function accept(lane: LaneName, generation: number, ack: Ack, replacement: boolean, assertRecovery?: () => void) {
    const found = authority();
    if (!found) throw conflict('Project editing source changed during save.');
    if (ack.type !== (replacement ? 'document-replaced' : lane === 'document' ? 'document-saved' : 'preferences-saved')
      || ack.projectId !== projectId || ack.incarnation !== incarnation || typeof ack.commitId !== 'string' || !ack.commitId
      || !safe(ack.editorGeneration) || ack.editorGeneration < generation || ack.editorGeneration > lanes[lane].latest
      || !safe(foldOf(ack))) throw conflict('Save acknowledgement does not match admitted work.');
    if (replacement && (ack.type !== 'document-replaced' || ack.editorGeneration !== generation
      || !safe(ack.authority.preferenceRevision) || ack.authority.preferenceRevision === 0
      || typeof ack.boundaryDigest !== 'string' || !/^[a-f0-9]{64}$/.test(ack.boundaryDigest))) throw conflict('Invalid replacement acknowledgement.');
    if (found.lineage.revision !== revision && !(ack.type !== 'preferences-saved'
      && documentRevisionOf(ack) === revision! + 1 && found.lineage.revision === documentRevisionOf(ack))) throw conflict('Working authority changed during acknowledgement.');
    assertRecovery?.();
    if (ack.type !== 'preferences-saved') {
      const acknowledgedRevision = documentRevisionOf(ack);
      if (!safe(acknowledgedRevision) || acknowledgedRevision === 0 || acknowledgedRevision > revision! + 1) throw conflict('Save acknowledgement skipped an installed revision.');
      if (acknowledgedRevision === revision! + 1) {
        if (found.lineage.revision === revision) advanceInstalledProjectAuthorityFromAck(found.project, found.project, ack);
        if (getInstalledProjectAuthorityLineage(found.project)?.revision !== acknowledgedRevision) throw conflict('Working authority cannot adopt this acknowledgement.');
        revision = acknowledgedRevision;
      } else if (found.lineage.revision !== revision) throw conflict('Working authority changed during acknowledgement.');
    } else if (!safe(ack.preferenceRevision) || ack.preferenceRevision === 0) throw conflict('Invalid preference acknowledgement.');
    lanes[lane].covered = Math.max(lanes[lane].covered, ack.editorGeneration);
    if (replacement) lanes.preferences.covered = Math.max(lanes.preferences.covered, ack.editorGeneration);
  }
  function prepare(lane: LaneName, generation: number, command: ProjectWriteCommand): Submission {
    const replacement = command.type === 'replace-document';
    for (const name of replacement ? ['document', 'preferences'] as const : [lane]) {
      const state = lanes[name]; state.latest = Math.max(state.latest, generation); state.pending++;
    }
    let resolve!: Submission['resolve'];
    const promise = new Promise<boolean>(done => { resolve = done; });
    const submission: Submission = { lane, generation, localGeneration, command, replacement, epoch: persistenceEpoch, persisted: false, promise, resolve };
    pending.add(submission); unresolved.add(submission); return submission;
  }
  function finish(submission: Submission, success: boolean) {
    if (submission.epoch === persistenceEpoch) for (const lane of submissionLanes(submission)) lanes[lane].pending--;
    pending.delete(submission);
    if (success) { submission.persisted = true; unresolved.delete(submission); }
    if (stillCurrent()) publish();
    submission.resolve(success && phase === 'active' && submission.epoch === persistenceEpoch && stillCurrent());
  }
  // Separate promise closure: no editor receipt/before/after graph is retained.
  function submit(submission: Submission) {
    if (phase !== 'active' || !stillCurrent()) { submission.command = undefined; finish(submission, false); return; }
    let operation: Promise<Ack>;
    const command = submission.command!;
    try {
      if (recoveryRoute) operation = recoveryRoute.commit(command);
      else switch (command.type) {
        case 'save-document-changes': operation = store.commit(command); break;
        case 'save-editor-preferences': operation = store.commit(command); break;
        case 'update-project-metadata': operation = store.commit(command); break;
        case 'replace-document': operation = store.commit(command); break;
      }
    } catch (error) { operation = Promise.reject(error); }
    finally {
      submission.receipt = getCommandQueueReceipt(command); noteProjectWriteSubmission(writeOwner, submission.receipt); submission.command = undefined;
    }
    void operation.then(ack => {
      if (phase !== 'active' || submission.epoch !== persistenceEpoch || !stillCurrent()) return false;
      accept(submission.lane, submission.generation, ack, submission.replacement);
      // Later edits keep naming this structural save as their basis, but the queue only
      // retains its acknowledgement until a newer structural ack (any save carrying layer
      // mappings) replaces it. Rebind to the fold it produced, as readmission does.
      if (structural?.write === submission.generation && submission.lane === 'document') structural = { ...structural, reboundFold: foldOf(ack) };
      return true;
    }).catch(error => { if (phase === 'active' && submission.epoch === persistenceEpoch && stillCurrent()) {
      for (const lane of submissionLanes(submission)) fail(lane, error);
    } return false; })
      .then(success => finish(submission, success));
  }
  function dispatch(group: Submission[]) {
    groups.push(group);
    if (dispatching) return;
    dispatching = true;
    try {
      while (groups.length) {
        // Admit both lanes of one editor effect before any notification. Store
        // or subscriber reentry queues another prepared group, never overtakes it.
        for (const submission of groups.shift()!) submit(submission);
        if (stillCurrent()) publish();
      }
    } finally { dispatching = false; }
  }
  const actions: Pick<IncrementalProjectWrites, 'updateDocument' | 'updatePreferences' | 'updateMetadata' | 'flushPendingProject' | 'capturePersistenceCut' | 'retainForRecovery' | 'readmit'> = {
    updateDocument(id, event, epoch) {
      if (!matches(id, epoch, event.source)) return Promise.resolve(false);
      if (safe(event.editorGeneration) && event.editorGeneration <= localGeneration) return Promise.resolve(false);
      if (phase !== 'active' || lanes.document.failure) return refuseIntent('document');
      const handoff = reserveHandoff(event.editorGeneration, 'document');
      try {
        const { project } = capture();
        if (event.kind === 'replace') {
          if (lanes.preferences.failure) throw conflict('Replacement requires both persistence lanes.');
          basis(event.foldBasis);
          const state = Object.getOwnPropertyDescriptor(event, 'state'), preferences = Object.getOwnPropertyDescriptor(event, 'preferences');
          if (!state?.enumerable || !Object.hasOwn(state, 'value') || !preferences?.enumerable || !Object.hasOwn(preferences, 'value')) {
            throw conflict('Replacement payload must be immutable data.');
          }
          const generation = allocate(event.editorGeneration);
          const submission = prepare('document', generation, { type: 'replace-document', authority: project,
            editorGeneration: generation, state: state.value, preferences: preferences.value,
            ...(event.linkedProjectName ? { linkedProjectName: event.linkedProjectName } : {}) });
          structural = { local: event.editorGeneration, write: generation, type: 'after-replacement' };
          void submission.promise.then(success => handoff?.(success)); dispatch([submission]); return submission.promise;
        }
        const mappings = materializeLayerMappingsForTransfer(event.edit, event.correspondence);
        const dependency = basis(event.foldBasis);
        const generation = allocate(event.editorGeneration);
        if (event.overlayEffects.length) structural = { local: event.editorGeneration, write: generation, type: 'after-structural' };
        const command = { type: 'save-document-changes' as const, authority: project, editorGeneration: generation,
          changes: event.edit.changes, ...(mappings.length ? { structural: { basis: dependency, mappings } } : {}),
          ...(event.linkedProjectName ? { linkedProjectName: event.linkedProjectName } : {}) };
        const preferencePatch = event.preferencePatch;
        const needsPreferences = Object.keys(preferencePatch).length > 0;
        const pairedPreferences = needsPreferences && !lanes.preferences.failure && !lanes.document.failure;
        const document = prepare('document', generation, command);
        const group = [document];
        if (pairedPreferences) {
          group.push(prepare('preferences', generation, { type: 'save-editor-preferences', authority: project,
            editorGeneration: generation, patch: preferencePatch }));
        }
        if (needsPreferences && !pairedPreferences) unrepresented.add('preferences');
        void Promise.all(group.map(submission => submission.promise)).then(results => handoff?.(results.every(Boolean) && (!needsPreferences || pairedPreferences)));
        dispatch(group); return document.promise;
      } catch (error) { unrepresented.add('document'); handoff?.(false); fail('document', error); return Promise.resolve(false); }
    },
    updatePreferences(id, patch, metadata, epoch) {
      if (!matches(id, epoch, metadata.source)) return Promise.resolve(false);
      if (safe(metadata.editorGeneration) && metadata.editorGeneration <= localGeneration) return Promise.resolve(false);
      if (phase !== 'active' || lanes.document.failure || lanes.preferences.failure) return refuseIntent('preferences');
      const handoff = reserveHandoff(metadata.editorGeneration, 'preferences');
      try {
        const { project } = capture();
        const folds = metadata.folds ? { basis: basis(metadata.folds.basis), updates: metadata.folds.updates } : undefined;
        const generation = allocate(metadata.editorGeneration);
        const submission = prepare('preferences', generation, { type: 'save-editor-preferences', authority: project,
          editorGeneration: generation, patch, ...(folds ? { folds } : {}) });
        void submission.promise.then(success => handoff?.(success));
        dispatch([submission]); return submission.promise;
      } catch (error) { unrepresented.add('preferences'); handoff?.(false); fail('preferences', error); return Promise.resolve(false); }
    },
    updateMetadata(id, patch, epoch) {
      if (!matches(id, epoch)) return Promise.resolve(false);
      if (phase !== 'active' || lanes.document.failure) return refuseIntent('document');
      try {
        const { project } = capture(); const generation = allocate();
        const submission = prepare('document', generation, { type: 'update-project-metadata', authority: project,
          editorGeneration: generation, patch });
        dispatch([submission]); return submission.promise;
      } catch (error) { unrepresented.add('document'); fail('document', error); return Promise.resolve(false); }
    },
    async flushPendingProject(id) {
      if (phase !== 'active' || id !== projectId || !stillCurrent()) return false;
      const generation = writeGeneration; const captured = [...pending].map(submission => submission.promise);
      try {
        // A reentrant flush must let synchronous admission groups finish first.
        await Promise.resolve(); if (!stillCurrent()) return false;
        await (recoveryRoute?.flushPending ?? options.flushPending)(); await Promise.all(captured);
      }
      catch { return false; }
      return stillCurrent() && generation === writeGeneration && !pending.size
        && stateOf(lanes.document).status === 'saved' && stateOf(lanes.preferences).status === 'saved';
    },
    capturePersistenceCut(id, through) {
      if (phase !== 'active' || id !== projectId || !safe(through) || through < floor || through > handedThrough
        || failedFrom !== undefined && through >= failedFrom || lanes.document.failure || lanes.preferences.failure || !stillCurrent()) return Promise.resolve(false);
      const capturedLifetime = lifetime, obligations = new Set<Promise<boolean>>();
      for (const submission of pending) if (submission.localGeneration <= through) obligations.add(submission.promise);
      if (through > completedThrough) for (const [generation, receipt] of handoffs) if (generation <= through) obligations.add(receipt);
      // Do not flush here: the queue must seal its cut before awaiting these
      // finite promises. Later typing/failure must not redefine this evidence.
      return Promise.all(obligations).then(results => {
        if (!results.every(Boolean)) return false;
        const current = stillCurrent();
        return current && capturedLifetime === lifetime;
      }, () => false);
    },
    retainForRecovery() {
      if (phase === 'retained' && retained) return retained;
      if (retaining) throw conflict('Reentrant write-owner capture.');
      retaining = true;
      try {
      if (phase === 'recovering') { cancelReadmission?.(); persistenceEpoch = {}; lanes.document.pending = 0; lanes.preferences.pending = 0; }
      phase = 'retained';
      if (incarnation === undefined || revision === undefined) { try { capture(); } catch { unrepresented.add('document'); } }
      const capturedEpoch = persistenceEpoch, capturedLifetime = lifetime, records = [...unresolved];
      const quiet = Promise.all([...pending].map(submission => submission.promise)).then(() => {});
      retained = retainProjectWrites(writeOwner, quiet, (): ProjectWriteCheckpoint => Object.freeze({ source, projectId, incarnation, revision,
        localGeneration, writeGeneration, unrepresented: unrepresented.size > 0 || records.some(record => !record.persisted && !record.receipt),
        obligations: Object.freeze(records.filter(record => !record.persisted).map(record => Object.freeze({ receipt: record.receipt, lane: record.lane, generation: record.generation }))) }),
      () => phase === 'retained' && capturedEpoch === persistenceEpoch && capturedLifetime === lifetime && listeners.size > 0);
      for (const lane of ['document', 'preferences'] as const) if (records.some(record => submissionLanes(record).includes(lane))) {
        lanes[lane].failure ??= { status: 'conflict', message: 'Verified readmission is required.' };
      }
      publish(); return retained;
      } finally { retaining = false; }
    },
    readmit(recovery) {
      try {
        const verified = inspectProjectWriteRecovery(writeOwner, recovery), checkpoint = verified.checkpoint;
        if (phase !== 'retained' || pending.size || checkpoint.localGeneration !== localGeneration || checkpoint.writeGeneration !== writeGeneration
          || checkpoint.revision !== revision || checkpoint.incarnation !== incarnation || unrepresented.size) return Promise.resolve(false);
        const capturedLifetime = lifetime, found = verified.route.resolveAuthority();
        const lineage = found && getInstalledProjectAuthorityLineage(found);
        if (!found || !lineage || Object.getOwnPropertyDescriptor(found, 'id')?.value !== projectId
          || getInstalledProjectAuthorityToken(found) !== source || lineage.incarnation !== incarnation
          || capturedLifetime !== lifetime || !listeners.size || revision === undefined) return Promise.resolve(false);
        const acknowledged = verified.queue.receipts.flatMap(row => row.acknowledged && row.acknowledged.type !== 'preferences-saved' ? [row.acknowledged] : [])
          .sort((a, b) => documentRevisionOf(a) - documentRevisionOf(b));
        let base = revision;
        for (const ack of acknowledged) { const next = documentRevisionOf(ack); if (next > base) { if (next !== base + 1) return Promise.resolve(false); base = next; } }
        if (base !== verified.queue.base.documentRevision || lineage.revision !== revision && lineage.revision !== base) return Promise.resolve(false);
        verified.assertCurrent(); claimProjectWriteRecovery(writeOwner, recovery); retained = undefined;
        for (const ack of acknowledged) if (getInstalledProjectAuthorityLineage(found)!.revision < documentRevisionOf(ack)) advanceInstalledProjectAuthorityFromAck(found, found, ack);
        if (getInstalledProjectAuthorityLineage(found)?.revision !== base) return Promise.resolve(false);
        const epoch = {}; persistenceEpoch = epoch; phase = 'recovering'; retained = undefined; recoveryRoute = verified.route; revision = base;
        let liveProject = found;
        const records = [...unresolved];
        lanes.document.pending = records.filter(record => record.lane === 'document').length;
        lanes.preferences.pending = records.filter(record => submissionLanes(record).includes('preferences')).length;
        if (structural && !records.some(record => record.lane === 'document' && record.generation === structural!.write)) {
          structural = { ...structural, reboundFold: verified.queue.base.foldStructureGeneration };
        }
        const assertRecovery = () => {
          if (epoch !== persistenceEpoch || capturedLifetime !== lifetime || !listeners.size) throw conflict('Readmission owner changed.');
          verified.assertCurrent();
        };
        const current = (ack?: Ack) => {
          assertRecovery(); const found = authority(); assertRecovery();
          // A resolver must not refresh the working lineage. Only this exact
          // verified receipt may account for an already-published next revision.
          const valid = !!found && (found.lineage.revision === revision || ack && ack.type !== 'preferences-saved'
            && documentRevisionOf(ack) === revision! + 1 && found.lineage.revision === documentRevisionOf(ack));
          if (valid) liveProject = found!.project; return valid;
        };
        let cancel!: () => void; const cancelled = new Promise<boolean>(resolve => { cancel = () => resolve(false); }); cancelReadmission = cancel;
        const settling = records.map(record => {
          const row = verified.queue.receipts.find(row => row.receipt === record.receipt);
          if (!row) throw conflict('Missing recovery obligation.');
          return row.whenAcknowledged.then(ack => {
            if (!current(ack)) return false;
            accept(record.lane, record.generation, ack, record.replacement, assertRecovery);
            if (!current()) return false;
            record.persisted = true; unresolved.delete(record);
            if (structural?.write === record.generation && record.lane === 'document') structural = { ...structural, reboundFold: foldOf(ack) };
            for (const lane of submissionLanes(record)) {
              lanes[lane].pending--; if (!lanes[lane].pending && !unrepresented.has(lane)) lanes[lane].failure = undefined;
            }
            publish(); return current();
          });
        });
        const pause = () => {
          if (epoch !== persistenceEpoch) return;
          phase = 'retained'; persistenceEpoch = {}; retained = undefined; lanes.document.pending = 0; lanes.preferences.pending = 0;
          for (const lane of ['document', 'preferences'] as const) if (unrepresented.has(lane) || [...unresolved].some(record => submissionLanes(record).includes(lane))) {
            lanes[lane].failure ??= { status: 'conflict', message: 'Recovery settlement failed.' };
          }
        };
        markProjectWriteAttachment(writeOwner, verified, () => {
          if (!current() || unrepresented.size || phase !== 'recovering' && phase !== 'active') throw conflict('Write owner is not attached for recovery.');
        }, () => {
          assertRecovery(); const lineage = getInstalledProjectAuthorityLineage(liveProject);
          if (unrepresented.size || phase !== 'recovering' && phase !== 'active' || getInstalledProjectAuthorityToken(liveProject) !== source
            || Object.getOwnPropertyDescriptor(liveProject, 'id')?.value !== projectId || lineage?.incarnation !== incarnation || lineage.revision !== revision) {
            throw conflict('Write owner attachment changed.');
          }
        });
        publish();
        return Promise.race([Promise.all(settling).then(values => values.every(Boolean)), verified.queue.whenFailed.then(readmissionFailed), cancelled])
          .catch(() => false).then(success => {
            if (epoch !== persistenceEpoch) return false;
            cancelReadmission = undefined;
            try { success = success && current() && !unrepresented.size; } catch { success = false; }
            if (success && !unresolved.size) {
              phase = 'active'; failedFrom = undefined; completedThrough = handedThrough; retained = undefined;
              lanes.document.failure = undefined; lanes.preferences.failure = undefined;
            } else pause();
            if (listeners.size) publish();
            let accepted = false;
            try { accepted = success && current() && phase === 'active' && !unrepresented.size; } catch { /* Retain paused ownership below. */ }
            if (!accepted && epoch === persistenceEpoch && phase === 'active') { pause(); if (listeners.size) publish(); }
            return accepted;
          });
      } catch { return Promise.resolve(false); }
    },
  };
  function check(next: IncrementalProjectWritesOptions) {
    if (next.projectId !== projectId || next.authorityEpoch !== authorityEpoch || next.store !== store
      || next.binding.source !== source || next.binding.editorGenerationFloor !== floor || next.binding.foldStructureGeneration !== initialFold) {
      throw new Error('Write source binding requires a keyed remount.');
    }
  }
  return { actions, writeOwner, check, configure(next: IncrementalProjectWritesOptions) {
    check(next); options = { resolveAuthority: next.resolveAuthority, flushPending: next.flushPending };
  },
    getSnapshot: () => currentSnapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); if (!listeners.size) { lifetime = {}; cancelReadmission?.(); } }; } };
}

/** Private per-source persistence sidecar. Working state/history stay in the editor. */
export function useIncrementalProjectWrites(options: IncrementalProjectWritesOptions): IncrementalProjectWrites {
  const [owner] = useState(() => createOwner(options));
  owner.check(options);
  useLayoutEffect(() => { owner.configure(options); });
  const snapshot = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  return { ...snapshot, ...owner.actions, writeOwner: owner.writeOwner };
}
