import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { execFileSync } from 'node:child_process';
import type * as QueueModule from '../../../../services/localWorkspace/incrementalQueue';
import type { DocumentBatch } from '../../../../services/localWorkspace/normalized/schema';
import type { WorkspaceWorkerRequest, WorkspaceWorkerResponse } from '../../../../services/localWorkspace/workspaceWorkerProtocol';
import { makeIncrementalProject } from '../../../helpers/incrementalFixtures';
import { createIncrementalWorkerHarness } from '../../../helpers/incrementalWorkerHarness';
import type { DocumentChange } from '../../../../services/document/contracts';
import { WorkspaceWorkerError } from '../../../../services/localWorkspace/workspaceWorkerClient';
import type { DocumentSaveAck } from '../../../../services/localWorkspace/normalized/schema';

const modules = import.meta.glob<typeof QueueModule>('../../../../services/localWorkspace/incrementalQueue.ts', { eager: true });
const node = makeIncrementalProject().initialState.nodes.root;
const clock = {
  now: () => Date.now(),
  setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
  clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
function createIncrementalQueueHarness(factory?: typeof QueueModule.createIncrementalQueue) {
  expect(Object.keys(modules), 'Task 9 queue implementation exists').toHaveLength(1);
  const { createIncrementalQueue } = Object.values(modules)[0];
  const requests: WorkspaceWorkerRequest[] = [];
  const waiting: { request: WorkspaceWorkerRequest; resolve: (response: WorkspaceWorkerResponse) => void; reject: (error: unknown) => void }[] = [];
  const transport = { request(request: WorkspaceWorkerRequest) {
    requests.push(request);
    return new Promise<WorkspaceWorkerResponse>((resolve, reject) => waiting.push({ request, resolve, reject }));
  } };
  const authorities = new Map<string, QueueModule.InstalledQueueAuthority>();
  const install = (projectId = 'p', floor = 0) => {
    const authority: QueueModule.InstalledQueueAuthority = { source: {}, transport, editorGenerationFloor: floor,
      binding: { type: 'bootstrapped', scope: { storageGeneration: 'g', projectId, incarnation: 'i' }, admissionId: 1,
        authority: { documentRevision: 0, preferenceRevision: 0, foldStructureGeneration: 0 } } };
    authorities.set(projectId, authority); return authority;
  };
  install();
  let id = 0;
  const events: QueueModule.QueueEvent[] = [];
  const options: QueueModule.IncrementalQueueOptions = { transport, clock, uuid: () => `id-${++id}`,
    resolveAuthority: (projectId, generation) => {
      const authority = authorities.get(projectId);
      return authority && generation > authority.editorGenerationFloor ? authority : undefined;
    }, onEvent: event => events.push(event) };
  const queue = (factory ?? createIncrementalQueue)(options);
  const observe = <T>(promise: Promise<T>) => { void promise.catch(() => {}); return promise; };
  return { queue, options, events, requests, waiting, authorities, install, observe,
    get sent(): DocumentBatch[] { return requests.flatMap(request => request.type === 'document-batch' ? [request.batch] : []); },
    enqueueTitle(generation: number, title: string, projectId = 'p') {
      return observe(queue.enqueueDocument(projectId, generation, [{ type: 'put-node', node: { ...node, title } }]));
    },
    resolveNext(response?: WorkspaceWorkerResponse) {
      const next = waiting.shift()!;
      const request = next.request;
      if (response) { next.resolve(response); return; }
      if (request.type !== 'document-batch' && request.type !== 'preferences' && request.type !== 'structural-command') throw new Error('Not a mutation');
      const batch = request.type === 'structural-command' ? request.command.batch : request.batch;
      const identity = { projectId: batch.scope.projectId, incarnation: batch.scope.incarnation, commitId: batch.commitId,
        editorGeneration: batch.editorGeneration, foldStructureGeneration: 0 };
      next.resolve(request.type === 'preferences'
        ? { type: 'preferences-result', ack: { type: 'preferences-saved', ...identity, preferenceRevision: request.batch.observedPreferenceRevision + 1 } }
        : { type: request.type === 'structural-command' ? 'structural-result' : 'document-result',
          ack: { type: 'document-saved', ...identity, revision: (batch as DocumentBatch).expectedRevision + 1 } });
    },
    rejectNext(error: unknown) { waiting.shift()!.reject(error); },
    dispose() { return queue.dispose(); },
  };
}
async function createRealQueueHarness(project = makeIncrementalProject()) {
  const worker = await createIncrementalWorkerHarness(project);
  const binding = worker.responses.find(r => r.response.type === 'bootstrapped')!.response as QueueModule.BootstrapBinding;
  let authority: QueueModule.InstalledQueueAuthority = { source: {}, transport: worker.client, binding, editorGenerationFloor: 0 };
  let id = 0;
  const events: QueueModule.QueueEvent[] = [];
  const options: QueueModule.IncrementalQueueOptions = { clock, transport: worker.client, uuid: () => `real-queue-${++id}`,
    resolveAuthority: projectId => projectId === worker.scope.projectId ? authority : undefined, onEvent: event => events.push(event) };
  const queue = Object.values(modules)[0].createIncrementalQueue(options);
  const document = (generation: number, changes: readonly DocumentChange[], structural?: QueueModule.QueueStructuralInput) => {
    const promise = queue.enqueueDocument(worker.scope.projectId, generation, { source: authority.source, changes, ...(structural ? { structural } : {}) });
    void promise.catch(() => {}); return promise;
  };
  return { ...worker, queue, options, authority, events, document,
    async rebind(client = worker.client) {
      const binding = await client.request({ type: 'bootstrap', project: await worker.readRecords() });
      if (binding.type !== 'bootstrapped') throw new Error(`Failed rebootstrap: ${binding.type}`);
      authority = { ...authority, transport: client, binding }; return authority;
    },
    dispose() { queue.dispose(); worker.client.dispose(); },
  };
}
afterEach(() => vi.useRealTimers());

describe('authenticated queue submission readmission', () => {
  const api = () => {
    const module = Object.values(modules)[0];
    expect(typeof module.getQueueSubmissionReceipt, 'private per-submission receipt').toBe('function'); return module;
  };

  it('tracks an idle installed source without posting so empty readmission still has genuine checkpoint provenance', async () => {
    vi.useFakeTimers(); const m = api(), h = createIncrementalQueueHarness();
    expect(typeof h.queue.trackProject).toBe('function'); h.queue.trackProject(h.authorities.get('p')!);
    const work = h.queue.freeze('idle owner lost'); expect(work.projects).toHaveLength(1); expect(h.requests).toEqual([]);
    const queue = recoveredQueue(h, work); queue.holdWorkspaceRecovery();
    expect(m.readQueueReadmission(await queue.prepareProjectReadmission(work, work.projects[0], [])).base)
      .toEqual({ documentRevision: 0, preferenceRevision: 0, foldStructureGeneration: 0 });
    queue.dispose(); h.dispose();
  });

  it('keeps distinct coalesced receipts and settles replay without changing original rejected promises', async () => {
    vi.useFakeTimers(); const m = api(), h = createIncrementalQueueHarness();
    const first = h.enqueueTitle(1, 'one'), second = h.enqueueTitle(2, 'two');
    const a = m.getQueueSubmissionReceipt(first)!, b = m.getQueueSubmissionReceipt(second)!;
    expect(a).toBeDefined(); expect(b).not.toBe(a); expect(Reflect.ownKeys(a)).toEqual([]);
    const work = h.queue.freeze('lost');
    await expect(first).rejects.toMatchObject({ code: 'frozen' }); await expect(second).rejects.toMatchObject({ code: 'frozen' });
    const queue = recoveredQueue(h, work), release = queue.holdWorkspaceRecovery();
    const proof = await queue.prepareProjectReadmission(work, work.projects[0], [a, b]);
    const evidence = m.readQueueReadmission(proof);
    expect(evidence.receipts.map(item => [item.receipt, item.generation, item.lane])).toEqual([[a, 1, 'document'], [b, 2, 'document']]);
    expect(h.requests).toEqual([]); release(); const flushing = queue.flush(); expect(h.sent).toHaveLength(1);
    h.resolveNext(); await flushing;
    const acknowledgements = await Promise.all(evidence.receipts.map(item => item.whenAcknowledged));
    expect(acknowledgements).toEqual([expect.objectContaining({ editorGeneration: 2, revision: 1 }), expect.objectContaining({ editorGeneration: 2, revision: 1 })]);
    await expect(first).rejects.toMatchObject({ code: 'frozen' }); queue.dispose(); h.dispose();
  });

  it('does not mint receipts for rejected admission or infer one from a generation range', async () => {
    vi.useFakeTimers(); const m = api(), h = createIncrementalQueueHarness();
    const invalid = h.observe(h.queue.enqueueDocument('p', 1, [])); await expect(invalid).rejects.toMatchObject({ code: 'invalid-input' });
    expect(m.getQueueSubmissionReceipt(invalid)).toBeUndefined();
    const saving = h.enqueueTitle(2, 'accepted skip'), receipt = m.getQueueSubmissionReceipt(saving)!;
    const work = h.queue.freeze('lost'), queue = recoveredQueue(h, work), release = queue.holdWorkspaceRecovery();
    await expect(queue.prepareProjectReadmission(work, work.projects[0], [{} as QueueModule.QueueSubmissionReceipt])).rejects.toBeDefined();
    expect(m.readQueueReadmission(await queue.prepareProjectReadmission(work, work.projects[0], [receipt])).receipts.map(item => item.generation)).toEqual([2]);
    release(); queue.dispose(); h.dispose();
  });

  it.each(['preferenceRevision', 'foldStructureGeneration'] as const)('requires exact %s for readmission even when legacy project-only recovery permits its higher value', async field => {
    vi.useFakeTimers(); const m = api(), h = createIncrementalQueueHarness(), saving = h.enqueueTitle(1, 'pending');
    const receipt = m.getQueueSubmissionReceipt(saving)!, work = h.queue.freeze('lost');
    const queue = recoveredQueue(h, work, [], { [field]: 1 }); queue.holdWorkspaceRecovery();
    await expect(queue.prepareProjectReadmission(work, work.projects[0], [receipt])).rejects.toMatchObject({ code: 'source-changed' });
    expect(h.requests).toEqual([]); queue.dispose(); h.dispose();
  });

  it('recognizes an inspected committed attempt without replay and binds proof to its real checkpoint', async () => {
    vi.useFakeTimers(); const m = api(), h = createIncrementalQueueHarness(), saving = h.enqueueTitle(1, 'uncertain');
    const receipt = m.getQueueSubmissionReceipt(saving)!; await vi.advanceTimersByTimeAsync(500);
    const work = h.queue.freeze('lost'), attempt = work.projects[0].attempts[0].attempt;
    h.resolveNext(); await work.whenQuiescent;
    const queue = recoveredQueue(h, work, [{ attempt, inspection: { type: 'commit-inspection', result: { type: 'committed', ack: documentAck(attempt) } } }], { documentRevision: 1 });
    const release = queue.holdWorkspaceRecovery(), proof = await queue.prepareProjectReadmission(work, work.projects[0], [receipt]);
    const evidence = m.readQueueReadmission(proof);
    expect(evidence.base).toEqual({ documentRevision: 1, preferenceRevision: 0, foldStructureGeneration: 0 });
    expect(await evidence.receipts[0].whenAcknowledged).toMatchObject({ revision: 1 });
    await expect(queue.prepareProjectReadmission({ ...work }, work.projects[0], [receipt])).rejects.toBeDefined();
    release(); await queue.flush(); expect(h.requests).toHaveLength(1); queue.dispose(); h.dispose();
  });

  it('associates only genuine admitted promises with their exact command metadata', async () => {
    vi.useFakeTimers(); const m = api(), h = createIncrementalQueueHarness(), command = {};
    const saving = h.enqueueTitle(1, 'admitted'), source = h.authorities.get('p')!.source;
    m.associateQueueSubmission(command, saving, source, 'document', 1);
    expect(m.getCommandQueueReceipt(command)).toBe(m.getQueueSubmissionReceipt(saving));
    expect(() => m.associateQueueSubmission({}, saving, {}, 'document', 1)).toThrow();
    expect(() => m.associateQueueSubmission({}, saving, source, 'preferences', 1)).toThrow();
    expect(() => m.associateQueueSubmission({}, saving, source, 'document', 2)).toThrow();
    expect(() => m.readQueueReadmission({} as QueueModule.VerifiedQueueReadmission)).toThrow(); h.dispose();
  });

  it('carries validated completed-receipt provenance across a second interrupted readmission', async () => {
    vi.useFakeTimers(); const m = api(), h = createIncrementalQueueHarness(), saving = h.enqueueTitle(1, 'already durable');
    const receipt = m.getQueueSubmissionReceipt(saving)!, flush = h.queue.flush(); h.resolveNext(); await flush; await saving;
    const first = h.queue.freeze('first restart'), queue = recoveredQueue(h, first); queue.holdWorkspaceRecovery();
    await queue.prepareProjectReadmission(first, first.projects[0], [receipt]);
    const second = queue.freeze('restart before hook reconciliation'), next = recoveredQueue(h, second); next.holdWorkspaceRecovery();
    const evidence = m.readQueueReadmission(await next.prepareProjectReadmission(second, second.projects[0], [receipt]));
    expect(await evidence.receipts[0].whenAcknowledged).toMatchObject({ revision: 1 }); expect(h.requests).toHaveLength(1);
    next.dispose(); queue.dispose(); h.dispose();
  });

  it('preserves completed receipt ancestry when another restart happens before proof preparation', async () => {
    vi.useFakeTimers(); const m = api(), h = createIncrementalQueueHarness(), saving = h.enqueueTitle(1, 'durable');
    const receipt = m.getQueueSubmissionReceipt(saving)!, flush = h.queue.flush(); h.resolveNext(); await flush; await saving;
    const first = h.queue.freeze('first restart'), queue = recoveredQueue(h, first); queue.holdWorkspaceRecovery();
    await vi.advanceTimersByTimeAsync(0);
    const second = queue.freeze('restart before proof preparation'), next = recoveredQueue(h, second); next.holdWorkspaceRecovery();
    const evidence = m.readQueueReadmission(await next.prepareProjectReadmission(second, second.projects[0], [receipt]));
    expect(await evidence.receipts[0].whenAcknowledged).toMatchObject({ revision: 1 });
    expect(h.requests).toHaveLength(1); next.dispose(); queue.dispose(); h.dispose();
  });

  it('releases settled replay payload after external checkpoint references are dropped', () => {
    const code = ts.transpileModule(readFileSync('services/localWorkspace/incrementalQueue.ts', 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const script = `const module = {}; new Function('exports', ${JSON.stringify(code)})(module);
      async function scenario() {
        const transport = { request: async r => ({ type: 'document-result', ack: { type: 'document-saved', projectId: 'p', incarnation: 'i',
          commitId: r.batch.commitId, editorGeneration: r.batch.editorGeneration, foldStructureGeneration: 0, revision: r.batch.expectedRevision + 1 } }) };
        let authority = { source: {}, transport, editorGenerationFloor: 0, binding: { type: 'bootstrapped', admissionId: 1,
          scope: { storageGeneration: 'g', projectId: 'p', incarnation: 'i' }, authority: { documentRevision: 0, preferenceRevision: 0, foldStructureGeneration: 0 } } };
        let n = 0; const options = { transport, clock: { now: Date.now, setTimeout, clearTimeout }, uuid: () => 'id-' + (++n), resolveAuthority: () => authority, onEvent() {} };
        const old = module.createIncrementalQueue(options); let payload = { id: 'root', title: 'retained payload' };
        const weak = new WeakRef(payload); let pending = old.enqueueDocument('p', 1, [{ type: 'put-node', node: payload }]); pending.catch(() => {});
        let checkpoint = old.freeze('restart'); payload = null; pending = null;
        authority = { ...authority, binding: { ...authority.binding, admissionId: 2 } };
        const queue = module.createIncrementalQueue({ ...options, recovery: { retained: checkpoint,
          projects: [{ previous: checkpoint.projects[0], authority, resolutions: [] }] } });
        await queue.flush(); old.dispose(); checkpoint = null; return { queue, weak };
      }
      const live = await scenario();
      for (let i = 0; i < 12; i++) { await new Promise(setImmediate); global.gc(); }
      const released = live.weak.deref() === undefined; live.queue.dispose();
      console.log(JSON.stringify({ released }));`;
    const output = execFileSync(process.execPath, ['--expose-gc', '--input-type=module', '-e', script], { encoding: 'utf8' });
    expect(JSON.parse(output)).toEqual({ released: true });
  });
});

describe('workspace recovery hold', () => {
  it('blocks producers, flush and both barrier families until its own idempotent release', async () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness();
    expect(typeof h.queue.holdWorkspaceRecovery).toBe('function');
    const first = h.queue.holdWorkspaceRecovery(), second = h.queue.holdWorkspaceRecovery();
    const payload = vi.fn(() => { throw Error('Held payload read'); });
    const changes = Object.defineProperty([], '0', { enumerable: true, get: payload });
    await expect(h.queue.enqueueDocument('p', 1, changes)).rejects.toMatchObject({ code: 'retry-required' });
    await expect(h.queue.flush()).rejects.toMatchObject({ code: 'retry-required' });
    const run = vi.fn(async () => ({ type: 'completed' as const, value: undefined }));
    await expect(h.queue.barrier({ kind: 'drain', targets: [], run })).rejects.toMatchObject({ code: 'retry-required' });
    await expect(h.queue.workspaceBarrier({ targets: [], retireScopes: [], run })).rejects.toMatchObject({ code: 'retry-required' });
    first(); first(); await expect(h.queue.flush()).rejects.toMatchObject({ code: 'retry-required' });
    expect(payload).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled(); second();
    const saving = h.enqueueTitle(1, 'released'), flushing = h.queue.flush(); h.resolveNext(); await saving; await flushing; h.dispose();
  });

  it('holds recovered acknowledgements and pending work until inspection releases the hold and caller flushes explicitly', async () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness();
    expect(typeof h.queue.holdWorkspaceRecovery).toBe('function');
    h.enqueueTitle(1, 'unknown'); await vi.advanceTimersByTimeAsync(500); h.enqueueTitle(2, 'retained');
    const work = h.queue.freeze('old owner stopped'), attempted = work.projects[0].attempts[0].attempt;
    const queue = recoveredQueue(h, work, [{ attempt: attempted, inspection: { type: 'commit-inspection', result: { type: 'committed', ack: documentAck(attempted) } } }],
      { documentRevision: 1 });
    const release = queue.holdWorkspaceRecovery(), before = h.events.length;
    h.resolveNext(); await work.whenQuiescent; await vi.advanceTimersByTimeAsync(0);
    await expect(queue.flush()).rejects.toMatchObject({ code: 'retry-required' });
    expect(h.events.length).toBe(before); expect(h.requests).toHaveLength(1);
    release(); await vi.advanceTimersByTimeAsync(5000);
    expect(h.events.length).toBe(before); expect(h.requests).toHaveLength(1);
    const flushing = queue.flush(); expect(h.events.at(-1)!.type).toBe('acknowledged'); expect(h.requests).toHaveLength(2);
    h.resolveNext(); await flushing; queue.dispose(); h.dispose();
  });

  it('cannot revive a frozen queue and refuses to hold an already active request', async () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness();
    expect(typeof h.queue.holdWorkspaceRecovery).toBe('function');
    const release = h.queue.holdWorkspaceRecovery(); h.queue.freeze('lost'); release();
    await expect(h.queue.flush()).rejects.toMatchObject({ code: 'frozen' });
    const live = createIncrementalQueueHarness(); live.enqueueTitle(1, 'active'); await vi.advanceTimersByTimeAsync(500);
    expect(() => live.queue.holdWorkspaceRecovery()).toThrow(); live.resolveNext(); await vi.advanceTimersByTimeAsync(0);
    live.dispose(); h.dispose();
  });
});

