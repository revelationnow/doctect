// @vitest-environment node
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import {
  IDBFactory,
  IDBVersionChangeEvent as FakeIDBVersionChangeEvent,
  forceCloseDatabase,
} from 'fake-indexeddb';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  localWorkspaceStore,
  type LocalWorkspaceEnvironment,
} from '../../../services/localWorkspace';
import {
  createLocalWorkspaceStoreForTesting as createLocalWorkspaceStore,
} from '../../../services/localWorkspace/LocalWorkspaceStore';
import type {
  WorkspaceBootstrapObserver,
  WorkspaceBootstrapResult,
} from '../../../services/localWorkspace/contracts';
import type { WorkspaceFaultPoint } from '../../../services/localWorkspace/faults';
import {
  createIndexedDbAdapter,
  type IndexedDbInspection,
} from '../../../services/localWorkspace/indexedDbAdapter';
import {
  canonicalStringify,
  digestLegacySnapshot,
} from '../../../services/localWorkspace/canonical';
import { captureLegacySnapshot, captureStableLegacySnapshot, captureStableLegacySnapshotWithDigest } from '../../../services/localWorkspace/legacy';
import { makeWorkHarness } from '../../helpers/normalizationWorkHarness';
import { isRecognizedLedger, isRecognizedLedgerWork, isHistoricalLineageLedger,
  isHistoricalLineageLedgerWork, validateHistoricalBackup, classifyHistoricalInspection,
  classifyHistoricalInspectionWork } from '../../../services/localWorkspace/historicalBootstrap';
import { prepareLineageRepair } from '../../../services/localWorkspace/lineageRepair';
import {
  prepareInitialCopy,
  type PreparedInitialCopy,
} from '../../../services/localWorkspace/migration';
import {
  WORKSPACE_DB_NAME,
  WORKSPACE_DB_VERSION,
  WORKSPACE_MIGRATION_ID,
  storedProjectLineage,
  type HistoricalMigrationLedgerV1,
  type MigrationLedger,
} from '../../../services/localWorkspace/schema';
import {
  LEGACY_DOCUMENT_KEYS,
  LEGACY_KEYS,
  MemoryStorage,
  currentState,
  legacyCustomPreset,
  legacyProject,
  legacySnapshot,
  memoryStorage,
  secondProject,
  validLegacyValues,
} from '../../helpers/localWorkspaceFixtures';

const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const TEST_NOW = '2026-08-14T15:00:00.000Z';
const VERIFIED_NOW = '2026-08-14T16:00:00.000Z';
const STORE_NAMES = [
  'projects',
  'workspace',
  'presets',
  'pendingImports',
  'migrationLedger',
  'legacyBackup',
] as const;
type StoreName = typeof STORE_NAMES[number];

const COPY_TRANSACTION_FAULTS = [
  'copy.before-transaction',
  'copy.after-projects',
  'copy.after-workspace',
  'copy.after-presets',
  'copy.after-pending-imports',
  'copy.after-backup',
  'copy.after-ledger',
  'copy.before-complete',
] as const satisfies readonly WorkspaceFaultPoint[];

const LINEAGE_REPAIR_FAULTS = [
  'lineage-repair.before-transaction',
  'lineage-repair.after-project-write',
  'lineage-repair.after-ledger-write',
  'lineage-repair.before-complete',
] as const satisfies readonly WorkspaceFaultPoint[];

beforeAll(() => Object.defineProperty(globalThis, 'crypto', {
  configurable: true,
  value: webcrypto,
}));

afterAll(() => {
  if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto);
  else Reflect.deleteProperty(globalThis, 'crypto');
});

