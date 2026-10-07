// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createNormalizationSha256 } from '../../../../services/localWorkspace/normalized/incrementalSha256';
import { canonicalStringify } from '../../../../services/localWorkspace/canonical';
import { frameRecord } from '../../../../services/localWorkspace/normalized/commitProof';

const encode = (text: string) => new TextEncoder().encode(text);
const oracle = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const widths = [1, 7, 55, 56, 63, 64, 65, 127, 128, 191, 192];

function digest(bytes: Uint8Array, width: number) {
  const hash = createNormalizationSha256();
  let inputs = 0;
  let blocks = 0;
  expect(hash.retainedBytes()).toBe(352);
  for (let offset = 0; offset < bytes.length; offset += width) {
    const chunk = bytes.subarray(offset, offset + width);
    const work = hash.update(chunk);
    expect(work.inputBytes).toBe(chunk.length);
    expect(work.blocks).toBe(Math.floor((inputs % 64 + chunk.length) / 64));
    expect(work.blocks).toBeLessThanOrEqual(3);
    expect(work.visits).toBe(chunk.length + 136 * work.blocks);
    expect(work.visits).toBeLessThanOrEqual(600);
    expect(hash.retainedBytes()).toBe(352);
    inputs += work.inputBytes;
    blocks += work.blocks;
  }
  const final = hash.finish();
  const paddingBlocks = bytes.length % 64 < 56 ? 1 : 2;
  const paddingBytes = paddingBlocks * 64 - bytes.length % 64;
  expect(final.work).toEqual({ inputBytes: 0, blocks: paddingBlocks,
    visits: paddingBytes + 136 * paddingBlocks + 8 + 136 });
  expect(final.work.blocks).toBeGreaterThanOrEqual(1);
  expect(final.work.blocks).toBeLessThanOrEqual(2);
  expect(final.work.visits).toBeLessThanOrEqual(488);
  expect(blocks + final.work.blocks).toBe(Math.ceil((bytes.length + 9) / 64));
  expect(inputs).toBe(bytes.length);
  expect(final.digest).toMatch(/^[0-9a-f]{64}$/);
  expect(hash.retainedBytes()).toBe(0);
  return final.digest;
}

