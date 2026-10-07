// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createNormalizationHarness, physicalRows, mutateRow } from '../../../helpers/normalizationHarness';
import { makeWorkHarness } from '../../../helpers/normalizationWorkHarness';
import { createWorkspaceEditingSession } from '../../../../services/localWorkspace/workspaceEditingSession';
import { partitionState } from '../../../../services/document/partition';
import * as workerClientModule from '../../../../services/localWorkspace/workspaceWorkerClient';
import { createWorkspaceWorkerHandler } from '../../../../services/localWorkspace/normalized/coordinator';
import { createWorkspaceWorkerClient, type WorkspaceWorkerPort } from '../../../../services/localWorkspace/workspaceWorkerClient';
import { normalizeWorkspace } from '../../../../services/localWorkspace/normalized/migration';
import type { WorkspaceWorkerRequestEnvelope } from '../../../../services/localWorkspace/workspaceWorkerProtocol';

const modules = import.meta.glob<typeof import('../../../../services/localWorkspace/workspaceStartup')>('../../../../services/localWorkspace/workspaceStartup.ts');
let h: Awaited<ReturnType<typeof createNormalizationHarness>>, handler: ReturnType<typeof createWorkspaceWorkerHandler>,
  client: ReturnType<typeof createWorkspaceWorkerClient>, messages: WorkspaceWorkerRequestEnvelope[];
let transform: (value: any) => any;
beforeEach(async context => {
  transform = value => value;
  h = await createNormalizationHarness(); await h.adapter.open(); handler = createWorkspaceWorkerHandler(h.environment); messages = [];
  const listeners = new Map<string, Set<(event: any) => void>>();
  const port: WorkspaceWorkerPort = {
    postMessage(input) { const captured = structuredClone(input); messages.push(captured); void handler.handle(captured).then(
      data => { for (const listen of listeners.get('message') ?? []) listen({ data: transform(structuredClone(data)) }); },
      error => { for (const listen of listeners.get('error') ?? []) listen({ error }); }); },
    addEventListener(type, listener) { const set = listeners.get(type) ?? new Set(); set.add(listener); listeners.set(type, set); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); }, terminate() { handler.dispose(); },
  };
  client = createWorkspaceWorkerClient(() => port);
  if (context.task.name.startsWith('coupled')) expect((await h.run()).status).toBe('active');
});
afterEach(() => { client?.dispose(); h?.adapter.close(); });

it('normalizes through the actual worker with browser source fences and correlated progress continuations', async () => {
  expect(Object.keys(modules), 'worker startup facade').toHaveLength(1);
  const { createWorkspaceStartupRepository } = await Object.values(modules)[0]();
  const progress: unknown[] = [], repository = createWorkspaceStartupRepository(client, { onProgress: value => progress.push(value) });
  const result = await normalizeWorkspace({ repository, historical: h.historical, ensurePhysicalLayout: () => h.adapter.open() });
  expect(result.status).toBe('active'); expect(progress.length).toBeGreaterThan(0);
  expect(messages.some(row => row.request.type === 'normalization-continue')).toBe(true);
  expect((await physicalRows(h, ['normalizationLedger'])).normalizationLedger[0].state).toBe('active');
});

it('ordinary worker requests cannot interleave with an open startup owner', async () => {
  const opened = await client.request({ type: 'normalization-open' });
  expect(opened.type).toBe('normalization-opened');
  if (opened.type !== 'normalization-opened') throw Error('fixture');
  const response = await client.request({ type: 'workspace-bootstrap', storageGeneration: 'not-admitted' });
  expect(response).toMatchObject({ type: 'failed', code: 'ingress-required', outcome: 'not-started' });
  await expect(client.request({ type: 'normalization-close', sessionId: opened.sessionId })).resolves.toMatchObject({ type: 'normalization-closed' });
});

it('rejects stale startup continuation without turning it into another operation', async () => {
  const opened = await client.request({ type: 'normalization-open' });
  expect(opened.type).toBe('normalization-opened');
  if (opened.type !== 'normalization-opened') throw Error('fixture');
  await expect(client.request({ type: 'normalization-continue', sessionId: opened.sessionId, operationId: 999 })).resolves.toMatchObject({ type: 'failed' });
});

