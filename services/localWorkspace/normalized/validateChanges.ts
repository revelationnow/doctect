import type { PageTemplate } from '../../../types';
import { effect, primitive, retainWork, type Work, type Ownership } from '../../../shared/cooperativeWork.js';
import { equalFrameWork, jsonTextWork, orderedJsonWork, textWork, utf8LengthWork } from '../../../shared/jsonWork.js';
import type { DocumentChange, DocumentEdit, DocumentState, RecordAddress } from '../../document/contracts';
import { affectedReferences, type ReferenceIndex } from '../../document/references';
import { APP_STATE_FIELD_CLASSIFICATION } from '../../document/partition';
import { canonicalStringify } from '../canonical';
import { frameRecord, validateLineage, safeCounter } from './commitProof';
import { validateAppNode, validatePageTemplate, validateVariantMetadata } from '../../../shared/validateAppState.js';
import { validateGeneratorProvenance } from '../../../shared/generatorMetadata.js';
import { MAX_ELEMENTS, MAX_NODES, MAX_STATE_BYTES, MAX_VARIANTS } from '../../../shared/projectLimits.js';
import { applySizeChanges, type NormalizedProjectSlice, type SizeLedger } from './sizeLedger';
import { NORMALIZED_DB_VERSION, type NormalizedRecordTypes, type ProjectExtension, type ProjectHeader,
  type NormalizedRecord, type ProjectKey, type ProjectPreferences, type ProjectScope, type ProjectStoreName, type VariantKey, type ProjectMetadataEdit } from './schema';

export interface ValidationContext {
  scope: ProjectScope;
  header: ProjectHeader;
  ledger: SizeLedger;
  references: ReferenceIndex;
  folds: FoldOverlayIndex;
  read<S extends ProjectStoreName>(store: S, key: readonly string[]): NormalizedRecordTypes[S] | undefined;
  /** Current, already reconciled overlays for a structural edit. Not history cells
   * or authorization to overwrite another tab. Task 7 owns durable relocation.
   */
  reconciledOverlays?: { preferences: ProjectPreferences; exceptions: ProjectExtension; folds?: FoldOverlayChanges };
  resolveOverlays?(templates: readonly { address: FoldAddress; before?: PageTemplate; after?: PageTemplate }[]): ValidationContext['reconciledOverlays'];
  /** Scalar patches may defer stale document/fold caches. Both overlay maps must
   * remain the identical authoritative input maps; no cache receipt is produced.
   */
  scalarPreferencesOnly?: boolean;
}
export type PreparedPut = { [S in ProjectStoreName]: { store: S; record: NormalizedRecordTypes[S]; digest: string; bytes: number } }[ProjectStoreName];
export interface PreparedChanges {
  puts: readonly PreparedPut[];
  deletes: readonly { store: ProjectStoreName; key: readonly string[]; digest: string }[];
  ledger: SizeLedger;
  counterDeltas: SizeLedger;
  affectedReferences: readonly RecordAddress[];
  /** Selected before/after projections only, for updateReferenceIndex AFTER a
   * successful durable commit. Never publish on rejection/failed transaction.
   * Bulk replacement must rebind the owner to a freshly built index (Task 10 UI).
   */
  referenceEdit: DocumentEdit;
  /** Publish alongside referenceEdit only after verified durable success. */
  foldEdit?: FoldIndexEdit;
  before: NormalizedProjectSlice;
  after: NormalizedProjectSlice;
}

type FoldAddress = { readonly variantId: string; readonly templateId: string };
type PreferenceFolds = ProjectPreferences['value']['layerCollapsed'];
type ExceptionFolds = ProjectExtension['value'];
interface FoldBucket { preferenceKeys: readonly string[]; exceptionKeys: readonly string[] }
/** Complete replacement of ONE template's physical fold bucket, from authoritative
 * reconciliation/occurrence effects, never from client dirty-map discovery.
 */
export interface NormalizedFoldEffect extends FoldAddress {
  readonly preferences: PreferenceFolds;
  readonly exceptions: ExceptionFolds;
}
export interface FoldOverlayIndex { readonly scope: readonly string[] }
export interface FoldOverlayChanges {
  readonly layerCollapsed: PreferenceFolds;
  readonly exceptions: ExceptionFolds;
}
export interface FoldIndexEdit { readonly changes: FoldOverlayChanges }
interface FoldCache { layerCollapsed: PreferenceFolds; exceptions: ExceptionFolds; buckets: Map<string, FoldBucket>; version: number }
interface FoldDraft {
  owner: FoldOverlayIndex;
  version: number;
  buckets: Map<string, FoldBucket>;
  addresses: readonly FoldAddress[];
}
const foldCaches = new WeakMap<FoldOverlayIndex, FoldCache>();
const foldDrafts = new WeakMap<FoldOverlayChanges, FoldDraft>();
const foldPublications = new WeakMap<FoldIndexEdit, FoldDraft>();
const foldKey = (address: FoldAddress) => JSON.stringify([address.variantId, address.templateId]);
const emptyBucket: FoldBucket = { preferenceKeys: [], exceptionKeys: [] };

function foldAddress(key: string, positional: boolean): FoldAddress {
  const tuple = JSON.parse(key);
  requireValue(Array.isArray(tuple) && tuple.length === 3 && typeof tuple[0] === 'string' && typeof tuple[1] === 'string'
    && (positional ? Number.isInteger(tuple[2]) && tuple[2] >= 0 : typeof tuple[2] === 'string')
    && JSON.stringify(tuple) === key, 'Invalid fold address');
  return { variantId: tuple[0], templateId: tuple[1] };
}

