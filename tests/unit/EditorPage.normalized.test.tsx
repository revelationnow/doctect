import React from 'react';
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EditorPage } from '../../pages/EditorPage';
import { createNormalizedAppHarness } from '../helpers/normalizedAppHarness';
import * as snapshots from '../../services/projectDocumentSnapshot';
import * as partition from '../../services/document/partition';
import { localWorkspaceStore } from '../../services/localWorkspace';
import { isNormalizedWorkspaceStore } from '../../services/localWorkspace/NormalizedWorkspaceStore';
import type { WorkspaceBootstrapResult } from '../../services/localWorkspace/contracts';
import * as workspaceAdmission from '../../services/localWorkspace/workspaceCommandAdmission';

vi.mock('../../components/AccountMenu', () => ({ AccountMenu: () => null }));
vi.mock('../../components/cloud/CloudMenu', () => ({ CloudMenu: () => null }));
vi.mock('../../services/analytics', () => ({ trackEvent: vi.fn() }));
let h: Awaited<ReturnType<typeof createNormalizedAppHarness>>;
let authorityLoss: Exclude<WorkspaceBootstrapResult, { status: 'ready' }> | undefined;
beforeEach(async context => {
  authorityLoss = undefined;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ font: '', measureText: (value: string) => ({ width: value.length * 6 }) } as CanvasRenderingContext2D);
  h = await createNormalizedAppHarness();
  render(<RouterProvider router={createMemoryRouter([{ path: '/', element: <EditorPage store={h.store} initialWorkspace={h.ready.snapshot} initialWarnings={[]} /> }])} />);
  fireEvent.click(screen.getByTitle('Layers')); fireEvent.click(screen.getByTestId('element-row-title'));
  await act(async () => { await h.editing.flush(); }); h.messages.length = 0;
  if (context.task.name.startsWith('keeps retry after unavailable')) await h.store.bootstrap({ onAuthorityLost: value => { authorityLoss = value; } });
  if (context.task.name.startsWith('retries a refused')) {
    await h.store.bootstrap({ onAuthorityLost: value => { authorityLoss = value; } });
    h.environment.workspaceFault = point => { if (point.phase === 'after-commit') throw Error('Workspace reply lost'); };
    await act(async () => { await expect(h.editing.commitStructural({ type: 'activate-project', projectId: h.project.id })).rejects.toBeDefined(); });
    h.environment.workspaceFault = undefined;
    h.transformReplies(envelope => envelope.response.type === 'workspace-inspection'
      ? { ...envelope, response: { type: 'failed', code: 'storage-unavailable', outcome: 'not-started', admission: 'none' } } : envelope);
    await act(async () => { await h.editing.retryProject(); });
    expect(h.editing.getSnapshot().blocked).toBe(true);
  }
  if (context.task.name.startsWith('retries after client loss')) {
    h.environment.fault = point => { if (point.phase === 'before-put') throw new DOMException('Abort', 'AbortError'); };
    fireEvent.change(screen.getByPlaceholderText('Text content or {{field}}'), { target: { value: 'Retained through failed installation' } });
    await act(async () => { await h.editing.flush().catch(() => {}); }); h.environment.fault = undefined;
    const create = workspaceAdmission.createWorkspaceCommandAdmission;
    const spy = vi.spyOn(workspaceAdmission, 'createWorkspaceCommandAdmission').mockImplementation(async options => {
      const candidate = await create(options); h.stopCurrentWorker(); return candidate;
    });
    try { await act(async () => { await h.editing.retryProject(); }); } finally { spy.mockRestore(); }
    expect(h.editing.getSnapshot().blocked).toBe(true);
  }
});
afterEach(() => { cleanup(); h?.dispose(); vi.restoreAllMocks(); });

it('the normal application singleton selects the normalized store, not a legacy autosave fallback', () => {
  expect(isNormalizedWorkspaceStore(localWorkspaceStore)).toBe(true);
});

