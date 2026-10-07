// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createNormalizationHarness } from '../../../helpers/normalizationHarness';
import { createWorkspaceWorkerHandler } from '../../../../services/localWorkspace/normalized/coordinator';
import type { WorkspaceWorkerPort } from '../../../../services/localWorkspace/workspaceWorkerClient';
import { LEGACY_KEYS } from '../../../helpers/localWorkspaceFixtures';
const modules = import.meta.glob<typeof import('../../../../services/localWorkspace/NormalizedWorkspaceStore')>('../../../../services/localWorkspace/NormalizedWorkspaceStore.ts');
let h: Awaited<ReturnType<typeof createNormalizationHarness>>, store: any, module: Awaited<ReturnType<typeof create>>, initial: any;
const handlers: ReturnType<typeof createWorkspaceWorkerHandler>[] = [];
let onReply: ((value: any) => void) | undefined, legacyChanged: ((event: StorageEvent) => void) | undefined, failPost = false, confirmed: any;
let requests: string[] = [];
beforeEach(async context => {
  requests = []; onReply = undefined; failPost = false; h = await createNormalizationHarness(); module = await create(); initial = await store.bootstrap();
  if (context.task.name.startsWith('a recovery confirmation')) { drift('Confirmed version'); confirmed = await store.bootstrap(); }
});
afterEach(() => { store?.dispose(); handlers.splice(0).forEach(value => value.dispose()); h?.adapter.close(); });
async function create() {
  expect(Object.keys(modules), 'normal app normalized store').toHaveLength(1);
  const m = await Object.values(modules)[0]();
  const workerFactory = (): WorkspaceWorkerPort => {
    const handler = createWorkspaceWorkerHandler(h.environment); handlers.push(handler);
    const listeners = new Map<string, Set<(event: any) => void>>();
    return { postMessage(input) { if (failPost) throw Error('Startup worker failed'); requests.push(input.request.type === 'normalization-step' ? input.request.operation : input.request.type); void handler.handle(structuredClone(input)).then(data => {
      onReply?.(data.response);
      for (const fn of listeners.get('message') ?? []) fn({ data: structuredClone(data) });
    }, error => { for (const fn of listeners.get('error') ?? []) fn({ error }); }); },
    addEventListener(type, fn) { const set = listeners.get(type) ?? new Set(); set.add(fn); listeners.set(type, set); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); }, terminate() { handler.dispose(); } };
  };
  let uuid = 0;
  store = m.createNormalizedWorkspaceStore({ ...h.preparation, randomUUID: () => `normal-app-${++uuid}`, indexedDB: h.indexedDB, legacyStorage: h.legacyStorage,
    addStorageListener: listener => { legacyChanged = listener; return () => {}; } }, { workerFactory });
  return m;
}
it('normal bootstrap installs genuine project bindings and rejects whole-project autosave before payload access', async () => {
  const m = module, result = initial; expect(result.status).toBe('ready');
  const editing = m.getNormalizedWorkspaceSession(store); expect(editing).toBeDefined();
  expect(editing!.getSnapshot().workspace.projects.map(value => value.id)).toEqual(result.snapshot.projects.map(value => value.id));
  const authority = editing!.project(result.snapshot.projects[0].id);
  await expect(store.commit({ type: 'save-project', get project() { throw Error('payload read'); } })).rejects.toThrow('Whole-project');
  const saved = store.commit({ type: 'save-document-changes', authority, editorGeneration: 1,
    changes: [{ type: 'put-node', node: { ...authority.initialState.nodes.root, title: 'Incremental normal editor' } }] });
  void saved.catch(() => {});
  try { await editing!.flush(); expect((await saved).revision).toBe(1); }
  catch (error) { throw Error(`Changed-record save failed: ${JSON.stringify(error)}`); }
  expect((await h.exportActive()).projects[0].initialState.nodes.root.title).toBe('Incremental normal editor');
});

it('opens snapshot and editing admissions in one coupled worker read instead of rereading each project', () => {
  expect(initial.status).toBe('ready');
  expect(requests.filter(type => type === 'workspace-bootstrap' || type === 'open-project')).toEqual([]);
  expect(requests.filter(type => type === 'editor')).toHaveLength(1);
  const editing = module.getNormalizedWorkspaceSession(store)!;
  expect(editing.getSnapshot().workspace.projects.map(project => project.id)).toEqual(initial.snapshot.projects.map((project: any) => project.id));
});

function drift(name: string) {
  const project = { ...h.prepared.projects[0].project, name };
  h.legacyStorage.setItem(LEGACY_KEYS.projects, JSON.stringify([project])); legacyChanged?.({ key: LEGACY_KEYS.projects } as StorageEvent);
}
it('does not publish ready when legacy source changes during project admission', async () => {
  store.dispose(); module = await create();
  let changed = false;
  onReply = response => { if (response.type === 'project-opened' || response.type === 'normalization-result' && response.operation === 'editor') {
    onReply = undefined; changed = true; drift('Newer legacy');
  } };
  const result = await store.bootstrap(); expect(result.status).not.toBe('ready');
  expect(changed).toBe(true);
});
it('startup transport failure gets a fresh worker on explicit retry', async () => {
  store.dispose(); module = await create(); failPost = true;
  expect((await store.bootstrap()).status).not.toBe('ready');
  failPost = false; expect((await store.bootstrap()).status).toBe('ready');
});
it('a recovery confirmation cannot follow a newer source across its asynchronous reads', async () => {
  const recovery = confirmed;
  expect(recovery.status).toBe('recovery'); expect(recovery.recovery.canRecoverLegacyAsCopies).toBe(true);
  let writes = 0; h.environment.onWorkspaceOperation = operation => { if (operation.phase === 'write') writes++; };
  onReply = response => { if (response.type === 'normalization-result' && response.operation === 'active') {
    onReply = undefined; drift('Unconfirmed newer version');
  } };
  await expect(store.commit({ type: 'recover-legacy-as-copies', recoveryId: recovery.recovery.recoveryId })).rejects.toBeDefined();
  expect(writes).toBe(0);
});
it('normal store lifecycle commands use normalized authority and admit new editor projects', async () => {
  const editing = module.getNormalizedWorkspaceSession(store)!;
  const original = editing.getSnapshot().workspace.projects[0];
  await editing.commitStructural({ type: 'create-and-activate-project', project: { ...original, id: 'created' } });
  expect(editing.getSnapshot().workspace.activeProjectId).toBe('created');
  expect(editing.bindingFor('created').source).not.toBe(editing.bindingFor(original.id).source);
  await editing.commitStructural({ type: 'close-project', projectId: 'created' }, editing.getSnapshot().authorityEpochs.get('created'));
  expect(editing.getSnapshot().workspace.projects.some(value => value.id === 'created')).toBe(false);
});
