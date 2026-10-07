import { expect } from 'vitest';
import { createNormalizationHarness } from './normalizationHarness';
import { makeIncrementalProject } from './incrementalFixtures';
import { LEGACY_KEYS } from './localWorkspaceFixtures';
import { applyWorkspaceCatalogDeltaWork } from '../../services/localWorkspace/workspaceCatalog';
import { createWorkRuntime } from '../../shared/cooperativeWork.js';
import type { DocumentSaveAck, PreferenceSaveAck, ProjectScope } from '../../services/localWorkspace/normalized/schema';
import type { WorkspaceBatch, WorkspaceLifecycleIntent, WorkspaceTarget, WorkspaceRepositoryMethods } from '../../services/localWorkspace/normalized/workspaceCommands';
import { createWorkspaceWorkerHandler } from '../../services/localWorkspace/normalized/coordinator';
import { createWorkspaceWorkerClient, type WorkspaceWorkerPort } from '../../services/localWorkspace/workspaceWorkerClient';
import { sameScope, type WorkspaceWorkerRequestEnvelope, type WorkspaceWorkerResponseEnvelope } from '../../services/localWorkspace/workspaceWorkerProtocol';
import { createIncrementalCommandAdmission } from '../../services/localWorkspace/incrementalCommandAdmission';
import type { InstalledQueueAuthority } from '../../services/localWorkspace/incrementalQueue';
import { NORMALIZED_STORE_NAMES, type NormalizedProject, type ProjectStoreName } from '../../services/localWorkspace/normalized/schema';
import { physicalRows } from './normalizationHarness';
import { reconstructProjectWork } from '../../services/localWorkspace/normalized/codec';
import { registerInstalledProjectAuthority, advanceInstalledProjectAuthorityFromAck } from '../../services/localWorkspace/projectAuthority';
import type { WorkspaceProject } from '../../services/localWorkspace/contracts';
import { createProjectInstallationRegistry } from '../../services/localWorkspace/projectInstallationRegistry';

const lifecycleModules = import.meta.glob<typeof import('../../services/localWorkspace/workspaceCommandAdmission')>('../../services/localWorkspace/workspaceCommandAdmission.ts');

/** Real normalization/command path only; no synthetic lifecycle writes. */
export async function createWorkspaceCommandHarness() {
  const a = makeIncrementalProject(2), b = { ...makeIncrementalProject(2), id: 'second' };
  const h = await createNormalizationHarness({ legacyValues: {
    [LEGACY_KEYS.projects]: JSON.stringify([a, b]), [LEGACY_KEYS.activeProject]: a.id,
  } });
  expect((await h.run()).status).toBe('active');
  const repository = h.repository as typeof h.repository & WorkspaceRepositoryMethods;
  const admission = await repository.admitWorkspace();
  let catalog = admission.catalog, sequence = 0;
  const authorities = new Map(admission.projectAuthorities.map(row => [row.scope.projectId, row]));
  const request = (intent: WorkspaceLifecycleIntent): WorkspaceBatch => {
    const targets: WorkspaceTarget[] = [];
    if (intent.type === 'activate-project' || intent.type === 'close-project') {
      const scope = catalog.members.find(row => row.projectId === intent.projectId);
      if (!scope) throw new Error('Fixture target missing');
      targets.push(intent.type === 'activate-project' ? { type: 'member', scope }
        : { type: 'lineage', scope, authority: authorities.get(scope.projectId)!.authority });
    }
    const commandSequence = ++sequence;
    return { storageGeneration: catalog.storageGeneration, expected: catalog.stamp, targets,
      identity: { clientId: 'workspace-test', commandSequence, commandId: `workspace-${commandSequence}` }, intent };
  };
  const commit = async (intent: WorkspaceLifecycleIntent) => {
    expect(typeof repository.commitWorkspace).toBe('function');
    const result = await repository.commitWorkspace(admission.token, request(intent));
    const work = createWorkRuntime({ assertCurrent() {} });
    try { catalog = await work.run(applyWorkspaceCatalogDeltaWork(catalog, result.delta)); }
    finally { work.dispose(); }
    for (const removed of result.delta.removed) authorities.delete(removed.projectId);
    for (const added of result.projects) authorities.set(added.scope.projectId, { scope: added.scope, authority: added.authority });
    return result;
  };
  const noteAck = (scope: ProjectScope, ack: DocumentSaveAck | PreferenceSaveAck) => {
    const previous = authorities.get(scope.projectId)!;
    expect(previous.scope).toEqual(scope);
    expect([ack.projectId, ack.incarnation]).toEqual([scope.projectId, scope.incarnation]);
    authorities.set(scope.projectId, { scope, authority: { ...previous.authority,
      ...(ack.type === 'document-saved' ? { documentRevision: ack.revision } : { preferenceRevision: ack.preferenceRevision }),
      foldStructureGeneration: ack.foldStructureGeneration } });
  };
  return { ...h, repository, a, b, admission, request, commit, noteAck, catalog: () => catalog };
}

