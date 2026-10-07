import type { AuthorityStamp, CommitAttempt, CommitIdentity, CommitInspection, DocumentBatch, DocumentSaveAck,
  NormalizedProject, PreferenceBatch, PreferenceSaveAck, ProjectScope, BulkDocumentBatch, BulkDocumentAck, BulkCommitInspection, DocumentCommitReceipt } from './normalized/schema';
import type { WorkspaceProject } from './contracts';
import type { WorkspaceAdmission, WorkspaceBatch, WorkspaceCatalog, WorkspaceCommandResult,
  WorkspaceInspection, WorkspaceLifecycleIntent } from './normalized/workspaceCommands';
import type { WorkspaceCommandIdentity, WorkspaceStamp } from './normalized/workspaceManifest';
import type { WorkspaceRecoveryPreparation } from './normalized/workspaceRecovery';
import { LEGACY_DOCUMENT_KEYS } from './legacyTypes';
import { describeStartupRequest, isStartupType, validateStartupReply, type StartupContext,
  type WorkspaceStartupRequest, type WorkspaceStartupResponse } from './workspaceStartupProtocol';

export interface WorkspaceRecoveryAttempt {
  readonly storageGeneration: string; readonly identity: WorkspaceCommandIdentity; readonly expected: WorkspaceStamp;
  readonly recoveryId: string; readonly sourceDigest: string;
}

export type WorkspaceLifecycleWorkerRequest =
  | { readonly type: 'workspace-bootstrap'; readonly storageGeneration: string }
  | { readonly type: 'workspace-resume-aborted'; readonly storageGeneration: string; readonly admissionId: number }
  | { readonly type: 'workspace-command'; readonly admissionId: number; readonly batch: WorkspaceBatch }
  | { readonly type: 'workspace-recovery-prepare'; readonly admissionId: number; readonly batch: WorkspaceBatch }
  | { readonly type: 'workspace-recovery-commit'; readonly admissionId: number; readonly preparationId: number; readonly attempt: WorkspaceRecoveryAttempt }
  | { readonly type: 'workspace-recovery-discard'; readonly admissionId: number; readonly preparationId: number; readonly storageGeneration: string }
  | { readonly type: 'workspace-fence'; readonly storageGeneration: string; readonly admissionId: number }
  | { readonly type: 'inspect-workspace-command'; readonly admissionId: number; readonly batch: WorkspaceBatch };
export type WorkspaceLifecycleWorkerResponse =
  | { readonly type: 'workspace-bootstrapped'; readonly admissionId: number; readonly catalog: WorkspaceCatalog;
      readonly projectAuthorities: WorkspaceAdmission['projectAuthorities'] }
  | { readonly type: 'workspace-resumed'; readonly admissionId: number; readonly catalog: WorkspaceCatalog;
      readonly projectAuthorities: WorkspaceAdmission['projectAuthorities'] }
  | { readonly type: 'workspace-command-result'; readonly admissionId: number; readonly result: WorkspaceCommandResult }
  | { readonly type: 'workspace-recovery-prepared'; readonly admissionId: number; readonly preparationId: number;
      readonly recoveryId: string; readonly sourceDigest: string; readonly counts: WorkspaceRecoveryPreparation['counts'] }
  | { readonly type: 'workspace-recovery-discarded'; readonly admissionId: number; readonly preparationId: number; readonly storageGeneration: string }
  | { readonly type: 'workspace-fenced'; readonly storageGeneration: string; readonly admissionId: number }
  | { readonly type: 'workspace-inspection'; readonly identity: WorkspaceCommandIdentity; readonly result: WorkspaceInspection };
export type WorkspaceLifecycleWorkerContext =
  | { readonly requestType: 'workspace-bootstrap'; readonly storageGeneration: string }
  | { readonly requestType: 'workspace-fence' | 'workspace-recovery-discard' | 'workspace-resume-aborted'; readonly storageGeneration: string; readonly admissionId: number }
  | { readonly requestType: 'workspace-command' | 'inspect-workspace-command' | 'workspace-recovery-prepare' | 'workspace-recovery-commit'; readonly storageGeneration: string;
      readonly admissionId: number; readonly identity: WorkspaceCommandIdentity; readonly expected: WorkspaceStamp };

export type WorkspaceWorkerRequest =
  | WorkspaceLifecycleWorkerRequest
  | WorkspaceStartupRequest
  | { type: 'bootstrap'; project: NormalizedProject }
  | { type: 'open-project'; workspaceAdmissionId: number; scope: ProjectScope }
  | { type: 'project-cut-authority'; admissionId: number; scope: ProjectScope }
  | { type: 'document-readmission-authority'; admissionId: number; receipt: DocumentCommitReceipt }
  | { type: 'replace-document'; admissionId: number; batch: BulkDocumentBatch }
  | { type: 'inspect-replacement'; batch: BulkDocumentBatch }
  | { type: 'document-batch'; admissionId: number; batch: DocumentBatch }
  | { type: 'preferences'; admissionId: number; batch: PreferenceBatch }
  | { type: 'structural-command'; admissionId: number; command: { type: 'occurrence-edit';
      batch: DocumentBatch & { structural: NonNullable<DocumentBatch['structural']> } } }
  | { type: 'inspect-commit'; attempt: CommitAttempt }
  | { type: 'recovery-export'; scope: ProjectScope };

export const repositoryFailureCodes = ['ingress-required', 'incarnation-changed', 'authority-changed', 'identity-mismatch',
  'proof-unavailable', 'verification-failed', 'cache-gap', 'stale-fold-generation', 'preference-contention',
  'quota-exceeded', 'clone-failed', 'storage-unavailable', 'repository-failure'] as const;
