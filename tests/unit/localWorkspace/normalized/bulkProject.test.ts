import { expect, it, vi } from 'vitest';
import { decomposeProject, reconstructProject, validateRecords } from '../../../../services/localWorkspace/normalized/codec';
import { authority, frameRecord, validateCommitWindow } from '../../../../services/localWorkspace/normalized/commitProof';
import { partitionState } from '../../../../services/document/partition';
import { createWorkRuntime } from '../../../../shared/cooperativeWork.js';
import { makeIncrementalProject } from '../../../helpers/incrementalFixtures';
import { makeWorkHarness } from '../../../helpers/normalizationWorkHarness';
import * as references from '../../../../services/document/references';
import * as folds from '../../../../services/localWorkspace/normalized/validateChanges';
import { NORMALIZED_STORE_NAMES, type BulkDocumentBatch, type NormalizedProject, type ProjectStoreName } from '../../../../services/localWorkspace/normalized/schema';
import { createPlannerProject } from '../../../../services/presets';

const modules = import.meta.glob<typeof import('../../../../services/localWorkspace/normalized/bulkProject')>(
  '../../../../services/localWorkspace/normalized/bulkProject.ts');
async function api() { expect(Object.keys(modules), 'bulk preparation module').toHaveLength(1); return Object.values(modules)[0](); }
const pair = (image: NormalizedProject) => ({ header: image.projectHeaders.values().next().value!, preferences: image.projectPreferences.values().next().value! });
const now = '2026-10-02T12:00:00.000Z';
function fixture() {
  const project = makeIncrementalProject(1);
  Object.assign(project, { cloud: { projectId: 'cloud-project', lastSyncedCommitId: 'cloud-commit', extension: 'keep' },
    bulkBaseline: { external: true }, extension: ['wrapper'] });
  const scope = { storageGeneration: 'g', projectId: project.id, incarnation: 'i' };
  const current = decomposeProject(project, scope), state = structuredClone(project.initialState);
  state.nodes.root.title = 'Replacement';
  Object.assign(state, { bulkBaseline: { external: 'state' }, commitProof: 'external-proof' });
  const preferences = { ...partitionState(state).preferences, panelsExpanded: { appearance: true } };
  const batch: BulkDocumentBatch = { scope, clientId: 'client', commitId: 'replace-1', commitGeneration: 1,
    editorGeneration: 8, expected: authority(pair(current).header, pair(current).preferences), state, preferences };
  return { project, current, batch, work: makeWorkHarness().runtime };
}

it('prepares a same-incarnation replacement with exact counters and two reset windows', async () => {
  const bulk = await api(), h = fixture(), before = structuredClone(h.current);
  const prepared = await bulk.prepareBulkProject(h.current, h.batch, now, h.work);
  try {
    const { header, preferences } = pair(prepared.project);
    expect(prepared.project.scope).toEqual(h.current.scope);
    expect(authority(header, preferences)).toEqual({ documentRevision: 1, preferenceRevision: 1, foldStructureGeneration: 1 });
    expect(header.commitWindow).toEqual({ floorRevision: 1, entries: [] });
    expect(preferences.commitWindow).toEqual({ floorRevision: 1, entries: [] });
    expect(header.commitProof).toEqual(preferences.commitProof);
    expect(header.commitProof).toMatchObject({ kind: 'bulk-document', identity: { lane: 'document', commitId: 'replace-1' } });
    expect(preferences.bulkBoundary).toBe(header.bulkBaseline!.proof.manifestDigest);
    expect(prepared.ack).toMatchObject({ type: 'document-replaced', incarnation: 'i', editorGeneration: 8,
      authority: { documentRevision: 1, preferenceRevision: 1, foldStructureGeneration: 1 }, boundaryDigest: preferences.bulkBoundary });
    expect(() => validateRecords(prepared.project)).not.toThrow();
    await bulk.verifyBulkProjectBaseline(prepared.project, h.work);
    const external = reconstructProject(prepared.project);
    expect(external).toEqual({ ...h.project, initialState: h.batch.state });
    expect(preferences.value).toEqual(h.batch.preferences);
    expect(h.current).toEqual(before);
  } finally { prepared.release(); }
  expect(h.work.snapshot().ownedBytes).toBe(0);
});

