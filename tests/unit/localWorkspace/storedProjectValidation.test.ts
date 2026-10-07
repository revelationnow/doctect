// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as validation from '../../../services/localWorkspace/validation';
import * as json from '../../../shared/jsonWork.js';
import * as app from '../../../shared/validateAppState.js';
import * as loader from '../../../services/loadProjectState';
import { effect, type Work } from '../../../shared/cooperativeWork.js';
import { MAX_STATE_BYTES } from '../../../shared/projectLimits.js';
import { GENERATOR_SCRIPT_MAX_BYTES } from '../../../shared/generatorMetadata.js';
import { currentState } from '../../helpers/localWorkspaceFixtures';
import { makeWorkHarness } from '../../helpers/normalizationWorkHarness';

const project = () => ({ id: 'project-1', name: '', initialState: currentState(),
  cloud: { projectId: 'cloud-1', lastSyncedCommitId: 'commit-1' }, revision: 0,
  retained: { data: ['Café', '\ud800'] } });

// Keep the old exported composition as an independent oracle. Do not route it
// through the new helper or copy its optimized implementation into the test.
function* reference(raw: any): Work<void> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || Object.getPrototypeOf(raw) !== Object.prototype) throw new Error('Project payload must be an object.');
  yield* validation.checkMigratedStateWork(raw.initialState);
  yield* validation.checkWorkspaceProjectWork(raw, { warningPolicy: 'reject' });
}

const errorShape = (error: unknown): unknown => error instanceof Error
  ? { name: error.name, message: error.message, cause: errorShape(error.cause) }
  : error;

async function outcome(program: Work<void>) {
  const h = makeWorkHarness();
  try { return { result: await h.runtime.run(program) }; }
  catch (error) { return { error: errorShape(error) }; }
  finally { expect(h.runtime.snapshot().ownedBytes).toBe(0); }
}

const element = (raw: any) => raw.initialState.variants.default.templates.page.elements[0];
function nested(depth: number) {
  let value: Record<string, unknown> = {};
  for (let index = 0; index < depth; index++) value = { child: value };
  return value;
}

