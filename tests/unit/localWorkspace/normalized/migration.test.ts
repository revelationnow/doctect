// @vitest-environment node
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { forceCloseDatabase, IDBObjectStore as FakeObjectStore } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIndexedDbAdapter } from '../../../../services/localWorkspace/indexedDbAdapter';
import { createHistoricalBootstrap } from '../../../../services/localWorkspace/historicalBootstrap';
import { prepareLineageRepair } from '../../../../services/localWorkspace/lineageRepair';
import { prepareInitialCopy } from '../../../../services/localWorkspace/migration';
import { decomposeProject, reconstructProject, prepareNormalizationTarget } from '../../../../services/localWorkspace/normalized/codec';
import * as codecModule from '../../../../services/localWorkspace/normalized/codec';
import * as partitionModule from '../../../../services/document/partition';
import * as appStateValidation from '../../../../shared/validateAppState.js';
import * as jsonWork from '../../../../shared/jsonWork.js';
import * as sizeLedgerModule from '../../../../services/localWorkspace/normalized/sizeLedger';
import * as emissionModule from '../../../../services/localWorkspace/normalized/emissionPlan';
import { normalizeWorkspace } from '../../../../services/localWorkspace/normalized/migration';
import { frameRecord, jsonBytes } from '../../../../services/localWorkspace/normalized/commitProof';
import * as proofFrames from '../../../../services/localWorkspace/normalized/commitProof';
import * as frameComparisons from '../../../../services/localWorkspace/normalized/frameComparison';
import * as normalizationHash from '../../../../services/localWorkspace/normalized/incrementalSha256';
import { validateWorkspaceProject } from '../../../../services/localWorkspace/validation';
import * as validationModule from '../../../../services/localWorkspace/validation';
import { MAX_STATE_BYTES } from '../../../../shared/projectLimits.js';
import * as recoveryExports from '../../../../services/localWorkspace/recovery';
import { createWorkspaceWorkerHandler } from '../../../../services/localWorkspace/normalized/coordinator';
import { createNormalizedRepository, type NormalizationReservationFault } from '../../../../services/localWorkspace/normalized/repository';
import { NORMALIZATION_LEDGER_ID, NORMALIZED_STORE_NAMES } from '../../../../services/localWorkspace/normalized/schema';
import { WORKSPACE_DB_NAME, WORKSPACE_DB_VERSION, type HistoricalMigrationLedgerV1 } from '../../../../services/localWorkspace/schema';
import { createIncrementalRepositoryHarness } from '../../../helpers/incrementalStoreHarness';
import { makeIncrementalProject } from '../../../helpers/incrementalFixtures';
import { deterministicEnvironment, legacySnapshot, memoryStorage, validLegacyValues, LEGACY_KEYS } from '../../../helpers/localWorkspaceFixtures';
import { makeWorkHarness } from '../../../helpers/normalizationWorkHarness';
import { createWorkRuntime, runSync, type WorkRuntime } from '../../../../shared/cooperativeWork.js';
import { historicalStores, request, done, createNormalizationHarness, freshHarness, physicalRows, mutateRow, refreshAncillaryManifestFixture } from '../../../helpers/normalizationHarness';

async function boundedSessionHarness(options: Parameters<typeof createNormalizationHarness>[0] = {}) {
  const project = makeIncrementalProject(2);
  const h = await createNormalizationHarness({ legacyValues: { [LEGACY_KEYS.projects]: JSON.stringify([project]),
    [LEGACY_KEYS.activeProject]: project.id }, ...options });
  await h.adapter.open();
  expect((await h.historical.bootstrap(() => {}, { allowCopiedReplacement: false })).status).toBe('admitted');
  const w = makeWorkHarness(); const repository = createNormalizedRepository(h.environment);
  expect(repository.openNormalizationSession).toBeTypeOf('function');
  return { ...h, w, repository, session: repository.openNormalizationSession(w.runtime) };
}

it('normalizer shares one invocation runtime with five fences and four independent derivations', async () => {
  const h = await boundedSessionHarness(); h.session.dispose(); const w = makeWorkHarness('discovery');
  const source = vi.spyOn(h.repository, 'readNormalizationSource'); const staged = vi.spyOn(h.repository, 'readStagedProject');
  const phases: string[] = [];
  const partition = partitionModule.partitionStateWork;
  const plannedProducer = vi.spyOn(emissionModule, 'createEmissionBuilder');
  const projection = vi.spyOn(partitionModule, 'partitionStateWork').mockImplementation((...args) => {
    phases.push(w.runtime.context().phase); return partition(...args);
  });
  try {
    const result = await normalizeWorkspace({ repository: h.repository, historical: h.historical,
      ensurePhysicalLayout: () => h.adapter.open(), work: w.runtime });
    expect(result.status).toBe('active'); expect(source).not.toHaveBeenCalled(); expect(staged).not.toHaveBeenCalled();
    expect(w.runtime.snapshot().legacyCaptures).toBe(5); expect(w.runtime.snapshot().legacyReads).toBe(60);
    expect(w.runtime.snapshot().sourceDerivations).toBe(4);
    expect.soft(w.runtime.snapshot().targetDerivations).toBe(4);
    expect.soft(plannedProducer).toHaveBeenCalledTimes(1); expect.soft(projection).toHaveBeenCalledTimes(4);
    expect.soft(phases).toEqual(['prepare', 'verify', 'activate', 'reopen']);
    expect.soft(w.runtime.snapshot('stage').sourceDerivations).toBe(0);
    expect.soft(w.runtime.snapshot('stage').targetDerivations).toBe(0);
    expect(w.runtime.snapshot().ownedBytes).toBe(0); expect(w.runtime.stopped()).toBe(false);
    plannedProducer.mockRestore(); projection.mockRestore();
    const again = makeWorkHarness('discovery');
    expect((await normalizeWorkspace({ repository: h.repository, historical: h.historical,
      ensurePhysicalLayout: () => h.adapter.open(), work: again.runtime })).status).toBe('active');
    expect(again.runtime.snapshot().legacyCaptures).toBe(2);
    expect(again.runtime.snapshot().sourceDerivations).toBe(1); expect(again.runtime.snapshot().ownedBytes).toBe(0);
  } finally { source.mockRestore(); staged.mockRestore(); plannedProducer.mockRestore(); projection.mockRestore(); h.adapter.close(); }
});

it('normalizer independently rechecks consolidated stored projects in every source phase and retains raw source', async () => {
  const h = await boundedSessionHarness(); h.session.dispose(); const w = makeWorkHarness('discovery');
  const original = validationModule.checkStoredWorkspaceProjectWork, phases: string[] = [];
  const checked = vi.spyOn(validationModule, 'checkStoredWorkspaceProjectWork').mockImplementation(function* (raw) {
    phases.push(w.runtime.context().phase); yield* original(raw);
  });
  try {
    const result = await normalizeWorkspace({ repository: h.repository, historical: h.historical,
      ensurePhysicalLayout: () => h.adapter.open(), work: w.runtime });
    expect(result.status).toBe('active');
    expect(new Set(phases)).toEqual(new Set(['prepare', 'verify', 'activate', 'reopen']));
    expect(phases).not.toContain('stage'); checked.mockRestore();
    const retained = await h.repository.readRetainedSource(makeWorkHarness('retained').runtime);
    expect(retained.records.projects).toEqual(h.prepared.projects);
    expect(w.runtime.snapshot().ownedBytes).toBe(0);
  } finally { checked.mockRestore(); h.adapter.close(); }
});

it('normalizer stops without recovery enumeration after cancellation in shared work', async () => {
  const h = await boundedSessionHarness(); h.session.dispose(); const w = makeWorkHarness('discovery');
  const controller = new AbortController(); let fired = false;
  w.observe(() => { fired = true; controller.abort(); });
  const retained = vi.spyOn(h.repository, 'readRetainedSource');
  try {
    const result = await normalizeWorkspace({ repository: h.repository, historical: h.historical,
      ensurePhysicalLayout: () => h.adapter.open(), signal: controller.signal, work: w.runtime });
    expect(fired).toBe(true); expect(result.status).toBe('unavailable');
    if (result.status !== 'active') expect(result.normalizationExports).toEqual([]);
    expect(retained).not.toHaveBeenCalled(); expect(w.runtime.snapshot().ownedBytes).toBe(0);
  } finally { retained.mockRestore(); h.adapter.close(); }
});

it('recovery routing uses one sealed read per source and no authority/export reread', async () => {
  const h = await activeReadFixture();
  const retained = vi.spyOn(h.repository, 'readRetainedSource'); const active = vi.spyOn(h.repository, 'readActiveSnapshot');
  const oldSource = vi.spyOn(h.repository, 'readNormalizationSource').mockRejectedValue(new Error('old source path'));
  const oldAuthority = vi.spyOn(h.repository, 'readActiveAuthority').mockRejectedValue(new Error('old authority path'));
  const oldExport = vi.spyOn(h.repository, 'exportGeneration').mockRejectedValue(new Error('old export path'));
  try {
    const sources = await recoveryExports.normalizationRecoverySources(h.repository);
    expect(sources.map(source => source.kind)).toEqual(['historical-indexeddb', 'normalized-active']);
    expect(retained).toHaveBeenCalledTimes(1); expect(active).toHaveBeenCalledTimes(1);
    for (const source of sources) await recoveryExports.exportNormalizationRecovery(h.repository, source, '2026-09-20T00:00:00.000Z');
    expect(retained).toHaveBeenCalledTimes(2); expect(active).toHaveBeenCalledTimes(2);
    expect(oldSource).not.toHaveBeenCalled(); expect(oldAuthority).not.toHaveBeenCalled(); expect(oldExport).not.toHaveBeenCalled();
  } finally { for (const spy of [retained, active, oldSource, oldAuthority, oldExport]) spy.mockRestore(); h.adapter.close(); }
});

it('recovery routing stops enumeration after lifecycle cancellation', async () => {
  const h = await activeReadFixture(); const w = makeWorkHarness('recovery');
  const active = vi.spyOn(h.repository, 'readActiveSnapshot');
  try {
    h.environment.normalizationPause = point => { if (point.phase === 'retained' && point.point === 'after-page') w.cancel(); };
    await expect(recoveryExports.normalizationRecoverySources(h.repository, w.runtime)).rejects.toMatchObject({ name: 'AbortError' });
    expect(active).not.toHaveBeenCalled(); expect(w.runtime.snapshot().ownedBytes).toBe(0);
  } finally { active.mockRestore(); h.adapter.close(); }
});

it.each(['historical-indexeddb', 'normalized-active'] as const)('recovery routing captures %s selector before sealed-read suspension', async kind => {
  const h = await activeReadFixture(); let fired = false;
  try {
    const selector = (await recoveryExports.normalizationRecoverySources(h.repository)).find(source => source.kind === kind)!;
    const original = structuredClone(selector);
    h.environment.normalizationPause = point => {
      if (point.point !== 'after-page' || fired) return; fired = true;
      Object.assign(selector, kind === 'normalized-active' ? { storageGeneration: 'changed', cutoverRevision: 99 } : { sourceDigest: 'changed' });
    };
    const bundle = await recoveryExports.exportNormalizationRecovery(h.repository, selector, '2026-09-20T00:00:00.000Z');
    expect(fired).toBe(true); expect(bundle.source).toEqual(original);
  } finally { h.adapter.close(); }
});

it.each(['retained', 'active'] as const)('recovery routing independently suppresses invalid %s source', async failed => {
  const h = await activeReadFixture();
  const spy = vi.spyOn(h.repository, failed === 'retained' ? 'readRetainedSource' : 'readActiveSnapshot').mockRejectedValue(new Error('invalid source'));
  try {
    const sources = await recoveryExports.normalizationRecoverySources(h.repository);
    expect(sources.map(source => source.kind)).toEqual([failed === 'retained' ? 'normalized-active' : 'historical-indexeddb']);
  } finally { spy.mockRestore(); h.adapter.close(); }
});

it('recovery routing checks lifecycle after a successful sealed read before publication', async () => {
  const h = await activeReadFixture(); const w = makeWorkHarness('recovery');
  const actual = h.repository.readRetainedSource.bind(h.repository);
  const spy = vi.spyOn(h.repository, 'readRetainedSource').mockImplementation(async work => { const result = await actual(work); w.cancel(); return result; });
  const active = vi.spyOn(h.repository, 'readActiveSnapshot');
  try {
    await expect(recoveryExports.normalizationRecoverySources(h.repository, w.runtime)).rejects.toMatchObject({ name: 'AbortError' });
    expect(active).not.toHaveBeenCalled(); expect(w.runtime.snapshot().ownedBytes).toBe(0);
  } finally { spy.mockRestore(); active.mockRestore(); h.adapter.close(); }
});

it('recovery routing rejects a forged runtime before any repository read', async () => {
  const h = await activeReadFixture(); const read = vi.spyOn(h.repository, 'readRetainedSource');
  try {
    await expect(recoveryExports.normalizationRecoverySources(h.repository, {} as WorkRuntime)).rejects.toBeDefined();
    expect(read).not.toHaveBeenCalled();
  } finally { read.mockRestore(); h.adapter.close(); }
});

it('combined active read and session reopen return one independently sealed snapshot', async () => {
  const h = await stagedSession();
  try {
    expect(h.repository.readActiveSnapshot).toBeTypeOf('function'); expect(h.session.reopen).toBeTypeOf('function');
    await h.session.verify(); const authority = await h.session.activate();
    const expected = await h.repository.exportGeneration(authority.storageGeneration);
    const w = makeWorkHarness('reopen'); const result = await h.repository.readActiveSnapshot(w.runtime);
    expect(result?.authority).toEqual(authority); expect(result?.snapshot).toEqual(expected);
    expect(w.runtime.snapshot().sourceDerivations).toBe(1);
    expect(w.runtime.snapshot().projectReconstructions).toBe(1);
    expect(w.runtime.snapshot().sealTransactions).toBe(1);
    expect(w.runtime.snapshot().ownedBytes).toBe(0);
    expect((await h.session.reopen())?.snapshot).toEqual(expected);
  } finally { h.session.dispose(); h.adapter.close(); }
});

it('sealed retained read ignores corrupt unused live ancillary and target rows', async () => {
  const h = await stagedSession();
  try {
    expect(h.repository.readRetainedSource).toBeTypeOf('function');
    const original = await h.repository.readNormalizationSource();
    await mutateRow(h, 'presets', store => store.put({ id: 'unused-corrupt', invalid: true }));
    await mutateRow(h, 'projectNodes', store => store.put({ key: ['corrupt'], invalid: true }));
    const w = makeWorkHarness('retained'); const retained = await h.repository.readRetainedSource(w.runtime);
    expect(retained.sourceDigest).toBe(original.sourceDigest); expect(retained.snapshot).toEqual(original.snapshot);
    expect(w.runtime.snapshot().sealTransactions).toBe(1); expect(w.runtime.snapshot().ownedBytes).toBe(0);
  } finally { h.session.dispose(); h.adapter.close(); }
});

it.each(['historical', 'fresh'] as const)('strict reservation and staging use bounded work for %s source', async kind => {
  const prepared = kind === 'historical' ? await boundedSessionHarness() : undefined;
  const h = prepared ?? freshHarness();
  try {
    await h.adapter.open();
    const source = await h.repository.readNormalizationSource();
    const target = prepareNormalizationTarget(source); const original = structuredClone(source);
    let seals = 0; let hashes = 0;
    h.environment.normalizationPause = point => {
      if (point.point === 'before-seal') seals++;
      if (point.point === 'before-hash') hashes++;
    };
    const native = vi.spyOn(h.environment, 'hash'); const scans = vi.spyOn(FakeObjectStore.prototype, 'getAll');
    try {
      const reservation = h.repository.reserveNormalization(source);
      source.records.projects[0].project.name = 'Caller changed source';
      const attempt = await reservation;
      expect(attempt.sourceDigest).toBe(original.sourceDigest); expect(seals).toBe(1);
      const batch = structuredClone(target); const stage = h.repository.stageNormalization(attempt, batch);
      batch[0].record.key[0] = 'caller-changed-target';
      const staged = await stage;
      expect(staged.nextRecord).toBe(target.length); expect(hashes).toBeGreaterThan(0);
      expect(native).not.toHaveBeenCalled(); expect(scans).not.toHaveBeenCalled();
    } finally { native.mockRestore(); scans.mockRestore(); }
    expect((await h.repository.readNormalizationSource()).records).toEqual(original.records);
  } finally { prepared?.session.dispose(); h.adapter.close(); }
});

it.each(['source', 'staged', 'verify', 'activate'] as const)('strict %s adapter uses bounded validation and one independent seal', async method => {
  const h = await stagedSession();
  try {
    if (method === 'activate') await h.session.verify();
    const attempt = structuredClone((await physicalRows(h)).normalizationLedger[0]);
    const id = attempt.sourceProjects[0].projectId; const digest = attempt.contentDigest;
    let seals = 0;
    h.environment.normalizationPause = point => { if (point.point === 'before-seal') seals++; };
    const hashes = vi.spyOn(h.environment, 'hash'); const scans = vi.spyOn(FakeObjectStore.prototype, 'getAll');
    try {
      const result = method === 'source' ? h.repository.readNormalizationSource()
        : method === 'staged' ? h.repository.readStagedProject(attempt, id)
          : method === 'verify' ? h.repository.markNormalizationVerified(attempt, digest)
            : h.repository.activateNormalization(attempt);
      // Strict callers retain no authority over the in-flight marker after return.
      attempt.sourceProjects[0].projectId = 'caller-mutated';
      expect(await result).toBeDefined(); expect(seals).toBe(1);
      expect(hashes).not.toHaveBeenCalled(); expect(scans).not.toHaveBeenCalled();
    } finally { hashes.mockRestore(); scans.mockRestore(); }
  } finally { h.session.dispose(); h.adapter.close(); }
});

it.each(['source', 'staged', 'verify', 'activate'] as const)('strict %s adapter rejects a source mutation before seal', async method => {
  const h = await stagedSession(); let fired = false;
  try {
    if (method === 'activate') await h.session.verify();
    const before = await physicalRows(h); const attempt = before.normalizationLedger[0];
    const source = (await physicalRows(h, ['projects'])).projects[0];
    h.environment.normalizationPause = async point => {
      if (point.point !== 'before-seal' || fired) return; fired = true;
      const changed = structuredClone(source); changed.project.name = 'Changed before seal';
      await mutateRow(h, 'projects', store => store.put(changed));
    };
    const result = method === 'source' ? h.repository.readNormalizationSource()
      : method === 'staged' ? h.repository.readStagedProject(attempt, attempt.sourceProjects[0].projectId)
        : method === 'verify' ? h.repository.markNormalizationVerified(attempt, attempt.contentDigest)
          : h.repository.activateNormalization(attempt);
    await expect(result).rejects.toThrow('normalization-contention'); expect(fired).toBe(true);
    expect((await physicalRows(h)).normalizationLedger).toEqual(before.normalizationLedger);
  } finally { h.session.dispose(); h.adapter.close(); }
});

async function activeReadFixture() {
  const project = makeIncrementalProject(2);
  (project.initialState.variants.default.templates['page-0'].layers![0] as any).collapsed = 'raw-one';
  const h = await createNormalizationHarness({ legacyValues: { [LEGACY_KEYS.projects]: JSON.stringify([project]) } });
  expect((await h.run()).status).toBe('active');
  const image = await activeImage(h); const stamp = await h.repository.bindAdmittedProject(image);
  return { ...h, image, stamp };
}

it('metadata proof survives active migration reopen while retained source stays immutable', async () => {
  const h = await activeReadFixture();
  try {
    const retained = await h.repository.readRetainedSource();
    await h.repository.commitDocument({ scope: h.image.scope, clientId: 'metadata-reopen', commitId: 'metadata-1',
      commitGeneration: 1, editorGeneration: 1, expectedRevision: h.stamp.documentRevision, changes: [],
      metadata: { kind: 'patch', name: 'Current metadata', cloud: { type: 'set', value: { projectId: 'cloud', lastSyncedCommitId: 'commit' } } } });
    const fresh = createNormalizedRepository(h.environment);
    const active = await fresh.readActiveSnapshot();
    expect(active?.snapshot.projects[0]).toMatchObject({ name: 'Current metadata', cloud: { projectId: 'cloud', lastSyncedCommitId: 'commit' } });
    expect(await fresh.readRetainedSource()).toEqual(retained);
  } finally { h.adapter.close(); }
});

it.each(['export'] as ('bind' | 'export')[])('selected admission %s uses one bounded seal and no repeated native proof hashes', async consumer => {
  const h = await activeReadFixture(); let seals = 0; let pages = 0;
  const hashes = vi.spyOn(h.environment, 'hash'); const scans = vi.spyOn(FakeObjectStore.prototype, 'getAll');
  try {
    h.environment.normalizationPause = point => {
      if (point.phase !== 'reopen') return;
      if (point.point === 'before-seal') seals++;
      if (point.point === 'after-page') pages++;
    };
    if (consumer === 'bind') expect(await h.repository.bindAdmittedProject(h.image)).toEqual(h.stamp);
    else expect((await h.repository.exportProjectForRecovery(h.image.scope)).project).toEqual(reconstructProject(h.image));
    expect(seals).toBe(1); expect(pages).toBeGreaterThan(14); expect(scans).not.toHaveBeenCalled();
    const comparisonHashes = consumer === 'bind' ? 2 * NORMALIZED_STORE_NAMES.filter(store => store !== 'normalizationLedger').reduce((n, store) => n + h.image[store].size, 0) : 0;
    expect(hashes).toHaveBeenCalledTimes(comparisonHashes);
  } finally { hashes.mockRestore(); scans.mockRestore(); h.adapter.close(); }
});

it.each(['authority', 'generation'] as const)('strict active %s adapter uses exactly one bounded read', async consumer => {
  const h = await activeReadFixture(); let seals = 0;
  const hash = vi.spyOn(h.environment, 'hash'); const scans = vi.spyOn(FakeObjectStore.prototype, 'getAll');
  try {
    h.environment.normalizationPause = point => { if (point.phase === 'reopen' && point.point === 'before-seal') seals++; };
    if (consumer === 'authority') expect((await h.repository.readActiveAuthority())?.storageGeneration).toBe(h.image.scope.storageGeneration);
    else expect((await h.repository.exportGeneration(h.image.scope.storageGeneration)).projects).toEqual([reconstructProject(h.image)]);
    expect(seals).toBe(1); expect(hash).not.toHaveBeenCalled(); expect(scans).not.toHaveBeenCalled();
  } finally { hash.mockRestore(); scans.mockRestore(); h.adapter.close(); }
});

it('active target projection reuses only its independently validated source capture', async () => {
  const h = await activeReadFixture(), w = makeWorkHarness('reopen'), inputs = new Set<unknown>();
  const original = validationModule.checkStoredWorkspaceProjectWork;
  const checked = vi.spyOn(validationModule, 'checkStoredWorkspaceProjectWork').mockImplementation(function* (raw) {
    inputs.add(raw); yield* original(raw);
  });
  const canonical = vi.spyOn(jsonWork, 'canonicalBytesWork');
  try {
    const active = await h.repository.readActiveSnapshot(w.runtime);
    expect(active?.snapshot.projects).toEqual([reconstructProject(h.image)]);
    // Retained source and reconstructed current state remain independently checked.
    expect(inputs.size).toBe(2);
    const sourceProject = inputs.values().next().value;
    expect(canonical.mock.calls.filter(([value]) => value === sourceProject)).toHaveLength(0);
    const currentProject = [...inputs][1];
    expect(canonical.mock.calls.filter(([value]) => value === currentProject)).toHaveLength(0);
    expect(w.runtime.snapshot()).toMatchObject({ sourceDerivations: 1, targetDerivations: 1, ownedBytes: 0 });
  } finally { checked.mockRestore(); canonical.mockRestore(); h.adapter.close(); }
});

it('active target and final seal compare content without serializing the actual target again', async () => {
  const h = await activeReadFixture(), w = makeWorkHarness('reopen'); let checked = false;
  const compare = vi.spyOn(frameComparisons, 'emitComparedRecordWork'), archive = vi.spyOn(frameComparisons, 'compareArchiveWork');
  const serialize = vi.spyOn(jsonWork, 'canonicalWork');
  try {
    h.environment.normalizationPause = point => {
      if (point.phase !== 'reopen' || point.point !== 'before-seal') return;
      const rows = compare.mock.calls.filter(([store]) => store === 'projectNodes');
      expect(rows).toHaveLength(h.image.projectNodes.size);
      const actual = new Set(rows.map(([, , row]) => (row as any).value));
      expect(serialize.mock.calls.filter(([value]) => actual.has(value))).toHaveLength(0); checked = true;
    };
    expect((await h.repository.readActiveSnapshot(w.runtime))?.snapshot.projects).toEqual([reconstructProject(h.image)]);
    expect(checked).toBe(true); expect(archive).toHaveBeenCalledTimes(1);
    expect(w.runtime.snapshot().sealRows).toBeGreaterThan(0); expect(w.runtime.snapshot().sealBytes).toBeGreaterThan(0);
    expect(w.runtime.snapshot().ownedBytes).toBe(0);
  } finally { compare.mockRestore(); archive.mockRestore(); serialize.mockRestore(); h.adapter.close(); }
});

it('active target pass hashes and compares each node frame in one traversal before seal', async () => {
  const h = await activeReadFixture(); const counts = new Map<object, number>(); let checked = false;
  const original = frameComparisons.emitComparedRecordWork;
  const spy = vi.spyOn(frameComparisons, 'emitComparedRecordWork').mockImplementation(function* (store, record, actual, emit) {
    if (store === 'projectNodes') counts.set(record, (counts.get(record) ?? 0) + 1);
    return yield* original(store, record, actual, emit);
  });
  try {
    h.environment.normalizationPause = point => {
      if (point.phase !== 'reopen' || point.point !== 'before-seal') return;
      checked = true; expect(counts.size).toBeGreaterThan(0);
      expect([...counts.values()].every(count => count === 1)).toBe(true);
    };
    expect((await h.repository.readActiveSnapshot())?.snapshot.projects).toEqual([reconstructProject(h.image)]);
    expect(checked).toBe(true);
  } finally { spy.mockRestore(); h.adapter.close(); }
});

it.each(['initial', 'already-active'] as const)('normalizer reuses coupled active read for %s publication', async state => {
  const project = makeIncrementalProject(1);
  const h = await createNormalizationHarness({ legacyValues: { [LEGACY_KEYS.projects]: JSON.stringify([project]) } });
  try {
    if (state === 'already-active') expect((await h.run()).status).toBe('active');
    let seals = 0;
    h.environment.normalizationPause = point => { if (point.phase === 'reopen' && point.point === 'before-seal') seals++; };
    const active = vi.spyOn(h.repository, 'readActiveSnapshot');
    const authority = vi.spyOn(h.repository, 'readActiveAuthority').mockRejectedValue(new Error('duplicate authority read'));
    const exportGeneration = vi.spyOn(h.repository, 'exportGeneration').mockRejectedValue(new Error('duplicate export read'));
    const source = vi.spyOn(h.repository, 'readNormalizationSource');
    if (state === 'already-active') source.mockRejectedValue(new Error('duplicate source read'));
    const result = await normalizeWorkspace({ repository: h.repository, historical: h.historical, ensurePhysicalLayout: () => h.adapter.open() });
    expect(result.status).toBe('active');
    expect(seals).toBe(1); expect(active).not.toHaveBeenCalled();
    expect(authority).not.toHaveBeenCalled(); expect(exportGeneration).not.toHaveBeenCalled();
    expect(source).not.toHaveBeenCalled();
  } finally { h.adapter.close(); }
});

it.each(['export'] as ('bind' | 'export')[])('selected admission %s rejects an unselected target changed before seal', async consumer => {
  const first = makeIncrementalProject(1); const other = { ...structuredClone(first), id: 'other-project' };
  const h = await createNormalizationHarness({ legacyValues: { [LEGACY_KEYS.projects]: JSON.stringify([first, other]) } });
  let fired = false;
  try {
    expect((await h.run()).status).toBe('active');
    const selected = await activeImage(h); expect(selected.scope.projectId).toBe(first.id);
    const original = (await physicalRows(h)).projectNodes.find(row => row.key[1] === other.id);
    expect(original).toBeDefined();
    h.environment.normalizationPause = async point => {
      if (point.phase !== 'reopen' || point.point !== 'before-seal' || fired) return;
      fired = true;
      await mutateRow(h, 'projectNodes', store => store.put({ ...original, value: { ...original.value, title: 'unselected-race' } }));
    };
    const consume = () => consumer === 'bind' ? h.repository.bindAdmittedProject(selected) : h.repository.exportProjectForRecovery(selected.scope);
    await expect(consume()).rejects.toMatchObject({ reason: 'normalization-contention' }); expect(fired).toBe(true);
    h.environment.normalizationPause = undefined;
    await expect(consume()).rejects.toBeDefined();
    await mutateRow(h, 'projectNodes', store => store.put(original));
    await expect(consume()).resolves.toBeDefined();
  } finally { h.adapter.close(); }
});

it('trusted bind reads only the selected project in one transaction without a seal', async () => {
  const first = makeIncrementalProject(1); const other = { ...structuredClone(first), id: 'other-project' };
  const h = await createNormalizationHarness({ legacyValues: { [LEGACY_KEYS.projects]: JSON.stringify([first, other]) } });
  let seals = 0; let pages = 0;
  try {
    expect((await h.run()).status).toBe('active');
    const selected = await activeImage(h); expect(selected.scope.projectId).toBe(first.id);
    const original = (await physicalRows(h)).projectNodes.find(row => row.key[1] === other.id)!;
    await mutateRow(h, 'projectNodes', store => store.put({ ...original, value: { ...original.value, title: 'unselected-change' } }));
    h.environment.normalizationPause = point => {
      if (point.phase !== 'reopen') return;
      if (point.point === 'before-seal') seals++;
      if (point.point === 'after-page') pages++;
    };
    await expect(h.repository.bindAdmittedProject(selected)).resolves.toMatchObject({ documentRevision: 0 });
    expect(seals).toBe(0); expect(pages).toBe(1);
  } finally { h.adapter.close(); }
});

it.each(['preferences', 'document', 'both'] as const)('combined active read preserves authenticated %s edits', async kind => {
  const h = await activeReadFixture();
  try {
    if (kind !== 'preferences') await h.repository.commitDocument({ scope: h.image.scope, clientId: 'combined', commitId: 'doc',
      commitGeneration: 1, editorGeneration: 1, expectedRevision: h.stamp.documentRevision,
      changes: [{ type: 'put-node', node: { ...h.image.projectNodes.values().next().value!.value, title: 'edited' } }] });
    if (kind !== 'document') await h.repository.commitPreferences({ scope: h.image.scope, clientId: 'combined', commitId: 'pref',
      commitGeneration: 2, editorGeneration: 1, observedPreferenceRevision: h.stamp.preferenceRevision, patch: { scale: 1.75 } });
    const expected = await h.repository.exportGeneration(h.image.scope.storageGeneration);
    const w = makeWorkHarness('reopen'); const actual = await h.repository.readActiveSnapshot(w.runtime);
    expect(actual?.snapshot).toEqual(expected); expect(w.runtime.snapshot().projectReconstructions).toBe(1);
    expect(w.runtime.snapshot().ownedBytes).toBe(0);
  } finally { h.adapter.close(); }
});

it.each(['document-baseline', 'physical-fold', 'missing-fold-digest', 'migration-baseline'] as const)
('combined active read rejects %s corruption after preference-only proof', async kind => {
  const h = await activeReadFixture();
  try {
    await h.repository.commitPreferences({ scope: h.image.scope, clientId: 'combined', commitId: 'pref', commitGeneration: 1,
      editorGeneration: 1, observedPreferenceRevision: 0, patch: { scale: 1.75 } });
    const rows = await physicalRows(h);
    if (kind === 'document-baseline') {
      const node = rows.projectNodes[0]; node.value.title = 'tampered'; await mutateRow(h, 'projectNodes', store => store.put(node));
    } else if (kind === 'physical-fold') {
      const folds = rows.projectExtensions.find(row => row.key[3] === 'folds');
      const key = Object.keys(folds.value)[0]; expect(key).toBeDefined(); folds.value[key].value = 'raw-two';
      await mutateRow(h, 'projectExtensions', store => store.put(folds));
    } else if (kind === 'missing-fold-digest') {
      const prefs = rows.projectPreferences[0]; delete prefs.foldRecordDigest; await mutateRow(h, 'projectPreferences', store => store.put(prefs));
    } else {
      const header = rows.projectHeaders[0]; header.migrationBaseline.projectDigest = 'f'.repeat(64);
      await mutateRow(h, 'projectHeaders', store => store.put(header));
    }
    await expect(h.repository.readActiveSnapshot(makeWorkHarness('reopen').runtime)).rejects.toBeDefined();
  } finally { h.adapter.close(); }
});

it('combined active read anchors initial folds even after document proof advances', async () => {
  const h = await activeReadFixture();
  try {
    await h.repository.commitDocument({ scope: h.image.scope, clientId: 'combined', commitId: 'doc', commitGeneration: 1,
      editorGeneration: 1, expectedRevision: 0, changes: [{ type: 'put-node', node: { ...h.image.projectNodes.values().next().value!.value, title: 'edited' } }] });
    const folds = (await physicalRows(h)).projectExtensions.find(row => row.key[3] === 'folds');
    folds.value[Object.keys(folds.value)[0]].value = 'raw-two';
    await mutateRow(h, 'projectExtensions', store => store.put(folds));
    await expect(h.repository.readActiveSnapshot()).rejects.toThrow(/folds/);
  } finally { h.adapter.close(); }
});

for (const mode of ['reopen', 'retained'] as const) {
  it.each(['project', 'archive', 'insert', 'marker'] as const)(`sealed ${mode} read refuses late %s change`, async mutation => {
    const h = await activeReadFixture(); let fired = false; const w = makeWorkHarness(mode);
    try {
      h.environment.normalizationPause = async point => {
        if (point.phase !== mode || point.point !== 'before-seal' || fired) return; fired = true;
        if (mutation === 'project' || mutation === 'insert') {
          const row = (await physicalRows(h, ['projects'])).projects[0];
          if (mutation === 'project') row.project.name += '!'; else { row.id = '!behind'; row.project.id = row.id; }
          await mutateRow(h, 'projects', store => store.put(row));
        } else if (mutation === 'archive') {
          const row = (await physicalRows(h, ['legacyBackup'])).legacyBackup.find(row => row.kind === 'normalization-source');
          row.projectMetadata[0].updatedAt = '2026-09-16T12:00:01.000Z'; await mutateRow(h, 'legacyBackup', store => store.put(row));
        } else {
          const row = (await physicalRows(h)).normalizationLedger[0]; row.contentDigest = 'f'.repeat(64);
          await mutateRow(h, 'normalizationLedger', store => store.put(row));
        }
      };
      await expect(mode === 'reopen' ? h.repository.readActiveSnapshot(w.runtime) : h.repository.readRetainedSource(w.runtime)).rejects.toBeDefined();
      expect(fired).toBe(true); expect(w.runtime.snapshot().ownedBytes).toBe(0);
    } finally { h.adapter.close(); }
  });

  it(`sealed ${mode} read cancels without publishing or retaining a capture`, async () => {
    const h = await activeReadFixture(); const w = makeWorkHarness(mode);
    try {
      h.environment.normalizationPause = point => { if (point.phase === mode && point.point === 'after-page') w.cancel(); };
      await expect(mode === 'reopen' ? h.repository.readActiveSnapshot(w.runtime) : h.repository.readRetainedSource(w.runtime)).rejects.toMatchObject({ name: 'AbortError' });
      expect(w.runtime.snapshot().ownedBytes).toBe(0);
    } finally { h.adapter.close(); }
  });
}

it('sealed fresh retained read enforces live project and ledger absence while ignoring unused ancillary', async () => {
  const h = freshHarness(); await h.adapter.open(); const session = h.repository.openNormalizationSession(makeWorkHarness().runtime);
  try {
    await expect(h.repository.readRetainedSource()).rejects.toBeDefined();
    await session.prepare(); await session.reserve();
    await mutateRow(h, 'workspace', store => store.put({ id: 'irrelevant', invalid: true }));
    expect((await h.repository.readRetainedSource()).retainedSeed).toBe(true);
    await mutateRow(h, 'migrationLedger', store => store.put({ id: 'intruder' }));
    await expect(h.repository.readRetainedSource()).rejects.toThrow(/fresh source/);
  } finally { session.dispose(); h.adapter.close(); }
});

it('combined active discovery avoids payload reads when marker is absent or nonactive', async () => {
  const h = await boundedSessionHarness();
  try {
    const w = makeWorkHarness('reopen'); expect(await h.repository.readActiveSnapshot(w.runtime)).toBeUndefined();
    expect(w.runtime.snapshot().pageTransactions).toBe(0);
    await h.session.prepare(); await h.session.reserve();
    expect(await h.repository.readActiveSnapshot(w.runtime)).toBeUndefined(); expect(w.runtime.snapshot().pageTransactions).toBe(0);
  } finally { h.session.dispose(); h.adapter.close(); }
});

it('combined active read preserves document edits across asymmetric proof-window eviction', async () => {
  const h = await activeReadFixture();
  try {
    await h.repository.commitDocument({ scope: h.image.scope, clientId: 'combined', commitId: 'doc', commitGeneration: 1,
      editorGeneration: 1, expectedRevision: 0, changes: [{ type: 'put-node', node: { ...h.image.projectNodes.values().next().value!.value, title: 'survives eviction' } }] });
    for (let n = 1; n <= 34; n++) await h.repository.commitPreferences({ scope: h.image.scope, clientId: 'combined', commitId: `pref-${n}`,
      commitGeneration: n + 1, editorGeneration: 1, observedPreferenceRevision: n - 1, patch: { scale: 1 + n / 100 } });
    const read = await h.repository.readActiveSnapshot(makeWorkHarness('reopen').runtime);
    expect(read?.snapshot.projects[0].initialState.nodes.root.title).toBe('survives eviction');
    expect(read?.snapshot.projects[0].initialState.scale).toBe(1.34);
    expect(read?.snapshot).toEqual(await h.repository.exportGeneration(h.image.scope.storageGeneration));
  } finally { h.adapter.close(); }
}, 30000);

it('sealed historical retained read touches exactly its three-store dependency set', async () => {
  const h = await activeReadFixture(); const names = new Set<string>(); const native = FakeObjectStore.prototype.openCursor;
  const spy = vi.spyOn(FakeObjectStore.prototype, 'openCursor').mockImplementation(function (...args) {
    names.add(this.name); return native.apply(this, args);
  });
  try {
    await h.repository.readRetainedSource();
    expect([...names].sort()).toEqual(['legacyBackup', 'normalizationLedger', 'projects']);
  } finally { spy.mockRestore(); h.adapter.close(); }
});

