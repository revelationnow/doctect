// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, expectTypeOf, it, vi } from 'vitest';
import { createWorkspaceLifecycleHarness } from '../../../helpers/workspaceCommandHarness';
import { createWorkspaceCommandDispatcher } from '../../../../services/localWorkspace/commandDispatcher';
import { createIncrementalQueue, getCommandQueueReceipt, getQueueSubmissionReceipt, readQueueReadmission } from '../../../../services/localWorkspace/incrementalQueue';
import { partitionState } from '../../../../services/document/partition';
import type { ReplacementWorkspaceCommand } from '../../../../services/localWorkspace/contracts';
import type { BulkDocumentAck } from '../../../../services/localWorkspace/normalized/schema';

let h: Awaited<ReturnType<typeof createWorkspaceLifecycleHarness>>;
let installed: Awaited<ReturnType<typeof h.install>>;
beforeEach(async () => {
  h = await createWorkspaceLifecycleHarness(); installed = await h.install(h.binding.catalog.members[0]);
});
afterEach(() => h?.dispose());
const observe = <T>(promise: Promise<T>) => { void promise.catch(() => {}); return promise; };
function replacement() {
  const state = structuredClone(installed.project.initialState); state.nodes.root.title = 'Replacement';
  return { source: installed.authority.source, state, preferences: partitionState(state).preferences };
}

it('historical dispatch refuses replacement before accessing its bulk payload', async () => {
  const snapshot = vi.fn(), getter = vi.fn(() => { throw Error('Payload read'); });
  const commit = createWorkspaceCommandDispatcher({ snapshot });
  const command = Object.defineProperty({ type: 'replace-document' }, 'state', { enumerable: true, get: getter }) as ReplacementWorkspaceCommand;
  await expect(commit(command)).rejects.toMatchObject({ code: 'authority-lost' });
  expect(getter).not.toHaveBeenCalled(); expect(snapshot).not.toHaveBeenCalled();
});

it('routes a typed private replacement through genuine admission and exposes one opaque receipt', async () => {
  const snapshot = vi.fn(), commit = createWorkspaceCommandDispatcher({ snapshot, replacement: h.incremental.replacement });
  const { state, preferences } = replacement();
  const command: ReplacementWorkspaceCommand = { type: 'replace-document', authority: installed.project, editorGeneration: 1, state, preferences };
  const saving = observe(commit(command)); expectTypeOf(saving).toEqualTypeOf<Promise<BulkDocumentAck>>();
  expect(getCommandQueueReceipt(command)).toBeDefined();
  await h.incremental.flush();
  expect(await saving).toMatchObject({ type: 'document-replaced', authority: { documentRevision: 1, preferenceRevision: 1, foldStructureGeneration: 1 } });
  expect(snapshot).not.toHaveBeenCalled();
  expect((await h.client.request({ type: 'recovery-export', scope: installed.authority.binding.scope }))).toMatchObject({
    type: 'recovery-exported', project: { initialState: { nodes: { root: { title: 'Replacement' } } } } });
});