describe('retaining workspace queue cuts', () => {
  const setup = () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness();
    expect(typeof h.queue.workspaceBarrier, 'retaining workspace barrier').toBe('function'); return h;
  };
  const gate = <T,>() => {
    let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve };
  };

  it('drains both lanes and older metadata but retains later survivor edits behind the captured cut', async () => {
    const h = setup(), authority = h.authorities.get('p')!, held = gate<QueueModule.QueueBarrierOutcome<string>>();
    h.enqueueTitle(1, 'before'); await vi.advanceTimersByTimeAsync(500);
    h.observe(h.queue.enqueuePreferences('p', 1, { scale: 2 }));
    h.observe(h.queue.enqueueDocument('p', 2, { source: authority.source, changes: [], metadata: { kind: 'patch', name: 'before metadata' } }));
    const run = vi.fn(() => held.promise);
    const barrier = h.observe(h.queue.workspaceBarrier({ targets: [authority], retireScopes: [], run }));
    const newer = h.enqueueTitle(3, 'after');
    h.resolveNext(); await vi.advanceTimersByTimeAsync(0); expect(h.requests[1].type).toBe('preferences');
    h.resolveNext(); await vi.advanceTimersByTimeAsync(0); expect(h.sent[1].metadata).toEqual({ kind: 'patch', name: 'before metadata' });
    h.resolveNext(); await vi.advanceTimersByTimeAsync(5000);
    expect(run).toHaveBeenCalledExactlyOnceWith({ targets: [{ authority,
      stamp: { documentRevision: 2, preferenceRevision: 1, foldStructureGeneration: 0 } }] });
    expect(h.requests).toHaveLength(3);
    held.resolve({ type: 'completed', value: 'switched' }); expect(await barrier).toBe('switched'); await vi.advanceTimersByTimeAsync(0);
    expect(h.sent.at(-1)!.changes).toEqual([{ type: 'put-node', node: { ...node, title: 'after' } }]);
    h.resolveNext(); await newer; h.dispose();
  });

  it('orders two cuts without coalescing edits before, between or after them', async () => {
    const h = setup(), first = gate<QueueModule.QueueBarrierOutcome<number>>(), second = gate<QueueModule.QueueBarrierOutcome<number>>();
    const order: string[] = [];
    h.enqueueTitle(1, 'before');
    const one = h.observe(h.queue.workspaceBarrier({ targets: [], retireScopes: [], run: () => { order.push('one'); return first.promise; } }));
    h.enqueueTitle(2, 'between');
    const two = h.observe(h.queue.workspaceBarrier({ targets: [], retireScopes: [], run: () => { order.push('two'); return second.promise; } }));
    const last = h.enqueueTitle(3, 'after');
    expect(h.sent).toHaveLength(1); h.resolveNext(); await vi.advanceTimersByTimeAsync(0); expect(order).toEqual(['one']);
    first.resolve({ type: 'completed', value: 1 }); await one; await vi.advanceTimersByTimeAsync(0);
    expect(h.sent.map(batch => batch.editorGeneration)).toEqual([1, 2]); expect(order).toEqual(['one']);
    h.resolveNext(); await vi.advanceTimersByTimeAsync(0); expect(order).toEqual(['one', 'two']);
    await vi.advanceTimersByTimeAsync(5000); expect(h.sent).toHaveLength(2);
    second.resolve({ type: 'completed', value: 2 }); await two; await vi.advanceTimersByTimeAsync(0);
    expect(h.sent.map(batch => batch.editorGeneration)).toEqual([1, 2, 3]); h.resolveNext(); await last; h.dispose();
  });

  it('retires the target immediately while keeping other-project edits admissible', async () => {
    const h = setup(), target = h.authorities.get('p')!, other = h.install('other'), held = gate<QueueModule.QueueBarrierOutcome<void>>();
    const barrier = h.observe(h.queue.workspaceBarrier({ targets: [target], retireScopes: [target.binding.scope], run: () => held.promise }));
    const getter = vi.fn(() => { throw Error('retired payload read'); });
    const changes = Object.defineProperty([], '0', { enumerable: true, get: getter });
    await expect(h.queue.enqueueDocument('p', 1, changes)).rejects.toMatchObject({ code: 'source-changed' });
    expect(getter).not.toHaveBeenCalled(); const saving = h.enqueueTitle(1, 'survives', other.binding.scope.projectId);
    await vi.advanceTimersByTimeAsync(5000); expect(h.sent).toEqual([]);
    held.resolve({ type: 'completed', value: undefined }); await barrier; await vi.advanceTimersByTimeAsync(0);
    expect(h.sent[0].scope.projectId).toBe('other'); h.resolveNext(); await saving;
    await expect(h.enqueueTitle(2, 'still retired')).rejects.toMatchObject({ code: 'source-changed' }); h.dispose();
  });

  it('holds survivors and refuses unposted later cuts after a workspace failure', async () => {
    const h = setup(), held = gate<QueueModule.QueueBarrierOutcome<void>>(), later = vi.fn(async () => ({ type: 'completed' as const, value: undefined }));
    const one = h.observe(h.queue.workspaceBarrier({ targets: [], retireScopes: [], run: () => held.promise }));
    h.enqueueTitle(1, 'between');
    const two = h.observe(h.queue.workspaceBarrier({ targets: [], retireScopes: [], run: later }));
    h.enqueueTitle(2, 'after'); await vi.advanceTimersByTimeAsync(0);
    const failure: QueueModule.QueueFailure = { type: 'domain', response: { type: 'failed', code: 'authority-changed', outcome: 'unknown', admission: 'invalidated' } };
    held.resolve({ type: 'failed', failure }); await expect(one).rejects.toEqual(failure); await expect(two).rejects.toEqual(failure);
    expect(later).not.toHaveBeenCalled(); expect(h.sent).toEqual([]);
    const retained = h.dispose(); expect(retained.projects[0].pending.map(segment => segment.editorGeneration)).toEqual([1, 2]);
    await retained.whenQuiescent;
  });

  it('includes an active workspace callback in frozen quiescence without publishing its late result', async () => {
    const h = setup(), held = gate<QueueModule.QueueBarrierOutcome<string>>();
    const run = vi.fn(() => held.promise), barrier = h.observe(h.queue.workspaceBarrier({ targets: [], retireScopes: [], run }));
    await vi.advanceTimersByTimeAsync(0); expect(run).toHaveBeenCalledTimes(1); h.enqueueTitle(1, 'retained');
    const work = h.queue.freeze('lost owner'); let quiet = false; void work.whenQuiescent.then(() => { quiet = true; });
    await expect(barrier).rejects.toMatchObject({ code: 'frozen' }); await vi.advanceTimersByTimeAsync(0); expect(quiet).toBe(false);
    held.resolve({ type: 'completed', value: 'must not publish' }); await work.whenQuiescent; expect(quiet).toBe(true);
    expect(work.projects[0].pending[0].editorGeneration).toBe(1); expect(h.sent).toEqual([]); h.dispose();
  });

  it('rechecks the captured target installation after draining instead of adopting a replacement', async () => {
    const h = setup(), target = h.authorities.get('p')!, run = vi.fn(async () => ({ type: 'completed' as const, value: undefined }));
    h.enqueueTitle(1, 'captured');
    const barrier = h.observe(h.queue.workspaceBarrier({ targets: [target], retireScopes: [], run }));
    h.install(); h.resolveNext(); await expect(barrier).rejects.toMatchObject({ code: 'source-changed' });
    expect(run).not.toHaveBeenCalled(); expect(h.dispose().projects[0].attempts).toHaveLength(1);
  });

  it('does not overwrite newly admitted work when target resolution reenters before cut capture', async () => {
    vi.useFakeTimers(); let reenter: (() => void) | undefined;
    const h = createIncrementalQueueHarness(options => Object.values(modules)[0].createIncrementalQueue({ ...options,
      resolveAuthority(...args) {
        const authority = options.resolveAuthority(...args), callback = reenter; reenter = undefined; callback?.(); return authority;
      } }));
    expect(typeof h.queue.workspaceBarrier).toBe('function');
    reenter = () => { h.enqueueTitle(1, 'Accepted during resolution'); };
    const run = vi.fn(async () => ({ type: 'completed' as const, value: undefined }));
    await expect(h.queue.workspaceBarrier({ targets: [h.authorities.get('p')!], retireScopes: [], run })).rejects.toMatchObject({ code: 'source-changed' });
    expect(run).not.toHaveBeenCalled();
    const flushing = h.queue.flush(); expect(h.sent).toHaveLength(1); h.resolveNext(); await flushing;
    expect(h.sent[0].changes).toEqual([{ type: 'put-node', node: { ...node, title: 'Accepted during resolution' } }]); h.dispose();
  });

  it.each((['document', 'preferences'] as const).flatMap(lane => (['retire', 'freeze', 'dispose', 'binding'] as const).map(action => ({ lane, action }))))
  ('refuses $lane publication if the final authority resolver reenters $action', async ({ lane, action }) => {
    vi.useFakeTimers(); let calls = 0, armed = false, barrier: Promise<void> | undefined;
    const h = createIncrementalQueueHarness(options => Object.values(modules)[0].createIncrementalQueue({ ...options,
      resolveAuthority(...args) {
        const value = options.resolveAuthority(...args);
        if (armed && ++calls === 2) {
          armed = false;
          if (action === 'retire') {
            const target = h.authorities.get('p')!;
            barrier = h.observe(h.queue.workspaceBarrier({ targets: [target], retireScopes: [target.binding.scope],
              run: async () => ({ type: 'completed', value: undefined }) }));
          } else if (action === 'binding') Reflect.set(h.authorities.get('p')!.binding.scope, 'incarnation', 'changed');
          else if (action === 'freeze') h.queue.freeze('during admission');
          else h.queue.dispose();
        }
        return value;
      } }));
    h.enqueueTitle(1, 'accepted before callback'); armed = true;
    const settled = vi.fn();
    const newer = lane === 'document' ? h.enqueueTitle(2, 'must be refused') : h.observe(h.queue.enqueuePreferences('p', 2, { scale: 3 }));
    void newer.then(settled, settled);
    if (action === 'retire') { h.resolveNext(); await barrier; }
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'queue',
      code: action === 'retire' || action === 'binding' ? 'source-changed' : action === 'freeze' ? 'frozen' : 'disposed' }));
    expect(h.requests).toHaveLength(action === 'retire' ? 1 : 0); h.dispose();
  });

  it.each(['old-first', 'workspace-first'] as const)('refuses overlapping old and workspace barrier modes: %s', async order => {
    const h = setup(), held = gate<QueueModule.QueueBarrierOutcome<void>>();
    const old = () => h.queue.barrier({ kind: 'drain', targets: [], run: () => held.promise });
    const workspace = () => h.queue.workspaceBarrier({ targets: [], retireScopes: [], run: () => held.promise });
    const active = order === 'old-first' ? old() : workspace();
    await expect(order === 'old-first' ? workspace() : old()).rejects.toMatchObject({ code: 'barrier-active' });
    held.resolve({ type: 'completed', value: undefined }); await active; h.dispose();
  });

  it.each((['document', 'preferences'] as const).flatMap(lane => (['resolver', 'uuid'] as const).flatMap(trigger =>
    (['barrier', 'freeze', 'dispose'] as const).map(action => ({ lane, trigger, action })))))
  ('reserves $lane dispatch before $trigger reenters $action', async ({ lane, trigger, action }) => {
    vi.useFakeTimers(); let armed = false, barrier: Promise<void> | undefined;
    const run = vi.fn(async () => ({ type: 'completed' as const, value: undefined }));
    const interrupt = () => {
      if (!armed) return; armed = false;
      if (action === 'barrier') barrier = h.observe(h.queue.workspaceBarrier({ targets: [], retireScopes: [], run }));
      else if (action === 'freeze') h.queue.freeze('dispatch interrupted'); else h.queue.dispose();
    };
    const h = createIncrementalQueueHarness(options => Object.values(modules)[0].createIncrementalQueue({ ...options,
      resolveAuthority(...args) { const result = options.resolveAuthority(...args); if (trigger === 'resolver') interrupt(); return result; },
      uuid() { const id = options.uuid(); if (trigger === 'uuid') interrupt(); return id; } }));
    const saving = lane === 'document' ? h.enqueueTitle(1, 'before cut') : h.observe(h.queue.enqueuePreferences('p', 1, { scale: 2 }));
    armed = true;
    try {
      await vi.advanceTimersByTimeAsync(1000);
      expect(h.requests).toHaveLength(action === 'barrier' ? 1 : 0);
      if (action === 'barrier') { h.resolveNext(); await saving; await barrier; expect(run).toHaveBeenCalledTimes(1); }
      else {
        await expect(saving).rejects.toMatchObject({ code: action === 'freeze' ? 'frozen' : 'disposed' });
        expect(h.dispose().projects[0].pending).toHaveLength(1);
      }
    } finally { h.dispose(); while (h.waiting.length) h.rejectNext(Error('Test owner ended')); }
  });

  it.each(['document', 'preferences'] as const)('does not publish a %s ack after its resolver activates a failing workspace drain', async lane => {
    vi.useFakeTimers(); let armed = false, failOther = false, barrier: Promise<void> | undefined;
    const h = createIncrementalQueueHarness(options => {
      const request = options.transport.request;
      options.transport.request = message => {
        if (failOther && 'batch' in message && 'scope' in message.batch && message.batch.scope.projectId === 'other') throw Error('Other transport failed');
        return request(message);
      };
      return Object.values(modules)[0].createIncrementalQueue({ ...options, resolveAuthority(...args) {
        const authority = options.resolveAuthority(...args);
        if (armed) {
          armed = false; failOther = true;
          barrier = h.observe(h.queue.workspaceBarrier({ targets: [], retireScopes: [], run: async () => ({ type: 'completed', value: undefined }) }));
        }
        return authority;
      } });
    });
    h.install('other');
    const saving = lane === 'document' ? h.enqueueTitle(1, 'acknowledging') : h.observe(h.queue.enqueuePreferences('p', 1, { scale: 2 }));
    const flushed = h.observe(h.queue.flush('p')); h.enqueueTitle(1, 'will fail', 'other');
    armed = true; h.resolveNext(); await vi.advanceTimersByTimeAsync(0);
    await expect(saving).rejects.toMatchObject({ type: 'transport' });
    await expect(flushed).rejects.toMatchObject({ type: 'transport' }); await expect(barrier).rejects.toMatchObject({ type: 'transport' });
    expect(h.events.map(event => event.type)).toEqual(['frozen']);
    const work = h.dispose(); await work.whenQuiescent;
    expect(work.projects.find(project => project.authority.binding.scope.projectId === 'p')!.attempts).toHaveLength(1);
  });

  it('rechecks every pinned target after the last post-drain resolver can change an earlier target', async () => {
    vi.useFakeTimers(); let armed = false;
    const h = createIncrementalQueueHarness(options => Object.values(modules)[0].createIncrementalQueue({ ...options,
      resolveAuthority(...args) {
        const current = options.resolveAuthority(...args);
        if (armed && args[0] === 'other') { armed = false; Reflect.set(h.authorities.get('p')!, 'source', {}); }
        return current;
      } }));
    const other = h.install('other'), run = vi.fn(async () => ({ type: 'completed' as const, value: undefined }));
    const barrier = h.observe(h.queue.workspaceBarrier({ targets: [h.authorities.get('p')!, other], retireScopes: [], run }));
    armed = true;
    await expect(barrier).rejects.toMatchObject({ code: 'source-changed' }); expect(run).not.toHaveBeenCalled(); h.dispose();
  });
});

