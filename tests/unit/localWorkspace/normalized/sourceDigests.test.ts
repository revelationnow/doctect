// @vitest-environment node
import { createHash, webcrypto } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { prepareInitialCopy } from '../../../../services/localWorkspace/migration';
import { canonicalStringify } from '../../../../services/localWorkspace/canonical';
import * as json from '../../../../shared/jsonWork.js';
import { currentState, deterministicEnvironment, legacySnapshot } from '../../../helpers/localWorkspaceFixtures';
import { makeWorkHarness } from '../../../helpers/normalizationWorkHarness';
import type { NormalizationSource } from '../../../../services/localWorkspace/normalized/schema';
import type { NormalizationSourceArchive } from '../../../../services/localWorkspace/schema';
import { equalFrameWork, orderedFrame } from '../../../../services/localWorkspace/normalized/work';

const modules = import.meta.glob<typeof import('../../../../services/localWorkspace/normalized/sourceDigests')>('../../../../services/localWorkspace/normalized/sourceDigests.ts');
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
// Independent persisted-format oracle. Never route through the shared-stream helper.
const envelope = (label: string, value: object) => `[${JSON.stringify(label)},{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  .map(([key, value]) => `${JSON.stringify(key)}:${canonicalStringify(value)}`).join(',')}}]`;
const list = (label: string, values: readonly object[]) => `[${JSON.stringify(label)},${values.map(value => envelope('envelope', value)).join(',')}]`;
const preferred = 'normalization-source:incremental-local-persistence-v3';
async function fixture(kind: 'fresh' | 'historical', reordered = false, collision = false) {
  const prepared = await prepareInitialCopy(legacySnapshot(), deterministicEnvironment({ crypto: webcrypto as unknown as Crypto }));
  const a = { id: 'first', project: { id: 'first', name: 'Café 根', initialState: currentState(), extension: { text: '\ud800😀', data: [1, true, null] } },
    incarnation: 'first-incarnation', storageRevision: 0, updatedAt: prepared.ledger.migratedAt };
  const b = { ...structuredClone(a), id: 'second', project: { ...structuredClone(a.project), id: 'second' }, incarnation: 'second-incarnation' };
  const projects = [a, b], records = { projects: reordered ? [b, a] : projects,
    workspace: { id: 'current' as const, projectOrder: projects.map(row => row.id), activeProjectId: a.id, revision: 0 }, presets: [], pendingImports: [] };
  const snapshot = { projects: projects.map(row => row.project), activeProjectId: a.id, customPresets: [], pendingImports: [] };
  const backups = kind === 'fresh' ? [] : [prepared.backup, ...(collision ? [{ ...prepared.backup, id: preferred, kind: 'conflict' as const }] : [])];
  const ledger = kind === 'fresh' ? null : { ...prepared.ledger, state: 'verified' as const, verifiedAt: prepared.ledger.migratedAt };
  return { kind, records, snapshot, projects, backups, ledger };
}
afterEach(() => vi.restoreAllMocks());

