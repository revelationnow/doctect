import React, { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NormalizedWorkspaceBootstrapGate } from '../../components/workspace/NormalizedWorkspaceBootstrapGate';
import type { WorkspaceBootstrapGateProps } from '../../components/workspace/WorkspaceBootstrapGate';
import type { WorkspaceBootstrapResult, WorkspaceSnapshot } from '../../services/localWorkspace/contracts';
import * as validation from '../../services/localWorkspace/validation';
import { deferred, fakeStore, readyResult, recoveryResult, workspaceRecovery, workspaceSnapshot, type FakeLocalWorkspaceStore } from '../helpers/fakeLocalWorkspaceStore';

const loadGalleryProject = vi.hoisted(() => vi.fn<(galleryId: string) => Promise<{ name: string; state: unknown }>>());
vi.mock('../../services/galleryOpen', async importOriginal => ({
  ...await importOriginal<typeof import('../../services/galleryOpen')>(), loadGalleryProject }));

afterEach(cleanup);
afterEach(() => { loadGalleryProject.mockReset(); vi.restoreAllMocks(); });

it.each(['resolve', 'reject'] as const)('preserves newer authority loss when pending import later %ss', async outcome => {
  const snapshot = workspaceSnapshot();
  snapshot.pendingImports = [{ id: 'pending', targetProjectId: 'imported', name: 'Imported',
    state: snapshot.projects[0].initialState, createdAt: '2026-10-03T12:00:00.000Z', warnings: [] }];
  const pending = deferred<typeof snapshot>();
  const store = fakeStore({ bootstrap: readyResult({ snapshot }), commit: pending.promise });
  render(<NormalizedWorkspaceBootstrapGate store={store} renderEditor={() => <div data-testid="editor">Editor</div>} />);
  await waitFor(() => expect(store.commit).toHaveBeenCalledWith({ type: 'consume-import', importId: 'pending' }));
  const recovery = recoveryResult(workspaceRecovery({ message: 'Newer source must be reviewed.' }));
  await act(async () => {
    store.emitAuthorityLost(recovery);
    if (outcome === 'resolve') pending.resolve(workspaceSnapshot());
    else pending.reject(Error('Older import failed'));
    await pending.promise.catch(() => {});
  });
  fireEvent.click(screen.getByText('Technical details'));
  expect(screen.getByText('Newer source must be reviewed.')).toBeVisible();
  expect(screen.queryByTestId('editor')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
});

it('holds pending imports behind the one-time migration receipt and resumes without bootstrapping again', async () => {
  window.localStorage.clear();
  const snapshot = workspaceSnapshot();
  snapshot.pendingImports = [{ id: 'pending', targetProjectId: 'imported', name: 'Imported',
    state: snapshot.projects[0].initialState, createdAt: '2026-10-03T12:00:00.000Z', warnings: [] }];
  const receipt = { id: 'migration:digest', projectCount: 2, customPresetCount: 1, pendingImportPreserved: true, migratedAt: '2026-10-03T12:00:00.000Z' };
  const store = fakeStore({ bootstrap: readyResult({ snapshot, receipt }), commit: Promise.resolve(workspaceSnapshot()) });
  const view = render(<NormalizedWorkspaceBootstrapGate store={store} renderEditor={() => <div data-testid="editor">Editor</div>} />);
  expect(await screen.findByRole('heading', { name: 'Your projects are ready' })).toBeVisible();
  expect(store.commit).not.toHaveBeenCalled();
  expect(screen.queryByTestId('editor')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Continue to editor' }));
  expect(await screen.findByTestId('editor')).toBeVisible();
  expect(store.commit).toHaveBeenCalledWith({ type: 'consume-import', importId: 'pending' });
  expect(store.bootstrap).toHaveBeenCalledTimes(1);
  view.unmount();

  const again = fakeStore({ bootstrap: readyResult({ snapshot: workspaceSnapshot(), receipt }) });
  render(<NormalizedWorkspaceBootstrapGate store={again} renderEditor={() => <div data-testid="editor">Editor</div>} />);
  expect(await screen.findByTestId('editor')).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Your projects are ready' })).not.toBeInTheDocument();
  window.localStorage.clear();
});

// Gallery Direct Open (spec sections 2 and 3): the gate opens a request behind the loading screen.
const request = { galleryId: 'g1', targetProjectId: 'proj_123e4567-e89b-12d3-a456-426614174000', name: 'Listed' };
const source = { name: 'Listed', state: { schemaVersion: 7 } };
const opened = (): WorkspaceSnapshot => workspaceSnapshot({ activeProjectId: request.targetProjectId,
  projects: [...workspaceSnapshot().projects, { id: request.targetProjectId, name: 'Listed', initialState: {} as never }] });
const pendingImport = (name: string) => ({ id: 'pending', targetProjectId: 'imported', name,
  state: workspaceSnapshot().projects[0].initialState, createdAt: '2026-10-03T12:00:00.000Z', warnings: [] });
const commitBy = (store: FakeLocalWorkspaceStore, handlers: Record<string, () => Promise<WorkspaceSnapshot>>) =>
  store.commit.mockImplementation(async command => {
    const handler = handlers[command.type]; if (!handler) throw Error(`Unexpected ${command.type}`); return handler();
  });
const currentStep = () => screen.getByRole('listitem', { current: 'step' }).textContent;

/** `ready` holds the editor's readiness report, as a real editor holds it until its first frame. */
function Editor({ onReady, ready, active }: { onReady(): void; ready?: Promise<void>; active: string }) {
  useEffect(() => { let live = true; void (ready ?? Promise.resolve()).then(() => { if (live) onReady(); }); return () => { live = false; }; }, []);
  return <div data-testid="editor">{active}</div>;
}
const renderGate = (store: FakeLocalWorkspaceStore, { ready, ...props }: Omit<WorkspaceBootstrapGateProps, 'store' | 'renderEditor'> & { ready?: Promise<void> } = {}) =>
  render(<NormalizedWorkspaceBootstrapGate store={store} {...props}
    renderEditor={mount => <Editor onReady={mount.onReady} ready={ready} active={mount.initialWorkspace.activeProjectId} />} />);

it('opens a request: fetches at once, creates the target, settles, and lifts the overlay once the editor is ready', async () => {
  const bootstrap = deferred<WorkspaceBootstrapResult>(), ready = deferred<void>(), settled = vi.fn();
  const store = fakeStore({ bootstrap: bootstrap.promise });
  loadGalleryProject.mockResolvedValue(source);
  commitBy(store, { 'create-and-activate-project': async () => opened() });
  renderGate(store, { galleryOpen: request, onGalleryOpenSettled: settled, ready: ready.promise });
  expect(loadGalleryProject).toHaveBeenCalledTimes(1);
  expect(loadGalleryProject).toHaveBeenCalledWith('g1');
  expect(screen.getByRole('heading', { name: 'Opening “Listed”' })).toBeVisible();
  await act(async () => { bootstrap.resolve(readyResult()); });
  expect(await screen.findByTestId('editor')).toHaveTextContent(request.targetProjectId);
  expect(store.commit).toHaveBeenCalledWith({ type: 'create-and-activate-project',
    project: { id: request.targetProjectId, name: 'Listed', initialState: source.state } });
  expect(settled).toHaveBeenCalledTimes(1);
  expect(loadGalleryProject).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('heading', { name: 'Opening “Listed”' })).toBeVisible();
  // Spec section 3: the editor is mounted under the screen, hidden from assistive tech and input, but painted.
  const wrapper = screen.getByTestId('editor').parentElement!;
  expect(wrapper).toHaveAttribute('inert');
  expect(wrapper).toHaveAttribute('aria-hidden', 'true');
  expect(wrapper.style.display).not.toBe('none');
  await act(async () => { ready.resolve(); });
  expect(screen.queryByRole('heading', { name: 'Opening “Listed”' })).not.toBeInTheDocument();
  expect(screen.getByTestId('editor')).toBeVisible();
  expect(wrapper).not.toHaveAttribute('inert');
  expect(wrapper).not.toHaveAttribute('aria-hidden');
});

it('advances the steps as the workspace, download, create, and editor each complete', async () => {
  const bootstrap = deferred<WorkspaceBootstrapResult>(), download = deferred<typeof source>(), create = deferred<WorkspaceSnapshot>();
  const store = fakeStore({ bootstrap: bootstrap.promise });
  loadGalleryProject.mockReturnValue(download.promise);
  commitBy(store, { 'create-and-activate-project': () => create.promise });
  renderGate(store, { galleryOpen: request, ready: new Promise(() => {}) });
  expect(currentStep()).toBe('Opening your projects');
  await act(async () => { bootstrap.resolve(readyResult()); });
  await waitFor(() => expect(currentStep()).toBe('Downloading the project'));
  await act(async () => { download.resolve(source); });
  await waitFor(() => expect(currentStep()).toBe('Preparing the project'));
  await act(async () => { create.resolve(opened()); });
  await waitFor(() => expect(currentStep()).toBe('Opening the editor'));
  expect(screen.getByTestId('editor')).toBeInTheDocument();
});

it('consumes pending imports before opening the request', async () => {
  const snapshot = workspaceSnapshot(); snapshot.pendingImports = [pendingImport('Imported')];
  const store = fakeStore({ bootstrap: readyResult({ snapshot }) });
  loadGalleryProject.mockResolvedValue(source);
  commitBy(store, { 'consume-import': async () => workspaceSnapshot(), 'create-and-activate-project': async () => opened() });
  renderGate(store, { galleryOpen: request });
  expect(await screen.findByTestId('editor')).toHaveTextContent(request.targetProjectId);
  expect(store.commit.mock.calls.map(([command]) => command.type)).toEqual(['consume-import', 'create-and-activate-project']);
});

it('shows the failure screen when the download fails, with try again, continue to editor, and back to gallery', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  loadGalleryProject.mockRejectedValue(Error('offline'));
  const store = fakeStore(), settled = vi.fn();
  commitBy(store, { 'create-and-activate-project': async () => opened() });
  const first = renderGate(store, { galleryOpen: request, onGalleryOpenSettled: settled });
  expect(await screen.findByRole('heading', { name: 'Couldn’t open “Listed”' })).toBeVisible();
  expect(store.commit).not.toHaveBeenCalled();
  expect(screen.queryByTestId('editor')).not.toBeInTheDocument();
  expect(settled).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalledWith('Could not open the gallery project:', expect.any(Error));
  loadGalleryProject.mockResolvedValue(source);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByTestId('editor')).toHaveTextContent(request.targetProjectId);
  expect(screen.queryByRole('heading', { name: 'Couldn’t open “Listed”' })).not.toBeInTheDocument();
  expect(settled).toHaveBeenCalledTimes(1);
  first.unmount();

  loadGalleryProject.mockRejectedValue(Error('offline'));
  const second = fakeStore(), continued = vi.fn();
  const view = renderGate(second, { galleryOpen: request, onGalleryOpenSettled: continued });
  await screen.findByRole('heading', { name: 'Couldn’t open “Listed”' });
  fireEvent.click(screen.getByRole('button', { name: 'Continue to editor' }));
  expect(await screen.findByTestId('editor')).toHaveTextContent('project-a');
  expect(continued).toHaveBeenCalledTimes(1);
  expect(second.commit).not.toHaveBeenCalled();
  expect(screen.queryByRole('heading', { name: /^Opening/ })).not.toBeInTheDocument();
  view.unmount();

  const back = vi.fn();
  renderGate(fakeStore(), { galleryOpen: request, onBackToGallery: back });
  fireEvent.click(await screen.findByRole('button', { name: 'Back to gallery' }));
  expect(back).toHaveBeenCalledWith('g1');
});

