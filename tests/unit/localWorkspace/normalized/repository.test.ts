// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createNormalizedRepository } from '../../../../services/localWorkspace/normalized/repository';
import { createIncrementalStoreHarness, testHash } from '../../../helpers/incrementalStoreHarness';
import { makeIncrementalProject } from '../../../helpers/incrementalFixtures';
import { digestNormalizedRecord } from '../../../../services/localWorkspace/normalized/validateChanges';
import type { DocumentBatch, PreferenceBatch } from '../../../../services/localWorkspace/normalized/schema';
import { MAX_STATE_BYTES } from '../../../../shared/projectLimits.js';
import { decomposeProject } from '../../../../services/localWorkspace/normalized/codec';
import { frameBatch, frameRecord } from '../../../../services/localWorkspace/normalized/commitProof';
import * as referenceOwner from '../../../../services/document/references';
import * as foldOwner from '../../../../services/localWorkspace/normalized/validateChanges';
import { createSizeLedger } from '../../../../services/localWorkspace/normalized/sizeLedger';

function gateHash(h: Awaited<ReturnType<typeof createIncrementalStoreHarness>>, predicate = (text: string) => text.startsWith('["doctect-normalized-core-v1","projectHeaders"')) {
  let enter!: () => void; let release!: () => void; let paused = false;
  const reached = new Promise<void>(resolve => { enter = resolve; }); const wait = new Promise<void>(resolve => { release = resolve; });
  h.setHash(async text => { if (!paused && predicate(text)) { paused = true; enter(); await wait; } return testHash(text); });
  return { reached, release };
}

const documentBatch = (h: Awaited<ReturnType<typeof createIncrementalStoreHarness>>, n = 1): DocumentBatch => ({
  scope: h.scope, commitId: `c${n}`, clientId: 'client-1', commitGeneration: n, editorGeneration: n,
  expectedRevision: n - 1, changes: [{ type: 'put-node', node: { ...h.initial.projectNodes.values().next().value!.value, title: `edit${n}` } }],
});
const preferenceBatch = (h: Awaited<ReturnType<typeof createIncrementalStoreHarness>>, n = 1): PreferenceBatch => ({
  scope: h.scope, commitId: `p${n}`, clientId: 'prefs', commitGeneration: n, editorGeneration: n,
  observedPreferenceRevision: n - 1, patch: { scale: n + 1 },
});
const occurrence = (position: number) => ({ variantId: 'default', templateId: 'page-0', position });

it('I3 installs ingress fold receipt, carries it without fold hashing and keeps exact scalar budget', async () => {
  const h = await createIncrementalStoreHarness(foldedProject());
  const initial = await h.readRecords();
  const folds = [...initial.projectExtensions.values()].find(row => row.key[3] === 'folds')!;
  expect(Object.hasOwn(initial.projectPreferences.values().next().value!, 'foldRecordDigest')).toBe(false);
  const digest = testHash(frameRecord('projectExtensions', folds));
  for (let n = 1; n <= 2; n++) {
    const hashes: string[] = []; h.setHash(text => { hashes.push(text); return testHash(text); }); h.clearOperations();
    await h.repository.commitPreferences(preferenceBatch(h, n));
    expect(h.operations.filter(op => op.method === 'get')).toHaveLength(6);
    expect(h.operations.filter(op => op.method === 'put').map(op => op.store)).toEqual(['projectPreferences']);
    expect(h.operations.every(op => ['projectHeaders', 'projectPreferences'].includes(op.store))).toBe(true);
    expect(hashes.some(text => text.startsWith('["doctect-normalized-record-v1","projectExtensions"'))).toBe(false);
    const current = await h.readRecords(); const prefs = current.projectPreferences.values().next().value!;
    expect(Reflect.get(prefs, 'foldRecordDigest')).toBe(digest);
    expect(current.projectHeaders).toEqual(initial.projectHeaders);
    expect(current.projectExtensions).toEqual(initial.projectExtensions);
    const exported = await createNormalizedRepository(h.environment).exportProjectForRecovery(h.scope);
    expect(JSON.stringify(exported.project)).not.toContain('foldRecordDigest');
  }
});
function foldedProject() {
  const project = makeIncrementalProject(); const template = project.initialState.variants.default.templates['page-0'];
  template.layers = [{ ...template.layers![0], id: 'dup', collapsed: 'old' as any }, { ...template.layers![0], id: 'dup', collapsed: false }];
  return project;
}
function reorderBatch(h: Awaited<ReturnType<typeof createIncrementalStoreHarness>>, revision = 0): DocumentBatch {
  const template = h.initial.projectTemplates.values().next().value!.value;
  return { ...documentBatch(h, revision + 1), changes: [{ type: 'put-template', variantId: 'default', template: { ...template,
    layers: revision % 2 ? template.layers : [...template.layers!].reverse() } }], structural: {
      expectedFoldStructureGeneration: revision, mappings: [{ type: 'continue', from: occurrence(0), to: occurrence(1) },
        { type: 'continue', from: occurrence(1), to: occurrence(0) }],
    } };
}

function watchOwners() {
  const references = vi.spyOn(referenceOwner, 'updateReferenceIndex');
  const folds = vi.spyOn(foldOwner, 'publishFoldOverlayChanges');
  return { references, folds, restore: () => { references.mockRestore(); folds.mockRestore(); } };
}

function membershipProject() {
  const project = foldedProject();
  project.initialState.variants.retired = { id: 'retired', name: 'Retired', templates: {
    'page-0': structuredClone(project.initialState.variants.default.templates['page-0']),
  }, retainedExtension: { old: true } } as any;
  return project;
}

/** Expected external state is built from the input fixture, not writer records. */
function membershipCommit(h: Awaited<ReturnType<typeof createIncrementalStoreHarness>>, source: 'put' | 'delete') {
  const expected = membershipProject(); const state = expected.initialState;
  const template = { ...structuredClone(state.variants.default.templates['page-0']), id: 'page-new', name: 'New page' };
  template.layers = template.layers!.map((layer, position) => ({ ...layer, id: `fresh-${position}`,
    collapsed: (position ? { restored: 'raw cell' } : true) as any }));
  const documentTemplate = { ...template, layers: template.layers.map(({ collapsed: _collapsed, ...layer }) => layer) };
  state.nodes.root = { ...state.nodes.root, title: 'Membership edit', type: 'page-new' };
  state.nodes.added = { ...state.nodes.root, id: 'added', title: 'Added node', children: [] };
  state.variants.default.templates['page-new'] = structuredClone(template);
  delete state.variants.default.templates['page-1'];
  delete state.variants.retired;
  const variant = { id: 'added', name: 'Added variant', retainedExtension: { unicode: '☕' } };
  state.variants.added = { ...variant, templates: { 'page-new': structuredClone(template) } };
  if (source === 'put') state.generator = { ...state.generator!, templateScript: 'return { changed: "☕" };' };
  else delete state.generator;
  const mappings: NonNullable<DocumentBatch['structural']>['mappings'][number][] = [
    { type: 'remove', from: { variantId: 'default', templateId: 'page-1', position: 0 } },
    ...[0, 1].map(position => ({ type: 'remove' as const, from: { variantId: 'retired', templateId: 'page-0', position } })),
  ];
  for (const variantId of ['default', 'added']) for (const [position, layer] of template.layers.entries())
    mappings.push({ type: 'create', to: { variantId, templateId: 'page-new', position }, cell: { present: true, value: layer.collapsed } });
  const batch: DocumentBatch = { ...documentBatch(h), changes: [
    { type: 'put-node', node: state.nodes.root }, { type: 'put-node', node: state.nodes.added },
    { type: 'put-variant', variant },
    { type: 'put-template', variantId: 'default', template: documentTemplate },
    { type: 'put-template', variantId: 'added', template: documentTemplate },
    { type: 'delete-template', variantId: 'default', templateId: 'page-1' },
    { type: 'delete-variant', variantId: 'retired' },
    { type: 'set-generator', generator: state.generator },
  ], structural: { expectedFoldStructureGeneration: 0, mappings } };
  return { batch, expected };
}

