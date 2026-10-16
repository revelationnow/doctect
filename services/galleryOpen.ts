import type { NavigateFunction } from 'react-router-dom';

/** Gallery Direct Open: what "Open in editor" hands the /app route in history state. */
export interface GalleryOpenRequest { galleryId: string; targetProjectId: string; name: string }

const TARGET_ID = /^proj_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Navigate at once; the editor's bootstrap gate fetches and creates the project behind its loading screen. */
export function openGalleryProjectInEditor(navigate: NavigateFunction, listing: { id: string; name: string }): void {
  const galleryOpen: GalleryOpenRequest = { galleryId: listing.id, targetProjectId: `proj_${crypto.randomUUID()}`, name: listing.name };
  navigate('/app', { state: { galleryOpen } });
}

export function readGalleryOpenRequest(state: unknown): GalleryOpenRequest | undefined {
  const value = typeof state === 'object' && state !== null ? (state as { galleryOpen?: unknown }).galleryOpen : undefined;
  if (typeof value !== 'object' || value === null) return undefined;
  const { galleryId, targetProjectId, name } = value as Record<string, unknown>;
  return typeof galleryId === 'string' && galleryId.length > 0 && typeof targetProjectId === 'string' && TARGET_ID.test(targetProjectId)
    && typeof name === 'string' ? { galleryId, targetProjectId, name } : undefined;
}
