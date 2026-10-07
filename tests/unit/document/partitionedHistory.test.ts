// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Layer } from '../../../types';
import { makeIncrementalProject } from '../../helpers/incrementalFixtures';
import { currentState } from '../../helpers/localWorkspaceFixtures';
import { validateWorkspaceProject } from '../../../services/localWorkspace/validation';
import { assembleState, partitionState } from '../../../services/document/partition';
import { applyDocumentChanges } from '../../../services/document/applyChanges';
import { createLayerFoldState, readLayerFoldCell, reconcileLayerFolds, setLayerCollapsed, updateLayerFoldPreferences,
  type LayerFoldState, type LayerOccurrence, type LayerMapping } from '../../../services/document/layerFolds';
import { createPartitionedHistory, recordPartitionedEdit, undoPartitioned, redoPartitioned,
  finishPartitionedGroup, cancelPartitionedGroup, recordPartitionedReplacement } from '../../../services/document/partitionedHistory';
import type { HistorySelection } from '../../../services/document/history';
import * as partitionedHistory from '../../../services/document/partitionedHistory';

const at = (position: number, templateId = 'page-0'): LayerOccurrence => ({ variantId: 'default', templateId, position });
const layer = (id: string, extra = {}): Layer => ({ id, name: id, order: 0, visible: true, locked: false, ...extra });
function initial(layers = [layer('A', { collapsed: 'legacy' }), layer('B')]) {
  const state = makeIncrementalProject().initialState;
  state.variants.default.templates['page-0'].layers = layers;
  layers.forEach(Object.freeze); Object.freeze(layers);
  return createLayerFoldState(partitionState(state));
}
const layersOf = (state: LayerFoldState) => state.parts.document.variants.default.templates['page-0'].layers!;
const raw = (state: LayerFoldState) => assembleState(state.parts).variants.default.templates['page-0'].layers!;
function editLayers(state: LayerFoldState, layers: Layer[], mappings: readonly LayerMapping[]) {
  const d = state.parts.document;
  const edit = applyDocumentChanges(d, [{ type: 'put-template', variantId: 'default', template: { ...d.variants.default.templates['page-0'], layers } }]);
  return reconcileLayerFolds(state, edit, { before: d, after: edit.after, mappings });
}
function reorder(state: LayerFoldState) {
  const layers = layersOf(state);
  return editLayers(state, [layers[1], layers[0]], [
    { type: 'continue', from: at(0), to: at(1) }, { type: 'continue', from: at(1), to: at(0) },
  ]);
}
function deleteA(state: LayerFoldState) {
  return editLayers(state, [layersOf(state)[1]], [{ type: 'remove', from: at(0) }, { type: 'continue', from: at(1), to: at(0) }]);
}
function contentEdit(state: LayerFoldState, title: string) {
  const d = state.parts.document;
  const edit = applyDocumentChanges(d, [{ type: 'put-node', node: { ...d.nodes.root, title } }]);
  return reconcileLayerFolds(state, edit, { before: d, after: edit.after, mappings: [] });
}
function containsReference(value: unknown, target: object, seen = new Set<object>()): boolean {
  if (value === target) return true;
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return Reflect.ownKeys(value).some(key => containsReference(Reflect.get(value, key), target, seen));
}

function selectionContext(nodeType = 'page-1') {
  const state = makeIncrementalProject().initialState;
  state.nodes.root.type = nodeType;
  state.viewMode = 'templates';
  delete state.activeLayerId;
  for (const [id, prefix] of [['page-0', 'template'], ['page-1', 'hierarchy']]) {
    const template = state.variants.default.templates[id];
    template.elements = [{ ...template.elements[0], id: `${prefix}-element`, layerId: `${prefix}-layer` }];
    template.layers = [layer(`${prefix}-layer`), layer(`${prefix}-front`, { order: 10 })];
  }
  return createLayerFoldState(partitionState(state));
}
const contextSelection = (prefix = 'hierarchy'): HistorySelection => ({ activeVariantId: 'default',
  selectedNodeId: 'root', selectedNodeIds: ['root'], selectedTemplateId: 'page-0', selectedTemplateIds: ['page-0'],
  selectedElementIds: [`${prefix}-element`], activeLayerId: `${prefix}-layer` });