it.each(['document', 'preferences', 'partial-document'] as const)
('retries acquisition-stage preference contention with original identity/digest/lower bound: %s', async lane => {
  const h = await createIncrementalStoreHarness(foldedProject()); const other = await h.anotherRepository();
  const batch = lane === 'preferences' ? { ...preferenceBatch(h), folds: { expectedFoldStructureGeneration: 0,
    updates: [{ occurrence: occurrence(0), collapsed: true }] } } : { ...reorderBatch(h),
    changes: [...documentBatch(h).changes, ...reorderBatch(h).changes] };
  const requestDigest = testHash(frameBatch(batch)); h.clearOperations();
  const gate = gateHash(h, text => text.startsWith(`["doctect-normalized-record-v1","${lane === 'partial-document' ? 'projectNodes' : 'projectHeaders'}"`));
  const saving = lane === 'preferences' ? h.repository.commitPreferences(batch as PreferenceBatch) : h.repository.commitDocument(batch as DocumentBatch);
  const outcome = saving.then(ack => ({ ack }), error => ({ error }));
  await gate.reached;
  try {
    // Pause before any selected read, or after the node was acquired but before templates.
    expect(h.operations.some(op => op.store === 'projectTemplates')).toBe(false);
    expect(h.operations.some(op => op.store === 'projectNodes')).toBe(lane === 'partial-document');
    await other.commitPreferences({ ...preferenceBatch(h), commitId: 'remote-pref', clientId: 'remote', patch: { scale: 7 } });
  } finally { gate.release(); }
  const result = await outcome;
  if ('error' in result) throw result.error;
  expect(result).toHaveProperty('ack');
  const records = await h.readRecords();
  const proof = (lane === 'preferences' ? records.projectPreferences : records.projectHeaders).values().next().value!.commitProof!;
  expect(proof.identity).toEqual({ clientId: batch.clientId, commitId: batch.commitId, commitGeneration: batch.commitGeneration,
    editorGeneration: batch.editorGeneration, lane: lane === 'preferences' ? 'preferences' : 'document' });
  expect(proof.requestDigest).toBe(requestDigest);
  expect(proof.before).toEqual({ documentRevision: 0, preferenceRevision: 1, foldStructureGeneration: 0 });
  expect(lane === 'preferences' ? (batch as PreferenceBatch).observedPreferenceRevision : (batch as DocumentBatch).expectedRevision).toBe(0);
  const exported = await h.exportFresh();
  expect(exported.initialState.scale).toBe(lane === 'preferences' ? 2 : 7);
  expect(exported.initialState.variants.default.templates['page-0'].layers!.map(layer => layer.collapsed))
    .toEqual(lane === 'preferences' ? [true, false] : [false, 'old']);
  h.clearOperations();
  const replay = lane === 'preferences' ? await h.repository.commitPreferences(batch as PreferenceBatch) : await h.repository.commitDocument(batch as DocumentBatch);
  expect(replay).toEqual(result.ack);
  expect(h.operations.some(op => op.phase === 'write')).toBe(false);
});

it.each(['content', 'structure', 'incarnation'] as const)
('rejects true acquisition-stage %s contention without local writes or publication', async contention => {
  const h = await createIncrementalStoreHarness(foldedProject()); const other = await h.anotherRepository();
  const gate = gateHash(h, text => text.startsWith('["doctect-normalized-record-v1","projectHeaders"'));
  const saving = h.repository.commitDocument(documentBatch(h));
  const rejected = expect(saving).rejects.toThrow(contention === 'incarnation' ? 'incarnation-changed' : 'authority-changed');
  await gate.reached;
  let durable;
  try {
    if (contention === 'incarnation') await h.seedRecords(decomposeProject(foldedProject(), { ...h.scope, incarnation: 'i2' }));
    else await other.commitDocument({ ...(contention === 'structure' ? reorderBatch(h) : documentBatch(h)), clientId: 'remote', commitId: 'remote-doc' });
    durable = await h.readRecords(); h.clearOperations();
  } finally { gate.release(); }
  await rejected;
  expect(await h.readRecords()).toEqual(durable);
  expect(h.operations.some(op => op.phase === 'write')).toBe(false); expect(h.publications).toEqual([]);
});

it('rejects insertion-order-permuted duplicate occurrences atomically, preserving scalar siblings and both owners', async () => {
  const h = await createIncrementalStoreHarness(foldedProject()); const before = await h.readRecords(); h.clearOperations();
  const owners = watchOwners();
  try {
    await expect(h.repository.commitPreferences({ ...preferenceBatch(h), patch: { scale: 9 }, folds: {
      expectedFoldStructureGeneration: 0, updates: [{ occurrence: occurrence(0), collapsed: true },
        { occurrence: { position: 0, templateId: 'page-0', variantId: 'default' }, collapsed: false }],
    } })).rejects.toThrow('Duplicate fold update');
    expect(h.operations).toEqual([]); expect(h.publications).toEqual([]);
    expect(owners.references).not.toHaveBeenCalled(); expect(owners.folds).not.toHaveBeenCalled();
    expect(await h.readRecords()).toEqual(before); expect(await h.exportFresh()).toEqual(foldedProject());
    await h.repository.commitDocument(reorderBatch(h));
    expect((await h.exportFresh()).initialState.variants.default.templates['page-0'].layers!.map(layer => layer.collapsed)).toEqual([false, 'old']);
  } finally { owners.restore(); }
});

it('rejects nested create-cell present getters without invoking them or issuing database operations', async () => {
  const h = await createIncrementalStoreHarness(foldedProject()); let reads = 0;
  const cell = { get present() { reads++; return true as const; }, value: true };
  h.clearOperations();
  await expect(h.repository.commitDocument({ ...documentBatch(h), structural: {
    expectedFoldStructureGeneration: 0, mappings: [{ type: 'create', to: occurrence(0), cell }],
  } })).rejects.toThrow(/accessors|fields/);
  expect(reads).toBe(0); expect(h.operations).toEqual([]); expect(h.publications).toEqual([]);
});