it('sealed active read validates live ancillary instead of returning archived workspace', async () => {
  const h = await activeReadFixture();
  try {
    await mutateRow(h, 'workspace', store => {
      const get = store.get('current'); get.onsuccess = () => { const row = get.result; row.activeProjectId = 'missing'; store.put(row); };
    });
    await expect(h.repository.readActiveSnapshot()).rejects.toBeDefined();
    expect((await h.repository.readRetainedSource()).snapshot.activeProjectId).toBe('incremental-control');
  } finally { h.adapter.close(); }
});

it('session latches delayed connection loss and releases preparation before a read starts', async () => {
  const h = await boundedSessionHarness(); let last: IDBDatabase | undefined;
  const open = h.indexedDB.open.bind(h.indexedDB);
  const spy = vi.spyOn(h.indexedDB, 'open').mockImplementation((...args) => {
    const request = open(...args); request.addEventListener('success', () => { last = request.result; }); return request;
  });
  try {
    await h.session.prepare(); expect(h.w.runtime.snapshot().ownedBytes).toBeGreaterThan(0);
    // Deliver an already-queued close notification between session operations.
    last!.onclose!.call(last, new Event('close'));
    await expect(h.session.reopen()).rejects.toMatchObject({ name: 'AbortError' });
    expect(h.w.runtime.stopped()).toBe(true);
    expect(h.w.runtime.snapshot().ownedBytes).toBe(0);
  } finally { h.session.dispose(); spy.mockRestore(); h.adapter.close(); }
});

it('session releases preparation if the phase-entry guard fails after becoming busy', async () => {
  const h = await boundedSessionHarness(); let armed = false; let checks = 0;
  const work = createWorkRuntime({ assertCurrent() { if (armed && ++checks === 2) throw new DOMException('phase entry', 'AbortError'); } });
  const session = h.repository.openNormalizationSession(work);
  try {
    await session.prepare(); expect(work.snapshot().ownedBytes).toBeGreaterThan(0); armed = true;
    await expect(session.reopen()).rejects.toMatchObject({ name: 'AbortError' });
    expect(work.stopped()).toBe(true); expect(work.snapshot().ownedBytes).toBe(0);
    session.dispose(); expect(work.snapshot().ownedBytes).toBe(0);
  } finally { session.dispose(); work.dispose(); h.session.dispose(); h.adapter.close(); }
});

it('session independently verifies and activates from fresh sealed captures', async () => {
  const h = await boundedSessionHarness();
  try {
    expect(h.session.verify).toBeTypeOf('function'); expect(h.session.activate).toBeTypeOf('function');
    await h.session.prepare(); let attempt = await h.session.reserve();
    while (attempt.nextRecord < attempt.recordCount) attempt = await h.session.stageNext();
    const verified = await h.session.verify(); expect(verified.state).toBe('verified');
    expect(h.w.runtime.snapshot('verify').projectReconstructions).toBe(1);
    expect(h.w.runtime.snapshot('verify').sourceDerivations).toBe(1);
    expect(h.w.runtime.snapshot('verify').captureHighWater).toBe(1);
    const active = await h.session.activate(); expect(active.state).toBe('active');
    expect(h.w.runtime.snapshot('activate').projectReconstructions).toBe(1);
    expect(await h.repository.readActiveAuthority()).toEqual(active);
    expect(await h.repository.exportGeneration(active.storageGeneration)).toEqual(await h.exportSource());
  } finally { h.session.dispose(); h.adapter.close(); }
  expect(h.w.runtime.snapshot().ownedBytes).toBe(0);
});

it('session activation refuses corruption introduced after verified state', async () => {
  const h = await boundedSessionHarness();
  try {
    expect(h.session.verify).toBeTypeOf('function');
    await h.session.prepare(); let attempt = await h.session.reserve();
    while (attempt.nextRecord < attempt.recordCount) attempt = await h.session.stageNext();
    await h.session.verify();
    const node = (await physicalRows(h)).projectNodes[0]; node.value.title += '!';
    await mutateRow(h, 'projectNodes', store => store.put(node));
    await expect(h.session.activate()).rejects.toBeDefined();
    expect((await physicalRows(h)).normalizationLedger[0].state).toBe('verified');
  } finally { h.session.dispose(); h.adapter.close(); }
});

async function stagedSession(fresh = false) {
  const h = fresh ? await (async () => {
    const h = freshHarness(); await h.adapter.open(); const w = makeWorkHarness();
    return { ...h, w, session: h.repository.openNormalizationSession(w.runtime) };
  })() : await boundedSessionHarness();
  await h.session.prepare(); let attempt = await h.session.reserve();
  while (attempt.nextRecord < attempt.recordCount) attempt = await h.session.stageNext();
  return h;
}

for (const phase of ['verify', 'activate'] as const) {
  it.each(['source', 'target', 'ancillary', 'archive', 'insert', 'delete', 'extra-marker'] as const)
  (`session ${phase} rejects late %s mutation before its atomic seal`, async mutation => {
    const h = await stagedSession(); let fired = false;
    try {
      if (phase === 'activate') await h.session.verify();
      const before = (await physicalRows(h)).normalizationLedger[0];
      h.environment.normalizationPause = async point => {
        if (point.phase !== phase || point.point !== 'before-seal' || fired) return; fired = true;
        if (mutation === 'source' || mutation === 'insert') {
          const row = (await physicalRows(h, ['projects'])).projects[0];
          if (mutation === 'source') row.project.name += '!'; else { row.id = '!behind'; row.project.id = row.id; }
          await mutateRow(h, 'projects', store => store.put(row));
        } else if (mutation === 'target') {
          const row = (await physicalRows(h)).projectNodes[0]; row.value.title += '!';
          await mutateRow(h, 'projectNodes', store => store.put(row));
        } else if (mutation === 'ancillary') {
          const row = (await physicalRows(h, ['workspace'])).workspace[0]; row.revision++;
          await mutateRow(h, 'workspace', store => store.put(row));
        } else if (mutation === 'archive') {
          const row = (await physicalRows(h, ['legacyBackup'])).legacyBackup.find(row => row.kind === 'normalization-source');
          row.projectMetadata[0].updatedAt = '2026-09-16T12:00:01.000Z';
          await mutateRow(h, 'legacyBackup', store => store.put(row));
        } else if (mutation === 'delete') {
          const row = (await physicalRows(h)).projectNodes[0]; await mutateRow(h, 'projectNodes', store => store.delete(row.key));
        } else await mutateRow(h, 'normalizationLedger', store => store.add({ ...before, id: 'extra' }));
      };
      await expect(h.session[phase]()).rejects.toBeDefined(); expect(fired).toBe(true);
      expect((await physicalRows(h)).normalizationLedger.find(row => row.id === NORMALIZATION_LEDGER_ID)).toEqual(before);
      expect(h.w.runtime.snapshot().ownedBytes).toBe(0);
    } finally { h.session.dispose(); h.adapter.close(); }
  });

  it.each(['before-marker', 'after-marker', 'before-complete', 'after-commit'] as const)
  (`session ${phase} preserves fresh-workspace atomicity at %s`, async fault => {
    const h = await stagedSession(true);
    try {
      if (phase === 'activate') await h.session.verify();
      const expectedFault = `${phase === 'activate' ? 'cutover' : phase}.${fault}`;
      h.environment.normalizationFault = point => { if (point === expectedFault) throw new Error('transition fault'); };
      await expect(h.session[phase]()).rejects.toThrow('transition fault');
      const committed = fault === 'after-commit'; const rows = await physicalRows(h, ['workspace', 'normalizationLedger']);
      expect(rows.normalizationLedger[0].state).toBe(committed ? phase === 'verify' ? 'verified' : 'active' : phase === 'verify' ? 'staging' : 'verified');
      expect(rows.workspace).toHaveLength(Number(phase === 'activate' && committed));
      expect(h.w.runtime.snapshot().ownedBytes).toBe(0);
    } finally { h.session.dispose(); h.adapter.close(); }
  });

  it(`session ${phase} preserves cancellation precedence after durable commit`, async () => {
    const h = await stagedSession();
    try {
      if (phase === 'activate') await h.session.verify();
      h.environment.normalizationFault = point => {
        if (point === `${phase === 'activate' ? 'cutover' : phase}.after-commit`) { h.w.cancel(); throw new Error('masked cancellation'); }
      };
      await expect(h.session[phase]()).rejects.toMatchObject({ name: 'AbortError' });
      expect(h.w.runtime.snapshot(phase).sealTransactions).toBe(1);
      expect((await physicalRows(h)).normalizationLedger[0].state).toBe(phase === 'verify' ? 'verified' : 'active');
      expect(h.w.runtime.snapshot().ownedBytes).toBe(0);
    } finally { h.session.dispose(); h.adapter.close(); }
  });
}

it('session resumes a verified reservation and atomically activates fresh workspace', async () => {
  const h = await stagedSession(true); let resumed: ReturnType<typeof h.repository.openNormalizationSession> | undefined;
  try {
    const verified = await h.session.verify(); h.session.dispose();
    expect((await physicalRows(h, ['workspace'])).workspace).toHaveLength(0);
    resumed = h.repository.openNormalizationSession(makeWorkHarness().runtime);
    await resumed.prepare(); expect(await resumed.reserve()).toEqual(verified);
    const active = await resumed.activate(); expect(await h.repository.readActiveAuthority()).toEqual(active);
    expect((await physicalRows(h, ['workspace'])).workspace).toHaveLength(1);
  } finally { resumed?.dispose(); h.session.dispose(); h.adapter.close(); }
});

it('session stages bounded batches without rereading or rehashing its preparation', async () => {
  const project = makeIncrementalProject(1);
  const root = project.initialState.nodes.root;
  root.children = Array.from({ length: 130 }, (_, index) => `node-${index}`);
  for (const id of root.children) project.initialState.nodes[id] = { ...root, id, parentId: 'root', children: [], data: {}, title: '' };
  const h = await boundedSessionHarness({ legacyValues: { [LEGACY_KEYS.projects]: JSON.stringify([project]) } });
  const reads: string[] = []; const spies: ReturnType<typeof vi.spyOn>[] = [];
  try {
    expect(h.session.stageNext).toBeTypeOf('function');
    await h.session.prepare(); let attempt = await h.session.reserve(); const before = h.w.runtime.snapshot(); let batches = 0;
    const semantics = [vi.spyOn(codecModule, 'withSourceRecords'), vi.spyOn(emissionModule, 'createEmissionBuilder'),
      vi.spyOn(partitionModule, 'partitionStateWork'), vi.spyOn(appStateValidation, 'validateAppStateWork'), vi.spyOn(sizeLedgerModule, 'createSizeLedgerWork')];
    spies.push(...semantics);
    for (const method of ['openCursor', 'get', 'getAll'] as const) {
      const native = FakeObjectStore.prototype[method];
      spies.push(vi.spyOn(FakeObjectStore.prototype, method).mockImplementation(function (...args) {
        reads.push(`${this.name}:${method}`); return native.apply(this, args);
      }));
    }
    while (attempt.nextRecord < attempt.recordCount) {
      const previous = attempt.nextRecord; attempt = await h.session.stageNext(); batches++;
      expect(attempt.nextRecord - previous).toBeGreaterThan(0); expect(attempt.nextRecord - previous).toBeLessThanOrEqual(64);
    }
    expect(batches).toBeGreaterThan(2);
    const after = h.w.runtime.snapshot();
    for (const key of ['sourceDerivations', 'candidateRows', 'sealRows', 'hashBytes'] as const) expect(after[key]).toBe(before[key]);
    expect(after.markerCasRows).toBe(batches); expect(after.stageRecords).toBe(attempt.recordCount);
    expect.soft(after.targetDerivations).toBe(before.targetDerivations);
    for (const spy of semantics) expect.soft(spy.mock.calls.length).toBe(0);
    expect(reads).toEqual(Array(batches).fill('normalizationLedger:openCursor'));
    for (const spy of spies) spy.mockRestore();
    expect(await h.repository.markNormalizationVerified(attempt, attempt.contentDigest)).toMatchObject({ state: 'verified' });
  } finally { for (const spy of spies) spy.mockRestore(); h.session.dispose(); h.adapter.close(); }
  expect(h.w.runtime.snapshot().ownedBytes).toBe(0);
});

it('session staging refuses a competing marker advance', async () => {
  const h = await boundedSessionHarness(); const other = h.repository.openNormalizationSession(makeWorkHarness().runtime);
  try {
    expect(h.session.stageNext).toBeTypeOf('function');
    await h.session.prepare(); await h.session.reserve();
    await other.prepare(); await other.reserve(); const advanced = await other.stageNext();
    await expect(h.session.stageNext()).rejects.toThrow('normalization-contention');
    expect((await physicalRows(h)).normalizationLedger[0]).toEqual(advanced);
  } finally { other.dispose(); h.session.dispose(); h.adapter.close(); }
});

it.each(['fresh', 'historical'] as const)('prepared replay preserves independent physical rows and batch order for %s source', async kind => {
  const project = makeIncrementalProject(1); const root = project.initialState.nodes.root;
  root.children = Array.from({ length: 130 }, (_, index) => `node-${index}`);
  for (const id of root.children) project.initialState.nodes[id] = { ...root, id, parentId: 'root', children: [] };
  const h = kind === 'fresh' ? freshHarness() : await createNormalizationHarness({ legacyValues: {
    [LEGACY_KEYS.projects]: JSON.stringify([project, { ...makeIncrementalProject(1), id: 'second' }]),
    [LEGACY_KEYS.activeProject]: project.id,
  } });
  if (kind === 'fresh') h.environment.normalization!.createBlankProject = () => project.initialState;
  await h.adapter.open();
  if (kind === 'historical') expect((await h.historical.bootstrap(() => {}, { allowCopiedReplacement: false })).status).toBe('admitted');
  const w = makeWorkHarness(); const repository = createNormalizedRepository(h.environment); const session = repository.openNormalizationSession(w.runtime);
  let spy: ReturnType<typeof vi.spyOn> | undefined;
  try {
    await session.prepare(); let attempt = await session.reserve();
    const source = await repository.readNormalizationSource(); const expected = prepareNormalizationTarget(source);
    const order: unknown[] = []; const native = FakeObjectStore.prototype.add;
    spy = vi.spyOn(FakeObjectStore.prototype, 'add').mockImplementation(function (...args) {
      if (NORMALIZED_STORE_NAMES.includes(this.name) && this.name !== 'normalizationLedger') order.push([this.name, structuredClone(args[0].key)]);
      return native.apply(this, args);
    });
    let batches = 0;
    while (attempt.nextRecord < attempt.recordCount) {
      const start = attempt.nextRecord; attempt = await session.stageNext(); batches++;
      const payload = expected.slice(start, attempt.nextRecord);
      expect(payload.length).toBeGreaterThan(0); expect(payload.length).toBeLessThanOrEqual(64);
      const bytes = payload.reduce((total, item) => total + new TextEncoder().encode(frameRecord(item.store, item.record)).length, 0);
      expect(payload.length === 1 || bytes <= 256 * 1024).toBe(true);
    }
    spy.mockRestore(); expect(batches).toBeGreaterThan(2);
    expect(order).toEqual(expected.map(item => [item.store, item.record.key]));
    const actual = await physicalRows(h);
    for (const store of NORMALIZED_STORE_NAMES) if (store !== 'normalizationLedger') {
      expect(new Map(actual[store].map(record => [JSON.stringify(record.key), frameRecord(store, record)])))
        .toEqual(new Map(expected.filter(item => item.store === store).map(item => [JSON.stringify(item.record.key), frameRecord(store, item.record)])));
    }
    expect(w.runtime.snapshot('stage').targetDerivations).toBe(0);
    await session.verify(); await session.activate();
    expect((await session.reopen())!.snapshot.projects).toEqual(source.snapshot.projects);
    expect(w.runtime.snapshot().ownedBytes).toBe(0);
  } finally { spy?.mockRestore(); session.dispose(); h.adapter.close(); }
});

it('prepared replay never opens when independent resumed-prefix validation fails', async () => {
  const h = await boundedSessionHarness(); let resumed: ReturnType<typeof h.repository.openNormalizationSession> | undefined;
  try {
    await h.session.prepare(); const initial = await h.session.reserve(); h.session.dispose();
    const source = await h.repository.readNormalizationSource(); const expected = prepareNormalizationTarget(source);
    await h.repository.stageNormalization(initial, expected.slice(0, 2));
    const row = (await physicalRows(h, ['projectNodes'])).projectNodes[0]; row.value.title = 'externally changed';
    await mutateRow(h, 'projectNodes', store => store.put(row)); const before = await physicalRows(h);
    const open = vi.spyOn(emissionModule, 'openEmissionCursor'); const w = makeWorkHarness();
    resumed = h.repository.openNormalizationSession(w.runtime);
    await expect(resumed.prepare()).rejects.toThrow('Orphaned normalization target');
    expect(open).not.toHaveBeenCalled(); expect(w.runtime.snapshot().ownedBytes).toBe(0);
    expect(await physicalRows(h)).toEqual(before); open.mockRestore();
  } finally { resumed?.dispose(); h.session.dispose(); h.adapter.close(); }
});

it.each(['plan-transfer', 'cursor-open'] as const)('prepared replay releases synchronous ownership on cancellation after %s', async point => {
  const h = await boundedSessionHarness(); let spy: ReturnType<typeof vi.spyOn> | undefined;
  try {
    if (point === 'cursor-open') { await h.session.prepare(); await h.session.reserve(); }
    const before = await physicalRows(h, [...historicalStores, ...NORMALIZED_STORE_NAMES]); let fired = false;
    if (point === 'plan-transfer') {
      const create = emissionModule.createEmissionBuilder;
      spy = vi.spyOn(emissionModule, 'createEmissionBuilder').mockImplementation(source => {
        const builder = create(source); return { ...builder, finish() {
          const plan = builder.finish(); fired = true; h.w.cancel(); return plan;
        } };
      });
    } else {
      const open = emissionModule.openEmissionCursor;
      spy = vi.spyOn(emissionModule, 'openEmissionCursor').mockImplementation((...args) => {
        const cursor = open(...args); fired = true; h.w.cancel(); return cursor;
      });
    }
    await expect(point === 'plan-transfer' ? h.session.prepare() : h.session.stageNext()).rejects.toMatchObject({ name: 'AbortError' });
    expect(fired).toBe(true); expect(h.w.runtime.snapshot().ownedBytes).toBe(0);
    expect(await physicalRows(h, [...historicalStores, ...NORMALIZED_STORE_NAMES])).toEqual(before);
  } finally { spy?.mockRestore(); h.session.dispose(); h.adapter.close(); }
});

it('strict stage prepares once then compares caller records through emission-only replay', async () => {
  const h = await boundedSessionHarness(); const spies: ReturnType<typeof vi.spyOn>[] = [];
  try {
    await h.session.prepare(); const attempt = await h.session.reserve(); h.session.dispose();
    const source = await h.repository.readNormalizationSource(); const expected = prepareNormalizationTarget(source);
    const planned = vi.spyOn(emissionModule, 'createEmissionBuilder'); const scoped = vi.spyOn(codecModule, 'withSourceRecords');
    const semantic = [vi.spyOn(partitionModule, 'partitionStateWork'), vi.spyOn(appStateValidation, 'validateAppStateWork'),
      vi.spyOn(sizeLedgerModule, 'createSizeLedgerWork')]; spies.push(planned, scoped, ...semantic);
    let beforeReplay: number[] | undefined; const open = emissionModule.openEmissionCursor;
    spies.push(vi.spyOn(emissionModule, 'openEmissionCursor').mockImplementation((...args) => {
      beforeReplay = semantic.map(spy => spy.mock.calls.length); return open(...args);
    }));
    const result = await h.repository.stageNormalization(attempt, expected.slice(0, 2));
    expect(result.nextRecord).toBe(2); expect(planned).toHaveBeenCalledTimes(1); expect(scoped).toHaveBeenCalledTimes(1);
    expect(beforeReplay).toBeDefined(); expect(semantic.map(spy => spy.mock.calls.length)).toEqual(beforeReplay);
    expect((await physicalRows(h)).projectNodes).toHaveLength(1);
  } finally { for (const spy of spies) spy.mockRestore(); h.session.dispose(); h.adapter.close(); }
});

it.each(['same-size-value', 'key', 'same-store-order'] as const)('strict replay rejects caller %s mismatch without writing', async kind => {
  const h = await boundedSessionHarness();
  try {
    await h.session.prepare(); let attempt = await h.session.reserve(); h.session.dispose();
    const source = await h.repository.readNormalizationSource(); const expected = prepareNormalizationTarget(source);
    const start = kind === 'same-store-order' ? expected.findIndex(item => item.store === 'projectTemplates') : 1;
    attempt = await h.repository.stageNormalization(attempt, expected.slice(0, start));
    const original = expected.slice(start, start + (kind === 'same-store-order' ? 2 : 1));
    const supplied = structuredClone(original);
    if (kind === 'same-size-value') {
      expect(supplied[0].store).toBe('projectNodes'); const title = Reflect.get(supplied[0].record.value, 'title') as string;
      Reflect.set(supplied[0].record.value, 'title', `Z${title.slice(1)}`);
      expect(jsonBytes(frameRecord(supplied[0].store, supplied[0].record))).toBe(jsonBytes(frameRecord(original[0].store, original[0].record)));
    } else if (kind === 'key') supplied[0].record.key[supplied[0].record.key.length - 1] = 'evil';
    else { expect(supplied.every(item => item.store === 'projectTemplates')).toBe(true); supplied.reverse(); }
    const before = await physicalRows(h, [...historicalStores, ...NORMALIZED_STORE_NAMES]);
    await expect(h.repository.stageNormalization(attempt, supplied)).rejects.toThrow('Unexpected normalization batch');
    expect(await physicalRows(h, [...historicalStores, ...NORMALIZED_STORE_NAMES])).toEqual(before);
  } finally { h.session.dispose(); h.adapter.close(); }
});

it.each(['verify', 'verified-resume-activate', 'direct-reopen'] as const)('drops prepared ownership before the first independent read: %s', async scenario => {
  const h = await boundedSessionHarness(); let session = h.session; let w = h.w;
  const spies: ReturnType<typeof vi.spyOn>[] = [];
  try {
    await session.prepare(); let attempt = await session.reserve();
    if (scenario === 'direct-reopen') {
      const other = h.repository.openNormalizationSession(makeWorkHarness().runtime);
      try {
        await other.prepare(); let current = await other.reserve();
        while (current.nextRecord < current.recordCount) current = await other.stageNext();
        await other.verify(); await other.activate();
      } finally { other.dispose(); }
    } else {
      while (attempt.nextRecord < attempt.recordCount) attempt = await session.stageNext();
      if (scenario === 'verified-resume-activate') {
        await session.verify(); session.dispose(); w = makeWorkHarness(); session = h.repository.openNormalizationSession(w.runtime);
        await session.prepare(); await session.reserve();
      }
    }
    expect(w.runtime.snapshot('prepare').ownedBytes).toBeGreaterThan(0);
    const disposed = vi.spyOn(emissionModule, 'disposeEmissionPlan'); spies.push(disposed);
    const phase = scenario === 'verify' ? 'verify' : scenario === 'direct-reopen' ? 'reopen' : 'activate';
    const native = FakeObjectStore.prototype.get; let checked = false;
    spies.push(vi.spyOn(FakeObjectStore.prototype, 'get').mockImplementation(function (...args) {
      if (!checked && w.runtime.context().phase === phase) {
        checked = true; expect(disposed).toHaveBeenCalledTimes(1);
        expect(w.runtime.snapshot('prepare').ownedBytes).toBe(0); expect(w.runtime.snapshot('prepare').captureGraphs).toBe(0);
      }
      return native.apply(this, args);
    }));
    if (scenario === 'verify') await session.verify();
    else if (scenario === 'direct-reopen') expect(await session.reopen()).toBeDefined();
    else await session.activate();
    expect(checked).toBe(true);
  } finally { for (const spy of spies) spy.mockRestore(); session.dispose(); h.session.dispose(); h.adapter.close(); }
  expect(w.runtime.snapshot().ownedBytes).toBe(0);
});

it('session stage counts committed facts before cancellation at transaction completion', async () => {
  const h = await boundedSessionHarness(); let fired = false;
  const put = FakeObjectStore.prototype.put; let spy: ReturnType<typeof vi.spyOn> | undefined;
  try {
    await h.session.prepare(); await h.session.reserve();
    spy = vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(function (...args) {
      if (this.name === 'normalizationLedger') this.transaction.addEventListener('complete', () => h.w.cancel());
      return put.apply(this, args);
    });
    h.environment.normalizationFault = point => { if (point === 'stage.after-commit') fired = true; };
    await expect(h.session.stageNext()).rejects.toMatchObject({ name: 'AbortError' });
    expect(fired).toBe(true); expect(h.w.runtime.snapshot().stageTransactions).toBe(1);
    expect(h.w.runtime.snapshot().stageRecords).toBeGreaterThan(0);
    expect((await physicalRows(h)).normalizationLedger[0].nextRecord).toBeGreaterThan(0);
  } finally { spy?.mockRestore(); h.session.dispose(); h.adapter.close(); }
});

it('session stage counts full marker comparison, write and returned clone costs', async () => {
  const h = await boundedSessionHarness();
  try {
    await h.session.prepare(); const initial = await h.session.reserve(); const before = h.w.runtime.snapshot();
    const next = await h.session.stageNext(); const after = h.w.runtime.snapshot();
    expect(after.markerBytes - before.markerBytes).toBe(jsonBytes(initial));
    expect(after.markerWorkBytes - before.markerWorkBytes).toBe(2 * jsonBytes(initial) + 2 * jsonBytes(next));
  } finally { h.session.dispose(); h.adapter.close(); }
});

const stageFixtureImage = decomposeProject(makeIncrementalProject(2), { storageGeneration: 'g', projectId: 'incremental-control', incarnation: 'i' });
const stageFixtureCount = NORMALIZED_STORE_NAMES.reduce((sum, store) => sum + stageFixtureImage[store].size, 0);
for (const phase of ['stage.before-record', 'stage.after-record'] as const) {
  it.each(Array.from({ length: stageFixtureCount }, (_, ordinal) => ordinal))(`session stage atomically aborts ${phase} ordinal %s`, async ordinal => {
    const h = await boundedSessionHarness(); let visited = 0;
    try {
      await h.session.prepare(); const attempt = await h.session.reserve();
      expect(attempt.recordCount).toBe(stageFixtureCount);
      h.environment.normalizationFault = point => {
        if (point === phase && visited++ === ordinal) throw new DOMException('quota', 'QuotaExceededError');
      };
      await expect(h.session.stageNext()).rejects.toMatchObject({ name: 'QuotaExceededError' });
      const rows = await physicalRows(h);
      expect(rows.normalizationLedger[0]).toEqual(attempt);
      for (const store of NORMALIZED_STORE_NAMES) if (store !== 'normalizationLedger') expect(rows[store]).toHaveLength(0);
      expect(h.w.runtime.snapshot().stageRecords).toBe(0);
      expect(h.w.runtime.snapshot().ownedBytes).toBe(0);
    } finally { h.session.dispose(); h.adapter.close(); }
  });
}

it.each(['stage.before-marker', 'stage.after-marker', 'stage.before-complete', 'stage.after-commit'] as const)
('session stage preserves durable facts at %s', async fault => {
  const h = await boundedSessionHarness();
  try {
    await h.session.prepare(); const attempt = await h.session.reserve();
    h.environment.normalizationFault = point => { if (point === fault) throw new Error('stage fault'); };
    await expect(h.session.stageNext()).rejects.toThrow('stage fault');
    const marker = (await physicalRows(h)).normalizationLedger[0];
    expect(marker.nextRecord).toBe(fault === 'stage.after-commit' ? attempt.recordCount : 0);
    expect(h.w.runtime.snapshot().ownedBytes).toBe(0);
  } finally { h.session.dispose(); h.adapter.close(); }
});

it('session stage permits a legal oversized record alone without hashing or recapture', async () => {
  const project = makeIncrementalProject(1); project.name = 'x'.repeat(256 * 1024);
  const h = await boundedSessionHarness({ legacyValues: { [LEGACY_KEYS.projects]: JSON.stringify([project]) } });
  try {
    await h.session.prepare(); await h.session.reserve(); const before = h.w.runtime.snapshot();
    const first = await h.session.stageNext(); expect(first.nextRecord).toBe(1);
    const header = (await physicalRows(h)).projectHeaders[0];
    expect(new TextEncoder().encode(frameRecord('projectHeaders', header)).length).toBeGreaterThan(256 * 1024);
    const last = await h.session.stageNext(); expect(last.nextRecord).toBe(last.recordCount);
    expect(h.w.runtime.snapshot().hashBytes).toBe(before.hashBytes);
    expect(h.w.runtime.snapshot().candidateRows).toBe(before.candidateRows);
  } finally { h.session.dispose(); h.adapter.close(); }
}, 30000);

it('session resumes independently checked prefix and stages only remaining records', async () => {
  const h = await boundedSessionHarness(); let resumed: ReturnType<typeof h.repository.openNormalizationSession> | undefined;
  try {
    await h.session.prepare(); const initial = await h.session.reserve(); h.session.dispose();
    const source = await h.repository.readNormalizationSource(); const target = prepareNormalizationTarget(source);
    const partial = await h.repository.stageNormalization(initial, target.slice(0, 2));
    const w = makeWorkHarness(); resumed = h.repository.openNormalizationSession(w.runtime);
    await resumed.prepare(); expect(await resumed.reserve()).toEqual(partial);
    const done = await resumed.stageNext(); expect(done.nextRecord).toBe(done.recordCount);
    expect(w.runtime.snapshot().stageRecords).toBe(done.recordCount - partial.nextRecord);
    expect(await h.repository.markNormalizationVerified(done, done.contentDigest)).toMatchObject({ state: 'verified' });
  } finally { resumed?.dispose(); h.session.dispose(); h.adapter.close(); }
});

it('session stage rejects additional marker membership before any append', async () => {
  const h = await boundedSessionHarness();
  try {
    await h.session.prepare(); const attempt = await h.session.reserve();
    await mutateRow(h, 'normalizationLedger', store => store.add({ ...attempt, id: 'extra-marker' }));
    await expect(h.session.stageNext()).rejects.toThrow('normalization-contention');
    const rows = await physicalRows(h);
    for (const store of NORMALIZED_STORE_NAMES) if (store !== 'normalizationLedger') expect(rows[store]).toHaveLength(0);
    expect(h.w.runtime.snapshot().unmeasuredValues).toBeGreaterThan(0);
  } finally { h.session.dispose(); h.adapter.close(); }
});

it('session prepares once and seals one immutable archive with exact existing digests', async () => {
  const h = await boundedSessionHarness();
  try {
    const source = await h.repository.readNormalizationSource();
    expect(await h.session.prepare()).toEqual({ state: 'prepared', source: { kind: 'historical', acceptedLegacyDigest: source.ledger!.acceptedLegacyDigest } });
    const attempt = await h.session.reserve();
    expect(attempt).toMatchObject({ state: 'staging', nextRecord: 0, sourceDigest: source.sourceDigest, contentDigest: source.contentDigest });
    expect(h.w.runtime.snapshot().sourceDerivations).toBe(1);
    expect(h.w.runtime.snapshot().pageTransactions).toBeGreaterThan(14);
    expect(h.w.runtime.snapshot().sealTransactions).toBe(1);
    expect(await h.repository.reserveNormalization(source)).toEqual(attempt);
    const rows = await physicalRows(h, ['legacyBackup', 'normalizationLedger']);
    expect(rows.normalizationLedger).toHaveLength(1);
    expect(rows.legacyBackup.filter(row => row.kind === 'normalization-source')).toHaveLength(1);
  } finally { h.session.dispose(); h.adapter.close(); }
  expect(h.w.runtime.snapshot().ownedBytes).toBe(0);
});

it('session refuses same-revision source mutation at reservation seal', async () => {
  const h = await boundedSessionHarness(); let fired = false;
  try {
    await h.session.prepare();
    h.environment.normalizationPause = async point => {
      if (point.phase !== 'reserve' || point.point !== 'before-seal' || fired) return;
      fired = true;
      const row = (await physicalRows(h, ['projects'])).projects[0]; row.project.name = 'changed';
      await mutateRow(h, 'projects', store => store.put(row));
    };
    await expect(h.session.reserve()).rejects.toThrow(/contention/);
    expect(fired).toBe(true);
    expect((await physicalRows(h)).normalizationLedger).toHaveLength(0);
  } finally { h.session.dispose(); h.adapter.close(); }
  expect(h.w.runtime.snapshot().ownedBytes).toBe(0);
});

it('session captures fresh policy before awaiting and never calls forbidden seed providers', async () => {
  const h = freshHarness(); await h.adapter.open(); const w = makeWorkHarness();
  const seed = vi.spyOn(h.preparation, 'createBlankProject'); const uuid = vi.spyOn(h.preparation, 'randomUUID');
  const session = h.repository.openNormalizationSession(w.runtime);
  try {
    const options = { allowFresh: false }; const pending = session.prepare(options); options.allowFresh = true;
    await expect(pending).rejects.toThrow('historical-admission-required');
    expect(seed).not.toHaveBeenCalled(); expect(uuid).not.toHaveBeenCalled();
  } finally { session.dispose(); h.adapter.close(); seed.mockRestore(); uuid.mockRestore(); }
});

it('session owns fresh seed before provider mutation can alter a reservation', async () => {
  const h = freshHarness(); await h.adapter.open(); const w = makeWorkHarness();
  const seed = h.preparation.createBlankProject(); h.preparation.createBlankProject = () => seed;
  const before = JSON.stringify(seed); const session = h.repository.openNormalizationSession(w.runtime);
  try {
    await session.prepare(); seed.nodes.root.title = 'mutated provider'; await session.reserve();
    const source = await h.repository.readNormalizationSource();
    expect(JSON.stringify(source.records.projects[0].project.initialState)).toBe(before);
  } finally { session.dispose(); h.adapter.close(); }
});

it('session resumes archive sealing without adding external payload ancestry', async () => {
  const h = freshHarness(); await h.adapter.open();
  const seed = h.preparation.createBlankProject(); let nested: object = {};
  for (let index = 0; index < 509; index++) nested = { x: nested };
  Object.assign(seed, { extra: nested }); h.preparation.createBlankProject = () => seed;
  const first = h.repository.openNormalizationSession(makeWorkHarness().runtime);
  const second = h.repository.openNormalizationSession(makeWorkHarness().runtime);
  try {
    await first.prepare(); const attempt = await first.reserve(); first.dispose();
    await second.prepare(); expect(await second.reserve()).toEqual(attempt);
  } finally { first.dispose(); second.dispose(); h.adapter.close(); }
});

it('session closes connection acquired at a cancellation boundary', async () => {
  const h = freshHarness(); await h.adapter.open(); const w = makeWorkHarness();
  const open = h.indexedDB.open.bind(h.indexedDB); let close: ReturnType<typeof vi.spyOn> | undefined;
  const spy = vi.spyOn(h.indexedDB, 'open').mockImplementation((...args) => {
    const request = open(...args);
    request.addEventListener('success', () => { close = vi.spyOn(request.result, 'close'); w.cancel(); });
    return request;
  });
  const session = h.repository.openNormalizationSession(w.runtime);
  try {
    await expect(session.prepare()).rejects.toMatchObject({ name: 'AbortError' });
    expect(close).toHaveBeenCalled();
  } finally { session.dispose(); spy.mockRestore(); close?.mockRestore(); h.adapter.close(); }
});

it('session discovers copied historical ledger before reading payload pages', async () => {
  const h = await createNormalizationHarness(); await h.adapter.open(); const w = makeWorkHarness();
  const cursor = vi.spyOn(FakeObjectStore.prototype, 'openCursor');
  const session = h.repository.openNormalizationSession(w.runtime);
  try {
    await expect(session.prepare()).rejects.toThrow('historical-admission-required');
    expect(cursor).not.toHaveBeenCalled();
    expect(w.runtime.snapshot().candidateRows).toBe(0);
  } finally { session.dispose(); cursor.mockRestore(); h.adapter.close(); }
});

it.each(['delete', 'insert-behind', 'ancillary', 'backup'] as const)('session seals complete membership against %s races', async kind => {
  const h = await boundedSessionHarness(); let fired = false;
  try {
    await h.session.prepare();
    h.environment.normalizationPause = async point => {
      if (point.point !== 'before-seal' || fired) return; fired = true;
      if (kind === 'delete') await mutateRow(h, 'projects', store => store.delete('incremental-control'));
      else if (kind === 'insert-behind') {
        const row = (await physicalRows(h, ['projects'])).projects[0]; row.id = '!behind'; row.project.id = row.id;
        await mutateRow(h, 'projects', store => store.add(row));
      } else if (kind === 'ancillary') {
        const row = (await physicalRows(h, ['workspace'])).workspace[0]; row.revision++;
        await mutateRow(h, 'workspace', store => store.put(row));
      } else {
        const row = (await physicalRows(h, ['legacyBackup'])).legacyBackup[0]; row.snapshot.projects += ' ';
        await mutateRow(h, 'legacyBackup', store => store.put(row));
      }
    };
    await expect(h.session.reserve()).rejects.toThrow(/contention/);
    expect(fired).toBe(true); expect((await physicalRows(h)).normalizationLedger).toHaveLength(0);
  } finally { h.session.dispose(); h.adapter.close(); }
  expect(h.w.runtime.snapshot().ownedBytes).toBe(0);
});

it.each([false, true])('session checks insertion behind completed page, restored=%s', async restore => {
  const h = await boundedSessionHarness(); let inserted = false;
  try {
    h.environment.normalizationPause = async point => {
      if (point.point !== 'after-page' || point.ordinal !== 1 || inserted) return; inserted = true;
      const row = (await physicalRows(h, ['projects'])).projects[0]; row.id = '!behind'; row.project.id = row.id;
      await mutateRow(h, 'projects', store => store.add(row));
    };
    await h.session.prepare(); expect(inserted).toBe(true);
    h.environment.normalizationPause = async point => {
      if (restore && point.point === 'before-seal') await mutateRow(h, 'projects', store => store.delete('!behind'));
    };
    if (restore) expect(await h.session.reserve()).toMatchObject({ state: 'staging' });
    else await expect(h.session.reserve()).rejects.toThrow('normalization-contention');
  } finally { h.session.dispose(); h.adapter.close(); }
});

