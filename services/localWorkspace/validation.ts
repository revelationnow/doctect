import type { AppState } from '../../types';
import { inspectAppStateWork, validateAppState, validateAppStateWork } from '../../shared/validateAppState.js';
import { loadProjectState, loadProjectStateWork, loadOwnedProjectStateWork, type ProjectLoadResult } from '../loadProjectState';
import { effect, primitive, runSync, type Work, type Ownership } from '../../shared/cooperativeWork.js';
import { canonicalBytesWork, copyEnumerableWork, compareStringsWork, stableSortWork, JSON_MAX_NESTING } from '../../shared/jsonWork.js';
import { CURRENT_SCHEMA_VERSION } from '../migration';
import { canonicalStringify } from './canonical';
import type {
  WorkspaceCustomPreset,
  WorkspacePendingImport,
  WorkspaceProject,
} from './contracts';

export interface ProjectPreparationOptions {
  warningPolicy: 'reject' | 'retain';
}

export interface CustomPresetValidationOptions extends ProjectPreparationOptions {
  existingIds: ReadonlySet<string>;
}

const DEFAULT_PREPARATION_OPTIONS: ProjectPreparationOptions = { warningPolicy: 'reject' };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

type ValidationMode = 'sync' | 'work' | 'check';

function* canonicalCheck(value: unknown, mode: ValidationMode): Work<number> {
  if (mode === 'sync') { canonicalStringify(value); return 0; }
  // Logical serialized bytes, not a heap measurement or validity receipt.
  return yield* canonicalBytesWork(value);
}

function* inspectJsonObject(value: unknown, label: string, mode: ValidationMode): Work<{
  value: Record<string, unknown>; bytes: number;
}> {
  if (!isPlainObject(value)) throw new Error(`${label} must be a plain object.`);
  let bytes: number;
  try {
    bytes = yield* canonicalCheck(value, mode);
  } catch (error) {
    throw new Error(`${label} must be JSON-compatible: ${(error as Error).message}`, { cause: error });
  }
  if (mode === 'check') return { value, bytes };
  return { value: mode === 'sync' ? structuredClone(value)
    : yield* primitive('clone', () => structuredClone(value)), bytes };
}

const requireNonEmptyString: (
  value: unknown,
  label: string,
) => asserts value is string = (value, label) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
};

const validateCloud = (value: unknown, label: string): void => {
  if (value === undefined) return;
  if (!isPlainObject(value)) throw new Error(`${label} must be an object.`);
  if (typeof value.projectId !== 'string' || typeof value.lastSyncedCommitId !== 'string') {
    throw new Error(`${label} projectId and lastSyncedCommitId must be strings.`);
  }
};

const validateActiveVariant = (state: Record<string, unknown>): void => {
  if (typeof state.activeVariantId !== 'string'
    || !isPlainObject(state.variants)
    || !Object.hasOwn(state.variants, state.activeVariantId)) {
    throw new Error('activeVariantId must reference an existing variant.');
  }
};

const validateWarningPolicy = (options: ProjectPreparationOptions): void => {
  if (options.warningPolicy !== 'reject' && options.warningPolicy !== 'retain') {
    throw new Error('warningPolicy must be reject or retain.');
  }
};

export function validateMigratedState(state: unknown): AppState {
  return runSync(migratedStateTraversal(state, 'sync'));
}

export function* validateMigratedStateWork(state: unknown): Work<AppState> {
  return yield* migratedStateTraversal(state, 'work');
}

export function* checkMigratedStateWork(state: unknown): Work<void> {
  yield* migratedStateTraversal(state, 'check');
}

function* migratedStateTraversal(state: unknown, mode: ValidationMode): Work<AppState> {
  const { value: cloned } = yield* inspectJsonObject(state, 'Migrated project state', mode);
  yield* migratedStateRules(cloned, mode);
  yield* canonicalCheck(cloned, mode);
  return cloned as unknown as AppState;
}

function* migratedStateRules(state: Record<string, unknown>, mode: ValidationMode): Work<void> {
  if (state.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new Error(`Migrated project state must use current schema ${CURRENT_SCHEMA_VERSION}.`);
  }
  const result = mode === 'sync' ? validateAppState(state) : yield* validateAppStateWork(state, 'plain');
  if (!result.ok) throw new Error(`Migrated project state is invalid: ${result.error}`);
  validateActiveVariant(state);
}

export function prepareProjectState(
  raw: unknown,
  options: ProjectPreparationOptions,
): ProjectLoadResult {
  return runSync(projectStateTraversal(raw, options, 'sync'))!;
}

