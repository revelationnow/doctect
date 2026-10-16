import { createWorkRuntime, type WorkRuntime } from '../../../shared/cooperativeWork.js';
import type { BulkDocumentBatch, BulkDocumentAck } from './schema';
import type { NormalizedRepository, NormalizationPreparationSession } from './repository';
import type { WorkspaceStartupRequest, WorkspaceStartupResponse, StartupOperation, StartupValue, StartupEditorAdmission } from '../workspaceStartupProtocol';

/** Exclusive startup owner. Progress completes a normal RPC; continuation resumes
 * the same Work/session at its existing cooperative yield boundary. */
export function createWorkspaceStartupOwner(repository: NormalizedRepository, assertCurrent: () => void,
  replace: (admissionId: number, batch: BulkDocumentBatch, work: WorkRuntime) => Promise<BulkDocumentAck>,
  openEditor: (requestId: number, work: WorkRuntime) => Promise<StartupEditorAdmission>) {
  interface Operation { id: number; kind: StartupOperation; respond?: (value: WorkspaceStartupResponse) => void; resume?: () => void; lastReply: number }
  interface Owner { id: number; session: NormalizationPreparationSession; operation?: Operation; stopped: boolean;
    work: ReturnType<typeof createWorkRuntime>; channel: MessageChannel; wake?: () => void; settled?: Promise<void> }
  let owner: Owner | undefined;
  const stop = (current: Owner) => {
    current.stopped = true; current.work.dispose(); current.session.dispose();
    current.operation?.resume?.(); current.wake?.(); current.channel.port1.close(); current.channel.port2.close();
  };
  return {
    active: () => owner !== undefined,
    async handle(request: WorkspaceStartupRequest, requestId: number): Promise<WorkspaceStartupResponse> {
      assertCurrent();
      if (request.type === 'normalization-open') {
        if (owner) throw Error('Normalization session already open');
        const channel = new MessageChannel(); let created!: Owner;
        const work = createWorkRuntime({ assertCurrent() { assertCurrent(); if (created?.stopped) throw new DOMException('Startup stopped', 'AbortError'); },
          async yieldTask() {
            await new Promise<void>(resolve => { created.wake = resolve; channel.port2.postMessage(0); });
            created.wake = undefined;
            const operation = created.operation;
            if (operation?.respond && performance.now() - operation.lastReply >= 50 && !created.stopped) {
              await new Promise<void>(resolve => {
                operation.resume = resolve;
                const respond = operation.respond!; operation.respond = undefined;
                respond({ type: 'normalization-progress', sessionId: created.id, operationId: operation.id, operation: operation.kind,
                  phase: work.context().phase, completed: work.snapshot().visits });
              });
            }
          } });
        try {
          created = { id: requestId, session: repository.openNormalizationSession(work), work, channel, stopped: false };
          channel.port1.onmessage = () => created.wake?.(); owner = created;
          return { type: 'normalization-opened', sessionId: requestId };
        } catch (error) { work.dispose(); channel.port1.close(); channel.port2.close(); throw error; }
      }
      const current = owner;
      if (!current || current.id !== request.sessionId || current.stopped) throw Error('Stale normalization session');
      if (request.type === 'normalization-close') {
        stop(current); await current.settled; if (owner === current) owner = undefined;
        return { type: 'normalization-closed', sessionId: current.id };
      }
      if (request.type === 'normalization-continue') {
        const operation = current.operation;
        if (!operation || operation.id !== request.operationId || !operation.resume || operation.respond) throw Error('Stale normalization continuation');
        return new Promise<WorkspaceStartupResponse>(resolve => {
          operation.respond = resolve; operation.lastReply = performance.now(); const resume = operation.resume!; operation.resume = undefined; resume();
        });
      }
      if (current.operation) throw Error('Normalization operation already active');
      const operation: Operation = { id: requestId, kind: request.type === 'normalization-replace' ? 'replace' : request.operation, lastReply: performance.now() };
      current.operation = operation;
      const result = new Promise<WorkspaceStartupResponse>(resolve => { operation.respond = resolve; });
      current.settled = (async () => {
        try {
          let value: StartupValue;
          switch (operation.kind) {
            case 'editor': value = await openEditor(operation.id, current.work); break;
            case 'replace': {
              if (request.type !== 'normalization-replace') throw Error('Invalid replacement operation');
              value = await replace(request.admissionId, request.batch, current.work); break;
            }
            case 'prepare': value = await current.session.prepare({ allowFresh: 'allowFresh' in request ? request.allowFresh : undefined }); break;
            case 'reserve': value = await current.session.reserve(); break;
            case 'stage': value = await current.session.stageNext(); break;
            case 'verify': value = await current.session.verify(); break;
            case 'activate': value = await current.session.activate(); break;
            case 'reopen': value = await current.session.reopen(); break;
            case 'active': value = await repository.readActiveSnapshot(current.work); break;
            case 'trusted-active': value = await repository.readTrustedActiveSnapshot(current.work); break;
            case 'retained': value = await repository.readRetainedSource(current.work); break;
          }
          current.work.assertCurrent();
          operation.respond?.({ type: 'normalization-result', sessionId: current.id, operationId: operation.id, operation: operation.kind, value });
        } catch (error) {
          operation.respond?.({ type: 'normalization-failed', sessionId: current.id, operationId: operation.id,
            name: String(error?.name ?? 'Error').slice(0, 128), message: String(error?.message ?? error).slice(0, 4096),
            ...(typeof error?.reason === 'string' ? { reason: error.reason.slice(0, 256) } : {}) });
        } finally { current.operation = undefined; }
      })();
      return result;
    },
    dispose() { if (owner) { stop(owner); owner = undefined; } },
  };
}
