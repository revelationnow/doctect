// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { makeIncrementalProject } from '../../helpers/incrementalFixtures';
import { partitionState } from '../../../services/document/partition';
import { applyDocumentChanges } from '../../../services/document/applyChanges';
import {
  createDocumentHistory, recordDocumentEdit, undoDocument, redoDocument,
  finishDocumentGroup, cancelDocumentGroup, recordDocumentReplacement,
  type HistorySelection,
} from '../../../services/document/history';
import type { DocumentState } from '../../../services/document/contracts';

const initial = () => partitionState(makeIncrementalProject().initialState).document;
const rename = (d: DocumentState, title: string) => applyDocumentChanges(d, [
  { type: 'put-node', node: { ...d.nodes.root, title } },
]);
const selection = (): HistorySelection => ({ activeVariantId: 'default', selectedNodeId: 'root',
  selectedNodeIds: ['root'], selectedTemplateId: 'page-0', selectedTemplateIds: ['page-0'], selectedElementIds: [] });

describe('document history', () => {
  it('undoes by reference and emits the old value for the changed record', () => {
    const document = initial();
    const edit = rename(document, 'New');
    const clone = vi.spyOn(globalThis, 'structuredClone').mockImplementation(() => { throw Error('clone'); });
    try {
      const h = recordDocumentEdit(createDocumentHistory(), edit);
      const undo = undoDocument(h, edit.after);
      expect(undo.document).toBe(document);
      expect(undo.changes).toEqual([{ type: 'put-node', node: document.nodes.root }]);
      expect(applyDocumentChanges(edit.after, undo.changes).after).toEqual(document);
      const redo = redoDocument(undo.history, undo.document);
      expect(redo.document).toBe(edit.after);
      expect(redo.changes).toEqual(edit.changes);
    } finally { clone.mockRestore(); }
  });

  it('inverts node and variant membership with parent-first puts and child-first deletes', () => {
    const d = initial();
    const template = { ...d.variants.default.templates['page-0'], id: 'new-page' };
    const edit = applyDocumentChanges(d, [
      { type: 'put-node', node: { ...d.nodes.root, id: 'new-node' } },
      { type: 'put-variant', variant: { id: 'new', name: 'New' } },
      { type: 'put-template', variantId: 'new', template },
    ]);
    const u = undoDocument(recordDocumentEdit(createDocumentHistory(), edit), edit.after);
    expect(u.changes.map(c => c.type)).toEqual(['delete-node', 'delete-template', 'delete-variant']);
    expect(applyDocumentChanges(edit.after, u.changes).after).toEqual(d);
    const r = redoDocument(u.history, d);
    expect(r.changes[0].type).toBe('put-variant');
    expect(applyDocumentChanges(d, r.changes).after).toEqual(edit.after);
    const deleted = applyDocumentChanges(edit.after, [{ type: 'delete-variant', variantId: 'new' }]);
    const restored = undoDocument(recordDocumentEdit(createDocumentHistory(), deleted), deleted.after);
    expect(applyDocumentChanges(deleted.after, restored.changes).after).toEqual(edit.after);
  });

  it('restores variant metadata and generator absence without reading untouched templates', () => {
    const d = initial();
    delete d.generator;
    Object.defineProperty(d.variants.default.templates['page-1'], 'layers', { get() { throw Error('unrelated layers'); } });
    const generator = { formatVersion: 1 as const, templateScript: 'templates', hierarchyScript: 'hierarchy', generatedAt: '2026-09-14' };
    const edit = applyDocumentChanges(d, [
      { type: 'put-variant', variant: { id: 'default', name: 'Renamed' } },
      { type: 'set-generator', generator },
    ]);
    const u = undoDocument(recordDocumentEdit(createDocumentHistory(), edit), edit.after);
    expect(u.document).toBe(d);
    expect(u.changes).toContainEqual({ type: 'set-generator', generator: undefined });
    expect(Object.hasOwn(u.document, 'generator')).toBe(false);
    expect(redoDocument(u.history, d).document.generator).toBe(generator);
  });

  it('groups affected addresses and selection, closes/reuses IDs, and keeps earlier histories immutable', () => {
    const d = initial(); const first = rename(d, 'First'); const second = rename(first.after, 'Second');
    const before = selection(); const after = { ...selection(), selectedElementIds: ['invalid'] };
    const h1 = recordDocumentEdit(createDocumentHistory(), first, 'drag', { before, after: before });
    const h2 = recordDocumentEdit(h1, second, 'drag', { before, after });
    before.selectedNodeIds.push('later mutation');
    const u = undoDocument(h2, second.after);
    expect(u.document).toBe(d);
    expect(u.selection?.selectedNodeIds).toEqual(['root']);
    expect(redoDocument(u.history, d).selection?.selectedElementIds).toEqual([]);
    expect(undoDocument(h1, first.after).document).toBe(d);
    const third = rename(second.after, 'Third');
    const h3 = recordDocumentEdit(finishDocumentGroup(h2, 'drag'), third, 'drag');
    expect(undoDocument(h3, third.after).document).toBe(second.after);
  });

  it('preserves redo through navigation, cancellation, and net-zero gestures', () => {
    const d = initial(); const first = rename(d, 'First');
    const undone = undoDocument(recordDocumentEdit(createDocumentHistory(), first), first.after);
    const noOp = applyDocumentChanges(d, []);
    expect(recordDocumentEdit(undone.history, noOp, undefined, { before: selection(), after: selection() })).toBe(undone.history);
    const gesture = rename(d, 'Drag');
    const h = recordDocumentEdit(undone.history, gesture, 'drag');
    const cancelled = cancelDocumentGroup(h, gesture.after, 'drag');
    expect(cancelled.document).toBe(d);
    expect(redoDocument(cancelled.history, d).document).toBe(first.after);
    const back = applyDocumentChanges(gesture.after, [{ type: 'put-node', node: d.nodes.root }]);
    const zero = recordDocumentEdit(h, back, 'drag');
    expect(redoDocument(zero, back.after).document).toBe(first.after);
    expect(() => cancelDocumentGroup(h, gesture.after, 'wrong')).toThrow(/group/i);
    expect(() => cancelDocumentGroup(h, d, 'drag')).toThrow(/stale/i);
    const committed = recordDocumentEdit(undone.history, gesture);
    expect(redoDocument(committed, gesture.after).document).toBe(gesture.after);
  });

  it('restores bulk/schema replacements explicitly, never as ordinary effects', () => {
    const d = initial(); const after = { ...initial(), schemaVersion: (d.schemaVersion ?? 0) + 1 };
    const u = undoDocument(recordDocumentReplacement(createDocumentHistory(), d, after), after);
    expect(u.document).toBe(d); expect(u.replacement).toBe(d); expect(u.changes).toEqual([]);
    expect(redoDocument(u.history, d).replacement).toBe(after);
  });

  it('resolves stale selection IDs while preserving optional own absence', () => {
    const d = initial(); const edit = rename(d, 'New');
    const stale = { ...selection(), activeVariantId: 'gone', selectedNodeId: 'gone', selectedTemplateId: 'gone',
      selectedNodeIds: ['gone', 'root'], selectedTemplateIds: ['gone', 'page-0'], selectedElementIds: ['gone'] };
    const u = undoDocument(recordDocumentEdit(createDocumentHistory(), edit, undefined, { before: stale, after: stale }), edit.after);
    expect(u.selection).toEqual(selection());
    expect(Object.hasOwn(u.selection!, 'activeLayerId')).toBe(false);
    const present = { ...stale, activeLayerId: 'gone' };
    const u2 = undoDocument(recordDocumentEdit(createDocumentHistory(), edit, undefined, { before: present, after: present }), edit.after);
    expect(u2.selection?.activeLayerId).toBe('content');
  });

  it('returns template-context candidates, not hierarchy UI selection, on undo, redo, cancel and bulk restoration', () => {
    const d = initial(); d.nodes.root.type = 'page-1';
    for (const [id, prefix] of [['page-0', 'template'], ['page-1', 'hierarchy']]) {
      const template = d.variants.default.templates[id];
      template.elements = [{ ...template.elements[0], id: `${prefix}-element` }];
      template.layers = [{ ...template.layers![0], id: `${prefix}-layer` }];
    }
    const selected = { ...selection(), selectedElementIds: ['template-element', 'hierarchy-element'], activeLayerId: 'hierarchy-layer' };
    const expected = { ...selected, selectedElementIds: ['template-element'], activeLayerId: 'template-layer' };
    const edit = rename(d, 'Changed'); const pair = { before: selected, after: selected };
    const h = recordDocumentEdit(createDocumentHistory(), edit, 'drag', pair);
    const u = undoDocument(h, edit.after);
    expect(u.selection).toEqual(expected);
    expect(redoDocument(u.history, u.document).selection).toEqual(expected);
    expect(cancelDocumentGroup(h, edit.after, 'drag').selection).toEqual(expected);
    const bulk = undoDocument(recordDocumentReplacement(createDocumentHistory(), d, edit.after, pair), edit.after);
    expect(bulk.selection).toEqual(expected);
    expect(redoDocument(bulk.history, bulk.document).selection).toEqual(expected);
    delete selected.activeLayerId;
    const absent = undoDocument(recordDocumentEdit(createDocumentHistory(), edit, undefined,
      { before: selected, after: selected }), edit.after);
    expect(Object.hasOwn(absent.selection!, 'activeLayerId')).toBe(false);
    expect(selected.selectedElementIds).toEqual(['template-element', 'hierarchy-element']);
  });

  it('enforces limit 50, rejects stale references, and shares frozen old records', () => {
    for (const limit of [0, 51, 1.5, NaN, Infinity]) expect(() => createDocumentHistory(limit)).toThrow(/limit/i);
    const d = initial(); Object.freeze(d.nodes.root); Object.freeze(d.nodes); Object.freeze(d);
    let current = d; let history = createDocumentHistory(); const docs = [d];
    for (let i = 0; i < 52; i++) { const edit = rename(current, `${i}`); history = recordDocumentEdit(history, edit); current = edit.after; docs.push(current); }
    expect(() => undoDocument(history, { ...current })).toThrow(/stale/i);
    expect(() => recordDocumentEdit(history, rename(d, 'stale'))).toThrow(/stale/i);
    for (let i = 0; i < 50; i++) { const r = undoDocument(history, current); history = r.history; current = r.document; }
    expect(current).toBe(docs[2]);
    expect(undoDocument(history, current).history).toBe(history);
    expect(d.nodes.root.title).not.toBe('51');
  });

  it('closes an open gesture even when traversal has no redo edge', () => {
    const d = initial(); const edit = rename(d, 'Drag');
    const h = recordDocumentEdit(createDocumentHistory(), edit, 'drag');
    const r = redoDocument(h, edit.after);
    expect(r.document).toBe(edit.after); expect(r.changes).toEqual([]);
    expect(() => cancelDocumentGroup(r.history, r.document, 'drag')).toThrow(/group/i);
    const next = rename(r.document, 'Next');
    expect(undoDocument(recordDocumentEdit(r.history, next, 'drag'), next.after).document).toBe(edit.after);
  });

  it('unions record addresses by logical address, independent of property insertion order', () => {
    const d = initial(); const first = rename(d, 'First'); const second = rename(first.after, 'Second');
    const h = recordDocumentEdit(recordDocumentEdit(createDocumentHistory(), first, 'drag'),
      { ...second, affected: [{ nodeId: 'root', kind: 'node' }] }, 'drag');
    expect(undoDocument(h, second.after).changes).toEqual([{ type: 'put-node', node: d.nodes.root }]);
  });

  it('restores root changes and filters records restored within a multi-address gesture', () => {
    const d = initial(); const generator = { ...d.generator!, templateScript: 'new script' };
    const first = applyDocumentChanges(d, [
      { type: 'put-node', node: { ...d.nodes.root, id: 'other-root' } }, { type: 'set-root', rootId: 'other-root' },
      { type: 'set-generator', generator },
    ]);
    const second = applyDocumentChanges(first.after, [{ type: 'set-generator', generator: d.generator }]);
    const h = recordDocumentEdit(recordDocumentEdit(createDocumentHistory(), first, 'gesture'), second, 'gesture');
    const u = undoDocument(h, second.after);
    expect(u.changes).toEqual([{ type: 'delete-node', nodeId: 'other-root' }, { type: 'set-root', rootId: 'root' }]);
    expect(applyDocumentChanges(second.after, u.changes).after).toEqual(d);
    expect(applyDocumentChanges(d, redoDocument(u.history, d).changes).after).toEqual(second.after);
  });

  it('keeps delete/recreate gestures, different group boundaries, and schema replacement explicit', () => {
    const d = initial(); const template = d.variants.default.templates['page-1'];
    const deleted = applyDocumentChanges(d, [{ type: 'delete-template', variantId: 'default', templateId: template.id }]);
    const recreated = applyDocumentChanges(deleted.after, [{ type: 'put-template', variantId: 'default', template: { ...template, name: 'New identity' } }]);
    const grouped = recordDocumentEdit(recordDocumentEdit(createDocumentHistory(), deleted, 'one'), recreated, 'one');
    expect(undoDocument(grouped, recreated.after).changes).toEqual([{ type: 'put-template', variantId: 'default', template }]);
    const separate = recordDocumentEdit(recordDocumentEdit(createDocumentHistory(), deleted, 'one'), recreated, 'two');
    expect(undoDocument(separate, recreated.after).document).toBe(deleted.after);
    expect(() => recordDocumentEdit(createDocumentHistory(), { before: d, after: { ...d, schemaVersion: 100 }, affected: [], changes: [] })).toThrow(/replacement/i);
  });
});
