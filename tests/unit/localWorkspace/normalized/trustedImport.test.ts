// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSync } from '../../../../shared/cooperativeWork.js';
import { canonicalText } from '../../../../shared/jsonWork.js';
import { canonicalFrame, envelopeFrame, envelopeFrameText, hashFrame } from '../../../../services/localWorkspace/normalized/work';
import * as frames from '../../../../services/localWorkspace/normalized/work';
import * as commands from '../../../../services/localWorkspace/normalized/workspaceCommands';
import type { WorkspaceBatch, WorkspaceLifecycleIntent } from '../../../../services/localWorkspace/normalized/workspaceCommands';
import * as validation from '../../../../services/localWorkspace/validation';
import { preparePendingImport, preparePendingImportWork } from '../../../../services/localWorkspace/validation';
import { makeWorkHarness } from '../../../helpers/normalizationWorkHarness';
import { createWorkspaceCommandHarness } from '../../../helpers/workspaceCommandHarness';
import { mutateRow, physicalRows } from '../../../helpers/normalizationHarness';
import { makeIncrementalProject } from '../../../helpers/incrementalFixtures';
import { createPlannerProject } from '../../../../services/presets';
import { createNormalizedRepository, type ActiveRead } from '../../../../services/localWorkspace/normalized/repository';
import { NORMALIZED_STORE_NAMES, type NormalizedProject } from '../../../../services/localWorkspace/normalized/schema';
import type { StoredPendingImport } from '../../../../services/localWorkspace/schema';

const sha256Hex = async (text: string) => Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))),
  byte => byte.toString(16).padStart(2, '0')).join('');
const frameText = (frame: ReturnType<typeof envelopeFrame>) => {
  const chunks: string[] = [];
  runSync(frame(function* (text: string) { chunks.push(text); }));
  return chunks.join('');
};
/** A gallery project published before layers existed (schema 7). */
const legacyState = () => {
  const state = structuredClone(makeIncrementalProject(2).initialState) as any;
  state.schemaVersion = 7;
  for (const variant of Object.values(state.variants) as any[]) for (const template of Object.values(variant.templates) as any[]) {
    delete template.layers; for (const element of template.elements) delete element.layerId;
  }
  return state;
};
const pendingInput = (state: unknown, id = 'gallery-import') => ({ id, targetProjectId: `${id}-target`, name: 'Gallery 雪 😀', state,
  createdAt: '2026-10-14T00:00:00.000Z' });
const storedRow = (state: unknown): StoredPendingImport => ({ id: 'gallery-import', position: 0,
  pendingImport: preparePendingImport(pendingInput(state), { warningPolicy: 'retain' }),
  attemptProvenance: { sourceKeyDigest: 'a'.repeat(64), payloadDigest: 'b'.repeat(64), pendingImportDigest: 'c'.repeat(64) } });
const awkward = { b: 1, a: [1, { z: 1, y: 2 }], '😀 key': 'value ', '': '', 'lone \ud800': 'tail \udc00', 'Ä': null, 'a\u0000': 'nul' };

