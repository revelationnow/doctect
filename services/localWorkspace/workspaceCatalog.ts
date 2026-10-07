import { effect, retainWork, type Ownership, type Work } from '../../shared/cooperativeWork.js';
import { compareStringsWork, stableSortWork } from '../../shared/jsonWork.js';
import { canonicalTimestamp, denseDataArrayWork, exactFieldsWork, privateId, requireContract, safeCounter, validDigest } from './normalized/commitProof';
import { canonicalFrame, equalFrameWork } from './normalized/work';
import type { ProjectScope } from './normalized/schema';
import type { ImportDescriptor, NormalizedWorkspaceManifest, PresetDescriptor, WorkspaceStamp } from './normalized/workspaceManifest';
import type { WorkspaceCatalog, WorkspaceCatalogDelta } from './normalized/workspaceCommands';
export type { WorkspaceCatalog, WorkspaceCatalogDelta } from './normalized/workspaceCommands';

type Descriptor = PresetDescriptor | ImportDescriptor;
type Index<T> = { id: string; value: T; ordinal: number }[];
function externalId(value: unknown): asserts value is string {
  requireContract(typeof value === 'string' && value.length > 0, 'Invalid catalog identity');
}
function* fieldWork(value: unknown, name: string): Work<unknown> {
  let result: unknown;
  yield* effect(1, () => {
    requireContract(value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype, 'Invalid catalog object');
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    requireContract(descriptor?.enumerable && Object.hasOwn(descriptor, 'value'), 'Invalid catalog data field');
    result = descriptor.value;
  });
  return result;
}
function* stampWork(value: unknown): Work<WorkspaceStamp> {
  const fields = yield* exactFieldsWork(value, ['revision', 'coreDigest']);
  safeCounter(fields.revision); validDigest(fields.coreDigest); return value as WorkspaceStamp;
}
function* scopeWork(value: unknown, generation: string): Work<ProjectScope> {
  const fields = yield* exactFieldsWork(value, ['storageGeneration', 'projectId', 'incarnation']);
  privateId(fields.storageGeneration); externalId(fields.projectId); externalId(fields.incarnation);
  requireContract((yield* compareStringsWork(fields.storageGeneration, generation)) === 0, 'Catalog generation mismatch');
  return value as ProjectScope;
}
function* descriptorWork(value: unknown, kind: 'preset' | 'import'): Work<Descriptor> {
  const fields = yield* exactFieldsWork(value, kind === 'preset' ? ['id', 'position', 'recordDigest']
    : ['id', 'position', 'recordDigest', 'targetProjectId', 'createdAt', 'pendingImportDigest'], kind === 'import' ? ['attemptProvenance'] : []);
  externalId(fields.id); safeCounter(fields.position); validDigest(fields.recordDigest);
  if (kind === 'import') {
    externalId(fields.targetProjectId); canonicalTimestamp(fields.createdAt); validDigest(fields.pendingImportDigest);
    if (Object.hasOwn(fields, 'attemptProvenance')) {
      const attempt = yield* exactFieldsWork(fields.attemptProvenance, ['sourceKeyDigest', 'payloadDigest', 'pendingImportDigest']);
      for (const name of ['sourceKeyDigest', 'payloadDigest', 'pendingImportDigest']) yield* effect(1, () => validDigest(attempt[name]));
    }
  }
  return value as Descriptor;
}
function* indexWork<T>(values: readonly T[], id: (value: T) => string, owner: Ownership): Work<Index<T>> {
  const entries: Index<T> = [];
  for (let ordinal = 0; ordinal < values.length; ordinal++) yield* effect(1, () => {
    owner.grow(64); entries.push({ value: values[ordinal], id: id(values[ordinal]), ordinal });
  });
  // Two reference buffers for merge sorting; strings and input bodies stay borrowed.
  yield* effect(1, () => owner.grow(entries.length * 16));
  const sorted = yield* stableSortWork(entries, (a, b) => compareStringsWork(a.id, b.id));
  for (let i = 1; i < sorted.length; i++) requireContract((yield* compareStringsWork(sorted[i - 1].id, sorted[i].id)) !== 0, 'Duplicate catalog identity');
  return sorted;
}
function* lookupWork<T>(index: Index<T>, id: string): Work<Index<T>[number] | undefined> {
  let low = 0, high = index.length;
  while (low < high) {
    const at = low + Math.floor((high - low) / 2), order = yield* compareStringsWork(index[at].id, id);
    if (order === 0) return index[at];
    if (order < 0) low = at + 1; else high = at;
  }
  return undefined;
}
function* descriptorListWork<T extends Descriptor>(values: readonly T[], kind: 'preset' | 'import', owner: Ownership): Work<Index<T>> {
  yield* denseDataArrayWork(values); let previous = -1;
  for (const value of values) {
    yield* descriptorWork(value, kind);
    requireContract(value.position > previous, 'Invalid catalog position order'); previous = value.position;
  }
  return yield* indexWork(values, value => value.id, owner);
}
function* catalogWork(value: WorkspaceCatalog, owner: Ownership) {
  yield* exactFieldsWork(value, ['storageGeneration', 'stamp', 'members', 'activeProjectId', 'presets', 'pendingImports']);
  privateId(value.storageGeneration); yield* stampWork(value.stamp); externalId(value.activeProjectId);
  yield* denseDataArrayWork(value.members); requireContract(value.members.length > 0, 'Empty catalog');
  for (const member of value.members) yield* scopeWork(member, value.storageGeneration);
  const members = yield* indexWork(value.members, member => member.projectId, owner);
  requireContract((yield* lookupWork(members, value.activeProjectId)) !== undefined, 'Missing active catalog member');
  const presets = yield* descriptorListWork(value.presets, 'preset', owner);
  const pendingImports = yield* descriptorListWork(value.pendingImports, 'import', owner);
  return { members, presets, pendingImports };
}
/** Explicit metadata ingress; no synchronous cardinality-dependent validation. */
export function* validateWorkspaceCatalogWork(value: WorkspaceCatalog): Work<void> {
  const owner = yield* retainWork(0);
  try { yield* catalogWork(value, owner); } finally { owner.release(); }
}
function* copyDescriptorWork<T extends Descriptor>(value: T, owner: Ownership): Work<T> {
  return yield* effect(1, () => {
    owner.grow(Object.hasOwn(value, 'targetProjectId') ? 112 : 48);
    return { ...value, ...(Object.hasOwn(value, 'attemptProvenance') ? { attemptProvenance: { ...(value as ImportDescriptor).attemptProvenance } } : {}) };
  });
}