beforeEach(() => vi.spyOn(console, 'log').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe('cooperative historical inspection classification', () => {
  const empty = (): IndexedDbInspection => ({ projects: [], workspace: [], presets: [], pendingImports: [], migrationLedger: [], legacyBackup: [] });

  it('classifies empty storage without hashing or allocating source captures', async () => {
    const h = makeWorkHarness('prerequisite'); const inspection = empty();
    expect(await h.runtime.run(classifyHistoricalInspectionWork(inspection))).toEqual({ kind: 'empty' });
    expect(classifyHistoricalInspection(inspection)).toEqual({ kind: 'empty' });
    expect(h.runtime.snapshot()).toMatchObject({ writes: 0, hashBytes: 0, captureHighWater: 0 });
  });

  it.each(STORE_NAMES.filter(name => name !== 'migrationLedger'))('rejects orphaned %s rows', async name => {
    const inspection = empty(); (inspection[name] as unknown[]).push({ id: 'orphan' });
    expect(await makeWorkHarness('prerequisite').runtime.run(classifyHistoricalInspectionWork(inspection)))
      .toEqual(classifyHistoricalInspection(inspection));
    expect(classifyHistoricalInspection(inspection)).toEqual({ kind: 'unrecognized' });
  });

  it.each([1, 2])('retains version %i state classifications and ledger identity', async version => {
    const prepared = await prepareFor(createHarness());
    for (const state of ['copied', 'verified', 'cleanup-started', 'cleanup-complete'] as const) {
      const ledger = { ...prepared.ledger, indexedDbVersion: version, state, verifiedAt: state === 'copied' ? null : VERIFIED_NOW };
      const inspection = { ...empty(), migrationLedger: [ledger] } as IndexedDbInspection;
      const actual = await makeWorkHarness('prerequisite').runtime.run(classifyHistoricalInspectionWork(inspection));
      expect(actual).toEqual(classifyHistoricalInspection(inspection));
      expect(actual.kind).toBe(version === 1 ? 'historical-lineage' : 'current');
      if (actual.kind === 'current' || actual.kind === 'historical-lineage') expect(actual.ledger).toBe(ledger);
    }
  });

  it.each(['multiple', 'invalid', 'unsupported'] as const)('rejects %s ledgers identically', async kind => {
    const prepared = await prepareFor(createHarness()); const ledger = prepared.ledger;
    const inspection = { ...empty(), migrationLedger: kind === 'multiple' ? [ledger, ledger]
      : [kind === 'invalid' ? { ...ledger, sourceDigest: 'wrong' } : { ...ledger, indexedDbVersion: 99 }] } as IndexedDbInspection;
    expect(await makeWorkHarness('prerequisite').runtime.run(classifyHistoricalInspectionWork(inspection)))
      .toEqual({ kind: 'unrecognized' });
    expect(classifyHistoricalInspection(inspection)).toEqual({ kind: 'unrecognized' });
  });

  it.each([1, 2])('cancels during version %i fingerprint traversal', async version => {
    const prepared = await prepareFor(createHarness()); const h = makeWorkHarness('prerequisite'); h.observe(h.cancel);
    const inspection = { ...empty(), migrationLedger: [{ ...prepared.ledger, indexedDbVersion: version,
      counts: { ...prepared.ledger.counts, sourceProjects: 3000, targetProjects: 3000 },
      projectFingerprints: Array.from({ length: 3000 }, (_, sourceIndex) => ({ sourceIndex, id: `p${sourceIndex}`, digest: 'f'.repeat(64) })),
    }] } as IndexedDbInspection;
    await expect(h.runtime.run(classifyHistoricalInspectionWork(inspection))).rejects.toMatchObject({ name: 'AbortError' });
    expect(h.runtime.snapshot().visits).toBeGreaterThan(0); expect(h.runtime.snapshot().writes).toBe(0);
  });

  it('rejects before inspecting storage when already cancelled', async () => {
    const h = makeWorkHarness('prerequisite'); h.cancel(); const inspection = empty();
    const get = vi.fn(() => []);
    Object.defineProperty(inspection, 'migrationLedger', { get });
    await expect(h.runtime.run(classifyHistoricalInspectionWork(inspection))).rejects.toMatchObject({ name: 'AbortError' });
    expect(get).not.toHaveBeenCalled();
  });
});

describe('cooperative historical ledger and backup validation', () => {
  const subtle = webcrypto.subtle as unknown as SubtleCrypto;

  it.each([1, 2])('preserves version %i classification and all historical states', async version => {
    const prepared = await prepareFor(createHarness());
    for (const state of ['copied', 'verified', 'cleanup-started', 'cleanup-complete']) {
      const ledger = { ...prepared.ledger, indexedDbVersion: version, state, verifiedAt: state === 'copied' ? null : VERIFIED_NOW };
      const h = makeWorkHarness('prerequisite');
      expect(isRecognizedLedger(ledger)).toBe(version === 2);
      expect(isHistoricalLineageLedger(ledger)).toBe(version === 1);
      expect(await h.runtime.run(isRecognizedLedgerWork(ledger))).toBe(version === 2);
      expect(await h.runtime.run(isHistoricalLineageLedgerWork(ledger))).toBe(version === 1);
      expect(h.runtime.snapshot().visits).toBeGreaterThan(0);
    }
  });

  it.each([
    ['unknown ledger field', (v: any) => { v.extra = true; }],
    ['missing ledger field', (v: any) => { delete v.sourceDigest; }],
    ['wrong rollout epoch', (v: any) => { v.persistenceRolloutEpoch += 1; }],
    ['wrong ID', (v: any) => { v.id = 'other'; }],
    ['empty backup ID', (v: any) => { v.originalLegacyBackupId = ''; }],
    ['bad digest', (v: any) => { v.sourceDigest = 'bad'; }],
    ['bad timestamp', (v: any) => { v.migratedAt = '2026-08-14'; }],
    ['copied with verified time', (v: any) => { v.verifiedAt = VERIFIED_NOW; }],
    ['verified without time', (v: any) => { v.state = 'verified'; }],
    ['bad key order', (v: any) => { v.keyFingerprints.reverse(); }],
    ['bad key presence', (v: any) => { v.keyFingerprints[0].present = 1; }],
    ['bad source index', (v: any) => { v.projectFingerprints[0].sourceIndex = 1; }],
    ['extra fingerprint field', (v: any) => { v.projectFingerprints[0].extra = true; }],
    ['duplicate fingerprint IDs', (v: any) => { v.projectFingerprints.push({ ...v.projectFingerprints[0], sourceIndex: 1 }); v.counts.sourceProjects = 2; }],
    ['empty target', (v: any) => { v.counts.targetProjects = 0; }],
    ['wrong source count', (v: any) => { v.counts.sourceProjects += 1; }],
    ['bad recovery marker', (v: any) => { v.unresolvedRecovery = { id: 'r', kind: 'unknown', detectedAt: TEST_NOW }; }],
  ])('retains %s rejection in the shared ledger rules', async (_label, corrupt) => {
    const { ledger } = await prepareFor(createHarness());
    corrupt(ledger);
    expect(isRecognizedLedger(ledger)).toBe(false);
    expect(await makeWorkHarness('prerequisite').runtime.run(isRecognizedLedgerWork(ledger))).toBe(false);
  });

  it('preserves sparse fingerprint acceptance and long historical backup identifiers', async () => {
    const { ledger } = await prepareFor(createHarness());
    ledger.projectFingerprints = new Array(3);
    ledger.counts.sourceProjects = 3;
    delete ledger.keyFingerprints[0];
    ledger.originalLegacyBackupId = '历史'.repeat(1000);
    expect(isRecognizedLedger(ledger)).toBe(true);
    expect(await makeWorkHarness('prerequisite').runtime.run(isRecognizedLedgerWork(ledger))).toBe(true);
  });

  it.each(['legacy-drift', 'target-mismatch', 'unknown-target'] as const)('preserves recognized %s recovery markers', async kind => {
    const { ledger } = await prepareFor(createHarness());
    ledger.unresolvedRecovery = { id: 'recovery', kind, detectedAt: TEST_NOW, observedLegacyDigest: undefined };
    expect(isRecognizedLedger(ledger)).toBe(true);
    expect(await makeWorkHarness('prerequisite').runtime.run(isRecognizedLedgerWork(ledger))).toBe(true);
  });

  it.each([1, 2])('cancels large version %i fingerprint traversal', async version => {
    const { ledger } = await prepareFor(createHarness());
    const candidate = { ...ledger, indexedDbVersion: version,
      projectFingerprints: Array.from({ length: 10000 }, (_, index) => ({ sourceIndex: index, id: `p${index}`, digest: 'a'.repeat(64) })),
      counts: { ...ledger.counts, sourceProjects: 10000 } };
    const h = makeWorkHarness('prerequisite');
    h.observe(() => h.cancel());
    await expect(h.runtime.run(version === 2 ? isRecognizedLedgerWork(candidate) : isHistoricalLineageLedgerWork(candidate)))
      .rejects.toMatchObject({ name: 'AbortError' });
  });

  it('hashes a valid backup once cooperatively and returns the original row', async () => {
    const { backup } = await prepareFor(createHarness());
    const expected = { id: backup.id, digest: backup.digest, kind: backup.kind, capturedAt: backup.capturedAt };
    const reference = makeWorkHarness('prerequisite');
    await digestLegacySnapshot(backup.snapshot, subtle, reference.runtime);
    const h = makeWorkHarness('prerequisite');
    const digest = vi.fn(() => { throw new Error('No native digest on Work path'); });
    expect(await validateHistoricalBackup(backup, expected, { digest } as unknown as SubtleCrypto, h.runtime)).toBe(backup);
    expect(h.runtime.snapshot().backupValidations).toBe(1);
    expect(h.runtime.snapshot().legacyHashBytes).toBe(reference.runtime.snapshot().legacyHashBytes);
    expect(digest).not.toHaveBeenCalled();
  });

  it.each(['id', 'digest', 'kind', 'capturedAt'] as const)('checks expected backup %s before hashing', async field => {
    const { backup } = await prepareFor(createHarness());
    const expected = { id: backup.id, digest: backup.digest, kind: backup.kind, capturedAt: backup.capturedAt };
    if (field === 'id') expected.id = 'wrong';
    if (field === 'digest') expected.digest = 'f'.repeat(64);
    if (field === 'kind') expected.kind = 'conflict';
    if (field === 'capturedAt') expected.capturedAt = VERIFIED_NOW;
    const h = makeWorkHarness('prerequisite');
    await expect(validateHistoricalBackup(backup, expected, subtle, h.runtime)).rejects.toMatchObject({ category: 'verification-failed' });
    expect(h.runtime.snapshot().legacyHashBytes).toBe(0);
    expect(h.runtime.snapshot().visits).toBeGreaterThan(0);
  });

  it('rejects changed backup bytes and normalization archives', async () => {
    const { backup } = await prepareFor(createHarness());
    const expected = { id: backup.id, digest: backup.digest };
    backup.snapshot[LEGACY_KEYS.projects].raw = 'changed';
    const h = makeWorkHarness('prerequisite');
    await expect(validateHistoricalBackup(backup, expected, subtle, h.runtime)).rejects.toMatchObject({ category: 'verification-failed' });
    expect(h.runtime.snapshot().legacyHashBytes).toBeGreaterThan(0);
    const archive = { ...backup, kind: 'normalization-source' };
    await expect(validateHistoricalBackup(archive, expected, subtle, h.runtime)).rejects.toMatchObject({ category: 'verification-failed' });
  });

  it('cancels backup hashing without returning a validated row', async () => {
    const { backup } = await prepareFor(createHarness());
    backup.snapshot[LEGACY_KEYS.projects].raw = '😀'.repeat(16000);
    backup.digest = await digestLegacySnapshot(backup.snapshot, subtle);
    const h = makeWorkHarness('prerequisite');
    h.observe(() => h.cancel());
    await expect(validateHistoricalBackup(backup, { id: backup.id, digest: backup.digest }, subtle, h.runtime))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(h.runtime.snapshot().ownedBytes).toBe(0);
  });

  it.each([
    ['extra backup field', (v: any) => { v.extra = true; }],
    ['extra snapshot field', (v: any) => { v.snapshot.extra = true; }],
    ['bad presence flag', (v: any) => { v.snapshot[LEGACY_KEYS.projects].present = 1; }],
    ['absent non-null raw value', (v: any) => { v.snapshot[LEGACY_KEYS.projects].present = false; }],
    ['noncanonical timestamp', (v: any) => { v.capturedAt = '2026-08-14'; }],
    ['non-plain snapshot', (v: any) => { v.snapshot = Object.assign(Object.create(null), v.snapshot); }],
  ])('rejects %s without hashing payloads', async (_label, corrupt) => {
    const { backup } = await prepareFor(createHarness());
    const expected = { id: backup.id, digest: backup.digest };
    corrupt(backup);
    const digest = vi.fn(async () => new Uint8Array(32).buffer);
    await expect(validateHistoricalBackup(backup, expected, { digest } as unknown as SubtleCrypto))
      .rejects.toMatchObject({ category: 'verification-failed' });
    expect(digest).not.toHaveBeenCalled();
    const h = makeWorkHarness('prerequisite');
    await expect(validateHistoricalBackup(backup, expected, subtle, h.runtime))
      .rejects.toMatchObject({ category: 'verification-failed' });
    expect(h.runtime.snapshot().backupValidations).toBe(0);
  });

  it('keeps the no-work injected single-hash contract', async () => {
    const { backup } = await prepareFor(createHarness());
    const digest = vi.fn((algorithm: AlgorithmIdentifier, data: BufferSource) => subtle.digest(algorithm, data));
    expect(await validateHistoricalBackup(backup, { id: backup.id, digest: backup.digest }, { digest } as unknown as SubtleCrypto)).toBe(backup);
    expect(digest).toHaveBeenCalledTimes(1);
  });

  it('compares long backup IDs cooperatively without imposing private normalized ID limits', async () => {
    const { backup } = await prepareFor(createHarness());
    backup.id = '历史-backup-'.repeat(2000);
    const h = makeWorkHarness('prerequisite');
    expect(await validateHistoricalBackup(backup, { id: backup.id, digest: backup.digest }, subtle, h.runtime)).toBe(backup);
    expect(h.runtime.snapshot().comparedCodeUnits).toBeGreaterThanOrEqual(backup.id.length);
  });
});

describe('cooperative stable legacy capture', () => {
  const subtle = webcrypto.subtle as unknown as SubtleCrypto;

  it('counts twelve reads and three exact hashes with no observer after the final native tail', async () => {
    const values = { [LEGACY_KEYS.projects]: ' café☕\ud800😀 '.repeat(100), [LEGACY_KEYS.activeProject]: '' };
    const snapshot = legacySnapshot(values);
    const reference = makeWorkHarness('legacy-fence');
    const digest = await digestLegacySnapshot(snapshot, subtle, reference.runtime);
    const trace: string[] = [];
    const storage = new MemoryStorage(values, count => { trace.push(`read:${count}`); });
    const h = makeWorkHarness('legacy-fence');
    h.observe(() => { trace.push('observer'); });
    const cryptoDigest = vi.fn(() => { throw new Error('No SubtleCrypto under cooperative work'); });
    const result = await captureStableLegacySnapshotWithDigest(storage, { digest: cryptoDigest } as unknown as SubtleCrypto, {
      work: h.runtime, generation: () => 7, expected: { snapshot, digest, generation: 7 },
    });
    expect(result).toEqual({ snapshot, digest });
    expect(storage.reads).toEqual([...LEGACY_DOCUMENT_KEYS, ...LEGACY_DOCUMENT_KEYS, ...LEGACY_DOCUMENT_KEYS]);
    expect(h.runtime.snapshot().legacyCaptures).toBe(1);
    expect(h.runtime.snapshot().legacyReads).toBe(12);
    expect(h.runtime.snapshot().legacyReadBytes).toBe(3 * new TextEncoder().encode(values[LEGACY_KEYS.projects]).byteLength);
    expect(h.runtime.snapshot().legacyHashBytes).toBe(3 * reference.runtime.snapshot().legacyHashBytes);
    expect(h.runtime.snapshot().ownedBytes).toBe(0);
    expect(trace.slice(trace.indexOf('read:9'))).toEqual(['read:9', 'read:10', 'read:11', 'read:12']);
    expect(cryptoDigest).not.toHaveBeenCalled();
    expect(storage.mutations).toEqual([]);
  });

  it.each(['raw', 'presence', 'digest', 'generation'] as const)('rejects a mismatched expected %s in the final tail', async field => {
    const values = { [LEGACY_KEYS.projects]: '[]', [LEGACY_KEYS.activeProject]: '' };
    const snapshot = legacySnapshot(values);
    const expected = { snapshot: structuredClone(snapshot), digest: await digestLegacySnapshot(snapshot, subtle), generation: 2 };
    if (field === 'raw') expected.snapshot[LEGACY_KEYS.projects].raw = ' []';
    if (field === 'presence') expected.snapshot[LEGACY_KEYS.activeProject] = { present: false, raw: null };
    if (field === 'digest') expected.digest = 'f'.repeat(64);
    if (field === 'generation') expected.generation = 3;
    const h = makeWorkHarness('legacy-fence');
    const storage = memoryStorage(values);
    await expect(captureStableLegacySnapshotWithDigest(storage, subtle, {
      work: h.runtime, generation: () => 2, expected,
    })).rejects.toMatchObject({ name: 'LegacyCaptureError', category: 'legacy-changing' });
    expect(h.runtime.snapshot().legacyReads).toBe(12);
    expect(h.runtime.snapshot().ownedBytes).toBe(0);
  });

  it('weights changed final-read strings on failure rather than reusing old byte counts', async () => {
    const changed = '😀'.repeat(100);
    const storage = new MemoryStorage({ [LEGACY_KEYS.projects]: 'a' }, (count, current) => {
      if (count === 8) current.seed(LEGACY_KEYS.projects, changed);
    });
    const h = makeWorkHarness('legacy-fence');
    await expect(captureStableLegacySnapshotWithDigest(storage, subtle, { work: h.runtime }))
      .rejects.toMatchObject({ category: 'legacy-changing' });
    expect(h.runtime.snapshot().legacyReadBytes).toBe(2 + new TextEncoder().encode(changed).byteLength);
    expect(h.runtime.snapshot().legacyReads).toBe(12);
    expect(h.runtime.snapshot().ownedBytes).toBe(0);
  });

  it('retries generation-only drift and accounts every attempted capture', async () => {
    let generation = 0;
    const storage = new MemoryStorage({ [LEGACY_KEYS.projects]: '[]' }, count => { if (count === 4) generation += 1; });
    const h = makeWorkHarness('legacy-fence');
    await captureStableLegacySnapshotWithDigest(storage, subtle, { generation: () => generation, work: h.runtime });
    expect(h.runtime.snapshot().legacyCaptures).toBe(2);
    expect(h.runtime.snapshot().legacyReads).toBe(24);
    expect(h.runtime.snapshot().retries).toBe(1);
    expect(h.runtime.snapshot().ownedBytes).toBe(0);
  });

  it('preserves bounded generation retries without publishing an unstable result', async () => {
    let generation = 0;
    const storage = new MemoryStorage({ [LEGACY_KEYS.projects]: '[]' }, count => { if (count % 12 === 4) generation += 1; });
    const h = makeWorkHarness('legacy-fence');
    await expect(captureStableLegacySnapshotWithDigest(storage, subtle, {
      generation: () => generation, generationRetries: 1, work: h.runtime,
    })).rejects.toMatchObject({ category: 'legacy-changing' });
    expect(h.runtime.snapshot().legacyReads).toBe(24);
    expect(h.runtime.snapshot().retries).toBe(1);
  });

  it('cancellation in a native read prevents the next read in that capture', async () => {
    const h = makeWorkHarness('legacy-fence');
    const storage = new MemoryStorage({}, count => { if (count === 2) h.cancel(); });
    await expect(captureStableLegacySnapshotWithDigest(storage, subtle, { work: h.runtime }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(storage.reads).toHaveLength(2);
    expect(h.runtime.snapshot().legacyReads).toBe(2);
  });

  it('lifecycle loss during preparation wins over the callback error', async () => {
    const h = makeWorkHarness('legacy-fence');
    const storage = memoryStorage({ [LEGACY_KEYS.projects]: '[]' });
    await expect(captureStableLegacySnapshot(storage, () => {
      h.cancel(); throw new Error('callback failure');
    }, subtle, { work: h.runtime })).rejects.toMatchObject({ name: 'AbortError' });
    expect(storage.reads).toHaveLength(4);
    expect(h.runtime.snapshot().ownedBytes).toBe(0);
  });

  it('keeps exact source comparison when injected no-work hashes collide', async () => {
    const storage = new MemoryStorage({ [LEGACY_KEYS.projects]: '[]' }, (count, current) => {
      if (count === 4) current.seed(LEGACY_KEYS.projects, ' []');
    });
    const digest = vi.fn(async () => new Uint8Array(32).buffer);
    await expect(captureStableLegacySnapshotWithDigest(storage, { digest } as unknown as SubtleCrypto))
      .rejects.toMatchObject({ category: 'legacy-changing' });
    expect(digest).toHaveBeenCalledTimes(3);
    expect(storage.reads).toHaveLength(12);
  });

  it('enforces expected raw identity without work even when its digest matches', async () => {
    const values = { [LEGACY_KEYS.projects]: '[]' };
    const expected = { snapshot: legacySnapshot({ [LEGACY_KEYS.projects]: ' []' }), digest: '0'.repeat(64), generation: 0 };
    const digest = vi.fn(async () => new Uint8Array(32).buffer);
    await expect(captureStableLegacySnapshotWithDigest(memoryStorage(values), { digest } as unknown as SubtleCrypto, {
      generation: () => 0, expected,
    })).rejects.toMatchObject({ category: 'legacy-changing' });
    expect(digest).toHaveBeenCalledTimes(3);
  });

  it('removes the invocation guard after a successful capture', async () => {
    let valid = true;
    const h = makeWorkHarness('legacy-fence');
    await captureStableLegacySnapshotWithDigest(memoryStorage(), subtle, {
      work: h.runtime, assertCurrent: () => { if (!valid) throw new Error('old guard retained'); },
    });
    valid = false;
    await expect(h.runtime.run((function* () {
      yield { visits: 1, utf8Bytes: 0, run() {} };
      return 'current';
    })())).resolves.toBe('current');
  });

  it('checks invocation guard between final-tail native reads', async () => {
    let valid = true;
    const error = new Error('capture owner lost');
    const h = makeWorkHarness('legacy-fence');
    const storage = new MemoryStorage({}, count => { if (count === 10) valid = false; });
    await expect(captureStableLegacySnapshotWithDigest(storage, subtle, {
      work: h.runtime, assertCurrent: () => { if (!valid) throw error; },
    })).rejects.toBe(error);
    expect(storage.reads).toHaveLength(10);
    expect(h.runtime.snapshot().ownedBytes).toBe(0);
  });
});

const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener(
      'abort',
      () => reject(transaction.error ?? new DOMException('Transaction aborted.', 'AbortError')),
      { once: true },
    );
    transaction.addEventListener(
      'error',
      () => reject(transaction.error ?? new DOMException('Transaction failed.', 'UnknownError')),
      { once: true },
    );
  });

const openRaw = (
  indexedDB: IDBFactory,
  version?: number,
): Promise<IDBDatabase> => requestResult(
  version === undefined
    ? indexedDB.open(WORKSPACE_DB_NAME)
    : indexedDB.open(WORKSPACE_DB_NAME, version),
);

const putRaw = async (
  indexedDB: IDBFactory,
  storeName: StoreName,
  value: unknown,
): Promise<void> => {
  const database = await openRaw(indexedDB);
  const transaction = database.transaction(storeName, 'readwrite');
  transaction.objectStore(storeName).put(value);
  await transactionDone(transaction);
  database.close();
};

const deferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
};