it('replaces rather than chains bulk baselines', async () => {
  const bulk = await api(), h = fixture();
  const first = await bulk.prepareBulkProject(h.current, h.batch, now, h.work);
  try {
    const nextBatch = { ...h.batch, expected: first.ack.authority, commitId: 'replace-2', commitGeneration: 2, editorGeneration: 9 };
    const second = await bulk.prepareBulkProject(first.project, nextBatch, now, h.work);
    try {
      const { header, preferences } = pair(second.project);
      expect(header.bulkBaseline!.proof.before).toEqual(first.ack.authority);
      expect(header.bulkBaseline!.proof.identity.commitId).toBe('replace-2');
      expect(header.commitWindow).toEqual({ floorRevision: 2, entries: [] });
      expect(preferences.commitWindow).toEqual({ floorRevision: 2, entries: [] });
      expect(Object.keys(header.bulkBaseline!).sort()).toEqual(['digests', 'proof']);
      await bulk.verifyBulkProjectBaseline(second.project, h.work);
    } finally { second.release(); }
  } finally { first.release(); }
});

it('preserves raw fold cells and scalar preferences supplied by the replacement event', async () => {
  const bulk = await api(), h = fixture();
  h.batch.state.sidebarWidth = 431;
  h.batch.state.variants.default.templates['page-0'].layers = [null, { id: 'layer', collapsed: 'raw', name: 'Layer', order: 0, visible: true, locked: false }] as any;
  h.batch.preferences = { ...partitionState(h.batch.state).preferences, panelsExpanded: { dimensions: true } };
  const prepared = await bulk.prepareBulkProject(h.current, h.batch, now, h.work);
  try { expect(reconstructProject(prepared.project).initialState).toEqual(h.batch.state); await bulk.verifyBulkProjectBaseline(prepared.project, h.work); }
  finally { prepared.release(); }
});

it('preserves valid padding extensions and their property order without loader normalization', async () => {
  const bulk = await api(), h = fixture();
  const padding = { extension: 'keep this value', left: 4, top: 1, bottom: 3, right: 2 };
  Object.assign(h.batch.state.variants.default.templates['page-0'].elements[0], { textPadding: padding });
  const prepared = await bulk.prepareBulkProject(h.current, h.batch, now, h.work);
  try {
    const saved = reconstructProject(prepared.project).initialState.variants.default.templates['page-0'].elements[0].textPadding!;
    expect(saved).toEqual(padding); expect(Object.keys(saved)).toEqual(Object.keys(padding));
  } finally { prepared.release(); }
});

it('validates an already detached bulk input without cloning its whole document again', async () => {
  const bulk = await api(), h = fixture(), before = structuredClone(h.batch);
  const captured = await bulk.captureBulkDocumentBatch(h.batch, h.work);
  const clone = vi.spyOn(globalThis, 'structuredClone');
  let prepared: Awaited<ReturnType<typeof bulk.prepareBulkProject>> | undefined;
  try {
    prepared = await bulk.prepareBulkProject(h.current, captured.batch, now, h.work);
    expect(clone).not.toHaveBeenCalled();
    expect(reconstructProject(prepared.project)).toEqual({ ...h.project, initialState: before.state });
    expect(captured.batch).toEqual(before);
    expect(h.batch).toEqual(before);
  } finally { clone.mockRestore(); prepared?.release(); captured.release(); }
  expect(h.work.snapshot().ownedBytes).toBe(0);
});

