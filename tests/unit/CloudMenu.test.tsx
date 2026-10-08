import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, createMemoryRouter, RouterProvider, useNavigationType } from 'react-router-dom';
import { CloudMenu } from '../../components/cloud/CloudMenu';
import type { CloudProject } from '../../services/cloudApi';
import { layOutEveryElement } from '../helpers/jsdomLayout';
import { MenuListContext } from '../../components/editor-layout/MenuListContext';
import { OverflowMenu } from '../../components/editor-layout/OverflowMenu';
import { FormFactorProvider } from '../../components/editor-layout/FormFactorContext';
import { BackDismissProvider, overlayDepthOf } from '../../components/editor-layout/useBackDismiss';
import type { EditorChrome } from '../../components/editor-layout/EditorChromeContext';
import { makeActions } from '../helpers/touchActions';
import { cloudApi, ApiError } from '../../services/cloudApi';
import type { WorkspaceProject } from '../../services/localWorkspace/index';

const mockUseSession = vi.fn();
vi.mock('../../lib/auth-client', () => ({
    useSession: () => mockUseSession(),
}));
// CloudMenu statically imports PublishModal, which imports thumbnailService, which loads
// pdfjs-dist at module scope; pdfjs-dist references DOMMatrix (a real-browser API) as soon as
// it's evaluated, which jsdom doesn't provide, crashing module load before any test can run.
// None of these tests exercise the Publish flow (project.cloud is always undefined here), so
// stub the one function that pulls in pdfjs-dist rather than touch CloudMenu or global setup.
// Resolves to the real contract's shape (an array of { nodeId, dataUrl } pairs) rather than
// undefined, so the stub can't drift from generateThumbnails' signature.
vi.mock('../../services/thumbnailService', () => ({
    generateThumbnails: vi.fn(async () => []),
}));

const project: WorkspaceProject = {
    id: 'local-1',
    name: 'Test Project',
    initialState: {
        nodes: { root: { id: 'root', parentId: null, type: 'page', title: 'Root', data: {}, children: [] } },
        rootId: 'root',
        variants: { default: { id: 'default', name: 'Default', templates: {} } },
        activeVariantId: 'default',
    } as any,
};

const menu = (
    menuProject: WorkspaceProject = project,
    onLinkCloud = vi.fn(async () => true),
    onRestoreState = vi.fn(async () => true),
) => (
    <MemoryRouter initialEntries={['/app']}>
        <Routes>
            <Route path="/app" element={<CloudMenu project={menuProject} onLinkCloud={onLinkCloud} onRestoreState={onRestoreState} />} />
            <Route path="/welcome" element={<div>WELCOME_MARKER</div>} />
        </Routes>
    </MemoryRouter>
);

const renderMenu = (
    menuProject: WorkspaceProject = project,
    onLinkCloud = vi.fn(async () => true),
    onRestoreState = vi.fn(async () => true),
) => render(menu(menuProject, onLinkCloud, onRestoreState));