it('normal EditorPage coalesces rapid typing into changed records without full-state snapshots', async () => {
  const snapshot = vi.spyOn(snapshots, 'snapshotDocument'), assemble = vi.spyOn(partition, 'assembleState');
  const input = screen.getByPlaceholderText('Text content or {{field}}');
  for (const value of ['first', 'second', 'latest typed text']) fireEvent.change(input, { target: { value } });
  await act(async () => { await h.editing.flush(); });
  const messages = h.messages.map(value => value.request).flatMap(value => value.type === 'document-batch' ? [{ batch: value.batch }]
    : value.type === 'structural-command' ? [{ batch: value.command.batch }] : []);
  expect(messages, JSON.stringify({ saves: [...h.editing.getSnapshot().saveStates], preferences: [...h.editing.getSnapshot().preferenceStates],
    blocked: h.editing.getSnapshot().blocked, requests: h.messages.map(value => value.request.type) })).toHaveLength(1); expect(messages[0].batch.changes).toHaveLength(1);
  expect(messages[0].batch.changes[0].type).toBe('put-template'); expect(messages[0].batch).not.toHaveProperty('state');
  expect(snapshot).not.toHaveBeenCalled(); expect(assemble).not.toHaveBeenCalled();
  expect(screen.getByText('Saved locally')).toBeVisible();
  expect(h.editing.readProject(h.project.id).initialState.variants.default.templates['page-0'].elements[0].text).toBe('latest typed text');
});

it('automatically saves later typing after an in-flight autosave without an explicit flush', async () => {
  const snapshot = vi.spyOn(snapshots, 'snapshotDocument'), assemble = vi.spyOn(partition, 'assembleState');
  h.holdDocumentReplies(true);
  const input = screen.getByPlaceholderText('Text content or {{field}}');
  fireEvent.change(input, { target: { value: 'First automatic save' } });
  // Real debounce and actual worker commit; hold only its genuine reply.
  await waitFor(() => expect(h.held).toHaveLength(1), { timeout: 2000 });
  fireEvent.change(input, { target: { value: 'Typing continued while saving' } });
  expect(input).toHaveValue('Typing continued while saving');
  expect(h.editing.getSnapshot().hasUnsavedWork).toBe(true);
  await act(async () => { h.holdDocumentReplies(false); h.releaseDocumentReply(); });
  expect(h.editing.getSnapshot().hasUnsavedWork).toBe(true);
  await waitFor(() => expect(screen.getByText('Saved locally')).toBeVisible(), { timeout: 2000 });
  const documentRequests = h.messages.filter(row => row.request.type === 'document-batch' || row.request.type === 'structural-command');
  expect(documentRequests).toHaveLength(2);
  expect(snapshot).not.toHaveBeenCalled(); expect(assemble).not.toHaveBeenCalled();
  const durable = (await h.exportActive()).projects.find(project => project.id === h.project.id)!;
  expect(durable.initialState.variants.default.templates['page-0'].elements[0].text).toBe('Typing continued while saving');
});

it('preference-only navigation autosaves without document writes or an unsaved-document prompt', async () => {
  const snapshot = vi.spyOn(snapshots, 'snapshotDocument'), assemble = vi.spyOn(partition, 'assembleState');
  fireEvent.click(screen.getByRole('button', { name: 'Templates' }));
  fireEvent.click(screen.getByRole('button', { name: 'Hierarchy' }));
  expect(h.editing.getSnapshot().hasUnsavedWork).toBe(false);
  const unloading = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unloading); expect(unloading.defaultPrevented).toBe(false);
  await waitFor(() => expect(h.messages.some(row => row.request.type === 'preferences')).toBe(true), { timeout: 2000 });
  await act(async () => { await h.editing.flush(); });
  expect(h.messages.some(row => row.request.type === 'document-batch' || row.request.type === 'structural-command')).toBe(false);
  expect(snapshot).not.toHaveBeenCalled(); expect(assemble).not.toHaveBeenCalled();
  expect(h.editing.getSnapshot().hasUnsavedWork).toBe(false);
});

