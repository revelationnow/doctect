import { createWorkRuntime, effect, primitive, type Ownership, type Work, type WorkRuntime } from '../../shared/cooperativeWork.js';
import { rawValueWeightWork } from '../../shared/jsonWork.js';
import type { EditorPersistenceDrain } from '../document/contracts';
import { WorkspaceStoreError, type WorkspaceLifecycleCommand } from './contracts';
import { readQueueReadmission, readRetainedQueueAuthority, type QueueReadmissionEvidence, type InstalledQueueAuthority, type IncrementalQueue,
  type QueueEvent, type QueueTransport, type RetainedQueueWork, type WorkspaceQueueCut } from './incrementalQueue';
import type { AuthorityStamp, ProjectScope } from './normalized/schema';
import type { WorkspaceBatch, WorkspaceCatalog, WorkspaceCommandResult, WorkspaceInspection } from './normalized/workspaceCommands';
import { applyWorkspaceCatalogDeltaWork, diffWorkspaceCatalogWork, equalWorkspaceCatalogWork, validateWorkspaceCatalogWork } from './workspaceCatalog';
import { counter, describeRequest, frameFields, requireFrame, sameScope, validateWorkspaceLifecycleReply,
  type WorkspaceLifecycleWorkerResponse } from './workspaceWorkerProtocol';
import type { WorkspaceCommandIdentity, WorkspaceStamp } from './normalized/workspaceManifest';
import { assertProjectInstallationRegistry, captureProjectInstallation, isProjectInstallationCurrent,
  type ProjectInstallationLease, type ProjectInstallationRegistry } from './projectInstallationRegistry';
import { assertProjectWriteOwner, attachProjectWriteOwner, captureProjectWriteHandoff, captureRegisteredProjectCut, readRetainedProjectWrites, retainRegisteredProjectWrites,
  type ProjectWriteAttachment, type ProjectWriteCheckpoint, type ProjectWriteOwner, type RetainedProjectWrites, type VerifiedProjectWriteRecovery } from './projectWriteRecovery';
import { claimWorkspaceRecovery, type CapturedWorkspaceRecovery, type WorkspaceRecoveryCapability } from './workspaceRecoveryAdmission';
import type { WorkspaceRecoveryIntent } from './normalized/workspaceRecovery';

type Binding = Extract<WorkspaceLifecycleWorkerResponse, { type: 'workspace-bootstrapped' }>;
export interface WorkspaceCommandAdmissionOptions {
  readonly binding: Binding; readonly queue: IncrementalQueue; readonly transport: QueueTransport; readonly clientId: string;
  readonly installations: ProjectInstallationRegistry;
  uuid(): string; assertCurrent(): void; resolveInstalled(scope: ProjectScope): InstalledQueueAuthority | undefined;
  onCatalog(result: WorkspaceCommandResult): void; readonly recovery?: RetainedWorkspaceWork;
}
declare const retainedWorkspaceBrand: unique symbol;
export interface RetainedWorkspaceWork { readonly [retainedWorkspaceBrand]: true }
export interface WorkspaceCommandAdmission {
  workspace(command: WorkspaceLifecycleCommand): Promise<WorkspaceCommandResult>;
  recoverLegacy(capability: WorkspaceRecoveryCapability): Promise<WorkspaceCommandResult>;
  persistEditor(scope: ProjectScope, source: object, editorGeneration: number | undefined, submit: () => Promise<boolean>): Promise<boolean>;
  catalog(): WorkspaceCatalog; observeProject(event: QueueEvent): void; assertEditable(scope: ProjectScope): void;
  registerEditor(scope: ProjectScope, source: object, drain: EditorPersistenceDrain): () => void;
  registerWrites(scope: ProjectScope, owner: ProjectWriteOwner): () => void;
  blockedAttempt(): { readonly storageGeneration: string; readonly identity: WorkspaceCommandIdentity; readonly expected: WorkspaceStamp } | undefined;
  inspectBlocked(): Promise<WorkspaceInspection>; dispose(): RetainedWorkspaceWork;
  resumeRecovery(prepareWrites: (scope: ProjectScope, writes: RetainedProjectWrites, queue: RetainedQueueWork) => Promise<VerifiedProjectWriteRecovery>): Promise<void>;
}
interface KnownProject { scope: ProjectScope; authority: AuthorityStamp; source?: object }
interface InstallationPin {
  lease: ProjectInstallationLease;
  value: InstalledQueueAuthority; source: object; transport: QueueTransport; binding: InstalledQueueAuthority['binding'];
  scope: ProjectScope; authority: AuthorityStamp; admissionId: number; floor: number;
}
interface Registration { identity: object; scope: ProjectScope; source: object; drain: EditorPersistenceDrain;
  generation: EditorPersistenceDrain['generation']; drainThrough: EditorPersistenceDrain['drainThrough']; isBusy: EditorPersistenceDrain['isBusy']; pin: InstallationPin }
interface CapturedEditor { registration: Registration; generation: number }
interface Entry {
  order: number; deferredBusy?: boolean;
  retireScope?: ProjectScope;
  identity: WorkspaceCommandIdentity; target?: { scope: ProjectScope; installation?: InstalledQueueAuthority; source?: object; pin?: InstallationPin };
  editors: CapturedEditor[]; input: Promise<{ batch: WorkspaceBatch; release(): void }>; work: WorkRuntime;
  inputData?: WorkspaceBatch; releaseCapture?: () => void;
  resolve(value: WorkspaceCommandResult): void; reject(error: unknown): void; sealed: boolean;
  batch?: WorkspaceBatch; before?: WorkspaceCatalog; published: boolean;
  recovery?: CapturedWorkspaceRecovery;
}
interface DeferredProducer { scope: ProjectScope; source: object; generation: number | undefined; order: number;
  submit: () => Promise<boolean>; resolve(value: boolean): void }