describe('trusted import twins', () => {
  it.each([['workspace-import-v1'], ['workspace-seal']])('envelopeFrameText(%s) is byte-identical to envelopeFrame', label => {
    for (const value of [awkward, storedRow(createPlannerProject()), storedRow(legacyState())]) {
      expect(envelopeFrameText(label, value)).toBe(frameText(envelopeFrame(label, value)));
    }
  });

  it('trustedImportDescriptor equals the metered import descriptor digests', async () => {
    for (const row of [storedRow(createPlannerProject()), storedRow(legacyState()), { ...storedRow(legacyState()), attemptProvenance: undefined } as any]) {
      if (row.attemptProvenance === undefined) delete row.attemptProvenance;
      const w = makeWorkHarness();
      const expected = { id: row.id, position: row.position, targetProjectId: row.pendingImport.targetProjectId, createdAt: row.pendingImport.createdAt,
        recordDigest: await hashFrame(w.runtime, 'proof', envelopeFrame('workspace-import-v1', row)),
        pendingImportDigest: await hashFrame(w.runtime, 'proof', canonicalFrame(row.pendingImport)),
        ...(Object.hasOwn(row, 'attemptProvenance') ? { attemptProvenance: { ...row.attemptProvenance } } : {}) };
      expect(await commands.trustedImportDescriptor(row, sha256Hex)).toEqual(expected);
    }
  });

  it('hash(canonicalText(x)) equals the metered canonical proof digest', async () => {
    for (const value of [awkward, storedRow(createPlannerProject()).pendingImport]) {
      expect(await sha256Hex(canonicalText(value))).toBe(await hashFrame(makeWorkHarness().runtime, 'proof', canonicalFrame(value)));
    }
  });

  it.each([['planner', () => createPlannerProject()], ['schema-7 pre-layer', legacyState]])(
    'preparePendingImport (sync) equals preparePendingImportWork for a %s state', async (_name, state) => {
      for (const warningPolicy of ['retain', 'reject'] as const) {
        const input = pendingInput(state());
        let sync: unknown, syncError: unknown, metered: unknown, meteredError: unknown;
        try { sync = preparePendingImport(structuredClone(input), { warningPolicy }); } catch (error) { syncError = error; }
        try { metered = await makeWorkHarness().runtime.run(preparePendingImportWork(structuredClone(input), { warningPolicy })); } catch (error) { meteredError = error; }
        expect(syncError).toBeUndefined();
        expect(String(syncError ?? '')).toBe(String(meteredError ?? ''));
        expect(sync).toEqual(metered);
      }
      const prepared = preparePendingImport(pendingInput(legacyState()), { warningPolicy: 'retain' }) as any;
      for (const variant of Object.values(prepared.state.variants) as any[]) for (const template of Object.values(variant.templates) as any[]) {
        expect(template.layers.map((layer: any) => layer.id)).toEqual(['layer_default']);
      }
    });

  it.each([
    ['numeric createdAt', (input: any) => ({ ...input, createdAt: 1 })],
    ['future schema', (input: any) => ({ ...input, state: { ...input.state, schemaVersion: 99 } })],
    ['missing name', (input: any) => { const { name: _name, ...rest } = input; return rest; }],
    ['extra field', (input: any) => ({ ...input, surprise: true })],
  ])('preparePendingImport rejects %s exactly like the metered preparation', async (_name, change) => {
    const input = change(pendingInput(legacyState()));
    let syncError: unknown, meteredError: unknown;
    try { preparePendingImport(structuredClone(input), { warningPolicy: 'retain' }); } catch (error) { syncError = error; }
    try { await makeWorkHarness().runtime.run(preparePendingImportWork(structuredClone(input), { warningPolicy: 'retain' })); } catch (error) { meteredError = error; }
    expect(syncError).toBeDefined();
    expect(String(syncError)).toBe(String(meteredError));
  });
});

