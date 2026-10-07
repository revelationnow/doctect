import type { AppState } from '../../types';
import { canonicalStringify, digestLegacySnapshot, sha256Hex } from './canonical';
import {
  WorkspaceStoreError,
  type LocalWorkspaceStore,
  type RecoverySource,
  type WorkspaceBootstrapObserver,
  type WorkspaceBootstrapPhase,
  type WorkspaceBootstrapResult,
  type SnapshotWorkspaceCommand as WorkspaceCommand,
  type WorkspaceImportAttemptProvenance,
  type WorkspacePendingImport,
  type WorkspaceProject,
  type WorkspaceSnapshot,
  type WorkspaceStagedImportExpectation,
} from './contracts';
import type { FaultInjector } from './faults';
import { createWorkspaceCommandDispatcher } from './commandDispatcher';
import {
  createHistoricalBootstrap, isRecognizedLedger, isHistoricalLineageLedger,
  recovery, unavailable, storedRecovery, receiptFor, sameObservedLegacy, sameLegacySnapshot,
  type SupportedMigrationLedger,
} from './historicalBootstrap';
import {
  createIndexedDbAdapter,
  type IndexedDbAdapter,
  type PreparedImportConsumption,
} from './indexedDbAdapter';
import {
  LegacyCaptureError,
  captureStableLegacySnapshot,
  captureStableLegacySnapshotWithDigest,
  monitorLegacyKeys,
} from './legacy';
import {
  reconstructWorkspace,
  reconstructWorkspaceRecords,
  type WorkspaceRecordCandidates,
  type WorkspaceRecords,
} from './migration';
import {
  createMutationQueue,
  type ExclusiveAdmission,
  type MutationQueue,
} from './mutationQueue';
import {
  cloneWorkspaceSnapshotWithProjectAuthority,
  getInstalledProjectAuthorityLineage,
  getInstalledProjectAuthorityToken,
  registerInstalledProjectAuthority,
} from './projectAuthority';
import { prepareProjectInModuleWorker } from './projectPreparationClient';
import {
  createIndexedDbRecoveryBundle,
  createLegacyRecoveryBundle,
  createProtectedIndexedDbRecoveryBundle,
  prepareLegacyRecovery,
  validateLegacyRecoveryPreparationSources,
} from './recovery';
import {
  WORKSPACE_DB_VERSION,
  type LegacyBackupRecord,
  type MigrationLedger,
  type ProjectLineage,
  type StoredProject,
  sameProjectLineage,
  storedProjectLineage,
} from './schema';
import {
  preparePendingImport,
  validateCustomPreset,
  validateWorkspaceProject,
} from './validation';

export interface LocalWorkspaceEnvironment {
  indexedDB: IDBFactory;
  legacyStorage: Pick<Storage, 'getItem'>;
  addStorageListener(listener: (event: StorageEvent) => void): () => void;
  crypto: Crypto;
  now(): string;
  randomUUID(): string;
  createBlankProject(): AppState;
  fault?: FaultInjector;
}

type ProjectPreparation = (project: WorkspaceProject) => Promise<WorkspaceProject>;

type AuthorityState =
  | 'cold'
  | 'bootstrapping'
  | 'ready'
  | 'frozen'
  | 'recovery'
  | 'unavailable';

type NonReadyResult = Extract<
  WorkspaceBootstrapResult,
  { status: 'recovery' | 'unavailable' }
>;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

const hasExactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean => {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every(key => keys.includes(key));
};

const isDigest = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

const isCanonicalTimestamp = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
};

const ready = (
  snapshot: WorkspaceSnapshot,
  ledger: MigrationLedger,
): Extract<WorkspaceBootstrapResult, { status: 'ready' }> => {
  const receipt = receiptFor(ledger);
  return {
    status: 'ready',
    snapshot,
    ...(receipt ? { receipt } : {}),
  };
};

