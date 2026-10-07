// @vitest-environment node
import { Buffer } from 'node:buffer';
import { afterEach, expect, it, vi } from 'vitest';
import { loadStickerPressProject, makeIncrementalProject } from '../../../helpers/incrementalFixtures';
import { historicalState } from '../../../helpers/localWorkspaceFixtures';
import { prepareProjectState, validateWorkspaceProject } from '../../../../services/localWorkspace/validation';
import { assembleState, partitionState } from '../../../../services/document/partition';
import { applyDocumentChanges } from '../../../../services/document/applyChanges';
import { createLayerFoldState, reconcileLayerFolds } from '../../../../services/document/layerFolds';
import { createPartitionedHistory, recordPartitionedEdit, undoPartitioned, redoPartitioned } from '../../../../services/document/partitionedHistory';
import { decomposeProject, reconstructProject } from '../../../../services/localWorkspace/normalized/codec';
import * as schema from '../../../../services/localWorkspace/normalized/schema';
import { createSizeLedger } from '../../../../services/localWorkspace/normalized/sizeLedger';
import * as codecWork from '../../../../services/localWorkspace/normalized/codec';
import { makeWorkHarness } from '../../../helpers/normalizationWorkHarness';
import { frameRecord } from '../../../../services/localWorkspace/normalized/commitProof';
import { effect } from '../../../../shared/cooperativeWork.js';
import { rawValueWeightWork } from '../../../../shared/jsonWork.js';
import * as jsonWork from '../../../../shared/jsonWork.js';
import * as partitionModule from '../../../../services/document/partition';
import * as appStateValidation from '../../../../shared/validateAppState.js';
import * as sizeLedgerModule from '../../../../services/localWorkspace/normalized/sizeLedger';
import * as emissionModule from '../../../../services/localWorkspace/normalized/emissionPlan';
import type { EmissionCursor, EmissionPlan } from '../../../../services/localWorkspace/normalized/emissionPlan';
import { collectTarget, makeEmissionSource } from '../../../helpers/normalizationEmissionFixtures';

it('prepared emission matches untraced finalized records without semantic replay', async () => {
  expect(codecWork.createPlannedTargetCursor).toBeTypeOf('function');
  const source = makeEmissionSource(); const oracle = codecWork.prepareNormalizationTarget(source); const w = makeWorkHarness();
  const prepared = codecWork.createPlannedTargetCursor(source); let plan: EmissionPlan | undefined; let replay: EmissionCursor | undefined;
  try {
    const firstPass = await collectTarget(prepared, w.runtime);
    await w.runtime.run(effect(1, () => { plan = prepared.takeEmissionPlan(); })); prepared.dispose();
    expect(firstPass.map(item => frameRecord(item.store, item.record))).toEqual(oracle.map(item => frameRecord(item.store, item.record)));
    const spies = [vi.spyOn(partitionModule, 'partitionStateWork'), vi.spyOn(appStateValidation, 'validateAppStateWork'),
      vi.spyOn(sizeLedgerModule, 'createSizeLedgerWork')];
    const before = w.runtime.snapshot();
    await w.runtime.run(effect(1, () => { replay = emissionModule.openEmissionCursor(plan!, source, 0); }));
    const actual = await collectTarget(replay!, w.runtime);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(w.runtime.snapshot().hashBytes).toBe(before.hashBytes);
    expect(actual.map(item => frameRecord(item.store, item.record))).toEqual(oracle.map(item => frameRecord(item.store, item.record)));
    expect(actual[0]).toMatchObject({ store: 'projectHeaders', record: { storageRevision: 3,
      commitWindow: { floorRevision: 3, entries: [] }, migrationBaseline: { sourceRevision: 3, sourceUpdatedAt: '2026-09-26T00:00:00.000Z' } } });
  } finally { replay?.dispose(); prepared.dispose(); if (plan) emissionModule.disposeEmissionPlan(plan); }
  expect(w.runtime.snapshot().ownedBytes).toBe(0);
});

it.each(['extensions-and-folds', 'missing-optionals', 'multiple-projects', 'long-identities'] as const)
('prepared emission preserves independent frame bytes and external reconstruction: %s', async kind => {
  const project = makeIncrementalProject(2); const template = project.initialState.variants.default.templates['page-0'];
  if (kind === 'extensions-and-folds') {
    project.name = 'payload-name-sentinel'; project.cloud = { projectId: 'payload-cloud-sentinel', lastSyncedCommitId: 'cloud-commit' };
    Object.assign(project.cloud, { unknown: { svg: '<svg>opaque</svg>' } }); Object.assign(project, { unknownWrapper: { z: 1, a: '\ud800😀' } });
    Object.assign(project.initialState, { unknownState: { script: 'state-payload-sentinel' } });
    Object.assign(project.initialState.variants.default, { unknownVariant: [2, 1] });
    template.layers = [{ id: 'dup', collapsed: true }, { collapsed: { body: 'raw-fold-sentinel' }, id: 'dup' },
      { id: 42, collapsed: null }, { id: 'unique', collapsed: false }, { id: 'absent' }] as any;
    Object.defineProperty(template.layers![0], '__proto__', { value: { retained: true }, enumerable: true });
  } else if (kind === 'missing-optionals') {
    delete project.cloud; delete project.revision; delete project.initialState.generator; delete template.layers;
    delete project.initialState.selectedNodeId; delete project.initialState.scale;
  } else if (kind === 'long-identities') project.id = 'scope根'.repeat(70);
  const second = { ...makeIncrementalProject(1), id: 'second' };
  const source = makeEmissionSource(kind === 'multiple-projects' ? [project, second] : [project]);
  if (kind === 'multiple-projects') source.sourceProjects.reverse();
  const before = structuredClone(source); const oracle = codecWork.prepareNormalizationTarget(source);
  const w = makeWorkHarness(); const prepared = codecWork.createPlannedTargetCursor(source);
  let plan: EmissionPlan | undefined; let replay: EmissionCursor | undefined;
  const literals: unknown[] = []; const create = emissionModule.createEmissionBuilder;
  const spy = vi.spyOn(emissionModule, 'createEmissionBuilder').mockImplementation(input => {
    const builder = create(input); const literal = builder.literal;
    builder.literal = value => { literals.push(value); return literal(value); }; return builder;
  });
  try {
    await collectTarget(prepared, w.runtime); await w.runtime.run(effect(1, () => { plan = prepared.takeEmissionPlan(); })); prepared.dispose();
    replay = emissionModule.openEmissionCursor(plan!, source, 0); const records = await collectTarget(replay, w.runtime);
    expect(records.map(item => [item.store, item.record.key, Buffer.byteLength(frameRecord(item.store, item.record))]))
      .toEqual(oracle.map(item => [item.store, item.record.key, Buffer.byteLength(frameRecord(item.store, item.record))]));
    expect(records.map(item => frameRecord(item.store, item.record))).toEqual(oracle.map(item => frameRecord(item.store, item.record)));
    for (const row of source.records.projects) {
      const image = { scope: { storageGeneration: `normalized:${source.sourceDigest}`, projectId: row.id, incarnation: row.incarnation },
        ...Object.fromEntries(schema.NORMALIZED_STORE_NAMES.map(store => [store, new Map()])) } as schema.NormalizedProject;
      for (const item of records) if (item.record.key[1] === row.id) image[item.store].set(JSON.stringify(item.record.key), item.record as never);
      const external = codecWork.reconstructProject(image);
      expect(external).toStrictEqual(row.project);
      // Existing fold assembly appends collapsed; preserve its established export
      // order as well as all original values, rather than changing that policy here.
      const untraced = codecWork.reconstructProject(codecWork.decomposeProject(row.project, image.scope));
      expect(JSON.stringify(external)).toBe(JSON.stringify(untraced));
    }
    for (const sentinel of ['payload-name-sentinel', 'payload-cloud-sentinel', 'state-payload-sentinel', 'raw-fold-sentinel']) expect(literals).not.toContain(sentinel);
    if (project.initialState.generator) {
      expect(literals).not.toContain(project.initialState.generator.templateScript);
      expect(literals).not.toContain(project.initialState.generator.hierarchyScript);
    }
    expect(source).toEqual(before);
  } finally { spy.mockRestore(); replay?.dispose(); prepared.dispose(); if (plan) emissionModule.disposeEmissionPlan(plan); }
  expect(w.runtime.snapshot().ownedBytes).toBe(0);
});