it.each(['unchanged', 'delete', 'changed', 'extra'] as const)('session independently checks resumed prefix: %s', async change => {
  const h = await boundedSessionHarness(); let resumed: ReturnType<typeof h.repository.openNormalizationSession> | undefined;
  try {
    await h.session.prepare(); let attempt = await h.session.reserve(); h.session.dispose();
    const source = await h.repository.readNormalizationSource();
    const target = prepareNormalizationTarget(source);
    attempt = await h.repository.stageNormalization(attempt, target.slice(0, 1));
    if (change === 'delete') await mutateRow(h, 'projectHeaders', store => store.delete(target[0].record.key));
    if (change === 'changed') {
      const row = (await physicalRows(h)).projectHeaders[0]; row.value.name += '!';
      await mutateRow(h, 'projectHeaders', store => store.put(row));
    }
    if (change === 'extra') await mutateRow(h, target[1].store, store => store.add(target[1].record));
    const w = makeWorkHarness(); resumed = h.repository.openNormalizationSession(w.runtime);
    if (change === 'unchanged') { await resumed.prepare(); expect(await resumed.reserve()).toEqual(attempt); }
    else await expect(resumed.prepare()).rejects.toThrow(/normalization target/);
    expect((await physicalRows(h)).normalizationLedger[0]).toEqual(attempt);
    resumed.dispose(); expect(w.runtime.snapshot().ownedBytes).toBe(0);
  } finally { resumed?.dispose(); h.session.dispose(); h.adapter.close(); }
});

it.each(['reservation.before-archive', 'reservation.after-archive', 'reservation.before-marker',
  'reservation.after-marker', 'reservation.before-complete', 'reservation.after-commit'] as const)
('session reservation preserves atomicity at %s', async fault => {
  const h = await boundedSessionHarness();
  try {
    await h.session.prepare(); h.environment.normalizationFault = point => { if (point === fault) throw new DOMException('quota', 'QuotaExceededError'); };
    await expect(h.session.reserve()).rejects.toMatchObject({ name: 'QuotaExceededError' });
    const rows = await physicalRows(h, ['legacyBackup', 'normalizationLedger']); const committed = fault === 'reservation.after-commit';
    expect(rows.normalizationLedger).toHaveLength(Number(committed));
    expect(rows.legacyBackup.filter(row => row.kind === 'normalization-source')).toHaveLength(Number(committed));
  } finally { h.session.dispose(); h.adapter.close(); }
  expect(h.w.runtime.snapshot().ownedBytes).toBe(0);
});

it('session disposal inside transaction retains ownership until abort settles', async () => {
  const h = await boundedSessionHarness(); let retained = 0;
  try {
    await h.session.prepare();
    h.environment.normalizationFault = point => {
      if (point === 'reservation.after-archive') { h.session.dispose(); retained = h.w.runtime.snapshot().ownedBytes; }
    };
    await expect(h.session.reserve()).rejects.toMatchObject({ name: 'AbortError' });
    expect(retained).toBeGreaterThan(0); expect(h.w.runtime.snapshot().ownedBytes).toBe(0);
    expect((await physicalRows(h)).normalizationLedger).toHaveLength(0);
  } finally { h.session.dispose(); h.adapter.close(); }
});

it('session refuses a competing reservation rather than adopting its marker', async () => {
  const h = await boundedSessionHarness();
  try {
    await h.session.prepare();
    await h.repository.reserveNormalization(await h.repository.readNormalizationSource());
    await expect(h.session.reserve()).rejects.toThrow('normalization-contention');
    expect((await physicalRows(h)).normalizationLedger).toHaveLength(1);
  } finally { h.session.dispose(); h.adapter.close(); }
});

it.each(['close', 'versionchange'] as const)('session stops on connection %s during after-page pause', async loss => {
  const h = await boundedSessionHarness(); let last: IDBDatabase | undefined; let fired = false;
  const open = h.indexedDB.open.bind(h.indexedDB);
  const spy = vi.spyOn(h.indexedDB, 'open').mockImplementation((...args) => {
    const result = open(...args); result.addEventListener('success', () => { last = result.result; }); return result;
  });
  try {
    h.environment.normalizationPause = async point => {
      if (point.point !== 'after-page' || fired) return; fired = true;
      if (loss === 'close') { forceCloseDatabase(last as unknown as Parameters<typeof forceCloseDatabase>[0]); await new Promise(resolve => setImmediate(resolve)); }
      else { const changed = await request<IDBDatabase>(open(h.databaseName, 4)); changed.close(); }
    };
    await expect(h.session.prepare()).rejects.toMatchObject({ name: 'AbortError' });
    expect(fired).toBe(true); expect(h.w.runtime.snapshot().ownedBytes).toBe(0);
  } finally { h.session.dispose(); spy.mockRestore(); h.adapter.close(); }
});

it.each(['root-array', 'workspace-array', 'seed-array', 'array-property'] as const)('session archive seal preserves container types and membership: %s', async change => {
  const h = freshHarness(); await h.adapter.open();
  const first = h.repository.openNormalizationSession(makeWorkHarness().runtime);
  const second = h.repository.openNormalizationSession(makeWorkHarness().runtime);
  try {
    await first.prepare(); await first.reserve(); first.dispose(); await second.prepare();
    let archive = (await physicalRows(h, ['legacyBackup'])).legacyBackup[0];
    if (change === 'root-array') archive = Object.assign([], archive);
    if (change === 'workspace-array') archive.workspace = Object.assign([], archive.workspace);
    if (change === 'seed-array') archive.seed[0] = Object.assign([], archive.seed[0]);
    if (change === 'array-property') archive.seed.extra = 'unsealed';
    await mutateRow(h, 'legacyBackup', store => store.put(archive));
    await expect(second.reserve()).rejects.toBeDefined();
  } finally { first.dispose(); second.dispose(); h.adapter.close(); }
});

it('session cancellation wins over a throwing after-commit fault without undoing durable facts', async () => {
  const h = await boundedSessionHarness();
  try {
    await h.session.prepare();
    h.environment.normalizationFault = point => {
      if (point === 'reservation.after-commit') { h.w.cancel(); throw new Error('fault masks cancellation'); }
    };
    await expect(h.session.reserve()).rejects.toMatchObject({ name: 'AbortError' });
    expect(h.w.runtime.stopped()).toBe(true);
    expect((await physicalRows(h)).normalizationLedger).toHaveLength(1);
    expect(h.w.runtime.snapshot().ownedBytes).toBe(0);
  } finally { h.session.dispose(); h.adapter.close(); }
});

it.each(['state', 'sourceKind'])('session marker rejects malformed %s without array coercion', async field => {
  const h = await boundedSessionHarness(); let resumed: ReturnType<typeof h.repository.openNormalizationSession> | undefined;
  let joins = 0; const nativeJoin = Array.prototype.join;
  try {
    await h.session.prepare(); const marker: any = await h.session.reserve(); h.session.dispose();
    marker[field] = Array(20000).fill('x'); await mutateRow(h, 'normalizationLedger', store => store.put(marker));
    const spy = vi.spyOn(Array.prototype, 'join').mockImplementation(function (separator) {
      if (this.length === 20000) joins++;
      return nativeJoin.call(this, separator);
    });
    try {
      resumed = h.repository.openNormalizationSession(makeWorkHarness().runtime);
      await expect(resumed.prepare()).rejects.toThrow(/ledger/);
      expect(joins).toBe(0);
    } finally { spy.mockRestore(); }
  } finally { resumed?.dispose(); h.session.dispose(); h.adapter.close(); }
});

it('session uses lowest unused archive suffix while retaining archive-like historical IDs', async () => {
  const h = await boundedSessionHarness(); const base = `normalization-source:${NORMALIZATION_LEDGER_ID}`;
  try {
    const original = (await physicalRows(h, ['legacyBackup'])).legacyBackup[0];
    for (const id of [base, `${base}:1`, `${base}:01`]) await mutateRow(h, 'legacyBackup', store => store.add({ ...original, id }));
    const source = await h.repository.readNormalizationSource();
    await h.session.prepare(); const attempt = await h.session.reserve();
    expect(attempt.sourceArchiveId).toBe(`${base}:2`);
    expect(h.w.runtime.snapshot().backupValidations).toBe(4);
    expect(await h.repository.reserveNormalization(source)).toEqual(attempt);
    expect((await physicalRows(h, ['legacyBackup'])).legacyBackup).toHaveLength(5);
  } finally { h.session.dispose(); h.adapter.close(); }
});

it('session rejects wrong physical keys before trusting target envelopes', async () => {
  const h = await boundedSessionHarness({ outOfLineNodes: true });
  let resumed: ReturnType<typeof h.repository.openNormalizationSession> | undefined;
  try {
    await h.session.prepare(); await h.session.reserve(); h.session.dispose();
    const source = await h.repository.readNormalizationSource(); const target = prepareNormalizationTarget(source);
    const node = target.find(item => item.store === 'projectNodes')!;
    await mutateRow(h, 'projectNodes', store => store.put(node.record, 'wrong-physical-key'));
    resumed = h.repository.openNormalizationSession(makeWorkHarness().runtime);
    await expect(resumed.prepare()).rejects.toThrow('Physical key mismatch');
  } finally { resumed?.dispose(); h.session.dispose(); h.adapter.close(); }
});

it('session streams a multi-project manifest once without retaining a whole target array', async () => {
  const projects = Array.from({ length: 2 }, (_, index) => ({ ...makeIncrementalProject(28), id: `bounded-${index}` }));
  // This asserts record-count/derivation behavior, not artwork throughput. Keep
  // every template record while avoiding unrelated rendering payload in this fixture.
  for (const project of projects) for (const template of Object.values(project.initialState.variants.default.templates)) template.elements = [];
  const h = await boundedSessionHarness({ legacyValues: { [LEGACY_KEYS.projects]: JSON.stringify(projects), [LEGACY_KEYS.activeProject]: projects[0].id } });
  try {
    await h.session.prepare(); const prepared = h.w.runtime.snapshot(); const attempt = await h.session.reserve();
    expect(attempt.recordCount).toBeGreaterThan(64);
    expect(prepared.sourceDerivations).toBe(1); expect(prepared.targetDerivations).toBe(1);
    expect(h.w.runtime.snapshot().candidateRows).toBe(prepared.candidateRows);
    expect(h.w.runtime.snapshot().captureHighWater).toBe(1);
    expect(h.w.runtime.snapshot().ownedBytes).toBeGreaterThan(0);
  } finally { h.session.dispose(); h.adapter.close(); }
  expect(h.w.runtime.snapshot().ownedBytes).toBe(0);
});
import { rawValueWeightWork } from '../../../../shared/jsonWork.js';
import { canonicalStringify } from '../../../../services/localWorkspace/canonical';
import { WorkspaceStoreError } from '../../../../services/localWorkspace/contracts';

afterEach(() => vi.restoreAllMocks());

describe.each(['inspect', 'readWorkspaceRecords', 'readMigrationLedger', 'readLegacyBackup'] as const)(
  'prerequisite posttransaction weights: %s', method => {
    const read = (h: Awaited<ReturnType<typeof createNormalizationHarness>>, work?: WorkRuntime) =>
      method === 'readLegacyBackup' ? h.adapter.readLegacyBackup(h.prepared.backup.id, work) : h.adapter[method](work);

    it('counts logical rows and flags opaque weights without changing raw data', async () => {
      const h = await createNormalizationHarness(); const w = makeWorkHarness('prerequisite');
      const store = method === 'readLegacyBackup' ? 'legacyBackup' : method === 'readMigrationLedger' ? 'migrationLedger' : 'workspace';
      try {
        await h.adapter.open();
        await mutateRow(h, store, objectStore => { objectStore.put({ ...h.source[store][0], extra: new Map([['é', 1n]]) }); });
        const expected = await read(h);
        const raw = (await h.inspectFresh()).source;
        const weight = (names: string[]) => names.flatMap(name => raw[name]).reduce((sum, row) => sum + runSync(rawValueWeightWork(row)).bytes, 0);
        expect(await read(h, w.runtime)).toEqual(expected);
        expect(w.runtime.snapshot()).toMatchObject({
          candidateBytes: method === 'inspect' || method === 'readWorkspaceRecords' ? weight(['projects', 'workspace', 'presets', 'pendingImports']) : 0,
          metadataBytes: method === 'inspect' ? weight(['migrationLedger', 'legacyBackup']) : method === 'readWorkspaceRecords' ? 0 : weight([store]),
          unmeasuredValues: 1, hashBytes: 0, writes: 0,
        });
      } finally { h.adapter.close(); }
    });

    it('only yields after transaction completion and preserves cancellation', async () => {
      const h = await createNormalizationHarness(); const w = makeWorkHarness('prerequisite'); let complete = false;
      try {
        await h.adapter.open();
        const open = IDBDatabase.prototype.transaction;
        vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (...args) {
          const tx = open.apply(this, args); tx.addEventListener('complete', () => { complete = true; }); return tx;
        });
        await w.runtime.run((function* () { yield { visits: 1024, utf8Bytes: 0, run() {} }; })());
        w.observe(() => { expect(complete).toBe(true); w.cancel(); });
        await expect(read(h, w.runtime)).rejects.toMatchObject({ name: 'AbortError' });
        expect(w.events.length).toBeGreaterThan(0);
        expect(w.runtime.snapshot().writes).toBe(0);
      } finally { h.adapter.close(); }
    });
  });

describe('cooperative prerequisite bootstrap integration', () => {
  it('does not accumulate prior repair-attempt reservations across contention retries', async () => {
    // Exercise repeated ownership transfer, not unrelated preset/import loading.
    const h = await createNormalizationHarness({ version: 1, legacyValues: {
      [LEGACY_KEYS.projects]: JSON.stringify([makeIncrementalProject(1)]),
    } }); const w = makeWorkHarness('prerequisite');
    const repair = h.adapter.repairHistoricalLineage; const retained: number[] = [];
    vi.spyOn(h.adapter, 'repairHistoricalLineage').mockImplementation(async (prepared, work) => {
      retained.push(w.runtime.snapshot().ownedBytes);
      if (retained.length < 3) throw new WorkspaceStoreError('Retry repair', 'conflict');
      return repair(prepared, work);
    });
    try {
      const result = await h.historical.bootstrap(() => {}, { allowCopiedReplacement: false, work: w.runtime });
      expect(result.status).toBe('admitted');
      expect(retained).toHaveLength(3);
      expect(retained[0]).toBeGreaterThan(0);
      expect(retained[1]).toBe(retained[0]); expect(retained[2]).toBe(retained[0]);
      if (result.status === 'admitted') result.release?.();
      expect(w.runtime.snapshot().ownedBytes).toBe(0);
    } finally { h.adapter.close(); }
  });
  it.each([false, true])('normalization releases admission before its own capture (cancelled=%s)', async cancelled => {
    const h = await createNormalizationHarness({ version: 1 }); const w = makeWorkHarness('prerequisite');
    const bootstrap = h.historical.bootstrap; let handedOff = false;
    vi.spyOn(h.historical, 'bootstrap').mockImplementation(async (emit, options) => {
      const result = await bootstrap(emit, { ...options, work: w.runtime });
      expect(result.status).toBe('admitted');
      expect(w.runtime.snapshot().ownedBytes).toBeGreaterThan(0);
      handedOff = true; return result;
    });
    const repository = createNormalizedRepository(h.environment);
    let independentCaptures = 0;
    h.environment.normalizationPause = point => {
      if (handedOff && point.point === 'after-page') {
        independentCaptures++; expect(w.runtime.snapshot().ownedBytes).toBe(0);
      }
    };
    try {
      const result = await normalizeWorkspace({ repository, historical: h.historical,
        ensurePhysicalLayout: () => h.adapter.open(), assertCurrent: () => {
          if (cancelled && handedOff) throw new DOMException('Cancelled at handoff', 'AbortError');
        } });
      expect(handedOff).toBe(true);
      expect(result.status).toBe(cancelled ? 'unavailable' : 'active');
      if (!cancelled) expect(independentCaptures).toBeGreaterThan(0);
      expect(w.runtime.snapshot().ownedBytes).toBe(0);
    } finally { h.adapter.close(); }
  });

  it('releases captured verification inputs when backup validation fails', async () => {
    const h = await createNormalizationHarness(); const w = makeWorkHarness('prerequisite');
    try {
      await expect(h.historical.readVerificationInputs({ ...h.prepared.ledger, sourceDigest: '0'.repeat(64) }, w.runtime)).rejects.toBeDefined();
      expect(w.runtime.snapshot().ownedHighWater).toBeGreaterThan(0);
      expect(w.runtime.snapshot().ownedBytes).toBe(0);
    } finally { h.adapter.close(); }
  });
  it.each(['copied', 'v1', 'verified'] as const)('transfers the %s admission reservation to an explicit releasable result', async state => {
    const h = await createNormalizationHarness({ version: state === 'v1' ? 1 : 2 });
    const w = makeWorkHarness('prerequisite');
    try {
      if (state === 'verified') { await h.adapter.open(); await h.adapter.markVerified(h.prepared.ledger); }
      const result = await h.historical.bootstrap(() => {}, { allowCopiedReplacement: false, work: w.runtime });
      expect(result.status).toBe('admitted');
      if (result.status !== 'admitted') throw new Error('Expected admission');
      expect(w.runtime.snapshot().ownedBytes).toBeGreaterThan(0);
      const snapshot = result.snapshot;
      result.release?.(); result.release?.();
      expect(w.runtime.snapshot().ownedBytes).toBe(0);
      expect(() => result.snapshot).toThrow('released');
      expect(snapshot.projects.length).toBeGreaterThan(0); // No mutation of borrowed data.
    } finally { h.adapter.close(); }
  });

  it('releases verification inputs explicitly and on bootstrap phase cancellation', async () => {
    const h = await createNormalizationHarness(); const w = makeWorkHarness('prerequisite');
    try {
      const inputs = await h.historical.readVerificationInputs(h.prepared.ledger, w.runtime);
      expect(w.runtime.snapshot().ownedBytes).toBeGreaterThan(0);
      inputs.release?.();
      expect(w.runtime.snapshot().ownedBytes).toBe(0);
      expect(() => inputs.records).toThrow('released');
      let retainedAtFinish = 0;
      await expect(h.historical.bootstrap(phase => {
        if (phase === 'finishing-upgrade') { retainedAtFinish = w.runtime.snapshot().ownedBytes; w.cancel(); }
      }, { allowCopiedReplacement: false, work: w.runtime })).rejects.toMatchObject({ name: 'AbortError' });
      expect(retainedAtFinish).toBeGreaterThan(0);
      expect(w.runtime.snapshot().ownedBytes).toBe(0);
    } finally { h.adapter.close(); }
  });

  it.each(['initial', 'final'] as const)('guards every native legacy read in the %s copied-source check', async point => {
    const h = await createNormalizationHarness(); const w = makeWorkHarness('prerequisite');
    let active = point === 'initial', reads = 0;
    const get = h.legacyStorage.getItem.bind(h.legacyStorage);
    vi.spyOn(h.legacyStorage, 'getItem').mockImplementation(key => {
      const result = get(key);
      if (active && ++reads === 1) w.cancel();
      return result;
    });
    try {
      await expect(h.historical.bootstrap(phase => { if (phase === 'finishing-upgrade') active = true; },
        { allowCopiedReplacement: false, work: w.runtime })).rejects.toMatchObject({ name: 'AbortError' });
      expect(reads).toBe(1);
    } finally { h.adapter.close(); }
  });

  it.each(['copied', 'v1', 'verified'] as const)('admits %s through the invocation runtime', async state => {
    const h = await createNormalizationHarness({ version: state === 'v1' ? 1 : 2 });
    const w = makeWorkHarness('prerequisite');
    try {
      if (state === 'verified') { await h.adapter.open(); await h.adapter.markVerified(h.prepared.ledger); }
      const inspect = vi.spyOn(h.adapter, 'inspect'); const verify = vi.spyOn(h.adapter, 'markVerified');
      const repair = vi.spyOn(h.adapter, 'repairHistoricalLineage'); const replace = vi.spyOn(h.adapter, 'replaceCopiedInitialCopy');
      expect(await h.historical.bootstrap(() => {}, { allowCopiedReplacement: false, work: w.runtime })).toMatchObject({ status: 'admitted' });
      expect(inspect.mock.calls.every(args => args[0] === w.runtime)).toBe(true);
      if (state !== 'verified') expect(verify.mock.calls[0][1]).toBe(w.runtime);
      if (state === 'v1') expect(repair.mock.calls[0][1]).toBe(w.runtime);
      expect(replace).not.toHaveBeenCalled(); expect(w.runtime.snapshot().legacyHashBytes).toBeGreaterThan(0);
    } finally { h.adapter.close(); }
  });

  it.each(['opening-local-storage', 'checking-existing-projects', 'verifying-projects', 'copying-projects', 'finishing-upgrade'] as const)
    ('rejects phase-callback cancellation at %s', async phase => {
      const h = await createNormalizationHarness({ version: phase === 'copying-projects' ? 1 : 2 });
      const w = makeWorkHarness('prerequisite'); const phases: string[] = [];
      try {
        await expect(h.historical.bootstrap(current => { phases.push(current); if (current === phase) w.cancel(); },
          { allowCopiedReplacement: false, work: w.runtime })).rejects.toMatchObject({ name: 'AbortError' });
        expect(phases.at(-1)).toBe(phase);
        if (phase !== 'finishing-upgrade') expect(w.runtime.snapshot().writes).toBe(0);
      } finally { h.adapter.close(); }
    });

  it('does not open storage when the invocation is already cancelled', async () => {
    const h = await createNormalizationHarness(); const w = makeWorkHarness('prerequisite'); w.cancel();
    const open = vi.spyOn(h.adapter, 'open'); const emit = vi.fn();
    try {
      await expect(h.historical.bootstrap(emit, { work: w.runtime, allowCopiedReplacement: false })).rejects.toMatchObject({ name: 'AbortError' });
      expect(open).not.toHaveBeenCalled(); expect(emit).not.toHaveBeenCalled();
    } finally { h.adapter.close(); }
  });

  it('checks lifecycle after opening before starting inspection', async () => {
    const h = await createNormalizationHarness(); const w = makeWorkHarness('prerequisite'); const open = h.adapter.open;
    vi.spyOn(h.adapter, 'open').mockImplementation(async () => { await open(); w.cancel(); });
    const inspect = vi.spyOn(h.adapter, 'inspect');
    try {
      await expect(h.historical.bootstrap(() => {}, { work: w.runtime })).rejects.toMatchObject({ name: 'AbortError' });
      expect(inspect).not.toHaveBeenCalled();
    } finally { h.adapter.close(); }
  });

  it('overrides environment Work for the whole invocation without mutating it', async () => {
    const h = await createNormalizationHarness({ version: 1 });
    const stopped = makeWorkHarness('prerequisite'); stopped.cancel(); const active = makeWorkHarness('prerequisite');
    const environment = { ...h.preparation, adapter: () => h.adapter, legacyStorage: h.legacyStorage, generation: () => 0, work: stopped.runtime };
    const historical = createHistoricalBootstrap(environment);
    try {
      expect(await historical.bootstrap(() => {}, { allowCopiedReplacement: false, work: active.runtime })).toMatchObject({ status: 'admitted' });
      expect(environment.work).toBe(stopped.runtime); expect(active.runtime.snapshot().writes).toBeGreaterThan(0);
      await expect(historical.bootstrap(() => {}, { allowCopiedReplacement: false })).rejects.toMatchObject({ name: 'AbortError' });
    } finally { h.adapter.close(); }
  });

  it('cancels fresh preparation before any copy is written', async () => {
    const h = createIncrementalRepositoryHarness(WORKSPACE_DB_NAME); const w = makeWorkHarness('prerequisite'); w.observe(w.cancel);
    const preparation = deterministicEnvironment({ crypto: webcrypto as unknown as Crypto });
    const adapter = createIndexedDbAdapter({ indexedDB: h.indexedDB, now: preparation.now }, 3);
    const historical = createHistoricalBootstrap({ ...preparation, adapter: () => adapter,
      legacyStorage: memoryStorage(validLegacyValues()), generation: () => 0 });
    try {
      await expect(historical.bootstrap(() => {}, { allowCopiedReplacement: false, work: w.runtime })).rejects.toMatchObject({ name: 'AbortError' });
      expect(w.runtime.snapshot().writes).toBe(0);
      expect(Object.values(await physicalRows(h, historicalStores)).every(rows => rows.length === 0)).toBe(true);
    } finally { adapter.close(); }
  });
});

describe('cooperative prerequisite drift helpers', () => {
  async function setup(changed = true) {
    const h = await createNormalizationHarness(); await h.adapter.open();
    const ledger = await h.adapter.markVerified(h.prepared.ledger);
    if (changed) h.legacyStorage.setItem(LEGACY_KEYS.activeProject, 'changed-project');
    const capture = await h.historical.captureObservedLegacy();
    return { ...h, ledger, capture };
  }

  it('forwards Work to ledger reads and cooperatively recognizes the result', async () => {
    const h = await setup(); const w = makeWorkHarness('prerequisite');
    const reads = vi.spyOn(h.adapter, 'readMigrationLedger');
    try {
      expect(await h.historical.readRecognizedLedger(w.runtime)).toEqual(h.ledger);
      expect(reads).toHaveBeenCalledExactlyOnceWith(w.runtime);
      expect(w.runtime.snapshot().metadataRows).toBe(1);
      expect(w.runtime.snapshot().visits).toBeGreaterThan(10);
    } finally { h.adapter.close(); }
  });

  it('cancels during a large ledger classification without wrapping the abort', async () => {
    const h = await setup(); const w = makeWorkHarness('prerequisite'); w.observe(w.cancel);
    try {
      await mutateRow(h, 'migrationLedger', store => { store.put({ ...h.ledger,
        counts: { ...h.ledger.counts, sourceProjects: 3000, targetProjects: 3000 },
        projectFingerprints: Array.from({ length: 3000 }, (_, sourceIndex) => ({ sourceIndex, id: `p${sourceIndex}`, digest: 'f'.repeat(64) })),
      }); });
      await expect(h.historical.readRecognizedLedger(w.runtime)).rejects.toMatchObject({ name: 'AbortError' });
      expect(w.runtime.snapshot().writes).toBe(0);
    } finally { h.adapter.close(); }
  });

  it.each([false, true])('records drift with the same runtime (known ledger=%s)', async known => {
    const h = await setup(); const w = makeWorkHarness('prerequisite');
    const writes = vi.spyOn(h.adapter, 'markLegacyDrift');
    try {
      const result = await h.historical.recordLegacyDrift(h.capture, known ? h.ledger : undefined, w.runtime);
      expect(result.marker).toMatchObject({ kind: 'legacy-drift', observedLegacyDigest: h.capture.digest });
      expect(result.ledger.ledgerRevision).toBe(h.ledger.ledgerRevision + 1);
      expect(writes).toHaveBeenCalledTimes(1); expect(writes.mock.calls[0][1]).toBe(w.runtime);
      expect(w.runtime.snapshot()).toMatchObject({ writes: 1, metadataRows: known ? 1 : 2 });
    } finally { h.adapter.close(); }
  });

  it.each(['recognize', 'drift'] as const)('does no storage work when already cancelled: %s', async operation => {
    const h = await setup(); const w = makeWorkHarness('prerequisite'); w.cancel();
    const reads = vi.spyOn(h.adapter, 'readMigrationLedger'); const writes = vi.spyOn(h.adapter, 'markLegacyDrift');
    try {
      const promise = operation === 'recognize' ? h.historical.readRecognizedLedger(w.runtime)
        : h.historical.recordLegacyDrift(h.capture, h.ledger, w.runtime);
      await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
      expect(reads).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled();
    } finally { h.adapter.close(); }
  });

  it.each([false, true])('cooperatively retains the no-write path (existing marker=%s)', async existing => {
    const h = await setup(existing); const w = makeWorkHarness('prerequisite');
    try {
      const ledger = existing ? (await h.historical.recordLegacyDrift(h.capture, h.ledger)).ledger : h.ledger;
      const writes = vi.spyOn(h.adapter, 'markLegacyDrift');
      const result = await h.historical.recordLegacyDrift(h.capture, ledger, w.runtime);
      expect(result.ledger).toEqual(ledger); expect(writes).not.toHaveBeenCalled();
      expect(w.runtime.snapshot().visits).toBeGreaterThan(0); expect(w.events).toEqual([]);
    } finally { h.adapter.close(); }
  });

  it('re-reads and recaptures under Work after a real CAS conflict', async () => {
    const h = await setup(); const w = makeWorkHarness('prerequisite');
    try {
      await mutateRow(h, 'migrationLedger', store => { store.put({ ...h.ledger, ledgerRevision: h.ledger.ledgerRevision + 1 }); });
      const writes = vi.spyOn(h.adapter, 'markLegacyDrift'); const reads = vi.spyOn(h.adapter, 'readMigrationLedger');
      const result = await h.historical.recordLegacyDrift(h.capture, h.ledger, w.runtime);
      expect(result.ledger.ledgerRevision).toBe(h.ledger.ledgerRevision + 2);
      expect(writes).toHaveBeenCalledTimes(2); expect(reads).toHaveBeenCalledExactlyOnceWith(w.runtime);
      expect(w.runtime.snapshot()).toMatchObject({ retries: 1, legacyCaptures: 1, writes: 1 });
    } finally { h.adapter.close(); }
  });

  it('does not call the clock or write after UUID generation cancels', async () => {
    const h = await setup(); const w = makeWorkHarness('prerequisite'); const now = vi.fn(h.preparation.now);
    const historical = createHistoricalBootstrap({ ...h.preparation, adapter: () => h.adapter, legacyStorage: h.legacyStorage,
      generation: () => 0, now, randomUUID: () => { w.cancel(); return 'cancelled-id'; } });
    try {
      await expect(historical.recordLegacyDrift(h.capture, h.ledger, w.runtime)).rejects.toMatchObject({ name: 'AbortError' });
      expect(now).not.toHaveBeenCalled(); expect((await h.adapter.readMigrationLedger())).toEqual(h.ledger);
    } finally { h.adapter.close(); }
  });

  it('does not retry cancellation from the durable observer', async () => {
    const h = await setup(); const w = makeWorkHarness('prerequisite'); w.observe(event => { if (event.kind === 'durable') w.cancel(); });
    const writes = vi.spyOn(h.adapter, 'markLegacyDrift'); const reads = vi.spyOn(h.adapter, 'readMigrationLedger');
    try {
      await expect(h.historical.recordLegacyDrift(h.capture, h.ledger, w.runtime)).rejects.toMatchObject({ name: 'AbortError' });
      expect(writes).toHaveBeenCalledTimes(1); expect(reads).not.toHaveBeenCalled();
      expect(w.runtime.snapshot().retries).toBe(0);
    } finally { h.adapter.close(); }
  });

  it.each(['recognize', 'drift'] as const)('uses an invocation override without mutating the environment runtime: %s', async operation => {
    const h = await setup(); const stopped = makeWorkHarness('prerequisite'); stopped.cancel();
    const current = makeWorkHarness('prerequisite');
    const env = { ...h.preparation, adapter: () => h.adapter, legacyStorage: h.legacyStorage, generation: () => 0, work: stopped.runtime };
    const historical = createHistoricalBootstrap(env);
    try {
      const invoke = (work?: typeof current.runtime) => operation === 'recognize'
        ? historical.readRecognizedLedger(work) : historical.recordLegacyDrift(h.capture, h.ledger, work);
      await expect(invoke()).rejects.toMatchObject({ name: 'AbortError' });
      await expect(invoke(current.runtime)).resolves.toBeDefined();
      expect(env.work).toBe(stopped.runtime);
      await expect(invoke()).rejects.toMatchObject({ name: 'AbortError' });
    } finally { h.adapter.close(); }
  });

  it.each([false, true])('preserves ledger read error policy (cancelled=%s)', async cancelled => {
    const h = await setup(); const w = makeWorkHarness('prerequisite');
    vi.spyOn(h.adapter, 'readMigrationLedger').mockImplementation(async () => {
      if (cancelled) w.cancel(); throw new Error('Synthetic read failure');
    });
    try {
      await expect(h.historical.readRecognizedLedger(w.runtime)).rejects.toMatchObject(cancelled ? { name: 'AbortError' } : { code: 'unavailable' });
    } finally { h.adapter.close(); }
  });

  it('keeps the original three-attempt conflict limit and accounts every retry capture', async () => {
    const h = await setup(); const w = makeWorkHarness('prerequisite'); let attempt = 0;
    const mark = h.adapter.markLegacyDrift;
    const writes = vi.spyOn(h.adapter, 'markLegacyDrift').mockImplementation(async (expected, work) => {
      await mutateRow(h, 'migrationLedger', store => { store.put({ ...h.ledger, ledgerRevision: h.ledger.ledgerRevision + ++attempt }); });
      return mark(expected, work);
    });
    try {
      await expect(h.historical.recordLegacyDrift(h.capture, h.ledger, w.runtime)).rejects.toMatchObject({ code: 'conflict', message: 'Legacy recovery marker changed repeatedly.' });
      expect(writes).toHaveBeenCalledTimes(3);
      expect(w.runtime.snapshot()).toMatchObject({ retries: 3, legacyCaptures: 3, writes: 0 });
    } finally { h.adapter.close(); }
  });

  it('adds the observed digest to an older marker without allocating a new identity', async () => {
    const h = await setup(); const w = makeWorkHarness('prerequisite');
    const marker = { id: 'older-marker', kind: 'legacy-drift' as const, detectedAt: h.preparation.now() };
    const ledger = { ...h.ledger, unresolvedRecovery: marker };
    const now = vi.fn(h.preparation.now), randomUUID = vi.fn(h.preparation.randomUUID);
    const historical = createHistoricalBootstrap({ ...h.preparation, adapter: () => h.adapter, legacyStorage: h.legacyStorage,
      generation: () => 0, now, randomUUID });
    try {
      await mutateRow(h, 'migrationLedger', store => { store.put(ledger); });
      const result = await historical.recordLegacyDrift(h.capture, ledger, w.runtime);
      expect(result.marker).toEqual({ ...marker, observedLegacyDigest: h.capture.digest });
      expect(now).not.toHaveBeenCalled(); expect(randomUUID).not.toHaveBeenCalled();
    } finally { h.adapter.close(); }
  });
});

describe.each(['inspect', 'readWorkspaceRecords'] as const)('cooperative prerequisite %s collection', method => {
  const stores = method === 'inspect' ? ['projects', 'workspace', 'presets', 'pendingImports', 'migrationLedger', 'legacyBackup']
    : ['projects', 'workspace', 'presets', 'pendingImports'];
  async function setup() {
    const h = await createNormalizationHarness({ legacyValues: { ...validLegacyValues(),
      [LEGACY_KEYS.projects]: JSON.stringify(['project-z', 'project-a'].map(id => ({ ...makeIncrementalProject(1), id }))),
    } });
    await h.adapter.open(); return h;
  }

  it('retains key order and workspace selection in one readonly transaction without getAll', async () => {
    const h = await setup(); const w = makeWorkHarness('prerequisite');
    try {
      await mutateRow(h, 'workspace', store => { store.put({ id: 'other', extension: new Map([['key', 1n]]) }); });
      const expected = await h.adapter[method]();
      const all = vi.spyOn(FakeObjectStore.prototype, 'getAll');
      const transactions = vi.spyOn(IDBDatabase.prototype, 'transaction');
      const cursor = vi.spyOn(FakeObjectStore.prototype, 'openCursor');
      await w.runtime.run((function* () { yield { visits: 1024, utf8Bytes: 0, run() {} }; })());
      expect(await h.adapter[method](w.runtime)).toEqual(expected);
      expect(all).not.toHaveBeenCalled(); expect(transactions).toHaveBeenCalledTimes(1);
      expect(transactions.mock.calls[0][1]).toBe('readonly');
      expect(cursor).toHaveBeenCalledTimes(stores.length);
      expect(w.runtime.snapshot()).toMatchObject({ candidateRows: method === 'inspect' ? 6 : 5,
        metadataRows: method === 'inspect' ? 2 : 0, eofChecks: stores.length, writes: 0, hashBytes: 0 });
      expect(w.runtime.snapshot().yields).toBeGreaterThan(0); // Posttransaction measurement only.
    } finally { h.adapter.close(); }
  });

  it('retains empty arrays and missing current workspace', async () => {
    const h = await setup(); const w = makeWorkHarness('prerequisite');
    try {
      for (const name of stores) await mutateRow(h, name, store => { store.clear(); });
      expect(await h.adapter[method](w.runtime)).toEqual(await h.adapter[method]());
      expect(w.runtime.snapshot()).toMatchObject({ candidateRows: 0, metadataRows: 0, eofChecks: stores.length });
    } finally { h.adapter.close(); }
  });

  it.each(['before', 'row', 'eof', 'complete'] as const)('settles cancellation at %s without publishing a partial collection', async point => {
    const h = await setup(); const w = makeWorkHarness('prerequisite');
    let settled = false;
    const open = FakeObjectStore.prototype.openCursor;
    const spy = vi.spyOn(FakeObjectStore.prototype, 'openCursor').mockImplementation(function (...args) {
      this.transaction.addEventListener('complete', () => { settled = true; if (point === 'complete') w.cancel(); }, { once: true });
      this.transaction.addEventListener('abort', () => { settled = true; }, { once: true });
      const result = open.apply(this, args);
      if (this.name === 'projects') result.addEventListener('success', () => {
        if (point === 'row' && result.result || point === 'eof' && !result.result) w.cancel();
      });
      return result;
    });
    if (point === 'before') w.cancel();
    try {
      await expect(h.adapter[method](w.runtime)).rejects.toMatchObject({ name: 'AbortError' });
      expect(settled).toBe(point !== 'before');
      expect(spy).toHaveBeenCalledTimes(point === 'before' ? 0 : point === 'complete' ? stores.length : 1);
      expect(w.events).toEqual([]); expect(w.runtime.snapshot().writes).toBe(0);
    } finally { spy.mockRestore(); h.adapter.close(); }
  });

  it('returns a coherent pre-write image while a competing writer waits', async () => {
    const h = await setup(); const w = makeWorkHarness('prerequisite');
    const db = await request(h.indexedDB.open(h.databaseName));
    const expected = await h.adapter[method]();
    let writer: Promise<void> | undefined;
    const open = FakeObjectStore.prototype.openCursor;
    const spy = vi.spyOn(FakeObjectStore.prototype, 'openCursor').mockImplementation(function (...args) {
      const result = open.apply(this, args);
      if (this.name === 'projects') result.addEventListener('success', () => {
        const tx = db.transaction(['projects', 'workspace'], 'readwrite'); writer = done(tx);
        tx.objectStore('projects').put({ ...h.prepared.projects[0], extra: 'concurrent' });
        tx.objectStore('workspace').put({ ...h.prepared.workspace, extra: 'concurrent' });
      }, { once: true });
      return result;
    });
    try {
      expect(await h.adapter[method](w.runtime)).toEqual(expected);
      expect(writer).toBeDefined(); await writer; spy.mockRestore();
      expect(await h.adapter[method]()).not.toEqual(expected);
    } finally { spy.mockRestore(); db.close(); h.adapter.close(); }
  });

  it('maps a later cursor failure after settling the readonly transaction', async () => {
    const h = await setup(); const w = makeWorkHarness('prerequisite');
    const open = FakeObjectStore.prototype.openCursor; let settled = false;
    const spy = vi.spyOn(FakeObjectStore.prototype, 'openCursor').mockImplementation(function (...args) {
      this.transaction.addEventListener('abort', () => { settled = true; }, { once: true });
      if (this.name === 'workspace') throw new DOMException('Synthetic read failure', 'UnknownError');
      return open.apply(this, args);
    });
    try {
      await expect(h.adapter[method](w.runtime)).rejects.toMatchObject({ code: 'io' });
      expect(settled).toBe(true); expect(w.events).toEqual([]);
    } finally { spy.mockRestore(); h.adapter.close(); }
  });

  if (method === 'inspect') it('rejects normalization archives encountered by cursor', async () => {
    const h = await setup(); const w = makeWorkHarness('prerequisite');
    try {
      await mutateRow(h, 'legacyBackup', store => { store.put({ id: 'archive', kind: 'normalization-source' }); });
      await expect(h.adapter.inspect(w.runtime)).rejects.toMatchObject({ code: 'authority-lost' });
      expect(w.runtime.snapshot().metadataRows).toBeGreaterThan(0); expect(w.events).toEqual([]);
    } finally { h.adapter.close(); }
  });
});