interface TestHarnessOptions {
  indexedDB?: IDBFactory;
  storage?: MemoryStorage | Pick<Storage, 'getItem'>;
  values?: Record<string, string>;
  crypto?: Crypto;
  now?: () => string;
  randomUUID?: () => string;
  createBlankProject?: () => ReturnType<typeof currentState>;
  fault?: (point: WorkspaceFaultPoint) => void;
}

interface TestHarness {
  environment: LocalWorkspaceEnvironment;
  indexedDB: IDBFactory;
  storage: MemoryStorage | Pick<Storage, 'getItem'>;
  listeners: Set<(event: StorageEvent) => void>;
  addStorageListener: ReturnType<typeof vi.fn>;
  unsubscribe: () => void;
  createBlankProject: ReturnType<typeof vi.fn>;
  setFault(point?: WorkspaceFaultPoint): void;
  dispatchStorage(key: string | null): void;
}

const createHarness = (options: TestHarnessOptions = {}): TestHarness => {
  const indexedDB = options.indexedDB ?? new IDBFactory();
  const storage = options.storage ?? memoryStorage(options.values ?? validLegacyValues());
  const listeners = new Set<(event: StorageEvent) => void>();
  const unsubscribe = vi.fn(() => {});
  const addStorageListener = vi.fn((listener: (event: StorageEvent) => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      unsubscribe();
    };
  });
  const createBlankProject = vi.fn(options.createBlankProject ?? currentState);
  let faultPoint: WorkspaceFaultPoint | undefined;
  const environment: LocalWorkspaceEnvironment = {
    indexedDB,
    legacyStorage: storage,
    addStorageListener,
    crypto: options.crypto ?? webcrypto as unknown as Crypto,
    now: options.now ?? (() => TEST_NOW),
    randomUUID: options.randomUUID ?? (() => 'fixture-uuid'),
    createBlankProject,
    fault: options.fault ?? (point => {
      if (point === faultPoint) throw new Error(`Injected fault at ${point}.`);
    }),
  };

  return {
    environment,
    indexedDB,
    storage,
    listeners,
    addStorageListener,
    unsubscribe,
    createBlankProject,
    setFault(point) {
      faultPoint = point;
    },
    dispatchStorage(key) {
      const event = { key } as StorageEvent;
      for (const listener of listeners) listener(event);
    },
  };
};

const migrationEnvironment = (environment: LocalWorkspaceEnvironment) => ({
  crypto: environment.crypto,
  now: environment.now,
  randomUUID: environment.randomUUID,
  createBlankProject: environment.createBlankProject,
});

const sourceFrom = (values: Record<string, string> = validLegacyValues()) =>
  legacySnapshot(values as Partial<Record<keyof ReturnType<typeof legacySnapshot>, string>>);

const prepareFor = (
  harness: TestHarness,
  source = sourceFrom(),
): Promise<PreparedInitialCopy> => prepareInitialCopy(
  source,
  migrationEnvironment(harness.environment),
);

const seedHistoricalLineage = async (
  harness: TestHarness,
  options: {
    state?: 'copied' | 'verified' | 'cleanup-started' | 'cleanup-complete';
    preserveIncarnation?: boolean;
    corruptIncarnation?: unknown;
    physicalVersionTwo?: boolean;
  } = {},
) => {
  const copy = await prepareFor(harness);
  const projects = structuredClone(copy.projects) as unknown as Array<Record<string, unknown>>;
  if (!options.preserveIncarnation) delete projects[0].incarnation;
  if (Object.hasOwn(options, 'corruptIncarnation')) {
    projects[0].incarnation = options.corruptIncarnation;
  }
  const state = options.state ?? 'verified';
  const ledger = {
    ...structuredClone(copy.ledger),
    indexedDbVersion: 1,
    state,
    ledgerRevision: state === 'copied' ? 0 : 1,
    verifiedAt: state === 'copied' ? null : VERIFIED_NOW,
  } as HistoricalMigrationLedgerV1;

  const request = harness.indexedDB.open(WORKSPACE_DB_NAME, 1);
  request.addEventListener('upgradeneeded', () => {
    for (const storeName of STORE_NAMES) {
      request.result.createObjectStore(storeName, { keyPath: 'id' });
    }
  }, { once: true });
  const database = await requestResult(request);
  const transaction = database.transaction(STORE_NAMES, 'readwrite');
  for (const project of projects) transaction.objectStore('projects').put(project);
  transaction.objectStore('workspace').put(copy.workspace);
  for (const preset of copy.presets) transaction.objectStore('presets').put(preset);
  for (const pending of copy.pendingImports) {
    transaction.objectStore('pendingImports').put(pending);
  }
  transaction.objectStore('migrationLedger').put(ledger);
  transaction.objectStore('legacyBackup').put(copy.backup);
  await transactionDone(transaction);
  database.close();

  if (options.physicalVersionTwo) {
    const upgraded = await openRaw(harness.indexedDB, 2);
    upgraded.close();
  }
  return { copy, projects, ledger };
};

const verificationExpectation = (copy: PreparedInitialCopy) => ({
  ledgerRevision: copy.ledger.ledgerRevision,
  sourceDigest: copy.ledger.sourceDigest,
  expectedTargetDigest: copy.ledger.expectedTargetDigest,
});

const seedCopy = async (
  harness: TestHarness,
  options: {
    source?: ReturnType<typeof legacySnapshot>;
    state?: 'copied' | 'verified';
  } = {},
): Promise<PreparedInitialCopy> => {
  const copy = await prepareFor(harness, options.source);
  const adapter = createIndexedDbAdapter({
    indexedDB: harness.indexedDB,
    now: () => VERIFIED_NOW,
  });
  await adapter.open();
  await adapter.writeInitialCopy(copy);
  if (options.state === 'verified') {
    await adapter.markVerified(verificationExpectation(copy));
  }
  adapter.close();
  return copy;
};

const inspect = async (harness: TestHarness): Promise<IndexedDbInspection> => {
  const adapter = createIndexedDbAdapter({
    indexedDB: harness.indexedDB,
    now: () => VERIFIED_NOW,
  });
  try {
    await adapter.open();
    return await adapter.inspect();
  } finally {
    adapter.close();
  }
};

const ensureSchema = async (harness: TestHarness): Promise<void> => {
  const adapter = createIndexedDbAdapter({
    indexedDB: harness.indexedDB,
    now: () => VERIFIED_NOW,
  });
  await adapter.open();
  adapter.close();
};

const readyResult = (
  result: WorkspaceBootstrapResult,
): Extract<WorkspaceBootstrapResult, { status: 'ready' }> => {
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw new Error(`Expected ready, got ${result.status}.`);
  return result;
};

const recoveryResult = (
  result: WorkspaceBootstrapResult,
): Extract<WorkspaceBootstrapResult, { status: 'recovery' }> => {
  expect(result.status).toBe('recovery');
  if (result.status !== 'recovery') throw new Error(`Expected recovery, got ${result.status}.`);
  return result;
};

interface DatabaseHooks {
  onOpen?(database: IDBDatabase): void;
  onTransactionStart?(
    database: IDBDatabase,
    storeNames: string[],
    mode: IDBTransactionMode,
    transaction: IDBTransaction,
  ): void;
}

const instrumentFactory = (indexedDB: IDBFactory, hooks: DatabaseHooks): void => {
  const originalOpen = indexedDB.open.bind(indexedDB);
  const patched = new WeakSet<IDBDatabase>();
  indexedDB.open = ((name: string, version?: number) => {
    const request = version === undefined ? originalOpen(name) : originalOpen(name, version);
    request.addEventListener('success', () => {
      const database = request.result;
      hooks.onOpen?.(database);
      if (patched.has(database)) return;
      patched.add(database);
      const originalTransaction = database.transaction.bind(database);
      database.transaction = ((
        storeNames: string | string[],
        mode?: IDBTransactionMode,
        options?: IDBTransactionOptions,
      ) => {
        const transaction = originalTransaction(storeNames, mode, options);
        hooks.onTransactionStart?.(
          database,
          typeof storeNames === 'string' ? [storeNames] : Array.from(storeNames),
          mode ?? 'readonly',
          transaction,
        );
        return transaction;
      }) as IDBDatabase['transaction'];
    });
    return request;
  }) as IDBFactory['open'];
};

const sameStores = (actual: string[], expected: readonly string[]): boolean =>
  actual.length === expected.length && expected.every(name => actual.includes(name));

