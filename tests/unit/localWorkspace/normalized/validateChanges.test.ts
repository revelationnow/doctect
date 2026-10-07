import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { canonicalStringify } from '../../../../services/localWorkspace/canonical';
import { decomposeProject, reconstructProject } from '../../../../services/localWorkspace/normalized/codec';
import { createSizeLedger } from '../../../../services/localWorkspace/normalized/sizeLedger';
import { createFoldOverlayIndex, prepareFoldOverlayChanges, publishFoldOverlayChanges, digestNormalizedRecord, validateIncrementalChanges,
  type NormalizedFoldEffect, type ValidationContext, type PreparedChanges } from '../../../../services/localWorkspace/normalized/validateChanges';
import type { NormalizedProject, NormalizedRecordTypes, ProjectStoreName } from '../../../../services/localWorkspace/normalized/schema';
import { buildReferenceIndex, affectedReferences, updateReferenceIndex } from '../../../../services/document/references';
import { partitionState } from '../../../../services/document/partition';
import { assembleState } from '../../../../services/document/partition';
import { validateMigratedState } from '../../../../services/localWorkspace/validation';
import { makeIncrementalProject } from '../../../helpers/incrementalFixtures';
import { validateAppState, validateAppNode, validatePageTemplate, validateVariantMetadata } from '../../../../shared/validateAppState.js';
import { MAX_STATE_BYTES, MAX_ELEMENTS, MAX_NODES, MAX_VARIANTS } from '../../../../shared/projectLimits.js';
import * as preparation from '../../../../services/localWorkspace/normalized/validateChanges';
import { frameBatch } from '../../../../services/localWorkspace/normalized/commitProof';

it('stages fresh authoritative fold maps before explicitly preflighted publication', () => {
  const { context, records } = setup();
  const preferences = structuredClone(records.projectPreferences.values().next().value!);
  const exceptions = structuredClone(records.projectExtensions.get(JSON.stringify([...Object.values(context.scope), 'folds']))!);
  const refresh = preparation.prepareAuthoritativeFoldRefresh(context.folds, { preferences, exceptions, effects: [] });
  preparation.preflightFoldPublication(context.folds, refresh);
  publishFoldOverlayChanges(context.folds, refresh);
  context.read = ((store, key) => store === 'projectPreferences' ? preferences
    : store === 'projectExtensions' && key[3] === 'folds' ? exceptions : records[store].get(JSON.stringify(key))) as ValidationContext['read'];
  expect(() => validateIncrementalChanges(context, [{ type: 'put-template', variantId: 'default', template: template(records) }])).not.toThrow();
  expect(() => preparation.preflightFoldPublication(context.folds, refresh)).toThrow(/Stale/);
});

it('finalizes a mandatory header and exact physical digest after private timestamp and counter changes', () => {
  const { context, records } = setup();
  const prepared = validateIncrementalChanges(context, [{ type: 'put-node', node: { ...records.projectNodes.values().next().value!.value, title: 'changed' } }]);
  const header = { ...context.header, updatedAt: '2026-09-14T12:00:00.000Z' };
  const final = preparation.finalizePreparedChanges(context.ledger, prepared, context.header,
    records.projectPreferences.values().next().value!, header);
  const put = final.puts.find(p => p.store === 'projectHeaders')!;
  expect(put.record).toMatchObject({ updatedAt: header.updatedAt, counters: { documentBytes: final.ledger.documentBytes } });
  expect(put.digest).toBe(digestNormalizedRecord(put.store, put.record));
  expect(final.ledger.stateBytes).toBe(prepared.ledger.stateBytes);
});

it('does not let scalar cache deferral bypass document or fold-change validation', () => {
  const { context, records } = setup(); context.scalarPreferencesOnly = true;
  expect(() => validateIncrementalChanges(context, [{ type: 'put-node', node: records.projectNodes.values().next().value!.value }])).toThrow(/Scalar/);
  stageEffects(context, [{ variantId: 'default', templateId: 'page-0', preferences: {}, exceptions: {} }]);
  expect(() => validateIncrementalChanges(context, [])).toThrow(/Scalar/);
});

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function setup(project = makeIncrementalProject()) {
  const scope = { storageGeneration: 'g1', projectId: project.id, incarnation: 'i1' };
  const records = decomposeProject(project, scope);
  const references = buildReferenceIndex(partitionState(project.initialState).document);
  const read = vi.fn(<S extends ProjectStoreName>(store: S, key: readonly string[]): NormalizedRecordTypes[S] | undefined =>
    records[store].get(JSON.stringify(key)) as NormalizedRecordTypes[S] | undefined);
  const context: ValidationContext = { scope, header: records.projectHeaders.values().next().value!,
    ledger: createSizeLedger(records), references, read: read as ValidationContext['read'],
    folds: createFoldOverlayIndex(records.projectPreferences.values().next().value!,
      records.projectExtensions.get(JSON.stringify([...Object.values(scope), 'folds']))!) };
  const install = (prepared: PreparedChanges) => {
    prepared = preparation.finalizePreparedChanges(context.ledger, prepared, context.header, records.projectPreferences.values().next().value!,
      prepared.referenceEdit.changes.length ? (prepared.after.projectHeaders?.values().next().value ?? context.header) : undefined);
    for (const item of prepared.deletes) records[item.store].delete(JSON.stringify(item.key));
    for (const item of prepared.puts) (records[item.store] as Map<string, unknown>).set(JSON.stringify(item.record.key), item.record);
    // The future durable owner publishes these only after commit/readback succeeds.
    updateReferenceIndex(context.references, prepared.referenceEdit);
    publishFoldOverlayChanges(context.folds, prepared.foldEdit);
    context.header = records.projectHeaders.values().next().value!; context.ledger = prepared.ledger;
  };
  return { project, records, context, read, install };
}
const template = (records: NormalizedProject, id = 'page-0') => [...records.projectTemplates.values()].find(r => r.key[4] === id)!.value;
const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

