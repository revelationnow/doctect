import type { AppState } from '../../types';
import { effect, primitive, runSync, type Ownership, type Work, type WorkRuntime } from '../../shared/cooperativeWork.js';
import { canonicalWork, compareStringsWork, copyEnumerableWork, plainJsonBytesWork, stableSortWork } from '../../shared/jsonWork.js';
import { createBlankProject } from '../presets';
import {
  canonicalStringify,
  digestFrame,
  digestLegacySnapshot,
  digestWorkspaceContent,
  sha256Hex,
} from './canonical';
import type {
  MigrationReceipt,
  WorkspaceCustomPreset,
  WorkspacePendingImport,
  WorkspaceProject,
  WorkspaceSnapshot,
} from './contracts';
import {
  LEGACY_DOCUMENT_KEYS,
  LEGACY_KEYS,
  type LegacyDocumentKey,
  type LegacySnapshot,
} from './legacyTypes';
import {
  PERSISTENCE_ROLLOUT_EPOCH,
  HISTORICAL_WORKSPACE_FORMAT_VERSION,
  WORKSPACE_MIGRATION_ID,
  type LegacyBackupRecord,
  type MigrationLedger,
  type StoredImportAttemptProvenance,
  type StoredPendingImport,
  type StoredPreset,
  type StoredProject,
  type StoredWorkspace,
} from './schema';
import {
  preparePendingImport,
  validateCustomPreset,
  validateMigratedState,
  validateWorkspaceProject,
  checkMigratedStateWork,
  checkWorkspaceProjectWork,
  checkStoredWorkspaceProjectWork,
  checkCustomPresetWork,
  checkPendingImportWork,
  validateWorkspaceProjectWork,
  validateCustomPresetWork,
  preparePendingImportWork,
  isUpgradableStoredSchemaVersion,
} from './validation';

const REJECT_WARNINGS = { warningPolicy: 'reject' as const };

/**
 * A stored project record as the current release reads it. A project that an earlier release stored
 * at an older document schema is upgraded exactly as a legacy import upgrades a project (migrated,
 * then fully validated, into a new object) and returned in a copy of the record; any other record is
 * returned as it is, for the usual validation. Deterministic: every reader of a record derives the
 * same result. Descriptors only, so a record's accessors are never invoked.
 */
export function* upgradeStoredProjectRecordWork(record: unknown): Work<unknown> {
  const project = yield* effect(4, () => {
    if (!isPlainObject(record)) return undefined;
    const entry = Object.getOwnPropertyDescriptor(record, 'project');
    if (!entry || !('value' in entry) || !isPlainObject(entry.value)) return undefined;
    const state = Object.getOwnPropertyDescriptor(entry.value, 'initialState');
    if (!state || !('value' in state) || !isPlainObject(state.value)) return undefined;
    const version = Object.getOwnPropertyDescriptor(state.value, 'schemaVersion');
    return version && 'value' in version && isUpgradableStoredSchemaVersion(version.value) ? entry.value : undefined;
  });
  if (project === undefined) return record;
  const upgraded = yield* validateWorkspaceProjectWork(project, REJECT_WARNINGS);
  const copy = yield* copyEnumerableWork(record as Record<string, unknown>);
  yield* effect(1, () => { copy.project = upgraded; });
  return copy;
}

export function upgradeStoredProjectRecord(record: unknown): unknown {
  return runSync(upgradeStoredProjectRecordWork(record));
}

const LEGACY_PENDING_KEYS = new Set(['name', 'state', 'cloud']);
const STORED_PENDING_KEYS = new Set([
  'id',
  'targetProjectId',
  'name',
  'state',
  'cloud',
  'createdAt',
  'warnings',
]);

export interface MigrationPreparationEnvironment {
  crypto: Pick<Crypto, 'subtle'>;
  now(): string;
  randomUUID(): string;
  createBlankProject(): AppState;
  work?: WorkRuntime;
}

export interface PreparedInitialCopy {
  origin: 'legacy' | 'native';
  source: LegacySnapshot;
  sourceDigest: string;
  targetDigest: string;
  projects: StoredProject[];
  workspace: StoredWorkspace;
  presets: StoredPreset[];
  pendingImports: StoredPendingImport[];
  backup: LegacyBackupRecord;
  ledger: MigrationLedger;
  receipt?: MigrationReceipt;
}

export interface WorkspaceRecordCandidates {
  projects: unknown;
  workspace: unknown;
  presets: unknown;
  pendingImports: unknown;
}

export interface WorkspaceRecords extends WorkspaceRecordCandidates {
  projects: StoredProject[];
  workspace: StoredWorkspace;
  presets: StoredPreset[];
  pendingImports: StoredPendingImport[];
}

export interface ReconstructedWorkspaceRecords {
  records: WorkspaceRecords;
  snapshot: WorkspaceSnapshot;
}

type MigrationErrorCategory = 'legacy-invalid' | 'target-invalid' | 'verification-failed';

export class WorkspaceMigrationError extends Error {
  constructor(
    message: string,
    public readonly category: MigrationErrorCategory,
    public readonly affectedKey?: LegacyDocumentKey,
    public readonly affectedItem?: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'WorkspaceMigrationError';
  }
}

const defaultEnvironment = (): MigrationPreparationEnvironment => ({
  crypto: globalThis.crypto,
  now: () => new Date().toISOString(),
  randomUUID: () => globalThis.crypto.randomUUID(),
  createBlankProject,
});

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

