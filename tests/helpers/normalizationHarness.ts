import { webcrypto } from 'node:crypto';
import { expect } from 'vitest';
import { createIndexedDbAdapter } from '../../services/localWorkspace/indexedDbAdapter';
import { createHistoricalBootstrap } from '../../services/localWorkspace/historicalBootstrap';
import { prepareInitialCopy } from '../../services/localWorkspace/migration';
import { normalizeWorkspace } from '../../services/localWorkspace/normalized/migration';
import { createNormalizedRepository } from '../../services/localWorkspace/normalized/repository';
import { NORMALIZED_STORE_NAMES } from '../../services/localWorkspace/normalized/schema';
import { WORKSPACE_DB_NAME } from '../../services/localWorkspace/schema';
import { createIncrementalRepositoryHarness, testHash } from './incrementalStoreHarness';
import { deterministicEnvironment, legacySnapshot, memoryStorage, validLegacyValues } from './localWorkspaceFixtures';
import { canonicalStringify } from '../../services/localWorkspace/canonical';
import { createWorkRuntime } from '../../shared/cooperativeWork.js';
import { workspaceManifestCoreFrame, type NormalizedWorkspaceManifest } from '../../services/localWorkspace/normalized/workspaceManifest';
import { appendWorkspaceReceipt, workspaceReceiptFrame } from '../../services/localWorkspace/normalized/workspaceCommitProof';
import { hashFrame } from '../../services/localWorkspace/normalized/work';

export const historicalStores = ['projects', 'workspace', 'presets', 'pendingImports', 'migrationLedger', 'legacyBackup'] as const;
export const request = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
});
export const done = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
});

export async function createNormalizationHarness({ version = 2, faultAt, legacyValues = validLegacyValues(), outOfLineNodes = false }: { version?: 1 | 2; faultAt?: 'after-stage' | 'after-verify' | 'after-cutover'; legacyValues?: Record<string, string>; outOfLineNodes?: boolean } = {}) {
  const h = createIncrementalRepositoryHarness(WORKSPACE_DB_NAME);
  const preparation = deterministicEnvironment({ crypto: webcrypto as unknown as Crypto });
  h.environment.normalization = preparation;
  const prepared = await prepareInitialCopy(legacySnapshot(legacyValues), preparation);
  const source = {
    projects: structuredClone(prepared.projects).map(record => {
      if (version === 1) Reflect.deleteProperty(record, 'incarnation');
      return record;
    }),
    workspace: [prepared.workspace], presets: prepared.presets, pendingImports: prepared.pendingImports,
    migrationLedger: [{ ...prepared.ledger, indexedDbVersion: version }], legacyBackup: [prepared.backup],
  };
  const opening = h.indexedDB.open(h.databaseName, version);
  opening.onupgradeneeded = () => {
    for (const store of historicalStores) opening.result.createObjectStore(store, { keyPath: 'id' });
    if (outOfLineNodes) opening.result.createObjectStore('projectNodes');
  };
  const db = await request(opening);
  const tx = db.transaction(historicalStores, 'readwrite'); const completion = done(tx);
  for (const store of historicalStores) for (const record of source[store]) tx.objectStore(store).put(record);
  await completion; db.close();
  const adapter = createIndexedDbAdapter({ indexedDB: h.indexedDB, now: preparation.now }, 3);
  const inspectFresh = async () => {
    const db = await request(h.indexedDB.open(h.databaseName));
    try {
      const tx = db.transaction(historicalStores, 'readonly'); const completion = done(tx);
      const rows = await Promise.all(historicalStores.map(store => request(tx.objectStore(store).getAll())));
      await completion;
      return { version: db.version, stores: Array.from(db.objectStoreNames),
        source: Object.fromEntries(historicalStores.map((store, index) => [store, rows[index]])) };
    } finally { db.close(); }
  };
  const legacyStorage = memoryStorage(legacyValues);
  const historical = createHistoricalBootstrap({ ...preparation, adapter: () => adapter,
    legacyStorage, generation: () => 0 });
  const run = async () => {
    return normalizeWorkspace({ repository: createNormalizedRepository(h.environment),
      historical, ensurePhysicalLayout: () => adapter.open(), checkpoint: point => {
        if (point === faultAt) throw new Error(`Owner interrupted: ${point}`);
      } });
  };
  return { ...h, source, prepared, adapter, preparation, historical, legacyStorage, inspectFresh,
    run, clearFault: () => { faultAt = undefined; },
    runUntilInterrupted: async () => {
      expect(await run()).toMatchObject({ status: 'recovery', recovery: { message: `Owner interrupted: ${faultAt}` } });
      const db = await request(h.indexedDB.open(h.databaseName));
      const tx = db.transaction('normalizationLedger', 'readonly'); const completion = done(tx);
      const markers = await request(tx.objectStore('normalizationLedger').getAll()); await completion; db.close();
      expect(markers).toHaveLength(1);
      expect(markers[0].state).toBe(faultAt === 'after-stage' ? 'staging' : faultAt === 'after-verify' ? 'verified' : 'active');
      expect(markers[0].nextRecord).toBeGreaterThan(0);
    },
    bootstrapFresh: async () => { const result = await run(); return result.status === 'active' ? { ...result, status: 'ready' } : result; },
    exportSource: async () => {
      await adapter.open();
      const db = await request(h.indexedDB.open(h.databaseName));
      const tx = db.transaction('normalizationLedger', 'readonly'); const completion = done(tx);
      const markers = await request(tx.objectStore('normalizationLedger').getAll()); await completion; db.close();
      if (!markers.length) expect((await historical.bootstrap(() => {}, { allowCopiedReplacement: false })).status).toBe('admitted');
      return (await createNormalizedRepository(h.environment).readNormalizationSource()).snapshot;
    },
    exportActive: async () => {
      const repository = createNormalizedRepository(h.environment);
      const active = await repository.readActiveSnapshot();
      expect(active).toBeDefined();
      return active!.snapshot;
    },
    countActiveAuthorities: async () => {
      const db = await request(h.indexedDB.open(h.databaseName));
      const tx = db.transaction('normalizationLedger', 'readonly'); const completion = done(tx);
      const markers = await request(tx.objectStore('normalizationLedger').getAll()); await completion; db.close();
      return markers.filter(marker => marker.state === 'active').length;
    },
  };
}

