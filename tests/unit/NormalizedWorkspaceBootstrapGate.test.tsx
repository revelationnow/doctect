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
