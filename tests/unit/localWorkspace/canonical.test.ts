// @vitest-environment node
import { webcrypto } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { effect, runSync, type Work } from '../../../shared/cooperativeWork.js';
import { canonicalWork, compareStringsWork, stableSortWork, rawValueWeightWork, retainRawValue, type Frame } from '../../../shared/jsonWork.js';
import { makeWorkHarness } from '../../helpers/normalizationWorkHarness';
import {
  canonicalStringify,
  digestLegacySnapshot,
  digestWorkspaceContent,
  legacySnapshotFrame,
  workspaceContentFrame,
  sha256Hex,
} from '../../../services/localWorkspace/canonical';
import {
  LEGACY_DOCUMENT_KEYS,
  LEGACY_KEYS,
  legacySnapshot,
  workspaceSnapshot,
} from '../../helpers/localWorkspaceFixtures';

const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

describe('raw logical byte weights', () => {
  it('retains a borrowed image until explicit release, without cloning it', async () => {
    const h = makeWorkHarness(); const value = { text: '😀' };
    const retained = retainRawValue(value, h.runtime);
    await Promise.all([retained.measure(), retained.measure()]);
    expect(retained.value).toBe(value);
    expect(h.runtime.snapshot().ownedBytes).toBe(runSync(rawValueWeightWork(value)).bytes);
    h.runtime.dispose(); retained.release(); retained.release();
    expect(h.runtime.snapshot().ownedBytes).toBe(0);
    expect(() => retained.value).toThrow('released');
    expect(value.text).toBe('😀');
  });
  it('allows release after measurement cancellation', async () => {
    const h = makeWorkHarness(); const retained = retainRawValue({ text: 'x'.repeat(10000) }, h.runtime);
    h.observe(h.cancel);
    await expect(retained.measure()).rejects.toMatchObject({ name: 'AbortError' });
    retained.release(); expect(h.runtime.snapshot().ownedBytes).toBe(0);
    expect(() => retained.value).toThrow('released');
  });
  it('stops measuring when its owner is released during a yield', async () => {
    const h = makeWorkHarness(); const retained = retainRawValue({ text: 'x'.repeat(100000) }, h.runtime);
    h.observe(() => retained.release());
    await expect(retained.measure()).rejects.toThrow('released');
    expect(h.runtime.snapshot().visits).toBeLessThan(2048);
    expect(h.runtime.snapshot().ownedBytes).toBe(0);
  });
  it('pins scalar, Unicode and key weights independently of JSON frames', async () => {
    const h = makeWorkHarness('prerequisite');
    expect(await h.runtime.run(rawValueWeightWork({ x: 'é😀', y: null }))).toEqual({ bytes: 32, unmeasuredValues: 0 });
    expect(runSync(rawValueWeightWork([true, 3, undefined]))).toEqual({ bytes: 35, unmeasuredValues: 0 });
  });
  it('visits cycles and aliases once without rejecting or mutating them', async () => {
    const h = makeWorkHarness(); const value: any = { text: 'abc' }; value.self = value;
    expect(await h.runtime.run(rawValueWeightWork(value))).toEqual({ bytes: 35, unmeasuredValues: 0 });
    expect(value.self).toBe(value);
  });
  it('walks Map/Set contents and counts Date as a scalar', async () => {
    const h = makeWorkHarness();
    expect(await h.runtime.run(rawValueWeightWork(new Map([['é', new Set([new Date(0), true])]]))))
      .toEqual({ bytes: 42, unmeasuredValues: 0 });
  });
  it('counts shared binary backing storage once without copying bytes', async () => {
    const buffer = new ArrayBuffer(100); const h = makeWorkHarness();
    expect(await h.runtime.run(rawValueWeightWork([buffer, new Uint8Array(buffer), new DataView(buffer)])))
      .toEqual({ bytes: 151, unmeasuredValues: 0 });
    expect(await h.runtime.run(rawValueWeightWork(new Blob(['é😀'])))).toEqual({ bytes: 14, unmeasuredValues: 0 });
  });
  it('flags unsupported weights without converting large BigInts or invoking getters', async () => {
    const h = makeWorkHarness(); const getter = vi.fn(() => { throw new Error('must not run'); });
    const value = Object.defineProperty({ big: 1n << 100000n, opaque: /x/ }, 'access', { enumerable: true, get: getter });
    expect(await h.runtime.run(rawValueWeightWork(value))).toEqual({ bytes: 47, unmeasuredValues: 3 });
    expect(getter).not.toHaveBeenCalled();
  });
  it('does not walk sparse array holes', async () => {
    const h = makeWorkHarness(); const value = []; value.length = 1_000_000;
    expect(await h.runtime.run(rawValueWeightWork(value))).toEqual({ bytes: 8, unmeasuredValues: 0 });
    expect(h.runtime.snapshot().visits).toBeLessThan(20);
  });
  it('can cancel long text traversal without publishing partial weights', async () => {
    const h = makeWorkHarness(); h.observe(() => h.cancel());
    await expect(h.runtime.run(rawValueWeightWork({ value: '😀'.repeat(10000) }))).rejects.toMatchObject({ name: 'AbortError' });
    expect(h.runtime.snapshot().hashBytes).toBe(0);
  });
  it('uses an iterative traversal for deeply nested raw metadata', async () => {
    let value: unknown = null;
    for (let i = 0; i < 2000; i++) value = { x: value };
    expect(await makeWorkHarness().runtime.run(rawValueWeightWork(value))).toEqual({ bytes: 18008, unmeasuredValues: 0 });
  });
});