it('opens a real project under workspace authority without round-tripping normalized records through the UI', async () => {
  expect((await h.run()).status).toBe('active');
  const active = await h.repository.readActiveSnapshot();
  const workspace = await client.request({ type: 'workspace-bootstrap', storageGeneration: active!.authority.storageGeneration });
  expect(workspace.type).toBe('workspace-bootstrapped');
  if (workspace.type !== 'workspace-bootstrapped') throw Error('fixture');
  const scope = workspace.catalog.members[0];
  const opened = await client.request({ type: 'open-project', workspaceAdmissionId: workspace.admissionId, scope });
  expect(opened.type).toBe('project-opened');
  if (opened.type !== 'project-opened') throw Error('fixture');
  expect(opened.project).toEqual(active!.snapshot.projects[0]); expect(opened).not.toHaveProperty('records');
  const saved = await client.request({ type: 'document-batch', admissionId: opened.admissionId, batch: { scope,
    clientId: 'startup-test', commitId: 'edit-1', commitGeneration: 1, editorGeneration: 1, expectedRevision: opened.authority.documentRevision,
    changes: [{ type: 'put-node', node: { ...opened.project.initialState.nodes.root, title: 'Changed record only' } }] } });
  expect(saved).toMatchObject({ type: 'document-result', ack: { revision: opened.authority.documentRevision + 1 } });
});

it('coupled admission is one-use and bound to the exact client and snapshot; its project can save', async () => {
  const { createWorkspaceStartupRepository, takeStartupEditingAdmission } = await Object.values(modules)[0]();
  const repository = createWorkspaceStartupRepository(client, { forEditing: true }), work = makeWorkHarness().runtime;
  const session = repository.openNormalizationSession(work), active = await session.reopen(); await session.dispose();
  expect(active).toBeDefined();
  expect(takeStartupEditingAdmission({ ...client }, active!.snapshot)).toBeUndefined();
  expect(takeStartupEditingAdmission(client, { ...active!.snapshot })).toBeUndefined();
  const receipt = takeStartupEditingAdmission(client, active!.snapshot)!;
  expect(receipt.workspace.catalog.members).toHaveLength(active!.snapshot.projects.length);
  expect(takeStartupEditingAdmission(client, active!.snapshot)).toBeUndefined();
  const bound = receipt.projects[0], project = active!.snapshot.projects.find(value => value.id === bound.scope.projectId)!;
  await expect(client.request({ type: 'document-batch', admissionId: bound.admissionId, batch: {
    scope: bound.scope, clientId: 'coupled', commitId: 'coupled-save', commitGeneration: 1, editorGeneration: 1,
    expectedRevision: bound.authority.documentRevision, changes: [{ type: 'put-node', node: { ...project.initialState.nodes.root, title: 'Coupled save' } }],
  } })).resolves.toMatchObject({ type: 'document-result', ack: { revision: bound.authority.documentRevision + 1 } });
  expect(messages.some(value => value.request.type === 'workspace-bootstrap' || value.request.type === 'open-project' || value.request.type === 'bootstrap')).toBe(false);
});

it('coupled facade read-only exports do not mint editing admission', async () => {
  const { createWorkspaceStartupRepository, takeStartupEditingAdmission } = await Object.values(modules)[0]();
  const repository = createWorkspaceStartupRepository(client, { forEditing: true });
  const active = await repository.readActiveSnapshot();
  expect(active).toBeDefined(); expect(takeStartupEditingAdmission(client, active!.snapshot)).toBeUndefined();
  expect(messages.some(value => value.request.type === 'normalization-step' && value.request.operation === 'editor')).toBe(false);
});

