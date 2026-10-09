// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createWorkspaceCommandHarness } from '../../../helpers/workspaceCommandHarness';
import { physicalRows, mutateRow } from '../../../helpers/normalizationHarness';
import { createNormalizedRepository } from '../../../../services/localWorkspace/normalized/repository';
import { NORMALIZED_STORE_NAMES, type BulkDocumentBatch, type NormalizedProject, type ProjectScope, type ProjectStoreName } from '../../../../services/localWorkspace/normalized/schema';
import { partitionState } from '../../../../services/document/partition';
import * as codec from '../../../../services/localWorkspace/normalized/codec';

let h: Awaited<ReturnType<typeof createWorkspaceCommandHarness>>, scope: ProjectScope, records: NormalizedProject, batch: BulkDocumentBatch;
const stores = NORMALIZED_STORE_NAMES.filter((name): name is ProjectStoreName => name !== 'normalizationLedger');
async function image() {
  const rows = await physicalRows(h, stores), result = { scope, normalizationLedger: new Map() } as NormalizedProject;
  for (const store of stores) Object.assign(result, { [store]: new Map(rows[store]
    .filter(row => row.key[0] === scope.storageGeneration && row.key[1] === scope.projectId)
    .map(row => [JSON.stringify(row.key), row])) });
  return result;
}
beforeEach(async () => {
  h = await createWorkspaceCommandHarness(); scope = h.catalog().members[0]; records = await image();
  const expected = await h.repository.bindAdmittedProject(records), state = structuredClone(h.a.initialState);
  state.nodes.root.title = 'Replacement';
  batch = { scope, clientId: 'bulk-client', commitId: 'bulk-1', commitGeneration: 1, editorGeneration: 1,
    expected, state, preferences: partitionState(state).preferences };
});
afterEach(() => { h?.adapter.close(); });

it('atomically replaces only the admitted incarnation and reopens from a fresh repository', async () => {
  expect(h.repository.commitReplacement).toBeTypeOf('function');
  const retained = await physicalRows(h, ['workspace', 'projects', 'migrationLedger', 'legacyBackup']);
  const otherBefore = [...records.projectHeaders.values()][0].incarnation;
  const ack = await h.repository.commitReplacement(batch);
  expect(ack.authority).toEqual({ documentRevision: 1, preferenceRevision: 1, foldStructureGeneration: 1 });
  expect(await physicalRows(h, ['workspace', 'projects', 'migrationLedger', 'legacyBackup'])).toEqual(retained);
  const fresh = createNormalizedRepository(h.environment), current = await fresh.exportProjectForRecovery(scope);
  expect(current.project.initialState.nodes.root.title).toBe('Replacement');
  expect(current.scope.incarnation).toBe(otherBefore);
  expect((await fresh.readActiveSnapshot())!.snapshot.projects.find(project => project.id === h.b.id)).toEqual(h.b);
});

it('rebinds worker caches for ordinary edits and preferences after replacement', async () => {
  expect(h.repository.commitReplacement).toBeTypeOf('function');
  const replacement = await h.repository.commitReplacement(batch);
  const node = { ...batch.state.nodes.root, title: 'After replacement' };
  await expect(h.repository.commitDocument({ scope, clientId: 'bulk-client', commitId: 'edit-2', commitGeneration: 2,
    editorGeneration: 2, expectedRevision: replacement.authority.documentRevision, changes: [{ type: 'put-node', node }] })).resolves.toMatchObject({ revision: 2 });
  await expect(h.repository.commitPreferences({ scope, clientId: 'bulk-client', commitId: 'pref-3', commitGeneration: 3,
    editorGeneration: 3, observedPreferenceRevision: 1, patch: { scale: 2 } })).resolves.toMatchObject({ preferenceRevision: 2 });
  expect(h.repository.readAdmittedProjectAuthority(scope)).toEqual({ documentRevision: 2, preferenceRevision: 2, foldStructureGeneration: 1 });
  const current = await createNormalizedRepository(h.environment).exportProjectForRecovery(scope);
  expect(current.project.initialState.nodes.root.title).toBe('After replacement'); expect(current.project.initialState.scale).toBe(2);
});

it('old caches cannot cross a replacement even with a scalar-only preference save', async () => {
  expect(h.repository.commitReplacement).toBeTypeOf('function');
  const old = createNormalizedRepository(h.environment); await old.bindAdmittedProject(records);
  await h.repository.commitReplacement(batch);
  await expect(old.commitPreferences({ scope, clientId: 'old', commitId: 'old-pref', commitGeneration: 1,
    editorGeneration: 1, observedPreferenceRevision: 0, patch: { scale: 3 } })).rejects.toThrow('ingress-required');
});

