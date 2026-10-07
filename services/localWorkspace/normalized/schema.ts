import type { AppNode, AppState, GeneratorProvenance, PageTemplate, Variant } from '../../../types';
import type { DocumentChange, DocumentState, EditorPreferences, RecordAddress } from '../../document/contracts';
import type { LayerMapping, LayerOccurrence } from '../../document/layerFolds';
import type { WorkspaceProject, WorkspaceSnapshot } from '../contracts';
import type { WorkspaceRecords } from '../migration';
import type { LegacyBackupRecord, LocalWorkspaceDatabase, MigrationLedger } from '../schema';
import type { ProjectBaselineDigests, WorkspaceBirthOrigin } from './workspaceManifest';

// Declarative only. Importing this module must never open or upgrade a database.
export const NORMALIZED_DB_VERSION = 3;
export const NORMALIZATION_LEDGER_ID = 'incremental-local-persistence-v3';
export const NORMALIZED_STORE_NAMES = [
  'projectHeaders', 'projectNodes', 'projectVariants', 'projectTemplates',
  'projectSources', 'projectExtensions', 'projectPreferences', 'normalizationLedger',
] as const;

/** Private storage identity, not public admission or editor/fold generation. */
export interface ProjectScope {
  storageGeneration: string;
  projectId: string;
  incarnation: string;
}
export interface DocumentCounters {
  documentBytes: number;
  projectBaseBytes: number;
  nodeCount: number;
  variantCount: number;
  elementCount: number;
}
export interface AuthorityStamp {
  documentRevision: number;
  preferenceRevision: number;
  foldStructureGeneration: number;
}
export interface CommitIdentity {
  clientId: string;
  commitGeneration: number;
  commitId: string;
  editorGeneration: number;
  lane: 'document' | 'preferences';
}
export type PhysicalAddress = { [S in ProjectStoreName]: { store: S; key: NormalizedRecordTypes[S]['key'] } }[ProjectStoreName];
export interface SelectedPostcondition {
  address: PhysicalAddress;
  after: { type: 'absent' } | { type: 'present'; digest: string };
}
export interface CommitProof {
  identity: CommitIdentity;
  requestDigest: string;
  before: AuthorityStamp;
  after: AuthorityStamp;
  manifestDigest: string;
  headerCoreDigest: string;
  preferenceCoreDigest: string;
}
export interface BulkCommitProof extends CommitProof { kind: 'bulk-document' }
export interface BulkProjectBaseline { proof: BulkCommitProof; digests: ProjectBaselineDigests }
export interface CommitDelta {
  revision: number;
  proof: CommitProof;
  selected: readonly SelectedPostcondition[];
  referenceAddresses: readonly RecordAddress[];
  foldTemplates: readonly Pick<LayerOccurrence, 'variantId' | 'templateId'>[];
}
export interface CommitWindow { floorRevision: number; entries: readonly CommitDelta[] }
/** Private JSON-safe metadata intent. Removal is explicit, never omitted by JSON. */
export type ProjectMetadataEdit =
  | { readonly kind: 'linked-root'; readonly name: string }
  | { readonly kind: 'patch'; readonly name?: string;
       readonly cloud?: { readonly type: 'set'; readonly value: NonNullable<WorkspaceProject['cloud']> } | { readonly type: 'remove' } };
