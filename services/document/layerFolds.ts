import type { Layer, PageTemplate } from '../../types';
import type { DocumentChange, DocumentEdit, DocumentState, EditorPreferences, PartitionedState } from './contracts';

export type FoldCell = { readonly present: false } | { readonly present: true; readonly value: unknown };
export interface LayerOccurrence { readonly variantId: string; readonly templateId: string; readonly position: number }
export type LayerMapping =
  | { readonly type: 'continue' | 'copy'; readonly from: LayerOccurrence; readonly to: LayerOccurrence }
  | { readonly type: 'create'; readonly to: LayerOccurrence; readonly cell: FoldCell }
  | { readonly type: 'remove'; readonly from: LayerOccurrence };
export interface LayerCorrespondence {
  readonly before: DocumentState;
  readonly after: DocumentState;
  readonly mappings: readonly LayerMapping[];
}
export interface FoldOverlayEffect {
  readonly variantId: string;
  readonly templateId: string;
  readonly cells: readonly FoldCell[];
}
export interface SelectedLayerSequence {
  address: Pick<LayerOccurrence, 'variantId' | 'templateId'>;
  before?: PageTemplate;
  after?: PageTemplate;
  cells: readonly FoldCell[];
}
interface Bucket {
  readonly cells: readonly FoldCell[];
  readonly preferenceKeys: readonly string[];
  readonly exceptionKeys: readonly string[];
}
const index = Symbol('template fold index');
export interface LayerFoldState {
  readonly parts: PartitionedState;
  readonly [index]: Readonly<Record<string, Bucket>>;
}
export interface PartitionedEdit {
  readonly documentEdit: DocumentEdit;
  readonly before: LayerFoldState;
  readonly after: LayerFoldState;
  readonly correspondence: LayerCorrespondence;
  readonly overlayEffects: readonly FoldOverlayEffect[];
}
export interface FoldUpdate { state: LayerFoldState; overlayEffects: readonly FoldOverlayEffect[] }

const absent: FoldCell = Object.freeze({ present: false });
const own = <T>(map: Readonly<Record<string, T>>, key: string): T | undefined => Object.hasOwn(map, key) ? map[key] : undefined;
const keyOf = (address: Pick<LayerOccurrence, 'variantId' | 'templateId'>) => JSON.stringify([address.variantId, address.templateId]);
const occurrenceKey = (address: LayerOccurrence) => JSON.stringify([address.variantId, address.templateId, address.position]);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const exceptionsOf = (parts: PartitionedState) => (parts.compatibility.layerCollapsedExceptions ?? {}) as Readonly<Record<string, { value: unknown }>>;
function templateAt(document: DocumentState, address: Pick<LayerOccurrence, 'variantId' | 'templateId'>): PageTemplate | undefined {
  const variant = own(document.variants, address.variantId);
  return variant && own(variant.templates, address.templateId);
}
function layersAt(document: DocumentState, address: Pick<LayerOccurrence, 'variantId' | 'templateId'>): readonly Layer[] {
  const layers = templateAt(document, address)?.layers;
  return Array.isArray(layers) ? layers : [];
}
function checkOccurrence(document: DocumentState, occurrence: LayerOccurrence): void {
  if (!occurrence || typeof occurrence.variantId !== 'string' || typeof occurrence.templateId !== 'string'
    || !Number.isInteger(occurrence.position) || occurrence.position < 0
    || occurrence.position >= layersAt(document, occurrence).length) throw new Error('Invalid layer occurrence.');
}
function copyCell(cell: FoldCell): FoldCell {
  if (!cell || typeof cell !== 'object' || (cell.present !== true && cell.present !== false)
    || (cell.present && !Object.hasOwn(cell, 'value'))) throw new Error('Invalid fold cell.');
  return cell.present ? Object.freeze({ present: true, value: cell.value }) : absent;
}

