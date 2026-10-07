import { createBlankProject } from '../presets';
import { createNormalizedWorkspaceStore } from './NormalizedWorkspaceStore';

export const localWorkspaceStore = createNormalizedWorkspaceStore({
  get indexedDB() {
    return window.indexedDB;
  },
  legacyStorage: {
    getItem(key: string) {
      return window.localStorage.getItem(key);
    },
  },
  addStorageListener(listener) {
    window.addEventListener('storage', listener);
    return () => window.removeEventListener('storage', listener);
  },
  get crypto() {
    return globalThis.crypto;
  },
  now: () => new Date().toISOString(),
  randomUUID: () => globalThis.crypto.randomUUID(),
  createBlankProject,
});

export { createLocalWorkspaceStore } from './LocalWorkspaceStore';
export type { LocalWorkspaceEnvironment } from './LocalWorkspaceStore';
export * from './contracts';
