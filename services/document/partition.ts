import type { AppState, PageTemplate, Variant } from '../../types';
import { resolveActiveLayerId } from '../layers';
import type { DocumentState, EditorPreferences, PartitionedState } from './contracts';
import { effect, primitive, retainWork, runSync, type Ownership, type Work } from '../../shared/cooperativeWork.js';
import { copyEnumerableWork, enumerableEntriesWork, jsonTextWork, utf8LengthWork } from '../../shared/jsonWork.js';

/** Exhaustive ownership: adding an AppState field requires an explicit decision. */
export const APP_STATE_FIELD_CLASSIFICATION = {
  nodes: 'document',
  rootId: 'document',
  variants: 'document',
  schemaVersion: 'document',
  generator: 'document',
  activeVariantId: 'preference',
  selectedNodeId: 'preference',
  selectedTemplateId: 'preference',
  scale: 'preference',
  viewMode: 'preference',
  sidebarWidth: 'preference',
  propertiesPanelWidth: 'preference',
  snapToGrid: 'preference',
  showGrid: 'preference',
  selectedNodeIds: 'transient',
  selectedTemplateIds: 'transient',
  selectedElementIds: 'transient',
  tool: 'transient',
  showJsonModal: 'transient',
  activeLayerId: 'transient',
  showLayersPanel: 'transient',
  showNodeSelector: 'transient',
  nodeSelectorMode: 'transient',
  editingElementId: 'transient',
  clipboard: 'transient',
  templatePreviewNodeId: 'transient',
} as const satisfies Record<keyof AppState, 'document' | 'preference' | 'transient'>;

