import { createNormalizedRepository, RepositoryConflict, type NormalizedEnvironment } from './repository';
import { requestEnvelope, requireFrame, sameScope, repositoryFailureCodes,
  type WorkspaceWorkerResponse, type WorkspaceWorkerResponseEnvelope, type RepositoryFailureCode,
  type WorkspaceLifecycleWorkerRequest, type WorkspaceRecoveryAttempt } from '../workspaceWorkerProtocol';
import type { CommitIdentity, ProjectScope } from './schema';
import { normalizeWorkspace, type NormalizationEnvironment, type NormalizationResult } from './migration';
import { WorkspaceCommandConflict, type WorkspaceRepositoryAdmission, type WorkspaceRepositoryFence } from './workspaceCommands';
import type { WorkspaceRepositoryRecovery } from './workspaceRecovery';
import { createWorkspaceStartupOwner } from './startup';
import { isStartupType, type WorkspaceStartupRequest } from '../workspaceStartupProtocol';
import { createWorkRuntime, effect, setDefaultWorkYieldSlice } from '../../../shared/cooperativeWork.js';
import { rawValueWeightWork } from '../../../shared/jsonWork.js';

export interface WorkspaceWorkerHandler {
  /** Private owner entry only. No incoming worker protocol or public-store rollout. */
  normalize(environment: Omit<NormalizationEnvironment, 'repository'>): Promise<NormalizationResult>;
  handle(envelope: unknown): Promise<WorkspaceWorkerResponseEnvelope>;
  dispose(): void;
}
function failureCode(error: unknown): RepositoryFailureCode {
  if ((error instanceof RepositoryConflict || error instanceof WorkspaceCommandConflict)
    && repositoryFailureCodes.includes(error.reason as RepositoryFailureCode)) return error.reason as RepositoryFailureCode;
  if (error instanceof Error) {
    if (error.name === 'QuotaExceededError') return 'quota-exceeded';
    if (error.name === 'DataCloneError') return 'clone-failed';
    if (error.message.startsWith('ingress-required:')) return 'ingress-required';
    if (error.name === 'InvalidStateError' || error.name === 'NotFoundError' || error.message === 'normalized database blocked') return 'storage-unavailable';
  }
  return 'repository-failure';
}