describe('trusted import preparation', () => {
  let h: Awaited<ReturnType<typeof createWorkspaceCommandHarness>>;
  let sequence = 0;
  beforeAll(async () => { h = await createWorkspaceCommandHarness(); });
  afterAll(() => h?.adapter.close());
  /** The command capture prepareWorkspaceMutation sees, read from the harness's current physical rows. */
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
  /** Prepares one batch twice — metered, then trusted — and returns both results. */
  const preparePair = async (intent: WorkspaceLifecycleIntent) => {
    const captured = await capture(), now = h.preparation.now();
    const request: WorkspaceBatch = { ...h.request(intent), identity: { clientId: 'trusted-pair', commandId: `pair-${++sequence}`, commandSequence: sequence },
      expected: { revision: captured.manifest.revision, coreDigest: captured.manifest.coreDigest } };
    const run = async (trusted: boolean) => {
      const w = makeWorkHarness(); const input = await commands.captureWorkspaceBatch(request, w.runtime);
      try {
        const requestDigest = await commands.hashTrustedWorkspaceRequest(input.batch, sha256Hex);
        const result = await commands.prepareWorkspaceMutation(captured, input.batch, now, w.runtime, undefined,
          trusted ? { requestDigest, hash: sha256Hex } : undefined);
        const value = { manifest: result.manifest, outcome: result.outcome, putImports: result.putImports, deleteImportIds: result.deleteImportIds,
          delta: result.delta, addProjects: result.addProjects.map(project => Object.fromEntries(Object.entries(project).map(([key, map]) =>
            [key, map instanceof Map ? [...map] : map]))) };
        result.release(); return value;
      } finally { input.release(); }
    };
    return { metered: await run(false), trusted: await run(true) };
  };

  it.each([['planner', () => createPlannerProject()], ['schema-7 pre-layer', legacyState]])('stages a %s import exactly like the metered preparation', async (_name, state) => {
    const { metered, trusted } = await preparePair({ type: 'stage-import', pendingImport: pendingInput(state(), `stage-${sequence + 1}`),
      attemptProvenance: { sourceKeyDigest: 'd'.repeat(64), payloadDigest: 'e'.repeat(64) } });
    expect(trusted).toEqual(metered);
    expect(trusted.outcome).toBe('staged');
  });

  it('stages through the sync preparation only', async () => {
    const metered = vi.spyOn(validation, 'preparePendingImportWork'), sync = vi.spyOn(validation, 'preparePendingImport');
    try {
      const captured = await capture();
      const request: WorkspaceBatch = { ...h.request({ type: 'stage-import', pendingImport: pendingInput(legacyState(), 'sync-only') }),
        expected: { revision: captured.manifest.revision, coreDigest: captured.manifest.coreDigest } };
      const w = makeWorkHarness(); const input = await commands.captureWorkspaceBatch(request, w.runtime);
      try {
        const requestDigest = await commands.hashTrustedWorkspaceRequest(input.batch, sha256Hex);
        metered.mockClear(); sync.mockClear();
        (await commands.prepareWorkspaceMutation(captured, input.batch, h.preparation.now(), w.runtime, undefined, { requestDigest, hash: sha256Hex })).release();
      } finally { input.release(); }
      expect(metered).not.toHaveBeenCalled();
      expect(sync).toHaveBeenCalled();
    } finally { metered.mockRestore(); sync.mockRestore(); }
  });

  it('consumes beside another stored pending import exactly like the metered preparation', async () => {
    await h.commit({ type: 'stage-import', pendingImport: pendingInput(createPlannerProject(), 'kept') });
    await h.commit({ type: 'stage-import', pendingImport: pendingInput(legacyState(), 'eaten') });
    const { metered, trusted } = await preparePair({ type: 'consume-import', importId: 'eaten' });
    expect(trusted).toEqual(metered);
    expect(trusted.outcome).toBe('consumed');
  });

  it('consumes beside another stored pending import through the trusted capture check only', async () => {
    const pendingCheck = vi.spyOn(validation, 'checkPendingImportWork'), stateCheck = vi.spyOn(validation, 'checkMigratedStateWork');
    try {
      const captured = await capture();
      expect(captured.pendingImports.map((row: any) => row.id).sort()).toEqual(['eaten', 'kept']);
      const request: WorkspaceBatch = { ...h.request({ type: 'consume-import', importId: 'eaten' }),
        expected: { revision: captured.manifest.revision, coreDigest: captured.manifest.coreDigest } };
      const w = makeWorkHarness(); const input = await commands.captureWorkspaceBatch(request, w.runtime);
      try {
        const requestDigest = await commands.hashTrustedWorkspaceRequest(input.batch, sha256Hex);
        pendingCheck.mockClear(); stateCheck.mockClear();
        const result = await commands.prepareWorkspaceMutation(captured, input.batch, h.preparation.now(), w.runtime, undefined, { requestDigest, hash: sha256Hex });
        expect(result.outcome).toBe('consumed'); result.release();
      } finally { input.release(); }
      expect(pendingCheck).not.toHaveBeenCalled();
      expect(stateCheck).not.toHaveBeenCalled();
    } finally { pendingCheck.mockRestore(); stateCheck.mockRestore(); }
  });

  it('replaces a staged import exactly like the metered preparation', async () => {
    const sourceKeyDigest = 'f'.repeat(64), old = pendingInput(createPlannerProject(), 'replace-old');
    expect((await h.commit({ type: 'stage-import', pendingImport: old, attemptProvenance: { sourceKeyDigest, payloadDigest: '1'.repeat(64) } })).outcome).toBe('staged');
    const { metered, trusted } = await preparePair({ type: 'replace-staged-import',
      expected: { importId: old.id, targetProjectId: old.targetProjectId, createdAt: old.createdAt, sourceKeyDigest, payloadDigest: '1'.repeat(64) },
      replacement: { pendingImport: pendingInput(legacyState(), 'replace-new'), attemptProvenance: { sourceKeyDigest, payloadDigest: '2'.repeat(64) } } });
    expect(trusted).toEqual(metered);
    expect(trusted.outcome).toBe('replaced');
  });

  it('still refuses a corrupt descriptor on an untouched pending import', async () => {
    const captured = await capture();
    const kept = captured.manifest.pendingImports.find((row: any) => row.id === 'kept');
    expect(kept).toBeDefined();
    captured.manifest = { ...captured.manifest, pendingImports: captured.manifest.pendingImports.map((row: any) => row.id === 'kept' ? { ...row, recordDigest: '0'.repeat(64) } : row) };
    const request: WorkspaceBatch = { ...h.request({ type: 'activate-project', projectId: h.a.id }),
      expected: { revision: captured.manifest.revision, coreDigest: captured.manifest.coreDigest } };
    const w = makeWorkHarness(); const input = await commands.captureWorkspaceBatch(request, w.runtime);
    try {
      const requestDigest = await commands.hashTrustedWorkspaceRequest(input.batch, sha256Hex);
      await expect(commands.prepareWorkspaceMutation(captured, input.batch, h.preparation.now(), w.runtime, undefined, { requestDigest, hash: sha256Hex }))
        .rejects.toThrow();
    } finally { input.release(); }
  });

  it('refuses a changed pending import row whose manifest descriptor is intact', async () => {
    const captured = await capture();
    expect(captured.pendingImports.some((row: any) => row.id === 'kept')).toBe(true);
    captured.pendingImports = captured.pendingImports.map((row: any) => row.id === 'kept'
      ? { ...row, pendingImport: { ...row.pendingImport, name: `${row.pendingImport.name} (changed)` } } : row);
    const request: WorkspaceBatch = { ...h.request({ type: 'activate-project', projectId: h.a.id }),
      expected: { revision: captured.manifest.revision, coreDigest: captured.manifest.coreDigest } };
    const w = makeWorkHarness(); const input = await commands.captureWorkspaceBatch(request, w.runtime);
    try {
      const requestDigest = await commands.hashTrustedWorkspaceRequest(input.batch, sha256Hex);
      await expect(commands.prepareWorkspaceMutation(captured, input.batch, h.preparation.now(), w.runtime, undefined, { requestDigest, hash: sha256Hex }))
        .rejects.toThrow('Import descriptor mismatch');
    } finally { input.release(); }
  });
});

