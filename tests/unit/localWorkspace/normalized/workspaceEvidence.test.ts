// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspaceCommandHarness, createWorkspaceLifecycleHarness } from '../../../helpers/workspaceCommandHarness';
import { physicalRows } from '../../../helpers/normalizationHarness';
import { makeIncrementalProject } from '../../../helpers/incrementalFixtures';
import { createNormalizedRepository } from '../../../../services/localWorkspace/normalized/repository';
import { canonicalStringify } from '../../../../services/localWorkspace/canonical';
import { NORMALIZED_STORE_NAMES, type ProjectStoreName } from '../../../../services/localWorkspace/normalized/schema';
import type { WorkspaceBatch, WorkspaceCommandResult, WorkspaceLifecycleIntent } from '../../../../services/localWorkspace/normalized/workspaceCommands';
import type { NormalizedWorkspaceManifest, WorkspaceReceipt, WorkspaceStamp } from '../../../../services/localWorkspace/normalized/workspaceManifest';
import { decomposeProject } from '../../../../services/localWorkspace/normalized/codec';

const immutableStores = ['projects', 'migrationLedger', 'legacyBackup'] as const;
const allStores = [...new Set([...NORMALIZED_STORE_NAMES, 'workspace', 'presets', 'pendingImports', ...immutableStores])];
const projectStores = NORMALIZED_STORE_NAMES.filter((name): name is ProjectStoreName => name !== 'normalizationLedger');
const project = (id: string) => ({ ...makeIncrementalProject(2), id });
const recordCount = projectStores.reduce((count, name) => count + decomposeProject(project('count'), {
  storageGeneration: 'count', projectId: 'count', incarnation: 'count',
})[name].size, 0);

