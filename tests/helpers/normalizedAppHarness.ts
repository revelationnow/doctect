import { createNormalizationHarness } from './normalizationHarness';
import { makeIncrementalProject } from './incrementalFixtures';
import { LEGACY_KEYS } from './localWorkspaceFixtures';
import { createNormalizedWorkspaceStore, getNormalizedWorkspaceSession } from '../../services/localWorkspace/NormalizedWorkspaceStore';
import { createWorkspaceWorkerHandler } from '../../services/localWorkspace/normalized/coordinator';
import type { WorkspaceWorkerPort } from '../../services/localWorkspace/workspaceWorkerClient';
import type { WorkspaceWorkerRequestEnvelope } from '../../services/localWorkspace/workspaceWorkerProtocol';

export async function createNormalizedAppHarness() {
  const project = makeIncrementalProject(2);
  const h = await createNormalizationHarness({ legacyValues: { [LEGACY_KEYS.projects]: JSON.stringify([project]), [LEGACY_KEYS.activeProject]: project.id } });
  let uuid = 0, holdDocuments = false;
  let transform = (value: any) => value;
  let stopCurrentWorker = () => {};
  let legacyListener: ((event: StorageEvent) => void) | undefined;
  const messages: WorkspaceWorkerRequestEnvelope[] = [], held: (() => void)[] = [], handlers: ReturnType<typeof createWorkspaceWorkerHandler>[] = [];
  const workerFactory = (): WorkspaceWorkerPort => {
    const handler = createWorkspaceWorkerHandler(h.environment); handlers.push(handler);
    const listeners = new Map<string, Set<(event: any) => void>>(); let stopped = false;
    stopCurrentWorker = () => { for (const fn of listeners.get('error') ?? []) fn({ message: 'Injected worker loss' }); };
    return { postMessage(input) {
      const captured = structuredClone(input); messages.push(captured);
      void handler.handle(captured).then(data => {
        const send = () => { if (!stopped) for (const fn of listeners.get('message') ?? []) fn({ data: transform(structuredClone(data)) }); };
        if (holdDocuments && (data.response.type === 'document-result' || data.response.type === 'structural-result')) held.push(send); else send();
      }, error => { if (!stopped) for (const fn of listeners.get('error') ?? []) fn({ error }); });
    }, addEventListener(type, fn) { const set = listeners.get(type) ?? new Set(); set.add(fn); listeners.set(type, set); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); }, terminate() { stopped = true; handler.dispose(); } };
  };
  const store = createNormalizedWorkspaceStore({ ...h.preparation, indexedDB: h.indexedDB, randomUUID: () => `app-${++uuid}`,
    legacyStorage: h.legacyStorage, addStorageListener: listener => { legacyListener = listener; return () => { legacyListener = undefined; }; } }, { workerFactory });
  const ready = await store.bootstrap(); if (ready.status !== 'ready') throw Error(JSON.stringify(ready));
  return { ...h, project, store, ready, editing: getNormalizedWorkspaceSession(store)!, messages, held,
    workerCount: () => handlers.length,
    stopCurrentWorker: () => stopCurrentWorker(),
    signalLegacyChange: () => legacyListener?.({ key: LEGACY_KEYS.projects } as StorageEvent),
    holdDocumentReplies(value: boolean) { holdDocuments = value; }, releaseDocumentReply() { held.shift()?.(); },
    transformReplies(value: typeof transform) { transform = value; },
    dispose() { store.dispose(); handlers.forEach(handler => handler.dispose()); h.adapter.close(); } };
}