export type RepositoryFailureCode = typeof repositoryFailureCodes[number];
export type WorkspaceWorkerFailure = { type: 'failed'; code: RepositoryFailureCode | 'invalid-request' | 'stale-admission';
  outcome: 'not-started' | 'unknown'; admission: 'invalidated' | 'none' };
export type WorkspaceWorkerResponse =
  | WorkspaceLifecycleWorkerResponse
  | WorkspaceStartupResponse
  | { type: 'project-opened'; scope: ProjectScope; admissionId: number; authority: AuthorityStamp; project: WorkspaceProject }
  | { type: 'bootstrapped'; scope: ProjectScope; admissionId: number; authority: AuthorityStamp }
  | { type: 'project-cut-authority-result'; scope: ProjectScope; admissionId: number; authority: AuthorityStamp }
  | { type: 'document-readmission-authority-result'; scope: ProjectScope; admissionId: number; identity: CommitIdentity; authority: AuthorityStamp }
  | { type: 'replacement-result'; ack: BulkDocumentAck }
  | { type: 'replacement-inspection'; result: BulkCommitInspection }
  | { type: 'document-result'; ack: DocumentSaveAck }
  | { type: 'preferences-result'; ack: PreferenceSaveAck }
  | { type: 'structural-result'; ack: DocumentSaveAck }
  | { type: 'commit-inspection'; result: CommitInspection }
  | { type: 'recovery-exported'; source: 'normalized-project'; scope: ProjectScope; authority: AuthorityStamp; project: WorkspaceProject }
  | WorkspaceWorkerFailure;
export type WorkspaceWorkerContext =
  | WorkspaceLifecycleWorkerContext
  | StartupContext
  | { requestType: 'open-project'; scope: ProjectScope; workspaceAdmissionId: number }
  | { requestType: 'bootstrap' | 'recovery-export'; scope: ProjectScope }
  | { requestType: 'project-cut-authority'; scope: ProjectScope; admissionId: number }
  | { requestType: 'document-batch' | 'preferences' | 'structural-command' | 'replace-document' | 'document-readmission-authority'; scope: ProjectScope; admissionId: number; identity: CommitIdentity }
  | { requestType: 'inspect-commit' | 'inspect-replacement'; scope: ProjectScope; identity: CommitIdentity };
export interface WorkspaceWorkerRequestEnvelope { protocolVersion: 1; workerEpoch: number; requestId: number; request: WorkspaceWorkerRequest }
export interface WorkspaceWorkerResponseEnvelope { protocolVersion: 1; workerEpoch: number; requestId: number;
  context: WorkspaceWorkerContext; response: WorkspaceWorkerResponse }

export function requireFrame(condition: unknown): asserts condition {
  if (!condition) throw new Error('Invalid workspace worker frame');
}
export function counter(value: unknown, positive = false): asserts value is number {
  requireFrame(Number.isSafeInteger(value) && (value as number) >= (positive ? 1 : 0));
}
function container(value: unknown): asserts value is Record<string, unknown> {
  requireFrame(value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype);
}
/** Only called on bounded framing objects. Never on arrays, patches, or payloads. */
export function frameFields(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  container(value);
  const keys = Reflect.ownKeys(value);
  requireFrame(required.every(key => Object.hasOwn(value, key)));
  for (const key of keys) {
    requireFrame(typeof key === 'string' && (required.includes(key) || optional.includes(key)));
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    requireFrame(descriptor.enumerable && Object.hasOwn(descriptor, 'value'));
  }
  return value;
}
function ownValue(value: unknown, key: string): unknown {
  container(value); const descriptor = Object.getOwnPropertyDescriptor(value, key);
  requireFrame(descriptor?.enumerable && Object.hasOwn(descriptor, 'value')); return descriptor.value;
}
function text(value: unknown, privateIdentity = false): asserts value is string {
  requireFrame(typeof value === 'string' && value.length > 0);
  if (privateIdentity) requireFrame(new TextEncoder().encode(value).length <= 256);
}
function scopeFrame(value: unknown): ProjectScope {
  const scope = frameFields(value, ['storageGeneration', 'projectId', 'incarnation']);
  text(scope.storageGeneration); text(scope.projectId); text(scope.incarnation);
  return { storageGeneration: scope.storageGeneration, projectId: scope.projectId, incarnation: scope.incarnation };
}
export function sameScope(a: ProjectScope, b: ProjectScope): boolean {
  return a.storageGeneration === b.storageGeneration && a.projectId === b.projectId && a.incarnation === b.incarnation;
}
function identityFrame(value: unknown): CommitIdentity {
  const i = frameFields(value, ['clientId', 'commitGeneration', 'commitId', 'editorGeneration', 'lane']);
  text(i.clientId, true); text(i.commitId, true); counter(i.commitGeneration); counter(i.editorGeneration);
  requireFrame(i.lane === 'document' || i.lane === 'preferences');
  return { clientId: i.clientId, commitGeneration: i.commitGeneration, commitId: i.commitId, editorGeneration: i.editorGeneration, lane: i.lane };
}
export interface ExpectedWorkerResponse { context: WorkspaceWorkerContext; lower?: number; foldGeneration?: number;
  workspaceIntent?: WorkspaceBatch['intent']['type']; replacementBefore?: AuthorityStamp;
  recovery?: { recoveryId?: string; sourceDigest?: string; preparationId?: number } }

