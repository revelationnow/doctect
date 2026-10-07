import React, { StrictMode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceCommandDispatcher } from '../../services/localWorkspace/commandDispatcher';
import { WorkspaceStoreError, type IncrementalWorkspaceCommand, type PreferenceWorkspaceCommand, type ProjectMetadataCommand } from '../../services/localWorkspace/contracts';
import type { DocumentSaveAck, PreferenceSaveAck } from '../../services/localWorkspace/normalized/schema';
import type { EditorDocumentEvent } from '../../services/document/contracts';
import { registerInstalledProjectAuthority, getInstalledProjectAuthorityLineage } from '../../services/localWorkspace/projectAuthority';
import { applyDocumentChanges } from '../../services/document/applyChanges';
import { partitionState } from '../../services/document/partition';
import { createLayerFoldState, reconcileLayerFolds } from '../../services/document/layerFolds';
import { makeIncrementalProject } from '../helpers/incrementalFixtures';
import { deferred } from '../helpers/fakeLocalWorkspaceStore';
import { createIncrementalWorkerHarness } from '../helpers/incrementalWorkerHarness';
import { createIncrementalCommandAdmission } from '../../services/localWorkspace/incrementalCommandAdmission';
import { createProjectInstallationRegistry } from '../../services/localWorkspace/projectInstallationRegistry';
import { getCommandQueueReceipt, type InstalledQueueAuthority, type RetainedQueueWork } from '../../services/localWorkspace/incrementalQueue';
import * as writeRecovery from '../../services/localWorkspace/projectWriteRecovery';

// Delegate to real React while allowing synchronous subscriber reentry probes.
const notification = vi.hoisted(() => ({ current: undefined as (() => void) | undefined }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, useSyncExternalStore<T>(subscribe: (listener: () => void) => () => void, getSnapshot: () => T, getServerSnapshot?: () => T) {
    return actual.useSyncExternalStore(actual.useCallback((listener: () => void) => subscribe(() => {
      notification.current?.(); listener();
    }), [subscribe]), getSnapshot, getServerSnapshot);
  } };
});

const modules = import.meta.glob<typeof import('../../hooks/useIncrementalProjectWrites')>('../../hooks/useIncrementalProjectWrites.ts');
afterEach(() => { notification.current = undefined; cleanup(); vi.restoreAllMocks(); });

async function harness(strict = false, floor = 0) {
  expect(Object.keys(modules), 'private save-hook implementation').toHaveLength(1);
  const { useIncrementalProjectWrites } = await Object.values(modules)[0]();
  const project = makeIncrementalProject(2);
  const source = registerInstalledProjectAuthority(project, { incarnation: 'i', revision: 0 });
  const binding = { source, editorGenerationFloor: floor, foldStructureGeneration: 0 };
  let available = true;
  let folds = createLayerFoldState(partitionState(project.initialState));
  const documents: Array<{ command: IncrementalWorkspaceCommand | ProjectMetadataCommand; control: ReturnType<typeof deferred<DocumentSaveAck>> }> = [];
  const preferences: Array<{ command: PreferenceWorkspaceCommand; control: ReturnType<typeof deferred<PreferenceSaveAck>> }> = [];
  const document = (command: IncrementalWorkspaceCommand | ProjectMetadataCommand) => {
    const control = deferred<DocumentSaveAck>(); documents.push({ command, control }); return control.promise;
  };
  const commit = createWorkspaceCommandDispatcher({ snapshot: async () => { throw new Error('Unexpected snapshot writer'); },
    document, metadata: document, preferences: command => {
      const control = deferred<PreferenceSaveAck>(); preferences.push({ command, control }); return control.promise;
    } });
  const store = { commit: vi.fn(commit) as typeof commit };
  const flushPending = vi.fn(async () => {});
  const options = { projectId: project.id, authorityEpoch: 7, binding, store,
    resolveAuthority: () => available ? project : undefined, flushPending };
  const hook = renderHook(() => useIncrementalProjectWrites(options), strict ? { wrapper: StrictMode } : undefined);
  const selection = { activeVariantId: 'default', selectedNodeId: 'root', selectedNodeIds: ['root'],
    selectedTemplateId: 'page-0', selectedTemplateIds: ['page-0'], selectedElementIds: [], activeLayerId: 'content' };
  function event(generation: number, structural = false): EditorDocumentEvent {
    const before = folds.parts.document;
    const template = before.variants.default.templates['page-0'];
    const edit = applyDocumentChanges(before, structural ? [{ type: 'put-template', variantId: 'default', template: { ...template, layers: [...template.layers!] } }]
      : [{ type: 'put-node', node: { ...before.nodes.root, data: { label: `edit-${generation}` } } }]);
    const receipt = reconcileLayerFolds(folds, edit, { before, after: edit.after, mappings: structural
      ? [{ type: 'continue', from: { variantId: 'default', templateId: 'page-0', position: 0 }, to: { variantId: 'default', templateId: 'page-0', position: 0 } }] : [] });
    folds = receipt.after;
    return { source, editorGeneration: generation, origin: 'edit', kind: 'incremental', edit,
      correspondence: receipt.correspondence, overlayEffects: receipt.overlayEffects,
      foldBasis: { type: 'generation', generation: 0 }, selection: { before: selection, after: selection }, preferencePatch: {} };
  }
  function send(event: EditorDocumentEvent, epoch = 7) {
    let result!: Promise<boolean>;
    act(() => { result = hook.result.current.updateDocument(project.id, event, epoch); }); return result;
  }
  function metadata(name: string) {
    let result!: Promise<boolean>;
    act(() => { result = hook.result.current.updateMetadata(project.id, { name }, 7); }); return result;
  }
  function preference(generation: number) {
    let result!: Promise<boolean>;
    act(() => { result = hook.result.current.updatePreferences(project.id, { scale: 2 }, { source, editorGeneration: generation }, 7); }); return result;
  }
  async function resolveDocument(index: number, revision: number, extra: Partial<DocumentSaveAck> = {}) {
    await act(async () => { documents[index].control.resolve({ type: 'document-saved', projectId: project.id, incarnation: 'i',
      commitId: `document-${revision}`, editorGeneration: documents[index].command.editorGeneration, foldStructureGeneration: 0, revision, ...extra }); });
  }
  return { ...hook, project, source, binding, options, store, documents, preferences, flushPending, event, send, metadata, preference, resolveDocument,
    invalidate() { available = false; } };
}

