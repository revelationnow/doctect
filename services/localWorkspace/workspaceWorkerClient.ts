import { describeRequest, frameFields, counter, validateResponse, type ExpectedWorkerResponse,
  type WorkspaceWorkerRequest, type WorkspaceWorkerRequestEnvelope, type WorkspaceWorkerResponse } from './workspaceWorkerProtocol';

export interface WorkspaceWorkerPort {
  postMessage(message: WorkspaceWorkerRequestEnvelope): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  addEventListener(type: 'messageerror', listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  removeEventListener(type: 'messageerror', listener: (event: MessageEvent<unknown>) => void): void;
  terminate(): void;
}
export type WorkspaceWorkerFactory = () => WorkspaceWorkerPort;
export interface WorkspaceWorkerClient { request(request: WorkspaceWorkerRequest): Promise<WorkspaceWorkerResponse>; dispose(): void }
export type WorkspaceWorkerErrorCode = 'invalid-request' | 'worker-start-failed' | 'worker-error' | 'message-error' | 'protocol-error'
  | 'timeout' | 'post-failed' | 'disposed' | 'client-failed' | 'counter-exhausted';
export class WorkspaceWorkerError extends Error {
  constructor(readonly code: WorkspaceWorkerErrorCode, readonly requestId: number | null, readonly outcome: 'not-posted' | 'unknown') {
    super(code); this.name = 'WorkspaceWorkerError';
  }
}
let nextRequest = 0; let nextEpoch = 0;
const clientLiveness = new WeakMap<WorkspaceWorkerClient, (admissionId?: number) => boolean>();
const clientInvalidation = new WeakMap<WorkspaceWorkerClient, (listener: () => void) => () => void>();
export const isWorkspaceWorkerClientLive = (client: WorkspaceWorkerClient, admissionId?: number): boolean => clientLiveness.get(client)?.(admissionId) === true;
export function observeWorkspaceWorkerClientInvalidation(client: WorkspaceWorkerClient, listener: () => void): () => void {
  const observe = clientInvalidation.get(client); if (!observe) throw Error('Unknown workspace client'); return observe(listener);
}
interface Pending { expected: ExpectedWorkerResponse; resolve(value: WorkspaceWorkerResponse): void; reject(error: WorkspaceWorkerError): void;
  timer: ReturnType<typeof setTimeout>; posted: boolean }
const defaultFactory: WorkspaceWorkerFactory = () => new Worker(new URL('./workspaceWorker.ts', import.meta.url), { type: 'module' });

export function createWorkspaceWorkerClient(factory: WorkspaceWorkerFactory = defaultFactory): WorkspaceWorkerClient {
  const pending = new Map<number, Pending>();
  let worker: WorkspaceWorkerPort | undefined; let epoch: number | undefined;
  let state: 'idle' | 'running' | 'failed' | 'disposed' = 'idle';
  let editingAdmission: number | undefined;
  const invalidationListeners = new Set<() => void>();
  const invalidateEditing = (next?: number) => {
    editingAdmission = next;
    const listeners = [...invalidationListeners];
    for (const listener of listeners) invalidationListeners.delete(listener);
    for (const listener of listeners) try { listener(); } catch { /* Cleanup cannot change transport outcome. */ }
  };
  function stop(code: WorkspaceWorkerErrorCode) {
    if (state === 'disposed' || state === 'failed') return;
    state = code === 'disposed' ? 'disposed' : 'failed';
    invalidateEditing();
    for (const [id, p] of pending) {
      clearTimeout(p.timer); pending.delete(id);
      p.reject(new WorkspaceWorkerError(code, id, p.posted ? 'unknown' : 'not-posted'));
    }
    if (worker) {
      worker.removeEventListener('message', message); worker.removeEventListener('error', error); worker.removeEventListener('messageerror', messageError);
      worker.terminate(); worker = undefined;
    }
  }
  function message(event: MessageEvent<unknown>) {
    if (state !== 'running') return;
    try {
      const e = frameFields(event.data, ['protocolVersion', 'workerEpoch', 'requestId', 'context', 'response']); counter(e.requestId, true);
      const p = pending.get(e.requestId); if (!p) throw new Error('Unexpected response');
      const response = validateResponse(event.data, p.expected, e.requestId, epoch!);
      clearTimeout(p.timer); pending.delete(e.requestId); p.resolve(response);
    } catch { stop('protocol-error'); }
  }
  const error = () => stop('worker-error'); const messageError = () => stop('message-error');
  const client: WorkspaceWorkerClient = {
    request(request) {
      if (state === 'disposed' || state === 'failed') return Promise.reject(new WorkspaceWorkerError(state === 'disposed' ? 'disposed' : 'client-failed', null, 'not-posted'));
      let expected: ExpectedWorkerResponse;
      try { expected = describeRequest(request); } catch { return Promise.reject(new WorkspaceWorkerError('invalid-request', null, 'not-posted')); }
      if (nextRequest === Number.MAX_SAFE_INTEGER || epoch === undefined && nextEpoch === Number.MAX_SAFE_INTEGER) {
        stop('counter-exhausted'); return Promise.reject(new WorkspaceWorkerError('counter-exhausted', null, 'not-posted'));
      }
      const requestId = ++nextRequest; epoch ??= ++nextEpoch;
      const context = expected.context;
      if (context.requestType === 'workspace-bootstrap' || 'startup' in context && context.operation === 'editor') invalidateEditing(requestId);
      else if (['bootstrap', 'open-project', 'normalization-replace', 'workspace-resume-aborted'].includes(context.requestType)
        || 'admissionId' in context && context.admissionId === editingAdmission
        && ['workspace-fence', 'workspace-command', 'workspace-recovery-commit', 'document-batch', 'preferences', 'structural-command', 'replace-document'].includes(context.requestType)) invalidateEditing();
      return new Promise((resolve, reject) => {
        const p: Pending = { expected, resolve, reject, posted: false, timer: setTimeout(() => stop('timeout'), 30_000) };
        pending.set(requestId, p);
        if (!worker) {
          try {
            worker = factory();
            worker.addEventListener('message', message); worker.addEventListener('error', error); worker.addEventListener('messageerror', messageError);
            state = 'running';
          } catch { stop('worker-start-failed'); return; }
        }
        // Mark before posting: a synchronous test port may deliver a response.
        p.posted = true;
        try { worker.postMessage({ protocolVersion: 1, workerEpoch: epoch!, requestId, request }); }
        catch { stop('post-failed'); }
      });
    },
    dispose() { stop('disposed'); state = 'disposed'; },
  };
  clientLiveness.set(client, admissionId => state === 'running' && (admissionId === undefined || admissionId === editingAdmission));
  clientInvalidation.set(client, listener => {
    if (state !== 'running') { listener(); return () => {}; }
    invalidationListeners.add(listener); return () => { invalidationListeners.delete(listener); };
  });
  return client;
}