it('seals both earlier lanes, preserves metadata and admits later work behind replacement without coalescing', async () => {
  const q = h.incremental.queue, id = installed.project.id, source = installed.authority.source;
  expect(typeof q.enqueueReplacement).toBe('function');
  const earlier = observe(q.enqueueDocument(id, 1, { source, changes: [], metadata: { kind: 'patch', name: 'Prior metadata' } }));
  const preference = observe(q.enqueuePreferences(id, 1, { source, patch: { scale: 2 } }));
  const input = replacement(), replacing = observe(q.enqueueReplacement(id, 2, input));
  const receipt = getQueueSubmissionReceipt(replacing); expect(receipt).toBeDefined(); expect(Reflect.ownKeys(receipt!)).toEqual([]);
  const later = observe(q.enqueueDocument(id, 3, { source, changes: [{ type: 'put-node', node: { ...input.state.nodes.root, title: 'Late edit' } }] }));
  const fold = observe(q.enqueuePreferences(id, 3, { source, patch: { scale: 3 }, folds: {
    basis: { type: 'after-replacement', editorGeneration: 2 }, updates: [{ occurrence: { variantId: 'default', templateId: 'page-0', position: 0 }, collapsed: true }] } }));
  await q.flush(); await Promise.all([earlier, preference, replacing, later, fold]);
  expect(h.messages.map(row => row.request.type).filter(type => !type.includes('bootstrap'))).toEqual([
    'document-batch', 'preferences', 'project-cut-authority', 'replace-document', 'document-batch', 'preferences']);
  expect(await replacing).toMatchObject({ authority: { documentRevision: 2, preferenceRevision: 2, foldStructureGeneration: 1 } });
  expect(await later).toMatchObject({ revision: 3 }); expect(await fold).toMatchObject({ preferenceRevision: 3, foldStructureGeneration: 1 });
  expect(await h.client.request({ type: 'recovery-export', scope: installed.authority.binding.scope })).toMatchObject({
    type: 'recovery-exported', project: { name: 'Prior metadata', initialState: { scale: 3, nodes: { root: { title: 'Late edit' } } } } });
});

it('obtains the exact cut after structural folds advance preferences without a preference acknowledgement', async () => {
  const q = h.incremental.queue, id = installed.project.id, source = installed.authority.source;
  expect(typeof q.enqueueReplacement).toBe('function');
  const template = partitionState(installed.project.initialState).document.variants.default.templates['page-0'];
  const count = template.layers!.length, address = (position: number) => ({ variantId: 'default', templateId: 'page-0', position });
  const structural = observe(q.enqueueDocument(id, 1, { source,
    changes: [{ type: 'put-template', variantId: 'default', template: { ...template,
      layers: [...template.layers!, { id: 'new', name: 'New', order: count, visible: true, locked: false }] } }],
    structural: { basis: { type: 'generation', generation: 0 }, mappings: [
      ...Array.from({ length: count }, (_, i) => ({ type: 'continue' as const, from: address(i), to: address(i) })),
      { type: 'create', to: address(count), cell: { present: true, value: true } }] } }));
  const replacing = observe(q.enqueueReplacement(id, 2, replacement()));
  await q.flush(); expect(await structural).not.toHaveProperty('preferenceRevision');
  expect(await replacing).toMatchObject({ authority: { documentRevision: 2, preferenceRevision: 2, foldStructureGeneration: 2 } });
  const request = h.messages.find(row => row.request.type === 'replace-document')!.request;
  expect(request).toMatchObject({ batch: { expected: { documentRevision: 1, preferenceRevision: 1, foldStructureGeneration: 1 } } });
});

