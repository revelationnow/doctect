import { assertWorkRuntime, effect, retainWork, type Ownership, type Work, type WorkRuntime } from '../../../shared/cooperativeWork.js';
import { compareStringsWork, rawValueWeightWork, stableSortWork } from '../../../shared/jsonWork.js';
import type { StoredProject, StoredWorkspace, StoredImportAttemptProvenance } from '../schema';
import type { AuthorityStamp, NormalizationSource } from './schema';
import { canonicalTimestamp, denseDataArrayWork, exactFieldsWork, privateId, requireContract, safeCounter, validDigest,
  validateWorkspaceBirthOriginWork, workspaceBirthOriginFields } from './commitProof';
import { canonicalFrame, envelopeFrame, hashFrame } from './work';
import { validateWorkspaceWindowWork, workspaceManifestCoreFrame } from './workspaceCommitProof';
export { workspaceManifestCoreFrame } from './workspaceCommitProof';

export interface WorkspaceCommandIdentity { clientId: string; commandSequence: number; commandId: string }
export interface WorkspaceStamp { revision: number; coreDigest: string }
export interface WorkspaceReceipt {
  identity: WorkspaceCommandIdentity; requestDigest: string; before: WorkspaceStamp; after: WorkspaceStamp;
  postconditionDigest: string; proofDigest: string;
}
export interface WorkspaceCommitWindow { floorRevision: number; floorCoreDigest: string; entries: readonly WorkspaceReceipt[] }
export interface WorkspaceActivation {
  attemptId: string; sourceKind: 'historical' | 'fresh'; sourceDigest: string;
  sourceArchiveId: string; sourceArchiveDigest: string; sourceWorkspaceRevision: number;
}
export interface ProjectBaselineDigests { imageDigest: string; documentDigest: string; preferenceDigest: string; foldDigest: string; recordCount: number }
export interface WorkspaceBirthOrigin {
  kind: 'workspace-command'; identity: WorkspaceCommandIdentity; requestDigest: string;
  workspaceRevision: number; memberOrdinal: number; createdAt: string; authority: AuthorityStamp;
}
export type WorkspaceProjectBirth = { kind: 'migration'; sourceRevision: number; sourceUpdatedAt: string; projectDigest: string }
  | (WorkspaceBirthOrigin & { digests: ProjectBaselineDigests });
export type ConsumedImportMetadata = Pick<StoredProject, 'consumedImportId' | 'consumedImportCreatedAt' | 'consumedImportDigest' | 'consumedImportAttempt'>;
export interface WorkspaceMember { projectId: string; incarnation: string; birth: WorkspaceProjectBirth; consumedImport: ConsumedImportMetadata }
export interface PresetDescriptor { id: string; position: number; recordDigest: string }
export interface ImportDescriptor {
  id: string; position: number; targetProjectId: string; createdAt: string; recordDigest: string;
  pendingImportDigest: string; attemptProvenance?: StoredImportAttemptProvenance;
}
export interface WorkspaceManifestCore {
  id: 'current'; kind: 'normalized-workspace'; formatVersion: 3; manifestVersion: 1;
  storageGeneration: string; activation: WorkspaceActivation; revision: number;
  members: readonly WorkspaceMember[]; activeProjectId: string;
  presets: readonly PresetDescriptor[]; pendingImports: readonly ImportDescriptor[];
  legacyAcceptance: { kind: 'fresh' } | { kind: 'accepted'; digest: string; backupId: string };
}
export interface NormalizedWorkspaceManifest extends WorkspaceManifestCore {
  coreDigest: string; lastCommit: WorkspaceReceipt | null; commitWindow: WorkspaceCommitWindow;
}