const owns = (record: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(record, key);
const fieldEntries = Object.entries(APP_STATE_FIELD_CLASSIFICATION);
const address = (variantId: string, templateId: string, layerId: string): string =>
  JSON.stringify([variantId, templateId, layerId]);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

interface CompatibilityData extends Readonly<Record<string, unknown>> {
  state: Readonly<Record<string, unknown>>;
  // Historical validation allows duplicate/non-string IDs and non-boolean folds.
  // These cannot use the boolean preference map; retain raw presence by position.
  layerCollapsedExceptions: Readonly<Record<string, { value: unknown }>>;
}

/** Private ingress projection metadata. No external payload values or storage concepts. */
export type PartitionProjectionEvent =
  | { kind: 'state-field'; field: string; owner: 'document' | 'preference' | 'compatibility' }
  | { kind: 'template'; variantId: string; templateId: string; projection: { kind: 'borrow' } | {
    kind: 'layers'; fieldOrder: readonly string[]; length: number;
    present: readonly { index: number; fieldOrder: readonly string[] | null }[];
    folds: readonly { index: number; key: string; owner: 'boolean' | 'exception' }[];
  } };
export type PartitionProjectionSink = (event: PartitionProjectionEvent) => Work<void>;
interface LayerProjection {
  kind: 'layers'; fieldOrder: string[]; length: number;
  present: { index: number; fieldOrder: string[] | null }[];
  folds: { index: number; key: string; owner: 'boolean' | 'exception' }[];
}

function preferenceFields(preferences: EditorPreferences): Partial<AppState> {
  return Object.fromEntries(fieldEntries
    .filter(([field, owner]) => owner === 'preference' && owns(preferences, field))
    .map(([field]) => [field, preferences[field as keyof EditorPreferences]]));
}

/** Full nested walk, used only by ingress decomposition and explicit assembly. */
function* mapTemplatesWork(
  variants: Record<string, Variant>,
  map: (template: PageTemplate, variantId: string, templateId: string) => Work<PageTemplate>,
): Work<Record<string, Variant>> {
  const result: Record<string, Variant> = {};
  for (const [variantId, variant] of yield* enumerableEntriesWork(variants)) {
    const copy = yield* copyEnumerableWork(variant);
    const templates: Record<string, PageTemplate> = {};
    for (const [templateId, template] of yield* enumerableEntriesWork(variant.templates)) {
      const mapped = yield* map(template, variantId, templateId);
      yield* effect(1, () => defineData(templates, templateId, mapped));
    }
    yield* effect(1, () => { copy.templates = templates; defineData(result, variantId, copy); });
  }
  return result;
}

const defineData = (target: object, key: PropertyKey, value: unknown) => Object.defineProperty(target, key,
  { value, enumerable: true, configurable: true, writable: true });

function* withoutCollapsedWork(layer: Record<string, unknown>, recordField?: (key: string) => Work<void>): Work<Record<string, unknown>> {
  const result = {};
  for (const key of yield* primitive('keys', () => Reflect.ownKeys(layer))) {
    const selected = yield* effect(1, () => {
      if (key === 'collapsed' || !Object.getOwnPropertyDescriptor(layer, key)?.enumerable) return false;
      defineData(result, key, Reflect.get(layer, key)); return true;
    });
    if (selected && recordField) {
      if (typeof key !== 'string') throw new Error('Projection requires string fields');
      yield* recordField(key);
    }
  }
  return result;
}

/** Array.map presence semantics, including holes; no payload cloning. */
function* mapLayersWork(template: PageTemplate, map: (layer: unknown, index: number) => Work<unknown>,
  trace?: { projection: LayerProjection; owner: Ownership }): Work<PageTemplate> {
  const copy = yield* copyEnumerableWork(template);
  const source = template.layers!;
  const layers = new Array(source.length);
  for (let index = 0; index < layers.length; index += 1) {
    if (yield* effect(1, () => index in source)) layers[index] = yield* map(source[index], index);
  }
  copy.layers = layers;
  if (trace) {
    trace.projection.fieldOrder = yield* primitive('keys', () => {
      const keys = Object.keys(copy); trace.owner.grow(24 + keys.length * 8); return keys;
    });
    for (const key of trace.projection.fieldOrder) {
      const bytes = yield* utf8LengthWork(key); yield* effect(1, () => trace.owner.grow(bytes));
    }
  }
  return copy;
}

/**
 * Lossless ingress, not validation or migration. Own-property presence is the
 * presence record: missing fields stay missing; false/zero/undefined stay present.
 * Unknown state fields and serialized session values live in compatibility.state;
 * nested extensions remain on their owning records. Wrapper metadata is outside
 * AppState and must remain on its WorkspaceProject/WorkspaceCustomPreset owner.
 * Treat shared nodes, elements, generator and extensions as immutable thereafter.
 */
export function partitionState(state: AppState): PartitionedState {
  return runSync(partitionStateWork(state));
}

export function* partitionStateWork(state: AppState, recordProjection?: PartitionProjectionSink): Work<PartitionedState> {
  const entries = yield* enumerableEntriesWork(state as unknown as Record<string, unknown>);
  const owner = (field: string) => owns(APP_STATE_FIELD_CLASSIFICATION, field)
    ? APP_STATE_FIELD_CLASSIFICATION[field as keyof AppState] : 'compatibility';
  const document = {} as DocumentState;
  const preferences = {} as EditorPreferences;
  const compatibilityState = {};
  for (const [field, value] of entries) {
    const destination = yield* effect(1, () => {
      const kind = owner(field);
      defineData(kind === 'document' ? document : kind === 'preference' ? preferences : compatibilityState, field, value);
      return kind === 'document' || kind === 'preference' ? kind : 'compatibility';
    });
    if (recordProjection) {
      const lease = yield* retainWork(0);
      try {
        yield* effect(1, () => lease.grow(40));
        yield* recordProjection({ kind: 'state-field', field, owner: destination });
      } finally { lease.release(); }
    }
  }
  const layerCollapsed: Record<string, boolean> = {};
  const layerCollapsedExceptions: Record<string, { value: unknown }> = {};
  if (document.variants) {
    document.variants = yield* mapTemplatesWork(document.variants, function* (template, variantId, templateId) {
      const lease = recordProjection ? yield* retainWork(0) : undefined;
      try {
      if (lease) {
        yield* effect(1, () => lease.grow(72));
        const idsBytes = (yield* utf8LengthWork(variantId)) + (yield* utf8LengthWork(templateId));
        yield* effect(1, () => lease.grow(idsBytes));
      }
      if (!Array.isArray(template.layers)) {
        if (recordProjection) yield* recordProjection({ kind: 'template', variantId, templateId, projection: { kind: 'borrow' } });
        return template;
      }
      const projection: LayerProjection | undefined = lease ? yield* effect(1, () => {
        lease.grow(120); return { kind: 'layers' as const, length: template.layers!.length, fieldOrder: [], present: [], folds: [] };
      }) : undefined;
      const counts = new Map<string, number>();
      for (const layer of template.layers) {
        yield* effect(1, () => {
          if (isRecord(layer) && typeof layer.id === 'string') counts.set(layer.id, (counts.get(layer.id) ?? 0) + 1);
        });
      }
      const mapped = yield* mapLayersWork(template, function* (layer, index) {
        let cell: LayerProjection['present'][number] | undefined;
        if (projection) cell = yield* effect(1, () => {
          lease!.grow(40); const value = { index, fieldOrder: null }; projection.present.push(value); return value;
        });
        if (!isRecord(layer) || !owns(layer, 'collapsed')) return layer;
        const collapsed = layer.collapsed;
        if (cell) yield* effect(1, () => { lease!.grow(24); cell!.fieldOrder = []; });
        const content = yield* withoutCollapsedWork(layer, cell ? function* (key) {
          const bytes = yield* utf8LengthWork(key);
          yield* effect(1, () => { lease!.grow(8 + bytes); cell!.fieldOrder!.push(key); });
        } : undefined);
        const booleanOwner = typeof collapsed === 'boolean' && typeof layer.id === 'string' && counts.get(layer.id) === 1;
        const key = yield* jsonTextWork([variantId, templateId, booleanOwner ? layer.id : index]);
        if (booleanOwner) layerCollapsed[key] = collapsed as boolean;
        else layerCollapsedExceptions[key] = { value: collapsed };
        if (projection) {
          const bytes = yield* utf8LengthWork(key);
          yield* effect(1, () => {
            lease!.grow(48 + bytes); projection.folds.push({ index, key, owner: booleanOwner ? 'boolean' : 'exception' });
          });
        }
        return content;
      }, projection ? { projection, owner: lease! } : undefined);
      if (recordProjection) yield* recordProjection({ kind: 'template', variantId, templateId, projection: projection! });
      return mapped;
      } finally { lease?.release(); }
    });
  }
  return {
    document,
    preferences: Object.assign(preferences, {
      layerCollapsed,
      // No AppState panel-expansion field exists; new panel preferences stay separate.
      panelsExpanded: {},
    }),
    compatibility: {
      state: compatibilityState,
      layerCollapsedExceptions,
    } satisfies CompatibilityData,
  };
}

function projectTemplate(
  template: PageTemplate,
  variantId: string,
  templateId: string,
  collapsed: EditorPreferences['layerCollapsed'],
  exceptions: CompatibilityData['layerCollapsedExceptions'] = {},
): PageTemplate {
  if (!Array.isArray(template.layers)) return template;
  return { ...template, layers: template.layers.map((layer, index) => {
    if (!isRecord(layer)) return layer;
    const exceptionKey = JSON.stringify([variantId, templateId, index]);
    if (owns(exceptions, exceptionKey)) return { ...layer, collapsed: exceptions[exceptionKey].value as boolean };
    if (typeof layer.id !== 'string') return layer;
    const key = address(variantId, templateId, layer.id);
    return owns(collapsed, key) ? { ...layer, collapsed: collapsed[key] } : layer;
  }) };
}

/** Explicit full-state export/reconstruction. NEVER call for an ordinary save. */
export function assembleState(parts: PartitionedState): AppState {
  return runSync(assembleStateWork(parts));
}

export function* assembleStateWork(parts: PartitionedState): Work<AppState> {
  const compatibility = parts.compatibility as CompatibilityData;
  // Inputs are immutable views. Test membership once, without building addresses
  // for empty overlays; still perform the original template/array shallow copies.
  let hasExceptions: boolean | undefined;
  let hasCollapsed: boolean | undefined;
  const state = {} as AppState;
  for (const source of [compatibility.state, parts.document]) {
    for (const key of yield* primitive('keys', () => Reflect.ownKeys(source))) yield* effect(1, () => {
      if (Object.getOwnPropertyDescriptor(source, key)?.enumerable) defineData(state, key, Reflect.get(source, key));
    });
  }
  for (const [key, owner] of fieldEntries) yield* effect(1, () => {
    if (owner === 'preference' && owns(parts.preferences, key)) defineData(state, key, Reflect.get(parts.preferences, key));
  });
  if (state.variants) {
    state.variants = yield* mapTemplatesWork(state.variants, function* (template, variantId, templateId) {
      if (!Array.isArray(template.layers)) return template;
      return yield* mapLayersWork(template, function* (layer, index) {
        if (!isRecord(layer)) return layer;
        const exceptions = compatibility.layerCollapsedExceptions === undefined ? {} : compatibility.layerCollapsedExceptions;
        hasExceptions ??= (yield* primitive('keys', () => Reflect.ownKeys(exceptions))).length > 0;
        const exceptionKey = hasExceptions ? yield* jsonTextWork([variantId, templateId, index]) : undefined;
        let value: unknown;
        if (exceptionKey !== undefined && owns(exceptions, exceptionKey)) value = exceptions[exceptionKey].value;
        else {
          if (typeof layer.id !== 'string') return layer;
          hasCollapsed ??= (yield* primitive('keys', () => Reflect.ownKeys(parts.preferences.layerCollapsed))).length > 0;
          if (!hasCollapsed) return layer;
          const key = yield* jsonTextWork([variantId, templateId, layer.id]);
          if (!owns(parts.preferences.layerCollapsed, key)) return layer;
          value = parts.preferences.layerCollapsed[key];
        }
        const copy = yield* copyEnumerableWork(layer);
        defineData(copy, 'collapsed', value);
        return copy;
      });
    });
  }
  return state;
}

function existingId<T>(records: Record<string, T>, requested: string, fallback?: string): string {
  if (typeof requested === 'string' && owns(records, requested)) return requested;
  if (typeof fallback === 'string' && owns(records, fallback)) return fallback;
  // Only enumerate on a stale/missing reference, and stop at the first own key.
  for (const id in records) if (owns(records, id)) return id;
  return '';
}

/** Lightweight navigation resolution; never inspect inactive template contents. */
export function resolvePreferences(document: DocumentState, preferences: EditorPreferences): EditorPreferences {
  const variants = document.variants ?? {};
  const activeVariantId = existingId(variants, preferences.activeVariantId);
  const templates = owns(variants, activeVariantId) ? variants[activeVariantId].templates : {};
  return {
    viewMode: 'hierarchy', scale: 0.8, sidebarWidth: 288, propertiesPanelWidth: 320,
    snapToGrid: false, showGrid: false,
    ...preferences,
    activeVariantId,
    selectedNodeId: existingId(document.nodes ?? {}, preferences.selectedNodeId, document.rootId),
    selectedTemplateId: existingId(templates, preferences.selectedTemplateId),
  };
}

/** Rendering projection: only active template's layers, never all templates. */
export function projectActiveTemplate(document: DocumentState, preferences: EditorPreferences): PageTemplate | undefined {
  const resolved = resolvePreferences(document, preferences);
  const variants = document.variants ?? {};
  if (!owns(variants, resolved.activeVariantId)) return undefined;
  const templates = variants[resolved.activeVariantId].templates;
  const templateId = resolved.viewMode === 'hierarchy'
    ? document.nodes[resolved.selectedNodeId]?.type : resolved.selectedTemplateId;
  if (typeof templateId !== 'string' || !owns(templates, templateId)) return undefined;
  return projectTemplate(templates[templateId], resolved.activeVariantId, templateId, resolved.layerCollapsed);
}

/**
 * Live hydration is deliberately distinct from raw reconstruction. The document
 * remains normalized/shared; rendering uses projectActiveTemplate for fold UI.
 * Raw compatibility is not rewritten by safe session resets.
 */
export function hydrateState(parts: PartitionedState): AppState {
  const preferences = resolvePreferences(parts.document, parts.preferences);
  const template = projectActiveTemplate(parts.document, preferences);
  const activeLayerId = template ? resolveActiveLayerId({
    ...template,
    layers: Array.isArray(template.layers)
      ? template.layers.filter(layer => isRecord(layer) && typeof layer.id === 'string') : [],
  }) : '';
  const state = {
    ...(parts.compatibility as CompatibilityData).state, ...parts.document, ...preferenceFields(preferences),
    selectedNodeIds: preferences.selectedNodeId ? [preferences.selectedNodeId] : [],
    selectedTemplateIds: preferences.selectedTemplateId ? [preferences.selectedTemplateId] : [],
    selectedElementIds: [], tool: 'select', showJsonModal: false, showNodeSelector: false,
    nodeSelectorMode: 'grid_source', editingElementId: null, clipboard: [],
    activeLayerId, showLayersPanel: false,
  } as AppState;
  delete state.templatePreviewNodeId;
  return state;
}