interface InvokedProducer { producer: DeferredProducer; completion: Promise<boolean>; represented?: boolean; success?: boolean }
interface WriterRegistration { scope: ProjectScope; source: object; owner: ProjectWriteOwner }
interface RetainedWriter { registration: WriterRegistration; writes: RetainedProjectWrites }
interface RetainedState {
  catalog: WorkspaceCatalog; known: Map<string, KnownProject>; retired: Set<string>; entries: Entry[];
  producers: DeferredProducer[]; blocked?: Entry; queue: RetainedQueueWork; admissionId: number; transport: QueueTransport;
  continuity: EditorContinuity; clientId: string; sequence: number; ids: ReadonlySet<string>; claim?: object;
  editors: readonly Registration[]; writers: readonly RetainedWriter[]; producerFailure: boolean;
  invoked: readonly InvokedProducer[];
}
interface EditorContinuity {
  guard(scope: ProjectScope): void;
  registrations: Map<string, Registration>;
  writers: Map<string, WriterRegistration>;
  publication?: { registrations: Set<Registration>; valid: boolean };
}
// Escaped editor guards retain this logical cell, not an obsolete transport owner.
const logicalGuard = (cell: EditorContinuity) => (scope: ProjectScope) => cell.guard(scope);
function editorCleanup(cell: EditorContinuity, key: string, identity: object) {
  return () => {
    const current = cell.registrations.get(key);
    if (current?.identity === identity) { cell.registrations.delete(key); if (cell.publication?.registrations.has(current)) cell.publication.valid = false; }
  };
}
function writerCleanup(cell: EditorContinuity, key: string, registration: WriterRegistration) {
  return () => { if (cell.writers.get(key) === registration) cell.writers.delete(key); };
}
const retained = new WeakMap<RetainedWorkspaceWork, RetainedState>();
const scopeKey = (scope: ProjectScope) => `${scope.storageGeneration.length}:${scope.storageGeneration}${scope.projectId.length}:${scope.projectId}${scope.incarnation.length}:${scope.incarnation}`;
const errorOf = (message: string, cause?: unknown) => new WorkspaceStoreError(message, 'authority-lost', cause);
function scopeFrame(value: unknown): ProjectScope {
  const s = frameFields(value, ['storageGeneration', 'projectId', 'incarnation']);
  for (const key of ['storageGeneration', 'projectId', 'incarnation']) requireFrame(typeof s[key] === 'string' && (s[key] as string).length > 0);
  return value as ProjectScope;
}
function stampFrame(value: unknown): AuthorityStamp {
  const stamp = frameFields(value, ['documentRevision', 'preferenceRevision', 'foldStructureGeneration']);
  counter(stamp.documentRevision); counter(stamp.preferenceRevision); counter(stamp.foldStructureGeneration); return value as AuthorityStamp;
}
function* freezeMetadata(value: unknown): Work<void> {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) for (const item of value) { yield* effect(1, () => {}); yield* freezeMetadata(item); }
  else for (const key of Object.keys(value)) { yield* effect(1, () => {}); yield* freezeMetadata((value as Record<string, unknown>)[key]); }
  yield* effect(1, () => { Object.freeze(value); });
}
async function detach<T>(value: T, work: WorkRuntime): Promise<{ value: T; release(): void }> {
  let copy!: T, owner: Ownership | undefined;
  try {
    await work.run(primitive('clone', () => { owner = work.own(0, true); copy = structuredClone(value); }));
    owner!.grow((await work.run(rawValueWeightWork(copy))).bytes);
    return { value: copy, release: () => owner!.release() };
  } catch (error) { owner?.release(); throw error; }
}