/** Bulk ingress/replacement ONLY, after complete admission. Admitted records and
 * their payloads remain immutable. Rebind the owner on replacement, even if IDs
 * match. Ordinary preparation never builds or lazily repairs this index.
 */
export function createFoldOverlayIndex(preferences: ProjectPreferences, exceptions: ProjectExtension): FoldOverlayIndex {
  const index = Object.freeze({ scope: Object.freeze([...preferences.key]) });
  requireValue(JSON.stringify(exceptions.key) === JSON.stringify([...index.scope, 'folds']), 'Fold index scope mismatch');
  const buckets = new Map<string, { preferenceKeys: string[]; exceptionKeys: string[] }>();
  for (const [map, positional] of [[preferences.value.layerCollapsed, false], [exceptions.value, true]] as const) {
    for (const key of Object.keys(map)) {
      const id = foldKey(foldAddress(key, positional));
      let bucket = buckets.get(id);
      if (!bucket) { bucket = { preferenceKeys: [], exceptionKeys: [] }; buckets.set(id, bucket); }
      (positional ? bucket.exceptionKeys : bucket.preferenceKeys).push(key);
    }
  }
  foldCaches.set(index, { layerCollapsed: preferences.value.layerCollapsed, exceptions: exceptions.value, buckets, version: 0 });
  return index;
}

/** Cooperative counterpart for replacement; never used to repair ordinary-save caches. */
export function* createFoldOverlayIndexWork(preferences: ProjectPreferences, exceptions: ProjectExtension, custody?: Ownership): Work<FoldOverlayIndex> {
  const lease = custody ?? (yield* retainWork(0));
  try {
    yield* effect(1, () => lease.grow(128));
    const index = Object.freeze({ scope: Object.freeze([...preferences.key]) });
    requireValue(yield* equalFrameWork(emit => orderedJsonWork(exceptions.key, emit),
      emit => orderedJsonWork([...index.scope, 'folds'], emit)), 'Fold index scope mismatch');
    const buckets = new Map<string, { preferenceKeys: string[]; exceptionKeys: string[] }>();
    for (const [map, positional] of [[preferences.value.layerCollapsed, false], [exceptions.value, true]] as const) {
      const keys = yield* primitive('keys', () => Object.keys(map));
      for (const key of keys) {
        let tuple: unknown;
        yield* primitive('parse', () => { tuple = JSON.parse(key); });
        requireValue(Array.isArray(tuple) && tuple.length === 3 && typeof tuple[0] === 'string' && typeof tuple[1] === 'string'
          && (positional ? Number.isInteger(tuple[2]) && tuple[2] >= 0 : typeof tuple[2] === 'string'), 'Invalid fold address');
        requireValue(yield* equalFrameWork(emit => orderedJsonWork(tuple, emit), emit => textWork(key, emit)), 'Invalid fold address');
        const id = yield* jsonTextWork([tuple[0], tuple[1]]), bytes = yield* utf8LengthWork(id);
        yield* effect(1, () => {
          let bucket = buckets.get(id);
          if (!bucket) { bucket = { preferenceKeys: [], exceptionKeys: [] }; buckets.set(id, bucket); lease.grow(bytes + 64); }
          (positional ? bucket.exceptionKeys : bucket.preferenceKeys).push(key); lease.grow(8);
        });
      }
    }
    yield* effect(1, () => { foldCaches.set(index, { layerCollapsed: preferences.value.layerCollapsed, exceptions: exceptions.value, buckets, version: 0 }); });
    return index;
  } finally { if (!custody) lease.release(); }
}

/** Stage explicit selected buckets without publishing. Shallow physical-map
 * copies are necessary when these records change (as in layerFolds.ts); removal
 * discovery uses cached before keys only. New keys come only from supplied effects.
 * The owned maps must be used verbatim in reconciledOverlays, so an unannounced
 * changed bucket cannot bypass validation. No whole-map diff or after-index rebuild.
 */
export function prepareFoldOverlayChanges(index: FoldOverlayIndex, effects: readonly NormalizedFoldEffect[]): FoldOverlayChanges {
  const cache = foldCaches.get(index); requireValue(cache, 'Missing fold index');
  const buckets = new Map<string, FoldBucket>(); const addresses: FoldAddress[] = [];
  if (!effects.length) {
    const changes = Object.freeze({ layerCollapsed: cache.layerCollapsed, exceptions: cache.exceptions });
    foldDrafts.set(changes, { owner: index, version: cache.version, buckets, addresses });
    return changes;
  }
  const layerCollapsed = { ...cache.layerCollapsed };
  const exceptions = { ...cache.exceptions };
  for (const effect of effects) {
    const fields = dataFields(effect);
    const variantId = fields.variantId?.value; const templateId = fields.templateId?.value;
    requireValue(typeof variantId === 'string' && typeof templateId === 'string', 'Invalid fold effect address');
    const address = { variantId, templateId }; const id = foldKey(address);
    requireValue(!buckets.has(id), 'Duplicate fold effect');
    const old = cache.buckets.get(id) ?? emptyBucket;
    for (const key of old.preferenceKeys) delete layerCollapsed[key];
    for (const key of old.exceptionKeys) delete exceptions[key];
    const bucket = { preferenceKeys: [] as string[], exceptionKeys: [] as string[] };
    for (const [map, positional] of [[fields.preferences?.value, false], [fields.exceptions?.value, true]] as const) {
      for (const [key, descriptor] of Object.entries(dataFields(map))) {
        requireValue(foldKey(foldAddress(key, positional)) === id, 'Fold effect key belongs to another template');
        if (positional) {
          const cell = dataFields(descriptor.value);
          requireValue(Object.keys(cell).length === 1 && cell.value, 'Invalid fold exception');
          external(cell.value.value, 8);
          exceptions[key] = Object.freeze({ value: cell.value.value }); bucket.exceptionKeys.push(key);
        } else {
          requireValue(typeof descriptor.value === 'boolean', 'Invalid boolean preferences');
          layerCollapsed[key] = descriptor.value; bucket.preferenceKeys.push(key);
        }
      }
    }
    buckets.set(id, bucket); addresses.push(address);
  }
  const changes = Object.freeze({ layerCollapsed: Object.freeze(layerCollapsed), exceptions: Object.freeze(exceptions) });
  foldDrafts.set(changes, { owner: index, version: cache.version, buckets, addresses });
  return changes;
}

