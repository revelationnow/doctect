import type { DocumentEdit, RecordAddress } from '../../document/contracts';
import { buildReferenceIndex, buildReferenceIndexWork, updateReferenceIndex, type ReferenceIndex } from '../../document/references';
import { partitionState, partitionStateWork } from '../../document/partition';
import { decodeSelectedFoldCells, encodeSelectedFoldCells, reconcileSelectedLayerFolds, type LayerOccurrence, type SelectedLayerSequence } from '../../document/layerFolds';
import { canonicalStringify } from '../canonical';
import { createWorkspaceReconstructor, withSourceRecords, prepareNormalizationTarget, reconstructProject, reconstructProjectWork, validateRecords, type PlannedTargetCursor, type SourceTargetCursors } from './codec';
import { disposeEmissionPlan, openEmissionCursor, type EmissionCursor, type EmissionPlan } from './emissionPlan';
import type { WorkspaceProject, WorkspaceSnapshot } from '../contracts';
import { reconstructWorkspaceRecords, type MigrationPreparationEnvironment } from '../migration';
import { isRecognizedLedger, isRecognizedLedgerWork, validateHistoricalBackup } from '../historicalBootstrap';
import { assertWorkRuntime, createWorkRuntime, effect, primitive, runSync, type Ownership, type Phase, type Work, type WorkRuntime } from '../../../shared/cooperativeWork.js';
import { compareStringsWork, copyEnumerableWork, enumerableEntriesWork, equalFrameWork, jsonTextWork, quoteWork, rawValueWeightWork, stableSortWork, textWork, utf8LengthWork, type Frame } from '../../../shared/jsonWork.js';
import { canonicalFrame, envelopeFrame, frameBytesWork, hashFrame, listFrame, orderedFrame } from './work';
import { equalSourceArchiveWork, hashSourceImages } from './sourceDigests';
import { compareArchiveWork, compareEnvelopeWork, compareRecordWork, emitComparedRecordWork } from './frameComparison';
import { createInitialWorkspaceManifest, deriveWorkspaceIncarnation, projectWorkspaceOrderWork, validateWorkspaceManifestWork,
  type NormalizedWorkspaceManifest, type WorkspaceMember } from './workspaceManifest';
import { verifyWorkspaceReceipts } from './workspaceCommitProof';
import { verifyProjectBirth } from './projectBaseline';
import { captureBulkDocumentBatch, frameBulkDocumentBatch, hashBulkDocumentRequest, prepareBulkProject,
  verifyBulkProjectBaseline, verifyBulkProjectProof, type PreparedBulkProject } from './bulkProject';
import { diffWorkspaceCatalogWork, projectWorkspaceCatalogWork } from '../workspaceCatalog';
import { captureWorkspaceBatch, frameWorkspaceBatch, hashWorkspaceRequest, prepareWorkspaceMutation, verifyWorkspacePostconditions, WorkspaceCommandConflict,
  type CapturedWorkspaceCommand, type PreparedWorkspaceMutation, type WorkspaceAdmission, type WorkspaceBatch,
  type WorkspaceCatalog, type WorkspaceCommandResult, type WorkspaceInspection, type WorkspaceRepositoryAdmission,
  type WorkspaceRepositoryFence, type WorkspaceRepositoryMethods } from './workspaceCommands';
import { WORKSPACE_MIGRATION_ID, type LegacyBackupRecord, type NormalizationSourceArchive, type StoredPendingImport } from '../schema';
import type { WorkspaceRepositoryRecovery, WorkspaceRecoveryPreparation } from './workspaceRecovery';
import { appendCommitWindow, authority, canonicalTimestamp, denseDataArray, exactFields, frameBatch, frameManifest, frameRecord,
  jsonBytes, privateId, requireContract, safeCounter, sameAuthority, validDigest, validateIdentity,
  dataObjectWork, denseDataArrayWork, exactFieldsWork, isBulkCommitProof, manifestFrame, recordFrame } from './commitProof';
import { createFoldOverlayIndex, createFoldOverlayIndexWork, finalizePreparedChanges, preflightFoldPublication, prepareAuthoritativeFoldRefresh,
  prepareFoldOverlayChanges, publishFoldOverlayChanges, referenceProjection, validateIncrementalChanges,
  type FoldOverlayIndex, type NormalizedFoldEffect, type PreparedChanges, type ValidationContext } from './validateChanges';
import type { NormalizedProjectSlice, SizeLedger } from './sizeLedger';
import { NORMALIZATION_LEDGER_ID, NORMALIZED_STORE_NAMES, type NormalizationSource, type NormalizationAttempt,
  type TaggedNormalizedRecord, type ActiveAuthority, type AuthorityStamp, type CommitDelta, type CommitIdentity, type CommitInspection,
  type CommitProof, type DocumentBatch, type DocumentSaveAck, type NormalizedProject, type NormalizedRecordTypes,
  type PhysicalAddress, type PreferenceBatch, type PreferenceSaveAck, type ProjectHeader, type ProjectPreferences,
   type ProjectScope, type ProjectStoreName, type SelectedPostcondition, type CommitAttempt, type NormalizedProjectRecovery,
   type BulkDocumentBatch, type BulkDocumentAck, type BulkCommitInspection, type DocumentCommitReceipt } from './schema';

export type { DocumentBatch, DocumentSaveAck, PreferenceBatch, PreferenceSaveAck, CommitInspection } from './schema';
export interface RepositoryOperation {
  phase: 'prepare-read' | 'cas-read' | 'write' | 'verify-read' | 'inspect-read' | 'ingress-read';
  transactionId: number;
  connectionId: number;
  store: ProjectStoreName;
  method: 'get' | 'getAll' | 'put' | 'delete';
  key?: readonly string[];
}
export interface RepositoryFaultPoint {
  phase: 'before-cas' | 'after-cas' | 'before-put' | 'after-put' | 'before-delete' | 'after-delete'
    | 'before-complete' | 'after-commit' | 'before-readback' | 'after-readback';
  ordinal?: number;
  store?: ProjectStoreName;
  key?: readonly string[];
}
export type WorkspaceStoreName = ProjectStoreName | 'workspace' | 'presets' | 'pendingImports' | 'normalizationLedger' | 'legacyBackup' | 'projects' | 'migrationLedger';
export interface WorkspaceRepositoryOperation {
  phase: 'prepare-read' | 'cas-read' | 'write' | 'verify-read' | 'inspect-read';
  transactionId: number; connectionId: number; store: WorkspaceStoreName;
  method: 'get' | 'openCursor' | 'add' | 'put' | 'delete'; key?: IDBValidKey;
}
export interface WorkspaceRepositoryFault {
  phase: 'before-cas' | 'after-cas' | 'before-put' | 'after-put' | 'before-delete' | 'after-delete'
    | 'before-complete' | 'after-commit' | 'before-readback' | 'after-readback';
  ordinal?: number; store?: WorkspaceStoreName; key?: IDBValidKey;
}
export type NormalizationReservationFault = 'reservation.before-archive' | 'reservation.after-archive'
  | 'reservation.before-marker' | 'reservation.after-marker' | 'reservation.before-complete' | 'reservation.after-commit'
  | 'stage.before-record' | 'stage.after-record' | 'cutover.before-workspace' | 'cutover.after-workspace'
  | `${'stage' | 'verify' | 'cutover'}.${'before-marker' | 'after-marker' | 'before-complete' | 'after-commit'}`;
export interface NormalizedEnvironment {
  indexedDB: IDBFactory;
  databaseName: string;
  now(): string;
  hash(input: string): string | Promise<string>;
  /** Private normalization prerequisites; ordinary saves never consult this environment. */
  normalization?: MigrationPreparationEnvironment;
  normalizationFault?(point: NormalizationReservationFault): void;
  normalizationPause?(point: { phase: Phase; point: 'after-page' | 'before-hash' | 'before-seal'; ordinal: number }): void | Promise<void>;
  onOperation?(operation: RepositoryOperation): void;
  fault?(point: RepositoryFaultPoint): void;
  /** Test-only observation/corruption seams. Neither may act as a writer. */
  readResult?(operation: RepositoryOperation, value: unknown): unknown;
  onPublication?(publication: { scope: ProjectScope; authority: AuthorityStamp; kind: 'local' | 'remote' }): void;
  workspaceFault?(point: WorkspaceRepositoryFault): void;
  onWorkspaceOperation?(operation: WorkspaceRepositoryOperation): void;
  workspaceReadResult?(operation: WorkspaceRepositoryOperation, value: unknown): unknown;
}
export interface NormalizedRepository extends WorkspaceRepositoryMethods {
  admitWorkspace(): Promise<WorkspaceAdmission>;
  openEditingWorkspace(work: WorkRuntime): Promise<{ active: ActiveRead; admission: WorkspaceAdmission }>;
  resumeAbortedWorkspace(token: WorkspaceRepositoryAdmission, failures: readonly { scope: ProjectScope; identity: CommitIdentity }[], work: WorkRuntime): Promise<WorkspaceAdmission>;
  prepareWorkspaceRecovery(admission: WorkspaceRepositoryAdmission, batch: WorkspaceBatch): Promise<WorkspaceRecoveryPreparation>;
  commitWorkspaceRecovery(admission: WorkspaceRepositoryAdmission, preparation: WorkspaceRepositoryRecovery): Promise<WorkspaceCommandResult>;
  discardWorkspaceRecovery(preparation: WorkspaceRepositoryRecovery): void;
  readActiveSnapshot(work?: WorkRuntime): Promise<ActiveRead | undefined>;
  readRetainedSource(work?: WorkRuntime): Promise<NormalizationSource>;
  openNormalizationSession(work: WorkRuntime): NormalizationPreparationSession;
  readNormalizationSource(): Promise<NormalizationSource>;
  reserveNormalization(source: NormalizationSource): Promise<NormalizationAttempt>;
  stageNormalization(attempt: NormalizationAttempt, records: readonly TaggedNormalizedRecord[]): Promise<NormalizationAttempt>;
  readStagedProject(attempt: NormalizationAttempt, projectId: string): Promise<NormalizedProject>;
  markNormalizationVerified(attempt: NormalizationAttempt, digest: string): Promise<NormalizationAttempt>;
  activateNormalization(attempt: NormalizationAttempt): Promise<ActiveAuthority>;
  readActiveAuthority(): Promise<ActiveAuthority | undefined>;
  exportGeneration(storageGeneration: string): Promise<WorkspaceSnapshot>;
  bindAdmittedProject(project: NormalizedProject): Promise<AuthorityStamp>;
  openAdmittedProject(scope: ProjectScope): Promise<{ project: WorkspaceProject; authority: AuthorityStamp }>;
  commitDocument(batch: DocumentBatch): Promise<DocumentSaveAck>;
  commitPreferences(batch: PreferenceBatch): Promise<PreferenceSaveAck>;
  readAdmittedProjectAuthority(scope: ProjectScope): AuthorityStamp;
  readDocumentReadmissionAuthority(receipt: DocumentCommitReceipt): Promise<AuthorityStamp>;
  commitReplacement(batch: BulkDocumentBatch, work?: WorkRuntime): Promise<BulkDocumentAck>;
  inspectReplacement(batch: BulkDocumentBatch): Promise<BulkCommitInspection>;
  inspectCommit(scope: ProjectScope, commitId: string): Promise<CommitInspection>;
  inspectCommitAttempt(attempt: CommitAttempt): Promise<CommitInspection>;
  exportProjectForRecovery(scope: ProjectScope): Promise<NormalizedProjectRecovery>;
}
export interface SourceInfo { kind: 'historical' | 'fresh'; acceptedLegacyDigest: string | null }
export interface ActiveRead { authority: ActiveAuthority; workspace: NormalizedWorkspaceManifest; snapshot: WorkspaceSnapshot; source: SourceInfo }
interface BulkAdmission { external: WorkspaceProject; preferences: ProjectPreferences; stamp: AuthorityStamp; foldRecordDigest: string }
interface SelectedActiveRead { records: NormalizedProject; admission: BulkAdmission }
interface WorkspaceAdmissionRead {
  authority: ActiveAuthority;
  workspace: NormalizedWorkspaceManifest;
  catalog: WorkspaceAdmission['catalog'];
  projectAuthorities: WorkspaceAdmission['projectAuthorities'];
  editing?: { active: ActiveRead; owners: Owner[] };
}
interface WorkspaceSelection { store: WorkspaceStoreName; key?: IDBValidKey; lower?: IDBValidKey; upper?: IDBValidKey }
interface WorkspaceCapture {
  selections: WorkspaceSelection[]; rows: CapturedRow[][]; scopes: ProjectScope[]; release(): void;
}
interface WorkspaceAttemptRecord {
  identity: WorkspaceBatch['identity']; before: WorkspaceBatch['expected']; digest?: string; bytes: number;
}
interface WorkspaceOwner {
  authority: ActiveAuthority; workspace: NormalizedWorkspaceManifest;
  connectionEpoch: number; admissionEpoch: number; fenced: boolean;
  pending: Set<Promise<unknown>>; attempts: Map<string, WorkspaceAttemptRecord>;
  lastBefore?: { identity: WorkspaceBatch['identity']; catalog: WorkspaceCatalog };
  recovery?: { dispose(): void };
}
export type PreparationInfo = { state: 'active' } | { state: 'prepared'; source: SourceInfo };
/** G5a surface. Stage/verification methods are added with their implementations. */
export interface NormalizationPreparationSession {
  prepare(options?: { allowFresh?: boolean }): Promise<PreparationInfo>;
  reserve(): Promise<NormalizationAttempt>;
  stageNext(): Promise<NormalizationAttempt>;
  verify(): Promise<NormalizationAttempt>;
  activate(): Promise<ActiveAuthority>;
  reopen(): Promise<ActiveRead | undefined>;
  dispose(): void;
}
type CaptureStore = typeof sourceStores[number] | typeof NORMALIZED_STORE_NAMES[number];
interface CapturedRow { key: IDBValidKey; value: unknown; bytes: number }
interface PagedCapture { stores: readonly CaptureStore[]; rows: Map<CaptureStore, CapturedRow[]>; dropRows(): void; release(): void }
interface PreparedPass {
  source: NormalizationSource; archive: NormalizationSourceArchive; attempt: NormalizationAttempt;
  recordBytes: number[]; projects: Map<string, { first: number; count: number }>;
  images?: Map<string, NormalizedProject>;
  initialWorkspace: NormalizedWorkspaceManifest;
  currentWorkspace?: NormalizedWorkspaceManifest;
  emissionPlan?: EmissionPlan;
}
type SourceMarkerFacts = Pick<NormalizationAttempt, 'attemptId' | 'storageGeneration' | 'sourceKind' | 'sourceProjects'
  | 'sourceDigest' | 'sourceWorkspaceRevision' | 'sourceLedgerRevision' | 'sourceArchiveId' | 'sourceArchiveDigest' | 'contentDigest'>;
interface CapturedSourcePass {
  source: NormalizationSource; archive: NormalizationSourceArchive; facts: SourceMarkerFacts;
  marker?: NormalizationAttempt; rows: SourceCapture; additionalBackups: LegacyBackupRecord[];
}
interface SourceDerivationOptions { allowFresh: boolean; purpose: 'retained' | 'target'; suppliedSeed?: SourceRows }
interface TargetDerivationOptions { allowFresh: boolean; collectImages?: boolean; mode?: 'baseline' | 'active'; suppliedSeed?: SourceRows; prepareEmission?: boolean }
const composedFrame = (label: string, parts: readonly Frame[]): Frame => function* (emit) {
  yield* textWork(`[${JSON.stringify(label)},`, emit);
  for (let index = 0; index < parts.length; index++) {
    if (index) yield* textWork(',', emit);
    yield* parts[index](emit);
  }
  yield* textWork(']', emit);
};
/** Physical archive equality with the same external-depth resets as source derivation. */
const archiveSealFrame = (value: object): Frame => function* (emit) {
  yield* dataObjectWork(value);
  const entries = yield* enumerableEntriesWork(value as Record<string, unknown>);
  const sorted = yield* stableSortWork(entries, (a, b) => compareStringsWork(a[0], b[0]));
  yield* textWork('["archive-seal",{', emit);
  for (let index = 0; index < sorted.length; index++) {
    const [key, item] = sorted[index];
    if (index) yield* textWork(',', emit);
    yield* quoteWork(key, emit); yield* textWork(':', emit);
    if (['seed', 'presets', 'pendingImports', 'projectMetadata'].includes(key)) {
      requireContract(Array.isArray(item), 'Invalid normalization archive list');
      yield* denseDataArrayWork(item);
      for (const envelope of item) yield* dataObjectWork(envelope);
      yield* listFrame(key, item)(emit);
    } else if (key === 'workspace' || key === 'ledger' && item !== null) {
      const envelope = yield* dataObjectWork(item);
      yield* envelopeFrame(key, envelope)(emit);
    } else yield* canonicalFrame(item)(emit);
  }
  yield* textWork('}]', emit);
};
export class RepositoryConflict extends Error {
  constructor(readonly reason: string) { super(reason); this.name = 'RepositoryConflict'; }
}
type PhysicalRecord = NormalizedRecordTypes[ProjectStoreName];
type Pair = { header: ProjectHeader; preferences: ProjectPreferences };
interface Owner { records: NormalizedProject; references: ReferenceIndex; folds: FoldOverlayIndex; stamp: AuthorityStamp; valid: boolean;
  lastVerified: AuthorityStamp; initialFoldRecordDigest?: string }
type RecordMutation = Pick<PreparedWorkspaceMutation, 'removeProjects' | 'addProjects'>
  & Partial<Pick<PreparedWorkspaceMutation, 'manifest' | 'deletePresetIds' | 'deleteImportIds' | 'putPresets' | 'putImports' | 'addBackup'>>;
class MissingSelected extends Error { constructor(readonly address: PhysicalAddress) { super('selected-record-required'); } }
const stores = NORMALIZED_STORE_NAMES.filter((s): s is ProjectStoreName => s !== 'normalizationLedger');
const sourceStores = ['projects', 'workspace', 'presets', 'pendingImports', 'migrationLedger', 'legacyBackup'] as const;
type SourceRows = { [S in typeof sourceStores[number]]: unknown[] };
type SourceCapture = SourceRows & { normalizationLedger: unknown[] };
type TargetRecord = Exclude<TaggedNormalizedRecord, { store: 'normalizationLedger' }>;
const STAGE_RECORD_LIMIT = 64;
const STAGE_BYTE_LIMIT = 256 * 1024;
const preferredArchiveId = `normalization-source:${NORMALIZATION_LEDGER_ID}`;
// Frame each external payload at its original depth, not beneath archive/source ancestry.
const captureFrame = (label: string, value: object): string => `[${JSON.stringify(label)},{${Object.entries(value)
  .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  .map(([key, item]) => `${JSON.stringify(key)}:${canonicalStringify(item)}`).join(',')}}]`;
const captureList = (label: string, values: readonly object[]): string => `[${JSON.stringify(label)},${values.map(value => captureFrame('envelope', value)).join(',')}]`;
function capturedRecordFrame(store: ProjectStoreName, value: unknown): string {
  requireContract(value !== null && typeof value === 'object' && !Array.isArray(value), 'Invalid normalization record');
  return frameRecord(store, value);
}
function validateNormalizationLedger(value: unknown): asserts value is NormalizationAttempt {
  runSync(validateNormalizationLedgerWork(value));
}
function* validateNormalizationLedgerWork(value: unknown): Work<void> {
  const marker = yield* exactFieldsWork(value, ['id', 'formatVersion', 'attemptId', 'storageGeneration', 'state', 'sourceKind',
    'sourceProjects', 'sourceDigest', 'sourceWorkspaceRevision', 'sourceLedgerRevision', 'sourceArchiveId',
    'sourceArchiveDigest', 'contentDigest', 'targetManifestDigest', 'recordCount', 'nextRecord', 'progressRevision',
    'verificationDigest', 'verifiedProgressRevision', 'cutoverRevision', 'workspaceManifestVersion', 'initialWorkspaceDigest']);
  requireContract(marker.id === NORMALIZATION_LEDGER_ID && marker.formatVersion === 3
    && typeof marker.state === 'string' && ['staging', 'verified', 'active'].includes(marker.state)
    && typeof marker.sourceKind === 'string' && ['historical', 'fresh'].includes(marker.sourceKind), 'Unrecognized normalization ledger');
  for (const field of ['attemptId', 'storageGeneration', 'sourceArchiveId']) privateId(marker[field]);
  for (const field of ['sourceDigest', 'sourceArchiveDigest', 'contentDigest', 'targetManifestDigest']) validDigest(marker[field]);
  requireContract(marker.workspaceManifestVersion === 1, 'Unknown workspace manifest version'); validDigest(marker.initialWorkspaceDigest);
  for (const field of ['sourceWorkspaceRevision', 'recordCount', 'nextRecord', 'progressRevision']) safeCounter(marker[field]);
  if (marker.sourceKind === 'historical') safeCounter(marker.sourceLedgerRevision);
  else requireContract(marker.sourceLedgerRevision === null, 'Invalid fresh ledger ancestry');
  yield* denseDataArrayWork(marker.sourceProjects); const sourceProjects = marker.sourceProjects as unknown[];
  requireContract(sourceProjects.length > 0, 'Missing source projects');
  const ids = new Set<string>();
  for (const candidate of sourceProjects) {
    const project = yield* exactFieldsWork(candidate, ['projectId', 'incarnation', 'revision', 'digest']);
    requireContract(typeof project.projectId === 'string' && project.projectId.length > 0
      && typeof project.incarnation === 'string' && project.incarnation.length > 0, 'Invalid source identity');
    safeCounter(project.revision); validDigest(project.digest);
    requireContract(!ids.has(project.projectId), 'Duplicate source identity'); ids.add(project.projectId);
  }
  const m = value as NormalizationAttempt; // Every field was checked above; phase invariants follow.
  requireContract(m.nextRecord <= m.recordCount && m.progressRevision <= m.nextRecord
    && (m.nextRecord === 0) === (m.progressRevision === 0), 'Invalid staging cursor');
  if (m.state === 'staging') requireContract(m.verificationDigest === null && m.verifiedProgressRevision === null
    && m.cutoverRevision === null, 'Invalid staging marker');
  else {
    validDigest(m.verificationDigest); safeCounter(m.verifiedProgressRevision);
    requireContract(m.nextRecord === m.recordCount && m.verifiedProgressRevision === m.progressRevision, 'Incomplete verified marker');
    requireContract(m.state === 'verified' ? m.cutoverRevision === null : m.cutoverRevision === 1, 'Invalid cutover marker');
  }
}
function matchAttemptSource(marker: NormalizationAttempt, expected: NormalizationAttempt): void {
  const { state, nextRecord, progressRevision, verificationDigest, verifiedProgressRevision, cutoverRevision } = marker;
  requireContract(canonicalStringify(marker) === canonicalStringify({ ...expected, state, nextRecord,
    progressRevision, verificationDigest, verifiedProgressRevision, cutoverRevision }), 'Normalization source mismatch');
}
function assertTargetPrefix(rows: Map<string, unknown[]>, target: readonly TargetRecord[], count: number): void {
  const expected = new Map(target.slice(0, count).map(item => [addressId({ store: item.store, key: item.record.key }), item]));
  let found = 0;
  for (const store of stores) for (const candidate of rows.get(store) ?? []) {
    const record = candidate as PhysicalRecord;
    const item = expected.get(addressId({ store, key: record.key }));
    requireContract(item && frameRecord(store, record) === frameRecord(item.store, item.record), 'Orphaned normalization target');
    found++;
  }
  requireContract(found === count, 'Missing normalization target');
}
const prefix = (scope: ProjectScope): [string, string, string] => [scope.storageGeneration, scope.projectId, scope.incarnation];
const addressId = (address: { store: ProjectStoreName; key: readonly string[] }) => JSON.stringify([address.store, address.key]);
const recordKey = (key: readonly string[]) => JSON.stringify(key);
function image(scope: ProjectScope): NormalizedProject {
  return { scope: { ...scope }, ...Object.fromEntries(NORMALIZED_STORE_NAMES.map(store => [store, new Map()])) } as NormalizedProject;
}
function setRecord(records: NormalizedProject, store: ProjectStoreName, record: PhysicalRecord): void {
  (records[store] as Map<string, PhysicalRecord>).set(recordKey(record.key), record);
}
function pair(records: NormalizedProject): Pair {
  const key = prefix(records.scope);
  const header = records.projectHeaders.get(recordKey(key.slice(0, 2)));
  const preferences = records.projectPreferences.get(recordKey(key));
  if (!header || header.incarnation !== records.scope.incarnation || !preferences) throw new RepositoryConflict('incarnation-changed');
  return { header, preferences };
}
function ledgerOf({ header: h, preferences: p }: Pair): SizeLedger {
  return { documentBytes: h.counters.documentBytes, projectBytes: h.counters.projectBaseBytes + p.preferenceBytes,
    stateBytes: h.counters.documentBytes + p.preferenceBytes, preferenceBytes: p.preferenceBytes,
    nodeCount: h.counters.nodeCount, variantCount: h.counters.variantCount, elementCount: h.counters.elementCount };
}
function ack(scope: ProjectScope, proof: CommitProof): DocumentSaveAck | PreferenceSaveAck {
  const identity = { projectId: scope.projectId, incarnation: scope.incarnation, commitId: proof.identity.commitId,
    editorGeneration: proof.identity.editorGeneration, foldStructureGeneration: proof.after.foldStructureGeneration };
  return proof.identity.lane === 'document' ? { type: 'document-saved', ...identity, revision: proof.after.documentRevision }
    : { type: 'preferences-saved', ...identity, preferenceRevision: proof.after.preferenceRevision };
}

