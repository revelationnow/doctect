// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNormalizationHarness, mutateRow, physicalRows } from '../../../helpers/normalizationHarness';
import { createWorkspaceCommandHarness } from '../../../helpers/workspaceCommandHarness';
import type { WorkspaceRepositoryMethods } from '../../../../services/localWorkspace/normalized/workspaceCommands';
import * as commands from '../../../../services/localWorkspace/normalized/workspaceCommands';
import type { WorkspaceBatch, WorkspaceLifecycleIntent } from '../../../../services/localWorkspace/normalized/workspaceCommands';
import { NORMALIZED_STORE_NAMES, type NormalizedProject, type ProjectStoreName } from '../../../../services/localWorkspace/normalized/schema';
import { makeWorkHarness } from '../../../helpers/normalizationWorkHarness';
import { makeIncrementalProject } from '../../../helpers/incrementalFixtures';
import { testHash } from '../../../helpers/incrementalStoreHarness';
import { createPlannerProject } from '../../../../services/presets';

describe('workspace admission', () => {
  it('returns authentic metadata and both lane stamps from the same sealed capture', async () => {
    const h = await createNormalizationHarness();
    try {
      expect((await h.run()).status).toBe('active');
      const repository = h.repository as typeof h.repository & WorkspaceRepositoryMethods;
      expect(typeof repository.admitWorkspace).toBe('function');
      const admitted = await repository.admitWorkspace();
      const rows = await physicalRows(h, ['workspace', 'projectHeaders', 'projectPreferences']);
      expect(admitted.catalog.stamp).toEqual({ revision: rows.workspace[0].revision, coreDigest: rows.workspace[0].coreDigest });
      expect(admitted.catalog.members.map(row => row.projectId)).toEqual(rows.workspace[0].members.map(row => row.projectId));
      expect(Reflect.ownKeys(admitted.token)).toEqual([]); expect(Object.isFrozen(admitted.token)).toBe(true);
      for (const item of admitted.projectAuthorities) {
        const header = rows.projectHeaders.find(row => row.key[1] === item.scope.projectId);
        const prefs = rows.projectPreferences.find(row => row.key[1] === item.scope.projectId);
        expect(item.authority).toEqual({ documentRevision: header.storageRevision,
          preferenceRevision: prefs.revision, foldStructureGeneration: header.foldStructureGeneration });
      }
      expect(admitted).not.toHaveProperty('snapshot');
      expect((await repository.admitWorkspace()).token).not.toBe(admitted.token);
    } finally { h.adapter.close(); }
  });

  it('does not grant ordinary project editing merely by admitting the workspace', async () => {
    const h = await createNormalizationHarness();
    try {
      expect((await h.run()).status).toBe('active');
      const repository = h.repository as typeof h.repository & WorkspaceRepositoryMethods;
      expect(typeof repository.admitWorkspace).toBe('function');
      const admitted = await repository.admitWorkspace(); const scope = admitted.catalog.members[0];
      await expect(repository.commitDocument({ scope, clientId: 'not-bootstrapped', commitGeneration: 1,
        commitId: 'no-project-token', editorGeneration: 1, expectedRevision: admitted.projectAuthorities[0].authority.documentRevision,
        changes: [] })).rejects.toThrow('ingress-required');
    } finally { h.adapter.close(); }
  });

  it('refuses a workspace that has not been activated', async () => {
    const h = await createNormalizationHarness();
    try {
      await h.adapter.open();
      const repository = h.repository as typeof h.repository & WorkspaceRepositoryMethods;
      expect(typeof repository.admitWorkspace).toBe('function');
      await expect(repository.admitWorkspace()).rejects.toThrow('ingress-required');
    } finally { h.adapter.close(); }
  });

  it('admits one atomic snapshot that a later physical mutation cannot mix into', async () => {
    const h = await createNormalizationHarness();
    try {
      expect((await h.run()).status).toBe('active');
      const repository = h.repository as typeof h.repository & WorkspaceRepositoryMethods;
      expect(typeof repository.admitWorkspace).toBe('function');
      const before = await physicalRows(h, ['projectHeaders']);
      let changed = false;
      h.environment.normalizationPause = async ({ phase, point }) => {
        if (phase !== 'reopen' || point !== 'after-page' || changed) return;
        changed = true;
        await mutateRow(h, 'projectHeaders', store => store.put({ ...before.projectHeaders[0], storageRevision: before.projectHeaders[0].storageRevision + 7 }));
      };
      const admitted = await repository.admitWorkspace(); expect(changed).toBe(true);
      expect(admitted.projectAuthorities[0].authority.documentRevision).toBe(before.projectHeaders[0].storageRevision);
    } finally { h.adapter.close(); }
  });
});

