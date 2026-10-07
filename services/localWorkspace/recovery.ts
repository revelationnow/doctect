import {
  canonicalStringify,
  digestLegacySnapshot,
  digestFrame,
  sha256Hex,
} from './canonical';
import type {
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
  reconstructWorkspace,
  type WorkspaceRecords,
} from './migration';
import type {
  LegacyBackupRecord,
  MigrationLedger,
  StoredPendingImport,
  StoredPreset,
  StoredProject,
  StoredWorkspace,
} from './schema';
import {
  preparePendingImport,
  preparePendingImportWork,
  validateCustomPreset,
  validateCustomPresetWork,
  validateWorkspaceProject,
  validateWorkspaceProjectWork,
} from './validation';
import type { NormalizedRepository } from './normalized/repository';
import { assertWorkRuntime, createWorkRuntime, effect, primitive, runSync, type Ownership, type Work, type WorkRuntime } from '../../shared/cooperativeWork.js';
import { canonicalWork, copyEnumerableWork, rawValueWeightWork } from '../../shared/jsonWork.js';

/** Private selectors. Public recovery source names retain their original meanings. */
export type NormalizationRecoverySource =
  | { kind: 'historical-indexeddb'; sourceDigest: string; authority: 'historical'; rollbackReady: false }
  | { kind: 'fresh-seed'; sourceDigest: string; authority: 'historical'; rollbackReady: false }
  | { kind: 'normalized-active'; storageGeneration: string; cutoverRevision: number };
export type NormalizationRecoveryBundle = {
  version: 1; capturedAt: string; workspace: WorkspaceSnapshot;
} & ({ format: 'doctect.normalization-source-recovery'; source: Exclude<NormalizationRecoverySource, { kind: 'normalized-active' }>;
  rollbackReady: false; records: WorkspaceRecords }
  | { format: 'doctect.normalized-workspace-recovery'; source: Extract<NormalizationRecoverySource, { kind: 'normalized-active' }> });

async function withRecoveryWork<T>(provided: WorkRuntime | undefined, operation: (work: WorkRuntime) => Promise<T>): Promise<T> {
  const work = provided ?? createWorkRuntime({ assertCurrent() {} });
  try {
    assertWorkRuntime(work); work.assertCurrent();
    const result = await operation(work); work.assertCurrent(); return result;
  } finally { if (!provided) work.dispose(); }
}

export async function normalizationRecoverySources(repository: Pick<NormalizedRepository, 'readRetainedSource' | 'readActiveSnapshot'>, work?: WorkRuntime): Promise<NormalizationRecoverySource[]> {
  return withRecoveryWork(work, async work => {
  const sources: NormalizationRecoverySource[] = [];
  try {
    const source = await work.wait(() => repository.readRetainedSource(work));
    // An unreserved fresh candidate is not a retained source.
    if (source.kind === 'historical') sources.push({ kind: 'historical-indexeddb', sourceDigest: source.sourceDigest, authority: 'historical', rollbackReady: false });
    else if (source.retainedSeed) sources.push({ kind: 'fresh-seed', sourceDigest: source.sourceDigest, authority: 'historical', rollbackReady: false });
  } catch { work.assertCurrent(); /* Only independently validated sources are advertised. */ }
  try {
    const active = await work.wait(() => repository.readActiveSnapshot(work));
    if (active) {
      sources.push({ kind: 'normalized-active', storageGeneration: active.authority.storageGeneration, cutoverRevision: active.authority.cutoverRevision });
    }
  } catch { work.assertCurrent(); /* Invalid active data never becomes a historical rollback. */ }
  return sources;
  });
}