describe.each(['count', 'bytes'] as const)('real workspace worker receipt eviction: %s', mode => {
  let h: Awaited<ReturnType<typeof createWorkspaceLifecycleHarness>>, stamp: WorkspaceStamp;
  let original: Record<string, any[]>, created: WorkspaceCommandResult['projects'][number];
  const batches: WorkspaceBatch[] = [], receipts: WorkspaceReceipt[] = [], count = mode === 'count' ? 33 : 24;
  beforeAll(async () => { h = await createWorkspaceLifecycleHarness(); stamp = h.binding.catalog.stamp; original = await physicalRows(h, immutableStores); });
  // Genuine command history is fixture setup, never hand-written successful rows.
  // One transition per setup hook retains the existing 10-second hook deadline.
  for (let revision = 1; revision <= count; revision++) beforeAll(async () => {
    const scope = h.binding.catalog.members[0];
    const batch: WorkspaceBatch = { storageGeneration: h.binding.catalog.storageGeneration, expected: stamp,
      identity: { clientId: mode === 'count' ? 'window-client' : '\0'.repeat(255), commandSequence: revision,
        commandId: mode === 'count' ? `window-${revision}` : `${String(revision).padStart(3, '0')}${'\0'.repeat(252)}` },
      targets: revision === 1 ? [] : [{ type: 'member', scope }], intent: revision === 1
        ? { type: 'create-and-activate-project', project: project(`window-born-${mode}`) }
        : { type: 'activate-project', projectId: scope.projectId } };
    const result = await h.client.request({ type: 'workspace-command', admissionId: h.binding.admissionId, batch });
    expect(result.type).toBe('workspace-command-result'); if (result.type !== 'workspace-command-result') throw Error('Real workspace write required');
    if (revision === 1) created = result.result.projects[0];
    expect(result.result.receipt.before).toEqual(stamp); expect(result.result.receipt.after.revision).toBe(revision);
    batches.push(batch); receipts.push(result.result.receipt); stamp = result.result.receipt.after;
  });
  afterAll(() => h?.dispose());

  it('persists the bounded window and exact linked floor through actual worker transactions', async () => {
    const current = (await physicalRows(h, ['workspace'])).workspace[0] as NormalizedWorkspaceManifest;
    expect(current.revision).toBe(count); expect(current.lastCommit).toEqual(receipts.at(-1));
    if (mode === 'count') expect(current.commitWindow.entries).toHaveLength(32);
    else expect(current.commitWindow.entries.length).toBeLessThan(count);
    const floor = count - current.commitWindow.entries.length;
    expect(floor).toBeGreaterThan(0); expect(current.commitWindow.floorRevision).toBe(floor);
    expect(current.commitWindow.floorCoreDigest).toBe(receipts[floor - 1].after.coreDigest);
    expect(Buffer.byteLength(canonicalStringify(current.commitWindow))).toBeLessThanOrEqual(64 * 1024);
    expect(await physicalRows(h, immutableStores)).toEqual(original);
  });

  it('reports evicted evidence as conflict, inspects the current head and never replays the old attempt', async () => {
    const before = await physicalRows(h, allStores);
    const old = await h.client.request({ type: 'inspect-workspace-command', admissionId: h.binding.admissionId, batch: batches[0] });
    expect(old).toMatchObject({ type: 'workspace-inspection', result: { type: 'conflict', reason: 'proof-unavailable' } });
    expect(await h.client.request({ type: 'inspect-workspace-command', admissionId: h.binding.admissionId, batch: batches.at(-1)! }))
      .toMatchObject({ type: 'workspace-inspection', result: { type: 'committed', result: { receipt: receipts.at(-1) } } });
    const fresh = await h.client.request({ type: 'workspace-bootstrap', storageGeneration: h.binding.catalog.storageGeneration });
    if (fresh.type !== 'workspace-bootstrapped') throw Error('Fresh admission required');
    expect(await h.client.request({ type: 'workspace-command', admissionId: fresh.admissionId, batch: batches[0] })).toMatchObject({ type: 'failed' });
    expect(await physicalRows(h, allStores)).toEqual(before);
  });

  it('retains workspace birth after receipt eviction and admits both ordinary lanes without a synthetic baseline', async () => {
    const fresh = createNormalizedRepository(h.environment), active = await fresh.readActiveSnapshot();
    const member = active!.workspace.members.find(row => row.projectId === created.scope.projectId)!;
    expect(member.birth).toMatchObject({ kind: 'workspace-command', identity: batches[0].identity });
    const bound = await h.client.request({ type: 'bootstrap', project: await h.readRecords(created.scope) });
    if (bound.type !== 'bootstrapped') throw Error('Explicit birth admission required');
    const identity = { scope: created.scope, clientId: 'ordinary-after-eviction', editorGeneration: 1, commitGeneration: 1, commitId: 'preferences' };
    expect(await h.client.request({ type: 'preferences', admissionId: bound.admissionId,
      batch: { ...identity, observedPreferenceRevision: 0, patch: { scale: 2 } } })).toMatchObject({ type: 'preferences-result' });
    expect(await h.client.request({ type: 'document-batch', admissionId: bound.admissionId, batch: {
      ...identity, editorGeneration: 2, commitGeneration: 2, commitId: 'document', expectedRevision: 0,
      changes: [{ type: 'put-node', node: { ...project(created.scope.projectId).initialState.nodes.root, title: 'After eviction' } }],
    } })).toMatchObject({ type: 'document-result' });
    const reopened = (await createNormalizedRepository(h.environment).readActiveSnapshot())!.snapshot.projects.find(row => row.id === created.scope.projectId)!;
    expect(reopened.initialState.scale).toBe(2); expect(reopened.initialState.nodes.root.title).toBe('After eviction');
    expect(await physicalRows(h, immutableStores)).toEqual(original);
  });
});