it.each([
  ['fresh', false, false], ['fresh', true, false], ['historical', false, false], ['historical', true, false], ['historical', false, true],
] as const)('shares source serialization without changing %s frames (reordered=%s, collision=%s)', async (kind, reordered, collision) => {
  expect(Object.keys(modules), 'source digest module').toHaveLength(1);
  const { hashSourceImages } = await Object.values(modules)[0](), input = await fixture(kind, reordered, collision);
  const before = structuredClone(input), work = makeWorkHarness().runtime;
  const archive: NormalizationSourceArchive = { id: collision ? `${preferred}:1` : preferred, kind: 'normalization-source', formatVersion: 3,
    ...(kind === 'fresh' ? { sourceKind: 'fresh' as const, ledger: null, seed: input.records.projects } : { sourceKind: 'historical' as const, ledger: input.ledger! }),
    workspace: input.records.workspace, presets: [], pendingImports: [], projectMetadata: input.records.projects.map(({ project: _project, ...row }) => row),
    backupDigests: input.backups.map(row => ({ id: row.id, digest: digest(envelope('backup', row)) })) };
  const projectFrames = input.projects.map(row => envelope('normalization-project-v1', row));
  const contentFrame = `["normalization-content-v1",${list('projects', input.snapshot.projects)},${JSON.stringify(input.snapshot.activeProjectId)},${list('presets', [])},${list('imports', [])}]`;
  const archiveFrame = `["normalization-archive-v1",${envelope('workspace', archive.workspace)},${list('presets', [])},${list('imports', [])},${list('metadata', archive.projectMetadata)},${canonicalStringify(archive.backupDigests)},${archive.sourceKind === 'fresh' ? list('fresh-seed', archive.seed) : envelope('ledger', archive.ledger)}]`;
  const canonical = vi.spyOn(json, 'canonicalWork');
  const result = await hashSourceImages(input, work);
  expect(result.sourceProjects).toEqual(input.projects.map((row, index) => ({ projectId: row.id, incarnation: row.incarnation, revision: row.storageRevision, digest: digest(projectFrames[index]) })));
  expect(result.contentDigest).toBe(digest(contentFrame)); expect(result.sourceArchiveDigest).toBe(digest(archiveFrame));
  expect(JSON.stringify(result.archive)).toBe(JSON.stringify(archive)); expect(input).toEqual(before);
  for (const row of input.projects) expect(canonical.mock.calls.filter(([value]) => value === row.project || value === row.project.initialState)).toHaveLength(kind === 'fresh' && reordered ? 2 : 1);
  const expectedBytes = [...projectFrames, contentFrame, archiveFrame, ...input.backups.map(row => envelope('backup', row))].reduce((sum, frame) => sum + Buffer.byteLength(frame), 0);
  expect(work.snapshot().sourceHashBytes).toBe(expectedBytes); expect(work.snapshot().ownedBytes).toBe(0);
});

it('closes all source hash states on cancellation without returning partial evidence', async () => {
  expect(Object.keys(modules)).toHaveLength(1); const { hashSourceImages } = await Object.values(modules)[0]();
  const input = await fixture('fresh'); input.projects[0].project.initialState.nodes.root.title = 'cancel '.repeat(2048);
  const h = makeWorkHarness(); h.observe(() => { if (h.runtime.snapshot().hashBytes > 2048) h.cancel(); });
  await expect(hashSourceImages(input, h.runtime)).rejects.toMatchObject({ name: 'AbortError' });
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});

it.each(['same', 'copied', 'changed-metadata', 'changed-payload', 'reordered-keys'] as const)('compares captured archive %s with exact ordered semantics', async kind => {
  const api = await Object.values(modules)[0](), input = await fixture('fresh'), h = makeWorkHarness();
  const { archive } = await api.hashSourceImages(input, h.runtime);
  let actual: any = { ...archive };
  if (kind === 'copied') actual = structuredClone(archive);
  if (kind === 'changed-metadata') actual = { ...actual, projectMetadata: [{ ...actual.projectMetadata[0], updatedAt: '2026-01-01T00:00:00.000Z' }, actual.projectMetadata[1]] };
  if (kind === 'changed-payload') { actual = structuredClone(archive); actual.seed[0].project.initialState.nodes.root.title = 'Changed'; }
  if (kind === 'reordered-keys') { const { id, ...rest } = actual; actual = { ...rest, id }; }
  const expected = await h.runtime.run(equalFrameWork(orderedFrame(archive), orderedFrame(actual)));
  expect((api as any).equalSourceArchiveWork).toBeTypeOf('function');
  const serialize = vi.spyOn(json, 'orderedJsonWork');
  expect(await h.runtime.run((api as any).equalSourceArchiveWork(archive, actual))).toBe(expected);
  if (kind === 'same' && archive.sourceKind === 'fresh') expect(serialize.mock.calls.some(([value]) => value === archive.seed)).toBe(false);
  expect(h.runtime.snapshot().ownedBytes).toBe(0);
});