const trackOpened = (indexedDB: IDBFactory): Array<Promise<IDBDatabase>> => {
  const opened: Array<Promise<IDBDatabase>> = [];
  const originalOpen = indexedDB.open.bind(indexedDB);
  indexedDB.open = ((name: string, version?: number) => {
    const request = version === undefined ? originalOpen(name) : originalOpen(name, version);
    const result = requestResult<IDBDatabase>(request);
    void result.catch(() => {});
    opened.push(result);
    return request;
  }) as IDBFactory['open'];
  return opened;
};

describe('public store surface', () => {
  it('exports a browser singleton without opening storage during module evaluation', () => {
    expect(localWorkspaceStore).toMatchObject({
      bootstrap: expect.any(Function),
      commit: expect.any(Function),
      exportRecoveryBundle: expect.any(Function),
    });
  });

  it('rejects normal commands while authority is cold or bootstrapping', async () => {
    const digestStarted = deferred();
    const releaseDigest = deferred();
    let held = false;
    const crypto = {
      subtle: {
        digest: async (algorithm: AlgorithmIdentifier, data: BufferSource) => {
          if (!held) {
            held = true;
            digestStarted.resolve();
            await releaseDigest.promise;
          }
          return webcrypto.subtle.digest(algorithm, data as never);
        },
      },
    } as unknown as Crypto;
    const harness = createHarness({ crypto });
    const store = createLocalWorkspaceStore(harness.environment);
    const command = { type: 'activate-project', projectId: 'project-a' } as const;

    await expect(store.commit(command)).rejects.toMatchObject({ code: 'authority-lost' });
    const bootstrap = store.bootstrap();
    await digestStarted.promise;
    await expect(store.commit(command)).rejects.toMatchObject({ code: 'authority-lost' });
    releaseDigest.resolve();
    await expect(bootstrap).resolves.toMatchObject({ status: 'ready' });
  });

  it('exports current legacy recovery without opening IndexedDB or writing legacy storage', async () => {
    const harness = createHarness();
    const store = createLocalWorkspaceStore(harness.environment);

    await expect(store.exportRecoveryBundle('legacy-current')).resolves.toMatchObject({
      type: 'application/json;charset=utf-8',
    });
    expect((harness.storage as MemoryStorage).reads).toEqual([
      ...LEGACY_DOCUMENT_KEYS,
      ...LEGACY_DOCUMENT_KEYS,
      ...LEGACY_DOCUMENT_KEYS,
    ]);
    expect((harness.storage as MemoryStorage).mutations).toEqual([]);
  });
});

describe('initial bootstrap and authority transition', () => {
  it('never returns ready before independent read-back and verified CAS', async () => {
    const events: string[] = [];
    const indexedDB = new IDBFactory();
    let opened = false;
    instrumentFactory(indexedDB, {
      onOpen() {
        if (!opened) {
          opened = true;
          events.push('open');
        }
      },
      onTransactionStart(_database, storeNames, mode, transaction) {
        if (mode === 'readonly' && sameStores(storeNames, STORE_NAMES)) {
          events.push('inspect');
        } else if (mode === 'readwrite' && sameStores(storeNames, STORE_NAMES)) {
          transaction.addEventListener('complete', () => events.push('write-copied'), {
            once: true,
          });
        } else if (mode === 'readonly' && sameStores(
          storeNames,
          ['projects', 'workspace', 'presets', 'pendingImports'],
        )) {
          events.push('read-all-separate-transaction');
        } else if (mode === 'readwrite' && sameStores(storeNames, ['migrationLedger'])) {
          transaction.addEventListener('complete', () => events.push('mark-verified'), {
            once: true,
          });
        }
      },
    });
    const storage = memoryStorage(validLegacyValues());
    const originalGetItem = storage.getItem.bind(storage);
    storage.getItem = (key: string) => {
      if (storage.reads.length === 0) events.push('capture-legacy');
      if (storage.reads.length === 16) events.push('rehash-legacy');
      return originalGetItem(key);
    };
    let nowCalls = 0;
    const harness = createHarness({
      indexedDB,
      storage,
      now: () => {
        nowCalls += 1;
        if (nowCalls === 1) events.push('prepare-copy');
        return nowCalls === 1 ? TEST_NOW : VERIFIED_NOW;
      },
    });

    const result = await createLocalWorkspaceStore(harness.environment).bootstrap();

    expect(events).toEqual([
      'open',
      'inspect',
      'capture-legacy',
      'prepare-copy',
      'write-copied',
      'read-all-separate-transaction',
      'rehash-legacy',
      'mark-verified',
    ]);
    expect(result.status).toBe('ready');
    expect((await inspect(harness)).migrationLedger[0]).toMatchObject({
      state: 'verified',
      ledgerRevision: 1,
      verifiedAt: VERIFIED_NOW,
    });
  });

  it('emits each bootstrap phase once and in order', async () => {
    const harness = createHarness();
    const phases: string[] = [];
    const observer = { onPhase: (phase: string) => phases.push(phase) };
    const store = createLocalWorkspaceStore(harness.environment);

    const first = store.bootstrap(observer as WorkspaceBootstrapObserver);
    const second = store.bootstrap(observer as WorkspaceBootstrapObserver);
    expect(second).toBe(first);
    await first;

    expect(phases).toEqual([
      'opening-local-storage',
      'checking-existing-projects',
      'copying-projects',
      'verifying-projects',
      'finishing-upgrade',
    ]);
  });

  it('installs one retained legacy monitor before the first legacy read', async () => {
    const events: string[] = [];
    const storage = memoryStorage(validLegacyValues());
    const getItem = vi.fn((key: string) => {
      events.push('read');
      return storage.getItem(key);
    });
    const harness = createHarness({ storage: { getItem } });
    harness.environment.addStorageListener = listener => {
      events.push('monitor');
      harness.listeners.add(listener);
      return () => harness.unsubscribe();
    };
    const store = createLocalWorkspaceStore(harness.environment);

    await store.bootstrap();
    await store.bootstrap();

    expect(events[0]).toBe('monitor');
    expect(events.filter(event => event === 'monitor')).toHaveLength(1);
    expect(harness.listeners).toHaveLength(1);
    expect(harness.unsubscribe).not.toHaveBeenCalled();
  });

  it('initializes an all-absent native workspace through copied and verified', async () => {
    const harness = createHarness({ values: {} });

    const result = readyResult(
      await createLocalWorkspaceStore(harness.environment).bootstrap(),
    );
    const stored = await inspect(harness);

    expect(result.receipt).toBeUndefined();
    expect(result.snapshot).toMatchObject({
      projects: [{ id: 'proj_fixture-uuid', name: 'Blank Project' }],
      activeProjectId: 'proj_fixture-uuid',
      customPresets: [],
      pendingImports: [],
    });
    expect(harness.createBlankProject).toHaveBeenCalledOnce();
    expect(stored.projects).toHaveLength(1);
    expect(stored.workspace).toHaveLength(1);
    expect(stored.legacyBackup[0].snapshot).toEqual(legacySnapshot());
    expect(stored.migrationLedger[0]).toMatchObject({
      state: 'verified',
      origin: 'native',
    });
    expect((harness.storage as MemoryStorage).mutations).toEqual([]);
  });

  it('keeps native default data inside the failed atomic copy', async () => {
    const harness = createHarness({ values: {} });
    harness.setFault('copy.after-projects');

    const result = await createLocalWorkspaceStore(harness.environment).bootstrap();

    expect(recoveryResult(result).recovery.kind).toBe('migration-failed');
    expect(harness.createBlankProject).toHaveBeenCalledOnce();
    expect(await inspect(harness)).toEqual({
      projects: [],
      workspace: [],
      presets: [],
      pendingImports: [],
      migrationLedger: [],
      legacyBackup: [],
    });
  });

  it('treats presets-only storage as legacy and includes the blank in the copy', async () => {
    const values = {
      [LEGACY_KEYS.customPresets]: JSON.stringify([legacyCustomPreset()]),
    };
    const harness = createHarness({ values });

    const result = readyResult(
      await createLocalWorkspaceStore(harness.environment).bootstrap(),
    );

    expect(result.snapshot.projects).toHaveLength(1);
    expect(result.snapshot.customPresets.map(preset => preset.id)).toEqual(['preset-a']);
    expect(result.receipt).toMatchObject({
      projectCount: 0,
      customPresetCount: 1,
      pendingImportPreserved: false,
      migratedAt: TEST_NOW,
    });
  });

  it.each([
    ['one', [legacyProject()], 'project-a'],
    ['many', [legacyProject(), secondProject()], 'project-b'],
  ])('copies %s ordered legacy project set', async (_label, projects, activeProjectId) => {
    const values = validLegacyValues({
      [LEGACY_KEYS.projects]: JSON.stringify(projects),
      [LEGACY_KEYS.activeProject]: activeProjectId,
    });
    const harness = createHarness({ values });

    const result = readyResult(
      await createLocalWorkspaceStore(harness.environment).bootstrap(),
    );

    expect(result.snapshot.projects.map(project => project.id))
      .toEqual(projects.map(project => project.id));
    expect(result.snapshot.activeProjectId).toBe(activeProjectId);
    expect(result.receipt?.projectCount).toBe(projects.length);
  });

  it('migrates the source present before preparation without writing legacy keys', async () => {
    const storage = memoryStorage(validLegacyValues());
    storage.seed(LEGACY_KEYS.projects, JSON.stringify([legacyProject(), secondProject()]));
    storage.seed(LEGACY_KEYS.activeProject, 'project-b');
    const harness = createHarness({ storage });

    const result = readyResult(
      await createLocalWorkspaceStore(harness.environment).bootstrap(),
    );

    expect(result.snapshot.projects.map(project => project.id)).toEqual(['project-a', 'project-b']);
    expect(storage.mutations).toEqual([]);
  });

  it('returns legacy-changing when source changes during preparation', async () => {
    const storage = new MemoryStorage(validLegacyValues(), (readCount, current) => {
      if (readCount === 4) {
        current.seed(LEGACY_KEYS.projects, JSON.stringify([legacyProject(), secondProject()]));
      }
    });
    const harness = createHarness({ storage });

    const result = await createLocalWorkspaceStore(harness.environment).bootstrap();

    expect(recoveryResult(result).recovery).toMatchObject({
      kind: 'legacy-changing',
      canRetry: true,
    });
    expect((await inspect(harness)).migrationLedger).toEqual([]);
    expect(storage.mutations).toEqual([]);
  });

  it('refuses authority when source changes after preparation and before copy', async () => {
    const storage = new MemoryStorage(validLegacyValues(), (readCount, current) => {
      if (readCount === 8) {
        current.seed(LEGACY_KEYS.projects, JSON.stringify([legacyProject(), secondProject()]));
      }
    });
    const harness = createHarness({ storage });

    const result = await createLocalWorkspaceStore(harness.environment).bootstrap();

    expect(recoveryResult(result).recovery.kind).toBe('legacy-changing');
    expect((await inspect(harness)).migrationLedger).toEqual([]);
  });

  it.each(['start', 'complete'] as const)(
    'refuses authority when source changes at copy transaction %s',
    async timing => {
      const indexedDB = new IDBFactory();
      const storage = memoryStorage(validLegacyValues());
      const harness = createHarness({ indexedDB, storage });
      let changed = false;
      const change = () => {
        if (changed) return;
        changed = true;
        storage.seed(LEGACY_KEYS.projects, JSON.stringify([legacyProject(), secondProject()]));
        harness.dispatchStorage(LEGACY_KEYS.projects);
      };
      instrumentFactory(indexedDB, {
        onTransactionStart(_database, storeNames, mode, transaction) {
          if (mode !== 'readwrite' || !sameStores(storeNames, STORE_NAMES)) return;
          if (timing === 'start') change();
          else transaction.addEventListener('complete', change, { once: true });
        },
      });

      const result = await createLocalWorkspaceStore(harness.environment).bootstrap();

      expect(recoveryResult(result).recovery.kind).toBe('verification-failed');
      expect((await inspect(harness)).migrationLedger[0].state).toBe('copied');
      expect(storage.mutations).toEqual([]);
    },
  );

  it('refuses authority when a storage event arrives during final source hashing', async () => {
    const sourceHashStarted = deferred();
    const releaseSourceHash = deferred();
    let legacyDigestCalls = 0;
    const crypto = {
      subtle: {
        digest: async (algorithm: AlgorithmIdentifier, data: BufferSource) => {
          const text = new TextDecoder().decode(data as never);
          if (text.includes('doctect-legacy-source')) {
            legacyDigestCalls += 1;
            if (legacyDigestCalls === 5) {
              sourceHashStarted.resolve();
              await releaseSourceHash.promise;
            }
          }
          return webcrypto.subtle.digest(algorithm, data as never);
        },
      },
    } as unknown as Crypto;
    const storage = memoryStorage(validLegacyValues());
    const harness = createHarness({ crypto, storage });
    const store = createLocalWorkspaceStore(harness.environment);
    const bootstrap = store.bootstrap();
    await sourceHashStarted.promise;

    storage.seed(LEGACY_KEYS.projects, JSON.stringify([legacyProject(), secondProject()]));
    harness.dispatchStorage(LEGACY_KEYS.projects);
    releaseSourceHash.resolve();

    const result = await bootstrap;
    expect(recoveryResult(result).recovery.kind).toBe('verification-failed');
    expect((await inspect(harness)).migrationLedger[0].state).toBe('copied');
  });

  it('recaptures copied source after hashing when storage event delivery is delayed', async () => {
    const sourceHashStarted = deferred();
    const releaseSourceHash = deferred();
    let legacyDigestCalls = 0;
    const crypto = {
      subtle: {
        digest: async (algorithm: AlgorithmIdentifier, data: BufferSource) => {
          const text = new TextDecoder().decode(data as never);
          if (text.includes('doctect-legacy-source')) {
            legacyDigestCalls += 1;
            if (legacyDigestCalls === 5) {
              sourceHashStarted.resolve();
              await releaseSourceHash.promise;
            }
          }
          return webcrypto.subtle.digest(algorithm, data as never);
        },
      },
    } as unknown as Crypto;
    const storage = memoryStorage(validLegacyValues());
    const harness = createHarness({ crypto, storage });
    const bootstrap = createLocalWorkspaceStore(harness.environment).bootstrap();
    await sourceHashStarted.promise;

    storage.seed(LEGACY_KEYS.projects, JSON.stringify([legacyProject(), secondProject()]));
    releaseSourceHash.resolve();

    const result = await bootstrap;
    expect(recoveryResult(result).recovery.kind).toBe('verification-failed');
    expect((await inspect(harness)).migrationLedger[0].state).toBe('copied');
    harness.dispatchStorage(LEGACY_KEYS.projects);
  });

  it('revalidates copied source after a byte-identical event during the final hash', async () => {
    const sourceHashStarted = deferred();
    const releaseSourceHash = deferred();
    let legacyDigestCalls = 0;
    const crypto = {
      subtle: {
        digest: async (algorithm: AlgorithmIdentifier, data: BufferSource) => {
          const text = new TextDecoder().decode(data as never);
          if (text.includes('doctect-legacy-source')) {
            legacyDigestCalls += 1;
            if (legacyDigestCalls === 6) {
              sourceHashStarted.resolve();
              await releaseSourceHash.promise;
            }
          }
          return webcrypto.subtle.digest(algorithm, data as never);
        },
      },
    } as unknown as Crypto;
    const harness = createHarness({ crypto });
    const bootstrap = createLocalWorkspaceStore(harness.environment).bootstrap();
    await sourceHashStarted.promise;

    harness.dispatchStorage(LEGACY_KEYS.projects);
    releaseSourceHash.resolve();

    await expect(bootstrap).resolves.toMatchObject({ status: 'ready' });
    expect(legacyDigestCalls).toBeGreaterThan(6);
  });

  it('refuses copied ready when legacy changes in the finishing phase observer', async () => {
    const storage = memoryStorage(validLegacyValues());
    const harness = createHarness({ storage });
    const store = createLocalWorkspaceStore(harness.environment);

    const result = await store.bootstrap({
      onPhase(phase) {
        if (phase === 'finishing-upgrade') {
          storage.seed(
            LEGACY_KEYS.projects,
            JSON.stringify([legacyProject(), secondProject()]),
          );
        }
      },
    });

    expect(recoveryResult(result).recovery.kind).toBe('verification-failed');
    expect((await inspect(harness)).migrationLedger[0].state).toBe('verified');
  });

  it('refuses authority when source changes during the verified CAS', async () => {
    const indexedDB = new IDBFactory();
    const storage = memoryStorage(validLegacyValues());
    const harness = createHarness({ indexedDB, storage });
    let changed = false;
    instrumentFactory(indexedDB, {
      onTransactionStart(_database, storeNames, mode) {
        if (changed
          || mode !== 'readwrite'
          || !sameStores(storeNames, ['migrationLedger'])) {
          return;
        }
        changed = true;
        storage.seed(LEGACY_KEYS.projects, JSON.stringify([legacyProject(), secondProject()]));
        harness.dispatchStorage(LEGACY_KEYS.projects);
      },
    });

    const result = await createLocalWorkspaceStore(harness.environment).bootstrap();

    expect(recoveryResult(result).recovery.kind).toBe('verification-failed');
    expect((await inspect(harness)).migrationLedger[0].state).toBe('verified');
  });

  it('recaptures copied source after verified CAS when storage event delivery is delayed', async () => {
    const indexedDB = new IDBFactory();
    const storage = memoryStorage(validLegacyValues());
    const harness = createHarness({ indexedDB, storage });
    let changed = false;
    instrumentFactory(indexedDB, {
      onTransactionStart(_database, storeNames, mode) {
        if (changed
          || mode !== 'readwrite'
          || !sameStores(storeNames, ['migrationLedger'])) {
          return;
        }
        changed = true;
        storage.seed(LEGACY_KEYS.projects, JSON.stringify([legacyProject(), secondProject()]));
      },
    });

    const result = await createLocalWorkspaceStore(harness.environment).bootstrap();

    expect(recoveryResult(result).recovery.kind).toBe('verification-failed');
    expect((await inspect(harness)).migrationLedger[0].state).toBe('verified');
    harness.dispatchStorage(LEGACY_KEYS.projects);
  });

  it('does not reject a matching source merely because a storage event was observed', async () => {
    const indexedDB = new IDBFactory();
    const harness = createHarness({ indexedDB });
    instrumentFactory(indexedDB, {
      onTransactionStart(_database, storeNames, mode) {
        if (mode === 'readwrite' && sameStores(storeNames, STORE_NAMES)) {
          harness.dispatchStorage(LEGACY_KEYS.projects);
        }
      },
    });

    await expect(createLocalWorkspaceStore(harness.environment).bootstrap())
      .resolves.toMatchObject({ status: 'ready' });
  });

  it.each(COPY_TRANSACTION_FAULTS)(
    'returns retryable recovery and no partial target for %s',
    async faultPoint => {
      const harness = createHarness();
      harness.setFault(faultPoint);
      const store = createLocalWorkspaceStore(harness.environment);

      const result = await store.bootstrap();

      expect(recoveryResult(result).recovery).toMatchObject({
        kind: 'migration-failed',
        canRetry: true,
      });
      expect(await inspect(harness)).toEqual({
        projects: [],
        workspace: [],
        presets: [],
        pendingImports: [],
        migrationLedger: [],
        legacyBackup: [],
      });
      harness.setFault();
      await expect(store.bootstrap()).resolves.toMatchObject({ status: 'ready' });
    },
  );

  it('resumes a committed copied ledger after a crash', async () => {
    const baseStorage = memoryStorage(validLegacyValues());
    let reads = 0;
    let crash = true;
    const storage = {
      getItem(key: string) {
        reads += 1;
        if (crash && reads === 13) throw new Error('fault after committed copy');
        return baseStorage.getItem(key);
      },
    };
    const harness = createHarness({ storage });
    const first = createLocalWorkspaceStore(harness.environment);

    await expect(first.bootstrap()).rejects.toThrow('fault after committed copy');
    expect((await inspect(harness)).migrationLedger[0].state).toBe('copied');

    crash = false;
    const second = createLocalWorkspaceStore(harness.environment);
    await expect(second.bootstrap()).resolves.toMatchObject({ status: 'ready' });
    expect((await inspect(harness)).migrationLedger).toHaveLength(1);
  });

  it('does not return ready when the verified CAS aborts and retries from copied', async () => {
    const harness = createHarness();
    harness.setFault('mutation.before-complete');
    const store = createLocalWorkspaceStore(harness.environment);

    const first = await store.bootstrap();

    expect(recoveryResult(first).recovery.kind).toBe('verification-failed');
    expect((await inspect(harness)).migrationLedger[0].state).toBe('copied');

    harness.setFault();
    await expect(store.bootstrap()).resolves.toMatchObject({ status: 'ready' });
  });
});

