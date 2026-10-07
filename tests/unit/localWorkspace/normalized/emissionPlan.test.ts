// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createWorkRuntime, effect, type Work, type WorkRuntime } from '../../../../shared/cooperativeWork.js';
import * as jsonWork from '../../../../shared/jsonWork.js';
import { makeWorkHarness } from '../../../helpers/normalizationWorkHarness';
import { makeEmissionSource } from '../../../helpers/normalizationEmissionFixtures';
import type { EmissionBuilder, EmissionPlan, EmissionCursor, EmissionRecipe } from '../../../../services/localWorkspace/normalized/emissionPlan';

const modules = import.meta.glob('../../../../services/localWorkspace/normalized/emissionPlan.ts', { eager: true });
function api(): typeof import('../../../../services/localWorkspace/normalized/emissionPlan') {
  const module = modules['../../../../services/localWorkspace/normalized/emissionPlan.ts'];
  expect(module, 'private emission module exists').toBeDefined(); return module as ReturnType<typeof api>;
}
const rootPath = ['records', 'projects', 0, 'project', 'initialState', 'nodes', 'root'] as const;
async function appendNode(builder: EmissionBuilder, work: WorkRuntime, value: EmissionRecipe, id = 'root') {
  const items: [number, EmissionRecipe][] = [];
  for (const part of ['g', 'p', 'i', id]) items.push([items.length, await work.run(builder.literal(part))]);
  const key = await work.run(builder.array(items.length, items));
  const record = await work.run(builder.object([
    ['key', key], ['formatVersion', await work.run(builder.literal(3))], ['value', value],
    ['encodedSize', await work.run(builder.object([['valueBytes', await work.run(builder.literal(1))]]))],
  ]));
  await work.run(builder.append('projectNodes', record));
}
async function fixture() {
  const source = makeEmissionSource(); const w = makeWorkHarness(); const builder = api().createEmissionBuilder(source);
  let plan: EmissionPlan | undefined;
  try {
    await appendNode(builder, w.runtime, await w.runtime.run(builder.borrow(rootPath)));
    await appendNode(builder, w.runtime, await w.runtime.run(builder.literal('second')), 'second');
    await w.runtime.run(effect(1, () => { plan = builder.finish(); }));
    return { source, w, builder, plan: plan! };
  } catch (error) { if (plan) api().disposeEmissionPlan(plan); throw error; }
  finally { builder.dispose(); }
}

it('replays finalized envelopes while borrowing source payload and releasing all ownership', async () => {
  const f = await fixture(); let cursor: EmissionCursor | undefined;
  try {
    const held = f.w.runtime.snapshot().ownedBytes; expect(held).toBeGreaterThan(0);
    await f.w.runtime.run(effect(1, () => { cursor = api().openEmissionCursor(f.plan, f.source, 0); }));
    const next = await f.w.runtime.run(cursor!.next()); expect(next.done).toBe(false);
    if (next.done === true) throw new Error('Expected node');
    expect(next.value).toMatchObject({ store: 'projectNodes', record: { key: ['g', 'p', 'i', 'root'], formatVersion: 3, encodedSize: { valueBytes: 1 } } });
    expect(next.value.record.value).toBe(f.source.records.projects[0].project.initialState.nodes.root);
    expect(f.w.runtime.snapshot().ownedBytes).toBeGreaterThan(held);
    expect((await f.w.runtime.run(cursor!.next())).done).toBe(false);
    expect((await f.w.runtime.run(cursor!.next())).done).toBe(true);
    cursor!.dispose(); expect(f.w.runtime.snapshot().ownedBytes).toBe(held);
    expect(f.w.runtime.snapshot().hashBytes).toBe(0);
  } finally { cursor?.dispose(); api().disposeEmissionPlan(f.plan); }
  expect(f.w.runtime.snapshot().ownedBytes).toBe(0);
});

it('seeks directly to a suffix without looking up a skipped source location', async () => {
  const f = await fixture(); const node = f.source.records.projects[0].project.initialState.nodes;
  let getters = 0; Object.defineProperty(node, 'root', { enumerable: true, get() { getters++; throw new Error('skipped payload'); } });
  const cursor = api().openEmissionCursor(f.plan, f.source, 1);
  try { expect(await f.w.runtime.run(cursor.next())).toMatchObject({ done: false, value: { record: { value: 'second' } } }); expect(getters).toBe(0); }
  finally { cursor.dispose(); api().disposeEmissionPlan(f.plan); }
});

