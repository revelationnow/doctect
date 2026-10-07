// @vitest-environment node
import 'fake-indexeddb/auto';
import { IDBFactory as FakeIDBFactory, IDBObjectStore as FakeObjectStore } from 'fake-indexeddb';
import { expect, it, vi } from 'vitest';
import { validateWorkspaceRecordsWork } from '../../../../services/localWorkspace/migration';
import { createIndexedDbAdapter } from '../../../../services/localWorkspace/indexedDbAdapter';
import { createHistoricalBootstrap } from '../../../../services/localWorkspace/historicalBootstrap';
import { createNormalizationHarness, freshHarness, mutateRow, physicalRows, request, done } from '../../../helpers/normalizationHarness';
import { makeWorkHarness } from '../../../helpers/normalizationWorkHarness';
import { makeIncrementalProject } from '../../../helpers/incrementalFixtures';
import { LEGACY_KEYS, legacySnapshot } from '../../../helpers/localWorkspaceFixtures';
import { digestLegacySnapshot } from '../../../../services/localWorkspace/canonical';
import { testHash } from '../../../helpers/incrementalStoreHarness';
import { decomposeProject } from '../../../../services/localWorkspace/normalized/codec';
import { NORMALIZED_STORE_NAMES, type NormalizedProject, type ProjectStoreName } from '../../../../services/localWorkspace/normalized/schema';
import { deriveWorkspaceIncarnation, workspaceManifestCoreFrame, type NormalizedWorkspaceManifest, type WorkspaceBirthOrigin,
  type WorkspaceMember } from '../../../../services/localWorkspace/normalized/workspaceManifest';
import { appendWorkspaceReceipt, workspaceReceiptFrame } from '../../../../services/localWorkspace/normalized/workspaceCommitProof';
import { createProjectBirthDigests } from '../../../../services/localWorkspace/normalized/projectBaseline';
import { hashFrame } from '../../../../services/localWorkspace/normalized/work';

const projectStores = NORMALIZED_STORE_NAMES.filter((name): name is ProjectStoreName => name !== 'normalizationLedger');
async function currentFixture() {
  const a = makeIncrementalProject(2); const b = { ...makeIncrementalProject(2), id: 'second' };
  const h = await createNormalizationHarness({ legacyValues: { [LEGACY_KEYS.projects]: JSON.stringify([a, b]), [LEGACY_KEYS.activeProject]: a.id } });
  expect((await h.run()).status).toBe('active');
  const physical = await physicalRows(h, [...NORMALIZED_STORE_NAMES, 'workspace']);
  const manifest = physical.workspace[0] as NormalizedWorkspaceManifest;
  const images = manifest.members.map(member => ({ scope: { storageGeneration: manifest.storageGeneration,
    projectId: member.projectId, incarnation: member.incarnation },
    ...Object.fromEntries(NORMALIZED_STORE_NAMES.map(store => [store, store === 'normalizationLedger' ? new Map()
      : new Map(physical[store].filter(row => row.key[1] === member.projectId).map(row => [JSON.stringify(row.key), row]))])) } as NormalizedProject));
  return { ...h, manifest, images, a, b };
}
async function advanceManifest(before: NormalizedWorkspaceManifest, members: readonly WorkspaceMember[], legacyAcceptance = before.legacyAcceptance) {
  const w = makeWorkHarness('reopen'); const next = { ...before, revision: before.revision + 1, members, activeProjectId: members[0].projectId, legacyAcceptance };
  next.coreDigest = await hashFrame(w.runtime, 'proof', workspaceManifestCoreFrame(next));
  const core = { identity: { clientId: 'physical-fixture', commandSequence: next.revision, commandId: `layout-${next.revision}` },
    requestDigest: testHash('synthetic layout, not a workspace command'), before: { revision: before.revision, coreDigest: before.coreDigest },
    after: { revision: next.revision, coreDigest: next.coreDigest }, postconditionDigest: testHash('synthetic postconditions') };
  next.lastCommit = { ...core, proofDigest: await hashFrame(w.runtime, 'proof', workspaceReceiptFrame(core)) };
  next.commitWindow = await appendWorkspaceReceipt(before.commitWindow, next.lastCommit, w.runtime);
  return next;
}
/** Explicit malformed/current-layout fixture seeding, never a runtime lifecycle writer. */
async function seedCurrentLayout(h: { indexedDB: IDBFactory; databaseName: string }, manifest: NormalizedWorkspaceManifest, images: readonly NormalizedProject[]) {
  expect(h.indexedDB).toBeInstanceOf(FakeIDBFactory);
  const db = await request(h.indexedDB.open(h.databaseName));
  try {
    const tx = db.transaction(['workspace', ...projectStores], 'readwrite'); const completion = done(tx);
    for (const store of projectStores) tx.objectStore(store).clear();
    for (const image of images) for (const store of projectStores) for (const row of image[store].values()) tx.objectStore(store).put(row);
    tx.objectStore('workspace').put(manifest); await completion;
  } finally { db.close(); }
}