export interface BulkDocumentBatch {
  scope: ProjectScope;
  clientId: string;
  commitGeneration: number;
  commitId: string;
  editorGeneration: number;
  expected: AuthorityStamp;
  state: AppState;
  preferences: EditorPreferences;
  metadata?: Extract<ProjectMetadataEdit, { kind: 'linked-root' }>;
}
export interface BulkDocumentAck {
  type: 'document-replaced';
  projectId: string;
  incarnation: string;
  commitId: string;
  editorGeneration: number;
  authority: AuthorityStamp;
  boundaryDigest: string;
}
export interface DocumentBatch {
  scope: ProjectScope;
  commitId: string;
  editorGeneration: number;
  expectedRevision: number;
  changes: readonly DocumentChange[];
  clientId: string;
  commitGeneration: number;
  structural?: { expectedFoldStructureGeneration: number; mappings: readonly LayerMapping[] };
  metadata?: ProjectMetadataEdit;
}
export interface PreferenceBatch {
  scope: ProjectScope;
  commitId: string;
  editorGeneration: number;
  patch: Partial<EditorPreferences>;
  clientId: string;
  commitGeneration: number;
  observedPreferenceRevision: number;
  folds?: { expectedFoldStructureGeneration: number; updates: readonly { occurrence: LayerOccurrence; collapsed: boolean }[] };
}
interface SaveIdentity { projectId: string; incarnation: string; commitId: string; editorGeneration: number; foldStructureGeneration: number }
export interface DocumentSaveAck extends SaveIdentity { type: 'document-saved'; revision: number }
/** Bounded evidence from a verified document submission; never owns its payload. */
export interface DocumentCommitReceipt {
  readonly scope: ProjectScope;
  readonly identity: CommitIdentity & { lane: 'document' };
  readonly ack: DocumentSaveAck;
}
export interface PreferenceSaveAck extends SaveIdentity { type: 'preferences-saved'; preferenceRevision: number }
export type CommitAttempt = { lane: 'document'; batch: DocumentBatch } | { lane: 'preferences'; batch: PreferenceBatch };
export interface NormalizedProjectRecovery { scope: ProjectScope; authority: AuthorityStamp; project: WorkspaceProject }
export type CommitInspection = { type: 'committed'; ack: DocumentSaveAck | PreferenceSaveAck } | { type: 'not-committed' }
  | { type: 'conflict'; reason: 'authority-changed' | 'identity-mismatch' | 'proof-unavailable' | 'verification-failed' | 'incarnation-changed' };
export type BulkCommitInspection = { type: 'committed'; ack: BulkDocumentAck } | Exclude<CommitInspection, { type: 'committed' }>;
export type HeaderKey = [storageGeneration: string, projectId: string];
export type ProjectKey = [...HeaderKey, incarnation: string];
export type NodeKey = [...ProjectKey, nodeId: string];
export type VariantKey = [...ProjectKey, variantId: string];
export type TemplateKey = [...VariantKey, templateId: string];
export type ExtensionKey = [...ProjectKey, owner: 'wrapper' | 'state' | 'cloud' | 'folds']
  | [...ProjectKey, owner: 'variant', variantId: string];

/** JSON value bytes, not the storage envelope. Container/key/comma arithmetic is Task 6. */
export interface EncodedSize { valueBytes: number }
export interface NormalizedRecord<K extends string[], V> {
  key: K;
  formatVersion: typeof NORMALIZED_DB_VERSION;
  value: V;
  encodedSize: EncodedSize;
}
export interface ProjectHeader extends NormalizedRecord<HeaderKey, Pick<WorkspaceProject, 'id' | 'name' | 'cloud' | 'revision'>> {
  incarnation: string;
  document: Pick<DocumentState, 'rootId' | 'schemaVersion'>;
  // State order is exact for non-preferences, but only an initial interleaving hint for
  // known preferences: omit absent fields and append new ones in current preference value order.
  order: { wrapper: string[]; state: string[]; nodes: string[]; variants: string[] };
  // Initialized for a new normalized image. Migration/transactions install durable lineage.
  storageRevision: number;
  lastCommitId: string | null;
  updatedAt: string | null;
  foldStructureGeneration: number;
  counters: DocumentCounters;
  commitProof: CommitProof | null;
  commitWindow: CommitWindow;
  migrationBaseline?: MigrationBaseline;
  workspaceBirth?: WorkspaceBirthOrigin;
  bulkBaseline?: BulkProjectBaseline;
  encodedSize: EncodedSize & { documentBytes: number };
}
export interface MigrationBaseline {
  migrationId: typeof NORMALIZATION_LEDGER_ID;
  attemptId: string;
  storageGeneration: string;
  sourceDigest: string;
  projectDigest: string;
  projectId: string;
  incarnation: string;
  sourceRevision: number;
  sourceUpdatedAt: string;
}
export type ProjectNode = NormalizedRecord<NodeKey, AppNode>;
export interface ProjectVariant extends NormalizedRecord<VariantKey, Pick<Variant, 'id' | 'name'>> {
  fieldOrder: string[];
  // Membership/reordering only; no template payloads or template-size aggregates.
  templateOrder: string[];
}
export type ProjectTemplate = NormalizedRecord<TemplateKey, PageTemplate>;
export type ProjectSource = NormalizedRecord<ProjectKey, GeneratorProvenance>;
export type ProjectExtension = NormalizedRecord<ExtensionKey, Record<string, unknown>>;
export interface ProjectPreferences extends NormalizedRecord<ProjectKey, EditorPreferences> {
  // Independent lineage: preference-only writes never rewrite the document header.
  revision: number;
  lastCommitId: string | null;
  preferenceBytes: number;
  // Current folds-record SHA-256, authenticated by the preference core proof.
  // Absent only at initial revision zero; outlives both replay windows.
  foldRecordDigest?: string;
  bulkBoundary?: string;
  commitProof: CommitProof | null;
  commitWindow: CommitWindow;
  // Nonzero external-template deltas, keyed by JSON.stringify([variantId, templateId]).
  // Both boolean and positional compatibility folds count here, never on document records.
  encodedSize: EncodedSize & { templateOverlayBytes: Record<string, number> };
}

