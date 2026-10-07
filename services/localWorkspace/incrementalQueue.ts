import type { DocumentChange, EditorPreferences } from '../document/contracts';
import type { WorkspaceProject } from './contracts';
import type { LayerMapping, LayerOccurrence } from '../document/layerFolds';
import type { AuthorityStamp, BulkDocumentAck, BulkDocumentBatch, CommitAttempt, DocumentBatch, DocumentSaveAck, DocumentCommitReceipt, PreferenceSaveAck, ProjectMetadataEdit, ProjectScope } from './normalized/schema';
import type { WorkspaceWorkerFailure, WorkspaceWorkerRequest, WorkspaceWorkerResponse } from './workspaceWorkerProtocol';
import type { WorkspaceWorkerClient, WorkspaceWorkerError } from './workspaceWorkerClient';

export type QueueTransport = Pick<WorkspaceWorkerClient, 'request'>;
export type QueueLane = 'document' | 'preferences';
export type QueueAttempt = CommitAttempt | { readonly lane: 'replacement'; readonly batch: BulkDocumentBatch };
export type BootstrapBinding = Extract<WorkspaceWorkerResponse, { type: 'bootstrapped' }>;
export type InspectionResponse = Extract<WorkspaceWorkerResponse, { type: 'commit-inspection' | 'replacement-inspection' }>;
/** Store-owned installation. Neither a public capability nor a wire epoch. */
export interface InstalledQueueAuthority {
  readonly source: object;
  readonly transport: QueueTransport;
  readonly binding: BootstrapBinding;
  readonly editorGenerationFloor: number;
}
export type FoldBasis = { readonly type: 'generation'; readonly generation: number }
  | { readonly type: 'after-structural' | 'after-replacement'; readonly editorGeneration: number };
export interface QueueStructuralInput { readonly basis: FoldBasis; readonly mappings: readonly LayerMapping[] }
export interface QueueDocumentInput {
  readonly source: object;
  readonly changes: readonly DocumentChange[];
  readonly structural?: QueueStructuralInput;
  readonly metadata?: ProjectMetadataEdit;
}
export type ScalarPreferencePatch = Partial<Omit<EditorPreferences, 'layerCollapsed'>>;
export interface QueueFoldInput {
  readonly basis: FoldBasis;
  readonly updates: readonly { readonly occurrence: LayerOccurrence; readonly collapsed: boolean }[];
}
export interface QueuePreferenceInput { readonly source: object; readonly patch: ScalarPreferencePatch; readonly folds?: QueueFoldInput }
export interface QueueReplacementInput extends Pick<BulkDocumentBatch, 'state' | 'preferences' | 'metadata'> { readonly source: object }
export type QueueFailure = { readonly type: 'domain'; readonly response: WorkspaceWorkerFailure }
  | { readonly type: 'transport'; readonly error: unknown }
  | { readonly type: 'queue'; readonly code: 'missing-authority' | 'source-changed' | 'stale-generation'
    | 'invalid-input' | 'invalid-response' | 'counter-exhausted' | 'fold-dependency' | 'barrier-active'
    | 'retry-required' | 'frozen' | 'disposed'; readonly cause?: unknown };
interface SegmentTiming {
  readonly firstPendingAt: number;
  readonly trailingAt: number;
  readonly firstEditorGeneration: number;
  readonly editorGeneration: number;
}
export type RetainedSegment = SegmentTiming & (
  | { readonly lane: 'document'; readonly changes: readonly DocumentChange[]; readonly structural?: QueueStructuralInput; readonly metadata?: ProjectMetadataEdit }
  | { readonly lane: 'preferences'; readonly patch: ScalarPreferencePatch; readonly folds?: QueueFoldInput }
  | { readonly lane: 'replacement'; readonly replacement: Omit<QueueReplacementInput, 'source'> });
export interface RetainedAttempt { readonly attempt: QueueAttempt; readonly segment: RetainedSegment; readonly failure?: QueueFailure }
export interface RetainedProjectWork {
  readonly authority: InstalledQueueAuthority;
  readonly documentReceipt?: DocumentCommitReceipt;
  readonly acknowledged: {
    readonly documentGeneration: number; readonly preferenceGeneration: number; readonly documentRevision: number;
    readonly preferenceRevisionLowerBound: number; readonly foldStructureGeneration: number;
  };
  readonly pending: readonly RetainedSegment[];
  readonly attempts: readonly RetainedAttempt[];
  readonly structuralAcks: readonly { readonly editorGeneration: number; readonly ack: DocumentSaveAck | BulkDocumentAck }[];
}
export interface RetainedQueueWork { readonly projects: readonly RetainedProjectWork[]; readonly whenQuiescent: Promise<void> }
export type AttemptResolution = { readonly attempt: QueueAttempt; readonly inspection: InspectionResponse }
  | { readonly attempt: QueueAttempt; readonly notPosted: WorkspaceWorkerError };
export interface QueueRecoveryProject {
  readonly previous: RetainedProjectWork; readonly authority: InstalledQueueAuthority; readonly resolutions: readonly AttemptResolution[];
}
export interface QueueRecoveryInput { readonly retained: RetainedQueueWork; readonly projects: readonly QueueRecoveryProject[] }
export type QueueEvent = { readonly type: 'acknowledged'; readonly authority: InstalledQueueAuthority;
  readonly attempt: QueueAttempt; readonly ack: Ack }
  | { readonly type: 'project-blocked'; readonly failure: QueueFailure; readonly work: RetainedProjectWork }
  | { readonly type: 'frozen'; readonly failure: QueueFailure; readonly work: RetainedQueueWork };
export interface IncrementalQueueOptions {
  readonly transport: QueueTransport;
  readonly clock: { now(): number; setTimeout(callback: () => void, delayMs: number): unknown; clearTimeout(handle: unknown): void };
  uuid(): string;
  resolveAuthority(projectId: string, editorGeneration: number, lane: QueueLane): InstalledQueueAuthority | undefined;
  onEvent(event: QueueEvent): void;
  canCoalesceLayerTransfers?(before: readonly LayerMapping[], beforeChanges: Iterable<DocumentChange>, after: readonly LayerMapping[], afterChanges: readonly DocumentChange[]): boolean;
  readonly recovery?: QueueRecoveryInput;
}
export type QueueBarrierOutcome<T> = { readonly type: 'completed'; readonly value: T }
  | { readonly type: 'failed'; readonly failure: QueueFailure };
export interface QueueBarrierOperation<T> {
  readonly kind: 'drain' | 'close' | 'replace'; readonly targets: readonly InstalledQueueAuthority[];
  run(): Promise<QueueBarrierOutcome<T>>;
}
export interface WorkspaceQueueCut {
  readonly targets: readonly { readonly authority: InstalledQueueAuthority; readonly stamp: AuthorityStamp }[];
}
export interface WorkspaceQueueBarrier<T> {
  readonly targets: readonly InstalledQueueAuthority[];
  readonly retireScopes: readonly ProjectScope[];
  run(cut: WorkspaceQueueCut): Promise<QueueBarrierOutcome<T>>;
}
export interface WorkspaceQueueMethods {
  workspaceBarrier<T>(operation: WorkspaceQueueBarrier<T>): Promise<T>;
  /** Construction-time recovery gate; release does not flush restored work. */
  holdWorkspaceRecovery(): () => void;
}
export interface IncrementalQueue extends WorkspaceQueueMethods {
  trackProject(authority: InstalledQueueAuthority): void;
  enqueueDocument(projectId: string, editorGeneration: number, changes: readonly DocumentChange[] | QueueDocumentInput): Promise<DocumentSaveAck>;
  enqueuePreferences(projectId: string, editorGeneration: number, patch: Partial<EditorPreferences> | QueuePreferenceInput): Promise<PreferenceSaveAck>;
  enqueueReplacement(projectId: string, editorGeneration: number, input: QueueReplacementInput): Promise<BulkDocumentAck>;
  flush(projectId?: string): Promise<void>;
  barrier<T>(operation: QueueBarrierOperation<T>): Promise<T>;
  freeze(error: unknown): RetainedQueueWork;
  dispose(): RetainedQueueWork;
  prepareProjectReadmission(checkpoint: RetainedQueueWork, previous: RetainedProjectWork,
    receipts: readonly QueueSubmissionReceipt[]): Promise<VerifiedQueueReadmission>;
}

declare const queueSubmissionBrand: unique symbol;
export interface QueueSubmissionReceipt { readonly [queueSubmissionBrand]: true }
declare const queueReadmissionBrand: unique symbol;
export interface VerifiedQueueReadmission { readonly [queueReadmissionBrand]: true }
export interface QueueReadmissionEvidence {
  readonly authority: InstalledQueueAuthority;
  readonly previousAuthority: InstalledQueueAuthority;
  readonly base: AuthorityStamp;
  readonly receipts: readonly { readonly receipt: QueueSubmissionReceipt; readonly lane: QueueLane; readonly generation: number;
    readonly acknowledged: Ack | undefined; readonly whenAcknowledged: Promise<Ack> }[];
  readonly whenFailed: Promise<QueueFailure>;
  readonly acknowledgedAttempts: readonly { readonly clientId: string; readonly commitGeneration: number; readonly lane: QueueAttempt['lane']; readonly ack: Ack }[];
  assertCurrent(): void;
}

type Ack = DocumentSaveAck | PreferenceSaveAck | BulkDocumentAck;
const laneOf = (lane: QueueAttempt['lane']): QueueLane => lane === 'replacement' ? 'document' : lane;
const foldOf = (ack: Ack) => ack.type === 'document-replaced' ? ack.authority.foldStructureGeneration : ack.foldStructureGeneration;
const responseType = (attempt: QueueAttempt) => attempt.lane === 'replacement' ? 'replacement-result'
  : attempt.lane === 'preferences' ? 'preferences-result' : attempt.batch.structural ? 'structural-result' : 'document-result';
