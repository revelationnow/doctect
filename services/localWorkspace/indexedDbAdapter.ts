import {
  openDB,
  unwrap,
  type IDBPDatabase,
  type IDBPTransaction,
} from 'idb';
import { effect, primitive, runSync, type Ownership, type Work, type WorkRuntime } from '../../shared/cooperativeWork.js';
import { canonicalWork, equalFrameWork, rawValueWeightWork, utf8LengthWork, type Frame } from '../../shared/jsonWork.js';
import {
  INDEXED_DB_UPGRADE_BLOCKED_MESSAGE,
  WorkspaceStoreError,
  type WorkspaceCustomPreset,
  type WorkspaceImportAttemptProvenance,
  type WorkspacePendingImport,
  type WorkspaceProject,
  type WorkspaceStagedImportExpectation,
} from './contracts';
import { canonicalStringify, sha256Hex } from './canonical';
import type { FaultInjector } from './faults';
import type { PreparedLineageRepair } from './lineageRepair';
import { NORMALIZED_DB_VERSION, NORMALIZED_STORE_NAMES, type NormalizedWorkspaceDatabase } from './normalized/schema';
import type {
  PreparedInitialCopy,
  WorkspaceRecordCandidates,
  WorkspaceRecords,
} from './migration';
import {
  validatePreparedLegacyRecovery,
  type PreparedLegacyRecovery,
} from './recovery';
import {
  WORKSPACE_DB_NAME,
  WORKSPACE_DB_VERSION,
  HISTORICAL_WORKSPACE_FORMAT_VERSION,
  WORKSPACE_MIGRATION_ID,
  type HistoricalStoredProjectV1,
  type LegacyBackupRecord,
  type MigrationLedger,
  type ProjectLineage,
  type RecoveryMarker,
  type StoredPendingImport,
  type StoredImportAttemptProvenance,
  type StoredPreset,
  type StoredProject,
  type StoredWorkspace,
  type StoredWorkspaceRecord,
  sameProjectLineage,
  storedProjectLineage,
} from './schema';

const STORE_NAMES = [
  'projects',
  'workspace',
  'presets',
  'pendingImports',
  'migrationLedger',
  'legacyBackup',
] as const;

type StoreName = typeof STORE_NAMES[number];
type ReadTransaction = IDBPTransaction<NormalizedWorkspaceDatabase, readonly StoreName[], 'readonly'>;
type WriteTransaction = IDBPTransaction<
  NormalizedWorkspaceDatabase,
  readonly (StoreName | 'normalizationLedger')[],
  'readwrite'
>;

export interface IndexedDbAdapterEnvironment {
  indexedDB: IDBFactory;
  now(): string;
  crypto?: Pick<Crypto, 'subtle'>;
  fault?: FaultInjector;
  onAuthorityLost?: (error: WorkspaceStoreError) => void;
}

export interface IndexedDbSchemaDescription {
  projects: string[];
  workspace: string[];
  presets: string[];
  pendingImports: string[];
  migrationLedger: string[];
  legacyBackup: string[];
}

export interface IndexedDbInspection {
  projects: Array<StoredProject | HistoricalStoredProjectV1>;
  workspace: StoredWorkspace[];
  presets: StoredPreset[];
  pendingImports: StoredPendingImport[];
  migrationLedger: MigrationLedger[];
  legacyBackup: LegacyBackupRecord[];
}

export interface VerificationExpectation {
  ledgerRevision: number;
  sourceDigest: string;
  expectedTargetDigest: string;
}

export type InitialCopyResult = {
  status: 'copied' | 'existing-ledger' | 'orphaned-target';
};

export interface PreparedImportConsumption {
  pendingImportIdentity: string;
  project: StoredProject;
}

export interface PreparedProjectCreation {
  project: WorkspaceProject;
  incarnation: string;
}

export interface PreparedImportReplacement {
  expected: WorkspaceStagedImportExpectation;
  replacement: WorkspacePendingImport;
  replacementDigest: string;
  replacementAttempt: WorkspaceImportAttemptProvenance;
}

export interface LegacyDriftExpectation {
  expectedLedgerRevision: number;
  expectedAcceptedLegacyDigest: string;
  expectedRecoveryId: string | null;
  marker: RecoveryMarker & { observedLegacyDigest: string };
}

export interface IndexedDbAdapter {
  open(): Promise<void>;
  close(): void;
  describeSchema(): Promise<IndexedDbSchemaDescription>;
  inspect(work?: WorkRuntime): Promise<IndexedDbInspection>;
  writeInitialCopy(prepared: PreparedInitialCopy, work?: WorkRuntime): Promise<InitialCopyResult>;
  replaceCopiedInitialCopy(
    prepared: PreparedInitialCopy,
    expectedLedger: MigrationLedger,
  ): Promise<void>;
  repairHistoricalLineage(prepared: PreparedLineageRepair, work?: WorkRuntime): Promise<void>;
  readWorkspaceRecords(work?: WorkRuntime): Promise<WorkspaceRecordCandidates>;
  readLegacyBackup(id: string, work?: WorkRuntime): Promise<LegacyBackupRecord | undefined>;
  readMigrationLedger(work?: WorkRuntime): Promise<unknown>;
  markVerified(expected: VerificationExpectation, work?: WorkRuntime): Promise<MigrationLedger>;
  markLegacyDrift(expected: LegacyDriftExpectation, work?: WorkRuntime): Promise<MigrationLedger>;
  recoverLegacyAsCopies(prepared: PreparedLegacyRecovery): Promise<MigrationLedger>;
  saveProject(project: WorkspaceProject, expectedLineage: ProjectLineage): Promise<StoredProject>;
  saveWorkspace(workspace: StoredWorkspace, expectedRevision: number): Promise<StoredWorkspace>;
  createAndActivateProject(
    prepared: PreparedProjectCreation,
    expectedWorkspaceRevision: number,
  ): Promise<StoredWorkspace>;
  activateProject(projectId: string, expectedWorkspaceRevision: number): Promise<StoredWorkspace>;
  closeProject(
    projectId: string,
    successor: PreparedProjectCreation | undefined,
    expectedWorkspaceRevision: number,
    expectedLineage: ProjectLineage,
  ): Promise<StoredWorkspace>;
  saveCustomPreset(preset: WorkspaceCustomPreset): Promise<void>;
  deleteCustomPreset(presetId: string): Promise<void>;
  stageImport(
    pendingImport: WorkspacePendingImport,
    pendingImportDigest: string,
    attemptProvenance?: WorkspaceImportAttemptProvenance,
  ): Promise<void>;
  replaceStagedImport(prepared: PreparedImportReplacement): Promise<void>;
  consumeImport(
    importId: string,
    expectedWorkspaceRevision: number,
    prepared?: PreparedImportConsumption,
    knownTargetProjectId?: string,
  ): Promise<{ targetProjectId: string; consumed: boolean }>;
}

const recognizedLedger = (value: unknown): value is MigrationLedger => {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Partial<MigrationLedger>;
  return candidate.id === WORKSPACE_MIGRATION_ID
    && candidate.indexedDbVersion === HISTORICAL_WORKSPACE_FORMAT_VERSION
    && candidate.persistenceRolloutEpoch === 1
    && (
      candidate.state === 'copied'
      || candidate.state === 'verified'
      || candidate.state === 'cleanup-started'
      || candidate.state === 'cleanup-complete'
    );
};

const isCurrentStoredProject = (
  value: StoredProject | HistoricalStoredProjectV1,
): value is StoredProject => typeof value.incarnation === 'string';

const errorName = (error: unknown): string | undefined => {
  if (error === null || (typeof error !== 'object' && typeof error !== 'function')) {
    return undefined;
  }
  const name = Reflect.get(error, 'name');
  return typeof name === 'string' ? name : undefined;
};

const mappedError = (
  error: unknown,
  fallback: 'io' | 'unavailable' = 'io',
): WorkspaceStoreError => {
  if (error instanceof WorkspaceStoreError) return error;

  switch (errorName(error)) {
    case 'QuotaExceededError':
      return new WorkspaceStoreError('IndexedDB quota was exceeded.', 'quota', error);
    case 'DataCloneError':
      return new WorkspaceStoreError('Value could not be cloned for IndexedDB.', 'clone', error);
    case 'ConstraintError':
      return new WorkspaceStoreError('IndexedDB write conflicted with stored data.', 'conflict', error);
    case 'InvalidStateError':
    case 'NotFoundError':
    case 'VersionError':
      return new WorkspaceStoreError('IndexedDB is unavailable.', 'unavailable', error);
    default:
      return fallback === 'unavailable'
        ? new WorkspaceStoreError('IndexedDB is unavailable.', 'unavailable', error)
        : new WorkspaceStoreError('IndexedDB operation failed.', 'io', error);
  }
};

const conflict = (message: string): WorkspaceStoreError =>
  new WorkspaceStoreError(message, 'conflict');

const validation = (message: string): WorkspaceStoreError =>
  new WorkspaceStoreError(message, 'validation');

const isDigest = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

const validateAttemptProvenance = (
  value: WorkspaceImportAttemptProvenance,
): WorkspaceImportAttemptProvenance => {
  if (!isDigest(value.sourceKeyDigest) || !isDigest(value.payloadDigest)) {
    throw validation('Import attempt provenance must contain lowercase SHA-256 digests.');
  }
  return value;
};

const storedAttemptProvenance = (
  value: WorkspaceImportAttemptProvenance | undefined,
  pendingImportDigest: string,
): StoredImportAttemptProvenance | undefined => value
  ? { ...validateAttemptProvenance(value), pendingImportDigest }
  : undefined;