/** Sole normalized transaction writer. Physical upgrade and public admission stay outside this owner. */
export function createNormalizedRepository(environment: NormalizedEnvironment): NormalizedRepository {
  let owners = new Map<string, Owner>(); const queues = new Map<string, Promise<unknown>>();
  const workspaceAdmissions = new WeakMap<WorkspaceRepositoryAdmission, WorkspaceOwner>();
  const workspaceFences = new WeakMap<WorkspaceRepositoryFence, WorkspaceOwner>();
  const workspaceQueues = new Map<string, Promise<unknown>>();
  let currentWorkspaceOwner: WorkspaceOwner | undefined;
  interface RecoveryPreparationState {
    owner: WorkspaceOwner; token: WorkspaceRepositoryAdmission; batch: WorkspaceBatch; work: WorkRuntime;
    prepared: PreparedWorkspaceMutation; capture: WorkspaceCapture; used: boolean; executing: boolean;
    dispose(): void; release(): void;
  }
  const recoveryPreparations = new WeakMap<WorkspaceRepositoryRecovery, RecoveryPreparationState>();
  let workspaceAdmissionEpoch = 0;
  type AttemptRecord = { scope: ProjectScope; identity: CommitIdentity; requestDigest: string; lower: number; aborted: boolean };
  const attempts = new Map<string, AttemptRecord>();
  // Evidence is neither serialized nor returned to callers. Weak owner identities
  // do not retain obsolete project graphs when the bounded attempt ledger survives.
  const continuationIdentities = new WeakMap<Owner, object>();
  const rollbackEvidence = new WeakMap<AttemptRecord, { owner: object; connectionEpoch: number; workspaceEpoch: number;
    workspaceRevision: number; workspaceDigest: string; before: AuthorityStamp }>();
  let connectionId = 0; let transactionId = 0;
  let connectionLossEpoch = 0;
  let projectOperationEpoch = 0;
  const ownerKey = (scope: ProjectScope) => recordKey(prefix(scope));
  function serial<T>(scope: ProjectScope, operation: () => Promise<T>): Promise<T> {
    safeCounter(projectOperationEpoch + 1); projectOperationEpoch++;
    const key = ownerKey(scope); const result = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(operation);
    queues.set(key, result); void result.finally(() => { if (queues.get(key) === result) queues.delete(key); }).catch(() => {});
    return result;
  }
  async function hash(frame: string): Promise<string> { const digest = await environment.hash(frame); validDigest(digest); return digest; }
  /** Tag only in-memory validation failures. Storage capture remains outside this boundary. */
  async function projectVerification<T>(work: WorkRuntime, check: () => Promise<T>): Promise<T> {
    try { return await check(); }
    catch (error) {
      if (work.stopped() || error instanceof RepositoryConflict || error instanceof Error && error.name === 'AbortError') throw error;
      const failure = new RepositoryConflict('verification-failed');
      if (error instanceof Error) failure.message = error.message;
      throw failure;
    }
  }
  const observePublication = (scope: ProjectScope, stamp: AuthorityStamp, kind: 'local' | 'remote') => {
    // Passive instrumentation cannot undo successful cache publication or change
    // the durable result. Throwing fault hooks live before publication instead.
    try { environment.onPublication?.({ scope, authority: stamp, kind }); } catch { /* observer only */ }
  };
  const attemptKey = (scope: ProjectScope, id: string) => JSON.stringify([prefix(scope), id]);
  const remember = (scope: ProjectScope, identity: CommitIdentity, requestDigest: string, lower: number, aborted: boolean) => {
    const key = attemptKey(scope, identity.commitId), entry = { scope, identity, requestDigest, lower, aborted };
    attempts.delete(key); attempts.set(key, entry);
    while (attempts.size > 32 || jsonBytes([...attempts.values()]) > 64 * 1024) attempts.delete(attempts.keys().next().value!);
    return entry;
  };
  function open(): Promise<{ db: IDBDatabase; id: number }> {
    return new Promise((resolve, reject) => {
      const request = environment.indexedDB.open(environment.databaseName);
      request.onupgradeneeded = () => { request.transaction!.abort(); };
      request.onerror = () => reject(new Error('ingress-required: normalized database unavailable'));
      request.onblocked = () => reject(new Error('normalized database blocked'));
      request.onsuccess = () => {
        const db = request.result;
        if (db.version !== 3 || !stores.every(s => db.objectStoreNames.contains(s))) { db.close(); reject(new Error('ingress-required: normalized schema unavailable')); return; }
        const lost = () => { connectionLossEpoch++; for (const owner of owners.values()) owner.valid = false; };
        db.onclose = lost;
        db.onversionchange = () => { lost(); db.close(); };
        resolve({ db, id: ++connectionId });
      };
    });
  }

  async function readSourceRows(): Promise<SourceCapture> {
    const { db } = await open();
    try {
      return await new Promise<SourceCapture>((resolve, reject) => {
        const tx = db.transaction([...sourceStores, 'normalizationLedger'], 'readonly');
        const result: SourceCapture = { projects: [], workspace: [], presets: [], pendingImports: [], migrationLedger: [], legacyBackup: [], normalizationLedger: [] };
        tx.oncomplete = () => resolve(result); tx.onabort = () => reject(tx.error ?? new Error('Source read aborted'));
        for (const store of [...sourceStores, 'normalizationLedger'] as const) {
          const request = tx.objectStore(store).getAll(); request.onsuccess = () => { result[store] = request.result; };
        }
      });
    } finally { db.close(); }
  }

  async function readNormalizationSource(): Promise<NormalizationSource> {
    return withRead(undefined, context => context.source());
  }

  async function sourceFromRows(rows: SourceCapture): Promise<NormalizationSource> {
    if (rows.normalizationLedger.length === 0) return prepareSource(rows);
    requireContract(rows.normalizationLedger.length === 1, 'Unrecognized normalization attempt');
    const marker = rows.normalizationLedger[0];
    validateNormalizationLedger(marker);
    const archives = rows.legacyBackup.filter(value => value !== null && typeof value === 'object'
      && Reflect.get(value, 'id') === marker.sourceArchiveId);
    requireContract(archives.length === 1, 'Missing normalization archive');
    const archive = exactFields(archives[0], ['id', 'kind', 'formatVersion', 'sourceKind', 'ledger', 'workspace',
      'presets', 'pendingImports', 'projectMetadata', 'backupDigests', ...(marker.sourceKind === 'fresh' ? ['seed'] : [])]);
    requireContract(archive.kind === 'normalization-source' && archive.formatVersion === 3 && archive.sourceKind === marker.sourceKind
      && Array.isArray(archive.presets) && Array.isArray(archive.pendingImports), 'Unrecognized normalization archive');
    if (marker.sourceKind === 'fresh') requireContract(rows.projects.length === 0 && rows.migrationLedger.length === 0
      && archive.ledger === null && Array.isArray(archive.seed), 'Unexpected fresh source records');
    const source = await prepareSource({ ...rows, projects: marker.sourceKind === 'fresh' ? archive.seed as unknown[] : rows.projects,
      workspace: [archive.workspace], presets: archive.presets, pendingImports: archive.pendingImports,
      migrationLedger: marker.sourceKind === 'fresh' ? [] : [archive.ledger], legacyBackup: rows.legacyBackup.filter(value => value !== archives[0]) }, marker.sourceKind);
    const expected = await reservation(source);
    requireContract(JSON.stringify(expected.archive) === JSON.stringify(archives[0]), 'Normalization archive mismatch');
    const { state, nextRecord, progressRevision, verificationDigest, verifiedProgressRevision, cutoverRevision } = marker;
    requireContract(canonicalStringify(marker) === canonicalStringify({ ...expected.attempt, state, nextRecord,
      progressRevision, verificationDigest, verifiedProgressRevision, cutoverRevision }), 'Normalization source mismatch');
    return marker.sourceKind === 'fresh' ? { ...source, retainedSeed: true } : source;
  }

  async function prepareSource(rows: SourceRows, kind: NormalizationSource['kind'] = 'historical'): Promise<NormalizationSource> {
    const preparation = environment.normalization;
    requireContract(preparation, 'Normalization prerequisites required');
    const ledger = kind === 'historical' && isRecognizedLedger(rows.migrationLedger[0]) ? rows.migrationLedger[0] : null;
    if (kind === 'historical') requireContract(rows.migrationLedger.length === 1 && isRecognizedLedger(ledger)
      && ledger.state === 'verified' && ledger.unresolvedRecovery === null, 'Historical admission required');
    else requireContract(rows.migrationLedger.length === 0 && rows.legacyBackup.length === 0 && rows.presets.length === 0
      && rows.pendingImports.length === 0, 'Invalid fresh seed ancestry');
    requireContract(ledger === null || isRecognizedLedger(ledger), 'Invalid source ledger');
    requireContract(rows.workspace.length === 1, 'Unrecognized source workspace');
    const { records } = reconstructWorkspaceRecords({ projects: rows.projects, workspace: rows.workspace[0],
      presets: rows.presets, pendingImports: rows.pendingImports });
    if (ledger) safeCounter(ledger.ledgerRevision); safeCounter(records.workspace.revision);
    for (const record of records.projects) safeCounter(record.storageRevision);
    const backups: LegacyBackupRecord[] = [];
    for (const candidate of rows.legacyBackup) {
      const value = exactFields(candidate, ['id', 'kind', 'capturedAt', 'snapshot', 'digest']);
      requireContract(typeof value.id === 'string' && value.id.length > 0, 'Invalid historical backup identity');
      validDigest(value.digest);
      backups.push(await validateHistoricalBackup(candidate, { id: value.id, digest: value.digest }, preparation.crypto.subtle));
    }
    if (ledger) {
      await validateHistoricalBackup(backups.find(b => b.id === ledger.originalLegacyBackupId), {
        id: ledger.originalLegacyBackupId, digest: ledger.sourceDigest, kind: 'original', capturedAt: ledger.migratedAt,
      }, preparation.crypto.subtle);
      await validateHistoricalBackup(backups.find(b => b.id === ledger.acceptedLegacyBackupId), {
        id: ledger.acceptedLegacyBackupId, digest: ledger.acceptedLegacyDigest,
      }, preparation.crypto.subtle);
    }
    // Historical validation may hydrate transient editor fields. Normalization retains raw bytes instead.
    const projects = records.workspace.projectOrder.map(id => records.projects.find(record => record.id === id)!);
    const snapshot = { projects: projects.map(record => record.project), activeProjectId: records.workspace.activeProjectId,
      customPresets: [...records.presets].sort((a, b) => a.position - b.position).map(record => record.preset),
      pendingImports: [...records.pendingImports].sort((a, b) => a.position - b.position).map(record => record.pendingImport) };
    const sourceProjects = await Promise.all(projects.map(async record => ({ projectId: record.id,
      incarnation: record.incarnation, revision: record.storageRevision, digest: await hash(captureFrame('normalization-project-v1', record)) })));
    const contentDigest = await hash(`["normalization-content-v1",${captureList('projects', snapshot.projects)},${JSON.stringify(snapshot.activeProjectId)},${captureList('presets', snapshot.customPresets)},${captureList('imports', snapshot.pendingImports)}]`);
    const sourceDigest = await hash(`["normalization-source-v1",${canonicalStringify(sourceProjects)},${captureFrame('workspace', records.workspace)},${captureList('presets', records.presets)},${captureList('imports', records.pendingImports)},${ledger ? captureFrame('ledger', ledger) : 'null'},${captureList('backups', backups)}]`);
    return { kind, records, snapshot, ledger, backups, sourceProjects, sourceDigest, contentDigest };
  }

  async function reservation(source: NormalizationSource): Promise<{ attempt: NormalizationAttempt; archive: NormalizationSourceArchive }> {
    // Rederive from records; the caller cannot substitute a trusted digest or snapshot.
    requireContract(source.kind === 'historical' || source.kind === 'fresh', 'Unknown normalization source kind');
    const checked = await prepareSource({ projects: source.records.projects, workspace: [source.records.workspace],
      presets: source.records.presets, pendingImports: source.records.pendingImports,
      migrationLedger: source.ledger ? [source.ledger] : [], legacyBackup: source.backups }, source.kind);
    requireContract(checked.sourceDigest === source.sourceDigest && checked.contentDigest === source.contentDigest,
      'Source digest mismatch');
    // Historical backups share this namespace; no prefix is reserved. Re-deriving
    // from the retained, validated namespace also verifies a recorded attempt's ID.
    const backupIds = new Set(checked.backups.map(backup => backup.id));
    let archiveId = preferredArchiveId;
    for (let suffix = 1; backupIds.has(archiveId); suffix++) archiveId = `${preferredArchiveId}:${suffix}`;
    const attemptId = `normalization:${source.sourceDigest}`; const storageGeneration = `normalized:${source.sourceDigest}`;
    const archive: NormalizationSourceArchive = { id: archiveId, kind: 'normalization-source', formatVersion: 3,
      ...(checked.kind === 'historical' ? { sourceKind: 'historical' as const, ledger: checked.ledger! }
        : { sourceKind: 'fresh' as const, ledger: null, seed: checked.records.projects }), workspace: checked.records.workspace,
      presets: checked.records.presets, pendingImports: checked.records.pendingImports,
      projectMetadata: checked.records.projects.map(({ project: _project, ...metadata }) => metadata),
      backupDigests: await Promise.all(checked.backups.map(async backup => ({ id: backup.id, digest: await hash(captureFrame('backup', backup)) }))) };
    const sourceArchiveDigest = await hash(`["normalization-archive-v1",${captureFrame('workspace', archive.workspace)},${captureList('presets', archive.presets)},${captureList('imports', archive.pendingImports)},${captureList('metadata', archive.projectMetadata)},${canonicalStringify(archive.backupDigests)},${archive.sourceKind === 'historical' ? captureFrame('ledger', archive.ledger) : captureList('fresh-seed', archive.seed)}]`);
    const target = prepareNormalizationTarget(checked);
    const targetManifestDigest = await hash(`["normalization-target-v1",${target.map(({ store, record }) => frameRecord(store, record)).join(',')}]`);
    const workspaceWork = createWorkRuntime({ assertCurrent() {} });
    let initialWorkspaceDigest: string;
    try {
      initialWorkspaceDigest = (await createInitialWorkspaceManifest(checked, { attemptId, sourceKind: checked.kind,
        sourceDigest: checked.sourceDigest, sourceArchiveId: archiveId, sourceArchiveDigest,
        sourceWorkspaceRevision: checked.records.workspace.revision }, workspaceWork)).coreDigest;
    } finally { workspaceWork.dispose(); }
    return { archive, attempt: { id: NORMALIZATION_LEDGER_ID, formatVersion: 3, attemptId, storageGeneration,
      state: 'staging', sourceKind: checked.kind, sourceProjects: checked.sourceProjects, sourceDigest: checked.sourceDigest,
      sourceWorkspaceRevision: checked.records.workspace.revision, sourceLedgerRevision: checked.ledger?.ledgerRevision ?? null,
      sourceArchiveId: archiveId, sourceArchiveDigest, contentDigest: checked.contentDigest, targetManifestDigest,
      workspaceManifestVersion: 1, initialWorkspaceDigest,
      recordCount: target.length, nextRecord: 0, progressRevision: 0, verificationDigest: null,
      verifiedProgressRevision: null, cutoverRevision: null } };
  }

  /** Raw source derivation for an invocation-owned candidate, never a durable cache. */
  async function prepareSourceWork<T>(rows: SourceRows, kind: NormalizationSource['kind'], work: WorkRuntime,
    consume: (prepared: { source: NormalizationSource; archive: NormalizationSourceArchive; sourceArchiveDigest: string }, cursors: SourceTargetCursors) => Promise<T>): Promise<T> {
    const preparation = environment.normalization; requireContract(preparation, 'Normalization prerequisites required');
    const recognized = kind === 'historical' && await work.run(isRecognizedLedgerWork(rows.migrationLedger[0]));
    const ledger = recognized ? rows.migrationLedger[0] as NonNullable<NormalizationSource['ledger']> : null;
    if (kind === 'historical') requireContract(rows.migrationLedger.length === 1 && ledger
      && ledger.state === 'verified' && ledger.unresolvedRecovery === null, 'Historical admission required');
    else requireContract(rows.migrationLedger.length === 0 && rows.legacyBackup.length === 0 && rows.presets.length === 0
      && rows.pendingImports.length === 0, 'Invalid fresh seed ancestry');
    requireContract(rows.workspace.length === 1, 'Unrecognized source workspace');
    return withSourceRecords({ projects: rows.projects, workspace: rows.workspace[0],
      presets: rows.presets, pendingImports: rows.pendingImports }, work, async (records, cursors) => {
    if (ledger) safeCounter(ledger.ledgerRevision); safeCounter(records.workspace.revision);
    const byId = new Map<string, typeof records.projects[number]>();
    for (const record of records.projects) await work.run(effect(1, () => { safeCounter(record.storageRevision); byId.set(record.id, record); }));
    const backups: LegacyBackupRecord[] = []; const backupIndex = new Map<string, LegacyBackupRecord>();
    for (const candidate of rows.legacyBackup) {
      work.setContext(undefined, 'backup', 'legacy');
      const value = await work.run(exactFieldsWork(candidate, ['id', 'kind', 'capturedAt', 'snapshot', 'digest']));
      requireContract(typeof value.id === 'string' && value.id.length > 0, 'Invalid historical backup identity'); validDigest(value.digest);
      const backup = await validateHistoricalBackup(candidate, { id: value.id, digest: value.digest }, preparation.crypto.subtle, work);
      backups.push(backup); backupIndex.set(backup.id, backup);
    }
    if (ledger) {
      const original = backupIndex.get(ledger.originalLegacyBackupId); const accepted = backupIndex.get(ledger.acceptedLegacyBackupId);
      requireContract(original && accepted, 'Missing historical backup');
      requireContract(await work.run(equalFrameWork(canonicalFrame([original.digest, original.kind, original.capturedAt]),
        canonicalFrame([ledger.sourceDigest, 'original', ledger.migratedAt]))), 'Original historical backup mismatch');
      requireContract(await work.run(equalFrameWork(canonicalFrame(accepted.digest), canonicalFrame(ledger.acceptedLegacyDigest))), 'Accepted historical backup mismatch');
    }
    const projects: typeof records.projects = [];
    for (const id of records.workspace.projectOrder) await work.run(effect(1, () => { projects.push(byId.get(id)!); }));
    const presets = await work.run(stableSortWork(records.presets, (a, b) => effect(1, () => a.position - b.position)));
    const imports = await work.run(stableSortWork(records.pendingImports, (a, b) => effect(1, () => a.position - b.position)));
    const snapshot: WorkspaceSnapshot = { projects: [], activeProjectId: records.workspace.activeProjectId, customPresets: [], pendingImports: [] };
    for (const project of projects) await work.run(effect(1, () => { snapshot.projects.push(project.project); }));
    for (const preset of presets) await work.run(effect(1, () => { snapshot.customPresets.push(preset.preset); }));
    for (const pending of imports) await work.run(effect(1, () => { snapshot.pendingImports.push(pending.pendingImport); }));
    work.setContext(undefined, 'source', 'source');
    const { sourceProjects, contentDigest, archive, sourceArchiveDigest } = await hashSourceImages({ kind, records, projects, snapshot, ledger, backups }, work);
    const sourceDigest = await hashFrame(work, 'source', composedFrame('normalization-source-v1', [canonicalFrame(sourceProjects),
      envelopeFrame('workspace', records.workspace), listFrame('presets', records.presets), listFrame('imports', records.pendingImports),
      ledger ? envelopeFrame('ledger', ledger) : canonicalFrame(null), listFrame('backups', backups)]));
    work.note('sourceDerivations');
    return consume({ source: { kind, records, snapshot, ledger, backups, sourceProjects, sourceDigest, contentDigest }, archive, sourceArchiveDigest }, cursors);
    });
  }

  function openNormalizationSession(work: WorkRuntime): NormalizationPreparationSession {
    return createNormalizationSession(work).session;
  }
  function createNormalizationSession(work: WorkRuntime): {
    session: NormalizationPreparationSession; retained(): Promise<NormalizationSource>; selected(scope: ProjectScope): Promise<SelectedActiveRead | undefined>;
    trustedSelected(scope: ProjectScope): Promise<SelectedActiveRead | undefined>;
    workspaceAdmission(editingCustody?: Ownership): Promise<WorkspaceAdmissionRead | undefined>;
    recoveryCapture(): Promise<WorkspaceCapture>;
    source(): Promise<NormalizationSource>;
    stagedRead(attempt: NormalizationAttempt, projectId: string): Promise<NormalizedProject>;
    strictTransition(attempt: NormalizationAttempt, phase: 'verify' | 'activate', digest?: string): Promise<NormalizationAttempt>;
    strictReserve(source: NormalizationSource): Promise<NormalizationAttempt>;
    strictStage(attempt: NormalizationAttempt, records: readonly TaggedNormalizedRecord[]): Promise<NormalizationAttempt>;
  } {
    assertWorkRuntime(work);
    const epoch = connectionLossEpoch;
    let disposed = false; let busy = false; let reserved = false;
    let captured: PagedCapture | undefined; let pass: PreparedPass | undefined;
    let metadataOwner: Ownership | undefined; let info: PreparationInfo | undefined;
    let initialWorkspaceOwner: Ownership | undefined;
    let backupSelectionOwner: Ownership | undefined;
    let retainActiveCapture = false;
    let expectedMarker: NormalizationAttempt | undefined; let markerOwner: Ownership | undefined;
    let seedOwner: Ownership | undefined;
    const pointOwners: Ownership[] = [];
    const ordinals = new Map<string, number>();
    const current = () => {
      if (disposed || epoch !== connectionLossEpoch) throw new DOMException('Normalization session stopped', 'AbortError');
    };
    const removeGuard = work.addGuard(current);
    const releasePoints = () => { for (const owner of pointOwners) owner.release(); pointOwners.length = 0; };
    const releasePreparation = () => {
      if (pass?.emissionPlan) disposeEmissionPlan(pass.emissionPlan);
      pass = undefined; captured?.release(); captured = undefined;
      metadataOwner?.release(); metadataOwner = undefined;
      initialWorkspaceOwner?.release(); initialWorkspaceOwner = undefined;
      backupSelectionOwner?.release(); backupSelectionOwner = undefined;
      seedOwner?.release(); seedOwner = undefined;
    };
    const cleanup = () => { releasePreparation(); expectedMarker = undefined; markerOwner?.release(); markerOwner = undefined;
      info = undefined; releasePoints(); removeGuard(); };
    const dispose = () => { disposed = true; if (!busy) cleanup(); };
    const pause = async (point: 'after-page' | 'before-hash' | 'before-seal') => {
      const phase = work.context().phase; const key = `${phase}:${point}`;
      const ordinal = (ordinals.get(key) ?? 0) + 1; ordinals.set(key, ordinal);
      if (environment.normalizationPause) await work.wait(() => Promise.resolve(environment.normalizationPause!({ phase, point, ordinal })));
    };
    async function operation<T>(phase: Phase, fn: () => Promise<T>): Promise<T> {
      // Let the authentic runtime latch a registered lifecycle failure, including
      // a close delivered while this session was idle, before removing its guard.
      try { work.assertCurrent(); current(); } catch (error) { dispose(); throw error; }
      requireContract(!busy, 'Normalization session already running'); busy = true;
      try { work.setContext(phase); const result = await fn(); work.assertCurrent(); return result; }
      catch (error) { try { work.assertCurrent(); } finally { dispose(); } throw error; }
      finally { busy = false; releasePoints(); if (disposed) cleanup(); }
    }
    async function pointMarker(): Promise<unknown> {
      work.setContext(undefined, 'marker', 'marker');
      let db: IDBDatabase | undefined;
      try {
        await work.wait(async () => { db = (await open()).db; });
        const value = await work.wait(() => new Promise<unknown>((resolve, reject) => {
          work.assertCurrent(); const tx = db.transaction('normalizationLedger', 'readonly'); let value: unknown;
          const request = tx.objectStore('normalizationLedger').get(NORMALIZATION_LEDGER_ID);
          request.onsuccess = () => { value = request.result; };
          tx.oncomplete = () => resolve(value); tx.onabort = () => reject(tx.error ?? new Error('Marker read aborted'));
        }));
        if (value !== undefined) {
          const bytes = (await work.run(rawValueWeightWork(value))).bytes;
          pointOwners.push(work.own(bytes)); work.note('metadataRows'); work.note('metadataBytes', bytes);
        }
        return value;
      } finally { db?.close(); }
    }
    async function discoverHistorical(allowFresh: boolean): Promise<void> {
      work.setContext(undefined, 'marker', 'marker');
      let db: IDBDatabase | undefined;
      try {
        await work.wait(async () => { db = (await open()).db; });
        const discovery = await work.wait(() => new Promise<{ counts: number[]; ledger: unknown }>((resolve, reject) => {
          work.assertCurrent(); const tx = db.transaction([...sourceStores], 'readonly');
          const result = { counts: [] as number[], ledger: undefined as unknown }; let failure: unknown;
          const guard = (fn: () => void) => { try { work.assertCurrent(); fn(); work.assertCurrent(); } catch (error) { failure = error; tx.abort(); } };
          for (const name of sourceStores) {
            const count = tx.objectStore(name).count(); count.onsuccess = () => guard(() => { result.counts.push(count.result); });
          }
          const ledger = tx.objectStore('migrationLedger').get(WORKSPACE_MIGRATION_ID);
          ledger.onsuccess = () => guard(() => { result.ledger = ledger.result; });
          tx.oncomplete = () => resolve(result); tx.onabort = () => reject(failure ?? tx.error ?? new Error('Discovery aborted'));
        }));
        if (discovery.ledger !== undefined) {
          const bytes = (await work.run(rawValueWeightWork(discovery.ledger))).bytes;
          pointOwners.push(work.own(bytes)); work.note('metadataRows'); work.note('metadataBytes', bytes);
        }
        if (discovery.counts.every(count => count === 0)) {
          if (!allowFresh) throw new RepositoryConflict('historical-admission-required');
        } else if (!await work.run(isRecognizedLedgerWork(discovery.ledger))
          || (discovery.ledger as { state: unknown }).state !== 'verified') throw new RepositoryConflict('historical-admission-required');
      } finally { db?.close(); }
    }
    async function capturePages(names: readonly CaptureStore[] = [...sourceStores, ...NORMALIZED_STORE_NAMES]): Promise<PagedCapture> {
      let rows: Map<CaptureStore, CapturedRow[]> | undefined = new Map();
      const owner = work.own(0, true);
      const candidate: PagedCapture = { stores: names, get rows() { requireContract(rows, 'Released normalization candidate'); return rows; },
        dropRows() { rows = undefined; }, release() { rows = undefined; owner.release(); } };
      captured = candidate; // Own partial reads before any yielding work or connection acquisition.
      const before = await pointMarker();
      for (const store of names) {
        work.setContext(undefined, store === 'legacyBackup' ? 'backup' : store === 'normalizationLedger' || store === 'migrationLedger'
          ? 'marker' : stores.includes(store as ProjectStoreName) ? 'target' : 'source', 'none');
        const values: CapturedRow[] = []; rows.set(store, values); let lower: IDBValidKey | undefined;
        for (;;) {
          let db: IDBDatabase | undefined;
          try {
            await work.wait(async () => { db = (await open()).db; });
            const row = await work.wait(() => new Promise<CapturedRow | undefined>((resolve, reject) => {
              work.assertCurrent(); const tx = db.transaction(store, 'readonly'); let result: CapturedRow | undefined; let failure: unknown;
              const request = tx.objectStore(store).openCursor(lower === undefined ? undefined : IDBKeyRange.lowerBound(lower, true));
              request.onsuccess = () => {
                try { work.assertCurrent(); const cursor = request.result;
                  if (cursor) result = { key: cursor.primaryKey, value: cursor.value, bytes: 0 };
                  work.assertCurrent();
                } catch (error) { failure = error; tx.abort(); }
              };
              tx.oncomplete = () => resolve(result); tx.onabort = () => reject(failure ?? tx.error ?? new Error('Normalization page aborted'));
            }));
            work.note('pageTransactions');
            if (row) {
              const expectedKey = store === 'normalizationLedger' || sourceStores.includes(store as typeof sourceStores[number])
                ? (row.value as { id?: unknown })?.id : (row.value as { key?: unknown })?.key;
              requireContract(await work.run(equalFrameWork(orderedFrame(row.key), orderedFrame(expectedKey))), 'Physical key mismatch');
              row.bytes = (await work.run(rawValueWeightWork(row.value))).bytes;
              const keyBytes = (await work.run(rawValueWeightWork(row.key))).bytes;
              owner.grow(row.bytes + keyBytes + 24); values.push(row); lower = row.key;
              const metadata = store === 'normalizationLedger' || store === 'migrationLedger';
              work.note(metadata ? 'metadataRows' : 'candidateRows'); work.note(metadata ? 'metadataBytes' : 'candidateBytes', row.bytes);
            } else work.note('eofChecks');
            await pause('after-page'); // Transaction settled; connection still alive for lifecycle fault tests.
            if (!row) break;
          } finally { db?.close(); }
        }
      }
      const after = await pointMarker();
      const markers = rows.get('normalizationLedger')!;
      const equal = (a: unknown, b: unknown) => a === undefined || b === undefined ? Promise.resolve(a === b)
        : work.run(equalFrameWork(canonicalFrame(a), canonicalFrame(b)));
      if (!await equal(before, after) || markers.length > 1 || !await equal(after, markers[0]?.value)) throw new RepositoryConflict('normalization-contention');
      return candidate;
    }
    async function seal(candidate: PagedCapture, write?: (tx: IDBTransaction, guard: (fn: () => void) => void) => void,
      committed?: () => void, retainedBackups?: readonly CapturedRow[]): Promise<void> {
      requireContract(!retainedBackups || !write, 'Partial backup seals cannot grant write authority');
      await pause('before-seal');
      let db: IDBDatabase | undefined;
      try {
        await work.wait(async () => { db = (await open()).db; });
        await work.wait(() => new Promise<void>((resolve, reject) => {
          work.assertCurrent(); const names = candidate.stores;
          const tx = db.transaction([...names], write ? 'readwrite' : 'readonly'); let failure: unknown;
          const guard = (fn: () => void) => { try { work.assertCurrent(); fn(); work.assertCurrent(); } catch (error) { failure = error; tx.abort(); } };
          tx.oncomplete = () => {
            work.note('sealTransactions');
            try { try { committed?.(); } finally { work.assertCurrent(); } resolve(); } catch (error) { reject(error); }
          };
          tx.onabort = () => reject(failure ?? tx.error ?? new Error('Normalization seal aborted'));
          let index = 0;
          const nextStore = () => {
            const name = names[index++];
            if (!name) { write?.(tx, guard); return; }
            const expected = candidate.rows.get(name)!; let ordinal = 0;
            const compareRecord = (previous: CapturedRow | undefined, value: unknown) => {
              let compared = 0; let complete = false;
              try {
                if (!previous || value === undefined) throw new RepositoryConflict('normalization-contention');
                // Same atomic full-record check and frame grammar, without generating
                // two JSON text streams solely to compare them. No async work in tx.
                const comparison = runSync(stores.includes(name as ProjectStoreName)
                  ? compareRecordWork(name as ProjectStoreName, previous.value as object, value as object)
                  : name === 'legacyBackup' && (previous.value as { kind?: unknown })?.kind === 'normalization-source'
                    ? compareArchiveWork(previous.value as object, value as object)
                    : compareEnvelopeWork('envelope', previous.value as object, value as object));
                compared = comparison.bytes; complete = comparison.equal;
                if (!complete) throw new RepositoryConflict('normalization-contention');
              } finally {
                work.note('primitiveExceptions'); work.note('sealRows'); work.note('sealBytes', compared);
                if (!complete) work.note('unmeasuredValues');
              }
            };
            if (name === 'legacyBackup' && retainedBackups) {
              // The archive pins this exact source subset; unrelated later backups
              // do not become historical export dependencies. All other seals are full.
              const nextBackup = () => {
                const previous = retainedBackups[ordinal++];
                if (!previous) { nextStore(); return; }
                const request = tx.objectStore(name).get(previous.key);
                request.onsuccess = () => guard(() => { compareRecord(previous, request.result); nextBackup(); });
              };
              nextBackup(); return;
            }
            const request = tx.objectStore(name).openCursor();
            request.onsuccess = () => guard(() => {
              const cursor = request.result;
              if (!cursor) { work.note('eofChecks'); if (ordinal !== expected.length) throw new RepositoryConflict('normalization-contention'); nextStore(); return; }
              const previous = expected[ordinal++];
              if (!previous || environment.indexedDB.cmp(cursor.primaryKey, previous.key) !== 0) throw new RepositoryConflict('normalization-contention');
              compareRecord(previous, cursor.value);
              cursor.continue();
            });
          };
          guard(nextStore);
        }));
      } finally { db?.close(); }
    }
    async function deriveCapturedSource<T>(candidate: PagedCapture, { allowFresh, purpose, suppliedSeed }: SourceDerivationOptions,
      consume: (capturedSource: CapturedSourcePass, cursors: SourceTargetCursors) => Promise<T>): Promise<T> {
      const rows = {} as SourceCapture;
      for (const store of [...sourceStores, 'normalizationLedger'] as const) {
        rows[store] = [];
        for (const row of candidate.rows.get(store) ?? []) await work.run(effect(1, () => { rows[store].push(row.value); }));
      }
      requireContract(rows.normalizationLedger.length <= 1, 'Unrecognized normalization attempt');
      const marker = rows.normalizationLedger[0] as NormalizationAttempt | undefined;
      let actualArchive: unknown; let sourceRows: SourceRows = rows; let kind: NormalizationSource['kind'] = 'historical';
      const additionalBackups: LegacyBackupRecord[] = [];
      if (marker) {
        await work.run(validateNormalizationLedgerWork(marker)); kind = marker.sourceKind;
        backupSelectionOwner?.release(); backupSelectionOwner = work.own(0);
        const archives: unknown[] = []; const backups: unknown[] = [];
        for (const value of rows.legacyBackup) await work.run(effect(1, () => {
          backupSelectionOwner!.grow(8);
          if (value && typeof value === 'object' && Reflect.get(value, 'id') === marker.sourceArchiveId) archives.push(value); else backups.push(value);
        }));
        requireContract(archives.length === 1, 'Missing normalization archive'); actualArchive = archives[0];
        const archive = await work.run(exactFieldsWork(actualArchive, ['id', 'kind', 'formatVersion', 'sourceKind', 'ledger', 'workspace',
          'presets', 'pendingImports', 'projectMetadata', 'backupDigests', ...(kind === 'fresh' ? ['seed'] : [])]));
        requireContract(archive.kind === 'normalization-source' && archive.formatVersion === 3 && archive.sourceKind === kind
          && Array.isArray(archive.presets) && Array.isArray(archive.pendingImports), 'Unrecognized normalization archive');
        await work.run(denseDataArrayWork(archive.backupDigests));
        const retainedBackups: unknown[] = []; const selectedBackups = new Set<unknown>();
        for (const rawReference of archive.backupDigests as unknown[]) {
          const reference = await work.run(exactFieldsWork(rawReference, ['id', 'digest']));
          requireContract(typeof reference.id === 'string' && reference.id.length > 0, 'Invalid retained backup identity'); validDigest(reference.digest);
          let found: unknown;
          for (const backup of backups) {
            const metadata = await work.run(dataObjectWork(backup));
            requireContract(typeof metadata.id === 'string' && metadata.id.length > 0, 'Invalid backup identity');
            if (await work.run(compareStringsWork(metadata.id, reference.id)) === 0) {
              requireContract(found === undefined, 'Duplicate retained backup identity'); found = backup;
            }
          }
          requireContract(found !== undefined && !selectedBackups.has(found), 'Missing or duplicate retained backup');
          backupSelectionOwner.grow(16);
          selectedBackups.add(found); retainedBackups.push(found);
        }
        for (const backup of backups) if (!selectedBackups.has(backup)) {
          requireContract(purpose === 'retained' || marker.state === 'active', 'Normalization backup source changed');
          if (purpose !== 'retained') {
            const validated = await projectVerification(work, async () => {
              const metadata = await work.run(dataObjectWork(backup));
              requireContract(metadata.kind !== 'normalization-source', 'Unrecorded normalization archive');
              requireContract(typeof metadata.id === 'string' && metadata.id.length > 0, 'Invalid backup identity'); validDigest(metadata.digest);
              return validateHistoricalBackup(backup, { id: metadata.id, digest: metadata.digest as string }, environment.normalization!.crypto.subtle, work);
            });
            backupSelectionOwner.grow(8); additionalBackups.push(validated);
          } else requireContract((await work.run(dataObjectWork(backup))).kind !== 'normalization-source', 'Unrecorded normalization archive');
        }
        if (kind === 'fresh') requireContract(rows.projects.length === 0 && rows.migrationLedger.length === 0 && archive.ledger === null && Array.isArray(archive.seed), 'Unexpected fresh source records');
        sourceRows = { projects: kind === 'fresh' ? archive.seed as unknown[] : rows.projects, workspace: [archive.workspace],
          presets: archive.presets as unknown[], pendingImports: archive.pendingImports as unknown[],
          migrationLedger: kind === 'fresh' ? [] : [archive.ledger], legacyBackup: retainedBackups };
      } else if (sourceStores.every(store => rows[store].length === 0)) {
        if (!allowFresh) throw new RepositoryConflict('historical-admission-required');
        if (suppliedSeed) { kind = 'fresh'; sourceRows = suppliedSeed; }
        else {
        const preparation = environment.normalization; requireContract(preparation, 'Normalization prerequisites required');
        const id = await work.run(effect(1, () => `proj_${preparation.randomUUID()}`));
        const initialState = await work.run(primitive('clone', () => structuredClone(preparation.createBlankProject())));
        seedOwner = work.own((await work.run(rawValueWeightWork(initialState))).bytes);
        const incarnation = await work.run(effect(1, () => preparation.randomUUID()));
        const updatedAt = await work.run(effect(1, () => preparation.now())); kind = 'fresh';
        sourceRows = { ...rows, projects: [{ id, project: { id, name: 'Blank Project', initialState }, incarnation, storageRevision: 0, updatedAt }],
          workspace: [{ id: 'current', projectOrder: [id], activeProjectId: id, revision: 0 }] };
        }
      } else if (!await work.run(isRecognizedLedgerWork(rows.migrationLedger[0]))
        || (rows.migrationLedger[0] as { state: unknown }).state !== 'verified') throw new RepositoryConflict('historical-admission-required');
      await pause('before-hash');
      work.setContext(undefined, 'source', 'source');
      return prepareSourceWork(sourceRows, kind, work, async ({ source, archive, sourceArchiveDigest }, cursors) => {
      if (marker) requireContract(await work.run(equalSourceArchiveWork(archive, actualArchive)), 'Normalization archive mismatch');
      const facts: SourceMarkerFacts = { attemptId: `normalization:${source.sourceDigest}`, storageGeneration: `normalized:${source.sourceDigest}`,
        sourceKind: source.kind, sourceProjects: source.sourceProjects, sourceDigest: source.sourceDigest,
        sourceWorkspaceRevision: source.records.workspace.revision, sourceLedgerRevision: source.ledger?.ledgerRevision ?? null,
        sourceArchiveId: archive.id, sourceArchiveDigest, contentDigest: source.contentDigest };
      if (marker) {
        const observed: Record<string, unknown> = {};
        for (const field of await work.run(primitive('keys', () => Object.keys(facts)))) await work.run(effect(1, () => {
          Object.defineProperty(observed, field, { value: marker[field as keyof SourceMarkerFacts], enumerable: true, writable: true, configurable: true });
        }));
        requireContract(await work.run(equalFrameWork(canonicalFrame(observed), canonicalFrame(facts))), 'Normalization source mismatch');
      }
      return consume({ source, archive, facts, marker, rows, additionalBackups }, cursors);
      });
    }
    async function deriveTarget(candidate: PagedCapture, { allowFresh, collectImages = false, mode = 'baseline', suppliedSeed, prepareEmission = false }: TargetDerivationOptions): Promise<PreparedPass> {
      function targetContract(condition: unknown, message: string): asserts condition {
        if (!condition && mode === 'active') {
          const failure = new RepositoryConflict('verification-failed'); failure.message = message; throw failure;
        }
        requireContract(condition, message);
      }
      requireContract(!prepareEmission || mode === 'baseline' && !collectImages, 'Emission preparation requires a staging owner');
      return deriveCapturedSource(candidate, { allowFresh, purpose: 'target', suppliedSeed }, async ({ source, archive, facts, marker, rows, additionalBackups }, cursors) => {
      const kind = source.kind; const sourceArchiveDigest = facts.sourceArchiveDigest;
      const initialWorkspace = await createInitialWorkspaceManifest(source, {
        attemptId: `normalization:${source.sourceDigest}`, sourceKind: kind, sourceDigest: source.sourceDigest,
        sourceArchiveId: archive.id, sourceArchiveDigest, sourceWorkspaceRevision: source.records.workspace.revision,
      }, work);
      initialWorkspaceOwner?.release(); initialWorkspaceOwner = undefined;
      initialWorkspaceOwner = work.own((await work.run(rawValueWeightWork(initialWorkspace))).bytes);
      let currentWorkspace: NormalizedWorkspaceManifest | undefined;
      if (mode === 'active') {
        targetContract(marker?.state === 'active' && rows.workspace.length === 1, 'Invalid active workspace');
        currentWorkspace = await projectVerification(work, () => work.run(validateWorkspaceManifestWork(rows.workspace[0])));
        await projectVerification(work, () => verifyWorkspaceReceipts(currentWorkspace!, { revision: marker.sourceWorkspaceRevision, coreDigest: marker.initialWorkspaceDigest }, work));
        targetContract(currentWorkspace.storageGeneration === marker.storageGeneration && await work.run(equalFrameWork(
          canonicalFrame(currentWorkspace.activation), canonicalFrame(initialWorkspace.activation))), 'Workspace activation mismatch');
        const acceptance = currentWorkspace.legacyAcceptance;
        if (acceptance.kind === 'accepted') {
          let accepted = false;
          for (const candidates of [source.backups, additionalBackups]) for (const backup of candidates) {
            if (await work.run(compareStringsWork(backup.id, acceptance.backupId)) === 0) {
              targetContract(!accepted && backup.digest === acceptance.digest, 'Legacy acceptance backup mismatch'); accepted = true;
            }
          }
          targetContract(accepted, 'Missing current legacy acceptance backup');
        }
      }
      const currentMembers = new Map<string, WorkspaceMember>();
      const members = currentWorkspace?.members ?? initialWorkspace.members;
      initialWorkspaceOwner.grow(members.length * 16);
      for (const member of members) await work.run(effect(1, () => { currentMembers.set(member.projectId, member); }));
      if (currentWorkspace) {
        // Source identity is independently derived above; membership may shrink or acquire new births.
        const initialMembers = new Map<string, WorkspaceMember>(); initialWorkspaceOwner.grow(initialWorkspace.members.length * 16);
        for (const member of initialWorkspace.members) await work.run(effect(1, () => { initialMembers.set(member.projectId, member); }));
        for (const member of members) {
          if (member.birth.kind === 'migration') targetContract(await work.run(equalFrameWork(canonicalFrame(member),
            canonicalFrame(initialMembers.get(member.projectId)))), 'Unanchored migration member');
          else targetContract(member.incarnation === await deriveWorkspaceIncarnation(currentWorkspace.storageGeneration,
            member.birth.workspaceRevision, member.birth.memberOrdinal, work), 'Workspace birth incarnation mismatch');
        }
      }
      const targets = new Map<string, { store: ProjectStoreName; value: object }>();
      const images = collectImages ? new Map<string, NormalizedProject>() : undefined;
      if (images) for (const identity of members) await work.run(effect(1, () => {
        images.set(identity.projectId, image({ storageGeneration: `normalized:${source.sourceDigest}`, projectId: identity.projectId, incarnation: identity.incarnation }));
      }));
      for (const store of stores) for (const row of candidate.rows.get(store) ?? []) {
        const key = await work.run(jsonTextWork([store, (row.value as PhysicalRecord).key]));
        targetContract(!targets.has(key), 'Duplicate normalization target'); targets.set(key, { store, value: row.value as object });
        if (images) {
          const record = row.value as PhysicalRecord; const project = images.get(record.key[1]);
          targetContract(project, 'Unexpected normalization project membership');
          targetContract(await work.run(equalFrameWork(orderedFrame(record.key.slice(0, store === 'projectHeaders' ? 2 : 3)),
            orderedFrame(prefix(project.scope).slice(0, store === 'projectHeaders' ? 2 : 3)))), 'Unexpected normalization scope');
          const address = await work.run(jsonTextWork(record.key));
          (project[store] as Map<string, PhysicalRecord>).set(address, record);
        }
      }
      const pairs = new Map<string, Pair>();
      if (mode === 'active') {
        targetContract(marker?.state === 'active' && images, 'Normalization is not active');
        for (const [id, project] of images) {
          const key = prefix(project.scope);
          const header = project.projectHeaders.get(await work.run(jsonTextWork(key.slice(0, 2))));
          const preferences = project.projectPreferences.get(await work.run(jsonTextWork(key)));
          targetContract(header && preferences, 'Missing active project metadata'); pairs.set(id, { header, preferences });
        }
      }
      const cursor = prepareEmission ? cursors.plan(source) : cursors.create(source);
      const recordBytes: number[] = []; const projects = new Map<string, { first: number; count: number }>();
      let prepared: PreparedPass | undefined; let returned = false;
      let targetManifestDigest: string;
      try {
        work.setContext(undefined, 'target', 'target');
        targetManifestDigest = await hashFrame(work, 'target', function* (emit) {
          yield* textWork('["normalization-target-v1",', emit);
          for (;;) {
            const next = yield* cursor.next(); if (next.done === true) break;
            const { store, record } = next.value; const ordinal = recordBytes.length;
            if (ordinal) yield* textWork(',', emit);
            const before = work.snapshot().targetHashBytes;
            let compared = false;
            const compareRecord = function* (actual: object): Work<boolean> {
              compared = true;
              // Keep exact expected hash bytes; actual content needs no second
              // escaped/encoded JSON stream for equality.
              return yield* emitComparedRecordWork(store, record, actual, emit);
            };
            if (mode === 'active') {
              const member = currentMembers.get(record.key[1]);
              if (member?.birth.kind === 'migration') {
              const current = pairs.get(record.key[1])!;
              const address = yield* jsonTextWork([store, record.key]); const actual = targets.get(address);
              if (store === 'projectHeaders') {
                targetContract(yield* equalFrameWork(canonicalFrame(current.header.migrationBaseline),
                  canonicalFrame((record as ProjectHeader).migrationBaseline)), 'Unanchored migration baseline');
              }
              const folds = store === 'projectExtensions' && record.key[3] === 'folds';
              if (folds && !current.preferences.commitProof) targetContract(actual
                && (yield* compareRecord(actual.value)), 'Unanchored initial folds');
              if (!current.header.commitProof) {
                targetContract(actual, 'Missing normalization target');
                if (!compared && !(current.preferences.commitProof && (store === 'projectPreferences' || folds))) {
                  targetContract(yield* compareRecord(actual.value), 'Orphaned normalization target');
                }
              }
              targets.delete(address);
              }
            } else if (ordinal < (marker?.nextRecord ?? 0)) {
              const address = yield* jsonTextWork([store, record.key]); const actual = targets.get(address);
              requireContract(actual && (yield* compareRecord(actual.value)), 'Orphaned normalization target');
              targets.delete(address);
            }
            if (!compared) yield* recordFrame(store, record)(emit);
            recordBytes.push(work.snapshot().targetHashBytes - before);
            const plan = projects.get(record.key[1]) ?? { first: ordinal, count: 0 }; plan.count++; projects.set(record.key[1], plan);
          }
          yield* textWork(']', emit);
        });
      if (mode === 'active') for (const actual of targets.values()) {
        await work.run(effect(1, () => {
          const id = (actual.value as PhysicalRecord).key[1];
          targetContract(currentMembers.get(id)?.birth.kind === 'workspace-command' || pairs.get(id)?.header.commitProof, 'Orphaned normalization target');
        }));
      }
      else requireContract(targets.size === 0, 'Orphaned normalization target');
      requireContract(!marker || marker.nextRecord <= recordBytes.length, 'Missing normalization target');
      work.note('targetDerivations');
      const attempt: NormalizationAttempt = { id: NORMALIZATION_LEDGER_ID, formatVersion: 3, ...facts, state: 'staging', targetManifestDigest,
        workspaceManifestVersion: 1, initialWorkspaceDigest: initialWorkspace.coreDigest, recordCount: recordBytes.length,
        nextRecord: 0, progressRevision: 0, verificationDigest: null, verifiedProgressRevision: null, cutoverRevision: null };
      if (marker) {
        const { state, nextRecord, progressRevision, verificationDigest, verifiedProgressRevision, cutoverRevision } = marker;
        Object.assign(attempt, { state, nextRecord, progressRevision, verificationDigest, verifiedProgressRevision, cutoverRevision });
        requireContract(await work.run(equalFrameWork(canonicalFrame(marker), canonicalFrame(attempt))), 'Normalization source mismatch');
        if (state !== 'staging') requireContract(verificationDigest === await hashFrame(work, 'proof', orderedFrame(['normalization-verification-v2',
          attempt.attemptId, attempt.sourceDigest, attempt.sourceArchiveDigest, attempt.contentDigest, attempt.targetManifestDigest,
          attempt.progressRevision, attempt.recordCount, attempt.workspaceManifestVersion, attempt.initialWorkspaceDigest])), 'Invalid normalization verification');
        // Before activation, archived ancillary data must still be the live baseline.
        const expectedAncillary = kind === 'fresh' ? { workspace: [], presets: [], pendingImports: [], migrationLedger: [] }
          : { workspace: [source.records.workspace], presets: source.records.presets, pendingImports: source.records.pendingImports,
            migrationLedger: source.ledger ? [source.ledger] : [] };
        for (const name of mode === 'baseline' ? ['workspace', 'presets', 'pendingImports', 'migrationLedger'] as const : []) {
          requireContract(await work.run(equalFrameWork(listFrame(name, rows[name] as object[]), listFrame(name, expectedAncillary[name]))), 'Normalization live source mismatch');
        }
      }
      prepared = { source, archive, attempt, recordBytes, projects, images, initialWorkspace, currentWorkspace };
      if (prepareEmission) await work.run(effect(1, () => { prepared!.emissionPlan = (cursor as PlannedTargetCursor).takeEmissionPlan(); }));
      returned = true; return prepared;
      } finally {
        cursor.dispose();
        if (!returned && prepared?.emissionPlan) disposeEmissionPlan(prepared.emissionPlan);
      }
      });
    }
    async function transition(phase: 'verify' | 'activate'): Promise<NormalizationAttempt> {
      const requiredState = phase === 'verify' ? 'staging' : 'verified';
      requireContract(reserved && (pass?.attempt ?? expectedMarker)?.state === requiredState, 'Unexpected normalization phase');
      expectedMarker = await work.run(primitive('clone', () => structuredClone(pass?.attempt ?? expectedMarker!)));
      requireContract(expectedMarker.nextRecord === expectedMarker.recordCount, 'Incomplete normalization verification');
      releasePreparation(); markerOwner?.release(); markerOwner = undefined;
      markerOwner = work.own((await work.run(rawValueWeightWork(expectedMarker))).bytes);
      captured = await capturePages();
      const markers = captured.rows.get('normalizationLedger')!;
      if (markers.length !== 1 || !await work.run(equalFrameWork(canonicalFrame(markers[0].value), canonicalFrame(expectedMarker)))) {
        throw new RepositoryConflict('normalization-contention');
      }
      pass = await deriveTarget(captured, { allowFresh: false, collectImages: true });
      // Source and normalized rows remain owned by the one capture; index entries
      // are views, not cloned payloads. Reconstruct only after baseline streaming ends.
      let sources: Map<string, NormalizationSource['records']['projects'][number]> | undefined = new Map();
      for (const record of pass.source.records.projects) await work.run(effect(1, () => { sources.set(record.id, record); }));
      for (const identity of pass.source.sourceProjects) {
        work.note('projectReconstructions');
        let external = await work.run(reconstructProjectWork(pass.images!.get(identity.projectId)!));
        requireContract(await work.run(equalFrameWork(orderedFrame(external), orderedFrame(sources.get(identity.projectId)!.project))), 'Normalization content mismatch');
        external = undefined;
      }
      sources = undefined;
      const next: NormalizationAttempt = phase === 'verify'
        ? { ...expectedMarker, state: 'verified', verificationDigest: await hashFrame(work, 'proof', orderedFrame(['normalization-verification-v2',
          expectedMarker.attemptId, expectedMarker.sourceDigest, expectedMarker.sourceArchiveDigest, expectedMarker.contentDigest,
          expectedMarker.targetManifestDigest, expectedMarker.progressRevision, expectedMarker.recordCount,
          expectedMarker.workspaceManifestVersion, expectedMarker.initialWorkspaceDigest])), verifiedProgressRevision: expectedMarker.progressRevision }
        : { ...expectedMarker, state: 'active', cutoverRevision: 1 };
      const faultPhase = phase === 'verify' ? 'verify' : 'cutover';
      await seal(captured, (tx, guard) => {
        const issue = () => {
          environment.normalizationFault?.(`${faultPhase}.before-marker`); work.assertCurrent();
          work.note('writes'); const request = tx.objectStore('normalizationLedger').put(next);
          request.onsuccess = () => guard(() => {
            environment.normalizationFault?.(`${faultPhase}.after-marker`); work.assertCurrent();
            environment.normalizationFault?.(`${faultPhase}.before-complete`);
          });
        };
        if (phase === 'activate') {
          environment.normalizationFault?.('cutover.before-workspace'); work.assertCurrent();
          work.note('writes'); const store = tx.objectStore('workspace');
          const request = pass!.source.kind === 'fresh' ? store.add(pass!.initialWorkspace) : store.put(pass!.initialWorkspace);
          request.onsuccess = () => guard(() => {
            environment.normalizationFault?.('cutover.after-workspace'); work.assertCurrent(); issue();
          });
        } else issue();
      }, () => environment.normalizationFault?.(`${faultPhase}.after-commit`));
      expectedMarker = next;
      releasePreparation(); releasePoints();
      markerOwner?.release(); markerOwner = undefined;
      markerOwner = work.own((await work.run(rawValueWeightWork(next))).bytes);
      work.notify('durable');
      return await work.run(primitive('clone', () => structuredClone(next)));
    }
    async function activeRead(): Promise<ActiveRead | undefined>;
    async function activeRead(scope: ProjectScope): Promise<SelectedActiveRead | undefined>;
    async function activeRead(scope: undefined, workspaceAdmission: true, editingCustody?: Ownership): Promise<WorkspaceAdmissionRead | undefined>;
    async function activeRead(scope?: ProjectScope, workspaceAdmission = false, editingCustody?: Ownership): Promise<ActiveRead | SelectedActiveRead | WorkspaceAdmissionRead | undefined> {
      releasePreparation(); expectedMarker = undefined; markerOwner?.release(); markerOwner = undefined;
      const hint = await pointMarker();
      if (hint === undefined) return undefined;
      await work.run(validateNormalizationLedgerWork(hint));
      if ((hint as NormalizationAttempt).state !== 'active') return undefined;
      captured = await capturePages();
      const marker = captured.rows.get('normalizationLedger')!;
      if (marker.length !== 1 || !await work.run(equalFrameWork(canonicalFrame(hint), canonicalFrame(marker[0].value)))) throw new RepositoryConflict('normalization-contention');
      pass = await deriveTarget(captured, { allowFresh: false, collectImages: true, mode: 'active' });
      const workspace = pass.currentWorkspace!;
      const projects = scope || workspaceAdmission ? undefined : new Map<string, WorkspaceProject>();
      const reconstructor = createWorkspaceReconstructor();
      try {
      let selected: SelectedActiveRead | undefined;
      let admissionOwner: Ownership | undefined;
      const projectAuthorities: { scope: ProjectScope; authority: AuthorityStamp }[] | undefined = workspaceAdmission ? [] : undefined;
      if (workspaceAdmission) await work.run(effect(1, () => {
        admissionOwner = work.own(0); pointOwners.push(admissionOwner);
      }));
      const editingProjects: WorkspaceProject[] = [], editingOwners: Owner[] = [];
      for (const member of workspace.members) {
        work.note('projectReconstructions');
        const records = pass.images!.get(member.projectId)!;
        const admission = await projectVerification(work, async () => {
          const header = records.projectHeaders.values().next().value!;
          const stored = { id: member.projectId, incarnation: member.incarnation, storageRevision: header.storageRevision,
            updatedAt: header.updatedAt ?? (member.birth.kind === 'migration' ? member.birth.sourceUpdatedAt : member.birth.createdAt),
            ...member.consumedImport };
          const external = await work.run(reconstructor.project(records, stored));
          if (member.birth.kind === 'workspace-command') await verifyProjectBirth(records, member, work);
          return verifyBulk(records, true, work, external);
        });
        const external = admission.external;
        if (editingCustody) {
          const parts = await work.run(partitionStateWork(external.initialState));
          const references = await work.run(buildReferenceIndexWork(parts.document, editingCustody));
          const foldsRecord = records.projectExtensions.get(await work.run(jsonTextWork([...prefix(records.scope), 'folds'])))!;
          const folds = await work.run(createFoldOverlayIndexWork(admission.preferences, foldsRecord, editingCustody));
          await work.run(effect(1, () => {
            editingCustody.grow(160);
            editingProjects.push(external);
            editingOwners.push({ records, references, folds, stamp: admission.stamp, lastVerified: { ...admission.stamp }, valid: true,
              ...(admission.preferences.revision === 0 && admission.preferences.commitProof === null ? { initialFoldRecordDigest: admission.foldRecordDigest } : {}) });
          }));
        }
        if (workspaceAdmission) await work.run(effect(1, () => {
          admissionOwner!.grow(72);
          projectAuthorities!.push({ scope: { ...records.scope }, authority: { ...admission.stamp } });
        }));
        if (scope && records.scope.projectId === scope.projectId && records.scope.storageGeneration === scope.storageGeneration
          && records.scope.incarnation === scope.incarnation) selected = { records, admission };
        projects?.set(member.projectId, external);
      }
      const live = { workspace: [] as unknown[], presets: [] as unknown[], pendingImports: [] as unknown[] };
      for (const name of ['workspace', 'presets', 'pendingImports'] as const) for (const row of captured.rows.get(name)!) {
        await work.run(effect(1, () => { live[name].push(row.value); }));
      }
      requireContract(live.workspace.length === 1, 'Invalid active workspace');
      const projectedWorkspace = await work.run(projectWorkspaceOrderWork(workspace));
      for (const [name, descriptors] of [['presets', workspace.presets], ['pendingImports', workspace.pendingImports]] as const) {
        requireContract(live[name].length === descriptors.length, 'Active ancillary membership mismatch');
        for (const raw of live[name]) {
          const row = await work.run(dataObjectWork(raw)); safeCounter(row.position);
          requireContract(typeof row.id === 'string' && row.id.length > 0, 'Invalid ancillary identity');
        }
        const orderingOwner = work.own(0);
        try {
          orderingOwner.grow(live[name].length * 16);
          const ordered = await work.run(stableSortWork(live[name] as { id: string; position: number }[],
            (a, b) => effect(1, () => a.position - b.position)));
          for (let index = 0; index < ordered.length; index++) {
            const row = ordered[index]; const descriptor = descriptors[index];
            requireContract(await work.run(compareStringsWork(descriptor.id, row.id)) === 0 && descriptor.position === row.position
              && descriptor.recordDigest === await hashFrame(work, 'proof',
                envelopeFrame(name === 'presets' ? 'workspace-preset-v1' : 'workspace-import-v1', row)), 'Active ancillary descriptor mismatch');
            if (name === 'pendingImports') {
              const stored = row as StoredPendingImport;
              await work.run(dataObjectWork(stored.pendingImport));
              const expected = { id: stored.id, position: stored.position, recordDigest: descriptor.recordDigest,
                targetProjectId: stored.pendingImport.targetProjectId, createdAt: stored.pendingImport.createdAt,
                pendingImportDigest: await hashFrame(work, 'proof', canonicalFrame(stored.pendingImport)),
                ...(Object.hasOwn(stored, 'attemptProvenance') ? { attemptProvenance: stored.attemptProvenance } : {}) };
              requireContract(await work.run(equalFrameWork(canonicalFrame(descriptor), canonicalFrame(expected))), 'Active import descriptor mismatch');
            }
          }
        } finally { orderingOwner.release(); }
      }
      const records = await work.run(reconstructor.ancillary({ workspace: projectedWorkspace, presets: live.presets, pendingImports: live.pendingImports }));
      if (scope || workspaceAdmission) {
        if (workspaceAdmission) {
          const result: WorkspaceAdmissionRead = { authority: pass.attempt as ActiveAuthority, workspace,
            catalog: await work.run(projectWorkspaceCatalogWork(workspace)), projectAuthorities: projectAuthorities! };
          if (editingCustody) {
            const snapshot: WorkspaceSnapshot = { projects: editingProjects, activeProjectId: workspace.activeProjectId, customPresets: [], pendingImports: [] };
            for (const row of await work.run(stableSortWork(live.presets as { position: number; preset: WorkspaceSnapshot['customPresets'][number] }[],
              (a, b) => effect(1, () => a.position - b.position)))) await work.run(effect(1, () => { snapshot.customPresets.push(row.preset); }));
            for (const row of await work.run(stableSortWork(live.pendingImports as StoredPendingImport[],
              (a, b) => effect(1, () => a.position - b.position)))) await work.run(effect(1, () => { snapshot.pendingImports.push(row.pendingImport); }));
            result.editing = { owners: editingOwners, active: { authority: result.authority, workspace, snapshot,
              source: { kind: pass.source.kind, acceptedLegacyDigest: workspace.legacyAcceptance.kind === 'accepted' ? workspace.legacyAcceptance.digest : null } } };
          }
          await seal(captured); if (!retainActiveCapture) releasePreparation(); return result;
        }
        await seal(captured);
        releasePreparation(); return selected;
      }
      const snapshot: WorkspaceSnapshot = { projects: [], activeProjectId: records.workspace.activeProjectId, customPresets: [], pendingImports: [] };
      for (const id of records.workspace.projectOrder) await work.run(effect(1, () => { snapshot.projects.push(projects!.get(id)!); }));
      for (const item of await work.run(stableSortWork(records.presets, (a, b) => effect(1, () => a.position - b.position)))) snapshot.customPresets.push(item.preset);
      for (const item of await work.run(stableSortWork(records.pendingImports, (a, b) => effect(1, () => a.position - b.position)))) snapshot.pendingImports.push(item.pendingImport);
      await seal(captured);
      const result: ActiveRead = { authority: pass.attempt as ActiveAuthority, workspace, snapshot,
         source: { kind: pass.source.kind, acceptedLegacyDigest: workspace.legacyAcceptance.kind === 'accepted' ? workspace.legacyAcceptance.digest : null } };
      releasePreparation(); return result;
      } finally { reconstructor.dispose(); }
    }
    /** Editor/workspace admission of an already activated generation. Activation
     * verified the migration once; ordinary opens trust that ledger and read the
     * current records in one readonly transaction (an atomic snapshot, so no
     * seal is needed). Every project is still reconstructed and checked with the
     * plain codec/validateAppState path. Proof chains, source archives and
     * backups are not re-derived here; export and recovery keep the full read. */
    // Exhausts the current quantum so progress replies and cancellation can run
    // between the large synchronous steps of a trusted open.
    const checkpoint = () => work.run(effect(1024, () => {}));
    const trustedFailure = (message: string): never => {
      const failure = new RepositoryConflict('verification-failed'); failure.message = message; throw failure;
    };
    /** One readonly transaction over the active generation; `only` limits project
     * stores to that member's key range. */
    async function trustedCapture(only?: ProjectScope) {
      releasePreparation(); expectedMarker = undefined; markerOwner?.release(); markerOwner = undefined;
      work.assertCurrent();
      const names = ['normalizationLedger', 'workspace', 'presets', 'pendingImports', ...stores] as const;
      const rows = new Map<string, unknown[]>();
      const range = only && IDBKeyRange.bound([only.storageGeneration, only.projectId], [only.storageGeneration, only.projectId, []]);
      const { db } = await open();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction([...names], 'readonly');
          tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? new Error('Active read aborted'));
          for (const name of names) {
            const request = tx.objectStore(name).getAll(range && stores.includes(name as ProjectStoreName) ? range : undefined);
            request.onsuccess = () => { rows.set(name, request.result); };
          }
        });
      } finally { db.close(); }
      await pause('after-page'); await checkpoint();
      const markers = rows.get('normalizationLedger')!;
      if (markers.length === 0) return undefined;
      requireContract(markers.length === 1, 'Unrecognized normalization attempt');
      const marker = markers[0] as NormalizationAttempt;
      validateNormalizationLedger(marker);
      if (marker.state !== 'active') return undefined;
      const workspaceRows = rows.get('workspace')!;
      if (workspaceRows.length !== 1) trustedFailure('Invalid active workspace');
      let workspace: NormalizedWorkspaceManifest;
      try { workspace = runSync(validateWorkspaceManifestWork(workspaceRows[0])); } catch { return trustedFailure('Invalid active workspace'); }
      if (workspace.storageGeneration !== marker.storageGeneration) trustedFailure('Workspace activation mismatch');

      const images = new Map<string, NormalizedProject>();
      for (const member of workspace.members) if (!only || member.projectId === only.projectId) images.set(member.projectId,
        image({ storageGeneration: workspace.storageGeneration, projectId: member.projectId, incarnation: member.incarnation }));
      for (const store of stores) for (const raw of rows.get(store)!) {
        const record = raw as PhysicalRecord; const project = images.get(record.key[1]);
        if (!project) return trustedFailure('Unexpected normalization project membership');
        const scope = prefix(project.scope);
        if (record.key[0] !== scope[0] || store !== 'projectHeaders' && record.key[2] !== scope[2]) trustedFailure('Unexpected normalization scope');
        setRecord(project, store, record);
      }
      return { marker, workspace, images, rows };
    }
    async function trustedProject(records: NormalizedProject) {
      await checkpoint();
      const { header, preferences } = pair(records);
      let external: WorkspaceProject;
      try { external = reconstructProject(records); } catch (error) { return trustedFailure(`Invalid active project: ${String((error as Error)?.message ?? error)}`); }
      const foldsRecord = records.projectExtensions.get(recordKey([...prefix(records.scope), 'folds']))!;
      const foldRecordDigest = await hash(frameRecord('projectExtensions', foldsRecord));
      if (preferences.revision && foldRecordDigest !== preferences.foldRecordDigest) trustedFailure('Fold record mismatch');
      return { external, preferences, stamp: authority(header, preferences), foldRecordDigest, foldsRecord };
    }
    async function trustedSelected(scope: ProjectScope): Promise<SelectedActiveRead | undefined> {
      const captured = await trustedCapture(scope);
      if (!captured) return undefined;
      const records = captured.images.get(scope.projectId);
      if (!records || records.scope.incarnation !== scope.incarnation) return undefined;
      const { external, preferences, stamp, foldRecordDigest } = await trustedProject(records);
      return { records, admission: { external, preferences, stamp, foldRecordDigest } };
    }
    async function trustedWorkspaceAdmission(editingCustody?: Ownership): Promise<WorkspaceAdmissionRead | undefined> {
      const captured = await trustedCapture();
      if (!captured) return undefined;
      const { marker, workspace, images, rows } = captured;
      const fail = trustedFailure;

      const projectAuthorities: { scope: ProjectScope; authority: AuthorityStamp }[] = [];
      const editingProjects: WorkspaceProject[] = [], editingOwners: Owner[] = [];
      for (const member of workspace.members) {
        const records = images.get(member.projectId)!;
        const { external, preferences, stamp, foldRecordDigest, foldsRecord } = await trustedProject(records);
        projectAuthorities.push({ scope: { ...records.scope }, authority: { ...stamp } });
        if (!editingCustody) continue;
        editingProjects.push(external);
        editingOwners.push({ records, references: buildReferenceIndex(partitionState(external.initialState).document),
          folds: createFoldOverlayIndex(preferences, foldsRecord), stamp, lastVerified: { ...stamp }, valid: true,
          ...(preferences.revision === 0 && preferences.commitProof === null ? { initialFoldRecordDigest: foldRecordDigest } : {}) });
      }

      const ordered = <T extends { position: number }>(name: 'presets' | 'pendingImports', descriptors: readonly { id: string; position: number }[]): T[] => {
        const live = [...rows.get(name)! as T[]].sort((a, b) => a.position - b.position);
        if (live.length !== descriptors.length) fail('Active ancillary membership mismatch');
        live.forEach((row, index) => {
          const descriptor = descriptors[index], id = (row as { id?: unknown }).id;
          if (typeof id !== 'string' || id !== descriptor.id || row.position !== descriptor.position) fail('Active ancillary descriptor mismatch');
        });
        return live;
      };
      const presets = ordered<{ position: number; preset: WorkspaceSnapshot['customPresets'][number] }>('presets', workspace.presets);
      const pendingImports = ordered<StoredPendingImport>('pendingImports', workspace.pendingImports);
      work.assertCurrent();

      const result: WorkspaceAdmissionRead = { authority: marker as ActiveAuthority, workspace,
        catalog: runSync(projectWorkspaceCatalogWork(workspace)), projectAuthorities };
      if (editingCustody) {
        const snapshot: WorkspaceSnapshot = { projects: editingProjects, activeProjectId: workspace.activeProjectId,
          customPresets: presets.map(row => row.preset), pendingImports: pendingImports.map(row => row.pendingImport) };
        result.editing = { owners: editingOwners, active: { authority: result.authority, workspace, snapshot,
          source: { kind: marker.sourceKind, acceptedLegacyDigest: workspace.legacyAcceptance.kind === 'accepted' ? workspace.legacyAcceptance.digest : null } } };
      }
      return result;
    }
    async function retainedRead(allowFresh = false): Promise<NormalizationSource> {
      releasePreparation();
      const hint = await pointMarker();
      if (hint !== undefined) await work.run(validateNormalizationLedgerWork(hint));
      const names: CaptureStore[] = hint === undefined ? [...sourceStores, 'normalizationLedger']
        : (hint as NormalizationAttempt).sourceKind === 'fresh'
          ? ['projects', 'legacyBackup', 'migrationLedger', 'normalizationLedger'] : ['projects', 'legacyBackup', 'normalizationLedger'];
      captured = await capturePages(names);
      const markers = captured.rows.get('normalizationLedger')!;
      if (hint === undefined ? markers.length !== 0 : markers.length !== 1
        || !await work.run(equalFrameWork(canonicalFrame(hint), canonicalFrame(markers[0].value)))) throw new RepositoryConflict('normalization-contention');
      const retained = await deriveCapturedSource(captured, { allowFresh, purpose: 'retained' }, async source => source);
      const result = retained.source.kind === 'fresh' && hint !== undefined ? { ...retained.source, retainedSeed: true as const } : retained.source;
      const selectionOwner = work.own(0);
      try {
        let selectedBackups: CapturedRow[] | undefined;
        if (hint !== undefined) {
          const ids = [retained.archive.id]; selectionOwner.grow(8);
          for (const backup of retained.source.backups) await work.run(effect(1, () => { selectionOwner.grow(8); ids.push(backup.id); }));
          selectedBackups = [];
          for (const id of ids) {
            let selected: CapturedRow | undefined;
            for (const row of captured.rows.get('legacyBackup')!) {
              if (await work.run(equalFrameWork(canonicalFrame(row.key), canonicalFrame(id)))) {
                requireContract(!selected, 'Duplicate retained backup key'); selected = row;
              }
            }
            requireContract(selected, 'Missing retained backup key');
            selectionOwner.grow(8); selectedBackups.push(selected);
          }
        }
        await seal(captured, undefined, undefined, selectedBackups); releasePreparation(); return result;
      } finally { selectionOwner.release(); }
    }
    async function captureInputMarker(input: NormalizationAttempt): Promise<void> {
      // The first Work operation runs synchronously, before its Promise is awaited.
      // Detach nested caller metadata before any suspension or observer callback.
      expectedMarker = await work.run(primitive('clone', () => structuredClone(input)));
      markerOwner = work.own((await work.run(rawValueWeightWork(expectedMarker))).bytes);
      await work.run(validateNormalizationLedgerWork(expectedMarker));
    }
    const strictTransition = (input: NormalizationAttempt, phase: 'verify' | 'activate', digest?: string) => operation(phase, async () => {
      await captureInputMarker(input);
      if (phase === 'verify') requireContract(digest === expectedMarker!.contentDigest, 'Incomplete normalization verification');
      reserved = true;
      return transition(phase);
    });
    const stagedRead = (input: NormalizationAttempt, projectId: string) => operation('verify', async () => {
      await captureInputMarker(input);
      requireContract(expectedMarker!.state !== 'active' && expectedMarker!.nextRecord === expectedMarker!.recordCount, 'Incomplete staged workspace');
      captured = await capturePages();
      const markers = captured.rows.get('normalizationLedger')!;
      if (markers.length !== 1 || !await work.run(equalFrameWork(canonicalFrame(markers[0].value), canonicalFrame(expectedMarker)))) {
        throw new RepositoryConflict('normalization-contention');
      }
      pass = await deriveTarget(captured, { allowFresh: false, collectImages: true });
      const project = pass.images!.get(projectId); requireContract(project, 'Unknown normalization project');
      work.note('projectReconstructions'); await work.run(reconstructProjectWork(project));
      await seal(captured); releasePreparation(); return project;
    });
    async function reservePrepared(): Promise<NormalizationAttempt> {
      requireContract(pass && captured && info?.state === 'prepared', 'Normalization preparation required');
      requireContract(!reserved, 'Normalization already reserved');
      const existing = captured.rows.get('normalizationLedger')!.length !== 0;
      const prepared = pass;
      await seal(captured, existing ? () => {} : (tx, guard) => {
        environment.normalizationFault?.('reservation.before-archive'); work.assertCurrent();
        const add = tx.objectStore('legacyBackup').add(prepared.archive); work.note('writes');
        add.onsuccess = () => guard(() => {
          environment.normalizationFault?.('reservation.after-archive'); work.assertCurrent();
          environment.normalizationFault?.('reservation.before-marker'); work.assertCurrent();
          const marker = tx.objectStore('normalizationLedger').add(prepared.attempt); work.note('writes');
          marker.onsuccess = () => guard(() => { environment.normalizationFault?.('reservation.after-marker'); work.assertCurrent(); environment.normalizationFault?.('reservation.before-complete'); });
        });
      });
      if (!existing) { environment.normalizationFault?.('reservation.after-commit'); work.assertCurrent(); work.notify('durable'); }
      reserved = true;
      // Keep the captured-source lease until disposal, but drop physical/prefix containers.
      captured.dropRows();
      return await work.run(primitive('clone', () => structuredClone(prepared.attempt)));
    }
    const strictReserve = (input: NormalizationSource) => operation('reserve', async () => {
      const source = await work.run(primitive('clone', () => structuredClone(input)));
      pointOwners.push(work.own((await work.run(rawValueWeightWork(source))).bytes));
      requireContract(source.kind === 'historical' || source.kind === 'fresh', 'Unknown normalization source kind');
      const rows: SourceRows = { projects: source.records.projects, workspace: [source.records.workspace],
        presets: source.records.presets, pendingImports: source.records.pendingImports,
        migrationLedger: source.ledger ? [source.ledger] : [], legacyBackup: source.backups };
      await pause('before-hash');
      const { source: checked } = await prepareSourceWork(rows, source.kind, work, async source => source);
      requireContract(checked.sourceDigest === source.sourceDigest && checked.contentDigest === source.contentDigest, 'Source digest mismatch');
      requireContract(await work.run(equalFrameWork(orderedFrame(checked.snapshot), orderedFrame(source.snapshot))), 'Source snapshot mismatch');
      // Preserve the strict API's idempotent concurrent-reservation behavior.
      // Each retry recaptures/rederives physical facts; caller input stays detached.
      for (let retry = 0; retry < 8; retry++) {
      if (retry) work.note('retries');
      releasePreparation();
      try {
      captured = await capturePages();
      const markers = captured.rows.get('normalizationLedger')!;
      if (markers.length === 1) {
        await work.run(validateNormalizationLedgerWork(markers[0].value));
        const marker = markers[0].value as NormalizationAttempt;
        if (marker.state === 'active' || source.kind === 'fresh' && marker.sourceKind === 'fresh' && marker.sourceDigest !== source.sourceDigest) {
          throw new RepositoryConflict('normalization-contention');
        }
      }
      pass = await deriveTarget(captured, { allowFresh: source.kind === 'fresh', suppliedSeed: source.kind === 'fresh' ? rows : undefined });
      requireContract(pass.source.sourceDigest === checked.sourceDigest && pass.source.contentDigest === checked.contentDigest, 'Source changed before reservation');
      info = { state: 'prepared', source: { kind: pass.source.kind, acceptedLegacyDigest: pass.source.ledger?.acceptedLegacyDigest ?? null } };
      return await reservePrepared();
      } catch (error) {
        work.assertCurrent();
        if (!(error instanceof RepositoryConflict) || error.reason !== 'normalization-contention') throw error;
      }
      }
      throw new RepositoryConflict('normalization-contention');
    });
    const strictStage = (attempt: NormalizationAttempt, records: readonly TaggedNormalizedRecord[]) => operation('stage', async () => {
      const input = await work.run(primitive('clone', () => structuredClone({ attempt, records })));
      pointOwners.push(work.own((await work.run(rawValueWeightWork(input))).bytes));
      await work.run(validateNormalizationLedgerWork(input.attempt));
      requireContract(input.attempt.state === 'staging' && Array.isArray(input.records)
        && input.records.length > 0 && input.records.length <= STAGE_RECORD_LIMIT, 'Invalid normalization batch');
      let bytes = 0;
      for (const item of input.records) {
        requireContract(stores.includes(item.store as ProjectStoreName), 'Ledger cannot be staged');
        bytes += await work.run(frameBytesWork(recordFrame(item.store as ProjectStoreName, item.record)));
      }
      requireContract(input.records.length === 1 || bytes <= STAGE_BYTE_LIMIT, 'Normalization batch exceeds byte budget');
      captured = await capturePages();
      const markers = captured.rows.get('normalizationLedger')!;
      if (markers.length !== 1 || !await work.run(equalFrameWork(canonicalFrame(markers[0].value), canonicalFrame(input.attempt)))) {
        throw new RepositoryConflict('normalization-contention');
      }
      pass = await deriveTarget(captured, { allowFresh: false, prepareEmission: true });
      requireContract(pass.emissionPlan, 'Missing prepared emission plan');
      let cursor: EmissionCursor | undefined;
      try {
        await work.run(effect(1, () => { cursor = openEmissionCursor(pass!.emissionPlan!, pass!.source, input.attempt.nextRecord); }));
        for (const item of input.records) {
          const expected = await work.run(cursor!.next());
          requireContract(expected.done === false && expected.value.store === item.store
            && await work.run(equalFrameWork(recordFrame(expected.value.store, expected.value.record), recordFrame(item.store as ProjectStoreName, item.record))), 'Unexpected normalization batch');
        }
      } finally { cursor?.dispose(); }
      const next = { ...input.attempt, nextRecord: input.attempt.nextRecord + input.records.length,
        progressRevision: input.attempt.progressRevision + 1 };
      await work.run(validateNormalizationLedgerWork(next));
      await writeNormalizationStage(input.attempt, input.records as TargetRecord[], next, work);
      work.notify('durable'); releasePreparation(); return next;
    });
    const session: NormalizationPreparationSession = {
      prepare: options => {
        const allowFresh = options?.allowFresh !== false;
        return operation('prepare', async () => {
        if (info) return info.state === 'active' ? { state: 'active' } : { state: 'prepared', source: { ...info.source } };
        const marker = await pointMarker();
        if (marker !== undefined) {
          await work.run(validateNormalizationLedgerWork(marker));
          if ((marker as NormalizationAttempt).state === 'active') { info = { state: 'active' }; return { state: 'active' }; }
        } else await discoverHistorical(allowFresh);
        const candidate = await capturePages(); pass = await deriveTarget(candidate, { allowFresh, prepareEmission: true });
        // New metadata is counted separately; captured source payload remains borrowed.
        const metadata = { recordBytes: pass.recordBytes, projects: pass.projects, attempt: pass.attempt,
          projectMetadata: pass.archive.projectMetadata, backupDigests: pass.archive.backupDigests };
        metadataOwner = work.own((await work.run(rawValueWeightWork(metadata))).bytes);
        info = { state: 'prepared', source: { kind: pass.source.kind, acceptedLegacyDigest: pass.source.ledger?.acceptedLegacyDigest ?? null } };
        return { state: 'prepared', source: { ...info.source } };
        });
      },
      reserve: () => operation('reserve', reservePrepared),
      stageNext: () => operation('stage', async () => {
        requireContract(reserved && pass && pass.attempt.state === 'staging'
          && pass.attempt.nextRecord < pass.attempt.recordCount, 'Incomplete or exhausted normalization staging');
        const prepared = pass;
        requireContract(prepared.emissionPlan, 'Missing prepared emission plan');
        let cursor: EmissionCursor | undefined; let ordinal = prepared.attempt.nextRecord;
        let batch: TargetRecord[] = []; let bytes = 0; const owner = work.own(0);
        try {
          await work.run(effect(1, () => { cursor = openEmissionCursor(prepared.emissionPlan!, prepared.source, ordinal); }));
          while (ordinal < prepared.recordBytes.length && batch.length < STAGE_RECORD_LIMIT) {
            const size = prepared.recordBytes[ordinal];
            if (batch.length && bytes + size > STAGE_BYTE_LIMIT) break;
            const next = await work.run(cursor!.next()); requireContract(next.done === false, 'Missing normalization target');
            batch.push(next.value); bytes += size; ordinal++;
            // Bounded batch lease uses already-measured exact frame bytes, not another payload walk.
            owner.grow(size);
            if (size > STAGE_BYTE_LIMIT) break;
          }
          const next = { ...prepared.attempt, nextRecord: ordinal,
            progressRevision: prepared.attempt.progressRevision + 1 };
          const markerBytes = await writeNormalizationStage(prepared.attempt, batch, next, work);
          prepared.attempt = next;
          work.notify('durable');
          return await work.run(primitive('clone', () => { work.note('markerWorkBytes', markerBytes); return structuredClone(next); }));
        } finally { batch = []; cursor?.dispose(); owner.release(); }
      }),
      verify: () => operation('verify', () => transition('verify')),
      activate: () => operation('activate', async () => await transition('activate') as ActiveAuthority),
      reopen: () => operation('reopen', () => activeRead()),
      dispose,
    };
    return { session, retained: () => operation('retained', () => retainedRead()),
      source: () => operation('prepare', () => retainedRead(true)), stagedRead, strictTransition, strictReserve, strictStage,
      workspaceAdmission: editingCustody => operation('reopen', () => trustedWorkspaceAdmission(editingCustody)),
      recoveryCapture: () => operation('reopen', async () => {
        retainActiveCapture = true;
        const active = await activeRead(undefined, true);
        requireContract(active && captured && pass?.images, 'No validated current workspace for recovery');
        const selections: WorkspaceSelection[] = [], rows: CapturedRow[][] = [], scopes: ProjectScope[] = [];
        for (const store of captured.stores) await work.run(effect(1, () => { selections.push({ store }); rows.push(captured!.rows.get(store)!); }));
        for (const project of pass.images.values()) await work.run(effect(1, () => { scopes.push(project.scope); }));
        return { selections, rows, scopes, release() {
          // The wrapper must relinquish its own roots, not merely release session accounting.
          rows.length = 0; selections.length = 0; scopes.length = 0; dispose();
        } } satisfies WorkspaceCapture;
      }),
      selected: (scope: ProjectScope) => operation('reopen', () => activeRead(scope)),
      trustedSelected: (scope: ProjectScope) => operation('reopen', () => trustedSelected(scope)) };
  }

  async function withRead<T>(provided: WorkRuntime | undefined, read: (context: ReturnType<typeof createNormalizationSession>) => Promise<T>): Promise<T> {
    const work = provided ?? createWorkRuntime({ assertCurrent() {} });
    let context: ReturnType<typeof createNormalizationSession> | undefined;
    try { context = createNormalizationSession(work); return await read(context); }
    finally { context?.session.dispose(); if (!provided) work.dispose(); }
  }
  const readActiveSnapshot = (work?: WorkRuntime) => withRead(work, context => context.session.reopen());
  const readRetainedSource = (work?: WorkRuntime) => withRead(work, context => context.retained());

  async function admitWorkspace(): Promise<WorkspaceAdmission> {
    currentWorkspaceOwner?.recovery?.dispose();
    safeCounter(workspaceAdmissionEpoch + 1);
    const admissionEpoch = ++workspaceAdmissionEpoch, connectionEpoch = connectionLossEpoch;
    const work = createWorkRuntime({ assertCurrent() {
      if (admissionEpoch !== workspaceAdmissionEpoch || connectionEpoch !== connectionLossEpoch) {
        throw new RepositoryConflict('ingress-required');
      }
    } });
    try {
      const admitted = await withRead(work, context => context.workspaceAdmission());
      if (!admitted) throw new RepositoryConflict('ingress-required');
      work.assertCurrent();
      const token = Object.freeze({}) as WorkspaceRepositoryAdmission;
      currentWorkspaceOwner = { authority: admitted.authority, workspace: admitted.workspace,
        connectionEpoch, admissionEpoch, fenced: false, pending: new Set(), attempts: new Map() };
      workspaceAdmissions.set(token, currentWorkspaceOwner);
      return { token, catalog: admitted.catalog, projectAuthorities: admitted.projectAuthorities };
    } finally { work.dispose(); }
  }

  /** One sealed capture installs all startup owners. Read/export APIs do not call this. */
  async function openEditingWorkspace(work: WorkRuntime): Promise<{ active: ActiveRead; admission: WorkspaceAdmission }> {
    assertWorkRuntime(work); currentWorkspaceOwner?.recovery?.dispose(); safeCounter(workspaceAdmissionEpoch + 1);
    const admissionEpoch = ++workspaceAdmissionEpoch, connectionEpoch = connectionLossEpoch;
    const removeGuard = work.addGuard(() => {
      if (admissionEpoch !== workspaceAdmissionEpoch || connectionEpoch !== connectionLossEpoch) throw new RepositoryConflict('ingress-required');
    });
    let indexCustody: Ownership | undefined;
    try {
      await work.run(effect(1, () => { indexCustody = work.own(72); }));
      for (const previous of owners.values()) await work.run(effect(1, () => { previous.valid = false; }));
      const read = await withRead(work, context => context.workspaceAdmission(indexCustody));
      requireContract(read?.editing, 'No active editing workspace'); work.assertCurrent();
      const nextOwners = new Map<string, Owner>();
      for (const project of read.editing.owners) {
        const key = await work.run(jsonTextWork(prefix(project.records.scope)));
        const keyBytes = await work.run(utf8LengthWork(key));
        await work.run(effect(1, () => { indexCustody!.grow(32 + keyBytes); nextOwners.set(key, project); }));
      }
      work.assertCurrent();
      const token = Object.freeze({}) as WorkspaceRepositoryAdmission;
      const owner: WorkspaceOwner = { authority: read.authority, workspace: read.workspace, connectionEpoch, admissionEpoch,
        fenced: false, pending: new Set(), attempts: new Map() };
      // No callbacks/awaits between final liveness check and capability publication.
      owners = nextOwners;
      currentWorkspaceOwner = owner; workspaceAdmissions.set(token, owner);
      return { active: read.editing.active, admission: { token, catalog: read.catalog, projectAuthorities: read.projectAuthorities } };
    // On success the indexes belong to installed repository owners, not startup
    // scratch. On failure no owner was published. Release this lease in both cases.
    } finally { indexCustody?.release(); removeGuard(); }
  }

  function requireWorkspaceOwner(token: WorkspaceRepositoryAdmission): WorkspaceOwner {
    const owner = workspaceAdmissions.get(token);
    if (!owner || owner.fenced || owner.connectionEpoch !== connectionLossEpoch || owner.admissionEpoch !== workspaceAdmissionEpoch) {
      throw new RepositoryConflict('ingress-required');
    }
    return owner;
  }

  /** Continue only existing live owners after a proven native transaction abort.
   * This cannot open/reconstruct a project or substitute for independent ingress. */
  async function resumeAbortedWorkspace(token: WorkspaceRepositoryAdmission,
    failures: readonly { scope: ProjectScope; identity: CommitIdentity }[], work: WorkRuntime): Promise<WorkspaceAdmission> {
    assertWorkRuntime(work);
    const state = requireWorkspaceOwner(token), manifest = state.workspace, projectEpoch = projectOperationEpoch;
    const current = () => {
      if (requireWorkspaceOwner(token) !== state || currentWorkspaceOwner !== state || state.workspace !== manifest
        || projectEpoch !== projectOperationEpoch || state.pending.size || state.recovery || queues.size) throw new RepositoryConflict('ingress-required');
    };
    current();
    const removeGuard = work.addGuard(current);
    let capture: WorkspaceCapture | undefined, custody: Ownership | undefined;
    try {
      await work.run(effect(1, () => { custody = work.own(128); }));
      requireContract(Array.isArray(failures) && failures.length > 0 && failures.length <= 32, 'Missing rollback evidence');
      await work.run(denseDataArrayWork(failures));
      const input: { scope: ProjectScope; identity: CommitIdentity }[] = [];
      for (let index = 0, length = failures.length; index < length; index++) await work.run((function* (): Work<void> { yield {
        // At most ten scalar fields plus two <=256-unit private ID encodings.
        // Native key enumeration is tagged; no loop follows unbounded own keys.
        visits: 768, utf8Bytes: 0, run(runtime) {
          const fields = (value: unknown, keys: readonly string[]) => {
            requireContract(value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype, 'Invalid rollback frame');
            runtime?.note('primitiveExceptions');
            requireContract(Reflect.ownKeys(value).length === keys.length, 'Invalid rollback fields');
            const result: Record<string, unknown> = {};
            for (const key of keys) {
              const descriptor = Object.getOwnPropertyDescriptor(value, key);
              requireContract(descriptor?.enumerable && Object.hasOwn(descriptor, 'value'), 'Invalid rollback data descriptor'); result[key] = descriptor.value;
            }
            return result;
          };
          const slot = Object.getOwnPropertyDescriptor(failures, index); requireContract(slot && Object.hasOwn(slot, 'value'), 'Invalid rollback slot');
          const row = fields(slot.value, ['scope', 'identity']);
          const scope = fields(row.scope, ['storageGeneration', 'projectId', 'incarnation']) as unknown as ProjectScope;
          const identity = fields(row.identity, ['clientId', 'commitGeneration', 'commitId', 'editorGeneration', 'lane']) as unknown as CommitIdentity;
          requireContract(Object.values(scope).every(value => typeof value === 'string' && value.length > 0), 'Invalid rollback scope'); validateIdentity(identity);
          custody!.grow(128); input.push({ scope, identity });
        },
      }; })());
      custody!.grow((await work.run(rawValueWeightWork(input))).bytes);
      const evidence: AttemptRecord[] = [], seen = new Set<string>();
      const memberOwners = new Map<string, Owner>();
      const projectAuthorities: WorkspaceAdmission['projectAuthorities'][number][] = [];
      const selections: WorkspaceSelection[] = [{ store: 'normalizationLedger', key: NORMALIZATION_LEDGER_ID }, { store: 'workspace', key: 'current' }];
      for (const member of manifest.members) {
        const scope = { storageGeneration: manifest.storageGeneration, projectId: member.projectId, incarnation: member.incarnation };
        const key = await work.run(jsonTextWork(prefix(scope)));
        await work.run(effect(12, () => {
          const owner = owners.get(key);
          requireContract(owner?.valid && sameAuthority(owner.stamp, owner.lastVerified), 'Project continuation owner unavailable');
          custody!.grow(192); memberOwners.set(scope.projectId, owner);
          projectAuthorities.push({ scope, authority: { ...owner.lastVerified } });
          selections.push({ store: 'projectHeaders', key: prefix(scope).slice(0, 2) }, { store: 'projectPreferences', key: prefix(scope) });
        }));
      }
      for (const candidate of input) {
        const failure = await work.run(exactFieldsWork(candidate, ['scope', 'identity']));
        const scope = await work.run(exactFieldsWork(failure.scope, ['storageGeneration', 'projectId', 'incarnation'])) as unknown as ProjectScope;
        const identity = await work.run(exactFieldsWork(failure.identity, ['clientId', 'commitGeneration', 'commitId', 'editorGeneration', 'lane'])) as unknown as CommitIdentity;
        await work.run(effect(16, () => {
          requireContract(Object.values(scope).every(value => typeof value === 'string' && value.length > 0), 'Invalid rollback scope'); validateIdentity(identity);
        }));
        const key = await work.run(jsonTextWork([prefix(scope), identity.commitId]));
        const original = attempts.get(key), proof = original && rollbackEvidence.get(original), owner = memberOwners.get(scope.projectId);
        requireContract(original?.aborted && proof && owner?.valid && continuationIdentities.get(owner) === proof.owner, 'Rollback evidence unavailable');
        requireContract(await work.run(equalFrameWork(canonicalFrame(original.scope), canonicalFrame(scope)))
          && await work.run(equalFrameWork(canonicalFrame(original.identity), canonicalFrame(identity))), 'Rollback identity mismatch');
        await work.run(effect(12, () => {
          requireContract(!seen.has(scope.projectId) && proof.connectionEpoch === connectionLossEpoch && proof.workspaceEpoch === workspaceAdmissionEpoch
            && proof.workspaceRevision === manifest.revision && proof.workspaceDigest === manifest.coreDigest
            && sameAuthority(proof.before, owner.lastVerified), 'Rollback authority changed');
          seen.add(scope.projectId); evidence.push(original);
        }));
      }
      capture = await captureWorkspaceRows({ selections, scopes: [] }, work, 'prepare-read');
      for (let index = 0; index < selections.length; index++) {
        const rows = capture.rows[index], selection = selections[index]; requireContract(rows.length === 1, 'Missing continuation metadata');
        const expected = index === 0 ? state.authority : index === 1 ? manifest
          : index % 2 === 0 ? pair(memberOwners.get(projectAuthorities[(index - 2) >> 1].scope.projectId)!.records).header
            : pair(memberOwners.get(projectAuthorities[(index - 2) >> 1].scope.projectId)!.records).preferences;
        const comparison = index < 2 ? await work.run(compareEnvelopeWork('rollback-metadata', expected, rows[0].value as object))
          : await work.run(compareRecordWork(selection.store as ProjectStoreName, expected, rows[0].value as object));
        requireContract(comparison.equal, 'Continuation metadata changed');
      }
      const catalog = await work.run(projectWorkspaceCatalogWork(manifest));
      await sealWorkspaceCapture(capture, work);
      work.assertCurrent(); current();
      // No callbacks or awaits between the final guards and capability rotation.
      const next = Object.freeze({}) as WorkspaceRepositoryAdmission;
      workspaceAdmissions.delete(token); workspaceAdmissions.set(next, state);
      for (const original of evidence) rollbackEvidence.delete(original);
      return { token: next, catalog, projectAuthorities };
    } finally { capture?.release(); custody?.release(); removeGuard(); }
  }
  function workspaceSerial<T>(generation: string, operation: () => Promise<T>): Promise<T> {
    const result = (workspaceQueues.get(generation) ?? Promise.resolve()).catch(() => {}).then(operation);
    workspaceQueues.set(generation, result);
    void result.finally(() => { if (workspaceQueues.get(generation) === result) workspaceQueues.delete(generation); }).catch(() => {});
    return result;
  }
  function publishWorkspaceOperations(operations: WorkspaceRepositoryOperation[] | undefined) {
    if (operations) for (const operation of operations) {
      try { environment.onWorkspaceOperation?.(operation); } catch { /* passive observations cannot change durable outcome */ }
    }
  }
  const workspaceRange = (selection: WorkspaceSelection, after?: IDBValidKey): IDBKeyRange | undefined => {
    if (selection.upper !== undefined) return IDBKeyRange.bound(after ?? selection.lower!, selection.upper, after !== undefined, true);
    return after === undefined ? undefined : IDBKeyRange.lowerBound(after, true);
  };
  async function workspaceSelections(batch: WorkspaceBatch, manifest: NormalizedWorkspaceManifest, work: WorkRuntime) {
    const selections: WorkspaceSelection[] = [{ store: 'normalizationLedger', key: NORMALIZATION_LEDGER_ID }, { store: 'workspace', key: 'current' }];
    const scopes: ProjectScope[] = [];
    const add = async (selection: WorkspaceSelection) => {
      for (const previous of selections) if (previous.store === selection.store
        && await work.run(equalFrameWork(canonicalFrame(previous), canonicalFrame(selection)))) return;
      await work.run(effect(1, () => { selections.push(selection); }));
    };
    const header = (id: string) => add({ store: 'projectHeaders', key: [batch.storageGeneration, id] });
    const project = async (scope: ProjectScope) => {
      for (const previous of scopes) if (await work.run(equalFrameWork(canonicalFrame(previous), canonicalFrame(scope)))) return;
      await work.run(effect(1, () => { scopes.push({ ...scope }); }));
      for (const store of stores) {
        const lower = store === 'projectHeaders' ? [scope.storageGeneration, scope.projectId] : prefix(scope);
        const upper = [...lower]; upper[upper.length - 1] += '\0';
        await add({ store, lower, upper });
      }
    };
    const nextProject = async (id: unknown) => {
      requireContract(typeof id === 'string' && id.length > 0, 'Invalid new project identity');
      await project({ storageGeneration: batch.storageGeneration, projectId: id,
        incarnation: await deriveWorkspaceIncarnation(batch.storageGeneration, batch.expected.revision + 1, 0, work) });
    };
    const intent = batch.intent;
    if (intent.type === 'activate-project') await header(intent.projectId);
    if (intent.type === 'close-project') {
      await project(batch.targets[0].scope);
      if (intent.successor !== undefined) await nextProject(intent.successor.id);
    }
    if (intent.type === 'create-and-activate-project') await nextProject(intent.project.id);
    if (intent.type === 'save-custom-preset') await add({ store: 'presets', key: intent.preset.id });
    if (intent.type === 'delete-custom-preset') await add({ store: 'presets' });
    if (intent.type === 'stage-import' || intent.type === 'replace-staged-import') {
      const input = intent.type === 'stage-import' ? intent.pendingImport : intent.replacement.pendingImport;
      await add({ store: 'pendingImports', key: input.id }); await header(input.targetProjectId);
      if (intent.type === 'replace-staged-import') {
        await add({ store: 'pendingImports', key: intent.expected.importId }); await header(intent.expected.targetProjectId);
      }
    }
    if (intent.type === 'consume-import') {
      await add({ store: 'pendingImports' });
      let pending: (typeof manifest.pendingImports)[number] | undefined;
      for (const row of manifest.pendingImports) if ((await work.run(compareStringsWork(row.id, intent.importId))) === 0) pending = row;
      if (pending) await nextProject(pending.targetProjectId);
      for (const row of manifest.members) {
        await work.run(effect(1, () => {}));
        if (row.consumedImport.consumedImportId !== undefined
          && (await work.run(compareStringsWork(row.consumedImport.consumedImportId, intent.importId))) === 0) {
          await header(row.projectId);
          if (row.birth.kind === 'workspace-command' && row.birth.workspaceRevision === batch.expected.revision + 1
            && await work.run(equalFrameWork(canonicalFrame(row.birth.identity), canonicalFrame(batch.identity)))) {
            await project({ storageGeneration: batch.storageGeneration, projectId: row.projectId, incarnation: row.incarnation });
          }
        }
      }
    }
    return { selections, scopes };
  }

  async function captureWorkspaceRows(plan: { selections: WorkspaceSelection[]; scopes: ProjectScope[] }, work: WorkRuntime,
    phase: WorkspaceRepositoryOperation['phase']): Promise<WorkspaceCapture> {
    let lease: Ownership | undefined; const rows: CapturedRow[][] = [];
    try {
      await work.run(effect(1, () => { lease = work.own(0, true); }));
      for (const selection of plan.selections) {
        const values: CapturedRow[] = []; rows.push(values); let lower: IDBValidKey | undefined;
        for (;;) {
          let db: IDBDatabase | undefined, row: CapturedRow | undefined;
          let operation: WorkspaceRepositoryOperation | undefined;
          try {
            const opened = await open(); db = opened.db; work.assertCurrent();
            await work.wait(() => new Promise<void>((resolve, reject) => {
              const tx = db!.transaction(selection.store, 'readonly'); let failure: unknown;
              operation = { phase, transactionId: ++transactionId, connectionId: opened.id, store: selection.store,
                method: selection.key !== undefined ? 'get' : 'openCursor', ...(selection.key !== undefined ? { key: selection.key } : {}) };
              const request = selection.key !== undefined ? tx.objectStore(selection.store).get(selection.key)
                : tx.objectStore(selection.store).openCursor(workspaceRange(selection, lower));
              request.onsuccess = () => {
                try {
                  work.assertCurrent();
                  if (selection.key !== undefined) { if (request.result !== undefined) row = { key: selection.key, value: request.result, bytes: 0 }; }
                  else { const cursor = request.result as IDBCursorWithValue | null; if (cursor) row = { key: cursor.primaryKey, value: cursor.value, bytes: 0 }; }
                  work.assertCurrent();
                } catch (error) { failure = error; tx.abort(); }
              };
              tx.oncomplete = () => resolve(); tx.onabort = () => reject(failure ?? tx.error ?? Error('Workspace capture aborted'));
            }));
            if (row) {
              await work.run(effect(1, () => {
                if (environment.workspaceReadResult) row!.value = environment.workspaceReadResult(operation!, row!.value);
              }));
              const fields = await work.run(dataObjectWork(row.value));
              const key = stores.includes(selection.store as ProjectStoreName) ? fields.key : fields.id;
              requireContract(await work.run(primitive('idb-record', () => environment.indexedDB.cmp(row!.key, key as IDBValidKey) === 0)), 'Workspace physical key mismatch');
              row.bytes = (await work.run(rawValueWeightWork(row.value))).bytes;
              const keyBytes = (await work.run(rawValueWeightWork(row.key))).bytes;
              await work.run(effect(1, () => { lease!.grow(row!.bytes + keyBytes + 24); values.push(row!); })); lower = row.key;
              work.note('candidateRows'); work.note('candidateBytes', row.bytes);
            } else work.note('eofChecks');
            work.note('pageTransactions');
          } finally { db?.close(); if (operation) publishWorkspaceOperations([operation]); }
          if (selection.key !== undefined || !row) break;
        }
      }
      return { ...plan, rows, release: () => { lease!.release(); } };
    } catch (error) { lease?.release(); throw error; }
  }

  async function workspaceCommandCapture(capture: WorkspaceCapture, work: WorkRuntime): Promise<CapturedWorkspaceCommand & { marker: ActiveAuthority }> {
    try {
    let manifest: NormalizedWorkspaceManifest | undefined, marker: ActiveAuthority | undefined;
    const memberHeaders: ProjectHeader[] = [], presets: import('../schema').StoredPreset[] = [], pendingImports: StoredPendingImport[] = [];
    const projects: NormalizedProject[] = [];
    const backups: LegacyBackupRecord[] = [], durableIds: string[] = [];
    for (const scope of capture.scopes) await work.run(effect(1, () => { projects.push(image(scope)); }));
    for (let i = 0; i < capture.selections.length; i++) {
      const store = capture.selections[i].store;
      for (const row of capture.rows[i]) {
        if (store === 'workspace') { requireContract(!manifest, 'Duplicate workspace capture'); manifest = await work.run(validateWorkspaceManifestWork(row.value)); }
        else if (store === 'normalizationLedger') {
          requireContract(!marker, 'Duplicate workspace marker'); await work.run(validateNormalizationLedgerWork(row.value));
          marker = row.value as ActiveAuthority; requireContract(marker.state === 'active', 'Workspace is not active');
        } else if (store === 'presets') await work.run(effect(1, () => { presets.push(row.value as import('../schema').StoredPreset); }));
        else if (store === 'pendingImports') await work.run(effect(1, () => { pendingImports.push(row.value as StoredPendingImport); }));
        else if (store === 'legacyBackup') {
          if ((row.value as { kind: string }).kind !== 'normalization-source') await work.run(effect(1, () => { backups.push(row.value as LegacyBackupRecord); }));
        } else if (store === 'projects') await work.run(effect(1, () => { durableIds.push((row.value as { id: string }).id); }));
        else if (stores.includes(store as ProjectStoreName)) {
          const record = row.value as PhysicalRecord;
          if (store === 'projectHeaders') await work.run(effect(1, () => { memberHeaders.push(record as ProjectHeader); }));
          for (const project of projects) {
            if ((await work.run(compareStringsWork(record.key[0], project.scope.storageGeneration))) !== 0
              || (await work.run(compareStringsWork(record.key[1], project.scope.projectId))) !== 0) continue;
            if (store !== 'projectHeaders' && (await work.run(compareStringsWork(record.key[2], project.scope.incarnation))) !== 0) continue;
            const key = await work.run(jsonTextWork(record.key));
              await work.run(effect(1, () => { (project[store as ProjectStoreName] as Map<string, PhysicalRecord>).set(key, record); }));
          }
        }
      }
    }
    requireContract(manifest && marker && manifest.storageGeneration === marker.storageGeneration, 'Missing current workspace capture');
    return { manifest, marker, initial: { revision: marker.sourceWorkspaceRevision, coreDigest: marker.initialWorkspaceDigest }, memberHeaders, projects, presets, pendingImports,
      ...(capture.selections.some(selection => selection.store === 'legacyBackup') ? { recovery: { backups, durableIds } } : {}) };
    } catch (error) {
      if (work.stopped()) throw error;
      throw new RepositoryConflict('verification-failed');
    }
  }

  async function sealWorkspaceCapture(capture: WorkspaceCapture, work: WorkRuntime,
    mutation?: RecordMutation, committed?: () => void): Promise<void> {
    let db: IDBDatabase | undefined;
    const observations = environment.onWorkspaceOperation ? [] as WorkspaceRepositoryOperation[] : undefined;
    const operations: { store: WorkspaceStoreName; key: IDBValidKey; value?: unknown; method: 'add' | 'put' | 'delete' }[] = [];
    const planOwner = work.own(0);
    try {
      // Prepare the complete write list before opening a transaction. No JS scan/yield during writes.
      if (mutation) {
        for (const scope of mutation.removeProjects) for (let i = 0; i < capture.selections.length; i++) {
          const selection = capture.selections[i]; if (!stores.includes(selection.store as ProjectStoreName)) continue;
          for (const row of capture.rows[i]) {
            const key = row.key as string[];
            if ((await work.run(compareStringsWork(key[0], scope.storageGeneration))) === 0
              && (await work.run(compareStringsWork(key[1], scope.projectId))) === 0
              && (selection.store === 'projectHeaders' || (await work.run(compareStringsWork(key[2], scope.incarnation))) === 0)) {
              await work.run(effect(1, () => { planOwner.grow(48); operations.push({ store: selection.store, key, method: 'delete' }); }));
            }
          }
        }
        for (const project of mutation.addProjects) for (const store of stores) for (const row of project[store].values()) {
          await work.run(effect(1, () => { planOwner.grow(56); operations.push({ store, key: row.key, value: row, method: 'add' }); }));
        }
        for (const key of mutation.deletePresetIds ?? []) await work.run(effect(1, () => { planOwner.grow(48); operations.push({ store: 'presets', key, method: 'delete' }); }));
        for (const key of mutation.deleteImportIds ?? []) await work.run(effect(1, () => { planOwner.grow(48); operations.push({ store: 'pendingImports', key, method: 'delete' }); }));
        for (const value of mutation.putPresets ?? []) await work.run(effect(1, () => { planOwner.grow(56); operations.push({ store: 'presets', key: value.id, value, method: 'put' }); }));
        for (const value of mutation.putImports ?? []) await work.run(effect(1, () => { planOwner.grow(56); operations.push({ store: 'pendingImports', key: value.id, value, method: 'put' }); }));
        if (mutation.addBackup) await work.run(effect(1, () => { planOwner.grow(56); operations.push({ store: 'legacyBackup', key: mutation.addBackup!.id, value: mutation.addBackup, method: 'add' }); }));
        if (mutation.manifest) await work.run(effect(1, () => { planOwner.grow(56); operations.push({ store: 'workspace', key: 'current', value: mutation.manifest, method: 'put' }); }));
      }
      const opened = await open(); db = opened.db; work.assertCurrent();
      if (mutation) environment.workspaceFault?.({ phase: 'before-cas' });
      await work.wait(() => new Promise<void>((resolve, reject) => {
        const names = [...new Set(capture.selections.map(selection => selection.store))];
        const tx = db!.transaction(names, mutation ? 'readwrite' : 'readonly'); const id = ++transactionId;
        let failure: unknown, index = 0, ordinal = 0;
        const guard = (fn: () => void) => { try { work.assertCurrent(); fn(); work.assertCurrent(); } catch (error) { failure = error; try { tx.abort(); } catch {} } };
        const record = (store: WorkspaceStoreName, method: WorkspaceRepositoryOperation['method'], key?: IDBValidKey) => {
          observations?.push({ phase: mutation ? 'cas-read' : 'verify-read', transactionId: id, connectionId: opened.id, store, method, ...(key === undefined ? {} : { key }) });
        };
        tx.oncomplete = () => {
          work.note('sealTransactions');
          try { committed?.(); resolve(); } catch (error) { reject(error); }
        };
        tx.onabort = () => reject(failure ?? tx.error ?? Error('Workspace seal aborted'));
        const compare = (selection: WorkspaceSelection, before: CapturedRow, key: IDBValidKey, value: unknown) => {
          requireContract(environment.indexedDB.cmp(before.key, key) === 0, 'Workspace capture membership changed');
          const frame = (raw: unknown) => stores.includes(selection.store as ProjectStoreName)
            ? recordFrame(selection.store as ProjectStoreName, raw as object)
            : selection.store === 'legacyBackup' && (raw as { kind: string }).kind === 'normalization-source'
              ? archiveSealFrame(raw as object) : envelopeFrame('workspace-seal', raw as object);
          let compared = 0, complete = false;
          const observed: Frame = function* (emit) {
            yield* frame(value)(function* (fragment) { compared += yield* utf8LengthWork(fragment); yield* emit(fragment); });
          };
          try {
            complete = runSync(equalFrameWork(observed, frame(before.value)));
            requireContract(complete, 'Workspace captured record changed');
          } finally {
            work.note('primitiveExceptions'); work.note('sealRows'); work.note('sealBytes', compared);
            if (!complete) work.note('unmeasuredValues');
          }
        };
        const write = () => {
          if (!mutation) return;
          environment.workspaceFault?.({ phase: 'after-cas' });
          const next = () => guard(() => {
            const operation = operations[ordinal++];
            if (!operation) { environment.workspaceFault?.({ phase: 'before-complete' }); return; }
            const kind = operation.method === 'delete' ? 'delete' : 'put';
            environment.workspaceFault?.({ phase: `before-${kind}`, ordinal, store: operation.store, key: operation.key });
            const store = tx.objectStore(operation.store);
            const request = operation.method === 'delete' ? store.delete(operation.key) : store[operation.method](operation.value);
            work.note('writes');
            observations?.push({ phase: 'write', transactionId: id, connectionId: opened.id,
              store: operation.store, method: operation.method, key: operation.key });
            request.onsuccess = () => guard(() => {
              environment.workspaceFault?.({ phase: `after-${kind}`, ordinal, store: operation.store, key: operation.key }); next();
            });
          }); next();
        };
        const nextSelection = () => guard(() => {
          const selection = capture.selections[index], expected = capture.rows[index++];
          if (!selection) { write(); return; }
          if (selection.key !== undefined) {
            record(selection.store, 'get', selection.key); const request = tx.objectStore(selection.store).get(selection.key);
            request.onsuccess = () => guard(() => {
              if (request.result === undefined) requireContract(expected.length === 0, 'Workspace row disappeared');
              else { requireContract(expected.length === 1, 'Workspace row appeared'); compare(selection, expected[0], selection.key!, request.result); }
              nextSelection();
            });
          } else {
            let offset = 0; record(selection.store, 'openCursor');
            const request = tx.objectStore(selection.store).openCursor(workspaceRange(selection));
            request.onsuccess = () => guard(() => {
              const cursor = request.result;
              if (!cursor) { work.note('eofChecks'); requireContract(offset === expected.length, 'Workspace range disappeared'); nextSelection(); return; }
              const before = expected[offset++]; requireContract(before, 'Workspace range grew'); compare(selection, before, cursor.primaryKey, cursor.value); cursor.continue();
            });
          }
        }); nextSelection();
      }));
    } finally { db?.close(); planOwner.release(); publishWorkspaceOperations(observations); }
  }

  async function captureValidatedRecovery(work: WorkRuntime): Promise<WorkspaceCapture> {
    const context = createNormalizationSession(work);
    try { return await context.recoveryCapture(); }
    catch (error) { context.session.dispose(); throw error; }
  }
  function discardWorkspaceRecovery(token: WorkspaceRepositoryRecovery) {
    recoveryPreparations.get(token)?.dispose(); recoveryPreparations.delete(token);
  }
  async function prepareWorkspaceRecovery(token: WorkspaceRepositoryAdmission, source: WorkspaceBatch): Promise<WorkspaceRecoveryPreparation> {
    const state = requireWorkspaceOwner(token); frameWorkspaceBatch(source);
    requireContract(source.intent.type === 'recover-legacy-as-copies', 'Expected recovery intent'); state.recovery?.dispose();
    const work = createWorkRuntime({ assertCurrent() { requireWorkspaceOwner(token); } });
    const inputPromise = captureWorkspaceBatch(source, work); void inputPromise.catch(() => {});
    const pending = workspaceSerial(state.authority.storageGeneration, async () => {
      let input: Awaited<typeof inputPromise> | undefined, capture: WorkspaceCapture | undefined, prepared: PreparedWorkspaceMutation | undefined;
      let retained = false;
      try {
        state.recovery?.dispose();
        input = await inputPromise; work.assertCurrent();
        requireContract(input.batch.storageGeneration === state.authority.storageGeneration
          && input.batch.expected.revision === state.workspace.revision && input.batch.expected.coreDigest === state.workspace.coreDigest, 'Workspace authority changed');
        capture = await captureValidatedRecovery(work);
        const current = await workspaceCommandCapture(capture, work);
        requireContract(await work.run(equalFrameWork(canonicalFrame(current.marker), canonicalFrame(state.authority))), 'Workspace activation changed');
        prepared = await prepareWorkspaceMutation(current, input.batch, environment.now(), work, environment.normalization);
        const remembered = state.attempts.get(input.batch.identity.commandId);
        requireContract(!remembered || remembered.digest === prepared.requestDigest, 'Recovery identity changed');
        const capability = Object.freeze({}) as WorkspaceRepositoryRecovery;
        let released = false;
        const entry: RecoveryPreparationState = { owner: state, token, batch: input.batch, work, prepared, capture, used: false, executing: false,
          dispose() { entry.used = true; if (entry.executing) work.dispose(); else entry.release(); },
          release() { if (released) return; released = true; recoveryPreparations.delete(capability);
            if (state.recovery === entry) state.recovery = undefined;
            prepared!.release(); capture!.release(); input!.release(); work.dispose(); } };
        recoveryPreparations.set(capability, entry); state.recovery = entry; retained = true;
        return { token: capability, counts: { projects: prepared.addProjects.length, presets: prepared.putPresets.length, pendingImports: prepared.putImports.length } };
      } finally { if (!retained) { prepared?.release(); capture?.release(); input?.release(); work.dispose(); } }
    });
    state.pending.add(pending); try { return await pending; } finally { state.pending.delete(pending); }
  }
  async function commitWorkspaceRecovery(token: WorkspaceRepositoryAdmission, capability: WorkspaceRepositoryRecovery): Promise<WorkspaceCommandResult> {
    const state = requireWorkspaceOwner(token), entry = recoveryPreparations.get(capability);
    requireContract(entry && !entry.used && entry.token === token && entry.owner === state && state.recovery === entry, 'Recovery capability is unavailable');
    entry.used = true; entry.executing = true;
    const { work, batch, prepared } = entry;
    const pending = workspaceSerial(state.authority.storageGeneration, async () => {
      let afterCapture: WorkspaceCapture | undefined;
      try {
        work.assertCurrent();
        requireContract(state.workspace.revision === batch.expected.revision && state.workspace.coreDigest === batch.expected.coreDigest, 'Workspace authority changed');
        const before = await work.run(projectWorkspaceCatalogWork(state.workspace));
        await sealWorkspaceCapture(entry.capture, work, prepared, () => { state.lastBefore = { identity: { ...batch.identity }, catalog: before }; });
        environment.workspaceFault?.({ phase: 'after-commit' }); work.assertCurrent();
        // Drop the before image before independently validating the committed workspace.
        entry.capture.release();
        environment.workspaceFault?.({ phase: 'before-readback' });
        afterCapture = await captureValidatedRecovery(work);
        const current = await workspaceCommandCapture(afterCapture, work);
        const verified = await verifyWorkspacePostconditions(batch, current, prepared.manifest.lastCommit!, work);
        await sealWorkspaceCapture(afterCapture, work); environment.workspaceFault?.({ phase: 'after-readback' }); work.assertCurrent();
        state.workspace = current.manifest;
        return { type: 'workspace-committed' as const, outcome: verified.outcome, receipt: verified.receipt, delta: prepared.delta,
          projects: verified.projects, presets: verified.presets, pendingImports: verified.pendingImports };
      } finally {
        const record: WorkspaceAttemptRecord = { identity: { ...batch.identity }, before: { ...batch.expected }, digest: prepared.requestDigest, bytes: 4096 };
        state.attempts.delete(record.identity.commandId); state.attempts.set(record.identity.commandId, record);
        let bytes = 0; for (const row of state.attempts.values()) bytes += row.bytes;
        while (state.attempts.size > 32 || bytes > 64 * 1024) { const id = state.attempts.keys().next().value!; bytes -= state.attempts.get(id)!.bytes; state.attempts.delete(id); }
        afterCapture?.release(); entry.executing = false; entry.release();
      }
    });
    state.pending.add(pending); try { return await pending; } finally { state.pending.delete(pending); }
  }

  async function commitWorkspace(token: WorkspaceRepositoryAdmission, source: WorkspaceBatch): Promise<WorkspaceCommandResult> {
    const state = requireWorkspaceOwner(token); frameWorkspaceBatch(source);
    requireContract(source.intent.type !== 'recover-legacy-as-copies', 'Separate recovery admission required');
    state.recovery?.dispose();
    const work = createWorkRuntime({ assertCurrent() { requireWorkspaceOwner(token); } });
    const capturedPromise = captureWorkspaceBatch(source, work); void capturedPromise.catch(() => {});
    // Two <=256-byte private IDs, two counters and fixed digests fit this conservative serialized bound.
    // Keep the ID reserved even if payload capture/validation fails before a digest can be attached.
    const record: WorkspaceAttemptRecord = { identity: { ...source.identity }, before: { ...source.expected }, bytes: 4096 };
    const pending = workspaceSerial<WorkspaceCommandResult>(state.authority.storageGeneration, async () => {
      let input: Awaited<typeof capturedPromise> | undefined, capture: WorkspaceCapture | undefined, prepared: PreparedWorkspaceMutation | undefined;
      try {
        input = await capturedPromise; work.assertCurrent();
        state.recovery?.dispose();
        record.bytes = await work.run(frameBytesWork(canonicalFrame({ identity: record.identity, before: record.before, digest: '0'.repeat(64) })));
        record.digest = await hashWorkspaceRequest(input.batch, work);
        const remembered = state.attempts.get(record.identity.commandId);
        if (remembered && (!remembered.digest || remembered.digest !== record.digest)) throw new RepositoryConflict('identity-mismatch');
        requireContract(input.batch.storageGeneration === state.authority.storageGeneration, 'Workspace generation changed');
        const admittedBefore = input.batch.expected.revision === state.workspace.revision && input.batch.expected.coreDigest === state.workspace.coreDigest;
        const previous = state.lastBefore;
        const repeated = previous && previous.catalog.stamp.revision === input.batch.expected.revision
          && previous.catalog.stamp.coreDigest === input.batch.expected.coreDigest
          && await work.run(equalFrameWork(canonicalFrame(previous.identity), canonicalFrame(input.batch.identity)));
        requireContract(admittedBefore || repeated, 'Workspace authority changed');
        capture = await captureWorkspaceRows(await workspaceSelections(input.batch, state.workspace, work), work, 'prepare-read');
        const current = await workspaceCommandCapture(capture, work);
        requireContract(await work.run(equalFrameWork(canonicalFrame(current.marker), canonicalFrame(state.authority))), 'Workspace activation changed');
        if (current.manifest.revision !== input.batch.expected.revision || current.manifest.coreDigest !== input.batch.expected.coreDigest) {
          const receipt = current.manifest.lastCommit;
          requireContract(receipt && receipt.requestDigest === record.digest
            && await work.run(equalFrameWork(canonicalFrame(receipt.identity), canonicalFrame(input.batch.identity))), 'Workspace authority changed');
          const verified = await verifyWorkspacePostconditions(input.batch, current, receipt, work);
          await sealWorkspaceCapture(capture, work);
          const base = admittedBefore ? await work.run(projectWorkspaceCatalogWork(state.workspace)) : previous!.catalog;
          const delta = await work.run(diffWorkspaceCatalogWork(base, verified.catalog));
          work.assertCurrent(); state.lastBefore = { identity: { ...input.batch.identity }, catalog: base }; state.workspace = current.manifest;
          return { type: 'workspace-committed', outcome: verified.outcome, receipt: verified.receipt, delta,
            projects: verified.projects, presets: verified.presets, pendingImports: verified.pendingImports };
        }
        requireContract(admittedBefore, 'Workspace authority regressed');
        prepared = await prepareWorkspaceMutation(current, input.batch, environment.now(), work);
        for (const added of prepared.addProjects) {
          const previous = current.projects.find(project => project.scope.projectId === added.scope.projectId && project.scope.incarnation === added.scope.incarnation);
          requireContract(previous, 'Missing new project absence capture');
          for (const store of stores) requireContract(previous[store].size === 0, 'New project collides with existing records');
        }
        const beforeCatalog = await work.run(projectWorkspaceCatalogWork(state.workspace));
        const retiredKeys: string[] = [];
        for (const removed of prepared.removeProjects) retiredKeys.push(await work.run(jsonTextWork(prefix(removed))));
        work.setContext('activate', 'target', 'proof');
        await sealWorkspaceCapture(capture, work, prepared, () => {
          // Durable facts must be applied before the caller's post-completion lifecycle guard can reject.
          state.lastBefore = { identity: { ...input!.batch.identity }, catalog: beforeCatalog };
          for (const key of retiredKeys) { const owner = owners.get(key); if (owner) owner.valid = false; owners.delete(key); }
        });
        environment.workspaceFault?.({ phase: 'after-commit' }); work.assertCurrent();
        capture.release(); capture = undefined;
        work.setContext('verify', 'target', 'proof');
        environment.workspaceFault?.({ phase: 'before-readback' });
        capture = await captureWorkspaceRows(await workspaceSelections(input.batch, prepared.manifest, work), work, 'verify-read');
        const after = await workspaceCommandCapture(capture, work);
        requireContract(await work.run(equalFrameWork(canonicalFrame(after.marker), canonicalFrame(state.authority))), 'Workspace activation changed after commit');
        const verified = await verifyWorkspacePostconditions(input.batch, after, prepared.manifest.lastCommit!, work);
        await sealWorkspaceCapture(capture, work); environment.workspaceFault?.({ phase: 'after-readback' }); work.assertCurrent();
        state.workspace = after.manifest;
        return { type: 'workspace-committed', outcome: verified.outcome, receipt: verified.receipt, delta: prepared.delta,
          projects: verified.projects, presets: verified.presets, pendingImports: verified.pendingImports };
      } finally {
        prepared?.release(); capture?.release(); input?.release(); work.dispose();
        const remembered = state.attempts.get(record.identity.commandId);
        if (record.bytes && (!remembered || remembered.digest !== undefined && remembered.digest === record.digest)) {
          state.attempts.delete(record.identity.commandId); state.attempts.set(record.identity.commandId, record);
          let bytes = 0; for (const entry of state.attempts.values()) bytes += entry.bytes;
          while (state.attempts.size > 32 || bytes > 64 * 1024) {
            const key = state.attempts.keys().next().value!; bytes -= state.attempts.get(key)!.bytes; state.attempts.delete(key);
          }
        }
      }
    });
    state.pending.add(pending);
    try { return await pending; } finally { state.pending.delete(pending); }
  }
  async function fenceWorkspace(token: WorkspaceRepositoryAdmission): Promise<WorkspaceRepositoryFence> {
    const state = workspaceAdmissions.get(token); if (!state) throw new RepositoryConflict('ingress-required');
    state.fenced = true; state.recovery?.dispose(); await Promise.allSettled([...state.pending]);
    const fence = Object.freeze({}) as WorkspaceRepositoryFence; workspaceFences.set(fence, state); return fence;
  }
  async function inspectWorkspaceAttempt(source: WorkspaceBatch, fence?: WorkspaceRepositoryFence): Promise<WorkspaceInspection> {
    frameWorkspaceBatch(source);
    const epoch = connectionLossEpoch;
    const work = createWorkRuntime({ assertCurrent() { if (epoch !== connectionLossEpoch) throw new RepositoryConflict('ingress-required'); } });
    let input: Awaited<ReturnType<typeof captureWorkspaceBatch>> | undefined, capture: WorkspaceCapture | undefined;
    try {
      input = await captureWorkspaceBatch(source, work);
      const recovery = input.batch.intent.type === 'recover-legacy-as-copies';
      if (!currentWorkspaceOwner && !recovery) { try { await admitWorkspace(); } catch { return { type: 'unknown' }; } }
      const state = currentWorkspaceOwner;
      const digest = await hashWorkspaceRequest(input.batch, work);
      capture = recovery ? await captureValidatedRecovery(work)
        : await captureWorkspaceRows({ selections: [{ store: 'normalizationLedger', key: NORMALIZATION_LEDGER_ID }, { store: 'workspace', key: 'current' }], scopes: [] }, work, 'inspect-read');
      const metadata = await workspaceCommandCapture(capture, work);
      if (metadata.manifest.storageGeneration !== input.batch.storageGeneration) return { type: 'conflict', reason: 'authority-changed' };
      if (state && !await work.run(equalFrameWork(canonicalFrame(metadata.marker), canonicalFrame(state.authority)))) return { type: 'conflict', reason: 'authority-changed' };
      try { await verifyWorkspaceReceipts(metadata.manifest, metadata.initial, work); }
      catch (error) { if (work.stopped()) throw error; throw new RepositoryConflict('verification-failed'); }
      const matches = metadata.manifest.commitWindow.entries.filter(receipt => receipt.identity.commandId === input!.batch.identity.commandId);
      if (matches.length) {
        const receipt = matches[0];
        if (receipt.requestDigest !== digest || !await work.run(equalFrameWork(canonicalFrame(receipt.identity), canonicalFrame(input.batch.identity)))) return { type: 'conflict', reason: 'identity-mismatch' };
        if (metadata.manifest.revision !== receipt.after.revision || metadata.manifest.coreDigest !== receipt.after.coreDigest) return { type: 'conflict', reason: 'authority-changed' };
        if (!recovery) {
          capture.release(); capture = undefined;
          capture = await captureWorkspaceRows(await workspaceSelections(input.batch, metadata.manifest, work), work, 'inspect-read');
        }
        const current = await workspaceCommandCapture(capture, work);
        let result: Awaited<ReturnType<typeof verifyWorkspacePostconditions>>;
        try { result = await verifyWorkspacePostconditions(input.batch, current, receipt, work); }
        catch (error) {
          if (error instanceof WorkspaceCommandConflict || work.stopped()) throw error;
          throw new RepositoryConflict('verification-failed');
        }
        await sealWorkspaceCapture(capture, work); return { type: 'committed', result };
      }
      await sealWorkspaceCapture(capture, work);
      if (metadata.manifest.revision !== input.batch.expected.revision || metadata.manifest.coreDigest !== input.batch.expected.coreDigest) return { type: 'conflict', reason: 'proof-unavailable' };
      const fenced = fence && workspaceFences.get(fence), remembered = fenced?.attempts.get(input.batch.identity.commandId);
      if (remembered?.digest && (remembered.digest !== digest
        || !await work.run(equalFrameWork(canonicalFrame(remembered.identity), canonicalFrame(input.batch.identity))))) {
        return { type: 'conflict', reason: 'identity-mismatch' };
      }
      if (fenced?.fenced && remembered?.digest === digest
        && await work.run(equalFrameWork(canonicalFrame(remembered.identity), canonicalFrame(input.batch.identity)))) return { type: 'not-committed' };
      return { type: 'unknown' };
    } catch (error) {
      if (error instanceof WorkspaceCommandConflict) return { type: 'conflict', reason: error.reason };
      if (error instanceof RepositoryConflict && ['authority-changed', 'identity-mismatch', 'proof-unavailable', 'verification-failed', 'incarnation-changed'].includes(error.reason)) {
        return { type: 'conflict', reason: error.reason as Extract<WorkspaceInspection, { type: 'conflict' }>['reason'] };
      }
      return { type: 'unknown' };
    }
    finally { capture?.release(); input?.release(); work.dispose(); }
  }

  async function reserveNormalization(source: NormalizationSource): Promise<NormalizationAttempt> {
    return withRead(undefined, context => context.strictReserve(source));
  }

  /** One coherent, independent read including physical keys, source and target membership. */
  async function normalizationCapture() {
    const { db } = await open();
    try {
      return await new Promise<Map<string, unknown[]>>((resolve, reject) => {
        const names = [...sourceStores, ...NORMALIZED_STORE_NAMES];
        const tx = db.transaction(names, 'readonly'); const rows = new Map<string, unknown[]>(); let failure: unknown;
        tx.oncomplete = () => resolve(rows); tx.onabort = () => reject(failure ?? tx.error ?? new Error('Normalization read aborted'));
        for (const name of names) {
          const values: unknown[] = []; rows.set(name, values);
          const request = tx.objectStore(name).openCursor();
          request.onsuccess = () => {
            try {
              const cursor = request.result; if (!cursor) return;
              const key = name === 'normalizationLedger' || sourceStores.includes(name as typeof sourceStores[number])
                ? cursor.value.id : cursor.value.key;
              requireContract(JSON.stringify(cursor.primaryKey) === JSON.stringify(key), 'Physical key mismatch');
              values.push(cursor.value); cursor.continue();
            } catch (error) { failure = error; tx.abort(); }
          };
        }
      });
    } finally { db.close(); }
  }
  const capturedSource = (rows: Map<string, unknown[]>) => Object.fromEntries(
    [...sourceStores, 'normalizationLedger'].map(store => [store, rows.get(store)!])) as SourceCapture;
  function capturedMarker(rows: Map<string, unknown[]>): NormalizationAttempt | undefined {
    const markers = rows.get('normalizationLedger')!;
    if (!markers.length) return undefined;
    requireContract(markers.length === 1, 'Unrecognized normalization attempt');
    validateNormalizationLedger(markers[0]); return markers[0];
  }
  const sameMarker = (actual: NormalizationAttempt | undefined, expected: NormalizationAttempt) => {
    if (!actual || canonicalStringify(actual) !== canonicalStringify(expected)) throw new RepositoryConflict('normalization-contention');
  };
  function capturedProject(rows: Map<string, unknown[]>, attempt: NormalizationAttempt, projectId: string): NormalizedProject {
    const identity = attempt.sourceProjects.find(project => project.projectId === projectId);
    requireContract(identity, 'Unknown normalization project');
    const project = image({ storageGeneration: attempt.storageGeneration, projectId, incarnation: identity.incarnation });
    for (const store of stores) for (const candidate of rows.get(store)!) {
      const record = candidate as PhysicalRecord;
      if (record.key[0] === attempt.storageGeneration && record.key[1] === projectId) setRecord(project, store, record);
    }
    reconstructProject(project); return project;
  }
  async function checkedNormalization(rows: Map<string, unknown[]>, attempt: NormalizationAttempt) {
    sameMarker(capturedMarker(rows), attempt);
    const source = await sourceFromRows(capturedSource(rows));
    const prepared = await reservation(source); matchAttemptSource(attempt, prepared.attempt);
    const target = prepareNormalizationTarget(source);
    if (attempt.state !== 'active') assertTargetPrefix(rows, target, attempt.nextRecord);
    if (attempt.state !== 'staging') requireContract(attempt.verificationDigest === await verificationDigest(attempt), 'Invalid normalization verification');
    return { source, target };
  }
  const verificationDigest = (attempt: NormalizationAttempt) => hash(JSON.stringify(['normalization-verification-v2',
    attempt.attemptId, attempt.sourceDigest, attempt.sourceArchiveDigest, attempt.contentDigest,
    attempt.targetManifestDigest, attempt.progressRevision, attempt.recordCount, attempt.workspaceManifestVersion, attempt.initialWorkspaceDigest]));

  /** Hash/reconstruct first, then compare exact captured envelopes synchronously inside the write transaction. */
  async function replaceNormalizationMarker(rows: Map<string, unknown[]>, next: NormalizationAttempt,
    freshWorkspace?: NormalizationSource['records']['workspace']): Promise<void> {
    const phase = next.state === 'active' ? 'cutover' : 'verify';
    const { db } = await open();
    try {
      await new Promise<void>((resolve, reject) => {
        const names = [...sourceStores, ...NORMALIZED_STORE_NAMES]; const tx = db.transaction(names, 'readwrite');
        let failure: unknown; let remaining = names.length;
        tx.oncomplete = () => { try { environment.normalizationFault?.(`${phase}.after-commit`); resolve(); } catch (error) { reject(error); } };
        tx.onabort = () => reject(failure ?? tx.error ?? new Error('Normalization CAS aborted'));
        for (const name of names) {
          const request = tx.objectStore(name).getAll();
          request.onsuccess = () => {
            try {
              const frame = (values: unknown[]) => stores.includes(name as ProjectStoreName)
                ? values.map(value => capturedRecordFrame(name as ProjectStoreName, value)).join(',')
                : captureList(name, values as object[]);
              if (frame(request.result) !== frame(rows.get(name)!)) throw new RepositoryConflict('normalization-contention');
              if (--remaining === 0) {
                if (freshWorkspace) tx.objectStore('workspace').add(freshWorkspace);
                environment.normalizationFault?.(`${phase}.before-marker`);
                const write = tx.objectStore('normalizationLedger').put(next);
                write.onsuccess = () => {
                  try { environment.normalizationFault?.(`${phase}.after-marker`); environment.normalizationFault?.(`${phase}.before-complete`); }
                  catch (error) { failure = error; tx.abort(); }
                };
              }
            } catch (error) { failure = error; tx.abort(); }
          };
        }
      });
    } finally { db.close(); }
  }
  async function stageNormalization(attempt: NormalizationAttempt, records: readonly TaggedNormalizedRecord[]): Promise<NormalizationAttempt> {
    return withRead(undefined, context => context.strictStage(attempt, records));
  }
  async function writeNormalizationStage(attempt: NormalizationAttempt, payload: readonly TargetRecord[], next: NormalizationAttempt, work?: WorkRuntime): Promise<number> {
    let db: IDBDatabase | undefined; let observedMarker: unknown; let matched = false;
    const nextBytes = work ? await work.run(frameBytesWork(canonicalFrame(next))) : 0;
    try {
      const acquire = async () => { db = (await open()).db; };
      if (work) await work.wait(acquire); else await acquire();
      const transact = () => new Promise<void>((resolve, reject) => {
        work?.assertCurrent();
        const tx = db.transaction([...NORMALIZED_STORE_NAMES], 'readwrite'); let failure: unknown;
        tx.oncomplete = () => {
          work?.note('stageTransactions'); work?.note('stageRecords', payload.length);
          try {
            try { environment.normalizationFault?.('stage.after-commit'); } finally { work?.assertCurrent(); }
            resolve();
          } catch (error) { reject(error); }
        };
        tx.onabort = () => reject(failure ?? tx.error ?? new Error('Normalization stage aborted'));
        const guard = (operation: () => void) => { try { work?.assertCurrent(); operation(); work?.assertCurrent(); } catch (error) { failure = error; tx.abort(); } };
        const issue = (ordinal: number) => {
          const item = payload[ordinal];
          if (item) {
            environment.normalizationFault?.('stage.before-record');
            work?.assertCurrent();
            work?.note('writes'); work?.note('primitiveExceptions');
            const write = tx.objectStore(item.store).add(item.record);
            write.onsuccess = () => guard(() => { environment.normalizationFault?.('stage.after-record'); work?.assertCurrent(); issue(ordinal + 1); });
          } else {
            environment.normalizationFault?.('stage.before-marker');
            work?.assertCurrent();
            work?.note('writes'); work?.note('primitiveExceptions'); work?.note('markerWorkBytes', nextBytes);
            const write = tx.objectStore('normalizationLedger').put(next);
            write.onsuccess = () => guard(() => { environment.normalizationFault?.('stage.after-marker'); work?.assertCurrent(); environment.normalizationFault?.('stage.before-complete'); });
          }
        };
        if (work) {
          let count = 0; const request = tx.objectStore('normalizationLedger').openCursor();
          request.onsuccess = () => guard(() => {
            const cursor = request.result;
            if (!cursor) { work.note('eofChecks'); if (count !== 1 || !matched) throw new RepositoryConflict('normalization-contention'); issue(0); return; }
            count++; work.note('markerCasRows'); observedMarker = cursor.value;
            let observed = 0; let expected = 0;
            try {
              if (count !== 1 || cursor.primaryKey !== NORMALIZATION_LEDGER_ID) { matched = false; throw new RepositoryConflict('normalization-contention'); }
              const measured = (value: unknown, actual: boolean): Frame => function* (emit) {
                yield* canonicalFrame(value)(function* (fragment) {
                  const bytes = yield* utf8LengthWork(fragment); if (actual) observed += bytes; else expected += bytes;
                  yield* emit(fragment);
                });
              };
              matched = runSync(equalFrameWork(measured(observedMarker, true), measured(attempt, false)));
              if (!matched) throw new RepositoryConflict('normalization-contention');
            } finally {
              work.note('primitiveExceptions'); work.note('markerBytes', observed); work.note('markerWorkBytes', observed + expected);
              if (!matched) work.note('unmeasuredValues');
              observedMarker = undefined;
            }
            cursor.continue();
          });
        } else {
          const request = tx.objectStore('normalizationLedger').getAll();
          request.onsuccess = () => guard(() => {
            requireContract(request.result.length === 1, 'Missing normalization attempt'); sameMarker(request.result[0], attempt); issue(0);
          });
        }
      });
      if (work) await work.wait(transact); else await transact();
      return nextBytes;
    } finally { observedMarker = undefined; db?.close(); }
  }
  async function readStagedProject(attempt: NormalizationAttempt, projectId: string): Promise<NormalizedProject> {
    return withRead(undefined, context => context.stagedRead(attempt, projectId));
  }
  async function markNormalizationVerified(attempt: NormalizationAttempt, digest: string): Promise<NormalizationAttempt> {
    return withRead(undefined, context => context.strictTransition(attempt, 'verify', digest));
  }
  async function activateNormalization(attempt: NormalizationAttempt): Promise<ActiveAuthority> {
    return withRead(undefined, async context => await context.strictTransition(attempt, 'activate') as ActiveAuthority);
  }
  async function readActiveAuthority(): Promise<ActiveAuthority | undefined> { return (await readActiveSnapshot())?.authority; }
  async function exportGeneration(storageGeneration: string): Promise<WorkspaceSnapshot> {
    const active = await readActiveSnapshot();
    requireContract(active && active.authority.storageGeneration === storageGeneration, 'ingress-required');
    return active.snapshot;
  }
  async function read(scope: ProjectScope, addresses: readonly PhysicalAddress[], phase: RepositoryOperation['phase'], bulk = false,
    trusted = false): Promise<{
    records: NormalizedProject; seen: Set<string>; admission?: BulkAdmission;
  }> {
    const { db, id } = await open(); const records = image(scope); const seen = new Set<string>();
    const all = new Map<string, PhysicalAddress>();
    for (const address of [
      { store: 'projectHeaders', key: prefix(scope).slice(0, 2) }, { store: 'projectPreferences', key: prefix(scope) }, ...addresses,
    ] as PhysicalAddress[]) all.set(addressId(address), address);
    const values: { operation: RepositoryOperation; value: unknown }[] = [];
    try {
      if (bulk && sourceStores.some(store => db.objectStoreNames.contains(store))) {
        const active = await withRead(undefined, context => trusted ? context.trustedSelected(scope) : context.selected(scope));
        const project = active?.records;
        if (!project || project.scope.storageGeneration !== scope.storageGeneration || project.scope.incarnation !== scope.incarnation)
          throw new RepositoryConflict('ingress-required');
        admittedBaselines.add(project);
        return { records: project, seen, admission: active.admission };
      }
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(bulk ? stores : [...new Set([...all.values()].map(a => a.store))], 'readonly'); const tid = ++transactionId;
        let failure: unknown;
        tx.oncomplete = () => resolve(); tx.onabort = () => reject(failure ?? tx.error ?? new Error('read aborted'));
        const get = (store: ProjectStoreName, key?: readonly string[]) => {
          const operation: RepositoryOperation = { phase, transactionId: tid, connectionId: id, store, method: key ? 'get' : 'getAll', ...(key ? { key } : {}) };
          environment.onOperation?.(operation);
          const request = key ? tx.objectStore(store).get([...key]) : tx.objectStore(store).getAll();
          request.onsuccess = () => { values.push({ operation, value: request.result }); };
        };
        try { if (bulk) stores.forEach(store => get(store)); else for (const a of all.values()) get(a.store, a.key); }
        catch (error) { failure = error; tx.abort(); }
      });
    } finally { db.close(); }
    for (const { operation, value } of values) {
      const admitted = environment.readResult ? environment.readResult(operation, value) : value;
      if (operation.key) seen.add(addressId({ store: operation.store, key: operation.key }));
      for (const record of (operation.method === 'getAll' ? admitted : admitted === undefined ? [] : [admitted]) as PhysicalRecord[]) {
        if (bulk && !prefix(scope).slice(0, operation.store === 'projectHeaders' ? 2 : 3).every((v, i) => record.key[i] === v)) continue;
        setRecord(records, operation.store, record);
      }
    }
    pair(records);
    try { validateRecords(records); } catch { throw new RepositoryConflict('verification-failed'); }
    return { records, seen };
  }

  async function write(scope: ProjectScope, captured: Pair, prepared: PreparedChanges, onAbort: () => void): Promise<void> {
    const { db, id } = await open();
    const writes = [...prepared.puts.map(put => ({ store: put.store, key: put.record.key, record: put.record })),
      ...prepared.deletes.map(del => ({ store: del.store, key: del.key, record: undefined }))];
    const needed = [...new Set<ProjectStoreName>(['projectHeaders', 'projectPreferences', ...writes.map(w => w.store)])];
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(needed, 'readwrite'); const tid = ++transactionId; let failure: unknown;
        tx.oncomplete = () => resolve(); tx.onabort = () => { onAbort(); reject(failure ?? tx.error ?? new Error('transaction aborted')); };
        const guard = (fn: () => void) => { try { fn(); } catch (error) { failure = error; tx.abort(); } };
        const operation = (store: ProjectStoreName, method: RepositoryOperation['method'], key: readonly string[]) =>
          environment.onOperation?.({ phase: method === 'get' ? 'cas-read' : 'write', transactionId: tid, connectionId: id, store, method, key });
        let h: ProjectHeader | undefined; let p: ProjectPreferences | undefined; let reads = 0;
        const issue = (ordinal: number) => {
          const item = writes[ordinal];
          if (!item) { environment.fault?.({ phase: 'before-complete' }); return; }
          const method = item.record ? 'put' : 'delete';
          const point = { ordinal, store: item.store, key: item.key };
          environment.fault?.({ ...point, phase: method === 'put' ? 'before-put' : 'before-delete' });
          operation(item.store, method, item.key);
          const request = item.record ? tx.objectStore(item.store).put(item.record) : tx.objectStore(item.store).delete([...item.key]);
          request.onsuccess = () => guard(() => { environment.fault?.({ ...point, phase: method === 'put' ? 'after-put' : 'after-delete' }); issue(ordinal + 1); });
        };
        const compare = () => {
          if (++reads !== 2) return;
          environment.fault?.({ phase: 'before-cas' });
          if (!h || !p || h.incarnation !== scope.incarnation) throw new RepositoryConflict('incarnation-changed');
          if (h.storageRevision !== captured.header.storageRevision || h.foldStructureGeneration !== captured.header.foldStructureGeneration) throw new RepositoryConflict('authority-changed');
          if (p.revision !== captured.preferences.revision) throw new RepositoryConflict('preference-contention');
          for (const field of ['documentBytes', 'projectBaseBytes', 'nodeCount', 'variantCount', 'elementCount'] as const)
            if (h.counters[field] !== captured.header.counters[field]) throw new RepositoryConflict('verification-failed');
          if (p.preferenceBytes !== captured.preferences.preferenceBytes) throw new RepositoryConflict('verification-failed');
          environment.fault?.({ phase: 'after-cas' }); issue(0);
        };
        guard(() => {
          const hk = prefix(scope).slice(0, 2); const pk = prefix(scope);
          operation('projectHeaders', 'get', hk); const hr = tx.objectStore('projectHeaders').get(hk);
          operation('projectPreferences', 'get', pk); const pr = tx.objectStore('projectPreferences').get(pk);
          hr.onsuccess = () => guard(() => { h = hr.result; compare(); }); pr.onsuccess = () => guard(() => { p = pr.result; compare(); });
        });
      });
    } finally { db.close(); }
  }

  async function verifyPrepared(scope: ProjectScope, prepared: PreparedChanges, expected: Pair): Promise<void> {
    environment.fault?.({ phase: 'before-readback' });
    const addresses = [...prepared.puts.map(p => ({ store: p.store, key: p.record.key } as PhysicalAddress)),
      ...prepared.deletes.map(d => ({ store: d.store, key: [...d.key] } as PhysicalAddress))];
    const snapshot = await read(scope, addresses, 'verify-read'); const current = pair(snapshot.records);
    if (!sameAuthority(authority(current.header, current.preferences), authority(expected.header, expected.preferences))) throw new RepositoryConflict('authority-changed');
    for (const [store, record] of [['projectHeaders', expected.header], ['projectPreferences', expected.preferences]] as const)
      if (await hash(frameRecord(store, record)) !== await hash(frameRecord(store, snapshot.records[store].get(recordKey(record.key))!))) throw new RepositoryConflict('verification-failed');
    for (const put of prepared.puts) {
      const record = snapshot.records[put.store].get(recordKey(put.record.key));
      if (!record || await hash(frameRecord(put.store, record)) !== put.digest) throw new RepositoryConflict('verification-failed');
    }
    for (const del of prepared.deletes) if (snapshot.records[del.store].has(recordKey(del.key))) throw new RepositoryConflict('verification-failed');
    environment.fault?.({ phase: 'after-readback' });
  }

  const proofs = ({ header, preferences }: Pair): CommitProof[] => [header.commitProof, preferences.commitProof,
    ...header.commitWindow.entries.map(e => e.proof), ...preferences.commitWindow.entries.map(e => e.proof)].filter((p): p is CommitProof => p !== null);
  async function verifyManifest(scope: ProjectScope, proof: CommitProof, selected: readonly SelectedPostcondition[],
    referenceAddresses: CommitDelta['referenceAddresses'] = [], foldTemplates: CommitDelta['foldTemplates'] = [], work?: WorkRuntime): Promise<void> {
    for (const item of selected) {
      const matches = work ? await work.run(equalFrameWork(orderedFrame(prefix(scope)), orderedFrame(item.address.key.slice(0, 3))))
        : prefix(scope).every((v, i) => item.address.key[i] === v);
      if (!matches) throw new RepositoryConflict('verification-failed');
    }
    const { manifestDigest, ...core } = proof;
    const digest = work ? await hashFrame(work, 'proof', manifestFrame(scope, core, selected, referenceAddresses, foldTemplates))
      : await hash(frameManifest(scope, core, selected, referenceAddresses, foldTemplates));
    if (digest !== manifestDigest) throw new RepositoryConflict('verification-failed');
  }
  async function verifyCore(current: Pair, proof: CommitProof, work?: WorkRuntime): Promise<void> {
    if (!sameAuthority(authority(current.header, current.preferences), proof.after)) throw new RepositoryConflict('authority-changed');
    const core = isBulkCommitProof(proof) ? 'bulk' : true;
    if (core === 'bulk') {
      const owned = work ?? createWorkRuntime({ assertCurrent() {} });
      try {
        const baseline = await verifyBulkProjectProof({ storageGeneration: current.header.key[0], projectId: current.header.key[1], incarnation: current.header.incarnation },
          current.header.bulkBaseline, current.preferences.bulkBoundary, owned);
        requireContract(await owned.run(equalFrameWork(canonicalFrame(proof), canonicalFrame(baseline.proof))), 'Bulk head mismatch');
      } finally { if (!work) owned.dispose(); }
    }
    const digest = (store: ProjectStoreName, record: object) => work ? hashFrame(work, 'proof', recordFrame(store, record, core)) : hash(frameRecord(store, record, core));
    if (await digest('projectHeaders', current.header) !== proof.headerCoreDigest
      || await digest('projectPreferences', current.preferences) !== proof.preferenceCoreDigest) throw new RepositoryConflict('verification-failed');
  }
  async function verifyPostconditions(records: NormalizedProject, selected: readonly SelectedPostcondition[], work?: WorkRuntime): Promise<void> {
    for (const item of selected) {
      const key = work ? await work.run(jsonTextWork(item.address.key)) : recordKey(item.address.key);
      const record = records[item.address.store].get(key);
      if (item.after.type === 'absent' ? record !== undefined : !record || (work
        ? await hashFrame(work, 'proof', recordFrame(item.address.store, record)) : await hash(frameRecord(item.address.store, record))) !== item.after.digest)
        throw new RepositoryConflict('verification-failed');
    }
  }
  type VerifiedInspection = Exclude<CommitInspection, { type: 'committed' }>
    | { type: 'committed'; ack: DocumentSaveAck | PreferenceSaveAck; authority: AuthorityStamp };
  const publicInspection = (result: VerifiedInspection): CommitInspection => result.type === 'committed' ? { type: 'committed', ack: result.ack } : result;
  async function inspect(scope: ProjectScope, commitId: string,
    expected?: { identity: CommitIdentity; requestDigest?: string; lower: number; acknowledgement?: DocumentSaveAck }): Promise<VerifiedInspection> {
    privateId(commitId);
    try {
      const first = pair((await read(scope, [], 'inspect-read')).records);
      const matching = proofs(first).filter(p => p.identity.commitId === commitId);
      const proof = matching[0];
      if (!proof) {
        const original = attempts.get(attemptKey(scope, commitId));
        if (original && expected && (expected.requestDigest !== undefined && original.requestDigest !== expected.requestDigest || original.lower !== expected.lower
          || canonicalStringify(original.identity) !== canonicalStringify(expected.identity))) return { type: 'conflict', reason: 'identity-mismatch' };
        if (original?.aborted) {
          const window = original.identity.lane === 'document' ? first.header.commitWindow : first.preferences.commitWindow;
          const revision = original.identity.lane === 'document' ? first.header.storageRevision : first.preferences.revision;
          if (original.lower >= window.floorRevision && original.lower <= revision) return { type: 'not-committed' };
        }
        return { type: 'conflict', reason: 'proof-unavailable' };
      }
      if (isBulkCommitProof(proof)) return { type: 'conflict', reason: 'proof-unavailable' };
      if (expected && (expected.requestDigest !== undefined && proof.requestDigest !== expected.requestDigest
        || canonicalStringify(proof.identity) !== canonicalStringify(expected.identity))) return { type: 'conflict', reason: 'identity-mismatch' };
      const acknowledgement = ack(scope, proof);
      if (expected?.acknowledgement && canonicalStringify(acknowledgement) !== canonicalStringify(expected.acknowledgement)) return { type: 'conflict', reason: 'identity-mismatch' };
      if (matching.some(p => canonicalStringify(p) !== canonicalStringify(proof))) return { type: 'conflict', reason: 'identity-mismatch' };
      if (!sameAuthority(authority(first.header, first.preferences), proof.after)) return { type: 'conflict', reason: 'authority-changed' };
      const entry = [...first.header.commitWindow.entries, ...first.preferences.commitWindow.entries].find(e => e.proof.identity.commitId === commitId);
      if (!entry) return { type: 'conflict', reason: 'proof-unavailable' };
      await verifyManifest(scope, proof, entry.selected, entry.referenceAddresses, entry.foldTemplates);
      const current = (await read(scope, entry.selected.map(item => item.address), 'inspect-read')).records;
      await verifyCore(pair(current), proof); await verifyPostconditions(current, entry.selected);
      return { type: 'committed', ack: acknowledgement, authority: { ...proof.after } };
    } catch (error) {
      if (error instanceof RepositoryConflict && ['authority-changed', 'identity-mismatch', 'proof-unavailable', 'verification-failed', 'incarnation-changed'].includes(error.reason))
        return { type: 'conflict', reason: error.reason as Extract<CommitInspection, { type: 'conflict' }>['reason'] };
      // Unavailable IDB remains unknown, never guessed not-committed.
      throw error;
    }
  }

  async function synchronize(scope: ProjectScope, owner: Owner, captured: Pair): Promise<void> {
    if (pair(owner.records).header.bulkBaseline?.proof.manifestDigest !== captured.header.bulkBaseline?.proof.manifestDigest) throw new RepositoryConflict('ingress-required');
    const nextStamp = authority(captured.header, captured.preferences);
    if (sameAuthority(owner.stamp, nextStamp)) {
      const cached = pair(owner.records);
      for (const [store, before, now] of [['projectHeaders', cached.header, captured.header], ['projectPreferences', cached.preferences, captured.preferences]] as const)
        if (await hash(frameRecord(store, before)) !== await hash(frameRecord(store, now))) throw new RepositoryConflict('verification-failed');
      return;
    }
    const windows = [[captured.header.commitWindow, owner.stamp.documentRevision], [captured.preferences.commitWindow, owner.stamp.preferenceRevision]] as const;
    const changes = new Map<string, CommitDelta>();
    for (const [window, revision] of windows) {
      if (revision < window.floorRevision) throw new RepositoryConflict('cache-gap');
      for (const entry of window.entries) if (entry.revision > revision) changes.set(entry.proof.identity.commitId, entry);
    }
    const ordered = [...changes.values()].sort((a, b) => a.proof.after.documentRevision + a.proof.after.preferenceRevision - b.proof.after.documentRevision - b.proof.after.preferenceRevision);
    const postconditions = new Map<string, SelectedPostcondition>(); const references = new Map<string, RecordAddress>();
    const targets = new Map<string, Pick<LayerOccurrence, 'variantId' | 'templateId'>>();
    for (const entry of ordered) {
      await verifyManifest(scope, entry.proof, entry.selected, entry.referenceAddresses, entry.foldTemplates);
      for (const item of entry.selected) postconditions.set(addressId(item.address), item);
      for (const address of entry.referenceAddresses) references.set(JSON.stringify(address), address);
      for (const address of entry.foldTemplates) targets.set(JSON.stringify([address.variantId, address.templateId]), address);
    }
    const addresses = [...postconditions.values()].map(item => item.address);
    for (const target of targets.values()) addresses.push({ store: 'projectTemplates', key: [...prefix(scope), target.variantId, target.templateId] });
    const fresh = (await read(scope, addresses, 'prepare-read')).records; const current = pair(fresh);
    if (!sameAuthority(nextStamp, authority(current.header, current.preferences))) throw new RepositoryConflict('preference-contention');
    const latest = proofs(current).find(proof => sameAuthority(proof.after, nextStamp));
    if (!latest) throw new RepositoryConflict('verification-failed');
    await verifyCore(current, latest); await verifyPostconditions(fresh, [...postconditions.values()]);
    const before: NormalizedProjectSlice = {};
    for (const address of addresses) {
      const old = owner.records[address.store].get(recordKey(address.key));
      if (old) {
        const map = (before[address.store] ?? new Map()) as Map<string, PhysicalRecord>;
        map.set(recordKey(address.key), old); Object.assign(before, { [address.store]: map });
      }
      if (!postconditions.has(addressId(address))) {
        const now = fresh[address.store].get(recordKey(address.key));
        if (!!old !== !!now || old && now && await hash(frameRecord(address.store, old)) !== await hash(frameRecord(address.store, now))) throw new RepositoryConflict('verification-failed');
      }
    }
    const exceptionKey = recordKey([...prefix(scope), 'folds']);
    const exceptions = fresh.projectExtensions.get(exceptionKey) ?? owner.records.projectExtensions.get(exceptionKey)!;
    const effects = [...targets.values()].map(address => {
      const template = fresh.projectTemplates.get(recordKey([...prefix(scope), address.variantId, address.templateId]))?.value;
      return { ...address, ...encodeSelectedFoldCells(template, address,
        decodeSelectedFoldCells(template, address, current.preferences.value.layerCollapsed, exceptions.value)) };
    });
    const refresh = prepareAuthoritativeFoldRefresh(owner.folds, { preferences: current.preferences, exceptions, effects });
    const edit: DocumentEdit = { before: referenceProjection(pair(owner.records).header, before), after: referenceProjection(current.header, fresh),
      affected: [...references.values()], changes: [] };
    preflightFoldPublication(owner.folds, refresh);
    updateReferenceIndex(owner.references, edit); publishFoldOverlayChanges(owner.folds, refresh);
    for (const address of addresses) {
      const record = fresh[address.store].get(recordKey(address.key));
      if (record) setRecord(owner.records, address.store, record); else owner.records[address.store].delete(recordKey(address.key));
    }
    setRecord(owner.records, 'projectHeaders', current.header); setRecord(owner.records, 'projectPreferences', current.preferences);
    owner.stamp = nextStamp;
    observePublication(scope, nextStamp, 'remote');
  }

  function validateBatch(batch: DocumentBatch | PreferenceBatch, lane: CommitIdentity['lane']): CommitIdentity {
    const common = ['scope', 'commitId', 'clientId', 'commitGeneration', 'editorGeneration'];
    exactFields(batch, [...common, ...(lane === 'document' ? ['expectedRevision', 'changes'] : ['observedPreferenceRevision', 'patch'])], lane === 'document' ? ['structural', 'metadata'] : ['folds']);
    Object.values(exactFields(batch.scope, ['storageGeneration', 'projectId', 'incarnation'])).forEach(v => requireContract(typeof v === 'string' && v.length > 0, 'Invalid scope'));
    const identity = { clientId: batch.clientId, commitGeneration: batch.commitGeneration, commitId: batch.commitId, editorGeneration: batch.editorGeneration, lane };
    validateIdentity(identity); safeCounter(lane === 'document' ? (batch as DocumentBatch).expectedRevision : (batch as PreferenceBatch).observedPreferenceRevision);
    if (lane === 'document') denseDataArray((batch as DocumentBatch).changes);
    if (lane === 'preferences') {
      const patch = exactFields((batch as PreferenceBatch).patch, [], ['activeVariantId', 'selectedNodeId', 'selectedTemplateId', 'scale', 'viewMode',
        'sidebarWidth', 'propertiesPanelWidth', 'snapToGrid', 'showGrid', 'panelsExpanded']);
      canonicalStringify(patch);
    }
    const structural = lane === 'document' ? (batch as DocumentBatch).structural : (batch as PreferenceBatch).folds;
    if (structural) {
      exactFields(structural, ['expectedFoldStructureGeneration', lane === 'document' ? 'mappings' : 'updates']);
      safeCounter(structural.expectedFoldStructureGeneration);
      if (lane === 'document') {
        const mappings = (batch as DocumentBatch).structural!.mappings; denseDataArray(mappings);
        for (const mapping of mappings) {
          const type = Object.getOwnPropertyDescriptor(mapping, 'type')?.value;
          exactFields(mapping, type === 'create' ? ['type', 'to', 'cell'] : type === 'remove' ? ['type', 'from'] : ['type', 'from', 'to']);
          if ('cell' in mapping) {
            const cell = exactFields(mapping.cell, ['present'], ['value']);
            exactFields(cell, cell.present ? ['present', 'value'] : ['present']);
          }
        }
      } else {
        const updates = (batch as PreferenceBatch).folds!.updates; denseDataArray(updates);
        const seen = new Set<string>();
        for (const update of updates) {
          exactFields(update, ['occurrence', 'collapsed']); exactFields(update.occurrence, ['variantId', 'templateId', 'position']);
          requireContract(typeof update.collapsed === 'boolean' && typeof update.occurrence.variantId === 'string' && typeof update.occurrence.templateId === 'string', 'Invalid fold update');
          safeCounter(update.occurrence.position);
          const key = JSON.stringify([update.occurrence.variantId, update.occurrence.templateId, update.occurrence.position]);
          requireContract(!seen.has(key), 'Duplicate fold update'); seen.add(key);
        }
      }
    }
    return identity;
  }

  async function commit(batch: DocumentBatch | PreferenceBatch, lane: CommitIdentity['lane'], requestFrame: string): Promise<DocumentSaveAck | PreferenceSaveAck> {
    const identity = validateBatch(batch, lane); const requestDigest = await hash(requestFrame);
    const owner = owners.get(ownerKey(batch.scope)); if (!owner?.valid) throw new RepositoryConflict('ingress-required');
    preparation: for (let attempt = 0; attempt < 8; attempt++) {
      const selected = await read(batch.scope, [], 'prepare-read'); const captured = pair(selected.records);
      if (pair(owner.records).header.bulkBaseline?.proof.manifestDigest !== captured.header.bulkBaseline?.proof.manifestDigest) throw new RepositoryConflict('ingress-required');
      const capturedStamp = authority(captured.header, captured.preferences);
      const retained = proofs(captured);
      const replay = retained.find(proof => proof.identity.commitId === batch.commitId);
      if (replay) {
        if (replay.requestDigest !== requestDigest || canonicalStringify(replay.identity) !== canonicalStringify(identity)) throw new RepositoryConflict('identity-mismatch');
        const inspection = await inspect(batch.scope, batch.commitId);
        if (inspection.type !== 'committed') throw new RepositoryConflict(inspection.type === 'conflict' ? inspection.reason : 'proof-unavailable');
        return inspection.ack;
      }
      if (lane === 'document' && captured.header.storageRevision !== (batch as DocumentBatch).expectedRevision) throw new RepositoryConflict('authority-changed');
      const lower = lane === 'document' ? (batch as DocumentBatch).expectedRevision : (batch as PreferenceBatch).observedPreferenceRevision;
      const lineage = lane === 'document' ? captured.header : captured.preferences;
      const revision = lane === 'document' ? captured.header.storageRevision : captured.preferences.revision;
      if (lower > revision || lower < lineage.commitWindow.floorRevision) throw new RepositoryConflict('proof-unavailable');
      if (retained.some(proof => proof.identity.clientId === identity.clientId && proof.identity.commitGeneration >= identity.commitGeneration)) throw new RepositoryConflict('identity-mismatch');
      const structural = lane === 'document' ? (batch as DocumentBatch).structural : (batch as PreferenceBatch).folds;
      if (structural && structural.expectedFoldStructureGeneration !== captured.header.foldStructureGeneration) throw new RepositoryConflict('stale-fold-generation');
      const deferCaches = lane === 'preferences' && !(batch as PreferenceBatch).folds?.updates.length
        && owner.stamp.documentRevision !== captured.header.storageRevision;
      if (deferCaches) {
        const latest = retained.find(proof => sameAuthority(proof.after, capturedStamp));
        if (!latest) throw new RepositoryConflict('verification-failed');
        await verifyCore(captured, latest);
        for (const entry of [...captured.header.commitWindow.entries, ...captured.preferences.commitWindow.entries])
          await verifyManifest(batch.scope, entry.proof, entry.selected, entry.referenceAddresses, entry.foldTemplates);
      } else {
        try { await synchronize(batch.scope, owner, captured); }
        catch (error) { if (error instanceof RepositoryConflict && error.reason === 'preference-contention') continue; throw error; }
      }
      const exceptions = owner.records.projectExtensions.get(recordKey([...prefix(batch.scope), 'folds']))!;
      const currentPreferences = deferCaches ? captured.preferences : owner.records.projectPreferences.get(recordKey(prefix(batch.scope)))!;
      const base = ledgerOf(captured); let prepared: PreparedChanges;
      let addressingChanged = false;
      let foldTemplates: Pick<LayerOccurrence, 'variantId' | 'templateId'>[] = [];
      const context: ValidationContext = { scope: batch.scope, header: captured.header, ledger: base, references: owner.references, folds: owner.folds,
        scalarPreferencesOnly: deferCaches,
        read: ((store: ProjectStoreName, key: readonly string[]) => {
          if (store === 'projectExtensions' && key[3] === 'folds') return exceptions;
          if (store === 'projectPreferences') return currentPreferences;
          const address = { store, key: [...key] } as PhysicalAddress;
          if (!selected.seen.has(addressId(address))) throw new MissingSelected(address);
          return selected.records[store].get(recordKey(key));
        }) as ValidationContext['read'] };
      context.resolveOverlays = templates => {
        const effects: NormalizedFoldEffect[] = []; const targetKey = (a: Pick<LayerOccurrence, 'variantId' | 'templateId'>) => JSON.stringify([a.variantId, a.templateId]);
        const readTemplate = (a: Pick<LayerOccurrence, 'variantId' | 'templateId'>) => context.read('projectTemplates', [...prefix(batch.scope), a.variantId, a.templateId])?.value;
        const cells = (template: SelectedLayerSequence['before'], address: SelectedLayerSequence['address']) =>
          decodeSelectedFoldCells(template, address, currentPreferences.value.layerCollapsed, exceptions.value);
        addressingChanged = false; foldTemplates = [];
        if (lane === 'document') {
          const mappings = (batch as DocumentBatch).structural?.mappings ?? [];
          const sequences: SelectedLayerSequence[] = templates.map(sequence => ({ ...sequence, cells: cells(sequence.before, sequence.address) }));
          const selectedKeys = new Set(sequences.map(s => targetKey(s.address)));
          for (const mapping of mappings) if ('from' in mapping && !selectedKeys.has(targetKey(mapping.from))) {
            const template = readTemplate(mapping.from); sequences.push({ address: mapping.from, before: template, after: template, cells: cells(template, mapping.from) });
            selectedKeys.add(targetKey(mapping.from));
          }
          const output = reconcileSelectedLayerFolds(sequences, mappings);
          for (const effect of output) {
            const sequence = sequences.find(s => targetKey(s.address) === targetKey(effect))!;
            const encoded = encodeSelectedFoldCells(sequence.after, effect, effect.cells);
            const before = encodeSelectedFoldCells(sequence.before, effect, sequence.cells);
            foldTemplates.push({ variantId: effect.variantId, templateId: effect.templateId });
            if (canonicalStringify(encoded) !== canonicalStringify(before)) effects.push({ variantId: effect.variantId, templateId: effect.templateId, ...encoded });
            if (!!sequence.before !== !!sequence.after) addressingChanged = true;
          }
          for (const mapping of mappings) {
            if (mapping.type !== 'continue') { addressingChanged = true; continue; }
            if (targetKey(mapping.from) !== targetKey(mapping.to) || mapping.from.position !== mapping.to.position) { addressingChanged = true; continue; }
            const sequence = sequences.find(s => targetKey(s.address) === targetKey(mapping.from))!;
            const old = sequence.before?.layers?.[mapping.from.position]; const next = sequence.after?.layers?.[mapping.to.position];
            const identity = (layer: unknown) => layer && typeof layer === 'object'
              ? { object: true, ...(Object.hasOwn(layer, 'id') ? { id: Reflect.get(layer, 'id') } : {}) } : { object: false, value: layer };
            if (canonicalStringify(identity(old)) !== canonicalStringify(identity(next))) addressingChanged = true;
          }
        } else {
          const targets = new Map<string, { address: LayerOccurrence; template: SelectedLayerSequence['before']; cells: ReturnType<typeof cells> }>();
          for (const update of (batch as PreferenceBatch).folds?.updates ?? []) {
            const key = targetKey(update.occurrence); let target = targets.get(key);
            if (!target) { const template = readTemplate(update.occurrence); target = { address: update.occurrence, template, cells: [...cells(template, update.occurrence)] }; targets.set(key, target); }
            requireContract(update.occurrence.position < target.cells.length, 'Invalid layer occurrence');
            (target.cells as { present: boolean; value?: unknown }[])[update.occurrence.position] = { present: true, value: update.collapsed };
          }
          for (const target of targets.values()) {
            const address = { variantId: target.address.variantId, templateId: target.address.templateId };
            effects.push({ ...address, ...encodeSelectedFoldCells(target.template, address, target.cells) }); foldTemplates.push(address);
          }
        }
        if (!effects.length && lane === 'document') return undefined;
        const folds = effects.length ? prepareFoldOverlayChanges(owner.folds, effects) : undefined;
        const value = { ...currentPreferences.value, ...(lane === 'preferences' ? (batch as PreferenceBatch).patch : {}),
          layerCollapsed: folds?.layerCollapsed ?? currentPreferences.value.layerCollapsed };
        return { preferences: { ...currentPreferences, value, encodedSize: { ...currentPreferences.encodedSize, valueBytes: jsonBytes(value) } },
          exceptions: folds ? { ...exceptions, value: folds.exceptions, encodedSize: { valueBytes: jsonBytes(folds.exceptions) } } : exceptions, folds };
      };
      for (;;) {
        try { prepared = validateIncrementalChanges(context, lane === 'document' ? (batch as DocumentBatch).changes : [],
          lane === 'document' ? (batch as DocumentBatch).metadata : undefined); break; }
        catch (error) {
          if (!(error instanceof MissingSelected)) throw error;
          const more = await read(batch.scope, [error.address], 'prepare-read'); const next = pair(more.records);
          if (next.header.storageRevision !== capturedStamp.documentRevision
            || next.header.foldStructureGeneration !== capturedStamp.foldStructureGeneration) throw new RepositoryConflict('authority-changed');
          // Discard the partial slice and drafts; retain the original request and
          // evidence lower bound while reacquiring through the bounded retry loop.
          if (next.preferences.revision !== capturedStamp.preferenceRevision) continue preparation;
          selected.seen.add(addressId(error.address));
          const record = more.records[error.address.store].get(recordKey(error.address.key));
          const cached = owner.records[error.address.store].get(recordKey(error.address.key));
          if (!!record !== !!cached || record && cached && await hash(frameRecord(error.address.store, record)) !== await hash(frameRecord(error.address.store, cached))) throw new RepositoryConflict('verification-failed');
          if (record) setRecord(selected.records, error.address.store, record);
        }
      }
      let header: ProjectHeader | undefined;
      let preferences = prepared.after.projectPreferences?.values().next().value;
      if (lane === 'document') {
        const updatedAt = environment.now(); canonicalTimestamp(updatedAt);
        header = { ...(prepared.after.projectHeaders?.values().next().value ?? captured.header), storageRevision: captured.header.storageRevision + 1,
          lastCommitId: batch.commitId, updatedAt, foldStructureGeneration: captured.header.foldStructureGeneration + Number(addressingChanged) };
      }
      const foldPut = prepared.puts.find(put => put.store === 'projectExtensions' && put.record.key[3] === 'folds');
      requireContract(!foldPut || preferences, 'Fold write requires atomic preferences');
      requireContract(!prepared.deletes.some(del => del.store === 'projectExtensions' && del.key[3] === 'folds'), 'Cannot delete fold evidence');
      const changedFoldDigest = foldPut ? await hash(frameRecord('projectExtensions', foldPut.record)) : undefined;
      if (preferences || lane === 'preferences') {
        // Only independently admitted initial bytes can supply the first receipt.
        // Advanced scalar saves carry the authenticated captured pair, not owner caches.
        const foldRecordDigest = changedFoldDigest ?? (captured.preferences.revision === 0 && captured.preferences.commitProof === null
          ? owner.initialFoldRecordDigest : captured.preferences.foldRecordDigest);
        validDigest(foldRecordDigest);
        preferences = { ...(preferences ?? captured.preferences), revision: captured.preferences.revision + 1,
          lastCommitId: batch.commitId, foldRecordDigest };
      }
      prepared = finalizePreparedChanges(base, prepared, captured.header, captured.preferences, header, preferences);
      header = prepared.after.projectHeaders?.values().next().value; preferences = prepared.after.projectPreferences?.values().next().value;
      const finalPair = { header: header ?? captured.header, preferences: preferences ?? captured.preferences };
      const selectedProof: SelectedPostcondition[] = [];
      for (const put of prepared.puts) if (!['projectHeaders', 'projectPreferences'].includes(put.store)) selectedProof.push({
        address: { store: put.store, key: put.record.key } as PhysicalAddress, after: { type: 'present',
          digest: put.store === 'projectExtensions' && put.record.key[3] === 'folds' ? changedFoldDigest! : await hash(frameRecord(put.store, put.record)) } });
      for (const del of prepared.deletes) selectedProof.push({ address: { store: del.store, key: [...del.key] } as PhysicalAddress, after: { type: 'absent' } });
      const core = { identity, requestDigest, before: capturedStamp, after: authority(finalPair.header, finalPair.preferences),
        headerCoreDigest: await hash(frameRecord('projectHeaders', finalPair.header, true)),
        preferenceCoreDigest: await hash(frameRecord('projectPreferences', finalPair.preferences, true)) };
      const proof: CommitProof = { ...core, manifestDigest: await hash(frameManifest(batch.scope, core, selectedProof, prepared.referenceEdit.affected, foldTemplates)) };
      const delta = { proof, selected: selectedProof, referenceAddresses: prepared.referenceEdit.affected, foldTemplates };
      if (header) header = { ...header, commitProof: proof, commitWindow: appendCommitWindow(captured.header.commitWindow, { ...delta, revision: header.storageRevision }) };
      if (preferences) preferences = { ...preferences, commitProof: proof, commitWindow: appendCommitWindow(captured.preferences.commitWindow, { ...delta, revision: preferences.revision }) };
      prepared = finalizePreparedChanges(base, prepared, captured.header, captured.preferences, header, preferences);
      for (const put of prepared.puts) put.digest = put.store === 'projectExtensions' && put.record.key[3] === 'folds'
        ? changedFoldDigest! : await hash(frameRecord(put.store, put.record));
      const final = image(batch.scope); for (const put of prepared.puts) setRecord(final, put.store, put.record); validateRecords(final);
      let durable = false, confirmedAbort = false;
      const connectionEpoch = connectionLossEpoch, workspaceEpoch = workspaceAdmissionEpoch, workspace = currentWorkspaceOwner?.workspace;
      remember(batch.scope, identity, requestDigest, lower, false);
      try {
        await write(batch.scope, captured, prepared, () => { confirmedAbort = true; }); durable = true;
        environment.fault?.({ phase: 'after-commit' });
        const expected = { header: header ?? captured.header, preferences: preferences ?? captured.preferences };
        await verifyPrepared(batch.scope, prepared, expected);
        if (!deferCaches) {
          preflightFoldPublication(owner.folds, prepared.foldEdit);
          updateReferenceIndex(owner.references, prepared.referenceEdit); publishFoldOverlayChanges(owner.folds, prepared.foldEdit);
          for (const del of prepared.deletes) owner.records[del.store].delete(recordKey(del.key));
          for (const put of prepared.puts) setRecord(owner.records, put.store, put.record);
          setRecord(owner.records, 'projectHeaders', expected.header);
          // Unchanged preferences already belong to the synchronized fold index.
          // The independently read verification record has equal content, not the
          // same map identities. Only prepared preferences can replace this owner.
          setRecord(owner.records, 'projectPreferences', preferences ?? currentPreferences);
          owner.stamp = core.after;
        }
        // A scalar-only save has no derived effects. Keep deferred owners tagged
        // with their old, internally consistent snapshot until selected catch-up.
        owner.lastVerified = { ...core.after };
        observePublication(batch.scope, core.after, 'local');
        return ack(batch.scope, proof);
      } catch (error) {
        if (durable) owner.valid = false;
        const original = remember(batch.scope, identity, requestDigest, lower, !durable);
        if (confirmedAbort && !durable && workspace && owner.valid && connectionEpoch === connectionLossEpoch && workspaceEpoch === workspaceAdmissionEpoch
          && owners.get(ownerKey(batch.scope)) === owner && attempts.get(attemptKey(batch.scope, identity.commitId)) === original) {
          let ownerIdentity = continuationIdentities.get(owner);
          if (!ownerIdentity) { ownerIdentity = Object.freeze({}); continuationIdentities.set(owner, ownerIdentity); }
          rollbackEvidence.set(original, { owner: ownerIdentity, connectionEpoch, workspaceEpoch,
            workspaceRevision: workspace.revision, workspaceDigest: workspace.coreDigest, before: { ...capturedStamp } });
        }
        if (!durable && error instanceof RepositoryConflict && error.reason === 'preference-contention') continue;
        throw error;
      }
    }
    throw new RepositoryConflict('preference-contention');
  }

  function queueBatch(batch: DocumentBatch | PreferenceBatch, lane: CommitIdentity['lane']): Promise<DocumentSaveAck | PreferenceSaveAck> {
    try {
      validateBatch(batch, lane);
      const requestFrame = frameBatch(batch);
      // Capture only the admitted changed-record message, never an installed
      // document/cache. Caller mutation during async hashing cannot change its proof.
      const captured = structuredClone(batch);
      return serial(captured.scope, () => commit(captured, lane, requestFrame));
    } catch (error) { return Promise.reject(error); }
  }

  function replacementPlan(scope: ProjectScope): { selections: WorkspaceSelection[]; scopes: ProjectScope[] } {
    return { scopes: [scope], selections: stores.map(store => {
      const lower = store === 'projectHeaders' ? [scope.storageGeneration, scope.projectId] : prefix(scope);
      const upper = [...lower]; upper[upper.length - 1] += '\0';
      return { store, lower, upper };
    }) };
  }
  async function replacementImage(capture: WorkspaceCapture, scope: ProjectScope, work: WorkRuntime) {
    const project = image(scope);
    for (let index = 0; index < capture.selections.length; index++) {
      const store = capture.selections[index].store as ProjectStoreName;
      for (const row of capture.rows[index]) {
        const record = row.value as PhysicalRecord, key = await work.run(jsonTextWork(record.key));
        await work.run(effect(1, () => { (project[store] as Map<string, PhysicalRecord>).set(key, record); }));
      }
    }
    const external = await work.run(reconstructProjectWork(project));
    return { project, external };
  }
  const replacementIdentity = (batch: BulkDocumentBatch): CommitIdentity => ({ clientId: batch.clientId,
    commitId: batch.commitId, commitGeneration: batch.commitGeneration, editorGeneration: batch.editorGeneration, lane: 'document' });
  const replacementAck = (scope: ProjectScope, proof: NonNullable<ProjectHeader['bulkBaseline']>['proof']): BulkDocumentAck => ({
    type: 'document-replaced', projectId: scope.projectId, incarnation: scope.incarnation, commitId: proof.identity.commitId,
    editorGeneration: proof.identity.editorGeneration, authority: { ...proof.after }, boundaryDigest: proof.manifestDigest,
  });

  async function inspectReplacementCaptured(batch: BulkDocumentBatch, work: WorkRuntime): Promise<BulkCommitInspection> {
    try {
      const requestDigest = await hashBulkDocumentRequest(batch, work), identity = replacementIdentity(batch);
      // A restart has no cached admission. Use the existing independently sealed active admission boundary.
      const { records: current } = await read(batch.scope, [], 'ingress-read', true);
      const currentPair = pair(current), stamp = authority(currentPair.header, currentPair.preferences);
      const baseline = currentPair.header.bulkBaseline;
      if (!baseline || baseline.proof.identity.commitId !== batch.commitId) {
        const original = attempts.get(attemptKey(batch.scope, batch.commitId));
        if (original && (original.requestDigest !== requestDigest
          || !await work.run(equalFrameWork(canonicalFrame(original.identity), canonicalFrame(identity))))) return { type: 'conflict', reason: 'identity-mismatch' };
        if (original?.aborted && original.lower === batch.expected.documentRevision && sameAuthority(stamp, batch.expected)) return { type: 'not-committed' };
        return { type: 'conflict', reason: 'proof-unavailable' };
      }
      if (baseline.proof.requestDigest !== requestDigest
        || !await work.run(equalFrameWork(canonicalFrame(baseline.proof.identity), canonicalFrame(identity)))) return { type: 'conflict', reason: 'identity-mismatch' };
      if (!sameAuthority(stamp, baseline.proof.after)) return { type: 'conflict', reason: 'authority-changed' };
      await verifyBulkProjectBaseline(current, work);
      return { type: 'committed', ack: replacementAck(batch.scope, baseline.proof) };
    } catch (error) {
      if (error instanceof RepositoryConflict && ['authority-changed', 'identity-mismatch', 'proof-unavailable', 'verification-failed', 'incarnation-changed'].includes(error.reason))
        return { type: 'conflict', reason: error.reason as Extract<BulkCommitInspection, { type: 'conflict' }>['reason'] };
      throw error;
    }
  }
  async function inspectReplacement(source: BulkDocumentBatch): Promise<BulkCommitInspection> {
    frameBulkDocumentBatch(source); const epoch = connectionLossEpoch;
    const work = createWorkRuntime({ assertCurrent() { if (epoch !== connectionLossEpoch) throw new RepositoryConflict('ingress-required'); } });
    let captured: Awaited<ReturnType<typeof captureBulkDocumentBatch>> | undefined;
    try {
      const input = captureBulkDocumentBatch(source, work); // Native detachment before the first suspension.
      captured = await input;
      return await serial(captured.batch.scope, () => inspectReplacementCaptured(captured!.batch, work));
    } finally { captured?.release(); work.dispose(); }
  }
  async function commitReplacement(source: BulkDocumentBatch, providedWork?: WorkRuntime): Promise<BulkDocumentAck> {
    frameBulkDocumentBatch(source);
    const key = ownerKey(source.scope), owner = owners.get(key); if (!owner?.valid) throw new RepositoryConflict('ingress-required');
    const epoch = connectionLossEpoch; let durable = false;
    const guard = () => {
      if (epoch !== connectionLossEpoch || owners.get(key) !== owner || !durable && !owner.valid) throw new RepositoryConflict('ingress-required');
    };
    const work = providedWork ?? createWorkRuntime({ assertCurrent: guard }); assertWorkRuntime(work);
    const removeGuard = providedWork ? work.addGuard(guard) : undefined;
    let input: Awaited<ReturnType<typeof captureBulkDocumentBatch>> | undefined;
    let capture: WorkspaceCapture | undefined, prepared: PreparedBulkProject | undefined;
    try {
      const captured = captureBulkDocumentBatch(source, work);
      input = await captured;
      const batch = input.batch;
      return await serial(batch.scope, async () => {
        capture = await captureWorkspaceRows(replacementPlan(batch.scope), work, 'prepare-read');
        const { project: current, external: currentExternal } = await replacementImage(capture, batch.scope, work);
        const currentPair = pair(current), cachedPair = pair(owner.records);
        if (currentPair.header.bulkBaseline?.proof.manifestDigest !== cachedPair.header.bulkBaseline?.proof.manifestDigest) throw new RepositoryConflict('ingress-required');
        requireContract(await work.run(equalFrameWork(
          canonicalFrame([currentPair.header.migrationBaseline ?? null, currentPair.header.workspaceBirth ?? null]),
          canonicalFrame([cachedPair.header.migrationBaseline ?? null, cachedPair.header.workspaceBirth ?? null]))), 'Replacement ancestry changed');
        await verifyBulk(current, true, work, currentExternal);
        if (currentPair.header.bulkBaseline?.proof.identity.commitId === batch.commitId) {
          const result = await inspectReplacementCaptured(batch, work);
          if (result.type !== 'committed') throw new RepositoryConflict(result.type === 'conflict' ? result.reason : 'proof-unavailable');
          return result.ack;
        }
        if (!sameAuthority(authority(currentPair.header, currentPair.preferences), batch.expected)) throw new RepositoryConflict('authority-changed');
        // A live admitted cache anchors unchanged records too. A newer scalar proof
        // cannot bless unexplained document/wrapper corruption before replacement.
        if (!sameAuthority(owner.stamp, batch.expected)) throw new RepositoryConflict('ingress-required');
        for (const store of stores) {
          if (current[store].size !== owner.records[store].size) throw new RepositoryConflict('verification-failed');
          for (const [key, record] of current[store]) {
            const known = owner.records[store].get(key);
            if (!known || !await work.run(equalFrameWork(recordFrame(store, record), recordFrame(store, known))))
              throw new RepositoryConflict('verification-failed');
          }
        }
        const identity = replacementIdentity(batch);
        if (proofs(currentPair).some(proof => proof.identity.clientId === identity.clientId && proof.identity.commitGeneration >= identity.commitGeneration))
          throw new RepositoryConflict('identity-mismatch');
        prepared = await prepareBulkProject(current, batch, environment.now(), work);
        const proof = pair(prepared.project).header.bulkBaseline!.proof;
        const original = attempts.get(attemptKey(batch.scope, batch.commitId));
        if (original && (original.requestDigest !== proof.requestDigest || original.lower !== batch.expected.documentRevision
          || !await work.run(equalFrameWork(canonicalFrame(original.identity), canonicalFrame(identity))))) throw new RepositoryConflict('identity-mismatch');
        remember(batch.scope, identity, proof.requestDigest, batch.expected.documentRevision, false);
        try {
          work.setContext('activate', 'target', 'proof');
          await sealWorkspaceCapture(capture, work, { removeProjects: [batch.scope], addProjects: [prepared.project] }, () => {
            durable = true; owner.valid = false;
          });
          environment.workspaceFault?.({ phase: 'after-commit' }); work.assertCurrent();
          capture.release(); capture = undefined;
          environment.workspaceFault?.({ phase: 'before-readback' }); work.setContext('verify', 'target', 'proof');
          capture = await captureWorkspaceRows(replacementPlan(batch.scope), work, 'verify-read');
          const { project: fresh, external: freshExternal } = await replacementImage(capture, batch.scope, work);
          const freshPair = pair(fresh);
          const admitted = await verifyBulk(fresh, true, work, freshExternal);
          requireContract(sameAuthority(admitted.stamp, prepared.ack.authority)
            && freshPair.header.bulkBaseline?.proof.manifestDigest === proof.manifestDigest, 'Replacement readback mismatch');
          const parts = await work.run(partitionStateWork(admitted.external.initialState));
          const references = await work.run(buildReferenceIndexWork(parts.document));
          const exceptions = fresh.projectExtensions.get(await work.run(jsonTextWork([...prefix(batch.scope), 'folds'])))!;
          const folds = await work.run(createFoldOverlayIndexWork(freshPair.preferences, exceptions));
          await sealWorkspaceCapture(capture, work); environment.workspaceFault?.({ phase: 'after-readback' }); work.assertCurrent();
          owners.set(ownerKey(batch.scope), { records: fresh, references, folds, stamp: admitted.stamp, lastVerified: { ...admitted.stamp }, valid: true });
          observePublication(batch.scope, admitted.stamp, 'local');
          return prepared.ack;
        } catch (error) {
          remember(batch.scope, identity, proof.requestDigest, batch.expected.documentRevision, !durable);
          throw error;
        }
      });
    } finally { prepared?.release(); capture?.release(); input?.release(); removeGuard?.(); if (!providedWork) work.dispose(); }
  }

  const admittedBaselines = new WeakSet<NormalizedProject>();
  async function verifyBulk(fresh: NormalizedProject, verifiedActive = false, work?: WorkRuntime, external?: WorkspaceProject) {
    external ??= work ? await work.run(reconstructProjectWork(fresh)) : reconstructProject(fresh);
    const key = prefix(fresh.scope);
    const { header, preferences } = work ? {
      header: fresh.projectHeaders.get(await work.run(jsonTextWork(key.slice(0, 2))))!,
      preferences: fresh.projectPreferences.get(await work.run(jsonTextWork(key)))!,
    } : pair(fresh);
    const stamp = authority(header, preferences);
    if (header.bulkBaseline) {
      const owned = work ?? createWorkRuntime({ assertCurrent() {} });
      try { await verifyBulkProjectBaseline(fresh, owned); } finally { if (!work) owned.dispose(); }
    }
    if (header.migrationBaseline && !verifiedActive && !admittedBaselines.has(fresh)) throw new RepositoryConflict('ingress-required');
    const folds = fresh.projectExtensions.get(work ? await work.run(jsonTextWork([...key, 'folds'])) : recordKey([...key, 'folds']))!;
    const foldRecordDigest = work ? await hashFrame(work, 'proof', recordFrame('projectExtensions', folds)) : await hash(frameRecord('projectExtensions', folds));
    if (preferences.revision && foldRecordDigest !== preferences.foldRecordDigest) throw new RepositoryConflict('verification-failed');
    const entries = [...header.commitWindow.entries, ...preferences.commitWindow.entries]; // Each validated window is capped at32.
    const compare = (a: CommitDelta, b: CommitDelta) => a.proof.after.documentRevision + a.proof.after.preferenceRevision - b.proof.after.documentRevision - b.proof.after.preferenceRevision;
    const retained = work ? await work.run(stableSortWork(entries, (a, b) => effect(1, () => compare(a, b)))) : entries.sort(compare);
    const selected = new Map<string, SelectedPostcondition>();
    for (const entry of retained) {
      await verifyManifest(fresh.scope, entry.proof, entry.selected, entry.referenceAddresses, entry.foldTemplates, work);
      // Only intervals covered by BOTH windows establish a current postcondition.
      if (entry.proof.after.documentRevision >= header.commitWindow.floorRevision
        && entry.proof.after.preferenceRevision >= preferences.commitWindow.floorRevision)
        for (const item of entry.selected) {
          const key = work ? await work.run(jsonTextWork([item.address.store, item.address.key])) : addressId(item.address);
          selected.set(key, item);
        }
    }
    const postconditions: SelectedPostcondition[] = [];
    for (const value of selected.values()) {
      if (work) await work.run(effect(1, () => { postconditions.push(value); })); else postconditions.push(value);
    }
    await verifyPostconditions(fresh, postconditions, work);
    const latest = proofs({ header, preferences }).find(proof => sameAuthority(proof.after, stamp));
    if (latest) await verifyCore({ header, preferences }, latest, work);
    else if (header.storageRevision !== (header.migrationBaseline?.sourceRevision ?? 0) || preferences.revision) throw new RepositoryConflict('verification-failed');
    return { external, preferences, stamp, foldRecordDigest };
  }

  return {
    admitWorkspace,
    openEditingWorkspace,
    resumeAbortedWorkspace,
    commitWorkspace, fenceWorkspace, inspectWorkspaceAttempt,
    prepareWorkspaceRecovery, commitWorkspaceRecovery, discardWorkspaceRecovery,
    openNormalizationSession,
    readActiveSnapshot, readRetainedSource,
    readNormalizationSource,
    reserveNormalization,
    stageNormalization, readStagedProject, markNormalizationVerified, activateNormalization, readActiveAuthority, exportGeneration,
    openAdmittedProject: async input => {
      Object.values(exactFields(input, ['storageGeneration', 'projectId', 'incarnation'])).forEach(value => requireContract(typeof value === 'string' && value.length > 0, 'Invalid scope'));
      const scope = { ...input };
      return serial(scope, async () => {
        const result = await read(scope, [], 'ingress-read', true, true), records = result.records;
        const { external, preferences, stamp, foldRecordDigest } = result.admission ?? await verifyBulk(records);
        owners.set(ownerKey(scope), { records, stamp, lastVerified: { ...stamp }, valid: true,
          ...(preferences.revision === 0 && preferences.commitProof === null ? { initialFoldRecordDigest: foldRecordDigest } : {}),
          references: buildReferenceIndex(partitionState(external.initialState).document),
          folds: createFoldOverlayIndex(preferences, records.projectExtensions.get(recordKey([...prefix(scope), 'folds']))!) });
        return { project: external, authority: stamp };
      });
    },
    bindAdmittedProject: async project => {
      exactFields(project, ['scope', ...NORMALIZED_STORE_NAMES]);
      Object.values(exactFields(project.scope, ['storageGeneration', 'projectId', 'incarnation'])).forEach(v => requireContract(typeof v === 'string' && v.length > 0, 'Invalid scope'));
      project = { ...project, scope: { ...project.scope } };
      return serial(project.scope, async () => {
        reconstructProject(project);
        const result = await read(project.scope, [], 'ingress-read', true, true); const fresh = result.records;
        for (const store of stores) {
          if (fresh[store].size !== project[store].size) throw new RepositoryConflict('verification-failed');
          for (const [key, record] of project[store]) {
            const current = fresh[store].get(key);
            if (!current || await hash(frameRecord(store, record)) !== await hash(frameRecord(store, current))) throw new RepositoryConflict('verification-failed');
          }
        }
        const { external, preferences, stamp, foldRecordDigest } = result.admission ?? await verifyBulk(fresh);
      owners.set(ownerKey(project.scope), { records: fresh, stamp, lastVerified: { ...stamp }, valid: true,
          ...(preferences.revision === 0 && preferences.commitProof === null ? { initialFoldRecordDigest: foldRecordDigest } : {}),
          references: buildReferenceIndex(partitionState(external.initialState).document),
          folds: createFoldOverlayIndex(preferences, fresh.projectExtensions.get(recordKey([...prefix(project.scope), 'folds']))!) });
        return stamp;
      });
    },
    commitDocument: batch => queueBatch(batch, 'document') as Promise<DocumentSaveAck>,
    commitPreferences: batch => queueBatch(batch, 'preferences') as Promise<PreferenceSaveAck>,
    readAdmittedProjectAuthority: scope => {
      Object.values(exactFields(scope, ['storageGeneration', 'projectId', 'incarnation'])).forEach(value => requireContract(typeof value === 'string' && value.length > 0, 'Invalid scope'));
      const owner = owners.get(ownerKey(scope)); if (!owner?.valid) throw new RepositoryConflict('ingress-required');
      return { ...owner.lastVerified };
    },
    readDocumentReadmissionAuthority: async receipt => {
      exactFields(receipt, ['scope', 'identity', 'ack']);
      Object.values(exactFields(receipt.scope, ['storageGeneration', 'projectId', 'incarnation'])).forEach(value => requireContract(typeof value === 'string' && value.length > 0, 'Invalid scope'));
      validateIdentity(receipt.identity); requireContract(receipt.identity.lane === 'document', 'Invalid receipt lane');
      exactFields(receipt.ack, ['type', 'projectId', 'incarnation', 'commitId', 'editorGeneration', 'foldStructureGeneration', 'revision']);
      const scope = { ...receipt.scope }, identity = { ...receipt.identity }, acknowledgement = { ...receipt.ack };
      safeCounter(acknowledgement.revision); safeCounter(acknowledgement.foldStructureGeneration);
      requireContract(acknowledgement.type === 'document-saved' && acknowledgement.revision > 0
        && acknowledgement.projectId === scope.projectId && acknowledgement.incarnation === scope.incarnation
        && acknowledgement.commitId === identity.commitId && acknowledgement.editorGeneration === identity.editorGeneration, 'Invalid receipt acknowledgement');
      return serial(scope, async () => {
        const result = await inspect(scope, identity.commitId, { identity, acknowledgement, lower: acknowledgement.revision - 1 });
        if (result.type !== 'committed') throw new RepositoryConflict(result.type === 'conflict' ? result.reason : 'proof-unavailable');
        return result.authority;
      });
    },
    commitReplacement,
    inspectReplacement,
    inspectCommit: async (scope, commitId) => {
      Object.values(exactFields(scope, ['storageGeneration', 'projectId', 'incarnation'])).forEach(v => requireContract(typeof v === 'string' && v.length > 0, 'Invalid scope'));
      const captured = { ...scope }; return serial(captured, async () => publicInspection(await inspect(captured, commitId)));
    },
    inspectCommitAttempt: async attempt => {
      exactFields(attempt, ['lane', 'batch']);
      requireContract(attempt.lane === 'document' || attempt.lane === 'preferences', 'Invalid commit lane');
      const identity = validateBatch(attempt.batch, attempt.lane);
      const frame = frameBatch(attempt.batch); const scope = { ...attempt.batch.scope };
      const lower = attempt.lane === 'document' ? attempt.batch.expectedRevision : attempt.batch.observedPreferenceRevision;
      return serial(scope, async () => publicInspection(await inspect(scope, identity.commitId, { identity, lower, requestDigest: await hash(frame) })));
    },
    exportProjectForRecovery: async scope => {
      Object.values(exactFields(scope, ['storageGeneration', 'projectId', 'incarnation'])).forEach(v => requireContract(typeof v === 'string' && v.length > 0, 'Invalid scope'));
      const captured = { ...scope };
      return serial(captured, async () => {
        const result = await read(captured, [], 'ingress-read', true);
        const { external, stamp } = result.admission ?? await verifyBulk(result.records);
        return { scope: captured, authority: stamp, project: external };
      });
    },
  };
}
