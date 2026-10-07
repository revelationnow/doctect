import type { DocumentChange, DocumentEdit, DocumentState } from './contracts';
import {
  checkHistoryCurrent, createHistoryTimeline, crossHistoryTimeline, finishHistoryTimeline, recordHistoryTimeline,
  type HistoryEdge, type HistorySelection, type HistorySelectionPair, type HistoryTimeline,
} from './history';
import {
  applyFoldOverlayEffects, readLayerFoldCell, updateLayerFoldPreferences, validateLayerCorrespondence,
  type FoldCell, type FoldOverlayEffect, type FoldUpdate, type LayerCorrespondence, type LayerMapping,
  type LayerFoldState, type LayerOccurrence, type PartitionedEdit,
} from './layerFolds';

type TemplateAddress = Pick<LayerOccurrence, 'variantId' | 'templateId'>;
interface Continuation { readonly from: LayerOccurrence; readonly to: LayerOccurrence }
interface DisplacedCell { readonly occurrence: LayerOccurrence; readonly cell: FoldCell }
interface FoldEdge {
  readonly templates: readonly TemplateAddress[];
  readonly continuations: readonly Continuation[];
  readonly removed: readonly DisplacedCell[];
  readonly created: readonly DisplacedCell[];
}
const timeline = Symbol('partitioned history');
export interface PartitionedHistory { readonly [timeline]: HistoryTimeline<FoldEdge> }
export interface PartitionedHistoryResult extends FoldUpdate {
  history: PartitionedHistory;
  changes: readonly DocumentChange[];
  selection?: HistorySelection;
  replacement?: DocumentState;
  edit?: DocumentEdit;
  correspondence?: LayerCorrespondence;
}
const templateKey = (a: TemplateAddress) => JSON.stringify([a.variantId, a.templateId]);
const occurrenceKey = (a: LayerOccurrence) => JSON.stringify([a.variantId, a.templateId, a.position]);
function occurrences(document: DocumentState, templates: readonly TemplateAddress[]): LayerOccurrence[] {
  const result: LayerOccurrence[] = [];
  for (const address of templates) {
    const variant = Object.hasOwn(document.variants, address.variantId) ? document.variants[address.variantId] : undefined;
    const template = variant && Object.hasOwn(variant.templates, address.templateId) ? variant.templates[address.templateId] : undefined;
    if (Array.isArray(template?.layers)) for (let position = 0; position < template.layers.length; position++) result.push({ ...address, position });
  }
  return result;
}
function capture(state: LayerFoldState, occurrence: LayerOccurrence): DisplacedCell {
  return { occurrence: { ...occurrence }, cell: readLayerFoldCell(state, occurrence) };
}

export const createPartitionedHistory = (limit?: number): PartitionedHistory => ({ [timeline]: createHistoryTimeline(limit) });

/** Availability belongs to this owner, not a second UI history/counter. */
export function getPartitionedHistoryStatus(history: PartitionedHistory): {
  readonly canUndo: boolean; readonly canRedo: boolean; readonly openGroupId?: string;
} {
  const current = history[timeline];
  return { canUndo: current.past.length > 0, canRedo: current.future.length > 0,
    ...(current.open ? { openGroupId: current.open.id } : {}) };
}

function edgeData(edit: PartitionedEdit): FoldEdge {
  if (edit.before.parts.document !== edit.documentEdit.before || edit.after.parts.document !== edit.documentEdit.after)
    throw new Error('Stale partitioned edit snapshots.');
  const templates = validateLayerCorrespondence(edit.documentEdit, edit.correspondence);
  const continuations: Continuation[] = []; const removed: DisplacedCell[] = []; const created: DisplacedCell[] = [];
  for (const mapping of edit.correspondence.mappings) {
    if (mapping.type === 'continue') continuations.push({ from: { ...mapping.from }, to: { ...mapping.to } });
    else if (mapping.type === 'remove') removed.push(capture(edit.before, mapping.from));
    else created.push(capture(edit.after, mapping.to));
  }
  return { templates, continuations, removed, created };
}

