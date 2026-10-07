// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createWorkspaceCommandHarness } from '../../../helpers/workspaceCommandHarness';
import { physicalRows, mutateRow, freshHarness } from '../../../helpers/normalizationHarness';
import { legacySnapshot, LEGACY_KEYS } from '../../../helpers/localWorkspaceFixtures';
import { digestLegacySnapshot } from '../../../../services/localWorkspace/canonical';
import { createNormalizedRepository } from '../../../../services/localWorkspace/normalized/repository';
import { NORMALIZED_STORE_NAMES } from '../../../../services/localWorkspace/normalized/schema';
import type { WorkspaceBatch } from '../../../../services/localWorkspace/normalized/workspaceCommands';
import { workspaceSnapshot } from '../../../helpers/localWorkspaceFixtures';

let h: Awaited<ReturnType<typeof createWorkspaceCommandHarness>>,
  batch: WorkspaceBatch & { intent: Extract<WorkspaceBatch['intent'], { type: 'recover-legacy-as-copies' }> };
const allStores = [...NORMALIZED_STORE_NAMES, 'workspace', 'presets', 'pendingImports', 'projects', 'migrationLedger', 'legacyBackup'];
beforeEach(async () => {
  h = await createWorkspaceCommandHarness();
  const changed = structuredClone(h.a); changed.name = 'Legacy changed'; changed.initialState.nodes.root.title = 'Legacy changed';
  const source = legacySnapshot({ [LEGACY_KEYS.projects]: JSON.stringify([changed, h.b]), [LEGACY_KEYS.activeProject]: h.b.id });
  batch = { storageGeneration: h.catalog().storageGeneration, expected: h.catalog().stamp, targets: [],
    identity: { clientId: 'recovery-test', commandId: 'copy-1', commandSequence: 1 },
    intent: { type: 'recover-legacy-as-copies', recoveryId: 'drift-1', source, sourceDigest: await digestLegacySnapshot(source) } };
});
afterEach(() => h?.adapter.close());

it('recovers changed projects as new normalized members without overwriting current or historical data', async () => {
  expect(h.repository.prepareWorkspaceRecovery).toBeTypeOf('function');
  const before = await physicalRows(h, allStores);
  const prepared = await h.repository.prepareWorkspaceRecovery(h.admission.token, batch);
  expect(prepared.counts).toEqual({ projects: 1, presets: 0, pendingImports: 0 });
  expect(await physicalRows(h, allStores)).toEqual(before);
  const result = await h.repository.commitWorkspaceRecovery(h.admission.token, prepared.token);
  expect(result.outcome).toBe('recovered'); expect(result.projects).toHaveLength(1);
  expect(result.delta.removed).toEqual([]); expect(result.delta.activeProjectId).toBe(h.a.id);
  const after = await physicalRows(h, allStores);
  for (const store of NORMALIZED_STORE_NAMES) expect(after[store].filter(row => !row.key || row.key[1] === h.a.id || row.key[1] === h.b.id)).toEqual(before[store]);
  expect(after.projects).toEqual(before.projects); expect(after.migrationLedger).toEqual(before.migrationLedger);
  expect(after.legacyBackup.filter(row => before.legacyBackup.some(old => old.id === row.id))).toEqual(before.legacyBackup);
  expect(after.legacyBackup).toHaveLength(before.legacyBackup.length + 1);
  const fresh = createNormalizedRepository(h.environment), active = await fresh.readActiveSnapshot();
  expect(active!.snapshot.projects.slice(0, 2)).toEqual([h.a, h.b]);
  expect(active!.snapshot.projects[2]).toMatchObject({ name: 'Recovered — Legacy changed', initialState: { nodes: { root: { title: 'Legacy changed' } } } });
  expect(active!.workspace.legacyAcceptance).toMatchObject({ kind: 'accepted', digest: batch.intent.sourceDigest });
  expect(await fresh.inspectWorkspaceAttempt(batch)).toMatchObject({ type: 'committed', result: { outcome: 'recovered', receipt: result.receipt } });
});

it('refuses invalid current normalized data even when the old workspace admission remains available', async () => {
  expect(h.repository.prepareWorkspaceRecovery).toBeTypeOf('function');
  const row = (await physicalRows(h, ['projectNodes'])).projectNodes[0]; row.value.title = 'Corrupted';
  await mutateRow(h, 'projectNodes', store => store.put(row)); const before = await physicalRows(h, allStores);
  await expect(h.repository.prepareWorkspaceRecovery(h.admission.token, batch)).rejects.toThrow();
  expect(await physicalRows(h, allStores)).toEqual(before);
});

it('requires the separate recovery capability, not an ordinary workspace command or fabricated token', async () => {
  expect(h.repository.prepareWorkspaceRecovery).toBeTypeOf('function');
  const before = await physicalRows(h, allStores);
  await expect(h.repository.commitWorkspace(h.admission.token, batch)).rejects.toThrow();
  await expect(h.repository.commitWorkspaceRecovery(h.admission.token, {} as never)).rejects.toThrow();
  expect(await physicalRows(h, allStores)).toEqual(before);
});

