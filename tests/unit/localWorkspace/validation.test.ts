import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_SCHEMA_VERSION } from '../../../services/migration';
import {
  PERSISTENCE_ROLLOUT_EPOCH,
  WORKSPACE_DB_NAME,
  WORKSPACE_DB_VERSION,
  WORKSPACE_MIGRATION_ID,
} from '../../../services/localWorkspace/schema';
import {
  preparePendingImport,
  prepareProjectState,
  validateCustomPreset,
  validateMigratedState,
  validateWorkspaceProject,
  prepareProjectStateWork, validateMigratedStateWork, validateWorkspaceProjectWork,
  validatePreparedWorkspaceProject, validatePreparedWorkspaceProjectWork, validateCustomPresetWork, preparePendingImportWork,
  checkMigratedStateWork, checkWorkspaceProjectWork, checkCustomPresetWork, checkPendingImportWork,
} from '../../../services/localWorkspace/validation';
import { makeWorkHarness } from '../../helpers/normalizationWorkHarness';
import {
  LEGACY_KEYS,
  currentState,
  historicalState,
  legacySnapshot,
  workspaceSnapshot,
} from '../../helpers/localWorkspaceFixtures';

const rejectWarnings = { warningPolicy: 'reject' as const };
const noExistingPresetIds = () => ({
  ...rejectWarnings,
  existingIds: new Set<string>(),
});

const project = () => ({
  id: 'project-1',
  name: '',
  initialState: currentState(),
  cloud: { projectId: 'cloud-1', lastSyncedCommitId: 'commit-1' },
  revision: 0,
  retained: { nested: ['value'] },
});

const preset = () => ({
  id: 'preset-1',
  title: '',
  desc: 'Description',
  color: 'text-amber-500',
  isCustom: true as const,
  initialState: currentState(),
  retained: { source: 'legacy' },
});

const pendingImport = () => ({
  id: 'import-1',
  targetProjectId: 'project-imported',
  name: '',
  state: currentState(),
  cloud: { projectId: 'cloud-import', lastSyncedCommitId: 'commit-import' },
  createdAt: '2026-08-14T12:34:56.000Z',
});

