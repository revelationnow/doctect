// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Layer } from '../../../types';
import { makeIncrementalProject } from '../../helpers/incrementalFixtures';
import { partitionState, assembleState } from '../../../services/document/partition';
import { applyDocumentChanges } from '../../../services/document/applyChanges';
import * as foldApi from '../../../services/document/layerFolds';
import {
  createLayerFoldState, readLayerFoldCell, isLayerCollapsed, setLayerCollapsed,
  updateLayerFoldPreferences, reconcileLayerFolds,
  type LayerOccurrence, type LayerMapping, type LayerFoldState,
} from '../../../services/document/layerFolds';

const at = (position: number, templateId = 'page-0', variantId = 'default'): LayerOccurrence => ({ variantId, templateId, position });
const layer = (id: unknown, extra = {}): Layer => ({ id, name: 'Layer', order: 0, visible: true, locked: false, ...extra }) as Layer;
function initial(layers = [layer('same', { collapsed: 'legacy' }), layer('same')]) {
  const state = makeIncrementalProject().initialState;
  state.variants.default.templates['page-0'].layers = layers;
  layers.forEach(Object.freeze); Object.freeze(layers);
  return createLayerFoldState(partitionState(state));
}
function replace(state: LayerFoldState, layers: Layer[], mappings: readonly LayerMapping[]) {
  const d = state.parts.document;
  const edit = applyDocumentChanges(d, [{ type: 'put-template', variantId: 'default',
    template: { ...d.variants.default.templates['page-0'], layers } }]);
  return reconcileLayerFolds(state, edit, { before: d, after: edit.after, mappings });
}
const assembled = (state: LayerFoldState) => assembleState(state.parts).variants.default.templates['page-0'].layers!;

