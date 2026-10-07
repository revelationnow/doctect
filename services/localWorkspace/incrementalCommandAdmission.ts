import { WorkspaceStoreError, type IncrementalWorkspaceCommand, type PreferenceWorkspaceCommand, type ProjectMetadataCommand, type ReplacementWorkspaceCommand, type WorkspaceProject } from './contracts';
import type { ProjectMetadataEdit } from './normalized/schema';
import { associateQueueSubmission, clearCommandQueueReceipt, createIncrementalQueue, type InstalledQueueAuthority, type IncrementalQueueOptions, type QueueFailure } from './incrementalQueue';
import { getInstalledProjectAuthorityLineage, getInstalledProjectAuthorityToken } from './projectAuthority';
import { prepareProjectWriteRecovery, type RetainedProjectWrites, type VerifiedProjectWriteRecovery, type ProjectWriteRoute } from './projectWriteRecovery';
import type { RetainedQueueWork } from './incrementalQueue';
import type { ProjectInstallationRegistry } from './projectInstallationRegistry';
import { canCoalescePreservedLayerTransfers } from '../document/layerFolds';

export interface IncrementalCommandAdmissionOptions extends Omit<IncrementalQueueOptions, 'resolveAuthority' | 'onEvent'> {
  resolveAuthority(projectId: string): InstalledQueueAuthority | undefined;
  /** Private lifecycle owner receives verified coverage before passive observers. */
  observeProject?: IncrementalQueueOptions['onEvent'];
  onEvent?: IncrementalQueueOptions['onEvent'];
}

function field(object: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new WorkspaceStoreError('Invalid command metadata.', 'validation');
  return descriptor.value;
}
function frame(value: object, required: readonly string[], optional: readonly string[] = []): void {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw new WorkspaceStoreError('Invalid command.', 'validation');
  for (const key of required) field(value, key);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !required.includes(key) && !optional.includes(key)) throw new WorkspaceStoreError('Unknown command field.', 'validation');
    field(value, key);
  }
}
function publicFailure(error: unknown): WorkspaceStoreError {
  if (error instanceof WorkspaceStoreError) return error;
  const failure = error as QueueFailure | undefined;
  let code: WorkspaceStoreError['code'] = 'authority-lost';
  if (failure?.type === 'domain') {
    switch (failure.response.code) {
      case 'quota-exceeded': code = 'quota'; break;
      case 'clone-failed': code = 'clone'; break;
      case 'storage-unavailable': code = 'unavailable'; break;
      case 'invalid-request': code = 'validation'; break;
      case 'repository-failure': code = 'io'; break;
      default: code = 'conflict';
    }
  } else if (failure?.type === 'queue' && ['invalid-input', 'counter-exhausted'].includes(failure.code)) code = 'validation';
  else if (failure?.type === 'queue' && failure.code === 'stale-generation') code = 'conflict';
  return new WorkspaceStoreError('Incremental save was not acknowledged.', code, error);
}

/** Private store-owned command lane. The store supplies already bootstrapped
 * installations; this factory cannot register project capabilities or bootstrap
 * an editing authority. No payload traversals and no new public store methods.
 */
