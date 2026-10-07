// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createWorkspaceLifecycleHarness } from '../../../helpers/workspaceCommandHarness';
import { partitionState } from '../../../../services/document/partition';
import type { DocumentBatch, DocumentCommitReceipt } from '../../../../services/localWorkspace/normalized/schema';

let h: Awaited<ReturnType<typeof createWorkspaceLifecycleHarness>>;
let admissionId: number, receipt: DocumentCommitReceipt, batch: DocumentBatch;
beforeEach(async () => {
  h = await createWorkspaceLifecycleHarness();
  const installed = await h.install(h.binding.catalog.members[0]); admissionId = installed.authority.binding.admissionId;
  const template = partitionState(installed.project.initialState).document.variants.default.templates['page-0'];
  const count = template.layers!.length, address = (position: number) => ({ variantId: 'default', templateId: 'page-0', position });
  batch = { scope: installed.authority.binding.scope, clientId: 'readmission', commitId: 'structural', commitGeneration: 1, editorGeneration: 1,
    expectedRevision: 0, changes: [{ type: 'put-template', variantId: 'default', template: { ...template,
      layers: [...template.layers!, { id: 'new', name: 'New', order: count, visible: true, locked: false }] } }],
    structural: { expectedFoldStructureGeneration: 0, mappings: [
      ...Array.from({ length: count }, (_, i) => ({ type: 'continue' as const, from: address(i), to: address(i) })),
      { type: 'create', to: address(count), cell: { present: true, value: true } }] } };
  const response = await h.client.request({ type: 'document-batch', admissionId, batch });
  if (response.type !== 'document-result') throw Error('Genuine structural save required');
  receipt = { scope: batch.scope, identity: { clientId: batch.clientId, commitId: batch.commitId, commitGeneration: batch.commitGeneration,
    editorGeneration: batch.editorGeneration, lane: 'document' }, ack: response.ack };
});
afterEach(() => h?.dispose());

it('returns exact authority from the independently verified receipted proof without changing ordinary acknowledgements', async () => {
  const ordinary = await h.client.request({ type: 'inspect-commit', attempt: { lane: 'document', batch } });
  expect(ordinary).toEqual({ type: 'commit-inspection', result: { type: 'committed', ack: receipt.ack } });
  expect(receipt.ack).not.toHaveProperty('preferenceRevision');
  const start = h.operations.length;
  await expect(h.client.request({ type: 'document-readmission-authority', admissionId, receipt })).resolves.toEqual({
    type: 'document-readmission-authority-result', admissionId, scope: receipt.scope, identity: receipt.identity,
    authority: { documentRevision: 1, preferenceRevision: 1, foldStructureGeneration: 1 } });
  expect(h.operations.slice(start).some(operation => operation.phase === 'write')).toBe(false);
});

it.each(['clientId', 'commitGeneration', 'commitId', 'editorGeneration'] as const)('refuses mismatched receipted %s', async field => {
  const changed = structuredClone(receipt);
  if (field === 'clientId' || field === 'commitId') changed.identity[field] += '-foreign'; else changed.identity[field]++;
  if (field === 'commitId') changed.ack.commitId = changed.identity.commitId;
  if (field === 'editorGeneration') changed.ack.editorGeneration = changed.identity.editorGeneration;
  await expect(h.client.request({ type: 'document-readmission-authority', admissionId, receipt: changed })).resolves.toMatchObject({ type: 'failed' });
});

it.each(['revision', 'foldStructureGeneration'] as const)('refuses mismatched acknowledgement %s', async field => {
  const changed = structuredClone(receipt); changed.ack[field]++;
  await expect(h.client.request({ type: 'document-readmission-authority', admissionId, receipt: changed })).resolves.toMatchObject({
    type: 'failed', code: 'identity-mismatch' });
});

it('refuses foreign preference advancement rather than adopting its current stamp', async () => {
  const authority = await h.repository.bindAdmittedProject(await h.readRecords(receipt.scope));
  await h.repository.commitPreferences({ scope: receipt.scope, clientId: 'foreign', commitId: 'foreign-pref', commitGeneration: 1, editorGeneration: 1,
    observedPreferenceRevision: authority.preferenceRevision, patch: { scale: 4 } });
  await expect(h.client.request({ type: 'document-readmission-authority', admissionId, receipt })).resolves.toMatchObject({ type: 'failed', code: 'authority-changed' });
});

it('refuses corrupted selected postconditions even when the authority counters match', async () => {
  h.environment.readResult = (operation, value) => operation.phase === 'inspect-read' && operation.store === 'projectTemplates' && value
    ? { ...value as object, value: { ...(value as { value: object }).value, name: 'Corrupted selected template' } } : value;
  await expect(h.client.request({ type: 'document-readmission-authority', admissionId, receipt })).resolves.toMatchObject({ type: 'failed', code: 'verification-failed' });
});

