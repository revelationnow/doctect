import { effect, primitive, runSync, type Work, type WorkRuntime } from '../../shared/cooperativeWork.js';
import { canonicalWork, compareStringsWork, equalFrameWork, retainRawValue, type RetainedValue } from '../../shared/jsonWork.js';
import { canonicalStringify, digestLegacySnapshot } from './canonical';
import { INDEXED_DB_UPGRADE_BLOCKED_MESSAGE, WorkspaceStoreError,
  type MigrationReceipt, type RecoverySource, type WorkspaceBootstrapPhase,
  type WorkspaceBootstrapResult, type WorkspaceRecovery, type WorkspaceSnapshot } from './contracts';
import type { IndexedDbAdapter, IndexedDbInspection } from './indexedDbAdapter';
import { LegacyCaptureError, captureLegacySnapshot, captureStableLegacySnapshot,
  captureStableLegacySnapshotWithDigest, type LegacyStorage } from './legacy';
import { LEGACY_DOCUMENT_KEYS, type LegacySnapshot } from './legacyTypes';
import { prepareLineageRepair, type PreparedLineageRepair } from './lineageRepair';
import { WorkspaceMigrationError, prepareInitialCopy, reconstructWorkspaceRecords, reconstructWorkspaceRecordsWork, verifyPreparedCopy,
  type MigrationPreparationEnvironment, type PreparedInitialCopy, type WorkspaceRecordCandidates,
  type WorkspaceRecords } from './migration';
import { PERSISTENCE_ROLLOUT_EPOCH, HISTORICAL_WORKSPACE_FORMAT_VERSION, WORKSPACE_MIGRATION_ID,
  type HistoricalMigrationLedgerV1, type LegacyBackupRecord, type MigrationLedger, type RecoveryMarker } from './schema';

export type HistoricalNonReady = Extract<WorkspaceBootstrapResult, { status: 'recovery' | 'unavailable' }>;
export type SupportedMigrationLedger = MigrationLedger | HistoricalMigrationLedgerV1;
export interface ObservedLegacyCapture { snapshot: LegacySnapshot; digest: string; generation: number }
export type HistoricalBootstrapResult = HistoricalNonReady | {
  status: 'admitted'; records: WorkspaceRecords; snapshot: WorkspaceSnapshot; ledger: MigrationLedger;
  release?(): void;
};
type HistoricalAdmission = Extract<HistoricalBootstrapResult, { status: 'admitted' }>;
interface VerificationInputs {
  records: WorkspaceRecordCandidates;
  originalBackup: LegacyBackupRecord;
  acceptedBackup: LegacyBackupRecord;
  release?(): void;
}

function retainedFields<T extends object>(owner: RetainedValue<T>, keys: readonly (keyof T)[]): T & { release(): void } {
  const result = {} as T & { release(): void };
  for (const key of keys) Object.defineProperty(result, key, { enumerable: true, get: () => owner.value[key] });
  Object.defineProperty(result, 'release', { value: owner.release });
  return result;
}
export interface HistoricalBootstrapEnvironment extends MigrationPreparationEnvironment {
  adapter(): IndexedDbAdapter;
  legacyStorage: LegacyStorage;
  generation(): number;
  protectSnapshot?(snapshot: WorkspaceSnapshot): void;
  assertCurrent?(): void;
}

const LEDGER_KEYS = ['id', 'indexedDbVersion', 'state', 'origin', 'ledgerRevision', 'sourceDigest',
  'expectedTargetDigest', 'acceptedLegacyDigest', 'originalLegacyBackupId', 'acceptedLegacyBackupId',
  'keyFingerprints', 'projectFingerprints', 'presetFingerprints', 'counts', 'migratedAt', 'verifiedAt',
  'persistenceRolloutEpoch', 'unresolvedRecovery'] as const;
const isPlainObject = (value: unknown): value is Record<string, unknown> => value !== null
  && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function* hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): Work<boolean> {
  const actual = yield* primitive('keys', () => Object.keys(value));
  if (actual.length !== keys.length) return false;
  for (const key of actual) {
    yield* effect(1, () => {});
    if (!keys.includes(key)) return false;
  }
  return true;
}
const isNonNegativeInteger = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
const isDigest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function* isCanonicalTimestamp(value: unknown): Work<boolean> {
  if (typeof value !== 'string') return false;
  return yield* primitive('scalar', () => {
    const parsed = new Date(value);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
  });
}
function* isLegacySnapshot(value: unknown): Work<boolean> {
  if (!isPlainObject(value) || !(yield* hasExactKeys(value, LEGACY_DOCUMENT_KEYS))) return false;
  for (const key of LEGACY_DOCUMENT_KEYS) {
    yield* effect(1, () => {});
    const entry = value[key];
    if (!isPlainObject(entry) || !(yield* hasExactKeys(entry, ['present', 'raw']))
      || typeof entry.present !== 'boolean' || !(entry.present ? typeof entry.raw === 'string' : entry.raw === null)) return false;
  }
  return true;
}
export const sameLegacySnapshot = (left: LegacySnapshot, right: LegacySnapshot): boolean =>
  LEGACY_DOCUMENT_KEYS.every(key => left[key].present === right[key].present && left[key].raw === right[key].raw);
export const sameObservedLegacy = (left: ObservedLegacyCapture, right: ObservedLegacyCapture): boolean =>
  left.generation === right.generation && left.digest === right.digest && sameLegacySnapshot(left.snapshot, right.snapshot);