export function* prepareProjectStateWork(raw: unknown, options: ProjectPreparationOptions): Work<ProjectLoadResult> {
  return (yield* projectStateTraversal(raw, options, 'work'))!;
}

function* projectStateTraversal(
  raw: unknown, options: ProjectPreparationOptions, mode: ValidationMode,
): Work<ProjectLoadResult | undefined> {
  validateWarningPolicy(options);
  const inspected = yield* inspectJsonObject(raw, 'Project state', mode);
  let source: Record<string, unknown> | undefined = inspected.value;
  let loaded: ProjectLoadResult | undefined;
  let ownership: Ownership | undefined;
  try {
    if (mode === 'check') {
      // Reserve logical input-image bytes before cloning. Capture the handle in
      // the operation itself so post-operation lifecycle loss still releases it.
      yield { visits: 1, utf8Bytes: 0, run(runtime) { ownership = runtime?.own(inspected.bytes); } };
      source = yield* primitive('clone', () => structuredClone(inspected.value));
    }
    yield* beforeLoadRules(source, mode);

    loaded = mode === 'check' ? yield* loadOwnedProjectStateWork(source)
      : mode === 'sync' ? loadProjectState(structuredClone(source))
        : yield* loadProjectStateWork(yield* primitive('clone', () => structuredClone(source)), 'plain');
    source = undefined;
    if (options.warningPolicy === 'reject' && loaded.warnings.length > 0) {
      throw new Error(loaded.warnings.join(' '));
    }
    const state = yield* migratedStateTraversal(loaded.state, mode);
    if (mode === 'check') return;
    const warnings: string[] = [];
    for (const warning of loaded.warnings) {
      if (mode === 'sync') warnings.push(warning);
      else yield* effect(1, () => { warnings.push(warning); });
    }
    return { state, warnings };
  } finally {
    source = undefined;
    loaded = undefined;
    ownership?.release();
  }
}

function* beforeLoadRules(source: Record<string, unknown>, mode: ValidationMode): Work<void> {
  const schemaVersion = Object.hasOwn(source, 'schemaVersion') ? source.schemaVersion : 0;
  if (!Number.isInteger(schemaVersion) || (schemaVersion as number) < 0) {
    throw new Error('Project state schemaVersion must be a non-negative integer.');
  }
  if ((schemaVersion as number) > CURRENT_SCHEMA_VERSION) {
    throw new Error(`Cannot load future schema version ${schemaVersion}.`);
  }

  if ((schemaVersion as number) >= 10) {
    const sourceResult = mode === 'sync' ? validateAppState(source) : yield* validateAppStateWork(source, 'plain');
    if (!sourceResult.ok) {
      throw new Error(`Project state is invalid before migration: ${sourceResult.error}`);
    }
    validateActiveVariant(source);
  }
}

export function validateWorkspaceProject(
  raw: unknown,
  options: ProjectPreparationOptions = DEFAULT_PREPARATION_OPTIONS,
): WorkspaceProject {
  return runSync(workspaceProjectTraversal(raw, options, 'sync'))!;
}

export function* validateWorkspaceProjectWork(raw: unknown, options = DEFAULT_PREPARATION_OPTIONS): Work<WorkspaceProject> {
  return (yield* workspaceProjectTraversal(raw, options, 'work'))!;
}

export function* checkWorkspaceProjectWork(raw: unknown, options = DEFAULT_PREPARATION_OPTIONS): Work<void> {
  yield* workspaceProjectTraversal(raw, options, 'check');
}

/** Check one immutable captured stored payload; never return its disposable loaded state. */
export function* checkStoredWorkspaceProjectWork(raw: unknown): Work<void> {
  let state: unknown;
  // Preserve entry Get behavior, but do not return an unvalidated value to the
  // Work runtime's thenable check. Canonical inspection owns descriptor safety.
  yield* effect(6, () => {
    if (!isPlainObject(raw)) throw new Error('Project payload must be an object.');
    state = raw.initialState;
  });
  const inspected = yield* inspectStoredStateWork(state);
  yield* checkStoredEnvelopeWork(raw as Record<string, unknown>, state, inspected.maximumDepth);
  let source: Record<string, unknown> | undefined;
  let loaded: ProjectLoadResult | undefined;
  let ownership: Ownership | undefined;
  try {
    // Register the lease inside the operation, before its post-operation guard.
    yield { visits: 1, utf8Bytes: 0, run(runtime) { ownership = runtime?.own(inspected.bytes); } };
    source = yield* primitive('clone', () => structuredClone(state as Record<string, unknown>));
    // Native cloning can change representation (for example hidden array
    // indices become holes). Keep validation on this distinct pre-loader graph.
    yield* beforeLoadRules(source, 'check');
    loaded = yield* loadOwnedProjectStateWork(source);
    source = undefined;
    if (loaded.warnings.length > 0) throw new Error(loaded.warnings.join(' '));
    yield* inspectStoredStateWork(loaded.state);
  } finally {
    source = undefined;
    loaded = undefined;
    state = undefined;
    ownership?.release();
  }
}

