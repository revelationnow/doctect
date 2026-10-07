import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { NormalizedWorkspaceBootstrapGate } from '../../components/workspace/NormalizedWorkspaceBootstrapGate';
import { deferred, fakeStore, readyResult, recoveryResult, workspaceRecovery, workspaceSnapshot } from '../helpers/fakeLocalWorkspaceStore';

afterEach(cleanup);

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