function* isRecoveryMarker(value: unknown): Work<boolean> {
  if (!isPlainObject(value)) return false;
  const required = ['id', 'kind', 'detectedAt']; const allowed = [...required, 'observedLegacyDigest'];
  for (const key of required) {
    yield* effect(1, () => {});
    if (!Object.hasOwn(value, key)) return false;
  }
  const keys = yield* primitive('keys', () => Object.keys(value));
  for (const key of keys) {
    yield* effect(1, () => {});
    if (!allowed.includes(key)) return false;
  }
  return typeof value.id === 'string' && value.id.length > 0
    && (value.kind === 'legacy-drift' || value.kind === 'target-mismatch' || value.kind === 'unknown-target')
    && (yield* isCanonicalTimestamp(value.detectedAt))
    && (value.observedLegacyDigest === undefined || isDigest(value.observedLegacyDigest));
}
function* isItemFingerprints(value: unknown): Work<boolean> {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    yield* effect(1, () => {});
    if (!(index in value)) continue; // Preserve Array.every's sparse-slot rule.
    const entry = value[index];
    if (!isPlainObject(entry) || !(yield* hasExactKeys(entry, ['sourceIndex', 'id', 'digest']))
      || entry.sourceIndex !== index || typeof entry.id !== 'string' || entry.id.length === 0
      || ids.has(entry.id) || !isDigest(entry.digest)) return false;
    ids.add(entry.id);
  }
  return true;
}
function* isLedgerAtVersion(value: unknown, expectedVersion: 1 | 2): Work<boolean> {
  yield* effect(1, () => {});
  if (!isPlainObject(value) || !(yield* hasExactKeys(value, LEDGER_KEYS))) return false;
  const projectFingerprints = value.projectFingerprints; const presetFingerprints = value.presetFingerprints;
  if (value.id !== WORKSPACE_MIGRATION_ID || value.indexedDbVersion !== expectedVersion
    || value.persistenceRolloutEpoch !== PERSISTENCE_ROLLOUT_EPOCH
    || !(value.state === 'copied' || value.state === 'verified' || value.state === 'cleanup-started' || value.state === 'cleanup-complete')
    || !(value.origin === 'legacy' || value.origin === 'native') || !isNonNegativeInteger(value.ledgerRevision)
    || !isDigest(value.sourceDigest) || !isDigest(value.expectedTargetDigest) || !isDigest(value.acceptedLegacyDigest)
    || typeof value.originalLegacyBackupId !== 'string' || value.originalLegacyBackupId.length === 0
    || typeof value.acceptedLegacyBackupId !== 'string' || value.acceptedLegacyBackupId.length === 0
    || !(yield* isCanonicalTimestamp(value.migratedAt)) || !(value.verifiedAt === null || (yield* isCanonicalTimestamp(value.verifiedAt)))
    || (value.state === 'copied' && value.verifiedAt !== null) || (value.state === 'verified' && value.verifiedAt === null)
    || !(value.unresolvedRecovery === null || (yield* isRecoveryMarker(value.unresolvedRecovery)))) return false;
  if (!Array.isArray(value.keyFingerprints) || value.keyFingerprints.length !== LEGACY_DOCUMENT_KEYS.length) return false;
  for (let index = 0; index < value.keyFingerprints.length; index += 1) {
    yield* effect(1, () => {});
    if (!(index in value.keyFingerprints)) continue;
    const entry = value.keyFingerprints[index];
    if (!isPlainObject(entry) || !(yield* hasExactKeys(entry, ['key', 'present', 'digest']))
      || entry.key !== LEGACY_DOCUMENT_KEYS[index] || typeof entry.present !== 'boolean' || !isDigest(entry.digest)) return false;
  }
  if (!(yield* isItemFingerprints(projectFingerprints)) || !(yield* isItemFingerprints(presetFingerprints))
    || !isPlainObject(value.counts) || !(yield* hasExactKeys(value.counts, ['sourceProjects', 'targetProjects', 'customPresets', 'pendingImports']))
    || !isNonNegativeInteger(value.counts.sourceProjects) || !isNonNegativeInteger(value.counts.targetProjects)
    || value.counts.targetProjects === 0 || !isNonNegativeInteger(value.counts.customPresets)
    || !isNonNegativeInteger(value.counts.pendingImports) || value.counts.sourceProjects !== (projectFingerprints as unknown[]).length
    || value.counts.customPresets !== (presetFingerprints as unknown[]).length) return false;
  return true;
}
export const isRecognizedLedgerWork = (value: unknown): Work<boolean> =>
  isLedgerAtVersion(value, HISTORICAL_WORKSPACE_FORMAT_VERSION);
export const isHistoricalLineageLedgerWork = (value: unknown): Work<boolean> => isLedgerAtVersion(value, 1);
export const isRecognizedLedger = (value: unknown): value is MigrationLedger =>
  runSync(isRecognizedLedgerWork(value));
export const isHistoricalLineageLedger = (value: unknown): value is HistoricalMigrationLedgerV1 => runSync(isHistoricalLineageLedgerWork(value));
const allStoresEmpty = (inspection: IndexedDbInspection): boolean => inspection.projects.length === 0
  && inspection.workspace.length === 0 && inspection.presets.length === 0 && inspection.pendingImports.length === 0
  && inspection.migrationLedger.length === 0 && inspection.legacyBackup.length === 0;
const inspectionForPrepared = (prepared: PreparedInitialCopy): IndexedDbInspection => ({
  projects: prepared.projects, workspace: [prepared.workspace], presets: prepared.presets,
  pendingImports: prepared.pendingImports, migrationLedger: [prepared.ledger], legacyBackup: [prepared.backup],
});
type InspectionClassification = { kind: 'empty' } | { kind: 'current'; ledger: MigrationLedger }
  | { kind: 'historical-lineage'; ledger: HistoricalMigrationLedgerV1 } | { kind: 'unrecognized' };
