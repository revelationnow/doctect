import type { AppState, PageTemplate, Variant } from '../../types';
import type { DocumentChange, DocumentEdit, DocumentState, RecordAddress } from './contracts';
import { resolvePreferences } from './partition';
import { resolveActiveLayerId } from '../layers';

export type HistorySelection = Pick<AppState, 'activeVariantId' | 'selectedNodeId' | 'selectedNodeIds'
  | 'selectedTemplateId' | 'selectedTemplateIds' | 'selectedElementIds' | 'activeLayerId'>;
export interface HistorySelectionPair { before: HistorySelection; after: HistorySelection }
export interface HistoryResult {
  history: DocumentHistory;
  document: DocumentState;
  changes: readonly DocumentChange[];
  selection?: HistorySelection;
  replacement?: DocumentState;
}

const selectionKeys = ['activeVariantId', 'selectedNodeId', 'selectedNodeIds', 'selectedTemplateId',
  'selectedTemplateIds', 'selectedElementIds', 'activeLayerId'] as const;
function copySelection(selection: HistorySelection): HistorySelection {
  return Object.fromEntries(selectionKeys.filter(key => Object.hasOwn(selection, key)).map(key =>
    [key, Array.isArray(selection[key]) ? [...selection[key]] : selection[key]])) as HistorySelection;
}
function resolveSelection(document: DocumentState, selection: HistorySelection, viewMode: AppState['viewMode']): HistorySelection {
  const result = copySelection(selection);
  const resolved = resolvePreferences(document, { ...selection, viewMode, scale: 0.8,
    sidebarWidth: 288, propertiesPanelWidth: 320, snapToGrid: false, showGrid: false, layerCollapsed: {}, panelsExpanded: {} });
  result.activeVariantId = resolved.activeVariantId;
  result.selectedNodeId = resolved.selectedNodeId;
  result.selectedTemplateId = resolved.selectedTemplateId;
  const templates = own(document.variants, resolved.activeVariantId)?.templates ?? {};
  // Match projectActiveTemplate's scope without projecting fold UI or reading inactive payloads.
  const templateId = viewMode === 'hierarchy'
    ? own(document.nodes, resolved.selectedNodeId)?.type : resolved.selectedTemplateId;
  const template = typeof templateId === 'string' ? own(templates, templateId) : undefined;
  if (Object.hasOwn(result, 'selectedNodeIds')) result.selectedNodeIds = result.selectedNodeIds.filter(id => Object.hasOwn(document.nodes, id));
  if (Object.hasOwn(result, 'selectedTemplateIds')) result.selectedTemplateIds = result.selectedTemplateIds.filter(id => Object.hasOwn(templates, id));
  if (Object.hasOwn(result, 'selectedElementIds')) {
    const ids = new Set(template?.elements?.map(element => element?.id) ?? []);
    result.selectedElementIds = result.selectedElementIds.filter(id => ids.has(id));
  }
  // The existing layer resolver reads only layers; do not spread artwork/extension payloads.
  if (Object.hasOwn(result, 'activeLayerId')) result.activeLayerId = template
    ? resolveActiveLayerId({ layers: template.layers?.filter(layer => layer && typeof layer.id === 'string') } as PageTemplate, result.activeLayerId) : '';
  return result;
}

const own = <T>(map: Record<string, T>, id: string): T | undefined => Object.hasOwn(map, id) ? map[id] : undefined;
const addressKey = (address: RecordAddress) => JSON.stringify(address.kind === 'template'
  ? [address.kind, address.variantId, address.templateId] : address.kind === 'node'
    ? [address.kind, address.nodeId] : address.kind === 'variant' ? [address.kind, address.variantId] : [address.kind]);
const metadata = ({ templates: _templates, ...fields }: Variant): Omit<Variant, 'templates'> => fields;
const sameMetadata = (a: Variant | undefined, b: Variant | undefined) => {
  if (a === b) return true;
  if (!a || !b) return false;
  const left = metadata(a); const right = metadata(b);
  return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(key =>
    Object.hasOwn(right, key) && Object.is(left[key as keyof typeof left], right[key as keyof typeof right]));
};

