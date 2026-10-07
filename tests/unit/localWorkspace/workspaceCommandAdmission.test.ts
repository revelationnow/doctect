// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceLifecycleHarness } from '../../helpers/workspaceCommandHarness';
import { makeIncrementalProject } from '../../helpers/incrementalFixtures';
import type { WorkspaceLifecycleCommand } from '../../../services/localWorkspace/contracts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

async function instrumentOwner() {
  const { build } = await import('esbuild');
  const path = resolve('services/localWorkspace/workspaceCommandAdmission.ts'), source = readFileSync(path, 'utf8');
  const marker = 'const retained = new WeakMap<RetainedWorkspaceWork, RetainedState>();';
  expect(source.split(marker)).toHaveLength(2);
  const result = await build({ stdin: { contents: source.replace(marker, `${marker}\nexport const inspectRetainedForTest = handle => retained.get(handle);
export { createProjectInstallationRegistry as registryForTest } from './projectInstallationRegistry';`),
    loader: 'ts', sourcefile: path, resolveDir: resolve('services/localWorkspace') }, bundle: true, write: false, format: 'esm', platform: 'node', target: 'es2022' });
  return import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

describe('private workspace lifecycle owner', () => {
  let h: Awaited<ReturnType<typeof createWorkspaceLifecycleHarness>>;
  beforeEach(async () => { h = await createWorkspaceLifecycleHarness(); });
  afterEach(() => { h?.dispose(); });

  it('publishes real activation metadata once without replacing unchanged membership references', async () => {
    const before = h.lifecycle.catalog();
    const result = await h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'activate-project', projectId: h.b.id } });
    expect(result.outcome).toBe('activated'); expect(result.projects).toEqual([]);
    expect(h.published).toEqual([result]); expect(h.lifecycle.catalog().members[0]).toBe(before.members[0]);
    expect(h.lifecycle.catalog().activeProjectId).toBe(h.b.id);
    expect((await h.repository.readActiveSnapshot())!.snapshot.activeProjectId).toBe(h.b.id);
  });

  it('gives queued commands successive local before-stamps without rebasing a posted attempt', async () => {
    const first = h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'activate-project', projectId: h.b.id } });
    const second = h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'activate-project', projectId: h.a.id } });
    const [a, b] = await Promise.all([first, second]); expect(b.receipt.before).toEqual(a.receipt.after);
    expect(h.published.map(result => result.delta.activeProjectId)).toEqual([h.b.id, h.a.id]);
    expect(h.messages.filter(message => message.request.type === 'workspace-command')).toHaveLength(2);
  });

  it('detaches queued bulk input before suspension and returns actual material for explicit bootstrap', async () => {
    const project = { ...makeIncrementalProject(2), id: 'detached', name: 'Original' };
    const saving = h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'create-and-activate-project', project } });
    project.name = 'Caller mutation'; project.initialState.nodes.root.title = 'Caller changed content';
    const result = await saving; expect(result.projects).toHaveLength(1);
    const created = result.projects[0], installed = await h.install(created.scope, created.records);
    expect(installed.project.name).toBe('Original'); expect(installed.project.initialState.nodes.root.title).not.toBe('Caller changed content');
    const save = h.incremental.document({ type: 'save-document-changes', authority: installed.project, editorGeneration: 1,
      changes: [{ type: 'put-node', node: { ...installed.project.initialState.nodes.root, title: 'Ordinary save' } }] });
    await h.incremental.flush(); expect((await save).revision).toBe(1);
  });

  it.each(['preset-saved', 'preset-deleted', 'staged', 'replaced', 'consumed'] as const)
  ('publishes real %s results through the private owner', async outcome => {
    const preset = { id: 'preset', title: 'Preset', desc: '', isCustom: true as const, initialState: makeIncrementalProject(2).initialState };
    const pendingImport = { id: 'pending', targetProjectId: 'imported', name: 'Import', state: makeIncrementalProject(2).initialState, createdAt: h.preparation.now() };
    const attemptProvenance = { sourceKeyDigest: 'a'.repeat(64), payloadDigest: 'b'.repeat(64) };
    const send = (intent: WorkspaceLifecycleCommand['intent']) => h.lifecycle.workspace({ type: 'workspace-lifecycle', intent });
    if (outcome === 'preset-deleted') await send({ type: 'save-custom-preset', preset });
    if (outcome === 'replaced' || outcome === 'consumed') await send({ type: 'stage-import', pendingImport, attemptProvenance });
    const intent: WorkspaceLifecycleCommand['intent'] = outcome === 'preset-saved' ? { type: 'save-custom-preset', preset }
      : outcome === 'preset-deleted' ? { type: 'delete-custom-preset', presetId: preset.id }
      : outcome === 'staged' ? { type: 'stage-import', pendingImport, attemptProvenance }
      : outcome === 'consumed' ? { type: 'consume-import', importId: pendingImport.id }
      : { type: 'replace-staged-import', expected: { importId: pendingImport.id, targetProjectId: pendingImport.targetProjectId,
        createdAt: pendingImport.createdAt, ...attemptProvenance }, replacement: { pendingImport: { ...pendingImport, id: 'replacement', targetProjectId: 'replacement-target' },
        attemptProvenance: { ...attemptProvenance, payloadDigest: 'c'.repeat(64) } } };
    const result = await send(intent); expect(result.outcome).toBe(outcome); expect(h.published.at(-1)).toBe(result);
    expect(h.lifecycle.catalog().stamp).toEqual(result.receipt.after);
    if (outcome === 'consumed') {
      const material = result.projects[0], installed = await h.install(material.scope, material.records);
      expect(installed.project.id).toBe('imported');
    }
  });

  it('retires close immediately but drains an already accepted ordinary save before building destructive expectations', async () => {
    const scope = h.lifecycle.catalog().members.find(scope => scope.projectId === h.b.id)!;
    const { project, authority } = await h.install(scope);
    h.lifecycle.registerEditor(scope, authority.source, { generation: () => 1, drainThrough: async () => true });
    const saving = h.incremental.document({ type: 'save-document-changes', authority: project, editorGeneration: 1,
      changes: [{ type: 'put-node', node: { ...project.initialState.nodes.root, title: 'Before close' } }] });
    const closing = h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'close-project', projectId: h.b.id } });
    expect(() => h.lifecycle.assertEditable(scope)).toThrow(); await saving; expect((await closing).outcome).toBe('closed');
    const request = h.messages.find(message => message.request.type === 'workspace-command')!.request;
    if (request.type !== 'workspace-command' || request.batch.targets[0].type !== 'lineage') throw Error('Close request required');
    expect(request.batch.targets[0].authority.documentRevision).toBe(1);
    expect((await h.repository.readActiveSnapshot())!.snapshot.projects.map(project => project.id)).toEqual([h.a.id]);
  });

  it('refuses failed handoff even with an empty queue and never posts a workspace attempt', async () => {
    const scope = h.lifecycle.catalog().members[0], { authority } = await h.install(scope);
    h.lifecycle.registerEditor(scope, authority.source, { generation: () => 1, drainThrough: async () => false });
    const before = h.lifecycle.catalog();
    await expect(h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'close-project', projectId: scope.projectId } })).rejects.toThrow();
    expect(h.messages.some(message => message.request.type === 'workspace-command')).toBe(false);
    expect(h.lifecycle.catalog()).toBe(before); expect(h.lifecycle.blockedAttempt()).toBeUndefined();
    expect(() => h.lifecycle.assertEditable(scope)).toThrow();
  });

  it('authenticates current ownership before reading lifecycle payload', async () => {
    h.setCurrent(false); const getter = vi.fn(() => { throw Error('Payload read'); });
    const command = Object.defineProperty({ type: 'workspace-lifecycle' }, 'intent', { enumerable: true, get: getter }) as WorkspaceLifecycleCommand;
    await expect(h.lifecycle.workspace(command)).rejects.toThrow(); expect(getter).not.toHaveBeenCalled();
  });

  it('keeps cross-editor newer deliveries and metadata behind the cut, including reentry while releasing them', async () => {
    const [p, q] = h.lifecycle.catalog().members, first = await h.install(p), second = await h.install(q);
    const delivered: string[] = []; const producer = (label: string) => async () => { delivered.push(label); return true; };
    h.lifecycle.registerEditor(q, second.authority.source, { generation: () => 1, drainThrough: async () => true });
    h.lifecycle.registerEditor(p, first.authority.source, { generation: () => 1, drainThrough: async () => {
      void h.lifecycle.persistEditor(q, second.authority.source, 2, async () => {
        delivered.push('newer-2'); void h.lifecycle.persistEditor(q, second.authority.source, 3, producer('newer-3')); return true;
      });
      void h.lifecycle.persistEditor(q, second.authority.source, undefined, producer('metadata'));
      expect(delivered).toEqual([]); return true;
    } });
    await h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'activate-project', projectId: q.projectId } });
    expect(delivered).toEqual(['newer-2', 'metadata', 'newer-3']);
  });

  it.each(['before-cas', 'after-commit'] as const)('inspects the original immutable attempt after %s without replay or duplicate publication', async phase => {
    h.environment.workspaceFault = point => { if (point.phase === phase) throw Error('Lost result'); };
    await expect(h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'activate-project', projectId: h.b.id } })).rejects.toThrow();
    h.environment.workspaceFault = undefined;
    const blocked = h.lifecycle.blockedAttempt(); expect(blocked).toBeDefined(); expect(blocked).not.toHaveProperty('intent');
    expect(h.published).toEqual([]);
    expect((await h.lifecycle.inspectBlocked()).type).toBe(phase === 'after-commit' ? 'committed' : 'not-committed');
    expect((await h.lifecycle.inspectBlocked()).type).toBe(phase === 'after-commit' ? 'committed' : 'not-committed');
    expect(h.published).toHaveLength(phase === 'after-commit' ? 1 : 0);
    expect(h.messages.filter(message => message.request.type === 'workspace-command')).toHaveLength(1);
  });

  it('retains uncertain input privately on disposal without independently terminating the shared client', async () => {
    h.environment.workspaceFault = point => { if (point.phase === 'after-commit') throw Error('Lost result'); };
    await expect(h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'activate-project', projectId: h.b.id } })).rejects.toThrow();
    h.environment.workspaceFault = undefined;
    const retained = h.lifecycle.dispose(); expect(Reflect.ownKeys(retained)).toEqual([]);
    expect(h.lifecycle.dispose()).toBe(retained);
    const reply = await h.client.request({ type: 'workspace-bootstrap', storageGeneration: h.binding.catalog.storageGeneration });
    expect(reply.type).toBe('workspace-bootstrapped');
  });

  it('stages restart with producers closed and preserves lifecycle identity sequence after explicit resume', async () => {
    const old = h.lifecycle, scope = old.catalog().members[0];
    await old.workspace({ type: 'workspace-lifecycle', intent: { type: 'activate-project', projectId: h.b.id } });
    const next = await h.restart();
    expect(() => old.assertEditable(scope)).toThrow(); expect(() => next.owner.assertEditable(scope)).toThrow();
    await expect(next.owner.workspace({ type: 'workspace-lifecycle', intent: { type: 'activate-project', projectId: h.a.id } })).rejects.toThrow();
    await next.resume(); expect(() => old.assertEditable(scope)).not.toThrow();
    await expect(old.workspace({ type: 'workspace-lifecycle', intent: { type: 'activate-project', projectId: h.a.id } })).rejects.toThrow();
    await next.owner.workspace({ type: 'workspace-lifecycle', intent: { type: 'activate-project', projectId: h.a.id } });
    expect(h.messages.flatMap(row => row.request.type === 'workspace-command' ? [row.request.batch.identity.commandSequence] : [])).toEqual([1, 2]);
  });

  it.each([false, true])('recovers independently committed workspace outcome exactly once (already published=%s)', async published => {
    h.environment.workspaceFault = point => { if (point.phase === 'after-commit') throw Error('Lost activation reply'); };
    await expect(h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'activate-project', projectId: h.b.id } })).rejects.toThrow();
    h.environment.workspaceFault = undefined;
    if (published) expect((await h.lifecycle.inspectBlocked()).type).toBe('committed');
    const next = await h.restart(); expect(h.published).toHaveLength(published ? 1 : 0);
    await next.resume(); await next.resume();
    expect(h.published).toHaveLength(1); expect(next.owner.catalog().activeProjectId).toBe(h.b.id);
    expect(h.messages.filter(row => row.request.type === 'workspace-command')).toHaveLength(1);
  });

  it('does not manufacture an old-owner absence fence after worker termination', async () => {
    h.environment.workspaceFault = point => { if (point.phase === 'before-cas') throw Error('Uncertain not-committed activation'); };
    await expect(h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'activate-project', projectId: h.b.id } })).rejects.toThrow();
    h.environment.workspaceFault = undefined;
    await expect(h.restart()).rejects.toThrow();
    expect(() => h.lifecycle.assertEditable(h.lifecycle.catalog().members[0])).toThrow();
    expect(h.messages.filter(row => row.request.type === 'workspace-command')).toHaveLength(1); expect(h.published).toEqual([]);
  });

  it('uses an authentic still-live original fence without automatically retrying the failed workspace intent', async () => {
    h.environment.workspaceFault = point => { if (point.phase === 'before-cas') throw Error('Uncertain activation'); };
    await expect(h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'activate-project', projectId: h.b.id } })).rejects.toThrow();
    h.environment.workspaceFault = undefined;
    const next = await h.restart({ terminateOld: false }); await next.resume();
    expect(next.owner.catalog().activeProjectId).toBe(h.a.id); expect(h.published).toEqual([]);
    expect(h.messages.filter(row => row.request.type === 'workspace-command')).toHaveLength(1);
  });

  it('retains an unposted lifecycle intent without scheduling it during restart', async () => {
    const pending = h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'create-and-activate-project', project: { ...makeIncrementalProject(2), id: 'never-posted' } } });
    void pending.catch(() => {});
    const next = await h.restart(); await expect(pending).rejects.toThrow(); await next.resume();
    expect(h.messages.some(row => row.request.type === 'workspace-command')).toBe(false);
    expect(next.owner.catalog().members.map(row => row.projectId)).toEqual([h.a.id, h.b.id]);
    await next.owner.workspace({ type: 'workspace-lifecycle', intent: { type: 'activate-project', projectId: h.b.id } });
    expect(h.messages.flatMap(row => row.request.type === 'workspace-command' ? [row.request.batch.identity.commandSequence] : [])).toEqual([2]);
  });

  it('keeps deferred deliveries between two reserved lifecycle cuts instead of releasing all after the first', async () => {
    const scope = h.lifecycle.catalog().members[0], { authority } = await h.install(scope); let generation = 1, busy = true;
    h.lifecycle.registerEditor(scope, authority.source, { generation: () => generation, isBusy: () => busy, drainThrough: async () => true });
    const order: string[] = [], original = h.incremental.queue.workspaceBarrier; let cuts = 0;
    vi.spyOn(h.incremental.queue, 'workspaceBarrier').mockImplementation(operation => { order.push(`cut-${++cuts}`); return original(operation); });
    const first = h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'activate-project', projectId: h.b.id } });
    generation = 2; const middle = h.lifecycle.persistEditor(scope, authority.source, 2, async () => { order.push('middle'); return true; });
    const second = h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'activate-project', projectId: h.a.id } });
    generation = 3; const last = h.lifecycle.persistEditor(scope, authority.source, 3, async () => { order.push('last'); return true; }); busy = false;
    await Promise.all([first, second, middle, last]); expect(order).toEqual(['cut-1', 'middle', 'cut-2', 'last']);
  });

  it('pins registered drain methods so in-place replacement cannot manufacture successful handoff', async () => {
    const scope = h.lifecycle.catalog().members[0], { authority } = await h.install(scope);
    const drain = { generation: () => 1, drainThrough: async () => false };
    h.lifecycle.registerEditor(scope, authority.source, drain); drain.drainThrough = async () => true;
    await expect(h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'close-project', projectId: scope.projectId } })).rejects.toThrow();
    expect(h.messages.some(message => message.request.type === 'workspace-command')).toBe(false);
  });

  it('does not spin microtasks indefinitely when a drain incorrectly remains busy after its synchronous action', async () => {
    const scope = h.lifecycle.catalog().members[0], { authority } = await h.install(scope); let polls = 0;
    h.lifecycle.registerEditor(scope, authority.source, { generation: () => 0, drainThrough: async () => true,
      isBusy: () => { if (++polls > 2) throw Error('Excessive busy polling'); return true; } });
    await expect(h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'activate-project', projectId: h.b.id } })).rejects.toThrow();
    expect(polls).toBe(2); expect(h.messages.some(message => message.request.type === 'workspace-command')).toBe(false);
  });

  it('refuses stale publication even after the durable workspace write succeeds', async () => {
    const before = h.lifecycle.catalog(); h.environment.workspaceFault = point => { if (point.phase === 'after-commit') h.setCurrent(false); };
    await expect(h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'activate-project', projectId: h.b.id } })).rejects.toThrow();
    expect(h.lifecycle.catalog()).toBe(before); expect(h.published).toEqual([]);
    expect((await h.repository.readActiveSnapshot())!.snapshot.activeProjectId).toBe(h.b.id);
  });

  it('does not let a later close retire the earlier activation cut for the same project', async () => {
    const scope = h.lifecycle.catalog().members[0], { authority } = await h.install(scope); let busy = true;
    h.lifecycle.registerEditor(scope, authority.source, { generation: () => 0, isBusy: () => busy, drainThrough: async () => true });
    const activation = h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'activate-project', projectId: scope.projectId } });
    const close = h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'close-project', projectId: scope.projectId } });
    busy = false;
    expect((await Promise.all([activation, close])).map(result => result.outcome)).toEqual(['activated', 'closed']);
  });

  it('does not bind a later survivor command to an editor already scheduled for removal', async () => {
    const scope = h.lifecycle.catalog().members[0], { authority } = await h.install(scope);
    const unregister = h.lifecycle.registerEditor(scope, authority.source, { generation: () => 0, drainThrough: async () => true });
    const notify = h.options.onCatalog; h.options.onCatalog = result => { notify(result); if (result.outcome === 'closed') unregister(); };
    const close = h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'close-project', projectId: scope.projectId } });
    const activate = h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'activate-project', projectId: h.b.id } });
    expect((await Promise.all([close, activate])).map(result => result.outcome)).toEqual(['closed', 'activated']);
  });

  it('holds newer producer callbacks throughout the queue reservation call itself', async () => {
    const scope = h.lifecycle.catalog().members[0], { project, authority } = await h.install(scope);
    const document = (generation: number) => h.incremental.document({ type: 'save-document-changes', authority: project, editorGeneration: generation,
      changes: [{ type: 'put-node', node: { ...project.initialState.nodes.root, title: `value-${generation}` } }] });
    const saved = document(1); await h.incremental.flush(); await saved;
    h.lifecycle.registerEditor(scope, authority.source, { generation: () => 1, drainThrough: async () => true });
    let reserving = false, reentered = false, later: Promise<boolean> | undefined;
    const get = h.installed.get.bind(h.installed), barrier = h.incremental.queue.workspaceBarrier;
    vi.spyOn(h.installed, 'get').mockImplementation(id => {
      const value = get(id);
      if (reserving && !reentered) { reentered = true; later = h.lifecycle.persistEditor(scope, authority.source, 2, async () => { await document(2); return true; }); }
      return value;
    });
    vi.spyOn(h.incremental.queue, 'workspaceBarrier').mockImplementation(operation => {
      reserving = true; try { return barrier(operation); } finally { reserving = false; }
    });
    await h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'activate-project', projectId: scope.projectId } });
    await h.incremental.flush(); expect(await later).toBe(true);
    const requests = h.messages.map(row => row.request);
    expect(requests.findIndex(request => request.type === 'workspace-command')).toBeLessThan(requests.findIndex(request => request.type === 'document-batch' && request.batch.editorGeneration === 2));
  });

  it('refuses publication and inspection publication after a captured editor installation changes', async () => {
    const scope = h.lifecycle.catalog().members[0], { authority } = await h.install(scope);
    h.lifecycle.registerEditor(scope, authority.source, { generation: () => 0, drainThrough: async () => true });
    const before = h.lifecycle.catalog();
    h.environment.workspaceFault = point => { if (point.phase === 'after-commit') h.installed.set(scope.projectId, { ...authority, source: {} }); };
    await expect(h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'activate-project', projectId: h.b.id } })).rejects.toThrow();
    h.environment.workspaceFault = undefined;
    expect(h.lifecycle.catalog()).toBe(before); expect(h.published).toEqual([]);
    expect((await h.lifecycle.inspectBlocked()).type).toBe('unknown'); expect(h.published).toEqual([]);
  });

  it.each(['mutate', 'replace', 'remove'] as const)('checks registry liveness when the last publication resolver can %s an earlier source', async action => {
    const [p, q] = h.lifecycle.catalog().members, first = await h.install(p), second = await h.install(q);
    h.lifecycle.registerEditor(p, first.authority.source, { generation: () => 0, drainThrough: async () => true });
    h.lifecycle.registerEditor(q, second.authority.source, { generation: () => 0, drainThrough: async () => true });
    let afterReply = false, polls = 0, changed = false;
    h.environment.workspaceFault = point => { if (point.phase === 'after-readback') afterReply = true; };
    h.options.resolveInstalled = scope => {
      if (afterReply && scope.projectId === q.projectId && ++polls === 4) {
        changed = true;
        if (action === 'mutate') Reflect.set(first.authority, 'source', {});
        else if (action === 'replace') h.installed.set(p.projectId, { ...first.authority, source: {} });
        else h.installed.delete(p.projectId);
      }
      return h.installed.get(scope.projectId);
    };
    await expect(h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'activate-project', projectId: q.projectId } })).rejects.toThrow();
    expect(changed).toBe(true); expect(h.published).toEqual([]);
  });

  it('ignores delayed cleanup of an excluded closed editor during the next publication', async () => {
    const [p, q] = h.lifecycle.catalog().members, first = await h.install(p), second = await h.install(q);
    const unregister = h.lifecycle.registerEditor(p, first.authority.source, { generation: () => 0, drainThrough: async () => true });
    h.lifecycle.registerEditor(q, second.authority.source, { generation: () => 0, drainThrough: async () => true });
    const request = h.client.request.bind(h.client); let replies = 0, cleaned = false;
    vi.spyOn(h.client, 'request').mockImplementation(async message => {
      const response = await request(message);
      if (response.type === 'workspace-command-result' && ++replies === 2) {
        const removed = response.result.delta.removed[0];
        // Transparent read-result observation: preserve the actual returned scope,
        // trigger React-like delayed cleanup at the charged native result capture.
        Object.defineProperty(response.result.delta.removed, '0', { enumerable: true, get() { cleaned = true; unregister(); return removed; } });
      }
      return response;
    });
    const closeFirst = h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'close-project', projectId: p.projectId } });
    const closeSecond = h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'close-project', projectId: q.projectId,
      successor: { ...makeIncrementalProject(2), id: 'successor' } } });
    expect((await Promise.all([closeFirst, closeSecond])).map(result => result.outcome)).toEqual(['closed', 'closed']);
    expect(cleaned).toBe(true); expect(h.published).toHaveLength(2);
  });

  it('excludes completed-close registrations before React has run their cleanup', async () => {
    const p = h.lifecycle.catalog().members[0], { authority } = await h.install(p);
    h.lifecycle.registerEditor(p, authority.source, { generation: () => 0, drainThrough: async () => true });
    await h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'close-project', projectId: p.projectId } });
    h.installed.delete(p.projectId);
    expect((await h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'activate-project', projectId: h.b.id } })).outcome).toBe('activated');
    expect(h.published).toHaveLength(2);
  });
});