describe('historical version-1 lineage repair', () => {
  it.each(['copied', 'verified'] as const)(
    'repairs a recognized %s ledger before ordinary verification',
    async state => {
      const randomUUID = vi.fn(() => 'repaired-incarnation');
      const harness = createHarness({ randomUUID });
      const historical = await seedHistoricalLineage(harness, { state });
      randomUUID.mockClear();

      const result = readyResult(
        await createLocalWorkspaceStore(harness.environment).bootstrap(),
      );

      expect(result.snapshot.projects).toEqual(
        historical.copy.projects.map(record => record.project),
      );
      expect(result.receipt?.id).toBe(
        `${WORKSPACE_MIGRATION_ID}:${historical.copy.sourceDigest}`,
      );
      const stored = await inspect(harness);
      expect(stored.projects[0]).toEqual({
        ...historical.copy.projects[0],
        incarnation: 'repaired-incarnation',
      });
      expect(stored.migrationLedger[0]).toMatchObject({
        indexedDbVersion: 2,
        state: 'verified',
        ledgerRevision: 2,
      });
      expect((harness.storage as MemoryStorage).mutations).toEqual([]);
      expect(randomUUID).toHaveBeenCalledTimes(1);
    },
  );

  it('resumes physical version 2 with a historical ledger after a crash', async () => {
    const harness = createHarness({ randomUUID: () => 'resumed-incarnation' });
    await seedHistoricalLineage(harness, { physicalVersionTwo: true });

    await expect(createLocalWorkspaceStore(harness.environment).bootstrap())
      .resolves.toMatchObject({ status: 'ready' });
    expect((await inspect(harness)).projects[0].incarnation).toBe('resumed-incarnation');
  });

  it('resumes strict verification after repair committed before readback', async () => {
    const harness = createHarness({ randomUUID: () => 'post-commit-incarnation' });
    const historical = await seedHistoricalLineage(harness);
    const adapter = createIndexedDbAdapter({
      indexedDB: harness.indexedDB,
      now: () => VERIFIED_NOW,
    });
    await adapter.open();
    const candidate = await adapter.inspect();
    const prepared = await prepareLineageRepair(historical.ledger, {
      projects: candidate.projects,
      workspace: candidate.workspace[0],
      presets: candidate.presets,
      pendingImports: candidate.pendingImports,
    }, {
      crypto: webcrypto as unknown as Crypto,
      randomUUID: harness.environment.randomUUID,
    });
    await adapter.repairHistoricalLineage(prepared);
    adapter.close();

    await expect(createLocalWorkspaceStore(harness.environment).bootstrap())
      .resolves.toMatchObject({ status: 'ready' });
    expect((await inspect(harness)).projects[0].incarnation)
      .toBe('post-commit-incarnation');
  });

  it('preserves a valid incarnation and advances only ledger metadata', async () => {
    const randomUUID = vi.fn(() => 'unused');
    const harness = createHarness({ randomUUID });
    const historical = await seedHistoricalLineage(harness, { preserveIncarnation: true });
    randomUUID.mockClear();

    await expect(createLocalWorkspaceStore(harness.environment).bootstrap())
      .resolves.toMatchObject({ status: 'ready' });
    expect((await inspect(harness)).projects).toEqual(historical.copy.projects);
    expect(randomUUID).not.toHaveBeenCalled();
  });

  it.each(LINEAGE_REPAIR_FAULTS)(
    'keeps exact historical data and protected editor export at %s',
    async faultPoint => {
      const harness = createHarness();
      const historical = await seedHistoricalLineage(harness);
      harness.setFault(faultPoint);
      const store = createLocalWorkspaceStore(harness.environment);

      const result = recoveryResult(await store.bootstrap());

      expect(result.recovery.availableExports).toEqual([
        'legacy-current',
        'legacy-original',
        'indexeddb-workspace',
      ]);
      const originalBundle = JSON.parse(await (await store.exportRecoveryBundle(
        'legacy-original',
      )).text());
      expect(originalBundle).toEqual({
        format: 'doctect.legacy-workspace-recovery',
        version: 1,
        capturedAt: historical.copy.backup.capturedAt,
        entries: LEGACY_DOCUMENT_KEYS.map(key => ({
          key,
          ...historical.copy.backup.snapshot[key],
        })),
        digest: historical.copy.backup.digest,
      });
      const bundle = JSON.parse(await (await store.exportRecoveryBundle(
        'indexeddb-workspace',
      )).text());
      expect(bundle.workspace.projects).toEqual(
        historical.copy.projects.map(record => record.project),
      );
      const stored = await inspect(harness);
      expect(Object.hasOwn(stored.projects[0], 'incarnation')).toBe(false);
      expect(stored.migrationLedger[0]).toEqual(historical.ledger);
      expect((harness.storage as MemoryStorage).mutations).toEqual([]);
      expect(result.recovery.canRecoverLegacyAsCopies).toBe(false);

      await expect(store.commit({
        type: 'recover-legacy-as-copies',
        recoveryId: result.recovery.recoveryId,
      })).rejects.toMatchObject({ code: 'unavailable' });
      expect(await inspect(harness)).toEqual(stored);
      expect((harness.storage as MemoryStorage).mutations).toEqual([]);
    },
  );

  it('does not repair invalid present incarnation', async () => {
    const invalid = createHarness();
    await seedHistoricalLineage(invalid, { corruptIncarnation: '' });
    expect(recoveryResult(
      await createLocalWorkspaceStore(invalid.environment).bootstrap(),
    ).recovery.kind).toBe('verification-failed');
  });

  it.each(['cleanup-started', 'cleanup-complete'] as const)(
    'leaves historical %s state exactly unchanged',
    async state => {
      const cleanup = createHarness();
      await seedHistoricalLineage(cleanup, { state });
      const before = await inspect(cleanup);

      expect(recoveryResult(
        await createLocalWorkspaceStore(cleanup.environment).bootstrap(),
      ).recovery.kind).toBe('unsupported-cleanup-state');
      expect(await inspect(cleanup)).toEqual(before);
    },
  );

  it('preserves an unresolved recovery marker byte-exactly across repair', async () => {
    const harness = createHarness();
    const historical = await seedHistoricalLineage(harness);
    const marker = {
      id: 'historical-target-marker',
      kind: 'target-mismatch' as const,
      detectedAt: VERIFIED_NOW,
    };
    await putRaw(harness.indexedDB, 'migrationLedger', {
      ...historical.ledger,
      unresolvedRecovery: marker,
    });

    const result = recoveryResult(
      await createLocalWorkspaceStore(harness.environment).bootstrap(),
    );

    expect(result.recovery.kind).toBe('verification-failed');
    expect((await inspect(harness)).migrationLedger[0]).toMatchObject({
      indexedDbVersion: 2,
      ledgerRevision: historical.ledger.ledgerRevision + 1,
      unresolvedRecovery: marker,
    });
  });

  it('lets concurrent stores follow one repair winner', async () => {
    const harness = createHarness();
    await seedHistoricalLineage(harness);
    const randomUUID = vi.fn()
      .mockReturnValueOnce('concurrent-incarnation-left')
      .mockReturnValueOnce('concurrent-incarnation-right');
    harness.environment.randomUUID = randomUUID;
    const left = createLocalWorkspaceStore(harness.environment);
    const right = createLocalWorkspaceStore(harness.environment);

    const results = await Promise.all([left.bootstrap(), right.bootstrap()]);

    expect(results.map(result => result.status)).toEqual(['ready', 'ready']);
    const persisted = await inspect(harness);
    expect(persisted.migrationLedger[0]).toMatchObject({
      indexedDbVersion: 2,
      ledgerRevision: 2,
    });
    expect(randomUUID).toHaveBeenCalledTimes(2);
    expect([
      'concurrent-incarnation-left',
      'concurrent-incarnation-right',
    ]).toContain(persisted.projects[0].incarnation);
  });
});