const sameAttemptProvenance = (
  left: StoredImportAttemptProvenance | undefined,
  right: StoredImportAttemptProvenance | undefined,
): boolean => {
  if (left === undefined || right === undefined) return left === right;
  return left.sourceKeyDigest === right.sourceKeyDigest
    && left.payloadDigest === right.payloadDigest
    && left.pendingImportDigest === right.pendingImportDigest;
};

const unverifiedAuthority = (): WorkspaceStoreError =>
  new WorkspaceStoreError('IndexedDB workspace authority is not verified.', 'authority-lost');

const restoreGlobalIndexedDB = (
  descriptor: PropertyDescriptor | undefined,
): void => {
  if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor);
  else Reflect.deleteProperty(globalThis, 'indexedDB');
};

const openWithFactory = <T>(indexedDB: IDBFactory, operation: () => T): T => {
  if (globalThis.indexedDB === indexedDB) return operation();

  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  try {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: indexedDB,
    });
    return operation();
  } finally {
    restoreGlobalIndexedDB(descriptor);
  }
};

const abortTransaction = async (
  transaction: WriteTransaction | undefined,
  requests: Promise<unknown>[],
  error: unknown,
  work?: WorkRuntime,
): Promise<never> => {
  if (transaction) {
    try {
      transaction.abort();
    } catch {
      // Transaction may already have aborted because a request failed.
    }
    await Promise.allSettled([...requests, transaction.done]);
  }
  work?.assertCurrent();
  throw mappedError(error);
};

const requireVerifiedAuthority: (
  ledger: unknown,
) => asserts ledger is MigrationLedger = ledger => {
  if (!recognizedLedger(ledger)
    || ledger.state !== 'verified'
    || ledger.unresolvedRecovery !== null) {
    throw unverifiedAuthority();
  }
};

const requireWorkspaceRevision = (
  workspace: StoredWorkspaceRecord | undefined,
  expectedRevision: number,
): StoredWorkspace => {
  if (!workspace || workspace.revision !== expectedRevision) {
    throw conflict('Workspace revision changed.');
  }
  if ('kind' in workspace) {
    throw conflict('Normalized workspace is not historical editing authority.');
  }
  return workspace;
};

const requireProjectIncarnation = (incarnation: unknown): string => {
  if (typeof incarnation !== 'string' || incarnation.length === 0) {
    throw validation('Project incarnation must be non-empty.');
  }
  return incarnation;
};