it.each([false, true])('inspects a lost committed replacement, keeps its failed promise and replays only the later edit (refused candidate=%s)', async refuseCandidate => {
  const q = h.incremental.queue, id = installed.project.id;
  expect(typeof q.enqueueReplacement).toBe('function');
  h.environment.workspaceFault = point => { if (point.phase === 'after-commit') throw Error('Lost committed reply'); };
  const input = replacement(), replacing = observe(q.enqueueReplacement(id, 1, input));
  const receipt = getQueueSubmissionReceipt(replacing)!;
  const later = observe(q.enqueueDocument(id, 2, [{ type: 'put-node', node: { ...input.state.nodes.root, title: 'Retained late edit' } }]));
  const lateReceipt = getQueueSubmissionReceipt(later)!;
  await expect(replacing).rejects.toBeDefined(); await expect(later).rejects.toBeDefined();
  const checkpoint = q.freeze('Restart'), previous = checkpoint.projects[0]; await checkpoint.whenQuiescent;
  h.environment.workspaceFault = undefined;
  const attempt = previous.attempts[0].attempt; expect(attempt.lane).toBe('replacement');
  if (attempt.lane !== 'replacement') throw Error('Missing replacement attempt');
  const inspection = await h.client.request({ type: 'inspect-replacement', batch: attempt.batch });
  if (inspection.type !== 'replacement-inspection') throw Error('Missing genuine inspection');
  const binding = await h.client.request({ type: 'bootstrap', project: await h.readRecords(installed.authority.binding.scope) });
  if (binding.type !== 'bootstrapped') throw Error('Missing genuine bootstrap');
  const authority = { ...installed.authority, binding };
  let sequence = 0;
  const candidate = () => createIncrementalQueue({ transport: h.client, clock: { now: Date.now, setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    uuid: () => `recovery-${++sequence}`, resolveAuthority: () => authority, onEvent() {},
    recovery: { retained: checkpoint, projects: [{ previous, authority, resolutions: [{ attempt, inspection }] }] } });
  if (refuseCandidate) {
    const refused = candidate(); refused.holdWorkspaceRecovery();
    await refused.prepareProjectReadmission(checkpoint, previous, [receipt, lateReceipt]); refused.dispose();
  }
  const next = candidate();
  try {
    const release = next.holdWorkspaceRecovery();
    const evidence = readQueueReadmission(await next.prepareProjectReadmission(checkpoint, previous, [receipt, lateReceipt]));
    expect(evidence.base).toEqual({ documentRevision: 1, preferenceRevision: 1, foldStructureGeneration: 1 });
    release(); await next.flush();
    expect(await evidence.receipts[0].whenAcknowledged).toMatchObject({ type: 'document-replaced' });
    expect(await evidence.receipts[1].whenAcknowledged).toMatchObject({ type: 'document-saved', revision: 2 });
    await expect(replacing).rejects.toBeDefined();
    expect(h.messages.filter(row => row.request.type === 'replace-document')).toHaveLength(1);
  } finally { next.dispose(); }
});

it.each(['documentRevision', 'preferenceRevision', 'foldStructureGeneration', 'admissionId'] as const)(
  'refuses a mismatched verified cut %s without posting replacement', async field => {
    h.workers[0].transform = envelope => {
      const response = envelope.response;
      if (response.type !== 'project-cut-authority-result') return envelope;
      return { ...envelope, response: field === 'admissionId' ? { ...response, admissionId: response.admissionId + 1 }
        : { ...response, authority: { ...response.authority, [field]: field === 'preferenceRevision' ? -1 : 1 } } };
    };
    const saving = observe(h.incremental.queue.enqueueReplacement(installed.project.id, 1, replacement()));
    await expect(saving).rejects.toBeDefined();
    const checkpoint = h.incremental.queue.freeze('Invalid cut'); await checkpoint.whenQuiescent;
    expect(checkpoint.projects[0].pending[0].lane).toBe('replacement'); expect(checkpoint.projects[0].attempts).toEqual([]);
    expect(h.messages.some(row => row.request.type === 'replace-document')).toBe(false);
  });

it('retains an unposted replacement when frozen during its read-only cut and replays it after genuine readmission', async () => {
  let releaseCut!: () => void, reached!: () => void;
  const gate = new Promise<void>(resolve => { releaseCut = resolve; }), atCut = new Promise<void>(resolve => { reached = resolve; });
  const transport = { async request(request: Parameters<typeof h.client.request>[0]) {
    const response = await h.client.request(request);
    if (request.type === 'project-cut-authority') { reached(); await gate; }
    return response;
  } };
  const authority = { ...installed.authority, transport }; let sequence = 0;
  const clock = { now: Date.now, setTimeout, clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>) };
  const q = createIncrementalQueue({ transport, clock, uuid: () => `unposted-${++sequence}`, resolveAuthority: () => authority, onEvent() {} });
  const saving = observe(q.enqueueReplacement(installed.project.id, 1, replacement())); await atCut;
  const checkpoint = q.freeze('Owner lost during cut'); releaseCut(); await checkpoint.whenQuiescent;
  await expect(saving).rejects.toMatchObject({ code: 'frozen' });
  const previous = checkpoint.projects[0]; expect(previous.attempts).toEqual([]); expect(previous.pending[0].lane).toBe('replacement');
  expect(h.messages.some(row => row.request.type === 'replace-document')).toBe(false);
  const binding = await h.client.request({ type: 'bootstrap', project: await h.readRecords(authority.binding.scope) });
  if (binding.type !== 'bootstrapped') throw Error('Missing readmission');
  const fresh = { ...authority, binding, transport: h.client };
  const next = createIncrementalQueue({ transport: h.client, clock, uuid: () => `replay-${++sequence}`, resolveAuthority: () => fresh, onEvent() {},
    recovery: { retained: checkpoint, projects: [{ previous, authority: fresh, resolutions: [] }] } });
  try {
    await next.flush(); expect(h.messages.filter(row => row.request.type === 'replace-document')).toHaveLength(1);
    await expect(saving).rejects.toMatchObject({ code: 'frozen' });
  } finally { next.dispose(); q.dispose(); }
});