describe('existing target decision table', () => {
  const orphanStores = [
    'projects',
    'workspace',
    'presets',
    'pendingImports',
    'legacyBackup',
  ] as const;

  it.each(orphanStores)(
    'returns unrecognized-target for an orphaned %s record without creating defaults',
    async storeName => {
      const harness = createHarness({ values: {} });
      const copy = await prepareFor(createHarness());
      await ensureSchema(harness);
      const values = {
        projects: copy.projects[0],
        workspace: copy.workspace,
        presets: copy.presets[0],
        pendingImports: copy.pendingImports[0],
        legacyBackup: copy.backup,
      };
      await putRaw(harness.indexedDB, storeName, values[storeName]);

      const result = await createLocalWorkspaceStore(harness.environment).bootstrap();

      expect(recoveryResult(result).recovery.kind).toBe('unrecognized-target');
      expect(harness.createBlankProject).not.toHaveBeenCalled();
      expect((harness.storage as MemoryStorage).reads).toEqual([
        ...LEGACY_DOCUMENT_KEYS,
        ...LEGACY_DOCUMENT_KEYS,
        ...LEGACY_DOCUMENT_KEYS,
      ]);
      expect((await inspect(harness))[storeName]).toHaveLength(1);
    },
  );

  it('advertises only current legacy recovery for an unrecognized target without a backup', async () => {
    const harness = createHarness({ values: {} });
    const copy = await prepareFor(createHarness());
    await ensureSchema(harness);
    await putRaw(harness.indexedDB, 'projects', copy.projects[0]);

    const result = await createLocalWorkspaceStore(harness.environment).bootstrap();

    expect(recoveryResult(result).recovery).toMatchObject({
      kind: 'unrecognized-target',
      availableExports: ['legacy-current'],
    });
  });

  it.each([
    ['unknown', { id: WORKSPACE_MIGRATION_ID, indexedDbVersion: 99 }],
    ['malformed', {
      id: WORKSPACE_MIGRATION_ID,
      indexedDbVersion: 1,
      state: 'copied',
      persistenceRolloutEpoch: 1,
    }],
  ])('returns unrecognized-target for an %s ledger', async (_label, ledger) => {
    const harness = createHarness({ values: {} });
    await ensureSchema(harness);
    await putRaw(harness.indexedDB, 'migrationLedger', ledger);

    const result = await createLocalWorkspaceStore(harness.environment).bootstrap();

    expect(recoveryResult(result).recovery.kind).toBe('unrecognized-target');
    expect(harness.createBlankProject).not.toHaveBeenCalled();
    expect((harness.storage as MemoryStorage).reads).toEqual([
      ...LEGACY_DOCUMENT_KEYS,
      ...LEGACY_DOCUMENT_KEYS,
      ...LEGACY_DOCUMENT_KEYS,
    ]);
  });

  it.each(['cleanup-started', 'cleanup-complete'] as const)(
    'refuses recognized rollout epoch 1 state %s without deleting legacy keys',
    async state => {
      const harness = createHarness();
      const copy = await seedCopy(harness);
      await putRaw(harness.indexedDB, 'migrationLedger', { ...copy.ledger, state });
      (harness.storage as MemoryStorage).reads.splice(0);
      harness.createBlankProject.mockClear();

      const result = await createLocalWorkspaceStore(harness.environment).bootstrap();

      expect(recoveryResult(result).recovery.kind).toBe('unsupported-cleanup-state');
      expect((harness.storage as MemoryStorage).mutations).toEqual([]);
      expect(harness.createBlankProject).not.toHaveBeenCalled();
      expect((await inspect(harness)).migrationLedger[0].state).toBe(state);
    },
  );

  it('loads and independently verifies a committed copied ledger', async () => {
    const harness = createHarness();
    const copy = await seedCopy(harness);
    (harness.storage as MemoryStorage).reads.splice(0);
    harness.createBlankProject.mockClear();

    const result = readyResult(
      await createLocalWorkspaceStore(harness.environment).bootstrap(),
    );

    expect(result.snapshot.projects).toEqual(copy.projects.map(record => record.project));
    expect(result.receipt?.id).toBe(`${WORKSPACE_MIGRATION_ID}:${copy.sourceDigest}`);
    expect(harness.createBlankProject).not.toHaveBeenCalled();
    expect((await inspect(harness)).migrationLedger[0].state).toBe('verified');
  });

  it('returns a stored recovery marker from a copied ledger without verifying it', async () => {
    const harness = createHarness();
    const copy = await seedCopy(harness);
    const marker = {
      id: 'copied-recovery',
      kind: 'target-mismatch' as const,
      detectedAt: VERIFIED_NOW,
    };
    await putRaw(harness.indexedDB, 'migrationLedger', {
      ...copy.ledger,
      unresolvedRecovery: marker,
    });

    const result = await createLocalWorkspaceStore(harness.environment).bootstrap();

    expect(recoveryResult(result).recovery).toMatchObject({
      recoveryId: marker.id,
      kind: 'verification-failed',
    });
    expect((await inspect(harness)).migrationLedger[0]).toMatchObject({
      state: 'copied',
      unresolvedRecovery: marker,
    });
  });

  it('returns verification-failed for a copied target read-back mismatch', async () => {
    const harness = createHarness();
    const copy = await seedCopy(harness);
    await putRaw(harness.indexedDB, 'projects', {
      ...copy.projects[0],
      project: { ...copy.projects[0].project, name: 'Changed after copy' },
    });

    const result = await createLocalWorkspaceStore(harness.environment).bootstrap();

    expect(recoveryResult(result).recovery.kind).toBe('verification-failed');
    expect((await inspect(harness)).migrationLedger[0].state).toBe('copied');
  });

  it('returns verification-failed for a copied source mismatch', async () => {
    const oldValues = validLegacyValues();
    const storage = memoryStorage(oldValues);
    const harness = createHarness({ storage });
    const copy = await seedCopy(harness, { source: sourceFrom(oldValues) });
    storage.seed(LEGACY_KEYS.projects, JSON.stringify([legacyProject(), secondProject()]));
    const store = createLocalWorkspaceStore(harness.environment);

    const first = await store.bootstrap();
    expect(recoveryResult(first).recovery.kind).toBe('verification-failed');

    const retried = readyResult(await store.bootstrap());
    expect(retried.snapshot.projects.map(project => project.id))
      .toEqual(['project-a', 'project-b']);
    expect((await inspect(harness)).migrationLedger[0]).toMatchObject({
      state: 'verified',
    });
    expect((await inspect(harness)).migrationLedger[0].sourceDigest)
      .not.toBe(copy.sourceDigest);
    expect(storage.mutations).toEqual([]);
  });

  it('preserves the previous copy when retry preparation rejects changed legacy', async () => {
    const oldValues = validLegacyValues();
    const storage = memoryStorage(oldValues);
    const harness = createHarness({ storage });
    await seedCopy(harness, { source: sourceFrom(oldValues) });
    storage.seed(LEGACY_KEYS.projects, '{');
    const store = createLocalWorkspaceStore(harness.environment);

    expect(recoveryResult(await store.bootstrap()).recovery.kind)
      .toBe('verification-failed');
    const before = canonicalStringify(await inspect(harness));
    const retry = recoveryResult(await store.bootstrap());

    expect(retry.recovery.kind).toBe('migration-failed');
    expect(canonicalStringify(await inspect(harness))).toBe(before);
    expect(storage.mutations).toEqual([]);
  });

  it('aborts copied replacement without changing either source', async () => {
    const oldValues = validLegacyValues();
    const storage = memoryStorage(oldValues);
    const harness = createHarness({ storage });
    await seedCopy(harness, { source: sourceFrom(oldValues) });
    storage.seed(LEGACY_KEYS.projects, JSON.stringify([legacyProject(), secondProject()]));
    const store = createLocalWorkspaceStore(harness.environment);
    expect(recoveryResult(await store.bootstrap()).recovery.kind)
      .toBe('verification-failed');
    const before = canonicalStringify(await inspect(harness));
    harness.setFault('copy.after-projects');

    expect(recoveryResult(await store.bootstrap()).recovery.kind)
      .toBe('migration-failed');
    expect(canonicalStringify(await inspect(harness))).toBe(before);
    expect(storage.mutations).toEqual([]);
  });

  it('lets concurrent copied retries follow one replacement winner', async () => {
    const oldValues = validLegacyValues();
    const storage = memoryStorage(oldValues);
    const harness = createHarness({ storage });
    await seedCopy(harness, { source: sourceFrom(oldValues) });
    storage.seed(LEGACY_KEYS.projects, JSON.stringify([legacyProject(), secondProject()]));
    const left = createLocalWorkspaceStore(harness.environment);
    const right = createLocalWorkspaceStore(harness.environment);
    const first = await Promise.all([left.bootstrap(), right.bootstrap()]);
    expect(first.map(result => recoveryResult(result).recovery.kind))
      .toEqual(['verification-failed', 'verification-failed']);

    const retried = await Promise.all([left.bootstrap(), right.bootstrap()]);

    expect(retried).toEqual([
      expect.objectContaining({ status: 'ready' }),
      expect.objectContaining({ status: 'ready' }),
    ]);
    const finalInspection = await inspect(harness);
    expect(finalInspection.migrationLedger).toHaveLength(1);
    expect(finalInspection.migrationLedger[0].state).toBe('verified');
    expect(finalInspection.legacyBackup).toHaveLength(1);
    expect(storage.mutations).toEqual([]);
  });

  it('loads verified records without comparing edits to the migration target digest', async () => {
    const harness = createHarness();
    const copy = await seedCopy(harness, { state: 'verified' });
    const adapter = createIndexedDbAdapter({
      indexedDB: harness.indexedDB,
      now: () => VERIFIED_NOW,
    });
    await adapter.open();
    await adapter.saveProject({
      ...copy.projects[0].project,
      name: 'Valid edit after migration',
    }, storedProjectLineage(copy.projects[0]));
    adapter.close();

    const result = readyResult(
      await createLocalWorkspaceStore(harness.environment).bootstrap(),
    );

    expect(result.snapshot.projects[0].name).toBe('Valid edit after migration');
  });

  it.each([
    ['project order', (copy: PreparedInitialCopy) => ({
      ...copy.workspace,
      projectOrder: [],
    })],
    ['active project', (copy: PreparedInitialCopy) => ({
      ...copy.workspace,
      activeProjectId: 'missing',
    })],
  ])('returns verification-failed for invalid verified %s', async (_label, corrupt) => {
    const harness = createHarness();
    const copy = await seedCopy(harness, { state: 'verified' });
    await putRaw(harness.indexedDB, 'workspace', corrupt(copy));

    const result = await createLocalWorkspaceStore(harness.environment).bootstrap();

    expect(recoveryResult(result).recovery.kind).toBe('verification-failed');
  });

  it('does not verify a durable project whose root resolves only through Object.prototype', async () => {
    const harness = createHarness();
    const copy = await seedCopy(harness, { state: 'verified' });
    const malformed = structuredClone(copy.projects[0]);
    malformed.project.initialState = {
      ...malformed.project.initialState,
      nodes: {},
      rootId: 'constructor',
    };
    await putRaw(harness.indexedDB, 'projects', malformed);

    const result = await createLocalWorkspaceStore(harness.environment).bootstrap();

    expect(recoveryResult(result).recovery.kind).toBe('verification-failed');
  });

  it('returns split-brain when verified legacy no longer matches the accepted digest', async () => {
    const storage = memoryStorage(validLegacyValues());
    const harness = createHarness({ storage });
    await seedCopy(harness, { state: 'verified' });
    storage.seed(LEGACY_KEYS.projects, JSON.stringify([legacyProject(), secondProject()]));

    const result = await createLocalWorkspaceStore(harness.environment).bootstrap();

    expect(recoveryResult(result).recovery.kind).toBe('split-brain');
  });

  it('recaptures verified source after hashing when storage event delivery is delayed', async () => {
    const sourceHashStarted = deferred();
    const releaseSourceHash = deferred();
    let legacyDigestCalls = 0;
    const crypto = {
      subtle: {
        digest: async (algorithm: AlgorithmIdentifier, data: BufferSource) => {
          const text = new TextDecoder().decode(data as never);
          if (text.includes('doctect-legacy-source')) {
            legacyDigestCalls += 1;
            if (legacyDigestCalls === 2) {
              sourceHashStarted.resolve();
              await releaseSourceHash.promise;
            }
          }
          return webcrypto.subtle.digest(algorithm, data as never);
        },
      },
    } as unknown as Crypto;
    const storage = memoryStorage(validLegacyValues());
    const harness = createHarness({ storage });
    await seedCopy(harness, { state: 'verified' });
    harness.environment.crypto = crypto;
    const bootstrap = createLocalWorkspaceStore(harness.environment).bootstrap();
    await sourceHashStarted.promise;

    storage.seed(LEGACY_KEYS.projects, JSON.stringify([legacyProject(), secondProject()]));
    releaseSourceHash.resolve();

    const result = await bootstrap;
    expect(recoveryResult(result).recovery.kind).toBe('split-brain');
    harness.dispatchStorage(LEGACY_KEYS.projects);
  });

  it('never publishes verified ready after legacy changes during the final hash', async () => {
    const sourceHashStarted = deferred();
    const releaseSourceHash = deferred();
    let legacyDigestCalls = 0;
    const crypto = {
      subtle: {
        digest: async (algorithm: AlgorithmIdentifier, data: BufferSource) => {
          const text = new TextDecoder().decode(data as never);
          if (text.includes('doctect-legacy-source')) {
            legacyDigestCalls += 1;
            if (legacyDigestCalls === 7) {
              sourceHashStarted.resolve();
              await releaseSourceHash.promise;
            }
          }
          return webcrypto.subtle.digest(algorithm, data as never);
        },
      },
    } as unknown as Crypto;
    const storage = memoryStorage(validLegacyValues());
    const harness = createHarness({ storage });
    await seedCopy(harness, { state: 'verified' });
    harness.environment.crypto = crypto;
    const bootstrap = createLocalWorkspaceStore(harness.environment).bootstrap();
    await sourceHashStarted.promise;

    storage.seed(LEGACY_KEYS.projects, JSON.stringify([legacyProject(), secondProject()]));
    harness.dispatchStorage(LEGACY_KEYS.projects);
    releaseSourceHash.resolve();

    const result = await bootstrap;
    expect(recoveryResult(result).recovery.kind).toBe('split-brain');
  });

  it('refreshes verified recovery when legacy changes during capability hashing', async () => {
    const sourceHashStarted = deferred();
    const releaseSourceHash = deferred();
    let legacyDigestCalls = 0;
    const crypto = {
      subtle: {
        digest: async (algorithm: AlgorithmIdentifier, data: BufferSource) => {
          const text = new TextDecoder().decode(data as never);
          if (text.includes('doctect-legacy-source')) {
            legacyDigestCalls += 1;
            if (legacyDigestCalls === 12) {
              sourceHashStarted.resolve();
              await releaseSourceHash.promise;
            }
          }
          return webcrypto.subtle.digest(algorithm, data as never);
        },
      },
    } as unknown as Crypto;
    const storage = memoryStorage(validLegacyValues());
    const harness = createHarness({ storage });
    await seedCopy(harness, { state: 'verified' });
    storage.seed(LEGACY_KEYS.projects, JSON.stringify([
      legacyProject('project-a', 12, { name: 'First bootstrap drift' }),
    ]));
    harness.environment.crypto = crypto;
    const bootstrap = createLocalWorkspaceStore(harness.environment).bootstrap();
    await sourceHashStarted.promise;

    storage.seed(LEGACY_KEYS.projects, JSON.stringify([
      legacyProject('project-a', 12, { name: 'Latest bootstrap drift' }),
    ]));
    harness.dispatchStorage(LEGACY_KEYS.projects);
    releaseSourceHash.resolve();

    const result = recoveryResult(await bootstrap);
    const latestDigest = await digestLegacySnapshot(
      captureLegacySnapshot(storage),
      webcrypto.subtle as unknown as SubtleCrypto,
    );
    expect(result.recovery.kind).toBe('split-brain');
    expect((await inspect(harness)).migrationLedger[0].unresolvedRecovery)
      .toMatchObject({ observedLegacyDigest: latestDigest });
  });

  it.each([
    ['legacy-drift', 'split-brain'],
    ['target-mismatch', 'verification-failed'],
    ['unknown-target', 'unrecognized-target'],
  ] as const)('returns stored %s recovery as %s', async (markerKind, publicKind) => {
    const harness = createHarness();
    await seedCopy(harness, { state: 'verified' });
    const stored = (await inspect(harness)).migrationLedger[0];
    await putRaw(harness.indexedDB, 'migrationLedger', {
      ...stored,
      unresolvedRecovery: {
        id: 'stored-recovery',
        kind: markerKind,
        detectedAt: VERIFIED_NOW,
      },
    });

    const result = await createLocalWorkspaceStore(harness.environment).bootstrap();

    expect(recoveryResult(result).recovery).toMatchObject({
      recoveryId: 'stored-recovery',
      kind: publicKind,
    });
  });

  it('reconstructs the same stable receipt on every verified bootstrap', async () => {
    const harness = createHarness();
    const firstStore = createLocalWorkspaceStore(harness.environment);
    const first = readyResult(await firstStore.bootstrap());
    const second = readyResult(
      await createLocalWorkspaceStore(harness.environment).bootstrap(),
    );

    expect(second.receipt).toEqual(first.receipt);
    expect(second.receipt?.id).toMatch(/^local-storage-to-indexeddb-v1:[a-f0-9]{64}$/);
  });
});