async function readmissionHarness() {
  const h = await harness(), worker = await createIncrementalWorkerHarness(makeIncrementalProject(2));
  registerInstalledProjectAuthority(h.project, { incarnation: worker.scope.incarnation, revision: 0 }, h.source);
  const initial = worker.responses[0].response;
  if (initial.type !== 'bootstrapped') throw Error('Real bootstrap required');
  const installations = createProjectInstallationRegistry(worker.scope.storageGeneration);
  let installation: InstalledQueueAuthority = { source: h.source, transport: worker.client, binding: initial, editorGenerationFloor: 0 };
  installations.set(h.project.id, installation); let sequence = 0;
  const options = { transport: worker.client,
    clock: { now: () => Date.now(), setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay), clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    uuid: () => `readmission-${++sequence}`, resolveAuthority: (id: string) => installations.get(id) };
  let old: ReturnType<typeof createIncrementalCommandAdmission> | undefined = createIncrementalCommandAdmission(options);
  h.store.commit = createWorkspaceCommandDispatcher({ document: old.document, preferences: old.preferences, metadata: old.metadata,
    snapshot: async () => { throw Error('No snapshot writer'); } });
  h.options.flushPending.mockImplementation(() => old!.flush()); h.rerender();
  const next: ReturnType<typeof createIncrementalCommandAdmission>[] = [];
  async function recovery(work: RetainedQueueWork) {
    await work.whenQuiescent;
    const projects = await Promise.all(work.projects.map(async previous => ({ previous, resolutions: await Promise.all(previous.attempts.map(async original => {
      if (original.attempt.lane === 'replacement') throw Error('This fixture only admits ordinary saves');
      const response = await worker.client.request({ type: 'inspect-commit', attempt: original.attempt });
      if (response.type !== 'commit-inspection') throw Error('Independent inspection required');
      return { attempt: original.attempt, inspection: response };
    })) })));
    const reply = await worker.client.request({ type: 'bootstrap', project: await worker.readRecords() });
    if (reply.type !== 'bootstrapped') throw Error('Fresh bootstrap failed');
    installation = { ...installation, binding: reply }; installations.set(h.project.id, installation);
    const admission = createIncrementalCommandAdmission({ ...options,
      recovery: { retained: work, projects: projects.map(project => ({ ...project, authority: installation })) } });
    const release = admission.queue.holdWorkspaceRecovery(); next.push(admission);
    return { admission, release };
  }
  return { ...h, worker, get old() { if (!old) throw Error('Original admission released'); return old; }, installations, recovery,
    dropOriginal() {
      old?.dispose(); old = undefined;
      const current = next.at(-1)!;
      h.store.commit = createWorkspaceCommandDispatcher({ document: current.document, preferences: current.preferences, metadata: current.metadata,
        snapshot: async () => { throw Error('No snapshot writer'); } });
    },
    dispose() { h.unmount(); old?.dispose(); for (const admission of next) admission.dispose(); worker.client.dispose(); } };
}