const sourceError = (
  key: LegacyDocumentKey,
  message: string,
  cause?: unknown,
  affectedItem?: string,
): WorkspaceMigrationError => new WorkspaceMigrationError(
  message,
  'legacy-invalid',
  key,
  affectedItem,
  cause,
);

const targetError = (message: string, cause?: unknown): WorkspaceMigrationError =>
  new WorkspaceMigrationError(message, 'target-invalid', undefined, undefined, cause);

const verificationError = (message: string): WorkspaceMigrationError =>
  new WorkspaceMigrationError(message, 'verification-failed');

const readEntry = (source: LegacySnapshot, key: LegacyDocumentKey) => {
  const entry = source?.[key] as unknown;
  if (!isPlainObject(entry) || typeof entry.present !== 'boolean') {
    throw sourceError(key, `Legacy key ${key} has malformed presence metadata.`);
  }
  if (entry.present) {
    if (typeof entry.raw !== 'string') {
      throw sourceError(key, `Present legacy key ${key} must contain raw text.`);
    }
  } else if (entry.raw !== null) {
    throw sourceError(key, `Absent legacy key ${key} must contain null raw text.`);
  }
  return entry as LegacySnapshot[LegacyDocumentKey];
};

function* parseJsonEntry(
  source: LegacySnapshot,
  key: Exclude<LegacyDocumentKey, typeof LEGACY_KEYS.activeProject>,
): Work<unknown | undefined> {
  const entry = readEntry(source, key);
  if (!entry.present) return undefined;
  try {
    return yield* primitive('parse', () => JSON.parse(entry.raw as string));
  } catch (error) {
    throw sourceError(key, `Legacy key ${key} does not contain valid JSON.`, error);
  }
}

function validateTimestamp(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string') throw targetError(`${label} must be an ISO timestamp.`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    throw targetError(`${label} must be a canonical ISO timestamp.`);
  }
}

function requireNonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw targetError(`${label} must be a non-negative integer.`);
  }
}

function* requireExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): Work<void> {
  for (const key of required) {
    yield* effect(1, () => {});
    if (!Object.hasOwn(value, key)) throw targetError(`${label} is missing ${key}.`);
  }
  const allowed = new Set([...required, ...optional]);
  const keys = yield* primitive('keys', () => Object.keys(value));
  for (const key of keys) {
    yield* effect(1, () => {});
    if (key && !allowed.has(key)) throw targetError(`${label} contains unknown field ${key}.`);
    // Preserve the historical find()/truthiness rule for an empty unknown key.
    if (!allowed.has(key)) break;
  }
}

function* validateStoredImportAttempt(
  value: unknown,
  label: string,
): Work<StoredImportAttemptProvenance> {
  if (!isPlainObject(value)) throw targetError(`${label} must be an object.`);
  yield* requireExactKeys(
    value,
    ['sourceKeyDigest', 'payloadDigest', 'pendingImportDigest'],
    [],
    label,
  );
  for (const key of ['sourceKeyDigest', 'payloadDigest', 'pendingImportDigest'] as const) {
    if (typeof value[key] !== 'string' || !/^[a-f0-9]{64}$/.test(value[key])) {
      throw targetError(`${label} ${key} must be a lowercase SHA-256 digest.`);
    }
  }
  return (yield* primitive('clone', () => structuredClone(value))) as unknown as StoredImportAttemptProvenance;
}

const fingerprintItems = async (
  items: unknown[],
  migrated: readonly { id: string }[],
  subtle: SubtleCrypto,
  work?: WorkRuntime,
) => {
  const fingerprints: MigrationLedger['projectFingerprints'] = [];
  for (const [sourceIndex, item] of items.entries()) {
    work?.assertCurrent();
    const digest = work
      ? await digestFrame(emit => canonicalWork(item, emit), work, 'source')
      : await sha256Hex(canonicalStringify(item), subtle);
    work?.assertCurrent();
    const append = () => { fingerprints.push({ sourceIndex, id: migrated[sourceIndex].id, digest }); };
    if (work) await work.run(effect(1, append));
    else append();
  }
  return fingerprints;
};

function* importTargetId(sourceDigest: string, existingIds: ReadonlySet<string>): Work<string> {
  const base = `proj_migrated_import_${sourceDigest.slice(0, 16)}`;
  yield* effect(1, () => {});
  if (!existingIds.has(base)) return base;
  for (let suffix = 1; ; suffix += 1) {
    yield* effect(1, () => {});
    const candidate = `${base}_${suffix}`;
    if (!existingIds.has(candidate)) return candidate;
  }
}

function* mapPreparationRows<T, U>(rows: readonly T[], project: (row: T, index: number) => U): Work<U[]> {
  const result: U[] = [];
  for (const [index, row] of rows.entries()) result.push(yield* effect(1, () => project(row, index)));
  return result;
}

function* validateLegacyPending(value: unknown): Work<Record<string, unknown> | undefined> {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    throw sourceError(LEGACY_KEYS.pendingImport, 'Legacy pending import must be one object.');
  }
  const keys = yield* primitive('keys', () => Object.keys(value));
  for (const key of keys) {
    yield* effect(1, () => {});
    if (!LEGACY_PENDING_KEYS.has(key)) {
      if (key) throw sourceError(LEGACY_KEYS.pendingImport, `Legacy pending import contains unknown field ${key}.`);
      break; // Preserve historical find()/truthiness behavior for the empty key.
    }
  }
  return value;
}