function digestFrame(value: unknown): asserts value is string {
  requireFrame(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value));
}
function workspaceStampFrame(value: unknown): WorkspaceStamp {
  const s = frameFields(value, ['revision', 'coreDigest']); counter(s.revision); digestFrame(s.coreDigest);
  return { revision: s.revision, coreDigest: s.coreDigest };
}
function workspaceIdentityFrame(value: unknown): WorkspaceCommandIdentity {
  const i = frameFields(value, ['clientId', 'commandSequence', 'commandId']);
  text(i.clientId, true); text(i.commandId, true); counter(i.commandSequence);
  return { clientId: i.clientId, commandSequence: i.commandSequence, commandId: i.commandId };
}
function sameWorkspaceIdentity(a: WorkspaceCommandIdentity, b: WorkspaceCommandIdentity): boolean {
  return a.clientId === b.clientId && a.commandId === b.commandId && a.commandSequence === b.commandSequence;
}
function sameWorkspaceStamp(a: WorkspaceStamp, b: WorkspaceStamp): boolean {
  return a.revision === b.revision && a.coreDigest === b.coreDigest;
}
function importProvenanceFrame(value: unknown): void {
  const p = frameFields(value, ['sourceKeyDigest', 'payloadDigest']); digestFrame(p.sourceKeyDigest); digestFrame(p.payloadDigest);
}
const workspaceIntentFields = {
  'create-and-activate-project': [['type', 'project'], []], 'activate-project': [['type', 'projectId'], []],
  'close-project': [['type', 'projectId'], ['successor']], 'save-custom-preset': [['type', 'preset'], []],
  'delete-custom-preset': [['type', 'presetId'], []], 'stage-import': [['type', 'pendingImport'], ['attemptProvenance']],
  'replace-staged-import': [['type', 'expected', 'replacement'], []], 'consume-import': [['type', 'importId'], []],
  'recover-legacy-as-copies': [['type', 'recoveryId', 'source', 'sourceDigest'], []],
} as const;
/** Transport framing only. Repository independently validates detached payloads using Work. */
function workspaceBatchFrame(value: unknown) {
  const b = frameFields(value, ['storageGeneration', 'identity', 'expected', 'targets', 'intent']); text(b.storageGeneration, true);
  const identity = workspaceIdentityFrame(b.identity), expected = workspaceStampFrame(b.expected);
  requireFrame(expected.revision < Number.MAX_SAFE_INTEGER);
  const kind = ownValue(b.intent, 'type'); requireFrame(typeof kind === 'string' && Object.hasOwn(workspaceIntentFields, kind));
  const workspaceIntent = kind as WorkspaceBatch['intent']['type'];
  const [required, optional] = workspaceIntentFields[workspaceIntent]; const intent = frameFields(b.intent, required, optional);
  const count = kind === 'activate-project' || kind === 'close-project' ? 1 : 0;
  requireFrame(Array.isArray(b.targets) && Object.getPrototypeOf(b.targets) === Array.prototype && b.targets.length === count
    && Reflect.ownKeys(b.targets).length === count + 1);
  if (count) {
    const descriptor = Object.getOwnPropertyDescriptor(b.targets, '0'); requireFrame(descriptor?.enumerable && Object.hasOwn(descriptor, 'value'));
    const t = frameFields(descriptor.value, kind === 'close-project' ? ['type', 'scope', 'authority'] : ['type', 'scope']);
    requireFrame(t.type === (kind === 'close-project' ? 'lineage' : 'member'));
    const scope = scopeFrame(t.scope); text(intent.projectId);
    requireFrame(scope.storageGeneration === b.storageGeneration && scope.projectId === intent.projectId);
    if (kind === 'close-project') authorityFrame(t.authority);
  }
  if (kind === 'delete-custom-preset') text(intent.presetId);
  if (kind === 'consume-import') text(intent.importId);
  if (kind === 'recover-legacy-as-copies') {
    text(intent.recoveryId, true); digestFrame(intent.sourceDigest);
    const source = frameFields(intent.source, LEGACY_DOCUMENT_KEYS);
    for (const key of LEGACY_DOCUMENT_KEYS) {
      const entry = frameFields(source[key], ['present', 'raw']);
      requireFrame(typeof entry.present === 'boolean' && (entry.present ? typeof entry.raw === 'string' : entry.raw === null));
    }
  }
  if (kind === 'stage-import' && intent.attemptProvenance !== undefined) importProvenanceFrame(intent.attemptProvenance);
  if (kind === 'replace-staged-import') {
    const previous = frameFields(intent.expected, ['importId', 'targetProjectId', 'createdAt', 'sourceKeyDigest', 'payloadDigest']);
    text(previous.importId); text(previous.targetProjectId); text(previous.createdAt);
    requireFrame((previous.createdAt.length === 24 || previous.createdAt.length === 27) && Number.isFinite(Date.parse(previous.createdAt))
      && new Date(previous.createdAt).toISOString() === previous.createdAt);
    digestFrame(previous.sourceKeyDigest); digestFrame(previous.payloadDigest);
    const replacement = frameFields(intent.replacement, ['pendingImport', 'attemptProvenance']); importProvenanceFrame(replacement.attemptProvenance);
  }
  return { storageGeneration: b.storageGeneration, identity, expected, workspaceIntent };
}
function metadataFrame(value: unknown) {
  const metadata = frameFields(value, ['kind'], ['name', 'cloud']);
  requireFrame(metadata.kind === 'linked-root' || metadata.kind === 'patch');
  if (metadata.kind === 'linked-root') frameFields(value, ['kind', 'name']);
  else requireFrame(Object.hasOwn(metadata, 'name') || Object.hasOwn(metadata, 'cloud'));
  if (Object.hasOwn(metadata, 'name')) requireFrame(typeof metadata.name === 'string');
  if (Object.hasOwn(metadata, 'cloud')) {
    const cloud = frameFields(metadata.cloud, ['type'], ['value']);
    requireFrame(cloud.type === 'set' || cloud.type === 'remove');
    frameFields(cloud, cloud.type === 'set' ? ['type', 'value'] : ['type']);
    // Cloud contents are validated in the worker, not walked during dispatch.
    if (cloud.type === 'set') requireFrame(cloud.value !== null && typeof cloud.value === 'object' && !Array.isArray(cloud.value));
  }
}
function batchFrame(value: unknown, lane: CommitIdentity['lane']) {
  const batch = frameFields(value, ['scope', 'clientId', 'commitGeneration', 'commitId', 'editorGeneration',
    ...(lane === 'document' ? ['expectedRevision', 'changes'] : ['observedPreferenceRevision', 'patch'])], lane === 'document' ? ['structural', 'metadata'] : ['folds']);
  const scope = scopeFrame(batch.scope);
  const identity = identityFrame({ clientId: batch.clientId, commitId: batch.commitId,
    commitGeneration: batch.commitGeneration, editorGeneration: batch.editorGeneration, lane });
  const lower = lane === 'document' ? batch.expectedRevision : batch.observedPreferenceRevision; counter(lower);
  // Any successful next revision must be representable. No wrapping arithmetic.
  requireFrame(lower < Number.MAX_SAFE_INTEGER);
  if (lane === 'document') requireFrame(Array.isArray(batch.changes));
  else container(batch.patch);
  if (Object.hasOwn(batch, 'metadata')) metadataFrame(batch.metadata);
  let foldGeneration: number | undefined;
  const key = lane === 'document' ? 'structural' : 'folds';
  if (Object.hasOwn(batch, key)) {
    const structural = frameFields(batch[key], ['expectedFoldStructureGeneration', lane === 'document' ? 'mappings' : 'updates']);
    counter(structural.expectedFoldStructureGeneration); foldGeneration = structural.expectedFoldStructureGeneration;
    requireFrame(Array.isArray(structural[lane === 'document' ? 'mappings' : 'updates']));
  }
  return { scope, identity, lower, foldGeneration };
}