describe('CloudMenu', () => {
    beforeEach(() => vi.restoreAllMocks());

    it('shows "Sign in to save to cloud" when signed out', () => {
        mockUseSession.mockReturnValue({ data: null });
        renderMenu();
        fireEvent.click(screen.getByTitle('Cloud'));
        expect(screen.getByText('Sign in to save to cloud')).toBeInTheDocument();
    });

    it('shows "Set a username to use cloud features" when signed in without a username', () => {
        mockUseSession.mockReturnValue({ data: { user: { username: null } } });
        renderMenu();
        fireEvent.click(screen.getByTitle('Cloud'));
        const link = screen.getByText('Set a username to use cloud features');
        expect(link.closest('a')).toHaveAttribute('href', '/welcome');
        expect(screen.queryByText('Save to cloud (new)')).not.toBeInTheDocument();
    });

    it('shows the full cloud menu when signed in with a username', () => {
        mockUseSession.mockReturnValue({ data: { user: { username: 'planner_pro' } } });
        renderMenu();
        fireEvent.click(screen.getByTitle('Cloud'));
        expect(screen.getByText('Save to cloud (new)')).toBeInTheDocument();
    });

    it('redirects to /welcome if the server rejects a save as USERNAME_REQUIRED', async () => {
        mockUseSession.mockReturnValue({ data: { user: { username: 'planner_pro' } } });
        vi.spyOn(cloudApi, 'createProject').mockRejectedValue(new ApiError(403, 'nope', 'USERNAME_REQUIRED'));
        vi.spyOn(window, 'prompt').mockReturnValue('Initial save');
        renderMenu();
        fireEvent.click(screen.getByTitle('Cloud'));
        fireEvent.click(screen.getByRole('button', { name: 'Save to cloud (new)' }));
        expect(await screen.findByText('WELCOME_MARKER')).toBeInTheDocument();
    });

    it('keeps local edits on conflict and reloads latest cloud state only when requested', async () => {
        mockUseSession.mockReturnValue({ data: { user: { username: 'planner_pro' } } });
        const linked = { ...project, cloud: { projectId: 'cloud-1', lastSyncedCommitId: 'head-1' } };
        const latestState = { ...project.initialState, rootId: 'latest' } as any;
        const onLinkCloud = vi.fn(async () => true);
        const onRestoreState = vi.fn(async () => true);
        vi.spyOn(cloudApi, 'getProject').mockResolvedValue({ id: 'cloud-1', headCommitId: 'head-2' } as any);
        vi.spyOn(cloudApi, 'saveCommit').mockRejectedValue(new ApiError(409, 'changed', 'PROJECT_HEAD_CHANGED'));
        vi.spyOn(cloudApi, 'getCommit').mockResolvedValue({ id: 'head-2', state: latestState } as any);
        vi.spyOn(window, 'prompt').mockReturnValue('Update');
        renderMenu(linked, onLinkCloud, onRestoreState);

        fireEvent.click(screen.getByTitle('Cloud'));
        fireEvent.click(screen.getByRole('button', { name: 'Save to cloud' }));

        expect(await screen.findByText(/changed since your last save/i)).toBeInTheDocument();
        expect(onRestoreState).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Reload cloud version' }));
        await waitFor(() => expect(onRestoreState).toHaveBeenCalledWith(
            latestState,
            { projectId: 'cloud-1', lastSyncedCommitId: 'head-2' },
        ));
        expect(onLinkCloud).not.toHaveBeenCalled();
    });

    it('retries a failed new-project local link without creating another remote project', async () => {
        mockUseSession.mockReturnValue({ data: { user: { username: 'planner_pro' } } });
        const onLinkCloud = vi.fn()
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true);
        const createProject = vi.spyOn(cloudApi, 'createProject').mockResolvedValue({
            project: { id: 'cloud-created' },
            commit: { id: 'head-created' },
        } as any);
        const prompt = vi.spyOn(window, 'prompt').mockReturnValue('Initial save');
        renderMenu(project, onLinkCloud);

        fireEvent.click(screen.getByTitle('Cloud'));
        fireEvent.click(screen.getByRole('button', { name: 'Save to cloud (new)' }));
        expect(await screen.findByText('Cloud save succeeded, but its local link was not saved.')).toBeVisible();

        fireEvent.click(screen.getByRole('button', { name: 'Retry local link' }));

        await waitFor(() => expect(onLinkCloud).toHaveBeenCalledTimes(2));
        expect(onLinkCloud).toHaveBeenNthCalledWith(1, {
            projectId: 'cloud-created',
            lastSyncedCommitId: 'head-created',
        });
        expect(onLinkCloud).toHaveBeenNthCalledWith(2, {
            projectId: 'cloud-created',
            lastSyncedCommitId: 'head-created',
        });
        expect(createProject).toHaveBeenCalledTimes(1);
        expect(prompt).toHaveBeenCalledTimes(1);
    });

    it('retries a failed updated-head local link without another cloud commit', async () => {
        mockUseSession.mockReturnValue({ data: { user: { username: 'planner_pro' } } });
        const linked = { ...project, cloud: { projectId: 'cloud-1', lastSyncedCommitId: 'head-1' } };
        const onLinkCloud = vi.fn()
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true);
        vi.spyOn(cloudApi, 'getProject').mockResolvedValue({ id: 'cloud-1', headCommitId: 'head-1' } as any);
        const saveCommit = vi.spyOn(cloudApi, 'saveCommit').mockResolvedValue({
            commit: { id: 'head-2' },
        } as any);
        const prompt = vi.spyOn(window, 'prompt').mockReturnValue('Update');
        renderMenu(linked, onLinkCloud);

        fireEvent.click(screen.getByTitle('Cloud'));
        fireEvent.click(screen.getByRole('button', { name: 'Save to cloud' }));
        expect(await screen.findByText('Cloud save succeeded, but its local link was not saved.')).toBeVisible();

        fireEvent.click(screen.getByRole('button', { name: 'Retry local link' }));

        await waitFor(() => expect(onLinkCloud).toHaveBeenCalledTimes(2));
        expect(onLinkCloud).toHaveBeenLastCalledWith({
            projectId: 'cloud-1',
            lastSyncedCommitId: 'head-2',
        });
        expect(saveCommit).toHaveBeenCalledTimes(1);
        expect(prompt).toHaveBeenCalledTimes(1);
    });

    it('keeps pending local links isolated by local project', async () => {
        mockUseSession.mockReturnValue({ data: { user: { username: 'planner_pro' } } });
        const onLinkCloud = vi.fn().mockResolvedValue(false);
        vi.spyOn(cloudApi, 'createProject').mockResolvedValue({
            project: { id: 'cloud-created' },
            commit: { id: 'head-created' },
        } as any);
        vi.spyOn(window, 'prompt').mockReturnValue('Initial save');
        const view = renderMenu(project, onLinkCloud);

        fireEvent.click(screen.getByTitle('Cloud'));
        fireEvent.click(screen.getByRole('button', { name: 'Save to cloud (new)' }));
        expect(await screen.findByRole('button', { name: 'Retry local link' })).toBeVisible();

        const secondProject = { ...project, id: 'local-2', name: 'Second Project' };
        view.rerender(menu(secondProject, onLinkCloud));
        expect(screen.getByRole('button', { name: 'Save to cloud (new)' })).toBeVisible();
        expect(screen.queryByRole('button', { name: 'Retry local link' })).not.toBeInTheDocument();

        view.rerender(menu(project, onLinkCloud));
        expect(screen.getByRole('button', { name: 'Retry local link' })).toBeVisible();
    });
});

