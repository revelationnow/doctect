import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stageCloudProjectOpen } from '../../services/openCloudProject';
import type { WorkspaceProject, WorkspaceSnapshot } from '../../services/localWorkspace/index';
import { readyResult, recoveryResult, workspaceSnapshot } from '../helpers/fakeLocalWorkspaceStore';

const cloudMocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  getCommit: vi.fn(),
}));

const stageImport = vi.hoisted(() => vi.fn());

const workspaceStore = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  commit: vi.fn(),
  exportRecoveryBundle: vi.fn(),
}));

vi.mock('../../services/cloudApi', () => ({
  cloudApi: cloudMocks,
}));

vi.mock('../../services/importProject', () => ({
  stageImport,
}));

vi.mock('../../services/localWorkspace/index', async importOriginal => ({
  ...await importOriginal<typeof import('../../services/localWorkspace/index')>(),
  localWorkspaceStore: workspaceStore,
}));

const unlinkedTab = workspaceSnapshot().projects[0];

const linkedTab = (id: string, cloudProjectId: string): WorkspaceProject => ({
  id,
  name: `Tab ${id}`,
  initialState: {} as WorkspaceProject['initialState'],
  cloud: { projectId: cloudProjectId, lastSyncedCommitId: 'older-head' },
});

const readyWith = (overrides: Partial<WorkspaceSnapshot>) =>
  readyResult({ snapshot: workspaceSnapshot(overrides) });

describe('stageCloudProjectOpen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspaceStore.bootstrap.mockResolvedValue(readyResult());
    workspaceStore.commit.mockResolvedValue(workspaceSnapshot());
    cloudMocks.getProject.mockResolvedValue({ id: 'cloud-1', name: 'Weekly Planner', headCommitId: 'head-2' });
    cloudMocks.getCommit.mockResolvedValue({
      id: 'head-2',
      message: 'Update',
      createdAt: '2026-10-21T12:00:00.000Z',
      state: { savedFrom: 'another browser' },
    });
    stageImport.mockResolvedValue('import-1');
  });

  it('stages the latest cloud save as a new tab linked to its cloud project', async () => {
    workspaceStore.bootstrap.mockResolvedValue(readyWith({
      projects: [unlinkedTab, linkedTab('project-b', 'cloud-other')],
    }));

    await stageCloudProjectOpen('cloud-1');

    expect(cloudMocks.getProject).toHaveBeenCalledWith('cloud-1');
    expect(cloudMocks.getCommit).toHaveBeenCalledWith('cloud-1', 'head-2');
    expect(stageImport).toHaveBeenCalledWith(
      {
        name: 'Weekly Planner',
        state: { savedFrom: 'another browser' },
        cloud: { projectId: 'cloud-1', lastSyncedCommitId: 'head-2' },
      },
      { sourceKey: 'my-projects-open:cloud-1:head-2' },
    );
    expect(workspaceStore.commit).not.toHaveBeenCalled();
  });

  it('activates the tab already linked to the cloud project instead of staging a copy', async () => {
    workspaceStore.bootstrap.mockResolvedValue(readyWith({
      projects: [unlinkedTab, linkedTab('project-b', 'cloud-1')],
    }));

    await stageCloudProjectOpen('cloud-1');

    expect(workspaceStore.commit).toHaveBeenCalledTimes(1);
    expect(workspaceStore.commit).toHaveBeenCalledWith({ type: 'activate-project', projectId: 'project-b' });
    expect(cloudMocks.getProject).not.toHaveBeenCalled();
    expect(cloudMocks.getCommit).not.toHaveBeenCalled();
    expect(stageImport).not.toHaveBeenCalled();
  });

  it('changes nothing when the linked tab is already the active one', async () => {
    workspaceStore.bootstrap.mockResolvedValue(readyWith({
      projects: [unlinkedTab, linkedTab('project-b', 'cloud-1')],
      activeProjectId: 'project-b',
    }));

    await stageCloudProjectOpen('cloud-1');

    expect(workspaceStore.commit).not.toHaveBeenCalled();
    expect(stageImport).not.toHaveBeenCalled();
  });

  it('stages no second copy while a linked import is still waiting for the editor', async () => {
    workspaceStore.bootstrap.mockResolvedValue(readyWith({
      pendingImports: [{
        id: 'import-0',
        targetProjectId: 'proj-0',
        name: 'Weekly Planner',
        state: {} as WorkspaceProject['initialState'],
        cloud: { projectId: 'cloud-1', lastSyncedCommitId: 'head-1' },
        createdAt: '2026-10-21T11:00:00.000Z',
        warnings: [],
      }],
    }));

    await stageCloudProjectOpen('cloud-1');

    expect(cloudMocks.getProject).not.toHaveBeenCalled();
    expect(stageImport).not.toHaveBeenCalled();
    expect(workspaceStore.commit).not.toHaveBeenCalled();
  });

  it('rejects without reaching the cloud when the local workspace is not ready', async () => {
    workspaceStore.bootstrap.mockResolvedValue(recoveryResult());

    await expect(stageCloudProjectOpen('cloud-1')).rejects.toMatchObject({ code: 'authority-lost' });

    expect(cloudMocks.getProject).not.toHaveBeenCalled();
    expect(stageImport).not.toHaveBeenCalled();
  });
});
