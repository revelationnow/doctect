import { effect, primitive, type Work, type WorkRuntime } from '../../shared/cooperativeWork.js';
import { compareStringsWork } from '../../shared/jsonWork.js';
import type { NormalizedRepository, NormalizationPreparationSession } from './normalized/repository';
import { isWorkspaceWorkerClientLive, observeWorkspaceWorkerClientInvalidation, type WorkspaceWorkerClient } from './workspaceWorkerClient';
import type { StartupOperation, StartupValue, WorkspaceStartupResponse, StartupEditorAdmission } from './workspaceStartupProtocol';
import type { WorkspaceSnapshot } from './contracts';
import type { BulkDocumentAck, BulkDocumentBatch } from './normalized/schema';
import { counter, frameFields, requireFrame, repositoryFailureCodes, validateReplacementReply, type WorkspaceWorkerResponse, type RepositoryFailureCode } from './workspaceWorkerProtocol';

class StartupOperationError extends Error {
  readonly reason?: string;
  constructor(response: Extract<WorkspaceStartupResponse, { type: 'normalization-failed' }>) {
    super(response.message); this.name = response.name; this.reason = response.reason;
  }
}

interface EditingReceipt { client: WorkspaceWorkerClient; admissionId: number; live: boolean; admission?: StartupEditorAdmission; stopObserving?: () => void }
const editingAdmissions = new WeakMap<WorkspaceSnapshot, EditingReceipt>();
const latestEditingAdmission = new WeakMap<WorkspaceWorkerClient, EditingReceipt>();
const expireEditingReceipt = (receipt: EditingReceipt) => {
  receipt.live = false; receipt.admission = undefined; receipt.stopObserving?.(); receipt.stopObserving = undefined;
  if (latestEditingAdmission.get(receipt.client) === receipt) latestEditingAdmission.delete(receipt.client);
};
const revokeEditingAdmission = (client: WorkspaceWorkerClient) => {
  const previous = latestEditingAdmission.get(client); if (previous) expireEditingReceipt(previous);
};
const assertEditingReceipt = (receipt: EditingReceipt) => {
  if (!receipt.live || !isWorkspaceWorkerClientLive(receipt.client, receipt.admissionId)) {
    expireEditingReceipt(receipt); throw Error('Startup editing admission expired');
  }
};
export function takeStartupEditingAdmission(client: WorkspaceWorkerClient, snapshot: WorkspaceSnapshot): (StartupEditorAdmission & { assertCurrent(): void }) | undefined {
  const receipt = editingAdmissions.get(snapshot);
  if (!receipt || receipt.client !== client) return;
  assertEditingReceipt(receipt);
  const admission = receipt.admission; receipt.admission = undefined;
  receipt.stopObserving?.(); receipt.stopObserving = undefined;
  return admission ? { ...admission, assertCurrent: assertEditingReceipt.bind(undefined, receipt) } : undefined;
}

const ownData = (value: unknown, key: string): unknown => {
  requireFrame(value !== null && typeof value === 'object');
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  requireFrame(descriptor?.enumerable && Object.hasOwn(descriptor, 'value')); return descriptor.value;
};
/** Payload validation stays worker-owned. Unbounded admission metadata is checked
 * cooperatively before it can become an editor installation receipt. */