it('prepared emission holds metadata rather than an extra payload graph after exhaustion', async () => {
  const held: number[] = [];
  for (const length of [1, 30000]) {
    const project = makeIncrementalProject(1); Object.assign(project, { retained: { body: 'x'.repeat(length) } });
    const source = makeEmissionSource([project]); const w = makeWorkHarness(); const cursor = codecWork.createPlannedTargetCursor(source);
    let plan: EmissionPlan | undefined;
    try {
      for (;;) { if ((await w.runtime.run(cursor.next())).done) break; }
      await w.runtime.run(effect(1, () => { plan = cursor.takeEmissionPlan(); })); cursor.dispose();
      held.push(w.runtime.snapshot().ownedBytes);
    } finally { cursor.dispose(); if (plan) emissionModule.disposeEmissionPlan(plan); }
    expect(w.runtime.snapshot().ownedBytes).toBe(0);
  }
  expect(held[0]).toBeGreaterThan(0); expect(held[1]).toBe(held[0]);
});

it.each(['early', 'abandon-exhausted', 'transferred'] as const)('prepared emission enforces %s ownership handoff', async kind => {
  const source = makeEmissionSource(); const w = makeWorkHarness(); const cursor = codecWork.createPlannedTargetCursor(source);
  let plan: EmissionPlan | undefined; let replay: EmissionCursor | undefined;
  try {
    if (kind === 'early') expect(() => cursor.takeEmissionPlan()).toThrow();
    await collectTarget(cursor, w.runtime);
    if (kind === 'abandon-exhausted') { cursor.dispose(); expect(w.runtime.snapshot().ownedBytes).toBe(0); return; }
    await w.runtime.run(effect(1, () => { plan = cursor.takeEmissionPlan(); }));
    expect(() => cursor.takeEmissionPlan()).toThrow(); cursor.dispose();
    replay = emissionModule.openEmissionCursor(plan!, source, 0); expect((await w.runtime.run(replay.next())).done).toBe(false);
  } finally { replay?.dispose(); cursor.dispose(); if (plan) emissionModule.disposeEmissionPlan(plan); }
  expect(w.runtime.snapshot().ownedBytes).toBe(0);
});

it.each(['yield', 'first-record'] as const)('prepared emission cancellation at %s releases builder, indexes and current image', async at => {
  const source = makeEmissionSource(); const before = structuredClone(source); const w = makeWorkHarness(); const cursor = codecWork.createPlannedTargetCursor(source);
  try {
    if (at === 'first-record') { expect((await w.runtime.run(cursor.next())).done).toBe(false); await w.runtime.run(effect(1024, () => {})); }
    w.observe(() => w.cancel());
    await expect(w.runtime.run(cursor.next())).rejects.toMatchObject({ name: 'AbortError' });
  } finally { cursor.dispose(); }
  expect(w.runtime.snapshot().ownedBytes).toBe(0); expect(source).toEqual(before);
});

it('prepared emission retains the untraced codec refusal of invalid sparse external JSON', async () => {
  const source = makeEmissionSource(); source.records.projects[0].project.initialState.variants.default.templates['page-0'].layers = new Array(2);
  expect(() => codecWork.prepareNormalizationTarget(source)).toThrow(/sparse|dense/);
  const w = makeWorkHarness(); const cursor = codecWork.createPlannedTargetCursor(source);
  try { await expect(collectTarget(cursor, w.runtime)).rejects.toThrow(/sparse|dense/); }
  finally { cursor.dispose(); }
  expect(w.runtime.snapshot().ownedBytes).toBe(0);
});

it('codec validation does not emit discarded canonical string frames', async () => {
  const project = makeIncrementalProject(1); const h = makeWorkHarness();
  const emit = vi.spyOn(jsonWork, 'canonicalWork');
  try {
    const image = await h.runtime.run(codecWork.decomposeProjectWork(project, { storageGeneration: 'g', projectId: project.id, incarnation: 'i' }));
    expect(reconstructProject(image)).toEqual(project);
    expect(emit.mock.calls.length).toBe(0);
  } finally { emit.mockRestore(); }
});

