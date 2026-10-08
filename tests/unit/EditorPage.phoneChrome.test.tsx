import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorPage } from '../../pages/EditorPage';
import type { LocalWorkspaceStore, SnapshotWorkspaceCommand as WorkspaceCommand, WorkspaceSnapshot } from '../../services/localWorkspace/index';
import { createBlankProject } from '../../services/presets';
import { mockWorkspaceCommit } from '../helpers/fakeLocalWorkspaceStore';

const formFactor = vi.hoisted(() => ({ current: 'desktop' as 'desktop' | 'tablet' | 'phone' }));
const closeModal = vi.hoisted(() => ({ current: undefined as any }));
const newProjectModal = vi.hoisted(() => ({ current: undefined as any }));
/** Every chrome object the active pane was handed, one per render, oldest first. */
const seenChrome = vi.hoisted(() => ({ list: [] as any[] }));

vi.mock('../../hooks/useEditorFormFactor', () => ({ useEditorFormFactor: () => formFactor.current }));
// The active editor pane renders whatever page chrome the context hands it, so the test can see
// the wiring (EditorPage mounts one pane per open project; the inactive one stays blank here).
vi.mock('../../components/ProjectEditor', async () => {
    const { useEditorChrome } = await import('../../components/editor-layout/EditorChromeContext');
    return {
        ProjectEditor: ({ projectId, isActive }: { projectId: string; isActive: boolean }) => {
            const chrome = useEditorChrome();
            if (!isActive) return <div data-testid={`editor-${projectId}`} />;
            seenChrome.list.push(chrome);
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
                            <span data-testid="chrome-navigation">{(chrome.navigation ?? []).map(target => `${target.label}→${target.to}`).join('|')}</span>
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
// The chrome's CloudMenu (remounted by the sheet on every ⋯ open) carries the page's cloud-project
// cache; the header's own instance, mounted once, does not.
vi.mock('../../components/cloud/CloudMenu', () => ({
    CloudMenu: ({ project, cloudProjectCache }: any) => <span>cloud-menu:{project.id}{cloudProjectCache instanceof Map ? ':cached' : ''}</span>,
}));
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

const renderPage = (initialWarnings: string[] = []) => {
    const initial = workspace();
    const { store, commit } = makeStore(initial);
    const router = createMemoryRouter([{ path: '/app', element: <EditorPage store={store} initialWorkspace={initial} initialWarnings={initialWarnings} /> }], { initialEntries: ['/app'] });
    render(<RouterProvider router={router} />);
    return { commit };
};

beforeEach(() => {
    formFactor.current = 'desktop';
    closeModal.current = undefined;
    newProjectModal.current = undefined;
    seenChrome.list.length = 0;
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
        expect(screen.getByTestId('chrome-cloud').textContent).toBe('cloud-menu:project-a:cached');
        expect(screen.getByTestId('chrome-account').textContent).toBe('account-menu');
        // Only the phone top bar renders these now: no second copy anywhere on the page.
        expect(screen.getAllByText('Saved locally')).toHaveLength(1);
        expect(screen.getAllByText('account-menu')).toHaveLength(1);
        expect(screen.getByTestId('chrome-navigation').textContent).toBe('Home→/|Gallery→/gallery|Docs→/docs');

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

    it('memoises the chrome: an unrelated page re-render keeps the same object, a project change replaces it', async () => {
        formFactor.current = 'phone';
        renderPage(['An old project warning']);
        const first = seenChrome.list.at(-1);
        expect(first).toBeTruthy();
        // Dismissing the warning re-renders the page shell and the panes, but shows the same chrome.
        fireEvent.click(screen.getByRole('button', { name: 'Dismiss project load warnings' }));
        expect(screen.queryByText('An old project warning')).toBeNull();
        expect(seenChrome.list.length).toBeGreaterThan(1);
        expect(seenChrome.list.at(-1)).toBe(first);
        // Its callbacks still reach the live handlers: the activation below goes through.
        fireEvent.click(screen.getByRole('button', { name: 'chrome select b' }));
        await waitFor(() => expect(screen.getByTestId('chrome-active').textContent).toBe('project-b'));
        expect(seenChrome.list.at(-1)).not.toBe(first);
        expect(seenChrome.list.at(-1).activeProjectId).toBe('project-b');
        expect(seenChrome.list.at(-1).navigation).toBe(first.navigation);
        // The cloud-project cache is the page's, so a project change keeps the same one.
        expect(seenChrome.list.at(-1).cloudMenu.props.cloudProjectCache).toBe(first.cloudMenu.props.cloudProjectCache);
        expect(first.cloudMenu.props.cloudProjectCache).toBeInstanceOf(Map);
    });

    it.each(['desktop', 'tablet'] as const)('keeps the page header with the tab strip on %s', (value) => {
        formFactor.current = value;
        renderPage();
        const banner = screen.getByRole('banner');
        expect(screen.getByTestId('tab-bar')).toBeTruthy();
        expect(screen.getByTestId('chrome-projects').textContent).toBe('Project A|Project B');
        // The chrome's Navigate targets are exactly the header's own page links.
        const headerLinks = [
            `Home→${within(banner).getByTitle('Back to Home').getAttribute('href')}`,
            `Gallery→${within(banner).getByRole('link', { name: 'Gallery' }).getAttribute('href')}`,
            `Docs→${within(banner).getByRole('link', { name: 'Docs' }).getAttribute('href')}`,
        ].join('|');
        expect(screen.getByTestId('chrome-navigation').textContent).toBe(headerLinks);
    });
});