const consumedFields = ['consumedImportId', 'consumedImportCreatedAt', 'consumedImportDigest', 'consumedImportAttempt'] as const;
function externalId(value: unknown): asserts value is string {
  requireContract(typeof value === 'string' && value.length > 0, 'Invalid external identity');
}
function* sortedUniqueIds(values: readonly string[], owned: Ownership): Work<string[]> {
  // Reserve the two merge-sort reference buffers; payload strings stay borrowed.
  owned.grow(values.length * 16);
  const sorted = yield* stableSortWork(values, compareStringsWork);
  for (let i = 1; i < sorted.length; i++) requireContract((yield* compareStringsWork(sorted[i - 1], sorted[i])) !== 0, 'Duplicate external identity');
  return sorted;
}
function* lookup<T>(sorted: readonly T[], key: (value: T) => string, id: string): Work<T | undefined> {
  let start = 0; let end = sorted.length;
  while (start < end) {
    const at = start + Math.floor((end - start) / 2); const comparison = yield* compareStringsWork(key(sorted[at]), id);
    if (!comparison) return sorted[at];
    if (comparison < 0) start = at + 1; else end = at;
  }
  return undefined;
}
function* attemptWork(value: unknown, digest?: string): Work<void> {
  const attempt = yield* exactFieldsWork(value, ['sourceKeyDigest', 'payloadDigest', 'pendingImportDigest']);
  for (const key of ['sourceKeyDigest', 'payloadDigest', 'pendingImportDigest']) yield* effect(1, () => validDigest(attempt[key]));
  requireContract(digest === undefined || attempt.pendingImportDigest === digest, 'Import attempt digest mismatch');
}
function* consumedWork(value: unknown): Work<void> {
  const consumed = yield* exactFieldsWork(value, [], consumedFields);
  // Historical validation permits ID-only or ID+timestamp provenance.
  if (Object.hasOwn(consumed, 'consumedImportId')) externalId(consumed.consumedImportId);
  const created = Object.hasOwn(consumed, 'consumedImportCreatedAt'); const digest = Object.hasOwn(consumed, 'consumedImportDigest');
  if (created) {
    externalId(consumed.consumedImportId); canonicalTimestamp(consumed.consumedImportCreatedAt);
  }
  if (digest) {
    requireContract(created, 'Incomplete consume provenance'); validDigest(consumed.consumedImportDigest);
  }
  if (Object.hasOwn(consumed, 'consumedImportAttempt')) {
    requireContract(created && digest, 'Missing consumed import evidence');
    yield* attemptWork(consumed.consumedImportAttempt, consumed.consumedImportDigest as string);
  }
}
function* activationWork(value: unknown): Work<WorkspaceActivation> {
  const a = yield* exactFieldsWork(value, ['attemptId', 'sourceKind', 'sourceDigest', 'sourceArchiveId', 'sourceArchiveDigest', 'sourceWorkspaceRevision']);
  privateId(a.attemptId); privateId(a.sourceArchiveId); validDigest(a.sourceDigest); validDigest(a.sourceArchiveDigest); safeCounter(a.sourceWorkspaceRevision);
  requireContract(a.sourceKind === 'historical' || a.sourceKind === 'fresh', 'Invalid workspace source kind');
  return value as WorkspaceActivation;
}
function* birthWork(value: unknown, initialRevision: number, currentRevision: number): Work<void> {
  const birth = yield* exactFieldsWork(value, ['kind'], ['sourceRevision', 'sourceUpdatedAt', 'projectDigest',
    'identity', 'requestDigest', 'workspaceRevision', 'memberOrdinal', 'createdAt', 'authority', 'digests']);
  if (birth.kind === 'migration') {
    yield* exactFieldsWork(value, ['kind', 'sourceRevision', 'sourceUpdatedAt', 'projectDigest']);
    safeCounter(birth.sourceRevision); canonicalTimestamp(birth.sourceUpdatedAt); validDigest(birth.projectDigest);
  } else {
    yield* exactFieldsWork(value, [...workspaceBirthOriginFields, 'digests']);
    const origin = yield* validateWorkspaceBirthOriginWork({ kind: birth.kind, identity: birth.identity, requestDigest: birth.requestDigest,
      workspaceRevision: birth.workspaceRevision, memberOrdinal: birth.memberOrdinal, createdAt: birth.createdAt, authority: birth.authority });
    requireContract(origin.workspaceRevision > initialRevision && origin.workspaceRevision <= currentRevision, 'Workspace birth revision mismatch');
    const digests = yield* exactFieldsWork(birth.digests, ['imageDigest', 'documentDigest', 'preferenceDigest', 'foldDigest', 'recordCount']);
    for (const name of ['imageDigest', 'documentDigest', 'preferenceDigest', 'foldDigest']) yield* effect(1, () => validDigest(digests[name]));
    safeCounter(digests.recordCount); requireContract(digests.recordCount > 0, 'Empty project birth');
  }
}