export async function prepareInitialCopy(
  source: LegacySnapshot,
  environment: MigrationPreparationEnvironment = defaultEnvironment(),
): Promise<PreparedInitialCopy> {
  const work = environment.work;
  work?.assertCurrent();
  // Invocation capture must finish before the first await, even when the
  // caller exhausted its quantum. This is the existing indivisible native
  // clone of the fixed legacy-key envelope, not a stepped payload traversal.
  work?.note('visits', 1);
  work?.note('primitiveExceptions', 1);
  let sourceCopy: LegacySnapshot;
  try { sourceCopy = structuredClone(source); }
  finally { work?.assertCurrent(); }
  const payloadOwnership = work?.own(0);
  try {
    const prepared = await prepareCapturedInitialCopy(sourceCopy, environment, payloadOwnership);
    work?.assertCurrent();
    return prepared;
  } catch (error) {
    if (work?.stopped()) work.assertCurrent();
    throw error;
  } finally {
    payloadOwnership?.release();
  }
}

async function prepareCapturedInitialCopy(
  sourceCopy: LegacySnapshot,
  environment: MigrationPreparationEnvironment,
  payloadOwnership?: Ownership,
): Promise<PreparedInitialCopy> {
  const work = environment.work;
  const run = <T>(program: Work<T>): Promise<T> => work ? work.run(program) : Promise.resolve(runSync(program));
  // Parsed JSON images and loaded payloads coexist through fingerprinting.
  // These are logical serialized bytes, not a native-clone heap estimate;
  // returned records become the caller's responsibility after completion.
  async function retainPayload(value: unknown): Promise<void> {
    if (!payloadOwnership) return;
    const bytes = await run(plainJsonBytesWork(value));
    await run(effect(1, () => payloadOwnership.grow(bytes)));
  }
  const entries = Object.fromEntries(
    LEGACY_DOCUMENT_KEYS.map(key => [key, readEntry(sourceCopy, key)]),
  ) as LegacySnapshot;
  const origin = LEGACY_DOCUMENT_KEYS.some(key => entries[key].present) ? 'legacy' : 'native';
  const sourceDigest = await digestLegacySnapshot(entries, environment.crypto.subtle, work);
  work?.assertCurrent();

  const rawProjectsValue = await run(parseJsonEntry(entries, LEGACY_KEYS.projects));
  if (rawProjectsValue !== undefined && !Array.isArray(rawProjectsValue)) {
    throw sourceError(LEGACY_KEYS.projects, 'Legacy projects must be an array.');
  }
  const rawProjects = Array.isArray(rawProjectsValue) ? rawProjectsValue : [];
  await retainPayload(rawProjects);
  const projectIds = new Set<string>();
  const migratedProjects: WorkspaceProject[] = [];
  for (const [index, rawProject] of rawProjects.entries()) {
    try {
      const project = work
        ? await run(validateWorkspaceProjectWork(rawProject, REJECT_WARNINGS))
        : validateWorkspaceProject(rawProject, REJECT_WARNINGS);
      if (projectIds.has(project.id)) throw new Error(`Duplicate project id: ${project.id}.`);
      projectIds.add(project.id);
      migratedProjects.push(project);
      await retainPayload(project);
    } catch (error) {
      if (work?.stopped()) work.assertCurrent();
      throw sourceError(
        LEGACY_KEYS.projects,
        `Legacy project at index ${index} is invalid: ${(error as Error).message}`,
        error,
        String(index),
      );
    }
  }

  const activeEntry = readEntry(entries, LEGACY_KEYS.activeProject);
  const requestedActiveId = activeEntry.present && activeEntry.raw !== '' ? activeEntry.raw : null;
  if (requestedActiveId !== null && !projectIds.has(requestedActiveId)) {
    throw sourceError(
      LEGACY_KEYS.activeProject,
      `Legacy active project ${requestedActiveId} does not reference a source project.`,
    );
  }

  const rawPresetsValue = await run(parseJsonEntry(entries, LEGACY_KEYS.customPresets));
  if (rawPresetsValue !== undefined && !Array.isArray(rawPresetsValue)) {
    throw sourceError(LEGACY_KEYS.customPresets, 'Legacy custom presets must be an array.');
  }
  const rawPresets = Array.isArray(rawPresetsValue) ? rawPresetsValue : [];
  await retainPayload(rawPresets);
  const presetIds = new Set<string>();
  const migratedPresets: WorkspaceCustomPreset[] = [];
  for (const [index, rawPreset] of rawPresets.entries()) {
    try {
      const options = {
        warningPolicy: 'reject' as const,
        existingIds: presetIds,
      };
      const preset = work ? await run(validateCustomPresetWork(rawPreset, options)) : validateCustomPreset(rawPreset, options);
      presetIds.add(preset.id);
      migratedPresets.push(preset);
      await retainPayload(preset);
    } catch (error) {
      if (work?.stopped()) work.assertCurrent();
      throw sourceError(
        LEGACY_KEYS.customPresets,
        `Legacy custom preset at index ${index} is invalid: ${(error as Error).message}`,
        error,
        String(index),
      );
    }
  }

  const rawPendingValue = await run(parseJsonEntry(entries, LEGACY_KEYS.pendingImport));
  const rawPending = await run(validateLegacyPending(rawPendingValue));
  if (rawPending !== undefined) await retainPayload(rawPending);

  const projectFingerprints = await fingerprintItems(
    rawProjects,
    migratedProjects,
    environment.crypto.subtle,
    work,
  );
  const presetFingerprints = await fingerprintItems(
    rawPresets,
    migratedPresets,
    environment.crypto.subtle,
    work,
  );
  const keyFingerprints: MigrationLedger['keyFingerprints'] = [];
  for (const key of LEGACY_DOCUMENT_KEYS) {
    work?.assertCurrent();
    const digest = await sha256Hex(entries[key].raw ?? '', environment.crypto.subtle, work);
    work?.assertCurrent();
    keyFingerprints.push({ key, present: entries[key].present, digest });
  }

  const migratedAt = await run(effect(1, () => environment.now()));
  await run(primitive('scalar', () => validateTimestamp(migratedAt, 'Migration timestamp')));

  if (migratedProjects.length === 0) {
    try {
      const input = {
        id: `proj_${await run(effect(1, () => environment.randomUUID()))}`,
        name: 'Blank Project',
        initialState: await run(effect(1, () => environment.createBlankProject())),
      };
      const blank = work
        ? await run(validateWorkspaceProjectWork(input, REJECT_WARNINGS))
        : validateWorkspaceProject(input, REJECT_WARNINGS);
      migratedProjects.push(blank);
      projectIds.add(blank.id);
      await retainPayload(blank);
    } catch (error) {
      if (work?.stopped()) work.assertCurrent();
      throw targetError(`Fresh blank project is invalid: ${(error as Error).message}`, error);
    }
  }

  let pendingImport: WorkspacePendingImport | undefined;
  if (rawPending !== undefined) {
    try {
      const input = Object.assign(await run(copyEnumerableWork(rawPending)), {
        id: 'legacy-import-v1',
        targetProjectId: await run(importTargetId(sourceDigest, projectIds)),
        createdAt: migratedAt,
      });
      pendingImport = work
        ? await run(preparePendingImportWork(input, REJECT_WARNINGS))
        : preparePendingImport(input, REJECT_WARNINGS);
      await retainPayload(pendingImport);
    } catch (error) {
      if (work?.stopped()) work.assertCurrent();
      throw sourceError(
        LEGACY_KEYS.pendingImport,
        `Legacy pending import is invalid: ${(error as Error).message}`,
        error,
      );
    }
  }

  const projects: StoredProject[] = await run(mapPreparationRows(migratedProjects, project => ({
    id: project.id,
    project,
    incarnation: environment.randomUUID(),
    storageRevision: 0,
    updatedAt: migratedAt,
  })));
  const workspace: StoredWorkspace = {
    id: 'current',
    projectOrder: await run(mapPreparationRows(projects, record => record.id)),
    activeProjectId: requestedActiveId ?? projects[0].id,
    revision: 0,
  };
  const presets: StoredPreset[] = await run(mapPreparationRows(migratedPresets, (preset, position) => ({
    id: preset.id,
    preset,
    position,
  })));
  const pendingImports: StoredPendingImport[] = pendingImport ? [{
    id: pendingImport.id,
    pendingImport,
    position: 0,
  }] : [];
  const targetSnapshot: WorkspaceSnapshot = {
    projects: migratedProjects,
    activeProjectId: workspace.activeProjectId,
    customPresets: migratedPresets,
    pendingImports: pendingImport ? [pendingImport] : [],
  };
  const targetDigest = await digestWorkspaceContent(targetSnapshot, environment.crypto.subtle, work);
  work?.assertCurrent();
  const backupId = `${WORKSPACE_MIGRATION_ID}:original:${sourceDigest}`;
  const backup: LegacyBackupRecord = {
    id: backupId,
    kind: 'original',
    capturedAt: migratedAt,
    snapshot: await run(primitive('clone', () => structuredClone(entries))),
    digest: sourceDigest,
  };
  const ledger: MigrationLedger = {
    id: WORKSPACE_MIGRATION_ID,
    indexedDbVersion: HISTORICAL_WORKSPACE_FORMAT_VERSION,
    state: 'copied',
    origin,
    ledgerRevision: 0,
    sourceDigest,
    expectedTargetDigest: targetDigest,
    acceptedLegacyDigest: sourceDigest,
    originalLegacyBackupId: backupId,
    acceptedLegacyBackupId: backupId,
    keyFingerprints,
    projectFingerprints,
    presetFingerprints,
    counts: {
      sourceProjects: rawProjects.length,
      targetProjects: projects.length,
      customPresets: presets.length,
      pendingImports: pendingImports.length,
    },
    migratedAt,
    verifiedAt: null,
    persistenceRolloutEpoch: PERSISTENCE_ROLLOUT_EPOCH,
    unresolvedRecovery: null,
  };
  const receipt: MigrationReceipt | undefined = origin === 'legacy' ? {
    id: `${WORKSPACE_MIGRATION_ID}:${sourceDigest}`,
    projectCount: rawProjects.length,
    customPresetCount: presets.length,
    pendingImportPreserved: pendingImports.length === 1,
    migratedAt,
  } : undefined;

  return {
    origin,
    source: await run(primitive('clone', () => structuredClone(entries))),
    sourceDigest,
    targetDigest,
    projects,
    workspace,
    presets,
    pendingImports,
    backup,
    ledger,
    ...(receipt ? { receipt } : {}),
  };
}

