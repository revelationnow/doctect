import type { SnapshotWorkspaceCommand, WorkspaceCustomPreset, WorkspacePendingImport } from '../contracts';
import type { AuthorityStamp, NormalizedProject, ProjectScope } from './schema';
import type { ImportDescriptor, PresetDescriptor, WorkspaceCommandIdentity, WorkspaceReceipt, WorkspaceStamp } from './workspaceManifest';
import { assertWorkRuntime, effect, primitive, runSync, type Ownership, type Work, type WorkRuntime } from '../../../shared/cooperativeWork.js';
import { canonicalBytesWork, canonicalText, compareStringsWork, copyEnumerableWork, rawValueWeightWork, stableSortWork } from '../../../shared/jsonWork.js';
import { authority, canonicalTimestamp, denseDataArrayWork, exactFieldsWork, frameRecord, privateId, requireContract, safeCounter, validDigest } from './commitProof';
import { canonicalFrame, envelopeFrame, envelopeFrameText, equalFrameWork, hashFrame, orderedFrame } from './work';
import { decomposeProject, decomposeProjectWork, reconstructProjectWork } from './codec';
import { createProjectBirthDigests, createTrustedProjectBirthDigests, verifyProjectBirth } from './projectBaseline';
import { deriveWorkspaceIncarnation, validateWorkspaceManifestWork, workspaceManifestCoreFrame,
  type NormalizedWorkspaceManifest, type WorkspaceMember, type WorkspaceBirthOrigin } from './workspaceManifest';
import { appendWorkspaceReceipt, verifyWorkspaceReceipts, workspaceReceiptFrame } from './workspaceCommitProof';
import { diffWorkspaceCatalogWork, projectWorkspaceCatalogWork } from '../workspaceCatalog';
import { checkCustomPresetWork, checkMigratedStateWork, checkPendingImportWork, preparePendingImport,
  preparePendingImportWork, validateCustomPresetWork, validateMigratedState, validateWorkspaceProject, validateWorkspaceProjectWork } from '../validation';
import type { WorkspaceImportAttemptProvenance, WorkspaceProject } from '../contracts';
import type { StoredPendingImport, StoredPreset, StoredImportAttemptProvenance } from '../schema';
import { NORMALIZED_STORE_NAMES, type ProjectHeader, type ProjectStoreName } from './schema';
import { frameRecoverySource, prepareWorkspaceRecoveryCopies, recoveryBackupId, validateRecoverySource, type WorkspaceRecoveryIntent } from './workspaceRecovery';
import type { RecoveryPreparationEnvironment } from '../recovery';
import type { LegacyBackupRecord } from '../schema';

const projectStores = NORMALIZED_STORE_NAMES.filter((name): name is ProjectStoreName => name !== 'normalizationLedger');

export type WorkspaceLifecycleIntent = Exclude<SnapshotWorkspaceCommand, { type: 'save-project' | 'recover-legacy-as-copies' }>;
export type WorkspaceTarget = { readonly type: 'member'; readonly scope: ProjectScope }
  | { readonly type: 'lineage'; readonly scope: ProjectScope; readonly authority: AuthorityStamp };
export interface WorkspaceBatch {
  readonly storageGeneration: string;
  readonly identity: WorkspaceCommandIdentity;
  readonly expected: WorkspaceStamp;
  readonly targets: readonly WorkspaceTarget[];
  readonly intent: WorkspaceLifecycleIntent | WorkspaceRecoveryIntent;
}
export interface WorkspaceCatalog {
  readonly storageGeneration: string;
  readonly stamp: WorkspaceStamp;
  readonly members: readonly ProjectScope[];
  readonly activeProjectId: string;
  readonly presets: readonly PresetDescriptor[];
  readonly pendingImports: readonly ImportDescriptor[];
}
export interface WorkspaceCatalogDelta {
  readonly storageGeneration: string;
  readonly before: WorkspaceStamp;
  readonly after: WorkspaceStamp;
  readonly removed: readonly ProjectScope[];
  readonly added: readonly { readonly index: number; readonly scope: ProjectScope }[];
  readonly activeProjectId: string;
  readonly presets: { readonly remove: readonly string[]; readonly upsert: readonly PresetDescriptor[] };
  readonly pendingImports: { readonly remove: readonly string[]; readonly upsert: readonly ImportDescriptor[] };
}
export interface WorkspaceProjectMaterialization {
  readonly scope: ProjectScope;
  readonly authority: AuthorityStamp;
  readonly records: NormalizedProject;
}
export interface WorkspaceCommandResult {
  readonly type: 'workspace-committed';
  readonly outcome: 'created' | 'activated' | 'closed' | 'preset-saved' | 'preset-deleted'
    | 'staged' | 'replaced' | 'consumed' | 'already-staged' | 'already-consumed' | 'recovered';
  readonly receipt: WorkspaceReceipt;
  readonly delta: WorkspaceCatalogDelta;
  readonly projects: readonly WorkspaceProjectMaterialization[];
  readonly presets: readonly WorkspaceCustomPreset[];
  readonly pendingImports: readonly WorkspacePendingImport[];
}
export interface WorkspaceInspectedResult extends Omit<WorkspaceCommandResult, 'type' | 'delta'> {
  readonly type: 'workspace-inspected-current';
  readonly catalog: WorkspaceCatalog;
}
declare const workspaceAdmissionBrand: unique symbol;
declare const workspaceFenceBrand: unique symbol;
export interface WorkspaceRepositoryAdmission { readonly [workspaceAdmissionBrand]: true }
export interface WorkspaceRepositoryFence { readonly [workspaceFenceBrand]: true }
export interface WorkspaceAdmission {
  readonly token: WorkspaceRepositoryAdmission;
  readonly catalog: WorkspaceCatalog;
  readonly projectAuthorities: readonly { readonly scope: ProjectScope; readonly authority: AuthorityStamp }[];
}
export type WorkspaceInspection = { readonly type: 'committed'; readonly result: WorkspaceInspectedResult }
  | { readonly type: 'not-committed' }
  | { readonly type: 'conflict'; readonly reason: 'authority-changed' | 'identity-mismatch'
      | 'proof-unavailable' | 'verification-failed' | 'incarnation-changed' }
  | { readonly type: 'unknown' };
export class WorkspaceCommandConflict extends Error {
  constructor(readonly reason: Extract<WorkspaceInspection, { type: 'conflict' }>['reason']) {
    super(reason); this.name = 'WorkspaceCommandConflict';
  }
}
export interface WorkspaceRepositoryMethods {
  admitWorkspace(): Promise<WorkspaceAdmission>;
  commitWorkspace(admission: WorkspaceRepositoryAdmission, batch: WorkspaceBatch): Promise<WorkspaceCommandResult>;
  fenceWorkspace(admission: WorkspaceRepositoryAdmission): Promise<WorkspaceRepositoryFence>;
  inspectWorkspaceAttempt(batch: WorkspaceBatch, fence?: WorkspaceRepositoryFence): Promise<WorkspaceInspection>;
}

