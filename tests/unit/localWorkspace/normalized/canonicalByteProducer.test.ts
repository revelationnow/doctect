// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import * as json from '../../../../shared/jsonWork.js';
import { digestFrame } from '../../../../services/localWorkspace/canonical';
import { effect } from '../../../../shared/cooperativeWork.js';
import type { Work, Operation, Metric } from '../../../../shared/cooperativeWork.js';
import { makeWorkHarness } from '../../../helpers/normalizationWorkHarness';

afterEach(() => vi.restoreAllMocks());
function output() {
  expect((json as any).utf8JsonOutput).toBeTypeOf('function');
  const bytes: Uint8Array[] = [], text: string[] = [];
  const emit = (json as any).utf8JsonOutput(function* (value: string) { text.push(value); }, function* (value: Uint8Array) {
    expect(value).toBeInstanceOf(Uint8Array); expect(value.length).toBeLessThanOrEqual(192);
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(value)).not.toThrow(); bytes.push(Uint8Array.from(value));
  });
  return { emit, bytes, text, result: () => Buffer.concat(bytes).toString('utf8') };
}
function* counted(program: Work<unknown>, note = () => {}, metric?: (name: Metric, amount: number) => void): Work<unknown> {
  let result: unknown, throwing = false;
  try { for (;;) { const next = throwing ? program.throw(result) : program.next(result); if (next.done === true) return next.value;
    expect(next.value.visits).toBeLessThanOrEqual(1024); expect(next.value.utf8Bytes).toBeLessThanOrEqual(65536);
    note();
    const operation = next.value;
    // Only producer operations use this optional test facade; digest operations
    // retain their genuine runtime identity in all integration tests.
    const observed: Operation = metric ? { ...operation, run(runtime) {
      return operation.run(runtime && { ...runtime, note(name, amount = 1) { metric(name, amount); runtime.note(name, amount); } });
    } } : operation;
    try { result = yield observed; throwing = false; }
    catch (error) { result = error; throwing = true; }
  } } finally { program.return(undefined as never); }
}
async function collect(value: unknown, other?: { value: unknown }) {
  const sink = output(), h = makeWorkHarness(); let operations = 0;
  const program = other ? json.emitComparedCanonicalWork(value, other.value, sink.emit) : json.canonicalWork(value, sink.emit);
  try { return { result: await h.runtime.run(counted(program, () => { operations++; })), text: sink.result(), stringCallbacks: sink.text, operations, counters: h.runtime.snapshot() }; }
  finally { expect(h.runtime.snapshot().ownedBytes).toBe(0); }
}

it('delivers canonical bytes directly and eliminates per-field/fragment dispatch', async () => {
  const value = Array.from({ length: 32 }, (_, index) => ({ width: 10, height: 20, x: index, visible: true, label: 'read this\n根😀'.repeat(12) }));
  const actual = await collect(value); expect(actual.text).toBe(json.canonicalText(value)); expect(actual.stringCallbacks).toEqual([]);
  let operations = 0; const h = makeWorkHarness();
  const program = json.canonicalWork(value, function* () {});
  await h.runtime.run(counted(program, () => { operations++; }));
  expect(actual.operations).toBeLessThan(operations / 2);
});

it.each([0, 1, 55, 56, 63, 64, 65, 127, 128, 191, 192, 193, 511, 512, 513, 4096])
('preserves UTF-8/escape output at %i UTF-16 units', async length => {
  const value = '\0\b\t\n\f\r"\\abc根😀\ud800X\udc00'.repeat(300).slice(0, length);
  const actual = await collect({ [value]: value, zero: -0, fraction: -0.0000012345678901234567 });
  expect(actual.text).toBe(json.canonicalText({ [value]: value, zero: -0, fraction: -0.0000012345678901234567 }));
});

it.each(Array.from({ length: 16 }, (_, index) => index * 4096))('matches every UTF-16 unit in block %i', async start => {
  const values = Array.from({ length: 4096 }, (_, index) => String.fromCharCode(start + index));
  expect((await collect(values)).text).toBe(JSON.stringify(values));
});

