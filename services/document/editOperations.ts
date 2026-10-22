import type { AppNode, AppState, Layer, PageTemplate, TemplateElement, Variant } from '../../types';
import { RM_PP_HEIGHT, RM_PP_WIDTH } from '../../types';
import type { NewVariantConfig } from '../../components/NewVariantModal';
import { addLayer, createDefaultLayer, moveElementsToLayer, nextZIndexInLayer, resolveActiveLayerId } from '../layers';
import { reflowTemplates } from '../reflow';
import type { DocumentChange, DocumentState } from './contracts';
import { affectedReferences, type ReferenceIndex } from './references';
import type { LayerMapping } from './layerFolds';
import type { HistorySelection } from './history';

type EditContext = Pick<AppState, 'activeVariantId'> & Partial<Pick<AppState,
  'selectedNodeId' | 'selectedTemplateId' | 'viewMode' | 'selectedElementIds' | 'clipboard' | 'activeLayerId'>>;
const own = <T>(map: Record<string, T>, id: string): T | undefined => Object.hasOwn(map, id) ? map[id] : undefined;
const patch = <T extends object>(record: T, updates: Partial<T>): T =>
  Object.keys(updates).every(key => Object.hasOwn(record, key) && Object.is(record[key as keyof T], updates[key as keyof T]))
    ? record : { ...record, ...updates };
const identity = (id: string, updates: { id?: string }) => {
  if (Object.hasOwn(updates, 'id') && updates.id !== id) throw new Error('An update cannot change record identity.');
};
function newId(prefix: string, exists: (id: string) => boolean): string {
  const base = `${prefix}${Math.random().toString(36).slice(2, 11)}`;
  let id = base;
  for (let suffix = 1; exists(id); suffix++) id = `${base}_${suffix}`;
  return id;
}

// Reuse the existing reflow algorithm on a geometry-only projection of ONE
// changed template. Its legacy JSON copy never sees layers, artwork or opaque
// extensions. Merge geometry back onto the original immutable element records.
const geometryFields = ['x', 'y', 'w', 'h', 'rotation', 'fontSize', 'fontFamily', 'text', 'dataBinding',
  'strokeWidth', 'borderRadius', 'patternSpacing', 'patternWeight', 'patternType'] as const;
const scaledFields = ['x', 'y', 'w', 'h', 'fontSize', 'strokeWidth', 'borderRadius', 'patternSpacing', 'patternWeight'] as const;
function resize(template: PageTemplate, width: number, height: number, reflow: boolean, scaleFontSize: boolean): PageTemplate {
  if (width === template.width && height === template.height) return template;
  if (!reflow) return { ...template, width, height };
  const projection = {
    id: 'geometry', name: '', width: template.width, height: template.height,
    elements: template.elements.map(element => ({
      ...Object.fromEntries(geometryFields.filter(key => Object.hasOwn(element, key)).map(key => [key, element[key]])),
      ...(element.gridConfig ? { gridConfig: { gapX: element.gridConfig.gapX, gapY: element.gridConfig.gapY } } : {}),
    })),
  } as PageTemplate;
  const scaled = reflowTemplates({ geometry: projection }, width, height, true, scaleFontSize).geometry;
  return { ...template, width, height, elements: template.elements.map((element, i) => ({
    ...element,
    ...Object.fromEntries(scaledFields.filter(key => Object.hasOwn(scaled.elements[i], key)).map(key => [key, scaled.elements[i][key]])),
    ...(element.gridConfig ? { gridConfig: { ...element.gridConfig,
      gapX: scaled.elements[i].gridConfig!.gapX, gapY: scaled.elements[i].gridConfig!.gapY } } : {}),
  })) };
}