// Weak provenance only: no lifetime commit log and no ownership of editor payloads.
const checkpoints = new WeakSet<RetainedQueueWork>();
const checkpointAuthorities = new WeakMap<RetainedProjectWork, InstalledQueueAuthority>();
const capturedRejections = new WeakMap<QueueAttempt, unknown>();
interface SubmissionProof {
  source: object; scope: ProjectScope; lane: QueueLane; generation: number; family: object;
  acknowledgement?: Ack; completion: Deferred<Ack>;
}
const submissionProofs = new WeakMap<QueueSubmissionReceipt, SubmissionProof>();
const promiseReceipts = new WeakMap<Promise<unknown>, QueueSubmissionReceipt>();
const commandReceipts = new WeakMap<object, QueueSubmissionReceipt>();
const segmentReceipts = new WeakMap<RetainedSegment, readonly QueueSubmissionReceipt[]>();
const checkpointOwners = new WeakMap<RetainedQueueWork, object>();
const readmissionProofs = new WeakMap<VerifiedQueueReadmission, QueueReadmissionEvidence>();
export function getQueueSubmissionReceipt(promise: Promise<unknown>): QueueSubmissionReceipt | undefined { return promiseReceipts.get(promise); }
export function clearCommandQueueReceipt(command: object): void { commandReceipts.delete(command); }
export function associateQueueSubmission(command: object, promise: Promise<unknown>, source: object, lane: QueueLane, generation: number): void {
  const receipt = promiseReceipts.get(promise); if (!receipt) return;
  const proof = submissionProofs.get(receipt)!;
  requireInput(proof.source === source && proof.lane === lane && proof.generation === generation);
  commandReceipts.set(command, receipt);
}
export function getCommandQueueReceipt(command: object): QueueSubmissionReceipt | undefined { return commandReceipts.get(command); }
export function getRetainedQueueProject(checkpoint: RetainedQueueWork, source: object, projectId: string): RetainedProjectWork | undefined {
  requireInput(checkpoints.has(checkpoint));
  return checkpoint.projects.find(project => {
    const pinned = checkpointAuthorities.get(project)!; return pinned.source === source && pinned.binding.scope.projectId === projectId;
  });
}
export function readRetainedQueueAuthority(checkpoint: RetainedQueueWork, previous: RetainedProjectWork): InstalledQueueAuthority {
  requireInput(checkpoints.has(checkpoint) && checkpoint.projects.includes(previous));
  const authority = checkpointAuthorities.get(previous); requireInput(authority); return authority;
}
export function readQueueReadmission(proof: VerifiedQueueReadmission): QueueReadmissionEvidence {
  const evidence = readmissionProofs.get(proof); requireInput(evidence); evidence.assertCurrent(); return evidence;
}
function settleReceipts(receipts: readonly QueueSubmissionReceipt[], ack: Ack) {
  for (const receipt of receipts) {
    const proof = submissionProofs.get(receipt)!;
    requireInput(proof.scope.projectId === ack.projectId && proof.scope.incarnation === ack.incarnation
      && proof.lane === (ack.type === 'preferences-saved' ? 'preferences' : 'document') && proof.generation <= ack.editorGeneration);
    const previous = proof.acknowledgement;
    if (previous) requireInput(Object.keys(ack).every(key => key === 'authority' && ack.type === 'document-replaced' && previous.type === 'document-replaced'
      ? Object.keys(ack.authority).every(field => Reflect.get(previous.authority, field) === Reflect.get(ack.authority, field))
      : Reflect.get(previous, key) === Reflect.get(ack, key)));
  }
  for (const receipt of receipts) {
    const proof = submissionProofs.get(receipt)!; if (!proof.acknowledgement) { proof.acknowledgement = ack; proof.completion.resolve(ack); }
  }
}
type Code = Extract<QueueFailure, { type: 'queue' }>['code'];
const failure = (code: Code, cause?: unknown): QueueFailure => ({ type: 'queue', code, ...(cause === undefined ? {} : { cause }) });
function requireInput(condition: unknown): asserts condition { if (!condition) throw failure('invalid-input'); }
const safe = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
/** Framing only: never enumerate a node/template, mapping cell or preference map. */
function own(value: unknown, key: string): unknown {
  requireInput(value !== null && typeof value === 'object');
  const d = Object.getOwnPropertyDescriptor(value, key);
  requireInput(d?.enumerable && Object.hasOwn(d, 'value')); return d.value;
}
function frame(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  requireInput(value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype);
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    requireInput(typeof key === 'string' && (required.includes(key) || optional.includes(key)));
    result[key] = own(value, key);
  }
  requireInput(required.every(key => Object.hasOwn(result, key))); return result;
}
function array<T>(value: unknown): T[] {
  requireInput(Array.isArray(value));
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  requireInput(safe(length));
  const keys = Reflect.ownKeys(value);
  requireInput(keys.length === length + 1 && keys.every(key => key === 'length'
    || typeof key === 'string' && safe(Number(key)) && String(Number(key)) === key && Number(key) < length));
  const output: T[] = [];
  for (let i = 0; i < length; i++) output.push(own(value, String(i)) as T);
  return output;
}
function text(value: unknown): string { requireInput(typeof value === 'string' && value.length > 0); return value; }
// Public document IDs follow the existing record validator, not private-token rules.
function recordId(value: unknown): string { requireInput(typeof value === 'string'); return value; }
function privateId(value: unknown): string {
  const id = text(value); requireInput(id.length <= 256 && new TextEncoder().encode(id).length <= 256); return id;
}
function notPosted(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const required = ['code', 'requestId', 'outcome', 'name', 'message'];
  const fields: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(error)) {
    if (typeof key !== 'string' || ![...required, 'stack'].includes(key)) return false;
    const d = Object.getOwnPropertyDescriptor(error, key)!;
    // V8 may expose a lazy non-enumerable stack accessor. It is not proof framing.
    if (key === 'stack') { if (d.enumerable) return false; continue; }
    if (!Object.hasOwn(d, 'value')) return false;
    fields[key] = d.value;
  }
  return required.every(key => Object.hasOwn(fields, key)) && fields.name === 'WorkspaceWorkerError'
    && fields.outcome === 'not-posted' && fields.message === fields.code
    && (fields.requestId === null || safe(fields.requestId) && fields.requestId > 0)
    && ['invalid-request', 'worker-start-failed', 'worker-error', 'message-error', 'protocol-error', 'timeout',
      'post-failed', 'disposed', 'client-failed', 'counter-exhausted'].includes(fields.code as string);
}
function checkAuthority(authority: InstalledQueueAuthority, transport: QueueTransport, projectId: string) {
  const a = frame(authority, ['source', 'transport', 'binding', 'editorGenerationFloor']);
  requireInput(a.source !== null && typeof a.source === 'object' && a.transport === transport && safe(a.editorGenerationFloor));
  const b = frame(a.binding, ['type', 'scope', 'admissionId', 'authority']);
  requireInput(b.type === 'bootstrapped' && safe(b.admissionId) && b.admissionId > 0);
  const scope = frame(b.scope, ['storageGeneration', 'projectId', 'incarnation']);
  text(scope.storageGeneration); text(scope.incarnation); requireInput(scope.projectId === projectId);
  const stamp = frame(b.authority, ['documentRevision', 'preferenceRevision', 'foldStructureGeneration']);
  requireInput(Object.values(stamp).every(safe));
}
const tuple = (...parts: string[]) => parts.map(part => `${part.length}:${part}`).join('');
const preferenceFields = ['activeVariantId', 'selectedNodeId', 'selectedTemplateId', 'scale', 'viewMode', 'sidebarWidth',
  'propertiesPanelWidth', 'snapToGrid', 'showGrid', 'panelsExpanded'];
const failureCodes: Record<WorkspaceWorkerFailure['code'], true> = {
  'ingress-required': true, 'incarnation-changed': true, 'authority-changed': true, 'identity-mismatch': true,
  'proof-unavailable': true, 'verification-failed': true, 'cache-gap': true, 'stale-fold-generation': true,
  'preference-contention': true, 'quota-exceeded': true, 'clone-failed': true, 'storage-unavailable': true,
  'repository-failure': true, 'invalid-request': true, 'stale-admission': true,
};
function domainFailure(value: unknown): WorkspaceWorkerFailure {
  const f = frame(value, ['type', 'code', 'outcome', 'admission']);
  requireInput(f.type === 'failed' && typeof f.code === 'string' && Object.hasOwn(failureCodes, f.code)
    && (f.outcome === 'not-started' || f.outcome === 'unknown') && (f.admission === 'invalidated' || f.admission === 'none'));
  return Object.freeze(f) as WorkspaceWorkerFailure;
}
function barrierFailure(value: unknown): QueueFailure {
  const type = own(value, 'type');
  if (type === 'domain') {
    const f = frame(value, ['type', 'response']); return Object.freeze({ type, response: domainFailure(f.response) });
  }
  if (type === 'transport') return Object.freeze(frame(value, ['type', 'error'])) as QueueFailure;
  const f = frame(value, ['type', 'code'], ['cause']);
  const codes: Record<Code, true> = { 'missing-authority': true, 'source-changed': true, 'stale-generation': true,
    'invalid-input': true, 'invalid-response': true, 'counter-exhausted': true, 'fold-dependency': true,
    'barrier-active': true, 'retry-required': true, frozen: true, disposed: true };
  requireInput(type === 'queue' && typeof f.code === 'string' && Object.hasOwn(codes, f.code));
  return Object.freeze(f) as QueueFailure;
}
interface Dirty { key: string; change: DocumentChange; deleted: boolean; variantId?: string; template?: boolean }
function dirty(change: DocumentChange): Dirty {
  const type = own(change, 'type');
  let key: string;
  switch (type) {
    case 'put-node': frame(change, ['type', 'node']); key = tuple('node', recordId(own(own(change, 'node'), 'id'))); break;
    case 'delete-node': frame(change, ['type', 'nodeId']); key = tuple('node', recordId(own(change, 'nodeId'))); break;
    case 'put-variant': frame(change, ['type', 'variant']); key = tuple('variant', recordId(own(own(change, 'variant'), 'id'))); break;
    case 'delete-variant': frame(change, ['type', 'variantId']); key = tuple('variant', recordId(own(change, 'variantId'))); break;
    case 'put-template': frame(change, ['type', 'variantId', 'template']); key = tuple('template', recordId(own(change, 'variantId')), recordId(own(own(change, 'template'), 'id'))); break;
    case 'delete-template': frame(change, ['type', 'variantId', 'templateId']); key = tuple('template', recordId(own(change, 'variantId')), recordId(own(change, 'templateId'))); break;
    case 'set-root': frame(change, ['type', 'rootId']); recordId(own(change, 'rootId')); key = 'root'; break;
    case 'set-generator': frame(change, ['type', 'generator']); key = 'generator'; break;
    default: throw failure('invalid-input');
  }
  return { key, change, deleted: (type as string).startsWith('delete-') || type === 'set-generator' && own(change, 'generator') === undefined,
    ...(type === 'delete-variant' || type === 'put-template' || type === 'delete-template' ? { variantId: recordId(own(change, 'variantId')) } : {}),
    ...(type === 'put-template' || type === 'delete-template' ? { template: true } : {}) };
}
function basis(value: unknown): FoldBasis {
  const type = own(value, 'type'); const key = type === 'generation' ? 'generation' : 'editorGeneration';
  const f = frame(value, ['type', key]); requireInput(type === 'generation' || type === 'after-structural' || type === 'after-replacement'); requireInput(safe(f[key]));
  return Object.freeze(type === 'generation' ? { type, generation: f[key] as number } : { type, editorGeneration: f[key] as number });
}
const sameBasis = (a: FoldBasis, b: FoldBasis) => a.type === b.type && (a.type === 'generation'
  ? a.generation === (b as Extract<FoldBasis, { type: 'generation' }>).generation
  : a.editorGeneration === (b as Exclude<FoldBasis, { type: 'generation' }>).editorGeneration);