describe('retained lifecycle capture ownership', () => {
  let instrumented: Awaited<ReturnType<typeof instrumentOwner>>, h: Awaited<ReturnType<typeof createWorkspaceLifecycleHarness>>;
  beforeAll(async () => { instrumented = await instrumentOwner(); });
  beforeEach(async () => { h = await createWorkspaceLifecycleHarness(instrumented.createWorkspaceCommandAdmission, instrumented.registryForTest); });
  afterEach(() => { h?.dispose(); });
  it('keeps detached queued input even when disposal cancels cooperative weighing', async () => {
    try {
      const project = { ...makeIncrementalProject(2), id: 'retained-input', name: 'Before disposal', extra: 'x'.repeat(100_000) };
      const pending = h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'create-and-activate-project', project } }).catch(error => error);
      const handle = h.lifecycle.dispose(); project.name = 'Caller changed'; await pending;
      const entry = instrumented.inspectRetainedForTest(handle).entries[0]; await entry.input.catch(() => {});
      expect(entry.inputData?.intent.project.name).toBe('Before disposal');
      expect(h.messages.some(message => message.request.type === 'workspace-command')).toBe(false);
    } finally { h.dispose(); }
  });

  it('closes a completed capture scheduler on unknown outcome without erasing retained payload', async () => {
    try {
      h.environment.workspaceFault = point => { if (point.phase === 'after-commit') throw Error('lost'); };
      await expect(h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'activate-project', projectId: h.b.id } })).rejects.toThrow();
      const handle = h.lifecycle.dispose(), entry = instrumented.inspectRetainedForTest(handle).entries[0];
      expect(entry.work.stopped()).toBe(true); expect(entry.inputData?.intent.projectId).toBe(h.b.id);
    } finally { h.dispose(); }
  });
});
