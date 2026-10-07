// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { makeIncrementalProject, loadStickerPressProject } from '../../helpers/incrementalFixtures';
import { historicalState } from '../../helpers/localWorkspaceFixtures';
import { validateAppState } from '../../../shared/validateAppState.js';
import type { Layer } from '../../../types';
import { makeWorkHarness } from '../../helpers/normalizationWorkHarness';
import { createWorkRuntime, effect } from '../../../shared/cooperativeWork.js';
import type { PartitionProjectionEvent } from '../../../services/document/partition';

// A missing implementation is an assertion failure, not a module-loader error.
const modules = import.meta.glob('../../../services/document/partition.ts', { eager: true });
function api(): typeof import('../../../services/document/partition') {
  const implementation = modules['../../../services/document/partition.ts'];
  expect(implementation, 'Task 2 partition implementation exists').toBeDefined();
  return implementation as typeof import('../../../services/document/partition');
}

const key = (variant: string, template: string, layer: string) => JSON.stringify([variant, template, layer]);
const serialize = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const historicalCollapsedValues = [undefined, 'legacy', null, 0, { legacy: true }, ['legacy']];

describe('partition projection recording', () => {
  it('records chosen fold owners and sparse projection without retaining payload values', async () => {
    const state = makeIncrementalProject(1).initialState;
    const template = state.variants.default.templates['page-0'];
    template.layers = [{ collapsed: true, id: 'dup', name: 'A' },
      { id: 'dup', collapsed: { raw: 'opaque-fold-sentinel' } },
      { id: 'unique', collapsed: false }, , null] as unknown as Layer[];
    const original = structuredClone(state); const events: PartitionProjectionEvent[] = []; const w = makeWorkHarness();
    const traced = await w.runtime.run(api().partitionStateWork(state, function* (event) { events.push(structuredClone(event)); }));
    expect(traced).toStrictEqual(api().partitionState(state));
    expect(events.find(event => event.kind === 'template')).toEqual({ kind: 'template', variantId: 'default', templateId: 'page-0',
      projection: { kind: 'layers', fieldOrder: Object.keys(template), length: 5,
        present: [{ index: 0, fieldOrder: ['id', 'name'] }, { index: 1, fieldOrder: ['id'] },
          { index: 2, fieldOrder: ['id'] }, { index: 4, fieldOrder: null }],
        folds: [{ index: 0, key: '["default","page-0",0]', owner: 'exception' },
          { index: 1, key: '["default","page-0",1]', owner: 'exception' },
          { index: 2, key: '["default","page-0","unique"]', owner: 'boolean' }] } });
    expect(JSON.stringify(events)).not.toContain('opaque-fold-sentinel');
    expect(state).toStrictEqual(original); expect(w.runtime.snapshot().ownedBytes).toBe(0);
  });

  it.each(['absent', 'undefined', 'null', 'object', 'empty'] as const)('preserves %s layers while recording only structural choices', async kind => {
    const state = makeIncrementalProject(1).initialState; const template = state.variants.default.templates['page-0'];
    if (kind === 'absent') delete template.layers;
    else Reflect.set(template, 'layers', kind === 'empty' ? [] : kind === 'null' ? null : kind === 'object' ? { raw: true } : undefined);
    const events: PartitionProjectionEvent[] = []; const w = makeWorkHarness();
    const actual = await w.runtime.run(api().partitionStateWork(state, function* (event) { events.push(event); }));
    expect(actual).toStrictEqual(api().partitionState(state));
    expect(events.find(event => event.kind === 'template')).toMatchObject({ projection: kind === 'empty'
      ? { kind: 'layers', length: 0, present: [], folds: [], fieldOrder: Object.keys(template) } : { kind: 'borrow' } });
    if (kind !== 'empty') expect(actual.document.variants.default.templates['page-0']).toBe(template);
    expect(w.runtime.snapshot().ownedBytes).toBe(0);
  });

  it('records actual state ownership, raw fold positions and field order without inspecting opaque bodies', async () => {
    const state = makeIncrementalProject(1).initialState; const template = state.variants.default.templates['page-0'];
    let reads = 0; const opaque = { get body() { reads++; throw new Error('opaque traversal'); } };
    Object.assign(state, { unknown: opaque });
    template.layers = [{ collapsed: undefined, id: 9 }, { id: '__proto__', collapsed: null }, { id: 'unchanged', opaque }, 4] as unknown as Layer[];
    const events: PartitionProjectionEvent[] = []; const w = makeWorkHarness();
    const actual = await w.runtime.run(api().partitionStateWork(state, function* (event) { events.push(event); }));
    const fields = events.filter(event => event.kind === 'state-field');
    expect(fields.map(event => event.field)).toEqual(Object.keys(state));
    expect(fields).toEqual(expect.arrayContaining([{ kind: 'state-field', field: 'nodes', owner: 'document' },
      { kind: 'state-field', field: 'scale', owner: 'preference' }, { kind: 'state-field', field: 'tool', owner: 'compatibility' },
      { kind: 'state-field', field: 'unknown', owner: 'compatibility' }]));
    expect(events.find(event => event.kind === 'template')).toMatchObject({ projection: {
      present: [{ index: 0, fieldOrder: ['id'] }, { index: 1, fieldOrder: ['id'] }, { index: 2, fieldOrder: null }, { index: 3, fieldOrder: null }],
      folds: [{ index: 0, key: '["default","page-0",0]', owner: 'exception' }, { index: 1, key: '["default","page-0",1]', owner: 'exception' }] } });
    expect(actual.document.nodes).toBe(state.nodes); expect(actual.document.generator).toBe(state.generator);
    expect(actual.document.variants.default.templates['page-0'].elements).toBe(template.elements);
    expect(actual.document.variants.default.templates['page-0'].layers![2]).toBe(template.layers![2]);
    expect(reads).toBe(0); expect(w.runtime.snapshot().ownedBytes).toBe(0);
  });

  it.each(['state-field', 'template'] as const)('releases metadata after a throwing %s sink', async at => {
    const state = makeIncrementalProject(1).initialState; const before = structuredClone(state); const w = makeWorkHarness();
    await expect(w.runtime.run(api().partitionStateWork(state, function* (event) {
      if (event.kind === at) throw new Error('sink failed');
    }))).rejects.toThrow('sink failed');
    expect(state).toStrictEqual(before); expect(w.runtime.snapshot().ownedBytes).toBe(0);
  });

  it('charges long projection keys and releases temporary metadata on cancellation inside the sink', async () => {
    const state = makeIncrementalProject(1).initialState; const template = state.variants.default.templates['page-0'];
    template.layers = [{ id: '根'.repeat(3000), collapsed: false, ['field😀'.repeat(2000)]: {} }] as unknown as Layer[];
    const w = makeWorkHarness(); let observed = false;
    await expect(w.runtime.run(api().partitionStateWork(state, function* (event) {
      if (event.kind !== 'template') return;
      observed = true; expect(w.runtime.snapshot().ownedBytes).toBeGreaterThan(20000);
      w.observe(() => w.cancel()); yield* effect(1024, () => {}); yield* effect(1, () => {});
    }))).rejects.toMatchObject({ name: 'AbortError' });
    expect(observed).toBe(true); expect(w.runtime.snapshot().yields).toBeGreaterThan(0);
    expect(w.runtime.snapshot().ownedBytes).toBe(0);
  });

  it('releases the first projection lease when a guard fails immediately after growth', async () => {
    let runtime: ReturnType<typeof createWorkRuntime> | undefined; let calls = 0;
    runtime = createWorkRuntime({ assertCurrent() {
      if ((runtime?.snapshot().ownedBytes ?? 0) > 0) throw new DOMException('stopped after growth', 'AbortError');
    } });
    try {
      await expect(runtime.run(api().partitionStateWork(makeIncrementalProject(1).initialState, function* () { calls++; })))
        .rejects.toMatchObject({ name: 'AbortError' });
      expect(calls).toBe(0); expect(runtime.snapshot().ownedBytes).toBe(0);
    } finally { runtime.dispose(); }
  });

  it('projection ownership depends on structural keys rather than opaque body length', async () => {
    const peaks: number[] = [];
    for (const length of [1, 100000]) {
      const state = makeIncrementalProject(1).initialState; const template = state.variants.default.templates['page-0'];
      Object.assign(template, { opaque: { body: 'x'.repeat(length) } });
      const w = makeWorkHarness(); let templates = 0;
      const parts = await w.runtime.run(api().partitionStateWork(state, function* (event) { if (event.kind === 'template') templates++; }));
      expect(templates).toBe(1); expect(Reflect.get(parts.document.variants.default.templates['page-0'], 'opaque')).toBe(Reflect.get(template, 'opaque'));
      peaks.push(w.runtime.snapshot().ownedHighWater); expect(w.runtime.snapshot().ownedBytes).toBe(0);
    }
    expect(peaks[0]).toBeGreaterThan(0); expect(peaks[1]).toBe(peaks[0]);
  });
});

