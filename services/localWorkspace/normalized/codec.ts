import type { AppState, PageTemplate, Variant } from '../../../types';
import { validateAppState, validateAppStateWork } from '../../../shared/validateAppState.js';
import { APP_STATE_FIELD_CLASSIFICATION, assembleStateWork, partitionStateWork, type PartitionProjectionEvent } from '../../document/partition';
import type { DocumentState, EditorPreferences, PartitionedState } from '../../document/contracts';
import { CURRENT_SCHEMA_VERSION } from '../../migration';
import { canonicalStringify } from '../canonical';
import { createSizeLedgerWork } from './sizeLedger';
import { createEmissionBuilder, disposeEmissionPlan, type EmissionBuilder, type EmissionPlan, type EmissionRecipe, type SourceAddress } from './emissionPlan';
import { validateAuthorityPairWork, validateLineage, validateLineageWork } from './commitProof';
import { assertWorkRuntime, effect, primitive, retainWork, runSync, type Operation, type Ownership, type Work, type WorkRuntime } from '../../../shared/cooperativeWork.js';
import { canonicalBytesWork, compareStringsWork, enumerableEntriesWork, jsonTextWork, plainJsonBytesWork, rawValueWeightWork, utf8LengthWork } from '../../../shared/jsonWork.js';
import type { WorkspaceProject } from '../contracts';
import { createWorkspaceRecordValidator, validateWorkspaceRecordsWork, type WorkspaceRecordCandidates, type WorkspaceRecords } from '../migration';
import type { StoredProject } from '../schema';
import {
  NORMALIZED_DB_VERSION, NORMALIZED_STORE_NAMES, NORMALIZATION_LEDGER_ID,
  type NormalizationSource, type TaggedNormalizedRecord,
  type ExtensionKey, type NormalizedProject, type NormalizedRecord, type NormalizedRecordTypes,
  type ProjectKey, type ProjectScope, type ProjectStoreName,
} from './schema';

export type TargetRecord = Exclude<TaggedNormalizedRecord, { store: 'normalizationLedger' }>;
export interface TargetCursor {
  next(): Work<IteratorResult<TargetRecord, void>>;
  dispose(): void;
}
export interface PlannedTargetCursor extends TargetCursor { takeEmissionPlan(): EmissionPlan }
export interface SourceTargetCursors {
  create(source: NormalizationSource): TargetCursor;
  plan(source: NormalizationSource): PlannedTargetCursor;
}
type SourceProject = NormalizationSource['records']['projects'][number];
interface SourceProjection {
  check(runtime: WorkRuntime | undefined): void;
  project(stored: SourceProject, scope: ProjectScope, trace?: CodecProjectionRecorder): Work<NormalizedProject>;
  beforeTake(): void;
  taken(plan: EmissionPlan): void;
}

/** Own one source validation/target projection scope, never a reusable verdict.
 * The caller owns this immutable capture; every independent read calls anew. */
export async function withSourceRecords<T>(input: WorkspaceRecordCandidates, work: WorkRuntime,
  consume: (records: WorkspaceRecords, cursors: SourceTargetCursors) => Promise<T>): Promise<T> {
  assertWorkRuntime(work);
  const phase = work.context().phase;
  let bindings: Map<SourceProject, { project: WorkspaceProject; ordinal: number }> | undefined = new Map();
  let projects: unknown[] | undefined, projectCount = 0, reusable = true, closed = false, consuming = false, succeeded = false;
  let records: WorkspaceRecords | undefined;
  let targetSource: NormalizationSource | undefined;
  let owner: Ownership | undefined, cursor: TargetCursor | undefined, provisionalPlan: EmissionPlan | undefined;
  let transferFailure: { error: unknown } | undefined;
  const current = () => {
    if (closed) throw Error('Source capture scope closed');
    work.assertCurrent();
    if (transferFailure) throw transferFailure.error;
    if (work.context().phase !== phase) throw Error('Source capture phase changed');
  };
  const available = () => { current(); if (!consuming) throw Error('Source capture consumer scope closed'); };
  const checkSourceRoot = (source: NormalizationSource) => {
    const descriptor = Object.getOwnPropertyDescriptor(source, 'records');
    if (!descriptor || !('value' in descriptor) || descriptor.value !== records) throw Error('Foreign source capture');
  };
  const checkProject = (stored: SourceProject) => {
    const binding = bindings!.get(stored), project = Object.getOwnPropertyDescriptor(stored, 'project');
    const entry = binding && Object.getOwnPropertyDescriptor(projects!, binding.ordinal);
    if (!binding || !entry || !('value' in entry) || entry.value !== stored
      || !project || !('value' in project) || project.value !== binding.project) throw Error('Source project capture changed');
    return binding.project;
  };
  try {
    await work.run(effect(1, () => {
      owner = work.own(24);
      const descriptor = input && typeof input === 'object' ? Object.getOwnPropertyDescriptor(input, 'projects') : undefined;
      if (descriptor && 'value' in descriptor && Array.isArray(descriptor.value)) { projects = descriptor.value; projectCount = projects!.length; }
      else reusable = false;
    }));
    // Capture descriptors before validation. A later replacement cannot acquire
    // the verdict for a graph the validator never saw. Do not invoke accessors.
    if (projects) for (let index = 0; index < projects.length; index++) await work.run(effect(3, () => {
      const entry = Object.getOwnPropertyDescriptor(projects!, index);
      const row = entry && 'value' in entry ? entry.value : undefined;
      const project = row && typeof row === 'object' ? Object.getOwnPropertyDescriptor(row, 'project') : undefined;
      if (project && 'value' in project) { owner!.grow(64); bindings!.set(row, { project: project.value, ordinal: index }); }
      else reusable = false;
    }));
    records = await work.run(validateWorkspaceRecordsWork(input));
    const checkProjects = () => {
      const rows = Object.getOwnPropertyDescriptor(records!, 'projects');
      if (projects && (!rows || !('value' in rows) || rows.value !== projects || projects.length !== projectCount)) throw Error('Source project array changed');
    };
    const make = (source: NormalizationSource, recording: boolean) => {
      available();
      if (cursor) throw Error('Source capture already has a target cursor');
      let active: SourceProject | undefined;
      const checkSource = () => {
        checkSourceRoot(source);
        checkProjects(); if (active) checkProject(active);
      };
      checkSource(); targetSource = source;
      const projection: SourceProjection = {
        check(runtime) {
          if (runtime !== work) throw Error('Foreign source capture runtime');
          available(); checkSource();
        },
        *project(stored, scope, trace) {
          if (!reusable) return yield* decomposeWork(stored.project, scope, true, trace);
          let project!: WorkspaceProject;
          yield* effect(2, () => {
            checkSource(); active = stored; project = checkProject(stored);
          });
          yield* checkProjectScopeWork(project, scope);
          return yield* projectWork(project, scope, true, trace);
        },
        beforeTake() { available(); checkSource(); },
        taken(plan) {
          provisionalPlan = plan;
          try { available(); checkSource(); }
          catch (error) { transferFailure = { error }; throw error; }
        },
      };
      cursor = recording ? targetCursor(source, true, true, projection) : targetCursor(source, true, false, projection);
      return cursor;
    };
    consuming = true;
    const result = await work.wait(async () => {
      try { return await consume(records!, {
        create: source => make(source, false), plan: source => make(source, true) as PlannedTargetCursor,
      }); }
      finally { consuming = false; }
    });
    // Completed projects may no longer be the active cursor image. Check their
    // shallow bindings cooperatively before provisional output can escape scope.
    await work.run((function* (): Work<void> {
      yield* effect(3, () => { current(); if (targetSource) checkSourceRoot(targetSource); checkProjects(); });
      if (reusable) for (const stored of bindings!.keys()) yield* effect(3, () => { checkProject(stored); });
    })());
    current(); succeeded = true; return result;
  } finally {
    consuming = false; closed = true;
    try { cursor?.dispose(); }
    finally {
      if (!succeeded && provisionalPlan) disposeEmissionPlan(provisionalPlan);
      bindings = undefined; provisionalPlan = undefined; targetSource = undefined; projects = undefined; records = undefined; input = undefined as never; owner?.release();
    }
  }
}