it('checks physical encoded sizes using its own complete JSON inspection instead of rescanning values', async () => {
  const project = makeIncrementalProject(2), records = decomposeProject(project, { storageGeneration: 'g', projectId: project.id, incarnation: 'i' });
  const values = new Set<unknown>();
  for (const store of schema.NORMALIZED_STORE_NAMES) if (store !== 'normalizationLedger') for (const record of records[store].values()) values.add(record.value);
  values.add([...records.projectHeaders.values()][0].document);
  const h = makeWorkHarness(), count = vi.spyOn(jsonWork, 'plainJsonBytesWork');
  await h.runtime.run(codecWork.validateRecordsWork(records));
  expect(count.mock.calls.filter(([value]) => values.has(value))).toHaveLength(0);
  const record = [...records.projectTemplates.values()][0]; record.encodedSize.valueBytes++;
  await expect(h.runtime.run(codecWork.validateRecordsWork(records))).rejects.toThrow('encoded contribution');
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it.each(['absent', 'empty', 'no-fold', 'boolean', 'only-fold', 'raw', 'mixed'] as const)
('derives %s template overlay bytes without rescanning unchanged template content', async kind => {
  const project = makeIncrementalProject(1), original = project.initialState.variants.default.templates['page-0'];
  if (kind === 'absent') delete original.layers;
  if (kind === 'empty') original.layers = [];
  if (kind === 'no-fold') original.layers = [{ id: 'a', name: 'Layer' }] as any;
  if (kind === 'boolean') original.layers = [{ id: 'a', collapsed: false }, { id: 'b', collapsed: true }] as any;
  if (kind === 'only-fold') original.layers = [{ collapsed: true }, { collapsed: { opaque: '根😀' } }] as any;
  if (kind === 'raw') original.layers = [{ id: 'dup', collapsed: null }, { id: 'dup', collapsed: { text: '\ud800\\"\n', list: [1, true] } }] as any;
  if (kind === 'mixed') original.layers = [null, 7, ['raw'], { id: 9, collapsed: 'raw', extra: { kept: true } }, {}] as any;
  const before = structuredClone(project), h = makeWorkHarness(), bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
  const counter = vi.spyOn(jsonWork, 'plainJsonBytesWork');
  const image = await h.runtime.run(codecWork.decomposeProjectWork(project, { storageGeneration: 'g', projectId: project.id, incarnation: 'i' }));
  const record = [...image.projectTemplates.values()].find(row => row.key[4] === 'page-0')!;
  const preferences = [...image.projectPreferences.values()][0];
  expect(record.encodedSize.valueBytes).toBe(bytes(record.value));
  expect(preferences.encodedSize.templateOverlayBytes[JSON.stringify(['default', 'page-0'])] ?? 0).toBe(bytes(original) - bytes(record.value));
  expect(counter.mock.calls.filter(([value]) => value === original)).toHaveLength(kind === 'absent' ? 1 : 0);
  expect(reconstructProject(image)).toEqual(project); expect(project).toEqual(before); expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it('cooperatively traverses codec while preserving external order', async () => {
  expect(codecWork.decomposeProjectWork).toBeTypeOf('function');
  expect(codecWork.reconstructProjectWork).toBeTypeOf('function');
  expect(codecWork.createTargetCursor).toBeTypeOf('function');
  const project = makeIncrementalProject(80);
  Object.assign(project, { retainedWrapper: { z: 1, a: '😀'.repeat(20000) } });
  const scope = { storageGeneration: 'g', projectId: project.id, incarnation: 'i' };
  const h = makeWorkHarness();
  const image = await h.runtime.run(codecWork.decomposeProjectWork(project, scope));
  expect(image).toEqual(decomposeProject(project, scope));
  expect(JSON.stringify(await h.runtime.run(codecWork.reconstructProjectWork(image)))).toBe(JSON.stringify(project));
  expect(h.runtime.snapshot().yields).toBeGreaterThan(0);
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

function cursorSource() {
  const project = makeIncrementalProject(80);
  Object.assign(project, { retainedWrapper: { z: 1, a: '😀'.repeat(20000) } });
  const source: any = { sourceDigest: 'a'.repeat(64), records: { projects: [project, { ...project, id: 'second' }].map(p => ({
    id: p.id, project: p, incarnation: 'i', storageRevision: 4, updatedAt: '2026-09-20T00:00:00.000Z',
  })) }, sourceProjects: [project.id, 'second'].map(projectId => ({ projectId, digest: 'b'.repeat(64) })) };
  return source;
}

it('cooperatively streams ordered project-at-a-time migration targets', async () => {
  const source = cursorSource(); const h = makeWorkHarness();
  const expected = codecWork.prepareNormalizationTarget(source);
  const cursor = codecWork.createTargetCursor(source); const actual = [];
  try {
    for (;;) {
      const next = await h.runtime.run(cursor.next());
      if (next.done) break;
      actual.push(next.value);
    }
  } finally { cursor.dispose(); }
  expect(actual.map(item => frameRecord(item.store, item.record))).toEqual(expected.map(item => frameRecord(item.store, item.record)));
  expect(actual.length).toBeGreaterThan(64);
  expect(actual[0]).toMatchObject({ store: 'projectHeaders', record: { storageRevision: 4,
    commitWindow: { floorRevision: 4, entries: [] }, migrationBaseline: { sourceRevision: 4, projectId: source.sourceProjects[0].projectId } } });
  expect(h.runtime.snapshot().yields).toBeGreaterThan(0);
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it('cooperative codec retains raw folds, deep extensions and uncapped external IDs', async () => {
  const project = makeIncrementalProject(1); project.id = '根😀'.repeat(3000);
  const template = project.initialState.variants.default.templates['page-0'];
  template.layers = [{ id: 'dup', collapsed: true }, { id: 'dup', collapsed: 'raw' },
    { id: 42, collapsed: null }, { id: 'absent' }] as any;
  let deep: object = {}; for (let index = 0; index < 500; index++) deep = { next: deep };
  Object.assign(project, { deep });
  const scope = { storageGeneration: 'g', projectId: project.id, incarnation: 'i' };
  const h = makeWorkHarness();
  const image = await h.runtime.run(codecWork.decomposeProjectWork(project, scope));
  expect(image).toEqual(decomposeProject(project, scope));
  expect(JSON.stringify(await h.runtime.run(codecWork.reconstructProjectWork(image)))).toBe(JSON.stringify(project));
});

it('cancels cooperative codec and malformed evidence scans without changing input', async () => {
  const project = makeIncrementalProject(80); const original = structuredClone(project);
  const scope = { storageGeneration: 'g', projectId: project.id, incarnation: 'i' };
  const image = decomposeProject(project, scope);
  for (const program of [codecWork.decomposeProjectWork(project, scope), codecWork.validateRecordsWork(image), codecWork.reconstructProjectWork(image)]) {
    const h = makeWorkHarness(); h.observe(() => h.cancel());
    await expect(h.runtime.run<unknown>(program)).rejects.toMatchObject({ name: 'AbortError' });
    expect(h.runtime.snapshot().visits).toBeLessThanOrEqual(1024);
  }
  expect(project).toEqual(original);
  image.projectHeaders.values().next().value!.order.nodes = new Array(5000).fill('duplicate');
  const h = makeWorkHarness(); h.observe(() => h.cancel());
  await expect(h.runtime.run(codecWork.validateRecordsWork(image))).rejects.toMatchObject({ name: 'AbortError' });
});

it('disposes cursor during a cooperative yield before exposing any record', async () => {
  const source = cursorSource(); const h = makeWorkHarness(); const cursor = codecWork.createTargetCursor(source);
  h.observe(() => cursor.dispose());
  await expect(h.runtime.run(cursor.next())).rejects.toThrow(/disposed/);
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it('owns cursor images across next calls and releases on explicit disposal', async () => {
  const source = cursorSource(); const h = makeWorkHarness(); const cursor = codecWork.createTargetCursor(source);
  const first = await h.runtime.run(cursor.next());
  if (first.done === true) throw new Error('Expected first project header');
  expect(h.runtime.snapshot().ownedBytes).toBeGreaterThan(0);
  const image = decomposeProject(source.records.projects[0].project, { storageGeneration: `normalized:${source.sourceDigest}`,
    projectId: source.records.projects[0].id, incarnation: 'i' });
  Object.assign(image.projectHeaders.values().next().value!, first.value.record);
  const imageBytes = (await h.runtime.run(rawValueWeightWork(image))).bytes;
  const indexBytes = source.records.projects.reduce((sum: number, row: any) => sum + 16 + new TextEncoder().encode(row.id).length, 0);
  expect(h.runtime.snapshot().ownedBytes).toBe(imageBytes + indexBytes);
  cursor.dispose(); cursor.dispose();
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
  await expect(h.runtime.run(cursor.next())).rejects.toThrow(/disposed/);
});

it('charges record emission so cancellation can stop an already decomposed project', async () => {
  const source = cursorSource(); const h = makeWorkHarness(); const cursor = codecWork.createTargetCursor(source);
  await h.runtime.run(cursor.next());
  await h.runtime.run(effect(1024, () => {}));
  h.observe(() => h.cancel());
  await expect(h.runtime.run(cursor.next())).rejects.toMatchObject({ name: 'AbortError' });
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it('initializes private durable counters and null timestamp without changing public revision', () => {
  const project = makeIncrementalProject(); project.revision = 17;
  const records = decomposeProject(project, { storageGeneration: 'g', projectId: project.id, incarnation: 'i' });
  const header = records.projectHeaders.values().next().value!;
  const prefs = records.projectPreferences.values().next().value!;
  const ledger = createSizeLedger(records);
  expect(header).toMatchObject({ updatedAt: null, foldStructureGeneration: 0, commitProof: null,
    commitWindow: { floorRevision: 0, entries: [] }, counters: { documentBytes: ledger.documentBytes,
      projectBaseBytes: ledger.projectBytes - ledger.preferenceBytes, nodeCount: ledger.nodeCount,
      variantCount: ledger.variantCount, elementCount: ledger.elementCount } });
  expect(prefs).toMatchObject({ preferenceBytes: ledger.preferenceBytes, commitProof: null,
    commitWindow: { floorRevision: 0, entries: [] } });
  expect(reconstructProject(records)).toStrictEqual(project);
});

function migrationImage() {
  const project = makeIncrementalProject(); project.revision = 23;
  const records = decomposeProject(project, { storageGeneration: 'generation', projectId: project.id, incarnation: 'incarnation' });
  const header = records.projectHeaders.values().next().value!;
  header.storageRevision = 17; header.updatedAt = '2026-09-16T08:00:00.000Z';
  header.commitWindow = { floorRevision: 17, entries: [] };
  header.migrationBaseline = { migrationId: schema.NORMALIZATION_LEDGER_ID, attemptId: 'attempt', storageGeneration: 'generation',
    sourceDigest: 'a'.repeat(64), projectDigest: 'b'.repeat(64), projectId: project.id, incarnation: 'incarnation',
    sourceRevision: 17, sourceUpdatedAt: header.updatedAt };
  return { project, records, header };
}

it('preserves explicit migration lineage without consuming public revision or fabricating a commit', () => {
  const { project, records, header } = migrationImage();
  expect(reconstructProject(records)).toEqual(project);
  expect(header).toMatchObject({ storageRevision: 17, commitProof: null, lastCommitId: null,
    foldStructureGeneration: 0, commitWindow: { floorRevision: 17, entries: [] } });
  expect(records.projectPreferences.values().next().value).toMatchObject({ revision: 0, commitProof: null });
});

it.each([
  ['missing baseline', (h: schema.ProjectHeader) => { delete h.migrationBaseline; }],
  ['source revision mismatch', (h: schema.ProjectHeader) => { h.migrationBaseline!.sourceRevision = 16; }],
  ['source timestamp mismatch', (h: schema.ProjectHeader) => { h.migrationBaseline!.sourceUpdatedAt = '2026-09-16T09:00:00.000Z'; }],
  ['scope mismatch', (h: schema.ProjectHeader) => { h.migrationBaseline!.storageGeneration = 'other'; }],
  ['project mismatch', (h: schema.ProjectHeader) => { h.migrationBaseline!.projectId = 'other'; }],
  ['incarnation mismatch', (h: schema.ProjectHeader) => { h.migrationBaseline!.incarnation = 'other'; }],
  ['unknown fields', (h: schema.ProjectHeader) => { Object.assign(h.migrationBaseline!, { authority: true }); }],
  ['invalid digest', (h: schema.ProjectHeader) => { h.migrationBaseline!.projectDigest = 'guessed'; }],
  ['noncanonical timestamp', (h: schema.ProjectHeader) => { h.migrationBaseline!.sourceUpdatedAt = '2026-09-16'; }],
  ['invalid generation', (h: schema.ProjectHeader) => { h.foldStructureGeneration = 1; }],
  ['fabricated commit ID', (h: schema.ProjectHeader) => { h.lastCommitId = 'synthetic'; }],
  ['advanced revision without proof', (h: schema.ProjectHeader) => { h.storageRevision = 18; h.commitWindow.floorRevision = 18; }],
] as const)('rejects malformed migration baseline: %s', (_name, corrupt) => {
  const { records, header } = migrationImage(); corrupt(header);
  expect(() => reconstructProject(records)).toThrow();
});

it('does not impose a new private-ID byte cap on retained source project IDs', () => {
  const { project, header } = migrationImage();
  project.id = 'source-id-'.repeat(40);
  const records = decomposeProject(project, { storageGeneration: 'generation', projectId: project.id, incarnation: 'incarnation' });
  Object.assign(records.projectHeaders.values().next().value!, {
    storageRevision: header.storageRevision, updatedAt: header.updatedAt, commitWindow: header.commitWindow,
    migrationBaseline: { ...header.migrationBaseline!, projectId: project.id },
  });
  expect(reconstructProject(records)).toEqual(project);
});

const scopeOf = (project = makeIncrementalProject()) => ({ storageGeneration: 'g1', projectId: project.id, incarnation: 'i1' });
const normalize = () => { const project = makeIncrementalProject(); return decomposeProject(project, scopeOf(project)); };
const first = (map: Map<string, any>): any => map.values().next().value;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

it.each(['initial-present', 'initial-undefined', 'missing', 'undefined', 'null', 'uppercase', 'short', 'unknown', 'valid'] as const)
('I3 strict private fold digest envelope: %s', kind => {
  const records = normalize(); const prefs = first(records.projectPreferences);
  const initial = kind.startsWith('initial');
  if (!initial) { prefs.revision = 1; prefs.lastCommitId = 'fixture'; fixtureLineage(records, 'preferences'); }
  if (kind === 'missing') delete prefs.foldRecordDigest;
  else if (kind === 'undefined' || kind === 'initial-undefined') prefs.foldRecordDigest = undefined;
  else if (kind === 'null') prefs.foldRecordDigest = null;
  else if (kind === 'uppercase') prefs.foldRecordDigest = 'B'.repeat(64);
  else if (kind === 'short') prefs.foldRecordDigest = 'b'.repeat(63);
  else if (kind === 'unknown') prefs.foldRecordDigests = 'b'.repeat(64);
  else prefs.foldRecordDigest = 'b'.repeat(64);
  if (kind !== 'valid') expect(() => reconstructProject(records)).toThrow();
  else {
    expect(reconstructProject(records)).toEqual(makeIncrementalProject());
    expect(createSizeLedger(records)).toEqual(createSizeLedger(normalize()));
    expect(JSON.stringify(reconstructProject(records))).not.toContain('foldRecordDigest');
  }
});
// Codec fixtures describe admitted lineage shape, not a durability/hash oracle.
function fixtureLineage(records: schema.NormalizedProject, lane: 'document' | 'preferences') {
  const header = first(records.projectHeaders); const preferences = first(records.projectPreferences);
  const record = lane === 'document' ? header : preferences;
  const revision = lane === 'document' ? header.storageRevision : preferences.revision;
  const after = { documentRevision: header.storageRevision, preferenceRevision: preferences.revision, foldStructureGeneration: 0 };
  if (revision) {
    record.commitProof = { identity: { clientId: 'fixture', commitId: record.lastCommitId, commitGeneration: revision, editorGeneration: revision, lane },
      before: { ...after, [lane === 'document' ? 'documentRevision' : 'preferenceRevision']: revision - 1 }, after,
      requestDigest: 'a'.repeat(64), manifestDigest: 'a'.repeat(64), headerCoreDigest: 'a'.repeat(64), preferenceCoreDigest: 'a'.repeat(64) };
    record.commitWindow = { floorRevision: revision, entries: [] };
    if (lane === 'document') header.updatedAt = '2026-09-14T12:00:00.000Z';
    else preferences.foldRecordDigest = 'b'.repeat(64);
  }
  if (lane === 'preferences') preferences.preferenceBytes = createSizeLedger(records).preferenceBytes;
}
const nestedExtension = (depth: number): object => {
  let value = {};
  for (let level = 1; level < depth; level++) value = { child: value };
  return value;
};
it.each([
  ['counter', (h: any) => { h.counters.nodeCount = -1; }],
  ['timestamp', (h: any) => { h.updatedAt = 'yesterday'; }],
  ['generation', (h: any) => { h.foldStructureGeneration = 1.5; }],
  ['window gap', (h: any) => { h.commitWindow.floorRevision = 2; }],
  ['counter mismatch', (h: any) => { h.counters.documentBytes++; }],
])('rejects malformed private %s', (_name, corrupt) => {
  const records = normalize(); corrupt(first(records.projectHeaders));
  expect(() => reconstructProject(records)).toThrow();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('keeps source, cloud linkage, extensions, and array order', () => {
  const project = makeIncrementalProject(2);
  project.retained = { text: 'Café ☕', empty: [] };
  project.cloud = { projectId: 'cloud', lastSyncedCommitId: 'commit' };
  project.revision = 7;
  project.importProvenance = { source: 'gallery', revisions: ['b', 'a'] };
  const scope = { storageGeneration: 'g1', projectId: project.id, incarnation: 'i1' };
  expect(reconstructProject(decomposeProject(project, scope))).toEqual(project);
});

it.each(Array.from({ length: 12 }, (_, version) => version))('round-trips strictly migrated historical v%s', version => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const project = { id: 'historical', name: '', initialState: prepareProjectState(historicalState(version), { warningPolicy: 'reject' }).state };
  const before = structuredClone(project);
  expect(reconstructProject(decomposeProject(project, scopeOf(project)))).toStrictEqual(project);
  expect(project).toStrictEqual(before);
});

it('round-trips actual pinned Sticker Press including both source scripts', { timeout: 30_000 }, () => {
  const project = loadStickerPressProject();
  const records = decomposeProject(project, scopeOf(project));
  expect(first(records.projectSources).value).toStrictEqual(project.initialState.generator);
  expect(reconstructProject(records)).toStrictEqual(project);
});

it('pins additive v3 stores and exact generation/incarnation keys', () => {
  expect(schema.NORMALIZED_DB_VERSION).toBe(3);
  expect(schema.NORMALIZATION_LEDGER_ID).toBe('incremental-local-persistence-v3');
  expect(schema.NORMALIZED_STORE_NAMES).toEqual(['projectHeaders', 'projectNodes', 'projectVariants', 'projectTemplates',
    'projectSources', 'projectExtensions', 'projectPreferences', 'normalizationLedger']);
  const records = normalize(); const scope = records.scope;
  expect(first(records.projectHeaders).key).toEqual(['g1', scope.projectId]);
  expect(first(records.projectHeaders).incarnation).toBe('i1');
  expect(first(records.projectNodes).key).toEqual(['g1', scope.projectId, 'i1', 'root']);
  expect(first(records.projectVariants).key).toEqual(['g1', scope.projectId, 'i1', 'default']);
  expect(first(records.projectTemplates).key).toEqual(['g1', scope.projectId, 'i1', 'default', 'page-0']);
  expect(first(records.projectSources).key).toEqual(['g1', scope.projectId, 'i1']);
  expect(first(records.projectPreferences).key).toEqual(['g1', scope.projectId, 'i1']);
  expect(records.normalizationLedger.size).toBe(0); // Pure codec cannot grant migration authority.
});

it('keeps large wrapper/state/cloud/variant extensions out of small headers', () => {
  const project = makeIncrementalProject(); const large = 'Café ☕'.repeat(10_000);
  project.retained = { large };
  Object.assign(project.initialState, { retained: { large } });
  Object.assign(project.initialState.variants.default, { retained: { large } });
  project.cloud = { projectId: 'cloud', lastSyncedCommitId: 'commit', retained: { large } } as any;
  const records = decomposeProject(project, scopeOf(project));
  expect(JSON.stringify(first(records.projectHeaders)).length).toBeLessThan(2_500);
  expect(JSON.stringify(first(records.projectVariants)).length).toBeLessThan(1_000);
  expect([...records.projectExtensions.values()].some((r: any) => r.value.retained?.large === large)).toBe(true);
  expect(reconstructProject(records)).toStrictEqual(project);
});

it.each([511, 512])('round-trips an existing-validator-accepted external depth-%s wrapper extension', depth => {
  const project = makeIncrementalProject(); project.retained = nestedExtension(depth);
  const validated = validateWorkspaceProject(project, { warningPolicy: 'reject' });
  const records = decomposeProject(validated, scopeOf(validated));
  expect(reconstructProject(records)).toStrictEqual(validated);
});

it('rejects true external depth-513 at existing validation, ingress and reconstruction', () => {
  const project = makeIncrementalProject(); project.retained = nestedExtension(513);
  expect(() => validateWorkspaceProject(project, { warningPolicy: 'reject' })).toThrow(/nesting exceeds 512/);
  expect(() => decomposeProject(project, scopeOf(project))).toThrow(/nesting exceeds 512/);
  const records = normalize(); const wrapper = first(records.projectExtensions);
  wrapper.value.retained = project.retained;
  wrapper.encodedSize.valueBytes = bytes(wrapper.value);
  first(records.projectHeaders).order.wrapper.push('retained');
  expect(() => reconstructProject(records)).toThrow(/nesting exceeds 512/);
});

it('rejects externally over-depth state extensions even when isolated payload depth is valid', () => {
  const records = normalize();
  const extension = [...records.projectExtensions.values()].find(record => record.key[3] === 'state')!;
  extension.value.retained = nestedExtension(512);
  extension.encodedSize.valueBytes = bytes(extension.value);
  first(records.projectHeaders).order.state.push('retained');
  const project = makeIncrementalProject(); Object.assign(project.initialState, extension.value);
  expect(() => validateWorkspaceProject(project, { warningPolicy: 'reject' })).toThrow(/nesting exceeds 512/);
  expect(() => reconstructProject(records)).toThrow(/nesting exceeds 512/);
});

const jsonCorruptions = [
  ['cycle', (target: any, key: string) => { target[key] = target; }, /cycles/],
  ['custom prototype', (target: any) => { Object.setPrototypeOf(target, { inherited: true }); }, /prototype|record fields/],
  ['non-enumerable field', (target: any, key: string) => { Object.defineProperty(target, key, { enumerable: false }); }, /non-enumerable|record fields/],
  ['symbol field', (target: any) => { target[Symbol('hidden')] = true; }, /symbol|record fields/],
  ['undefined', (target: any, key: string) => { target[key] = undefined; }, /undefined/],
  ['bigint', (target: any, key: string) => { target[key] = 1n; }, /bigint/],
  ['function', (target: any, key: string) => { target[key] = () => null; }, /function/],
  ['symbol value', (target: any, key: string) => { target[key] = Symbol('value'); }, /symbol/],
  ['NaN', (target: any, key: string) => { target[key] = NaN; }, /finite/],
  ['infinity', (target: any, key: string) => { target[key] = Infinity; }, /finite/],
  ['sparse array', (target: any, key: string) => { target[key] = new Array(2); }, /dense|sparse/],
] as const;

for (const location of ['envelope', 'payload'] as const) {
  it.each(jsonCorruptions)(`rejects ${location} %s before JSON byte accounting can hide corruption`, (_name, corrupt, message) => {
    const project = makeIncrementalProject(); project.retained = {};
    const records = decomposeProject(project, scopeOf(project)); const wrapper = first(records.projectExtensions);
    corrupt(location === 'envelope' ? wrapper : wrapper.value, location === 'envelope' ? 'value' : 'retained');
    expect(() => reconstructProject(records)).toThrow(message);
  });
}

it.each(['envelope value', 'envelope metadata', 'payload', 'nested payload', 'array payload'])
('rejects %s accessors without invoking them', location => {
  const project = makeIncrementalProject(); project.retained = { nested: [true] };
  const records = decomposeProject(project, scopeOf(project)); const wrapper = first(records.projectExtensions);
  const [target, key] = location === 'envelope value' ? [wrapper, 'value']
    : location === 'envelope metadata' ? [wrapper, 'encodedSize']
    : location === 'payload' ? [wrapper.value, 'retained']
    : location === 'nested payload' ? [wrapper.value.retained, 'nested'] : [wrapper.value.retained.nested, '0'];
  const original = target[key]; const getter = vi.fn(() => original);
  Object.defineProperty(target, key, { enumerable: true, get: getter });
  expect(() => reconstructProject(records)).toThrow(/getters|accessors|record fields/);
  expect(getter).not.toHaveBeenCalled();
});

it('preserves numeric-like keys, delimiter-like keys and duplicate payload IDs across variants', () => {
  const project = makeIncrementalProject(); const state = project.initialState;
  const base = state.variants.default;
  state.variants = Object.fromEntries(['10', '2', '__proto__', '["x", "y"]'].map(id => [id, {
    ...base, id: 'same-payload-id', templates: Object.fromEntries(['10', '2', 'z', 'a'].map(key => [key, {
      ...base.templates['page-0'], id: 'same-template-id', elements: [...base.templates['page-0'].elements].reverse(),
    }])),
  }]));
  state.activeVariantId = '2';
  const records = decomposeProject(project, scopeOf(project));
  expect(records.projectTemplates.size).toBe(16);
  const result = reconstructProject(records);
  expect(result).toStrictEqual(project);
  expect(Object.keys(result.initialState.variants)).toEqual(Object.keys(state.variants));
  expect(Object.keys(result.initialState.variants['2'].templates)).toEqual(['2', '10', 'z', 'a']);
});

it('keeps variant membership order independent of template content edits', () => {
  const project = makeIncrementalProject(); const before = decomposeProject(project, scopeOf(project));
  project.initialState.variants.default.templates['page-0'].name = 'Changed';
  const after = decomposeProject(project, scopeOf(project));
  expect(after.projectVariants).toEqual(before.projectVariants);
  expect(first(after.projectVariants).templateOrder).toEqual(['page-0', 'page-1']);
  const { 'page-0': zero, 'page-1': one } = project.initialState.variants.default.templates;
  project.initialState.variants.default.templates = { 'page-1': one, 'page-0': zero };
  expect(first(decomposeProject(project, scopeOf(project)).projectVariants).templateOrder).toEqual(['page-1', 'page-0']);
});

it('preserves missing optional fields without manufacturing defaults', () => {
  const project = makeIncrementalProject();
  delete project.initialState.generator; delete project.initialState.activeLayerId;
  delete project.initialState.variants.default.templates['page-0'].layers;
  const records = decomposeProject(project, scopeOf(project));
  expect(records.projectSources.size).toBe(0);
  const result = reconstructProject(records);
  expect(result).toStrictEqual(project);
  for (const field of ['cloud', 'revision']) expect(Object.hasOwn(result, field)).toBe(false);
  expect(Object.hasOwn(result.initialState, 'generator')).toBe(false);
});

it('stores boolean folds separately and raw duplicate/non-string positional exceptions losslessly', () => {
  const project = makeIncrementalProject();
  const template = project.initialState.variants.default.templates['page-0'];
  const layer = template.layers![0];
  template.layers = [{ ...layer, id: 'normal', collapsed: false }, { ...layer, id: 'dup', collapsed: true },
    { ...layer, id: 'dup' }, { ...layer, id: 12, collapsed: { raw: ['☕'] } },
    { ...layer, id: 'raw', collapsed: null }] as any;
  const records = decomposeProject(project, scopeOf(project));
  expect(first(records.projectTemplates).value.layers.every((l: object) => !Object.hasOwn(l, 'collapsed'))).toBe(true);
  expect(first(records.projectPreferences).value.layerCollapsed).toEqual({ '["default","page-0","normal"]': false });
  expect(reconstructProject(records)).toStrictEqual(project);
});

it('round-trips current reconciled folds after reorder and undo/redo, never history cells', () => {
  const project = makeIncrementalProject();
  const template = project.initialState.variants.default.templates['page-0']; const layer = template.layers![0];
  template.layers = [{ ...layer, id: 'dup', collapsed: 'legacy' }, { ...layer, id: 'dup' },
    { ...layer, id: 'normal', collapsed: false }] as any;
  const start = createLayerFoldState(partitionState(project.initialState));
  const document = start.parts.document; const stripped = document.variants.default.templates['page-0'];
  const edit = applyDocumentChanges(document, [{ type: 'put-template', variantId: 'default', template: {
    ...stripped, layers: [stripped.layers![1], stripped.layers![2], stripped.layers![0]],
  } }]);
  const at = (position: number) => ({ variantId: 'default', templateId: 'page-0', position });
  const reconciled = reconcileLayerFolds(start, edit, { before: document, after: edit.after, mappings: [
    { type: 'continue', from: at(0), to: at(2) }, { type: 'continue', from: at(1), to: at(0) },
    { type: 'continue', from: at(2), to: at(1) },
  ] });
  const history = recordPartitionedEdit(createPartitionedHistory(), reconciled);
  const undone = undoPartitioned(history, reconciled.after);
  const redone = redoPartitioned(undone.history, undone.state);
  for (const state of [reconciled.after, undone.state, redone.state]) {
    const external = { ...project, initialState: assembleState(state.parts) };
    const records = decomposeProject(external, scopeOf(project));
    expect(reconstructProject(records)).toStrictEqual(external);
    expect(JSON.stringify([...records.projectPreferences.values()])).not.toMatch(/correspondence|continuations|displaced/);
  }
  const result = reconstructProject(decomposeProject({ ...project, initialState: assembleState(redone.state.parts) }, scopeOf(project)));
  const layers = result.initialState.variants.default.templates['page-0'].layers;
  expect(Object.hasOwn(layers[0], 'collapsed')).toBe(false);
  expect(layers[1].collapsed).toBe(false); expect(layers[2].collapsed).toBe('legacy');
});

it('supplies UTF-8 payload contributions and template overlay contributions without losing presence', () => {
  const project = makeIncrementalProject();
  project.initialState.variants.default.templates['page-0'].layers![0].collapsed = false;
  const records = decomposeProject(project, scopeOf(project));
  for (const name of schema.NORMALIZED_STORE_NAMES.filter(n => n !== 'normalizationLedger')) {
    for (const record of records[name].values()) expect(record.encodedSize.valueBytes).toBe(bytes(record.value));
  }
  const stored = first(records.projectTemplates);
  const overlayBytes = first(records.projectPreferences).encodedSize.templateOverlayBytes[JSON.stringify(['default', 'page-0'])];
  expect(stored.encodedSize.valueBytes + overlayBytes).toBe(bytes(project.initialState.variants.default.templates['page-0']));
  expect(overlayBytes).toBeGreaterThan(0);
  expect(first(records.projectHeaders).encodedSize.documentBytes).toBe(bytes(first(records.projectHeaders).document));
});

it('keeps fold-byte contributions on preferences, never rewriting template payload bookkeeping', () => {
  const project = makeIncrementalProject();
  const before = decomposeProject(project, scopeOf(project));
  const template = project.initialState.variants.default.templates['page-0'];
  template.layers = template.layers!.map(layer => ({ ...layer, collapsed: false }));
  const after = decomposeProject(project, scopeOf(project));
  expect(after.projectTemplates).toEqual(before.projectTemplates);
  expect(after.projectPreferences).not.toEqual(before.projectPreferences);
});

it.each([0, 23])('reconstructs independent preference revisions with a byte-identical header at storage revision %s', storageRevision => {
  const project = makeIncrementalProject(); project.revision = 7;
  const records = decomposeProject(project, scopeOf(project));
  const header = first(records.projectHeaders); const preferences = first(records.projectPreferences);
  header.storageRevision = storageRevision;
  header.lastCommitId = storageRevision ? 'document-23' : null;
  fixtureLineage(records, 'document');
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const otherRecords = schema.NORMALIZED_STORE_NAMES.filter(store => store !== 'projectPreferences')
    .map(store => JSON.stringify([...records[store]]));
  const previousValueBytes = preferences.encodedSize.valueBytes;
  preferences.revision = 4;
  preferences.lastCommitId = 'preferences-4';
  preferences.value = { ...preferences.value, selectedTemplateId: 'page-1', scale: 1.25 };
  preferences.encodedSize.valueBytes = bytes(preferences.value);
  expect(preferences.encodedSize.valueBytes).not.toBe(previousValueBytes);
  fixtureLineage(records, 'preferences');

  const result = reconstructProject(records);
  expect(result).toStrictEqual({ ...project, initialState: {
    ...project.initialState, selectedTemplateId: 'page-1', scale: 1.25,
  } });
  expect(partitionState(result.initialState).document).toStrictEqual(partitionState(project.initialState).document);
  expect(result.revision).toBe(7);
  expect(new TextEncoder().encode(JSON.stringify(header))).toEqual(headerBytes);
  expect(schema.NORMALIZED_STORE_NAMES.filter(store => store !== 'projectPreferences')
    .map(store => JSON.stringify([...records[store]]))).toEqual(otherRecords);
  expect(header).not.toHaveProperty('preferenceRevision');
  expect(JSON.stringify(result)).not.toMatch(/storageRevision|preferenceRevision|lastCommitId|encodedSize|storageGeneration|incarnation/);
});

it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, '1', null])('rejects malformed independent preference revision %s', revision => {
  const records = normalize(); first(records.projectPreferences).revision = revision;
  expect(() => reconstructProject(records)).toThrow(/revision\/counter/);
});

const externalPreferenceFields = ['activeVariantId', 'selectedNodeId', 'selectedTemplateId', 'scale',
  'viewMode', 'sidebarWidth', 'propertiesPanelWidth', 'snapToGrid', 'showGrid'];
const optionalPreferenceCases = [
  ['selectedTemplateId', 'page-1'], ['scale', 1.25], ['sidebarWidth', 320],
  ['scale', 0], ['sidebarWidth', 0], ['propertiesPanelWidth', 0],
  ['snapToGrid', false], ['showGrid', false], ['selectedNodeId', 'root'], ['viewMode', 'design'],
] as const;

for (const initiallyPresent of [false, true]) {
  it.each(optionalPreferenceCases)(`reconstructs repeated %s=%s presence changes with initially ${initiallyPresent ? 'present' : 'absent'} preference and unchanged non-preference bytes`, (field, value) => {
    const project = makeIncrementalProject(); project.revision = 7;
    if (initiallyPresent) Object.assign(project.initialState, { [field]: value });
    else Reflect.deleteProperty(project.initialState, field);
    const validated = validateWorkspaceProject(project, { warningPolicy: 'reject' });
    expect(Object.hasOwn(validated.initialState, field)).toBe(initiallyPresent);
    const records = decomposeProject(validated, scopeOf(validated));
    const header = first(records.projectHeaders); const preferences = first(records.projectPreferences);
    header.storageRevision = 23; header.lastCommitId = 'document-23';
    fixtureLineage(records, 'document');
    const otherBytes = () => schema.NORMALIZED_STORE_NAMES.filter(store => store !== 'projectPreferences')
      .map(store => new TextEncoder().encode(JSON.stringify([...records[store]])));
    const beforeBytes = otherBytes();
    const documentBefore = partitionState(validated.initialState).document;
    const originalOrder = Object.keys(validated.initialState);
    expect(reconstructProject(records)).toStrictEqual(validated);

    for (let revision = 1; revision <= 4; revision++) {
      const present = revision % 2 === 1 ? !initiallyPresent : initiallyPresent;
      const expected = { ...validated, initialState: { ...validated.initialState } };
      if (present) {
        preferences.value[field] = value;
        Object.assign(expected.initialState, { [field]: value });
      } else {
        delete preferences.value[field];
        Reflect.deleteProperty(expected.initialState, field);
      }
      expect(validateWorkspaceProject(expected, { warningPolicy: 'reject' })).toStrictEqual(expected);
      preferences.revision = revision;
      preferences.lastCommitId = `preferences-${revision}`;
      preferences.encodedSize.valueBytes = bytes(preferences.value);
      fixtureLineage(records, 'preferences');
      // Independent expected payload: external own fields plus this fixture's empty fold/panel maps.
      // Do not derive expected contributions from the normalized payload or codec helpers.
      const expectedPreferences = { ...Object.fromEntries(Object.entries(expected.initialState)
        .filter(([key]) => externalPreferenceFields.includes(key))), layerCollapsed: {}, panelsExpanded: {} };
      expect(preferences.value).toStrictEqual(expectedPreferences);
      expect(preferences.encodedSize).toStrictEqual({
        valueBytes: Buffer.byteLength(JSON.stringify(expectedPreferences), 'utf8'), templateOverlayBytes: {},
      });
      const fieldContribution = present ? Buffer.byteLength(`${JSON.stringify(field)}:${JSON.stringify(value)},`, 'utf8') : 0;
      const withoutField = { ...expectedPreferences }; Reflect.deleteProperty(withoutField, field);
      expect(preferences.encodedSize.valueBytes).toBe(Buffer.byteLength(JSON.stringify(withoutField), 'utf8') + fieldContribution);

      const result = reconstructProject(records);
      expect(result).toStrictEqual(expected);
      expect(Object.hasOwn(result.initialState, field)).toBe(present);
      if (present) expect(Reflect.get(result.initialState, field)).toBe(value);
      expect(Object.keys(result.initialState)).toEqual([
        ...originalOrder.filter(key => key !== field || present),
        ...(!initiallyPresent && present ? [field] : []),
      ]);
      expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBe(Buffer.byteLength(JSON.stringify(expected), 'utf8'));
      expect(partitionState(result.initialState).document).toStrictEqual(documentBefore);
      expect(result.revision).toBe(7);
      expect(preferences.revision).toBe(revision);
      expect(preferences.lastCommitId).toBe(`preferences-${revision}`);
      expect(otherBytes()).toEqual(beforeBytes);
    }
  });
}

it('preserves arbitrary initial interleaving and appends new preferences in current preference-record order', () => {
  const project = makeIncrementalProject(); const state = project.initialState;
  Reflect.deleteProperty(state, 'sidebarWidth'); Reflect.deleteProperty(state, 'selectedTemplateId');
  Object.assign(state, { retained: { text: 'Café ☕' } });
  const leading = ['showGrid', 'generator', 'retained', 'scale', 'nodes', 'selectedNodeId', 'activeLayerId', 'rootId'];
  const order = [...leading, ...Object.keys(state).filter(key => !leading.includes(key))];
  project.initialState = Object.fromEntries(order.map(key => [key, Reflect.get(state, key)])) as typeof state;
  const validated = validateWorkspaceProject(project, { warningPolicy: 'reject' });
  const records = decomposeProject(validated, scopeOf(validated));
  const initialJSON = JSON.stringify(validated);
  expect(JSON.stringify(reconstructProject(records))).toBe(initialJSON);
  const beforeBytes = schema.NORMALIZED_STORE_NAMES.filter(store => store !== 'projectPreferences')
    .map(store => Buffer.from(JSON.stringify([...records[store]]), 'utf8'));
  const preferences = first(records.projectPreferences);
  // Reverse classification order deliberately: the current record, not a default list, orders additions.
  preferences.value.sidebarWidth = 0; preferences.value.selectedTemplateId = 'page-1';
  preferences.revision = 4; preferences.lastCommitId = 'preferences-4';
  preferences.encodedSize.valueBytes = bytes(preferences.value);
  fixtureLineage(records, 'preferences');
  const expected = { ...validated, initialState: { ...validated.initialState, sidebarWidth: 0, selectedTemplateId: 'page-1' } };
  expect(validateWorkspaceProject(expected, { warningPolicy: 'reject' })).toStrictEqual(expected);
  const expectedPreferences = { ...Object.fromEntries(Object.entries(expected.initialState)
    .filter(([key]) => externalPreferenceFields.includes(key))), layerCollapsed: {}, panelsExpanded: {} };
  expect(preferences.encodedSize.valueBytes).toBe(Buffer.byteLength(JSON.stringify(expectedPreferences), 'utf8'));
  expect(JSON.stringify(reconstructProject(records))).toBe(JSON.stringify(expected));
  expect(JSON.stringify(reconstructProject(records))).toBe(JSON.stringify(expected));
  expect(schema.NORMALIZED_STORE_NAMES.filter(store => store !== 'projectPreferences')
    .map(store => Buffer.from(JSON.stringify([...records[store]]), 'utf8'))).toEqual(beforeBytes);
});

it.each([
  ['missing document key', (r: any) => { first(r.projectHeaders).order.state = first(r.projectHeaders).order.state.filter((key: string) => key !== 'rootId'); }, /ordering membership/],
  ['missing source key', (r: any) => { first(r.projectHeaders).order.state = first(r.projectHeaders).order.state.filter((key: string) => key !== 'generator'); }, /extra projectSources/],
  ['missing extension key', (r: any) => { first(r.projectHeaders).order.state = first(r.projectHeaders).order.state.filter((key: string) => key !== 'activeLayerId'); }, /ordering membership/],
  ['unknown state key', (r: any) => { first(r.projectHeaders).order.state.push('unknown'); }, /ordering membership/],
  ['unknown preference-like key', (r: any) => { first(r.projectHeaders).order.state.push('panelsExpanded'); }, /ordering membership/],
  ['duplicate document key', (r: any) => { first(r.projectHeaders).order.state.push('rootId'); }, /ordering/],
  ['duplicate present preference key', (r: any) => { first(r.projectHeaders).order.state.push('scale'); }, /ordering/],
  ['duplicate absent preference key', (r: any) => { delete first(r.projectPreferences).value.scale; first(r.projectHeaders).order.state.push('scale'); }, /ordering/],
  ['extra extension member', (r: any) => { [...r.projectExtensions.values()].find((e: any) => e.key[3] === 'state').value.retained = '☕'; }, /ordering membership/],
  ['removed extension member', (r: any) => { delete [...r.projectExtensions.values()].find((e: any) => e.key[3] === 'state').value.activeLayerId; }, /ordering membership/],
  ['missing active variant', (r: any) => { delete first(r.projectPreferences).value.activeVariantId; }, /active variant/],
  ['invalid active variant', (r: any) => { first(r.projectPreferences).value.activeVariantId = false; }, /active variant/],
  ['unknown active variant', (r: any) => { first(r.projectPreferences).value.activeVariantId = 'missing'; }, /active variant/],
  ['missing fold map', (r: any) => { delete first(r.projectPreferences).value.layerCollapsed; }, /record fields/],
  ['invalid panel map', (r: any) => { first(r.projectPreferences).value.panelsExpanded = { panel: 0 }; }, /boolean preferences/],
] as const)('retains fail-closed state ordering and required preferences: %s', (_name, corrupt, message) => {
  const records = normalize(); corrupt(records);
  for (const store of schema.NORMALIZED_STORE_NAMES) if (store !== 'normalizationLedger')
    for (const record of records[store].values()) record.encodedSize.valueBytes = bytes(record.value);
  expect(() => reconstructProject(records)).toThrow(message);
});

it.each(['', 1, false])('rejects malformed independent preference lastCommitId %s', lastCommitId => {
  const records = normalize(); first(records.projectPreferences).lastCommitId = lastCommitId;
  expect(() => reconstructProject(records)).toThrow(/last commit/);
});

it('does not deep-clone the full external project during either bulk codec operation', () => {
  const project = makeIncrementalProject();
  const clone = vi.spyOn(globalThis, 'structuredClone').mockImplementation(() => { throw Error('Unexpected clone'); });
  expect(reconstructProject(decomposeProject(project, scopeOf(project)))).toEqual(project);
  expect(clone).not.toHaveBeenCalled();
});

it.each(['storageGeneration', 'incarnation', 'projectId'])('rejects another %s at scoped reconstruction', field => {
  const records = normalize(); records.scope = { ...records.scope, [field]: 'other' };
  expect(() => reconstructProject(records)).toThrow(/scope|incarnation|generation/i);
});

it.each(['projectNodes', 'projectVariants', 'projectTemplates', 'projectSources', 'projectExtensions', 'projectPreferences'])
('rejects injected foreign-incarnation records in %s rather than filtering them out', store => {
  const records = normalize(); const foreign = decomposeProject(makeIncrementalProject(), { ...records.scope, incarnation: 'foreign' });
  const entry = [...foreign[store].entries()][0]; records[store].set(...entry);
  expect(() => reconstructProject(records)).toThrow(/scope|incarnation|generation/i);
});

it.each([
  ['unknown store', (r: any) => { r.surprise = new Map(); }],
  ['unknown record field', (r: any) => { first(r.projectTemplates).surprise = true; }],
  ['unknown record version', (r: any) => { first(r.projectTemplates).formatVersion = 4; }],
  ['mismatched map key', (r: any) => { const record = first(r.projectNodes); r.projectNodes.clear(); r.projectNodes.set('wrong', record); }],
  ['missing record', (r: any) => { r.projectTemplates.delete(r.projectTemplates.keys().next().value); }],
  ['extra record', (r: any) => { const record = structuredClone(first(r.projectTemplates)); record.key[4] = 'extra'; r.projectTemplates.set(JSON.stringify(record.key), record); }],
  ['duplicate ordering', (r: any) => { first(r.projectVariants).templateOrder.push('page-0'); }],
  ['invalid payload', (r: any) => { first(r.projectTemplates).value.width = -1; }],
  ['unstripped fold', (r: any) => { first(r.projectTemplates).value.layers[0].collapsed = true; }],
  ['unknown extension owner', (r: any) => { const record = first(r.projectExtensions); record.key[3] = 'unknown'; }],
  ['extension owner collision', (r: any) => { first(r.projectExtensions).value.id = 'hijack'; }],
  ['stale size contribution', (r: any) => { first(r.projectTemplates).encodedSize.valueBytes++; }],
  ['negative revision', (r: any) => { first(r.projectHeaders).storageRevision = -1; }],
  ['unknown ledger record', (r: any) => { r.normalizationLedger.set('unknown', {}); }],
])('rejects unrecognized storage: %s', (_name, corrupt) => {
  const records = normalize(); corrupt(records);
  expect(() => reconstructProject(records)).toThrow();
});

it.each([
  ['invalid template', (r: any) => { first(r.projectTemplates).value.width = -1; }, /invalid dimensions/],
  ['invalid node', (r: any) => { first(r.projectNodes).value.id = 'wrong'; }, /mismatched id/],
  ['invalid source', (r: any) => { first(r.projectSources).value.formatVersion = 2; }, /generator format version/i],
  ['unstripped fold', (r: any) => { first(r.projectTemplates).value.layers[0].collapsed = false; }, /unstripped fold/],
  ['wrapper collision', (r: any) => { first(r.projectExtensions).value.id = 'hijack'; }, /owner collision/],
  ['misowned optional revision', (r: any) => {
    first(r.projectExtensions).value.revision = 1; first(r.projectHeaders).order.wrapper.push('revision');
  }, /owner collision/],
  ['misowned optional cloud', (r: any) => {
    first(r.projectExtensions).value.cloud = { projectId: 'cloud', lastSyncedCommitId: 'commit' };
    first(r.projectHeaders).order.wrapper.push('cloud');
  }, /owner collision/],
  ['state collision', (r: any) => { [...r.projectExtensions.values()].find((e: any) => e.key[3] === 'state').value.nodes = {}; }, /owner collision/],
  ['unknown preference', (r: any) => { first(r.projectPreferences).value.unknown = 1; }, /record fields/],
  ['unknown fold address', (r: any) => { first(r.projectPreferences).value.layerCollapsed['["default","page-0","missing"]'] = true; }, /fold preference address/],
  ['unknown exception address', (r: any) => { [...r.projectExtensions.values()].find((e: any) => e.key[3] === 'folds').value['["default","page-0",99]'] = { value: 'raw' }; }, /fold exception address/],
  ['unknown overlay size', (r: any) => { first(r.projectPreferences).encodedSize.templateOverlayBytes['["default","missing"]'] = 1; }, /unknown template overlay contribution/],
  ['stale overlay size', (r: any) => { first(r.projectPreferences).encodedSize.templateOverlayBytes['["default","page-0"]'] = 1; }, /external template contribution/],
] as const)('validates %s even with correct payload byte metadata', (_name, corrupt, message) => {
  const records = normalize(); corrupt(records);
  for (const name of schema.NORMALIZED_STORE_NAMES) if (name !== 'normalizationLedger')
    for (const record of records[name].values()) record.encodedSize.valueBytes = bytes(record.value);
  expect(() => reconstructProject(records)).toThrow(message);
});

it('rejects invalid ingress and mismatched project scopes', () => {
  const project = makeIncrementalProject();
  expect(() => decomposeProject(project, { ...scopeOf(project), projectId: 'other' })).toThrow(/scope/i);
  expect(() => decomposeProject(project, { ...scopeOf(project), incarnation: '' })).toThrow();
  project.initialState.nodes.root.id = 'wrong';
  expect(() => decomposeProject(project, scopeOf(project))).toThrow(/id/i);
});

it('imports pure schema/codec without opening IndexedDB or changing production v2', async () => {
  vi.resetModules();
  const open = vi.fn(() => { throw Error('Unexpected database open'); });
  vi.stubGlobal('indexedDB', { open });
  await import('../../../../services/localWorkspace/normalized/schema');
  await import('../../../../services/localWorkspace/normalized/codec');
  expect(open).not.toHaveBeenCalled();
  expect((await import('../../../../services/localWorkspace/schema')).WORKSPACE_DB_VERSION).toBe(2);
});