it.each([false, true])('forwards the verification runtime to each captured backup (distinct=%s)', async distinct => {
  const h = await createNormalizationHarness(); const w = makeWorkHarness('prerequisite');
  try {
    await h.adapter.open();
    const ledger = { ...h.prepared.ledger };
    if (distinct) {
      ledger.acceptedLegacyBackupId = 'accepted-backup';
      await mutateRow(h, 'legacyBackup', store => { store.put({ ...h.prepared.backup, id: ledger.acceptedLegacyBackupId }); });
    }
    const reads = vi.spyOn(h.adapter, 'readLegacyBackup');
    const source = vi.spyOn(h.adapter, 'readWorkspaceRecords');
    await h.historical.readVerificationInputs(ledger, w.runtime);
    expect(source).toHaveBeenCalledExactlyOnceWith(w.runtime);
    expect(w.runtime.snapshot().candidateRows).toBe(4);
    expect(reads).toHaveBeenCalledTimes(distinct ? 2 : 1);
    expect(reads).toHaveBeenCalledWith(ledger.originalLegacyBackupId, w.runtime);
    if (distinct) expect(reads).toHaveBeenCalledWith(ledger.acceptedLegacyBackupId, w.runtime);
    expect(w.runtime.snapshot().metadataRows).toBe(distinct ? 2 : 1);
  } finally { h.adapter.close(); }
});

describe.each(['migrationLedger', 'legacyBackup'] as const)('cooperative prerequisite %s single-row reads', storeName => {
  async function setup() {
    const h = await createNormalizationHarness(); await h.adapter.open();
    const row = storeName === 'migrationLedger' ? h.prepared.ledger : h.prepared.backup;
    const read = (work?: ReturnType<typeof makeWorkHarness>['runtime']) => storeName === 'migrationLedger'
      ? h.adapter.readMigrationLedger(work) : h.adapter.readLegacyBackup(row.id, work);
    return { ...h, row, read };
  }

  it.each([false, true])('returns the original value with one readonly request (missing=%s)', async missing => {
    const h = await setup(); const w = makeWorkHarness('prerequisite');
    try {
      if (missing) await mutateRow(h, storeName, store => { store.delete(h.row.id); });
      const get = FakeObjectStore.prototype.get;
      const spy = vi.spyOn(FakeObjectStore.prototype, 'get').mockImplementation(function (key) {
        expect(this.name).toBe(storeName); expect(this.transaction.mode).toBe('readonly');
        expect(Array.from(this.transaction.objectStoreNames)).toEqual([storeName]);
        return get.call(this, key);
      });
      await w.runtime.run((function* () { yield { visits: 1024, utf8Bytes: 0, run() {} }; })());
      expect(await h.read(w.runtime)).toEqual(missing ? undefined : h.row);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(w.runtime.snapshot()).toMatchObject({ metadataRows: missing ? 0 : 1, writes: 0, hashBytes: 0 });
      if (missing) {
        expect(w.runtime.snapshot()).toMatchObject({ primitiveExceptions: 1, yields: 0, metadataBytes: 0 });
        expect(w.events).toEqual([]);
      } else {
        expect(w.runtime.snapshot().metadataBytes).toBe(runSync(rawValueWeightWork(h.row)).bytes);
        expect(w.runtime.snapshot().yields).toBeGreaterThan(0);
      }
    } finally { h.adapter.close(); }
  });

  it.each(['before', 'request-success', 'complete'] as const)('rejects cancellation at %s after settling the read', async point => {
    const h = await setup(); const w = makeWorkHarness('prerequisite');
    let settled = false;
    const get = FakeObjectStore.prototype.get;
    const spy = vi.spyOn(FakeObjectStore.prototype, 'get').mockImplementation(function (key) {
      this.transaction.addEventListener('complete', () => { settled = true; if (point === 'complete') w.cancel(); }, { once: true });
      this.transaction.addEventListener('abort', () => { settled = true; }, { once: true });
      const result = get.call(this, key);
      if (point === 'request-success') result.addEventListener('success', w.cancel, { once: true });
      return result;
    });
    if (point === 'before') w.cancel();
    try {
      await expect(h.read(w.runtime)).rejects.toMatchObject({ name: 'AbortError' });
      expect(spy).toHaveBeenCalledTimes(point === 'before' ? 0 : 1);
      expect(settled).toBe(point !== 'before');
      spy.mockRestore();
      expect((await physicalRows(h, [storeName]))[storeName]).toEqual([h.row]);
      expect(w.events).toEqual([]);
    } finally { spy.mockRestore(); h.adapter.close(); }
  });

  it.each([false, true])('preserves failure mapping unless lifecycle stopped (cancelled=%s)', async cancelled => {
    const h = await setup(); const w = makeWorkHarness('prerequisite');
    const get = FakeObjectStore.prototype.get; let settled = false;
    const spy = vi.spyOn(FakeObjectStore.prototype, 'get').mockImplementation(function (key) {
      this.transaction.addEventListener('abort', () => { settled = true; }, { once: true });
      const result = get.call(this, key);
      result.addEventListener('success', () => { if (cancelled) w.cancel(); this.transaction.abort(); }, { once: true });
      return result;
    });
    try {
      await expect(h.read(w.runtime)).rejects.toMatchObject(cancelled ? { name: 'AbortError' } : { code: 'io' });
      expect(settled).toBe(true); expect(w.events).toEqual([]);
    } finally { spy.mockRestore(); h.adapter.close(); }
  });

  it('does not add JSON admission rules while reading unclassified metadata', async () => {
    const h = await setup(); const w = makeWorkHarness('prerequisite');
    const raw = { ...h.row, extension: { count: 1n, when: new Date('2020-01-01'), values: new Map([['key', 2]]) } };
    try {
      await mutateRow(h, storeName, store => { store.put(raw); });
      expect(await h.read(w.runtime)).toEqual(await h.read());
      expect(w.runtime.snapshot().metadataRows).toBe(1);
    } finally { h.adapter.close(); }
  });

  if (storeName === 'legacyBackup') it('still rejects a normalization archive rather than returning it as a backup', async () => {
    const h = await setup(); const w = makeWorkHarness('prerequisite');
    try {
      await mutateRow(h, storeName, store => { store.put({ id: h.row.id, kind: 'normalization-source' }); });
      await expect(h.read(w.runtime)).rejects.toMatchObject({ code: 'authority-lost' });
      expect(w.runtime.snapshot().metadataRows).toBe(1); expect(w.events).toEqual([]);
    } finally { h.adapter.close(); }
  });
});

describe('cooperative prerequisite lineage transactions', () => {
  async function setup(ids = ['project-z', 'project-a']) {
    const h = await createNormalizationHarness({ version: 1, legacyValues: { ...validLegacyValues(),
      [LEGACY_KEYS.projects]: JSON.stringify(ids.map(id => ({ ...makeIncrementalProject(1), id }))),
    } });
    const prepared = await prepareLineageRepair(h.source.migrationLedger[0] as HistoricalMigrationLedgerV1,
      { ...h.source, workspace: h.source.workspace[0] }, h.preparation);
    await h.adapter.open();
    return { ...h, repair: prepared };
  }

  it('reads projects once by cursor and writes in preparation order without in-transaction yields', async () => {
    const h = await setup(); const w = makeWorkHarness('prerequisite');
    // Canonical record equality must ignore object member insertion order.
    for (const expected of h.repair.expectedProjects) expected.record = Object.fromEntries(Object.entries(expected.record as object).reverse());
    const keys = vi.spyOn(FakeObjectStore.prototype, 'getAllKeys');
    const reads = vi.spyOn(FakeObjectStore.prototype, 'get');
    const cursor = vi.spyOn(FakeObjectStore.prototype, 'openCursor');
    const put = FakeObjectStore.prototype.put;
    const written: string[] = []; let pending = false, committed = false;
    const spy = vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(function (value, key) {
      expect(pending).toBe(false); pending = true; written.push(value.id);
      this.transaction.addEventListener('complete', () => { committed = true; }, { once: true });
      const result = put.call(this, value, key);
      result.addEventListener('success', () => { pending = false; }, { once: true });
      return result;
    });
    const committedAtObservation: boolean[] = [];
    w.observe(() => { committedAtObservation.push(committed); });
    try {
      await h.adapter.repairHistoricalLineage(h.repair, w.runtime);
      expect(keys).not.toHaveBeenCalled(); expect(reads).toHaveBeenCalledTimes(1);
      expect(cursor).toHaveBeenCalledTimes(1);
      expect(written).toEqual([...h.repair.replacementProjects.map(row => row.id), h.repair.ledger.id]);
      expect(w.runtime.snapshot()).toMatchObject({ candidateRows: 2, metadataRows: 1, markerCasRows: 1, writes: 3, hashBytes: 0 });
      expect(w.events.filter(event => event.kind === 'durable')).toHaveLength(1);
      expect(w.runtime.snapshot().yields).toBeGreaterThan(0);
      expect(committedAtObservation.every(Boolean)).toBe(true);
      spy.mockRestore();
      const actual = await physicalRows(h, historicalStores);
      expect(actual.projects).toEqual([...h.repair.replacementProjects].sort((a, b) => a.id.localeCompare(b.id)));
      expect(actual.migrationLedger).toEqual([h.repair.ledger]);
      expect(actual.legacyBackup).toEqual(h.source.legacyBackup);
    } finally { spy.mockRestore(); h.adapter.close(); }
  });

  it('retains repair-index reservation through durable notification and releases afterward', async () => {
    const h = await setup(); const w = makeWorkHarness('prerequisite');
    const bytes = h.repair.expectedProjects.reduce((sum, row) => sum + 16 + new TextEncoder().encode(row.id).length, 0);
    const get = FakeObjectStore.prototype.get;
    const reads = vi.spyOn(FakeObjectStore.prototype, 'get').mockImplementation(function (key) {
      expect(w.runtime.snapshot().ownedBytes).toBe(bytes);
      return get.call(this, key);
    });
    const observedOwnership: number[] = [];
    w.observe(event => { observedOwnership.push(event.counters.ownedBytes); });
    try {
      await h.adapter.repairHistoricalLineage(h.repair, w.runtime);
      expect(reads).toHaveBeenCalledTimes(1);
      expect(observedOwnership.length).toBeGreaterThan(0);
      expect(observedOwnership.every(value => value >= bytes)).toBe(true);
      expect(w.runtime.snapshot()).toMatchObject({ ownedBytes: 0, captureGraphs: 0 });
      expect(w.runtime.snapshot().ownedHighWater).toBeGreaterThanOrEqual(bytes);
    } finally { h.adapter.close(); }
  });

  it('counts each observed repair-row frame once without hashing or an extra read', async () => {
    const h = await setup(['project-é😀', 'project-a']); const w = makeWorkHarness('prerequisite');
    const expectedBytes = h.source.projects.reduce((sum, row) => sum + new TextEncoder().encode(canonicalStringify(row)).length, 0);
    const cursor = vi.spyOn(FakeObjectStore.prototype, 'openCursor');
    const gets = vi.spyOn(FakeObjectStore.prototype, 'get');
    try {
      await h.adapter.repairHistoricalLineage(h.repair, w.runtime);
      expect(w.runtime.snapshot()).toMatchObject({ candidateRows: 2, candidateBytes: expectedBytes,
        unmeasuredValues: 0, hashBytes: 0, captureGraphs: 0 });
      expect(cursor).toHaveBeenCalledTimes(1);
      expect(gets).toHaveBeenCalledTimes(1); // Ledger CAS only.
    } finally { h.adapter.close(); }
  });

  it.each(['mismatch', 'non-json'] as const)('flags incomplete repair-row comparison weights on %s', async kind => {
    const h = await setup(); const w = makeWorkHarness('prerequisite');
    try {
      const row = h.source.projects.find(project => project.id === 'project-a')!;
      const changed = { ...row, project: { ...row.project, name: kind === 'mismatch' ? 'changed' : 1n } };
      await mutateRow(h, 'projects', store => { store.put(changed); });
      await expect(h.adapter.repairHistoricalLineage(h.repair, w.runtime)).rejects.toMatchObject({ code: kind === 'mismatch' ? 'conflict' : 'io' });
      expect(w.runtime.snapshot()).toMatchObject({ candidateRows: 1, unmeasuredValues: 1, writes: 0, ownedBytes: 0 });
      expect(w.runtime.snapshot().candidateBytes).toBeGreaterThan(0);
      expect((await physicalRows(h, ['migrationLedger'])).migrationLedger).toEqual(h.source.migrationLedger);
    } finally { h.adapter.close(); }
  });

  it.each([false, true])('measures the repair ledger after commit (cancelled=%s)', async cancelled => {
    const h = await setup(); const w = makeWorkHarness('prerequisite'); let committed = false;
    const committedAtObservation: boolean[] = [];
    const put = FakeObjectStore.prototype.put;
    vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(function (value, key) {
      this.transaction.addEventListener('complete', () => { committed = true; }, { once: true });
      return put.call(this, value, key);
    });
    w.observe(event => {
      committedAtObservation.push(committed);
      if (cancelled && event.kind === 'work') w.cancel();
    });
    try {
      if (cancelled) await expect(h.adapter.repairHistoricalLineage(h.repair, w.runtime)).rejects.toMatchObject({ name: 'AbortError' });
      else {
        await h.adapter.repairHistoricalLineage(h.repair, w.runtime);
        expect(w.runtime.snapshot().metadataBytes).toBe(runSync(rawValueWeightWork(h.repair.expectedLedger)).bytes);
        expect(w.runtime.snapshot().markerWorkBytes).toBe(runSync(rawValueWeightWork(h.repair.expectedLedger)).bytes
          + runSync(rawValueWeightWork(h.repair.ledger)).bytes);
      }
      expect(w.events.some(event => event.kind === 'work')).toBe(true);
      expect(committedAtObservation.every(Boolean)).toBe(true);
      expect(w.runtime.snapshot().ownedBytes).toBe(0);
      expect((await physicalRows(h, ['migrationLedger'])).migrationLedger).toEqual([h.repair.ledger]);
    } finally { h.adapter.close(); }
  });

  it('accounts a failed repair ledger CAS after abort and releases its reservation', async () => {
    const h = await setup(); const w = makeWorkHarness('prerequisite');
    const ledger = { ...h.repair.expectedLedger, ledgerRevision: h.repair.expectedLedger.ledgerRevision + 1 };
    try {
      await mutateRow(h, 'migrationLedger', store => { store.put(ledger); });
      await expect(h.adapter.repairHistoricalLineage(h.repair, w.runtime)).rejects.toMatchObject({ code: 'conflict' });
      expect(w.runtime.snapshot()).toMatchObject({ ownedBytes: 0, writes: 0,
        metadataBytes: runSync(rawValueWeightWork(ledger)).bytes,
        markerWorkBytes: runSync(rawValueWeightWork(ledger)).bytes });
    } finally { h.adapter.close(); }
  });

  it('releases repair-index reservation when database acquisition fails', async () => {
    const h = await setup(); const w = makeWorkHarness('prerequisite'); h.adapter.close();
    const failure = new Error('database acquisition failed');
    const open = vi.spyOn(h.indexedDB, 'open').mockImplementation(() => { throw failure; });
    try {
      await expect(h.adapter.repairHistoricalLineage(h.repair, w.runtime)).rejects.toThrow();
      expect(w.runtime.snapshot().ownedHighWater).toBeGreaterThan(0);
      expect(w.runtime.snapshot()).toMatchObject({ ownedBytes: 0, writes: 0 });
    } finally { open.mockRestore(); h.adapter.close(); }
  });

  it.each(['before', 'index', 'cursor', 'put-success', 'durable'] as const)('handles cancellation at %s without partial lineage', async point => {
    const h = await setup(); const w = makeWorkHarness('prerequisite');
    let ownedAtAbort: number | undefined;
    if (point === 'before') w.cancel();
    if (point === 'index') {
      h.repair.expectedProjects = Array.from({ length: 3000 }, (_, index) => ({ id: `p${index}`, record: {} }));
      w.observe(w.cancel);
    }
    if (point === 'durable') w.observe(event => { if (event.kind === 'durable') w.cancel(); });
    const openCursor = FakeObjectStore.prototype.openCursor;
    const cursor = vi.spyOn(FakeObjectStore.prototype, 'openCursor').mockImplementation(function (...args) {
      this.transaction.addEventListener('abort', () => { ownedAtAbort = w.runtime.snapshot().ownedBytes; }, { once: true });
      const result = openCursor.apply(this, args);
      if (point === 'cursor') result.addEventListener('success', w.cancel, { once: true });
      return result;
    });
    const put = FakeObjectStore.prototype.put;
    const writes = vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(function (value, key) {
      const result = put.call(this, value, key);
      if (point === 'put-success') result.addEventListener('success', w.cancel, { once: true });
      return result;
    });
    try {
      await expect(h.adapter.repairHistoricalLineage(h.repair, w.runtime)).rejects.toMatchObject({ name: 'AbortError' });
      expect(w.runtime.snapshot().ownedBytes).toBe(0);
      if (point !== 'before') expect(w.runtime.snapshot().ownedHighWater).toBeGreaterThan(0);
      if (point === 'cursor' || point === 'put-success') expect(ownedAtAbort).toBeGreaterThan(0);
      expect(writes).toHaveBeenCalledTimes(point === 'durable' ? 3 : point === 'put-success' ? 1 : 0);
      cursor.mockRestore(); writes.mockRestore();
      const actual = await physicalRows(h, historicalStores);
      if (point === 'durable') {
        expect(actual.migrationLedger).toEqual([h.repair.ledger]);
        expect(actual.projects.every(row => typeof row.incarnation === 'string')).toBe(true);
      } else expect(actual).toEqual(Object.fromEntries(historicalStores.map(name => [name,
        name === 'projects' ? [...h.source.projects].sort((a, b) => a.id.localeCompare(b.id)) : h.source[name]])));
    } finally { cursor.mockRestore(); writes.mockRestore(); h.adapter.close(); }
  });

  it.each(['lineage-repair.before-transaction', 'lineage-repair.after-project-write',
    'lineage-repair.after-ledger-write', 'lineage-repair.before-complete'] as const)('rolls back cancellation at %s', async point => {
    const h = await setup(); const w = makeWorkHarness('prerequisite'); h.adapter.close();
    const faults: string[] = [];
    const adapter = createIndexedDbAdapter({ indexedDB: h.indexedDB, now: h.preparation.now,
      fault: current => { faults.push(current); if (current === point) w.cancel(); } }, 3);
    try {
      await adapter.open(); const before = await physicalRows(h, historicalStores);
      await expect(adapter.repairHistoricalLineage(h.repair, w.runtime)).rejects.toMatchObject({ name: 'AbortError' });
      expect(faults.at(-1)).toBe(point);
      if (point === 'lineage-repair.after-project-write') expect(w.runtime.snapshot().writes).toBe(1);
      expect(await physicalRows(h, historicalStores)).toEqual(before);
    } finally { adapter.close(); }
  });

  it.each(['ledger', 'record', 'missing', 'extra', 'duplicate', 'reservation'] as const)('rejects %s mismatch before any replacement', async change => {
    const h = await setup(); const w = makeWorkHarness('prerequisite');
    try {
      if (change === 'ledger') h.repair.expectedLedger = { ...h.repair.expectedLedger, sourceDigest: 'f'.repeat(64) };
      if (change === 'record') h.repair.expectedProjects[0].record = { ...(h.repair.expectedProjects[0].record as object), extra: true };
      if (change === 'missing') h.repair.expectedProjects.pop();
      if (change === 'extra') h.repair.expectedProjects.push({ id: 'extra', record: {} });
      if (change === 'duplicate') h.repair.expectedProjects.push(h.repair.expectedProjects[0]);
      if (change === 'reservation') await mutateRow(h, 'normalizationLedger', store => { store.put({ id: NORMALIZATION_LEDGER_ID, state: 'staging' }); });
      const before = await physicalRows(h, historicalStores);
      await expect(h.adapter.repairHistoricalLineage(h.repair, w.runtime)).rejects.toMatchObject({ code: 'conflict' });
      expect(w.runtime.snapshot().writes).toBe(0);
      expect(await physicalRows(h, historicalStores)).toEqual(before);
    } finally { h.adapter.close(); }
  });

  it('does not equate a numeric primary key with the expected string key', async () => {
    const h = await setup(); const w = makeWorkHarness('prerequisite');
    try {
      const row = { ...(h.repair.expectedProjects[0].record as object), id: 1 };
      await mutateRow(h, 'projects', store => { store.delete(h.repair.expectedProjects[0].id); store.put(row); });
      h.repair.expectedProjects[0] = { id: '1', record: row };
      const before = await physicalRows(h, historicalStores);
      await expect(h.adapter.repairHistoricalLineage(h.repair, w.runtime)).rejects.toMatchObject({ code: 'conflict' });
      expect(await physicalRows(h, historicalStores)).toEqual(before);
    } finally { h.adapter.close(); }
  });

  it.each([0, 1])('preserves existing incarnations with %i replacement rows', async remaining => {
    const h = await setup(); const w = makeWorkHarness('prerequisite');
    const all = [...h.repair.replacementProjects];
    try {
      for (const row of all.slice(remaining)) {
        await mutateRow(h, 'projects', store => { store.put(row); });
        h.repair.expectedProjects.find(expected => expected.id === row.id)!.record = row;
      }
      h.repair.replacementProjects = all.slice(0, remaining);
      await h.adapter.repairHistoricalLineage(h.repair, w.runtime);
      expect(w.runtime.snapshot().writes).toBe(remaining + 1);
      expect((await physicalRows(h, ['projects'])).projects).toEqual(all.sort((a, b) => a.id.localeCompare(b.id)));
    } finally { h.adapter.close(); }
  });

  it('rolls back earlier writes when the second put fails', async () => {
    const h = await setup(); const w = makeWorkHarness('prerequisite');
    const before = await physicalRows(h, historicalStores);
    const put = FakeObjectStore.prototype.put; let attempts = 0;
    const spy = vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(function (value, key) {
      if (++attempts === 2) throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
      return put.call(this, value, key);
    });
    try {
      await expect(h.adapter.repairHistoricalLineage(h.repair, w.runtime)).rejects.toMatchObject({ code: 'quota' });
      expect(attempts).toBe(2); expect(w.events.every(event => event.kind === 'work')).toBe(true);
      expect(w.runtime.snapshot().ownedBytes).toBe(0);
      spy.mockRestore();
      expect(await physicalRows(h, historicalStores)).toEqual(before);
    } finally { spy.mockRestore(); h.adapter.close(); }
  });

  it.each([510, 513])('retains whole-record canonical depth semantics at depth %i', async depth => {
    for (const cooperative of [false, true]) {
      const h = await setup(); const w = makeWorkHarness('prerequisite');
      let nested: unknown = 'leaf';
      for (let i = 0; i < depth; i++) nested = { child: nested };
      const row = { ...(h.repair.expectedProjects[0].record as { id: string }), extension: nested };
      try {
        await mutateRow(h, 'projects', store => { store.put(row); });
        h.repair.expectedProjects[0].record = row;
        const operation = h.adapter.repairHistoricalLineage(h.repair, cooperative ? w.runtime : undefined);
        if (depth === 510) await expect(operation).resolves.toBeUndefined();
        else {
          await expect(operation).rejects.toMatchObject({ code: 'io' });
          expect((await physicalRows(h, ['migrationLedger'])).migrationLedger).toEqual([h.repair.expectedLedger]);
        }
      } finally { h.adapter.close(); }
    }
  });
});

describe.each(['verification', 'drift'] as const)('cooperative prerequisite %s marker transactions', kind => {
  async function setup(version = 3) {
    const h = createIncrementalRepositoryHarness(WORKSPACE_DB_NAME);
    const preparation = deterministicEnvironment({ crypto: webcrypto as unknown as Crypto });
    const prepared = await prepareInitialCopy(legacySnapshot(validLegacyValues()), preparation);
    Object.assign(prepared.ledger, { extension: { preserved: ['😀', 'x'.repeat(2048)] } });
    const adapter = createIndexedDbAdapter({ indexedDB: h.indexedDB, now: preparation.now }, version);
    await adapter.open(); await adapter.writeInitialCopy(prepared);
    const before = kind === 'verification' ? prepared.ledger : await adapter.markVerified(prepared.ledger);
    const drift = { expectedLedgerRevision: before.ledgerRevision,
      expectedAcceptedLegacyDigest: before.acceptedLegacyDigest, expectedRecoveryId: null,
      marker: { id: 'drift', kind: 'legacy-drift' as const, detectedAt: preparation.now(), observedLegacyDigest: 'f'.repeat(64) } };
    const invoke = (work?: ReturnType<typeof makeWorkHarness>['runtime']) => kind === 'verification'
      ? adapter.markVerified(before, work) : adapter.markLegacyDrift(drift, work);
    return { ...h, adapter, before, drift, invoke };
  }

  it.each([2, 3])('preserves marker fields at physical version %i and reports only after commit', async version => {
    const h = await setup(version); const w = makeWorkHarness('prerequisite');
    let committed = false;
    const committedAtObservation: boolean[] = [];
    const put = FakeObjectStore.prototype.put;
    const spy = vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(function (value, key) {
      this.transaction.addEventListener('complete', () => { committed = true; }, { once: true });
      return put.call(this, value, key);
    });
    w.observe(() => { committedAtObservation.push(committed); });
    try {
      await w.runtime.run((function* () { yield { visits: 1024, utf8Bytes: 0, run() {} }; })());
      const actual = await h.invoke(w.runtime);
      expect(actual).toEqual({ ...h.before, ledgerRevision: h.before.ledgerRevision + 1,
        ...(kind === 'verification' ? { state: 'verified', verifiedAt: '2026-08-14T15:00:00.000Z' }
          : { unresolvedRecovery: h.drift.marker }) });
      expect((await physicalRows(h, ['migrationLedger'])).migrationLedger).toEqual([actual]);
      expect(w.runtime.snapshot()).toMatchObject({ writes: 1, metadataRows: 1, markerCasRows: 1, hashBytes: 0,
        metadataBytes: runSync(rawValueWeightWork(h.before)).bytes });
      expect(w.runtime.snapshot().primitiveExceptions).toBeGreaterThanOrEqual(3);
      expect(w.events.filter(event => event.kind === 'durable')).toHaveLength(1);
      expect(w.runtime.snapshot().yields).toBeGreaterThan(0);
      expect(committedAtObservation.every(Boolean)).toBe(true);
    } finally { spy.mockRestore(); h.adapter.close(); }
  });

  it('measures the captured marker, including opaque extensions, after commit', async () => {
    const h = await setup(); const w = makeWorkHarness('prerequisite');
    const before = { ...h.before, extra: new Map([['kept', 1n]]) };
    try {
      await mutateRow(h, 'migrationLedger', store => { store.put(before); });
      let committed = false;
      const committedAtObservation: boolean[] = [];
      const put = FakeObjectStore.prototype.put;
      vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(function (value, key) {
        this.transaction.addEventListener('complete', () => { committed = true; }, { once: true });
        return put.call(this, value, key);
      });
      w.observe(() => { committedAtObservation.push(committed); });
      const result = await h.invoke(w.runtime);
      expect(result).toMatchObject({ extra: before.extra });
      expect(w.runtime.snapshot()).toMatchObject({ metadataRows: 1,
        metadataBytes: runSync(rawValueWeightWork(before)).bytes, unmeasuredValues: 2, writes: 1, hashBytes: 0 });
      expect(w.runtime.snapshot().markerWorkBytes).toBe(runSync(rawValueWeightWork(before)).bytes
        + 2 * runSync(rawValueWeightWork(result)).bytes);
      expect(w.runtime.snapshot()).toMatchObject({ ownedBytes: 0 });
      expect(w.runtime.snapshot().ownedHighWater).toBeGreaterThan(0);
      expect(w.events.some(event => event.kind === 'work')).toBe(true);
      expect(committedAtObservation.every(Boolean)).toBe(true);
    } finally { h.adapter.close(); }
  });

  it.each(['conflict', 'quota', 'cancel-after-abort'] as const)('accounts the captured marker after %s without losing its original outcome', async failure => {
    const h = await setup(); const w = makeWorkHarness('prerequisite');
    const before = failure === 'conflict' ? { ...h.before, ledgerRevision: h.before.ledgerRevision + 1 } : h.before;
    let settled = false; const observedSettled: boolean[] = [];
    try {
      if (failure === 'conflict') await mutateRow(h, 'migrationLedger', store => { store.put(before); });
      const get = FakeObjectStore.prototype.get;
      vi.spyOn(FakeObjectStore.prototype, 'get').mockImplementation(function (key) {
        this.transaction.addEventListener('abort', () => { settled = true; }, { once: true });
        return get.call(this, key);
      });
      if (failure !== 'conflict') vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(() => {
        throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
      });
      w.observe(event => {
        observedSettled.push(settled);
        if (failure === 'cancel-after-abort' && event.kind === 'work') w.cancel();
      });
      await expect(h.invoke(w.runtime)).rejects.toMatchObject(failure === 'cancel-after-abort' ? { name: 'AbortError' } : { code: failure });
      expect(observedSettled.length).toBeGreaterThan(0);
      expect(observedSettled.every(Boolean)).toBe(true);
      expect(w.runtime.snapshot().ownedBytes).toBe(0);
      if (failure !== 'cancel-after-abort') {
        expect(w.runtime.snapshot().metadataBytes).toBe(runSync(rawValueWeightWork(before)).bytes);
        expect(w.runtime.snapshot().markerWorkBytes).toBeGreaterThanOrEqual(w.runtime.snapshot().metadataBytes);
      } else expect(w.runtime.snapshot().unmeasuredValues).toBeGreaterThan(0);
      expect((await physicalRows(h, ['migrationLedger'])).migrationLedger).toEqual([before]);
    } finally { h.adapter.close(); }
  });

  it.each(['conflict', 'quota'] as const)('preserves %s if post-abort measurement itself fails without cancellation', async failure => {
    const h = await setup();
    const work = createWorkRuntime({ assertCurrent() {}, yieldTask: async () => { throw new Error('Measurement scheduler failed'); } });
    work.setContext('prerequisite');
    try {
      if (failure === 'conflict') await mutateRow(h, 'migrationLedger', store => {
        store.put({ ...h.before, ledgerRevision: h.before.ledgerRevision + 1 });
      });
      else vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(() => {
        throw new DOMException('Original quota failure', 'QuotaExceededError');
      });
      await expect(h.invoke(work)).rejects.toMatchObject({ code: failure });
      expect(work.stopped()).toBe(false);
      expect(work.snapshot().ownedBytes).toBe(0);
      expect(work.snapshot().unmeasuredValues).toBeGreaterThan(0);
    } finally { work.dispose(); h.adapter.close(); }
  });

  it('preserves the committed marker when posttransaction measurement is cancelled', async () => {
    const h = await setup(); const w = makeWorkHarness('prerequisite');
    w.observe(event => { if (event.kind === 'work') w.cancel(); });
    try {
      await expect(h.invoke(w.runtime)).rejects.toMatchObject({ name: 'AbortError' });
      const [actual] = (await physicalRows(h, ['migrationLedger'])).migrationLedger;
      expect(actual.ledgerRevision).toBe(h.before.ledgerRevision + 1);
      expect(actual.unresolvedRecovery).toEqual(kind === 'drift' ? h.drift.marker : null);
      expect(w.runtime.snapshot().writes).toBe(1);
    } finally { h.adapter.close(); }
  });

  it.each(['before', 'read-success', 'put-success'] as const)('cancellation at %s leaves the old marker intact', async point => {
    const h = await setup(); const w = makeWorkHarness('prerequisite');
    const method = point === 'read-success' ? 'get' : 'put';
    const original = FakeObjectStore.prototype[method];
    const spy = vi.spyOn(FakeObjectStore.prototype, method).mockImplementation(function (...args: any[]) {
      const result = original.apply(this, args as [any]);
      if (this.name === 'migrationLedger') result.addEventListener('success', w.cancel, { once: true });
      return result;
    });
    if (point === 'before') w.cancel();
    try {
      await expect(h.invoke(w.runtime)).rejects.toMatchObject({ name: 'AbortError' });
      spy.mockRestore();
      expect((await physicalRows(h, ['migrationLedger'])).migrationLedger).toEqual([h.before]);
      expect(w.runtime.snapshot().writes).toBe(point === 'put-success' ? 1 : 0);
      expect(w.events).toEqual([]);
    } finally { spy.mockRestore(); h.adapter.close(); }
  });

  it('preserves the committed marker when the durable observer cancels', async () => {
    const h = await setup(); const w = makeWorkHarness('prerequisite');
    w.observe(event => { if (event.kind === 'durable') w.cancel(); });
    try {
      await expect(h.invoke(w.runtime)).rejects.toMatchObject({ name: 'AbortError' });
      const [actual] = (await physicalRows(h, ['migrationLedger'])).migrationLedger;
      expect(actual.ledgerRevision).toBe(h.before.ledgerRevision + 1);
      expect(actual.state).toBe('verified');
      expect(actual.unresolvedRecovery).toEqual(kind === 'drift' ? h.drift.marker : null);
      expect(w.events.filter(event => event.kind === 'durable')).toHaveLength(1);
    } finally { h.adapter.close(); }
  });

  it.each(['reservation', 'revision'] as const)('keeps the %s authority fence with Work enabled', async change => {
    const h = await setup(); const w = makeWorkHarness('prerequisite');
    const expected = change === 'revision' ? { ...h.before, ledgerRevision: h.before.ledgerRevision + 1 } : h.before;
    try {
      if (change === 'reservation') await mutateRow(h, 'normalizationLedger', store => {
        store.put({ id: NORMALIZATION_LEDGER_ID, state: 'staging' });
      });
      else await mutateRow(h, 'migrationLedger', store => { store.put(expected); });
      await expect(h.invoke(w.runtime)).rejects.toMatchObject({ code: 'conflict' });
      expect((await physicalRows(h, ['migrationLedger'])).migrationLedger).toEqual([expected]);
      expect(w.runtime.snapshot().writes).toBe(0);
      expect(w.events.every(event => event.kind === 'work')).toBe(true);
    } finally { h.adapter.close(); }
  });

  it.each([false, true])('settles a failed put before returning its error (cancelled=%s)', async cancelled => {
    const h = await setup(); const w = makeWorkHarness('prerequisite');
    const spy = vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(() => {
      if (cancelled) w.cancel();
      throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
    });
    try {
      await expect(h.invoke(w.runtime)).rejects.toMatchObject(cancelled ? { name: 'AbortError' } : { code: 'quota' });
      spy.mockRestore();
      expect((await physicalRows(h, ['migrationLedger'])).migrationLedger).toEqual([h.before]);
      expect(w.runtime.snapshot().writes).toBe(1);
      if (cancelled) expect(w.events).toEqual([]);
      else expect(w.events.every(event => event.kind === 'work')).toBe(true);
    } finally { spy.mockRestore(); h.adapter.close(); }
  });

  if (kind === 'verification') it('rolls back when the original mutation fault checkpoint cancels', async () => {
    const h = await setup(); const w = makeWorkHarness('prerequisite'); h.adapter.close();
    const faults: string[] = [];
    const adapter = createIndexedDbAdapter({ indexedDB: h.indexedDB, now: () => '2026-08-14T15:00:00.000Z',
      fault: point => { faults.push(point); w.cancel(); } }, 3);
    try {
      await adapter.open();
      await expect(adapter.markVerified(h.before, w.runtime)).rejects.toMatchObject({ name: 'AbortError' });
      expect(faults).toEqual(['mutation.before-complete']);
      expect((await physicalRows(h, ['migrationLedger'])).migrationLedger).toEqual([h.before]);
      expect(w.events).toEqual([]);
    } finally { adapter.close(); }
  });

  if (kind === 'drift') it('keeps matching drift idempotent without writing or durable notification', async () => {
    const h = await setup(); const w = makeWorkHarness('prerequisite');
    try {
      const first = await h.invoke();
      expect(await h.invoke(w.runtime)).toEqual(first);
      expect(w.runtime.snapshot()).toMatchObject({ writes: 0, metadataRows: 1,
        metadataBytes: runSync(rawValueWeightWork(first)).bytes });
      expect(w.events.every(event => event.kind === 'work')).toBe(true);
    } finally { h.adapter.close(); }
  });
});

