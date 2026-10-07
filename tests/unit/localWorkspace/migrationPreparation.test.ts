// @vitest-environment node
import { webcrypto } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_SCHEMA_VERSION } from '../../../services/migration';
import {
  canonicalStringify,
  digestLegacySnapshot,
  digestWorkspaceContent,
  sha256Hex,
} from '../../../services/localWorkspace/canonical';
import {
  prepareInitialCopy,
  createWorkspaceRecordValidator,
  reconstructWorkspace,
  reconstructWorkspaceRecords,
  reconstructWorkspaceRecordsWork,
  validateWorkspaceRecordsWork,
  verifyPreparedCopy,
  type PreparedInitialCopy,
  type WorkspaceRecords,
} from '../../../services/localWorkspace/migration';
import {
  LEGACY_KEYS,
  currentState,
  deterministicEnvironment,
  historicalState,
  legacyCustomPreset,
  legacyPendingImport,
  legacyProject,
  legacySnapshot,
  secondProject,
  validLegacyValues,
} from '../../helpers/localWorkspaceFixtures';
import { makeWorkHarness } from '../../helpers/normalizationWorkHarness';
import { makeIncrementalProject } from '../../helpers/incrementalFixtures';
import * as validationModule from '../../../services/localWorkspace/validation';

const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const testSubtle = webcrypto.subtle as unknown as SubtleCrypto;

beforeAll(() => Object.defineProperty(globalThis, 'crypto', {
  configurable: true,
  value: webcrypto,
}));

afterAll(() => {
  if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto);
  else Reflect.deleteProperty(globalThis, 'crypto');
});