it.each(['digest', 'malformed-digest', 'kind', 'archive-kind', 'missing'] as const)('inspection reports corrupt accepted backup (%s) as a verification conflict, not an unavailable outcome', async change => {
  const prepared = await h.repository.prepareWorkspaceRecovery(h.admission.token, batch);
  await h.repository.commitWorkspaceRecovery(h.admission.token, prepared.token);
  const backup = (await physicalRows(h, ['legacyBackup'])).legacyBackup.find(row => row.kind === 'conflict');
  if (change === 'kind' || change === 'archive-kind') backup.kind = change === 'kind' ? 'unknown' : 'normalization-source';
  else backup.digest = change === 'malformed-digest' ? 'malformed' : '0'.repeat(64);
  await mutateRow(h, 'legacyBackup', store => { if (change === 'missing') store.delete(backup.id); else store.put(backup); });
  expect(await createNormalizedRepository(h.environment).inspectWorkspaceAttempt(batch)).toEqual({ type: 'conflict', reason: 'verification-failed' });
});

it('rejects source entry accessors before capture can evaluate them', async () => {
  let reads = 0;
  Object.defineProperty(batch.intent.source[LEGACY_KEYS.projects], 'raw', { enumerable: true, get() { reads++; return '[]'; } });
  await expect(h.repository.prepareWorkspaceRecovery(h.admission.token, batch)).rejects.toThrow(); expect(reads).toBe(0);
});

it('recovers presets and pending imports alongside projects without replacing existing ancillary data', async () => {
  const snapshot = workspaceSnapshot();
  await h.commit({ type: 'save-custom-preset', preset: snapshot.customPresets[0] });
  const { warnings: _warnings, ...input } = snapshot.pendingImports[0];
  await h.commit({ type: 'stage-import', pendingImport: input });
  batch = { ...batch, expected: h.catalog().stamp };
  const before = await physicalRows(h, ['presets', 'pendingImports']);
  batch.intent.source[LEGACY_KEYS.customPresets] = { present: true, raw: JSON.stringify([{ ...snapshot.customPresets[0], title: 'Legacy preset' }]) };
  batch.intent.source[LEGACY_KEYS.pendingImport] = { present: true, raw: JSON.stringify({ name: 'Legacy import', state: h.a.initialState, cloud: { projectId: 'cloud', lastSyncedCommitId: 'commit' } }) };
  batch.intent = { ...batch.intent, sourceDigest: await digestLegacySnapshot(batch.intent.source) };
  const prepared = await h.repository.prepareWorkspaceRecovery(h.admission.token, batch);
  expect(prepared.counts).toEqual({ projects: 1, presets: 1, pendingImports: 1 });
  await h.repository.commitWorkspaceRecovery(h.admission.token, prepared.token);
  const after = await physicalRows(h, ['presets', 'pendingImports']);
  for (const store of ['presets', 'pendingImports']) {
    expect(after[store]).toHaveLength(2); expect(after[store].find(row => row.id === before[store][0].id)).toEqual(before[store][0]);
  }
  expect(after.pendingImports.find(row => row.id !== before.pendingImports[0].id).pendingImport.cloud).toBeUndefined();
});

it('full capture CAS refuses a competing workspace command after recovery preparation', async () => {
  const prepared = await h.repository.prepareWorkspaceRecovery(h.admission.token, batch);
  const other = createNormalizedRepository(h.environment), admission = await other.admitWorkspace();
  const request = h.request({ type: 'activate-project', projectId: h.b.id });
  await other.commitWorkspace(admission.token, request); const before = await physicalRows(h, allStores);
  await expect(h.repository.commitWorkspaceRecovery(h.admission.token, prepared.token)).rejects.toThrow();
  expect(await physicalRows(h, allStores)).toEqual(before);
});

it('superseded and explicitly discarded preparations cannot be consumed', async () => {
  const one = h.repository.prepareWorkspaceRecovery(h.admission.token, batch);
  const two = h.repository.prepareWorkspaceRecovery(h.admission.token, { ...batch, identity: { ...batch.identity, commandId: 'copy-2' } });
  const [first, second] = await Promise.all([one, two]);
  await expect(h.repository.commitWorkspaceRecovery(h.admission.token, first.token)).rejects.toThrow();
  h.repository.discardWorkspaceRecovery(second.token);
  await expect(h.repository.commitWorkspaceRecovery(h.admission.token, second.token)).rejects.toThrow();
  expect((await physicalRows(h, ['workspace'])).workspace[0].revision).toBe(batch.expected.revision);
});

