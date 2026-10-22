import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MyProjectsPage } from '../../pages/MyProjectsPage';
import { ApiError } from '../../services/cloudApi';
import { stageImport } from '../../services/importProject';
import type { WorkspaceProject } from '../../services/localWorkspace/index';
import { readyResult, workspaceSnapshot } from '../helpers/fakeLocalWorkspaceStore';

const mockListProjects = vi.fn();
const mockDeleteProject = vi.fn();
const mockGetProject = vi.fn();
const mockGetCommit = vi.fn();

vi.mock('../../services/cloudApi', async importOriginal => ({
    ...await importOriginal<typeof import('../../services/cloudApi')>(),
    cloudApi: {
        listProjects: (...args: any[]) => mockListProjects(...args),
        deleteProject: (...args: any[]) => mockDeleteProject(...args),
        getProject: (...args: any[]) => mockGetProject(...args),
        getCommit: (...args: any[]) => mockGetCommit(...args),
    },
}));

// Open stages through the same importer as a gallery fork; what the editor then does with a
// staged project is covered by the bootstrap gate's own tests.
vi.mock('../../services/importProject', () => ({
    IMPORT_STAGE_ERROR_MESSAGE: 'Could not prepare this project for the editor. Nothing was removed; try again.',
    stageImport: vi.fn(),
}));

const workspaceStore = vi.hoisted(() => ({
    bootstrap: vi.fn(),
    commit: vi.fn(),
    exportRecoveryBundle: vi.fn(),
}));

vi.mock('../../services/localWorkspace/index', async importOriginal => ({
    ...await importOriginal<typeof import('../../services/localWorkspace/index')>(),
    localWorkspaceStore: workspaceStore,
}));

const project = (over: any = {}) => ({
    id: 'p1', ownerId: 'u1', name: 'Weekly Planner', description: '', tags: [],
    visibility: 'private', headCommitId: 'c1', forkedFromProjectId: null, forkedFromCommitId: null,
    downloadCount: 0, forkCount: 0, createdAt: '2026-07-01', updatedAt: '2026-07-02',
    storedBytes: 2 * 1024 * 1024, commitCount: 7, ...over,
});

const headCommit = {
    id: 'c2', message: 'Update', createdAt: '2026-07-03T09:00:00.000Z',
    state: { nodes: {}, rootId: 'root', variants: {}, activeVariantId: 'default' },
};

const renderPage = () => render(
    <MemoryRouter initialEntries={['/projects']}>
        <Routes>
            <Route path="/projects" element={<MyProjectsPage />} />
            <Route path="/app" element={<div>APP_MARKER</div>} />
        </Routes>
    </MemoryRouter>
);