it.each([null, true, false, -0, Number.MAX_VALUE, Number.MIN_VALUE, [1, 'a', null], { z: 1, a: ['根', { foo: false }] }].map(value => ({ value })))
('matches native SHA and independent text for JSON value %#', async ({ value }) => {
  const text = json.canonicalText(value), result = await collect(value);
  expect(result.text).toBe(text);
  expect(await makeWorkHarness().runtime.run(json.canonicalBytesWork(value))).toBe(Buffer.byteLength(text));
  expect(await digestFrame(emit => json.canonicalWork(value, emit), makeWorkHarness().runtime, 'source'))
    .toBe(createHash('sha256').update(text).digest('hex'));
});

it('combines paired validation/equality with expected-byte output without sorting actual keys', async () => {
  const left = { z: [{ x: 'same'.repeat(500), y: -0 }], a: true }, right = { a: true, z: [{ y: 0, x: 'same'.repeat(500) }] };
  const result = await collect(left, { value: right }); expect(result.result).toBe(true); expect(result.text).toBe(json.canonicalText(left));
  expect(result.stringCallbacks).toEqual([]);
});

it('feeds canonical hash consumers without allocating encoded text fragments', async () => {
  const value = { z: '根😀escaped\n'.repeat(100), a: [0, -0, true, null] }, text = json.canonicalText(value);
  const encode = vi.spyOn(TextEncoder.prototype, 'encode');
  const h = makeWorkHarness();
  expect(await digestFrame(emit => json.canonicalWork(value, emit), h.runtime, 'source')).toBe(createHash('sha256').update(text).digest('hex'));
  expect(encode).not.toHaveBeenCalled(); expect(h.runtime.snapshot().ownedBytes).toBe(0);
});
it.each([null, 1, { other: 'x' }, { a: 'different' }, { a: 'same', extra: 1 }])('refuses unequal peer %#', async peer => {
  expect((await collect({ a: 'same' }, { value: peer })).result).toBe(false);
});

const invalid = () => {
  const cycle: any = {}; cycle.self = cycle;
  return [undefined, NaN, Infinity, 1n, Symbol('value'), () => {}, new Date(0), Object.create(null), cycle,
    Array(1), Object.assign([], { extra: 1 }), Object.defineProperty({}, 'hidden', { value: 1 }),
    { [Symbol('key')]: 1 }, Object.defineProperty({}, 'value', { enumerable: true, get() { throw Error('getter executed'); } })];
};
it.each(Array.from({ length: 14 }, (_, index) => index))('keeps canonical refusal for invalid input %i', async index => {
  const value = invalid()[index]; let expected: Error | undefined;
  try { json.canonicalText(value); } catch (error) { expected = error as Error; }
  expect(expected).toBeDefined();
  await expect(collect(value)).rejects.toThrow(expected!.message);
  await expect(collect(value, { value })).rejects.toThrow(expected!.message);
});

it.each([511, 512, 513])('keeps container depth semantics at %i', async depth => {
  let value: unknown = {}; for (let index = 0; index < depth; index++) value = { child: value };
  if (depth > 512) await expect(collect(value)).rejects.toThrow('nesting exceeds 512');
  else expect((await collect(value)).text).toBe(json.canonicalText(value));
});
it('keeps acyclic aliases and releases scratch on consumer error and cancellation', async () => {
  const shared = { value: 'same' }, value = { a: shared, b: shared };
  expect((await collect(value)).text).toBe(json.canonicalText(value));
  const h = makeWorkHarness(), emit = (json as any).utf8JsonOutput(function* () {}, function* () { throw Error('consumer failed'); });
  await expect(h.runtime.run(json.canonicalWork(value, emit))).rejects.toThrow('consumer failed'); expect(h.runtime.snapshot().ownedBytes).toBe(0);
  const cancelled = makeWorkHarness(); cancelled.observe(() => cancelled.cancel());
  const sink = output(); await expect(cancelled.runtime.run(json.canonicalWork('x'.repeat(100000), sink.emit))).rejects.toMatchObject({ name: 'AbortError' });
  expect(cancelled.runtime.snapshot().ownedBytes).toBe(0);
});