/**
 * Bind one immutable document and its current index. Returned constructors retain
 * existing callback arguments, but return changes rather than setting AppState.
 * Rebind after edits; history/selection and storage remain the caller's concern.
 *
 * IMPORTANT cutover seam: DocumentEdit does not own preferences/compatibility.
 * Layer arrays supplied here retain caller object identities (including duplicate
 * or non-string IDs). Tasks 4/5/10 must reconcile layerCollapsed and positional
 * layerCollapsedExceptions with explicit layer provenance BEFORE assembly,
 * validation/accounting and history publication. Never reuse old positional
 * sidecars after reorder/delete/replacement. Cloned duplicate-ID layers require
 * an explicit old-position -> new-position mapping from the initiating operation;
 * neither matching IDs nor a full-document diff can infer that relationship.
 */
export function createEditOperations(document: DocumentState, context: EditContext, index: ReferenceIndex) {
  const active = () => own(document.variants, context.activeVariantId);
  const templates = () => active()?.templates ?? {};
  const currentId = () => context.viewMode === 'hierarchy'
    ? own(document.nodes, context.selectedNodeId ?? '')?.type : context.selectedTemplateId;
  const current = () => { const id = currentId(); return id === undefined ? undefined : own(templates(), id); };
  const putTemplate = (template: PageTemplate, variantId = context.activeVariantId): DocumentChange[] => [
    { type: 'put-template', variantId, template },
  ];
  const updateTemplate = (id: string, updates: Partial<PageTemplate>, autoReflow = false, scaleFontSize = true): DocumentChange[] => {
    identity(id, updates);
    const old = own(templates(), id);
    if (!old) return [];
    const resized = autoReflow && (updates.width !== undefined || updates.height !== undefined)
      ? resize(old, updates.width ?? old.width, updates.height ?? old.height, true, scaleFontSize) : old;
    const value = patch(resized, updates);
    return value === old ? [] : putTemplate(value);
  };
  const updateTemplateElements = (newElements: TemplateElement[], _shouldSaveHistory = true): DocumentChange[] => {
    const template = current();
    return template ? updateTemplate(template.id, { elements: newElements }) : [];
  };
  const appendNode = (node: AppNode): DocumentChange[] => {
    const parent = node.parentId === null ? undefined : own(document.nodes, node.parentId);
    if (node.parentId !== null && !parent) return [];
    return [ { type: 'put-node', node }, ...(parent ? [{ type: 'put-node' as const, node: {
      ...parent, children: [...parent.children, node.id],
    } }] : []) ];
  };
  const addVariant = (fields: Omit<Variant, 'templates'>, source: Record<string, PageTemplate>): DocumentChange[] => [
    { type: 'put-variant', variant: fields },
    ...Object.values(source).map(template => ({ type: 'put-template' as const, variantId: fields.id, template })),
  ];
  const pasteElements = (source: TemplateElement[]): DocumentChange[] => {
    const template = current();
    if (!template || !source.length) return [];
    const elements = [...template.elements];
    const placementLayers = (template.layers ?? []).filter(layer => layer && !Array.isArray(layer) && typeof layer.id === 'string');
    const ids = new Set(elements.map(element => element.id));
    for (const original of source) {
      const id = newId('', value => ids.has(value));
      ids.add(id);
      const layerId = original.layerId && placementLayers.some(layer => layer.id === original.layerId)
        ? original.layerId : resolveActiveLayerId({ ...template, layers: placementLayers }, context.activeLayerId);
      elements.push({ ...original, id, x: original.x + 20, y: original.y + 20, layerId,
        zIndex: nextZIndexInLayer(elements, layerId) });
    }
    return updateTemplateElements(elements, false);
  };

  return {
    updateTemplate,
    updateTemplateElements,
    updateNode(id: string, updates: Partial<AppNode>): DocumentChange[] {
      identity(id, updates);
      const old = own(document.nodes, id);
      if (!old) return [];
      const node = patch(old, updates);
      return node === old ? [] : [{ type: 'put-node', node }];
    },
    addNode(parentId: string | null): DocumentChange[] {
      const parent = parentId === null ? undefined : own(document.nodes, parentId);
      let type = Object.keys(templates())[0];
      if (own(templates(), 'day_view')) type = !parent ? 'year_view' : parent.type === 'year_view' ? 'month_view' : 'day_view';
      if (type === undefined) return [];
      return appendNode({ id: newId('', id => Object.hasOwn(document.nodes, id)), parentId, type, title: 'New Page', data: {}, children: [] });
    },
    createReference(targetId: string): DocumentChange[] {
      const target = own(document.nodes, targetId);
      if (context.selectedNodeId === undefined || !target) return [];
      return appendNode({ id: newId('ref_', id => Object.hasOwn(document.nodes, id)), parentId: context.selectedNodeId,
        type: target.type, title: target.title, data: {}, children: [], referenceId: targetId });
    },
    duplicateNodes(ids: string[]): DocumentChange[] {
      if (ids.includes(document.rootId)) throw new Error('Cannot duplicate the root node.');
      const updates = new Map<string, AppNode>();
      const read = (id: string) => updates.get(id) ?? own(document.nodes, id);
      const copy = (id: string, parentId: string, ancestors: Set<string>): string => {
        const original = own(document.nodes, id);
        if (!original) return id;
        if (ancestors.has(id)) throw new Error('Cannot duplicate a cyclic hierarchy.');
        ancestors.add(id);
        const copiedId = newId('node_', value => !!read(value));
        const copied = { ...original, id: copiedId, parentId, title: `${original.title} (Copy)`, children: [] as string[] };
        updates.set(copiedId, copied);
        copied.children = original.children.map(child => copy(child, copiedId, ancestors));
        ancestors.delete(id);
        return copiedId;
      };
      for (const id of ids) {
        const original = own(document.nodes, id);
        const parent = original?.parentId == null ? undefined : read(original.parentId);
        if (!original || !parent) continue;
        const copiedId = copy(id, parent.id, new Set());
        const children = [...parent.children];
        const position = children.indexOf(id);
        children.splice(position < 0 ? children.length : position + 1, 0, copiedId);
        updates.set(parent.id, { ...parent, children });
      }
      return [...updates.values()].map(node => ({ type: 'put-node', node }));
    },
    deleteNodes(ids: string[]): DocumentChange[] {
      const deleted = new Set<string>();
      const queue = [...ids];
      for (let i = 0; i < queue.length; i++) {
        const id = queue[i];
        if (deleted.has(id)) continue;
        if (id === document.rootId) throw new Error('Cannot delete the root node.');
        deleted.add(id);
        const node = own(document.nodes, id);
        if (node) queue.push(...node.children);
        for (const owner of affectedReferences(index, [{ kind: 'node', nodeId: id }])) {
          if (owner.kind === 'node' && own(document.nodes, owner.nodeId)?.referenceId === id) queue.push(owner.nodeId);
        }
      }
      const changes: DocumentChange[] = [...deleted].map(nodeId => ({ type: 'delete-node', nodeId }));
      const parents = new Set<string>();
      for (const id of deleted) {
        const parentId = own(document.nodes, id)?.parentId;
        if (parentId != null && !deleted.has(parentId)) parents.add(parentId);
      }
      for (const id of parents) {
        const parent = own(document.nodes, id);
        if (parent) changes.push({ type: 'put-node', node: { ...parent, children: parent.children.filter(child => !deleted.has(child)) } });
      }
      const owners = affectedReferences(index, [...deleted].map(nodeId => ({ kind: 'node', nodeId })));
      for (const owner of owners) {
        if (owner.kind !== 'template') continue;
        const variant = own(document.variants, owner.variantId);
        const template = variant && own(variant.templates, owner.templateId);
        if (!template) continue;
        let changed = false;
        const elements = template.elements.map(element => {
          if (!element || typeof element !== 'object') return element;
          let next = element;
          // Repaired fields are removed, never set to undefined: the local store only takes JSON values.
          if (element.type === 'grid' && element.gridConfig?.sourceType === 'specific'
            && element.gridConfig.sourceId && deleted.has(element.gridConfig.sourceId)) {
            const { sourceId: _sourceId, ...gridConfig } = element.gridConfig;
            next = { ...next, gridConfig: { ...gridConfig, sourceType: 'current' } };
          }
          if (element.linkTarget === 'specific_node' && element.linkValue && deleted.has(element.linkValue)) {
            const { linkValue: _linkValue, ...rest } = next;
            next = { ...rest, linkTarget: 'none' };
          }
          changed ||= next !== element;
          return next;
        });
        if (changed) changes.push(...putTemplate({ ...template, elements }, owner.variantId));
      }
      return changes;
    },
    addTemplate(): DocumentChange[] {
      return putTemplate({ id: newId('tpl_', id => Object.hasOwn(templates(), id)), name: 'New Template',
        width: RM_PP_WIDTH, height: RM_PP_HEIGHT, elements: [], layers: [createDefaultLayer()] });
    },
    duplicateTemplates(ids: string[]): DocumentChange[] {
      const reserved = new Set<string>();
      return ids.flatMap(id => {
        const template = own(templates(), id);
        if (!template) return [];
        const copiedId = newId('tpl_', value => Object.hasOwn(templates(), value) || reserved.has(value));
        reserved.add(copiedId);
        return putTemplate({ ...template, id: copiedId, name: `${template.name} (Copy)` });
      });
    },
    deleteTemplates(ids: string[]): DocumentChange[] {
      const removed = new Set(ids.filter(id => Object.hasOwn(templates(), id)));
      if (Object.keys(templates()).length - removed.size <= 0) throw new Error('Cannot delete all templates. Leave at least one.');
      return [...removed].map(templateId => ({ type: 'delete-template', variantId: context.activeVariantId, templateId }));
    },
    updateTemplateName(id: string, name: string): DocumentChange[] { return updateTemplate(id, { name }); },
    renameVariant(variantId: string, name: string): DocumentChange[] {
      const variant = own(document.variants, variantId);
      if (!variant || variant.name === name) return [];
      const { templates: _templates, ...fields } = variant;
      return [{ type: 'put-variant', variant: { ...fields, name } }];
    },
    deleteVariant(variantId: string): DocumentChange[] {
      if (!Object.hasOwn(document.variants, variantId)) return [];
      if (Object.keys(document.variants).length <= 1) throw new Error('Cannot delete the last variant.');
      return [{ type: 'delete-variant', variantId }];
    },
    duplicateVariant(variantId: string): DocumentChange[] {
      const variant = own(document.variants, variantId);
      if (!variant) return [];
      const { templates: source, ...fields } = variant;
      return addVariant({ ...fields, id: newId('variant_', id => Object.hasOwn(document.variants, id)), name: `${variant.name} (Copy)` }, source);
    },
    createVariant(config: NewVariantConfig): DocumentChange[] {
      const source = Object.fromEntries(Object.entries(templates()).map(([id, template]) =>
        [id, resize(template, config.targetWidth, config.targetHeight, config.reflow, config.scaleFontSize)]));
      return addVariant({ id: newId('variant_', id => Object.hasOwn(document.variants, id)), name: config.name }, source);
    },
    updateElement(id: string, updates: Partial<TemplateElement>): DocumentChange[] {
      const template = current();
      if (!template) return [];
      const elements = template.elements.map(element => element.id === id ? patch(element, updates) : element);
      return elements.every((element, i) => element === template.elements[i]) ? [] : updateTemplateElements(elements, false);
    },
    deleteElements(ids: string[]): DocumentChange[] {
      const template = current();
      if (!template) return [];
      const deleted = new Set(ids);
      const elements = template.elements.filter(element => !deleted.has(element.id));
      return elements.length === template.elements.length ? [] : updateTemplateElements(elements, false);
    },
    duplicate(): DocumentChange[] {
      const template = current();
      return pasteElements((context.selectedElementIds ?? []).flatMap(id => {
        const element = template?.elements.find(item => item.id === id);
        return element ? [element] : [];
      }));
    },
    paste(): DocumentChange[] { return pasteElements(context.clipboard ?? []); },
  };
}

