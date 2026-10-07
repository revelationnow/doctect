// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createNormalizedRepository } from '../../../../services/localWorkspace/normalized/repository';
import type { DocumentBatch, PreferenceBatch, NormalizedRecordTypes, ProjectStoreName } from '../../../../services/localWorkspace/normalized/schema';
import { NORMALIZED_STORE_NAMES } from '../../../../services/localWorkspace/normalized/schema';
import { decomposeProject, reconstructProject } from '../../../../services/localWorkspace/normalized/codec';
import { createIncrementalStoreHarness } from '../../../helpers/incrementalStoreHarness';
import { createIncrementalWorkerHarness, workerModules } from '../../../helpers/incrementalWorkerHarness';
import { makeIncrementalProject } from '../../../helpers/incrementalFixtures';
import { testHash } from '../../../helpers/incrementalStoreHarness';
import { describeRequest, requestEnvelope, validateResponse } from '../../../../services/localWorkspace/workspaceWorkerProtocol';
import type { WorkspaceWorkerRequest, WorkspaceWorkerRequestEnvelope, WorkspaceWorkerResponseEnvelope } from '../../../../services/localWorkspace/workspaceWorkerProtocol';
import type { WorkspaceWorkerPort } from '../../../../services/localWorkspace/workspaceWorkerClient';
import { createWorkspaceCommandHarness } from '../../../helpers/workspaceCommandHarness';
import { physicalRows } from '../../../helpers/normalizationHarness';
import { frameWorkspaceBatch, type WorkspaceBatch } from '../../../../services/localWorkspace/normalized/workspaceCommands';

type StoreHarness = Awaited<ReturnType<typeof createIncrementalStoreHarness>>;
afterEach(() => vi.useRealTimers());
const allocateWorkerBuildOutput = (temporaryRoot = tmpdir()) =>
  mkdtempSync(join(temporaryRoot, 'task-8-worker-build-'));

const lifecycleBatch = (): WorkspaceBatch => ({ storageGeneration: 'workspace-generation',
  identity: { clientId: 'workspace-client', commandId: 'workspace-command', commandSequence: 1 },
  expected: { revision: 0, coreDigest: 'a'.repeat(64) }, targets: [],
  intent: { type: 'create-and-activate-project', project: { ...makeIncrementalProject(2), id: 'created' } } });

describe('workspace lifecycle wire framing', () => {
  it.each(['workspace-command', 'inspect-workspace-command'])('preserves expanded-year replacement timestamps through %s', type => {
    const base = lifecycleBatch(), batch: WorkspaceBatch = { ...base, intent: { type: 'replace-staged-import',
      expected: { importId: 'old', targetProjectId: 'old-target', createdAt: '+010000-01-01T00:00:00.000Z',
        sourceKeyDigest: 'a'.repeat(64), payloadDigest: 'b'.repeat(64) },
      replacement: { pendingImport: { id: 'new', targetProjectId: 'new-target', name: 'Import', createdAt: '+010000-01-01T00:00:00.000Z',
        state: makeIncrementalProject(2).initialState }, attemptProvenance: { sourceKeyDigest: 'a'.repeat(64), payloadDigest: 'c'.repeat(64) } } } };
    expect(() => frameWorkspaceBatch(batch)).not.toThrow();
    expect(() => describeRequest({ type, admissionId: 9, batch })).not.toThrow();
    if (batch.intent.type !== 'replace-staged-import') throw Error('Replacement fixture required');
    const intent = batch.intent;
    for (const timestamp of ['+010000-99-01T00:00:00.000Z', '2026-01-01T00:00:00Z', 'x'.repeat(27)]) {
      expect(() => describeRequest({ type, admissionId: 9, batch: { ...batch,
        intent: { ...intent, expected: { ...intent.expected, createdAt: timestamp } } } })).toThrow();
    }
  });

  it.each(['workspace-command', 'inspect-workspace-command'])('rejects undefined occupied result slots through %s', type => {
    // Wire-only fixtures, not successful storage writes. Positive controls exercise each result family.
    const base = lifecycleBatch(), scope = { storageGeneration: base.storageGeneration, projectId: 'created', incarnation: 'incarnation' };
    const after = { revision: 1, coreDigest: 'b'.repeat(64) }, receipt = { identity: base.identity, before: base.expected, after,
      requestDigest: 'c'.repeat(64), postconditionDigest: 'd'.repeat(64), proofDigest: 'e'.repeat(64) };
    for (const [intent, outcome, key, material] of [
      [base.intent, 'created', 'projects', { scope, authority: { documentRevision: 0, preferenceRevision: 0, foldStructureGeneration: 0 }, records: { scope } }],
      [{ type: 'save-custom-preset', preset: {} }, 'preset-saved', 'presets', {}],
      [{ type: 'stage-import', pendingImport: {} }, 'staged', 'pendingImports', {}],
    ] as const) {
      const expected = describeRequest({ type, admissionId: 9, batch: { ...base, intent } });
      const result: any = { type: type === 'workspace-command' ? 'workspace-committed' : 'workspace-inspected-current', outcome,
        receipt, projects: [], presets: [], pendingImports: [] };
      if (type === 'workspace-command') result.delta = { storageGeneration: base.storageGeneration, before: base.expected, after,
        removed: [], added: [], activeProjectId: scope.projectId, presets: { remove: [], upsert: [] }, pendingImports: { remove: [], upsert: [] } };
      else result.catalog = { storageGeneration: base.storageGeneration, stamp: after, members: [scope], activeProjectId: scope.projectId, presets: [], pendingImports: [] };
      result[key] = [material];
      const reply = { protocolVersion: 1, workerEpoch: 1, requestId: 10, context: expected.context, response: type === 'workspace-command'
        ? { type: 'workspace-command-result', admissionId: 9, result }
        : { type: 'workspace-inspection', identity: base.identity, result: { type: 'committed', result } } };
      expect(() => validateResponse(structuredClone(reply), expected, 10, 1)).not.toThrow();
      result[key] = [undefined]; expect(() => validateResponse(structuredClone(reply), expected, 10, 1)).toThrow();
    }
  });

  it('describes separate workspace families without walking bulk payload', () => {
    const batch = lifecycleBatch(), payload = vi.fn(() => { throw Error('payload read'); });
    Object.defineProperty((batch.intent as any).project, 'initialState', { enumerable: true, get: payload });
    for (const type of ['workspace-command', 'inspect-workspace-command']) {
      expect(describeRequest({ type, admissionId: 9, batch }).context).toEqual({ requestType: type, admissionId: 9,
        storageGeneration: batch.storageGeneration, identity: batch.identity, expected: batch.expected });
    }
    expect(describeRequest({ type: 'workspace-bootstrap', storageGeneration: batch.storageGeneration }).context)
      .toEqual({ requestType: 'workspace-bootstrap', storageGeneration: batch.storageGeneration });
    expect(describeRequest({ type: 'workspace-fence', storageGeneration: batch.storageGeneration, admissionId: 9 }).context)
      .toEqual({ requestType: 'workspace-fence', storageGeneration: batch.storageGeneration, admissionId: 9 });
    expect(payload).not.toHaveBeenCalled();
  });

  it.each(['admission', 'generation', 'sequence', 'client', 'stamp', 'overflow', 'digest', 'targets', 'intent', 'extra', 'accessor'])
  ('rejects malformed workspace %s before payload access', field => {
    const request: any = { type: 'workspace-command', admissionId: 9, batch: lifecycleBatch() };
    const getter = vi.fn(() => { throw Error('payload read'); });
    Object.defineProperty(request.batch.intent.project, 'initialState', { enumerable: true, get: getter });
    if (field === 'admission') request.admissionId = 0;
    if (field === 'generation') request.batch.storageGeneration = '';
    if (field === 'sequence') request.batch.identity.commandSequence = Number.MAX_SAFE_INTEGER + 1;
    if (field === 'client') request.batch.identity.clientId = 'x'.repeat(257);
    if (field === 'stamp') request.batch.expected.revision = -1;
    if (field === 'overflow') request.batch.expected.revision = Number.MAX_SAFE_INTEGER;
    if (field === 'digest') request.batch.expected.coreDigest = 'wrong';
    if (field === 'targets') request.batch.targets = [{}];
    if (field === 'intent') request.batch.intent.type = 'save-project';
    if (field === 'extra') request.batch.snapshot = {};
    if (field === 'accessor') Object.defineProperty(request.batch.identity, 'commandId', { enumerable: true, get: getter });
    expect(() => describeRequest(request)).toThrow(); expect(getter).not.toHaveBeenCalled();
  });

  it('accepts long public IDs but rejects target generation, lineage and own-data violations', () => {
    const id = '公'.repeat(300), batch = lifecycleBatch();
    const target = { type: 'lineage', scope: { storageGeneration: batch.storageGeneration, projectId: id, incarnation: 'incarnation' },
      authority: { documentRevision: 0, preferenceRevision: 0, foldStructureGeneration: 0 } };
    const request: any = { type: 'workspace-command', admissionId: 9, batch: { ...batch, targets: [target], intent: { type: 'close-project', projectId: id } } };
    expect(() => describeRequest(request)).not.toThrow();
    for (const change of [(r: any) => { r.batch.targets[0].scope.storageGeneration = 'other'; },
      (r: any) => { r.batch.targets[0].authority.preferenceRevision = -1; },
      (r: any) => { r.batch.targets[0].type = 'member'; }]) {
      const invalid = structuredClone(request); change(invalid); expect(() => describeRequest(invalid)).toThrow();
    }
    const getter = vi.fn(); Object.defineProperty(request.batch.targets, '0', { get: getter });
    expect(() => describeRequest(request)).toThrow(); expect(getter).not.toHaveBeenCalled();
  });

  it('rejects unexpected bulk material in a metadata-only acknowledgement', () => {
    const batch = lifecycleBatch(), scope = { storageGeneration: batch.storageGeneration, projectId: 'selected', incarnation: 'incarnation' };
    const request = { type: 'workspace-command' as const, admissionId: 9, batch: { ...batch,
      intent: { type: 'activate-project' as const, projectId: scope.projectId }, targets: [{ type: 'member' as const, scope }] } };
    const after = { revision: 1, coreDigest: 'b'.repeat(64) };
    const response: any = { protocolVersion: 1, workerEpoch: 1, requestId: 10, context: describeRequest(request).context,
      response: { type: 'workspace-command-result', admissionId: 9, result: { type: 'workspace-committed', outcome: 'activated',
        receipt: { identity: batch.identity, requestDigest: 'c'.repeat(64), before: batch.expected, after,
          postconditionDigest: 'd'.repeat(64), proofDigest: 'e'.repeat(64) },
        delta: { storageGeneration: batch.storageGeneration, before: batch.expected, after, removed: [], added: [],
          activeProjectId: scope.projectId, presets: { remove: [], upsert: [] }, pendingImports: { remove: [], upsert: [] } },
        projects: [], presets: [], pendingImports: [] } } };
    expect(() => validateResponse(response, describeRequest(request), 10, 1)).not.toThrow();
    for (const key of ['projects', 'presets', 'pendingImports']) {
      const wrong = structuredClone(response); wrong.response.result[key] = [{}];
      expect(() => validateResponse(wrong, describeRequest(request), 10, 1)).toThrow();
    }
  });
});