export function* classifyHistoricalInspectionWork(inspection: IndexedDbInspection): Work<InspectionClassification> {
  yield* effect(1, () => {});
  if (inspection.migrationLedger.length === 0) {
    const empty = yield* effect(6, () => allStoresEmpty(inspection));
    return empty ? { kind: 'empty' } : { kind: 'unrecognized' };
  }
  if (inspection.migrationLedger.length !== 1) return { kind: 'unrecognized' };
  const candidate: unknown = inspection.migrationLedger[0];
  if (yield* isRecognizedLedgerWork(candidate)) return { kind: 'current', ledger: candidate as MigrationLedger };
  if (yield* isHistoricalLineageLedgerWork(candidate)) return { kind: 'historical-lineage', ledger: candidate as HistoricalMigrationLedgerV1 };
  return { kind: 'unrecognized' };
}
export const classifyHistoricalInspection = (inspection: IndexedDbInspection): InspectionClassification =>
  runSync(classifyHistoricalInspectionWork(inspection));

const recoveryDetails: Record<WorkspaceRecovery['kind'], { category: string; message: string; canRetry: boolean; canRecoverLegacyAsCopies: boolean }> = {
  'migration-failed': { category: 'migration-failed', message: 'Local workspace migration could not be completed.', canRetry: true, canRecoverLegacyAsCopies: false },
  'legacy-changing': { category: 'legacy-changing', message: 'Legacy workspace data changed while it was being copied.', canRetry: true, canRecoverLegacyAsCopies: false },
  'split-brain': { category: 'split-brain', message: 'Legacy and durable workspace data no longer agree.', canRetry: false, canRecoverLegacyAsCopies: true },
  'unrecognized-target': { category: 'unrecognized-target', message: 'Existing durable workspace data is not recognized.', canRetry: false, canRecoverLegacyAsCopies: false },
  'verification-failed': { category: 'verification-failed', message: 'Durable workspace verification failed.', canRetry: true, canRecoverLegacyAsCopies: false },
  'unsupported-cleanup-state': { category: 'unsupported-cleanup-state', message: 'This rollout does not support legacy cleanup state.', canRetry: false, canRecoverLegacyAsCopies: false },
};
export const recovery = (kind: WorkspaceRecovery['kind'], options: {
  recoveryId?: string; category?: string; message?: string; affectedKey?: string; affectedItem?: string; availableExports?: RecoverySource[];
} = {}): Extract<WorkspaceBootstrapResult, { status: 'recovery' }> => ({ status: 'recovery', recovery: {
  recoveryId: options.recoveryId ?? `local-workspace-bootstrap:${kind}`, kind,
  category: options.category ?? recoveryDetails[kind].category, message: options.message ?? recoveryDetails[kind].message,
  ...(options.affectedKey ? { affectedKey: options.affectedKey } : {}), ...(options.affectedItem ? { affectedItem: options.affectedItem } : {}),
  availableExports: options.availableExports ?? [], canRetry: recoveryDetails[kind].canRetry,
  canRecoverLegacyAsCopies: recoveryDetails[kind].canRecoverLegacyAsCopies,
} });
export const unavailable = (availableExports: RecoverySource[] = [], message = 'Local workspace storage is unavailable.'):
  Extract<WorkspaceBootstrapResult, { status: 'unavailable' }> => ({ status: 'unavailable', message, availableExports });
const migrationFailure = (error: unknown) => {
  if (error instanceof LegacyCaptureError) return recovery('legacy-changing');
  if (error instanceof WorkspaceMigrationError) return recovery('migration-failed', {
    category: error.category, message: error.message, affectedKey: error.affectedKey, affectedItem: error.affectedItem,
  });
  return recovery('migration-failed');
};
const verificationFailure = (error?: unknown) => error instanceof WorkspaceMigrationError
  ? recovery('verification-failed', { category: error.category, message: error.message, affectedKey: error.affectedKey, affectedItem: error.affectedItem })
  : recovery('verification-failed');
export const storedRecovery = (marker: RecoveryMarker) => recovery(marker.kind === 'legacy-drift' ? 'split-brain'
  : marker.kind === 'target-mismatch' ? 'verification-failed' : 'unrecognized-target', { recoveryId: marker.id, category: marker.kind });
export const receiptFor = (ledger: MigrationLedger): MigrationReceipt | undefined => ledger.origin === 'legacy' ? {
  id: `${WORKSPACE_MIGRATION_ID}:${ledger.sourceDigest}`, projectCount: ledger.counts.sourceProjects,
  customPresetCount: ledger.counts.customPresets, pendingImportPreserved: ledger.counts.pendingImports > 0, migratedAt: ledger.migratedAt,
} : undefined;
const verificationError = (message: string) => new WorkspaceMigrationError(message, 'verification-failed');

type BackupReference = {
  id: string; digest: string; kind?: LegacyBackupRecord['kind']; capturedAt?: string;
};
function* sameReferenceValue(left: unknown, right: unknown, cooperative = true): Work<boolean> {
  if (cooperative && typeof left === 'string' && typeof right === 'string') return (yield* compareStringsWork(left, right)) === 0;
  return left === right;
}

