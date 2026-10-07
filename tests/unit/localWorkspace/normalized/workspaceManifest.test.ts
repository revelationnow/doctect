import { describe, expect, it } from 'vitest';
import { canonicalStringify } from '../../../../services/localWorkspace/canonical';
import { validateWorkspaceRecordsWork } from '../../../../services/localWorkspace/migration';
import { hashFrame } from '../../../../services/localWorkspace/normalized/work';
import { createInitialWorkspaceManifest, deriveWorkspaceIncarnation, projectWorkspaceOrderWork,
  validateWorkspaceManifestWork, workspaceManifestCoreFrame, type NormalizedWorkspaceManifest,
  type WorkspaceManifestCore } from '../../../../services/localWorkspace/normalized/workspaceManifest';
import type { NormalizationSource } from '../../../../services/localWorkspace/normalized/schema';
import { makeWorkHarness } from '../../../helpers/normalizationWorkHarness';
import { makeIncrementalProject } from '../../../helpers/incrementalFixtures';
import { testHash } from '../../../helpers/incrementalStoreHarness';

const time = '2026-09-26T00:00:00.000Z';
function core(): WorkspaceManifestCore {
  return { id: 'current', kind: 'normalized-workspace', formatVersion: 3, manifestVersion: 1,
    storageGeneration: 'g1', revision: 0, activeProjectId: 'p1',
    activation: { attemptId: 'a1', sourceKind: 'fresh', sourceDigest: testHash('source'),
      sourceArchiveId: 'archive', sourceArchiveDigest: testHash('archive'), sourceWorkspaceRevision: 0 },
    members: [{ projectId: 'p1', incarnation: 'i1', consumedImport: {}, birth: { kind: 'migration',
      sourceRevision: 7, sourceUpdatedAt: time, projectDigest: testHash('project') } }],
    presets: [], pendingImports: [], legacyAcceptance: { kind: 'fresh' } };
}
function manifest(value = core()): NormalizedWorkspaceManifest {
  const coreDigest = testHash(canonicalStringify(['doctect-workspace-core-v1', value]));
  return { ...value, coreDigest, lastCommit: null,
    commitWindow: { floorRevision: value.revision, floorCoreDigest: coreDigest, entries: [] } };
}