/** Strict metadata admission. This does not verify hashes or mint editing authority. */
export function* validateWorkspaceManifestWork(value: unknown): Work<NormalizedWorkspaceManifest> {
  const m = yield* exactFieldsWork(value, ['id', 'kind', 'formatVersion', 'manifestVersion', 'storageGeneration', 'activation',
    'revision', 'members', 'activeProjectId', 'presets', 'pendingImports', 'legacyAcceptance', 'coreDigest', 'lastCommit', 'commitWindow']);
  requireContract(m.id === 'current' && m.kind === 'normalized-workspace' && m.formatVersion === 3 && m.manifestVersion === 1, 'Unknown workspace manifest');
  privateId(m.storageGeneration); safeCounter(m.revision); externalId(m.activeProjectId); validDigest(m.coreDigest);
  const activation = yield* activationWork(m.activation);
  requireContract(m.revision >= activation.sourceWorkspaceRevision, 'Workspace predates source');
  yield* denseDataArrayWork(m.members); yield* denseDataArrayWork(m.presets); yield* denseDataArrayWork(m.pendingImports);
  const owned = yield* retainWork(0);
  try {
  const members = m.members as unknown[]; const ids: string[] = []; const consumedIds: string[] = [];
  requireContract(members.length > 0, 'Empty workspace');
  for (const candidate of members) {
    const member = yield* exactFieldsWork(candidate, ['projectId', 'incarnation', 'birth', 'consumedImport']);
    externalId(member.projectId); externalId(member.incarnation);
    yield* effect(1, () => { owned.grow(8); ids.push(member.projectId as string); });
    yield* birthWork(member.birth, activation.sourceWorkspaceRevision, m.revision);
    yield* consumedWork(member.consumedImport);
    const consumed = member.consumedImport as ConsumedImportMetadata;
    if (consumed.consumedImportId !== undefined) {
      yield* effect(1, () => { owned.grow(8); consumedIds.push(consumed.consumedImportId!); });
    }
  }
  const sortedIds = yield* sortedUniqueIds(ids, owned);
  yield* sortedUniqueIds(consumedIds, owned);
  requireContract((yield* lookup(sortedIds, value => value, m.activeProjectId)) !== undefined, 'Missing active member');
  for (const [kind, candidates] of [['preset', m.presets], ['import', m.pendingImports]] as const) {
    const seen: string[] = []; let position = -1;
    for (const candidate of candidates as unknown[]) {
      const fields = kind === 'preset' ? ['id', 'position', 'recordDigest']
        : ['id', 'position', 'targetProjectId', 'createdAt', 'recordDigest', 'pendingImportDigest'];
      const descriptor = yield* exactFieldsWork(candidate, fields, kind === 'import' ? ['attemptProvenance'] : []);
      externalId(descriptor.id); safeCounter(descriptor.position); validDigest(descriptor.recordDigest);
      requireContract(descriptor.position > position, 'Invalid ancillary order');
      yield* effect(1, () => { owned.grow(8); seen.push(descriptor.id as string); }); position = descriptor.position;
      if (kind === 'import') {
        externalId(descriptor.targetProjectId); canonicalTimestamp(descriptor.createdAt); validDigest(descriptor.pendingImportDigest);
        // Preserve historically admitted provenance, even when a later body no longer
        // matches that attempt. Command-time import CAS owns that additional check.
        if (Object.hasOwn(descriptor, 'attemptProvenance')) yield* attemptWork(descriptor.attemptProvenance);
      }
    }
    // Cross-namespace/target collisions can exist in valid retained historical
    // records. Preserve them here; mutation-time import checks remain stricter.
    yield* sortedUniqueIds(seen, owned);
  }
  const acceptance = yield* exactFieldsWork(m.legacyAcceptance, ['kind'], ['digest', 'backupId']);
  if (acceptance.kind === 'fresh') {
    yield* exactFieldsWork(acceptance, ['kind']); requireContract(activation.sourceKind === 'fresh', 'Historical source requires acceptance');
  } else {
    yield* exactFieldsWork(acceptance, ['kind', 'digest', 'backupId']);
    requireContract(acceptance.kind === 'accepted', 'Unknown legacy acceptance'); validDigest(acceptance.digest); externalId(acceptance.backupId);
  }
  yield* validateWorkspaceWindowWork(m.commitWindow, { revision: m.revision, coreDigest: m.coreDigest }, m.lastCommit as WorkspaceReceipt | null);
  return value as NormalizedWorkspaceManifest;
  } finally { owned.release(); }
}

export function* projectWorkspaceOrderWork(value: NormalizedWorkspaceManifest): Work<StoredWorkspace> {
  const projectOrder: string[] = [];
  for (const member of value.members) yield* effect(1, () => { projectOrder.push(member.projectId); });
  return { id: 'current', projectOrder, activeProjectId: value.activeProjectId, revision: value.revision };
}