it.each(['forged', 'cloned-plan', 'foreign-source', 'negative', 'fractional', 'past-end'] as const)
('rejects %s before opening replay', async kind => {
  const f = await fixture();
  try {
    expect(() => api().openEmissionCursor(kind === 'forged' ? {} as EmissionPlan : kind === 'cloned-plan' ? structuredClone(f.plan) : f.plan,
      kind === 'foreign-source' ? structuredClone(f.source) : f.source,
      kind === 'negative' ? -1 : kind === 'fractional' ? 0.5 : kind === 'past-end' ? 3 : 0)).toThrow();
  } finally { api().disposeEmissionPlan(f.plan); }
  expect(f.w.runtime.snapshot().ownedBytes).toBe(0);
});

it('supports an empty suffix and makes genuine disposal idempotent', async () => {
  const f = await fixture(); const cursor = api().openEmissionCursor(f.plan, f.source, 2);
  expect(await f.w.runtime.run(cursor.next())).toEqual({ done: true, value: undefined });
  cursor.dispose(); cursor.dispose(); api().disposeEmissionPlan(f.plan); api().disposeEmissionPlan(f.plan);
  await expect(f.w.runtime.run(cursor.next())).rejects.toThrow(/disposed/i);
  expect(() => api().openEmissionCursor(f.plan, f.source, 0)).toThrow(); expect(f.w.runtime.snapshot().ownedBytes).toBe(0);
});

it.each(['path', 'tuple', 'field', 'source'] as const)('rejects a %s getter without executing it', async kind => {
  const source = makeEmissionSource(); const w = makeWorkHarness(); const builder = api().createEmissionBuilder(source); let calls = 0;
  const get = () => { calls++; throw new Error('getter invoked'); };
  try {
    const recipe = await w.runtime.run(builder.literal(1));
    if (kind === 'source') Object.defineProperty(source.records.projects[0].project.initialState.nodes, 'root', { enumerable: true, get });
    const path = [...rootPath]; if (kind === 'path') Object.defineProperty(path, 0, { enumerable: true, get });
    const fields: [string, EmissionRecipe][] = [['value', recipe]];
    if (kind === 'tuple') Object.defineProperty(fields, 0, { enumerable: true, get });
    if (kind === 'field') Object.defineProperty(fields[0], 0, { enumerable: true, get });
    await expect(w.runtime.run(kind === 'path' || kind === 'source' ? builder.borrow(path) : builder.object(fields))).rejects.toThrow();
    expect(calls).toBe(0);
  } finally { builder.dispose(); }
  expect(w.runtime.snapshot().ownedBytes).toBe(0);
});

it.each(['missing', 'getter'] as const)('fails replay of a now-invalid %s source address without exposing a record', async kind => {
  const f = await fixture(); let calls = 0;
  const nodes = f.source.records.projects[0].project.initialState.nodes;
  if (kind === 'missing') delete nodes.root;
  else Object.defineProperty(nodes, 'root', { enumerable: true, get() { calls++; return {}; } });
  const cursor = api().openEmissionCursor(f.plan, f.source, 0);
  try { await expect(f.w.runtime.run(cursor.next())).rejects.toThrow(/source location/); expect(calls).toBe(0); }
  finally { cursor.dispose(); api().disposeEmissionPlan(f.plan); }
  expect(f.w.runtime.snapshot().ownedBytes).toBe(0);
});

it('rejects foreign recipes and transfers plan ownership only once', async () => {
  const source = makeEmissionSource(); const w = makeWorkHarness(); const a = api().createEmissionBuilder(source); const b = api().createEmissionBuilder(source);
  try {
    expect(() => a.finish()).toThrow();
    const foreign = await w.runtime.run(b.literal(1));
    await expect(w.runtime.run(a.object([['value', foreign]]))).rejects.toThrow();
  } finally { a.dispose(); b.dispose(); }
  const f = await fixture();
  try {
    expect(() => f.builder.finish()).toThrow(); await expect(f.w.runtime.run(f.builder.literal(1))).rejects.toThrow();
    const cursor = api().openEmissionCursor(f.plan, f.source, 0);
    expect(() => api().openEmissionCursor(f.plan, f.source, 0)).toThrow();
    api().disposeEmissionPlan(f.plan); await expect(f.w.runtime.run(cursor.next())).rejects.toThrow();
  } finally { api().disposeEmissionPlan(f.plan); }
  expect(w.runtime.snapshot().ownedBytes).toBe(0); expect(f.w.runtime.snapshot().ownedBytes).toBe(0);
});

