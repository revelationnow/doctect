// @vitest-environment node
import { expect, it } from 'vitest';
import { canonicalBytesWork, canonicalText, canonicalWork, frameBytesWork, orderedJsonWork, plainJsonBytesWork } from '../../../../shared/jsonWork.js';
import type { Work } from '../../../../shared/cooperativeWork.js';
import { makeWorkHarness } from '../../../helpers/normalizationWorkHarness';

it.each([35, 36])('keeps the 25-unit negative decimal bounded beside a %i-unit key', async length => {
  const value = { a: 0, ['z'.repeat(length)]: -0.0000012345678901234567 };
  for (const canonical of [false, true]) {
    const h = makeWorkHarness(), text = canonical ? canonicalText(value) : JSON.stringify(value);
    expect(await h.runtime.run(frameBytesWork(emit => canonical ? canonicalWork(value, emit) : orderedJsonWork(value, emit)))).toBe(Buffer.byteLength(text));
    expect(h.runtime.snapshot().ownedBytes).toBe(0);
  }
});

it.each(['canonical-output', 'canonical-bytes', 'ordered-output', 'ordered-bytes'] as const)
('fuses bounded ASCII scalar fields in %s without separate punctuation/key/value steps', async mode => {
  const value = Array.from({ length: 32 }, (_, index) => ({ width: 10, height: 20, visible: true, x: index, y: null, label: 'read me' }));
  const chunks: string[] = [], emit = function* (text: string): Work<void> { chunks.push(text); };
  const program: Work<unknown> = mode === 'canonical-output' ? canonicalWork(value, emit) : mode === 'ordered-output' ? orderedJsonWork(value, emit)
    : mode === 'canonical-bytes' ? canonicalBytesWork(value) : plainJsonBytesWork(value);
  let operations = 0;
  function* counted(): Work<unknown> {
    let result: unknown;
    try { for (;;) { const next = program.next(result); if (next.done === true) return next.value; operations++; result = yield next.value; } }
    finally { program.return(undefined); }
  }
  const h = makeWorkHarness(), actual = await h.runtime.run(counted());
  const expected = mode.startsWith('canonical') ? canonicalText(value) : JSON.stringify(value);
  expect(mode.endsWith('output') ? chunks.join('') : actual).toBe(mode.endsWith('output') ? expected : Buffer.byteLength(expected));
  expect(operations).toBeLessThan(mode.startsWith('canonical') ? 2400 : 1600);
  expect(chunks.every(text => text.length <= 64)).toBe(true); expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it.each([
  { '': '', simple: 'a'.repeat(58), other: 'x'.repeat(64), long: 'x'.repeat(100) },
  { 'quo"te': 'slash\\', key: 'line\n', other: '\0', unicode: '根😀\ud800', del: '\x7f' },
  { small: -0, large: Number.MAX_VALUE, low: Number.MIN_VALUE, negative: -Number.MAX_VALUE, n: null, yes: true, no: false },
  { nested: { a: 1 }, array: [true, false, null, 'x'], text: 'after nested' },
])('scalar field fusion preserves independent canonical and ordered bytes %#', async value => {
  const h = makeWorkHarness();
  for (const canonical of [false, true]) {
    const chunks: string[] = [], emit = function* (text: string): Work<void> { chunks.push(text); };
    await h.runtime.run(canonical ? canonicalWork(value, emit) : orderedJsonWork(value, emit));
    const text = canonical ? canonicalText(value) : JSON.stringify(value);
    expect(chunks.join('')).toBe(text);
    expect(await h.runtime.run(canonical ? canonicalBytesWork(value) : plainJsonBytesWork(value))).toBe(Buffer.byteLength(text));
    expect(chunks.every(part => part.length <= 64)).toBe(true);
  }
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it.each(['getter', 'undefined', 'NaN', 'bigint'] as const)('scalar field fusion keeps refusal and produced prefix for %s', async kind => {
  const value: any = { a: 1, b: true, c: undefined }; let gets = 0;
  if (kind === 'getter') Object.defineProperty(value, 'c', { enumerable: true, get() { gets++; return 2; } });
  if (kind === 'NaN') value.c = NaN;
  if (kind === 'bigint') value.c = 1n;
  const h = makeWorkHarness(), chunks: string[] = [];
  await expect(h.runtime.run(canonicalWork(value, function* (text) { chunks.push(text); }))).rejects.toThrow();
  expect(chunks.join('')).toBe(kind === 'getter' ? '{"a":1,"b":true' : '{"a":1,"b":true,"c":');
  expect(gets).toBe(0); expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it.each(['canonical', 'ordered'] as const)('measures %s scalar fields without the output-token pipeline', async mode => {
  const value = Array.from({ length: 32 }, (_, index) => ({
    label: 'quoted\n'.repeat(15), 'wide☃': '根😀'.repeat(16), dimension: index + 0.125, enabled: true, absent: null,
  }));
  const program = mode === 'canonical' ? canonicalBytesWork(value) : plainJsonBytesWork(value);
  let operations = 0;
  function* counted(): Work<number> {
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
  expect(await h.runtime.run(counted())).toBe(Buffer.byteLength(JSON.stringify(value)));
  expect(operations).toBeLessThan(mode === 'canonical' ? 1450 : 1000);
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it.each([0, 1, 62, 63, 64, 125, 126, 127, 128, 249, 250, 251, 512])
('measures escaped/surrogate scalar fields across the %i-unit boundary', async length => {
  const text = '\0\b\t\n\f\r"\\根😀\ud800\udc00\ud800X\udc00'.repeat(40).slice(0, length);
  const value = { [text]: text, z: -0.0000012345678901234567, a: false, n: null, yes: true };
  const h = makeWorkHarness();
  expect(await h.runtime.run(canonicalBytesWork(value))).toBe(Buffer.byteLength(canonicalText(value)));
  expect(await h.runtime.run(plainJsonBytesWork(value))).toBe(Buffer.byteLength(JSON.stringify(value)));
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it.each(['canonical', 'ordered'] as const)('batches %s measurement fields under one bounded scalar budget', async mode => {
  const value = Array.from({ length: 32 }, () => ({ a: 1, b: 2, c: 3, d: 4, e: 5, f: true, g: false, h: null, i: 'ok' }));
  const program = mode === 'canonical' ? canonicalBytesWork(value) : plainJsonBytesWork(value);
  let operations = 0;
  function* counted(): Work<number> {
    let result: unknown;
    try {
      for (;;) {
        const next = program.next(result);
        if (next.done === true) return next.value;
        operations++; result = yield next.value;
      }
    } finally { program.return(undefined as never); }
  }
  const h = makeWorkHarness();
  expect(await h.runtime.run(counted())).toBe(Buffer.byteLength(JSON.stringify(value)));
  expect(operations).toBeLessThan(mode === 'canonical' ? 950 : 600);
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});
