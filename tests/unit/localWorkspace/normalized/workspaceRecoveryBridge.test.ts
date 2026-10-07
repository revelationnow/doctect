// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createWorkspaceLifecycleHarness } from '../../../helpers/workspaceCommandHarness';
import { LEGACY_KEYS, MemoryStorage } from '../../../helpers/localWorkspaceFixtures';
import { physicalRows } from '../../../helpers/normalizationHarness';

const modules = import.meta.glob<typeof import('../../../../services/localWorkspace/workspaceRecoveryAdmission')>('../../../../services/localWorkspace/workspaceRecoveryAdmission.ts');
let h: Awaited<ReturnType<typeof createWorkspaceLifecycleHarness>>;
beforeEach(async () => { h = await createWorkspaceLifecycleHarness(); });
afterEach(() => h?.dispose());
async function bridge() {
  expect(Object.keys(modules), 'private source admission bridge').toHaveLength(1);
  const { createWorkspaceRecoveryAdmission } = await Object.values(modules)[0]();
  return createWorkspaceRecoveryAdmission({ workspace: h.lifecycle, legacyStorage: h.legacyStorage,
    generation: () => 0, assertCurrent() {}, subtle: h.preparation.crypto.subtle, signal: new AbortController().signal });
}
function drift(title: string) {
  const changed = structuredClone(h.a); changed.initialState.nodes.root.title = title;
  h.legacyStorage.setItem(LEGACY_KEYS.projects, JSON.stringify([changed, h.b]));
}
it('captures browser-only legacy source and commits copies through the real worker and workspace cut', async () => {
  const recovery = await bridge(); drift('Recovered source');
  const { authority, project } = await h.install(h.binding.catalog.members[0]);
  const capability = await recovery.prepare('drift-1');
  const result = await recovery.commit(capability);
  expect(result.outcome).toBe('recovered'); expect(h.published).toHaveLength(1);
  expect(h.installed.get(project.id)).toBe(authority); expect(h.working.get(project.id)).toBe(project);
  expect(h.lifecycle.catalog().members).toHaveLength(3);
  expect(h.messages.filter(message => message.request.type === 'workspace-recovery-prepare')).toHaveLength(1);
  expect(h.messages.filter(message => message.request.type === 'workspace-recovery-commit')).toHaveLength(1);
  expect((await h.run()).status).toBe('active');
});
it('changed source after confirmation cannot post a recovery mutation', async () => {
  const recovery = await bridge(); drift('First source'); const capability = await recovery.prepare('drift-1');
  const before = await physicalRows(h, ['workspace', 'legacyBackup', 'projectHeaders']); drift('Changed before commit');
  await expect(recovery.commit(capability)).rejects.toThrow();
  expect(h.messages.filter(message => message.request.type === 'workspace-recovery-commit')).toHaveLength(0);
  expect(await physicalRows(h, ['workspace', 'legacyBackup', 'projectHeaders'])).toEqual(before);
});
it('a forged recovery capability cannot read or post a source', async () => {
  const recovery = await bridge(); const count = h.messages.length;
  await expect(recovery.commit({} as never)).rejects.toThrow(); expect(h.messages).toHaveLength(count);
});

it('recaptures source after worker preparation, immediately before posting the mutation', async () => {
  const recovery = await bridge(); drift('Confirmed'); const capability = await recovery.prepare('drift-1');
  const before = await physicalRows(h, ['workspace', 'legacyBackup', 'projectHeaders']);
  h.workers.at(-1)!.transform = response => { if (response.response.type === 'workspace-recovery-prepared') drift('Late drift'); return response; };
  await expect(recovery.commit(capability)).rejects.toThrow();
  expect(h.messages.filter(message => message.request.type === 'workspace-recovery-commit')).toHaveLength(0);
  expect(await physicalRows(h, ['workspace', 'legacyBackup', 'projectHeaders'])).toEqual(before);
});

it('source drift after durable commit is new recovery work, not rollback of the acknowledged copies', async () => {
  const recovery = await bridge(); drift('Confirmed'); const capability = await recovery.prepare('drift-1');
  h.workers.at(-1)!.transform = response => { if (response.context.requestType === 'workspace-recovery-commit') drift('New drift'); return response; };
  await expect(recovery.commit(capability)).resolves.toMatchObject({ outcome: 'recovered' });
  await expect(recovery.commit(capability)).rejects.toThrow();
  expect(h.lifecycle.catalog().members).toHaveLength(3); expect((await h.run()).status).toBe('recovery');
  h.workers.at(-1)!.transform = response => response;
  const next = await recovery.prepare('drift-2');
  await expect(recovery.commit(next)).resolves.toMatchObject({ outcome: 'recovered' });
  expect(h.lifecycle.catalog().members).toHaveLength(4); expect((await h.run()).status).toBe('active');
});

it('lost committed recovery reply inspects after restart and publishes once without duplicating copies', async () => {
  const recovery = await bridge(); drift('Confirmed'); const capability = await recovery.prepare('drift-1');
  h.workers.at(-1)!.transform = response => response.context.requestType === 'workspace-recovery-commit' ? { ...response, workerEpoch: response.workerEpoch + 1 } : response;
  const completion = recovery.commit(capability); await expect(completion).rejects.toThrow();
  expect(h.published).toHaveLength(0);
  const resumed = await h.restart(); await resumed.resume();
  expect(h.published).toHaveLength(1); expect(h.lifecycle.catalog().members).toHaveLength(3);
  expect(h.messages.filter(message => message.request.type === 'workspace-recovery-commit')).toHaveLength(1);
  await expect(completion).rejects.toThrow();
});