it('keeps sparse array presence and prototype-like property names as data', async () => {
  const source = makeEmissionSource(); const w = makeWorkHarness(); const builder = api().createEmissionBuilder(source);
  let plan: EmissionPlan | undefined; let cursor: EmissionCursor | undefined;
  try {
    const scalar = await w.runtime.run(builder.literal(false));
    const array = await w.runtime.run(builder.array(3, [[1, scalar]]));
    const value = await w.runtime.run(builder.object([['__proto__', array], ['2', scalar], ['根', scalar]]));
    await appendNode(builder, w.runtime, value); await w.runtime.run(effect(1, () => { plan = builder.finish(); }));
    cursor = api().openEmissionCursor(plan!, source, 0); const next = await w.runtime.run(cursor.next());
    if (next.done === true) throw new Error('Expected record');
    expect(Object.getPrototypeOf(next.value.record.value)).toBe(Object.prototype);
    expect(Object.keys(next.value.record.value)).toEqual(['2', '__proto__', '根']);
    const raw = Reflect.get(next.value.record.value, '__proto__');
    expect(raw).toHaveLength(3); expect(0 in raw).toBe(false); expect(1 in raw).toBe(true); expect(2 in raw).toBe(false);
  } finally { cursor?.dispose(); builder.dispose(); if (plan) api().disposeEmissionPlan(plan); }
  expect(w.runtime.snapshot().ownedBytes).toBe(0);
});

it('metadata ownership stays independent of borrowed opaque body length', async () => {
  const held: number[] = []; const peaks: number[] = [];
  for (const length of [1, 200000]) {
    const source = makeEmissionSource(); Object.assign(source.records.projects[0].project.initialState.nodes.root, { body: 'x'.repeat(length) });
    const w = makeWorkHarness(); const builder = api().createEmissionBuilder(source); let plan: EmissionPlan | undefined; let cursor: EmissionCursor | undefined;
    try {
      await appendNode(builder, w.runtime, await w.runtime.run(builder.borrow(rootPath)));
      await w.runtime.run(effect(1, () => { plan = builder.finish(); })); held.push(w.runtime.snapshot().ownedBytes);
      cursor = api().openEmissionCursor(plan!, source, 0); await w.runtime.run(cursor.next()); peaks.push(w.runtime.snapshot().ownedHighWater);
    } finally { cursor?.dispose(); builder.dispose(); if (plan) api().disposeEmissionPlan(plan); }
    expect(w.runtime.snapshot().ownedBytes).toBe(0);
  }
  expect(held[0]).toBeGreaterThan(0); expect(held[1]).toBe(held[0]); expect(peaks[1]).toBe(peaks[0]);
});

it('registers a builder lease before a post-growth guard can fail', async () => {
  let work: WorkRuntime | undefined; const source = makeEmissionSource();
  work = createWorkRuntime({ assertCurrent() { if ((work?.snapshot().ownedBytes ?? 0) > 0) throw new DOMException('cancelled', 'AbortError'); } });
  const builder = api().createEmissionBuilder(source);
  try { await expect(work.run(builder.literal(1))).rejects.toMatchObject({ name: 'AbortError' }); }
  finally { builder.dispose(); expect(work.snapshot().ownedBytes).toBe(0); work.dispose(); }
});

it('refuses disposal during the first builder suspension without allocating afterward', async () => {
  const source = makeEmissionSource(); const w = makeWorkHarness(); const builder = api().createEmissionBuilder(source);
  await w.runtime.run(effect(1024, () => {})); w.observe(() => builder.dispose());
  try { await expect(w.runtime.run(builder.literal(1))).rejects.toThrow(/not open/); }
  finally { builder.dispose(); }
  expect(w.runtime.snapshot().ownedBytes).toBe(0);
});