it('retains pending metadata through queue disposal and independent recovery binding', async () => {
  vi.useFakeTimers(); const h = createIncrementalQueueHarness();
  const metadata = { kind: 'patch' as const, name: 'Captured metadata' };
  h.observe(h.queue.enqueueDocument('p', 1, { source: h.authorities.get('p')!.source, changes: [], metadata }));
  metadata.name = 'Caller changed envelope';
  const work = h.dispose();
  expect(h.requests).toEqual([]);
  const q = recoveredQueue(h, work);
  try {
    const flush = q.flush('p'); await vi.advanceTimersByTimeAsync(0);
    expect(h.sent).toHaveLength(1); expect(h.sent[0].changes).toEqual([]);
    expect(h.sent[0].metadata).toEqual({ kind: 'patch', name: 'Captured metadata' });
    h.resolveNext(); await flush;
  } finally { q.dispose(); }
});

it('captures metadata tags without traversing an opaque cloud value on the main thread', async () => {
  vi.useFakeTimers(); const h = createIncrementalQueueHarness();
  const getter = vi.fn(() => { throw new Error('Cloud payload inspected'); });
  const value = Object.defineProperty({}, 'projectId', { enumerable: true, get: getter });
  const saving = h.observe(h.queue.enqueueDocument('p', 1, { source: h.authorities.get('p')!.source, changes: [],
    metadata: { kind: 'patch', cloud: { type: 'set', value: value as { projectId: string; lastSyncedCommitId: string } } } }));
  try {
    const flush = h.queue.flush('p'); await vi.advanceTimersByTimeAsync(0);
    const metadata = h.sent[0].metadata;
    if (metadata?.kind !== 'patch' || metadata.cloud?.type !== 'set') throw new Error('Expected cloud set envelope');
    expect(metadata.cloud.value).toBe(value); expect(getter).not.toHaveBeenCalled();
    // This fixture tests queue framing only; a real worker validates the value.
    h.resolveNext(); await flush; await saving;
  } finally { h.dispose(); }
});

function recoveredQueue(h: ReturnType<typeof createIncrementalQueueHarness>, work: QueueModule.RetainedQueueWork,
  resolutions: readonly QueueModule.AttemptResolution[] = [], stamp: Partial<QueueModule.BootstrapBinding['authority']> = {},
  transform: (a: QueueModule.InstalledQueueAuthority) => QueueModule.InstalledQueueAuthority = a => a) {
  const previous = work.projects[0];
  const authority = transform({ ...previous.authority, binding: { ...previous.authority.binding, admissionId: previous.authority.binding.admissionId + 1,
    authority: { documentRevision: previous.acknowledged.documentRevision, preferenceRevision: previous.acknowledged.preferenceRevisionLowerBound,
      foldStructureGeneration: previous.acknowledged.foldStructureGeneration, ...stamp } } });
  h.authorities.set(authority.binding.scope.projectId, authority);
  return Object.values(modules)[0].createIncrementalQueue({ ...h.options,
    recovery: { retained: work, projects: [{ previous, authority, resolutions }] } });
}
function documentAck(attempt: QueueModule.QueueAttempt): DocumentSaveAck {
  if (attempt.lane !== 'document') throw new Error('Expected document attempt');
  return { type: 'document-saved', projectId: attempt.batch.scope.projectId, incarnation: attempt.batch.scope.incarnation,
    commitId: attempt.batch.commitId, editorGeneration: attempt.batch.editorGeneration,
    revision: attempt.batch.expectedRevision + 1, foldStructureGeneration: attempt.batch.structural?.expectedFoldStructureGeneration ?? 0 };
}
function instrumentQueue(counter = 0) {
  let source = readFileSync('services/localWorkspace/incrementalQueue.ts', 'utf8');
  const counterMarker = 'let commitGeneration = 0;'; const returnMarker = '  return {\n    enqueueDocument:';
  expect(source.split(counterMarker)).toHaveLength(2); expect(source.split(returnMarker)).toHaveLength(2);
  source = source.replace(counterMarker, `let commitGeneration = ${counter};`).replace(returnMarker,
    `  exports.inspectRecoveryFlushes = () => typeof recoveryFlushes === 'undefined' ? 0 : recoveryFlushes.size;
  exports.inspect = () => ({ ids: ownedIds.size, flushes: flushes.size, projects: [...projects.values()].map(p => ({
      pending: p.pending.length, active: !!p.active, acks: p.structuralAcks.size, recovered: p.recoveredAcks.length,
      waiters: p.pending.reduce((count, s) => count + s.waiters.length, 0) + (p.active?.segment.waiters.length ?? 0),
    })) });\n${returnMarker}`);
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exported = {} as typeof QueueModule & { inspectRecoveryFlushes(): number; inspect(): { ids: number; flushes: number; projects: unknown[] } };
  new Function('exports', output)(exported); return exported;
}

describe('incremental queue', () => {
  it('cannot postpone continuous edits beyond the maximum pending wait', async () => {
    vi.useFakeTimers();
    const h = createIncrementalQueueHarness();
    for (let generation = 1; generation <= 5; generation++) {
      h.enqueueTitle(generation, String(generation));
      await vi.advanceTimersByTimeAsync(400);
    }
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].changes[0]).toMatchObject({ node: { title: '5' } });
    h.dispose();
  });

  it('debounces quiet document edits and settles coalesced callers with one small ack', async () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness();
    const first = h.enqueueTitle(1, 'a'); const second = h.enqueueTitle(2, 'b');
    await vi.advanceTimersByTimeAsync(499); expect(h.requests).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1); expect(h.sent).toHaveLength(1);
    h.resolveNext(); expect(await first).toBe(await second);
    expect(h.events).toHaveLength(1); expect(h.events[0]).toMatchObject({ type: 'acknowledged' });
    expect(h.dispose().projects[0]).toMatchObject({ pending: [], attempts: [], structuralAcks: [] });
  });

  it('uses independent 1000/5000 ms preference deadlines and coalesces top-level fields', async () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness();
    for (let g = 1; g <= 6; g++) {
      h.observe(h.queue.enqueuePreferences('p', g, { scale: g }));
      await vi.advanceTimersByTimeAsync(800);
    }
    expect(h.requests).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200); expect(h.requests).toHaveLength(1);
    expect(h.requests[0]).toMatchObject({ type: 'preferences', batch: { patch: { scale: 6 }, observedPreferenceRevision: 0 } });
    h.resolveNext(); await vi.advanceTimersByTimeAsync(0);
    const pref = h.observe(h.queue.enqueuePreferences('p', 7, { showGrid: true }));
    await vi.advanceTimersByTimeAsync(999); expect(h.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1); h.resolveNext(); await pref;
    expect(h.sent).toHaveLength(0); h.dispose();
  });

  it('keeps active batch immutable and dispatches overdue pending work immediately after ack', async () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness();
    h.enqueueTitle(1, 'active'); await vi.advanceTimersByTimeAsync(500);
    const original = h.sent[0]; h.enqueueTitle(2, 'pending');
    await vi.advanceTimersByTimeAsync(2500); expect(h.sent).toHaveLength(1);
    h.resolveNext(); await vi.advanceTimersByTimeAsync(0);
    expect(h.sent).toHaveLength(2); expect(h.sent[0]).toBe(original);
    expect(original.changes[0]).toMatchObject({ node: { title: 'active' } });
    expect(h.sent[1]).toMatchObject({ expectedRevision: 1, editorGeneration: 2 }); h.dispose();
  });

  it('does not reset a pending quiet deadline when an active write finishes early', async () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness();
    h.enqueueTitle(1, 'active'); await vi.advanceTimersByTimeAsync(500);
    h.enqueueTitle(2, 'pending'); await vi.advanceTimersByTimeAsync(100); h.resolveNext();
    await vi.advanceTimersByTimeAsync(399); expect(h.sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1); expect(h.sent).toHaveLength(2); h.dispose();
  });

  it('serializes same-project lanes while letting unrelated projects post', async () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness(); h.install('q');
    h.enqueueTitle(1, 'p'); h.observe(h.queue.enqueuePreferences('p', 1, { scale: 2 })); h.enqueueTitle(1, 'q', 'q');
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.requests).toHaveLength(2);
    h.resolveNext(); await vi.advanceTimersByTimeAsync(0);
    expect(h.requests[2]).toMatchObject({ type: 'preferences' });
    const batches = h.requests.map(r => r.type === 'document-batch' || r.type === 'preferences' ? r.batch : undefined)!;
    expect(batches.map(b => b!.commitGeneration)).toEqual([1, 2, 3]); h.dispose();
  });

  it('flush captures sealed targets rather than future typing', async () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness();
    h.enqueueTitle(1, 'captured'); const flush = h.queue.flush('p');
    h.enqueueTitle(2, 'future'); expect(h.sent).toHaveLength(1);
    h.resolveNext(); await flush;
    expect(h.sent).toHaveLength(1); expect(h.dispose().projects[0].pending[0]).toMatchObject({ editorGeneration: 2 });
  });

  it('rejects missing, stale and replaced authority without evaluating payload getters', async () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness();
    const getter = vi.fn(() => { throw new Error('payload read'); });
    const input = Object.defineProperty({}, 'changes', { get: getter }) as QueueModule.QueueDocumentInput;
    await expect(h.queue.enqueueDocument('missing', 1, input)).rejects.toMatchObject({ code: 'missing-authority' });
    h.enqueueTitle(2, 'current');
    await expect(h.queue.enqueueDocument('p', 1, input)).rejects.toMatchObject({ code: 'stale-generation' });
    const source = h.authorities.get('p')!.source;
    await expect(h.queue.enqueueDocument('p', 3, { source: {}, changes: [] })).rejects.toMatchObject({ code: 'source-changed' });
    expect(getter).not.toHaveBeenCalled();
    h.install('p', 3); await vi.advanceTimersByTimeAsync(500);
    expect(h.sent).toHaveLength(0); expect(h.events[0]).toMatchObject({ type: 'project-blocked' });
    expect(h.dispose().projects[0].authority.source).toBe(source);
  });

  it('does not traverse immutable payloads or invoke address accessors', async () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness();
    const getter = vi.fn(() => { throw new Error('payload read'); });
    const opaque = Object.defineProperty({ ...node }, 'data', { enumerable: true, get: getter });
    const promise = h.observe(h.queue.enqueueDocument('p', 1, [{ type: 'put-node', node: opaque }]));
    await vi.advanceTimersByTimeAsync(500);
    expect((h.sent[0].changes[0] as { node: unknown }).node).toBe(opaque); expect(getter).not.toHaveBeenCalled();
    h.resolveNext(); await promise;
    const bad = Object.defineProperty({ ...node }, 'id', { get: getter });
    await expect(h.queue.enqueueDocument('p', 2, [{ type: 'put-node', node: bad }])).rejects.toMatchObject({ code: 'invalid-input' });
    expect(getter).not.toHaveBeenCalled(); h.dispose();
  });

  it('treats resolved domain failure as failure and retains pending document edits independently', async () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness(); h.install('q');
    const saved = h.enqueueTitle(1, 'saved'); const firstFlush = h.queue.flush('p'); h.resolveNext(); await firstFlush; await saved;
    const preferences = h.observe(h.queue.enqueuePreferences('p', 2, { scale: 2 }));
    await vi.advanceTimersByTimeAsync(1000);
    const unsaved = h.enqueueTitle(3, 'unsaved'); const flush = h.observe(h.queue.flush('p'));
    h.resolveNext({ type: 'failed', code: 'quota-exceeded', outcome: 'unknown', admission: 'invalidated' });
    await expect(preferences).rejects.toMatchObject({ type: 'domain' });
    await expect(unsaved).rejects.toMatchObject({ type: 'domain' }); await expect(flush).rejects.toMatchObject({ type: 'domain' });
    h.enqueueTitle(1, 'other', 'q'); await vi.advanceTimersByTimeAsync(500);
    expect(h.requests).toHaveLength(3);
    const work = h.dispose().projects.find(p => p.authority.binding.scope.projectId === 'p')!;
    expect(work.acknowledged.documentGeneration).toBe(1);
    expect(work.pending[0]).toMatchObject({ editorGeneration: 3 }); expect(work.attempts[0].attempt.lane).toBe('preferences');
  });

  it('freeze retains exact active attempt and later work, rejects waiters and awaits quiescence', async () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness();
    const active = h.enqueueTitle(1, 'active'); const flush = h.observe(h.queue.flush());
    const later = h.enqueueTitle(2, 'later'); const work = h.queue.freeze('stop');
    expect(work.projects[0].attempts[0].attempt.batch).toBe(h.sent[0]);
    await expect(active).rejects.toMatchObject({ code: 'frozen' }); await expect(later).rejects.toMatchObject({ code: 'frozen' });
    await expect(flush).rejects.toMatchObject({ code: 'frozen' });
    let quiescent = false; void work.whenQuiescent.then(() => { quiescent = true; });
    await vi.advanceTimersByTimeAsync(6000); expect(quiescent).toBe(false);
    h.resolveNext(); await work.whenQuiescent; expect(h.events.filter(e => e.type === 'acknowledged')).toHaveLength(0);
    expect(h.requests).toHaveLength(1); expect(h.dispose().projects[0].pending).toHaveLength(1);
    await expect(h.queue.flush()).rejects.toMatchObject({ code: 'disposed' });
  });

  it('terminal rejection freezes all projects without restarting or replaying', async () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness(); h.install('q');
    h.enqueueTitle(1, 'p'); h.enqueueTitle(1, 'q', 'q'); const flush = h.observe(h.queue.flush());
    h.rejectNext(new Error('worker failed')); await expect(flush).rejects.toMatchObject({ type: 'transport' });
    await vi.advanceTimersByTimeAsync(10000); expect(h.requests).toHaveLength(2);
    expect(h.dispose().projects.every(p => p.attempts.length === 1)).toBe(true);
  });

  it('preserves ordered tombstones, supersedes puts and keeps colliding-looking addresses distinct', async () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness();
    const put = (id: string, title = id): DocumentChange => ({ type: 'put-node', node: { ...node, id, title } });
    h.observe(h.queue.enqueueDocument('p', 1, [put('a'), put('b')]));
    h.observe(h.queue.enqueueDocument('p', 2, [{ type: 'delete-node', nodeId: 'a' }, put('a', 'recreated')]));
    h.observe(h.queue.enqueueDocument('p', 3, [put('a', 'latest'), put('1:a'), put('a:1')]));
    const flush = h.queue.flush();
    expect(h.sent[0].changes.map(c => c.type)).toEqual(['put-node', 'delete-node', 'put-node', 'put-node', 'put-node']);
    expect(h.sent[0].changes[2]).toMatchObject({ node: { id: 'a', title: 'latest' } });
    h.resolveNext(); await flush; h.dispose();
  });

  it('drains barriers, rejects new admission and retires replacement authority', async () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness();
    const authority = h.authorities.get('p')!; h.enqueueTitle(1, 'before');
    const run = vi.fn(async () => ({ type: 'completed' as const, value: 'closed' }));
    const barrier = h.observe(h.queue.barrier({ kind: 'close', targets: [authority], run }));
    expect(h.sent).toHaveLength(1); expect(run).not.toHaveBeenCalled();
    await expect(h.enqueueTitle(2, 'blocked')).rejects.toMatchObject({ code: 'barrier-active' });
    h.resolveNext(); expect(await barrier).toBe('closed'); expect(run).toHaveBeenCalledTimes(1);
    await expect(h.enqueueTitle(2, 'old source')).rejects.toMatchObject({ code: 'source-changed' });
    h.install('p', 2); h.enqueueTitle(3, 'new source'); const flush = h.queue.flush(); h.resolveNext(); await flush; h.dispose();
  });

  it('never runs a barrier after a failed drain and rejects overlapping barriers', async () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness(); h.enqueueTitle(1, 'before');
    const run = vi.fn(async () => ({ type: 'completed' as const, value: 1 }));
    const operation = { kind: 'close' as const, targets: [h.authorities.get('p')!], run };
    const barrier = h.observe(h.queue.barrier(operation));
    await expect(h.queue.barrier(operation)).rejects.toMatchObject({ code: 'barrier-active' });
    h.resolveNext({ type: 'failed', code: 'stale-admission', outcome: 'not-started', admission: 'none' });
    await expect(barrier).rejects.toMatchObject({ type: 'domain' }); expect(run).not.toHaveBeenCalled(); h.dispose();
  });

  it('orders old-side fold, structural command and new-side fold using ack generation', async () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness(); const source = h.authorities.get('p')!.source;
    const occurrence = { variantId: 'default', templateId: 'page-0', position: 0 };
    h.observe(h.queue.enqueuePreferences('p', 1, { source, patch: {}, folds: {
      basis: { type: 'generation', generation: 0 }, updates: [{ occurrence, collapsed: true }],
    } }));
    h.observe(h.queue.enqueueDocument('p', 2, { source, changes: [{ type: 'put-node', node }], structural: {
      basis: { type: 'generation', generation: 0 }, mappings: [],
    } }));
    h.observe(h.queue.enqueuePreferences('p', 3, { source, patch: {}, folds: {
      basis: { type: 'after-structural', editorGeneration: 2 }, updates: [{ occurrence, collapsed: false }],
    } }));
    const flush = h.queue.flush(); expect(h.requests.map(r => r.type)).toEqual(['preferences']);
    h.resolveNext(); await vi.advanceTimersByTimeAsync(0);
    expect(h.requests[1]).toMatchObject({ type: 'structural-command', command: { batch: { structural: { expectedFoldStructureGeneration: 0 } } } });
    h.resolveNext(); await vi.advanceTimersByTimeAsync(0);
    expect(h.requests[2]).toMatchObject({ type: 'preferences', batch: { observedPreferenceRevision: 1, folds: { expectedFoldStructureGeneration: 0 } } });
    h.resolveNext(); await flush; expect(h.dispose().projects[0].structuralAcks).toHaveLength(0);
  });

  it('keeps successive structural transitions and later ordinary values separate', async () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness(); const source = h.authorities.get('p')!.source;
    for (const generation of [1, 2]) h.observe(h.queue.enqueueDocument('p', generation, {
      source, changes: [{ type: 'put-node', node: { ...node, title: String(generation) } }],
      structural: { basis: generation === 1 ? { type: 'generation', generation: 0 } : { type: 'after-structural', editorGeneration: 1 }, mappings: [] },
    }));
    h.enqueueTitle(3, 'later'); const flush = h.queue.flush();
    expect(h.requests[0]).toMatchObject({ type: 'structural-command', command: { batch: { editorGeneration: 1 } } });
    h.resolveNext(); await vi.advanceTimersByTimeAsync(0);
    expect(h.requests[1]).toMatchObject({ type: 'structural-command', command: { batch: { editorGeneration: 2 } } });
    h.resolveNext(); await vi.advanceTimersByTimeAsync(0);
    expect(h.requests[2]).toMatchObject({ type: 'document-batch', batch: { editorGeneration: 3 } });
    h.resolveNext(); await flush; h.dispose();
  });
});