it.each(['preference-stamp', 'source-change', 'freeze'] as const)('refuses %s during exact structural readmission without posting retained replacement', async fault => {
  const q = h.incremental.queue, id = installed.project.id, source = installed.authority.source;
  const template = partitionState(installed.project.initialState).document.variants.default.templates['page-0'];
  const count = template.layers!.length, address = (position: number) => ({ variantId: 'default', templateId: 'page-0', position });
  const saved = observe(q.enqueueDocument(id, 1, { source,
    changes: [{ type: 'put-template', variantId: 'default', template: { ...template,
      layers: [...template.layers!, { id: 'new', name: 'New', order: count, visible: true, locked: false }] } }],
    structural: { basis: { type: 'generation', generation: 0 }, mappings: [
      ...Array.from({ length: count }, (_, i) => ({ type: 'continue' as const, from: address(i), to: address(i) })),
      { type: 'create', to: address(count), cell: { present: true, value: true } }] } }));
  await q.flush(); await saved;
  const replacing = observe(q.enqueueReplacement(id, 2, replacement())), receipt = getQueueSubmissionReceipt(replacing)!;
  const checkpoint = q.freeze('Restart during cut'); await checkpoint.whenQuiescent;
  const previous = checkpoint.projects[0];
  expect(Object.keys(previous.documentReceipt!).sort()).toEqual(['ack', 'identity', 'scope']);
  const binding = await h.client.request({ type: 'bootstrap', project: await h.readRecords(installed.authority.binding.scope) });
  if (binding.type !== 'bootstrapped') throw Error('Missing readmission');
  let next!: ReturnType<typeof createIncrementalQueue>, interrupted: ReturnType<typeof q.freeze> | undefined;
  let observed = false, sequence = 0;
  const transport = { async request(request: Parameters<typeof h.client.request>[0]) {
    const response = await h.client.request(request);
    if (response.type !== 'document-readmission-authority-result') return response;
    observed = true;
    if (fault === 'source-change') current = { ...current, source: {} };
    if (fault === 'freeze') interrupted = next.freeze('Recovery owner stopped');
    return fault === 'preference-stamp' ? { ...response, authority: { ...response.authority, preferenceRevision: response.authority.preferenceRevision + 1 } } : response;
  } };
  const authority = { ...installed.authority, binding, transport }; let current = authority;
  next = createIncrementalQueue({ transport, clock: { now: Date.now, setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    uuid: () => `structural-recovery-${++sequence}`, resolveAuthority: () => current, onEvent() {},
    recovery: { retained: checkpoint, projects: [{ previous, authority, resolutions: [] }] } });
  try {
    next.holdWorkspaceRecovery();
    await expect(next.prepareProjectReadmission(checkpoint, previous, [receipt])).rejects.toMatchObject({ code: fault === 'freeze' ? 'frozen' : 'source-changed' });
    await interrupted?.whenQuiescent;
    expect(observed).toBe(true); expect(h.messages.some(row => row.request.type === 'replace-document')).toBe(false);
    await expect(replacing).rejects.toMatchObject({ code: 'frozen' });
  } finally { next.dispose(); }
});
