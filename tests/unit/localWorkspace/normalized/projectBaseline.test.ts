import { expect, it } from 'vitest';
import { decomposeProject, reconstructProject } from '../../../../services/localWorkspace/normalized/codec';
import { createProjectBirthDigests, projectBirthFrame, verifyProjectBirth } from '../../../../services/localWorkspace/normalized/projectBaseline';
import { deriveWorkspaceIncarnation, type WorkspaceBirthOrigin, type WorkspaceMember } from '../../../../services/localWorkspace/normalized/workspaceManifest';
import { hashFrame } from '../../../../services/localWorkspace/normalized/work';
import { validateWorkspaceBirthOriginWork } from '../../../../services/localWorkspace/normalized/commitProof';
import { makeIncrementalProject } from '../../../helpers/incrementalFixtures';
import { makeWorkHarness } from '../../../helpers/normalizationWorkHarness';
import { testHash } from '../../../helpers/incrementalStoreHarness';
import { createWorkRuntime, type WorkRuntime } from '../../../../shared/cooperativeWork.js';

async function fixture() {
  const project = makeIncrementalProject(2); const w = makeWorkHarness('reopen');
  const scope = { storageGeneration: 'g1', projectId: project.id, incarnation: await deriveWorkspaceIncarnation('g1', 1, 0, w.runtime) };
  const image = decomposeProject(project, scope);
  const origin: WorkspaceBirthOrigin = { kind: 'workspace-command', identity: { clientId: 'client', commandId: 'create', commandSequence: 1 },
    requestDigest: testHash('create'), workspaceRevision: 1, memberOrdinal: 0, createdAt: '2026-09-26T00:00:00.000Z',
    authority: { documentRevision: 0, preferenceRevision: 0, foldStructureGeneration: 0 } };
  image.projectHeaders.values().next().value!.workspaceBirth = origin;
  const digests = await createProjectBirthDigests(image, w.runtime);
  const member: WorkspaceMember = { projectId: project.id, incarnation: scope.incarnation, consumedImport: {}, birth: { ...origin, digests } };
  return { project, w, image, member, origin, digests };
}

it('admits an initial workspace-born image without exporting its private birth', async () => {
  const h = await fixture();
  await expect(verifyProjectBirth(h.image, h.member, h.w.runtime)).resolves.toBeUndefined();
  expect(reconstructProject(h.image)).toEqual(h.project);
});

it('keeps document/fold digests independent of preference changes', async () => {
  const h = await fixture(); const preferences = h.image.projectPreferences.values().next().value!;
  preferences.value = { ...preferences.value, zoom: 1.25 };
  const after = await createProjectBirthDigests(h.image, h.w.runtime);
  expect(after.documentDigest).toBe(h.digests.documentDigest);
  expect(after.foldDigest).toBe(h.digests.foldDigest);
  expect(after.preferenceDigest).not.toBe(h.digests.preferenceDigest);
  expect(after.imageDigest).not.toBe(h.digests.imageDigest);
});

it('keeps preference/fold baselines independent of document changes', async () => {
  const h = await fixture(); const node = h.image.projectNodes.values().next().value!;
  node.value = { ...node.value, title: 'Changed' };
  const after = await createProjectBirthDigests(h.image, h.w.runtime);
  expect(after.preferenceDigest).toBe(h.digests.preferenceDigest); expect(after.foldDigest).toBe(h.digests.foldDigest);
  expect(after.documentDigest).not.toBe(h.digests.documentDigest);
});

it('does not remove external properties that share private proof names', async () => {
  const h = await fixture(); const extension = [...h.image.projectExtensions.values()].find(row => row.key[3] === 'wrapper')!;
  extension.value = { ...extension.value, commitProof: { retained: true } };
  expect(await hashFrame(h.w.runtime, 'proof', projectBirthFrame(h.image, 'document'))).not.toBe(h.digests.documentDigest);
});