it('coupled startup cancellation closes its paused owner and permits a fresh authenticated attempt', async () => {
  const { createWorkspaceStartupRepository, takeStartupEditingAdmission } = await Object.values(modules)[0]();
  const work = makeWorkHarness().runtime;
  // Hold the trusted read long enough for the worker to publish a progress reply.
  h.environment.normalizationPause = point => point.phase === 'reopen' && point.point === 'after-page'
    ? new Promise(resolve => setTimeout(resolve, 80)) : undefined;
  const repository = createWorkspaceStartupRepository(client, { forEditing: true, onProgress() { work.dispose(); } });
  const session = repository.openNormalizationSession(work);
  await expect(session.reopen()).rejects.toMatchObject({ name: 'AbortError' }); await session.dispose();
  h.environment.normalizationPause = undefined;
  const next = createWorkspaceStartupRepository(client, { forEditing: true }).openNormalizationSession(makeWorkHarness().runtime);
  const active = await next.reopen(); await next.dispose();
  expect(takeStartupEditingAdmission(client, active!.snapshot)).toBeDefined();
});

it('coupled failed revalidation revokes prior project admissions without publishing partial owners', async () => {
  const { createWorkspaceStartupRepository, takeStartupEditingAdmission } = await Object.values(modules)[0]();
  const repository = createWorkspaceStartupRepository(client, { forEditing: true });
  const first = repository.openNormalizationSession(makeWorkHarness().runtime), active = await first.reopen(); await first.dispose();
  const previous = takeStartupEditingAdmission(client, active!.snapshot)!.projects[0];
  const row = (await physicalRows(h, ['projectNodes'])).projectNodes[0]; row.value.title = 'Corrupt without proof';
  await mutateRow(h, 'projectNodes', store => store.put(row));
  const second = repository.openNormalizationSession(makeWorkHarness().runtime);
  await expect(second.reopen()).rejects.toBeDefined(); await second.dispose();
  await expect(client.request({ type: 'document-batch', admissionId: previous.admissionId, batch: {
    scope: previous.scope, clientId: 'stale', commitId: 'must-refuse', commitGeneration: 1, editorGeneration: 1,
    expectedRevision: previous.authority.documentRevision, changes: [{ type: 'put-node', node: row.value }],
  } })).resolves.toMatchObject({ type: 'failed', code: 'stale-admission', outcome: 'not-started' });
});

it.each(['wrapper', 'nested'] as const)('coupled receipt pins verified material against %s replacement', async kind => {
  const { createWorkspaceStartupRepository, takeStartupEditingAdmission } = await Object.values(modules)[0]();
  const session = createWorkspaceStartupRepository(client, { forEditing: true }).openNormalizationSession(makeWorkHarness().runtime);
  const active = await session.reopen(); await session.dispose(); const expected = structuredClone(active!.snapshot);
  if (kind === 'wrapper') active!.snapshot.projects[0] = { ...active!.snapshot.projects[0], name: 'Unverified replacement' };
  else active!.snapshot.projects[0].initialState.nodes.root.title = 'Unverified nested change';
  expect(takeStartupEditingAdmission(client, active!.snapshot)!.active.snapshot).toEqual(expected);
});

it.each(['workspace-id', 'project-id', 'project-scope', 'project-count'] as const)('coupled response refuses mismatched %s before minting a receipt', async kind => {
  const { createWorkspaceStartupRepository } = await Object.values(modules)[0]();
  transform = envelope => {
    if (envelope.response.type === 'normalization-result' && envelope.response.operation === 'editor') {
      const value = envelope.response.value;
      if (kind === 'workspace-id') value.workspace.admissionId += 10000;
      if (kind === 'project-id') value.projects[0].admissionId += 10000;
      if (kind === 'project-scope') value.projects[0].scope = { ...value.projects[0].scope, incarnation: 'forged' };
      if (kind === 'project-count') value.projects.pop();
    }
    return envelope;
  };
  const session = createWorkspaceStartupRepository(client, { forEditing: true }).openNormalizationSession(makeWorkHarness().runtime);
  await expect(session.reopen()).rejects.toBeDefined(); await Promise.resolve(session.dispose()).catch(() => {});
});