it('normal JSON replacement uses the progress-capable bulk path and preserves subsequent typing', async () => {
  fireEvent.click(screen.getByRole('button', { name: 'JSON' })); fireEvent.click(screen.getByRole('button', { name: 'Text' }));
  const input = screen.getByText('Project JSON Editor').closest('.max-w-5xl')!.querySelector('textarea')!;
  const state = JSON.parse(input.value); state.nodes.root.title = 'Normal bulk replacement';
  fireEvent.change(input, { target: { value: JSON.stringify(state) } }); fireEvent.click(screen.getByRole('button', { name: 'Apply Changes' }));
  await act(async () => { await h.editing.flush(); });
  expect(h.messages.some(row => row.request.type === 'normalization-replace')).toBe(true);
  expect(screen.getByText('Saved locally')).toBeVisible();
});

it('typing during an in-flight autosave stays local and unsaved until its own acknowledgement', async () => {
  h.holdDocumentReplies(true); const input = screen.getByPlaceholderText('Text content or {{field}}');
  fireEvent.change(input, { target: { value: 'first edit' } });
  let first!: Promise<void>; act(() => { first = h.editing.flush(); });
  await waitFor(() => expect(h.held).toHaveLength(1));
  fireEvent.change(input, { target: { value: 'later edit while saving' } });
  expect(input).toHaveValue('later edit while saving'); expect(screen.getByText('Saving locally…')).toBeVisible();
  await act(async () => { h.releaseDocumentReply(); await first; });
  let second!: Promise<void>; act(() => { second = h.editing.flush(); });
  await waitFor(() => expect(h.held).toHaveLength(1));
  expect(screen.getByText('Saving locally…')).toBeVisible();
  await act(async () => { h.releaseDocumentReply(); await second; });
  expect(screen.getByText('Saved locally')).toBeVisible();
  expect(h.messages.filter(row => row.request.type === 'document-batch' || row.request.type === 'structural-command')).toHaveLength(2);
  h.holdDocumentReplies(false);
  fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
  expect(screen.getByPlaceholderText('Text content or {{field}}')).toHaveValue('first edit'); await act(async () => { await h.editing.flush(); });
});

it('successful retry keeps later cloud metadata in the current working export', async () => {
  h.environment.fault = point => { if (point.phase === 'before-put') throw new DOMException('Abort', 'AbortError'); };
  fireEvent.change(screen.getByPlaceholderText('Text content or {{field}}'), { target: { value: 'Retained edit' } });
  await act(async () => { await h.editing.flush().catch(() => {}); });
  h.environment.fault = undefined;
  await act(async () => { await h.editing.retryProject(); });
  expect(h.editing.getSnapshot().blocked).toBe(false);
  const cloud = { projectId: 'cloud-current', lastSyncedCommitId: 'head-current' };
  await act(async () => { expect(await h.editing.updateProject(h.project.id, project => ({ ...project, cloud }))).toBe(true); });
  expect(h.editing.readProject(h.project.id).cloud).toEqual(cloud);
});

