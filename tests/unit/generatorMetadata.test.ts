import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  generatorProvenanceEqual,
  normalizeGeneratorProvenance,
  validateGeneratorProvenance,
  validateGeneratorProvenanceWork,
  normalizeGeneratorProvenanceWork,
} from '../../shared/generatorMetadata.js';
import { utf8LengthWork } from '../../shared/jsonWork.js';
import { makeWorkHarness } from '../helpers/normalizationWorkHarness';
import { loadProjectState, loadProjectStateWork } from '../../services/loadProjectState';

afterEach(() => vi.restoreAllMocks());

const source = {
  formatVersion: 1 as const,
  templateScript: 'const café = "☕";\nreturn {};',
  hierarchyScript: 'return { nodes: {}, rootId: "root" };\n',
  generatedAt: '2026-07-13T12:00:00.000Z',
};

describe('generator provenance metadata', () => {
  it.each([
    ['x'.repeat(512 * 1024), 'y'.repeat(512 * 1024), true],
    ['x'.repeat(512 * 1024 + 1), '', false],
    ['☕'.repeat(174_762) + 'ab', 'y'.repeat(512 * 1024), true],
    ['☕'.repeat(174_763), '', false],
  ])('cooperatively enforces script byte limits %#', async (templateScript, hierarchyScript, ok) => {
    const value = { ...source, templateScript, hierarchyScript };
    const expected = validateGeneratorProvenance(value, { strictUnknownFields: true });
    const h = makeWorkHarness();
    const result = await h.runtime.run(validateGeneratorProvenanceWork(value, { strictUnknownFields: true }));
    expect(result).toEqual(expected); expect(result.ok).toBe(ok);
    expect(h.runtime.snapshot().yields).toBeGreaterThan(0);
  });

  it.each([null, {}, { ...source, formatVersion: 2 }, { ...source, templateScript: 4 },
    { ...source, hierarchyScript: 4 }, { ...source, generatedAt: 'not a date' },
    { ...source, generatedAt: '2026-07-13T12:00:00Z' }, { ...source, extra: 1 }])('preserves first issue and normalization warning %#', async value => {
    const h = makeWorkHarness();
    expect(await h.runtime.run(validateGeneratorProvenanceWork(value, { strictUnknownFields: true })))
      .toEqual(validateGeneratorProvenance(value, { strictUnknownFields: true }));
    expect(await h.runtime.run(normalizeGeneratorProvenanceWork(value))).toEqual(normalizeGeneratorProvenance(value));
  });

  it('normalizes absent and lenient metadata without mutating source', async () => {
    const h = makeWorkHarness();
    expect(await h.runtime.run(normalizeGeneratorProvenanceWork(undefined))).toEqual({});
    const value = { ...source, extra: 'ignored' };
    expect(await h.runtime.run(normalizeGeneratorProvenanceWork(value))).toEqual({ generator: source });
    expect(value.extra).toBe('ignored');
  });

  it('checks unknown keys before script getters and respects pre-cancellation', async () => {
    const get = vi.fn(() => 'never');
    const value = Object.defineProperty({ extra: 1 }, 'templateScript', { get, enumerable: true });
    const h = makeWorkHarness();
    expect(await h.runtime.run(validateGeneratorProvenanceWork(value, { strictUnknownFields: true })))
      .toMatchObject({ issue: 'unknown_field' });
    expect(get).not.toHaveBeenCalled();
    const cancelled = makeWorkHarness(); cancelled.cancel();
    await expect(cancelled.runtime.run(validateGeneratorProvenanceWork(source))).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('counts raw UTF-8 exactly for every UTF-16 unit and fragment-edge surrogate pairs', async () => {
    const values = [Array.from({ length: 65536 }, (_, i) => String.fromCharCode(i)).join(''),
      `${'x'.repeat(15)}😀\ud800`, '', '\udc00\ud800'];
    for (const value of values) expect(await makeWorkHarness().runtime.run(utf8LengthWork(value)))
      .toBe(new TextEncoder().encode(value).length);
  });

  it('never passes a whole script to TextEncoder in cooperative validation', async () => {
    const encode = TextEncoder.prototype.encode;
    let widest = 0;
    vi.spyOn(TextEncoder.prototype, 'encode').mockImplementation(function (value: string) {
      widest = Math.max(widest, value.length);
      return encode.call(this, value);
    });
    const value = { ...source, templateScript: 'x'.repeat(64 * 1024) };
    expect((await makeWorkHarness().runtime.run(validateGeneratorProvenanceWork(value))).ok).toBe(true);
    expect(widest).toBeGreaterThan(0); expect(widest).toBeLessThanOrEqual(16);
  });

  it('keeps native byte counting on the synchronous loader instead of tiny-step dispatch', () => {
    const encode = TextEncoder.prototype.encode;
    let calls = 0;
    vi.spyOn(TextEncoder.prototype, 'encode').mockImplementation(function (value: string) {
      calls++;
      return encode.call(this, value);
    });
    const value = { schemaVersion: 12, generator: { ...source, templateScript: 'x'.repeat(64 * 1024) } };
    expect(loadProjectState(value).state.generator).toEqual(value.generator);
    expect(calls).toBeLessThanOrEqual(4);
  });

  it('yields real tasks and cancels inside generator-source validation through the loader', async () => {
    const value = { schemaVersion: 12, generator: { ...source, templateScript: 'x'.repeat(64 * 1024) } };
    const h = makeWorkHarness('prepare', true);
    let timerRan = false; setTimeout(() => { timerRan = true; }, 0);
    await h.runtime.run(loadProjectStateWork(value, 'plain'));
    expect(timerRan).toBe(true);
    expect(h.runtime.snapshot().yields).toBeGreaterThan(0);
    const stopped = makeWorkHarness(); stopped.observe(() => stopped.cancel());
    await expect(stopped.runtime.run(loadProjectStateWork(value, 'plain'))).rejects.toMatchObject({ name: 'AbortError' });
    expect(value.generator.templateScript.length).toBe(64 * 1024);
  });

  it('preserves valid source byte-exactly and compares every field', () => {
    expect(validateGeneratorProvenance(source, { strictUnknownFields: true })).toEqual({
      ok: true,
      value: source,
    });
    expect(generatorProvenanceEqual(source, structuredClone(source))).toBe(true);
    expect(generatorProvenanceEqual(source, { ...source, templateScript: `${source.templateScript} ` })).toBe(false);
    expect(generatorProvenanceEqual(undefined, undefined)).toBe(true);
  });

  it('rejects unknown fields in strict mode', () => {
    expect(validateGeneratorProvenance({ ...source, extra: true }, { strictUnknownFields: true }).ok).toBe(false);
  });

  it('enforces UTF-8 script byte limits', () => {
    expect(validateGeneratorProvenance({ ...source, templateScript: 'x'.repeat(512 * 1024 + 1) }).ok).toBe(false);
    expect(validateGeneratorProvenance({
      ...source,
      templateScript: 'x'.repeat(512 * 1024),
      hierarchyScript: 'y'.repeat(512 * 1024 + 1),
    }).ok).toBe(false);
    expect(validateGeneratorProvenance({ ...source, templateScript: '☕'.repeat(174_763) }).ok).toBe(false);
    expect(validateGeneratorProvenance({
      ...source,
      templateScript: `${'☕'.repeat(174_762)}ab`,
      hierarchyScript: 'y'.repeat(512 * 1024),
    }).ok).toBe(true);
  });

  it.each([
    '2026-07-13T12:00:00Z',
    '2026-07-13T13:00:00.000+01:00',
    'Mon, 13 Jul 2026 12:00:00 GMT',
    '2026-07-13T12:00:00.0000Z',
  ])('rejects non-canonical generator timestamp %s', generatedAt => {
    expect(validateGeneratorProvenance({ ...source, generatedAt })).toMatchObject({
      ok: false,
      issue: 'generated_at',
    });
  });

  it('strips unknown fields in lenient normalization', () => {
    expect(normalizeGeneratorProvenance({ ...source, unknown: 'remove me' })).toEqual({ generator: source });
  });

  it('normalizes absent metadata and detaches invalid metadata with a warning', () => {
    expect(normalizeGeneratorProvenance(undefined)).toEqual({});
    expect(normalizeGeneratorProvenance({ ...source, formatVersion: 2 })).toEqual({
      warning: 'Saved generator was detached: Unsupported generator format version.',
    });
  });
});