/** Shared selected-record codec; no discovery outside the named template. */
export function decodeSelectedFoldCells(template: PageTemplate | undefined, address: Pick<LayerOccurrence, 'variantId' | 'templateId'>,
  preferences: Readonly<Record<string, boolean>>, exceptions: Readonly<Record<string, unknown>>): readonly FoldCell[] {
  return (template?.layers ?? []).map((layer, position): FoldCell => {
    const exception = own(exceptions, JSON.stringify([address.variantId, address.templateId, position])) as { value: unknown } | undefined;
    if (exception) return copyCell({ present: true, value: exception.value });
    if (!record(layer) || typeof layer.id !== 'string') return absent;
    const key = JSON.stringify([address.variantId, address.templateId, layer.id]);
    return Object.hasOwn(preferences, key) ? copyCell({ present: true, value: preferences[key] }) : absent;
  });
}

export function encodeSelectedFoldCells(template: PageTemplate | undefined, address: Pick<LayerOccurrence, 'variantId' | 'templateId'>,
  cells: readonly FoldCell[]): { preferences: Record<string, boolean>; exceptions: Record<string, unknown> } {
  const layers = template?.layers ?? [];
  if (cells.length !== layers.length) throw new Error('Invalid template fold effect.');
  const preferences: Record<string, boolean> = {}; const exceptions: Record<string, unknown> = {};
  const counts = new Map<string, number>();
  for (const layer of layers) if (record(layer) && typeof layer.id === 'string') counts.set(layer.id, (counts.get(layer.id) ?? 0) + 1);
  cells.forEach((raw, position) => {
    const cell = copyCell(raw); if (!cell.present) return;
    const layer = layers[position]; if (!record(layer)) throw new Error('Cannot attach a fold to a non-record layer.');
    if (typeof layer.id === 'string' && counts.get(layer.id) === 1 && typeof cell.value === 'boolean')
      preferences[JSON.stringify([address.variantId, address.templateId, layer.id])] = cell.value;
    else exceptions[JSON.stringify([address.variantId, address.templateId, position])] = { value: cell.value };
  });
  return { preferences, exceptions };
}

/** Ingress only: build template-scoped cells and overlay-key buckets once. */
export function createLayerFoldState(parts: PartitionedState): LayerFoldState {
  const preferences = new Map<string, string[]>(); const exceptions = new Map<string, string[]>();
  for (const [map, buckets] of [[parts.preferences.layerCollapsed, preferences], [exceptionsOf(parts), exceptions]] as const) {
    for (const key of Object.keys(map)) {
      const address: unknown = JSON.parse(key);
      if (!Array.isArray(address) || address.length !== 3 || typeof address[0] !== 'string' || typeof address[1] !== 'string')
        throw new Error('Invalid fold overlay address.');
      const templateKey = JSON.stringify(address.slice(0, 2));
      const keys = buckets.get(templateKey) ?? [];
      keys.push(key); buckets.set(templateKey, keys);
    }
  }
  const buckets: Record<string, Bucket> = {};
  for (const key of new Set([...preferences.keys(), ...exceptions.keys()])) buckets[key] = {
    cells: [], preferenceKeys: preferences.get(key) ?? [], exceptionKeys: exceptions.get(key) ?? [],
  };
  for (const [variantId, variant] of Object.entries(parts.document.variants)) {
    for (const [templateId, template] of Object.entries(variant.templates)) {
      const key = keyOf({ variantId, templateId });
      const cells = decodeSelectedFoldCells(template, { variantId, templateId }, parts.preferences.layerCollapsed, exceptionsOf(parts));
      buckets[key] = { cells: Object.freeze(cells), preferenceKeys: preferences.get(key) ?? [], exceptionKeys: exceptions.get(key) ?? [] };
    }
  }
  return { parts, [index]: buckets };
}

export function readLayerFoldCell(state: LayerFoldState, occurrence: LayerOccurrence): FoldCell {
  checkOccurrence(state.parts.document, occurrence);
  return state[index][keyOf(occurrence)].cells[occurrence.position];
}
export function isLayerCollapsed(state: LayerFoldState, occurrence: LayerOccurrence): boolean {
  const cell = readLayerFoldCell(state, occurrence);
  return cell.present && cell.value === true;
}

