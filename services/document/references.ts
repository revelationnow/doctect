import type { DocumentEdit, DocumentState, RecordAddress } from './contracts';
import { effect, retainWork, type Work, type Ownership } from '../../shared/cooperativeWork.js';
import { enumerableEntriesWork, jsonTextWork, utf8LengthWork } from '../../shared/jsonWork.js';

/**
 * Private, single-owner live index; NOT an undo snapshot. No persistence or React
 * API exposes keys. Query old dependents before updating; undo applies the reverse
 * edit to this same index. Documents and returned owner sets remain immutable.
 */
export type ReferenceIndex = ReadonlyMap<string, ReadonlySet<RecordAddress>>;
const key = (kind: string, id: string) => JSON.stringify([kind, id]);
const ownerKey = (address: RecordAddress) => address.kind === 'template'
  ? JSON.stringify(['template', address.variantId, address.templateId])
  : address.kind === 'node' ? key('node', address.nodeId)
    : address.kind === 'variant' ? key('variant', address.variantId) : key(address.kind, '');
const own = <T>(records: Record<string, T>, id: string): T | undefined => Object.hasOwn(records, id) ? records[id] : undefined;

function references(document: DocumentState, address: RecordAddress): Set<string> {
  const result = new Set<string>();
  const add = (kind: string, id: unknown) => { if (typeof id === 'string') result.add(key(kind, id)); };
  if (address.kind === 'root') add('node', document.rootId);
  if (address.kind === 'node') {
    const node = own(document.nodes, address.nodeId);
    if (node) {
      add('type', node.type);
      add('node', node.parentId);
      add('node', node.referenceId);
      node.children.forEach(id => add('node', id));
    }
  }
  if (address.kind === 'template') {
    const variant = own(document.variants, address.variantId);
    const template = variant && own(variant.templates, address.templateId);
    if (template) {
      add('variant', address.variantId);
      for (const element of template.elements) {
        // Historical validation permits non-object elements. Index only known
        // semantics without rewriting, rejecting or interpreting extensions.
        if (!element || typeof element !== 'object') continue;
        if (element.linkTarget === 'specific_node') add('node', element.linkValue);
        if (element.type === 'grid' && element.gridConfig?.sourceType === 'specific') add('node', element.gridConfig.sourceId);
        if (element.linkTarget === 'child_referrer') add('type', element.linkReferrerParentType);
      }
    }
  }
  return result;
}

/** Full record walk, only at ingress or an explicit index rebuild. */
export function buildReferenceIndex(document: DocumentState): ReferenceIndex {
  const index = new Map<string, Set<RecordAddress>>();
  const add = (address: RecordAddress) => {
    for (const target of references(document, address)) {
      if (!index.has(target)) index.set(target, new Set());
      index.get(target)!.add(address);
    }
  };
  add({ kind: 'root' });
  for (const nodeId of Object.keys(document.nodes)) add({ kind: 'node', nodeId });
  for (const [variantId, variant] of Object.entries(document.variants)) {
    for (const templateId of Object.keys(variant.templates)) add({ kind: 'template', variantId, templateId });
  }
  return index;
}

/** Same index semantics at a cooperative explicit bulk boundary; caller owns the result. */
export function* buildReferenceIndexWork(document: DocumentState, custody?: Ownership): Work<ReferenceIndex> {
  const lease = custody ?? (yield* retainWork(0)), index = new Map<string, Set<RecordAddress>>();
  function* add(address: RecordAddress, kind: string, id: unknown): Work<void> {
    yield* effect(1, () => {}); if (typeof id !== 'string') return;
    const target = yield* jsonTextWork([kind, id]), bytes = yield* utf8LengthWork(target);
    yield* effect(1, () => {
      let owners = index.get(target);
      if (!owners) { owners = new Set(); index.set(target, owners); lease.grow(bytes + 48); }
      if (!owners.has(address)) { owners.add(address); lease.grow(24); }
    });
  }
  try {
    yield* effect(1, () => lease.grow(24));
    yield* add({ kind: 'root' }, 'node', document.rootId);
    for (const [nodeId, node] of yield* enumerableEntriesWork(document.nodes)) {
      const address: RecordAddress = { kind: 'node', nodeId };
      yield* add(address, 'type', node.type); yield* add(address, 'node', node.parentId); yield* add(address, 'node', node.referenceId);
      for (const child of node.children) yield* add(address, 'node', child);
    }
    for (const [variantId, variant] of yield* enumerableEntriesWork(document.variants)) {
      for (const [templateId, template] of yield* enumerableEntriesWork(variant.templates)) {
        const address: RecordAddress = { kind: 'template', variantId, templateId };
        yield* add(address, 'variant', variantId);
        for (const element of template.elements) {
          yield* effect(1, () => {}); if (!element || typeof element !== 'object') continue;
          if (element.linkTarget === 'specific_node') yield* add(address, 'node', element.linkValue);
          if (element.type === 'grid' && element.gridConfig?.sourceType === 'specific') yield* add(address, 'node', element.gridConfig.sourceId);
          if (element.linkTarget === 'child_referrer') yield* add(address, 'type', element.linkReferrerParentType);
        }
      }
    }
    return index;
  } finally { if (!custody) lease.release(); }
}

/**
 * Only old/new affected records are read; untouched owner sets remain shared.
 * Stage changed buckets before publishing in place. Never copy/enumerate the
 * complete index on a normal edit (even a shallow Map copy is project-sized).
 */
export function updateReferenceIndex(index: ReferenceIndex, edit: DocumentEdit): ReferenceIndex {
  if (!edit.affected.length) return index;
  const updates = new Map<string, Set<RecordAddress>>();
  for (const address of edit.affected) {
    const oldTargets = references(edit.before, address);
    const newTargets = references(edit.after, address);
    for (const target of new Set([...oldTargets, ...newTargets])) {
      if (oldTargets.has(target) === newTargets.has(target)) continue;
      const owners = updates.get(target) ?? new Set(index.get(target));
      if (newTargets.has(target)) owners.add(address);
      else for (const owner of owners) if (ownerKey(owner) === ownerKey(address)) owners.delete(owner);
      updates.set(target, owners);
    }
  }
  const live = index as Map<string, ReadonlySet<RecordAddress>>;
  for (const [target, owners] of updates) {
    if (owners.size) live.set(target, owners);
    else live.delete(target);
  }
  return index;
}

/**
 * Direct owners, deduplicated by address. Types deliberately use a variant-free
 * key: missing templates may fall back/resolve later in another variant. This
 * index describes dependencies, not a requirement that every target exist.
 */
export function affectedReferences(index: ReferenceIndex, addresses: readonly RecordAddress[]): readonly RecordAddress[] {
  const result = new Map<string, RecordAddress>();
  const add = (target: string) => {
    for (const owner of index.get(target) ?? []) result.set(ownerKey(owner), owner);
  };
  for (const address of addresses) {
    if (address.kind === 'node') add(key('node', address.nodeId));
    if (address.kind === 'template') add(key('type', address.templateId));
    if (address.kind === 'variant') {
      const target = key('variant', address.variantId);
      add(target);
      for (const owner of index.get(target) ?? []) if (owner.kind === 'template') add(key('type', owner.templateId));
    }
  }
  return [...result.values()];
}