it('activates current membership without rewriting project payload or retained source', async () => {
  const h = await createWorkspaceCommandHarness();
  try {
    const retained = (await h.repository.readRetainedSource()).snapshot;
    const before = await physicalRows(h);
    const result = await h.commit({ type: 'activate-project', projectId: h.b.id });
    expect(result.outcome).toBe('activated'); expect(result.projects).toEqual([]);
    expect(await physicalRows(h)).toEqual(before);
    expect((await h.repository.readActiveSnapshot())!.snapshot.activeProjectId).toBe(h.b.id);
    expect((await h.repository.readRetainedSource()).snapshot).toEqual(retained);
  } finally { h.adapter.close(); }
});

describe('workspace command capture', () => {
  const input = (): WorkspaceBatch => ({ storageGeneration: 'g', identity: { clientId: 'c', commandId: 'one', commandSequence: 1 },
    expected: { revision: 0, coreDigest: testHash('before') }, targets: [],
    intent: { type: 'create-and-activate-project', project: makeIncrementalProject(2) } });
  const api = () => { expect(typeof commands.captureWorkspaceBatch).toBe('function'); return commands; };

  it('detaches caller data before the first suspension and releases ownership explicitly', async () => {
    const capture = api(), value = input(), w = makeWorkHarness();
    const pending = capture.captureWorkspaceBatch(value, w.runtime);
    (value.intent as { project: { name: string } }).project.name = 'changed after call';
    const result = await pending;
    try {
      expect((result.batch.intent as { project: { name: string } }).project.name).not.toBe('changed after call');
      expect(result.batch).not.toBe(value); expect(w.runtime.snapshot().ownedBytes).toBeGreaterThan(0);
    } finally { result.release(); }
    expect(w.runtime.snapshot().ownedBytes).toBe(0); expect(w.runtime.snapshot().captureGraphs).toBe(0);
  });

  it.each(['save-project', 'recover-legacy-as-copies', 'unknown'])('rejects unsupported %s before reading payload', async type => {
    const capture = api(), value: any = input(), w = makeWorkHarness(); let read = 0;
    value.intent = { type, get project() { read++; throw Error('payload touched'); } };
    await expect(capture.captureWorkspaceBatch(value, w.runtime)).rejects.toThrow(); expect(read).toBe(0);
    expect(w.runtime.snapshot().ownedBytes).toBe(0);
  });

  it.each([
    ['invalid private ID', (b: any) => { b.identity.clientId = '界'.repeat(100); }],
    ['unsafe sequence', (b: any) => { b.identity.commandSequence = Number.MAX_SAFE_INTEGER + 1; }],
    ['unknown batch field', (b: any) => { b.extra = true; }],
    ['bad digest', (b: any) => { b.expected.coreDigest = 'no'; }],
    ['wrong targets', (b: any) => { b.targets = [{ type: 'member', scope: { storageGeneration: 'g', projectId: 'p', incarnation: 'i' } }]; }],
    ['missing close stamp', (b: any) => { b.intent = { type: 'close-project', projectId: 'p' }; b.targets = [{ type: 'member', scope: { storageGeneration: 'g', projectId: 'p', incarnation: 'i' } }]; }],
  ])('refuses malformed framing: %s', async (_label, change) => {
    const capture = api(), value = input(), w = makeWorkHarness(); change(value);
    await expect(capture.captureWorkspaceBatch(value, w.runtime)).rejects.toThrow();
    expect(w.runtime.snapshot().ownedBytes).toBe(0); expect(w.runtime.snapshot().captureGraphs).toBe(0);
  });

  it('releases a captured clone on cancellation during its cooperative validation', async () => {
    const capture = api(), value: any = input(), w = makeWorkHarness();
    value.intent.project.retained = 'x'.repeat(100_000);
    w.observe(event => { if (event.counters.yields > 0) w.cancel(); });
    await expect(capture.captureWorkspaceBatch(value, w.runtime)).rejects.toMatchObject({ name: 'AbortError' });
    expect(w.runtime.snapshot().ownedBytes).toBe(0); expect(w.runtime.snapshot().captureGraphs).toBe(0);
  });
});