it('lost committed result inspects independently without applying replacement twice', async () => {
  expect(h.repository.commitReplacement).toBeTypeOf('function');
  h.environment.workspaceFault = point => { if (point.phase === 'after-commit') throw Error('lost reply'); };
  await expect(h.repository.commitReplacement(batch)).rejects.toThrow('lost reply');
  h.environment.workspaceFault = undefined;
  const fresh = createNormalizedRepository(h.environment);
  const inspection = await fresh.inspectReplacement(batch);
  expect(inspection).toMatchObject({ type: 'committed', ack: { authority: { documentRevision: 1, preferenceRevision: 1, foldStructureGeneration: 1 } } });
  expect((await image()).projectHeaders.values().next().value!.storageRevision).toBe(1);
});

it.each(['before-cas', 'after-cas', 'before-delete', 'after-delete', 'before-put', 'after-put', 'before-complete'] as const)(
  'aborts the whole replacement on %s and preserves exact old rows', async phase => {
    expect(h.repository.commitReplacement).toBeTypeOf('function');
    const before = await physicalRows(h, stores); let fired = false;
    h.environment.workspaceFault = point => { if (point.phase === phase) { fired = true; throw new DOMException('stop', 'AbortError'); } };
    await expect(h.repository.commitReplacement(batch)).rejects.toThrow(); h.environment.workspaceFault = undefined;
    expect(fired).toBe(true); expect(await physicalRows(h, stores)).toEqual(before);
    expect(await h.repository.inspectReplacement(batch)).toEqual({ type: 'not-committed' });
    expect(await createNormalizedRepository(h.environment).inspectReplacement(batch)).toMatchObject({ type: 'conflict' });
  });

it('preference-only advance does not authorize same-size corruption of replacement document', async () => {
  expect(h.repository.commitReplacement).toBeTypeOf('function');
  await h.repository.commitReplacement(batch);
  await h.repository.commitPreferences({ scope, clientId: 'bulk-client', commitId: 'pref-2', commitGeneration: 2,
    editorGeneration: 2, observedPreferenceRevision: 1, patch: { scale: 2 } });
  const row = (await physicalRows(h, ['projectNodes'])).projectNodes.find(row => row.key[1] === scope.projectId && row.key[3] === 'root');
  row.value.title = 'Tamperbytes';
  await mutateRow(h, 'projectNodes', store => store.put(row));
  await expect(createNormalizedRepository(h.environment).readActiveSnapshot()).rejects.toThrow();
});

it('refuses unexplained current-record corruption before replacing an initially admitted document', async () => {
  await h.repository.commitPreferences({ scope, clientId: 'before-bulk', commitId: 'pref-before', commitGeneration: 1,
    editorGeneration: 1, observedPreferenceRevision: 0, patch: { scale: 2 } });
  batch.expected = h.repository.readAdmittedProjectAuthority(scope);
  const row = (await physicalRows(h, ['projectNodes'])).projectNodes.find(row => row.key[1] === scope.projectId && row.key[3] === 'root');
  const originalTitle = row.value.title;
  row.value.title = row.value.title.replace(/[A-Za-z]/, (letter: string) => letter === 'X' ? 'Y' : 'X');
  expect(row.value.title).not.toBe(originalTitle);
  expect(new TextEncoder().encode(JSON.stringify(row.value)).length).toBe(row.encodedSize.valueBytes);
  await mutateRow(h, 'projectNodes', store => store.put(row));
  const before = await physicalRows(h, stores);
  await expect(h.repository.commitReplacement(batch)).rejects.toThrow('verification-failed');
  expect(await physicalRows(h, stores)).toEqual(before);
});

it('cut authority does not silently read or adopt a foreign preference advance', async () => {
  const foreign = createNormalizedRepository(h.environment); await foreign.bindAdmittedProject(records);
  await foreign.commitPreferences({ scope, clientId: 'foreign', commitId: 'foreign-pref', commitGeneration: 1,
    editorGeneration: 1, observedPreferenceRevision: 0, patch: { scale: 2 } });
  expect(h.repository.readAdmittedProjectAuthority(scope)).toEqual(batch.expected);
  await expect(h.repository.commitReplacement(batch)).rejects.toThrow('authority-changed');
});

it('classifies corrupted committed replacement as verification conflict, not unavailable inspection', async () => {
  await h.repository.commitReplacement(batch);
  const row = (await physicalRows(h, ['projectNodes'])).projectNodes.find(row => row.key[1] === scope.projectId && row.key[3] === 'root');
  row.value.title = 'Tamperbytes';
  expect(new TextEncoder().encode(JSON.stringify(row.value)).length).toBe(row.encodedSize.valueBytes);
  await mutateRow(h, 'projectNodes', store => store.put(row));
  await expect(createNormalizedRepository(h.environment).inspectReplacement(batch)).resolves.toEqual({ type: 'conflict', reason: 'verification-failed' });
});