beforeEach(() => vi.spyOn(console, 'log').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

const sourceFrom = (values: Partial<Record<string, string>> = {}) =>
  legacySnapshot(values as Partial<Record<keyof ReturnType<typeof legacySnapshot>, string>>);

const validSource = () => sourceFrom(validLegacyValues());

const recordsFrom = (prepared: PreparedInitialCopy): WorkspaceRecords => ({
  projects: structuredClone(prepared.projects),
  workspace: structuredClone(prepared.workspace),
  presets: structuredClone(prepared.presets),
  pendingImports: structuredClone(prepared.pendingImports),
});

describe('initial migration preparation', () => {
  it('consolidated stored-project checks route aggregate and streamed validation but not reconstruction', async () => {
    const records = recordsFrom(await prepareInitialCopy(validSource(), deterministicEnvironment({ crypto: webcrypto as Crypto })));
    const before = structuredClone(records), h = makeWorkHarness();
    const checked = vi.spyOn(validationModule, 'checkStoredWorkspaceProjectWork');
    expect(await h.runtime.run(validateWorkspaceRecordsWork(records))).toBe(records);
    expect(checked.mock.calls.map(call => call[0])).toEqual(records.projects.map(row => row.project));
    checked.mockClear();
    const validator = createWorkspaceRecordValidator();
    for (const row of records.projects) await h.runtime.run(validator.project(row));
    await h.runtime.run(validator.ancillary(records));
    expect(checked.mock.calls.map(call => call[0])).toEqual(records.projects.map(row => row.project));
    checked.mockClear();
    expect(await h.runtime.run(reconstructWorkspaceRecordsWork(records))).toEqual(reconstructWorkspaceRecords(records));
    await prepareInitialCopy(validSource(), { ...deterministicEnvironment({ crypto: webcrypto as Crypto }), work: h.runtime });
    expect(checked).not.toHaveBeenCalled(); expect(records).toEqual(before);
    expect(h.runtime.snapshot().ownedBytes).toBe(0);
  });

  it.each([
    ['record before state', (row: any) => { row.updatedAt = 'bad'; row.project.initialState.rootId = 'missing'; }],
    ['state before wrapper', (row: any) => { row.project.initialState.rootId = 'missing'; row.project.id = ''; }],
    ['wrapper before ID equality', (row: any) => { row.project.name = 3; row.project.id = 'other'; }],
    ['stored ID equality', (row: any) => { row.project.id = 'other'; }],
  ] as const)('consolidated stored-project checks preserve %s error precedence', async (_label, corrupt) => {
    const records = recordsFrom(await prepareInitialCopy(validSource(), deterministicEnvironment({ crypto: webcrypto as Crypto })));
    corrupt(records.projects[0]);
    const h = makeWorkHarness();
    let expected: any;
    try { await h.runtime.run(reconstructWorkspaceRecordsWork(records)); } catch (error) { expected = error; }
    expect(expected).toBeDefined();
    const observed = validateWorkspaceRecordsWork(records);
    await expect(h.runtime.run(observed)).rejects.toMatchObject({
      name: expected.name, message: expected.message, category: 'target-invalid',
      ...(expected.cause ? { cause: { name: expected.cause.name, message: expected.cause.message } } : {}),
    });
    expect(h.runtime.snapshot().ownedBytes).toBe(0);
  });

  it.each(['aggregate', 'streamed'] as const)('preserves stored envelope project getter reads in %s validation', async mode => {
    const records = recordsFrom(await prepareInitialCopy(validSource(), deterministicEnvironment({ crypto: webcrypto as Crypto })));
    const row = records.projects[0], payload = row.project;
    const checked = vi.spyOn(validationModule, 'checkStoredWorkspaceProjectWork');
    for (const fault of ['none', 'fourth-read', 'third-payload'] as const) {
      let reads = 0;
      Object.defineProperty(row, 'project', { enumerable: true, configurable: true, get() {
        reads++;
        if (fault === 'fourth-read' && reads === 4) throw new Error('fourth project access');
        return fault === 'third-payload' && reads === 3 ? { ...payload, name: 3 } : payload;
      } });
      checked.mockClear();
      const h = makeWorkHarness();
      const program = mode === 'aggregate' ? validateWorkspaceRecordsWork(records) : createWorkspaceRecordValidator().project(row);
      const result = h.runtime.run<unknown>(program);
      if (fault === 'none') await expect(result).resolves.toBe(mode === 'aggregate' ? records : undefined);
      else await expect(result).rejects.toMatchObject({
        category: 'target-invalid',
        message: `Project record ${row.id} is invalid: ${fault === 'fourth-read' ? 'fourth project access' : 'Workspace project name must be a string.'}`,
      });
      expect(reads).toBe(fault === 'third-payload' ? 3 : 4);
      expect(checked).not.toHaveBeenCalled();
      expect(h.runtime.snapshot().ownedBytes).toBe(0);
    }
  });

  it('streamed record validation accepts projects individually and then checks ancillary membership', async () => {
    const records = recordsFrom(await prepareInitialCopy(validSource(), deterministicEnvironment({ crypto: webcrypto as Crypto })));
    const h = makeWorkHarness(); const validator = createWorkspaceRecordValidator();
    for (const project of records.projects) await h.runtime.run(validator.project(project));
    await expect(h.runtime.run(validator.ancillary(records))).resolves.toBeUndefined();
    expect(h.runtime.snapshot().ownedBytes).toBe(0);
  });

  it.each(['duplicate-project', 'duplicate-consume', 'missing-order', 'duplicate-order', 'unknown-active', 'invalid-preset', 'invalid-import', 'invalid-project'] as const)
  ('streamed record validation preserves shared rejection for %s', async corruption => {
    const records = recordsFrom(await prepareInitialCopy(validSource(), deterministicEnvironment({ crypto: webcrypto as Crypto })));
    if (corruption === 'duplicate-project') records.projects.push(structuredClone(records.projects[0]));
    if (corruption === 'duplicate-consume') {
      const other = structuredClone(records.projects[0]); other.id = other.project.id = 'other';
      records.projects[0].consumedImportId = other.consumedImportId = 'same-consumption';
      records.projects.push(other); records.workspace.projectOrder.push(other.id);
    }
    if (corruption === 'missing-order') records.workspace.projectOrder = [];
    if (corruption === 'duplicate-order') records.workspace.projectOrder.push(records.workspace.projectOrder[0]);
    if (corruption === 'unknown-active') records.workspace.activeProjectId = 'absent';
    if (corruption === 'invalid-preset') records.presets[0].position = -1;
    if (corruption === 'invalid-import') records.pendingImports[0].position = -1;
    if (corruption === 'invalid-project') records.projects[0].project.initialState.rootId = 'missing';
    const h = makeWorkHarness();
    await expect(h.runtime.run(validateWorkspaceRecordsWork(records))).rejects.toBeDefined();
    const validator = createWorkspaceRecordValidator();
    await expect((async () => {
      for (const project of records.projects) await h.runtime.run(validator.project(project));
      await h.runtime.run(validator.ancillary(records));
    })()).rejects.toBeDefined();
    expect(h.runtime.snapshot().ownedBytes).toBe(0);
  });

  it('cooperatively prepares the exact historical copy and fingerprint domains', async () => {
    const source = validSource();
    const before = structuredClone(source);
    const expected = await prepareInitialCopy(source, deterministicEnvironment({ crypto: webcrypto as Crypto }));
    const h = makeWorkHarness('prerequisite');
    const projectBytes = new TextEncoder().encode(JSON.stringify(expected.projects[0].project)).byteLength;
    let retainedDuringHash = false;
    h.observe(event => {
      if (event.counters.sourceHashBytes > 0 && event.counters.ownedBytes >= projectBytes) retainedDuringHash = true;
    });
    const digest = vi.fn(() => { throw new Error('Work path must not use SubtleCrypto'); });
    const observed = await prepareInitialCopy(source, {
      ...deterministicEnvironment({ crypto: { subtle: { digest } } as unknown as Crypto }), work: h.runtime,
    });
    expect(observed).toEqual(expected);
    expect(observed.sourceDigest).toBe('3ed43ee2d859761e2347cdeb50882b771321d4ec6f566866776931f574c53b53');
    expect(observed.targetDigest).toBe('036eb872a7bb8cd682e85e02c07556dc5330af3d8223d4a0a64e1cb6533ce81a');
    expect(observed.ledger.projectFingerprints).toEqual([{
      sourceIndex: 0, id: 'project-a', digest: 'b105c302af9772dbcc5fbe5eace28175dfda0c7c9a5e81f6dce9032f5660ff68',
    }]);
    expect(observed.projects.map(record => record.id)).toEqual(['project-a']);
    expect(source).toEqual(before);
    expect(digest).not.toHaveBeenCalled();
    expect(h.runtime.snapshot().sourceHashBytes).toBeGreaterThan(0);
    expect(h.runtime.snapshot().legacyHashBytes).toBeGreaterThan(0);
    expect(retainedDuringHash).toBe(true);
    expect(h.runtime.snapshot().ownedBytes).toBe(0);
    const records = { projects: observed.projects, workspace: observed.workspace, presets: observed.presets, pendingImports: observed.pendingImports };
    expect(await h.runtime.run(validateWorkspaceRecordsWork(records))).toBe(records);
  });

  it('captures raw legacy source before the first await even with an exhausted work quantum', async () => {
    const source = validSource();
    const before = structuredClone(source);
    const h = makeWorkHarness('prerequisite');
    await h.runtime.run((function* () { yield { visits: 1024, utf8Bytes: 0, run() {} }; })());
    const preparing = prepareInitialCopy(source, { ...deterministicEnvironment({ crypto: webcrypto as Crypto }), work: h.runtime });
    source[LEGACY_KEYS.projects].raw = '[]';
    const result = await preparing;
    expect(result.source).toEqual(before);
    expect(result.backup.snapshot).toEqual(before);
    expect(result.projects.map(record => record.id)).toEqual(['project-a']);
    expect(h.runtime.snapshot().sourceHashBytes).toBeGreaterThan(0);
  });

  it.each(Array.from({ length: 12 }, (_, version) => version))('preserves schema %i migration under cooperative preparation', async version => {
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    const source = sourceFrom({
      ...validLegacyValues(), [LEGACY_KEYS.projects]: JSON.stringify([legacyProject('project-a', version)]),
    });
    const expected = await prepareInitialCopy(source, deterministicEnvironment({ crypto: webcrypto as Crypto }));
    const h = makeWorkHarness('prerequisite');
    const observed = await prepareInitialCopy(source, { ...deterministicEnvironment({ crypto: webcrypto as Crypto }), work: h.runtime });
    expect(observed).toEqual(expected);
    expect(h.runtime.snapshot().visits).toBeGreaterThan(0);
  });

  it('cooperatively calls native initialization providers once in historical order', async () => {
    const calls: string[] = [];
    const h = makeWorkHarness('prerequisite');
    const result = await prepareInitialCopy(legacySnapshot(), {
      crypto: webcrypto as Crypto, work: h.runtime,
      now: () => { calls.push('now'); return '2026-08-14T15:00:00.000Z'; },
      randomUUID: () => { calls.push('uuid'); return `uuid-${calls.length}`; },
      createBlankProject: () => { calls.push('blank'); return currentState(); },
    });
    expect(calls).toEqual(['now', 'uuid', 'blank', 'uuid']);
    expect(result.origin).toBe('native');
    expect(result.projects[0].id).toBe('proj_uuid-2');
    expect(result.projects[0].incarnation).toBe('uuid-4');
    expect(h.runtime.snapshot().visits).toBeGreaterThan(0);
  });

  it.each(['before-start', 'uuid', 'blank'] as const)('preserves cancellation at %s without continuing providers', async when => {
    const h = makeWorkHarness('prerequisite');
    if (when === 'before-start') h.cancel();
    const randomUUID = vi.fn(() => { if (when === 'uuid') h.cancel(); return 'fixture-uuid'; });
    const createBlankProject = vi.fn(() => { h.cancel(); return currentState(); });
    await expect(prepareInitialCopy(legacySnapshot(), {
      ...deterministicEnvironment({ crypto: webcrypto as Crypto, randomUUID, createBlankProject }), work: h.runtime,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(randomUUID).toHaveBeenCalledTimes(when === 'before-start' ? 0 : 1);
    expect(createBlankProject).toHaveBeenCalledTimes(when === 'blank' ? 1 : 0);
    expect(h.runtime.snapshot().ownedBytes).toBe(0);
  });

  it('yields and cancels a thousand-project initial copy before generating metadata', async () => {
    const project = makeIncrementalProject(1);
    const source = sourceFrom({ [LEGACY_KEYS.projects]: JSON.stringify(
      Array.from({ length: 1000 }, (_, index) => ({ ...project, id: `project-${index}` })),
    ) });
    const h = makeWorkHarness('prerequisite', true);
    const randomUUID = vi.fn(() => 'unused');
    let timerFired = false;
    const timer = setTimeout(() => { timerFired = true; h.cancel(); }, 0);
    try {
      const outcome = await prepareInitialCopy(source, {
        ...deterministicEnvironment({ crypto: webcrypto as Crypto, randomUUID }), work: h.runtime,
      }).then(() => 'completed', error => error.name);
      expect(outcome).toBe('AbortError');
      expect(timerFired).toBe(true);
      expect(randomUUID).not.toHaveBeenCalled();
      expect(h.runtime.snapshot().ownedBytes).toBe(0);
    } finally { clearTimeout(timer); }
  });

  it('keeps raw source indices and IDs across multiple sequential project and preset fingerprints', async () => {
    const projects = [secondProject(), legacyProject()];
    const presets = [legacyCustomPreset('preset-z'), legacyCustomPreset('preset-a')];
    const source = sourceFrom({
      ...validLegacyValues(),
      [LEGACY_KEYS.projects]: JSON.stringify(projects),
      [LEGACY_KEYS.customPresets]: JSON.stringify(presets),
    });
    const h = makeWorkHarness('prerequisite');
    const prepared = await prepareInitialCopy(source, { ...deterministicEnvironment({ crypto: webcrypto as Crypto }), work: h.runtime });
    expect(prepared.projects.map(record => record.id)).toEqual(['project-b', 'project-a']);
    expect(prepared.presets.map(record => [record.id, record.position])).toEqual([['preset-z', 0], ['preset-a', 1]]);
    for (const [rows, fingerprints] of [[projects, prepared.ledger.projectFingerprints], [presets, prepared.ledger.presetFingerprints]] as const) {
      for (const [index, row] of rows.entries()) {
        expect(fingerprints[index]).toEqual({
          // Fingerprints cover parsed legacy JSON, not undefined-valued fields
          // present only on the pre-serialization fixture object.
          id: row.id, sourceIndex: index, digest: await sha256Hex(canonicalStringify(JSON.parse(JSON.stringify(row))), testSubtle),
        });
      }
    }
    expect(h.runtime.snapshot().ownedBytes).toBe(0);
  });

  it.each(['parsed-payload', 'record-uuid'] as const)('releases retained payloads when cancelled at %s', async when => {
    const source = validSource();
    const before = structuredClone(source);
    const h = makeWorkHarness('prerequisite');
    if (when === 'parsed-payload') h.observe(event => { if (event.counters.ownedBytes > 352) h.cancel(); });
    const randomUUID = vi.fn(() => { h.cancel(); return 'fixture-uuid'; });
    await expect(prepareInitialCopy(source, {
      ...deterministicEnvironment({ crypto: webcrypto as Crypto, randomUUID }), work: h.runtime,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(randomUUID).toHaveBeenCalledTimes(when === 'record-uuid' ? 1 : 0);
    expect(h.runtime.snapshot().ownedHighWater).toBeGreaterThan(352);
    expect(h.runtime.snapshot().ownedBytes).toBe(0);
    expect(source).toEqual(before);
  });

  it.each([
    ['malformed JSON', LEGACY_KEYS.projects, '{'],
    ['non-array projects', LEGACY_KEYS.projects, '{}'],
    ['duplicate projects', LEGACY_KEYS.projects, JSON.stringify([legacyProject(), legacyProject()])],
    ['duplicate presets', LEGACY_KEYS.customPresets, JSON.stringify([legacyCustomPreset(), legacyCustomPreset()])],
    ['unknown pending key', LEGACY_KEYS.pendingImport, JSON.stringify({ ...legacyPendingImport(), unknown: true })],
    ['bad pending state', LEGACY_KEYS.pendingImport, JSON.stringify({ name: 'Invalid', state: null })],
  ])('preserves %s rejection and affected-key metadata under cooperative work', async (_label, key, raw) => {
    const source = sourceFrom({ ...validLegacyValues(), [key]: raw });
    const expected = await prepareInitialCopy(source, deterministicEnvironment({ crypto: webcrypto as Crypto })).catch(error => error);
    const h = makeWorkHarness('prerequisite');
    await expect(prepareInitialCopy(source, {
      ...deterministicEnvironment({ crypto: webcrypto as Crypto }), work: h.runtime,
    })).rejects.toMatchObject({ message: expected.message, category: 'legacy-invalid', affectedKey: key, affectedItem: expected.affectedItem });
    expect(h.runtime.snapshot().ownedBytes).toBe(0);
  });

  it('preserves loader warning rejection rather than detaching provenance during cooperative copy', async () => {
    const source = sourceFrom({
      ...validLegacyValues(),
      [LEGACY_KEYS.projects]: JSON.stringify([legacyProject('project-a', 8, { initialState: { ...historicalState(8), generator: null } })]),
    });
    const h = makeWorkHarness('prerequisite');
    await expect(prepareInitialCopy(source, {
      ...deterministicEnvironment({ crypto: webcrypto as Crypto }), work: h.runtime,
    })).rejects.toMatchObject({ category: 'legacy-invalid', affectedKey: LEGACY_KEYS.projects, affectedItem: '0' });
    expect(h.runtime.snapshot().ownedBytes).toBe(0);
  });

  it('checks lifecycle again after the final awaited source clone', async () => {
    const source = validSource();
    const h = makeWorkHarness('prerequisite');
    const nativeClone = globalThis.structuredClone;
    let legacyClones = 0;
    vi.spyOn(globalThis, 'structuredClone').mockImplementation(value => {
      const copy = nativeClone(value);
      if (value && typeof value === 'object' && Object.hasOwn(value, LEGACY_KEYS.projects)) {
        legacyClones += 1;
        if (legacyClones === 3) queueMicrotask(h.cancel);
      }
      return copy;
    });
    const outcome = await prepareInitialCopy(source, {
      ...deterministicEnvironment({ crypto: webcrypto as Crypto }), work: h.runtime,
    }).then(() => 'completed', error => error.name);
    expect(legacyClones).toBe(3);
    expect(outcome).toBe('AbortError');
    expect(h.runtime.snapshot().ownedBytes).toBe(0);
  });

  it('preserves ordered complete project wrappers and migrates state content', async () => {
    const first = legacyProject('project-a', 9);
    const second = secondProject(11);
    const source = sourceFrom({
      ...validLegacyValues(),
      [LEGACY_KEYS.projects]: JSON.stringify([first, second]),
      [LEGACY_KEYS.activeProject]: 'project-b',
    });
    const before = structuredClone(source);

    const prepared = await prepareInitialCopy(source, deterministicEnvironment({
      crypto: webcrypto as Crypto,
    }));

    expect(prepared.origin).toBe('legacy');
    expect(prepared.source).toEqual(before);
    expect(source).toEqual(before);
    expect(prepared.workspace).toEqual({
      id: 'current',
      projectOrder: ['project-a', 'project-b'],
      activeProjectId: 'project-b',
      revision: 0,
    });
    expect(prepared.projects.map(record => record.id)).toEqual(['project-a', 'project-b']);
    expect(prepared.projects.map(record => record.incarnation))
      .toEqual(['fixture-uuid', 'fixture-uuid']);
    expect(prepared.projects.every(record => record.storageRevision === 0)).toBe(true);
    expect(prepared.projects.every(record => record.updatedAt === '2026-08-14T15:00:00.000Z'))
      .toBe(true);
    expect(prepared.projects[0].project).toMatchObject({
      name: 'Café project ☕',
      cloud: { projectId: 'cloud-project-a', lastSyncedCommitId: 'commit-project-a' },
      revision: 4,
      retainedWrapperField: { source: 'legacy' },
    });
    expect(prepared.projects[0].project.initialState.generator)
      .toEqual(first.initialState.generator);
    expect(prepared.projects[0].project.initialState.nodes.root.data.label).toBe('Café ☕');
    expect(prepared.projects[0].project.initialState.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('assigns one private incarnation to every migrated project record', async () => {
    const randomUUID = vi.fn()
      .mockReturnValueOnce('incarnation-a')
      .mockReturnValueOnce('incarnation-b');
    const source = sourceFrom({
      ...validLegacyValues(),
      [LEGACY_KEYS.projects]: JSON.stringify([legacyProject(), secondProject()]),
    });

    const prepared = await prepareInitialCopy(source, deterministicEnvironment({
      crypto: webcrypto as Crypto,
      randomUUID,
    }));

    expect(prepared.projects.map(record => record.incarnation))
      .toEqual(['incarnation-a', 'incarnation-b']);
    expect(randomUUID).toHaveBeenCalledTimes(2);
  });

  it('migrates every historical project state in source order', async () => {
    const projects = Array.from({ length: CURRENT_SCHEMA_VERSION + 1 }, (_, version) =>
      legacyProject(`project-${version}`, version, { cloud: undefined, revision: version }));
    const source = sourceFrom({
      [LEGACY_KEYS.projects]: JSON.stringify(projects),
      [LEGACY_KEYS.activeProject]: '',
    });

    const prepared = await prepareInitialCopy(source, deterministicEnvironment({
      crypto: webcrypto as Crypto,
    }));

    expect(prepared.workspace.projectOrder).toEqual(projects.map(project => project.id));
    expect(prepared.workspace.activeProjectId).toBe('project-0');
    expect(prepared.projects.map(record => record.project.initialState.schemaVersion))
      .toEqual(projects.map(() => CURRENT_SCHEMA_VERSION));
  });

  it('preserves preset order and uses accumulated IDs for duplicate detection', async () => {
    const presets = [legacyCustomPreset('preset-b', 5), legacyCustomPreset('preset-a', 11)];
    const prepared = await prepareInitialCopy(sourceFrom({
      ...validLegacyValues(),
      [LEGACY_KEYS.customPresets]: JSON.stringify(presets),
    }), deterministicEnvironment({ crypto: webcrypto as Crypto }));

    expect(prepared.presets.map(record => ({ id: record.id, position: record.position })))
      .toEqual([{ id: 'preset-b', position: 0 }, { id: 'preset-a', position: 1 }]);
    expect(prepared.presets[0].preset.retainedPresetField).toEqual(['one', 'two']);
    expect(prepared.presets[0].preset.initialState.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);

    await expect(prepareInitialCopy(sourceFrom({
      ...validLegacyValues(),
      [LEGACY_KEYS.customPresets]: JSON.stringify([
        legacyCustomPreset('same'),
        legacyCustomPreset('same'),
      ]),
    }), deterministicEnvironment({ crypto: webcrypto as Crypto })))
      .rejects.toMatchObject({ affectedKey: LEGACY_KEYS.customPresets });
  });

  it('converts the singleton pending import with stable and deterministic IDs', async () => {
    const source = validSource();
    const prepared = await prepareInitialCopy(source, deterministicEnvironment({
      crypto: webcrypto as Crypto,
    }));
    const expectedTarget = `proj_migrated_import_${prepared.sourceDigest.slice(0, 16)}`;

    expect(prepared.pendingImports).toHaveLength(1);
    expect(prepared.pendingImports[0]).toMatchObject({
      id: 'legacy-import-v1',
      position: 0,
      pendingImport: {
        id: 'legacy-import-v1',
        targetProjectId: expectedTarget,
        name: 'Imported 😀',
        cloud: { projectId: 'cloud-import', lastSyncedCommitId: 'commit-import' },
        createdAt: '2026-08-14T15:00:00.000Z',
        warnings: [],
      },
    });
    expect(prepared.pendingImports[0].pendingImport.state.schemaVersion)
      .toBe(CURRENT_SCHEMA_VERSION);
  });

  it('appends the first ascending suffix when deterministic import target IDs collide', async () => {
    const digestBytes = Uint8Array.from({ length: 32 }, () => 0xab);
    const crypto = {
      subtle: {
        digest: vi.fn(async () => digestBytes.buffer.slice(0)),
      },
    } as unknown as Crypto;
    const base = 'proj_migrated_import_abababababababab';
    const source = sourceFrom({
      ...validLegacyValues(),
      [LEGACY_KEYS.projects]: JSON.stringify([
        legacyProject(base),
        legacyProject(`${base}_1`),
      ]),
      [LEGACY_KEYS.activeProject]: base,
    });

    const prepared = await prepareInitialCopy(source, deterministicEnvironment({ crypto }));

    expect(prepared.pendingImports[0].pendingImport.targetProjectId).toBe(`${base}_2`);
  });

  it('creates one fresh usable blank project for missing or empty project sources', async () => {
    for (const source of [
      sourceFrom({ [LEGACY_KEYS.customPresets]: JSON.stringify([legacyCustomPreset()]) }),
      sourceFrom({ [LEGACY_KEYS.projects]: '[]' }),
    ]) {
      const prepared = await prepareInitialCopy(source, deterministicEnvironment({
        crypto: webcrypto as Crypto,
      }));
      expect(prepared.projects).toHaveLength(1);
      expect(prepared.projects[0].project).toMatchObject({
        id: 'proj_fixture-uuid',
        name: 'Blank Project',
        initialState: currentState(),
      });
      expect(prepared.workspace.projectOrder).toEqual(['proj_fixture-uuid']);
      expect(prepared.workspace.activeProjectId).toBe('proj_fixture-uuid');
      expect(prepared.ledger.counts.sourceProjects).toBe(0);
      expect(prepared.ledger.counts.targetProjects).toBe(1);
    }
  });

  it('distinguishes presets-only legacy migration from all-absent native initialization', async () => {
    const environment = deterministicEnvironment({ crypto: webcrypto as Crypto });
    const presetsOnly = await prepareInitialCopy(sourceFrom({
      [LEGACY_KEYS.customPresets]: JSON.stringify([legacyCustomPreset()]),
    }), environment);
    const native = await prepareInitialCopy(legacySnapshot(), environment);

    expect(presetsOnly.origin).toBe('legacy');
    expect(presetsOnly.receipt).toMatchObject({
      id: `local-storage-to-indexeddb-v1:${presetsOnly.sourceDigest}`,
      projectCount: 0,
      customPresetCount: 1,
      pendingImportPreserved: false,
      migratedAt: '2026-08-14T15:00:00.000Z',
    });
    expect(native.origin).toBe('native');
    expect(native.receipt).toBeUndefined();
    expect(native.source).toEqual(legacySnapshot());
  });

  it('builds exact source fingerprints, backup metadata, digests, and copied ledger', async () => {
    const source = validSource();
    const prepared = await prepareInitialCopy(source, deterministicEnvironment({
      crypto: webcrypto as Crypto,
    }));
    const rawProject = JSON.parse(source[LEGACY_KEYS.projects].raw!)[0];
    const rawPreset = JSON.parse(source[LEGACY_KEYS.customPresets].raw!)[0];

    expect(prepared.sourceDigest).toBe(await digestLegacySnapshot(source, testSubtle));
    expect(prepared.ledger.keyFingerprints).toEqual(await Promise.all(
      Object.values(LEGACY_KEYS).map(async key => ({
        key,
        present: source[key].present,
        digest: await sha256Hex(source[key].raw ?? '', testSubtle),
      })),
    ));
    expect(prepared.ledger.projectFingerprints).toEqual([{
      sourceIndex: 0,
      id: 'project-a',
      digest: await sha256Hex(canonicalStringify(rawProject), testSubtle),
    }]);
    expect(prepared.ledger.presetFingerprints).toEqual([{
      sourceIndex: 0,
      id: 'preset-a',
      digest: await sha256Hex(canonicalStringify(rawPreset), testSubtle),
    }]);
    expect(prepared.backup).toMatchObject({
      kind: 'original',
      capturedAt: '2026-08-14T15:00:00.000Z',
      snapshot: source,
      digest: prepared.sourceDigest,
    });
    expect(prepared.ledger).toMatchObject({
      state: 'copied',
      ledgerRevision: 0,
      sourceDigest: prepared.sourceDigest,
      expectedTargetDigest: prepared.targetDigest,
      acceptedLegacyDigest: prepared.sourceDigest,
      originalLegacyBackupId: prepared.backup.id,
      acceptedLegacyBackupId: prepared.backup.id,
      verifiedAt: null,
      unresolvedRecovery: null,
    });
  });

  it.each([
    [LEGACY_KEYS.projects, ''],
    [LEGACY_KEYS.projects, '{'],
    [LEGACY_KEYS.projects, '{}'],
    [LEGACY_KEYS.customPresets, '[{"id":"same"},{"id":"same"}]'],
    [LEGACY_KEYS.pendingImport, 'null'],
  ])('rejects invalid legacy %s without producing target records', async (key, raw) => {
    const source = legacySnapshot({ ...validLegacyValues(), [key]: raw });
    await expect(prepareInitialCopy(source, deterministicEnvironment({ crypto: webcrypto as Crypto })))
      .rejects.toMatchObject({ affectedKey: key });
  });

  it.each([
    ['duplicate project IDs', LEGACY_KEYS.projects, JSON.stringify([
      legacyProject('same'), legacyProject('same'),
    ])],
    ['empty project ID', LEGACY_KEYS.projects, JSON.stringify([legacyProject('', 11)])],
    ['malformed project state', LEGACY_KEYS.projects, JSON.stringify([
      legacyProject('bad', 11, { initialState: null }),
    ])],
    ['inherited project root', LEGACY_KEYS.projects, JSON.stringify([
      legacyProject('project-a', 11, {
        initialState: { ...currentState(), nodes: {}, rootId: '__proto__' },
      }),
    ])],
    ['unresolved active project', LEGACY_KEYS.activeProject, 'missing'],
    ['empty preset ID', LEGACY_KEYS.customPresets, JSON.stringify([
      legacyCustomPreset('', 11),
    ])],
    ['malformed preset state', LEGACY_KEYS.customPresets, JSON.stringify([
      legacyCustomPreset('bad', 11, { initialState: null }),
    ])],
    ['future project schema', LEGACY_KEYS.projects, JSON.stringify([
      legacyProject('future', 11, {
        initialState: { ...currentState(), schemaVersion: CURRENT_SCHEMA_VERSION + 1 },
      }),
    ])],
    ['unknown pending field', LEGACY_KEYS.pendingImport, JSON.stringify({
      ...legacyPendingImport(), unknown: true,
    })],
  ])('rejects %s with the affected legacy key', async (_label, key, raw) => {
    await expect(prepareInitialCopy(sourceFrom({
      ...validLegacyValues(),
      [key]: raw,
    }), deterministicEnvironment({ crypto: webcrypto as Crypto })))
      .rejects.toMatchObject({ affectedKey: key });
  });

  it.each([
    ['non-object generator', null],
    ['unsupported format', { formatVersion: 2 }],
    ['non-text template source', {
      formatVersion: 1, templateScript: 42, hierarchyScript: '', generatedAt: '2026-08-14T00:00:00.000Z',
    }],
    ['non-text hierarchy source', {
      formatVersion: 1, templateScript: '', hierarchyScript: 42, generatedAt: '2026-08-14T00:00:00.000Z',
    }],
    ['oversized template source', {
      formatVersion: 1, templateScript: 'x'.repeat(512 * 1024 + 1), hierarchyScript: '', generatedAt: '2026-08-14T00:00:00.000Z',
    }],
    ['oversized hierarchy source', {
      formatVersion: 1, templateScript: '', hierarchyScript: 'x'.repeat(512 * 1024 + 1), generatedAt: '2026-08-14T00:00:00.000Z',
    }],
    ['invalid generation time', {
      formatVersion: 1, templateScript: '', hierarchyScript: '', generatedAt: 'not-a-date',
    }],
  ])('rejects loader warning: %s', async (_label, generator) => {
    const state = { ...historicalState(8), generator };
    await expect(prepareInitialCopy(sourceFrom({
      ...validLegacyValues(),
      [LEGACY_KEYS.projects]: JSON.stringify([
        legacyProject('warning', 8, { initialState: state }),
      ]),
    }), deterministicEnvironment({ crypto: webcrypto as Crypto })))
      .rejects.toMatchObject({ affectedKey: LEGACY_KEYS.projects });
  });
});

describe('target reconstruction', () => {
  it('cooperatively reconstructs workspace and position order without changing raw records', async () => {
    const prepared = await prepareInitialCopy(sourceFrom({
      ...validLegacyValues(),
      [LEGACY_KEYS.projects]: JSON.stringify([legacyProject(), secondProject()]),
      [LEGACY_KEYS.customPresets]: JSON.stringify([legacyCustomPreset('preset-b'), legacyCustomPreset('preset-a')]),
    }), deterministicEnvironment({ crypto: webcrypto as Crypto }));
    const records = recordsFrom(prepared);
    records.projects.reverse();
    records.presets.reverse();
    records.pendingImports[0].pendingImport.warnings = ['retained warning'];
    const before = structuredClone(records);
    const expected = reconstructWorkspaceRecords(records);
    const h = makeWorkHarness('prerequisite');
    const observed = await h.runtime.run(reconstructWorkspaceRecordsWork(records));
    expect(observed).toEqual(expected);
    expect(observed.records).toBe(records);
    expect(observed.snapshot.projects.map(project => project.id)).toEqual(['project-a', 'project-b']);
    expect(observed.snapshot.customPresets.map(preset => preset.id)).toEqual(['preset-b', 'preset-a']);
    expect(observed.snapshot.pendingImports[0].warnings).toEqual(['retained warning']);
    expect(observed.snapshot.projects[0]).not.toBe(records.projects[1].project);
    expect(records).toEqual(before);
    expect(h.runtime.snapshot().visits).toBeGreaterThan(0);
    expect(h.runtime.snapshot().ownedHighWater).toBeGreaterThan(0);
    expect(h.runtime.snapshot().ownedBytes).toBe(0);
  });

  it('checks raw records using one working state clone per payload, never retaining a snapshot', async () => {
    const prepared = await prepareInitialCopy(validSource(), deterministicEnvironment({ crypto: webcrypto as Crypto }));
    const records = recordsFrom(prepared);
    const before = structuredClone(records);
    const clone = vi.spyOn(globalThis, 'structuredClone');
    const h = makeWorkHarness('prerequisite');
    expect(await h.runtime.run(validateWorkspaceRecordsWork(records))).toBe(records);
    expect(clone.mock.calls.map(call => call[0])).toEqual([
      records.projects[0].project.initialState,
      records.workspace, // Historical metadata clone, never a loaded state graph.
      records.presets[0].preset.initialState,
      records.pendingImports[0].pendingImport.state,
    ]);
    expect(records).toEqual(before);
    expect(h.runtime.snapshot().ownedHighWater).toBeGreaterThan(0);
    expect(h.runtime.snapshot().ownedBytes).toBe(0);
  });

  it('cancels discard-only validation during a row without wrapping lifecycle failure', async () => {
    const prepared = await prepareInitialCopy(validSource(), deterministicEnvironment({ crypto: webcrypto as Crypto }));
    const records = recordsFrom(prepared);
    const before = structuredClone(records);
    const h = makeWorkHarness('prerequisite');
    h.observe(() => h.cancel());
    await expect(h.runtime.run(validateWorkspaceRecordsWork(records))).rejects.toMatchObject({ name: 'AbortError' });
    expect(records).toEqual(before);
    expect(h.runtime.snapshot().ownedBytes).toBe(0);
  });

  it('releases accumulated output ownership when retaining reconstruction is cancelled', async () => {
    const prepared = await prepareInitialCopy(validSource(), deterministicEnvironment({ crypto: webcrypto as Crypto }));
    const records = recordsFrom(prepared);
    const h = makeWorkHarness('prerequisite');
    h.observe(event => { if (event.counters.ownedBytes > 0) h.cancel(); });
    await expect(h.runtime.run(reconstructWorkspaceRecordsWork(records))).rejects.toMatchObject({ name: 'AbortError' });
    expect(h.runtime.snapshot().ownedHighWater).toBeGreaterThan(0);
    expect(h.runtime.snapshot().ownedBytes).toBe(0);
  });

  it('preserves workspace metadata clone failure even on discard-only checks', async () => {
    const prepared = await prepareInitialCopy(validSource(), deterministicEnvironment({ crypto: webcrypto as Crypto }));
    const records = recordsFrom(prepared);
    // Historical exact-key validation stops at the first unknown key, then
    // tests its truthiness. Do not silently widen that old clone boundary.
    Object.assign(records.workspace, { '': () => {} });
    expect(() => reconstructWorkspace(records)).toThrow();
    for (const program of [reconstructWorkspaceRecordsWork(records), validateWorkspaceRecordsWork(records)]) {
      const h = makeWorkHarness('prerequisite');
      await expect(h.runtime.run<unknown>(program)).rejects.toMatchObject({ name: 'DataCloneError' });
      expect(h.runtime.snapshot().ownedBytes).toBe(0);
    }
  });

  it.each([
    ['stored project ID mismatch', (r: any) => { r.projects[0].project.id = 'other'; }, /Stored ID does not match project ID/],
    ['stored preset ID mismatch', (r: any) => { r.presets[0].preset.id = 'other'; }, /Stored ID does not match preset ID/],
    ['stored import ID mismatch', (r: any) => { r.pendingImports[0].pendingImport.id = 'other'; }, /Stored ID does not match import ID/],
    ['orphan consume time', (r: any) => { r.projects[0].consumedImportCreatedAt = 'bad'; }, /requires consumedImportId/],
    ['orphan consume digest', (r: any) => { r.projects[0].consumedImportDigest = 'a'.repeat(64); }, /requires consumedImportId/],
    ['incomplete attempt', (r: any) => { r.projects[0].consumedImportAttempt = {}; }, /requires complete consume provenance/],
    ['malformed pending attempt', (r: any) => { r.pendingImports[0].attemptProvenance = {}; }, /missing sourceKeyDigest/],
    ['non-string warning', (r: any) => { r.pendingImports[0].pendingImport.warnings = [0]; }, /warnings must be strings/],
    ['noncanonical timestamp', (r: any) => { r.projects[0].updatedAt = '2026-01-01'; }, /canonical ISO timestamp/],
  ])('keeps %s rejection in both Work paths', async (_label, corrupt, message) => {
    const prepared = await prepareInitialCopy(validSource(), deterministicEnvironment({ crypto: webcrypto as Crypto }));
    const records = recordsFrom(prepared);
    corrupt(records);
    expect(() => reconstructWorkspace(records)).toThrow(message);
    for (const program of [reconstructWorkspaceRecordsWork(records), validateWorkspaceRecordsWork(records)]) {
      const h = makeWorkHarness('prerequisite');
      await expect(h.runtime.run<unknown>(program)).rejects.toThrow(message);
      expect(h.runtime.snapshot().ownedBytes).toBe(0);
    }
  });

  it.each(['presets', 'pendingImports'] as const)('keeps sparse %s rejection rather than silently skipping a row', async key => {
    const prepared = await prepareInitialCopy(validSource(), deterministicEnvironment({ crypto: webcrypto as Crypto }));
    const records = recordsFrom(prepared);
    records[key].length += 1;
    for (const program of [reconstructWorkspaceRecordsWork(records), validateWorkspaceRecordsWork(records)]) {
      await expect(makeWorkHarness('prerequisite').runtime.run<unknown>(program)).rejects.toThrow();
    }
    expect(() => reconstructWorkspace(records)).toThrow();
  });

  it('reconstructs one independently validated ordered workspace snapshot', async () => {
    const prepared = await prepareInitialCopy(validSource(), deterministicEnvironment({
      crypto: webcrypto as Crypto,
    }));

    const reconstructed = reconstructWorkspace(recordsFrom(prepared));

    expect(reconstructed.projects).toEqual(prepared.projects.map(record => record.project));
    expect(reconstructed.activeProjectId).toBe(prepared.workspace.activeProjectId);
    expect(reconstructed.customPresets).toEqual(prepared.presets.map(record => record.preset));
    expect(reconstructed.pendingImports)
      .toEqual(prepared.pendingImports.map(record => record.pendingImport));
  });

  it.each([
    ['missing workspace', (records: any) => { records.workspace = undefined; }],
    ['missing ordered project', (records: any) => { records.projects.pop(); }],
    ['extra project', (records: any) => {
      const extra = structuredClone(records.projects[0]);
      extra.id = 'extra';
      extra.project.id = 'extra';
      records.projects.push(extra);
    }],
    ['duplicate project record', (records: any) => {
      records.projects.push(structuredClone(records.projects[0]));
      records.workspace.projectOrder.push(records.projects[0].id);
    }],
    ['duplicate order reference', (records: any) => {
      records.workspace.projectOrder.push(records.workspace.projectOrder[0]);
    }],
    ['unknown active project', (records: any) => { records.workspace.activeProjectId = 'missing'; }],
    ['missing project incarnation', (records: any) => { delete records.projects[0].incarnation; }],
    ['empty project incarnation', (records: any) => { records.projects[0].incarnation = ''; }],
    ['negative storage revision', (records: any) => { records.projects[0].storageRevision = -1; }],
    ['fractional workspace revision', (records: any) => { records.workspace.revision = 0.5; }],
    ['malformed project state', (records: any) => { records.projects[0].project.initialState = {}; }],
    ['invalid preset position', (records: any) => { records.presets[0].position = 0.5; }],
    ['duplicate preset record', (records: any) => { records.presets.push(structuredClone(records.presets[0])); }],
    ['invalid pending position', (records: any) => { records.pendingImports[0].position = -1; }],
    ['unknown pending payload field', (records: any) => {
      records.pendingImports[0].pendingImport.unknown = true;
    }],
  ])('rejects %s', async (_label, corrupt) => {
    const prepared = await prepareInitialCopy(validSource(), deterministicEnvironment({
      crypto: webcrypto as Crypto,
    }));
    const records: any = recordsFrom(prepared);
    corrupt(records);

    expect(() => reconstructWorkspace(records)).toThrow();
    let expected: Error;
    try { reconstructWorkspace(records); } catch (error) { expected = error as Error; }
    for (const program of [reconstructWorkspaceRecordsWork(records), validateWorkspaceRecordsWork(records)]) {
      const h = makeWorkHarness('prerequisite');
      await expect(h.runtime.run<unknown>(program)).rejects.toMatchObject({
        message: expected!.message, category: 'target-invalid',
      });
      expect(h.runtime.snapshot().ownedBytes).toBe(0);
    }
  });

  it('validates private consume provenance without exposing or hashing it publicly', async () => {
    const prepared = await prepareInitialCopy(validSource(), deterministicEnvironment({
      crypto: webcrypto as Crypto,
    }));
    const withoutProvenance = recordsFrom(prepared);
    const withProvenance: any = recordsFrom(prepared);
    withProvenance.projects[0].consumedImportId = 'import-1';
    withProvenance.projects[0].consumedImportCreatedAt = '2026-08-15T12:00:00.000Z';
    withProvenance.projects[0].consumedImportDigest = 'a'.repeat(64);

    const publicWithout = reconstructWorkspace(withoutProvenance);
    const publicWith = reconstructWorkspace(withProvenance);

    expect(publicWith).toEqual(publicWithout);
    expect(Object.hasOwn(publicWith.projects[0], 'consumedImportId')).toBe(false);
    expect(Object.hasOwn(publicWith.projects[0], 'consumedImportCreatedAt')).toBe(false);
    expect(Object.hasOwn(publicWith.projects[0], 'consumedImportDigest')).toBe(false);
    expect(Object.hasOwn(publicWith.projects[0], 'incarnation')).toBe(false);
    expect(Object.hasOwn(publicWith.projects[0], 'storageRevision')).toBe(false);
    await expect(digestWorkspaceContent(publicWith, testSubtle))
      .resolves.toBe(await digestWorkspaceContent(publicWithout, testSubtle));
  });

  it('rejects empty and duplicate private consume provenance', async () => {
    const source = sourceFrom({
      ...validLegacyValues(),
      [LEGACY_KEYS.projects]: JSON.stringify([legacyProject(), secondProject()]),
    });
    const prepared = await prepareInitialCopy(source, deterministicEnvironment({
      crypto: webcrypto as Crypto,
    }));
    const empty: any = recordsFrom(prepared);
    empty.projects[0].consumedImportId = '';
    expect(() => reconstructWorkspace(empty)).toThrow(/non-empty/i);

    const undefinedValue: any = recordsFrom(prepared);
    undefinedValue.projects[0].consumedImportId = undefined;
    expect(() => reconstructWorkspace(undefinedValue)).toThrow(/non-empty/i);

    const duplicate: any = recordsFrom(prepared);
    duplicate.projects[0].consumedImportId = 'same-import';
    duplicate.projects[1].consumedImportId = 'same-import';
    expect(() => reconstructWorkspace(duplicate)).toThrow(/duplicate.*consume/i);

    const orphanDigest: any = recordsFrom(prepared);
    orphanDigest.projects[0].consumedImportDigest = 'a'.repeat(64);
    expect(() => reconstructWorkspace(orphanDigest)).toThrow(/digest.*requires/i);

    const missingTimestamp: any = recordsFrom(prepared);
    missingTimestamp.projects[0].consumedImportId = 'import-with-digest';
    missingTimestamp.projects[0].consumedImportDigest = 'a'.repeat(64);
    expect(() => reconstructWorkspace(missingTimestamp)).toThrow(/digest.*createdAt/i);

    const malformedDigest: any = recordsFrom(prepared);
    malformedDigest.projects[0].consumedImportId = 'import-with-bad-digest';
    malformedDigest.projects[0].consumedImportCreatedAt = '2026-08-15T12:00:00.000Z';
    malformedDigest.projects[0].consumedImportDigest = 'not-a-sha256-digest';
    expect(() => reconstructWorkspace(malformedDigest)).toThrow(/digest.*sha-256/i);
  });

  it('rejects consumed fork attempt provenance with a different pending digest', async () => {
    const prepared = await prepareInitialCopy(validSource(), deterministicEnvironment({
      crypto: webcrypto as Crypto,
    }));
    const records: any = recordsFrom(prepared);
    records.projects[0].consumedImportId = 'fork-import';
    records.projects[0].consumedImportCreatedAt = '2026-08-15T12:00:00.000Z';
    records.projects[0].consumedImportDigest = 'a'.repeat(64);
    records.projects[0].consumedImportAttempt = {
      sourceKeyDigest: 'b'.repeat(64),
      payloadDigest: 'c'.repeat(64),
      pendingImportDigest: 'd'.repeat(64),
    };

    expect(() => reconstructWorkspace(records)).toThrow(/attempt.*pending.*digest.*match/i);
  });
});

describe('prepared-copy verification', () => {
  async function setupVerification() {
    const source = validSource();
    const prepared = await prepareInitialCopy(source, deterministicEnvironment({ crypto: webcrypto as Crypto }));
    return { source, prepared, reconstructed: reconstructWorkspaceRecords(recordsFrom(prepared)) };
  }

  it('accounts both verification hashes and returns the original reconstructed snapshot', async () => {
    const h = await setupVerification(); const w = makeWorkHarness('prerequisite');
    const digest = vi.fn(() => { throw new Error('Work path must not use native whole-frame hashing'); });
    const result = await verifyPreparedCopy(h.prepared, h.reconstructed, h.source, { digest } as unknown as SubtleCrypto, w.runtime);
    expect(result).toBe(h.reconstructed.snapshot); expect(digest).not.toHaveBeenCalled();
    expect(w.runtime.snapshot().sourceHashBytes).toBeGreaterThan(0);
    expect(w.runtime.snapshot().legacyHashBytes).toBeGreaterThan(0);
    expect(w.runtime.snapshot().yields).toBeGreaterThan(0);
  });

  it.each(['before', 'target', 'source'] as const)('preserves cancellation at %s verification hash', async point => {
    const h = await setupVerification(); const w = makeWorkHarness('prerequisite');
    if (point === 'before') w.cancel();
    else w.observe(() => {
      const count = w.runtime.snapshot();
      if (point === 'target' ? count.sourceHashBytes > 0 : count.legacyHashBytes > 0) w.cancel();
    });
    await expect(verifyPreparedCopy(h.prepared, h.reconstructed, h.source, testSubtle, w.runtime))
      .rejects.toMatchObject({ name: 'AbortError' });
    if (point !== 'source') expect(w.runtime.snapshot().legacyHashBytes).toBe(0);
  });

  it.each(['source-bytes', 'target-bytes', 'prepared-source', 'prepared-target', 'projects', 'presets', 'imports', 'order', 'active'] as const)
    ('keeps %s mismatch rejection with Work', async changed => {
      const h = await setupVerification(); const w = makeWorkHarness('prerequisite');
      if (changed === 'source-bytes') h.source[LEGACY_KEYS.projects].raw += ' ';
      if (changed === 'target-bytes') h.reconstructed.snapshot.projects[0].name = 'Different';
      if (changed === 'prepared-source') h.prepared.sourceDigest = 'f'.repeat(64);
      if (changed === 'prepared-target') h.prepared.targetDigest = 'f'.repeat(64);
      if (changed === 'projects') h.prepared.ledger.counts.targetProjects++;
      if (changed === 'presets') h.prepared.ledger.counts.customPresets++;
      if (changed === 'imports') h.prepared.ledger.counts.pendingImports++;
      if (changed === 'order') h.prepared.workspace.projectOrder = ['different-project'];
      if (changed === 'active') h.prepared.workspace.activeProjectId = 'different-project';
      await expect(verifyPreparedCopy(h.prepared, h.reconstructed, h.source, testSubtle, w.runtime))
        .rejects.toMatchObject({ category: 'verification-failed' });
      expect(w.runtime.snapshot().legacyHashBytes).toBeGreaterThan(0);
    });

  it.each(['order', 'active'] as const)('compares long %s identifiers cooperatively after both hashes', async field => {
    const h = await setupVerification(); const w = makeWorkHarness('prerequisite');
    const long = '😀'.repeat(5000);
    // Record-order fields are compared separately from the reconstructed snapshot digest.
    if (field === 'order') {
      h.reconstructed.records.workspace.projectOrder = [long]; h.prepared.workspace.projectOrder = [long];
    } else {
      h.reconstructed.records.workspace.activeProjectId = long; h.prepared.workspace.activeProjectId = long;
    }
    let baseline: number | undefined;
    w.runtime.addGuard(() => {
      const counters = w.runtime.snapshot();
      // The second hash has emitted bytes and released its scratch; comparisons
      // from canonical key sorting must not satisfy this test's cancellation gate.
      if (baseline === undefined && counters.legacyHashBytes > 0 && counters.ownedBytes === 0) baseline = counters.comparedCodeUnits;
    });
    w.observe(() => { if (baseline !== undefined && w.runtime.snapshot().comparedCodeUnits - baseline > 2000) w.cancel(); });
    await expect(verifyPreparedCopy(h.prepared, h.reconstructed, h.source, testSubtle, w.runtime))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(baseline).toBeDefined(); expect(w.runtime.snapshot().comparedCodeUnits - baseline!).toBeGreaterThan(2000);
  });

  it('rechecks cancellation after the final comparison await', async () => {
    const h = await setupVerification(); const w = makeWorkHarness('prerequisite');
    const comparisonUnits = 2 * (4 * 64 + h.prepared.workspace.projectOrder.reduce((sum, id) => sum + id.length, 0)
      + h.prepared.workspace.activeProjectId!.length);
    let baseline: number | undefined, queued = false;
    w.runtime.addGuard(() => {
      const counters = w.runtime.snapshot();
      if (baseline === undefined && counters.legacyHashBytes > 0 && counters.ownedBytes === 0) baseline = counters.comparedCodeUnits;
      if (!queued && baseline !== undefined && counters.comparedCodeUnits - baseline === comparisonUnits) {
        queued = true; queueMicrotask(w.cancel);
      }
    });
    await expect(verifyPreparedCopy(h.prepared, h.reconstructed, h.source, testSubtle, w.runtime))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(queued).toBe(true);
  });

  it('retains sparse left-order Array.every semantics', async () => {
    const h = await setupVerification(); const w = makeWorkHarness('prerequisite');
    h.reconstructed.records.workspace.projectOrder = new Array(2); h.prepared.workspace.projectOrder = ['a', 'b'];
    expect(await verifyPreparedCopy(h.prepared, h.reconstructed, h.source, testSubtle, w.runtime)).toBe(h.reconstructed.snapshot);
    expect(w.runtime.snapshot().legacyHashBytes).toBeGreaterThan(0);
  });

  it('returns the reconstructed snapshot when target and current source match the ledger', async () => {
    const source = validSource();
    const prepared = await prepareInitialCopy(source, deterministicEnvironment({
      crypto: webcrypto as Crypto,
    }));

    const verified = await verifyPreparedCopy(
      prepared,
      reconstructWorkspaceRecords(recordsFrom(prepared)),
      source,
    );

    expect(verified).toEqual(reconstructWorkspace(recordsFrom(prepared)));
  });

  it('rejects exact retained-source drift', async () => {
    const source = validSource();
    const prepared = await prepareInitialCopy(source, deterministicEnvironment({
      crypto: webcrypto as Crypto,
    }));
    const changed = structuredClone(source);
    changed[LEGACY_KEYS.projects].raw += ' ';

    await expect(verifyPreparedCopy(
      prepared,
      reconstructWorkspaceRecords(recordsFrom(prepared)),
      changed,
    ))
      .rejects.toMatchObject({ category: 'verification-failed' });
  });

  it('rejects independently valid target content and ledger-count mismatches', async () => {
    const source = validSource();
    const prepared = await prepareInitialCopy(source, deterministicEnvironment({
      crypto: webcrypto as Crypto,
    }));
    const changedRecords = recordsFrom(prepared);
    changedRecords.projects[0].project.name = 'Changed';
    await expect(verifyPreparedCopy(
      prepared,
      reconstructWorkspaceRecords(changedRecords),
      source,
    ))
      .rejects.toMatchObject({ category: 'verification-failed' });

    const changedLedger = structuredClone(prepared);
    changedLedger.ledger.counts.targetProjects += 1;
    await expect(verifyPreparedCopy(
      changedLedger,
      reconstructWorkspaceRecords(recordsFrom(prepared)),
      source,
    ))
      .rejects.toMatchObject({ category: 'verification-failed' });
  });
});