/** Explicit private ingress. No producer is exposed until cooperative metadata preparation finishes. */
export async function createWorkspaceCommandAdmission(options: WorkspaceCommandAdmissionOptions): Promise<WorkspaceCommandAdmission> {
  let recovery = options.recovery === undefined ? undefined : retained.get(options.recovery);
  const recoveryClaim = {}, recoveryHandle = options.recovery;
  let releaseRecovery: (() => void) | undefined;
  if (recoveryHandle !== undefined) {
    if (!recovery || recovery.claim) throw errorOf('Workspace recovery handle is unavailable.');
    recovery.claim = recoveryClaim;
    try { releaseRecovery = options.queue.holdWorkspaceRecovery(); }
    catch (error) { recovery.claim = undefined; throw error; }
  }
  const initialWork = createWorkRuntime({ assertCurrent: options.assertCurrent });
  let captured: Awaited<ReturnType<typeof detach<Binding>>> | undefined, binding!: Binding;
  let known = new Map<string, KnownProject>();
  try {
    // A user-supplied ownership guard can reenter scheduling. Install the hold
    // before invoking it, not merely before the first asynchronous suspension.
    options.assertCurrent();
    if (recovery) {
      await recovery.queue.whenQuiescent; await Promise.all(recovery.invoked.map(row => row.completion)); initialWork.assertCurrent();
    }
    captured = await detach(options.binding, initialWork); binding = captured.value;
    frameFields(binding, ['type', 'admissionId', 'catalog', 'projectAuthorities']); requireFrame(binding.type === 'workspace-bootstrapped'); counter(binding.admissionId, true);
    await initialWork.run(validateWorkspaceCatalogWork(binding.catalog));
    assertProjectInstallationRegistry(options.installations, binding.catalog.storageGeneration);
    await initialWork.run((function* (): Work<void> {
      for (const scope of binding.catalog.members) yield* effect(1, () => { known.set(scope.projectId, { scope, authority: undefined! }); });
      requireFrame(Array.isArray(binding.projectAuthorities) && binding.projectAuthorities.length === known.size);
      const seen = new Set<string>();
      for (const row of binding.projectAuthorities) yield* effect(1, () => {
        frameFields(row, ['scope', 'authority']); const scope = scopeFrame(row.scope), stamp = stampFrame(row.authority), entry = known.get(scope.projectId);
        requireFrame(entry && sameScope(entry.scope, scope) && !seen.has(scope.projectId)); seen.add(scope.projectId); entry.authority = stamp;
      });
      yield* freezeMetadata(binding);
    })());
  } catch (error) { if (recovery?.claim === recoveryClaim) recovery.claim = undefined; throw error; }
  finally { captured?.release(); initialWork.dispose(); }
  let catalog = recovery?.catalog ?? binding.catalog, state: 'active' | 'paused' | 'resuming' | 'blocked' | 'disposed' = recovery ? 'paused' : 'active';
  let sequence = recovery?.clientId === options.clientId ? recovery.sequence : 0, submitting = false, sealing = false, scheduled = false;
  let submissionOrder = 0;
  const nextOrder = () => { counter(submissionOrder + 1, true); return ++submissionOrder; };
  let producing = 0, releasing = false, blocked: Entry | undefined, retainedHandle: RetainedWorkspaceWork | undefined;
  const continuity: EditorContinuity = recovery?.continuity ?? { guard() { throw errorOf('Workspace editor is not ready.'); }, registrations: new Map(), writers: new Map() };
  const retired = new Set<string>(), registrations = continuity.registrations, entries: Entry[] = [], producers: DeferredProducer[] = [];
  const ids = new Set<string>(recovery?.ids), backlog: Entry[] = [];
  let recoveredResult: WorkspaceCommandResult | undefined, resumePromise: Promise<void> | undefined;
  let stagedCatalog = binding.catalog, producerFailure = recovery?.producerFailure ?? false;
  let recoveryEditors: Array<{ registration: Registration; writer: RetainedWriter; checkpoint: ProjectWriteCheckpoint; generation: number }> = [];
  let recoveryEvidence: QueueReadmissionEvidence[] = [];
  const recoveredAcknowledgements = new Map<string, QueueReadmissionEvidence['acknowledgedAttempts'][number]>();
  let recoveryResultPublished = false;
  const invokedProducers = new Set<InvokedProducer>();
  function assertCurrent(allowBlocked = false) {
    options.assertCurrent(); if (state === 'disposed' || !allowBlocked && state !== 'active') throw errorOf('Workspace owner is not writable.');
  }
  function currentProject(scope: ProjectScope) {
    scopeFrame(scope); const project = known.get(scope.projectId);
    if (!project || !sameScope(project.scope, scope)) throw errorOf('Project incarnation is no longer current.'); return project;
  }
  function installed(scope: ProjectScope, source?: object): InstalledQueueAuthority | undefined {
    const value = options.resolveInstalled(scope); assertCurrent(true);
    if (value && (!sameScope(value.binding.scope, scope) || value.transport !== options.transport || source !== undefined && value.source !== source)) {
      throw errorOf('Project installation changed.');
    }
    return value;
  }
  function pinInstallation(value: InstalledQueueAuthority): InstallationPin {
    frameFields(value, ['source', 'transport', 'binding', 'editorGenerationFloor']);
    frameFields(value.binding, ['type', 'scope', 'authority', 'admissionId']);
    requireFrame(value.binding.type === 'bootstrapped'); counter(value.binding.admissionId, true); counter(value.editorGenerationFloor);
    const scope = scopeFrame(value.binding.scope), authority = stampFrame(value.binding.authority);
    return { lease: captureProjectInstallation(options.installations, value), value, source: value.source, transport: value.transport, binding: value.binding, scope: { ...scope }, authority: { ...authority },
      admissionId: value.binding.admissionId, floor: value.editorGenerationFloor };
  }
  function checkInstallationPin(pin: InstallationPin) {
    if (!isProjectInstallationCurrent(pin.lease)) throw errorOf('Captured installation was replaced or removed.');
    const current = pinInstallation(pin.value);
    if (current.source !== pin.source || current.transport !== pin.transport || current.binding !== pin.binding
      || current.admissionId !== pin.admissionId || current.floor !== pin.floor || !sameScope(current.scope, pin.scope)
      || current.authority.documentRevision !== pin.authority.documentRevision || current.authority.preferenceRevision !== pin.authority.preferenceRevision
      || current.authority.foldStructureGeneration !== pin.authority.foldStructureGeneration) throw errorOf('Captured installation facts changed.');
  }
  function block(error: unknown) {
    if (state === 'disposed') return;
    state = 'blocked';
    options.queue.freeze(error);
    for (const entry of entries) { entry.reject(error); releaseInput(entry); }
    for (const producer of producers) producer.resolve(false);
    for (const row of invokedProducers) row.producer.resolve(false);
    if (recovery) for (const writer of recoveryEditors) {
      try { writer.writer.writes = retainRegisteredProjectWrites(writer.writer.registration.owner); } catch { /* Keep prior custody if the hook detached. */ }
    }
  }
  function releaseInput(entry: Entry) {
    entry.work.dispose();
    if (entry.input) void entry.input.then(input => input.release(), () => entry.releaseCapture?.());
    else entry.releaseCapture?.();
  }
  async function captureInput(source: WorkspaceBatch, entry: Entry) {
    let owner: Ownership | undefined;
    try {
      await entry.work.run(primitive('clone', () => {
        owner = entry.work.own(0, true); entry.releaseCapture = () => owner!.release();
        entry.inputData = structuredClone(source);
      }));
      owner!.grow((await entry.work.run(rawValueWeightWork(entry.inputData))).bytes);
      describeRequest({ type: entry.recovery ? 'workspace-recovery-prepare' : 'workspace-command', admissionId: binding.admissionId, batch: entry.inputData! });
      return { batch: entry.inputData!, release: entry.releaseCapture! };
    } catch (error) { owner?.release(); throw error; }
    finally { entry.work.dispose(); }
  }
  function pinnedRegistration(registration: Registration) {
    frameFields(registration.drain, ['generation', 'drainThrough'], ['isBusy']);
    if (registrations.get(scopeKey(registration.scope)) !== registration || registration.drain.generation !== registration.generation
      || registration.drain.drainThrough !== registration.drainThrough || registration.drain.isBusy !== registration.isBusy) throw errorOf('Editor drain registration changed.');
  }
  function checkEditorPins(entry: Entry) {
    for (const { registration } of entry.editors) { pinnedRegistration(registration); checkInstallationPin(registration.pin); }
    if (entry.target?.pin) checkInstallationPin(entry.target.pin);
  }
  function checkEditors(entry: Entry, allowBlocked = false) {
    for (const { registration } of entry.editors) {
      pinnedRegistration(registration);
      if (installed(registration.scope, registration.source) !== registration.pin.value) {
        throw errorOf('Editor registration changed during workspace cut.');
      }
    }
    const target = entry.target;
    if (target?.installation && installed(target.scope, target.source) !== target.installation) throw errorOf('Captured project installation changed.');
    assertCurrent(allowBlocked); checkEditorPins(entry);
  }
  async function publish(entry: Entry, result: WorkspaceCommandResult, allowBlocked = false, onPublished?: () => void) {
    checkEditors(entry, allowBlocked);
    if (continuity.publication) throw errorOf('Catalog publication is already in progress.');
    const currentPublication = { registrations: new Set(entry.editors.map(editor => editor.registration)), valid: true }; continuity.publication = currentPublication;
    const before = catalog, work = createWorkRuntime({ assertCurrent() {
      assertCurrent(allowBlocked); if (catalog !== before || !currentPublication.valid) throw errorOf('Catalog publication was superseded.');
    } });
    let resultCopy: Awaited<ReturnType<typeof detach<WorkspaceCommandResult>>> | undefined;
    try {
      resultCopy = await detach(result, work); result = resultCopy.value;
      const next = await work.run(applyWorkspaceCatalogDeltaWork(before, result.delta)); await work.run(freezeMetadata(next));
      const materialById = new Map<string, WorkspaceCommandResult['projects'][number]>();
      await work.run((function* (): Work<void> {
        requireFrame(result.projects.length === result.delta.added.length);
        for (const material of result.projects) yield* effect(1, () => {
          frameFields(material, ['scope', 'authority', 'records']); const scope = scopeFrame(material.scope), stamp = stampFrame(material.authority);
          requireFrame(scope.storageGeneration === next.storageGeneration && !materialById.has(scope.projectId)
            && stamp.documentRevision === 0 && stamp.preferenceRevision === 0 && stamp.foldStructureGeneration === 0);
          const descriptor = Object.getOwnPropertyDescriptor(material.records, 'scope');
          requireFrame(descriptor && Object.hasOwn(descriptor, 'value') && sameScope(scopeFrame(descriptor.value), scope));
          materialById.set(scope.projectId, material);
        });
        for (const added of result.delta.added) yield* effect(1, () => {
          const material = materialById.get(added.scope.projectId); requireFrame(material && sameScope(material.scope, added.scope));
        });
      })());
      const nextKnown = new Map<string, KnownProject>();
      await work.run((function* (): Work<void> {
        for (const scope of next.members) yield* effect(1, () => {
          const previous = known.get(scope.projectId), material = materialById.get(scope.projectId);
          if (previous && sameScope(previous.scope, scope)) nextKnown.set(scope.projectId, previous);
          else { requireFrame(material); nextKnown.set(scope.projectId, { scope, authority: Object.freeze({ ...material.authority }) }); }
        });
      })());
      checkEditors(entry, allowBlocked); work.assertCurrent(); checkEditorPins(entry); catalog = next; known = nextKnown;
      if (entry.target && result.outcome === 'closed') retired.delete(scopeKey(entry.target.scope));
      entry.published = true;
      onPublished?.();
      try { options.onCatalog(result); } catch { /* Passive notification cannot undo committed catalog publication. */ }
      return result;
    } finally { resultCopy?.release(); work.dispose(); if (continuity.publication === currentPublication) continuity.publication = undefined; }
  }
  async function runEntry(entry: Entry, cut: WorkspaceQueueCut, handoffs: readonly Promise<boolean>[]) {
    const input = await entry.input;
    if (!(await Promise.all(handoffs)).every(value => value === true)) throw errorOf('Editor persistence handoff failed.');
    checkEditors(entry); const target = entry.target;
    if (target) {
      currentProject(target.scope);
    }
    const stamp = target && (cut.targets.find(row => row.authority === target.installation)?.stamp ?? known.get(target.scope.projectId)!.authority);
    const batch: WorkspaceBatch = Object.freeze({ ...input.batch, expected: Object.freeze({ ...catalog.stamp }), targets: Object.freeze(target
      ? [input.batch.intent.type === 'close-project' ? Object.freeze({ type: 'lineage' as const, scope: target.scope, authority: Object.freeze({ ...stamp! }) })
        : Object.freeze({ type: 'member' as const, scope: target.scope })] : []) });
    entry.before = catalog; blocked = entry;
    let response: Awaited<ReturnType<QueueTransport['request']>>;
    if (entry.recovery) {
      const { recovery } = entry;
      requireFrame(batch.expected.revision === recovery.expected.revision && batch.expected.coreDigest === recovery.expected.coreDigest);
      recovery.assertQuiet();
      const prepare = { type: 'workspace-recovery-prepare' as const, admissionId: binding.admissionId, batch };
      const ready = await options.transport.request(prepare); validateWorkspaceLifecycleReply(ready, prepare);
      if (ready.type !== 'workspace-recovery-prepared') throw errorOf('Recovery preparation was refused.', ready);
      const request = { type: 'workspace-recovery-commit' as const, admissionId: binding.admissionId, preparationId: ready.preparationId,
        attempt: { storageGeneration: batch.storageGeneration, identity: batch.identity, expected: batch.expected,
          recoveryId: recovery.intent.recoveryId, sourceDigest: recovery.intent.sourceDigest } };
      try {
        checkEditors(entry); recovery.assertQuiet();
        // Callback-bearing checks ran before the quiet source fence. Only local, non-observing pins follow.
        if (state !== 'active') throw errorOf('Recovery owner stopped before posting.'); checkEditorPins(entry);
        entry.batch = batch; response = await options.transport.request(request);
        assertCurrent(); validateWorkspaceLifecycleReply(response, request);
      } catch (error) {
        void options.transport.request({ type: 'workspace-recovery-discard', admissionId: binding.admissionId,
          preparationId: ready.preparationId, storageGeneration: batch.storageGeneration }).catch(() => {});
        throw error;
      }
    } else {
      entry.batch = batch;
      const request = { type: 'workspace-command' as const, admissionId: binding.admissionId, batch };
      response = await options.transport.request(request); assertCurrent(); validateWorkspaceLifecycleReply(response, request);
    }
    if (response.type !== 'workspace-command-result') throw errorOf('Workspace command was not acknowledged.', response);
    const result = await publish(entry, response.result); assertCurrent(); blocked = undefined;
    return { type: 'completed' as const, value: result };
  }
  function releaseProducers() {
    if (releasing || state !== 'active') return; releasing = true;
    try {
      while (producers.length && state === 'active') {
        const nextCut = entries.find(entry => !entry.sealed), first = producers[0];
        if (nextCut && !beforeCut(first, nextCut)) break;
        const producer = producers.shift()!;
        try {
          if (installed(producer.scope, producer.source)?.source !== producer.source) throw errorOf('Deferred producer source changed.');
          producing++; let result: Promise<boolean>;
          try { result = producer.submit(); } finally { producing--; }
          void Promise.resolve(result).then(value => producer.resolve(value === true), () => producer.resolve(false));
        } catch { producer.resolve(false); }
      }
    } finally { releasing = false; }
  }
  function beforeCut(producer: Pick<DeferredProducer, 'scope' | 'generation' | 'order'>, entry: Entry) {
    if (producer.generation === undefined) return producer.order < entry.order;
    const editor = entry.editors.find(editor => sameScope(editor.registration.scope, producer.scope));
    return !!editor && producer.generation <= editor.generation;
  }
  function sealPending() {
    if (sealing || producing || state !== 'active') return;
    sealing = true;
    try {
      for (const entry of entries) {
        if (entry.sealed) continue;
        if (entry.editors.some(({ registration }) => registration.isBusy?.call(registration.drain))) {
          if (!scheduled) {
            if (entry.deferredBusy) throw errorOf('Editor did not exit its synchronous action.');
            entry.deferredBusy = true; schedule();
          }
          return;
        }
        checkEditors(entry);
        releaseProducers();
        const handoffs = entry.editors.map(({ registration, generation }) => Promise.resolve(registration.drainThrough.call(registration.drain, generation)).catch(() => false));
        const targets = entry.target?.installation ? [entry.target.installation] : [];
        const retireScopes = entry.retireScope ? [entry.retireScope] : [];
        const operation = options.queue.workspaceBarrier({ targets, retireScopes, run: cut => runEntry(entry, cut, handoffs) });
        entry.sealed = true;
        void operation.then(result => {
          const index = entries.indexOf(entry); if (index >= 0) entries.splice(index, 1); ids.delete(entry.identity.commandId); releaseInput(entry); entry.resolve(result);
        }, error => { block(error); entry.reject(error); });
        releaseProducers();
      }
    } catch (error) { block(error); }
    finally { sealing = false; }
  }
  function schedule() {
    if (scheduled) return; scheduled = true;
    void Promise.resolve().then(() => { scheduled = false; sealPending(); });
  }
  function editorGuard(scope: ProjectScope) { assertCurrent(); currentProject(scope); if (retired.has(scopeKey(scope))) throw errorOf('Project is retiring.'); }
  function checkRecoveryEditors() {
    assertCurrent(true);
    for (const row of recoveryEditors) {
      const { registration, writer } = row, key = scopeKey(registration.scope);
      pinnedRegistration(registration);
      if (continuity.writers.get(key) !== writer.registration || installed(registration.scope, registration.source) !== registration.pin.value) {
        throw errorOf('Recovery attachment changed.');
      }
    }
    // Later resolvers may revoke an earlier logical attachment, not only its
    // installation lease. This pass must invoke no caller-supplied callbacks.
    for (const row of recoveryEditors) {
      pinnedRegistration(row.registration);
      requireFrame(continuity.writers.get(scopeKey(row.registration.scope)) === row.writer.registration);
      checkInstallationPin(row.registration.pin);
    }
    for (const evidence of recoveryEvidence) evidence.assertCurrent();
  }
  function producerCoverage(row: typeof recoveryEditors[number], values: readonly DeferredProducer[]) {
    let generation = row.checkpoint.localGeneration;
    for (const producer of values) if (sameScope(producer.scope, row.registration.scope)) {
      requireFrame(producer.source === row.registration.source);
      if (producer.generation !== undefined) { requireFrame(producer.generation === generation + 1); generation = producer.generation; }
    }
    requireFrame(generation === row.generation);
  }
  async function stageRecovery(previous: RetainedState) {
    const work = createWorkRuntime({ assertCurrent() {
      options.assertCurrent(); if (previous.claim !== recoveryClaim || state !== 'paused') throw errorOf('Recovery ownership changed.');
    } });
    try {
      requireFrame(!previous.producerFailure && previous.invoked.every(row => row.represented));
      let expected = previous.catalog;
      let verifiedResult: WorkspaceCommandResult | undefined;
      const entry = previous.blocked;
      if (entry?.batch) {
        const inspect = async (transport: QueueTransport) => {
          const request = { type: 'inspect-workspace-command' as const, admissionId: previous.admissionId, batch: entry.batch! };
          const response = await transport.request(request); validateWorkspaceLifecycleReply(response, request); work.assertCurrent();
          if (response.type !== 'workspace-inspection') throw errorOf('Workspace inspection failed.'); return response.result;
        };
        let inspected: WorkspaceInspection | undefined;
        try {
          const request = { type: 'workspace-fence' as const, storageGeneration: entry.batch.storageGeneration, admissionId: previous.admissionId };
          const response = await previous.transport.request(request); validateWorkspaceLifecycleReply(response, request); work.assertCurrent();
          if (response.type === 'workspace-fenced') inspected = await inspect(previous.transport);
        } catch { work.assertCurrent(); }
        inspected ??= await inspect(options.transport);
        if (inspected.type === 'committed') {
          const verified = inspected.result; requireFrame(entry.before);
          const delta = await work.run(diffWorkspaceCatalogWork(entry.before, verified.catalog));
          expected = verified.catalog;
          verifiedResult = { type: 'workspace-committed', outcome: verified.outcome, receipt: verified.receipt, delta,
            projects: verified.projects, presets: verified.presets, pendingImports: verified.pendingImports };
          if (!entry.published) recoveredResult = verifiedResult;
        } else if (inspected.type !== 'not-committed' || entry.published) throw errorOf('Workspace outcome is not verified.', inspected);
      }
      requireFrame(await work.run(equalWorkspaceCatalogWork(expected, binding.catalog)));
      stagedCatalog = recoveredResult ? await work.run(applyWorkspaceCatalogDeltaWork(previous.catalog, recoveredResult.delta)) : previous.catalog;
      const evidenceByScope = new Map<string, QueueReadmissionEvidence>();
      const closed = (scope: ProjectScope) => verifiedResult?.outcome === 'closed' && verifiedResult.delta.removed.some(removed => sameScope(removed, scope));
      for (const project of previous.queue.projects) {
        await work.run(effect(1, () => {}));
        const old = readRetainedQueueAuthority(previous.queue, project), current = known.get(old.binding.scope.projectId);
        if (!current || !sameScope(current.scope, old.binding.scope)) {
          requireFrame(closed(old.binding.scope) && !project.pending.length && !project.attempts.length); continue;
        }
        const evidence = readQueueReadmission(await options.queue.prepareProjectReadmission(previous.queue, project, [])); work.assertCurrent();
        requireFrame(evidence.base.documentRevision === current.authority.documentRevision
          && evidence.base.preferenceRevision === current.authority.preferenceRevision
          && evidence.base.foldStructureGeneration === current.authority.foldStructureGeneration);
        evidenceByScope.set(scopeKey(current.scope), evidence); recoveryEvidence.push(evidence);
        for (const row of evidence.acknowledgedAttempts) recoveredAcknowledgements.set(row.ack.commitId, row);
      }
      await work.run((function* (): Work<void> {
        for (const [id, current] of known) yield* effect(1, () => {
          const old = previous.known.get(id);
          if (old && sameScope(old.scope, current.scope)) {
            const evidence = evidenceByScope.get(scopeKey(current.scope));
            if (!evidence) requireFrame(old.authority.documentRevision === current.authority.documentRevision
                && old.authority.preferenceRevision === current.authority.preferenceRevision
                && old.authority.foldStructureGeneration === current.authority.foldStructureGeneration);
            if (old.source !== undefined && evidence) requireFrame(evidence.authority.source === old.source);
            current.source = evidence?.authority.source ?? old.source;
          } else requireFrame(verifiedResult?.projects.some(project => sameScope(project.scope, current.scope)
            && project.authority.documentRevision === current.authority.documentRevision
            && project.authority.preferenceRevision === current.authority.preferenceRevision
            && project.authority.foldStructureGeneration === current.authority.foldStructureGeneration));
        });
      })());
      const writers = new Map<string, { writer: RetainedWriter; checkpoint: ProjectWriteCheckpoint }>();
      for (const writer of previous.writers) {
        const registration = writer.registration, key = scopeKey(registration.scope);
        assertProjectWriteOwner(registration.owner, registration.source, registration.scope.projectId);
        const checkpoint = await readRetainedProjectWrites(registration.owner, writer.writes); work.assertCurrent();
        requireFrame(!checkpoint.unrepresented);
        const current = known.get(registration.scope.projectId);
        if (!current || !sameScope(current.scope, registration.scope)) {
          requireFrame(closed(registration.scope) && !checkpoint.obligations.length
            && !previous.producers.some(producer => sameScope(producer.scope, registration.scope))); continue;
        }
        requireFrame(continuity.writers.get(key) === registration && evidenceByScope.has(key));
        writers.set(key, { writer, checkpoint });
      }
      for (const original of previous.editors) {
        await work.run(effect(1, () => {}));
        const key = scopeKey(original.scope), current = known.get(original.scope.projectId);
        if (!current || !sameScope(current.scope, original.scope)) { requireFrame(closed(original.scope)); continue; }
        const live = registrations.get(key), row = writers.get(key);
        requireFrame(live?.identity === original.identity && row && row.writer.registration.source === original.source);
        frameFields(live.drain, ['generation', 'drainThrough'], ['isBusy']);
        requireFrame(live.generation === live.drain.generation && live.drainThrough === live.drain.drainThrough && live.isBusy === live.drain.isBusy);
        requireFrame(!live.isBusy?.call(live.drain));
        const installation = installed(original.scope, original.source); requireFrame(installation);
        const registration = { ...live, pin: pinInstallation(installation) };
        const generation = registration.generation.call(registration.drain); counter(generation);
        const captured = { registration, ...row, generation }; producerCoverage(captured, previous.producers);
        recoveryEditors.push(captured); writers.delete(key);
      }
      requireFrame(!writers.size && previous.producers.every(producer => recoveryEditors.some(row => sameScope(row.registration.scope, producer.scope))));
      for (const row of recoveryEditors) { checkInstallationPin(row.registration.pin); requireFrame(registrations.get(scopeKey(row.registration.scope))?.identity === row.registration.identity); }
      for (const row of recoveryEditors) registrations.set(scopeKey(row.registration.scope), row.registration);
      checkRecoveryEditors();
      producers.push(...previous.producers);
    } finally { work.dispose(); }
  }
  function enqueueWorkspace(command: WorkspaceLifecycleCommand | { type: 'workspace-lifecycle'; intent: WorkspaceRecoveryIntent }, recovery?: CapturedWorkspaceRecovery) {
      if (submitting) return Promise.reject(errorOf('Reentrant workspace submission is not allowed during input capture.'));
      submitting = true;
      try {
        assertCurrent(); frameFields(command, ['type', 'intent']); requireFrame(command.type === 'workspace-lifecycle');
        const kind = Object.getOwnPropertyDescriptor(command.intent, 'type'); requireFrame(kind && Object.hasOwn(kind, 'value'));
        let target: Entry['target'];
        if (kind.value === 'activate-project' || kind.value === 'close-project') {
          const descriptor = Object.getOwnPropertyDescriptor(command.intent, 'projectId'); requireFrame(descriptor && Object.hasOwn(descriptor, 'value'));
          const project = known.get(descriptor.value); requireFrame(project); const installation = installed(project.scope);
          target = { scope: project.scope, installation, source: installation?.source, pin: installation ? pinInstallation(installation) : undefined };
          if (retired.has(scopeKey(project.scope))) throw errorOf('Project is already retiring.');
        }
        counter(sequence + 1, true); const identity = Object.freeze({ clientId: options.clientId, commandSequence: ++sequence, commandId: options.uuid() });
        requireFrame(!ids.has(identity.commandId));
        const provisional: WorkspaceBatch = { storageGeneration: catalog.storageGeneration, identity, expected: catalog.stamp,
          targets: target ? [kind.value === 'close-project' ? { type: 'lineage', scope: target.scope, authority: known.get(target.scope.projectId)!.authority }
            : { type: 'member', scope: target.scope }] : [], intent: command.intent };
        describeRequest({ type: recovery ? 'workspace-recovery-prepare' : 'workspace-command', admissionId: binding.admissionId, batch: provisional }); assertCurrent();
        if (target && kind.value === 'close-project') retired.add(scopeKey(target.scope));
        const order = nextOrder();
        const editors = [...registrations.values()].filter(registration => {
          const member = known.get(registration.scope.projectId);
          return member && sameScope(member.scope, registration.scope) && (!retired.has(scopeKey(registration.scope))
            || kind.value === 'close-project' && target && sameScope(target.scope, registration.scope));
        }).map(registration => {
          pinnedRegistration(registration); const generation = registration.generation.call(registration.drain); counter(generation); return { registration, generation };
        });
        const work = createWorkRuntime({ assertCurrent() { assertCurrent(); } });
        let resolve!: Entry['resolve'], reject!: Entry['reject']; const promise = new Promise<WorkspaceCommandResult>((yes, no) => { resolve = yes; reject = no; });
        const entry: Entry = { order, identity, target, editors, work, input: undefined!, resolve, reject, sealed: false, published: false, recovery,
          ...(kind.value === 'close-project' ? { retireScope: target!.scope } : {}) };
        entries.push(entry); ids.add(identity.commandId);
        entry.input = captureInput(provisional, entry); void entry.input.catch(() => {});
        submitting = false;
        sealPending(); if (producing) schedule(); return promise;
      } catch (error) { return Promise.reject(error); }
      finally { submitting = false; }
    }
  const api: WorkspaceCommandAdmission = {
    workspace: command => enqueueWorkspace(command),
    recoverLegacy(capability) {
      try { const recovery = claimWorkspaceRecovery(capability, api); return enqueueWorkspace({ type: 'workspace-lifecycle', intent: recovery.intent }, recovery); }
      catch (error) { return Promise.reject(error); }
    },
    persistEditor(scope, source, generation, submit) {
      try {
        const recovering = state === 'paused' || state === 'resuming';
        assertCurrent(recovering); currentProject(scope); requireFrame(typeof submit === 'function');
        if (generation !== undefined) counter(generation);
        if (installed(scope, source)?.source !== source) return Promise.resolve(false);
        if (generation === undefined && retired.has(scopeKey(scope))) return Promise.resolve(false);
        const order = nextOrder(), pending = entries.find(entry => !entry.sealed);
        if (recovering || submitting || releasing || pending && !beforeCut({ scope, generation, order }, pending)) {
          return new Promise<boolean>(resolve => producers.push({ scope, source, generation, order, submit, resolve }));
        }
        producing++; let result: Promise<boolean>;
        try { result = submit(); } finally { producing--; if (entries.some(entry => !entry.sealed)) schedule(); }
        return Promise.resolve(result).then(value => value === true, () => false);
      } catch { return Promise.resolve(false); }
    },
    catalog: () => catalog,
    assertEditable: logicalGuard(continuity),
    registerEditor(scope, source, drain) {
      assertCurrent(); const project = currentProject(scope), installation = installed(scope, source);
      if (!installation || installation.source !== source) throw errorOf('Editor source is not installed.');
      frameFields(drain, ['generation', 'drainThrough'], ['isBusy']);
      requireFrame(typeof drain.generation === 'function' && typeof drain.drainThrough === 'function' && (drain.isBusy === undefined || typeof drain.isBusy === 'function'));
      const key = scopeKey(scope); requireFrame(!registrations.has(key));
      options.queue.trackProject(installation); assertCurrent(); requireFrame(!registrations.has(key));
      const registration = { identity: {}, scope: project.scope, source, drain, generation: drain.generation, drainThrough: drain.drainThrough, isBusy: drain.isBusy,
        pin: pinInstallation(installation) };
      project.source = source; registrations.set(key, registration);
      return editorCleanup(continuity, key, registration.identity);
    },
    registerWrites(scope, owner) {
      assertCurrent(); const project = currentProject(scope), installation = installed(scope); requireFrame(installation);
      assertProjectWriteOwner(owner, installation.source, scope.projectId);
      const key = scopeKey(scope); requireFrame(!continuity.writers.has(key));
      options.queue.trackProject(installation); assertCurrent(); requireFrame(!continuity.writers.has(key));
      const registration = { scope: project.scope, source: installation.source, owner }; continuity.writers.set(key, registration);
      return writerCleanup(continuity, key, registration);
    },
    observeProject(event) {
      if (state !== 'active' && state !== 'resuming' || event.type !== 'acknowledged') return;
      assertCurrent(state === 'resuming'); const scope = event.authority.binding.scope, project = currentProject(scope);
      if (installed(scope, event.authority.source) !== event.authority || project.source !== undefined && project.source !== event.authority.source) throw errorOf('Acknowledgement source changed.');
      const ack = event.ack; requireFrame(ack.projectId === scope.projectId && ack.incarnation === scope.incarnation);
      const recovered = recoveredAcknowledgements.get(ack.commitId);
      if (state === 'resuming' && recovered) {
        const recoveredAck = recovered.ack;
        requireFrame(recovered.clientId === event.attempt.batch.clientId && recovered.commitGeneration === event.attempt.batch.commitGeneration
          && recovered.lane === event.attempt.lane && Object.keys(recoveredAck).every(key => key === 'authority'
            && recoveredAck.type === 'document-replaced' && ack.type === 'document-replaced'
            ? Object.keys(ack.authority).every(field => Reflect.get(recoveredAck.authority, field) === Reflect.get(ack.authority, field))
            : Reflect.get(recoveredAck, key) === Reflect.get(ack, key)));
        recoveredAcknowledgements.delete(ack.commitId); return;
      }
      if (ack.type === 'document-replaced') {
        requireFrame(ack.authority.documentRevision === project.authority.documentRevision + 1
          && ack.authority.preferenceRevision > project.authority.preferenceRevision
          && ack.authority.foldStructureGeneration === project.authority.foldStructureGeneration + 1);
        project.authority = { ...ack.authority };
      } else if (ack.type === 'document-saved') { requireFrame(ack.revision === project.authority.documentRevision + 1); project.authority = { ...project.authority, documentRevision: ack.revision, foldStructureGeneration: ack.foldStructureGeneration }; }
      else { requireFrame(ack.preferenceRevision > project.authority.preferenceRevision); project.authority = { ...project.authority, preferenceRevision: ack.preferenceRevision, foldStructureGeneration: ack.foldStructureGeneration }; }
      project.source = event.authority.source;
    },
    blockedAttempt() { return blocked?.batch ? { storageGeneration: blocked.batch.storageGeneration,
      identity: { ...blocked.batch.identity }, expected: { ...blocked.batch.expected } } : undefined; },
    async inspectBlocked() {
      try {
        assertCurrent(true); const entry = blocked; if (state !== 'blocked' || !entry?.batch) return { type: 'unknown' };
        const fence = { type: 'workspace-fence' as const, storageGeneration: entry.batch.storageGeneration, admissionId: binding.admissionId };
        const fenced = await options.transport.request(fence); validateWorkspaceLifecycleReply(fenced, fence); assertCurrent(true);
        const request = { type: 'inspect-workspace-command' as const, admissionId: binding.admissionId, batch: entry.batch };
        const response = await options.transport.request(request); validateWorkspaceLifecycleReply(response, request); assertCurrent(true);
        if (response.type !== 'workspace-inspection') return { type: 'unknown' };
        if (response.result.type === 'committed' && !entry.published) {
          const work = createWorkRuntime({ assertCurrent() { assertCurrent(true); } });
          try {
            const verified = response.result.result;
            const delta = await work.run(diffWorkspaceCatalogWork(entry.before!, verified.catalog));
            await publish(entry, { type: 'workspace-committed', outcome: verified.outcome, receipt: verified.receipt, delta,
              projects: verified.projects, presets: verified.presets, pendingImports: verified.pendingImports }, true);
          } finally { work.dispose(); }
        }
        return response.result;
      } catch { return { type: 'unknown' }; }
    },
    resumeRecovery(prepareWrites) {
      if (resumePromise) return resumePromise;
      if (!recovery || state !== 'paused' || recovery.claim !== recoveryClaim) return Promise.reject(errorOf('Workspace recovery is not staged.'));
      state = 'resuming';
      const previous = recovery;
      resumePromise = (async () => {
        try {
          checkRecoveryEditors();
          const sessions: Array<{ row: typeof recoveryEditors[number]; proof: VerifiedProjectWriteRecovery }> = [];
          for (const row of recoveryEditors) {
            const proof = await prepareWrites(row.registration.scope, row.writer.writes, previous.queue);
            checkRecoveryEditors(); sessions.push({ row, proof });
          }
          const attached: ProjectWriteAttachment[] = [];
          for (const { row, proof } of sessions) {
            attached.push(attachProjectWriteOwner(row.writer.registration.owner, proof, options.queue)); checkRecoveryEditors();
          }
          for (const value of attached) value.assertCurrent();
          checkRecoveryEditors(); for (const value of attached) value.assertLive();
          requireFrame(previous.claim === recoveryClaim && state === 'resuming');
          releaseRecovery!(); await options.queue.flush(); checkRecoveryEditors();
          requireFrame((await Promise.all(attached.map(value => value.completion))).every(Boolean));
          for (const value of attached) value.assertCurrent();
          // These callbacks never reached a hook before the failure. Invoke once,
          // after replay settlement, and drain reentrant producers in FIFO order.
          for (;;) {
          while (producers.length) {
            const completions: Promise<boolean>[] = [];
            while (producers.length) {
              checkRecoveryEditors(); const producer = producers[0];
              requireFrame(known.has(producer.scope.projectId) && installed(producer.scope, producer.source)?.source === producer.source);
              const writer = continuity.writers.get(scopeKey(producer.scope)); requireFrame(writer && writer.source === producer.source);
              checkRecoveryEditors(); requireFrame(producers[0] === producer && state === 'resuming');
              let settle!: (value: boolean) => void;
              const row: InvokedProducer = { producer, completion: new Promise<boolean>(resolve => { settle = resolve; }) };
              // Validation still owns the queue head. Transfer custody atomically
              // only after all callback-bearing checks, immediately before invocation.
              invokedProducers.add(row); producers.shift();
              const handoff = captureProjectWriteHandoff(writer.owner, () => producer.submit()); row.represented = handoff.represented;
              if (!row.represented) producerFailure = true;
              const finish = (success: boolean) => {
                row.success = success; if (row.represented) invokedProducers.delete(row);
                else producerFailure = true;
                producer.resolve(success); settle(success);
              };
              void handoff.completion.then(value => finish(value === true), () => finish(false)); completions.push(row.completion);
            }
            await options.queue.flush(); checkRecoveryEditors();
            if (!(await Promise.all(completions)).every(Boolean) || producerFailure) throw errorOf('Deferred persistence handoff failed.');
          }
          requireFrame((await Promise.all(recoveryEditors.map(row => captureRegisteredProjectCut(row.writer.registration.owner, row.generation)))).every(Boolean));
          checkRecoveryEditors();
          if (recoveredResult && previous.blocked && !recoveryResultPublished) {
            const entry = { ...previous.blocked, target: undefined, editors: recoveryEditors.map(row => ({ registration: row.registration, generation: row.generation })) };
            await publish(entry, recoveredResult, true, () => { previous.blocked!.published = true; recoveryResultPublished = true; });
          } else if (!recoveredResult) catalog = stagedCatalog;
          for (const value of attached) value.assertCurrent();
          checkRecoveryEditors();
          for (const value of attached) value.assertLive();
          // Publication and even final resolvers may enqueue ordinary work.
          // Keep the gate closed until that work also settles, without publishing twice.
          if (producers.length) continue;
          requireFrame(previous.claim === recoveryClaim && state === 'resuming' && !producerFailure && !invokedProducers.size);
          break;
          }
          for (const entry of previous.entries) if (!entry.published) backlog.push(entry);
          previous.claim = undefined; retained.delete(recoveryHandle!); recovery = undefined; recoveredResult = undefined;
          recoveryEditors = []; recoveryEvidence = [];
          for (const key of recoveredAcknowledgements.keys()) recoveredAcknowledgements.delete(key);
          state = 'active'; continuity.guard = editorGuard;
        } catch (error) { block(error); throw error; }
      })();
      return resumePromise;
    },
    dispose() {
      if (retainedHandle) return retainedHandle;
      state = 'disposed'; const queue = options.queue.freeze(errorOf('Workspace owner disposed.'));
      for (const entry of entries) { entry.reject(errorOf('Workspace owner disposed.')); releaseInput(entry); }
      for (const producer of producers) producer.resolve(false);
      for (const row of invokedProducers) row.producer.resolve(false);
      const writers: RetainedWriter[] = [];
      for (const registration of continuity.writers.values()) {
        try { writers.push({ registration, writes: retainRegisteredProjectWrites(registration.owner) }); }
        catch { producerFailure = true; }
      }
      retainedHandle = Object.freeze({}) as RetainedWorkspaceWork;
      const unresolved = recovery?.blocked && !recoveryResultPublished ? recovery.blocked : blocked;
      retained.set(retainedHandle, { catalog, known, retired, entries: [...(recovery?.entries ?? []), ...backlog, ...entries], producers, blocked: unresolved, queue,
        admissionId: unresolved && recovery ? recovery.admissionId : binding.admissionId, transport: unresolved && recovery ? recovery.transport : options.transport,
        continuity, clientId: options.clientId, sequence, ids, editors: [...registrations.values()], writers, producerFailure, invoked: [...invokedProducers] });
      // The new authentic handle now owns every outstanding obligation. Keeping
      // its consumed predecessor registered would root obsolete queue payloads.
      if (recovery) {
        if (recovery.claim === recoveryClaim) recovery.claim = undefined;
        retained.delete(recoveryHandle!); recovery = undefined;
      }
      return retainedHandle;
    },
  };
  if (recovery) {
    try { await stageRecovery(recovery); }
    catch (error) { if (recovery.claim === recoveryClaim) recovery.claim = undefined; throw error; }
  } else continuity.guard = editorGuard;
  return api;
}
