// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import * as codec from '../../../../services/localWorkspace/normalized/codec';
import * as manifests from '../../../../services/localWorkspace/normalized/workspaceManifest';
import { createNormalizedRepository } from '../../../../services/localWorkspace/normalized/repository';
import { NORMALIZED_STORE_NAMES, type NormalizationAttempt } from '../../../../services/localWorkspace/normalized/schema';
import { createNormalizationHarness, freshHarness, historicalStores, mutateRow, physicalRows } from '../../../helpers/normalizationHarness';
import { makeWorkHarness } from '../../../helpers/normalizationWorkHarness';

afterEach(() => vi.restoreAllMocks());
const allStores = [...historicalStores, ...NORMALIZED_STORE_NAMES];
type Phase = 'unreserved' | 'staging' | 'staged' | 'verified' | 'active';
async function fixture(phase: Phase = 'unreserved', fresh = false) {
  const h = fresh ? freshHarness() : await createNormalizationHarness();
  await h.adapter.open();
  if (!fresh) expect((await h.historical.bootstrap(() => {}, { allowCopiedReplacement: false })).status).toBe('admitted');
  const repository = createNormalizedRepository(h.environment);
  const preparation = makeWorkHarness(); const session = repository.openNormalizationSession(preparation.runtime);
  let attempt: NormalizationAttempt | undefined;
  try {
    if (phase !== 'unreserved') {
      await session.prepare(); attempt = await session.reserve();
      if (phase !== 'staging') {
        while (attempt.nextRecord < attempt.recordCount) attempt = await session.stageNext();
        if (phase !== 'staged') attempt = await session.verify();
        if (phase === 'active') attempt = await session.activate();
      }
    }
  } catch (error) { h.adapter.close(); throw error; }
  finally { session.dispose(); }
  return { ...h, repository, attempt: attempt! };
}
function targetSpies() {
  return [vi.spyOn(codec, 'createTargetCursor'), vi.spyOn(manifests, 'createInitialWorkspaceManifest'),
    vi.spyOn(manifests, 'validateWorkspaceManifestWork')];
}