describe('MyProjectsPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockListProjects.mockResolvedValue({
            projects: [project()],
            usage: { usedBytes: 2 * 1024 * 1024, quotaBytes: 50 * 1024 * 1024 },
        });
        mockDeleteProject.mockResolvedValue({ success: true });
        // The cloud has a newer save than the list showed (c1): Open must fetch the head, not reuse it.
        mockGetProject.mockResolvedValue(project({ headCommitId: 'c2' }));
        mockGetCommit.mockResolvedValue(headCommit);
        workspaceStore.bootstrap.mockResolvedValue(readyResult());
        workspaceStore.commit.mockResolvedValue(workspaceSnapshot());
        vi.mocked(stageImport).mockResolvedValue('import-1');
    });

    it('lists projects with size, commit count and visibility', async () => {
        renderPage();
        expect(await screen.findByText('Weekly Planner')).toBeInTheDocument();
        // NB: /2\.0 MB/ alone would also match the usage bar ("2.0 MB of 50.0 MB used")
        // and fail with a multiple-match error — keep the matcher scoped to the row text.
        expect(screen.getByText(/2\.0 MB · 7 versions/)).toBeInTheDocument();
        expect(screen.getByText('private')).toBeInTheDocument();
    });

    it('shows overall storage usage against the quota', async () => {
        renderPage();
        expect(await screen.findByText(/2\.0 MB of 50\.0 MB used/)).toBeInTheDocument();
    });

    it('shows usage without a quota bar when the account has no storage limit', async () => {
        mockListProjects.mockResolvedValue({
            projects: [project()],
            usage: { usedBytes: 2 * 1024 * 1024, quotaBytes: null },
        });
        renderPage();
        expect(await screen.findByText(/2\.0 MB used · no storage limit/)).toBeInTheDocument();
        expect(screen.queryByText(/%$/)).not.toBeInTheDocument();
    });

    it('deletes a project after confirmation and refreshes the list', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        renderPage();
        fireEvent.click(await screen.findByRole('button', { name: /delete/i }));
        await waitFor(() => expect(mockDeleteProject).toHaveBeenCalledWith('p1'));
        expect(mockListProjects).toHaveBeenCalledTimes(2);
    });

    it('does not delete when confirmation is declined', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(false);
        renderPage();
        fireEvent.click(await screen.findByRole('button', { name: /delete/i }));
        expect(mockDeleteProject).not.toHaveBeenCalled();
    });

    it('shows an empty state when there are no projects', async () => {
        mockListProjects.mockResolvedValue({ projects: [], usage: { usedBytes: 0, quotaBytes: 50 * 1024 * 1024 } });
        renderPage();
        expect(await screen.findByText(/no cloud projects yet/i)).toBeInTheDocument();
    });

    it('opens the latest cloud save in a new editor tab linked to the project', async () => {
        let resolveCommit!: (commit: typeof headCommit) => void;
        mockGetCommit.mockReturnValue(new Promise(resolve => { resolveCommit = resolve; }));
        renderPage();

        fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
        expect(await screen.findByRole('button', { name: 'Opening…' })).toBeDisabled();
        resolveCommit(headCommit);

        expect(await screen.findByText('APP_MARKER')).toBeInTheDocument();
        expect(mockGetProject).toHaveBeenCalledWith('p1');
        expect(mockGetCommit).toHaveBeenCalledWith('p1', 'c2');
        expect(stageImport).toHaveBeenCalledWith(
            {
                name: 'Weekly Planner',
                state: headCommit.state,
                cloud: { projectId: 'p1', lastSyncedCommitId: 'c2' },
            },
            { sourceKey: 'my-projects-open:p1:c2' },
        );
        expect(workspaceStore.commit).not.toHaveBeenCalled();
    });

    it('switches to the tab already linked to the project instead of opening a copy', async () => {
        const linked: WorkspaceProject = {
            id: 'project-b', name: 'Weekly Planner', initialState: {} as WorkspaceProject['initialState'],
            cloud: { projectId: 'p1', lastSyncedCommitId: 'c1' },
        };
        workspaceStore.bootstrap.mockResolvedValue(readyResult({
            snapshot: workspaceSnapshot({ projects: [...workspaceSnapshot().projects, linked] }),
        }));
        renderPage();

        fireEvent.click(await screen.findByRole('button', { name: 'Open' }));

        expect(await screen.findByText('APP_MARKER')).toBeInTheDocument();
        expect(workspaceStore.commit).toHaveBeenCalledWith({ type: 'activate-project', projectId: 'project-b' });
        // Its local edits stand: nothing is fetched from the cloud or staged over them.
        expect(mockGetCommit).not.toHaveBeenCalled();
        expect(stageImport).not.toHaveBeenCalled();
    });

    it.each([
        ['the cloud refuses', () => mockGetCommit.mockRejectedValue(new ApiError(404, 'Commit not found')),
            'Commit not found'],
        ['the editor cannot take it', () => vi.mocked(stageImport).mockRejectedValue(new Error('post-commit readback failed')),
            'Could not prepare this project for the editor. Nothing was removed; try again.'],
    ])('shows an error on the page and stays put when %s', async (_case, fail, message) => {
        fail();
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
        renderPage();

        fireEvent.click(await screen.findByRole('button', { name: 'Open' }));

        expect(await screen.findByText(message)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Open' })).toBeEnabled();
        expect(screen.queryByText('APP_MARKER')).not.toBeInTheDocument();
        logged.mockRestore();
    });
});