describe('cooperative prerequisite copy transactions', () => {
  const points = ['copy.before-transaction', 'copy.after-projects', 'copy.after-workspace',
    'copy.after-presets', 'copy.after-pending-imports', 'copy.after-backup', 'copy.after-ledger', 'copy.before-complete'] as const;
  const prepare = () => prepareInitialCopy(legacySnapshot({ ...validLegacyValues(),
    [LEGACY_KEYS.projects]: JSON.stringify(['project-a', 'project-b'].map(id => ({ ...makeIncrementalProject(1), id }))),
  }), deterministicEnvironment({ crypto: webcrypto as unknown as Crypto }));

  it.each([2, 3])('copies atomically at physical version %i without task yields or hash work inside the transaction', async version => {
    const h = createIncrementalRepositoryHarness(WORKSPACE_DB_NAME);
    const prepared = await prepare();
    const w = makeWorkHarness('prerequisite');
    const faults: string[] = [];
    const adapter = createIndexedDbAdapter({ indexedDB: h.indexedDB, now: () => '2026-08-14T15:00:00.000Z',
      fault: point => { faults.push(point); } }, version);
    await adapter.open();
    try {
      await w.runtime.run((function* () { yield { visits: 1024, utf8Bytes: 0, run() {} }; })());
      expect(await adapter.writeInitialCopy(prepared, w.runtime)).toEqual({ status: 'copied' });
      const actual = await adapter.inspect();
      expect(actual.projects).toEqual(prepared.projects);
      expect(actual.workspace).toEqual([prepared.workspace]);
      expect(actual.presets).toEqual(prepared.presets);
      expect(actual.pendingImports).toEqual(prepared.pendingImports);
      expect(actual.legacyBackup).toEqual([prepared.backup]);
      expect(actual.migrationLedger).toEqual([prepared.ledger]);
      expect(faults).toEqual(points);
      expect(w.runtime.snapshot().writes).toBe(7);
      expect(w.runtime.snapshot().hashBytes).toBe(0);
      expect(w.runtime.snapshot().yields).toBeGreaterThan(0);
      expect(w.events.filter(event => event.kind === 'durable')).toHaveLength(1);
      expect(w.runtime.snapshot()).toMatchObject({ ownedBytes: 0,
        markerWorkBytes: runSync(rawValueWeightWork(prepared.ledger)).bytes });
    } finally { adapter.close(); }
  });

  it.each(points)('rolls back the entire copy when cancelled at %s', async point => {
    const h = createIncrementalRepositoryHarness(WORKSPACE_DB_NAME);
    const prepared = await prepare();
    const w = makeWorkHarness('prerequisite');
    const reached: string[] = [];
    const adapter = createIndexedDbAdapter({ indexedDB: h.indexedDB, now: () => '2026-08-14T15:00:00.000Z',
      fault: current => { reached.push(current); if (current === point) w.cancel(); } }, 3);
    await adapter.open();
    try {
      const outcome = await adapter.writeInitialCopy(prepared, w.runtime).then(() => 'completed', error => error.name);
      expect(outcome).toBe('AbortError');
      expect(reached).toEqual(points.slice(0, points.indexOf(point) + 1));
      const actual = await physicalRows(h, historicalStores);
      expect(Object.values(actual).every(rows => rows.length === 0)).toBe(true);
      expect((await physicalRows(h, ['normalizationLedger'])).normalizationLedger).toEqual([]);
      if (point === 'copy.before-transaction') expect(w.runtime.snapshot().writes).toBe(0);
    } finally { adapter.close(); }
  });

  it('does not open a copy transaction when already cancelled', async () => {
    const h = createIncrementalRepositoryHarness(WORKSPACE_DB_NAME);
    const prepared = await prepare();
    const w = makeWorkHarness('prerequisite');
    const fault = vi.fn();
    const adapter = createIndexedDbAdapter({ indexedDB: h.indexedDB, now: () => '2026-08-14T15:00:00.000Z', fault }, 3);
    await adapter.open();
    w.cancel();
    try {
      const outcome = await adapter.writeInitialCopy(prepared, w.runtime).then(() => 'completed', error => error.name);
      expect(outcome).toBe('AbortError');
      expect(fault).not.toHaveBeenCalled();
      expect(Object.values(await physicalRows(h, historicalStores)).every(rows => rows.length === 0)).toBe(true);
    } finally { adapter.close(); }
  });

  it('issues the next add only after prior success and reports after-projects after every project completed', async () => {
    const h = createIncrementalRepositoryHarness(WORKSPACE_DB_NAME);
    const prepared = await prepare();
    const w = makeWorkHarness('prerequisite');
    const completed: string[] = [];
    let pending = false;
    const adapter = createIndexedDbAdapter({ indexedDB: h.indexedDB, now: () => '2026-08-14T15:00:00.000Z',
      fault: point => {
        if (point === 'copy.after-projects') expect(completed).toEqual(['projects', 'projects']);
        if (point === 'copy.before-complete') expect(completed).toHaveLength(7);
      } }, 3);
    await adapter.open();
    const add = FakeObjectStore.prototype.add;
    const spy = vi.spyOn(FakeObjectStore.prototype, 'add').mockImplementation(function (value, key) {
      expect(pending).toBe(false);
      pending = true;
      const request = add.call(this, value, key);
      request.addEventListener('success', () => { pending = false; completed.push(this.name); }, { once: true });
      return request;
    });
    try {
      await adapter.writeInitialCopy(prepared, w.runtime);
      expect(completed).toEqual(['projects', 'projects', 'workspace', 'presets', 'pendingImports', 'legacyBackup', 'migrationLedger']);
    } finally { spy.mockRestore(); adapter.close(); }
  });

  it('publishes durable progress only after the transaction complete event', async () => {
    const h = createIncrementalRepositoryHarness(WORKSPACE_DB_NAME);
    const prepared = await prepare();
    const w = makeWorkHarness('prerequisite');
    const adapter = createIndexedDbAdapter({ indexedDB: h.indexedDB, now: () => '2026-08-14T15:00:00.000Z' }, 3);
    await adapter.open();
    let committed = false, observed = false, listening = false;
    const add = FakeObjectStore.prototype.add;
    const spy = vi.spyOn(FakeObjectStore.prototype, 'add').mockImplementation(function (value, key) {
      if (!listening) {
        listening = true;
        this.transaction.addEventListener('complete', () => { committed = true; }, { once: true });
      }
      return add.call(this, value, key);
    });
    w.observe(event => {
      expect(committed).toBe(true);
      expect(event.kind).toBe('durable');
      observed = true;
    });
    try {
      await adapter.writeInitialCopy(prepared, w.runtime);
      expect(observed).toBe(true);
    } finally { spy.mockRestore(); adapter.close(); }
  });

  it('leaves a complete copied phase when cancellation arrives after commit', async () => {
    const h = createIncrementalRepositoryHarness(WORKSPACE_DB_NAME);
    const prepared = await prepare();
    const w = makeWorkHarness('prerequisite');
    const adapter = createIndexedDbAdapter({ indexedDB: h.indexedDB, now: () => '2026-08-14T15:00:00.000Z' }, 3);
    await adapter.open();
    w.observe(() => w.cancel());
    try {
      await expect(adapter.writeInitialCopy(prepared, w.runtime)).rejects.toMatchObject({ name: 'AbortError' });
      const rows = await physicalRows(h, historicalStores);
      expect(rows.projects).toEqual(prepared.projects);
      expect(rows.workspace).toEqual([prepared.workspace]);
      expect(rows.presets).toEqual(prepared.presets);
      expect(rows.pendingImports).toEqual(prepared.pendingImports);
      expect(rows.legacyBackup).toEqual([prepared.backup]);
      expect(rows.migrationLedger).toEqual([prepared.ledger]);
      const fresh = makeWorkHarness('prerequisite');
      expect(await adapter.writeInitialCopy(prepared, fresh.runtime)).toEqual({ status: 'existing-ledger' });
      expect(fresh.runtime.snapshot().writes).toBe(0);
    } finally { adapter.close(); }
  });

  it('cancels after the first successful row without issuing the second row', async () => {
    const h = createIncrementalRepositoryHarness(WORKSPACE_DB_NAME);
    const prepared = await prepare();
    const w = makeWorkHarness('prerequisite');
    const adapter = createIndexedDbAdapter({ indexedDB: h.indexedDB, now: () => '2026-08-14T15:00:00.000Z' }, 3);
    await adapter.open();
    const add = FakeObjectStore.prototype.add;
    const spy = vi.spyOn(FakeObjectStore.prototype, 'add').mockImplementation(function (value, key) {
      const request = add.call(this, value, key);
      request.addEventListener('success', w.cancel, { once: true });
      return request;
    });
    try {
      await expect(adapter.writeInitialCopy(prepared, w.runtime)).rejects.toMatchObject({ name: 'AbortError' });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(w.runtime.snapshot().writes).toBe(1);
      expect(Object.values(await physicalRows(h, historicalStores)).every(rows => rows.length === 0)).toBe(true);
    } finally { spy.mockRestore(); adapter.close(); }
  });

  it('retains existing-ledger and orphaned-target outcomes without issuing writes', async () => {
    for (const existingLedger of [true, false]) {
      const h = createIncrementalRepositoryHarness(WORKSPACE_DB_NAME);
      const prepared = await prepare();
      const w = makeWorkHarness('prerequisite');
      const adapter = createIndexedDbAdapter({ indexedDB: h.indexedDB, now: () => '2026-08-14T15:00:00.000Z' }, 3);
      await adapter.open();
      try {
        if (existingLedger) await adapter.writeInitialCopy(prepared);
        else await mutateRow(h, 'projects', store => { store.put({ id: 'orphan' }); });
        const before = await physicalRows(h, historicalStores);
        expect(await adapter.writeInitialCopy(prepared, w.runtime)).toEqual({ status: existingLedger ? 'existing-ledger' : 'orphaned-target' });
        expect(w.runtime.snapshot().writes).toBe(0);
        if (existingLedger) expect(w.runtime.snapshot().markerWorkBytes).toBe(runSync(rawValueWeightWork(prepared.ledger)).bytes);
        expect(await physicalRows(h, historicalStores)).toEqual(before);
      } finally { adapter.close(); }
    }
  });

  it.each(['recognized', 'malformed', 'absent'] as const)('counts the %s ledger in a no-write copy attempt', async kind => {
    const h = createIncrementalRepositoryHarness(WORKSPACE_DB_NAME); const prepared = await prepare();
    const w = makeWorkHarness('prerequisite');
    const adapter = createIndexedDbAdapter({ indexedDB: h.indexedDB, now: () => '2026-08-14T15:00:00.000Z' }, 3);
    const ledger = kind === 'recognized' ? prepared.ledger : { id: prepared.ledger.id, extra: new Map([['kept', 1n]]) };
    try {
      await adapter.open();
      if (kind !== 'absent') await mutateRow(h, 'migrationLedger', store => { store.put(ledger); });
      else await mutateRow(h, 'projects', store => { store.put({ id: 'orphan' }); });
      const before = await physicalRows(h, historicalStores);
      expect(await adapter.writeInitialCopy(prepared, w.runtime)).toEqual({ status: kind === 'recognized' ? 'existing-ledger' : 'orphaned-target' });
      expect(w.runtime.snapshot()).toMatchObject({ writes: 0, metadataRows: kind === 'absent' ? 0 : 1,
        metadataBytes: kind === 'absent' ? 0 : runSync(rawValueWeightWork(ledger)).bytes,
        unmeasuredValues: kind === 'malformed' ? 1 : 0 });
      expect(await physicalRows(h, historicalStores)).toEqual(before);
    } finally { adapter.close(); }
  });

  it.each([true, false])('cancels no-write copy measurement only after completion (recognized=%s)', async recognized => {
    const h = createIncrementalRepositoryHarness(WORKSPACE_DB_NAME); const prepared = await prepare();
    const w = makeWorkHarness('prerequisite');
    const adapter = createIndexedDbAdapter({ indexedDB: h.indexedDB, now: () => '2026-08-14T15:00:00.000Z' }, 3);
    let complete = false; const completedAtObservation: boolean[] = [];
    try {
      await adapter.open();
      await mutateRow(h, 'migrationLedger', store => { store.put(recognized ? prepared.ledger : { id: prepared.ledger.id }); });
      const before = await physicalRows(h, historicalStores);
      const get = FakeObjectStore.prototype.get;
      const spy = vi.spyOn(FakeObjectStore.prototype, 'get').mockImplementation(function (key) {
        this.transaction.addEventListener('complete', () => { complete = true; }, { once: true });
        return get.call(this, key);
      });
      await w.runtime.run((function* () { yield { visits: 1024, utf8Bytes: 0, run() {} }; })());
      w.observe(() => { completedAtObservation.push(complete); w.cancel(); });
      await expect(adapter.writeInitialCopy(prepared, w.runtime)).rejects.toMatchObject({ name: 'AbortError' });
      expect(completedAtObservation).toEqual([true]);
      expect(w.runtime.snapshot().writes).toBe(0);
      spy.mockRestore();
      expect(await physicalRows(h, historicalStores)).toEqual(before);
    } finally { adapter.close(); }
  });

  it('retains the normalization-reservation guard before any historical write', async () => {
    const h = createIncrementalRepositoryHarness(WORKSPACE_DB_NAME);
    const prepared = await prepare();
    const w = makeWorkHarness('prerequisite');
    const adapter = createIndexedDbAdapter({ indexedDB: h.indexedDB, now: () => '2026-08-14T15:00:00.000Z' }, 3);
    await adapter.open();
    try {
      await mutateRow(h, 'normalizationLedger', store => { store.put({ id: NORMALIZATION_LEDGER_ID, state: 'staging' }); });
      await expect(adapter.writeInitialCopy(prepared, w.runtime)).rejects.toMatchObject({ code: 'conflict' });
      expect(w.runtime.snapshot().writes).toBe(0);
      expect(Object.values(await physicalRows(h, historicalStores)).every(rows => rows.length === 0)).toBe(true);
    } finally { adapter.close(); }
  });

  it('settles a native request failure and rolls back earlier successful writes', async () => {
    const h = createIncrementalRepositoryHarness(WORKSPACE_DB_NAME);
    const prepared = await prepare();
    prepared.projects[1].id = prepared.projects[0].id;
    const w = makeWorkHarness('prerequisite');
    const fault = vi.fn();
    const adapter = createIndexedDbAdapter({ indexedDB: h.indexedDB, now: () => '2026-08-14T15:00:00.000Z', fault }, 3);
    await adapter.open();
    try {
      await expect(adapter.writeInitialCopy(prepared, w.runtime)).rejects.toMatchObject({ code: 'conflict' });
      expect(fault.mock.calls.map(([point]) => point)).toEqual(['copy.before-transaction']);
      expect(Object.values(await physicalRows(h, historicalStores)).every(rows => rows.length === 0)).toBe(true);
    } finally { adapter.close(); }
  });

  it.each([['DataCloneError', 'clone'], ['QuotaExceededError', 'quota']] as const)('rolls back prior writes after synchronous %s', async (name, code) => {
    const h = createIncrementalRepositoryHarness(WORKSPACE_DB_NAME);
    const prepared = await prepare();
    const w = makeWorkHarness('prerequisite');
    const adapter = createIndexedDbAdapter({ indexedDB: h.indexedDB, now: () => '2026-08-14T15:00:00.000Z' }, 3);
    await adapter.open();
    const add = FakeObjectStore.prototype.add;
    const spy = vi.spyOn(FakeObjectStore.prototype, 'add').mockImplementation(function (value, key) {
      if (this.name === 'workspace') throw new DOMException('injected failure', name);
      return add.call(this, value, key);
    });
    try {
      await expect(adapter.writeInitialCopy(prepared, w.runtime)).rejects.toMatchObject({ code });
      expect(Object.values(await physicalRows(h, historicalStores)).every(rows => rows.length === 0)).toBe(true);
    } finally { spy.mockRestore(); adapter.close(); }
  });
});

describe('cooperative historical capture forwarding', () => {
  it('validates a shared backup once per verification pass, never caches authority across passes', async () => {
    const h = await createNormalizationHarness();
    const w = makeWorkHarness('prerequisite');
    await h.adapter.open();
    const row = structuredClone(h.prepared.backup);
    const read = vi.spyOn(h.adapter, 'readLegacyBackup').mockResolvedValue(row);
    try {
      const result = await h.historical.readVerificationInputs(h.prepared.ledger, w.runtime);
      expect(result.originalBackup).toBe(row);
      expect(result.acceptedBackup).toBe(row);
      expect(read).toHaveBeenCalledTimes(1);
      expect(w.runtime.snapshot().backupValidations).toBe(1);
      row.snapshot[LEGACY_KEYS.projects].raw = 'changed after the pass';
      await expect(h.historical.readVerificationInputs(h.prepared.ledger, w.runtime))
        .rejects.toMatchObject({ category: 'verification-failed' });
      expect(w.runtime.snapshot().backupValidations).toBe(2);
    } finally { read.mockRestore(); h.adapter.close(); }
  });

  it.each(['id', 'digest'] as const)('checks each accepted backup %s even when the row object was already validated', async field => {
    const h = await createNormalizationHarness();
    const w = makeWorkHarness('prerequisite');
    await h.adapter.open();
    const ledger = { ...h.prepared.ledger };
    if (field === 'id') ledger.acceptedLegacyBackupId = 'different-reference';
    else ledger.acceptedLegacyDigest = 'f'.repeat(64);
    const read = vi.spyOn(h.adapter, 'readLegacyBackup').mockResolvedValue(h.prepared.backup);
    try {
      await expect(h.historical.readVerificationInputs(ledger, w.runtime))
        .rejects.toMatchObject({ category: 'verification-failed' });
      expect(w.runtime.snapshot().backupValidations).toBe(1);
    } finally { read.mockRestore(); h.adapter.close(); }
  });

  it('preserves lifecycle failure after an awaited prerequisite backup read', async () => {
    const h = await createNormalizationHarness();
    const w = makeWorkHarness('prerequisite');
    await h.adapter.open();
    const read = vi.spyOn(h.adapter, 'readLegacyBackup').mockImplementation(async () => {
      w.cancel(); throw new Error('read failure after cancellation');
    });
    try {
      await expect(h.historical.readVerificationInputs(h.prepared.ledger, w.runtime))
        .rejects.toMatchObject({ name: 'AbortError' });
      expect(w.runtime.snapshot().backupValidations).toBe(0);
    } finally { read.mockRestore(); h.adapter.close(); }
  });

  it.each(['kind', 'capturedAt'] as const)('checks the original backup %s for a shared row', async field => {
    const h = await createNormalizationHarness();
    const w = makeWorkHarness('prerequisite');
    await h.adapter.open();
    const row = structuredClone(h.prepared.backup);
    if (field === 'kind') row.kind = 'conflict';
    else row.capturedAt = '2026-01-01T00:00:00.000Z';
    const read = vi.spyOn(h.adapter, 'readLegacyBackup').mockResolvedValue(row);
    try {
      await expect(h.historical.readVerificationInputs(h.prepared.ledger, w.runtime))
        .rejects.toMatchObject({ category: 'verification-failed' });
      expect(w.runtime.snapshot().backupValidations).toBe(0);
    } finally { read.mockRestore(); h.adapter.close(); }
  });

  it('accounts stable capture reads and hashes through the historical helper', async () => {
    const h = await createNormalizationHarness();
    const w = makeWorkHarness('legacy-fence');
    const get = vi.spyOn(h.legacyStorage, 'getItem');
    const capture = await h.historical.captureObservedLegacy(undefined, w.runtime);
    expect(capture.digest).toBe(h.prepared.sourceDigest);
    expect(get).toHaveBeenCalledTimes(12);
    expect(w.runtime.snapshot().legacyCaptures).toBe(1);
    expect(w.runtime.snapshot().legacyReads).toBe(12);
    expect(w.runtime.snapshot().legacyHashBytes).toBeGreaterThan(0);
    get.mockClear();
    expect(h.historical.currentGeneration()).toBe(0);
    expect(get).not.toHaveBeenCalled();
  });

  it('forwards expected discovery identity to the native capture tail', async () => {
    const h = await createNormalizationHarness();
    const expected = await h.historical.captureObservedLegacy();
    expected.snapshot[LEGACY_KEYS.activeProject].raw = 'different';
    const w = makeWorkHarness('legacy-fence');
    await expect(h.historical.captureObservedLegacy(undefined, w.runtime, expected))
      .rejects.toMatchObject({ category: 'legacy-changing' });
  });

  it('returns generation sampled in the capture tail, not a later generation', async () => {
    const h = await createNormalizationHarness();
    let generation = 0;
    const historical = createHistoricalBootstrap({ ...h.preparation, adapter: () => h.adapter,
      legacyStorage: h.legacyStorage, generation: () => generation });
    const get = h.legacyStorage.getItem.bind(h.legacyStorage);
    let reads = 0;
    vi.spyOn(h.legacyStorage, 'getItem').mockImplementation(key => {
      const raw = get(key);
      if (++reads === 12) queueMicrotask(() => { generation += 1; });
      return raw;
    });
    const w = makeWorkHarness('legacy-fence');
    const result = await historical.captureObservedLegacy(undefined, w.runtime);
    expect(result.generation).toBe(0);
    expect(historical.currentGeneration()).toBe(1);
    expect(reads).toBe(12);
  });

  it('uses the invocation runtime override without mutating the historical environment', async () => {
    const h = await createNormalizationHarness();
    const first = makeWorkHarness('legacy-fence');
    const second = makeWorkHarness('legacy-fence');
    const environment = { ...h.preparation, adapter: () => h.adapter, legacyStorage: h.legacyStorage,
      generation: () => 0, work: first.runtime };
    const historical = createHistoricalBootstrap(environment);
    await historical.captureObservedLegacy(undefined, second.runtime);
    expect(second.runtime.snapshot().legacyReads).toBe(12);
    expect(first.runtime.snapshot().legacyReads).toBe(0);
    expect(environment.work).toBe(first.runtime);
    await historical.captureObservedLegacy();
    expect(first.runtime.snapshot().legacyReads).toBe(12);
    expect(second.runtime.snapshot().legacyReads).toBe(12);
  });
});