describe('verified write-owner readmission', () => {
  it('distinguishes real synchronous queue handoff from a callback-shaped saved result', async () => {
    const h = await readmissionHarness();
    try {
      expect(typeof writeRecovery.captureProjectWriteHandoff).toBe('function');
      const empty = writeRecovery.captureProjectWriteHandoff(h.result.current.writeOwner, async () => true);
      expect(empty.represented).toBe(false); expect(await empty.completion).toBe(true);
      let actual!: ReturnType<typeof writeRecovery.captureProjectWriteHandoff>;
      act(() => { actual = writeRecovery.captureProjectWriteHandoff(h.result.current.writeOwner, () => h.metadata('Real handoff')); });
      expect(actual.represented).toBe(true);
      await act(async () => { h.old.queue.freeze('Lost receipt'); expect(await actual.completion).toBe(false); });
    } finally { h.dispose(); }
  });

  it('provides authenticated synchronous attachment bound to the exact hook and recovery queue', async () => {
    const h = await readmissionHarness();
    try {
      const owner = h.result.current.writeOwner; expect(owner).toBeDefined();
      expect(() => writeRecovery.assertProjectWriteOwner(owner, h.source, h.project.id)).not.toThrow();
      expect(() => writeRecovery.assertProjectWriteOwner({} as any, h.source, h.project.id)).toThrow();
      expect(() => writeRecovery.assertProjectWriteOwner(owner, {}, h.project.id)).toThrow();
      const saving = h.send(h.event(1)); let checkpoint!: RetainedQueueWork, retained!: writeRecovery.RetainedProjectWrites;
      await act(async () => { checkpoint = h.old.queue.freeze('restart'); retained = writeRecovery.retainRegisteredProjectWrites(owner); await saving; });
      expect((await writeRecovery.readRetainedProjectWrites(owner, retained)).localGeneration).toBe(1);
      const next = await h.recovery(checkpoint), proof = await next.admission.prepareWriteRecovery(retained, checkpoint, h.installations, () => h.project);
      expect(() => writeRecovery.attachProjectWriteOwner(owner, proof, h.old.queue)).toThrow();
      let attached!: ReturnType<typeof writeRecovery.attachProjectWriteOwner>;
      act(() => { attached = writeRecovery.attachProjectWriteOwner(owner, proof, next.admission.queue); });
      expect(() => attached.assertCurrent()).not.toThrow(); expect(h.worker.documentMessages).toHaveLength(0);
      await act(async () => { next.release(); await next.admission.flush(); expect(await attached.completion).toBe(true); });
      expect(await writeRecovery.captureRegisteredProjectCut(owner, 1)).toBe(true); expect(await saving).toBe(false);
      h.rerender(); expect(h.result.current.writeOwner).toBe(owner);
    } finally { h.dispose(); }
  });

  it.each(['wrong-project', 'reentrant-retain'] as const)('does not grant attachment when synchronous hook admission fails: %s', async reason => {
    const h = await readmissionHarness(), id = h.project.id;
    try {
      const owner = h.result.current.writeOwner; expect(owner).toBeDefined(); h.old.queue.trackProject(h.installations.get(id)!);
      let checkpoint!: RetainedQueueWork, retained!: writeRecovery.RetainedProjectWrites;
      act(() => { checkpoint = h.old.queue.freeze('idle'); retained = writeRecovery.retainRegisteredProjectWrites(owner); });
      const next = await h.recovery(checkpoint), proof = await next.admission.prepareWriteRecovery(retained, checkpoint, h.installations, () => {
        if (reason === 'wrong-project') h.project.id = 'wrong'; return h.project;
      });
      if (reason === 'reentrant-retain') notification.current = () => { notification.current = undefined; h.result.current.retainForRecovery(); };
      act(() => { expect(() => writeRecovery.attachProjectWriteOwner(owner, proof, next.admission.queue)).toThrow(); });
      await expect(next.admission.flush()).rejects.toMatchObject({ code: 'retry-required' });
      expect(h.worker.documentMessages).toHaveLength(0);
    } finally { notification.current = undefined; h.project.id = id; h.dispose(); }
  });

  it('readmits an idle registered write owner without inventing a saved editor generation', async () => {
    const h = await readmissionHarness();
    try {
      expect(typeof h.old.queue.trackProject).toBe('function'); h.old.queue.trackProject(h.installations.get(h.project.id)!);
      let checkpoint!: RetainedQueueWork, retained!: ReturnType<typeof h.result.current.retainForRecovery>;
      act(() => { checkpoint = h.old.queue.freeze('idle restart'); retained = h.result.current.retainForRecovery(); });
      const next = await h.recovery(checkpoint), verified = await next.admission.prepareWriteRecovery(retained, checkpoint, h.installations, () => h.project);
      let readmitted!: Promise<boolean>; act(() => { readmitted = h.result.current.readmit(verified); });
      await act(async () => { next.release(); await next.admission.flush(); expect(await readmitted).toBe(true); });
      expect(await h.result.current.capturePersistenceCut(h.project.id, 0)).toBe(true);
      expect(await h.result.current.capturePersistenceCut(h.project.id, 1)).toBe(false);
      const saving = h.send(h.event(1)); await act(async () => { await next.admission.flush(); }); expect(await saving).toBe(true);
    } finally { h.dispose(); }
  });
  it('recovers represented document, paired preference and metadata obligations without resetting either clock', async () => {
    const h = await readmissionHarness();
    try {
      expect(typeof h.result.current.retainForRecovery).toBe('function'); expect(typeof h.result.current.readmit).toBe('function');
      const metadata = h.metadata('Pending metadata'), saving = h.send({ ...h.event(1), preferencePatch: { scale: 2 } });
      let retained!: ReturnType<typeof h.result.current.retainForRecovery>, checkpoint!: RetainedQueueWork;
      await act(async () => { checkpoint = h.old.queue.freeze('lost owner'); retained = h.result.current.retainForRecovery(); await Promise.all([metadata, saving]); });
      expect(await metadata).toBe(false); expect(await saving).toBe(false);
      const next = await h.recovery(checkpoint);
      const verified = await next.admission.prepareWriteRecovery(retained, checkpoint, h.installations, () => h.project);
      let recovered!: Promise<boolean>; act(() => { recovered = h.result.current.readmit(verified); });
      expect(h.result.current.hasUnsavedDocument).toBe(true);
      await act(async () => { next.release(); await next.admission.flush(); expect(await recovered).toBe(true); });
      expect(h.result.current.documentState.status).toBe('saved'); expect(h.result.current.preferenceState.status).toBe('saved');
      expect(await h.result.current.capturePersistenceCut(h.project.id, 1)).toBe(true);
      const following = h.send(h.event(2)); await act(async () => { await next.admission.flush(); }); expect(await following).toBe(true);
      const batches = h.worker.messages.flatMap(({ request }) => request.type === 'document-batch' ? [request.batch] : []);
      expect(batches.map(batch => batch.editorGeneration)).toEqual([1, 2, 3]);
      expect((await h.worker.exportFresh()).initialState.nodes.root.data).toEqual({ label: 'edit-2' });
      expect(await saving).toBe(false);
    } finally { h.dispose(); }
  });

  it('does not clear missing handoffs or unrepresented paired preferences merely because the queue is empty', async () => {
    const h = await readmissionHarness();
    try {
      expect(typeof h.result.current.retainForRecovery).toBe('function');
      const original = h.store.commit;
      h.store.commit = ((command: Parameters<typeof original>[0]) => command.type === 'save-editor-preferences'
        ? Promise.reject(new WorkspaceStoreError('Before queue admission', 'conflict')) : original(command)) as typeof original;
      expect(await h.preference(1)).toBe(false);
      const saving = h.send({ ...h.event(2), preferencePatch: { scale: 3 } });
      await act(async () => { await h.old.flush(); }); expect(await saving).toBe(true);
      let retained!: ReturnType<typeof h.result.current.retainForRecovery>, checkpoint!: RetainedQueueWork;
      act(() => { checkpoint = h.old.queue.freeze('readmit'); retained = h.result.current.retainForRecovery(); });
      const next = await h.recovery(checkpoint);
      await expect(next.admission.prepareWriteRecovery(retained, checkpoint, h.installations, () => h.project)).rejects.toThrow();
      expect(await h.result.current.capturePersistenceCut(h.project.id, 2)).toBe(false);
      expect(h.result.current.preferenceState.status).not.toBe('saved');
    } finally { h.dispose(); }
  });

  it('rejects caller-shaped readmission proof without changing unsaved state', async () => {
    const h = await harness();
    expect(typeof h.result.current.readmit).toBe('function');
    const pending = h.send(h.event(1)); await act(async () => { h.documents[0].control.reject(Error('lost')); await pending; });
    const before = h.result.current.documentState;
    expect(await h.result.current.readmit({} as any)).toBe(false);
    expect(h.result.current.documentState).toEqual(before); expect(h.store.commit).toHaveBeenCalledTimes(1);
  });

  it('adopts an independently inspected late commit without resending it or changing the old cut result', async () => {
    const h = await readmissionHarness();
    try {
      const saving = h.send(h.event(1)), cut = h.result.current.capturePersistenceCut(h.project.id, 1);
      const flushing = h.old.flush(); void flushing.catch(() => {});
      let checkpoint!: RetainedQueueWork, retained!: ReturnType<typeof h.result.current.retainForRecovery>;
      await act(async () => { checkpoint = h.old.queue.freeze('unknown'); retained = h.result.current.retainForRecovery(); await saving; });
      expect(await cut).toBe(false); const next = await h.recovery(checkpoint);
      const verified = await next.admission.prepareWriteRecovery(retained, checkpoint, h.installations, () => h.project);
      let readmitted!: Promise<boolean>; act(() => { readmitted = h.result.current.readmit(verified); });
      await act(async () => { next.release(); await next.admission.flush(); expect(await readmitted).toBe(true); });
      expect(h.worker.messages.filter(message => message.request.type === 'document-batch')).toHaveLength(1);
      expect(getInstalledProjectAuthorityLineage(h.project)?.revision).toBe(1);
      expect(await h.result.current.capturePersistenceCut(h.project.id, 1)).toBe(true); expect(await saving).toBe(false); expect(await cut).toBe(false);
    } finally { h.dispose(); }
  });

  it('can recapture after a wrong-project resolver prevents late-ack adoption', async () => {
    const h = await readmissionHarness(), projectId = h.project.id;
    try {
      const saving = h.send(h.event(1)); void h.old.flush().catch(() => {});
      let checkpoint!: RetainedQueueWork, retained!: ReturnType<typeof h.result.current.retainForRecovery>;
      await act(async () => { checkpoint = h.old.queue.freeze('unknown'); retained = h.result.current.retainForRecovery(); await saving; });
      const next = await h.recovery(checkpoint);
      let wrongProject = true;
      const resolveAuthority = () => { h.project.id = wrongProject ? 'wrong-project' : projectId; return h.project; };
      const proof = await next.admission.prepareWriteRecovery(retained, checkpoint, h.installations, resolveAuthority);
      await act(async () => { expect(await h.result.current.readmit(proof)).toBe(false); });
      wrongProject = false; h.project.id = projectId;
      act(() => { retained = h.result.current.retainForRecovery(); });
      const retry = await next.admission.prepareWriteRecovery(retained, checkpoint, h.installations, resolveAuthority);
      let resumed!: Promise<boolean>; act(() => { resumed = h.result.current.readmit(retry); });
      await act(async () => { next.release(); await next.admission.flush(); expect(await resumed).toBe(true); });
      expect(h.worker.documentMessages).toHaveLength(1); expect(h.result.current.hasUnsavedDocument).toBe(false);
      expect(getInstalledProjectAuthorityLineage(h.project)?.revision).toBe(1);
    } finally { h.project.id = projectId; h.dispose(); }
  });

  it('rebinds an already saved structural predecessor after its queue dependency entry was released', async () => {
    const h = await readmissionHarness();
    try {
      const metadata = h.metadata('Before structure'); await act(async () => { await h.old.flush(); }); await metadata;
      const structure = h.send(h.event(1, true)); await act(async () => { await h.old.flush(); }); expect(await structure).toBe(true);
      const saving = h.send({ ...h.event(2), foldBasis: { type: 'after-structural', editorGeneration: 1 } });
      let checkpoint!: RetainedQueueWork, retained!: ReturnType<typeof h.result.current.retainForRecovery>;
      await act(async () => { checkpoint = h.old.queue.freeze('restart'); retained = h.result.current.retainForRecovery(); await saving; });
      expect(checkpoint.projects[0].structuralAcks).toEqual([]);
      const next = await h.recovery(checkpoint), verified = await next.admission.prepareWriteRecovery(retained, checkpoint, h.installations, () => h.project);
      let readmitted!: Promise<boolean>; act(() => { readmitted = h.result.current.readmit(verified); });
      await act(async () => { next.release(); await next.admission.flush(); expect(await readmitted).toBe(true); });
      const following = h.send({ ...h.event(3, true), foldBasis: { type: 'after-structural', editorGeneration: 1 } });
      await act(async () => { await next.admission.flush(); }); expect(await following).toBe(true);
      expect(h.worker.messages.at(-1)!.request).toMatchObject({ type: 'structural-command', command: { batch: { editorGeneration: 4 } } });
    } finally { h.dispose(); }
  });

  it('keeps readmission pending until every required lane settles, then refuses reused proof', async () => {
    const h = await readmissionHarness();
    try {
      const saving = h.send({ ...h.event(1), preferencePatch: { scale: 2 } });
      let checkpoint!: RetainedQueueWork, retained!: ReturnType<typeof h.result.current.retainForRecovery>;
      await act(async () => { checkpoint = h.old.queue.freeze('restart'); retained = h.result.current.retainForRecovery(); await saving; });
      const next = await h.recovery(checkpoint), verified = await next.admission.prepareWriteRecovery(retained, checkpoint, h.installations, () => h.project);
      let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }), request = h.worker.client.request.bind(h.worker.client);
      vi.spyOn(h.worker.client, 'request').mockImplementation(message => message.type === 'preferences' ? gate.then(() => request(message)) : request(message));
      let readmitted!: Promise<boolean>, done = false, flushed!: Promise<void>;
      act(() => { readmitted = h.result.current.readmit(verified); void readmitted.then(() => { done = true; }); next.release(); flushed = next.admission.flush(); });
      try {
        await act(async () => { await vi.waitFor(() => expect(h.result.current.documentState.status).toBe('saved')); });
        expect(done).toBe(false); expect(await h.result.current.capturePersistenceCut(h.project.id, 1)).toBe(false);
        await act(async () => { release(); await flushed; expect(await readmitted).toBe(true); });
        expect(await h.result.current.readmit(verified)).toBe(false);
      } finally { release(); }
    } finally { h.dispose(); }
  });

  it('does not let failure during replay clear retained unsaved work', async () => {
    const h = await readmissionHarness();
    try {
      const saving = h.send(h.event(1)); let checkpoint!: RetainedQueueWork, retained!: ReturnType<typeof h.result.current.retainForRecovery>;
      await act(async () => { checkpoint = h.old.queue.freeze('restart'); retained = h.result.current.retainForRecovery(); await saving; });
      const next = await h.recovery(checkpoint), verified = await next.admission.prepareWriteRecovery(retained, checkpoint, h.installations, () => h.project);
      let readmitted!: Promise<boolean>; act(() => { readmitted = h.result.current.readmit(verified); });
      h.worker.setFault(point => { if (point.phase === 'before-complete') throw Error('Replay failed'); });
      await act(async () => { next.release(); await expect(next.admission.flush()).rejects.toBeDefined(); expect(await readmitted).toBe(false); });
      expect(h.result.current.hasUnsavedDocument).toBe(true); expect(await h.result.current.capturePersistenceCut(h.project.id, 1)).toBe(false);
    } finally { h.worker.setFault(); h.dispose(); }
  });

  it('can capture a new authenticated recovery after a readmission is interrupted before replay', async () => {
    const h = await readmissionHarness();
    try {
      const saving = h.send(h.event(1)); let checkpoint!: RetainedQueueWork, retained!: ReturnType<typeof h.result.current.retainForRecovery>;
      await act(async () => { checkpoint = h.old.queue.freeze('first loss'); retained = h.result.current.retainForRecovery(); await saving; });
      const next = await h.recovery(checkpoint), proof = await next.admission.prepareWriteRecovery(retained, checkpoint, h.installations, () => h.project);
      let readmitted!: Promise<boolean>; act(() => { readmitted = h.result.current.readmit(proof); });
      await act(async () => { checkpoint = next.admission.queue.freeze('second loss'); expect(await readmitted).toBe(false); });
      let newer!: ReturnType<typeof h.result.current.retainForRecovery>;
      act(() => { newer = h.result.current.retainForRecovery(); }); expect(newer).not.toBe(retained);
      const retry = await h.recovery(checkpoint), verified = await retry.admission.prepareWriteRecovery(newer, checkpoint, h.installations, () => h.project);
      act(() => { readmitted = h.result.current.readmit(verified); });
      await act(async () => { retry.release(); await retry.admission.flush(); expect(await readmitted).toBe(true); });
      expect(h.result.current.hasUnsavedDocument).toBe(false); expect(h.worker.documentMessages).toHaveLength(1);
    } finally { h.dispose(); }
  });

  it('does not clear a newer metadata intent refused after an older write failed', async () => {
    const h = await readmissionHarness();
    try {
      const first = h.metadata('older'); let checkpoint!: RetainedQueueWork;
      await act(async () => { checkpoint = h.old.queue.freeze('lost'); await first; });
      expect(await h.metadata('newer refused')).toBe(false);
      let retained!: ReturnType<typeof h.result.current.retainForRecovery>; act(() => { retained = h.result.current.retainForRecovery(); });
      const next = await h.recovery(checkpoint);
      await expect(next.admission.prepareWriteRecovery(retained, checkpoint, h.installations, () => h.project)).rejects.toThrow();
      expect(await h.result.current.capturePersistenceCut(h.project.id, 0)).toBe(false);
      expect(h.result.current.hasUnsavedDocument).toBe(true);
    } finally { h.dispose(); }
  });

  it('keeps work unsaved if a newer metadata intent is refused while readmission is replaying', async () => {
    const h = await readmissionHarness();
    try {
      const first = h.metadata('older'); let checkpoint!: RetainedQueueWork, retained!: ReturnType<typeof h.result.current.retainForRecovery>;
      await act(async () => { checkpoint = h.old.queue.freeze('lost'); retained = h.result.current.retainForRecovery(); await first; });
      const next = await h.recovery(checkpoint), verified = await next.admission.prepareWriteRecovery(retained, checkpoint, h.installations, () => h.project);
      let readmitted!: Promise<boolean>; act(() => { readmitted = h.result.current.readmit(verified); });
      expect(await h.metadata('newer during replay')).toBe(false);
      await act(async () => { next.release(); await next.admission.flush(); expect(await readmitted).toBe(false); });
      expect(h.result.current.hasUnsavedDocument).toBe(true); expect(await h.result.current.capturePersistenceCut(h.project.id, 0)).toBe(false);
    } finally { h.dispose(); }
  });

  it('rechecks the authenticated installation after the completion-time resolver revokes it', async () => {
    const h = await readmissionHarness();
    try {
      h.old.queue.trackProject(h.installations.get(h.project.id)!);
      let checkpoint!: RetainedQueueWork, retained!: ReturnType<typeof h.result.current.retainForRecovery>;
      act(() => { checkpoint = h.old.queue.freeze('idle'); retained = h.result.current.retainForRecovery(); });
      const next = await h.recovery(checkpoint); let resolutions = 0;
      const verified = await next.admission.prepareWriteRecovery(retained, checkpoint, h.installations, () => {
        if (++resolutions === 2) h.installations.delete(h.project.id); return h.project;
      });
      await act(async () => { expect(await h.result.current.readmit(verified)).toBe(false); });
      expect(resolutions).toBe(2); expect(await h.result.current.capturePersistenceCut(h.project.id, 0)).toBe(false);
    } finally { h.dispose(); }
  });

  it.each(['detach', 'retain'] as const)('refuses successful readmission notification that reenters %s', async action => {
    const h = await readmissionHarness();
    try {
      h.old.queue.trackProject(h.installations.get(h.project.id)!);
      let checkpoint!: RetainedQueueWork, retained!: ReturnType<typeof h.result.current.retainForRecovery>;
      act(() => { checkpoint = h.old.queue.freeze('idle'); retained = h.result.current.retainForRecovery(); });
      const next = await h.recovery(checkpoint), verified = await next.admission.prepareWriteRecovery(retained, checkpoint, h.installations, () => h.project);
      let notifications = 0;
      notification.current = () => { if (++notifications === 2) { if (action === 'detach') h.unmount(); else h.result.current.retainForRecovery(); } };
      await act(async () => { expect(await h.result.current.readmit(verified)).toBe(false); });
      expect(notifications).toBeGreaterThanOrEqual(2);
    } finally { notification.current = undefined; h.dispose(); }
  });

  it('keeps the owner paused if its final success notification revokes the installation', async () => {
    const h = await readmissionHarness();
    try {
      h.old.queue.trackProject(h.installations.get(h.project.id)!);
      let checkpoint!: RetainedQueueWork, retained!: ReturnType<typeof h.result.current.retainForRecovery>;
      act(() => { checkpoint = h.old.queue.freeze('idle'); retained = h.result.current.retainForRecovery(); });
      const next = await h.recovery(checkpoint), verified = await next.admission.prepareWriteRecovery(retained, checkpoint, h.installations, () => h.project);
      let notifications = 0;
      notification.current = () => { if (++notifications === 2) h.installations.delete(h.project.id); };
      await act(async () => { expect(await h.result.current.readmit(verified)).toBe(false); });
      expect(await h.result.current.capturePersistenceCut(h.project.id, 0)).toBe(false);
    } finally { notification.current = undefined; h.dispose(); }
  });

  it('does not accept an unexplained working revision change from its completion resolver', async () => {
    const h = await readmissionHarness();
    try {
      h.old.queue.trackProject(h.installations.get(h.project.id)!);
      let checkpoint!: RetainedQueueWork, retained!: ReturnType<typeof h.result.current.retainForRecovery>;
      act(() => { checkpoint = h.old.queue.freeze('idle'); retained = h.result.current.retainForRecovery(); });
      const next = await h.recovery(checkpoint); let calls = 0;
      const verified = await next.admission.prepareWriteRecovery(retained, checkpoint, h.installations, () => {
        if (++calls === 2) registerInstalledProjectAuthority(h.project, { incarnation: h.worker.scope.incarnation, revision: 9 }, h.source);
        return h.project;
      });
      await act(async () => { expect(await h.result.current.readmit(verified)).toBe(false); });
      expect(await h.result.current.capturePersistenceCut(h.project.id, 0)).toBe(false);
    } finally { h.dispose(); }
  });

  it('marks idle refused metadata visibly unsaved without posting or endlessly notifying on reentry', async () => {
    const h = await readmissionHarness();
    try {
      act(() => { h.result.current.retainForRecovery(); });
      const nested: Promise<boolean>[] = [];
      notification.current = () => { if (nested.length < 2) nested.push(h.metadata('reentered refused intent')); };
      expect(await h.metadata('refused intent')).toBe(false);
      expect(h.result.current.documentState.status).not.toBe('saved'); expect(h.result.current.hasUnsavedDocument).toBe(true);
      expect(h.worker.documentMessages).toEqual([]); expect(nested.length).toBeLessThanOrEqual(1);
    } finally { notification.current = undefined; h.dispose(); }
  });

  it.each(['retained', 'recovering'] as const)('marks idle refused document and preference intents unsaved while %s', async phase => {
    const h = await readmissionHarness();
    try {
      h.old.queue.trackProject(h.installations.get(h.project.id)!);
      let checkpoint!: RetainedQueueWork, retained!: ReturnType<typeof h.result.current.retainForRecovery>;
      act(() => { checkpoint = h.old.queue.freeze('idle'); retained = h.result.current.retainForRecovery(); });
      const next = await h.recovery(checkpoint), verified = await next.admission.prepareWriteRecovery(retained, checkpoint, h.installations, () => h.project);
      let resumed: Promise<boolean> | undefined, document!: Promise<boolean>, preference!: Promise<boolean>;
      act(() => {
        if (phase === 'recovering') resumed = h.result.current.readmit(verified);
        document = h.send(h.event(1)); preference = h.preference(2);
      });
      expect(await document).toBe(false); expect(await preference).toBe(false);
      expect(h.result.current.documentState.status).not.toBe('saved'); expect(h.result.current.preferenceState.status).not.toBe('saved');
      expect(h.result.current.hasUnsavedDocument).toBe(true); expect(h.worker.documentMessages).toHaveLength(0);
      await act(async () => { next.release(); await next.admission.flush(); if (resumed) expect(await resumed).toBe(false); });
    } finally { h.dispose(); }
  });

  it('ignores duplicate and foreign callbacks without dirtying an idle retained owner', async () => {
    const h = await harness(); act(() => { h.result.current.retainForRecovery(); });
    const notified = vi.fn(); notification.current = notified;
    expect(await h.send(h.event(0))).toBe(false);
    expect(await h.send({ ...h.event(1), source: {} })).toBe(false);
    expect(await h.preference(0)).toBe(false);
    expect(await h.result.current.updatePreferences(h.project.id, { scale: 3 }, { source: {}, editorGeneration: 1 }, 7)).toBe(false);
    expect(await h.result.current.updateMetadata(h.project.id, { name: 'foreign' }, 8)).toBe(false);
    expect(h.result.current.documentState.status).toBe('saved'); expect(h.result.current.preferenceState.status).toBe('saved');
    expect(h.store.commit).not.toHaveBeenCalled(); expect(notified).not.toHaveBeenCalled();
  });

  it('compacts completed receipt metadata while keeping the readmitted hook and queue alive', async () => {
    const { setFlagsFromString } = await import('node:v8'), { runInNewContext } = await import('node:vm');
    setFlagsFromString('--expose_gc'); const gc: () => void = runInNewContext('gc');
    const h = await readmissionHarness(); let weak!: WeakRef<object>;
    // The installed resolver outlives this recovery. Do not create it in the
    // checkpoint scope: V8 can share that scope with the act callbacks below.
    const resolveAuthority = () => h.project;
    try {
      await (async () => {
        const forward = h.store.commit; let command: object | undefined;
        h.store.commit = ((value: Parameters<typeof forward>[0]) => { command = value; return forward(value); }) as typeof forward;
        const saving = h.send(h.event(1)); weak = new WeakRef(getCommandQueueReceipt(command!)!); command = undefined; h.store.commit = forward;
        let checkpoint!: RetainedQueueWork, retained!: ReturnType<typeof h.result.current.retainForRecovery>;
        await act(async () => { checkpoint = h.old.queue.freeze('restart'); retained = h.result.current.retainForRecovery(); await saving; });
        const next = await h.recovery(checkpoint), proof = await next.admission.prepareWriteRecovery(retained, checkpoint, h.installations, resolveAuthority);
        let resumed!: Promise<boolean>; act(() => { resumed = h.result.current.readmit(proof); });
        await act(async () => { next.release(); await next.admission.flush(); expect(await resumed).toBe(true); }); h.dropOriginal();
      })();
      for (let index = 0; index < 12; index++) { await new Promise(resolve => setTimeout(resolve, 0)); gc(); }
      expect(weak.deref()).toBeUndefined(); expect(h.result.current.documentState.status).toBe('saved');
    } finally { h.dispose(); }
  });
});