it('replacement hashes only the fresh write, once per digest, and never re-proves the current image', async () => {
  const hash = h.environment.hash, tags: string[] = [], oldTitle = JSON.stringify(h.a.initialState.nodes.root.title);
  expect(oldTitle).not.toBe(JSON.stringify('Replacement'));
  h.environment.hash = input => {
    tags.push(JSON.parse(input.slice(0, input.indexOf(',')) + ']')[0]);
    expect(input.includes(oldTitle)).toBe(false);
    return hash(input);
  };
  await h.repository.commitReplacement(batch);
  // Fold record, request, header/preference cores, the four bulk baselines and the manifest; no readback re-hash.
  expect(tags).toEqual(['doctect-normalized-record-v1', 'doctect-bulk-document-request-v1', 'doctect-normalized-bulk-core-v1',
    'doctect-normalized-bulk-core-v1', 'doctect-project-bulk-image-v1', 'doctect-project-bulk-document-v1',
    'doctect-project-bulk-preferences-v1', 'doctect-project-bulk-folds-v1', 'doctect-bulk-project-baseline-v1']);
});

it('validates the fresh replacement once and verifies durable readback by record equality, not reconstruction', async () => {
  const metered = vi.spyOn(codec, 'reconstructProjectWork'), native = vi.spyOn(codec, 'reconstructProject');
  try {
    await h.repository.commitReplacement(batch);
    const replaced = (image: NormalizedProject) => image.projectHeaders.values().next().value!.storageRevision === 1;
    expect(metered.mock.calls.filter(([image]) => replaced(image))).toHaveLength(0);
    expect(native.mock.calls.filter(([image]) => replaced(image))).toHaveLength(1);
    expect((await createNormalizedRepository(h.environment).exportProjectForRecovery(scope)).project.initialState.nodes.root.title)
      .toBe('Replacement');
  } finally { metered.mockRestore(); native.mockRestore(); }
});

it('refuses to acknowledge a replacement whose durable readback differs from what was written', async () => {
  let fired = false;
  h.environment.workspaceReadResult = (operation, value) => {
    const row = value as { key?: string[]; value?: { title?: string } };
    if (operation.phase !== 'verify-read' || operation.store !== 'projectNodes' || row.key?.[3] !== 'root') return value;
    fired = true; return { ...row, value: { ...row.value, title: 'Replacemenx' } };
  };
  await expect(h.repository.commitReplacement(batch)).rejects.toThrow('Replacement readback mismatch');
  expect(fired).toBe(true);
});

it('same committed attempt returns verified success without writing a second replacement', async () => {
  const ack = await h.repository.commitReplacement(batch); let writes = 0;
  h.environment.onWorkspaceOperation = operation => { if (operation.phase === 'write') writes++; };
  expect(await h.repository.commitReplacement(batch)).toEqual(ack); expect(writes).toBe(0);
});

it('a freshly admitted second owner installs a distinct replacement boundary and supersedes the first receipt', async () => {
  const first = await h.repository.commitReplacement(batch), other = createNormalizedRepository(h.environment);
  const expected = await other.bindAdmittedProject(await image()); expect(expected).toEqual(first.authority);
  const secondBatch = { ...batch, commitId: 'bulk-2', commitGeneration: 2, editorGeneration: 2, expected };
  const second = await other.commitReplacement(secondBatch);
  expect(second.authority).toEqual({ documentRevision: 2, preferenceRevision: 2, foldStructureGeneration: 2 });
  const current = await image(), header = current.projectHeaders.values().next().value!, preferences = current.projectPreferences.values().next().value!;
  expect(header.bulkBaseline!.proof.identity.commitId).toBe('bulk-2'); expect(preferences.bulkBoundary).toBe(second.boundaryDigest);
  expect(header.commitWindow).toEqual({ floorRevision: 2, entries: [] }); expect(preferences.commitWindow).toEqual({ floorRevision: 2, entries: [] });
  expect(await h.repository.inspectReplacement(batch)).toEqual({ type: 'conflict', reason: 'proof-unavailable' });
  expect(await createNormalizedRepository(h.environment).inspectReplacement(secondBatch)).toMatchObject({ type: 'committed', ack: second });
  await expect(h.repository.commitPreferences({ scope, clientId: 'old', commitId: 'stale', commitGeneration: 3,
    editorGeneration: 3, observedPreferenceRevision: 1, patch: { scale: 2 } })).rejects.toThrow('ingress-required');
});