function* validateProjectRecords(
  records: unknown, retainSnapshot: boolean, cooperative: boolean,
  accountOutput: (value: unknown) => Work<void>,
  state = { projects: new Map<string, WorkspaceProject | undefined>(), consumedImportIds: new Set<string>() },
): Work<Map<string, WorkspaceProject | undefined>> {
  if (!Array.isArray(records)) throw targetError('Project records must be an array.');
  const { projects, consumedImportIds } = state;
  for (const [index, rawRecord] of records.entries()) {
    yield* effect(1, () => {});
    if (!isPlainObject(rawRecord)) throw targetError(`Project record ${index} must be an object.`);
    yield* requireExactKeys(
      rawRecord,
      ['id', 'project', 'incarnation', 'storageRevision', 'updatedAt'],
      [
        'consumedImportId',
        'consumedImportCreatedAt',
        'consumedImportDigest',
        'consumedImportAttempt',
      ],
      `Project record ${index}`,
    );
    if (typeof rawRecord.id !== 'string' || rawRecord.id.length === 0) {
      throw targetError(`Project record ${index} id must be a non-empty string.`);
    }
    if (projects.has(rawRecord.id)) throw targetError(`Duplicate project record id ${rawRecord.id}.`);
    if (typeof rawRecord.incarnation !== 'string' || rawRecord.incarnation.length === 0) {
      throw targetError(`Project record ${rawRecord.id} incarnation must be a non-empty string.`);
    }
    requireNonNegativeInteger(rawRecord.storageRevision, `Project record ${rawRecord.id} storageRevision`);
    yield* primitive('scalar', () => validateTimestamp(rawRecord.updatedAt, `Project record ${rawRecord.id} updatedAt`));
    if (Object.hasOwn(rawRecord, 'consumedImportId')) {
      if (typeof rawRecord.consumedImportId !== 'string'
        || rawRecord.consumedImportId.length === 0) {
        throw targetError(
          `Project record ${rawRecord.id} consumedImportId must be a non-empty string.`,
        );
      }
      if (consumedImportIds.has(rawRecord.consumedImportId)) {
        throw targetError(`Duplicate consumed import id ${rawRecord.consumedImportId}.`);
      }
      consumedImportIds.add(rawRecord.consumedImportId);
    }
    if (Object.hasOwn(rawRecord, 'consumedImportCreatedAt')) {
      if (!Object.hasOwn(rawRecord, 'consumedImportId')) {
        throw targetError(
          `Project record ${rawRecord.id} consumedImportCreatedAt requires consumedImportId.`,
        );
      }
      yield* primitive('scalar', () => validateTimestamp(
        rawRecord.consumedImportCreatedAt,
        `Project record ${rawRecord.id} consumedImportCreatedAt`,
      ));
    }
    if (Object.hasOwn(rawRecord, 'consumedImportDigest')) {
      if (!Object.hasOwn(rawRecord, 'consumedImportId')) {
        throw targetError(
          `Project record ${rawRecord.id} consumedImportDigest requires consumedImportId.`,
        );
      }
      if (!Object.hasOwn(rawRecord, 'consumedImportCreatedAt')) {
        throw targetError(
          `Project record ${rawRecord.id} consumedImportDigest requires consumedImportCreatedAt.`,
        );
      }
      if (typeof rawRecord.consumedImportDigest !== 'string'
        || !/^[a-f0-9]{64}$/.test(rawRecord.consumedImportDigest)) {
        throw targetError(
          `Project record ${rawRecord.id} consumedImportDigest must be a lowercase SHA-256 digest.`,
        );
      }
    }
    if (Object.hasOwn(rawRecord, 'consumedImportAttempt')) {
      if (!Object.hasOwn(rawRecord, 'consumedImportId')
        || !Object.hasOwn(rawRecord, 'consumedImportCreatedAt')
        || !Object.hasOwn(rawRecord, 'consumedImportDigest')) {
        throw targetError(
          `Project record ${rawRecord.id} consumedImportAttempt requires complete consume provenance.`,
        );
      }
      const consumedImportAttempt = yield* validateStoredImportAttempt(
        rawRecord.consumedImportAttempt,
        `Project record ${rawRecord.id} consumedImportAttempt`,
      );
      if (consumedImportAttempt.pendingImportDigest !== rawRecord.consumedImportDigest) {
        throw targetError(
          `Project record ${rawRecord.id} consumedImportAttempt pending digest must match consumedImportDigest.`,
        );
      }
    }
    try {
      if (!isPlainObject(rawRecord.project)) throw new Error('Project payload must be an object.');
      let project: WorkspaceProject | undefined;
      // Captured rows have data properties. An accessor-backed envelope can
      // return different payloads or throw on later Gets; retain its old path.
      const stablePayload = cooperative && !retainSnapshot && (yield* effect(2, () => {
        const descriptor = Object.getOwnPropertyDescriptor(rawRecord, 'project');
        return descriptor !== undefined && Object.hasOwn(descriptor, 'value');
      }));
      if (stablePayload) {
        yield* checkStoredWorkspaceProjectWork(rawRecord.project);
      } else {
        if (cooperative) yield* checkMigratedStateWork(rawRecord.project.initialState);
        else validateMigratedState(rawRecord.project.initialState);
        if (!retainSnapshot) yield* checkWorkspaceProjectWork(rawRecord.project, REJECT_WARNINGS);
        else project = cooperative
          ? yield* validateWorkspaceProjectWork(rawRecord.project, REJECT_WARNINGS)
          : validateWorkspaceProject(rawRecord.project, REJECT_WARNINGS);
      }
      const id = (project?.id ?? rawRecord.project.id) as string;
      if (yield* compareStringsWork(id, rawRecord.id)) throw new Error('Stored ID does not match project ID.');
      if (project) yield* accountOutput(project);
      // Validation-only callers discard their working state; they do not produce
      // an external project. Count actual snapshot reconstruction separately.
      yield* effect(1, () => {}, 0, retainSnapshot ? 'projectReconstructions' : undefined);
      projects.set(rawRecord.id, project);
    } catch (error) {
      throw targetError(`Project record ${rawRecord.id} is invalid: ${(error as Error).message}`, error);
    }
  }
  return projects;
}