// Task 21: inside a MenuListContext host (the phone ⋯ sheet) the same items render as rows with no
// trigger; a completed one-shot action dismisses the host, an action that opens a modal does not.
describe('CloudMenu as sheet rows', () => {
    beforeEach(() => vi.restoreAllMocks());

    const Destination = ({ name }: { name: string }) => <div>{name}:{useNavigationType()}</div>;
    /** `overlayDepth` > 0 starts on the history entry a touch overlay (the ⋯ sheet) pushes above the editor's. */
    const renderRows = (
        menuProject: WorkspaceProject = project,
        onLinkCloud = vi.fn(async () => true),
        { overlayDepth = 0, cache, onRestoreState = vi.fn(async () => true) }: {
            overlayDepth?: number; cache?: Map<string, CloudProject>; onRestoreState?: React.ComponentProps<typeof CloudMenu>['onRestoreState'];
        } = {},
    ) => {
        const onDismiss = vi.fn();
        render(
            <MenuListContext.Provider value={{ onDismiss }}>
                <MemoryRouter initialEntries={[{ pathname: '/app', state: overlayDepth > 0 ? { touchOverlays: overlayDepth } : null }]}>
                    <Routes>
                        <Route path="/app" element={<CloudMenu project={menuProject} cloudProjectCache={cache} onLinkCloud={onLinkCloud} onRestoreState={onRestoreState} />} />
                        <Route path="/login" element={<Destination name="LOGIN_MARKER" />} />
                        <Route path="/welcome" element={<Destination name="WELCOME_MARKER" />} />
                    </Routes>
                </MemoryRouter>
            </MenuListContext.Provider>,
        );
        return { onDismiss, onLinkCloud };
    };

    it('shows the sign-in row at once, as a 44px link that dismisses the host when followed', () => {
        mockUseSession.mockReturnValue({ data: null });
        const { onDismiss } = renderRows();
        expect(screen.queryByTitle('Cloud')).not.toBeInTheDocument();
        const link = screen.getByRole('link', { name: 'Sign in to save to cloud' });
        expect(link).toHaveAttribute('href', '/login');
        expect(link.className).toMatch(/\bmin-h-11\b/);
        fireEvent.click(link);
        expect(onDismiss).toHaveBeenCalledTimes(1);
        expect(screen.getByText('LOGIN_MARKER:PUSH')).toBeInTheDocument();
    });

    it('replaces the overlay\'s history entry when a link is followed from inside an open touch overlay', () => {
        mockUseSession.mockReturnValue({ data: null });
        const { onDismiss } = renderRows(project, undefined, { overlayDepth: 1 });
        fireEvent.click(screen.getByRole('link', { name: 'Sign in to save to cloud' }));
        expect(onDismiss).toHaveBeenCalledTimes(1);
        expect(screen.getByText('LOGIN_MARKER:REPLACE')).toBeInTheDocument();
    });

    it('replaces the overlay\'s history entry when a save is sent to /welcome for a username', async () => {
        mockUseSession.mockReturnValue({ data: { user: { username: 'planner_pro' } } });
        vi.spyOn(cloudApi, 'createProject').mockRejectedValue(new ApiError(403, 'nope', 'USERNAME_REQUIRED'));
        vi.spyOn(window, 'prompt').mockReturnValue('Initial save');
        renderRows(project, undefined, { overlayDepth: 1 });
        fireEvent.click(screen.getByRole('button', { name: 'Save to cloud (new)' }));
        expect(await screen.findByText('WELCOME_MARKER:REPLACE')).toBeInTheDocument();
    });

    it('keeps a host cache in step: the fetched project, the reloaded one, and nothing once a listing edit drops it', async () => {
        mockUseSession.mockReturnValue({ data: { user: { username: 'planner_pro' } } });
        const linked = { ...project, cloud: { projectId: 'cloud-1', lastSyncedCommitId: 'head-1' } };
        const stale = { id: 'cloud-1', headCommitId: 'head-1' } as CloudProject;
        const latest = { id: 'cloud-1', headCommitId: 'head-2' } as CloudProject;
        const getProject = vi.spyOn(cloudApi, 'getProject').mockResolvedValueOnce(stale).mockResolvedValueOnce(latest);
        vi.spyOn(cloudApi, 'saveCommit').mockRejectedValue(new ApiError(409, 'changed', 'PROJECT_HEAD_CHANGED'));
        vi.spyOn(cloudApi, 'getCommit').mockResolvedValue({ id: 'head-2', state: project.initialState } as any);
        vi.spyOn(window, 'prompt').mockReturnValue('Update');
        const cache = new Map<string, CloudProject>();
        const onRestoreState = vi.fn(async () => true);
        renderRows(linked, undefined, { cache, onRestoreState });
        await waitFor(() => expect(cache.get('cloud-1')).toBe(stale));
        expect(getProject).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', { name: 'Save to cloud' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Reload cloud version' }));
        await waitFor(() => expect(onRestoreState).toHaveBeenCalled());
        expect(cache.get('cloud-1')).toBe(latest);
        expect(getProject).toHaveBeenCalledTimes(2);
    });

    it('saves to the cloud from its row with the usual handlers and then dismisses the host', async () => {
        mockUseSession.mockReturnValue({ data: { user: { username: 'planner_pro' } } });
        const createProject = vi.spyOn(cloudApi, 'createProject').mockResolvedValue({
            project: { id: 'cloud-created' }, commit: { id: 'head-created' },
        } as any);
        vi.spyOn(window, 'prompt').mockReturnValue('From the phone');
        const { onDismiss, onLinkCloud } = renderRows();
        const save = screen.getByRole('button', { name: 'Save to cloud (new)' });
        expect(save.className).toMatch(/\bmin-h-11\b/);
        fireEvent.click(save);
        await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
        expect(createProject).toHaveBeenCalledTimes(1);
        expect(onLinkCloud).toHaveBeenCalledWith({ projectId: 'cloud-created', lastSyncedCommitId: 'head-created' });
    });

    it('keeps the host open to show a failed save, and for a modal it opens itself', async () => {
        mockUseSession.mockReturnValue({ data: { user: { username: 'planner_pro' } } });
        const linked = { ...project, cloud: { projectId: 'cloud-1', lastSyncedCommitId: 'head-1' } };
        vi.spyOn(cloudApi, 'getProject').mockResolvedValue({ id: 'cloud-1', headCommitId: 'head-1' } as any);
        vi.spyOn(cloudApi, 'saveCommit').mockRejectedValue(new ApiError(500, 'Save failed badly', 'SERVER'));
        vi.spyOn(cloudApi, 'listCommits').mockResolvedValue([]);
        vi.spyOn(window, 'prompt').mockReturnValue('Update');
        const { onDismiss } = renderRows(linked);
        fireEvent.click(screen.getByRole('button', { name: 'Save to cloud' }));
        expect(await screen.findByText('Save failed badly')).toBeVisible();
        expect(onDismiss).not.toHaveBeenCalled();
        // Version history renders its modal from this menu: dismissing the host would unmount it.
        fireEvent.click(screen.getByRole('button', { name: 'Version history' }));
        expect(await screen.findByRole('heading', { name: 'Version history' })).toBeInTheDocument();
        expect(onDismiss).not.toHaveBeenCalled();
    });

    it('colours the forked-from and reload rows themselves, in the row layout, with no default row colour to lose to', async () => {
        mockUseSession.mockReturnValue({ data: { user: { username: 'planner_pro' } } });
        const linked = { ...project, cloud: { projectId: 'cloud-1', lastSyncedCommitId: 'head-1' } };
        vi.spyOn(cloudApi, 'getProject').mockResolvedValue({ id: 'cloud-1', headCommitId: 'head-1', forkedFromProjectId: 'upstream-1' } as any);
        vi.spyOn(cloudApi, 'saveCommit').mockRejectedValue(new ApiError(409, 'changed', 'PROJECT_HEAD_CHANGED'));
        vi.spyOn(window, 'prompt').mockReturnValue('Update');
        renderRows(linked);
        const forked = await screen.findByRole('link', { name: /forked from upstream/ });
        expect(forked).toHaveAttribute('href', '/gallery/upstream-1');
        expect(forked.className).toMatch(/\bmin-h-11\b/);
        expect(forked.className).toMatch(/\btext-slate-500\b/);
        expect(forked.className).not.toMatch(/\btext-slate-700\b/);
        fireEvent.click(screen.getByRole('button', { name: 'Save to cloud' }));
        const reload = await screen.findByRole('button', { name: 'Reload cloud version' });
        expect(reload.className).toMatch(/\bmin-h-11\b/);
        expect(reload.className).toMatch(/\btext-blue-700\b/);
        expect(reload.className).not.toMatch(/\btext-slate-700\b/);
    });
});