function* inspectStoredStateWork(state: unknown): Work<{ bytes: number; maximumDepth: number }> {
  if (!isPlainObject(state)) throw new Error('Migrated project state must be a plain object.');
  const inspected = yield* inspectAppStateWork(state, CURRENT_SCHEMA_VERSION);
  if ('jsonError' in inspected) throw new Error(`Migrated project state must be JSON-compatible: ${(inspected.jsonError as Error).message}`, { cause: inspected.jsonError });
  if (!inspected.schemaMatches) throw new Error(`Migrated project state must use current schema ${CURRENT_SCHEMA_VERSION}.`);
  if (!inspected.result!.ok) throw new Error(`Migrated project state is invalid: ${inspected.result!.error}`);
  validateActiveVariant(state); return inspected;
}

/** The state was inspected in this same immutable-capture program. Only that
 * exact field reuses its facts; extensions/aliases retain their own ancestry. */
function* checkStoredEnvelopeWork(raw: Record<string, unknown>, state: unknown, stateDepth: number): Work<void> {
  if (!isPlainObject(raw)) throw new Error('Workspace project must be a plain object.');
  const rejectJson = (message: string) => { throw new TypeError(`Value must be JSON-compatible: ${message}`); };
  try {
    const keys = yield* primitive('keys', () => Reflect.ownKeys(raw));
    for (const key of keys) yield* effect(1, () => { if (typeof key === 'symbol') rejectJson('symbol keys are not supported'); });
    for (const key of yield* stableSortWork(keys as string[], compareStringsWork)) {
      const descriptor = yield* effect(1, () => Object.getOwnPropertyDescriptor(raw, key));
      if (!descriptor || !('value' in descriptor)) rejectJson('getters and setters are not supported');
      if (!descriptor.enumerable) rejectJson('non-enumerable properties are not supported');
      if (key === 'initialState' && descriptor.value === state) {
        if (stateDepth + 1 > JSON_MAX_NESTING) rejectJson(`nesting exceeds ${JSON_MAX_NESTING}`);
      } else yield* canonicalBytesWork(descriptor.value, { nesting: 1, parent: raw });
    }
  } catch (error) { throw new Error(`Workspace project must be JSON-compatible: ${(error as Error).message}`, { cause: error }); }
  requireNonEmptyString(raw.id, 'Workspace project id');
  if (typeof raw.name !== 'string') throw new Error('Workspace project name must be a string.');
  validateCloud(raw.cloud, 'Workspace project cloud metadata');
  if (raw.revision !== undefined && (!Number.isInteger(raw.revision) || (raw.revision as number) < 0)) throw new Error('Workspace project revision must be a non-negative integer.');
}

function* workspaceProjectTraversal(raw: unknown, options: ProjectPreparationOptions, mode: ValidationMode): Work<WorkspaceProject | undefined> {
  const project = yield* workspaceProjectRecord(raw, mode);
  const prepared = yield* projectStateTraversal(project.initialState, options, mode);
  if (mode === 'check') return;
  const result = mode === 'sync' ? { ...project } : yield* copyEnumerableWork(project);
  result.initialState = prepared!.state;
  return result as WorkspaceProject;
}

function* workspaceProjectRecord(raw: unknown, mode: ValidationMode): Work<Record<string, unknown>> {
  const { value: project } = yield* inspectJsonObject(raw, 'Workspace project', mode);
  requireNonEmptyString(project.id, 'Workspace project id');
  if (typeof project.name !== 'string') throw new Error('Workspace project name must be a string.');
  validateCloud(project.cloud, 'Workspace project cloud metadata');
  if (project.revision !== undefined
    && (!Number.isInteger(project.revision) || (project.revision as number) < 0)) {
    throw new Error('Workspace project revision must be a non-negative integer.');
  }
  return project;
}

export function validatePreparedWorkspaceProject(raw: unknown): WorkspaceProject {
  return runSync(preparedProjectTraversal(raw, 'sync'));
}

export function* validatePreparedWorkspaceProjectWork(raw: unknown): Work<WorkspaceProject> {
  return yield* preparedProjectTraversal(raw, 'work');
}

