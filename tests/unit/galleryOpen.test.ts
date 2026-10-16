import { describe, expect, it, vi } from 'vitest';
import * as validation from '../../services/localWorkspace/validation';
import { fakeStore, workspaceSnapshot } from '../helpers/fakeLocalWorkspaceStore';
import { openGalleryProjectInEditor, openGalleryRequest, readGalleryOpenRequest } from '../../services/galleryOpen';

describe('gallery open request', () => {
  it('navigates to /app at once with a fresh target project id', () => {
    const navigate = vi.fn();
    openGalleryProjectInEditor(navigate, { id: 'g1', name: '2026 Planner' });
    expect(navigate).toHaveBeenCalledTimes(1);
    const [path, options] = navigate.mock.calls[0];
    expect(path).toBe('/app');
    expect(options.state.galleryOpen).toEqual({ galleryId: 'g1', name: '2026 Planner', targetProjectId: expect.stringMatching(/^proj_[0-9a-f-]{36}$/) });
    openGalleryProjectInEditor(navigate, { id: 'g1', name: '2026 Planner' });
    expect(navigate.mock.calls[1][1].state.galleryOpen.targetProjectId).not.toBe(options.state.galleryOpen.targetProjectId);
  });

  it('reads only a well-formed request', () => {
    const request = { galleryId: 'g1', targetProjectId: 'proj_123e4567-e89b-12d3-a456-426614174000', name: 'P' };
    expect(readGalleryOpenRequest({ galleryOpen: request })).toEqual(request);
    for (const state of [null, undefined, 'x', {}, { galleryOpen: null }, { galleryOpen: { ...request, galleryId: '' } },
      { galleryOpen: { ...request, targetProjectId: 'other' } }, { galleryOpen: { ...request, name: 3 } }])
      expect(readGalleryOpenRequest(state)).toBeUndefined();
  });
});

const request = { galleryId: 'g1', targetProjectId: 'proj_123e4567-e89b-12d3-a456-426614174000', name: 'Listed' };
const source = { name: 'Server Name', state: { schemaVersion: 7 } };

describe('openGalleryRequest', () => {
  it('creates and activates the project from the downloaded state, reporting progress', async () => {
    const created = workspaceSnapshot({ activeProjectId: request.targetProjectId });
    const store = fakeStore({ commit: created });
    const steps: string[] = [];
    const result = await openGalleryRequest(store, workspaceSnapshot(), request, Promise.resolve(source), step => steps.push(step));
    expect(store.commit).toHaveBeenCalledTimes(1);
    expect(store.commit).toHaveBeenCalledWith({ type: 'create-and-activate-project',
      project: { id: request.targetProjectId, name: 'Server Name', initialState: source.state } });
    expect(result).toEqual({ snapshot: created, warnings: [] });
    expect(steps).toEqual(['download', 'prepare']);
  });

  it('activates an existing target without creating, and does nothing when it is already active', async () => {
    const existing = workspaceSnapshot({ projects: [...workspaceSnapshot().projects, { id: request.targetProjectId, name: 'Listed', initialState: {} as never }] });
    const store = fakeStore();
    const download = Promise.reject(new Error('ignored')); download.catch(() => {});
    await openGalleryRequest(store, existing, request, download, () => {});
    expect(store.commit).toHaveBeenCalledWith({ type: 'activate-project', projectId: request.targetProjectId });
    store.commit.mockClear();
    const active = { ...existing, activeProjectId: request.targetProjectId };
    expect((await openGalleryRequest(store, active, request, download, () => {})).snapshot).toBe(active);
    expect(store.commit).not.toHaveBeenCalled();
  });

  it('retries once with the prepared state when the loader has warnings, and returns them', async () => {
    const store = fakeStore();
    store.commit.mockRejectedValueOnce(new Error('Dropped an invalid element.'));
    const prepared = { state: { schemaVersion: 13 } as never, warnings: ['Dropped an invalid element.'] };
    const prepare = vi.spyOn(validation, 'prepareProjectState').mockReturnValue(prepared);
    try {
      const result = await openGalleryRequest(store, workspaceSnapshot(), request, Promise.resolve(source), () => {});
      expect(prepare).toHaveBeenCalledWith(source.state, { warningPolicy: 'retain' });
      expect(store.commit).toHaveBeenLastCalledWith({ type: 'create-and-activate-project',
        project: { id: request.targetProjectId, name: 'Server Name', initialState: prepared.state } });
      expect(result.warnings).toEqual(prepared.warnings);
    } finally { prepare.mockRestore(); }
  });

  it('reports the original refusal when preparation has no warnings or throws', async () => {
    for (const outcome of [{ state: {} as never, warnings: [] }, new Error('invalid')]) {
      const store = fakeStore();
      const refusal = new Error('Workspace authority changed');
      store.commit.mockRejectedValueOnce(refusal);
      const prepare = vi.spyOn(validation, 'prepareProjectState').mockImplementation(() => { if (outcome instanceof Error) throw outcome; return outcome; });
      try {
        await expect(openGalleryRequest(store, workspaceSnapshot(), request, Promise.resolve(source), () => {})).rejects.toBe(refusal);
        expect(store.commit).toHaveBeenCalledTimes(1);
      } finally { prepare.mockRestore(); }
    }
  });

  it('propagates a download failure without committing', async () => {
    const store = fakeStore();
    await expect(openGalleryRequest(store, workspaceSnapshot(), request, Promise.reject(new Error('offline')), () => {})).rejects.toThrow('offline');
    expect(store.commit).not.toHaveBeenCalled();
  });
});