const currentContext = (state: LayerFoldState, viewMode: 'hierarchy' | 'templates') => updateLayerFoldPreferences(state,
  { viewMode, scale: 2.5, showGrid: true, sidebarWidth: 415, panelsExpanded: { layers: true } });
function expectCurrentContext(result: LayerFoldState, current: LayerFoldState) {
  expect(result.parts.preferences).toEqual(current.parts.preferences);
  expect(result.parts.compatibility.state).toBe(current.parts.compatibility.state);
  expect(Object.hasOwn(result.parts.preferences, 'activeLayerId')).toBe(false);
  expect(Object.hasOwn(assembleState(result.parts), 'activeLayerId')).toBe(false);
}

describe('atomic partitioned history', () => {
  it('returns directional receipts that transfer latest authoritative folds rather than local overlay snapshots', () => {
    const state = initial(); const edit = reorder(state);
    const h = recordPartitionedEdit(createPartitionedHistory(), edit);
    const u = undoPartitioned(h, edit.after);
    expect(u.edit, 'ordinary history traversal exposes exact retained edit').toBeDefined();
    expect(u.correspondence).toMatchObject({ before: edit.documentEdit.after, after: edit.documentEdit.before });
    expect(u.edit!.after).toBe(state.parts.document);
    const authoritative = setLayerCollapsed(edit.after, at(1), true).state;
    const replay = reconcileLayerFolds(authoritative, u.edit!, u.correspondence!);
    expect(readLayerFoldCell(replay.after, at(0))).toEqual({ present: true, value: true });
    expect(readLayerFoldCell(u.state, at(0))).toEqual({ present: true, value: 'legacy' });
  });

  it('returns create cells on redo of a copy, not a repeated copy from the latest source', () => {
    const state = initial([layer('A', { collapsed: true })]);
    const edit = editLayers(state, [layersOf(state)[0], layer('C')], [
      { type: 'continue', from: at(0), to: at(0) }, { type: 'copy', from: at(0), to: at(1) },
    ]);
    const u = undoPartitioned(recordPartitionedEdit(createPartitionedHistory(), edit), setLayerCollapsed(edit.after, at(1), false).state);
    const r = redoPartitioned(u.history, u.state);
    expect(r.correspondence, 'redo exposes ownership provenance').toBeDefined();
    expect(r.correspondence!.mappings).toContainEqual({ type: 'create', to: at(1), cell: { present: true, value: false } });
    const replay = reconcileLayerFolds(setLayerCollapsed(u.state, at(0), true).state, r.edit!, r.correspondence!);
    expect(raw(replay.after).map(item => item.collapsed)).toEqual([true, false]);
  });

  it('exposes constant-time history availability without exposing stacks or trial traversal', () => {
    expect(partitionedHistory.getPartitionedHistoryStatus, 'status API exists').toBeTypeOf('function');
    const status = partitionedHistory.getPartitionedHistoryStatus;
    const state = initial(); const edit = reorder(state);
    const empty = createPartitionedHistory(); expect(status(empty)).toEqual({ canUndo: false, canRedo: false });
    const h = recordPartitionedEdit(empty, edit, 'drag');
    expect(status(h)).toEqual({ canUndo: true, canRedo: false, openGroupId: 'drag' });
    const u = cancelPartitionedGroup(h, edit.after, 'drag');
    expect(status(u.history)).toEqual({ canUndo: false, canRedo: false });
    expect(undoPartitioned(u.history, u.state)).not.toHaveProperty('edit');
    const bulk = recordPartitionedReplacement(empty, state, initial());
    const after = initial();
    const h2 = recordPartitionedReplacement(empty, state, after);
    expect(undoPartitioned(h2, after)).not.toHaveProperty('correspondence');
    expect(status(bulk).canUndo).toBe(true);
  });

  it('retains valid hierarchy selection on undo using current mode, not selectedTemplateId', () => {
    const state = selectionContext(); const edit = contentEdit(state, 'Changed');
    const selected = contextSelection();
    const h = recordPartitionedEdit(createPartitionedHistory(), edit, undefined, { before: selected, after: selected });
    const current = currentContext(edit.after, 'hierarchy');
    const u = undoPartitioned(h, current);
    expect(u.selection).toEqual(selected);
    expect(u.state.parts.document).toBe(state.parts.document);
    expectCurrentContext(u.state, current);
  });

  it.each(['hierarchy', 'templates'] as const)('resolves raw redo selection after current mode changes to %s', mode => {
    const state = selectionContext(); const edit = contentEdit(state, 'Changed');
    const selected = contextSelection(mode === 'hierarchy' ? 'hierarchy' : 'template');
    const h = recordPartitionedEdit(createPartitionedHistory(), edit, undefined, { before: selected, after: selected });
    const u = undoPartitioned(h, currentContext(edit.after, mode === 'hierarchy' ? 'templates' : 'hierarchy'));
    const current = currentContext(u.state, mode);
    const r = redoPartitioned(u.history, current);
    expect(r.selection).toEqual(selected);
    expect(r.state.parts.document).toBe(edit.after.parts.document);
    expectCurrentContext(r.state, current);
  });

  it.each(['page-1', 'missing-template'])('resolves invalid hierarchy IDs safely when node type is %s', nodeType => {
    const state = selectionContext(nodeType); const edit = contentEdit(state, 'Changed');
    const selected = { ...contextSelection(), activeVariantId: 'missing', selectedNodeId: 'missing',
      selectedNodeIds: ['missing', 'root'], selectedTemplateIds: ['missing', 'page-0'],
      selectedElementIds: ['missing', 'template-element', 'hierarchy-element'], activeLayerId: 'template-layer' };
    const current = currentContext(edit.after, 'hierarchy');
    const u = undoPartitioned(recordPartitionedEdit(createPartitionedHistory(), edit, undefined,
      { before: selected, after: selected }), current);
    expect(u.selection).toEqual({ ...contextSelection(),
      selectedElementIds: nodeType === 'page-1' ? ['hierarchy-element'] : [],
      activeLayerId: nodeType === 'page-1' ? 'hierarchy-front' : '' });
    expectCurrentContext(u.state, current);
  });

  it.each(['page-1', 'missing-template'])('cancels in current hierarchy context without manufacturing an absent layer: %s', nodeType => {
    const state = selectionContext(nodeType); const first = contentEdit(state, 'First');
    const second = contentEdit(first.after, 'Second');
    const before = contextSelection(); delete before.activeLayerId;
    const after = contextSelection('template');
    const h = recordPartitionedEdit(recordPartitionedEdit(createPartitionedHistory(), first, 'drag', { before, after }),
      second, 'drag', { before: after, after });
    const current = currentContext(second.after, 'hierarchy');
    const cancelled = cancelPartitionedGroup(h, current, 'drag');
    expect(cancelled.selection).toEqual({ ...before, selectedElementIds: nodeType === 'page-1' ? ['hierarchy-element'] : [] });
    expect(Object.hasOwn(cancelled.selection!, 'activeLayerId')).toBe(false);
    expect(cancelled.state.parts.document).toBe(state.parts.document);
    expectCurrentContext(cancelled.state, current);
  });

  it('uses restored-document hierarchy context for bulk undo and current template context for bulk redo', () => {
    const before = selectionContext(); const after = selectionContext('missing-template');
    const selection = { before: contextSelection(), after: contextSelection('template') };
    const h = recordPartitionedReplacement(createPartitionedHistory(), before, after, selection);
    const current = currentContext(after, 'hierarchy');
    const u = undoPartitioned(h, current);
    expect(u.selection).toEqual(selection.before); expect(u.replacement).toBe(before.parts.document);
    expectCurrentContext(u.state, current);
    const next = currentContext(u.state, 'templates');
    const r = redoPartitioned(u.history, next);
    expect(r.selection).toEqual(selection.after); expect(r.replacement).toBe(after.parts.document);
    expectCurrentContext(r.state, next);
    const hierarchyRedo = redoPartitioned(u.history, currentContext(u.state, 'hierarchy'));
    expect(hierarchyRedo.selection).toEqual({ ...selection.after, selectedElementIds: [], activeLayerId: '' });
  });

  it('does not inspect inactive template payloads while resolving hierarchy selection', () => {
    const state = selectionContext(); const edit = contentEdit(state, 'Changed');
    const selected = contextSelection(); delete selected.activeLayerId;
    const h = recordPartitionedEdit(createPartitionedHistory(), edit, undefined, { before: selected, after: selected });
    const inactive = state.parts.document.variants.default.templates['page-0'];
    for (const key of ['elements', 'layers']) Object.defineProperty(inactive, key, { get() { throw Error(`inactive ${key}`); } });
    const u = undoPartitioned(h, currentContext(edit.after, 'hierarchy'));
    expect(u.selection).toEqual(selected);
    expect(Object.hasOwn(u.selection!, 'activeLayerId')).toBe(false);
  });

  it('resolves layers without projecting folds or reading unrelated active-template payloads', () => {
    const state = selectionContext(); const edit = contentEdit(state, 'Changed');
    const selected = contextSelection('template');
    const h = recordPartitionedEdit(createPartitionedHistory(), edit, undefined, { before: selected, after: selected });
    const template = state.parts.document.variants.default.templates['page-0'];
    Object.defineProperty(template, 'opaquePayload', { enumerable: true, get() { throw Error('unrelated payload'); } });
    for (const item of template.layers!) Object.defineProperty(item, 'collapsed', { get() { throw Error('fold projection'); } });
    expect(undoPartitioned(h, currentContext(edit.after, 'templates')).selection).toEqual(selected);
  });

  it('reorder→toggle→undo follows the continuing layer using current cells', () => {
    const state = initial(); const edit = reorder(state);
    const h = recordPartitionedEdit(createPartitionedHistory(), edit);
    const toggled = setLayerCollapsed(edit.after, at(1), true).state;
    const u = undoPartitioned(h, toggled);
    expect(u.state.parts.document).toBe(edit.documentEdit.before);
    expect(readLayerFoldCell(u.state, at(0))).toEqual({ present: true, value: true });
    expect(raw(u.state)[0].collapsed).toBe(true);
    expect(Object.hasOwn(raw(u.state)[1], 'collapsed')).toBe(false);
    expect(u.overlayEffects).toEqual([{ variantId: 'default', templateId: 'page-0', cells: [{ present: true, value: true }, { present: false }] }]);
    expect(applyDocumentChanges(toggled.parts.document, u.changes).after).toEqual(state.parts.document);
    expect(raw(redoPartitioned(u.history, u.state).state)[1].collapsed).toBe(true);
  });

  it('deletion preserves unrelated preferences; each later crossing captures the restored layer anew', () => {
    const state = initial(); const edit = deleteA(state);
    const h = recordPartitionedEdit(createPartitionedHistory(), edit);
    const current = updateLayerFoldPreferences(setLayerCollapsed(edit.after, at(0), true).state,
      { scale: 2, selectedTemplateId: 'page-1', panelsExpanded: { layers: true } });
    const u = undoPartitioned(h, current);
    expect(raw(u.state).map(l => l.collapsed)).toEqual(['legacy', true]);
    expect(u.state.parts.preferences.scale).toBe(2);
    expect(u.state.parts.preferences.selectedTemplateId).toBe('page-1');
    expect(u.state.parts.compatibility.state).toBe(current.parts.compatibility.state);
    const restoredToggle = setLayerCollapsed(u.state, at(0), false).state;
    const r = redoPartitioned(u.history, restoredToggle);
    expect(raw(r.state).map(l => l.collapsed)).toEqual([true]);
    expect(raw(undoPartitioned(r.history, r.state).state).map(l => l.collapsed)).toEqual([false, true]);
    expect(raw(redoPartitioned(u.history, u.state).state).map(l => l.collapsed)).toEqual([true]);
    expect(raw(undoPartitioned(h, current).state)[0].collapsed).toBe('legacy');
  });

  it('copy→toggle copy→undo→toggle source→redo restores the copy independently', () => {
    const state = initial([layer('A', { collapsed: true })]);
    const edit = editLayers(state, [layersOf(state)[0], layer('C')], [
      { type: 'continue', from: at(0), to: at(0) }, { type: 'copy', from: at(0), to: at(1) },
    ]);
    expect(raw(edit.after).map(l => l.collapsed)).toEqual([true, true]);
    const h = recordPartitionedEdit(createPartitionedHistory(), edit);
    const u = undoPartitioned(h, setLayerCollapsed(edit.after, at(1), false).state);
    const r = redoPartitioned(u.history, setLayerCollapsed(u.state, at(0), false).state);
    expect(raw(r.state).map(l => l.collapsed)).toEqual([false, false]);
    const oldUndo = undoPartitioned(h, edit.after);
    expect(raw(redoPartitioned(oldUndo.history, oldUndo.state).state).map(l => l.collapsed)).toEqual([true, true]);
  });

  it('same-ID replacement is independent and toggled historical values survive content undo', () => {
    const state = initial([layer('A', { collapsed: 'legacy' })]);
    const replacement = editLayers(state, [layer('A')], [
      { type: 'remove', from: at(0) }, { type: 'create', to: at(0), cell: { present: false } },
    ]);
    expect(Object.hasOwn(raw(replacement.after)[0], 'collapsed')).toBe(false);
    const u = undoPartitioned(recordPartitionedEdit(createPartitionedHistory(), replacement), replacement.after);
    expect(raw(u.state)[0].collapsed).toBe('legacy');
    const edit = contentEdit(state, 'Changed');
    const toggled = setLayerCollapsed(edit.after, at(0), true).state;
    const contentUndo = undoPartitioned(recordPartitionedEdit(createPartitionedHistory(), edit), toggled);
    expect(raw(contentUndo.state)[0].collapsed).toBe(true);
    expect(contentUndo.overlayEffects).toEqual([]);
    expect(contentUndo.state.parts.preferences).toBe(toggled.parts.preferences);
  });

  it('composes groups without intermediate document/wrapper retention and preserves an intermediate copy source', () => {
    const state = initial([layer('A', { collapsed: 'raw' })]);
    const first = editLayers(state, [layersOf(state)[0], layer('C')], [
      { type: 'continue', from: at(0), to: at(0) }, { type: 'copy', from: at(0), to: at(1) },
    ]);
    const toggled = setLayerCollapsed(first.after, at(1), true).state;
    const second = editLayers(toggled, [layersOf(toggled)[0], layer('D')], [
      { type: 'continue', from: at(0), to: at(0) }, { type: 'copy', from: at(1), to: at(1) }, { type: 'remove', from: at(1) },
    ]);
    const h1 = recordPartitionedEdit(createPartitionedHistory(), first, 'drag');
    const h2 = recordPartitionedEdit(h1, second, 'drag');
    expect(containsReference(h2, first.after.parts.document)).toBe(false);
    expect(containsReference(h2, first.before)).toBe(false);
    expect(containsReference(h2, second.after.parts.preferences)).toBe(false);
    const u = undoPartitioned(h2, second.after);
    expect(u.state.parts.document).toBe(state.parts.document);
    const r = redoPartitioned(u.history, u.state);
    expect(raw(r.state).map(l => [l.id, l.collapsed])).toEqual([['A', 'raw'], ['D', true]]);
    expect(undoPartitioned(h1, first.after).state.parts.document).toBe(state.parts.document);
  });

  it('cancel restores pre-gesture redo; finished groups and reused IDs stay separate', () => {
    const state = initial(); const content = contentEdit(state, 'Future');
    const base = undoPartitioned(recordPartitionedEdit(createPartitionedHistory(), content), content.after);
    const gesture = reorder(base.state);
    const h = recordPartitionedEdit(base.history, gesture, 'drag');
    const toggled = setLayerCollapsed(gesture.after, at(1), true).state;
    const cancel = cancelPartitionedGroup(h, toggled, 'drag');
    expect(cancel.state.parts.document).toBe(state.parts.document);
    expect(raw(cancel.state)[0].collapsed).toBe(true);
    expect(redoPartitioned(cancel.history, cancel.state).state.parts.document).toBe(content.after.parts.document);
    expect(() => cancelPartitionedGroup(h, toggled, 'other')).toThrow(/group/i);
    const next = contentEdit(toggled, 'Next');
    const separate = recordPartitionedEdit(finishPartitionedGroup(h, 'drag'), next, 'drag');
    expect(undoPartitioned(separate, next.after).state.parts.document).toBe(toggled.parts.document);
  });

  it('net-zero gesture drops content history and preserves fold actions plus redo', () => {
    const state = initial(); const content = contentEdit(state, 'Future');
    const base = undoPartitioned(recordPartitionedEdit(createPartitionedHistory(), content), content.after);
    const first = reorder(base.state); const toggled = setLayerCollapsed(first.after, at(1), true).state;
    const backEdit = applyDocumentChanges(toggled.parts.document, [{ type: 'put-template', variantId: 'default',
      template: state.parts.document.variants.default.templates['page-0'] }]);
    const back = reconcileLayerFolds(toggled, backEdit, { before: backEdit.before, after: backEdit.after, mappings: [
      { type: 'continue', from: at(0), to: at(1) }, { type: 'continue', from: at(1), to: at(0) },
    ] });
    const h = recordPartitionedEdit(recordPartitionedEdit(base.history, first, 'drag'), back, 'drag');
    expect(raw(back.after)[0].collapsed).toBe(true);
    expect(undoPartitioned(h, back.after).state).toBe(back.after);
    expect(raw(redoPartitioned(h, back.after).state)[0].collapsed).toBe(true);
    expect(containsReference(h, first.after.parts.document)).toBe(false);
  });

  it('bulk replacements keep populations independent, update displaced cells, and preserve current preferences', () => {
    const before = initial([layer('A', { collapsed: 'old' })]);
    const after = initial([layer('A', { collapsed: 'new' })]);
    const h = recordPartitionedReplacement(createPartitionedHistory(), before, after);
    const current = updateLayerFoldPreferences(setLayerCollapsed(after, at(0), true).state, { scale: 3 });
    const u = undoPartitioned(h, current);
    expect(u.replacement).toBe(before.parts.document); expect(u.changes).toEqual([]);
    expect(raw(u.state)[0].collapsed).toBe('old'); expect(u.state.parts.preferences.scale).toBe(3);
    const r = redoPartitioned(u.history, setLayerCollapsed(u.state, at(0), false).state);
    expect(raw(r.state)[0].collapsed).toBe(true);
    expect(raw(undoPartitioned(r.history, r.state).state)[0].collapsed).toBe(false);
    expect(u.state.parts.compatibility.state).toBe(current.parts.compatibility.state);
    expect(containsReference(h, before.parts.preferences)).toBe(false);
  });

  it('rejects stale/invalid edits atomically and preserves no-op identities without clones or unrelated reads', () => {
    const state = initial(); const edit = reorder(state);
    const h = recordPartitionedEdit(createPartitionedHistory(), edit);
    expect(() => undoPartitioned(h, state)).toThrow(/stale/i);
    expect(() => recordPartitionedEdit(h, edit)).toThrow(/stale/i);
    expect(() => recordPartitionedEdit(createPartitionedHistory(), { ...edit,
      correspondence: { ...edit.correspondence, mappings: [] } })).toThrow();
    Object.defineProperty(edit.after.parts.document.variants.default.templates['page-1'], 'layers', { get() { throw Error('unrelated'); } });
    const clone = vi.spyOn(globalThis, 'structuredClone').mockImplementation(() => { throw Error('clone'); });
    try {
      const u = undoPartitioned(h, edit.after);
      expect(u.state.parts.document).toBe(state.parts.document);
      const empty = undoPartitioned(u.history, u.state);
      expect(empty.state).toBe(u.state); expect(empty.history).toBe(u.history);
      expect(empty.changes).toEqual([]); expect(empty.overlayEffects).toEqual([]);
      const noOp = applyDocumentChanges(u.state.parts.document, []);
      const receipt = reconcileLayerFolds(u.state, noOp, { before: noOp.before, after: noOp.after, mappings: [] });
      expect(recordPartitionedEdit(u.history, receipt)).toBe(u.history);
      expect(redoPartitioned(u.history, u.state).state.parts.document).toBe(edit.after.parts.document);
    } finally { clone.mockRestore(); }
  });

  it('trims structural retention and releases redo after new committed edits', () => {
    const displaced = { opaque: 'large raw value' };
    const state = initial([layer('A', { collapsed: displaced }), layer('B')]); const first = deleteA(state);
    let h = recordPartitionedEdit(createPartitionedHistory(1), first);
    expect(containsReference(h, displaced)).toBe(true);
    const second = contentEdit(first.after, 'Second'); h = recordPartitionedEdit(h, second);
    expect(containsReference(h, state.parts.document)).toBe(false);
    expect(containsReference(h, displaced)).toBe(false);
    const u = undoPartitioned(h, second.after);
    const next = contentEdit(u.state, 'Third'); const replaced = recordPartitionedEdit(u.history, next);
    expect(containsReference(replaced, second.after.parts.document)).toBe(false);
    expect(redoPartitioned(replaced, next.after).state).toBe(next.after);
  });

  it('keeps absent activeLayerId absent through history, assembly, and real save admission', () => {
    const original = currentState(); expect(Object.hasOwn(original, 'activeLayerId')).toBe(false);
    const state = createLayerFoldState(partitionState(original));
    const edit = contentEdit(state, 'After');
    const u = undoPartitioned(recordPartitionedEdit(createPartitionedHistory(), edit, undefined, { before: original, after: original }), edit.after);
    const assembled = assembleState(u.state.parts);
    expect(Object.hasOwn(u.selection!, 'activeLayerId')).toBe(false);
    expect(Object.hasOwn(assembled, 'activeLayerId')).toBe(false);
    expect(() => validateWorkspaceProject({ id: 'new-history', name: 'New history', initialState: assembled }, { warningPolicy: 'reject' })).not.toThrow();
  });

  it.each([
    [layer('same', { collapsed: 'raw' }), layer('same')],
    [layer('same', { collapsed: true }), layer('same', { collapsed: false })],
    [layer(7 as unknown as string, { collapsed: undefined }), layer('B')],
  ])('restores exceptional raw cells and own presence across reorder/delete/undo/redo: %j', (first, second) => {
    const state = initial([first, second]); const edited = reorder(state);
    const h = recordPartitionedEdit(createPartitionedHistory(), edited);
    const u = undoPartitioned(h, edited.after);
    expect(raw(u.state)).toEqual(raw(state));
    expect(Object.hasOwn(raw(u.state)[0], 'collapsed')).toBe(Object.hasOwn(first, 'collapsed'));
    const r = redoPartitioned(u.history, u.state);
    expect(raw(r.state)).toEqual(raw(edited.after));
    const removed = deleteA(state);
    const restored = undoPartitioned(recordPartitionedEdit(createPartitionedHistory(), removed), removed.after);
    expect(raw(restored.state)).toEqual(raw(state));
    expect(Object.hasOwn(raw(restored.state)[0], 'collapsed')).toBe(Object.hasOwn(first, 'collapsed'));
  });

  it.each(['default', 'copy-variant'])('copies template populations into %s without sharing their future fold choices', variantId => {
    const state = initial(); const d = state.parts.document; const template = d.variants.default.templates['page-0'];
    const edit = applyDocumentChanges(d, [
      ...(variantId === 'default' ? [] : [{ type: 'put-variant' as const, variant: { id: variantId, name: 'Copy' } }]),
      { type: 'put-template', variantId, template: { ...template, id: 'copy' } },
    ]);
    const dest = (position: number) => ({ variantId, templateId: 'copy', position });
    const receipt = reconcileLayerFolds(state, edit, { before: d, after: edit.after, mappings: [
      { type: 'copy', from: at(0), to: dest(0) }, { type: 'copy', from: at(1), to: dest(1) },
    ] });
    const h = recordPartitionedEdit(createPartitionedHistory(), receipt);
    const toggled = setLayerCollapsed(receipt.after, dest(0), true).state;
    const u = undoPartitioned(h, toggled);
    expect(u.overlayEffects).toEqual([{ variantId, templateId: 'copy', cells: [] }]);
    expect(raw(u.state)[0].collapsed).toBe('legacy');
    const r = redoPartitioned(u.history, setLayerCollapsed(u.state, at(0), false).state);
    const assembled = assembleState(r.state.parts);
    expect(assembled.variants[variantId].templates.copy.layers![0].collapsed).toBe(true);
    expect(assembled.variants.default.templates['page-0'].layers![0].collapsed).toBe(false);
    expect(applyDocumentChanges(u.state.parts.document, r.changes).after).toEqual(r.state.parts.document);
  });

  it('composes a long gesture into one bounded edge and preserves late preferences during cancellation', () => {
    const start = initial(); let current = start; let h = createPartitionedHistory();
    const intermediate: object[] = [];
    for (let i = 0; i < 100; i++) {
      const edit = reorder(current); h = recordPartitionedEdit(h, edit, 'long-drag'); current = edit.after;
      if (i < 99) intermediate.push(current.parts.document);
      if (i === 49) current = setLayerCollapsed(current, at(0), true).state;
    }
    for (const document of intermediate) expect(containsReference(h, document)).toBe(false);
    const cancelled = cancelPartitionedGroup(h, current, 'long-drag');
    expect(cancelled.state.parts.document).toBe(start.parts.document);
    expect(raw(cancelled.state)[0].collapsed).toBe(true);
    expect(undoPartitioned(cancelled.history, cancelled.state).state).toBe(cancelled.state);
  });

  it('composes cross-template continuations and captures a layer deleted later in the gesture', () => {
    const state = initial(); const d = state.parts.document;
    const firstEdit = applyDocumentChanges(d, [
      { type: 'put-template', variantId: 'default', template: { ...d.variants.default.templates['page-0'], layers: [layersOf(state)[1]] } },
      { type: 'put-template', variantId: 'default', template: { ...d.variants.default.templates['page-1'], layers: [layersOf(state)[0]] } },
    ]);
    const first = reconcileLayerFolds(state, firstEdit, { before: d, after: firstEdit.after, mappings: [
      { type: 'continue', from: at(0), to: at(0, 'page-1') }, { type: 'continue', from: at(1), to: at(0) },
      { type: 'remove', from: at(0, 'page-1') },
    ] });
    const toggled = setLayerCollapsed(first.after, at(0, 'page-1'), true).state;
    const deleted = applyDocumentChanges(toggled.parts.document, [{ type: 'delete-template', variantId: 'default', templateId: 'page-1' }]);
    const second = reconcileLayerFolds(toggled, deleted, { before: deleted.before, after: deleted.after,
      mappings: [{ type: 'remove', from: at(0, 'page-1') }] });
    const h = recordPartitionedEdit(recordPartitionedEdit(createPartitionedHistory(), first, 'drag'), second, 'drag');
    const u = undoPartitioned(h, second.after);
    expect(raw(u.state)[0].collapsed).toBe(true);
    expect(Object.hasOwn(raw(u.state)[1], 'collapsed')).toBe(false);
    expect(u.state.parts.document).toBe(d);
    const r = redoPartitioned(u.history, u.state);
    expect(r.overlayEffects).toContainEqual({ variantId: 'default', templateId: 'page-1', cells: [] });
    expect(r.state.parts.document).toBe(second.after.parts.document);
  });

  it('ID rename moves the latest choice while undo restores the original ID and presence', () => {
    const state = initial([layer('__proto__', { collapsed: undefined })]);
    const edit = editLayers(state, [layer('renamed')], [{ type: 'continue', from: at(0), to: at(0) }]);
    const h = recordPartitionedEdit(createPartitionedHistory(), edit);
    const u = undoPartitioned(h, edit.after);
    expect(raw(u.state)[0].id).toBe('__proto__'); expect(Object.hasOwn(raw(u.state)[0], 'collapsed')).toBe(true);
    const r = redoPartitioned(u.history, setLayerCollapsed(u.state, at(0), false).state);
    expect(raw(r.state)[0].id).toBe('renamed'); expect(raw(r.state)[0].collapsed).toBe(false);
    expect(Object.hasOwn(r.state.parts.preferences.layerCollapsed, JSON.stringify(['default', 'page-0', '__proto__']))).toBe(false);
  });

  it('drops transient-only cells from composed groups and releases retained pre-group redo on finish', () => {
    const opaque = { raw: 'unreachable after gesture' }; const state = initial([layer('A')]);
    const created = editLayers(state, [layersOf(state)[0], layer('temporary')], [
      { type: 'continue', from: at(0), to: at(0) }, { type: 'create', to: at(1), cell: { present: true, value: opaque } },
    ]);
    const removed = editLayers(created.after, [layer('A', { name: 'Changed' })], [
      { type: 'continue', from: at(0), to: at(0) }, { type: 'remove', from: at(1) },
    ]);
    const h1 = recordPartitionedEdit(createPartitionedHistory(), created, 'gesture');
    const h2 = recordPartitionedEdit(h1, removed, 'gesture');
    expect(containsReference(h2, opaque)).toBe(false);
    expect(raw(undoPartitioned(h2, removed.after).state)).toEqual(raw(state));
    const base = undoPartitioned(h1, created.after);
    const edit = contentEdit(base.state, 'New content');
    const open = recordPartitionedEdit(base.history, edit, 'another');
    expect(containsReference(open, opaque)).toBe(true);
    const finished = finishPartitionedGroup(open, 'another');
    expect(containsReference(finished, opaque)).toBe(false);
    expect(redoPartitioned(finished, edit.after).state).toBe(edit.after);
  });
});