/** Projects an already admitted manifest; never reads project birth or payload fields. */
export function* projectWorkspaceCatalogWork(manifest: NormalizedWorkspaceManifest): Work<WorkspaceCatalog> {
  const owner = yield* retainWork(0);
  try {
    const storageGeneration = yield* fieldWork(manifest, 'storageGeneration'); privateId(storageGeneration);
    const revision = yield* fieldWork(manifest, 'revision'); safeCounter(revision);
    const coreDigest = yield* fieldWork(manifest, 'coreDigest'); validDigest(coreDigest);
    const activeProjectId = yield* fieldWork(manifest, 'activeProjectId'); externalId(activeProjectId);
    const inputMembers = yield* fieldWork(manifest, 'members'); yield* denseDataArrayWork(inputMembers);
    const members: ProjectScope[] = [], presets: PresetDescriptor[] = [], pendingImports: ImportDescriptor[] = [];
    for (const member of inputMembers as unknown[]) {
      const projectId = yield* fieldWork(member, 'projectId'); externalId(projectId);
      const incarnation = yield* fieldWork(member, 'incarnation'); externalId(incarnation);
      yield* effect(1, () => { owner.grow(64); members.push({ storageGeneration, projectId, incarnation }); });
    }
    for (const [name, kind] of [['presets', 'preset'], ['pendingImports', 'import']] as const) {
      const values = yield* fieldWork(manifest, name); yield* denseDataArrayWork(values);
      for (const raw of values as unknown[]) {
        const checked = yield* descriptorWork(raw, kind); const copy = yield* copyDescriptorWork(checked, owner);
        yield* effect(1, () => { owner.grow(8); if (kind === 'preset') presets.push(copy); else pendingImports.push(copy as ImportDescriptor); });
      }
    }
    const result = { storageGeneration, stamp: { revision, coreDigest }, members, activeProjectId, presets, pendingImports };
    yield* catalogWork(result, owner); return result;
  } finally { owner.release(); }
}

