// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import * as json from '../../../../shared/jsonWork.js';
import { runSync, type Work } from '../../../../shared/cooperativeWork.js';
import { digestFrame } from '../../../../services/localWorkspace/canonical';
import { makeWorkHarness } from '../../../helpers/normalizationWorkHarness';
type Comparison = { equal: boolean; bytes: number };
function api(): (left: unknown, right: unknown, emit?: json.JsonEmit) => Work<Comparison> {
  const fn = Reflect.get(json, 'compareCanonicalWork'); expect(fn, 'canonical content comparison').toBeTypeOf('function'); return fn;
}
const values: unknown[] = [null, true, false, 0, -0, -0.0000012345678901234567, Number.MAX_VALUE,
  '', 'a', '根😀\ud800', 'quote"\\\n', [], {}, [1, null, 'x'],
  { z: 1, a: 'foo', b: { long: 'x'.repeat(2048) } }, { a: 1, ['z'.repeat(36)]: -0.0000012345678901234567 }];
afterEach(() => vi.restoreAllMocks());

it('compares paired object data without a second key sort or syntax comparisons', async () => {
  const value = { zebra: 17, alpha: true, middle: null, beta: 29 }, h = makeWorkHarness(), reference = makeWorkHarness();
  await reference.runtime.run(json.canonicalBytesWork(value));
  expect(await h.runtime.run(api()(value, { beta: 29, middle: null, alpha: true, zebra: 17 })))
    .toEqual({ equal: true, bytes: Buffer.byteLength(json.canonicalText(value)) });
  expect(h.runtime.snapshot().sortComparisons).toBe(reference.runtime.snapshot().sortComparisons);
  expect(h.runtime.snapshot().comparedCodeUnits).toBe(reference.runtime.snapshot().comparedCodeUnits);
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it('formats an equal numeric payload once, not once per comparison side', async () => {
  const value = { number: 178.1234567890123 }, expected = json.canonicalText(value), h = makeWorkHarness();
  const stringify = vi.spyOn(JSON, 'stringify');
  expect(await h.runtime.run(api()(value, { ...value }))).toEqual({ equal: true, bytes: Buffer.byteLength(expected) });
  expect(stringify.mock.calls.filter(([input]) => input === value.number)).toHaveLength(1);
});

it.each(values.map((value, index) => [index, value] as const))('matches canonical equality/bytes and expected output for value %i', async (_index, value) => {
  const compare = api(), h = makeWorkHarness(), expected = json.canonicalText(value), parts: string[] = [];
  const result = await h.runtime.run(compare(value, structuredClone(value), function* (part) { parts.push(part); }));
  expect(result).toEqual({ equal: true, bytes: Buffer.byteLength(expected) }); expect(parts.join('')).toBe(expected);
  expect(parts.every(part => part.length <= 64 && Buffer.byteLength(part) <= 192)).toBe(true);
  expect(runSync(compare(value, structuredClone(value)))).toEqual(result); expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it('matches the independent serialized equality oracle across different JSON values', async () => {
  const compare = api(), h = makeWorkHarness();
  for (const left of values) for (const right of values) {
    const expected = json.canonicalText(left) === json.canonicalText(right);
    expect((await h.runtime.run(compare(left, right))).equal).toBe(expected);
  }
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it('retains lexical object semantics, aliases and required hash bytes', async () => {
  const compare = api(), h = makeWorkHarness(), child = { label: 'shared', value: 3 };
  const left = { z: child, a: child }, right = { a: { value: 3, label: 'shared' }, z: { value: 3, label: 'shared' } };
  const digest = await digestFrame(function* (emit) { expect((yield* compare(left, right, emit)).equal).toBe(true); }, h.runtime, 'target');
  expect(digest).toBe(createHash('sha256').update(json.canonicalText(left)).digest('hex'));
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it.each(['getter', 'symbol', 'hidden', 'sparse', 'cycle', 'prototype', 'undefined', 'NaN', 'bigint', 'depth'] as const)
('does not certify identical invalid %s values', async kind => {
  const compare = api(), h = makeWorkHarness(); let value: any = { a: 1 }, gets = 0;
  if (kind === 'getter') Object.defineProperty(value, 'a', { enumerable: true, get() { gets++; return 1; } });
  if (kind === 'symbol') value[Symbol('bad')] = 1;
  if (kind === 'hidden') Object.defineProperty(value, 'a', { enumerable: false, value: 1 });
  if (kind === 'sparse') value = new Array(2);
  if (kind === 'cycle') value.a = value;
  if (kind === 'prototype') value = new Date();
  if (kind === 'undefined') value.a = undefined;
  if (kind === 'NaN') value.a = NaN;
  if (kind === 'bigint') value.a = 1n;
  if (kind === 'depth') { for (let i = 0; i < 513; i++) value = { value }; }
  expect(() => json.canonicalText(value)).toThrow();
  await expect(h.runtime.run(compare(value, value))).rejects.toThrow();
  expect(gets).toBe(0); expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it('does not materialize or emit JSON text when comparison has no hash consumer', async () => {
  const compare = api(), h = makeWorkHarness(), text = '"\\\n'.repeat(8192);
  const result = await h.runtime.run(compare(text, text));
  expect(result).toEqual({ equal: true, bytes: Buffer.byteLength(JSON.stringify(text)) });
  expect(h.runtime.snapshot().hashBytes).toBe(0); expect(h.runtime.snapshot().ownedHighWater).toBeLessThanOrEqual(128);
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it('closes both comparison producers on cancellation', async () => {
  const compare = api(), h = makeWorkHarness(); h.observe(() => h.cancel());
  await expect(h.runtime.run(compare({ text: 'x'.repeat(8192) }, { text: 'x'.repeat(8192) }))).rejects.toMatchObject({ name: 'AbortError' });
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});