describe('trusted import commits', () => {
  let h: Awaited<ReturnType<typeof createWorkspaceCommandHarness>>;
  beforeEach(async () => { h = await createWorkspaceCommandHarness(); });
  afterEach(() => h?.adapter.close());

  it('verifies a fresh stage by readback equality, preparing the input once', async () => {
    const metered = vi.spyOn(validation, 'preparePendingImportWork'), sync = vi.spyOn(validation, 'preparePendingImport');
    try {
      const result = await h.commit({ type: 'stage-import', pendingImport: pendingInput(legacyState(), 'fresh') });
      expect(result.outcome).toBe('staged');
      expect(metered).not.toHaveBeenCalled();
      expect(sync.mock.calls.filter(([input]) => (input as { id?: string }).id === 'fresh')).toHaveLength(1);
    } finally { metered.mockRestore(); sync.mockRestore(); }
    const stored = (await physicalRows(h, ['pendingImports'])).pendingImports;
    expect(stored.map((row: any) => row.id)).toEqual(['fresh']);
  });

  it('refuses to acknowledge a stage whose durable readback differs from what was written', async () => {
    let fired = false;
    h.environment.workspaceReadResult = (operation, value) => {
      if (operation.phase !== 'verify-read' || operation.store !== 'pendingImports') return value;
      fired = true; const row = value as any; return { ...row, pendingImport: { ...row.pendingImport, name: 'Changed' } };
    };
    await expect(h.commit({ type: 'stage-import', pendingImport: pendingInput(legacyState(), 'tampered') })).rejects.toThrow('Pending import readback mismatch');
    expect(fired).toBe(true);
  });

  it('still answers a retried stage and a repeated consume with full verification', async () => {
    const pendingImport = pendingInput(legacyState(), 'retried');
    const attemptProvenance = { sourceKeyDigest: 'd'.repeat(64), payloadDigest: 'e'.repeat(64) };
    expect((await h.commit({ type: 'stage-import', pendingImport, attemptProvenance })).outcome).toBe('staged');
    const metered = vi.spyOn(validation, 'preparePendingImportWork');
    try {
      expect((await h.commit({ type: 'stage-import', pendingImport, attemptProvenance })).outcome).toBe('already-staged');
      expect(metered).toHaveBeenCalled();
    } finally { metered.mockRestore(); }
    expect((await h.commit({ type: 'consume-import', importId: 'retried' })).outcome).toBe('consumed');
    await h.commit({ type: 'activate-project', projectId: h.a.id });
    expect((await h.commit({ type: 'consume-import', importId: 'retried' })).outcome).toBe('already-consumed');
  });

  it('refuses a consume whose pending-import row changed between capture and seal', async () => {
    await h.commit({ type: 'stage-import', pendingImport: pendingInput(legacyState(), 'raced') });
    const [row] = (await physicalRows(h, ['pendingImports'])).pendingImports;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = h.indexedDB.open(h.databaseName); opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error);
    });
    const metered = vi.spyOn(frames, 'envelopeFrame');
    try {
      h.environment.workspaceFault = point => {
        // A transaction created now is ordered before the seal's own transaction on the same store.
        if (point.phase === 'before-cas') db.transaction('pendingImports', 'readwrite').objectStore('pendingImports')
          .put({ ...row, pendingImport: { ...row.pendingImport, name: 'Raced' } });
      };
      await expect(h.commit({ type: 'consume-import', importId: 'raced' })).rejects.toThrow('Workspace captured record changed');
      // The seal framed its other rows (ledger, manifest) the metered way but compared the pending-import row natively.
      const sealed = metered.mock.calls.filter(([label]) => label === 'workspace-seal');
      expect(sealed.length).toBeGreaterThan(0);
      expect(sealed.filter(([, value]) => Object.hasOwn(value, 'pendingImport'))).toHaveLength(0);
    } finally { metered.mockRestore(); h.environment.workspaceFault = undefined; db.close(); }
  });

  it('stores the same rows through the trusted commit as the metered preparation describes', async () => {
    await h.commit({ type: 'stage-import', pendingImport: pendingInput(legacyState(), 'bytes') });
    const [row] = (await physicalRows(h, ['pendingImports'])).pendingImports;
    const [workspace] = (await physicalRows(h, ['workspace'])).workspace;
    const descriptor = workspace.pendingImports.find((value: any) => value.id === 'bytes');
    const w = makeWorkHarness();
    expect(descriptor.recordDigest).toBe(await hashFrame(w.runtime, 'proof', envelopeFrame('workspace-import-v1', row)));
    expect(descriptor.pendingImportDigest).toBe(await hashFrame(w.runtime, 'proof', canonicalFrame(row.pendingImport)));
    expect(row.pendingImport).toEqual(await makeWorkHarness().runtime.run(preparePendingImportWork(pendingInput(legacyState(), 'bytes'), { warningPolicy: 'retain' })));
  });
});