it('retries a proven rollback on the live worker without reopening payloads and retains Undo/Redo', async () => {
  const workers = h.workerCount(), source = h.editing.bindingFor(h.project.id).source;
  const input = screen.getByPlaceholderText('Text content or {{field}}') as HTMLTextAreaElement, before = input.value;
  h.environment.fault = point => { if (point.phase === 'before-put') throw new DOMException('Abort', 'AbortError'); };
  fireEvent.change(input, { target: { value: 'Confirmed rollback retry' } });
  await act(async () => { await h.editing.flush().catch(() => {}); }); h.environment.fault = undefined;
  expect(screen.queryByText('Saved locally')).not.toBeInTheDocument();
  h.messages.length = 0;
  await act(async () => { await Promise.all([h.editing.retryProject(), h.editing.retryProject()]); });
  expect(h.workerCount()).toBe(workers);
  expect(h.messages.filter(row => row.request.type === 'workspace-resume-aborted')).toHaveLength(1);
  expect(h.messages.some(row => ['normalization-open', 'workspace-bootstrap', 'open-project'].includes(row.request.type))).toBe(false);
  expect(h.editing.bindingFor(h.project.id).source).toBe(source);
  expect(screen.getByText('Saved locally')).toBeVisible(); expect(input).toHaveValue('Confirmed rollback retry');
  fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)')); await act(async () => { await h.editing.flush(); });
  expect(screen.getByPlaceholderText('Text content or {{field}}')).toHaveValue(before);
  fireEvent.click(screen.getByTitle('Redo (Ctrl+Y)')); await act(async () => { await h.editing.flush(); });
  expect(screen.getByPlaceholderText('Text content or {{field}}')).toHaveValue('Confirmed rollback retry');
  const durable = (await h.exportActive()).projects.find(project => project.id === h.project.id)!;
  expect(durable.initialState.variants.default.templates['page-0'].elements[0].text).toBe('Confirmed rollback retry');
});

it('keeps full readmission after a post-commit failure instead of classifying it as rollback', async () => {
  const workers = h.workerCount();
  h.environment.fault = point => { if (point.phase === 'after-commit') throw new DOMException('Lost reply', 'AbortError'); };
  fireEvent.change(screen.getByPlaceholderText('Text content or {{field}}'), { target: { value: 'Committed but not acknowledged' } });
  await act(async () => { await h.editing.flush().catch(() => {}); }); h.environment.fault = undefined;
  h.messages.length = 0;
  await act(async () => { await h.editing.retryProject(); });
  expect(h.workerCount()).toBe(workers + 1);
  expect(h.messages.some(row => row.request.type === 'normalization-step' && row.request.operation === 'editor')).toBe(true);
  expect(screen.getByText('Saved locally')).toBeVisible();
  expect(screen.getByPlaceholderText('Text content or {{field}}')).toHaveValue('Committed but not acknowledged');
});

it('installs rollback authority metadata one member at a time without argument spreading', async () => {
  const other = { ...h.project, id: 'second-editor-project', name: 'Second editor' };
  await act(async () => { await h.editing.commitStructural({ type: 'create-and-activate-project', project: other }); });
  await act(async () => { await h.editing.commitStructural({ type: 'activate-project', projectId: h.project.id }); });
  h.environment.fault = point => { if (point.phase === 'before-put') throw new DOMException('Abort', 'AbortError'); };
  fireEvent.change(screen.getByPlaceholderText('Text content or {{field}}'), { target: { value: 'Two-member retry' } });
  await act(async () => { await h.editing.flush().catch(() => {}); }); h.environment.fault = undefined;
  const original = Array.prototype.push; let bulkPushes = 0;
  Array.prototype.push = function (...values) {
    if (values.length > 1 && values.every(value => value?.scope && value?.authority && !value.type)) bulkPushes++;
    return original.apply(this, values);
  };
  try { await act(async () => { await h.editing.retryProject(); }); } finally { Array.prototype.push = original; }
  expect(bulkPushes).toBe(0); expect(screen.getByText('Saved locally')).toBeVisible();
});

it('retains working text and recovery custody when the explicit rollback replay fails again', async () => {
  h.environment.fault = point => { if (point.phase === 'before-put') throw new DOMException('Abort', 'AbortError'); };
  fireEvent.change(screen.getByPlaceholderText('Text content or {{field}}'), { target: { value: 'Retained after second abort' } });
  await act(async () => { await h.editing.flush().catch(() => {}); });
  await act(async () => { await h.editing.retryProject(); });
  expect(h.editing.getSnapshot().blocked).toBe(true);
  expect(screen.getByPlaceholderText('Text content or {{field}}')).toHaveValue('Retained after second abort');
  expect(screen.queryByText('Saved locally')).not.toBeInTheDocument();
  h.environment.fault = undefined;
  await act(async () => { await h.editing.retryProject(); });
  expect(h.editing.getSnapshot().blocked).toBe(false); expect(screen.getByText('Saved locally')).toBeVisible();
});