beforeAll(() => Object.defineProperty(globalThis, 'crypto', {
  configurable: true,
  value: webcrypto,
}));

afterAll(() => {
  if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto);
  else Reflect.deleteProperty(globalThis, 'crypto');
});

describe('canonicalStringify', () => {
  it('sorts object keys recursively but preserves array order', () => {
    expect(canonicalStringify({ z: 1, a: { y: 2, x: 3 }, rows: ['b', 'a'] }))
      .toBe('{"a":{"x":3,"y":2},"rows":["b","a"],"z":1}');
  });

  it('pins Unicode, emoji, and lone-surrogate encoding', () => {
    expect(canonicalStringify({ text: 'Café ☕', lone: '\ud800', emoji: '😀' }))
      .toBe('{"emoji":"😀","lone":"\\ud800","text":"Café ☕"}');
  });

  it('normalizes negative zero in objects and arrays', () => {
    expect(canonicalStringify({ object: -0, array: [-0] }))
      .toBe('{"array":[0],"object":0}');
  });

  it.each([
    ['undefined', undefined],
    ['NaN', Number.NaN],
    ['Infinity', Infinity],
    ['negative Infinity', -Infinity],
    ['BigInt', 1n],
    ['function', () => 1],
    ['symbol', Symbol('value')],
  ])('rejects non-JSON value %s', (_label, value) => {
    expect(() => canonicalStringify({ value } as never)).toThrow(/JSON-compatible/);
  });

  it('rejects sparse arrays and non-index array properties', () => {
    const sparse = Array(2);
    sparse[1] = 'present';
    const extended = ['value'] as string[] & { extra?: string };
    extended.extra = 'hidden from JSON array output';

    expect(() => canonicalStringify(sparse)).toThrow(/JSON-compatible/);
    expect(() => canonicalStringify(extended)).toThrow(/JSON-compatible/);
  });

  it('rejects accessors without invoking them', () => {
    let calls = 0;
    const value = Object.defineProperty({}, 'secret', {
      enumerable: true,
      get: () => {
        calls += 1;
        return 'secret';
      },
    });

    expect(() => canonicalStringify(value)).toThrow(/JSON-compatible/);
    expect(calls).toBe(0);
  });

  it('rejects custom prototypes, symbol keys, and cycles', () => {
    const custom = Object.create({ inherited: true });
    custom.value = 1;
    const symbolKeyed = { visible: true, [Symbol('hidden')]: true };
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(() => canonicalStringify(custom)).toThrow(/JSON-compatible/);
    expect(() => canonicalStringify(symbolKeyed)).toThrow(/JSON-compatible/);
    expect(() => canonicalStringify(cyclic)).toThrow(/JSON-compatible/);
  });

  it('caps nesting at 512 containers', () => {
    const root: Record<string, unknown> = {};
    let cursor = root;
    for (let depth = 0; depth < 513; depth += 1) {
      const child: Record<string, unknown> = {};
      cursor.child = child;
      cursor = child;
    }
    expect(() => canonicalStringify(root)).toThrow(/JSON-compatible.*nesting/i);
  });
});