export async function exportNormalizationRecovery(repository: Pick<NormalizedRepository, 'readRetainedSource' | 'readActiveSnapshot'>, selector: NormalizationRecoverySource,
  capturedAt: string, work?: WorkRuntime): Promise<NormalizationRecoveryBundle> {
  if (work) { assertWorkRuntime(work); work.assertCurrent(); }
  validateTimestamp(capturedAt);
  if (!isPlainObject(selector)) throw new TypeError('Malformed normalization recovery source');
  // Validate data descriptors before reading a caller-controlled discriminator, and
  // capture it before the first asynchronous read so the selector cannot drift.
  canonicalStringify(selector);
  if (!hasExactKeys(selector, selector.kind === 'normalized-active'
    ? ['kind', 'storageGeneration', 'cutoverRevision'] : ['kind', 'sourceDigest', 'authority', 'rollbackReady'])) {
    throw new TypeError('Malformed normalization recovery source');
  }
  selector = structuredClone(selector);
  return withRecoveryWork(work, async work => {
  if (selector.kind === 'historical-indexeddb' || selector.kind === 'fresh-seed') {
    const source = await work.wait(() => repository.readRetainedSource(work));
    if ((selector.kind === 'historical-indexeddb' ? source.kind !== 'historical' : source.kind !== 'fresh' || !source.retainedSeed)
      || source.sourceDigest !== selector.sourceDigest || selector.rollbackReady !== false
      || selector.authority !== 'historical') throw new Error('Retained normalization source changed');
    return { format: 'doctect.normalization-source-recovery', version: 1, capturedAt,
      source: { kind: selector.kind, sourceDigest: source.sourceDigest, authority: 'historical', rollbackReady: false },
      rollbackReady: false, workspace: source.snapshot, records: source.records };
  }
  if (selector.kind !== 'normalized-active') throw new Error('Unknown normalization recovery source');
  const active = await work.wait(() => repository.readActiveSnapshot(work));
  if (!active || active.authority.storageGeneration !== selector.storageGeneration || active.authority.cutoverRevision !== selector.cutoverRevision)
    throw new Error('Active normalization authority changed');
  return { format: 'doctect.normalized-workspace-recovery', version: 1, capturedAt,
    source: { kind: 'normalized-active', storageGeneration: active.authority.storageGeneration, cutoverRevision: active.authority.cutoverRevision }, workspace: active.snapshot };
  });
}

const RECOVERY_MIME = 'application/json;charset=utf-8';
const LEGACY_PENDING_KEYS = new Set(['name', 'state', 'cloud']);
const REJECT_WARNINGS = { warningPolicy: 'reject' as const };

export interface LegacyRecoveryBundle {
  format: 'doctect.legacy-workspace-recovery';
  version: 1;
  capturedAt: string;
  entries: Array<{
    key: LegacyDocumentKey;
    present: boolean;
    raw: string | null;
  }>;
  digest: string;
}

export interface IndexedDbRecoveryBundle {
  format: 'doctect.indexeddb-workspace-recovery';
  version: 1;
  capturedAt: string;
  workspace: WorkspaceSnapshot;
}

export interface RecoveryPreparationEnvironment {
  crypto: Pick<Crypto, 'subtle'>;
  now(): string;
  randomUUID(): string;
}

export interface PreparedLegacyRecovery {
  recoveryId: string;
  observedLegacyDigest: string;
  expectedLedgerRevision: number;
  expectedAcceptedLegacyDigest: string;
  expectedAcceptedLegacyBackupId: string;
  expectedLedger: MigrationLedger;
  expectedRecords: WorkspaceRecords;
  projects: StoredProject[];
  workspace: StoredWorkspace;
  presets: StoredPreset[];
  pendingImports: StoredPendingImport[];
  backup: LegacyBackupRecord;
  ledger: MigrationLedger;
}

interface ParsedItem<T> {
  raw: unknown;
  value: T;
  digest: string;
}

interface ParsedLegacySource {
  projects: ParsedItem<WorkspaceProject>[];
  presets: ParsedItem<WorkspaceCustomPreset>[];
  pendingImport?: ParsedItem<Record<string, unknown>>;
  activeProjectId: string | null;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every(key => keys.includes(key));
};

const legacyError = (message: string, cause?: unknown): Error =>
  new Error(message, cause === undefined ? undefined : { cause });