it.each(['schema', 'root', 'active-variant', 'text-padding', 'nonfinite', 'clone-produced-hole', 'wrapper-depth'] as const)(
  'retains strict validation of detached replacement %s', async kind => {
    const bulk = await api(), h = fixture();
    if (kind === 'schema') h.batch.state.schemaVersion--;
    if (kind === 'root') h.batch.state.rootId = 'missing';
    if (kind === 'active-variant') h.batch.state.activeVariantId = 'missing';
    if (kind === 'text-padding') Object.assign(h.batch.state.variants.default.templates['page-0'].elements[0],
      { textPadding: { top: -1, right: 0, bottom: 0, left: 0 } });
    if (kind === 'nonfinite') Object.assign(h.batch.state, { extension: Infinity });
    if (kind === 'clone-produced-hole') {
      const extension = ['value']; Object.defineProperty(extension, '0', { enumerable: false });
      Object.assign(h.batch.state, { extension });
    }
    if (kind === 'wrapper-depth') {
      let extension: object = {};
      for (let index = 0; index < 511; index++) extension = { child: extension };
      Object.assign(h.batch.state, { extension });
    }
    const captured = await bulk.captureBulkDocumentBatch(h.batch, h.work);
    try { await expect(bulk.prepareBulkProject(h.current, captured.batch, now, h.work)).rejects.toThrow(); }
    finally { captured.release(); }
    expect(h.work.snapshot().ownedBytes).toBe(0);
  });

it.each(['documentRevision', 'preferenceRevision', 'foldStructureGeneration'] as const)('rejects overflow or stale %s', async key => {
  const bulk = await api(), h = fixture();
  h.batch.expected[key] = Number.MAX_SAFE_INTEGER;
  await expect(bulk.prepareBulkProject(h.current, h.batch, now, h.work)).rejects.toThrow();
  expect(h.work.snapshot().ownedBytes).toBe(0);
});

it('rejects explicit preference semantics that disagree with supplied state', async () => {
  const bulk = await api(), h = fixture(); h.batch.preferences.sidebarWidth = 999;
  await expect(bulk.prepareBulkProject(h.current, h.batch, now, h.work)).rejects.toThrow();
  expect(h.work.snapshot().ownedBytes).toBe(0);
});

it('detaches replacement input before suspension and releases capture ownership', async () => {
  const bulk = await api(), h = fixture();
  const pending = bulk.captureBulkDocumentBatch(h.batch, h.work);
  h.batch.state.nodes.root.title = 'Changed after capture';
  const captured = await pending;
  try { expect(captured.batch.state.nodes.root.title).toBe('Replacement'); expect(h.work.snapshot().ownedBytes).toBeGreaterThan(0); }
  finally { captured.release(); }
  expect(h.work.snapshot().ownedBytes).toBe(0);
});

it.each(['scope', 'expected', 'commitId'])('refuses private accessor %s before calling it', async field => {
  const bulk = await api(), h = fixture(); let calls = 0;
  Object.defineProperty(h.batch, field, { enumerable: true, get() { calls++; return undefined; } });
  await expect(bulk.captureBulkDocumentBatch(h.batch, h.work)).rejects.toThrow();
  expect(calls).toBe(0); expect(h.work.snapshot().ownedBytes).toBe(0);
});

it.each(['document', 'preferences', 'folds', 'boundary', 'baseline-digest', 'count', 'external-private-name'] as const)(
  'independent baseline verification rejects tampered %s', async kind => {
    const bulk = await api(), h = fixture();
    const prepared = await bulk.prepareBulkProject(h.current, h.batch, now, h.work);
    try {
      const { header, preferences } = pair(prepared.project);
      if (kind === 'document') prepared.project.projectNodes.values().next().value!.value.title = 'Tamperbytes';
      if (kind === 'preferences') preferences.value.scale = 9;
      if (kind === 'folds') [...prepared.project.projectExtensions.values()].find(row => row.key[3] === 'folds')!.value.changed = 'raw';
      if (kind === 'boundary') preferences.bulkBoundary = '0'.repeat(64);
      if (kind === 'baseline-digest') header.bulkBaseline!.digests.documentDigest = '0'.repeat(64);
      if (kind === 'count') header.bulkBaseline!.digests.recordCount++;
      if (kind === 'external-private-name') [...prepared.project.projectExtensions.values()].find(row => row.key[3] === 'state')!.value.bulkBaseline = { external: 'changed' };
      await expect(bulk.verifyBulkProjectBaseline(prepared.project, h.work)).rejects.toThrow();
    } finally { prepared.release(); }
  });

it('does not put a bulk proof into an ordinary delta window', async () => {
  const bulk = await api(), h = fixture(), prepared = await bulk.prepareBulkProject(h.current, h.batch, now, h.work);
  try {
    const proof = pair(prepared.project).header.commitProof!;
    expect(() => validateCommitWindow({ floorRevision: 0, entries: [{ revision: 1, proof, selected: [], referenceAddresses: [], foldTemplates: [] }] }, 1, 'document')).toThrow();
  } finally { prepared.release(); }
});