it('keeps producer error handling active when observing operation counts', async () => {
  const prefixes: string[] = [];
  for (const wrapped of [false, true]) {
    const sink = output(), h = makeWorkHarness(), program = json.canonicalWork({ a: 1, b: undefined }, sink.emit);
    await expect(h.runtime.run(wrapped ? counted(program) : program)).rejects.toThrow('undefined values');
    prefixes.push(sink.result()); expect(h.runtime.snapshot().ownedBytes).toBe(0);
  }
  expect(prefixes).toEqual(['{"a":1', '{"a":1']);
});

it.each(['text-single', 'text-pair', 'byte-single', 'byte-pair'] as const)
('stops input reflection immediately after an array length callback cancels %s', async mode => {
  const h = makeWorkHarness(), events: string[] = []; let reads = 0;
  const left = new Proxy([1, 2], { get(target, key, receiver) {
    if (key === 'length') { events.push(`length-${++reads}`); if (reads === 1) h.cancel(); }
    return Reflect.get(target, key, receiver);
  } });
  const right = new Proxy([1, 2], { getPrototypeOf(target) { events.push('peer-prototype'); return Reflect.getPrototypeOf(target); } });
  const emit = mode.startsWith('byte') ? output().emit : function* () {};
  const program = mode.endsWith('pair') ? json.emitComparedCanonicalWork(left, right, emit) : json.canonicalWork(left, emit);
  await expect(h.runtime.run<unknown>(program)).rejects.toMatchObject({ name: 'AbortError' });
  expect(events).toEqual(['length-1']); expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it.each(['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor'].flatMap(trap =>
  [{ trap, side: 'left', paired: false }, { trap, side: 'left', paired: true }, { trap, side: 'right', paired: true }]))
('stops byte-producer callbacks after $side / $trap cancellation (paired=$paired)', async ({ trap, side, paired }) => {
  const h = makeWorkHarness(), events: string[] = [], stop = `${side}.${trap}`;
  const input = (label: string) => {
    const note = (name: string) => { events.push(`${label}.${name}`); if (`${label}.${name}` === stop) h.cancel(); };
    return new Proxy({ a: 'value', b: 'value' }, {
      getPrototypeOf(target) { note('getPrototypeOf'); return Reflect.getPrototypeOf(target); },
      ownKeys(target) { note('ownKeys'); return Reflect.ownKeys(target); },
      getOwnPropertyDescriptor(target, key) { note('getOwnPropertyDescriptor'); return Reflect.getOwnPropertyDescriptor(target, key); },
    });
  };
  const emit = output().emit, left = input('left'), right = input('right');
  await expect(h.runtime.run<unknown>(paired ? json.emitComparedCanonicalWork(left, right, emit) : json.canonicalWork(left, emit)))
    .rejects.toMatchObject({ name: 'AbortError' });
  expect(events.at(-1)).toBe(stop); expect(events.filter(value => value === stop)).toHaveLength(1);
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it('keeps byte packets stable through suspended and nested consumers', async () => {
  const h = makeWorkHarness(), nested = output(), packets: Uint8Array[] = [], value = { text: 'root根😀'.repeat(80) };
  const emit = json.utf8JsonOutput(function* () { throw Error('unexpected text'); }, function* (bytes) {
    const before = Uint8Array.from(bytes); packets.push(before);
    yield* effect(1024, () => {});
    yield* json.canonicalWork('nested'.repeat(80), nested.emit);
    expect(bytes).toEqual(before);
  });
  await h.runtime.run(json.canonicalWork(value, emit));
  expect(Buffer.concat(packets).toString('utf8')).toBe(json.canonicalText(value));
  expect(packets.length).toBeGreaterThan(1); expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it('does not resume a byte consumer after it cancels its runtime', async () => {
  const h = makeWorkHarness(); let continued = false;
  const emit = json.utf8JsonOutput(function* () {}, function* () {
    h.cancel(); yield* effect(1, () => { continued = true; });
  });
  await expect(h.runtime.run(json.canonicalWork('root'.repeat(300), emit))).rejects.toMatchObject({ name: 'AbortError' });
  expect(continued).toBe(false); expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it.each([false, true])('batches comparison metric writes without discounting code units (mismatch=%s)', async mismatch => {
  const h = makeWorkHarness(), sink = output(), left = 'x'.repeat(4096), right = mismatch ? left.slice(0, 2048) + 'y' + left.slice(2049) : left;
  let calls = 0, units = 0;
  const equal = await h.runtime.run(counted(json.emitComparedCanonicalWork(left, right, sink.emit), undefined, (name, amount) => {
    if (name === 'comparedCodeUnits') { calls++; units += amount; }
  }));
  expect(equal).toBe(!mismatch); expect(units).toBe(mismatch ? 4098 : 8192);
  expect(h.runtime.snapshot().comparedCodeUnits).toBe(units); expect(calls).toBeLessThan(30);
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it('publishes completed character comparisons before the next input reflection guard', async () => {
  const h = makeWorkHarness(), sink = output(); let later = false;
  const left = new Proxy({ a: 'x'.repeat(20), b: 1 }, { getOwnPropertyDescriptor(target, key) {
    if (key === 'b') later = true; return Reflect.getOwnPropertyDescriptor(target, key);
  } });
  // The two expected keys contribute two comparison units during ordering.
  h.runtime.addGuard(() => { if (h.runtime.snapshot().comparedCodeUnits >= 42) throw new DOMException('Stop at next input', 'AbortError'); });
  await expect(h.runtime.run(json.emitComparedCanonicalWork(left, { a: 'x'.repeat(20), b: 1 }, sink.emit))).rejects.toMatchObject({ name: 'AbortError' });
  expect(h.runtime.snapshot().comparedCodeUnits).toBe(42); expect(later).toBe(false); expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it.each([false, true])('hashes native UTF-8 packets from another realm (mixed=%s)', async mixed => {
  const ForeignBytes = runInNewContext('Uint8Array') as typeof Uint8Array, encode = TextEncoder.prototype.encode;
  expect(ForeignBytes.from([1]) instanceof Uint8Array).toBe(false);
  vi.spyOn(TextEncoder.prototype, 'encode').mockImplementation(function (text) { return ForeignBytes.from(encode.call(this, text)); });
  const value = { text: 'root根😀\n'.repeat(80) }, text = `[${json.canonicalText(value)}]`, h = makeWorkHarness();
  const digest = await digestFrame(function* (emit) {
    if (!mixed) { yield* json.textWork(text, emit); return; }
    yield* json.textWork('[', emit); yield* json.canonicalWork(value, emit); yield* json.textWork(']', emit);
  }, h.runtime, 'target');
  expect(digest).toBe(createHash('sha256').update(text).digest('hex'));
  expect(h.runtime.snapshot().targetHashBytes).toBe(Buffer.byteLength(text)); expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it.each(['data-view', 'uint16', 'clamped', 'plain', 'proxy', 'spoofed-tag', 'detached', 'oversized'])
('refuses invalid host encoder packet %s without publishing a digest', async kind => {
  const bytes = new Uint8Array(1);
  if (kind === 'detached') structuredClone(bytes.buffer, { transfer: [bytes.buffer] });
  const invalid = kind === 'data-view' ? new DataView(new ArrayBuffer(1)) : kind === 'uint16' ? new Uint16Array(1)
    : kind === 'clamped' ? new Uint8ClampedArray(1) : kind === 'plain' ? { 0: 65, length: 1 }
    : kind === 'proxy' ? new Proxy(bytes, {}) : kind === 'spoofed-tag' ? Object.defineProperty(new DataView(new ArrayBuffer(1)), Symbol.toStringTag, { value: 'Uint8Array' })
    : kind === 'oversized' ? new Uint8Array(193) : bytes;
  vi.spyOn(TextEncoder.prototype, 'encode').mockReturnValue(invalid as Uint8Array);
  const h = makeWorkHarness(); await expect(digestFrame(emit => json.textWork('x', emit), h.runtime, 'target')).rejects.toThrow();
  expect(h.runtime.snapshot().hashBytes).toBe(0); expect(h.runtime.snapshot().ownedBytes).toBe(0);
});
