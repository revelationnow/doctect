import { canonicalStringify } from '../canonical';
import { effect, primitive, runSync, type Work } from '../../../shared/cooperativeWork.js';
import { canonicalBytesWork, canonicalWork, compareStringsWork, equalFrameWork, jsonTextWork,
  quoteWork, stableSortWork, textWork, type Frame } from '../../../shared/jsonWork.js';
import type { AuthorityStamp, BulkCommitProof, BulkProjectBaseline, CommitDelta, CommitIdentity, CommitProof, CommitWindow, DocumentBatch, PreferenceBatch,
  ProjectHeader, ProjectPreferences, ProjectScope, ProjectStoreName, SelectedPostcondition } from './schema';
import type { WorkspaceBirthOrigin } from './workspaceManifest';

export const COMMIT_WINDOW_COUNT = 32;
export const COMMIT_WINDOW_BYTES = 64 * 1024;
export const jsonBytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;
export function requireContract(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
export function dataObject(value: unknown): Record<string, unknown> {
  return runSync(dataObjectWork(value));
}
export function* dataObjectWork(value: unknown): Work<Record<string, unknown>> {
  requireContract(value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype, 'Expected plain data object');
  for (const key of yield* primitive('keys', () => Reflect.ownKeys(value))) yield* effect(1, () => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    requireContract(typeof key === 'string' && descriptor.enumerable
      && Object.hasOwn(descriptor, 'value'), 'Getters/accessors and hidden fields are not supported');
  });
  return value as Record<string, unknown>;
}
export function exactFields(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  return runSync(exactFieldsWork(value, required, optional));
}
export function* exactFieldsWork(value: unknown, required: readonly string[], optional: readonly string[] = []): Work<Record<string, unknown>> {
  const object = yield* dataObjectWork(value);
  for (const key of required) yield* effect(1, () => requireContract(Object.hasOwn(object, key), 'Invalid private fields'));
  for (const key of yield* primitive('keys', () => Object.keys(object))) yield* effect(1,
    () => requireContract(required.includes(key) || optional.includes(key), 'Invalid private fields'));
  return object;
}
/** Validate just private array framing, without spending payload depth on it. */
export function denseDataArray(value: unknown): asserts value is unknown[] {
  runSync(denseDataArrayWork(value));
}
export function* denseDataArrayWork(value: unknown): Work<void> {
  requireContract(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype, 'Expected dense data array');
  const keys = yield* primitive('keys', () => Reflect.ownKeys(value));
  for (const key of keys) yield* effect(1, () => requireContract(typeof key === 'string', 'Expected dense data array'));
  requireContract(keys.length === value.length + 1, 'Expected dense data array');
  for (let index = 0; index < value.length; index++) {
    const descriptor = yield* effect(1, () => Object.getOwnPropertyDescriptor(value, String(index)));
    requireContract(descriptor && Object.hasOwn(descriptor, 'value'), 'Sparse arrays and accessors are not supported');
  }
}
export function safeCounter(value: unknown): asserts value is number {
  requireContract(Number.isSafeInteger(value) && (value as number) >= 0, 'Invalid revision/counter');
}
export function privateId(value: unknown): asserts value is string {
  requireContract(typeof value === 'string' && value.length > 0 && value.length <= 256 && new TextEncoder().encode(value).length <= 256, 'Invalid private identity');
}
export function canonicalTimestamp(value: unknown): asserts value is string {
  requireContract(typeof value === 'string' && (value.length === 24 || value.length === 27) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, 'Invalid private timestamp');
}
export function validDigest(value: unknown): asserts value is string {
  requireContract(typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/.test(value), 'Invalid canonical digest');
}
export const workspaceBirthOriginFields = ['kind', 'identity', 'requestDigest', 'workspaceRevision', 'memberOrdinal', 'createdAt', 'authority'] as const;
/** Shape only; a matching durable manifest is required for birth admission. */
export function* validateWorkspaceBirthOriginWork(value: unknown): Work<WorkspaceBirthOrigin> {
  const birth = yield* exactFieldsWork(value, workspaceBirthOriginFields);
  const identity = yield* exactFieldsWork(birth.identity, ['clientId', 'commandSequence', 'commandId']);
  const stamp = yield* exactFieldsWork(birth.authority, ['documentRevision', 'preferenceRevision', 'foldStructureGeneration']);
  requireContract(birth.kind === 'workspace-command', 'Invalid workspace birth');
  privateId(identity.clientId); privateId(identity.commandId); safeCounter(identity.commandSequence);
  validDigest(birth.requestDigest); safeCounter(birth.workspaceRevision); safeCounter(birth.memberOrdinal);
  requireContract(birth.workspaceRevision > 0, 'Invalid creation revision'); canonicalTimestamp(birth.createdAt);
  for (const name of ['documentRevision', 'preferenceRevision', 'foldStructureGeneration']) yield* effect(1, () => {
    safeCounter(stamp[name]); requireContract(stamp[name] === 0, 'Invalid initial workspace-born authority');
  });
  return value as WorkspaceBirthOrigin;
}
export function authority(header: ProjectHeader, preferences: ProjectPreferences): AuthorityStamp {
  return { documentRevision: header.storageRevision, preferenceRevision: preferences.revision, foldStructureGeneration: header.foldStructureGeneration };
}
export function sameAuthority(a: AuthorityStamp, b: AuthorityStamp): boolean {
  return a.documentRevision === b.documentRevision && a.preferenceRevision === b.preferenceRevision && a.foldStructureGeneration === b.foldStructureGeneration;
}
function* stampWork(value: unknown): Work<void> {
  const stamp = yield* exactFieldsWork(value, ['documentRevision', 'preferenceRevision', 'foldStructureGeneration']);
  for (const key of ['documentRevision', 'preferenceRevision', 'foldStructureGeneration']) safeCounter(stamp[key]);
}
export function validateIdentity(value: unknown): asserts value is CommitIdentity {
  runSync(validateIdentityWork(value));
}
export function* validateIdentityWork(value: unknown): Work<void> {
  const id = yield* exactFieldsWork(value, ['clientId', 'commitGeneration', 'commitId', 'editorGeneration', 'lane']);
  privateId(id.clientId); privateId(id.commitId); safeCounter(id.commitGeneration); safeCounter(id.editorGeneration);
  requireContract(id.lane === 'document' || id.lane === 'preferences', 'Invalid commit lane');
}
export function validateProof(value: unknown): asserts value is CommitProof {
  runSync(validateProofWork(value));
}
export function* validateProofWork(value: unknown): Work<void> {
  yield* proofProgram(value, false);
}
export const isBulkCommitProof = (value: CommitProof | null): value is BulkCommitProof =>
  value !== null && Object.getOwnPropertyDescriptor(value, 'kind')?.value === 'bulk-document';