it('refuses stale admission without reading the project', async () => {
  const start = h.operations.length;
  await expect(h.client.request({ type: 'document-readmission-authority', admissionId: admissionId + 1, receipt })).resolves.toMatchObject({ type: 'failed', code: 'stale-admission' });
  expect(h.operations).toHaveLength(start);
});

it('refuses receipt accessors before worker transfer', async () => {
  const getter = vi.fn(() => { throw Error('Receipt getter evaluated'); });
  const changed = Object.defineProperty({ ...receipt }, 'ack', { enumerable: true, get: getter });
  await expect(h.client.request({ type: 'document-readmission-authority', admissionId, receipt: changed })).rejects.toMatchObject({ code: 'invalid-request' });
  expect(getter).not.toHaveBeenCalled();
});

it.each(['documentRevision', 'foldStructureGeneration', 'identity', 'scope', 'admissionId', 'workerEpoch'] as const)(
  'rejects a response with mismatched %s', async field => {
    h.workers[0].transform = envelope => {
      const r = envelope.response; if (r.type !== 'document-readmission-authority-result') return envelope;
      if (field === 'workerEpoch') return { ...envelope, workerEpoch: envelope.workerEpoch + 1 };
      const response = field === 'identity' ? { ...r, identity: { ...r.identity, commitId: 'wrong' } }
        : field === 'scope' ? { ...r, scope: { ...r.scope, incarnation: 'wrong' } }
        : field === 'admissionId' ? { ...r, admissionId: r.admissionId + 1 }
        : { ...r, authority: { ...r.authority, [field]: r.authority[field] + 1 } };
      return { ...envelope, response };
    };
    await expect(h.client.request({ type: 'document-readmission-authority', admissionId, receipt })).rejects.toMatchObject({ code: 'protocol-error' });
  });

it('does not infer authority when IDB inspection is unavailable', async () => {
  const open = vi.spyOn(h.environment.indexedDB, 'open').mockImplementation(() => { throw new DOMException('Unavailable inspection', 'InvalidStateError'); });
  try {
    await expect(h.client.request({ type: 'document-readmission-authority', admissionId, receipt })).resolves.toMatchObject({
      type: 'failed', code: 'storage-unavailable', outcome: 'unknown' });
  } finally { open.mockRestore(); }
});

it('cannot recover an evicted acknowledged proof after both lane windows advance', async () => {
  for (let generation = 2; generation <= 34; generation++) {
    const result = await h.client.request({ type: 'document-batch', admissionId, batch: {
      scope: receipt.scope, clientId: 'later', commitId: `later-${generation}`, commitGeneration: generation, editorGeneration: generation,
      expectedRevision: generation - 1, changes: [{ type: 'put-node', node: { ...h.a.initialState.nodes.root, title: `Later ${generation}` } }] } });
    expect(result.type).toBe('document-result');
    await expect(h.client.request({ type: 'preferences', admissionId, batch: {
      scope: receipt.scope, clientId: 'later-preferences', commitId: `preference-${generation}`, commitGeneration: generation,
      editorGeneration: generation, observedPreferenceRevision: generation - 1, patch: { showGrid: generation % 2 === 0 },
    } })).resolves.toMatchObject({ type: 'preferences-result' });
  }
  const records = await h.readRecords(receipt.scope);
  const header = records.projectHeaders.values().next().value!, preferences = records.projectPreferences.values().next().value!;
  const proofs = [header.commitProof, preferences.commitProof, ...header.commitWindow.entries.map(entry => entry.proof), ...preferences.commitWindow.entries.map(entry => entry.proof)];
  expect(proofs.some(proof => proof?.identity.commitId === receipt.identity.commitId)).toBe(false);
  await expect(h.client.request({ type: 'document-readmission-authority', admissionId, receipt })).resolves.toMatchObject({ type: 'failed', code: 'proof-unavailable' });
});

it('does not cross a later replacement baseline using an earlier acknowledged receipt', async () => {
  const state = structuredClone(h.a.initialState);
  await expect(h.client.request({ type: 'replace-document', admissionId, batch: { scope: receipt.scope,
    clientId: 'bulk', commitId: 'bulk', commitGeneration: 1, editorGeneration: 2,
    expected: { documentRevision: 1, preferenceRevision: 1, foldStructureGeneration: 1 }, state, preferences: partitionState(state).preferences,
  } })).resolves.toMatchObject({ type: 'replacement-result' });
  await expect(h.client.request({ type: 'document-readmission-authority', admissionId, receipt })).resolves.toMatchObject({ type: 'failed', code: 'proof-unavailable' });
});