/** Real normalization, structured-cloned transport and shared private queue. */
export async function createWorkspaceLifecycleHarness(factory?: typeof import('../../services/localWorkspace/workspaceCommandAdmission').createWorkspaceCommandAdmission,
  registryFactory = createProjectInstallationRegistry) {
  expect(Object.keys(lifecycleModules), 'private lifecycle owner module').toHaveLength(1);
  const createWorkspaceCommandAdmission = factory ?? (await Object.values(lifecycleModules)[0]()).createWorkspaceCommandAdmission;
  const h = await createWorkspaceCommandHarness();
  const messages: WorkspaceWorkerRequestEnvelope[] = [], responses: WorkspaceWorkerResponseEnvelope[] = [];
  const workers: ReturnType<typeof makePort>[] = [];
  function makePort() {
    const handler = createWorkspaceWorkerHandler(h.environment), listeners = new Map<string, Set<(event: any) => void>>(); let stopped = false;
    const emit = (type: string, event: unknown) => { for (const listener of listeners.get(type) ?? []) listener(event); };
    const control = { handler, drop: false, transform: (response: WorkspaceWorkerResponseEnvelope) => response,
      port: { postMessage(message: WorkspaceWorkerRequestEnvelope) {
        const captured = structuredClone(message); messages.push(captured);
        void handler.handle(captured).then(response => {
          responses.push(structuredClone(response));
          if (!stopped && !control.drop) emit('message', { data: structuredClone(control.transform(response)) });
        }, error => { if (!stopped) emit('error', { error }); });
      }, addEventListener(type: string, listener: (event: any) => void) {
        const set = listeners.get(type) ?? new Set(); set.add(listener); listeners.set(type, set);
      }, removeEventListener(type: string, listener: (event: any) => void) { listeners.get(type)?.delete(listener); },
      terminate() { stopped = true; handler.dispose(); },
      } satisfies WorkspaceWorkerPort };
    return control;
  }
  const clients: ReturnType<typeof createWorkspaceWorkerClient>[] = [];
  const freshClient = () => { const value = createWorkspaceWorkerClient(() => { const worker = makePort(); workers.push(worker); return worker.port; }); clients.push(value); return value; };
  let client = freshClient();
  const binding = await client.request({ type: 'workspace-bootstrap', storageGeneration: h.catalog().storageGeneration });
  if (binding.type !== 'workspace-bootstrapped') throw Error('Workspace bootstrap failed');
  const storageGeneration = binding.catalog.storageGeneration;
  const installed = registryFactory(binding.catalog.storageGeneration), working = new Map<string, WorkspaceProject>();
  let owner: Awaited<ReturnType<typeof createWorkspaceCommandAdmission>> | undefined, current = true, sequence = 0;
  const published: Parameters<Parameters<typeof createWorkspaceCommandAdmission>[0]['onCatalog']>[0][] = [];
  const incrementalOptions = {
    clock: { now: () => Date.now(), setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay), clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    uuid: () => `project-${++sequence}`, resolveAuthority: (id: string) => installed.get(id),
    observeProject: (event: import('../../services/localWorkspace/incrementalQueue').QueueEvent) => owner?.observeProject(event),
    onEvent(event: import('../../services/localWorkspace/incrementalQueue').QueueEvent) {
      if (event.type === 'acknowledged' && event.ack.type !== 'preferences-saved') {
        const project = working.get(event.ack.projectId); if (project) advanceInstalledProjectAuthorityFromAck(project, project, event.ack);
      }
    } };
  let incremental = createIncrementalCommandAdmission({ ...incrementalOptions, transport: client });
  let options: Parameters<typeof createWorkspaceCommandAdmission>[0] = { binding, queue: incremental.queue, transport: client,
    installations: installed,
    clientId: 'lifecycle-test', uuid: () => `lifecycle-${++sequence}`, assertCurrent() { if (!current) throw Error('Owner changed'); },
    resolveInstalled: scope => installed.get(scope.projectId), onCatalog(result) { published.push(result); } };
  owner = await createWorkspaceCommandAdmission(options);
  const readRecords = async (scope: ProjectScope): Promise<NormalizedProject> => {
    const stores = NORMALIZED_STORE_NAMES.filter((name): name is ProjectStoreName => name !== 'normalizationLedger');
    const rows = await physicalRows(h, stores), records = { scope, normalizationLedger: new Map() } as NormalizedProject;
    for (const store of stores) Object.assign(records, { [store]: new Map(rows[store]
      .filter(row => row.key[0] === scope.storageGeneration && row.key[1] === scope.projectId
        && (store === 'projectHeaders' ? row.incarnation : row.key[2]) === scope.incarnation)
      .map(row => [JSON.stringify(row.key), row])) });
    return records;
  };
  const install = async (scope: ProjectScope, records?: NormalizedProject) => {
    const image = records ?? await readRecords(scope), reply = await client.request({ type: 'bootstrap', project: image });
    if (reply.type !== 'bootstrapped') throw Error('Project bootstrap failed');
    const work = createWorkRuntime({ assertCurrent() {} }); let project: WorkspaceProject;
    try { project = await work.run(reconstructProjectWork(image)); } finally { work.dispose(); }
    const source = registerInstalledProjectAuthority(project, { incarnation: scope.incarnation, revision: reply.authority.documentRevision });
    const authority: InstalledQueueAuthority = { source, transport: client, binding: reply, editorGenerationFloor: 0 };
    installed.set(scope.projectId, authority); working.set(scope.projectId, project); return { project, authority };
  };
  async function restart({ terminateOld = true } = {}) {
    const originalClient = client;
    const checkpoint = incremental.queue.freeze('Fixture transport restart'), retained = owner!.dispose();
    await checkpoint.whenQuiescent;
    if (terminateOld) client.dispose();
    const nextClient = freshClient(), nextBinding = await nextClient.request({ type: 'workspace-bootstrap', storageGeneration });
    if (nextBinding.type !== 'workspace-bootstrapped') throw Error('Restart workspace bootstrap failed');
    for (const scope of nextBinding.catalog.members) {
      const previous = installed.get(scope.projectId); if (!previous) continue;
      const reply = await nextClient.request({ type: 'bootstrap', project: await readRecords(scope) });
      if (reply.type !== 'bootstrapped') throw Error('Restart project bootstrap failed');
      installed.set(scope.projectId, { ...previous, transport: nextClient, binding: reply });
    }
    const projects = await Promise.all(checkpoint.projects.filter(previous => nextBinding.catalog.members.some(scope => sameScope(scope, previous.authority.binding.scope)))
      .map(async previous => ({ previous, authority: installed.get(previous.authority.binding.scope.projectId)!,
        resolutions: await Promise.all(previous.attempts.map(async original => {
          const attempt = original.attempt;
          const inspection = await (terminateOld ? nextClient : originalClient).request(attempt.lane === 'replacement'
            ? { type: 'inspect-replacement', batch: attempt.batch } : { type: 'inspect-commit', attempt });
          if (inspection.type !== 'commit-inspection' && inspection.type !== 'replacement-inspection') throw Error('Restart commit inspection failed');
          return { attempt: original.attempt, inspection };
        })) })));
    const next = createIncrementalCommandAdmission({ ...incrementalOptions, transport: nextClient, recovery: { retained: checkpoint, projects } });
    const nextOptions = { ...options, binding: nextBinding, transport: nextClient, queue: next.queue, recovery: retained };
    try {
      const candidate = await createWorkspaceCommandAdmission(nextOptions);
      owner = candidate; incremental = next; client = nextClient; options = nextOptions;
      return { owner: candidate, resume: () => candidate.resumeRecovery((scope, writes, queue) =>
        next.prepareWriteRecovery(writes, queue, installed, () => working.get(scope.projectId))) };
    } catch (error) { next.dispose(); nextClient.dispose(); throw error; }
  }
  return { ...h, get client() { return client; }, workers, messages, responses, binding, get options() { return options; }, published, installed, working,
    get incremental() { return incremental; }, get lifecycle() { return owner!; }, restart,
    createWorkspaceCommandAdmission, install, readRecords, setCurrent(value: boolean) { current = value; },
    dispose() { owner?.dispose(); incremental.dispose(); for (const value of clients) value.dispose(); h.adapter.close(); } };
}