it.each(['put', 'delete'] as const)
('independently verifies atomic node/template/variant/extension membership + source %s at every write ordinal', async source => {
  const baseline = await createIncrementalStoreHarness(membershipProject()); const { batch, expected } = membershipCommit(baseline, source);
  baseline.clearOperations();
  const ack = await baseline.repository.commitDocument(batch);
  expect(ack).toMatchObject({ revision: 1, foldStructureGeneration: 1 });
  expect(await baseline.exportFresh()).toEqual(expected);
  const committed = await baseline.readRecords();
  expect(committed.projectHeaders.values().next().value!.order.nodes).toEqual(['root', 'added']);
  expect(committed.projectHeaders.values().next().value!.order.variants).toEqual(['default', 'added']);
  expect([...committed.projectVariants.values()].map(variant => [variant.key[3], variant.templateOrder]))
    .toEqual([['added', ['page-new']], ['default', ['page-0', 'page-new']]]);
  expect(committed.projectHeaders.values().next().value!.counters).toMatchObject({ nodeCount: 2, variantCount: 2 });
  expect(committed.projectPreferences.values().next().value!.revision).toBe(1);
  const writes = baseline.operations.filter(op => op.phase === 'write');
  expect(new Set(writes.map(op => op.store))).toEqual(new Set(['projectHeaders', 'projectPreferences', 'projectNodes',
    'projectTemplates', 'projectVariants', 'projectExtensions', 'projectSources']));
  expect(writes.some(op => op.method === 'delete' && op.store === 'projectVariants')).toBe(true);
  expect(writes.some(op => op.method === 'delete' && op.store === 'projectExtensions' && op.key?.[3] === 'variant')).toBe(true);
  expect(writes.some(op => op.method === source && op.store === 'projectSources')).toBe(true);
  expect(new Set(writes.map(op => op.transactionId)).size).toBe(1);
  expect(baseline.operations.filter(op => op.phase === 'verify-read').every(op => writes.every(write => op.connectionId !== write.connectionId))).toBe(true);
  expect(baseline.operations.some(op => op.method === 'getAll')).toBe(false);
  for (const [ordinal, write] of writes.entries()) for (const when of ['before', 'after'] as const) {
    const h = await createIncrementalStoreHarness(membershipProject()); const before = await h.readRecords();
    const owners = watchOwners(); let hit = false; h.clearOperations();
    try {
      h.setFault(point => {
        if (point.ordinal !== ordinal || point.phase !== `${when}-${write.method}`) return;
        expect(point.store).toBe(write.store); expect(point.key).toEqual(write.key); hit = true;
        throw new DOMException('ordinal rollback', 'QuotaExceededError');
      });
      await expect(h.repository.commitDocument(batch)).rejects.toMatchObject({ name: 'QuotaExceededError' });
      expect(hit).toBe(true); h.setFault();
      expect(await h.readRecords()).toEqual(before); expect(await h.exportFresh()).toEqual(membershipProject());
      expect(h.publications).toEqual([]); expect(owners.references).not.toHaveBeenCalled(); expect(owners.folds).not.toHaveBeenCalled();
      expect(await h.repository.inspectCommit(h.scope, batch.commitId)).toEqual({ type: 'not-committed' });
      expect(await h.repository.commitDocument(batch)).toEqual(ack);
      expect(await h.readRecords()).toEqual(committed); expect(await h.exportFresh()).toEqual(expected);
      expect(owners.references).toHaveBeenCalledTimes(1); expect(owners.folds).toHaveBeenCalledTimes(1);
    } finally { h.setFault(); owners.restore(); }
  }
});

it.each(['missing-put', 'present-deletion', 'unknown-completion'] as const)
('withholds ack and both owners after %s, then fails closed until explicit ingress', async failure => {
  const h = await createIncrementalStoreHarness(membershipProject()); const { batch, expected } = membershipCommit(h, 'delete');
  const oldSource = (await h.readRecords()).projectSources.values().next().value!;
  expect(oldSource).toBeDefined(); let injected = false; h.clearOperations();
  const owners = watchOwners();
  try {
    if (failure === 'unknown-completion') h.setFault(point => {
      if (point.phase === 'after-commit') { injected = true; throw new Error('connection lost'); }
    });
    else h.setReadResult((op, value) => {
      if (op.phase === 'verify-read' && op.store === (failure === 'missing-put' ? 'projectNodes' : 'projectSources')) {
        injected = true;
        if (failure === 'missing-put') { expect(value).toBeDefined(); return undefined; }
        expect(value).toBeUndefined(); return oldSource;
      }
      return value;
    });
    await expect(h.repository.commitDocument(batch)).rejects.toThrow(failure === 'unknown-completion' ? 'connection lost' : 'verification-failed');
    expect(injected).toBe(true); h.setReadResult(); h.setFault();
    expect(h.publications).toEqual([]); expect(owners.references).not.toHaveBeenCalled(); expect(owners.folds).not.toHaveBeenCalled();
    expect(await h.exportFresh()).toEqual(expected);
    const durable = await h.readRecords();
    const inspector = createNormalizedRepository(h.environment);
    expect(await inspector.inspectCommit(h.scope, batch.commitId)).toMatchObject({ type: 'committed', ack: { revision: 1, foldStructureGeneration: 1 } });
    h.clearOperations();
    await expect(h.repository.commitDocument(documentBatch(h, 2))).rejects.toThrow('ingress-required');
    await expect(h.repository.commitPreferences({ ...preferenceBatch(h, 2), folds: { expectedFoldStructureGeneration: 1,
      updates: [{ occurrence: { variantId: 'added', templateId: 'page-new', position: 0 }, collapsed: false }] } })).rejects.toThrow('ingress-required');
    expect(h.operations).toEqual([]); expect(h.publications).toEqual([]);
    expect(owners.references).not.toHaveBeenCalled(); expect(owners.folds).not.toHaveBeenCalled();
    expect(await h.readRecords()).toEqual(durable);
    await h.repository.bindAdmittedProject(durable);
    await h.repository.commitPreferences({ ...preferenceBatch(h, 2), patch: {}, folds: { expectedFoldStructureGeneration: 1,
      updates: [{ occurrence: { variantId: 'added', templateId: 'page-new', position: 0 }, collapsed: false }] } });
    expected.initialState.variants.added.templates['page-new'].layers![0].collapsed = false;
    expect(await h.exportFresh()).toEqual(expected);
  } finally { h.setReadResult(); h.setFault(); owners.restore(); }
});

it('exposes the sole normalized repository owner', () => {
  expect(createNormalizedRepository).toBeTypeOf('function');
});

it('commits one node and a revision without returning document data', async () => {
  const project = makeIncrementalProject(); project.revision = 17;
  const h = await createIncrementalStoreHarness(project); h.clearOperations();
  const ack = await h.repository.commitDocument({ scope: h.scope, commitId: 'c1', clientId: 'client-1', commitGeneration: 1,
    editorGeneration: 1, expectedRevision: 0, changes: [{ type: 'put-node', node: { ...project.initialState.nodes.root, title: 'Changed' } }] });
  expect(ack).toEqual({ type: 'document-saved', projectId: project.id, incarnation: 'i1', commitId: 'c1', editorGeneration: 1, revision: 1, foldStructureGeneration: 0 });
  expect(ack).not.toHaveProperty('project');
  expect(h.operations.some(op => op.store === 'projectTemplates')).toBe(false);
  expect(h.operations.some(op => op.method === 'getAll')).toBe(false);
  expect((await h.exportFresh()).initialState.nodes.root.title).toBe('Changed');
  expect((await h.exportFresh()).revision).toBe(17);
  const header = (await h.readRecords()).projectHeaders.values().next().value!;
  expect(header.updatedAt).toBe('2026-09-14T12:00:00.000Z');
  expect(digestNormalizedRecord('projectHeaders', header)).not.toBe(digestNormalizedRecord('projectHeaders', { ...header, updatedAt: null }));
  expect(h.publications).toHaveLength(1);
});

it('commits preference patches last-writer-wins while preserving every header byte', async () => {
  const h = await createIncrementalStoreHarness(); const other = await h.anotherRepository();
  const header = JSON.stringify([...(await h.readRecords()).projectHeaders]); h.clearOperations();
  for (const [n, owner] of [h.repository, other].entries()) await owner.commitPreferences({ scope: h.scope,
    commitId: `p${n}`, clientId: `tab${n}`, commitGeneration: 1, editorGeneration: 1, observedPreferenceRevision: 0, patch: { scale: n + 2 } });
  expect((await h.exportFresh()).initialState.scale).toBe(3);
  expect(JSON.stringify([...(await h.readRecords()).projectHeaders])).toBe(header);
  expect(h.operations.filter(op => op.method === 'put').every(op => op.store === 'projectPreferences')).toBe(true);
});