/** Migration-wide authority, never manufactured by the per-project bulk codec. */
export interface NormalizationLedger {
  id: typeof NORMALIZATION_LEDGER_ID;
  formatVersion: typeof NORMALIZED_DB_VERSION;
  attemptId: string;
  storageGeneration: string;
  state: 'staging' | 'verified' | 'active';
  sourceKind: 'historical' | 'fresh';
  sourceProjects: NormalizationSourceProject[];
  sourceDigest: string;
  sourceWorkspaceRevision: number;
  sourceLedgerRevision: number | null;
  sourceArchiveId: string;
  sourceArchiveDigest: string;
  contentDigest: string;
  targetManifestDigest: string;
  workspaceManifestVersion: 1;
  initialWorkspaceDigest: string;
  recordCount: number;
  nextRecord: number;
  progressRevision: number;
  verificationDigest: string | null;
  verifiedProgressRevision: number | null;
  cutoverRevision: number | null;
}
export interface NormalizationSourceProject { projectId: string; incarnation: string; revision: number; digest: string }
/** Capture only; neither caller-supplied records nor this digest grants editing authority. */
export interface NormalizationSource {
  kind: 'historical' | 'fresh';
  /** Fresh-only recovery evidence, set by an independent validated archive read. */
  retainedSeed?: true;
  records: WorkspaceRecords;
  snapshot: WorkspaceSnapshot;
  ledger: MigrationLedger | null;
  backups: LegacyBackupRecord[];
  sourceProjects: NormalizationSourceProject[];
  sourceDigest: string;
  contentDigest: string;
}
/** Full expected marker, used for exact compare-and-swap, not project admission. */
export type NormalizationAttempt = NormalizationLedger;
export type ActiveAuthority = NormalizationLedger & {
  state: 'active'; verificationDigest: string; verifiedProgressRevision: number; cutoverRevision: number;
};
export interface NormalizedRecordTypes {
  projectHeaders: ProjectHeader;
  projectNodes: ProjectNode;
  projectVariants: ProjectVariant;
  projectTemplates: ProjectTemplate;
  projectSources: ProjectSource;
  projectExtensions: ProjectExtension;
  projectPreferences: ProjectPreferences;
  normalizationLedger: NormalizationLedger;
}
export type TaggedNormalizedRecord = {
  [S in keyof NormalizedRecordTypes]: { store: S; record: NormalizedRecordTypes[S] }
}[keyof NormalizedRecordTypes];
export type ProjectStoreName = Exclude<keyof NormalizedRecordTypes, 'normalizationLedger'>;
/** Map keys encode physical tuples with JSON.stringify, never delimiter concatenation. */
export type NormalizedProject = { scope: ProjectScope } & {
  [S in keyof NormalizedRecordTypes]: Map<string, NormalizedRecordTypes[S]>;
};

/** Additive physical model: all six existing stores remain available for recovery. */
export interface NormalizedWorkspaceDatabase extends LocalWorkspaceDatabase {
  projectHeaders: { key: HeaderKey; value: ProjectHeader };
  projectNodes: { key: NodeKey; value: ProjectNode };
  projectVariants: { key: VariantKey; value: ProjectVariant };
  projectTemplates: { key: TemplateKey; value: ProjectTemplate };
  projectSources: { key: ProjectKey; value: ProjectSource };
  projectExtensions: { key: ExtensionKey; value: ProjectExtension };
  projectPreferences: { key: ProjectKey; value: ProjectPreferences };
  normalizationLedger: { key: typeof NORMALIZATION_LEDGER_ID; value: NormalizationLedger };
}