function* nextStampWork(generation: string, before: WorkspaceStamp, afterGeneration: string, after: WorkspaceStamp): Work<void> {
  privateId(afterGeneration); yield* stampWork(before); yield* stampWork(after);
  requireContract((yield* compareStringsWork(generation, afterGeneration)) === 0, 'Catalog generation mismatch');
  requireContract(before.revision < Number.MAX_SAFE_INTEGER && after.revision === before.revision + 1, 'Catalog revision gap');
}
function* descriptorDeltaWork<T extends Descriptor>(before: readonly T[], after: readonly T[], beforeIndex: Index<T>, afterIndex: Index<T>, owner: Ownership) {
  const remove: string[] = [], upsert: T[] = [];
  for (const value of before) if (!(yield* lookupWork(afterIndex, value.id))) yield* effect(1, () => { owner.grow(8); remove.push(value.id); });
  for (const value of after) {
    const previous = yield* lookupWork(beforeIndex, value.id);
    if (!previous || !(yield* equalFrameWork(canonicalFrame(previous.value), canonicalFrame(value)))) {
      yield* effect(1, () => { owner.grow(8); upsert.push(value); });
    }
  }
  return { remove, upsert };
}
export function* diffWorkspaceCatalogWork(before: WorkspaceCatalog, after: WorkspaceCatalog): Work<WorkspaceCatalogDelta> {
  const owner = yield* retainWork(0);
  try {
    const left = yield* catalogWork(before, owner), right = yield* catalogWork(after, owner);
    yield* nextStampWork(before.storageGeneration, before.stamp, after.storageGeneration, after.stamp);
    const removed: ProjectScope[] = [], added: { index: number; scope: ProjectScope }[] = [];
    for (const member of before.members) {
      const next = yield* lookupWork(right.members, member.projectId);
      if (!next || (yield* compareStringsWork(next.value.incarnation, member.incarnation)) !== 0) {
        yield* effect(1, () => { owner.grow(8); removed.push(member); });
      }
    }
    let previousOrdinal = -1;
    for (let index = 0; index < after.members.length; index++) {
      const scope = after.members[index], previous = yield* lookupWork(left.members, scope.projectId);
      if (!previous || (yield* compareStringsWork(previous.value.incarnation, scope.incarnation)) !== 0) {
        yield* effect(1, () => { owner.grow(32); added.push({ index, scope }); });
      } else {
        requireContract(previous.ordinal > previousOrdinal, 'Existing catalog members cannot be reordered'); previousOrdinal = previous.ordinal;
      }
    }
    const presets = yield* descriptorDeltaWork(before.presets, after.presets, left.presets, right.presets, owner);
    const pendingImports = yield* descriptorDeltaWork(before.pendingImports, after.pendingImports, left.pendingImports, right.pendingImports, owner);
    return { storageGeneration: before.storageGeneration, before: { ...before.stamp }, after: { ...after.stamp },
      removed, added, activeProjectId: after.activeProjectId, presets, pendingImports };
  } finally { owner.release(); }
}

/** Compare metadata only at an explicit restart boundary, never during a save. */
export function* equalWorkspaceCatalogWork(left: WorkspaceCatalog, right: WorkspaceCatalog): Work<boolean> {
  yield* validateWorkspaceCatalogWork(left); yield* validateWorkspaceCatalogWork(right);
  return yield* equalFrameWork(canonicalFrame(left), canonicalFrame(right));
}