interface Deferred<T> { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void }
function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve']; let reject!: Deferred<T>['reject'];
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject };
}
function captureMetadata(value: unknown): ProjectMetadataEdit {
  const f = frame(value, ['kind'], ['name', 'cloud']);
  requireInput(f.kind === 'patch' || f.kind === 'linked-root');
  if (f.kind === 'linked-root') {
    frame(value, ['kind', 'name']); requireInput(typeof f.name === 'string');
    return Object.freeze({ kind: 'linked-root', name: f.name });
  }
  requireInput(Object.hasOwn(f, 'name') || Object.hasOwn(f, 'cloud'));
  if (Object.hasOwn(f, 'name')) requireInput(typeof f.name === 'string');
  let cloud: Extract<ProjectMetadataEdit, { kind: 'patch' }>['cloud'];
  if (Object.hasOwn(f, 'cloud')) {
    const c = frame(f.cloud, ['type'], ['value']);
    requireInput(c.type === 'set' || c.type === 'remove');
    frame(f.cloud, c.type === 'set' ? ['type', 'value'] : ['type']);
    if (c.type === 'set') requireInput(c.value !== null && typeof c.value === 'object' && !Array.isArray(c.value));
    cloud = Object.freeze(c.type === 'remove' ? { type: 'remove' } : { type: 'set', value: c.value as NonNullable<WorkspaceProject['cloud']> });
  }
  return Object.freeze({ kind: 'patch', ...(Object.hasOwn(f, 'name') ? { name: f.name as string } : {}), ...(cloud ? { cloud } : {}) });
}
interface Segment {
  order: number;
  lane: QueueAttempt['lane']; firstPendingAt: number; trailingAt: number; firstEditorGeneration: number; editorGeneration: number;
  changes: Map<object, Dirty>; live: Map<string, object>; tombstones: Map<string, object>; patch: ScalarPreferencePatch;
  structural?: QueueStructuralInput; folds?: QueueFoldInput; metadata?: ProjectMetadataEdit;
  replacement?: Omit<QueueReplacementInput, 'source'>;
  sealed: boolean; forced: boolean; waiters: Deferred<Ack>[];
  reservedIds?: readonly string[];
  receipts: QueueSubmissionReceipt[];
}
interface Project {
  authority: InstalledQueueAuthority;
  binding: BootstrapBinding; source: object; floor: number;
  acknowledged: { documentGeneration: number; preferenceGeneration: number; documentRevision: number;
    preferenceRevisionLowerBound: number; foldStructureGeneration: number };
  admitted: Record<QueueLane, number>; pending: Segment[];
  active?: { retained: RetainedAttempt; segment: Segment };
  dispatching?: Segment;
  blocked?: QueueFailure; timer?: unknown;
  structuralAcks: Map<number, DocumentSaveAck | BulkDocumentAck>; latestStructural?: DocumentSaveAck | BulkDocumentAck;
  latestReplacement?: BulkDocumentAck;
  documentReceipt?: DocumentCommitReceipt;
  held?: boolean; recoveredAcks: { attempt: QueueAttempt; ack: Ack; ids: readonly string[]; receipts: readonly QueueSubmissionReceipt[] }[];
  failed: Deferred<QueueFailure>;
}
interface FlushWaiter extends Deferred<void> { targets: { project: Project; document: number; preferences: number }[] }
interface RecoveryFlushWaiter extends Deferred<void> { projectIds: readonly string[] }
interface WorkspaceBarrierEntry {
  order: number; targets: Project[]; retireScopes: readonly ProjectScope[]; drain: Promise<void>;
  waiter: Deferred<unknown>; run: WorkspaceQueueBarrier<unknown>['run']; started: boolean;
}
const scopeKey = (scope: ProjectScope) => tuple(scope.storageGeneration, scope.projectId, scope.incarnation);
const trailing = (lane: QueueLane) => lane === 'document' ? 500 : 1000;
const maximum = (lane: QueueLane) => lane === 'document' ? 2000 : 5000;
const deadline = (s: Segment) => Math.min(s.trailingAt, s.firstPendingAt + maximum(laneOf(s.lane)));
function retainedSegment(s: Segment): RetainedSegment {
  const timing = { firstPendingAt: s.firstPendingAt, trailingAt: s.trailingAt,
    firstEditorGeneration: s.firstEditorGeneration, editorGeneration: s.editorGeneration };
  const retained = Object.freeze(s.lane === 'replacement' ? { ...timing, lane: 'replacement', replacement: s.replacement! } : s.lane === 'document'
    ? { ...timing, lane: 'document', changes: Object.freeze([...s.changes.values()].map(d => d.change)), ...(s.structural ? { structural: s.structural } : {}), ...(s.metadata ? { metadata: s.metadata } : {}) }
    : { ...timing, lane: 'preferences', patch: Object.freeze({ ...s.patch }), ...(s.folds ? { folds: s.folds } : {}) });
  segmentReceipts.set(retained, Object.freeze([...s.receipts])); return retained;
}
function mergeDirty(s: Segment, d: Dirty) {
  if (d.change.type === 'delete-variant') {
    for (const [slot, entry] of s.changes) if (entry.template && entry.variantId === d.variantId && !entry.deleted) {
      s.changes.delete(slot); s.live.delete(entry.key);
    }
  }
  const prior = s.live.get(d.key);
  if (d.deleted) {
    if (prior) { s.changes.delete(prior); s.live.delete(d.key); }
    const slot = s.tombstones.get(d.key) ?? {};
    s.tombstones.set(d.key, slot); s.changes.set(slot, d);
  } else {
    const slot = prior ?? {}; s.live.set(d.key, slot); s.changes.set(slot, d);
  }
}
const cut = (s: Segment) => !!(s.structural || s.folds || s.metadata || s.replacement);
const matchesDependency = (s: Segment, b: Exclude<FoldBasis, { type: 'generation' }>) => s.editorGeneration === b.editorGeneration
  && (b.type === 'after-replacement' ? s.lane === 'replacement' : !!s.structural);
const matchesDependencyAck = (ack: DocumentSaveAck | BulkDocumentAck | undefined, b: Exclude<FoldBasis, { type: 'generation' }>) =>
  ack?.editorGeneration === b.editorGeneration && (b.type === 'after-replacement' ? ack.type === 'document-replaced' : ack.type === 'document-saved');
function documentReceipt(attempt: QueueAttempt, ack: DocumentSaveAck): DocumentCommitReceipt {
  requireInput(attempt.lane === 'document');
  const { scope, clientId, commitGeneration, commitId, editorGeneration } = attempt.batch;
  return Object.freeze({ scope: Object.freeze({ ...scope }), identity: Object.freeze({ clientId, commitGeneration, commitId, editorGeneration, lane: 'document' }), ack });
}