describe('workspace manifest metadata', () => {
  it('frames only the exact core and projects membership order without mutation', async () => {
    const w = makeWorkHarness('reopen'); const value = manifest();
    expect(await hashFrame(w.runtime, 'proof', workspaceManifestCoreFrame(value))).toBe(value.coreDigest);
    expect(await w.runtime.run(validateWorkspaceManifestWork(value))).toEqual(value);
    expect(await w.runtime.run(projectWorkspaceOrderWork(value))).toEqual({ id: 'current',
      projectOrder: ['p1'], activeProjectId: 'p1', revision: 0 });
    expect(value.members).toHaveLength(1);
  });

  it.each([
    ['duplicate member', (m: any) => m.members.push(structuredClone(m.members[0]))],
    ['missing active member', (m: any) => { m.activeProjectId = 'absent'; }],
    ['empty workspace', (m: any) => { m.members = []; }],
    ['sparse members', (m: any) => { m.members.length = 2; }],
    ['unknown field', (m: any) => { m.extra = true; }],
    ['unknown version', (m: any) => { m.manifestVersion = 2; }],
    ['unknown birth', (m: any) => { m.members[0].birth.kind = 'guessed'; }],
    ['negative revision', (m: any) => { m.revision = -1; }],
    ['fractional source revision', (m: any) => { m.members[0].birth.sourceRevision = 0.5; }],
    ['invalid timestamp', (m: any) => { m.members[0].birth.sourceUpdatedAt = 'today'; }],
    ['invalid digest', (m: any) => { m.coreDigest = 'unknown'; }],
    ['partial consume provenance', (m: any) => { m.members[0].consumedImport = { consumedImportDigest: testHash('x') }; }],
    ['duplicate preset position', (m: any) => { m.presets = [{ id: 'a', position: 0, recordDigest: testHash('a') },
      { id: 'b', position: 0, recordDigest: testHash('b') }]; }],
    ['duplicate import ID', (m: any) => { m.pendingImports = [0, 1].map(position => ({ id: 'same', position,
      targetProjectId: `new-${position}`, createdAt: time, recordDigest: testHash('same'), pendingImportDigest: testHash('same') })); }],
  ])('rejects %s', async (_name, mutate) => {
    const value = manifest(); mutate(value); const w = makeWorkHarness('reopen');
    await expect(w.runtime.run(validateWorkspaceManifestWork(value))).rejects.toThrow();
  });

  it('rejects own accessors without invoking them', async () => {
    let getters = 0; const value = manifest(); const w = makeWorkHarness('reopen');
    Object.defineProperty(value.members[0], 'projectId', { enumerable: true, get() { getters++; return 'p1'; } });
    await expect(w.runtime.run(validateWorkspaceManifestWork(value))).rejects.toThrow();
    expect(getters).toBe(0);
  });

  it('accepts long external IDs but rejects oversized private activation identities', async () => {
    const c = core(); c.members[0].projectId = c.activeProjectId = '界'.repeat(300);
    const value = manifest(c); const w = makeWorkHarness('reopen');
    await expect(w.runtime.run(validateWorkspaceManifestWork(value))).resolves.toEqual(value);
    value.activation.attemptId = 'é'.repeat(129);
    await expect(w.runtime.run(validateWorkspaceManifestWork(value))).rejects.toThrow();
  });

  it.each([
    { consumedImportId: 'old-import' },
    { consumedImportId: 'old-import', consumedImportCreatedAt: time },
    { consumedImportId: 'old-import', consumedImportCreatedAt: time, consumedImportDigest: testHash('pending') },
  ])('preserves admitted historical consume metadata %j', async consumedImport => {
    const value = manifest(); value.members[0].consumedImport = consumedImport;
    const w = makeWorkHarness('reopen');
    await expect(w.runtime.run(validateWorkspaceManifestWork(value))).resolves.toEqual(value);
  });

  it('yields and cancels a large membership validation without leaking runtime ownership', async () => {
    const c = core(); c.members = Array.from({ length: 500 }, (_, i) => ({ ...c.members[0], projectId: `p${i}` }));
    c.activeProjectId = 'p0'; const value = manifest(c); const w = makeWorkHarness('reopen');
    w.observe(event => { if (event.counters.yields > 0) w.cancel(); });
    await expect(w.runtime.run(validateWorkspaceManifestWork(value))).rejects.toMatchObject({ name: 'AbortError' });
    expect(w.runtime.snapshot().yields).toBeGreaterThan(0); expect(w.runtime.snapshot().ownedBytes).toBe(0);
  });

  it('charges long external identity comparison rather than using native string hashing', async () => {
    const c = core(); c.members[0].projectId = 'x'.repeat(128 * 1024);
    c.activeProjectId = Array.from({ length: 128 * 1024 }, () => 'x').join('');
    const value = manifest(c); const w = makeWorkHarness('reopen');
    await w.runtime.run(validateWorkspaceManifestWork(value));
    expect(w.runtime.snapshot().comparedCodeUnits).toBeGreaterThanOrEqual(256 * 1024);
    expect(w.runtime.snapshot().yields).toBeGreaterThan(0);
  });

  it('owns construction metadata proportional to membership and releases it on cancellation', async () => {
    const measure = async (count: number, cancel = false) => {
      const project = makeIncrementalProject(2);
      const projects = Array.from({ length: count }, (_, i) => ({ id: `p${i}`, project: { ...project, id: `p${i}` },
        incarnation: `i${i}`, storageRevision: 0, updatedAt: time }));
      const source: NormalizationSource = { kind: 'fresh', ledger: null, backups: [], sourceDigest: core().activation.sourceDigest,
        contentDigest: testHash('content'), sourceProjects: projects.map(row => ({ projectId: row.id, incarnation: row.incarnation,
          revision: 0, digest: testHash(row.id) })), records: { projects,
          workspace: { id: 'current', projectOrder: projects.map(row => row.id), activeProjectId: 'p0', revision: 0 }, presets: [], pendingImports: [] },
        snapshot: { projects: projects.map(row => row.project), activeProjectId: 'p0', customPresets: [], pendingImports: [] } };
      const w = makeWorkHarness('prepare');
      if (cancel) w.observe(event => { if (event.counters.ownedBytes > 0) w.cancel(); });
      const operation = createInitialWorkspaceManifest(source, core().activation, w.runtime);
      if (cancel) await expect(operation).rejects.toMatchObject({ name: 'AbortError' }); else await operation;
      expect(w.runtime.snapshot().ownedBytes).toBe(0);
      return w.runtime.snapshot().ownedHighWater;
    };
    expect(await measure(100)).toBeGreaterThan(await measure(1));
    expect(await measure(100, true)).toBeGreaterThan(0);
  });

  it('derives stable bounded incarnations from generation, revision and ordinal', async () => {
    const w = makeWorkHarness('prepare');
    const first = await deriveWorkspaceIncarnation('g1', 1, 0, w.runtime);
    expect(first).toBe(`workspace:${testHash(canonicalStringify(['doctect-workspace-incarnation-v1', 'g1', 1, 0]))}`);
    expect(await deriveWorkspaceIncarnation('g1', 1, 0, w.runtime)).toBe(first);
    expect(await deriveWorkspaceIncarnation('g1', 2, 0, w.runtime)).not.toBe(first);
    expect(await deriveWorkspaceIncarnation('g1', 1, 1, w.runtime)).not.toBe(first);
    await expect(deriveWorkspaceIncarnation('g1', 0, 0, w.runtime)).rejects.toThrow();
  });

  it('validates workspace-born metadata independently of the retained migration member shape', async () => {
    const w = makeWorkHarness('reopen'); const initial = manifest(); const c = core(); c.revision = 1;
    c.members = [{ projectId: 'p1', incarnation: await deriveWorkspaceIncarnation('g1', 1, 0, w.runtime), consumedImport: {},
      birth: { kind: 'workspace-command', identity: { clientId: 'client', commandId: 'create-1', commandSequence: 1 },
        requestDigest: testHash('create'), workspaceRevision: 1, memberOrdinal: 0, createdAt: time,
        authority: { documentRevision: 0, preferenceRevision: 0, foldStructureGeneration: 0 },
        digests: { imageDigest: testHash('image'), documentDigest: testHash('document'), preferenceDigest: testHash('preferences'),
          foldDigest: testHash('folds'), recordCount: 10 } } }];
    const value = manifest(c);
    const proof = { identity: { clientId: 'client', commandId: 'create-1', commandSequence: 1 }, requestDigest: testHash('create'),
      before: { revision: 0, coreDigest: initial.coreDigest }, after: { revision: 1, coreDigest: value.coreDigest }, postconditionDigest: testHash('effect') };
    value.lastCommit = { ...proof, proofDigest: testHash(canonicalStringify(['doctect-workspace-receipt-v1', proof])) };
    value.commitWindow = { floorRevision: 0, floorCoreDigest: initial.coreDigest, entries: [value.lastCommit] };
    await expect(w.runtime.run(validateWorkspaceManifestWork(value))).resolves.toEqual(value);
    const born = value.members[0].birth;
    if (born.kind !== 'workspace-command') throw new Error('Wrong fixture birth');
    born.authority.documentRevision = 1;
    await expect(w.runtime.run(validateWorkspaceManifestWork(value))).rejects.toThrow();
  });

  it('constructs initial membership from source order and preserves consume provenance', async () => {
    const a = makeIncrementalProject(); const b = { ...makeIncrementalProject(), id: 'second' };
    const provenance = { consumedImportId: 'import', consumedImportCreatedAt: time, consumedImportDigest: testHash('pending'),
      consumedImportAttempt: { sourceKeyDigest: testHash('key'), payloadDigest: testHash('payload'), pendingImportDigest: testHash('pending') } };
    const source: NormalizationSource = { kind: 'fresh', ledger: null, backups: [], sourceDigest: testHash('source'), contentDigest: testHash('content'),
      records: { projects: [{ id: a.id, project: a, incarnation: 'ia', storageRevision: 7, updatedAt: time, ...provenance },
        { id: b.id, project: b, incarnation: 'ib', storageRevision: 2, updatedAt: time }],
      workspace: { id: 'current', projectOrder: [b.id, a.id], activeProjectId: b.id, revision: 3 }, presets: [], pendingImports: [] },
      snapshot: { projects: [b, a], activeProjectId: b.id, customPresets: [], pendingImports: [] },
      sourceProjects: [{ projectId: a.id, incarnation: 'ia', revision: 7, digest: testHash('a') },
        { projectId: b.id, incarnation: 'ib', revision: 2, digest: testHash('b') }] };
    source.records.presets = [5, 2].map(position => ({ id: `preset-${position}`, position,
      preset: { id: `preset-${position}`, title: 'Preset', desc: 'Preserved', isCustom: true, initialState: a.initialState } }));
    source.records.pendingImports = [{ id: 'pending', position: 4, pendingImport: { id: 'pending', targetProjectId: a.id,
      createdAt: time, name: 'Pending', warnings: [], state: a.initialState },
      attemptProvenance: { sourceKeyDigest: testHash('legacy-key'), payloadDigest: testHash('legacy-input'), pendingImportDigest: testHash('retained-attempt') } }];
    source.records.pendingImports.push({ id: 'import', position: 5,
      pendingImport: { ...source.records.pendingImports[0].pendingImport, id: 'import' } });
    const original = structuredClone(source); const w = makeWorkHarness('prepare');
    await expect(w.runtime.run(validateWorkspaceRecordsWork(source.records))).resolves.toMatchObject({ workspace: source.records.workspace });
    const activation = { ...core().activation, sourceWorkspaceRevision: 3 };
    const result = await createInitialWorkspaceManifest(source, activation, w.runtime);
    expect(result.members.map(m => m.projectId)).toEqual([b.id, a.id]);
    expect(result.members[1].consumedImport).toEqual(provenance);
    expect(result.members[1].birth).toEqual({ kind: 'migration', sourceRevision: 7, sourceUpdatedAt: time, projectDigest: testHash('a') });
    expect(result.storageGeneration).toBe(`normalized:${source.sourceDigest}`);
    expect(result.commitWindow).toEqual({ floorRevision: 3, floorCoreDigest: result.coreDigest, entries: [] });
    expect(result.presets.map(item => item.position)).toEqual([2, 5]);
    expect(result.presets[0].recordDigest).toBe(testHash(canonicalStringify(['workspace-preset-v1', source.records.presets[1]])));
    expect(result.pendingImports[0]).toEqual({ id: 'pending', position: 4, targetProjectId: a.id, createdAt: time,
      recordDigest: testHash(canonicalStringify(['workspace-import-v1', source.records.pendingImports[0]])),
      pendingImportDigest: testHash(canonicalStringify(source.records.pendingImports[0].pendingImport)),
      attemptProvenance: source.records.pendingImports[0].attemptProvenance });
    expect(result.pendingImports.map(item => [item.id, item.targetProjectId])).toEqual([['pending', a.id], ['import', a.id]]);
    expect(Object.keys(result.presets[0]).sort()).toEqual(['id', 'position', 'recordDigest']);
    expect(await hashFrame(w.runtime, 'proof', workspaceManifestCoreFrame(result))).toBe(result.coreDigest);
    expect(source).toEqual(original);
  });
});
