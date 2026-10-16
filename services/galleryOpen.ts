import type { NavigateFunction } from 'react-router-dom';
import { cloudApi } from './cloudApi';
import type { LocalWorkspaceStore, WorkspaceProject, WorkspaceSnapshot } from './localWorkspace/contracts';
import * as validation from './localWorkspace/validation';

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

export type GalleryOpenProgress = 'download' | 'prepare';

export function loadGalleryProject(galleryId: string): Promise<{ name: string; state: unknown }> {
  return cloudApi.galleryState(galleryId);
}

/** Gallery Direct Open, spec step 2: an existing target is only activated (a reload repeats the request), otherwise
 * the downloaded state is created directly. A refusal is retried once with the prepared state when the loader has
 * warnings, which staging kept and showed; any other refusal is reported as it was. */
export async function openGalleryRequest(store: Pick<LocalWorkspaceStore, 'commit'>, snapshot: WorkspaceSnapshot,
  request: GalleryOpenRequest, download: Promise<{ name: string; state: unknown }>,
  onProgress: (step: GalleryOpenProgress) => void): Promise<{ snapshot: WorkspaceSnapshot; warnings: string[] }> {
  if (snapshot.projects.some(project => project.id === request.targetProjectId)) {
    return { snapshot: snapshot.activeProjectId === request.targetProjectId ? snapshot
      : await store.commit({ type: 'activate-project', projectId: request.targetProjectId }), warnings: [] };
  }
  onProgress('download');
  const source = await download;
  onProgress('prepare');
  const create = (initialState: unknown) => store.commit({ type: 'create-and-activate-project',
    project: { id: request.targetProjectId, name: source.name, initialState: initialState as WorkspaceProject['initialState'] } });
  try { return { snapshot: await create(source.state), warnings: [] }; }
  catch (refusal) {
    let prepared: { state: unknown; warnings: string[] };
    try { prepared = validation.prepareProjectState(source.state, { warningPolicy: 'retain' }); } catch { throw refusal; }
    if (prepared.warnings.length === 0) throw refusal;
    return { snapshot: await create(prepared.state), warnings: prepared.warnings };
  }
}