/** Single live derived-cache owner, selected publication only. Not a structural
 * generation protocol: Tasks 7–9/12 still resolve authoritative effects, durable
 * concurrency and incarnation/generation admission before using this pure seam.
 */
export function publishFoldOverlayChanges(index: FoldOverlayIndex, edit: FoldIndexEdit | undefined): void {
  if (!edit) return;
  preflightFoldPublication(index, edit);
  const draft = foldPublications.get(edit); const cache = foldCaches.get(index);
  requireValue(cache && draft && draft.owner === index && draft.version === cache.version, 'Stale fold publication');
  for (const [key, bucket] of draft.buckets) {
    if (bucket.preferenceKeys.length || bucket.exceptionKeys.length) cache.buckets.set(key, bucket);
    else cache.buckets.delete(key);
  }
  cache.layerCollapsed = edit.changes.layerCollapsed; cache.exceptions = edit.changes.exceptions; cache.version++;
}

export function preflightFoldPublication(index: FoldOverlayIndex, edit: FoldIndexEdit | undefined): void {
  if (!edit) return;
  const draft = foldPublications.get(edit); const cache = foldCaches.get(index);
  requireValue(cache && draft && draft.owner === index && draft.version === cache.version, 'Stale fold publication');
}

export interface AuthoritativeFoldRefresh { preferences: ProjectPreferences; exceptions: ProjectExtension; effects: readonly NormalizedFoldEffect[] }
export function prepareAuthoritativeFoldRefresh(index: FoldOverlayIndex, refresh: AuthoritativeFoldRefresh): FoldIndexEdit {
  requireValue(JSON.stringify(refresh.preferences.key) === JSON.stringify(index.scope)
    && JSON.stringify(refresh.exceptions.key) === JSON.stringify([...index.scope, 'folds']), 'Fold refresh scope mismatch');
  const staged = prepareFoldOverlayChanges(index, refresh.effects);
  const draft = foldDrafts.get(staged)!;
  // The durable owner verifies contiguous change coverage before calling this seam.
  // Use fresh IDB maps verbatim; no global dirty-map discovery or index rebuild.
  for (const effect of refresh.effects) {
    for (const key of Object.keys(effect.preferences)) requireValue(refresh.preferences.value.layerCollapsed[key] === effect.preferences[key], 'Fold refresh mismatch');
    for (const key of Object.keys(effect.exceptions)) requireValue(canonicalStringify(refresh.exceptions.value[key]) === canonicalStringify(effect.exceptions[key]), 'Fold refresh mismatch');
  }
  const edit = Object.freeze({ changes: Object.freeze({ layerCollapsed: refresh.preferences.value.layerCollapsed, exceptions: refresh.exceptions.value }) });
  foldPublications.set(edit, draft);
  return edit;
}

// FIPS 180-4 SHA-256. Unsigned 32-bit additions intentionally reduce modulo 2^32.
// Private primitive: selected-record readback reuses digestNormalizedRecord only.
function sha256(text: string): string {
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const input = new TextEncoder().encode(text);
  const padded = new Uint8Array(Math.ceil((input.length + 9) / 64) * 64);
  padded.set(input); padded[input.length] = 0x80;
  const view = new DataView(padded.buffer); const bits = input.length * 8;
  view.setUint32(padded.length - 8, Math.floor(bits / 0x100000000)); view.setUint32(padded.length - 4, bits >>> 0);
  const w = new Uint32Array(64); const rotate = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]; const b = w[i - 2];
      w[i] = (w[i - 16] + (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) + w[i - 7]
        + (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10))) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + k[i] + w[i]) >>> 0;
      const t2 = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    for (const [i, value] of [a, b, c, d, e, f, g, hh].entries()) h[i] = (h[i] + value) >>> 0;
  }
  return h.map(value => value.toString(16).padStart(8, '0')).join('');
}

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object'
  && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function dataFields(value: unknown): Record<string, PropertyDescriptor> {
  requireValue(object(value), 'Expected a JSON-compatible plain object');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(value)) requireValue(typeof key === 'string' && descriptors[key].enumerable
    && Object.hasOwn(descriptors[key], 'value'), 'JSON-compatible data required; getters/accessors are not supported');
  return descriptors;
}
function external(value: unknown, depth: number): void {
  // Only a fixed ancestor path, never a project. Reuse the canonical validator's
  // exact depth/descriptor rules without consuming storage-envelope ancestry.
  let framed = value;
  for (let i = 0; i < depth; i++) framed = { value: framed };
  canonicalStringify(framed);
}