describe('bounded old worker fence ownership', () => {
  let h: Awaited<ReturnType<typeof createWorkspaceLifecycleHarness>>, batch: WorkspaceBatch;
  beforeAll(async () => {
    h = await createWorkspaceLifecycleHarness(); batch = h.request({ type: 'activate-project', projectId: h.b.id });
    h.environment.workspaceFault = point => { if (point.phase === 'before-cas') throw Error('Original abort'); };
    expect(await h.client.request({ type: 'workspace-command', admissionId: h.binding.admissionId, batch })).toMatchObject({ type: 'failed' });
    h.environment.workspaceFault = undefined;
  });
  for (let index = 1; index <= 32; index++) beforeAll(async () => {
    expect(await h.client.request({ type: 'workspace-bootstrap', storageGeneration: h.binding.catalog.storageGeneration })).toMatchObject({ type: 'workspace-bootstrapped' });
    if (index === 31) {
      expect(await h.client.request({ type: 'workspace-fence', admissionId: h.binding.admissionId, storageGeneration: batch.storageGeneration })).toMatchObject({ type: 'workspace-fenced' });
      expect(await h.client.request({ type: 'inspect-workspace-command', admissionId: h.binding.admissionId, batch })).toMatchObject({ type: 'workspace-inspection', result: { type: 'not-committed' } });
    }
  });
  afterAll(() => h?.dispose());
  it('loses old absence proof after capability eviction rather than manufacturing another fence', async () => {
    expect(await h.client.request({ type: 'workspace-fence', admissionId: h.binding.admissionId, storageGeneration: batch.storageGeneration }))
      .toMatchObject({ type: 'failed', code: 'stale-admission' });
    expect(await h.client.request({ type: 'inspect-workspace-command', admissionId: h.binding.admissionId, batch }))
      .toMatchObject({ type: 'workspace-inspection', result: { type: 'unknown' } });
    expect((await physicalRows(h, ['workspace'])).workspace[0].revision).toBe(0);
    expect(h.messages.filter(row => row.request.type === 'workspace-command')).toHaveLength(1);
  });
});

type Harness = Awaited<ReturnType<typeof createWorkspaceCommandHarness>>;
const preset = (id: string) => ({ id, title: id, desc: '', isCustom: true as const, initialState: makeIncrementalProject(2).initialState });
const pending = (id: string) => ({ id, targetProjectId: `${id}-target`, name: id, state: makeIncrementalProject(2).initialState, createdAt: '2026-10-01T00:00:00.000Z' });
const puts = (count: number) => Array.from({ length: count }, () => 'put' as const);
const deletes = (count: number) => Array.from({ length: count }, () => 'delete' as const);
const cases: { name: string; setup?: (h: Harness) => Promise<void>; intent(h: Harness): WorkspaceLifecycleIntent; operations: readonly ('put' | 'delete')[] }[] = [
  { name: 'create', intent: () => ({ type: 'create-and-activate-project', project: project('matrix-new') }), operations: puts(recordCount + 1) },
  { name: 'activate', intent: h => ({ type: 'activate-project', projectId: h.b.id }), operations: puts(1) },
  { name: 'close', intent: h => ({ type: 'close-project', projectId: h.b.id }), operations: [...deletes(recordCount), ...puts(1)] },
  { name: 'close-last', setup: async h => { await h.commit({ type: 'close-project', projectId: h.b.id }); },
    intent: h => ({ type: 'close-project', projectId: h.a.id, successor: project('matrix-successor') }), operations: [...deletes(recordCount), ...puts(recordCount + 1)] },
  { name: 'save-preset', intent: () => ({ type: 'save-custom-preset', preset: preset('matrix-preset') }), operations: puts(2) },
  { name: 'delete-preset', setup: async h => { for (const id of ['first', 'middle', 'last']) await h.commit({ type: 'save-custom-preset', preset: preset(id) }); },
    intent: () => ({ type: 'delete-custom-preset', presetId: 'middle' }), operations: ['delete', 'put', 'put'] },
  { name: 'stage-import', intent: () => ({ type: 'stage-import', pendingImport: pending('matrix-import') }), operations: puts(2) },
  { name: 'replace-import', setup: async h => { await h.commit({ type: 'stage-import', pendingImport: pending('old'), attemptProvenance: { sourceKeyDigest: 'a'.repeat(64), payloadDigest: 'b'.repeat(64) } }); },
    intent: () => ({ type: 'replace-staged-import', expected: { importId: 'old', targetProjectId: 'old-target', createdAt: pending('old').createdAt,
      sourceKeyDigest: 'a'.repeat(64), payloadDigest: 'b'.repeat(64) }, replacement: { pendingImport: pending('new'),
      attemptProvenance: { sourceKeyDigest: 'a'.repeat(64), payloadDigest: 'c'.repeat(64) } } }), operations: ['delete', 'put', 'put'] },
  { name: 'consume-import', setup: async h => { for (const id of ['first', 'later']) await h.commit({ type: 'stage-import', pendingImport: pending(id) }); },
    intent: () => ({ type: 'consume-import', importId: 'first' }), operations: [...puts(recordCount), 'delete', 'put', 'put'] },
];

