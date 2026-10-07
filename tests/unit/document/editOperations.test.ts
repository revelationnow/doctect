// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { makeIncrementalProject } from '../../helpers/incrementalFixtures';
import { partitionState } from '../../../services/document/partition';
import { createEditOperations } from '../../../services/document/editOperations';
import { buildReferenceIndex } from '../../../services/document/references';
import { applyDocumentChanges } from '../../../services/document/applyChanges';
import * as operations from '../../../services/document/editOperations';
import { createLayerFoldState, reconcileLayerFolds, readLayerFoldCell, setLayerCollapsed } from '../../../services/document/layerFolds';
import { createPartitionedHistory, recordPartitionedEdit, undoPartitioned, redoPartitioned } from '../../../services/document/partitionedHistory';

describe('Task 10 semantic adapter prerequisites', () => {
  it('I1 reorder retains raw array cells and complete positional correspondence', () => {
    const initial = makeIncrementalProject().initialState;
    const raw = [1, { untouched: true }];
    initial.variants.default.templates['page-0'].layers = [null, 'raw', raw,
      { id: 'A', order: 0 }, { id: 'B', order: 1 }] as any;
    const document = partitionState(initial).document;
    const address = { variantId: 'default', templateId: 'page-0' };
    const move = operations.prepareLayerEdit(document, address, { type: 'move', position: 3, targetPosition: 4 });
    const after = applyDocumentChanges(document, move.changes).after.variants.default.templates['page-0'];
    expect(after.layers![2]).toBe(raw);
    expect(after.layers!.slice(0, 3)).toEqual([null, 'raw', [1, { untouched: true }]]);
    expect(move.mappings).toEqual([0, 1, 2, 4, 3].map((position, from) => ({ type: 'continue',
      from: { ...address, position: from }, to: { ...address, position } })));
  });
  it('G4 declared delete and create with a reused layer ID have independent fold cells through history receipts', () => {
    const initial = makeIncrementalProject().initialState;
    initial.variants.default.templates['page-0'].layers = [
      { id: 'layer_i', name: 'Old occurrence', order: 0, visible: true, locked: false, collapsed: 'old raw' as any },
      { id: 'keep', name: 'Keep', order: 1, visible: true, locked: false },
    ];
    const address = { variantId: 'default', templateId: 'page-0' };
    const original = createLayerFoldState(partitionState(initial));
    const deletion = operations.prepareLayerEdit(original.parts.document, address, { type: 'delete', position: 0 });
    const deleted = applyDocumentChanges(original.parts.document, deletion.changes);
    const removed = reconcileLayerFolds(original, deleted, { before: deleted.before, after: deleted.after, mappings: deletion.mappings });
    const random = vi.spyOn(Math, 'random').mockReturnValue(.5);
    let addition: ReturnType<typeof operations.prepareLayerEdit>;
    try { addition = operations.prepareLayerEdit(deleted.after, address, { type: 'add' }); } finally { random.mockRestore(); }
    const added = applyDocumentChanges(deleted.after, addition.changes);
    expect(added.after.variants.default.templates['page-0'].layers![1].id).toBe('layer_i');
    const created = reconcileLayerFolds(removed.after, added, { before: added.before, after: added.after, mappings: addition.mappings });
    expect(readLayerFoldCell(created.after, { ...address, position: 1 })).toEqual({ present: false });
    const history = recordPartitionedEdit(recordPartitionedEdit(createPartitionedHistory(), removed), created);
    const undoCreate = undoPartitioned(history, setLayerCollapsed(created.after, { ...address, position: 1 }, false).state);
    const undoDelete = undoPartitioned(undoCreate.history, undoCreate.state);
    expect(readLayerFoldCell(undoDelete.state, { ...address, position: 0 })).toEqual({ present: true, value: 'old raw' });
    const redoDelete = redoPartitioned(undoDelete.history, undoDelete.state);
    const redoCreate = redoPartitioned(redoDelete.history, redoDelete.state);
    expect(redoCreate.correspondence!.mappings).toContainEqual({ type: 'create', to: { ...address, position: 1 }, cell: { present: true, value: false } });
    expect(readLayerFoldCell(reconcileLayerFolds(redoDelete.state, redoCreate.edit!, redoCreate.correspondence!).after, { ...address, position: 1 })).toEqual({ present: true, value: false });
  });
  it('G4 adds and deletes historical numeric occurrences while guarding last string-ID layer', () => {
    const initial = makeIncrementalProject().initialState;
    const layers = [null, 7, { id: 42, name: 'Numeric', order: 1 }, { id: 'valid', name: 'Valid', order: 0 }];
    initial.variants.default.templates['page-0'].layers = layers as any;
    const document = partitionState(initial).document;
    const address = { variantId: 'default', templateId: 'page-0' };
    const addition = operations.prepareLayerEdit(document, address, { type: 'add' });
    const added = applyDocumentChanges(document, addition.changes).after.variants.default.templates['page-0'];
    expect(added.layers!.slice(0, 4)).toEqual(layers);
    expect(addition.mappings.at(-1)).toMatchObject({ type: 'create', to: { position: 4 }, cell: { present: false } });
    const deletion = operations.prepareLayerEdit(document, address, { type: 'delete', position: 2 });
    expect(applyDocumentChanges(document, deletion.changes).after.variants.default.templates['page-0'].layers).toEqual([null, 7, layers[3]]);
    expect(operations.prepareLayerEdit(document, address, { type: 'delete', position: 3 }).changes).toEqual([]);
    expect(layers).toHaveLength(4);
  });

  it('G4 edits layer occurrences atomically without copying display folds or deleting duplicate-linked elements', () => {
    expect(operations).toHaveProperty('prepareLayerEdit');
    const initial = makeIncrementalProject().initialState;
    const template = initial.variants.default.templates['page-0'];
    template.layers = [
      { id: 'same', name: 'First', order: 0, visible: true, locked: false, collapsed: true },
      { id: 'same', name: 'Second', order: 1, visible: true, locked: false },
      { id: 'other', name: 'Other', order: 2, visible: true, locked: false },
    ];
    template.elements[0] = { ...template.elements[0], layerId: 'same' };
    const document = partitionState(initial).document;
    const address = { variantId: 'default', templateId: 'page-0' };
    const deletion = operations.prepareLayerEdit(document, address, { type: 'delete', position: 0 });
    const after = applyDocumentChanges(document, deletion.changes).after.variants.default.templates['page-0'];
    expect(after.layers!.map(layer => layer.name)).toEqual(['Second', 'Other']);
    expect(after.elements).toBe(document.variants.default.templates['page-0'].elements);
    expect(deletion.mappings).toEqual([
      { type: 'remove', from: { ...address, position: 0 } },
      { type: 'continue', from: { ...address, position: 1 }, to: { ...address, position: 0 } },
      { type: 'continue', from: { ...address, position: 2 }, to: { ...address, position: 1 } },
    ]);
    const move = operations.prepareLayerEdit(document, address, { type: 'move', position: 0, targetPosition: 2 });
    expect(move.mappings[0]).toEqual({ type: 'continue', from: { ...address, position: 0 }, to: { ...address, position: 2 } });
    const update = operations.prepareLayerEdit(document, address, { type: 'update', position: 1, patch: { name: 'Renamed' } });
    const updated = applyDocumentChanges(document, update.changes).after.variants.default.templates['page-0'];
    expect(updated.layers![1].name).toBe('Renamed');
    expect(Object.hasOwn(updated.layers![1], 'collapsed')).toBe(false);
  });
  it('G3 emits operation-owned copy/create/remove provenance from one constructor result', () => {
    expect(operations).toHaveProperty('createStructuralEditorOperations');
    const initial = makeIncrementalProject(2).initialState;
    initial.variants.default.templates['page-0'].layers![0].collapsed = true;
    const folds = createLayerFoldState(partitionState(initial));
    const document = folds.parts.document;
    const ops = operations.createStructuralEditorOperations(document, folds.parts.preferences, buildReferenceIndex(document));
    const copy = ops.duplicateTemplates(['page-0', 'page-1']);
    expect(copy.changes).toHaveLength(2);
    const edit = applyDocumentChanges(document, copy.changes);
    const receipt = reconcileLayerFolds(folds, edit, { before: document, after: edit.after, mappings: copy.mappings });
    expect(copy.selectionPatch.selectedTemplateIds).toHaveLength(2);
    const copied = copy.selectionPatch.selectedTemplateIds![0];
    expect(readLayerFoldCell(receipt.after, { variantId: 'default', templateId: copied, position: 0 })).toEqual({ present: true, value: true });
    expect(edit.after.variants.default.templates[copied].elements).toBe(document.variants.default.templates['page-0'].elements);
    const add = ops.addTemplate();
    expect(add.mappings[0]).toMatchObject({ type: 'create', cell: { present: false } });
    expect(() => ops.deleteVariant('default')).toThrow(/last variant/);
  });
  it('uses existing immutable constructors without cloning unrelated payloads', () => {
    const parts = partitionState(makeIncrementalProject().initialState);
    const root = parts.document.nodes.root;
    Object.freeze(root); Object.freeze(root.children); Object.freeze(root.data);
    const ops = createEditOperations(parts.document, parts.preferences, buildReferenceIndex(parts.document));
    const edit = applyDocumentChanges(parts.document, ops.updateNode('root', { title: 'Renamed' }));
    expect(edit.after.variants).toBe(parts.document.variants);
    expect(edit.after.nodes.root.data).toBe(root.data);
    expect(edit.changes).toEqual([{ type: 'put-node', node: edit.after.nodes.root }]);
    expect(edit.affected).toEqual([{ kind: 'node', nodeId: 'root' }]);
  });
});