/** @internal Shared by the two history owners; reads only explicitly affected records. */
export function historyEffects(current: DocumentState, target: DocumentState, affected: readonly RecordAddress[]): DocumentChange[] {
  const effects: DocumentChange[] = [];
  for (const address of affected) {
    switch (address.kind) {
      case 'node': {
        const value = own(target.nodes, address.nodeId);
        if (value !== own(current.nodes, address.nodeId)) effects.push(value
          ? { type: 'put-node', node: value } : { type: 'delete-node', nodeId: address.nodeId });
        break;
      }
      case 'variant': {
        const value = own(target.variants, address.variantId);
        if (!sameMetadata(value, own(current.variants, address.variantId))) effects.push(value
          ? { type: 'put-variant', variant: metadata(value) } : { type: 'delete-variant', variantId: address.variantId });
        break;
      }
      case 'template': {
        const targetVariant = own(target.variants, address.variantId);
        const currentVariant = own(current.variants, address.variantId);
        const value = targetVariant && own(targetVariant.templates, address.templateId);
        if (value !== (currentVariant && own(currentVariant.templates, address.templateId))) effects.push(value
          ? { type: 'put-template', variantId: address.variantId, template: value }
          : { type: 'delete-template', variantId: address.variantId, templateId: address.templateId });
        break;
      }
      case 'root': if (current.rootId !== target.rootId) effects.push({ type: 'set-root', rootId: target.rootId }); break;
      case 'generator':
        if (current.generator !== target.generator || Object.hasOwn(current, 'generator') !== Object.hasOwn(target, 'generator'))
          effects.push({ type: 'set-generator', generator: target.generator });
        break;
    }
  }
  return [...effects.filter(e => e.type === 'put-variant'),
    ...effects.filter(e => e.type !== 'put-variant' && e.type !== 'delete-variant'),
    ...effects.filter(e => e.type === 'delete-variant')];
}

// Internal generic lifecycle used by both opaque public owners. Structural data
// cannot be pushed/popped separately from the documents it belongs to.
export interface HistoryEdge<T> {
  readonly before: DocumentState;
  readonly after: DocumentState;
  readonly affected: readonly RecordAddress[];
  readonly bulk?: boolean;
  readonly selection?: HistorySelectionPair;
  readonly data: T;
}
export interface HistoryTimeline<T> {
  readonly limit: number;
  readonly current?: DocumentState;
  readonly past: readonly HistoryEdge<T>[];
  readonly future: readonly HistoryEdge<T>[];
  readonly open?: { readonly id: string; readonly past: readonly HistoryEdge<T>[]; readonly future: readonly HistoryEdge<T>[] };
}
export function createHistoryTimeline<T>(limit = 50): HistoryTimeline<T> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('History limit must be an integer in [1, 50].');
  return { limit, past: [], future: [] };
}
export function checkHistoryCurrent<T>(history: HistoryTimeline<T>, current: DocumentState): void {
  if (history.current && history.current !== current) throw new Error('Stale document reference.');
}
export function finishHistoryTimeline<T>(history: HistoryTimeline<T>, groupId: string): HistoryTimeline<T> {
  return history.open?.id === groupId ? { ...history, open: undefined } : history;
}
export function recordHistoryTimeline<T>(history: HistoryTimeline<T>, input: HistoryEdge<T>, groupId?: string,
  compose?: (first: HistoryEdge<T>, next: HistoryEdge<T>) => T): HistoryTimeline<T> {
  checkHistoryCurrent(history, input.before);
  if (!input.bulk && (input.before.schemaVersion !== input.after.schemaVersion
    || Object.hasOwn(input.before, 'schemaVersion') !== Object.hasOwn(input.after, 'schemaVersion')))
    throw new Error('Schema changes require explicit replacement.');
  if (input.before === input.after) return history;
  let edge: HistoryEdge<T> = { ...input, affected: input.affected.map(address => ({ ...address })),
    ...(input.selection ? { selection: { before: copySelection(input.selection.before), after: copySelection(input.selection.after) } } : {}) };
  const grouping = !!groupId && !input.bulk && history.open?.id === groupId;
  let past = history.past;
  const open = groupId && !input.bulk ? grouping ? history.open
    : { id: groupId, past: history.past, future: history.future } : undefined;
  if (grouping) {
    const first = past[past.length - 1];
    const addresses = new Map([...first.affected, ...edge.affected].map(address => [addressKey(address), address]));
    edge = { ...edge, before: first.before, affected: [...addresses.values()],
      selection: first.selection || edge.selection ? {
        before: first.selection?.before ?? edge.selection!.before,
        after: edge.selection?.after ?? first.selection!.after,
      } : undefined,
      data: compose ? compose(first, edge) : edge.data };
    past = past.slice(0, -1);
  }
  if (!edge.bulk && !historyEffects(edge.before, edge.after, edge.affected).length) {
    return grouping ? { ...history, current: edge.after, past: open!.past, future: open!.future, open: undefined } : history;
  }
  return { limit: history.limit, current: edge.after, past: [...past, edge].slice(-history.limit), future: [], open };
}