describe('explicit retained recovery', () => {
  it.each(['pending-only', 'captured not-posted'] as const)(
    'scopes equal admission tokens to transport lifetime for %s recovery', async state => {
      vi.useFakeTimers(); const h = createIncrementalQueueHarness(); h.enqueueTitle(1, 'original');
      const error = new WorkspaceWorkerError('worker-start-failed', 1, 'not-posted');
      if (state === 'captured not-posted') {
        const failed = h.observe(h.queue.flush()); h.rejectNext(error);
        await expect(failed).rejects.toMatchObject({ type: 'transport' });
      }
      const work = h.dispose(); await work.whenQuiescent; const previous = work.projects[0];
      const resolutions = previous.attempts.map(({ attempt }) => ({ attempt, notPosted: error }));
      const fresh = createIncrementalQueueHarness(); fresh.dispose();
      // Independent transport installation may have the same numeric bootstrap token.
      const authority = { ...fresh.authorities.get('p')!, source: previous.authority.source };
      expect(authority.binding.admissionId).toBe(previous.authority.binding.admissionId);
      let id = 0;
      const create = (transport: QueueModule.QueueTransport, installed: QueueModule.InstalledQueueAuthority) =>
        Object.values(modules)[0].createIncrementalQueue({ ...fresh.options, transport, uuid: () => `r1-${++id}`,
          resolveAuthority: () => installed, recovery: { retained: work, projects: [{ previous, authority: installed, resolutions }] } });
      for (const invalid of [
        { ...authority, transport: h.options.transport },
        { ...authority, binding: { ...authority.binding, scope: { ...authority.binding.scope, storageGeneration: 'other' } } },
        previous.authority,
      ]) {
        const rejected = create(invalid.transport, invalid);
        await expect(rejected.flush()).rejects.toMatchObject({ code: 'source-changed' }); rejected.dispose();
      }
      const q = create(fresh.options.transport, authority);
      const flush = h.observe(q.flush('p')); await vi.advanceTimersByTimeAsync(0);
      expect(fresh.sent).toHaveLength(1);
      const original = state === 'pending-only' ? previous.pending[0] : previous.attempts[0].segment;
      expect(fresh.sent[0].changes[0]).toBe((original as { changes: readonly DocumentChange[] }).changes[0]);
      expect(fresh.sent[0]).toMatchObject({ scope: previous.authority.binding.scope, expectedRevision: 0 });
      fresh.resolveNext(); await flush; q.dispose();
    });

  it('holds pending-only work without timers or admission until explicit flush', async () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness(); h.enqueueTitle(1, 'retained');
    const work = h.queue.freeze('offline'); const q = recoveredQueue(h, work);
    await vi.advanceTimersByTimeAsync(10000); expect(h.requests).toHaveLength(0);
    await expect(q.enqueueDocument('p', 2, [{ type: 'put-node', node }])).rejects.toMatchObject({ code: 'retry-required' });
    const flush = q.flush('p'); await vi.advanceTimersByTimeAsync(0);
    expect(h.sent).toHaveLength(1); expect(h.sent[0].changes[0]).toBe((work.projects[0].pending[0] as { changes: readonly DocumentChange[] }).changes[0]);
    h.resolveNext(); await flush; expect(q.dispose().projects[0].pending).toHaveLength(0);
  });

  it('retries proved absent work with fresh identities ahead of its pending successor', async () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness(); h.enqueueTitle(1, 'attempt');
    const failed = h.observe(h.queue.flush()); h.enqueueTitle(2, 'successor');
    h.resolveNext({ type: 'failed', code: 'quota-exceeded', outcome: 'unknown', admission: 'invalidated' });
    await expect(failed).rejects.toMatchObject({ type: 'domain' });
    const work = h.dispose(); const attempt = work.projects[0].attempts[0].attempt;
    const q = recoveredQueue(h, work, [{ attempt, inspection: { type: 'commit-inspection', result: { type: 'not-committed' } } }]);
    const flush = q.flush(); await vi.advanceTimersByTimeAsync(0);
    expect(h.sent).toHaveLength(2); expect(h.sent[1].clientId).not.toBe(attempt.batch.clientId);
    expect(h.sent[1].commitId).not.toBe(attempt.batch.commitId); expect(h.sent[1].editorGeneration).toBe(1);
    h.resolveNext(); await vi.advanceTimersByTimeAsync(0);
    expect(h.sent[2]).toMatchObject({ expectedRevision: 1, editorGeneration: 2 }); h.resolveNext(); await flush;
    expect(attempt.batch).toBe(h.sent[0]); expect(q.dispose().projects[0].attempts).toHaveLength(0);
  });

  it('waits for old quiescence and acknowledges an inspected late commit without replay', async () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness(); h.enqueueTitle(1, 'late');
    h.observe(h.queue.flush()); const work = h.queue.freeze('handover'); const attempt = work.projects[0].attempts[0].attempt;
    const q = recoveredQueue(h, work, [{ attempt, inspection: { type: 'commit-inspection', result: { type: 'committed', ack: documentAck(attempt) } } }], { documentRevision: 1 });
    const flush = q.flush(); let done = false; void flush.then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(10000); expect(done).toBe(false); expect(h.sent).toHaveLength(1);
    await expect(q.enqueuePreferences('p', 2, { scale: 2 })).rejects.toMatchObject({ code: 'retry-required' });
    h.resolveNext(); await flush; expect(h.sent).toHaveLength(1);
    expect(h.events.filter(e => e.type === 'acknowledged')).toHaveLength(1); q.dispose();
  });

  it.each(['source', 'incarnation', 'revision', 'old-token'] as const)('rejects recovery with mismatched %s and retains original work', async which => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness(); h.enqueueTitle(1, 'retained'); const work = h.dispose();
    const q = recoveredQueue(h, work, [], which === 'revision' ? { documentRevision: 1 } : {}, a => which === 'source'
      ? { ...a, source: {} } : which === 'incarnation' ? { ...a, binding: { ...a.binding, scope: { ...a.binding.scope, incarnation: 'other' } } }
      : which === 'old-token' ? { ...a, binding: { ...a.binding, admissionId: work.projects[0].authority.binding.admissionId } } : a);
    await expect(q.flush()).rejects.toMatchObject({ code: 'source-changed' });
    expect(q.dispose().projects[0].pending[0]).toBe(work.projects[0].pending[0]); expect(h.requests).toHaveLength(0);
  });

  describe.each(['before failed dispatch', 'after checkpoint'] as const)('checkpoint provenance %s', timing => {
    it.each(['source', 'incarnation', 'storageGeneration', 'projectId', 'floor', 'token', 'transport'] as const)(
      'rejects replacement %s while retaining the original payload and safely recovering original source', async field => {
        vi.useFakeTimers(); const h = createIncrementalQueueHarness(); const old = h.install('p', 5);
        const original = { ...old, binding: { ...old.binding, scope: { ...old.binding.scope }, authority: { ...old.binding.authority } } };
        h.enqueueTitle(6, 'original payload');
        let work = timing === 'after checkpoint' ? h.dispose() : undefined;
        const replacementSource = {};
        const target = field === 'token' ? old.binding
          : ['incarnation', 'storageGeneration', 'projectId'].includes(field) ? old.binding.scope : old;
        const key = field === 'token' ? 'admissionId' : field === 'floor' ? 'editorGenerationFloor' : field;
        const value = field === 'source' ? replacementSource : field === 'floor' ? 0 : field === 'token' ? 9
          : field === 'transport' ? { request: h.options.transport.request } : 'replacement';
        Object.defineProperty(target, key, { value });
        if (!work) {
          await expect(h.queue.flush()).rejects.toMatchObject({ code: 'source-changed' }); work = h.dispose();
        }
        const previous = work.projects[0]; expect(previous.authority).toBe(old);
        const payload = (previous.pending[0] as { changes: readonly DocumentChange[] }).changes[0];
        let id = 0;
        const create = (authority: QueueModule.InstalledQueueAuthority) => Object.values(modules)[0].createIncrementalQueue({
          ...h.options, uuid: () => `r3-${++id}`, resolveAuthority: () => authority,
          recovery: { retained: work!, projects: [{ previous, authority, resolutions: [] }] },
        });
        // A changed old token/transport must not make the original same-transport token fresh.
        const invalid = field === 'token' || field === 'transport' ? original : {
          ...old, transport: h.options.transport, binding: { ...old.binding, admissionId: 2 },
        };
        const rejected = create(invalid); const flushed = h.observe(rejected.flush());
        await vi.advanceTimersByTimeAsync(0); expect(h.sent).toHaveLength(0);
        await expect(flushed).rejects.toMatchObject({ code: 'source-changed' });
        const retained = rejected.dispose(); expect(retained.projects[0]).toBe(previous);
        expect((retained.projects[0].pending[0] as { changes: readonly DocumentChange[] }).changes[0]).toBe(payload);
        const valid = { ...original, binding: { ...original.binding, admissionId: 2 } };
        const q = create(valid); const flush = h.observe(q.flush('p')); await vi.advanceTimersByTimeAsync(0);
        expect(h.sent).toHaveLength(1); expect(h.sent[0].scope).toEqual(original.binding.scope);
        expect(h.sent[0].changes[0]).toBe(payload); h.resolveNext(); await flush; q.dispose();
      });

    it.each(['source', 'admissionId', 'incarnation', 'editorGenerationFloor', 'binding', 'transport'] as const)(
      'never invokes old %s accessors in recovery or scoped flush selection', async field => {
        vi.useFakeTimers(); const h = createIncrementalQueueHarness(); const old = h.authorities.get('p')!;
        const original = { ...old, binding: { ...old.binding, scope: { ...old.binding.scope } } };
        h.enqueueTitle(1, 'getter-safe payload'); let work = timing === 'after checkpoint' ? h.dispose() : undefined;
        const getter = vi.fn(() => { throw new Error('obsolete installation getter'); });
        const target = field === 'admissionId' ? old.binding : field === 'incarnation' ? old.binding.scope : old;
        Object.defineProperty(target, field, { enumerable: true, get: getter });
        if (!work) {
          await expect(h.queue.flush()).rejects.toMatchObject({ code: 'source-changed' }); work = h.dispose();
        }
        const previous = work.projects[0];
        const authority = { ...original, binding: { ...original.binding, admissionId: 2 } };
        const q = Object.values(modules)[0].createIncrementalQueue({ ...h.options, resolveAuthority: () => authority,
          recovery: { retained: work, projects: [{ previous, authority, resolutions: [] }] } });
        // Calling flush must not synchronously throw by reading old binding/scope.
        let flush!: Promise<void>; expect(() => { flush = h.observe(q.flush('p')); }).not.toThrow();
        await vi.advanceTimersByTimeAsync(0); expect(getter).not.toHaveBeenCalled(); expect(h.sent).toHaveLength(1);
        expect(h.sent[0].scope).toEqual(original.binding.scope);
        expect(h.sent[0].changes[0]).toBe((previous.pending[0] as { changes: readonly DocumentChange[] }).changes[0]);
        h.resolveNext(); await flush; q.dispose();
      });
  });

  it.each(['missing', 'substituted-attempt', 'conflict', 'wrong-ack'] as const)('rejects %s inspection evidence without dispatch', async which => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness(); h.enqueueTitle(1, 'uncertain'); h.observe(h.queue.flush());
    h.rejectNext(new Error('unknown')); await vi.advanceTimersByTimeAsync(0);
    const work = h.dispose(); const attempt = work.projects[0].attempts[0].attempt;
    const resolutions: QueueModule.AttemptResolution[] = which === 'missing' ? [] : [{
      attempt: which === 'substituted-attempt' ? { ...attempt } : attempt,
      inspection: { type: 'commit-inspection', result: which === 'conflict' ? { type: 'conflict', reason: 'proof-unavailable' }
        : which === 'wrong-ack' ? { type: 'committed', ack: { ...documentAck(attempt), commitId: 'wrong' } } : { type: 'not-committed' } },
    }];
    const q = recoveredQueue(h, work, resolutions);
    await expect(q.flush()).rejects.toMatchObject({ type: 'queue' }); expect(h.sent).toHaveLength(1); q.dispose();
  });

  it('accepts only the identical captured closed not-posted rejection as absence evidence', async () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness(); h.enqueueTitle(1, 'not posted'); h.observe(h.queue.flush());
    const error = new WorkspaceWorkerError('worker-start-failed', 19, 'not-posted'); h.rejectNext(error); await vi.advanceTimersByTimeAsync(0);
    const work = h.dispose(); const attempt = work.projects[0].attempts[0].attempt;
    const forged = recoveredQueue(h, work, [{ attempt, notPosted: new WorkspaceWorkerError('worker-start-failed', 19, 'not-posted') }]);
    await expect(forged.flush()).rejects.toMatchObject({ code: 'retry-required' }); forged.dispose();
    const q = recoveredQueue(h, work, [{ attempt, notPosted: error }]); const flush = h.observe(q.flush()); await vi.advanceTimersByTimeAsync(0);
    expect(h.sent).toHaveLength(2); h.resolveNext(); await flush; q.dispose();
  });

  it('does not let later mutation turn an originally unknown rejection into not-posted proof', async () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness(); h.enqueueTitle(1, 'unknown'); h.observe(h.queue.flush());
    const error = new WorkspaceWorkerError('timeout', 19, 'unknown'); h.rejectNext(error); await vi.advanceTimersByTimeAsync(0);
    const work = h.dispose(); const attempt = work.projects[0].attempts[0].attempt;
    Object.defineProperty(error, 'outcome', { value: 'not-posted' });
    const q = recoveredQueue(h, work, [{ attempt, notPosted: error }]); const flush = h.observe(q.flush());
    await vi.advanceTimersByTimeAsync(0); expect(h.sent).toHaveLength(1);
    await expect(flush).rejects.toMatchObject({ code: 'retry-required' }); q.dispose();
  });

  it('holds unselected recovered projects and permits fresh work only after their explicit flush', async () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness(); h.install('q');
    h.enqueueTitle(1, 'p'); h.enqueueTitle(1, 'q', 'q'); const work = h.dispose();
    const recoveryProjects = work.projects.map(previous => {
      const authority = { ...previous.authority, binding: { ...previous.authority.binding, admissionId: 2 } };
      h.authorities.set(authority.binding.scope.projectId, authority); return { previous, authority, resolutions: [] };
    });
    const q = Object.values(modules)[0].createIncrementalQueue({ ...h.options, recovery: { retained: work, projects: recoveryProjects } });
    const first = q.flush('p'); await vi.advanceTimersByTimeAsync(0); h.resolveNext(); await first;
    await vi.advanceTimersByTimeAsync(6000); expect(h.sent).toHaveLength(1);
    await expect(q.enqueuePreferences('q', 2, { scale: 2 })).rejects.toMatchObject({ code: 'retry-required' });
    const second = q.flush('q'); h.resolveNext(); await second; expect(h.sent).toHaveLength(2); q.dispose();
  });

  it.each(['freeze', 'dispose'] as const)('promptly rejects all recovery flush waiters on %s before old quiescence', async stop => {
    vi.useFakeTimers(); const instrumented = instrumentQueue(); const h = createIncrementalQueueHarness(instrumented.createIncrementalQueue);
    h.install('q'); h.enqueueTitle(1, 'late'); h.observe(h.queue.flush('p')); h.enqueueTitle(1, 'held q', 'q');
    const work = h.queue.freeze('old'); const attempt = work.projects[0].attempts[0].attempt;
    const projects = work.projects.map(previous => {
      const authority = { ...previous.authority, binding: { ...previous.authority.binding, admissionId: 2 } };
      h.authorities.set(authority.binding.scope.projectId, authority);
      return { previous, authority, resolutions: previous.attempts.map(({ attempt }) => ({ attempt,
        inspection: { type: 'commit-inspection' as const, result: { type: 'not-committed' as const } } })) };
    });
    const q = instrumented.createIncrementalQueue({ ...h.options, recovery: { retained: work, projects } });
    const flushes = Array.from({ length: 32 }, (_, i) => h.observe(q.flush([undefined, 'p', 'q', 'missing'][i % 4])));
    const again = stop === 'freeze' ? q.freeze('new') : q.dispose();
    let quiet = false; void again.whenQuiescent.then(() => { quiet = true; });
    // Await the actual rejection, not old settlement or extra microtask turns.
    await Promise.all(flushes.map(flush => expect(flush).rejects.toMatchObject({ code: stop === 'freeze' ? 'frozen' : 'disposed' })));
    expect(quiet).toBe(false); expect(h.waiting).toHaveLength(1); expect(h.sent).toHaveLength(1);
    expect(again.projects[0]).toBe(work.projects[0]); expect(again.projects[0].attempts[0].attempt).toBe(attempt);
    expect(instrumented.inspectRecoveryFlushes()).toBe(0); expect(instrumented.inspect().flushes).toBe(0);
    h.resolveNext(); await again.whenQuiescent;
    expect(quiet).toBe(true); expect(h.sent).toHaveLength(1); expect(instrumented.inspectRecoveryFlushes()).toBe(0); q.dispose();
  });

  it('releases successful scoped recovery flush waiters without activating unselected projects', async () => {
    vi.useFakeTimers(); const instrumented = instrumentQueue(); const h = createIncrementalQueueHarness(instrumented.createIncrementalQueue);
    h.install('q'); h.enqueueTitle(1, 'p'); h.enqueueTitle(1, 'q', 'q'); const work = h.dispose();
    const projects = work.projects.map(previous => {
      const authority = { ...previous.authority, binding: { ...previous.authority.binding, admissionId: 2 } };
      h.authorities.set(authority.binding.scope.projectId, authority); return { previous, authority, resolutions: [] };
    });
    const q = instrumented.createIncrementalQueue({ ...h.options, recovery: { retained: work, projects } });
    const flushes = Array.from({ length: 32 }, () => q.flush('p'));
    await q.flush('missing'); expect(h.sent.map(b => b.scope.projectId)).toEqual(['p']);
    h.resolveNext(); await Promise.all(flushes);
    expect(instrumented.inspectRecoveryFlushes()).toBe(0); expect(instrumented.inspect().flushes).toBe(0);
    await expect(q.enqueueDocument('q', 2, [{ type: 'put-node', node }])).rejects.toMatchObject({ code: 'retry-required' });
    const last = q.flush('q'); h.resolveNext(); await last;
    expect(h.sent.map(b => b.scope.projectId)).toEqual(['p', 'q']); q.dispose();
  });

  it('refuses fresh queue client identity collision with retained attempted identities', async () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness(); h.enqueueTitle(1, 'unknown'); h.observe(h.queue.flush()); h.rejectNext(new Error('unknown'));
    await vi.advanceTimersByTimeAsync(0); const work = h.dispose(); const previous = work.projects[0]; const attempt = previous.attempts[0].attempt;
    const authority = { ...previous.authority, binding: { ...previous.authority.binding, admissionId: 2 } }; h.authorities.set('p', authority);
    const q = Object.values(modules)[0].createIncrementalQueue({ ...h.options, uuid: () => attempt.batch.clientId,
      recovery: { retained: work, projects: [{ previous, authority, resolutions: [{ attempt, inspection: { type: 'commit-inspection', result: { type: 'not-committed' } } }] }] } });
    await expect(q.flush()).rejects.toMatchObject({ code: 'retry-required' }); expect(h.sent).toHaveLength(1); q.dispose();
  });

  it.each(['projects', 'retained'] as const)('rejects recovery %s accessor framing without evaluating it', async field => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness(); h.enqueueTitle(1, 'retained'); const work = h.dispose();
    const getter = vi.fn(() => { throw new Error('recovery getter'); });
    const recovery = Object.defineProperty({ retained: work, projects: [] }, field, { enumerable: true, get: getter });
    const q = Object.values(modules)[0].createIncrementalQueue({ ...h.options, recovery });
    const flush = h.observe(q.flush()); await vi.advanceTimersByTimeAsync(0);
    await expect(flush).rejects.toMatchObject({ code: 'retry-required' }); expect(getter).not.toHaveBeenCalled(); q.dispose();
  });
});