const createLocalWorkspaceStoreAtVersion = (
  environment: LocalWorkspaceEnvironment,
  requestedIndexedDbVersion: number,
  prepareProjectForSave: ProjectPreparation,
): LocalWorkspaceStore => {
  let authority: AuthorityState = 'cold';
  let inFlight: Promise<WorkspaceBootstrapResult> | undefined;
  let authorityValidation: Promise<WorkspaceBootstrapResult> | undefined;
  let cachedReady: Extract<WorkspaceBootstrapResult, { status: 'ready' }> | undefined;
  let lifecycleResult: NonReadyResult | undefined;
  let lifecycleGeneration = 0;
  let stopLegacyMonitor: (() => void) | undefined;
  let observedLegacyChange = 0;
  const observers = new Set<WorkspaceBootstrapObserver>();
  let durableSnapshot: WorkspaceSnapshot | undefined;
  let expectedWorkspaceRevision: number | undefined;
  let expectedProjectLineages = new Map<string, ProjectLineage>();
  // Installed lineages identify readback authority even while save lineages
  // keep expected values pinned.
  let installedProjectLineages = new Map<string, ProjectLineage>();
  let consumedImportTargets = new Map<string, string>();
  let mutationQueue: MutationQueue | undefined;
  let startReadyLegacyRevalidation: (() => void) | undefined;
  let resetCommandQueue: (() => void) | undefined;
  let protectedIndexedDbRecoveryBundle: Blob | undefined;

  const registerObserver = (observer?: WorkspaceBootstrapObserver): void => {
    if (!observer || observer.signal?.aborted || observers.has(observer)) return;
    observers.add(observer);
    if (!observer.signal) return;
    try {
      observer.signal.addEventListener('abort', () => {
        observers.delete(observer);
      }, { once: true });
    } catch {
      observers.delete(observer);
    }
  };

  const notifyAuthorityLost = (result: NonReadyResult): void => {
    for (const observer of observers) {
      if (observer.signal?.aborted) {
        observers.delete(observer);
        continue;
      }
      try {
        observer.onAuthorityLost?.(result);
      } catch {
        // Observer failures cannot change storage authority.
      }
    }
  };

  const invalidateDurableAuthority = (): void => {
    cachedReady = undefined;
    durableSnapshot = undefined;
    expectedWorkspaceRevision = undefined;
    expectedProjectLineages = new Map();
    installedProjectLineages = new Map();
    consumedImportTargets = new Map();
  };

  const handleAuthorityLost = (error: WorkspaceStoreError): void => {
    mutationQueue?.freeze();
    invalidateDurableAuthority();
    authority = error.code === 'authority-lost' ? 'frozen' : 'unavailable';
    lifecycleGeneration += 1;
    lifecycleResult = unavailable(protectedIndexedDbRecoveryBundle
      ? ['indexeddb-workspace']
      : []);
    notifyAuthorityLost(lifecycleResult);
  };

  let adapter: IndexedDbAdapter | undefined;
  const getAdapter = (): IndexedDbAdapter => {
    adapter ??= createIndexedDbAdapter({
      indexedDB: environment.indexedDB,
      now: environment.now,
      crypto: environment.crypto,
      fault: environment.fault,
      onAuthorityLost: handleAuthorityLost,
    }, requestedIndexedDbVersion);
    return adapter;
  };

  const ensureLegacyMonitor = (): void => {
    if (stopLegacyMonitor) return;
    stopLegacyMonitor = monitorLegacyKeys(environment.addStorageListener, () => {
      observedLegacyChange += 1;
      if (authority === 'ready') startReadyLegacyRevalidation?.();
    });
  };

  const historical = createHistoricalBootstrap({
    get crypto() { return environment.crypto; },
    get legacyStorage() { return environment.legacyStorage; },
    now: () => environment.now(),
    randomUUID: () => environment.randomUUID(),
    createBlankProject: () => environment.createBlankProject(),
    adapter: getAdapter,
    generation: () => observedLegacyChange,
    protectSnapshot(snapshot) {
      protectedIndexedDbRecoveryBundle = createProtectedIndexedDbRecoveryBundle(snapshot, environment.now());
    },
  });
  const { captureObservedLegacy, validateBackup, readVerificationInputs,
    readRecognizedLedger, recordLegacyDrift } = historical;

  const installDurableState = (
    records: WorkspaceRecords,
    snapshot: WorkspaceSnapshot,
    options: {
      updateCachedReady?: boolean;
      preservePinnedProjectLineages?: boolean;
      preserveProjectAuthority?: { projectId: string; lineage: ProjectLineage };
    } = {},
  ): WorkspaceSnapshot => {
    let nextSnapshot = structuredClone(snapshot);
    const nextInstalledProjectLineages = new Map(
      records.projects.map(record => [record.id, storedProjectLineage(record)]),
    );
    const nextProjectLineages = new Map(nextInstalledProjectLineages);
    const previousProjects = new Map(
      durableSnapshot?.projects.map(project => [project.id, project]) ?? [],
    );
    const recordsById = new Map(records.projects.map(record => [record.id, record]));
    nextSnapshot = {
      ...nextSnapshot,
      projects: nextSnapshot.projects.map(project => {
        const record = recordsById.get(project.id);
        const previous = previousProjects.get(project.id);
        const lineage = record && storedProjectLineage(record);
        const previousLineage = installedProjectLineages.get(project.id);
        if (lineage && previous && previousLineage
          && sameProjectLineage(previousLineage, lineage)) {
          return previous;
        }
        const preserveAuthority = Boolean(lineage && previous
          && options.preserveProjectAuthority?.projectId === project.id
          && sameProjectLineage(options.preserveProjectAuthority.lineage, lineage));
        if (lineage) {
          registerInstalledProjectAuthority(
            project,
            lineage,
            preserveAuthority
              ? getInstalledProjectAuthorityToken(previous)
              : undefined,
          );
        }
        return project;
      }),
    };
    if (options.preservePinnedProjectLineages) {
      for (const [projectId, lineage] of expectedProjectLineages) {
        if (mutationQueue?.hasPinnedProjectLineage(projectId)) {
          nextProjectLineages.set(projectId, lineage);
        }
      }
    }
    const nextConsumedImportTargets = new Map<string, string>();
    for (const record of records.projects) {
      if (record.consumedImportId) {
        nextConsumedImportTargets.set(record.consumedImportId, record.id);
      }
    }
    const nextWorkspaceRevision = records.workspace.revision;
    const nextCachedReady = options.updateCachedReady && cachedReady
      ? {
          ...cachedReady,
          snapshot: cloneWorkspaceSnapshotWithProjectAuthority(nextSnapshot),
        }
      : undefined;
    durableSnapshot = nextSnapshot;
    installedProjectLineages = nextInstalledProjectLineages;
    expectedProjectLineages = nextProjectLineages;
    expectedWorkspaceRevision = nextWorkspaceRevision;
    consumedImportTargets = nextConsumedImportTargets;
    if (nextCachedReady) cachedReady = nextCachedReady;
    return nextSnapshot;
  };

  const terminateValidatedReadback = (
    error: WorkspaceStoreError,
    recoveryBundle?: Blob,
  ): void => {
    protectedIndexedDbRecoveryBundle = recoveryBundle;
    if (authority === 'ready' || authority === 'recovery') {
      handleAuthorityLost(error);
    } else {
      mutationQueue?.freeze();
      invalidateDurableAuthority();
    }
  };

  const finalizeValidatedReadback = (
    records: WorkspaceRecords,
    snapshot: WorkspaceSnapshot,
    options: Parameters<typeof installDurableState>[2],
  ): WorkspaceSnapshot => {
    let recoveryBundle: Blob;
    try {
      recoveryBundle = createProtectedIndexedDbRecoveryBundle(snapshot, environment.now());
    } catch (error) {
      const authorityError = new WorkspaceStoreError(
        'Validated durable state could not be protected before installation.',
        'authority-lost',
        error,
      );
      terminateValidatedReadback(authorityError);
      throw authorityError;
    }

    try {
      return installDurableState(records, snapshot, options);
    } catch (error) {
      const authorityError = new WorkspaceStoreError(
        'Validated durable state could not be installed.',
        'authority-lost',
        error,
      );
      terminateValidatedReadback(authorityError, recoveryBundle);
      throw authorityError;
    }
  };

  const validatedRecoverySources = async (
    knownLedger?: SupportedMigrationLedger,
  ): Promise<RecoverySource[]> => {
    const sources: RecoverySource[] = [];
    try {
      await captureObservedLegacy();
      sources.push('legacy-current');
    } catch {
      // A changing or inaccessible source is not currently callable.
    }

    let ledger = knownLedger;
    if (!ledger) {
      try {
        const candidate = await getAdapter().readMigrationLedger();
        if (isRecognizedLedger(candidate) || isHistoricalLineageLedger(candidate)) {
          ledger = candidate;
        }
      } catch {
        // Durable exports remain unavailable when their ledger cannot be read.
      }
    }
    if (ledger) {
      try {
        const backup = await getAdapter().readLegacyBackup(ledger.originalLegacyBackupId);
        await validateBackup(backup, {
          id: ledger.originalLegacyBackupId,
          digest: ledger.sourceDigest,
          kind: 'original',
          capturedAt: ledger.migratedAt,
        });
        sources.push('legacy-original');
      } catch {
        // Invalid or missing backup must not be advertised.
      }
    }
    if (protectedIndexedDbRecoveryBundle) {
      sources.push('indexeddb-workspace');
    } else {
      try {
        reconstructWorkspace(await getAdapter().readWorkspaceRecords());
        sources.push('indexeddb-workspace');
      } catch {
        // Invalid or missing target must not be advertised.
      }
    }
    return sources;
  };

  const populateCapabilities = async (
    result: NonReadyResult,
    knownLedger?: SupportedMigrationLedger,
  ): Promise<NonReadyResult> => {
    const exports = await validatedRecoverySources(knownLedger);
    if (result.status !== 'recovery') return { ...result, availableExports: exports };

    let currentLedger = knownLedger && isRecognizedLedger(knownLedger)
      ? knownLedger
      : undefined;
    if (!currentLedger) {
      try {
        currentLedger = await readRecognizedLedger();
      } catch {
        // Recovery command stays unavailable without a validated ledger.
      }
    }
    let canRecoverLegacyAsCopies = false;
    const marker = currentLedger?.unresolvedRecovery;
    if (result.recovery.kind === 'split-brain'
      && currentLedger?.state === 'verified'
      && marker?.kind === 'legacy-drift'
      && marker.id === result.recovery.recoveryId
      && marker.observedLegacyDigest !== undefined
      && exports.includes('legacy-current')
      && exports.includes('indexeddb-workspace')) {
      try {
        const acceptedBackup = await validateBackup(
          await getAdapter().readLegacyBackup(currentLedger.acceptedLegacyBackupId),
          {
            id: currentLedger.acceptedLegacyBackupId,
            digest: currentLedger.acceptedLegacyDigest,
          },
        );
        const current = await captureObservedLegacy();
        if (current.digest === marker.observedLegacyDigest) {
          await validateLegacyRecoveryPreparationSources(
            current.snapshot,
            acceptedBackup.snapshot,
            {
              crypto: environment.crypto,
              now: environment.now,
              randomUUID: environment.randomUUID,
            },
          );
          canRecoverLegacyAsCopies = true;
        }
      } catch {
        // Accepted baseline is required to prepare changed-only copies.
      }
    }
    return {
      ...result,
      recovery: {
        ...result.recovery,
        availableExports: exports,
        canRecoverLegacyAsCopies,
      },
    };
  };

  const populateStableNonReadyResult = async (
    result: NonReadyResult,
  ): Promise<NonReadyResult> => {
    if (result.status !== 'recovery'
      || result.recovery.kind !== 'split-brain'
      || result.recovery.category !== 'legacy-drift') {
      return populateCapabilities(result);
    }

    let resolution = await recordLegacyDrift(
      await captureObservedLegacy(),
      await readRecognizedLedger(),
    );
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (!resolution.marker) return populateCapabilities(result, resolution.ledger);
      const populated = await populateCapabilities(
        storedRecovery(resolution.marker),
        resolution.ledger,
      );
      const finalCapture = await captureObservedLegacy();
      if (sameObservedLegacy(finalCapture, resolution.capture)) return populated;
      resolution = await recordLegacyDrift(finalCapture, resolution.ledger);
    }
    throw new LegacyCaptureError(
      'Legacy storage changed repeatedly while recovery capabilities were prepared.',
    );
  };

  startReadyLegacyRevalidation = () => {
    if (authority !== 'ready' || authorityValidation) return;
    const queue = mutationQueue;
    queue?.freeze();
    authority = 'frozen';
    lifecycleGeneration += 1;
    const validationGeneration = lifecycleGeneration;
    const supersedingLifecycleResult = (): NonReadyResult | undefined =>
      lifecycleGeneration !== validationGeneration ? lifecycleResult : undefined;

    let operation!: Promise<WorkspaceBootstrapResult>;
    operation = Promise.resolve().then(() => queue?.drain()).then(async () => {
      const captured = await captureObservedLegacy();
      const supersedingAfterCapture = supersedingLifecycleResult();
      if (supersedingAfterCapture) return supersedingAfterCapture;
      let resolution = await recordLegacyDrift(captured);
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const supersedingAfterRecord = supersedingLifecycleResult();
        if (supersedingAfterRecord) return supersedingAfterRecord;
        const after = await captureObservedLegacy();
        const supersedingAfterRecapture = supersedingLifecycleResult();
        if (supersedingAfterRecapture) return supersedingAfterRecapture;
        if (!sameObservedLegacy(after, resolution.capture)) {
          resolution = await recordLegacyDrift(after, resolution.ledger);
          continue;
        }

        if (!resolution.marker) {
          authority = 'ready';
          lifecycleResult = undefined;
          resetCommandQueue?.();
          if (!cachedReady || !durableSnapshot) {
            throw new WorkspaceStoreError('Ready workspace snapshot is unavailable.', 'unavailable');
          }
          return cachedReady;
        }

        const result = await populateCapabilities(
          storedRecovery(resolution.marker),
          resolution.ledger,
        );
        const supersedingAfterCapabilities = supersedingLifecycleResult();
        if (supersedingAfterCapabilities) return supersedingAfterCapabilities;
        const finalCapture = await captureObservedLegacy();
        const supersedingAfterFinalCapture = supersedingLifecycleResult();
        if (supersedingAfterFinalCapture) return supersedingAfterFinalCapture;
        if (!sameObservedLegacy(finalCapture, resolution.capture)) {
          resolution = await recordLegacyDrift(finalCapture, resolution.ledger);
          continue;
        }
        invalidateDurableAuthority();
        authority = 'recovery';
        lifecycleResult = result;
        notifyAuthorityLost(result);
        return result;
      }
      throw new LegacyCaptureError('Legacy storage changed repeatedly during drift detection.');
    }).catch(async error => {
      const superseding = supersedingLifecycleResult();
      if (superseding) return superseding;
      const result = error instanceof LegacyCaptureError
        ? await populateCapabilities(recovery('legacy-changing'))
        : await populateCapabilities(unavailable());
      invalidateDurableAuthority();
      authority = result.status === 'recovery' ? 'recovery' : 'unavailable';
      lifecycleResult = result;
      notifyAuthorityLost(result);
      return result;
    }).finally(() => {
      if (authorityValidation === operation) authorityValidation = undefined;
    });
    authorityValidation = operation;
  };

  const bootstrapOperation = async (
    emit: (phase: WorkspaceBootstrapPhase) => void,
  ): Promise<WorkspaceBootstrapResult> => {
    ensureLegacyMonitor();
    const result = await historical.bootstrap(emit);
    if (result.status !== 'admitted') return result;
    try {
      const installed = installDurableState(result.records, result.snapshot);
      return ready(cloneWorkspaceSnapshotWithProjectAuthority(installed), result.ledger);
    } finally { result.release?.(); }
  };

  const validationError = (error: unknown): WorkspaceStoreError =>
    error instanceof WorkspaceStoreError
      ? error
      : new WorkspaceStoreError('Workspace command is invalid.', 'validation', error);

  const requireCommandId = (value: unknown, label: string): string => {
    if (typeof value !== 'string' || value.length === 0) {
      throw new WorkspaceStoreError(`${label} must be a non-empty string.`, 'validation');
    }
    return value;
  };

  const prepareImportAttemptProvenance = (
    value: unknown,
    label: string,
  ): WorkspaceImportAttemptProvenance => {
    if (!isPlainObject(value)
      || !hasExactKeys(value, ['sourceKeyDigest', 'payloadDigest'])
      || !isDigest(value.sourceKeyDigest)
      || !isDigest(value.payloadDigest)) {
      throw new WorkspaceStoreError(
        `${label} must contain exact lowercase SHA-256 digests.`,
        'validation',
      );
    }
    return {
      sourceKeyDigest: value.sourceKeyDigest,
      payloadDigest: value.payloadDigest,
    };
  };

  const prepareStagedImportExpectation = (
    value: unknown,
  ): WorkspaceStagedImportExpectation => {
    if (!isPlainObject(value)
      || !hasExactKeys(value, [
        'importId',
        'targetProjectId',
        'createdAt',
        'sourceKeyDigest',
        'payloadDigest',
      ])) {
      throw new WorkspaceStoreError('Import replacement expectation is malformed.', 'validation');
    }
    const createdAt = value.createdAt;
    if (!isCanonicalTimestamp(createdAt)) {
      throw new WorkspaceStoreError(
        'Expected import timestamp must be canonical.',
        'validation',
      );
    }
    return {
      importId: requireCommandId(value.importId, 'Expected import id'),
      targetProjectId: requireCommandId(value.targetProjectId, 'Expected import target id'),
      createdAt,
      ...prepareImportAttemptProvenance({
        sourceKeyDigest: value.sourceKeyDigest,
        payloadDigest: value.payloadDigest,
      }, 'Expected import provenance'),
    };
  };

  const createProjectIncarnation = (): string => {
    const incarnation = environment.randomUUID();
    if (typeof incarnation !== 'string' || incarnation.length === 0) {
      throw new WorkspaceStoreError('Project incarnation must be non-empty.', 'validation');
    }
    return incarnation;
  };

  type NonSaveWorkspaceCommand = Exclude<WorkspaceCommand, { type: 'save-project' }>;

  const prepareCommand = (command: NonSaveWorkspaceCommand): NonSaveWorkspaceCommand => {
    try {
      switch (command.type) {
        case 'create-and-activate-project':
          return {
            ...command,
            project: validateWorkspaceProject(command.project, { warningPolicy: 'reject' }),
          };
        case 'activate-project':
          return { ...command, projectId: requireCommandId(command.projectId, 'Project id') };
        case 'close-project':
          return {
            ...command,
            projectId: requireCommandId(command.projectId, 'Project id'),
            ...(command.successor
              ? {
                  successor: validateWorkspaceProject(command.successor, {
                    warningPolicy: 'reject',
                  }),
                }
              : {}),
          };
        case 'save-custom-preset': {
          const existingIds = new Set(
            (durableSnapshot?.customPresets ?? [])
              .map(preset => preset.id)
              .filter(id => id !== command.preset.id),
          );
          return {
            ...command,
            preset: validateCustomPreset(command.preset, {
              warningPolicy: 'reject',
              existingIds,
            }),
          };
        }
        case 'delete-custom-preset':
          return { ...command, presetId: requireCommandId(command.presetId, 'Preset id') };
        case 'stage-import':
          return {
            ...command,
            pendingImport: preparePendingImport(command.pendingImport, {
              warningPolicy: 'retain',
            }),
            ...(command.attemptProvenance
              ? {
                  attemptProvenance: prepareImportAttemptProvenance(
                    command.attemptProvenance,
                    'Import attempt provenance',
                  ),
                }
              : {}),
          };
        case 'replace-staged-import': {
          const expected = prepareStagedImportExpectation(command.expected);
          const pendingImport = preparePendingImport(command.replacement.pendingImport, {
            warningPolicy: 'retain',
          });
          const attemptProvenance = prepareImportAttemptProvenance(
            command.replacement.attemptProvenance,
            'Replacement import provenance',
          );
          if (expected.sourceKeyDigest !== attemptProvenance.sourceKeyDigest
            || expected.payloadDigest === attemptProvenance.payloadDigest
            || expected.importId === pendingImport.id
            || expected.targetProjectId === pendingImport.targetProjectId) {
            throw new WorkspaceStoreError(
              'Import replacement must identify one changed source attempt.',
              'validation',
            );
          }
          return {
            type: 'replace-staged-import',
            expected,
            replacement: { pendingImport, attemptProvenance },
          };
        }
        case 'consume-import':
          return { ...command, importId: requireCommandId(command.importId, 'Import id') };
        case 'recover-legacy-as-copies':
          return {
            ...command,
            recoveryId: requireCommandId(command.recoveryId, 'Recovery id'),
          };
      }
    } catch (error) {
      throw validationError(error);
    }
  };

  const readPostCommandSnapshot = async (
    preserveProjectAuthority?: { projectId: string; lineage: ProjectLineage },
  ): Promise<WorkspaceSnapshot> => {
    let candidates: WorkspaceRecordCandidates;
    let records: WorkspaceRecords;
    let snapshot: WorkspaceSnapshot;
    try {
      candidates = await getAdapter().readWorkspaceRecords();
      ({ records, snapshot } = reconstructWorkspaceRecords(candidates));
    } catch (error) {
      const cause = error instanceof WorkspaceStoreError
        ? error
        : new WorkspaceStoreError(
            'Durable workspace failed post-command validation.',
            'io',
            error,
          );
      const failure = new WorkspaceStoreError(
        'Durable workspace authority could not be revalidated after commit.',
        'authority-lost',
        cause,
      );
      terminateValidatedReadback(failure);
      throw failure;
    }
    return finalizeValidatedReadback(records, snapshot, {
      updateCachedReady: true,
      preservePinnedProjectLineages: true,
      preserveProjectAuthority,
    });
  };

  const runCommandOperation = async (
    operation: () => Promise<WorkspaceSnapshot>,
  ): Promise<WorkspaceSnapshot> => {
    try {
      return await operation();
    } catch (error) {
      const mapped = error instanceof WorkspaceStoreError
        ? error
        : new WorkspaceStoreError('Workspace command failed.', 'io', error);
      if (mapped.code === 'authority-lost' && authority === 'ready') {
        handleAuthorityLost(mapped);
      }
      throw mapped;
    }
  };

  const currentWorkspaceRevision = (): number => {
    if (expectedWorkspaceRevision === undefined) {
      throw new WorkspaceStoreError(
        'Verified workspace revision is unavailable.',
        'authority-lost',
      );
    }
    return expectedWorkspaceRevision;
  };

  const prepareAdmittedProjectSave = async (
    project: WorkspaceProject,
  ): Promise<WorkspaceProject> => {
    try {
      const prepared = await prepareProjectForSave(project);
      if (prepared === null
        || typeof prepared !== 'object'
        || prepared.id !== project.id) {
        throw new WorkspaceStoreError(
          'Prepared project identity does not match its admitted save.',
          'validation',
        );
      }
      return prepared;
    } catch (error) {
      throw error instanceof WorkspaceStoreError
        ? error
        : new WorkspaceStoreError('Workspace project preparation failed.', 'validation', error);
    }
  };

  const executeProjectSave = (
    project: WorkspaceProject,
    expectedLineage: ProjectLineage,
  ): Promise<WorkspaceSnapshot> =>
    runCommandOperation(async () => {
      const currentLineage = expectedProjectLineages.get(project.id);
      if (currentLineage === undefined) {
        throw new WorkspaceStoreError(`Project ${project.id} does not exist.`, 'validation');
      }
      if (!sameProjectLineage(currentLineage, expectedLineage)) {
        throw new WorkspaceStoreError(
          `Project ${project.id} local revision lineage changed.`,
          'conflict',
        );
      }
      const saved = await getAdapter().saveProject(project, expectedLineage);
      const savedLineage = storedProjectLineage(saved);
      expectedProjectLineages.set(project.id, savedLineage);
      return readPostCommandSnapshot({
        projectId: project.id,
        lineage: savedLineage,
      });
    });

  const prepareImportConsumption = async (
    importId: string,
  ): Promise<PreparedImportConsumption | undefined> => {
    const pendingImport = durableSnapshot?.pendingImports.find(item => item.id === importId);
    if (!pendingImport) return undefined;
    const project = validateWorkspaceProject({
      id: pendingImport.targetProjectId,
      name: pendingImport.name,
      initialState: pendingImport.state,
      ...(pendingImport.cloud ? { cloud: pendingImport.cloud } : {}),
    }, { warningPolicy: 'reject' });
    const updatedAt = environment.now();
    if (!isCanonicalTimestamp(updatedAt)) {
      throw new WorkspaceStoreError(
        'Consumed project timestamp must be a canonical ISO timestamp.',
        'validation',
      );
    }
    const storedProject: StoredProject = {
      id: project.id,
      project,
      incarnation: createProjectIncarnation(),
      storageRevision: 0,
      updatedAt,
      consumedImportId: importId,
      consumedImportCreatedAt: pendingImport.createdAt,
      consumedImportDigest: await sha256Hex(
        canonicalStringify(pendingImport),
        environment.crypto.subtle,
      ),
    };
    return {
      pendingImportIdentity: JSON.stringify(pendingImport),
      project: storedProject,
    };
  };

  const executeExclusiveCommand = (
    admission: ExclusiveAdmission,
  ): Promise<WorkspaceSnapshot> => runCommandOperation(async () => {
    if (admission.kind === 'close') {
      const { command, targetLineage } = admission;
      const currentLineage = expectedProjectLineages.get(command.projectId);
      if (currentLineage === undefined) {
        throw new WorkspaceStoreError(
          `Project ${command.projectId} does not exist.`,
          'validation',
        );
      }
      if (!sameProjectLineage(currentLineage, targetLineage)) {
        throw new WorkspaceStoreError(
          `Project ${command.projectId} close lineage changed.`,
          'conflict',
        );
      }
      await getAdapter().closeProject(
        command.projectId,
        command.successor
          ? {
              project: command.successor,
              incarnation: createProjectIncarnation(),
            }
          : undefined,
        currentWorkspaceRevision(),
        targetLineage,
      );
      expectedProjectLineages.delete(command.projectId);
      return readPostCommandSnapshot();
    }

    const { command } = admission;
    switch (command.type) {
      case 'create-and-activate-project':
        await getAdapter().createAndActivateProject(
          {
            project: command.project,
            incarnation: createProjectIncarnation(),
          },
          currentWorkspaceRevision(),
        );
        break;
      case 'activate-project':
        await getAdapter().activateProject(command.projectId, currentWorkspaceRevision());
        break;
      case 'save-custom-preset':
        await getAdapter().saveCustomPreset(command.preset);
        break;
      case 'delete-custom-preset':
        await getAdapter().deleteCustomPreset(command.presetId);
        break;
      case 'stage-import':
        await getAdapter().stageImport(
          command.pendingImport as WorkspacePendingImport,
          await sha256Hex(
            canonicalStringify(command.pendingImport),
            environment.crypto.subtle,
          ),
          command.attemptProvenance,
        );
        break;
      case 'replace-staged-import': {
        const replacement = command.replacement.pendingImport as WorkspacePendingImport;
        await getAdapter().replaceStagedImport({
          expected: command.expected,
          replacement,
          replacementDigest: await sha256Hex(
            canonicalStringify(replacement),
            environment.crypto.subtle,
          ),
          replacementAttempt: command.replacement.attemptProvenance,
        });
        break;
      }
      case 'consume-import': {
        const knownTargetProjectId = consumedImportTargets.get(command.importId);
        await getAdapter().consumeImport(
          command.importId,
          currentWorkspaceRevision(),
          await prepareImportConsumption(command.importId),
          knownTargetProjectId,
        );
        break;
      }
      case 'recover-legacy-as-copies':
        throw new WorkspaceStoreError(
          'Legacy copy recovery is not available in this storage rollout step.',
          'unavailable',
        );
    }

    const snapshot = await readPostCommandSnapshot();
    return snapshot;
  });

  const executeRecoveryCommand = async (recoveryId: string): Promise<WorkspaceSnapshot> => {
    const recoveryLifecycleGeneration = lifecycleGeneration;
    const recoveryLifecycleIsCurrent = (): boolean =>
      lifecycleGeneration === recoveryLifecycleGeneration && authority === 'recovery';
    const assertRecoveryLifecycle = (): void => {
      if (!recoveryLifecycleIsCurrent()) {
        throw new WorkspaceStoreError(
          'Local workspace lifecycle changed during legacy recovery.',
          'authority-lost',
        );
      }
    };
    let prepared: Awaited<ReturnType<typeof prepareLegacyRecovery>>;
    try {
      prepared = await captureStableLegacySnapshot(
        environment.legacyStorage,
        async source => {
          const sourceDigest = await digestLegacySnapshot(source, environment.crypto.subtle);
          assertRecoveryLifecycle();
          const ledger = await readRecognizedLedger();
          assertRecoveryLifecycle();
          const marker = ledger.unresolvedRecovery;
          if (ledger.state !== 'verified'
            || marker?.kind !== 'legacy-drift'
            || marker.id !== recoveryId
            || marker.observedLegacyDigest !== sourceDigest) {
            throw new WorkspaceStoreError(
              'Legacy recovery confirmation no longer matches current authority.',
              'conflict',
            );
          }

          let candidates: WorkspaceRecordCandidates;
          let records: WorkspaceRecords;
          let acceptedBackup: LegacyBackupRecord | undefined;
          try {
            [candidates, acceptedBackup] = await Promise.all([
              getAdapter().readWorkspaceRecords(),
              getAdapter().readLegacyBackup(ledger.acceptedLegacyBackupId),
            ]);
            assertRecoveryLifecycle();
            ({ records } = reconstructWorkspaceRecords(candidates));
            acceptedBackup = await validateBackup(acceptedBackup, {
              id: ledger.acceptedLegacyBackupId,
              digest: ledger.acceptedLegacyDigest,
            });
            assertRecoveryLifecycle();
          } catch (error) {
            if (error instanceof WorkspaceStoreError) throw error;
            throw new WorkspaceStoreError(
              'Recovery authorities could not be validated independently.',
              'unavailable',
              error,
            );
          }

          try {
            const recovery = await prepareLegacyRecovery(
              source,
              sourceDigest,
              acceptedBackup.snapshot,
              ledger,
              records,
              recoveryId,
              {
                crypto: environment.crypto,
                now: environment.now,
                randomUUID: environment.randomUUID,
              },
            );
            assertRecoveryLifecycle();
            return recovery;
          } catch (error) {
            if (error instanceof WorkspaceStoreError) throw error;
            throw new WorkspaceStoreError(
              'Changed legacy workspace is invalid and cannot be recovered as copies.',
              'validation',
              error,
            );
          }
        },
        environment.crypto.subtle,
        {
          generation: () => observedLegacyChange,
          assertCurrent: assertRecoveryLifecycle,
        },
      );
      assertRecoveryLifecycle();
    } catch (error) {
      if (error instanceof WorkspaceStoreError) throw error;
      if (error instanceof LegacyCaptureError) {
        throw new WorkspaceStoreError(
          'Legacy workspace changed during recovery preparation.',
          'conflict',
          error,
        );
      }
      throw new WorkspaceStoreError('Legacy recovery preparation failed.', 'validation', error);
    }

    const nextLedger = await getAdapter().recoverLegacyAsCopies(prepared);
    assertRecoveryLifecycle();
    let candidates: WorkspaceRecordCandidates;
    let records: WorkspaceRecords;
    let snapshot: WorkspaceSnapshot;
    try {
      candidates = await getAdapter().readWorkspaceRecords();
      assertRecoveryLifecycle();
      ({ records, snapshot } = reconstructWorkspaceRecords(candidates));
    } catch (error) {
      if (!recoveryLifecycleIsCurrent()) throw error;
      const cause = error instanceof WorkspaceStoreError
        ? error
        : new WorkspaceStoreError(
            'Recovered workspace failed independent validation.',
            'io',
            error,
          );
      const failure = new WorkspaceStoreError(
        'Recovered workspace authority could not be revalidated after commit.',
        'authority-lost',
        cause,
      );
      terminateValidatedReadback(failure);
      throw failure;
    }

    let protectedRecoveryBundle: Blob;
    try {
      protectedRecoveryBundle = createProtectedIndexedDbRecoveryBundle(
        snapshot,
        environment.now(),
      );
    } catch (error) {
      const failure = new WorkspaceStoreError(
        'Recovered durable state could not be protected.',
        'authority-lost',
        error,
      );
      terminateValidatedReadback(failure);
      throw failure;
    }
    const failRecoveryFinalization = (message: string, cause: unknown): never => {
      const failure = new WorkspaceStoreError(message, 'authority-lost', cause);
      terminateValidatedReadback(failure, protectedRecoveryBundle);
      throw failure;
    };
    const cloneRecoveredSnapshot = (): WorkspaceSnapshot => {
      try {
        return structuredClone(snapshot);
      } catch (error) {
        return failRecoveryFinalization(
          'Recovered durable state could not be published.',
          error,
        );
      }
    };

    try {
      let current = await captureObservedLegacy(assertRecoveryLifecycle);
      let currentLedger = nextLedger;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        assertRecoveryLifecycle();
        if (currentLedger.unresolvedRecovery === null
          && current.digest === currentLedger.acceptedLegacyDigest
          && sameLegacySnapshot(current.snapshot, prepared.backup.snapshot)) {
          const persistedLedger = await readRecognizedLedger();
          assertRecoveryLifecycle();
          if (persistedLedger.unresolvedRecovery !== null) {
            const result = await populateCapabilities(
              storedRecovery(persistedLedger.unresolvedRecovery),
              persistedLedger,
            );
            assertRecoveryLifecycle();
            const publication = cloneRecoveredSnapshot();
            invalidateDurableAuthority();
            authority = 'recovery';
            lifecycleResult = result;
            notifyAuthorityLost(result);
            return publication;
          }
          if (canonicalStringify(persistedLedger) !== canonicalStringify(nextLedger)) {
            throw new WorkspaceStoreError(
              'Resolved legacy recovery ledger changed before authority was restored.',
              'conflict',
            );
          }
          let installed: WorkspaceSnapshot;
          try {
            installed = installDurableState(records, snapshot);
          } catch (error) {
            return failRecoveryFinalization(
              'Recovered durable state could not be installed.',
              error,
            );
          }
          let readyResult: Extract<WorkspaceBootstrapResult, { status: 'ready' }>;
          let publication: WorkspaceSnapshot;
          try {
            readyResult = ready(
              cloneWorkspaceSnapshotWithProjectAuthority(installed),
              persistedLedger,
            );
            publication = cloneWorkspaceSnapshotWithProjectAuthority(installed);
          } catch (error) {
            return failRecoveryFinalization(
              'Recovered durable state could not be published.',
              error,
            );
          }
          assertRecoveryLifecycle();
          authority = 'ready';
          cachedReady = readyResult;
          lifecycleResult = undefined;
          resetCommandQueue?.();
          return publication;
        }

        const recorded = await recordLegacyDrift(current, currentLedger);
        assertRecoveryLifecycle();
        currentLedger = recorded.ledger;
        if (!recorded.marker) {
          current = await captureObservedLegacy(assertRecoveryLifecycle);
          continue;
        }
        const result = await populateCapabilities(
          storedRecovery(recorded.marker),
          recorded.ledger,
        );
        assertRecoveryLifecycle();
        const finalCapture = await captureObservedLegacy(assertRecoveryLifecycle);
        if (!sameObservedLegacy(finalCapture, recorded.capture)) {
          current = finalCapture;
          continue;
        }
        assertRecoveryLifecycle();
        const publication = cloneRecoveredSnapshot();
        invalidateDurableAuthority();
        authority = 'recovery';
        lifecycleResult = result;
        notifyAuthorityLost(result);
        return publication;
      }
      throw new LegacyCaptureError(
        'Legacy storage changed repeatedly after recovery.',
      );
    } catch (error) {
      if (!recoveryLifecycleIsCurrent()) throw error;
      if (error instanceof LegacyCaptureError) {
        const result = await populateCapabilities(recovery('legacy-changing'));
        assertRecoveryLifecycle();
        const publication = cloneRecoveredSnapshot();
        invalidateDurableAuthority();
        authority = 'recovery';
        lifecycleResult = result;
        notifyAuthorityLost(result);
        return publication;
      }
      const failure = error instanceof WorkspaceStoreError
        ? error
        : new WorkspaceStoreError(
            'Legacy workspace could not be revalidated after recovery.',
            'unavailable',
            error,
          );
      handleAuthorityLost(failure);
      throw failure;
    }
  };

  const createCommandQueue = (): MutationQueue => createMutationQueue({
    prepareProject: prepareAdmittedProjectSave,
    saveProject: executeProjectSave,
    runExclusive: executeExclusiveCommand,
    onFailedProjectLineageUnpinned(projectId) {
      const installedLineage = installedProjectLineages.get(projectId);
      if (installedLineage) {
        expectedProjectLineages.set(projectId, { ...installedLineage });
      }
    },
    onPostCommitPublicationFailure(snapshot, error) {
      let recoveryBundle: Blob | undefined;
      try {
        recoveryBundle = createProtectedIndexedDbRecoveryBundle(
          snapshot,
          environment.now(),
        );
      } catch {
        // Authority still becomes terminal when recovery bytes cannot be protected.
      }
      terminateValidatedReadback(error, recoveryBundle);
    },
  });
  resetCommandQueue = () => {
    mutationQueue = createCommandQueue();
  };

  return {
    bootstrap(observer) {
      registerObserver(observer);
      if (authorityValidation) return authorityValidation;
      if (cachedReady) return Promise.resolve(cachedReady);
      if (inFlight) return inFlight;

      const priorQueue = mutationQueue;
      priorQueue?.freeze();
      authority = 'bootstrapping';
      const emitted = new Set<WorkspaceBootstrapPhase>();
      const emit = (phase: WorkspaceBootstrapPhase): void => {
        if (emitted.has(phase)) return;
        emitted.add(phase);
        for (const registered of observers) {
          if (registered.signal?.aborted) continue;
          try {
            registered.onPhase?.(phase);
          } catch {
            // Observer failures cannot interrupt bootstrap.
          }
        }
      };

      const startingLifecycleGeneration = lifecycleGeneration;
      let operation!: Promise<WorkspaceBootstrapResult>;
      operation = Promise.resolve()
        .then(() => priorQueue?.drain())
        .then(() => bootstrapOperation(emit))
        .then(async (result): Promise<WorkspaceBootstrapResult> =>
          result.status === 'ready' ? result : populateStableNonReadyResult(result))
        .then(result => {
          const effectiveResult = lifecycleGeneration !== startingLifecycleGeneration
            && lifecycleResult
            ? lifecycleResult
            : result;
          if (effectiveResult.status === 'ready') {
            authority = 'ready';
            cachedReady = effectiveResult;
            lifecycleResult = undefined;
            protectedIndexedDbRecoveryBundle = undefined;
            resetCommandQueue?.();
          } else {
            mutationQueue?.freeze();
            cachedReady = undefined;
            authority = effectiveResult.status === 'recovery' ? 'recovery' : 'unavailable';
          }
          return effectiveResult;
        }, error => {
          if (lifecycleGeneration !== startingLifecycleGeneration && lifecycleResult) {
            mutationQueue?.freeze();
            cachedReady = undefined;
            authority = lifecycleResult.status === 'recovery' ? 'recovery' : 'unavailable';
            return lifecycleResult;
          }
          mutationQueue?.freeze();
          cachedReady = undefined;
          authority = lifecycleResult?.status === 'unavailable' ? 'unavailable' : 'cold';
          throw error;
        }).finally(() => {
        if (inFlight === operation) inFlight = undefined;
      });
      inFlight = operation;
      return operation;
    },

    commit: createWorkspaceCommandDispatcher({ snapshot(command: WorkspaceCommand): Promise<WorkspaceSnapshot> {
      if (command.type === 'recover-legacy-as-copies') {
        let recoveryId: string;
        try {
          recoveryId = requireCommandId(command.recoveryId, 'Recovery id');
        } catch (error) {
          return Promise.reject(validationError(error));
        }
        if (authority === 'ready') {
          return Promise.reject(new WorkspaceStoreError(
            'No unresolved legacy recovery is available.',
            'unavailable',
          ));
        }
        if (authority !== 'recovery') {
          return Promise.reject(new WorkspaceStoreError(
            'Local workspace authority is not ready for recovery.',
            'authority-lost',
          ));
        }
        return executeRecoveryCommand(recoveryId);
      }
      const queue = mutationQueue;
      if (authority !== 'ready' || !queue) {
        return Promise.reject(new WorkspaceStoreError(
          'Local workspace authority is not ready.',
          'authority-lost',
        ));
      }
      if (command.type === 'save-project') {
        const project = command.project;
        let projectId: string;
        let authorityLineage: ProjectLineage;
        try {
          if (project === null || typeof project !== 'object') {
            throw new WorkspaceStoreError(
              'Workspace project must be an object.',
              'validation',
            );
          }
          projectId = requireCommandId(project.id, 'Project id');
          if (!expectedProjectLineages.has(projectId)) {
            throw new WorkspaceStoreError(`Project ${projectId} does not exist.`, 'validation');
          }
          const installedLineage = getInstalledProjectAuthorityLineage(project);
          if (installedLineage === undefined) {
            throw new WorkspaceStoreError(
              `Project ${projectId} save authority is unavailable.`,
              'conflict',
            );
          }
          authorityLineage = installedLineage;
        } catch (error) {
          return Promise.reject(validationError(error));
        }
        try {
          return queue.enqueueProjectSave(project, authorityLineage);
        } catch (error) {
          return Promise.reject(error instanceof WorkspaceStoreError
            ? error
            : new WorkspaceStoreError(
                `Project ${projectId} could not be cloned for save admission.`,
                'clone',
                error,
              ));
        }
      }
      let prepared: NonSaveWorkspaceCommand;
      try {
        prepared = prepareCommand(command);
      } catch (error) {
        return Promise.reject(validationError(error));
      }
      if (prepared.type === 'close-project') {
        const targetLineage = expectedProjectLineages.get(prepared.projectId);
        if (targetLineage === undefined) {
          return Promise.reject(new WorkspaceStoreError(
            `Project ${prepared.projectId} does not exist.`,
            'validation',
          ));
        }
        return queue.runExclusive({
          kind: 'close',
          command: prepared,
          targetLineage: { ...targetLineage },
        });
      }
      return queue.runExclusive({ kind: 'command', command: prepared });
    } }),

    async exportRecoveryBundle(source: RecoverySource): Promise<Blob> {
      if (source === 'legacy-current') {
        try {
          const captured = await captureStableLegacySnapshotWithDigest(
            environment.legacyStorage,
            environment.crypto.subtle,
          );
          return createLegacyRecoveryBundle(
            captured.snapshot,
            environment.now(),
            environment.crypto.subtle,
          );
        } catch (error) {
          if (error instanceof LegacyCaptureError) throw error;
          throw new WorkspaceStoreError(
            'Current legacy recovery source is unavailable.',
            'unavailable',
            error,
          );
        }
      }

      if (source === 'legacy-original') {
        try {
          const candidate: unknown = await getAdapter().readMigrationLedger();
          if (!isRecognizedLedger(candidate) && !isHistoricalLineageLedger(candidate)) {
            throw new WorkspaceStoreError('Migration ledger is unavailable.', 'unavailable');
          }
          const ledger = candidate;
          const backup = await validateBackup(
            await getAdapter().readLegacyBackup(ledger.originalLegacyBackupId),
            {
              id: ledger.originalLegacyBackupId,
              digest: ledger.sourceDigest,
              kind: 'original',
              capturedAt: ledger.migratedAt,
            },
          );
          return createLegacyRecoveryBundle(
            backup.snapshot,
            backup.capturedAt,
            environment.crypto.subtle,
          );
        } catch (error) {
          throw new WorkspaceStoreError(
            'Original legacy recovery source is unavailable.',
            'unavailable',
            error,
          );
        }
      }

      if (source === 'indexeddb-workspace') {
        if (protectedIndexedDbRecoveryBundle) {
          return protectedIndexedDbRecoveryBundle.slice(
            0,
            protectedIndexedDbRecoveryBundle.size,
            protectedIndexedDbRecoveryBundle.type,
          );
        }
        try {
          const snapshot = reconstructWorkspace(await getAdapter().readWorkspaceRecords());
          return createIndexedDbRecoveryBundle(snapshot, environment.now());
        } catch (error) {
          throw new WorkspaceStoreError(
            'IndexedDB workspace recovery source is unavailable.',
            'unavailable',
            error,
          );
        }
      }

      return Promise.reject(new WorkspaceStoreError(
        'Recovery source is unavailable.',
        'unavailable',
      ));
    },
  };
};

export const createLocalWorkspaceStore = (
  environment: LocalWorkspaceEnvironment,
): LocalWorkspaceStore => createLocalWorkspaceStoreAtVersion(
  environment,
  WORKSPACE_DB_VERSION,
  prepareProjectInModuleWorker,
);

const prepareProjectForTesting: ProjectPreparation = async project =>
  validateWorkspaceProject(project, { warningPolicy: 'reject' });

// Tests import this module directly; public barrel stays production module-Worker-only.
export const createLocalWorkspaceStoreForTesting = (
  environment: LocalWorkspaceEnvironment,
  requestedIndexedDbVersion = WORKSPACE_DB_VERSION,
  prepareProject: ProjectPreparation = prepareProjectForTesting,
): LocalWorkspaceStore => createLocalWorkspaceStoreAtVersion(
  environment,
  requestedIndexedDbVersion,
  prepareProject,
);