describe('workspace lifecycle real worker', () => {
  let h: Awaited<ReturnType<typeof createWorkspaceCommandHarness>>;
  let modules: Awaited<ReturnType<typeof workerModules>>;
  let client: ReturnType<Awaited<ReturnType<typeof workerModules>>['createWorkspaceWorkerClient']>;
  let worker: ReturnType<typeof makePort>;
  const messages: WorkspaceWorkerRequestEnvelope[] = [], responses: WorkspaceWorkerResponseEnvelope[] = [];
  function makePort() {
    const handler = modules.createWorkspaceWorkerHandler(h.environment);
    const listeners = new Map<string, Set<(event: any) => void>>(); let stopped = false;
    const emit = (type: string, event: unknown) => { for (const listener of listeners.get(type) ?? []) listener(event); };
    const control = { handler, drop: false, hold: false, transform: (response: WorkspaceWorkerResponseEnvelope) => response,
      port: { postMessage(message: WorkspaceWorkerRequestEnvelope) {
        if (stopped) throw Error('terminated'); const captured = structuredClone(message); messages.push(captured);
        if (control.hold) return;
        void handler.handle(captured).then(response => {
          responses.push(structuredClone(response));
          if (!stopped && !control.drop) emit('message', { data: structuredClone(control.transform(response)) });
        }, error => { if (!stopped) emit('error', { error }); });
      }, addEventListener(type: string, listener: (event: any) => void) {
        const set = listeners.get(type) ?? new Set(); set.add(listener); listeners.set(type, set);
      }, removeEventListener(type: string, listener: (event: any) => void) { listeners.get(type)?.delete(listener); },
      terminate: vi.fn(() => { stopped = true; handler.dispose(); }),
      } satisfies WorkspaceWorkerPort };
    return control;
  }
  beforeEach(async () => {
    h = await createWorkspaceCommandHarness(); modules = await workerModules(); messages.length = 0; responses.length = 0;
    worker = makePort(); client = modules.createWorkspaceWorkerClient(() => worker.port);
  });
  afterEach(() => { client?.dispose(); h?.adapter.close(); });
  const bootstrap = async () => {
    const result = await client.request({ type: 'workspace-bootstrap', storageGeneration: h.catalog().storageGeneration });
    expect(result.type).toBe('workspace-bootstrapped');
    if (result.type !== 'workspace-bootstrapped') throw Error('Workspace bootstrap failed');
    return result;
  };
  const command = (admissionId: number, batch: WorkspaceBatch) => client.request({ type: 'workspace-command', admissionId, batch });

  it('admits metadata and creates real material requiring explicit project bootstrap', async () => {
    const bound = await bootstrap();
    expect(bound).toEqual({ type: 'workspace-bootstrapped', admissionId: messages[0].requestId,
      catalog: h.admission.catalog, projectAuthorities: h.admission.projectAuthorities });
    expect(bound).not.toHaveProperty('token');
    const batch = h.request({ type: 'create-and-activate-project', project: { ...makeIncrementalProject(2), id: 'worker-created' } });
    const result = await command(bound.admissionId, batch);
    expect(result).toMatchObject({ type: 'workspace-command-result', admissionId: bound.admissionId, result: { outcome: 'created' } });
    if (result.type !== 'workspace-command-result') throw Error('Workspace command failed');
    const reply = responses.at(-1)!, expected = describeRequest(messages.at(-1)!.request);
    for (const change of [(r: any) => { r.projects[0].scope.storageGeneration = 'wrong'; },
      (r: any) => { r.projects[0].authority.documentRevision = 1; },
      (r: any) => { r.projects[0].records.scope.incarnation = 'wrong'; },
      (r: any) => { r.projects.push(r.projects[0]); }]) {
      const wrong: any = structuredClone(reply); change(wrong.response.result);
      expect(() => validateResponse(wrong, expected, reply.requestId, reply.workerEpoch)).toThrow();
    }
    const material = result.result.projects[0];
    const preferences: Extract<WorkspaceWorkerRequest, { type: 'preferences' }> = { type: 'preferences', admissionId: bound.admissionId, batch: { scope: material.scope,
      clientId: 'ordinary', commitId: 'preferences', commitGeneration: 1, editorGeneration: 1, observedPreferenceRevision: 0, patch: { scale: 2 } } };
    expect(await client.request(preferences)).toMatchObject({ type: 'failed', code: 'stale-admission' });
    const project = await client.request({ type: 'bootstrap', project: material.records });
    expect(project.type).toBe('bootstrapped');
    if (project.type !== 'bootstrapped') throw Error('Project bootstrap failed');
    expect(await client.request({ ...preferences, admissionId: project.admissionId })).toMatchObject({ type: 'preferences-result' });
    expect(await client.request({ type: 'inspect-workspace-command', admissionId: bound.admissionId, batch }))
      .toMatchObject({ type: 'workspace-inspection', result: { type: 'conflict', reason: 'authority-changed' } });
  });

  it('invalidates prior workspace admission after rebootstrap without authorizing queued stale commands', async () => {
    const first = await bootstrap(), batch = h.request({ type: 'activate-project', projectId: h.b.id });
    const rebinding = bootstrap(), stale = command(first.admissionId, batch);
    const second = await rebinding; expect(second.admissionId).not.toBe(first.admissionId);
    expect(await stale).toEqual({ type: 'failed', code: 'stale-admission', outcome: 'not-started', admission: 'none' });
    const result = await command(second.admissionId, batch);
    expect(result).toMatchObject({ type: 'workspace-command-result', result: { outcome: 'activated' } });
    if (result.type !== 'workspace-command-result') throw Error('Activation failed');
    expect(await command(second.admissionId, { ...h.request({ type: 'activate-project', projectId: h.a.id }), expected: result.result.receipt.after }))
      .toMatchObject({ type: 'workspace-command-result' });
    expect(await client.request({ type: 'inspect-workspace-command', admissionId: second.admissionId, batch }))
      .toMatchObject({ type: 'workspace-inspection', result: { type: 'conflict', reason: 'authority-changed' } });
  });

  it.each(['closed', 'preset-saved', 'preset-deleted', 'staged', 'replaced', 'consumed'] as const)
  ('transports real %s lifecycle material without a snapshot fallback', async outcome => {
    const preset = { id: 'preset', title: 'Preset', desc: '', isCustom: true as const, initialState: makeIncrementalProject(2).initialState };
    const pendingImport = { id: 'pending', targetProjectId: 'imported', name: 'Import', state: makeIncrementalProject(2).initialState, createdAt: h.preparation.now() };
    const attemptProvenance = { sourceKeyDigest: testHash('source'), payloadDigest: testHash('old') };
    if (outcome === 'preset-deleted') await h.commit({ type: 'save-custom-preset', preset });
    if (outcome === 'replaced' || outcome === 'consumed') await h.commit({ type: 'stage-import', pendingImport, attemptProvenance });
    const intent: WorkspaceBatch['intent'] = outcome === 'closed' ? { type: 'close-project', projectId: h.b.id }
      : outcome === 'preset-saved' ? { type: 'save-custom-preset', preset }
      : outcome === 'preset-deleted' ? { type: 'delete-custom-preset', presetId: preset.id }
      : outcome === 'staged' ? { type: 'stage-import', pendingImport, attemptProvenance }
      : outcome === 'consumed' ? { type: 'consume-import', importId: pendingImport.id }
      : { type: 'replace-staged-import', expected: { importId: pendingImport.id, targetProjectId: pendingImport.targetProjectId,
        createdAt: pendingImport.createdAt, ...attemptProvenance }, replacement: { pendingImport: { ...pendingImport, id: 'replacement', targetProjectId: 'replacement-project' },
        attemptProvenance: { ...attemptProvenance, payloadDigest: testHash('new') } } };
    const bound = await bootstrap(), result = await command(bound.admissionId, h.request(intent));
    expect(result).toMatchObject({ type: 'workspace-command-result', admissionId: bound.admissionId, result: { outcome } });
    expect(result).not.toHaveProperty('snapshot');
    if (result.type !== 'workspace-command-result') throw Error('Lifecycle command failed');
    expect(result.result.projects).toHaveLength(outcome === 'consumed' ? 1 : 0);
    expect(result.result.presets).toHaveLength(outcome === 'preset-saved' ? 1 : 0);
    expect(result.result.pendingImports).toHaveLength(outcome === 'staged' || outcome === 'replaced' ? 1 : 0);
  });

  it.each(['workspace-first', 'project-first'] as const)('keeps workspace and project requests in one FIFO: %s', async order => {
    const material = (await h.commit({ type: 'create-and-activate-project', project: { ...makeIncrementalProject(2), id: 'fifo' } })).projects[0];
    const project = await client.request({ type: 'bootstrap', project: material.records });
    if (project.type !== 'bootstrapped') throw Error('Project bootstrap failed');
    const bound = await bootstrap(), batch = h.request({ type: 'activate-project', projectId: h.a.id });
    const writes: string[] = []; h.environment.onOperation = op => { if (op.phase === 'write') writes.push('project'); };
    h.environment.onWorkspaceOperation = op => { if (op.phase === 'write') writes.push('workspace'); };
    const save = () => client.request({ type: 'preferences', admissionId: project.admissionId, batch: { scope: material.scope,
      clientId: 'fifo', commitId: 'save', commitGeneration: 1, editorGeneration: 1, observedPreferenceRevision: 0, patch: { scale: 3 } } });
    const activate = () => command(bound.admissionId, batch);
    const results = await Promise.all(order === 'workspace-first' ? [activate(), save()] : [save(), activate()]);
    const types = order === 'workspace-first' ? ['workspace-command-result', 'preferences-result'] : ['preferences-result', 'workspace-command-result'];
    expect(results.map(result => result.type)).toEqual(types); expect(responses.slice(-2).map(row => row.response.type)).toEqual(types);
    expect([...new Set(writes)]).toEqual(order === 'workspace-first' ? ['workspace', 'project'] : ['project', 'workspace']);
  });

  it('rejects invalid requests before posting and preserves the unchanged 30-second unknown-outcome timeout', async () => {
    const batch = h.request({ type: 'activate-project', projectId: h.b.id });
    await expect(command(0, batch)).rejects.toMatchObject({ code: 'invalid-request', outcome: 'not-posted' });
    expect(messages).toEqual([]);
    const bound = await bootstrap(); worker.hold = true; vi.useFakeTimers();
    const pending = command(bound.admissionId, batch).catch(error => error);
    await vi.advanceTimersByTimeAsync(29_999); expect(worker.port.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(await pending).toMatchObject({ code: 'timeout', outcome: 'unknown' });
    expect(worker.port.terminate).toHaveBeenCalledTimes(1); vi.useRealTimers();
    expect((await physicalRows(h, ['workspace'])).workspace[0].revision).toBe(batch.expected.revision);
  });

  it('disposal stops a preparing workspace command and cannot acknowledge its queued fence', async () => {
    const bound = await bootstrap(), batch = h.request({ type: 'activate-project', projectId: h.b.id });
    let interrupted = false;
    h.environment.onWorkspaceOperation = op => {
      if (!interrupted && op.phase === 'prepare-read') { interrupted = true; worker.handler.dispose(); }
    };
    const pending = command(bound.admissionId, batch).catch(error => error);
    const fenced = client.request({ type: 'workspace-fence', storageGeneration: batch.storageGeneration, admissionId: bound.admissionId }).catch(error => error);
    expect(await pending).toMatchObject({ code: 'worker-error', outcome: 'unknown' });
    expect(await fenced).toMatchObject({ code: 'worker-error', outcome: 'unknown' }); expect(interrupted).toBe(true);
    expect(responses.some(row => row.response.type === 'workspace-fenced')).toBe(false);
    expect((await physicalRows(h, ['workspace'])).workspace[0].revision).toBe(batch.expected.revision);
  });

  it('keeps authentic failed-owner fencing separate from a fresh admission', async () => {
    const first = await bootstrap(), batch = h.request({ type: 'activate-project', projectId: h.b.id });
    h.environment.workspaceFault = point => { if (point.phase === 'before-cas') throw Error('abort'); };
    expect(await command(first.admissionId, batch)).toMatchObject({ type: 'failed', outcome: 'unknown' });
    h.environment.workspaceFault = undefined;
    const inspect = (admissionId: number) => client.request({ type: 'inspect-workspace-command', admissionId, batch });
    expect(await inspect(first.admissionId)).toMatchObject({ type: 'workspace-inspection', result: { type: 'unknown' } });
    const next = await bootstrap();
    await client.request({ type: 'workspace-fence', storageGeneration: batch.storageGeneration, admissionId: next.admissionId });
    expect(await inspect(next.admissionId)).toMatchObject({ result: { type: 'unknown' } });
    expect(await client.request({ type: 'workspace-fence', storageGeneration: batch.storageGeneration, admissionId: first.admissionId }))
      .toEqual({ type: 'workspace-fenced', storageGeneration: batch.storageGeneration, admissionId: first.admissionId });
    expect(await inspect(first.admissionId)).toMatchObject({ type: 'workspace-inspection', identity: batch.identity, result: { type: 'not-committed' } });
    expect(await command(first.admissionId, batch)).toMatchObject({ type: 'failed', code: 'stale-admission', outcome: 'not-started' });
  });

  it.each(['before-cas', 'after-commit'] as const)('inspects restart after lost %s reply without replay or fake fence', async phase => {
    const bound = await bootstrap(), batch = h.request({ type: 'activate-project', projectId: h.b.id });
    h.environment.workspaceFault = point => { if (point.phase === phase) throw Error('lost'); };
    worker.drop = true; const pending = command(bound.admissionId, batch).catch(error => error);
    await vi.waitFor(() => expect(responses).toHaveLength(2)); client.dispose();
    expect(await pending).toMatchObject({ outcome: 'unknown' }); h.environment.workspaceFault = undefined;
    const before = await physicalRows(h, ['workspace']); worker = makePort(); client = modules.createWorkspaceWorkerClient(() => worker.port);
    expect(await client.request({ type: 'inspect-workspace-command', admissionId: bound.admissionId, batch }))
      .toMatchObject({ type: 'workspace-inspection', result: { type: phase === 'after-commit' ? 'committed' : 'unknown' } });
    expect(await client.request({ type: 'workspace-fence', storageGeneration: batch.storageGeneration, admissionId: bound.admissionId }))
      .toMatchObject({ type: 'failed', code: 'stale-admission' });
    expect(await physicalRows(h, ['workspace'])).toEqual(before);
  });

  it.each(['identity', 'before', 'after', 'admission', 'generation', 'outcome', 'accessor', 'extra'])
  ('rejects mismatched workspace result %s after real durable commit', async field => {
    const bound = await bootstrap(), batch = h.request({ type: 'activate-project', projectId: h.b.id });
    const getter = vi.fn();
    worker.transform = response => {
      const r: any = structuredClone(response);
      if (field === 'identity') r.response.result.receipt.identity.commandId = 'wrong';
      if (field === 'before') r.response.result.receipt.before.coreDigest = 'b'.repeat(64);
      if (field === 'after') r.response.result.delta.after.revision++;
      if (field === 'admission') r.response.admissionId++;
      if (field === 'generation') r.context.storageGeneration = 'wrong';
      if (field === 'outcome') r.response.result.outcome = 'created';
      if (field === 'extra') r.response.token = {};
      // Test own-data response framing directly: native clone would invoke accessors.
      if (field === 'accessor') {
        Object.defineProperty(r.response.result.receipt, 'proofDigest', { enumerable: true, get: getter });
        expect(() => validateResponse(r, describeRequest(messages.at(-1)!.request), r.requestId, r.workerEpoch)).toThrow();
        expect(getter).not.toHaveBeenCalled(); r.response.result.receipt = {};
      }
      return r;
    };
    await expect(command(bound.admissionId, batch)).rejects.toMatchObject({ code: 'protocol-error', outcome: 'unknown' });
    expect(worker.port.terminate).toHaveBeenCalledTimes(1);
    expect((await physicalRows(h, ['workspace'])).workspace[0].activeProjectId).toBe(h.b.id);
  });
});

it('allocates retained build output from a fresh temp parent without a session directory', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'task-8-portability-'));
  expect(readdirSync(parent)).toEqual([]);
  expect(existsSync(join(parent, 'doctect-incremental-sdd'))).toBe(false);
  const first = allocateWorkerBuildOutput(parent);
  const second = allocateWorkerBuildOutput(parent);
  expect(dirname(first)).toBe(parent);
  expect(dirname(second)).toBe(parent);
  expect(second).not.toBe(first);
  expect(readdirSync(first)).toEqual([]);
  expect(existsSync(join(parent, 'doctect-incremental-sdd'))).toBe(false);
  console.log(`Task 8 portability evidence retained: parent=${parent}; outputs=${first},${second}`);
});