it.each(['worker-loss', 'legacy-change'] as const)('blocks rollback publication on %s after capability rotation', async kind => {
  h.environment.fault = point => { if (point.phase === 'before-put') throw new DOMException('Abort', 'AbortError'); };
  fireEvent.change(screen.getByPlaceholderText('Text content or {{field}}'), { target: { value: 'Keep unacknowledged local text' } });
  await act(async () => { await h.editing.flush().catch(() => {}); }); h.environment.fault = undefined;
  h.messages.length = 0; let interrupted = false;
  h.transformReplies(envelope => {
    if (envelope.response.type === 'workspace-resumed' && !interrupted) {
      interrupted = true;
      if (kind === 'worker-loss') h.stopCurrentWorker(); else h.signalLegacyChange();
    }
    return envelope;
  });
  await act(async () => { await h.editing.retryProject(); });
  expect(interrupted).toBe(true); expect(h.editing.getSnapshot().blocked).toBe(true);
  expect(screen.getByPlaceholderText('Text content or {{field}}')).toHaveValue('Keep unacknowledged local text');
  expect(screen.queryByText('Saved locally')).not.toBeInTheDocument();
  expect(h.messages.some(row => row.request.type === 'document-batch' || row.request.type === 'structural-command')).toBe(false);
});

it('retries a refused readmission using the original matching queue and workspace checkpoint', async () => {
  expect(authorityLoss).toMatchObject({ status: 'recovery', recovery: { canRetry: true, canRecoverLegacyAsCopies: false } });
  h.transformReplies(value => value);
  await act(async () => { await h.editing.retryProject(); });
  expect(h.editing.getSnapshot().blocked).toBe(false);
  fireEvent.change(screen.getByPlaceholderText('Text content or {{field}}'), { target: { value: 'After second retry' } });
  await act(async () => { await h.editing.flush(); });
  expect(screen.getByText('Saved locally')).toBeVisible();
});

it('coalesces concurrent retry clicks without terminating either startup worker', async () => {
  const workers = h.workerCount();
  await act(async () => {
    h.editing.pause();
    await Promise.all([h.editing.retryProject(), h.editing.retryProject()]);
  });
  expect(h.workerCount()).toBe(workers + 1);
  expect(h.editing.getSnapshot().blocked).toBe(false);
  fireEvent.change(screen.getByPlaceholderText('Text content or {{field}}'), { target: { value: 'After concurrent retry' } });
  await act(async () => { await h.editing.flush(); });
  expect(screen.getByText('Saved locally')).toBeVisible();
});

it('keeps retry after unavailable prerequisite result without losing the live editor', async () => {
  const open = vi.spyOn(h.indexedDB, 'open').mockImplementation(() => { throw new DOMException('Temporarily unavailable', 'InvalidStateError'); });
  try {
    await act(async () => { await h.editing.retryProject(); });
    expect(authorityLoss).toMatchObject({ status: 'recovery', recovery: { canRetry: true, canRecoverLegacyAsCopies: false } });
  } finally { open.mockRestore(); }
  await act(async () => { await h.editing.retryProject(); });
  expect(h.editing.getSnapshot().blocked).toBe(false);
  expect(screen.getByPlaceholderText('Text content or {{field}}')).toBeVisible();
});

it('retries after client loss between successor construction and adoption without losing recovery custody', async () => {
  await act(async () => { await h.editing.retryProject(); });
  expect(h.editing.getSnapshot().blocked).toBe(false);
  expect(screen.getByPlaceholderText('Text content or {{field}}')).toHaveValue('Retained through failed installation');
  expect(screen.getByText('Saved locally')).toBeVisible();
});