/** Compose first→middle→latest ownership, retaining no event chain or partition wrapper. */
function compose(first: HistoryEdge<FoldEdge>, next: HistoryEdge<FoldEdge>, edit: PartitionedEdit): FoldEdge {
  const templates = [...new Map([...first.data.templates, ...next.data.templates].map(a => [templateKey(a), a])).values()];
  const firstOrigins = new Map(first.data.continuations.map(link => [occurrenceKey(link.to), link.from]));
  const firstDestinations = new Map(first.data.continuations.map(link => [occurrenceKey(link.from), link.to]));
  const firstBirths = new Set(first.data.created.map(item => occurrenceKey(item.occurrence)));
  const oldRemoved = new Map(first.data.removed.map(item => [occurrenceKey(item.occurrence), item]));
  const nextOrigins = new Map(next.data.continuations.map(link => [occurrenceKey(link.to), link.from]));
  const nextBirths = new Set(next.data.created.map(item => occurrenceKey(item.occurrence)));
  const surviving = new Set<string>();
  const continuations: Continuation[] = []; const created: DisplacedCell[] = [];
  for (const to of occurrences(next.after, templates)) {
    const toKey = occurrenceKey(to);
    const middle = nextBirths.has(toKey) ? undefined : nextOrigins.get(toKey) ?? to;
    const from = !middle || firstBirths.has(occurrenceKey(middle)) ? undefined : firstOrigins.get(occurrenceKey(middle)) ?? middle;
    if (from) { continuations.push({ from, to }); surviving.add(occurrenceKey(from)); }
    else created.push(capture(edit.after, to));
  }
  const removed = occurrences(first.before, templates).filter(from => !surviving.has(occurrenceKey(from))).map(from => {
    const key = occurrenceKey(from);
    // If an original disappears later in the gesture, capture its current choice,
    // not the preference it had at the first pointer event.
    return oldRemoved.get(key) ?? { occurrence: from, cell: readLayerFoldCell(edit.before, firstDestinations.get(key) ?? from) };
  });
  return { templates, continuations, removed, created };
}

export function recordPartitionedEdit(history: PartitionedHistory, edit: PartitionedEdit, groupId?: string, selection?: HistorySelectionPair): PartitionedHistory {
  checkHistoryCurrent(history[timeline], edit.documentEdit.before);
  const data = edgeData(edit);
  const next = recordHistoryTimeline(history[timeline], {
    before: edit.documentEdit.before, after: edit.documentEdit.after, affected: edit.documentEdit.affected, data, selection,
  }, groupId, (first, last) => compose(first, last, edit));
  return next === history[timeline] ? history : { [timeline]: next };
}

export function finishPartitionedGroup(history: PartitionedHistory, groupId: string): PartitionedHistory {
  const next = finishHistoryTimeline(history[timeline], groupId);
  return next === history[timeline] ? history : { [timeline]: next };
}

function crossFolds(current: LayerFoldState, edge: HistoryEdge<FoldEdge>, reverse: boolean): { update: FoldUpdate; data: FoldEdge } {
  const document = reverse ? edge.before : edge.after;
  const effects = new Map(edge.data.templates.map(address => [templateKey(address), { ...address, cells: [] as FoldCell[] }]));
  for (const link of edge.data.continuations) {
    const from = reverse ? link.to : link.from; const to = reverse ? link.from : link.to;
    effects.get(templateKey(to))!.cells[to.position] = readLayerFoldCell(current, from);
  }
  for (const item of reverse ? edge.data.removed : edge.data.created)
    effects.get(templateKey(item.occurrence))!.cells[item.occurrence.position] = item.cell;
  // Every crossing returns fresh displaced retention. Older histories/receipts
  // stay valid; no mutable tombstone cache exists outside the returned owner.
  const captured = (reverse ? edge.data.created : edge.data.removed).map(item => capture(current, item.occurrence));
  return { update: applyFoldOverlayEffects(current, document, [...effects.values()]),
    data: { ...edge.data, ...(reverse ? { created: captured } : { removed: captured }) } };
}

