// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSync, type Operation, type Work } from '../../shared/cooperativeWork.js';
import { makeWorkHarness } from '../helpers/normalizationWorkHarness';
import { normalizeTextOverflow, normalizeTextOverflowWork, normalizeOwnedTextOverflowWork,
  normalizeTextOverflowElementWork, normalizeTextOverflowTemplateWork, normalizeTextOverflowTemplatesWork } from '../../services/textOverflow';
import { normalizeProjectTextPadding, normalizeProjectTextPaddingWork, normalizeOwnedProjectTextPaddingWork,
  normalizeTextPaddingElementWork, normalizeTextPaddingTemplateWork, normalizeTextPaddingTemplatesWork } from '../../services/textPadding';
import { DEFAULT_LAYER_ID, ensureTemplateLayers, ensureTemplateLayersWork } from '../../services/layers';
import { loadProjectState, loadProjectStateWork, loadOwnedProjectStateWork } from '../../services/loadProjectState';
import { migrateState, migrateStateWork, migrateOwnedStateWork } from '../../services/migration';
import { historicalState } from '../helpers/localWorkspaceFixtures';

afterEach(() => vi.restoreAllMocks());

describe('cooperative versioned loader', () => {
  it.each(Array.from({ length: 13 }, (_, i) => i))('preserves schema %i output, source and ID order', async version => {
    const raw = historicalState(version), before = structuredClone(raw);
    let calls = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => (++calls) / 100);
    const expected = loadProjectState(raw), expectedCalls = calls;
    calls = 0;
    const result = await makeWorkHarness().runtime.run(loadProjectStateWork(raw, 'plain'));
    expect(result).toEqual(expected); expect(calls).toBe(expectedCalls);
    expect(raw).toEqual(before); expect(result.state).not.toBe(raw);
    expect(result.state.schemaVersion).toBe(12);
  });

  it.each(Array.from({ length: 13 }, (_, i) => i))('owned schema %i omits whole-state clones and retains unaffected nodes', async version => {
    const raw = historicalState(version);
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    const expected = loadProjectState(raw), working = structuredClone(raw), nodes = working.nodes;
    const clone = vi.spyOn(globalThis, 'structuredClone').mockImplementation(() => { throw new Error('extra working clone'); });
    const parse = vi.spyOn(JSON, 'parse').mockImplementation(() => { throw new Error('JSON roundtrip'); });
    const result = await makeWorkHarness().runtime.run(loadOwnedProjectStateWork(working as any));
    expect(result).toEqual(expected); expect(result.state.nodes).toBe(nodes);
    expect(clone).not.toHaveBeenCalled(); expect(parse).not.toHaveBeenCalled();
  });

  it('keeps schema-11 hydration and exact generator-detachment warning', async () => {
    const raw: any = historicalState(11);
    const element = raw.variants.default.templates.page.elements[0];
    delete element.textPadding; delete element.textOverflow;
    raw.generator.hierarchyScript = 42;
    const result = await makeWorkHarness().runtime.run(loadProjectStateWork(raw, 'plain'));
    expect(result.warnings).toEqual(['Saved generator was detached: Hierarchy script must be text.']);
    expect(result.state.generator).toBeUndefined();
    expect(result.state.variants.default.templates.page.elements[0]).toMatchObject({ textOverflow: 'clip',
      textPadding: { top: 0, right: 0, bottom: 0, left: 0 } });
  });

  it('distinguishes direct future-version identity from loader clone independence', () => {
    const raw: any = { schemaVersion: 13, extension: { x: 1 } };
    expect(runSync(migrateStateWork(raw, 'plain'))).toBe(raw);
    expect(runSync(migrateOwnedStateWork(raw))).toBe(raw);
    const loaded = runSync(loadProjectStateWork(raw, 'plain'));
    expect(loaded.state).toEqual(raw); expect(loaded.state).not.toBe(raw);
    expect((loaded.state as any).extension).not.toBe(raw.extension);
  });

  it('retains standalone toJSON compatibility and plain-mode JSON conversions', () => {
    const raw: any = historicalState(10);
    raw.extension = { omitted: undefined, n: NaN, zero: -0 };
    let calls = 0;
    const custom = { schemaVersion: 10, toJSON() { calls++; return raw; } };
    const expected = migrateState(custom);
    calls = 0;
    expect(runSync(migrateStateWork(custom))).toEqual(expected); expect(calls).toBe(1);
    const result = runSync(migrateStateWork(raw, 'plain')) as any;
    expect(result.extension).toEqual({ n: null, zero: 0 });
    expect(Object.is(result.extension.zero, -0)).toBe(false);
  });

  it('gives variant and flat templates the fixed default layer without randomness, and independent border sides', () => {
    // Migration must be deterministic: a staged import is prepared twice and compared.
    const random = vi.spyOn(Math, 'random');
    const template = () => ({ elements: [{ type: 'rect', stroke: '#abc', strokeWidth: 2 }] });
    const raw: any = { schemaVersion: 6, variants: { z: { templates: { b: template(), a: template() } } }, templates: { p: template() } };
    const result = runSync(migrateStateWork(raw, 'plain')) as any;
    const templates = [result.variants.z.templates.b, result.variants.z.templates.a, result.templates.p];
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
    expect(templates.map(t => t.layers[0].id)).toEqual([DEFAULT_LAYER_ID, DEFAULT_LAYER_ID, DEFAULT_LAYER_ID]);
    expect(templates.map(t => t.elements[0].layerId)).toEqual([DEFAULT_LAYER_ID, DEFAULT_LAYER_ID, DEFAULT_LAYER_ID]);
    expect(templates[0].layers).not.toBe(templates[1].layers);
    const sides = templates[0].elements[0].borderSides;
    expect(sides.top).toEqual({ width: 2, color: '#abc', style: 'solid' });
    expect(sides.top).not.toBe(sides.bottom);
  });

  it.each([0, 6, 7, 9, 10, 11])('cancels within schema %i traversal without changing borrowed input', async version => {
    const raw: any = historicalState(version);
    const template = version < 4 ? raw.templates.page : raw.variants.default.templates.page;
    template.elements = Array.from({ length: 4000 }, (_, i) => ({ ...template.elements[0], id: String(i) }));
    const before = structuredClone(raw), h = makeWorkHarness();
    h.observe(() => h.cancel());
    await expect(h.runtime.run(loadProjectStateWork(raw, 'plain'))).rejects.toMatchObject({ name: 'AbortError' });
    expect(raw).toEqual(before);
  });

  it('keeps invalid entry and malformed null-element failures', () => {
    expect(typeof migrateStateWork).toBe('function');
    expect(() => runSync(migrateStateWork(null))).toThrow('Invalid state: expected an object');
    const raw: any = historicalState(9); raw.variants.default.templates.page.elements = [null];
    expect(() => runSync(migrateStateWork(raw, 'plain'))).toThrow(TypeError);
  });

  it.each(['old', 1, true])('retains v7 Object.values boxing for malformed variants %s', variants => {
    // Historical migration leaves these values for the later validator to reject.
    const source = { schemaVersion: 7, variants };
    expect(runSync(migrateStateWork(source, 'plain'))).toEqual({ schemaVersion: 12, variants });
  });
});