const readEntry = (source: LegacySnapshot, key: LegacyDocumentKey) => {
  const entry = source[key] as unknown;
  if (!isPlainObject(entry)
    || !hasExactKeys(entry, ['present', 'raw'])
    || typeof entry.present !== 'boolean'
    || (entry.present ? typeof entry.raw !== 'string' : entry.raw !== null)) {
    throw legacyError(`Legacy key ${key} has malformed raw-value metadata.`);
  }
  return entry as LegacySnapshot[LegacyDocumentKey];
};

const parseJsonEntry = (
  source: LegacySnapshot,
  key: Exclude<LegacyDocumentKey, typeof LEGACY_KEYS.activeProject>,
): unknown | undefined => {
  const entry = readEntry(source, key);
  if (!entry.present) return undefined;
  try {
    return JSON.parse(entry.raw as string);
  } catch (error) {
    throw legacyError(`Legacy key ${key} does not contain valid JSON.`, error);
  }
};

const itemDigest = (value: unknown, subtle: SubtleCrypto): Promise<string> =>
  sha256Hex(canonicalStringify(value), subtle);

const validateTimestamp = (value: string): void => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw legacyError('Recovery timestamp must be a canonical ISO timestamp.');
  }
};

const parseLegacySource = async (
  source: LegacySnapshot,
  environment: RecoveryPreparationEnvironment,
  work?: WorkRuntime,
  ownership?: Ownership,
): Promise<ParsedLegacySource> => {
  const parse = async (key: Exclude<LegacyDocumentKey, typeof LEGACY_KEYS.activeProject>) => {
    let value: unknown;
    if (work) await work.run(primitive('parse', () => { value = parseJsonEntry(source, key); }));
    else value = parseJsonEntry(source, key);
    if (work && value !== undefined) ownership?.grow((await work.run(rawValueWeightWork(value))).bytes);
    return value;
  };
  const digest = (value: unknown) => work ? digestFrame(emit => canonicalWork(value, emit), work, 'legacy') : itemDigest(value, environment.crypto.subtle);
  const projectValue = await parse(LEGACY_KEYS.projects);
  if (projectValue !== undefined && !Array.isArray(projectValue)) {
    throw legacyError('Legacy projects must be an array.');
  }
  const rawProjects = Array.isArray(projectValue) ? projectValue : [];
  const projectIds = new Set<string>();
  const projects: ParsedItem<WorkspaceProject>[] = [];
  for (const [index, raw] of rawProjects.entries()) {
    try {
      const value = work ? await work.run(validateWorkspaceProjectWork(raw, REJECT_WARNINGS)) : validateWorkspaceProject(raw, REJECT_WARNINGS);
      if (work) ownership?.grow((await work.run(rawValueWeightWork(value))).bytes);
      if (projectIds.has(value.id)) throw legacyError(`Duplicate project id ${value.id}.`);
      projectIds.add(value.id);
      projects.push({
        raw,
        value,
        digest: await digest(raw),
      });
    } catch (error) {
      throw legacyError(`Legacy project at index ${index} is invalid.`, error);
    }
  }

  const activeEntry = readEntry(source, LEGACY_KEYS.activeProject);
  const activeProjectId = activeEntry.present && activeEntry.raw !== ''
    ? activeEntry.raw
    : null;
  if (activeProjectId !== null && !projectIds.has(activeProjectId)) {
    throw legacyError(`Legacy active project ${activeProjectId} does not exist.`);
  }

  const presetValue = await parse(LEGACY_KEYS.customPresets);
  if (presetValue !== undefined && !Array.isArray(presetValue)) {
    throw legacyError('Legacy custom presets must be an array.');
  }
  const rawPresets = Array.isArray(presetValue) ? presetValue : [];
  const presetIds = new Set<string>();
  const presets: ParsedItem<WorkspaceCustomPreset>[] = [];
  for (const [index, raw] of rawPresets.entries()) {
    try {
      const options = {
        warningPolicy: 'reject',
        existingIds: presetIds,
      } as const;
      const value = work ? await work.run(validateCustomPresetWork(raw, options)) : validateCustomPreset(raw, options);
      if (work) ownership?.grow((await work.run(rawValueWeightWork(value))).bytes);
      presetIds.add(value.id);
      presets.push({
        raw,
        value,
        digest: await digest(raw),
      });
    } catch (error) {
      throw legacyError(`Legacy custom preset at index ${index} is invalid.`, error);
    }
  }

  const pendingValue = await parse(LEGACY_KEYS.pendingImport);
  let pendingImport: ParsedItem<Record<string, unknown>> | undefined;
  if (pendingValue !== undefined) {
    if (!isPlainObject(pendingValue)) {
      throw legacyError('Legacy pending import must be one object.');
    }
    const copy = work ? await work.run(copyEnumerableWork(pendingValue)) : { ...pendingValue };
    const unknownKey = work ? await work.run((function* (): Work<string | undefined> {
      for (const key in copy) { yield* effect(1, () => {}); if (!LEGACY_PENDING_KEYS.has(key)) return key; }
      return undefined;
    })()) : Object.keys(copy).find(key => !LEGACY_PENDING_KEYS.has(key));
    if (unknownKey) {
      throw legacyError(`Legacy pending import contains unknown field ${unknownKey}.`);
    }
    try {
      const input = {
        ...copy,
        id: 'recovery-validation-import',
        targetProjectId: 'recovery-validation-project',
        createdAt: '1970-01-01T00:00:00.000Z',
      };
      if (work) await work.run(preparePendingImportWork(input, REJECT_WARNINGS));
      else preparePendingImport(input, REJECT_WARNINGS);
    } catch (error) {
      throw legacyError('Legacy pending import is invalid.', error);
    }
    pendingImport = {
      raw: pendingValue,
      value: copy,
      digest: await digest(pendingValue),
    };
  }

  return { projects, presets, pendingImport, activeProjectId };
};