it.each(['unreserved', 'staging', 'verified', 'active'] as const)
('retained source validates and seals without target work at %s', async phase => {
  const h = await fixture(phase); const expected = await h.repository.readNormalizationSource();
  const spies = targetSpies(); const w = makeWorkHarness('retained');
  try {
    const source = await h.repository.readRetainedSource(w.runtime);
    expect(source).toEqual(expected);
    expect(w.runtime.snapshot().sourceDerivations).toBe(1);
    expect(w.runtime.snapshot().targetDerivations).toBe(0);
    expect(w.runtime.snapshot().sealTransactions).toBe(1);
    expect(w.runtime.snapshot().ownedBytes).toBe(0);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally { h.adapter.close(); }
});

it('strict source adapter also avoids target and current-manifest derivation', async () => {
  const h = await fixture('staging'); const expected = await h.repository.readRetainedSource(); const spies = targetSpies();
  try {
    expect(await h.repository.readNormalizationSource()).toEqual(expected);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally { h.adapter.close(); }
});

it.each(['targetManifestDigest', 'initialWorkspaceDigest', 'recordCount'] as const)
('source-only result cannot reserve through corrupt target %s', async field => {
  const h = await fixture('staging');
  try {
    const source = await h.repository.readRetainedSource();
    const bad = { ...h.attempt, [field]: field === 'recordCount' ? h.attempt.recordCount + 1 : 'f'.repeat(64) };
    await mutateRow(h, 'normalizationLedger', store => store.put(bad));
    const before = await physicalRows(h, allStores);
    expect(await h.repository.readRetainedSource()).toEqual(source);
    await expect(h.repository.reserveNormalization(source)).rejects.toThrow('Normalization source mismatch');
    await expect(h.repository.stageNormalization(bad, codec.prepareNormalizationTarget(source).slice(0, 1)))
      .rejects.toThrow('Normalization source mismatch');
    expect(await physicalRows(h, allStores)).toEqual(before);
  } finally { h.adapter.close(); }
});

it.each(['verified', 'active'] as const)('source-only read ignores wrong target verification at %s without granting target authority', async phase => {
  const h = await fixture(phase);
  try {
    const source = await h.repository.readRetainedSource();
    const bad = { ...h.attempt, verificationDigest: 'f'.repeat(64) };
    await mutateRow(h, 'normalizationLedger', store => store.put(bad));
    const before = await physicalRows(h, allStores);
    expect(await h.repository.readRetainedSource()).toEqual(source);
    if (phase === 'verified') await expect(h.repository.activateNormalization(bad)).rejects.toThrow('Invalid normalization verification');
    else await expect(h.repository.readActiveSnapshot()).rejects.toThrow('Invalid normalization verification');
    expect(await physicalRows(h, allStores)).toEqual(before);
  } finally { h.adapter.close(); }
});

it('source-only result cannot verify a completed prefix through corrupt target evidence', async () => {
  const h = await fixture('staged');
  try {
    const source = await h.repository.readRetainedSource();
    const bad = { ...h.attempt, targetManifestDigest: 'f'.repeat(64) };
    await mutateRow(h, 'normalizationLedger', store => store.put(bad));
    const before = await physicalRows(h, allStores);
    expect(await h.repository.readRetainedSource()).toEqual(source);
    await expect(h.repository.markNormalizationVerified(bad, source.contentDigest)).rejects.toThrow('Normalization source mismatch');
    expect(await physicalRows(h, allStores)).toEqual(before);
  } finally { h.adapter.close(); }
});

it.each(['sourceDigest', 'contentDigest', 'sourceArchiveDigest', 'sourceArchiveId', 'sourceWorkspaceRevision',
  'sourceLedgerRevision', 'attemptId', 'storageGeneration', 'projectRevision', 'projectIdentity'] as const)
('source-only read still refuses altered source evidence %s', async field => {
  const h = await fixture('staging'); const w = makeWorkHarness('retained');
  try {
    const bad = structuredClone(h.attempt);
    if (field === 'projectRevision') bad.sourceProjects[0].revision++;
    else if (field === 'projectIdentity') bad.sourceProjects[0].incarnation = 'different';
    else if (field === 'sourceWorkspaceRevision' || field === 'sourceLedgerRevision') bad[field]!++;
    else bad[field] = field.endsWith('Digest') ? 'f'.repeat(64) : 'different';
    await mutateRow(h, 'normalizationLedger', store => store.put(bad));
    const before = await physicalRows(h, allStores); const spies = targetSpies();
    await expect(h.repository.readRetainedSource(w.runtime)).rejects.toThrow();
    expect(w.runtime.snapshot().ownedBytes).toBe(0);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(await physicalRows(h, allStores)).toEqual(before);
  } finally { h.adapter.close(); }
});

it.each([{ formatVersion: 4 }, { workspaceManifestVersion: 2 }, { targetManifestDigest: 'not-a-digest' },
  { nextRecord: 1, progressRevision: 0 }, { verificationDigest: 'f'.repeat(64) }])
('source-only read rejects malformed target metadata %j before trusting its archive', async fields => {
  const h = await fixture('staging'); const w = makeWorkHarness('retained');
  try {
    await mutateRow(h, 'normalizationLedger', store => store.put({ ...h.attempt, ...fields }));
    const before = await physicalRows(h, allStores);
    await expect(h.repository.readRetainedSource(w.runtime)).rejects.toThrow();
    expect(w.runtime.snapshot().sourceDerivations).toBe(0);
    expect(w.runtime.snapshot().sealTransactions).toBe(0);
    expect(w.runtime.snapshot().ownedBytes).toBe(0);
    expect(await physicalRows(h, allStores)).toEqual(before);
  } finally { h.adapter.close(); }
});

it.each(['archive', 'referenced-backup', 'project'] as const)('source-only seal refuses late %s mutation', async target => {
  const h = await fixture('staging'); const w = makeWorkHarness('retained'); let fired = false;
  let changed: Awaited<ReturnType<typeof physicalRows>> | undefined;
  try {
    h.environment.normalizationPause = async point => {
      if (point.phase !== 'retained' || point.point !== 'before-seal' || fired) return;
      fired = true; const store = target === 'project' ? 'projects' : 'legacyBackup';
      const rows = (await physicalRows(h, [store]))[store];
      const row = target === 'project' ? rows[0] : rows.find(row => (row.id === h.attempt.sourceArchiveId) === (target === 'archive'));
      await mutateRow(h, store, records => records.put({ ...row, externallyChanged: true }));
      changed = await physicalRows(h, allStores);
    };
    await expect(h.repository.readRetainedSource(w.runtime)).rejects.toThrow('normalization-contention');
    expect(fired).toBe(true); expect(await physicalRows(h, allStores)).toEqual(changed);
    expect(w.runtime.snapshot().ownedBytes).toBe(0);
  } finally { h.adapter.close(); }
});

it.each(['before-hash', 'before-seal'] as const)('source-only cancellation at %s releases capture and metadata', async target => {
  const h = await fixture('staging'); const w = makeWorkHarness('retained'); let fired = false;
  try {
    const before = await physicalRows(h, allStores);
    h.environment.normalizationPause = point => { if (point.phase === 'retained' && point.point === target) { fired = true; w.cancel(); } };
    await expect(h.repository.readRetainedSource(w.runtime)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fired).toBe(true); expect(w.runtime.snapshot().ownedBytes).toBe(0);
    expect(await physicalRows(h, allStores)).toEqual(before);
  } finally { h.adapter.close(); }
});

it('source-only recovery refuses an unreserved fresh seed without deriving a target', async () => {
  const h = await fixture('unreserved', true); const w = makeWorkHarness('retained'); const spies = targetSpies();
  try {
    await expect(h.repository.readRetainedSource(w.runtime)).rejects.toThrow('historical-admission-required');
    const source = await h.repository.readNormalizationSource();
    expect(source.kind).toBe('fresh'); expect(source.retainedSeed).toBeUndefined();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    const rows = await physicalRows(h, ['legacyBackup', 'normalizationLedger']);
    expect(rows.legacyBackup).toEqual([]); expect(rows.normalizationLedger).toEqual([]);
    expect(w.runtime.snapshot().ownedBytes).toBe(0);
  } finally { h.adapter.close(); }
});

it('source-only recovery independently admits the one reserved fresh seed', async () => {
  const h = await fixture('staging', true); const w = makeWorkHarness('retained'); const spies = targetSpies();
  try {
    const before = await physicalRows(h, allStores);
    const source = await h.repository.readRetainedSource(w.runtime);
    expect(source).toMatchObject({ kind: 'fresh', retainedSeed: true, sourceDigest: h.attempt.sourceDigest });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(w.runtime.snapshot().sourceDerivations).toBe(1); expect(w.runtime.snapshot().targetDerivations).toBe(0);
    expect(w.runtime.snapshot().sealTransactions).toBe(1); expect(w.runtime.snapshot().ownedBytes).toBe(0);
    expect(before.legacyBackup).toHaveLength(1); expect(await physicalRows(h, allStores)).toEqual(before);
  } finally { h.adapter.close(); }
});