describe('wire layer correspondence', () => {
  it('materializes proven implicit continuity for independently cloned worker records', () => {
    expect(foldApi.materializeLayerMappingsForTransfer).toBeTypeOf('function');
    const state = initial(); const d = state.parts.document;
    const before = d.variants.default.templates['page-0'];
    const edit = applyDocumentChanges(d, [{ type: 'put-template', variantId: 'default', template: { ...before, name: 'Renamed' } }]);
    const input = Object.freeze([] as LayerMapping[]);
    const mappings = foldApi.materializeLayerMappingsForTransfer(edit, { before: d, after: edit.after, mappings: input });
    expect(mappings).toEqual([0, 1].map(position => ({ type: 'continue', from: at(position), to: at(position) })));
    expect(Object.isFrozen(mappings)).toBe(true); expect(input).toEqual([]);
    // Separate clones model IDB before-record versus transferred after-record.
    const sequence = { address: at(0), before: structuredClone(before),
      after: structuredClone(edit.after.variants.default.templates['page-0']),
      cells: [{ present: true as const, value: 'latest durable fold' }, { present: false as const }] };
    expect(() => foldApi.reconcileSelectedLayerFolds([sequence], [])).toThrow(/correspondence/);
    expect(foldApi.reconcileSelectedLayerFolds([sequence], mappings)[0].cells).toEqual(sequence.cells);
  });

  it('never infers identity from matching IDs or a newly allocated layer array', () => {
    const state = initial(); const d = state.parts.document; const template = d.variants.default.templates['page-0'];
    const edit = applyDocumentChanges(d, [{ type: 'put-template', variantId: 'default', template: { ...template, layers: [...template.layers!] } }]);
    expect(() => foldApi.materializeLayerMappingsForTransfer(edit, { before: d, after: edit.after, mappings: [] })).toThrow(/correspondence/);
    const mappings: LayerMapping[] = [
      { type: 'remove', from: at(0) }, { type: 'remove', from: at(1) },
      { type: 'create', to: at(0), cell: { present: false } }, { type: 'create', to: at(1), cell: { present: false } },
    ];
    expect(foldApi.materializeLayerMappingsForTransfer(edit, { before: d, after: edit.after, mappings })).toEqual(mappings);
  });

  it('detaches mutable explicit mapping metadata while borrowing opaque fold values', () => {
    const state = initial(); const d = state.parts.document; const template = d.variants.default.templates['page-0'];
    const edit = applyDocumentChanges(d, [{ type: 'put-template', variantId: 'default', template: { ...template, layers: [layer('new')] } }]);
    const raw = { retained: 'opaque' };
    const mappings: LayerMapping[] = [
      { type: 'remove', from: at(0) }, { type: 'remove', from: at(1) },
      { type: 'create', to: at(0), cell: { present: true, value: raw } },
    ];
    const result = foldApi.materializeLayerMappingsForTransfer(edit, { before: d, after: edit.after, mappings });
    if ('from' in mappings[0]) expect(Reflect.set(mappings[0].from, 'position', 1)).toBe(true);
    if (mappings[2].type === 'create') expect(Reflect.set(mappings[2], 'cell', { present: false })).toBe(true);
    expect(result[0]).toEqual({ type: 'remove', from: at(0) });
    expect(Object.isFrozen(result[0])).toBe(true);
    expect(result[2]).toEqual({ type: 'create', to: at(0), cell: { present: true, value: raw } });
    if (result[2].type === 'create' && result[2].cell.present) expect(result[2].cell.value).toBe(raw);
  });

  it('does not add consuming continuations for an unchanged read-only copy source', () => {
    const state = initial(); const d = state.parts.document; const template = d.variants.default.templates['page-0'];
    const edit = applyDocumentChanges(d, [{ type: 'put-template', variantId: 'default', template: { ...template, id: 'copy' } }]);
    const mappings: LayerMapping[] = [0, 1].map(position => ({ type: 'copy', from: at(position), to: at(position, 'copy') }));
    expect(foldApi.materializeLayerMappingsForTransfer(edit, { before: d, after: edit.after, mappings })).toEqual(mappings);
  });

  it('copies only wire metadata without enumerating incidental mapping payloads', () => {
    const state = initial(); const d = state.parts.document; const template = d.variants.default.templates['page-0'];
    const edit = applyDocumentChanges(d, [{ type: 'put-template', variantId: 'default', template: { ...template, layers: [layer('renamed')] } }]);
    const from = at(0); const mapping: LayerMapping = { type: 'continue', from, to: at(0) };
    const trap = () => { throw new Error('Incidental receipt payload accessed'); };
    Object.defineProperty(from, 'document', { enumerable: true, get: trap });
    Object.defineProperty(mapping, 'document', { enumerable: true, get: trap });
    const result = foldApi.materializeLayerMappingsForTransfer(edit, { before: d, after: edit.after,
      mappings: [mapping, { type: 'remove', from: at(1) }] });
    expect(result).toEqual([{ type: 'continue', from: at(0), to: at(0) }, { type: 'remove', from: at(1) }]);
  });

  it('only examines affected sequence metadata, not layer IDs or unrelated payloads', () => {
    const state = initial([layer(7, { collapsed: 'raw' }), layer('same')]); const d = state.parts.document;
    const template = d.variants.default.templates['page-0'];
    const edit = applyDocumentChanges(d, [{ type: 'put-template', variantId: 'default', template: { ...template, name: 'Renamed' } }]);
    const trap = () => { throw new Error('Payload or ID inspected'); };
    Object.defineProperty(template.layers![0], 'id', { get: trap });
    Object.defineProperty(d.variants.default.templates['page-1'], 'layers', { get: trap });
    Object.defineProperty(template, 'elements', { get: trap });
    const repeated = { ...edit, affected: [...edit.affected, ...edit.affected] };
    expect(foldApi.materializeLayerMappingsForTransfer(repeated, { before: d, after: edit.after, mappings: [] }))
      .toEqual([0, 1].map(position => ({ type: 'continue', from: at(position), to: at(position) })));
  });

  it('rejects stale correspondence before materializing anything', () => {
    const state = initial(); const d = state.parts.document;
    const edit = applyDocumentChanges(d, [{ type: 'put-template', variantId: 'default',
      template: { ...d.variants.default.templates['page-0'], name: 'Renamed' } }]);
    expect(() => foldApi.materializeLayerMappingsForTransfer(edit, { before: { ...d }, after: edit.after, mappings: [] })).toThrow(/snapshot/i);
  });
});

