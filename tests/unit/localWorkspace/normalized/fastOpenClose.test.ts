// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSync } from '../../../../shared/cooperativeWork.js';
import { canonicalText } from '../../../../shared/jsonWork.js';
import { envelopeFrame, envelopeFrameText, hashFrame } from '../../../../services/localWorkspace/normalized/work';
import * as proofs from '../../../../services/localWorkspace/normalized/commitProof';
import * as codec from '../../../../services/localWorkspace/normalized/codec';
import * as baseline from '../../../../services/localWorkspace/normalized/projectBaseline';
import * as commands from '../../../../services/localWorkspace/normalized/workspaceCommands';
import type { WorkspaceBatch, WorkspaceLifecycleIntent } from '../../../../services/localWorkspace/normalized/workspaceCommands';
import * as validation from '../../../../services/localWorkspace/validation';
import { preparePendingImport } from '../../../../services/localWorkspace/validation';
import { makeWorkHarness } from '../../../helpers/normalizationWorkHarness';
import { createWorkspaceCommandHarness } from '../../../helpers/workspaceCommandHarness';
import { mutateRow, physicalRows } from '../../../helpers/normalizationHarness';
import { makeIncrementalProject } from '../../../helpers/incrementalFixtures';
import { createPlannerProject } from '../../../../services/presets';
import { createNormalizedRepository } from '../../../../services/localWorkspace/normalized/repository';
import { NORMALIZED_STORE_NAMES, type NormalizedProject } from '../../../../services/localWorkspace/normalized/schema';
import type { StoredPreset } from '../../../../services/localWorkspace/schema';

const sha256Hex = async (text: string) => Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))),
  byte => byte.toString(16).padStart(2, '0')).join('');
const frameText = (frame: ReturnType<typeof envelopeFrame>) => {
  const chunks: string[] = [];
  runSync(frame(function* (text: string) { chunks.push(text); }));
  return chunks.join('');
};
const pendingInput = (state: unknown, id: string) => ({ id, targetProjectId: `${id}-target`, name: 'Gallery 雪 😀', state, createdAt: '2026-10-15T00:00:00.000Z' });
const preset = (id: string) => ({ id, title: 'Preset 雪', desc: 'A saved preset', isCustom: true as const, initialState: makeIncrementalProject(2).initialState });
const awkward = { b: 1, a: [1, { z: 1, y: 2 }], '😀 key': 'value ', '': '', 'lone \ud800': 'tail \udc00', 'Ä': null, 'a\u0000': 'nul' };

describe('fast open and close twins', () => {
  it('envelopeFrameText reuses a known payload text byte for byte', () => {
    const row = { id: 'import', position: 3, pendingImport: preparePendingImport(pendingInput(createPlannerProject(), 'import'), { warningPolicy: 'retain' }), extra: awkward };
    const expected = frameText(envelopeFrame('workspace-import-v1', row));
    expect(envelopeFrameText('workspace-import-v1', row, { pendingImport: canonicalText(row.pendingImport) })).toBe(expected);
    expect(envelopeFrameText('workspace-import-v1', row)).toBe(expected);
  });

  it('trustedPresetDescriptor equals the metered preset descriptor', async () => {
    for (const row of [{ id: 'p', position: 0, preset: preset('p') }, { id: 'q', position: 7, preset: { ...preset('q'), color: '#fff', extra: awkward } }] as StoredPreset[]) {
      const w = makeWorkHarness();
      expect(await commands.trustedPresetDescriptor(row, sha256Hex)).toEqual({ id: row.id, position: row.position,
        recordDigest: await hashFrame(w.runtime, 'proof', envelopeFrame('workspace-preset-v1', row)) });
    }
  });
});