export interface CapturedWorkspaceCommand {
  readonly manifest: NormalizedWorkspaceManifest;
  readonly initial: WorkspaceStamp;
  readonly memberHeaders: readonly ProjectHeader[];
  readonly projects: readonly NormalizedProject[];
  readonly presets: readonly StoredPreset[];
  readonly pendingImports: readonly StoredPendingImport[];
  readonly recovery?: { readonly backups: readonly LegacyBackupRecord[]; readonly durableIds: readonly string[] };
}
export interface PreparedWorkspaceMutation {
  readonly batch: WorkspaceBatch;
  readonly requestDigest: string;
  readonly manifest: NormalizedWorkspaceManifest;
  readonly outcome: WorkspaceCommandResult['outcome'];
  readonly addProjects: readonly NormalizedProject[];
  readonly removeProjects: readonly ProjectScope[];
  readonly putPresets: readonly StoredPreset[];
  readonly deletePresetIds: readonly string[];
  readonly putImports: readonly StoredPendingImport[];
  readonly deleteImportIds: readonly string[];
  readonly addBackup?: LegacyBackupRecord;
  readonly delta: WorkspaceCatalogDelta;
  release(): void;
}

const intentFields = {
  'create-and-activate-project': [['type', 'project'], []],
  'activate-project': [['type', 'projectId'], []],
  'close-project': [['type', 'projectId'], ['successor']],
  'save-custom-preset': [['type', 'preset'], []],
  'delete-custom-preset': [['type', 'presetId'], []],
  'stage-import': [['type', 'pendingImport'], ['attemptProvenance']],
  'replace-staged-import': [['type', 'expected', 'replacement'], []],
  'consume-import': [['type', 'importId'], []],
  'recover-legacy-as-copies': [['type', 'recoveryId', 'source', 'sourceDigest'], []],
} as const;
function externalId(value: unknown): asserts value is string {
  requireContract(typeof value === 'string' && value.length > 0, 'Invalid workspace identity');
}
/** Bounded command framing only. Never walks a project, state, preset or import payload. */
function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  requireContract(value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype, 'Invalid workspace command frame');
  const keys = Reflect.ownKeys(value);
  requireContract(keys.length <= required.length + optional.length, 'Unknown workspace command field');
  for (const key of keys) {
    requireContract(typeof key === 'string' && (required.includes(key) || optional.includes(key)), 'Unknown workspace command field');
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    requireContract(descriptor.enumerable && Object.hasOwn(descriptor, 'value'), 'Invalid workspace command data field');
  }
  for (const key of required) requireContract(Object.hasOwn(value, key), 'Missing workspace command field');
  return value as Record<string, unknown>;
}
function stamp(value: unknown): void {
  const s = fields(value, ['revision', 'coreDigest']); safeCounter(s.revision); validDigest(s.coreDigest);
}
function provenance(value: unknown, stored = false): void {
  const p = fields(value, stored ? ['sourceKeyDigest', 'payloadDigest', 'pendingImportDigest'] : ['sourceKeyDigest', 'payloadDigest']);
  for (const key of stored ? ['sourceKeyDigest', 'payloadDigest', 'pendingImportDigest'] : ['sourceKeyDigest', 'payloadDigest']) validDigest(p[key]);
}
export function frameWorkspaceBatch(value: unknown): asserts value is WorkspaceBatch {
  const b = fields(value, ['storageGeneration', 'identity', 'expected', 'targets', 'intent']); privateId(b.storageGeneration);
  const identity = fields(b.identity, ['clientId', 'commandId', 'commandSequence']);
  privateId(identity.clientId); privateId(identity.commandId); safeCounter(identity.commandSequence); stamp(b.expected);
  requireContract(b.intent !== null && typeof b.intent === 'object', 'Invalid workspace intent');
  const type = Object.getOwnPropertyDescriptor(b.intent, 'type');
  requireContract(type?.enumerable && Object.hasOwn(type, 'value') && typeof type.value === 'string'
    && Object.hasOwn(intentFields, type.value), 'Unsupported workspace intent');
  const kind = type.value as WorkspaceBatch['intent']['type'];
  const [required, optional] = intentFields[kind]; const intent = fields(b.intent, required, optional);
  const targetCount = kind === 'activate-project' || kind === 'close-project' ? 1 : 0;
  requireContract(Array.isArray(b.targets) && Object.getPrototypeOf(b.targets) === Array.prototype
    && b.targets.length === targetCount && Reflect.ownKeys(b.targets).length === targetCount + 1, 'Invalid workspace targets');
  if (targetCount) {
    const descriptor = Object.getOwnPropertyDescriptor(b.targets, '0');
    requireContract(descriptor && Object.hasOwn(descriptor, 'value'), 'Invalid workspace target');
    const target = fields(descriptor.value, kind === 'activate-project' ? ['type', 'scope'] : ['type', 'scope', 'authority']);
    requireContract(target.type === (kind === 'activate-project' ? 'member' : 'lineage'), 'Invalid workspace target kind');
    const scope = fields(target.scope, ['storageGeneration', 'projectId', 'incarnation']);
    privateId(scope.storageGeneration); externalId(scope.projectId); externalId(scope.incarnation); externalId(intent.projectId);
    requireContract(scope.storageGeneration === b.storageGeneration, 'Workspace target generation mismatch');
    if (kind === 'close-project') {
      const a = fields(target.authority, ['documentRevision', 'preferenceRevision', 'foldStructureGeneration']);
      for (const key of ['documentRevision', 'preferenceRevision', 'foldStructureGeneration']) safeCounter(a[key]);
    }
  }
  if (kind === 'delete-custom-preset') externalId(intent.presetId);
  if (kind === 'consume-import') externalId(intent.importId);
  if (kind === 'recover-legacy-as-copies') { privateId(intent.recoveryId); validDigest(intent.sourceDigest); frameRecoverySource(intent.source); }
  if (kind === 'stage-import' && intent.attemptProvenance !== undefined) provenance(intent.attemptProvenance);
  if (kind === 'replace-staged-import') {
    const expected = fields(intent.expected, ['importId', 'targetProjectId', 'createdAt', 'sourceKeyDigest', 'payloadDigest']);
    externalId(expected.importId); externalId(expected.targetProjectId); canonicalTimestamp(expected.createdAt);
    validDigest(expected.sourceKeyDigest); validDigest(expected.payloadDigest);
    const replacement = fields(intent.replacement, ['pendingImport', 'attemptProvenance']); provenance(replacement.attemptProvenance);
  }
}
function* capturedFrameWork(batch: WorkspaceBatch): Work<void> {
  yield* effect(1, () => frameWorkspaceBatch(batch));
  if (batch.intent.type === 'activate-project' || batch.intent.type === 'close-project') {
    requireContract((yield* compareStringsWork(batch.targets[0].scope.projectId, batch.intent.projectId)) === 0, 'Workspace target mismatch');
  }
}
export async function captureWorkspaceBatch(value: unknown, work: WorkRuntime): Promise<{ batch: WorkspaceBatch; release(): void }> {
  assertWorkRuntime(work); frameWorkspaceBatch(value);
  requireContract(work.snapshot().visits === 0, 'Workspace capture requires a fresh runtime');
  let batch: WorkspaceBatch | undefined, owner: Ownership | undefined;
  try {
    await work.run(primitive('clone', () => {
      owner = work.own(0, true); batch = structuredClone(value);
    }));
    owner!.grow((await work.run(rawValueWeightWork(batch))).bytes);
    await work.run(capturedFrameWork(batch!));
    return { batch: batch!, release: () => { owner!.release(); } };
  } catch (error) { owner?.release(); throw error; }
}

