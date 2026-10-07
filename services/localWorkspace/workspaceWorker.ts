import { createWorkspaceWorkerHandler } from './normalized/coordinator';
import { WORKSPACE_DB_NAME } from './schema';
import { createBlankProject } from '../presets';

const handler = createWorkspaceWorkerHandler({
  indexedDB: self.indexedDB,
  databaseName: WORKSPACE_DB_NAME,
  // Nothing renders on this thread; one task yield per 1024-visit quantum spent
  // much of a large project create waiting on its own wakeups.
  yieldSliceMs: 8,
  now: () => new Date().toISOString(),
  normalization: { crypto: self.crypto, now: () => new Date().toISOString(), randomUUID: () => self.crypto.randomUUID(), createBlankProject },
  async hash(input) {
    const digest = await self.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  },
});
self.addEventListener('message', event => {
  void handler.handle(event.data).then(response => self.postMessage(response), () => {
    // An uncorrelatable request is a transport fault, never an invented response.
    setTimeout(() => { throw new Error('Workspace worker protocol failure'); }, 0);
  });
});