describe('fast open and close preparation', () => {
  let h: Awaited<ReturnType<typeof createWorkspaceCommandHarness>>;
  let sequence = 0;
  beforeAll(async () => {
    h = await createWorkspaceCommandHarness();
    await h.commit({ type: 'save-custom-preset', preset: preset('saved') });
  });
  afterAll(() => h?.adapter.close());
  const capture = async () => {
    const rows = await physicalRows(h, [...NORMALIZED_STORE_NAMES, 'workspace', 'presets', 'pendingImports']);
    const manifest = rows.workspace[0];
    const projects = manifest.members.map((member: any) => ({ scope: { storageGeneration: manifest.storageGeneration,
      projectId: member.projectId, incarnation: member.incarnation },
      ...Object.fromEntries(NORMALIZED_STORE_NAMES.map(store => [store, store === 'normalizationLedger' ? new Map()
        : new Map(rows[store].filter((row: any) => row.key[1] === member.projectId).map((row: any) => [JSON.stringify(row.key), row]))])) } as NormalizedProject));
    return { manifest, initial: { revision: rows.normalizationLedger[0].sourceWorkspaceRevision, coreDigest: rows.normalizationLedger[0].initialWorkspaceDigest },
      memberHeaders: rows.projectHeaders, projects, presets: rows.presets, pendingImports: rows.pendingImports } as any;
  };
  const prepare = async (intent: WorkspaceLifecycleIntent, trusted: boolean, captured?: any) => {
    captured ??= await capture();
    const request: WorkspaceBatch = { ...h.request(intent), identity: { clientId: 'fast-pair', commandId: `pair-${++sequence}`, commandSequence: sequence },
      expected: { revision: captured.manifest.revision, coreDigest: captured.manifest.coreDigest } };
    const w = makeWorkHarness(); const input = await commands.captureWorkspaceBatch(request, w.runtime);
    try {
      const requestDigest = await commands.hashTrustedWorkspaceRequest(input.batch, sha256Hex);
      const result = await commands.prepareWorkspaceMutation(captured, input.batch, h.preparation.now(), w.runtime, undefined,
        trusted ? { requestDigest, hash: sha256Hex } : undefined);
      const value = { manifest: result.manifest, outcome: result.outcome, putImports: result.putImports, putPresets: result.putPresets,
        deleteImportIds: result.deleteImportIds, deletePresetIds: result.deletePresetIds, removeProjects: result.removeProjects, delta: result.delta,
        addProjects: result.addProjects.map(project => Object.fromEntries(Object.entries(project).map(([key, map]) => [key, map instanceof Map ? [...map] : map]))) };
      result.release(); return value;
    } finally { input.release(); }
  };
  /** Same request identity for both runs so the manifests are comparable. */
  const preparePair = async (intent: WorkspaceLifecycleIntent) => {
    const captured = await capture(), id = ++sequence;
    const run = (trusted: boolean) => { sequence = id - 1; return prepare(intent, trusted, captured); };
    return { metered: await run(false), trusted: await run(true) };
  };

  it('saves a preset exactly like the metered preparation', async () => {
    const { metered, trusted } = await preparePair({ type: 'save-custom-preset', preset: preset('another') });
    expect(trusted).toEqual(metered); expect(trusted.outcome).toBe('preset-saved');
  });

  it('consumes beside a stored preset and another pending import exactly like the metered preparation', async () => {
    await h.commit({ type: 'stage-import', pendingImport: pendingInput(createPlannerProject(), 'kept') });
    await h.commit({ type: 'stage-import', pendingImport: pendingInput(makeIncrementalProject(3).initialState, 'eaten') });
    const { metered, trusted } = await preparePair({ type: 'consume-import', importId: 'eaten' });
    expect(trusted).toEqual(metered); expect(trusted.outcome).toBe('consumed');
  });

  it('closes a project exactly like the metered preparation, without reconstructing it or re-proving its birth', async () => {
    const created = await h.commit({ type: 'create-and-activate-project', project: { ...makeIncrementalProject(3), id: 'closing' } });
    expect(created.outcome).toBe('created');
    const { metered } = await preparePair({ type: 'close-project', projectId: 'closing' });
    const reconstruct = vi.spyOn(codec, 'reconstructProjectWork'), birth = vi.spyOn(baseline, 'verifyProjectBirth');
    try {
      sequence -= 1; const trusted = await prepare({ type: 'close-project', projectId: 'closing' }, true);
      expect(trusted).toEqual(metered); expect(trusted.outcome).toBe('closed');
      expect(reconstruct).not.toHaveBeenCalled(); expect(birth).not.toHaveBeenCalled();
    } finally { reconstruct.mockRestore(); birth.mockRestore(); }
  });

  it('proves stored presets and pending imports by digest on the trusted path only', async () => {
    const spies = [vi.spyOn(validation, 'checkCustomPresetWork'), vi.spyOn(validation, 'checkMigratedStateWork'), vi.spyOn(validation, 'checkPendingImportWork')];
    try {
      await prepare({ type: 'activate-project', projectId: h.a.id }, true);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      await prepare({ type: 'activate-project', projectId: h.a.id }, false);
      for (const spy of spies) expect(spy).toHaveBeenCalled();
    } finally { for (const spy of spies) spy.mockRestore(); }
  });

  it('refuses a stored preset whose content changed under an intact descriptor', async () => {
    const captured = await capture();
    captured.presets = captured.presets.map((row: any) => row.id === 'saved' ? { ...row, preset: { ...row.preset, title: 'Changed' } } : row);
    await expect(prepare({ type: 'activate-project', projectId: h.a.id }, true, captured)).rejects.toThrow('Preset descriptor mismatch');
  });

  it('refuses a stored pending import whose content changed under an intact descriptor', async () => {
    const captured = await capture();
    captured.pendingImports = captured.pendingImports.map((row: any) => row.id === 'kept'
      ? { ...row, pendingImport: { ...row.pendingImport, state: { ...row.pendingImport.state, activeVariantId: 'changed' } } } : row);
    await expect(prepare({ type: 'activate-project', projectId: h.a.id }, true, captured)).rejects.toThrow('Import descriptor mismatch');
  });
});