function* nextUniqueId(
  prefix: string,
  used: Set<string>,
  randomUUID: () => string,
): Work<string> {
  const token = yield* effect(1, randomUUID);
  if (typeof token !== 'string' || token.length === 0) {
    throw legacyError('Recovery ID generator returned an invalid value.');
  }
  const base = `${prefix}${token}`;
  let candidate = base;
  for (let suffix = 1; yield* effect(1, () => used.has(candidate)); suffix += 1) candidate = `${base}_${suffix}`;
  yield* effect(1, () => { used.add(candidate); });
  return candidate;
}

function* changedItems<T extends { id: string }>(
  current: ParsedItem<T>[],
  accepted: ParsedItem<T>[],
): Work<ParsedItem<T>[]> {
  const acceptedDigests = new Map<string, string>(), result: ParsedItem<T>[] = [];
  for (const item of accepted) yield* effect(1, () => { acceptedDigests.set(item.value.id, item.digest); });
  for (const item of current) yield* effect(1, () => { if (acceptedDigests.get(item.value.id) !== item.digest) result.push(item); });
  return result;
}

const sameCanonicalValue = (left: unknown, right: unknown): boolean =>
  canonicalStringify(left) === canonicalStringify(right);

function* reserveLegacyPendingIdentity(
  source: ParsedLegacySource,
  sourceDigest: string,
  reservedIds: Set<string>,
): Work<void> {
  if (!source.pendingImport) return;
  reservedIds.add('legacy-import-v1');
  const projectIds = new Set<string>();
  for (const item of source.projects) yield* effect(1, () => { projectIds.add(item.value.id); });
  const base = `proj_migrated_import_${sourceDigest.slice(0, 16)}`;
  let targetProjectId = base;
  for (let suffix = 1; yield* effect(1, () => projectIds.has(targetProjectId)); suffix += 1) {
    targetProjectId = `${base}_${suffix}`;
  }
  reservedIds.add(targetProjectId);
}