/** SHA-256(UTF8('["doctect-normalized-record-v1",' + canonical(store) + ','
 * + canonical-record-object + ']')). The object's sorted own data fields are
 * individually canonicalized before framing, binding ALL physical fields while
 * charging no private ancestry against external depth. Digest is NOT a field of
 * the record. This private format does not replace public/cloud workspace hashes.
 */
export function digestNormalizedRecord(store: ProjectStoreName, record: NormalizedRecordTypes[ProjectStoreName]): string {
  return sha256(frameRecord(store, record));
}
export const hashNormalizedText = (text: string): string => sha256(text);

type PhysicalRecord = NormalizedRecordTypes[ProjectStoreName];
interface Selected { store: ProjectStoreName; key: string[]; before?: PhysicalRecord; after?: PhysicalRecord; written: boolean }
function makeRecord<const K extends string[], V>(key: K, value: V): NormalizedRecord<K, V> {
  return { key, formatVersion: NORMALIZED_DB_VERSION, value, encodedSize: { valueBytes: bytes(value) } };
}
const own = <T>(map: Record<string, T>, key: string) => Object.hasOwn(map, key) ? map[key] : undefined;

/** All reads are synchronous selected-record reads from an admitted cache, not
 * IndexedDB requests. No mutation of context, payloads, counters or live index.
 */