export function* validateBulkProofWork(value: unknown): Work<void> { yield* proofProgram(value, true); }
function* proofProgram(value: unknown, bulk: boolean): Work<void> {
  const p = yield* exactFieldsWork(value, ['identity', 'requestDigest', 'before', 'after', 'manifestDigest', 'headerCoreDigest', 'preferenceCoreDigest', ...(bulk ? ['kind'] : [])]);
  yield* validateIdentityWork(p.identity); yield* stampWork(p.before); yield* stampWork(p.after);
  for (const field of ['requestDigest', 'manifestDigest', 'headerCoreDigest', 'preferenceCoreDigest']) validDigest(p[field]);
  const proof = value as CommitProof; const { before, after } = proof;
  const document = proof.identity.lane === 'document';
  requireContract(after.documentRevision === before.documentRevision + Number(document)
    && (document ? after.preferenceRevision >= before.preferenceRevision && after.preferenceRevision <= before.preferenceRevision + 1
      : after.preferenceRevision === before.preferenceRevision + 1)
    && after.foldStructureGeneration >= before.foldStructureGeneration
     && after.foldStructureGeneration <= before.foldStructureGeneration + Number(document), 'Invalid proof lineage');
  if (bulk) requireContract(p.kind === 'bulk-document' && document
    && after.preferenceRevision === before.preferenceRevision + 1
    && after.foldStructureGeneration === before.foldStructureGeneration + 1, 'Invalid bulk proof lineage');
}
export function* validateBulkBaselineWork(value: unknown): Work<BulkProjectBaseline> {
  const baseline = yield* exactFieldsWork(value, ['proof', 'digests']);
  yield* validateBulkProofWork(baseline.proof);
  const digests = yield* exactFieldsWork(baseline.digests, ['imageDigest', 'documentDigest', 'preferenceDigest', 'foldDigest', 'recordCount']);
  for (const name of ['imageDigest', 'documentDigest', 'preferenceDigest', 'foldDigest']) validDigest(digests[name]);
  safeCounter(digests.recordCount); requireContract((digests.recordCount as number) > 0, 'Invalid bulk record count');
  return value as BulkProjectBaseline;
}
export function validateCommitWindow(value: unknown, revision: number, lane: CommitIdentity['lane']): asserts value is CommitWindow {
  runSync(commitWindowProgram(value, revision, lane, false));
}
export function validateCommitWindowWork(value: unknown, revision: number, lane: CommitIdentity['lane']): Work<void> {
  return commitWindowProgram(value, revision, lane, true);
}
function* commitWindowProgram(value: unknown, revision: number, lane: CommitIdentity['lane'], cooperative: boolean): Work<void> {
  const window = yield* exactFieldsWork(value, ['floorRevision', 'entries']); safeCounter(window.floorRevision);
  let bytes: number | undefined;
  if (cooperative) bytes = yield* canonicalBytesWork(window); else canonicalStringify(window);
  requireContract(Array.isArray(window.entries) && window.entries.length <= COMMIT_WINDOW_COUNT
    && (cooperative ? bytes! : jsonBytes(window)) <= COMMIT_WINDOW_BYTES && window.floorRevision <= revision, 'Invalid commit window bound');
  const entries = window.entries as CommitDelta[];
  requireContract(window.floorRevision + entries.length === revision, 'Incomplete commit window');
  const ids = new Set<string>();
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    yield* exactFieldsWork(entry, ['revision', 'proof', 'selected', 'referenceAddresses', 'foldTemplates']);
    requireContract(entry.revision === (window.floorRevision as number) + index + 1, 'Noncontiguous commit window');
    yield* validateProofWork(entry.proof);
    const previous = entries[index - 1]?.proof.after;
    if (previous) requireContract(entry.proof.before.documentRevision >= previous.documentRevision
      && entry.proof.before.preferenceRevision >= previous.preferenceRevision
      && entry.proof.before.foldStructureGeneration >= previous.foldStructureGeneration, 'Rewound window lineage');
    requireContract(entry.proof.after[lane === 'document' ? 'documentRevision' : 'preferenceRevision'] === entry.revision
      && (lane !== 'document' || entry.proof.identity.lane === 'document'), 'Window lane mismatch');
    requireContract(!ids.has(entry.proof.identity.commitId), 'Duplicate commit identity'); ids.add(entry.proof.identity.commitId);
    requireContract(Array.isArray(entry.selected) && Array.isArray(entry.referenceAddresses) && Array.isArray(entry.foldTemplates), 'Invalid manifest');
    const addresses = new Set<string>();
    for (const item of entry.selected) {
      yield* exactFieldsWork(item, ['address', 'after']); yield* exactFieldsWork(item.address, ['store', 'key']);
      const { store, key } = item.address;
      requireContract(['projectNodes', 'projectVariants', 'projectTemplates', 'projectSources', 'projectExtensions'].includes(store)
        && Array.isArray(key) && (yield* stringArrayWork(key)) && key.length === (store === 'projectSources' ? 3
          : store === 'projectTemplates' || store === 'projectExtensions' && key[3] === 'variant' ? 5 : 4), 'Invalid manifest address');
      const address = cooperative ? yield* jsonTextWork({ key, store }) : canonicalStringify(item.address);
      requireContract(!addresses.has(address), 'Duplicate manifest address'); addresses.add(address);
      const after = yield* dataObjectWork(item.after);
      yield* exactFieldsWork(after, after.type === 'absent' ? ['type'] : ['type', 'digest']);
      requireContract(after.type === 'absent' || after.type === 'present', 'Invalid postcondition');
      if (after.type === 'present') validDigest(after.digest);
    }
    for (const address of entry.referenceAddresses) {
      const a = yield* dataObjectWork(address); const fields = a.kind === 'node' ? ['nodeId'] : a.kind === 'variant' ? ['variantId']
        : a.kind === 'template' ? ['variantId', 'templateId'] : [];
      requireContract(['node', 'variant', 'template', 'root', 'generator'].includes(a.kind as string), 'Invalid reference address');
      yield* exactFieldsWork(a, ['kind', ...fields]); fields.forEach(field => requireContract(typeof a[field] === 'string', 'Invalid address'));
    }
    for (const address of entry.foldTemplates) {
      Object.values(yield* exactFieldsWork(address, ['variantId', 'templateId'])).forEach(v => requireContract(typeof v === 'string', 'Invalid fold template'));
    }
  }
}