describe('finite editor persistence cuts', () => {
  const cut = (h: Awaited<ReturnType<typeof harness>>, generation: number) => {
    expect(typeof h.result.current.capturePersistenceCut, 'generation-bounded handoff proof').toBe('function');
    return h.result.current.capturePersistenceCut(h.project.id, generation);
  };
  const resolvePreference = async (h: Awaited<ReturnType<typeof harness>>, index = 0) => {
    await act(async () => h.preferences[index].control.resolve({ type: 'preferences-saved', projectId: h.project.id, incarnation: 'i',
      commitId: `pref-${index}`, editorGeneration: h.preferences[index].command.editorGeneration, foldStructureGeneration: 0, preferenceRevision: index + 1 }));
  };

  it('waits for paired preferences even after the document return promise succeeds', async () => {
    const h = await harness(), saving = h.send({ ...h.event(1), preferencePatch: { scale: 2 } });
    const captured = cut(h, 1); let done = false; void captured.then(() => { done = true; });
    await h.resolveDocument(0, 1); expect(await saving).toBe(true); expect(done).toBe(false);
    await act(async () => { h.preferences[0].control.reject(new WorkspaceStoreError('Preference failed', 'quota')); });
    expect(await captured).toBe(false); expect(h.result.current.hasUnsavedDocument).toBe(false);
    expect(h.flushPending).not.toHaveBeenCalled();
  });

  it('refuses a suppressed paired preference obligation without changing ordinary document return semantics', async () => {
    const h = await harness(), preference = h.preference(1);
    await act(async () => { h.preferences[0].control.reject(Error('preference failed')); await preference; });
    const saving = h.send({ ...h.event(2), preferencePatch: { scale: 3 } });
    expect(h.preferences).toHaveLength(1); await h.resolveDocument(0, 1); expect(await saving).toBe(true);
    expect(await cut(h, 2)).toBe(false);
  });

  it('refuses missing handoff generations while preserving previously accepted ordinary generation skips', async () => {
    const h = await harness(), saving = h.send(h.event(2));
    await h.resolveDocument(0, 1); expect(await saving).toBe(true); expect(h.result.current.documentState.status).toBe('saved');
    expect(await cut(h, 2)).toBe(false);
  });

  it.each(['source', 'replacement', 'mapping'] as const)('refuses an early %s failure even when nothing was enqueued', async reason => {
    const h = await harness(); let event = h.event(1);
    if (reason === 'source') h.invalidate();
    if (reason === 'replacement') event = { ...event, foldBasis: { type: 'after-replacement', editorGeneration: 0 } };
    if (reason === 'mapping' && event.kind === 'incremental') event = { ...event, correspondence: {} as typeof event.correspondence };
    expect(await h.send(event)).toBe(false); expect(h.store.commit).not.toHaveBeenCalled();
    expect(await cut(h, 1)).toBe(false);
  });

  it('includes older metadata even when no editor generation has advanced', async () => {
    const h = await harness(), metadata = h.metadata('Older metadata'), captured = cut(h, 0);
    let done = false; void captured.then(() => { done = true; }); await act(async () => {}); expect(done).toBe(false);
    await act(async () => { h.documents[0].control.reject(Error('metadata failed')); await metadata; });
    expect(await captured).toBe(false);
  });

  it('does not let duplicate callbacks overwrite an authentic pending or completed handoff', async () => {
    const h = await harness(), saving = h.send(h.event(1));
    expect(await h.send(h.event(1))).toBe(false); const captured = cut(h, 1);
    await h.resolveDocument(0, 1); expect(await saving).toBe(true); expect(await captured).toBe(true);
    expect(await h.send(h.event(1))).toBe(false); expect(await cut(h, 1)).toBe(true);
    expect(h.store.commit).toHaveBeenCalledTimes(1);
  });

  it('does not let later typing or a later failure redefine an earlier captured cut', async () => {
    const h = await harness(), first = h.send(h.event(1)), captured = cut(h, 1), newer = h.send(h.event(2));
    await act(async () => { h.documents[1].control.reject(Error('later failure')); await newer; });
    await h.resolveDocument(0, 1); expect(await first).toBe(true); expect(await captured).toBe(true);
    expect(await cut(h, 2)).toBe(false); expect(h.result.current.hasUnsavedDocument).toBe(true);
  });

  it('does not wait on metadata admitted after capture', async () => {
    const h = await harness(), first = h.send(h.event(1)), captured = cut(h, 1), newer = h.metadata('Later metadata');
    await h.resolveDocument(0, 1); expect(await first).toBe(true); expect(await captured).toBe(true);
    expect(h.result.current.hasPendingWrites).toBe(true); await h.resolveDocument(1, 2); expect(await newer).toBe(true);
  });

  it('reserves both-lane handoff obligations before a synchronous store callback can capture a cut', async () => {
    const h = await harness(), forward = h.store.commit; let captured: Promise<boolean> | undefined;
    expect(typeof h.result.current.capturePersistenceCut).toBe('function');
    h.store.commit = ((...args: Parameters<typeof forward>) => { captured ??= cut(h, 1); return forward(...args); }) as typeof forward;
    const saving = h.send({ ...h.event(1), preferencePatch: { scale: 2 } });
    let done = false; void captured!.then(() => { done = true; });
    await h.resolveDocument(0, 1); expect(await saving).toBe(true); expect(done).toBe(false);
    await resolvePreference(h); expect(await captured).toBe(true);
  });

  it('uses the binding floor for preference-only coverage and refuses source loss at completion', async () => {
    const h = await harness(false, 10), saving = h.preference(11), captured = cut(h, 11);
    await resolvePreference(h); expect(await saving).toBe(true); expect(await captured).toBe(true);
    expect(await cut(h, 12)).toBe(false);
    const pending = h.preference(12), lost = cut(h, 12); h.invalidate(); await resolvePreference(h, 1);
    expect(await pending).toBe(false); expect(await lost).toBe(false);
  });

  it('refuses a cut when its completion-time authority resolver detaches the hook', async () => {
    const h = await harness(); let calls = 0;
    h.options.resolveAuthority = () => { if (++calls === 2) h.unmount(); return h.project; }; h.rerender();
    let result!: boolean;
    await act(async () => { result = await cut(h, 0); });
    expect(calls).toBe(2); expect(result).toBe(false);
  });
});