export interface RecoveryCopyRecords {
  projects: readonly Pick<StoredProject, 'id' | 'consumedImportId'>[];
  presets: readonly Pick<StoredPreset, 'id' | 'position'>[];
  pendingImports: readonly Pick<StoredPendingImport, 'id' | 'position' | 'pendingImport'>[];
}
/** Pure changed-only selection shared by historical preparation and normalized recovery. */
export async function prepareLegacyRecoveryCopies(currentSource: LegacySnapshot, currentDigest: string,
  acceptedSource: LegacySnapshot, acceptedDigest: string, records: RecoveryCopyRecords, updatedAt: string,
  environment: RecoveryPreparationEnvironment, work?: WorkRuntime, reserved: readonly string[] = []) {
  validateTimestamp(updatedAt); if (work) assertWorkRuntime(work);
  let owner: Ownership | undefined;
  try {
    if (work) await work.run(effect(1, () => { owner = work.own(0, true); }));
    const current = await parseLegacySource(currentSource, environment, work, owner);
    const accepted = await parseLegacySource(acceptedSource, environment, work, owner);
    // Account for selection maps, reserved-ID sets and list references. Payload graphs
    // have separate measured custody from parsing/validation above.
    if (work) await work.run(effect(1, () => owner!.grow(32 * (reserved.length + records.projects.length * 2
      + records.presets.length + records.pendingImports.length * 2
      + 4 * (current.projects.length + accepted.projects.length + current.presets.length + accepted.presets.length)))));
    function* select(): Work<{ projects: StoredProject[]; presets: StoredPreset[]; pendingImports: StoredPendingImport[] }> {
      const used = new Set<string>(); let lastPreset = -1, lastImport = -1;
      for (const id of reserved) yield* effect(1, () => { used.add(id); });
      for (const row of records.projects) yield* effect(1, () => { used.add(row.id); if (row.consumedImportId) used.add(row.consumedImportId); });
      for (const row of records.presets) yield* effect(1, () => { used.add(row.id); lastPreset = Math.max(lastPreset, row.position); });
      for (const row of records.pendingImports) yield* effect(1, () => { used.add(row.id); used.add(row.pendingImport.targetProjectId); lastImport = Math.max(lastImport, row.position); });
      for (const source of [current, accepted]) for (const values of [source.projects, source.presets]) {
        for (const item of values) yield* effect(1, () => { used.add(item.value.id); });
      }
      yield* reserveLegacyPendingIdentity(current, currentDigest, used); yield* reserveLegacyPendingIdentity(accepted, acceptedDigest, used);
      const projects: StoredProject[] = [], presets: StoredPreset[] = [], pendingImports: StoredPendingImport[] = [];
      for (const item of yield* changedItems(current.projects, accepted.projects)) {
        const id = yield* nextUniqueId('proj_recovered_', used, environment.randomUUID);
        const project = yield* copyEnumerableWork(item.value); delete project.cloud; project.id = id; project.name = `Recovered — ${item.value.name}`;
        const incarnation = yield* effect(1, environment.randomUUID);
        projects.push({ id, project, incarnation, storageRevision: 0, updatedAt });
      }
      for (const item of yield* changedItems(current.presets, accepted.presets)) {
        const id = yield* nextUniqueId('preset_recovered_', used, environment.randomUUID);
        const preset = yield* copyEnumerableWork(item.value); preset.id = id;
        presets.push({ id, preset, position: ++lastPreset });
      }
      if (current.pendingImport && current.pendingImport.digest !== accepted.pendingImport?.digest) {
        const id = yield* nextUniqueId('import_recovered_', used, environment.randomUUID);
        const targetProjectId = yield* nextUniqueId('proj_recovered_import_', used, environment.randomUUID);
        const input = yield* copyEnumerableWork(current.pendingImport.value); delete input.cloud;
        const pendingImport = yield* preparePendingImportWork({ ...input, id, targetProjectId, createdAt: updatedAt }, REJECT_WARNINGS);
        pendingImports.push({ id, pendingImport, position: lastImport + 1 });
      }
      return { projects, presets, pendingImports };
    }
    const copies = work ? await work.run(select()) : runSync(select());
    if (work) owner!.grow((await work.run(rawValueWeightWork(copies))).bytes);
    return { ...copies, release() { owner?.release(); } };
  } catch (error) { owner?.release(); throw error; }
}