describe('concurrency, retries, and observers', () => {
  it('lets concurrent stores follow one winning native ledger and both become ready', async () => {
    const indexedDB = new IDBFactory();
    const storage = memoryStorage();
    const leftHarness = createHarness({
      indexedDB,
      storage,
      randomUUID: () => 'left-uuid',
      now: () => '2026-08-14T15:00:00.000Z',
    });
    const rightHarness = createHarness({
      indexedDB,
      storage,
      randomUUID: () => 'right-uuid',
      now: () => '2026-08-14T15:00:01.000Z',
    });

    const results = await Promise.all([
      createLocalWorkspaceStore(leftHarness.environment).bootstrap(),
      createLocalWorkspaceStore(rightHarness.environment).bootstrap(),
    ]);

    expect(results.map(result => result.status)).toEqual(['ready', 'ready']);
    const ledgers = (await inspect(leftHarness)).migrationLedger;
    expect(ledgers).toHaveLength(1);
    expect(ledgers[0]).toMatchObject({ state: 'verified', ledgerRevision: 1 });
    const projectId = readyResult(results[0]).snapshot.projects[0].id;
    expect(['proj_left-uuid', 'proj_right-uuid']).toContain(projectId);
    expect(readyResult(results[1]).snapshot.projects[0].id).toBe(projectId);
  });

  it('shares one in-flight bootstrap and registers later active observers', async () => {
    const digestStarted = deferred();
    const releaseDigest = deferred();
    let held = false;
    const crypto = {
      subtle: {
        digest: async (algorithm: AlgorithmIdentifier, data: BufferSource) => {
          if (!held) {
            held = true;
            digestStarted.resolve();
            await releaseDigest.promise;
          }
          return webcrypto.subtle.digest(algorithm, data as never);
        },
      },
    } as unknown as Crypto;
    const harness = createHarness({ crypto });
    const store = createLocalWorkspaceStore(harness.environment);
    const firstPhases: string[] = [];
    const laterPhases: string[] = [];
    const abortedPhases: string[] = [];
    const firstLost = vi.fn();
    const laterLost = vi.fn();
    const abortedLost = vi.fn();
    const controller = new AbortController();
    const first = store.bootstrap({
      onPhase: phase => firstPhases.push(phase),
      onAuthorityLost: firstLost,
    });
    await digestStarted.promise;
    const second = store.bootstrap({
      onPhase: phase => laterPhases.push(phase),
      onAuthorityLost: laterLost,
    });
    const aborted = store.bootstrap({
      signal: controller.signal,
      onPhase: phase => abortedPhases.push(phase),
      onAuthorityLost: abortedLost,
    });
    controller.abort();

    expect(second).toBe(first);
    expect(aborted).toBe(first);
    releaseDigest.resolve();
    await first;

    expect(firstPhases).toEqual([
      'opening-local-storage',
      'checking-existing-projects',
      'copying-projects',
      'verifying-projects',
      'finishing-upgrade',
    ]);
    expect(laterPhases).toEqual([
      'copying-projects',
      'verifying-projects',
      'finishing-upgrade',
    ]);
    expect(abortedPhases).toEqual([]);

    const upgraded = await openRaw(harness.indexedDB, WORKSPACE_DB_VERSION + 1);
    expect(firstLost).toHaveBeenCalledOnce();
    expect(laterLost).toHaveBeenCalledOnce();
    expect(abortedLost).not.toHaveBeenCalled();
    expect(firstLost).toHaveBeenCalledWith(expect.objectContaining({ status: 'unavailable' }));
    upgraded.close();
  });

  it('publishes the in-flight promise before invoking a reentrant phase observer', async () => {
    const indexedDB = new IDBFactory();
    let opens = 0;
    let copies = 0;
    instrumentFactory(indexedDB, {
      onOpen() {
        opens += 1;
      },
      onTransactionStart(_database, storeNames, mode) {
        if (mode === 'readwrite' && sameStores(storeNames, STORE_NAMES)) copies += 1;
      },
    });
    const harness = createHarness({ indexedDB });
    const store = createLocalWorkspaceStore(harness.environment);
    let reentered = false;
    let reentrant: Promise<WorkspaceBootstrapResult> | undefined;
    const phaseObserved = deferred();

    const first = store.bootstrap({
      onPhase() {
        if (reentered) return;
        reentered = true;
        reentrant = store.bootstrap();
        phaseObserved.resolve();
      },
    });

    await phaseObserved.promise;
    expect(reentrant).toBe(first);
    await expect(first).resolves.toMatchObject({ status: 'ready' });
    expect(opens).toBe(1);
    expect(copies).toBe(1);
  });

  it('caches only ready data while registering cached-call observers before return', async () => {
    const indexedDB = new IDBFactory();
    const opened = trackOpened(indexedDB);
    const harness = createHarness({ indexedDB });
    const store = createLocalWorkspaceStore(harness.environment);
    const first = await store.bootstrap();
    const reads = (harness.storage as MemoryStorage).reads.length;
    const onPhase = vi.fn();
    const onAuthorityLost = vi.fn();

    const second = await store.bootstrap({ onPhase, onAuthorityLost });

    expect(second).toBe(first);
    expect((harness.storage as MemoryStorage).reads).toHaveLength(reads);
    expect(opened).toHaveLength(1);
    expect(onPhase).not.toHaveBeenCalled();

    const rawDatabase = await opened[0];
    forceCloseDatabase(rawDatabase as never);
    await vi.waitFor(() => expect(onAuthorityLost).toHaveBeenCalledOnce());
    await expect(store.bootstrap()).resolves.toMatchObject({ status: 'unavailable' });
  });

  it('removes retained authority observers when their signal aborts', async () => {
    const indexedDB = new IDBFactory();
    const opened = trackOpened(indexedDB);
    const harness = createHarness({ indexedDB });
    const store = createLocalWorkspaceStore(harness.environment);
    const controller = new AbortController();
    const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
    const onAuthorityLost = vi.fn();

    await store.bootstrap({ signal: controller.signal, onAuthorityLost });

    expect(addEventListener).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
    controller.abort();
    forceCloseDatabase((await opened[0]) as never);

    await expect(store.bootstrap()).resolves.toMatchObject({ status: 'unavailable' });
    expect(onAuthorityLost).not.toHaveBeenCalled();
  });

  it('synchronously freezes then restores authority for a byte-identical legacy event', async () => {
    const harness = createHarness();
    const onAuthorityLost = vi.fn();
    const store = createLocalWorkspaceStore(harness.environment);
    await store.bootstrap({ onAuthorityLost });

    harness.dispatchStorage(LEGACY_KEYS.projects);

    expect(onAuthorityLost).not.toHaveBeenCalled();
    await expect(store.commit({ type: 'activate-project', projectId: 'project-a' }))
      .rejects.toMatchObject({ code: 'authority-lost' });
    await expect(store.bootstrap()).resolves.toMatchObject({ status: 'ready' });
    expect(onAuthorityLost).not.toHaveBeenCalled();
  });

  it('does not cache recovery and succeeds after invalid legacy data is repaired', async () => {
    const storage = memoryStorage(validLegacyValues({ [LEGACY_KEYS.projects]: '{' }));
    const harness = createHarness({ storage });
    const store = createLocalWorkspaceStore(harness.environment);

    const first = await store.bootstrap();
    expect(recoveryResult(first).recovery.kind).toBe('migration-failed');

    storage.seed(LEGACY_KEYS.projects, validLegacyValues()[LEGACY_KEYS.projects]);
    await expect(store.bootstrap()).resolves.toMatchObject({ status: 'ready' });
  });

  it('does not cache transient IndexedDB unavailability', async () => {
    const indexedDB = new IDBFactory();
    const originalOpen = indexedDB.open.bind(indexedDB);
    let fail = true;
    indexedDB.open = ((name: string, version?: number) => {
      if (fail) {
        fail = false;
        throw new DOMException('Temporarily disabled.', 'InvalidStateError');
      }
      return version === undefined ? originalOpen(name) : originalOpen(name, version);
    }) as IDBFactory['open'];
    const harness = createHarness({ indexedDB });
    const store = createLocalWorkspaceStore(harness.environment);

    await expect(store.bootstrap()).resolves.toMatchObject({ status: 'unavailable' });
    await expect(store.bootstrap()).resolves.toMatchObject({ status: 'ready' });
  });
});