it.each(['document', 'preferences', 'folds', 'origin', 'member', 'extra-row', 'missing-row'] as const)('rejects initial birth mismatch: %s', async change => {
  const h = await fixture();
  if (change === 'document') h.image.projectNodes.values().next().value!.value.title = 'Corrupt';
  if (change === 'preferences') h.image.projectPreferences.values().next().value!.value.zoom = 9;
  if (change === 'folds') [...h.image.projectExtensions.values()].find(row => row.key[3] === 'folds')!.value.injected = 'opaque';
  if (change === 'origin') h.image.projectHeaders.values().next().value!.workspaceBirth = { ...h.origin, workspaceRevision: 2 };
  if (change === 'member') h.member.incarnation = 'wrong';
  if (change === 'extra-row') {
    const row = h.image.projectNodes.values().next().value!;
    h.image.projectNodes.set('unowned', structuredClone(row));
  }
  if (change === 'missing-row') h.image.projectNodes.delete(h.image.projectNodes.keys().next().value!);
  await expect(verifyProjectBirth(h.image, h.member, h.w.runtime)).rejects.toThrow();
});

it('does not let an advanced preference lane bypass the initial document digest', async () => {
  const h = await fixture(); h.image.projectPreferences.values().next().value!.revision = 1;
  h.image.projectNodes.values().next().value!.value.title = 'Corrupt';
  await expect(verifyProjectBirth(h.image, h.member, h.w.runtime)).rejects.toThrow();
});

it('requires initial raw-fold evidence after only document revision advances', async () => {
  const h = await fixture(); h.image.projectHeaders.values().next().value!.storageRevision = 1;
  [...h.image.projectExtensions.values()].find(row => row.key[3] === 'folds')!.value.injected = 'corrupt';
  await expect(verifyProjectBirth(h.image, h.member, h.w.runtime)).rejects.toThrow();
});

it('validates birth origin without granting a nonzero initial lineage exception', async () => {
  const h = await fixture(); h.origin.authority.documentRevision = 3;
  await expect(h.w.runtime.run(validateWorkspaceBirthOriginWork(h.origin))).rejects.toThrow();
});

for (const advanced of [false, true]) it.each(['workspaceBirth', 'storageRevision', 'revision'])(
  `rejects accessor %s without executing it (advanced=${advanced})`, async field => {
    const h = await fixture(); const header = h.image.projectHeaders.values().next().value!;
    const preferences = h.image.projectPreferences.values().next().value!;
    if (advanced) { header.storageRevision = 1; preferences.revision = 1; }
    let calls = 0; const target = field === 'revision' ? preferences : header;
    const old = Reflect.get(target, field);
    Object.defineProperty(target, field, { enumerable: true, get() { calls++; return old; } });
    await expect(verifyProjectBirth(h.image, h.member, h.w.runtime)).rejects.toThrow();
    expect(calls).toBe(0);
  });

it('owns record ordering buffers during baseline hashing and releases them', async () => {
  const project = makeIncrementalProject(2);
  const measure = async (count: number) => {
    const input = structuredClone(project);
    for (let i = 0; i < count; i++) input.initialState.nodes[`node-${i}`] = { ...input.initialState.nodes.root, id: `node-${i}` };
    const image = decomposeProject(input, { storageGeneration: 'g', projectId: input.id, incarnation: 'i' });
    const w = makeWorkHarness('reopen'); await createProjectBirthDigests(image, w.runtime);
    expect(w.runtime.snapshot().ownedBytes).toBe(0);
    return w.runtime.snapshot().ownedHighWater;
  };
  expect(await measure(100)).toBeGreaterThan(await measure(1));
});

it('releases projection reservation when a guard aborts immediately after allocation', async () => {
  const h = await fixture(); let runtime: WorkRuntime | undefined; let aborted = false;
  runtime = createWorkRuntime({ assertCurrent() {
    if (runtime && runtime.snapshot().ownedBytes >= 700) {
      aborted = true; throw new DOMException('abort after allocation', 'AbortError');
    }
  } });
  try {
    await expect(createProjectBirthDigests(h.image, runtime)).rejects.toMatchObject({ name: 'AbortError' });
    expect(aborted).toBe(true); expect(runtime.snapshot().ownedBytes).toBe(0);
  } finally { runtime.dispose(); }
});
