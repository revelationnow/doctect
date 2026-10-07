// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import * as codec from '../../../../services/localWorkspace/normalized/codec';
import { createWorkspaceRecordValidator } from '../../../../services/localWorkspace/migration';
import * as validation from '../../../../services/localWorkspace/validation';
import * as json from '../../../../shared/jsonWork.js';
import * as appState from '../../../../shared/validateAppState.js';
import * as loader from '../../../../services/loadProjectState';
import { createWorkRuntime, effect, type Work } from '../../../../shared/cooperativeWork.js';
import type { WorkspaceProject } from '../../../../services/localWorkspace/contracts';
import type { NormalizedProject } from '../../../../services/localWorkspace/normalized/schema';
import type { StoredProject } from '../../../../services/localWorkspace/schema';
import { makeIncrementalProject } from '../../../helpers/incrementalFixtures';
import { makeWorkHarness } from '../../../helpers/normalizationWorkHarness';

interface Builder {
  project(records: NormalizedProject, metadata: Omit<StoredProject, 'project'>): Work<WorkspaceProject>;
  ancillary(records: unknown): Work<unknown>;
  dispose(): void;
}
function factory(): Builder {
  const create = Reflect.get(codec, 'createWorkspaceReconstructor');
  expect(create, 'self-validating current-workspace reconstruction').toBeTypeOf('function');
  return create();
}
function fixture(id = 'project') {
  const project = { ...makeIncrementalProject(2), id };
  Object.assign(project, { extension: { unicode: '根😀\ud800', nested: [1, true] } });
  project.initialState.variants.default.templates['page-0'].layers = [{ id: 'dup', collapsed: true }, { id: 'dup', collapsed: { raw: 'value' } }, { collapsed: false }] as any;
  const records = codec.decomposeProject(project, { storageGeneration: 'generation', projectId: id, incarnation: 'incarnation' });
  const metadata = { id, incarnation: 'incarnation', storageRevision: 0, updatedAt: '2026-10-04T00:00:00.000Z' };
  return { project, records, metadata };
}
const ancillary = (ids: string[]) => ({ workspace: { id: 'current', revision: 0, projectOrder: ids, activeProjectId: ids[0] }, presets: [], pendingImports: [] });
afterEach(() => vi.restoreAllMocks());

it('combines current reconstruction and real stored checks without validating the assembled original twice', async () => {
  const builder = factory(), f = fixture(), h = makeWorkHarness(), before = structuredClone(f.records);
  const oracle = await h.runtime.run(codec.reconstructProjectWork(f.records)), validator = createWorkspaceRecordValidator();
  await h.runtime.run(validator.project({ ...f.metadata, project: oracle })); await h.runtime.run(validator.ancillary(ancillary([f.metadata.id])));
  const checked = vi.spyOn(validation, 'checkStoredWorkspaceProjectWork'), canonical = vi.spyOn(json, 'canonicalBytesWork');
  const semantic = vi.spyOn(appState, 'validateAppStateWork'), inspect = vi.spyOn(appState, 'inspectAppStateWork');
  const loaded = vi.spyOn(loader, 'loadOwnedProjectStateWork');
  try {
    const project = await h.runtime.run(builder.project(f.records, f.metadata));
    expect(JSON.stringify(project)).toBe(JSON.stringify(oracle)); expect(checked).toHaveBeenCalledTimes(1);
    expect(canonical.mock.calls.filter(([value]) => value === project || value === project.initialState)).toHaveLength(0);
    expect(semantic.mock.calls.filter(([value]) => value === project.initialState)).toHaveLength(0);
    expect(inspect.mock.calls.filter(([value]) => value === project.initialState)).toHaveLength(1);
    expect(loaded).toHaveBeenCalledTimes(1);
    expect(await h.runtime.run(builder.ancillary(ancillary([project.id])))).toEqual(ancillary([project.id]));
    expect(f.records).toEqual(before); expect(h.runtime.snapshot().ownedBytes).toBe(0);
  } finally { builder.dispose(); }
});