// Independent physical inspection/mutation: no repository image/cache is an oracle.
export async function physicalRows(h: { indexedDB: IDBFactory; databaseName: string }, stores: readonly string[] = NORMALIZED_STORE_NAMES) {
  const db = await request(h.indexedDB.open(h.databaseName));
  try {
    const tx = db.transaction([...stores], 'readonly'); const completion = done(tx);
    const rows = await Promise.all(stores.map(store => request(tx.objectStore(store).getAll())));
    await completion; return Object.fromEntries(stores.map((store, i) => [store, rows[i]]));
  } finally { db.close(); }
}
export async function mutateRow(h: { indexedDB: IDBFactory; databaseName: string }, store: string, change: (store: IDBObjectStore) => void) {
  const db = await request(h.indexedDB.open(h.databaseName));
  try {
    const tx = db.transaction(store, 'readwrite'); const completion = done(tx);
    change(tx.objectStore(store)); await completion;
  } finally { db.close(); }
}
export function freshHarness() {
  const h = createIncrementalRepositoryHarness(WORKSPACE_DB_NAME);
  let uuid = 0;
  const preparation = deterministicEnvironment({ crypto: webcrypto as unknown as Crypto, randomUUID: () => `seed-${++uuid}` });
  h.environment.normalization = preparation;
  const adapter = createIndexedDbAdapter({ indexedDB: h.indexedDB, now: preparation.now }, 3);
  const legacyStorage = memoryStorage({});
  const historical = createHistoricalBootstrap({ ...preparation, adapter: () => adapter, legacyStorage, generation: () => 0 });
  const run = () => normalizeWorkspace({ repository: createNormalizedRepository(h.environment), historical, ensurePhysicalLayout: () => adapter.open() });
  return { ...h, preparation, adapter, historical, legacyStorage, run };
}

/** Fixture metadata for explicitly seeded ancillary layouts; not a lifecycle writer. */
export async function refreshAncillaryManifestFixture(h: { indexedDB: IDBFactory; databaseName: string }) {
  const rows = await physicalRows(h, ['workspace', 'presets', 'pendingImports']);
  const before = rows.workspace[0] as NormalizedWorkspaceManifest;
  const next = { ...before, revision: before.revision + 1,
    presets: rows.presets.sort((a, b) => a.position - b.position).map(row => ({ id: row.id, position: row.position,
      recordDigest: testHash(canonicalStringify(['workspace-preset-v1', row])) })),
    pendingImports: rows.pendingImports.sort((a, b) => a.position - b.position).map(row => ({ id: row.id, position: row.position,
      targetProjectId: row.pendingImport.targetProjectId, createdAt: row.pendingImport.createdAt,
      recordDigest: testHash(canonicalStringify(['workspace-import-v1', row])),
      pendingImportDigest: testHash(canonicalStringify(row.pendingImport)),
      ...(Object.hasOwn(row, 'attemptProvenance') ? { attemptProvenance: row.attemptProvenance } : {}) })) };
  const work = createWorkRuntime({ assertCurrent() {} });
  try {
    next.coreDigest = await hashFrame(work, 'proof', workspaceManifestCoreFrame(next));
    const core = { identity: { clientId: 'ancillary-fixture', commandId: `ancillary-${next.revision}`, commandSequence: next.revision },
      requestDigest: testHash(`ancillary-${next.revision}`), before: { revision: before.revision, coreDigest: before.coreDigest },
      after: { revision: next.revision, coreDigest: next.coreDigest }, postconditionDigest: testHash(canonicalStringify([next.presets, next.pendingImports])) };
    next.lastCommit = { ...core, proofDigest: await hashFrame(work, 'proof', workspaceReceiptFrame(core)) };
    next.commitWindow = await appendWorkspaceReceipt(before.commitWindow, next.lastCommit, work);
    await mutateRow(h, 'workspace', store => store.put(next));
  } finally { work.dispose(); }
}