/** Payload containers remain opaque, including changed-record/mapping/update arrays. */
export function describeRequest(value: unknown): ExpectedWorkerResponse {
  const type = ownValue(value, 'type');
  if (isStartupType(type)) {
    const context = describeStartupRequest(value);
    if (type === 'normalization-replace') {
      const request = value as Extract<WorkspaceStartupRequest, { type: 'normalization-replace' }>;
      describeRequest({ type: 'replace-document', admissionId: request.admissionId, batch: request.batch });
    }
    return { context };
  }
  if (type === 'open-project') {
    const r = frameFields(value, ['type', 'scope', 'workspaceAdmissionId']); counter(r.workspaceAdmissionId, true);
    return { context: { requestType: type, scope: scopeFrame(r.scope), workspaceAdmissionId: r.workspaceAdmissionId } };
  }
  if (type === 'workspace-recovery-discard') {
    const r = frameFields(value, ['type', 'admissionId', 'preparationId', 'storageGeneration']);
    counter(r.admissionId, true); counter(r.preparationId, true); text(r.storageGeneration, true);
    return { context: { requestType: type, storageGeneration: r.storageGeneration, admissionId: r.admissionId }, recovery: { preparationId: r.preparationId } };
  }
  if (type === 'workspace-recovery-commit') {
    const r = frameFields(value, ['type', 'admissionId', 'preparationId', 'attempt']); counter(r.admissionId, true); counter(r.preparationId, true);
    const a = frameFields(r.attempt, ['storageGeneration', 'identity', 'expected', 'recoveryId', 'sourceDigest']); text(a.storageGeneration, true);
    text(a.recoveryId, true); digestFrame(a.sourceDigest);
    return { context: { requestType: type, admissionId: r.admissionId, storageGeneration: a.storageGeneration,
      identity: workspaceIdentityFrame(a.identity), expected: workspaceStampFrame(a.expected) }, workspaceIntent: 'recover-legacy-as-copies',
      recovery: { recoveryId: a.recoveryId, sourceDigest: a.sourceDigest, preparationId: r.preparationId } };
  }
  if (type === 'workspace-bootstrap' || type === 'workspace-fence' || type === 'workspace-resume-aborted') {
    const r = frameFields(value, type === 'workspace-bootstrap' ? ['type', 'storageGeneration'] : ['type', 'storageGeneration', 'admissionId']);
    text(r.storageGeneration, true);
    if (type === 'workspace-bootstrap') return { context: { requestType: type, storageGeneration: r.storageGeneration } };
    counter(r.admissionId, true); return { context: { requestType: type, storageGeneration: r.storageGeneration, admissionId: r.admissionId } };
  }
  if (type === 'workspace-command' || type === 'inspect-workspace-command' || type === 'workspace-recovery-prepare') {
    const r = frameFields(value, ['type', 'admissionId', 'batch']); counter(r.admissionId, true);
    const { workspaceIntent, ...framing } = workspaceBatchFrame(r.batch);
    requireFrame(type === 'workspace-recovery-prepare' ? workspaceIntent === 'recover-legacy-as-copies'
      : type !== 'workspace-command' || workspaceIntent !== 'recover-legacy-as-copies');
    const recovery = workspaceIntent === 'recover-legacy-as-copies' ? { recoveryId: ownValue(ownValue(r.batch, 'intent'), 'recoveryId') as string,
      sourceDigest: ownValue(ownValue(r.batch, 'intent'), 'sourceDigest') as string } : undefined;
    return { context: { requestType: type, admissionId: r.admissionId, ...framing }, workspaceIntent, ...(recovery ? { recovery } : {}) };
  }
  if (type === 'bootstrap') {
    const r = frameFields(value, ['type', 'project']);
    return { context: { requestType: type, scope: scopeFrame(ownValue(r.project, 'scope')) } };
  }
  if (type === 'project-cut-authority') {
    const r = frameFields(value, ['type', 'scope', 'admissionId']); counter(r.admissionId, true);
    return { context: { requestType: type, scope: scopeFrame(r.scope), admissionId: r.admissionId } };
  }
  if (type === 'document-readmission-authority') {
    const r = frameFields(value, ['type', 'receipt', 'admissionId']); counter(r.admissionId, true);
    const receipt = frameFields(r.receipt, ['scope', 'identity', 'ack']);
    const scope = scopeFrame(receipt.scope), identity = identityFrame(receipt.identity);
    requireFrame(identity.lane === 'document');
    const revision = ownValue(receipt.ack, 'revision'), foldGeneration = ownValue(receipt.ack, 'foldStructureGeneration');
    counter(revision, true); counter(foldGeneration);
    const expected: ExpectedWorkerResponse = { context: { requestType: type, scope, identity, admissionId: r.admissionId }, lower: revision - 1, foldGeneration };
    ackFrame(receipt.ack, expected); return expected;
  }
  if (type === 'replace-document' || type === 'inspect-replacement') {
    const r = frameFields(value, ['type', 'batch', ...(type === 'replace-document' ? ['admissionId'] : [])]);
    if (type === 'replace-document') counter(r.admissionId, true);
    const b = frameFields(r.batch, ['scope', 'clientId', 'commitGeneration', 'commitId', 'editorGeneration', 'expected', 'state', 'preferences'], ['metadata']);
    const scope = scopeFrame(b.scope), identity = identityFrame({ clientId: b.clientId, commitId: b.commitId,
      commitGeneration: b.commitGeneration, editorGeneration: b.editorGeneration, lane: 'document' });
    authorityFrame(b.expected); const before = b.expected as AuthorityStamp;
    for (const count of [before.documentRevision, before.preferenceRevision, before.foldStructureGeneration]) requireFrame(count < Number.MAX_SAFE_INTEGER);
    container(b.state); container(b.preferences); // Contents remain opaque until cooperative worker validation.
    if (b.metadata !== undefined) { const m = frameFields(b.metadata, ['kind', 'name']); requireFrame(m.kind === 'linked-root' && typeof m.name === 'string'); }
    return { context: type === 'replace-document'
      ? { requestType: type, scope, identity, admissionId: r.admissionId as number } : { requestType: type, scope, identity },
      replacementBefore: { ...before } };
  }
  if (type === 'recovery-export') {
    const r = frameFields(value, ['type', 'scope']); return { context: { requestType: type, scope: scopeFrame(r.scope) } };
  }
  if (type === 'inspect-commit') {
    const r = frameFields(value, ['type', 'attempt']); const a = frameFields(r.attempt, ['lane', 'batch']);
    requireFrame(a.lane === 'document' || a.lane === 'preferences');
    const { scope, identity, lower, foldGeneration } = batchFrame(a.batch, a.lane);
    return { context: { requestType: type, scope, identity }, lower, foldGeneration };
  }
  requireFrame(type === 'document-batch' || type === 'preferences' || type === 'structural-command');
  const r = frameFields(value, ['type', 'admissionId', type === 'structural-command' ? 'command' : 'batch']); counter(r.admissionId, true);
  let batch = r.batch;
  if (type === 'structural-command') {
    const command = frameFields(r.command, ['type', 'batch']); requireFrame(command.type === 'occurrence-edit');
    batch = command.batch; ownValue(batch, 'structural');
  }
  const { scope, identity, lower, foldGeneration } = batchFrame(batch, type === 'preferences' ? 'preferences' : 'document');
  return { context: { requestType: type, scope, identity, admissionId: r.admissionId }, lower, foldGeneration };
}
export function requestEnvelope(value: unknown): { envelope: WorkspaceWorkerRequestEnvelope; expected: ExpectedWorkerResponse } {
  const e = frameFields(value, ['protocolVersion', 'workerEpoch', 'requestId', 'request']);
  requireFrame(e.protocolVersion === 1); counter(e.workerEpoch, true); counter(e.requestId, true);
  return { envelope: value as WorkspaceWorkerRequestEnvelope, expected: describeRequest(e.request) };
}
function authorityFrame(value: unknown): void {
  const a = frameFields(value, ['documentRevision', 'preferenceRevision', 'foldStructureGeneration']);
  counter(a.documentRevision); counter(a.preferenceRevision); counter(a.foldStructureGeneration);
}
function ackFrame(value: unknown, expected: ExpectedWorkerResponse): void {
  const context = expected.context; requireFrame('scope' in context && 'identity' in context);
  const i = context.identity; const document = i.lane === 'document';
  const a = frameFields(value, ['type', 'projectId', 'incarnation', 'commitId', 'editorGeneration', 'foldStructureGeneration', document ? 'revision' : 'preferenceRevision']);
  requireFrame(a.type === (document ? 'document-saved' : 'preferences-saved') && a.projectId === context.scope.projectId
    && a.incarnation === context.scope.incarnation && a.commitId === i.commitId && a.editorGeneration === i.editorGeneration);
  counter(a.editorGeneration); counter(a.foldStructureGeneration);
  const revision = a[document ? 'revision' : 'preferenceRevision']; counter(revision);
  requireFrame(document ? revision === expected.lower! + 1 : revision > expected.lower!);
  if (expected.foldGeneration !== undefined) requireFrame(document
    ? a.foldStructureGeneration === expected.foldGeneration || (expected.foldGeneration < Number.MAX_SAFE_INTEGER && a.foldStructureGeneration === expected.foldGeneration + 1)
    : a.foldStructureGeneration === expected.foldGeneration);
}
function replacementAckFrame(value: unknown, expected: ExpectedWorkerResponse): void {
  const c = expected.context; requireFrame('scope' in c && 'identity' in c && expected.replacementBefore);
  const ack = frameFields(value, ['type', 'projectId', 'incarnation', 'commitId', 'editorGeneration', 'authority', 'boundaryDigest']);
  requireFrame(ack.type === 'document-replaced' && ack.projectId === c.scope.projectId && ack.incarnation === c.scope.incarnation
    && ack.commitId === c.identity.commitId && ack.editorGeneration === c.identity.editorGeneration);
  authorityFrame(ack.authority); digestFrame(ack.boundaryDigest);
  const after = ack.authority as AuthorityStamp, before = expected.replacementBefore;
  requireFrame(after.documentRevision === before.documentRevision + 1 && after.preferenceRevision === before.preferenceRevision + 1
    && after.foldStructureGeneration === before.foldStructureGeneration + 1);
}
export function validateReplacementReply(ack: unknown, batch: BulkDocumentBatch, admissionId: number): void {
  replacementAckFrame(ack, describeRequest({ type: 'replace-document', admissionId, batch }));
}
function workspaceCatalogFrame(value: unknown, generation: string): WorkspaceStamp {
  const c = frameFields(value, ['storageGeneration', 'stamp', 'members', 'activeProjectId', 'presets', 'pendingImports']);
  requireFrame(c.storageGeneration === generation); text(c.activeProjectId);
  for (const key of ['members', 'presets', 'pendingImports']) requireFrame(Array.isArray(c[key]));
  // Cardinality is unbounded. Membership/descriptor checks belong to cooperative publication.
  return workspaceStampFrame(c.stamp);
}
const workspaceOutcomes: Record<WorkspaceBatch['intent']['type'], readonly WorkspaceCommandResult['outcome'][]> = {
  'create-and-activate-project': ['created'], 'activate-project': ['activated'], 'close-project': ['closed'],
  'save-custom-preset': ['preset-saved'], 'delete-custom-preset': ['preset-deleted'],
  'stage-import': ['staged', 'already-staged', 'already-consumed'], 'replace-staged-import': ['replaced', 'already-staged', 'already-consumed'],
  'consume-import': ['consumed', 'already-consumed'],
  'recover-legacy-as-copies': ['recovered'],
};
/** B commands return at most one new project, saved preset or prepared import. */
function materialFrame(value: unknown, minimum: number, maximum = minimum): unknown {
  requireFrame(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype
    && value.length >= minimum && value.length <= maximum && Reflect.ownKeys(value).length === value.length + 1);
  if (!value.length) return undefined;
  const d = Object.getOwnPropertyDescriptor(value, '0'); requireFrame(d?.enumerable && Object.hasOwn(d, 'value'));
  container(d.value); return d.value;
}
function workspaceResultFrame(value: unknown, expected: ExpectedWorkerResponse, inspected: boolean): void {
  const context = expected.context; requireFrame('expected' in context && expected.workspaceIntent !== undefined);
  const r = frameFields(value, ['type', 'outcome', 'receipt', inspected ? 'catalog' : 'delta', 'projects', 'presets', 'pendingImports']);
  requireFrame(r.type === (inspected ? 'workspace-inspected-current' : 'workspace-committed'));
  requireFrame(workspaceOutcomes[expected.workspaceIntent].includes(r.outcome as WorkspaceCommandResult['outcome']));
  const created = r.outcome === 'created' || r.outcome === 'consumed';
  const recovered = r.outcome === 'recovered';
  // Recovery cardinality is unbounded; full material checks belong to cooperative publication/ingress.
  const material = recovered ? undefined : materialFrame(r.projects, created ? 1 : 0, created || r.outcome === 'closed' ? 1 : 0);
  if (recovered) { for (const key of ['projects', 'presets', 'pendingImports']) requireFrame(Array.isArray(r[key])); }
  else {
    materialFrame(r.presets, r.outcome === 'preset-saved' ? 1 : 0);
    materialFrame(r.pendingImports, r.outcome === 'staged' || r.outcome === 'replaced' || r.outcome === 'already-staged' ? 1 : 0);
  }
  if (material !== undefined) {
    const m = frameFields(material, ['scope', 'authority', 'records']), scope = scopeFrame(m.scope);
    requireFrame(scope.storageGeneration === context.storageGeneration); authorityFrame(m.authority);
    const a = m.authority as AuthorityStamp;
    requireFrame(a.documentRevision === 0 && a.preferenceRevision === 0 && a.foldStructureGeneration === 0);
    requireFrame(sameScope(scopeFrame(ownValue(m.records, 'scope')), scope));
    // Actual record maps stay opaque until cooperative ingress and explicit project bootstrap.
  }
  const receipt = frameFields(r.receipt, ['identity', 'requestDigest', 'before', 'after', 'postconditionDigest', 'proofDigest']);
  requireFrame(sameWorkspaceIdentity(workspaceIdentityFrame(receipt.identity), context.identity));
  requireFrame(sameWorkspaceStamp(workspaceStampFrame(receipt.before), context.expected));
  const after = workspaceStampFrame(receipt.after); requireFrame(after.revision === context.expected.revision + 1);
  for (const key of ['requestDigest', 'postconditionDigest', 'proofDigest']) digestFrame(receipt[key]);
  if (inspected) requireFrame(sameWorkspaceStamp(workspaceCatalogFrame(r.catalog, context.storageGeneration), after));
  else {
    const delta = frameFields(r.delta, ['storageGeneration', 'before', 'after', 'removed', 'added', 'activeProjectId', 'presets', 'pendingImports']);
    requireFrame(delta.storageGeneration === context.storageGeneration && sameWorkspaceStamp(workspaceStampFrame(delta.before), context.expected)
      && sameWorkspaceStamp(workspaceStampFrame(delta.after), after)); text(delta.activeProjectId);
    requireFrame(Array.isArray(delta.removed) && Array.isArray(delta.added));
    for (const key of ['presets', 'pendingImports']) {
      const changes = frameFields(delta[key], ['remove', 'upsert']); requireFrame(Array.isArray(changes.remove) && Array.isArray(changes.upsert));
    }
  }
}
function workspaceResponseFrame(value: unknown, expected: ExpectedWorkerResponse, requestId: number): void {
  const wanted = expected.context; requireFrame('storageGeneration' in wanted);
  const type = ownValue(value, 'type');
  if (wanted.requestType === 'workspace-bootstrap' || wanted.requestType === 'workspace-resume-aborted') {
    const r = frameFields(value, ['type', 'admissionId', 'catalog', 'projectAuthorities']);
    requireFrame(type === (wanted.requestType === 'workspace-bootstrap' ? 'workspace-bootstrapped' : 'workspace-resumed'));
    counter(r.admissionId, true); requireFrame(r.admissionId === requestId);
    workspaceCatalogFrame(r.catalog, wanted.storageGeneration); requireFrame(Array.isArray(r.projectAuthorities));
  } else if (wanted.requestType === 'workspace-recovery-prepare') {
    const r = frameFields(value, ['type', 'admissionId', 'preparationId', 'recoveryId', 'sourceDigest', 'counts']);
    requireFrame(type === 'workspace-recovery-prepared' && r.admissionId === wanted.admissionId);
    counter(r.preparationId, true); if (requestId) requireFrame(r.preparationId === requestId);
    requireFrame(r.recoveryId === expected.recovery?.recoveryId && r.sourceDigest === expected.recovery?.sourceDigest);
    const counts = frameFields(r.counts, ['projects', 'presets', 'pendingImports']); for (const key of ['projects', 'presets', 'pendingImports']) counter(counts[key]);
  } else if (wanted.requestType === 'workspace-recovery-discard') {
    const r = frameFields(value, ['type', 'storageGeneration', 'admissionId', 'preparationId']);
    requireFrame(type === 'workspace-recovery-discarded' && r.storageGeneration === wanted.storageGeneration
      && r.admissionId === wanted.admissionId && r.preparationId === expected.recovery?.preparationId);
  } else if (wanted.requestType === 'workspace-fence') {
    const r = frameFields(value, ['type', 'storageGeneration', 'admissionId']); counter(r.admissionId, true);
    requireFrame(type === 'workspace-fenced' && r.storageGeneration === wanted.storageGeneration && r.admissionId === wanted.admissionId);
  } else if (wanted.requestType === 'workspace-command' || wanted.requestType === 'workspace-recovery-commit') {
    const r = frameFields(value, ['type', 'admissionId', 'result']); counter(r.admissionId, true);
    requireFrame(type === 'workspace-command-result' && r.admissionId === wanted.admissionId); workspaceResultFrame(r.result, expected, false);
  } else {
    requireFrame('identity' in wanted);
    const r = frameFields(value, ['type', 'identity', 'result']); requireFrame(type === 'workspace-inspection');
    requireFrame(sameWorkspaceIdentity(workspaceIdentityFrame(r.identity), wanted.identity));
    const kind = ownValue(r.result, 'type');
    if (kind === 'committed') { const result = frameFields(r.result, ['type', 'result']); workspaceResultFrame(result.result, expected, true); }
    else if (kind === 'not-committed' || kind === 'unknown') frameFields(r.result, ['type']);
    else {
      const result = frameFields(r.result, ['type', 'reason']); requireFrame(kind === 'conflict');
      requireFrame(['authority-changed', 'identity-mismatch', 'proof-unavailable', 'verification-failed', 'incarnation-changed'].includes(result.reason as string));
    }
  }
}
function failureFrame(value: unknown): void {
  const r = frameFields(value, ['type', 'code', 'outcome', 'admission']);
  requireFrame(r.type === 'failed' && [...repositoryFailureCodes, 'invalid-request', 'stale-admission'].includes(r.code as RepositoryFailureCode));
  requireFrame(r.outcome === 'not-started' || r.outcome === 'unknown'); requireFrame(r.admission === 'invalidated' || r.admission === 'none');
}
/** Inner reply correlation for the private owner. The client still checks wire epoch/request IDs. */
export function validateWorkspaceLifecycleReply(value: unknown, request: Exclude<WorkspaceLifecycleWorkerRequest, { type: 'workspace-bootstrap' | 'workspace-resume-aborted' }>): void {
  const expected = describeRequest(request);
  if (ownValue(value, 'type') === 'failed') failureFrame(value);
  else workspaceResponseFrame(value, expected, 0);
}
export function validateResponse(value: unknown, expected: ExpectedWorkerResponse, requestId: number, workerEpoch: number): WorkspaceWorkerResponse {
  const e = frameFields(value, ['protocolVersion', 'workerEpoch', 'requestId', 'context', 'response']);
  counter(e.requestId, true); counter(e.workerEpoch, true);
  requireFrame(e.protocolVersion === 1 && e.requestId === requestId && e.workerEpoch === workerEpoch);
  const wanted = expected.context;
  if ('startup' in wanted) {
    const context = frameFields(e.context, Object.keys(wanted));
    for (const key of Object.keys(wanted)) requireFrame(context[key] === Reflect.get(wanted, key));
    if (ownValue(e.response, 'type') === 'failed') failureFrame(e.response);
    else validateStartupReply(e.context, e.response, wanted, requestId);
    return e.response as WorkspaceWorkerResponse;
  }
  const context = frameFields(e.context, ['requestType', 'scope' in wanted ? 'scope' : 'storageGeneration',
    ...('identity' in wanted ? ['identity'] : []), ...('admissionId' in wanted ? ['admissionId'] : []), ...('expected' in wanted ? ['expected'] : []),
    ...('workspaceAdmissionId' in wanted ? ['workspaceAdmissionId'] : [])]);
  requireFrame(context.requestType === wanted.requestType);
  if ('scope' in wanted) {
    requireFrame(sameScope(scopeFrame(context.scope), wanted.scope));
    if ('identity' in wanted) {
      const identity = identityFrame(context.identity);
      for (const key of Object.keys(identity) as (keyof CommitIdentity)[]) requireFrame(identity[key] === wanted.identity[key]);
    }
  } else {
    requireFrame(context.storageGeneration === wanted.storageGeneration);
    if ('expected' in wanted) {
      requireFrame(sameWorkspaceIdentity(workspaceIdentityFrame(context.identity), wanted.identity));
      requireFrame(sameWorkspaceStamp(workspaceStampFrame(context.expected), wanted.expected));
    }
  }
  if ('admissionId' in wanted) { counter(context.admissionId, true); requireFrame(context.admissionId === wanted.admissionId); }
  if ('workspaceAdmissionId' in wanted) requireFrame(context.workspaceAdmissionId === wanted.workspaceAdmissionId);
  const type = ownValue(e.response, 'type');
  if (type === 'failed') {
    failureFrame(e.response);
  } else if ('storageGeneration' in wanted) workspaceResponseFrame(e.response, expected, requestId);
  else if (wanted.requestType === 'bootstrap' || wanted.requestType === 'project-cut-authority' || wanted.requestType === 'open-project') {
    const r = frameFields(e.response, ['type', 'scope', 'admissionId', 'authority', ...(wanted.requestType === 'open-project' ? ['project'] : [])]);
    requireFrame(type === (wanted.requestType === 'bootstrap' ? 'bootstrapped' : wanted.requestType === 'open-project' ? 'project-opened' : 'project-cut-authority-result') && sameScope(scopeFrame(r.scope), wanted.scope));
    counter(r.admissionId, true); requireFrame(r.admissionId === ('admissionId' in wanted ? wanted.admissionId : requestId)); authorityFrame(r.authority);
    if (wanted.requestType === 'open-project') requireFrame(ownValue(r.project, 'id') === wanted.scope.projectId);
  } else if (wanted.requestType === 'document-readmission-authority') {
    const r = frameFields(e.response, ['type', 'scope', 'admissionId', 'identity', 'authority']);
    requireFrame(type === 'document-readmission-authority-result' && sameScope(scopeFrame(r.scope), wanted.scope) && r.admissionId === wanted.admissionId);
    const identity = identityFrame(r.identity);
    for (const key of Object.keys(identity) as (keyof CommitIdentity)[]) requireFrame(identity[key] === wanted.identity[key]);
    authorityFrame(r.authority); const stamp = r.authority as AuthorityStamp;
    requireFrame(stamp.documentRevision === expected.lower! + 1 && stamp.foldStructureGeneration === expected.foldGeneration);
  } else if (wanted.requestType === 'recovery-export') {
    const r = frameFields(e.response, ['type', 'source', 'scope', 'authority', 'project']);
    requireFrame(type === 'recovery-exported' && r.source === 'normalized-project' && sameScope(scopeFrame(r.scope), wanted.scope));
    authorityFrame(r.authority); container(r.project); requireFrame(ownValue(r.project, 'id') === wanted.scope.projectId);
  } else if (wanted.requestType === 'inspect-commit' || wanted.requestType === 'inspect-replacement') {
    const r = frameFields(e.response, ['type', 'result']); requireFrame(type === (wanted.requestType === 'inspect-commit' ? 'commit-inspection' : 'replacement-inspection'));
    const inspectionType = ownValue(r.result, 'type');
    if (inspectionType === 'committed') { const result = frameFields(r.result, ['type', 'ack']);
      if (wanted.requestType === 'inspect-replacement') replacementAckFrame(result.ack, expected); else ackFrame(result.ack, expected); }
    else if (inspectionType === 'not-committed') frameFields(r.result, ['type']);
    else {
      const result = frameFields(r.result, ['type', 'reason']); requireFrame(inspectionType === 'conflict');
      requireFrame(['authority-changed', 'identity-mismatch', 'proof-unavailable', 'verification-failed', 'incarnation-changed'].includes(result.reason as string));
    }
  } else {
    const r = frameFields(e.response, ['type', 'ack']);
    requireFrame(type === (wanted.requestType === 'document-batch' ? 'document-result' : wanted.requestType === 'preferences' ? 'preferences-result'
      : wanted.requestType === 'replace-document' ? 'replacement-result' : 'structural-result'));
    if (wanted.requestType === 'replace-document') replacementAckFrame(r.ack, expected); else ackFrame(r.ack, expected);
  }
  return e.response as WorkspaceWorkerResponse;
}