it('binds actual admitted contents, not just matching revision tags, and never lazily loads an unbound project', async () => {
  const h = await createIncrementalStoreHarness(); const unbound = createNormalizedRepository(h.environment);
  const batch = { scope: h.scope, commitId: 'c1', clientId: 'client-1', commitGeneration: 1, editorGeneration: 1, expectedRevision: 0, changes: [] };
  await expect(unbound.commitDocument(batch)).rejects.toThrow('ingress-required');
  const forged = await h.readRecords(); forged.projectNodes.values().next().value!.value.title = 'forged';
  await expect(unbound.bindAdmittedProject(forged)).rejects.toThrow();
  await unbound.bindAdmittedProject(await h.readRecords());
  h.environment.now = () => 'bad timestamp';
  await expect(unbound.commitDocument(batch)).rejects.toThrow(/timestamp/);
});

it('replays only verified exact identities and independently inspects current selected postconditions', async () => {
  const h = await createIncrementalStoreHarness(); const batch = documentBatch(h);
  const saved = await h.repository.commitDocument(batch); h.clearOperations();
  expect(await h.repository.commitDocument(batch)).toEqual(saved);
  expect(h.operations.some(op => op.method === 'put')).toBe(false);
  const inspector = createNormalizedRepository(h.environment);
  expect(await inspector.inspectCommit(h.scope, batch.commitId)).toEqual({ type: 'committed', ack: saved });
  expect(await inspector.inspectCommit(h.scope, 'unknown')).toEqual({ type: 'conflict', reason: 'proof-unavailable' });
  await expect(h.repository.commitDocument({ ...batch, changes: [] })).rejects.toThrow('identity-mismatch');
  await h.repository.commitDocument(documentBatch(h, 2));
  expect(await inspector.inspectCommit(h.scope, batch.commitId)).toEqual({ type: 'conflict', reason: 'authority-changed' });
});

it('catches up independent reference owners using selected durable windows, never a full reload', async () => {
  const h = await createIncrementalStoreHarness(); const other = await h.anotherRepository();
  await h.repository.commitDocument(documentBatch(h)); h.clearOperations();
  await other.commitDocument(documentBatch(h, 2));
  expect((await h.exportFresh()).initialState.nodes.root.title).toBe('edit2');
  expect(h.operations.some(op => op.method === 'getAll' || op.store === 'projectTemplates')).toBe(false);
  expect(h.publications.map((p: any) => p.kind)).toEqual(['remote', 'local']);
});

it('relocates latest remote folds atomically and rejects delayed old occurrences', async () => {
  const h = await createIncrementalStoreHarness(foldedProject()); const other = await h.anotherRepository();
  await other.commitPreferences({ ...preferenceBatch(h), patch: {}, folds: { expectedFoldStructureGeneration: 0,
    updates: [{ occurrence: occurrence(0), collapsed: true }] } });
  const ack = await h.repository.commitDocument(reorderBatch(h));
  expect(ack.foldStructureGeneration).toBe(1);
  expect((await h.exportFresh()).initialState.variants.default.templates['page-0'].layers!.map(l => l.collapsed)).toEqual([false, true]);
  const before = await h.readRecords();
  await expect(other.commitPreferences({ ...preferenceBatch(h, 2), patch: { scale: 9 }, folds: { expectedFoldStructureGeneration: 0,
    updates: [{ occurrence: occurrence(0), collapsed: false }] } })).rejects.toThrow('stale-fold-generation');
  expect(await h.readRecords()).toEqual(before);
  await h.repository.commitDocument(reorderBatch(h, 1));
  expect((await h.readRecords()).projectHeaders.values().next().value!.foldStructureGeneration).toBe(2);
  expect((await h.exportFresh()).initialState.variants.default.templates['page-0'].layers!.map(l => l.collapsed)).toEqual([true, false]);
});

it('requires explicit structural provenance and rejects whole-map fold preferences', async () => {
  const h = await createIncrementalStoreHarness(foldedProject());
  const batch = reorderBatch(h); delete batch.structural;
  await expect(h.repository.commitDocument(batch)).rejects.toThrow(/correspondence/);
  await expect(h.repository.commitPreferences({ ...preferenceBatch(h), patch: { layerCollapsed: {} } })).rejects.toThrow();
  expect(await h.exportFresh()).toEqual(foldedProject());
});

it.each(['before-cas', 'after-cas', 'before-put', 'after-put', 'before-delete', 'after-delete', 'before-complete'] as const)
('rolls back all selected records and both cache receipts at %s', async phase => {
  const h = await createIncrementalStoreHarness(); const before = await h.readRecords();
  const batch = documentBatch(h); batch.changes = [...batch.changes, { type: 'set-generator', generator: undefined }];
  h.clearOperations(); h.setFault(point => { if (point.phase === phase) throw new Error('fault'); });
  await expect(h.repository.commitDocument(batch)).rejects.toThrow('fault'); h.setFault();
  expect(await h.readRecords()).toEqual(before); expect(h.publications).toEqual([]);
  expect(await h.repository.inspectCommit(h.scope, batch.commitId)).toEqual({ type: 'not-committed' });
  await h.repository.commitDocument(batch);
  expect((await h.exportFresh()).initialState).not.toHaveProperty('generator');
});

it('keeps uncertain durable commits unpublished and resolves them through a fresh inspector', async () => {
  const h = await createIncrementalStoreHarness(); const batch = documentBatch(h); h.clearOperations();
  h.setFault(point => { if (point.phase === 'after-commit') throw new Error('connection lost'); });
  await expect(h.repository.commitDocument(batch)).rejects.toThrow('connection lost'); h.setFault();
  expect(h.publications).toEqual([]);
  expect((await h.exportFresh()).initialState.nodes.root.title).toBe('edit1');
  expect(await createNormalizedRepository(h.environment).inspectCommit(h.scope, batch.commitId)).toMatchObject({ type: 'committed' });
  await expect(h.repository.commitDocument(documentBatch(h, 2))).rejects.toThrow('ingress-required');
});

it('rejects selected readback corruption without publishing either derived receipt', async () => {
  const h = await createIncrementalStoreHarness(); h.clearOperations();
  h.setReadResult((op, value) => op.phase === 'verify-read' && op.store === 'projectNodes'
    ? { ...(value as any), value: { ...(value as any).value, title: 'corrupt' } } : value);
  await expect(h.repository.commitDocument(documentBatch(h))).rejects.toThrow();
  expect(h.publications).toEqual([]); h.setReadResult();
  expect((await h.exportFresh()).initialState.nodes.root.title).toBe('edit1');
});

it('fails closed on evicted preference replay and independent cache gaps', async () => {
  const h = await createIncrementalStoreHarness(); const old = await h.anotherRepository();
  const first = preferenceBatch(h);
  for (let n = 1; n <= 34; n++) await h.repository.commitPreferences(preferenceBatch(h, n));
  await expect(h.repository.commitPreferences(first)).rejects.toThrow('proof-unavailable');
  await expect(old.commitDocument(documentBatch(h))).rejects.toThrow('cache-gap');
  expect((await h.readRecords()).projectPreferences.values().next().value!.commitWindow.entries).toHaveLength(32);
});