function hashGate(h: ReturnType<typeof freshHarness> | Awaited<ReturnType<typeof createNormalizationHarness>>) {
  let release!: () => void; let reached!: () => void; let paused = false;
  const entered = new Promise<void>(resolve => { reached = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const hash = h.environment.hash; const pause = h.environment.normalizationPause;
  const once = async () => { if (!paused) { paused = true; reached(); await gate; } };
  h.environment.hash = async text => { await once(); return hash(text); };
  h.environment.normalizationPause = async point => {
    await pause?.(point);
    if (point.point === 'before-hash') await once();
  };
  return { entered, release, restore: () => { h.environment.hash = hash; h.environment.normalizationPause = pause; } };
}

async function activeImage(h: Awaited<ReturnType<typeof createNormalizationHarness>>) {
  const source = await h.repository.readNormalizationSource(); const stored = source.records.projects[0];
  const active = await h.repository.readActiveAuthority();
  const scope = { storageGeneration: active!.storageGeneration, projectId: stored.id, incarnation: stored.incarnation };
  const image = decomposeProject(stored.project, scope); const rows = await physicalRows(h);
  for (const store of NORMALIZED_STORE_NAMES) if (store !== 'normalizationLedger') {
    Object.assign(image, { [store]: new Map(rows[store].filter(row => row.key[1] === stored.id).map(row => [JSON.stringify(row.key), row])) });
  }
  return image;
}

describe('review I1 independent document baseline', () => {
  // Each consumer gets an independently prepared database and the default timeout.
  // Combining six sealed reads into one case obscures which consumer regressed.
  for (const kind of ['historical', 'fresh'] as const) for (const preference of ['scalar', 'fold'] as const)
    for (const consumer of ['reopen', 'active-recovery', 'retained-recovery'] as const) {
    it.each(['unchanged', 'node-corruption', 'preference-corruption', ...(preference === 'scalar' ? ['raw-fold-corruption'] as const : [])] as const)(`${kind} ${preference} preference-only ${consumer}: %s`, async change => {
      const h = kind === 'historical' ? await createNormalizationHarness() : freshHarness();
      try {
        // A valid nonboolean legacy fold exercises the separately owned folds extension:
        // the fold save must remove this positional exception, not rewrite the template.
        const withLegacyFold = h.preparation.createBlankProject();
        Reflect.set(withLegacyFold.variants.default.templates.page.layers![0], 'collapsed', 'legacy-fold');
        if (kind === 'historical') {
          await h.adapter.open();
          expect((await h.historical.bootstrap(() => {}, { allowCopiedReplacement: false })).status).toBe('admitted');
          const stored = (await physicalRows(h, ['projects'])).projects[0];
          stored.storageRevision = 19;
          Reflect.set(stored.project.initialState.variants.default.templates.page.layers[0], 'collapsed', 'legacy-fold');
          await mutateRow(h, 'projects', store => store.put(stored));
        } else h.preparation.createBlankProject = () => structuredClone(withLegacyFold);
        expect((await h.run()).status).toBe('active');
        const source = await createNormalizedRepository(h.environment).readNormalizationSource();
        const stored = source.records.projects[0];
        const scope = { storageGeneration: `normalized:${source.sourceDigest}`, projectId: stored.id, incarnation: stored.incarnation };
        const image = decomposeProject(stored.project, scope);
        for (const item of prepareNormalizationTarget(source)) if (item.record.key[1] === stored.id)
          (image[item.store] as Map<string, unknown>).set(JSON.stringify(item.record.key), item.record);
        await h.repository.bindAdmittedProject(image);
        const before = await physicalRows(h); h.operations.length = 0;
        await h.repository.commitPreferences({ scope, clientId: 'review-I1', commitId: 'preference-only', commitGeneration: 1,
          editorGeneration: 1, observedPreferenceRevision: 0, patch: preference === 'scalar' ? { scale: 3 } : {},
          ...(preference === 'fold' ? { folds: { expectedFoldStructureGeneration: 0,
            updates: [{ occurrence: { variantId: 'default', templateId: 'page', position: 0 }, collapsed: true }] } } : {}) });
        expect(h.operations.every(operation => operation.method !== 'getAll')).toBe(true);
        const saved = await physicalRows(h);
        expect(saved.projectHeaders).toEqual(before.projectHeaders);
        expect(saved.projectHeaders[0]).toMatchObject({ storageRevision: kind === 'historical' ? 19 : 0, commitProof: null });
        expect(saved.projectNodes).toEqual(before.projectNodes); expect(saved.projectTemplates).toEqual(before.projectTemplates);
        expect(saved.projectPreferences[0].commitProof.identity.lane).toBe('preferences');
        if (preference === 'fold') {
          expect(saved.projectExtensions.find(row => row.key[3] === 'folds').value).toEqual({});
          expect(before.projectExtensions.find(row => row.key[3] === 'folds').value).not.toEqual({});
        }
        if (change !== 'unchanged') {
          const store = change === 'node-corruption' ? 'projectNodes' : change === 'raw-fold-corruption' ? 'projectExtensions' : 'projectPreferences';
          const record = structuredClone(change === 'raw-fold-corruption' ? saved[store].find(row => row.key[3] === 'folds') : saved[store][0]); const frame = frameRecord(store, record);
          if (change === 'raw-fold-corruption') {
            const cell = Object.keys(record.value)[0];
            expect(record.value[cell].value).toBe('legacy-fold'); record.value[cell].value = 'poison-fold';
          } else if (change === 'node-corruption') record.value.title = 'Poison 根';
          else if (preference === 'scalar') record.value.scale = 4;
          else record.value.layerCollapsed[JSON.stringify(['default', 'page', 'content'])] = false;
          if (change === 'node-corruption' || preference === 'scalar')
            expect(new TextEncoder().encode(frameRecord(store, record)).length).toBe(new TextEncoder().encode(frame).length);
          await mutateRow(h, store, physical => physical.put(record));
          if (change === 'raw-fold-corruption') {
            const corrupted = await physicalRows(h);
            expect(corrupted.projectHeaders).toEqual(saved.projectHeaders);
            expect(corrupted.projectPreferences).toEqual(saved.projectPreferences);
            expect(corrupted.normalizationLedger).toEqual(saved.normalizationLedger);
          }
        }
        const fresh = () => createNormalizedRepository(h.environment);
        const retained = { kind: kind === 'historical' ? 'historical-indexeddb' as const : 'fresh-seed' as const,
          sourceDigest: source.sourceDigest, authority: 'historical' as const, rollbackReady: false as const };
        const current = { kind: 'normalized-active' as const, storageGeneration: scope.storageGeneration, cutoverRevision: 1 };
        const result = consumer === 'reopen' ? await h.run() : undefined;
        if (change === 'unchanged') {
          const expected = structuredClone(source.snapshot);
          if (preference === 'scalar') expected.projects[0].initialState.scale = 3;
          else Reflect.set(expected.projects[0].initialState.variants.default.templates.page.layers![0], 'collapsed', true);
          if (consumer === 'reopen') {
            expect(result!.status).toBe('active');
            expect(await fresh().exportGeneration(scope.storageGeneration)).toEqual(expected);
            if (result!.status === 'active') expect(result!.snapshot).toEqual(expected);
          }
          if (consumer === 'active-recovery')
            expect(await recoveryExports.exportNormalizationRecovery(fresh(), current, h.preparation.now())).toMatchObject({ workspace: expected });
        } else {
          if (consumer === 'reopen') {
            expect.soft(result!.status).toBe('recovery');
            expect.soft(await fresh().exportGeneration(scope.storageGeneration).then(() => 'accepted', () => 'rejected')).toBe('rejected');
            await expect(fresh().bindAdmittedProject(image)).rejects.toThrow();
          }
          if (consumer === 'active-recovery')
            expect.soft(await recoveryExports.exportNormalizationRecovery(fresh(), current, h.preparation.now()).then(() => 'accepted', () => 'rejected')).toBe('rejected');
          if (consumer === 'retained-recovery')
            expect(await recoveryExports.normalizationRecoverySources(fresh())).toEqual([retained]);
        }
        if (consumer === 'retained-recovery')
          expect(await recoveryExports.exportNormalizationRecovery(fresh(), retained, h.preparation.now())).toMatchObject({
            format: 'doctect.normalization-source-recovery', rollbackReady: false, workspace: source.snapshot, records: source.records });
        expect((await physicalRows(h)).normalizationLedger).toEqual(before.normalizationLedger);
        expect((await fresh().readNormalizationSource()).records).toEqual(source.records);
      } finally { h.adapter.close(); }
    });
  }
});

describe('review I3 durable fold evidence', () => {
  async function setup(kind: 'fresh' | 'historical', templateId = 'page') {
    const h = kind === 'historical' ? await createNormalizationHarness() : freshHarness();
    const state = h.preparation.createBlankProject(); const template = state.variants.default.templates.page;
    template.layers = [0, 1, 2].map((position) => ({ ...template.layers![0], id: 'duplicate',
      collapsed: (position === 2 ? 'legacy-fold' : position === 0) as any }));
    if (templateId !== 'page') {
      delete state.variants.default.templates.page; template.id = templateId;
      state.variants.default.templates[templateId] = template; state.selectedTemplateId = templateId;
    }
    if (kind === 'historical') {
      await h.adapter.open();
      expect((await h.historical.bootstrap(() => {}, { allowCopiedReplacement: false })).status).toBe('admitted');
      const stored = (await physicalRows(h, ['projects'])).projects[0];
      stored.storageRevision = 19; stored.project.initialState = state;
      await mutateRow(h, 'projects', store => store.put(stored));
    } else {
      h.preparation.createBlankProject = () => structuredClone(state);
    }
    expect((await h.run()).status).toBe('active');
    const source = await createNormalizedRepository(h.environment).readNormalizationSource();
    const stored = source.records.projects[0];
    const scope = { storageGeneration: `normalized:${source.sourceDigest}`, projectId: stored.id, incarnation: stored.incarnation };
    const image = decomposeProject(stored.project, scope);
    for (const item of prepareNormalizationTarget(source)) if (item.record.key[1] === stored.id)
      (image[item.store] as Map<string, unknown>).set(JSON.stringify(item.record.key), item.record);
    await h.repository.bindAdmittedProject(image);
    const expected = structuredClone(source.snapshot);
    const fresh = () => createNormalizedRepository(h.environment);
    const current = { kind: 'normalized-active' as const, storageGeneration: scope.storageGeneration, cutoverRevision: 1 };
    const retained = { kind: kind === 'historical' ? 'historical-indexeddb' as const : 'fresh-seed' as const,
      sourceDigest: source.sourceDigest, authority: 'historical' as const, rollbackReady: false as const };
    type Consumer = 'all' | 'reopen' | 'active-recovery' | 'retained-recovery';
    const good = async (consumer: Consumer = 'all') => {
      if (consumer === 'all' || consumer === 'reopen') {
        const result = await h.run(); expect(result.status).toBe('active');
        if (result.status === 'active') expect(result.snapshot).toEqual(expected);
        expect(await fresh().exportGeneration(scope.storageGeneration)).toEqual(expected);
      }
      if (consumer === 'all' || consumer === 'active-recovery')
        expect(await recoveryExports.exportNormalizationRecovery(fresh(), current, h.preparation.now())).toMatchObject({ workspace: expected });
    };
    const bad = async (consumer: Consumer = 'all') => {
      const before = await physicalRows(h);
      if (consumer === 'all' || consumer === 'reopen') {
        expect.soft((await h.run()).status).toBe('recovery');
        expect.soft(await fresh().exportGeneration(scope.storageGeneration).then(() => true, () => false)).toBe(false);
        await expect(fresh().bindAdmittedProject(image)).rejects.toThrow();
      }
      if (consumer === 'all' || consumer === 'active-recovery')
        expect.soft(await recoveryExports.exportNormalizationRecovery(fresh(), current, h.preparation.now()).then(() => true, () => false)).toBe(false);
      if (consumer === 'all' || consumer === 'retained-recovery') {
        expect.soft(await recoveryExports.normalizationRecoverySources(fresh())).toEqual([retained]);
        expect(await recoveryExports.exportNormalizationRecovery(fresh(), retained, h.preparation.now())).toMatchObject({ workspace: source.snapshot, records: source.records });
      }
      expect(await physicalRows(h)).toEqual(before);
      expect((await fresh().readNormalizationSource()).records).toEqual(source.records);
    };
    const corrupt = async () => {
      const folds = (await physicalRows(h)).projectExtensions.find(row => row.key[3] === 'folds');
      const poisoned = structuredClone(folds);
      const cell = Object.values(poisoned.value).find((cell: any) => cell.value === 'legacy-fold') as { value: string };
      expect(cell).toBeDefined(); cell.value = 'poison-fold';
      expect(new TextEncoder().encode(frameRecord('projectExtensions', poisoned)).length)
        .toBe(new TextEncoder().encode(frameRecord('projectExtensions', folds)).length);
      await mutateRow(h, 'projectExtensions', store => store.put(poisoned));
      return folds;
    };
    const scalar = async (n: number, repository = h.repository) => {
      await repository.commitPreferences({ scope, clientId: 'I3-scalar', commitId: `scalar-${n}`, commitGeneration: n,
        editorGeneration: n, observedPreferenceRevision: (await physicalRows(h)).projectPreferences[0].revision, patch: { scale: n + 2 } });
      expected.projects[0].initialState.scale = n + 2;
    };
    return { h, source, scope, image, expected, fresh, good, bad, corrupt, scalar, templateId };
  }

  async function fold(f: Awaited<ReturnType<typeof setup>>, mixed = false) {
    const before = await physicalRows(f.h);
    await f.h.repository.commitPreferences({ scope: f.scope, clientId: 'I3-fold', commitId: 'fold', commitGeneration: 1,
      editorGeneration: 1, observedPreferenceRevision: 0, patch: mixed ? { scale: 7 } : {},
      folds: { expectedFoldStructureGeneration: 0, updates: [{ occurrence: { variantId: 'default', templateId: f.templateId, position: 0 }, collapsed: false }] } });
    f.expected.projects[0].initialState.variants.default.templates[f.templateId].layers![0].collapsed = false;
    if (mixed) f.expected.projects[0].initialState.scale = 7;
    const after = await physicalRows(f.h);
    expect(after.projectHeaders).toEqual(before.projectHeaders);
    expect(after.projectTemplates).toEqual(before.projectTemplates);
    if (!mixed) expect(after.projectPreferences[0].value.scale).toBe(before.projectPreferences[0].value.scale);
    expect(after.projectExtensions).not.toEqual(before.projectExtensions);
  }
  async function reorder(f: Awaited<ReturnType<typeof setup>>, n: number) {
    const before = await physicalRows(f.h); const header = before.projectHeaders[0];
    const template = before.projectTemplates.find(row => row.key[4] === f.templateId).value;
    const occurrence = (position: number) => ({ variantId: 'default', templateId: f.templateId, position });
    await f.h.repository.commitDocument({ scope: f.scope, clientId: 'I3-reorder', commitId: `reorder-${n}`,
      commitGeneration: n, editorGeneration: n, expectedRevision: header.storageRevision,
      changes: [{ type: 'put-template', variantId: 'default', template: { ...template,
        layers: [template.layers[1], template.layers[0], template.layers[2]] } }],
      structural: { expectedFoldStructureGeneration: header.foldStructureGeneration,
        mappings: [0, 1, 2].map(position => ({ type: 'continue', from: occurrence(position), to: occurrence(position === 2 ? 2 : 1 - position) })) } });
    const layers = f.expected.projects[0].initialState.variants.default.templates[f.templateId].layers!;
    [layers[0], layers[1]] = [layers[1], layers[0]];
  }
  async function digestMatches(f: Awaited<ReturnType<typeof setup>>) {
    const rows = await physicalRows(f.h);
    expect(rows.projectPreferences[0].foldRecordDigest).toBe(await f.h.environment.hash(frameRecord('projectExtensions', rows.projectExtensions.find(row => row.key[3] === 'folds'))));
    return rows;
  }

  for (const consumer of ['reopen', 'active-recovery', 'retained-recovery'] as const)
  it.each(['fresh', 'historical'] as const)(`initial preferences stay source-anchored after document proof (${consumer}): %s`, async kind => {
    const f = await setup(kind); const { h, scope, image, expected } = f;
    try {
      const node = { ...image.projectNodes.values().next().value!.value, title: 'Document edit' };
      await h.repository.commitDocument({ scope, clientId: 'I3-document', commitId: 'doc', commitGeneration: 1, editorGeneration: 1,
        expectedRevision: kind === 'historical' ? 19 : 0, changes: [{ type: 'put-node', node }] });
      expected.projects[0].initialState.nodes[node.id] = node;
      const rows = await physicalRows(h);
      expect(rows.projectHeaders[0].commitProof).not.toBeNull();
      expect(rows.projectPreferences[0]).toMatchObject({ revision: 0, commitProof: null });
      expect(Object.hasOwn(rows.projectPreferences[0], 'foldRecordDigest')).toBe(false);
      await f.good(consumer); await f.corrupt(); await f.bad(consumer);
    } finally { h.adapter.close(); }
  });

  for (const kind of ['fresh', 'historical'] as const) it.each(['fold-only', 'mixed', 'count', 'preference-floor', 'document-floor'] as const)
  (`${kind} current folds survive genuine edits and independent evidence floors: %s`, async mode => {
    const f = await setup(kind); const { h } = f;
    try {
      if (mode.endsWith('floor')) await reorder(f, 1); else await fold(f, mode === 'mixed');
      if (mode === 'count' || mode === 'preference-floor') {
        for (let n = 1; n <= 34; n++) await f.scalar(n);
        const rows = await physicalRows(h); const window = rows.projectPreferences[0].commitWindow;
        expect(window.floorRevision).toBe(3); expect(window.entries).toHaveLength(32);
        expect(window.entries.every((entry: any) => entry.proof.identity.commitId.startsWith('scalar-'))).toBe(true);
        expect(window.entries.at(-1).selected).toEqual([]);
        if (mode === 'preference-floor') expect(rows.projectHeaders[0].commitWindow.entries[0].proof.after.preferenceRevision).toBeLessThan(window.floorRevision);
      } else if (mode === 'document-floor') {
        for (let n = 1; n <= 34; n++) {
          const header = (await physicalRows(h)).projectHeaders[0];
          const node = { ...f.image.projectNodes.values().next().value!.value, title: `Edited ${n}` };
          await h.repository.commitDocument({ scope: f.scope, clientId: 'I3-node', commitId: `node-${n}`, commitGeneration: n,
            editorGeneration: n, expectedRevision: header.storageRevision, changes: [{ type: 'put-node', node }] });
          f.expected.projects[0].initialState.nodes[node.id] = node;
        }
        const rows = await physicalRows(h); const window = rows.projectHeaders[0].commitWindow;
        expect(window.floorRevision).toBe((kind === 'historical' ? 19 : 0) + 3); expect(window.entries).toHaveLength(32);
        expect(rows.projectPreferences[0].commitWindow.entries[0].proof.after.documentRevision).toBeLessThan(window.floorRevision);
      }
      await digestMatches(f); await f.good();
      expect(f.expected).not.toEqual(f.source.snapshot);
      await f.corrupt(); await f.bad();
    } finally { h.adapter.close(); }
  }, 60_000);

  it('byte eviction removes genuine fold deltas before count limit without losing current evidence', async () => {
    const f = await setup('fresh', 't'.repeat(6000));
    try {
      let preceding: any[] = [];
      for (let n = 1; n <= 5; n++) {
        await reorder(f, n); const rows = await digestMatches(f);
        const window = rows.projectPreferences[0].commitWindow;
        expect(jsonBytes(window)).toBeLessThanOrEqual(64 * 1024);
        if (window.floorRevision > 0) {
          expect(jsonBytes({ floorRevision: 0, entries: [...preceding, window.entries.at(-1)] })).toBeGreaterThan(64 * 1024);
          expect(window.entries.length).toBeGreaterThan(0); expect(window.entries.length).toBeLessThan(32);
          break;
        }
        preceding = window.entries;
      }
      const rows = await physicalRows(f.h);
      expect(rows.projectPreferences[0].commitWindow.floorRevision).toBeGreaterThan(0);
      expect(rows.projectHeaders[0].commitWindow.floorRevision).toBeGreaterThan(0);
      await f.good(); await f.corrupt(); await f.bad();
    } finally { f.h.adapter.close(); }
  }, 60_000);

  it('self-evicted structural fold proof stays verifiable immediately, after scalar and after count eviction', async () => {
    // Exercise the UTF-8 proof budget without tripling UTF-16 traversal work.
    const templateId = '根'.repeat(24_000);
    expect(new TextEncoder().encode(templateId).length).toBeGreaterThan(64 * 1024);
    const f = await setup('fresh', templateId);
    try {
      const stale = f.fresh(); await stale.bindAdmittedProject(f.image);
      await reorder(f, 1); const rows = await digestMatches(f);
      for (const record of [rows.projectHeaders[0], rows.projectPreferences[0]]) {
        expect(record.commitWindow).toEqual({ floorRevision: 1, entries: [] }); expect(record.commitProof).not.toBeNull();
      }
      expect(await f.fresh().inspectCommit(f.scope, 'reorder-1')).toEqual({ type: 'conflict', reason: 'proof-unavailable' });
      await expect(stale.commitDocument({ scope: f.scope, clientId: 'stale', commitId: 'stale', commitGeneration: 1, editorGeneration: 1,
        expectedRevision: 1, changes: [{ type: 'put-node', node: f.image.projectNodes.values().next().value!.value }] })).rejects.toThrow('cache-gap');
      for (const state of ['immediate', 'scalar', 'count'] as const) {
        if (state === 'scalar') await f.scalar(1, stale);
        if (state === 'count') for (let n = 2; n <= 35; n++) await f.scalar(n, stale);
        await digestMatches(f); await f.good();
        const original = await f.corrupt(); await f.bad();
        await mutateRow(f.h, 'projectExtensions', store => store.put(original));
      }
      const final = await physicalRows(f.h);
      expect(final.projectPreferences[0].commitWindow.floorRevision).toBe(4);
      expect(final.projectPreferences[0].commitWindow.entries).toHaveLength(32);
      // Rebinding is explicit; durable current evidence does not synthesize replay history.
      const image = structuredClone(f.image);
      for (const store of NORMALIZED_STORE_NAMES) if (store !== 'normalizationLedger')
        Object.assign(image, { [store]: new Map(final[store].map(row => [JSON.stringify(row.key), row])) });
      await stale.bindAdmittedProject(image);
    } finally { f.h.adapter.close(); }
  }, 120_000);

  for (const consumer of ['reopen', 'active-recovery', 'retained-recovery'] as const)
  it.each(['missing', 'undefined', 'null', 'malformed', 'incorrect', 'fold-and-digest', 'unexpected'] as const)
  (`rejects advanced private evidence tampering without backfill (${consumer}): %s`, async kind => {
    const f = await setup('fresh');
    try {
      await f.scalar(1); await f.good(consumer);
      const rows = await physicalRows(f.h); const preferences = structuredClone(rows.projectPreferences[0]);
      if (kind === 'missing') delete preferences.foldRecordDigest;
      if (kind === 'undefined') preferences.foldRecordDigest = undefined;
      if (kind === 'null') preferences.foldRecordDigest = null;
      if (kind === 'malformed') preferences.foldRecordDigest = 'z'.repeat(64);
      if (kind === 'incorrect') preferences.foldRecordDigest = '0'.repeat(64);
      if (kind === 'unexpected') preferences.foldRecordDigests = preferences.foldRecordDigest;
      if (kind === 'fold-and-digest') {
        await f.corrupt(); const folds = (await physicalRows(f.h)).projectExtensions.find(row => row.key[3] === 'folds');
        preferences.foldRecordDigest = await f.h.environment.hash(frameRecord('projectExtensions', folds));
      }
      await mutateRow(f.h, 'projectPreferences', store => store.put(preferences));
      await f.bad(consumer);
    } finally { f.h.adapter.close(); }
  });
});

describe('review I4 archive identity allocation', () => {
  const preferred = `normalization-source:${NORMALIZATION_LEDGER_ID}`;
  const occupied = [preferred, `${preferred}:1`, `${preferred}:2`, `${preferred}:4`, `${preferred}:01`, `${preferred}:${'根'.repeat(100)}`];
  async function setup(referenced: boolean, ids = occupied, faultAt?: 'after-stage' | 'after-verify' | 'after-cutover') {
    // Archive allocation depends on identities and retained bytes, not artwork.
    // Keep every source category and wrapper, but do not multiply unrelated
    // element validation through all seven colliding historical backups.
    const legacyValues = validLegacyValues();
    for (const key of [LEGACY_KEYS.projects, LEGACY_KEYS.customPresets, LEGACY_KEYS.pendingImport]) {
      const value = JSON.parse(legacyValues[key]);
      for (const entry of Array.isArray(value) ? value : [value]) {
        const state = entry.initialState ?? entry.state;
        state.variants.default.templates.page.elements = [];
      }
      legacyValues[key] = JSON.stringify(value);
    }
    const h = await createNormalizationHarness({ faultAt, legacyValues });
    await h.exportSource();
    const rows = (await h.inspectFresh()).source;
    await mutateRow(h, 'legacyBackup', store => {
      for (const id of ids) store.add({ ...rows.legacyBackup[0], id });
    });
    if (referenced) await mutateRow(h, 'migrationLedger', store => store.put({ ...rows.migrationLedger[0],
      originalLegacyBackupId: preferred, acceptedLegacyBackupId: preferred }));
    // Prove compatibility at the real historical boundary before normalization.
    expect((await h.historical.bootstrap(() => {}, { allowCopiedReplacement: false })).status).toBe('admitted');
    const original = (await h.inspectFresh()).source;
    expect(original.projects).toHaveLength(1);
    expect(original.presets).toHaveLength(1);
    expect(original.pendingImports).toHaveLength(1);
    const source = await createNormalizedRepository(h.environment).readNormalizationSource();
    expect(source.backups).toEqual(original.legacyBackup);
    return { h, original, source };
  }
  async function retained(f: Awaited<ReturnType<typeof setup>>, id: string) {
    const rows = await physicalRows(f.h, [...historicalStores, 'normalizationLedger']);
    expect(rows.normalizationLedger).toHaveLength(1);
    expect(rows.normalizationLedger[0].sourceArchiveId).toBe(id);
    expect(rows.legacyBackup).toHaveLength(f.original.legacyBackup.length + 1);
    expect(rows.legacyBackup.filter(row => row.id === id)).toHaveLength(1);
    expect(rows.legacyBackup.find(row => row.id === id).kind).toBe('normalization-source');
    for (const store of historicalStores) {
      const actual = store === 'legacyBackup' ? rows[store].filter(row => row.id !== id)
        : store === 'workspace' && rows.normalizationLedger[0].state === 'active'
          ? [rows.legacyBackup.find(row => row.id === id).workspace] : rows[store];
      expect(JSON.stringify(actual)).toBe(JSON.stringify(f.original[store]));
    }
    if (rows.normalizationLedger[0].state === 'active') {
      expect(rows.workspace[0]).toMatchObject({ kind: 'normalized-workspace', coreDigest: rows.normalizationLedger[0].initialWorkspaceDigest });
      expect(rows.workspace[0].members.map(member => member.projectId)).toEqual(f.original.workspace[0].projectOrder);
    }
    expect(await createNormalizedRepository(f.h.environment).readNormalizationSource()).toEqual(f.source);
    return rows;
  }
  async function active(f: Awaited<ReturnType<typeof setup>>, id: string, consumer: 'reopen' | 'recovery') {
    expect((await f.h.run()).status).toBe('active');
    const rows = await retained(f, id);
    const fresh = () => createNormalizedRepository(f.h.environment);
    if (consumer === 'reopen') {
      expect(await fresh().readActiveAuthority()).toEqual(rows.normalizationLedger[0]);
      expect((await f.h.run()).status).toBe('active');
    } else {
      const selectors = await recoveryExports.normalizationRecoverySources(fresh());
      expect(selectors.map(selector => selector.kind).sort()).toEqual(['historical-indexeddb', 'normalized-active']);
      const exports = await Promise.all(selectors.map(selector => recoveryExports.exportNormalizationRecovery(fresh(), selector, f.h.preparation.now())));
      expect(new Set(exports.map(value => value.format)).size).toBe(2);
      for (const exported of exports) expect(exported.workspace).toEqual(f.source.snapshot);
      expect(exports.find(value => value.format === 'doctect.normalization-source-recovery')).toMatchObject({
        rollbackReady: false, records: f.source.records });
    }
    expect(await retained(f, id)).toEqual(rows);
  }

  for (const consumer of ['reopen', 'recovery'] as const) {
  for (const referenced of [true, false]) it.each([
    { ids: [preferred], suffix: ':1' }, { ids: occupied, suffix: ':3' },
  ])(`preserves ${referenced ? 'referenced' : 'unreferenced'} historical collision and chooses lowest free $suffix (${consumer})`, async ({ ids, suffix }) => {
    const f = await setup(referenced, ids);
    try { await active(f, preferred + suffix, consumer); } finally { f.h.adapter.close(); }
  });

  it.each(['after-stage', 'after-verify', 'after-cutover', 'lost-ack', 'concurrent'] as const)
  (`reuses one colliding-namespace archive across %s (${consumer})`, async mode => {
    const f = await setup(true, occupied, mode.startsWith('after-') ? mode as 'after-stage' | 'after-verify' | 'after-cutover' : undefined);
    const { h, source } = f;
    try {
      if (mode === 'lost-ack') {
        h.environment.normalizationFault = point => { if (point === 'reservation.after-commit') throw new Error('Lost I4 ack'); };
        await expect(h.repository.reserveNormalization(source)).rejects.toThrow('Lost I4 ack');
        h.environment.normalizationFault = undefined;
      } else if (mode === 'concurrent') {
        const other = createNormalizedRepository(h.environment);
        const otherSource = await other.readNormalizationSource();
        const attempts = await Promise.all([h.repository.reserveNormalization(source), other.reserveNormalization(otherSource)]);
        expect(attempts[0]).toEqual(attempts[1]);
      } else await h.runUntilInterrupted();
      const before = await retained(f, `${preferred}:3`);
      const fresh = createNormalizedRepository(h.environment);
      if (mode !== 'after-cutover') expect(await fresh.reserveNormalization(await fresh.readNormalizationSource())).toEqual(before.normalizationLedger[0]);
      h.clearFault(); await active(f, `${preferred}:3`, consumer);
      const after = await retained(f, `${preferred}:3`);
      expect(after.legacyBackup).toEqual(before.legacyBackup);
      expect(after.normalizationLedger[0].attemptId).toBe(before.normalizationLedger[0].attemptId);
      expect(after.normalizationLedger[0].storageGeneration).toBe(before.normalizationLedger[0].storageGeneration);
    } finally { h.adapter.close(); }
  });

  it(`keeps existing preferred-ID attempts compatible on fresh readers and active reopen (${consumer})`, async () => {
    const f = await setup(false, []);
    try {
      const attempt = await f.h.repository.reserveNormalization(f.source);
      expect(attempt.sourceArchiveId).toBe(preferred);
      const before = await retained(f, preferred);
      const fresh = createNormalizedRepository(f.h.environment);
      expect(await fresh.reserveNormalization(await fresh.readNormalizationSource())).toEqual(attempt);
      await active(f, preferred, consumer);
      expect((await retained(f, preferred)).legacyBackup).toEqual(before.legacyBackup);
    } finally { f.h.adapter.close(); }
  });
  }

  for (const timing of ['before', 'during'] as const) it.each(['occupy-candidate', 'mutate-backup', 'mutate-project'] as const)
  (`rejects moving source ${timing} allocation/reservation: %s`, async change => {
    const f = await setup(false); const { h, source } = f;
    let gate: ReturnType<typeof hashGate> | undefined;
    try {
      gate = timing === 'during' ? hashGate(h) : undefined;
      const pending = gate ? h.repository.reserveNormalization(source).then(() => 'accepted', error => error.message) : undefined;
      if (gate) await gate.entered;
      if (change === 'occupy-candidate') await mutateRow(h, 'legacyBackup', store => store.add({ ...f.original.legacyBackup[0], id: `${preferred}:3` }));
      else if (change === 'mutate-backup') await mutateRow(h, 'legacyBackup', store => store.put({
        ...f.original.legacyBackup.find(row => row.id === preferred), capturedAt: '2026-09-16T12:00:00.000Z' }));
      else await mutateRow(h, 'projects', store => store.put({ ...f.original.projects[0],
        project: { ...f.original.projects[0].project, name: 'Concurrent source edit' } }));
      const changed = await physicalRows(h, historicalStores);
      gate?.release();
      const outcome = pending ? await pending : await h.repository.reserveNormalization(source).then(() => 'accepted', error => error.message);
      expect(outcome).toContain('Source changed');
      expect(await physicalRows(h, historicalStores)).toEqual(changed);
      const normalized = await physicalRows(h);
      for (const store of NORMALIZED_STORE_NAMES) expect(normalized[store]).toEqual([]);
    } finally { gate?.release(); gate?.restore(); h.adapter.close(); }
  });

  it.each(['unrecorded-archive', 'marker-names-legacy'] as const)('does not exclude an unauthenticated row: %s', async corruption => {
    const f = await setup(true); const { h } = f;
    try {
      const attempt = await h.repository.reserveNormalization(f.source);
      const rows = await physicalRows(h, ['legacyBackup']);
      if (corruption === 'unrecorded-archive') await mutateRow(h, 'legacyBackup', store => store.add({
        ...rows.legacyBackup.find(row => row.id === attempt.sourceArchiveId), id: `${preferred}:5` }));
      else await mutateRow(h, 'normalizationLedger', store => store.put({ ...attempt, sourceArchiveId: preferred }));
      const before = await physicalRows(h, [...historicalStores, ...NORMALIZED_STORE_NAMES]);
      await expect(createNormalizedRepository(h.environment).readNormalizationSource()).rejects.toThrow();
      await expect(createNormalizedRepository(h.environment).reserveNormalization(f.source)).rejects.toThrow();
      expect((await h.run()).status).toBe('recovery');
      expect(await physicalRows(h, [...historicalStores, ...NORMALIZED_STORE_NAMES])).toEqual(before);
    } finally { h.adapter.close(); }
  });
});

describe('review I2 historical backup identity domain', () => {
  it.each(['x'.repeat(257), '根'.repeat(86)])('admits and independently exports referenced historical ID %s', async id => {
    const h = await createNormalizationHarness();
    try {
      await h.exportSource();
      const rows = (await h.inspectFresh()).source; const backup = { ...rows.legacyBackup[0], id };
      expect(new TextEncoder().encode(id).length).toBeGreaterThan(256);
      await mutateRow(h, 'legacyBackup', store => store.put(backup));
      await mutateRow(h, 'migrationLedger', store => store.put({ ...rows.migrationLedger[0], originalLegacyBackupId: id, acceptedLegacyBackupId: id }));
      expect((await h.historical.bootstrap(() => {}, { allowCopiedReplacement: false })).status).toBe('admitted');
      const original = (await h.inspectFresh()).source;
      const result = await h.run(); expect(result.status).toBe('active');
      const fresh = createNormalizedRepository(h.environment); const source = await fresh.readNormalizationSource();
      expect(source.backups).toContainEqual(backup); expect(source.ledger).toMatchObject({ originalLegacyBackupId: id, acceptedLegacyBackupId: id });
      const retained = (await recoveryExports.normalizationRecoverySources(fresh)).find(selector => selector.kind === 'historical-indexeddb')!;
      expect(retained).toBeDefined();
      expect(await recoveryExports.exportNormalizationRecovery(createNormalizedRepository(h.environment), retained, h.preparation.now())).toMatchObject({
        format: 'doctect.normalization-source-recovery', rollbackReady: false, workspace: source.snapshot, records: source.records });
      if (result.status === 'active') expect(result.snapshot).toEqual(source.snapshot);
      const after = (await h.inspectFresh()).source;
      expect(after.legacyBackup.filter(row => row.kind !== 'normalization-source')).toEqual(original.legacyBackup);
      expect(after.projects).toEqual(original.projects); expect(after.migrationLedger).toEqual(original.migrationLedger);
      // Historical IDs are not a relaxation of newly owned private commit identities.
      await expect(fresh.commitPreferences({ scope: { storageGeneration: `normalized:${source.sourceDigest}`,
        projectId: source.records.projects[0].id, incarnation: source.records.projects[0].incarnation },
      clientId: 'review-I2', commitId: id, commitGeneration: 1, editorGeneration: 1, observedPreferenceRevision: 0, patch: { scale: 3 } }))
        .rejects.toThrow('Invalid private identity');
    } finally { h.adapter.close(); }
  });

  it.each(['empty-id', 'numeric-id', 'array-id', 'extra-field', 'digest', 'content', 'timestamp', 'reference'] as const)
  ('still rejects malformed historical backup %s', async kind => {
    const h = await createNormalizationHarness();
    try {
      await h.exportSource(); const rows = (await h.inspectFresh()).source;
      const backup = structuredClone(rows.legacyBackup[0]);
      if (kind === 'empty-id') backup.id = '';
      if (kind === 'numeric-id') backup.id = 257;
      if (kind === 'array-id') backup.id = ['historical'];
      if (kind === 'extra-field') backup.unrecognized = true;
      if (kind === 'digest') backup.digest = 'a'.repeat(64);
      if (kind === 'content') backup.snapshot[LEGACY_KEYS.activeProject].raw = 'other';
      if (kind === 'timestamp') backup.capturedAt = '2026-08-14';
      if (kind === 'reference') await mutateRow(h, 'migrationLedger', store => store.put({ ...rows.migrationLedger[0], acceptedLegacyBackupId: 'missing' }));
      else await mutateRow(h, 'legacyBackup', store => store.put(backup));
      const malformed = await physicalRows(h, historicalStores);
      await expect(createNormalizedRepository(h.environment).readNormalizationSource()).rejects.toThrow();
      expect((await h.run()).status).toBe('recovery');
      expect(await physicalRows(h, historicalStores)).toEqual(malformed);
      expect((await physicalRows(h)).normalizationLedger).toEqual([]);
    } finally { h.adapter.close(); }
  });
});

describe('adversarial normalization acceptance', () => {
  it('hashes only outside write transactions and publishes durable monotonic stage progress despite observer exceptions', async () => {
    const h = await createNormalizationHarness();
    try {
      await h.exportSource(); const stored = (await h.inspectFresh()).source.projects[0];
      stored.project.initialState = makeIncrementalProject(80).initialState;
      await mutateRow(h, 'projects', store => store.put(stored));
      const transaction = IDBDatabase.prototype.transaction; let writers = 0; let hashes = 0;
      const hook = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (names, mode, options) {
        const tx = transaction.call(this, names, mode, options);
        if (mode === 'readwrite') {
          writers++;
          tx.addEventListener('complete', () => { writers--; }); tx.addEventListener('abort', () => { writers--; });
        }
        return tx;
      });
      const createHash = normalizationHash.createNormalizationSha256;
      const hashHook = vi.spyOn(normalizationHash, 'createNormalizationSha256').mockImplementation(() => {
        const hasher = createHash();
        const check = () => { if (writers !== 0) throw new Error('Hash ran inside a write transaction'); hashes++; };
        return { ...hasher, update(bytes) { check(); return hasher.update(bytes); },
          finish() { check(); return hasher.finish(); } };
      });
      const progress: Array<{ completed: number; total: number }> = [];
      const result = await normalizeWorkspace({ repository: h.repository, historical: h.historical, ensurePhysicalLayout: () => h.adapter.open(),
        onProgress: event => {
          if (event.phase === 'staging') progress.push({ completed: event.completed!, total: event.total! });
          throw new Error('Observer failure cannot control persistence');
        } });
      hook.mockRestore(); hashHook.mockRestore();
      expect(result.status).toBe('active'); expect(hashes).toBeGreaterThan(0); expect(writers).toBe(0);
      // Copying is announced at the durable reserved position before the first chunk is staged.
      expect(progress.length).toBeGreaterThan(2); expect(progress[0].completed).toBe(0); expect(progress[1].completed).toBe(64);
      expect(progress.at(-1)!.completed).toBe(progress.at(-1)!.total);
      expect(progress.every((entry, i) => i === 0 || entry.completed > progress[i - 1].completed)).toBe(true);
      expect((await physicalRows(h)).normalizationLedger[0]).toMatchObject({ nextRecord: progress.at(-1)!.total, state: 'active' });
    } finally { h.adapter.close(); }
  });

  it.each(['edited', 'invalid'] as const)('competing %s active winner is followed only after independent validation', async kind => {
    const h = await createNormalizationHarness();
    try {
      const original = await h.exportSource(); const gate = hashGate(h);
      const loser = h.run(); await gate.entered;
      expect((await h.run()).status).toBe('active');
      const remote = createNormalizedRepository(h.environment); const image = await activeImage(h); await remote.bindAdmittedProject(image);
      await remote.commitPreferences({ scope: image.scope, clientId: 'winner', commitId: 'remote-pref', commitGeneration: 1,
        editorGeneration: 1, observedPreferenceRevision: 0, patch: { scale: 3 } });
      if (kind === 'invalid') {
        const rows = await physicalRows(h); const node = rows.projectNodes[0];
        await mutateRow(h, 'projectNodes', store => store.delete(node.key));
      }
      gate.release(); const result = await loser; gate.restore();
      expect(result.status).toBe(kind === 'edited' ? 'active' : 'recovery');
      if (result.status === 'active') expect(result.snapshot.projects[0].initialState.scale).toBe(3);
      expect(await h.exportSource()).toEqual(original); expect(await h.countActiveAuthorities()).toBe(1);
    } finally { h.adapter.close(); }
  });

  it.each(['verify', 'activate'] as const)('queued source/target transaction before %s CAS prevents marker publication', async phase => {
    for (const store of ['presets', 'projectNodes'] as const) {
      const h = await createNormalizationHarness();
      try {
        await h.exportSource(); const source = await h.repository.readNormalizationSource();
        let attempt = await h.repository.reserveNormalization(source);
        attempt = await h.repository.stageNormalization(attempt, prepareNormalizationTarget(source));
        if (phase === 'activate') attempt = await h.repository.markNormalizationVerified(attempt, source.contentDigest);
        const changed = (await physicalRows(h, [store]))[store][0];
        if (store === 'presets') changed.preset.title = 'Queued source mutation'; else changed.value.title = 'Queued target mutation';
        const competing = await request(h.indexedDB.open(h.databaseName));
        const nativeTransaction = IDBDatabase.prototype.transaction; let fired = false; let mutation: Promise<void> | undefined;
        const hook = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (names, mode, options) {
          if (!fired && mode === 'readwrite' && Array.from(typeof names === 'string' ? [names] : names).includes('normalizationLedger')) {
            fired = true;
            const tx = nativeTransaction.call(competing, store, 'readwrite'); mutation = done(tx); tx.objectStore(store).put(changed);
          }
          return nativeTransaction.call(this, names, mode, options);
        });
        try {
          await expect(phase === 'verify' ? h.repository.markNormalizationVerified(attempt, source.contentDigest)
            : h.repository.activateNormalization(attempt)).rejects.toThrow('normalization-contention');
          await mutation; expect(fired).toBe(true);
        } finally { hook.mockRestore(); competing.close(); }
        expect((await physicalRows(h)).normalizationLedger).toEqual([attempt]);
        expect(await h.countActiveAuthorities()).toBe(0);
        expect((await h.run()).status).toBe('recovery');
      } finally { h.adapter.close(); }
    }
  });

  it('maximum safe migrated revision remains exact and its next ordinary save fails closed', async () => {
    const h = await createNormalizationHarness();
    try {
      await h.exportSource(); const stored = (await h.inspectFresh()).source.projects[0]; stored.storageRevision = Number.MAX_SAFE_INTEGER;
      await mutateRow(h, 'projects', store => store.put(stored)); expect((await h.run()).status).toBe('active');
      const image = await activeImage(h); await h.repository.bindAdmittedProject(image);
      const before = await physicalRows(h);
      await expect(h.repository.commitDocument({ scope: image.scope, clientId: 'exhausted', commitId: 'overflow', commitGeneration: 1,
        editorGeneration: 1, expectedRevision: Number.MAX_SAFE_INTEGER,
        changes: [{ type: 'put-node', node: { ...stored.project.initialState.nodes.root, title: 'Not saved' } }] })).rejects.toThrow();
      expect(await physicalRows(h)).toEqual(before);
      expect((await h.exportActive()).projects[0]).toEqual(stored.project);
    } finally { h.adapter.close(); }
  });

  it.each([512, 513])('normalization respects existing external nesting depth %s', async depth => {
    const h = await createNormalizationHarness();
    try {
      await h.exportSource(); const stored = (await h.inspectFresh()).source.projects[0];
      let nested: object = {}; for (let i = 1; i < depth; i++) nested = { child: nested };
      stored.project.retained = nested;
      if (depth === 512) expect(() => validateWorkspaceProject(stored.project)).not.toThrow();
      else expect(() => validateWorkspaceProject(stored.project)).toThrow('nesting exceeds 512');
      await mutateRow(h, 'projects', store => store.put(stored));
      const result = await h.run(); expect(result.status, result.status === 'recovery' ? result.recovery.message : '').toBe(depth === 512 ? 'active' : 'recovery');
      if (depth === 512) expect((await h.exportActive()).projects[0]).toEqual(stored.project);
      else expect(await h.countActiveAuthorities()).toBe(0);
      expect((await h.inspectFresh()).source.projects).toEqual([stored]);
    } finally { h.adapter.close(); }
  });

  it.each([0, 1])('normalization retains generator UTF-8 512KiB boundary plus %s byte', async over => {
    const h = await createNormalizationHarness();
    try {
      await h.exportSource(); const stored = (await h.inspectFresh()).source.projects[0];
      const script = '😀'.repeat(128 * 1024) + 'x'.repeat(over);
      stored.project.initialState.generator!.templateScript = script;
      expect(new TextEncoder().encode(script).length).toBe(512 * 1024 + over);
      if (over) expect(() => validateWorkspaceProject(stored.project)).toThrow('512 KiB');
      else expect(() => validateWorkspaceProject(stored.project)).not.toThrow();
      await mutateRow(h, 'projects', store => store.put(stored));
      expect((await h.run()).status).toBe(over ? 'recovery' : 'active');
      if (!over) expect((await h.exportActive()).projects[0].initialState.generator).toEqual(stored.project.initialState.generator);
      else expect(await h.countActiveAuthorities()).toBe(0);
      expect((await h.inspectFresh()).source.projects[0].project.initialState.generator!.templateScript).toBe(script);
    } finally { h.adapter.close(); }
  });

  it('normalization preserves original 32MiB state boundary and refuses one extra UTF-8 byte', async () => {
    const h = await createNormalizationHarness();
    try {
      await h.exportSource(); const stored = (await h.inspectFresh()).source.projects[0];
      const state = stored.project.initialState;
      Object.assign(state, { padding: '😀' });
      const base = new TextEncoder().encode(JSON.stringify(state)).length;
      Object.assign(state, { padding: '😀' + 'x'.repeat(MAX_STATE_BYTES - base) });
      expect(new TextEncoder().encode(JSON.stringify(state)).length).toBe(MAX_STATE_BYTES);
      expect(() => validateWorkspaceProject(stored.project)).not.toThrow();
      await mutateRow(h, 'projects', store => store.put(stored));
      const phases: string[] = [];
      const result = await normalizeWorkspace({ repository: h.repository, historical: h.historical, ensurePhysicalLayout: () => h.adapter.open(),
        onProgress: ({ phase }) => { phases.push(phase); } });
      expect(result.status, result.status === 'recovery' ? result.recovery.message : '').toBe('active');
      expect(phases.at(-1)).toBe('active');
      const exported = await h.exportActive();
      expect(new TextEncoder().encode(JSON.stringify(exported.projects[0].initialState)).length).toBe(MAX_STATE_BYTES);
      expect(exported.projects[0].initialState).toEqual(state);
      // A separate physical source, not a modified active archive, proves admission refusal.
      const invalid = await createNormalizationHarness();
      try {
        await invalid.exportSource(); const bad = (await invalid.inspectFresh()).source.projects[0];
        bad.project.initialState = { ...state, padding: Reflect.get(state, 'padding') + 'x' };
        expect(() => validateWorkspaceProject(bad.project)).toThrow();
        await mutateRow(invalid, 'projects', store => store.put(bad));
        expect((await invalid.run()).status).toBe('recovery'); expect(await invalid.countActiveAuthorities()).toBe(0);
        expect((await invalid.inspectFresh()).source.projects[0].project.initialState).toEqual(bad.project.initialState);
      } finally { invalid.adapter.close(); }
    } finally { h.adapter.close(); }
  }, 600_000); // Real maximum-size bulk path, not the ordinary-save performance budget.

  it.each(['projects', 'workspace', 'migrationLedger'] as const)('algorithm refuses unsafe %s source counter without resetting it', async store => {
    const h = await createNormalizationHarness();
    try {
      await h.exportSource(); const rows = (await h.inspectFresh()).source;
      const field = store === 'projects' ? 'storageRevision' : store === 'workspace' ? 'revision' : 'ledgerRevision';
      const record = { ...rows[store][0], [field]: Number.MAX_SAFE_INTEGER + 1 };
      await mutateRow(h, store, objectStore => objectStore.put(record));
      const before = (await h.inspectFresh()).source;
      expect((await h.run()).status).toBe('recovery'); expect(await h.countActiveAuthorities()).toBe(0);
      expect((await h.inspectFresh()).source).toEqual(before);
    } finally { h.adapter.close(); }
  });

  it.each(['clone', 'termination'] as const)('real stage transaction %s failure aborts the whole batch and resumes', async failure => {
    const h = await createNormalizationHarness();
    try {
      const original = await h.exportSource(); let fired = false; let ordinal = 0;
      const add = IDBObjectStore.prototype.add;
      const hook = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (value, key) {
        if (this.name.startsWith('project') && this.name !== 'projects' && ++ordinal === 2) {
          fired = true;
          if (failure === 'clone') return add.call(this, { ...value, uncloneable: () => {} }, key);
          const write = add.call(this, value, key);
          write.addEventListener('success', () => {
            // fake-indexeddb's forceCloseDatabase drains transactions instead of
            // aborting them. Explicitly abort the real transaction to model loss.
            this.transaction.abort(); forceCloseDatabase(this.transaction.db);
          });
          return write;
        }
        return add.call(this, value, key);
      });
      const result = await h.run(); hook.mockRestore();
      expect(result.status).toBe('unavailable'); expect(fired).toBe(true);
      const rows = await physicalRows(h);
      expect(rows.normalizationLedger[0]).toMatchObject({ state: 'staging', nextRecord: 0, progressRevision: 0 });
      for (const store of NORMALIZED_STORE_NAMES) if (store !== 'normalizationLedger') expect(rows[store]).toEqual([]);
      expect((await h.repository.readNormalizationSource()).snapshot).toEqual(original);
      expect((await h.run()).status).toBe('active'); expect(await h.exportActive()).toEqual(original);
    } finally { h.adapter.close(); }
  });

  it('real versionchange during awaited source preparation prevents stale readiness', async () => {
    const h = await createNormalizationHarness();
    try {
      const original = await h.exportSource(); const gate = hashGate(h);
      const running = h.run(); await gate.entered;
      const upgrade = await request(h.indexedDB.open(h.databaseName, 4)); upgrade.close();
      gate.release(); const result = await running; gate.restore();
      expect(result.status).not.toBe('active');
      expect((await physicalRows(h)).normalizationLedger).toEqual([]);
      expect((await h.inspectFresh()).source.projects.map(row => row.project)).toEqual(original.projects);
    } finally { h.adapter.close(); }
  });

  it('failed final physical reopen never reports active; durable cutover resumes on fresh reader', async () => {
    const h = await createNormalizationHarness();
    try {
      const original = await h.exportSource(); let fired = false;
      const result = await normalizeWorkspace({ repository: h.repository, historical: h.historical, ensurePhysicalLayout: () => h.adapter.open(),
        checkpoint: point => {
          if (point === 'after-cutover') vi.spyOn(h.indexedDB, 'open').mockImplementationOnce(() => {
            fired = true; throw new DOMException('Connection lost on reopen', 'InvalidStateError');
          });
        } });
      expect(result.status).toBe('unavailable'); expect(fired).toBe(true);
      expect(await h.countActiveAuthorities()).toBe(1); expect(await h.exportSource()).toEqual(original);
      expect((await h.run()).status).toBe('active'); expect(await h.exportActive()).toEqual(original);
    } finally { h.adapter.close(); }
  });

  it.each(['cancel', 'epoch', 'source'] as const)('owner %s change during awaited hashing cannot publish stale ready', async kind => {
    const h = await createNormalizationHarness(); const owner = createWorkspaceWorkerHandler(h.environment);
    const controller = new AbortController();
    try {
      const original = await h.exportSource(); const gate = hashGate(h);
      const phases: string[] = [];
      const running = owner.normalize({ historical: h.historical, ensurePhysicalLayout: () => h.adapter.open(), signal: controller.signal,
        onProgress: ({ phase }) => { phases.push(phase); throw new Error('passive progress'); } });
      await gate.entered;
      let incoming: ReturnType<typeof owner.handle> | undefined;
      if (kind === 'cancel') controller.abort();
      if (kind === 'source') h.legacyStorage.seed(LEGACY_KEYS.activeProject, 'changed-during-hash');
      if (kind === 'epoch') incoming = owner.handle({ protocolVersion: 1, workerEpoch: 17, requestId: 1,
        request: { type: 'recovery-export', scope: { storageGeneration: 'unknown', projectId: 'project-a', incarnation: 'fixture-uuid' } } });
      gate.release(); const result = await running; if (incoming) await incoming; gate.restore();
      expect(result.status).toBe(kind === 'source' ? 'recovery' : 'unavailable');
      expect(phases).not.toContain('active'); expect(await h.countActiveAuthorities()).toBe(0);
      expect((await h.repository.readNormalizationSource()).snapshot).toEqual(original);
    } finally { owner.dispose(); h.adapter.close(); }
  });

  it('owner FIFO orders normalize, incoming preference save and following normalize on one repository', async () => {
    const h = await createNormalizationHarness(); const owner = createWorkspaceWorkerHandler(h.environment);
    try {
      await h.exportSource(); expect((await h.run()).status).toBe('active'); const image = await activeImage(h);
      const bound = await owner.handle({ protocolVersion: 1, workerEpoch: 8, requestId: 1, request: { type: 'bootstrap', project: image } });
      expect(bound.response.type).toBe('bootstrapped');
      const events: string[] = []; const gate = hashGate(h);
      const normalizing = owner.normalize({ historical: h.historical, ensurePhysicalLayout: () => h.adapter.open(),
        onProgress: ({ phase }) => { if (phase === 'active') events.push('first:active'); } });
      await gate.entered;
      const saving = owner.handle({ protocolVersion: 1, workerEpoch: 8, requestId: 2, request: { type: 'preferences', admissionId: 1,
        batch: { scope: image.scope, clientId: 'fifo', commitId: 'pref-1', commitGeneration: 1, editorGeneration: 1,
          observedPreferenceRevision: 0, patch: { scale: 2.5 } } } }).then(result => { events.push('save:ack'); return result; });
      const following = owner.normalize({ historical: h.historical, ensurePhysicalLayout: () => { events.push('second:start'); return h.adapter.open(); } });
      expect(events).toEqual([]); gate.release();
      expect((await normalizing).status).toBe('active'); expect((await saving).response.type).toBe('preferences-result');
      const result = await following; expect(result.status).toBe('active'); gate.restore();
      expect(events).toEqual(['first:active', 'save:ack', 'second:start']);
      expect((await h.exportActive()).projects[0].initialState.scale).toBe(2.5);
    } finally { owner.dispose(); h.adapter.close(); }
  });

  it('migrated remote edits survive proof-window eviction; forged edited baseline is never admitted', async () => {
    const h = await createNormalizationHarness();
    try {
      await h.exportSource(); const stored = (await h.inspectFresh()).source.projects[0]; stored.storageRevision = 19;
      await mutateRow(h, 'projects', store => store.put(stored));
      const original = await h.exportSource(); expect((await h.run()).status).toBe('active');
      const remote = createNormalizedRepository(h.environment); const image = await activeImage(h); await remote.bindAdmittedProject(image);
      h.operations.length = 0;
      for (let i = 1; i <= 35; i++) await remote.commitDocument({ scope: image.scope, clientId: 'remote', commitId: `edit-${i}`,
        commitGeneration: i, editorGeneration: i, expectedRevision: 18 + i,
        changes: [{ type: 'put-node', node: { ...stored.project.initialState.nodes.root, title: `Remote ${i}` } }] });
      expect(h.operations.every(operation => operation.method !== 'getAll')).toBe(true);
      const header = (await physicalRows(h)).projectHeaders[0];
      expect(header.storageRevision).toBe(54); expect(header.commitWindow.floorRevision).toBeGreaterThan(19);
      expect(header.commitWindow.entries).toHaveLength(32);
      const result = await h.run(); expect(result.status).toBe('active');
      expect((await h.exportActive()).projects[0].initialState.nodes.root.title).toBe('Remote 35');
      const proof = structuredClone(header.commitProof); header.migrationBaseline.sourceDigest = 'f'.repeat(64);
      await mutateRow(h, 'projectHeaders', store => store.put(header));
      expect((await physicalRows(h)).projectHeaders[0].commitProof).toEqual(proof);
      expect((await h.run()).status).toBe('recovery'); expect(await h.exportSource()).toEqual(original);
      expect(await h.countActiveAuthorities()).toBe(1);
    } finally { h.adapter.close(); }
  });

  it.each([0, 1])('enforces exact 256KiB stage UTF-8 frame boundary plus %s byte', async over => {
    const h = await createNormalizationHarness();
    try {
      await h.exportSource(); const stored = (await h.inspectFresh()).source.projects[0];
      stored.project.initialState.nodes.root.data.label = '☕😀';
      let padding = 250_000;
      let source: Awaited<ReturnType<typeof h.repository.readNormalizationSource>>;
      let target: ReturnType<typeof prepareNormalizationTarget>;
      for (let pass = 0; pass < 8; pass++) {
        Object.assign(stored.project.initialState.nodes.root.data, { padding: 'x'.repeat(padding) });
        await mutateRow(h, 'projects', store => store.put(stored));
        source = await h.repository.readNormalizationSource(); target = prepareNormalizationTarget(source);
        const size = target.slice(0, 2).reduce((sum, item) => sum + new TextEncoder().encode(frameRecord(item.store, item.record)).length, 0);
        if (size === 256 * 1024 + over) break;
        padding += 256 * 1024 + over - size;
      }
      expect(target!.slice(0, 2).reduce((sum, item) => sum + new TextEncoder().encode(frameRecord(item.store, item.record)).length, 0)).toBe(256 * 1024 + over);
      const attempt = await h.repository.reserveNormalization(source!);
      if (over) {
        await expect(h.repository.stageNormalization(attempt, target!.slice(0, 2))).rejects.toThrow('byte budget');
        expect((await physicalRows(h)).normalizationLedger[0]).toEqual(attempt);
      } else expect(await h.repository.stageNormalization(attempt, target!.slice(0, 2))).toMatchObject({ nextRecord: 2, progressRevision: 1 });
      expect((await h.run()).status).toBe('active'); expect(await h.exportActive()).toEqual(source!.snapshot);
    } finally { h.adapter.close(); }
  });

  it.each(['stage', 'verify', 'activate'] as const)('stale marker captured during %s hashing cannot advance the cursor or authority', async phase => {
    const h = await createNormalizationHarness();
    try {
      await h.exportSource(); const source = await h.repository.readNormalizationSource(); const target = prepareNormalizationTarget(source);
      let attempt = await h.repository.reserveNormalization(source);
      attempt = await h.repository.stageNormalization(attempt, phase === 'stage' ? target.slice(0, 2) : target);
      if (phase === 'activate') attempt = await h.repository.markNormalizationVerified(attempt, source.contentDigest);
      const changed = { ...attempt, progressRevision: attempt.progressRevision + 1 };
      const pause = h.environment.normalizationPause; let fired = false;
      h.environment.normalizationPause = async point => {
        await pause?.(point);
        if (point.point === 'before-hash' && !fired) { fired = true; await mutateRow(h, 'normalizationLedger', store => store.put(changed)); }
      };
      const operation = phase === 'stage' ? h.repository.stageNormalization(attempt, target.slice(2))
        : phase === 'verify' ? h.repository.markNormalizationVerified(attempt, source.contentDigest) : h.repository.activateNormalization(attempt);
      await expect(operation).rejects.toThrow('normalization-contention');
      expect(fired).toBe(true); expect((await physicalRows(h)).normalizationLedger).toEqual([changed]);
      expect(await h.countActiveAuthorities()).toBe(0);
    } finally { h.adapter.close(); }
  });

  it.each(['unknown', 'null', 'extra', 'inherited', 'stale-cutover', 'wrong-generation', 'wrong-digest', 'rollback', 'authority', 'wrong-kind', 'bad-time'] as const)
  ('rejects malformed or forged recovery selector: %s', async kind => {
    const h = await createNormalizationHarness();
    try {
      const original = await h.exportSource(); expect((await h.run()).status).toBe('active');
      const selectors = await recoveryExports.normalizationRecoverySources(h.repository);
      let selector: unknown = { ...selectors[0] }; let time = h.preparation.now();
      if (kind === 'unknown') selector = { kind: 'normalized-staging' };
      if (kind === 'null') selector = null;
      if (kind === 'extra') Object.assign(selector!, { unexpected: true });
      if (kind === 'inherited') selector = Object.create(selectors[0]);
      if (kind === 'stale-cutover') selector = { ...selectors[1], cutoverRevision: 0 };
      if (kind === 'wrong-generation') selector = { ...selectors[1], storageGeneration: 'forged' };
      if (kind === 'wrong-digest') Object.assign(selector!, { sourceDigest: '0'.repeat(64) });
      if (kind === 'rollback') Object.assign(selector!, { rollbackReady: true });
      if (kind === 'authority') Object.assign(selector!, { authority: 'active' });
      if (kind === 'wrong-kind') Object.assign(selector!, { kind: 'fresh-seed' });
      if (kind === 'bad-time') time = 'yesterday';
      await expect(recoveryExports.exportNormalizationRecovery(h.repository, selector as recoveryExports.NormalizationRecoverySource, time)).rejects.toThrow();
      expect(await h.exportSource()).toEqual(original); expect(await h.exportActive()).toEqual(original);
    } finally { h.adapter.close(); }
  });

  it.each(['value', 'order', 'counter', 'preferences', 'extra', 'missing', 'incarnation', 'store', 'progress', 'verified-marker'] as const)
  ('independent staged %s corruption refuses verification and retains source', async kind => {
    const h = await createNormalizationHarness({ faultAt: kind === 'verified-marker' ? 'after-verify' : 'after-stage' });
    try {
      const source = await h.exportSource(); await h.runUntilInterrupted();
      const rows = await physicalRows(h);
      const store = kind === 'preferences' ? 'projectPreferences' : ['order', 'counter'].includes(kind) ? 'projectHeaders'
        : ['progress', 'verified-marker'].includes(kind) ? 'normalizationLedger' : 'projectNodes';
      const record = structuredClone(rows[store][0]);
      if (kind === 'value') record.value.title = record.value.title.replace('Racine', 'Poison'); // Same UTF-8 length/counters.
      if (kind === 'order') record.order.state.reverse(); // Valid membership, wrong original order.
      if (kind === 'counter') record.counters.documentBytes++;
      if (kind === 'preferences') record.value.scale = 7;
      if (kind === 'extra') record.key = [...record.key.slice(0, -1), 'extra-node'];
      if (kind === 'incarnation') record.key[2] = 'other-incarnation';
      if (kind === 'progress') record.progressRevision = 0; // A nonempty prefix cannot have zero committed batches.
      if (kind === 'verified-marker') record.verificationDigest = '0'.repeat(64);
      if (kind === 'store') await mutateRow(h, 'projectTemplates', objectStore => objectStore.put(record));
      else await mutateRow(h, store, objectStore => kind === 'missing' ? objectStore.delete(record.key) : objectStore.put(record));
      const corrupted = await physicalRows(h);
      h.clearFault(); expect((await h.run()).status).toBe('recovery');
      expect(await h.countActiveAuthorities()).toBe(0);
      if (kind === 'progress') expect((await h.inspectFresh()).source.projects.map(row => row.project)).toEqual(source.projects);
      else expect(await h.exportSource()).toEqual(source);
      expect(await physicalRows(h)).toEqual(corrupted);
    } finally { h.adapter.close(); }
  });

  it('independent cursor rejects physical key mismatch even when envelope values and manifest match', async () => {
    const h = await createNormalizationHarness({ outOfLineNodes: true });
    try {
      const original = await h.exportSource(); const source = await h.repository.readNormalizationSource();
      const attempt = await h.repository.reserveNormalization(source); const target = prepareNormalizationTarget(source);
      const db = await request(h.indexedDB.open(h.databaseName));
      const tx = db.transaction([...NORMALIZED_STORE_NAMES], 'readwrite'); const completion = done(tx);
      for (const item of target) {
        if (item.store === 'projectNodes') tx.objectStore(item.store).put(item.record, [...item.record.key.slice(0, -1), 'wrong-physical-key']);
        else tx.objectStore(item.store).put(item.record);
      }
      const staged = { ...attempt, nextRecord: target.length, progressRevision: 1 };
      tx.objectStore('normalizationLedger').put(staged); await completion; db.close();
      await expect(createNormalizedRepository(h.environment).readStagedProject(staged, source.snapshot.projects[0].id)).rejects.toThrow('Physical key mismatch');
      expect((await h.run()).status).toBe('recovery'); expect(await h.exportSource()).toEqual(original);
      expect(await h.countActiveAuthorities()).toBe(0);
    } finally { h.adapter.close(); }
  });

  it('every physical write ordinal in a multi-record stage batch rolls back records and cursor together', async () => {
    const h = await createNormalizationHarness();
    try {
      const original = await h.exportSource(); const source = await h.repository.readNormalizationSource();
      const attempt = await h.repository.reserveNormalization(source); const target = prepareNormalizationTarget(source);
      expect(target.length).toBeGreaterThan(4); expect(target.length).toBeLessThan(64);
      const before = await physicalRows(h);
      // Include successful marker put, not merely each payload add.
      for (let failOrdinal = 1; failOrdinal <= target.length + 1; failOrdinal++) {
        let ordinal = 0;
        h.environment.normalizationFault = point => {
          if (point === 'stage.after-record' || point === 'stage.after-marker') {
            if (++ordinal === failOrdinal) throw new DOMException(`ordinal ${ordinal}`, 'QuotaExceededError');
          }
        };
        await expect(h.repository.stageNormalization(attempt, target)).rejects.toMatchObject({ name: 'QuotaExceededError' });
        expect(ordinal).toBe(failOrdinal); expect(await physicalRows(h)).toEqual(before);
        expect(await h.exportSource()).toEqual(original);
      }
      h.environment.normalizationFault = undefined;
      expect((await h.run()).status).toBe('active'); expect(await h.exportActive()).toEqual(original);
    } finally { h.adapter.close(); }
  });

  it.each(['stage', 'verify', 'activate'] as const)('source and target mutation during awaited %s hashing never publishes authority', async phase => {
    for (const store of ['projects', 'projectNodes'] as const) {
      const h = await createNormalizationHarness();
      try {
        await h.exportSource(); const source = await h.repository.readNormalizationSource();
        const target = prepareNormalizationTarget(source); let attempt = await h.repository.reserveNormalization(source);
        attempt = await h.repository.stageNormalization(attempt, phase === 'stage' ? target.slice(0, 2) : target);
        if (phase === 'activate') attempt = await h.repository.markNormalizationVerified(attempt, source.contentDigest);
        const pause = h.environment.normalizationPause; let fired = false;
        h.environment.normalizationPause = async point => {
          await pause?.(point);
          if (point.point === 'before-hash' && !fired) {
            fired = true;
            const record = structuredClone((await physicalRows(h, [store]))[store][0]);
            if (store === 'projects') record.project.name = 'Changed during awaited hash';
            else record.value.title = 'Changed during awaited hash';
            await mutateRow(h, store, objectStore => objectStore.put(record));
          }
        };
        const operation = phase === 'stage' ? h.repository.stageNormalization(attempt, target.slice(2))
          : phase === 'verify' ? h.repository.markNormalizationVerified(attempt, source.contentDigest) : h.repository.activateNormalization(attempt);
        const outcome = await operation.then(() => 'committed', () => 'refused');
        // Stage prepares a bounded payload; final verify/cutover owns full source CAS.
        if (phase !== 'stage') expect(outcome).toBe('refused');
        expect(fired).toBe(true); h.environment.normalizationPause = pause;
        expect((await h.run()).status).toBe('recovery'); expect(await h.countActiveAuthorities()).toBe(0);
        expect((await physicalRows(h, historicalStores)).legacyBackup.filter(row => row.kind === 'normalization-source')).toHaveLength(1);
      } finally { h.adapter.close(); }
    }
  });

  it.each(['cutover', 'cutover bytes', 'ancillary edits'] as const)('canonical source survives %s with fresh-reader recovery', async phase => {
    const h = await createNormalizationHarness();
    try {
      await h.exportSource();
      const stored = structuredClone((await h.inspectFresh()).source.projects[0]);
      Object.assign(stored, { storageRevision: 29, updatedAt: '2026-09-16T10:11:12.000Z',
        consumedImportId: 'consumed', consumedImportCreatedAt: '2026-09-15T09:00:00.000Z', consumedImportDigest: 'a'.repeat(64),
        consumedImportAttempt: { sourceKeyDigest: 'c'.repeat(64), payloadDigest: 'd'.repeat(64), pendingImportDigest: 'a'.repeat(64) } });
      const state = stored.project.initialState;
      const template = structuredClone(state.variants.default.templates.page);
      state.nodes = { '10': { ...state.nodes.root, id: '10', children: ['2', 'z'] },
        z: { ...state.nodes.root, id: 'z', parentId: '10' }, '2': { ...state.nodes.root, id: '2', parentId: '10' } };
      state.rootId = '10'; state.selectedNodeId = '10';
      state.variants = { z: { id: 'z', name: 'Z', templates: { '10': { ...template, id: '10' }, '2': { ...template, id: '2' } } },
        '2': { id: '2', name: 'Two', templates: { '2': { ...template, id: '2' }, '10': { ...template, id: '10' } } } };
      state.activeVariantId = 'z'; state.selectedTemplateId = '2';
      state.selectedNodeIds = ['z', '2']; state.selectedElementIds = ['raw-absent-element'];
      Reflect.deleteProperty(state, 'showGrid'); Reflect.deleteProperty(state, 'snapToGrid');
      Object.assign(state, { retainedCompatibility: { raw: ['☕', '😀'] } });
      Object.assign(stored.project, { updatedAt: 'public-wrapper-not-private-ISO', retainedWrapperField: { b: 2, a: 1 } });
      const pending = structuredClone(h.source.pendingImports[0]);
      pending.pendingImport.createdAt = '2026-09-14T01:02:03.000Z';
      Object.assign(pending, { attemptProvenance: { sourceKeyDigest: 'e'.repeat(64), payloadDigest: 'f'.repeat(64), pendingImportDigest: 'b'.repeat(64) } });
      await mutateRow(h, 'projects', store => store.put(stored));
      await mutateRow(h, 'pendingImports', store => store.put(pending));
      const original = await h.exportSource(); const before = (await h.inspectFresh()).source;
      expect((await h.run()).status).toBe('active');
      const fresh = createNormalizedRepository(h.environment);
      const selectors = await recoveryExports.normalizationRecoverySources(fresh);
      const historical = await recoveryExports.exportNormalizationRecovery(fresh, selectors[0], h.preparation.now());
      expect(historical).toMatchObject({ workspace: original, records: { projects: [stored], pendingImports: [pending] }, rollbackReady: false });
      if (phase !== 'ancillary edits') {
        if (phase === 'cutover') expect(await h.exportActive()).toEqual(original);
        else expect(JSON.stringify((await h.exportActive()).projects[0])).toBe(JSON.stringify(stored.project));
        const header = (await physicalRows(h)).projectHeaders[0];
        expect(header).toMatchObject({ storageRevision: 29, updatedAt: stored.updatedAt, commitProof: null,
          commitWindow: { floorRevision: 29, entries: [] }, migrationBaseline: { sourceRevision: 29, sourceUpdatedAt: stored.updatedAt } });
      } else {
        await mutateRow(h, 'presets', store => store.put({ ...before.presets[0], preset: { ...before.presets[0].preset, title: 'Edited ancillary' } }));
        await mutateRow(h, 'pendingImports', store => store.delete(pending.id));
        await refreshAncillaryManifestFixture(h);
        const current = await h.exportActive(); expect(current.customPresets[0].title).toBe('Edited ancillary'); expect(current.pendingImports).toEqual([]);
        expect(await recoveryExports.exportNormalizationRecovery(createNormalizedRepository(h.environment), selectors[0], h.preparation.now())).toEqual(historical);
      }
      expect((await h.inspectFresh()).source.projects).toEqual(before.projects);
    } finally { h.adapter.close(); }
  });

  it.each(['native', 'presets-only'] as const)('normalizes %s through strict historical admission', async kind => {
    const legacyValues = kind === 'native' ? {} : { [LEGACY_KEYS.customPresets]: validLegacyValues()[LEGACY_KEYS.customPresets] };
    const h = await createNormalizationHarness({ legacyValues });
    try {
      // Native v2 is already verified; presets-only deliberately starts copied.
      if (kind === 'native') await h.adapter.markVerified(h.prepared.ledger);
      expect((await h.run()).status).toBe('active');
      const source = await h.repository.readNormalizationSource();
      expect(source.ledger).toMatchObject({ origin: kind === 'native' ? 'native' : 'legacy', state: 'verified' });
      expect(await h.exportActive()).toEqual(source.snapshot);
      expect(source.snapshot.customPresets).toHaveLength(kind === 'native' ? 0 : 1);
      expect((await h.inspectFresh()).source.projects).toEqual(h.source.projects);
    } finally { h.adapter.close(); }
  });

  it.each(['cleanup-started', 'cleanup-complete', 'unknown-state', 'missing-incarnation', 'empty-incarnation', 'null-incarnation'] as const)
  ('algorithm refuses %s, preserving all source envelopes', async kind => {
    const h = await createNormalizationHarness();
    try {
      const lineage = kind.endsWith('incarnation'); const store = lineage ? 'projects' : 'migrationLedger';
      const value = structuredClone(h.source[store][0]);
      if (lineage) {
        if (kind === 'missing-incarnation') Reflect.deleteProperty(value, 'incarnation');
        else Object.assign(value, { incarnation: kind === 'null-incarnation' ? null : '' });
      } else Object.assign(value, { state: kind });
      await mutateRow(h, store, objectStore => objectStore.put(value));
      const before = (await h.inspectFresh()).source;
      expect((await h.run()).status).toBe('recovery');
      expect((await h.inspectFresh()).source).toEqual(before);
      expect(await h.countActiveAuthorities()).toBe(0);
      expect((await physicalRows(h)).normalizationLedger).toEqual([]);
    } finally { h.adapter.close(); }
  });

  it.each(['blank', 'hash'] as const)('fresh absence changing during %s preparation cannot activate', async point => {
    const h = freshHarness(); let fired = false;
    try {
      const change = () => { fired = true; h.legacyStorage.seed(LEGACY_KEYS.customPresets, '[]'); };
      if (point === 'blank') {
        const blank = h.preparation.createBlankProject;
        h.preparation.createBlankProject = () => { change(); return blank(); };
      } else {
        h.environment.normalizationPause = point => { if (point.point === 'before-hash' && !fired) change(); };
      }
      expect((await h.run()).status).toBe('recovery'); expect(fired).toBe(true);
      expect((await physicalRows(h)).normalizationLedger).toEqual([]);
      expect((await physicalRows(h, historicalStores)).legacyBackup).toEqual([]);
      expect(h.legacyStorage.mutations).toEqual([]);
    } finally { h.adapter.close(); }
  });

  it.each(['reservation.after-commit', 'stage.after-commit', 'verify.after-commit', 'cutover.after-commit',
    'stage.after-record', 'verify.after-marker', 'cutover.after-marker'] as const)
  ('fresh repeated interruption at %s retains one seed and resumes', async point => {
    const h = freshHarness();
    try {
      let fired = 0;
      h.environment.normalizationFault = current => { if (current === point) { fired++; throw new DOMException('Injected', 'QuotaExceededError'); } };
      expect((await h.run()).status).toBe('unavailable'); expect(fired).toBe(1);
      const retained = await h.repository.readNormalizationSource();
      const archive = (await physicalRows(h, historicalStores)).legacyBackup;
      expect(archive).toHaveLength(1); expect(retained.retainedSeed).toBe(true);
      for (let retry = 0; retry < 2; retry++) {
        await h.run(); // Lost durable acks may already be resolved on the next call.
        expect((await physicalRows(h, historicalStores)).legacyBackup).toEqual(archive);
        expect((await h.repository.readNormalizationSource()).snapshot).toEqual(retained.snapshot);
      }
      h.environment.normalizationFault = undefined;
      const result = await h.run(); expect(result).toMatchObject({ status: 'active', snapshot: retained.snapshot });
      const rows = await physicalRows(h, historicalStores);
      expect(rows.projects).toEqual([]); expect(rows.migrationLedger).toEqual([]); expect(rows.legacyBackup).toEqual(archive);
    } finally { h.adapter.close(); }
  });

  it('fresh reservation quota retries retain no partial seed before the one durable reservation', async () => {
    const h = freshHarness();
    try {
      h.environment.normalizationFault = point => { if (point === 'reservation.after-archive') throw new DOMException('Full', 'QuotaExceededError'); };
      for (let retry = 0; retry < 3; retry++) {
        expect((await h.run()).status).toBe('unavailable');
        expect((await physicalRows(h, historicalStores)).legacyBackup).toEqual([]);
        expect((await physicalRows(h)).normalizationLedger).toEqual([]);
      }
      h.environment.normalizationFault = undefined;
      expect((await h.run()).status).toBe('active');
      expect((await physicalRows(h, historicalStores)).legacyBackup).toHaveLength(1);
    } finally { h.adapter.close(); }
  });
});