describe('R4 overlapping recovery capture', () => {
  async function setup(successor: boolean, onAck: (q: QueueModule.IncrementalQueue,
    h: ReturnType<typeof createIncrementalQueueHarness>) => void) {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const instrumented = instrumentQueue(); const h = createIncrementalQueueHarness(instrumented.createIncrementalQueue);
    h.install('q'); h.enqueueTitle(1, 'committed predecessor'); h.observe(h.queue.flush('p'));
    if (successor) {
      h.enqueueTitle(2, 'retained successor'); h.observe(h.queue.enqueuePreferences('p', 2, { scale: 2 }));
    }
    h.enqueueTitle(1, 'other retained project', 'q');
    const work = h.queue.freeze('handover'); h.resolveNext(); await work.whenQuiescent;
    const projects = work.projects.map(previous => {
      const authority = { ...previous.authority, binding: { ...previous.authority.binding, admissionId: 2,
        authority: { ...previous.authority.binding.authority, documentRevision: previous.attempts.length ? 1 : 0 } } };
      h.authorities.set(authority.binding.scope.projectId, authority);
      return { previous, authority, resolutions: previous.attempts.map(({ attempt }) => ({ attempt,
        inspection: { type: 'commit-inspection' as const, result: { type: 'committed' as const, ack: documentAck(attempt) } } })) };
    });
    return () => {
      let q!: QueueModule.IncrementalQueue;
      q = instrumented.createIncrementalQueue({ ...h.options, recovery: { retained: work, projects }, onEvent(event) {
        h.events.push(event);
        if (event.type === 'acknowledged' && event.ack.projectId === 'p' && event.ack.editorGeneration === 1) onAck(q, h);
      } });
      return { h, q, instrumented };
    };
  }
  const scopes = [
    { name: 'same-project', ids: ['p', 'p'], all: false },
    { name: 'all-project', ids: [undefined, undefined], all: true },
    { name: 'scoped then all', ids: ['p', undefined], all: true },
    { name: 'all then scoped', ids: [undefined, 'p'], all: true },
  ];
  it.each(scopes.flatMap(scope => [false, true].map(successor => ({ ...scope, successor }))))(
    '$name waits preserve original targets and both ordinary deadlines (retained successor: $successor)', async ({ ids, all, successor }) => {
      const generation = successor ? 3 : 2; const futureStates: string[] = []; const future: Promise<unknown>[] = [];
      const start = await setup(successor, (queue, harness) => {
        future.push(harness.observe(queue.enqueueDocument('p', generation, [{ type: 'put-node', node }])));
        future.push(harness.observe(queue.enqueuePreferences('p', generation, { scale: 3 })));
        future.forEach((promise, i) => { futureStates[i] = 'pending'; void promise.then(() => { futureStates[i] = 'saved'; }, () => { futureStates[i] = 'failed'; }); });
      });
      const { h, q, instrumented } = start();
      const states = ['pending', 'pending'];
      const flushes = ids.map((id, i) => h.observe(q.flush(id).then(() => { states[i] = 'resolved'; }, error => { states[i] = 'rejected'; throw error; })));
      expect(instrumented.inspectRecoveryFlushes()).toBe(2);
      await vi.advanceTimersByTimeAsync(0);
      expect(futureStates).toEqual(['pending', 'pending']);
      expect(h.requests).toHaveLength(1 + Number(successor) + Number(all));
      // Settle only original retained work. Never finish a future request to free an old flush.
      for (let i = 0; i < Number(successor) * 2 + Number(all); i++) {
        const request = h.waiting[0]?.request;
        expect(request && (request.type === 'document-batch' || request.type === 'preferences')).toBe(true);
        if (!request || (request.type !== 'document-batch' && request.type !== 'preferences')) throw new Error('Expected original mutation');
        expect(request.batch.editorGeneration).toBe(request.batch.scope.projectId === 'p' ? 2 : 1);
        expect(states).toContain('pending'); h.resolveNext(); await vi.advanceTimersByTimeAsync(0);
      }
      expect(states).toEqual(['resolved', 'resolved']); await Promise.all(flushes);
      expect(h.waiting).toHaveLength(0); expect(futureStates).toEqual(['pending', 'pending']);
      expect(instrumented.inspectRecoveryFlushes()).toBe(0); expect(instrumented.inspect().flushes).toBe(0);
      const originalCount = 1 + Number(successor) * 2 + Number(all);
      expect(h.requests).toHaveLength(originalCount);
      await vi.advanceTimersByTimeAsync(499); expect(h.requests).toHaveLength(originalCount);
      await vi.advanceTimersByTimeAsync(1);
      expect(h.requests.at(-1)).toMatchObject({ type: 'document-batch', batch: { editorGeneration: generation, expectedRevision: successor ? 2 : 1 } });
      expect(h.requests).toHaveLength(originalCount + 1); h.resolveNext(); await future[0];
      await vi.advanceTimersByTimeAsync(499); expect(h.requests).toHaveLength(originalCount + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(h.requests.at(-1)).toMatchObject({ type: 'preferences', batch: { editorGeneration: generation, patch: { scale: 3 } } });
      expect(h.requests).toHaveLength(originalCount + 2); h.resolveNext(); await future[1];
      expect(futureStates).toEqual(['saved', 'saved']);
      await vi.advanceTimersByTimeAsync(6000); expect(h.requests).toHaveLength(originalCount + 2);
      if (!all) await expect(q.enqueuePreferences('q', 2, { scale: 2 })).rejects.toMatchObject({ code: 'retry-required' });
      expect(h.events.filter(event => event.type === 'acknowledged' && event.ack.editorGeneration === 1 && event.ack.projectId === 'p')).toHaveLength(1);
      expect(instrumented.inspect().flushes).toBe(0);
      expect(instrumented.inspect().projects).toEqual([
        { pending: 0, active: false, acks: 0, recovered: 0, waiters: 0 },
        { pending: all ? 0 : 1, active: false, acks: 0, recovered: 0, waiters: 0 },
      ]); q.dispose();
    });

  it.each(['freeze', 'dispose', 'throw', 'fresh flush failure'] as const)(
    'settles both already-covered waits before observer %s without retaining waiters', async mode => {
      let fresh: Promise<void> | undefined; const future: Promise<unknown>[] = [];
      const start = await setup(false, (queue, harness) => {
        future.push(harness.observe(queue.enqueueDocument('p', 2, [{ type: 'put-node', node }])));
        future.push(harness.observe(queue.enqueuePreferences('p', 2, { scale: 2 })));
        if (mode === 'freeze') queue.freeze('observer');
        else if (mode === 'dispose') queue.dispose();
        else if (mode === 'throw') throw new Error('observer exception');
        else fresh = harness.observe(queue.flush('p'));
      });
      const { h, q, instrumented } = start();
      const states = ['pending', 'pending'];
      const flushes = states.map((_, i) => h.observe(q.flush('p').then(() => { states[i] = 'resolved'; }, error => { states[i] = 'rejected'; throw error; })));
      await vi.advanceTimersByTimeAsync(0);
      expect(states).toEqual(['resolved', 'resolved']); await Promise.all(flushes);
      expect(instrumented.inspectRecoveryFlushes()).toBe(0);
      if (mode === 'fresh flush failure') {
        // This new, explicitly issued flush may capture generation 2. The old two may not.
        expect(fresh).toBeDefined(); expect(h.requests).toHaveLength(2);
        expect(h.waiting[0].request).toMatchObject({ type: 'document-batch', batch: { editorGeneration: 2 } });
        expect(instrumented.inspect().flushes).toBe(1);
        h.resolveNext({ type: 'failed', code: 'quota-exceeded', outcome: 'unknown', admission: 'invalidated' });
        await expect(fresh).rejects.toMatchObject({ type: 'domain' });
        await Promise.all(future.map(promise => expect(promise).rejects.toMatchObject({ type: 'domain' })));
        await Promise.all(flushes.map(promise => expect(promise).resolves.toBeUndefined()));
      } else {
        expect(h.requests).toHaveLength(1); expect(instrumented.inspect().flushes).toBe(0);
        if (mode !== 'throw') await Promise.all(future.map(promise => expect(promise).rejects.toMatchObject({ code: mode === 'freeze' ? 'frozen' : 'disposed' })));
      }
      q.dispose();
      expect(instrumented.inspectRecoveryFlushes()).toBe(0); expect(instrumented.inspect().flushes).toBe(0);
      for (const project of instrumented.inspect().projects) expect(project).toMatchObject({ waiters: 0 });
    });

  it('seals another selected source before a recovered observer admits its next generation', async () => {
    const future: Promise<unknown>[] = [];
    const start = await setup(false, (queue, harness) => {
      future.push(harness.observe(queue.enqueueDocument('q', 2, [{ type: 'put-node', node }])));
      future.push(harness.observe(queue.enqueuePreferences('q', 2, { scale: 2 })));
    });
    const { h, q, instrumented } = start();
    const first = q.flush('p'); let allDone = false;
    const all = q.flush().then(() => { allDone = true; });
    await first;
    expect(allDone).toBe(false);
    expect(h.requests).toHaveLength(2);
    expect(h.waiting[0].request).toMatchObject({ type: 'document-batch', batch: { scope: { projectId: 'q' }, editorGeneration: 1 } });
    h.resolveNext(); await all;
    expect(instrumented.inspectRecoveryFlushes()).toBe(0); expect(instrumented.inspect().flushes).toBe(0);
    await vi.advanceTimersByTimeAsync(499); expect(h.requests).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.requests).toHaveLength(3); expect(h.waiting[0].request).toMatchObject({ type: 'document-batch', batch: { editorGeneration: 2 } });
    h.resolveNext(); await future[0];
    await vi.advanceTimersByTimeAsync(499); expect(h.requests).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.requests).toHaveLength(4); expect(h.waiting[0].request).toMatchObject({ type: 'preferences', batch: { editorGeneration: 2 } });
    h.resolveNext(); await future[1]; q.dispose();
  });

  it.each(['freeze', 'dispose'] as const)('rejects both still-uncovered original targets on observer %s', async mode => {
    const start = await setup(true, queue => { if (mode === 'freeze') queue.freeze('observer'); else queue.dispose(); });
    const { h, q, instrumented } = start();
    const flushes = [h.observe(q.flush('p')), h.observe(q.flush('p'))];
    await Promise.all(flushes.map(promise => expect(promise).rejects.toMatchObject({ code: mode === 'freeze' ? 'frozen' : 'disposed' })));
    expect(h.waiting).toHaveLength(0); expect(h.requests).toHaveLength(1);
    const retained = q.dispose();
    expect(retained.projects[0].pending.map(segment => [segment.lane, segment.editorGeneration])).toEqual([['document', 2], ['preferences', 2]]);
    expect(instrumented.inspectRecoveryFlushes()).toBe(0); expect(instrumented.inspect().flushes).toBe(0);
    for (const project of instrumented.inspect().projects) expect(project).toMatchObject({ waiters: 0 });
  });

  it('keeps a reentrant fresh flush separate while original retained targets are still pending', async () => {
    let fresh!: Promise<void>; const future: Promise<unknown>[] = [];
    const start = await setup(true, (queue, harness) => {
      future.push(harness.observe(queue.enqueuePreferences('p', 3, { scale: 3 })));
      fresh = harness.observe(queue.flush('p'));
    });
    const { h, q, instrumented } = start();
    const states = ['pending', 'pending'];
    const old = states.map((_, i) => q.flush('p').then(() => { states[i] = 'resolved'; }));
    await vi.advanceTimersByTimeAsync(0);
    expect(instrumented.inspect().flushes).toBe(3);
    for (const type of ['document-batch', 'preferences']) {
      expect(states).toEqual(['pending', 'pending']);
      expect(h.waiting[0].request).toMatchObject({ type, batch: { editorGeneration: 2 } });
      h.resolveNext(); await vi.advanceTimersByTimeAsync(0);
    }
    expect(states).toEqual(['resolved', 'resolved']); await Promise.all(old);
    expect(instrumented.inspect().flushes).toBe(1);
    expect(h.waiting[0].request).toMatchObject({ type: 'preferences', batch: { editorGeneration: 3 } });
    h.resolveNext({ type: 'failed', code: 'quota-exceeded', outcome: 'unknown', admission: 'invalidated' });
    await expect(fresh).rejects.toMatchObject({ type: 'domain' });
    await Promise.all(future.map(promise => expect(promise).rejects.toMatchObject({ type: 'domain' })));
    await Promise.all(old.map(promise => expect(promise).resolves.toBeUndefined()));
    expect(instrumented.inspectRecoveryFlushes()).toBe(0); expect(instrumented.inspect().flushes).toBe(0);
    for (const project of instrumented.inspect().projects) expect(project).toMatchObject({ waiters: 0 });
    q.dispose();
  });
});

