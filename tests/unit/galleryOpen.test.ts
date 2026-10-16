import { describe, expect, it, vi } from 'vitest';
import { openGalleryProjectInEditor, readGalleryOpenRequest } from '../../services/galleryOpen';

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