function* editorAdmissionWork(value: unknown, operationId: number): Work<StartupEditorAdmission> {
  const bundle = frameFields(value, ['active', 'workspace', 'projects']);
  const active = frameFields(bundle.active, ['authority', 'workspace', 'snapshot', 'source']);
  const workspace = frameFields(bundle.workspace, ['type', 'admissionId', 'catalog', 'projectAuthorities']);
  const catalog = frameFields(workspace.catalog, ['storageGeneration', 'stamp', 'members', 'activeProjectId', 'presets', 'pendingImports']);
  const snapshot = frameFields(active.snapshot, ['projects', 'activeProjectId', 'customPresets', 'pendingImports']);
  requireFrame(workspace.type === 'workspace-bootstrapped' && workspace.admissionId === operationId);
  counter(workspace.admissionId, true);
  for (const array of [bundle.projects, workspace.projectAuthorities, catalog.members, snapshot.projects]) requireFrame(Array.isArray(array));
  const admission = value as StartupEditorAdmission, members = admission.workspace.catalog.members;
  requireFrame(members.length > 0 && members.length === admission.projects.length
    && members.length === admission.workspace.projectAuthorities.length && members.length === admission.active.snapshot.projects.length);
  const generation = catalog.storageGeneration;
  for (const value of [generation, catalog.activeProjectId, snapshot.activeProjectId]) requireFrame(typeof value === 'string' && value.length > 0);
  for (const source of [active.authority, active.workspace]) requireFrame(ownData(source, 'storageGeneration') === generation);
  requireFrame(snapshot.activeProjectId === catalog.activeProjectId && ownData(active.workspace, 'activeProjectId') === catalog.activeProjectId);
  const stamp = frameFields(catalog.stamp, ['revision', 'coreDigest']); counter(stamp.revision);
  requireFrame(stamp.revision === ownData(active.workspace, 'revision') && stamp.coreDigest === ownData(active.workspace, 'coreDigest'));
  const ids = new Set<string>();
  for (let index = 0; index < members.length; index++) {
    const bound = frameFields(ownData(admission.projects, String(index)), ['type', 'admissionId', 'scope', 'authority']);
    const projected = frameFields(ownData(admission.workspace.projectAuthorities, String(index)), ['scope', 'authority']);
    const member = frameFields(ownData(members, String(index)), ['storageGeneration', 'projectId', 'incarnation']);
    requireFrame(bound.type === 'bootstrapped' && bound.admissionId === operationId);
    const expected = frameFields(projected.authority, ['documentRevision', 'preferenceRevision', 'foldStructureGeneration']);
    const actual = frameFields(bound.authority, ['documentRevision', 'preferenceRevision', 'foldStructureGeneration']);
    for (const field of ['documentRevision', 'preferenceRevision', 'foldStructureGeneration']) {
      counter(actual[field]); requireFrame(actual[field] === expected[field]);
    }
    for (const scope of [bound.scope, projected.scope]) {
      const checked = frameFields(scope, ['storageGeneration', 'projectId', 'incarnation']);
      for (const field of ['storageGeneration', 'projectId', 'incarnation']) {
        requireFrame(typeof checked[field] === 'string' && typeof member[field] === 'string' && (member[field] as string).length > 0);
        requireFrame((yield* compareStringsWork(checked[field] as string, member[field] as string)) === 0);
      }
    }
    const id = ownData(ownData(admission.active.snapshot.projects, String(index)), 'id');
    requireFrame(typeof id === 'string' && (yield* compareStringsWork(id, member.projectId as string)) === 0);
    yield* effect(32, () => { requireFrame(member.storageGeneration === generation && !ids.has(id)); ids.add(id); });
  }
  requireFrame(ids.has(catalog.activeProjectId as string)); return admission;
}