describe('R5 recovered publication source fence', () => {
  const cases = (['document', 'preferences'] as const).flatMap(lane =>
    (['replacement', 'missing', 'resolver throws', 'authority accessor'] as const).flatMap(loss =>
      [false, true].map(successor => ({ lane, loss, successor }))));

  it.each(cases)('$lane publication fences $loss after an observer (successors: $successor)', async ({ lane, loss, successor }) => {
    const ids = successor ? ['p', 'q', 'r'] : ['p', 'q'];
    const workers = new Map<string, Awaited<ReturnType<typeof createIncrementalWorkerHarness>>>();
    const registry = new Map<string, QueueModule.InstalledQueueAuthority>();
    const events: QueueModule.QueueEvent[] = []; const requests: WorkspaceWorkerRequest[] = [];
    const observe = <T>(promise: Promise<T>) => { void promise.catch(() => {}); return promise; };
    const instrumented = instrumentQueue(); let old: QueueModule.IncrementalQueue | undefined;
    let queue: QueueModule.IncrementalQueue | undefined; let replaced = false;
    const getter = vi.fn(() => { throw new Error('Installation accessor must not run'); });
    const transport: QueueModule.QueueTransport = { request(request) {
      if (request.type !== 'document-batch' && request.type !== 'preferences') throw new Error('Unexpected recovery mutation');
      requests.push(request); return workers.get(request.batch.scope.projectId)!.client.request(request);
    } };
    let identity = 0;
    const resolveAuthority: QueueModule.IncrementalQueueOptions['resolveAuthority'] = (id, generation) => {
      if (replaced && id === 'q' && loss === 'resolver throws') throw new Error('Registry unavailable');
      const authority = registry.get(id);
      return authority && generation > authority.editorGenerationFloor ? authority : undefined;
    };
    // Only queue scheduling is held. The unchanged real client/handler/repository
    // still executes every mutation and inspection against isolated fake IndexedDB.
    const options: QueueModule.IncrementalQueueOptions = { transport, uuid: () => `r5-${++identity}`, resolveAuthority,
      clock: { now: () => 0, setTimeout: () => Symbol('held timer'), clearTimeout() {} }, onEvent: event => events.push(event) };
    const successorNode = Object.freeze({ ...node, title: 'retained old-source successor' });
    try {
      for (const id of ids) {
        const worker = await createIncrementalWorkerHarness({ ...makeIncrementalProject(), id }); workers.set(id, worker);
        const binding = worker.responses[0].response;
        if (binding.type !== 'bootstrapped') throw new Error('Expected actual bootstrap');
        registry.set(id, Object.freeze({ source: Object.freeze({}), transport, binding, editorGenerationFloor: 0 }));
      }
      old = instrumented.createIncrementalQueue(options);
      for (const id of ids) observe<unknown>(lane === 'document'
        ? old.enqueueDocument(id, 1, [{ type: 'put-node', node: { ...node, title: `${id} inspected` } }])
        : old.enqueuePreferences(id, 1, { scale: 2 }));
      observe(old.flush());
      if (successor) for (const id of ['q', 'r']) {
        observe(old.enqueueDocument(id, 2, [{ type: 'put-node', node: successorNode }]));
        observe(old.enqueuePreferences(id, 2, { scale: 3 }));
      }
      const retained = old.freeze('inspect committed predecessors'); await retained.whenQuiescent;
      expect(requests).toHaveLength(ids.length);
      const projects: QueueModule.QueueRecoveryProject[] = [];
      for (const previous of retained.projects) {
        expect(previous.attempts).toHaveLength(1);
        const attempt = previous.attempts[0].attempt; const worker = workers.get(attempt.batch.scope.projectId)!;
        if (attempt.lane === 'replacement') throw Error('Expected ordinary attempt');
        const inspection = await worker.client.request({ type: 'inspect-commit', attempt });
        expect(inspection).toMatchObject({ type: 'commit-inspection', result: { type: 'committed', ack: { editorGeneration: 1 } } });
        if (inspection.type !== 'commit-inspection') throw new Error('Expected actual inspection');
        const binding = await worker.client.request({ type: 'bootstrap', project: await worker.readRecords() });
        if (binding.type !== 'bootstrapped') throw new Error('Expected actual rebootstrap');
        const installation = { ...previous.authority, binding };
        const authority = loss === 'authority accessor' && binding.scope.projectId === 'q' ? installation : Object.freeze(installation);
        registry.set(binding.scope.projectId, authority); projects.push({ previous, authority, resolutions: [{ attempt, inspection }] });
      }
      const originalQ = registry.get('q')!; const originalSource = originalQ.source;
      const qBefore = await workers.get('q')!.readRecords();
      events.length = 0;
      queue = instrumented.createIncrementalQueue({ ...options, recovery: { retained, projects }, onEvent(event) {
        events.push(event);
        if (event.type !== 'acknowledged' || event.ack.projectId !== 'p' || event.ack.editorGeneration !== 1) return;
        replaced = true;
        if (loss === 'replacement') registry.set('q', Object.freeze({ ...originalQ, source: Object.freeze({}),
          editorGenerationFloor: 2, binding: Object.freeze({ ...originalQ.binding, admissionId: originalQ.binding.admissionId + 1 }) }));
        else if (loss === 'missing') registry.delete('q');
        else if (loss === 'authority accessor') Object.defineProperty(originalQ, 'binding', { enumerable: true, get: getter });
      } });
      const covered = queue.flush('p'); const all = observe(queue.flush());
      const valid = successor ? queue.flush('r') : undefined;
      await covered;
      // Both inspected targets are already covered in the no-successor case.
      // A source-loss notification must not retroactively reject that old flush.
      if (successor) await expect(all).rejects.toMatchObject({ code: 'source-changed' });
      else await expect(all).resolves.toBeUndefined();
      if (valid) await valid;
      expect(replaced).toBe(true);
      expect(events.filter(event => event.type === 'acknowledged' && event.ack.projectId === 'q').length, 'obsolete recovered saved event must not escape').toBe(0);
      const blocked = events.filter((event): event is Extract<QueueModule.QueueEvent, { type: 'project-blocked' }> => event.type === 'project-blocked');
      expect(blocked).toHaveLength(1);
      expect(blocked[0].failure).toMatchObject({ code: 'source-changed' });
      expect(blocked[0].work.authority).toBe(originalQ); expect(blocked[0].work.attempts).toEqual([]);
      if (loss === 'replacement') {
        expect(Object.isFrozen(originalQ)).toBe(true); expect(originalQ.source).toBe(originalSource);
        expect(registry.get('q')).not.toBe(originalQ); expect(registry.get('q')!.source).not.toBe(originalSource);
        expect(resolveAuthority('q', 1, lane)).toBeUndefined(); expect(resolveAuthority('q', 2, lane)).toBeUndefined();
      }
      expect(getter).not.toHaveBeenCalled();
      await expect(queue.flush('q')).rejects.toMatchObject({ code: 'source-changed' });
      await expect(queue.enqueueDocument('q', 3, [{ type: 'put-node', node }])).rejects.toMatchObject({ code: 'source-changed' });
      await expect(queue.enqueuePreferences('q', 3, { scale: 4 })).rejects.toMatchObject({ code: 'source-changed' });
      expect(await workers.get('q')!.readRecords()).toEqual(qBefore);
      expect(requests.filter(request => (request.type === 'document-batch' || request.type === 'preferences') && request.batch.scope.projectId === 'q')).toHaveLength(1);
      // No generic observer suppression: another selected project and later valid
      // work still publish. Reentrant/overlapping flushes do not release IDs twice.
      observe(queue.enqueueDocument('p', 2, [{ type: 'put-node', node: { ...node, title: 'valid future' } }]));
      await queue.flush('p');
      expect(events.filter(event => event.type === 'acknowledged' && event.ack.projectId === 'p')).toHaveLength(2);
      if (successor) {
        expect(events.filter(event => event.type === 'acknowledged' && event.ack.projectId === 'r')).toHaveLength(3);
        expect((await workers.get('r')!.exportFresh()).initialState.nodes.root.title).toBe(successorNode.title);
      }
      await expect(covered).resolves.toBeUndefined();
      if (!successor) await expect(all).resolves.toBeUndefined();
      expect(instrumented.inspect()).toMatchObject({ ids: 1, flushes: 0 });
      expect(instrumented.inspectRecoveryFlushes()).toBe(0);
      const stopped = queue.dispose(); const qWork = stopped.projects.find(project => project.authority === originalQ)!;
      expect(qWork.acknowledged[lane === 'document' ? 'documentGeneration' : 'preferenceGeneration']).toBe(1);
      expect(qWork.pending.map(segment => [segment.lane, segment.editorGeneration])).toEqual(successor ? [['document', 2], ['preferences', 2]] : []);
      if (successor) {
        const segment = qWork.pending[0]; expect(segment.lane).toBe('document');
        if (segment.lane === 'document') expect(segment.changes[0]).toMatchObject({ node: successorNode });
        if (segment.lane === 'document' && segment.changes[0].type === 'put-node') expect(segment.changes[0].node).toBe(successorNode);
      }
      expect(instrumented.inspect()).toMatchObject({ ids: 1, flushes: 0 });
    } finally { queue?.dispose(); old?.dispose(); for (const worker of workers.values()) worker.client.dispose(); }
  });

  it.each(['freeze', 'dispose', 'throw', 'reentrant flush'] as const)(
    'releases remaining recovered identities after blocked observer %s (supplemental)', async mode => {
      vi.useFakeTimers(); const instrumented = instrumentQueue(); const h = createIncrementalQueueHarness(instrumented.createIncrementalQueue);
      for (const id of ['p', 'q', 'r']) { if (id !== 'p') h.install(id); h.enqueueTitle(1, 'committed', id); }
      h.observe(h.queue.flush()); const retained = h.queue.freeze('handover');
      for (let i = 0; i < 3; i++) h.resolveNext(); await retained.whenQuiescent;
      const projects = retained.projects.map(previous => {
        const authority = Object.freeze({ ...previous.authority, binding: { ...previous.authority.binding, admissionId: 2,
          authority: { ...previous.authority.binding.authority, documentRevision: 1 } } });
        h.authorities.set(authority.binding.scope.projectId, authority);
        const attempt = previous.attempts[0].attempt;
        return { previous, authority, resolutions: [{ attempt,
          inspection: { type: 'commit-inspection' as const, result: { type: 'committed' as const, ack: documentAck(attempt) } } }] };
      });
      const observedIds: [string, number][] = []; const published: string[] = []; let fresh: Promise<void> | undefined;
      const q = instrumented.createIncrementalQueue({ ...h.options, recovery: { retained, projects }, onEvent(event) {
        if (event.type === 'acknowledged') {
          published.push(event.ack.projectId); observedIds.push([event.ack.projectId, instrumented.inspect().ids]);
          if (event.ack.projectId === 'p') h.install('q', 1);
        } else if (event.type === 'project-blocked') {
          observedIds.push(['blocked', instrumented.inspect().ids]);
          if (mode === 'freeze') q.freeze('blocked observer');
          else if (mode === 'dispose') q.dispose();
          else if (mode === 'throw') throw new Error('Blocked observer failed');
          else fresh = h.observe(q.flush('q'));
        }
      } });
      const first = q.flush(); const second = q.flush(); await Promise.all([first, second]);
      const stopped = mode === 'freeze' || mode === 'dispose';
      expect(published).toEqual(stopped ? ['p'] : ['p', 'r']);
      expect(observedIds).toEqual(stopped ? [['p', 4], ['blocked', 3]] : [['p', 4], ['blocked', 3], ['r', 1]]);
      if (mode === 'reentrant flush') await expect(fresh).rejects.toMatchObject({ code: 'source-changed' });
      expect(h.requests).toHaveLength(3); expect(instrumented.inspect()).toMatchObject({ ids: 1, flushes: 0 });
      expect(instrumented.inspectRecoveryFlushes()).toBe(0);
      for (const project of instrumented.inspect().projects) expect(project).toMatchObject({ pending: 0, active: false, recovered: 0, waiters: 0 });
      q.dispose(); expect(instrumented.inspect().ids).toBe(1);
      await Promise.all([expect(first).resolves.toBeUndefined(), expect(second).resolves.toBeUndefined()]);
    });
});

