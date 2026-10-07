// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createWorkspaceCommandHarness } from '../../../helpers/workspaceCommandHarness';
import { physicalRows } from '../../../helpers/normalizationHarness';
import { makeIncrementalProject } from '../../../helpers/incrementalFixtures';
import { legacySnapshot, LEGACY_KEYS } from '../../../helpers/localWorkspaceFixtures';
import { decomposeProject } from '../../../../services/localWorkspace/normalized/codec';
import { NORMALIZED_STORE_NAMES } from '../../../../services/localWorkspace/normalized/schema';
import { digestLegacySnapshot } from '../../../../services/localWorkspace/canonical';
import type { WorkspaceBatch } from '../../../../services/localWorkspace/normalized/workspaceCommands';

const sample = makeIncrementalProject(2), image = decomposeProject(sample, { storageGeneration: 'count', projectId: sample.id, incarnation: 'count' });
const projectRows = NORMALIZED_STORE_NAMES.reduce((count, store) => count + image[store].size, 0);
const puts = projectRows + 4; // All project rows, one preset, one import, conflict backup, manifest.
const stores = [...NORMALIZED_STORE_NAMES, 'workspace', 'presets', 'pendingImports', 'legacyBackup', 'projects', 'migrationLedger'];
let h: Awaited<ReturnType<typeof createWorkspaceCommandHarness>>, batch: WorkspaceBatch;
beforeEach(async () => {
  h = await createWorkspaceCommandHarness(); const changed = { ...h.a, name: 'Changed' };
  const source = legacySnapshot({ [LEGACY_KEYS.projects]: JSON.stringify([changed, h.b]),
    [LEGACY_KEYS.customPresets]: JSON.stringify([{ id: 'legacy-preset', title: 'Preset', desc: '', color: 'red', isCustom: true, initialState: h.a.initialState }]),
    [LEGACY_KEYS.pendingImport]: JSON.stringify({ name: 'Import', state: h.a.initialState }) });
  batch = { storageGeneration: h.catalog().storageGeneration, expected: h.catalog().stamp, targets: [],
    identity: { clientId: 'fault-test', commandId: 'copy', commandSequence: 1 },
    intent: { type: 'recover-legacy-as-copies', recoveryId: 'drift', source, sourceDigest: await digestLegacySnapshot(source) } };
});
afterEach(() => h?.adapter.close());
it('calibrates the complete real recovery write list, including both ancillary rows and conflict backup', async () => {
  const writes: string[] = []; h.environment.onWorkspaceOperation = row => { if (row.phase === 'write') writes.push(row.store); };
  const prepared = await h.repository.prepareWorkspaceRecovery(h.admission.token, batch);
  await h.repository.commitWorkspaceRecovery(h.admission.token, prepared.token);
  expect(writes).toHaveLength(puts); expect(writes.slice(-4)).toEqual(['presets', 'pendingImports', 'legacyBackup', 'workspace']);
});
it.each(Array.from({ length: puts }, (_, index) => index + 1).flatMap(ordinal => [
  ['before-put', 'AbortError', ordinal], ['after-put', 'AbortError', ordinal],
  ['after-put', 'QuotaExceededError', ordinal], ['after-put', 'DataCloneError', ordinal],
] as const))('rolls back all stores at %s/%s write %s', async (phase, name, ordinal) => {
  const before = await physicalRows(h, stores), prepared = await h.repository.prepareWorkspaceRecovery(h.admission.token, batch);
  let hit = false;
  h.environment.workspaceFault = point => { if (point.phase === phase && point.ordinal === ordinal) { hit = true; throw new DOMException('injected', name); } };
  await expect(h.repository.commitWorkspaceRecovery(h.admission.token, prepared.token)).rejects.toMatchObject({ name });
  expect(hit).toBe(true); h.environment.workspaceFault = undefined;
  expect(await physicalRows(h, stores)).toEqual(before);
});