it('reprepares an actually racing document/fold transaction against the winning preference contribution', async () => {
  const h = await createIncrementalStoreHarness(foldedProject()); const other = await h.anotherRepository();
  const gate = gateHash(h); const saving = h.repository.commitDocument(reorderBatch(h)); await gate.reached;
  await other.commitPreferences({ ...preferenceBatch(h), patch: {}, folds: { expectedFoldStructureGeneration: 0,
    updates: [{ occurrence: occurrence(0), collapsed: true }] } });
  gate.release(); await saving;
  expect((await h.exportFresh()).initialState.variants.default.templates['page-0'].layers!.map(l => l.collapsed)).toEqual([false, true]);
  expect((await h.readRecords()).projectPreferences.values().next().value!.revision).toBe(2);
  const casTransactions = new Set(h.operations.filter(op => op.phase === 'cas-read').map(op => op.transactionId));
  expect(casTransactions.size).toBeGreaterThanOrEqual(3);
});

it('never merges two simultaneous document writers and can later catch up the losing owner', async () => {
  const h = await createIncrementalStoreHarness(); const other = await h.anotherRepository(); const gate = gateHash(h);
  const loser = h.repository.commitDocument(documentBatch(h)); const rejected = expect(loser).rejects.toThrow('authority-changed');
  await gate.reached;
  await other.commitDocument({ ...documentBatch(h), clientId: 'other', commitId: 'other-1' });
  gate.release(); await rejected;
  await h.repository.commitDocument(documentBatch(h, 2));
  expect((await h.exportFresh()).initialState.nodes.root.title).toBe('edit2');
});

it('binds catch-up address summaries into the retained manifest digest', async () => {
  const h = await createIncrementalStoreHarness(); const other = await h.anotherRepository();
  await h.repository.commitDocument(documentBatch(h));
  h.setReadResult((op, value) => {
    if (op.phase === 'prepare-read' && op.store === 'projectHeaders') {
      const record = structuredClone(value) as any; record.commitWindow.entries[0].referenceAddresses = []; return record;
    }
    return value;
  });
  await expect(other.commitDocument(documentBatch(h, 2))).rejects.toThrow('verification-failed');
  h.setReadResult(); expect((await h.readRecords()).projectHeaders.values().next().value!.storageRevision).toBe(1);
});

it('aborts at every actual put/delete ordinal of a structural multi-record commit', async () => {
  const baseline = await createIncrementalStoreHarness(foldedProject()); const batch = reorderBatch(baseline);
  batch.changes = [...batch.changes, { type: 'set-generator', generator: undefined }];
  baseline.clearOperations(); await baseline.repository.commitDocument(batch);
  const writes = baseline.operations.filter(op => op.method === 'put' || op.method === 'delete');
  expect(writes.length).toBeGreaterThanOrEqual(4);
  for (const [ordinal] of writes.entries()) for (const when of ['before', 'after']) {
    const h = await createIncrementalStoreHarness(foldedProject()); const before = await h.readRecords();
    h.clearOperations(); h.setFault(point => { if (point.ordinal === ordinal && point.phase.startsWith(`${when}-`)) throw new DOMException('quota', 'QuotaExceededError'); });
    await expect(h.repository.commitDocument({ ...batch, scope: h.scope })).rejects.toMatchObject({ name: 'QuotaExceededError' });
    h.setFault(); expect(await h.readRecords()).toEqual(before); expect(h.publications).toEqual([]);
    await h.repository.commitDocument({ ...batch, scope: h.scope });
    expect((await h.exportFresh()).initialState.variants.default.templates['page-0'].layers!.map(l => l.collapsed)).toEqual([false, 'old']);
  }
});

it('copies authoritative cells and creates/restores explicit raw cells without inherited reused positions', async () => {
  const h = await createIncrementalStoreHarness(foldedProject()); const old = h.initial.projectTemplates.values().next().value!.value;
  const mappings: NonNullable<DocumentBatch['structural']>['mappings'] = [
    { type: 'continue', from: occurrence(0), to: occurrence(0) }, { type: 'remove', from: occurrence(1) },
    { type: 'copy', from: occurrence(0), to: occurrence(1) }, { type: 'create', to: occurrence(2), cell: { present: true, value: { raw: 'restored' } } },
  ];
  await h.repository.commitDocument({ ...documentBatch(h), changes: [{ type: 'put-template', variantId: 'default', template: {
    ...old, layers: [old.layers![0], { ...old.layers![0], id: 'copy' }, { ...old.layers![1], id: 'new' }],
  } }], structural: { expectedFoldStructureGeneration: 0, mappings } });
  const layers = (await h.exportFresh()).initialState.variants.default.templates['page-0'].layers!;
  expect(layers.map(l => l.collapsed)).toEqual(['old', 'old', { raw: 'restored' }]);
  await h.repository.commitPreferences({ ...preferenceBatch(h, 2), patch: {}, folds: { expectedFoldStructureGeneration: 1,
    updates: [{ occurrence: occurrence(1), collapsed: true }] } });
  expect((await h.exportFresh()).initialState.variants.default.templates['page-0'].layers!.map(l => l.collapsed)).toEqual(['old', true, { raw: 'restored' }]);
});

it('rejects a preference/content cap race using the latest complete-state counters', { timeout: 30_000 }, async () => {
  const project = makeIncrementalProject(); Object.assign(project.initialState, { padding: '', scale: 1 });
  const size = new TextEncoder().encode(JSON.stringify(project.initialState)).length;
  Object.assign(project.initialState, { padding: 'x'.repeat(MAX_STATE_BYTES - size - 1) });
  const h = await createIncrementalStoreHarness(project); const other = await h.anotherRepository(); const gate = gateHash(h);
  const batch = documentBatch(h); batch.changes = [{ type: 'put-node', node: { ...project.initialState.nodes.root, title: project.initialState.nodes.root.title + 'x' } }];
  const saving = h.repository.commitDocument(batch); const rejection = expect(saving).rejects.toThrow(/bytes|limit/); await gate.reached;
  await other.commitPreferences({ ...preferenceBatch(h), patch: { scale: 10 } }); // one extra external UTF-8 byte
  gate.release(); await rejection;
  const exported = await h.exportFresh(); expect(new TextEncoder().encode(JSON.stringify(exported.initialState)).length).toBe(MAX_STATE_BYTES);
  expect(exported.initialState.nodes.root.title).toBe(project.initialState.nodes.root.title);
});

it('rejects admitted-looking contents that contradict retained committed postconditions at ingress', async () => {
  const h = await createIncrementalStoreHarness(); await h.repository.commitDocument(documentBatch(h));
  const damaged = await h.readRecords(); damaged.projectNodes.values().next().value!.value.title = 'evil1'; // same UTF-8 size as edit1
  await h.seedRecords(damaged);
  await expect(createNormalizedRepository(h.environment).bindAdmittedProject(await h.readRecords())).rejects.toThrow('verification-failed');
});

it('guards a reused project ID by incarnation, even with an old retained preference record', async () => {
  const h = await createIncrementalStoreHarness(); const batch = documentBatch(h);
  const replacement = decomposeProject(makeIncrementalProject(), { ...h.scope, incarnation: 'i2' }); await h.seedRecords(replacement);
  await expect(h.repository.commitDocument(batch)).rejects.toThrow('incarnation-changed');
  expect(await h.repository.inspectCommit(h.scope, batch.commitId)).toEqual({ type: 'conflict', reason: 'incarnation-changed' });
});

it('admits genuine depth-512 selected node extensions without spending private batch ancestry', async () => {
  const h = await createIncrementalStoreHarness(); let extra: object = {};
  for (let n = 1; n < 509; n++) extra = { child: extra };
  const batch = documentBatch(h); batch.changes = [{ type: 'put-node', node: { ...h.initial.projectNodes.values().next().value!.value, extra } as any }];
  await h.repository.commitDocument(batch);
  expect((await h.exportFresh()).initialState.nodes.root).toHaveProperty('extra');
});