function* stringArrayWork(value: unknown[]): Work<boolean> {
  for (let index = 0; index < value.length; index++) {
    if (!(yield* effect(1, () => !(index in value) || typeof value[index] === 'string'))) return false;
  }
  return true;
}
function* strictStringEqualWork(left: unknown, right: unknown): Work<boolean> {
  return typeof left === 'string' && typeof right === 'string'
    ? (yield* compareStringsWork(left, right)) === 0 : left === right;
}

export function validateAuthorityPair(header: ProjectHeader, preferences: ProjectPreferences): void {
  runSync(validateAuthorityPairWork(header, preferences));
}
export function* validateAuthorityPairWork(header: ProjectHeader, preferences: ProjectPreferences): Work<void> {
  yield* effect(1, () => {});
  const current = authority(header, preferences);
  for (const proof of [header.commitProof, preferences.commitProof]) if (proof) requireContract(
    proof.after.documentRevision <= current.documentRevision && proof.after.preferenceRevision <= current.preferenceRevision
    && proof.after.foldStructureGeneration <= current.foldStructureGeneration, 'Future proof lineage');
  safeCounter(header.counters.documentBytes + preferences.preferenceBytes);
  safeCounter(header.counters.projectBaseBytes + preferences.preferenceBytes);
  if (Object.hasOwn(header, 'bulkBaseline') || Object.hasOwn(preferences, 'bulkBoundary')) {
    const baseline = yield* validateBulkBaselineWork(header.bulkBaseline);
    requireContract(preferences.bulkBoundary === baseline.proof.manifestDigest, 'Bulk boundary mismatch');
    const lower = baseline.proof.after;
    requireContract(current.documentRevision >= lower.documentRevision && current.preferenceRevision >= lower.preferenceRevision
      && current.foldStructureGeneration >= lower.foldStructureGeneration
      && header.commitWindow.floorRevision >= lower.documentRevision && preferences.commitWindow.floorRevision >= lower.preferenceRevision, 'Rewound bulk boundary');
    for (const proof of [header.commitProof, preferences.commitProof,
      ...header.commitWindow.entries.map(entry => entry.proof), ...preferences.commitWindow.entries.map(entry => entry.proof)]) {
      requireContract(proof, 'Missing bulk lineage');
      if (isBulkCommitProof(proof)) requireContract(yield* equalFrameWork(emit => canonicalWork(proof, emit),
        emit => canonicalWork(baseline.proof, emit)), 'Bulk head mismatch');
      else requireContract(proof.before.documentRevision >= lower.documentRevision && proof.before.preferenceRevision >= lower.preferenceRevision
        && proof.before.foldStructureGeneration >= lower.foldStructureGeneration, 'Delta predates bulk boundary');
    }
  } else requireContract(!isBulkCommitProof(header.commitProof) && !isBulkCommitProof(preferences.commitProof), 'Missing bulk baseline');
}
export function appendCommitWindow(window: CommitWindow, delta: CommitDelta): CommitWindow {
  let floorRevision = window.floorRevision; const entries = [...window.entries, delta];
  while (entries.length > COMMIT_WINDOW_COUNT || jsonBytes({ floorRevision, entries }) > COMMIT_WINDOW_BYTES) {
    floorRevision = entries.shift()!.revision;
  }
  return { floorRevision, entries };
}