it('reopens only current members after one migration member was closed', async () => {
  const h = await currentFixture();
  try {
    const retained = await h.repository.readRetainedSource();
    const manifest = await advanceManifest(h.manifest, [h.manifest.members[1]]);
    await seedCurrentLayout(h, manifest, [h.images[1]]);
    const active = await h.repository.readActiveSnapshot();
    expect(active?.snapshot.projects.map(p => p.id)).toEqual([h.b.id]);
    expect(active?.workspace).toEqual(manifest);
    expect((await h.repository.readRetainedSource()).snapshot).toEqual(retained.snapshot);
  } finally { h.adapter.close(); }
});

it('does not resurrect a removed member through previously admitted ordinary writes', async () => {
  const h = await currentFixture();
  try {
    const stamp = await h.repository.bindAdmittedProject(h.images[0]);
    const manifest = await advanceManifest(h.manifest, [h.manifest.members[1]]);
    await seedCurrentLayout(h, manifest, [h.images[1]]);
    await expect(h.repository.commitDocument({ scope: h.images[0].scope, clientId: 'old-owner', commitId: 'stale',
      commitGeneration: 1, editorGeneration: 1, expectedRevision: stamp.documentRevision,
      changes: [{ type: 'put-node', node: { ...h.a.initialState.nodes.root, title: 'Stale' } }] })).rejects.toThrow();
    expect((await physicalRows(h, ['projectHeaders'])).projectHeaders.map(row => row.key[1])).toEqual([h.b.id]);
  } finally { h.adapter.close(); }
});

it('keeps ordinary writes away from workspace manifests and unrelated payload stores', async () => {
  const h = await currentFixture();
  try {
    const image = h.images[0]; const stamp = await h.repository.bindAdmittedProject(image);
    const calls: { store: string; method: string }[] = [];
    const probes = (['get', 'getAll', 'put', 'delete'] as const).map(method => {
      const original = FakeObjectStore.prototype[method];
      return vi.spyOn(FakeObjectStore.prototype, method).mockImplementation(function (this: IDBObjectStore, ...args: unknown[]) {
        calls.push({ store: this.name, method }); return Reflect.apply(original, this, args);
      });
    });
    try {
      await h.repository.commitPreferences({ scope: image.scope, clientId: 'isolation', commitId: 'prefs', commitGeneration: 1,
        editorGeneration: 1, observedPreferenceRevision: stamp.preferenceRevision, patch: { scale: 1.25 } });
      await h.repository.commitDocument({ scope: image.scope, clientId: 'isolation', commitId: 'doc', commitGeneration: 2,
        editorGeneration: 2, expectedRevision: stamp.documentRevision,
        changes: [{ type: 'put-node', node: { ...h.a.initialState.nodes.root, title: 'Changed' } }] });
    } finally { for (const probe of probes) probe.mockRestore(); }
    expect(calls.some(call => ['workspace', 'projects', 'presets', 'pendingImports', 'migrationLedger', 'legacyBackup', 'normalizationLedger'].includes(call.store))).toBe(false);
    expect(calls.some(call => call.method === 'getAll')).toBe(false);
    expect((await physicalRows(h, ['workspace'])).workspace).toEqual([h.manifest]);
    expect(calls.filter(call => call.method === 'put').map(call => call.store).sort()).toEqual(['projectHeaders', 'projectNodes', 'projectPreferences']);
  } finally { h.adapter.close(); }
});

