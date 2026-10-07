import { describe, expect, it } from 'vitest';
import * as catalog from '../../../services/localWorkspace/workspaceCatalog';
import type { WorkspaceCatalog, WorkspaceCatalogDelta } from '../../../services/localWorkspace/normalized/workspaceCommands';
import type { NormalizedWorkspaceManifest } from '../../../services/localWorkspace/normalized/workspaceManifest';
import { makeWorkHarness } from '../../helpers/normalizationWorkHarness';
import { testHash } from '../../helpers/incrementalStoreHarness';

function before(): WorkspaceCatalog {
  return { storageGeneration: 'generation', stamp: { revision: 2, coreDigest: testHash('before') },
    members: [{ storageGeneration: 'generation', projectId: 'a', incarnation: 'ia' },
      { storageGeneration: 'generation', projectId: 'b', incarnation: 'ib' }], activeProjectId: 'a',
    presets: [{ id: 'preset-a', position: 0, recordDigest: testHash('preset-a') },
      { id: 'preset-b', position: 2, recordDigest: testHash('preset-b') }],
    pendingImports: [{ id: 'import-a', position: 1, targetProjectId: 'target', createdAt: '2026-09-30T00:00:00.000Z',
      recordDigest: testHash('import-a'), pendingImportDigest: testHash('pending') }] };
}
function delta(value = before()): WorkspaceCatalogDelta {
  return { storageGeneration: value.storageGeneration, before: value.stamp,
    after: { revision: value.stamp.revision + 1, coreDigest: testHash('after') }, removed: [], added: [],
    activeProjectId: 'b', presets: { remove: [], upsert: [] }, pendingImports: { remove: [], upsert: [] } };
}
function implementation() {
  expect(typeof catalog.projectWorkspaceCatalogWork).toBe('function');
  expect(typeof catalog.diffWorkspaceCatalogWork).toBe('function');
  expect(typeof catalog.applyWorkspaceCatalogDeltaWork).toBe('function');
  return catalog;
}