beforeEach(() => vi.spyOn(console, 'log').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

it('reuses same-image JSON measurements while retaining clone and loader-output checks', async () => {
  expect(validation.checkStoredWorkspaceProjectWork).toBeTypeOf('function');
  const raw = project(), before = structuredClone(raw);
  const canonical = vi.spyOn(json, 'canonicalBytesWork');
  const semantic = vi.spyOn(app, 'validateAppStateWork');
  const loadOriginal = loader.loadOwnedProjectStateWork;
  let loaded: loader.ProjectLoadResult | undefined;
  const load = vi.spyOn(loader, 'loadOwnedProjectStateWork').mockImplementation(function* (input) {
    loaded = yield* loadOriginal(input); return loaded;
  });
  const clone = vi.spyOn(globalThis, 'structuredClone');
  const old = makeWorkHarness(); await old.runtime.run(reference(raw));
  expect(canonical).toHaveBeenCalledTimes(6); expect(semantic).toHaveBeenCalledTimes(3);
  expect(load).toHaveBeenCalledTimes(1); expect(clone.mock.calls).toEqual([[raw.initialState]]);
  canonical.mockClear(); semantic.mockClear(); load.mockClear(); clone.mockClear();
  expect((json as any).canonicalInspectionWork).toBeTypeOf('function');
  expect((app as any).inspectAppStateWork).toBeTypeOf('function');
  const inspect = vi.spyOn(json as any, 'canonicalInspectionWork'), combined = vi.spyOn(app as any, 'inspectAppStateWork');
  const h = makeWorkHarness();
  expect(await h.runtime.run(validation.checkStoredWorkspaceProjectWork(raw))).toBeUndefined();
  expect(inspect.mock.calls.map(call => call[0])).toEqual([raw.initialState, loaded!.state]);
  expect(combined).toHaveBeenCalledTimes(2); expect(semantic).toHaveBeenCalledTimes(1);
  expect(canonical.mock.calls.some(call => call[0] === raw || call[0] === raw.initialState || call[0] === loaded!.state)).toBe(false);
  expect(semantic.mock.calls[0][0]).toBe(load.mock.calls[0][0]);
  expect(semantic.mock.calls.every(call => call[1] === 'plain')).toBe(true);
  expect(load).toHaveBeenCalledTimes(1); expect(clone.mock.calls).toEqual([[raw.initialState]]);
  expect(raw).toEqual(before); expect(h.runtime.snapshot().ownedBytes).toBe(0);
  expect(h.runtime.snapshot().ownedHighWater).toBe(old.runtime.snapshot().ownedHighWater);
  expect(h.runtime.snapshot().projectReconstructions).toBe(0);
  expect(h.runtime.snapshot().visits).toBeLessThan(old.runtime.snapshot().visits);
  expect(h.runtime.stopped()).toBe(false);
});

it.each(['state-alias', 'wrapper-backlink', 'boundary-backlink'] as const)('preserves wrapper ancestry for %s', async kind => {
  const make = () => {
    const raw: any = project();
    if (kind === 'state-alias') raw.z = raw.initialState;
    else raw.z = raw;
    if (kind === 'boundary-backlink') raw.initialState.opaque = nested(510);
    return raw;
  };
  expect(await outcome(validation.checkStoredWorkspaceProjectWork(make()))).toEqual(await outcome(reference(make())));
});

const invalid: [string, (raw: any) => void][] = [
  ['missing schema', raw => { delete raw.initialState.schemaVersion; }],
  ['old schema', raw => { raw.initialState.schemaVersion = 10; }],
  ['future schema', raw => { raw.initialState.schemaVersion = 12; }],
  ['negative schema', raw => { raw.initialState.schemaVersion = -1; }],
  ['fractional schema', raw => { raw.initialState.schemaVersion = 10.5; }],
  ['string schema', raw => { raw.initialState.schemaVersion = '11'; }],
  ['missing root', raw => { raw.initialState.rootId = 'missing'; }],
  ['missing active variant', raw => { raw.initialState.activeVariantId = 'missing'; }],
  ['bad node id', raw => { raw.initialState.nodes.root.id = 'other'; }],
  ['bad node children', raw => { raw.initialState.nodes.root.children = [3]; }],
  ['bad template dimensions', raw => { raw.initialState.variants.default.templates.page.width = -1; }],
  ['bad text wrap', raw => { element(raw).textWrap = 'bad'; }],
  ['bad text overflow', raw => { element(raw).textOverflow = 'bad'; }],
  ['bad text padding', raw => { element(raw).textPadding.top = -1; }],
  ['bad generator script', raw => { raw.initialState.generator.hierarchyScript = 42; }],
  ['bad generator format', raw => { raw.initialState.generator.formatVersion = 2; }],
  ['unknown generator field', raw => { raw.initialState.generator.unknown = true; }],
  ['bad generator time', raw => { raw.initialState.generator.generatedAt = '2026-01-01'; }],
  ['empty id', raw => { raw.id = ''; }],
  ['non-string name', raw => { raw.name = null; }],
  ['bad cloud', raw => { raw.cloud.projectId = 3; }],
  ['negative revision', raw => { raw.revision = -1; }],
  ['fractional revision', raw => { raw.revision = 0.5; }],
  ['undefined state field', raw => { raw.initialState.opaque = undefined; }],
  ['undefined wrapper field', raw => { raw.retained = undefined; }],
  ['NaN', raw => { raw.initialState.opaque = NaN; }],
  ['Infinity', raw => { raw.initialState.opaque = Infinity; }],
  ['function', raw => { raw.initialState.opaque = () => {}; }],
  ['symbol value', raw => { raw.initialState.opaque = Symbol('value'); }],
  ['symbol key', raw => { raw.initialState[Symbol('key')] = 'value'; }],
  ['bigint', raw => { raw.initialState.opaque = 1n; }],
  ['cycle', raw => { raw.initialState.opaque = raw.initialState; }],
  ['wrapper cycle', raw => { raw.retained = raw; }],
  ['Date', raw => { raw.initialState.opaque = new Date(0); }],
  ['null prototype', raw => { raw.initialState.opaque = Object.create(null); }],
  ['hidden object field', raw => { Object.defineProperty(raw.initialState, 'hidden', { value: 1 }); }],
  ['sparse array', raw => { raw.initialState.opaque = Array(1); }],
  ['array extra key', raw => { raw.initialState.opaque = Object.assign([], { extra: 1 }); }],
  ['non-enumerable array index', raw => {
    raw.initialState.opaque = ['']; Object.defineProperty(raw.initialState.opaque, '0', { enumerable: false });
  }],
  ['original state before wrapper', raw => { raw.initialState.rootId = 'missing'; raw.id = ''; }],
  ['original schema before wrapper JSON', raw => { raw.initialState.schemaVersion = 10; raw.retained = undefined; }],
  ['wrapper JSON before metadata', raw => { raw.retained = undefined; raw.id = ''; }],
];

it.each(invalid)('preserves stored-project refusal and cause for %s', async (_name, mutate) => {
  const left = project(), right = project(); mutate(left); mutate(right);
  const expected = await outcome(reference(left));
  expect(expected).toHaveProperty('error');
  expect(await outcome(validation.checkStoredWorkspaceProjectWork(right))).toEqual(expected);
});

it.each([['null', null], ['undefined', undefined], ['array', []], ['number', 3], ['string', 'project']])
('preserves the project-payload requirement for %s', async (_label, raw) => {
  expect(await outcome(validation.checkStoredWorkspaceProjectWork(raw))).toEqual(await outcome(reference(raw)));
});

const valid: [string, (raw: any) => void][] = [
  ['missing text defaults', raw => {
    delete element(raw).textPadding; delete element(raw).textWrap; delete element(raw).textOverflow;
  }],
  ['missing grid defaults', raw => {
    element(raw).type = 'grid'; delete element(raw).textWrap; delete element(raw).textOverflow;
  }],
  ['aliases', raw => {
    raw.initialState.variants.default.templates.alias = raw.initialState.variants.default.templates.page;
    raw.retained.alias = raw.initialState.nodes.root.data;
  }],
  ['frozen input', raw => {
    Object.freeze(raw.initialState.nodes.root.data); Object.freeze(raw.initialState); Object.freeze(raw);
  }],
  ['long public id', raw => { raw.id = '根'.repeat(1500); }],
  ['opaque extensions and raw folds', raw => {
    raw.initialState.opaque = { ['長'.repeat(400)]: ['\ud800', '\udc00', '\u0000', '😀'] };
    raw.cloud.opaque = { source: 'original' };
    raw.initialState.variants.default.templates.page.layers[0].collapsed = { opaque: false };
  }],
  ['absent optional fields', raw => { delete raw.cloud; delete raw.revision; delete raw.initialState.generator; }],
];

it.each(valid)('checks %s without changing the original data or references', async (_name, mutate) => {
  const left = project(), right: any = project(); mutate(left); mutate(right);
  const before = structuredClone(right), state = right.initialState, template = state.variants.default.templates.page;
  expect(await outcome(reference(left))).toEqual({ result: undefined });
  expect(await outcome(validation.checkStoredWorkspaceProjectWork(right))).toEqual({ result: undefined });
  expect(right).toStrictEqual(before); expect(right.initialState).toBe(state);
  expect(state.variants.default.templates.page).toBe(template);
  if (_name === 'aliases') {
    expect(state.variants.default.templates.alias).toBe(template);
    expect(right.retained.alias).toBe(state.nodes.root.data);
  }
});

it('runs the real text/grid loader on a disposable clone rather than replacing captured source', async () => {
  const raw: any = project(); delete element(raw).textPadding; delete element(raw).textWrap; delete element(raw).textOverflow;
  raw.initialState.variants.default.templates.page.elements.push({ ...element(raw), id: 'grid', type: 'grid' });
  const before = structuredClone(raw), original = loader.loadOwnedProjectStateWork;
  let loaded: loader.ProjectLoadResult | undefined, privateInput: unknown;
  vi.spyOn(loader, 'loadOwnedProjectStateWork').mockImplementation(function* (input) {
    privateInput = input; loaded = yield* original(input); return loaded;
  });
  await makeWorkHarness().runtime.run(validation.checkStoredWorkspaceProjectWork(raw));
  expect(privateInput).not.toBe(raw.initialState); expect(loaded!.warnings).toEqual([]);
  const elements = loaded!.state.variants.default.templates.page.elements;
  expect(elements[0]).toMatchObject({ textWrap: true, textOverflow: 'clip', textPadding: { top: 0, right: 0, bottom: 0, left: 0 } });
  expect(elements[1]).toMatchObject({ textWrap: false, textOverflow: 'clip' });
  expect(raw).toStrictEqual(before);
});

it.each(['retained', 'state-getter', 'state-setter', 'state-then', 'state-toJSON', 'initialState'] as const)
('preserves entry/accessor behavior for %s without new getter execution', async kind => {
  const make = () => {
    const raw: any = project(), initial = raw.initialState, get = vi.fn(() => kind === 'initialState' ? initial : 1);
    const target = kind.startsWith('state-') ? initial : raw;
    const key = kind === 'state-getter' || kind === 'state-setter' ? 'opaque' : kind === 'state-then' ? 'then' : kind === 'state-toJSON' ? 'toJSON' : kind;
    Object.defineProperty(target, key, { enumerable: true, configurable: true, ...(kind === 'state-setter' ? { set: get } : { get }) });
    return { raw, get };
  };
  const left = make(), right = make(), clone = vi.spyOn(globalThis, 'structuredClone');
  const expected = await outcome(reference(left.raw));
  expect(expected).toHaveProperty('error');
  expect(await outcome(validation.checkStoredWorkspaceProjectWork(right.raw))).toEqual(expected);
  expect(left.get).toHaveBeenCalledTimes(kind === 'initialState' ? 1 : 0);
  expect(right.get).toHaveBeenCalledTimes(left.get.mock.calls.length);
  expect(clone).not.toHaveBeenCalled();
});

it.each([510, 511, 512])('preserves separate state/wrapper depth contexts at nested depth %s', async depth => {
  const left: any = project(), right: any = project();
  left.initialState.opaque = nested(depth); right.initialState.opaque = nested(depth);
  const expected = await outcome(reference(left));
  expect(await outcome(validation.checkStoredWorkspaceProjectWork(right))).toEqual(expected);
  if (depth === 510) expect(expected).toEqual({ result: undefined });
  else expect(expected).toMatchObject({ error: { message: expect.stringMatching(
    depth === 511 ? /^Workspace project must be JSON-compatible:/ : /^Migrated project state must be JSON-compatible:/) } });
});

it.each(['warning', 'invalid-state', 'invalid-json', 'loader-throw'] as const)
('preserves %s from the real loader and releases ownership', async kind => {
  const original = loader.loadOwnedProjectStateWork;
  vi.spyOn(loader, 'loadOwnedProjectStateWork').mockImplementation(function* (input) {
    const result = yield* original(input);
    if (kind === 'warning') result.warnings.push('first warning', 'second warning');
    if (kind === 'invalid-state') result.state.activeVariantId = 'missing';
    if (kind === 'invalid-json') (result.state as any).opaque = undefined;
    if (kind === 'loader-throw') throw new Error('loader fault');
    return result;
  });
  const left = project(), right = project(), before = structuredClone(right);
  const expected = await outcome(reference(left));
  expect(expected).toHaveProperty('error');
  expect(await outcome(validation.checkStoredWorkspaceProjectWork(right))).toEqual(expected);
  if (kind === 'warning') expect(expected).toMatchObject({ error: { message: 'first warning second warning' } });
  expect(right).toEqual(before);
});

it.each(['invalid-clone', 'clone-throw'] as const)('preserves %s before loader execution', async kind => {
  const left = project(), right = project(), before = structuredClone(right), clone = globalThis.structuredClone;
  vi.spyOn(globalThis, 'structuredClone').mockImplementation(value => {
    if (kind === 'clone-throw') throw new DOMException('clone fault', 'DataCloneError');
    const result = clone(value); (result as Record<string, unknown>).rootId = 'missing'; return result;
  });
  const load = vi.spyOn(loader, 'loadOwnedProjectStateWork');
  const expected = await outcome(reference(left));
  expect(expected).toHaveProperty('error');
  expect(await outcome(validation.checkStoredWorkspaceProjectWork(right))).toEqual(expected);
  if (kind === 'invalid-clone') expect(expected).toMatchObject({ error: { message: expect.stringMatching(/^Project state is invalid before migration:/) } });
  expect(load).not.toHaveBeenCalled(); expect(right).toEqual(before);
});

it.each(['before', 'reservation', 'clone', 'loader', 'post-load', 'terminal'] as const)
('releases private state ownership on cancellation at %s', async point => {
  const raw = project(), before = structuredClone(raw), h = makeWorkHarness();
  if (point === 'before') h.cancel();
  if (point === 'reservation') {
    h.runtime.addGuard(() => {
      if (h.runtime.snapshot().ownedBytes > 0) throw new DOMException('cancelled after reservation', 'AbortError');
    });
  }
  if (point === 'clone') {
    const clone = globalThis.structuredClone;
    vi.spyOn(globalThis, 'structuredClone').mockImplementation(value => { const copy = clone(value); h.cancel(); return copy; });
  }
  if (point === 'loader') {
    const original = loader.loadOwnedProjectStateWork;
    vi.spyOn(loader, 'loadOwnedProjectStateWork').mockImplementation(function* (input) {
      const loaded = yield* original(input); yield* effect(1, () => h.cancel()); return loaded;
    });
  }
  if (point === 'post-load') {
    const original = app.inspectAppStateWork; let calls = 0;
    vi.spyOn(app, 'inspectAppStateWork').mockImplementation(function* (input, version) {
      const call = ++calls, result = yield* original(input, version);
      if (call === 2) yield* effect(1, () => h.cancel());
      return result;
    });
  }
  const program = (function* () {
    yield* validation.checkStoredWorkspaceProjectWork(raw);
    if (point === 'terminal') h.cancel();
  })();
  await expect(h.runtime.run(program)).rejects.toMatchObject({ name: 'AbortError' });
  expect(h.runtime.snapshot().ownedBytes).toBe(0); expect(raw).toStrictEqual(before);
  if (point !== 'before') expect(h.runtime.snapshot().ownedHighWater).toBeGreaterThan(0);
});

it('preserves authentic long-string cancellation and ignores passive observer exceptions', async () => {
  const raw = project(); raw.initialState.nodes.root.title = '根😀'.repeat(10000);
  const before = structuredClone(raw), h = makeWorkHarness(); let notifications = 0;
  h.observe(() => { notifications++; throw new Error('passive observer'); });
  await h.runtime.run(validation.checkStoredWorkspaceProjectWork(raw));
  expect(notifications).toBeGreaterThan(0); expect(h.runtime.snapshot().ownedBytes).toBe(0);
  const cancelled = makeWorkHarness(); cancelled.observe(() => cancelled.cancel());
  await expect(cancelled.runtime.run(validation.checkStoredWorkspaceProjectWork(raw))).rejects.toMatchObject({ name: 'AbortError' });
  expect(cancelled.runtime.snapshot().yields).toBeLessThan(h.runtime.snapshot().yields);
  expect(cancelled.runtime.snapshot().ownedBytes).toBe(0); expect(raw).toEqual(before);
});

it.each(['loader', 'post-load'] as const)('cancels during unfinished %s traversal without starting later work', async point => {
  const raw = project(), template = raw.initialState.variants.default.templates.page;
  template.elements = Array.from({ length: 80 }, (_, index) => ({ ...template.elements[0], id: `element-${index}` }));
  const before = structuredClone(raw), h = makeWorkHarness();
  let active: 'loader' | 'post-load' | undefined, startVisits = 0, ownedAtAbort = 0;
  let loaderStarted = false, loaderFinished = false, postFinished = false;
  const originalLoader = loader.loadOwnedProjectStateWork, originalValidation = app.validateAppStateWork, originalInspection = app.inspectAppStateWork;
  vi.spyOn(loader, 'loadOwnedProjectStateWork').mockImplementation(function* (input) {
    loaderStarted = true; active = 'loader'; startVisits = h.runtime.snapshot().visits;
    const loaded = yield* originalLoader(input);
    loaderFinished = true; active = undefined; return loaded;
  });
  let semanticCalls = 0;
  vi.spyOn(app, 'validateAppStateWork').mockImplementation(function* (input, mode) {
    semanticCalls++; return yield* originalValidation(input, mode);
  });
  vi.spyOn(app, 'inspectAppStateWork').mockImplementation(function* (input, version) {
    const call = ++semanticCalls;
    if (call === 3) { active = 'post-load'; startVisits = h.runtime.snapshot().visits; }
    const result = yield* originalInspection(input, version);
    if (call === 3) { postFinished = true; active = undefined; }
    return result;
  });
  h.runtime.addGuard(() => {
    const counters = h.runtime.snapshot();
    if (active === point && counters.visits - startVisits >= 128) {
      ownedAtAbort = counters.ownedBytes;
      throw new DOMException(`cancelled inside ${point}`, 'AbortError');
    }
  });
  await expect(h.runtime.run(validation.checkStoredWorkspaceProjectWork(raw))).rejects.toMatchObject({ name: 'AbortError' });
  expect(loaderStarted).toBe(true); expect(loaderFinished).toBe(point === 'post-load');
  expect(postFinished).toBe(false); expect(semanticCalls).toBe(point === 'loader' ? 2 : 3);
  expect(ownedAtAbort).toBeGreaterThan(0); expect(h.runtime.snapshot().ownedBytes).toBe(0);
  expect(raw).toStrictEqual(before);
});

it.each([0, 1])('preserves the generator script boundary with %s extra bytes', async extra => {
  const make = () => {
    const raw = project(); raw.initialState.generator!.templateScript = 'x'.repeat(GENERATOR_SCRIPT_MAX_BYTES + extra); return raw;
  };
  const expected = await outcome(reference(make()));
  expect(await outcome(validation.checkStoredWorkspaceProjectWork(make()))).toEqual(expected);
  if (extra) expect(expected).toHaveProperty('error'); else expect(expected).toEqual({ result: undefined });
});

const stateBytes = (state: unknown) => Buffer.byteLength(JSON.stringify(state), 'utf8');
function sizedProject(delta: number, mutate: (raw: any) => void = () => {}) {
  const raw: any = project(); mutate(raw); raw.initialState.opaquePadding = '';
  raw.initialState.opaquePadding = 'x'.repeat(MAX_STATE_BYTES + delta - stateBytes(raw.initialState));
  expect(stateBytes(raw.initialState)).toBe(MAX_STATE_BYTES + delta);
  return raw;
}

it.each([-1, 0, 1])('large-state retains the real AppState limit with byte delta %s', async delta => {
  const expected = await outcome(reference(sizedProject(delta)));
  expect(await outcome(validation.checkStoredWorkspaceProjectWork(sizedProject(delta)))).toEqual(expected);
  if (delta > 0) expect(expected).toMatchObject({ error: { message: `Migrated project state is invalid: state exceeds ${MAX_STATE_BYTES} bytes` } });
  else expect(expected).toEqual({ result: undefined });
}, 360000);

it('large-state checks the loaded size after defaults grow an originally legal state', async () => {
  const make = () => sizedProject(0, raw => { delete element(raw).textPadding; });
  const expected = await outcome(reference(make()));
  expect(expected).toMatchObject({ error: { message: `Migrated project state is invalid: state exceeds ${MAX_STATE_BYTES} bytes` } });
  expect(await outcome(validation.checkStoredWorkspaceProjectWork(make()))).toEqual(expected);
}, 360000);

it('large-state checks clone representation size before the loader can run', async () => {
  const make = () => sizedProject(0, raw => {
    raw.initialState.opaque = ['']; Object.defineProperty(raw.initialState.opaque, '0', { enumerable: false });
  });
  const load = vi.spyOn(loader, 'loadOwnedProjectStateWork');
  const expected = await outcome(reference(make()));
  expect(expected).toMatchObject({ error: { message: `Project state is invalid before migration: state exceeds ${MAX_STATE_BYTES} bytes` } });
  expect(await outcome(validation.checkStoredWorkspaceProjectWork(make()))).toEqual(expected);
  expect(load).not.toHaveBeenCalled();
}, 360000);

it('large-state does not apply the AppState limit to opaque wrapper extensions', async () => {
  const make = () => ({ ...project(), retained: 'x'.repeat(MAX_STATE_BYTES + 1) });
  expect(await outcome(reference(make()))).toEqual({ result: undefined });
  expect(await outcome(validation.checkStoredWorkspaceProjectWork(make()))).toEqual({ result: undefined });
}, 360000);
