// @vitest-environment node
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { canonicalText, frameBytesWork, type Frame } from '../../../../shared/jsonWork.js';
import { runSync } from '../../../../shared/cooperativeWork.js';
import { digestFrame } from '../../../../services/localWorkspace/canonical';
import { frameRecord } from '../../../../services/localWorkspace/normalized/commitProof';
import { envelopeFrame, listFrame } from '../../../../services/localWorkspace/normalized/work';
import { decomposeProject } from '../../../../services/localWorkspace/normalized/codec';
import { makeIncrementalProject } from '../../../helpers/incrementalFixtures';
import { makeWorkHarness } from '../../../helpers/normalizationWorkHarness';
const modules = import.meta.glob('../../../../services/localWorkspace/normalized/frameComparison.ts');
async function api(): Promise<any> { expect(Object.keys(modules)).toHaveLength(1); return Object.values(modules)[0](); }
function frameText(frame: Frame) { const chunks: string[] = []; runSync(frame(function* (part) { chunks.push(part); })); return chunks.join(''); }
function archiveText(value: any) {
  return '["archive-seal",{' + Object.keys(value).sort().map(key => {
    const item = value[key];
    const text = ['seed', 'presets', 'pendingImports', 'projectMetadata'].includes(key) ? frameText(listFrame(key, item))
      : key === 'workspace' || key === 'ledger' && item !== null ? frameText(envelopeFrame(key, item)) : canonicalText(item);
    return JSON.stringify(key) + ':' + text;
  }).join(',') + '}]';
}
function archive() { return { id: 'archive', kind: 'normalization-source', formatVersion: 3, sourceKind: 'fresh', ledger: null,
  workspace: { id: 'current', projectOrder: ['p'], activeProjectId: 'p', revision: 0 },
  seed: [{ id: 'p', project: { id: 'p', name: '根😀', initialState: { opaque: ['a', 1, true] } } }],
  presets: [], pendingImports: [], projectMetadata: [{ id: 'p' }], backupDigests: [] }; }

