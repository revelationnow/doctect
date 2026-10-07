import { effect, primitive, retainWork, type Ownership, type Work } from '../../../shared/cooperativeWork.js';
import { compareStringsWork, stableSortWork, utf8LengthWork } from '../../../shared/jsonWork.js';
import { NORMALIZED_STORE_NAMES, type NormalizationSource, type ProjectStoreName, type TaggedNormalizedRecord } from './schema';

declare const recipeBrand: unique symbol;
declare const planBrand: unique symbol;
export type EmissionRecipe = { readonly [recipeBrand]: true };
export type EmissionPlan = { readonly [planBrand]: true };
export type SourceAddress = readonly (string | number)[];
export type EmittedTarget = Exclude<TaggedNormalizedRecord, { store: 'normalizationLedger' }>;
export interface EmissionBuilder {
  borrow(address: SourceAddress): Work<EmissionRecipe>;
  literal(value: string | number | boolean | null): Work<EmissionRecipe>;
  object(fields: readonly (readonly [string, EmissionRecipe])[]): Work<EmissionRecipe>;
  array(length: number, present: readonly (readonly [number, EmissionRecipe])[]): Work<EmissionRecipe>;
  append(store: ProjectStoreName, record: EmissionRecipe): Work<void>;
  finish(): EmissionPlan;
  dispose(): void;
}
export interface EmissionCursor { next(): Work<IteratorResult<EmittedTarget, void>>; dispose(): void }

type Node =
  | { kind: 'borrow'; address: SourceAddress }
  | { kind: 'literal'; value: string | number | boolean | null }
  | { kind: 'object'; fields: readonly (readonly [string, number])[] }
  | { kind: 'array'; length: number; present: readonly (readonly [number, number])[] };
interface Owner {
  source?: NormalizationSource; nodes: Node[]; records: { store: ProjectStoreName; node: number }[];
  lease?: Ownership; status: 'building' | 'ready' | 'disposed'; busy: boolean; active?: EmissionCursor;
}
const recipes = new WeakMap<EmissionRecipe, { owner: Owner; node: number }>();
const plans = new WeakMap<EmissionPlan, Owner>();
const fail = (message: string): never => { throw new Error(message); };
const metadata = (ok: unknown): void => { if (!ok) fail('Invalid emission metadata'); };
const define = (target: object, key: string | number, value: unknown) => Object.defineProperty(target, key,
  { value, enumerable: true, configurable: true, writable: true });

/** Read descriptors, not getters. Callers supply validated captures or private metadata. */
function data(value: unknown, key: string | number, message = 'Invalid emission metadata'): unknown {
  if (!value || typeof value !== 'object') return fail(message);
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor?.enumerable || !('value' in descriptor)) return fail(message);
  return descriptor.value;
}
// Do not expose unknown values to Work's synchronous-result thenable check.
function* readData(value: unknown, key: string | number, message?: string): Work<unknown> {
  let captured: unknown;
  yield* effect(1, () => { captured = data(value, key, message); });
  return captured;
}
function* denseLength(value: unknown): Work<number> {
  const temporary = yield* retainWork(0);
  try {
    const length = yield* effect(1, () => {
      metadata(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype);
      const descriptor = Object.getOwnPropertyDescriptor(value, 'length');
      metadata(descriptor && 'value' in descriptor && Number.isInteger(descriptor.value) && descriptor.value >= 0);
      return descriptor!.value as number;
    });
    const keys = yield* primitive('keys', () => {
      const result = Reflect.ownKeys(value as object); temporary.grow(24 + result.length * 8); return result;
    });
    metadata(keys.length === length + 1 && keys[length] === 'length');
    for (let index = 0; index < length; index++) yield* effect(1, () => {
      metadata(keys[index] === String(index)); data(value, index);
    });
    return length;
  } finally { temporary.release(); }
}
function* resolve(source: NormalizationSource, address: SourceAddress): Work<unknown> {
  let value: unknown = source;
  for (const key of address) {
    if (typeof key === 'string') yield* utf8LengthWork(key);
    value = yield* readData(value, key, 'Invalid emission source location');
  }
  return value;
}
function* guarded<T>(program: Work<T>, assertLive: () => void): Work<T> {
  try {
    let result: unknown;
    for (;;) {
      assertLive(); const step = program.next(result);
      if (step.done === true) { assertLive(); return step.value; }
      const operation = step.value;
      result = yield { ...operation, run(runtime) {
        assertLive(); const value = operation.run(runtime); assertLive(); return value;
      } };
    }
  } finally { program.return(undefined as T); }
}
function disposeOwner(owner: Owner): void {
  if (owner.status === 'disposed') return;
  owner.status = 'disposed'; owner.active?.dispose(); owner.active = undefined;
  owner.source = undefined; owner.nodes = []; owner.records = [];
  owner.lease?.release(); owner.lease = undefined;
}
function recipeIndex(owner: Owner, recipe: EmissionRecipe): number {
  const entry = recipes.get(recipe);
  if (!entry || entry.owner !== owner) return fail('Foreign or forged emission recipe');
  return entry.node;
}