function* preparedProjectTraversal(raw: unknown, mode: ValidationMode): Work<WorkspaceProject> {
  const project = yield* workspaceProjectRecord(raw, mode);
  const result = mode === 'sync' ? { ...project } : yield* copyEnumerableWork(project);
  result.initialState = yield* migratedStateTraversal(project.initialState, mode);
  return result as WorkspaceProject;
}

export function validateCustomPreset(
  raw: unknown,
  options: CustomPresetValidationOptions,
): WorkspaceCustomPreset {
  return runSync(customPresetTraversal(raw, options, 'sync'))!;
}

export function* validateCustomPresetWork(raw: unknown, options: CustomPresetValidationOptions): Work<WorkspaceCustomPreset> {
  return (yield* customPresetTraversal(raw, options, 'work'))!;
}

export function* checkCustomPresetWork(raw: unknown, options: CustomPresetValidationOptions): Work<void> {
  yield* customPresetTraversal(raw, options, 'check');
}

function* customPresetTraversal(raw: unknown, options: CustomPresetValidationOptions, mode: ValidationMode): Work<WorkspaceCustomPreset | undefined> {
  if (!options?.existingIds || typeof options.existingIds.has !== 'function') {
    throw new Error('Custom preset validation requires existingIds uniqueness context.');
  }
  const { value: preset } = yield* inspectJsonObject(raw, 'Custom preset', mode);
  requireNonEmptyString(preset.id, 'Custom preset id');
  if (options.existingIds.has(preset.id)) {
    throw new Error(`Duplicate custom preset id: ${preset.id}.`);
  }
  if (typeof preset.title !== 'string') throw new Error('Custom preset title must be a string.');
  if (typeof preset.desc !== 'string') throw new Error('Custom preset description must be a string.');
  if (preset.color !== undefined && typeof preset.color !== 'string') {
    throw new Error('Custom preset color must be a string.');
  }
  if (preset.isCustom !== true) throw new Error('Custom preset isCustom must be true.');
  const prepared = yield* projectStateTraversal(preset.initialState, options, mode);
  if (mode === 'check') return;
  const result = mode === 'sync' ? { ...preset } : yield* copyEnumerableWork(preset);
  result.initialState = prepared!.state;
  return result as WorkspaceCustomPreset;
}

const PENDING_IMPORT_KEYS = new Set([
  'id',
  'targetProjectId',
  'name',
  'state',
  'cloud',
  'createdAt',
]);

export function preparePendingImport(
  raw: unknown,
  options: ProjectPreparationOptions,
): WorkspacePendingImport {
  return runSync(pendingImportTraversal(raw, options, 'sync'))!;
}

export function* preparePendingImportWork(raw: unknown, options: ProjectPreparationOptions): Work<WorkspacePendingImport> {
  return (yield* pendingImportTraversal(raw, options, 'work'))!;
}

export function* checkPendingImportWork(raw: unknown, options: ProjectPreparationOptions): Work<void> {
  yield* pendingImportTraversal(raw, options, 'check');
}

function* pendingImportTraversal(raw: unknown, options: ProjectPreparationOptions, mode: ValidationMode): Work<WorkspacePendingImport | undefined> {
  const { value: input } = yield* inspectJsonObject(raw, 'Pending import', mode);
  const keys = mode === 'sync' ? Object.keys(input) : yield* primitive('keys', () => Object.keys(input));
  let unknownKey: string | undefined;
  for (const key of keys) {
    if (mode !== 'sync') yield* effect(1, () => {});
    if (!PENDING_IMPORT_KEYS.has(key)) { unknownKey = key; break; }
  }
  if (unknownKey) throw new Error(`Pending import contains unknown field: ${unknownKey}.`);
  requireNonEmptyString(input.id, 'Pending import id');
  requireNonEmptyString(input.targetProjectId, 'Pending import targetProjectId');
  if (typeof input.name !== 'string') throw new Error('Pending import name must be a string.');
  validateCloud(input.cloud, 'Pending import cloud metadata');
  if (typeof input.createdAt !== 'string') {
    throw new Error('Pending import createdAt must be an ISO timestamp.');
  }
  const createdAt = mode === 'sync' ? new Date(input.createdAt)
    : yield* primitive('scalar', () => new Date(input.createdAt as string));
  if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== input.createdAt) {
    throw new Error('Pending import createdAt must be a canonical ISO timestamp.');
  }

  const prepared = yield* projectStateTraversal(input.state, options, mode);
  if (mode === 'check') return;
  return {
    id: input.id,
    targetProjectId: input.targetProjectId,
    name: input.name,
    ...(input.cloud === undefined ? {} : { cloud: input.cloud }),
    createdAt: input.createdAt,
    state: prepared!.state,
    warnings: prepared!.warnings,
  } as WorkspacePendingImport;
}