it('compares every physical record using exact existing frame bytes and expected SHA input', async () => {
  const compare = await api(), p = makeIncrementalProject(2), records = decomposeProject(p, { storageGeneration: 'g', projectId: p.id, incarnation: 'i' });
  const h = makeWorkHarness();
  for (const [store, rows] of Object.entries(records)) {
    if (!(rows instanceof Map)) continue;
    for (const record of rows.values()) {
      const oracle = frameRecord(store as any, record), actual = structuredClone(record);
      expect(await h.runtime.run(compare.compareRecordWork(store, record, actual))).toEqual({ equal: true, bytes: Buffer.byteLength(oracle) });
      const hash = await digestFrame(function* (emit) { expect((yield* compare.compareRecordWork(store, record, actual, emit)).equal).toBe(true); }, h.runtime, 'target');
      expect(hash).toBe(createHash('sha256').update(oracle).digest('hex'));
    }
  }
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it.each(['same', 'reordered', 'changed', 'extra', 'missing'] as const)('preserves envelope frame comparison: %s', async kind => {
  const compare = await api(), left: any = { z: { text: '\ud800😀' }, a: 2 }; let right: any = structuredClone(left);
  if (kind === 'reordered') right = { a: 2, z: right.z };
  if (kind === 'changed') right.z.text = 'changed';
  if (kind === 'extra') right.extra = true;
  if (kind === 'missing') delete right.a;
  const a = frameText(envelopeFrame('envelope', left)), b = frameText(envelopeFrame('envelope', right)), h = makeWorkHarness();
  const result: any = await h.runtime.run(compare.compareEnvelopeWork('envelope', left, right));
  expect(result.equal).toBe(a === b); if (result.equal) expect(result.bytes).toBe(Buffer.byteLength(b));
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it.each(['fresh', 'historical', 'changed-payload', 'changed-metadata', 'reordered-fields', 'empty-list', 'changed-membership'] as const)
('retains normalization archive grammar and depth resets: %s', async kind => {
  const compare = await api(), left: any = archive();
  if (kind === 'historical') { left.sourceKind = 'historical'; left.ledger = { state: 'verified', revision: 1 }; delete left.seed; }
  if (kind === 'empty-list') left.seed = [];
  let right: any = structuredClone(left);
  if (kind === 'changed-payload') right.seed[0].project.initialState.opaque[0] = 'different';
  if (kind === 'changed-metadata') right.projectMetadata[0].id = 'different';
  if (kind === 'reordered-fields') { const { id, ...rest } = right; right = { ...rest, id }; }
  if (kind === 'changed-membership') right.seed.push(structuredClone(right.seed[0]));
  const expected = archiveText(left) === archiveText(right), h = makeWorkHarness();
  const result: any = await h.runtime.run(compare.compareArchiveWork(left, right));
  expect(result.equal).toBe(expected); if (expected) expect(result.bytes).toBe(Buffer.byteLength(archiveText(right)));
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it('retains external depth512 despite record and archive ancestry', async () => {
  const compare = await api(), h = makeWorkHarness(); let deep: object = {}; for (let i = 0; i < 512; i++) deep = { next: deep };
  const row = { value: deep }, value: any = archive(); value.seed = [{ project: deep }];
  expect(await h.runtime.run(compare.compareRecordWork('projectNodes', row, structuredClone(row)))).toEqual({ equal: true, bytes: Buffer.byteLength(frameRecord('projectNodes', row)) });
  expect(await h.runtime.run(compare.compareArchiveWork(value, structuredClone(value)))).toEqual({ equal: true, bytes: Buffer.byteLength(archiveText(value)) });
});

it.each(['record-array', 'record-getter', 'archive-array', 'archive-list-array', 'sparse-list'] as const)('rejects malformed seal containers: %s', async kind => {
  const compare = await api(), h = makeWorkHarness(); let gets = 0;
  const value: any = kind.startsWith('record') ? { value: { text: 'same' } } : archive();
  let actual: any = structuredClone(value);
  if (kind === 'record-array' || kind === 'archive-array') actual = Object.assign([], actual);
  if (kind === 'record-getter') Object.defineProperty(actual, 'value', { enumerable: true, get() { gets++; return value.value; } });
  if (kind === 'archive-list-array') actual.seed[0] = Object.assign([], actual.seed[0]);
  if (kind === 'sparse-list') actual.seed = new Array(1);
  await expect(h.runtime.run(kind.startsWith('record') ? compare.compareRecordWork('projectNodes', value, actual) : compare.compareArchiveWork(value, actual))).rejects.toThrow();
  expect(gets).toBe(0); expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it('emits only existing bounded record bytes through a comparison consumer', async () => {
  const compare = await api(), h = makeWorkHarness(), row = { value: { text: '"\\根😀'.repeat(512) } };
  expect(await h.runtime.run(frameBytesWork(function* (emit) { expect((yield* compare.compareRecordWork('projectNodes', row, structuredClone(row), emit)).equal).toBe(true); })))
    .toBe(Buffer.byteLength(frameRecord('projectNodes', row)));
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it('hashes a compared record without a redundant comparison-only byte-count traversal', async () => {
  const compare = await api(); expect(compare.emitComparedRecordWork).toBeTypeOf('function');
  const row = { value: { text: '"\\根😀'.repeat(1024) } }, actual = structuredClone(row);
  const measured = makeWorkHarness(), hashed = makeWorkHarness();
  const before = await digestFrame(function* (emit) { expect((yield* compare.compareRecordWork('projectNodes', row, actual, emit)).equal).toBe(true); }, measured.runtime, 'target');
  const after = await digestFrame(function* (emit) { expect(yield* compare.emitComparedRecordWork('projectNodes', row, actual, emit)).toBe(true); }, hashed.runtime, 'target');
  expect(after).toBe(before); expect(after).toBe(createHash('sha256').update(frameRecord('projectNodes', row)).digest('hex'));
  expect(hashed.runtime.snapshot().targetHashBytes).toBe(measured.runtime.snapshot().targetHashBytes);
  expect(hashed.runtime.snapshot().visits).toBeLessThan(measured.runtime.snapshot().visits);
  expect(hashed.runtime.snapshot().ownedBytes).toBe(0);
});
