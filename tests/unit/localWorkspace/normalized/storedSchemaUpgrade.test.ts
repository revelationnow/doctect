// @vitest-environment node
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createIndexedDbAdapter } from '../../../../services/localWorkspace/indexedDbAdapter';
import { createHistoricalBootstrap } from '../../../../services/localWorkspace/historicalBootstrap';
import { upgradeStoredProjectRecord } from '../../../../services/localWorkspace/migration';
import { normalizeWorkspace } from '../../../../services/localWorkspace/normalized/migration';
import { createNormalizedRepository } from '../../../../services/localWorkspace/normalized/repository';
import { WORKSPACE_DB_NAME } from '../../../../services/localWorkspace/schema';
import { validateWorkspaceProject } from '../../../../services/localWorkspace/validation';
import { CURRENT_SCHEMA_VERSION } from '../../../../services/migration';
import { createIncrementalRepositoryHarness } from '../../../helpers/incrementalStoreHarness';
import { deterministicEnvironment, memoryStorage } from '../../../helpers/localWorkspaceFixtures';
import { done, historicalStores, request } from '../../../helpers/normalizationHarness';

/** IndexedDB exactly as the previous release (schema 11) left it, after it migrated two legacy projects. */
const previousRelease = JSON.parse(readFileSync(new URL('../../../fixtures/localWorkspace/previous-release-schema11-store.json', import.meta.url), 'utf8'));

async function openPreviousRelease() {
  const h = createIncrementalRepositoryHarness(WORKSPACE_DB_NAME);
  const preparation = deterministicEnvironment({ crypto: webcrypto as unknown as Crypto });
  h.environment.normalization = preparation;
  const opening = h.indexedDB.open(h.databaseName, previousRelease.version);
  opening.onupgradeneeded = () => {
    for (const [name, store] of Object.entries<{ keyPath: string }>(previousRelease.stores)) opening.result.createObjectStore(name, { keyPath: store.keyPath });
  };
  const db = await request(opening);
  const tx = db.transaction(Object.keys(previousRelease.stores), 'readwrite'); const completion = done(tx);
  for (const [name, store] of Object.entries<{ rows: unknown[] }>(previousRelease.stores)) for (const row of store.rows) tx.objectStore(name).put(row);
  await completion; db.close();
  const adapter = createIndexedDbAdapter({ indexedDB: h.indexedDB, now: preparation.now }, 3);
  const historical = createHistoricalBootstrap({ ...preparation, adapter: () => adapter,
    legacyStorage: memoryStorage(previousRelease.localStorage), generation: () => 0 });
  const run = () => normalizeWorkspace({ repository: createNormalizedRepository(h.environment), historical, ensurePhysicalLayout: () => adapter.open() });
  const readHistorical = async () => {
    const db = await request(h.indexedDB.open(h.databaseName));
    try {
      const tx = db.transaction(historicalStores, 'readonly'); const completion = done(tx);
      const rows = await Promise.all(historicalStores.map(store => request(tx.objectStore(store).getAll())));
      await completion; return Object.fromEntries(historicalStores.map((store, index) => [store, rows[index]]));
    } finally { db.close(); }
  };
  return { h, run, readHistorical, openLayout: () => adapter.open() };
}

it('the fixture is the previous release: schema 11 projects in its IndexedDB store', () => {
  expect(previousRelease.version).toBe(2);
  expect(previousRelease.stores.projects.rows.map((row: { project: { initialState: { schemaVersion: number } } }) => row.project.initialState.schemaVersion))
    .toEqual([11, 11]);
  expect(CURRENT_SCHEMA_VERSION).toBeGreaterThan(11);
});

