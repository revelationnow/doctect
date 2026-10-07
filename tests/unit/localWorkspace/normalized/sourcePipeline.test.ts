// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import * as codec from '../../../../services/localWorkspace/normalized/codec';
import * as validation from '../../../../services/localWorkspace/validation';
import * as json from '../../../../shared/jsonWork.js';
import * as appState from '../../../../shared/validateAppState.js';
import { effect, type WorkRuntime } from '../../../../shared/cooperativeWork.js';
import type { WorkspaceRecordCandidates, WorkspaceRecords } from '../../../../services/localWorkspace/migration';
import type { NormalizationSource } from '../../../../services/localWorkspace/normalized/schema';
import { frameRecord } from '../../../../services/localWorkspace/normalized/commitProof';
import { disposeEmissionPlan, openEmissionCursor, type EmissionPlan } from '../../../../services/localWorkspace/normalized/emissionPlan';
import * as emission from '../../../../services/localWorkspace/normalized/emissionPlan';
import { makeEmissionSource, collectTarget } from '../../../helpers/normalizationEmissionFixtures';
import { makeIncrementalProject } from '../../../helpers/incrementalFixtures';
import { makeWorkHarness } from '../../../helpers/normalizationWorkHarness';

interface Cursors {
  create(source: NormalizationSource): codec.TargetCursor;
  plan(source: NormalizationSource): codec.PlannedTargetCursor;
}
type Scope = <T>(input: WorkspaceRecordCandidates, work: WorkRuntime,
  consume: (records: WorkspaceRecords, cursors: Cursors) => Promise<T>) => Promise<T>;
function api(): Scope {
  const value = Reflect.get(codec, 'withSourceRecords');
  expect(value, 'capture-scoped source/target interface').toBeTypeOf('function');
  return value;
}
afterEach(() => vi.restoreAllMocks());

