// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createWorkspaceLifecycleHarness } from '../../../helpers/workspaceCommandHarness';
import { partitionState } from '../../../../services/document/partition';
import type { BulkDocumentBatch } from '../../../../services/localWorkspace/normalized/schema';
import { createWorkspaceWorkerHandler } from '../../../../services/localWorkspace/normalized/coordinator';

let h: Awaited<ReturnType<typeof createWorkspaceLifecycleHarness>>, admissionId: number, batch: BulkDocumentBatch;
beforeEach(async () => {
  h = await createWorkspaceLifecycleHarness();
  const installed = await h.install(h.binding.catalog.members[0]);
  admissionId = installed.authority.binding.admissionId;
  const state = structuredClone(installed.project.initialState); state.nodes.root.title = 'Worker replacement';
  batch = { scope: installed.authority.binding.scope, expected: installed.authority.binding.authority,
    clientId: 'bulk-worker', commitId: 'bulk-1', commitGeneration: 1, editorGeneration: 1,
    state, preferences: partitionState(state).preferences };
});
afterEach(() => { h?.dispose(); vi.useRealTimers(); });

it('transports one explicit replacement and returns only correlated metadata', async () => {
  const cut = await h.client.request({ type: 'project-cut-authority', admissionId, scope: batch.scope });
  expect(cut).toMatchObject({ type: 'project-cut-authority-result', authority: batch.expected });
  const response = await h.client.request({ type: 'replace-document', admissionId, batch });
  expect(response).toMatchObject({ type: 'replacement-result', ack: { type: 'document-replaced', commitId: 'bulk-1', authority: {
    documentRevision: 1, preferenceRevision: 1, foldStructureGeneration: 1 } } });
  expect(Object.keys(response).sort()).toEqual(['ack', 'type']);
  const reopened = await h.client.request({ type: 'recovery-export', scope: batch.scope });
  expect(reopened).toMatchObject({ type: 'recovery-exported', project: { initialState: { nodes: { root: { title: 'Worker replacement' } } } } });
});

it('hands off exact preference authority after a structural document save without a preference acknowledgement', async () => {
  const template = partitionState(h.a.initialState).document.variants.default.templates['page-0'];
  const count = template.layers!.length;
  const address = (position: number) => ({ variantId: 'default', templateId: 'page-0', position });
  const changed = { ...template, layers: [...template.layers!, { id: 'new-layer', name: 'New', order: count, visible: true, locked: false }] };
  const response = await h.client.request({ type: 'structural-command', admissionId, command: { type: 'occurrence-edit', batch: {
    scope: batch.scope, clientId: batch.clientId, commitId: 'structural-1', commitGeneration: 1, editorGeneration: 1, expectedRevision: 0,
    changes: [{ type: 'put-template', variantId: 'default', template: changed }], structural: { expectedFoldStructureGeneration: 0,
      mappings: [...Array.from({ length: count }, (_, i) => ({ type: 'continue' as const, from: address(i), to: address(i) })),
        { type: 'create', to: address(count), cell: { present: true, value: true } }] } } } });
  expect(response).toMatchObject({ type: 'structural-result', ack: { revision: 1, foldStructureGeneration: 1 } });
  if (response.type !== 'structural-result') throw Error('Structural commit failed');
  expect(response.ack).not.toHaveProperty('preferenceRevision');
  const cut = await h.client.request({ type: 'project-cut-authority', admissionId, scope: batch.scope });
  expect(cut).toMatchObject({ type: 'project-cut-authority-result', authority: { documentRevision: 1, preferenceRevision: 1, foldStructureGeneration: 1 } });
  if (cut.type !== 'project-cut-authority-result') throw Error('Missing exact cut');
  await expect(h.client.request({ type: 'replace-document', admissionId,
    batch: { ...batch, expected: cut.authority, commitGeneration: 2, editorGeneration: 2 } })).resolves.toMatchObject({
      type: 'replacement-result', ack: { authority: { documentRevision: 2, preferenceRevision: 2, foldStructureGeneration: 2 } } });
});

it('new worker inspects a committed replacement after the old reply was lost', async () => {
  h.environment.workspaceFault = point => { if (point.phase === 'after-commit') throw Error('lost reply'); };
  await expect(h.client.request({ type: 'replace-document', admissionId, batch })).resolves.toMatchObject({ type: 'failed', outcome: 'unknown', admission: 'invalidated' });
  h.environment.workspaceFault = undefined;
  const fresh = createWorkspaceWorkerHandler(h.environment);
  try {
    const response = await fresh.handle({ protocolVersion: 1, workerEpoch: 10, requestId: 1, request: { type: 'inspect-replacement', batch } });
    expect(response.response).toMatchObject({ type: 'replacement-inspection', result: { type: 'committed', ack: { commitId: 'bulk-1' } } });
  } finally { fresh.dispose(); }
});

it('stale project admission cannot post a replacement after explicit rebootstrap', async () => {
  await h.install(batch.scope);
  await expect(h.client.request({ type: 'replace-document', admissionId, batch })).resolves.toEqual({
    type: 'failed', code: 'stale-admission', outcome: 'not-started', admission: 'none' });
});

it.each(['epoch', 'identity', 'stamp'] as const)('wrong replacement reply %s remains unknown until independent inspection', async field => {
  h.workers.at(-1)!.transform = response => {
    if (response.response.type === 'replacement-result') {
      if (field === 'epoch') response.workerEpoch++;
      if (field === 'identity') response.response.ack.commitId = 'wrong';
      if (field === 'stamp') response.response.ack.authority.preferenceRevision++;
    }
    return response;
  };
  await expect(h.client.request({ type: 'replace-document', admissionId, batch })).rejects.toMatchObject({ code: 'protocol-error', outcome: 'unknown' });
  expect(await h.repository.inspectReplacement(batch)).toMatchObject({ type: 'committed' });
});

it('replacement clone failure cannot be mistaken for a rollback acknowledgement', async () => {
  Object.assign(batch.state, { uncloneable: () => 1 });
  await expect(h.client.request({ type: 'replace-document', admissionId, batch })).rejects.toMatchObject({ code: 'post-failed', outcome: 'unknown' });
  expect(h.messages.some(row => row.request.type === 'replace-document')).toBe(false);
});

it('replacement transport uses the unchanged 30000ms deadline and treats timeout as unknown', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); h.workers.at(-1)!.port.postMessage = () => {};
  let outcome: unknown;
  const result = h.client.request({ type: 'replace-document', admissionId, batch }).catch(error => { outcome = error; });
  await vi.advanceTimersByTimeAsync(29_999); expect(outcome).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1); await result; expect(outcome).toMatchObject({ code: 'timeout', outcome: 'unknown' });
});

it('termination with a posted replacement remains unknown', async () => {
  h.workers.at(-1)!.port.postMessage = () => {};
  const result = h.client.request({ type: 'replace-document', admissionId, batch });
  const assertion = expect(result).rejects.toMatchObject({ code: 'disposed', outcome: 'unknown' });
  h.client.dispose(); await assertion;
});