export function validateIncrementalChanges(context: ValidationContext, changes: readonly DocumentChange[], metadata?: ProjectMetadataEdit): PreparedChanges {
  if (context.scalarPreferencesOnly) requireValue(changes.length === 0 && metadata === undefined, 'Scalar preparation cannot change documents');
  const prefix: ProjectKey = [context.scope.storageGeneration, context.scope.projectId, context.scope.incarnation];
  const selected = new Map<string, Selected>(); const addresses = new Map<string, RecordAddress>();
  const templateIntents = new Map<string, Map<string, { present: boolean; removed: boolean }>>();
  let header = context.header;
  let foldChanges: FoldOverlayChanges | undefined;
  requireValue(header.incarnation === prefix[2] && JSON.stringify(header.key) === JSON.stringify(prefix.slice(0, 2)), 'Header scope mismatch');
  const touch = (address: RecordAddress) => addresses.set(JSON.stringify(address), address);
  function entry<S extends ProjectStoreName>(store: S, key: readonly string[]): Selected {
    const id = JSON.stringify([store, key]); let item = selected.get(id);
    if (!item) {
      const old = store === 'projectHeaders' ? context.header : context.read(store, key);
      item = { store, key: [...key], before: old, after: old, written: false }; selected.set(id, item);
    }
    return item;
  }
  function read<S extends ProjectStoreName>(store: S, key: readonly string[]): NormalizedRecordTypes[S] | undefined {
    return entry(store, key).after as NormalizedRecordTypes[S] | undefined;
  }
  function write<S extends ProjectStoreName>(store: S, key: readonly string[], record?: NormalizedRecordTypes[S]) {
    const item = entry(store, key); item.after = record; item.written = true;
  }
  function membership(field: 'nodes' | 'variants' | 'state', id: string, present: boolean) {
    const order = header.order[field]; if (order.includes(id) === present) return;
    header = { ...header, order: { ...header.order, [field]: present ? [...order, id] : order.filter(key => key !== id) } };
  }
  function templateMembership(variantId: string, templateId: string, present: boolean) {
    const key = [...prefix, variantId]; const variant = read('projectVariants', key);
    requireValue(variant || !present, `Template change requires variant ${variantId}`);
    if (!variant || variant.templateOrder.includes(templateId) === present) return;
    write('projectVariants', key, { ...variant, templateOrder: present ? [...variant.templateOrder, templateId]
      : variant.templateOrder.filter(id => id !== templateId) });
  }
  function intendTemplate(variantId: string, templateId: string, present: boolean) {
    if (!templateIntents.has(variantId)) templateIntents.set(variantId, new Map());
    const intents = templateIntents.get(variantId)!; const previous = intents.get(templateId);
    // Keep only the final insertion position, but never forget an earlier removal.
    // Parent existence is still checked after the entire semantic action, not here.
    if (present && previous && !previous.present) intents.delete(templateId);
    intents.set(templateId, { present, removed: !present || !!previous?.removed });
  }
  // Validate command descriptors before reading discriminants or payloads. The
  // optional undefined generator means deletion; it is not persisted JSON.
  for (const change of changes) {
    const fields = dataFields(change); const type = fields.type?.value;
    const payload = type === 'put-node' ? fields.node?.value : type === 'put-template' ? fields.template?.value
      : type === 'put-variant' ? fields.variant?.value : undefined;
    if (payload !== undefined) external(payload, type === 'put-template' ? 5 : 3);
    const id = (value: unknown): string => { requireValue(typeof value === 'string', 'Change identity must be a string'); return value; };
    switch (type) {
      case 'put-node': {
        const node = change as Extract<DocumentChange, { type: 'put-node' }>;
        const nodeId = id(payload?.id); const result = validateAppNode(nodeId, node.node); requireValue(result.ok, result.error ?? 'Invalid node');
        write('projectNodes', [...prefix, nodeId], makeRecord([...prefix, nodeId], node.node));
        membership('nodes', nodeId, true); touch({ kind: 'node', nodeId }); break;
      }
      case 'delete-node': {
        const nodeId = id(fields.nodeId?.value); write('projectNodes', [...prefix, nodeId]);
        membership('nodes', nodeId, false); touch({ kind: 'node', nodeId }); break;
      }
      case 'put-variant': {
        const variantId = id(payload?.id); const result = validateVariantMetadata(variantId, payload);
        requireValue(result.ok, result.error ?? 'Invalid variant'); requireValue(!Object.hasOwn(payload, 'templates'), 'put-variant changes metadata only');
        const key: VariantKey = [...prefix, variantId]; const old = read('projectVariants', key);
        const { id: valueId, name, ...extensions } = payload;
        write('projectVariants', key, { ...makeRecord(key, { id: valueId, name }), fieldOrder: [...Object.keys(payload), 'templates'], templateOrder: old?.templateOrder ?? [] });
        const extKey = [...prefix, 'variant', variantId]; write('projectExtensions', extKey, makeRecord(extKey, extensions) as ProjectExtension);
        membership('variants', variantId, true); touch({ kind: 'variant', variantId }); break;
      }
      case 'delete-variant': {
        const variantId = id(fields.variantId?.value); const key = [...prefix, variantId]; const old = read('projectVariants', key);
        for (const templateId of new Set([...(old?.templateOrder ?? []), ...(templateIntents.get(variantId)?.keys() ?? [])])) {
          write('projectTemplates', [...key, templateId]); touch({ kind: 'template', variantId, templateId });
          intendTemplate(variantId, templateId, false);
        }
        write('projectVariants', key); write('projectExtensions', [...prefix, 'variant', variantId]);
        membership('variants', variantId, false); touch({ kind: 'variant', variantId }); break;
      }
      case 'put-template': {
        const variantId = id(fields.variantId?.value); const templateId = id(payload?.id);
        const result = validatePageTemplate(variantId, templateId, payload, header.document.schemaVersion);
        requireValue(result.ok, result.error ?? 'Invalid template');
        for (const layer of payload.layers ?? []) requireValue(!object(layer) || !Object.hasOwn(layer, 'collapsed'), 'Document layers must exclude collapsed; supply reconciled overlays');
        const key = [...prefix, variantId, templateId]; write('projectTemplates', key, makeRecord(key, payload) as NormalizedRecordTypes['projectTemplates']);
        intendTemplate(variantId, templateId, true); touch({ kind: 'template', variantId, templateId }); break;
      }
      case 'delete-template': {
        const variantId = id(fields.variantId?.value); const templateId = id(fields.templateId?.value);
        write('projectTemplates', [...prefix, variantId, templateId]); intendTemplate(variantId, templateId, false);
        touch({ kind: 'template', variantId, templateId }); break;
      }
      case 'set-root': {
        const rootId = id(fields.rootId?.value); header = { ...header, document: { ...header.document, rootId } };
        touch({ kind: 'root' }); break;
      }
      case 'set-generator': {
        const generator = fields.generator?.value;
        if (generator !== undefined) {
          external(generator, 2); const result = validateGeneratorProvenance(generator, { strictUnknownFields: true });
          requireValue(result.ok, result.message ?? 'Invalid generator');
        }
        write('projectSources', prefix, generator === undefined ? undefined : makeRecord(prefix, generator) as NormalizedRecordTypes['projectSources']);
        membership('state', 'generator', generator !== undefined); touch({ kind: 'generator' }); break;
      }
      default: throw new Error('Unknown document change');
    }
  }
  for (const [variantId, intents] of templateIntents) {
    for (const [templateId, intent] of intents) if (intent.removed) templateMembership(variantId, templateId, false);
    for (const [templateId, intent] of intents) if (intent.present) templateMembership(variantId, templateId, true);
  }
  requireValue(header.order.nodes.includes(header.document.rootId), 'rootId must reference an existing node');
  requireValue(header.order.variants.length > 0, 'variants must be a non-empty object');
  if (metadata !== undefined) {
    const fields = dataFields(metadata); const kind = fields.kind?.value;
    requireValue(kind === 'linked-root' || kind === 'patch', 'Unknown project metadata operation');
    const allowed = kind === 'linked-root' ? ['kind', 'name'] : ['kind', 'name', 'cloud'];
    requireValue(Object.keys(fields).every(key => allowed.includes(key)), 'Unknown project metadata field');
    const value = { ...header.value };
    if (kind === 'linked-root') {
      requireValue(typeof fields.name?.value === 'string', 'Invalid linked project name');
      const rootChanged = addresses.has(JSON.stringify({ kind: 'root' }))
        || addresses.has(JSON.stringify({ kind: 'node', nodeId: header.document.rootId }));
      requireValue(rootChanged, 'Linked name requires a root document change');
      const root = read('projectNodes', [...prefix, header.document.rootId]);
      requireValue(root && root.value.title === fields.name.value, 'Linked project name must match final root title');
      // Even a pointer-only root change binds the observed root contents into
      // the same transaction and selected postconditions as its linked name.
      write('projectNodes', root.key, root);
      value.name = fields.name.value;
    } else {
      requireValue(changes.length === 0 && (fields.name || fields.cloud), 'Metadata patch must be a separate nonempty operation');
      if (fields.name) {
        requireValue(typeof fields.name.value === 'string', 'Project name must be a string'); value.name = fields.name.value;
      }
      if (fields.cloud) {
        const cloud = dataFields(fields.cloud.value); const type = cloud.type?.value;
        requireValue(type === 'set' || type === 'remove', 'Invalid cloud metadata operation');
        requireValue(Object.keys(cloud).length === (type === 'set' ? 2 : 1)
          && Object.keys(cloud).every(key => key === 'type' || type === 'set' && key === 'value'), 'Invalid cloud metadata fields');
        const key = [...prefix, 'cloud'];
        if (type === 'remove') {
          delete value.cloud; write('projectExtensions', key);
        } else {
          requireValue(cloud.value, 'Missing cloud metadata value');
          external(cloud.value.value, 1);
          const contents = dataFields(cloud.value.value);
          requireValue(typeof contents.projectId?.value === 'string' && typeof contents.lastSyncedCommitId?.value === 'string', 'Invalid cloud linkage');
          const entries = Object.entries(contents).map(([key, descriptor]) => [key, descriptor.value] as const);
          value.cloud = Object.fromEntries(entries.filter(([key]) => key === 'projectId' || key === 'lastSyncedCommitId')) as NonNullable<ProjectHeader['value']['cloud']>;
          const extension = Object.fromEntries(entries.filter(([key]) => key !== 'projectId' && key !== 'lastSyncedCommitId'));
          write('projectExtensions', key, makeRecord(key, extension) as ProjectExtension);
        }
        const order = header.order.wrapper;
        const present = type === 'set';
        if (order.includes('cloud') !== present) header = { ...header, order: { ...header.order,
          wrapper: present ? [...order, 'cloud'] : order.filter(key => key !== 'cloud') } };
      }
    }
    header = { ...header, value };
  }
  if (header !== context.header) {
    header = { ...header, encodedSize: { valueBytes: header.value === context.header.value ? header.encodedSize.valueBytes : bytes(header.value),
      documentBytes: bytes(header.document) } };
    write('projectHeaders', header.key, header);
  }

  const templates = [...addresses.values()].filter((a): a is Extract<RecordAddress, { kind: 'template' }> => a.kind === 'template');
  const overlays = context.resolveOverlays ? context.resolveOverlays(templates.map(address => {
    const item = entry('projectTemplates', [...prefix, address.variantId, address.templateId]);
    return { address: { variantId: address.variantId, templateId: address.templateId },
      before: (item.before as NormalizedRecordTypes['projectTemplates'] | undefined)?.value,
      after: (item.after as NormalizedRecordTypes['projectTemplates'] | undefined)?.value };
  })) : context.reconciledOverlays;
  if (templates.length || overlays) {
    const current = read('projectPreferences', prefix); const oldExceptions = read('projectExtensions', [...prefix, 'folds']);
    requireValue(current && oldExceptions, 'Missing current fold overlays');
    const cache = foldCaches.get(context.folds);
    const scalar = context.scalarPreferencesOnly === true;
    if (scalar) requireValue(changes.length === 0 && templates.length === 0 && overlays && !overlays.folds
      && overlays.preferences.value.layerCollapsed === current.value.layerCollapsed && overlays.exceptions === oldExceptions, 'Scalar preparation cannot change fold maps');
    requireValue(cache && JSON.stringify(context.folds.scope) === JSON.stringify(prefix)
      && (scalar || cache.layerCollapsed === current.value.layerCollapsed && cache.exceptions === oldExceptions.value), 'Stale fold index; rebind at ingress/replacement');
    const preferences = overlays?.preferences ?? current;
    const exceptions = overlays?.exceptions ?? oldExceptions;
    if (overlays) validateOverlayRecords(preferences, exceptions, prefix, current, oldExceptions);
    foldChanges = overlays?.folds;
    const draft = foldChanges && foldDrafts.get(foldChanges);
    if (foldChanges) requireValue(draft && draft.owner === context.folds && draft.version === cache.version, 'Stale fold effects');
    requireValue(preferences.value.layerCollapsed === (scalar ? current.value.layerCollapsed : foldChanges?.layerCollapsed ?? cache.layerCollapsed)
      && exceptions.value === (scalar ? oldExceptions.value : foldChanges?.exceptions ?? cache.exceptions), 'Unannounced fold maps; supply authoritative bucket effects');
    let overlayBytes = current.encodedSize.templateOverlayBytes;
    const foldTargets = new Map(templates.map(address => [JSON.stringify([address.variantId, address.templateId]), address]));
    for (const address of draft?.addresses ?? []) foldTargets.set(foldKey(address), { kind: 'template', ...address });
    for (const address of foldTargets.values()) {
      const stored = read('projectTemplates', [...prefix, address.variantId, address.templateId]);
      const key = foldKey(address);
      const bucket = draft?.buckets.get(key) ?? cache.buckets.get(key) ?? emptyBucket;
      const delta = foldBytes(stored?.value, address, preferences, exceptions, bucket);
      if (delta !== (own(overlayBytes, key) ?? 0)) {
        if (overlayBytes === current.encodedSize.templateOverlayBytes) overlayBytes = { ...overlayBytes };
        if (delta) overlayBytes[key] = delta; else delete overlayBytes[key];
      }
    }
    if (preferences !== current || overlayBytes !== current.encodedSize.templateOverlayBytes)
      write('projectPreferences', prefix, { ...preferences, encodedSize: { valueBytes: bytes(preferences.value), templateOverlayBytes: overlayBytes } });
    if (exceptions !== oldExceptions) write('projectExtensions', [...prefix, 'folds'], exceptions);
  }
  // Preserve complete validation's active-variant rule; stale node/template
  // links and missing type/grid targets remain permitted fallback semantics.
  if (header.order.variants !== context.header.order.variants || overlays) {
    const preferences = read('projectPreferences', prefix);
    requireValue(preferences && header.order.variants.includes(preferences.value.activeVariantId), 'activeVariantId must reference an existing variant');
  }

  const before: NormalizedProjectSlice = {}; const after: NormalizedProjectSlice = {};
  const puts: PreparedPut[] = []; const deletes: { store: ProjectStoreName; key: string[]; digest: string }[] = [];
  function add(slice: NormalizedProjectSlice, store: ProjectStoreName, record: PhysicalRecord) {
    const map = (slice[store] ?? new Map()) as Map<string, PhysicalRecord>; map.set(JSON.stringify(record.key), record);
    Object.assign(slice, { [store]: map });
  }
  for (const item of selected.values()) if (item.written) {
    if (item.before) add(before, item.store, item.before);
    if (item.after) {
      add(after, item.store, item.after);
      puts.push({ store: item.store, record: item.after, bytes: item.after.encodedSize.valueBytes,
        digest: digestNormalizedRecord(item.store, item.after) } as PreparedPut);
    } else if (item.before) deletes.push({ store: item.store, key: item.key, digest: digestNormalizedRecord(item.store, item.before) });
  }
  const ledger = applySizeChanges(context.ledger, before, after);
  requireValue(ledger.stateBytes <= MAX_STATE_BYTES, `state exceeds ${MAX_STATE_BYTES} bytes`);
  requireValue(ledger.nodeCount <= MAX_NODES, 'too many nodes (max 20000)');
  requireValue(ledger.variantCount <= MAX_VARIANTS, 'too many variants (max 50)');
  requireValue(ledger.elementCount <= MAX_ELEMENTS, 'too many elements (max 50000)');
  const affected = [...addresses.values()];
  // Capture old dependents now. The live single-owner index is NEVER updated here.
  const dependents = affectedReferences(context.references, affected);
  const referenceEdit = { before: referenceProjection(context.header, before), after: referenceProjection(header, after), changes, affected };
  const counterDeltas = Object.fromEntries(Object.keys(ledger).map(key => [key, ledger[key as keyof SizeLedger] - context.ledger[key as keyof SizeLedger]])) as unknown as SizeLedger;
  const foldEdit = foldChanges ? Object.freeze({ changes: foldChanges }) : undefined;
  if (foldEdit) foldPublications.set(foldEdit, foldDrafts.get(foldChanges!)!);
  return { puts, deletes, ledger, counterDeltas, affectedReferences: dependents, referenceEdit, foldEdit, before, after };
}