it('builds the actual Vite client-to-module-worker edge in an isolated output', { timeout: 60_000 }, async () => {
  const { build } = await import('vite');
  const outDir = allocateWorkerBuildOutput();
  const virtual = '\0task-8-worker-build';
  const clientPath = resolve('services/localWorkspace/workspaceWorkerClient.ts');
  const result = await build({ configFile: resolve('vite.config.ts'),
    plugins: [{ name: 'task-8-isolated-entry',
      resolveId(id) { if (id === 'task-8-worker-build') return virtual; },
      load(id) { if (id === virtual) return `import { createWorkspaceWorkerClient } from ${JSON.stringify(clientPath)};
        globalThis.task8BuildProbe = () => createWorkspaceWorkerClient().request({ type: 'recovery-export',
          scope: { projectId: 'build-only', incarnation: 'never-executed', storageGeneration: 'unwired' } });`; },
    }],
    build: { outDir, emptyOutDir: false, copyPublicDir: false, minify: false,
      rollupOptions: { input: 'task-8-worker-build', treeshake: false } },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap(bundle => 'output' in bundle ? bundle.output : []);
  const worker = outputs.find(output => /^assets\/workspaceWorker-.*\.js$/.test(output.fileName));
  expect(worker, 'separate emitted workspace worker').toBeDefined();
  const entry = outputs.find(output => output.type === 'chunk' && output.isEntry);
  expect(entry?.type).toBe('chunk');
  const entryCode = readFileSync(join(outDir, entry!.fileName), 'utf8');
  const workerCode = readFileSync(join(outDir, worker!.fileName), 'utf8');
  expect(entryCode).toContain(worker!.fileName);
  expect(entryCode).not.toContain('./workspaceWorker.ts');
  for (const marker of ['doctect-local-workspace', 'SHA-256', 'readwrite', 'inspectCommitAttempt', 'exportProjectForRecovery']) expect(workerCode).toContain(marker);
  expect(workerCode).not.toMatch(/from\s+["']react|fetch\(/);
  console.log(`Task 8 actual worker build: ${outDir}; client=${entry!.fileName}; worker=${worker!.fileName}`);
});
const documentBatch = (h: StoreHarness): DocumentBatch => ({
  scope: h.scope, clientId: 'worker-client', commitId: 'original-document', commitGeneration: 1,
  editorGeneration: 7, expectedRevision: 0,
  changes: [{ type: 'put-node', node: { ...h.initial.projectNodes.values().next().value!.value, title: 'saved title' } }],
});

type ClientModule = typeof import('../../../../services/localWorkspace/workspaceWorkerClient');
type AllocatorSeeds = { nextRequest: number; nextEpoch: number };

// Seed actual module state, not a copied allocator or 2^53 literal calls. Only the
// two module-top numeric initializers change; guards and lifecycle stay intact.
async function seededClientModule(seeds: AllocatorSeeds): Promise<ClientModule> {
  const ts = await import('typescript');
  const { build } = await import('esbuild');
  const clientPath = resolve('services/localWorkspace/workspaceWorkerClient.ts');
  const source = ts.createSourceFile(clientPath, readFileSync(clientPath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = ['nextRequest', 'nextEpoch'] as const;
  const declarations: import('typescript').VariableDeclaration[] = [];
  const collect = (node: import('typescript').Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.some(name => name === node.name.getText(source))) declarations.push(node);
    ts.forEachChild(node, collect);
  };
  collect(source);
  expect(declarations.map(node => node.name.getText(source)).sort()).toEqual([...names].sort());
  const changed: string[] = [];
  const seeded = ts.factory.updateSourceFile(source, source.statements.map(statement => {
    if (!ts.isVariableStatement(statement)) return statement;
    const updated = statement.declarationList.declarations.map(declaration => {
      if (!declarations.includes(declaration)) return declaration;
      const name = declaration.name.getText(source) as keyof AllocatorSeeds;
      expect(statement.declarationList.flags & ts.NodeFlags.Let, `${name} module-top let`).not.toBe(0);
      expect(declaration.initializer && ts.isNumericLiteral(declaration.initializer), `${name} numeric initializer`).toBe(true);
      expect(declaration.initializer!.getText(source)).toBe('0');
      expect(Number.isSafeInteger(seeds[name]) && seeds[name] >= 0, `${name} valid seed`).toBe(true);
      changed.push(name);
      return ts.factory.updateVariableDeclaration(declaration, declaration.name, declaration.exclamationToken,
        declaration.type, ts.factory.createNumericLiteral(seeds[name]));
    });
    if (updated.every((declaration, index) => declaration === statement.declarationList.declarations[index])) return statement;
    return ts.factory.updateVariableStatement(statement, statement.modifiers,
      ts.factory.updateVariableDeclarationList(statement.declarationList, updated));
  }));
  expect(changed.sort(), 'exactly the two module-top initializers seeded').toEqual([...names].sort());
  const bundled = await build({ stdin: { contents: ts.createPrinter().printFile(seeded), loader: 'ts',
    sourcefile: clientPath, resolveDir: dirname(clientPath) }, bundle: true, write: false, format: 'esm',
    platform: 'node', target: 'es2022', metafile: true });
  expect(Object.keys(bundled.metafile!.inputs).map(path => resolve(path)).sort()).toEqual([
    clientPath, resolve('services/localWorkspace/workspaceWorkerProtocol.ts'),
    resolve('services/localWorkspace/legacyTypes.ts'),
    resolve('services/localWorkspace/workspaceStartupProtocol.ts'),
  ].sort());
  expect(bundled.outputFiles).toHaveLength(1);
  expect(Object.values(bundled.metafile!.outputs).flatMap(output => output.imports)).toEqual([]);
  // A unique URL gives each test its own module instance; clients within a test
  // share that instance. Native ESM retains import.meta and needs no global stub.
  const url = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}#${randomUUID()}`;
  return import(/* @vite-ignore */ url);
}

function allocatorLifecycleProbe(module: ClientModule) {
  vi.useFakeTimers();
  const schedule = vi.spyOn(globalThis, 'setTimeout');
  const clear = vi.spyOn(globalThis, 'clearTimeout');
  const clients: ReturnType<ClientModule['createWorkspaceWorkerClient']>[] = [];
  const request: WorkspaceWorkerRequest = { type: 'recovery-export',
    scope: { storageGeneration: 'allocator-generation', projectId: 'allocator-project', incarnation: 'allocator-incarnation' } };
  const makeClient = () => {
    const listeners = new Map<string, Set<(event: any) => void>>();
    const port = {
      postMessage: vi.fn<(message: WorkspaceWorkerRequestEnvelope) => void>(),
      addEventListener: vi.fn((type: string, listener: (event: any) => void) => {
        const set = listeners.get(type) ?? new Set(); set.add(listener); listeners.set(type, set);
      }),
      removeEventListener: vi.fn((type: string, listener: (event: any) => void) => { listeners.get(type)?.delete(listener); }),
      terminate: vi.fn(),
    } satisfies WorkspaceWorkerPort;
    const factory = vi.fn(() => port);
    const client = module.createWorkspaceWorkerClient(factory); clients.push(client);
    expect(factory).not.toHaveBeenCalled();
    const reply = (index: number) => {
      const sent = port.postMessage.mock.calls[index][0];
      // A valid repository refusal resolves transport without pretending to run
      // persistence. The real client validates this envelope and stays reusable.
      const response: WorkspaceWorkerResponseEnvelope = { protocolVersion: 1, workerEpoch: sent.workerEpoch,
        requestId: sent.requestId, context: describeRequest(sent.request).context,
        response: { type: 'failed', code: 'ingress-required', outcome: 'not-started', admission: 'none' } };
      for (const listener of listeners.get('message') ?? []) listener({ data: response });
      return response.response;
    };
    const expectStopped = () => {
      expect(port.terminate).toHaveBeenCalledTimes(1);
      expect(port.addEventListener.mock.calls.map(([type]) => type)).toEqual(['message', 'error', 'messageerror']);
      expect(port.removeEventListener.mock.calls).toEqual(port.addEventListener.mock.calls);
      expect([...listeners.values()].every(set => set.size === 0)).toBe(true);
    };
    const expectUnstarted = () => {
      expect(factory).not.toHaveBeenCalled(); expect(port.postMessage).not.toHaveBeenCalled();
      expect(port.addEventListener).not.toHaveBeenCalled(); expect(port.removeEventListener).not.toHaveBeenCalled();
      expect(port.terminate).not.toHaveBeenCalled();
    };
    return { client, factory, port, reply, expectStopped, expectUnstarted };
  };
  return { request, schedule, clear, makeClient, dispose() {
    for (const client of clients) client.dispose();
    schedule.mockRestore(); clear.mockRestore();
  } };
}

describe('seeded actual client module-lifetime allocator exhaustion', () => {
  it.each(['nextRequest', 'nextEpoch'] as const)('rejects an already exhausted %s before any factory, post or timer', async owner => {
    const module = await seededClientModule({ nextRequest: 0, nextEpoch: 0, [owner]: Number.MAX_SAFE_INTEGER });
    const h = allocatorLifecycleProbe(module);
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const c = h.makeClient();
        await expect(c.client.request(h.request)).rejects.toMatchObject({ code: 'counter-exhausted', requestId: null, outcome: 'not-posted' });
        await expect(c.client.request(h.request)).rejects.toMatchObject({ code: 'client-failed', requestId: null, outcome: 'not-posted' });
        c.client.dispose(); c.expectUnstarted();
      }
      expect(h.schedule).not.toHaveBeenCalled(); expect(h.clear).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    } finally { h.dispose(); }
  });

  it('shares the last request IDs across clients and rejects all posted pending callers on exhaustion without replay', async () => {
    const max = Number.MAX_SAFE_INTEGER;
    const module = await seededClientModule({ nextRequest: max - 3, nextEpoch: 0 });
    const h = allocatorLifecycleProbe(module);
    try {
      const first = h.makeClient();
      const previous = first.client.request(h.request).catch(error => error);
      expect(first.port.postMessage.mock.calls[0][0]).toEqual({ protocolVersion: 1, workerEpoch: 1, requestId: max - 2, request: h.request });
      first.client.dispose();
      expect(await previous).toMatchObject({ code: 'disposed', requestId: max - 2, outcome: 'unknown' });
      first.expectStopped();
      const current = h.makeClient();
      const pending = [current.client.request(h.request), current.client.request(h.request)].map(promise => promise.catch(error => error));
      expect(current.port.postMessage.mock.calls.map(([message]) => [message.requestId, message.workerEpoch])).toEqual([[max - 1, 2], [max, 2]]);
      expect(current.factory).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(2);
      expect(h.schedule).toHaveBeenCalledTimes(3);
      const detached = current.port.addEventListener.mock.calls.map(([, listener]) => listener);
      await expect(current.client.request(h.request)).rejects.toMatchObject({ code: 'counter-exhausted', requestId: null, outcome: 'not-posted' });
      for (const [index, outcome] of (await Promise.all(pending)).entries()) {
        expect(outcome).toBeInstanceOf(module.WorkspaceWorkerError);
        expect(outcome).toMatchObject({ code: 'counter-exhausted', requestId: max - 1 + index, outcome: 'unknown' });
      }
      current.expectStopped(); expect(vi.getTimerCount()).toBe(0);
      expect(h.clear.mock.calls).toEqual(h.schedule.mock.results.map(result => [result.value]));
      for (const listener of detached) listener({ data: {} });
      await expect(current.client.request(h.request)).rejects.toMatchObject({ code: 'client-failed', requestId: null, outcome: 'not-posted' });
      const restart = h.makeClient();
      await expect(restart.client.request(h.request)).rejects.toMatchObject({ code: 'counter-exhausted', requestId: null, outcome: 'not-posted' });
      restart.expectUnstarted();
      current.client.dispose(); current.client.dispose(); current.expectStopped();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(first.factory).toHaveBeenCalledTimes(1); expect(first.port.postMessage).toHaveBeenCalledTimes(1);
      expect(current.factory).toHaveBeenCalledTimes(1); expect(current.port.postMessage).toHaveBeenCalledTimes(2);
      expect(h.schedule).toHaveBeenCalledTimes(3); expect(h.clear).toHaveBeenCalledTimes(3); expect(vi.getTimerCount()).toBe(0);
    } finally { h.dispose(); }
  });

  it('shares the last epochs but keeps existing clients reusable while forbidding every new epoch', async () => {
    const max = Number.MAX_SAFE_INTEGER;
    const module = await seededClientModule({ nextRequest: 0, nextEpoch: max - 2 });
    const h = allocatorLifecycleProbe(module);
    try {
      const first = h.makeClient(); const last = h.makeClient();
      const firstPending = first.client.request(h.request).catch(error => error);
      const lastPending = last.client.request(h.request).catch(error => error);
      expect(first.port.postMessage.mock.calls[0][0]).toEqual({ protocolVersion: 1, workerEpoch: max - 1, requestId: 1, request: h.request });
      expect(last.port.postMessage.mock.calls[0][0]).toEqual({ protocolVersion: 1, workerEpoch: max, requestId: 2, request: h.request });
      const blocked = h.makeClient();
      await expect(blocked.client.request(h.request)).rejects.toMatchObject({ code: 'counter-exhausted', requestId: null, outcome: 'not-posted' });
      await expect(blocked.client.request(h.request)).rejects.toMatchObject({ code: 'client-failed', requestId: null, outcome: 'not-posted' });
      blocked.expectUnstarted();
      expect(h.schedule).toHaveBeenCalledTimes(2); expect(h.clear).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(2);
      for (const c of [first, last]) {
        expect(c.port.terminate).not.toHaveBeenCalled(); expect(c.port.removeEventListener).not.toHaveBeenCalled();
      }
      const firstReply = first.reply(0); const lastReply = last.reply(0);
      expect(await firstPending).toEqual(firstReply); expect(await lastPending).toEqual(lastReply); expect(vi.getTimerCount()).toBe(0);
      const continuing = [first.client.request(h.request), last.client.request(h.request), last.client.request(h.request)]
        .map(promise => promise.catch(error => error));
      expect(first.port.postMessage.mock.calls.map(([message]) => [message.requestId, message.workerEpoch])).toEqual([[1, max - 1], [3, max - 1]]);
      expect(last.port.postMessage.mock.calls.map(([message]) => [message.requestId, message.workerEpoch])).toEqual([[2, max], [4, max], [5, max]]);
      expect(h.schedule).toHaveBeenCalledTimes(5); expect(vi.getTimerCount()).toBe(3);
      first.client.dispose(); last.client.dispose();
      for (const [index, outcome] of (await Promise.all(continuing)).entries()) {
        expect(outcome).toBeInstanceOf(module.WorkspaceWorkerError);
        expect(outcome).toMatchObject({ code: 'disposed', requestId: 3 + index, outcome: 'unknown' });
      }
      for (const c of [first, last]) {
        c.expectStopped(); expect(c.factory).toHaveBeenCalledTimes(1);
        await expect(c.client.request(h.request)).rejects.toMatchObject({ code: 'disposed', requestId: null, outcome: 'not-posted' });
      }
      const restart = h.makeClient();
      await expect(restart.client.request(h.request)).rejects.toMatchObject({ code: 'counter-exhausted', requestId: null, outcome: 'not-posted' });
      restart.expectUnstarted();
      await vi.advanceTimersByTimeAsync(60_000);
      first.expectStopped(); last.expectStopped();
      expect(first.port.postMessage).toHaveBeenCalledTimes(2); expect(last.port.postMessage).toHaveBeenCalledTimes(3);
      expect(h.schedule).toHaveBeenCalledTimes(5);
      expect(h.clear.mock.calls).toEqual(h.schedule.mock.results.map(result => [result.value])); expect(vi.getTimerCount()).toBe(0);
    } finally { h.dispose(); }
  });

  it.each(['nextRequest', 'nextEpoch'] as const)('accepts the last valid %s response, then disposal cannot reset allocation', async owner => {
    const max = Number.MAX_SAFE_INTEGER;
    const module = await seededClientModule({ nextRequest: 0, nextEpoch: 0, [owner]: max - 1 });
    const h = allocatorLifecycleProbe(module);
    try {
      const last = h.makeClient();
      const pending = last.client.request(h.request);
      expect(last.port.postMessage.mock.calls[0][0]).toEqual({ protocolVersion: 1, request: h.request,
        requestId: owner === 'nextRequest' ? max : 1, workerEpoch: owner === 'nextEpoch' ? max : 1 });
      const response = last.reply(0);
      await expect(pending).resolves.toEqual(response);
      expect(vi.getTimerCount()).toBe(0); expect(last.port.terminate).not.toHaveBeenCalled();
      last.client.dispose(); last.expectStopped();
      await expect(last.client.request(h.request)).rejects.toMatchObject({ code: 'disposed', requestId: null, outcome: 'not-posted' });
      const next = h.makeClient();
      await expect(next.client.request(h.request)).rejects.toMatchObject({ code: 'counter-exhausted', requestId: null, outcome: 'not-posted' });
      next.expectUnstarted();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(last.factory).toHaveBeenCalledTimes(1); expect(last.port.postMessage).toHaveBeenCalledTimes(1); last.expectStopped();
      expect(h.schedule).toHaveBeenCalledTimes(1);
      expect(h.clear.mock.calls).toEqual(h.schedule.mock.results.map(result => [result.value])); expect(vi.getTimerCount()).toBe(0);
    } finally { h.dispose(); }
  });
});

describe('long-lived worker transport', () => {
  it('refuses v2 bootstrap without upgrade, transactions, writes or publication', async () => {
    const h = await createIncrementalWorkerHarness();
    const request = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    const opening = h.environment.indexedDB.open('legacy-v2', 2);
    opening.onupgradeneeded = () => opening.result.createObjectStore('historical');
    const legacy = await request(opening);
    const tx = legacy.transaction('historical', 'readwrite');
    const retained = { id: 'legacy-source', nested: { preserve: true } };
    tx.objectStore('historical').put(retained, 'source');
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
    legacy.close();
    const handler = h.createWorkspaceWorkerHandler({ ...h.environment, databaseName: 'legacy-v2' });
    const nativeOpen = h.environment.indexedDB.open.bind(h.environment.indexedDB);
    const upgrades = vi.fn(); const transactions = vi.fn();
    const open = vi.spyOn(h.environment.indexedDB, 'open').mockImplementation((name, version) => {
      const r = nativeOpen(name, version);
      r.addEventListener('upgradeneeded', upgrades);
      r.addEventListener('success', () => {
        const nativeTransaction = r.result.transaction.bind(r.result);
        vi.spyOn(r.result, 'transaction').mockImplementation((...args) => {
          transactions(...args); return nativeTransaction(...args);
        });
      });
      return r;
    });
    try {
      h.clearOperations();
      const result = await handler.handle({ protocolVersion: 1, workerEpoch: 1, requestId: 1,
        request: { type: 'bootstrap', project: h.initial } });
      expect(result.response).toEqual({ type: 'failed', code: 'ingress-required', outcome: 'not-started', admission: 'none' });
      expect(open.mock.calls).toEqual([['legacy-v2']]);
      expect(upgrades).not.toHaveBeenCalled(); expect(transactions).not.toHaveBeenCalled();
      expect(h.operations).toEqual([]); expect(h.publications).toEqual([]);
      open.mockRestore();
      const durable = await request<IDBDatabase>(nativeOpen('legacy-v2'));
      try {
        expect(durable.version).toBe(2); expect([...durable.objectStoreNames]).toEqual(['historical']);
        expect(await request(durable.transaction('historical', 'readonly').objectStore('historical').getAll())).toEqual([retained]);
      } finally { durable.close(); }
    } finally { open.mockRestore(); handler.dispose(); h.client.dispose(); }
  });

  it('bootstraps actual nonzero durable document, preference and fold counters on a fresh handler', async () => {
    const h = await createIncrementalWorkerHarness();
    let restarted: ReturnType<typeof h.createWorkspaceWorkerClient> | undefined;
    try {
      const template = h.initial.projectTemplates.values().next().value!.value;
      const structural = await h.client.request({ type: 'structural-command', admissionId: h.admissionId,
        command: { type: 'occurrence-edit', batch: { ...documentBatch(h),
          changes: [{ type: 'put-template', variantId: 'default', template: { ...template,
            layers: [...template.layers!, { ...template.layers![0], id: 'added' }] } }],
          structural: { expectedFoldStructureGeneration: 0, mappings: [
            { type: 'continue', from: { variantId: 'default', templateId: 'page-0', position: 0 },
              to: { variantId: 'default', templateId: 'page-0', position: 0 } },
            { type: 'create', to: { variantId: 'default', templateId: 'page-0', position: 1 }, cell: { present: false } },
          ] } } } });
      expect(structural).toMatchObject({ type: 'structural-result', ack: { revision: 1, foldStructureGeneration: 1 } });
      expect(await h.client.request({ type: 'preferences', admissionId: h.admissionId, batch: preferenceBatch(h) }))
        .toMatchObject({ type: 'preferences-result', ack: { preferenceRevision: 1 } });
      const durable = await h.readRecords();
      const header = durable.projectHeaders.values().next().value!;
      const preferences = durable.projectPreferences.values().next().value!;
      const authority = { documentRevision: header.storageRevision, preferenceRevision: preferences.revision,
        foldStructureGeneration: header.foldStructureGeneration };
      expect(authority).toEqual({ documentRevision: 1, preferenceRevision: 1, foldStructureGeneration: 1 });
      h.client.dispose(); h.clearOperations();
      restarted = h.createWorkspaceWorkerClient(h.factory);
      const bound = await restarted.request({ type: 'bootstrap', project: durable });
      expect(bound).toEqual({ type: 'bootstrapped', scope: h.scope,
        admissionId: h.messages.at(-1)!.requestId, authority });
      expect(h.factory).toHaveBeenCalledTimes(2);
      expect(h.operations.length).toBeGreaterThan(0);
      expect(h.operations.every(op => op.phase === 'ingress-read' && op.method === 'getAll')).toBe(true);
      expect(h.publications).toEqual([]); expect(await h.readRecords()).toEqual(durable);
      if (bound.type !== 'bootstrapped') throw new Error('bootstrap failed');
      expect(await restarted.request({ type: 'preferences', admissionId: bound.admissionId,
        batch: { ...preferenceBatch(h), commitId: 'after-bootstrap', commitGeneration: 2,
          observedPreferenceRevision: bound.authority.preferenceRevision, patch: { scale: 3 } } }))
        .toMatchObject({ type: 'preferences-result', ack: { preferenceRevision: 2, foldStructureGeneration: 1 } });
      expect((await h.exportFresh()).initialState.scale).toBe(3);
    } finally { restarted?.dispose(); h.client.dispose(); }
  });

  it('applies new-side fold intent after structural ack to the current occurrence, not its previous occupant', async () => {
    const project = makeIncrementalProject();
    const template = project.initialState.variants.default.templates['page-0'];
    template.layers = [{ ...template.layers![0], id: 'first', collapsed: false },
      { ...template.layers![0], id: 'second', collapsed: false }];
    const h = await createIncrementalWorkerHarness(project);
    const occurrence = (position: number) => ({ variantId: 'default', templateId: 'page-0', position });
    try {
      h.clearOperations();
      const stored = h.initial.projectTemplates.values().next().value!.value;
      const structural = await h.client.request({ type: 'structural-command', admissionId: h.admissionId,
        command: { type: 'occurrence-edit', batch: { ...documentBatch(h),
          changes: [{ type: 'put-template', variantId: 'default', template: { ...stored, layers: [...stored.layers!].reverse() } }],
          structural: { expectedFoldStructureGeneration: 0, mappings: [
            { type: 'continue', from: occurrence(0), to: occurrence(1) },
            { type: 'continue', from: occurrence(1), to: occurrence(0) },
          ] } } } });
      expect(structural).toMatchObject({ type: 'structural-result', ack: { revision: 1, foldStructureGeneration: 1 } });
      if (structural.type !== 'structural-result') throw new Error('structural command failed');
      expect(h.publications).toEqual([{ scope: h.scope, kind: 'local',
        authority: { documentRevision: 1, preferenceRevision: 0, foldStructureGeneration: 1 } }]);
      const afterStructure = await h.exportFresh();
      expect(afterStructure.initialState.variants.default.templates['page-0'].layers!.map(layer => [layer.id, layer.collapsed]))
        .toEqual([['second', false], ['first', false]]);
      h.clearOperations();
      const updated = await h.client.request({ type: 'preferences', admissionId: h.admissionId,
        batch: { ...preferenceBatch(h), patch: {}, folds: {
          expectedFoldStructureGeneration: structural.ack.foldStructureGeneration,
          updates: [{ occurrence: occurrence(0), collapsed: true }],
        } } });
      expect(updated).toMatchObject({ type: 'preferences-result', ack: { preferenceRevision: 1, foldStructureGeneration: 1 } });
      expect(h.responses.slice(-2).map(r => r.response.type)).toEqual(['structural-result', 'preferences-result']);
      expect(h.operations.some(op => op.phase === 'write' && op.store === 'projectPreferences')).toBe(true);
      expect(h.operations.some(op => op.method === 'getAll' || op.store === 'projectTemplates' && op.phase === 'write')).toBe(false);
      expect(h.publications).toEqual([{ scope: h.scope, kind: 'local',
        authority: { documentRevision: 1, preferenceRevision: 1, foldStructureGeneration: 1 } }]);
      const durable = await h.exportFresh();
      expect(durable.initialState.variants.default.templates['page-0'].layers!.map(layer => [layer.id, layer.collapsed]))
        .toEqual([['second', true], ['first', false]]);
    } finally { h.client.dispose(); }
  });

  it('releases FIFO after a failed operation for an unrelated admitted project on the same handler', async () => {
    const h = await createIncrementalWorkerHarness();
    const otherProject = { ...makeIncrementalProject(), id: 'unrelated-project' };
    const otherScope = { ...h.scope, projectId: otherProject.id, incarnation: 'other-incarnation' };
    const other = decomposeProject(otherProject, otherScope);
    await h.seedRecords(other);
    const durableProject = async (scope: typeof h.scope) => {
      const records = await h.readRecords(); records.scope = scope;
      for (const store of NORMALIZED_STORE_NAMES) {
        if (store === 'normalizationLedger') continue;
        Object.assign(records, { [store]: new Map<string, NormalizedRecordTypes[ProjectStoreName]>(
          [...records[store]].filter(([, record]) => record.key[1] === scope.projectId)) });
      }
      return reconstructProject(records);
    };
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    try {
      const bound = await h.client.request({ type: 'bootstrap', project: other });
      if (bound.type !== 'bootstrapped') throw new Error('second project bootstrap failed');
      h.clearOperations();
      let reached!: () => void; let paused = false;
      const entered = new Promise<void>(resolve => { reached = resolve; });
      h.setHash(async text => { if (!paused) { paused = true; reached(); await gate; } return testHash(text); });
      let aborted = false;
      h.setFault(point => { if (!aborted && point.phase === 'before-complete') { aborted = true; throw new Error('first project abort'); } });
      const failing = h.client.request({ type: 'document-batch', admissionId: h.admissionId, batch: documentBatch(h) });
      const following = h.client.request({ type: 'preferences', admissionId: bound.admissionId,
        batch: { ...preferenceBatch(h), scope: otherScope, patch: { scale: 4 } } });
      const exporting = h.client.request({ type: 'recovery-export', scope: otherScope });
      await entered;
      expect(h.messages.slice(-3).map(m => m.request.type)).toEqual(['document-batch', 'preferences', 'recovery-export']);
      expect(h.responses).toHaveLength(2);
      expect(h.publications).toEqual([]);
      expect(h.operations.some(op => op.key?.[1] === otherScope.projectId)).toBe(false);
      expect(await durableProject(otherScope)).toEqual(otherProject);
      release();
      expect(await failing).toMatchObject({ type: 'failed', code: 'repository-failure', admission: 'invalidated' });
      expect(await following).toMatchObject({ type: 'preferences-result', ack: { projectId: otherScope.projectId, preferenceRevision: 1 } });
      expect(await exporting).toMatchObject({ type: 'recovery-exported', authority: { documentRevision: 0, preferenceRevision: 1 } });
      expect(h.responses.slice(-3).map(r => r.response.type)).toEqual(['failed', 'preferences-result', 'recovery-exported']);
      expect(h.factory).toHaveBeenCalledTimes(1); expect(h.workers).toHaveLength(1);
      expect(h.publications).toEqual([{ scope: otherScope, kind: 'local',
        authority: { documentRevision: 0, preferenceRevision: 1, foldStructureGeneration: 0 } }]);
      const firstOther = h.operations.findIndex(op => op.key?.[1] === otherScope.projectId);
      expect(firstOther).toBeGreaterThan(0);
      expect(h.operations.slice(firstOther).some(op => op.key?.[1] === h.scope.projectId)).toBe(false);
      expect(await durableProject(h.scope)).toEqual(reconstructProject(h.initial));
      expect((await durableProject(otherScope)).initialState.scale).toBe(4);
      h.clearOperations();
      expect(await h.client.request({ type: 'preferences', admissionId: h.admissionId, batch: preferenceBatch(h) }))
        .toMatchObject({ type: 'failed', code: 'stale-admission' });
      expect(h.operations).toEqual([]);
    } finally { release(); h.setFault(); h.setHash(testHash); h.client.dispose(); }
  });

  it('invalidates the old token on failed durable bind and rejects stale incarnation at execution', async () => {
    const h = await createIncrementalWorkerHarness();
    try {
      await h.saveNodeTitle('durable');
      expect(await h.client.request({ type: 'bootstrap', project: h.initial }))
        .toMatchObject({ type: 'failed', code: 'verification-failed', admission: 'invalidated' });
      h.clearOperations();
      expect(await h.client.request({ type: 'preferences', admissionId: h.admissionId, batch: preferenceBatch(h) }))
        .toMatchObject({ type: 'failed', code: 'stale-admission' });
      expect(h.operations).toEqual([]);
      const current = await h.client.request({ type: 'bootstrap', project: await h.readRecords() });
      expect(current).toMatchObject({ type: 'bootstrapped', authority: { documentRevision: 1 } });
      if (current.type !== 'bootstrapped') throw new Error('bind failed');
      expect(await h.client.request({ type: 'preferences', admissionId: current.admissionId,
        batch: { ...preferenceBatch(h), scope: { ...h.scope, incarnation: 'stale' } } }))
        .toMatchObject({ type: 'failed', code: 'stale-admission' });
    } finally { h.client.dispose(); }
  });

  it('does not create or migrate a missing normalized database during bootstrap', async () => {
    const h = await createIncrementalWorkerHarness();
    const handler = h.createWorkspaceWorkerHandler({ ...h.environment, databaseName: 'absent-test-database' });
    try {
      h.clearOperations();
      expect(await handler.handle({ protocolVersion: 1, workerEpoch: 1, requestId: 1,
        request: { type: 'bootstrap', project: h.initial } })).toMatchObject({ response: { type: 'failed', code: 'ingress-required' } });
      expect(await h.environment.indexedDB.databases()).toEqual([{ name: h.environment.databaseName, version: 3 }]);
      expect(h.operations).toEqual([]);
    } finally { handler.dispose(); h.client.dispose(); }
  });

  it('rejects duplicate IDs, wrong epochs and maximum-safe successor wrap without dispatch', async () => {
    const h = await createIncrementalWorkerHarness(); const handler = h.createWorkspaceWorkerHandler(h.environment);
    const envelope = { protocolVersion: 1, workerEpoch: 1, requestId: Number.MAX_SAFE_INTEGER,
      request: { type: 'recovery-export', scope: h.scope } };
    try {
      await handler.handle(envelope); h.clearOperations();
      await expect(handler.handle(envelope)).rejects.toThrow();
      await expect(handler.handle({ ...envelope, requestId: Number.MAX_SAFE_INTEGER + 1 })).rejects.toThrow();
      await expect(handler.handle({ ...envelope, workerEpoch: 2 })).rejects.toThrow();
      expect(h.operations).toEqual([]);
      // A duplicate response from the current port is fatal, unlike detached callbacks.
      h.workers[0].emit('message', { data: h.responses[0] });
      await expect(h.client.request({ type: 'recovery-export', scope: h.scope })).rejects.toMatchObject({ code: 'client-failed' });
    } finally { handler.dispose(); h.client.dispose(); }
  });

  it('validates preference replay lower bounds and response generations without inspecting payloads', async () => {
    const h = await createIncrementalWorkerHarness();
    try {
      await h.client.request({ type: 'preferences', admissionId: h.admissionId, batch: preferenceBatch(h) });
      const request: WorkspaceWorkerRequest = { type: 'preferences', admissionId: h.admissionId,
        batch: { ...preferenceBatch(h), clientId: 'other', commitId: 'later', patch: { scale: 3 } } };
      expect(await h.client.request(request)).toMatchObject({ type: 'preferences-result', ack: { preferenceRevision: 2 } });
      const envelope = h.responses.at(-1)!;
      expect(validateResponse(envelope, describeRequest(request), envelope.requestId, envelope.workerEpoch)).toEqual(envelope.response);
      for (const revision of [-1, NaN, 0, Number.MAX_SAFE_INTEGER + 1]) {
        const wrong = structuredClone(envelope) as any; wrong.response.ack.preferenceRevision = revision;
        expect(() => validateResponse(wrong, describeRequest(request), envelope.requestId, envelope.workerEpoch)).toThrow();
      }
      const getter = vi.fn(() => { throw new Error('walked external project'); });
      const recovery: WorkspaceWorkerRequest = { type: 'recovery-export', scope: h.scope };
      const external = { id: h.scope.projectId, get initialState() { return getter(); } };
      const exported = { protocolVersion: 1, workerEpoch: 1, requestId: 1, context: describeRequest(recovery).context,
        response: { type: 'recovery-exported', scope: h.scope, source: 'normalized-project',
          authority: { documentRevision: 0, preferenceRevision: 2, foldStructureGeneration: 0 }, project: external } };
      expect(() => validateResponse(exported, describeRequest(recovery), 1, 1)).not.toThrow(); expect(getter).not.toHaveBeenCalled();
    } finally { h.client.dispose(); }
  });

  it('exports full external depth, source, cloud linkage and provenance only at the explicit bulk boundary', async () => {
    const project = makeIncrementalProject(); let nested = {};
    for (let depth = 1; depth < 512; depth++) nested = { child: nested };
    project.retained = nested; project.cloud = { projectId: 'cloud', lastSyncedCommitId: 'source-commit' };
    project.importProvenance = { source: 'gallery', revisions: ['b', 'a'] };
    const h = await createIncrementalWorkerHarness(project);
    try {
      const exported = await h.client.request({ type: 'recovery-export', scope: h.scope });
      expect(exported.type).toBe('recovery-exported');
      if (exported.type !== 'recovery-exported') throw new Error('export failed');
      expect(JSON.stringify(exported.project)).toBe(JSON.stringify(project));
      expect(exported.source).toBe('normalized-project');
    } finally { h.client.dispose(); }
  });

  it('reports hidden/evicted uncertain commits as conflicts and never replays them', async () => {
    const h = await createIncrementalWorkerHarness(); const original = documentBatch(h);
    try {
      await h.client.request({ type: 'document-batch', admissionId: h.admissionId, batch: original });
      await h.client.request({ type: 'preferences', admissionId: h.admissionId, batch: preferenceBatch(h) });
      expect(await h.client.request({ type: 'inspect-commit', attempt: { lane: 'document', batch: original } }))
        .toMatchObject({ type: 'commit-inspection', result: { type: 'conflict', reason: 'authority-changed' } });
      const other = await h.anotherRepository();
      for (let n = 2; n <= 34; n++) await other.commitPreferences({ ...preferenceBatch(h), commitId: `evict-${n}`, commitGeneration: n,
        observedPreferenceRevision: n - 1, patch: { scale: n } });
      h.clearOperations();
      expect(await h.client.request({ type: 'inspect-commit', attempt: { lane: 'preferences', batch: preferenceBatch(h) } }))
        .toMatchObject({ type: 'commit-inspection', result: { type: 'conflict', reason: 'proof-unavailable' } });
      expect(h.operations.every(op => op.phase === 'inspect-read' && op.method === 'get')).toBe(true);
    } finally { h.client.dispose(); }
  });

  it.each(['requestId', 'workerEpoch', 'protocolVersion', 'incarnation', 'clientId', 'commitGeneration', 'editorGeneration', 'revision', 'type', 'extra'] as const)
  ('fails closed on wrong response %s and ignores detached old listeners', async field => {
    const h = await createIncrementalWorkerHarness();
    const oldMessage = [...h.workers[0].listeners.get('message')!][0];
    h.workers[0].transform = response => {
      const r = structuredClone(response) as any;
      if (field === 'requestId' || field === 'workerEpoch' || field === 'protocolVersion') r[field]++;
      else if (field === 'incarnation') r.context.scope.incarnation = 'stale';
      else if (field === 'clientId' || field === 'commitGeneration') r.context.identity[field] = field === 'clientId' ? 'wrong' : 999;
      else if (field === 'extra') r.response.snapshot = {};
      else r.response.ack[field] = field === 'type' ? 'preferences-saved' : 999;
      return r;
    };
    await expect(h.saveNodeTitle('retained')).rejects.toMatchObject({ code: 'protocol-error', outcome: 'unknown' });
    oldMessage({ data: h.responses[0] });
    expect(h.workers[0].port.terminate).toHaveBeenCalledTimes(1);
    expect((await h.exportFresh()).initialState.nodes.root.title).toBe('retained');
    h.client.dispose();
  });

  it.each(['before-complete', 'after-commit'] as const)('inspects original lost-ack identity after %s without replay or binding', async phase => {
    const h = await createIncrementalWorkerHarness();
    const original = documentBatch(h);
    // Drop the response to model transport loss separately from repository outcome.
    h.workers[0].dropResponses = true;
    h.setFault(point => { if (point.phase === phase) throw new Error('interrupted'); });
    const waiting = h.client.request({ type: 'document-batch', admissionId: h.admissionId, batch: original }).catch(e => e);
    await vi.waitFor(() => expect(h.responses).toHaveLength(2));
    expect(h.publications).toEqual([]);
    h.client.dispose(); expect(await waiting).toMatchObject({ code: 'disposed', outcome: 'unknown' });
    h.setFault(); h.clearOperations();
    const restarted = h.createWorkspaceWorkerClient(h.factory);
    try {
      const result = await restarted.request({ type: 'inspect-commit', attempt: { lane: 'document', batch: original } });
      expect(result).toMatchObject(phase === 'after-commit'
        ? { type: 'commit-inspection', result: { type: 'committed', ack: { commitId: original.commitId, revision: 1 } } }
        : { type: 'commit-inspection', result: { type: 'conflict', reason: 'proof-unavailable' } });
      expect(h.operations.every(op => op.method === 'get' && op.phase === 'inspect-read')).toBe(true);
      expect(await restarted.request({ type: 'document-batch', admissionId: h.admissionId, batch: original }))
        .toMatchObject({ type: 'failed', code: 'stale-admission' });
      expect(original).toEqual(documentBatch(h));
    } finally { restarted.dispose(); }
  });

  it('does not execute queued requests after handler disposal while a read is paused', async () => {
    const h = await createIncrementalWorkerHarness();
    await h.saveNodeTitle('proof-bearing export');
    const handler = h.createWorkspaceWorkerHandler(h.environment);
    const send = (requestId: number, request: WorkspaceWorkerRequest) => handler.handle({ protocolVersion: 1, workerEpoch: 100, requestId, request });
    await send(1, { type: 'bootstrap', project: await h.readRecords() });
    let reached!: () => void; let release!: () => void; let paused = false;
    const entered = new Promise<void>(resolve => { reached = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    h.setHash(async text => { if (!paused) { paused = true; reached(); await gate; } return testHash(text); });
    const exporting = send(2, { type: 'recovery-export', scope: h.scope }).catch(e => e);
    const saving = send(3, { type: 'preferences', admissionId: 1, batch: preferenceBatch(h) }).catch(e => e);
    await entered; handler.dispose(); h.clearOperations(); release();
    expect(await exporting).toBeInstanceOf(Error); expect(await saving).toBeInstanceOf(Error);
    expect(h.operations.some(op => op.phase === 'write' || op.phase === 'prepare-read')).toBe(false);
    h.client.dispose();
  });

  it('keeps main-thread arrays and patch values opaque but worker rejects malformed selected content', async () => {
    const h = await createIncrementalWorkerHarness();
    const batch = documentBatch(h);
    const poison = new Proxy([], { ownKeys() { throw new Error('walked changes'); }, get(target, key) {
      if (key === 'length' || key === Symbol.iterator) throw new Error('walked changes'); return Reflect.get(target, key);
    } });
    expect(() => describeRequest({ type: 'document-batch', admissionId: h.admissionId, batch: { ...batch, changes: poison,
      structural: { expectedFoldStructureGeneration: 0, mappings: poison } } })).not.toThrow();
    expect(() => describeRequest({ type: 'preferences', admissionId: h.admissionId, batch: { ...preferenceBatch(h),
      patch: new Proxy({}, { ownKeys() { throw new Error('walked patch'); } }), folds: { expectedFoldStructureGeneration: 0, updates: poison } } })).not.toThrow();
    try {
      expect(await h.client.request({ type: 'preferences', admissionId: h.admissionId,
        batch: { ...preferenceBatch(h), patch: { layerCollapsed: { illicit: true } } } }))
        .toMatchObject({ type: 'failed', code: 'repository-failure', admission: 'invalidated' });
      h.clearOperations();
      expect(await h.client.request({ type: 'document-batch', admissionId: h.admissionId, batch }))
        .toMatchObject({ type: 'failed', code: 'stale-admission' });
      expect(h.operations).toEqual([]);
    } finally { h.client.dispose(); }
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects unsafe counter %s before posting', async value => {
    const h = await createIncrementalWorkerHarness();
    try {
      for (const field of ['editorGeneration', 'commitGeneration', 'expectedRevision']) {
        await expect(h.client.request({ type: 'document-batch', admissionId: h.admissionId,
          batch: { ...documentBatch(h), [field]: value } })).rejects.toMatchObject({ code: 'invalid-request', outcome: 'not-posted' });
      }
      expect(h.messages).toHaveLength(1);
      expect(() => requestEnvelope({ protocolVersion: 1, workerEpoch: value, requestId: 1,
        request: { type: 'recovery-export', scope: h.scope } })).toThrow();
    } finally { h.client.dispose(); }
  });

  it('rejects malformed envelope/accessor/extra fields and revision overflow without invoking getters', async () => {
    const h = await createIncrementalWorkerHarness();
    const getter = vi.fn(() => 'document-batch');
    await expect(h.client.request(Object.defineProperty({}, 'type', { enumerable: true, get: getter }) as any)).rejects.toMatchObject({ code: 'invalid-request' });
    expect(getter).not.toHaveBeenCalled();
    await expect(h.client.request({ type: 'document-batch', admissionId: h.admissionId,
      batch: { ...documentBatch(h), expectedRevision: Number.MAX_SAFE_INTEGER } })).rejects.toMatchObject({ code: 'invalid-request' });
    await expect(h.client.request({ type: 'recovery-export', scope: h.scope, snapshot: {} } as any)).rejects.toMatchObject({ code: 'invalid-request' });
    h.workers[0].port.postMessage = () => { throw new DOMException('clone', 'DataCloneError'); };
    await expect(h.client.request({ type: 'recovery-export', scope: h.scope })).rejects.toMatchObject({ code: 'post-failed' });
    h.client.dispose();
  });

  it('runs occurrence structural commands against latest folds and rejects delayed generations', async () => {
    const project = makeIncrementalProject();
    const template = project.initialState.variants.default.templates['page-0'];
    template.layers = [{ ...template.layers![0], id: 'first', collapsed: false }, { ...template.layers![0], id: 'second', collapsed: false }];
    const h = await createIncrementalWorkerHarness(project);
    const occurrence = (position: number) => ({ variantId: 'default', templateId: 'page-0', position });
    try {
      const folds = { expectedFoldStructureGeneration: 0, updates: [{ occurrence: occurrence(0), collapsed: true }] };
      expect((await h.client.request({ type: 'preferences', admissionId: h.admissionId, batch: { ...preferenceBatch(h), patch: {}, folds } })).type).toBe('preferences-result');
      const stored = h.initial.projectTemplates.values().next().value!.value;
      const batch = { ...documentBatch(h), changes: [{ type: 'put-template' as const, variantId: 'default', template: { ...stored, layers: [...stored.layers!].reverse() } }],
        structural: { expectedFoldStructureGeneration: 0, mappings: [{ type: 'continue' as const, from: occurrence(0), to: occurrence(1) }, { type: 'continue' as const, from: occurrence(1), to: occurrence(0) }] } };
      expect(await h.client.request({ type: 'structural-command', admissionId: h.admissionId, command: { type: 'occurrence-edit', batch } }))
        .toMatchObject({ type: 'structural-result', ack: { revision: 1, foldStructureGeneration: 1 } });
      const actual = await h.exportFresh();
      expect(actual.initialState.variants.default.templates['page-0'].layers!.map(layer => layer.collapsed)).toEqual([false, true]);
      expect(await h.client.request({ type: 'preferences', admissionId: h.admissionId, batch: {
        ...preferenceBatch(h), commitId: 'delayed', commitGeneration: 2, patch: {}, folds } }))
        .toMatchObject({ type: 'failed', code: 'stale-fold-generation', admission: 'invalidated' });
    } finally { h.client.dispose(); }
  });

  it('reuses a worker and transfers only a changed record', async () => {
    const h = await createIncrementalWorkerHarness(makeIncrementalProject(20));
    try {
      h.clearOperations();
      await h.saveNodeTitle('first'); await h.saveNodeTitle('second');
      expect(h.factory).toHaveBeenCalledTimes(1);
      expect(h.documentMessages).toHaveLength(2);
      for (const message of h.documentMessages) {
        expect(message.batch.changes).toHaveLength(1);
        expect(message).not.toHaveProperty('project'); expect(message).not.toHaveProperty('snapshot');
      }
      expect(h.operations.some(op => op.method === 'getAll')).toBe(false);
      expect((await h.exportFresh()).initialState.nodes.root.title).toBe('second');
    } finally { h.client.dispose(); }
  });

  it('orders document/preferences/export, rebinds with a new token, and rejects old tokens', async () => {
    const h = await createIncrementalWorkerHarness();
    try {
      const doc = h.client.request({ type: 'document-batch', admissionId: h.admissionId, batch: documentBatch(h) });
      const pref = h.client.request({ type: 'preferences', admissionId: h.admissionId, batch: preferenceBatch(h) });
      const exported = h.client.request({ type: 'recovery-export', scope: h.scope });
      expect((await doc).type).toBe('document-result'); expect((await pref).type).toBe('preferences-result');
      expect(await exported).toMatchObject({ type: 'recovery-exported', authority: { documentRevision: 1, preferenceRevision: 1 } });
      const rebound = await h.client.request({ type: 'bootstrap', project: await h.readRecords() });
      expect(rebound).toMatchObject({ type: 'bootstrapped' });
      h.clearOperations();
      expect(await h.client.request({ type: 'preferences', admissionId: h.admissionId, batch: preferenceBatch(h) }))
        .toMatchObject({ type: 'failed', code: 'stale-admission', outcome: 'not-started' });
      expect(h.operations).toEqual([]);
    } finally { h.client.dispose(); }
  });

  it.each(['error', 'messageerror', 'timeout', 'dispose', 'malformed'] as const)('rejects every pending caller on %s without restarting', async failure => {
    const h = await createIncrementalWorkerHarness();
    vi.useFakeTimers(); h.workers[0].hold = true;
    const outcomes = [h.client.request({ type: 'recovery-export', scope: h.scope }),
      h.client.request({ type: 'preferences', admissionId: h.admissionId, batch: preferenceBatch(h) })].map(p => p.catch(e => e));
    if (failure === 'timeout') await vi.advanceTimersByTimeAsync(30_000);
    else if (failure === 'dispose') h.client.dispose();
    else if (failure === 'malformed') h.workers[0].emit('message', { data: { requestId: 999 } });
    else h.workers[0].emit(failure, {});
    for (const outcome of await Promise.all(outcomes)) expect(outcome).toBeInstanceOf(Error);
    expect(h.workers[0].port.terminate).toHaveBeenCalledTimes(1);
    await expect(h.client.request({ type: 'recovery-export', scope: h.scope })).rejects.toThrow();
    h.client.dispose(); expect(h.factory).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });

  it('starts lazily and fails closed when factory throws', async () => {
    const { createWorkspaceWorkerClient } = await workerModules();
    const factory = vi.fn(() => { throw new Error('cannot start'); });
    const client = createWorkspaceWorkerClient(factory); expect(factory).not.toHaveBeenCalled();
    await expect(client.request({ type: 'recovery-export', scope: { storageGeneration: 'g', projectId: 'p', incarnation: 'i' } }))
      .rejects.toMatchObject({ code: 'worker-start-failed', outcome: 'not-posted' });
    client.dispose(); expect(factory).toHaveBeenCalledTimes(1);
  });
});
const preferenceBatch = (h: StoreHarness): PreferenceBatch => ({
  scope: h.scope, clientId: 'preference-client', commitId: 'original-preference', commitGeneration: 1,
  editorGeneration: 8, observedPreferenceRevision: 0, patch: { scale: 2 },
});

describe('worker repository read-only seams', () => {
  it.each(['document', 'preferences'] as const)('inspects aborted %s attempts only with original identity and framing', async lane => {
    const h = await createIncrementalStoreHarness();
    const attempt = lane === 'document' ? { lane, batch: { ...documentBatch(h), structural: { expectedFoldStructureGeneration: 0, mappings: [] } } }
      : { lane, batch: { ...preferenceBatch(h), folds: { expectedFoldStructureGeneration: 0, updates: [] } } };
    h.setFault(point => { if (point.phase === 'before-complete') throw new Error('abort'); });
    await expect(lane === 'document' ? h.repository.commitDocument(attempt.batch as DocumentBatch)
      : h.repository.commitPreferences(attempt.batch as PreferenceBatch)).rejects.toThrow('abort');
    h.setFault();
    expect(h.repository).toHaveProperty('inspectCommitAttempt', expect.any(Function));
    expect(await h.repository.inspectCommitAttempt(attempt)).toEqual({ type: 'not-committed' });
    const changed = structuredClone(attempt);
    if (changed.lane === 'document') changed.batch.structural.expectedFoldStructureGeneration = 1;
    else changed.batch.folds.expectedFoldStructureGeneration = 1;
    expect(await h.repository.inspectCommitAttempt(changed)).toEqual({ type: 'conflict', reason: 'identity-mismatch' });
    expect(await createNormalizedRepository(h.environment).inspectCommitAttempt(attempt))
      .toEqual({ type: 'conflict', reason: 'proof-unavailable' });
  });

  it.each(['document', 'preferences'] as const)('inspects original %s identity and request after restart without binding', async lane => {
    const h = await createIncrementalStoreHarness();
    const batch = lane === 'document' ? { ...documentBatch(h), structural: { expectedFoldStructureGeneration: 0, mappings: [] } }
      : { ...preferenceBatch(h), folds: { expectedFoldStructureGeneration: 0, updates: [] } };
    const ack = lane === 'document' ? await h.repository.commitDocument(batch as DocumentBatch)
      : await h.repository.commitPreferences(batch as PreferenceBatch);
    const restarted = createNormalizedRepository(h.environment);
    expect(restarted).toHaveProperty('inspectCommitAttempt', expect.any(Function));
    h.clearOperations();
    const attempt = lane === 'document' ? { lane, batch: batch as DocumentBatch } : { lane, batch: batch as PreferenceBatch };
    expect(await restarted.inspectCommitAttempt(attempt)).toEqual({ type: 'committed', ack });
    for (const field of ['clientId', 'commitGeneration', 'editorGeneration'] as const) {
      const changed = structuredClone(attempt);
      Object.assign(changed.batch, { [field]: field === 'clientId' ? 'other-client' : 99 });
      expect(await restarted.inspectCommitAttempt(changed)).toEqual({ type: 'conflict', reason: 'identity-mismatch' });
    }
    const changed = structuredClone(attempt);
    if (changed.lane === 'document') changed.batch.expectedRevision = 1;
    else changed.batch.observedPreferenceRevision = 1;
    expect(await restarted.inspectCommitAttempt(changed)).toEqual({ type: 'conflict', reason: 'identity-mismatch' });
    const payload = structuredClone(attempt);
    if (payload.lane === 'document') payload.batch.changes = [{ type: 'set-root', rootId: 'root' }];
    else payload.batch.patch = { scale: 3 };
    expect(await restarted.inspectCommitAttempt(payload)).toEqual({ type: 'conflict', reason: 'identity-mismatch' });
    const generation = structuredClone(attempt);
    if (generation.lane === 'document') generation.batch.structural!.expectedFoldStructureGeneration = 1;
    else generation.batch.folds!.expectedFoldStructureGeneration = 1;
    expect(await restarted.inspectCommitAttempt(generation)).toEqual({ type: 'conflict', reason: 'identity-mismatch' });
    expect(h.operations.every(op => op.phase === 'inspect-read' && op.method === 'get')).toBe(true);
    await expect(restarted.commitDocument(documentBatch(h))).rejects.toThrow('ingress-required');
  });

  it('exports verified durable content without binding or publication', async () => {
    const h = await createIncrementalStoreHarness();
    await h.repository.commitDocument(documentBatch(h));
    const restarted = createNormalizedRepository(h.environment);
    expect(restarted).toHaveProperty('exportProjectForRecovery', expect.any(Function));
    h.clearOperations();
    const exported = await restarted.exportProjectForRecovery(h.scope);
    expect(exported).toEqual({ scope: h.scope,
      authority: { documentRevision: 1, preferenceRevision: 0, foldStructureGeneration: 0 }, project: await h.exportFresh() });
    expect(h.operations.every(op => op.phase === 'ingress-read' && op.method === 'getAll')).toBe(true);
    expect(h.publications).toEqual([]);
    await expect(restarted.commitDocument(documentBatch(h))).rejects.toThrow('ingress-required');
    h.setReadResult((operation, value) => {
      if (operation.store === 'projectNodes') value[0].value.title = 'corrupt';
      return value;
    });
    await expect(restarted.exportProjectForRecovery(h.scope)).rejects.toThrow();
  });
});

describe('accepted repository prerequisites for one long-lived worker', () => {
  it('saves preferences after a document-only commit without rebinding', async () => {
    const h = await createIncrementalStoreHarness();
    await h.repository.commitDocument(documentBatch(h));
    await expect(h.repository.commitPreferences(preferenceBatch(h))).resolves.toMatchObject({
      type: 'preferences-saved', preferenceRevision: 1,
    });
  });

  it('control: a separately bound owner saves the same preferences after that document commit', async () => {
    const h = await createIncrementalStoreHarness();
    await h.repository.commitDocument(documentBatch(h));
    const other = await h.anotherRepository();
    await expect(other.commitPreferences(preferenceBatch(h))).resolves.toMatchObject({
      type: 'preferences-saved', preferenceRevision: 1,
    });
  });

  it('alternates document, scalar preferences, template and fold edits without bulk ingress', async () => {
    const h = await createIncrementalStoreHarness();
    h.clearOperations();
    for (let n = 0; n < 3; n++) {
      await h.repository.commitDocument({ ...documentBatch(h), expectedRevision: n * 2,
        commitId: `title-${n}`, commitGeneration: n * 2 + 1 });
      await h.repository.commitPreferences({ ...preferenceBatch(h), observedPreferenceRevision: n * 2,
        commitId: `scale-${n}`, commitGeneration: n * 2 + 1, patch: { scale: n + 2 } });
      const template = h.initial.projectTemplates.values().next().value!.value;
      await h.repository.commitDocument({ ...documentBatch(h), expectedRevision: n * 2 + 1,
        commitId: `template-${n}`, commitGeneration: n * 2 + 2,
        changes: [{ type: 'put-template', variantId: 'default', template: { ...template, name: `template-${n}` } }],
        structural: { expectedFoldStructureGeneration: 0, mappings: template.layers!.map((_, position) => ({
          type: 'continue', from: { variantId: 'default', templateId: 'page-0', position },
          to: { variantId: 'default', templateId: 'page-0', position },
        })) } });
      await h.repository.commitPreferences({ ...preferenceBatch(h), observedPreferenceRevision: n * 2 + 1,
        commitId: `fold-${n}`, commitGeneration: n * 2 + 2, patch: {},
        folds: { expectedFoldStructureGeneration: 0, updates: [{ occurrence: {
          variantId: 'default', templateId: 'page-0', position: 0 }, collapsed: n % 2 === 0 }] } });
    }
    expect(h.operations.every(op => op.method !== 'getAll' && op.phase !== 'ingress-read')).toBe(true);
    const exported = await h.exportFresh();
    expect(exported.initialState.scale).toBe(4);
    expect(exported.initialState.variants.default.templates['page-0']).toMatchObject({ name: 'template-2', layers: [{ collapsed: true }] });
  });
});