describe('canonical digests', () => {
  it('streams workspace digests without SubtleCrypto or changing inputs', async () => {
    const source = workspaceSnapshot();
    const before = structuredClone(source);
    const expected = await digestWorkspaceContent(source);
    const digest = vi.fn(() => { throw new Error('whole-frame digest'); });
    const h = makeWorkHarness();
    expect(await digestWorkspaceContent(source, { digest } as unknown as SubtleCrypto, h.runtime)).toBe(expected);
    expect(source).toStrictEqual(before);
    expect(digest).not.toHaveBeenCalled();
    // Historical workspace content is a source in normalized migration (§S06).
    expect(h.runtime.snapshot().sourceHashBytes).toBeGreaterThan(0);
    expect(h.runtime.snapshot().targetHashBytes).toBe(0);
    expect(h.runtime.snapshot().ownedBytes).toBe(0);
  });

  it('exports exact reusable workspace and legacy frames', () => {
    const collect = (frame: Frame) => {
      const chunks: string[] = [];
      runSync(frame(function* (text) { yield* effect(1, () => { chunks.push(text); }); }));
      expect(chunks.every(text => text.length <= 64)).toBe(true);
      return chunks.join('');
    };
    const empty = { projects: [], activeProjectId: null, customPresets: [], pendingImports: [] };
    expect(collect(workspaceContentFrame(empty))).toBe('{"activeProjectId":null,"customPresets":[],"format":"doctect-indexeddb-workspace","pendingImports":[],"projectOrder":[],"projects":[],"version":1}');
    const legacy = legacySnapshot({});
    expect(collect(legacySnapshotFrame(legacy))).toBe(canonicalStringify({
      format: 'doctect-legacy-source', version: 1,
      entries: LEGACY_DOCUMENT_KEYS.map(key => ({ key, present: false, raw: null })),
    }));
  });

  it('streams wide project/import lists without map-built projection arrays', async () => {
    const base = workspaceSnapshot();
    const source = { ...base,
      projects: Array.from({ length: 120 }, (_, index) => ({ ...base.projects[0], id: `p-${index}` })),
      pendingImports: Array.from({ length: 120 }, (_, index) => ({ ...base.pendingImports[0], id: `i-${index}` })),
    };
    const expected = await digestWorkspaceContent(source);
    const rejectMap = { get(target: object, key: PropertyKey, receiver: unknown) {
      if (key === 'map') throw new Error('whole projection array');
      return Reflect.get(target, key, receiver);
    } };
    source.projects = new Proxy<typeof source.projects>(source.projects, rejectMap);
    source.pendingImports = new Proxy<typeof source.pendingImports>(source.pendingImports, rejectMap);
    const h = makeWorkHarness();
    expect(await digestWorkspaceContent(source, undefined, h.runtime)).toBe(expected);
    expect(h.runtime.snapshot().yields).toBeGreaterThan(0);
  });

  it.each([510, 511])('preserves pending payload canonical depth %s', async depth => {
    let data: unknown = null;
    for (let i = 0; i < depth; i++) data = { child: data };
    const source = { ...workspaceSnapshot(), pendingImports: [{ data }] } as unknown as ReturnType<typeof workspaceSnapshot>;
    const h = makeWorkHarness();
    if (depth === 510) expect(await digestWorkspaceContent(source, undefined, h.runtime)).toBe(await digestWorkspaceContent(source));
    else {
      await expect(digestWorkspaceContent(source)).rejects.toThrow(/nesting/i);
      await expect(digestWorkspaceContent(source, undefined, h.runtime)).rejects.toThrow(/nesting/i);
    }
  });

  it('preserves pending-import exclusions, symbols and sparse-list rejection', async () => {
    const source = workspaceSnapshot();
    const before = await digestWorkspaceContent(source);
    source.pendingImports[0].createdAt = 'changed';
    expect(await digestWorkspaceContent(source, undefined, makeWorkHarness().runtime)).toBe(before);
    const symbol = Symbol();
    Object.assign(source.pendingImports[0], { [symbol]: 1 });
    await expect(digestWorkspaceContent(source, undefined, makeWorkHarness().runtime)).rejects.toThrow(/symbol/i);
    const sparse = { ...workspaceSnapshot(), pendingImports: Array(2) };
    await expect(digestWorkspaceContent(sparse, undefined, makeWorkHarness().runtime)).rejects.toThrow();
  });

  it('cancels workspace hashing between bounded steps and releases scratch', async () => {
    const h = makeWorkHarness(); h.observe(() => h.cancel());
    await expect(digestWorkspaceContent(workspaceSnapshot(), undefined, h.runtime)).rejects.toMatchObject({ name: 'AbortError' });
    expect(h.runtime.snapshot().ownedBytes).toBe(0);
  });

  it('streams raw and legacy digests when given work without calling SubtleCrypto', async () => {
    const digest = vi.fn(() => { throw new Error('unexpected native whole-frame digest'); });
    const subtle = { digest } as unknown as SubtleCrypto;
    const h = makeWorkHarness();
    const raw = `${'x'.repeat(15)}😀\ud800`;
    expect(await sha256Hex(raw, subtle, h.runtime)).toBe(await sha256Hex(raw));
    const source = legacySnapshot({ [LEGACY_KEYS.projects]: raw, [LEGACY_KEYS.pendingImport]: '' });
    expect(await digestLegacySnapshot(source, subtle, h.runtime)).toBe(await digestLegacySnapshot(source));
    expect(digest).not.toHaveBeenCalled();
    expect(h.runtime.snapshot().legacyHashBytes).toBeGreaterThan(0);
    expect(h.runtime.snapshot().sourceHashBytes).toBe(new TextEncoder().encode(raw).length);
  });
  it('pins legacy document key order', () => {
    expect(LEGACY_DOCUMENT_KEYS).toEqual([
      LEGACY_KEYS.projects,
      LEGACY_KEYS.activeProject,
      LEGACY_KEYS.customPresets,
      LEGACY_KEYS.pendingImport,
    ]);
  });

  it('matches the SHA-256 golden vector', async () => {
    await expect(sha256Hex('abc')).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('distinguishes absent and present-empty legacy keys', async () => {
    const absent = legacySnapshot({});
    const empty = legacySnapshot({ [LEGACY_KEYS.projects]: '' });
    expect(await digestLegacySnapshot(absent)).not.toBe(await digestLegacySnapshot(empty));
  });

  it('includes exact raw Unicode text and fixed legacy-key order', async () => {
    const source = legacySnapshot({
      [LEGACY_KEYS.pendingImport]: '{"name":"😀"}',
      [LEGACY_KEYS.projects]: ' [{"name":"Café ☕"}]\r\n',
    });
    const reorderedObject = {
      [LEGACY_KEYS.pendingImport]: source[LEGACY_KEYS.pendingImport],
      [LEGACY_KEYS.customPresets]: source[LEGACY_KEYS.customPresets],
      [LEGACY_KEYS.activeProject]: source[LEGACY_KEYS.activeProject],
      [LEGACY_KEYS.projects]: source[LEGACY_KEYS.projects],
    };

    expect(await digestLegacySnapshot(source)).toBe(await digestLegacySnapshot(reorderedObject));
    expect(await digestLegacySnapshot(source)).not.toBe(await digestLegacySnapshot(
      legacySnapshot({
        [LEGACY_KEYS.pendingImport]: '{"name":"😀"}',
        [LEGACY_KEYS.projects]: ' [{"name":"Cafe ☕"}]\r\n',
      }),
    ));
  });

  it('includes order, cloud metadata, UI revisions, presets, and imports in target digest', async () => {
    const base = workspaceSnapshot();
    const baseDigest = await digestWorkspaceContent(base);
    const variants = [
      { ...base, projects: [...base.projects].reverse() },
      {
        ...base,
        projects: [{ ...base.projects[0], revision: 9 }, ...base.projects.slice(1)],
      },
      {
        ...base,
        projects: [{
          ...base.projects[0],
          cloud: { ...base.projects[0].cloud!, lastSyncedCommitId: 'different' },
        }, ...base.projects.slice(1)],
      },
      { ...base, activeProjectId: 'project-b' },
      { ...base, customPresets: [{ ...base.customPresets[0], title: 'Different' }] },
      { ...base, pendingImports: [{ ...base.pendingImports[0], name: 'Different' }] },
    ];

    for (const variant of variants) {
      expect(await digestWorkspaceContent(variant)).not.toBe(baseDigest);
    }
  });

  it('keeps nested document timestamps but excludes pending-import creation time', async () => {
    const base = workspaceSnapshot();
    const changedImportTime = {
      ...base,
      pendingImports: [{ ...base.pendingImports[0], createdAt: '2030-01-01T00:00:00.000Z' }],
    };
    const changedGeneratorTime = workspaceSnapshot();
    changedGeneratorTime.projects[0].initialState.generator!.generatedAt = '2030-01-01T00:00:00.000Z';

    await expect(digestWorkspaceContent(changedImportTime))
      .resolves.toBe(await digestWorkspaceContent(base));
    await expect(digestWorkspaceContent(changedGeneratorTime))
      .resolves.not.toBe(await digestWorkspaceContent(base));
  });
});

describe('cooperative canonical traversal', () => {
  function capture(value: unknown) {
    const chunks: string[] = [];
    function* emit(text: string): Work<void> {
      yield* effect(1, () => { chunks.push(text); });
    }
    return { chunks, program: canonicalWork(value, emit) };
  }

  async function collect(value: unknown) {
    const h = makeWorkHarness();
    const output = capture(value);
    await h.runtime.run(output.program);
    return { ...output, h, text: output.chunks.join('') };
  }

  it('pins exact canonical grammar in both drivers', async () => {
    const value = { z: -0, a: ['😀', '\ud800', '\u0000', '"\\'], n: null };
    const expected = '{"a":["😀","\\ud800","\\u0000","\\\"\\\\"],"n":null,"z":0}';
    const sync = capture(value);
    runSync(sync.program);
    expect(sync.chunks.join('')).toBe(expected);
    expect((await collect(value)).text).toBe(expected);
    expect(canonicalStringify(value)).toBe(expected);
  });

  it('matches native escaping for every UTF-16 code unit in bounded fixtures', () => {
    for (let start = 0; start < 65536; start += 256) {
      const text = Array.from({ length: 256 }, (_, offset) => String.fromCharCode(start + offset)).join('');
      const output = capture(text);
      runSync(output.program);
      expect(output.chunks.join('')).toBe(JSON.stringify(text));
      expect(canonicalStringify(text)).toBe(JSON.stringify(text));
      expect(output.chunks.every(chunk => chunk.length <= 64)).toBe(true);
    }
  });

  it('never separates a surrogate pair between output fragments', async () => {
    const value = `${'x'.repeat(15)}😀${'x'.repeat(14)}😀\ud800\udc00\ud800x\udc00\u2028\u2029`;
    const result = await collect(value);
    expect(result.text).toBe(JSON.stringify(value));
    const encoder = new TextEncoder();
    const encodedChunks = result.chunks.flatMap(chunk => [...encoder.encode(chunk)]);
    expect(encodedChunks).toEqual([...encoder.encode(result.text)]);
    expect(result.chunks.every(chunk => chunk.length <= 64)).toBe(true);
  });

  it('batches ordinary source text instead of allocating operations per character', () => {
    const value = 'x'.repeat(16384);
    const output = capture(value);
    let step = output.program.next();
    let operations = 0;
    while (step.done === false) {
      operations++;
      step = output.program.next(step.value.run());
    }
    expect(output.chunks.join('')).toBe(JSON.stringify(value));
    expect(operations).toBeLessThan(value.length / 2);
  });

  it('resumes comparisons inside long equal key prefixes', async () => {
    const prefix = 'k'.repeat(30000);
    const value = { [prefix + 'z']: 1, [prefix + 'a']: 2 };
    const { text, h } = await collect(value);
    expect(text).toBe(`{${JSON.stringify(prefix + 'a')}:2,${JSON.stringify(prefix + 'z')}:1}`);
    expect(h.runtime.snapshot().comparedCodeUnits).toBeGreaterThanOrEqual(prefix.length);
    expect(h.runtime.snapshot().yields).toBeGreaterThan(0);
  });

  it('sorts UTF-16 keys and preserves stable numeric ties without mutating input', () => {
    const keys = ['\ue000', '😀', '\ud800', '10', '2', 'a', ''];
    expect(runSync(stableSortWork(keys, compareStringsWork))).toEqual([...keys].sort());
    const rows = [{ id: 'a', order: 2 }, { id: 'b', order: 1 }, { id: 'c', order: 2 }];
    const compare = (a: typeof rows[number], b: typeof rows[number]) => effect(1, () => a.order - b.order);
    expect(runSync(stableSortWork(rows, compare)).map(row => row.id)).toEqual(['b', 'a', 'c']);
    expect(rows.map(row => row.id)).toEqual(['a', 'b', 'c']);
    expect(runSync(stableSortWork(rows, () => effect(1, () => NaN)))).toEqual(rows);
  });

  it.each(['long value', 'wide object', 'long key comparison'])('cancels during %s traversal', async kind => {
    const prefix = 'k'.repeat(100000);
    const value = kind === 'long value' ? '😀'.repeat(100000)
      : kind === 'wide object' ? Object.fromEntries(Array.from({ length: 3000 }, (_, i) => [`k${i}`, i]))
        : { [prefix + 'z']: 1, [prefix + 'a']: 2 };
    const h = makeWorkHarness();
    const output = capture(value);
    // Cancel at the first work boundary, independent of timer/message ordering.
    h.observe(h.cancel);
    await expect(h.runtime.run(output.program)).rejects.toMatchObject({ name: 'AbortError' });
    expect(h.runtime.snapshot().visits).toBeLessThanOrEqual(1024);
    expect(output.program.next().done).toBe(true);
    expect(() => JSON.parse(output.chunks.join(''))).toThrow();
  });

  it('yields real tasks while serializing a long value', async () => {
    const h = makeWorkHarness('prepare', true);
    const output = capture('x'.repeat(5000));
    let taskRan = false;
    setTimeout(() => { taskRan = true; }, 0);
    await h.runtime.run(output.program);
    expect(taskRan).toBe(true);
    expect(output.chunks.join('')).toBe(JSON.stringify('x'.repeat(5000)));
  });

  it.each([
    ['undefined', () => undefined], ['NaN', () => NaN], ['infinity', () => Infinity],
    ['bigint', () => 1n], ['function', () => () => {}], ['symbol', () => Symbol()],
    ['sparse array', () => Array(2)], ['extended array', () => Object.assign([1], { extra: 2 })],
    ['custom prototype', () => Object.create({ inherited: true })],
    ['null prototype', () => Object.create(null)],
    ['symbol key', () => ({ [Symbol()]: 1 })],
    ['hidden field', () => Object.defineProperty({}, 'hidden', { value: 1 })],
    ['cycle', () => { const value: unknown[] = []; value.push(value); return value; }],
  ] as const)('preserves rejection of %s in both drivers', async (_label, make) => {
    expect(() => canonicalStringify(make())).toThrow(/JSON-compatible/);
    expect(() => runSync(capture(make()).program)).toThrow(/JSON-compatible/);
    await expect(collect(make())).rejects.toThrow(/JSON-compatible/);
  });

  it('never invokes getters, including array accessors', async () => {
    let calls = 0;
    for (const value of [{}, []]) {
      Object.defineProperty(value, Array.isArray(value) ? '0' : 'secret', {
        enumerable: true, get() { calls++; return 1; },
      });
      expect(() => runSync(capture(value).program)).toThrow(/JSON-compatible/);
      await expect(collect(value)).rejects.toThrow(/JSON-compatible/);
    }
    expect(calls).toBe(0);
  });

  it('allows shared acyclic values and non-enumerable dense array elements', async () => {
    const shared = { z: 1 };
    expect((await collect([shared, shared])).text).toBe('[{"z":1},{"z":1}]');
    const array = Object.defineProperty([1], '0', { enumerable: false });
    expect((await collect(array)).text).toBe('[1]');
  });

  it('preserves container depth 512 and scalar-before-depth validation', async () => {
    const chain = (depth: number, leaf: unknown = {}) => {
      let value = leaf;
      for (let i = 0; i < depth; i++) value = { child: value };
      return value;
    };
    const legal = chain(512);
    expect(canonicalStringify(legal)).toBe(JSON.stringify(legal));
    expect((await collect(legal)).text).toBe(JSON.stringify(legal));
    await expect(collect(chain(513))).rejects.toThrow(/nesting/);
    expect(() => canonicalStringify(chain(513))).toThrow(/nesting/);
    const scalar = chain(513, 1);
    expect((await collect(scalar)).text).toBe(JSON.stringify(scalar));
  });
});