describe('IndexedDB availability and lifecycle loss', () => {
  it('returns unavailable for a blocked open without inventing recovery', async () => {
    const indexedDB = new IDBFactory();
    const originalOpen = indexedDB.open.bind(indexedDB);
    let dispatched = false;
    indexedDB.open = ((name: string, version?: number) => {
      const request = version === undefined ? originalOpen(name) : originalOpen(name, version);
      if (!dispatched) {
        dispatched = true;
        queueMicrotask(() => request.dispatchEvent(new FakeIDBVersionChangeEvent('blocked', {
          oldVersion: 0,
          newVersion: version ?? null,
        })));
      }
      return request;
    }) as IDBFactory['open'];
    const harness = createHarness({ indexedDB });

    const result = await createLocalWorkspaceStore(harness.environment).bootstrap();

    expect(result).toMatchObject({
      status: 'unavailable',
      message: 'IndexedDB upgrade is blocked.',
      availableExports: ['legacy-current'],
    });
  });

  it('turns connection termination into private unavailability and notifies observers', async () => {
    const indexedDB = new IDBFactory();
    const opened = trackOpened(indexedDB);
    const harness = createHarness({ indexedDB });
    const onAuthorityLost = vi.fn();
    const store = createLocalWorkspaceStore(harness.environment);
    await store.bootstrap({ onAuthorityLost });
    const rawDatabase = await opened[0];

    forceCloseDatabase(rawDatabase as never);

    await vi.waitFor(() => expect(onAuthorityLost).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'unavailable', availableExports: [] }),
    ));
    await expect(store.commit({ type: 'activate-project', projectId: 'project-a' }))
      .rejects.toMatchObject({ code: 'authority-lost' });
    await expect(store.bootstrap()).resolves.toMatchObject({ status: 'unavailable' });
  });

  it('cannot return ready when lifecycle loss occurs during bootstrap', async () => {
    const indexedDB = new IDBFactory();
    let terminated = false;
    instrumentFactory(indexedDB, {
      onTransactionStart(database, storeNames, mode, transaction) {
        if (terminated || mode !== 'readonly' || !sameStores(storeNames, STORE_NAMES)) return;
        terminated = true;
        transaction.addEventListener('complete', () => {
          forceCloseDatabase(database as never);
        }, { once: true });
      },
    });
    const harness = createHarness({ indexedDB });
    const onAuthorityLost = vi.fn();

    const result = await createLocalWorkspaceStore(harness.environment)
      .bootstrap({ onAuthorityLost });

    expect(result.status).toBe('unavailable');
    expect(onAuthorityLost).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'unavailable' }),
    );
    expect((await inspect(harness)).migrationLedger).toEqual([]);
  });

  it('lets lifecycle loss dominate migration recovery raised during copy', async () => {
    const indexedDB = new IDBFactory();
    let database: IDBDatabase | undefined;
    instrumentFactory(indexedDB, {
      onOpen(opened) {
        database = opened;
      },
    });
    const harness = createHarness({
      indexedDB,
      fault(point) {
        if (point !== 'copy.after-projects') return;
        forceCloseDatabase(database as never);
        throw new Error('copy failed after lifecycle loss');
      },
    });
    const onAuthorityLost = vi.fn();

    const result = await createLocalWorkspaceStore(harness.environment)
      .bootstrap({ onAuthorityLost });

    expect(onAuthorityLost).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'unavailable' }),
    );
    expect(result.status).toBe('unavailable');
  });

  it('lets lifecycle loss dominate verification recovery raised after independent reads', async () => {
    const indexedDB = new IDBFactory();
    const harness = createHarness({ indexedDB });
    const copy = await seedCopy(harness);
    await putRaw(indexedDB, 'projects', {
      ...copy.projects[0],
      project: { ...copy.projects[0].project, name: 'Corrupt read-back' },
    });
    let terminated = false;
    instrumentFactory(indexedDB, {
      onTransactionStart(database, storeNames, mode, transaction) {
        if (terminated
          || mode !== 'readonly'
          || !sameStores(storeNames, ['legacyBackup'])) {
          return;
        }
        terminated = true;
        transaction.addEventListener('complete', () => {
          forceCloseDatabase(database as never);
        }, { once: true });
      },
    });
    const onAuthorityLost = vi.fn();

    const result = await createLocalWorkspaceStore(harness.environment)
      .bootstrap({ onAuthorityLost });

    expect(onAuthorityLost).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'unavailable' }),
    );
    expect(result.status).toBe('unavailable');
  });

  it('lets lifecycle loss dominate verification recovery raised during CAS', async () => {
    const indexedDB = new IDBFactory();
    let database: IDBDatabase | undefined;
    instrumentFactory(indexedDB, {
      onOpen(opened) {
        database = opened;
      },
    });
    const harness = createHarness({
      indexedDB,
      fault(point) {
        if (point !== 'mutation.before-complete') return;
        forceCloseDatabase(database as never);
        throw new Error('CAS failed after lifecycle loss');
      },
    });
    const onAuthorityLost = vi.fn();

    const result = await createLocalWorkspaceStore(harness.environment)
      .bootstrap({ onAuthorityLost });

    expect(onAuthorityLost).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'unavailable' }),
    );
    expect(result.status).toBe('unavailable');
  });
});
