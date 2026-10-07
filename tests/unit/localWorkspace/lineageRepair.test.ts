// @vitest-environment node
import { webcrypto } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { digestWorkspaceContent } from '../../../services/localWorkspace/canonical';
import {
  prepareLineageRepair,
} from '../../../services/localWorkspace/lineageRepair';
import {
  prepareInitialCopy,
  type WorkspaceRecordCandidates,
} from '../../../services/localWorkspace/migration';
import type {
  HistoricalMigrationLedgerV1,
  StoredProject,
} from '../../../services/localWorkspace/schema';
import {
  deterministicEnvironment,
  LEGACY_KEYS,
  legacyProject,
  legacySnapshot,
  validLegacyValues,
} from '../../helpers/localWorkspaceFixtures';
import { makeWorkHarness } from '../../helpers/normalizationWorkHarness';

const candidate = async () => {
  const initial = await prepareInitialCopy(
    legacySnapshot(validLegacyValues()),
    deterministicEnvironment({ crypto: webcrypto as unknown as Crypto }),
  );
  const projects = structuredClone(initial.projects) as Array<StoredProject | Record<string, unknown>>;
  delete (projects[0] as Partial<StoredProject>).incarnation;
  const ledger = {
    ...structuredClone(initial.ledger),
    indexedDbVersion: 1,
  } as HistoricalMigrationLedgerV1;
  const records: WorkspaceRecordCandidates = {
    projects,
    workspace: structuredClone(initial.workspace),
    presets: structuredClone(initial.presets),
    pendingImports: structuredClone(initial.pendingImports),
  };
  return { initial, ledger, records };
};