/** Source is a previously captured/validated immutable owner image, not caller authority. */
export async function createInitialWorkspaceManifest(source: NormalizationSource, activation: WorkspaceActivation,
  work: WorkRuntime): Promise<NormalizedWorkspaceManifest> {
  assertWorkRuntime(work); await work.run(activationWork(activation));
  requireContract(activation.sourceDigest === source.sourceDigest && activation.sourceKind === source.kind
    && activation.sourceWorkspaceRevision === source.records.workspace.revision, 'Workspace activation/source mismatch');
  const owned = work.own(16 * (source.records.projects.length + source.sourceProjects.length));
  try {
  const rows = await work.run(stableSortWork(source.records.projects, (a, b) => compareStringsWork(a.id, b.id)));
  const identities = await work.run(stableSortWork(source.sourceProjects, (a, b) => compareStringsWork(a.projectId, b.projectId)));
  for (let i = 1; i < rows.length; i++) requireContract(await work.run(compareStringsWork(rows[i - 1].id, rows[i].id)) !== 0, 'Duplicate source project');
  for (let i = 1; i < identities.length; i++) requireContract(await work.run(compareStringsWork(identities[i - 1].projectId, identities[i].projectId)) !== 0, 'Duplicate source identity');
  const members: WorkspaceMember[] = []; const presets: PresetDescriptor[] = []; const pendingImports: ImportDescriptor[] = [];
  for (const id of source.records.workspace.projectOrder) {
    const row = await work.run(lookup(rows, value => value.id, id)); const identity = await work.run(lookup(identities, value => value.projectId, id));
    requireContract(row && identity && row.storageRevision === identity.revision, 'Missing source member');
    requireContract(await work.run(compareStringsWork(row.incarnation, identity.incarnation)) === 0, 'Source incarnation mismatch');
    const consumedImport: ConsumedImportMetadata = {};
    for (const field of consumedFields) if (Object.hasOwn(row, field)) await work.run(effect(1, () => {
      Object.assign(consumedImport, { [field]: field === 'consumedImportAttempt' ? { ...row.consumedImportAttempt } : row[field] });
    }));
    const member: WorkspaceMember = { projectId: id, incarnation: row.incarnation, consumedImport,
      birth: { kind: 'migration', sourceRevision: row.storageRevision, sourceUpdatedAt: row.updatedAt, projectDigest: identity.digest } };
    owned.grow(8 + (await work.run(rawValueWeightWork(member))).bytes); members.push(member);
  }
  requireContract(members.length === rows.length && members.length === identities.length, 'Source membership mismatch');
  owned.grow(16 * (source.records.presets.length + source.records.pendingImports.length));
  for (const row of await work.run(stableSortWork(source.records.presets, (a, b) => effect(1, () => a.position - b.position)))) {
    const recordDigest = await hashFrame(work, 'proof', envelopeFrame('workspace-preset-v1', row));
    const descriptor = { id: row.id, position: row.position, recordDigest };
    owned.grow(8 + (await work.run(rawValueWeightWork(descriptor))).bytes); presets.push(descriptor);
  }
  for (const row of await work.run(stableSortWork(source.records.pendingImports, (a, b) => effect(1, () => a.position - b.position)))) {
    const recordDigest = await hashFrame(work, 'proof', envelopeFrame('workspace-import-v1', row));
    const pendingImportDigest = await hashFrame(work, 'proof', canonicalFrame(row.pendingImport));
    const descriptor = { id: row.id, position: row.position, targetProjectId: row.pendingImport.targetProjectId,
      createdAt: row.pendingImport.createdAt, recordDigest, pendingImportDigest,
      ...(row.attemptProvenance ? { attemptProvenance: { ...row.attemptProvenance } } : {}) };
    owned.grow(8 + (await work.run(rawValueWeightWork(descriptor))).bytes); pendingImports.push(descriptor);
  }
  const core: WorkspaceManifestCore = { id: 'current', kind: 'normalized-workspace', formatVersion: 3, manifestVersion: 1,
    storageGeneration: `normalized:${source.sourceDigest}`, activation: { ...activation }, revision: source.records.workspace.revision,
    members, activeProjectId: source.records.workspace.activeProjectId, presets, pendingImports,
    legacyAcceptance: source.kind === 'fresh' ? { kind: 'fresh' } : { kind: 'accepted',
      digest: source.ledger!.acceptedLegacyDigest, backupId: source.ledger!.acceptedLegacyBackupId } };
  // Members/descriptors are already owned above; count only the remaining core envelope.
  owned.grow((await work.run(rawValueWeightWork({ ...core, members: [], presets: [], pendingImports: [] }))).bytes);
  const coreDigest = await hashFrame(work, 'proof', workspaceManifestCoreFrame(core));
  const result: NormalizedWorkspaceManifest = { ...core, coreDigest, lastCommit: null,
    commitWindow: { floorRevision: core.revision, floorCoreDigest: coreDigest, entries: [] } };
  await work.run(validateWorkspaceManifestWork(result)); return result;
  } finally { owned.release(); }
}

export async function deriveWorkspaceIncarnation(storageGeneration: string, nextRevision: number,
  memberOrdinal: number, work: WorkRuntime): Promise<string> {
  assertWorkRuntime(work); privateId(storageGeneration); safeCounter(nextRevision); safeCounter(memberOrdinal);
  requireContract(nextRevision > 0, 'Invalid creation revision');
  return `workspace:${await hashFrame(work, 'proof', canonicalFrame(['doctect-workspace-incarnation-v1', storageGeneration, nextRevision, memberOrdinal]))}`;
}