function requestParts(batch: WorkspaceBatch): { metadata: object; payloads: [string, unknown][] } {
  const intent = batch.intent;
  switch (intent.type) {
    case 'create-and-activate-project': return { metadata: { type: intent.type }, payloads: [['project', intent.project]] };
    case 'close-project': return { metadata: { type: intent.type, projectId: intent.projectId, successor: intent.successor !== undefined },
      payloads: intent.successor !== undefined ? [['successor', intent.successor]] : [] };
    case 'save-custom-preset': return { metadata: { type: intent.type }, payloads: [['preset', intent.preset]] };
    case 'stage-import': return { metadata: { type: intent.type, ...(intent.attemptProvenance !== undefined ? { attemptProvenance: intent.attemptProvenance } : {}) },
      payloads: [['pendingImport', intent.pendingImport]] };
    case 'replace-staged-import': return { metadata: { type: intent.type, expected: intent.expected, attemptProvenance: intent.replacement.attemptProvenance },
      payloads: [['pendingImport', intent.replacement.pendingImport]] };
    case 'recover-legacy-as-copies': return { metadata: { type: intent.type, recoveryId: intent.recoveryId, sourceDigest: intent.sourceDigest },
      payloads: [['source', intent.source]] };
    default: return { metadata: intent, payloads: [] };
  }
}
const requestFrameValue = (batch: WorkspaceBatch, metadata: object, payloads: [string, string][]) =>
  ['doctect-workspace-request-v1', batch.storageGeneration, batch.identity, batch.expected, batch.targets, metadata, payloads];

export async function hashWorkspaceRequest(batch: WorkspaceBatch, work: WorkRuntime): Promise<string> {
  await work.run(capturedFrameWork(batch));
  const { metadata, payloads } = requestParts(batch), digests: [string, string][] = [];
  for (const [name, value] of payloads) {
    // Ordered JSON framing must not erase invalid values into another request's identity.
    await work.run(canonicalBytesWork(value));
    digests.push([name, await hashFrame(work, 'proof', orderedFrame(value))]);
  }
  return hashFrame(work, 'proof', canonicalFrame(requestFrameValue(batch, metadata, digests)));
}
/** Native twin for the worker's own commit; tests pin equality with hashWorkspaceRequest. */
export async function hashTrustedWorkspaceRequest(batch: WorkspaceBatch, hash: (text: string) => Promise<string>): Promise<string> {
  runSync(capturedFrameWork(batch));
  const { metadata, payloads } = requestParts(batch), digests: [string, string][] = [];
  for (const [name, value] of payloads) {
    canonicalText(value);
    // Canonical validation above admits only plain JSON data, which JSON.stringify frames in ordered form.
    digests.push([name, await hash(JSON.stringify(value))]);
  }
  return hash(canonicalText(requestFrameValue(batch, metadata, digests)));
}

function* findWork<T>(values: readonly T[], id: string, key: (value: T) => string): Work<T | undefined> {
  for (const value of values) if ((yield* compareStringsWork(key(value), id)) === 0) return value;
  return undefined;
}
function* copyListWork<T>(values: readonly T[], owner: Ownership): Work<T[]> {
  const result: T[] = [];
  for (const value of values) yield* effect(1, () => { owner.grow(8); result.push(value); });
  return result;
}
function* withoutWork<T>(values: readonly T[], id: string, key: (value: T) => string, owner: Ownership): Work<T[]> {
  const result: T[] = [];
  for (const value of values) if ((yield* compareStringsWork(key(value), id)) !== 0) yield* effect(1, () => { owner.grow(8); result.push(value); });
  return result;
}
async function same(work: WorkRuntime, left: unknown, right: unknown): Promise<boolean> {
  return work.run(equalFrameWork(canonicalFrame(left), canonicalFrame(right)));
}
async function presetDescriptor(row: StoredPreset, work: WorkRuntime): Promise<PresetDescriptor> {
  return { id: row.id, position: row.position, recordDigest: await hashFrame(work, 'proof', envelopeFrame('workspace-preset-v1', row)) };
}
async function importDescriptor(row: StoredPendingImport, work: WorkRuntime): Promise<ImportDescriptor> {
  return { id: row.id, position: row.position, targetProjectId: row.pendingImport.targetProjectId, createdAt: row.pendingImport.createdAt,
    recordDigest: await hashFrame(work, 'proof', envelopeFrame('workspace-import-v1', row)),
    pendingImportDigest: await hashFrame(work, 'proof', canonicalFrame(row.pendingImport)),
    ...(Object.hasOwn(row, 'attemptProvenance') ? { attemptProvenance: { ...row.attemptProvenance! } } : {}) };
}
/** Native twin of importDescriptor for the worker's own commit; tests pin equality. */
export async function trustedImportDescriptor(row: StoredPendingImport, hash: (text: string) => Promise<string>): Promise<ImportDescriptor> {
  return { id: row.id, position: row.position, targetProjectId: row.pendingImport.targetProjectId, createdAt: row.pendingImport.createdAt,
    recordDigest: await hash(envelopeFrameText('workspace-import-v1', row)),
    pendingImportDigest: await hash(canonicalText(row.pendingImport)),
    ...(Object.hasOwn(row, 'attemptProvenance') ? { attemptProvenance: { ...row.attemptProvenance! } } : {}) };
}
interface TrustedCaptureCheck { hash(text: string): Promise<string>; writtenImports?: readonly StoredPendingImport[] }
/** Trusted Import: validateCapture's pending-import row checks with the sync traversals and native digests.
 * A row this commit just wrote is proved by equal frame text; it was prepared once from the batch. */