export function createTargetCursor(source: NormalizationSource): TargetCursor {
  return targetCursor(source, true);
}
export function createPlannedTargetCursor(source: NormalizationSource): PlannedTargetCursor {
  return targetCursor(source, true, true);
}
function targetCursor(source: NormalizationSource, cooperative: boolean, recording: true, projection?: SourceProjection): PlannedTargetCursor;
function targetCursor(source: NormalizationSource, cooperative: boolean, recording?: false, projection?: SourceProjection): TargetCursor;
function targetCursor(source: NormalizationSource, cooperative: boolean, recording = false, projection?: SourceProjection): TargetCursor | PlannedTargetCursor {
  let input: NormalizationSource | undefined = source;
  let index: Map<string, NormalizationSource['records']['projects'][number]> | undefined;
  let current: NormalizedProject | undefined;
  let imageLease: Ownership | undefined;
  let indexLease: Ownership | undefined;
  let sourceOrdinals: WeakMap<NormalizationSource['records']['projects'][number], number> | undefined;
  let builder: EmissionBuilder | undefined; let recorder: CodecProjectionRecorder | undefined; let finished = false;
  let disposed = false; let running = false;
  function* produce(): Generator<Operation | TargetRecord, void, unknown> {
    try {
      index = new Map();
      if (cooperative) indexLease = yield* retainWork(0);
      if (recording) yield* effect(1, () => {
        indexLease!.grow(24); sourceOrdinals = new WeakMap(); builder = createEmissionBuilder(input!);
      });
      for (let ordinal = 0; ordinal < input!.records.projects.length; ordinal++) {
        const stored = input!.records.projects[ordinal];
        const added = yield* effect(1, () => {
          if (index!.has(stored.id)) return false;
          index!.set(stored.id, stored); sourceOrdinals?.set(stored, ordinal); return true;
        });
        if (added && cooperative) {
          const bytes = 16 + (recording ? 16 : 0) + (yield* utf8LengthWork(stored.id));
          yield* effect(1, () => indexLease!.grow(bytes));
        }
      }
      const attemptId = `normalization:${input!.sourceDigest}`;
      const storageGeneration = `normalized:${input!.sourceDigest}`;
      for (const identity of input!.sourceProjects) {
        const stored = index.get(identity.projectId)!;
        if (cooperative) imageLease = yield* retainWork(0);
        if (builder) yield* effect(1, () => { recorder = createCodecProjectionRecorder(builder!, input!, sourceOrdinals!.get(stored)!); });
        const scope = { storageGeneration, projectId: stored.id, incarnation: stored.incarnation };
        current = projection ? yield* projection.project(stored, scope, recorder) : yield* decomposeWork(stored.project, scope, cooperative, recorder);
        const header = current.projectHeaders.values().next().value!;
        header.storageRevision = stored.storageRevision; header.updatedAt = stored.updatedAt;
        header.commitWindow = { floorRevision: stored.storageRevision, entries: [] };
        header.migrationBaseline = { migrationId: NORMALIZATION_LEDGER_ID, attemptId, storageGeneration,
          sourceDigest: input!.sourceDigest, projectDigest: identity.digest, projectId: stored.id,
          incarnation: stored.incarnation, sourceRevision: stored.storageRevision, sourceUpdatedAt: stored.updatedAt };
        if (cooperative) {
          const weight = yield* rawValueWeightWork(current);
          yield* effect(1, () => imageLease!.grow(weight.bytes));
        }
        for (const store of NORMALIZED_STORE_NAMES) {
          if (store === 'normalizationLedger') continue;
          for (const record of current[store].values()) {
            if (recorder) yield* recorder.finishRecord({ store, record } as TargetRecord);
            yield* effect(1, () => {});
            yield { store, record } as TargetRecord;
          }
        }
        current = undefined;
        recorder?.dispose(); recorder = undefined;
        imageLease?.release(); imageLease = undefined;
      }
      finished = true;
    } finally {
      current = undefined; index = undefined; input = undefined; sourceOrdinals = undefined;
      recorder?.dispose(); recorder = undefined;
      if (!finished) { builder?.dispose(); builder = undefined; }
      imageLease?.release(); imageLease = undefined; indexLease?.release(); indexLease = undefined;
    }
  }
  let program: ReturnType<typeof produce> | undefined = produce();
  const dispose = () => {
    disposed = true; program?.return(); program = undefined; current = undefined; index = undefined; input = undefined;
    recorder?.dispose(); recorder = undefined; builder?.dispose(); builder = undefined; sourceOrdinals = undefined;
    projection = undefined;
  };
  const cursor: TargetCursor = {
    *next(): Work<IteratorResult<TargetRecord, void>> {
      if (disposed) throw new Error('Target cursor disposed');
      if (running) throw new Error('Target cursor already running');
      if (!program && !projection) return { done: true, value: undefined };
      running = true; let completed = false;
      try {
        if (projection) yield { visits: 1, utf8Bytes: 0, run(runtime) { projection.check(runtime); } };
        if (!program) { completed = true; return { done: true, value: undefined }; }
        let result: unknown;
        for (;;) {
          const step = program.next(result);
          if (step.done === true) { program = undefined; completed = true; return { done: true, value: undefined }; }
          if ('store' in step.value) { completed = true; return { done: false, value: step.value }; }
          const operation = step.value;
          result = yield { ...operation, run(runtime) {
            projection?.check(runtime);
            if (disposed) throw new Error('Target cursor disposed');
            return operation.run(runtime);
          } };
        }
      } finally { running = false; if (!completed) dispose(); }
    },
    dispose,
  };
  return recording ? { ...cursor, takeEmissionPlan() {
    if (disposed || running || !finished || !builder) throw new Error('Target emission plan incomplete or already transferred');
    projection?.beforeTake();
    const plan = builder.finish(); builder = undefined; projection?.taken(plan); return plan;
  } } : cursor;
}

/** Deterministic bulk preparation only. Neither this plan nor its baseline grants authority. */
export function prepareNormalizationTarget(source: NormalizationSource): Exclude<TaggedNormalizedRecord, { store: 'normalizationLedger' }>[] {
  const cursor = targetCursor(source, false); const target: TargetRecord[] = [];
  try {
    for (;;) {
      const next = runSync(cursor.next());
      if (next.done === true) return target;
      target.push(next.value);
    }
  } finally { cursor.dispose(); }
}