describe('cooperative project preparation', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(Array.from({ length: 12 }, (_, i) => i))('preserves schema %i preparation output and input', async version => {
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    const raw = historicalState(version), before = structuredClone(raw);
    const expected = prepareProjectState(raw, rejectWarnings);
    const actual = await makeWorkHarness().runtime.run(prepareProjectStateWork(raw, rejectWarnings));
    expect(actual).toEqual(expected); expect(raw).toEqual(before);
    expect(actual.state).not.toBe(raw);
  });

  it('retains schema-11 hydration and strict pre-migration rejection', async () => {
    const raw = currentState(); delete raw.variants.default.templates.page.elements[0].textPadding;
    const h = makeWorkHarness();
    expect(await h.runtime.run(prepareProjectStateWork(raw, rejectWarnings))).toEqual(prepareProjectState(raw, rejectWarnings));
    (raw.variants.default.templates.page.elements[0] as any).textWrap = 'bad';
    await expect(h.runtime.run(prepareProjectStateWork(raw, rejectWarnings))).rejects.toThrow('invalid before migration');
  });

  it('steps migrated-state validation without changing raw children', async () => {
    const raw = currentState(); raw.nodes.root.children = Array(2000).fill('root');
    const before = structuredClone(raw), h = makeWorkHarness();
    expect(await h.runtime.run(validateMigratedStateWork(raw))).toEqual(raw);
    expect(raw).toEqual(before); expect(h.runtime.snapshot().yields).toBeGreaterThan(0);
    expect(await h.runtime.run(checkMigratedStateWork(raw))).toBeUndefined();
  });

  it.each(['project', 'prepared', 'preset', 'import'] as const)('preserves independent %s results and extensions', async kind => {
    const raw: any = kind === 'preset' ? preset() : kind === 'import' ? pendingImport() : project();
    const before = structuredClone(raw), h = makeWorkHarness();
    const actual = kind === 'project' ? await h.runtime.run(validateWorkspaceProjectWork(raw))
      : kind === 'prepared' ? await h.runtime.run(validatePreparedWorkspaceProjectWork(raw))
      : kind === 'preset' ? await h.runtime.run(validateCustomPresetWork(raw, noExistingPresetIds()))
      : await h.runtime.run(preparePendingImportWork(raw, rejectWarnings));
    const expected = kind === 'project' ? validateWorkspaceProject(raw)
      : kind === 'prepared' ? validatePreparedWorkspaceProject(raw)
      : kind === 'preset' ? validateCustomPreset(raw, noExistingPresetIds()) : preparePendingImport(raw, rejectWarnings);
    expect(actual).toEqual(expected); expect(actual).not.toBe(raw); expect(raw).toEqual(before);
    const key = kind === 'import' ? 'state' : 'initialState';
    expect((actual as any)[key]).not.toBe(raw[key]);
    if (raw.retained) expect((actual as any).retained).not.toBe(raw.retained);
  });

  it.each(['project', 'preset', 'import'] as const)('checks %s on exactly one private state clone, without returning it', async kind => {
    const raw: any = kind === 'project' ? project() : kind === 'preset' ? preset() : pendingImport();
    const key = kind === 'import' ? 'state' : 'initialState';
    delete raw[key].variants.default.templates.page.elements[0].textPadding;
    const before = structuredClone(raw), clone = vi.spyOn(globalThis, 'structuredClone'), h = makeWorkHarness();
    const program = kind === 'project' ? checkWorkspaceProjectWork(raw)
      : kind === 'preset' ? checkCustomPresetWork(raw, noExistingPresetIds()) : checkPendingImportWork(raw, rejectWarnings);
    expect(await h.runtime.run(program)).toBeUndefined();
    expect(clone).toHaveBeenCalledTimes(1); expect(clone.mock.calls[0][0]).toBe(raw[key]);
    expect(raw).toEqual(before); expect(h.runtime.snapshot().ownedBytes).toBe(0);
    expect(h.runtime.snapshot().ownedHighWater).toBeGreaterThan(0);
  });

  it('matches alias duplication and nonfinite border conversion, and adds layers without random IDs, during owned checking', async () => {
    const raw: any = { ...project(), initialState: historicalState(6) };
    const templates = raw.initialState.variants.default.templates;
    templates.alias = templates.page;
    templates.page.elements.push({ type: 'rect', strokeWidth: 'Infinity', stroke: '#000' });
    const before = structuredClone(raw);
    let calls = 0; vi.spyOn(Math, 'random').mockImplementation(() => (++calls) / 100);
    const expected = validateWorkspaceProject(raw); const expectedCalls = calls; calls = 0;
    const clone = vi.spyOn(globalThis, 'structuredClone'), h = makeWorkHarness();
    await expect(h.runtime.run(checkWorkspaceProjectWork(raw))).resolves.toBeUndefined();
    expect(calls).toBe(expectedCalls); expect(expectedCalls).toBe(0); // the added default layer has a fixed id
    expect((expected.initialState.variants.default.templates.page.elements[1] as any).borderSides.top.width).toBeNull();
    expect(clone).toHaveBeenCalledTimes(1); expect(raw).toEqual(before);
    expect(raw.initialState.variants.default.templates.alias).toBe(raw.initialState.variants.default.templates.page);
    expect(h.runtime.snapshot().ownedBytes).toBe(0);
  });

  it('preserves warning retain/reject behavior in returning and discard paths', async () => {
    const raw: any = { ...project(), initialState: historicalState(9) };
    raw.initialState.generator.hierarchyScript = 42;
    const h = makeWorkHarness();
    const expected = prepareProjectState(raw.initialState, { warningPolicy: 'retain' });
    expect(await h.runtime.run(prepareProjectStateWork(raw.initialState, { warningPolicy: 'retain' }))).toEqual(expected);
    await expect(h.runtime.run(checkWorkspaceProjectWork(raw, { warningPolicy: 'retain' }))).resolves.toBeUndefined();
    await expect(h.runtime.run(checkWorkspaceProjectWork(raw))).rejects.toThrow('Saved generator was detached:');
    expect(h.runtime.snapshot().ownedBytes).toBe(0);
  });

  it.each(['failure', 'cancel'] as const)('releases working ownership on %s and leaves raw data unchanged', async kind => {
    const raw = project(); raw.initialState.nodes.root.children = Array(2000).fill('root');
    if (kind === 'failure') (raw.initialState.variants.default.templates.page.elements[0] as any).textWrap = 'invalid';
    const before = structuredClone(raw), h = makeWorkHarness();
    if (kind === 'cancel') h.observe(event => { if (event.counters.ownedBytes > 0) h.cancel(); });
    const result = h.runtime.run(checkWorkspaceProjectWork(raw));
    if (kind === 'failure') await expect(result).rejects.toThrow('invalid before migration');
    else await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(h.runtime.snapshot().ownedHighWater).toBeGreaterThan(0);
    expect(h.runtime.snapshot().ownedBytes).toBe(0); expect(raw).toEqual(before);
  });

  it('releases the reservation when lifecycle loss occurs immediately after native cloning', async () => {
    const raw = project(), before = structuredClone(raw), clone = globalThis.structuredClone, h = makeWorkHarness();
    vi.spyOn(globalThis, 'structuredClone').mockImplementation(value => {
      const result = clone(value); h.cancel(); return result;
    });
    await expect(h.runtime.run(checkWorkspaceProjectWork(raw))).rejects.toMatchObject({ name: 'AbortError' });
    expect(h.runtime.snapshot().ownedHighWater).toBeGreaterThan(0);
    expect(h.runtime.snapshot().ownedBytes).toBe(0); expect(raw).toEqual(before);
  });

  it('rejects wrapper accessors before cloning and preserves the JSON error cause', async () => {
    const raw = project(), get = vi.fn(() => 1);
    Object.defineProperty(raw, 'retained', { enumerable: true, get });
    const clone = vi.spyOn(globalThis, 'structuredClone');
    await expect(makeWorkHarness().runtime.run(checkWorkspaceProjectWork(raw)))
      .rejects.toMatchObject({ message: expect.stringMatching(/^Workspace project must be JSON-compatible:/), cause: expect.any(TypeError) });
    expect(clone).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled();
  });

  it.each(['project', 'preset', 'import'] as const)('keeps wrapper error precedence for %s', async kind => {
    const raw: any = kind === 'project' ? project() : kind === 'preset' ? preset() : pendingImport();
    raw.id = '';
    const h = makeWorkHarness();
    const sync = () => kind === 'project' ? validateWorkspaceProject(raw)
      : kind === 'preset' ? validateCustomPreset(raw, noExistingPresetIds()) : preparePendingImport(raw, rejectWarnings);
    let expected: Error | undefined; try { sync(); } catch (error) { expected = error as Error; }
    expect(expected).toBeInstanceOf(Error);
    const program = kind === 'project' ? checkWorkspaceProjectWork(raw)
      : kind === 'preset' ? checkCustomPresetWork(raw, noExistingPresetIds()) : checkPendingImportWork(raw, rejectWarnings);
    await expect(h.runtime.run(program)).rejects.toThrow(expected!.message);
    expect(h.runtime.snapshot().ownedBytes).toBe(0);
  });
});