export function createIncrementalCommandAdmission(options: IncrementalCommandAdmissionOptions) {
  // Runtime callbacks must not retain options.recovery and its startup payloads.
  // The queue owns that input only until recovery initialization completes.
  const { resolveAuthority, observeProject, onEvent } = options;
  const stamp = (installation: InstalledQueueAuthority) => [installation.source, installation.transport,
    installation.editorGenerationFloor, installation.binding.admissionId,
    installation.binding.scope.storageGeneration, installation.binding.scope.projectId, installation.binding.scope.incarnation,
    installation.binding.authority.documentRevision, installation.binding.authority.preferenceRevision,
    installation.binding.authority.foldStructureGeneration] as const;
  const revisions = new WeakMap<InstalledQueueAuthority, { document: number }>();
  const revision = (installation: InstalledQueueAuthority) => {
    let value = revisions.get(installation);
    if (!value) { value = { document: installation.binding.authority.documentRevision }; revisions.set(installation, value); }
    return value;
  };
  const queue = createIncrementalQueue({ ...options, resolveAuthority, canCoalesceLayerTransfers: canCoalescePreservedLayerTransfers,
    onEvent(event) {
      // Queue has independently verified the receipt. Update before passive
      // observers can reenter admission, and only once per committed batch.
      if (event.type === 'acknowledged' && event.ack.type === 'document-saved') revision(event.authority).document = event.ack.revision;
      if (event.type === 'acknowledged' && event.ack.type === 'document-replaced') revision(event.authority).document = event.ack.authority.documentRevision;
      observeProject?.(event);
      onEvent?.(event);
    },
  });
  function capture(project: WorkspaceProject, generation: number) {
    const token = getInstalledProjectAuthorityToken(project);
    const lineage = getInstalledProjectAuthorityLineage(project);
    if (!token || !lineage) throw new WorkspaceStoreError('Project save capability is not installed.', 'conflict');
    const id = field(project, 'id');
    if (typeof id !== 'string' || !id.length || !Number.isSafeInteger(generation) || generation < 0) throw new WorkspaceStoreError('Invalid save identity.', 'validation');
    const installation = resolveAuthority(id);
    if (!installation) throw new WorkspaceStoreError('Project editing authority is unavailable.', 'authority-lost');
    if (installation.source !== token || installation.binding.scope.projectId !== id
      || installation.binding.scope.incarnation !== lineage.incarnation || revision(installation).document !== lineage.revision) {
      throw new WorkspaceStoreError('Project save capability is stale or foreign.', 'conflict');
    }
    return { id, project, installation, token, incarnation: lineage.incarnation, stamp: stamp(installation) };
  }
  function current(captured: ReturnType<typeof capture>) {
    const id = Object.getOwnPropertyDescriptor(captured.project, 'id');
    if (!id?.enumerable || !Object.hasOwn(id, 'value') || id.value !== captured.id
      || resolveAuthority(captured.id) !== captured.installation
      || stamp(captured.installation).some((value, index) => value !== captured.stamp[index])
      || getInstalledProjectAuthorityToken(captured.project) !== captured.token
      || getInstalledProjectAuthorityLineage(captured.project)?.incarnation !== captured.incarnation) {
      throw new WorkspaceStoreError('Project editing authority changed during save.', 'authority-lost');
    }
  }
  const admission = {
    queue,
    workspaceBarrier: queue.workspaceBarrier,
    async replacement(command: ReplacementWorkspaceCommand) {
      clearCommandQueueReceipt(command);
      try {
        frame(command, ['type', 'authority', 'editorGeneration', 'state', 'preferences'], ['linkedProjectName']);
        if (command.type !== 'replace-document') throw new WorkspaceStoreError('Invalid replacement command.', 'validation');
        const captured = capture(command.authority, command.editorGeneration);
        let metadata: Extract<ProjectMetadataEdit, { kind: 'linked-root' }> | undefined;
        if (Object.hasOwn(command, 'linkedProjectName')) {
          frame(command.linkedProjectName!, ['name']);
          const name = field(command.linkedProjectName!, 'name');
          if (typeof name !== 'string') throw new WorkspaceStoreError('Invalid linked project name.', 'validation');
          metadata = { kind: 'linked-root', name };
        }
        const pending = queue.enqueueReplacement(captured.id, command.editorGeneration, {
          source: captured.token, state: command.state, preferences: command.preferences, ...(metadata ? { metadata } : {}),
        });
        associateQueueSubmission(command, pending, captured.token, 'document', command.editorGeneration);
        const ack = await pending; current(captured); return ack;
      } catch (error) { throw publicFailure(error); }
    },
    async document(command: IncrementalWorkspaceCommand) {
      clearCommandQueueReceipt(command);
      try {
        frame(command, ['type', 'authority', 'editorGeneration', 'changes'], ['structural', 'linkedProjectName']);
        if (command.type !== 'save-document-changes') throw new WorkspaceStoreError('Invalid document command.', 'validation');
        let metadata: ProjectMetadataEdit | undefined;
        if (Object.hasOwn(command, 'linkedProjectName')) {
          frame(command.linkedProjectName!, ['name']);
          const name = field(command.linkedProjectName!, 'name');
          if (typeof name !== 'string') throw new WorkspaceStoreError('Invalid linked project name.', 'validation');
          metadata = { kind: 'linked-root', name };
        }
        const { authority, editorGeneration, changes, structural } = command;
        const hasStructural = Object.hasOwn(command, 'structural');
        const captured = capture(authority, editorGeneration);
        const pending = queue.enqueueDocument(captured.id, editorGeneration, {
          source: captured.token, changes, ...(hasStructural ? { structural } : {}), ...(metadata ? { metadata } : {}),
        });
        associateQueueSubmission(command, pending, captured.token, 'document', editorGeneration);
        const ack = await pending;
        current(captured); return ack;
      } catch (error) { throw publicFailure(error); }
    },
    async preferences(command: PreferenceWorkspaceCommand) {
      clearCommandQueueReceipt(command);
      try {
        frame(command, ['type', 'authority', 'editorGeneration', 'patch'], ['folds']);
        if (command.type !== 'save-editor-preferences') throw new WorkspaceStoreError('Invalid preference command.', 'validation');
        const { authority, editorGeneration, patch, folds } = command;
        const hasFolds = Object.hasOwn(command, 'folds');
        const captured = capture(authority, editorGeneration);
        const pending = queue.enqueuePreferences(captured.id, editorGeneration, {
          source: captured.token, patch, ...(hasFolds ? { folds } : {}),
        });
        associateQueueSubmission(command, pending, captured.token, 'preferences', editorGeneration);
        const ack = await pending;
        current(captured); return ack;
      } catch (error) { throw publicFailure(error); }
    },
    async metadata(command: ProjectMetadataCommand) {
      clearCommandQueueReceipt(command);
      try {
        frame(command, ['type', 'authority', 'editorGeneration', 'patch']);
        if (command.type !== 'update-project-metadata') throw new WorkspaceStoreError('Invalid metadata command.', 'validation');
        frame(command.patch, [], ['name', 'cloud']);
        const hasName = Object.hasOwn(command.patch, 'name'); const hasCloud = Object.hasOwn(command.patch, 'cloud');
        const name = hasName ? field(command.patch, 'name') : undefined;
        if (!hasName && !hasCloud || hasName && typeof name !== 'string') throw new WorkspaceStoreError('Invalid metadata patch.', 'validation');
        const cloud = hasCloud ? field(command.patch, 'cloud') : undefined;
        const metadata: ProjectMetadataEdit = { kind: 'patch', ...(hasName ? { name: name as string } : {}),
          ...(hasCloud ? { cloud: cloud === undefined ? { type: 'remove' as const }
            : { type: 'set' as const, value: cloud as NonNullable<WorkspaceProject['cloud']> } } : {}) };
        const { authority, editorGeneration } = command;
        const captured = capture(authority, editorGeneration);
        const pending = queue.enqueueDocument(captured.id, editorGeneration, { source: captured.token, changes: [], metadata });
        associateQueueSubmission(command, pending, captured.token, 'document', editorGeneration);
        const ack = await pending;
        current(captured); return ack;
      } catch (error) { throw publicFailure(error); }
    },
    flush: queue.flush,
    dispose: queue.dispose,
    prepareWriteRecovery(retained: RetainedProjectWrites, checkpoint: RetainedQueueWork, installations: ProjectInstallationRegistry,
      resolveAuthority: () => WorkspaceProject | undefined, recoveredCommit?: ProjectWriteRoute['commit']): Promise<VerifiedProjectWriteRecovery> {
      return prepareProjectWriteRecovery({ retained, checkpoint, queue, installations, route: { resolveAuthority, flushPending: () => queue.flush(),
        commit(command) {
          if (recoveredCommit) return recoveredCommit(command);
          switch (command.type) {
            case 'save-document-changes': return admission.document(command);
            case 'save-editor-preferences': return admission.preferences(command);
            case 'update-project-metadata': return admission.metadata(command);
            case 'replace-document': return admission.replacement(command);
          }
        } } });
    },
  };
  return admission;
}