it.each(['missing-header', 'orphan-header', 'wrong-incarnation', 'migration-birth', 'receipt'] as const)(
  'refuses inconsistent current membership: %s', async mutation => {
    const h = await currentFixture();
    try {
      if (mutation === 'missing-header') await mutateRow(h, 'projectHeaders', store => store.delete(h.images[0].projectHeaders.values().next().value!.key));
      if (mutation === 'orphan-header') {
        const header = structuredClone(h.images[0].projectHeaders.values().next().value!);
        header.key[1] = 'orphan'; header.value.id = 'orphan';
        await mutateRow(h, 'projectHeaders', store => store.put(header));
      }
      if (mutation === 'wrong-incarnation') {
        const node = structuredClone(h.images[0].projectNodes.values().next().value!); node.key[2] = 'foreign';
        await mutateRow(h, 'projectNodes', store => store.put(node));
      }
      if (mutation === 'migration-birth' || mutation === 'receipt') {
        const members = structuredClone(h.manifest.members);
        if (mutation === 'migration-birth' && members[0].birth.kind === 'migration') members[0].birth.projectDigest = testHash('forged-source');
        const manifest = await advanceManifest(h.manifest, members);
        if (mutation === 'receipt') manifest.lastCommit!.requestDigest = testHash('forged-request');
        await mutateRow(h, 'workspace', store => store.put(manifest));
      }
      await expect(h.repository.readActiveSnapshot()).rejects.toThrow();
    } finally { h.adapter.close(); }
  });

it('keeps retained source anchored while current acceptance references a later backup', async () => {
  const h = await currentFixture();
  try {
    const retained = await h.repository.readRetainedSource();
    const backup = { ...h.prepared.backup, id: 'later-conflict', kind: 'conflict' as const };
    const manifest = await advanceManifest(h.manifest, h.manifest.members,
      { kind: 'accepted', backupId: backup.id, digest: backup.digest });
    await mutateRow(h, 'legacyBackup', store => store.put(backup));
    await seedCurrentLayout(h, manifest, h.images);
    expect((await h.repository.readActiveSnapshot())?.workspace).toEqual(manifest);
    expect((await h.repository.readRetainedSource()).sourceDigest).toBe(retained.sourceDigest);
    await mutateRow(h, 'legacyBackup', store => store.put({ ...backup, digest: testHash('wrong') }));
    await expect(h.repository.readActiveSnapshot()).rejects.toThrow();
    expect((await h.repository.readRetainedSource()).sourceDigest).toBe(retained.sourceDigest);
  } finally { h.adapter.close(); }
});

it.each(['targetProjectId', 'createdAt', 'pendingImportDigest', 'attemptProvenance'] as const)(
  'rejects a rehashed import descriptor with false %s', async field => {
    const h = await createNormalizationHarness();
    try {
      expect((await h.run()).status).toBe('active');
      const original = (await h.repository.readActiveSnapshot())!.workspace;
      const descriptor = { ...original.pendingImports[0] };
      if (field === 'targetProjectId') descriptor.targetProjectId = 'invented-target';
      if (field === 'createdAt') descriptor.createdAt = '2026-09-26T00:00:00.000Z';
      if (field === 'pendingImportDigest') descriptor.pendingImportDigest = testHash('invented');
      if (field === 'attemptProvenance') descriptor.attemptProvenance = { sourceKeyDigest: testHash('a'), payloadDigest: testHash('b'), pendingImportDigest: testHash('c') };
      const forged = await advanceManifest({ ...original, pendingImports: [descriptor] }, original.members);
      await mutateRow(h, 'workspace', store => store.put(forged));
      await expect(h.repository.readActiveSnapshot()).rejects.toThrow();
    } finally { h.adapter.close(); }
  });

it.each(['bigint', 'cycle'] as const)('retained export ignores an unused later backup containing %s', async kind => {
  const h = freshHarness();
  try {
    expect((await h.run()).status).toBe('active'); const before = await h.repository.readRetainedSource();
    const snapshot: Record<string, unknown> = {}; snapshot.value = kind === 'bigint' ? 1n : snapshot;
    await mutateRow(h, 'legacyBackup', store => store.put({ id: 'unused-later', kind: 'conflict', capturedAt: h.preparation.now(), snapshot, digest: testHash('invalid') }));
    expect((await h.repository.readRetainedSource()).snapshot).toEqual(before.snapshot);
    await expect(h.repository.readActiveSnapshot()).rejects.toThrow();
  } finally { h.adapter.close(); }
});