describe('bounded incremental SHA-256', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
  ])('matches known vector %j', (text, expected) => {
    for (const width of widths) expect(digest(encode(text), width)).toBe(expected);
  });

  it('matches the million-a vector without retaining input', () => {
    const hash = createNormalizationSha256();
    const chunk = new Uint8Array(64).fill(97);
    for (let offset = 0; offset < 1_000_000; offset += 64) {
      expect(hash.update(chunk)).toEqual({ inputBytes: 64, blocks: 1, visits: 200 });
      expect(hash.retainedBytes()).toBe(352);
    }
    expect(hash.finish().digest).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
    expect(hash.retainedBytes()).toBe(0);
  });

  it.each([0, 1, 55, 56, 63, 64, 65, 127, 128, 129, 4097])('handles padding/fragmentation at %i bytes', length => {
    const bytes = Uint8Array.from({ length }, (_, index) => (index * 37 + 255) & 255);
    for (const width of widths) expect(digest(bytes, width)).toBe(oracle(bytes));
  });

  it('copies a caller chunk immediately, rejects oversized steps without consuming them', () => {
    const hash = createNormalizationSha256();
    const first = encode('a');
    hash.update(first);
    first[0] = 122;
    expect(() => hash.update(new Uint8Array(193))).toThrow(RangeError);
    expect(hash.update(new Uint8Array(0))).toEqual({ inputBytes: 0, blocks: 0, visits: 0 });
    hash.update(encode('bc'));
    expect(hash.finish().digest).toBe(oracle(encode('abc')));
    expect(hash.retainedBytes()).toBe(0);
    expect(() => hash.update(encode('x'))).toThrow('closed');
    expect(() => hash.update(new Uint8Array(0))).toThrow('closed');
    expect(() => hash.finish()).toThrow('closed');
    expect(hash.dispose()).toEqual({ inputBytes: 0, blocks: 0, visits: 0 });
  });

  it.each([0, 2, 64])('releases its fixed buffers on explicit disposal after %i bytes', length => {
    const hash = createNormalizationSha256();
    hash.update(new Uint8Array(length));
    expect(hash.dispose()).toEqual({ inputBytes: 0, blocks: 0, visits: 136 });
    expect(hash.retainedBytes()).toBe(0);
    expect(() => hash.finish()).toThrow('closed');
    expect(() => hash.update(new Uint8Array(0))).toThrow('closed');
    expect(hash.dispose()).toEqual({ inputBytes: 0, blocks: 0, visits: 0 });
    expect(hash.retainedBytes()).toBe(0);
  });

  it('keeps empty updates inert before and after block compression', () => {
    const hash = createNormalizationSha256();
    const bytes = new Uint8Array(64).fill(255);
    for (let i = 0; i < 3; i++) {
      expect(hash.update(new Uint8Array(0))).toEqual({ inputBytes: 0, blocks: 0, visits: 0 });
    }
    hash.update(bytes);
    expect(hash.update(new Uint8Array(0))).toEqual({ inputBytes: 0, blocks: 0, visits: 0 });
    expect(hash.finish().digest).toBe(oracle(bytes));
  });

  it('copies offset views across compression and leaves no state from rejected steps', () => {
    const hash = createNormalizationSha256();
    const backing = Uint8Array.from({ length: 256 }, (_, index) => index);
    const view = backing.subarray(32, 96);
    const expected = new Uint8Array([97, ...view, 98]);
    hash.update(encode('a'));
    expect(() => hash.update(backing)).toThrow(RangeError);
    expect(hash.update(view)).toEqual({ inputBytes: 64, blocks: 1, visits: 200 });
    backing.fill(0);
    expect(() => hash.update(new Uint8Array(193))).toThrow(RangeError);
    hash.update(encode('b'));
    expect(hash.finish().digest).toBe(oracle(expected));
  });

  it('accounts for every pending-byte count including the maximum finish cost', () => {
    for (let length = 0; length < 64; length++) {
      const bytes = new Uint8Array(length).fill(length);
      expect(digest(bytes, 64)).toBe(oracle(bytes));
    }
    const hash = createNormalizationSha256();
    hash.update(new Uint8Array(56));
    expect(hash.finish().work).toEqual({ inputBytes: 0, blocks: 2, visits: 488 });
  });

  it('keeps interleaved instances independent when one is disposed', () => {
    const first = createNormalizationSha256();
    const second = createNormalizationSha256();
    first.update(new Uint8Array(64).fill(1));
    second.update(encode('a'));
    first.dispose();
    expect(second.retainedBytes()).toBe(352);
    second.update(encode('bc'));
    expect(second.finish().digest).toBe(oracle(encode('abc')));
  });

  it('matches current canonical and record/core frame hash bytes', () => {
    const payload = { text: '\u0000\b\t\n\f\r"\\ café 😀 \ud800 \udc00', n: -0, empty: '',
      array: [false, null, { z: 1, a: 2 }], long: '😀x'.repeat(30_000) };
    const record = { key: ['g', 'p', 'i', 'n'], formatVersion: 3, value: payload,
      encodedSize: { valueBytes: 1 }, commitProof: null, commitWindow: { entries: [], floorRevision: 0 } };
    // These are byte-framing oracles, not claims of normalized record admission.
    const frames = [canonicalStringify(payload), frameRecord('projectNodes', record), frameRecord('projectNodes', record, true)];
    for (const frame of frames) expect(digest(encode(frame), 63)).toBe(oracle(encode(frame)));
    expect(digest(encode(frames[1]), 64)).not.toBe(digest(encode(frames[2]), 64));
  });
});