/** Input graph is a privately owned immutable capture, not caller-supplied authority. */
export function createEmissionBuilder(source: NormalizationSource): EmissionBuilder {
  return builderFor({ source, nodes: [], records: [], status: 'building', busy: false });
}
function builderFor(owner: Owner): EmissionBuilder {
  const assertBuilding = () => { if (owner.status !== 'building') fail('Emission builder is not open'); };
  function* operation<T>(body: () => Work<T>): Work<T> {
    assertBuilding(); if (owner.busy) fail('Emission builder already running');
    owner.busy = true; let completed = false;
    try {
      const result = yield* guarded((function* () {
        if (!owner.lease) {
          owner.lease = yield* retainWork(0);
          yield* effect(1, () => owner.lease!.grow(96));
        }
        return yield* body();
      })(), assertBuilding);
      completed = true; return result;
    } finally { owner.busy = false; if (!completed) disposeOwner(owner); }
  }
  function* node(value: Node): Work<EmissionRecipe> {
    return yield* effect(1, () => {
      owner.lease!.grow(72); const token = Object.freeze(Object.create(null)) as EmissionRecipe;
      recipes.set(token, { owner, node: owner.nodes.length }); owner.nodes.push(value); return token;
    });
  }
  return {
    borrow: address => operation(function* () {
      const length = yield* denseLength(address); const copied: (string | number)[] = [];
      yield* effect(1, () => owner.lease!.grow(24));
      for (let index = 0; index < length; index++) {
        const key = yield* readData(address, index);
        metadata(typeof key === 'string' || typeof key === 'number' && Number.isSafeInteger(key) && key >= 0);
        const bytes = typeof key === 'string' ? yield* utf8LengthWork(key) : 8;
        yield* effect(1, () => { owner.lease!.grow(8 + bytes); copied.push(key as string | number); });
      }
      yield* resolve(owner.source!, copied);
      return yield* node({ kind: 'borrow', address: copied });
    }),
    literal: value => operation(function* () {
      metadata(value === null || typeof value === 'boolean' || typeof value === 'string'
        || typeof value === 'number' && Number.isFinite(value));
      const bytes = typeof value === 'string' ? yield* utf8LengthWork(value) : 8;
      yield* effect(1, () => owner.lease!.grow(bytes)); return yield* node({ kind: 'literal', value });
    }),
    object: fields => operation(function* () {
      const length = yield* denseLength(fields); const copied: [string, number][] = [];
      const temporary = yield* retainWork(0);
      try {
        yield* effect(1, () => { owner.lease!.grow(24); temporary.grow(2 * (24 + length * 8)); });
        for (let index = 0; index < length; index++) {
          const pair = yield* readData(fields, index); metadata((yield* denseLength(pair)) === 2);
          const key = yield* readData(pair, 0); metadata(typeof key === 'string');
          const child = yield* effect(1, () => recipeIndex(owner, data(pair, 1) as EmissionRecipe));
          const bytes = yield* utf8LengthWork(key as string);
          yield* effect(1, () => { owner.lease!.grow(24 + bytes); copied.push([key as string, child]); });
        }
        const sorted = yield* stableSortWork(copied, (a, b) => compareStringsWork(a[0], b[0]));
        for (let index = 1; index < sorted.length; index++) metadata((yield* compareStringsWork(sorted[index - 1][0], sorted[index][0])) !== 0);
        return yield* node({ kind: 'object', fields: copied });
      } finally { temporary.release(); }
    }),
    array: (length, present) => operation(function* () {
      metadata(Number.isInteger(length) && length >= 0 && length <= 0xffffffff);
      const count = yield* denseLength(present); const copied: [number, number][] = [];
      const temporary = yield* retainWork(0);
      try {
        const seen = new Set<number>(); yield* effect(1, () => { temporary.grow(24); owner.lease!.grow(24); });
        for (let index = 0; index < count; index++) {
          const pair = yield* readData(present, index); metadata((yield* denseLength(pair)) === 2);
          const at = yield* readData(pair, 0); metadata(typeof at === 'number' && Number.isInteger(at) && at >= 0 && at < length);
          const child = yield* effect(1, () => recipeIndex(owner, data(pair, 1) as EmissionRecipe));
          yield* effect(1, () => {
            metadata(!seen.has(at as number)); temporary.grow(16); seen.add(at as number);
            owner.lease!.grow(24); copied.push([at as number, child]);
          });
        }
        return yield* node({ kind: 'array', length, present: copied });
      } finally { temporary.release(); }
    }),
    append: (store, recipe) => operation(function* () {
      yield* effect(8, () => {
        metadata(NORMALIZED_STORE_NAMES.some(name => name !== 'normalizationLedger' && name === store));
        const index = recipeIndex(owner, recipe); metadata(owner.nodes[index].kind === 'object');
        owner.lease!.grow(24); owner.records.push({ store, node: index });
      });
    }),
    finish() {
      assertBuilding(); if (owner.busy || !owner.records.length) return fail('Emission builder is incomplete');
      owner.lease!.grow(32); const token = Object.freeze(Object.create(null)) as EmissionPlan;
      plans.set(token, owner); owner.status = 'ready'; return token;
    },
    dispose() { if (owner.status === 'building') disposeOwner(owner); },
  };
}