async function bornFixture(recreate = false) {
  const h = await currentFixture(); const w = makeWorkHarness('reopen');
  try {
    const project = { ...makeIncrementalProject(2), id: recreate ? h.a.id : 'new-member' };
    Reflect.set(project.initialState.variants.default.templates['page-0'].layers![0], 'collapsed', 'legacy-fold');
    const scope = { storageGeneration: h.manifest.storageGeneration, projectId: project.id,
      incarnation: await deriveWorkspaceIncarnation(h.manifest.storageGeneration, h.manifest.revision + 1, 0, w.runtime) };
    const image = decomposeProject(project, scope);
    const origin: WorkspaceBirthOrigin = { kind: 'workspace-command', identity: { clientId: 'physical-fixture', commandId: 'new-birth', commandSequence: 1 },
      requestDigest: testHash('new birth'), workspaceRevision: h.manifest.revision + 1, memberOrdinal: 0, createdAt: h.preparation.now(),
      authority: { documentRevision: 0, preferenceRevision: 0, foldStructureGeneration: 0 } };
    image.projectHeaders.values().next().value!.workspaceBirth = origin;
    const member: WorkspaceMember = { projectId: project.id, incarnation: scope.incarnation, consumedImport: {},
      birth: { ...origin, digests: await createProjectBirthDigests(image, w.runtime) } };
    const manifest = await advanceManifest(h.manifest, [member, h.manifest.members[1]]);
    await seedCurrentLayout(h, manifest, [image, h.images[1]]);
    return { ...h, manifest, image, scope, origin, project, member };
  } catch (error) { h.adapter.close(); throw error; }
}

it.each([false, true])('admits a workspace-born current member (recreate=%s) from durable birth evidence', async recreate => {
  const h = await bornFixture(recreate); const { image, scope, origin, project } = h;
  try {
    expect((await h.repository.readActiveSnapshot())?.snapshot.projects.map(p => p.id)).toEqual([project.id, h.b.id]);
    await expect(h.repository.bindAdmittedProject(image)).resolves.toEqual(origin.authority);
    await h.repository.commitPreferences({ scope, clientId: 'new-owner', commitId: 'pref-1', commitGeneration: 1,
      editorGeneration: 1, observedPreferenceRevision: 0, patch: { scale: 1.25 } });
    expect((await h.repository.readActiveSnapshot())?.snapshot.projects[0].initialState.scale).toBe(1.25);
  } finally { h.adapter.close(); }
});

it('rejects a current header birth that differs from its independently read membership', async () => {
  const h = await bornFixture();
  try {
    const header = structuredClone(h.image.projectHeaders.values().next().value!);
    header.workspaceBirth!.requestDigest = testHash('different-origin');
    await mutateRow(h, 'projectHeaders', store => store.put(header));
    await expect(h.repository.readActiveSnapshot()).rejects.toThrow(/Workspace birth identity mismatch/);
  } finally { h.adapter.close(); }
});

it.each(['document', 'preferences', 'folds'] as const)('workspace-born opposite-lane baseline rejects valid-size %s corruption', async part => {
  const h = await bornFixture();
  try {
    await h.repository.bindAdmittedProject(h.image);
    if (part === 'document') await h.repository.commitPreferences({ scope: h.scope, clientId: 'owner', commitId: 'pref',
      commitGeneration: 1, editorGeneration: 1, observedPreferenceRevision: 0, patch: { scale: 1.25 } });
    else await h.repository.commitDocument({ scope: h.scope, clientId: 'owner', commitId: 'doc', commitGeneration: 1,
      editorGeneration: 1, expectedRevision: 0, changes: [{ type: 'put-node', node: { ...h.project.initialState.nodes.root, title: 'Edited' } }] });
    const rows = await physicalRows(h);
    const store = part === 'document' ? 'projectNodes' : part === 'preferences' ? 'projectPreferences' : 'projectExtensions';
    const row = rows[store].find(item => item.key[1] === h.scope.projectId && (part !== 'folds' || item.key[3] === 'folds'));
    if (part === 'document') row.value.title = `X${row.value.title.slice(1)}`;
    if (part === 'preferences') row.value.selectedNodeId = 'xxxx';
    if (part === 'folds') {
      const before = JSON.stringify(row.value); expect(before).toContain('legacy-fold');
      row.value = JSON.parse(before.replace('legacy-fold', 'legacy-f0ld'));
    }
    await mutateRow(h, store, target => target.put(row));
    await expect(h.repository.readActiveSnapshot()).rejects.toThrow(part === 'document' ? /Workspace document baseline/
      : part === 'preferences' ? /Workspace preference baseline/ : /Workspace fold baseline/);
  } finally { h.adapter.close(); }
});

