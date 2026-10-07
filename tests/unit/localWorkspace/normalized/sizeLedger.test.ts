import { describe, expect, it } from 'vitest';
import { decomposeProject } from '../../../../services/localWorkspace/normalized/codec';
import { applySizeChanges, createSizeLedger, type NormalizedProjectSlice } from '../../../../services/localWorkspace/normalized/sizeLedger';
import { makeIncrementalProject } from '../../../helpers/incrementalFixtures';
import type { NormalizedProject } from '../../../../services/localWorkspace/normalized/schema';
import { assembleState, partitionState } from '../../../../services/document/partition';
import { applyDocumentChanges } from '../../../../services/document/applyChanges';
import { createLayerFoldState, reconcileLayerFolds, setLayerCollapsed } from '../../../../services/document/layerFolds';
import { createPartitionedHistory, recordPartitionedEdit, redoPartitioned, undoPartitioned } from '../../../../services/document/partitionedHistory';
import * as sizeWork from '../../../../services/localWorkspace/normalized/sizeLedger';
import { makeWorkHarness } from '../../../helpers/normalizationWorkHarness';

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const normalize = (project: ReturnType<typeof makeIncrementalProject>) => decomposeProject(project,
  { storageGeneration: 'g1', projectId: project.id, incarnation: 'i1' });
const slice = (project: NormalizedProject, ...stores: (keyof NormalizedProjectSlice)[]): NormalizedProjectSlice =>
  Object.fromEntries(stores.map(store => [store, project[store]]));