export interface StructuralEditorEdit {
  changes: DocumentChange[];
  mappings: LayerMapping[];
  selectionPatch: Partial<HistorySelection>;
}

export type LayerEditAction =
  | { type: 'add' }
  | { type: 'update'; position: number; patch: Partial<Omit<Layer, 'collapsed'>> }
  | { type: 'delete'; position: number }
  | { type: 'move'; position: number; targetPosition: number };

export function prepareLayerEdit(document: DocumentState, address: { variantId: string; templateId: string }, action: LayerEditAction) {
  const template = own(document.variants, address.variantId)?.templates[address.templateId];
  const empty = { changes: [] as DocumentChange[], mappings: [] as LayerMapping[], activeLayerId: undefined as string | undefined };
  if (!template) return empty;
  const original = template.layers ?? [];
  let rows = original.map((layer, position) => ({ layer, position }));
  let elements = template.elements;
  let activeLayerId: string | undefined;
  const at = (position: number) => ({ ...address, position });
  if (action.type === 'add') {
    const added = addLayer(original.filter(layer => layer && typeof layer === 'object' && !Array.isArray(layer))).newLayer;
    rows = [...rows, { layer: added, position: -1 }]; activeLayerId = added.id;
  } else {
    const selected = rows[action.position];
    if (!selected || !selected.layer || typeof selected.layer !== 'object' || Array.isArray(selected.layer)) return empty;
    if (action.type === 'update') {
      if ('collapsed' in action.patch) throw Error('Layer folds require an occurrence preference action.');
      const layer = patch(selected.layer, action.patch);
      if (layer === selected.layer) return empty;
      rows = rows.map(row => row === selected ? { ...row, layer } : row);
    } else if (action.type === 'delete') {
      if (typeof selected.layer.id === 'string' && rows.filter(row => row.layer && typeof row.layer.id === 'string').length <= 1) return empty;
      rows = rows.filter(row => row !== selected);
      if (!rows.some(row => row.layer?.id === selected.layer.id)) {
        const fallback = [...rows].filter(row => row.layer && typeof row.layer.id === 'string').sort((a, b) => a.layer.order - b.layer.order)[0]?.layer;
        const orphans = elements.filter(element => element.layerId === selected.layer.id).map(element => element.id);
        if (orphans.length && !fallback) return empty;
        if (orphans.length && fallback) {
          const ordered = elements.filter(element => element.layerId === selected.layer.id)
            .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
          const start = nextZIndexInLayer(elements, fallback.id);
          const positions = new Map(ordered.map((element, i) => [element.id, start + i]));
          elements = elements.map(element => positions.has(element.id)
            ? { ...element, layerId: fallback.id, zIndex: positions.get(element.id)! } : element);
        }
        activeLayerId = fallback?.id;
      }
    } else {
      const target = rows[action.targetPosition];
      if (!target || target === selected) return empty;
      rows.sort((a, b) => (a.layer?.order ?? 0) - (b.layer?.order ?? 0));
      const targetIndex = rows.indexOf(target);
      rows.splice(rows.indexOf(selected), 1); rows.splice(targetIndex, 0, selected);
      rows = rows.map((row, order) => ({ ...row, layer: row.layer && typeof row.layer === 'object' && !Array.isArray(row.layer) ? patch(row.layer, { order }) : row.layer }));
    }
  }
  const mappings: LayerMapping[] = original.map((_, position) => {
    const destination = rows.findIndex(row => row.position === position);
    return destination < 0 ? { type: 'remove', from: at(position) } : { type: 'continue', from: at(position), to: at(destination) };
  });
  rows.forEach((row, position) => { if (row.position < 0) mappings.push({ type: 'create', to: at(position), cell: { present: false } }); });
  return { changes: [{ type: 'put-template' as const, variantId: address.variantId,
    template: { ...template, layers: rows.map(row => row.layer), elements } }], mappings, activeLayerId };
}