describe('lossless state partition', () => {
  it('skips nonexistent fold addresses but retains assembly copy semantics for empty overlays', async () => {
    const { partitionState, assembleStateWork } = api();
    const state = makeIncrementalProject(10).initialState;
    const parts = partitionState(state);
    const h = makeWorkHarness();
    const assembled = await h.runtime.run(assembleStateWork(parts));
    const before = parts.document.variants.default.templates['page-0'];
    const after = assembled.variants.default.templates['page-0'];
    expect(assembled).toStrictEqual(state);
    expect(after).not.toBe(before);
    expect(after.layers).not.toBe(before.layers);
    expect(after.layers![0]).toBe(before.layers![0]);
    expect(h.runtime.snapshot().emittedBytes).toBe(0);
  });

  it('cooperatively preserves positional folds, sparse presence, references and field order', async () => {
    const { partitionStateWork, assembleStateWork } = api();
    expect(partitionStateWork).toBeTypeOf('function');
    expect(assembleStateWork).toBeTypeOf('function');
    const state = makeIncrementalProject(1).initialState;
    const template = state.variants.default.templates['page-0'];
    template.layers = [
      { collapsed: true, id: 'same', name: 'A' }, { id: 'same', collapsed: 'raw' },
      { id: 'unique', collapsed: false }, { id: 'absent' }, { id: 3, collapsed: undefined },
      , null,
    ] as any;
    const original = structuredClone(state);
    const h = makeWorkHarness();
    const parts = await h.runtime.run(partitionStateWork(state));
    expect(parts.preferences.layerCollapsed).toEqual({ '["default","page-0","unique"]': false });
    expect(parts.compatibility.layerCollapsedExceptions).toEqual({
      '["default","page-0",0]': { value: true }, '["default","page-0",1]': { value: 'raw' },
      '["default","page-0",4]': { value: undefined },
    });
    const assembled = await h.runtime.run(assembleStateWork(parts));
    expect(assembled).toStrictEqual(original);
    expect(parts.document.nodes).toBe(state.nodes);
    expect(parts.document.variants.default.templates['page-0'].layers![3]).toBe(template.layers![3]);
    expect(Object.hasOwn(assembled.variants.default.templates['page-0'].layers![3], 'collapsed')).toBe(false);
    expect(5 in assembled.variants.default.templates['page-0'].layers!).toBe(false);
    expect(JSON.stringify(assembled.variants.default.templates['page-0'].layers![0])).toBe('{"id":"same","name":"A","collapsed":true}');
    expect(state).toStrictEqual(original);
  });

  it('yields through long tuple keys and wide layer sets, and cancels without mutating ingress', async () => {
    const { partitionStateWork, assembleStateWork } = api();
    expect(partitionStateWork).toBeTypeOf('function');
    const state = makeIncrementalProject(1).initialState;
    const template = state.variants.default.templates['page-0'];
    template.layers = Array.from({ length: 2200 }, (_, i) => ({ id: `${i}😀`.repeat(i === 0 ? 20000 : 1), collapsed: false })) as any;
    const h = makeWorkHarness();
    const parts = await h.runtime.run(partitionStateWork(state));
    expect(await h.runtime.run(assembleStateWork(parts))).toStrictEqual(state);
    expect(h.runtime.snapshot().yields).toBeGreaterThan(2);
    const assembling = makeWorkHarness(); assembling.observe(() => assembling.cancel());
    await expect(assembling.runtime.run(assembleStateWork(parts))).rejects.toMatchObject({ name: 'AbortError' });
    expect(parts.document.variants.default.templates['page-0'].layers![0]).not.toHaveProperty('collapsed');
    const cancelled = makeWorkHarness();
    cancelled.observe(() => cancelled.cancel());
    await expect(cancelled.runtime.run(partitionStateWork(state))).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelled.runtime.snapshot().visits).toBeLessThanOrEqual(1024);
    expect(template.layers![0].collapsed).toBe(false);
  });

  it('round-trips the serialized state without making navigation content', () => {
    const { partitionState, assembleState } = api();
    const state = makeIncrementalProject().initialState;
    const parts = partitionState(state);
    expect(assembleState(parts)).toStrictEqual(state);
    expect(parts.document).not.toHaveProperty('selectedNodeId');
    expect(parts.document).not.toHaveProperty('scale');
    expect(parts.preferences.activeVariantId).toBe(state.activeVariantId);
  });

  it('explicitly classifies every AppState field', () => {
    const { APP_STATE_FIELD_CLASSIFICATION, partitionState } = api();
    const state = makeIncrementalProject().initialState;
    Object.assign(state, { showLayersPanel: false, templatePreviewNodeId: 'root' });
    const documentFields = ['nodes', 'rootId', 'variants', 'schemaVersion', 'generator'];
    const preferenceFields = ['activeVariantId', 'selectedNodeId', 'selectedTemplateId', 'scale', 'viewMode',
      'sidebarWidth', 'propertiesPanelWidth', 'snapToGrid', 'showGrid'];
    const transientFields = ['selectedNodeIds', 'selectedTemplateIds', 'selectedElementIds', 'tool', 'showJsonModal',
      'activeLayerId', 'showLayersPanel', 'showNodeSelector', 'nodeSelectorMode', 'editingElementId', 'clipboard', 'templatePreviewNodeId'];
    expect(Object.keys(APP_STATE_FIELD_CLASSIFICATION).sort()).toEqual([
      ...documentFields, ...preferenceFields, ...transientFields,
    ].sort());
    expect(Object.keys(state).sort()).toEqual(Object.keys(APP_STATE_FIELD_CLASSIFICATION).sort());
    const parts = partitionState(state);
    for (const field of documentFields) {
      expect(APP_STATE_FIELD_CLASSIFICATION[field]).toBe('document');
      expect(parts.document[field]).toEqual(state[field]);
    }
    for (const field of preferenceFields) {
      expect(APP_STATE_FIELD_CLASSIFICATION[field]).toBe('preference');
      expect(parts.preferences[field]).toEqual(state[field]);
      expect(parts.document).not.toHaveProperty(field);
    }
    for (const field of transientFields) {
      expect(APP_STATE_FIELD_CLASSIFICATION[field]).toBe('transient');
      expect(parts.compatibility.state[field]).toEqual(state[field]);
      expect(parts.document).not.toHaveProperty(field);
      expect(parts.preferences).not.toHaveProperty(field);
    }
  });

  it('extracts only collapsed, preserves absence and false through serialized parts', () => {
    const { partitionState, assembleState } = api();
    const state = makeIncrementalProject().initialState;
    const template = state.variants.default.templates['page-0'];
    const layer = template.layers![0];
    template.layers = [layer, { ...layer, id: 'closed', collapsed: true }, { ...layer, id: 'open', collapsed: false }];
    const before = structuredClone(state);
    const parts = partitionState(state);
    expect(parts.preferences.layerCollapsed).toEqual({
      [key('default', 'page-0', 'closed')]: true,
      [key('default', 'page-0', 'open')]: false,
    });
    for (const result of parts.document.variants.default.templates['page-0'].layers!) {
      expect(result).not.toHaveProperty('collapsed');
      expect(result.visible).toBe(true);
      expect(result.locked).toBe(false);
      expect(result.order).toBe(0);
    }
    expect(assembleState(serialize(parts))).toStrictEqual(state);
    expect(state).toStrictEqual(before);
    expect(parts.document.nodes).toBe(state.nodes);
    expect(parts.document.variants.default.templates['page-0'].elements).toBe(template.elements);
  });

  it('uses collision-free tuple addresses including punctuation and prototype-like IDs', () => {
    const { partitionState, assembleState } = api();
    const state = makeIncrementalProject().initialState;
    const template = state.variants.default.templates['page-0'];
    state.variants = Object.fromEntries([
      ['a:b', { id: 'a:b', name: 'One', templates: { c: { ...template, id: 'c', layers: [{ ...template.layers![0], id: '__proto__', collapsed: true }] } } }],
      ['a', { id: 'a', name: 'Two', templates: { 'b:c': { ...template, id: 'b:c', layers: [{ ...template.layers![0], id: '__proto__', collapsed: false }] } } }],
      ['__proto__', { id: '__proto__', name: 'Three', templates: { '[",]': { ...template, id: '[",]', layers: [{ ...template.layers![0], id: 'x:y', collapsed: true }] } } }],
    ]);
    const parts = partitionState(state);
    expect(Object.keys(parts.preferences.layerCollapsed)).toHaveLength(3);
    expect(parts.preferences.layerCollapsed[key('a:b', 'c', '__proto__')]).toBe(true);
    expect(parts.preferences.layerCollapsed[key('a', 'b:c', '__proto__')]).toBe(false);
    expect(assembleState(serialize(parts))).toStrictEqual(state);
  });

  it('retains extensions in their owning record and leaves wrapper metadata outside document content', () => {
    const { partitionState, assembleState } = api();
    const project = makeIncrementalProject();
    Object.assign(project, { cloud: { projectId: 'remote', lastSyncedCommitId: 'commit' }, importedFrom: { source: 'legacy' }, revision: 0 });
    const state = project.initialState;
    Object.assign(state, serialize({ extension: { unicode: '根 😀', empty: null }, layerCollapsed: 'extension', panelsExpanded: false, __proto__: null }));
    Object.defineProperty(state, '__proto__', { value: { preserved: true }, enumerable: true, configurable: true });
    Object.assign(state.nodes.root, { nodeExtension: 0 });
    Object.assign(state.variants.default, { variantExtension: false });
    const template = state.variants.default.templates['page-0'];
    Object.assign(template, { templateExtension: ['kept'] });
    Object.assign(template.layers![0], { collapsed: false, layerExtension: null });
    Object.assign(template.elements[0], { elementExtension: 'kept' });
    Object.assign(state.generator!, { generatorExtension: 'kept' });
    const before = structuredClone(project);
    const parts = partitionState(state);
    expect(parts.compatibility.state).toHaveProperty('extension', { unicode: '根 😀', empty: null });
    expect(parts.document).not.toHaveProperty('cloud');
    expect(parts.document).not.toHaveProperty('revision');
    expect({ ...project, initialState: assembleState(serialize(parts)) }).toStrictEqual(before);
    expect(project).toStrictEqual(before);
  });

  it.each(Array.from({ length: 12 }, (_, version) => version))('preserves historical schema %i without migration or stricter validation', version => {
    const { partitionState, assembleState } = api();
    const state = historicalState(version);
    expect(assembleState(serialize(partitionState(state)))).toStrictEqual(state);
  });

  it('preserves missing fields, explicit undefined, and historical non-boolean collapse values', () => {
    const { partitionState, assembleState } = api();
    const state = makeIncrementalProject().initialState;
    delete state.generator;
    delete state.schemaVersion;
    delete state.activeLayerId;
    delete state.variants.default.templates['page-1'].layers;
    const layer = state.variants.default.templates['page-0'].layers![0];
    layer.collapsed = undefined;
    expect(assembleState(partitionState(state))).toStrictEqual(state);
    layer.collapsed = 'legacy' as unknown as boolean;
    const raw = serialize(state);
    expect(assembleState(serialize(partitionState(raw)))).toStrictEqual(raw);
    expect(assembleState(partitionState({ ...state, generator: undefined }))).toHaveProperty('generator', undefined);
  });

  it.each(historicalCollapsedValues)('keeps historical collapsed %j outside the boolean map without losing raw presence', collapsed => {
    const { partitionState, assembleState } = api();
    const state = makeIncrementalProject().initialState;
    const template = state.variants.default.templates['page-0'];
    const layer = template.layers![0];
    template.layers = [
      { ...layer, id: 'historical', collapsed, extension: { retained: true } },
      { ...layer, id: 'absent' },
      { ...layer, id: 'closed', collapsed: true },
      { ...layer, id: 'open', collapsed: false },
    ] as Layer[];
    const before = structuredClone(state);
    expect(validateAppState(state).ok).toBe(true);
    const parts = partitionState(state);
    expect(parts.preferences.layerCollapsed).toStrictEqual({
      [key('default', 'page-0', 'closed')]: true,
      [key('default', 'page-0', 'open')]: false,
    });
    for (const transported of [parts, serialize(parts)]) {
      const restored = assembleState(transported);
      expect(restored).toStrictEqual(state);
      expect(Object.hasOwn(restored.variants.default.templates['page-0'].layers![0], 'collapsed')).toBe(true);
      expect(restored.variants.default.templates['page-0'].layers![1]).not.toHaveProperty('collapsed');
      expect(serialize(restored)).toStrictEqual(serialize(state));
    }
    expect(assembleState(partitionState(serialize(state)))).toStrictEqual(serialize(state));
    expect(state).toStrictEqual(before);
  });

  it('round-trips pinned Sticker Press scripts and artwork', () => {
    const { partitionState, assembleState } = api();
    const state = loadStickerPressProject().initialState;
    const parts = partitionState(state);
    expect(parts.document.generator).toBe(state.generator);
    expect(assembleState(serialize(parts))).toStrictEqual(state);
  });

  it('preserves duplicate layer IDs accepted by historical validation without conflating folds', () => {
    const { partitionState, assembleState } = api();
    const state = makeIncrementalProject().initialState;
    const template = state.variants.default.templates['page-0'];
    const layer = template.layers![0];
    template.layers = [{ ...layer, collapsed: true }, { ...layer, collapsed: false }, { ...layer }];
    expect(validateAppState(state).ok).toBe(true);
    const parts = partitionState(state);
    expect(parts.document.variants.default.templates['page-0'].layers!.every(layer => !Object.hasOwn(layer, 'collapsed'))).toBe(true);
    expect(assembleState(serialize(parts))).toStrictEqual(state);
  });

  it('preserves permissively accepted layer entries and extension names without tightening validation', () => {
    const { partitionState, assembleState } = api();
    const state = makeIncrementalProject().initialState;
    Object.assign(state, { state: 'unknown state extension', layerCollapsedExceptions: 'unknown extension' });
    state.variants.default.templates['page-0'].layers = [
      null, 7, 'historical', { collapsed: 0 }, { id: 42, collapsed: null },
    ] as unknown as Layer[];
    expect(validateAppState(state).ok).toBe(true);
    expect(assembleState(serialize(partitionState(state)))).toStrictEqual(state);
  });
});