describe('exact external size ledger', () => {
  it('cooperatively counts long metadata keys and applies only selected record deltas', async () => {
    expect(sizeWork.createSizeLedgerWork).toBeTypeOf('function');
    expect(sizeWork.applySizeChangesWork).toBeTypeOf('function');
    const project = makeIncrementalProject(200);
    const longId = '根😀"\\'.repeat(20000);
    const root = project.initialState.nodes.root;
    const templates = project.initialState.variants.default.templates;
    templates[longId] = { ...templates['page-0'], id: longId };
    delete templates['page-0']; root.type = longId;
    project.initialState.selectedTemplateId = longId;
    project.initialState.nodes[longId] = { ...root, id: longId };
    const original = normalize(project);
    const h = makeWorkHarness();
    const ledger = await h.runtime.run(sizeWork.createSizeLedgerWork(original));
    expect(ledger.stateBytes).toBe(bytes(project.initialState));
    expect(ledger.projectBytes).toBe(bytes(project));
    expect(ledger).toEqual(createSizeLedger(original));
    project.initialState.nodes[longId].title = 'changed';
    const next = normalize(project);
    const before = slice(original, 'projectNodes'); const after = slice(next, 'projectNodes');
    const updated = await h.runtime.run(sizeWork.applySizeChangesWork(ledger, before, after));
    expect(updated).toEqual(createSizeLedger(next));
    expect(await h.runtime.run(sizeWork.applySizeChangesWork(updated, after, before))).toEqual(ledger);
    expect(h.runtime.snapshot().yields).toBeGreaterThan(0);
    const cancelled = makeWorkHarness(); cancelled.observe(() => cancelled.cancel());
    await expect(cancelled.runtime.run(sizeWork.createSizeLedgerWork(original))).rejects.toMatchObject({ name: 'AbortError' });
    expect(createSizeLedger(original)).toEqual(ledger);
  });

  it.each(['plain', 'Café ☕', '"\\\n', '\uD800'])('counts UTF-8 and escaping: %s', title => {
    const project = makeIncrementalProject(); project.initialState.nodes.root.title = title;
    const ledger = createSizeLedger(normalize(project));
    expect(ledger.stateBytes).toBe(bytes(project.initialState));
    expect(ledger.projectBytes).toBe(bytes(project));
    expect(ledger.documentBytes + ledger.preferenceBytes).toBe(ledger.stateBytes);
  });

  it('counts extensions, generator source and exceptional fold values without private envelopes', () => {
    const project = makeIncrementalProject(); const state = project.initialState as any;
    Object.assign(project, { extension: { 'é': ['☕', 0] }, cloud: { projectId: 'cloud', lastSyncedCommitId: '', unknown: '保留' } });
    state.extension = { '"': false }; state.variants.default.extra = ['variant'];
    state.generator = { formatVersion: 1, templateScript: 'return "☕";', hierarchyScript: '', generatedAt: '2026-09-14T00:00:00.000Z' };
    state.variants.default.templates['page-0'].layers = [
      { id: 'dup', collapsed: false }, { id: 'dup', collapsed: 'raw' }, { id: 42, collapsed: null },
      { collapsed: { nested: ['☕'] } }, { id: 'absent' }, {},
    ];
    const normalized = normalize(project); const ledger = createSizeLedger(normalized);
    expect(ledger.stateBytes).toBe(bytes(state)); expect(ledger.projectBytes).toBe(bytes(project));
    expect(ledger.preferenceBytes).toBeGreaterThan(0);
    normalized.projectPreferences.values().next().value!.revision = 100;
    normalized.projectHeaders.values().next().value!.lastCommitId = 'private';
    expect(createSizeLedger(normalized)).toEqual(ledger);
  });

  it('adds/removes the last template and extension entry, then reverses repeated edits exactly', () => {
    const project = makeIncrementalProject(1); const original = normalize(project);
    let ledger = createSizeLedger(original); let previous = original;
    for (const title of ['Café ☕', 'x', '', 'again']) {
      project.initialState.nodes.root.title = title;
      const next = normalize(project);
      ledger = applySizeChanges(ledger, slice(previous, 'projectNodes'), slice(next, 'projectNodes'));
      expect(ledger.stateBytes).toBe(bytes(project.initialState));
      expect(ledger).toEqual(createSizeLedger(next)); previous = next;
    }
    const old = normalize(project);
    project.initialState.variants.default.templates = {};
    (project.initialState as any).extra = { only: null };
    const next = normalize(project);
    const stores = ['projectTemplates', 'projectVariants', 'projectExtensions', 'projectHeaders', 'projectPreferences'] as const;
    const removed = applySizeChanges(ledger, slice(old, ...stores), slice(next, ...stores));
    expect(removed).toEqual(createSizeLedger(next));
    expect(applySizeChanges(removed, slice(next, ...stores), slice(old, ...stores))).toEqual(ledger);
  });

  it('preference presence belongs to preferences, independent of stale header order and document deltas', () => {
    const project = makeIncrementalProject(); delete (project.initialState as any).showGrid;
    const base = normalize(project); const initial = createSizeLedger(base);
    let ledger = initial; let oldPrefs = slice(base, 'projectPreferences');
    for (const value of [false, true, undefined, false, undefined, true]) {
      if (value === undefined) delete (project.initialState as any).showGrid;
      else project.initialState.showGrid = value;
      project.initialState.scale = 0;
      const next = normalize(project); const newPrefs = slice(next, 'projectPreferences');
      ledger = applySizeChanges(ledger, oldPrefs, newPrefs);
      expect(ledger.stateBytes).toBe(bytes(project.initialState));
      expect(ledger).toEqual(createSizeLedger(next)); oldPrefs = newPrefs;
    }
    const prefOnly = ledger;
    project.initialState.nodes.root.title += ' document'; const both = normalize(project);
    const documentFirst = applySizeChanges(initial, slice(base, 'projectNodes'), slice(both, 'projectNodes'));
    const documentThenPrefs = applySizeChanges(documentFirst, slice(base, 'projectPreferences'), slice(both, 'projectPreferences'));
    const prefsThenDocument = applySizeChanges(prefOnly, slice(base, 'projectNodes'), slice(both, 'projectNodes'));
    expect(documentThenPrefs).toEqual(prefsThenDocument); expect(prefsThenDocument).toEqual(createSizeLedger(both));
    expect(prefOnly.documentBytes).toBe(initial.documentBytes);
    expect(base.projectHeaders.values().next().value!.order.state).not.toContain('showGrid');
  });

  it('accounts real reorder/delete/undo/redo with intervening occurrence preferences', () => {
    const project = makeIncrementalProject(1);
    (project.initialState.variants.default.templates['page-0'] as any).layers = [
      { id: 'dup', collapsed: false }, { id: 'dup', collapsed: 'raw' }, { id: 42, collapsed: null },
    ];
    let state = createLayerFoldState(partitionState(project.initialState)); let history = createPartitionedHistory();
    let previous = normalize({ ...project, initialState: assembleState(state.parts) }); let ledger = createSizeLedger(previous);
    const check = () => {
      const external = { ...project, initialState: assembleState(state.parts) }; const next = normalize(external);
      const stores = ['projectTemplates', 'projectVariants', 'projectPreferences', 'projectExtensions'] as const;
      ledger = applySizeChanges(ledger, slice(previous, ...stores), slice(next, ...stores));
      expect(ledger.stateBytes).toBe(bytes(external.initialState)); expect(ledger).toEqual(createSizeLedger(next)); previous = next;
    };
    const address = { variantId: 'default', templateId: 'page-0' };
    const old = state.parts.document.variants.default.templates['page-0'];
    const edit = applyDocumentChanges(state.parts.document, [{ type: 'put-template', variantId: 'default',
      template: { ...old, layers: [old.layers![2], old.layers![0]] } }]);
    const reconciled = reconcileLayerFolds(state, edit, { before: edit.before, after: edit.after, mappings: [
      { type: 'continue', from: { ...address, position: 2 }, to: { ...address, position: 0 } },
      { type: 'continue', from: { ...address, position: 0 }, to: { ...address, position: 1 } },
      { type: 'remove', from: { ...address, position: 1 } },
    ] });
    history = recordPartitionedEdit(history, reconciled); state = reconciled.after; check();
    state = setLayerCollapsed(state, { ...address, position: 1 }, true).state; check();
    let crossed = undoPartitioned(history, state); history = crossed.history; state = crossed.state; check();
    state = setLayerCollapsed(state, { ...address, position: 0 }, false).state; check();
    crossed = redoPartitioned(history, state); history = crossed.history; state = crossed.state; check();
    crossed = undoPartitioned(history, state); state = crossed.state; check();
  });
});