it('metadata cloud values retain the external depth limit without private tag ancestry', () => {
  const { context, records, install } = setup();
  let nested: object = {}; for (let i = 0; i < 510; i++) nested = { child: nested };
  const cloud = { projectId: 'cloud', lastSyncedCommitId: 'commit', retained: nested };
  const metadata = { kind: 'patch' as const, cloud: { type: 'set' as const, value: cloud } };
  const batch = { scope: context.scope, clientId: 'metadata', commitId: 'depth', commitGeneration: 1,
    editorGeneration: 1, expectedRevision: 0, changes: [], metadata };
  expect(() => frameBatch(batch)).not.toThrow();
  // wrapper=0, cloud=1, retained=2; innermost object=512.
  install(validateIncrementalChanges(context, [], metadata));
  expect(reconstructProject(records).cloud).toEqual(cloud);
  expect(context.ledger).toEqual(createSizeLedger(records));
  const overDepth = { ...cloud, retained: { child: nested } };
  expect(() => validateIncrementalChanges(context, [], { kind: 'patch', cloud: { type: 'set', value: overDepth } })).toThrow('nesting exceeds 512');
});

it('rejects metadata accessors and scalar-lane metadata without changing prepared authority', () => {
  const { context } = setup(); const before = context.header;
  const getter = vi.fn(() => 'not read');
  const metadata = Object.defineProperty({ kind: 'patch' as const }, 'name', { enumerable: true, get: getter });
  expect(() => validateIncrementalChanges(context, [], metadata)).toThrow(/getters|accessors/);
  expect(getter).not.toHaveBeenCalled(); expect(context.header).toBe(before);
  context.scalarPreferencesOnly = true;
  expect(() => validateIncrementalChanges(context, [], { kind: 'patch', name: 'Not a preference' })).toThrow(/Scalar/);
});
function foldedProject() {
  const project = makeIncrementalProject(6);
  for (const [index, page] of Object.values(project.initialState.variants.default.templates).entries()) {
    const layer = page.layers![0];
    page.layers = [{ ...layer, id: 'unique', collapsed: index % 2 === 0 },
      { ...layer, id: 'raw', collapsed: { note: `Café ☕ ${index}` } as any },
      { ...layer, id: 'duplicate', collapsed: false }, { ...layer, id: 'duplicate', collapsed: true },
      { ...layer, id: 7 as any, collapsed: 'raw' as any }];
  }
  return project;
}
function stageEffects(context: ValidationContext, effects: readonly NormalizedFoldEffect[]) {
  const prefix = Object.values(context.scope);
  const preferences = context.read('projectPreferences', prefix)!;
  const exceptions = context.read('projectExtensions', [...prefix, 'folds'])!;
  const folds = prepareFoldOverlayChanges(context.folds, effects);
  const value = { ...preferences.value, layerCollapsed: folds.layerCollapsed };
  context.reconciledOverlays = { folds,
    preferences: { ...preferences, value, encodedSize: { ...preferences.encodedSize, valueBytes: byteLength(value) } },
    exceptions: { ...exceptions, value: folds.exceptions, encodedSize: { valueBytes: byteLength(folds.exceptions) } } };
  return folds;
}
// Test ingress oracle only. Addresses are explicit; no next-map diff discovers them.
function stageFromNormalized(context: ValidationContext, next: NormalizedProject, templateIds: readonly string[]) {
  const preferences = next.projectPreferences.values().next().value!;
  const exceptions = next.projectExtensions.get(JSON.stringify([...Object.values(context.scope), 'folds']))!;
  const effects = templateIds.map(templateId => {
    const effect = { variantId: 'default', templateId, preferences: {} as Record<string, boolean>, exceptions: {} as NormalizedFoldEffect['exceptions'] };
    const layers = next.projectTemplates.get(JSON.stringify([...Object.values(context.scope), 'default', templateId]))?.value.layers ?? [];
    layers.forEach((layer, position) => {
      const pref = JSON.stringify(['default', templateId, layer.id]); const raw = JSON.stringify(['default', templateId, position]);
      if (Object.hasOwn(preferences.value.layerCollapsed, pref)) effect.preferences[pref] = preferences.value.layerCollapsed[pref];
      if (Object.hasOwn(exceptions.value, raw)) effect.exceptions[raw] = exceptions.value[raw];
    });
    return effect;
  });
  return stageEffects(context, effects);
}