it('mounts silently in StrictMode and leaves working payloads opaque', async () => {
  const h = await harness(true);
  expect(h.store.commit).not.toHaveBeenCalled(); expect(h.result.current.documentState.status).toBe('saved');
  const e = h.event(1); const payload = vi.fn(() => { throw new Error('Authority payload read'); });
  Object.defineProperty(h.project, 'initialState', { get: payload });
  const clone = vi.spyOn(globalThis, 'structuredClone');
  const saving = h.send(e); expect(h.result.current.hasUnsavedDocument).toBe(true);
  await h.resolveDocument(0, 1); expect(await saving).toBe(true);
  expect(h.result.current.documentState.status).toBe('saved');
  expect(payload).not.toHaveBeenCalled(); expect(clone).not.toHaveBeenCalled();
});

it('admits a whole document/preference group before a status observer can submit metadata', async () => {
  const h = await harness(); let fired = false; let metadata!: Promise<boolean>;
  notification.current = () => { if (!fired) { fired = true; metadata = h.metadata('Reentered metadata'); } };
  const saving = h.send({ ...h.event(1), preferencePatch: { scale: 2 } });
  expect(h.store.commit).toHaveBeenNthCalledWith(1, expect.objectContaining({ type: 'save-document-changes', editorGeneration: 1 }));
  expect(h.store.commit).toHaveBeenNthCalledWith(2, expect.objectContaining({ type: 'save-editor-preferences', editorGeneration: 1 }));
  expect(h.store.commit).toHaveBeenNthCalledWith(3, expect.objectContaining({ type: 'update-project-metadata', editorGeneration: 2 }));
  await h.resolveDocument(0, 1); await saving;
  await act(async () => { h.preferences[0].control.resolve({ type: 'preferences-saved', projectId: h.project.id, incarnation: 'i',
    commitId: 'preferences', editorGeneration: 1, foldStructureGeneration: 0, preferenceRevision: 1 }); });
  await h.resolveDocument(1, 2); expect(await metadata).toBe(true);
});

