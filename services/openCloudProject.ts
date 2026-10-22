import { cloudApi } from './cloudApi';
import { stageImport } from './importProject';
import { localWorkspaceStore, WorkspaceStoreError } from './localWorkspace/index';

/**
 * My projects' Open: readies the editor to show one of the owner's cloud projects in a tab linked
 * to it (`project.cloud`, the link a cloud save records), so Save to cloud and Version history
 * carry on with that project. A tab this browser already links to it is only activated, its local
 * edits untouched, and a linked import still waiting for the editor is left for the editor to open;
 * otherwise the cloud head is staged with its link, as a fork's first commit is, for the editor's
 * bootstrap to open as a new tab. The caller navigates to /app once this resolves.
 */
export async function stageCloudProjectOpen(cloudProjectId: string): Promise<void> {
  const bootstrap = await localWorkspaceStore.bootstrap();
  if (bootstrap.status !== 'ready') {
    throw new WorkspaceStoreError('Workspace is not ready.', 'authority-lost');
  }
  const { snapshot } = bootstrap;
  const linked = snapshot.projects.find(project => project.cloud?.projectId === cloudProjectId);
  if (linked) {
    if (linked.id !== snapshot.activeProjectId) {
      await localWorkspaceStore.commit({ type: 'activate-project', projectId: linked.id });
    }
    return;
  }
  if (snapshot.pendingImports.some(pending => pending.cloud?.projectId === cloudProjectId)) return;

  const project = await cloudApi.getProject(cloudProjectId);
  if (!project.headCommitId) throw new Error('Cloud project has no saved version.');
  const commit = await cloudApi.getCommit(cloudProjectId, project.headCommitId);
  await stageImport(
    {
      name: project.name,
      state: commit.state,
      cloud: { projectId: cloudProjectId, lastSyncedCommitId: commit.id },
    },
    { sourceKey: `my-projects-open:${cloudProjectId}:${commit.id}` },
  );
}
