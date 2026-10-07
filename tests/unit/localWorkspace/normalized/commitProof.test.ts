import { expect, it, vi } from 'vitest';
import { appendCommitWindow, validateCommitWindow, frameBatch } from '../../../../services/localWorkspace/normalized/commitProof';
import type { CommitDelta } from '../../../../services/localWorkspace/normalized/schema';
import * as workProof from '../../../../services/localWorkspace/normalized/commitProof';
import { makeWorkHarness } from '../../../helpers/normalizationWorkHarness';
import { effect } from '../../../../shared/cooperativeWork.js';
import { createHash } from 'node:crypto';
import { hashFrame } from '../../../../services/localWorkspace/normalized/work';
import * as jsonWork from '../../../../shared/jsonWork.js';

it('distinguishes metadata omission, cloud removal, replacement and linked-root intent in request frames', () => {
  const batch = { scope: { storageGeneration: 'g', projectId: 'p', incarnation: 'i' }, commitId: 'c', clientId: 'c',
    commitGeneration: 1, editorGeneration: 1, expectedRevision: 0, changes: [] };
  const frames = [frameBatch(batch),
    frameBatch({ ...batch, metadata: { kind: 'patch', name: 'same' } }),
    frameBatch({ ...batch, metadata: { kind: 'patch', name: 'same', cloud: { type: 'remove' } } }),
    frameBatch({ ...batch, metadata: { kind: 'patch', cloud: { type: 'set', value: { projectId: '', lastSyncedCommitId: '' } } } }),
    frameBatch({ ...batch, metadata: { kind: 'linked-root', name: 'same' } })];
  expect(new Set(frames).size).toBe(frames.length);
});

it('validates and measures commit-window JSON in one count-only traversal', async () => {
  const count = vi.spyOn(jsonWork, 'canonicalBytesWork'); const emit = vi.spyOn(jsonWork, 'canonicalWork');
  const recount = vi.spyOn(jsonWork, 'plainJsonBytesWork');
  try {
    await makeWorkHarness().runtime.run(workProof.validateCommitWindowWork({ floorRevision: 0, entries: [] }, 0, 'preferences'));
    expect(count).toHaveBeenCalledTimes(1); expect(emit).not.toHaveBeenCalled(); expect(recount).not.toHaveBeenCalled();
  } finally { count.mockRestore(); emit.mockRestore(); recount.mockRestore(); }
});

it('retains strict string identity comparisons in migration lineage', async () => {
  const record: any = { storageRevision: 0, key: ['g', 'p'], incarnation: new String('i'), commitWindow: { floorRevision: 0, entries: [] },
    migrationBaseline: { migrationId: 'incremental-local-persistence-v3', attemptId: 'a', storageGeneration: 'g',
      sourceDigest: 'a'.repeat(64), projectDigest: 'b'.repeat(64), projectId: 'p', incarnation: 'i', sourceRevision: 0,
      sourceUpdatedAt: '2026-09-20T00:00:00.000Z' }, lastCommitId: null, commitProof: null,
    updatedAt: '2026-09-20T00:00:00.000Z', foldStructureGeneration: 0,
    counters: { documentBytes: 1, projectBaseBytes: 1, nodeCount: 1, variantCount: 1, elementCount: 1 } };
  expect(() => workProof.validateLineage(record, 'document')).toThrow(/baseline/);
  await expect(makeWorkHarness().runtime.run(workProof.validateLineageWork(record, 'document'))).rejects.toThrow(/baseline/);
});

it('cooperatively validates private evidence and streams exact record/manifest frames', async () => {
  expect(workProof.validateCommitWindowWork).toBeTypeOf('function');
  const h = makeWorkHarness();
  const window = { floorRevision: 0, entries: Array.from({ length: 20 }, (_, i) => delta(i + 1)) };
  await h.runtime.run(workProof.validateCommitWindowWork(window, 20, 'preferences'));
  const record = { z: '😀'.repeat(20000), commitProof: window.entries[0].proof, commitWindow: window, a: { b: 1 } };
  for (const core of [false, true]) {
    let text = '';
    await h.runtime.run(workProof.recordFrame('projectHeaders', record, core)(function* (part) { yield* effect(1, () => { text += part; }); }));
    expect(text).toBe(workProof.frameRecord('projectHeaders', record, core));
    expect(await hashFrame(h.runtime, 'proof', workProof.recordFrame('projectHeaders', record, core)))
      .toBe(createHash('sha256').update(text).digest('hex'));
  }
  const scope = { storageGeneration: 'g', projectId: 'p', incarnation: 'i' };
  let text = '';
  await h.runtime.run(workProof.manifestFrame(scope, delta(1).proof, [])(function* (part) { yield* effect(1, () => { text += part; }); }));
  expect(text).toBe(workProof.frameManifest(scope, delta(1).proof, []));
  expect(h.runtime.snapshot().yields).toBeGreaterThan(0);
  const cancelled = makeWorkHarness(); cancelled.observe(() => cancelled.cancel());
  await expect(cancelled.runtime.run(workProof.validateCommitWindowWork(window, 20, 'preferences'))).rejects.toMatchObject({ name: 'AbortError' });
});

