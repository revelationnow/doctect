import { createWorkRuntime, effect } from '../../shared/cooperativeWork.js';
import type { AppState } from '../../types';
import type { IncrementalProjectWrites } from '../../hooks/useIncrementalProjectWrites';
import type { ProjectSaveState, StructuralWorkspaceCommand } from '../../hooks/useWorkspaceProjectWrites';
import type { EditorSourceBinding, EditorWorkingState } from '../document/contracts';
import { WorkspaceStoreError, type WorkspaceProject, type WorkspaceSnapshot, type WorkspaceCommit } from './contracts';
import { createIncrementalCommandAdmission } from './incrementalCommandAdmission';
import { createWorkspaceCommandAdmission, type RetainedWorkspaceWork } from './workspaceCommandAdmission';
import { createProjectInstallationRegistry } from './projectInstallationRegistry';
import { createWorkspaceCommandDispatcher } from './commandDispatcher';
import { advanceInstalledProjectAuthorityFromAck, getInstalledProjectAuthorityToken, inheritInstalledProjectAuthority, registerInstalledProjectAuthority } from './projectAuthority';
import { reconstructProjectWork } from './normalized/codec';
import type { ProjectScope } from './normalized/schema';
import type { WorkspaceCommandResult } from './normalized/workspaceCommands';
import type { InstalledQueueAuthority, QueueEvent, QueueRecoveryProject } from './incrementalQueue';
import { getCommandQueueReceipt } from './incrementalQueue';
import { isWorkspaceWorkerClientLive, type WorkspaceWorkerClient } from './workspaceWorkerClient';
import { counter, frameFields, requireFrame, sameScope, type WorkspaceWorkerResponse } from './workspaceWorkerProtocol';
import type { LegacySnapshot } from './legacyTypes';
import { createWorkspaceEditingTransport, takeStartupEditingAdmission } from './workspaceStartup';

interface Entry { scope: ProjectScope; project: WorkspaceProject; epoch: number; binding: EditorSourceBinding; writer?: IncrementalProjectWrites; working?: EditorWorkingState }
type WorkspaceBinding = Extract<WorkspaceWorkerResponse, { type: 'workspace-bootstrapped' }>;
export interface WorkspaceEditingView {
  /** Initializers and metadata only. Explicit readProject() assembles live content. */
  workspace: WorkspaceSnapshot; authorityEpochs: ReadonlyMap<string, number>; saveStates: ReadonlyMap<string, ProjectSaveState>;
  preferenceStates: ReadonlyMap<string, ProjectSaveState>; hasUnsavedWork: boolean; blocked: boolean;
}
export type WorkspaceEditingSession = Awaited<ReturnType<typeof createWorkspaceEditingSession>>;