it('upgrades projects the previous release stored at an older schema, exactly as a legacy import would', async () => {
  const { h, run, readHistorical } = await openPreviousRelease();
  const before = await readHistorical();
  const result = await run();
  expect(result).toMatchObject({ status: 'active' });

  const active = await createNormalizedRepository(h.environment).readActiveSnapshot();
  const rows = previousRelease.stores.projects.rows as { id: string; project: unknown }[];
  const order = previousRelease.stores.workspace.rows[0].projectOrder as string[];
  expect(active!.snapshot.projects.map(project => project.id)).toEqual(order);
  for (const project of active!.snapshot.projects) {
    const stored = rows.find(row => row.id === project.id)!;
    expect(project.initialState.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(project).toEqual(validateWorkspaceProject(stored.project, { warningPolicy: 'reject' }));
  }
  expect(active!.snapshot.activeProjectId).toBe(previousRelease.stores.workspace.rows[0].activeProjectId);
  // The previous release's project records stay as stored, for recovery and support. Normalization
  // archives its source (including the old workspace record) beside the existing backups.
  const after = await readHistorical();
  for (const store of ['projects', 'presets', 'pendingImports', 'migrationLedger'] as const) expect(after[store]).toEqual(before[store]);
  const archive = after.legacyBackup.find((row: { kind?: string }) => row.kind === 'normalization-source');
  expect(archive.workspace).toEqual(before.workspace[0]);
  expect(after.projects.map((row: { project: { initialState: { schemaVersion: number } } }) => row.project.initialState.schemaVersion)).toEqual([11, 11]);
  expect(after.legacyBackup).toEqual(expect.arrayContaining(before.legacyBackup));
  expect(after.legacyBackup).toHaveLength(before.legacyBackup.length + 1);
});

it('a fresh repository reopens the upgraded workspace', async () => {
  const { h, run } = await openPreviousRelease();
  expect(await run()).toMatchObject({ status: 'active' });
  expect(await run()).toMatchObject({ status: 'active' });
  const reopened = await createNormalizedRepository(h.environment).readActiveSnapshot();
  expect(reopened!.snapshot.projects.every(project => project.initialState.schemaVersion === CURRENT_SCHEMA_VERSION)).toBe(true);
});

it('every source reader sees the same upgraded projects, before and after normalization', async () => {
  const { h, run, openLayout } = await openPreviousRelease();
  const expected = previousRelease.stores.projects.rows.map((row: { project: unknown }) => validateWorkspaceProject(row.project, { warningPolicy: 'reject' }));
  const byOrder = (projects: { id: string }[]) => [...projects].sort((a, b) => a.id.localeCompare(b.id));
  // Before normalization: what the recovery screen offers to download.
  await openLayout();
  const retained = await createNormalizedRepository(h.environment).readRetainedSource();
  expect(byOrder(retained.snapshot.projects)).toEqual(byOrder(expected));
  expect(await run()).toMatchObject({ status: 'active' });
  const repository = createNormalizedRepository(h.environment);
  const [synchronous, cooperative] = [await repository.readNormalizationSource(), await repository.readRetainedSource()];
  expect(byOrder(synchronous.snapshot.projects)).toEqual(byOrder(expected));
  expect(synchronous.sourceDigest).toBe(cooperative.sourceDigest);
  expect(synchronous.contentDigest).toBe(cooperative.contentDigest);
});

describe('upgradeStoredProjectRecord', () => {
  const stored = () => structuredClone(previousRelease.stores.projects.rows[1]);
  const withSchema = (version: number) => { const record = stored(); record.project.initialState.schemaVersion = version; return record; };

  it('upgrades an older-schema project in a copy of the record and leaves the record as stored', () => {
    const record = stored(), before = structuredClone(record);
    const upgraded = upgradeStoredProjectRecord(record) as typeof record;
    expect(record).toEqual(before);
    expect(upgraded).not.toBe(record);
    expect(Object.keys(upgraded)).toEqual(Object.keys(record));
    expect(upgraded.project).toEqual(validateWorkspaceProject(record.project, { warningPolicy: 'reject' }));
    expect(upgraded.project.initialState.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect({ ...upgraded, project: undefined }).toEqual({ ...record, project: undefined });
    // Deterministic, and an upgraded record is already current.
    expect(upgradeStoredProjectRecord(record)).toEqual(upgraded);
    expect(upgradeStoredProjectRecord(upgraded)).toBe(upgraded);
  });

  it.each([
    ['current', CURRENT_SCHEMA_VERSION],
    ['below the oldest stored schema', 10],
    ['future', CURRENT_SCHEMA_VERSION + 1],
  ])('returns a %s-schema record untouched, for the usual strict validation', (_name, version) => {
    const record = withSchema(version);
    expect(upgradeStoredProjectRecord(record)).toBe(record);
  });

  it('still refuses an older-schema project that is invalid', () => {
    const record = stored(); record.project.initialState.rootId = 'missing';
    expect(() => upgradeStoredProjectRecord(record)).toThrow();
  });

  it('reads descriptors only and never invokes a record accessor', () => {
    const record = stored(); let reads = 0;
    const accessor = { ...record }; delete (accessor as { project?: unknown }).project;
    Object.defineProperty(accessor, 'project', { enumerable: true, get() { reads++; return record.project; } });
    expect(upgradeStoredProjectRecord(accessor)).toBe(accessor);
    expect(reads).toBe(0);
  });
});
