import { describe, expect, it } from 'vitest';
import type { AppNode, PageTemplate } from '../../../types';
import type { DocumentChange, DocumentState } from '../../../services/document/contracts';
import { applyDocumentChanges } from '../../../services/document/applyChanges';
import { createEditOperations } from '../../../services/document/editOperations';
import { buildReferenceIndex } from '../../../services/document/references';
import { partitionState } from '../../../services/document/partition';
import { reflowTemplates } from '../../../services/reflow';
import { makeIncrementalProject } from '../../helpers/incrementalFixtures';

function operations(document: DocumentState) {
  return createEditOperations(document, {
    activeVariantId: 'default', selectedNodeId: 'root', selectedTemplateId: 'page-0',
    viewMode: 'templates', selectedElementIds: [], clipboard: [],
  }, buildReferenceIndex(document));
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
}
const fixture = () => freeze(partitionState(makeIncrementalProject(2).initialState).document);
const templateAddress = (templateId = 'page-0', variantId = 'default') => ({ kind: 'template', variantId, templateId });
const node = (id: string, overrides: Partial<AppNode> = {}): AppNode => ({
  id, parentId: 'root', type: 'page-0', title: id, data: {}, children: [], ...overrides,
});

describe('applyDocumentChanges', () => {
  it('reuses unrelated templates and records only the changed address', () => {
    const document = fixture();
    const [first, second] = Object.values(document.variants.default.templates);
    const edit = applyDocumentChanges(document, [{ type: 'put-template', variantId: 'default', template: { ...first, name: 'Edited' } }]);
    expect(edit.before).toBe(document);
    expect(edit.after.variants.default.templates[second.id]).toBe(second);
    expect(edit.after.nodes).toBe(document.nodes);
    expect(edit.affected).toEqual([templateAddress(first.id)]);
    expect(document.variants.default.templates[first.id].name).toBe(first.name);
  });

  it('copies node ancestors only and preserves unknown nested fields', () => {
    const document = fixture();
    const extension = freeze({ future: ['keep'] });
    const updated = { ...document.nodes.root, extension, title: 'Changed' };
    const edit = applyDocumentChanges(document, [{ type: 'put-node', node: updated }]);
    expect(edit.after.nodes.root).toBe(updated);
    expect(edit.after.variants).toBe(document.variants);
    expect((edit.after.nodes.root as typeof updated).extension).toBe(extension);
    expect(edit.affected).toEqual([{ kind: 'node', nodeId: 'root' }]);
  });

  it('returns original document and no effects for reference-identical or absent deletes', () => {
    const document = fixture();
    const edit = applyDocumentChanges(document, [
      { type: 'put-node', node: document.nodes.root },
      { type: 'put-template', variantId: 'default', template: document.variants.default.templates['page-0'] },
      { type: 'delete-node', nodeId: 'missing' },
      { type: 'delete-template', variantId: 'missing', templateId: 'missing' },
      { type: 'delete-variant', variantId: 'missing' },
      { type: 'set-root', rootId: document.rootId },
      { type: 'set-generator', generator: document.generator },
    ]);
    expect(edit.after).toBe(document);
    expect(edit.affected).toEqual([]);
    expect(edit.changes).toEqual([]);
  });

  it('coalesces repeated puts, add/delete and reference restoration without deep equality', () => {
    const document = fixture();
    const edit = applyDocumentChanges(document, [
      { type: 'put-node', node: node('temporary') }, { type: 'delete-node', nodeId: 'temporary' },
      { type: 'put-node', node: { ...document.nodes.root, title: 'intermediate' } },
      { type: 'put-node', node: document.nodes.root },
    ]);
    expect(edit.after).toBe(document);
    expect(edit.changes).toEqual([]);
    const final = { ...document.nodes.root, title: 'last' };
    const changed = applyDocumentChanges(document, [
      { type: 'put-node', node: { ...final, title: 'first' } }, { type: 'put-node', node: final },
    ]);
    expect(changed.changes).toEqual([{ type: 'put-node', node: final }]);
    expect(changed.affected).toEqual([{ kind: 'node', nodeId: 'root' }]);
    expect(applyDocumentChanges(document, [{ type: 'put-node', node: { ...document.nodes.root } }]).after).not.toBe(document);
  });

  it('applies root deletion/recreation and root replacement atomically', () => {
    const document = fixture();
    expect(applyDocumentChanges(document, [
      { type: 'delete-node', nodeId: 'root' }, { type: 'put-node', node: document.nodes.root },
    ]).after).toBe(document);
    const edit = applyDocumentChanges(document, [
      { type: 'delete-node', nodeId: 'root' }, { type: 'set-root', rootId: 'new' },
      { type: 'put-node', node: node('new', { parentId: null }) },
    ]);
    expect(edit.after.rootId).toBe('new');
    expect(edit.affected).toEqual([{ kind: 'node', nodeId: 'root' }, { kind: 'root' }, { kind: 'node', nodeId: 'new' }]);
    expect(() => applyDocumentChanges(document, [{ type: 'delete-node', nodeId: 'root' }])).toThrow(/root/i);
    expect(document.nodes.root).toBeDefined();
  });

  it('expands variant deletion into exact template effects and allows replacement in one batch', () => {
    const document = fixture();
    const edit = applyDocumentChanges(document, [
      { type: 'delete-variant', variantId: 'default' },
      { type: 'put-variant', variant: { id: 'default', name: 'Replacement', extension: 42 } as any },
      { type: 'put-template', variantId: 'default', template: document.variants.default.templates['page-0'] },
    ]);
    expect(edit.after.variants.default.templates).toEqual({ 'page-0': document.variants.default.templates['page-0'] });
    expect(edit.affected).toEqual([{ kind: 'variant', variantId: 'default' }, templateAddress('page-1')]);
    expect((edit.after.variants.default as any).extension).toBe(42);
    expect(applyDocumentChanges(document, edit.changes).after).toEqual(edit.after);
    const removed = applyDocumentChanges(document, [
      { type: 'put-variant', variant: { id: 'other', name: 'Other' } },
      { type: 'delete-variant', variantId: 'default' },
    ]);
    expect(removed.affected).toEqual([
      { kind: 'variant', variantId: 'other' }, { kind: 'variant', variantId: 'default' },
      templateAddress('page-0'), templateAddress('page-1'),
    ]);
    expect(applyDocumentChanges(document, removed.changes).after).toEqual(removed.after);
  });

  it('renames variant metadata without replacing its templates or extensions', () => {
    const document = fixture();
    const edit = applyDocumentChanges(document, operations(document).renameVariant('default', 'Renamed'));
    expect(edit.after.variants.default.templates).toBe(document.variants.default.templates);
    expect(edit.affected).toEqual([{ kind: 'variant', variantId: 'default' }]);
    expect(applyDocumentChanges(document, operations(document).renameVariant('default', document.variants.default.name)).after).toBe(document);
  });

  it('removes generator own property and shares everything else', () => {
    const document = freeze({ ...fixture(), generator: { formatVersion: 1 as const, templateScript: 't', hierarchyScript: 'h', generatedAt: 'now' } });
    const edit = applyDocumentChanges(document, [{ type: 'set-generator', generator: undefined }]);
    expect(Object.hasOwn(edit.after, 'generator')).toBe(false);
    expect(edit.after.nodes).toBe(document.nodes);
    expect(edit.after.variants).toBe(document.variants);
    expect(edit.affected).toEqual([{ kind: 'generator' }]);
  });

  it.each([
    { type: 'put-node', node: { id: 4 } }, { type: 'delete-node', nodeId: null },
    { type: 'put-template', variantId: 1, template: { id: 't' } },
    { type: 'put-template', variantId: 'default', template: { id: null } },
    { type: 'put-variant', variant: { id: 'x', name: 'x', templates: {} } },
    { type: 'delete-variant', variantId: undefined }, { type: 'set-root', rootId: 3 },
    { type: 'replace-state', state: {} },
  ])('rejects malformed identity before touching payload: %j', bad => {
    const document = fixture();
    const payload = { id: 'x', get title(): string { throw new Error('payload traversed'); } } as AppNode;
    expect(() => applyDocumentChanges(document, [{ type: 'put-node', node: payload }, bad as DocumentChange])).toThrow(/change|identity|templates/i);
    expect(document.nodes.x).toBeUndefined();
  });

  it('uses own keys, including historically valid empty and prototype-looking IDs', () => {
    const document = fixture();
    const edit = applyDocumentChanges(document, ['__proto__', 'constructor', ''].map(id => ({ type: 'put-node', node: node(id) })));
    for (const id of ['__proto__', 'constructor', '']) expect(Object.hasOwn(edit.after.nodes, id)).toBe(true);
    expect(Object.getPrototypeOf(edit.after.nodes)).toBe(Object.prototype);
  });

  it.each([
    { type: 'put-node', node: Object.assign([], { id: 'bad' }) },
    { type: 'put-node', node: Object.create({ id: 'bad' }) },
    { type: 'put-template', variantId: 'default', template: Object.defineProperty({}, 'id', { value: 'bad' }) },
    { type: 'delete-node', get nodeId() { throw new Error('identity getter executed'); } },
  ])('rejects non-record and non-own-data identities', change => {
    expect(() => applyDocumentChanges(fixture(), [change as DocumentChange])).toThrow(/Invalid change identity/);
  });

  it('keeps variant deletion expansion bounded to one template-map enumeration', () => {
    const base = fixture();
    let enumerations = 0;
    const templates = new Proxy(base.variants.default.templates, { ownKeys(target) {
      enumerations++;
      return Reflect.ownKeys(target);
    } });
    const document = { ...base, variants: { ...base.variants, default: { ...base.variants.default, templates } } };
    const edit = applyDocumentChanges(document, [
      { type: 'put-variant', variant: { id: 'other', name: 'Other' } },
      { type: 'delete-variant', variantId: 'default' },
    ]);
    expect(enumerations).toBe(1);
    expect(edit.affected.filter(a => a.kind === 'template')).toHaveLength(2);
  });

  it('handles new variant/template add-delete-recreate order and missing final ownership', () => {
    const document = fixture();
    const template = document.variants.default.templates['page-0'];
    const edit = applyDocumentChanges(document, [
      { type: 'put-template', variantId: 'new', template },
      { type: 'put-variant', variant: { id: 'new', name: 'New' } },
      { type: 'delete-variant', variantId: 'new' },
      { type: 'put-variant', variant: { id: 'new', name: 'Recreated' } },
    ]);
    expect(edit.after.variants.new.templates).toEqual({});
    expect(edit.affected).toEqual([{ kind: 'variant', variantId: 'new' }]);
    expect(applyDocumentChanges(document, edit.changes).after).toEqual(edit.after);
    expect(() => applyDocumentChanges(document, [{ type: 'put-template', variantId: 'missing', template }])).toThrow(/variant/);
    expect(() => applyDocumentChanges(document, [{ type: 'delete-variant', variantId: 'default' }])).toThrow(/variant/);
  });

  it('removes present-undefined generator but keeps absent removal a no-op', () => {
    const { generator: _generator, ...without } = fixture();
    expect(applyDocumentChanges(without, [{ type: 'set-generator', generator: undefined }]).after).toBe(without);
    const edit = applyDocumentChanges({ ...without, generator: undefined }, [{ type: 'set-generator', generator: undefined }]);
    expect(edit.affected).toEqual([{ kind: 'generator' }]);
    expect(Object.hasOwn(edit.after, 'generator')).toBe(false);
  });

  it('permits unresolved historical relations and templates missing from variants', () => {
    const document = fixture();
    const edit = applyDocumentChanges(document, [
      { type: 'put-node', node: node('unresolved', { parentId: 'absent', type: 'absent', referenceId: 'absent', children: ['absent'] }) },
      { type: 'delete-template', variantId: 'default', templateId: 'page-0' },
    ]);
    expect(edit.after.nodes.unresolved.referenceId).toBe('absent');
    expect(edit.after.variants.default.templates['page-0']).toBeUndefined();
  });
});