export async function createWorkspaceEditingSession(initialClient: WorkspaceWorkerClient, initial: WorkspaceSnapshot, generation: string,
  options: { uuid(): string; assertCurrent(): void; prepareProject(project: WorkspaceProject): Promise<WorkspaceProject>; retry(): Promise<void> }) {
  const startup = takeStartupEditingAdmission(initialClient, initial);
  initial = startup?.active.snapshot ?? initial;
  let client = initialClient, epoch = 0, disposed = false, blocked = false;
  let transport = createWorkspaceEditingTransport(client);
  const installations = createProjectInstallationRegistry(generation), entries = new Map<string, Entry>(), listeners = new Set<() => void>();
  let presets = initial.customPresets, imports = initial.pendingImports;
  let incremental!: ReturnType<typeof createIncrementalCommandAdmission>, lifecycle!: Awaited<ReturnType<typeof createWorkspaceCommandAdmission>>;
  let view!: WorkspaceEditingView, recovering = false, probingRollback = false;
  const clients = new Set([initialClient]);
  let retryCustody: { client: WorkspaceWorkerClient; checkpoint: ReturnType<typeof incremental.queue.freeze>; retained: RetainedWorkspaceWork } | undefined;
  const current = () => { options.assertCurrent(); if (disposed) throw new WorkspaceStoreError('Workspace source stopped.', 'authority-lost'); };
  function entry(id: string, expectedEpoch?: number) {
    current(); const value = entries.get(id);
    if (!value || expectedEpoch !== undefined && value.epoch !== expectedEpoch) throw new WorkspaceStoreError('Project source changed.', 'authority-lost'); return value;
  }
  function editable(value: Entry) { current(); if (blocked) throw new WorkspaceStoreError('Local editing is paused until recovery.', 'authority-lost'); lifecycle.assertEditable(value.scope); }
  function publish(beforePublish?: () => void) {
    const catalog = lifecycle.catalog(), projects = catalog.members.map(scope => entries.get(scope.projectId)?.project).filter(Boolean) as WorkspaceProject[];
    const saveStates = new Map<string, ProjectSaveState>(), preferenceStates = new Map<string, ProjectSaveState>();
    for (const value of entries.values()) { saveStates.set(value.project.id, value.writer?.documentState ?? { status: 'saved' });
      preferenceStates.set(value.project.id, value.writer?.preferenceState ?? { status: 'saved' }); }
    beforePublish?.();
    view = { workspace: { projects, activeProjectId: catalog.activeProjectId, customPresets: presets, pendingImports: imports },
      authorityEpochs: new Map([...entries].map(([id, value]) => [id, value.epoch])), saveStates, preferenceStates,
      hasUnsavedWork: [...entries.values()].some(value => value.writer?.hasUnsavedDocument), blocked };
    for (const listener of listeners) listener();
  }
  const queueOptions = () => ({ transport, uuid: options.uuid,
    clock: { now: () => Date.now(), setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay), clearTimeout: (timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>) },
    resolveAuthority: (id: string) => installations.get(id), observeProject: (event: QueueEvent) => lifecycle?.observeProject(event),
    onEvent(event: QueueEvent) {
      if (event.type === 'acknowledged' && event.ack.type !== 'preferences-saved') {
        const value = entries.get(event.ack.projectId);
        if (value && getInstalledProjectAuthorityToken(value.project) === event.authority.source) advanceInstalledProjectAuthorityFromAck(value.project, value.project, event.ack);
      } else if (event.type === 'frozen' || event.type === 'project-blocked') {
        blocked = true; if (event.type === 'project-blocked') incremental.queue.freeze(event.failure); if (view) publish();
      }
    } });
  async function openProject(scope: ProjectScope, preserve = false, startup?: ReturnType<typeof takeStartupEditingAdmission>) {
    const bound = startup?.projects.find(value => sameScope(value.scope, scope));
    const material = startup?.active.snapshot.projects.find(value => value.id === scope.projectId);
    if (startup && (!bound || !material)) throw new WorkspaceStoreError('Startup project admission missing.', 'authority-lost');
    const response = bound && material ? { ...bound, type: 'project-opened' as const, project: material }
      : await client.request({ type: 'open-project', workspaceAdmissionId: workspaceBinding.admissionId, scope }); current(); startup?.assertCurrent();
    if (response.type !== 'project-opened') throw new WorkspaceStoreError('Project admission failed.', 'authority-lost', response);
    const previous = entries.get(scope.projectId), kept = preserve && previous && sameScope(previous.scope, scope) ? previous : undefined;
    if (preserve && previous && !kept) throw new WorkspaceStoreError('Project incarnation changed; open work was preserved.', 'authority-lost');
    const project = kept?.project ?? response.project;
    const source = kept?.binding.source ?? registerInstalledProjectAuthority(project, { incarnation: scope.incarnation, revision: response.authority.documentRevision });
    const binding = { type: 'bootstrapped' as const, scope, admissionId: response.admissionId, authority: response.authority };
    installations.set(scope.projectId, { source, transport, binding, editorGenerationFloor: 0 });
    if (kept) return { scope, authority: response.authority };
    const value: Entry = { scope, project, epoch: ++epoch, binding: undefined! };
    value.binding = { source, editorGenerationFloor: 0, foldStructureGeneration: response.authority.foldStructureGeneration,
      assertEditable: () => { if (entries.get(scope.projectId) !== value) throw new WorkspaceStoreError('Project retired.', 'authority-lost'); editable(value); },
      capturePersistenceCut: through => value.writer?.capturePersistenceCut(project.id, through) ?? Promise.resolve(false),
      registerPersistenceDrain: drain => lifecycle.registerEditor(scope, source, drain),
      registerWorkingState: handle => {
        if (entries.get(scope.projectId) !== value || value.working) throw new WorkspaceStoreError('Working owner changed.', 'authority-lost');
        value.working = handle; return () => { if (value.working === handle) value.working = undefined; };
      } };
    entries.set(project.id, value); return { scope, authority: response.authority };
  }
  const initialBinding = startup?.workspace ?? await client.request({ type: 'workspace-bootstrap', storageGeneration: generation });
  if (initialBinding.type !== 'workspace-bootstrapped') throw new WorkspaceStoreError('Workspace admission failed.', 'authority-lost', initialBinding);
  let workspaceBinding = initialBinding;
  const authorities = [];
  for (const scope of workspaceBinding.catalog.members) authorities.push(await openProject(scope, false, startup));
  workspaceBinding = { ...workspaceBinding, projectAuthorities: authorities };
  incremental = createIncrementalCommandAdmission(queueOptions());
  const lifecycleOptions = (recovery?: RetainedWorkspaceWork) => ({ binding: workspaceBinding as Extract<typeof workspaceBinding, { type: 'workspace-bootstrapped' }>, queue: incremental.queue,
    transport, installations, clientId: options.uuid(), uuid: options.uuid, assertCurrent: current,
    resolveInstalled: (scope: ProjectScope) => installations.get(scope.projectId), onCatalog: (_result: WorkspaceCommandResult) => {}, ...(recovery ? { recovery } : {}) });
  lifecycle = await createWorkspaceCommandAdmission(lifecycleOptions());
  try { current(); startup?.assertCurrent(); }
  catch (error) { lifecycle.dispose(); incremental.dispose(); throw error; }
  async function apply(result: WorkspaceCommandResult) {
    current(); const work = createWorkRuntime({ assertCurrent: current });
    try {
      for (const removed of result.delta.removed) { entries.delete(removed.projectId); installations.delete(removed.projectId); }
      for (const material of result.projects) if (!entries.has(material.scope.projectId)) await openProject(material.scope);
      const presetMap = new Map(presets.map(value => [value.id, value])); for (const id of result.delta.presets.remove) presetMap.delete(id);
      for (const value of result.presets) presetMap.set(value.id, value);
      presets = lifecycle.catalog().presets.map(row => presetMap.get(row.id)!);
      const importMap = new Map(imports.map(value => [value.id, value])); for (const id of result.delta.pendingImports.remove) importMap.delete(id);
      for (const value of result.pendingImports) importMap.set(value.id, value);
      imports = lifecycle.catalog().pendingImports.map(row => importMap.get(row.id)!);
      if (presets.some(value => !value) || imports.some(value => !value)) throw Error('Missing catalog material');
      publish();
    } finally { work.dispose(); }
  }
  function metadata(id: string, patch: Partial<Pick<WorkspaceProject, 'name' | 'cloud'>>) {
    const value = entry(id), project = { ...value.project, ...patch }; inheritInstalledProjectAuthority(project, value.project); value.project = project; publish();
  }
  const commit: WorkspaceCommit = createWorkspaceCommandDispatcher({
    document(command) { const result = incremental.document(command); if (getCommandQueueReceipt(command) && command.linkedProjectName) metadata(command.authority.id, command.linkedProjectName); return result; },
    preferences: command => incremental.preferences(command), replacement(command) { const result = incremental.replacement(command); if (getCommandQueueReceipt(command) && command.linkedProjectName) metadata(command.authority.id, command.linkedProjectName); return result; },
    metadata(command) { const result = incremental.metadata(command); if (getCommandQueueReceipt(command)) metadata(command.authority.id, command.patch); return result; },
    workspace: command => lifecycle.workspace(command),
    snapshot: async () => { throw new WorkspaceStoreError('Whole-project autosaves are disabled for normalized editing.', 'validation'); },
  });
  try { publish(() => { current(); startup?.assertCurrent(); }); }
  catch (error) { lifecycle.dispose(); incremental.dispose(); throw error; }

  async function recover(nextClient: WorkspaceWorkerClient, snapshot: WorkspaceSnapshot, remainBlocked: boolean,
    continuation?: { binding: WorkspaceBinding; assertCurrent(): void }) {
    if (recovering) throw new WorkspaceStoreError('Recovery already running.', 'authority-lost'); recovering = true; blocked = true;
    const check = () => { current(); continuation?.assertCurrent(); if (continuation && !isWorkspaceWorkerClientLive(nextClient)) throw new WorkspaceStoreError('Recovery worker stopped.', 'authority-lost'); };
    const custody = retryCustody ??= { client, checkpoint: incremental.queue.freeze('Verified restart'), retained: lifecycle.dispose() };
    const { client: originalClient, checkpoint, retained } = custody;
    clients.add(nextClient);
    let candidateQueue: ReturnType<typeof createIncrementalCommandAdmission> | undefined;
    let candidateLifecycle: Awaited<ReturnType<typeof createWorkspaceCommandAdmission>> | undefined;
    let adopted = false;
    try {
      await checkpoint.whenQuiescent; check(); client = nextClient; transport = createWorkspaceEditingTransport(client);
      const startup = continuation ? undefined : takeStartupEditingAdmission(client, snapshot);
      snapshot = startup?.active.snapshot ?? snapshot;
      const fresh = continuation?.binding ?? startup?.workspace ?? await client.request({ type: 'workspace-bootstrap', storageGeneration: generation });
      if (fresh.type !== 'workspace-bootstrapped') throw new WorkspaceStoreError('Fresh workspace admission failed.', 'authority-lost');
      workspaceBinding = fresh; const stamps = [];
      if (continuation) {
        // Only a correlated live-worker continuation can enter here. Install
        // metadata for existing sources; it supplies no replacement snapshots.
        const work = createWorkRuntime({ assertCurrent: check }), byId = new Map<string, typeof fresh.projectAuthorities[number]>();
        try {
          requireFrame(fresh.catalog.storageGeneration === generation && fresh.projectAuthorities.length === fresh.catalog.members.length);
          for (const raw of fresh.projectAuthorities) await work.run(effect(32, () => {
            const row = frameFields(raw, ['scope', 'authority']), scope = frameFields(row.scope, ['storageGeneration', 'projectId', 'incarnation']);
            const stamp = frameFields(row.authority, ['documentRevision', 'preferenceRevision', 'foldStructureGeneration']);
            for (const value of Object.values(scope)) requireFrame(typeof value === 'string' && value.length > 0);
            for (const value of Object.values(stamp)) counter(value);
            const previous = entries.get(scope.projectId as string);
            requireFrame(previous && sameScope(previous.scope, row.scope as ProjectScope) && !byId.has(previous.project.id));
            byId.set(previous.project.id, raw); stamps.push(raw);
          }));
          const seen = new Set<string>();
          for (const scope of fresh.catalog.members) await work.run(effect(24, () => {
            const row = byId.get(scope.projectId), previous = entries.get(scope.projectId);
            requireFrame(row && previous && sameScope(row.scope, scope) && !seen.has(scope.projectId)); seen.add(scope.projectId);
            const binding = { type: 'bootstrapped' as const, scope: { ...scope }, admissionId: fresh.admissionId, authority: { ...row.authority } };
            installations.set(scope.projectId, { source: previous.binding.source, transport, binding, editorGenerationFloor: 0 });
          }));
        } finally { work.dispose(); }
      } else for (const scope of fresh.catalog.members) stamps.push(await openProject(scope, true, startup));
      workspaceBinding = { ...fresh, projectAuthorities: stamps };
      const projects: QueueRecoveryProject[] = [];
      for (const previous of checkpoint.projects) {
        const scope = previous.authority.binding.scope, authority = installations.get(scope.projectId);
        if (!authority || !fresh.catalog.members.some(member => sameScope(member, scope))) continue;
        const resolutions = [];
        for (const original of previous.attempts) {
          const attempt = original.attempt, request = attempt.lane === 'replacement' ? { type: 'inspect-replacement' as const, batch: attempt.batch }
            : { type: 'inspect-commit' as const, attempt };
          let inspection; try { inspection = await originalClient.request(request); } catch { inspection = await client.request(request); }
          check();
          if (inspection.type !== 'commit-inspection' && inspection.type !== 'replacement-inspection') throw new WorkspaceStoreError('Save outcome unavailable.', 'authority-lost');
          if (continuation && inspection.result.type !== 'not-committed') throw new WorkspaceStoreError('Rollback outcome changed.', 'authority-lost');
          resolutions.push({ attempt, inspection });
        }
        projects.push({ previous, authority, resolutions });
      }
      const next = createIncrementalCommandAdmission({ ...queueOptions(), recovery: { retained: checkpoint, projects } }); candidateQueue = next;
      const candidate = await createWorkspaceCommandAdmission({ ...lifecycleOptions(retained), assertCurrent: check, queue: next.queue }); candidateLifecycle = candidate;
      check(); startup?.assertCurrent();
      incremental = next; lifecycle = candidate; retryCustody = undefined; candidateQueue = undefined; adopted = true;
      await candidate.resumeRecovery((scope, writes, queue) => next.prepareWriteRecovery(writes, queue, installations, () => entries.get(scope.projectId)?.project,
        command => {
          switch (command.type) {
            case 'save-document-changes': return commit(command);
            case 'save-editor-preferences': return commit(command);
            case 'update-project-metadata': return commit(command);
            case 'replace-document': return commit(command);
          }
        }));
      for (const [id, value] of entries) if (!fresh.catalog.members.some(scope => sameScope(scope, value.scope))) { entries.delete(id); installations.delete(id); }
      presets = snapshot.customPresets; imports = snapshot.pendingImports;
      for (const previous of clients) if (previous !== client) { previous.dispose(); clients.delete(previous); }
      publish(() => { check(); if (!isWorkspaceWorkerClientLive(client)) throw new WorkspaceStoreError('Recovery worker stopped.', 'authority-lost'); blocked = remainBlocked; });
    } finally {
      if (!adopted && candidateQueue && candidateLifecycle) {
        const checkpoint = candidateQueue.dispose(), retained = candidateLifecycle.dispose();
        retryCustody = { client: originalClient, checkpoint, retained };
        candidateQueue = undefined; candidateLifecycle = undefined;
      }
      candidateQueue?.dispose(); if (!adopted) candidateLifecycle?.dispose();
      if (!adopted && nextClient !== originalClient) { nextClient.dispose(); clients.delete(nextClient); } recovering = false;
    }
  }
  const api = {
    commit, getSnapshot: () => view, subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    project: (id: string) => entry(id).project, bindingFor: (id: string) => entry(id).binding,
    flush: (id?: string) => incremental.flush(id),
    registerWriter(id: string, writer: IncrementalProjectWrites) {
      const value = entry(id), unregister = lifecycle.registerWrites(value.scope, writer.writeOwner); value.writer = writer; publish();
      return () => { unregister(); if (value.writer?.writeOwner === writer.writeOwner) { value.writer = undefined; publish(); } };
    },
    noteWriter(id: string, writer: IncrementalProjectWrites) { const value = entry(id); value.writer = writer;
      const old = view.saveStates.get(id), oldPreferences = view.preferenceStates.get(id);
      if (old !== writer.documentState || oldPreferences !== writer.preferenceState) publish(); },
    persistEditor(id: string, generation: number | undefined, submit: () => Promise<boolean>) {
      const value = entry(id); return lifecycle.persistEditor(value.scope, value.binding.source, generation, submit);
    },
    readProject(id: string, expectedEpoch?: number): WorkspaceProject {
      const value = entry(id, expectedEpoch), working = value.working;
      const initialState = working ? working.exportState() : value.project.initialState;
      if (entry(id, expectedEpoch) !== value || value.working !== working) throw new WorkspaceStoreError('Export source changed.', 'authority-lost');
      return { ...value.project, initialState };
    },
    readWorkingWorkspace(): WorkspaceSnapshot { return { ...view.workspace, projects: view.workspace.projects.map(project => api.readProject(project.id)) }; },
    async commitStructural(command: StructuralWorkspaceCommand, expectedEpoch?: number) {
      current(); if (blocked) throw new WorkspaceStoreError('Local editing is paused.', 'authority-lost');
      if (command.type === 'recover-legacy-as-copies') throw new WorkspaceStoreError('Separate source confirmation required.', 'validation');
      if (command.type === 'close-project') entry(command.projectId, expectedEpoch);
      const result = await lifecycle.workspace({ type: 'workspace-lifecycle', intent: command }); await apply(result); return result;
    },
    async updateProject(id: string, update: (project: WorkspaceProject) => WorkspaceProject, expectedEpoch?: number): Promise<boolean> {
      try {
        const value = entry(id, expectedEpoch); editable(value); if (!value.writer || !value.working) return false;
        const before = api.readProject(id), next = update(before); editable(value); if (entry(id, expectedEpoch) !== value || next.id !== id) return false;
        if (next.initialState !== before.initialState) {
          const prepared = await options.prepareProject(next); editable(value); if (entry(id, expectedEpoch) !== value) return false;
          value.working.replace(prepared.initialState);
        }
        const patch: Partial<Pick<WorkspaceProject, 'name' | 'cloud'>> = {};
        if (next.name !== before.name) patch.name = next.name;
        if (next.cloud !== before.cloud) patch.cloud = next.cloud;
        const saving = Object.keys(patch).length ? value.writer.updateMetadata(id, patch, value.epoch) : Promise.resolve(true);
        const cut = value.writer.capturePersistenceCut(id, value.working.generation());
        await incremental.flush(id); return await saving && await cut;
      } catch { return false; }
    },
    retryProject: options.retry,
    pause() { blocked = true; publish(); return incremental.queue.freeze('Workspace paused'); },
    async exclusiveRead<T>(read: () => Promise<T>): Promise<T> {
      if (blocked) return read();
      return incremental.queue.workspaceBarrier({ targets: [], retireScopes: [], run: async () => ({ type: 'completed', value: await read() }) });
    },
    async tryResumeAborted(assertSourceCurrent: () => void): Promise<boolean> {
      if (probingRollback || recovering || retryCustody || !isWorkspaceWorkerClientLive(client) || lifecycle.blockedAttempt()) return false;
      probingRollback = true; let accepted = false; const originalClient = client;
      const check = () => { current(); assertSourceCurrent(); if (client !== originalClient) throw new WorkspaceStoreError('Retry worker changed.', 'authority-lost'); };
      try {
        check(); const checkpoint = incremental.queue.freeze('Explicit rollback retry'); await checkpoint.whenQuiescent; check();
        let attempts = 0;
        for (const previous of checkpoint.projects) {
          for (const original of previous.attempts) {
            if (original.attempt.lane === 'replacement') return false;
            const inspection = await client.request({ type: 'inspect-commit', attempt: original.attempt }); check();
            if (inspection.type !== 'commit-inspection' || inspection.result.type !== 'not-committed') return false;
            attempts++;
          }
        }
        if (!attempts) return false;
        const response = await client.request({ type: 'workspace-resume-aborted', storageGeneration: generation, admissionId: workspaceBinding.admissionId }); check();
        if (response.type !== 'workspace-resumed') return false;
        accepted = true;
        await recover(client, view.workspace, true, { binding: { ...response, type: 'workspace-bootstrapped' }, assertCurrent: check });
        return true;
      } catch (error) { if (accepted) throw error; check(); return false; }
      finally { probingRollback = false; }
    },
    async restart(nextClient: WorkspaceWorkerClient, snapshot: WorkspaceSnapshot, remainBlocked = false) {
      if (probingRollback) throw new WorkspaceStoreError('Rollback continuation is running.', 'authority-lost');
      return recover(nextClient, snapshot, remainBlocked);
    },
    hasWorkingOwners: () => [...entries.values()].some(value => value.working !== undefined),
    ownsClient: (value: WorkspaceWorkerClient) => clients.has(value),
    getLifecycle: () => lifecycle,
    async validateRecoverySource(recoveryId: string, source: LegacySnapshot, sourceDigest: string) {
      current(); const catalog = lifecycle.catalog();
      const response = await client.request({ type: 'workspace-recovery-prepare', admissionId: workspaceBinding.admissionId,
        batch: { storageGeneration: generation, identity: { clientId: options.uuid(), commandId: options.uuid(), commandSequence: 1 },
          expected: catalog.stamp, targets: [], intent: { type: 'recover-legacy-as-copies', recoveryId, source, sourceDigest } } });
      if (response.type !== 'workspace-recovery-prepared') return false;
      await client.request({ type: 'workspace-recovery-discard', admissionId: workspaceBinding.admissionId,
        preparationId: response.preparationId, storageGeneration: generation }); current(); return true;
    },
    unblock() { current(); blocked = false; publish(); },
    applyRecovery: apply,
    dispose() { if (disposed) return; disposed = true; lifecycle.dispose(); incremental.dispose(); for (const value of clients) { value.dispose(); clients.delete(value); }
      for (const listener of listeners) listeners.delete(listener); },
  };
  return api;
}