it.each([false, true])('capture scope validates once and preserves independent target frames (planned=%s)', async planned => {
  const scoped = api(), a = makeIncrementalProject(2), b = { ...makeIncrementalProject(1), id: 'second' };
  Object.assign(a, { extension: { z: '根😀\ud800', a: [true, null] } });
  a.initialState.variants.default.templates['page-0'].layers = [{ id: 'duplicate', collapsed: true }, { id: 'duplicate', collapsed: 'raw' }] as any;
  const source = makeEmissionSource([a, b]); source.records.projects.reverse();
  const before = structuredClone(source), oracle = codec.prepareNormalizationTarget(source).map(row => frameRecord(row.store, row.record));
  const h = makeWorkHarness(), checked = vi.spyOn(validation, 'checkStoredWorkspaceProjectWork');
  let plan: EmissionPlan | undefined;
  try {
    await scoped(source.records, h.runtime, async (records, cursors) => {
      expect(records).toBe(source.records); expect(checked).toHaveBeenCalledTimes(2);
      const canonical = vi.spyOn(json, 'canonicalBytesWork'), semantic = vi.spyOn(appState, 'validateAppStateWork');
      const cursor = planned ? cursors.plan(source) : cursors.create(source);
      const target = await collectTarget(cursor, h.runtime);
      expect(target.map(row => frameRecord(row.store, row.record))).toEqual(oracle);
      expect(canonical.mock.calls.filter(([value]) => value === a || value === b)).toHaveLength(0);
      expect(semantic).not.toHaveBeenCalled();
      if (planned) await h.runtime.run(effect(1, () => { plan = (cursor as codec.PlannedTargetCursor).takeEmissionPlan(); }));
    });
    if (plan) {
      const replay = openEmissionCursor(plan, source, 0);
      try { expect((await collectTarget(replay, h.runtime)).map(row => frameRecord(row.store, row.record))).toEqual(oracle); }
      finally { replay.dispose(); }
    }
    expect(source).toEqual(before);
  } finally { if (plan) disposeEmissionPlan(plan); }
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it.each(['records', 'records-getter', 'array', 'row', 'project'] as const)('capture scope refuses substituted %s identity', async kind => {
  const scoped = api(), source = makeEmissionSource(), h = makeWorkHarness(); let getterCalls = 0;
  await expect(scoped(source.records, h.runtime, async (_records, cursors) => {
    if (kind === 'records') source.records = structuredClone(source.records);
    if (kind === 'records-getter') { const records = source.records; Object.defineProperty(source, 'records', { get() { getterCalls++; return records; } }); }
    if (kind === 'array') source.records.projects = [...source.records.projects];
    if (kind === 'row') source.records.projects[0] = structuredClone(source.records.projects[0]);
    if (kind === 'project') source.records.projects[0].project = structuredClone(source.records.projects[0].project);
    await collectTarget(cursors.create(source), h.runtime);
  })).rejects.toThrow(/capture|source|project/i);
  expect(getterCalls).toBe(0); expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it.each(['second-cursor', 'foreign-runtime', 'phase', 'escaped-factory', 'escaped-cursor'] as const)('capture scope fences %s', async kind => {
  const scoped = api(), source = makeEmissionSource(), h = makeWorkHarness(), other = makeWorkHarness();
  let cursors!: Cursors, cursor!: codec.TargetCursor;
  const run = () => scoped(source.records, h.runtime, async (_records, factory) => {
    cursors = factory; cursor = factory.create(source);
    if (kind === 'second-cursor') factory.create(source);
    if (kind === 'phase') h.runtime.setContext('verify');
    if (kind === 'foreign-runtime' || kind === 'phase') await (kind === 'foreign-runtime' ? other.runtime : h.runtime).run(cursor.next());
    else expect((await h.runtime.run(cursor.next())).done).toBe(false);
  });
  if (kind.startsWith('escaped')) {
    await run();
    if (kind === 'escaped-factory') expect(() => cursors.create(source)).toThrow(/scope|closed|expired/);
    else await expect(h.runtime.run(cursor.next())).rejects.toThrow(/scope|closed|disposed/);
  } else await expect(run()).rejects.toThrow(/scope|runtime|phase|cursor/);
  expect(h.runtime.snapshot().ownedBytes).toBe(0); expect(other.runtime.snapshot().ownedBytes).toBe(0);
});

it.each(['validation', 'projection', 'callback', 'exhausted-plan', 'taken-plan-error', 'taken-plan-cancel'] as const)
('capture scope releases all temporary and provisional plan custody on %s', async at => {
  const scoped = api(), source = makeEmissionSource([makeIncrementalProject(8)]), before = structuredClone(source), h = makeWorkHarness();
  let plan: EmissionPlan | undefined;
  if (at === 'validation') h.observe(() => h.cancel());
  const pending = scoped(source.records, h.runtime, async (_records, cursors) => {
    const cursor = cursors.plan(source);
    if (at === 'projection') h.observe(() => h.cancel());
    if (at === 'callback') { await h.runtime.run(cursor.next()); throw Error('consumer failed'); }
    await collectTarget(cursor, h.runtime);
    if (at.startsWith('taken-plan')) {
      await h.runtime.run(effect(1, () => { plan = cursor.takeEmissionPlan(); if (at === 'taken-plan-cancel') h.cancel(); }));
      throw Error('consumer failed after transfer');
    }
  });
  if (at === 'exhausted-plan') await pending;
  else await expect(pending).rejects.toThrow(/cancel|consumer/);
  expect(h.runtime.snapshot().ownedBytes).toBe(0); expect(source).toEqual(before);
  if (plan) expect(() => openEmissionCursor(plan!, source, 0)).toThrow();
});

it('capture scope still binds an exhausted cursor to its original runtime', async () => {
  const scoped = api(), source = makeEmissionSource(), h = makeWorkHarness(), other = makeWorkHarness();
  await scoped(source.records, h.runtime, async (_records, cursors) => {
    const cursor = cursors.create(source); await collectTarget(cursor, h.runtime);
    await expect(other.runtime.run(cursor.next())).rejects.toThrow(/runtime/);
  });
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it.each(['project-after-record', 'row-after-record', 'after-exhaustion', 'after-transfer', 'membership-after-transfer',
  'records-after-transfer', 'records-getter-after-transfer'] as const)
('capture scope rejects late shallow substitution %s without exporting a replay plan', async at => {
  const scoped = api(), source = makeEmissionSource([makeIncrementalProject(2), { ...makeIncrementalProject(1), id: 'second' }]);
  const h = makeWorkHarness(); let plan: EmissionPlan | undefined, getterCalls = 0;
  const replace = () => {
    const row = source.records.projects[0], changed = { ...structuredClone(row.project), name: 7 } as any;
    if (at.startsWith('records-')) {
      const records = structuredClone(source.records); records.projects[0].project = changed;
      if (at === 'records-after-transfer') source.records = records;
      else Object.defineProperty(source, 'records', { get() { getterCalls++; return records; } });
      return;
    }
    if (at === 'membership-after-transfer') { source.records.projects.push(structuredClone(row)); return; }
    if (at === 'row-after-record') source.records.projects[0] = { ...row, project: changed };
    else row.project = changed;
  };
  await expect(scoped(source.records, h.runtime, async (_records, cursors) => {
    const cursor = cursors.plan(source);
    if (at.endsWith('after-record')) { await h.runtime.run(cursor.next()); replace(); }
    await collectTarget(cursor, h.runtime);
    if (at === 'after-exhaustion') replace();
    await h.runtime.run(effect(1, () => { plan = cursor.takeEmissionPlan(); }));
    if (at.endsWith('after-transfer')) replace();
    cursor.dispose();
  })).rejects.toThrow(/source|capture|project/i);
  expect(h.runtime.snapshot().ownedBytes).toBe(0); expect(getterCalls).toBe(0);
  if (plan) expect(() => openEmissionCursor(plan!, source, 0)).toThrow();
});

it('capture scope checks transfer phase before consuming an exhausted builder', async () => {
  const scoped = api(), source = makeEmissionSource(), h = makeWorkHarness();
  await scoped(source.records, h.runtime, async (_records, cursors) => {
    const cursor = cursors.plan(source); await collectTarget(cursor, h.runtime);
    h.runtime.setContext('verify');
    expect(() => cursor.takeEmissionPlan()).toThrow(/phase/);
    h.runtime.setContext('prepare');
  });
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it('capture scope latches a post-transfer failure even if its consumer restores the phase', async () => {
  const scoped = api(), source = makeEmissionSource(), h = makeWorkHarness(), create = emission.createEmissionBuilder;
  vi.spyOn(emission, 'createEmissionBuilder').mockImplementation(input => {
    const builder = create(input); return { ...builder, finish() {
      const plan = builder.finish(); h.runtime.setContext('verify'); return plan;
    } };
  });
  await expect(scoped(source.records, h.runtime, async (_records, cursors) => {
    const cursor = cursors.plan(source); await collectTarget(cursor, h.runtime);
    expect(() => cursor.takeEmissionPlan()).toThrow(/phase/); h.runtime.setContext('prepare');
  })).rejects.toThrow(/phase/);
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it('capture scope closes escaped interfaces before its cooperative final audit', async () => {
  const scoped = api(), source = makeEmissionSource(), h = makeWorkHarness(); let attempted = false, available = false;
  await scoped(source.records, h.runtime, async (_records, cursors) => {
    const cursor = cursors.plan(source); await collectTarget(cursor, h.runtime);
    await h.runtime.run(effect(1024, () => {}));
    h.observe(() => {
      if (attempted) return; attempted = true;
      try { cursor.takeEmissionPlan(); available = true; } catch { /* Required closed-scope refusal. */ }
    });
  });
  expect(attempted).toBe(true); expect(available).toBe(false); expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it.each(['schema', 'active-variant', 'wrapper', 'sparse', 'depth'] as const)('capture scope rejects malformed %s before consumption', async kind => {
  const scoped = api(), source = makeEmissionSource(), h = makeWorkHarness(), project = source.records.projects[0].project;
  if (kind === 'schema') project.initialState.schemaVersion = 0;
  if (kind === 'active-variant') project.initialState.activeVariantId = 'absent';
  if (kind === 'wrapper') project.name = 9 as any;
  if (kind === 'sparse') project.initialState.variants.default.templates['page-0'].layers = new Array(2);
  if (kind === 'depth') { let deep: object = {}; for (let i = 0; i < 512; i++) deep = { child: deep }; Object.assign(project, { deep }); }
  const consume = vi.fn(async () => {});
  await expect(scoped(source.records, h.runtime, consume)).rejects.toThrow();
  expect(consume).not.toHaveBeenCalled(); expect(h.runtime.snapshot().ownedBytes).toBe(0);
  expect(() => codec.prepareNormalizationTarget(source)).toThrow();
});

it('capture scope never turns an accessor-backed project into unchecked target input', async () => {
  const scoped = api(), source = makeEmissionSource(), h = makeWorkHarness(), row = source.records.projects[0], project = row.project;
  Object.defineProperty(row, 'project', { enumerable: true, configurable: true, get: () => project });
  await scoped(source.records, h.runtime, async (_records, cursors) => {
    const canonical = vi.spyOn(json, 'canonicalBytesWork');
    await collectTarget(cursors.create(source), h.runtime);
    expect(canonical.mock.calls.filter(([value]) => value === project)).toHaveLength(1);
  });
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it('capture scope validates every independent invocation and never retains a prior verdict', async () => {
  const scoped = api(), source = makeEmissionSource(), h = makeWorkHarness(), checked = vi.spyOn(validation, 'checkStoredWorkspaceProjectWork');
  await scoped(source.records, h.runtime, async (_records, cursors) => { await collectTarget(cursors.create(source), h.runtime); });
  source.records.projects[0].project.initialState.activeVariantId = 'absent';
  await expect(scoped(source.records, h.runtime, async () => { throw Error('must not be reached'); })).rejects.not.toThrow('must not be reached');
  expect(checked).toHaveBeenCalledTimes(2); expect(h.runtime.snapshot().ownedBytes).toBe(0);
});