export async function createLegacyRecoveryBundle(
  snapshot: LegacySnapshot,
  capturedAt: string,
  subtle: SubtleCrypto = globalThis.crypto.subtle,
): Promise<Blob> {
  validateTimestamp(capturedAt);
  const source = structuredClone(snapshot);
  const bundle: LegacyRecoveryBundle = {
    format: 'doctect.legacy-workspace-recovery',
    version: 1,
    capturedAt,
    entries: LEGACY_DOCUMENT_KEYS.map(key => {
      const entry = readEntry(source, key);
      return {
        key,
        present: entry.present,
        raw: entry.present ? entry.raw : null,
      };
    }),
    digest: await digestLegacySnapshot(source, subtle),
  };
  return new Blob([JSON.stringify(bundle)], { type: RECOVERY_MIME });
}

export function decodeLegacyRecoveryBundle(value: unknown): LegacySnapshot {
  if (!isPlainObject(value)
    || !hasExactKeys(value, ['format', 'version', 'capturedAt', 'entries', 'digest'])
    || value.format !== 'doctect.legacy-workspace-recovery'
    || value.version !== 1
    || typeof value.capturedAt !== 'string'
    || typeof value.digest !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.digest)
    || !Array.isArray(value.entries)
    || value.entries.length !== LEGACY_DOCUMENT_KEYS.length) {
    throw new TypeError('Legacy recovery bundle is malformed.');
  }
  const entries = value.entries.map((entry, index) => {
    if (!isPlainObject(entry)
      || !hasExactKeys(entry, ['key', 'present', 'raw'])
      || entry.key !== LEGACY_DOCUMENT_KEYS[index]
      || typeof entry.present !== 'boolean'
      || (entry.present ? typeof entry.raw !== 'string' : entry.raw !== null)) {
      throw new TypeError('Legacy recovery bundle entry is malformed.');
    }
    return [entry.key, { present: entry.present, raw: entry.raw }];
  });
  return structuredClone(Object.fromEntries(entries) as LegacySnapshot);
}

export function createIndexedDbRecoveryBundle(
  workspace: WorkspaceSnapshot,
  capturedAt: string,
): Blob {
  validateTimestamp(capturedAt);
  const bundle: IndexedDbRecoveryBundle = {
    format: 'doctect.indexeddb-workspace-recovery',
    version: 1,
    capturedAt,
    workspace: structuredClone(workspace),
  };
  return new Blob([JSON.stringify(bundle)], { type: RECOVERY_MIME });
}

export function createProtectedIndexedDbRecoveryBundle(
  workspace: WorkspaceSnapshot,
  capturedAt: string,
): Blob {
  validateTimestamp(capturedAt);
  const workspaceBytes = canonicalStringify(workspace);
  return new Blob([
    '{"format":"doctect.indexeddb-workspace-recovery","version":1,"capturedAt":',
    JSON.stringify(capturedAt),
    ',"workspace":',
    workspaceBytes,
    '}',
  ], { type: RECOVERY_MIME });
}

export async function validateLegacyRecoveryPreparationSources(
  currentSource: LegacySnapshot,
  acceptedSource: LegacySnapshot,
  environment: RecoveryPreparationEnvironment,
): Promise<void> {
  await Promise.all([
    parseLegacySource(structuredClone(currentSource), environment),
    parseLegacySource(structuredClone(acceptedSource), environment),
  ]);
}