export interface TimelineResult<T> {
  history: HistoryTimeline<T>;
  document: DocumentState;
  changes: readonly DocumentChange[];
  selection?: HistorySelection;
  replacement?: DocumentState;
}
/** @internal Document-only results default to template-context candidates, not hierarchy UI publication. */
export function crossHistoryTimeline<T>(history: HistoryTimeline<T>, current: DocumentState, direction: 'undo' | 'redo' | 'cancel',
  groupId?: string, cross?: (edge: HistoryEdge<T>, reverse: boolean) => T,
  viewMode: AppState['viewMode'] = 'templates'): TimelineResult<T> {
  checkHistoryCurrent(history, current);
  if (direction === 'cancel' && (!groupId || history.open?.id !== groupId)) throw new Error('No matching open history group.');
  const reverse = direction !== 'redo';
  const stack = reverse ? history.past : history.future;
  const edge = stack[stack.length - 1];
  if (!edge) return { history: history.open ? { ...history, open: undefined } : history, document: current, changes: [] };
  const document = reverse ? edge.before : edge.after;
  const changes = edge.bulk ? [] : historyEffects(current, document, edge.affected);
  const selected = reverse ? edge.selection?.before : edge.selection?.after;
  const selection = selected ? resolveSelection(document, selected, viewMode) : undefined;
  const updated = cross ? { ...edge, data: cross(edge, reverse) } : edge;
  const next: HistoryTimeline<T> = direction === 'cancel'
    ? { limit: history.limit, current: document, past: history.open!.past, future: history.open!.future }
    : { limit: history.limit, current: document,
      past: reverse ? history.past.slice(0, -1) : [...history.past, updated],
      future: reverse ? [...history.future, updated] : history.future.slice(0, -1) };
  return { history: next, document, changes, ...(selection ? { selection } : {}), ...(edge.bulk ? { replacement: document } : {}) };
}

const timeline = Symbol('document history');
export interface DocumentHistory { readonly [timeline]: HistoryTimeline<undefined> }
export const createDocumentHistory = (limit?: number): DocumentHistory => ({ [timeline]: createHistoryTimeline(limit) });
export function recordDocumentEdit(history: DocumentHistory, edit: DocumentEdit, groupId?: string, selection?: HistorySelectionPair): DocumentHistory {
  const next = recordHistoryTimeline(history[timeline], {
    before: edit.before, after: edit.after, affected: edit.affected, selection, data: undefined,
  }, groupId);
  return next === history[timeline] ? history : { [timeline]: next };
}
export function recordDocumentReplacement(history: DocumentHistory, before: DocumentState, after: DocumentState, selection?: HistorySelectionPair): DocumentHistory {
  const next = recordHistoryTimeline(history[timeline], { before, after, affected: [], bulk: true, selection, data: undefined });
  return next === history[timeline] ? history : { [timeline]: next };
}
export function finishDocumentGroup(history: DocumentHistory, groupId: string): DocumentHistory {
  const next = finishHistoryTimeline(history[timeline], groupId);
  return next === history[timeline] ? history : { [timeline]: next };
}
function traverse(history: DocumentHistory, current: DocumentState, direction: 'undo' | 'redo' | 'cancel', groupId?: string): HistoryResult {
  const result = crossHistoryTimeline(history[timeline], current, direction, groupId);
  return { ...result, history: result.history === history[timeline] ? history : { [timeline]: result.history } };
}
export const undoDocument = (history: DocumentHistory, current: DocumentState): HistoryResult => traverse(history, current, 'undo');
export const redoDocument = (history: DocumentHistory, current: DocumentState): HistoryResult => traverse(history, current, 'redo');
export const cancelDocumentGroup = (history: DocumentHistory, current: DocumentState, groupId: string): HistoryResult => traverse(history, current, 'cancel', groupId);