it.each(['before-cas', 'after-cas', 'before-complete', 'after-commit', 'before-readback', 'after-readback'] as const)(
  'recovery at %s has independently provable atomic outcome', async phase => {
    const before = await physicalRows(h, allStores), prepared = await h.repository.prepareWorkspaceRecovery(h.admission.token, batch);
    let fired = false; h.environment.workspaceFault = point => { if (point.phase === phase) { fired = true; throw Error('injected'); } };
    await expect(h.repository.commitWorkspaceRecovery(h.admission.token, prepared.token)).rejects.toThrow('injected');
    expect(fired).toBe(true); h.environment.workspaceFault = undefined;
    const committed = ['after-commit', 'before-readback', 'after-readback'].includes(phase);
    if (!committed) expect(await physicalRows(h, allStores)).toEqual(before);
    const fence = await h.repository.fenceWorkspace(h.admission.token);
    expect(await h.repository.inspectWorkspaceAttempt(batch, fence)).toMatchObject({ type: committed ? 'committed' : 'not-committed' });
    if (!committed) expect(await createNormalizedRepository(h.environment).inspectWorkspaceAttempt(batch)).toEqual({ type: 'unknown' });
  });

it('later workspace advancement prevents publishing an old recovery receipt', async () => {
  const prepared = await h.repository.prepareWorkspaceRecovery(h.admission.token, batch);
  await h.repository.commitWorkspaceRecovery(h.admission.token, prepared.token);
  const admission = await h.repository.admitWorkspace();
  await h.repository.commitWorkspace(admission.token, { ...h.request({ type: 'activate-project', projectId: h.b.id }), expected: admission.catalog.stamp });
  expect(await h.repository.inspectWorkspaceAttempt(batch)).toMatchObject({ type: 'conflict', reason: 'authority-changed' });
});

it('stale recovery ID and unchanged accepted source require new confirmation', async () => {
  const prepared = await h.repository.prepareWorkspaceRecovery(h.admission.token, batch);
  await h.repository.commitWorkspaceRecovery(h.admission.token, prepared.token);
  const admission = await h.repository.admitWorkspace();
  const next = { ...batch, expected: admission.catalog.stamp, identity: { ...batch.identity, commandId: 'copy-2' } };
  await expect(h.repository.prepareWorkspaceRecovery(admission.token, next)).rejects.toThrow('already been used');
  await expect(h.repository.prepareWorkspaceRecovery(admission.token, { ...next, intent: { ...next.intent, recoveryId: 'drift-2' } })).rejects.toThrow('changed legacy source');
});

it('recovered members support ordinary document and preference writes and independent reopen', async () => {
  const prepared = await h.repository.prepareWorkspaceRecovery(h.admission.token, batch);
  const result = await h.repository.commitWorkspaceRecovery(h.admission.token, prepared.token), created = result.projects[0];
  await h.repository.bindAdmittedProject(created.records);
  await h.repository.commitDocument({ scope: created.scope, clientId: 'edit', commitId: 'edit', commitGeneration: 1, editorGeneration: 1,
    expectedRevision: 0, changes: [{ type: 'put-node', node: { ...h.a.initialState.nodes.root, title: 'After recovery' } }] });
  await h.repository.commitPreferences({ scope: created.scope, clientId: 'edit', commitId: 'pref', commitGeneration: 2, editorGeneration: 2,
    observedPreferenceRevision: 0, patch: { scale: 2 } });
  const active = await createNormalizedRepository(h.environment).readActiveSnapshot();
  expect(active!.snapshot.projects.at(-1)!.initialState).toMatchObject({ scale: 2, nodes: { root: { title: 'After recovery' } } });
  expect(await h.repository.inspectWorkspaceAttempt(batch)).toMatchObject({ type: 'conflict', reason: 'authority-changed' });
});

it('fresh normalized workspaces accept drift without fabricating a historical migration ledger', async () => {
  const fresh = freshHarness();
  try {
    expect((await fresh.run()).status).toBe('active');
    const repository = createNormalizedRepository(fresh.environment), admission = await repository.admitWorkspace();
    const input = { ...batch, storageGeneration: admission.catalog.storageGeneration, expected: admission.catalog.stamp };
    const before = await physicalRows(fresh, ['projects', 'migrationLedger', 'legacyBackup']);
    const prepared = await repository.prepareWorkspaceRecovery(admission.token, input);
    expect(prepared.counts.projects).toBe(2); await repository.commitWorkspaceRecovery(admission.token, prepared.token);
    const after = await physicalRows(fresh, ['projects', 'migrationLedger', 'legacyBackup']);
    expect(after.projects).toEqual([]); expect(after.migrationLedger).toEqual([]);
    expect(after.legacyBackup.filter(row => row.kind === 'normalization-source')).toEqual(before.legacyBackup);
    expect((await repository.readActiveSnapshot())!.workspace.legacyAcceptance).toMatchObject({ kind: 'accepted', digest: batch.intent.sourceDigest });
  } finally { fresh.adapter.close(); }
});