/** Final lineage is installed before this last accounting/digest pass, never in IDB. */
export function finalizePreparedChanges(base: SizeLedger, prepared: PreparedChanges, oldHeader: ProjectHeader,
  oldPreferences: ProjectPreferences, header?: ProjectHeader, preferences?: ProjectPreferences): PreparedChanges {
  const before = { ...prepared.before }; const after = { ...prepared.after };
  if (header) {
    before.projectHeaders = new Map([[JSON.stringify(oldHeader.key), oldHeader]]);
    after.projectHeaders = new Map([[JSON.stringify(header.key), { ...header, encodedSize: { valueBytes: bytes(header.value), documentBytes: bytes(header.document) } }]]);
  }
  if (preferences) {
    before.projectPreferences = new Map([[JSON.stringify(oldPreferences.key), oldPreferences]]);
    after.projectPreferences = new Map([[JSON.stringify(preferences.key), { ...preferences,
      encodedSize: { ...preferences.encodedSize, valueBytes: bytes(preferences.value) } }]]);
  }
  const ledger = applySizeChanges(base, before, after);
  Object.values(ledger).forEach(safeCounter);
  requireValue(ledger.stateBytes <= MAX_STATE_BYTES && ledger.nodeCount <= MAX_NODES
    && ledger.variantCount <= MAX_VARIANTS && ledger.elementCount <= MAX_ELEMENTS, 'Aggregate limit exceeded');
  const h = after.projectHeaders?.values().next().value;
  if (h) after.projectHeaders = new Map([[JSON.stringify(h.key), { ...h, counters: { documentBytes: ledger.documentBytes,
    projectBaseBytes: ledger.projectBytes - ledger.preferenceBytes, nodeCount: ledger.nodeCount, variantCount: ledger.variantCount, elementCount: ledger.elementCount } }]]);
  const p = after.projectPreferences?.values().next().value;
  if (p) after.projectPreferences = new Map([[JSON.stringify(p.key), { ...p, preferenceBytes: ledger.preferenceBytes }]]);
  const puts: PreparedPut[] = [];
  for (const store of Object.keys(after) as ProjectStoreName[]) for (const record of after[store]?.values() ?? [])
    puts.push({ store, record, bytes: record.encodedSize.valueBytes, digest: digestNormalizedRecord(store, record) } as PreparedPut);
  const counterDeltas = Object.fromEntries(Object.keys(ledger).map(key => [key, ledger[key as keyof SizeLedger] - base[key as keyof SizeLedger]])) as unknown as SizeLedger;
  return { ...prepared, before, after, puts, ledger, counterDeltas };
}