it('retains workspace-born baselines after creation receipt eviction', async () => {
  const h = await bornFixture();
  try {
    let manifest = h.manifest;
    for (let i = 0; i < 33; i++) manifest = await advanceManifest(manifest, manifest.members);
    expect(manifest.commitWindow.floorRevision).toBeGreaterThan(h.origin.workspaceRevision);
    await mutateRow(h, 'workspace', store => store.put(manifest));
    expect((await h.repository.readActiveSnapshot())?.snapshot.projects[0]).toEqual(h.project);
  } finally { h.adapter.close(); }
});

it('publishes fresh-origin current acceptance after genuinely different legacy capture and refuses later drift', async () => {
  const h = freshHarness();
  try {
    expect((await h.run()).status).toBe('active');
    const retained = await h.repository.readRetainedSource();
    const before = (await h.repository.readActiveSnapshot())!.workspace;
    const project = makeIncrementalProject(1);
    const values = { [LEGACY_KEYS.projects]: JSON.stringify([project]), [LEGACY_KEYS.activeProject]: project.id };
    const snapshot = legacySnapshot(values); const digest = await digestLegacySnapshot(snapshot, h.preparation.crypto.subtle);
    const backup = { id: 'accepted-after-fresh', kind: 'conflict' as const, capturedAt: h.preparation.now(), snapshot, digest };
    const manifest = await advanceManifest(before, before.members, { kind: 'accepted', backupId: backup.id, digest });
    await mutateRow(h, 'legacyBackup', store => store.put(backup));
    await mutateRow(h, 'workspace', store => store.put(manifest));
    for (const [key, value] of Object.entries(values)) h.legacyStorage.seed(key, value);
    expect((await h.run()).status).toBe('active');
    expect((await h.repository.readRetainedSource()).sourceDigest).toBe(retained.sourceDigest);
    h.legacyStorage.seed(LEGACY_KEYS.activeProject, 'changed');
    expect((await h.run()).status).toBe('recovery');
  } finally { h.adapter.close(); }
});

it('keeps normalized tagged values out of historical workspace validation', async () => {
  const h = await createNormalizationHarness(); const w = makeWorkHarness('prepare');
  try {
    const records = { projects: h.prepared.projects, workspace: h.prepared.workspace,
      presets: h.prepared.presets, pendingImports: h.prepared.pendingImports };
    await expect(w.runtime.run(validateWorkspaceRecordsWork(records))).resolves.toMatchObject({ workspace: h.prepared.workspace });
    await expect(w.runtime.run(validateWorkspaceRecordsWork({ ...records,
      workspace: { ...records.workspace, kind: 'normalized-workspace' } }))).rejects.toThrow();
  } finally { h.adapter.close(); }
});

it.each(['fresh', 'historical'] as const)('activates marker and current manifest together for %s', async kind => {
  const h = kind === 'fresh' ? freshHarness() : await createNormalizationHarness();
  try {
    const result = await h.run(); expect(result.status).toBe('active');
    const rows = await physicalRows(h, ['workspace', 'normalizationLedger']);
    expect(rows.workspace).toHaveLength(1); expect(rows.normalizationLedger).toHaveLength(1);
    const manifest = rows.workspace[0]; const marker = rows.normalizationLedger[0];
    expect(manifest).toMatchObject({ id: 'current', kind: 'normalized-workspace', formatVersion: 3, manifestVersion: 1, lastCommit: null });
    expect(marker).toMatchObject({ state: 'active', workspaceManifestVersion: 1, initialWorkspaceDigest: manifest.coreDigest });
    expect(manifest.storageGeneration).toBe(marker.storageGeneration);
    expect(manifest.members.map((member: { projectId: string; incarnation: string }) => [member.projectId, member.incarnation]))
      .toEqual(marker.sourceProjects.map((member: { projectId: string; incarnation: string }) => [member.projectId, member.incarnation]));
    expect(result).toMatchObject({ workspace: manifest });
  } finally { h.adapter.close(); }
});

