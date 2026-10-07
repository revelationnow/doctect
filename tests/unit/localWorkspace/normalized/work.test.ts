// @vitest-environment node
import { MessageChannel as NodeMessageChannel } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertWorkRuntime, createWorkRuntime, effect, primitive, retainWork, runSync, setDefaultWorkYieldSlice,
  type Counters, type FrameKind, type Metric, type NativeKind, type Operation, type Ownership,
  type Phase, type StoreClass, type Work, type WorkControl, type WorkEvent, type WorkRuntime,
} from '../../../../shared/cooperativeWork.js';
import { makeWorkHarness } from '../../../helpers/normalizationWorkHarness';
import { textWork, quoteWork, utf8LengthWork, canonicalWork, canonicalBytesWork, plainJsonBytesWork, compareStringsWork, orderedJsonWork, jsonCloneWork, normalizeOwnedJsonWork, copyEnumerableWork, equalFrameWork as sharedEqualFrameWork, type Frame } from '../../../../shared/jsonWork.js';
import * as jsonInspection from '../../../../shared/jsonWork.js';
import { canonicalStringify, digestFrame, sha256Hex } from '../../../../services/localWorkspace/canonical';
import { canonicalFrame, orderedFrame, envelopeFrame, listFrame, frameBytesWork, hashFrame, equalFrameWork } from '../../../../services/localWorkspace/normalized/work';
import * as incrementalHash from '../../../../services/localWorkspace/normalized/incrementalSha256';
import * as canonicalModule from '../../../../services/localWorkspace/canonical';

it.each(['key', '根'.repeat(512), '😀'.repeat(256), 'x'.repeat(511) + '\ud800'])
('counts complete bounded UTF-8 input without a redundant full-range copy %#', async text => {
  const h = makeWorkHarness(), bytes = Buffer.byteLength(text);
  expect(await h.runtime.run(utf8LengthWork(text))).toBe(bytes);
  expect(h.runtime.snapshot()).toMatchObject({ visits: text.length + 1, emittedBytes: bytes, ownedBytes: 0 });
});

describe('short JSON token batching', () => {
  function capture(text: string) {
    const fragments: string[] = [];
    const program = quoteWork(text, function* (part) { fragments.push(part); });
    let operations = 0, visits = 0, bytes = 0, maxVisits = 0;
    for (let step = program.next(); step.done === false; step = program.next(step.value.run())) {
      operations++; visits += step.value.visits; bytes += step.value.utf8Bytes;
      maxVisits = Math.max(maxVisits, step.value.visits);
    }
    return { fragments, operations, visits, bytes, maxVisits };
  }

  it.each(['', 'key', '根'.repeat(62), '😀'.repeat(31)])('batches eligible input %# into one charged token', text => {
    const result = capture(text);
    expect(result.fragments).toEqual([JSON.stringify(text)]);
    expect(result.operations).toBe(2); expect(result.visits).toBe(4 * text.length + 4);
    expect(result.maxVisits).toBeLessThanOrEqual(251);
    expect(result.bytes).toBe(Buffer.byteLength(JSON.stringify(text)));
  });

  it.each([61, 62, 63, 64, 65])('keeps the token/frame length distinction at %s units', length => {
    const text = 'x'.repeat(length), result = capture(text);
    expect(result.fragments.join('')).toBe(JSON.stringify(text));
    expect(result.bytes).toBe(length + 2);
    expect(result.fragments.every(part => part.length <= 64 && Buffer.byteLength(part) <= 192)).toBe(true);
    if (length <= 62) expect(result.fragments).toHaveLength(1);
    else {
      expect(result.fragments[0]).toBe('"'); expect(result.fragments.at(-1)).toBe('"');
      expect(result.visits).toBe(3 * length + 6 + Math.ceil(length / 64));
    }
  });

  it.each(Array.from({ length: 16 }, (_, index) => index * 4096))('matches individual UTF-16 units starting at %s', start => {
    let actual = '', expected = '', bytes = 0, boundsHold = true;
    for (let code = start; code < start + 4096; code++) {
      const text = String.fromCharCode(code), result = capture(text);
      actual += result.fragments.join(''); expected += JSON.stringify(text); bytes += result.bytes;
      boundsHold &&= result.maxVisits <= 1024
        && result.fragments.every(part => part.length <= 64 && Buffer.byteLength(part) <= 192);
    }
    expect(actual).toBe(expected); expect(bytes).toBe(Buffer.byteLength(expected)); expect(boundsHold).toBe(true);
  });

  it.each(['"', '\\', '\u0000', '\n', '\ud800', '\udc00', '\ud800\ud800\udc00\udc00', 'a'.repeat(61) + '😀', 'a'.repeat(62) + '😀'])
  ('retains escaping/fallback and independently encodable fragments %#', text => {
    const result = capture(text), expected = JSON.stringify(text);
    expect(result.fragments.join('')).toBe(expected);
    expect(Buffer.concat(result.fragments.map(part => Buffer.from(part)))).toEqual(Buffer.from(expected));
    expect(result.bytes).toBe(Buffer.byteLength(expected)); expect(result.maxVisits).toBeLessThanOrEqual(1024);
    expect(result.fragments[0]).toBe('"'); expect(result.fragments.at(-1)).toBe('"');
  });

  it('keeps string-like objects on the old path without new coercion', () => {
    const coercion = vi.fn(() => { throw new Error('unexpected coercion'); });
    const value = { length: 3, slice: (start: number, end: number) => 'abc'.slice(start, end),
      charCodeAt: (index: number) => 'abc'.charCodeAt(index), toString: coercion, valueOf: coercion };
    expect(capture(value as unknown as string).fragments).toEqual(['"', 'abc', '"']);
    expect(coercion).not.toHaveBeenCalled();
    expect(capture(new String('abc') as unknown as string).fragments).toEqual(['"', 'abc', '"']);
  });

  it.each([
    ['before inspection', 1000, 0, 1000],
    ['before byte accounting', 773, 0, 1024],
    ['at byte quantum', 1, 65500, 252],
  ] as const)('cancels %s without token output or speculative byte charges', async (_point, visits, utf8Bytes, expectedVisits) => {
    const h = makeWorkHarness(); let emitted = 0;
    await h.runtime.run(effect(visits, () => {}, utf8Bytes)); h.observe(h.cancel);
    await expect(h.runtime.run(quoteWork('x'.repeat(62), function* () { emitted++; }))).rejects.toMatchObject({ name: 'AbortError' });
    expect(emitted).toBe(0); expect(h.runtime.snapshot()).toMatchObject({ visits: expectedVisits, emittedBytes: utf8Bytes, ownedBytes: 0 });
  });

  it('rejects lifecycle loss immediately after constructing the token', async () => {
    const h = makeWorkHarness(); let emitted = 0;
    h.runtime.addGuard(() => {
      if (h.runtime.snapshot().visits === 251) throw new DOMException('post-construction cancellation', 'AbortError');
    });
    await expect(h.runtime.run(quoteWork('x'.repeat(62), function* () { emitted++; }))).rejects.toMatchObject({ name: 'AbortError' });
    expect(emitted).toBe(0); expect(h.runtime.snapshot()).toMatchObject({ visits: 251, emittedBytes: 0, ownedBytes: 0 });
  });

  it('allows exact-fit UTF-8 byte accounting without widening the quantum', async () => {
    const h = makeWorkHarness(), parts: string[] = [];
    await h.runtime.run(effect(1, () => {}, 65536 - 64));
    await h.runtime.run(quoteWork('x'.repeat(62), function* (part) { parts.push(part); }));
    expect(parts).toEqual([JSON.stringify('x'.repeat(62))]);
    expect(h.runtime.snapshot()).toMatchObject({ emittedBytes: 65536, visits: 253, yields: 0, ownedBytes: 0 });
  });

  it.each(['sync', 'work'] as const)('forwards emitter exceptions and finalizes in %s driver', async mode => {
    const failure = new Error('emitter failed'), seen: string[] = []; let closed = 0;
    const program = (function* () {
      try { yield* quoteWork('value', function* (part) { seen.push(part); throw failure; }); }
      finally { closed++; }
    })();
    if (mode === 'sync') expect(() => runSync(program)).toThrow(failure);
    else await expect(makeWorkHarness().runtime.run(program)).rejects.toBe(failure);
    expect(seen).toEqual(['"value"']); expect(closed).toBe(1);
  });

  it('preserves cancellation precedence inside the emitter and closes the producer', async () => {
    const h = makeWorkHarness(); let caught = 0, closed = 0, later = 0;
    const program = (function* () {
      try {
        yield* quoteWork('value', function* () { yield* effect(1, () => h.cancel()); });
        yield* effect(1, () => { later++; });
      } catch { caught++; }
      finally { closed++; }
    })();
    await expect(h.runtime.run(program)).rejects.toMatchObject({ name: 'AbortError' });
    expect(caught).toBe(0); expect(closed).toBe(1); expect(later).toBe(0); expect(h.runtime.snapshot().ownedBytes).toBe(0);
  });

  it.each(['sync', 'work'] as const)('keeps quoted first-mismatch tails unread in %s driver', async mode => {
    const tails = [0, 0], closed = [0, 0];
    const frame = (text: string, index: number): Frame => function* (emit) {
      try { yield* quoteWork(text, emit); yield* effect(1, () => { tails[index]++; }); }
      finally { closed[index]++; }
    };
    const program = equalFrameWork(frame('abc', 0), frame('abd', 1));
    if (mode === 'sync') expect(runSync(program)).toBe(false);
    else {
      const h = makeWorkHarness(); expect(await h.runtime.run(program)).toBe(false);
      expect(h.runtime.snapshot().comparedCodeUnits).toBe(8); expect(h.runtime.snapshot().ownedBytes).toBe(0);
    }
    expect(tails).toEqual([0, 0]); expect(closed).toEqual([1, 1]);
  });

  it.each(['source', 'target', 'proof'] as const)('keeps independent %s hash/count/comparison byte oracles', async kind => {
    const text = 'Aé根😀', expected = JSON.stringify(text), h = makeWorkHarness();
    const frame: Frame = emit => quoteWork(text, emit);
    expect(await digestFrame(frame, h.runtime, kind)).toBe(createHash('sha256').update(expected).digest('hex'));
    expect(await h.runtime.run(frameBytesWork(frame))).toBe(Buffer.byteLength(expected));
    expect(await h.runtime.run(equalFrameWork(frame, emit => textWork(expected, emit)))).toBe(true);
    expect(h.runtime.snapshot().ownedBytes).toBe(0);
  });
});