it.each(['duplicate-field', 'duplicate-index', 'bad-index', 'negative-length', 'long-length', 'sparse-path', 'extra-path-field', 'nonfinite', 'object-literal', 'ledger', 'nonobject-record'] as const)
('refuses malformed recipe metadata %s and releases its partial buffers', async kind => {
  const source = makeEmissionSource(); const w = makeWorkHarness(); const builder = api().createEmissionBuilder(source);
  try {
    const value = await w.runtime.run(builder.literal(1));
    const path: (string | number)[] = [...rootPath];
    if (kind === 'sparse-path') delete path[0];
    if (kind === 'extra-path-field') Object.assign(path, { extra: true });
    const run = kind === 'duplicate-field' ? builder.object([['x', value], ['x', value]])
      : kind === 'duplicate-index' ? builder.array(1, [[0, value], [0, value]])
      : kind === 'bad-index' ? builder.array(1, [[1, value]])
      : kind === 'negative-length' ? builder.array(-1, [])
      : kind === 'long-length' ? builder.array(2 ** 32, [])
      : kind === 'sparse-path' || kind === 'extra-path-field' ? builder.borrow(path)
      : kind === 'nonfinite' ? builder.literal(NaN)
      : kind === 'object-literal' ? builder.literal({} as never)
      : kind === 'ledger' ? builder.append('normalizationLedger' as never, value) : builder.append('projectNodes', value);
    await expect(w.runtime.run<unknown>(run)).rejects.toThrow();
  } finally { builder.dispose(); }
  expect(w.runtime.snapshot().ownedBytes).toBe(0);
});

it.each(['cancel', 'dispose-cursor', 'dispose-plan'] as const)('stops first replay suspension on %s without stranding containers', async kind => {
  const f = await fixture(); const held = f.w.runtime.snapshot().ownedBytes; const cursor = api().openEmissionCursor(f.plan, f.source, 0);
  await f.w.runtime.run(effect(1024, () => {}));
  f.w.observe(() => { if (kind === 'cancel') f.w.cancel(); else if (kind === 'dispose-cursor') cursor.dispose(); else api().disposeEmissionPlan(f.plan); });
  try {
    await expect(f.w.runtime.run(cursor.next())).rejects.toThrow();
    expect(f.w.runtime.snapshot().ownedBytes).toBe(kind === 'dispose-plan' ? 0 : held);
  } finally { cursor.dispose(); api().disposeEmissionPlan(f.plan); }
  expect(f.w.runtime.snapshot().ownedBytes).toBe(0);
});

it('refuses reentrant next without invalidating the already running cursor', async () => {
  const f = await fixture(); const other = makeWorkHarness(); const cursor = api().openEmissionCursor(f.plan, f.source, 0);
  let reentry: Promise<unknown> | undefined;
  await f.w.runtime.run(effect(1024, () => {}));
  f.w.observe(() => { reentry ??= other.runtime.run(cursor.next()).catch(error => error); });
  try {
    expect((await f.w.runtime.run(cursor.next())).done).toBe(false);
    expect(await reentry).toMatchObject({ message: 'Emission cursor already running' });
    expect(other.runtime.snapshot().ownedBytes).toBe(0);
  } finally { cursor.dispose(); api().disposeEmissionPlan(f.plan); }
});

it('charges metadata growth and cooperatively cancels long structural keys', async () => {
  const source = makeEmissionSource(); const w = makeWorkHarness(); const builder = api().createEmissionBuilder(source);
  try {
    const value = await w.runtime.run(builder.literal(false));
    const small = await w.runtime.run(builder.object([['x', value]]));
    await w.runtime.run(builder.append('projectNodes', small)); const before = w.runtime.snapshot().ownedBytes;
    await w.runtime.run(builder.object([['根'.repeat(2000), value]]));
    expect(w.runtime.snapshot().ownedBytes - before).toBeGreaterThan(6000);
    w.observe(() => w.cancel());
    await expect(w.runtime.run(builder.object([['長'.repeat(20000), value]]))).rejects.toMatchObject({ name: 'AbortError' });
  } finally { builder.dispose(); }
  expect(w.runtime.snapshot().ownedBytes).toBe(0);
});