/** @internal Atomic overlay installation shared with history traversal/bulk restoration. */
export function applyFoldOverlayEffects(state: LayerFoldState, document: DocumentState, effects: readonly FoldOverlayEffect[]): FoldUpdate {
  if (!effects.length) return { state: document === state.parts.document ? state : { ...state, parts: { ...state.parts, document } }, overlayEffects: [] };
  const seen = new Set<string>();
  const prepared = effects.map(effect => {
    const key = keyOf(effect);
    if (seen.has(key) || effect.cells.length !== layersAt(document, effect).length) throw new Error('Invalid template fold effect.');
    seen.add(key);
    return { ...effect, cells: Object.freeze(effect.cells.map(copyCell)) };
  });
  // These shallow copies preserve opaque payload references. Discovery of which
  // keys to remove uses only the indexed touched buckets, never global key scans.
  const layerCollapsed = { ...state.parts.preferences.layerCollapsed };
  const exceptions = { ...exceptionsOf(state.parts) };
  const buckets = { ...state[index] };
  for (const effect of prepared) {
    const key = keyOf(effect); const old = own(buckets, key);
    for (const oldKey of old?.preferenceKeys ?? []) delete layerCollapsed[oldKey];
    for (const oldKey of old?.exceptionKeys ?? []) delete exceptions[oldKey];
    const encoded = encodeSelectedFoldCells(templateAt(document, effect), effect, effect.cells);
    const preferenceKeys = Object.keys(encoded.preferences); const exceptionKeys = Object.keys(encoded.exceptions);
    Object.assign(layerCollapsed, encoded.preferences); Object.assign(exceptions, encoded.exceptions);
    if (templateAt(document, effect)) buckets[key] = { cells: effect.cells, preferenceKeys, exceptionKeys };
    else delete buckets[key];
  }
  return { state: { [index]: buckets, parts: { document,
    preferences: { ...state.parts.preferences, layerCollapsed },
    compatibility: { ...state.parts.compatibility, layerCollapsedExceptions: exceptions },
  } }, overlayEffects: prepared };
}

export function setLayerCollapsed(state: LayerFoldState, occurrence: LayerOccurrence, value: boolean): FoldUpdate {
  if (typeof value !== 'boolean') throw new Error('Fold actions require a boolean.');
  const old = readLayerFoldCell(state, occurrence);
  if (old.present && old.value === value) return { state, overlayEffects: [] };
  const cells = [...state[index][keyOf(occurrence)].cells];
  cells[occurrence.position] = copyCell({ present: true, value });
  return applyFoldOverlayEffects(state, state.parts.document, [{ variantId: occurrence.variantId, templateId: occurrence.templateId, cells }]);
}

export function updateLayerFoldPreferences(state: LayerFoldState, patch: Partial<Omit<EditorPreferences, 'layerCollapsed'>>): LayerFoldState {
  if (Object.hasOwn(patch, 'layerCollapsed')) throw new Error('layerCollapsed must use occurrence-targeted fold actions.');
  const allowed = new Set(['activeVariantId', 'selectedNodeId', 'selectedTemplateId', 'scale', 'viewMode', 'sidebarWidth',
    'propertiesPanelWidth', 'snapToGrid', 'showGrid', 'panelsExpanded']);
  if (Object.keys(patch).some(key => !allowed.has(key))) throw new Error('Unknown editor preference.');
  if (Object.keys(patch).every(key => Object.hasOwn(state.parts.preferences, key)
    && Object.is(state.parts.preferences[key as keyof EditorPreferences], patch[key as keyof typeof patch]))) return state;
  return { ...state, parts: { ...state.parts, preferences: { ...state.parts.preferences, ...patch } } };
}

/** @internal Shared provenance preflight; no next state is published before coverage passes. */
export function validateLayerCorrespondence(edit: DocumentEdit, correspondence: LayerCorrespondence): readonly Pick<LayerOccurrence, 'variantId' | 'templateId'>[] {
  if (correspondence.before !== edit.before || correspondence.after !== edit.after) throw new Error('Stale correspondence snapshots.');
  return validateSelectedCorrespondence(selectedSequences(edit, correspondence.mappings), correspondence.mappings);
}

const preservingTransfers = new WeakMap<readonly LayerMapping[], { layers: ReadonlyMap<string, unknown>; changes: ReadonlySet<DocumentChange> }>();
/** Only reference-proven local content edits qualify. Wire/recovered mappings have
 * no such capability and retain their structural barrier. No layer payload scan. */