function* validateWorkspaceRecord(raw: unknown): Work<StoredWorkspace> {
  if (!isPlainObject(raw)) throw targetError('Workspace record must be an object.');
  yield* requireExactKeys(raw, ['id', 'projectOrder', 'activeProjectId', 'revision'], [], 'Workspace record');
  if (raw.id !== 'current') throw targetError('Workspace record id must be current.');
  if (!Array.isArray(raw.projectOrder)) {
    throw targetError('Workspace projectOrder must contain non-empty string IDs.');
  }
  for (let index = 0; index < raw.projectOrder.length; index += 1) {
    yield* effect(1, () => {});
    if (!(index in raw.projectOrder)) continue;
    const id = raw.projectOrder[index];
    if (typeof id !== 'string' || id.length === 0) {
      throw targetError('Workspace projectOrder must contain non-empty string IDs.');
    }
  }
  if (typeof raw.activeProjectId !== 'string' || raw.activeProjectId.length === 0) {
    throw targetError('Workspace activeProjectId must be a non-empty string.');
  }
  requireNonNegativeInteger(raw.revision, 'Workspace revision');
  // Order metadata is one record, not a hydrated document snapshot. Keep the
  // historical clone boundary (including clone failures) in both drivers.
  return (yield* primitive('clone', () => structuredClone(raw))) as unknown as StoredWorkspace;
}