/** Preserve initiating source addresses; never infer provenance by comparing records. */
export function createStructuralEditorOperations(document: DocumentState, context: EditContext, index: ReferenceIndex) {
  const ops = createEditOperations(document, context, index);
  const variantId = context.activeVariantId;
  const templates = own(document.variants, variantId)?.templates ?? {};
  const result = (changes: DocumentChange[], mappings: LayerMapping[] = [], selectionPatch: Partial<HistorySelection> = {}): StructuralEditorEdit =>
    ({ changes, mappings, selectionPatch });
  const removeTemplate = (sourceVariant: string, id: string): LayerMapping[] =>
    (own(document.variants, sourceVariant)?.templates[id]?.layers ?? []).map((_, position) =>
      ({ type: 'remove', from: { variantId: sourceVariant, templateId: id, position } }));
  function variantCopy(changes: DocumentChange[], sourceVariant: string): StructuralEditorEdit {
    const created = changes.find(change => change.type === 'put-variant');
    if (!created || created.type !== 'put-variant') return result(changes);
    const destination = created.variant.id;
    const mappings: LayerMapping[] = [];
    const ids: string[] = [];
    for (const change of changes) if (change.type === 'put-template') {
      ids.push(change.template.id);
      change.template.layers?.forEach((_, position) => mappings.push({ type: 'copy',
        from: { variantId: sourceVariant, templateId: change.template.id, position },
        to: { variantId: destination, templateId: change.template.id, position } }));
    }
    return result(changes, mappings, { activeVariantId: destination, selectedTemplateId: ids[0] ?? '',
      selectedTemplateIds: ids.length ? [ids[0]] : [], selectedElementIds: [] });
  }
  return {
    addTemplate(): StructuralEditorEdit {
      const changes = ops.addTemplate();
      const created = changes[0];
      if (created.type !== 'put-template') throw Error('Expected created template.');
      const id = created.template.id;
      return result(changes, (created.template.layers ?? []).map((_, position) => ({ type: 'create',
        to: { variantId, templateId: id, position }, cell: { present: false } })),
        { selectedTemplateId: id, selectedTemplateIds: [id], selectedElementIds: [] });
    },
    duplicateTemplates(ids: string[]): StructuralEditorEdit {
      // The accepted constructor preserves input order and skips missing sources.
      const sources = ids.filter(id => Object.hasOwn(templates, id));
      const changes = ops.duplicateTemplates(sources);
      const mappings: LayerMapping[] = []; const selected: string[] = [];
      changes.forEach((change, i) => {
        if (change.type !== 'put-template') throw Error('Expected copied template.');
        selected.push(change.template.id);
        (templates[sources[i]].layers ?? []).forEach((_, position) => mappings.push({ type: 'copy',
          from: { variantId, templateId: sources[i], position }, to: { variantId, templateId: change.template.id, position } }));
      });
      return result(changes, mappings, selected.length ? { selectedTemplateId: selected[0], selectedTemplateIds: selected, selectedElementIds: [] } : {});
    },
    deleteTemplates(ids: string[]): StructuralEditorEdit {
      const changes = ops.deleteTemplates(ids);
      const removed = new Set(changes.flatMap(change => change.type === 'delete-template' ? [change.templateId] : []));
      const selected = context.selectedTemplateId && !removed.has(context.selectedTemplateId)
        ? context.selectedTemplateId : Object.keys(templates).find(id => !removed.has(id)) ?? '';
      return result(changes, [...removed].flatMap(id => removeTemplate(variantId, id)),
        { selectedTemplateId: selected, selectedTemplateIds: [selected], selectedElementIds: [] });
    },
    createVariant(config: NewVariantConfig) { return variantCopy(ops.createVariant(config), variantId); },
    duplicateVariant(id: string) { return variantCopy(ops.duplicateVariant(id), id); },
    deleteVariant(id: string): StructuralEditorEdit {
      const changes = ops.deleteVariant(id);
      if (!changes.length) return result([]);
      const ids = Object.keys(document.variants[id].templates);
      const activeVariantId = variantId === id ? Object.keys(document.variants).find(key => key !== id)! : variantId;
      const selectedTemplateId = Object.keys(document.variants[activeVariantId].templates)[0] ?? '';
      return result([...ids.map(templateId => ({ type: 'delete-template' as const, variantId: id, templateId })), ...changes],
        ids.flatMap(templateId => removeTemplate(id, templateId)),
        { activeVariantId, selectedTemplateId, selectedTemplateIds: selectedTemplateId ? [selectedTemplateId] : [], selectedElementIds: [] });
    },
  };
}