const own = (value: object, key: PropertyKey) => Object.hasOwn(value, key);
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Unrecognized normalized project: ${message}.`);
}
const bytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const define = (target: object, key: string, value: unknown) => Object.defineProperty(target, key,
  { value, enumerable: true, configurable: true, writable: true });
function* sizeWork(value: unknown, cooperative: boolean): Work<number> {
  return cooperative ? yield* plainJsonBytesWork(value) : bytes(value);
}
function* keyWork(value: unknown, cooperative: boolean): Work<string> {
  return cooperative ? yield* jsonTextWork(value) : JSON.stringify(value);
}
function* canonicalCheckWork(value: unknown, cooperative: boolean): Work<number | undefined> {
  if (cooperative) return yield* canonicalBytesWork(value);
  canonicalStringify(value); return undefined;
}
function* equalWork(left: unknown, right: unknown): Work<boolean> {
  return typeof left === 'string' && typeof right === 'string'
    ? (yield* compareStringsWork(left, right)) === 0 : left === right;
}
function* selectWork(value: object, fields: readonly string[], omit = false, recordField?: (key: string) => Work<void>): Work<Record<string, unknown>> {
  const result = {};
  for (const [key, item] of yield* enumerableEntriesWork(value as Record<string, unknown>)) {
    const selected = yield* effect(1, () => {
      if (fields.includes(key) === omit) return false;
      define(result, key, item); return true;
    });
    if (selected && recordField) yield* recordField(key);
  }
  return result;
}
const wrapperFields = ['id', 'name', 'cloud', 'revision'];
const variantFields = ['id', 'name'];
const cloudFields = ['projectId', 'lastSyncedCommitId'];
const preferenceFields = Object.entries(APP_STATE_FIELD_CLASSIFICATION).filter(([, owner]) => owner === 'preference').map(([key]) => key);
const documentFields = Object.entries(APP_STATE_FIELD_CLASSIFICATION).filter(([, owner]) => owner === 'document').map(([key]) => key);

interface CodecProjectionRecorder {
  readonly builder: EmissionBuilder; readonly projectAddress: SourceAddress;
  partition(event: PartitionProjectionEvent): Work<void>;
  partitioned(parts: PartitionedState): Work<void>;
  selected(result: object, sourceAddress: SourceAddress, fields: readonly string[], overrides?: ReadonlyMap<string, EmissionRecipe>): Work<void>;
  payload(result: object, recipe: EmissionRecipe): void;
  recipe(result: object): EmissionRecipe;
  template(result: object, original: object): void;
  finishRecord(item: TargetRecord): Work<void>;
  dispose(): void;
}
/** Metadata-only selection capture; recorded at the real selectWork branch. */
function selectionCapture() {
  const keys: string[] = []; let lease: Ownership | undefined;
  return { keys,
    *record(key: string): Work<void> {
      if (!lease) { lease = yield* retainWork(0); yield* effect(1, () => lease!.grow(24)); }
      const bytes = yield* utf8LengthWork(key);
      yield* effect(1, () => { lease!.grow(8 + bytes); keys.push(key); });
    },
    dispose() { keys.length = 0; lease?.release(); lease = undefined; },
  };
}
function* selectedWork(value: object, fields: readonly string[], omit: boolean,
  trace?: CodecProjectionRecorder, address?: SourceAddress): Work<Record<string, unknown>> {
  if (!trace) return yield* selectWork(value, fields, omit);
  const capture = selectionCapture();
  try {
    const result = yield* selectWork(value, fields, omit, capture.record);
    yield* trace.selected(result, address!, capture.keys); return result;
  } finally { capture.dispose(); }
}
function* selectHeaderWork(project: WorkspaceProject, trace?: CodecProjectionRecorder): Work<NormalizedRecordTypes['projectHeaders']['value']> {
  const capture = trace ? selectionCapture() : undefined;
  try {
    const value = (yield* selectWork(project, wrapperFields, false, capture?.record)) as NormalizedRecordTypes['projectHeaders']['value'];
    if (project.cloud) value.cloud = (yield* selectedWork(project.cloud, cloudFields, false, trace,
      trace ? [...trace.projectAddress, 'cloud'] : undefined)) as WorkspaceProject['cloud'];
    if (trace) yield* trace.selected(value, trace.projectAddress, capture!.keys,
      project.cloud ? new Map([['cloud', trace.recipe(value.cloud!)]]) : undefined);
    return value;
  } finally { capture?.dispose(); }
}
/** Fixed private envelope metadata only. Never pass a record's value/document. */
function* privateMetadataRecipeWork(builder: EmissionBuilder, value: unknown): Work<EmissionRecipe> {
  if (value === null) return yield* builder.literal(null);
  if (typeof value === 'string' || typeof value === 'boolean'
    || typeof value === 'number' && Number.isFinite(value)) return yield* builder.literal(value);
  const owner = yield* retainWork(0);
  try {
    yield* effect(1, () => owner.grow(24));
    if (Array.isArray(value)) {
      const present: [number, EmissionRecipe][] = [];
      for (let index = 0; index < value.length; index++) {
        const exists = yield* effect(1, () => Object.hasOwn(value, index)); if (!exists) continue;
        const child = yield* privateMetadataRecipeWork(builder, value[index]);
        yield* effect(1, () => { owner.grow(24); present.push([index, child]); });
      }
      return yield* builder.array(value.length, present);
    }
    if (value && typeof value === 'object') {
      const fields: [string, EmissionRecipe][] = [];
      const keys = yield* primitive('keys', () => { const result = Object.keys(value); owner.grow(24 + result.length * 8); return result; });
      for (const key of keys) {
        const bytes = yield* utf8LengthWork(key);
        const child = yield* privateMetadataRecipeWork(builder, Reflect.get(value, key));
        yield* effect(1, () => { owner.grow(24 + bytes); fields.push([key, child]); });
      }
      return yield* builder.object(fields);
    }
    throw new Error('Invalid private emission metadata');
  } finally { owner.release(); }
}
function createCodecProjectionRecorder(builder: EmissionBuilder, source: NormalizationSource, rowOrdinal: number): CodecProjectionRecorder {
  let project: WorkspaceProject | undefined = source.records.projects[rowOrdinal].project;
  const projectAddress: SourceAddress = ['records', 'projects', rowOrdinal, 'project'];
  const stateAddress = [...projectAddress, 'initialState'];
  let lease: Ownership | undefined;
  let values: WeakMap<object, EmissionRecipe> | undefined;
  let templates: WeakMap<object, EmissionRecipe> | undefined;
  let preferences: [string, EmissionRecipe][] = [], compatibility: [string, EmissionRecipe][] = [];
  let booleans: [string, EmissionRecipe][] = [], exceptions: [string, EmissionRecipe][] = [];
  function* enter(): Work<void> {
    if (!lease) {
      lease = yield* retainWork(0);
      yield* effect(1, () => {
        // Root/path handles, four entry lists, two weak indexes and bounded current-path scratch.
        lease!.grow(4 * 24 + 2 * 24 + 2 * (24 + 5 * 8) + 3 * (24 + 12 * 8));
        values = new WeakMap(); templates = new WeakMap();
      });
    }
  }
  function* entry(list: [string, EmissionRecipe][], key: string, recipe: EmissionRecipe): Work<void> {
    const bytes = yield* utf8LengthWork(key);
    yield* effect(1, () => { lease!.grow(24 + bytes); list.push([key, recipe]); });
  }
  function* sourcedObject(address: SourceAddress, fields: readonly string[], overrides?: ReadonlyMap<string, EmissionRecipe>): Work<EmissionRecipe> {
    const temporary = yield* retainWork(0); const entries: [string, EmissionRecipe][] = [];
    try {
      yield* effect(1, () => temporary.grow(24));
      for (const key of fields) {
        const recipe = overrides?.get(key) ?? (yield* builder.borrow([...address, key]));
        yield* effect(1, () => { temporary.grow(24); entries.push([key, recipe]); });
      }
      return yield* builder.object(entries);
    } finally { temporary.release(); }
  }
  const recorder: CodecProjectionRecorder = {
    builder, projectAddress,
    *partition(event) {
      yield* enter();
      if (event.kind === 'state-field') {
        if (event.owner === 'document') return;
        yield* entry(event.owner === 'preference' ? preferences : compatibility, event.field,
          yield* builder.borrow([...stateAddress, event.field]));
        return;
      }
      const address = [...stateAddress, 'variants', event.variantId, 'templates', event.templateId];
      const projection = event.projection; let recipe: EmissionRecipe;
      if (projection.kind === 'borrow') recipe = yield* builder.borrow(address);
      else {
        const temporary = yield* retainWork(0); const present: [number, EmissionRecipe][] = [];
        try {
          yield* effect(1, () => temporary.grow(48));
          for (const cell of projection.present) {
            const from = [...address, 'layers', cell.index];
            const child = cell.fieldOrder === null ? yield* builder.borrow(from) : yield* sourcedObject(from, cell.fieldOrder);
            yield* effect(1, () => { temporary.grow(24); present.push([cell.index, child]); });
          }
          const layers = yield* builder.array(projection.length, present);
          recipe = yield* sourcedObject(address, projection.fieldOrder, new Map([['layers', layers]]));
          for (const fold of projection.folds) {
            const raw = yield* builder.borrow([...address, 'layers', fold.index, 'collapsed']);
            yield* entry(fold.owner === 'boolean' ? booleans : exceptions, fold.key,
              fold.owner === 'boolean' ? raw : yield* builder.object([['value', raw]]));
          }
        } finally { temporary.release(); }
      }
      yield* effect(3, () => {
        lease!.grow(24); templates!.set(project!.initialState.variants[event.variantId].templates[event.templateId], recipe);
      });
    },
    *partitioned(parts) {
      yield* enter();
      const state = yield* builder.object(compatibility); const folds = yield* builder.object(exceptions);
      yield* entry(preferences, 'layerCollapsed', yield* builder.object(booleans));
      yield* entry(preferences, 'panelsExpanded', yield* builder.object([]));
      const prefs = yield* builder.object(preferences);
      yield* effect(3, () => {
        recorder.payload(parts.compatibility.state as object, state);
        recorder.payload(parts.compatibility.layerCollapsedExceptions as object, folds); recorder.payload(parts.preferences, prefs);
      });
    },
    *selected(result, address, fields, overrides) {
      yield* enter(); const recipe = yield* sourcedObject(address, fields, overrides);
      yield* effect(1, () => recorder.payload(result, recipe));
    },
    payload(result, recipe) { lease!.grow(24); values!.set(result, recipe); },
    recipe(result) { const recipe = values!.get(result); if (!recipe) throw new Error('Missing codec projection'); return recipe; },
    template(result, original) {
      const recipe = templates!.get(original); if (!recipe) throw new Error('Missing template projection'); recorder.payload(result, recipe);
    },
    *finishRecord({ store, record }) {
      const temporary = yield* retainWork(0); const fields: [string, EmissionRecipe][] = [];
      try {
        yield* effect(1, () => temporary.grow(24));
        const keys = yield* primitive('keys', () => { const result = Object.keys(record); temporary.grow(24 + result.length * 8); return result; });
        for (const key of keys) {
          const value = Reflect.get(record, key);
          const recipe = key === 'value' || key === 'document' && store === 'projectHeaders'
            ? yield* effect(1, () => recorder.recipe(value)) : yield* privateMetadataRecipeWork(builder, value);
          yield* effect(1, () => { temporary.grow(24); fields.push([key, recipe]); });
        }
        yield* builder.append(store, yield* builder.object(fields));
      } finally { temporary.release(); }
    },
    dispose() {
      project = undefined; values = undefined; templates = undefined;
      preferences = []; compatibility = []; booleans = []; exceptions = []; lease?.release(); lease = undefined;
    },
  };
  return recorder;
}

function* fieldsWork(value: unknown, required: readonly string[], optional: readonly string[] = []): Work<Record<string, unknown>> {
  requireValue(object(value), 'record fields');
  for (const key of required) yield* effect(1, () => requireValue(own(value, key), 'record fields'));
  for (const key of yield* primitive('keys', () => Reflect.ownKeys(value))) yield* effect(1, () => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    requireValue(typeof key === 'string' && (required.includes(key) || optional.includes(key))
      && 'value' in descriptor && descriptor.enumerable, 'record fields');
  });
  return value;
}
function* stringsWork(value: unknown): Work<void> {
  requireValue(Array.isArray(value), 'ordering');
  const seen = new Set<unknown>();
  for (let index = 0; index < value.length; index++) yield* effect(1, () => {
    requireValue(!(index in value) || typeof value[index] === 'string', 'ordering'); seen.add(value[index]);
  });
  requireValue(seen.size === value.length, 'ordering');
}
function* checkScopeWork(scope: ProjectScope): Work<void> {
  yield* fieldsWork(scope, ['storageGeneration', 'projectId', 'incarnation']);
  requireValue(Object.values(scope).every(value => typeof value === 'string' && value.length > 0), 'scope');
}
const projectKey = (scope: ProjectScope): ProjectKey => [scope.storageGeneration, scope.projectId, scope.incarnation];
function* recordWork<K extends string[], V>(key: K, value: V, cooperative: boolean): Work<NormalizedRecord<K, V>> {
  return { key, formatVersion: NORMALIZED_DB_VERSION, value, encodedSize: { valueBytes: yield* sizeWork(value, cooperative) } };
}
function* putWork<S extends ProjectStoreName>(records: NormalizedProject, store: S, value: NormalizedRecordTypes[S], cooperative: boolean): Work<void> {
  const map = records[store] as Map<string, NormalizedRecordTypes[S]>;
  const key = yield* keyWork(value.key, cooperative);
  yield* effect(1, () => { map.set(key, value); });
}
function* extensionWork(records: NormalizedProject, owner: ExtensionKey extends [...ProjectKey, ...infer T] ? T : never, value: Record<string, unknown>, cooperative: boolean): Work<void> {
  yield* putWork(records, 'projectExtensions', yield* recordWork([...projectKey(records.scope), ...owner] as ExtensionKey, value, cooperative), cooperative);
}

/** Partitioning changes only layer.collapsed. All other template payloads stay
 * borrowed unchanged, so count the removed members rather than the whole image. */
function* templateOverlayBytesWork(template: PageTemplate, cooperative: boolean): Work<number> {
  if (!Array.isArray(template.layers)) return 0;
  let bytes = 0;
  for (const layer of template.layers) {
    const descriptor = yield* effect(3, () => layer !== null && typeof layer === 'object' && !Array.isArray(layer)
      ? Object.getOwnPropertyDescriptor(layer, 'collapsed') : undefined);
    if (!descriptor?.enumerable) continue;
    const keys = yield* primitive('keys', () => Object.keys(layer));
    bytes += '"collapsed":'.length + (yield* sizeWork(descriptor.value, cooperative)) + Number(keys.length > 1);
  }
  return bytes;
}

/** Validation only: no loader, migration, hydration defaults, or full-document clone. */
function* validateExternalWork(project: WorkspaceProject, cooperative: boolean): Work<void> {
  yield* canonicalCheckWork(project, cooperative);
  requireValue(object(project) && typeof project.id === 'string' && project.id.length > 0 && typeof project.name === 'string', 'wrapper');
  if (own(project, 'revision')) requireValue(Number.isInteger(project.revision) && project.revision! >= 0, 'wrapper revision');
  if (own(project, 'cloud')) requireValue(object(project.cloud) && cloudFields.every(key => typeof project.cloud[key] === 'string'), 'cloud linkage');
  requireValue(object(project.initialState) && project.initialState.schemaVersion === CURRENT_SCHEMA_VERSION, 'current schema required; migrate before decomposition');
  const result = cooperative ? yield* validateAppStateWork(project.initialState, 'plain') : validateAppState(project.initialState);
  requireValue(result.ok, result.ok ? '' : result.error);
  requireValue(typeof project.initialState.activeVariantId === 'string'
    && own(project.initialState.variants, project.initialState.activeVariantId), 'active variant');
}

/** Bulk ingress only. Input and shared payloads are immutable; never an ordinary save path. */
export function decomposeProject(project: WorkspaceProject, scope: ProjectScope): NormalizedProject {
  return runSync(decomposeWork(project, scope, false));
}
export function decomposeProjectWork(project: WorkspaceProject, scope: ProjectScope): Work<NormalizedProject> {
  return decomposeWork(project, scope, true);
}
function* checkProjectScopeWork(project: WorkspaceProject, scope: ProjectScope): Work<void> {
  yield* checkScopeWork(scope);
  requireValue(yield* equalWork(project.id, scope.projectId), 'project scope mismatch');
}
function* decomposeWork(project: WorkspaceProject, scope: ProjectScope, cooperative: boolean, trace?: CodecProjectionRecorder): Work<NormalizedProject> {
  yield* checkProjectScopeWork(project, scope);
  yield* validateExternalWork(project, cooperative);
  return yield* projectWork(project, scope, cooperative, trace);
}
function* projectWork(project: WorkspaceProject, scope: ProjectScope, cooperative: boolean, trace?: CodecProjectionRecorder): Work<NormalizedProject> {
  const parts = yield* partitionStateWork(project.initialState, trace?.partition);
  if (trace) yield* trace.partitioned(parts);
  const stateAddress = trace ? [...trace.projectAddress, 'initialState'] : undefined;
  const records: NormalizedProject = { scope: { ...scope }, projectHeaders: new Map(), projectNodes: new Map(),
    projectVariants: new Map(), projectTemplates: new Map(), projectSources: new Map(), projectExtensions: new Map(),
    projectPreferences: new Map(), normalizationLedger: new Map() };
  const key = projectKey(scope);
  const templateOverlayBytes: Record<string, number> = {};
  const value = yield* selectHeaderWork(project, trace);
  const document = (yield* selectedWork(parts.document, ['rootId', 'schemaVersion'], false, trace, stateAddress)) as Pick<DocumentState, 'rootId' | 'schemaVersion'>;
  yield* putWork(records, 'projectHeaders', {
    ...(yield* recordWork([scope.storageGeneration, scope.projectId], value, cooperative)), incarnation: scope.incarnation, document,
    order: { wrapper: yield* primitive('keys', () => Object.keys(project)), state: yield* primitive('keys', () => Object.keys(project.initialState)),
      nodes: yield* primitive('keys', () => Object.keys(parts.document.nodes)), variants: yield* primitive('keys', () => Object.keys(parts.document.variants)) },
    storageRevision: 0, lastCommitId: null,
    updatedAt: null, foldStructureGeneration: 0, commitProof: null, commitWindow: { floorRevision: 0, entries: [] },
    counters: { documentBytes: 0, projectBaseBytes: 0, nodeCount: 0, variantCount: 0, elementCount: 0 },
    encodedSize: { valueBytes: yield* sizeWork(value, cooperative), documentBytes: yield* sizeWork(document, cooperative) },
  }, cooperative);
  yield* extensionWork(records, ['wrapper'], yield* selectedWork(project, [...wrapperFields, 'initialState'], true, trace, trace?.projectAddress), cooperative);
  yield* extensionWork(records, ['state'], parts.compatibility.state as Record<string, unknown>, cooperative);
  yield* extensionWork(records, ['folds'], parts.compatibility.layerCollapsedExceptions as Record<string, unknown>, cooperative);
  if (project.cloud) yield* extensionWork(records, ['cloud'], yield* selectedWork(project.cloud, cloudFields, true, trace,
    trace ? [...trace.projectAddress, 'cloud'] : undefined), cooperative);
  for (const [nodeId, node] of yield* enumerableEntriesWork(parts.document.nodes)) {
    if (trace) {
      const recipe = yield* trace.builder.borrow([...stateAddress!, 'nodes', nodeId]);
      yield* effect(1, () => trace.payload(node, recipe));
    }
    yield* putWork(records, 'projectNodes', yield* recordWork([...key, nodeId], node, cooperative), cooperative);
  }
  for (const [variantId, variant] of yield* enumerableEntriesWork(parts.document.variants)) {
    const variantAddress = trace ? [...stateAddress!, 'variants', variantId] : undefined;
    yield* putWork(records, 'projectVariants', { ...(yield* recordWork([...key, variantId], (yield* selectedWork(variant, variantFields, false, trace, variantAddress)) as Pick<Variant, 'id' | 'name'>, cooperative)),
      fieldOrder: yield* primitive('keys', () => Object.keys(variant)), templateOrder: yield* primitive('keys', () => Object.keys(variant.templates)) }, cooperative);
    yield* extensionWork(records, ['variant', variantId], yield* selectedWork(variant, [...variantFields, 'templates'], true, trace, variantAddress), cooperative);
    for (const [templateId, template] of yield* enumerableEntriesWork(variant.templates)) {
      if (trace) yield* effect(4, () => trace.template(template, project.initialState.variants[variantId].templates[templateId]));
      const stored = yield* recordWork([...key, variantId, templateId] as NormalizedRecordTypes['projectTemplates']['key'], template, cooperative);
      yield* putWork(records, 'projectTemplates', stored, cooperative);
      const overlayBytes = yield* templateOverlayBytesWork(project.initialState.variants[variantId].templates[templateId], cooperative);
      if (overlayBytes) templateOverlayBytes[yield* keyWork([variantId, templateId], cooperative)] = overlayBytes;
    }
  }
  if (own(parts.document, 'generator')) {
    if (trace) {
      const recipe = yield* trace.builder.borrow([...stateAddress!, 'generator']);
      yield* effect(1, () => trace.payload(parts.document.generator!, recipe));
    }
    yield* putWork(records, 'projectSources', yield* recordWork(key, parts.document.generator!, cooperative), cooperative);
  }
  yield* putWork(records, 'projectPreferences', { ...(yield* recordWork(key, parts.preferences, cooperative)), revision: 0, lastCommitId: null,
    preferenceBytes: 0, commitProof: null, commitWindow: { floorRevision: 0, entries: [] },
    encodedSize: { valueBytes: yield* sizeWork(parts.preferences, cooperative), templateOverlayBytes } }, cooperative);
  const ledger = yield* createSizeLedgerWork(records);
  records.projectHeaders.values().next().value!.counters = { documentBytes: ledger.documentBytes,
    projectBaseBytes: ledger.projectBytes - ledger.preferenceBytes, nodeCount: ledger.nodeCount,
    variantCount: ledger.variantCount, elementCount: ledger.elementCount };
  records.projectPreferences.values().next().value!.preferenceBytes = ledger.preferenceBytes;
  return records;
}

const envelope = ['key', 'formatVersion', 'value', 'encodedSize'];
const extras: Record<ProjectStoreName, string[]> = {
  projectHeaders: ['incarnation', 'document', 'order', 'storageRevision', 'lastCommitId', 'updatedAt', 'foldStructureGeneration', 'counters', 'commitProof', 'commitWindow'],
  projectVariants: ['fieldOrder', 'templateOrder'], projectPreferences: ['revision', 'lastCommitId', 'preferenceBytes', 'commitProof', 'commitWindow'],
  projectNodes: [], projectTemplates: [], projectSources: [], projectExtensions: [],
};
function counter(value: unknown): void { requireValue(Number.isSafeInteger(value) && (value as number) >= 0, 'revision/counter'); }
function commit(value: unknown): void { requireValue(value === null || (typeof value === 'string' && value.length > 0), 'last commit'); }

/** Fail closed on physical envelopes before reading any payload into a project. */
export function validateRecords(records: NormalizedProject): void {
  runSync(validateRecordsProgram(records, false));
}
export function validateRecordsWork(records: NormalizedProject): Work<void> {
  return validateRecordsProgram(records, true);
}
function* validateRecordsProgram(records: NormalizedProject, cooperative: boolean): Work<void> {
  yield* fieldsWork(records, ['scope', ...NORMALIZED_STORE_NAMES]); yield* checkScopeWork(records.scope);
  const prefix = projectKey(records.scope);
  for (const store of NORMALIZED_STORE_NAMES) {
    const map = records[store]; requireValue(map instanceof Map, `${store} map`);
    // Migration-wide ledger is read/admitted separately, not mixed into a scoped project image.
    if (store === 'normalizationLedger') { requireValue(map.size === 0, 'ledger not a scoped project record'); continue; }
    for (const [mapKey, candidate] of map as Map<string, NormalizedRecordTypes[ProjectStoreName]>) {
      yield* fieldsWork(candidate, [...envelope, ...extras[store]], store === 'projectHeaders' ? ['migrationBaseline', 'workspaceBirth', 'bulkBaseline']
        : store === 'projectPreferences' ? ['foldRecordDigest', 'bulkBoundary'] : []);
      // Check descriptors before reading fields; storage ancestry must not consume
      // external payload depth. The assembled project gets the full depth check.
      let valueBytes: number | undefined, documentBytes: number | undefined, valueImage: unknown, documentImage: unknown;
      for (const [field, value] of yield* enumerableEntriesWork(candidate as unknown as Record<string, unknown>)) {
        const bytes = yield* canonicalCheckWork(value, cooperative);
        if (field === 'value') { valueBytes = bytes; valueImage = value; }
        if (field === 'document') { documentBytes = bytes; documentImage = value; }
      }
      requireValue(candidate.formatVersion === NORMALIZED_DB_VERSION, 'record version');
      requireValue(Array.isArray(candidate.key), 'physical key');
      for (let index = 0; index < candidate.key.length; index++) yield* effect(1,
        () => requireValue(!(index in candidate.key) || typeof candidate.key[index] === 'string', 'physical key'));
      const key = candidate.key;
      for (let i = 0; i < (store === 'projectHeaders' ? 2 : 3); i++) requireValue(yield* equalWork(key[i], prefix[i]), 'scope generation/incarnation mismatch');
      const length = store === 'projectHeaders' ? 2 : store === 'projectTemplates' ? 5
        : ['projectSources', 'projectPreferences'].includes(store) ? 3 : store === 'projectExtensions' && key[3] === 'variant' ? 5 : 4;
      requireValue(key.length === length && (yield* equalWork(mapKey, yield* keyWork(key, cooperative))), 'physical map key');
      requireValue(object(candidate.value), 'record payload');
      const sizeFields = store === 'projectHeaders' ? ['documentBytes'] : store === 'projectPreferences' ? ['templateOverlayBytes'] : [];
      yield* fieldsWork(candidate.encodedSize, ['valueBytes', ...sizeFields]);
      counter(candidate.encodedSize.valueBytes);
      // Strict canonical JSON has the same byte length in either key order.
      // These are this record's own measurements, never caller-supplied facts.
      requireValue(!cooperative || valueImage === candidate.value, 'record value changed during validation');
      requireValue(candidate.encodedSize.valueBytes === (cooperative ? valueBytes : yield* sizeWork(candidate.value, false)), 'encoded contribution');
      if (store === 'projectHeaders') {
        const header = candidate as NormalizedRecordTypes['projectHeaders'];
        requireValue((yield* equalWork(header.incarnation, records.scope.incarnation)) && (yield* equalWork(header.value.id, records.scope.projectId)), 'header scope incarnation');
        yield* fieldsWork(header.value, ['id', 'name'], ['cloud', 'revision']);
        if (own(header.value, 'cloud')) yield* fieldsWork(header.value.cloud, cloudFields);
        yield* fieldsWork(header.document, ['rootId', 'schemaVersion']);
        yield* fieldsWork(header.order, ['wrapper', 'state', 'nodes', 'variants']);
        for (const order of Object.values(header.order)) yield* stringsWork(order);
        counter(header.storageRevision); commit(header.lastCommitId);
        if (cooperative) yield* validateLineageWork(header, 'document'); else validateLineage(header, 'document');
        counter(header.encodedSize.documentBytes);
        requireValue(!cooperative || documentImage === header.document, 'record document changed during validation');
        requireValue(header.encodedSize.documentBytes === (cooperative ? documentBytes : yield* sizeWork(header.document, false)), 'document contribution');
      } else if (store === 'projectVariants') {
        const variant = candidate as NormalizedRecordTypes['projectVariants'];
        yield* fieldsWork(variant.value, variantFields); yield* stringsWork(variant.fieldOrder); yield* stringsWork(variant.templateOrder);
      } else if (store === 'projectPreferences') {
        const prefs = candidate as NormalizedRecordTypes['projectPreferences'];
        yield* fieldsWork(prefs.value, ['layerCollapsed', 'panelsExpanded'], preferenceFields);
        for (const map of [prefs.value.layerCollapsed, prefs.value.panelsExpanded]) {
          requireValue(object(map), 'boolean preferences');
          for (const [, value] of yield* enumerableEntriesWork(map)) yield* effect(1, () => requireValue(typeof value === 'boolean', 'boolean preferences'));
        }
        counter(prefs.revision); commit(prefs.lastCommitId);
        if (cooperative) yield* validateLineageWork(prefs, 'preferences'); else validateLineage(prefs, 'preferences');
        requireValue(object(prefs.encodedSize.templateOverlayBytes), 'overlay contributions');
        for (const [, size] of yield* enumerableEntriesWork(prefs.encodedSize.templateOverlayBytes)) {
          yield* effect(1, () => { counter(size); requireValue(size > 0, 'nonzero overlay contribution'); });
        }
      } else if (store === 'projectExtensions') {
        requireValue(['wrapper', 'state', 'cloud', 'folds', 'variant'].includes(key[3]), 'extension owner');
      } else if (store === 'projectTemplates') {
        const template = candidate as NormalizedRecordTypes['projectTemplates'];
        if (Array.isArray(template.value.layers)) for (let index = 0; index < template.value.layers.length; index++) {
          yield* effect(1, () => {
            if (index in template.value.layers!) {
              const layer = template.value.layers![index]; requireValue(!object(layer) || !own(layer, 'collapsed'), 'unstripped fold');
            }
          });
        }
      }
    }
  }
  const header = records.projectHeaders.values().next().value; const preferences = records.projectPreferences.values().next().value;
  if (header && preferences) yield* validateAuthorityPairWork(header, preferences);
}

/** Restore exact membership/order; unknown/missing fields are errors, not omissions. */
function* orderedWork(order: string[], value: object): Work<Record<string, unknown>> {
  yield* stringsWork(order);
  requireValue(order.length === (yield* primitive('keys', () => Object.keys(value))).length, 'ordering membership');
  for (let index = 0; index < order.length; index++) if (index in order) yield* effect(1, () => requireValue(own(value, order[index]), 'ordering membership'));
  const result = {};
  for (const key of order) yield* effect(1, () => { requireValue(typeof key === 'string', 'ordering'); define(result, key, Reflect.get(value, key)); });
  return result;
}
/** Header hints preserve initial interleaving; current preferences own their presence. */
function* orderedStateWork(order: string[], value: AppState, preferences: EditorPreferences): Work<Record<string, unknown>> {
  // Validate the original list before filtering, including duplicates of now-absent preferences.
  yield* stringsWork(order);
  const currentOrder: string[] = []; const seen = new Set<string>();
  for (let index = 0; index < order.length; index++) yield* effect(1, () => {
    if (index in order) { const key = order[index]; seen.add(key); if (!preferenceFields.includes(key) || own(preferences, key)) currentOrder.push(key); }
  });
  for (const key of yield* primitive('keys', () => Object.keys(preferences))) yield* effect(1, () => {
    if (preferenceFields.includes(key) && !seen.has(key)) currentOrder.push(key);
  });
  // Only known preferences may change membership. Document/extension keys remain exact.
  return yield* orderedWork(currentOrder, value);
}
function* mergeWork(...values: object[]): Work<Record<string, unknown>> {
  const result = {};
  for (const value of values) for (const [key, item] of yield* enumerableEntriesWork(value as Record<string, unknown>)) yield* effect(1, () => {
    requireValue(!own(result, key), 'extension owner collision'); define(result, key, item);
  });
  return result;
}

/** Validate current overlays, without persisting runtime history mappings/cells. */
function* validateOverlaysWork(document: DocumentState, preferences: EditorPreferences, exceptions: Record<string, unknown>, cooperative: boolean): Work<void> {
  const booleanTargets = new Set<string>();
  const occurrences = new Map<string, { id: unknown; count: number }>();
  for (const [variantId, variant] of yield* enumerableEntriesWork(document.variants)) for (const [templateId, template] of yield* enumerableEntriesWork(variant.templates)) {
    const counts = new Map<string, number>();
    for (const layer of template.layers ?? []) yield* effect(1, () => { if (object(layer) && typeof layer.id === 'string') counts.set(layer.id, (counts.get(layer.id) ?? 0) + 1); });
    for (const [position, layer] of (template.layers ?? []).entries()) {
      yield* effect(1, () => {}); if (!object(layer)) continue;
      const count = typeof layer.id === 'string' ? counts.get(layer.id)! : 0;
      occurrences.set(yield* keyWork([variantId, templateId, position], cooperative), { id: layer.id, count });
      if (count === 1) booleanTargets.add(yield* keyWork([variantId, templateId, layer.id], cooperative));
    }
  }
  for (const key of yield* primitive('keys', () => Object.keys(preferences.layerCollapsed))) yield* effect(1, () => requireValue(booleanTargets.has(key), 'fold preference address'));
  for (const [key, raw] of yield* enumerableEntriesWork(exceptions)) {
    const cell = yield* fieldsWork(raw, ['value']); const occurrence = occurrences.get(key);
    requireValue(occurrence, 'fold exception address');
    requireValue(typeof cell.value !== 'boolean' || occurrence.count !== 1, 'noncanonical fold exception');
    const [variantId, templateId] = yield* primitive('parse', () => JSON.parse(key) as string[]);
    requireValue(!own(preferences.layerCollapsed, yield* keyWork([variantId, templateId, occurrence.id], cooperative)), 'overlapping fold owners');
  }
}

/** Explicit bulk export/verification only. Never call for an ordinary write. */
export function reconstructProject(records: NormalizedProject): WorkspaceProject {
  return runSync(reconstructWork(records, false));
}
export function reconstructProjectWork(records: NormalizedProject): Work<WorkspaceProject> {
  return reconstructWork(records, true);
}
function* reconstructWork(records: NormalizedProject, cooperative: boolean): Work<WorkspaceProject> {
  const project = yield* assembleProjectWork(records, cooperative);
  yield* validateExternalWork(project, cooperative);
  yield* reconstructedCountersWork(records, project, cooperative);
  return project;
}

/** One current-workspace composition owns physical assembly, the full stored
 * project check (including clone/loader/output), and membership validation.
 * No unchecked project or reusable validation verdict is exposed. */
export function createWorkspaceReconstructor() {
  let validator: ReturnType<typeof createWorkspaceRecordValidator> | undefined = createWorkspaceRecordValidator();
  let busy = false, failed = false, finished = false, disposed = false;
  const current = () => {
    if (disposed || finished || failed) throw new Error('Workspace reconstructor closed');
  };
  function* execute<T>(program: Work<T>, finish = false): Work<T> {
    current(); if (busy) throw new Error('Workspace reconstructor already running');
    busy = true; let completed = false, value: unknown, throwing = false;
    try {
      for (;;) {
        current();
        const next = throwing ? program.throw(value) : program.next(value);
        if (next.done === true) { current(); completed = true; finished = finish; return next.value; }
        const operation = next.value;
        try {
          value = yield { ...operation, run(runtime) {
            current(); const result = operation.run(runtime); current(); return result;
          } };
          throwing = false;
        } catch (error) { current(); value = error; throwing = true; }
      }
    } finally {
      try { program.return(undefined as never); }
      finally { busy = false; if (!completed) failed = true; if (disposed || finished || failed) validator = undefined; }
    }
  }
  return {
    project(records: NormalizedProject, metadata: Omit<StoredProject, 'project'>): Work<WorkspaceProject> {
      return execute((function* (): Work<WorkspaceProject> {
        const project = yield* assembleProjectWork(records, true);
        yield* fieldsWork(metadata, ['id', 'incarnation', 'storageRevision', 'updatedAt'],
          ['consumedImportId', 'consumedImportCreatedAt', 'consumedImportDigest', 'consumedImportAttempt']);
        const header = records.projectHeaders.values().next().value!;
        requireValue((yield* equalWork(metadata.id, records.scope.projectId))
          && (yield* equalWork(metadata.incarnation, records.scope.incarnation))
          && metadata.storageRevision === header.storageRevision, 'stored project scope/revision');
        yield* validator!.project({ ...metadata, project });
        yield* reconstructedCountersWork(records, project, true);
        return project;
      })());
    },
    ancillary(records: Omit<WorkspaceRecordCandidates, 'projects'>): Work<Omit<WorkspaceRecords, 'projects'>> {
      return execute((function* (): Work<Omit<WorkspaceRecords, 'projects'>> {
        const keys = ['workspace', 'presets', 'pendingImports'] as const;
        yield* fieldsWork(records, keys);
        const captured = {} as Omit<WorkspaceRecords, 'projects'>;
        for (const key of keys) yield* effect(1, () => {
          const descriptor = Object.getOwnPropertyDescriptor(records, key);
          requireValue(descriptor && 'value' in descriptor && descriptor.enumerable, 'ancillary data field');
          define(captured, key, descriptor.value);
        });
        yield* validator!.ancillary(captured); return captured;
      })(), true);
    },
    dispose() { disposed = true; validator = undefined; },
  };
}

function* assembleProjectWork(records: NormalizedProject, cooperative: boolean): Work<WorkspaceProject> {
  yield* validateRecordsProgram(records, cooperative);
  const used = new Map<ProjectStoreName, Set<string>>();
  function* read<S extends ProjectStoreName>(store: S, key: string[]): Work<NormalizedRecordTypes[S]> {
    const map = records[store] as Map<string, NormalizedRecordTypes[S]>;
    const encoded = yield* keyWork(key, cooperative); const value = map.get(encoded);
    requireValue(value, `missing ${store} record`);
    const keys = used.get(store) ?? new Set<string>(); keys.add(encoded); used.set(store, keys);
    return value;
  }
  const key = projectKey(records.scope);
  function* ext(...owner: string[]): Work<Record<string, unknown>> { return (yield* read('projectExtensions', [...key, ...owner])).value; }
  const header = yield* read('projectHeaders', key.slice(0, 2));
  const prefs = yield* read('projectPreferences', key);
  const variants: Record<string, Variant> = {};
  for (const variantId of header.order.variants) {
    const variant = yield* read('projectVariants', [...key, variantId]);
    const templates = {};
    for (const templateId of variant.templateOrder) define(templates, templateId, (yield* read('projectTemplates', [...key, variantId, templateId])).value);
    define(variants, variantId, yield* orderedWork(variant.fieldOrder, yield* mergeWork(variant.value, yield* ext('variant', variantId), { templates })));
  }
  const document: DocumentState = { ...header.document, variants, nodes: {} };
  for (const nodeId of header.order.nodes) define(document.nodes, nodeId, (yield* read('projectNodes', [...key, nodeId])).value);
  let hasGenerator = false;
  for (const field of header.order.state) yield* effect(1, () => { if (field === 'generator') hasGenerator = true; });
  if (hasGenerator) document.generator = (yield* read('projectSources', key)).value;
  const compatibilityState = yield* ext('state');
  for (const field of yield* primitive('keys', () => Object.keys(compatibilityState))) yield* effect(1,
    () => requireValue(![...documentFields, ...preferenceFields].includes(field), 'state extension owner collision'));
  const exceptions = yield* ext('folds'); yield* validateOverlaysWork(document, prefs.value, exceptions, cooperative);
  const initialState = (yield* orderedStateWork(header.order.state, yield* assembleStateWork({ document, preferences: prefs.value,
    compatibility: { state: compatibilityState, layerCollapsedExceptions: exceptions } }), prefs.value)) as unknown as AppState;
  const metadata = { ...header.value };
  if (metadata.cloud) metadata.cloud = (yield* mergeWork(metadata.cloud, yield* ext('cloud'))) as WorkspaceProject['cloud'];
  const wrapperExtensions = yield* ext('wrapper');
  for (const field of yield* primitive('keys', () => Object.keys(wrapperExtensions))) yield* effect(1,
    () => requireValue(![...wrapperFields, 'initialState'].includes(field), 'wrapper extension owner collision'));
  const project = (yield* orderedWork(header.order.wrapper, yield* mergeWork(metadata, wrapperExtensions, { initialState }))) as unknown as WorkspaceProject;
  for (const store of NORMALIZED_STORE_NAMES) if (store !== 'normalizationLedger')
    requireValue((used.get(store)?.size ?? 0) === records[store].size, `extra ${store} records`);
  return project;
}

function* reconstructedCountersWork(records: NormalizedProject, project: WorkspaceProject, cooperative: boolean): Work<void> {
  const header = records.projectHeaders.values().next().value!, prefs = records.projectPreferences.values().next().value!;
  const overlayKeys = new Set<string>();
  for (const key of yield* primitive('keys', () => Object.keys(prefs.encodedSize.templateOverlayBytes))) yield* effect(1, () => { overlayKeys.add(key); });
  for (const stored of records.projectTemplates.values()) {
    const external = project.initialState.variants[stored.key[3]].templates[stored.key[4]];
    const overlayKey = yield* keyWork(stored.key.slice(3), cooperative);
    const contribution = prefs.encodedSize.templateOverlayBytes[overlayKey] ?? 0;
    requireValue(contribution === (yield* templateOverlayBytesWork(external, cooperative)), 'external template contribution');
    overlayKeys.delete(overlayKey);
  }
  requireValue(overlayKeys.size === 0, 'unknown template overlay contribution');
  const ledger = yield* createSizeLedgerWork(records);
  requireValue(header.counters.documentBytes === ledger.documentBytes && header.counters.projectBaseBytes === ledger.projectBytes - ledger.preferenceBytes
    && header.counters.nodeCount === ledger.nodeCount && header.counters.variantCount === ledger.variantCount
    && header.counters.elementCount === ledger.elementCount && prefs.preferenceBytes === ledger.preferenceBytes, 'aggregate counter mismatch');
}