/** One ordering owner, shared by the module worker and isolated inline transport. */
export function createWorkspaceWorkerHandler(environment: NormalizedEnvironment): WorkspaceWorkerHandler {
  if (environment.yieldSliceMs !== undefined) setDefaultWorkYieldSlice(environment.yieldSliceMs);
  const repository = createNormalizedRepository(environment);
  let admitted = new Map<string, { scope: ProjectScope; admissionId: number }>();
  interface WorkspaceOwner { generation: string; token: WorkspaceRepositoryAdmission; valid: boolean; fence?: WorkspaceRepositoryFence;
    recovery?: { id: number; token: WorkspaceRepositoryRecovery; attempt: WorkspaceRecoveryAttempt } }
  const workspaceOwners = new Map<number, WorkspaceOwner>();
  let currentWorkspaceId: number | undefined;
  let tail: Promise<unknown> = Promise.resolve(); let disposed = false;
  let epoch: number | undefined; let lastId = 0;
  const failedProjects = new Map<string, { scope: ProjectScope; identity: CommitIdentity; admissionId: number; bytes: number }>();
  let failedBytes = 0;
  const forgetFailure = (id: string) => { const old = failedProjects.get(id); if (old) { failedBytes -= old.bytes; failedProjects.delete(id); } };
  const forgetFailures = () => { for (const id of failedProjects.keys()) forgetFailure(id); };
  async function rememberFailure(scope: ProjectScope, identity: CommitIdentity, admissionId: number) {
    forgetFailure(scope.projectId);
    const work = createWorkRuntime({ assertCurrent() { requireFrame(!disposed); } }); work.setContext('recovery');
    try {
      const value = { scope: { ...scope }, identity: { ...identity }, admissionId };
      const bytes = (await work.run(rawValueWeightWork(value))).bytes;
      if (bytes > 64 * 1024) return;
      failedProjects.set(scope.projectId, { ...value, bytes }); failedBytes += bytes;
      while (failedProjects.size > 32 || failedBytes > 64 * 1024) forgetFailure(failedProjects.keys().next().value!);
    } finally { work.dispose(); }
  }
  const startup = createWorkspaceStartupOwner(repository, () => { requireFrame(!disposed); }, async (admissionId, batch, work) => {
    const owner = admitted.get(batch.scope.projectId);
    if (!owner || owner.admissionId !== admissionId || !sameScope(owner.scope, batch.scope)) throw new RepositoryConflict('ingress-required');
    try { return await repository.commitReplacement(batch, work); }
    catch (error) { admitted.delete(batch.scope.projectId); throw error; }
  }, async (requestId, work) => {
    const previous = currentWorkspaceId === undefined ? undefined : workspaceOwners.get(currentWorkspaceId);
    if (previous) previous.valid = false;
    currentWorkspaceId = undefined;
    admitted = new Map(); forgetFailures();
    const opened = await repository.openEditingWorkspace(work); work.assertCurrent(); requireFrame(!disposed);
    const { admission, active } = opened;
    const next = new Map<string, { scope: ProjectScope; admissionId: number }>();
    const projects: import('../workspaceStartupProtocol').StartupEditorAdmission['projects'] = [];
    for (const { scope, authority } of admission.projectAuthorities) await work.run(effect(1, () => {
      next.set(scope.projectId, { scope, admissionId: requestId });
      projects.push({ type: 'bootstrapped', scope, authority, admissionId: requestId });
    }));
    work.assertCurrent(); requireFrame(!disposed); admitted = next;
    workspaceOwners.set(requestId, { generation: admission.catalog.storageGeneration, token: admission.token, valid: true });
    currentWorkspaceId = requestId;
    while (workspaceOwners.size > 32) workspaceOwners.delete(workspaceOwners.keys().next().value!);
    return { active, workspace: { type: 'workspace-bootstrapped' as const, admissionId: requestId,
      catalog: admission.catalog, projectAuthorities: admission.projectAuthorities }, projects };
  });
  async function handleWorkspace(r: WorkspaceLifecycleWorkerRequest, requestId: number): Promise<WorkspaceWorkerResponse> {
    const generation = 'batch' in r ? r.batch.storageGeneration : 'attempt' in r ? r.attempt.storageGeneration : r.storageGeneration;
    const owner = 'admissionId' in r ? workspaceOwners.get(r.admissionId) : undefined;
    const matches = owner?.generation === generation;
    const stale = (): WorkspaceWorkerResponse => ({ type: 'failed', code: 'stale-admission', outcome: 'not-started', admission: 'none' });
    if ((r.type === 'workspace-command' || r.type === 'workspace-recovery-prepare' || r.type === 'workspace-recovery-commit')
      && (!matches || !owner!.valid || currentWorkspaceId !== r.admissionId)) return stale();
    if (r.type === 'workspace-recovery-commit') {
      const prepared = owner!.recovery, attempt = r.attempt, previous = prepared?.attempt;
      if (!prepared || prepared.id !== r.preparationId || !previous || previous.recoveryId !== attempt.recoveryId || previous.sourceDigest !== attempt.sourceDigest
        || previous.expected.revision !== attempt.expected.revision || previous.expected.coreDigest !== attempt.expected.coreDigest
        || previous.identity.commandId !== attempt.identity.commandId || previous.identity.clientId !== attempt.identity.clientId
        || previous.identity.commandSequence !== attempt.identity.commandSequence) return stale();
    }
    if (r.type === 'workspace-fence' && !matches) return stale();
    let invalidated = false;
    if (r.type === 'workspace-resume-aborted') {
      if (!matches || !owner!.valid || currentWorkspaceId !== r.admissionId || owner!.recovery || !failedProjects.size) return stale();
      const work = createWorkRuntime({ assertCurrent() { requireFrame(!disposed); } }); work.setContext('recovery');
      const previous = admitted;
      try {
        const failures = [...failedProjects.values()];
        const admission = await repository.resumeAbortedWorkspace(owner!.token, failures.map(({ scope, identity }) => ({ scope, identity })), work);
        // The repository retired its token. Never leave old public project IDs
        // writable if publication of this successor subsequently fails.
        owner!.valid = false; currentWorkspaceId = undefined; admitted = new Map(); invalidated = true;
        const next = new Map<string, { scope: ProjectScope; admissionId: number }>();
        for (const { scope } of admission.projectAuthorities) await work.run(effect(4, () => {
          const prior = previous.get(scope.projectId) ?? failedProjects.get(scope.projectId);
          requireFrame(prior && sameScope(prior.scope, scope) && !next.has(scope.projectId));
          next.set(scope.projectId, { scope, admissionId: requestId });
        }));
        work.assertCurrent(); requireFrame(!disposed);
        admitted = next; forgetFailures();
        workspaceOwners.set(requestId, { generation, token: admission.token, valid: true }); currentWorkspaceId = requestId;
        while (workspaceOwners.size > 32) workspaceOwners.delete(workspaceOwners.keys().next().value!);
        return { type: 'workspace-resumed', admissionId: requestId, catalog: admission.catalog, projectAuthorities: admission.projectAuthorities };
      } catch (error) {
        return { type: 'failed', code: failureCode(error), outcome: 'not-started', admission: invalidated ? 'invalidated' : 'none' };
      } finally { work.dispose(); }
    }
    if (r.type === 'workspace-bootstrap') {
      const previous = currentWorkspaceId === undefined ? undefined : workspaceOwners.get(currentWorkspaceId);
      if (previous?.valid) { previous.valid = false; invalidated = true; if (previous.recovery) repository.discardWorkspaceRecovery(previous.recovery.token); }
      currentWorkspaceId = undefined;
      forgetFailures();
    }
    try {
      switch (r.type) {
        case 'workspace-bootstrap': {
          const admission = await repository.admitWorkspace();
          if (disposed || admission.catalog.storageGeneration !== generation) {
            await repository.fenceWorkspace(admission.token); throw new RepositoryConflict('authority-changed');
          }
          workspaceOwners.set(requestId, { generation, token: admission.token, valid: true }); currentWorkspaceId = requestId;
          // Retain only bounded old-owner fence capability metadata. Eviction loses absence proof, never creates it.
          while (workspaceOwners.size > 32) workspaceOwners.delete(workspaceOwners.keys().next().value!);
          return { type: 'workspace-bootstrapped', admissionId: requestId, catalog: admission.catalog, projectAuthorities: admission.projectAuthorities };
        }
        case 'workspace-command':
          return { type: 'workspace-command-result', admissionId: r.admissionId, result: await repository.commitWorkspace(owner!.token, r.batch) };
        case 'workspace-recovery-prepare': {
          const intent = r.batch.intent; requireFrame(intent.type === 'recover-legacy-as-copies');
          const prepared = await repository.prepareWorkspaceRecovery(owner!.token, r.batch);
          if (disposed) { repository.discardWorkspaceRecovery(prepared.token); throw new RepositoryConflict('ingress-required'); }
          owner!.recovery = { id: requestId, token: prepared.token, attempt: { storageGeneration: generation, identity: { ...r.batch.identity },
            expected: { ...r.batch.expected }, recoveryId: intent.recoveryId, sourceDigest: intent.sourceDigest } };
          return { type: 'workspace-recovery-prepared', admissionId: r.admissionId, preparationId: requestId,
            recoveryId: intent.recoveryId, sourceDigest: intent.sourceDigest, counts: prepared.counts };
        }
        case 'workspace-recovery-commit': {
          const prepared = owner!.recovery!; owner!.recovery = undefined;
          return { type: 'workspace-command-result', admissionId: r.admissionId, result: await repository.commitWorkspaceRecovery(owner!.token, prepared.token) };
        }
        case 'workspace-recovery-discard':
          if (matches && owner!.recovery?.id === r.preparationId) { repository.discardWorkspaceRecovery(owner!.recovery.token); owner!.recovery = undefined; }
          return { type: 'workspace-recovery-discarded', storageGeneration: generation, admissionId: r.admissionId, preparationId: r.preparationId };
        case 'workspace-fence':
          owner!.valid = false; owner!.fence = await repository.fenceWorkspace(owner!.token);
          return { type: 'workspace-fenced', storageGeneration: generation, admissionId: r.admissionId };
        case 'inspect-workspace-command':
          return { type: 'workspace-inspection', identity: r.batch.identity,
            result: await repository.inspectWorkspaceAttempt(r.batch, matches ? owner!.fence : undefined) };
      }
    } catch (error) {
      if ((r.type === 'workspace-command' || r.type === 'workspace-recovery-commit') && owner) { invalidated = owner.valid; owner.valid = false; }
      return { type: 'failed', code: failureCode(error), outcome: r.type === 'workspace-command' || r.type === 'workspace-recovery-commit' || r.type === 'workspace-fence' ? 'unknown' : 'not-started',
        admission: invalidated ? 'invalidated' : 'none' };
    }
  }
  return {
    normalize(input) {
      requireFrame(!startup.active());
      const capturedEpoch = epoch;
      const operation = tail.catch(() => {}).then(() => normalizeWorkspace({ ...input, repository,
        assertCurrent: () => {
          if (disposed || capturedEpoch !== epoch) throw new DOMException('Normalization owner lost', 'AbortError');
          input.assertCurrent?.();
        } }));
      tail = operation; return operation;
    },
    handle(value) {
      try {
        requireFrame(!disposed);
        const { envelope: e, expected } = requestEnvelope(value);
        requireFrame((epoch === undefined || epoch === e.workerEpoch) && e.requestId > lastId);
        epoch = e.workerEpoch; lastId = e.requestId;
        const operation = tail.catch(() => {}).then(async (): Promise<WorkspaceWorkerResponseEnvelope> => {
          requireFrame(!disposed);
          const r = e.request; const context = expected.context;
          if (isStartupType(r.type)) {
            let response: WorkspaceWorkerResponse;
            try { response = await startup.handle(r as WorkspaceStartupRequest, e.requestId); }
            catch (error) { response = { type: 'failed', code: failureCode(error), outcome: 'not-started', admission: 'none' }; }
            requireFrame(!disposed); return { protocolVersion: 1, workerEpoch: e.workerEpoch, requestId: e.requestId, context, response };
          }
          if (startup.active()) return { protocolVersion: 1, workerEpoch: e.workerEpoch, requestId: e.requestId, context,
            response: { type: 'failed', code: 'ingress-required', outcome: 'not-started', admission: 'none' } };
          if (r.type === 'workspace-bootstrap' || r.type === 'workspace-resume-aborted' || r.type === 'workspace-command' || r.type === 'workspace-fence' || r.type === 'inspect-workspace-command'
            || r.type === 'workspace-recovery-prepare' || r.type === 'workspace-recovery-commit' || r.type === 'workspace-recovery-discard') {
            const response = await handleWorkspace(r, e.requestId); requireFrame(!disposed);
            return { protocolVersion: 1, workerEpoch: e.workerEpoch, requestId: e.requestId, context, response };
          }
          requireFrame('scope' in context); const scope = context.scope;
          const mutation = 'admissionId' in context;
          let response: WorkspaceWorkerResponse;
          if (r.type === 'open-project') {
            const workspace = workspaceOwners.get(r.workspaceAdmissionId);
            if (!workspace?.valid || currentWorkspaceId !== r.workspaceAdmissionId || workspace.generation !== scope.storageGeneration) return {
              protocolVersion: 1, workerEpoch: e.workerEpoch, requestId: e.requestId, context,
              response: { type: 'failed', code: 'stale-admission', outcome: 'not-started', admission: 'none' } };
          }
          if (mutation) {
            const owner = admitted.get(scope.projectId);
            if (!owner || !sameScope(owner.scope, scope) || owner.admissionId !== context.admissionId) return {
              protocolVersion: 1, workerEpoch: e.workerEpoch, requestId: e.requestId, context,
              response: { type: 'failed', code: 'stale-admission', outcome: 'not-started', admission: 'none' },
            };
          }
          let invalidated = false;
          const invalidate = () => { invalidated = admitted.delete(scope.projectId) || invalidated; };
          if (r.type === 'bootstrap' || r.type === 'open-project') { invalidate(); forgetFailure(scope.projectId); }
          try {
            switch (r.type) {
              case 'open-project': {
                const opened = await repository.openAdmittedProject(scope); requireFrame(!disposed);
                admitted.set(scope.projectId, { scope, admissionId: e.requestId });
                response = { type: 'project-opened', scope, admissionId: e.requestId, ...opened }; break;
              }
              case 'bootstrap': {
                const authority = await repository.bindAdmittedProject(r.project);
                requireFrame(!disposed);
                admitted.set(scope.projectId, { scope, admissionId: e.requestId });
                response = { type: 'bootstrapped', scope, admissionId: e.requestId, authority }; break;
              }
              case 'document-batch': response = { type: 'document-result', ack: await repository.commitDocument(r.batch) }; break;
               case 'project-cut-authority': response = { type: 'project-cut-authority-result', scope, admissionId: r.admissionId,
                 authority: repository.readAdmittedProjectAuthority(scope) }; break;
              case 'document-readmission-authority': response = { type: 'document-readmission-authority-result', scope,
                admissionId: r.admissionId, identity: r.receipt.identity, authority: await repository.readDocumentReadmissionAuthority(r.receipt) }; break;
              case 'replace-document': response = { type: 'replacement-result', ack: await repository.commitReplacement(r.batch) }; break;
              case 'inspect-replacement': {
                const result = await repository.inspectReplacement(r.batch);
                if (result.type === 'conflict') invalidate();
                response = { type: 'replacement-inspection', result }; break;
              }
              case 'preferences': response = { type: 'preferences-result', ack: await repository.commitPreferences(r.batch) }; break;
              case 'structural-command': response = { type: 'structural-result', ack: await repository.commitDocument(r.command.batch) }; break;
              case 'inspect-commit': {
                const result = await repository.inspectCommitAttempt(r.attempt);
                if (result.type === 'conflict') invalidate();
                response = { type: 'commit-inspection', result }; break;
              }
              case 'recovery-export': response = { type: 'recovery-exported', source: 'normalized-project', ...await repository.exportProjectForRecovery(scope) }; break;
            }
          } catch (error) {
            if (mutation || r.type === 'bootstrap' || r.type === 'open-project') invalidate();
            if ((r.type === 'document-batch' || r.type === 'preferences' || r.type === 'structural-command') && 'identity' in context && 'admissionId' in context) {
              try { await rememberFailure(scope, context.identity, context.admissionId); } catch { forgetFailure(scope.projectId); }
            }
            response = { type: 'failed', code: failureCode(error), outcome: mutation ? 'unknown' : 'not-started', admission: invalidated ? 'invalidated' : 'none' };
          }
          requireFrame(!disposed);
          return { protocolVersion: 1, workerEpoch: e.workerEpoch, requestId: e.requestId, context, response };
        });
        tail = operation; return operation;
      } catch (error) { return Promise.reject(error); }
    },
    dispose() {
      disposed = true; startup.dispose(); forgetFailures(); for (const key of admitted.keys()) admitted.delete(key);
      for (const owner of workspaceOwners.values()) {
        owner.valid = false; void repository.fenceWorkspace(owner.token).catch(() => {});
      }
      for (const key of workspaceOwners.keys()) workspaceOwners.delete(key); currentWorkspaceId = undefined;
    },
  };
}