describe('bounded framing and lifecycle faults', () => {
  it.each([
    { type: 'failed', code: 'invented', outcome: 'unknown', admission: 'invalidated' },
    { type: 'failed', code: 'quota-exceeded', outcome: 'saved', admission: 'invalidated' },
    { type: 'failed', code: 'quota-exceeded', outcome: 'unknown', admission: 'valid' },
    { type: 'failed', code: 'quota-exceeded', outcome: 'unknown', admission: 'invalidated', extra: true },
  ])('freezes for malformed resolved failure %# instead of treating it as a domain result', async response => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness(); h.enqueueTitle(1, 'work'); const flush = h.observe(h.queue.flush());
    h.resolveNext(response as WorkspaceWorkerResponse); await expect(flush).rejects.toMatchObject({ code: 'invalid-response' });
    expect(h.events.filter(e => e.type === 'acknowledged')).toHaveLength(0); h.dispose();
  });

  it.each(['type', 'projectId', 'incarnation', 'commitId', 'editorGeneration', 'revision', 'foldStructureGeneration'] as const)(
    'rejects malformed ack %s', async field => {
      vi.useFakeTimers(); const h = createIncrementalQueueHarness(); h.enqueueTitle(1, 'work'); const flush = h.observe(h.queue.flush());
      const ack = documentAck({ lane: 'document', batch: h.sent[0] });
      h.resolveNext({ type: 'document-result', ack: { ...ack, [field]: field === 'revision' ? 2 : 'invalid' } } as WorkspaceWorkerResponse);
      await expect(flush).rejects.toMatchObject({ code: 'invalid-response' }); h.dispose();
    });

  it('does not let observer exceptions or mutation corrupt an immutable shared ack or wedge pumping', async () => {
    vi.useFakeTimers(); const events: QueueModule.QueueEvent[] = [];
    const h = createIncrementalQueueHarness(options => Object.values(modules)[0].createIncrementalQueue({ ...options, onEvent(event) {
      events.push(event); if (event.type === 'acknowledged') { (event.ack as DocumentSaveAck).revision = 999; throw new Error('observer'); }
    } }));
    const first = h.enqueueTitle(1, 'first'); const flush = h.queue.flush(); h.resolveNext(); await flush;
    const ack = await first; expect(Object.isFrozen(ack)).toBe(true); expect(ack.revision).toBe(1);
    h.enqueueTitle(2, 'next'); const next = h.queue.flush(); h.resolveNext(); await next;
    expect(h.sent[1].expectedRevision).toBe(1); expect(events.filter(e => e.type === 'acknowledged')).toHaveLength(2); h.dispose();
  });

  it('rejects accessor and extra array framing without executing getters or accepting any work', async () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness(); const getter = vi.fn(() => node);
    const changes = [{ type: 'put-node', node }] as DocumentChange[];
    Object.defineProperty(changes, '0', { enumerable: true, get: getter });
    await expect(h.queue.enqueueDocument('p', 1, changes)).rejects.toMatchObject({ code: 'invalid-input' });
    const extra = Object.assign([{ type: 'put-node' as const, node }], { extra: true });
    await expect(h.queue.enqueueDocument('p', 1, extra)).rejects.toMatchObject({ code: 'invalid-input' });
    const patch = Object.defineProperty({}, 'scale', { enumerable: true, get: getter });
    await expect(h.queue.enqueuePreferences('p', 1, patch)).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(h.queue.enqueuePreferences('p', 1, { layerCollapsed: {} })).rejects.toMatchObject({ code: 'invalid-input' });
    expect(getter).not.toHaveBeenCalled(); expect(h.dispose().projects).toHaveLength(0);
  });

  it('suppresses late ack publication after installation changes during an active request', async () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness(); h.enqueueTitle(1, 'old'); const flush = h.observe(h.queue.flush());
    h.install('p', 1); h.resolveNext(); await expect(flush).rejects.toMatchObject({ code: 'source-changed' });
    const work = h.dispose(); expect(work.projects[0].attempts).toHaveLength(1); expect(work.projects[0].acknowledged.documentGeneration).toBe(0);
    expect(h.events.filter(e => e.type === 'acknowledged')).toHaveLength(0);
  });

  it('cancels new dispatch while a barrier callback finishes after freeze and includes it in quiescence', async () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness();
    let complete!: (result: QueueModule.QueueBarrierOutcome<string>) => void;
    const run = vi.fn(() => new Promise<QueueModule.QueueBarrierOutcome<string>>(resolve => { complete = resolve; }));
    const barrier = h.observe(h.queue.barrier({ kind: 'drain', targets: [], run }));
    await vi.advanceTimersByTimeAsync(0); expect(run).toHaveBeenCalledTimes(1);
    const work = h.queue.freeze('stop'); let quiet = false; void work.whenQuiescent.then(() => { quiet = true; });
    await expect(barrier).rejects.toMatchObject({ code: 'frozen' }); await vi.advanceTimersByTimeAsync(0); expect(quiet).toBe(false);
    complete({ type: 'completed', value: 'late' }); await work.whenQuiescent;
    await expect(h.enqueueTitle(1, 'late')).rejects.toMatchObject({ code: 'frozen' }); h.dispose();
  });

  it('surfaces synchronous transport throws and never treats them as save success', async () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness(options => {
      options.transport.request = () => { throw new Error('sync transport'); };
      return Object.values(modules)[0].createIncrementalQueue(options);
    });
    const save = h.enqueueTitle(1, 'work'); await expect(h.queue.flush()).rejects.toMatchObject({ type: 'transport' });
    await expect(save).rejects.toMatchObject({ type: 'transport' }); await h.dispose().whenQuiescent;
  });

  it('fails safe commit-counter exhaustion using actual factory code, without a production test seam', async () => {
    vi.useFakeTimers(); const instrumented = instrumentQueue(Number.MAX_SAFE_INTEGER - 1);
    const h = createIncrementalQueueHarness(instrumented.createIncrementalQueue);
    h.enqueueTitle(1, 'last'); const first = h.queue.flush(); expect(h.sent[0].commitGeneration).toBe(Number.MAX_SAFE_INTEGER); h.resolveNext(); await first;
    h.enqueueTitle(2, 'retained'); await expect(h.queue.flush()).rejects.toMatchObject({ code: 'counter-exhausted' });
    expect(h.sent).toHaveLength(1); expect(h.dispose().projects[0].pending).toHaveLength(1);
  });

  it('releases successful identities, segments, dependency acks and waiters rather than keeping history', async () => {
    vi.useFakeTimers(); const instrumented = instrumentQueue(); const h = createIncrementalQueueHarness(instrumented.createIncrementalQueue);
    for (let g = 1; g <= 100; g++) {
      h.enqueueTitle(g, String(g)); const flush = h.queue.flush(); h.resolveNext(); await flush; await vi.advanceTimersByTimeAsync(0);
      expect(instrumented.inspect()).toEqual({ ids: 1, flushes: 0, projects: [{ pending: 0, active: false, acks: 0, recovered: 0, waiters: 0 }] });
    }
    h.dispose();
  });

  it('does not let recovered-ack observer edits extend a previously captured flush', async () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness(); h.enqueueTitle(1, 'saved late'); h.observe(h.queue.flush());
    const work = h.queue.freeze('handover'); const attempt = work.projects[0].attempts[0].attempt; h.resolveNext(); await work.whenQuiescent;
    const old = work.projects[0].authority;
    const authority = { ...old, binding: { ...old.binding, admissionId: 2, authority: { ...old.binding.authority, documentRevision: 1 } } };
    h.authorities.set('p', authority); let q!: QueueModule.IncrementalQueue;
    q = Object.values(modules)[0].createIncrementalQueue({ ...h.options, onEvent(event) {
      if (event.type === 'acknowledged' && event.ack.editorGeneration === 1) h.observe(q.enqueueDocument('p', 2, [{ type: 'put-node', node }]));
    }, recovery: { retained: work, projects: [{ previous: work.projects[0], authority, resolutions: [{ attempt,
      inspection: { type: 'commit-inspection', result: { type: 'committed', ack: documentAck(attempt) } } }] }] } });
    let done = false; const flush = q.flush(); void flush.then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(0); expect(done).toBe(true); expect(h.sent).toHaveLength(1); await flush;
    expect(q.dispose().projects[0].pending).toHaveLength(1);
  });

  it('keeps project flush independent of a later unrelated domain failure', async () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness(); h.install('q');
    h.enqueueTitle(1, 'p'); h.enqueueTitle(1, 'q', 'q'); const p = h.queue.flush('p'); h.resolveNext(); await p;
    const all = h.observe(h.queue.flush()); h.resolveNext({ type: 'failed', code: 'proof-unavailable', outcome: 'unknown', admission: 'invalidated' });
    await expect(all).rejects.toMatchObject({ type: 'domain' }); await expect(p).resolves.toBeUndefined();
    h.enqueueTitle(2, 'p survives'); const next = h.queue.flush('p'); h.resolveNext(); await next; h.dispose();
  });

  it('refuses a detected active commit-ID collision and keeps the second project pending', async () => {
    vi.useFakeTimers(); let count = 0;
    const h = createIncrementalQueueHarness(options => Object.values(modules)[0].createIncrementalQueue({ ...options, uuid: () => ++count === 1 ? 'client' : 'same' }));
    h.install('q'); h.enqueueTitle(1, 'p'); h.enqueueTitle(1, 'q', 'q');
    await expect(h.queue.flush()).rejects.toMatchObject({ code: 'invalid-input' }); expect(h.sent).toHaveLength(1);
    expect(h.dispose().projects.find(p => p.authority.binding.scope.projectId === 'q')!.pending).toHaveLength(1);
  });

  it('does zero cloning/stringification and leaves nested template/source/preference/mapping payloads opaque', () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness(); const source = h.authorities.get('p')!.source;
    const getter = vi.fn(() => { throw new Error('nested walk'); });
    const template = { ...makeIncrementalProject().initialState.variants.default.templates['page-0'] };
    Object.defineProperty(template, 'elements', { enumerable: true, get: getter });
    const generator = Object.defineProperty({}, 'templateScript', { enumerable: true, get: getter });
    const panels = Object.defineProperty({}, 'editor', { enumerable: true, get: getter });
    const mappings = [Object.defineProperty({}, 'cell', { enumerable: true, get: getter })];
    const clone = vi.spyOn(globalThis, 'structuredClone').mockImplementation(() => { throw new Error('clone'); });
    const stringify = vi.spyOn(JSON, 'stringify').mockImplementation(() => { throw new Error('stringify'); });
    try {
      h.observe(h.queue.enqueueDocument('p', 1, { source, changes: [
        { type: 'put-template', variantId: 'default', template }, { type: 'set-generator', generator: generator as any },
      ], structural: { basis: { type: 'generation', generation: 0 }, mappings: mappings as any } }));
      h.observe(h.queue.enqueuePreferences('p', 1, { panelsExpanded: panels }));
    } finally { clone.mockRestore(); stringify.mockRestore(); }
    expect(getter).not.toHaveBeenCalled(); expect(h.dispose().projects[0].pending).toHaveLength(2);
    const parsed = ts.createSourceFile('queue.ts', readFileSync('services/localWorkspace/incrementalQueue.ts', 'utf8'), ts.ScriptTarget.Latest, true);
    for (const statement of parsed.statements) if (ts.isImportDeclaration(statement)) expect(statement.importClause?.isTypeOnly).toBe(true);
  });

  it('rejects binding mutation before dispatch without invoking installed-authority accessors', async () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness(); const save = h.enqueueTitle(1, 'retained');
    const getter = vi.fn(() => { throw new Error('binding getter'); });
    Object.defineProperty(h.authorities.get('p')!, 'binding', { get: getter });
    const flush = h.observe(h.queue.flush('p')); await vi.advanceTimersByTimeAsync(500);
    await expect(save).rejects.toMatchObject({ code: 'source-changed' }); await expect(flush).rejects.toMatchObject({ code: 'source-changed' });
    expect(getter).not.toHaveBeenCalled(); expect(h.sent).toHaveLength(0); h.dispose();
  });

  it('rejects in-place token/incarnation replacement rather than reusing old admitted edits', async () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness(); h.enqueueTitle(1, 'old admitted');
    const a = h.authorities.get('p')!;
    Object.assign(a.binding, { admissionId: 2, scope: { ...a.binding.scope, incarnation: 'replacement' } });
    await expect(h.queue.flush()).rejects.toMatchObject({ code: 'source-changed' }); expect(h.sent).toHaveLength(0); h.dispose();
  });

  it('rejects accessor barrier framing before running callback or draining admitted work', async () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness(); h.enqueueTitle(1, 'pending');
    const getter = vi.fn(() => async () => ({ type: 'completed', value: 1 }));
    const operation = Object.defineProperty({ kind: 'drain', targets: [] }, 'run', { enumerable: true, get: getter });
    await expect(h.queue.barrier(operation as unknown as QueueModule.QueueBarrierOperation<number>)).rejects.toMatchObject({ code: 'invalid-input' });
    expect(getter).not.toHaveBeenCalled(); expect(h.sent).toHaveLength(0); h.dispose();
  });

  it('freezes on accessor barrier result instead of invoking getter and claiming completion', async () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness(); const getter = vi.fn(() => 'completed');
    const outcome = Object.defineProperty({ value: 1 }, 'type', { enumerable: true, get: getter });
    await expect(h.queue.barrier({ kind: 'drain', targets: [], run: async () => outcome as QueueModule.QueueBarrierOutcome<number> }))
      .rejects.toMatchObject({ code: 'invalid-response' });
    expect(getter).not.toHaveBeenCalled(); h.dispose();
  });

  it('validates nested barrier failure framing without invoking getters', async () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness(); const getter = vi.fn(() => 'transport');
    const failed = Object.defineProperty({ error: 'opaque' }, 'type', { enumerable: true, get: getter });
    await expect(h.queue.barrier({ kind: 'drain', targets: [], run: async () => ({ type: 'failed', failure: failed as QueueModule.QueueFailure }) }))
      .rejects.toMatchObject({ code: 'invalid-response' });
    expect(getter).not.toHaveBeenCalled(); h.dispose();
  });
});