/** Browser orchestration has source capture but no normalized storage capability. */
export function createWorkspaceStartupRepository(client: WorkspaceWorkerClient, options: {
  onProgress?(progress: Extract<WorkspaceStartupResponse, { type: 'normalization-progress' }>): void;
  forEditing?: boolean;
} = {}): Pick<NormalizedRepository, 'openNormalizationSession' | 'readActiveSnapshot' | 'readRetainedSource'> & {
  replace(admissionId: number, batch: BulkDocumentBatch): Promise<BulkDocumentAck>;
} {
  let tail: Promise<unknown> = Promise.resolve();
  function open(work?: WorkRuntime) {
    let stopped = false;
    const current = () => { work?.assertCurrent(); if (stopped) throw new DOMException('Startup facade disposed', 'AbortError'); };
    const id = tail.catch(() => {}).then(async () => {
      current(); const response = await client.request({ type: 'normalization-open' });
      if (response.type !== 'normalization-opened') throw Error('Worker startup admission failed'); return response.sessionId;
    });
    const call = async (operation: StartupOperation, allowFresh?: boolean, replacement?: { admissionId: number; batch: BulkDocumentBatch }): Promise<StartupValue> => {
      current(); const sessionId = await id; current();
      let response = await client.request(replacement ? { type: 'normalization-replace', sessionId, ...replacement }
        : { type: 'normalization-step', sessionId, operation, ...(allowFresh === undefined ? {} : { allowFresh }) });
      for (;;) {
        current();
        if (response.type === 'normalization-failed') throw new StartupOperationError(response);
        if (response.type === 'normalization-result') {
          if (response.operation !== operation) throw Error('Startup operation mismatch');
          if (operation === 'editor') {
            try { return await work!.run(editorAdmissionWork(response.value, response.operationId)); }
            catch (error) { if (!work?.stopped()) client.dispose(); throw error; }
          }
          return response.value;
        }
        if (response.type !== 'normalization-progress' || response.operation !== operation) throw Error('Invalid startup progress');
        try { options.onProgress?.(response); } catch { /* Passive progress cannot decide authority. */ }
        current(); response = await client.request({ type: 'normalization-continue', sessionId, operationId: response.operationId });
      }
    };
    const close = () => {
      if (stopped) return tail; stopped = true;
      tail = id.then(sessionId => client.request({ type: 'normalization-close', sessionId })); void tail.catch(() => {});
      return tail;
    };
    const session: NormalizationPreparationSession = {
      prepare: value => call('prepare', value?.allowFresh) as ReturnType<NormalizationPreparationSession['prepare']>,
      reserve: () => call('reserve') as ReturnType<NormalizationPreparationSession['reserve']>,
      stageNext: () => call('stage') as ReturnType<NormalizationPreparationSession['stageNext']>,
      verify: () => call('verify') as ReturnType<NormalizationPreparationSession['verify']>,
      activate: () => call('activate') as ReturnType<NormalizationPreparationSession['activate']>,
      async reopen() {
        if (!options.forEditing) return await call('reopen') as Awaited<ReturnType<NormalizationPreparationSession['reopen']>>;
        revokeEditingAdmission(client);
        const admission = await call('editor') as StartupEditorAdmission;
        let active!: StartupEditorAdmission['active'];
        await work!.run(primitive('clone', () => { active = structuredClone(admission.active); }));
        current(); if (!isWorkspaceWorkerClientLive(client, admission.workspace.admissionId)) throw Error('Startup client admission changed');
        const receipt: EditingReceipt = { client, admissionId: admission.workspace.admissionId, admission, live: true };
        editingAdmissions.set(active.snapshot, receipt); latestEditingAdmission.set(client, receipt);
        receipt.stopObserving = observeWorkspaceWorkerClientInvalidation(client, () => expireEditingReceipt(receipt));
        assertEditingReceipt(receipt); return active;
      }, dispose: close,
    };
    return { session, call, close };
  }
  return {
    async replace(admissionId, batch) { const owner = open(); try { return await owner.call('replace', undefined, { admissionId, batch }) as BulkDocumentAck; } finally { await owner.close(); } },
    openNormalizationSession: work => open(work).session,
    async readActiveSnapshot(work) { const owner = open(work); try { return await owner.call('active') as Awaited<ReturnType<NormalizedRepository['readActiveSnapshot']>>; } finally { owner.close(); } },
    async readRetainedSource(work) { const owner = open(work); try { return await owner.call('retained') as Awaited<ReturnType<NormalizedRepository['readRetainedSource']>>; } finally { owner.close(); } },
  };
}

/** Explicit bulk work may span progress replies. Later ordinary RPCs are not
 * posted until it closes; each posted request keeps the unchanged client deadline. */
export function createWorkspaceEditingTransport(client: WorkspaceWorkerClient): Pick<WorkspaceWorkerClient, 'request'> {
  const startup = createWorkspaceStartupRepository(client); let gate: Promise<void> | undefined;
  return { request(request) {
    if (request.type !== 'replace-document') return gate ? gate.then(() => client.request(request)) : client.request(request);
    const run = async (): Promise<WorkspaceWorkerResponse> => {
      try {
        const ack = await startup.replace(request.admissionId, request.batch);
        validateReplacementReply(ack, request.batch, request.admissionId); return { type: 'replacement-result', ack };
      } catch (error) {
        if (!(error instanceof StartupOperationError)) throw error;
        const code: RepositoryFailureCode = error.name === 'QuotaExceededError' ? 'quota-exceeded' : error.name === 'DataCloneError' ? 'clone-failed'
          : repositoryFailureCodes.includes(error.reason as RepositoryFailureCode) ? error.reason as RepositoryFailureCode : 'repository-failure';
        return { type: 'failed', code, outcome: 'unknown', admission: 'invalidated' };
      }
    };
    const result = (gate ?? Promise.resolve()).then(run), settled = result.then(() => {}, () => {}); gate = settled;
    void settled.then(() => { if (gate === settled) gate = undefined; }); return result;
  } };
}