it('does not start a store call after status notification unmounts its owner', async () => {
  const h = await harness(); let unmounted = false; let calledAfterUnmount = false;
  const forward = h.store.commit;
  h.store.commit = ((...args: Parameters<typeof forward>) => {
    calledAfterUnmount ||= unmounted; return forward(...args);
  }) as typeof forward;
  notification.current = () => { if (!unmounted) { unmounted = true; h.unmount(); } };
  const saving = h.send(h.event(1));
  expect(calledAfterUnmount).toBe(false);
  await h.resolveDocument(0, 1); expect(await saving).toBe(false);
});

it('serializes synchronous store reentry behind the current logical submission', async () => {
  const h = await harness(); const forward = h.store.commit; let fired = false; let metadata!: Promise<boolean>;
  h.store.commit = ((...args: Parameters<typeof forward>) => {
    if (!fired) { fired = true; metadata = h.metadata('Store reentry'); }
    return forward(...args);
  }) as typeof forward;
  const saving = h.send({ ...h.event(1), preferencePatch: { scale: 2 } });
  expect(forward).toHaveBeenNthCalledWith(1, expect.objectContaining({ type: 'save-document-changes', editorGeneration: 1 }));
  expect(forward).toHaveBeenNthCalledWith(2, expect.objectContaining({ type: 'save-editor-preferences', editorGeneration: 1 }));
  expect(forward).toHaveBeenNthCalledWith(3, expect.objectContaining({ type: 'update-project-metadata', editorGeneration: 2 }));
  await h.resolveDocument(0, 1); await saving;
  await act(async () => { h.preferences[0].control.resolve({ type: 'preferences-saved', projectId: h.project.id, incarnation: 'i',
    commitId: 'pref', editorGeneration: 1, foldStructureGeneration: 0, preferenceRevision: 1 }); });
  await h.resolveDocument(1, 2); expect(await metadata).toBe(true);
});