it('releases a failed reconstruction guard without poisoning the caller runtime', async () => {
  const builder = factory(), f = fixture(), h = makeWorkHarness();
  [...f.records.projectHeaders.values()][0].counters.documentBytes++;
  try {
    await expect(h.runtime.run(builder.project(f.records, f.metadata))).rejects.toThrow();
    expect(h.runtime.stopped()).toBe(false);
    expect(await h.runtime.run(effect(1, () => 'usable'))).toBe('usable');
  } finally { builder.dispose(); }
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it.each(['scope', 'revision', 'timestamp', 'provenance', 'extra'] as const)('rejects untrusted current metadata %s', async kind => {
  const builder = factory(), f = fixture(), h = makeWorkHarness(), metadata: any = { ...f.metadata };
  if (kind === 'scope') metadata.incarnation = 'another';
  if (kind === 'revision') metadata.storageRevision++;
  if (kind === 'timestamp') metadata.updatedAt = 'invalid';
  if (kind === 'provenance') metadata.consumedImportDigest = 'a'.repeat(64);
  if (kind === 'extra') metadata.project = f.project;
  try { await expect(h.runtime.run(builder.project(f.records, metadata))).rejects.toThrow(); }
  finally { builder.dispose(); }
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it.each(['missing', 'extra', 'counter', 'overlay', 'schema', 'root', 'wrapper'] as const)('retains current %s integrity refusal', async kind => {
  const builder = factory(), f = fixture(), h = makeWorkHarness(), header = [...f.records.projectHeaders.values()][0];
  if (kind === 'missing') f.records.projectNodes.delete([...f.records.projectNodes.keys()][0]);
  if (kind === 'extra') f.records.projectNodes.set('foreign', [...f.records.projectNodes.values()][0]);
  if (kind === 'counter') header.counters.documentBytes++;
  if (kind === 'overlay') { const prefs = [...f.records.projectPreferences.values()][0]; prefs.encodedSize.templateOverlayBytes[Object.keys(prefs.encodedSize.templateOverlayBytes)[0]]++; }
  if (kind === 'schema') header.document.schemaVersion = 0;
  if (kind === 'root') header.document.rootId = 'absent';
  if (kind === 'wrapper') header.value.name = 7 as any;
  header.encodedSize.valueBytes = Buffer.byteLength(JSON.stringify(header.value));
  header.encodedSize.documentBytes = Buffer.byteLength(JSON.stringify(header.document));
  try {
    await expect(h.runtime.run(builder.project(f.records, f.metadata))).rejects.toThrow();
    await expect(h.runtime.run(builder.ancillary(ancillary([f.project.id])))).rejects.toThrow();
  } finally { builder.dispose(); }
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it.each(['warning', 'invalid-output', 'clone-failure'] as const)('keeps independent loader/clone check for %s', async kind => {
  const builder = factory(), f = fixture(), h = makeWorkHarness();
  if (kind === 'clone-failure') vi.spyOn(globalThis, 'structuredClone').mockImplementation(() => { throw new DOMException('clone refusal', 'DataCloneError'); });
  else {
    const original = loader.loadOwnedProjectStateWork;
    vi.spyOn(loader, 'loadOwnedProjectStateWork').mockImplementation(function* (...args) {
      const result = yield* original(...args);
      if (kind === 'warning') result.warnings.push('loader warning'); else result.state.activeVariantId = 'absent';
      return result;
    });
  }
  try { await expect(h.runtime.run(builder.project(f.records, f.metadata))).rejects.toThrow(); }
  finally { builder.dispose(); }
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it.each(['duplicate-project', 'duplicate-consume', 'missing-member'] as const)('preserves workspace %s checks', async kind => {
  const builder = factory(), a = fixture('a'), b = fixture(kind === 'duplicate-project' ? 'a' : 'b'), h = makeWorkHarness();
  if (kind === 'duplicate-consume') { Object.assign(a.metadata, { consumedImportId: 'import' }); Object.assign(b.metadata, { consumedImportId: 'import' }); }
  try {
    await h.runtime.run(builder.project(a.records, a.metadata));
    if (kind === 'missing-member') { await h.runtime.run(builder.project(b.records, b.metadata)); await expect(h.runtime.run(builder.ancillary(ancillary(['a'])))).rejects.toThrow(); }
    else await expect(h.runtime.run(builder.project(b.records, b.metadata))).rejects.toThrow();
  } finally { builder.dispose(); }
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it.each(['cancel', 'dispose'] as const)('does not return a project after %s during reconstruction', async kind => {
  const builder = factory(), f = fixture(), h = makeWorkHarness();
  h.observe(() => { if (kind === 'cancel') h.cancel(); else builder.dispose(); });
  try { await expect(h.runtime.run(builder.project(f.records, f.metadata))).rejects.toThrow(); }
  finally { builder.dispose(); }
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it.each(['getter', 'then'] as const)('never returns an unvalidated ancillary %s envelope', async kind => {
  const builder = factory(), f = fixture(), h = makeWorkHarness(); let calls = 0;
  try {
    await h.runtime.run(builder.project(f.records, f.metadata));
    const input: any = ancillary([f.project.id]);
    if (kind === 'getter') Object.defineProperty(input, 'presets', { enumerable: true, get() { calls++; return calls === 1 ? [] : [{ unchecked: true }]; } });
    else input.then = (resolve: (value: unknown) => void) => { calls++; resolve({ unchecked: true }); };
    await expect(h.runtime.run(builder.ancillary(input))).rejects.toThrow();
    expect(calls).toBe(0);
  } finally { builder.dispose(); }
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it('returns the exact ancillary envelope it validated, not later caller replacements', async () => {
  const builder = factory(), f = fixture(), h = makeWorkHarness(), input: any = ancillary([f.project.id]), presets = input.presets;
  try {
    await h.runtime.run(builder.project(f.records, f.metadata));
    const clone = globalThis.structuredClone;
    vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, options) => {
      const result = clone(value, options);
      if (value === input.workspace) input.presets = [{ unchecked: true }];
      return result;
    });
    const result: any = await h.runtime.run(builder.ancillary(input));
    expect(result).not.toBe(input); expect(result.presets).toBe(presets); expect(result.presets).toEqual([]);
  } finally { builder.dispose(); }
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it('refuses project or ancillary reentry while another runtime is reconstructing', async () => {
  const builder = factory(), f = fixture(), other = makeWorkHarness();
  let release!: () => void, arrived!: () => void, first = true;
  const blocked = new Promise<void>(resolve => { release = resolve; }), waiting = new Promise<void>(resolve => { arrived = resolve; });
  const work = createWorkRuntime({ assertCurrent() {}, yieldTask: () => { if (!first) return Promise.resolve(); first = false; arrived(); return blocked; } });
  try {
    const pending = work.run(builder.project(f.records, f.metadata)); await waiting;
    await expect(other.runtime.run(builder.project(f.records, f.metadata))).rejects.toThrow(/running/);
    await expect(other.runtime.run(builder.ancillary(ancillary([f.project.id])))).rejects.toThrow(/running/);
    release(); expect((await pending).id).toBe(f.project.id);
    await work.run(builder.ancillary(ancillary([f.project.id])));
    await expect(work.run(builder.project(f.records, f.metadata))).rejects.toThrow(/closed|finished/);
  } finally { release(); builder.dispose(); work.dispose(); }
  expect(work.snapshot().ownedBytes).toBe(0);
});