describe('workspace command preparation', () => {
  let h: Awaited<ReturnType<typeof createWorkspaceCommandHarness>>;
  let captured: any;
  let sequence = 0;
  const projectStores = NORMALIZED_STORE_NAMES.filter((name): name is ProjectStoreName => name !== 'normalizationLedger');
  beforeAll(async () => {
    h = await createWorkspaceCommandHarness();
    const rows = await physicalRows(h, [...NORMALIZED_STORE_NAMES, 'workspace', 'presets', 'pendingImports']);
    const manifest = rows.workspace[0];
    const projects = manifest.members.map(member => ({ scope: { storageGeneration: manifest.storageGeneration,
      projectId: member.projectId, incarnation: member.incarnation },
      ...Object.fromEntries(NORMALIZED_STORE_NAMES.map(store => [store, store === 'normalizationLedger' ? new Map()
        : new Map(rows[store].filter(row => row.key[1] === member.projectId).map(row => [JSON.stringify(row.key), row]))])) } as NormalizedProject));
    captured = { manifest, initial: { revision: rows.normalizationLedger[0].sourceWorkspaceRevision,
      coreDigest: rows.normalizationLedger[0].initialWorkspaceDigest }, memberHeaders: rows.projectHeaders,
      projects, presets: rows.presets, pendingImports: rows.pendingImports };
  });
  afterAll(() => h?.adapter.close());
  const batch = (intent: WorkspaceLifecycleIntent): WorkspaceBatch => {
    const value = h.request(intent); return { ...value, identity: { clientId: 'preparation', commandId: `prepare-${++sequence}`, commandSequence: sequence } };
  };
  const prepare = async (intent: WorkspaceLifecycleIntent, context = captured) => {
    expect(typeof commands.prepareWorkspaceMutation).toBe('function');
    const w = makeWorkHarness(); const request = { ...batch(intent), expected: { revision: context.manifest.revision, coreDigest: context.manifest.coreDigest } };
    const input = await commands.captureWorkspaceBatch(request, w.runtime);
    try {
      const result = await commands.prepareWorkspaceMutation(context, input.batch, h.preparation.now(), w.runtime);
      return { result, w, request, release() { result.release(); input.release(); } };
    } catch (error) { input.release(); throw error; }
  };
  const after = (prepared: commands.PreparedWorkspaceMutation, previous = captured) => {
    const merge = (rows: any[], removed: readonly string[], puts: readonly any[]) => {
      const values = new Map(rows.map(row => [row.id, row]));
      for (const id of removed) values.delete(id); for (const row of puts) values.set(row.id, row);
      return [...values.values()].sort((a, b) => a.position - b.position);
    };
    const projects = [...previous.projects.filter(project => !prepared.removeProjects.some(scope => scope.projectId === project.scope.projectId)), ...prepared.addProjects];
    for (const scope of prepared.removeProjects) projects.push({ scope, ...Object.fromEntries(NORMALIZED_STORE_NAMES.map(store => [store, new Map()])) });
    return { ...previous, manifest: prepared.manifest, projects,
      memberHeaders: projects.flatMap(project => [...project.projectHeaders.values()]),
      presets: merge(previous.presets, prepared.deletePresetIds, prepared.putPresets),
      pendingImports: merge(previous.pendingImports, prepared.deleteImportIds, prepared.putImports) };
  };

  it('prepares activation metadata without project writes or input mutation', async () => {
    const before = structuredClone(captured.manifest);
    const p = await prepare({ type: 'activate-project', projectId: h.b.id });
    try {
      expect(p.result.manifest.activeProjectId).toBe(h.b.id);
      expect(p.result.manifest.revision).toBe(before.revision + 1);
      expect(p.result.addProjects).toEqual([]); expect(p.result.removeProjects).toEqual([]);
      expect(p.result.manifest.lastCommit!.identity).toEqual(p.request.identity);
      expect(captured.manifest).toEqual(before);
    } finally { p.release(); }
    expect(p.w.runtime.snapshot().ownedBytes).toBe(0);
  });

  it('prepares a new independent birth while preserving public extensions and raw folds', async () => {
    const project = { ...makeIncrementalProject(2), id: 'born', extra: { retained: true } };
    const p = await prepare({ type: 'create-and-activate-project', project });
    try {
      expect(p.result.addProjects).toHaveLength(1);
      const image = p.result.addProjects[0], member = p.result.manifest.members.at(-1)!;
      const header = image.projectHeaders.values().next().value!;
      expect(member.birth.kind).toBe('workspace-command'); expect(header.workspaceBirth!.identity).toEqual(p.request.identity);
      expect(header.migrationBaseline).toBeUndefined(); expect(header.storageRevision).toBe(0);
      expect([...image.projectExtensions.values()].find(row => row.key[3] === 'wrapper')?.value.extra).toEqual({ retained: true });
      expect(p.result.manifest.activeProjectId).toBe(project.id);
    } finally { p.release(); }
  });

  it('prepares only the target incarnation for close and selects the preceding survivor', async () => {
    const p = await prepare({ type: 'close-project', projectId: h.b.id });
    try {
      expect(p.result.removeProjects).toEqual([h.catalog().members[1]]);
      expect(p.result.manifest.members.map(member => member.projectId)).toEqual([h.a.id]);
      expect(p.result.manifest.activeProjectId).toBe(h.a.id);
    } finally { p.release(); }
  });

  it('prepares preset and staged import rows with independent record and payload digests', async () => {
    const project = makeIncrementalProject(2);
    const preset = await prepare({ type: 'save-custom-preset', preset: { id: 'preset-new', title: 'Preset', desc: '', isCustom: true, initialState: project.initialState } });
    try { expect(preset.result.putPresets[0].id).toBe('preset-new'); expect(preset.result.addProjects).toEqual([]); }
    finally { preset.release(); }
    const staged = await prepare({ type: 'stage-import', pendingImport: { id: 'pending-new', targetProjectId: 'target-new',
      name: 'Import', state: project.initialState, createdAt: h.preparation.now() },
      attemptProvenance: { sourceKeyDigest: testHash('source'), payloadDigest: testHash('payload') } });
    try {
      const row = staged.result.putImports[0], descriptor = staged.result.manifest.pendingImports.at(-1)!;
      expect(row.attemptProvenance!.pendingImportDigest).toBe(descriptor.pendingImportDigest);
      expect(descriptor.recordDigest).not.toBe(descriptor.pendingImportDigest);
      expect(staged.result.addProjects).toEqual([]);
    } finally { staged.release(); }
  });

  it('prepares import consumption through real stored pending provenance', async () => {
    expect(typeof commands.prepareWorkspaceMutation).toBe('function');
    const project = makeIncrementalProject(2);
    const staged = await prepare({ type: 'stage-import', pendingImport: { id: 'consume-me', targetProjectId: 'consumed-target',
      name: 'Import', state: project.initialState, createdAt: h.preparation.now() } });
    try {
      const w = makeWorkHarness(); const request: WorkspaceBatch = { storageGeneration: staged.result.manifest.storageGeneration,
        expected: { revision: staged.result.manifest.revision, coreDigest: staged.result.manifest.coreDigest },
        identity: { clientId: 'preparation', commandId: 'consume', commandSequence: 100 }, targets: [], intent: { type: 'consume-import', importId: 'consume-me' } };
      const result = await commands.prepareWorkspaceMutation({ ...captured, manifest: staged.result.manifest,
        pendingImports: staged.result.putImports }, request, h.preparation.now(), w.runtime);
      try {
        expect(result.addProjects).toHaveLength(1); expect(result.deleteImportIds).toEqual(['consume-me']);
        expect(result.manifest.members.at(-1)!.consumedImport.consumedImportId).toBe('consume-me');
        expect(result.manifest.activeProjectId).toBe('consumed-target');
      } finally { result.release(); }
    } finally { staged.release(); }
  });

  it('never permits preparation to write physical stores', async () => {
    const before = await physicalRows(h, [...projectStores, 'workspace', 'presets', 'pendingImports']);
    const p = await prepare({ type: 'activate-project', projectId: h.b.id }); p.release();
    expect(await physicalRows(h, [...projectStores, 'workspace', 'presets', 'pendingImports'])).toEqual(before);
  });

  it('independently verifies a created image and rejects later target edits', async () => {
    expect(typeof commands.verifyWorkspacePostconditions).toBe('function');
    const p = await prepare({ type: 'create-and-activate-project', project: { ...makeIncrementalProject(2), id: 'verified-birth' } });
    try {
      const current = after(p.result), w = makeWorkHarness();
      const checked = await commands.verifyWorkspacePostconditions(p.result.batch, current, p.result.manifest.lastCommit!, w.runtime);
      expect(checked.outcome).toBe('created'); expect(checked.projects).toHaveLength(1);
      expect(checked.catalog.stamp).toEqual(p.result.delta.after);
      const changed = structuredClone(current);
      const project = changed.projects.find(project => project.scope.projectId === 'verified-birth');
      project.projectHeaders.values().next().value.storageRevision++;
      await expect(commands.verifyWorkspacePostconditions(p.result.batch, changed, p.result.manifest.lastCommit!, makeWorkHarness().runtime)).rejects.toThrow();
    } finally { p.release(); }
  });

  it('recovers exact staged outcome from its digest and refuses missing current postconditions', async () => {
    expect(typeof commands.verifyWorkspacePostconditions).toBe('function');
    const p = await prepare({ type: 'stage-import', pendingImport: { id: 'verified-stage', targetProjectId: 'later', name: 'Import',
      state: makeIncrementalProject(2).initialState, createdAt: h.preparation.now() } });
    try {
      const current = after(p.result);
      const checked = await commands.verifyWorkspacePostconditions(p.result.batch, current, p.result.manifest.lastCommit!, makeWorkHarness().runtime);
      expect(checked.outcome).toBe('staged'); expect(checked.projects).toEqual([]);
      await expect(commands.verifyWorkspacePostconditions(p.result.batch, { ...current, pendingImports: [] }, p.result.manifest.lastCommit!, makeWorkHarness().runtime)).rejects.toThrow();
    } finally { p.release(); }
  });

  it('deletes a preset and prepares exact later-position compaction', async () => {
    const preset = (id: string) => ({ id, title: id, desc: '', isCustom: true as const, initialState: makeIncrementalProject(2).initialState });
    const first = await prepare({ type: 'save-custom-preset', preset: preset('first') });
    try {
      const one = after(first.result), second = await prepare({ type: 'save-custom-preset', preset: preset('second') }, one);
      try {
        const two = after(second.result, one), deleted = await prepare({ type: 'delete-custom-preset', presetId: 'first' }, two);
        try {
          expect(deleted.result.deletePresetIds).toEqual(['first']);
          expect(deleted.result.putPresets.map(row => [row.id, row.position])).toEqual([['second', 0]]);
          const checked = await commands.verifyWorkspacePostconditions(deleted.result.batch, after(deleted.result, two), deleted.result.manifest.lastCommit!, makeWorkHarness().runtime);
          expect(checked.outcome).toBe('preset-deleted');
        } finally { deleted.release(); }
      } finally { second.release(); }
    } finally { first.release(); }
  });

  it.each([
    ['planner create', () => ({ type: 'create-and-activate-project', project: { id: 'planner', name: 'Planner 2026', initialState: createPlannerProject() } })],
    ['unicode create', () => {
      const project = makeIncrementalProject(1); const root = project.initialState.nodes[project.initialState.rootId];
      root.title = 'Café 雪 😀 lone \ud800 tail \udc00 "quote" \\ back\nline\u0001'; root.data = { ...root.data, '😀 key': 'value\u2028', '': '' };
      return { type: 'create-and-activate-project', project };
    }],
    ['stage import', () => ({ type: 'stage-import', pendingImport: { id: 'import', targetProjectId: 'target', name: 'Import',
      state: makeIncrementalProject(2).initialState, createdAt: h.preparation.now() }, attemptProvenance: { sourceKeyDigest: testHash('key'), payloadDigest: testHash('payload') } })],
    ['consume import', () => ({ type: 'consume-import', importId: 'import' })],
  ] as [string, () => WorkspaceLifecycleIntent][])('trusted request digest equals the metered digest: %s', async (_name, intent) => {
    const request = batch(intent()), w = makeWorkHarness();
    const sha256Hex = async (text: string) => Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))),
      byte => byte.toString(16).padStart(2, '0')).join('');
    expect(await commands.hashTrustedWorkspaceRequest(request, sha256Hex)).toBe(await commands.hashWorkspaceRequest(request, w.runtime));
  });

  it('replaces staged provenance in place and recognizes a new identical retry attempt', async () => {
    const sourceKeyDigest = testHash('source-key');
    const pendingImport = { id: 'old-import', targetProjectId: 'old-target', name: 'Old', state: makeIncrementalProject(2).initialState, createdAt: h.preparation.now() };
    const oldAttempt = { sourceKeyDigest, payloadDigest: testHash('old-payload') };
    const first = await prepare({ type: 'stage-import', pendingImport, attemptProvenance: oldAttempt });
    try {
      const one = after(first.result);
      const intent: WorkspaceLifecycleIntent = { type: 'replace-staged-import', expected: { importId: pendingImport.id,
        targetProjectId: pendingImport.targetProjectId, createdAt: pendingImport.createdAt, ...oldAttempt },
        replacement: { pendingImport: { ...pendingImport, id: 'new-import', targetProjectId: 'new-target', name: 'New' },
          attemptProvenance: { sourceKeyDigest, payloadDigest: testHash('new-payload') } } };
      const replacement = await prepare(intent, one);
      try {
        expect(replacement.result.deleteImportIds).toEqual(['old-import']);
        expect(replacement.result.putImports[0].position).toBe(first.result.putImports[0].position);
        const two = after(replacement.result, one), retry = await prepare(intent, two);
        try {
          expect(retry.result.outcome).toBe('already-staged'); expect(retry.result.putImports).toEqual([]);
          expect(retry.result.manifest.revision).toBe(two.manifest.revision + 1);
          const checked = await commands.verifyWorkspacePostconditions(retry.result.batch, after(retry.result, two), retry.result.manifest.lastCommit!, makeWorkHarness().runtime);
          expect(checked.outcome).toBe('already-staged');
        } finally { retry.release(); }
      } finally { replacement.release(); }
    } finally { first.release(); }
  });

  it('replaces the last closed member with a distinct validated successor', async () => {
    const first = await prepare({ type: 'close-project', projectId: h.b.id });
    try {
      const one = after(first.result);
      await expect(prepare({ type: 'close-project', projectId: h.a.id }, one)).rejects.toThrow('successor');
      const last = await prepare({ type: 'close-project', projectId: h.a.id,
        successor: { ...makeIncrementalProject(2), id: 'successor' } }, one);
      try {
        expect(last.result.manifest.members.map(row => row.projectId)).toEqual(['successor']);
        expect(last.result.removeProjects).toHaveLength(1); expect(last.result.addProjects).toHaveLength(1);
        const checked = await commands.verifyWorkspacePostconditions(last.result.batch, after(last.result, one), last.result.manifest.lastCommit!, makeWorkHarness().runtime);
        expect(checked.projects[0].scope.projectId).toBe('successor');
      } finally { last.release(); }
    } finally { first.release(); }
  });
});