async function checkTrustedImportRow(row: StoredPendingImport, manifest: NormalizedWorkspaceManifest, trusted: TrustedCaptureCheck): Promise<void> {
  const written = trusted.writtenImports?.find(value => value.id === row.id);
  if (written) {
    requireContract(envelopeFrameText('workspace-import-v1', row) === envelopeFrameText('workspace-import-v1', written), 'Pending import readback mismatch');
  } else {
    runSync(exactFieldsWork(row, ['id', 'pendingImport', 'position'], ['attemptProvenance', ''])); externalId(row.id); safeCounter(row.position);
    const pending = row.pendingImport;
    runSync(exactFieldsWork(pending, ['id', 'targetProjectId', 'name', 'state', 'createdAt', 'warnings'], ['cloud', '']));
    requireContract(Array.isArray(pending.warnings), 'Invalid retained import warnings');
    for (let i = 0; i < pending.warnings.length; i++) {
      if (i in pending.warnings) requireContract(typeof pending.warnings[i] === 'string', 'Invalid retained import warning');
    }
    const input = runSync(copyEnumerableWork(pending)) as unknown as Record<string, unknown>; delete input.warnings;
    validateMigratedState(pending.state); preparePendingImport(input, { warningPolicy: 'reject' });
    requireContract(row.id === pending.id, 'Pending import identity mismatch');
    if (row.attemptProvenance !== undefined) provenance(row.attemptProvenance, true);
  }
  const descriptor = manifest.pendingImports.find(value => value.id === row.id);
  requireContract(descriptor && canonicalText(descriptor) === canonicalText(await trustedImportDescriptor(row, trusted.hash)), 'Import descriptor mismatch');
}
async function validateCapture(captured: CapturedWorkspaceCommand, batch: WorkspaceBatch, work: WorkRuntime, before = true, trusted?: TrustedCaptureCheck): Promise<void> {
  await work.run(capturedFrameWork(batch)); await work.run(validateWorkspaceManifestWork(captured.manifest));
  await verifyWorkspaceReceipts(captured.manifest, captured.initial, work);
  requireContract(captured.manifest.storageGeneration === batch.storageGeneration, 'Workspace generation changed');
  if (before) requireContract(captured.manifest.revision === batch.expected.revision
    && captured.manifest.coreDigest === batch.expected.coreDigest, 'Workspace authority changed');
  for (const row of captured.presets) {
    await work.run(exactFieldsWork(row, ['id', 'preset', 'position'], [''])); externalId(row.id); safeCounter(row.position);
    await work.run(checkMigratedStateWork(row.preset.initialState));
    await work.run(checkCustomPresetWork(row.preset, { warningPolicy: 'reject', existingIds: new Set() }));
    requireContract((await work.run(compareStringsWork(row.id, row.preset.id))) === 0, 'Preset identity mismatch');
    const descriptor = await work.run(findWork(captured.manifest.presets, row.id, value => value.id));
    requireContract(descriptor && await same(work, descriptor, await presetDescriptor(row, work)), 'Preset descriptor mismatch');
  }
  for (const row of captured.pendingImports) {
    if (trusted) { await work.run(effect(1, () => {})); await checkTrustedImportRow(row, captured.manifest, trusted); continue; }
    await work.run(exactFieldsWork(row, ['id', 'pendingImport', 'position'], ['attemptProvenance', ''])); externalId(row.id); safeCounter(row.position);
    const pending = row.pendingImport;
    await work.run(exactFieldsWork(pending, ['id', 'targetProjectId', 'name', 'state', 'createdAt', 'warnings'], ['cloud', '']));
    requireContract(Array.isArray(pending.warnings), 'Invalid retained import warnings');
    for (let i = 0; i < pending.warnings.length; i++) await work.run(effect(1, () => {
      if (i in pending.warnings) requireContract(typeof pending.warnings[i] === 'string', 'Invalid retained import warning');
    }));
    const input = await work.run(copyEnumerableWork(pending)) as unknown as Record<string, unknown>; delete input.warnings;
    await work.run(checkMigratedStateWork(pending.state)); await work.run(checkPendingImportWork(input, { warningPolicy: 'reject' }));
    requireContract((await work.run(compareStringsWork(row.id, pending.id))) === 0, 'Pending import identity mismatch');
    if (row.attemptProvenance !== undefined) provenance(row.attemptProvenance, true);
    const descriptor = await work.run(findWork(captured.manifest.pendingImports, row.id, value => value.id));
    requireContract(descriptor && await same(work, descriptor, await importDescriptor(row, work)), 'Import descriptor mismatch');
  }
}

async function requireLiveMember(captured: CapturedWorkspaceCommand, member: WorkspaceMember, work: WorkRuntime): Promise<void> {
  const header = await work.run(findWork(captured.memberHeaders, member.projectId, value => value.key[1]));
  if (!header || header.formatVersion !== 3 || header.key[0] !== captured.manifest.storageGeneration
    || (await work.run(compareStringsWork(header.value.id, member.projectId))) !== 0
    || (await work.run(compareStringsWork(header.incarnation, member.incarnation))) !== 0) {
    throw new WorkspaceCommandConflict('incarnation-changed');
  }
  safeCounter(header.storageRevision); safeCounter(header.foldStructureGeneration);
}

/** Deterministic logical after-state; no historic catalog or address list is required. */
async function postconditionDigest(batch: WorkspaceBatch, manifest: NormalizedWorkspaceManifest,
  outcome: WorkspaceCommandResult['outcome'], work: WorkRuntime): Promise<string> {
  const created: WorkspaceMember[] = [], removed: ProjectScope[] = [], consumed: WorkspaceMember[] = [];
  for (const member of manifest.members) {
    if (member.birth.kind === 'workspace-command' && member.birth.workspaceRevision === manifest.revision
      && await same(work, member.birth.identity, batch.identity)) created.push(member);
    const id = batch.intent.type === 'consume-import' ? batch.intent.importId
      : batch.intent.type === 'stage-import' ? batch.intent.pendingImport.id
        : batch.intent.type === 'replace-staged-import' ? batch.intent.replacement.pendingImport.id : undefined;
    if (id !== undefined && member.consumedImport.consumedImportId !== undefined
      && (await work.run(compareStringsWork(id, member.consumedImport.consumedImportId))) === 0) consumed.push(member);
    await work.run(effect(1, () => {}));
  }
  if (batch.intent.type === 'close-project') removed.push(batch.targets[0].scope);
  const kind = batch.intent.type;
  const presetKind = kind === 'save-custom-preset' || kind === 'delete-custom-preset' || kind === 'recover-legacy-as-copies';
  const importKind = kind === 'stage-import' || kind === 'replace-staged-import' || kind === 'consume-import' || kind === 'recover-legacy-as-copies';
  return hashFrame(work, 'proof', canonicalFrame(['doctect-workspace-postconditions-v1', {
    intent: kind, outcome, after: { revision: manifest.revision, coreDigest: manifest.coreDigest }, created, removed, consumed,
    presets: presetKind ? manifest.presets : [], pendingImports: importKind ? manifest.pendingImports : [],
    ...(kind === 'recover-legacy-as-copies' ? { legacyAcceptance: manifest.legacyAcceptance } : {}),
  }]));
}