describe('foundational contracts and fixtures', () => {
  it('pins database and rollout constants', () => {
    expect(WORKSPACE_DB_NAME).toBe('doctect-local-workspace');
    expect(WORKSPACE_DB_VERSION).toBe(2);
    expect(WORKSPACE_MIGRATION_ID).toBe('local-storage-to-indexeddb-v1');
    expect(PERSISTENCE_ROLLOUT_EPOCH).toBe(1);
  });

  it('returns fresh values from every fixture builder', () => {
    const state = currentState();
    state.nodes.root.title = 'changed';
    expect(currentState().nodes.root.title).toBe('Racine 根');

    const workspace = workspaceSnapshot();
    workspace.projects[0].name = 'changed';
    expect(workspaceSnapshot().projects[0].name).toBe('Café project ☕');

    const legacy = legacySnapshot();
    legacy[LEGACY_KEYS.projects].present = true;
    expect(legacySnapshot()[LEGACY_KEYS.projects].present).toBe(false);
  });
});

describe('strict project-state preparation', () => {
  beforeEach(() => vi.spyOn(console, 'log').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it.each(Array.from({ length: 13 }, (_, version) => [version]))(
    'prepares supported historical schema v%s without mutating it',
    version => {
      const input = historicalState(version);
      const before = structuredClone(input);

      const prepared = prepareProjectState(input, rejectWarnings);

      expect(prepared.state.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(prepared.state.nodes.root.data.label).toBe('Café ☕');
      expect(prepared.warnings).toEqual([]);
      expect(input).toEqual(before);
      expect(prepared.state).not.toBe(input);
    },
  );

  it('rejects future project schema before loadProjectState can pass it through', () => {
    expect(() => prepareProjectState({
      ...currentState(),
      schemaVersion: CURRENT_SCHEMA_VERSION + 1,
    }, rejectWarnings)).toThrow(/future schema/i);
  });

  it.each([
    ['negative', -1],
    ['fractional', 1.5],
    ['text', '11'],
  ])('rejects %s schema versions', (_label, schemaVersion) => {
    expect(() => prepareProjectState({ ...currentState(), schemaVersion }, rejectWarnings))
      .toThrow(/schemaVersion/i);
  });

  it.each([
    ['v10 textOverflow', 10, { textOverflow: 'truncate' }],
    ['v10 textWrap', 10, { textWrap: 'true' }],
    ['v11 textPadding', 11, { textPadding: { top: -1, right: 0, bottom: 0, left: 0 } }],
  ])('rejects malformed current fields before normalization: %s', (_label, version, fields) => {
    const state = historicalState(version);
    Object.assign(state.variants.default.templates.page.elements[0], fields);
    expect(() => prepareProjectState(state, rejectWarnings)).toThrow(/textOverflow|textWrap|textPadding/);
  });

  it('rejects every data-detaching loader warning during migration', () => {
    expect(() => prepareProjectState({
      ...historicalState(8),
      generator: { formatVersion: 2 },
    }, rejectWarnings)).toThrow(/detached/i);
  });

  it('retains loader warnings only when explicitly requested', () => {
    const prepared = prepareProjectState({
      ...historicalState(8),
      generator: { formatVersion: 2 },
    }, { warningPolicy: 'retain' });

    expect(prepared.state.generator).toBeUndefined();
    expect(prepared.warnings).toEqual([
      'Saved generator was detached: Unsupported generator format version.',
    ]);
  });

  it('rejects structurally invalid migrated state and active-variant mismatch', () => {
    expect(() => prepareProjectState({ ...historicalState(9), rootId: 'missing' }, rejectWarnings))
      .toThrow(/rootId/);
    expect(() => prepareProjectState({
      ...currentState(),
      activeVariantId: 'missing',
    }, rejectWarnings)).toThrow(/activeVariantId/);
  });

  it('requires strict JSON-compatible plain objects', () => {
    const cyclic = currentState() as unknown as Record<string, unknown>;
    cyclic.cycle = cyclic;
    const custom = Object.assign(Object.create({ inherited: true }), currentState());

    expect(() => prepareProjectState(cyclic, rejectWarnings)).toThrow(/JSON-compatible/);
    expect(() => prepareProjectState(custom, rejectWarnings)).toThrow(/plain|JSON-compatible/);
  });

  it('validates only already-current output at the migrated-state seam', () => {
    expect(validateMigratedState(currentState()).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(() => validateMigratedState(historicalState(10))).toThrow(/current schema/i);
  });
});

describe('workspace wrapper validation', () => {
  beforeEach(() => vi.spyOn(console, 'log').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('preserves empty project names, cloud metadata, revisions, and unknown JSON fields', () => {
    const input = project();
    const validated = validateWorkspaceProject(input, rejectWarnings);

    expect(validated).toEqual(input);
    expect(validated.name).toBe('');
    expect(validated.retained).toEqual({ nested: ['value'] });
    expect(validated).not.toBe(input);
    expect(validated.initialState).not.toBe(input.initialState);
  });

  it.each([
    ['empty id', { id: '' }],
    ['non-string name', { name: 42 }],
    ['negative revision', { revision: -1 }],
    ['fractional revision', { revision: 1.5 }],
    ['non-object cloud', { cloud: null }],
    ['non-string cloud project', { cloud: { projectId: 1, lastSyncedCommitId: 'commit' } }],
    ['missing cloud commit', { cloud: { projectId: 'cloud' } }],
  ])('rejects malformed projects with %s', (_label, override) => {
    expect(() => validateWorkspaceProject({ ...project(), ...override }, rejectWarnings)).toThrow();
  });

  it('validates custom presets and preserves unknown JSON fields', () => {
    const input = preset();
    const validated = validateCustomPreset(input, noExistingPresetIds());

    expect(validated).toEqual(input);
    expect(validated.title).toBe('');
    expect(validated.retained).toEqual({ source: 'legacy' });
  });

  it('requires explicit preset-ID uniqueness context', () => {
    // @ts-expect-error Preset validation must be fail-closed when uniqueness context is omitted.
    expect(() => validateCustomPreset(preset())).toThrow(/existingIds|uniqueness context/i);
  });

  it('rejects duplicate and malformed custom-preset IDs', () => {
    expect(() => validateCustomPreset(preset(), {
      ...rejectWarnings,
      existingIds: new Set(['preset-1']),
    })).toThrow(/duplicate/i);
    expect(() => validateCustomPreset({ ...preset(), id: '' }, noExistingPresetIds())).toThrow(/id/i);
  });

  it.each([
    ['title', { title: 1 }],
    ['description', { desc: null }],
    ['color', { color: 42 }],
    ['custom marker', { isCustom: false }],
  ])('rejects malformed custom-preset %s', (_label, override) => {
    expect(() => validateCustomPreset({ ...preset(), ...override }, noExistingPresetIds())).toThrow();
  });
});

describe('pending import preparation', () => {
  beforeEach(() => vi.spyOn(console, 'log').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('returns prepared state, exact metadata, and warnings', () => {
    const input = pendingImport();
    const prepared = preparePendingImport(input, rejectWarnings);

    expect(prepared).toEqual({ ...input, state: input.state, warnings: [] });
    expect(prepared.state).not.toBe(input.state);
  });

  it('retains data-detachment warnings for an explicitly retain-policy import', () => {
    const prepared = preparePendingImport({
      ...pendingImport(),
      state: {
        ...historicalState(8),
        generator: { formatVersion: 2 },
      },
    }, { warningPolicy: 'retain' });

    expect(prepared.state.generator).toBeUndefined();
    expect(prepared.warnings[0]).toMatch(/detached/i);
  });

  it.each([
    ['empty import ID', { id: '' }],
    ['empty target ID', { targetProjectId: '' }],
    ['non-string name', { name: 1 }],
    ['non-canonical timestamp', { createdAt: '2026-08-14' }],
    ['invalid timestamp', { createdAt: 'not-a-date' }],
    ['malformed cloud', { cloud: { projectId: 'cloud', lastSyncedCommitId: 1 } }],
  ])('rejects %s', (_label, override) => {
    expect(() => preparePendingImport({ ...pendingImport(), ...override }, rejectWarnings)).toThrow();
  });
});