/** Main-thread dirty scheduling only. Transport, installation and editor payloads are caller-owned. */
export function createIncrementalQueue(options: IncrementalQueueOptions): IncrementalQueue {
  const { transport, clock, uuid, resolveAuthority, onEvent, canCoalesceLayerTransfers } = options;
  let queueOwner = {};
  const recoveryCheckpoints = new WeakSet<RetainedQueueWork>();
  const recoveredProjects = new WeakMap<RetainedProjectWork, { project: Project; base: AuthorityStamp; represented: Set<QueueSubmissionReceipt> }>();
  let initialized: Promise<void> = Promise.resolve();
  let recovering: QueueRecoveryInput | undefined;
  let recoveryFramingError: QueueFailure | undefined;
  if (options.recovery !== undefined) {
    try {
      // Preserve only a genuine checkpoint if the rest of the supplied plan is malformed.
      const raw = options.recovery;
      const retained = raw && typeof raw === 'object' ? Object.getOwnPropertyDescriptor(raw, 'retained')?.value : undefined;
      if (checkpoints.has(retained)) { recovering = { retained, projects: [] }; queueOwner = checkpointOwners.get(retained)!; }
      const f = frame(raw, ['retained', 'projects']); requireInput(checkpoints.has(f.retained as RetainedQueueWork));
      recoveryCheckpoints.add(f.retained as RetainedQueueWork);
      const entries = array<unknown>(f.projects).map(value => {
        const item = frame(value, ['previous', 'authority', 'resolutions']);
        const previous = item.previous as RetainedProjectWork;
        requireInput(retained.projects.includes(previous));
        const resolutions = array<unknown>(item.resolutions).map(value => {
          const r = frame(value, ['attempt'], ['inspection', 'notPosted']);
          requireInput(Object.hasOwn(r, 'inspection') !== Object.hasOwn(r, 'notPosted'));
          const attempt = r.attempt as QueueAttempt;
          requireInput(previous.attempts.some(original => original.attempt === attempt));
          if (Object.hasOwn(r, 'notPosted')) return Object.freeze({ attempt, notPosted: r.notPosted as WorkspaceWorkerError });
          const inspection = frame(r.inspection, ['type', 'result']);
          requireInput(inspection.type === (attempt.lane === 'replacement' ? 'replacement-inspection' : 'commit-inspection'));
          const kind = own(inspection.result, 'type');
          const result = frame(inspection.result, kind === 'committed' ? ['type', 'ack'] : kind === 'conflict' ? ['type', 'reason'] : ['type']);
          requireInput(kind === 'committed' || kind === 'not-committed' || kind === 'conflict');
          if (kind === 'committed') result.ack = acknowledge(attempt, { type: responseType(attempt), ack: result.ack } as WorkspaceWorkerResponse);
          return Object.freeze({ attempt, inspection: Object.freeze({ type: inspection.type, result: Object.freeze(result) }) as InspectionResponse });
        });
        return Object.freeze({ previous, authority: item.authority as InstalledQueueAuthority, resolutions: Object.freeze(resolutions) });
      });
      recovering = Object.freeze({ retained, projects: Object.freeze(entries) });
    } catch (error) { recoveryFramingError = failure('retry-required', error); }
  }
  const recoveryFlushes = new Set<RecoveryFlushWaiter>();
  const projects = new Map<string, Project>(); const flushes = new Set<FlushWaiter>();
  const clientId = privateId(uuid()); let commitGeneration = 0;
  const ownedIds = new Map<string, number>([[clientId, 1]]);
  const reserve = (id: string) => ownedIds.set(id, (ownedIds.get(id) ?? 0) + 1);
  const releaseId = (id: string) => { const count = ownedIds.get(id)!; if (count > 1) ownedIds.set(id, count - 1); else ownedIds.delete(id); };
  let stopped: QueueFailure | undefined; let disposed = false; let checkpoint: RetainedQueueWork | undefined;
  let activeOperations = 0; const quietWaiters = new Set<Deferred<void>>();
  let barrierWaiter: Deferred<unknown> | undefined;
  let workspaceRecoveryHolds = 0;
  const workspaceBarriers: WorkspaceBarrierEntry[] = [];
  const retiringScopes = new Set<string>();
  let submissionOrder = 0;
  const nextOrder = () => { if (submissionOrder === Number.MAX_SAFE_INTEGER) throw failure('counter-exhausted'); return ++submissionOrder; };
  const retired = new WeakSet<InstalledQueueAuthority>();
  function emit(event: QueueEvent) { try { onEvent(event); } catch { /* Observers cannot change durable outcomes. */ } }
  function cancelTimer(p: Project) { if (p.timer !== undefined) clock.clearTimeout(p.timer); p.timer = undefined; }
  function snapshot(p: Project): RetainedProjectWork {
    const work = Object.freeze({ authority: p.authority, acknowledged: Object.freeze({ ...p.acknowledged }),
      ...(p.documentReceipt ? { documentReceipt: p.documentReceipt } : {}),
      pending: Object.freeze(p.pending.map(retainedSegment)), attempts: Object.freeze(p.active ? [p.active.retained] : []),
      structuralAcks: Object.freeze([...p.structuralAcks].map(([editorGeneration, ack]) => Object.freeze({ editorGeneration, ack }))) });
    // Retain installation reference for correlation, but authenticate recovery only
    // with admission-pinned facts. The caller may have since mutated that object.
    checkpointAuthorities.set(work, Object.freeze({ source: p.source, transport, binding: p.binding, editorGenerationFloor: p.floor }));
    return work;
  }
  function quiescence(): Promise<void> {
    if (!activeOperations) return Promise.resolve(); const d = deferred<void>(); quietWaiters.add(d); return d.promise;
  }
  function finishOperation() {
    activeOperations--;
    if (!activeOperations) for (const d of quietWaiters) { quietWaiters.delete(d); d.resolve(); }
  }
  function settleFlushes() {
    for (const waiter of flushes) {
      const error = stopped ?? waiter.targets.find(t => t.project.blocked)?.project.blocked;
      if (error) { flushes.delete(waiter); waiter.reject(error); }
      else if (waiter.targets.every(t => t.project.acknowledged.documentGeneration >= t.document
        && t.project.acknowledged.preferenceGeneration >= t.preferences)) { flushes.delete(waiter); waiter.resolve(); }
    }
  }
  function rejectWaiters(p: Project, error: QueueFailure) {
    for (const s of [...p.pending, ...(p.active ? [p.active.segment] : [])]) {
      for (const d of s.waiters) d.reject(error); s.waiters = [];
    }
  }
  function block(p: Project, error: QueueFailure) {
    p.blocked = error; p.failed.resolve(error); cancelTimer(p); rejectWaiters(p, error); settleFlushes();
    emit({ type: 'project-blocked', failure: error, work: snapshot(p) });
  }
  function stop(error: QueueFailure): RetainedQueueWork {
    if (!stopped) {
      stopped = error;
      barrierWaiter?.reject(error);
      for (const entry of workspaceBarriers.splice(0)) entry.waiter.reject(error);
      for (const waiter of recoveryFlushes) { recoveryFlushes.delete(waiter); waiter.reject(error); }
      for (const p of projects.values()) { p.failed.resolve(error); cancelTimer(p); rejectWaiters(p, error); }
      settleFlushes();
      checkpoint = Object.freeze({ projects: recovering ? recovering.retained.projects : Object.freeze([...projects.values()].map(snapshot)),
        whenQuiescent: recovering ? Promise.all([recovering.retained.whenQuiescent, quiescence()]).then(() => {}) : quiescence() });
      checkpoints.add(checkpoint);
      checkpointOwners.set(checkpoint, recovering ? checkpointOwners.get(recovering.retained)! : queueOwner);
      emit({ type: 'frozen', failure: error, work: checkpoint });
    }
    return checkpoint!;
  }
  function pinnedInstallation(p: Project) {
    try {
      checkAuthority(p.authority, transport, p.binding.scope.projectId);
      const current = p.authority.binding;
      if (p.authority.source !== p.source || p.authority.editorGenerationFloor !== p.floor
        || current.admissionId !== p.binding.admissionId
        || current.scope.storageGeneration !== p.binding.scope.storageGeneration || current.scope.incarnation !== p.binding.scope.incarnation
        || current.authority.documentRevision !== p.binding.authority.documentRevision
        || current.authority.preferenceRevision !== p.binding.authority.preferenceRevision
        || current.authority.foldStructureGeneration !== p.binding.authority.foldStructureGeneration) throw failure('source-changed');
    } catch { throw failure('source-changed'); }
  }
  function installed(p: Project, generation: number, lane: QueueLane) {
    pinnedInstallation(p);
    try { if (resolveAuthority(p.binding.scope.projectId, generation, lane) !== p.authority) throw failure('source-changed'); }
    catch { throw failure('source-changed'); }
    pinnedInstallation(p);
  }
  function newProject(authority: InstalledQueueAuthority): Project {
    const stamp = authority.binding.authority;
    const binding: BootstrapBinding = Object.freeze({ ...authority.binding, scope: Object.freeze({ ...authority.binding.scope }), authority: Object.freeze({ ...stamp }) });
    return { authority, binding, source: authority.source, floor: authority.editorGenerationFloor,
      admitted: { document: authority.editorGenerationFloor, preferences: authority.editorGenerationFloor },
      acknowledged: { documentGeneration: authority.editorGenerationFloor, preferenceGeneration: authority.editorGenerationFloor,
        documentRevision: stamp.documentRevision, preferenceRevisionLowerBound: stamp.preferenceRevision, foldStructureGeneration: stamp.foldStructureGeneration },
      pending: [], structuralAcks: new Map(), recoveredAcks: [], failed: deferred<QueueFailure>() };
  }
  function admit(projectId: string, generation: number, lane: QueueLane): Project {
    if (disposed) throw failure('disposed'); if (stopped) throw stopped;
    if (workspaceRecoveryHolds) throw failure('retry-required');
    if (barrierWaiter) throw failure('barrier-active');
    if (recovering) throw failure('retry-required');
    requireInput(safe(generation));
    const existing = projects.get(projectId);
    if (existing?.blocked) throw existing.blocked;
    if (existing?.held) throw failure('retry-required');
    if (existing && generation <= existing.admitted[lane]) throw failure('stale-generation');
    const authority = resolveAuthority(projectId, generation, lane);
    if (!authority) throw failure('missing-authority');
    checkAuthority(authority, transport, projectId);
    if (retired.has(authority) || retiringScopes.has(scopeKey(authority.binding.scope))) throw failure('source-changed');
    if (generation <= authority.editorGenerationFloor) throw failure('stale-generation');
    if (existing) { if (authority !== existing.authority) throw failure('source-changed'); installed(existing, generation, lane); return existing; }
    return newProject(authority);
  }
  function checkBasis(p: Project, b: FoldBasis) {
    if (b.type === 'generation') {
      if (b.generation !== p.acknowledged.foldStructureGeneration) throw failure('fold-dependency');
    } else if (!p.pending.some(s => matchesDependency(s, b))
      && !(p.active && matchesDependency(p.active.segment, b))
      && !matchesDependencyAck(p.structuralAcks.get(b.editorGeneration), b) && !matchesDependencyAck(p.latestStructural, b)) throw failure('fold-dependency');
  }
  function releaseAcks(p: Project) {
    const needed = new Set<number>();
    if (p.latestReplacement) needed.add(p.latestReplacement.editorGeneration);
    for (const s of [...p.pending, ...(p.active ? [p.active.segment] : [])]) {
      const b = s.structural?.basis ?? s.folds?.basis;
      if (b && b.type !== 'generation') needed.add(b.editorGeneration);
    }
    for (const g of p.structuralAcks.keys()) if (!needed.has(g)) p.structuralAcks.delete(g);
    if (p.latestStructural && needed.has(p.latestStructural.editorGeneration)) p.structuralAcks.set(p.latestStructural.editorGeneration, p.latestStructural);
  }
  function enqueue(projectId: string, generation: number, lane: QueueLane, input: unknown): Promise<Ack> {
    try {
      const p = admit(projectId, generation, lane);
      const rich = lane === 'document' ? !Array.isArray(input) : !!input && typeof input === 'object' && Object.hasOwn(input, 'patch');
      let payload = input;
      let structural: QueueStructuralInput | undefined; let folds: QueueFoldInput | undefined; let metadata: ProjectMetadataEdit | undefined;
      if (rich) {
        if (own(input, 'source') !== p.authority.source) throw failure('source-changed');
        const f = frame(input, ['source', lane === 'document' ? 'changes' : 'patch'], lane === 'document' ? ['structural', 'metadata'] : ['folds']);
        payload = f[lane === 'document' ? 'changes' : 'patch'];
        if (Object.hasOwn(f, 'metadata')) metadata = captureMetadata(f.metadata);
        if (Object.hasOwn(f, 'structural')) {
          const st = frame(f.structural, ['basis', 'mappings']); requireInput(Array.isArray(st.mappings));
          structural = Object.freeze({ basis: basis(st.basis), mappings: st.mappings as readonly LayerMapping[] }); checkBasis(p, structural.basis);
        }
        if (Object.hasOwn(f, 'folds')) {
          const fl = frame(f.folds, ['basis', 'updates']); const b = basis(fl.basis); checkBasis(p, b);
          const updates = array<QueueFoldInput['updates'][number]>(fl.updates);
          for (const update of updates) {
            const u = frame(update, ['occurrence', 'collapsed']); const o = frame(u.occurrence, ['variantId', 'templateId', 'position']);
            recordId(o.variantId); recordId(o.templateId); requireInput(safe(o.position) && typeof u.collapsed === 'boolean');
          }
          folds = Object.freeze({ basis: b, updates: Object.freeze(updates) });
        }
      }
      const changes = lane === 'document' ? array<DocumentChange>(payload).map(dirty) : [];
      const patch = lane === 'preferences' ? frame(payload, [], preferenceFields) as ScalarPreferencePatch : {};
      requireInput(lane === 'document' ? changes.length > 0 || metadata?.kind === 'patch' : Object.keys(patch).length > 0 || !!folds?.updates.length);
      if (metadata?.kind === 'patch') requireInput(changes.length === 0 && !structural);
      const previous = p.pending[p.pending.length - 1];
      // The store-owned proof reader is a callback: run it before the existing
      // reentrancy/lifecycle fence, and require the same candidate afterward.
      const preservesLayers = lane === 'document' && structural && !metadata && previous?.lane === 'document'
        && previous.structural && !previous.forced && !previous.metadata && !previous.folds
        && sameBasis(previous.structural.basis, structural.basis)
        && canCoalesceLayerTransfers?.(previous.structural.mappings, [...previous.changes.values()].map(value => value.change),
          structural.mappings, changes.map(value => value.change));
      const now = clock.now(); requireInput(Number.isFinite(now));
      // Resolution, payload framing and the injected clock can reenter admission.
      // No public/caller callbacks occur between this fence and segment publication.
      if (disposed) throw failure('disposed'); if (stopped) throw stopped;
      if (barrierWaiter) throw failure('barrier-active');
      if (recovering || p.held || workspaceRecoveryHolds) throw failure('retry-required'); if (p.blocked) throw p.blocked;
      pinnedInstallation(p);
      const current = projects.get(projectId);
      if (current && current !== p || retired.has(p.authority) || retiringScopes.has(scopeKey(p.binding.scope))) throw failure('source-changed');
      if (generation <= p.admitted[lane]) throw failure('stale-generation');
      const last = p.pending[p.pending.length - 1];
      let s = !metadata && (structural || folds) ? last?.lane === lane && !last.sealed && !last.structural && !last.metadata
        && (!last.folds || folds && sameBasis(last.folds.basis, folds.basis)) ? last : undefined
        : undefined;
      if (!s && preservesLayers && last === previous && !last.forced) s = last;
      if (!structural && !folds && !metadata) for (let i = p.pending.length - 1; i >= 0; i--) {
        const item = p.pending[i];
        if (item.lane === lane && !item.sealed && !cut(item)) { s = item; break; }
      }
      if (structural || folds || metadata) for (const item of p.pending) if (item !== s) item.sealed = true;
      if (!s) {
        s = { order: nextOrder(), lane, firstPendingAt: now, trailingAt: now + trailing(lane), firstEditorGeneration: generation,
          editorGeneration: generation, changes: new Map(), live: new Map(), tombstones: new Map(), patch: {}, sealed: false, forced: false, waiters: [], receipts: [] };
        p.pending.push(s);
      }
      for (const d of changes) mergeDirty(s, d);
      if (metadata) { s.metadata = metadata; s.sealed = true; }
      if (structural) { s.structural = structural; s.sealed = true; }
      if (folds) {
        const updates = new Map<string, QueueFoldInput['updates'][number]>();
        for (const u of [...(s.folds?.updates ?? []), ...folds.updates]) updates.set(tuple(u.occurrence.variantId, u.occurrence.templateId, String(u.occurrence.position)), u);
        s.folds = Object.freeze({ basis: folds.basis, updates: Object.freeze([...updates.values()]) });
      }
      Object.assign(s.patch, patch); s.editorGeneration = generation; s.trailingAt = now + trailing(lane);
      const d = deferred<Ack>(), receipt = Object.freeze({}) as QueueSubmissionReceipt;
      submissionProofs.set(receipt, { source: p.source, scope: p.binding.scope, lane, generation, family: queueOwner, completion: deferred<Ack>() });
      promiseReceipts.set(d.promise, receipt); s.receipts.push(receipt);
      s.waiters.push(d); p.admitted[lane] = generation; projects.set(projectId, p); releaseAcks(p); pump(p); return d.promise;
    } catch (error) { return Promise.reject(error); }
  }
  function enqueueReplacement(projectId: string, generation: number, input: QueueReplacementInput): Promise<BulkDocumentAck> {
    try {
      const p = admit(projectId, generation, 'document');
      if (generation <= p.admitted.preferences) throw failure('stale-generation');
      if (own(input, 'source') !== p.source) throw failure('source-changed');
      const f = frame(input, ['source', 'state', 'preferences'], ['metadata']);
      const metadata = Object.hasOwn(f, 'metadata') ? captureMetadata(f.metadata) : undefined;
      if (metadata) requireInput(metadata.kind === 'linked-root');
      // Immutable editor payloads stay caller-owned until the explicit bulk transfer.
      // Do not enumerate the graph in this main-thread scheduler.
      const replacement = Object.freeze({ state: f.state as BulkDocumentBatch['state'], preferences: f.preferences as EditorPreferences,
        ...(metadata?.kind === 'linked-root' ? { metadata } : {}) });
      const now = clock.now(); requireInput(Number.isFinite(now));
      if (disposed) throw failure('disposed'); if (stopped) throw stopped;
      if (barrierWaiter) throw failure('barrier-active');
      if (recovering || p.held || workspaceRecoveryHolds) throw failure('retry-required'); if (p.blocked) throw p.blocked;
      pinnedInstallation(p);
      const current = projects.get(projectId);
      if (current && current !== p || retired.has(p.authority) || retiringScopes.has(scopeKey(p.binding.scope))) throw failure('source-changed');
      if (generation <= p.admitted.document || generation <= p.admitted.preferences) throw failure('stale-generation');
      const s: Segment = { order: nextOrder(), lane: 'replacement', firstPendingAt: now, trailingAt: now,
        firstEditorGeneration: generation, editorGeneration: generation, replacement,
        changes: new Map(), live: new Map(), tombstones: new Map(), patch: {}, sealed: true, forced: true, waiters: [], receipts: [] };
      const d = deferred<Ack>(), receipt = Object.freeze({}) as QueueSubmissionReceipt;
      submissionProofs.set(receipt, { source: p.source, scope: p.binding.scope, lane: 'document', generation, family: queueOwner, completion: deferred<Ack>() });
      promiseReceipts.set(d.promise, receipt); s.receipts.push(receipt); s.waiters.push(d);
      for (const previous of p.pending) { previous.sealed = true; previous.forced = true; }
      p.pending.push(s); p.admitted.document = generation; p.admitted.preferences = generation;
      projects.set(projectId, p); releaseAcks(p); pump(p); return d.promise as Promise<BulkDocumentAck>;
    } catch (error) { return Promise.reject(error); }
  }
  function acknowledge(attempt: QueueAttempt, response: WorkspaceWorkerResponse): Ack {
    try {
      const batch = attempt.batch;
      const expected = responseType(attempt);
      const r = frame(response, ['type', 'ack']); requireInput(r.type === expected);
      if (attempt.lane === 'replacement') {
        const a = frame(r.ack, ['type', 'projectId', 'incarnation', 'commitId', 'editorGeneration', 'authority', 'boundaryDigest']);
        requireInput(a.type === 'document-replaced' && a.projectId === batch.scope.projectId && a.incarnation === batch.scope.incarnation
          && a.commitId === batch.commitId && a.editorGeneration === batch.editorGeneration && typeof a.boundaryDigest === 'string'
          && /^[a-f0-9]{64}$/.test(a.boundaryDigest));
        const stamp = frame(a.authority, ['documentRevision', 'preferenceRevision', 'foldStructureGeneration']);
        for (const key of ['documentRevision', 'preferenceRevision', 'foldStructureGeneration'] as const) {
          requireInput(safe(stamp[key]) && attempt.batch.expected[key] < Number.MAX_SAFE_INTEGER && stamp[key] === attempt.batch.expected[key] + 1);
        }
        return Object.freeze({ ...a, authority: Object.freeze(stamp) }) as unknown as BulkDocumentAck;
      }
      const field = attempt.lane === 'document' ? 'revision' : 'preferenceRevision';
      const a = frame(r.ack, ['type', 'projectId', 'incarnation', 'commitId', 'editorGeneration', 'foldStructureGeneration', field]);
      requireInput(a.type === (attempt.lane === 'document' ? 'document-saved' : 'preferences-saved')
        && a.projectId === batch.scope.projectId && a.incarnation === batch.scope.incarnation && a.commitId === batch.commitId
        && a.editorGeneration === batch.editorGeneration && safe(a.foldStructureGeneration) && safe(a[field]));
      requireInput(attempt.lane === 'document' ? a[field] === attempt.batch.expectedRevision + 1 : (a[field] as number) > attempt.batch.observedPreferenceRevision);
      const fold = attempt.lane === 'document' ? attempt.batch.structural : attempt.batch.folds;
      if (fold) requireInput(a.foldStructureGeneration === fold.expectedFoldStructureGeneration
        || attempt.lane === 'document' && fold.expectedFoldStructureGeneration < Number.MAX_SAFE_INTEGER && a.foldStructureGeneration === fold.expectedFoldStructureGeneration + 1);
      return Object.freeze(a) as unknown as Ack;
    } catch { throw failure('invalid-response'); }
  }
  function dispatch(p: Project, s: Segment) {
    const eligible = () => !stopped && !p.blocked && !p.active && !p.held && !recovering && !workspaceRecoveryHolds
      && p.pending.includes(s) && (!workspaceBarriers.length || s.order < workspaceBarriers[0].order);
    if (p.dispatching || !eligible()) return;
    // Keep the unposted segment in pending recovery, but reserve it before any
    // injected resolver/identity callback can synchronously pump another cut.
    p.dispatching = s; s.sealed = true; activeOperations++;
    let handedOff = false;
    void (async () => {
    try {
      installed(p, s.editorGeneration, laneOf(s.lane));
      if (!eligible()) return;
      let exact: AuthorityStamp | undefined;
      if (s.lane === 'replacement') {
        let response: WorkspaceWorkerResponse;
        try { response = await transport.request({ type: 'project-cut-authority', admissionId: p.binding.admissionId, scope: p.binding.scope }); }
        catch (error) { if (!stopped) stop({ type: 'transport', error }); return; }
        if (!eligible()) return;
        installed(p, s.editorGeneration, 'document'); if (!eligible()) return;
        if (own(response, 'type') === 'failed') { block(p, { type: 'domain', response: domainFailure(response) }); return; }
        try {
          const r = frame(response, ['type', 'scope', 'admissionId', 'authority']);
          requireInput(r.type === 'project-cut-authority-result' && r.admissionId === p.binding.admissionId);
          const scope = frame(r.scope, ['storageGeneration', 'projectId', 'incarnation']);
          requireInput(Object.keys(scope).every(key => scope[key] === Reflect.get(p.binding.scope, key)));
          const stamp = frame(r.authority, ['documentRevision', 'preferenceRevision', 'foldStructureGeneration']);
          requireInput(Object.values(stamp).every(safe) && stamp.documentRevision === p.acknowledged.documentRevision
            && stamp.foldStructureGeneration === p.acknowledged.foldStructureGeneration
            && (stamp.preferenceRevision as number) >= p.acknowledged.preferenceRevisionLowerBound);
          exact = Object.freeze(stamp) as unknown as AuthorityStamp;
        } catch (error) { stop(failure('invalid-response', error)); return; }
        if (Object.values(exact).some(value => value === Number.MAX_SAFE_INTEGER)) throw failure('counter-exhausted');
      }
      if (commitGeneration === Number.MAX_SAFE_INTEGER || (s.lane !== 'preferences' ? p.acknowledged.documentRevision : p.acknowledged.preferenceRevisionLowerBound) === Number.MAX_SAFE_INTEGER) throw failure('counter-exhausted');
      const commitId = privateId(uuid()); requireInput(!ownedIds.has(commitId));
      if (!eligible()) return;
      pinnedInstallation(p);
      if (p.dispatching !== s || projects.get(p.binding.scope.projectId) !== p) throw failure('source-changed');
      if (commitGeneration === Number.MAX_SAFE_INTEGER) throw failure('counter-exhausted');
      const segment = retainedSegment(s);
      const b = s.structural?.basis ?? s.folds?.basis;
      const dependency = b && b.type !== 'generation' ? p.structuralAcks.get(b.editorGeneration)
        ?? (p.latestStructural?.editorGeneration === b.editorGeneration ? p.latestStructural : undefined) : undefined;
      const foldGeneration = b?.type === 'generation' ? b.generation : b
        ? dependency && foldOf(dependency) : undefined;
      if (b && (foldGeneration === undefined || foldGeneration !== p.acknowledged.foldStructureGeneration)) throw failure('fold-dependency');
      const common = { scope: p.binding.scope, clientId, commitId, commitGeneration: ++commitGeneration, editorGeneration: s.editorGeneration };
      const attempt: QueueAttempt = segment.lane === 'replacement'
        ? { lane: 'replacement', batch: Object.freeze({ ...common, expected: exact!, ...segment.replacement }) }
        : segment.lane === 'document'
        ? { lane: 'document', batch: Object.freeze({ ...common, expectedRevision: p.acknowledged.documentRevision, changes: segment.changes,
          ...(s.structural ? { structural: Object.freeze({ expectedFoldStructureGeneration: foldGeneration!, mappings: s.structural.mappings }) } : {}),
          ...(s.metadata ? { metadata: s.metadata } : {}) }) }
        : { lane: 'preferences', batch: Object.freeze({ ...common, observedPreferenceRevision: p.acknowledged.preferenceRevisionLowerBound, patch: segment.patch,
          ...(s.folds ? { folds: Object.freeze({ expectedFoldStructureGeneration: foldGeneration!, updates: s.folds.updates }) } : {}) }) };
      Object.freeze(attempt);
      reserve(commitId);
      const index = p.pending.indexOf(s); requireInput(index >= 0);
      p.pending.splice(index, 1);
      const active = { segment: s, retained: Object.freeze({ attempt, segment }) as RetainedAttempt }; p.active = active;
      const request: WorkspaceWorkerRequest = attempt.lane === 'replacement'
        ? { type: 'replace-document', admissionId: p.binding.admissionId, batch: attempt.batch }
        : attempt.lane === 'document'
        ? attempt.batch.structural ? { type: 'structural-command', admissionId: p.binding.admissionId,
          command: { type: 'occurrence-edit', batch: attempt.batch as DocumentBatch & { structural: NonNullable<DocumentBatch['structural']> } } }
          : { type: 'document-batch', admissionId: p.binding.admissionId, batch: attempt.batch }
        : { type: 'preferences', admissionId: p.binding.admissionId, batch: attempt.batch };
      p.dispatching = undefined; handedOff = true;
      const reject = (error: unknown) => {
        // Establish absence evidence at rejection time, never from later mutation.
        if (notPosted(error)) capturedRejections.set(attempt, error);
        active.retained = Object.freeze({ ...active.retained, failure: { type: 'transport', error } as QueueFailure });
        if (!stopped) stop({ type: 'transport', error });
      };
      let promise: Promise<WorkspaceWorkerResponse>;
      try { promise = transport.request(request); } catch (error) { reject(error); finishOperation(); return; }
      const currentAttempt = () => !stopped && !p.blocked && p.active === active;
      void Promise.resolve(promise).then(response => {
        if (!currentAttempt()) return;
        try {
          installed(p, s.editorGeneration, laneOf(s.lane));
          if (!currentAttempt()) return;
          if (own(response, 'type') === 'failed') {
            const error: QueueFailure = { type: 'domain', response: domainFailure(response) };
            if (!currentAttempt()) return;
            active.retained = Object.freeze({ ...active.retained, failure: error }); block(p, error); return;
          }
          const ack = acknowledge(attempt, response);
          pinnedInstallation(p); if (!currentAttempt()) return;
          settleReceipts(s.receipts, ack); s.receipts = [];
          if (ack.type === 'document-replaced') {
            p.documentReceipt = undefined;
            p.acknowledged.documentRevision = ack.authority.documentRevision; p.acknowledged.preferenceRevisionLowerBound = ack.authority.preferenceRevision;
            p.acknowledged.documentGeneration = ack.editorGeneration; p.acknowledged.preferenceGeneration = ack.editorGeneration;
          } else if (ack.type === 'document-saved') {
            p.documentReceipt = documentReceipt(attempt, ack);
            p.acknowledged.documentRevision = ack.revision; p.acknowledged.documentGeneration = ack.editorGeneration;
          }
          else { p.acknowledged.preferenceRevisionLowerBound = ack.preferenceRevision; p.acknowledged.preferenceGeneration = ack.editorGeneration; }
          p.acknowledged.foldStructureGeneration = foldOf(ack); p.active = undefined;
          releaseId(commitId); for (const id of s.reservedIds ?? []) releaseId(id); s.reservedIds = undefined;
          if (s.structural && ack.type === 'document-saved' || ack.type === 'document-replaced') { p.latestStructural = ack; p.structuralAcks.set(ack.editorGeneration, ack); }
          if (ack.type === 'document-replaced') p.latestReplacement = ack;
          releaseAcks(p);
          for (const d of s.waiters) d.resolve(ack); s.waiters = []; settleFlushes();
          emit({ type: 'acknowledged', authority: p.authority, attempt, ack });
        } catch (error) {
          if (!currentAttempt()) return;
          if ((error as QueueFailure).type === 'queue' && (error as { code: string }).code === 'source-changed') block(p, error as QueueFailure);
          else stop(failure('invalid-response', error));
        }
      }, reject).then(() => { finishOperation(); pump(p); });
    } catch (error) { if (!stopped) block(p, error as QueueFailure); }
    finally { if (p.dispatching === s) p.dispatching = undefined; if (!handedOff) finishOperation(); }
    })();
  }
  function pump(p: Project) {
    cancelTimer(p); if (stopped || p.blocked || p.active || p.dispatching || p.held || recovering || workspaceRecoveryHolds) return;
    const heads = (['document', 'preferences', 'replacement'] as const).flatMap(lane => {
      const s = p.pending.find(item => item.lane === lane);
      if (!s) return [];
      if (workspaceBarriers.length && s.order > workspaceBarriers[0].order) return [];
      const index = p.pending.indexOf(s);
      if (index > 0 && (cut(s) || p.pending.slice(0, index).some(cut))) return [];
      if (p.pending.slice(index + 1).some(cut)) s.forced = true;
      return [s];
    });
    if (!heads.length) return;
    heads.sort((a, b) => Number(b.forced) - Number(a.forced) || deadline(a) - deadline(b) || (a.lane === 'document' ? -1 : 1));
    const s = heads[0]; const delay = s.forced ? 0 : deadline(s) - clock.now();
    if (delay <= 0) dispatch(p, s);
    else p.timer = clock.setTimeout(() => { p.timer = undefined; pump(p); }, delay);
  }
  function flush(projectId?: string): Promise<void> {
    if (disposed) return Promise.reject(failure('disposed')); if (stopped) return Promise.reject(stopped);
    if (workspaceRecoveryHolds) return Promise.reject(failure('retry-required'));
    if (recovering) {
      const ids = recovering.projects.map(p => checkpointAuthorities.get(p.previous)!.binding.scope.projectId)
        .filter(id => projectId === undefined || id === projectId);
      const waiter: RecoveryFlushWaiter = { ...deferred<void>(), projectIds: ids };
      recoveryFlushes.add(waiter); return waiter.promise;
    }
    const selected = [...projects.values()].filter(p => projectId === undefined || p.binding.scope.projectId === projectId);
    return flushSelected(selected);
  }
  function flushSelected(selected: Project[]): Promise<void> {
    if (disposed) return Promise.reject(failure('disposed')); if (stopped) return Promise.reject(stopped);
    const waiter = captureFlush(selected);
    activateSelected(selected); return waiter.promise;
  }
  function captureFlush(selected: Project[], completion: Deferred<void> = deferred<void>()): FlushWaiter {
    // No external calls here: all overlapping recovery captures must be registered
    // and their segments sealed/forced before activation can reenter the queue.
    const waiter: FlushWaiter = { ...completion, targets: selected.map(project => ({ project, ...project.admitted })) };
    flushes.add(waiter);
    for (const p of selected) for (const s of p.pending) { s.sealed = true; s.forced = true; }
    return waiter;
  }
  function activateSelected(selected: Project[]) {
    if (workspaceRecoveryHolds) return;
    const publications: { project: Project; items: Project['recoveredAcks'] }[] = [];
    for (const p of selected) if (p.held) {
      try { installed(p, Math.max(p.admitted.document, p.admitted.preferences), 'document'); }
      catch { block(p, failure('source-changed')); continue; }
      p.held = false;
      const acknowledgements = p.recoveredAcks; p.recoveredAcks = [];
      publications.push({ project: p, items: acknowledgements });
    }
    settleFlushes();
    for (const { project, items } of publications) {
      for (const item of items) {
        for (const id of item.ids) releaseId(id);
        if (stopped || project.blocked) continue;
        // Earlier observers may replace another selected installation. Historical
        // coverage stays settled, but each live publication needs its own fence.
        try { installed(project, item.attempt.batch.editorGeneration, laneOf(item.attempt.lane)); }
        catch { block(project, failure('source-changed')); continue; }
        if (!stopped && !project.blocked) emit({ type: 'acknowledged', authority: project.authority, attempt: item.attempt, ack: item.ack });
      }
    }
    for (const p of selected) pump(p);
  }
  function barrier<T>(operation: QueueBarrierOperation<T>): Promise<T> {
    if (disposed) return Promise.reject(failure('disposed')); if (stopped) return Promise.reject(stopped);
    if (workspaceRecoveryHolds) return Promise.reject(failure('retry-required'));
    if (barrierWaiter || workspaceBarriers.length) return Promise.reject(failure('barrier-active'));
    if (recovering || [...projects.values()].some(p => p.held)) return Promise.reject(failure('retry-required'));
    let kind: QueueBarrierOperation<T>['kind']; let run: QueueBarrierOperation<T>['run'];
    let targets: { authority: InstalledQueueAuthority; projectId: string }[];
    try {
      const f = frame(operation, ['kind', 'targets', 'run']);
      requireInput(['drain', 'close', 'replace'].includes(f.kind as string) && typeof f.run === 'function');
      kind = f.kind as typeof kind; run = f.run as typeof run;
      targets = array<InstalledQueueAuthority>(f.targets).map(authority => {
        const projectId = text(own(own(own(authority, 'binding'), 'scope'), 'projectId'));
        checkAuthority(authority, transport, projectId); return { authority, projectId };
      });
    } catch (error) { return Promise.reject(error); }
    const waiter = deferred<T>(); barrierWaiter = waiter as Deferred<unknown>;
    const release = () => { if (barrierWaiter === waiter) barrierWaiter = undefined; };
    void flush().then(async () => {
      await quiescence(); if (stopped) throw stopped;
      for (const { authority: a, projectId } of targets) {
        checkAuthority(a, transport, projectId);
        const p = projects.get(projectId);
        if (p) installed(p, Math.max(p.admitted.document, p.admitted.preferences), 'document');
        if (retired.has(a) || resolveAuthority(projectId,
          Math.max(a.editorGenerationFloor + 1, p?.admitted.document ?? 0, p?.admitted.preferences ?? 0), 'document') !== a) throw failure('source-changed');
      }
      if (kind !== 'drain') for (const { authority } of targets) retired.add(authority);
      activeOperations++;
      try {
        let outcome: QueueBarrierOutcome<T>;
        try { outcome = await run.call(operation); } catch (error) { stop({ type: 'transport', error }); throw stopped; }
        if (stopped) throw stopped;
        try {
          const type = own(outcome, 'type'); requireInput(type === 'completed' || type === 'failed');
          outcome = frame(outcome, type === 'completed' ? ['type', 'value'] : ['type', 'failure']) as QueueBarrierOutcome<T>;
          if (outcome.type === 'failed') outcome = { type: 'failed', failure: barrierFailure(outcome.failure) };
        } catch (error) { stop(failure('invalid-response', error)); throw stopped; }
        if (outcome.type === 'failed') {
          if (outcome.failure.type === 'transport') stop(outcome.failure);
          else for (const { projectId } of targets) { const p = projects.get(projectId); if (p) block(p, outcome.failure); }
          throw outcome.failure;
        }
        requireInput(outcome.type === 'completed');
        if (kind !== 'drain') for (const { projectId } of targets) projects.delete(projectId);
        release(); waiter.resolve(outcome.value);
      } finally { finishOperation(); }
    }).catch(error => { release(); waiter.reject(error); });
    return waiter.promise;
  }
  function advanceWorkspaceBarrier() {
    const entry = workspaceBarriers[0]; if (!entry || entry.started || stopped) return;
    entry.started = true;
    void entry.drain.then(async () => {
      await quiescence(); if (stopped) throw stopped;
      const targets = entry.targets.map(p => {
        installed(p, Math.max(p.floor + 1, p.admitted.document, p.admitted.preferences), 'document');
        if (projects.get(p.binding.scope.projectId) !== p) throw failure('source-changed');
        return Object.freeze({ authority: p.authority, stamp: Object.freeze({ documentRevision: p.acknowledged.documentRevision,
          preferenceRevision: p.acknowledged.preferenceRevisionLowerBound, foldStructureGeneration: p.acknowledged.foldStructureGeneration }) });
      });
      // Later resolvers may invalidate targets checked earlier. No resolver calls
      // are allowed in this final pass immediately before command execution.
      for (const p of entry.targets) {
        pinnedInstallation(p);
        if (projects.get(p.binding.scope.projectId) !== p) throw failure('source-changed');
      }
      if (stopped) throw stopped;
      activeOperations++;
      try {
        let outcome: QueueBarrierOutcome<unknown>;
        try { outcome = await entry.run(Object.freeze({ targets: Object.freeze(targets) })); }
        catch (error) { stop({ type: 'transport', error }); throw stopped; }
        if (stopped) throw stopped;
        try {
          const type = own(outcome, 'type'); requireInput(type === 'completed' || type === 'failed');
          outcome = frame(outcome, type === 'completed' ? ['type', 'value'] : ['type', 'failure']) as QueueBarrierOutcome<unknown>;
          if (outcome.type === 'failed') outcome = { type: 'failed', failure: barrierFailure(outcome.failure) };
        } catch (error) { stop(failure('invalid-response', error)); throw stopped; }
        if (outcome.type === 'failed') { stop(outcome.failure); throw stopped; }
        for (const scope of entry.retireScopes) {
          const p = projects.get(scope.projectId);
          if (p && scopeKey(p.binding.scope) === scopeKey(scope)) { retired.add(p.authority); projects.delete(scope.projectId); }
          retiringScopes.delete(scopeKey(scope));
        }
        workspaceBarriers.shift(); entry.waiter.resolve(outcome.value);
      } finally { finishOperation(); }
    }).catch(error => { if (!stopped) stop(error as QueueFailure); entry.waiter.reject(stopped); })
      .then(() => { if (!stopped) { for (const p of projects.values()) pump(p); advanceWorkspaceBarrier(); } });
  }
  function workspaceBarrier<T>(operation: WorkspaceQueueBarrier<T>): Promise<T> {
    try {
      if (disposed) throw failure('disposed'); if (stopped) throw stopped;
      if (workspaceRecoveryHolds) throw failure('retry-required');
      if (barrierWaiter) throw failure('barrier-active');
      if (recovering || [...projects.values()].some(p => p.held)) throw failure('retry-required');
      const f = frame(operation, ['targets', 'retireScopes', 'run']); requireInput(typeof f.run === 'function');
      const seen = new Set<string>();
      const targets = array<InstalledQueueAuthority>(f.targets).map(authority => {
        const id = text(own(own(own(authority, 'binding'), 'scope'), 'projectId'));
        checkAuthority(authority, transport, id); requireInput(!seen.has(id)); seen.add(id);
        const p = projects.get(id) ?? newProject(authority);
        if (p.authority !== authority || retired.has(authority) || retiringScopes.has(scopeKey(p.binding.scope))) throw failure('source-changed');
        if (p.blocked) throw p.blocked;
        if (p.floor === Number.MAX_SAFE_INTEGER) throw failure('counter-exhausted');
        installed(p, Math.max(p.floor + 1, p.admitted.document, p.admitted.preferences), 'document'); return p;
      });
      const retiredKeys = new Set<string>();
      const retireScopes = array<unknown>(f.retireScopes).map(value => {
        const s = frame(value, ['storageGeneration', 'projectId', 'incarnation']);
        const scope = Object.freeze({ storageGeneration: text(s.storageGeneration), projectId: text(s.projectId), incarnation: text(s.incarnation) });
        const key = scopeKey(scope); requireInput(!retiredKeys.has(key)); retiredKeys.add(key);
        if (retiringScopes.has(key)) throw failure('source-changed'); return scope;
      });
      // Resolver calls above can reenter. Commit the cut only after rechecking admission.
      if (stopped) throw stopped; if (barrierWaiter) throw failure('barrier-active');
      if (workspaceRecoveryHolds) throw failure('retry-required');
      for (const p of targets) {
        const current = projects.get(p.binding.scope.projectId);
        if (current && current !== p || retired.has(p.authority) || retiringScopes.has(scopeKey(p.binding.scope))) throw failure('source-changed');
      }
      const order = nextOrder(), waiter = deferred<T>();
      for (const p of targets) projects.set(p.binding.scope.projectId, p);
      for (const scope of retireScopes) {
        retiringScopes.add(scopeKey(scope)); const p = projects.get(scope.projectId);
        if (p && scopeKey(p.binding.scope) === scopeKey(scope)) retired.add(p.authority);
      }
      const selected = [...projects.values()], drain = captureFlush(selected).promise;
      void drain.catch(() => {}); // Later queued cuts may be rejected before becoming the head.
      workspaceBarriers.push({ order, targets, retireScopes, drain, waiter: waiter as Deferred<unknown>, started: false,
        run: cut => (f.run as WorkspaceQueueBarrier<T>['run']).call(operation, cut) });
      activateSelected(selected); advanceWorkspaceBarrier(); return waiter.promise;
    } catch (error) { return Promise.reject(error); }
  }
  function restoreSegment(retained: RetainedSegment): Segment {
    const receipts = segmentReceipts.get(retained); requireInput(receipts);
    requireInput(receipts.every(receipt => !submissionProofs.get(receipt)!.acknowledgement));
    const s: Segment = { order: nextOrder(), lane: retained.lane, firstPendingAt: retained.firstPendingAt, trailingAt: retained.trailingAt,
      firstEditorGeneration: retained.firstEditorGeneration, editorGeneration: retained.editorGeneration,
      changes: new Map(), live: new Map(), tombstones: new Map(), patch: {}, sealed: true, forced: false, waiters: [], receipts: [...receipts] };
    if (retained.lane === 'replacement') s.replacement = retained.replacement;
    else if (retained.lane === 'document') {
      for (const change of retained.changes) mergeDirty(s, dirty(change)); s.structural = retained.structural; s.metadata = retained.metadata;
    } else { s.patch = { ...retained.patch }; s.folds = retained.folds; }
    return s;
  }
  async function initializeRecovery(input: QueueRecoveryInput) {
    try {
      if (!checkpoints.has(input.retained)) throw failure('retry-required');
      await input.retained.whenQuiescent; if (stopped) return;
      const restored = new Map<string, Project>();
      const readmissions = new Map<RetainedProjectWork, { project: Project; base: AuthorityStamp; represented: Set<QueueSubmissionReceipt> }>();
      for (const item of input.projects) {
        const { previous, authority } = item;
        if (!input.retained.projects.includes(previous)) throw failure('retry-required');
        const old = checkpointAuthorities.get(previous); if (!old) throw failure('retry-required');
        const scope = old.binding.scope; const projectId = scope.projectId;
        try { checkAuthority(authority, transport, projectId); } catch { throw failure('source-changed'); }
        if (restored.has(projectId) || authority === previous.authority || authority.source !== old.source || authority.editorGenerationFloor !== old.editorGenerationFloor
          || authority.transport === old.transport && authority.binding.admissionId === old.binding.admissionId
          || authority.binding.scope.incarnation !== scope.incarnation
          || authority.binding.scope.storageGeneration !== scope.storageGeneration) throw failure('source-changed');
        const p = newProject(authority); p.held = true;
        p.documentReceipt = previous.documentReceipt;
        p.acknowledged.documentGeneration = previous.acknowledged.documentGeneration;
        p.acknowledged.preferenceGeneration = previous.acknowledged.preferenceGeneration;
        let documentBase = previous.acknowledged.documentRevision;
        let preferenceBase = previous.acknowledged.preferenceRevisionLowerBound;
        let foldBase = previous.acknowledged.foldStructureGeneration;
        const represented = new Set<QueueSubmissionReceipt>();
        for (const segment of [...previous.pending, ...previous.attempts.map(item => item.segment)]) {
          const receipts = segmentReceipts.get(segment); requireInput(receipts); for (const receipt of receipts) represented.add(receipt);
        }
        for (const entry of previous.structuralAcks) {
          p.structuralAcks.set(entry.editorGeneration, entry.ack);
          if (entry.ack.type === 'document-replaced' && (!p.latestReplacement || entry.editorGeneration > p.latestReplacement.editorGeneration)) p.latestReplacement = entry.ack;
        }
        const resolutions = new Map<QueueAttempt, AttemptResolution>();
        for (const r of item.resolutions) {
          if (resolutions.has(r.attempt) || !previous.attempts.some(a => a.attempt === r.attempt)) throw failure('retry-required');
          resolutions.set(r.attempt, r);
        }
        if (resolutions.size !== previous.attempts.length) throw failure('retry-required');
        for (const original of previous.attempts) {
          const { attempt } = original; const resolution = resolutions.get(attempt)!;
          const ids = [attempt.batch.clientId, attempt.batch.commitId];
          if (ids.includes(clientId)) throw failure('retry-required');
          for (const id of ids) reserve(id);
          let ack: Ack | undefined;
          if ('notPosted' in resolution) {
            const error = resolution.notPosted;
            if (original.failure?.type !== 'transport' || original.failure.error !== error
              || capturedRejections.get(attempt) !== error || !notPosted(error)) throw failure('retry-required');
          } else {
            const inspection = frame(resolution.inspection, ['type', 'result']);
            requireInput(inspection.type === (attempt.lane === 'replacement' ? 'replacement-inspection' : 'commit-inspection'));
            const type = own(inspection.result, 'type');
            if (type === 'committed') {
              const r = frame(inspection.result, ['type', 'ack']);
              ack = acknowledge(attempt, { type: responseType(attempt), ack: r.ack } as WorkspaceWorkerResponse);
            } else if (type === 'not-committed') frame(inspection.result, ['type']);
            else throw failure('retry-required', inspection.result);
          }
          if (ack) {
            if (ack.type === 'document-replaced') {
              if (attempt.lane !== 'replacement' || attempt.batch.expected.documentRevision !== documentBase
                || attempt.batch.expected.preferenceRevision < preferenceBase || attempt.batch.expected.foldStructureGeneration !== foldBase) throw failure('source-changed');
              documentBase = ack.authority.documentRevision; preferenceBase = ack.authority.preferenceRevision;
              p.documentReceipt = undefined;
              p.acknowledged.documentGeneration = ack.editorGeneration; p.acknowledged.preferenceGeneration = ack.editorGeneration;
              p.structuralAcks.set(ack.editorGeneration, ack); p.latestStructural = ack; p.latestReplacement = ack;
            } else if (ack.type === 'document-saved') {
              if (attempt.lane !== 'document' || attempt.batch.expectedRevision !== documentBase) throw failure('source-changed');
              p.documentReceipt = documentReceipt(attempt, ack);
              documentBase = ack.revision; p.acknowledged.documentGeneration = ack.editorGeneration;
              if (attempt.batch.structural) { p.structuralAcks.set(ack.editorGeneration, ack); p.latestStructural = ack; }
            } else { preferenceBase = Math.max(preferenceBase, ack.preferenceRevision); p.acknowledged.preferenceGeneration = ack.editorGeneration; }
            foldBase = foldOf(ack);
            p.recoveredAcks.push({ attempt, ack, ids, receipts: segmentReceipts.get(original.segment)! });
          } else {
            const s = restoreSegment(original.segment); s.reservedIds = ids; p.pending.push(s);
          }
        }
        if (authority.binding.authority.documentRevision !== documentBase || authority.binding.authority.preferenceRevision < preferenceBase) throw failure('source-changed');
        if (authority.binding.authority.preferenceRevision > preferenceBase && p.documentReceipt) {
          const receipt = p.documentReceipt;
          // A successful document receipt cannot explain a different document/fold
          // head. The extra read proves preferences; it never imports foreign work.
          if (receipt.ack.revision !== documentBase || receipt.ack.foldStructureGeneration !== foldBase) throw failure('source-changed');
          if (stopped || disposed) return;
          installed(p, Math.max(p.floor + 1, p.acknowledged.documentGeneration, p.acknowledged.preferenceGeneration), 'document');
          if (stopped || disposed) return;
          let response: WorkspaceWorkerResponse;
          activeOperations++;
          try { response = await transport.request({ type: 'document-readmission-authority', admissionId: p.binding.admissionId, receipt }); }
          finally { finishOperation(); }
          if (stopped || disposed) return;
          installed(p, Math.max(p.floor + 1, p.acknowledged.documentGeneration, p.acknowledged.preferenceGeneration), 'document');
          if (stopped || disposed) return;
          if (own(response, 'type') === 'failed') throw failure('source-changed', domainFailure(response));
          const r = frame(response, ['type', 'scope', 'admissionId', 'identity', 'authority']);
          requireInput(r.type === 'document-readmission-authority-result' && r.admissionId === p.binding.admissionId);
          const scope = frame(r.scope, ['storageGeneration', 'projectId', 'incarnation']);
          const identity = frame(r.identity, ['clientId', 'commitGeneration', 'commitId', 'editorGeneration', 'lane']);
          requireInput(Object.keys(scope).every(key => scope[key] === Reflect.get(receipt.scope, key))
            && Object.keys(identity).every(key => identity[key] === Reflect.get(receipt.identity, key)));
          const exact = frame(r.authority, ['documentRevision', 'preferenceRevision', 'foldStructureGeneration']);
          requireInput(Object.values(exact).every(safe));
          if (exact.documentRevision !== documentBase || exact.foldStructureGeneration !== foldBase
            || (exact.preferenceRevision as number) < preferenceBase || Object.keys(exact).some(key => exact[key] !== Reflect.get(p.binding.authority, key))) throw failure('source-changed');
          preferenceBase = exact.preferenceRevision as number;
        }
        for (const segment of previous.pending) p.pending.push(restoreSegment(segment));
        p.admitted = { document: p.acknowledged.documentGeneration, preferences: p.acknowledged.preferenceGeneration };
        for (const s of p.pending) {
          const lane = laneOf(s.lane); p.admitted[lane] = Math.max(p.admitted[lane], s.editorGeneration);
          if (s.lane === 'replacement') p.admitted.preferences = Math.max(p.admitted.preferences, s.editorGeneration);
          const b = s.structural?.basis ?? s.folds?.basis;
          if (b?.type === 'generation' && b.generation !== p.acknowledged.foldStructureGeneration) throw failure('fold-dependency');
          if (b && b.type !== 'generation') {
            const ack = p.structuralAcks.get(b.editorGeneration);
            if (ack ? !matchesDependencyAck(ack, b) || foldOf(ack) !== p.acknowledged.foldStructureGeneration
              : !p.pending.some(predecessor => matchesDependency(predecessor, b)
                && p.pending.indexOf(predecessor) < p.pending.indexOf(s))) throw failure('fold-dependency');
          }
        }
        releaseAcks(p); restored.set(projectId, p);
        readmissions.set(previous, { project: p, base: { documentRevision: documentBase, preferenceRevision: preferenceBase, foldStructureGeneration: foldBase }, represented });
      }
      for (const [previous, entry] of readmissions) {
        for (const item of entry.project.recoveredAcks) settleReceipts(item.receipts, item.ack);
        recoveredProjects.set(previous, entry);
      }
      for (const [id, p] of restored) projects.set(id, p);
    } catch (error) {
      stop(error && typeof error === 'object' && 'type' in error && error.type === 'queue' ? error as QueueFailure : failure('retry-required', error));
    } finally {
      recovering = undefined;
      const selected = new Set<Project>();
      for (const waiter of recoveryFlushes) {
        recoveryFlushes.delete(waiter);
        const targets = waiter.projectIds.flatMap(id => projects.has(id) ? [projects.get(id)!] : []);
        captureFlush(targets, waiter);
        for (const p of targets) selected.add(p);
      }
      activateSelected([...selected]);
    }
  }
  if (recoveryFramingError) { stop(recoveryFramingError); recovering = undefined; }
  else if (recovering) initialized = initializeRecovery(recovering);
  return {
    enqueueDocument: (p, g, input) => enqueue(p, g, 'document', input) as Promise<DocumentSaveAck>,
    enqueuePreferences: (p, g, input) => enqueue(p, g, 'preferences', input) as Promise<PreferenceSaveAck>,
    enqueueReplacement,
    flush,
    barrier,
    workspaceBarrier,
    trackProject(authority) {
      if (disposed) throw failure('disposed'); if (stopped) throw stopped;
      if (recovering || workspaceRecoveryHolds || barrierWaiter || workspaceBarriers.length) throw failure('retry-required');
      const id = text(own(own(own(authority, 'binding'), 'scope'), 'projectId')); checkAuthority(authority, transport, id);
      const existing = projects.get(id), p = existing ?? newProject(authority);
      if (p.authority !== authority || p.floor === Number.MAX_SAFE_INTEGER || retired.has(authority) || retiringScopes.has(scopeKey(p.binding.scope))) throw failure('source-changed');
      installed(p, Math.max(p.floor + 1, p.admitted.document, p.admitted.preferences), 'document');
      if (stopped) throw stopped;
      if (workspaceRecoveryHolds || barrierWaiter || workspaceBarriers.length || projects.get(id) !== existing) throw failure('retry-required');
      projects.set(id, p);
    },
    async prepareProjectReadmission(retained, previous, requested) {
      requireInput(checkpoints.has(retained) && recoveryCheckpoints.has(retained) && retained.projects.includes(previous));
      const receipts = array<QueueSubmissionReceipt>(requested); requireInput(new Set(receipts).size === receipts.length);
      await initialized; if (stopped) throw stopped; if (disposed) throw failure('disposed');
      if (!workspaceRecoveryHolds) throw failure('retry-required');
      const recovered = recoveredProjects.get(previous), old = checkpointAuthorities.get(previous); requireInput(recovered && old);
      const p = recovered.project, base = recovered.base, fresh = p.binding.authority;
      if (fresh.documentRevision !== base.documentRevision || fresh.preferenceRevision !== base.preferenceRevision
        || fresh.foldStructureGeneration !== base.foldStructureGeneration) throw failure('source-changed');
      installed(p, Math.max(p.floor + 1, p.admitted.document, p.admitted.preferences), 'document');
      const originalOwner = checkpointOwners.get(retained)!, covered = previous.acknowledged;
      const rows = receipts.map(receipt => {
        const proof = submissionProofs.get(receipt);
        requireInput(proof && proof.family === originalOwner && proof.source === old.source
          && scopeKey(proof.scope) === scopeKey(old.binding.scope));
        const ack = proof.acknowledgement;
        if (!recovered.represented.has(receipt)) requireInput(ack && proof.generation <= (proof.lane === 'document'
          ? covered.documentGeneration : covered.preferenceGeneration)
          && (ack.type === 'document-replaced' ? ack.authority.documentRevision <= covered.documentRevision
              && ack.authority.preferenceRevision <= covered.preferenceRevisionLowerBound
              && ack.editorGeneration <= covered.preferenceGeneration
            : ack.type === 'document-saved' ? ack.revision <= covered.documentRevision
            : ack.preferenceRevision <= covered.preferenceRevisionLowerBound));
        return Object.freeze({ receipt, lane: proof.lane, generation: proof.generation, acknowledged: ack, whenAcknowledged: proof.completion.promise });
      });
      const evidence: QueueReadmissionEvidence = Object.freeze({ authority: p.authority, previousAuthority: old, base: Object.freeze({ ...base }),
        receipts: Object.freeze(rows), whenFailed: p.failed.promise,
        acknowledgedAttempts: Object.freeze(p.recoveredAcks.map(({ attempt, ack }) => Object.freeze({
          clientId: attempt.batch.clientId, commitGeneration: attempt.batch.commitGeneration, lane: attempt.lane, ack: Object.freeze({ ...ack }),
        }))), assertCurrent() {
          if (stopped) throw stopped; if (disposed) throw failure('disposed'); if (p.blocked) throw p.blocked;
          pinnedInstallation(p); if (projects.get(p.binding.scope.projectId) !== p) throw failure('source-changed');
        } });
      evidence.assertCurrent(); const proof = Object.freeze({}) as VerifiedQueueReadmission; readmissionProofs.set(proof, evidence); return proof;
    },
    holdWorkspaceRecovery() {
      if (disposed) throw failure('disposed'); if (stopped) throw stopped;
      if (activeOperations || barrierWaiter || workspaceBarriers.length || flushes.size || recoveryFlushes.size
        || [...projects.values()].some(p => !p.held)) throw failure('retry-required');
      workspaceRecoveryHolds++; let released = false;
      return () => { if (!released) { released = true; workspaceRecoveryHolds--; } };
    },
    freeze: error => stop(failure('frozen', error)),
    dispose() { disposed = true; return stop(failure('disposed')); },
  };
}