export function disposeEmissionPlan(plan: EmissionPlan): void {
  const owner = plans.get(plan); if (!owner) fail('Invalid emission plan'); disposeOwner(owner);
}
/** Constant-size handoff; caller registers the cursor inside its charged effect. */
export function openEmissionCursor(plan: EmissionPlan, source: NormalizationSource, firstOrdinal: number): EmissionCursor {
  const owner = plans.get(plan);
  if (!owner || owner.status !== 'ready') return fail('Invalid or disposed emission plan');
  if (source !== owner.source) return fail('Foreign emission source');
  if (!Number.isSafeInteger(firstOrdinal) || firstOrdinal < 0 || firstOrdinal > owner.records.length) return fail('Invalid emission ordinal');
  if (owner.active) return fail('Emission plan already in use');
  return cursorFor(owner, firstOrdinal);
}
function cursorFor(owner: Owner, ordinal: number): EmissionCursor {
  let disposed = false; let running = false; let containers: Ownership | undefined;
  let program: Work<unknown> | undefined;
  const assertLive = () => { if (disposed || owner.status !== 'ready') fail('Emission cursor disposed'); };
  const dispose = () => {
    disposed = true; program?.return(undefined); program = undefined;
    containers?.release(); containers = undefined;
    if (owner.active === cursor) owner.active = undefined;
  };
  function* materialize(root: number): Work<unknown> {
    const stackOwner = yield* retainWork(0);
    type Entry = { node: number; parent?: object; key?: string | number; target?: object; offset: number };
    const stack: Entry[] = []; let depth = 0; let result: unknown;
    const push = (node: number, parent?: object, key?: string | number) => {
      if (depth === stack.length) { stackOwner.grow(72); stack.push({ node, offset: 0 }); }
      const frame = stack[depth++]; frame.node = node; frame.offset = 0; frame.parent = parent; frame.key = key; frame.target = undefined;
    };
    try {
      yield* effect(1, () => { stackOwner.grow(24); push(root); });
      while (depth) {
        const frame = stack[depth - 1]; const value = owner.nodes[frame.node];
        if (frame.target === undefined) {
          let produced: unknown;
          if (value.kind === 'borrow') produced = yield* resolve(owner.source!, value.address);
          else if (value.kind === 'literal') produced = value.value;
          else produced = yield* primitive('scalar', () => {
            containers!.grow(24 + (value.kind === 'array' ? value.length * 8 : 0));
            return value.kind === 'array' ? new Array(value.length) : {};
          });
          const keyBytes = typeof frame.key === 'string' ? yield* utf8LengthWork(frame.key) : 0;
          yield* effect(1, () => {
            if (frame.parent) {
              if (!Array.isArray(frame.parent)) containers!.grow(16 + keyBytes);
              define(frame.parent, frame.key!, produced);
            } else result = produced;
            if (value.kind === 'object' || value.kind === 'array') frame.target = produced as object;
            else { frame.parent = undefined; depth--; }
          });
          if (value.kind === 'borrow' || value.kind === 'literal') continue;
        }
        if (value.kind !== 'object' && value.kind !== 'array') return fail('Invalid emission node');
        const entries = value.kind === 'object' ? value.fields : value.present;
        if (frame.offset < entries.length) yield* effect(1, () => {
          const [key, child] = entries[frame.offset++]; push(child, frame.target, key);
        });
        else yield* effect(1, () => { frame.target = undefined; frame.parent = undefined; depth--; });
      }
      return result;
    } finally { stack.length = 0; stackOwner.release(); }
  }
  const cursor: EmissionCursor = {
    *next() {
      assertLive(); if (running) return fail('Emission cursor already running');
      running = true; let completed = false;
      try {
        if (!containers) {
          containers = yield* guarded(retainWork(0), assertLive);
          yield* guarded(effect(1, () => containers!.grow(32)), assertLive);
        }
        if (ordinal === owner.records.length) { completed = true; return { done: true, value: undefined }; }
        const record = owner.records[ordinal]; program = materialize(record.node);
        const value = yield* guarded(program, assertLive); program = undefined;
        yield* guarded(effect(1, () => { ordinal++; }), assertLive); assertLive(); completed = true;
        return { done: false, value: { store: record.store, record: value } as EmittedTarget };
      } finally { running = false; if (!completed) dispose(); }
    },
    dispose,
  };
  owner.active = cursor; return cursor;
}