it('an older completion cannot mark a newer edit saved', async () => {
  const h = await harness(); const first = h.send(h.event(1)); const second = h.send(h.event(2));
  await h.resolveDocument(0, 1); expect(await first).toBe(true);
  expect(h.result.current.documentState.status).toBe('saving'); expect(h.result.current.hasUnsavedDocument).toBe(true);
  await h.resolveDocument(1, 2); expect(await second).toBe(true);
  expect(h.result.current.documentState.status).toBe('saved');
  expect(getInstalledProjectAuthorityLineage(h.project)?.revision).toBe(2);
});

it('accepts coalesced receipts but waits for every admitted call to settle', async () => {
  const h = await harness(); const first = h.send(h.event(1)); const second = h.send(h.event(2));
  await h.resolveDocument(0, 1, { editorGeneration: 2 }); expect(await first).toBe(true);
  expect(h.result.current.documentState.status).toBe('saving');
  await h.resolveDocument(1, 1, { editorGeneration: 2 }); expect(await second).toBe(true);
  expect(h.result.current.documentState.status).toBe('saved'); expect(getInstalledProjectAuthorityLineage(h.project)?.revision).toBe(1);
});

it('metadata uses a write generation without consuming the next editor generation', async () => {
  const h = await harness(); const first = h.send(h.event(1));
  await h.resolveDocument(0, 1); await first;
  const metadata = h.metadata('No history entry'); await h.resolveDocument(1, 2); await metadata;
  const next = h.send({ ...h.event(2), origin: 'undo' });
  expect(h.documents.map(item => item.command.editorGeneration)).toEqual([1, 2, 3]);
  await h.resolveDocument(2, 3); expect(await next).toBe(true);
});

it('translates a local structural dependency across an intervening metadata write', async () => {
  const h = await harness(); const meta = h.metadata('First metadata'); await h.resolveDocument(0, 1); await meta;
  const structure = h.send(h.event(1, true)); await h.resolveDocument(1, 2); await structure;
  const next = h.send({ ...h.event(2), foldBasis: { type: 'after-structural', editorGeneration: 1 } });
  // A later template edit carries the dependency when mappings are needed.
  const templateEvent = { ...h.event(3, true), foldBasis: { type: 'after-structural' as const, editorGeneration: 1 } };
  const templateSave = h.send(templateEvent);
  const request = h.documents[3].command;
  expect(request.type).toBe('save-document-changes');
  if (request.type === 'save-document-changes') expect(request.structural?.basis).toEqual({ type: 'after-structural', editorGeneration: 2 });
  await h.resolveDocument(2, 3); await next; await h.resolveDocument(3, 4); await templateSave;
});

it('preference failure stays separate from document dirty state', async () => {
  const h = await harness(); const saving = h.preference(1);
  await act(async () => { h.preferences[0].control.reject(new WorkspaceStoreError('Preference quota', 'quota')); await saving; });
  expect(h.result.current.preferenceState.status).toBe('failed');
  expect(h.result.current.documentState.status).toBe('saved'); expect(h.result.current.hasUnsavedDocument).toBe(false);
  const document = h.send(h.event(2)); await h.resolveDocument(0, 1); expect(await document).toBe(true);
  expect(h.result.current.documentState.status).toBe('saved'); expect(h.result.current.preferenceState.status).toBe('failed');
});