describe('queue through real client, handler and repository', () => {
  it('persists delete/recreate node membership atomically', async () => {
    const h = await createRealQueueHarness();
    try {
      const original = h.initial.projectNodes.values().next().value!.value;
      h.document(1, [{ type: 'put-node', node: { ...original, id: 'a' } }, { type: 'put-node', node: { ...original, id: 'b' } }]);
      await h.queue.flush();
      const saved = h.document(2, [{ type: 'delete-node', nodeId: 'a' }, { type: 'put-node', node: { ...original, id: 'a', title: 'new a' } }]);
      await h.queue.flush(); await saved;
      const external = await h.exportFresh(); expect(Object.keys(external.initialState.nodes)).toEqual(['root', 'b', 'a']);
      expect(external.initialState.nodes.a.title).toBe('new a');
      expect((await h.readRecords()).projectHeaders.values().next().value!.storageRevision).toBe(2);
    } finally { h.dispose(); }
  });

  it.each(['pending-only', 'captured not-posted'] as const)(
    'recovers %s through independently bootstrapped real clients with equal numeric tokens', async state => {
      // Separate module lifetimes model independent client allocators. Do not patch
      // counters or infer a global token namespace from today's module singleton.
      vi.resetModules(); const h = await createRealQueueHarness();
      let fresh: ReturnType<typeof h.createWorkspaceWorkerClient> | undefined; let next: QueueModule.IncrementalQueue | undefined;
      try {
        h.document(1, [{ type: 'put-node', node: { ...node, title: 'fresh lifetime recovery' } }]);
        h.client.dispose();
        if (state === 'captured not-posted') await expect(h.queue.flush()).rejects.toMatchObject({ type: 'transport', error: { outcome: 'not-posted' } });
        const work = h.queue.dispose(); await work.whenQuiescent; const previous = work.projects[0];
        const resolutions = previous.attempts.map(({ attempt, failure }) => {
          if (failure?.type !== 'transport' || (failure.error as WorkspaceWorkerError).outcome !== 'not-posted') throw new Error('Expected captured absence');
          return { attempt, notPosted: failure.error as WorkspaceWorkerError };
        });
        vi.resetModules();
        const { createWorkspaceWorkerClient } = await import('../../../../services/localWorkspace/workspaceWorkerClient');
        fresh = createWorkspaceWorkerClient(h.factory); const authority = await h.rebind(fresh);
        expect(authority.binding.admissionId).toBe(previous.authority.binding.admissionId);
        expect(authority.transport).not.toBe(previous.authority.transport);
        expect(h.messages.map(m => m.request.type)).toEqual(['bootstrap', 'bootstrap']);
        next = Object.values(modules)[0].createIncrementalQueue({ ...h.options, transport: fresh,
          recovery: { retained: work, projects: [{ previous, authority, resolutions }] } });
        await next.flush();
        expect(h.messages.map(m => m.request.type)).toEqual(['bootstrap', 'bootstrap', 'document-batch']);
        expect((await h.exportFresh()).initialState.nodes.root.title).toBe('fresh lifetime recovery');
        expect((await h.readRecords()).projectHeaders.values().next().value!.storageRevision).toBe(1);
      } finally { next?.dispose(); fresh?.dispose(); h.dispose(); }
    });

  it('persists generator removal and restoration in one coalesced atomic batch with external field order', async () => {
    const project = makeIncrementalProject();
    const generator = project.initialState.generator!;
    project.initialState = { generator, ...project.initialState };
    const h = await createRealQueueHarness(project);
    try {
      const before = await h.readRecords(); const beforeExternal = await h.exportFresh();
      const initialHeader = before.projectHeaders.values().next().value!;
      expect(initialHeader.order.state[0]).toBe('generator'); expect(Object.keys(beforeExternal.initialState)[0]).toBe('generator');
      expect(before.projectSources.size).toBe(1); expect(before.projectSources.values().next().value!.value).toEqual(generator);
      const restored = Object.freeze({ ...generator, templateScript: 'return { restored: "☕" };' });
      const selectedNode = Object.freeze({ ...node, title: 'selected latest title' });
      const remove: DocumentChange = { type: 'set-generator', generator: undefined };
      const restore: DocumentChange = { type: 'set-generator', generator: restored };
      const selected: DocumentChange = { type: 'put-node', node: selectedNode };
      h.clearOperations();
      const first = h.document(1, [remove, { type: 'put-node', node: { ...node, title: 'superseded title' } }]);
      const second = h.document(2, [restore, selected]);
      expect(h.messages.filter(m => m.request.type === 'document-batch')).toHaveLength(0);
      await h.queue.flush(); expect(await first).toBe(await second);
      expect(h.messages.map(m => m.request.type)).toEqual(['bootstrap', 'document-batch']);
      const posted = h.messages[1].request;
      if (posted.type !== 'document-batch') throw new Error('Expected document batch');
      expect(posted.batch.changes).toEqual([remove, selected, restore]);
      const events = h.events.filter(e => e.type === 'acknowledged'); expect(events).toHaveLength(1);
      const attempt = events[0].attempt;
      if (attempt.lane !== 'document') throw new Error('Expected document attempt');
      expect(attempt.batch.changes[0]).toBe(remove); expect(attempt.batch.changes[1]).toBe(selected); expect(attempt.batch.changes[2]).toBe(restore);
      const writes = h.operations.filter(op => op.phase === 'write');
      expect(new Set(writes.map(op => op.transactionId)).size).toBe(1);
      expect([...new Set(writes.map(op => op.store))].sort()).toEqual(['projectHeaders', 'projectNodes', 'projectSources']);
      const physical = await h.readRecords(); const header = physical.projectHeaders.values().next().value!;
      expect(header.storageRevision).toBe(1);
      expect(header.order.state).toEqual([...initialHeader.order.state.filter(key => key !== 'generator'), 'generator']);
      expect(header.order.state.filter(key => key === 'generator')).toHaveLength(1);
      expect(physical.projectSources.size).toBe(1);
      expect(physical.projectSources.values().next().value!).toMatchObject({ key: before.projectSources.values().next().value!.key, value: restored });
      expect(physical.projectNodes.values().next().value!.value).toEqual(selectedNode);
      expect(physical.projectTemplates).toEqual(before.projectTemplates); expect(physical.projectVariants).toEqual(before.projectVariants);
      const external = await h.exportFresh();
      expect(Object.keys(external.initialState)).toEqual([...Object.keys(beforeExternal.initialState).filter(key => key !== 'generator'), 'generator']);
      expect(external.initialState.generator).toEqual(restored); expect(external.initialState.nodes.root.title).toBe(selectedNode.title);
    } finally { h.dispose(); }
  });

  it('persists template delete/recreate order within one atomic occurrence edit', async () => {
    const h = await createRealQueueHarness();
    try {
      const template = h.initial.projectTemplates.values().next().value!.value;
      const occurrence = { variantId: 'default', templateId: template.id, position: 0 };
      const saved = h.document(1, [{ type: 'delete-template', variantId: 'default', templateId: template.id },
        { type: 'put-template', variantId: 'default', template: { ...template, name: 'Recreated' } }], {
        basis: { type: 'generation', generation: 0 }, mappings: [
          { type: 'remove', from: occurrence }, { type: 'create', to: occurrence, cell: { present: true, value: false } },
        ],
      });
      await h.queue.flush(); await saved;
      const posted = h.messages.find(m => m.request.type === 'structural-command')!.request;
      expect(posted.type).toBe('structural-command');
      if (posted.type !== 'structural-command') throw new Error('Expected occurrence edit');
      expect(posted.command.batch.changes.map(c => c.type)).toEqual(['delete-template', 'put-template']);
      expect(posted.command.batch.structural.mappings.map(m => m.type)).toEqual(['remove', 'create']);
      expect((await h.readRecords()).projectVariants.values().next().value!.templateOrder).toEqual(['page-1', 'page-0']);
      expect(Object.keys((await h.exportFresh()).initialState.variants.default.templates)).toEqual(['page-1', 'page-0']);
    } finally { h.dispose(); }
  });

  it('dependency regression: worker preserves atomic template delete/recreate order without queue', async () => {
    const h = await createIncrementalWorkerHarness(makeIncrementalProject());
    try {
      const template = h.initial.projectTemplates.values().next().value!.value;
      const occurrence = { variantId: 'default', templateId: template.id, position: 0 };
      const response = await h.client.request({ type: 'structural-command', admissionId: h.admissionId, command: {
        type: 'occurrence-edit', batch: { scope: h.scope, clientId: 'dependency-probe', commitId: 'recreate', commitGeneration: 1,
          editorGeneration: 1, expectedRevision: 0, changes: [
            { type: 'delete-template', variantId: 'default', templateId: template.id },
            { type: 'put-template', variantId: 'default', template: { ...template, name: 'Recreated' } },
          ], structural: { expectedFoldStructureGeneration: 0, mappings: [
            { type: 'remove', from: occurrence }, { type: 'create', to: occurrence, cell: { present: true, value: false } },
          ] },
        },
      } });
      expect(response).toMatchObject({ type: 'structural-result', ack: { revision: 1 } });
      expect(h.messages[1].request).toMatchObject({ command: { batch: { changes: [
        { type: 'delete-template' }, { type: 'put-template' },
      ] } } });
      expect((await h.readRecords()).projectVariants.values().next().value!.templateOrder).toEqual(['page-1', 'page-0']);
    } finally { h.client.dispose(); }
  });

  it('persists final-parent variant recreation without resurrecting discarded pending children', async () => {
    const h = await createRealQueueHarness();
    try {
      const template = h.initial.projectTemplates.values().next().value!.value;
      const child = (id: string): DocumentChange => ({ type: 'put-template', variantId: 'new', template: { ...template, id } });
      const saved = h.document(1, [child('discarded'), { type: 'put-variant', variant: { id: 'new', name: 'Old' } },
        { type: 'delete-variant', variantId: 'new' }, child('a'), child('b'),
        { type: 'delete-template', variantId: 'new', templateId: 'a' }, child('a'),
        { type: 'put-variant', variant: { id: 'new', name: 'New' } }], {
        basis: { type: 'generation', generation: 0 }, mappings: ['b', 'a'].map(templateId => ({
          type: 'create' as const, to: { variantId: 'new', templateId, position: 0 }, cell: { present: false as const },
        })),
      });
      await h.queue.flush(); await saved;
      const exported = await h.exportFresh(); expect(Object.keys(exported.initialState.variants.new.templates)).toEqual(['b', 'a']);
      expect(exported.initialState.variants.new.templates.discarded).toBeUndefined();
    } finally { h.dispose(); }
  });

  it('atomically replaces root and repairs a referencing node without a bulk write', async () => {
    const h = await createRealQueueHarness();
    try {
      const original = h.initial.projectNodes.values().next().value!.value;
      h.document(1, [{ type: 'put-node', node: { ...original, id: 'ref', referenceId: 'root' } }]); await h.queue.flush();
      h.document(2, [{ type: 'delete-node', nodeId: 'root' }, { type: 'put-node', node: { ...original, id: 'new-root' } },
        { type: 'set-root', rootId: 'new-root' }, { type: 'put-node', node: { ...original, id: 'ref', referenceId: 'new-root' } }]);
      await h.queue.flush(); const external = await h.exportFresh();
      expect(external.initialState.rootId).toBe('new-root'); expect(external.initialState.nodes.root).toBeUndefined();
      expect(external.initialState.nodes.ref.referenceId).toBe('new-root');
      expect((await h.readRecords()).projectHeaders.values().next().value!.storageRevision).toBe(2);
    } finally { h.dispose(); }
  });

  it('uses worker structural ack for new-side fold and retains a preference lower bound, not a guessed revision', async () => {
    const project = makeIncrementalProject(); const template = project.initialState.variants.default.templates['page-0'];
    // Duplicate IDs use positional overlays, so reordering actually rewrites preferences.
    template.layers = [{ ...template.layers![0], id: 'duplicate', collapsed: true }, { ...template.layers![0], id: 'duplicate', collapsed: false }];
    const h = await createRealQueueHarness(project);
    try {
      const normalized = h.initial.projectTemplates.values().next().value!.value;
      const at = (position: number) => ({ variantId: 'default', templateId: 'page-0', position });
      h.document(1, [{ type: 'put-template', variantId: 'default', template: { ...normalized, layers: [...normalized.layers!].reverse() } }], {
        basis: { type: 'generation', generation: 0 }, mappings: [0, 1].map(i => ({ type: 'continue', from: at(i), to: at(1 - i) })),
      });
      const preference = h.queue.enqueuePreferences(h.scope.projectId, 2, { source: h.authority.source, patch: {}, folds: {
        basis: { type: 'after-structural', editorGeneration: 1 }, updates: [{ occurrence: at(1), collapsed: false }],
      } });
      await h.queue.flush(); expect((await preference).preferenceRevision).toBe(2);
      const posted = h.messages.find(m => m.request.type === 'preferences')!.request;
      expect(posted).toMatchObject({ batch: { observedPreferenceRevision: 0, folds: { expectedFoldStructureGeneration: 1 } } });
      let external = await h.exportFresh(); expect(external.initialState.variants.default.templates['page-0'].layers!.map(l => l.collapsed)).toEqual([false, false]);
      h.document(3, [{ type: 'put-template', variantId: 'default', template: normalized }], {
        basis: { type: 'generation', generation: 1 }, mappings: [0, 1].map(i => ({ type: 'continue', from: at(i), to: at(1 - i) })),
      });
      await h.queue.flush(); external = await h.exportFresh();
      expect(external.initialState.variants.default.templates['page-0'].layers!.map(l => l.collapsed)).toEqual([false, false]);
      expect((await h.readRecords()).projectHeaders.values().next().value!.foldStructureGeneration).toBe(2);
    } finally { h.dispose(); }
  });

  it('recovers failed preferences only after inspection and fresh bootstrap, retaining document work', async () => {
    const h = await createRealQueueHarness(); let next: QueueModule.IncrementalQueue | undefined;
    try {
      h.document(1, [{ type: 'put-node', node: { ...node, title: 'saved' } }]); await h.queue.flush();
      let failedOnce = false;
      h.setFault(point => { if (!failedOnce && point.phase === 'before-put' && point.store === 'projectPreferences') {
        failedOnce = true; throw new DOMException('quota', 'QuotaExceededError');
      } });
      const pref = h.queue.enqueuePreferences(h.scope.projectId, 2, { scale: 2 }); void pref.catch(() => {});
      const flush = h.queue.flush(); void flush.catch(() => {});
      h.document(3, [{ type: 'put-node', node: { ...node, title: 'retained' } }]);
      await expect(flush).rejects.toMatchObject({ type: 'domain', response: { admission: 'invalidated' } });
      const work = h.queue.dispose(); await work.whenQuiescent; h.setFault();
      expect(work.projects[0].acknowledged.documentGeneration).toBe(1);
      const attempt = work.projects[0].attempts[0].attempt;
      if (attempt.lane !== 'preferences') throw Error('Expected preference attempt');
      const inspection = await h.client.request({ type: 'inspect-commit', attempt });
      expect(inspection).toEqual({ type: 'commit-inspection', result: { type: 'not-committed' } });
      if (attempt.lane !== 'preferences' || inspection.type !== 'commit-inspection') throw new Error('Expected preference inspection');
      expect(await h.client.request({ type: 'preferences', admissionId: h.admissionId, batch: attempt.batch })).toMatchObject({ type: 'failed', code: 'stale-admission' });
      const authority = await h.rebind();
      next = Object.values(modules)[0].createIncrementalQueue({ ...h.options,
        recovery: { retained: work, projects: [{ previous: work.projects[0], authority, resolutions: [{ attempt, inspection }] }] } });
      await next.flush(); const external = await h.exportFresh();
      expect(external.initialState.nodes.root.title).toBe('retained'); expect(external.initialState.scale).toBe(2);
      expect((await h.readRecords()).projectHeaders.values().next().value!.storageRevision).toBe(2);
    } finally { next?.dispose(); h.dispose(); }
  });

  it('inspects a late durable commit after freeze and terminal client failure without reviving old token', async () => {
    const h = await createRealQueueHarness(); let next: QueueModule.IncrementalQueue | undefined;
    let fresh: ReturnType<typeof h.createWorkspaceWorkerClient> | undefined;
    try {
      h.workers[0].dropResponses = true;
      h.document(1, [{ type: 'put-node', node: { ...node, title: 'late durable' } }]);
      const flush = h.queue.flush(); void flush.catch(() => {});
      const work = h.queue.freeze('explicit handover'); const attempt = work.projects[0].attempts[0].attempt;
      if (attempt.lane !== 'document') throw Error('Expected document attempt');
      await vi.waitFor(() => expect(h.responses.some(r => r.response.type === 'document-result')).toBe(true));
      h.workers[0].emit('error', { error: new Error('worker crash after commit') }); await work.whenQuiescent;
      await expect(h.client.request({ type: 'inspect-commit', attempt })).rejects.toMatchObject({ code: 'client-failed' });
      fresh = h.createWorkspaceWorkerClient(h.factory);
      const inspection = await fresh.request({ type: 'inspect-commit', attempt });
      expect(inspection).toMatchObject({ type: 'commit-inspection', result: { type: 'committed', ack: { revision: 1 } } });
      if (inspection.type !== 'commit-inspection' || attempt.lane !== 'document') throw new Error('Expected document inspection');
      expect(await fresh.request({ type: 'document-batch', admissionId: h.admissionId, batch: attempt.batch })).toMatchObject({ type: 'failed', code: 'stale-admission' });
      const authority = await h.rebind(fresh); const before = h.messages.length;
      next = Object.values(modules)[0].createIncrementalQueue({ ...h.options, transport: fresh,
        recovery: { retained: work, projects: [{ previous: work.projects[0], authority, resolutions: [{ attempt, inspection }] }] } });
      await next.flush(); expect(h.messages).toHaveLength(before);
      expect((await h.exportFresh()).initialState.nodes.root.title).toBe('late durable');
      expect((await h.readRecords()).projectHeaders.values().next().value!.storageRevision).toBe(1);
    } finally { next?.dispose(); fresh?.dispose(); h.dispose(); }
  });

  it('retries a failed structural command before its retained new-side fold intent', async () => {
    const h = await createRealQueueHarness(); let next: QueueModule.IncrementalQueue | undefined;
    try {
      const template = h.initial.projectTemplates.values().next().value!.value;
      const occurrence = { variantId: 'default', templateId: template.id, position: 0 };
      h.setFault(point => { if (point.phase === 'before-put' && point.store === 'projectTemplates') throw new DOMException('quota', 'QuotaExceededError'); });
      h.document(1, [{ type: 'put-template', variantId: 'default', template: { ...template, name: 'structure' } }], {
        basis: { type: 'generation', generation: 0 }, mappings: [{ type: 'continue', from: occurrence, to: occurrence }],
      });
      const pref = h.queue.enqueuePreferences(h.scope.projectId, 2, { source: h.authority.source, patch: {}, folds: {
        basis: { type: 'after-structural', editorGeneration: 1 }, updates: [{ occurrence, collapsed: true }],
      } }); void pref.catch(() => {});
      await expect(h.queue.flush()).rejects.toMatchObject({ type: 'domain' });
      expect(h.messages.filter(m => m.request.type === 'preferences')).toHaveLength(0);
      h.setFault(); const work = h.queue.dispose(); await work.whenQuiescent; const attempt = work.projects[0].attempts[0].attempt;
      if (attempt.lane !== 'document') throw Error('Expected document attempt');
      const inspection = await h.client.request({ type: 'inspect-commit', attempt });
      if (inspection.type !== 'commit-inspection') throw new Error('Expected inspection');
      const authority = await h.rebind(); next = Object.values(modules)[0].createIncrementalQueue({ ...h.options,
        recovery: { retained: work, projects: [{ previous: work.projects[0], authority, resolutions: [{ attempt, inspection }] }] } });
      await next.flush(); const external = await h.exportFresh();
      expect(external.initialState.variants.default.templates['page-0']).toMatchObject({ name: 'structure', layers: [{ collapsed: true }] });
      expect((await h.readRecords()).projectHeaders.values().next().value!.storageRevision).toBe(1);
    } finally { next?.dispose(); h.dispose(); }
  });

  it('copies latest durable fold cells and preserves explicit raw created cells without overlay snapshots', async () => {
    const h = await createRealQueueHarness();
    try {
      const template = h.initial.projectTemplates.values().next().value!.value;
      const at = (position: number) => ({ variantId: 'default', templateId: template.id, position });
      expect(await h.client.request({ type: 'preferences', admissionId: h.admissionId, batch: {
        scope: h.scope, clientId: 'other-preference-owner', commitId: 'other-fold', commitGeneration: 1, editorGeneration: 1,
        observedPreferenceRevision: 0, patch: {}, folds: { expectedFoldStructureGeneration: 0, updates: [{ occurrence: at(0), collapsed: true }] },
      } })).toMatchObject({ type: 'preferences-result' });
      h.document(1, [{ type: 'put-template', variantId: 'default', template: { ...template,
        layers: [template.layers![0], { ...template.layers![0], id: 'copy' }, { ...template.layers![0], id: 'raw' }],
      } }], { basis: { type: 'generation', generation: 0 }, mappings: [
        { type: 'continue', from: at(0), to: at(0) }, { type: 'copy', from: at(0), to: at(1) },
        { type: 'create', to: at(2), cell: { present: true, value: { preserved: 'raw' } } },
      ] });
      await h.queue.flush();
      expect((await h.exportFresh()).initialState.variants.default.templates['page-0'].layers!.map(l => l.collapsed)).toEqual([true, true, { preserved: 'raw' }]);
    } finally { h.dispose(); }
  });

  it('preserves existing validator admission of empty document IDs without weakening private identities', async () => {
    const h = await createRealQueueHarness();
    try {
      const template = h.initial.projectTemplates.values().next().value!.value;
      const saved = h.document(1, [{ type: 'put-node', node: { ...node, id: '' } }, { type: 'set-root', rootId: '' },
        { type: 'put-template', variantId: '', template: { ...template, id: '' } },
        { type: 'put-variant', variant: { id: '', name: 'Empty ID' } }], {
        basis: { type: 'generation', generation: 0 }, mappings: [{ type: 'create', to: { variantId: '', templateId: '', position: 0 }, cell: { present: false } }],
      });
      const flush = h.queue.flush(); await saved; await flush;
      const external = await h.exportFresh(); expect(external.initialState.rootId).toBe('');
      expect(external.initialState.variants[''].templates[''].id).toBe('');
    } finally { h.dispose(); }
  });
});