describe('live preference projection', () => {
  it.each(historicalCollapsedValues)('does not project historical collapsed %j as a live fold value', collapsed => {
    const { partitionState, resolvePreferences, projectActiveTemplate, hydrateState, assembleState } = api();
    const state = makeIncrementalProject().initialState;
    state.variants.default.templates['page-0'].layers![0].collapsed = collapsed as unknown as boolean;
    const parts = partitionState(state);
    const before = structuredClone(parts);
    const projected = projectActiveTemplate(parts.document, parts.preferences)!;
    expect(projected.layers![0]).not.toHaveProperty('collapsed');
    const resolved = resolvePreferences(parts.document, parts.preferences);
    expect(Object.values(resolved.layerCollapsed).every(value => typeof value === 'boolean')).toBe(true);
    expect(hydrateState(parts).variants).toBe(parts.document.variants);
    expect(parts).toStrictEqual(before);
    expect(assembleState(parts)).toStrictEqual(state);
  });

  it('projects the selected node type in hierarchy mode and selected template in template mode', () => {
    const { partitionState, projectActiveTemplate, hydrateState } = api();
    const state = makeIncrementalProject().initialState;
    state.selectedTemplateId = 'page-1';
    state.variants.default.templates['page-0'].layers!.push({
      id: 'front', name: 'Front', order: 20, visible: true, locked: false, collapsed: true,
    });
    const parts = partitionState(state);
    expect(projectActiveTemplate(parts.document, parts.preferences)?.id).toBe('page-0');
    expect(hydrateState(parts).activeLayerId).toBe('front');
    expect(projectActiveTemplate(parts.document, { ...parts.preferences, viewMode: 'templates' })?.id).toBe('page-1');
  });

  it('resolves absent navigation fields without confusing the literal undefined ID with absence', () => {
    const { partitionState, resolvePreferences, assembleState } = api();
    const state = makeIncrementalProject().initialState;
    state.variants = { undefined: { ...state.variants.default, id: 'undefined' } };
    Reflect.deleteProperty(state, 'activeVariantId');
    Reflect.deleteProperty(state, 'scale');
    const parts = partitionState(state);
    expect(resolvePreferences(parts.document, parts.preferences)).toMatchObject({ activeVariantId: 'undefined', scale: 0.8 });
    expect(assembleState(serialize(parts))).toStrictEqual(state);
  });

  it('uses an empty active-layer fallback for permissive historical layer entries without changing raw data', () => {
    const { partitionState, assembleState, hydrateState } = api();
    const state = makeIncrementalProject().initialState;
    state.variants.default.templates['page-0'].layers = [null, 42, { collapsed: false }] as unknown as Layer[];
    const parts = partitionState(state);
    expect(hydrateState(parts).activeLayerId).toBe('');
    expect(assembleState(parts)).toStrictEqual(state);
  });

  it('restores valid navigation, false and zero without changing content or raw preferences', () => {
    const { partitionState, resolvePreferences } = api();
    const state = makeIncrementalProject().initialState;
    Object.assign(state, { selectedTemplateId: 'page-1', scale: 0, sidebarWidth: 0, propertiesPanelWidth: 0, snapToGrid: false, showGrid: false });
    const parts = partitionState(state);
    const before = structuredClone(parts);
    const resolved = resolvePreferences(parts.document, parts.preferences);
    expect(resolved).toStrictEqual(parts.preferences);
    expect(parts).toStrictEqual(before);
  });

  it('resolves removed variant, node and template references to existing safe defaults', () => {
    const { partitionState, resolvePreferences } = api();
    const parts = partitionState(makeIncrementalProject().initialState);
    const stale = { ...parts.preferences, activeVariantId: 'gone', selectedNodeId: 'gone', selectedTemplateId: 'gone' };
    expect(resolvePreferences(parts.document, stale)).toMatchObject({
      activeVariantId: 'default', selectedNodeId: 'root', selectedTemplateId: 'page-0',
    });
    expect(stale.selectedNodeId).toBe('gone');
    const noRoot = { ...parts.document, rootId: 'gone' };
    expect(resolvePreferences(noRoot, stale).selectedNodeId).toBe('root');
    expect(resolvePreferences({ ...noRoot, nodes: {}, variants: {} }, stale)).toMatchObject({
      activeVariantId: '', selectedNodeId: '', selectedTemplateId: '',
    });
    const inherited = { ...stale, activeVariantId: 'toString', selectedNodeId: 'toString', selectedTemplateId: 'toString' };
    expect(resolvePreferences(parts.document, inherited).activeVariantId).toBe('default');
  });

  it('resets transient fields only at live hydration, retaining exact raw reconstruction', () => {
    const { partitionState, assembleState, hydrateState } = api();
    const state = makeIncrementalProject().initialState;
    Object.assign(state, {
      selectedNodeIds: ['root', 'gone'], selectedTemplateIds: ['page-0', 'gone'], selectedElementIds: ['title'],
      tool: 'rect', showJsonModal: true, showNodeSelector: true, nodeSelectorMode: 'link_element',
      editingElementId: 'title', clipboard: [state.variants.default.templates['page-0'].elements[0]],
      activeLayerId: 'gone', showLayersPanel: true, templatePreviewNodeId: 'gone',
    });
    const parts = partitionState(state);
    const before = structuredClone(parts);
    const live = hydrateState(parts);
    expect(live).toMatchObject({
      selectedNodeIds: ['root'], selectedTemplateIds: ['page-0'], selectedElementIds: [], tool: 'select',
      showJsonModal: false, showNodeSelector: false, nodeSelectorMode: 'grid_source', editingElementId: null,
      clipboard: [], activeLayerId: 'content', showLayersPanel: false,
    });
    expect(live).not.toHaveProperty('templatePreviewNodeId');
    expect(live.nodes).toBe(parts.document.nodes);
    expect(live.variants).toBe(parts.document.variants);
    expect(live.scale).toBe(state.scale);
    expect(parts).toStrictEqual(before);
    expect(assembleState(parts)).toStrictEqual(state);
  });

  it('projects only active template layers, ignores stale layer addresses, and keeps artwork shared', () => {
    const { partitionState, resolvePreferences, projectActiveTemplate, hydrateState } = api();
    const state = makeIncrementalProject(100).initialState;
    state.variants.default.templates['page-0'].layers![0].collapsed = false;
    const parts = partitionState(state);
    const active = parts.document.variants.default.templates['page-0'];
    const preferences = { ...parts.preferences, layerCollapsed: { ...parts.preferences.layerCollapsed, [key('default', 'page-0', 'removed')]: true } };
    const templates = new Proxy(parts.document.variants.default.templates, {
      ownKeys() { throw new Error('Must not enumerate all templates'); },
      get(target, property, receiver) {
        if (typeof property === 'string' && property.startsWith('page-') && property !== 'page-0') throw new Error('Inactive template read');
        return Reflect.get(target, property, receiver);
      },
    });
    const document = { ...parts.document, variants: { default: { ...parts.document.variants.default, templates } } };
    expect(resolvePreferences(document, preferences)).toEqual(preferences);
    const projected = projectActiveTemplate(document, preferences)!;
    expect(projected.layers![0]).toEqual({ ...active.layers![0], collapsed: false });
    expect(projected.layers).toHaveLength(1);
    expect(projected.elements).toBe(active.elements);
    expect(active.layers![0]).not.toHaveProperty('collapsed');
    expect(hydrateState({ ...parts, document, preferences }).variants).toBe(document.variants);
    expect(projectActiveTemplate({ ...document, variants: {} }, preferences)).toBeUndefined();
  });
});