describe('private synchronous digest', () => {
  it('runs the actual private production SHA-256 against standard vectors and block boundaries', () => {
    // Exercise the unexported production primitive, without expanding the runtime API.
    const source = readFileSync('services/localWorkspace/normalized/validateChanges.ts', 'utf8');
    const parsed = ts.createSourceFile('validateChanges.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const declaration = parsed.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'sha256');
    expect(declaration?.body).toBeDefined();
    const routine = declaration!.getText(parsed);
    const js = ts.transpileModule(`${routine}\nexports.hash = sha256;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const exported: { hash?: (text: string) => string } = {};
    new Function('exports', js)(exported);
    expect(exported.hash!('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(exported.hash!('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(exported.hash!('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))
      .toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
    for (const text of [55, 56, 63, 64, 65, 128, 1024, 100000, 1000000].map(n => 'a'.repeat(n)).concat(['Café ☕', JSON.stringify('\uD800')]))
      expect(exported.hash!(text)).toBe(hash(text));
  });

  it('binds store and every physical envelope field with canonical key-order equivalence', () => {
    const { context } = setup(); const record = context.header;
    // Framing is an array [domain, store, canonical record object]; components
    // are canonicalized separately, so private framing consumes no payload depth.
    const frame = JSON.stringify(['doctect-normalized-record-v1', 'projectHeaders']).slice(0, -1)
      + ',' + canonicalStringify(record) + ']';
    expect(digestNormalizedRecord('projectHeaders', record)).toBe(hash(frame));
    const reversed = Object.fromEntries(Object.entries(record).reverse()) as typeof record;
    expect(digestNormalizedRecord('projectHeaders', reversed)).toBe(digestNormalizedRecord('projectHeaders', record));
    for (const changed of [
      { ...record, key: ['g2', record.key[1]] }, { ...record, lastCommitId: 'different' },
      { ...record, order: { ...record.order, state: [...record.order.state].reverse() } },
      { ...record, encodedSize: { ...record.encodedSize, valueBytes: record.encodedSize.valueBytes + 1 } },
    ]) expect(digestNormalizedRecord('projectHeaders', changed as typeof record)).not.toBe(digestNormalizedRecord('projectHeaders', record));
    expect(digestNormalizedRecord('projectNodes', record as any)).not.toBe(digestNormalizedRecord('projectHeaders', record));
  });

  it('hashes large selected UTF-8 payloads against an independent framed-record oracle', () => {
    const { context, records } = setup(); const node = records.projectNodes.values().next().value!.value;
    const prepared = validateIncrementalChanges(context, [{ type: 'put-node', node: { ...node, title: 'Café ☕ "\\\n\uD800'.repeat(10000) } }]);
    const put = prepared.puts[0];
    expect(put.digest).toBe(hash(`["doctect-normalized-record-v1",${canonicalStringify(put.store)},${canonicalStringify(put.record)}]`));
  });

  it('does not spend accepted depth-512 wrapper-extension ancestry on private digest framing', () => {
    const project = makeIncrementalProject(); let value: any = {};
    for (let i = 0; i < 511; i++) value = { x: value };
    (project as any).extra = value;
    const { records } = setup(project);
    const record = [...records.projectExtensions.values()].find(record => record.key[3] === 'wrapper')!;
    expect(() => canonicalStringify(record)).toThrow('nesting exceeds 512');
    const componentObject = '{' + Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalStringify(Reflect.get(record, key))}`).join(',') + '}';
    const frame = `["doctect-normalized-record-v1","projectExtensions",${componentObject}]`;
    expect(digestNormalizedRecord('projectExtensions', record)).toBe(hash(frame));
  });
});

describe('selected incremental preparation', () => {
  it('uses only explicit before/after buckets for structural and preference effects and selected publication', () => {
    const project = foldedProject(); const owner = setup(project);
    const { context, records, read, install } = owner;
    const old = template(records); const originalIndex = context.folds;
    const next = structuredClone(project);
    next.initialState.variants.default.templates['page-0'].layers!.reverse();
    next.initialState.variants.default.templates['page-2'].layers![0].collapsed = false;
    const nextRecords = decomposeProject(next, context.scope);
    const parse = JSON.parse;
    const discovery = vi.spyOn(JSON, 'parse').mockImplementation((text, reviver) => {
      const value = parse(text, reviver);
      if (Array.isArray(value) && value.length === 3 && value[0] === 'default' && !['page-0', 'page-2'].includes(value[1]))
        throw new Error('Decoded an unrelated fold address');
      return value;
    });
    read.mockImplementation((store: ProjectStoreName, key: readonly string[]) => {
      if (store === 'projectTemplates' && !['page-0', 'page-2'].includes(key[4])) throw new Error('Unrelated template payload read');
      return records[store].get(JSON.stringify(key)) as any;
    });
    let prepared: PreparedChanges;
    try {
      stageFromNormalized(context, nextRecords, ['page-0', 'page-2']);
      prepared = validateIncrementalChanges(context, [{ type: 'put-template', variantId: 'default', template: { ...old, layers: [...old.layers!].reverse() } }]);
      // Preparing twice before publication leaves the same live owner usable.
      expect(validateIncrementalChanges(context, prepared.referenceEdit.changes).ledger).toEqual(prepared.ledger);
      const set = vi.spyOn(Map.prototype, 'set');
      try {
        install(prepared);
        const bucketKeys = Object.keys(project.initialState.variants.default.templates).map(id => JSON.stringify(['default', id]));
        expect(set.mock.calls.map(([key]) => key).filter(key => bucketKeys.includes(key)))
          .toEqual([JSON.stringify(['default', 'page-0']), JSON.stringify(['default', 'page-2'])]);
      } finally { set.mockRestore(); }
      expect(() => publishFoldOverlayChanges(context.folds, prepared.foldEdit)).toThrow('Stale fold publication');
      expect(() => validateIncrementalChanges(context, prepared.referenceEdit.changes)).toThrow('Stale fold effects');
    } finally { discovery.mockRestore(); }
    expect(context.folds).toBe(originalIndex);
    expect(context.ledger.stateBytes).toBe(byteLength(next.initialState));
    expect(reconstructProject(records)).toEqual(next);

    // Inverse and repeated edits use updated cached buckets, not ingress rebuilds.
    stageFromNormalized(context, decomposeProject(project, context.scope), ['page-0', 'page-2']);
    install(validateIncrementalChanges(context, [{ type: 'put-template', variantId: 'default', template: old }]));
    expect(reconstructProject(records)).toEqual(project);
    expect(context.ledger.stateBytes).toBe(byteLength(project.initialState));
    delete context.reconciledOverlays;
    install(validateIncrementalChanges(context, [{ type: 'put-template', variantId: 'default', template: { ...old, name: 'again' } }]));
    expect(context.folds).toBe(originalIndex);
  });

  it('keeps rejected and abandoned drafts isolated and rejects stale/rebound cache effects', () => {
    const project = foldedProject(); const { context, records, install } = setup(project);
    const old = template(records); const beforeBytes = context.ledger;
    const beforeRecords = [...records.projectPreferences.values()];
    const next = structuredClone(project); next.initialState.variants.default.templates['page-0'].layers![0].collapsed = false;
    const normalized = decomposeProject(next, context.scope);
    const abandoned = stageFromNormalized(context, normalized, ['page-0']);
    const pending = validateIncrementalChanges(context, []);
    context.ledger = { ...context.ledger, stateBytes: MAX_STATE_BYTES + 100 };
    expect(() => validateIncrementalChanges(context, [])).toThrow('bytes');
    context.ledger = beforeBytes;
    expect([...records.projectPreferences.values()]).toEqual(beforeRecords);
    delete context.reconciledOverlays;
    expect(validateIncrementalChanges(context, [{ type: 'put-template', variantId: 'default', template: old }]).ledger).toEqual(beforeBytes);

    stageFromNormalized(context, normalized, ['page-0']);
    install(validateIncrementalChanges(context, []));
    expect(() => publishFoldOverlayChanges(context.folds, pending.foldEdit)).toThrow('Stale fold publication');
    context.reconciledOverlays = { ...context.reconciledOverlays!, folds: abandoned };
    expect(() => validateIncrementalChanges(context, [])).toThrow('Stale fold effects');

    const replacement = setup(project); // Equal IDs, distinct admitted owner.
    const newIndex = replacement.context.folds;
    replacement.context.folds = context.folds;
    expect(() => validateIncrementalChanges(replacement.context, [{ type: 'put-template', variantId: 'default', template: old }])).toThrow('Stale fold index');
    replacement.context.folds = newIndex;
    expect(() => publishFoldOverlayChanges(newIndex, pending.foldEdit)).toThrow('Stale fold publication');
    replacement.install(validateIncrementalChanges(replacement.context, [{ type: 'put-template', variantId: 'default', template: { ...old, name: 'replacement' } }]));
    expect(replacement.context.ledger.stateBytes).toBe(byteLength(reconstructProject(replacement.records).initialState));
  });

  it('preserves stale, overlapping and raw-owner validation with scoped effects', () => {
    const { context, records } = setup(foldedProject()); const old = template(records);
    expect(() => validateIncrementalChanges(context, [{ type: 'delete-template', variantId: 'default', templateId: 'page-0' }])).toThrow(/Stale fold/);
    expect(() => validateIncrementalChanges(context, [{ type: 'put-template', variantId: 'default', template: { ...old, layers: old.layers!.slice(1) } }])).toThrow(/Stale fold/);
    const pref = JSON.stringify(['default', 'page-0', 'unique']);
    const raw = JSON.stringify(['default', 'page-0', 0]);
    for (const [preferences, exceptions, error] of [
      [{ [pref]: true }, { [raw]: { value: 'raw' } }, 'Overlapping/noncanonical'],
      [{}, { [raw]: { value: false } }, 'Overlapping/noncanonical'],
      [{ [JSON.stringify(['default', 'page-0', 'missing'])]: false }, {}, 'Stale fold preference'],
      [{}, { [JSON.stringify(['default', 'page-0', 99])]: { value: 'raw' } }, 'Stale fold exception'],
    ] as const) {
      stageEffects(context, [{ variantId: 'default', templateId: 'page-0', preferences, exceptions }]);
      expect(() => validateIncrementalChanges(context, [])).toThrow(error);
    }
    delete context.reconciledOverlays;
    expect(validateIncrementalChanges(context, [{ type: 'put-template', variantId: 'default', template: old }]).ledger.stateBytes)
      .toBe(byteLength(foldedProject().initialState));
  });

  it('removes the last fold bucket on deletion and restores it by explicit inverse effects', () => {
    const project = foldedProject(); const { context, records, install } = setup(project); const old = template(records);
    stageEffects(context, [{ variantId: 'default', templateId: 'page-0', preferences: {}, exceptions: {} }]);
    install(validateIncrementalChanges(context, [{ type: 'delete-template', variantId: 'default', templateId: 'page-0' }]));
    const deleted = structuredClone(project); delete deleted.initialState.variants.default.templates['page-0'];
    expect(context.ledger.stateBytes).toBe(byteLength(deleted.initialState));
    expect(reconstructProject(records)).toEqual(deleted);
    stageFromNormalized(context, decomposeProject(project, context.scope), ['page-0']);
    install(validateIncrementalChanges(context, [{ type: 'put-template', variantId: 'default', template: old }]));
    expect(context.ledger.stateBytes).toBe(byteLength(project.initialState));
    expect(reconstructProject(records).initialState.variants.default.templates['page-0']).toEqual(project.initialState.variants.default.templates['page-0']);
  });

  it('rejects cross-template effects, malformed raw cells and unannounced maps even with a valid draft', () => {
    const { context } = setup(foldedProject());
    const effect: NormalizedFoldEffect = { variantId: 'default', templateId: 'page-0', preferences: {}, exceptions: {} };
    expect(() => prepareFoldOverlayChanges(context.folds, [effect, effect])).toThrow('Duplicate fold effect');
    expect(() => prepareFoldOverlayChanges(context.folds, [{ ...effect, preferences: { '["default","page-1","unique"]': true } }])).toThrow('another template');
    expect(() => prepareFoldOverlayChanges(context.folds, [{ ...effect, exceptions: { '["default","page-0",0]': { value: undefined } } }])).toThrow(/JSON/);
    const getter = vi.fn(); const bad = { ...effect };
    Object.defineProperty(bad, 'preferences', { enumerable: true, get: getter });
    expect(() => prepareFoldOverlayChanges(context.folds, [bad])).toThrow(/getters|accessors/); expect(getter).not.toHaveBeenCalled();
    stageEffects(context, [effect]);
    const overlays = context.reconciledOverlays!;
    const value = { ...overlays.preferences.value, layerCollapsed: { ...overlays.preferences.value.layerCollapsed, '["default","page-3","unique"]': true } };
    context.reconciledOverlays = { ...overlays, preferences: { ...overlays.preferences, value,
      encodedSize: { ...overlays.preferences.encodedSize, valueBytes: byteLength(value) } } };
    expect(() => validateIncrementalChanges(context, [])).toThrow('Unannounced fold maps');
  });

  it('does not encode unchanged admitted overlay records when supplied with an ordinary edit', () => {
    const { context, records } = setup(foldedProject());
    const preferences = records.projectPreferences.values().next().value!;
    const exceptions = records.projectExtensions.get(JSON.stringify([...Object.values(context.scope), 'folds']))!;
    const folds = prepareFoldOverlayChanges(context.folds, []);
    expect(folds.layerCollapsed).toBe(preferences.value.layerCollapsed);
    expect(folds.exceptions).toBe(exceptions.value);
    context.reconciledOverlays = { preferences, exceptions, folds };
    const stringify = JSON.stringify;
    const encoding = vi.spyOn(JSON, 'stringify').mockImplementation(((value: unknown, ...args: any[]) => {
      if (value === preferences.value || value === exceptions.value) throw new Error('Encoded unchanged overlay record');
      return (stringify as any)(value, ...args);
    }) as typeof JSON.stringify);
    try {
      const prepared = validateIncrementalChanges(context, [{ type: 'put-template', variantId: 'default', template: { ...template(records), name: 'edit' } }]);
      expect(prepared.puts.map(item => item.store)).toEqual(['projectTemplates']);
    } finally { encoding.mockRestore(); }
  });

  it('rejects unannounced changed fold buckets rather than discovering them by a global diff', () => {
    const project = foldedProject(); const { context } = setup(project);
    project.initialState.variants.default.templates['page-3'].layers![0].collapsed = true;
    const next = decomposeProject(project, context.scope);
    context.reconciledOverlays = { preferences: next.projectPreferences.values().next().value!,
      exceptions: next.projectExtensions.get(JSON.stringify([...Object.values(context.scope), 'folds']))! };
    expect(() => validateIncrementalChanges(context, [])).toThrow(/Unannounced fold maps/);
  });

  it('does not enumerate unrelated fold keys for an ordinary one-template payload edit', () => {
    const project = foldedProject();
    expect(validateAppState(project.initialState).ok).toBe(true);
    const { context, records, read, install } = setup(project);
    expect(reconstructProject(records)).toEqual(project);
    const preferences = records.projectPreferences.values().next().value!;
    const exceptions = records.projectExtensions.get(JSON.stringify([...Object.values(context.scope), 'folds']))!;
    expect(Object.keys(preferences.value.layerCollapsed)).toHaveLength(6);
    expect(Object.keys(exceptions.value)).toHaveLength(24);
    const old = template(records); const next = { ...old, name: `${old.name} Café ☕` };
    const expected = structuredClone(project.initialState);
    expected.variants.default.templates['page-0'].name = next.name;
    read.mockImplementation((store: ProjectStoreName, key: readonly string[]) => {
      if (store === 'projectTemplates' && key[4] !== 'page-0') throw new Error('Unrelated template payload read');
      return records[store].get(JSON.stringify(key)) as any;
    });
    const keys = Object.keys;
    const enumeration = vi.spyOn(Object, 'keys').mockImplementation(value => {
      if (value === preferences.value.layerCollapsed || value === exceptions.value)
        throw new Error('Unrelated fold-key discovery');
      return keys(value);
    });
    let prepared: PreparedChanges;
    try {
      prepared = validateIncrementalChanges(context, [{ type: 'put-template', variantId: 'default', template: next }]);
    } finally { enumeration.mockRestore(); }
    expect(prepared!.puts.map(item => item.store)).toEqual(['projectTemplates']);
    expect(prepared!.ledger.stateBytes).toBe(byteLength(expected));
    expect(prepared!.counterDeltas.stateBytes).toBe(byteLength(' Café ☕') - byteLength(''));
    install(prepared!);
    expect(reconstructProject(records).initialState).toEqual(expected);
  });

  it('prepares only the selected node synchronously, leaves inputs/index untouched, then supports inverse updates', () => {
    const { context, records, read, install } = setup(); const old = records.projectNodes.values().next().value!.value;
    const originalIndex = [...context.references].map(([key, owners]) => [key, [...owners]]);
    for (const value of [{ ...old, title: 'Café ☕', referenceId: 'missing' }, old, { ...old, title: 'third' }]) {
      const prepared = validateIncrementalChanges(context, [{ type: 'put-node', node: value }]);
      expect(prepared).not.toBeInstanceOf(Promise); expect(prepared.puts.map(p => p.store)).toEqual(['projectNodes']);
      expect(prepared.puts[0].digest).toBe(digestNormalizedRecord(prepared.puts[0].store, prepared.puts[0].record));
      expect(prepared.affectedReferences).toContainEqual({ kind: 'root' });
      if (value.referenceId === 'missing') expect([...context.references].map(([key, owners]) => [key, [...owners]])).toEqual(originalIndex);
      install(prepared);
      expect(context.ledger).toEqual(createSizeLedger(records));
      expect(affectedReferences(context.references, [{ kind: 'node', nodeId: 'missing' }]).length).toBe(value.referenceId ? 1 : 0);
    }
    expect(read.mock.calls.some(([store]) => store === 'projectTemplates')).toBe(false);
  });

  it('selects one template, preserves extensions and fallback references, and hashes its actual physical record', () => {
    const { context, records, read, install } = setup(makeIncrementalProject(30)); const old = template(records);
    read.mockImplementation((store: ProjectStoreName, key: readonly string[]) => {
      if (store === 'projectTemplates' && key[4] !== 'page-0') throw new Error('Unrelated template read');
      return records[store].get(JSON.stringify(key)) as any;
    });
    const next = { ...old, extra: { '☕': '\uD800' }, elements: [null, { type: 'svg', svgContent: '<not-valid-svg>', layerId: 'missing' },
      { type: 'grid', gridConfig: { sourceType: 'specific', sourceId: 'missing' } }] } as any;
    const prepared = validateIncrementalChanges(context, [{ type: 'put-template', variantId: 'default', template: next }]);
    install(prepared); expect(reconstructProject(records).initialState.variants.default.templates['page-0'].elements).toEqual(next.elements);
    expect(context.ledger).toEqual(createSizeLedger(records));
    expect(affectedReferences(context.references, [{ kind: 'node', nodeId: 'missing' }])).toContainEqual({ kind: 'template', variantId: 'default', templateId: 'page-0' });
  });

  it.each([
    ['dimensions', { width: 0 }], ['layers', { layers: {} }], ['layers', { layers: Array(201).fill({}) }],
    ['layerId', { elements: [{ type: 'svg', layerId: 5 }] }],
    ['textOverflow', { elements: [{ type: 'text', textOverflow: 'invalid' }] }],
    ['textWrap', { elements: [{ type: 'grid', textWrap: 0 }] }],
    ['textPadding', { elements: [{ type: 'text', textPadding: { top: -1, right: 0, bottom: 0, left: 0 } }] }],
  ])('matches full validation for invalid %s and never poisons the live index', (message, patch) => {
    const { project, context, records } = setup(); const next = { ...template(records), ...patch } as any;
    project.initialState.variants.default.templates['page-0'] = next;
    expect(validateAppState(project.initialState).ok).toBe(false);
    const snapshot = [...context.references].map(([key, owners]) => [key, [...owners]]);
    expect(() => validateIncrementalChanges(context, [{ type: 'put-template', variantId: 'default', template: next }])).toThrow(message);
    expect([...context.references].map(([key, owners]) => [key, [...owners]])).toEqual(snapshot);
  });

  it('uses aggregate cap exactly, without reserved headroom, and checks node/variant/element counters', () => {
    const { context, records } = setup(); const old = records.projectNodes.values().next().value!.value;
    context.ledger = { ...context.ledger, stateBytes: MAX_STATE_BYTES - 1, documentBytes: MAX_STATE_BYTES - 1 - context.ledger.preferenceBytes };
    const prepared = validateIncrementalChanges(context, [{ type: 'put-node', node: { ...old, title: old.title + 'a' } }]);
    expect(prepared.ledger.stateBytes).toBe(MAX_STATE_BYTES);
    expect(() => validateIncrementalChanges(context, [{ type: 'put-node', node: { ...old, title: old.title + 'ab' } }])).toThrow('bytes');
    for (const [counter, limit, change] of [
      ['nodeCount', MAX_NODES, { type: 'put-node', node: { ...old, id: 'new' } }],
      ['variantCount', MAX_VARIANTS, { type: 'put-variant', variant: { id: 'new', name: 'New' } }],
      ['elementCount', MAX_ELEMENTS, { type: 'put-template', variantId: 'default', template: { ...template(records), elements: [...template(records).elements, null] } }],
    ] as const) {
      context.ledger = { ...createSizeLedger(records), [counter]: limit };
      expect(() => validateIncrementalChanges(context, [change as any])).toThrow(/too many/);
    }
  });

  it('keeps source replacement/deletion, structural membership and repeated batch edits exact', () => {
    const { context, records, install } = setup();
    const generator = { formatVersion: 1 as const, templateScript: '☕', hierarchyScript: '', generatedAt: '2026-09-14T00:00:00.000Z' };
    for (const source of [generator, { ...generator, templateScript: 'new' }, undefined]) {
      install(validateIncrementalChanges(context, [{ type: 'set-generator', generator: source }]));
      expect(context.ledger).toEqual(createSizeLedger(records)); expect(reconstructProject(records).initialState.generator).toEqual(source);
    }
    expect(() => validateIncrementalChanges(context, [{ type: 'set-generator', generator: { ...generator, unknown: 1 } as any }])).toThrow('unknown');
    const next = { ...template(records), id: 'extra' };
    install(validateIncrementalChanges(context, [{ type: 'put-variant', variant: { id: 'new', name: 'New', extra: 1 } as any },
      { type: 'put-template', variantId: 'new', template: next }, { type: 'put-template', variantId: 'new', template: { ...next, name: 'Last' } }]));
    expect(reconstructProject(records).initialState.variants.new.templates.extra.name).toBe('Last');
    install(validateIncrementalChanges(context, [{ type: 'delete-variant', variantId: 'new' }]));
    expect(context.ledger).toEqual(createSizeLedger(records)); expect(reconstructProject(records).initialState.variants.new).toBeUndefined();
  });

  it('rejects accessors without invoking them, unsupported JSON, and true external over-depth only', () => {
    const { context, records } = setup(); const old = records.projectNodes.values().next().value!.value;
    const getter = vi.fn(() => 'unsafe'); const bad = { ...old };
    Object.defineProperty(bad, 'title', { enumerable: true, get: getter });
    expect(() => validateIncrementalChanges(context, [{ type: 'put-node', node: bad }])).toThrow(/getters|accessors/); expect(getter).not.toHaveBeenCalled();
    for (const data of [{ x: undefined }, { x: NaN }, { x: 1n }, { x: new Date() }, { x: [, 1] }])
      expect(() => validateIncrementalChanges(context, [{ type: 'put-node', node: { ...old, data } as any }])).toThrow(/JSON/);
    let nested: any = {}; for (let i = 0; i < 508; i++) nested = { x: nested };
    // wrapper=0, state=1, nodes=2, node=3, data=4; innermost object=512.
    const accepted = { ...old, data: nested };
    const prepared = validateIncrementalChanges(context, [{ type: 'put-node', node: accepted }]);
    expect(prepared.puts[0].digest).toMatch(/^[a-f0-9]{64}$/);
    expect(() => validateIncrementalChanges(context, [{ type: 'put-node', node: { ...old, data: { x: nested } } }])).toThrow('nesting exceeds 512');
  });

  it('matches a full JSON byte oracle at the actual 32 MiB cap and rejects exactly one extra byte', () => {
    const project = makeIncrementalProject(); (project.initialState as any).padding = '';
    const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
    (project.initialState as any).padding = 'a'.repeat(MAX_STATE_BYTES - 1 - byteLength(project.initialState));
    const { context } = setup(project); const old = project.initialState.nodes.root;
    expect(context.ledger.stateBytes).toBe(MAX_STATE_BYTES - 1);
    const prepared = validateIncrementalChanges(context, [{ type: 'put-node', node: { ...old, title: old.title + 'a' } }]);
    project.initialState.nodes.root = { ...old, title: old.title + 'a' };
    expect(prepared.ledger.stateBytes).toBe(byteLength(project.initialState));
    expect(prepared.ledger.stateBytes).toBe(MAX_STATE_BYTES);
    expect(() => validateIncrementalChanges(context, [{ type: 'put-node', node: { ...old, title: old.title + 'ab' } }])).toThrow('bytes');
  });

  it('supports final-batch variant membership even when child puts precede variant creation', () => {
    const { context, records, install } = setup(); const next = { ...template(records), id: 'new-template' };
    install(validateIncrementalChanges(context, [
      { type: 'put-template', variantId: 'new', template: next },
      { type: 'put-variant', variant: { id: 'new', name: 'New' } },
    ]));
    expect(reconstructProject(records).initialState.variants.new.templates['new-template']).toEqual(next);
    expect(context.ledger).toEqual(createSizeLedger(records));
  });

  it('preserves ordered template remove/reinsert transitions without reading unrelated templates', () => {
    const { context, records, install, read } = setup(makeIncrementalProject(4));
    const a = template(records, 'page-0'); const b = template(records, 'page-1');
    const before = records.projectVariants.values().next().value!;
    read.mockImplementation((store, key) => {
      if (store === 'projectTemplates' && !['page-0', 'page-1'].includes(key[4])) throw new Error('Unrelated template read');
      return records[store].get(JSON.stringify(key)) as any;
    });
    const prepared = validateIncrementalChanges(context, [
      { type: 'delete-template', variantId: 'default', templateId: a.id },
      { type: 'put-template', variantId: 'default', template: a },
      { type: 'delete-template', variantId: 'default', templateId: b.id },
      { type: 'put-template', variantId: 'default', template: b },
      { type: 'delete-template', variantId: 'default', templateId: a.id },
      { type: 'put-template', variantId: 'default', template: { ...a, name: 'Recreated' } },
    ]);
    expect(before.templateOrder).toEqual(['page-0', 'page-1', 'page-2', 'page-3']);
    expect(prepared.puts.find(p => p.store === 'projectVariants')?.record).toMatchObject({ templateOrder: ['page-2', 'page-3', 'page-1', 'page-0'] });
    install(prepared);
    expect(Object.keys(reconstructProject(records).initialState.variants.default.templates)).toEqual(['page-2', 'page-3', 'page-1', 'page-0']);
    expect(context.ledger).toEqual(createSizeLedger(records));
  });

  it('discards pre-deletion child intents and orders new children before final parent metadata', () => {
    const { context, records, install } = setup(); const original = template(records);
    const put = (id: string) => ({ type: 'put-template' as const, variantId: 'new', template: { ...original, id } });
    install(validateIncrementalChanges(context, [
      put('discarded'), { type: 'put-variant', variant: { id: 'new', name: 'Old' } },
      { type: 'delete-variant', variantId: 'new' },
      put('a'), put('b'), { type: 'delete-template', variantId: 'new', templateId: 'a' }, put('a'),
      { type: 'put-variant', variant: { id: 'new', name: 'New' } },
    ]));
    const templates = reconstructProject(records).initialState.variants.new.templates;
    expect(Object.keys(templates)).toEqual(['b', 'a']); expect(templates.discarded).toBeUndefined();
    expect(context.ledger).toEqual(createSizeLedger(records));
  });

  it('keeps transaction-final missing-parent admission for transient child puts that are removed', () => {
    const { context, records, install } = setup(); const original = template(records);
    install(validateIncrementalChanges(context, [
      { type: 'put-template', variantId: 'absent', template: { ...original, id: 'transient' } },
      { type: 'delete-template', variantId: 'absent', templateId: 'transient' },
    ]));
    expect(reconstructProject(records).initialState.variants.absent).toBeUndefined();
    expect(context.ledger).toEqual(createSizeLedger(records));
  });

  it('rebinds a replacement owner and captures old dependents before deletion/inverse publication', () => {
    let owner = setup();
    const original = owner.records.projectNodes.values().next().value!.value;
    const linked = { ...original, id: 'linked', referenceId: 'root' };
    owner.install(validateIncrementalChanges(owner.context, [{ type: 'put-node', node: linked }]));
    const replacement = makeIncrementalProject(); replacement.initialState.nodes.root.title = 'replacement';
    const stale = owner.context.references; owner = setup(replacement);
    const prepared = validateIncrementalChanges(owner.context, [{ type: 'put-node', node: { ...original, title: 'current' } }]);
    expect(prepared.affectedReferences).not.toContainEqual({ kind: 'node', nodeId: 'linked' });
    expect(affectedReferences(stale, [{ kind: 'node', nodeId: 'root' }])).toContainEqual({ kind: 'node', nodeId: 'linked' });
    owner.install(validateIncrementalChanges(owner.context, [{ type: 'put-node', node: linked }]));
    const deletion = validateIncrementalChanges(owner.context, [{ type: 'delete-node', nodeId: 'linked' }]);
    expect(deletion.deletes[0].digest).toBe(digestNormalizedRecord('projectNodes', owner.records.projectNodes.get(JSON.stringify([...Object.values(owner.context.scope), 'linked']))!));
    expect(affectedReferences(owner.context.references, [{ kind: 'node', nodeId: 'root' }])).toContainEqual({ kind: 'node', nodeId: 'linked' });
    owner.install(deletion);
    expect(affectedReferences(owner.context.references, [{ kind: 'node', nodeId: 'root' }])).not.toContainEqual({ kind: 'node', nodeId: 'linked' });
    owner.install(validateIncrementalChanges(owner.context, [{ type: 'put-node', node: linked }]));
    expect(affectedReferences(owner.context.references, [{ kind: 'node', nodeId: 'root' }])).toContainEqual({ kind: 'node', nodeId: 'linked' });
  });

  it('accounts authoritative reconciled folds, not stale incoming template history or header preferences', () => {
    const project = makeIncrementalProject();
    (project.initialState.variants.default.templates['page-0'] as any).layers = [{ id: 'a', collapsed: 'raw' }, { id: 'b', collapsed: false }];
    const { context, records, install } = setup(project); const old = template(records);
    const externalNext = structuredClone(project); const nextTemplate = externalNext.initialState.variants.default.templates['page-0'];
    nextTemplate.layers = [nextTemplate.layers![1], nextTemplate.layers![0]];
    nextTemplate.layers[0].collapsed = true;
    const normalizedNext = decomposeProject(externalNext, context.scope);
    stageFromNormalized(context, normalizedNext, ['page-0']);
    const next = { ...old, layers: [old.layers![1], old.layers![0]] };
    const prepared = validateIncrementalChanges(context, [{ type: 'put-template', variantId: 'default', template: next }]);
    expect(prepared.puts.some(p => p.store === 'projectHeaders')).toBe(false);
    install(prepared); expect(reconstructProject(records).initialState).toEqual(externalNext.initialState);
    expect(context.ledger).toEqual(createSizeLedger(normalizedNext));
  });

  it('rejects malformed reconciled overlay envelopes before getters and scopes can leak into puts', () => {
    const { context, records } = setup();
    const preferences = records.projectPreferences.values().next().value!;
    const exceptions = records.projectExtensions.get(JSON.stringify([...Object.values(context.scope), 'folds']))!;
    for (const bad of [
      { ...preferences, key: ['other', 'project', 'incarnation'] },
      { ...preferences, value: { ...preferences.value, layerCollapsed: { bad: true } } },
      { ...preferences, value: { ...preferences.value, panelsExpanded: { bad: 0 } } },
      { ...preferences, value: { ...preferences.value, scale: undefined } },
    ]) {
      context.reconciledOverlays = { preferences: bad as any, exceptions };
      expect(() => validateIncrementalChanges(context, [])).toThrow();
    }
    const getter = vi.fn(() => preferences.value); const bad = { ...preferences };
    Object.defineProperty(bad, 'value', { enumerable: true, get: getter });
    context.reconciledOverlays = { preferences: bad, exceptions };
    expect(() => validateIncrementalChanges(context, [])).toThrow(/getters|accessors/); expect(getter).not.toHaveBeenCalled();
  });

  it('session clipboard edits submit no records or accounting; explicit live export still validates', () => {
    const { context, project, read } = setup(); const parts = partitionState(project.initialState);
    const live = { ...assembleState(parts), clipboard: [{ unexpected: undefined }] };
    const prepared = validateIncrementalChanges(context, []);
    expect(prepared.puts).toEqual([]); expect(prepared.deletes).toEqual([]); expect(prepared.ledger).toEqual(context.ledger);
    expect(read).not.toHaveBeenCalled(); expect(() => validateMigratedState(live)).toThrow(/JSON-compatible/);
  });

  it('preserves complete/server per-record validation and historical schema fallback rules', () => {
    const { project, records } = setup(); const node = project.initialState.nodes.root;
    for (const patch of [{ id: 'wrong' }, { parentId: 5 }, { title: 0 }, { type: null }, { data: [] }, { children: [1] }]) {
      const bad = { ...node, ...patch }; const state = { ...project.initialState, nodes: { root: bad } };
      expect(validateAppNode('root', bad)).toEqual(validateAppState(state));
    }
    expect(validateVariantMetadata('default', { id: 'other', name: '' }).ok).toBe(true);
    expect(validateVariantMetadata('default', { id: 1, name: '' }).ok).toBe(false);
    const old = template(records);
    for (const [schemaVersion, elements, accepted] of [
      [9, [{ type: 'text', textWrap: 1, textOverflow: 'bad' }], true],
      [10, [{ type: 'text', textPadding: 1 }], true],
      [11, [{ type: 'grid', textPadding: 1 }], true],
      [11, [{ type: 'text', textPadding: 1 }], false],
      [11, [null, 3, { type: 'svg', svgContent: false }], true],
    ] as const) {
      const value = { ...old, elements };
      const state = { ...project.initialState, schemaVersion, variants: { default: { id: 'other', name: '', templates: { other: value } } } };
      expect(validatePageTemplate('default', 'other', value, schemaVersion).ok).toBe(accepted);
      expect(validateAppState(state).ok).toBe(accepted);
    }
  });

  it('validates actual template and fold external depth without charging digest/storage framing', () => {
    const { context, records, install } = setup(); const old = template(records);
    const nested = (count: number) => { let value: any = {}; for (let i = 0; i < count; i++) value = { x: value }; return value; };
    const next = { ...old, extra: nested(506) };
    install(validateIncrementalChanges(context, [{ type: 'put-template', variantId: 'default', template: next }]));
    expect(() => reconstructProject(records)).not.toThrow();
    expect(() => validateIncrementalChanges(context, [{ type: 'put-template', variantId: 'default', template: { ...old, extra: nested(507) } } as any])).toThrow('nesting exceeds 512');
    const externalProject = structuredClone(reconstructProject(records));
    (externalProject.initialState.variants.default.templates['page-0'].layers![0] as any).collapsed = nested(504);
    const normalized = decomposeProject(externalProject, context.scope);
    stageFromNormalized(context, normalized, ['page-0']);
    install(validateIncrementalChanges(context, []));
    expect(context.ledger).toEqual(createSizeLedger(normalized)); expect(() => reconstructProject(records)).not.toThrow();
    const exceptions = structuredClone(context.reconciledOverlays.exceptions);
    const cell = Object.values(exceptions.value)[0] as any; cell.value = { x: cell.value };
    exceptions.encodedSize.valueBytes = new TextEncoder().encode(JSON.stringify(exceptions.value)).length;
    expect(() => stageEffects(context, [{ variantId: 'default', templateId: 'page-0', preferences: {}, exceptions: exceptions.value }])).toThrow('nesting exceeds 512');
  });

  it('preference-only preparation changes no document records and accounts false/zero/absence repeatedly', () => {
    const { context, records, install } = setup(); const header = context.header;
    const documentBytes = context.ledger.documentBytes;
    for (const value of [undefined, false, undefined, true, false]) {
      const preferences = structuredClone(records.projectPreferences.values().next().value!);
      preferences.value.layerCollapsed = records.projectPreferences.values().next().value!.value.layerCollapsed;
      if (value === undefined) delete (preferences.value as any).showGrid; else preferences.value.showGrid = value;
      preferences.value.scale = 0;
      preferences.encodedSize.valueBytes = new TextEncoder().encode(JSON.stringify(preferences.value)).length;
      context.reconciledOverlays = { preferences, exceptions: records.projectExtensions.get(JSON.stringify([...Object.values(context.scope), 'folds']))! };
      const prepared = validateIncrementalChanges(context, []);
      expect(prepared.puts.map(item => item.store)).toEqual(['projectPreferences']);
      expect(prepared.counterDeltas.documentBytes).toBe(0); install(prepared);
      expect(context.header).toBe(header); expect(context.ledger.documentBytes).toBe(documentBytes);
      expect(context.ledger).toEqual(createSizeLedger(records)); expect(() => reconstructProject(records)).not.toThrow();
    }
  });

  it('checks generator UTF-8 source limit on selected replacements without dropping prior accepted source', () => {
    const { context, records, install } = setup();
    const generator = { formatVersion: 1 as const, templateScript: 'a'.repeat(512 * 1024), hierarchyScript: '', generatedAt: '2026-09-14T00:00:00.000Z' };
    install(validateIncrementalChanges(context, [{ type: 'set-generator', generator }]));
    const before = context.ledger;
    expect(() => validateIncrementalChanges(context, [{ type: 'set-generator', generator: { ...generator, templateScript: generator.templateScript + 'a' } }])).toThrow('512 KiB');
    expect(context.ledger).toBe(before); expect(records.projectSources.values().next().value!.value).toEqual(generator);
  });

  it('matches immutable-edit semantics across repeated add/delete/recreate batches and root replacement', () => {
    const owner = setup(); const old = owner.project.initialState.nodes.root;
    for (const changes of [
      [{ type: 'put-variant', variant: { id: 'extra', name: 'One' } },
        { type: 'put-template', variantId: 'extra', template: { ...template(owner.records), id: 'one' } },
        { type: 'delete-variant', variantId: 'extra' }, { type: 'put-variant', variant: { id: 'extra', name: 'Two' } }],
      [{ type: 'delete-node', nodeId: 'root' }, { type: 'put-node', node: { ...old, id: 'new-root' } }, { type: 'set-root', rootId: 'new-root' }],
      [{ type: 'put-node', node: { ...old } }, { type: 'set-root', rootId: 'root' }, { type: 'delete-node', nodeId: 'new-root' }],
    ] as const) {
      owner.install(validateIncrementalChanges(owner.context, changes));
      const external = reconstructProject(owner.records);
      expect(owner.context.ledger.stateBytes).toBe(new TextEncoder().encode(JSON.stringify(external.initialState)).length);
      expect(owner.context.ledger).toEqual(createSizeLedger(owner.records));
    }
  });
});