export function canCoalescePreservedLayerTransfers(before: readonly LayerMapping[], beforeChanges: Iterable<DocumentChange>,
  after: readonly LayerMapping[], afterChanges: readonly DocumentChange[]): boolean {
  const a = preservingTransfers.get(before), b = preservingTransfers.get(after);
  if (!a || !b || a.layers.size !== b.layers.size || afterChanges.length !== b.changes.size) return false;
  for (const [key, layers] of a.layers) if (!b.layers.has(key) || b.layers.get(key) !== layers) return false;
  let count = 0;
  for (const change of beforeChanges) { if (!a.changes.has(change)) return false; count++; }
  return count === a.changes.size && afterChanges.every(change => b.changes.has(change));
}

/** Translate local, reference-proven continuity before structured cloning loses
 * that evidence. Explicit provenance stays authoritative. Only affected writes
 * need expansion: unchanged copy sources are read-only in the worker too.
 */
export function materializeLayerMappingsForTransfer(edit: DocumentEdit, correspondence: LayerCorrespondence): readonly LayerMapping[] {
  validateLayerCorrespondence(edit, correspondence);
  const endpoint = (value: LayerOccurrence): LayerOccurrence => Object.freeze({
    variantId: value.variantId, templateId: value.templateId, position: value.position,
  });
  const mappings = correspondence.mappings.map(mapping => Object.freeze({ type: mapping.type,
    ...('from' in mapping ? { from: endpoint(mapping.from) } : {}),
    ...('to' in mapping ? { to: endpoint(mapping.to) } : {}),
    ...(mapping.type === 'create' ? { cell: copyCell(mapping.cell) } : {}),
  })) as LayerMapping[];
  const visited = new Set<string>();
  const preserved = new Map<string, unknown>(); let pure = correspondence.mappings.length === 0;
  for (const address of edit.affected) {
    if (address.kind !== 'template') continue;
    const key = keyOf(address);
    if (visited.has(key)) continue;
    visited.add(key);
    const before = templateAt(edit.before, address); const after = templateAt(edit.after, address);
    if (!before || !after || before.layers !== after.layers) pure = false;
    else preserved.set(key, after.layers);
    if (!before || !after || !Array.isArray(before.layers) || before.layers !== after.layers) continue;
    for (let position = 0; position < before.layers.length; position++) {
      const occurrence = Object.freeze({ variantId: address.variantId, templateId: address.templateId, position });
      mappings.push(Object.freeze({ type: 'continue', from: occurrence, to: occurrence }));
    }
  }
  Object.freeze(mappings);
  if (pure && preserved.size === edit.changes.length && edit.changes.every(change => change.type === 'put-template'
    && preserved.has(keyOf({ variantId: change.variantId, templateId: change.template.id }))
    && change.template.layers === preserved.get(keyOf({ variantId: change.variantId, templateId: change.template.id })))) {
    preservingTransfers.set(mappings, { layers: preserved, changes: new Set(edit.changes) });
  }
  return mappings;
}

function selectedSequences(edit: DocumentEdit, mappings: readonly LayerMapping[]): SelectedLayerSequence[] {
  const addresses = new Map<string, Pick<LayerOccurrence, 'variantId' | 'templateId'>>();
  for (const address of edit.affected) if (address.kind === 'template') addresses.set(keyOf(address), address);
  for (const mapping of mappings) if (mapping && 'from' in mapping && mapping.from) addresses.set(keyOf(mapping.from), mapping.from);
  return [...addresses.values()].map(address => ({ address, before: templateAt(edit.before, address), after: templateAt(edit.after, address), cells: [] }));
}