it.each(['cursor', 'plan'] as const)('guards final replay handoff after %s disposal at the last yield', async kind => {
  const f = await fixture(); const measure = makeWorkHarness(); const probe = api().openEmissionCursor(f.plan, f.source, 0);
  await measure.runtime.run(probe.next()); const cost = measure.runtime.snapshot().visits; probe.dispose();
  expect(cost).toBeGreaterThan(1); expect(cost).toBeLessThan(1024);
  const w = makeWorkHarness(); const cursor = api().openEmissionCursor(f.plan, f.source, 0); let fired = false;
  await w.runtime.run(effect(1024 - cost + 1, () => {}));
  w.observe(() => { fired = true; if (kind === 'cursor') cursor.dispose(); else api().disposeEmissionPlan(f.plan); });
  try { await expect(w.runtime.run(cursor.next())).rejects.toThrow(/disposed/); expect(fired).toBe(true); }
  finally { cursor.dispose(); api().disposeEmissionPlan(f.plan); }
  expect(w.runtime.snapshot().ownedBytes).toBe(0); expect(f.w.runtime.snapshot().ownedBytes).toBe(0);
});

it.each(['tuple', 'field', 'path'] as const)('rejects a %s then getter before Work can inspect unvalidated metadata', async kind => {
  const source = makeEmissionSource(); const w = makeWorkHarness(); const builder = api().createEmissionBuilder(source); let calls = 0;
  const trap = {}; Object.defineProperty(trap, 'then', { get() { calls++; throw new Error('then getter'); } });
  try {
    const recipe = await w.runtime.run(builder.literal(1)); const pair: unknown[] = [kind === 'field' ? trap : 'value', recipe];
    if (kind === 'tuple') Object.defineProperty(pair, 'then', { get() { calls++; throw new Error('then getter'); } });
    await expect(w.runtime.run(kind === 'path' ? builder.borrow([trap] as never) : builder.object([pair] as never))).rejects.toThrow();
    expect(calls).toBe(0);
  } finally { builder.dispose(); }
  expect(w.runtime.snapshot().ownedBytes).toBe(0);
});

it('borrows opaque then data without probing it during source lookup or replay', async () => {
  const source = makeEmissionSource(); const w = makeWorkHarness(); const builder = api().createEmissionBuilder(source); let calls = 0;
  const payload = source.records.projects[0].project.initialState.nodes.root;
  Object.defineProperty(payload, 'then', { get() { calls++; throw new Error('opaque then getter'); } });
  let plan: EmissionPlan | undefined; let cursor: EmissionCursor | undefined;
  try {
    await appendNode(builder, w.runtime, await w.runtime.run(builder.borrow(rootPath)));
    await w.runtime.run(effect(1, () => { plan = builder.finish(); })); cursor = api().openEmissionCursor(plan!, source, 0);
    const result = await w.runtime.run(cursor.next());
    if (result.done === true) throw new Error('Expected record');
    expect(result.value.record.value).toBe(payload); expect(calls).toBe(0);
  } finally { cursor?.dispose(); builder.dispose(); if (plan) api().disposeEmissionPlan(plan); }
});

it('owns both merge-sort scratch buffers for a wide metadata object', async () => {
  const w = makeWorkHarness(); const builder = api().createEmissionBuilder(makeEmissionSource());
  const value = await w.runtime.run(builder.literal(false)); const fields = Array.from({ length: 128 }, (_, i) => [`k${String(i).padStart(3, '0')}`, value] as const);
  const before = w.runtime.snapshot().ownedBytes; const copied = 24 + fields.length * (24 + 4);
  const original = jsonWork.stableSortWork; let observed = false;
  function* checkSort<T>(values: readonly T[], compare: (a: T, b: T) => Work<number>): Work<T[]> {
    observed = true;
    expect(w.runtime.snapshot().ownedBytes - before - copied).toBeGreaterThanOrEqual(2 * (24 + values.length * 8));
    return yield* original(values, compare);
  }
  const spy = vi.spyOn(jsonWork, 'stableSortWork').mockImplementation(checkSort);
  try { await w.runtime.run(builder.object(fields)); expect(observed).toBe(true); }
  finally { spy.mockRestore(); builder.dispose(); }
  expect(w.runtime.snapshot().ownedBytes).toBe(0);
});