// Task 21 fix round 1 (review Minor #5): a Cloud modal opened from the phone ⋯ sheet takes its own
// back-gesture entry above the sheet's, so back closes the modal alone and the sheet stays; closing
// the modal any other way consumes that entry and returns to the sheet.
describe('Cloud modals opened from the sheet', () => {
    beforeEach(() => vi.restoreAllMocks());
    afterEach(() => { cleanup(); document.documentElement.removeAttribute('data-form-factor'); });

    const linked = { ...project, cloud: { projectId: 'cloud-1', lastSyncedCommitId: 'head-1' } };
    const chrome: Omit<EditorChrome, 'cloudMenu'> = {
        projects: [{ id: 'local-1', name: 'Test Project' }], activeProjectId: 'local-1',
        onSelectProject: vi.fn(), onCloseProject: vi.fn(), onNewProject: vi.fn(), saveStatus: null, accountMenu: null,
    };
    function Host({ cache }: { cache?: Map<string, CloudProject> }) {
        const [menu, setMenu] = useState(false);
        return (
            <>
                <button type="button" onClick={() => setMenu(true)}>More actions</button>
                <OverflowMenu open={menu} onClose={() => setMenu(false)} actions={makeActions()} chrome={{
                    ...chrome,
                    cloudMenu: <CloudMenu project={linked} cloudProjectCache={cache} onLinkCloud={vi.fn(async () => true)} onRestoreState={vi.fn(async () => true)} />,
                }} />
            </>
        );
    }
    const mountOnPhone = (cache?: Map<string, CloudProject>) => {
        const router = createMemoryRouter([
            { path: '/app', element: <FormFactorProvider value="phone"><BackDismissProvider><Host cache={cache} /></BackDismissProvider></FormFactorProvider> },
            { path: '/', element: <div>home route</div> },
        ], { initialEntries: ['/', '/app'], initialIndex: 1 });
        render(<RouterProvider router={router} />);
        return {
            router,
            depth: () => overlayDepthOf(router.state.location),
            back: () => act(() => { void router.navigate(-1); }),
            sheet: () => screen.queryByRole('dialog', { name: 'More actions' }),
            history: () => screen.queryByRole('heading', { name: 'Version history' }),
        };
    };
    const signedIn = (cloudProject: Partial<CloudProject> = {}) => {
        mockUseSession.mockReturnValue({ data: { user: { username: 'planner_pro' } } });
        return vi.spyOn(cloudApi, 'getProject').mockResolvedValue({ id: 'cloud-1', headCommitId: 'head-1', ...cloudProject } as CloudProject);
    };
    const openSheet = () => fireEvent.click(screen.getByRole('button', { name: 'More actions' }));

    it('fetches the cloud project once into the host\'s cache and reopens the sheet from it, not from another GET', async () => {
        const getProject = signedIn({ forkedFromProjectId: 'upstream-1' });
        const cache = new Map<string, CloudProject>();
        const { depth, sheet } = mountOnPhone(cache);
        openSheet();
        expect(await screen.findByRole('link', { name: /forked from upstream/ })).toBeTruthy();
        expect(getProject).toHaveBeenCalledTimes(1);
        expect(cache.get('cloud-1')).toMatchObject({ forkedFromProjectId: 'upstream-1' });
        fireEvent.click(screen.getByTestId('overflow-menu-backdrop'));
        expect(sheet()).toBeNull();
        await waitFor(() => expect(depth()).toBe(0));
        openSheet();
        // The fork row is there from the first render: the record came from the cache.
        expect(within(sheet()!).getByRole('link', { name: /forked from upstream/ })).toBeTruthy();
        expect(getProject).toHaveBeenCalledTimes(1);
    });

    it('without a host cache, every open of the sheet is another fetch (the record lives with the menu)', async () => {
        const getProject = signedIn({ forkedFromProjectId: 'upstream-1' });
        const { depth, sheet } = mountOnPhone();
        openSheet();
        expect(await screen.findByRole('link', { name: /forked from upstream/ })).toBeTruthy();
        fireEvent.click(screen.getByTestId('overflow-menu-backdrop'));
        await waitFor(() => expect(depth()).toBe(0));
        openSheet();
        expect(within(sheet()!).queryByRole('link', { name: /forked from upstream/ })).toBeNull();
        await waitFor(() => expect(getProject).toHaveBeenCalledTimes(2));
    });

    it('back closes Version history only and keeps the sheet; its Close button returns to the sheet with the entry consumed', async () => {
        signedIn();
        vi.spyOn(cloudApi, 'listCommits').mockResolvedValue([]);
        const { router, depth, back, sheet, history } = mountOnPhone();
        fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
        expect(depth()).toBe(1);
        fireEvent.click(within(sheet()!).getByRole('button', { name: 'Version history' }));
        expect(await screen.findByRole('heading', { name: 'Version history' })).toBeInTheDocument();
        expect(sheet()).not.toBeNull();
        expect(depth()).toBe(2);

        back();
        expect(history()).toBeNull();
        expect(sheet()).not.toBeNull();
        expect(depth()).toBe(1);
        expect(router.state.location.pathname).toBe('/app');

        fireEvent.click(within(sheet()!).getByRole('button', { name: 'Version history' }));
        expect(await screen.findByRole('heading', { name: 'Version history' })).toBeInTheDocument();
        expect(depth()).toBe(2);
        fireEvent.click(screen.getByRole('button', { name: 'Close version history' }));
        expect(history()).toBeNull();
        expect(sheet()).not.toBeNull();
        await waitFor(() => expect(depth()).toBe(1));

        back();
        expect(sheet()).toBeNull();
        expect(depth()).toBe(0);
        expect(router.state.location.pathname).toBe('/app');
    });

    it('refuses back while a version is loading, like the Close button, and restores the entry', async () => {
        signedIn();
        vi.spyOn(cloudApi, 'listCommits').mockResolvedValue([{ id: 'c1', message: 'Initial save', createdAt: new Date().toISOString() }] as any);
        vi.spyOn(cloudApi, 'getCommit').mockReturnValue(new Promise(() => {}));
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const { depth, back, sheet, history } = mountOnPhone();
        fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
        fireEvent.click(within(sheet()!).getByRole('button', { name: 'Version history' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));
        expect(screen.getByRole('button', { name: 'Close version history' })).toBeDisabled();
        expect(depth()).toBe(2);
        back();
        expect(history()).not.toBeNull();
        expect(sheet()).not.toBeNull();
        await waitFor(() => expect(depth()).toBe(2));
    });

    // The modals a sheet row opens render inside the sheet's DOM, above its backdrop, where the
    // sheet's own trap wraps only at the sheet's edges: without a trap of their own, Tab from a
    // modal's last control would walk on to the sheet rows beneath it. Each takes focus on open,
    // wraps Tab at its own edges and hands focus back to the row that opened it.
    describe('keep keyboard focus inside themselves', () => {
        layOutEveryElement();

        it('Version history: focus lands in the dialog, Tab wraps at its edges, Close returns to the row', async () => {
            signedIn();
            vi.spyOn(cloudApi, 'listCommits').mockResolvedValue([{ id: 'c1', message: 'Initial save', createdAt: new Date().toISOString() }] as any);
            const { sheet } = mountOnPhone();
            openSheet();
            const row = within(sheet()!).getByRole('button', { name: 'Version history' });
            row.focus();
            fireEvent.click(row);
            const dialog = await screen.findByRole('dialog', { name: 'Version history' });
            expect(document.activeElement).toBe(dialog);
            const restore = await screen.findByRole('button', { name: 'Restore' });
            const close = screen.getByRole('button', { name: 'Close version history' });
            expect(fireEvent.keyDown(dialog, { key: 'Tab' })).toBe(false);
            expect(document.activeElement).toBe(close);
            expect(fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })).toBe(false);
            expect(document.activeElement).toBe(restore);
            expect(fireEvent.keyDown(restore, { key: 'Tab' })).toBe(false);
            expect(document.activeElement).toBe(close);
            fireEvent.click(close);
            expect(screen.queryByRole('dialog', { name: 'Version history' })).toBeNull();
            expect(sheet()).not.toBeNull();
            expect(document.activeElement).toBe(row);
        });

        it('Propose changes: focus lands in the dialog, Tab wraps at its edges, Cancel returns to the row', async () => {
            signedIn({ forkedFromProjectId: 'upstream-1' });
            const { sheet } = mountOnPhone();
            openSheet();
            const row = await within(sheet()!).findByRole('button', { name: 'Propose changes to upstream…' });
            row.focus();
            fireEvent.click(row);
            const dialog = screen.getByRole('dialog', { name: 'Propose changes to upstream' });
            expect(document.activeElement).toBe(dialog);
            const close = screen.getByRole('button', { name: 'Close propose changes' });
            const create = screen.getByRole('button', { name: 'Create merge request' });
            expect(fireEvent.keyDown(dialog, { key: 'Tab' })).toBe(false);
            expect(document.activeElement).toBe(close);
            expect(fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })).toBe(false);
            expect(document.activeElement).toBe(create);
            expect(fireEvent.keyDown(create, { key: 'Tab' })).toBe(false);
            expect(document.activeElement).toBe(close);
            fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
            expect(screen.queryByRole('dialog', { name: 'Propose changes to upstream' })).toBeNull();
            expect(sheet()).not.toBeNull();
            expect(document.activeElement).toBe(row);
        });
    });
});
