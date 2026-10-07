// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { createWorkspaceCommandHarness } from '../../../helpers/workspaceCommandHarness';
import { makeIncrementalProject } from '../../../helpers/incrementalFixtures';
import { physicalRows } from '../../../helpers/normalizationHarness';
import { decomposeProject } from '../../../../services/localWorkspace/normalized/codec';
import { partitionState } from '../../../../services/document/partition';
import { NORMALIZED_STORE_NAMES, type BulkDocumentBatch, type NormalizedProject, type ProjectStoreName } from '../../../../services/localWorkspace/normalized/schema';

const stores = NORMALIZED_STORE_NAMES.filter((store): store is ProjectStoreName => store !== 'normalizationLedger');
const fixture = makeIncrementalProject(2);
// Pure layout determines mutation positions; successful storage is seeded only by real normalization.
const layout = decomposeProject(fixture, { storageGeneration: 'layout', projectId: fixture.id, incarnation: 'layout' });
const count = stores.reduce((sum, store) => sum + layout[store].size, 0);
const cases = Array.from({ length: count * 2 }, (_, index) => index + 1)
  .flatMap(ordinal => ['AbortError', 'DataCloneError', 'QuotaExceededError'].map(name => ({ ordinal, name })));
let h: Awaited<ReturnType<typeof createWorkspaceCommandHarness>>, batch: BulkDocumentBatch, before: Awaited<ReturnType<typeof physicalRows>>;
beforeAll(async () => {
  h = await createWorkspaceCommandHarness(); const scope = h.catalog().members[0];
  before = await physicalRows(h, [...stores, 'workspace', 'projects', 'migrationLedger', 'legacyBackup']);
  const image = { scope, normalizationLedger: new Map() } as NormalizedProject;
  for (const store of stores) Object.assign(image, { [store]: new Map(before[store].filter(row => row.key[1] === scope.projectId).map(row => [JSON.stringify(row.key), row])) });
  expect(stores.reduce((sum, store) => sum + image[store].size, 0)).toBe(count);
  const expected = await h.repository.bindAdmittedProject(image), state = structuredClone(h.a.initialState);
  state.nodes.root.title = 'Atomic replacement';
  batch = { scope, expected, clientId: 'bulk-fault', commitId: 'bulk-fault-1', commitGeneration: 1, editorGeneration: 1,
    state, preferences: partitionState(state).preferences };
});
afterEach(() => { h.environment.workspaceFault = undefined; });
afterAll(() => h?.adapter.close());

it.each(cases)('rolls back every row after mutation $ordinal with $name', async ({ ordinal, name }) => {
  let reached = false;
  h.environment.workspaceFault = point => {
    if (point.ordinal === ordinal && (point.phase === 'after-put' || point.phase === 'after-delete')) {
      reached = true; throw new DOMException('Injected bulk rollback', name);
    }
  };
  await expect(h.repository.commitReplacement(batch)).rejects.toMatchObject({ name });
  expect(reached).toBe(true);
  expect(await physicalRows(h, [...stores, 'workspace', 'projects', 'migrationLedger', 'legacyBackup'])).toEqual(before);
  expect(h.repository.readAdmittedProjectAuthority(batch.scope)).toEqual(batch.expected);
});