/** The worker's own commit: request digest already computed, native hashing for new projects. */
export interface TrustedWorkspacePreparation { requestDigest: string; hash(text: string): Promise<string> }
export async function prepareWorkspaceMutation(captured: CapturedWorkspaceCommand, batch: WorkspaceBatch, now: string,
  work: WorkRuntime, recoveryEnvironment?: RecoveryPreparationEnvironment, trusted?: TrustedWorkspacePreparation): Promise<PreparedWorkspaceMutation> {
  assertWorkRuntime(work); canonicalTimestamp(now); const owner = work.own(0);
  let recoveryCopies: Awaited<ReturnType<typeof prepareWorkspaceRecoveryCopies>> | undefined;
  try {
    await validateCapture(captured, batch, work, true, trusted ? { hash: trusted.hash } : undefined);
    requireContract(captured.manifest.revision < Number.MAX_SAFE_INTEGER, 'Workspace revision exhausted');
    const next: NormalizedWorkspaceManifest = { ...captured.manifest, revision: captured.manifest.revision + 1,
      members: await work.run(copyListWork(captured.manifest.members, owner)),
      presets: await work.run(copyListWork(captured.manifest.presets, owner)),
      pendingImports: await work.run(copyListWork(captured.manifest.pendingImports, owner)) };
    const addProjects: NormalizedProject[] = [], removeProjects: ProjectScope[] = [];
    const putPresets: StoredPreset[] = [], deletePresetIds: string[] = [], putImports: StoredPendingImport[] = [], deleteImportIds: string[] = [];
    const requestDigest = trusted?.requestDigest ?? await hashWorkspaceRequest(batch, work);
    // Trusted Import: native twin of hashFrame(work, 'proof', canonicalFrame(value)).
    const proofDigest = (value: unknown) => trusted ? trusted.hash(canonicalText(value)) : hashFrame(work, 'proof', canonicalFrame(value));
    const member = (id: string) => work.run(findWork(next.members, id, value => value.projectId));
    const addProject = async (raw: WorkspaceProject, consumedImport: WorkspaceMember['consumedImport'] = {}) => {
      const project = trusted ? validateWorkspaceProject(raw, { warningPolicy: 'reject' })
        : await work.run(validateWorkspaceProjectWork(raw, { warningPolicy: 'reject' }));
      requireContract(!(await member(project.id)), 'Project ID is occupied');
      const scope = { storageGeneration: next.storageGeneration, projectId: project.id,
         incarnation: await deriveWorkspaceIncarnation(next.storageGeneration, next.revision, addProjects.length, work) };
      const records = trusted ? decomposeProject(project, scope) : await work.run(decomposeProjectWork(project, scope));
      const origin: WorkspaceBirthOrigin = { kind: 'workspace-command', identity: { ...batch.identity }, requestDigest,
        workspaceRevision: next.revision, memberOrdinal: addProjects.length, createdAt: now,
        authority: { documentRevision: 0, preferenceRevision: 0, foldStructureGeneration: 0 } };
      records.projectHeaders.values().next().value!.workspaceBirth = origin;
      const birth = { ...origin, digests: trusted ? await createTrustedProjectBirthDigests(records, trusted.hash)
        : await createProjectBirthDigests(records, work) };
      owner.grow((trusted ? runSync(rawValueWeightWork(records)) : await work.run(rawValueWeightWork(records))).bytes);
      (next.members as WorkspaceMember[]).push({ projectId: project.id, incarnation: scope.incarnation, birth, consumedImport });
      addProjects.push(records); next.activeProjectId = project.id;
    };
    const ensureAvailableTarget = async (id: string, replacingId?: string) => {
      requireContract(!(await member(id)), 'Import target is occupied');
      for (const pending of next.pendingImports) {
        if ((await work.run(compareStringsWork(pending.targetProjectId, id))) === 0
          && (replacingId === undefined || (await work.run(compareStringsWork(pending.id, replacingId))) !== 0)) {
          throw new WorkspaceCommandConflict('identity-mismatch');
        }
      }
    };
    const consumedFor = async (id: string) => {
      let result: WorkspaceMember | undefined;
      for (const row of next.members) {
        await work.run(effect(1, () => {}));
        if (row.consumedImport.consumedImportId !== undefined
          && (await work.run(compareStringsWork(row.consumedImport.consumedImportId, id))) === 0) {
          requireContract(!result, 'Ambiguous consumed import'); result = row;
        }
      }
      return result;
    };
    const setPreset = async (row: StoredPreset) => {
      const descriptor = await presetDescriptor(row, work); const values: PresetDescriptor[] = []; let found = false;
      for (const previous of next.presets) {
        const match = (await work.run(compareStringsWork(previous.id, row.id))) === 0;
        await work.run(effect(1, () => { owner.grow(8); values.push(match ? descriptor : previous); })); found ||= match;
      }
      if (!found) values.push(descriptor); next.presets = values; putPresets.push(row);
    };
    const setImport = async (row: StoredPendingImport) => {
      const descriptor = trusted ? await trustedImportDescriptor(row, trusted.hash) : await importDescriptor(row, work); const values: ImportDescriptor[] = []; let found = false;
      for (const previous of next.pendingImports) {
        const match = (await work.run(compareStringsWork(previous.id, row.id))) === 0;
        await work.run(effect(1, () => { owner.grow(8); values.push(match ? descriptor : previous); })); found ||= match;
      }
      if (!found) values.push(descriptor); next.pendingImports = values; putImports.push(row);
    };
    const matchingPending = async (pending: WorkspacePendingImport, attempt?: WorkspaceImportAttemptProvenance, replacingId?: string) => {
      const row = await work.run(findWork(captured.pendingImports, pending.id, value => value.id));
      const descriptor = await work.run(findWork(next.pendingImports, pending.id, value => value.id));
      requireContract(Boolean(row) === Boolean(descriptor), 'Missing pending import capture');
      const consumed = await consumedFor(pending.id); requireContract(!(row && consumed), 'Ambiguous import evidence');
      const digest = await proofDigest(pending);
      const storedAttempt = attempt ? { ...attempt, pendingImportDigest: digest } : undefined;
      if (row) {
        requireContract(await same(work, row.pendingImport, pending)
          && await same(work, row.attemptProvenance ?? null, storedAttempt ?? null), 'Pending import identity mismatch');
        return { outcome: 'already-staged' as const, digest, storedAttempt };
      }
      if (consumed) {
        await requireLiveMember(captured, consumed, work);
        const proof = consumed.consumedImport;
        requireContract((await work.run(compareStringsWork(consumed.projectId, pending.targetProjectId))) === 0
          && proof.consumedImportCreatedAt === pending.createdAt && proof.consumedImportDigest === digest
          && await same(work, proof.consumedImportAttempt ?? null, storedAttempt ?? null), 'Consumed import identity mismatch');
        return { outcome: 'already-consumed' as const, digest, storedAttempt };
      }
      await ensureAvailableTarget(pending.targetProjectId, replacingId);
      return { outcome: undefined, digest, storedAttempt };
    };
    let outcome: WorkspaceCommandResult['outcome'];
    const intent = batch.intent;
    switch (intent.type) {
      case 'recover-legacy-as-copies': {
        requireContract(recoveryEnvironment, 'Recovery preparation environment required');
        recoveryCopies = await prepareWorkspaceRecoveryCopies(captured, intent, requestDigest, now, recoveryEnvironment, work);
        for (const row of recoveryCopies.projects) await addProject(row.project);
        next.activeProjectId = captured.manifest.activeProjectId;
        for (const row of recoveryCopies.presets) await setPreset(row);
        for (const row of recoveryCopies.pendingImports) await setImport(row);
        next.legacyAcceptance = { kind: 'accepted', digest: intent.sourceDigest, backupId: recoveryCopies.backup.id };
        outcome = 'recovered'; break;
      }
      case 'create-and-activate-project': await addProject(intent.project); outcome = 'created'; break;
      case 'activate-project': {
        const found = await member(intent.projectId);
        requireContract(found && (await work.run(compareStringsWork(found.incarnation, batch.targets[0].scope.incarnation))) === 0, 'Workspace member changed');
        next.activeProjectId = intent.projectId; outcome = 'activated'; break;
      }
      case 'close-project': {
        const found = await member(intent.projectId); const target = batch.targets[0];
        requireContract(found && target.type === 'lineage' && (await work.run(compareStringsWork(found.incarnation, target.scope.incarnation))) === 0, 'Workspace member changed');
        const image = await work.run(findWork(captured.projects, intent.projectId, value => value.scope.projectId));
        requireContract(image && await same(work, image.scope, target.scope), 'Missing close target');
        const header = image.projectHeaders.values().next().value!, preferences = image.projectPreferences.values().next().value!;
        requireContract(header && preferences && (await work.run(compareStringsWork(header.incarnation, target.scope.incarnation))) === 0
          && await same(work, authority(header, preferences), target.authority), 'Project authority changed');
        await work.run(reconstructProjectWork(image));
        if (found.birth.kind === 'workspace-command') await verifyProjectBirth(image, found, work);
        const successor = intent.successor === undefined ? undefined : await work.run(validateWorkspaceProjectWork(intent.successor, { warningPolicy: 'reject' }));
        let ordinal = 0; for (const row of next.members) { if ((await work.run(compareStringsWork(row.projectId, intent.projectId))) === 0) break; ordinal++; }
        next.members = await work.run(withoutWork(next.members, intent.projectId, value => value.projectId, owner));
        removeProjects.push({ ...target.scope });
        if (!next.members.length) {
          requireContract(successor && (await work.run(compareStringsWork(successor.id, intent.projectId))) !== 0, 'Last close requires a distinct successor');
          await addProject(successor);
        } else next.activeProjectId = next.members[Math.max(0, ordinal - 1)].projectId;
        outcome = 'closed'; break;
      }
      case 'save-custom-preset': {
        const preset = await work.run(validateCustomPresetWork(intent.preset, { warningPolicy: 'reject', existingIds: new Set() }));
        const existing = await work.run(findWork(next.presets, preset.id, value => value.id));
        if (existing) requireContract(await work.run(findWork(captured.presets, preset.id, value => value.id)), 'Missing preset capture');
        const position = existing?.position ?? ((next.presets.at(-1)?.position ?? -1) + 1); safeCounter(position);
        await setPreset({ id: preset.id, preset, position }); outcome = 'preset-saved'; break;
      }
      case 'delete-custom-preset': {
        const existing = await work.run(findWork(next.presets, intent.presetId, value => value.id)); requireContract(existing, 'Unknown preset');
        requireContract(await work.run(findWork(captured.presets, intent.presetId, value => value.id)), 'Missing preset capture');
        next.presets = await work.run(withoutWork(next.presets, intent.presetId, value => value.id, owner)); deletePresetIds.push(intent.presetId);
        for (const descriptor of next.presets) {
          await work.run(effect(1, () => {})); if (descriptor.position <= existing.position) continue;
          const row = await work.run(findWork(captured.presets, descriptor.id, value => value.id)); requireContract(row, 'Missing preset compaction row');
          await setPreset({ ...row, position: row.position - 1 });
        }
        outcome = 'preset-deleted'; break;
      }
      case 'stage-import': {
        const pending = trusted ? preparePendingImport(intent.pendingImport, { warningPolicy: 'retain' })
          : await work.run(preparePendingImportWork(intent.pendingImport, { warningPolicy: 'retain' }));
        const match = await matchingPending(pending, intent.attemptProvenance);
        if (match.outcome) outcome = match.outcome;
        else {
          const position = (next.pendingImports.at(-1)?.position ?? -1) + 1; safeCounter(position);
          await setImport({ id: pending.id, pendingImport: pending, position, ...(match.storedAttempt ? { attemptProvenance: match.storedAttempt } : {}) });
          outcome = 'staged';
        }
        break;
      }
      case 'replace-staged-import': {
        const expected = intent.expected, replacement = intent.replacement;
        const pending = trusted ? preparePendingImport(replacement.pendingImport, { warningPolicy: 'retain' })
          : await work.run(preparePendingImportWork(replacement.pendingImport, { warningPolicy: 'retain' }));
        requireContract(expected.sourceKeyDigest === replacement.attemptProvenance.sourceKeyDigest
          && expected.payloadDigest !== replacement.attemptProvenance.payloadDigest
          && (await work.run(compareStringsWork(expected.importId, pending.id))) !== 0
          && (await work.run(compareStringsWork(expected.targetProjectId, pending.targetProjectId))) !== 0, 'Invalid import replacement');
        const old = await work.run(findWork(captured.pendingImports, expected.importId, value => value.id));
        const oldDescriptor = await work.run(findWork(next.pendingImports, expected.importId, value => value.id));
        requireContract(Boolean(old) === Boolean(oldDescriptor), 'Missing old import capture');
        const oldConsumed = await consumedFor(expected.importId); requireContract(!oldConsumed, 'Old import already consumed');
        const match = await matchingPending(pending, replacement.attemptProvenance, old?.id);
        if (match.outcome) { requireContract(!old, 'Old import still present'); outcome = match.outcome; break; }
        let position: number;
        if (old) {
          requireContract((await work.run(compareStringsWork(old.pendingImport.targetProjectId, expected.targetProjectId))) === 0
            && old.pendingImport.createdAt === expected.createdAt && old.attemptProvenance
            && old.attemptProvenance.sourceKeyDigest === expected.sourceKeyDigest && old.attemptProvenance.payloadDigest === expected.payloadDigest
            && old.attemptProvenance.pendingImportDigest === await proofDigest(old.pendingImport), 'Staged import changed');
          position = old.position; next.pendingImports = await work.run(withoutWork(next.pendingImports, old.id, value => value.id, owner)); deleteImportIds.push(old.id);
        } else { await ensureAvailableTarget(expected.targetProjectId); position = (next.pendingImports.at(-1)?.position ?? -1) + 1; }
        safeCounter(position);
        await setImport({ id: pending.id, pendingImport: pending, position, attemptProvenance: match.storedAttempt! });
        outcome = 'replaced'; break;
      }
      case 'consume-import': {
        const row = await work.run(findWork(captured.pendingImports, intent.importId, value => value.id)); const consumed = await consumedFor(intent.importId);
        const descriptor = await work.run(findWork(next.pendingImports, intent.importId, value => value.id));
        requireContract(Boolean(row) === Boolean(descriptor), 'Missing consumed import capture');
        requireContract(!(row && consumed), 'Ambiguous import evidence');
        if (!row) { requireContract(consumed, 'Unknown pending import'); await requireLiveMember(captured, consumed, work); outcome = 'already-consumed'; break; }
        // Historical admission permits two pending imports to name one unused target.
        // Consumption claims the project ID; it must not erase or reject the other pending record.
        const pending = row.pendingImport; requireContract(!(await member(pending.targetProjectId)), 'Import target is occupied');
        const digest = await proofDigest(pending);
        await addProject({ id: pending.targetProjectId, name: pending.name, initialState: pending.state,
          ...(pending.cloud === undefined ? {} : { cloud: pending.cloud }) }, { consumedImportId: pending.id,
          consumedImportCreatedAt: pending.createdAt, consumedImportDigest: digest,
          ...(row.attemptProvenance ? { consumedImportAttempt: { ...row.attemptProvenance } } : {}) });
        next.pendingImports = await work.run(withoutWork(next.pendingImports, row.id, value => value.id, owner)); deleteImportIds.push(row.id);
        for (const descriptor of next.pendingImports) {
          await work.run(effect(1, () => {})); if (descriptor.position <= row.position) continue;
          const later = await work.run(findWork(captured.pendingImports, descriptor.id, value => value.id)); requireContract(later, 'Missing import compaction row');
          await setImport({ ...later, position: later.position - 1 });
        }
        outcome = 'consumed'; break;
      }
    }
    // Replacements retain their old position; rebuild descriptor ordering cooperatively.
    await work.run(effect(1, () => owner.grow((next.presets.length + next.pendingImports.length) * 16)));
    next.presets = await work.run(stableSortWork(next.presets, (a, b) => effect(1, () => a.position - b.position)));
    next.pendingImports = await work.run(stableSortWork(next.pendingImports, (a, b) => effect(1, () => a.position - b.position)));
    next.coreDigest = await hashFrame(work, 'proof', workspaceManifestCoreFrame(next));
    const proof = { identity: { ...batch.identity }, requestDigest, before: { ...batch.expected },
      after: { revision: next.revision, coreDigest: next.coreDigest }, postconditionDigest: await postconditionDigest(batch, next, outcome, work) };
    next.lastCommit = { ...proof, proofDigest: await hashFrame(work, 'proof', workspaceReceiptFrame(proof)) };
    next.commitWindow = await appendWorkspaceReceipt(captured.manifest.commitWindow, next.lastCommit, work);
    await work.run(validateWorkspaceManifestWork(next));
    const delta = await work.run(diffWorkspaceCatalogWork(await work.run(projectWorkspaceCatalogWork(captured.manifest)), await work.run(projectWorkspaceCatalogWork(next))));
    owner.grow((trusted ? runSync(rawValueWeightWork({ manifest: next, putPresets, putImports, delta }))
      : await work.run(rawValueWeightWork({ manifest: next, putPresets, putImports, delta }))).bytes);
    return { batch, requestDigest, manifest: next, outcome, addProjects, removeProjects, putPresets, deletePresetIds, putImports, deleteImportIds, delta,
      ...(recoveryCopies ? { addBackup: recoveryCopies.backup } : {}), release() { recoveryCopies?.release(); owner.release(); } };
  } catch (error) { recoveryCopies?.release(); owner.release(); throw error; }
}