function* applyDescriptorDeltaWork<T extends Descriptor>(before: readonly T[], index: Index<T>, delta: { readonly remove: readonly string[]; readonly upsert: readonly T[] },
  kind: 'preset' | 'import', owner: Ownership): Work<T[]> {
  yield* exactFieldsWork(delta, ['remove', 'upsert']); yield* denseDataArrayWork(delta.remove); yield* denseDataArrayWork(delta.upsert);
  for (const id of delta.remove) yield* effect(1, () => externalId(id));
  const removals = yield* indexWork(delta.remove, id => id, owner);
  for (const value of delta.upsert) yield* descriptorWork(value, kind);
  const upserts = yield* indexWork(delta.upsert, value => value.id, owner);
  for (const id of delta.remove) {
    requireContract((yield* lookupWork(index, id)) !== undefined, 'Missing catalog descriptor removal');
    requireContract((yield* lookupWork(upserts, id)) === undefined, 'Conflicting catalog descriptor delta');
  }
  const values: T[] = [];
  for (const previous of before) {
    if (yield* lookupWork(removals, previous.id)) continue;
    const replacement = yield* lookupWork(upserts, previous.id);
    const next = replacement && !(yield* equalFrameWork(canonicalFrame(previous), canonicalFrame(replacement.value))) ? replacement.value : previous;
    yield* effect(1, () => { owner.grow(8); values.push(next); });
  }
  for (const value of delta.upsert) if (!(yield* lookupWork(index, value.id))) yield* effect(1, () => { owner.grow(8); values.push(value); });
  yield* effect(1, () => owner.grow(values.length * 16));
  const ordered = yield* stableSortWork(values, (a, b) => effect(1, () => a.position - b.position));
  yield* descriptorListWork(ordered, kind, owner); return ordered;
}
export function* applyWorkspaceCatalogDeltaWork(current: WorkspaceCatalog, delta: WorkspaceCatalogDelta): Work<WorkspaceCatalog> {
  const owner = yield* retainWork(0);
  try {
    const index = yield* catalogWork(current, owner);
    yield* exactFieldsWork(delta, ['storageGeneration', 'before', 'after', 'removed', 'added', 'activeProjectId', 'presets', 'pendingImports']);
    yield* nextStampWork(current.storageGeneration, current.stamp, delta.storageGeneration, delta.after);
    yield* stampWork(delta.before);
    requireContract(current.stamp.revision === delta.before.revision
      && (yield* compareStringsWork(current.stamp.coreDigest, delta.before.coreDigest)) === 0, 'Stale catalog delta');
    yield* denseDataArrayWork(delta.removed); yield* denseDataArrayWork(delta.added);
    const removed = new Set<number>();
    for (const scope of delta.removed) {
      yield* scopeWork(scope, current.storageGeneration);
      const previous = yield* lookupWork(index.members, scope.projectId);
      requireContract(previous && (yield* compareStringsWork(previous.value.incarnation, scope.incarnation)) === 0, 'Missing catalog member removal');
      yield* effect(1, () => { requireContract(!removed.has(previous.ordinal), 'Duplicate catalog removal'); owner.grow(16); removed.add(previous.ordinal); });
    }
    const length = current.members.length - removed.size + delta.added.length; safeCounter(length);
    for (const addition of delta.added) {
      yield* exactFieldsWork(addition, ['index', 'scope']); safeCounter(addition.index);
      requireContract(addition.index < length, 'Invalid catalog insertion index'); yield* scopeWork(addition.scope, current.storageGeneration);
    }
    yield* effect(1, () => owner.grow(delta.added.length * 24));
    const added = yield* stableSortWork(delta.added, (a, b) => effect(1, () => a.index - b.index));
    for (let i = 1; i < added.length; i++) yield* effect(1, () =>
      requireContract(added[i - 1].index !== added[i].index, 'Duplicate catalog insertion index'));
    const members: ProjectScope[] = []; let nextAddition = 0, previous = 0;
    for (let i = 0; i < length; i++) {
      if (added[nextAddition]?.index === i) {
        const scope = added[nextAddition++].scope;
        yield* effect(1, () => { owner.grow(8); members.push(scope); });
      } else {
        while (previous < current.members.length && removed.has(previous)) yield* effect(1, () => { previous++; });
        requireContract(previous < current.members.length, 'Invalid catalog membership delta');
        yield* effect(1, () => { owner.grow(8); members.push(current.members[previous++]); });
      }
    }
    const presets = yield* applyDescriptorDeltaWork(current.presets, index.presets, delta.presets, 'preset', owner);
    const pendingImports = yield* applyDescriptorDeltaWork(current.pendingImports, index.pendingImports, delta.pendingImports, 'import', owner);
    const result: WorkspaceCatalog = { storageGeneration: current.storageGeneration, stamp: { ...delta.after }, members,
      activeProjectId: delta.activeProjectId, presets, pendingImports };
    yield* catalogWork(result, owner); return result;
  } finally { owner.release(); }
}