// Only fixed envelope/reference checks: never hashes or parses raw payloads.
// A cached row must still pass these checks for each separate ledger reference.
function* backupMetadataMatches(backup: unknown, expected: BackupReference, cooperative = true): Work<boolean> {
  yield* effect(1, () => {});
  if (!isPlainObject(backup) || !(yield* hasExactKeys(backup, ['id', 'kind', 'capturedAt', 'snapshot', 'digest']))
    || !(yield* sameReferenceValue(backup.id, expected.id, cooperative)) || !(backup.kind === 'original' || backup.kind === 'conflict')
    || (expected.kind !== undefined && backup.kind !== expected.kind) || !(yield* isCanonicalTimestamp(backup.capturedAt))
    || (expected.capturedAt !== undefined && !(yield* sameReferenceValue(backup.capturedAt, expected.capturedAt, cooperative)))
    || !(yield* sameReferenceValue(backup.digest, expected.digest, cooperative)) || !(yield* isLegacySnapshot(backup.snapshot))) return false;
  return true;
}

/** Strict legacy format only: normalization archives must not pass this validator. */
export async function validateHistoricalBackup(
  backup: unknown, expected: BackupReference, subtle: SubtleCrypto, work?: WorkRuntime,
): Promise<LegacyBackupRecord> {
  work?.assertCurrent();
  const matches = work ? await work.run(backupMetadataMatches(backup, expected)) : runSync(backupMetadataMatches(backup, expected, false));
  work?.assertCurrent();
  if (!matches) throw verificationError('Stored legacy backup does not match the migration ledger.');
  work?.note('backupValidations');
  const digest = await digestLegacySnapshot((backup as LegacyBackupRecord).snapshot, subtle, work);
  work?.assertCurrent();
  if (!(work ? await work.run(sameReferenceValue(digest, expected.digest)) : runSync(sameReferenceValue(digest, expected.digest, false)))) {
    throw verificationError('Stored legacy backup does not match the migration ledger.');
  }
  work?.assertCurrent();
  return backup as unknown as LegacyBackupRecord;
}

