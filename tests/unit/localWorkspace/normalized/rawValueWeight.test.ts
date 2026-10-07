// @vitest-environment node
import { expect, it } from 'vitest';
import { rawValueWeightWork } from '../../../../shared/jsonWork.js';
import type { Work } from '../../../../shared/cooperativeWork.js';
import { makeWorkHarness } from '../../../helpers/normalizationWorkHarness';

// Independent synchronous oracle for the documented logical weight, not heap size.
function weight(root: unknown) {
  const seen = new Set<object>(); let unmeasuredValues = 0;
  function visit(value: any): number {
    if (typeof value === 'string') return 8 + Buffer.byteLength(value);
    if (value === null || typeof value !== 'object') {
      if (['bigint', 'symbol', 'function'].includes(typeof value)) unmeasuredValues++;
      return 8;
    }
    if (seen.has(value)) return 8;
    seen.add(value);
    if (value instanceof Date) return 8;
    if (value instanceof ArrayBuffer) return 8 + value.byteLength;
    if (ArrayBuffer.isView(value)) return 8 + visit(value.buffer);
    if (value instanceof Blob) return 8 + value.size;
    if (value instanceof Map) return 8 + [...value].reduce((total, [key, item]) => total + visit(key) + visit(item), 0);
    if (value instanceof Set) return 8 + [...value].reduce((total, item) => total + visit(item), 0);
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) unmeasuredValues++;
    return 8 + Object.keys(value).reduce((total, key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && 'value' in descriptor) return total + Buffer.byteLength(key) + visit(descriptor.value);
      unmeasuredValues++; return total + Buffer.byteLength(key) + 8;
    }, 0);
  }
  const bytes = visit(root); return { bytes, unmeasuredValues };
}

it('measures raw scalar fields in bounded blocks instead of per-field dispatch', async () => {
  const value = Array.from({ length: 32 }, () => ({ a: 1, b: 2, c: 3, d: 4, e: 5, f: true, g: false, h: null, i: '根😀' }));
  const program = rawValueWeightWork(value); let operations = 0;
  function* counted(): Work<Awaited<ReturnType<typeof weight>>> {
    let result: unknown;
    try {
      for (;;) {
        const next = program.next(result);
        if (next.done === true) return next.value;
        expect(next.value.visits).toBeLessThanOrEqual(1024);
        expect(next.value.utf8Bytes).toBeLessThanOrEqual(65536);
        operations++; result = yield next.value;
      }
    } finally { program.return(undefined as never); }
  }
  const h = makeWorkHarness();
  expect(await h.runtime.run(counted())).toEqual(weight(value));
  expect(operations).toBeLessThan(650);
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it.each([0, 1, 63, 64, 127, 250, 251, 500, 501, 511, 512, 513, 1024])
('preserves raw Unicode byte weights at %i units', async length => {
  const text = '\0\\根😀\ud800X\udc00'.repeat(200).slice(0, length);
  const value = { [text]: text, z: 1, a: NaN, b: Infinity, c: -0, d: undefined, e: 1n, f: Symbol('f'), g() {} };
  const h = makeWorkHarness();
  expect(await h.runtime.run(rawValueWeightWork(value))).toEqual(weight(value));
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it('preserves raw alias/cycle, Map/Set, binary and opaque-object accounting', async () => {
  const buffer = new ArrayBuffer(17), shared: any = { text: '根😀', buffer }, array: any[] = [shared, , shared];
  Object.defineProperty(array, '0', { enumerable: false }); (array as any).extra = 'retained';
  const custom = Object.assign(Object.create({ inherited: 'ignored' }), { visible: shared });
  const value: any = { first: shared, array, map: new Map([[shared, new Set([shared, 'text'])]]), custom,
    nullPrototype: Object.assign(Object.create(null), { item: 1 }), date: new Date(0), view: new Uint8Array(buffer), blob: new Blob(['根']) };
  value.self = value; shared.parent = value;
  Object.defineProperty(value, 'hidden', { value: 'ignored' }); value[Symbol('ignored')] = 1;
  const h = makeWorkHarness();
  expect(await h.runtime.run(rawValueWeightWork(value))).toEqual(weight(value));
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it('counts accessor fields as opaque without invoking getters or thenables', async () => {
  let gets = 0;
  const value: any = { a: 1, b: 'plain', c: { nested: true }, d: 2 };
  Object.defineProperty(value, 'then', { enumerable: true, get() { gets++; throw Error('getter'); } });
  Object.defineProperty(value, 'toJSON', { enumerable: true, get() { gets++; throw Error('getter'); } });
  const h = makeWorkHarness();
  expect(await h.runtime.run(rawValueWeightWork(value))).toEqual(weight(value));
  expect(gets).toBe(0); expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it.each(['before', 'reservation', 'work', 'descriptor-error'] as const)('releases raw-measurement scratch on %s', async point => {
  const h = makeWorkHarness();
  let value: unknown = Array.from({ length: 40 }, () => ({ a: '根😀'.repeat(30), b: 2, c: true }));
  if (point === 'before') h.cancel();
  if (point === 'reservation') h.runtime.addGuard(() => {
    if (h.runtime.snapshot().ownedBytes > 0) throw new DOMException('cancelled after reservation', 'AbortError');
  });
  if (point === 'work') h.observe(() => h.cancel());
  if (point === 'descriptor-error') value = new Proxy({ a: 1 }, { getOwnPropertyDescriptor() { throw Error('descriptor fault'); } });
  await expect(h.runtime.run(rawValueWeightWork(value))).rejects.toThrow(point === 'descriptor-error' ? 'descriptor fault' : /cancelled/);
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});