it('clears a gallery failure on the next attempt: a recovery retry after a failed download opens the project once', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  loadGalleryProject.mockRejectedValueOnce(Error('offline')).mockResolvedValue(source);
  const store = fakeStore();
  commitBy(store, { 'create-and-activate-project': async () => opened() });
  renderGate(store, { galleryOpen: request });
  await screen.findByRole('heading', { name: 'Couldn’t open “Listed”' });
  await act(async () => { store.emitAuthorityLost(recoveryResult(workspaceRecovery({ message: 'Needs review.' }))); });
  expect(screen.queryByRole('heading', { name: 'Couldn’t open “Listed”' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByTestId('editor')).toHaveTextContent(request.targetProjectId);
  expect(screen.queryByRole('heading', { name: 'Couldn’t open “Listed”' })).not.toBeInTheDocument();
  expect(screen.queryByRole('main')).not.toBeInTheDocument();
  expect(store.commit.mock.calls.filter(([command]) => command.type === 'create-and-activate-project')).toHaveLength(1);
});

it('shows the gallery error, not the stale recovery screen, when a recovery retry bootstraps ready and the download fails', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  loadGalleryProject.mockRejectedValue(Error('offline'));
  const store = fakeStore({ bootstrap: [recoveryResult(workspaceRecovery({ message: 'Needs review.' })), readyResult()] });
  renderGate(store, { galleryOpen: request });
  fireEvent.click(await screen.findByText('Technical details'));
  expect(screen.getByText('Needs review.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('heading', { name: 'Couldn’t open “Listed”' })).toBeVisible();
  expect(screen.queryByText('Technical details')).not.toBeInTheDocument();
  expect(store.bootstrap).toHaveBeenCalledTimes(2);
  expect(store.commit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Continue to editor' }));
  expect(await screen.findByTestId('editor')).toHaveTextContent('project-a');
  expect(screen.queryByRole('main')).not.toBeInTheDocument();
});

/** A rejection the spy cannot see: vi.fn attaches its own rejection handler to every Promise a mock returns, so only
 * a plain thenable over one can still be left unhandled by the gate, which is what vitest then reports. */
const unobservedRejection = <T,>(error: Error): Promise<T> => {
  const rejected = Promise.reject<T>(error);
  return { then: rejected.then.bind(rejected), catch: rejected.catch.bind(rejected) } as unknown as Promise<T>;
};

it('activates an existing target without the download, so a failed download is neither an error nor left unhandled', async () => {
  const error = vi.spyOn(console, 'error');
  loadGalleryProject.mockImplementation(() => unobservedRejection(Error('offline')));
  const existing = workspaceSnapshot({ projects: [...workspaceSnapshot().projects, { id: request.targetProjectId, name: 'Listed', initialState: {} as never }] });
  const store = fakeStore({ bootstrap: readyResult({ snapshot: existing }) }), settled = vi.fn();
  commitBy(store, { 'activate-project': async () => opened() });
  renderGate(store, { galleryOpen: request, onGalleryOpenSettled: settled });
  expect(await screen.findByTestId('editor')).toHaveTextContent(request.targetProjectId);
  await waitFor(() => expect(screen.queryByRole('main')).not.toBeInTheDocument());
  expect(store.commit.mock.calls.map(([command]) => command.type)).toEqual(['activate-project']);
  expect(screen.queryByRole('heading', { name: 'Couldn’t open “Listed”' })).not.toBeInTheDocument();
  expect(settled).toHaveBeenCalledTimes(1);
  expect(error).not.toHaveBeenCalled();
});

it('shows the failure screen when the create is refused and preparation has no warnings', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const prepare = vi.spyOn(validation, 'prepareProjectState').mockReturnValue({ state: {} as never, warnings: [] });
  loadGalleryProject.mockResolvedValue(source);
  const store = fakeStore();
  commitBy(store, { 'create-and-activate-project': () => Promise.reject(Error('Refused')) });
  renderGate(store, { galleryOpen: request });
  expect(await screen.findByRole('heading', { name: 'Couldn’t open “Listed”' })).toBeVisible();
  expect(prepare).toHaveBeenCalledWith(source.state, { warningPolicy: 'retain' });
  expect(screen.queryByTestId('editor')).not.toBeInTheDocument();
});

it('shows the recovery screen over a request, never the gallery error or the loading heading', async () => {
  loadGalleryProject.mockResolvedValue(source);
  const store = fakeStore({ bootstrap: recoveryResult(workspaceRecovery({ message: 'Needs review.' })) });
  renderGate(store, { galleryOpen: request });
  fireEvent.click(await screen.findByText('Technical details'));
  expect(screen.getByText('Needs review.')).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Couldn’t open “Listed”' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Opening “Listed”' })).not.toBeInTheDocument();
  expect(screen.queryByTestId('editor')).not.toBeInTheDocument();
});