function* orderedByPosition<T extends { position: number }>(records: T[], label: string): Work<T[]> {
  const positions = new Set<number>();
  for (const record of records) {
    yield* effect(1, () => {});
    requireNonNegativeInteger(record.position, `${label} position`);
    if (positions.has(record.position)) throw targetError(`${label} positions must be unique.`);
    positions.add(record.position);
  }
  return yield* stableSortWork(records, function* (left, right) {
    return yield* effect(1, () => left.position - right.position);
  });
}

function* validatePresetRecords(
  records: unknown, retainSnapshot: boolean, cooperative: boolean,
  accountOutput: (value: unknown) => Work<void>,
): Work<WorkspaceCustomPreset[]> {
  if (!Array.isArray(records)) throw targetError('Preset records must be an array.');
  const ids = new Set<string>();
  const validated: { preset?: WorkspaceCustomPreset; position: number }[] = new Array(records.length);
  for (let index = 0; index < records.length; index += 1) {
    yield* effect(1, () => {});
    if (!(index in records)) continue;
    const rawRecord = records[index];
    if (!isPlainObject(rawRecord)) throw targetError(`Preset record ${index} must be an object.`);
    yield* requireExactKeys(rawRecord, ['id', 'preset', 'position'], [], `Preset record ${index}`);
    if (typeof rawRecord.id !== 'string' || rawRecord.id.length === 0) {
      throw targetError(`Preset record ${index} id must be a non-empty string.`);
    }
    try {
      if (!isPlainObject(rawRecord.preset)) throw new Error('Preset payload must be an object.');
      if (cooperative) yield* checkMigratedStateWork(rawRecord.preset.initialState);
      else validateMigratedState(rawRecord.preset.initialState);
      const options = {
        warningPolicy: 'reject' as const,
        existingIds: ids,
      };
      let preset: WorkspaceCustomPreset | undefined;
      if (!retainSnapshot) yield* checkCustomPresetWork(rawRecord.preset, options);
      else preset = cooperative
        ? yield* validateCustomPresetWork(rawRecord.preset, options)
        : validateCustomPreset(rawRecord.preset, options);
      const id = (preset?.id ?? rawRecord.preset.id) as string;
      if (yield* compareStringsWork(id, rawRecord.id)) throw new Error('Stored ID does not match preset ID.');
      ids.add(rawRecord.id);
      if (preset) yield* accountOutput(preset);
      validated[index] = { preset, position: rawRecord.position as number };
    } catch (error) {
      throw targetError(`Preset record ${rawRecord.id} is invalid: ${(error as Error).message}`, error);
    }
  }
  const ordered = yield* orderedByPosition(validated, 'Preset record');
  const result: WorkspaceCustomPreset[] = [];
  if (retainSnapshot) for (const record of ordered) {
    yield* effect(1, () => { result.push(record.preset!); });
  }
  return result;
}