describe('fast close commits', () => {
  let h: Awaited<ReturnType<typeof createWorkspaceCommandHarness>>;
  beforeEach(async () => { h = await createWorkspaceCommandHarness(); });
  afterEach(() => h?.adapter.close());

  it('deletes every record of the closed project', async () => {
    await h.commit({ type: 'create-and-activate-project', project: { ...makeIncrementalProject(3), id: 'closing' } });
    expect((await h.commit({ type: 'close-project', projectId: 'closing' })).outcome).toBe('closed');
    const rows = await physicalRows(h, NORMALIZED_STORE_NAMES.filter(store => store !== 'normalizationLedger'));
    for (const store of Object.keys(rows)) expect(rows[store].filter((row: any) => row.key?.[1] === 'closing')).toEqual([]);
  });

  it('refuses a close when a record of the closing project changed between capture and seal', async () => {
    await h.commit({ type: 'create-and-activate-project', project: { ...makeIncrementalProject(3), id: 'raced' } });
    const [record] = (await physicalRows(h, ['projectNodes'])).projectNodes.filter((row: any) => row.key[1] === 'raced');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = h.indexedDB.open(h.databaseName); opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error);
    });
    const metered = vi.spyOn(proofs, 'recordFrame');
    try {
      h.environment.workspaceFault = point => {
        if (point.phase === 'before-cas') db.transaction('projectNodes', 'readwrite').objectStore('projectNodes').put({ ...record, value: { ...record.value, title: 'Raced' } });
      };
      await expect(h.commit({ type: 'close-project', projectId: 'raced' })).rejects.toThrow('Workspace captured record changed');
      // The seal compared the project rows natively, not through metered record frames.
      expect(metered).not.toHaveBeenCalled();
    } finally { metered.mockRestore(); h.environment.workspaceFault = undefined; db.close(); }
    expect((await physicalRows(h, ['projectHeaders'])).projectHeaders.some((row: any) => row.key[1] === 'raced')).toBe(true);
  });
});

describe('trusted reconstruction reuse', () => {
  let h: Awaited<ReturnType<typeof createWorkspaceCommandHarness>>;
  beforeEach(async () => { h = await createWorkspaceCommandHarness(); });
  afterEach(() => h?.adapter.close());

  it('reconstructs an unchanged project once and a saved edit again', async () => {
    const created = await h.commit({ type: 'create-and-activate-project', project: { ...makeIncrementalProject(2), id: 'edited' } });
    const material = created.projects[0];
    const repository = createNormalizedRepository(h.environment);
    const reconstruct = vi.spyOn(codec, 'reconstructProject');
    try {
      const first = await repository.readTrustedActiveSnapshot(); const calls = reconstruct.mock.calls.length;
      expect(calls).toBeGreaterThan(0);
      expect(await repository.readTrustedActiveSnapshot()).toEqual(first);
      expect(reconstruct.mock.calls.length).toBe(calls);
      await h.repository.bindAdmittedProject(material.records);
      const root = first!.snapshot.projects.find(project => project.id === 'edited')!.initialState.nodes.root;
      await h.repository.commitDocument({ scope: material.scope, clientId: 'reuse', commitGeneration: 1, commitId: 'edit-1', editorGeneration: 1,
        expectedRevision: 0, changes: [{ type: 'put-node', node: { ...root, title: 'Saved edit' } }] });
      const beforeRead = reconstruct.mock.calls.length, after = await repository.readTrustedActiveSnapshot();
      // Only the edited project is reconstructed again.
      expect(reconstruct.mock.calls.length).toBe(beforeRead + 1);
      expect(after!.snapshot.projects.find(project => project.id === 'edited')!.initialState.nodes.root.title).toBe('Saved edit');
      expect(after).toEqual(await repository.readActiveSnapshot());
    } finally { reconstruct.mockRestore(); }
  });

  it('reconstructs again when a row changed outside a commit, header and preferences intact', async () => {
    await h.commit({ type: 'create-and-activate-project', project: { ...makeIncrementalProject(2), id: 'tampered' } });
    const repository = createNormalizedRepository(h.environment);
    await repository.readTrustedActiveSnapshot();
    const [row] = (await physicalRows(h, ['projectNodes'])).projectNodes.filter((record: any) => record.key[1] === 'tampered');
    row.value.title = 'Changed without a commit';
    await mutateRow(h, 'projectNodes', store => store.put(row));
    const reconstruct = vi.spyOn(codec, 'reconstructProject');
    try {
      await repository.readTrustedActiveSnapshot().catch(() => undefined);
      expect(reconstruct.mock.calls.some(([records]) => (records as NormalizedProject).scope.projectId === 'tampered')).toBe(true);
    } finally { reconstruct.mockRestore(); }
  });

  it('hands out copies a caller cannot use to change a later read', async () => {
    const repository = createNormalizedRepository(h.environment);
    const first = await repository.readTrustedActiveSnapshot();
    (first!.snapshot.projects[0].initialState as any).schemaVersion = -1;
    expect((await repository.readTrustedActiveSnapshot())!.snapshot.projects[0].initialState.schemaVersion).not.toBe(-1);
  });
});