export function validateLineage(record: ProjectHeader | ProjectPreferences, lane: CommitIdentity['lane']): void {
  runSync(lineageProgram(record, lane, false));
}
export function validateLineageWork(record: ProjectHeader | ProjectPreferences, lane: CommitIdentity['lane']): Work<void> {
  return lineageProgram(record, lane, true);
}
function* lineageProgram(record: ProjectHeader | ProjectPreferences, lane: CommitIdentity['lane'], cooperative: boolean): Work<void> {
  const revision = lane === 'document' ? (record as ProjectHeader).storageRevision : (record as ProjectPreferences).revision;
  const baseline = lane === 'document' ? (record as ProjectHeader).migrationBaseline : undefined;
  if (lane === 'document' && (record as ProjectHeader).workspaceBirth !== undefined) {
    requireContract(baseline === undefined, 'Conflicting project birth ancestry');
    yield* validateWorkspaceBirthOriginWork((record as ProjectHeader).workspaceBirth);
  }
  if (baseline !== undefined) {
    yield* exactFieldsWork(baseline, ['migrationId', 'attemptId', 'storageGeneration', 'sourceDigest', 'projectDigest',
      'projectId', 'incarnation', 'sourceRevision', 'sourceUpdatedAt']);
    for (const value of [baseline.attemptId, baseline.storageGeneration]) privateId(value);
    for (const value of [baseline.projectId, baseline.incarnation]) requireContract(typeof value === 'string'
      && value.length > 0, 'Invalid retained source identity');
    validDigest(baseline.sourceDigest); validDigest(baseline.projectDigest);
    safeCounter(baseline.sourceRevision); canonicalTimestamp(baseline.sourceUpdatedAt);
    const header = record as ProjectHeader;
    requireContract(baseline.migrationId === 'incremental-local-persistence-v3'
       && (yield* strictStringEqualWork(baseline.storageGeneration, header.key[0])) && (yield* strictStringEqualWork(baseline.projectId, header.key[1]))
       && (yield* strictStringEqualWork(baseline.incarnation, header.incarnation)) && revision >= baseline.sourceRevision
      && header.commitWindow.floorRevision >= baseline.sourceRevision, 'Invalid migration baseline');
  }
  safeCounter(revision);
  if (record.lastCommitId !== null) privateId(record.lastCommitId);
  yield* commitWindowProgram(record.commitWindow, revision, lane, cooperative);
  if (record.commitProof === null) {
    requireContract(revision === (baseline?.sourceRevision ?? 0) && record.lastCommitId === null
      && record.commitWindow.entries.length === 0
      && (!baseline || (record as ProjectHeader).updatedAt === baseline.sourceUpdatedAt), 'Invalid initial lineage');
  } else {
    if (isBulkCommitProof(record.commitProof)) {
      yield* validateBulkProofWork(record.commitProof);
      requireContract(record.commitWindow.floorRevision === revision && record.commitWindow.entries.length === 0, 'Invalid bulk window reset');
      if (lane === 'document') {
        const bulk = yield* validateBulkBaselineWork((record as ProjectHeader).bulkBaseline);
        requireContract(yield* equalFrameWork(emit => canonicalWork(bulk.proof, emit), emit => canonicalWork(record.commitProof, emit)), 'Bulk head mismatch');
      } else requireContract((record as ProjectPreferences).bulkBoundary === record.commitProof.manifestDigest, 'Bulk boundary mismatch');
    } else yield* validateProofWork(record.commitProof);
    requireContract(record.commitProof.identity.commitId === record.lastCommitId
      && record.commitProof.after[lane === 'document' ? 'documentRevision' : 'preferenceRevision'] === revision
      && (lane !== 'document' || record.commitProof.identity.lane === 'document'), 'Invalid head proof');
    const last = record.commitWindow.entries.at(-1);
    if (last) requireContract(cooperative
      ? yield* equalFrameWork(emit => canonicalWork(last.proof, emit), emit => canonicalWork(record.commitProof, emit))
      : canonicalStringify(last.proof) === canonicalStringify(record.commitProof), 'Window/head proof mismatch');
  }
  if (lane === 'document') {
    const header = record as ProjectHeader;
    safeCounter(header.foldStructureGeneration);
    Object.values(yield* exactFieldsWork(header.counters, ['documentBytes', 'projectBaseBytes', 'nodeCount', 'variantCount', 'elementCount'])).forEach(safeCounter);
    if (header.updatedAt !== null) canonicalTimestamp(header.updatedAt);
    if (header.commitProof) requireContract(header.updatedAt !== null
      && header.foldStructureGeneration === header.commitProof.after.foldStructureGeneration, 'Invalid document metadata');
    else requireContract(header.foldStructureGeneration === 0, 'Invalid initial generation');
  } else {
    const preferences = record as ProjectPreferences;
    safeCounter(preferences.preferenceBytes);
    if (revision === 0 && record.commitProof === null)
      requireContract(!Object.hasOwn(preferences, 'foldRecordDigest'), 'Invalid initial fold evidence');
    else validDigest(preferences.foldRecordDigest);
  }
}