it.each(['node', 'fold'] as const)('keeps SHA/schema/JSON preparation out of the active readwrite transaction: %s', async kind => {
  const h = await createIncrementalStoreHarness(foldedProject()); let active = false;
  const original = h.environment.onOperation;
  h.environment.onOperation = op => { if (op.phase === 'cas-read') active = true; original?.(op); };
  h.setFault(point => { if (point.phase === 'after-commit') active = false; });
  h.setHash(text => { expect(active).toBe(false); return testHash(text); });
  await h.repository.commitDocument(kind === 'fold' ? reorderBatch(h) : documentBatch(h));
  expect(active).toBe(false);
  const writes = h.operations.filter(op => op.phase === 'write'); const verification = h.operations.filter(op => op.phase === 'verify-read');
  expect(verification.every(op => writes.every(w => w.connectionId !== op.connectionId))).toBe(true);
});

it('reports corrupt inspection as conflict, not success or guessed non-commit', async () => {
  const h = await createIncrementalStoreHarness(); await h.repository.commitDocument(documentBatch(h));
  h.setReadResult((op, value) => op.phase === 'inspect-read' && op.store === 'projectNodes'
    ? { ...(value as any), encodedSize: { valueBytes: 0 } } : value);
  expect(await createNormalizedRepository(h.environment).inspectCommit(h.scope, 'c1')).toEqual({ type: 'conflict', reason: 'verification-failed' });
});

it('does not let a passive publication observer turn verified durable success into failure', async () => {
  const h = await createIncrementalStoreHarness(); h.environment.onPublication = () => { throw new Error('observer'); };
  await expect(h.repository.commitDocument(documentBatch(h))).resolves.toMatchObject({ revision: 1 });
  await expect(h.repository.commitDocument(documentBatch(h, 2))).resolves.toMatchObject({ revision: 2 });
});

it('advances no structural generation for explicit property-only continuations', async () => {
  const h = await createIncrementalStoreHarness(foldedProject()); const template = h.initial.projectTemplates.values().next().value!.value;
  const before = JSON.stringify([...(await h.readRecords()).projectPreferences]);
  await h.repository.commitDocument({ ...documentBatch(h), changes: [{ type: 'put-template', variantId: 'default', template: { ...template,
    layers: template.layers!.map(layer => ({ ...layer, name: 'Renamed display label' })) } }],
    structural: { expectedFoldStructureGeneration: 0, mappings: [0, 1].map(position => ({ type: 'continue', from: occurrence(position), to: occurrence(position) })) } });
  expect((await h.readRecords()).projectHeaders.values().next().value!.foldStructureGeneration).toBe(0);
  expect(JSON.stringify([...(await h.readRecords()).projectPreferences])).toBe(before);
});

it('rejects a selected old-record digest mismatch before any write', async () => {
  const h = await createIncrementalStoreHarness(); h.clearOperations();
  h.setReadResult((op, value) => op.phase === 'prepare-read' && op.store === 'projectNodes'
    ? { ...(value as any), value: { ...(value as any).value, title: 'changed out of band' } } : value);
  await expect(h.repository.commitDocument(documentBatch(h))).rejects.toThrow();
  expect(h.operations.some(op => op.method === 'put')).toBe(false); expect(h.publications).toEqual([]);
});

it.each([
  { clientId: '' }, { commitId: '☕'.repeat(86) }, { commitGeneration: Number.MAX_SAFE_INTEGER + 1 },
  { observedPreferenceRevision: 1 }, { editorGeneration: -1 },
])('rejects invalid private identities or future evidence bounds: %j', async patch => {
  const h = await createIncrementalStoreHarness(); h.clearOperations();
  await expect(h.repository.commitPreferences({ ...preferenceBatch(h), ...patch })).rejects.toThrow();
  expect(h.operations.some(op => op.method === 'put')).toBe(false);
});

it('rejects private envelope accessors before scope-based queue lookup', async () => {
  const h = await createIncrementalStoreHarness(); const batch = documentBatch(h); let reads = 0;
  Object.defineProperty(batch, 'scope', { enumerable: true, get: () => { reads++; return h.scope; } });
  await expect(h.repository.commitDocument(batch)).rejects.toThrow(/accessors|fields/);
  expect(reads).toBe(0);
});

it('checks ingress scope descriptors before its queue lookup', async () => {
  const h = await createIncrementalStoreHarness(); const records = await h.readRecords(); let reads = 0;
  Object.defineProperty(records, 'scope', { enumerable: true, get: () => { reads++; return h.scope; } });
  await expect(h.repository.bindAdmittedProject(records)).rejects.toThrow(/accessors|fields/); expect(reads).toBe(0);
});

it('captures only the admitted changed batch before async hashing so caller mutation cannot split proof from bytes', async () => {
  const h = await createIncrementalStoreHarness(); const gate = gateHash(h);
  const node = { ...h.initial.projectNodes.values().next().value!.value, title: 'edit1' };
  const batch = { ...documentBatch(h), changes: [{ type: 'put-node' as const, node }] };
  const saving = h.repository.commitDocument(batch); await gate.reached; node.title = 'evil1'; gate.release(); await saving;
  expect((await h.exportFresh()).initialState.nodes.root.title).toBe('edit1');
  expect(await h.repository.inspectCommit(h.scope, 'c1')).toMatchObject({ type: 'committed' });
});

it('declares an oversized selected-manifest gap without lowering public document limits', async () => {
  const h = await createIncrementalStoreHarness(); const old = await h.anotherRepository(); const node = h.initial.projectNodes.values().next().value!.value;
  await h.repository.commitDocument({ ...documentBatch(h), changes: [{ type: 'put-node', node: { ...node, id: 'x'.repeat(70_000) } }] });
  const records = await h.readRecords(); const header = records.projectHeaders.values().next().value!;
  expect(header.commitWindow).toEqual({ floorRevision: 1, entries: [] }); expect(header.commitProof).not.toBeNull();
  expect(await createNormalizedRepository(h.environment).inspectCommit(h.scope, 'c1')).toEqual({ type: 'conflict', reason: 'proof-unavailable' });
  await expect(old.commitDocument(documentBatch(h, 2))).rejects.toThrow('cache-gap');
  await old.bindAdmittedProject(records); await old.commitDocument(documentBatch(h, 2));
  expect(Object.keys((await h.exportFresh()).initialState.nodes)).toHaveLength(2);
});

it('discovers fold targets only from selected sequences, never by parsing unrelated overlay keys', async () => {
  const project = foldedProject(); project.initialState.variants.default.templates['page-1'].layers![0].collapsed = true;
  const h = await createIncrementalStoreHarness(project); h.clearOperations(); const parse = JSON.parse;
  const trap = vi.spyOn(JSON, 'parse').mockImplementation((text, reviver) => {
    const value = parse(text, reviver);
    if (Array.isArray(value) && value.length === 3 && value[0] === 'default' && value[1] === 'page-1') throw new Error('unrelated fold discovery');
    return value;
  });
  try { await h.repository.commitDocument(reorderBatch(h)); } finally { trap.mockRestore(); }
  expect(h.operations.filter(op => op.store === 'projectTemplates').every(op => op.key?.[4] === 'page-0')).toBe(true);
  expect((await h.exportFresh()).initialState.variants.default.templates['page-1'].layers![0].collapsed).toBe(true);
});