function validateSelectedCorrespondence(sequences: readonly SelectedLayerSequence[], mappings: readonly LayerMapping[]) {
  const selected = new Map<string, SelectedLayerSequence>();
  const changed = new Map<string, Pick<LayerOccurrence, 'variantId' | 'templateId'>>();
  for (const sequence of sequences) {
    const { address, before, after } = sequence;
    if (selected.has(keyOf(address))) throw new Error('Duplicate selected sequence.');
    selected.set(keyOf(address), sequence);
    if (!!before !== !!after || before?.layers !== after?.layers) changed.set(keyOf(address), { variantId: address.variantId, templateId: address.templateId });
  }
  const check = (occurrence: LayerOccurrence, side: 'before' | 'after') => {
    if (!occurrence || typeof occurrence.variantId !== 'string' || typeof occurrence.templateId !== 'string'
      || !Number.isInteger(occurrence.position) || occurrence.position < 0
      || occurrence.position >= (selected.get(keyOf(occurrence))?.[side]?.layers?.length ?? 0)) throw new Error('Invalid layer occurrence.');
  };
  const sources = new Set<string>(); const destinations = new Set<string>();
  for (const mapping of mappings) {
    if (!mapping || !['continue', 'copy', 'create', 'remove'].includes(mapping.type)) throw new Error('Invalid layer mapping.');
    if ((mapping.type !== 'create') !== ('from' in mapping) || (mapping.type !== 'remove') !== ('to' in mapping))
      throw new Error('Layer mapping has missing or contradictory endpoints.');
    if ('from' in mapping) {
      check(mapping.from, 'before');
      if (mapping.type !== 'copy') {
        const key = occurrenceKey(mapping.from);
        if (!changed.has(keyOf(mapping.from)) || sources.has(key)) throw new Error('Invalid or duplicate continuing source.');
        sources.add(key);
      }
    }
    if ('to' in mapping) {
      check(mapping.to, 'after');
      const key = occurrenceKey(mapping.to);
      if (!changed.has(keyOf(mapping.to)) || destinations.has(key)) throw new Error('Invalid or duplicate layer destination.');
      destinations.add(key);
    }
    if (mapping.type === 'create') copyCell(mapping.cell);
  }
  for (const address of changed.values()) {
    for (let position = 0; position < (selected.get(keyOf(address))?.before?.layers?.length ?? 0); position++)
      if (!sources.has(occurrenceKey({ ...address, position }))) throw new Error('Missing before layer correspondence.');
    for (let position = 0; position < (selected.get(keyOf(address))?.after?.layers?.length ?? 0); position++)
      if (!destinations.has(occurrenceKey({ ...address, position }))) throw new Error('Missing after layer correspondence.');
  }
  return [...changed.values()];
}

/** Selected durable sequences and runtime snapshots share this transfer algorithm. */
export function reconcileSelectedLayerFolds(sequences: readonly SelectedLayerSequence[], mappings: readonly LayerMapping[]): readonly FoldOverlayEffect[] {
  const changed = validateSelectedCorrespondence(sequences, mappings);
  const selected = new Map(sequences.map(sequence => [keyOf(sequence.address), sequence]));
  for (const sequence of sequences) if (sequence.cells.length !== (sequence.before?.layers?.length ?? 0)) throw new Error('Invalid selected fold cells.');
  const cells = new Map(changed.map(address => [keyOf(address), [] as FoldCell[]]));
  for (const mapping of mappings) if ('to' in mapping) {
    cells.get(keyOf(mapping.to))![mapping.to.position] = copyCell(mapping.type === 'create'
      ? mapping.cell : selected.get(keyOf(mapping.from))!.cells[mapping.from.position]);
  }
  return changed.map(address => ({ ...address, cells: Object.freeze(cells.get(keyOf(address))!) }));
}

export function reconcileLayerFolds(state: LayerFoldState, edit: DocumentEdit, correspondence: LayerCorrespondence): PartitionedEdit {
  if (state.parts.document !== edit.before) throw new Error('Stale document snapshot.');
  validateLayerCorrespondence(edit, correspondence);
  const sequences = selectedSequences(edit, correspondence.mappings).map(sequence => ({ ...sequence,
    cells: state[index][keyOf(sequence.address)]?.cells ?? [] }));
  const update = applyFoldOverlayEffects(state, edit.after, reconcileSelectedLayerFolds(sequences, correspondence.mappings));
  // Copy only provenance/cell wrappers, never layer content or arbitrary raw values.
  const mappings = correspondence.mappings.map(mapping => Object.freeze({ ...mapping,
    ...('from' in mapping ? { from: Object.freeze({ ...mapping.from }) } : {}),
    ...('to' in mapping ? { to: Object.freeze({ ...mapping.to }) } : {}),
    ...(mapping.type === 'create' ? { cell: copyCell(mapping.cell) } : {}),
  })) as LayerMapping[];
  return { documentEdit: edit, before: state, after: update.state,
    correspondence: Object.freeze({ before: edit.before, after: edit.after, mappings: Object.freeze(mappings) }), overlayEffects: update.overlayEffects };
}