/** Canonicalize own fields individually: private ancestry does not consume external depth. */
const omitCoreField = (store: ProjectStoreName, key: string, core: boolean | 'bulk') => core
  && (['commitProof', 'commitWindow'].includes(key) || core === 'bulk'
    && (store === 'projectHeaders' && key === 'bulkBaseline' || store === 'projectPreferences' && key === 'bulkBoundary'));
const recordDomain = (core: boolean | 'bulk') => core === 'bulk' ? 'doctect-normalized-bulk-core-v1'
  : core ? 'doctect-normalized-core-v1' : 'doctect-normalized-record-v1';
export function recordFrame(store: ProjectStoreName, record: object, core: boolean | 'bulk' = false): Frame {
  return function* (emit) {
    const object = yield* dataObjectWork(record);
    const keys: string[] = [];
    for (const key of yield* primitive('keys', () => Object.keys(object))) yield* effect(1, () => {
      if (!omitCoreField(store, key, core)) keys.push(key);
    });
    const sorted = yield* stableSortWork(keys, compareStringsWork);
    yield* textWork('[', emit); yield* quoteWork(recordDomain(core), emit);
    yield* textWork(',', emit); yield* quoteWork(store, emit); yield* textWork(',{', emit);
    for (let index = 0; index < sorted.length; index++) {
      if (index) yield* textWork(',', emit);
      yield* quoteWork(sorted[index], emit); yield* textWork(':', emit);
      yield* canonicalWork(object[sorted[index]], emit);
    }
    yield* textWork('}]', emit);
  };
}
export function manifestFrame(scope: ProjectScope, proof: Omit<CommitProof, 'manifestDigest'>, selected: readonly SelectedPostcondition[],
  referenceAddresses: CommitDelta['referenceAddresses'] = [], foldTemplates: CommitDelta['foldTemplates'] = []): Frame {
  return function* (emit) {
    yield* textWork('["doctect-normalized-manifest-v1"', emit);
    for (const value of [scope, proof, selected, referenceAddresses, foldTemplates]) {
      yield* textWork(',', emit); yield* canonicalWork(value, emit);
    }
    yield* textWork(']', emit);
  };
}