function* validatePendingRecords(
  records: unknown, retainSnapshot: boolean, cooperative: boolean,
  accountOutput: (value: unknown) => Work<void>,
): Work<WorkspacePendingImport[]> {
  if (!Array.isArray(records)) throw targetError('Pending import records must be an array.');
  const ids = new Set<string>();
  const validated: { pendingImport?: WorkspacePendingImport; position: number }[] = new Array(records.length);
  for (let index = 0; index < records.length; index += 1) {
    yield* effect(1, () => {});
    if (!(index in records)) continue;
    const rawRecord = records[index];
    if (!isPlainObject(rawRecord)) throw targetError(`Pending import record ${index} must be an object.`);
    yield* requireExactKeys(
      rawRecord,
      ['id', 'pendingImport', 'position'],
      ['attemptProvenance'],
      `Pending import record ${index}`,
    );
    if (typeof rawRecord.id !== 'string' || rawRecord.id.length === 0) {
      throw targetError(`Pending import record ${index} id must be a non-empty string.`);
    }
    if (ids.has(rawRecord.id)) throw targetError(`Duplicate pending import record id ${rawRecord.id}.`);
    if (!isPlainObject(rawRecord.pendingImport)) {
      throw targetError(`Pending import record ${rawRecord.id} payload must be an object.`);
    }
    const payload = rawRecord.pendingImport;
    const keys = yield* primitive('keys', () => Object.keys(payload));
    for (const key of keys) {
      yield* effect(1, () => {});
      if (!STORED_PENDING_KEYS.has(key)) {
        if (key) throw targetError(`Pending import record ${rawRecord.id} contains unknown field ${key}.`);
        break;
      }
    }
    for (const required of ['id', 'targetProjectId', 'name', 'state', 'createdAt', 'warnings']) {
      if (!Object.hasOwn(payload, required)) {
        throw targetError(`Pending import record ${rawRecord.id} is missing ${required}.`);
      }
    }
    if (!Array.isArray(payload.warnings)) {
      throw targetError(`Pending import record ${rawRecord.id} warnings must be strings.`);
    }
    for (let index = 0; index < payload.warnings.length; index += 1) {
      yield* effect(1, () => {});
      if (index in payload.warnings && typeof payload.warnings[index] !== 'string') {
        throw targetError(`Pending import record ${rawRecord.id} warnings must be strings.`);
      }
    }
    if (Object.hasOwn(rawRecord, 'attemptProvenance')) {
      yield* validateStoredImportAttempt(
        rawRecord.attemptProvenance,
        `Pending import record ${rawRecord.id} attemptProvenance`,
      );
    }
    try {
      if (cooperative) yield* checkMigratedStateWork(payload.state);
      else validateMigratedState(payload.state);
      const warnings = payload.warnings;
      const input: Record<string, unknown> = {};
      const inputKeys = yield* primitive('keys', () => Reflect.ownKeys(payload));
      for (const key of inputKeys) {
        yield* effect(1, () => {
          if (key !== 'warnings' && Object.getOwnPropertyDescriptor(payload, key)?.enumerable) {
            Object.defineProperty(input, key, {
              value: Reflect.get(payload, key), enumerable: true, configurable: true, writable: true,
            });
          }
        });
      }
      let pendingImport: WorkspacePendingImport | undefined;
      if (!retainSnapshot) yield* checkPendingImportWork(input, REJECT_WARNINGS);
      else pendingImport = cooperative
        ? yield* preparePendingImportWork(input, REJECT_WARNINGS)
        : preparePendingImport(input, REJECT_WARNINGS);
      const id = (pendingImport?.id ?? input.id) as string;
      if (yield* compareStringsWork(id, rawRecord.id)) throw new Error('Stored ID does not match import ID.');
      ids.add(rawRecord.id);
      if (pendingImport) {
        const retainedWarnings: string[] = [];
        for (const warning of warnings) yield* effect(1, () => { retainedWarnings.push(warning); });
        pendingImport = { ...pendingImport, warnings: retainedWarnings };
        yield* accountOutput(pendingImport);
      }
      validated[index] = { pendingImport, position: rawRecord.position as number };
    } catch (error) {
      throw targetError(
        `Pending import record ${rawRecord.id} is invalid: ${(error as Error).message}`,
        error,
      );
    }
  }
  const ordered = yield* orderedByPosition(validated, 'Pending import record');
  const result: WorkspacePendingImport[] = [];
  if (retainSnapshot) for (const record of ordered) {
    yield* effect(1, () => { result.push(record.pendingImport!); });
  }
  return result;
}

function* workspaceRecords(
  records: WorkspaceRecordCandidates, retainSnapshot: boolean, cooperative: boolean,
  validatedProjects?: Map<string, WorkspaceProject | undefined>,
): Work<ReconstructedWorkspaceRecords> {
  // Logical output bytes owned during reconstruction, not measured heap. The
  // caller owns the returned snapshot after this program's finally boundary.
  let ownership: Ownership | undefined;
  function* accountOutput(value: unknown): Work<void> {
    if (!cooperative) return;
    const bytes = yield* plainJsonBytesWork(value);
    yield* effect(1, () => { ownership?.grow(bytes); });
  }
  try {
    if (retainSnapshot && cooperative) yield {
      visits: 1, utf8Bytes: 0, run(runtime) { ownership = runtime?.own(0); },
    };
    if (!isPlainObject(records)) throw targetError('Workspace records must be an object.');
    const projectsById = validatedProjects ?? (yield* validateProjectRecords(records.projects, retainSnapshot, cooperative, accountOutput));
    const workspace = yield* validateWorkspaceRecord(records.workspace);
    const order = workspace.projectOrder;
    const ids = new Set<string>();
    for (const id of order) yield* effect(1, () => { ids.add(id); });
    if (ids.size !== order.length) throw targetError('Workspace projectOrder contains duplicates.');
    let missing = order.length !== projectsById.size;
    if (!missing) for (let index = 0; index < order.length; index += 1) {
      yield* effect(1, () => {});
      if (index in order && !projectsById.has(order[index])) { missing = true; break; }
    }
    if (missing) {
      throw targetError('Workspace projectOrder must reference every project record exactly once.');
    }
    if (!projectsById.has(workspace.activeProjectId)) {
      throw targetError('Workspace activeProjectId must reference an ordered project.');
    }

    const projects: WorkspaceProject[] = [];
    if (retainSnapshot) for (const id of order) {
      yield* effect(1, () => { projects.push(projectsById.get(id) as WorkspaceProject); });
    }
    const snapshot: WorkspaceSnapshot = {
      projects,
      activeProjectId: workspace.activeProjectId,
      customPresets: yield* validatePresetRecords(records.presets, retainSnapshot, cooperative, accountOutput),
      pendingImports: yield* validatePendingRecords(records.pendingImports, retainSnapshot, cooperative, accountOutput),
    };
    return { records: records as WorkspaceRecords, snapshot };
  } finally {
    ownership?.release();
  }
}