it('text fragments share bounded copy/count work without changing visit or UTF-8 charges', () => {
  const fragments: string[] = [];
  const program = textWork('根'.repeat(256), function* (fragment) { fragments.push(fragment); });
  let operations = 0; let visits = 0; let bytes = 0;
  for (let next = program.next(); next.done === false; next = program.next(next.value.run())) {
    operations++; visits += next.value.visits; bytes += next.value.utf8Bytes;
    expect(next.value.visits).toBeLessThanOrEqual(128);
  }
  expect(fragments).toEqual(Array(4).fill('根'.repeat(64)));
  expect(visits).toBe(516); expect(bytes).toBe(768);
  expect(operations).toBe(8);
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([0, 1, 63])('hashes 64-unit fragments with multiple compression blocks after %s pending bytes', async prefix => {
  const text = 'x'.repeat(prefix) + '根'.repeat(64); const h = makeWorkHarness();
  const frame: Frame = function* (emit) {
    if (prefix) yield* emit('x'.repeat(prefix));
    yield* emit('根'.repeat(64));
  };
  expect(await digestFrame(frame, h.runtime, 'source')).toBe(createHash('sha256').update(text).digest('hex'));
  expect(h.runtime.snapshot().hashBytes).toBe(prefix + 192);
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
  expect(await h.runtime.run(frameBytesWork(frame))).toBe(prefix + 192);
  expect(await h.runtime.run(sharedEqualFrameWork(frame, emit => textWork(text, emit)))).toBe(true);
});

it.each(['count', 'compare', 'hash'] as const)('rejects a 65-unit producer fragment in %s without leaking ownership', async consumer => {
  const frame: Frame = function* (emit) { yield* emit('根'.repeat(65)); };
  const h = makeWorkHarness();
  const result = consumer === 'hash' ? digestFrame(frame, h.runtime, 'source')
    : consumer === 'count' ? h.runtime.run(frameBytesWork(frame))
      : h.runtime.run(sharedEqualFrameWork(frame, frame));
  await expect(result).rejects.toThrow('Invalid frame fragment');
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it.each(['canonical', 'ordered'] as const)('counts %s JSON string bytes without escaped serialization or encoding allocations', async mode => {
  const text = '根😀\"\\\u0000\b\t\n\f\r\ud800'.repeat(2048);
  const expected = new TextEncoder().encode(JSON.stringify(text)).length;
  const stringify = vi.spyOn(JSON, 'stringify'); const encode = vi.spyOn(TextEncoder.prototype, 'encode');
  const encodeInto = vi.spyOn(TextEncoder.prototype, 'encodeInto');
  const h = makeWorkHarness();
  try {
    const count = mode === 'canonical' ? canonicalBytesWork : plainJsonBytesWork;
    expect(count).toBeTypeOf('function');
    expect(await h.runtime.run(count(text))).toBe(expected);
    // Vitest may stringify an IPC object while the real runtime yields.
    expect(stringify.mock.calls.filter(([value]) => typeof value === 'string').length).toBe(0);
    expect(encode.mock.calls.length).toBe(0); expect(encodeInto.mock.calls.length).toBe(0);
    expect(h.runtime.snapshot().visits).toBeLessThan(text.length * 6);
    expect(h.runtime.snapshot().yields).toBeGreaterThan(0);
  } finally { stringify.mockRestore(); encode.mockRestore(); encodeInto.mockRestore(); }
});

it.each(['canonical', 'ordered'] as const)('packs count-only %s scans without discounting work or widening quanta', async mode => {
  const text = 'x'.repeat(64 * 1024); const h = makeWorkHarness();
  const count = mode === 'canonical' ? canonicalBytesWork : plainJsonBytesWork;
  expect(await h.runtime.run(count(text))).toBe(text.length + 2);
  const counters = h.runtime.snapshot();
  expect(counters.emittedBytes).toBe(text.length + 2);
  expect(counters.visits).toBeGreaterThanOrEqual(text.length * 4);
  expect(counters.ownedBytes).toBe(0);
  expect(counters.yields).toBeGreaterThan(0);
  expect(counters.yields).toBeLessThanOrEqual(270);
  let visits = 0; let bytes = 0;
  for (const current of [...h.events.map(event => event.counters), counters]) {
    expect(current.visits - visits).toBeLessThanOrEqual(1024);
    expect(current.emittedBytes - bytes).toBeLessThanOrEqual(64 * 1024);
    visits = current.visits; bytes = current.emittedBytes;
  }
});

it('count-only JSON preserves every UTF-16 unit and surrogate boundary against native encoding', () => {
  const units = Array.from({ length: 65536 }, (_, n) => String.fromCharCode(n)).join('');
  for (const text of [units, '\ud800', '\udc00', 'a'.repeat(127) + '😀', 'a'.repeat(255) + '😀', '\ud800\ud800\udc00\udc00']) {
    const expected = new TextEncoder().encode(JSON.stringify(text)).length;
    expect(runSync(canonicalBytesWork(text))).toBe(expected);
    expect(runSync(plainJsonBytesWork(text))).toBe(expected);
  }
  for (const prefix of [125, 126, 127, 128, 129]) {
    for (const suffix of ['😀', '\ud800', '\udc00', '\ud800\ud800\udc00\udc00']) {
      const text = 'x'.repeat(prefix) + suffix + 'y'.repeat(130);
      const expected = new TextEncoder().encode(JSON.stringify(text)).length;
      expect(runSync(canonicalBytesWork(text))).toBe(expected);
      expect(runSync(plainJsonBytesWork(text))).toBe(expected);
    }
  }
});

it.each(['canonical', 'ordered'] as const)('counts %s JSON structural/scalar ASCII tokens without encoding them again', async mode => {
  const value = { unicode: '根😀\ud800', numbers: [0, -0, 1e-30, -Number.MAX_VALUE, Number.MIN_VALUE], flags: [true, false, null], empty: {} };
  const expected = new TextEncoder().encode(JSON.stringify(value)).length;
  const encode = vi.spyOn(TextEncoder.prototype, 'encodeInto'), h = makeWorkHarness();
  try {
    expect(await h.runtime.run((mode === 'canonical' ? canonicalBytesWork : plainJsonBytesWork)(value))).toBe(expected);
    expect(h.runtime.snapshot().emittedBytes).toBe(expected);
    expect(encode).not.toHaveBeenCalled();
  } finally { encode.mockRestore(); }
});

it('compares native string prefixes in bounded batches with exact comparison accounting', async () => {
  const text = 'same-prefix-'.repeat(16), h = makeWorkHarness();
  let operations = 0;
  const program = compareStringsWork(`${text}a`, `${text}b`);
  function* measured(): Work<number> {
    let next = program.next();
    while (next.done !== true) { operations++; next = program.next(yield next.value); }
    return next.value;
  }
  expect(await h.runtime.run(measured())).toBe(-1);
  expect(h.runtime.snapshot().comparedCodeUnits).toBe((text.length + 1) * 2);
  expect(operations).toBeLessThan(12);
});

it('measures canonical bytes and container depth in the same validation walk', async () => {
  const inspect = (jsonInspection as any).canonicalInspectionWork;
  expect(inspect).toBeTypeOf('function');
  const value = { child: [{ value: '根😀\ud800' }] }, h = makeWorkHarness();
  expect(await h.runtime.run(inspect(value))).toEqual({ bytes: new TextEncoder().encode(JSON.stringify(value)).length, maximumDepth: 2 });
  const parent: any = { child: {} }; parent.child.back = parent;
  await expect(h.runtime.run(inspect(parent.child, { nesting: 1, parent }))).rejects.toThrow('cycles');
});

it.each(['canonical', 'ordered'] as const)('packs small %s JSON tokens into bounded fragments without changing bytes', async mode => {
  const value = Array.from({ length: 50 }, (_, index) => ({ x: index, y: -index, z: true }));
  const expected = mode === 'canonical' ? canonicalStringify(value) : JSON.stringify(value), fragments: string[] = [];
  const h = makeWorkHarness();
  const emit = function* (text: string) { fragments.push(text); };
  await h.runtime.run(mode === 'canonical' ? canonicalWork(value, emit) : orderedJsonWork(value, emit));
  expect(fragments.join('')).toBe(expected);
  expect(fragments.every(text => text.length <= 64)).toBe(true);
  expect(fragments.length).toBeLessThanOrEqual(Math.ceil(expected.length / 48) + 1);
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it('preserves the emitted JSON prefix on validation failure and releases fragment scratch', async () => {
  const fragments: string[] = [], h = makeWorkHarness();
  await expect(h.runtime.run(canonicalWork({ a: 1, b: undefined }, function* (text) { fragments.push(text); }))).rejects.toThrow('undefined');
  expect(fragments.join('')).toBe('{"a":1,"b":');
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it('releases packed JSON scratch when liveness fails immediately after allocation', async () => {
  const h = makeWorkHarness(); let acquired = false;
  h.runtime.addGuard(() => { if (h.runtime.snapshot().ownedBytes > 0) { acquired = true; throw new DOMException('stop', 'AbortError'); } });
  await expect(h.runtime.run(canonicalWork({ a: 1 }, function* () {}))).rejects.toMatchObject({ name: 'AbortError' });
  expect(acquired).toBe(true); expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it('shares one encoded frame across independent bounded digest states without changing their bytes', async () => {
  const grouped = (canonicalModule as any).withFrameDigests; expect(grouped).toBeTypeOf('function');
  const h = makeWorkHarness(), prefix = 'left:', other = 'right:', body = '根😀'.repeat(30);
  let serializations = 0;
  const result = await grouped(h.runtime, 'source', function* (group: any) {
    const left = yield* group.createDigest(), right = yield* group.createDigest();
    yield* textWork(prefix, group.emit(left)); yield* textWork(other, group.emit(right));
    serializations++; yield* textWork(body, group.emit(left, right));
    return [yield* group.finish(left), yield* group.finish(right)];
  });
  expect(result).toEqual([prefix, other].map(value => createHash('sha256').update(value + body).digest('hex')));
  expect(serializations).toBe(1);
  expect(h.runtime.snapshot().hashBytes).toBe(Buffer.byteLength(prefix + body) + Buffer.byteLength(other + body));
  expect(h.runtime.snapshot().sourceHashBytes).toBe(h.runtime.snapshot().hashBytes);
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it('enforces the three-digest scratch bound when allocation generators are interleaved', async () => {
  const grouped = (canonicalModule as any).withFrameDigests, h = makeWorkHarness();
  const hash = incrementalHash.createNormalizationSha256(), bytes = hash.retainedBytes(); hash.dispose();
  await expect(grouped(h.runtime, 'source', function* (group: any) {
    const openings = Array.from({ length: 4 }, () => group.createDigest()), pending = openings.map(program => program.next().value);
    try { for (const operation of pending) yield operation; }
    finally { for (const program of openings) program.return(); }
  })).rejects.toThrow('scratch limit');
  expect(h.runtime.snapshot().ownedHighWater).toBeLessThanOrEqual(bytes * 3);
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it.each(['finished', 'foreign', 'oversized', 'cancel-allocation'] as const)('refuses %s grouped hash use and releases every state', async kind => {
  const grouped = canonicalModule.withFrameDigests, h = makeWorkHarness();
  if (kind === 'cancel-allocation') h.runtime.addGuard(() => { if (h.runtime.snapshot().ownedBytes) throw new DOMException('cancel', 'AbortError'); });
  await expect(grouped(h.runtime, 'source', function* (group) {
    const first = yield* group.createDigest();
    if (kind === 'finished') { yield* group.finish(first); yield* textWork('late', group.emit(first)); }
    if (kind === 'foreign') yield* textWork('invalid', group.emit({} as never));
    if (kind === 'oversized') yield* group.emit(first)('x'.repeat(65));
  })).rejects.toBeDefined();
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it('does not permit escaped grouped hash operations after scope disposal', async () => {
  const h = makeWorkHarness(); let late: (() => Work<unknown>) | undefined;
  await canonicalModule.withFrameDigests(h.runtime, 'source', function* (group) {
    const token = yield* group.createDigest(); late = () => group.finish(token);
  });
  await expect(h.runtime.run(late!())).rejects.toThrow('unavailable');
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it('streams escape-free JSON strings without redundant native escaping', async () => {
  const text = '根😀abc'.repeat(512); const expected = new TextEncoder().encode(JSON.stringify(text)).length;
  const stringify = vi.spyOn(JSON, 'stringify'); const h = makeWorkHarness();
  try {
    expect(await h.runtime.run(frameBytesWork(emit => quoteWork(text, emit)))).toBe(expected);
    expect(stringify.mock.calls.filter(([value]) => typeof value === 'string').length).toBe(0);
    expect(h.runtime.snapshot().visits).toBeLessThan(text.length * 8);
  } finally { stringify.mockRestore(); }
});

it('streamed JSON escaping matches native output for every UTF-16 unit and chunk boundary', () => {
  const units = Array.from({ length: 65536 }, (_, n) => String.fromCharCode(n)).join('');
  for (const text of [units, 'a'.repeat(15) + '😀', 'a'.repeat(63) + '😀', 'a'.repeat(64) + '😀', 'a'.repeat(65) + '😀', 'a'.repeat(63) + '\ud800', '\ud800\ud800\udc00\udc00', '"\\\u0000\b\t\n\f\r']) {
    let actual = '';
    runSync(quoteWork(text, function* (fragment) { actual += fragment; }));
    expect(actual).toBe(JSON.stringify(text));
  }
});

it('escape-free quoting reuses its character scan for exact UTF-8 accounting', async () => {
  const text = 'Aé根😀'.repeat(256); const expected = JSON.stringify(text);
  const expectedBytes = new TextEncoder().encode(expected).length;
  const encodeInto = vi.spyOn(TextEncoder.prototype, 'encodeInto'); const h = makeWorkHarness();
  let actual = '';
  try {
    await h.runtime.run(quoteWork(text, function* (fragment) { yield* effect(1, () => { actual += fragment; }); }));
    expect(actual).toBe(expected); expect(h.runtime.snapshot().emittedBytes).toBe(expectedBytes);
    expect(encodeInto.mock.calls.length).toBeLessThanOrEqual(2); // Opening/closing quotes only.
  } finally { encodeInto.mockRestore(); }
});

it('preserves hot counters across in-operation phase changes and metric aliases', async () => {
  let checks = 0;
  const runtime = createWorkRuntime({ assertCurrent() { checks++; }, async yieldTask() {} });
  try {
    const before = runtime.snapshot();
    await runtime.run((function* () {
      yield* effect(1024, () => runtime.setContext('verify'), 7, 'visits');
      yield* effect(3, () => {}, 11, 'emittedBytes');
    })());
    expect(runtime.snapshot()).toMatchObject({ visits: 1028, emittedBytes: 19, yields: 1, checks });
    expect(runtime.snapshot('prepare')).toMatchObject({ visits: 1025, emittedBytes: 7, yields: 0 });
    expect(runtime.snapshot('verify')).toMatchObject({ visits: 3, emittedBytes: 12, yields: 1 });
    expect(runtime.snapshot('prepare').checks + runtime.snapshot('verify').checks).toBe(checks);
    expect(before).toMatchObject({ visits: 0, emittedBytes: 0, checks: 0 });
  } finally { runtime.dispose(); }
});

describe('migration JSON copies', () => {
  it('measures raw UTF-8 length without producing serialization fragments', async () => {
    const text = 'x'.repeat(65536);
    const encode = vi.spyOn(TextEncoder.prototype, 'encodeInto');
    const runtime = createWorkRuntime({ assertCurrent() {}, async yieldTask() {} });
    try {
      expect(await runtime.run(utf8LengthWork(text))).toBe(text.length);
      expect(encode.mock.calls.length).toBeLessThanOrEqual(text.length / 512);
      expect(runtime.snapshot().visits).toBeLessThanOrEqual(text.length * 2 + text.length / 512);
      expect(runtime.snapshot().yields).toBeGreaterThan(0);
    } finally { runtime.dispose(); }
  });

  it.each(['', 'a'.repeat(511) + '😀根\ud800x\udfff', '\ud800'.repeat(1025), '\udfff'.repeat(1025)])
  ('retains native UTF-8 length across count-only chunk boundaries %#', async text => {
    const runtime = createWorkRuntime({ assertCurrent() {}, async yieldTask() {} });
    try {
      expect(await runtime.run(utf8LengthWork(text))).toBe(new TextEncoder().encode(text).length);
    } finally { runtime.dispose(); }
  });

  it('counts bounded UTF-8 fragments without allocating encoded arrays', async () => {
    const text = Array.from({ length: 65536 }, (_, code) => String.fromCharCode(code)).join('')
      + 'a'.repeat(15) + '😀根\ud800x\udfff';
    const expected = new TextEncoder().encode(text).length;
    const encode = vi.spyOn(TextEncoder.prototype, 'encode');
    const runtime = createWorkRuntime({ assertCurrent() {}, async yieldTask() {} });
    try {
      expect(await runtime.run(frameBytesWork(emit => textWork(text, emit)))).toBe(expected);
      expect(await runtime.run(utf8LengthWork(text))).toBe(expected);
      expect(encode.mock.calls.length).toBe(0);
      expect(runtime.snapshot().yields).toBeGreaterThan(0);
    } finally { runtime.dispose(); }
  });

  const conversions = [null, true, -0, NaN, Infinity, '😀\ud800',
    { z: 1, omitted: undefined, fn() {}, symbol: Symbol(), n: NaN, zero: -0 },
    [undefined, , Symbol(), () => 1, Infinity, -0],
    JSON.parse('{"__proto__":{"polluted":true},"2":2,"1":1,"z":0,"a":1}'),
    Object.assign(Object.create(null), { value: 1 })];
  it.each(conversions.map((value, index) => [index, value] as const))('copies JSON conversions %s without native JSON round trips', (_index, value) => {
    const expected = JSON.parse(JSON.stringify(value));
    const stringify = vi.spyOn(JSON, 'stringify').mockImplementation(() => { throw new Error('whole JSON string'); });
    const parse = vi.spyOn(JSON, 'parse').mockImplementation(() => { throw new Error('whole JSON parse'); });
    const result = runSync(jsonCloneWork(value, 'plain'));
    expect(result).toStrictEqual(expected);
    if (value && typeof value === 'object') expect(result).not.toBe(value);
    expect(stringify).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
  });

  it('duplicates shared subtrees, retains key order, and leaves input untouched', () => {
    const child = Object.freeze({ z: { text: 'shared' }, a: 1 });
    const source = Object.freeze({ left: child, right: child });
    const copy = runSync(jsonCloneWork(source, 'plain'));
    expect(copy).toEqual(source);
    expect(copy.left).not.toBe(child);
    expect(copy.left).not.toBe(copy.right);
    expect(copy.left.z).not.toBe(copy.right.z);
    expect(Object.keys(copy.left)).toEqual(['z', 'a']);
    expect(Object.getOwnPropertyDescriptor(copy.left, 'a')).toMatchObject({ writable: true, configurable: true, enumerable: true });
  });

  it.each([undefined, () => 1, Symbol(), 1n, new Date(), Object.create({ custom: 1 })])('rejects unsupported plain copy input %#', value => {
    expect(typeof jsonCloneWork).toBe('function');
    expect(() => runSync(jsonCloneWork(value, 'plain'))).toThrow();
  });

  it('does not read an object length getter while normalizing numeric keys', () => {
    const get = vi.fn(() => 1);
    const source = Object.defineProperty({ 0: 'value' }, 'length', { enumerable: true, configurable: true, get });
    expect(() => runSync(normalizeOwnedJsonWork(source))).toThrow(/accessor/i);
    expect(get).not.toHaveBeenCalled();
  });

  it('rejects cycles and enumerable getters without invoking getters or toJSON', () => {
    const cycle: any = {}; cycle.self = cycle;
    expect(() => runSync(jsonCloneWork(cycle, 'plain'))).toThrow(/cycle/i);
    const get = vi.fn(() => 1);
    expect(() => runSync(jsonCloneWork(Object.defineProperty({}, 'x', { enumerable: true, get }), 'plain'))).toThrow(/accessor/i);
    const toJSON = vi.fn(() => 'wrong');
    expect(runSync(jsonCloneWork({ toJSON, value: 1 }, 'plain'))).toEqual({ value: 1 });
    expect(get).not.toHaveBeenCalled(); expect(toJSON).not.toHaveBeenCalled();
  });

  it('retains standalone toJSON compatibility only in the tagged native branch', () => {
    const toJSON = vi.fn(() => ({ converted: 1 }));
    const program = jsonCloneWork({ toJSON }, 'compat');
    const step = program.next();
    expect(step.done).toBe(false);
    expect((step.value as Operation).nativeKind).toBe('compat-json');
    expect(toJSON).not.toHaveBeenCalled();
    expect(program.next((step.value as Operation).run()).value).toEqual({ converted: 1 });
    expect(toJSON).toHaveBeenCalledTimes(1);
  });

  it('normalizes private containers in place and replaces only repeated alias branches', () => {
    const leaf = { omitted: undefined, n: NaN, zero: -0 };
    const first = { leaf };
    const rows = [undefined, , -0];
    const root = { first, second: first, leafAgain: leaf, rows };
    const expected = JSON.parse(JSON.stringify(root));
    const result = runSync(normalizeOwnedJsonWork(root));
    expect(result).toBe(root); expect(result.first).toBe(first);
    expect(first.leaf).toBe(leaf); expect(result.rows).toBe(rows);
    expect(result.second).not.toBe(first); expect(result.second.leaf).not.toBe(leaf);
    expect(result.leafAgain).not.toBe(leaf);
    expect(result).toStrictEqual(expected);
    expect(runSync(normalizeOwnedJsonWork(result))).toBe(root);
  });

  it('removes JSON-invisible private properties and preserves __proto__ as data', () => {
    const source: any = JSON.parse('{"__proto__":{"x":1},"keep":2}');
    Object.defineProperty(source, 'hidden', { value: 1, configurable: true });
    source[Symbol()] = 2;
    source.rows = Object.assign([1], { extra: 3 });
    const expected = JSON.parse(JSON.stringify(source));
    expect(runSync(normalizeOwnedJsonWork(source))).toStrictEqual(expected);
    expect(Reflect.ownKeys(source)).toEqual(['__proto__', 'keep', 'rows']);
    expect(Reflect.ownKeys(source.rows)).toEqual(['0', 'length']);
    expect(Object.getPrototypeOf(source)).toBe(Object.prototype);
  });

  it('rejects cycles during owned normalization', () => {
    const root: any = { child: {} }; root.child.root = root;
    expect(() => runSync(normalizeOwnedJsonWork(root))).toThrow(/cycle/i);
  });

  it('copies spread properties, including symbols and getters, without a __proto__ setter', () => {
    const symbol = Symbol(); const get = vi.fn(() => ({ value: 1 }));
    const source = Object.defineProperties({ [symbol]: 2 }, {
      field: { enumerable: true, get },
      hidden: { value: 3 },
    });
    Object.defineProperty(source, '__proto__', { value: { inherited: true }, enumerable: true });
    const result = runSync(copyEnumerableWork(source));
    expect(get).toHaveBeenCalledTimes(1);
    expect(Reflect.ownKeys(result)).toEqual(['field', '__proto__', symbol]);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(result, '__proto__')).toMatchObject({ enumerable: true, writable: true, configurable: true });
    expect(result[symbol]).toBe(2);
  });

  it.each(['clone', 'owned', 'spread'])('%s yields real tasks and stops on cancellation', async kind => {
    const source = Object.fromEntries(Array.from({ length: 4000 }, (_, i) => [String(i), { value: i }]));
    const program = () => kind === 'clone' ? jsonCloneWork(source, 'plain')
      : kind === 'owned' ? normalizeOwnedJsonWork(source) : copyEnumerableWork(source);
    const h = makeWorkHarness('prepare', true);
    let timer = false; setTimeout(() => { timer = true; }, 0);
    await h.runtime.run(program());
    expect(timer).toBe(true); expect(h.runtime.snapshot().yields).toBeGreaterThan(0);
    const stopped = makeWorkHarness(); stopped.observe(() => stopped.cancel());
    await expect(stopped.runtime.run(program())).rejects.toMatchObject({ name: 'AbortError' });
  });
});

function* count(size: number): Work<number> {
  let result = 0;
  for (let index = 0; index < size; index++) result = yield* effect(1, () => result + 1);
  return result;
}

describe('work driver', () => {
  it('describes effects and primitives before executing callbacks', () => {
    let calls = 0;
    for (const program of [effect(2, () => ++calls, 3, 'hashBytes'), primitive('clone', () => ++calls)]) {
      const step = program.next();
      expect(calls).toBe(0);
      expect(step.done).toBe(false);
      expect(typeof (step.value as Operation).run).toBe('function');
      program.return(undefined);
    }
  });

  it('shares synchronous semantics and yields a real timer task at the quantum', async () => {
    expect(runSync(count(2050))).toBe(2050);
    const h = makeWorkHarness('prepare', true);
    let taskRan = false;
    setTimeout(() => { taskRan = true; }, 0);
    expect(await h.runtime.run(count(2050))).toBe(2050);
    expect(taskRan).toBe(true);
    expect(h.runtime.snapshot()).toMatchObject({ visits: 2050, yields: 2 });
  });

  it('isolates observers and shares remaining visits across successive runs', async () => {
    const h = makeWorkHarness();
    h.observe(() => { throw new Error('passive'); });
    await h.runtime.run(count(1000));
    await h.runtime.run(count(24));
    expect(h.runtime.snapshot().yields).toBe(0);
    await h.runtime.run(count(1));
    expect(h.runtime.snapshot()).toMatchObject({ visits: 1025, yields: 1 });
  });

  it('allows exactly two 32768-byte effects, then yields BEFORE the third', async () => {
    const h = makeWorkHarness();
    const seen: number[] = [];
    function* bytes() {
      for (let i = 0; i < 3; i++) yield* effect(1, () => seen.push(h.runtime.snapshot().yields), 32768);
    }
    await h.runtime.run(bytes());
    expect(seen).toEqual([0, 0, 1]);
    expect(h.runtime.snapshot()).toMatchObject({ visits: 3, emittedBytes: 98304, yields: 1 });
  });

  it('yields before an operation exceeds remaining visits, without splitting it', async () => {
    const h = makeWorkHarness();
    await h.runtime.run(effect(1000, () => 0));
    await h.runtime.run(effect(25, () => expect(h.runtime.snapshot().yields).toBe(1)));
  });

  it.each([
    [0, 0], [-1, 0], [1.5, 0], [1025, 0], [NaN, 0], [Infinity, 0],
    [1, -1], [1, 0.5], [1, 65537], [1, NaN], [1, Infinity],
  ])('rejects invalid costs (%s, %s) without calling operation', async (visits, bytes) => {
    let calls = 0;
    const program = () => effect(visits, () => ++calls, bytes);
    expect(() => runSync(program())).toThrow();
    await expect(makeWorkHarness().runtime.run(program())).rejects.toThrow();
    expect(calls).toBe(0);
  });

  it.each(['sync', 'async'])('routes application errors and invalid thenables through %s generator catches', async mode => {
    function* caught(): Work<string> {
      try { yield* effect(1, () => { throw new TypeError('application'); }); }
      catch (error) { expect(error).toBeInstanceOf(TypeError); }
      try { yield* effect(1, () => ({ then() {} })); }
      catch (error) { expect(error).toBeInstanceOf(TypeError); return 'caught'; }
      return 'missed';
    }
    expect(mode === 'sync' ? runSync(caught()) : await makeWorkHarness().runtime.run(caught())).toBe('caught');
  });

  it.each(['sync', 'async'])('runs finally and closes on uncaught application errors in %s driver', async mode => {
    let closed = 0;
    function* program() {
      try { yield* effect(1, () => { throw new Error('application'); }); }
      finally { closed++; }
    }
    const iterator = program();
    if (mode === 'sync') expect(() => runSync(iterator)).toThrow('application');
    else await expect(makeWorkHarness().runtime.run(iterator)).rejects.toThrow('application');
    expect(closed).toBe(1);
    expect(iterator.next().done).toBe(true);
  });

  it('allows yielding application finally blocks during ordinary exception unwinding', async () => {
    function* program() {
      try { yield* effect(1, () => { throw new Error('application'); }); }
      finally { yield* effect(1, () => { finalized++; }); }
    }
    let finalized = 0;
    expect(() => runSync(program())).toThrow('application');
    await expect(makeWorkHarness().runtime.run(program())).rejects.toThrow('application');
    expect(finalized).toBe(2);
  });

  it('stops at cancellation, closes generator, and never lets catch swallow lifecycle loss', async () => {
    const h = makeWorkHarness('prepare', true);
    let writes = 0, closed = 0, caught = 0;
    function* program() {
      try {
        try { for (let i = 0; i < 5000; i++) yield* effect(1, () => { writes++; }); }
        catch { caught++; }
      } finally { closed++; }
    }
    const iterator = program();
    setTimeout(h.cancel, 0);
    await expect(h.runtime.run(iterator)).rejects.toMatchObject({ name: 'AbortError' });
    expect(writes).toBe(1024);
    expect(caught).toBe(0);
    expect(closed).toBe(1);
    expect(iterator.next().done).toBe(true);
    expect(h.runtime.stopped()).toBe(true);
    expect(h.runtime.snapshot().observedAborts).toBe(1);
    expect(() => h.runtime.assertCurrent()).toThrow();
    expect(h.runtime.snapshot().observedAborts).toBe(1);
  });

  it('guards after callbacks and generator steps including completion', async () => {
    for (const position of ['operation', 'next', 'done']) {
      const h = makeWorkHarness();
      let after = 0;
      function* program() {
        if (position === 'next') h.cancel();
        yield* effect(1, () => { if (position === 'operation') h.cancel(); });
        if (position === 'done') h.cancel();
        else after++;
        return 1;
      }
      await expect(h.runtime.run(program())).rejects.toMatchObject({ name: 'AbortError' });
      expect(after).toBe(0);
    }
  });

  it('does not swallow guard failure after a throwing observer', () => {
    const h = makeWorkHarness();
    h.observe(() => { h.cancel(); throw new Error('passive'); });
    expect(() => h.runtime.notify()).toThrow('cancelled');
    expect(h.runtime.snapshot().observedAborts).toBe(1);
  });

  it('suppresses rejected async observer returns without awaiting them', async () => {
    const runtime = createWorkRuntime({
      assertCurrent() {},
      observe: async () => { throw new Error('passive async'); },
    });
    try {
      runtime.notify();
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(runtime.stopped()).toBe(false);
    } finally { runtime.dispose(); }
  });

  it('harness forwards async observer rejection for isolation while retaining event capture', async () => {
    const h = makeWorkHarness();
    const unhandled: unknown[] = [];
    const capture = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', capture);
    try {
      h.observe(async () => { throw new Error('passive async harness'); });
      h.runtime.notify();
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(unhandled).toEqual([]);
      expect(h.events).toHaveLength(1);
      expect(h.events[0].kind).toBe('work');
      expect(h.runtime.stopped()).toBe(false);
      expect(await h.runtime.run(count(1))).toBe(1);
    } finally { process.off('unhandledRejection', capture); }
  });

  it('uses unique guard registrations and latches the original failure', () => {
    const h = makeWorkHarness();
    const failure = new Error('owner lost');
    let current = true, calls = 0;
    const guard = () => { calls++; if (!current) throw failure; };
    const removeOne = h.runtime.addGuard(guard);
    const removeTwo = h.runtime.addGuard(guard);
    removeOne(); removeOne();
    calls = 0;
    h.runtime.assertCurrent();
    expect(calls).toBe(1);
    current = false;
    expect(() => h.runtime.assertCurrent()).toThrow(failure);
    removeTwo(); current = true;
    expect(() => h.runtime.assertCurrent()).toThrow(failure);
    expect(h.runtime.snapshot().observedAborts).toBe(1);
  });

  it('guard removal cannot remove the initial control guard', () => {
    const h = makeWorkHarness();
    const remove = h.runtime.addGuard(() => {});
    remove(); h.cancel();
    expect(() => h.runtime.assertCurrent()).toThrow('cancelled');
  });

  it('wait guards before factory and after success or rejection', async () => {
    for (const rejects of [false, true]) {
      const h = makeWorkHarness();
      await expect(h.runtime.wait(async () => {
        h.cancel(); if (rejects) throw new Error('application'); return 1;
      })).rejects.toThrow('cancelled');
    }
    const h = makeWorkHarness();
    await expect(h.runtime.wait(async () => 7)).resolves.toBe(7);
    await expect(h.runtime.wait(async () => { throw new Error('application'); })).rejects.toThrow('application');
    expect(h.runtime.stopped()).toBe(false);
    h.cancel(); let called = false;
    await expect(h.runtime.wait(async () => { called = true; })).rejects.toThrow('cancelled');
    expect(called).toBe(false);
  });

  it.each([false, true])('quiet restores nested async scopes on failure=%s without trailing callback', async fail => {
    const h = makeWorkHarness();
    h.observe(() => { throw new Error('passive'); });
    const operation = h.runtime.quiet(async () => {
      h.runtime.notify();
      await h.runtime.quiet(async () => {
        await h.runtime.run(count(2050)); h.runtime.notify('durable');
      });
      h.runtime.notify();
      if (fail) throw new Error('quiet failure');
      return 7;
    });
    if (fail) await expect(operation).rejects.toThrow('quiet failure');
    else expect(await operation).toBe(7);
    expect(h.events).toHaveLength(0);
    expect(h.runtime.snapshot().visits).toBe(2050);
    h.runtime.notify(); expect(h.events).toHaveLength(1);
  });

  it('inner quiet failure does not restore callbacks while outer scope remains active', async () => {
    const h = makeWorkHarness();
    await h.runtime.quiet(async () => {
      await expect(h.runtime.quiet(async () => { throw new Error('inner'); })).rejects.toThrow('inner');
      h.runtime.notify(); expect(h.events).toHaveLength(0);
    });
    expect(h.events).toHaveLength(0);
    h.runtime.notify(); expect(h.events).toHaveLength(1);
  });

  it('reports detached frozen numeric diagnostics and partial context updates', () => {
    const h = makeWorkHarness();
    h.runtime.setContext('stage', 'target', 'stage');
    const context = h.runtime.context();
    h.runtime.setContext(undefined, 'marker');
    expect(h.runtime.context()).toEqual({ phase: 'stage', storeClass: 'marker', frameKind: 'stage' });
    h.runtime.setContext('verify');
    expect(h.runtime.context()).toEqual({ phase: 'verify', storeClass: 'none', frameKind: 'none' });
    expect(context).toEqual({ phase: 'stage', storeClass: 'target', frameKind: 'stage' });
    expect(Object.isFrozen(context)).toBe(true);
    h.runtime.note('metadataBytes', 7); h.runtime.note('markerWorkBytes', 9);
    expect(h.events).toHaveLength(0);
    h.runtime.notify('durable');
    const event = h.events[0];
    expect(Object.keys(event).sort()).toEqual(['counters', 'frameKind', 'kind', 'phase', 'storeClass']);
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.counters)).toBe(true);
    expect(Object.values(event.counters).every(value => typeof value === 'number')).toBe(true);
    expect(event.counters).toMatchObject({ metadataBytes: 7, markerWorkBytes: 9 });
    expect(Reflect.set(event.counters, 'writes', 999)).toBe(false);
    h.runtime.note('metadataBytes', 1);
    expect(event.counters.metadataBytes).toBe(7);
    expect(h.runtime.snapshot()).not.toBe(h.runtime.snapshot());
    expect(h.runtime.snapshot('verify').metadataBytes).toBe(8);
    expect(h.runtime.snapshot('stage').metadataBytes).toBe(0);
  });

  it('tracks logical ownership globally and releases against allocating phase after disposal', () => {
    const h = makeWorkHarness();
    const release = h.runtime.own(10, true);
    h.runtime.setContext('stage');
    const releaseStage = h.runtime.own(20, true);
    expect(h.runtime.snapshot()).toMatchObject({ ownedBytes: 30, ownedHighWater: 30, captureGraphs: 2, captureHighWater: 2 });
    h.runtime.dispose(); release.release(); release.release(); releaseStage.release();
    expect(h.runtime.snapshot()).toMatchObject({ ownedBytes: 0, ownedHighWater: 30, captureGraphs: 0, captureHighWater: 2 });
    expect(h.runtime.snapshot('prepare')).toMatchObject({ ownedBytes: 0, ownedHighWater: 10, captureGraphs: 0, captureHighWater: 1 });
    expect(h.runtime.snapshot('stage')).toMatchObject({ ownedBytes: 0, ownedHighWater: 20, captureGraphs: 0, captureHighWater: 1 });
  });

  it('passes actual runtime only to cooperative operations', async () => {
    const h = makeWorkHarness();
    const seen: (WorkRuntime | undefined)[] = [];
    function* program(): Work<void> {
      yield { visits: 1, utf8Bytes: 0, run(runtime) { seen.push(runtime); } };
    }
    runSync(program());
    await h.runtime.run(program());
    expect(seen).toEqual([undefined, h.runtime]);
    expect(() => assertWorkRuntime(seen[1])).not.toThrow();
  });

  it('grows ownership against global and allocating-phase highwaters, never current phase', () => {
    const h = makeWorkHarness();
    const lease: Ownership = h.runtime.own(10, true);
    h.runtime.setContext('stage');
    const stage = h.runtime.own(20, true);
    lease.grow(5); lease.grow(0);
    expect(h.runtime.snapshot()).toMatchObject({ ownedBytes: 35, ownedHighWater: 35, captureGraphs: 2, captureHighWater: 2 });
    expect(h.runtime.snapshot('prepare')).toMatchObject({ ownedBytes: 15, ownedHighWater: 15, captureGraphs: 1, captureHighWater: 1 });
    expect(h.runtime.snapshot('stage')).toMatchObject({ ownedBytes: 20, ownedHighWater: 20 });
    stage.release(); lease.grow(2);
    expect(h.runtime.snapshot()).toMatchObject({ ownedBytes: 17, ownedHighWater: 35 });
    expect(h.runtime.snapshot('prepare')).toMatchObject({ ownedBytes: 17, ownedHighWater: 17 });
    h.runtime.dispose(); lease.release(); lease.release(); stage.release();
    expect(h.runtime.snapshot()).toMatchObject({ ownedBytes: 0, ownedHighWater: 35, captureGraphs: 0, captureHighWater: 2 });
    expect(h.runtime.snapshot('prepare')).toMatchObject({ ownedBytes: 0, ownedHighWater: 17, captureGraphs: 0 });
  });

  it('rejects growth after release or lifecycle stop and validates growth before accounting', () => {
    const h = makeWorkHarness();
    const lease = h.runtime.own(10, true);
    for (const bytes of [-1, 0.5, NaN, Infinity]) expect(() => lease.grow(bytes)).toThrow();
    expect(h.runtime.snapshot()).toMatchObject({ ownedBytes: 10, ownedHighWater: 10 });
    lease.release();
    expect(() => lease.grow(1)).toThrow(/released/i);
    const stoppedLease = h.runtime.own(7, true);
    h.cancel();
    expect(() => stoppedLease.grow(1)).toThrow('cancelled');
    expect(h.runtime.stopped()).toBe(true);
    expect(() => stoppedLease.grow(0)).toThrow('cancelled');
    stoppedLease.release(); stoppedLease.release();
    expect(h.runtime.snapshot()).toMatchObject({ ownedBytes: 0, captureGraphs: 0, observedAborts: 1 });
  });

  it('retainWork describes accounting first and supplies inert synchronous ownership', () => {
    const program = retainWork(12);
    const step = program.next();
    expect(step.done).toBe(false);
    expect(step.value).toMatchObject({ visits: 1, utf8Bytes: 0 });
    program.return(undefined as never);
    const lease: Ownership = runSync(retainWork(12));
    expect(typeof lease.grow).toBe('function');
    expect(typeof lease.release).toBe('function');
    expect(() => { lease.grow(3); lease.release(); lease.release(); lease.grow(4); }).not.toThrow();
    expect(() => assertWorkRuntime(lease)).toThrow();
  });

  it.each(['success', 'application', 'cancel'])('retainWork accounts genuine cooperative ownership and cleans up on %s', async outcome => {
    const h = makeWorkHarness();
    let lease: Ownership | undefined;
    function* program() {
      lease = yield* retainWork(12);
      try {
        expect(h.runtime.snapshot()).toMatchObject({ ownedBytes: 12, ownedHighWater: 12 });
        lease.grow(3);
        expect(h.runtime.snapshot('prepare')).toMatchObject({ ownedBytes: 15, ownedHighWater: 15 });
        yield* effect(1, () => {
          if (outcome === 'application') throw new Error('application');
          if (outcome === 'cancel') h.cancel();
        });
        return 7;
      } finally { lease.release(); }
    }
    if (outcome === 'success') expect(await h.runtime.run(program())).toBe(7);
    else await expect(h.runtime.run(program())).rejects.toThrow(outcome === 'cancel' ? 'cancelled' : 'application');
    expect(h.runtime.snapshot()).toMatchObject({ visits: 2, ownedBytes: 0, ownedHighWater: 15, captureGraphs: 0 });
    expect(h.runtime.snapshot('prepare').ownedBytes).toBe(0);
    expect(() => lease!.release()).not.toThrow();
    expect(() => assertWorkRuntime(lease)).toThrow();
  });

  it('validates enums, metrics and finite increments without changing context', async () => {
    const h = makeWorkHarness();
    expect(() => h.runtime.setContext('bad' as Phase)).toThrow();
    expect(() => h.runtime.setContext('stage', 'bad' as StoreClass)).toThrow();
    expect(() => h.runtime.setContext(undefined, undefined, 'bad' as FrameKind)).toThrow();
    expect(h.runtime.context().phase).toBe('prepare');
    expect(() => h.runtime.snapshot('bad' as Phase)).toThrow();
    expect(() => h.runtime.note('secret-id' as Metric)).toThrow();
    expect(() => h.runtime.note('visits', Infinity)).toThrow();
    expect(() => h.runtime.note('visits', NaN)).toThrow();
    expect(() => h.runtime.notify('secret' as 'work')).toThrow();
    expect(() => h.runtime.own(-1)).toThrow();
    expect(() => h.runtime.own(Infinity)).toThrow();
    await expect(h.runtime.run(primitive('secret' as NativeKind, () => 1))).rejects.toThrow();
    await expect(h.runtime.run(effect(1, () => 1, 0, 'secret' as Metric))).rejects.toThrow();
    expect(h.runtime.stopped()).toBe(false);
  });

  it('counts native primitives as exceptions to bounded application work, not thrown errors', async () => {
    const h = makeWorkHarness();
    expect(await h.runtime.run(primitive('keys', () => Object.keys({ key: 1 })))).toEqual(['key']);
    await expect(h.runtime.run(primitive('parse', () => { throw new Error('parse'); }))).rejects.toThrow('parse');
    await h.runtime.run(effect(2, () => 1, 3, 'sortComparisons'));
    expect(h.runtime.snapshot()).toMatchObject({ primitiveExceptions: 2, visits: 4, emittedBytes: 3, sortComparisons: 1 });
  });

  it('captures callbacks once, freezes executor methods, and rejects forged brands', async () => {
    const control: WorkControl = { assertCurrent: () => {}, yieldTask: () => new Promise(resolve => setTimeout(resolve, 0)) };
    const runtime: WorkRuntime = createWorkRuntime(control);
    try {
      control.assertCurrent = () => { throw new Error('replaced'); };
      control.yieldTask = () => { throw new Error('replaced'); };
      control.observe = () => { throw new Error('replaced'); };
      expect(() => assertWorkRuntime(runtime)).not.toThrow();
      for (const forged of [{ ...runtime }, Object.create(runtime), {}, null]) expect(() => assertWorkRuntime(forged)).toThrow();
      expect(Object.isFrozen(runtime)).toBe(true);
      expect(Reflect.set(runtime, 'run', () => 1)).toBe(false);
      expect(await runtime.run(count(1025))).toBe(1025);
    } finally { runtime.dispose(); }
  });

  it('rejects concurrent/reentrant CPU run and wait from an operation', async () => {
    const h = makeWorkHarness();
    let nested: Promise<unknown> | undefined;
    await h.runtime.run(effect(1, () => { nested = h.runtime.run(count(1)); }));
    await expect(nested).rejects.toThrow(/run|active|reentrant/i);
    await h.runtime.run(effect(1, () => { nested = h.runtime.wait(async () => 1); }));
    await expect(nested).rejects.toThrow(/run|active|operation/i);
    expect(h.runtime.stopped()).toBe(false);
  });

  it('default MessageChannel yields a task, keeps pending ports referenced, and closes on dispose', async () => {
    const channels: NodeMessageChannel[] = [];
    vi.stubGlobal('MessageChannel', class extends NodeMessageChannel {
      constructor() { super(); channels.push(this); vi.spyOn(this.port1, 'close'); vi.spyOn(this.port2, 'close'); }
    });
    const h = makeWorkHarness();
    expect(channels).toHaveLength(0);
    const pending = h.runtime.run(count(1025));
    expect(channels).toHaveLength(1);
    expect(channels[0].port1.hasRef()).toBe(true);
    expect(h.runtime.snapshot().visits).toBe(1024);
    await Promise.resolve();
    expect(h.runtime.snapshot().visits).toBe(1024);
    expect(await pending).toBe(1025);
    expect(channels[0].port1.hasRef()).toBe(false);
    h.runtime.dispose();
    expect(channels[0].port1.close).toHaveBeenCalledOnce();
    expect(channels[0].port2.close).toHaveBeenCalledOnce();
  });

  it.each([false, true])('dispose rejects pending default yield and closes generator (timer fallback=%s)', async fallback => {
    if (fallback) vi.stubGlobal('MessageChannel', undefined);
    const h = makeWorkHarness();
    let closed = false;
    function* program() { try { yield* count(1025); } finally { closed = true; } }
    const pending = h.runtime.run(program());
    h.runtime.dispose(); h.runtime.dispose();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(closed).toBe(true);
    expect(h.runtime.snapshot().visits).toBe(1024);
    expect(h.runtime.stopped()).toBe(true);
  });

  it('default timer fallback yields real tasks when MessageChannel is absent', async () => {
    vi.stubGlobal('MessageChannel', undefined);
    const h = makeWorkHarness();
    let taskRan = false;
    setTimeout(() => { taskRan = true; }, 0);
    await h.runtime.run(count(1025));
    expect(taskRan).toBe(true);
  });

  it('declarations expose the complete shared work protocol for later consumers', async () => {
    const h = makeWorkHarness();
    const event: WorkEvent = { ...h.runtime.context(), kind: 'work', counters: h.runtime.snapshot() };
    const counters: Counters = event.counters;
    const program: Work<number> = effect(1, () => 42);
    expect(await h.runtime.run(program)).toBe(42);
    expect(counters.metadataBytes).toBe(0);
    expect(counters.markerWorkBytes).toBe(0);
    if (false) {
      // @ts-expect-error phase names are a closed set
      h.runtime.setContext('payload');
      // @ts-expect-error metrics are a closed set
      h.runtime.note('payload');
      // @ts-expect-error counters are read-only
      counters.visits = 3;
      // @ts-expect-error return type follows Work<T>
      const wrong: string = await h.runtime.run(program);
      void wrong;
    }
  });

  it('initializes every declared metric, including metadata and marker work byte additions', () => {
    const expected: Metric[] = [
      'visits', 'emittedBytes', 'sortComparisons', 'comparedCodeUnits',
      'yields', 'checks', 'observedAborts', 'primitiveExceptions',
      'candidateRows', 'candidateBytes', 'sealRows', 'sealBytes', 'metadataRows', 'metadataBytes', 'unmeasuredValues',
      'pageTransactions', 'sealTransactions', 'eofChecks', 'markerCasRows',
      'markerBytes', 'markerWorkBytes', 'writes', 'stageTransactions', 'stageRecords',
      'sourceDerivations', 'targetDerivations', 'projectReconstructions',
      'frameBytes', 'hashBytes', 'sourceHashBytes', 'targetHashBytes',
      'proofHashBytes', 'stageHashBytes', 'markerHashBytes', 'legacyHashBytes',
      'legacyCaptures', 'legacyReads', 'legacyReadBytes', 'backupValidations',
      'retries', 'ownedBytes', 'ownedHighWater', 'captureGraphs', 'captureHighWater',
    ];
    const h = makeWorkHarness();
    expect(Object.keys(h.runtime.snapshot()).sort()).toEqual(expected.sort());
    expect(Object.values(h.runtime.snapshot('discovery')).every(value => value === 0)).toBe(true);
  });

  it('closes successful programs and lets validation errors remain application-catchable', async () => {
    let closed = 0;
    function* program() {
      try {
        try { yield* effect(1025, () => { throw new Error('must not run'); }); }
        catch (error) { expect(error).toBeInstanceOf(RangeError); }
        return yield* effect(1, () => 7);
      } finally { closed++; }
    }
    expect(runSync(program())).toBe(7);
    const h = makeWorkHarness();
    expect(await h.runtime.run(program())).toBe(7);
    expect(h.runtime.stopped()).toBe(false);
    expect(closed).toBe(2);
  });

  it('preserves lifecycle loss when both operation and cleanup throw', async () => {
    const h = makeWorkHarness();
    function* program() {
      try {
        try { yield* effect(1, () => { h.cancel(); throw new Error('application'); }); }
        catch { throw new Error('must not catch lifecycle'); }
      } finally { throw new Error('cleanup'); }
    }
    await expect(h.runtime.run(program())).rejects.toThrow('cancelled');
    expect(h.runtime.snapshot().observedAborts).toBe(1);
  });

  it('checks lifecycle even when a generator step throws an application error', async () => {
    const h = makeWorkHarness();
    function* program(): Work<void> {
      h.cancel();
      throw new Error('application');
    }
    await expect(h.runtime.run(program())).rejects.toThrow('cancelled');
  });

  it('checks before scheduling and after rejected injected yields', async () => {
    let current = true, taskCalls = 0;
    const runtime = createWorkRuntime({
      assertCurrent: () => { if (!current) throw new Error('lifecycle'); },
      yieldTask: () => new Promise((_, reject) => {
        taskCalls++; setTimeout(() => { current = false; reject(new Error('scheduler')); }, 0);
      }),
    });
    try {
      await expect(runtime.run(count(1025))).rejects.toThrow('lifecycle');
      expect(taskCalls).toBe(1);
      expect(runtime.snapshot().visits).toBe(1024);
    } finally { runtime.dispose(); }
    const h = makeWorkHarness();
    h.observe(h.cancel);
    await expect(h.runtime.run(count(1025))).rejects.toThrow('cancelled');
    expect(h.runtime.snapshot().yields).toBe(0);
  });

  it('captures observer and guard property access once and freezes method objects', () => {
    let guardGets = 0, observerGets = 0, taskGets = 0, events = 0;
    const runtime = createWorkRuntime({
      get assertCurrent() { guardGets++; return () => {}; },
      get observe() { observerGets++; return () => { events++; }; },
      get yieldTask() { taskGets++; return undefined; },
    });
    try {
      runtime.notify(); runtime.notify();
      expect([guardGets, observerGets, taskGets, events]).toEqual([1, 1, 1, 2]);
      expect(Object.values(runtime).every(Object.isFrozen)).toBe(true);
    } finally { runtime.dispose(); }
  });

  it('suppresses thenable rejection when rejecting asynchronous operations in both drivers', async () => {
    const program = () => effect(1, () => Promise.reject(new Error('async operation')));
    expect(() => runSync(program())).toThrow(/thenable/);
    await expect(makeWorkHarness().runtime.run(program())).rejects.toThrow(/thenable/);
    await new Promise(resolve => setTimeout(resolve, 0));
  });
});

describe('streamed normalization frames', () => {
  const rawFrame = (text: string): Frame => emit => textWork(text, emit);
  const oracle = (text: string) => createHash('sha256').update(text).digest('hex');
  const collect = (frame: Frame) => {
    const fragments: string[] = [];
    runSync(frame(function* (text) { yield* effect(1, () => { fragments.push(text); }); }));
    expect(fragments.every(fragment => fragment.length <= 64)).toBe(true);
    return fragments.join('');
  };
  const inspectHashes = () => {
    const factory = incrementalHash.createNormalizationSha256;
    const hashes: incrementalHash.NormalizationSha256[] = [];
    // Observe real owned scratch, without substituting a fake hash algorithm.
    vi.spyOn(incrementalHash, 'createNormalizationSha256').mockImplementation(() => {
      const hash = factory(); hashes.push(hash); return hash;
    });
    return hashes;
  };

  it('pins canonical, envelope and list byte grammar', async () => {
    const row = { z: -0, a: ['😀', '\ud800', '\u0000'] };
    const canonical = '{"a":["😀","\\ud800","\\u0000"],"z":0}';
    const cases: [Frame, string][] = [
      [canonicalFrame(row), canonical],
      [envelopeFrame('source', row), `["source",${canonical}]`],
      [listFrame('rows', [row, {}]), `["rows",["envelope",${canonical}],["envelope",{}]]`],
      [listFrame('empty', []), '["empty",]'],
      [envelopeFrame('"😀', {}), '["\\"😀",{}]'],
    ];
    for (const [frame, expected] of cases) {
      expect(collect(frame)).toBe(expected);
      expect(await hashFrame(makeWorkHarness().runtime, 'source', frame)).toBe(oracle(expected));
    }
  });

  it('sorts only enumerable string fields, preserving existing envelope semantics', () => {
    const row = Object.defineProperty({ '2': 'two', '10': 'ten', [Symbol('hidden')]: 1 }, 'hidden', { value: 1 });
    expect(collect(envelopeFrame('row', row))).toBe('["row",{"10":"ten","2":"two"}]');
  });

  it('resets canonical nesting for each envelope payload field', async () => {
    let payload: object = {};
    for (let i = 0; i < 512; i++) payload = { child: payload };
    const expected = `["row",{"payload":${canonicalStringify(payload)}}]`;
    expect(await hashFrame(makeWorkHarness().runtime, 'source', envelopeFrame('row', { payload }))).toBe(oracle(expected));
    await expect(hashFrame(makeWorkHarness().runtime, 'source', canonicalFrame({ payload }))).rejects.toThrow(/nesting/);
  });

  it.each([0, 1, 15, 16, 55, 56, 63, 64, 65, 119, 120, 127, 128, 129, 1024])
  ('matches SHA-256 across block and padding boundaries: %s bytes', async size => {
    const h = makeWorkHarness();
    const text = 'x'.repeat(size);
    expect(await digestFrame(rawFrame(text), h.runtime, 'source')).toBe(oracle(text));
    expect(h.runtime.snapshot()).toMatchObject({ frameBytes: size, hashBytes: size, sourceHashBytes: size, ownedBytes: 0 });
  });

  it('counts UTF-8 bytes, not UTF-16 units or hash padding', async () => {
    const text = `${'x'.repeat(15)}😀Café ☕\ud800`;
    const h = makeWorkHarness();
    const bytes = new TextEncoder().encode(text).length;
    expect(runSync(frameBytesWork(rawFrame(text)))).toBe(bytes);
    expect(await h.runtime.run(frameBytesWork(rawFrame(text)))).toBe(bytes);
    expect(await hashFrame(h.runtime, 'legacy', rawFrame(text))).toBe(oracle(text));
    expect(h.runtime.snapshot()).toMatchObject({ frameBytes: bytes, hashBytes: bytes, legacyHashBytes: bytes, sourceHashBytes: 0 });
  });

  it.each(['☕'.repeat(32), '😀'.repeat(33), '\ud800'.repeat(33)])
  ('hashes multibyte fragments across compression boundaries', async text => {
    const h = makeWorkHarness();
    expect(await hashFrame(h.runtime, 'source', rawFrame(text))).toBe(oracle(text));
    expect(h.runtime.snapshot().hashBytes).toBe(new TextEncoder().encode(text).length);
  });

  it('accepts empty fragments without counting padding or inventing input bytes', async () => {
    const frame: Frame = function* (emit) {
      for (const fragment of ['', 'a', '', 'bc', '']) yield* emit(fragment);
    };
    const h = makeWorkHarness();
    expect(await hashFrame(h.runtime, 'source', frame)).toBe(oracle('abc'));
    expect(runSync(frameBytesWork(frame))).toBe(3);
    expect(h.runtime.snapshot()).toMatchObject({ hashBytes: 3, sourceHashBytes: 3, ownedBytes: 0 });
  });

  it('does not require ambient WebCrypto for a work-aware digest', async () => {
    vi.stubGlobal('crypto', undefined);
    expect(await sha256Hex('abc', undefined, makeWorkHarness().runtime)).toBe(oracle('abc'));
  });

  it.each(['source', 'target', 'proof', 'stage', 'marker', 'legacy'] as const)
  ('accounts only actual input for %s frames', async kind => {
    const h = makeWorkHarness();
    await hashFrame(h.runtime, kind, rawFrame('abc'));
    expect(h.runtime.snapshot()[`${kind}HashBytes`]).toBe(3);
    expect(h.runtime.snapshot().hashBytes).toBe(3);
  });

  it('shares remaining work budget and leaves runtime ownership with its caller', async () => {
    const h = makeWorkHarness();
    await h.runtime.run(count(1000));
    expect(await hashFrame(h.runtime, 'source', rawFrame('abc'))).toBe(oracle('abc'));
    expect(h.runtime.snapshot().yields).toBeGreaterThan(0);
    expect(h.runtime.stopped()).toBe(false);
    expect(await hashFrame(h.runtime, 'source', rawFrame('def'))).toBe(oracle('def'));
  });

  it.each(['success', 'frame failure', 'cancellation'] as const)('releases actual scratch on %s', async outcome => {
    const hashes = inspectHashes();
    const h = makeWorkHarness();
    const failure = new Error('frame failed');
    const frame: Frame = outcome === 'frame failure' ? function* (emit) {
      yield* emit('abc'); throw failure;
    } : rawFrame('x'.repeat(10000));
    if (outcome === 'cancellation') h.observe(h.cancel);
    const pending = hashFrame(h.runtime, 'source', frame);
    if (outcome === 'success') expect(await pending).toBe(oracle('x'.repeat(10000)));
    else if (outcome === 'frame failure') await expect(pending).rejects.toBe(failure);
    else await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(hashes).toHaveLength(1);
    expect(hashes[0].retainedBytes()).toBe(0);
    expect(h.runtime.snapshot()).toMatchObject({ ownedBytes: 0, ownedHighWater: 352 });
  });

  it('cleans scratch even if lifecycle is lost between allocation and ownership registration', async () => {
    const hashes = inspectHashes();
    const failure = new Error('owner lost');
    const runtime = createWorkRuntime({ assertCurrent() { if (hashes.length) throw failure; } });
    try {
      await expect(hashFrame(runtime, 'source', rawFrame('abc'))).rejects.toBe(failure);
      expect(hashes).toHaveLength(1);
      expect(hashes[0].retainedBytes()).toBe(0);
      expect(runtime.snapshot().ownedBytes).toBe(0);
    } finally { runtime.dispose(); }
  });

  it('rejects oversized frame fragments before whole-string encoding', async () => {
    const frame: Frame = function* (emit) { yield* emit('x'.repeat(100000)); };
    const h = makeWorkHarness();
    await expect(hashFrame(h.runtime, 'source', frame)).rejects.toThrow(/fragment/);
    expect(h.runtime.snapshot()).toMatchObject({ hashBytes: 0, ownedBytes: 0 });
    expect(() => runSync(frameBytesWork(frame))).toThrow(/fragment/);
  });

  it('rejects forged executors and unsupported frame kinds before allocating scratch', async () => {
    const hashes = inspectHashes();
    const h = makeWorkHarness();
    await expect(hashFrame({ ...h.runtime }, 'source', rawFrame('abc'))).rejects.toThrow(/authentic/);
    await expect(hashFrame(h.runtime, 'none' as 'source', rawFrame('abc'))).rejects.toThrow(/kind/);
    expect(hashes).toHaveLength(0);
  });
});

describe('bounded frame comparison', () => {
  const fragments = (...parts: string[]): Frame => function* (emit) {
    for (const part of parts) yield* emit(part);
  };

  it('uses one shared comparator for historical and normalized consumers', () => {
    expect(typeof equalFrameWork).toBe('function');
    expect(equalFrameWork).toBe(sharedEqualFrameWork);
  });

  it.each([
    [[], [], true], [[''], [], true], [['a', '', 'bc'], ['ab', 'c', ''], true],
    [['abc'], ['ab'], false], [['ab'], ['abc'], false], [['abc'], ['abd'], false],
    [[], ['x'], false], [['x'], [], false], [['😀', '☕'], ['😀☕'], true],
    [['\ud800'], ['\ud801'], false], [['\u0000'], [''], false],
  ] as const)('compares text independently of fragment boundaries: %j vs %j', async (left, right, expected) => {
    expect(runSync(equalFrameWork(fragments(...left), fragments(...right)))).toBe(expected);
    expect(await makeWorkHarness().runtime.run(equalFrameWork(fragments(...left), fragments(...right)))).toBe(expected);
  });

  it('passes operation results back to each producer', async () => {
    const frame: Frame = function* (emit) {
      const value = yield* effect(1, () => 7);
      yield* emit(String(value));
    };
    expect(await makeWorkHarness().runtime.run(equalFrameWork(frame, fragments('7')))).toBe(true);
  });

  it.each(['application', 'invalid cost'] as const)('routes %s failures through producer catches', async kind => {
    const frame: Frame = function* (emit) {
      try {
        yield* effect(kind === 'invalid cost' ? 1025 : 1, () => { throw new Error('application'); });
      } catch {
        yield* emit('recovered');
      }
    };
    expect(runSync(equalFrameWork(frame, fragments('recovered')))).toBe(true);
    expect(await makeWorkHarness().runtime.run(equalFrameWork(frame, fragments('recovered')))).toBe(true);
  });

  it('stops at the first mismatch without reading either tail and closes both producers', async () => {
    const tails = [0, 0], closed = [0, 0];
    const frame = (first: string, index: number): Frame => function* (emit) {
      try {
        yield* emit(first);
        yield* effect(1, () => { tails[index]++; });
        yield* textWork('x'.repeat(10000), emit);
      } finally { closed[index]++; }
    };
    expect(await makeWorkHarness().runtime.run(equalFrameWork(frame('a', 0), frame('b', 1)))).toBe(false);
    expect(tails).toEqual([0, 0]);
    expect(closed).toEqual([1, 1]);
  });

  it('closes both active producers when one fails', async () => {
    const failure = new Error('producer failed');
    const closed = [0, 0];
    const frame = (index: number): Frame => function* (emit) {
      try {
        yield* emit('same');
        if (index === 0) throw failure;
        yield* emit('tail');
      } finally { closed[index]++; }
    };
    await expect(makeWorkHarness().runtime.run(equalFrameWork(frame(0), frame(1)))).rejects.toBe(failure);
    expect(closed).toEqual([1, 1]);
  });

  it('still closes the second producer when the first finalizer throws', async () => {
    const closed = [0, 0];
    const frame = (index: number): Frame => function* (emit) {
      try { yield* emit(String(index)); }
      finally { closed[index]++; if (index === 0) throw new Error('cleanup failed'); }
    };
    await expect(makeWorkHarness().runtime.run(equalFrameWork(frame(0), frame(1)))).rejects.toThrow('cleanup failed');
    expect(closed).toEqual([1, 1]);
  });

  it('yields during long equal prefixes and accounts comparisons', async () => {
    const h = makeWorkHarness('prepare', true);
    const text = 'x'.repeat(5000);
    const frame: Frame = emit => textWork(text, emit);
    let taskRan = false;
    setTimeout(() => { taskRan = true; }, 0);
    expect(await h.runtime.run(equalFrameWork(frame, frame))).toBe(true);
    expect(taskRan).toBe(true);
    expect(h.runtime.snapshot().comparedCodeUnits).toBe(text.length * 2);
  });

  it('batches comparisons within fragments instead of dispatching per code unit', () => {
    const text = 'x'.repeat(16384);
    const frame: Frame = emit => textWork(text, emit);
    const program = equalFrameWork(frame, frame);
    let step = program.next(), operations = 0;
    while (step.done === false) {
      operations++;
      step = program.next(step.value.run());
    }
    expect(step.value).toBe(true);
    expect(operations).toBeLessThan(text.length);
  });

  it.each([0, 7, 15])('stops inside a fragment at mismatch offset %s', async offset => {
    const h = makeWorkHarness();
    const different = `${'x'.repeat(offset)}y${'x'.repeat(15 - offset)}`;
    expect(await h.runtime.run(equalFrameWork(fragments('x'.repeat(16)), fragments(different)))).toBe(false);
    expect(h.runtime.snapshot().comparedCodeUnits).toBe((offset + 1) * 2);
  });

  it('cancels without exposing lifecycle loss to producer catches', async () => {
    const h = makeWorkHarness();
    const closed = [0, 0];
    let caught = 0;
    const frame = (index: number): Frame => function* (emit) {
      try { yield* textWork('x'.repeat(10000), emit); }
      catch { caught++; }
      finally { closed[index]++; }
    };
    h.observe(h.cancel);
    await expect(h.runtime.run(equalFrameWork(frame(0), frame(1)))).rejects.toMatchObject({ name: 'AbortError' });
    expect(closed).toEqual([1, 1]);
    expect(caught).toBe(0);
    expect(h.runtime.snapshot().visits).toBeLessThanOrEqual(1024);
  });

  it('rejects an oversized fragment rather than buffering it', async () => {
    await expect(makeWorkHarness().runtime.run(equalFrameWork(fragments('x'.repeat(65)), fragments('x'))))
      .rejects.toThrow(/fragment/);
  });
});

describe('plain ordered JSON traversal', () => {
  const capture = (value: unknown) => {
    const chunks: string[] = [];
    const program = orderedJsonWork(value, function* (text) {
      yield* effect(1, () => { chunks.push(text); });
    });
    return { chunks, program };
  };

  it('pins enumeration order rather than canonical key sorting', async () => {
    const value = { z: 1, '10': 'ten', '2': 'two', a: { z: 2, a: 3 } };
    const expected = '{"2":"two","10":"ten","z":1,"a":{"z":2,"a":3}}';
    const output = capture(value);
    await makeWorkHarness().runtime.run(output.program);
    expect(output.chunks.join('')).toBe(expected);
    expect(output.chunks.join('')).not.toBe(canonicalStringify(value));
  });

  it.each([
    ['empty object', () => ({})], ['empty array', () => []], ['null', () => null],
    ['booleans', () => [true, false]], ['numbers', () => [-0, 1.25, NaN, Infinity, -Infinity]],
    ['Unicode', () => ({ text: '😀☕\ud800\u0000\t\n"\\' })],
    ['omitted properties', () => ({ a: undefined, b: () => {}, c: Symbol('x'), d: null, e: false })],
    ['array conversions', () => [undefined, () => {}, Symbol('x'), NaN, -0]],
    ['array holes', () => { const value = Array(3); value[1] = 'middle'; return value; }],
    ['non-index array fields', () => Object.assign([1], { ignored: true })],
    ['hidden/symbol fields', () => Object.defineProperty({ [Symbol()]: 2, visible: 1 }, 'hidden', { value: 3 })],
    ['null prototype', () => Object.assign(Object.create(null), { z: 1, a: 2 })],
    ['own proto field', () => JSON.parse('{"__proto__":{"safe":true},"z":1}')],
    ['root undefined', () => undefined], ['root function', () => () => {}], ['root symbol', () => Symbol()],
  ] as const)('matches JSON conversion for %s in both drivers', async (_label, make) => {
    const value = make();
    const expected = JSON.stringify(value) ?? '';
    const sync = capture(value);
    runSync(sync.program);
    expect(sync.chunks.join('')).toBe(expected);
    const cooperative = capture(value);
    await makeWorkHarness().runtime.run(cooperative.program);
    expect(cooperative.chunks.join('')).toBe(expected);
    expect(cooperative.chunks.every(chunk => chunk.length <= 64)).toBe(true);
    expect(runSync(frameBytesWork(orderedFrame(value)))).toBe(new TextEncoder().encode(expected).length);
  });

  it('hashes and measures ordered JSON through existing frame adapters', async () => {
    const value = { z: '😀'.repeat(100), a: [undefined, NaN, -0], ignored: undefined };
    const expected = JSON.stringify(value);
    const h = makeWorkHarness();
    const frame = orderedFrame(value);
    expect(await hashFrame(h.runtime, 'target', frame)).toBe(createHash('sha256').update(expected).digest('hex'));
    expect(await h.runtime.run(frameBytesWork(frame))).toBe(new TextEncoder().encode(expected).length);
    expect(await h.runtime.run(equalFrameWork(frame, emit => textWork(expected, emit)))).toBe(true);
  });

  it('does not invoke user toJSON in the prevalidated plain-data path', async () => {
    let calls = 0;
    const value = { toJSON() { calls++; return 'replacement'; }, z: 1 };
    const output = capture(value);
    await makeWorkHarness().runtime.run(output.program);
    expect(output.chunks.join('')).toBe('{"z":1}');
    expect(calls).toBe(0);
  });

  it('rejects accessors without invoking them, including array accessors', async () => {
    let calls = 0;
    for (const value of [{}, []]) {
      Object.defineProperty(value, Array.isArray(value) ? '0' : 'key', {
        enumerable: true, get() { calls++; return 1; },
      });
      expect(() => runSync(capture(value).program)).toThrow(/accessor/i);
      await expect(makeWorkHarness().runtime.run(capture(value).program)).rejects.toThrow(/accessor/i);
    }
    expect(calls).toBe(0);
  });

  it.each([
    ['bigint', () => 1n], ['nested bigint', () => ({ value: 1n })],
    ['object cycle', () => { const value: Record<string, unknown> = {}; value.self = value; return value; }],
    ['array cycle', () => { const value: unknown[] = []; value.push(value); return value; }],
    ['custom prototype', () => new Date()],
  ] as const)('rejects %s without returning partial JSON', async (_label, make) => {
    expect(() => runSync(capture(make()).program)).toThrow(TypeError);
    await expect(makeWorkHarness().runtime.run(capture(make()).program)).rejects.toThrow(TypeError);
  });

  it('duplicates shared acyclic values and does not impose a new framing depth limit', async () => {
    let value: object = { last: true };
    for (let i = 0; i < 600; i++) value = { child: value };
    const repeated = [value, value];
    const output = capture(repeated);
    await makeWorkHarness().runtime.run(output.program);
    expect(output.chunks.join('')).toBe(JSON.stringify(repeated));
  });

  it.each(['string', 'omitted fields', 'sparse array'] as const)('can cancel during %s work', async kind => {
    const value = kind === 'string' ? 'x'.repeat(10000) : kind === 'sparse array' ? Array(5000)
      : Object.fromEntries(Array.from({ length: 3000 }, (_, i) => [String(i), undefined]));
    const h = makeWorkHarness();
    const output = capture(value);
    h.observe(h.cancel);
    await expect(h.runtime.run(output.program)).rejects.toMatchObject({ name: 'AbortError' });
    expect(output.program.next().done).toBe(true);
    expect(h.runtime.snapshot().visits).toBeLessThanOrEqual(1024);
  });
});

describe('default yield slices', () => {
  afterEach(() => setDefaultWorkYieldSlice(0));
  const program = function* () { for (let index = 0; index < 8; index++) yield* effect(1024, () => {}); return 'done'; };
  const drain = async () => {
    const runtime = createWorkRuntime({ assertCurrent() {} });
    let timerRan = false; const timer = setTimeout(() => { timerRan = true; }, 0);
    try { return { value: await runtime.run(program()), timerRan, yields: runtime.snapshot().yields }; }
    finally { clearTimeout(timer); runtime.dispose(); }
  };

  it('keeps one task yield per quantum by default', async () => {
    const result = await drain();
    expect(result).toMatchObject({ value: 'done', yields: 7 });
  });

  it('coalesces task yields inside a slice without changing quantum accounting', async () => {
    setDefaultWorkYieldSlice(60_000);
    const result = await drain();
    expect(result).toEqual({ value: 'done', timerRan: false, yields: 7 });
  });

  it.each([-1, Number.NaN, Infinity, '4'])('rejects an invalid slice %s', value => {
    expect(() => setDefaultWorkYieldSlice(value as number)).toThrow(RangeError);
  });
});