describe('version-1 lineage repair preparation', () => {
  it('cooperatively preserves exact originals and independently hashes both reconstructed snapshots', async () => {
    const fixture = await candidate();
    expect(fixture.ledger.expectedTargetDigest).toBe('ad3545a694cece57928ac9f891d490173d520fbb964e4143a588c090ea949b1f');
    const before = structuredClone(fixture.records);
    const expected = await prepareLineageRepair(fixture.ledger, fixture.records, {
      crypto: webcrypto as unknown as Crypto, randomUUID: () => 'repair-incarnation-a',
    });
    const reference = makeWorkHarness('prerequisite');
    await digestWorkspaceContent(expected.snapshot, webcrypto.subtle as unknown as SubtleCrypto, reference.runtime);
    const h = makeWorkHarness('prerequisite');
    const snapshotBytes = new TextEncoder().encode(JSON.stringify(expected.snapshot)).byteLength;
    const hashOwnership: number[] = [];
    h.observe(event => {
      if (event.counters.sourceHashBytes > 0 && event.counters.hashBytes > 0) hashOwnership.push(event.counters.ownedBytes);
    });
    const randomUUID = vi.fn(() => 'repair-incarnation-a');
    const digest = vi.fn(() => { throw new Error('Work path must not use SubtleCrypto'); });
    const observed = await prepareLineageRepair(fixture.ledger, fixture.records, {
      crypto: { subtle: { digest } as unknown as SubtleCrypto }, randomUUID, work: h.runtime,
    });
    expect(observed).toEqual(expected);
    expect(fixture.records).toEqual(before);
    expect(observed.expectedProjects[0].record).not.toBe((fixture.records.projects as unknown[])[0]);
    expect(observed.ledger.ledgerRevision).toBe(fixture.ledger.ledgerRevision + 1);
    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(digest).not.toHaveBeenCalled();
    expect(h.runtime.snapshot().sourceHashBytes).toBe(2 * reference.runtime.snapshot().sourceHashBytes);
    expect(h.runtime.snapshot().visits).toBeGreaterThan(0);
    expect(h.runtime.snapshot().ownedBytes).toBe(0);
    expect(hashOwnership.some(bytes => bytes >= snapshotBytes)).toBe(true);
  });

  it('allocates missing incarnations in raw record order, not workspace order', async () => {
    const initial = await prepareInitialCopy(legacySnapshot({
      ...validLegacyValues(),
      [LEGACY_KEYS.projects]: JSON.stringify(['project-z', 'project-a', 'project-m'].map(id => legacyProject(id))),
    }), deterministicEnvironment({ crypto: webcrypto as unknown as Crypto }));
    const projects = structuredClone(initial.projects).reverse();
    delete (projects[0] as Partial<StoredProject>).incarnation;
    delete (projects[2] as Partial<StoredProject>).incarnation;
    const records = { projects, workspace: initial.workspace, presets: initial.presets, pendingImports: initial.pendingImports };
    const ledger = { ...initial.ledger, indexedDbVersion: 1 } as HistoricalMigrationLedgerV1;
    const before = structuredClone(records);
    const h = makeWorkHarness('prerequisite');
    const randomUUID = vi.fn().mockReturnValueOnce('first').mockReturnValueOnce('second');
    const clone = vi.spyOn(globalThis, 'structuredClone');
    try {
      const result = await prepareLineageRepair(ledger, records, {
        crypto: webcrypto as unknown as Crypto, randomUUID, work: h.runtime,
      });
      expect(result.expectedProjects.map(record => record.id)).toEqual(['project-m', 'project-a', 'project-z']);
      expect(result.replacementProjects.map(record => [record.id, record.incarnation]))
        .toEqual([['project-m', 'first'], ['project-z', 'second']]);
      expect(result.snapshot.projects.map(project => project.id)).toEqual(['project-z', 'project-a', 'project-m']);
      expect(result.expectedProjects[1].record).toEqual(projects[1]);
      expect(randomUUID).toHaveBeenCalledTimes(2);
      expect(clone.mock.calls.some(([value]) => Array.isArray(value))).toBe(false);
      expect(records).toEqual(before);
    } finally { clone.mockRestore(); }
  });

  it('yields during a thousand-row capture and aborts before allocating lineage', async () => {
    const fixture = await candidate();
    const row = (fixture.records.projects as unknown[])[0];
    fixture.records.projects = Array.from({ length: 1000 }, () => structuredClone(row));
    const h = makeWorkHarness('prerequisite', true);
    const randomUUID = vi.fn(() => 'unused');
    let timerFired = false;
    const timer = setTimeout(() => { timerFired = true; h.cancel(); }, 0);
    try {
      await expect(prepareLineageRepair(fixture.ledger, fixture.records, {
        crypto: webcrypto as unknown as Crypto, randomUUID, work: h.runtime,
      })).rejects.toMatchObject({ name: 'AbortError' });
      expect(randomUUID).not.toHaveBeenCalled();
      // Cancellation after the actual task yield prevents its completed-yield
      // counter from incrementing. The timer proves event-loop progress.
      expect(timerFired).toBe(true);
      expect(h.runtime.snapshot().visits).toBeGreaterThanOrEqual(1024);
      expect(h.runtime.snapshot().primitiveExceptions).toBeLessThan(1000);
    } finally { clearTimeout(timer); }
  });

  it.each(['before-start', 'during-validation', 'during-uuid'] as const)('preserves cancellation %s without further UUID allocation', async when => {
    const fixture = await candidate();
    const before = structuredClone(fixture.records);
    const h = makeWorkHarness('prerequisite');
    if (when === 'before-start') h.cancel();
    if (when === 'during-validation') h.observe(() => h.cancel());
    const randomUUID = vi.fn(() => {
      if (when === 'during-uuid') h.cancel();
      return 'repair-incarnation-a';
    });
    await expect(prepareLineageRepair(fixture.ledger, fixture.records, {
      crypto: webcrypto as unknown as Crypto, randomUUID, work: h.runtime,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(randomUUID).toHaveBeenCalledTimes(when === 'during-uuid' ? 1 : 0);
    expect(fixture.records).toEqual(before);
    expect(h.runtime.snapshot().ownedBytes).toBe(0);
  });

  it('does not allocate lineage when the cooperative first digest check fails', async () => {
    const fixture = await candidate();
    fixture.ledger.expectedTargetDigest = 'f'.repeat(64);
    const h = makeWorkHarness('prerequisite');
    const randomUUID = vi.fn(() => 'unused');
    await expect(prepareLineageRepair(fixture.ledger, fixture.records, {
      crypto: webcrypto as unknown as Crypto, randomUUID, work: h.runtime,
    })).rejects.toMatchObject({ category: 'verification-failed', message: 'Historical workspace digest changed before lineage preparation.' });
    expect(randomUUID).not.toHaveBeenCalled();
    expect(h.runtime.snapshot().sourceHashBytes).toBeGreaterThan(0);
  });

  it.each([1, 2])('releases loaded snapshot ownership when cancelled during digest %i', async ordinal => {
    const fixture = await candidate();
    const expected = await prepareLineageRepair(fixture.ledger, fixture.records, {
      crypto: webcrypto as unknown as Crypto, randomUUID: () => 'repair-incarnation-a',
    });
    const reference = makeWorkHarness('prerequisite');
    await digestWorkspaceContent(expected.snapshot, webcrypto.subtle as unknown as SubtleCrypto, reference.runtime);
    const threshold = (ordinal - 1) * reference.runtime.snapshot().sourceHashBytes;
    const h = makeWorkHarness('prerequisite');
    h.observe(event => { if (event.counters.sourceHashBytes > threshold) h.cancel(); });
    const randomUUID = vi.fn(() => 'repair-incarnation-a');
    await expect(prepareLineageRepair(fixture.ledger, fixture.records, {
      crypto: webcrypto as unknown as Crypto, randomUUID, work: h.runtime,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(randomUUID).toHaveBeenCalledTimes(ordinal - 1);
    expect(h.runtime.snapshot().ownedHighWater)
      .toBeGreaterThanOrEqual(new TextEncoder().encode(JSON.stringify(expected.snapshot)).byteLength);
    expect(h.runtime.snapshot().ownedBytes).toBe(0);
  });

  it('checks the digest again after lineage allocation', async () => {
    const fixture = await candidate();
    const h = makeWorkHarness('prerequisite');
    const randomUUID = vi.fn(() => {
      fixture.ledger.expectedTargetDigest = 'f'.repeat(64);
      return 'repair-incarnation-a';
    });
    await expect(prepareLineageRepair(fixture.ledger, fixture.records, {
      crypto: webcrypto as unknown as Crypto, randomUUID, work: h.runtime,
    })).rejects.toMatchObject({ category: 'verification-failed', message: 'Historical workspace digest changed during lineage preparation.' });
    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(h.runtime.snapshot().sourceHashBytes).toBeGreaterThan(0);
    expect(h.runtime.snapshot().ownedBytes).toBe(0);
  });

  it('checks lifecycle after final result construction crosses its await boundary', async () => {
    const fixture = await candidate();
    const h = makeWorkHarness('prerequisite');
    const nativeClone = globalThis.structuredClone;
    let ledgerClones = 0;
    const clone = vi.spyOn(globalThis, 'structuredClone').mockImplementation(value => {
      const copy = nativeClone(value);
      if (value === fixture.ledger && ++ledgerClones === 2) queueMicrotask(h.cancel);
      return copy;
    });
    try {
      const outcome = await prepareLineageRepair(fixture.ledger, fixture.records, {
        crypto: webcrypto as unknown as Crypto, randomUUID: () => 'repair-incarnation-a', work: h.runtime,
      }).then(() => 'completed', error => error.name);
      expect(ledgerClones).toBe(2);
      expect(outcome).toBe('AbortError');
      expect(h.runtime.snapshot().ownedBytes).toBe(0);
    } finally { clone.mockRestore(); }
  });

  it('adds only missing private incarnation and preserves logical content', async () => {
    const fixture = await candidate();
    const before = structuredClone(fixture.records);
    const beforeProjects = structuredClone(fixture.records.projects) as unknown[];
    const randomUUID = vi.fn(() => 'repair-incarnation-a');
    const digest = vi.fn((algorithm: AlgorithmIdentifier, data: BufferSource) =>
      webcrypto.subtle.digest(algorithm, data));

    const prepared = await prepareLineageRepair(fixture.ledger, fixture.records, {
      crypto: { subtle: { digest } as unknown as SubtleCrypto },
      randomUUID,
    });

    expect(fixture.records).toEqual(before);
    expect(prepared.expectedProjects).toEqual([{
      id: fixture.initial.projects[0].id,
      record: beforeProjects[0],
    }]);
    expect(prepared.replacementProjects).toEqual([{
      ...fixture.initial.projects[0],
      incarnation: 'repair-incarnation-a',
    }]);
    expect(prepared.ledger).toEqual({
      ...fixture.ledger,
      indexedDbVersion: 2,
      ledgerRevision: fixture.ledger.ledgerRevision + 1,
    });
    expect(prepared.snapshot.projects).toEqual(
      fixture.initial.projects.map(record => record.project),
    );
    expect(digest).toHaveBeenCalledTimes(2);
    expect(await digestWorkspaceContent(
      prepared.snapshot,
      (webcrypto as unknown as Crypto).subtle,
    )).toBe(fixture.ledger.expectedTargetDigest);
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it('preserves a valid existing incarnation without rewriting its project', async () => {
    const fixture = await candidate();
    (fixture.records.projects as unknown[])[0] = structuredClone(fixture.initial.projects[0]);

    const prepared = await prepareLineageRepair(fixture.ledger, fixture.records, {
      crypto: webcrypto as unknown as Crypto,
      randomUUID: vi.fn(() => 'unused'),
    });

    expect(prepared.replacementProjects).toEqual([]);
    expect(prepared.expectedProjects[0].record).toEqual(fixture.initial.projects[0]);
  });

  it.each([
    ['empty present incarnation', (record: Record<string, unknown>) => { record.incarnation = ''; }],
    ['non-string present incarnation', (record: Record<string, unknown>) => { record.incarnation = 7; }],
    ['unknown project-record field', (record: Record<string, unknown>) => { record.unknown = true; }],
    ['malformed project payload', (record: Record<string, unknown>) => { record.project = null; }],
  ])('rejects %s without changing input', async (_label, corrupt) => {
    const fixture = await candidate();
    const record = (fixture.records.projects as Record<string, unknown>[])[0];
    corrupt(record);
    const before = structuredClone(fixture.records);
    const randomUUID = vi.fn(() => 'repair-incarnation-a');

    await expect(prepareLineageRepair(fixture.ledger, fixture.records, {
      crypto: webcrypto as unknown as Crypto,
      randomUUID,
    })).rejects.toMatchObject({ category: 'target-invalid' });
    expect(fixture.records).toEqual(before);
    expect(randomUUID).not.toHaveBeenCalled();
    const h = makeWorkHarness('prerequisite');
    await expect(prepareLineageRepair(fixture.ledger, fixture.records, {
      crypto: webcrypto as unknown as Crypto, randomUUID, work: h.runtime,
    })).rejects.toMatchObject({ category: 'target-invalid' });
    expect(fixture.records).toEqual(before);
    expect(randomUUID).not.toHaveBeenCalled();
  });

  it('rejects empty generated incarnation', async () => {
    const empty = await candidate();
    await expect(prepareLineageRepair(empty.ledger, empty.records, {
      crypto: webcrypto as unknown as Crypto,
      randomUUID: () => '',
    })).rejects.toMatchObject({ category: 'target-invalid' });
  });

  it('rejects a pre-repair digest mismatch without generating lineage', async () => {
    const mismatched = await candidate();
    mismatched.ledger.expectedTargetDigest = 'f'.repeat(64);
    const randomUUID = vi.fn(() => 'repair-incarnation-a');

    await expect(prepareLineageRepair(mismatched.ledger, mismatched.records, {
      crypto: webcrypto as unknown as Crypto,
      randomUUID,
    })).rejects.toMatchObject({ category: 'verification-failed' });
    expect(randomUUID).not.toHaveBeenCalled();
  });
});