it('rejects a later-authority readback snapshot instead of publishing the older commit as current', async () => {
  const h = await createIncrementalStoreHarness(); h.clearOperations();
  h.setReadResult((op, value) => {
    if (op.phase !== 'verify-read' || op.store !== 'projectHeaders') return value;
    const header = structuredClone(value) as any;
    header.storageRevision = 2; header.commitWindow.floorRevision = 1; header.commitWindow.entries[0].revision = 2;
    header.commitProof.before.documentRevision = 1; header.commitProof.after.documentRevision = 2;
    header.commitWindow.entries[0].proof = header.commitProof;
    return header;
  });
  await expect(h.repository.commitDocument(documentBatch(h))).rejects.toThrow('authority-changed');
  expect(h.publications).toEqual([]); h.setReadResult();
  expect((await h.exportFresh()).initialState.nodes.root.title).toBe('edit1');
});

it('defers stale document/reference caches during a scalar preference save without reading document payloads', async () => {
  const h = await createIncrementalStoreHarness(); const other = await h.anotherRepository();
  await h.repository.commitDocument(documentBatch(h)); h.clearOperations();
  await other.commitPreferences(preferenceBatch(h));
  expect(h.operations.some(op => ['projectNodes', 'projectTemplates', 'projectSources'].includes(op.store))).toBe(false);
  expect((await h.exportFresh()).initialState.scale).toBe(2);
  await other.commitDocument(documentBatch(h, 2));
  expect((await h.exportFresh()).initialState.nodes.root.title).toBe('edit2');
});

it('preserves remotely relocated fold maps when scalar preferences save before cache catch-up', async () => {
  const h = await createIncrementalStoreHarness(foldedProject()); const other = await h.anotherRepository();
  await h.repository.commitDocument(reorderBatch(h)); h.clearOperations();
  await other.commitPreferences(preferenceBatch(h));
  expect(h.operations.some(op => op.store === 'projectTemplates' || op.store === 'projectExtensions')).toBe(false);
  expect((await h.exportFresh()).initialState.variants.default.templates['page-0'].layers!.map(l => l.collapsed)).toEqual([false, 'old']);
  await other.commitDocument(reorderBatch(h, 1));
  expect((await h.exportFresh()).initialState.variants.default.templates['page-0'].layers!.map(l => l.collapsed)).toEqual(['old', false]);
});

it.each([0, 34])('I3 deferred scalar carries captured remote fold digest after %i evidence-evicting saves', async count => {
  const h = await createIncrementalStoreHarness(foldedProject()); const stale = await h.anotherRepository();
  const original = [...h.initial.projectExtensions.values()].find(row => row.key[3] === 'folds')!;
  await h.repository.commitDocument(reorderBatch(h));
  for (let n = 1; n <= count; n++) await h.repository.commitPreferences({ ...preferenceBatch(h, n), observedPreferenceRevision: n });
  const before = await h.readRecords(); const captured = before.projectPreferences.values().next().value!;
  expect(captured.foldRecordDigest).not.toBe(testHash(frameRecord('projectExtensions', original)));
  if (count) expect(captured.commitWindow.floorRevision).toBe(3);
  const hashes: string[] = []; h.setHash(text => { hashes.push(text); return testHash(text); }); h.clearOperations();
  await stale.commitPreferences({ ...preferenceBatch(h, count + 1), observedPreferenceRevision: captured.revision });
  expect(h.operations.filter(op => op.method === 'get')).toHaveLength(6);
  expect(h.operations.filter(op => op.method === 'put').map(op => op.store)).toEqual(['projectPreferences']);
  expect(h.operations.some(op => op.store === 'projectTemplates' || op.store === 'projectExtensions' || op.method === 'getAll')).toBe(false);
  expect(hashes.some(text => text.startsWith('["doctect-normalized-record-v1","projectExtensions"'))).toBe(false);
  const after = await h.readRecords(); const prefs = after.projectPreferences.values().next().value!;
  expect(prefs.foldRecordDigest).toBe(captured.foldRecordDigest);
  expect(after.projectExtensions).toEqual(before.projectExtensions);
  const fresh = () => createNormalizedRepository(h.environment);
  expect((await fresh().exportProjectForRecovery(h.scope)).project.initialState.variants.default.templates['page-0'].layers!.map(layer => layer.collapsed)).toEqual([false, 'old']);
  if (count) await expect(stale.commitDocument(reorderBatch(h, 1))).rejects.toThrow('cache-gap');
  else {
    await stale.commitDocument(reorderBatch(h, 1));
    expect(h.operations.some(op => op.store === 'projectTemplates')).toBe(true);
  }
  const corrupt = await h.readRecords(); const folds = [...corrupt.projectExtensions.values()].find(row => row.key[3] === 'folds')!;
  const frame = frameRecord('projectExtensions', folds);
  const cell = Object.values(folds.value).find((cell: any) => cell.value === 'old') as { value: string }; cell.value = 'bad';
  expect(frameRecord('projectExtensions', folds).length).toBe(frame.length);
  await h.seedRecords(corrupt);
  await expect(fresh().exportProjectForRecovery(h.scope)).rejects.toThrow();
  await expect(fresh().bindAdmittedProject(corrupt)).rejects.toThrow();
});

it('I3 long public scope can self-evict a real fold manifest without limiting current admission', async () => {
  const project = foldedProject(); project.id = 'scope-'.repeat(12_000);
  const h = await createIncrementalStoreHarness(project);
  await h.repository.commitPreferences({ ...preferenceBatch(h), patch: {}, folds: { expectedFoldStructureGeneration: 0,
    updates: [{ occurrence: occurrence(1), collapsed: true }] } });
  const rows = await h.readRecords(); const prefs = rows.projectPreferences.values().next().value!;
  expect(prefs.commitWindow).toEqual({ floorRevision: 1, entries: [] }); expect(prefs.commitProof).not.toBeNull();
  expect(prefs.foldRecordDigest).toHaveLength(64);
  expect(await createNormalizedRepository(h.environment).inspectCommit(h.scope, 'p1')).toEqual({ type: 'conflict', reason: 'proof-unavailable' });
  await h.repository.commitPreferences(preferenceBatch(h, 2));
  const current = await h.readRecords(); const fresh = createNormalizedRepository(h.environment);
  await fresh.bindAdmittedProject(current);
  expect((await fresh.exportProjectForRecovery(h.scope)).project.id).toBe(project.id);
  const folds = [...current.projectExtensions.values()].find(row => row.key[3] === 'folds')!;
  const cell = Object.values(folds.value).find((cell: any) => cell.value === 'old') as { value: string }; cell.value = 'bad';
  await h.seedRecords(current);
  await expect(createNormalizedRepository(h.environment).exportProjectForRecovery(h.scope)).rejects.toThrow();
}, 60_000);