describe('trusted active read', () => {
  let h: Awaited<ReturnType<typeof createWorkspaceCommandHarness>>;
  beforeEach(async () => { h = await createWorkspaceCommandHarness(); });
  afterEach(() => h?.adapter.close());
  const both = async () => {
    const repository = createNormalizedRepository(h.environment);
    return { metered: await repository.readActiveSnapshot(), trusted: await repository.readTrustedActiveSnapshot() };
  };
  const project = (read: ActiveRead | undefined, id: string) => read!.snapshot.projects.find(value => value.id === id)!;
  /** The trusted read and the trusted open (admitWorkspace) refuse the same durable corruption with the same message. */
  const refusesBoth = async (message: string) => {
    await expect(createNormalizedRepository(h.environment).readTrustedActiveSnapshot()).rejects.toThrow(message);
    await expect(createNormalizedRepository(h.environment).admitWorkspace()).rejects.toThrow(message);
  };

  it('returns exactly the metered active read after stage, consume, a preset save and a saved edit', async () => {
    await h.commit({ type: 'stage-import', pendingImport: pendingInput(createPlannerProject(), 'planner') });
    let { metered, trusted } = await both(); expect(trusted).toEqual(metered);
    await h.commit({ type: 'consume-import', importId: 'planner' });
    ({ metered, trusted } = await both()); expect(trusted).toEqual(metered);
    await h.commit({ type: 'save-custom-preset', preset: { id: 'preset', title: 'Preset', desc: '', isCustom: true, initialState: makeIncrementalProject(2).initialState } });
    ({ metered, trusted } = await both()); expect(trusted).toEqual(metered);
    const created = await h.commit({ type: 'create-and-activate-project', project: { ...makeIncrementalProject(2), id: 'edited' } });
    const material = created.projects[0];
    await h.repository.bindAdmittedProject(material.records);
    ({ metered, trusted } = await both()); expect(trusted).toEqual(metered);
    const root = project(metered, 'edited').initialState.nodes.root;
    await h.repository.commitDocument({ scope: material.scope, clientId: 'trusted-read', commitGeneration: 1, commitId: 'edit-1', editorGeneration: 1,
      expectedRevision: 0, changes: [{ type: 'put-node', node: { ...root, title: 'Saved edit' } }] });
    ({ metered, trusted } = await both());
    expect(trusted).toEqual(metered);
    expect(project(trusted, 'edited').initialState.nodes.root.title).toBe('Saved edit');
  }, 360_000);

  it('refuses an active generation without exactly one workspace row', async () => {
    await mutateRow(h, 'workspace', store => store.clear());
    await expect(createNormalizedRepository(h.environment).readTrustedActiveSnapshot()).rejects.toThrow('Invalid active workspace');
  });

  it('refuses a preferences row whose fold record digest no longer matches its fold record, like trusted open', async () => {
    const scope = h.catalog().members.find(member => member.projectId === h.a.id)!;
    await h.repository.openAdmittedProject(scope);
    await h.repository.commitPreferences({ scope, clientId: 'trusted-read', commitId: 'pref-1', commitGeneration: 1, editorGeneration: 1,
      observedPreferenceRevision: 0, patch: { scale: 2 } });
    const row = (await physicalRows(h, ['projectPreferences'])).projectPreferences.find((row: any) => row.key[1] === h.a.id);
    expect(row.revision).toBe(1);
    await mutateRow(h, 'projectPreferences', store => store.put({ ...row, foldRecordDigest: 'f'.repeat(64) }));
    await refusesBoth('Fold record mismatch');
  });

  it('refuses a stored preset whose position differs from its manifest descriptor, like trusted open', async () => {
    await h.commit({ type: 'save-custom-preset', preset: { id: 'preset', title: 'Preset', desc: '', isCustom: true, initialState: makeIncrementalProject(2).initialState } });
    const [row] = (await physicalRows(h, ['presets'])).presets;
    await mutateRow(h, 'presets', store => store.put({ ...row, position: row.position + 1 }));
    await refusesBoth('Active ancillary descriptor mismatch');
  });

  it('refuses a missing pending-import row whose manifest descriptor remains, like trusted open', async () => {
    await h.commit({ type: 'stage-import', pendingImport: pendingInput(legacyState(), 'orphaned') });
    await mutateRow(h, 'pendingImports', store => store.delete('orphaned'));
    await refusesBoth('Active ancillary membership mismatch');
  });
});