export function reconstructWorkspaceRecords(records: WorkspaceRecordCandidates): ReconstructedWorkspaceRecords {
  return runSync(workspaceRecords(records, true, false));
}

export function reconstructWorkspaceRecordsWork(records: WorkspaceRecordCandidates): Work<ReconstructedWorkspaceRecords> {
  return workspaceRecords(records, true, true);
}

export function* validateWorkspaceRecordsWork(records: WorkspaceRecordCandidates): Work<WorkspaceRecords> {
  return (yield* workspaceRecords(records, false, true)).records;
}

/** Validate streamed projects without retaining their payloads; membership and provenance IDs remain local. */
export function createWorkspaceRecordValidator() {
  const state = { projects: new Map<string, WorkspaceProject | undefined>(), consumedImportIds: new Set<string>() };
  return {
    project: function* (record: unknown): Work<void> {
      yield* validateProjectRecords([record], false, true, function* () {}, state);
    },
    ancillary: function* (records: Omit<WorkspaceRecordCandidates, 'projects'>): Work<void> {
      yield* workspaceRecords({ ...records, projects: [] }, false, true, state.projects);
    },
  };
}

export function reconstructWorkspace(records: WorkspaceRecordCandidates): WorkspaceSnapshot {
  return reconstructWorkspaceRecords(records).snapshot;
}

function* sameVerificationValue(left: unknown, right: unknown, cooperative: boolean): Work<boolean> {
  if (cooperative && typeof left === 'string' && typeof right === 'string') {
    return (yield* compareStringsWork(left, right)) === 0;
  }
  return yield* effect(1, () => left === right);
}

function* sameVerificationOrder(left: readonly string[], right: readonly string[], cooperative: boolean): Work<boolean> {
  if (!cooperative) return left.length === right.length && left.every((value, index) => value === right[index]);
  const length = yield* effect(1, () => left.length);
  if (length !== right.length) return false;
  for (let index = 0; index < length; index += 1) {
    yield* effect(1, () => {});
    if (index in left && !(yield* sameVerificationValue(left[index], right[index], true))) return false;
  }
  return true;
}

export async function verifyPreparedCopy(
  prepared: PreparedInitialCopy,
  reconstructedRecords: ReconstructedWorkspaceRecords,
  currentLegacy: LegacySnapshot,
  subtle: SubtleCrypto = globalThis.crypto.subtle,
  work?: WorkRuntime,
): Promise<WorkspaceSnapshot> {
  work?.assertCurrent();
  const { records, snapshot: reconstructed } = reconstructedRecords;
  const targetDigest = await digestWorkspaceContent(reconstructed, subtle, work);
  work?.assertCurrent();
  const sourceDigest = await digestLegacySnapshot(currentLegacy, subtle, work);
  work?.assertCurrent();
  const observed = {
    targetDigest,
    sourceDigest,
    projectCount: records.projects.length,
    presetCount: records.presets.length,
    pendingImportCount: records.pendingImports.length,
    projectOrder: records.workspace.projectOrder,
    activeProjectId: records.workspace.activeProjectId,
  };
  const expected = {
    targetDigest: prepared.ledger.expectedTargetDigest,
    sourceDigest: prepared.ledger.sourceDigest,
    projectCount: prepared.ledger.counts.targetProjects,
    presetCount: prepared.ledger.counts.customPresets,
    pendingImportCount: prepared.ledger.counts.pendingImports,
    projectOrder: prepared.workspace.projectOrder,
    activeProjectId: prepared.workspace.activeProjectId,
  };

  const matches = (function* (): Work<boolean> {
    const cooperative = work !== undefined;
    if (!(yield* sameVerificationValue(prepared.targetDigest, expected.targetDigest, cooperative))
      || !(yield* sameVerificationValue(prepared.sourceDigest, expected.sourceDigest, cooperative))
      || !(yield* sameVerificationValue(observed.targetDigest, expected.targetDigest, cooperative))
      || !(yield* sameVerificationValue(observed.sourceDigest, expected.sourceDigest, cooperative))
      || !(yield* effect(3, () => observed.projectCount === expected.projectCount
        && observed.presetCount === expected.presetCount && observed.pendingImportCount === expected.pendingImportCount))
      || !(yield* sameVerificationOrder(observed.projectOrder, expected.projectOrder, cooperative))
      || !(yield* sameVerificationValue(observed.activeProjectId, expected.activeProjectId, cooperative))) return false;
    return true;
  })();
  const verified = work ? await work.run(matches) : runSync(matches);
  work?.assertCurrent();
  if (!verified) {
    throw verificationError('Prepared workspace copy does not match migration expectations.');
  }
  return reconstructed;
}