export const createIndexedDbAdapter = (
  environment: IndexedDbAdapterEnvironment,
  requestedVersion = WORKSPACE_DB_VERSION,
): IndexedDbAdapter => {
  let database: IDBPDatabase<NormalizedWorkspaceDatabase> | undefined;
  let opening: Promise<void> | undefined;
  let openingGeneration: number | undefined;
  let openGeneration = 0;
  let authorityError: WorkspaceStoreError | undefined;

  const reportAuthorityLoss = (
    error: WorkspaceStoreError,
    connection?: IDBPDatabase<NormalizedWorkspaceDatabase>,
  ): void => {
    if (authorityError) return;
    authorityError = error;
    const connectionToClose = connection ?? database;
    if (database === connectionToClose) database = undefined;
    connectionToClose?.close();
    environment.onAuthorityLost?.(error);
  };

  const openConnection = async (generation: number): Promise<void> => {
    if (authorityError) throw authorityError;

    let openedConnection: IDBPDatabase<NormalizedWorkspaceDatabase> | undefined;
    let blockedError: WorkspaceStoreError | undefined;
    let rejectBlocked!: (error: WorkspaceStoreError) => void;
    const blocked = new Promise<never>((_resolve, reject) => {
      rejectBlocked = reject;
    });

    let underlyingOpen: Promise<IDBPDatabase<NormalizedWorkspaceDatabase>>;
    try {
      underlyingOpen = openWithFactory(environment.indexedDB, () =>
        openDB<NormalizedWorkspaceDatabase>(WORKSPACE_DB_NAME, requestedVersion, {
          upgrade(upgradeDatabase) {
            for (const storeName of STORE_NAMES) {
              if (!upgradeDatabase.objectStoreNames.contains(storeName)) {
                upgradeDatabase.createObjectStore(storeName, { keyPath: 'id' });
              }
            }
            if (requestedVersion === NORMALIZED_DB_VERSION) {
              const normalized = upgradeDatabase;
              for (const storeName of NORMALIZED_STORE_NAMES) {
                if (!normalized.objectStoreNames.contains(storeName)) {
                  normalized.createObjectStore(storeName, {
                    keyPath: storeName === 'normalizationLedger' ? 'id' : 'key',
                  });
                }
              }
            }
          },
          blocked() {
            blockedError ??= new WorkspaceStoreError(
              INDEXED_DB_UPGRADE_BLOCKED_MESSAGE,
              'unavailable',
            );
            authorityError ??= blockedError;
            rejectBlocked(blockedError);
          },
          blocking() {
            reportAuthorityLoss(
              new WorkspaceStoreError(
                'IndexedDB authority was lost to a database version change.',
                'authority-lost',
              ),
              openedConnection,
            );
          },
          terminated() {
            reportAuthorityLoss(
              new WorkspaceStoreError('IndexedDB connection was terminated.', 'unavailable'),
              openedConnection,
            );
          },
        }));
    } catch (error) {
      throw mappedError(error, 'unavailable');
    }

    const guardedOpen = underlyingOpen.then(opened => {
      openedConnection = opened;
      if (blockedError) {
        opened.close();
        throw blockedError;
      }
      return opened;
    });

    try {
      const opened = await Promise.race([guardedOpen, blocked]);
      if (generation !== openGeneration) {
        opened.close();
        return;
      }
      database = opened;
    } catch (error) {
      throw mappedError(error, 'unavailable');
    }
  };

  const open = (): Promise<void> => {
    if (authorityError) return Promise.reject(authorityError);
    if (database) return Promise.resolve();
    if (!opening) {
      const generation = openGeneration;
      openingGeneration = generation;
      opening = openConnection(generation).finally(() => {
        if (openingGeneration === generation) {
          opening = undefined;
          openingGeneration = undefined;
        }
      });
    }
    return opening;
  };

  const getDatabase = async (): Promise<IDBPDatabase<NormalizedWorkspaceDatabase>> => {
    if (authorityError) throw authorityError;
    await open();
    if (authorityError) throw authorityError;
    if (!database) throw new WorkspaceStoreError('IndexedDB is unavailable.', 'unavailable');
    return database;
  };

  const prerequisiteTransaction = (
    activeDatabase: IDBPDatabase<NormalizedWorkspaceDatabase>,
    stores: readonly StoreName[],
  ): WriteTransaction => activeDatabase.transaction(
    activeDatabase.version === NORMALIZED_DB_VERSION ? [...stores, 'normalizationLedger'] : stores,
    'readwrite',
  );
  const requireUnreservedNormalization = async (transaction: WriteTransaction): Promise<void> => {
    if (transaction.objectStoreNames.contains('normalizationLedger')
      && await transaction.objectStore('normalizationLedger').count() !== 0) {
      throw conflict('Normalization has already reserved historical source authority.');
    }
  };

  const describeSchema = async (): Promise<IndexedDbSchemaDescription> => {
    const activeDatabase = await getDatabase();
    let transaction;
    try {
      transaction = activeDatabase.transaction(STORE_NAMES, 'readonly');
      const description = Object.fromEntries(STORE_NAMES.map(storeName => [
        storeName,
        Array.from(transaction.objectStore(storeName).indexNames),
      ])) as unknown as IndexedDbSchemaDescription;
      await transaction.done;
      return description;
    } catch (error) {
      if (transaction) await transaction.done.catch(() => {});
      throw mappedError(error);
    }
  };

  const collectHistoricalRows = (
    transaction: ReadTransaction,
    stores: readonly StoreName[],
    work: WorkRuntime,
    currentWorkspaceOnly: boolean,
  ): Promise<IndexedDbInspection> => {
    const native = unwrap(transaction);
    const rows: Record<StoreName, unknown[]> = {
      projects: [], workspace: [], presets: [], pendingImports: [], migrationLedger: [], legacyBackup: [],
    };
    return new Promise((resolve, reject) => {
      let index = 0, settled = false;
      const cleanup = () => native.removeEventListener('abort', onAbort);
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true; cleanup();
        try { native.abort(); } catch { /* Already completed/aborted. */ }
        reject(error);
      };
      const onAbort = () => fail(native.error ?? new DOMException('Historical read aborted.', 'AbortError'));
      const nextStore = () => {
        try {
          work.assertCurrent();
          if (index === stores.length) {
            settled = true; cleanup(); resolve(rows as IndexedDbInspection);
            return;
          }
          const name = stores[index++];
          work.note('visits'); work.note('primitiveExceptions');
          const request = native.objectStore(name).openCursor(currentWorkspaceOnly && name === 'workspace' ? 'current' : undefined);
          request.addEventListener('error', () => fail(request.error), { once: true });
          request.addEventListener('success', () => {
            try {
              work.assertCurrent();
              const cursor = request.result;
              if (!cursor) {
                work.note('eofChecks');
                nextStore();
                return;
              }
              work.note('visits'); work.note('primitiveExceptions');
              const row: unknown = cursor.value;
              work.note(name === 'migrationLedger' || name === 'legacyBackup' ? 'metadataRows' : 'candidateRows');
              if (name === 'legacyBackup' && row !== null && typeof row === 'object'
                && Reflect.get(row, 'kind') === 'normalization-source') {
                throw new WorkspaceStoreError('Normalized source requires private recovery access.', 'authority-lost');
              }
              rows[name].push(row);
              work.assertCurrent();
              work.note('visits'); work.note('primitiveExceptions');
              cursor.continue();
            } catch (error) { fail(error); }
          });
        } catch (error) { fail(error); }
      };
      native.addEventListener('abort', onAbort, { once: true });
      nextStore();
    });
  };

  function* measureHistoricalRow(row: unknown, metric: 'candidateBytes' | 'metadataBytes', work: WorkRuntime): Work<void> {
    const weight = yield* rawValueWeightWork(row);
    yield* effect(1, () => {
      work.note(metric, weight.bytes);
      work.note('unmeasuredValues', weight.unmeasuredValues);
    });
  }

  function* measureHistoricalRows(rows: IndexedDbInspection, stores: readonly StoreName[], work: WorkRuntime): Work<void> {
    for (const store of stores) {
      yield* effect(1, () => {});
      for (const row of rows[store]) {
        yield* measureHistoricalRow(row, store === 'migrationLedger' || store === 'legacyBackup' ? 'metadataBytes' : 'candidateBytes', work);
      }
    }
  }

  // At most two ledger images per prerequisite transaction. Record references
  // during IDB callbacks; traverse only after commit/abort has fully settled.
  const createTransactionAccounting = (work: WorkRuntime) => {
    let rows: Map<unknown, { reads: number; operations: number; measured: boolean }> | undefined = new Map();
    let ownership: Ownership | undefined;
    let preserveFailure = false, measurementFailed = false, finished = false;
    const track = (value: unknown, reads: number, operations: number) => {
      if (value === undefined) return;
      ownership ??= work.own(0);
      const entry = rows!.get(value) ?? { reads: 0, operations: 0, measured: false };
      entry.reads += reads; entry.operations += operations; rows!.set(value, entry);
    };
    const finish = async () => {
      work.assertCurrent();
      if (!rows || finished) return;
      try { await work.run((function* () {
        for (const [value, entry] of rows!) {
          if (entry.measured) continue;
          const weight = yield* rawValueWeightWork(value);
          yield* effect(1, () => {
            ownership!.grow(weight.bytes);
            work.note('metadataBytes', entry.reads * weight.bytes);
            work.note('markerWorkBytes', entry.operations * weight.bytes);
            work.note('unmeasuredValues', weight.unmeasuredValues);
            entry.measured = true;
          });
        }
      })()); }
      catch (error) { measurementFailed = true; throw error; }
      finished = true;
      work.assertCurrent();
    };
    return {
      read: (value: unknown) => track(value, 1, 1),
      operation: (value: unknown, count = 1) => track(value, 0, count),
      failed: () => { preserveFailure = true; },
      finish,
      async close() {
        try {
          if (!work.stopped() && !measurementFailed) await finish();
          work.assertCurrent();
        } catch (error) {
          if (!preserveFailure || work.stopped()) throw error;
        } finally {
          if (rows) for (const entry of rows.values()) if (!entry.measured) work.note('unmeasuredValues');
          rows = undefined;
          ownership?.release(); ownership = undefined;
        }
      },
    };
  };

  const inspect = async (work?: WorkRuntime): Promise<IndexedDbInspection> => {
    work?.assertCurrent();
    const activeDatabase = work ? await work.wait(getDatabase) : await getDatabase();
    work?.assertCurrent();
    let transaction;
    try {
      transaction = activeDatabase.transaction(STORE_NAMES, 'readonly');
      if (work) {
        const rows = await collectHistoricalRows(transaction, STORE_NAMES, work, false);
        work.assertCurrent();
        await transaction.done;
        work.assertCurrent();
        await work.run(measureHistoricalRows(rows, STORE_NAMES, work));
        work.assertCurrent();
        return rows;
      }
      const requests = STORE_NAMES.map(storeName =>
        transaction.objectStore(storeName).getAll());
      const [
        projects,
        workspace,
        presets,
        pendingImports,
        migrationLedger,
        legacyBackup,
      ] = await Promise.all(requests);
      await transaction.done;
      // The historical facade cannot reinterpret the separately discriminated
      // normalization archive as a legacy-localStorage backup.
      for (const candidate of legacyBackup) {
        if (candidate !== null && typeof candidate === 'object'
          && Reflect.get(candidate, 'kind') === 'normalization-source') {
          throw new WorkspaceStoreError('Normalized source requires private recovery access.', 'authority-lost');
        }
      }
      return {
        projects,
        workspace: workspace as StoredWorkspace[],
        presets: presets as StoredPreset[],
        pendingImports: pendingImports as StoredPendingImport[],
        migrationLedger: migrationLedger as MigrationLedger[],
        legacyBackup: legacyBackup as LegacyBackupRecord[],
      };
    } catch (error) {
      if (transaction) {
        if (work) {
          try { transaction.abort(); } catch { /* Already completed/aborted. */ }
        }
        await transaction.done.catch(() => {});
      }
      work?.assertCurrent();
      throw mappedError(error);
    }
  };

  const enqueuePreparedCopy = (
    transaction: WriteTransaction,
    prepared: PreparedInitialCopy,
    requests: Promise<unknown>[],
    work?: WorkRuntime,
    accounting?: ReturnType<typeof createTransactionAccounting>,
  ): void | Promise<void> => {
    const groups = [
      { store: 'projects', rows: () => prepared.projects, after: 'copy.after-projects' },
      { store: 'workspace', rows: () => [prepared.workspace], after: 'copy.after-workspace' },
      { store: 'presets', rows: () => prepared.presets, after: 'copy.after-presets' },
      { store: 'pendingImports', rows: () => prepared.pendingImports, after: 'copy.after-pending-imports' },
      { store: 'legacyBackup', rows: () => [prepared.backup], after: 'copy.after-backup' },
      { store: 'migrationLedger', rows: () => [prepared.ledger], after: 'copy.after-ledger' },
    ] as const;
    if (!work) {
      for (const group of groups) {
        const store = transaction.objectStore(group.store);
        for (const row of group.rows()) requests.push(store.add(row));
        environment.fault?.(group.after);
      }
      environment.fault?.('copy.before-complete');
      return;
    }
    const native = unwrap(transaction);
    const completion = new Promise<void>((resolve, reject) => {
      let groupIndex = 0, rowIndex = 0, settled = false;
      let rows: readonly unknown[] | undefined;
      const cleanup = () => native.removeEventListener('abort', onAbort);
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        // Abort in the request callback, before the transaction can auto-commit.
        try { native.abort(); } catch { /* Already aborted/completed. */ }
        reject(error);
      };
      const onAbort = () => fail(native.error ?? new DOMException('Copy transaction aborted.', 'AbortError'));
      const next = () => {
        try {
          work.assertCurrent();
          // Only six fixed groups; input-sized iteration happens one request
          // success at a time. Never run/yield/hash/observe inside this tx.
          while (groupIndex < groups.length) {
            const group = groups[groupIndex];
            rows ??= group.rows();
            if (rowIndex < rows.length) {
              work.assertCurrent();
              work.note('visits');
              work.note('primitiveExceptions');
              work.note('writes'); // Write attempts, not durable commits.
              const row = rows[rowIndex++];
              if (group.store === 'migrationLedger') accounting?.operation(row);
              const request = native.objectStore(group.store).add(row);
              request.addEventListener('success', () => {
                try { work.assertCurrent(); next(); } catch (error) { fail(error); }
              }, { once: true });
              request.addEventListener('error', () => fail(request.error), { once: true });
              return;
            }
            environment.fault?.(group.after);
            work.assertCurrent();
            groupIndex += 1;
            rowIndex = 0;
            rows = undefined;
          }
          environment.fault?.('copy.before-complete');
          work.assertCurrent();
          settled = true;
          cleanup();
          resolve();
        } catch (error) { fail(error); }
      };
      native.addEventListener('abort', onAbort, { once: true });
      next();
    });
    requests.push(completion);
    return completion;
  };

  const writeInitialCopy = async (
    prepared: PreparedInitialCopy,
    work?: WorkRuntime,
  ): Promise<InitialCopyResult> => {
    work?.assertCurrent();
    const activeDatabase = work ? await work.wait(getDatabase) : await getDatabase();
    work?.assertCurrent();
    try {
      environment.fault?.('copy.before-transaction');
      work?.assertCurrent();
    } catch (error) {
      work?.assertCurrent();
      throw mappedError(error);
    }

    let transaction: WriteTransaction | undefined;
    const requests: Promise<unknown>[] = [];
    const accounting = work ? createTransactionAccounting(work) : undefined;
    // Fixed native reservation check; its approved helper/prefix stay intact.
    work?.note('visits');
    work?.note('primitiveExceptions');
    try {
      transaction = prerequisiteTransaction(activeDatabase, STORE_NAMES);
      await requireUnreservedNormalization(transaction);
      work?.assertCurrent();
      work?.note('visits', STORE_NAMES.length + 1);
      work?.note('primitiveExceptions', STORE_NAMES.length + 1);
      const ledgerRequest = transaction.objectStore('migrationLedger').get(WORKSPACE_MIGRATION_ID);
      const countRequests = STORE_NAMES.map(storeName =>
        transaction.objectStore(storeName).count());
      const [ledger, ...counts] = await Promise.all([ledgerRequest, ...countRequests]);
      accounting?.read(ledger);
      work?.assertCurrent();
      if (ledger !== undefined) work?.note('metadataRows');

      if (recognizedLedger(ledger)) {
        await transaction.done;
        work?.assertCurrent();
        if (accounting) await accounting.finish();
        work?.assertCurrent();
        return { status: 'existing-ledger' };
      }
      if (counts.some(count => count !== 0)) {
        await transaction.done;
        work?.assertCurrent();
        if (accounting) await accounting.finish();
        work?.assertCurrent();
        return { status: 'orphaned-target' };
      }

      const queued = enqueuePreparedCopy(transaction, prepared, requests, work, accounting);
      if (queued) await queued;
      work?.assertCurrent();

      await Promise.all(requests);
      await transaction.done;
      work?.assertCurrent();
      if (accounting) await accounting.finish();
      work?.assertCurrent();
      work?.notify('durable');
      return { status: 'copied' };
    } catch (error) {
      accounting?.failed();
      return await abortTransaction(transaction, requests, error, work);
    } finally {
      if (accounting) await accounting.close();
    }
  };

  const replaceCopiedInitialCopy = async (
    prepared: PreparedInitialCopy,
    expectedLedger: MigrationLedger,
  ): Promise<void> => {
    const activeDatabase = await getDatabase();
    try {
      environment.fault?.('copy.before-transaction');
    } catch (error) {
      throw mappedError(error);
    }

    let transaction: WriteTransaction | undefined;
    const requests: Promise<unknown>[] = [];
    try {
      transaction = activeDatabase.transaction(STORE_NAMES, 'readwrite');
      const ledgerStore = transaction.objectStore('migrationLedger');
      const currentLedger = await ledgerStore.get(WORKSPACE_MIGRATION_ID);
      if (!recognizedLedger(currentLedger)
        || currentLedger.state !== 'copied'
        || currentLedger.unresolvedRecovery !== null
        || canonicalStringify(currentLedger) !== canonicalStringify(expectedLedger)) {
        throw conflict('Copied migration ledger changed before replacement.');
      }

      const keys = await Promise.all(STORE_NAMES.map(name =>
        transaction!.objectStore(name).getAllKeys()));
      for (const [index, name] of STORE_NAMES.entries()) {
        const objectStore = transaction.objectStore(name);
        for (const key of keys[index]) requests.push(objectStore.delete(key));
      }
      enqueuePreparedCopy(transaction, prepared, requests);
      await Promise.all(requests);
      await transaction.done;
    } catch (error) {
      return abortTransaction(transaction, requests, error);
    }
  };

  // Historical CAS uses whole-record canonical depth semantics. This is the
  // approved synchronous one-record comparison exception, never a dataset pass.
  const sameRepairRecord = (current: unknown, expected: unknown, work: WorkRuntime, measureProject = false): boolean => {
    work.assertCurrent();
    work.note('visits');
    work.note('primitiveExceptions');
    let bytes = 0, complete = false;
    const observed: Frame = measureProject ? emit => canonicalWork(current, function* (fragment) {
      // Reuse the already-required comparison stream, without another record
      // traversal or retaining a second workspace graph just for accounting.
      bytes += yield* utf8LengthWork(fragment);
      yield* emit(fragment);
    }) : emit => canonicalWork(current, emit);
    try {
      const equal = runSync(equalFrameWork(observed, emit => canonicalWork(expected, emit)));
      complete = equal;
      work.assertCurrent();
      return equal;
    } finally {
      if (measureProject) {
        work.note('candidateBytes', bytes);
        // A stopped/malformed/mismatching stream cannot certify full row size.
        if (!complete) work.note('unmeasuredValues');
      }
    }
  };

  const enqueueLineageRepair = (
    transaction: WriteTransaction,
    prepared: PreparedLineageRepair,
    expectedIndex: Map<string, unknown>,
    requests: Promise<unknown>[],
    work: WorkRuntime,
    accounting?: ReturnType<typeof createTransactionAccounting>,
  ): Promise<void> => {
    const native = unwrap(transaction);
    const completion = new Promise<void>((resolve, reject) => {
      let settled = false, replacementIndex = 0;
      const cleanup = () => native.removeEventListener('abort', onAbort);
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true; cleanup();
        try { native.abort(); } catch { /* Already aborted/completed. */ }
        reject(error);
      };
      const onAbort = () => fail(native.error ?? new DOMException('Lineage transaction aborted.', 'AbortError'));
      const nextWrite = () => {
        try {
          work.assertCurrent();
          const isProject = replacementIndex < prepared.replacementProjects.length;
          work.note('visits'); work.note('primitiveExceptions'); work.note('writes');
          if (!isProject) accounting?.operation(prepared.ledger);
          const request = isProject
            ? native.objectStore('projects').put(prepared.replacementProjects[replacementIndex++])
            : native.objectStore('migrationLedger').put(prepared.ledger);
          request.addEventListener('error', () => fail(request.error), { once: true });
          request.addEventListener('success', () => {
            try {
              work.assertCurrent();
              if (isProject) nextWrite();
              else { settled = true; cleanup(); resolve(); }
            } catch (error) { fail(error); }
          }, { once: true });
          environment.fault?.(isProject ? 'lineage-repair.after-project-write' : 'lineage-repair.after-ledger-write');
          work.assertCurrent();
          if (!isProject) {
            environment.fault?.('lineage-repair.before-complete');
            work.assertCurrent();
          }
        } catch (error) { fail(error); }
      };
      native.addEventListener('abort', onAbort, { once: true });
      try {
        work.assertCurrent();
        work.note('visits'); work.note('primitiveExceptions');
        const request = native.objectStore('projects').openCursor();
        request.addEventListener('error', () => fail(request.error), { once: true });
        request.addEventListener('success', () => {
          try {
            work.assertCurrent();
            const cursor = request.result;
            if (!cursor) {
              work.note('eofChecks');
              if (expectedIndex.size !== 0) throw conflict('Historical project key set changed before lineage repair.');
              nextWrite();
              return;
            }
            work.note('candidateRows');
            work.note('visits'); work.note('primitiveExceptions');
            const id = String(cursor.primaryKey);
            if (!expectedIndex.has(id) || cursor.primaryKey !== id) {
              throw conflict('Historical project key set changed before lineage repair.');
            }
            if (!sameRepairRecord(cursor.value, expectedIndex.get(id), work, true)) {
              throw conflict(`Historical project ${id} changed before lineage repair.`);
            }
            expectedIndex.delete(id);
            work.assertCurrent();
            work.note('visits'); work.note('primitiveExceptions');
            cursor.continue();
          } catch (error) { fail(error); }
        });
      } catch (error) { fail(error); }
    });
    requests.push(completion);
    return completion;
  };

  const repairHistoricalLineage = async (
    prepared: PreparedLineageRepair,
    work?: WorkRuntime,
  ): Promise<void> => {
    work?.assertCurrent();
    const indexOwnership = work?.own(0);
    let expectedIndex = work ? new Map<string, unknown>() : undefined;
    let activeDatabase: IDBPDatabase<NormalizedWorkspaceDatabase>;
    try {
      if (work && expectedIndex) {
        const index = expectedIndex;
        await work.run((function* () {
          for (const expected of prepared.expectedProjects) {
            const keyBytes = yield* utf8LengthWork(expected.id);
            yield* primitive('scalar', () => {
              if (index.has(expected.id)) throw conflict('Historical project key set changed before lineage repair.');
              index.set(expected.id, expected.record);
              // Two reference slots plus key text; payload is borrowed from prepared.
              // Keep this conservative reservation until the transaction settles.
              indexOwnership!.grow(16 + keyBytes);
            });
          }
        })());
      }
      activeDatabase = work ? await work.wait(getDatabase) : await getDatabase();
      work?.assertCurrent();
      try {
        environment.fault?.('lineage-repair.before-transaction');
        work?.assertCurrent();
      } catch (error) {
        work?.assertCurrent();
        throw mappedError(error);
      }
    } catch (error) {
      expectedIndex = undefined;
      indexOwnership?.release();
      throw error;
    }

    let transaction: WriteTransaction | undefined;
    const requests: Promise<unknown>[] = [];
    const accounting = work ? createTransactionAccounting(work) : undefined;
    work?.note('visits'); work?.note('primitiveExceptions');
    try {
      const repairTransaction = prerequisiteTransaction(activeDatabase, ['projects', 'migrationLedger']);
      transaction = repairTransaction as WriteTransaction;
      await requireUnreservedNormalization(transaction);
      work?.assertCurrent();
      const projectStore = repairTransaction.objectStore('projects');
      const ledgerStore = repairTransaction.objectStore('migrationLedger');
      work?.note('visits'); work?.note('primitiveExceptions');
      const currentLedger = await ledgerStore.get(WORKSPACE_MIGRATION_ID);
      accounting?.read(currentLedger);
      work?.assertCurrent();
      if (currentLedger !== undefined) work?.note('metadataRows');
      work?.note('markerCasRows');
      if (work ? !sameRepairRecord(currentLedger, prepared.expectedLedger, work)
        : canonicalStringify(currentLedger) !== canonicalStringify(prepared.expectedLedger)) {
        throw conflict('Historical migration ledger changed before lineage repair.');
      }

      if (work && expectedIndex) {
        await enqueueLineageRepair(transaction, prepared, expectedIndex, requests, work, accounting);
        work.assertCurrent();
        await repairTransaction.done;
        work.assertCurrent();
        if (accounting) await accounting.finish();
        work.assertCurrent();
        work.notify('durable');
        return;
      }

      const actualKeys = (await projectStore.getAllKeys()).map(String).sort();
      const expectedKeys = prepared.expectedProjects.map(item => item.id).sort();
      if (canonicalStringify(actualKeys) !== canonicalStringify(expectedKeys)) {
        throw conflict('Historical project key set changed before lineage repair.');
      }
      for (const expected of prepared.expectedProjects) {
        const current = await projectStore.get(expected.id);
        if (canonicalStringify(current) !== canonicalStringify(expected.record)) {
          throw conflict(`Historical project ${expected.id} changed before lineage repair.`);
        }
      }

      for (const replacement of prepared.replacementProjects) {
        requests.push(projectStore.put(replacement));
        environment.fault?.('lineage-repair.after-project-write');
      }
      requests.push(ledgerStore.put(prepared.ledger));
      environment.fault?.('lineage-repair.after-ledger-write');
      environment.fault?.('lineage-repair.before-complete');
      await Promise.all(requests);
      await repairTransaction.done;
    } catch (error) {
      accounting?.failed();
      return await abortTransaction(transaction, requests, error, work);
    } finally {
      try { if (accounting) await accounting.close(); }
      finally { expectedIndex = undefined; indexOwnership?.release(); }
    }
  };

  const readWorkspaceRecords = async (work?: WorkRuntime): Promise<WorkspaceRecordCandidates> => {
    work?.assertCurrent();
    const activeDatabase = work ? await work.wait(getDatabase) : await getDatabase();
    work?.assertCurrent();
    const storeNames = ['projects', 'workspace', 'presets', 'pendingImports'] as const;
    let transaction;
    try {
      transaction = activeDatabase.transaction(storeNames, 'readonly');
      if (work) {
        const rows = await collectHistoricalRows(transaction, storeNames, work, true);
        work.assertCurrent();
        await transaction.done;
        work.assertCurrent();
        await work.run(measureHistoricalRows(rows, storeNames, work));
        work.assertCurrent();
        return { projects: rows.projects, workspace: rows.workspace[0], presets: rows.presets, pendingImports: rows.pendingImports };
      }
      const [projects, workspace, presets, pendingImports] = await Promise.all([
        transaction.objectStore('projects').getAll(),
        transaction.objectStore('workspace').get('current'),
        transaction.objectStore('presets').getAll(),
        transaction.objectStore('pendingImports').getAll(),
      ]);
      await transaction.done;
      return {
        projects,
        workspace,
        presets,
        pendingImports,
      };
    } catch (error) {
      if (transaction) {
        if (work) {
          try { transaction.abort(); } catch { /* Already completed/aborted. */ }
        }
        await transaction.done.catch(() => {});
      }
      work?.assertCurrent();
      throw mappedError(error);
    }
  };

  const readLegacyBackup = async (
    id: string,
    work?: WorkRuntime,
  ): Promise<LegacyBackupRecord | undefined> => {
    work?.assertCurrent();
    const activeDatabase = work ? await work.wait(getDatabase) : await getDatabase();
    work?.assertCurrent();
    let transaction;
    try {
      transaction = activeDatabase.transaction('legacyBackup', 'readonly');
      work?.assertCurrent();
      work?.note('visits'); work?.note('primitiveExceptions');
      const backup = await transaction.store.get(id);
      if (backup !== undefined) work?.note('metadataRows');
      work?.assertCurrent();
      await transaction.done;
      work?.assertCurrent();
      if (backup !== null && typeof backup === 'object' && Reflect.get(backup, 'kind') === 'normalization-source') {
        throw new WorkspaceStoreError('Normalization archives are not legacy backups.', 'authority-lost');
      }
      if (work && backup !== undefined) await work.run(measureHistoricalRow(backup, 'metadataBytes', work));
      work?.assertCurrent();
      return backup;
    } catch (error) {
      if (transaction) {
        if (work) {
          try { transaction.abort(); } catch { /* Already completed/aborted. */ }
        }
        await transaction.done.catch(() => {});
      }
      work?.assertCurrent();
      throw mappedError(error);
    }
  };

  const readMigrationLedger = async (work?: WorkRuntime): Promise<unknown> => {
    work?.assertCurrent();
    const activeDatabase = work ? await work.wait(getDatabase) : await getDatabase();
    work?.assertCurrent();
    let transaction;
    try {
      transaction = activeDatabase.transaction('migrationLedger', 'readonly');
      work?.assertCurrent();
      work?.note('visits'); work?.note('primitiveExceptions');
      const ledger = await transaction.store.get(WORKSPACE_MIGRATION_ID);
      if (ledger !== undefined) work?.note('metadataRows');
      work?.assertCurrent();
      await transaction.done;
      work?.assertCurrent();
      if (work && ledger !== undefined) await work.run(measureHistoricalRow(ledger, 'metadataBytes', work));
      work?.assertCurrent();
      return ledger;
    } catch (error) {
      if (transaction) {
        if (work) {
          try { transaction.abort(); } catch { /* Already completed/aborted. */ }
        }
        await transaction.done.catch(() => {});
      }
      work?.assertCurrent();
      throw mappedError(error);
    }
  };

  const markVerified = async (
    expected: VerificationExpectation,
    work?: WorkRuntime,
  ): Promise<MigrationLedger> => {
    work?.assertCurrent();
    const activeDatabase = work ? await work.wait(getDatabase) : await getDatabase();
    work?.assertCurrent();
    const verifiedAt = environment.now();
    work?.assertCurrent();
    let transaction: WriteTransaction | undefined;
    const requests: Promise<unknown>[] = [];
    const accounting = work ? createTransactionAccounting(work) : undefined;
    // Fixed reservation check; keep the approved acquisition/guard prefix intact.
    work?.note('visits');
    work?.note('primitiveExceptions');
    try {
      const ledgerTransaction = prerequisiteTransaction(activeDatabase, ['migrationLedger']);
      transaction = ledgerTransaction as WriteTransaction;
      await requireUnreservedNormalization(transaction);
      work?.assertCurrent();
      const ledgerStore = ledgerTransaction.objectStore('migrationLedger');
      work?.note('visits');
      work?.note('primitiveExceptions');
      const ledger = await ledgerStore.get(WORKSPACE_MIGRATION_ID);
      accounting?.read(ledger);
      work?.assertCurrent();
      if (ledger !== undefined) work?.note('metadataRows');
      work?.note('markerCasRows');
      if (!recognizedLedger(ledger)
        || ledger.state !== 'copied'
        || ledger.unresolvedRecovery !== null
        || ledger.ledgerRevision !== expected.ledgerRevision
        || ledger.sourceDigest !== expected.sourceDigest
        || ledger.expectedTargetDigest !== expected.expectedTargetDigest) {
        throw conflict('Copied migration ledger changed before verification.');
      }
      work?.assertCurrent();
      // One captured record's spread is transaction work, not a dataset traversal.
      work?.note('visits');
      work?.note('primitiveExceptions');
      const verifiedLedger: MigrationLedger = {
        ...ledger,
        state: 'verified',
        ledgerRevision: ledger.ledgerRevision + 1,
        verifiedAt,
      };
      accounting?.operation(verifiedLedger, 2); // Shallow copy and attempted put.
      work?.assertCurrent();
      work?.note('visits');
      work?.note('primitiveExceptions');
      work?.note('writes');
      requests.push(ledgerStore.put(verifiedLedger));
      environment.fault?.('mutation.before-complete');
      work?.assertCurrent();
      await Promise.all(requests);
      work?.assertCurrent();
      await ledgerTransaction.done;
      work?.assertCurrent();
      if (accounting) await accounting.finish();
      work?.assertCurrent();
      work?.notify('durable');
      return verifiedLedger;
    } catch (error) {
      accounting?.failed();
      return await abortTransaction(transaction, requests, error, work);
    } finally {
      if (accounting) await accounting.close();
    }
  };

  const markLegacyDrift = async (
    expected: LegacyDriftExpectation,
    work?: WorkRuntime,
  ): Promise<MigrationLedger> => {
    work?.assertCurrent();
    const activeDatabase = work ? await work.wait(getDatabase) : await getDatabase();
    work?.assertCurrent();
    let transaction: WriteTransaction | undefined;
    const requests: Promise<unknown>[] = [];
    const accounting = work ? createTransactionAccounting(work) : undefined;
    work?.note('visits');
    work?.note('primitiveExceptions');
    try {
      const ledgerTransaction = prerequisiteTransaction(activeDatabase, ['migrationLedger']);
      transaction = ledgerTransaction as WriteTransaction;
      await requireUnreservedNormalization(transaction);
      work?.assertCurrent();
      const ledgerStore = ledgerTransaction.objectStore('migrationLedger');
      work?.note('visits');
      work?.note('primitiveExceptions');
      const ledger = await ledgerStore.get(WORKSPACE_MIGRATION_ID);
      accounting?.read(ledger);
      work?.assertCurrent();
      if (ledger !== undefined) work?.note('metadataRows');
      work?.note('markerCasRows');
      if (!recognizedLedger(ledger)
        || ledger.state !== 'verified'
        || ledger.acceptedLegacyDigest !== expected.expectedAcceptedLegacyDigest) {
        throw conflict('Verified migration ledger changed before legacy drift was recorded.');
      }
      if (ledger.unresolvedRecovery?.kind === 'legacy-drift'
        && ledger.unresolvedRecovery.observedLegacyDigest === expected.marker.observedLegacyDigest) {
        await ledgerTransaction.done;
        work?.assertCurrent();
        if (accounting) await accounting.finish();
        work?.assertCurrent();
        return ledger;
      }
      if (ledger.ledgerRevision !== expected.expectedLedgerRevision
        || (expected.expectedRecoveryId === null
          ? ledger.unresolvedRecovery !== null
          : ledger.unresolvedRecovery?.id !== expected.expectedRecoveryId)) {
        throw conflict('Legacy recovery marker changed before drift was recorded.');
      }
      work?.assertCurrent();
      work?.note('visits');
      work?.note('primitiveExceptions');
      const next: MigrationLedger = {
        ...ledger,
        ledgerRevision: ledger.ledgerRevision + 1,
        unresolvedRecovery: expected.marker,
      };
      accounting?.operation(next, 2);
      work?.assertCurrent();
      work?.note('visits');
      work?.note('primitiveExceptions');
      work?.note('writes');
      requests.push(ledgerStore.put(next));
      await Promise.all(requests);
      work?.assertCurrent();
      await ledgerTransaction.done;
      work?.assertCurrent();
      if (accounting) await accounting.finish();
      work?.assertCurrent();
      work?.notify('durable');
      return next;
    } catch (error) {
      accounting?.failed();
      return await abortTransaction(transaction, requests, error, work);
    } finally {
      if (accounting) await accounting.close();
    }
  };

  const recoverLegacyAsCopies = async (
    prepared: PreparedLegacyRecovery,
  ): Promise<MigrationLedger> => {
    try {
      await validatePreparedLegacyRecovery(prepared);
    } catch (error) {
      throw new WorkspaceStoreError(
        'Prepared legacy recovery target is invalid.',
        'validation',
        error,
      );
    }
    const activeDatabase = await getDatabase();
    let transaction: WriteTransaction | undefined;
    const requests: Promise<unknown>[] = [];
    try {
      transaction = activeDatabase.transaction(STORE_NAMES, 'readwrite');
      const ledgerStore = transaction.objectStore('migrationLedger');
      const projectStore = transaction.objectStore('projects');
      const workspaceStore = transaction.objectStore('workspace');
      const presetStore = transaction.objectStore('presets');
      const importStore = transaction.objectStore('pendingImports');
      const [ledger, workspace, projects, presets, pendingImports] = await Promise.all([
        ledgerStore.get(WORKSPACE_MIGRATION_ID),
        workspaceStore.get('current'),
        projectStore.getAll(),
        presetStore.getAll(),
        importStore.getAll(),
      ]);
      if (!recognizedLedger(ledger)
        || ledger.state !== 'verified'
        || canonicalStringify(ledger) !== canonicalStringify(prepared.expectedLedger)
        || ledger.ledgerRevision !== prepared.expectedLedgerRevision
        || ledger.acceptedLegacyDigest !== prepared.expectedAcceptedLegacyDigest
        || ledger.acceptedLegacyBackupId !== prepared.expectedAcceptedLegacyBackupId
        || ledger.unresolvedRecovery?.kind !== 'legacy-drift'
        || ledger.unresolvedRecovery.id !== prepared.recoveryId
        || ledger.unresolvedRecovery.observedLegacyDigest !== prepared.observedLegacyDigest
        || prepared.backup.digest !== prepared.observedLegacyDigest) {
        throw conflict('Legacy recovery authority changed before copies were written.');
      }
      if (!workspace) throw conflict('Workspace record changed before legacy recovery.');

      const currentRecords: WorkspaceRecordCandidates = {
        projects,
        workspace,
        presets,
        pendingImports,
      };
      if (canonicalStringify(currentRecords)
        !== canonicalStringify(prepared.expectedRecords)) {
        throw conflict('Workspace records changed before legacy recovery.');
      }

      for (const record of prepared.projects) requests.push(projectStore.add(record));
      requests.push(workspaceStore.put(prepared.workspace));
      for (const record of prepared.presets) requests.push(presetStore.add(record));
      for (const record of prepared.pendingImports) requests.push(importStore.add(record));
      requests.push(transaction.objectStore('legacyBackup').add(prepared.backup));
      requests.push(ledgerStore.put(prepared.ledger));
      environment.fault?.('recovery.before-complete');
      await Promise.all(requests);
      await transaction.done;
      return structuredClone(prepared.ledger);
    } catch (error) {
      return abortTransaction(transaction, requests, error);
    }
  };

  const saveProject = async (
    project: WorkspaceProject,
    expectedLineage: ProjectLineage,
  ): Promise<StoredProject> => {
    const activeDatabase = await getDatabase();
    const updatedAt = environment.now();
    const storeNames = ['migrationLedger', 'projects'] as const;
    let transaction: WriteTransaction | undefined;
    const requests: Promise<unknown>[] = [];
    try {
      const projectTransaction = activeDatabase.transaction(storeNames, 'readwrite');
      transaction = projectTransaction as WriteTransaction;
      const ledger = await projectTransaction.objectStore('migrationLedger')
        .get(WORKSPACE_MIGRATION_ID);
      requireVerifiedAuthority(ledger);
      const stored = await projectTransaction.objectStore('projects').get(project.id);
      if (!stored
        || !isCurrentStoredProject(stored)
        || !sameProjectLineage(storedProjectLineage(stored), expectedLineage)) {
        throw conflict(`Project ${project.id} storage lineage changed.`);
      }
      const next: StoredProject = {
        ...stored,
        id: project.id,
        project,
        storageRevision: stored.storageRevision + 1,
        updatedAt,
      };
      requests.push(projectTransaction.objectStore('projects').put(next));
      environment.fault?.('mutation.before-complete');
      await Promise.all(requests);
      await projectTransaction.done;
      return next;
    } catch (error) {
      return abortTransaction(transaction, requests, error);
    }
  };

  const saveWorkspace = async (
    workspace: StoredWorkspace,
    expectedRevision: number,
  ): Promise<StoredWorkspace> => {
    const activeDatabase = await getDatabase();
    const storeNames = ['migrationLedger', 'workspace'] as const;
    let transaction: WriteTransaction | undefined;
    const requests: Promise<unknown>[] = [];
    try {
      const workspaceTransaction = activeDatabase.transaction(storeNames, 'readwrite');
      transaction = workspaceTransaction as WriteTransaction;
      const ledger = await workspaceTransaction.objectStore('migrationLedger')
        .get(WORKSPACE_MIGRATION_ID);
      requireVerifiedAuthority(ledger);
      const stored = requireWorkspaceRevision(await workspaceTransaction.objectStore('workspace').get('current'), expectedRevision);
      const next: StoredWorkspace = {
        ...workspace,
        id: 'current',
        revision: stored.revision + 1,
      };
      requests.push(workspaceTransaction.objectStore('workspace').put(next));
      environment.fault?.('mutation.before-complete');
      await Promise.all(requests);
      await workspaceTransaction.done;
      return next;
    } catch (error) {
      return abortTransaction(transaction, requests, error);
    }
  };

  const createAndActivateProject = async (
    prepared: PreparedProjectCreation,
    expectedWorkspaceRevision: number,
  ): Promise<StoredWorkspace> => {
    const { project } = prepared;
    const incarnation = requireProjectIncarnation(prepared.incarnation);
    const activeDatabase = await getDatabase();
    const updatedAt = environment.now();
    const storeNames = ['projects', 'workspace', 'migrationLedger'] as const;
    let transaction: WriteTransaction | undefined;
    const requests: Promise<unknown>[] = [];
    try {
      const projectTransaction = activeDatabase.transaction(storeNames, 'readwrite');
      transaction = projectTransaction as WriteTransaction;
      const ledger = await projectTransaction.objectStore('migrationLedger')
        .get(WORKSPACE_MIGRATION_ID);
      requireVerifiedAuthority(ledger);
      const workspace = requireWorkspaceRevision(
        await projectTransaction.objectStore('workspace').get('current'),
        expectedWorkspaceRevision,
      );
      if (await projectTransaction.objectStore('projects').get(project.id)) {
        throw validation(`Project ${project.id} already exists.`);
      }

      const storedProject: StoredProject = {
        id: project.id,
        project,
        incarnation,
        storageRevision: 0,
        updatedAt,
      };
      const nextWorkspace: StoredWorkspace = {
        ...workspace,
        projectOrder: [...workspace.projectOrder, project.id],
        activeProjectId: project.id,
        revision: workspace.revision + 1,
      };
      requests.push(projectTransaction.objectStore('projects').add(storedProject));
      requests.push(projectTransaction.objectStore('workspace').put(nextWorkspace));
      environment.fault?.('mutation.before-complete');
      await Promise.all(requests);
      await projectTransaction.done;
      return nextWorkspace;
    } catch (error) {
      return abortTransaction(transaction, requests, error);
    }
  };

  const activateProject = async (
    projectId: string,
    expectedWorkspaceRevision: number,
  ): Promise<StoredWorkspace> => {
    const activeDatabase = await getDatabase();
    const storeNames = ['projects', 'workspace', 'migrationLedger'] as const;
    let transaction: WriteTransaction | undefined;
    const requests: Promise<unknown>[] = [];
    try {
      const workspaceTransaction = activeDatabase.transaction(storeNames, 'readwrite');
      transaction = workspaceTransaction as WriteTransaction;
      const ledger = await workspaceTransaction.objectStore('migrationLedger')
        .get(WORKSPACE_MIGRATION_ID);
      requireVerifiedAuthority(ledger);
      const workspace = requireWorkspaceRevision(
        await workspaceTransaction.objectStore('workspace').get('current'),
        expectedWorkspaceRevision,
      );
      if (!await workspaceTransaction.objectStore('projects').get(projectId)
        || !workspace.projectOrder.includes(projectId)) {
        throw validation(`Project ${projectId} does not exist.`);
      }
      const nextWorkspace: StoredWorkspace = {
        ...workspace,
        activeProjectId: projectId,
        revision: workspace.revision + 1,
      };
      requests.push(workspaceTransaction.objectStore('workspace').put(nextWorkspace));
      environment.fault?.('mutation.before-complete');
      await Promise.all(requests);
      await workspaceTransaction.done;
      return nextWorkspace;
    } catch (error) {
      return abortTransaction(transaction, requests, error);
    }
  };

  const closeProject = async (
    projectId: string,
    successor: PreparedProjectCreation | undefined,
    expectedWorkspaceRevision: number,
    expectedLineage: ProjectLineage,
  ): Promise<StoredWorkspace> => {
    const activeDatabase = await getDatabase();
    const updatedAt = environment.now();
    const storeNames = ['projects', 'workspace', 'migrationLedger'] as const;
    let transaction: WriteTransaction | undefined;
    const requests: Promise<unknown>[] = [];
    try {
      const workspaceTransaction = activeDatabase.transaction(storeNames, 'readwrite');
      transaction = workspaceTransaction as WriteTransaction;
      const ledger = await workspaceTransaction.objectStore('migrationLedger')
        .get(WORKSPACE_MIGRATION_ID);
      requireVerifiedAuthority(ledger);
      const workspace = requireWorkspaceRevision(
        await workspaceTransaction.objectStore('workspace').get('current'),
        expectedWorkspaceRevision,
      );
      const projectStore = workspaceTransaction.objectStore('projects');
      const target = await projectStore.get(projectId);
      const targetIndex = workspace.projectOrder.indexOf(projectId);
      if (!target
        || !isCurrentStoredProject(target)
        || !sameProjectLineage(storedProjectLineage(target), expectedLineage)) {
        throw conflict(`Project ${projectId} storage lineage changed.`);
      }
      if (targetIndex < 0) throw validation(`Project ${projectId} does not exist.`);

      const remainingOrder = workspace.projectOrder.filter(id => id !== projectId);
      let nextOrder: string[];
      let activeProjectId: string;
      requests.push(projectStore.delete(projectId));
      if (remainingOrder.length === 0) {
        if (!successor) {
          throw validation('Closing the last project requires a successor.');
        }
        const successorProject = successor.project;
        const successorIncarnation = requireProjectIncarnation(successor.incarnation);
        if (successorProject.id === projectId || await projectStore.get(successorProject.id)) {
          throw validation(`Successor project ${successorProject.id} is not unique.`);
        }
        requests.push(projectStore.add({
          id: successorProject.id,
          project: successorProject,
          incarnation: successorIncarnation,
          storageRevision: 0,
          updatedAt,
        }));
        nextOrder = [successorProject.id];
        activeProjectId = successorProject.id;
      } else {
        nextOrder = remainingOrder;
        activeProjectId = remainingOrder[Math.max(0, targetIndex - 1)];
      }

      const nextWorkspace: StoredWorkspace = {
        ...workspace,
        projectOrder: nextOrder,
        activeProjectId,
        revision: workspace.revision + 1,
      };
      requests.push(workspaceTransaction.objectStore('workspace').put(nextWorkspace));
      environment.fault?.('mutation.before-complete');
      await Promise.all(requests);
      await workspaceTransaction.done;
      return nextWorkspace;
    } catch (error) {
      return abortTransaction(transaction, requests, error);
    }
  };

  const saveCustomPreset = async (
    preset: WorkspaceCustomPreset,
  ): Promise<void> => {
    const activeDatabase = await getDatabase();
    const storeNames = ['presets', 'migrationLedger'] as const;
    let transaction: WriteTransaction | undefined;
    const requests: Promise<unknown>[] = [];
    try {
      const presetTransaction = activeDatabase.transaction(storeNames, 'readwrite');
      transaction = presetTransaction as WriteTransaction;
      const ledger = await presetTransaction.objectStore('migrationLedger')
        .get(WORKSPACE_MIGRATION_ID);
      requireVerifiedAuthority(ledger);
      const presetStore = presetTransaction.objectStore('presets');
      const [stored, allPresets] = await Promise.all([
        presetStore.get(preset.id),
        presetStore.getAll(),
      ]);
      const position = stored?.position
        ?? Math.max(-1, ...allPresets.map(record => record.position)) + 1;
      requests.push(presetStore.put({ id: preset.id, preset, position }));
      environment.fault?.('mutation.before-complete');
      await Promise.all(requests);
      await presetTransaction.done;
    } catch (error) {
      return abortTransaction(transaction, requests, error);
    }
  };

  const deleteCustomPreset = async (presetId: string): Promise<void> => {
    const activeDatabase = await getDatabase();
    const storeNames = ['presets', 'migrationLedger'] as const;
    let transaction: WriteTransaction | undefined;
    const requests: Promise<unknown>[] = [];
    try {
      const presetTransaction = activeDatabase.transaction(storeNames, 'readwrite');
      transaction = presetTransaction as WriteTransaction;
      const ledger = await presetTransaction.objectStore('migrationLedger')
        .get(WORKSPACE_MIGRATION_ID);
      requireVerifiedAuthority(ledger);
      const presetStore = presetTransaction.objectStore('presets');
      const allPresets = await presetStore.getAll();
      const target = allPresets.find(record => record.id === presetId);
      if (!target) throw validation(`Custom preset ${presetId} does not exist.`);
      requests.push(presetStore.delete(presetId));
      for (const record of allPresets) {
        if (record.position <= target.position) continue;
        requests.push(presetStore.put({ ...record, position: record.position - 1 }));
      }
      environment.fault?.('mutation.before-complete');
      await Promise.all(requests);
      await presetTransaction.done;
    } catch (error) {
      return abortTransaction(transaction, requests, error);
    }
  };

  const stageImport = async (
    pendingImport: WorkspacePendingImport,
    pendingImportDigest: string,
    attemptProvenance?: WorkspaceImportAttemptProvenance,
  ): Promise<void> => {
    if (!isDigest(pendingImportDigest)) {
      throw validation('Pending import digest must be a lowercase SHA-256 digest.');
    }
    const storedAttempt = storedAttemptProvenance(attemptProvenance, pendingImportDigest);
    const activeDatabase = await getDatabase();
    const storeNames = ['pendingImports', 'projects', 'migrationLedger'] as const;
    let transaction: WriteTransaction | undefined;
    const requests: Promise<unknown>[] = [];
    try {
      const importTransaction = activeDatabase.transaction(storeNames, 'readwrite');
      transaction = importTransaction as WriteTransaction;
      const ledger = await importTransaction.objectStore('migrationLedger')
        .get(WORKSPACE_MIGRATION_ID);
      requireVerifiedAuthority(ledger);
      const importStore = importTransaction.objectStore('pendingImports');
      const projectStore = importTransaction.objectStore('projects');
      const [pendingImports, projects] = await Promise.all([
        importStore.getAll(),
        projectStore.getAll(),
      ]);
      const storedPending = pendingImports.find(record => record.id === pendingImport.id);
      const consumedProjects = projects.filter(record =>
        record.consumedImportId === pendingImport.id);
      if (storedPending && consumedProjects.length > 0) {
        throw conflict(`Import ${pendingImport.id} provenance is ambiguous.`);
      }
      if (storedPending) {
        if (canonicalStringify(storedPending.pendingImport)
          !== canonicalStringify(pendingImport)
          || !sameAttemptProvenance(storedPending.attemptProvenance, storedAttempt)) {
          throw conflict(`Pending import ${pendingImport.id} changed.`);
        }
        await importTransaction.done;
        return;
      }
      if (consumedProjects.length > 0) {
        if (consumedProjects.length > 1) {
          throw conflict(`Consumed import ${pendingImport.id} provenance is ambiguous.`);
        }
        const consumed = consumedProjects[0];
        if (consumed.id !== pendingImport.targetProjectId
          || consumed.consumedImportCreatedAt !== pendingImport.createdAt
          || consumed.consumedImportDigest !== pendingImportDigest
          || !sameAttemptProvenance(consumed.consumedImportAttempt, storedAttempt)) {
          throw conflict(`Consumed import ${pendingImport.id} changed.`);
        }
        await importTransaction.done;
        return;
      }
      if (pendingImports.some(record =>
        record.pendingImport.targetProjectId === pendingImport.targetProjectId)) {
        throw conflict(`Pending import target ${pendingImport.targetProjectId} already exists.`);
      }
      if (projects.some(record => record.id === pendingImport.targetProjectId)) {
        throw conflict(`Project ${pendingImport.targetProjectId} already exists.`);
      }
      const position = Math.max(-1, ...pendingImports.map(record => record.position)) + 1;
      requests.push(importStore.add({
        id: pendingImport.id,
        pendingImport,
        position,
        ...(storedAttempt ? { attemptProvenance: storedAttempt } : {}),
      }));
      environment.fault?.('mutation.before-complete');
      await Promise.all(requests);
      await importTransaction.done;
    } catch (error) {
      return abortTransaction(transaction, requests, error);
    }
  };

  const replaceStagedImport = async (
    prepared: PreparedImportReplacement,
  ): Promise<void> => {
    const { expected, replacement, replacementDigest, replacementAttempt } = prepared;
    if (!isDigest(replacementDigest)) {
      throw validation('Replacement import digest must be a lowercase SHA-256 digest.');
    }
    validateAttemptProvenance(expected);
    const nextAttempt = storedAttemptProvenance(replacementAttempt, replacementDigest)!;
    const activeDatabase = await getDatabase();
    const subtle = environment.crypto?.subtle;
    if (!subtle) throw validation('Import replacement digest authority is unavailable.');
    const preflightTransaction = activeDatabase.transaction('pendingImports', 'readonly');
    const preflightRecords = await preflightTransaction.store.getAll();
    await preflightTransaction.done;
    const preflight = new Map<string, { identity: string; digest: string }>();
    for (const record of preflightRecords) {
      try {
        const identity = canonicalStringify(record.pendingImport);
        preflight.set(record.id, {
          identity,
          digest: await sha256Hex(identity, subtle),
        });
      } catch {
        // Malformed records cannot satisfy replacement CAS.
      }
    }
    const storeNames = ['pendingImports', 'projects', 'migrationLedger'] as const;
    let transaction: WriteTransaction | undefined;
    const requests: Promise<unknown>[] = [];
    try {
      const importTransaction = activeDatabase.transaction(storeNames, 'readwrite');
      transaction = importTransaction as WriteTransaction;
      const ledger = await importTransaction.objectStore('migrationLedger')
        .get(WORKSPACE_MIGRATION_ID);
      requireVerifiedAuthority(ledger);
      const importStore = importTransaction.objectStore('pendingImports');
      const projectStore = importTransaction.objectStore('projects');
      const [pendingImports, projects] = await Promise.all([
        importStore.getAll(),
        projectStore.getAll(),
      ]);
      const oldPending = pendingImports.find(record => record.id === expected.importId);
      const replacementPending = pendingImports.find(record => record.id === replacement.id);
      const oldConsumed = projects.filter(record => record.consumedImportId === expected.importId);
      const replacementConsumed = projects.filter(record =>
        record.consumedImportId === replacement.id);
      if ((oldPending && oldConsumed.length > 0)
        || oldConsumed.length > 1
        || (replacementPending && replacementConsumed.length > 0)
        || replacementConsumed.length > 1) {
        throw conflict('Import replacement provenance is ambiguous.');
      }

      const pendingDigestIsVerified = (record: StoredPendingImport): boolean => {
        const observed = preflight.get(record.id);
        if (!observed || !record.attemptProvenance) return false;
        try {
          return observed.identity === canonicalStringify(record.pendingImport)
            && observed.digest === record.attemptProvenance.pendingImportDigest;
        } catch {
          return false;
        }
      };

      if (replacementPending || replacementConsumed.length === 1) {
        if (oldPending || oldConsumed.length > 0) {
          throw conflict('Old and replacement import provenance coexist.');
        }
        if (replacementPending) {
          if (canonicalStringify(replacementPending.pendingImport)
              !== canonicalStringify(replacement)
            || !sameAttemptProvenance(replacementPending.attemptProvenance, nextAttempt)) {
            throw conflict(`Replacement import ${replacement.id} changed.`);
          }
        } else {
          const consumed = replacementConsumed[0];
          if (consumed.id !== replacement.targetProjectId
            || consumed.consumedImportCreatedAt !== replacement.createdAt
            || consumed.consumedImportDigest !== replacementDigest
            || !sameAttemptProvenance(consumed.consumedImportAttempt, nextAttempt)) {
            throw conflict(`Consumed replacement import ${replacement.id} changed.`);
          }
        }
        await importTransaction.done;
        return;
      }

      if (oldConsumed.length > 0) {
        throw conflict(`Import ${expected.importId} was consumed before replacement.`);
      }

      let position: number;
      if (oldPending) {
        if (oldPending.pendingImport.targetProjectId !== expected.targetProjectId
          || oldPending.pendingImport.createdAt !== expected.createdAt
          || oldPending.attemptProvenance?.sourceKeyDigest !== expected.sourceKeyDigest
          || oldPending.attemptProvenance?.payloadDigest !== expected.payloadDigest
          || !pendingDigestIsVerified(oldPending)) {
          throw conflict(`Pending import ${expected.importId} changed before replacement.`);
        }
        position = oldPending.position;
      } else {
        if (pendingImports.some(record =>
          record.pendingImport.targetProjectId === expected.targetProjectId)
          || projects.some(record => record.id === expected.targetProjectId)) {
          throw conflict(`Old import target ${expected.targetProjectId} was reused.`);
        }
        position = Math.max(-1, ...pendingImports.map(record => record.position)) + 1;
      }

      if (pendingImports.some(record => record.id === replacement.id
        || (record.id !== oldPending?.id
          && record.pendingImport.targetProjectId === replacement.targetProjectId))
        || projects.some(record => record.id === replacement.targetProjectId)) {
        throw conflict(`Replacement import ${replacement.id} collides with stored data.`);
      }
      if (oldPending) requests.push(importStore.delete(oldPending.id));
      requests.push(importStore.add({
        id: replacement.id,
        pendingImport: replacement,
        position,
        attemptProvenance: nextAttempt,
      }));
      environment.fault?.('mutation.before-complete');
      await Promise.all(requests);
      await importTransaction.done;
    } catch (error) {
      return abortTransaction(transaction, requests, error);
    }
  };

  const consumeImport = async (
    importId: string,
    expectedWorkspaceRevision: number,
    prepared?: PreparedImportConsumption,
    knownTargetProjectId?: string,
  ): Promise<{ targetProjectId: string; consumed: boolean }> => {
    const activeDatabase = await getDatabase();
    const storeNames = [
      'pendingImports',
      'projects',
      'workspace',
      'migrationLedger',
    ] as const;
    let transaction: WriteTransaction | undefined;
    const requests: Promise<unknown>[] = [];
    try {
      const importTransaction = activeDatabase.transaction(storeNames, 'readwrite');
      transaction = importTransaction as WriteTransaction;
      const ledger = await importTransaction.objectStore('migrationLedger')
        .get(WORKSPACE_MIGRATION_ID);
      requireVerifiedAuthority(ledger);
      const workspace = requireWorkspaceRevision(
        await importTransaction.objectStore('workspace').get('current'),
        expectedWorkspaceRevision,
      );
      const importStore = importTransaction.objectStore('pendingImports');
      const projectStore = importTransaction.objectStore('projects');
      const [storedImport, pendingImports] = await Promise.all([
        importStore.get(importId),
        importStore.getAll(),
      ]);
      if (!storedImport) {
        const consumedTargets = (await projectStore.getAll()).filter(record =>
          record.consumedImportId === importId);
        if (consumedTargets.length === 0) {
          throw validation(`Pending import ${importId} does not exist.`);
        }
        if (consumedTargets.length > 1) {
          throw validation(`Consumed import ${importId} provenance is ambiguous.`);
        }
        const consumedTarget = consumedTargets[0];
        if ((knownTargetProjectId && knownTargetProjectId !== consumedTarget.id)
          || !workspace.projectOrder.includes(consumedTarget.id)) {
          throw conflict(`Consumed import ${importId} target changed.`);
        }
        await importTransaction.done;
        return { targetProjectId: consumedTarget.id, consumed: false };
      }

      const pending = storedImport.pendingImport;
      let storedPendingIdentity: string | undefined;
      try {
        storedPendingIdentity = JSON.stringify(pending);
      } catch {
        // Invalid changed records cannot match the independently prepared identity.
      }
      if (!prepared
        || storedPendingIdentity !== prepared.pendingImportIdentity
        || prepared.project.id !== pending.targetProjectId
        || prepared.project.project.id !== pending.targetProjectId
        || prepared.project.consumedImportId !== importId
        || (knownTargetProjectId && knownTargetProjectId !== pending.targetProjectId)) {
        throw conflict(`Pending import ${importId} target changed.`);
      }
      if (await projectStore.get(pending.targetProjectId)) {
        throw validation(`Project ${pending.targetProjectId} already exists.`);
      }
      if ((storedImport.attemptProvenance !== undefined
          && storedImport.attemptProvenance.pendingImportDigest
            !== prepared.project.consumedImportDigest)
        || (prepared.project.consumedImportAttempt !== undefined
        && !sameAttemptProvenance(
          prepared.project.consumedImportAttempt,
          storedImport.attemptProvenance,
        ))) {
        throw conflict(`Pending import ${importId} attempt provenance changed.`);
      }
      requests.push(projectStore.add({
        ...prepared.project,
        ...(storedImport.attemptProvenance
          ? { consumedImportAttempt: storedImport.attemptProvenance }
          : {}),
      }));
      requests.push(importStore.delete(importId));
      for (const record of pendingImports) {
        if (record.position <= storedImport.position) continue;
        requests.push(importStore.put({ ...record, position: record.position - 1 }));
      }
      requests.push(importTransaction.objectStore('workspace').put({
        ...workspace,
        projectOrder: [...workspace.projectOrder, prepared.project.id],
        activeProjectId: prepared.project.id,
        revision: workspace.revision + 1,
      }));
      environment.fault?.('mutation.before-complete');
      await Promise.all(requests);
      await importTransaction.done;
      return { targetProjectId: prepared.project.id, consumed: true };
    } catch (error) {
      return abortTransaction(transaction, requests, error);
    }
  };

  // The explicitly requested v3 adapter supplies prerequisites only. It cannot edit
  // the historical representation, including before a normalization reservation.
  const historicalEditorOnly = <A extends unknown[], R>(operation: (...args: A) => Promise<R>) =>
    (...args: A): Promise<R> => requestedVersion === NORMALIZED_DB_VERSION
      ? Promise.reject(unverifiedAuthority()) : operation(...args);

  return {
    open,
    close() {
      openGeneration += 1;
      opening = undefined;
      openingGeneration = undefined;
      database?.close();
      database = undefined;
    },
    describeSchema,
    inspect,
    writeInitialCopy,
    replaceCopiedInitialCopy: historicalEditorOnly(replaceCopiedInitialCopy),
    repairHistoricalLineage,
    readWorkspaceRecords,
    readLegacyBackup,
    readMigrationLedger,
    markVerified,
    markLegacyDrift,
    recoverLegacyAsCopies: historicalEditorOnly(recoverLegacyAsCopies),
    saveProject: historicalEditorOnly(saveProject),
    saveWorkspace: historicalEditorOnly(saveWorkspace),
    createAndActivateProject: historicalEditorOnly(createAndActivateProject),
    activateProject: historicalEditorOnly(activateProject),
    closeProject: historicalEditorOnly(closeProject),
    saveCustomPreset: historicalEditorOnly(saveCustomPreset),
    deleteCustomPreset: historicalEditorOnly(deleteCustomPreset),
    stageImport: historicalEditorOnly(stageImport),
    replaceStagedImport: historicalEditorOnly(replaceStagedImport),
    consumeImport: historicalEditorOnly(consumeImport),
  };
};