it.each(['document', 'preferences'] as const)('does not let advancing the other lane bypass the %s baseline', async lane => {
  const bulk = await api(), h = fixture(), prepared = await bulk.prepareBulkProject(h.current, h.batch, now, h.work);
  try {
    const { header, preferences } = pair(prepared.project);
    // Component verifier is not complete lineage admission; full codec validation is a separate boundary.
    if (lane === 'document') { preferences.revision++; prepared.project.projectNodes.values().next().value!.value.title = 'Corruption'; }
    else { header.storageRevision++; [...prepared.project.projectExtensions.values()].find(row => row.key[3] === 'folds')!.value.changed = 'raw'; }
    await expect(bulk.verifyBulkProjectBaseline(prepared.project, h.work)).rejects.toThrow(lane === 'document' ? 'Bulk document baseline mismatch' : 'Bulk fold baseline mismatch');
  } finally { prepared.release(); }
});

it('bulk core framing excludes only outer self-referential fields', async () => {
  const bulk = await api(), h = fixture(), prepared = await bulk.prepareBulkProject(h.current, h.batch, now, h.work);
  try {
    const header = pair(prepared.project).header;
    const before = frameRecord('projectHeaders', header, 'bulk');
    header.bulkBaseline!.digests.imageDigest = '0'.repeat(64);
    expect(frameRecord('projectHeaders', header, 'bulk')).toBe(before);
    expect(frameRecord('projectHeaders', header, true)).not.toBe(before);
  } finally { prepared.release(); }
});

it('cancellation after clone ownership acquisition does not leak retained input', async () => {
  const bulk = await api(), h = fixture(); let fired = false;
  const work = createWorkRuntime({ assertCurrent() { if (work.snapshot().captureGraphs) { fired = true; throw new DOMException('cancel', 'AbortError'); } } });
  try { await expect(bulk.captureBulkDocumentBatch(h.batch, work)).rejects.toThrow(); expect(fired).toBe(true); expect(work.snapshot().ownedBytes).toBe(0); expect(work.snapshot().captureGraphs).toBe(0); }
  finally { work.dispose(); }
});

it('cooperatively rebuilds the exact reference index at a bulk boundary', async () => {
  expect(references.buildReferenceIndexWork).toBeTypeOf('function');
  const h = fixture(), document = partitionState(h.batch.state).document;
  expect(await h.work.run(references.buildReferenceIndexWork(document))).toEqual(references.buildReferenceIndex(document));
  expect(h.work.snapshot().ownedBytes).toBe(0);
});

it('cooperatively rebuilds a fold index with the same selected-update behavior', async () => {
  expect(folds.createFoldOverlayIndexWork).toBeTypeOf('function');
  const h = fixture(), prefs = pair(h.current).preferences;
  const exceptions = [...h.current.projectExtensions.values()].find(row => row.key[3] === 'folds')!;
  const sync = folds.createFoldOverlayIndex(prefs, exceptions), cooperative = await h.work.run(folds.createFoldOverlayIndexWork(prefs, exceptions));
  const effects = [{ variantId: 'default', templateId: 'page-0', preferences: { [JSON.stringify(['default', 'page-0', 'new'])]: true }, exceptions: {} }];
  expect(folds.prepareFoldOverlayChanges(cooperative, effects)).toEqual(folds.prepareFoldOverlayChanges(sync, effects));
  expect(h.work.snapshot().ownedBytes).toBe(0);
});

it.each(['references', 'folds'] as const)('retains %s index accounting until caller releases its bulk custody', async kind => {
  const h = fixture(), lease = h.work.own(0);
  try {
    if (kind === 'references') await h.work.run(references.buildReferenceIndexWork(partitionState(h.batch.state).document, lease));
    else await h.work.run(folds.createFoldOverlayIndexWork(pair(h.current).preferences,
      [...h.current.projectExtensions.values()].find(row => row.key[3] === 'folds')!, lease));
    expect(h.work.snapshot().ownedBytes).toBeGreaterThan(0);
  } finally { lease.release(); }
  expect(h.work.snapshot().ownedBytes).toBe(0);
});

