import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorPage } from '../../pages/EditorPage';
import type { LocalWorkspaceStore, SnapshotWorkspaceCommand as WorkspaceCommand, WorkspaceSnapshot } from '../../services/localWorkspace/index';
import { createBlankProject } from '../../services/presets';
import { mockWorkspaceCommit } from '../helpers/fakeLocalWorkspaceStore';

const formFactor = vi.hoisted(() => ({ current: 'desktop' as 'desktop' | 'tablet' | 'phone' }));
const closeModal = vi.hoisted(() => ({ current: undefined as any }));
const newProjectModal = vi.hoisted(() => ({ current: undefined as any }));

vi.mock('../../hooks/useEditorFormFactor', () => ({ useEditorFormFactor: () => formFactor.current }));
// The active editor pane renders whatever page chrome the context hands it, so the test can see
// the wiring (EditorPage mounts one pane per open project; the inactive one stays blank here).
vi.mock('../../components/ProjectEditor', async () => {
    const { useEditorChrome } = await import('../../components/editor-layout/EditorChromeContext');
    return {
        ProjectEditor: ({ projectId, isActive }: { projectId: string; isActive: boolean }) => {
            const chrome = useEditorChrome();
            if (!isActive) return <div data-testid={`editor-${projectId}`} />;
            return (
                <div data-testid={`editor-${projectId}`}>
                    {chrome ? (
                        <>
                            <span data-testid="chrome-projects">{chrome.projects.map(project => project.name).join('|')}</span>
                            <span data-testid="chrome-active">{chrome.activeProjectId}</span>
                            <button type="button" onClick={() => chrome.onSelectProject('project-b')}>chrome select b</button>
                            <button type="button" onClick={() => chrome.onCloseProject('project-a')}>chrome close a</button>
                            <button type="button" onClick={() => chrome.onCloseProject('missing')}>chrome close missing</button>
                            <button type="button" onClick={chrome.onNewProject}>chrome new project</button>
                            <div data-testid="chrome-save">{chrome.saveStatus}</div>
                            <div data-testid="chrome-cloud">{chrome.cloudMenu}</div>
                            <div data-testid="chrome-account">{chrome.accountMenu}</div>
                        </>
                    ) : <span>no-chrome</span>}
                </div>
            );
        },
    };
});
vi.mock('../../components/TabBar', () => ({ TabBar: () => <div data-testid="tab-bar" /> }));
vi.mock('../../components/NewProjectModal', () => ({ NewProjectModal: (props: any) => { newProjectModal.current = props; return null; } }));
vi.mock('../../components/CloseProjectConfirmModal', () => ({ CloseProjectConfirmModal: (props: any) => { closeModal.current = props; return null; } }));
vi.mock('../../components/AccountMenu', () => ({ AccountMenu: () => <span>account-menu</span> }));
vi.mock('../../components/cloud/CloudMenu', () => ({ CloudMenu: ({ project }: any) => <span>cloud-menu:{project.id}</span> }));
vi.mock('../../services/analytics', () => ({ trackEvent: vi.fn() }));

const workspace = (): WorkspaceSnapshot => ({
    projects: [
        { id: 'project-a', name: 'Project A', initialState: createBlankProject() },
        { id: 'project-b', name: 'Project B', initialState: createBlankProject() },
    ],
    activeProjectId: 'project-a',
    customPresets: [],
    pendingImports: [],
});

const makeStore = (initial: WorkspaceSnapshot) => {
    let durable = structuredClone(initial);
    const commit = mockWorkspaceCommit(async (command: WorkspaceCommand) => {
        if (command.type === 'activate-project') durable = { ...durable, activeProjectId: command.projectId };
        return structuredClone(durable);
    });
    const store: LocalWorkspaceStore = { bootstrap: vi.fn(), commit, exportRecoveryBundle: vi.fn() };
    return { store, commit };
};

const renderPage = () => {
    const initial = workspace();
    const { store, commit } = makeStore(initial);
    const router = createMemoryRouter([{ path: '/app', element: <EditorPage store={store} initialWorkspace={initial} initialWarnings={[]} /> }], { initialEntries: ['/app'] });
    render(<RouterProvider router={router} />);
    return { commit };
};

beforeEach(() => {
    formFactor.current = 'desktop';
    closeModal.current = undefined;
    newProjectModal.current = undefined;
});
afterEach(() => cleanup());

describe('EditorPage page chrome on touch', () => {
    it('hides the page header on phone and hands the editor the same project, save, cloud and account chrome', async () => {
        formFactor.current = 'phone';
        const { commit } = renderPage();
        expect(screen.queryByRole('banner')).toBeNull();
        expect(screen.queryByTestId('tab-bar')).toBeNull();
        expect(screen.getByTestId('chrome-projects').textContent).toBe('Project A|Project B');
        expect(screen.getByTestId('chrome-active').textContent).toBe('project-a');
        expect(screen.getByTestId('chrome-save').textContent).toContain('Saved locally');
        expect(screen.getByTestId('chrome-cloud').textContent).toBe('cloud-menu:project-a');
        expect(screen.getByTestId('chrome-account').textContent).toBe('account-menu');
        // Only the phone top bar renders these now: no second copy anywhere on the page.
        expect(screen.getAllByText('Saved locally')).toHaveLength(1);
        expect(screen.getAllByText('account-menu')).toHaveLength(1);

        fireEvent.click(screen.getByRole('button', { name: 'chrome select b' }));
        await waitFor(() => expect(commit.mock.calls.map(([command]) => command))
            .toContainEqual(expect.objectContaining({ type: 'activate-project', projectId: 'project-b' })));
        await waitFor(() => expect(screen.getByTestId('chrome-active').textContent).toBe('project-b'));

        fireEvent.click(screen.getByRole('button', { name: 'chrome close missing' }));
        expect(closeModal.current.isOpen).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: 'chrome close a' }));
        expect(closeModal.current.isOpen).toBe(true);
        expect(closeModal.current.projectName).toBe('Project A');

        expect(newProjectModal.current.isOpen).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: 'chrome new project' }));
        expect(newProjectModal.current.isOpen).toBe(true);
    });

    it.each(['desktop', 'tablet'] as const)('keeps the page header with the tab strip on %s', (value) => {
        formFactor.current = value;
        renderPage();
        expect(screen.getByRole('banner')).toBeTruthy();
        expect(screen.getByTestId('tab-bar')).toBeTruthy();
        expect(screen.getByTestId('chrome-projects').textContent).toBe('Project A|Project B');
    });
});