it('I3 empty exceptions, boolean/no-op folds and generation-only changes preserve evidence and accounting', async () => {
  const project = makeIncrementalProject(); const h = await createIncrementalStoreHarness(project);
  const initial = await h.readRecords(); const initialFolds = [...initial.projectExtensions.values()].find(row => row.key[3] === 'folds')!;
  expect(initialFolds.value).toEqual({});
  const hashes: string[] = []; h.setHash(text => { hashes.push(text); return testHash(text); });
  for (let n = 1; n <= 2; n++) {
    hashes.length = 0; h.clearOperations();
    await h.repository.commitPreferences({ ...preferenceBatch(h, n), patch: {}, folds: { expectedFoldStructureGeneration: 0,
      updates: [{ occurrence: occurrence(0), collapsed: true }] } });
    const current = await h.readRecords(); const prefs = current.projectPreferences.values().next().value!;
    expect(current.projectHeaders).toEqual(initial.projectHeaders);
    expect([...current.projectExtensions.values()].find(row => row.key[3] === 'folds')).toEqual(initialFolds);
    expect(prefs.foldRecordDigest).toBe(testHash(frameRecord('projectExtensions', initialFolds)));
    // One prepared hash reused for evidence/selected/write digest, one independent readback hash.
    expect(hashes.filter(text => text.startsWith('["doctect-normalized-record-v1","projectExtensions"'))).toHaveLength(2);
    expect(h.operations.filter(op => op.method === 'put').map(op => op.store).sort()).toEqual(['projectExtensions', 'projectPreferences']);
    const exported = (await createNormalizedRepository(h.environment).exportProjectForRecovery(h.scope)).project;
    expect(JSON.stringify(exported)).not.toContain('foldRecordDigest');
    const ledger = createSizeLedger(current);
    expect(ledger.stateBytes).toBe(new TextEncoder().encode(JSON.stringify(exported.initialState)).length);
    expect(prefs.preferenceBytes).toBe(ledger.preferenceBytes);
  }
  // Unique-ID boolean folds retain exactly the same map when only layer identity properties change.
  const before = await h.readRecords(); const template = before.projectTemplates.values().next().value!.value;
  await h.repository.commitDocument({ ...documentBatch(h), changes: [{ type: 'put-template', variantId: 'default', template: {
    ...template, layers: [...template.layers!, { ...template.layers![0], id: 'new-layer' }] } }], structural: {
    expectedFoldStructureGeneration: 0, mappings: [{ type: 'continue', from: occurrence(0), to: occurrence(0) },
      { type: 'create', to: occurrence(1), cell: { present: false } }] } });
  const after = await h.readRecords();
  expect(after.projectHeaders.values().next().value!.foldStructureGeneration).toBe(1);
  expect(after.projectPreferences).toEqual(before.projectPreferences);
  expect(after.projectExtensions).toEqual(before.projectExtensions);
  await createNormalizedRepository(h.environment).exportProjectForRecovery(h.scope);
});

it('I3 initial generation-only structure keeps initial folds absent; empty updates install ingress receipt', async () => {
  const h = await createIncrementalStoreHarness(); const before = await h.readRecords();
  const template = before.projectTemplates.values().next().value!.value;
  await h.repository.commitDocument({ ...documentBatch(h), changes: [{ type: 'put-template', variantId: 'default', template: {
    ...template, layers: [...template.layers!, { ...template.layers![0], id: 'new-layer' }] } }], structural: {
    expectedFoldStructureGeneration: 0, mappings: [{ type: 'continue', from: occurrence(0), to: occurrence(0) },
      { type: 'create', to: occurrence(1), cell: { present: false } }] } });
  const after = await h.readRecords();
  expect(after.projectHeaders.values().next().value!.foldStructureGeneration).toBe(1);
  expect(after.projectPreferences).toEqual(before.projectPreferences);
  expect(after.projectExtensions).toEqual(before.projectExtensions);
  expect(Object.hasOwn(after.projectPreferences.values().next().value!, 'foldRecordDigest')).toBe(false);
  h.clearOperations(); const hashes: string[] = [];
  h.setHash(text => { hashes.push(text); return testHash(text); });
  await h.repository.commitPreferences({ ...preferenceBatch(h), folds: { expectedFoldStructureGeneration: 1, updates: [] } });
  expect(h.operations.filter(op => op.method === 'get')).toHaveLength(6);
  expect(h.operations.filter(op => op.method === 'put').map(op => op.store)).toEqual(['projectPreferences']);
  expect(h.operations.some(op => op.store === 'projectExtensions' || op.store === 'projectTemplates')).toBe(false);
  expect(hashes.some(text => text.startsWith('["doctect-normalized-record-v1","projectExtensions"'))).toBe(false);
  const current = await h.readRecords();
  expect(current.projectPreferences.values().next().value!.foldRecordDigest).toBe(testHash(frameRecord('projectExtensions',
    [...before.projectExtensions.values()].find(row => row.key[3] === 'folds')!)));
  await createNormalizedRepository(h.environment).exportProjectForRecovery(h.scope);
});

it.each(['projectPreferences', 'projectExtensions'] as const)('I3 rolls back digest and folds at actual %s write ordinal', async store => {
  const h = await createIncrementalStoreHarness(foldedProject());
  await h.repository.commitPreferences(preferenceBatch(h));
  const before = await h.readRecords(); h.clearOperations(); let ordinal: number | undefined;
  h.setFault(point => { if (point.phase === 'after-put' && point.store === store) { ordinal = point.ordinal; throw new Error('fold rollback'); } });
  const batch = { ...preferenceBatch(h, 2), folds: { expectedFoldStructureGeneration: 0,
    updates: [{ occurrence: occurrence(0), collapsed: true }] } };
  await expect(h.repository.commitPreferences(batch)).rejects.toThrow('fold rollback'); h.setFault();
  expect(ordinal).toBeDefined(); expect(await h.readRecords()).toEqual(before); expect(h.publications).toEqual([]);
  expect(await h.repository.inspectCommit(h.scope, batch.commitId)).toEqual({ type: 'not-committed' });
  await h.repository.commitPreferences(batch);
  const after = await h.readRecords(); const prefs = after.projectPreferences.values().next().value!;
  expect(prefs.foldRecordDigest).not.toBe(before.projectPreferences.values().next().value!.foldRecordDigest);
  expect(prefs.foldRecordDigest).toBe(testHash(frameRecord('projectExtensions', [...after.projectExtensions.values()].find(row => row.key[3] === 'folds')!)));
  await h.repository.commitPreferences(preferenceBatch(h, 3));
  await createNormalizedRepository(h.environment).exportProjectForRecovery(h.scope);
});

it.each(['lost-ack', 'fold-readback', 'digest-readback'] as const)('I3 uncertain fold commit stays unpublished: %s', async kind => {
  const h = await createIncrementalStoreHarness(foldedProject()); h.clearOperations();
  if (kind === 'lost-ack') h.setFault(point => { if (point.phase === 'after-commit') throw new Error('lost fold acknowledgement'); });
  else h.setReadResult((op, value) => {
    if (op.phase !== 'verify-read' || !value) return value;
    const row = structuredClone(value) as any;
    if (kind === 'digest-readback' && op.store === 'projectPreferences') row.foldRecordDigest = '0'.repeat(64);
    if (kind === 'fold-readback' && op.store === 'projectExtensions' && row.key[3] === 'folds')
      Object.values(row.value).forEach((cell: any) => { if (cell.value === 'old') cell.value = 'bad'; });
    return row;
  });
  const batch = { ...preferenceBatch(h), folds: { expectedFoldStructureGeneration: 0,
    updates: [{ occurrence: occurrence(1), collapsed: true }] } };
  await expect(h.repository.commitPreferences(batch)).rejects.toThrow();
  expect(h.publications).toEqual([]); h.setFault(); h.setReadResult();
  await expect(h.repository.commitPreferences(preferenceBatch(h, 2))).rejects.toThrow('ingress-required');
  const fresh = createNormalizedRepository(h.environment);
  expect(await fresh.inspectCommit(h.scope, batch.commitId)).toMatchObject({ type: 'committed' });
  await fresh.bindAdmittedProject(await h.readRecords());
  await fresh.commitPreferences(preferenceBatch(h, 2));
  expect((await fresh.exportProjectForRecovery(h.scope)).project.initialState.variants.default.templates['page-0'].layers!.map(layer => layer.collapsed)).toEqual(['old', true]);
});