describe.each(cases)('workspace rollback fault coverage: $name', scenario => {
  let h: Harness, before: Record<string, any[]>;
  beforeAll(async () => { h = await createWorkspaceCommandHarness(); await scenario.setup?.(h); before = await physicalRows(h, allStores); });
  afterEach(() => { h.environment.workspaceFault = undefined; }); afterAll(() => h?.adapter.close());
  for (const errorName of ['DataCloneError', 'QuotaExceededError', 'AbortError']) {
    it.each(scenario.operations.map((kind, index) => ({ kind, ordinal: index + 1 })))
    (`rolls back every store on ${errorName} at $kind ordinal $ordinal`, async ({ kind, ordinal }) => {
      expect(await physicalRows(h, allStores)).toEqual(before); let fired = false;
      h.environment.workspaceFault = point => {
        if (point.phase === `${errorName === 'DataCloneError' ? 'before' : 'after'}-${kind}` && point.ordinal === ordinal) {
          fired = true; throw new DOMException(`Injected ${errorName} at ${ordinal}`, errorName);
        }
      };
      await expect(h.commit(scenario.intent(h))).rejects.toThrow(); h.environment.workspaceFault = undefined;
      expect(fired).toBe(true); expect(await physicalRows(h, allStores)).toEqual(before);
    });
  }
});

describe.each(cases)('workspace durable failure coverage: $name', scenario => {
  let h: Harness;
  beforeEach(async () => { h = await createWorkspaceCommandHarness(); await scenario.setup?.(h); }); afterEach(() => h?.adapter.close());
  it.each(['after-commit', 'before-readback', 'after-readback', 'corrupt-readback'] as const)
  ('independently proves commit after %s without replay or historical writes', async phase => {
    const source = await physicalRows(h, immutableStores), batch = h.request(scenario.intent(h)); let fired = false;
    if (phase === 'corrupt-readback') h.environment.workspaceReadResult = (operation, value) => {
      if (operation.phase === 'verify-read' && operation.store === 'workspace') { fired = true; return { ...value as object, coreDigest: 'f'.repeat(64) }; }
      return value;
    };
    else h.environment.workspaceFault = point => { if (point.phase === phase) { fired = true; throw Error('Lost workspace result'); } };
    await expect(h.repository.commitWorkspace(h.admission.token, batch)).rejects.toThrow();
    h.environment.workspaceFault = undefined; h.environment.workspaceReadResult = undefined; expect(fired).toBe(true);
    const beforeInspection = await physicalRows(h, allStores), fresh = createNormalizedRepository(h.environment);
    expect(beforeInspection.workspace[0].revision).toBe(batch.expected.revision + 1);
    expect((await fresh.inspectWorkspaceAttempt(batch)).type).toBe('committed');
    expect(await physicalRows(h, allStores)).toEqual(beforeInspection); expect(await physicalRows(h, immutableStores)).toEqual(source);
  });
});