const sha256Hex = async (text: string) => Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))),
  byte => byte.toString(16).padStart(2, '0')).join('');
const unicodeState = (state: BulkDocumentBatch['state']) => {
  const root = state.nodes[state.rootId];
  root.title = 'Café 雪 😀 lone \ud800 tail \udc00 "quote" \\ back\nline\u0001';
  root.data = { ...root.data, '😀 key': 'value ', '': '' };
  return state;
};
const replacements: [string, (h: ReturnType<typeof fixture>) => void][] = [
  ['incremental replacement with wrapper and state extensions', () => {}],
  ['2026 planner preset', h => {
    h.batch.state = createPlannerProject(); h.batch.preferences = partitionState(h.batch.state).preferences;
  }],
  ['unicode and escapes', h => { unicodeState(h.batch.state); h.batch.preferences = { ...partitionState(h.batch.state).preferences, panelsExpanded: { appearance: true } }; }],
  ['linked root metadata', h => { h.batch.metadata = { kind: 'linked-root', name: 'Replacement' }; }],
];

it.each(replacements)('trusted request digest equals the metered digest: %s', async (_name, edit) => {
  const bulk = await api(), h = fixture(); edit(h);
  expect(await bulk.hashTrustedBulkDocumentRequest(h.batch, sha256Hex)).toBe(await bulk.hashBulkDocumentRequest(h.batch, h.work));
});

it.each(replacements)('trusted preparation writes exactly the metered records and ack: %s', { timeout: 120_000 }, async (_name, edit) => {
  const bulk = await api(), h = fixture(); edit(h);
  const metered = await bulk.prepareBulkProject(h.current, structuredClone(h.batch), now, h.work);
  const trusted = await bulk.prepareTrustedBulkProject(h.current, reconstructProject(h.current), structuredClone(h.batch), now, h.work, sha256Hex);
  try {
    expect(trusted.ack).toEqual(metered.ack);
    for (const store of NORMALIZED_STORE_NAMES.filter((name): name is ProjectStoreName => name !== 'normalizationLedger')) {
      expect([...trusted.project[store].keys()]).toEqual([...metered.project[store].keys()]);
      for (const [key, record] of metered.project[store]) expect(frameRecord(store, trusted.project[store].get(key)!)).toBe(frameRecord(store, record));
    }
    expect(trusted.project).toEqual(metered.project);
    expect(trusted.external).toEqual(reconstructProject(metered.project));
    await bulk.verifyBulkProjectBaseline(trusted.project, h.work);
  } finally { metered.release(); trusted.release(); }
  expect(h.work.snapshot().ownedBytes).toBe(0);
});

it.each(['schema', 'root', 'active-variant', 'text-padding', 'nonfinite', 'wrapper-depth', 'preferences', 'stale'] as const)(
  'trusted preparation keeps strict validation of %s', async kind => {
    const bulk = await api(), h = fixture();
    if (kind === 'schema') h.batch.state.schemaVersion--;
    if (kind === 'root') h.batch.state.rootId = 'missing';
    if (kind === 'active-variant') h.batch.state.activeVariantId = 'missing';
    if (kind === 'text-padding') Object.assign(h.batch.state.variants.default.templates['page-0'].elements[0],
      { textPadding: { top: -1, right: 0, bottom: 0, left: 0 } });
    if (kind === 'nonfinite') Object.assign(h.batch.state, { extension: Infinity });
    if (kind === 'wrapper-depth') {
      let extension: object = {};
      for (let index = 0; index < 511; index++) extension = { child: extension };
      Object.assign(h.batch.state, { extension });
    }
    if (kind === 'preferences') h.batch.preferences.sidebarWidth = 999;
    if (kind === 'stale') h.batch.expected.documentRevision = Number.MAX_SAFE_INTEGER;
    await expect(bulk.prepareTrustedBulkProject(h.current, reconstructProject(h.current), h.batch, now, h.work, sha256Hex)).rejects.toThrow();
    expect(h.work.snapshot().ownedBytes).toBe(0);
  });