it('private Work validators reject accessors and malformed dense arrays without running getters', async () => {
  let calls = 0; const value = Object.defineProperty({}, 'x', { enumerable: true, get() { calls++; return 1; } });
  await expect(makeWorkHarness().runtime.run(workProof.dataObjectWork(value))).rejects.toThrow(/accessors/);
  await expect(makeWorkHarness().runtime.run(workProof.exactFieldsWork(value, ['x']))).rejects.toThrow(/accessors/);
  const array = new Array(1);
  Object.defineProperty(array, '0', { enumerable: true, get() { calls++; return 1; } });
  await expect(makeWorkHarness().runtime.run(workProof.denseDataArrayWork(array))).rejects.toThrow(/accessors/);
  expect(calls).toBe(0);
  const h = makeWorkHarness(); h.observe(() => h.cancel());
  await expect(h.runtime.run(workProof.denseDataArrayWork(new Array(5000).fill(0)))).rejects.toMatchObject({ name: 'AbortError' });
});

const digest = 'a'.repeat(64);
const delta = (revision: number): CommitDelta => ({ revision, proof: {
  identity: { clientId: 'c', commitId: `c${revision}`, commitGeneration: revision, editorGeneration: revision, lane: 'preferences' },
  before: { documentRevision: 0, preferenceRevision: revision - 1, foldStructureGeneration: 0 },
  after: { documentRevision: 0, preferenceRevision: revision, foldStructureGeneration: 0 },
  requestDigest: digest, manifestDigest: digest, headerCoreDigest: digest, preferenceCoreDigest: digest,
}, selected: [], referenceAddresses: [], foldTemplates: [] });

it('keeps synchronous proof-window byte counting native for ordinary saves', () => {
  const window = { floorRevision: 0, entries: Array.from({ length: 32 }, (_, index) => delta(index + 1)) };
  const encode = vi.spyOn(TextEncoder.prototype, 'encode');
  try {
    validateCommitWindow(window, 32, 'preferences');
    // Two bounded identity checks per proof, one complete metadata byte count.
    expect(encode).toHaveBeenCalledTimes(65);
  } finally { encode.mockRestore(); }
});

it('evicts whole deltas by count and bytes while declaring oversized evidence gaps', () => {
  let window = { floorRevision: 0, entries: [] as readonly CommitDelta[] };
  for (let n = 1; n <= 33; n++) window = appendCommitWindow(window, delta(n));
  expect(window.floorRevision).toBe(1); expect(window.entries).toHaveLength(32);
  expect(() => validateCommitWindow(window, 33, 'preferences')).not.toThrow();
  const huge = { ...delta(34), foldTemplates: Array.from({ length: 1000 }, (_, i) => ({ variantId: 'v', templateId: `${i}${'x'.repeat(100)}` })) };
  expect(appendCommitWindow(window, huge)).toEqual({ floorRevision: 34, entries: [] });
  expect(() => validateCommitWindow({ floorRevision: 0, entries: [delta(2)] }, 2, 'preferences')).toThrow();
});

it('frames accepted deep changed payloads per component rather than private envelope ancestry', () => {
  let nested: object = {}; for (let n = 0; n < 505; n++) nested = { x: nested };
  expect(() => frameBatch({ scope: { storageGeneration: 'g', projectId: 'p', incarnation: 'i' }, commitId: 'c', clientId: 'c',
    commitGeneration: 1, editorGeneration: 1, expectedRevision: 0, changes: [{ type: 'put-node', node: { extra: nested } as any }] })).not.toThrow();
});

it('distinguishes explicit generator absence from any user-supplied marker-shaped JSON', () => {
  const batch = { scope: { storageGeneration: 'g', projectId: 'p', incarnation: 'i' }, commitId: 'c', clientId: 'c',
    commitGeneration: 1, editorGeneration: 1, expectedRevision: 0, changes: [{ type: 'set-generator' as const, generator: undefined }] };
  expect(frameBatch(batch)).not.toBe(frameBatch({ ...batch, changes: [{ type: 'set-generator', generator: ['absent-generator'] as any }] }));
});

it('rejects windows that rewind the other lane or fold generation across adjacent commits', () => {
  const first = delta(1); first.proof.before.documentRevision = 3; first.proof.after.documentRevision = 3;
  const second = delta(2);
  expect(() => validateCommitWindow({ floorRevision: 0, entries: [first, second] }, 2, 'preferences')).toThrow(/lineage/);
});

it('rejects sparse or accessor command arrays before framing or invoking user getters', () => {
  const batch = { scope: { storageGeneration: 'g', projectId: 'p', incarnation: 'i' }, commitId: 'c', clientId: 'c',
    commitGeneration: 1, editorGeneration: 1, expectedRevision: 0, changes: new Array(1) };
  expect(() => frameBatch(batch)).toThrow(/dense|sparse/);
  let calls = 0;
  Object.defineProperty(batch.changes, '0', { enumerable: true, get: () => { calls++; return { type: 'set-root', rootId: 'root' }; } });
  expect(() => frameBatch(batch)).toThrow(/accessors/); expect(calls).toBe(0);
});
