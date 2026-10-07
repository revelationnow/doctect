// @vitest-environment node
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import * as authority from '../../../../services/localWorkspace/projectAuthority';
import type { DocumentSaveAck, PreferenceSaveAck } from '../../../../services/localWorkspace/normalized/schema';
import { createIncrementalQueue, getCommandQueueReceipt, type InstalledQueueAuthority, type QueueEvent } from '../../../../services/localWorkspace/incrementalQueue';
import { makeIncrementalProject } from '../../../helpers/incrementalFixtures';
import { createIncrementalWorkerHarness } from '../../../helpers/incrementalWorkerHarness';
import { WorkspaceStoreError, type IncrementalWorkspaceCommand, type PreferenceWorkspaceCommand, type ProjectMetadataCommand, type WorkspaceSnapshot } from '../../../../services/localWorkspace/contracts';
import type { EditorScalarPreferencePatch } from '../../../../services/document/contracts';
import type { WorkspaceLifecycleCommand } from '../../../../services/localWorkspace/contracts';
import type { WorkspaceCommandResult as LifecycleResult } from '../../../../services/localWorkspace/normalized/workspaceCommands';
import { fakeStore } from '../../../helpers/fakeLocalWorkspaceStore';

const dispatchers = import.meta.glob<typeof import('../../../../services/localWorkspace/commandDispatcher')>('../../../../services/localWorkspace/commandDispatcher.ts');
const admissions = import.meta.glob<typeof import('../../../../services/localWorkspace/incrementalCommandAdmission')>('../../../../services/localWorkspace/incrementalCommandAdmission.ts');
async function commandModules() {
  expect(Object.keys(dispatchers)).toHaveLength(1); expect(Object.keys(admissions)).toHaveLength(1);
  return { ...await Object.values(dispatchers)[0](), ...await Object.values(admissions)[0]() };
}

