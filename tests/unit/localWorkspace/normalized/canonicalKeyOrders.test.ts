// @vitest-environment node
import { expect, it } from 'vitest';
import { canonicalBytesWork, canonicalInspectionWork, canonicalText, canonicalWork } from '../../../../shared/jsonWork.js';
import { effect, runSync, type Work, type WorkRuntime } from '../../../../shared/cooperativeWork.js';
import { makeWorkHarness } from '../../../helpers/normalizationWorkHarness';

async function output(value: unknown, work: WorkRuntime) {
  const parts: string[] = [];
  await work.run(canonicalWork(value, function* (text) { yield* effect(1, () => { parts.push(text); }); }));
  return parts.join('');
}
const row = (index: number) => ({ zebra: `根😀\ud800:${index}`, alpha: index, middle: index % 2 === 0 });

it('builds bounded repeated key signatures without one dispatch per metadata cell', async () => {
  const value = Array.from({ length: 32 }, () => Object.fromEntries(Array.from({ length: 24 }, (_, i) => [`f${23 - i}`, true])));
  const program = canonicalBytesWork(value); let operations = 0;
  function* counted(): Work<number> {
    let result: unknown;
    try { for (;;) { const next = program.next(result); if (next.done === true) return next.value; operations++; result = yield next.value; } }
    finally { program.return(0); }
  }
  const h = makeWorkHarness(); expect(await h.runtime.run(counted())).toBe(Buffer.byteLength(canonicalText(value)));
  expect(operations).toBeLessThan(5000); expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it('checks key membership in bounded groups before touching payload descriptors', async () => {
  const value = Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`field${i}`, i]));
  Object.defineProperty(value, Symbol('invalid'), { value: 1 }); let gets = 0;
  Object.defineProperty(value, 'field0', { enumerable: true, get() { gets++; return 0; } });
  const program = canonicalBytesWork(value); let operations = 0;
  function* counted(): Work<number> {
    let result: unknown;
    try { for (;;) { const next = program.next(result); if (next.done === true) return next.value; operations++; result = yield next.value; } }
    finally { program.return(0); }
  }
  const h = makeWorkHarness(); await expect(h.runtime.run(counted())).rejects.toThrow('symbol keys');
  expect(operations).toBeLessThan(10); expect(gets).toBe(0); expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it.each(['output', 'bytes', 'inspection'] as const)('canonical %s reuses key ordering, never payload values', async mode => {
  const one = makeWorkHarness(), many = makeWorkHarness(), input = Array.from({ length: 64 }, (_, i) => row(i));
  const run = async (value: unknown, work: WorkRuntime) => mode === 'output' ? output(value, work)
    : mode === 'bytes' ? work.run(canonicalBytesWork(value)) : work.run(canonicalInspectionWork(value));
  await run([row(0)], one.runtime);
  const actual = await run(input, many.runtime), expected = canonicalText(input);
  expect(actual).toEqual(mode === 'output' ? expected : mode === 'bytes' ? Buffer.byteLength(expected)
    : { bytes: Buffer.byteLength(expected), maximumDepth: 1 });
  expect(many.runtime.snapshot().sortComparisons).toBe(one.runtime.snapshot().sortComparisons);
  expect(many.runtime.snapshot().ownedHighWater).toBeGreaterThan(4096);
  expect(many.runtime.snapshot().ownedHighWater).toBeLessThanOrEqual(4096 + 16384 + 1024);
  expect(many.runtime.snapshot().ownedBytes).toBe(0);
});

it('canonical ordering identity preserves key boundaries, Unicode, empty names and numeric keys', async () => {
  const input = [
    { '1:a': 1, b: 2 }, { a: 3, '1:b': 4 }, { '': 5, ':': 6 },
    Object.fromEntries([['__proto__', 7], ['😀', 8], ['\ud800', 9], ['2', 10], ['10', 11]]),
    { b: 'changed', '1:a': null }, { '1:a': false, b: [12] },
  ];
  const h = makeWorkHarness(); expect(await output(input, h.runtime)).toBe(canonicalText(input));
  const chunks: string[] = []; runSync(canonicalWork(input, function* (text) { chunks.push(text); }));
  expect(chunks.join('')).toBe(canonicalText(input)); expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it.each(['keys', 'key-length', 'total-length'] as const)('canonical ordering admission %s never becomes an input cap', async kind => {
  const shape = kind === 'keys' ? Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`k${i}`, i]))
    : kind === 'key-length' ? { ['x'.repeat(65)]: 1, a: 2 }
      : Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`${i}:` + 'x'.repeat(24), i]));
  const one = makeWorkHarness(), many = makeWorkHarness(); await output([shape], one.runtime);
  expect(await output([shape, structuredClone(shape)], many.runtime)).toBe(canonicalText([shape, shape]));
  expect(many.runtime.snapshot().sortComparisons).toBe(2 * one.runtime.snapshot().sortComparisons);
  expect(many.runtime.snapshot().ownedBytes).toBe(0);
});

it('canonical ordering metadata stays bounded with many unrelated key shapes', async () => {
  const input = Array.from({ length: 120 }, (_, index) => Object.fromEntries(Array.from({ length: 24 }, (_, i) => [`${index}:field:${23 - i}`, i])));
  input.push(row(1) as any, row(2) as any);
  const h = makeWorkHarness(); expect(await output(input, h.runtime)).toBe(canonicalText(input));
  expect(h.runtime.snapshot().ownedHighWater).toBeGreaterThan(4096);
  expect(h.runtime.snapshot().ownedHighWater).toBeLessThanOrEqual(4096 + 16384 + 1024);
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it.each(['getter', 'hidden', 'undefined', 'cycle', 'prototype'] as const)('canonical key-order hit still rejects current %s data', async kind => {
  const bad: any = { zebra: 'other', alpha: 5, middle: true }; let gets = 0;
  if (kind === 'getter') Object.defineProperty(bad, 'alpha', { enumerable: true, get() { gets++; return 5; } });
  if (kind === 'hidden') Object.defineProperty(bad, 'alpha', { enumerable: false, value: 5 });
  if (kind === 'undefined') bad.alpha = undefined;
  if (kind === 'cycle') bad.alpha = bad;
  if (kind === 'prototype') Object.setPrototypeOf(bad, { inherited: true });
  let expected!: Error; try { canonicalText([row(1), bad]); } catch (error) { expected = error as Error; }
  const h = makeWorkHarness(); await expect(output([row(1), bad], h.runtime)).rejects.toThrow(expected.message);
  expect(gets).toBe(0); expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it.each(['allocation', 'populated'] as const)('canonical ordering releases custody on %s cancellation', async at => {
  const h = makeWorkHarness();
  if (at === 'allocation') h.runtime.addGuard(() => {
    if (h.runtime.snapshot().ownedBytes >= 4096) throw new DOMException('cancel order allocation', 'AbortError');
  });
  else h.observe(() => { if (h.runtime.snapshot().ownedBytes > 4096) h.cancel(); });
  await expect(h.runtime.run(canonicalBytesWork(Array.from({ length: 128 }, (_, i) => row(i))))).rejects.toMatchObject({ name: 'AbortError' });
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});