it('document-linked preference work has independent completion and failure status', async () => {
  const h = await harness(); const saving = h.send({ ...h.event(1), preferencePatch: { scale: 2 } });
  expect(h.documents[0].command.editorGeneration).toBe(h.preferences[0].command.editorGeneration);
  await h.resolveDocument(0, 1); expect(await saving).toBe(true);
  expect(h.result.current.documentState.status).toBe('saved'); expect(h.result.current.preferenceState.status).toBe('saving');
  await act(async () => { h.preferences[0].control.reject(new WorkspaceStoreError('Preference failed', 'quota')); });
  expect(h.result.current.preferenceState.status).toBe('failed'); expect(h.result.current.hasUnsavedDocument).toBe(false);
});

it.each([
  ['project', { projectId: 'other' }], ['incarnation', { incarnation: 'other' }],
  ['revision-gap', { revision: 2 }], ['old-generation', { editorGeneration: 0 }],
  ['future-generation', { editorGeneration: 2 }], ['commit-id', { commitId: '' }],
] as const)('refuses an invalid %s acknowledgement without granting lineage', async (_kind, patch) => {
  const h = await harness(); const saving = h.send(h.event(1));
  await h.resolveDocument(0, 1, patch); expect(await saving).toBe(false);
  expect(h.result.current.documentState.status).toBe('conflict'); expect(h.result.current.hasUnsavedDocument).toBe(true);
  expect(getInstalledProjectAuthorityLineage(h.project)?.revision).toBe(0);
});

it('unmount prevents late receipt publication and lineage advancement', async () => {
  const h = await harness(); const saving = h.send(h.event(1)); h.unmount();
  await h.resolveDocument(0, 1); expect(await saving).toBe(false);
  expect(getInstalledProjectAuthorityLineage(h.project)?.revision).toBe(0);
});

it('requires a keyed remount rather than resetting a source generation floor', async () => {
  const h = await harness(); h.binding.editorGenerationFloor = 1;
  expect(() => h.rerender()).toThrow(/remount/); expect(h.store.commit).not.toHaveBeenCalled();
});

it('fails closed on write-generation exhaustion', async () => {
  const h = await harness(false, Number.MAX_SAFE_INTEGER);
  expect(await h.metadata('Cannot allocate')).toBe(false);
  expect(h.result.current.documentState.status).toBe('failed'); expect(h.result.current.hasUnsavedDocument).toBe(true);
  expect(h.store.commit).not.toHaveBeenCalled();
});

it('rejects replacement payload accessors before reading or posting the state', async () => {
  const h = await harness(); const state = vi.fn(() => { throw new Error('Replacement payload walked'); });
  const replacement = { ...h.event(1), kind: 'replace' as const, state: h.project.initialState, preferences: partitionState(h.project.initialState).preferences };
  Object.defineProperty(replacement, 'state', { get: state });
  expect(await h.send(replacement)).toBe(false); expect(state).not.toHaveBeenCalled();
  expect(h.result.current.hasUnsavedDocument).toBe(true); expect(h.store.commit).not.toHaveBeenCalled();
});

it('ignores stale-source and stale-epoch callbacks without reading their receipt', async () => {
  const h = await harness(); const e = h.event(1);
  const foreign = { ...e, source: {} };
  Object.defineProperty(e, 'edit', { get() { throw new Error('Stale receipt inspected'); } });
  Object.defineProperty(foreign, 'edit', { get() { throw new Error('Stale receipt inspected'); } });
  expect(await h.send(foreign)).toBe(false);
  expect(await h.send(e, 6)).toBe(false);
  expect(h.store.commit).not.toHaveBeenCalled(); expect(h.result.current.hasUnsavedDocument).toBe(false);
});

it('ignores duplicate editor generations without inspecting or dirtying their stale receipt', async () => {
  const h = await harness(); const saved = h.send(h.event(1)); await h.resolveDocument(0, 1); await saved;
  const stale = h.event(1); const getter = vi.fn(() => { throw new Error('Stale generation receipt read'); });
  Object.defineProperty(stale, 'edit', { get: getter });
  expect(await h.send(stale)).toBe(false);
  expect(getter).not.toHaveBeenCalled(); expect(h.result.current.documentState.status).toBe('saved');
  expect(h.store.commit).toHaveBeenCalledTimes(1);
});

it('adopts resolver callbacks only after their render commits', async () => {
  const h = await harness();
  h.options.resolveAuthority = () => undefined;
  const saving = h.send(h.event(1));
  expect(h.store.commit).toHaveBeenCalledTimes(1);
  h.rerender();
  await h.resolveDocument(0, 1); expect(await saving).toBe(false);
  expect(h.result.current.documentState.status).not.toBe('saved');
});

it('does not accept preference success after an unexplained installed document revision jump', async () => {
  const h = await harness(); const saving = h.preference(1);
  registerInstalledProjectAuthority(h.project, { incarnation: 'i', revision: 9 }, h.source);
  await act(async () => { h.preferences[0].control.resolve({ type: 'preferences-saved', projectId: h.project.id, incarnation: 'i',
    commitId: 'preference-1', editorGeneration: 1, foldStructureGeneration: 0, preferenceRevision: 1 }); await saving; });
  expect(await saving).toBe(false); expect(h.result.current.preferenceState.status).toBe('conflict');
  expect(h.result.current.hasUnsavedDocument).toBe(false);
});

it('never publishes an obsolete or unmounted completion', async () => {
  const h = await harness(); const saving = h.send(h.event(1)); h.invalidate();
  await h.resolveDocument(0, 1); expect(await saving).toBe(false);
  expect(h.result.current.documentState.status).not.toBe('saved'); expect(getInstalledProjectAuthorityLineage(h.project)?.revision).toBe(0);
  h.unmount(); expect(await h.send(h.event(2))).toBe(false); expect(h.store.commit).toHaveBeenCalledTimes(1);
});

it('latches a document failure and does not silently clear unsaved work', async () => {
  const h = await harness(); const saving = h.send(h.event(1));
  await act(async () => { h.documents[0].control.reject(new WorkspaceStoreError('Conflict', 'conflict')); await saving; });
  expect(h.result.current.documentState.status).toBe('conflict'); expect(h.result.current.hasUnsavedDocument).toBe(true);
  expect(await h.send(h.event(2))).toBe(false); expect(h.store.commit).toHaveBeenCalledTimes(1);
});

it('flush cannot authorize navigation when a newer write arrives during its wait', async () => {
  const h = await harness(); const saving = h.send(h.event(1));
  const gate = deferred<void>(); h.flushPending.mockReturnValueOnce(gate.promise);
  let flushing!: Promise<boolean>; act(() => { flushing = h.result.current.flushPendingProject(h.project.id); });
  const newer = h.send(h.event(2)); await h.resolveDocument(0, 1); await saving;
  await act(async () => { gate.resolve(); }); expect(await flushing).toBe(false);
  await h.resolveDocument(1, 2); await newer;
  let final!: Promise<boolean>; await act(async () => { final = h.result.current.flushPendingProject(h.project.id); await final; });
  expect(await final).toBe(true);
});