describe('semantic constructors (not connected to the editor yet)', () => {
  it('routes hierarchy element changes through the selected node type, not selectedTemplateId', () => {
    const base = fixture();
    const extension = { present: undefined, nested: ['keep'] };
    const element = { id: 'e', type: 'rect', x: 10, y: 20, w: 30, h: 40, rotation: 0,
      fill: '#fff', stroke: '#000', strokeWidth: 2, opacity: 1, extension } as const;
    const document = freeze({ ...base,
      nodes: { ...base.nodes, root: { ...base.nodes.root, type: 'page-1' } },
      variants: { default: { ...base.variants.default, templates: {
        'page-0': { ...base.variants.default.templates['page-0'], elements: [{ ...element, x: 1 }] },
        'page-1': { ...base.variants.default.templates['page-1'], elements: [element], extension },
      } } },
    });
    const selected = document.variants.default.templates['page-1'];
    const ops = createEditOperations(document, {
      activeVariantId: 'default', viewMode: 'hierarchy', selectedNodeId: 'root', selectedTemplateId: 'page-0',
    }, buildReferenceIndex(document));
    const replacement = freeze([{ ...element, x: 99 }]);
    for (const [changes, expected] of [
      [ops.updateTemplateElements(replacement, false), replacement],
      [ops.updateElement('e', { x: 42 }), [{ ...element, x: 42 }]],
      [ops.deleteElements(['e']), []],
    ] as const) {
      const edit = applyDocumentChanges(document, changes);
      const template = edit.after.variants.default.templates['page-1'];
      expect(edit.affected).toEqual([templateAddress('page-1')]);
      expect(template.elements).toEqual(expected);
      for (const updated of template.elements) expect((updated as typeof element).extension).toBe(extension);
      expect((template as typeof selected).extension).toBe(extension);
      expect(template.layers).toBe(selected.layers);
      expect(edit.after.variants.default.templates['page-0']).toBe(document.variants.default.templates['page-0']);
      expect(edit.after.nodes).toBe(document.nodes);
    }
    expect(selected.elements[0]).toBe(element);
    expect(element.x).toBe(10);
  });

  it.each([
    { rotation: 90, geometry: { x: 5, y: 80, w: 90, h: 80, fontSize: 25, strokeWidth: 5, borderRadius: 10 },
      spacing: [16, 24, 16, 20], weight: [4, 6, 4, 5] },
    { rotation: 45, geometry: { x: 11.76, y: 69.01, w: 76.49, h: 101.98, fontSize: 25.5, strokeWidth: 5.1, borderRadius: 10.2 },
      spacing: [20.4, 20.4, 20.4, 20.4], weight: [5.1, 5.1, 5.1, 5.1] },
  ])('matches legacy nonuniform reflow at $rotation degrees with font, pattern and grid scaling', ({ rotation, geometry, spacing, weight }) => {
    const base = fixture();
    const extension = { present: undefined, nested: { artwork: '<svg />' } };
    const traversalPath = [{ sliceStart: 1, sliceCount: 2 }];
    const elements = (['lines-h', 'lines-v', 'dots', 'lines-d'] as const).map((patternType, i) => ({
      id: `grid-${i}`, type: 'grid' as const, x: 10, y: 20, w: 30, h: 40, rotation,
      fill: '#fff', stroke: '#000', opacity: 1, fontSize: 10, strokeWidth: 2, borderRadius: 4,
      patternType, patternSpacing: 8, patternWeight: 2, extension,
      gridConfig: { cols: 3, gapX: 4, gapY: 6, sourceType: 'specific' as const, sourceId: 'root',
        displayField: 'title', traversalPath, extension },
    }));
    const document = freeze({ ...base, variants: { default: { ...base.variants.default, templates: {
      ...base.variants.default.templates,
      'page-0': { ...base.variants.default.templates['page-0'], width: 100, height: 200, elements, extension },
    } } } });
    const source = document.variants.default.templates['page-0'];
    // Independent full-template legacy call is a bounded test oracle, not the
    // constructor's geometry projection. Concrete values also reject a no-op.
    const oracle = reflowTemplates({ source }, 200, 600, true, true).source;
    const edit = applyDocumentChanges(document, operations(document).updateTemplate('page-0', { width: 200, height: 600 }, true, true));
    const template = edit.after.variants.default.templates['page-0'];
    expect(template).toMatchObject({ width: 200, height: 600 });
    expect(template.elements).toHaveLength(4);
    template.elements.forEach((element, i) => {
      expect(element).toMatchObject(oracle.elements[i]);
      expect(element).toMatchObject({ ...geometry, rotation, patternSpacing: spacing[i], patternWeight: weight[i],
        gridConfig: { gapX: 8, gapY: 18 } });
      expect((element as typeof elements[number]).extension).toBe(extension);
      expect(element.gridConfig).toEqual({ ...elements[i].gridConfig, gapX: 8, gapY: 18 });
      expect((element.gridConfig as typeof elements[number]['gridConfig']).extension).toBe(extension);
      expect(element.gridConfig!.traversalPath).toBe(traversalPath);
      expect(elements[i]).toMatchObject({ x: 10, y: 20, w: 30, h: 40, fontSize: 10, patternSpacing: 8,
        gridConfig: { gapX: 4, gapY: 6 } });
    });
    expect((template as typeof source).extension).toBe(extension);
    expect(template.layers).toBe(source.layers);
    expect(edit.after.variants.default.templates['page-1']).toBe(base.variants.default.templates['page-1']);
    expect(edit.after.nodes).toBe(document.nodes);
    expect(edit.affected).toEqual([templateAddress()]);
    expect(source).toMatchObject({ width: 100, height: 200 });
    expect(source.elements).toBe(elements);
  });

  it('reflows only edited template geometry while preserving layers and opaque extensions', () => {
    const base = fixture();
    const old = base.variants.default.templates['page-0'];
    const extension = { nested: { present: undefined } };
    const element = { id: 'e', type: 'rect', x: 10, y: 20, w: 30, h: 40, rotation: 0,
      strokeWidth: 2, extension } as any;
    const document = freeze({ ...base, variants: { default: { ...base.variants.default, templates: {
      ...base.variants.default.templates, 'page-0': { ...old, width: 100, height: 200, elements: [element], extension },
    } } } });
    const edit = applyDocumentChanges(document, operations(document).updateTemplate('page-0', { width: 200, height: 400 }, true, false));
    const template = edit.after.variants.default.templates['page-0'];
    expect(template.elements[0]).toMatchObject({ x: 20, y: 40, w: 60, h: 80, strokeWidth: 2 });
    expect((template.elements[0] as any).extension).toBe(extension);
    expect((template as any).extension).toBe(extension);
    expect(template.layers).toBe(old.layers);
    expect(edit.after.variants.default.templates['page-1']).toBe(base.variants.default.templates['page-1']);
  });

  it('duplicates and pastes elements using existing selection, layer and offset semantics', () => {
    const base = fixture();
    const document = applyDocumentChanges(base, operations(base).updateTemplateElements([
      { id: 'e', type: 'rect', x: 1, y: 2, w: 3, h: 4, layerId: 'missing', extension: { preserved: true } },
    ] as any)).after;
    const source = document.variants.default.templates['page-0'].elements[0];
    const ops = createEditOperations(document, { activeVariantId: 'default', viewMode: 'templates', selectedTemplateId: 'page-0',
      selectedElementIds: ['e'], clipboard: [source] }, buildReferenceIndex(document));
    for (const changes of [ops.duplicate(), ops.paste()]) {
      const elements = applyDocumentChanges(document, changes).after.variants.default.templates['page-0'].elements;
      expect(elements).toHaveLength(2);
      expect(elements[0]).toBe(source);
      expect(elements[1]).toMatchObject({ x: 21, y: 22, layerId: document.variants.default.templates['page-0'].layers![0].id, zIndex: 1 });
      expect((elements[1] as any).extension).toBe((source as any).extension);
    }
  });

  it('updates node/template/element properties with existing arguments and no shared mutation', () => {
    const document = fixture();
    const ops = operations(document);
    expect(applyDocumentChanges(document, ops.updateNode('root', { title: 'Changed' })).after.nodes.root.title).toBe('Changed');
    expect(applyDocumentChanges(document, ops.updateTemplate('page-0', { name: 'Changed' })).after.variants.default.templates['page-0'].name).toBe('Changed');
    const elements = [ { id: 'e', type: 'rect', x: 1, y: 2, w: 3, h: 4 } ] as PageTemplate['elements'];
    const withElements = applyDocumentChanges(document, ops.updateTemplateElements(elements, false)).after;
    const updated = applyDocumentChanges(withElements, operations(withElements).updateElement('e', { x: 9 })).after;
    expect(updated.variants.default.templates['page-0'].elements[0].x).toBe(9);
    expect(elements[0].x).toBe(1);
    expect(applyDocumentChanges(updated, operations(updated).deleteElements(['e'])).after.variants.default.templates['page-0'].elements).toEqual([]);
    expect(() => ops.updateNode('root', { id: 'other' })).toThrow(/identity/i);
    expect(() => ops.updateTemplate('page-0', { id: 'other' })).toThrow(/identity/i);
  });

  it('adds nodes and references with complete parent updates', () => {
    const document = fixture();
    const added = applyDocumentChanges(document, operations(document).addNode('root'));
    const id = added.after.nodes.root.children.at(-1)!;
    expect(added.after.nodes[id]).toMatchObject({ parentId: 'root', title: 'New Page', type: 'page-0' });
    const ref = applyDocumentChanges(added.after, operations(added.after).createReference(id));
    expect(Object.values(ref.after.nodes).find(n => n.referenceId === id)?.parentId).toBe('root');
    expect(document.nodes.root.children).toEqual([]);
  });

  it('duplicates subtrees once per edge without mutating original parent or children', () => {
    const base = fixture();
    const document = freeze({ ...base, nodes: {
      ...base.nodes, root: { ...base.nodes.root, children: ['a'] },
      a: node('a', { children: ['b'] }), b: node('b', { parentId: 'a' }),
    } });
    const edit = applyDocumentChanges(document, operations(document).duplicateNodes(['a']));
    const copyId = edit.after.nodes.root.children[1];
    const copy = edit.after.nodes[copyId];
    expect(copy.children).toHaveLength(1);
    expect(edit.after.nodes[copy.children[0]].parentId).toBe(copyId);
    expect(copy.data).toBe(document.nodes.a.data);
    expect(edit.after.nodes.a).toBe(document.nodes.a);
    expect(() => operations(document).duplicateNodes(['root'])).toThrow(/root/i);
  });

  it('constructs template and variant add, duplicate, rename, delete changes', () => {
    const document = fixture();
    const ops = operations(document);
    const added = applyDocumentChanges(document, ops.addTemplate());
    expect(Object.keys(added.after.variants.default.templates)).toHaveLength(3);
    const copied = applyDocumentChanges(document, ops.duplicateTemplates(['page-0']));
    const copy = Object.values(copied.after.variants.default.templates).find(t => t.name.endsWith('(Copy)'))!;
    expect(copy.elements).toBe(document.variants.default.templates['page-0'].elements);
    expect(copy.layers).toBe(document.variants.default.templates['page-0'].layers);
    const variantCopy = applyDocumentChanges(document, ops.duplicateVariant('default'));
    expect(Object.keys(variantCopy.after.variants)).toHaveLength(2);
    expect(applyDocumentChanges(variantCopy.after, operations(variantCopy.after).deleteVariant('default')).after.variants.default).toBeUndefined();
    expect(() => ops.deleteVariant('default')).toThrow(/last/i);
    expect(() => ops.deleteTemplates(['page-0', 'page-1'])).toThrow(/template/i);
    expect(applyDocumentChanges(document, ops.deleteTemplates(['page-1'])).after.variants.default.templates['page-1']).toBeUndefined();
    expect(applyDocumentChanges(document, ops.updateTemplateName('page-0', 'Name')).after.variants.default.templates['page-0'].name).toBe('Name');
    const created = applyDocumentChanges(document, ops.createVariant({ name: 'Small', targetWidth: 100, targetHeight: 200, reflow: false, scaleFontSize: false }));
    expect(Object.values(created.after.variants).find(v => v.name === 'Small')?.templates['page-0'].width).toBe(100);
  });

  it('preserves layer object provenance for exceptional folds through reorder, deletion and replacement', () => {
    const state = makeIncrementalProject(2).initialState;
    state.variants.default.templates['page-0'].layers = [
      { id: 'same', name: 'first', collapsed: 'legacy' },
      { id: 'same', name: 'second', collapsed: false },
      { id: 7, name: 'third', collapsed: 0 },
    ] as any;
    const parts = freeze(partitionState(state));
    const before = parts.document.variants.default.templates['page-0'];
    const [first, second, third] = before.layers!;
    const reordered = applyDocumentChanges(parts.document, operations(parts.document).updateTemplate('page-0', { layers: [third, first, second] }));
    expect(reordered.after.variants.default.templates['page-0'].layers).toEqual([third, first, second]);
    expect(reordered.after.variants.default.templates['page-0'].layers![0]).toBe(third);
    const deleted = applyDocumentChanges(parts.document, operations(parts.document).updateTemplate('page-0', { layers: [second, third] }));
    expect(deleted.after.variants.default.templates['page-0'].layers![0]).toBe(second);
    const replacement = { ...first, name: 'new layer' };
    const replaced = applyDocumentChanges(parts.document, operations(parts.document).updateTemplate('page-0', { layers: [replacement] }));
    expect(replaced.after.variants.default.templates['page-0'].layers![0]).not.toBe(first);
    expect(parts.compatibility.layerCollapsedExceptions).toEqual({
      '["default","page-0",0]': { value: 'legacy' },
      '["default","page-0",1]': { value: false },
      '["default","page-0",2]': { value: 0 },
    });
    // DocumentEdit cannot relocate these external values. Consumers must reconcile
    // before assembly; reusing parts.compatibility after a structural edit is wrong.
  });
});