export async function prepareLegacyRecovery(
  currentSource: LegacySnapshot,
  currentDigest: string,
  acceptedSource: LegacySnapshot,
  ledger: MigrationLedger,
  records: WorkspaceRecords,
  recoveryId: string,
  environment: RecoveryPreparationEnvironment,
): Promise<PreparedLegacyRecovery> {
  const updatedAt = environment.now();
  validateTimestamp(updatedAt);
  const { projects, presets, pendingImports } = await prepareLegacyRecoveryCopies(structuredClone(currentSource), currentDigest,
    structuredClone(acceptedSource), ledger.acceptedLegacyDigest, records, updatedAt, environment);

  const backup: LegacyBackupRecord = {
    id: `local-storage-to-indexeddb-v1:conflict:${recoveryId}`,
    kind: 'conflict',
    capturedAt: updatedAt,
    snapshot: structuredClone(currentSource),
    digest: currentDigest,
  };
  const workspace: StoredWorkspace = {
    ...records.workspace,
    projectOrder: [
      ...records.workspace.projectOrder,
      ...projects.map(record => record.id),
    ],
    revision: records.workspace.revision + (projects.length > 0 ? 1 : 0),
  };
  const nextLedger: MigrationLedger = {
    ...ledger,
    ledgerRevision: ledger.ledgerRevision + 1,
    acceptedLegacyDigest: currentDigest,
    acceptedLegacyBackupId: backup.id,
    unresolvedRecovery: null,
  };
  const prepared: PreparedLegacyRecovery = {
    recoveryId,
    observedLegacyDigest: currentDigest,
    expectedLedgerRevision: ledger.ledgerRevision,
    expectedAcceptedLegacyDigest: ledger.acceptedLegacyDigest,
    expectedAcceptedLegacyBackupId: ledger.acceptedLegacyBackupId,
    expectedLedger: structuredClone(ledger),
    expectedRecords: structuredClone(records),
    projects,
    workspace,
    presets,
    pendingImports,
    backup,
    ledger: nextLedger,
  };
  await validatePreparedLegacyRecovery(prepared, environment.crypto.subtle);
  return prepared;
}

export async function validatePreparedLegacyRecovery(
  prepared: PreparedLegacyRecovery,
  subtle: SubtleCrypto = globalThis.crypto.subtle,
): Promise<void> {
  reconstructWorkspace(structuredClone(prepared.expectedRecords));
  reconstructWorkspace({
    projects: [
      ...structuredClone(prepared.expectedRecords.projects),
      ...structuredClone(prepared.projects),
    ],
    workspace: structuredClone(prepared.workspace),
    presets: [
      ...structuredClone(prepared.expectedRecords.presets),
      ...structuredClone(prepared.presets),
    ],
    pendingImports: [
      ...structuredClone(prepared.expectedRecords.pendingImports),
      ...structuredClone(prepared.pendingImports),
    ],
  });

  const expectedWorkspace: StoredWorkspace = {
    ...prepared.expectedRecords.workspace,
    projectOrder: [
      ...prepared.expectedRecords.workspace.projectOrder,
      ...prepared.projects.map(record => record.id),
    ],
    revision: prepared.expectedRecords.workspace.revision
      + (prepared.projects.length > 0 ? 1 : 0),
  };
  const expectedLedger: MigrationLedger = {
    ...prepared.expectedLedger,
    ledgerRevision: prepared.expectedLedger.ledgerRevision + 1,
    acceptedLegacyDigest: prepared.observedLegacyDigest,
    acceptedLegacyBackupId: prepared.backup.id,
    unresolvedRecovery: null,
  };
  if (prepared.recoveryId.length === 0
    || prepared.expectedLedgerRevision !== prepared.expectedLedger.ledgerRevision
    || prepared.expectedAcceptedLegacyDigest !== prepared.expectedLedger.acceptedLegacyDigest
    || prepared.expectedAcceptedLegacyBackupId
      !== prepared.expectedLedger.acceptedLegacyBackupId
    || prepared.expectedLedger.unresolvedRecovery?.kind !== 'legacy-drift'
    || prepared.expectedLedger.unresolvedRecovery.id !== prepared.recoveryId
    || prepared.expectedLedger.unresolvedRecovery.observedLegacyDigest
      !== prepared.observedLegacyDigest
    || prepared.backup.kind !== 'conflict'
    || prepared.backup.digest !== prepared.observedLegacyDigest
    || !sameCanonicalValue(prepared.workspace, expectedWorkspace)
    || !sameCanonicalValue(prepared.ledger, expectedLedger)
    || await digestLegacySnapshot(prepared.backup.snapshot, subtle)
      !== prepared.observedLegacyDigest) {
    throw new TypeError('Prepared legacy recovery write set is invalid.');
  }
}