describe('cooperative normalization helpers', () => {
  it('preserves element and repaired-template identities', async () => {
    const h = makeWorkHarness();
    const rect = { type: 'rect', extension: { keep: true } };
    expect(await h.runtime.run(normalizeTextOverflowElementWork(rect))).toBe(rect);
    expect(await h.runtime.run(normalizeTextPaddingElementWork(rect))).toBe(rect);
    const template: any = { layers: [{ id: 'l', order: 0 }], elements: [{ type: 'rect', layerId: 'l' }] };
    expect(await h.runtime.run(ensureTemplateLayersWork(template))).toBe(template);
  });

  it('clones borrowed projects and applies separate overflow/padding rules', async () => {
    const raw = { variants: { v: { templates: { p: { elements: [{ type: 'text' }, { type: 'grid' }] } } } } };
    const before = structuredClone(raw), h = makeWorkHarness();
    const out = await h.runtime.run(normalizeProjectTextPaddingWork(await h.runtime.run(normalizeTextOverflowWork(raw))));
    expect(out).not.toBe(raw); expect(raw).toEqual(before);
    expect(out).toEqual(normalizeProjectTextPadding(normalizeTextOverflow(raw)));
    expect(out.variants.v.templates.p.elements[0]).toMatchObject({ textOverflow: 'clip', textWrap: true,
      textPadding: { top: 0, right: 0, bottom: 0, left: 0 } });
    expect(out.variants.v.templates.p.elements[1]).toMatchObject({ textOverflow: 'clip', textWrap: false });
  });

  it('owned variants retain the root and never call structuredClone', () => {
    const root: any = { templates: { p: { elements: [{ type: 'text' }] } } };
    const clone = vi.spyOn(globalThis, 'structuredClone').mockImplementation(() => { throw new Error('extra clone'); });
    expect(runSync(normalizeOwnedTextOverflowWork(root))).toBe(root);
    expect(runSync(normalizeOwnedProjectTextPaddingWork(root))).toBe(root);
    expect(root.templates.p.elements[0]).toMatchObject({ textOverflow: 'clip', textPadding: { top: 0 } });
    expect(clone).not.toHaveBeenCalled();
  });

  it.each([normalizeTextOverflowTemplateWork, normalizeTextPaddingTemplateWork])('retains sparse slots and non-text references %#', transform => {
    expect(typeof transform).toBe('function');
    const rect: any = { type: 'rect' };
    const template: any = { elements: [rect, , { type: 'text' }] };
    const result = runSync(transform(template));
    expect(result).not.toBe(template); expect(result.elements).toHaveLength(3);
    expect(1 in result.elements).toBe(false); expect(result.elements[0]).toBe(rect);
  });

  it.each([
    [[2, undefined, 1], 'a'], [[2, 2, 1], 'c'], [['2', '1', '3'], 'b'], [[2, 2, 2], 'a'],
  ])('pins native fallback for orders %j', (orders, expected) => {
    const template: any = { layers: orders.map((order, i) => ({ id: String.fromCharCode(97 + i), order })), elements: [{ type: 'rect' }] };
    expect(ensureTemplateLayers(template).elements[0].layerId).toBe(expected);
    expect(runSync(ensureTemplateLayersWork(template))).toEqual(ensureTemplateLayers(template));
  });

  it('keeps duplicate IDs and valid element references, replacing only dangling edges', () => {
    const valid: any = { layerId: 'same' };
    const template: any = { layers: [{ id: 'same', order: 2 }, { id: 'same', order: 1 }], elements: [valid, , { layerId: 'bad' }] };
    const result = runSync(ensureTemplateLayersWork(template));
    expect(result.layers).toBe(template.layers); expect(result.elements[0]).toBe(valid);
    expect(1 in result.elements).toBe(false); expect(result.elements[2].layerId).toBe('same');
  });

  it('retains native sort getter/coercion call order without extra reads', () => {
    const log: string[] = [];
    const make = () => ({ layers: [2, 1, 3].map((value, index) => ({ id: String(index), get order() { log.push(String(index)); return value; } })), elements: [{}] }) as any;
    const expectedId = [...make().layers].sort((a, b) => a.order - b.order)[0].id;
    const expectedLog = [...log]; log.length = 0;
    const result = runSync(ensureTemplateLayersWork(make()));
    expect(log).toEqual(expectedLog);
    expect(result.elements[0].layerId).toBe(expectedId);
  });

  it('reads a present element slot once during the short-circuit repair scan', () => {
    const get = vi.fn(() => ({ layerId: 'l' }));
    const elements = Object.defineProperty([], '0', { get, enumerable: true });
    const source: any = { layers: [{ id: 'l', order: 0 }], elements };
    expect(runSync(ensureTemplateLayersWork(source))).toBe(source);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it.each(['overflow', 'padding', 'layers'])('retains malformed element-container rejection in %s', kind => {
    const source: any = { layers: [{ id: 'l', order: 0 }], elements: {} };
    const program = kind === 'overflow' ? normalizeTextOverflowTemplateWork(source)
      : kind === 'padding' ? normalizeTextPaddingTemplateWork(source) : ensureTemplateLayersWork(source);
    expect(() => runSync(program)).toThrow(TypeError);
  });

  it.each([normalizeTextOverflowTemplatesWork, normalizeTextPaddingTemplatesWork])('captures dictionary Gets before any element transform %#', transform => {
    const events: string[] = [];
    const template: any = { elements: [{ get type() { events.push('element'); return 'rect'; } }] };
    const source: any = {};
    for (const key of ['z', '__proto__']) Object.defineProperty(source, key, {
      enumerable: true, get() { events.push(key); return template; },
    });
    const result = runSync(transform(source));
    expect(events.slice(0, 2)).toEqual(['z', '__proto__']);
    expect(Object.keys(result)).toEqual(['z', '__proto__']);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });

  it('yields in a wide template and adds the fixed default layer without randomness', async () => {
    const random = vi.spyOn(Math, 'random');
    const template: any = { elements: Array.from({ length: 4000 }, (_, i) => ({ id: String(i), type: 'rect' })) };
    const h = makeWorkHarness('prepare', true);
    let task = false; setTimeout(() => { task = true; }, 0);
    const out = await h.runtime.run(ensureTemplateLayersWork(template));
    expect(task).toBe(true); expect(random).not.toHaveBeenCalled(); random.mockRestore();
    expect(out.layers.map((layer: any) => layer.id)).toEqual([DEFAULT_LAYER_ID]);
    expect(h.runtime.snapshot().yields).toBeGreaterThan(0);
    expect(out.elements.every((e: any) => e.layerId === out.layers[0].id)).toBe(true);
    expect(ensureTemplateLayers(out)).toBe(out);
  });

  it('uses resumable sorting for wide finite layer orders', async () => {
    const source: any = { layers: Array.from({ length: 2000 }, (_, i) => ({ id: String(i), order: 2000 - i })), elements: [{}] };
    const h = makeWorkHarness();
    const result = await h.runtime.run(ensureTemplateLayersWork(source));
    expect(result.elements[0].layerId).toBe('1999');
    expect(result.layers).toBe(source.layers);
    expect(h.runtime.snapshot().sortComparisons).toBeGreaterThan(1000);
    expect(h.runtime.snapshot().yields).toBeGreaterThan(0);
  });

  it.each([[2, 1, 3], [2, undefined, 1], ['2', '1', '3']])('tags only compatibility sorting for orders %j', (...orders) => {
    const source: any = { layers: orders.map((order, i) => ({ id: String(i), order })), elements: [{}] };
    const kinds: string[] = [];
    function* inspect(program: Work<any>): Work<any> {
      let result = program.next();
      while (!result.done) {
        const operation = result.value as Operation;
        if (operation.nativeKind) kinds.push(operation.nativeKind);
        result = program.next(yield operation);
      }
      return result.value;
    }
    runSync(inspect(ensureTemplateLayersWork(source)));
    expect(kinds.filter(kind => kind === 'sort')).toHaveLength(orders.every(order => typeof order === 'number') ? 0 : 1);
  });

  it.each(['overflow', 'padding', 'layers'])('cancels %s traversal before completing a wide template', async kind => {
    const root: any = { elements: Array.from({ length: 4000 }, () => ({ type: 'text' })) };
    const h = makeWorkHarness(); h.observe(() => h.cancel());
    const program = kind === 'overflow' ? normalizeTextOverflowTemplateWork(root)
      : kind === 'padding' ? normalizeTextPaddingTemplateWork(root) : ensureTemplateLayersWork(root);
    await expect(h.runtime.run(program)).rejects.toMatchObject({ name: 'AbortError' });
    expect(root.elements[0]).toEqual({ type: 'text' });
  });
});