it('does nothing when the create resolves after unmount', async () => {
  const error = vi.spyOn(console, 'error');
  const create = deferred<WorkspaceSnapshot>(), settled = vi.fn();
  loadGalleryProject.mockResolvedValue(source);
  const store = fakeStore();
  commitBy(store, { 'create-and-activate-project': () => create.promise });
  const view = renderGate(store, { galleryOpen: request, onGalleryOpenSettled: settled });
  await waitFor(() => expect(store.commit).toHaveBeenCalledTimes(1));
  view.unmount();
  await act(async () => { create.resolve(opened()); });
  expect(screen.queryByTestId('editor')).not.toBeInTheDocument();
  expect(error).not.toHaveBeenCalled();
  expect(settled).not.toHaveBeenCalled();
});

it('shows the opening overlay for a pending import, with the pending steps, until the editor is ready', async () => {
  const snapshot = workspaceSnapshot(); snapshot.pendingImports = [pendingImport('Forked')];
  const store = fakeStore({ bootstrap: readyResult({ snapshot }) }), ready = deferred<void>();
  commitBy(store, { 'consume-import': async () => workspaceSnapshot() });
  renderGate(store, { ready: ready.promise });
  expect(await screen.findByRole('heading', { name: 'Opening “Forked”' })).toBeVisible();
  expect(within(screen.getByRole('list')).getAllByRole('listitem').map(item => item.textContent))
    .toEqual(['Opening your projects', 'Preparing the project', 'Opening the editor']);
  expect(await screen.findByTestId('editor')).toBeInTheDocument();
  expect(currentStep()).toBe('Opening the editor');
  const wrapper = screen.getByTestId('editor').parentElement!;
  expect(wrapper).toHaveAttribute('inert');
  expect(wrapper).toHaveAttribute('aria-hidden', 'true');
  await act(async () => { ready.resolve(); });
  expect(screen.queryByRole('heading', { name: 'Opening “Forked”' })).not.toBeInTheDocument();
  expect(wrapper).not.toHaveAttribute('inert');
  expect(wrapper).not.toHaveAttribute('aria-hidden');
  expect(loadGalleryProject).not.toHaveBeenCalled();
});

it('leaves a plain bootstrap unchanged: the phase screen, then the editor with no overlay', async () => {
  const bootstrap = deferred<WorkspaceBootstrapResult>();
  const store = fakeStore({ bootstrap: bootstrap.promise });
  renderGate(store, { ready: new Promise(() => {}) });
  expect(screen.getByRole('heading', { name: 'Opening your projects' })).toBeVisible();
  expect(screen.queryByRole('list')).not.toBeInTheDocument();
  await act(async () => { bootstrap.resolve(readyResult()); });
  expect(await screen.findByTestId('editor')).toBeVisible();
  expect(screen.queryByRole('main')).not.toBeInTheDocument();
  expect(store.commit).not.toHaveBeenCalled();
  expect(loadGalleryProject).not.toHaveBeenCalled();
});
