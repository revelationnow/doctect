import { expect, vi } from 'vitest';
import { createIncrementalStoreHarness } from './incrementalStoreHarness';
import type { WorkspaceProject } from '../../services/localWorkspace/contracts';
import type { WorkspaceWorkerPort } from '../../services/localWorkspace/workspaceWorkerClient';
import type { WorkspaceWorkerRequestEnvelope, WorkspaceWorkerResponseEnvelope } from '../../services/localWorkspace/workspaceWorkerProtocol';

// Glob permits a missing-interface assertion in the initial RED, not a loader error.
const clients = import.meta.glob<typeof import('../../services/localWorkspace/workspaceWorkerClient')>('../../services/localWorkspace/workspaceWorkerClient.ts');
const handlers = import.meta.glob<typeof import('../../services/localWorkspace/normalized/coordinator')>('../../services/localWorkspace/normalized/coordinator.ts');
export async function workerModules() {
  expect(Object.keys(clients), 'real worker client module').toHaveLength(1);
  expect(Object.keys(handlers), 'shared worker coordinator module').toHaveLength(1);
  return { ...await Object.values(clients)[0](), ...await Object.values(handlers)[0]() };
}

export async function createIncrementalWorkerHarness(project?: WorkspaceProject) {
  const modules = await workerModules();
  const store = await createIncrementalStoreHarness(project);
  const messages: WorkspaceWorkerRequestEnvelope[] = [];
  const responses: WorkspaceWorkerResponseEnvelope[] = [];
  const workers: ReturnType<typeof makePort>[] = [];
  function makePort() {
    const handler = modules.createWorkspaceWorkerHandler(store.environment);
    const listeners = new Map<string, Set<(event: any) => void>>();
    let stopped = false;
    const emit = (type: string, event: unknown) => { for (const listener of listeners.get(type) ?? []) listener(event); };
    const control = { hold: false, dropResponses: false,
      transform: (response: WorkspaceWorkerResponseEnvelope) => response,
      handler, listeners, emit,
      port: {
        postMessage(message: WorkspaceWorkerRequestEnvelope) {
          if (stopped) throw new Error('terminated');
          const captured = structuredClone(message); messages.push(captured);
          if (control.hold) return;
          void handler.handle(captured).then(response => {
            responses.push(structuredClone(response));
            if (!stopped && !control.dropResponses) emit('message', { data: structuredClone(control.transform(response)) });
          }, error => { if (!stopped) emit('error', { error }); });
        },
        addEventListener(type: string, listener: (event: any) => void) {
          const set = listeners.get(type) ?? new Set(); set.add(listener); listeners.set(type, set);
        },
        removeEventListener(type: string, listener: (event: any) => void) { listeners.get(type)?.delete(listener); },
        terminate: vi.fn(() => { stopped = true; handler.dispose(); }),
      } satisfies WorkspaceWorkerPort,
    };
    return control;
  }
  const factory = vi.fn(() => { const worker = makePort(); workers.push(worker); return worker.port; });
  const client = modules.createWorkspaceWorkerClient(factory);
  const bootstrap = await client.request({ type: 'bootstrap', project: store.initial });
  if (bootstrap.type !== 'bootstrapped') throw new Error(`bootstrap failed: ${bootstrap.type}`);
  let revision = bootstrap.authority.documentRevision;
  return { ...store, ...modules, client, factory, workers, messages, responses, admissionId: bootstrap.admissionId,
    get documentMessages() { return messages.map(m => m.request).filter(r => r.type === 'document-batch'); },
    async saveNodeTitle(title: string) {
      const response = await client.request({ type: 'document-batch', admissionId: bootstrap.admissionId, batch: {
        scope: store.scope, clientId: 'worker-title', commitId: `title-${revision + 1}`,
        commitGeneration: revision + 1, editorGeneration: revision + 1, expectedRevision: revision,
        changes: [{ type: 'put-node', node: { ...store.initial.projectNodes.values().next().value!.value, title } }],
      } });
      if (response.type !== 'document-result') throw new Error(`save failed: ${response.type}`);
      revision = response.ack.revision; return response;
    },
  };
}