for (const kind of ['fresh', 'historical'] as const) it.each([
  'cutover.before-workspace', 'cutover.after-workspace', 'cutover.before-marker', 'cutover.after-marker', 'cutover.before-complete',
] as const)(`${kind} activation rolls back both records at %s`, async fault => {
  const h = kind === 'fresh' ? freshHarness() : await createNormalizationHarness(); let reached = false;
  try {
    h.environment.normalizationFault = point => { if (point === fault) { reached = true; throw new Error(fault); } };
    expect((await h.run()).status).toBe('recovery'); expect(reached).toBe(true);
    const rows = await physicalRows(h, ['workspace', 'normalizationLedger']);
    expect(rows.normalizationLedger[0].state).toBe('verified');
    if (kind === 'fresh') expect(rows.workspace).toEqual([]);
    else expect(rows.workspace[0]).toMatchObject({ id: 'current', projectOrder: expect.any(Array) });
    expect(rows.workspace.some(row => row.kind === 'normalized-workspace')).toBe(false);
  } finally { h.adapter.close(); }
});

it('resolves a lost activation acknowledgement from both durable records on a fresh owner', async () => {
  const h = freshHarness();
  try {
    h.environment.normalizationFault = point => { if (point === 'cutover.after-commit') throw new Error('lost ack'); };
    expect((await h.run()).status).toBe('recovery');
    const committed = await physicalRows(h, ['workspace', 'normalizationLedger']);
    expect(committed.workspace[0].kind).toBe('normalized-workspace'); expect(committed.normalizationLedger[0].state).toBe('active');
    h.environment.normalizationFault = undefined;
    expect((await h.run()).status).toBe('active');
    expect(await physicalRows(h, ['workspace', 'normalizationLedger'])).toEqual(committed);
  } finally { h.adapter.close(); }
});

it('refuses an active marker without its manifest while retaining source export', async () => {
  const h = freshHarness();
  try {
    expect((await h.run()).status).toBe('active');
    const source = await h.repository.readRetainedSource();
    await mutateRow(h, 'workspace', store => store.delete('current'));
    await expect(h.repository.readActiveSnapshot()).rejects.toThrow();
    expect((await h.repository.readRetainedSource()).snapshot).toEqual(source.snapshot);
  } finally { h.adapter.close(); }
});

it('exports retained source with a corrupt target verification digest without granting active authority', async () => {
  const h = freshHarness();
  try {
    expect((await h.run()).status).toBe('active');
    const source = await h.repository.readRetainedSource();
    const marker = (await physicalRows(h, ['normalizationLedger'])).normalizationLedger[0];
    const damaged = { ...marker, verificationDigest: '0'.repeat(64) };
    await mutateRow(h, 'normalizationLedger', store => store.put(damaged));
    await expect(h.repository.readActiveSnapshot()).rejects.toThrow('Invalid normalization verification');
    expect((await h.repository.readRetainedSource()).sourceDigest).toBe(source.sourceDigest);
    expect((await h.run()).status).toBe('recovery');
    expect((await physicalRows(h, ['normalizationLedger'])).normalizationLedger).toEqual([damaged]);
  } finally { h.adapter.close(); }
});

it('refuses a tagged workspace appearing after historical admission without overwriting it', async () => {
  const h = await createNormalizationHarness();
  const adapter = createIndexedDbAdapter({ indexedDB: h.indexedDB, now: h.preparation.now });
  const historical = createHistoricalBootstrap({ ...h.preparation, adapter: () => adapter,
    legacyStorage: h.legacyStorage, generation: () => 0 });
  try {
    await adapter.open();
    expect((await historical.bootstrap(() => {}, { allowCopiedReplacement: false })).status).toBe('admitted');
    const tagged = { id: 'current', kind: 'normalized-workspace', revision: h.prepared.workspace.revision };
    await mutateRow(h, 'workspace', store => store.put(tagged));
    await expect(adapter.saveWorkspace(h.prepared.workspace, h.prepared.workspace.revision)).rejects.toMatchObject({ code: 'conflict' });
    expect((await physicalRows(h, ['workspace'])).workspace).toEqual([tagged]);
  } finally { adapter.close(); h.adapter.close(); }
});