export function frameRecord(store: ProjectStoreName, record: object, core: boolean | 'bulk' = false): string {
  const object = dataObject(record);
  const fields = Object.keys(object).filter(key => !omitCoreField(store, key, core)).sort();
  return `[${JSON.stringify(recordDomain(core))},${JSON.stringify(store)},{${fields.map(key => `${JSON.stringify(key)}:${canonicalStringify(object[key])}`).join(',')}}]`;
}
export function frameManifest(scope: ProjectScope, proof: Omit<CommitProof, 'manifestDigest'>, selected: readonly SelectedPostcondition[],
  referenceAddresses: CommitDelta['referenceAddresses'] = [], foldTemplates: CommitDelta['foldTemplates'] = []): string {
  return `["doctect-normalized-manifest-v1",${canonicalStringify(scope)},${canonicalStringify(proof)},${canonicalStringify(selected)},${canonicalStringify(referenceAddresses)},${canonicalStringify(foldTemplates)}]`;
}
export function frameBatch(batch: DocumentBatch | PreferenceBatch): string {
  const object = dataObject(batch);
  const field = (key: string, value: unknown): string => {
    if (key === 'changes') {
      denseDataArray(value);
      return `[${value.map(change => {
        const c = dataObject(change);
        return `{${Object.keys(c).sort().map(k => `${JSON.stringify(k)}:${k === 'generator'
          ? c[k] === undefined ? '["absent"]' : `["present",${canonicalStringify(c[k])}]` : canonicalStringify(c[k])}`).join(',')}}`;
      }).join(',')}]`;
    }
    if (key === 'structural') {
      const s = exactFields(value, ['expectedFoldStructureGeneration', 'mappings']);
      denseDataArray(s.mappings);
      return `{${JSON.stringify('expectedFoldStructureGeneration')}:${canonicalStringify(s.expectedFoldStructureGeneration)},"mappings":[${s.mappings.map(mapping => {
        const m = dataObject(mapping);
        return `{${Object.keys(m).sort().map(k => `${JSON.stringify(k)}:${k === 'cell' ? (() => {
          const cell = dataObject(m[k]);
          return `{${Object.keys(cell).sort().map(c => `${JSON.stringify(c)}:${canonicalStringify(cell[c])}`).join(',')}}`;
        })() : canonicalStringify(m[k])}`).join(',')}}`;
      }).join(',')}]}`;
    }
    if (key === 'metadata') {
      const metadata = dataObject(value);
      return `{${Object.keys(metadata).sort().map(name => `${JSON.stringify(name)}:${name === 'cloud' ? (() => {
        const cloud = dataObject(metadata[name]);
        // Validate/hash each payload independently of private operation tags.
        return `{${Object.keys(cloud).sort().map(field => `${JSON.stringify(field)}:${canonicalStringify(cloud[field])}`).join(',')}}`;
      })() : canonicalStringify(metadata[name])}`).join(',')}}`;
    }
    return canonicalStringify(value);
  };
  return `["doctect-normalized-batch-v1",{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${field(key, object[key])}`).join(',')}}]`;
}