describe('workspace catalog', () => {
  it('projects detached metadata without reading birth or document payload', async () => {
    const api = implementation(), value = before(), w = makeWorkHarness();
    const members = value.members.map(({ projectId, incarnation }) => ({ projectId, incarnation }));
    for (const member of members) Object.defineProperty(member, 'birth', { get() { throw Error('birth read'); } });
    const manifest = { storageGeneration: value.storageGeneration, revision: value.stamp.revision,
      coreDigest: value.stamp.coreDigest, members, activeProjectId: value.activeProjectId,
      presets: value.presets, pendingImports: value.pendingImports } as unknown as NormalizedWorkspaceManifest;
    const result = await w.runtime.run(api.projectWorkspaceCatalogWork(manifest));
    expect(result).toEqual(value); expect(result.presets[0]).not.toBe(value.presets[0]);
    expect(result.pendingImports[0]).not.toBe(value.pendingImports[0]);
    expect(w.runtime.snapshot().ownedBytes).toBe(0);
  });

  it('diffs and applies membership and ancillary changes while sharing survivors', async () => {
    const api = implementation(), value = before(), w = makeWorkHarness();
    const next: WorkspaceCatalog = { ...value, stamp: delta(value).after, activeProjectId: 'c',
      members: [value.members[1], { storageGeneration: 'generation', projectId: 'c', incarnation: 'ic' }],
      presets: [value.presets[0], { id: 'preset-c', position: 1, recordDigest: testHash('preset-c') }], pendingImports: [] };
    const change = await w.runtime.run(api.diffWorkspaceCatalogWork(value, next));
    expect(change.removed).toEqual([value.members[0]]);
    expect(change.added).toEqual([{ index: 1, scope: next.members[1] }]);
    expect(change.presets).toEqual({ remove: ['preset-b'], upsert: [next.presets[1]] });
    const applied = await w.runtime.run(api.applyWorkspaceCatalogDeltaWork(value, change));
    expect(applied).toEqual(next); expect(applied.members[0]).toBe(value.members[1]);
    expect(applied.presets[0]).toBe(value.presets[0]); expect(value.members).toHaveLength(2);
    expect(w.runtime.snapshot().ownedBytes).toBe(0);
  });

  it('preserves references for activation and rejects reordering existing members', async () => {
    const api = implementation(), value = before(), w = makeWorkHarness();
    const applied = await w.runtime.run(api.applyWorkspaceCatalogDeltaWork(value, delta(value)));
    expect(applied.activeProjectId).toBe('b'); expect(applied.members[0]).toBe(value.members[0]);
    expect(applied.pendingImports[0]).toBe(value.pendingImports[0]);
    await expect(w.runtime.run(api.diffWorkspaceCatalogWork(value, { ...applied, members: [...value.members].reverse() }))).rejects.toThrow();
  });

  it.each([
    ['generation', (d: any) => { d.storageGeneration = 'other'; }],
    ['stale stamp', (d: any) => { d.before = { ...d.before, coreDigest: testHash('stale') }; }],
    ['revision gap', (d: any) => { d.after.revision++; }],
    ['unsafe revision', (d: any) => { d.after.revision = Number.MAX_SAFE_INTEGER + 1; }],
    ['active missing', (d: any) => { d.activeProjectId = 'missing'; }],
    ['absent removal', (d: any) => { d.removed = [{ storageGeneration: 'generation', projectId: 'missing', incarnation: 'i' }]; }],
    ['wrong incarnation', (d: any) => { d.removed = [{ storageGeneration: 'generation', projectId: 'a', incarnation: 'wrong' }]; }],
    ['duplicate removal', (d: any) => { d.removed = [before().members[0], before().members[0]]; }],
    ['negative insertion', (d: any) => { d.added = [{ index: -1, scope: { ...before().members[0], projectId: 'c' } }]; }],
    ['oversized insertion', (d: any) => { d.added = [{ index: 9, scope: { ...before().members[0], projectId: 'c' } }]; }],
    ['duplicate member', (d: any) => { d.added = [{ index: 0, scope: before().members[0] }]; }],
    ['duplicate insertion', (d: any) => { d.added = ['c', 'd'].map(projectId => ({ index: 0, scope: { ...before().members[0], projectId } })); }],
    ['unknown field', (d: any) => { d.extra = true; }],
    ['duplicate preset position', (d: any) => { d.presets.upsert = [{ id: 'new', position: 0, recordDigest: testHash('new') }]; }],
    ['missing preset delete', (d: any) => { d.presets.remove = ['absent']; }],
    ['invalid import digest', (d: any) => { d.pendingImports.upsert = [{ ...before().pendingImports[0], pendingImportDigest: 'bad' }]; }],
  ])('refuses malformed delta: %s', async (_label, mutate) => {
    const api = implementation(), value = before(), change = structuredClone(delta(value)), w = makeWorkHarness();
    mutate(change); await expect(w.runtime.run(api.applyWorkspaceCatalogDeltaWork(value, change))).rejects.toThrow();
    expect(w.runtime.snapshot().ownedBytes).toBe(0); expect(value).toEqual(before());
  });

  it('rejects accessors without calling them', async () => {
    const api = implementation(), value = before(), change = delta(value), w = makeWorkHarness(); let reads = 0;
    Object.defineProperty(change.after, 'revision', { enumerable: true, get() { reads++; return 3; } });
    await expect(w.runtime.run(api.applyWorkspaceCatalogDeltaWork(value, change))).rejects.toThrow(); expect(reads).toBe(0);
  });

  it('accepts long public IDs and charges their comparisons', async () => {
    const api = implementation(), value = before(), w = makeWorkHarness(); const id = '界'.repeat(3000);
    const long: WorkspaceCatalog = { ...value, members: [{ ...value.members[0], projectId: id }], activeProjectId: id };
    const change = { ...delta(long), activeProjectId: id };
    expect((await w.runtime.run(api.applyWorkspaceCatalogDeltaWork(long, change))).activeProjectId).toBe(id);
    expect(w.runtime.snapshot().comparedCodeUnits).toBeGreaterThan(3000);
  });

  it('yields and releases scratch ownership when a large catalog is cancelled', async () => {
    const api = implementation(), value = before(), w = makeWorkHarness();
    const large: WorkspaceCatalog = { ...value, members: Array.from({ length: 600 }, (_, i) => ({
      storageGeneration: 'generation', projectId: `p${i}`, incarnation: `i${i}` })), activeProjectId: 'p0' };
    w.observe(event => { if (event.counters.yields > 0) w.cancel(); });
    await expect(w.runtime.run(api.applyWorkspaceCatalogDeltaWork(large, { ...delta(large), activeProjectId: 'p1' })))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(w.runtime.snapshot().ownedBytes).toBe(0); expect(w.runtime.snapshot().yields).toBeGreaterThan(0);
  });

  it('checks cancellation while validating descriptor removal IDs', async () => {
    const api = implementation(), w = makeWorkHarness(); let reads = 0;
    const value: WorkspaceCatalog = { ...before(), presets: Array.from({ length: 100 }, (_, position) => ({ id: `p${position}`, position, recordDigest: testHash(String(position)) })) };
    const remove = new Proxy(value.presets.map(row => row.id), { get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) { reads++; if (reads === 1) w.cancel(); }
      return Reflect.get(target, key, receiver);
    } });
    const change = { ...delta(value), presets: { remove, upsert: [] } };
    await expect(w.runtime.run(api.applyWorkspaceCatalogDeltaWork(value, change))).rejects.toMatchObject({ name: 'AbortError' });
    expect(reads).toBe(1); expect(w.runtime.snapshot().ownedBytes).toBe(0);
  });

  it('checks cancellation during the insertion-index uniqueness pass', async () => {
    const api = implementation(), value = before(), w = makeWorkHarness(); let reads = 0;
    const first = new Proxy({ index: 0, scope: { ...value.members[0], projectId: 'c' } }, { get(target, key, receiver) {
      // Two validation reads, one merge comparison, then uniqueness inspection.
      if (key === 'index' && ++reads === 4) w.cancel();
      return Reflect.get(target, key, receiver);
    } });
    const change = { ...delta(value), added: [first, { index: 1, scope: { ...value.members[0], projectId: 'd' } }] };
    await expect(w.runtime.run(api.applyWorkspaceCatalogDeltaWork(value, change))).rejects.toMatchObject({ name: 'AbortError' });
    expect(reads).toBe(4); expect(w.runtime.snapshot().ownedBytes).toBe(0);
  });
});