it.each(['superseded', 'workspace-reopened', 'project-reopened', 'bulk-replaced', 'disposed'] as const)('coupled receipt cannot publish after its client admission is %s', async kind => {
  const { createWorkspaceStartupRepository, createWorkspaceEditingTransport, takeStartupEditingAdmission } = await Object.values(modules)[0]();
  const repository = createWorkspaceStartupRepository(client, { forEditing: true });
  const first = repository.openNormalizationSession(makeWorkHarness().runtime), active = await first.reopen(); await first.dispose();
  let newer: typeof active;
  if (kind === 'disposed') client.dispose();
  else if (kind === 'workspace-reopened') await client.request({ type: 'workspace-bootstrap', storageGeneration: active!.authority.storageGeneration });
  else if (kind === 'project-reopened' || kind === 'bulk-replaced') {
    const admissionId = [...messages].reverse().find(row => row.request.type === 'normalization-step' && row.request.operation === 'editor')!.requestId;
    const source = active!.authority.sourceProjects[0], scope = { storageGeneration: active!.authority.storageGeneration, projectId: source.projectId, incarnation: source.incarnation };
    if (kind === 'project-reopened') await client.request({ type: 'open-project', workspaceAdmissionId: admissionId, scope });
    else {
      const state = structuredClone(active!.snapshot.projects[0].initialState); state.nodes.root.title = 'Replacement after startup';
      await expect(createWorkspaceEditingTransport(client).request({ type: 'replace-document', admissionId, batch: { scope,
        clientId: 'startup-replacement', commitId: 'replacement', commitGeneration: 1, editorGeneration: 1,
        expected: { documentRevision: source.revision, preferenceRevision: 0, foldStructureGeneration: 0 }, state, preferences: partitionState(state).preferences,
      } })).resolves.toMatchObject({ type: 'replacement-result' });
    }
  }
  else { const next = repository.openNormalizationSession(makeWorkHarness().runtime); newer = await next.reopen(); await next.dispose(); }
  expect(() => takeStartupEditingAdmission(client, active!.snapshot)).toThrow();
  if (newer) expect(takeStartupEditingAdmission(client, newer.snapshot)).toBeDefined();
});

it('coupled startup cannot publish ready after client disposal during asynchronous installation', async () => {
  const { createWorkspaceStartupRepository } = await Object.values(modules)[0]();
  const session = createWorkspaceStartupRepository(client, { forEditing: true }).openNormalizationSession(makeWorkHarness().runtime);
  const active = await session.reopen(); await session.dispose();
  let created: Awaited<ReturnType<typeof createWorkspaceEditingSession>> | undefined, id = 0;
  const pending = createWorkspaceEditingSession(client, active!.snapshot, active!.authority.storageGeneration, {
    uuid: () => `install-${++id}`, assertCurrent() {}, async prepareProject(value) { return value; }, async retry() {},
  }).then(value => { created = value; return value; });
  client.dispose();
  try { await expect(pending).rejects.toBeDefined(); } finally { created?.dispose(); }
});

it('coupled client stop synchronously releases registered startup payload custody once', async () => {
  await client.request({ type: 'normalization-open' });
  const observe = (workerClientModule as any).observeWorkspaceWorkerClientInvalidation;
  expect(observe).toBeTypeOf('function');
  let releases = 0; const remove = observe(client, () => { releases++; });
  client.dispose(); expect(releases).toBe(1); client.dispose(); expect(releases).toBe(1); remove();
});

it('coupled repository releases startup custody on cancellation after the active read without installing project owners', async () => {
  const work = makeWorkHarness(); let reached = false;
  const marker = (await physicalRows(h, ['normalizationLedger'])).normalizationLedger[0];
  h.environment.normalizationPause = point => {
    if (point.phase === 'reopen' && point.point === 'after-page') { reached = true; work.cancel(); }
  };
  await expect(h.repository.openEditingWorkspace(work.runtime)).rejects.toMatchObject({ name: 'AbortError' });
  expect(reached).toBe(true); expect(work.runtime.snapshot().ownedHighWater).toBeGreaterThan(0);
  expect(work.runtime.snapshot().ownedBytes).toBe(0);
  const source = marker.sourceProjects[0];
  expect(() => h.repository.readAdmittedProjectAuthority({ storageGeneration: marker.storageGeneration,
    projectId: source.projectId, incarnation: source.incarnation })).toThrow('ingress-required');
});