async function historicalAccess(h: Awaited<ReturnType<typeof createNormalizationHarness>>) {
  return createHistoricalBootstrap({ ...h.preparation, adapter: () => h.adapter,
    legacyStorage: memoryStorage(validLegacyValues()), generation: () => 0 });
}

describe('shared historical prerequisite admission', () => {
  it.each([1, 2] as const)('admits valid historical v%s without installing editing authority', async version => {
    const h = await createNormalizationHarness({ version });
    try {
      const access = await historicalAccess(h);
      const result = await access.bootstrap(() => {}, { allowCopiedReplacement: false });
      expect(result.status).toBe('admitted');
      if (result.status !== 'admitted') throw new Error('Expected admitted historical source');
      expect(result.records.projects.map(record => record.project)).toEqual(h.source.projects.map(record => record.project));
      expect(result.records.projects.every(record => typeof record.incarnation === 'string' && record.incarnation.length > 0)).toBe(true);
      expect(result.ledger).toMatchObject({ indexedDbVersion: 2, state: 'verified' });
      expect((await h.inspectFresh()).source.legacyBackup).toEqual(h.source.legacyBackup);
    } finally { h.adapter.close(); }
  });

  it.each(['invalid-incarnation', 'invalid-ledger', 'missing-backup'] as const)('refuses %s before normalized authority', async corruption => {
    const h = await createNormalizationHarness();
    const db = await request(h.indexedDB.open(h.databaseName));
    const tx = db.transaction(historicalStores, 'readwrite'); const completion = done(tx);
    if (corruption === 'invalid-incarnation') tx.objectStore('projects').put({ ...h.source.projects[0], incarnation: '' });
    if (corruption === 'invalid-ledger') tx.objectStore('migrationLedger').put({ ...h.source.migrationLedger[0], unexpected: true });
    if (corruption === 'missing-backup') tx.objectStore('legacyBackup').delete(h.source.legacyBackup[0].id);
    await completion; db.close();
    const before = (await h.inspectFresh()).source;
    try {
      const access = await historicalAccess(h);
      const result = await access.bootstrap(() => {}, { allowCopiedReplacement: false });
      expect(result.status).toBe('recovery');
      expect((await h.inspectFresh()).source).toEqual(before);
    } finally { h.adapter.close(); }
  });
});

describe('real normalization algorithm', () => {
  it('stages multiple bounded batches and resumes the exact durable prefix', async () => {
    const h = await createNormalizationHarness({ faultAt: 'after-stage' });
    try {
      await h.exportSource();
      const stored = (await h.inspectFresh()).source.projects[0];
      stored.project.initialState = makeIncrementalProject(80).initialState;
      // Preserve all 80 template records and the 64-record interruption;
      // repeated text artwork is unrelated to durable-prefix resumption.
      const templates = stored.project.initialState.variants.default.templates;
      for (const id of Object.keys(templates)) templates[id].elements = [];
      const db = await request(h.indexedDB.open(h.databaseName));
      const tx = db.transaction('projects', 'readwrite'); const completion = done(tx);
      tx.objectStore('projects').put(stored); await completion; db.close();
      const original = await h.exportSource(); await h.runUntilInterrupted();
      const reader = await request(h.indexedDB.open(h.databaseName));
      const read = reader.transaction([...NORMALIZED_STORE_NAMES], 'readonly'); const finished = done(read);
      const marker = await request(read.objectStore('normalizationLedger').get(NORMALIZATION_LEDGER_ID));
      const counts = await Promise.all(NORMALIZED_STORE_NAMES.filter(store => store !== 'normalizationLedger').map(store => request(read.objectStore(store).count())));
      await finished; reader.close();
      expect(marker.nextRecord).toBe(64); expect(marker.progressRevision).toBe(1);
      expect(counts.reduce((total, count) => total + count, 0)).toBe(64);
      expect(marker.recordCount).toBeGreaterThan(64);
      h.clearFault(); expect((await h.run()).status).toBe('active');
      expect(await h.exportActive()).toEqual(original); expect(await h.exportSource()).toEqual(original);
    } finally { h.adapter.close(); }
  });

  it('allows one valid oversized record as a batch, but rejects grouping it above the byte budget', async () => {
    const h = await createNormalizationHarness();
    try {
      await h.exportSource(); const stored = (await h.inspectFresh()).source.projects[0];
      stored.project.initialState.nodes.root.data.label = '☕'.repeat(100_000);
      const db = await request(h.indexedDB.open(h.databaseName));
      const tx = db.transaction('projects', 'readwrite'); const completion = done(tx);
      tx.objectStore('projects').put(stored); await completion; db.close();
      const source = await h.repository.readNormalizationSource(); const target = prepareNormalizationTarget(source);
      const attempt = await h.repository.reserveNormalization(source);
      await expect(h.repository.stageNormalization(attempt, target.slice(0, 2))).rejects.toThrow('byte budget');
      expect((await h.run()).status).toBe('active'); expect(await h.exportActive()).toEqual(source.snapshot);
    } finally { h.adapter.close(); }
  });

  it('active ancillary exports remain current while retained recovery uses frozen source envelopes', async () => {
    const h = await createNormalizationHarness();
    try {
      const original = await h.exportSource(); expect((await h.run()).status).toBe('active');
      const before = (await h.inspectFresh()).source;
      const db = await request(h.indexedDB.open(h.databaseName));
      const tx = db.transaction('presets', 'readwrite'); const completion = done(tx);
      tx.objectStore('presets').put({ ...before.presets[0], preset: { ...before.presets[0].preset, title: 'Current preset' } });
      await completion; db.close();
      await refreshAncillaryManifestFixture(h);
      expect((await h.exportActive()).customPresets[0].title).toBe('Current preset');
      expect(await h.exportSource()).toEqual(original);
      const source = (await recoveryExports.normalizationRecoverySources(h.repository))[0];
      expect(await recoveryExports.exportNormalizationRecovery(h.repository, source, h.preparation.now())).toMatchObject({ workspace: original, rollbackReady: false });
    } finally { h.adapter.close(); }
  });

  it('maps a real blocked upgrade to unavailable without touching source', async () => {
    const h = await createNormalizationHarness();
    const blocker = await request(h.indexedDB.open(h.databaseName, 2));
    try {
      const before = await h.inspectFresh();
      expect((await h.run()).status).toBe('unavailable');
      const tx = blocker.transaction(historicalStores, 'readonly'); const completion = done(tx);
      const values = await Promise.all(historicalStores.map(store => request(tx.objectStore(store).getAll()))); await completion;
      expect(Object.fromEntries(historicalStores.map((store, index) => [store, values[index]]))).toEqual(before.source);
    } finally { blocker.close(); h.adapter.close(); }
  });

  it('does not advertise an unreserved speculative fresh seed as durable recovery', async () => {
    const h = createIncrementalRepositoryHarness(WORKSPACE_DB_NAME);
    const preparation = deterministicEnvironment({ crypto: webcrypto as unknown as Crypto });
    h.environment.normalization = preparation;
    const adapter = createIndexedDbAdapter({ indexedDB: h.indexedDB, now: preparation.now }, 3);
    try {
      await adapter.open();
      expect(await recoveryExports.normalizationRecoverySources(h.repository)).toEqual([]);
      const candidate = await h.repository.readNormalizationSource();
      await expect(recoveryExports.exportNormalizationRecovery(h.repository, { kind: 'fresh-seed', sourceDigest: candidate.sourceDigest,
        authority: 'historical', rollbackReady: false }, preparation.now())).rejects.toThrow();
    } finally { adapter.close(); }
  });

  it.each([1, 2] as const)('runs historical v%s admission/repair through the real algorithm without prior helper setup', async version => {
    const h = await createNormalizationHarness({ version });
    try {
      const original = h.source.projects.map(record => record.project);
      const result = await h.run(); expect(result.status).toBe('active');
      expect((await h.exportActive()).projects).toEqual(original);
      expect((await h.inspectFresh()).source.projects.map(record => record.project)).toEqual(original);
    } finally { h.adapter.close(); }
  });

  it.each(['after-stage', 'after-verify', 'after-cutover'] as const)('owner disposal at %s returns nonready without guessing rollback', async point => {
    const h = await createNormalizationHarness(); const owner = createWorkspaceWorkerHandler(h.environment);
    try {
      await h.exportSource();
      const result = await owner.normalize({ historical: h.historical, ensurePhysicalLayout: () => h.adapter.open(),
        checkpoint: current => { if (current === point) owner.dispose(); } });
      expect(result.status).toBe('unavailable');
      expect(await h.countActiveAuthorities()).toBe(point === 'after-cutover' ? 1 : 0);
      expect((await h.run()).status).toBe('active');
    } finally { owner.dispose(); h.adapter.close(); }
  });

  it('stable recapture fences legacy changes after reservation instead of activating a stale source', async () => {
    const h = await createNormalizationHarness();
    try {
      const original = await h.exportSource();
      const result = await normalizeWorkspace({ repository: h.repository, historical: h.historical, ensurePhysicalLayout: () => h.adapter.open(),
        checkpoint: point => { if (point === 'after-stage') h.legacyStorage.seed(LEGACY_KEYS.activeProject, 'new-legacy-project'); } });
      expect(result.status).toBe('recovery'); expect(await h.countActiveAuthorities()).toBe(0);
      expect(await h.exportSource()).toEqual(original);
      expect((await h.run()).status).toBe('recovery');
    } finally { h.adapter.close(); }
  });

  it('recaptures legacy after the final progress observer before publishing active', async () => {
    const h = await createNormalizationHarness();
    try {
      await h.exportSource();
      const result = await normalizeWorkspace({ repository: h.repository, historical: h.historical, ensurePhysicalLayout: () => h.adapter.open(),
        onProgress: ({ phase }) => { if (phase === 'active') h.legacyStorage.seed(LEGACY_KEYS.activeProject, 'changed-by-observer'); } });
      expect(result.status).toBe('recovery'); expect(await h.countActiveAuthorities()).toBe(1);
    } finally { h.adapter.close(); }
  });

  it('cancelled normalization does not create an attempt', async () => {
    const h = await createNormalizationHarness(); const controller = new AbortController();
    try {
      await h.exportSource(); controller.abort();
      const before = await h.inspectFresh();
      const result = await normalizeWorkspace({ repository: h.repository, historical: h.historical,
        ensurePhysicalLayout: () => h.adapter.open(), signal: controller.signal });
      expect(result.status).toBe('unavailable'); expect(await h.inspectFresh()).toEqual(before);
      expect(await h.countActiveAuthorities()).toBe(0);
    } finally { h.adapter.close(); }
  });

  it('exports validated retained source distinctly during interruption, never staged current or rollback-ready', async () => {
    const h = await createNormalizationHarness({ faultAt: 'after-stage' });
    try {
      const original = await h.exportSource(); const result = await h.run();
      expect(recoveryExports.normalizationRecoverySources).toBeTypeOf('function');
      const sources = await recoveryExports.normalizationRecoverySources(h.repository);
      expect(sources).toHaveLength(1); expect(sources[0]).toMatchObject({ kind: 'historical-indexeddb', rollbackReady: false });
      expect(result).toMatchObject({ normalizationExports: sources });
      const bundle = await recoveryExports.exportNormalizationRecovery(h.repository, sources[0], h.preparation.now());
      expect(bundle).toMatchObject({ format: 'doctect.normalization-source-recovery', workspace: original, rollbackReady: false });
      h.clearFault(); expect((await h.run()).status).toBe('active');
      const activeSources = await recoveryExports.normalizationRecoverySources(h.repository);
      expect(activeSources.map(source => source.kind)).toEqual(['historical-indexeddb', 'normalized-active']);
      const active = await recoveryExports.exportNormalizationRecovery(h.repository, activeSources[1], h.preparation.now());
      expect(active).toMatchObject({ format: 'doctect.normalized-workspace-recovery', workspace: original });
    } finally { h.adapter.close(); }
  });

  it('serializes private normalization on the existing owner and never publishes active after disposal', async () => {
    const h = await createNormalizationHarness();
    const owner = createWorkspaceWorkerHandler(h.environment);
    try {
      await h.exportSource();
      expect(owner.normalize).toBeTypeOf('function');
      const events: string[] = [];
      const first = owner.normalize({ historical: h.historical, ensurePhysicalLayout: () => h.adapter.open(),
        onProgress: progress => { events.push(`first:${progress.phase}`); throw new Error('passive observer'); } });
      const second = owner.normalize({ historical: h.historical, ensurePhysicalLayout: () => { events.push('second:start'); return h.adapter.open(); } });
      expect((await first).status).toBe('active'); expect((await second).status).toBe('active');
      expect(events.indexOf('second:start')).toBeGreaterThan(events.indexOf('first:active'));
      const disposed = owner.normalize({ historical: h.historical, ensurePhysicalLayout: () => h.adapter.open() });
      owner.dispose(); expect((await disposed).status).not.toBe('active');
    } finally { owner.dispose(); h.adapter.close(); }
  });

  it.each(['stage.before-record', 'stage.after-record', 'stage.before-marker', 'stage.after-marker', 'stage.before-complete',
    'verify.before-marker', 'verify.after-marker', 'verify.before-complete', 'cutover.before-marker', 'cutover.after-marker', 'cutover.before-complete'])
  ('quota at %s aborts its whole transaction and resumes without more retained copies', async point => {
    const h = await createNormalizationHarness();
    try {
      const original = await h.exportSource(); let fired = false;
      h.environment.normalizationFault = current => { if (current === point) { fired = true; throw new DOMException('Full', 'QuotaExceededError'); } };
      expect((await h.run()).status).toBe('unavailable'); expect(fired).toBe(true);
      expect(await h.exportSource()).toEqual(original); expect(await h.countActiveAuthorities()).toBe(0);
      const archives = (await h.inspectFresh()).source.legacyBackup;
      expect(archives.filter(value => value.kind === 'normalization-source')).toHaveLength(1);
      h.environment.normalizationFault = undefined;
      expect((await h.run()).status).toBe('active');
      expect((await h.inspectFresh()).source.legacyBackup).toEqual(archives);
      expect(await h.exportActive()).toEqual(original);
    } finally { h.adapter.close(); }
  });

  it.each(['stage.after-commit', 'verify.after-commit', 'cutover.after-commit'])('resolves lost %s acknowledgement from durable facts', async point => {
    const h = await createNormalizationHarness();
    try {
      const original = await h.exportSource(); let fired = false;
      h.environment.normalizationFault = current => { if (current === point) { fired = true; throw new Error('Lost acknowledgement'); } };
      expect((await h.run()).status).toBe('recovery'); expect(fired).toBe(true);
      if (point === 'cutover.after-commit') expect(await h.countActiveAuthorities()).toBe(1);
      h.environment.normalizationFault = undefined;
      expect((await h.run()).status).toBe('active'); expect(await h.exportActive()).toEqual(original);
    } finally { h.adapter.close(); }
  });

  it('reserves a genuinely fresh seed once, resumes it, and never fabricates a historical ledger or project copy', async () => {
    const h = createIncrementalRepositoryHarness(WORKSPACE_DB_NAME);
    const preparation = deterministicEnvironment({ crypto: webcrypto as unknown as Crypto });
    h.environment.normalization = preparation;
    const adapter = createIndexedDbAdapter({ indexedDB: h.indexedDB, now: preparation.now }, 3);
    const historical = createHistoricalBootstrap({ ...preparation, adapter: () => adapter, legacyStorage: memoryStorage({}), generation: () => 0 });
    let interrupt = true;
    const run = () => normalizeWorkspace({ repository: createNormalizedRepository(h.environment), historical,
      ensurePhysicalLayout: () => adapter.open(), checkpoint: point => { if (interrupt && point === 'after-stage') throw new Error('fresh interruption'); } });
    try {
      expect((await run()).status).toBe('recovery');
      const captured = await h.repository.readNormalizationSource();
      expect(captured.kind).toBe('fresh'); expect(captured.ledger).toBeNull(); expect(captured.backups).toEqual([]);
      const exports = await recoveryExports.normalizationRecoverySources(h.repository);
      expect(exports).toHaveLength(1); expect(exports[0]).toMatchObject({ kind: 'fresh-seed', rollbackReady: false });
      expect(await recoveryExports.exportNormalizationRecovery(h.repository, exports[0], preparation.now())).toMatchObject({ workspace: captured.snapshot });
      interrupt = false; const resumed = await run();
      expect(resumed.status).toBe('active');
      if (resumed.status !== 'active') throw new Error('Expected active seed');
      expect(resumed.snapshot).toEqual(captured.snapshot);
      const db = await request(h.indexedDB.open(h.databaseName));
      const tx = db.transaction(historicalStores, 'readonly'); const completion = done(tx);
      const projects = await request(tx.objectStore('projects').getAll());
      const ledgers = await request(tx.objectStore('migrationLedger').getAll());
      const archives = await request(tx.objectStore('legacyBackup').getAll()); await completion; db.close();
      expect(projects).toEqual([]); expect(ledgers).toEqual([]);
      expect(archives).toHaveLength(1); expect(archives[0]).toMatchObject({ kind: 'normalization-source', sourceKind: 'fresh' });
    } finally { adapter.close(); }
  });

  it('concurrent fresh UUIDs follow the once-reserved seed', async () => {
    const h = createIncrementalRepositoryHarness(WORKSPACE_DB_NAME);
    let uuid = 0;
    const preparation = deterministicEnvironment({ crypto: webcrypto as unknown as Crypto, randomUUID: () => `fresh-${++uuid}` });
    h.environment.normalization = preparation;
    const adapter = createIndexedDbAdapter({ indexedDB: h.indexedDB, now: preparation.now }, 3);
    const historical = createHistoricalBootstrap({ ...preparation, adapter: () => adapter, legacyStorage: memoryStorage({}), generation: () => 0 });
    const run = () => normalizeWorkspace({ repository: createNormalizedRepository(h.environment), historical, ensurePhysicalLayout: () => adapter.open() });
    try {
      const results = await Promise.all([run(), run()]);
      expect(results.map(result => result.status), JSON.stringify(results.filter(result => result.status !== 'active'))).toEqual(['active', 'active']);
      expect(results[0]).toEqual(results[1]);
      expect((await h.repository.readNormalizationSource()).kind).toBe('fresh');
    } finally { adapter.close(); }
  });

  it.each(['baseline', 'source', 'target', 'proof', 'extra', 'marker'] as const)('rejects forged active %s without historical editing fallback', async kind => {
    const h = await createNormalizationHarness();
    try {
      await h.exportSource(); expect((await h.run()).status).toBe('active');
      const active = await h.repository.readActiveAuthority();
      const source = await h.repository.readNormalizationSource();
      const target = prepareNormalizationTarget(source);
      const header = target.find(item => item.store === 'projectHeaders')!;
      const node = target.find(item => item.store === 'projectNodes')!;
      const store = kind === 'source' ? 'projects' : kind === 'marker' ? 'normalizationLedger'
        : kind === 'target' || kind === 'extra' ? 'projectNodes' : 'projectHeaders';
      const db = await request(h.indexedDB.open(h.databaseName));
      const tx = db.transaction(store, 'readwrite'); const completion = done(tx);
      if (kind === 'baseline') tx.objectStore(store).put({ ...header.record, migrationBaseline: { ...Reflect.get(header.record, 'migrationBaseline'), sourceDigest: 'b'.repeat(64) } });
      if (kind === 'source') tx.objectStore(store).put({ ...source.records.projects[0], storageRevision: 41 });
      if (kind === 'target') tx.objectStore(store).delete(node.record.key);
      if (kind === 'proof') tx.objectStore(store).put({ ...header.record, storageRevision: 1, commitProof: null });
      if (kind === 'extra') tx.objectStore(store).put({ ...node.record, key: [...node.record.key.slice(0, -1), 'foreign'] });
      if (kind === 'marker') tx.objectStore(store).put({ ...active, verificationDigest: 'c'.repeat(64) });
      await completion; db.close();
      expect((await h.run()).status).toBe('recovery');
      await expect(h.repository.exportGeneration(active!.storageGeneration)).rejects.toThrow();
      expect(await h.countActiveAuthorities()).toBe(1); // Corruption is not rollback.
    } finally { h.adapter.close(); }
  });

  it.each(['workspace', 'presets', 'pendingImports', 'projects', 'migrationLedger', 'legacyBackup'] as const)
  ('checks actual %s source envelopes at cutover, not only frozen recovery data', async store => {
    const h = await createNormalizationHarness({ faultAt: 'after-verify' });
    try {
      const original = await h.exportSource(); await h.runUntilInterrupted();
      const before = (await h.inspectFresh()).source;
      const value = structuredClone(before[store][0]);
      Object.assign(value, { changedWithoutRevision: true });
      const db = await request(h.indexedDB.open(h.databaseName));
      const tx = db.transaction(store, 'readwrite'); const completion = done(tx);
      tx.objectStore(store).put(value); await completion; db.close();
      h.clearFault(); expect((await h.run()).status).toBe('recovery');
      expect(await h.countActiveAuthorities()).toBe(0);
      if (['workspace', 'presets', 'pendingImports'].includes(store)) expect(await h.exportSource()).toEqual(original);
      expect((await h.inspectFresh()).source).toEqual({ ...before, [store]: before[store].map((entry, index) => index === 0 ? value : entry) });
    } finally { h.adapter.close(); }
  });

  it('rejects stale stage and verification revisions and never exports staged bytes as current', async () => {
    const h = await createNormalizationHarness();
    try {
      await h.exportSource(); const source = await h.repository.readNormalizationSource();
      const attempt = await h.repository.reserveNormalization(source); const target = prepareNormalizationTarget(source);
      const staged = await h.repository.stageNormalization(attempt, target.slice(0, 1));
      await expect(h.repository.stageNormalization(attempt, target.slice(0, 1))).rejects.toThrow('normalization-contention');
      await expect(h.repository.markNormalizationVerified(attempt, source.contentDigest)).rejects.toThrow();
      await expect(h.repository.exportGeneration(attempt.storageGeneration)).rejects.toThrow('ingress-required');
      await expect(h.repository.stageNormalization(staged, [{ store: 'normalizationLedger', record: attempt }])).rejects.toThrow('Ledger cannot be staged');
      await expect(h.repository.stageNormalization(staged, [target[0]])).rejects.toThrow('Unexpected normalization batch');
      expect((await h.run()).status).toBe('active');
    } finally { h.adapter.close(); }
  });

  async function migratedEditFixture() {
    const h = await createNormalizationHarness();
    try {
      const original = await h.exportSource();
      // Preserve a real nonzero private baseline, not a fabricated ordinary commit.
      const before = (await h.inspectFresh()).source.projects[0];
      const db = await request(h.indexedDB.open(h.databaseName));
      const tx = db.transaction('projects', 'readwrite'); const completion = done(tx);
      tx.objectStore('projects').put({ ...before, storageRevision: 19 }); await completion; db.close();
      expect((await h.run()).status).toBe('active');
      const source = await h.repository.readNormalizationSource();
      const target = prepareNormalizationTarget(source); const stored = source.records.projects[0];
      const scope = { storageGeneration: `normalized:${source.sourceDigest}`, projectId: stored.id, incarnation: stored.incarnation };
      const image = decomposeProject(stored.project, scope);
      for (const item of target) if (item.record.key[1] === stored.id) (image[item.store] as Map<string, unknown>).set(JSON.stringify(item.record.key), item.record);
      await expect(h.repository.bindAdmittedProject(image)).resolves.toMatchObject({ documentRevision: 19 });
      h.operations.length = 0;
      const node = { ...stored.project.initialState.nodes[stored.project.initialState.rootId], name: 'Migrated edit' };
      await h.repository.commitDocument({ scope, clientId: 'migration-editor', commitId: 'edit-1', commitGeneration: 1,
        editorGeneration: 1, expectedRevision: 19, changes: [{ type: 'put-node', node }] });
      await h.repository.commitPreferences({ scope, clientId: 'migration-editor', commitId: 'prefs-2', commitGeneration: 2,
        editorGeneration: 1, observedPreferenceRevision: 0, patch: { scale: 1.75 } });
      expect(h.operations.every(operation => operation.method !== 'getAll')).toBe(true);
      return { h, original, scope, node };
    } catch (error) { h.adapter.close(); throw error; }
  }

  it('admits migrated edits and preferences, then reopens current proofs rather than obsolete migration content', async () => {
    const { h, original, node } = await migratedEditFixture();
    try {
      const reopened = await h.run(); expect(reopened.status).toBe('active');
      const active = await h.exportActive();
      expect(active.projects[0].initialState.nodes[node.id]).toEqual(node);
      expect(active.projects[0].initialState.scale).toBe(1.75);
      expect(await h.exportSource()).toEqual(original);
    } finally { h.adapter.close(); }
  });

  it('rejects a remote preference commit during active hashing, then independently reopens its proof', async () => {
    const { h, scope } = await migratedEditFixture();
    try {
      // A remote preference commit during bulk hashing must invalidate the captured
      // read, then a new algorithm invocation follows independently validated facts.
      const originalPause = h.environment.normalizationPause; let changed = false;
      h.environment.normalizationPause = async point => {
        await originalPause?.(point);
        if (point.phase === 'reopen' && point.point === 'before-hash' && !changed) {
          changed = true;
          await h.repository.commitPreferences({ scope, clientId: 'migration-editor', commitId: 'prefs-3', commitGeneration: 3,
            editorGeneration: 1, observedPreferenceRevision: 1, patch: { scale: 2 } });
        }
      };
      await expect(createNormalizedRepository(h.environment).readActiveAuthority()).rejects.toThrow('normalization-contention');
      expect(changed).toBe(true); h.environment.normalizationPause = originalPause;
      expect((await h.run()).status).toBe('active'); expect((await h.exportActive()).projects[0].initialState.scale).toBe(2);
    } finally { h.adapter.close(); }
  });

  it.each(['normalizer', 'enumeration'] as const)('rejects a corrupt current preference proof and offers only retained historical recovery (%s)', async consumer => {
    const { h, scope } = await migratedEditFixture();
    try {
      await h.repository.commitPreferences({ scope, clientId: 'migration-editor', commitId: 'prefs-3', commitGeneration: 3,
        editorGeneration: 1, observedPreferenceRevision: 1, patch: { scale: 2 } });
      const corruptDb = await request(h.indexedDB.open(h.databaseName));
      const corruptTx = corruptDb.transaction('projectPreferences', 'readwrite'); const corruptDone = done(corruptTx);
      const preferences = await request(corruptTx.objectStore('projectPreferences').get([scope.storageGeneration, scope.projectId, scope.incarnation]));
      preferences.commitProof.manifestDigest = 'd'.repeat(64);
      corruptTx.objectStore('projectPreferences').put(preferences); await corruptDone; corruptDb.close();
      if (consumer === 'normalizer') expect((await h.run()).status).toBe('recovery');
      else expect((await recoveryExports.normalizationRecoverySources(h.repository)).map(source => source.kind)).toEqual(['historical-indexeddb']);
    } finally { h.adapter.close(); }
  });

  it('follows a competing valid bootstrap only after independent active validation', async () => {
    const h = await createNormalizationHarness();
    try {
      await h.exportSource();
      const results = await Promise.all([h.run(), h.run()]);
      expect(results.map(result => result.status), JSON.stringify(results)).toEqual(['active', 'active']);
      expect(await h.countActiveAuthorities()).toBe(1);
    } finally { h.adapter.close(); }
  });

  it.each(['after-stage', 'after-verify', 'after-cutover'] as const)('resumes safely: %s', async faultAt => {
    const h = await createNormalizationHarness({ faultAt });
    try {
      const original = await h.exportSource();
      await h.runUntilInterrupted();
      h.clearFault();
      const result = await h.bootstrapFresh();
      expect(result.status).toBe('ready');
      expect(await h.exportActive()).toEqual(original);
      expect(await h.exportSource()).toEqual(original);
      expect(await h.countActiveAuthorities()).toBe(1);
    } finally { h.adapter.close(); }
  });
});