const outcomeTags: Record<WorkspaceBatch['intent']['type'], readonly WorkspaceCommandResult['outcome'][]> = {
  'create-and-activate-project': ['created'], 'activate-project': ['activated'], 'close-project': ['closed'],
  'save-custom-preset': ['preset-saved'], 'delete-custom-preset': ['preset-deleted'],
  'stage-import': ['staged', 'already-staged', 'already-consumed'],
  'replace-staged-import': ['replaced', 'already-staged', 'already-consumed'],
  'consume-import': ['consumed', 'already-consumed'],
  'recover-legacy-as-copies': ['recovered'],
};

/** Checks fresh after-state; never reconstructs an old workspace or treats receipt presence as sufficient. */
export async function verifyWorkspacePostconditions(batch: WorkspaceBatch, current: CapturedWorkspaceCommand,
  receipt: WorkspaceReceipt, work: WorkRuntime, trusted?: { requestDigest: string; written: readonly NormalizedProject[];
    writtenImports?: readonly StoredPendingImport[]; hash?(text: string): Promise<string> }): Promise<WorkspaceInspectedResult> {
  assertWorkRuntime(work); const owner = work.own(0);
  try {
    const importCheck = trusted?.hash ? { hash: trusted.hash, writtenImports: trusted.writtenImports ?? [] } : undefined;
    await validateCapture(current, batch, work, false, importCheck);
    const manifest = current.manifest;
    requireContract(await same(work, receipt.identity, batch.identity) && await same(work, receipt.before, batch.expected)
      && await same(work, receipt.after, { revision: manifest.revision, coreDigest: manifest.coreDigest })
      && await same(work, receipt, manifest.lastCommit), 'Workspace receipt is not current');
    requireContract(receipt.requestDigest === (trusted?.requestDigest ?? await hashWorkspaceRequest(batch, work)), 'Workspace request identity mismatch');
    let outcome: WorkspaceCommandResult['outcome'] | undefined;
    for (const tag of outcomeTags[batch.intent.type]) {
      if (await postconditionDigest(batch, manifest, tag, work) === receipt.postconditionDigest) {
        requireContract(outcome === undefined, 'Ambiguous workspace postconditions'); outcome = tag;
      }
    }
    requireContract(outcome, 'Workspace postcondition digest mismatch');
    const projects: WorkspaceProjectMaterialization[] = [], presets: WorkspaceCustomPreset[] = [], pendingImports: WorkspacePendingImport[] = [];
    const findMember = (id: string) => work.run(findWork(manifest.members, id, member => member.projectId));
    const created = async (id: string, expected?: WorkspaceProject) => {
      const member = await findMember(id);
      requireContract(member?.birth.kind === 'workspace-command' && member.birth.workspaceRevision === manifest.revision
        && member.birth.requestDigest === receipt.requestDigest && await same(work, member.birth.identity, batch.identity), 'Created member changed');
      const records = await work.run(findWork(current.projects, id, project => project.scope.projectId));
      requireContract(records && records.scope.storageGeneration === manifest.storageGeneration
        && (await work.run(compareStringsWork(records.scope.incarnation, member.incarnation))) === 0, 'Missing created project');
      const header = records.projectHeaders.values().next().value!, preferences = records.projectPreferences.values().next().value!;
      requireContract(header && preferences, 'Missing created project pair');
      if (header.storageRevision !== 0 || preferences.revision !== 0 || header.foldStructureGeneration !== 0) {
        throw new WorkspaceCommandConflict('authority-changed');
      }
      const written = trusted?.written.find(project => project.scope.projectId === id && project.scope.incarnation === member.incarnation);
      if (written) {
        // This commit wrote these records and digested them for the birth; the atomic readback must equal them exactly.
        for (const store of projectStores) {
          requireContract(records[store].size === written[store].size, 'Created project readback mismatch');
          for (const [key, record] of written[store]) {
            const stored = records[store].get(key);
            requireContract(stored !== undefined && frameRecord(store, stored) === frameRecord(store, record), 'Created project readback mismatch');
          }
        }
        await work.run(effect(1, () => { owner.grow(80); projects.push({ scope: { ...records.scope }, authority: authority(header, preferences), records }); }));
        return;
      }
      await verifyProjectBirth(records, member, work);
      const external = await work.run(reconstructProjectWork(records));
      if (expected) {
        const wanted = await work.run(validateWorkspaceProjectWork(expected, { warningPolicy: 'reject' }));
        requireContract(await work.run(equalFrameWork(orderedFrame(external), orderedFrame(wanted))), 'Created project payload mismatch');
      }
      await work.run(effect(1, () => { owner.grow(80); projects.push({ scope: { ...records.scope }, authority: authority(header, preferences), records }); }));
    };
    const requireAllAncillary = async (kind: 'preset' | 'import') => {
      const descriptors = kind === 'preset' ? manifest.presets : manifest.pendingImports;
      const rows = kind === 'preset' ? current.presets : current.pendingImports;
      requireContract(rows.length === descriptors.length, 'Incomplete ancillary postconditions');
      for (const descriptor of descriptors) requireContract(await work.run(findWork<{ id: string }>(rows, descriptor.id, value => value.id)), 'Missing ancillary postcondition');
    };
    const intent = batch.intent;
    switch (intent.type) {
      case 'recover-legacy-as-copies': {
        await validateRecoverySource(intent, work);
        requireContract(current.recovery && manifest.legacyAcceptance.kind === 'accepted'
          && manifest.legacyAcceptance.digest === intent.sourceDigest
          && manifest.legacyAcceptance.backupId === recoveryBackupId(intent), 'Recovery acceptance mismatch');
        const backup = current.recovery.backups.find(row => row.id === recoveryBackupId(intent));
        requireContract(backup && backup.kind === 'conflict' && backup.digest === intent.sourceDigest
          && await same(work, backup.snapshot, intent.source), 'Recovery backup mismatch');
        for (const member of manifest.members) {
          await work.run(effect(1, () => {}));
          if (member.birth.kind === 'workspace-command' && member.birth.workspaceRevision === manifest.revision
            && await same(work, member.birth.identity, batch.identity)) await created(member.projectId);
        }
        await requireAllAncillary('preset'); await requireAllAncillary('import');
        // The full recovery capture independently validates retained and newly accepted backups.
        for (const row of current.presets) await work.run(effect(1, () => { presets.push(row.preset); }));
        for (const row of current.pendingImports) await work.run(effect(1, () => { pendingImports.push(row.pendingImport); }));
        break;
      }
      case 'create-and-activate-project':
        await created(intent.project.id, intent.project);
        requireContract((await work.run(compareStringsWork(manifest.activeProjectId, intent.project.id))) === 0, 'Created project is not active');
        break;
      case 'activate-project': {
        const member = await findMember(intent.projectId), target = batch.targets[0].scope;
        const header = await work.run(findWork(current.memberHeaders, intent.projectId, value => value.key[1]));
        requireContract(member && header && (await work.run(compareStringsWork(member.incarnation, target.incarnation))) === 0
          && (await work.run(compareStringsWork(header.incarnation, target.incarnation))) === 0
          && (await work.run(compareStringsWork(header.value.id, intent.projectId))) === 0
          && header.key[0] === batch.storageGeneration && header.formatVersion === 3, 'Activated member changed');
        safeCounter(header.storageRevision); safeCounter(header.foldStructureGeneration);
        requireContract((await work.run(compareStringsWork(manifest.activeProjectId, intent.projectId))) === 0, 'Activation postcondition failed');
        break;
      }
      case 'close-project': {
        const scope = batch.targets[0].scope;
        requireContract(!(await findMember(intent.projectId)), 'Closed member still present');
        const removed = await work.run(findWork(current.projects, scope.projectId, value => value.scope.projectId));
        requireContract(removed && await same(work, removed.scope, scope), 'Missing close absence capture');
        for (const store of NORMALIZED_STORE_NAMES) if (store !== 'normalizationLedger') await work.run(effect(1, () =>
          requireContract(removed[store as ProjectStoreName].size === 0, 'Closed project records remain')));
        if (intent.successor !== undefined) {
          const successor = await findMember(intent.successor.id);
          if (successor?.birth.kind === 'workspace-command' && successor.birth.workspaceRevision === manifest.revision
            && await same(work, successor.birth.identity, batch.identity)) await created(intent.successor.id, intent.successor);
        }
        break;
      }
      case 'save-custom-preset': {
        const row = await work.run(findWork(current.presets, intent.preset.id, value => value.id)); requireContract(row, 'Saved preset missing');
        const expected = await work.run(validateCustomPresetWork(intent.preset, { warningPolicy: 'reject', existingIds: new Set() }));
        requireContract(await work.run(equalFrameWork(orderedFrame(row.preset), orderedFrame(expected))), 'Saved preset mismatch');
        presets.push(row.preset); break;
      }
      case 'delete-custom-preset':
        requireContract(!(await work.run(findWork(manifest.presets, intent.presetId, value => value.id))), 'Deleted preset remains');
        await requireAllAncillary('preset'); break;
      case 'stage-import':
      case 'replace-staged-import': {
        const input = intent.type === 'stage-import' ? intent.pendingImport : intent.replacement.pendingImport;
        const row = await work.run(findWork(current.pendingImports, input.id, value => value.id));
        let consumed: WorkspaceMember | undefined;
        for (const member of manifest.members) {
          await work.run(effect(1, () => {}));
          if (member.consumedImport.consumedImportId !== undefined
            && (await work.run(compareStringsWork(member.consumedImport.consumedImportId, input.id))) === 0) {
            requireContract(!consumed, 'Ambiguous consumed result'); consumed = member;
          }
        }
        const written = importCheck?.writtenImports.find(value => value.id === input.id);
        if (written && (outcome === 'staged' || outcome === 'replaced')) {
          // Trusted Import: validateCapture proved this row equals the row this commit prepared once and wrote.
          requireContract(row && !consumed, 'Staged import result mismatch');
          pendingImports.push(row.pendingImport);
        } else {
          const provenanceInput = intent.type === 'stage-import' ? intent.attemptProvenance : intent.replacement.attemptProvenance;
          const expected = await work.run(preparePendingImportWork(input, { warningPolicy: 'retain' }));
          const digest = await hashFrame(work, 'proof', canonicalFrame(expected));
          const expectedAttempt = provenanceInput ? { ...provenanceInput, pendingImportDigest: digest } : undefined;
          if (outcome === 'already-consumed') {
            requireContract(!row && consumed && (await work.run(compareStringsWork(consumed.projectId, expected.targetProjectId))) === 0
              && consumed.consumedImport.consumedImportCreatedAt === expected.createdAt && consumed.consumedImport.consumedImportDigest === digest
              && await same(work, consumed.consumedImport.consumedImportAttempt ?? null, expectedAttempt ?? null), 'Consumed import result mismatch');
            await requireLiveMember(current, consumed, work);
          } else {
            requireContract(row && !consumed && await same(work, row.pendingImport, expected)
              && await same(work, row.attemptProvenance ?? null, expectedAttempt ?? null), 'Staged import result mismatch');
            pendingImports.push(row.pendingImport);
          }
        }
        if (intent.type === 'replace-staged-import') requireContract(!(await work.run(findWork(manifest.pendingImports, intent.expected.importId, value => value.id))), 'Replaced import remains');
        break;
      }
      case 'consume-import': {
        requireContract(!(await work.run(findWork(manifest.pendingImports, intent.importId, value => value.id))), 'Consumed pending import remains');
        let member: WorkspaceMember | undefined;
        for (const candidate of manifest.members) {
          await work.run(effect(1, () => {}));
          if (candidate.consumedImport.consumedImportId !== undefined
            && (await work.run(compareStringsWork(candidate.consumedImport.consumedImportId, intent.importId))) === 0) {
            requireContract(!member, 'Ambiguous consumed member'); member = candidate;
          }
        }
        requireContract(member, 'Consumed project missing');
        await requireLiveMember(current, member, work);
        if (outcome === 'consumed') {
          await created(member.projectId);
          requireContract((await work.run(compareStringsWork(manifest.activeProjectId, member.projectId))) === 0, 'Consumed project is not active');
          await requireAllAncillary('import');
        }
        break;
      }
    }
    return { type: 'workspace-inspected-current', receipt, outcome, catalog: await work.run(projectWorkspaceCatalogWork(manifest)),
      projects, presets, pendingImports };
  } finally { owner.release(); }
}