/** Shared prerequisite engine. It returns records, never public editing capabilities. */
export function createHistoricalBootstrap(environment: HistoricalBootstrapEnvironment) {
  const getAdapter = environment.adapter;
  let retryableCopiedLedger: MigrationLedger | undefined;
  const captureObservedLegacy = async (
    assertCurrent?: () => void,
    work: WorkRuntime | undefined = environment.work,
    expected?: ObservedLegacyCapture,
  ): Promise<ObservedLegacyCapture> => {
    let capturedGeneration: number;
    const captured = await captureStableLegacySnapshotWithDigest(environment.legacyStorage, environment.crypto.subtle, {
      generation: () => { capturedGeneration = environment.generation(); return capturedGeneration; },
      assertCurrent: assertCurrent ?? environment.assertCurrent, work, expected,
    });
    work?.assertCurrent();
    (assertCurrent ?? environment.assertCurrent)?.();
    return { ...captured, generation: capturedGeneration };
  };
  const validateBackup = async (
    backup: unknown, expected: BackupReference, work: WorkRuntime | undefined = environment.work,
  ): Promise<LegacyBackupRecord> => validateHistoricalBackup(backup, expected, environment.crypto.subtle, work);
  const readVerificationInputs = async (ledger: SupportedMigrationLedger, work: WorkRuntime | undefined = environment.work): Promise<VerificationInputs> => {
    let retained: RetainedValue<{ records: WorkspaceRecordCandidates; originalBackup: LegacyBackupRecord; acceptedBackup: LegacyBackupRecord }> | undefined;
    let transferred = false;
    try {
    work?.assertCurrent();
    const adapter = getAdapter(); let records: WorkspaceRecordCandidates;
    let originalBackup: unknown; let acceptedBackup: unknown;
    const wait = <T>(operation: () => Promise<T>): Promise<T> => work ? work.wait(operation) : operation();
    const readBackup = (id: string) => wait(() => work
      ? adapter.readLegacyBackup(id, work) : adapter.readLegacyBackup(id));
    const matches = (left: unknown, right: unknown): Promise<boolean> => work
      ? work.run(sameReferenceValue(left, right)) : Promise.resolve(runSync(sameReferenceValue(left, right, false)));
    let sharedBackup: boolean;
    try {
      records = await wait(() => work ? adapter.readWorkspaceRecords(work) : adapter.readWorkspaceRecords());
      work?.assertCurrent();
      originalBackup = await readBackup(ledger.originalLegacyBackupId);
      work?.assertCurrent();
      sharedBackup = await matches(ledger.acceptedLegacyBackupId, ledger.originalLegacyBackupId);
      work?.assertCurrent();
      acceptedBackup = sharedBackup ? originalBackup : await readBackup(ledger.acceptedLegacyBackupId);
      work?.assertCurrent();
    } catch (error) {
      if (work?.stopped()) work.assertCurrent();
      if (error instanceof WorkspaceStoreError && error.code === 'unavailable') throw error;
      throw verificationError('Durable workspace records could not be read independently.');
    }
    // Captured object identity is only a per-pass optimization, never durable
    // authority. Every reference repeats metadata checks; each new pass hashes
    // its captured row again, even if an adapter happens to reuse the object.
    const validatedBackups = new Map<object, LegacyBackupRecord>();
    if (work) {
      retained = retainRawValue({ records, originalBackup: originalBackup as LegacyBackupRecord,
        acceptedBackup: acceptedBackup as LegacyBackupRecord }, work);
      await retained.measure(); work.assertCurrent();
    }
    const validateCaptured = async (backup: unknown, expected: BackupReference): Promise<LegacyBackupRecord> => {
      work?.assertCurrent();
      const cached = isPlainObject(backup) ? validatedBackups.get(backup) : undefined;
      if (cached) {
        const validReference = work ? await work.run(backupMetadataMatches(cached, expected)) : runSync(backupMetadataMatches(cached, expected, false));
        work?.assertCurrent();
        if (!validReference) throw verificationError('Stored legacy backup does not match the migration ledger.');
        return cached;
      }
      const validated = await validateBackup(backup, expected, work);
      work?.assertCurrent();
      validatedBackups.set(validated, validated);
      return validated;
    };
    const validatedOriginal = await validateCaptured(originalBackup, {
      id: ledger.originalLegacyBackupId, digest: ledger.sourceDigest, kind: 'original', capturedAt: ledger.migratedAt,
    });
    work?.assertCurrent();
    if (sharedBackup) {
      const acceptedMatches = await matches(validatedOriginal.digest, ledger.acceptedLegacyDigest);
      work?.assertCurrent();
      if (!acceptedMatches) throw verificationError('Accepted legacy source does not match its backup.');
    }
    const validatedAccepted = await validateCaptured(acceptedBackup, {
      id: ledger.acceptedLegacyBackupId, digest: ledger.acceptedLegacyDigest,
    });
    work?.assertCurrent();
    if (retained) {
      work?.assertCurrent();
      transferred = true;
      return retainedFields(retained, ['records', 'originalBackup', 'acceptedBackup']);
    }
    return { records, originalBackup: validatedOriginal, acceptedBackup: validatedAccepted };
    } finally {
      if (!transferred) retained?.release();
    }
  };
  const readRecognizedLedger = async (work: WorkRuntime | undefined = environment.work): Promise<MigrationLedger> => {
    work?.assertCurrent();
    let ledger: unknown;
    try {
      ledger = work ? await work.wait(() => getAdapter().readMigrationLedger(work)) : await getAdapter().readMigrationLedger();
      work?.assertCurrent();
    }
    catch (error) {
      if (work?.stopped()) work.assertCurrent();
      if (error instanceof WorkspaceStoreError) throw error;
      throw new WorkspaceStoreError('Migration ledger could not be read.', 'unavailable', error);
    }
    const recognized = work ? await work.run(isRecognizedLedgerWork(ledger)) : isRecognizedLedger(ledger);
    work?.assertCurrent();
    if (!recognized) throw new WorkspaceStoreError('Migration ledger is unavailable.', 'unavailable');
    return ledger as MigrationLedger;
  };
  const recordLegacyDrift = async (initialCapture: ObservedLegacyCapture, knownLedger?: MigrationLedger,
    work: WorkRuntime | undefined = environment.work): Promise<{
    ledger: MigrationLedger; capture: ObservedLegacyCapture; marker?: RecoveryMarker;
  }> => {
    work?.assertCurrent();
    let capture = initialCapture; let ledger = knownLedger ?? await readRecognizedLedger(work);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      work?.assertCurrent();
      if (ledger.state !== 'verified') throw new WorkspaceStoreError('Verified migration ledger is unavailable.', 'conflict');
      const existing = ledger.unresolvedRecovery;
      if (existing?.kind !== 'legacy-drift' && existing !== null) throw new WorkspaceStoreError('Another recovery marker is already active.', 'conflict');
      if (work ? await work.run(sameReferenceValue(existing?.observedLegacyDigest, capture.digest))
        : existing?.observedLegacyDigest === capture.digest) {
        work?.assertCurrent(); return { ledger, capture, marker: existing ?? undefined };
      }
      if (existing === null && (work ? await work.run(sameReferenceValue(ledger.acceptedLegacyDigest, capture.digest))
        : ledger.acceptedLegacyDigest === capture.digest)) {
        work?.assertCurrent(); return { ledger, capture };
      }
      try {
        const markerWork = (function* (): Work<RecoveryMarker & { observedLegacyDigest: string }> {
          if (existing && existing.observedLegacyDigest === undefined) {
            return yield* primitive('scalar', () => ({ ...existing, observedLegacyDigest: capture.digest }));
          }
          const id = yield* primitive('scalar', () =>
            `${WORKSPACE_MIGRATION_ID}:legacy-drift:${ledger.ledgerRevision + 1}:${capture.digest}:${environment.randomUUID()}`);
          const detectedAt = yield* primitive('scalar', () => environment.now());
          return { id, kind: 'legacy-drift', detectedAt, observedLegacyDigest: capture.digest };
        })();
        const marker = work ? await work.run(markerWork) : runSync(markerWork);
        work?.assertCurrent();
        const expected = { expectedLedgerRevision: ledger.ledgerRevision,
          expectedAcceptedLegacyDigest: ledger.acceptedLegacyDigest, expectedRecoveryId: existing?.id ?? null, marker };
        const updated = work ? await work.wait(() => getAdapter().markLegacyDrift(expected, work))
          : await getAdapter().markLegacyDrift(expected);
        work?.assertCurrent();
        return { ledger: updated, capture, marker: updated.unresolvedRecovery ?? undefined };
      } catch (error) {
        if (work?.stopped()) work.assertCurrent();
        if (!(error instanceof WorkspaceStoreError) || error.code !== 'conflict') throw error;
        work?.note('retries');
        ledger = await readRecognizedLedger(work);
        work?.assertCurrent();
        capture = await captureObservedLegacy(undefined, work);
        work?.assertCurrent();
      }
    }
    throw new WorkspaceStoreError('Legacy recovery marker changed repeatedly.', 'conflict');
  };
  const retainedLegacyMatches = async (acceptedSource: LegacySnapshot, acceptedDigest: string,
    work: WorkRuntime | undefined = environment.work): Promise<boolean> => {
    let current: ObservedLegacyCapture;
    try { current = await captureObservedLegacy(undefined, work); }
    catch (error) { if (work?.stopped()) work.assertCurrent(); if (error instanceof LegacyCaptureError) return false; throw error; }
    work?.assertCurrent();
    work?.note('visits', 5); work?.note('primitiveExceptions', 5);
    return sameLegacySnapshot(current.snapshot, acceptedSource) && current.digest === acceptedDigest;
  };
  const prepareStableCopy = (work: WorkRuntime | undefined = environment.work,
    retain?: (value: PreparedInitialCopy) => Promise<PreparedInitialCopy>) => captureStableLegacySnapshot(environment.legacyStorage,
    source => {
      const prepared = prepareInitialCopy(source, work === environment.work ? environment : { ...environment, work });
      return retain ? prepared.then(retain) : prepared;
    }, environment.crypto.subtle,
    { generation: environment.generation, assertCurrent: environment.assertCurrent, work });

  const bootstrap = async (onPhase: (phase: WorkspaceBootstrapPhase) => void,
    options: { allowCopiedReplacement?: boolean; work?: WorkRuntime } = {}): Promise<HistoricalBootstrapResult> => {
    const work = options.work ?? environment.work;
    const removeGuard = work && environment.assertCurrent ? work.addGuard(() => environment.assertCurrent?.()) : undefined;
    const check = () => work?.assertCurrent();
    let releases = new Set<() => void>();
    let admission: RetainedValue<HistoricalAdmission> | undefined;
    let transferred = false;
    try {
    check();
    const emit = (phase: WorkspaceBootstrapPhase) => { check(); onPhase(phase); check(); };
    const adapter = getAdapter();
    emit('opening-local-storage');
    try { check(); await adapter.open(); check(); }
    catch (error) {
      check();
      if (error instanceof WorkspaceStoreError) return unavailable([], error.message === INDEXED_DB_UPGRADE_BLOCKED_MESSAGE ? error.message : undefined);
      throw error;
    }
    const wait = <T>(operation: () => Promise<T>): Promise<T> => work ? work.wait(operation) : operation();
    const releaseTemporaries = () => {
      for (const release of releases) release();
      releases = new Set();
    };
    const keep = async <T>(value: T): Promise<T> => {
      if (work) {
        const owner = retainRawValue(value, work); releases.add(owner.release);
        await owner.measure(); check();
      }
      return value;
    };
    const inspect = () => work ? wait(() => adapter.inspect(work)).then(keep) : adapter.inspect();
    const readInputs = (ledger: SupportedMigrationLedger) => {
      const pending = readVerificationInputs(ledger, work);
      return work ? pending.then(inputs => {
        if (inputs.release) releases.add(inputs.release);
        check(); return inputs;
      }) : pending;
    };
    const prepareAdmission = async (records: WorkspaceRecords, snapshot: WorkspaceSnapshot, ledger: MigrationLedger) => {
      if (!work) return;
      admission?.release();
      admission = retainRawValue<HistoricalAdmission>({ status: 'admitted', records, snapshot, ledger }, work);
      await admission.measure(); check();
    };
    const capture = () => captureObservedLegacy(undefined, work);
    const drift = (current: ObservedLegacyCapture, ledger: MigrationLedger) => recordLegacyDrift(current, ledger, work);
    const sameSource = (left: LegacySnapshot, right: LegacySnapshot) => {
      check(); work?.note('visits', 4); work?.note('primitiveExceptions', 4);
      const matches = sameLegacySnapshot(left, right); check(); return matches;
    };
    emit('checking-existing-projects');
    let initialInspection: IndexedDbInspection;
    try { initialInspection = await inspect(); check(); }
    catch (error) { check(); if (error instanceof WorkspaceStoreError) return unavailable(); throw error; }

    const admitted = (records: WorkspaceRecords, snapshot: WorkspaceSnapshot, ledger: MigrationLedger): HistoricalBootstrapResult => {
      check();
      environment.assertCurrent?.();
      check();
      if (admission) {
        transferred = true;
        return retainedFields(admission, ['status', 'records', 'snapshot', 'ledger']);
      }
      return { status: 'admitted', records, snapshot, ledger };
    };
    const processVerified = async (ledger: MigrationLedger): Promise<HistoricalBootstrapResult> => {
      if (ledger.unresolvedRecovery?.kind !== 'legacy-drift' && ledger.unresolvedRecovery !== null) return storedRecovery(ledger.unresolvedRecovery);
      emit('verifying-projects');
      let inputs: Awaited<ReturnType<typeof readVerificationInputs>>;
      try { inputs = await readInputs(ledger); check(); }
      catch (error) {
        check();
        if (error instanceof WorkspaceStoreError) return unavailable();
        if (error instanceof WorkspaceMigrationError) return verificationFailure(error);
        throw error;
      }
      let records: WorkspaceRecords; let snapshot: WorkspaceSnapshot;
      try { ({ records, snapshot } = work ? await work.run(reconstructWorkspaceRecordsWork(inputs.records)) : reconstructWorkspaceRecords(inputs.records)); check(); }
      catch (error) { check(); return verificationFailure(error); }
      if (work) await prepareAdmission(records, snapshot, ledger);
      let current: ObservedLegacyCapture;
      try { current = await capture(); check(); }
      catch (error) {
        check();
        if (!(error instanceof LegacyCaptureError)) return recovery('split-brain');
        try {
          current = await capture(); check(); const recorded = await drift(current, ledger); check();
          return recorded.marker ? storedRecovery(recorded.marker) : recovery('legacy-changing');
        } catch { check(); return recovery('legacy-changing'); }
      }
      if (ledger.unresolvedRecovery || current.digest !== ledger.acceptedLegacyDigest || !sameSource(current.snapshot, inputs.acceptedBackup.snapshot)) {
        try { const recorded = await drift(current, ledger); check(); if (recorded.marker) return storedRecovery(recorded.marker); }
        catch (error) {
          check();
          if (error instanceof WorkspaceStoreError && error.code === 'unavailable') return unavailable();
          return recovery('split-brain');
        }
      }
      emit('finishing-upgrade');
      try {
        const finalSource = await capture(); check();
        if (finalSource.digest !== ledger.acceptedLegacyDigest || !sameSource(finalSource.snapshot, inputs.acceptedBackup.snapshot)) {
          const recorded = await drift(finalSource, ledger); check(); if (recorded.marker) return storedRecovery(recorded.marker);
        }
      } catch (error) { check(); return error instanceof LegacyCaptureError ? recovery('legacy-changing') : recovery('split-brain'); }
      return admitted(records, snapshot, ledger);
    };
    const followInspection = async (inspection: IndexedDbInspection, allowCopiedReplacement: boolean,
      lineageRepairAttempt = 0): Promise<HistoricalBootstrapResult> => {
      check();
      const classification = work ? await work.run(classifyHistoricalInspectionWork(inspection)) : classifyHistoricalInspection(inspection);
      check();
      // Classification retains only the ledger. Drop full inspection/previous
      // attempt images before retaining the next attempt's working data.
      inspection = undefined!; initialInspection = undefined!;
      releaseTemporaries();
      admission?.release(); admission = undefined;
      if (work && (classification.kind === 'current' || classification.kind === 'historical-lineage')) await keep(classification.ledger);
      if (classification.kind === 'empty' || classification.kind === 'unrecognized') {
        retryableCopiedLedger = undefined; return recovery('unrecognized-target');
      }
      if (classification.kind === 'historical-lineage') {
        const ledger = classification.ledger;
        if (ledger.state === 'cleanup-started' || ledger.state === 'cleanup-complete') {
          retryableCopiedLedger = undefined; return recovery('unsupported-cleanup-state');
        }
        if (lineageRepairAttempt >= 3) return verificationFailure(verificationError('Historical lineage repair changed repeatedly.'));
        emit('verifying-projects');
        let inputs: Awaited<ReturnType<typeof readVerificationInputs>>;
        try { inputs = await readInputs(ledger); check(); }
        catch (error) {
          check();
          if (error instanceof WorkspaceStoreError) return unavailable();
          if (error instanceof WorkspaceMigrationError) return verificationFailure(error);
          throw error;
        }
        let prepared: PreparedLineageRepair;
        try {
          prepared = await prepareLineageRepair(ledger, inputs.records, work === environment.work ? environment : { ...environment, work });
          if (work) await keep(prepared);
          check();
          environment.protectSnapshot?.(prepared.snapshot);
          check();
        } catch (error) {
          check();
          if (error instanceof WorkspaceMigrationError) return verificationFailure(error);
          return migrationFailure(error);
        }
        emit('copying-projects');
        try { await wait(() => work ? adapter.repairHistoricalLineage(prepared, work) : adapter.repairHistoricalLineage(prepared)); check(); }
        catch (error) {
          check();
          if (error instanceof WorkspaceStoreError && error.code === 'conflict') {
            try { return followInspection(await inspect(), false, lineageRepairAttempt + 1); }
            catch (inspectionError) { check(); if (inspectionError instanceof WorkspaceStoreError) return unavailable(); throw inspectionError; }
          }
          if (error instanceof WorkspaceStoreError && error.code === 'unavailable') return unavailable();
          if (error instanceof WorkspaceStoreError) return migrationFailure(error);
          throw error;
        }
        try { return followInspection(await inspect(), false, lineageRepairAttempt + 1); }
        catch (error) { check(); if (error instanceof WorkspaceStoreError) return unavailable(); throw error; }
      }
      const ledger = classification.ledger;
      if (ledger.state === 'cleanup-started' || ledger.state === 'cleanup-complete') {
        retryableCopiedLedger = undefined; return recovery('unsupported-cleanup-state');
      }
      if (ledger.state === 'verified') { retryableCopiedLedger = undefined; return processVerified(ledger); }
      if (ledger.unresolvedRecovery) return storedRecovery(ledger.unresolvedRecovery);
      if (ledger.state === 'copied' && allowCopiedReplacement && retryableCopiedLedger
        && (work ? await work.run(equalFrameWork(emit => canonicalWork(retryableCopiedLedger, emit), emit => canonicalWork(ledger, emit)))
          : canonicalStringify(retryableCopiedLedger) === canonicalStringify(ledger))) {
        let replacement: PreparedInitialCopy;
        try { replacement = await prepareStableCopy(work, work ? keep : undefined); check(); }
        catch (error) { check(); if (error instanceof LegacyCaptureError || error instanceof WorkspaceMigrationError) return migrationFailure(error); throw error; }
        emit('copying-projects');
        try { await wait(() => adapter.replaceCopiedInitialCopy(replacement, ledger)); check(); }
        catch (error) {
          check();
          if (error instanceof WorkspaceStoreError && error.code === 'conflict') {
            try { return followInspection(await inspect(), false); }
            catch (inspectionError) { check(); if (inspectionError instanceof WorkspaceStoreError) return unavailable(); throw inspectionError; }
          }
          if (error instanceof WorkspaceStoreError && error.code === 'unavailable') return unavailable();
          if (error instanceof WorkspaceStoreError) return migrationFailure(error);
          throw error;
        }
        retryableCopiedLedger = undefined; return followInspection(inspectionForPrepared(replacement), false);
      }
      const copiedFailure = (error?: unknown) => {
        check(); work?.note('visits'); work?.note('primitiveExceptions');
        retryableCopiedLedger = structuredClone(ledger); check(); return verificationFailure(error);
      };
      emit('verifying-projects');
      let inputs: Awaited<ReturnType<typeof readVerificationInputs>>;
      try { inputs = await readInputs(ledger); check(); }
      catch (error) {
        check();
        if (error instanceof WorkspaceStoreError) return unavailable();
        if (error instanceof WorkspaceMigrationError) return copiedFailure(error);
        throw error;
      }
      const currentLegacy = work
        ? await work.run(effect(64, () => captureLegacySnapshot(environment.legacyStorage, work)))
        : captureLegacySnapshot(environment.legacyStorage);
      check();
      let records: WorkspaceRecords; let snapshot: WorkspaceSnapshot;
      try {
        const reconstructed = work ? await work.run(reconstructWorkspaceRecordsWork(inputs.records)) : reconstructWorkspaceRecords(inputs.records);
        check(); ({ records, snapshot } = reconstructed);
        if (work) await keep(snapshot);
        const prepared: PreparedInitialCopy = { origin: ledger.origin, source: inputs.originalBackup.snapshot,
          sourceDigest: ledger.sourceDigest, targetDigest: ledger.expectedTargetDigest, projects: records.projects,
          workspace: records.workspace, presets: records.presets, pendingImports: records.pendingImports, backup: inputs.originalBackup, ledger };
        snapshot = await verifyPreparedCopy(prepared, reconstructed, currentLegacy, environment.crypto.subtle, work); check();
      } catch (error) { check(); return copiedFailure(error); }
      if (!await retainedLegacyMatches(inputs.acceptedBackup.snapshot, ledger.acceptedLegacyDigest, work)) return copiedFailure();
      check();
      let verifiedLedger: MigrationLedger;
      try {
        const expected = { ledgerRevision: ledger.ledgerRevision, sourceDigest: ledger.sourceDigest, expectedTargetDigest: ledger.expectedTargetDigest };
        verifiedLedger = await wait(() => work ? adapter.markVerified(expected, work) : adapter.markVerified(expected)); check();
      }
      catch (error) {
        check();
        if (error instanceof WorkspaceStoreError && error.code === 'conflict') {
          let latest: IndexedDbInspection;
          try { latest = await inspect(); check(); }
          catch (inspectionError) { check(); if (inspectionError instanceof WorkspaceStoreError) return unavailable(); throw inspectionError; }
          return followInspection(latest, false);
        }
        if (error instanceof WorkspaceStoreError && error.code === 'unavailable') return unavailable();
        return copiedFailure(error);
      }
      const recognized = work ? await work.run(isRecognizedLedgerWork(verifiedLedger)) : isRecognizedLedger(verifiedLedger); check();
      if (!recognized || verifiedLedger.state !== 'verified' || verifiedLedger.unresolvedRecovery !== null) return copiedFailure();
      if (work) await prepareAdmission(records, snapshot, verifiedLedger);
      if (!await retainedLegacyMatches(inputs.acceptedBackup.snapshot, verifiedLedger.acceptedLegacyDigest, work)) return copiedFailure();
      emit('finishing-upgrade');
      const finalSourceMatches = () => sameSource(captureLegacySnapshot(environment.legacyStorage, work), inputs.acceptedBackup.snapshot);
      if (!(work ? await work.run(effect(64, finalSourceMatches)) : finalSourceMatches())) return copiedFailure();
      retryableCopiedLedger = undefined;
      return admitted(records, snapshot, verifiedLedger);
    };
    const classification = work ? await work.run(classifyHistoricalInspectionWork(initialInspection)) : classifyHistoricalInspection(initialInspection);
    check();
    if (classification.kind === 'unrecognized') { retryableCopiedLedger = undefined; return recovery('unrecognized-target'); }
    if (classification.kind === 'current' || classification.kind === 'historical-lineage')
      return await followInspection(initialInspection, options.allowCopiedReplacement ?? true);
    retryableCopiedLedger = undefined;
    let prepared: PreparedInitialCopy;
    try { prepared = await prepareStableCopy(work, work ? keep : undefined); check(); }
    catch (error) { check(); if (error instanceof LegacyCaptureError || error instanceof WorkspaceMigrationError) return migrationFailure(error); throw error; }
    emit('copying-projects');
    let copyResult: Awaited<ReturnType<typeof adapter.writeInitialCopy>>;
    try { copyResult = await wait(() => work ? adapter.writeInitialCopy(prepared, work) : adapter.writeInitialCopy(prepared)); check(); }
    catch (error) {
      check();
      if (error instanceof WorkspaceStoreError && error.code === 'unavailable') return unavailable();
      if (error instanceof WorkspaceStoreError) return migrationFailure(error);
      throw error;
    }
    if (copyResult.status === 'orphaned-target') { retryableCopiedLedger = undefined; return recovery('unrecognized-target'); }
    if (copyResult.status === 'existing-ledger') {
      let winner: IndexedDbInspection;
      try { winner = await inspect(); check(); }
      catch (error) { check(); if (error instanceof WorkspaceStoreError) return unavailable(); throw error; }
      return await followInspection(winner, false);
    }
    const continuation = followInspection(inspectionForPrepared(prepared), false);
    prepared = undefined!;
    return await continuation;
    } finally {
      try { check(); } catch (error) { transferred = false; throw error; }
      finally {
        for (const release of releases) release();
        if (!transferred) admission?.release();
        removeGuard?.();
      }
    }
  };
  return { bootstrap, captureObservedLegacy, currentGeneration: () => environment.generation(),
    validateBackup, readVerificationInputs, readRecognizedLedger, recordLegacyDrift, retainedLegacyMatches };
}