function validateOverlayRecords(preferences: ProjectPreferences, exceptions: ProjectExtension, prefix: string[], current: ProjectPreferences, oldExceptions: ProjectExtension): void {
  const allowedPreferences = Object.entries(APP_STATE_FIELD_CLASSIFICATION).filter(([, owner]) => owner === 'preference').map(([key]) => key);
  for (const [record, old, key, extra] of [[preferences, current, prefix, ['revision', 'lastCommitId', 'preferenceBytes', 'commitProof', 'commitWindow']], [exceptions, oldExceptions, [...prefix, 'folds'], []]] as const) {
    if (record === old) continue; // Already admitted, not a selected physical write.
    const descriptors = dataFields(record);
    const fields = ['key', 'formatVersion', 'value', 'encodedSize', ...extra];
    if (record === preferences && Object.hasOwn(descriptors, 'foldRecordDigest')) fields.push('foldRecordDigest');
    if (record === preferences && Object.hasOwn(descriptors, 'bulkBoundary')) fields.push('bulkBoundary');
    requireValue(fields.length === Object.keys(descriptors).length && fields.every(field => Object.hasOwn(descriptors, field)), 'Invalid overlay envelope');
    // Canonicalize individual fields, never the deeper private envelope.
    for (const descriptor of Object.values(descriptors)) canonicalStringify(descriptor.value);
    requireValue(JSON.stringify(record.key) === JSON.stringify(key) && record.formatVersion === NORMALIZED_DB_VERSION, 'Overlay scope/version mismatch');
    dataFields(record.value); dataFields(record.encodedSize);
    requireValue(record.encodedSize.valueBytes === bytes(record.value), 'Invalid overlay encoded bytes');
  }
  requireValue(Object.keys(exceptions.encodedSize).length === 1, 'Invalid overlay counters');
  if (preferences === current) return;
  requireValue(preferences.bulkBoundary === current.bulkBoundary, 'Overlay changed bulk boundary');
  validateLineage(preferences, 'preferences');
  requireValue(Number.isSafeInteger(preferences.revision) && preferences.revision >= 0
    && (preferences.lastCommitId === null || (typeof preferences.lastCommitId === 'string' && preferences.lastCommitId.length > 0)), 'Invalid preference lineage');
  requireValue(Object.keys(preferences.encodedSize).length === 2, 'Invalid overlay counters');
  dataFields(preferences.encodedSize.templateOverlayBytes);
  requireValue(Object.values(preferences.encodedSize.templateOverlayBytes).every(size => Number.isSafeInteger(size) && size > 0), 'Invalid fold contributions');
  requireValue(Object.keys(preferences.value).every(key => [...allowedPreferences, 'layerCollapsed', 'panelsExpanded'].includes(key)), 'Unknown preference field');
  for (const key of allowedPreferences) if (Object.hasOwn(preferences.value, key)) external(Reflect.get(preferences.value, key), 2);
  for (const map of [preferences.value.layerCollapsed, preferences.value.panelsExpanded]) {
    dataFields(map); requireValue(Object.values(map).every(value => typeof value === 'boolean'), 'Invalid boolean preferences');
  }
  // Fold addresses/raw depth are checked at ingress or in explicit selected
  // effects. Map identity below binds this fully encoded record to those effects.
  // Encoding/hashing a changed physical record is not affected-target discovery.
}

