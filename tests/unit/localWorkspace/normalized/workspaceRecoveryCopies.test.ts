// @vitest-environment node
import { expect, it } from 'vitest';
import { makeIncrementalProject } from '../../../helpers/incrementalFixtures';
import { deterministicEnvironment, legacySnapshot, LEGACY_KEYS } from '../../../helpers/localWorkspaceFixtures';
import { prepareLegacyRecoveryCopies } from '../../../../services/localWorkspace/recovery';
import { createWorkRuntime } from '../../../../shared/cooperativeWork.js';
import { digestLegacySnapshot } from '../../../../services/localWorkspace/canonical';

const environment = () => deterministicEnvironment({ randomUUID: () => 'token' });
const emptyRecords = { projects: [], presets: [], pendingImports: [] };
it('reserves durable, current and accepted identities across copies and strips project/import cloud authority', async () => {
  const project = makeIncrementalProject(2), unchanged = { ...project, id: 'proj_recovered_token_1' };
  const accepted = legacySnapshot({ [LEGACY_KEYS.projects]: JSON.stringify([project, unchanged]) });
  const changed = { ...project, name: 'Changed', cloud: { projectId: 'cloud', lastSyncedCommitId: 'commit' }, extension: { keep: ['order', 'data'] } };
  const current = legacySnapshot({ [LEGACY_KEYS.projects]: JSON.stringify([changed, unchanged, { ...project, id: 'proj_recovered_token_2' }]),
    [LEGACY_KEYS.customPresets]: JSON.stringify([{ id: 'preset-source', title: 'Preset', desc: '', color: 'red', isCustom: true, initialState: project.initialState }]),
    [LEGACY_KEYS.pendingImport]: JSON.stringify({ name: 'Import', state: project.initialState, cloud: { projectId: 'cloud', lastSyncedCommitId: 'commit' } }) });
  const work = createWorkRuntime({ assertCurrent() {} }), env = environment();
  try {
    const copies = await prepareLegacyRecoveryCopies(current, await digestLegacySnapshot(current), accepted, await digestLegacySnapshot(accepted),
      { projects: [{ id: 'proj_recovered_token', consumedImportId: 'import_recovered_token' }],
        presets: [{ id: 'preset_recovered_token', position: 7 }],
        pendingImports: [{ id: 'old', position: 3, pendingImport: { id: 'old', targetProjectId: 'proj_recovered_import_token', name: 'Old',
          state: project.initialState, warnings: [], createdAt: env.now() } }] }, env.now(), env, work);
    expect(copies.projects.map(row => row.id)).toEqual(['proj_recovered_token_3', 'proj_recovered_token_4']);
    expect(copies.projects[0].project).toMatchObject({ name: 'Recovered — Changed', extension: changed.extension });
    expect(copies.projects[0].project.cloud).toBeUndefined(); expect(copies.pendingImports[0].pendingImport.cloud).toBeUndefined();
    expect(copies.presets[0]).toMatchObject({ id: 'preset_recovered_token_1', position: 8 });
    expect(copies.pendingImports[0]).toMatchObject({ id: 'import_recovered_token_1', position: 4, pendingImport: { targetProjectId: 'proj_recovered_import_token_1' } });
    expect(work.snapshot().ownedBytes).toBeGreaterThan(0); copies.release(); expect(work.snapshot().ownedBytes).toBe(0);
  } finally { work.dispose(); }
});

it('formatting-only raw drift accepts no duplicate project copies', async () => {
  const project = makeIncrementalProject(2), accepted = legacySnapshot({ [LEGACY_KEYS.projects]: JSON.stringify([project]) });
  const current = legacySnapshot({ [LEGACY_KEYS.projects]: JSON.stringify([project], null, 2) });
  const env = environment(), work = createWorkRuntime({ assertCurrent() {} });
  try {
    const copies = await prepareLegacyRecoveryCopies(current, await digestLegacySnapshot(current), accepted, await digestLegacySnapshot(accepted), emptyRecords, env.now(), env, work);
    expect(copies.projects).toEqual([]); expect(copies.presets).toEqual([]); expect(copies.pendingImports).toEqual([]);
    copies.release(); expect(work.snapshot().ownedBytes).toBe(0);
  } finally { work.dispose(); }
});

it('invalid source releases every temporary lease', async () => {
  const source = legacySnapshot({ [LEGACY_KEYS.projects]: '[invalid' }), env = environment(), work = createWorkRuntime({ assertCurrent() {} });
  try {
    await expect(prepareLegacyRecoveryCopies(source, '0'.repeat(64), legacySnapshot({}), '1'.repeat(64), emptyRecords, env.now(), env, work)).rejects.toThrow();
    expect(work.snapshot().ownedBytes).toBe(0);
  } finally { work.dispose(); }
});

it('cancellation during source parsing and hashing releases every temporary lease', async () => {
  const source = legacySnapshot({ [LEGACY_KEYS.projects]: JSON.stringify([makeIncrementalProject(2)]) }), env = environment();
  let live = true;
  const work = createWorkRuntime({ assertCurrent() { if (!live) throw Error('cancelled'); }, async yieldTask() { live = false; } });
  try {
    await expect(prepareLegacyRecoveryCopies(source, '0'.repeat(64), legacySnapshot({}), '1'.repeat(64), emptyRecords, env.now(), env, work)).rejects.toThrow();
    expect(work.snapshot().ownedBytes).toBe(0); expect(work.snapshot().captureGraphs).toBe(0);
  } finally { work.dispose(); }
});