async function commandFixture(onEvent?: (event: QueueEvent) => void, observeProject?: (event: QueueEvent) => void) {
  const modules = await commandModules();
  const worker = await createIncrementalWorkerHarness(makeIncrementalProject(2));
  const binding = worker.responses.find(response => response.response.type === 'bootstrapped')!.response;
  if (binding.type !== 'bootstrapped') throw new Error('Real bootstrap required');
  const installedProject = await worker.exportFresh();
  const projectId = installedProject.id;
  const source = authority.registerInstalledProjectAuthority(installedProject,
    { incarnation: binding.scope.incarnation, revision: binding.authority.documentRevision });
  let installed: InstalledQueueAuthority | undefined = { source, transport: worker.client, binding, editorGenerationFloor: 0 };
  let sequence = 0;
  const admission = modules.createIncrementalCommandAdmission({ transport: worker.client,
    clock: { now: () => Date.now(), setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    uuid: () => `command-${++sequence}`, resolveAuthority: id => id === projectId ? installed : undefined,
    onEvent, observeProject,
  });
  const snapshot = vi.fn(async () => { throw new WorkspaceStoreError('No structural fixture handler', 'unavailable'); });
  const commit = modules.createWorkspaceCommandDispatcher({ snapshot, document: admission.document, preferences: admission.preferences,
    metadata: admission.metadata });
  const start = worker.messages.length;
  return { ...worker, installedProject, admission, snapshot, commit,
    get requests() { return worker.messages.slice(start).map(message => message.request); },
    invalidate() { installed = undefined; },
    mutateInstallation(kind: 'generation-floor' | 'storage-generation') {
      if (!installed) throw new Error('No installation');
      if (kind === 'generation-floor') Reflect.set(installed, 'editorGenerationFloor', 100);
      else Reflect.set(installed.binding.scope, 'storageGeneration', 'changed-generation');
    },
    doc(generation: number, label: string, project = installedProject): IncrementalWorkspaceCommand {
      return { type: 'save-document-changes', authority: project, editorGeneration: generation,
        changes: [{ type: 'put-node', node: { ...installedProject.initialState.nodes.root, data: { label } } }] };
    },
    dispose() { admission.dispose(); worker.client.dispose(); },
  };
}

afterEach(() => vi.restoreAllMocks());

it.each(['document', 'preferences', 'metadata'] as const)('links the exact %s command to genuine queue admission before returning its promise', async lane => {
  const h = await commandFixture();
  try {
    const command = lane === 'document' ? h.doc(1, 'tracked') : lane === 'preferences'
      ? { type: 'save-editor-preferences' as const, authority: h.installedProject, editorGeneration: 1, patch: { scale: 2 } }
      : { type: 'update-project-metadata' as const, authority: h.installedProject, editorGeneration: 1, patch: { name: 'Tracked metadata' } };
    const saving = h.commit(command); void saving.catch(() => {});
    expect(getCommandQueueReceipt(command)).toBeDefined();
    expect(getCommandQueueReceipt({ ...command })).toBeUndefined();
    await h.admission.flush(); await saving;
  } finally { h.dispose(); }
});

it('allows an ordinary caller to reuse its command envelope without changing an earlier receipt', async () => {
  const h = await commandFixture();
  try {
    const command = h.doc(1, 'first'), first = h.commit(command), receipt = getCommandQueueReceipt(command)!;
    await h.admission.flush(); const acknowledged = await first;
    authority.advanceInstalledProjectAuthorityFromAck(h.installedProject, h.installedProject, acknowledged);
    command.editorGeneration = 2; command.changes = h.doc(2, 'second').changes;
    const second = h.commit(command); void second.catch(() => {});
    await h.admission.flush(); expect((await second).revision).toBe(2);
    expect(getCommandQueueReceipt(command)).not.toBe(receipt);
  } finally { h.dispose(); }
});

it.each(['frozen', 'invalid'] as const)('does not expose an earlier command receipt after reused envelope is rejected as %s', async reason => {
  const h = await commandFixture();
  try {
    const command = h.doc(1, 'first'), first = h.commit(command);
    await h.admission.flush(); const acknowledged = await first;
    authority.advanceInstalledProjectAuthorityFromAck(h.installedProject, h.installedProject, acknowledged);
    expect(getCommandQueueReceipt(command)).toBeDefined(); command.editorGeneration = 2;
    if (reason === 'frozen') h.admission.queue.freeze('lost'); else Object.assign(command, { unsupported: true });
    await expect(h.commit(command)).rejects.toThrow(); expect(getCommandQueueReceipt(command)).toBeUndefined();
  } finally { h.dispose(); }
});

describe('explicit workspace lifecycle dispatch', () => {
  it('routes the distinct lifecycle family with its own correlated result type', async () => {
    const { createWorkspaceCommandDispatcher } = await commandModules();
    const snapshot = vi.fn(async () => { throw Error('Historical writer called'); });
    const workspace = vi.fn(async () => { throw Error('Lifecycle handler reached'); });
    const commit = createWorkspaceCommandDispatcher({ snapshot, workspace });
    const command: WorkspaceLifecycleCommand = { type: 'workspace-lifecycle', intent: { type: 'activate-project', projectId: 'p' } };
    const result = commit(command); expectTypeOf(result).toEqualTypeOf<Promise<LifecycleResult>>();
    await expect(result).rejects.toThrow('Lifecycle handler reached'); expect(workspace).toHaveBeenCalledExactlyOnceWith(command);
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('keeps snapshot-only production dispatch from inspecting lifecycle payload or falling back', async () => {
    const { createWorkspaceCommandDispatcher } = await commandModules();
    const snapshot = vi.fn(async () => { throw Error('Historical writer called'); }), getter = vi.fn(() => { throw Error('Payload read'); });
    const commit = createWorkspaceCommandDispatcher({ snapshot });
    const command = Object.defineProperty({ type: 'workspace-lifecycle' }, 'intent', { enumerable: true, get: getter }) as WorkspaceLifecycleCommand;
    await expect(commit(command)).rejects.toMatchObject({ code: 'authority-lost' });
    expect(getter).not.toHaveBeenCalled(); expect(snapshot).not.toHaveBeenCalled();
  });
});

it('shares lifecycle cuts with the existing admission queue and forwards verified acknowledgements before passive reentry', async () => {
  const order: string[] = []; let successor: Promise<DocumentSaveAck> | undefined;
  const h = await commandFixture(event => {
    if (event.type !== 'acknowledged') return;
    order.push('passive');
    if (event.ack.type === 'document-saved' && event.ack.revision === 1) successor = h.commit(h.doc(2, 'after cut'));
  }, event => {
    if (event.type !== 'acknowledged') return;
    order.push('verified');
    if (event.ack.type === 'document-saved') authority.advanceInstalledProjectAuthorityFromAck(h.installedProject, h.installedProject, event.ack);
  });
  try {
    expect(h.admission.queue, 'private shared queue').toBeDefined();
    expect(typeof h.admission.workspaceBarrier).toBe('function');
    const first = h.commit(h.doc(1, 'before cut'));
    const cut = h.admission.workspaceBarrier({ targets: [], retireScopes: [], run: async () => {
      expect(order).toEqual(['verified', 'passive']); expect(h.requests).toHaveLength(1);
      order.push('workspace'); return { type: 'completed', value: 'cut' };
    } });
    expect(await cut).toBe('cut'); await first;
    await h.admission.queue.flush(); await successor;
    expect(order).toEqual(['verified', 'passive', 'workspace', 'verified', 'passive']);
    expect(h.requests.map(request => request.type)).toEqual(['document-batch', 'document-batch']);
    expect((await h.exportFresh()).initialState.nodes.root.data).toEqual({ label: 'after cut' });
  } finally { h.dispose(); }
});

describe('Task12 typed command admission', () => {
  it('keeps test-double command/result types correlated through the real dispatcher', async () => {
    expectTypeOf<PreferenceWorkspaceCommand['patch']>().toEqualTypeOf<EditorScalarPreferencePatch>();
    const project = makeIncrementalProject();
    const store = fakeStore({ incremental: {
      document: async command => ({ type: 'document-saved', projectId: command.authority.id, incarnation: 'test',
        commitId: 'document', editorGeneration: command.editorGeneration, foldStructureGeneration: 0, revision: 1 }),
      preferences: async command => ({ type: 'preferences-saved', projectId: command.authority.id, incarnation: 'test',
        commitId: 'preferences', editorGeneration: command.editorGeneration, foldStructureGeneration: 0, preferenceRevision: 1 }),
    } });
    const document = store.commit({ type: 'save-document-changes', authority: project, editorGeneration: 1, changes: [] });
    const preferences = store.commit({ type: 'save-editor-preferences', authority: project, editorGeneration: 2, patch: { scale: 2 } });
    const snapshot = store.commit({ type: 'activate-project', projectId: project.id });
    expectTypeOf(document).toEqualTypeOf<Promise<DocumentSaveAck>>();
    expectTypeOf(preferences).toEqualTypeOf<Promise<PreferenceSaveAck>>();
    expectTypeOf(snapshot).toEqualTypeOf<Promise<WorkspaceSnapshot>>();
    expect((await document).type).toBe('document-saved'); expect((await preferences).type).toBe('preferences-saved');
    expect(await snapshot).toHaveProperty('projects');
  });

  it('atomically saves a linked root title and project name', async () => {
    const h = await commandFixture();
    try {
      h.clearOperations();
      const saving = h.commit({ type: 'save-document-changes', authority: h.installedProject, editorGeneration: 1,
        changes: [{ type: 'put-node', node: { ...h.installedProject.initialState.nodes.root, title: 'Linked 根' } }],
        linkedProjectName: { name: 'Linked 根' } });
      void saving.catch(() => {}); await h.admission.flush(); expect((await saving).revision).toBe(1);
      const exported = await h.exportFresh(); expect(exported.name).toBe('Linked 根'); expect(exported.initialState.nodes.root.title).toBe('Linked 根');
      const records = await h.readRecords();
      expect(records.projectHeaders.values().next().value!.counters.projectBaseBytes + records.projectPreferences.values().next().value!.preferenceBytes)
        .toBe(Buffer.byteLength(JSON.stringify(exported)));
      const writes = h.operations.filter(operation => operation.phase === 'write');
      expect(new Set(writes.map(operation => operation.store))).toEqual(new Set(['projectHeaders', 'projectNodes']));
      expect(new Set(writes.map(operation => operation.transactionId)).size).toBe(1);
      expect(h.snapshot).not.toHaveBeenCalled();
    } finally { h.dispose(); }
  });

  it('saves metadata alone without reading document payloads or changing AppState', async () => {
    const h = await commandFixture();
    try {
      const before = await h.exportFresh(); h.clearOperations();
      const saving = h.commit({ type: 'update-project-metadata', authority: h.installedProject, editorGeneration: 1, patch: { name: 'Metadata ☕' } });
      void saving.catch(() => {}); await h.admission.flush(); const ack = await saving;
      expect(ack.type).toBe('document-saved'); expect(ack.revision).toBe(1); expect(ack).not.toHaveProperty('projects');
      const after = await h.exportFresh(); expect(after.name).toBe('Metadata ☕'); expect(after.initialState).toEqual(before.initialState);
      expect(h.operations.filter(operation => ['projectNodes', 'projectTemplates', 'projectSources', 'projectVariants'].includes(operation.store))).toEqual([]);
      expect(h.operations.filter(operation => operation.phase === 'write').every(operation => operation.store === 'projectHeaders')).toBe(true);
    } finally { h.dispose(); }
  });

  it('includes the final root record in the atomic pair when only the root pointer changes', async () => {
    const h = await commandFixture();
    try {
      const other = { ...h.installedProject.initialState.nodes.root, id: 'other', title: 'Existing other root' };
      const creating = h.commit({ type: 'save-document-changes', authority: h.installedProject, editorGeneration: 1,
        changes: [{ type: 'put-node', node: other }] });
      void creating.catch(() => {}); await h.admission.flush();
      authority.advanceInstalledProjectAuthorityFromAck(h.installedProject, h.installedProject, await creating);
      h.clearOperations();
      const linking = h.commit({ type: 'save-document-changes', authority: h.installedProject, editorGeneration: 2,
        changes: [{ type: 'set-root', rootId: other.id }], linkedProjectName: { name: other.title } });
      void linking.catch(() => {}); await h.admission.flush(); await linking;
      const writes = h.operations.filter(operation => operation.phase === 'write');
      expect(new Set(writes.map(operation => operation.store))).toEqual(new Set(['projectHeaders', 'projectNodes']));
      expect(new Set(writes.map(operation => operation.transactionId)).size).toBe(1);
      const exported = await h.exportFresh(); expect(exported.name).toBe(other.title); expect(exported.initialState.rootId).toBe(other.id);
    } finally { h.dispose(); }
  });

  it('replaces and removes cloud metadata with exact wrapper-byte accounting', async () => {
    const h = await commandFixture();
    try {
      const first = { projectId: 'cloud-1', lastSyncedCommitId: 'one', retained: { text: '根' } };
      const second = { projectId: 'cloud-2', lastSyncedCommitId: 'two' };
      let generation = 0;
      for (const patch of [{ cloud: first }, { name: 'Preserve cloud' }, { cloud: second }, { cloud: undefined }]) {
        const saving = h.commit({ type: 'update-project-metadata', authority: h.installedProject, editorGeneration: ++generation, patch });
        void saving.catch(() => {}); await h.admission.flush(); const ack = await saving;
        authority.advanceInstalledProjectAuthorityFromAck(h.installedProject, h.installedProject, ack);
        const exported = await h.exportFresh(); const records = await h.readRecords();
        const header = records.projectHeaders.values().next().value!;
        expect(header.counters.projectBaseBytes + records.projectPreferences.values().next().value!.preferenceBytes)
          .toBe(Buffer.byteLength(JSON.stringify(exported)));
        if (generation <= 2) expect(exported.cloud).toEqual(first);
        else if (generation === 3) expect(exported.cloud).toEqual(second);
        else {
          expect(Object.hasOwn(exported, 'cloud')).toBe(false);
          expect([...records.projectExtensions.values()].some(record => record.key[3] === 'cloud')).toBe(false);
        }
      }
    } finally { h.dispose(); }
  });

  it.each(['projectHeaders', 'projectNodes'] as const)('rolls back both root/name records after the %s write fails', async store => {
    const h = await commandFixture(); let fired = false;
    try {
      const before = await h.readRecords();
      h.setFault(point => { if (point.phase === 'after-put' && point.store === store) { fired = true; throw new DOMException('Atomic failure', 'QuotaExceededError'); } });
      const saving = h.commit({ type: 'save-document-changes', authority: h.installedProject, editorGeneration: 1,
        changes: [{ type: 'put-node', node: { ...h.installedProject.initialState.nodes.root, title: 'Not committed' } }],
        linkedProjectName: { name: 'Not committed' } });
      void saving.catch(() => {}); await h.admission.flush().catch(() => {});
      await expect(saving).rejects.toBeDefined(); expect(fired).toBe(true); expect(await h.readRecords()).toEqual(before);
    } finally { h.dispose(); }
  });

  it('rejects a linked name that disagrees with the final root without writes', async () => {
    const h = await commandFixture();
    try {
      const before = await h.readRecords(); h.clearOperations();
      const saving = h.commit({ ...h.doc(1, 'data only'), linkedProjectName: { name: 'Wrong root title' } });
      void saving.catch(() => {}); await h.admission.flush().catch(() => {});
      await expect(saving).rejects.toBeDefined(); expect(await h.readRecords()).toEqual(before);
      expect(h.operations.filter(operation => operation.phase === 'write')).toEqual([]);
    } finally { h.dispose(); }
  });

  it('keeps linked rename, independent metadata and later document work in separate ordered commits', async () => {
    const h = await commandFixture();
    try {
      const root = { ...h.installedProject.initialState.nodes.root, title: 'Linked name' };
      const one = h.commit({ type: 'save-document-changes', authority: h.installedProject, editorGeneration: 1,
        changes: [{ type: 'put-node', node: root }], linkedProjectName: { name: root.title } });
      const two = h.commit({ type: 'update-project-metadata', authority: h.installedProject, editorGeneration: 2, patch: { name: 'Independent name' } });
      const three = h.commit({ type: 'save-document-changes', authority: h.installedProject, editorGeneration: 3,
        changes: [{ type: 'put-node', node: { ...root, data: { label: 'later data' } } }] });
      for (const promise of [one, two, three]) void promise.catch(() => {});
      await h.admission.flush(); expect((await Promise.all([one, two, three])).map(ack => ack.revision)).toEqual([1, 2, 3]);
      const batches = h.requests.flatMap(request => request.type === 'document-batch' ? [request.batch] : []);
      expect(batches.map(batch => batch.metadata?.kind)).toEqual(['linked-root', 'patch', undefined]);
      expect(batches.map(batch => batch.expectedRevision)).toEqual([0, 1, 2]);
      const exported = await h.exportFresh(); expect(exported.name).toBe('Independent name');
      expect(exported.initialState.nodes.root).toMatchObject({ title: root.title, data: { label: 'later data' } });
    } finally { h.dispose(); }
  });

  it('binds metadata contents into committed-attempt identity', async () => {
    const h = await commandFixture();
    try {
      const saving = h.commit({ type: 'update-project-metadata', authority: h.installedProject, editorGeneration: 1, patch: { name: 'Actual name' } });
      void saving.catch(() => {}); await h.admission.flush(); const ack = await saving;
      const request = h.requests[0]; if (request.type !== 'document-batch') throw new Error('Expected metadata document batch');
      expect(await h.repository.inspectCommitAttempt({ lane: 'document', batch: request.batch })).toEqual({ type: 'committed', ack });
      expect(await h.repository.inspectCommitAttempt({ lane: 'document', batch: { ...request.batch, metadata: { kind: 'patch', name: 'Different name' } } }))
        .toMatchObject({ type: 'conflict', reason: 'identity-mismatch' });
    } finally { h.dispose(); }
  });

  it('rolls back a cloud removal after its physical delete', async () => {
    const h = await commandFixture(); let fired = false;
    try {
      const saved = h.commit({ type: 'update-project-metadata', authority: h.installedProject, editorGeneration: 1,
        patch: { cloud: { projectId: 'cloud', lastSyncedCommitId: 'commit' } } });
      void saved.catch(() => {}); await h.admission.flush();
      authority.advanceInstalledProjectAuthorityFromAck(h.installedProject, h.installedProject, await saved);
      const before = await h.readRecords();
      h.setFault(point => { if (point.phase === 'after-delete' && point.store === 'projectExtensions') { fired = true; throw new DOMException('Delete failure', 'QuotaExceededError'); } });
      const removing = h.commit({ type: 'update-project-metadata', authority: h.installedProject, editorGeneration: 2, patch: { cloud: undefined } });
      void removing.catch(() => {}); await h.admission.flush().catch(() => {});
      await expect(removing).rejects.toBeDefined(); expect(fired).toBe(true); expect(await h.readRecords()).toEqual(before);
    } finally { h.dispose(); }
  });

  it.each([
    ['empty', {}], ['missing-name', { name: undefined }], ['numeric-name', { name: 3 }],
    ['null-cloud', { cloud: null }], ['incomplete-cloud', { cloud: { projectId: 'only-one-field' } }],
    ['non-json-cloud', { cloud: { projectId: 'cloud', lastSyncedCommitId: 'commit', retained: new Date() } }],
    ['unknown-field', { revision: 42 }],
  ] as const)('rejects %s metadata without changing any durable record', async (_label, patch) => {
    const h = await commandFixture();
    try {
      const before = await h.readRecords(); h.clearOperations();
      const saving = h.commit({ type: 'update-project-metadata', authority: h.installedProject, editorGeneration: 1,
        patch: patch as unknown as ProjectMetadataCommand['patch'] });
      void saving.catch(() => {}); await h.admission.flush().catch(() => {});
      await expect(saving).rejects.toBeDefined();
      expect(h.operations.filter(operation => operation.phase === 'write')).toEqual([]);
      expect(await h.readRecords()).toEqual(before);
    } finally { h.dispose(); }
  });

  it('refuses metadata acknowledgement when independent readback is corrupted', async () => {
    const h = await commandFixture(); let fired = false;
    try {
      h.setReadResult((operation, value) => {
        if (operation.phase === 'verify-read' && operation.store === 'projectHeaders' && value) {
          fired = true; const changed = structuredClone(value) as { value: { name: string } };
          changed.value.name = 'Corrupt readback'; return changed;
        }
        return value;
      });
      const saving = h.commit({ type: 'update-project-metadata', authority: h.installedProject, editorGeneration: 1, patch: { name: 'Durable name' } });
      void saving.catch(() => {}); await h.admission.flush().catch(() => {});
      await expect(saving).rejects.toBeDefined(); expect(fired).toBe(true);
      h.setReadResult(); expect((await h.exportFresh()).name).toBe('Durable name');
    } finally { h.dispose(); }
  });

  it('rejects a discriminator accessor without evaluating it', async () => {
    const { createWorkspaceCommandDispatcher } = await commandModules();
    const snapshot = vi.fn(async () => ({ projects: [], activeProjectId: '', customPresets: [], pendingImports: [] }));
    const commit = createWorkspaceCommandDispatcher({ snapshot });
    const getter = vi.fn(() => 'activate-project');
    const command = Object.defineProperty({ projectId: 'p' }, 'type', { enumerable: true, get: getter });
    await expect(commit(command as import('../../../../services/localWorkspace/contracts').WorkspaceCommand)).rejects.toMatchObject({ code: 'validation' });
    expect(getter).not.toHaveBeenCalled(); expect(snapshot).not.toHaveBeenCalled();
  });

  it('rejects unknown command names before snapshot dispatch', async () => {
    const { createWorkspaceCommandDispatcher } = await commandModules();
    const snapshot = vi.fn(async () => ({ projects: [], activeProjectId: '', customPresets: [], pendingImports: [] }));
    const commit = createWorkspaceCommandDispatcher({ snapshot });
    await expect(commit({ type: 'unknown-command' } as unknown as import('../../../../services/localWorkspace/contracts').WorkspaceCommand))
      .rejects.toMatchObject({ code: 'validation' });
    expect(snapshot).not.toHaveBeenCalled();
  });

  it.each(['structural', 'folds'] as const)('rejects malformed optional %s framing rather than dropping it', async field => {
    const h = await commandFixture();
    try {
      const command = field === 'structural' ? h.doc(1, 'not saved')
        : { type: 'save-editor-preferences' as const, authority: h.installedProject, editorGeneration: 1, patch: { scale: 2 } };
      Reflect.set(command, field, null);
      const saving = h.commit(command); void saving.catch(() => {});
      await h.admission.flush().catch(() => {});
      await expect(saving).rejects.toMatchObject({ code: 'validation' }); expect(h.requests).toEqual([]);
    } finally { h.dispose(); }
  });

  it('captures command framing before suspension and never inspects the authority payload', async () => {
    const h = await commandFixture();
    try {
      const command = h.doc(1, 'captured');
      const replacement = { ...h.installedProject };
      const trap = vi.fn(() => { throw new Error('Authority payload inspected'); });
      Object.defineProperty(h.installedProject, 'initialState', { get: trap });
      const saving = h.commit(command); void saving.catch(() => {});
      command.authority = replacement; command.editorGeneration = 99; command.changes = [];
      await h.admission.flush(); expect((await saving).editorGeneration).toBe(1);
      expect(trap).not.toHaveBeenCalled(); expect((await h.exportFresh()).initialState.nodes.root.data.label).toBe('captured');
    } finally { h.dispose(); }
  });

  it('updates the revision fence before acknowledgement observers reenter admission', async () => {
    let reenter: (() => void) | undefined; let stale: Promise<DocumentSaveAck> | undefined;
    const h = await commandFixture(event => { if (event.type === 'acknowledged') reenter?.(); });
    try {
      reenter = () => { stale = h.commit(h.doc(2, 'stale')); void stale.catch(() => {}); };
      const saving = h.commit(h.doc(1, 'first')); void saving.catch(() => {});
      await h.admission.flush(); await saving;
      expect(stale).toBeDefined(); await expect(stale).rejects.toMatchObject({ code: 'conflict' });
      expect(h.requests).toHaveLength(1);
    } finally { h.dispose(); }
  });

  it('refuses obsolete completion after durable commit without pretending the write rolled back', async () => {
    let invalidate: (() => void) | undefined;
    const h = await commandFixture(event => { if (event.type === 'acknowledged') invalidate?.(); });
    try {
      invalidate = h.invalidate;
      const saving = h.commit(h.doc(1, 'durable before authority loss')); void saving.catch(() => {});
      await h.admission.flush(); await expect(saving).rejects.toMatchObject({ code: 'authority-lost' });
      expect((await h.exportFresh()).initialState.nodes.root.data.label).toBe('durable before authority loss');
    } finally { h.dispose(); }
  });

  it('does not publish a receipt onto a project wrapper whose id changed in flight', async () => {
    const h = await commandFixture();
    try {
      const saving = h.commit(h.doc(1, 'old project committed')); void saving.catch(() => {});
      h.installedProject.id = 'replacement-id';
      await h.admission.flush(); await expect(saving).rejects.toMatchObject({ code: 'authority-lost' });
      expect((await h.exportFresh()).initialState.nodes.root.data.label).toBe('old project committed');
    } finally { h.dispose(); }
  });

  it.each(['generation-floor', 'storage-generation'] as const)('fences same-object %s changes during acknowledgement publication', async kind => {
    let change: (() => void) | undefined;
    const h = await commandFixture(event => { if (event.type === 'acknowledged') change?.(); });
    try {
      change = () => h.mutateInstallation(kind);
      const saving = h.commit(h.doc(1, 'durable old context')); void saving.catch(() => {});
      await h.admission.flush(); await expect(saving).rejects.toMatchObject({ code: 'authority-lost' });
      expect((await h.exportFresh()).initialState.nodes.root.data.label).toBe('durable old context');
    } finally { h.dispose(); }
  });

  it('never falls back to snapshot handlers for an uninstalled incremental lane', async () => {
    const { createWorkspaceCommandDispatcher } = await commandModules();
    const result = { projects: [], activeProjectId: '', customPresets: [], pendingImports: [] };
    const snapshot = vi.fn(async () => result); const commit = createWorkspaceCommandDispatcher({ snapshot });
    expect(await commit({ type: 'activate-project', projectId: 'p' })).toBe(result);
    const project = makeIncrementalProject();
    await expect(commit({ type: 'save-document-changes', authority: project, editorGeneration: 1, changes: [] })).rejects.toMatchObject({ code: 'authority-lost' });
    await expect(commit({ type: 'save-editor-preferences', authority: project, editorGeneration: 1, patch: { scale: 2 } })).rejects.toMatchObject({ code: 'authority-lost' });
    await expect(commit({ type: 'update-project-metadata', authority: project, editorGeneration: 1, patch: { name: 'new' } })).rejects.toMatchObject({ code: 'authority-lost' });
    expect(snapshot).toHaveBeenCalledTimes(1);
  });

  it('dispatches real document and preference saves without transferring the authority object', async () => {
    const h = await commandFixture();
    try {
      const saving = h.commit(h.doc(1, 'committed')); void saving.catch(() => {});
      await h.admission.flush(); const ack = await saving;
      expect(ack.type).toBe('document-saved'); expect(ack).not.toHaveProperty('projects');
      authority.advanceInstalledProjectAuthorityFromAck(h.installedProject, h.installedProject, ack);
      const preferences = h.commit({ type: 'save-editor-preferences', authority: h.installedProject, editorGeneration: 2, patch: { scale: 2 } });
      void preferences.catch(() => {}); await h.admission.flush();
      expect((await preferences).type).toBe('preferences-saved');
      const exported = await h.exportFresh();
      expect(exported.initialState.nodes.root.data.label).toBe('committed'); expect(exported.initialState.scale).toBe(2);
      expect(h.snapshot).not.toHaveBeenCalled(); expect(h.requests).toHaveLength(2);
      expect(JSON.stringify(h.requests)).not.toContain('initialState');
      for (const request of h.requests) expect(request).not.toHaveProperty('authority');
    } finally { h.dispose(); }
  });

  it('rejects copied or stale authority before queueing another write', async () => {
    const h = await commandFixture();
    try {
      await expect(h.commit(h.doc(1, 'forged', { ...h.installedProject }))).rejects.toMatchObject({ code: 'conflict' });
      expect(h.requests).toEqual([]);
      const saving = h.commit(h.doc(1, 'first')); void saving.catch(() => {});
      await h.admission.flush(); await saving;
      await expect(h.commit(h.doc(2, 'stale'))).rejects.toMatchObject({ code: 'conflict' });
      expect(h.requests).toHaveLength(1);
    } finally { h.dispose(); }
  });

  it('accepts coalesced waiters without advancing publication twice', async () => {
    const h = await commandFixture();
    try {
      const first = h.commit(h.doc(1, 'one')); const second = h.commit(h.doc(2, 'two'));
      void first.catch(() => {}); void second.catch(() => {});
      await h.admission.flush(); const [a, b] = await Promise.all([first, second]);
      expect(a).toBe(b); expect(b.editorGeneration).toBe(2); expect(b.revision).toBe(1);
      authority.advanceInstalledProjectAuthorityFromAck(h.installedProject, h.installedProject, b);
      const third = h.commit(h.doc(3, 'three')); void third.catch(() => {});
      await h.admission.flush(); expect((await third).revision).toBe(2);
      expect(h.requests).toHaveLength(2);
    } finally { h.dispose(); }
  });

  it('does not send a queued command after its installation is removed', async () => {
    const h = await commandFixture();
    try {
      const saving = h.commit(h.doc(1, 'not persisted')); void saving.catch(() => {});
      h.invalidate();
      await h.admission.flush().catch(() => {});
      await expect(saving).rejects.toMatchObject({ code: 'authority-lost' });
      expect(h.requests).toEqual([]);
    } finally { h.dispose(); }
  });
});

function pendingSave() {
  const submitted = makeIncrementalProject(2);
  const token = authority.registerInstalledProjectAuthority(submitted, { incarnation: 'installed', revision: 7 });
  const target = { ...submitted, name: 'Newer unsaved name', initialState: { ...submitted.initialState, scale: 1.5 } };
  authority.inheritInstalledProjectAuthority(target, submitted);
  const ack: DocumentSaveAck = { type: 'document-saved', projectId: submitted.id, incarnation: 'installed',
    commitId: 'verified-commit', editorGeneration: 3, foldStructureGeneration: 0, revision: 8 };
  return { submitted, target, token, ack };
}

// Queue/facade must validate commit ID and editor generation against the actual
// submission before calling this helper. These tests exercise lineage publication,
// not receipt authenticity, durable writes, or saved/dirty UI generations.
describe('Task12 small acknowledgement authority', () => {
  it('uses a real queue acknowledgement to advance pending authority without replacing newer data', async () => {
    const worker = await createIncrementalWorkerHarness(makeIncrementalProject(20));
    const binding = worker.responses.find(response => response.response.type === 'bootstrapped')!.response;
    if (binding.type !== 'bootstrapped') throw new Error('Real worker bootstrap required');
    const installed = await worker.exportFresh();
    const token = authority.registerInstalledProjectAuthority(installed,
      { incarnation: binding.scope.incarnation, revision: binding.authority.documentRevision });
    const pending = { ...installed, initialState: { ...installed.initialState, nodes: { ...installed.initialState.nodes,
      root: { ...installed.initialState.nodes.root, data: { label: 'Newer unsaved data' } } } } };
    authority.inheritInstalledProjectAuthority(pending, installed);
    const installation: InstalledQueueAuthority = { source: token, transport: worker.client, binding, editorGenerationFloor: 0 };
    let sequence = 0;
    const queue = createIncrementalQueue({ transport: worker.client,
      clock: { now: () => Date.now(), setTimeout: (callback, delay) => setTimeout(callback, delay),
        clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
      uuid: () => `ack-authority-${++sequence}`,
      resolveAuthority: projectId => projectId === installed.id ? installation : undefined,
      onEvent() {},
    });
    const start = worker.messages.length;
    try {
      const saving = queue.enqueueDocument(installed.id, 1, { source: token, changes: [
        { type: 'put-node', node: { ...installed.initialState.nodes.root, data: { label: 'Committed data' } } },
      ] });
      void saving.catch(() => {});
      await queue.flush(installed.id); const ack = await saving;
      authority.advanceInstalledProjectAuthorityFromAck(pending, installed, ack);
      expect(authority.getInstalledProjectAuthorityLineage(pending)).toEqual({ incarnation: binding.scope.incarnation, revision: 1 });
      expect(pending.initialState.nodes.root.data.label).toBe('Newer unsaved data');
      expect((await worker.exportFresh()).initialState.nodes.root.data.label).toBe('Committed data');
      expect(ack).not.toHaveProperty('projects'); expect(ack).not.toHaveProperty('initialState');
      const requests = worker.messages.slice(start).map(message => message.request);
      expect(requests).toHaveLength(1); expect(requests[0].type).toBe('document-batch');
      expect(requests[0]).not.toHaveProperty('authority');
      expect(JSON.stringify(requests)).not.toContain('initialState');
    } finally { queue.dispose(); worker.client.dispose(); }
  });

  it('advances a compatible working wrapper without cloning or replacing newer content', () => {
    expect(authority.advanceInstalledProjectAuthorityFromAck).toBeTypeOf('function');
    const h = pendingSave(); const state = h.target.initialState;
    const unrelated = makeIncrementalProject(1); unrelated.id = 'unrelated';
    const otherToken = authority.registerInstalledProjectAuthority(unrelated, { incarnation: 'other', revision: 20 });
    const clone = vi.spyOn(globalThis, 'structuredClone');
    authority.advanceInstalledProjectAuthorityFromAck(h.target, h.submitted, h.ack);
    expect(authority.getInstalledProjectAuthorityLineage(h.target)).toEqual({ incarnation: 'installed', revision: 8 });
    expect(authority.getInstalledProjectAuthorityToken(h.target)).toBe(h.token);
    expect(h.target.initialState).toBe(state); expect(h.target.name).toBe('Newer unsaved name');
    expect(authority.getInstalledProjectAuthorityLineage(h.submitted)?.revision).toBe(7);
    expect(authority.getInstalledProjectAuthorityToken(unrelated)).toBe(otherToken);
    expect(authority.getInstalledProjectAuthorityLineage(unrelated)?.revision).toBe(20);
    expect(clone).not.toHaveBeenCalled();
  });

  it.each(['target', 'submitted', 'both'] as const)('cannot mint authority when %s is uninstalled', missing => {
    const h = pendingSave();
    const target = missing !== 'submitted' ? { ...h.target } : h.target;
    const submitted = missing !== 'target' ? { ...h.submitted } : h.submitted;
    const lineage = authority.getInstalledProjectAuthorityLineage(target);
    const before = lineage && { ...lineage };
    const token = authority.getInstalledProjectAuthorityToken(target);
    authority.advanceInstalledProjectAuthorityFromAck(target, submitted, h.ack);
    expect(authority.getInstalledProjectAuthorityLineage(target)).toEqual(before);
    expect(authority.getInstalledProjectAuthorityToken(target)).toBe(token);
  });

  it.each(['foreign-token', 'foreign-incarnation', 'behind', 'already-advanced', 'wrong-target-id'] as const)
  ('does not retag %s working authority', kind => {
    const h = pendingSave();
    if (kind === 'foreign-token') authority.registerInstalledProjectAuthority(h.target, { incarnation: 'installed', revision: 7 });
    if (kind === 'foreign-incarnation') authority.registerInstalledProjectAuthority(h.target, { incarnation: 'replacement', revision: 7 }, h.token);
    if (kind === 'behind' || kind === 'already-advanced') authority.registerInstalledProjectAuthority(h.target,
      { incarnation: 'installed', revision: kind === 'behind' ? 6 : 8 }, h.token);
    if (kind === 'wrong-target-id') h.target.id = 'same-token-wrong-project';
    const before = { ...authority.getInstalledProjectAuthorityLineage(h.target)! };
    const token = authority.getInstalledProjectAuthorityToken(h.target);
    authority.advanceInstalledProjectAuthorityFromAck(h.target, h.submitted, h.ack);
    expect(authority.getInstalledProjectAuthorityLineage(h.target)).toEqual(before);
    expect(authority.getInstalledProjectAuthorityToken(h.target)).toBe(token);
  });

  it.each([
    ['wrong-project', { projectId: 'another-project' }],
    ['wrong-incarnation', { incarnation: 'replacement' }],
    ['stale-revision', { revision: 7 }],
    ['skipped-revision', { revision: 9 }],
    ['fractional-revision', { revision: 8.5 }],
    ['unsafe-revision', { revision: Number.MAX_SAFE_INTEGER + 1 }],
    ['invalid-generation', { editorGeneration: -1 }],
    ['invalid-fold-generation', { foldStructureGeneration: NaN }],
    ['empty-commit-id', { commitId: '' }],
    ['wrong-lane', { type: 'preferences-saved' }],
  ] as const)('ignores a %s acknowledgement', (_name, patch) => {
    const h = pendingSave();
    authority.advanceInstalledProjectAuthorityFromAck(h.target, h.submitted, { ...h.ack, ...patch } as DocumentSaveAck);
    expect(authority.getInstalledProjectAuthorityLineage(h.target)).toEqual({ incarnation: 'installed', revision: 7 });
    expect(authority.getInstalledProjectAuthorityToken(h.target)).toBe(h.token);
  });

  it('does not advance twice on replay or follow a later receipt from an older submission', () => {
    const h = pendingSave();
    authority.advanceInstalledProjectAuthorityFromAck(h.target, h.submitted, h.ack);
    authority.advanceInstalledProjectAuthorityFromAck(h.target, h.submitted, h.ack);
    authority.advanceInstalledProjectAuthorityFromAck(h.target, h.submitted, { ...h.ack, revision: 9 });
    expect(authority.getInstalledProjectAuthorityLineage(h.target)?.revision).toBe(8);
  });

  it('supports the submitted wrapper itself and refuses counter exhaustion', () => {
    const h = pendingSave();
    authority.advanceInstalledProjectAuthorityFromAck(h.submitted, h.submitted, h.ack);
    expect(authority.getInstalledProjectAuthorityLineage(h.submitted)?.revision).toBe(8);
    authority.registerInstalledProjectAuthority(h.submitted, { incarnation: 'installed', revision: Number.MAX_SAFE_INTEGER }, h.token);
    authority.advanceInstalledProjectAuthorityFromAck(h.submitted, h.submitted, { ...h.ack, revision: Number.MAX_SAFE_INTEGER + 1 });
    expect(authority.getInstalledProjectAuthorityLineage(h.submitted)?.revision).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('does not inspect a document payload while advancing installed lineage', () => {
    const h = pendingSave(); const payload = vi.fn(() => { throw new Error('Whole document was accessed'); });
    Object.defineProperty(h.target, 'initialState', { get: payload });
    Object.defineProperty(h.submitted, 'initialState', { get: payload });
    authority.advanceInstalledProjectAuthorityFromAck(h.target, h.submitted, h.ack);
    expect(payload).not.toHaveBeenCalled();
    expect(authority.getInstalledProjectAuthorityLineage(h.target)?.revision).toBe(8);
  });

  it.each([-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('does not advance an invalid installed counter %s', revision => {
    const h = pendingSave();
    authority.registerInstalledProjectAuthority(h.submitted, { incarnation: 'installed', revision }, h.token);
    authority.inheritInstalledProjectAuthority(h.target, h.submitted);
    authority.advanceInstalledProjectAuthorityFromAck(h.target, h.submitted, { ...h.ack, revision: revision + 1 });
    expect(authority.getInstalledProjectAuthorityLineage(h.target)?.revision).toBe(revision);
  });
});