it('reconciles selected authoritative sequences without a whole document ingress', () => {
  const state = initial(); const before = state.parts.document.variants.default.templates['page-0'];
  const after = { ...before, layers: [...before.layers!].reverse() };
  const mappings: LayerMapping[] = [{ type: 'continue', from: at(0), to: at(1) }, { type: 'continue', from: at(1), to: at(0) }];
  const effects = foldApi.reconcileSelectedLayerFolds([{ address: at(0), before, after,
    cells: [{ present: true, value: 'latest durable' }, { present: false }] }], mappings);
  expect(effects).toEqual([{ variantId: 'default', templateId: 'page-0', cells: [
    { present: false }, { present: true, value: 'latest durable' },
  ] }]);
  expect(() => foldApi.reconcileSelectedLayerFolds([{ address: at(0), before, after,
    cells: [{ present: false }, { present: false }] }], [])).toThrow(/correspondence/);
});

describe('indexed logical layer fold cells', () => {
  it('reorders duplicate frozen IDs preserving exact raw value and absence', () => {
    const state = initial(); const layers = state.parts.document.variants.default.templates['page-0'].layers!;
    const next = replace(state, [layers[1], layers[0]], [
      { type: 'continue', from: at(0), to: at(1) }, { type: 'continue', from: at(1), to: at(0) },
    ]);
    expect(Object.hasOwn(assembled(next.after)[0], 'collapsed')).toBe(false);
    expect(assembled(next.after)[1].collapsed).toBe('legacy');
    expect(next.after.parts.document).toBe(next.documentEdit.after);
    expect(next.after.parts.document.nodes).toBe(state.parts.document.nodes);
    expect(next.overlayEffects).toEqual([{ variantId: 'default', templateId: 'page-0', cells: [
      { present: false }, { present: true, value: 'legacy' },
    ] }]);
    expect(assembled(state)[0].collapsed).toBe('legacy');
  });

  it('displays raw values safely and explicitly toggles only the targeted duplicate', () => {
    const state = initial();
    expect(isLayerCollapsed(state, at(0))).toBe(false);
    expect(readLayerFoldCell(state, at(0))).toEqual({ present: true, value: 'legacy' });
    const update = setLayerCollapsed(state, at(1), false);
    expect(update.state.parts.document).toBe(state.parts.document);
    expect(assembled(update.state).map(l => l.collapsed)).toEqual(['legacy', false]);
    expect(Object.hasOwn(assembled(state)[1], 'collapsed')).toBe(false);
    expect(setLayerCollapsed(update.state, at(1), false)).toEqual({ state: update.state, overlayEffects: [] });
    expect(isLayerCollapsed(setLayerCollapsed(state, at(0), true).state, at(0))).toBe(true);
    expect(() => updateLayerFoldPreferences(state, { layerCollapsed: {} } as never)).toThrow(/layerCollapsed/);
    const prefs = updateLayerFoldPreferences(state, { scale: 2, panelsExpanded: { layers: true } });
    expect(prefs.parts.document).toBe(state.parts.document);
    expect(prefs.parts.preferences.layerCollapsed).toBe(state.parts.preferences.layerCollapsed);
    expect(readLayerFoldCell(prefs, at(0))).toEqual({ present: true, value: 'legacy' });
  });

  it('moves duplicate booleans into unique keys and clears them when duplicates return', () => {
    const state = initial([layer('same', { collapsed: true }), layer('same', { collapsed: false })]);
    const layers = state.parts.document.variants.default.templates['page-0'].layers!;
    const unique = replace(state, [layers[0]], [{ type: 'continue', from: at(0), to: at(0) }, { type: 'remove', from: at(1) }]);
    expect(unique.after.parts.preferences.layerCollapsed[JSON.stringify(['default', 'page-0', 'same'])]).toBe(true);
    const duplicate = replace(unique.after, [layers[0], layer('same')], [
      { type: 'continue', from: at(0), to: at(0) }, { type: 'create', to: at(1), cell: { present: false } },
    ]);
    expect(Object.hasOwn(duplicate.after.parts.preferences.layerCollapsed, JSON.stringify(['default', 'page-0', 'same']))).toBe(false);
    expect(assembled(duplicate.after)[0].collapsed).toBe(true);
    expect(Object.hasOwn(assembled(duplicate.after)[1], 'collapsed')).toBe(false);
  });

  it('preserves non-string IDs, own undefined, ID rename and explicit same-ID replacement', () => {
    const state = initial([layer(7, { collapsed: undefined }), layer('__proto__', { collapsed: true })]);
    const next = replace(state, [layer('renamed'), layer('__proto__')], [
      { type: 'continue', from: at(0), to: at(0) }, { type: 'remove', from: at(1) },
      { type: 'create', to: at(1), cell: { present: false } },
    ]);
    expect(Object.hasOwn(assembled(next.after)[0], 'collapsed')).toBe(true);
    expect(assembled(next.after)[0].collapsed).toBeUndefined();
    expect(Object.hasOwn(assembled(next.after)[1], 'collapsed')).toBe(false);
  });

  it('copies from another variant without rewriting the source and empties removed template overlays', () => {
    const state = initial(); const d = state.parts.document;
    const edit = applyDocumentChanges(d, [
      { type: 'put-variant', variant: { id: '__proto__', name: 'Copy' } },
      { type: 'put-template', variantId: '__proto__', template: { ...d.variants.default.templates['page-0'], id: 'copy' } },
    ]);
    const copied = reconcileLayerFolds(state, edit, { before: d, after: edit.after, mappings: [
      { type: 'copy', from: at(0), to: at(0, 'copy', '__proto__') },
      { type: 'copy', from: at(1), to: at(1, 'copy', '__proto__') },
    ] });
    expect(copied.overlayEffects).toHaveLength(1);
    expect(copied.after.parts.document.variants.default).toBe(d.variants.default);
    expect(readLayerFoldCell(copied.after, at(0, 'copy', '__proto__'))).toEqual({ present: true, value: 'legacy' });
    const deleted = applyDocumentChanges(edit.after, [{ type: 'delete-variant', variantId: '__proto__' }]);
    const removed = reconcileLayerFolds(copied.after, deleted, { before: edit.after, after: deleted.after, mappings: [
      { type: 'remove', from: at(0, 'copy', '__proto__') }, { type: 'remove', from: at(1, 'copy', '__proto__') },
    ] });
    expect(removed.overlayEffects).toEqual([{ variantId: '__proto__', templateId: 'copy', cells: [] }]);
    expect(removed.after.parts.preferences.layerCollapsed).toEqual(state.parts.preferences.layerCollapsed);
    expect(removed.after.parts.compatibility).toEqual(state.parts.compatibility);
  });

  it('rejects missing, duplicated, malformed and stale provenance atomically', () => {
    const state = initial(); const d = state.parts.document;
    const edit = applyDocumentChanges(d, [{ type: 'put-template', variantId: 'default',
      template: { ...d.variants.default.templates['page-0'], layers: [layer('new')] } }]);
    const good: LayerMapping[] = [ { type: 'continue', from: at(0), to: at(0) }, { type: 'remove', from: at(1) } ];
    for (const mappings of [[], good.slice(0, 1), [...good, good[0]],
      [{ type: 'continue', from: at(0.5), to: at(0) }, good[1]],
      [{ type: 'continue', from: at(0), to: at(2) }, good[1]],
      [{ type: 'continue', from: at(0, 'page-1'), to: at(0) }, good[1]],
      [{ type: 'remove', from: at(0) }, good[1], { type: 'create', to: at(0), cell: { present: 'yes' } }],
    ]) expect(() => reconcileLayerFolds(state, edit, { before: d, after: edit.after, mappings: mappings as LayerMapping[] })).toThrow();
    expect(() => reconcileLayerFolds(state, edit, { before: { ...d }, after: edit.after, mappings: good })).toThrow(/snapshot|stale/i);
    expect(() => reconcileLayerFolds(state, { ...edit, before: { ...d } }, { before: d, after: edit.after, mappings: good })).toThrow(/snapshot|stale/i);
    expect(assembled(state)[0].collapsed).toBe('legacy');
    expect(readLayerFoldCell(reconcileLayerFolds(state, edit, { before: d, after: edit.after, mappings: good }).after, at(0)))
      .toEqual({ present: true, value: 'legacy' });
  });

  it('implicitly continues identical layer arrays without scanning unrelated templates or discovering global overlays', () => {
    const state = initial(); const d = state.parts.document;
    Object.defineProperty(d.variants.default.templates['page-1'], 'layers', { get() { throw Error('unrelated template'); } });
    const exceptions = state.parts.compatibility.layerCollapsedExceptions as Record<string, unknown>;
    Object.defineProperty(exceptions, JSON.stringify(['default', 'page-1', 100]), {
      enumerable: true, value: Object.defineProperty({}, 'value', { get() { throw Error('unrelated overlay discovery'); } }),
    });
    const edit = applyDocumentChanges(d, [{ type: 'put-template', variantId: 'default',
      template: { ...d.variants.default.templates['page-0'], name: 'Renamed' } }]);
    const next = reconcileLayerFolds(state, edit, { before: d, after: edit.after, mappings: [] });
    expect(next.after.parts.preferences).toBe(state.parts.preferences);
    expect(next.overlayEffects).toEqual([]);
    expect(setLayerCollapsed(next.after, at(0), true).state.parts.document).toBe(edit.after);
  });

  it('rejects mappings missing required endpoints even when both sequences are empty', () => {
    const state = initial([]); const d = state.parts.document;
    const edit = applyDocumentChanges(d, [{ type: 'put-template', variantId: 'default',
      template: { ...d.variants.default.templates['page-0'], layers: [] } }]);
    for (const mapping of [{ type: 'continue' }, { type: 'copy' }, { type: 'remove' }, { type: 'create', cell: { present: false } }])
      expect(() => reconcileLayerFolds(state, edit, { before: d, after: edit.after, mappings: [mapping] as LayerMapping[] })).toThrow(/mapping/i);
    expect(reconcileLayerFolds(state, edit, { before: d, after: edit.after, mappings: [] }).after.parts.document).toBe(edit.after);
  });

  it('rejects create/remove mappings with contradictory extra endpoints', () => {
    const state = initial([layer('A')]); const d = state.parts.document;
    const edit = applyDocumentChanges(d, [{ type: 'put-template', variantId: 'default',
      template: { ...d.variants.default.templates['page-0'], layers: [layer('B')] } }]);
    for (const mapping of [
      { type: 'create', from: at(0), to: at(0), cell: { present: false } },
      { type: 'remove', from: at(0), to: at(0) },
    ]) expect(() => reconcileLayerFolds(state, edit, { before: d, after: edit.after, mappings: [mapping] as LayerMapping[] })).toThrow(/mapping/i);
  });

  it('uses indexed key buckets: only one permitted shallow map copy, no global address parsing', () => {
    const source = makeIncrementalProject().initialState;
    source.variants.default.templates['page-0'].layers = [layer('same', { collapsed: true }), layer('same')];
    const parts = partitionState(source);
    let preferenceWalks = 0; let exceptionWalks = 0;
    parts.preferences.layerCollapsed = new Proxy(parts.preferences.layerCollapsed, { ownKeys(target) { preferenceWalks++; return Reflect.ownKeys(target); } });
    parts.compatibility = { ...parts.compatibility, layerCollapsedExceptions: new Proxy(parts.compatibility.layerCollapsedExceptions as object,
      { ownKeys(target) { exceptionWalks++; return Reflect.ownKeys(target); } }) };
    const state = createLayerFoldState(parts);
    preferenceWalks = 0; exceptionWalks = 0;
    const parse = vi.spyOn(JSON, 'parse').mockImplementation(() => { throw Error('global fold-key discovery'); });
    try {
      const next = replace(state, [layersOf(state)[1], layersOf(state)[0]], [
        { type: 'continue', from: at(0), to: at(1) }, { type: 'continue', from: at(1), to: at(0) },
      ]);
      expect(readLayerFoldCell(next.after, at(1))).toEqual({ present: true, value: true });
      expect(preferenceWalks).toBe(1); expect(exceptionWalks).toBe(1);
    } finally { parse.mockRestore(); }
  });
});

function layersOf(state: LayerFoldState) { return state.parts.document.variants.default.templates['page-0'].layers!; }