it('rejects changed recovered material metadata before catalog publication', async () => {
  const recovery = await bridge(); drift('Confirmed'); const capability = await recovery.prepare('drift-1');
  h.workers.at(-1)!.transform = response => {
    if (response.response.type === 'workspace-command-result' && response.response.result.outcome === 'recovered') {
      response.response.result.projects[0].authority.documentRevision = 99;
    }
    return response;
  };
  await expect(recovery.commit(capability)).rejects.toThrow(); expect(h.published).toHaveLength(0);
});

it('final raw read cannot revoke the source lifecycle and still post a mutation', async () => {
  expect(Object.keys(modules)).toHaveLength(1); const { createWorkspaceRecoveryAdmission } = await Object.values(modules)[0]();
  const changed = structuredClone(h.a); changed.name = 'Changed'; let armed = false, current = true, reads = 0;
  const controller = new AbortController();
  const storage = new MemoryStorage({ [LEGACY_KEYS.projects]: JSON.stringify([changed, h.b]), [LEGACY_KEYS.activeProject]: h.a.id }, () => {
    if (armed && ++reads === 8) { current = false; controller.abort(); }
  });
  const recovery = createWorkspaceRecoveryAdmission({ workspace: h.lifecycle, legacyStorage: storage,
    generation: () => 0, signal: controller.signal, assertCurrent() { if (!current) throw Error('Source owner revoked'); } });
  const capability = await recovery.prepare('drift-1');
  h.workers.at(-1)!.transform = response => { if (response.response.type === 'workspace-recovery-prepared') armed = true; return response; };
  await expect(recovery.commit(capability)).rejects.toThrow();
  expect(h.messages.filter(message => message.request.type === 'workspace-recovery-commit')).toHaveLength(0);
});

it('never calls a source-mutating lifecycle observer after its final raw captures', async () => {
  expect(Object.keys(modules)).toHaveLength(1); const { createWorkspaceRecoveryAdmission } = await Object.values(modules)[0]();
  const changed = { ...h.a, name: 'Confirmed' }, raw = JSON.stringify([changed, h.b]);
  let armed = false, reads = 0, lateCallbacks = 0;
  const storage = new MemoryStorage({ [LEGACY_KEYS.projects]: raw, [LEGACY_KEYS.activeProject]: h.a.id }, () => { if (armed) reads++; });
  const recovery = createWorkspaceRecoveryAdmission({ workspace: h.lifecycle, legacyStorage: storage, generation: () => 0,
    signal: new AbortController().signal, assertCurrent() {
      if (armed && reads >= 8) { lateCallbacks++; storage.setItem(LEGACY_KEYS.projects, JSON.stringify([{ ...changed, name: 'Unconfirmed' }, h.b])); }
    } });
  const capability = await recovery.prepare('drift-1');
  h.workers.at(-1)!.transform = response => { if (response.response.type === 'workspace-recovery-prepared') armed = true; return response; };
  await expect(recovery.commit(capability)).resolves.toMatchObject({ outcome: 'recovered' });
  expect(lateCallbacks).toBe(0); expect(storage.getItem(LEGACY_KEYS.projects)).toBe(raw);
});

it('discards prepared worker custody if ownership changes while its reply returns', async () => {
  const recovery = await bridge(); drift('Confirmed'); const capability = await recovery.prepare('drift-1');
  h.workers.at(-1)!.transform = response => { if (response.response.type === 'workspace-recovery-prepared') h.setCurrent(false); return response; };
  await expect(recovery.commit(capability)).rejects.toThrow();
  expect(h.messages.filter(message => message.request.type === 'workspace-recovery-discard')).toHaveLength(1);
  expect(h.messages.filter(message => message.request.type === 'workspace-recovery-commit')).toHaveLength(0);
});

it('drains earlier edits and retains later edits behind recovery without replacing the installed owner', async () => {
  const recovery = await bridge(); drift('Confirmed');
  const scope = h.binding.catalog.members[0], { project, authority } = await h.install(scope);
  h.lifecycle.registerEditor(scope, authority.source, { generation: () => 1, drainThrough: async () => true });
  const capability = await recovery.prepare('drift-1');
  const early = h.incremental.document({ type: 'save-document-changes', authority: project, editorGeneration: 1,
    changes: [{ type: 'put-node', node: { ...project.initialState.nodes.root, title: 'Before recovery' } }] });
  const recovering = recovery.commit(capability);
  const late = h.lifecycle.persistEditor(scope, authority.source, 2, () => h.incremental.document({ type: 'save-document-changes', authority: project, editorGeneration: 2,
    changes: [{ type: 'put-node', node: { ...project.initialState.nodes.root, title: 'After recovery' } }] }).then(() => true));
  await early; await recovering; await h.incremental.flush(); expect(await late).toBe(true);
  expect(h.installed.get(project.id)).toBe(authority); expect(h.working.get(project.id)).toBe(project);
  const requests = h.messages.map(message => message.request.type);
  expect(requests.indexOf('document-batch')).toBeLessThan(requests.indexOf('workspace-recovery-prepare'));
  expect(requests.lastIndexOf('document-batch')).toBeGreaterThan(requests.indexOf('workspace-recovery-commit'));
  expect((await h.repository.exportProjectForRecovery(scope)).project.initialState.nodes.root.title).toBe('After recovery');
});