export function referenceProjection(header: ProjectHeader, slice: NormalizedProjectSlice): DocumentState {
  const nodes = Object.fromEntries([...(slice.projectNodes?.values() ?? [])].map(record => [record.key[3], record.value]));
  const variants: DocumentState['variants'] = {};
  for (const record of slice.projectTemplates?.values() ?? []) {
    const id = record.key[3];
    if (!Object.hasOwn(variants, id)) Object.defineProperty(variants, id, { value: { id, name: '', templates: {} }, enumerable: true });
    Object.defineProperty(variants[id].templates, record.key[4], { value: record.value, enumerable: true });
  }
  return { ...header.document, nodes, variants };
}

function foldBytes(template: PageTemplate | undefined, address: FoldAddress, preferences: ProjectPreferences, exceptions: ProjectExtension, bucket: FoldBucket): number {
  const layers = template?.layers ?? []; const counts = new Map<string, number>(); let result = 0;
  for (const layer of layers) if (object(layer) && typeof layer.id === 'string') counts.set(layer.id, (counts.get(layer.id) ?? 0) + 1);
  for (const [map, positional, keys] of [[preferences.value.layerCollapsed, false, bucket.preferenceKeys], [exceptions.value, true, bucket.exceptionKeys]] as const) {
    for (const key of keys) {
      const tuple = JSON.parse(key);
      requireValue(Array.isArray(tuple) && tuple.length === 3, 'Invalid fold address');
      if (positional) requireValue(Number.isInteger(tuple[2]) && object(layers[tuple[2]]), 'Stale fold exception; reconcile structural overlays');
      else requireValue(typeof tuple[2] === 'string' && counts.get(tuple[2]) === 1 && typeof map[key] === 'boolean', 'Stale fold preference; reconcile structural overlays');
    }
  }
  for (const [position, layer] of layers.entries()) if (object(layer)) {
    const exception = own(exceptions.value, JSON.stringify([address.variantId, address.templateId, position]));
    const prefKey = JSON.stringify([address.variantId, address.templateId, layer.id]);
    const present = Object.hasOwn(preferences.value.layerCollapsed, prefKey);
    if (exception !== undefined) {
      const descriptors = dataFields(exception); requireValue(Object.keys(descriptors).length === 1 && descriptors.value, 'Invalid fold exception');
      requireValue(!present && (typeof descriptors.value.value !== 'boolean' || counts.get(layer.id as string) !== 1), 'Overlapping/noncanonical fold owners');
      external(descriptors.value.value, 8);
      result += bytes('collapsed') + 1 + bytes(descriptors.value.value) + Number(Object.keys(layer).length > 0);
    } else if (present) result += bytes('collapsed') + 1 + bytes(preferences.value.layerCollapsed[prefKey]) + Number(Object.keys(layer).length > 0);
  }
  return result;
}