function traverse(history: PartitionedHistory, current: LayerFoldState, direction: 'undo' | 'redo' | 'cancel', groupId?: string): PartitionedHistoryResult {
  let update: FoldUpdate = { state: current, overlayEffects: [] };
  let crossedEdge: HistoryEdge<FoldEdge> | undefined;
  const result = crossHistoryTimeline(history[timeline], current.parts.document, direction, groupId, (edge, reverse) => {
    crossedEdge = edge;
    const crossed = crossFolds(current, edge, reverse); update = crossed.update; return crossed.data;
  }, current.parts.preferences.viewMode);
  if (result.selection) update = { ...update, state: updateLayerFoldPreferences(update.state, {
    activeVariantId: result.selection.activeVariantId, selectedNodeId: result.selection.selectedNodeId,
    selectedTemplateId: result.selection.selectedTemplateId,
  }) };
  let receipt: { edit: DocumentEdit; correspondence: LayerCorrespondence } | undefined;
  if (crossedEdge && !crossedEdge.bulk && result.document !== current.parts.document) {
    const edit: DocumentEdit = { before: current.parts.document, after: result.document,
      changes: result.changes, affected: crossedEdge.affected };
    const reverse = direction !== 'redo';
    const templateAt = (document: DocumentState, address: TemplateAddress) => {
      const variant = Object.hasOwn(document.variants, address.variantId) ? document.variants[address.variantId] : undefined;
      return variant && Object.hasOwn(variant.templates, address.templateId) ? variant.templates[address.templateId] : undefined;
    };
    const changed = new Set(crossedEdge.data.templates.filter(address => {
      const before = templateAt(edit.before, address); const after = templateAt(edit.after, address);
      return !!before !== !!after || before?.layers !== after?.layers;
    }).map(templateKey));
    const mappings: LayerMapping[] = [];
    for (const link of crossedEdge.data.continuations) {
      const from = reverse ? link.to : link.from; const to = reverse ? link.from : link.to;
      if (changed.has(templateKey(from)) || changed.has(templateKey(to)))
        mappings.push({ type: 'continue', from: { ...from }, to: { ...to } });
    }
    for (const item of reverse ? crossedEdge.data.created : crossedEdge.data.removed)
      if (changed.has(templateKey(item.occurrence))) mappings.push({ type: 'remove', from: { ...item.occurrence } });
    for (const item of reverse ? crossedEdge.data.removed : crossedEdge.data.created)
      if (changed.has(templateKey(item.occurrence))) mappings.push({ type: 'create', to: { ...item.occurrence }, cell: item.cell });
    const correspondence: LayerCorrespondence = { before: edit.before, after: edit.after, mappings };
    validateLayerCorrespondence(edit, correspondence);
    receipt = { edit, correspondence };
  }
  return { ...update, ...receipt, history: result.history === history[timeline] ? history : { [timeline]: result.history }, changes: result.changes,
    ...(result.selection ? { selection: result.selection } : {}), ...(result.replacement ? { replacement: result.replacement } : {}) };
}
export const undoPartitioned = (history: PartitionedHistory, current: LayerFoldState): PartitionedHistoryResult => traverse(history, current, 'undo');
export const redoPartitioned = (history: PartitionedHistory, current: LayerFoldState): PartitionedHistoryResult => traverse(history, current, 'redo');
export const cancelPartitionedGroup = (history: PartitionedHistory, current: LayerFoldState, groupId: string): PartitionedHistoryResult => traverse(history, current, 'cancel', groupId);

/** Explicit bulk boundary: populations are independent even when public IDs match. */
export function recordPartitionedReplacement(history: PartitionedHistory, before: LayerFoldState, after: LayerFoldState, selection?: HistorySelectionPair): PartitionedHistory {
  checkHistoryCurrent(history[timeline], before.parts.document);
  const templates = new Map<string, TemplateAddress>();
  for (const document of [before.parts.document, after.parts.document]) for (const [variantId, variant] of Object.entries(document.variants))
    for (const templateId of Object.keys(variant.templates)) templates.set(templateKey({ variantId, templateId }), { variantId, templateId });
  const addresses = [...templates.values()];
  const data: FoldEdge = { templates: addresses, continuations: [],
    removed: occurrences(before.parts.document, addresses).map(a => capture(before, a)),
    created: occurrences(after.parts.document, addresses).map(a => capture(after, a)),
  };
  const next = recordHistoryTimeline(history[timeline], { before: before.parts.document, after: after.parts.document,
    affected: [], bulk: true, data, selection });
  return next === history[timeline] ? history : { [timeline]: next };
}