describe('normalization source reservation', () => {
  const admittedSource = async () => {
    const h = await createNormalizationHarness();
    const access = await historicalAccess(h);
    expect((await access.bootstrap(() => {}, { allowCopiedReplacement: false })).status).toBe('admitted');
    return { h, source: await h.repository.readNormalizationSource() };
  };
  const durableMarkers = async (h: Awaited<ReturnType<typeof createNormalizationHarness>>) => {
    const db = await request(h.indexedDB.open(h.databaseName));
    try {
      const tx = db.transaction('normalizationLedger', 'readonly'); const completion = done(tx);
      const markers = await request(tx.objectStore('normalizationLedger').getAll()); await completion;
      return markers;
    } finally { db.close(); }
  };

  it.each(['project', 'workspace', 'ledger'] as const)('rejects exhausted %s source counters instead of resetting revision', async kind => {
    const { h } = await admittedSource();
    try {
      const before = (await h.inspectFresh()).source;
      const store = kind === 'project' ? 'projects' : kind === 'workspace' ? 'workspace' : 'migrationLedger';
      const record = { ...before[store][0], [kind === 'project' ? 'storageRevision' : kind === 'workspace' ? 'revision' : 'ledgerRevision']: Number.MAX_SAFE_INTEGER + 1 };
      const db = await request(h.indexedDB.open(h.databaseName));
      const tx = db.transaction(store, 'readwrite'); const completion = done(tx);
      tx.objectStore(store).put(record); await completion; db.close();
      await expect(h.repository.readNormalizationSource()).rejects.toThrow();
      expect(await durableMarkers(h)).toEqual([]);
    } finally { h.adapter.close(); }
  });

  it.each([
    { formatVersion: 4 }, { state: 'copied' }, { state: 'guessed' }, { unexpected: true },
    { nextRecord: -1 }, { nextRecord: Number.MAX_SAFE_INTEGER + 1 }, { progressRevision: 1 },
    { verificationDigest: 'a'.repeat(64) }, { verifiedProgressRevision: 0 }, { cutoverRevision: 1 },
    { sourceKind: 'unknown' }, { sourceProjects: [] }, { sourceDigest: 'guessed' },
    { state: 'verified' }, { state: 'active' }, { storageGeneration: 'other' },
  ])('fails closed without rewriting an unrecognized reserved marker: %j', async corruption => {
    const { h, source } = await admittedSource();
    try {
      const attempt = await h.repository.reserveNormalization(source);
      const db = await request(h.indexedDB.open(h.databaseName));
      const tx = db.transaction('normalizationLedger', 'readwrite'); const completion = done(tx);
      const marker = { ...attempt, ...corruption };
      tx.objectStore('normalizationLedger').put(marker); await completion; db.close();
      const before = await h.inspectFresh();
      await expect(h.repository.readNormalizationSource()).rejects.toThrow();
      await expect(h.repository.reserveNormalization(source)).rejects.toThrow();
      expect(await h.inspectFresh()).toEqual(before);
      expect(await durableMarkers(h)).toEqual([marker]);
    } finally { h.adapter.close(); }
  });

  it.each(['archive', 'retained-project', 'retained-backup'] as const)('rejects corrupted %s during independent source recovery', async kind => {
    const { h, source } = await admittedSource();
    try {
      const attempt = await h.repository.reserveNormalization(source);
      const captured = (await h.inspectFresh()).source;
      const store = kind === 'retained-project' ? 'projects' : 'legacyBackup';
      const record = kind === 'archive' ? captured.legacyBackup.find(value => value.id === attempt.sourceArchiveId)
        : kind === 'retained-project' ? captured.projects[0] : captured.legacyBackup.find(value => value.kind === 'original');
      const db = await request(h.indexedDB.open(h.databaseName));
      const tx = db.transaction(store, 'readwrite'); const completion = done(tx);
      tx.objectStore(store).put({ ...record, unexpected: true }); await completion; db.close();
      const before = await h.inspectFresh();
      await expect(h.repository.readNormalizationSource()).rejects.toThrow();
      expect(await h.inspectFresh()).toEqual(before);
      expect(await durableMarkers(h)).toEqual([attempt]);
    } finally { h.adapter.close(); }
  });

  it.each([
    'reservation.before-archive', 'reservation.after-archive', 'reservation.before-marker',
    'reservation.after-marker', 'reservation.before-complete',
  ] satisfies NormalizationReservationFault[])('aborts both archive and marker on quota at %s without copy proliferation', async point => {
    const { h, source } = await admittedSource();
    try {
      const before = (await h.inspectFresh()).source;
      h.environment.normalizationFault = current => { if (current === point) throw new DOMException('Full', 'QuotaExceededError'); };
      for (let retry = 0; retry < 2; retry++) {
        await expect(h.repository.reserveNormalization(source)).rejects.toMatchObject({ name: 'QuotaExceededError' });
        expect((await h.inspectFresh()).source).toEqual(before);
        expect(await durableMarkers(h)).toEqual([]);
      }
      h.environment.normalizationFault = undefined;
      await h.repository.reserveNormalization(source);
      expect((await h.inspectFresh()).source.legacyBackup).toHaveLength(before.legacyBackup.length + 1);
      expect(await durableMarkers(h)).toHaveLength(1);
    } finally { h.adapter.close(); }
  });

  it('resolves lost reservation acknowledgement from a fresh reader without generating another archive', async () => {
    const { h, source } = await admittedSource();
    try {
      h.environment.normalizationFault = point => { if (point === 'reservation.after-commit') throw new Error('Owner interrupted'); };
      await expect(h.repository.reserveNormalization(source)).rejects.toThrow('Owner interrupted');
      const before = await h.inspectFresh(); const markers = await durableMarkers(h);
      expect(markers).toHaveLength(1);
      h.environment.normalizationFault = undefined;
      const restarted = createNormalizedRepository(h.environment);
      const reread = await restarted.readNormalizationSource();
      expect(reread).toEqual(source);
      expect(await restarted.reserveNormalization(reread)).toEqual(markers[0]);
      expect(await h.inspectFresh()).toEqual(before);
    } finally { h.adapter.close(); }
  });

  it('serializes independent repository reservations to one durable attempt and archive', async () => {
    const { h, source } = await admittedSource();
    try {
      const other = createNormalizedRepository(h.environment);
      const results = await Promise.all([h.repository.reserveNormalization(source), other.reserveNormalization(await other.readNormalizationSource())]);
      expect(results[0]).toEqual(results[1]);
      expect(await durableMarkers(h)).toEqual([results[0]]);
      expect((await h.inspectFresh()).source.legacyBackup.filter(record => record.kind === 'normalization-source')).toHaveLength(1);
    } finally { h.adapter.close(); }
  });

  it.each(['projects', 'workspace', 'presets', 'pendingImports', 'migrationLedger', 'legacyBackup'] as const)
  ('reservation rejects malformed same-revision source mutation in %s', async store => {
    const { h, source } = await admittedSource();
    try {
      const before = (await h.inspectFresh()).source;
      const record = structuredClone(before[store][0]);
      // Invalid envelopes are rejected during independent preparation, before CAS.
      Object.assign(record, { unexpectedMutation: true });
      const db = await request(h.indexedDB.open(h.databaseName));
      const tx = db.transaction(store, 'readwrite'); const completion = done(tx);
      tx.objectStore(store).put(record); await completion; db.close();
      const mutated = (await h.inspectFresh()).source;
      const reason = { projects: /Project record 0 contains unknown field unexpectedMutation/,
        workspace: /Workspace record contains unknown field unexpectedMutation/,
        presets: /Preset record 0 contains unknown field unexpectedMutation/,
        pendingImports: /Pending import record 0 contains unknown field unexpectedMutation/,
        migrationLedger: /historical-admission-required/, legacyBackup: /Invalid private fields/ }[store];
      await expect(h.repository.reserveNormalization(source)).rejects.toThrow(reason);
      expect((await h.inspectFresh()).source).toEqual(mutated);
      expect(await durableMarkers(h)).toEqual([]);
    } finally { h.adapter.close(); }
  });

  it.each(['projects', 'workspace', 'presets', 'pendingImports', 'migrationLedger', 'legacyBackup'] as const)
  ('reservation detects valid same-revision source changes in %s', async store => {
    const first = makeIncrementalProject(2); const second = { ...makeIncrementalProject(2), id: 'second-source' };
    const h = await createNormalizationHarness({ legacyValues: { ...validLegacyValues(),
      [LEGACY_KEYS.projects]: JSON.stringify([first, second]), [LEGACY_KEYS.activeProject]: first.id } });
    try {
      const access = h.historical;
      expect((await access.bootstrap(() => {}, { allowCopiedReplacement: false })).status).toBe('admitted');
      await mutateRow(h, 'legacyBackup', target => target.put({ ...h.prepared.backup, id: 'unreferenced-conflict', kind: 'conflict' }));
      const source = await h.repository.readNormalizationSource(); const before = (await h.inspectFresh()).source;
      const record = structuredClone(store === 'legacyBackup'
        ? before.legacyBackup.find(row => row.id === 'unreferenced-conflict') : before[store][0]);
      if (store === 'projects') record.project.name += ' changed';
      if (store === 'workspace') record.activeProjectId = second.id;
      if (store === 'presets') record.preset.title += ' changed';
      if (store === 'pendingImports') record.pendingImport.name += ' changed';
      if (store === 'migrationLedger') record.verifiedAt = '2026-09-26T00:00:00.000Z';
      if (store === 'legacyBackup') record.capturedAt = '2026-09-26T00:00:00.000Z';
      await mutateRow(h, store, target => target.put(record));
      const mutated = (await h.inspectFresh()).source;
      expect(mutated.workspace[0].revision).toBe(before.workspace[0].revision);
      expect(mutated.migrationLedger[0].ledgerRevision).toBe(before.migrationLedger[0].ledgerRevision);
      expect(mutated.projects.map(row => row.storageRevision)).toEqual(before.projects.map(row => row.storageRevision));
      // Prove the new source remains valid; refusing it must compare the captured identity.
      const current = await h.repository.readNormalizationSource();
      expect(current.sourceDigest).not.toBe(source.sourceDigest);
      await expect(h.repository.reserveNormalization(source)).rejects.toThrow('Source changed');
      expect((await h.inspectFresh()).source).toEqual(mutated);
      expect(await durableMarkers(h)).toEqual([]);
    } finally { h.adapter.close(); }
  });

  it('rejects unaccounted target records when reusing a pristine reservation', async () => {
    const { h, source } = await admittedSource();
    try {
      const attempt = await h.repository.reserveNormalization(source);
      const db = await request(h.indexedDB.open(h.databaseName));
      const tx = db.transaction('projectNodes', 'readwrite'); const completion = done(tx);
      tx.objectStore('projectNodes').put({ key: [attempt.storageGeneration, 'foreign', 'incarnation', 'root'], value: {} });
      await completion; db.close();
      await expect(h.repository.reserveNormalization(source)).rejects.toThrow('Orphaned normalization target');
      expect(await durableMarkers(h)).toEqual([attempt]);
    } finally { h.adapter.close(); }
  });

  it.each(['physical-layout-only', 'reserved'] as const)('does not admit durable zero-revision bytes from %s as editing authority', async state => {
    const h = await createNormalizationHarness();
    try {
      const access = await historicalAccess(h);
      expect((await access.bootstrap(() => {}, { allowCopiedReplacement: false })).status).toBe('admitted');
      const source = await h.repository.readNormalizationSource();
      const attempt = state === 'reserved' ? await h.repository.reserveNormalization(source) : undefined;
      const stored = source.records.projects[0];
      const scope = { storageGeneration: attempt?.storageGeneration ?? 'orphaned-generation', projectId: stored.id, incarnation: stored.incarnation };
      const image = decomposeProject(stored.project, scope);
      const db = await request(h.indexedDB.open(h.databaseName));
      const tx = db.transaction([...NORMALIZED_STORE_NAMES], 'readwrite'); const completion = done(tx);
      for (const store of NORMALIZED_STORE_NAMES) for (const record of image[store].values()) tx.objectStore(store).put(record);
      await completion; db.close();
      await expect(h.repository.bindAdmittedProject(image)).rejects.toThrow('ingress-required');
      await expect(h.repository.exportProjectForRecovery(scope)).rejects.toThrow('ingress-required');
    } finally { h.adapter.close(); }
  });

  it('reconstructs the immutable captured source after ancillary mutation, retaining private provenance and nonzero revisions', async () => {
    const h = await createNormalizationHarness();
    try {
      const access = await historicalAccess(h);
      expect((await access.bootstrap(() => {}, { allowCopiedReplacement: false })).status).toBe('admitted');
      const stored = { ...h.source.projects[0], project: { ...h.source.projects[0].project,
        updatedAt: { publicExtension: true }, initialState: { ...h.source.projects[0].project.initialState,
          selectedElementIds: ['retained-raw-selection'] } }, storageRevision: 19, updatedAt: '2026-09-16T10:00:00.000Z',
        consumedImportId: 'consumed', consumedImportCreatedAt: '2026-09-16T09:00:00.000Z', consumedImportDigest: 'a'.repeat(64),
        consumedImportAttempt: { sourceKeyDigest: 'c'.repeat(64), payloadDigest: 'd'.repeat(64), pendingImportDigest: 'a'.repeat(64) } };
      const db = await request(h.indexedDB.open(h.databaseName));
      const tx = db.transaction(['projects', 'pendingImports'], 'readwrite'); const completion = done(tx);
      tx.objectStore('projects').put(stored);
      const pending = { ...h.source.pendingImports[0], attemptProvenance: {
        sourceKeyDigest: 'e'.repeat(64), payloadDigest: 'f'.repeat(64), pendingImportDigest: 'b'.repeat(64) } };
      tx.objectStore('pendingImports').put(pending);
      await completion; db.close();
      const source = await h.repository.readNormalizationSource();
      expect(source.records.projects).toEqual([stored]);
      expect(source.snapshot.projects).toEqual([stored.project]);
      expect(source.records.pendingImports).toEqual([pending]);
      const attempt = await h.repository.reserveNormalization(source);
      expect(attempt.sourceProjects[0]).toMatchObject({ revision: 19, incarnation: stored.incarnation });
      const changed = await request(h.indexedDB.open(h.databaseName));
      const mutation = changed.transaction('presets', 'readwrite'); const mutated = done(mutation);
      mutation.objectStore('presets').put({ ...h.source.presets[0], preset: { ...h.source.presets[0].preset, title: 'Later title' } });
      await mutated; changed.close();
      expect(await h.repository.readNormalizationSource()).toEqual(source);
      const beforeRefusal = await h.inspectFresh(); const markersBefore = await durableMarkers(h);
      await expect(h.repository.reserveNormalization(source)).rejects.toThrow('Normalization live source mismatch');
      expect(await h.inspectFresh()).toEqual(beforeRefusal);
      expect(await durableMarkers(h)).toEqual(markersBefore);
    } finally { h.adapter.close(); }
  });

  it('recognizes explicit nonzero migration lineage structurally without treating it as admitted authority', async () => {
    const h = await createNormalizationHarness();
    const project = h.source.projects[0];
    const scope = { storageGeneration: 'reserved-generation', projectId: project.id, incarnation: project.incarnation };
    const image = decomposeProject(project.project, scope);
    const header = image.projectHeaders.values().next().value!;
    Object.assign(header, { storageRevision: 7, updatedAt: project.updatedAt,
      commitWindow: { floorRevision: 7, entries: [] }, migrationBaseline: {
        migrationId: NORMALIZATION_LEDGER_ID, attemptId: 'reserved-attempt', storageGeneration: scope.storageGeneration,
        sourceDigest: 'a'.repeat(64), projectDigest: 'b'.repeat(64), projectId: project.id,
        incarnation: project.incarnation, sourceRevision: 7, sourceUpdatedAt: project.updatedAt,
      } });
    expect(reconstructProject(image)).toEqual(project.project);
    try {
      await h.adapter.open();
      const db = await request(h.indexedDB.open(h.databaseName));
      const tx = db.transaction([...NORMALIZED_STORE_NAMES], 'readwrite'); const completion = done(tx);
      for (const store of NORMALIZED_STORE_NAMES) for (const record of image[store].values()) tx.objectStore(store).put(record);
      await completion; db.close();
      await expect(h.repository.bindAdmittedProject(image)).rejects.toThrow();
      await expect(h.repository.exportProjectForRecovery(scope)).rejects.toThrow();
    } finally { h.adapter.close(); }
  });

  it('rereads validated source and atomically retains ancillary envelopes without copying projects', async () => {
    const h = await createNormalizationHarness();
    try {
      const access = await historicalAccess(h);
      expect((await access.bootstrap(() => {}, { allowCopiedReplacement: false })).status).toBe('admitted');
      const before = (await h.inspectFresh()).source;
      const source = await h.repository.readNormalizationSource();
      expect(source.kind).toBe('historical');
      expect(source.records.projects).toEqual(before.projects);
      expect(source.records.workspace).toEqual(before.workspace[0]);
      expect(source.records.presets).toEqual(before.presets);
      expect(source.records.pendingImports).toEqual(before.pendingImports);
      const attempt = await h.repository.reserveNormalization(source);
      expect(attempt).toMatchObject({ id: NORMALIZATION_LEDGER_ID, state: 'staging', nextRecord: 0,
        progressRevision: 0, sourceDigest: source.sourceDigest, verificationDigest: null, cutoverRevision: null });
      const after = (await h.inspectFresh()).source;
      expect(after.projects).toEqual(before.projects);
      expect(after.workspace).toEqual(before.workspace);
      expect(after.presets).toEqual(before.presets);
      expect(after.pendingImports).toEqual(before.pendingImports);
      expect(after.migrationLedger).toEqual(before.migrationLedger);
      const archives = after.legacyBackup.filter(record => record.kind === 'normalization-source');
      expect(archives).toHaveLength(1);
      expect(archives[0]).toMatchObject({ id: attempt.sourceArchiveId, kind: 'normalization-source',
        sourceKind: 'historical', workspace: before.workspace[0], presets: before.presets,
        pendingImports: before.pendingImports, ledger: before.migrationLedger[0] });
      expect(archives[0]).not.toHaveProperty('projects');
      expect(after.legacyBackup.filter(record => record.kind !== 'normalization-source')).toEqual(before.legacyBackup);
      expect(await h.repository.reserveNormalization(source)).toEqual(attempt);
      expect((await h.inspectFresh()).source.legacyBackup).toEqual(after.legacyBackup);
      await expect(h.adapter.readLegacyBackup(attempt.sourceArchiveId)).rejects.toMatchObject({ code: 'authority-lost' });
      await expect(h.adapter.inspect()).rejects.toMatchObject({ code: 'authority-lost' });
    } finally { h.adapter.close(); }
  });
});

describe('private historical prerequisite transaction fencing', () => {
  const reserveUnknownAttempt = async (indexedDB: IDBFactory) => {
    const db = await request(indexedDB.open(WORKSPACE_DB_NAME));
    const tx = db.transaction('normalizationLedger', 'readwrite'); const completion = done(tx);
    // Absence fencing must reject even an unknown/malformed reservation, not grant a new writer.
    tx.objectStore('normalizationLedger').put({ id: NORMALIZATION_LEDGER_ID, state: 'staging' });
    await completion; db.close();
  };

  it('checks normalization absence inside the verified-marker write transaction', async () => {
    const h = await createNormalizationHarness();
    try {
      await h.adapter.open(); await reserveUnknownAttempt(h.indexedDB);
      const transactions = vi.spyOn(IDBDatabase.prototype, 'transaction');
      await expect(h.adapter.markVerified(h.prepared.ledger)).rejects.toMatchObject({ code: 'conflict' });
      expect(transactions.mock.calls.some(([stores, mode]) => mode === 'readwrite'
        && Array.from(typeof stores === 'string' ? [stores] : stores).includes('normalizationLedger'))).toBe(true);
      expect((await h.inspectFresh()).source).toEqual(h.source);
    } finally { h.adapter.close(); }
  });

  it('rejects historical repair after a normalization attempt is reserved', async () => {
    const h = await createNormalizationHarness({ version: 1 });
    const prepared = await prepareLineageRepair(h.source.migrationLedger[0] as HistoricalMigrationLedgerV1, {
      ...h.source, workspace: h.source.workspace[0],
    }, h.preparation);
    try {
      await h.adapter.open(); await reserveUnknownAttempt(h.indexedDB);
      await expect(h.adapter.repairHistoricalLineage(prepared)).rejects.toMatchObject({ code: 'conflict' });
      expect((await h.inspectFresh()).source).toEqual(h.source);
    } finally { h.adapter.close(); }
  });

  it('serializes a queued historical marker write behind a concurrent reservation', async () => {
    const h = await createNormalizationHarness();
    try {
      await h.adapter.open();
      const db = await request(h.indexedDB.open(WORKSPACE_DB_NAME));
      const tx = db.transaction('normalizationLedger', 'readwrite'); const completion = done(tx);
      tx.objectStore('normalizationLedger').put({ id: NORMALIZATION_LEDGER_ID, state: 'staging' });
      const failure = h.adapter.markVerified(h.prepared.ledger).then(() => null, error => error);
      await completion; db.close();
      expect(await failure).toMatchObject({ code: 'conflict' });
      expect((await h.inspectFresh()).source).toEqual(h.source);
    } finally { h.adapter.close(); }
  });

  it('fences historical legacy-drift writes after reservation', async () => {
    const h = await createNormalizationHarness();
    try {
      await h.adapter.open();
      const ledger = await h.adapter.markVerified(h.prepared.ledger);
      const before = (await h.inspectFresh()).source;
      await reserveUnknownAttempt(h.indexedDB);
      await expect(h.adapter.markLegacyDrift({
        expectedLedgerRevision: ledger.ledgerRevision, expectedAcceptedLegacyDigest: ledger.acceptedLegacyDigest,
        expectedRecoveryId: null, marker: { id: 'drift', kind: 'legacy-drift', detectedAt: h.preparation.now(),
          observedLegacyDigest: 'f'.repeat(64) },
      })).rejects.toMatchObject({ code: 'conflict' });
      expect((await h.inspectFresh()).source).toEqual(before);
    } finally { h.adapter.close(); }
  });

  it('rejects initial historical copy when a fresh normalized reservation exists', async () => {
    const h = createIncrementalRepositoryHarness(WORKSPACE_DB_NAME);
    const preparation = deterministicEnvironment({ crypto: webcrypto as unknown as Crypto });
    const prepared = await prepareInitialCopy(legacySnapshot(validLegacyValues()), preparation);
    const adapter = createIndexedDbAdapter({ indexedDB: h.indexedDB, now: preparation.now }, 3);
    try {
      await adapter.open(); await reserveUnknownAttempt(h.indexedDB);
      await expect(adapter.writeInitialCopy(prepared)).rejects.toMatchObject({ code: 'conflict' });
      const contents = await adapter.inspect();
      expect(Object.values(contents).every(rows => rows.length === 0)).toBe(true);
    } finally { adapter.close(); }
  });

  it('rejects old project writes and destructive copied replacement in the private v3 adapter', async () => {
    const h = await createNormalizationHarness();
    try {
      await h.adapter.open();
      await expect(h.adapter.replaceCopiedInitialCopy(h.prepared, h.prepared.ledger)).rejects.toMatchObject({ code: 'authority-lost' });
      await h.adapter.markVerified(h.prepared.ledger);
      const before = (await h.inspectFresh()).source;
      await expect(h.adapter.saveProject(h.prepared.projects[0].project, {
        incarnation: h.prepared.projects[0].incarnation, revision: 0,
      })).rejects.toMatchObject({ code: 'authority-lost' });
      expect((await h.inspectFresh()).source).toEqual(before);
    } finally { h.adapter.close(); }
  });
});

describe('normalization physical layout (not editing authority)', () => {
  it.each([1, 2] as const)('adds v3 stores without rewriting historical v%s payloads', async version => {
    const h = await createNormalizationHarness({ version });
    try {
      await h.adapter.open();
      const result = await h.inspectFresh();
      expect(result.version).toBe(3);
      expect(result.stores).toEqual([...historicalStores, ...NORMALIZED_STORE_NAMES].sort());
      expect(result.source).toEqual(h.source);
      const db = await request(h.indexedDB.open(h.databaseName));
      try {
        const tx = db.transaction([...NORMALIZED_STORE_NAMES], 'readonly'); const completion = done(tx);
        const counts = await Promise.all(NORMALIZED_STORE_NAMES.map(store => request(tx.objectStore(store).count())));
        await completion;
        expect(counts).toEqual(NORMALIZED_STORE_NAMES.map(() => 0));
      } finally { db.close(); }
    } finally { h.adapter.close(); }
  });

  it('keeps default production open at physical version 2', async () => {
    const h = createIncrementalRepositoryHarness(WORKSPACE_DB_NAME);
    const adapter = createIndexedDbAdapter({ indexedDB: h.indexedDB, now: h.environment.now });
    try {
      await adapter.open();
      const db = await request(h.indexedDB.open(h.databaseName));
      expect(WORKSPACE_DB_VERSION).toBe(2);
      expect(db.version).toBe(2);
      expect(Array.from(db.objectStoreNames)).toEqual([...historicalStores].sort());
      db.close();
    } finally { adapter.close(); }
  });

  it('reports a blocked v3 upgrade without rewriting source or opening editing authority', async () => {
    const h = await createNormalizationHarness();
    const blocker = await request(h.indexedDB.open(WORKSPACE_DB_NAME, 2));
    try {
      await expect(h.adapter.open()).rejects.toMatchObject({ code: 'unavailable', message: 'IndexedDB upgrade is blocked.' });
      expect(blocker.version).toBe(2);
      const tx = blocker.transaction(historicalStores, 'readonly'); const completion = done(tx);
      const projects = await request(tx.objectStore('projects').getAll()); await completion;
      expect(projects).toEqual(h.source.projects);
    } finally { blocker.close(); h.adapter.close(); }
    // The blocked open can finish later, but its connection must be discarded.
    await expect(h.adapter.open()).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('closes an old v2 adapter on versionchange and refuses a downgrade writer', async () => {
    const h = await createNormalizationHarness();
    const onAuthorityLost = vi.fn();
    const old = createIndexedDbAdapter({ indexedDB: h.indexedDB, now: h.preparation.now, onAuthorityLost });
    try {
      await old.open(); await h.adapter.open();
      expect(onAuthorityLost).toHaveBeenCalledOnce();
      expect(onAuthorityLost.mock.calls[0][0]).toMatchObject({ code: 'authority-lost' });
      await expect(old.readWorkspaceRecords()).rejects.toMatchObject({ code: 'authority-lost' });
      const downgrade = createIndexedDbAdapter({ indexedDB: h.indexedDB, now: h.preparation.now });
      try { await expect(downgrade.open()).rejects.toMatchObject({ code: 'unavailable' }); }
      finally { downgrade.close(); }
      expect((await h.inspectFresh()).source).toEqual(h.source);
    } finally { old.close(); h.adapter.close(); }
  });
});
