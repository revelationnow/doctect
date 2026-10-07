import { WorkspaceStoreError, type IncrementalWorkspaceCommand, type PreferenceWorkspaceCommand,
  type ProjectMetadataCommand, type SnapshotWorkspaceCommand, type SnapshotWorkspaceCommit,
  type WorkspaceCommand, type WorkspaceCommandResult, type WorkspaceCommit, type WorkspaceSnapshot,
  type WorkspaceLifecycleCommand, type WorkspaceLifecycleCommit, type ReplacementWorkspaceCommand } from './contracts';
import type { BulkDocumentAck, DocumentSaveAck, PreferenceSaveAck } from './normalized/schema';
import type { WorkspaceCommandResult as NormalizedWorkspaceCommandResult } from './normalized/workspaceCommands';

export interface WorkspaceCommandHandlers {
  snapshot: SnapshotWorkspaceCommit;
  document?(command: IncrementalWorkspaceCommand): Promise<DocumentSaveAck>;
  preferences?(command: PreferenceWorkspaceCommand): Promise<PreferenceSaveAck>;
  metadata?(command: ProjectMetadataCommand): Promise<DocumentSaveAck>;
  replacement?(command: ReplacementWorkspaceCommand): Promise<BulkDocumentAck>;
  workspace?: WorkspaceLifecycleCommit;
}

/** Routing is not admission. An absent incremental owner must never fall through
 * to the historical snapshot writer or fabricate a successful acknowledgement.
 */
export function createWorkspaceCommandDispatcher(handlers: WorkspaceCommandHandlers): WorkspaceCommit {
  const unavailable = () => Promise.reject(new WorkspaceStoreError('Incremental editing authority is not installed.', 'authority-lost'));
  function commit(command: WorkspaceLifecycleCommand): Promise<NormalizedWorkspaceCommandResult>;
  function commit(command: IncrementalWorkspaceCommand): Promise<DocumentSaveAck>;
  function commit(command: PreferenceWorkspaceCommand): Promise<PreferenceSaveAck>;
  function commit(command: ReplacementWorkspaceCommand): Promise<BulkDocumentAck>;
  function commit(command: ProjectMetadataCommand): Promise<DocumentSaveAck>;
  function commit(command: SnapshotWorkspaceCommand): Promise<WorkspaceSnapshot>;
  function commit(command: WorkspaceCommand): Promise<WorkspaceCommandResult>;
  function commit(command: WorkspaceCommand): Promise<WorkspaceCommandResult> {
    const type = command && typeof command === 'object' ? Object.getOwnPropertyDescriptor(command, 'type') : undefined;
    if (!type?.enumerable || !Object.hasOwn(type, 'value') || typeof type.value !== 'string') {
      return Promise.reject(new WorkspaceStoreError('Invalid command discriminator.', 'validation'));
    }
    switch (command.type) {
      case 'workspace-lifecycle': return handlers.workspace ? handlers.workspace(command) : unavailable();
      case 'save-document-changes': return handlers.document ? handlers.document(command) : unavailable();
      case 'save-editor-preferences': return handlers.preferences ? handlers.preferences(command) : unavailable();
      case 'replace-document': return handlers.replacement ? handlers.replacement(command) : unavailable();
      case 'update-project-metadata': return handlers.metadata ? handlers.metadata(command) : unavailable();
      case 'save-project': case 'create-and-activate-project': case 'activate-project': case 'close-project':
      case 'save-custom-preset': case 'delete-custom-preset': case 'stage-import': case 'replace-staged-import':
      case 'consume-import': case 'recover-legacy-as-copies': return handlers.snapshot(command);
      default: {
        const unsupported: never = command; void unsupported;
        return Promise.reject(new WorkspaceStoreError('Unknown workspace command.', 'validation'));
      }
    }
  }
  return commit;
}