it.each(['document', 'preferences'] as const)('asymmetric %s window eviction retains one baseline and never revives the old replacement', async lane => {
  await h.repository.commitReplacement(batch);
  for (let i = 0; i < 33; i++) {
    const identity = { scope, clientId: 'after-bulk', commitId: `after-${i}`, commitGeneration: i + 2, editorGeneration: i + 2 };
    if (lane === 'document') await h.repository.commitDocument({ ...identity, expectedRevision: i + 1,
      changes: [{ type: 'put-node', node: { ...batch.state.nodes.root, title: `After ${i}` } }] });
    else await h.repository.commitPreferences({ ...identity, observedPreferenceRevision: i + 1, patch: { scale: 1 + i / 100 } });
  }
  const current = await image(), header = current.projectHeaders.values().next().value!, preferences = current.projectPreferences.values().next().value!;
  const advanced = lane === 'document' ? header : preferences;
  expect(advanced.commitWindow.floorRevision).toBeGreaterThan(1);
  expect(header.bulkBaseline!.proof.identity.commitId).toBe('bulk-1'); expect(preferences.bulkBoundary).toBe(header.bulkBaseline!.proof.manifestDigest);
  const fresh = createNormalizedRepository(h.environment);
  expect(await fresh.readActiveSnapshot()).toBeDefined();
  expect(await fresh.inspectReplacement(batch)).toEqual({ type: 'conflict', reason: 'authority-changed' });
});

it('a proven aborted old replacement cannot become not-committed across a later bulk floor', async () => {
  const aborted = { ...batch, commitId: 'aborted' };
  h.environment.workspaceFault = point => { if (point.phase === 'before-cas') throw Error('abort'); };
  await expect(h.repository.commitReplacement(aborted)).rejects.toThrow('abort'); h.environment.workspaceFault = undefined;
  expect(await h.repository.inspectReplacement(aborted)).toEqual({ type: 'not-committed' });
  await h.repository.commitReplacement(batch);
  expect(await h.repository.inspectReplacement(aborted)).toEqual({ type: 'conflict', reason: 'proof-unavailable' });
});

it('requires fresh admission for a deferred cache instead of synchronous bulk catch-up', async () => {
  const foreign = createNormalizedRepository(h.environment); await foreign.bindAdmittedProject(records);
  await foreign.commitDocument({ scope, clientId: 'foreign', commitId: 'foreign-doc', commitGeneration: 1,
    editorGeneration: 1, expectedRevision: 0, changes: [{ type: 'put-node', node: { ...h.a.initialState.nodes.root, title: 'Foreign edit' } }] });
  await h.repository.commitPreferences({ scope, clientId: 'local', commitId: 'local-pref', commitGeneration: 1,
    editorGeneration: 1, observedPreferenceRevision: 0, patch: { scale: 2 } });
  batch.expected = h.repository.readAdmittedProjectAuthority(scope);
  expect(batch.expected).toEqual({ documentRevision: 1, preferenceRevision: 1, foldStructureGeneration: 0 });
  await expect(h.repository.commitReplacement(batch)).rejects.toThrow('ingress-required');
});

it('preserves unavailable IndexedDB as unknown rather than a verification conflict', async () => {
  await h.repository.commitReplacement(batch);
  const spy = vi.spyOn(h.environment.indexedDB, 'open').mockImplementation(() => { throw new DOMException('unavailable', 'InvalidStateError'); });
  try { await expect(createNormalizedRepository(h.environment).inspectReplacement(batch)).rejects.toMatchObject({ name: 'InvalidStateError' }); }
  finally { spy.mockRestore(); }
});

it('rejects identity reuse with another payload after a proven aborted attempt', async () => {
  h.environment.workspaceFault = point => { if (point.phase === 'before-complete') throw new DOMException('abort', 'AbortError'); };
  await expect(h.repository.commitReplacement(batch)).rejects.toMatchObject({ name: 'AbortError' });
  h.environment.workspaceFault = undefined;
  batch.state.nodes.root.title = 'Different attempted payload';
  await expect(h.repository.commitReplacement(batch)).rejects.toThrow('identity-mismatch');
});

it.each(['header', 'preferences', 'foreign-incarnation', 'manifest'] as const)('inspects missing or corrupt committed %s as verification conflict', async kind => {
  await h.repository.commitReplacement(batch);
  if (kind === 'header') await mutateRow(h, 'projectHeaders', store => store.delete([scope.storageGeneration, scope.projectId]));
  if (kind === 'preferences') await mutateRow(h, 'projectPreferences', store => store.delete([scope.storageGeneration, scope.projectId, scope.incarnation]));
  if (kind === 'manifest') await mutateRow(h, 'workspace', store => store.delete('current'));
  if (kind === 'foreign-incarnation') {
    const row = (await physicalRows(h, ['projectNodes'])).projectNodes.find(row => row.key[1] === scope.projectId);
    const old = [...row.key]; row.key[2] = 'foreign-incarnation';
    await mutateRow(h, 'projectNodes', store => { store.delete(old); store.put(row); });
  }
  await expect(createNormalizedRepository(h.environment).inspectReplacement(batch)).resolves.toEqual({ type: 'conflict', reason: 'verification-failed' });
});
