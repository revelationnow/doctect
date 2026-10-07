import type { AppState } from '../../types';
import type { DocumentChange, EditorPreferences, EditorScalarPreferencePatch } from '../document/contracts';
import type { QueueStructuralInput, QueueFoldInput } from './incrementalQueue';
import type { BulkDocumentAck, DocumentSaveAck, PreferenceSaveAck } from './normalized/schema';
import type { WorkspaceLifecycleIntent, WorkspaceCommandResult as NormalizedWorkspaceCommandResult } from './normalized/workspaceCommands';

export interface WorkspaceProject {
  id: string;
  name: string;
  initialState: AppState;
  cloud?: { projectId: string; lastSyncedCommitId: string };
  revision?: number;
  [unknownField: string]: unknown;
}

export interface WorkspaceCustomPreset {
  id: string;
  title: string;
  desc: string;
  color?: string;
  isCustom: true;
  initialState: AppState;
  [unknownField: string]: unknown;
}

export interface WorkspaceImportInput {
  id: string;
  targetProjectId: string;
  name: string;
  state: unknown;
  cloud?: { projectId: string; lastSyncedCommitId: string };
  createdAt: string;
}

export interface WorkspacePendingImport extends Omit<WorkspaceImportInput, 'state'> {
  state: AppState;
  warnings: string[];
}

export interface WorkspaceImportAttemptProvenance {
  sourceKeyDigest: string;
  payloadDigest: string;
}

export interface WorkspaceStagedImportExpectation extends WorkspaceImportAttemptProvenance {
  importId: string;
  targetProjectId: string;
  createdAt: string;
}

export interface WorkspaceSnapshot {
  projects: WorkspaceProject[];
  activeProjectId: string;
  customPresets: WorkspaceCustomPreset[];
  pendingImports: WorkspacePendingImport[];
}

export type SnapshotWorkspaceCommand =
  | { type: 'save-project'; project: WorkspaceProject }
  | { type: 'create-and-activate-project'; project: WorkspaceProject }
  | { type: 'activate-project'; projectId: string }
  | { type: 'close-project'; projectId: string; successor?: WorkspaceProject }
  | { type: 'save-custom-preset'; preset: WorkspaceCustomPreset }
  | { type: 'delete-custom-preset'; presetId: string }
  | {
      type: 'stage-import';
      pendingImport: WorkspaceImportInput;
      attemptProvenance?: WorkspaceImportAttemptProvenance;
    }
  | {
      type: 'replace-staged-import';
      expected: WorkspaceStagedImportExpectation;
      replacement: {
        pendingImport: WorkspaceImportInput;
        attemptProvenance: WorkspaceImportAttemptProvenance;
      };
    }
  | { type: 'consume-import'; importId: string }
  | { type: 'recover-legacy-as-copies'; recoveryId: string };

export interface IncrementalWorkspaceCommand {
  type: 'save-document-changes';
  authority: WorkspaceProject;
  editorGeneration: number;
  changes: readonly DocumentChange[];
  structural?: QueueStructuralInput;
  linkedProjectName?: { readonly name: string };
}
export interface PreferenceWorkspaceCommand {
  type: 'save-editor-preferences';
  authority: WorkspaceProject;
  editorGeneration: number;
  patch: EditorScalarPreferencePatch;
  folds?: QueueFoldInput;
}
export interface ReplacementWorkspaceCommand {
  type: 'replace-document';
  authority: WorkspaceProject;
  editorGeneration: number;
  state: AppState;
  preferences: EditorPreferences;
  linkedProjectName?: { readonly name: string };
}
export interface ProjectMetadataCommand {
  type: 'update-project-metadata';
  authority: WorkspaceProject;
  editorGeneration: number;
  patch: Partial<Pick<WorkspaceProject, 'name' | 'cloud'>>;
}
export interface WorkspaceLifecycleCommand {
  readonly type: 'workspace-lifecycle';
  readonly intent: WorkspaceLifecycleIntent;
}
export type WorkspaceLifecycleCommit = (command: WorkspaceLifecycleCommand) => Promise<NormalizedWorkspaceCommandResult>;
export type WorkspaceCommand = SnapshotWorkspaceCommand | IncrementalWorkspaceCommand | PreferenceWorkspaceCommand | ReplacementWorkspaceCommand | ProjectMetadataCommand | WorkspaceLifecycleCommand;
export type WorkspaceCommandResult = WorkspaceSnapshot | DocumentSaveAck | PreferenceSaveAck | BulkDocumentAck | NormalizedWorkspaceCommandResult;
export type SnapshotWorkspaceCommit = (command: SnapshotWorkspaceCommand) => Promise<WorkspaceSnapshot>;
export interface WorkspaceCommit {
  (command: WorkspaceLifecycleCommand): Promise<NormalizedWorkspaceCommandResult>;
  (command: IncrementalWorkspaceCommand): Promise<DocumentSaveAck>;
  (command: PreferenceWorkspaceCommand): Promise<PreferenceSaveAck>;
  (command: ReplacementWorkspaceCommand): Promise<BulkDocumentAck>;
  (command: ProjectMetadataCommand): Promise<DocumentSaveAck>;
  (command: SnapshotWorkspaceCommand): Promise<WorkspaceSnapshot>;
  (command: WorkspaceCommand): Promise<WorkspaceCommandResult>;
}

export type WorkspaceBootstrapPhase =
  | 'opening-local-storage'
  | 'checking-existing-projects'
  | 'copying-projects'
  | 'verifying-projects'
  | 'finishing-upgrade';

export interface MigrationReceipt {
  id: string;
  projectCount: number;
  customPresetCount: number;
  pendingImportPreserved: boolean;
  migratedAt: string;
}

export type RecoverySource =
  | 'legacy-current'
  | 'legacy-original'
  | 'indexeddb-workspace'
  | 'normalized-active'
  | 'normalization-source';

export const INDEXED_DB_UPGRADE_BLOCKED_MESSAGE = 'IndexedDB upgrade is blocked.';

export interface WorkspaceRecovery {
  recoveryId: string;
  kind:
    | 'migration-failed'
    | 'legacy-changing'
    | 'split-brain'
    | 'unrecognized-target'
    | 'verification-failed'
    | 'unsupported-cleanup-state';
  category: string;
  message: string;
  affectedKey?: string;
  affectedItem?: string;
  availableExports: RecoverySource[];
  canRetry: boolean;
  canRecoverLegacyAsCopies: boolean;
}

export type WorkspaceBootstrapResult =
  | { status: 'ready'; snapshot: WorkspaceSnapshot; receipt?: MigrationReceipt }
  | { status: 'recovery'; recovery: WorkspaceRecovery }
  | {
      status: 'unavailable';
      message: string;
      availableExports: RecoverySource[];
    };

export interface WorkspaceBootstrapObserver {
  signal?: AbortSignal;
  onPhase?: (phase: WorkspaceBootstrapPhase) => void;
  onAuthorityLost?: (
    result: Extract<WorkspaceBootstrapResult, { status: 'recovery' | 'unavailable' }>,
  ) => void;
}

export class WorkspaceStoreError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'unavailable'
      | 'quota'
      | 'clone'
      | 'io'
      | 'validation'
      | 'conflict'
      | 'authority-lost',
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'WorkspaceStoreError';
  }
}

export interface LocalWorkspaceStore {
  bootstrap(observer?: WorkspaceBootstrapObserver): Promise<WorkspaceBootstrapResult>;
  /** Returned snapshots are authority-bearing, shared publications and must be treated as immutable. */
  commit: WorkspaceCommit;
  exportRecoveryBundle(source: RecoverySource): Promise<Blob>;
}
