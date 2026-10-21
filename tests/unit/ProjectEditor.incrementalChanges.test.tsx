import React from 'react';
import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectEditor } from '../../components/ProjectEditor';
import { EditorToolbar, type ToolbarActions } from '../../components/EditorToolbar';
import type { AppState } from '../../types';
import { makeIncrementalProject } from '../helpers/incrementalFixtures';
import { createEditOperations } from '../../services/document/editOperations';
import { createLayerFoldState, readLayerFoldCell, reconcileLayerFolds, setLayerCollapsed } from '../../services/document/layerFolds';
import { partitionState } from '../../services/document/partition';
import * as partition from '../../services/document/partition';
import * as editorHook from '../../hooks/useDocumentEditor';
import * as references from '../../services/document/references';
import * as snapshots from '../../services/projectDocumentSnapshot';
import * as canvasTextLayout from '../../services/canvasTextLayout';
import { generatePDF } from '../../services/pdfService';
import { canonicalStringify } from '../../services/localWorkspace/canonical';
import { runGeneratorSandbox } from '../../services/generatorSandbox';
import type { EditorPersistenceDrain, EditorSourceBinding } from '../../services/document/contracts';

vi.mock('../../services/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('../../services/pdfService', async importOriginal => ({ ...await importOriginal<typeof import('../../services/pdfService')>(), generatePDF: vi.fn() }));
vi.mock('../../services/generatorSandbox', () => ({ runGeneratorSandbox: vi.fn() }));

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    font: '12px sans-serif', measureText: (text: string) => ({ width: text.length * 6 }),
  } as CanvasRenderingContext2D);
});
afterEach(() => vi.restoreAllMocks());

// M1 compile-time contract: neither a missing writer nor two writers may mount.
function toolbarWriterContract(state: AppState, setState: React.Dispatch<React.SetStateAction<AppState>>, actions: ToolbarActions) {
  const legacy = <EditorToolbar state={state} setState={setState} />;
  const incremental = <EditorToolbar state={state} actions={actions} />;
  // @ts-expect-error A toolbar requires a writer.
  const missing = <EditorToolbar state={state} />;
  // @ts-expect-error Writer ownership is exclusive.
  const competing = <EditorToolbar state={state} setState={setState} actions={actions} />;
  return { legacy, incremental, missing, competing };
}

// Task 10 actual-source route checklist. A group is complete only after every
// listed route has behavioral coverage. No synthetic editor reducer is used.
// Contract section 7 route-to-test map (G labels in test names; acceptance is external):
// G1 mount/readback/activation/source: silent StrictMode, committed callbacks, keyed
// remount, synchronous/reentrant delivery, failure/no replay, no legacy writer.
// G2 node/template/view/variant selection: plain/ctrl/shift/empty fallback and redo;
// Canvas/Layers click/marquee/alt-cycle/clear: actual aria-selected, zero D/P.
// G2 wheel/toolbar zoom + both gutters: exact bounds and scalar preference lanes;
// all eight tools/buttons/shortcuts, preview, greyscale, snap/grid: declared S/P only.
// G2 JSON/reference/delete/generator/variant/preset dialog cancel lanes; named layers,
// template-settings and all six element section expansion preferences.
// G2 clipboard/cut/paste/duplicate/nudge: exact selection, nested sharing, raw-layer
// fallback, offsets/zIndex, Shift/snap; G4 all eight align/distribute commands.
// G2 node title/data/type/add/reference/bulk assignment: root linkage, field-level
// reentrancy, current target, calendar template heuristic, immutable parent changes.
// G2 duplicate/delete: multiselected subtrees, root guards, indexed descendant and
// reference cascade/repairs across variants; G6 live index equality through lifecycle.
// G3 template add/name/copy/delete/dimensions: complete provenance, last guard,
// presets/portrait/landscape/manual, reflow/font scaling/no-reflow, opaque sharing.
// G3 variant create/name/delete/copy: dimensions, all reflow modes, metadata-only
// rename, expanded deletes, last guard (control absent), source extension ownership.
// G4 elements/properties: all six drag shapes + click-text, explicit properties delete,
// single/multi geometry/zIndex, appearance/pattern/borders, text/auto-width/padding,
// typography/overflow/link, grid subset/display/source/traversal, NodeSelector grid/link.
// Nested grid/borders/padding merge live selected fields; sequence and user/atomic
// selection adversaries fence old callbacks without losing valid multi-grid edits.
// G4 SVG import/placeholder: fit, large confirm/decline, source/address/selection/bulk
// fences. G5 SVG focus: contiguous/intervening history and disposed pending timers.
// G4 layers: fold/name/color/visible/locked/add/reorder/delete/retag/drop/filter/active;
// numeric/duplicate IDs, null/string/array raw cells, own-undefined/absence/object/null/
// string/boolean folds, latest choice, reentrant no-op, sequence UI invalidation.
// Fold supplement 1-4: actual reorder/copy/delete/restore/toggle/redo/undo plus
// independent latest-authoritative receipt replay. 5: reused-ID semantic/history test
// in document/editOperations.test.ts (no ID-editing UI invented). 6: raw-cell exports.
// G5 / supplement 7-8: move/resize/rotate/pivot/line/grid/Ctrl-copy/inline lifecycle,
// optional pivot net-zero, ghost cancel, group pivot/no-op redo, long checkpoints with
// folds/preferences, latest in-flight property, same-ID bulk/undo, current-viewMode.
// Bulk JSON/generator/consecutive replacements + structural/fold dependency chain,
// pinned generator timestamp; PDF single/all/failure and preset success/false/reject
// export independent raw payloads with extensions/generator/own-presence.
// G6 integrated 50-entry bound, drained effects, inactive-artwork trap, no ordinary
// clone/snapshot/assembly/index rebuild; one cache updates exactly emitted receipts.
// Legacy optional activeLayerId/generator own-presence: retained snapshot tests.
// Node move/reparent/reorder: N/A (controller D4); no existing callback exists.

function renderIncrementalEditor(project = makeIncrementalProject(2), strict = false,
  lifecycle: Pick<EditorSourceBinding, 'assertEditable' | 'capturePersistenceCut' | 'registerPersistenceDrain'> = {}) {
  const onDocumentEdit = vi.fn();
  const onPreferencesChange = vi.fn();
  const onStateChange = vi.fn();
  const onNameChange = vi.fn();
  const incremental = { source: {}, editorGenerationFloor: 10, foldStructureGeneration: 4, ...lifecycle };
  const props = { projectId: project.id, projectName: project.name, initialState: project.initialState,
    isActive: true, incremental, onDocumentEdit, onPreferencesChange, onStateChange, onNameChange,
    onCreateGeneratedProject: vi.fn(async () => true), onSaveCustomPreset: vi.fn(async () => true) };
  const view = render(strict ? <React.StrictMode><ProjectEditor {...props} /></React.StrictMode> : <ProjectEditor {...props} />);
  const selectTemplate = (id: string) => {
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }));
    const row = [...view.container.querySelectorAll('[data-template-id]')].find(item => item.getAttribute('data-template-id') === id);
    expect(row).toBeDefined(); fireEvent.click(row!);
  };
  const setZoom = (scale: number) => {
    const current = Number(screen.getByText(/^\d+%$/).textContent!.replace('%', '')) / 100;
    fireEvent.wheel(view.container.querySelector('.canvas-scroll-container')!, {
      ctrlKey: true, deltaY: (1 - scale / current) / 0.002,
    });
  };
  const resizeSidebar = (width: number) => {
    fireEvent.pointerDown(view.container.querySelector('[data-sidebar-resize-handle]')!);
    dragTo(width); fireEvent(document, new MouseEvent('pointerup'));
  };
  return { ...view, props, incremental, onDocumentEdit, onPreferencesChange, onStateChange, onNameChange,
    selectTemplate, setZoom, resizeSidebar };
}

// jsdom has no PointerEvent: a MouseEvent of the pointer type carries clientX to the resize listener.
function dragTo(clientX: number) {
  fireEvent(document, new MouseEvent('pointermove', { clientX, cancelable: true }));
}
function labeledInput(label: string) {
  return screen.getByText(label, { selector: 'label' }).parentElement!.querySelector('input')!;
}
function openRawJson(container: HTMLElement) {
  fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
  fireEvent.click(screen.getByRole('button', { name: 'Text' }));
  const input = screen.getByText('Project JSON Editor').closest('.max-w-5xl')!.querySelector('textarea')!;
  return { input, raw: JSON.parse(input.value) };
}
function replaceJson(container: HTMLElement, change: (raw: any) => void) {
  const { input, raw } = openRawJson(container); change(raw);
  fireEvent.change(input, { target: { value: JSON.stringify(raw) } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply Changes' }));
}

describe('text-layout ownership', () => {
  it('keeps text metrics across gesture-fenced navigation while retaining font invalidation and cleanup', async () => {
    const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
    const fonts = new EventTarget(), ready = vi.fn(() => Promise.resolve());
    Object.defineProperty(fonts, 'ready', { get: ready });
    const remove = vi.spyOn(fonts, 'removeEventListener');
    Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
    const originalFactory = canvasTextLayout.createCanvasTextLayoutSession, sessions: canvasTextLayout.CanvasTextLayoutSession[] = [];
    const factory = vi.spyOn(canvasTextLayout, 'createCanvasTextLayoutSession').mockImplementation(options => {
      const session = originalFactory(options); vi.spyOn(session, 'clear'); sessions.push(session); return session;
    });
    try {
      const h = renderIncrementalEditor(); await act(async () => {});
      expect(factory).toHaveBeenCalledTimes(1); expect(ready).toHaveBeenCalledTimes(1);
      const session = sessions[0], cleared = vi.mocked(session.clear).mock.calls.length;
      const canvas = h.container.querySelector('.canvas-scroll-container')!;
      fireEvent.click(screen.getByRole('button', { name: 'Templates' }));
      expect(canvas.isConnected).toBe(false);
      fireEvent.click(screen.getByRole('button', { name: 'Hierarchy' }));
      await act(async () => {});
      expect(factory).toHaveBeenCalledTimes(1); expect(ready).toHaveBeenCalledTimes(1);
      expect(session.clear).toHaveBeenCalledTimes(cleared);
      act(() => fonts.dispatchEvent(new Event('loadingdone')));
      expect(session.clear).toHaveBeenCalledTimes(cleared + 1);
      expect(h.onDocumentEdit).not.toHaveBeenCalled();
      h.unmount(); expect(session.clear).toHaveBeenCalledTimes(cleared + 2);
      expect(remove).toHaveBeenCalledWith('loadingdone', expect.any(Function));
    } finally {
      if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts);
      else Reflect.deleteProperty(document, 'fonts');
    }
  });
});

describe('workspace editor retirement and drain', () => {
  it('reports synchronous mutation and delivery activity so lifecycle cuts can defer without swallowing failed handoffs', () => {
    const h = renderHook(() => editorHook.useDocumentEditor(makeIncrementalProject(2).initialState));
    expect(typeof h.result.current.isBusy).toBe('function'); expect(h.result.current.isBusy()).toBe(false);
    act(() => h.result.current.edit(context => {
      expect(h.result.current.isBusy()).toBe(true);
      return { changes: [{ type: 'put-node', node: { ...context.document.nodes.root, title: 'Busy' } }], mappings: [] };
    }));
    expect(h.result.current.isBusy()).toBe(false);
    act(() => h.result.current.drainEffects(() => { expect(h.result.current.isBusy()).toBe(true); }));
    expect(h.result.current.isBusy()).toBe(false);
  });
  it.each(['edit', 'preferences', 'session', 'fold', 'begin', 'finish', 'cancel', 'undo', 'redo', 'replace'])
  ('rejects retired %s before any state or history change', action => {
    const state = makeIncrementalProject(2).initialState; let retired = false;
    const binding = { source: {}, editorGenerationFloor: 0, foldStructureGeneration: 0,
      assertEditable() { if (retired) throw Error('Retired project'); } };
    const h = renderHook(() => editorHook.useDocumentEditor(state, binding));
    act(() => { h.result.current.edit(context => ({ changes: [{ type: 'put-node', node: { ...context.document.nodes.root, title: 'Pending' } }], mappings: [] })); });
    const before = h.result.current.getCurrent(); retired = true; const prepare = vi.fn(() => ({ changes: [], mappings: [] }));
    const actions: Record<string, () => unknown> = {
      edit: () => h.result.current.edit(prepare), preferences: () => h.result.current.updatePreferences({ scale: 2 }),
      session: () => h.result.current.updateSession({ tool: 'text' }),
      fold: () => h.result.current.setLayerCollapsed({ variantId: 'default', templateId: 'page-0', position: 0 }, true),
      begin: () => h.result.current.beginGroup(), finish: () => h.result.current.finishGroup('group'), cancel: () => h.result.current.cancelGroup('group'),
      undo: () => h.result.current.undo(), redo: () => h.result.current.redo(), replace: () => h.result.current.replace(state),
    };
    expect(() => act(actions[action])).toThrow('Retired project');
    expect(h.result.current.getCurrent()).toBe(before); expect(prepare).not.toHaveBeenCalled();
    expect(h.result.current.exportState().nodes.root.title).toBe('Pending');
    const deliver = vi.fn(); act(() => h.result.current.drainEffects(deliver, before.editorGeneration));
    expect(deliver).toHaveBeenCalledTimes(1); expect(h.result.current.document).toBe(before.document);
    expect(h.result.current.historyStatus.canUndo).toBe(true);
  });

  it('rechecks retirement after caller preparation before mutating references or history', () => {
    const state = makeIncrementalProject(2).initialState; let retired = false;
    const h = renderHook(() => editorHook.useDocumentEditor(state, { source: state, editorGenerationFloor: 0, foldStructureGeneration: 0,
      assertEditable: guard }));
    function guard() { if (retired) throw Error('Retired during preparation'); }
    const before = h.result.current.getCurrent(), update = vi.spyOn(references, 'updateReferenceIndex');
    expect(() => act(() => h.result.current.edit(context => {
      retired = true; return { changes: [{ type: 'put-node', node: { ...context.document.nodes.root, title: 'Must not appear' } }], mappings: [] };
    }))).toThrow('Retired during preparation');
    expect(update).not.toHaveBeenCalled(); expect(h.result.current.getCurrent()).toBe(before);
    expect(h.result.current.effects).toEqual([]); expect(h.result.current.historyStatus.canUndo).toBe(false);
  });

  it('drains only the captured editor generations and leaves reentrant newer effects pending', () => {
    const h = renderHook(() => editorHook.useDocumentEditor(makeIncrementalProject(2).initialState));
    act(() => { h.result.current.updatePreferences({ scale: 2 }); });
    const delivered: number[] = [];
    act(() => h.result.current.drainEffects(effect => {
      delivered.push(effect.event.editorGeneration);
      if (delivered.length === 1) h.result.current.updatePreferences({ scale: 3 });
    }, 1));
    expect(delivered).toEqual([1]); expect(h.result.current.effects.map(effect => effect.event.editorGeneration)).toEqual([2]);
    act(() => h.result.current.drainEffects(effect => delivered.push(effect.event.editorGeneration)));
    expect(delivered).toEqual([1, 2]);
  });

  it.each(['assertEditable', 'capturePersistenceCut', 'registerPersistenceDrain'] as const)('pins the %s identity even when the caller mutates its binding in place', key => {
    const binding: EditorSourceBinding = { source: {}, editorGenerationFloor: 0, foldStructureGeneration: 0,
      assertEditable() {}, capturePersistenceCut: async () => true, registerPersistenceDrain: () => () => {} };
    const h = renderHook(() => editorHook.useDocumentEditor(makeIncrementalProject(2).initialState, binding));
    Reflect.set(binding, key, () => {}); expect(() => h.rerender()).toThrow(/binding|remount/i);
  });

  it('requires a persistence-cut callback whenever lifecycle drain registration is supplied', () => {
    expect(() => renderHook(() => editorHook.useDocumentEditor(makeIncrementalProject(2).initialState,
      { source: {}, editorGenerationFloor: 0, foldStructureGeneration: 0, registerPersistenceDrain: () => () => {} }))).toThrow(/binding/i);
  });

  it('registers a source-stable drain that uses committed callbacks and persistence completion', async () => {
    let handle: EditorPersistenceDrain | undefined, owner!: editorHook.DocumentEditor;
    const unregister = vi.fn(), capture = vi.fn(async () => false);
    const register = vi.fn((next: EditorPersistenceDrain) => { handle = next; return unregister; });
    const original = editorHook.useDocumentEditor;
    vi.spyOn(editorHook, 'useDocumentEditor').mockImplementation((...args) => { owner = original(...args); return owner; });
    const h = renderIncrementalEditor(makeIncrementalProject(2), false, { capturePersistenceCut: capture, registerPersistenceDrain: register });
    expect(register).toHaveBeenCalledTimes(1); expect(handle!.generation()).toBe(10);
    const stable = handle, nextCallback = vi.fn();
    h.rerender(<ProjectEditor {...h.props} onPreferencesChange={nextCallback} />);
    expect(handle).toBe(stable); expect(register).toHaveBeenCalledTimes(1); expect(unregister).not.toHaveBeenCalled();
    act(() => { owner.updatePreferences({ scale: 2 }); owner.updatePreferences({ scale: 3 }); });
    let result!: boolean; await act(async () => { result = await handle!.drainThrough(11); });
    expect(result).toBe(false); expect(capture).toHaveBeenCalledExactlyOnceWith(11);
    expect(nextCallback).toHaveBeenCalledTimes(1); expect(h.onPreferencesChange).not.toHaveBeenCalled();
    expect(owner.effects.map(effect => effect.event.editorGeneration)).toEqual([12]);
    h.unmount(); expect(unregister).toHaveBeenCalledTimes(1);
    expect(await stable!.drainThrough(12)).toBe(false); expect(nextCallback).toHaveBeenCalledTimes(1);
  });
});

describe('real ProjectEditor incremental boundary', () => {
  function renameRoot(container: HTMLElement, title: string) {
    const root = container.querySelector('[data-node-id="root"]')!;
    fireEvent.click(root.querySelector('[title="Edit Title"]')!);
    fireEvent.change(root.querySelector('input')!, { target: { value: title } });
    fireEvent.keyDown(root.querySelector('input')!, { key: 'Enter' });
  }

  it('M2 hidden active hidden rerenders preserve history and gate keyboard mutations', () => {
    const h = renderIncrementalEditor(); fireEvent.click(screen.getByTitle('Layers'));
    fireEvent.click(screen.getByTestId('element-row-title'));
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(h.onDocumentEdit).toHaveBeenCalledOnce();
    const edited = h.onDocumentEdit.mock.calls[0][0];
    const preferences = h.onPreferencesChange.mock.calls.length;
    const activate = (isActive: boolean) => h.rerender(<ProjectEditor {...h.props} isActive={isActive} initialState={structuredClone(h.props.initialState)} />);
    const hiddenKeys = () => {
      fireEvent.keyDown(window, { key: 'ArrowRight' }); fireEvent.keyDown(window, { key: 'Delete' });
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true }); fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
      fireEvent.keyDown(window, { key: 'd', ctrlKey: true }); fireEvent.keyDown(window, { key: 'r' });
    };
    activate(false); hiddenKeys();
    expect(h.onDocumentEdit).toHaveBeenCalledOnce(); expect(screen.getByTitle('Undo (Ctrl+Z)')).not.toBeDisabled();
    expect(screen.getByTitle('Select Tool (V)').className).toContain('bg-blue-600');
    activate(true);
    expect(h.onDocumentEdit).toHaveBeenCalledOnce(); expect(h.onPreferencesChange).toHaveBeenCalledTimes(preferences);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(h.onDocumentEdit.mock.calls[1][0].edit.after).toBe(edited.edit.before);
    expect(screen.getByTitle('Redo (Ctrl+Y)')).not.toBeDisabled();
    activate(false); hiddenKeys();
    expect(h.onDocumentEdit).toHaveBeenCalledTimes(2); expect(screen.getByTitle('Redo (Ctrl+Y)')).not.toBeDisabled();
    activate(true);
    expect(h.onDocumentEdit).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
    expect(h.onDocumentEdit.mock.calls[2][0].edit.after).toBe(edited.edit.after);
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(h.onDocumentEdit.mock.calls[3][0].edit.after.variants.default.templates['page-0'].elements).toEqual([]);
    expect(h.onPreferencesChange).toHaveBeenCalledTimes(preferences);
    expect(h.onStateChange).not.toHaveBeenCalled(); expect(h.onNameChange).not.toHaveBeenCalled();
  });

  it('uses committed replacement callbacks without replay or same-source history reset', () => {
    const h = renderIncrementalEditor();
    renameRoot(h.container, 'First');
    const next = vi.fn();
    h.rerender(<ProjectEditor {...h.props} initialState={structuredClone(h.props.initialState)} onDocumentEdit={next} />);
    expect(next).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0][0]).toMatchObject({ origin: 'undo', editorGeneration: 12,
      linkedProjectName: { name: h.props.initialState.nodes.root.title } });
    expect(h.onDocumentEdit).toHaveBeenCalledOnce();
    expect(h.onStateChange).not.toHaveBeenCalled();
  });

  it('drains reentrant real controls synchronously in generation order', () => {
    const h = renderIncrementalEditor();
    const seen: number[] = [];
    h.onDocumentEdit.mockImplementation(event => {
      seen.push(event.editorGeneration);
      fireEvent.wheel(h.container.querySelector('.canvas-scroll-container')!, { ctrlKey: true, deltaY: -100 });
      expect(h.onPreferencesChange).not.toHaveBeenCalled();
    });
    h.onPreferencesChange.mockImplementation((_patch, metadata) => seen.push(metadata.editorGeneration));
    renameRoot(h.container, 'Reentrant');
    expect(seen).toEqual([11, 12]);
    expect(h.onStateChange).not.toHaveBeenCalled();
  });

  it('keyed remount starts independent history and never transfers old callbacks', () => {
    const h = renderIncrementalEditor();
    renameRoot(h.container, 'Old owner');
    const next = vi.fn();
    const binding = { source: {}, editorGenerationFloor: 70, foldStructureGeneration: 9 };
    h.rerender(<ProjectEditor key="replacement" {...h.props} incremental={binding} onDocumentEdit={next} />);
    expect(screen.getByTitle('Undo (Ctrl+Z)')).toBeDisabled();
    expect(next).not.toHaveBeenCalled();
    renameRoot(h.container, 'New owner');
    expect(next.mock.calls[0][0]).toMatchObject({ source: binding.source, editorGeneration: 71 });
    expect(h.onDocumentEdit).toHaveBeenCalledOnce();
  });

  it('retains unsaved working state after a callback throws and never replays that attempt', () => {
    const h = renderIncrementalEditor();
    const failure = new Error('Admission failed');
    const errors: unknown[] = [];
    const catchError = (event: ErrorEvent) => { errors.push(event.error); event.preventDefault(); };
    window.addEventListener('error', catchError);
    try {
      h.onDocumentEdit.mockImplementationOnce(() => { throw failure; });
      renameRoot(h.container, 'Unsaved root');
      expect(errors).toEqual([failure]);
      expect(h.onDocumentEdit).toHaveBeenCalledOnce();
      const next = vi.fn();
      h.rerender(<ProjectEditor {...h.props} onDocumentEdit={next} />);
      expect(next).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
      expect(next).toHaveBeenCalledOnce();
      expect(next.mock.calls[0][0].edit.before.nodes.root.title).toBe('Unsaved root');
      expect(next.mock.calls[0][0].editorGeneration).toBe(12);
    } finally { window.removeEventListener('error', catchError); }
  });

  it('prepares two synchronous real node edits against current records without ordinary clones or index rebuilds', () => {
    const h = renderIncrementalEditor();
    const clone = vi.spyOn(globalThis, 'structuredClone');
    const snapshot = vi.spyOn(snapshots, 'snapshotDocument');
    const restore = vi.spyOn(snapshots, 'restoreDocument');
    const build = vi.spyOn(references, 'buildReferenceIndex');
    const update = vi.spyOn(references, 'updateReferenceIndex');
    const add = h.container.querySelector('[data-node-id="root"] [title="Add New Page"]')!;
    act(() => { fireEvent.click(add); fireEvent.click(add); });
    expect(h.onDocumentEdit).toHaveBeenCalledTimes(2);
    const [first, second] = h.onDocumentEdit.mock.calls.map(([event]) => event);
    expect(first.edit.after).toBe(second.edit.before);
    expect(second.edit.after.nodes.root.children).toHaveLength(2);
    expect(first.edit.after.nodes.root.children).toHaveLength(1);
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    fireEvent.click(screen.getByTitle('Redo (Ctrl+Y)'));
    expect(build).not.toHaveBeenCalled(); expect(update).toHaveBeenCalledTimes(4);
    expect(clone).not.toHaveBeenCalled(); expect(snapshot).not.toHaveBeenCalled(); expect(restore).not.toHaveBeenCalled();
  });

  it.each(['placeholder', 'file'] as const)('I2 %s SVG uses string-ID placement while retaining raw layer sequence', route => {
    const project = makeIncrementalProject(); const template = project.initialState.variants.default.templates['page-0'];
    const rawArray = [1, { untouched: true }];
    template.layers = [null, rawArray, 'raw', { id: 42, order: 99, name: 'Numeric' },
      { id: 'A', order: 0, name: 'A', visible: true, locked: false },
      { id: 'B', order: 1, name: 'B', visible: true, locked: false }] as any;
    project.initialState.activeLayerId = route === 'placeholder' ? 'A' : 'missing';
    template.elements = [{ ...template.elements[0], layerId: 'A', zIndex: 7 },
      { ...template.elements[0], id: 'other', layerId: 'B', zIndex: 11 }];
    let finish: ((event: { target: { result: string } }) => void) | undefined;
    vi.stubGlobal('FileReader', class { onload?: typeof finish; readAsText() { finish = this.onload; } });
    const errors: unknown[] = [];
    const catchError = (event: ErrorEvent) => { errors.push(event.error); event.preventDefault(); };
    window.addEventListener('error', catchError);
    try {
      const h = renderIncrementalEditor(project);
      if (route === 'placeholder') {
        fireEvent.click(screen.getByTitle('Layers')); fireEvent.click(within(screen.getByTestId('layer-row-A')).getByTestId('layer-name'));
        fireEvent.click(screen.getByTitle('SVG Tools'));
        fireEvent.click(screen.getByRole('button', { name: 'Insert placeholder SVG' }));
      } else {
        fireEvent.change(h.container.querySelector('input[type="file"][accept=".svg"]')!, { target: { files: [new File(['<svg/>'], 'art.svg')] } });
        act(() => finish?.({ target: { result: '<svg viewBox="0 0 100 100"/>' } }));
      }
      expect(errors).toEqual([]); expect(h.onDocumentEdit).toHaveBeenCalledOnce();
      const event = h.onDocumentEdit.mock.calls[0][0]; const before = event.edit.before.variants.default.templates['page-0'];
      const after = event.edit.after.variants.default.templates['page-0'];
      expect(after.layers).toBe(before.layers); expect(after.layers).toEqual(template.layers); expect(after.layers[1]).toBe(rawArray);
      expect(after.elements.at(-1)).toMatchObject({ type: 'svg', layerId: route === 'placeholder' ? 'A' : 'B', zIndex: route === 'placeholder' ? 8 : 12 });
      expect(after.elements.slice(0, 2)).toEqual(before.elements); expect(after.elements[0]).toBe(before.elements[0]);
      expect(event.selection.after.selectedElementIds).toEqual([after.elements.at(-1).id]);
      expect(event.edit.affected).toEqual([{ kind: 'template', variantId: 'default', templateId: 'page-0' }]);
      fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)')); expect(h.onDocumentEdit.mock.calls[1][0].edit.after).toBe(event.edit.before);
      expect(screen.getByTitle('Undo (Ctrl+Z)')).toBeDisabled();
      fireEvent.click(screen.getByTitle('Redo (Ctrl+Y)')); expect(h.onDocumentEdit.mock.calls[2][0].edit.after).toBe(event.edit.after);
    } finally { window.removeEventListener('error', catchError); vi.unstubAllGlobals(); }
  });

  it('drops real SVG file completion after target navigation and source remount', () => {
    const readers: { onload?: (event: { target: { result: string } }) => void }[] = [];
    vi.stubGlobal('FileReader', class {
      onload?: (event: { target: { result: string } }) => void;
      constructor() { readers.push(this); }
      readAsText() {}
    });
    try {
      const h = renderIncrementalEditor();
      const startImport = () => fireEvent.change(h.container.querySelector('input[type="file"][accept=".svg"]')!, {
        target: { files: [new File(['<svg/>'], 'art.svg', { type: 'image/svg+xml' })] },
      });
      startImport(); h.selectTemplate('page-1'); h.selectTemplate('page-0');
      act(() => readers[0].onload?.({ target: { result: '<svg viewBox="0 0 100 100"/>' } }));
      expect(h.onDocumentEdit).not.toHaveBeenCalled();
      startImport();
      const next = vi.fn();
      h.rerender(<ProjectEditor key="new-source" {...h.props} incremental={{ ...h.incremental, source: {} }} onDocumentEdit={next} />);
      act(() => readers[1].onload?.({ target: { result: '<svg viewBox="0 0 100 100"/>' } }));
      expect(next).not.toHaveBeenCalled(); expect(h.onDocumentEdit).not.toHaveBeenCalled();
      startImport();
      act(() => readers[2].onload?.({ target: { result: '<svg viewBox="0 0 1000 1000"/>' } }));
      expect(next).toHaveBeenCalledOnce();
      expect(next.mock.calls[0][0].edit.after.variants.default.templates['page-0'].elements.at(-1)).toMatchObject({ type: 'svg', w: 400, h: 400 });
    } finally { vi.unstubAllGlobals(); }
  });

  it.each(['selection', 'replacement', 'decline', 'accept'] as const)('G4 delayed large SVG import %s honors captured ownership and confirmation', outcome => {
    let finish: ((event: { target: { result: string } }) => void) | undefined;
    vi.stubGlobal('FileReader', class {
      onload?: typeof finish;
      readAsText() { finish = this.onload; }
    });
    try {
      const h = renderIncrementalEditor(); fireEvent.click(screen.getByTitle('Layers'));
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(outcome === 'accept');
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 500"><!--${'x'.repeat(100001)}--></svg>`;
      fireEvent.change(h.container.querySelector('input[type="file"][accept=".svg"]')!, { target: { files: [new File([svg], 'large.svg')] } });
      if (outcome === 'selection') fireEvent.click(screen.getByTestId('element-row-title'));
      if (outcome === 'replacement') replaceJson(h.container, raw => { raw.nodes.root.title = 'New same-ID content'; });
      act(() => finish?.({ target: { result: svg } }));
      expect(confirm).toHaveBeenCalledTimes(outcome === 'decline' || outcome === 'accept' ? 1 : 0);
      expect(h.onDocumentEdit).toHaveBeenCalledTimes(outcome === 'replacement' || outcome === 'accept' ? 1 : 0);
      if (outcome === 'accept') {
        const event = h.onDocumentEdit.mock.calls[0][0];
        const element = event.edit.after.variants.default.templates['page-0'].elements.at(-1);
        expect(element).toMatchObject({ type: 'svg', svgContent: svg, w: 400, h: 200 });
        expect(event.selection.after.selectedElementIds).toEqual([element.id]);
      }
    } finally { vi.unstubAllGlobals(); }
  });

  it('navigates without emitting document changes', () => {
    const h = renderIncrementalEditor();
    h.selectTemplate('page-1'); h.setZoom(1.5); h.resizeSidebar(340);
    expect(screen.getByText('150%')).toBeInTheDocument();
    expect(h.onDocumentEdit).not.toHaveBeenCalled();
    expect(h.onPreferencesChange).toHaveBeenCalledWith({ scale: 1.5 }, expect.objectContaining({ source: h.incremental.source }));
    expect(h.onPreferencesChange).toHaveBeenCalledWith({ sidebarWidth: 340 }, expect.any(Object));
    expect(h.onStateChange).not.toHaveBeenCalled();
    expect(h.onNameChange).not.toHaveBeenCalled();
  });

  it('G2 routes tools, grid and panels to session/preferences without clearing redo', () => {
    const h = renderIncrementalEditor();
    renameRoot(h.container, 'Edit');
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    h.onDocumentEdit.mockClear();
    fireEvent.click(screen.getByTitle('Pan Tool (H)'));
    fireEvent.keyDown(window, { key: 'r' });
    expect(h.onPreferencesChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTitle('Snap to Grid'));
    expect(h.onPreferencesChange).toHaveBeenCalledWith(expect.objectContaining({ snapToGrid: true, showGrid: true }), expect.any(Object));
    fireEvent.click(screen.getByTitle('Layers'));
    expect(h.onPreferencesChange).toHaveBeenCalledWith({ panelsExpanded: { layers: true } }, expect.any(Object));
    expect(h.onDocumentEdit).not.toHaveBeenCalled();
    expect(screen.getByTitle('Redo (Ctrl+Y)')).not.toBeDisabled();
    expect(h.onStateChange).not.toHaveBeenCalled();
  });

  it.each(['Select Tool (V)', 'Pan Tool (H)', 'Text Box (T)', 'Rectangle (R)', 'Circle/Ellipse (E)', 'Triangle (Y)', 'Line (L)', 'Data Grid (G)'])('G2 %s button and shortcut remain session-only', title => {
    const h = renderIncrementalEditor();
    fireEvent.click(screen.getByTitle(title));
    expect(screen.getByTitle(title).className).toContain('bg-blue-600');
    fireEvent.keyDown(window, { key: 'h' });
    fireEvent.keyDown(window, { key: title.at(-2)!.toLowerCase() });
    expect(screen.getByTitle(title).className).toContain('bg-blue-600');
    expect(h.onDocumentEdit).not.toHaveBeenCalled(); expect(h.onPreferencesChange).not.toHaveBeenCalled();
  });

  it('G2 clamps both real gutters and keeps grid-only preference separate', () => {
    const h = renderIncrementalEditor();
    h.resizeSidebar(100); h.resizeSidebar(900);
    expect(h.onPreferencesChange).toHaveBeenCalledWith({ sidebarWidth: 200 }, expect.any(Object));
    expect(h.onPreferencesChange).toHaveBeenCalledWith({ sidebarWidth: 600 }, expect.any(Object));
    const gutter = h.container.querySelector('[data-properties-resize-handle]')!;
    fireEvent.pointerDown(gutter);
    dragTo(window.innerWidth - 100);
    dragTo(window.innerWidth - 900); fireEvent(document, new MouseEvent('pointerup'));
    expect(h.onPreferencesChange).toHaveBeenCalledWith({ propertiesPanelWidth: 250 }, expect.any(Object));
    expect(h.onPreferencesChange).toHaveBeenCalledWith({ propertiesPanelWidth: 600 }, expect.any(Object));
    fireEvent.click(screen.getByTitle('Show Grid'));
    expect(h.onPreferencesChange.mock.calls.at(-1)![0]).toEqual({ showGrid: true });
    expect(h.onDocumentEdit).not.toHaveBeenCalled(); expect(screen.getByTitle('Undo (Ctrl+Z)')).toBeDisabled();
  });

  it.each(['node', 'template'] as const)('G2 %s shift ranges and ctrl-empty fallback preserve redo without content writes', kind => {
    const project = makeIncrementalProject(3);
    for (let i = 0; i < 3; i++) project.initialState.nodes[`child-${i}`] = {
      ...project.initialState.nodes.root, id: `child-${i}`, parentId: 'root', title: `Child ${i}`, children: [],
    };
    project.initialState.nodes.root.children = ['child-0', 'child-1', 'child-2'];
    const h = renderIncrementalEditor(project); renameRoot(h.container, 'Checkpoint'); fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    if (kind === 'template') fireEvent.click(screen.getByRole('button', { name: 'Templates' }));
    h.onDocumentEdit.mockClear(); h.onPreferencesChange.mockClear();
    const ids = kind === 'node' ? ['child-0', 'child-1', 'child-2'] : ['page-0', 'page-1', 'page-2'];
    const row = (id: string) => h.container.querySelector(`[data-${kind}-id="${id}"]`)!;
    fireEvent.click(row(ids[0])); fireEvent.click(row(ids[2]), { shiftKey: true });
    ids.forEach(id => expect(row(id).className).toContain('bg-blue-'));
    fireEvent.click(row(ids[0])); fireEvent.click(row(ids[0]), { ctrlKey: true });
    if (kind === 'node') {
      expect(row('root').className).toContain('bg-blue-');
      expect(h.onPreferencesChange.mock.calls.at(-1)![0]).toEqual({ selectedNodeId: 'root' });
    } else expect(row(ids[0]).className).not.toContain('bg-blue-');
    expect(h.onDocumentEdit).not.toHaveBeenCalled(); expect(screen.getByTitle('Redo (Ctrl+Y)')).not.toBeDisabled();
  });

  it('G2 variant navigation preview greyscale and bounded toolbar zoom use only their declared lanes', () => {
    const project = makeIncrementalProject(2);
    project.initialState.variants.other = { ...project.initialState.variants.default, id: 'other', name: 'Other' };
    project.initialState.nodes.preview = { ...project.initialState.nodes.root, id: 'preview', title: 'Preview alternate', children: [] };
    const h = renderIncrementalEditor(project); renameRoot(h.container, 'Checkpoint'); fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    fireEvent.click(screen.getByRole('button', { name: 'Templates' })); h.onDocumentEdit.mockClear(); h.onPreferencesChange.mockClear();
    fireEvent.change(h.container.querySelector('select[title="Default"]')!, { target: { value: 'other' } });
    expect(h.onPreferencesChange.mock.calls.at(-1)![0]).toMatchObject({ activeVariantId: 'other' });
    h.onPreferencesChange.mockClear();
    fireEvent.change(screen.getByText('Preview:').parentElement!.querySelector('select')!, { target: { value: 'preview' } });
    expect(screen.getByText('Preview:').parentElement!.querySelector('select')).toHaveValue('preview');
    fireEvent.click(screen.getByTitle('Greyscale Export: OFF')); expect(screen.getByTitle('Greyscale Export: ON')).toBeInTheDocument();
    expect(h.onPreferencesChange).not.toHaveBeenCalled();
    h.setZoom(.2); fireEvent.click(h.container.querySelector('.lucide-zoom-out')!.closest('button')!);
    expect(screen.getByText('20%')).toBeInTheDocument();
    h.setZoom(10); fireEvent.click(h.container.querySelector('.lucide-zoom-in')!.closest('button')!);
    expect(screen.getByText('1000%')).toBeInTheDocument();
    expect(h.onPreferencesChange.mock.calls.map(([patch]) => Object.keys(patch))).toEqual([['scale'], ['scale']]);
    expect(h.onDocumentEdit).not.toHaveBeenCalled(); expect(screen.getByTitle('Redo (Ctrl+Y)')).not.toBeDisabled();
  });

  it('G2 named panel expansions persist only their preference keys and leave redo intact', () => {
    const project = makeIncrementalProject(); const template = project.initialState.variants.default.templates['page-0'];
    template.elements.push({ ...template.elements[0], id: 'grid', type: 'grid', gridConfig: { sourceType: 'current', cols: 2, gapX: 0, gapY: 0 } as any },
      { ...template.elements[0], id: 'svg', type: 'svg', svgContent: '<svg/>' });
    const h = renderIncrementalEditor(project); renameRoot(h.container, 'Checkpoint'); fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)')); h.onDocumentEdit.mockClear();
    fireEvent.click(screen.getByTitle('Layers'));
    const pairs = [['Node Properties', 'template-settings'], ['Geometry', 'element.geometry'], ['Appearance', 'element.appearance'],
      ['Typography', 'element.typography'], ['Interaction', 'element.interaction'], ['Grid Configuration', 'element.grid'], ['SVG Source', 'element.svgSource']];
    fireEvent.click(screen.getByTestId('element-row-title'));
    for (const [title, key] of pairs) {
      if (key === 'element.grid') fireEvent.click(screen.getByTestId('element-row-grid'));
      if (key === 'element.svgSource') fireEvent.click(screen.getByTestId('element-row-svg'));
      const header = screen.getByTitle(title); const next = header.getAttribute('aria-expanded') !== 'true';
      fireEvent.click(header);
      expect(h.onPreferencesChange.mock.calls.at(-1)![0]).toEqual({ panelsExpanded: expect.objectContaining({ [key]: next }) });
    }
    expect(h.onDocumentEdit).not.toHaveBeenCalled(); expect(screen.getByTitle('Redo (Ctrl+Y)')).not.toBeDisabled();
    expect(h.onPreferencesChange.mock.calls.every(([patch]) => Object.keys(patch).join() === 'panelsExpanded')).toBe(true);
  });

  it('G2 marquee alt-cycle and clear select real Canvas and layer rows with zero document or preference events', () => {
    const project = makeIncrementalProject(); const template = project.initialState.variants.default.templates['page-0'];
    template.elements = [0, 1].map(i => ({ ...template.elements[0], id: `overlap-${i}`, type: 'rect', x: 20, y: 20, w: 100, h: 100, zIndex: i }));
    const h = renderIncrementalEditor(project); h.setZoom(1); fireEvent.click(screen.getByTitle('Layers')); h.onPreferencesChange.mockClear();
    const canvas = h.container.querySelector('.canvas-scroll-container')!;
    fireEvent.mouseDown(canvas, { clientX: 1, clientY: 1, button: 0 }); fireEvent.mouseMove(canvas, { clientX: 150, clientY: 150 }); fireEvent.mouseUp(canvas);
    template.elements.forEach(element => expect(screen.getByTestId(`element-row-${element.id}`)).toHaveAttribute('aria-selected', 'true'));
    fireEvent.mouseDown(canvas, { clientX: 40, clientY: 40, button: 0, altKey: true }); fireEvent.mouseUp(canvas);
    expect(screen.getByTestId('element-row-overlap-1')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('element-row-overlap-0')).toHaveAttribute('aria-selected', 'false');
    fireEvent.mouseDown(canvas, { clientX: 40, clientY: 40, button: 0, altKey: true }); fireEvent.mouseUp(canvas);
    expect(screen.getByTestId('element-row-overlap-0')).toHaveAttribute('aria-selected', 'true');
    fireEvent.mouseDown(canvas, { clientX: 300, clientY: 300, button: 0 }); fireEvent.mouseUp(canvas);
    template.elements.forEach(element => expect(screen.getByTestId(`element-row-${element.id}`)).toHaveAttribute('aria-selected', 'false'));
    expect(h.onDocumentEdit).not.toHaveBeenCalled(); expect(h.onPreferencesChange).not.toHaveBeenCalled();
  });

  it('G2 cancel-only JSON reference delete generator variant and preset dialogs emit no writes', () => {
    const project = makeIncrementalProject(); project.initialState.nodes.child = { ...project.initialState.nodes.root, id: 'child', title: 'Child', parentId: 'root', children: [] };
    project.initialState.nodes.root.children = ['child'];
    const h = renderIncrementalEditor(project);
    fireEvent.click(screen.getByRole('button', { name: 'JSON' })); fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(h.container.querySelector('[data-node-id="root"] [title="Link Existing Page (Reference)"]')!);
    const modal = screen.getByText('Select Reference Target').closest('.max-w-lg')!;
    fireEvent.click(modal.querySelector('button')!); expect(screen.queryByText('Select Reference Target')).not.toBeInTheDocument();
    fireEvent.click(h.container.querySelector('[data-node-id="child"] [title="Delete"]')!); fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByTitle('Generate Hierarchy via Script')); fireEvent.click(screen.getByLabelText('Close generator'));
    fireEvent.click(screen.getByTitle('Save current project as a reusable preset')); fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(h.onDocumentEdit).not.toHaveBeenCalled(); expect(h.onPreferencesChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Templates' })); h.onPreferencesChange.mockClear();
    fireEvent.click(screen.getByTitle('Add New Variant')); fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(h.onDocumentEdit).not.toHaveBeenCalled(); expect(h.onPreferencesChange).not.toHaveBeenCalled();
    expect(screen.getByTitle('Undo (Ctrl+Z)')).toBeDisabled();
  });

  it('G2 adds a data field, updates nonroot title/type, and guards root duplicate/delete', () => {
    const project = makeIncrementalProject();
    project.initialState.nodes.child = { ...project.initialState.nodes.root, id: 'child', title: 'Child', parentId: 'root', children: [], data: {} };
    project.initialState.nodes.root.children = ['child'];
    const h = renderIncrementalEditor(project);
    fireEvent.click(h.container.querySelector('[data-node-id="child"]')!);
    fireEvent.change(screen.getByDisplayValue('Child'), { target: { value: 'Renamed child' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.change(screen.getByPlaceholderText('Field Name'), { target: { value: 'custom' } });
    fireEvent.keyDown(screen.getByPlaceholderText('Field Name'), { key: 'Enter' });
    const assigned = screen.getByText('Assigned Template').parentElement!.querySelector('select')!;
    fireEvent.change(assigned, { target: { value: 'page-1' } });
    expect(h.onDocumentEdit).toHaveBeenCalledTimes(3);
    const event = h.onDocumentEdit.mock.calls.at(-1)![0];
    expect(event.edit.after.nodes.child).toMatchObject({ title: 'Renamed child', type: 'page-1', data: { custom: '' } });
    for (const [event] of h.onDocumentEdit.mock.calls) expect(event.linkedProjectName).toBeUndefined();
    fireEvent.click(h.container.querySelector('[data-node-id="root"]')!);
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    (document.activeElement as HTMLElement)?.blur();
    fireEvent.keyDown(window, { key: 'd', ctrlKey: true }); fireEvent.keyDown(window, { key: 'Delete' });
    expect(alert).toHaveBeenCalledTimes(2); expect(h.onDocumentEdit).toHaveBeenCalledTimes(3);
  });

  it('G2 adds, duplicates and deletes nodes with atomic immutable parent updates', () => {
    const h = renderIncrementalEditor();
    const root = h.container.querySelector('[data-node-id="root"]')!;
    fireEvent.click(root.querySelector('[title="Add New Page"]')!);
    expect(h.onDocumentEdit).toHaveBeenCalledOnce();
    const first = h.onDocumentEdit.mock.calls[0][0];
    const added = first.edit.after.nodes.root.children.at(-1);
    expect(first.edit.before.nodes.root.children).toEqual(h.props.initialState.nodes.root.children);
    const row = h.container.querySelector(`[data-node-id="${added}"]`)!;
    fireEvent.click(row.querySelector('[title="Duplicate"]')!);
    expect(h.onDocumentEdit).toHaveBeenCalledTimes(2);
    expect(first.edit.after.nodes.root.children).not.toEqual(h.onDocumentEdit.mock.calls[1][0].edit.after.nodes.root.children);
    fireEvent.click(row.querySelector('[title="Delete"]')!);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Everything' }));
    expect(h.onDocumentEdit).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    expect(h.onDocumentEdit.mock.calls[3][0].edit.after.nodes[added]).toBe(first.edit.after.nodes[added]);
    expect(h.onStateChange).not.toHaveBeenCalled();
  });

  it('G2 groups multi-node assignment and reference creation while navigation stays outside document history', () => {
    const project = makeIncrementalProject();
    const initial = project.initialState;
    initial.nodes.a = { ...initial.nodes.root, id: 'a', title: 'Child A', parentId: 'root', children: [] };
    initial.nodes.b = { ...initial.nodes.root, id: 'b', title: 'Child B', parentId: 'root', children: [] };
    initial.nodes.root = { ...initial.nodes.root, children: ['a', 'b'] };
    const h = renderIncrementalEditor(project);
    fireEvent.click(h.container.querySelector('[data-node-id="a"]')!);
    fireEvent.click(h.container.querySelector('[data-node-id="b"]')!, { ctrlKey: true });
    expect(h.onDocumentEdit).not.toHaveBeenCalled();
    const select = [...h.container.querySelectorAll('select')].find(item => item.textContent?.includes('Select Template...'))!;
    fireEvent.change(select, { target: { value: 'page-1' } });
    expect(h.onDocumentEdit).toHaveBeenCalledOnce();
    const assignment = h.onDocumentEdit.mock.calls[0][0];
    expect(assignment.edit.changes).toHaveLength(2);
    expect(assignment.edit.after.nodes.a.type).toBe('page-1'); expect(assignment.edit.after.nodes.b.type).toBe('page-1');
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    expect(h.onDocumentEdit.mock.calls[1][0].edit.after).toBe(assignment.edit.before);
    fireEvent.click(h.container.querySelector('[data-node-id="root"] [title="Link Existing Page (Reference)"]')!);
    const modal = screen.getByText('Select Reference Target').closest('.max-w-lg')!;
    fireEvent.click(within(modal as HTMLElement).getByText('Child A'));
    expect(h.onDocumentEdit).toHaveBeenCalledTimes(3);
    const reference = h.onDocumentEdit.mock.calls[2][0];
    const ref = reference.edit.changes.find((change: any) => change.type === 'put-node' && change.node.referenceId)?.node;
    expect(ref).toMatchObject({ referenceId: 'a', parentId: 'root' });
    expect(reference.edit.after.nodes.root.children).toContain(ref.id);
    expect(h.onNameChange).not.toHaveBeenCalled();
  });

  it('G2 merges reentrant node data edits and deletion into latest data without losing other fields', () => {
    const project = makeIncrementalProject();
    project.initialState.nodes.root.data = { alpha: 'old-a', beta: 'old-b', remove: 'gone' };
    const h = renderIncrementalEditor(project);
    fireEvent.click(h.container.querySelector('[data-node-id="root"]')!);
    const alpha = screen.getByDisplayValue('old-a');
    const beta = screen.getByDisplayValue('old-b');
    const remove = screen.getByDisplayValue('gone').parentElement!;
    h.onDocumentEdit.mockImplementationOnce(() => {
      fireEvent.change(beta, { target: { value: 'new-b' } });
      fireEvent.click(within(remove).getByTitle('Delete Field'));
    });
    fireEvent.change(alpha, { target: { value: 'new-a' } });
    expect(h.onDocumentEdit).toHaveBeenCalledTimes(3);
    const events = h.onDocumentEdit.mock.calls.map(([event]) => event);
    expect(events[2].edit.after.nodes.root.data).toEqual({ alpha: 'new-a', beta: 'new-b' });
    expect(events[0].edit.after.nodes.root.data).toEqual({ alpha: 'new-a', beta: 'old-b', remove: 'gone' });
    expect(project.initialState.nodes.root.data).toEqual({ alpha: 'old-a', beta: 'old-b', remove: 'gone' });
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    expect(h.onDocumentEdit.mock.calls.at(-1)![0].edit.after.nodes.root.data).toEqual({ alpha: 'new-a', beta: 'new-b', remove: 'gone' });
  });

  it('G2 cancels open reference target on navigation rather than retargeting new parent', () => {
    const project = makeIncrementalProject();
    project.initialState.nodes.child = { ...project.initialState.nodes.root, id: 'child', title: 'Child', parentId: 'root', children: [] };
    project.initialState.nodes.root.children = ['child'];
    const h = renderIncrementalEditor(project);
    fireEvent.click(h.container.querySelector('[data-node-id="root"] [title="Link Existing Page (Reference)"]')!);
    expect(screen.getByText('Select Reference Target')).toBeInTheDocument();
    fireEvent.click(h.container.querySelector('[data-node-id="child"]')!);
    expect(screen.queryByText('Select Reference Target')).not.toBeInTheDocument();
    expect(h.onDocumentEdit).not.toHaveBeenCalled();
  });

  it('G2 deletes descendant/reference cascades and indexed link/grid owners across variants in one real confirmation', () => {
    const project = makeIncrementalProject(); const initial = project.initialState;
    initial.nodes.a = { ...initial.nodes.root, id: 'a', title: 'Parent A', parentId: 'root', children: ['b'] };
    initial.nodes.b = { ...initial.nodes.root, id: 'b', title: 'Child B', parentId: 'a', children: [] };
    initial.nodes.ref = { ...initial.nodes.root, id: 'ref', title: 'Reference B', parentId: 'root', children: [], referenceId: 'b' };
    initial.nodes.root.children = ['a', 'ref'];
    const source = initial.variants.default.templates['page-1'];
    initial.variants.other = { id: 'other', name: 'Other', templates: { linked: { ...source, id: 'linked', elements: [
      { ...source.elements[0], id: 'link', linkTarget: 'specific_node', linkValue: 'b' },
      { ...source.elements[0], id: 'grid', type: 'grid', gridConfig: { sourceType: 'specific', sourceId: 'b', cols: 1, rows: 1, gapX: 0, gapY: 0 } as any },
      { ...source.elements[0], id: 'untouched' },
    ] } } };
    const h = renderIncrementalEditor(project);
    const build = vi.spyOn(references, 'buildReferenceIndex');
    fireEvent.click(h.container.querySelector('[data-node-id="a"] [title="Delete"]')!);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Everything' }));
    expect(h.onDocumentEdit).toHaveBeenCalledOnce();
    const event = h.onDocumentEdit.mock.calls[0][0];
    expect(event.edit.changes.filter((change: any) => change.type === 'delete-node').map((change: any) => change.nodeId).sort()).toEqual(['a', 'b', 'ref']);
    const before = event.edit.before.variants.other.templates.linked, after = event.edit.after.variants.other.templates.linked;
    expect(after.elements[0]).toMatchObject({ linkTarget: 'none', linkValue: undefined });
    expect(after.elements[1].gridConfig).toMatchObject({ sourceType: 'current', sourceId: undefined });
    expect(after.elements[2]).toBe(before.elements[2]); expect(after.layers).toBe(before.layers);
    expect(event.edit.after.variants.default).toBe(event.edit.before.variants.default);
    expect(event.edit.after.nodes.root.children).toEqual([]);
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)')); fireEvent.click(screen.getByTitle('Redo (Ctrl+Y)'));
    expect(h.onDocumentEdit.mock.calls[1][0].edit.after).toBe(event.edit.before);
    expect(h.onDocumentEdit.mock.calls[2][0].edit.after).toBe(event.edit.after);
    expect(build).not.toHaveBeenCalled();
  });

  it('G2 copies immutable elements and gives cut/paste/duplicate/nudge their own atomic undo entries', () => {
    const h = renderIncrementalEditor();
    fireEvent.click(screen.getByTitle('Layers'));
    fireEvent.click(screen.getByTestId('element-row-title'));
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true });
    expect(h.onDocumentEdit).not.toHaveBeenCalled();
    h.onPreferencesChange.mockClear();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    const nudge = h.onDocumentEdit.mock.calls[0][0];
    const original = nudge.edit.before.variants.default.templates['page-0'].elements[0];
    expect(nudge.edit.after.variants.default.templates['page-0'].elements[0].x).toBe(original.x + 1);
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true });
    const pasted = h.onDocumentEdit.mock.calls[1][0];
    expect(pasted.edit.after.variants.default.templates['page-0'].elements.at(-1).x).toBe(original.x + 20);
    expect(pasted.selection.after.selectedElementIds).toHaveLength(1);
    fireEvent.keyDown(window, { key: 'd', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'x', ctrlKey: true });
    expect(h.onDocumentEdit).toHaveBeenCalledTimes(4);
    const cut = h.onDocumentEdit.mock.calls[3][0];
    expect(cut.selection.after.selectedElementIds).toEqual([]);
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    expect(h.onDocumentEdit.mock.calls[4][0].edit.after).toBe(cut.edit.before);
    expect(original.x).toBe(12); expect(h.onPreferencesChange).not.toHaveBeenCalled();
  });

  it.each([
    ['Circle/Ellipse (E)', 'ellipse'], ['Triangle (Y)', 'triangle'], ['Line (L)', 'line'],
    ['Data Grid (G)', 'grid'], ['Text Box (T)', 'text'],
  ])('G5 creates %s with atomic selection and no finish save', (tool, type) => {
    const h = renderIncrementalEditor(); h.setZoom(1); fireEvent.click(screen.getByTitle(tool));
    const canvas = h.container.querySelector('.canvas-scroll-container')!;
    fireEvent.mouseDown(canvas, { clientX: 300, clientY: 300, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 400, clientY: 400 }); fireEvent.mouseUp(canvas, { clientX: 400, clientY: 400 });
    expect(h.onDocumentEdit).toHaveBeenCalledOnce();
    const created = h.onDocumentEdit.mock.calls[0][0];
    const template = created.edit.after.variants.default.templates['page-0'];
    expect(template.elements.at(-1)).toMatchObject({ type, x: 300, y: 300,
      w: type === 'grid' ? (100 - 2 * 10) / 3 : 100, h: type === 'grid' ? (100 - 10) / 2 : 100 });
    expect(created.selection.after.selectedElementIds).toEqual([template.elements.at(-1).id]);
    expect(template.layers).toBe(created.edit.before.variants.default.templates['page-0'].layers);
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    expect(h.onDocumentEdit.mock.calls.at(-1)![0].edit.after).toBe(created.edit.before);
  });

  it.each([
    ['Align Left', 'x', [10, 10, 10]], ['Align Center (Horizontal)', 'x', [110, 110, 110]],
    ['Align Right', 'x', [210, 210, 210]], ['Align Top', 'y', [20, 20, 20]],
    ['Align Middle (Vertical)', 'y', [120, 120, 120]], ['Align Bottom', 'y', [220, 220, 220]],
    ['Distribute Horizontally', 'x', [10, 110, 210]], ['Distribute Vertically', 'y', [20, 120, 220]],
  ] as const)('G4 %s targets hierarchy template and retains unselected records', (title, axis, expected) => {
    const project = makeIncrementalProject();
    const template = project.initialState.variants.default.templates['page-0'];
    const first = template.elements[0];
    template.elements = [
      { ...first, id: 'one', x: 10, y: 20, w: 20, h: 20 },
      { ...first, id: 'two', x: 50, y: 70, w: 20, h: 20 },
      { ...first, id: 'three', x: 210, y: 220, w: 20, h: 20 },
      { ...first, id: 'unselected', x: 300, y: 400 },
    ];
    project.initialState.selectedTemplateId = 'page-1';
    const h = renderIncrementalEditor(project);
    fireEvent.click(screen.getByTitle('Layers'));
    fireEvent.click(screen.getByTestId('element-row-one'));
    fireEvent.click(screen.getByTestId('element-row-two'), { ctrlKey: true });
    fireEvent.click(screen.getByTestId('element-row-three'), { ctrlKey: true });
    // Toolbar precedes typography's same-named text-alignment buttons.
    fireEvent.click(screen.getAllByTitle(title)[0]);
    expect(h.onDocumentEdit).toHaveBeenCalledOnce();
    const event = h.onDocumentEdit.mock.calls[0][0];
    const before = event.edit.before.variants.default.templates['page-0'];
    const after = event.edit.after.variants.default.templates['page-0'];
    expect(after.elements.slice(0, 3).map((element: any) => element[axis])).toEqual(expected);
    expect(after.elements[3]).toBe(before.elements[3]);
    expect(event.edit.after.variants.default.templates['page-1']).toBe(event.edit.before.variants.default.templates['page-1']);
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    expect(h.onDocumentEdit.mock.calls[1][0].edit.after).toBe(event.edit.before);
  });

  it('G3 uses real template and variant structural controls with one event per action', () => {
    const h = renderIncrementalEditor();
    h.selectTemplate('page-0');
    fireEvent.click(screen.getByRole('button', { name: 'New Template' }));
    expect(h.onDocumentEdit).toHaveBeenCalledOnce();
    const added = h.onDocumentEdit.mock.calls[0][0];
    expect(added.correspondence.mappings).toEqual([expect.objectContaining({ type: 'create' })]);
    const id = added.selection.after.selectedTemplateId;
    const row = h.container.querySelector(`[data-template-id="${id}"]`)!;
    fireEvent.click(row.querySelector('[title="Duplicate"]')!);
    expect(h.onDocumentEdit).toHaveBeenCalledTimes(2);
    expect(h.onDocumentEdit.mock.calls[1][0].correspondence.mappings[0]).toMatchObject({ type: 'copy', from: { templateId: id } });
    fireEvent.click(screen.getByTitle('Duplicate Variant'));
    expect(h.onDocumentEdit).toHaveBeenCalledTimes(3);
    const variant = h.onDocumentEdit.mock.calls[2][0];
    expect(variant.selection.after.activeVariantId).not.toBe('default');
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    expect(h.onDocumentEdit.mock.calls[3][0].origin).toBe('undo');
    expect(h.onStateChange).not.toHaveBeenCalled();
  });

  it('G3 renames and deletes real templates with exact remove provenance and last-template guard', () => {
    const h = renderIncrementalEditor(); h.selectTemplate('page-1');
    const row = h.container.querySelector('[data-template-id="page-1"]')!;
    fireEvent.click(row.querySelector('button')!);
    fireEvent.change(row.querySelector('input')!, { target: { value: 'Renamed template' } });
    fireEvent.keyDown(row.querySelector('input')!, { key: 'Enter' });
    const renamed = h.onDocumentEdit.mock.calls[0][0];
    expect(renamed.edit.after.variants.default.templates['page-1'].name).toBe('Renamed template');
    expect(renamed.edit.after.variants.default.templates['page-1'].layers).toBe(renamed.edit.before.variants.default.templates['page-1'].layers);
    expect(renamed.correspondence.mappings).toEqual([]);
    fireEvent.click(row.querySelector('[title="Delete"]')!);
    const deleted = h.onDocumentEdit.mock.calls[1][0];
    expect(deleted.edit.changes).toEqual([{ type: 'delete-template', variantId: 'default', templateId: 'page-1' }]);
    expect(deleted.correspondence.mappings).toEqual([{ type: 'remove', from: { variantId: 'default', templateId: 'page-1', position: 0 } }]);
    expect(deleted.selection.after.selectedTemplateId).toBe('page-0');
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    fireEvent.click(h.container.querySelector('[data-template-id="page-0"] [title="Delete"]')!);
    expect(alert).toHaveBeenCalledOnce(); expect(h.onDocumentEdit).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    expect(h.onDocumentEdit.mock.calls[2][0].edit.after).toBe(deleted.edit.before);
  });

  it.each([false, true])('G3 template reflow font scaling=%s preserves layers and nested non-geometry values', scaleFonts => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue({
      font: '20px sans-serif', measureText(text: string) { return { width: text.length * Number(this.font.match(/([\d.]+)px/)![1]) * .5 }; },
    } as CanvasRenderingContext2D);
    const project = makeIncrementalProject();
    project.initialState.variants.default.templates['page-0'].elements[0].fontSize = 20;
    const h = renderIncrementalEditor(project); h.selectTemplate('page-0');
    const toggle = (label: string) => fireEvent.click(screen.getByText(label).parentElement!.parentElement!.querySelector('button')!);
    expect(screen.getByText('Scale Typography')).toBeInTheDocument(); // Reflow defaults on.
    if (!scaleFonts) toggle('Scale Typography');
    const width = screen.getByText('Width').parentElement!.querySelector('input')!;
    const oldWidth = Number(width.value);
    fireEvent.change(width, { target: { value: String(oldWidth * 2) } });
    expect(h.onDocumentEdit).toHaveBeenCalledOnce();
    const event = h.onDocumentEdit.mock.calls[0][0];
    const before = event.edit.before.variants.default.templates['page-0'];
    const after = event.edit.after.variants.default.templates['page-0'];
    expect(after.width).toBe(oldWidth * 2); expect(after.elements[0].x).toBe(before.elements[0].x * 2);
    expect(after.layers).toBe(before.layers); expect(after.elements[0].textPadding).toBe(before.elements[0].textPadding);
    if (!scaleFonts) expect(after.elements[0].fontSize).toBe(before.elements[0].fontSize);
    const height = screen.getByText('Height').parentElement!.querySelector('input')!;
    fireEvent.change(height, { target: { value: String(before.height * 2) } });
    const doubled = h.onDocumentEdit.mock.calls.at(-1)![0].edit.after.variants.default.templates['page-0'];
    expect(doubled.elements[0].fontSize).toBe(scaleFonts ? before.elements[0].fontSize * 2 : before.elements[0].fontSize);
    expect(event.correspondence.mappings).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Landscape' }));
    expect(h.onDocumentEdit.mock.calls.at(-1)![0].edit.after.variants.default.templates['page-0'].height).toBe(oldWidth * 2);
  });

  it('G3 creates renames navigates and deletes real variants without mutating source records', () => {
    const h = renderIncrementalEditor(); h.selectTemplate('page-0');
    fireEvent.click(screen.getByTitle('Add New Variant'));
    fireEvent.change(screen.getByPlaceholderText('e.g. iPad Version'), { target: { value: 'Second variant' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Variant' }));
    expect(h.onDocumentEdit).toHaveBeenCalledOnce();
    const created = h.onDocumentEdit.mock.calls[0][0];
    const id = created.selection.after.activeVariantId;
    expect(created.edit.after.variants.default).toBe(created.edit.before.variants.default);
    expect(created.correspondence.mappings).toHaveLength(2);
    expect(created.correspondence.mappings.every((mapping: any) => mapping.type === 'copy')).toBe(true);
    fireEvent.click(screen.getByTitle('Rename Variant'));
    const name = screen.getByDisplayValue('Second variant');
    fireEvent.change(name, { target: { value: 'Renamed variant' } }); fireEvent.keyDown(name, { key: 'Enter' });
    const renamed = h.onDocumentEdit.mock.calls[1][0];
    expect(renamed.edit.changes).toHaveLength(1); expect(renamed.edit.changes[0].type).toBe('put-variant');
    expect(renamed.edit.after.variants[id].templates).toBe(created.edit.after.variants[id].templates);
    expect(renamed.correspondence.mappings).toEqual([]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByTitle('Delete Variant'));
    const deleted = h.onDocumentEdit.mock.calls[2][0];
    expect(deleted.edit.changes.map((change: any) => change.type)).toEqual(['delete-template', 'delete-template', 'delete-variant']);
    expect(deleted.selection.after.activeVariantId).toBe('default');
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    expect(h.onDocumentEdit.mock.calls[3][0].edit.after).toBe(deleted.edit.before);
  });

  it.each(['none', 'geometry', 'fonts'] as const)('G3 variant reflow %s copies exact dimensions and preserves source extensions', mode => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue({
      font: '20px sans-serif', measureText(text: string) { return { width: text.length * Number(this.font.match(/([\d.]+)px/)![1]) * .5 }; },
    } as CanvasRenderingContext2D);
    const project = makeIncrementalProject(); const initial = project.initialState;
    for (const template of Object.values(initial.variants.default.templates)) template.elements[0] = {
      ...template.elements[0], type: 'rect', fontSize: 20, strokeWidth: 2,
    };
    const h = renderIncrementalEditor(project); h.selectTemplate('page-0'); fireEvent.click(screen.getByTitle('Add New Variant'));
    if (mode === 'none') fireEvent.click(screen.getByTitle('Disable reflow'));
    if (mode === 'geometry') fireEvent.click(screen.getByTitle('Disable font scaling'));
    fireEvent.change(labeledInput('Width (pt)'), { target: { value: '1000' } });
    fireEvent.change(labeledInput('Height (pt)'), { target: { value: '1400' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Variant' }));
    const event = h.onDocumentEdit.mock.calls[0][0]; const after = event.edit.after.variants[event.selection.after.activeVariantId];
    expect(h.onDocumentEdit).toHaveBeenCalledOnce();
    Object.entries(after.templates).forEach(([id, raw]) => {
      const template = raw as any; const before = event.edit.before.variants.default.templates[id];
      expect(template).toMatchObject({ width: 1000, height: 1400 });
      expect(template.elements[0]).toMatchObject({ x: before.elements[0].x * (mode === 'none' ? 1 : 2), y: before.elements[0].y * (mode === 'none' ? 1 : 2), fontSize: mode === 'fonts' ? 40 : 20 });
      expect(template.elements[0].textPadding).toBe(before.elements[0].textPadding); expect(template.layers).toBe(before.layers);
    });
    expect(event.edit.after.variants.default).toBe(event.edit.before.variants.default);
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)')); expect(h.onDocumentEdit.mock.calls.at(-1)![0].edit.after).toBe(event.edit.before);
    expect(screen.queryByTitle('Delete Variant')).not.toBeInTheDocument(); // actual last-variant guard: no delete control
  });

  it('G3 template preset portrait and no-reflow dimensions retain original geometry and inactive artwork', () => {
    const h = renderIncrementalEditor(); h.selectTemplate('page-0');
    fireEvent.click(screen.getByText('Auto-Reflow Elements').parentElement!.parentElement!.querySelector('button')!);
    fireEvent.change(screen.getByText('Page Presets').parentElement!.querySelector('select')!, { target: { value: 'a4' } });
    const preset = h.onDocumentEdit.mock.calls[0][0];
    expect(preset.edit.after.variants.default.templates['page-0']).toMatchObject({ width: 595.28, height: 841.89 });
    fireEvent.click(screen.getByRole('button', { name: 'Landscape' })); fireEvent.click(screen.getByRole('button', { name: 'Portrait' }));
    const portrait = h.onDocumentEdit.mock.calls.at(-1)![0];
    expect(portrait.edit.after.variants.default.templates['page-0']).toMatchObject({ width: 595.28, height: 841.89 });
    expect(portrait.edit.after.variants.default.templates['page-0'].elements).toBe(preset.edit.before.variants.default.templates['page-0'].elements);
    expect(portrait.edit.after.variants.default.templates['page-1']).toBe(preset.edit.before.variants.default.templates['page-1']);
    expect(h.onDocumentEdit.mock.calls.every(([event]) => event.correspondence.mappings.length === 0)).toBe(true);
  });

  it.each([false, true])('G2 clipboard fallback raw layers and nested immutable source with snap=%s', snap => {
    const project = makeIncrementalProject(); const initial = project.initialState;
    initial.variants.default.templates['page-1'].layers = [null, { id: 'destination', name: 'Destination', order: 0, visible: true, locked: false }] as any;
    initial.variants.default.templates['page-1'].elements[0].layerId = 'destination'; initial.variants.default.templates['page-1'].elements[0].zIndex = 7;
    const h = renderIncrementalEditor(project); fireEvent.click(screen.getByTitle('Layers')); fireEvent.click(screen.getByTestId('element-row-title'));
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true }); expect(h.onDocumentEdit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Padding top'), { target: { value: '9' } });
    const changed = h.onDocumentEdit.mock.calls[0][0];
    h.selectTemplate('page-1'); fireEvent.keyDown(window, { key: 'v', ctrlKey: true });
    const paste = h.onDocumentEdit.mock.calls[1][0]; const pasted = paste.edit.after.variants.default.templates['page-1'].elements.at(-1);
    expect(pasted).toMatchObject({ x: 32, y: 44, layerId: 'destination', zIndex: 8 });
    expect(pasted.textPadding).toBe(changed.edit.before.variants.default.templates['page-0'].elements[0].textPadding);
    expect(pasted.textPadding.top).toBe(0);
    if (snap) fireEvent.click(screen.getByTitle('Snap to Grid'));
    fireEvent.keyDown(window, { key: 'ArrowDown', shiftKey: !snap });
    const nudge = h.onDocumentEdit.mock.calls.at(-1)![0]; expect(nudge.edit.after.variants.default.templates['page-1'].elements.at(-1).y).toBe(54);
    expect(pasted.y).toBe(44); expect(paste.selection.after.selectedElementIds).toEqual([pasted.id]);
  });

  it('G2 multi-selected subtree duplication keeps descendants and parents immutable with exact new selection', () => {
    const project = makeIncrementalProject(); const initial = project.initialState;
    initial.nodes.root.children = ['a', 'b'];
    for (const [id, parentId, children] of [['a', 'root', ['leaf']], ['b', 'root', []], ['leaf', 'a', []]] as const)
      initial.nodes[id] = { ...initial.nodes.root, id, parentId, children: [...children], title: id };
    const h = renderIncrementalEditor(project);
    fireEvent.click(h.container.querySelector('[data-node-id="a"]')!); fireEvent.click(h.container.querySelector('[data-node-id="b"]')!, { ctrlKey: true });
    fireEvent.keyDown(window, { key: 'd', ctrlKey: true });
    const event = h.onDocumentEdit.mock.calls[0][0]; const nodes = event.edit.after.nodes;
    const [a, b] = event.selection.after.selectedNodeIds; expect(nodes[a].title).toBe('a (Copy)'); expect(nodes[b].title).toBe('b (Copy)');
    expect(nodes[a].children).toHaveLength(1); expect(nodes[nodes[a].children[0]]).toMatchObject({ parentId: a, title: 'leaf (Copy)' });
    expect(nodes.root.children).toEqual(['a', a, 'b', b]); expect(event.edit.before.nodes.root.children).toEqual(['a', 'b']);
    expect(nodes.a).toBe(event.edit.before.nodes.a); expect(nodes.leaf).toBe(event.edit.before.nodes.leaf);
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)')); expect(h.onDocumentEdit.mock.calls[1][0].edit.after).toBe(event.edit.before);
  });

  it.each([['year_view', 'month_view'], ['month_view', 'day_view'], ['day_view', 'day_view']])('G2 add node from %s follows actual template heuristic to %s', (parentType, expected) => {
    const project = makeIncrementalProject(); const initial = project.initialState; const source = initial.variants.default.templates['page-0'];
    initial.variants.default.templates = Object.fromEntries(['year_view', 'month_view', 'day_view'].map(id => [id, { ...source, id }])); initial.nodes.root.type = parentType;
    const h = renderIncrementalEditor(project); fireEvent.click(h.container.querySelector('[data-node-id="root"] [title="Add New Page"]')!);
    const event = h.onDocumentEdit.mock.calls[0][0]; const id = event.edit.after.nodes.root.children[0];
    expect(event.edit.after.nodes[id]).toMatchObject({ parentId: 'root', type: expected });
    expect(event.edit.changes).toHaveLength(2); expect(event.edit.after.variants).toBe(event.edit.before.variants);
  });

  it('G4 folds are preferences while real layer edits and SVG creation are undoable document actions', () => {
    const h = renderIncrementalEditor();
    fireEvent.click(screen.getByTitle('Layers'));
    fireEvent.click(screen.getByTitle('Collapse layer'));
    expect(h.onDocumentEdit).not.toHaveBeenCalled();
    expect(h.onPreferencesChange).toHaveBeenCalledWith({}, expect.objectContaining({ folds: expect.any(Object) }));
    fireEvent.click(screen.getByTitle('Toggle visibility'));
    expect(h.onDocumentEdit).toHaveBeenCalledOnce();
    const first = h.onDocumentEdit.mock.calls[0][0];
    expect(Object.hasOwn(first.edit.after.variants.default.templates['page-0'].layers[0], 'collapsed')).toBe(false);
    fireEvent.click(screen.getByTitle('Add layer'));
    expect(h.onDocumentEdit).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByTitle('SVG Tools'));
    fireEvent.click(screen.getByRole('button', { name: 'Insert placeholder SVG' }));
    expect(h.onDocumentEdit).toHaveBeenCalledTimes(3);
    const placed = h.onDocumentEdit.mock.calls[2][0];
    expect(placed.selection.after.selectedElementIds).toHaveLength(1);
    expect(placed.edit.after.variants.default.templates['page-0'].elements.at(-1).type).toBe('svg');
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    expect(h.onDocumentEdit.mock.calls[3][0].edit.after).toBe(placed.edit.before);
    expect(h.onStateChange).not.toHaveBeenCalled();
  });

  it('G5 creates through real canvas with atomic selection and checkpoints one cancellable drag group', () => {
    const h = renderIncrementalEditor();
    h.setZoom(1);
    fireEvent.click(screen.getByTitle('Rectangle (R)'));
    const canvas = h.container.querySelector('.canvas-scroll-container')!;
    fireEvent.mouseDown(canvas, { clientX: 300, clientY: 300, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 400, clientY: 400 });
    fireEvent.mouseUp(canvas, { clientX: 400, clientY: 400 });
    expect(h.onDocumentEdit).toHaveBeenCalledOnce();
    const creation = h.onDocumentEdit.mock.calls[0][0];
    const id = creation.edit.after.variants.default.templates['page-0'].elements.at(-1).id;
    expect(creation.selection.after.selectedElementIds).toEqual([id]);
    fireEvent.click(screen.getByTitle('Select Tool (V)'));
    fireEvent.mouseDown(h.container.querySelector(`[data-element-id="${id}"]`)!, { clientX: 320, clientY: 320, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 340, clientY: 350 });
    fireEvent.mouseMove(canvas, { clientX: 360, clientY: 370 });
    expect(h.onDocumentEdit).toHaveBeenCalledTimes(3);
    const first = h.onDocumentEdit.mock.calls[1][0], second = h.onDocumentEdit.mock.calls[2][0];
    expect(first.groupId).toBe(second.groupId);
    expect(second.edit.after.variants.default.templates['page-0'].elements.at(-1)).toMatchObject({ x: 340, y: 350 });
    fireEvent.keyDown(window, { key: 'Escape' });
    const cancelled = h.onDocumentEdit.mock.calls.at(-1)![0];
    expect(cancelled.origin).toBe('cancel');
    expect(cancelled.edit.after).toBe(creation.edit.after);
    fireEvent.mouseUp(canvas, { clientX: 360, clientY: 370 });
    expect(h.onDocumentEdit).toHaveBeenCalledTimes(4);
  });

  it.each([
    ['rect', 1, 'data-resize-handle="se"'], ['rect', 2, 'data-resize-handle="se"'],
    ['rect', 1, 'data-rotate-handle'], ['rect', 2, 'data-rotate-handle'],
    ['line', 1, 'data-resize-handle="end"'], ['grid', 1, 'data-resize-handle="se"'],
    ['rect', 1, 'data-pivot-handle'],
  ] as const)('G5 %s count=%s %s checkpoints once per gesture and undoes exact geometry', (type, count, handle) => {
    const project = makeIncrementalProject(); const template = project.initialState.variants.default.templates['page-0'];
    template.elements = Array.from({ length: count }, (_, i) => ({ ...template.elements[0], id: `shape-${i}`, type,
      x: 20 + i * 150, y: 20, w: 100, h: 100, rotation: 0,
      ...(type === 'grid' ? { gridConfig: { sourceType: 'current', cols: 1, rows: 1, gapX: 0, gapY: 0 } as any } : {}),
    }));
    const h = renderIncrementalEditor(project); h.setZoom(1); fireEvent.click(screen.getByTitle('Layers'));
    template.elements.forEach((element, i) => fireEvent.click(screen.getByTestId(`element-row-${element.id}`), { ctrlKey: i > 0 }));
    const canvas = h.container.querySelector('.canvas-scroll-container')!;
    fireEvent.mouseDown(h.container.querySelector(`[${handle}]`)!, { clientX: 120, clientY: 120, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 150, clientY: 160 });
    expect(h.onDocumentEdit).toHaveBeenCalledOnce();
    const first = h.onDocumentEdit.mock.calls[0][0];
    expect(first.edit.after.variants.default.templates['page-0'].elements).not.toEqual(first.edit.before.variants.default.templates['page-0'].elements);
    fireEvent.mouseMove(canvas, { clientX: 170, clientY: 190 });
    const moved = h.onDocumentEdit.mock.calls.at(-1)![0]; expect(moved.groupId).toBe(first.groupId);
    fireEvent.mouseUp(canvas, { clientX: 170, clientY: 190 });
    const finished = h.onDocumentEdit.mock.calls.at(-1)![0];
    expect(finished.groupId).toBe(first.groupId);
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    expect(h.onDocumentEdit.mock.calls.at(-1)![0].edit.after).toBe(first.edit.before);
    expect(screen.getByTitle('Undo (Ctrl+Z)')).toBeDisabled();
  });

  it('G5 Ctrl-copy drag retains one undo entry and inline text Escape accepts one separate group', () => {
    const h = renderIncrementalEditor(); h.setZoom(1);
    const canvas = h.container.querySelector('.canvas-scroll-container')!;
    fireEvent.mouseDown(h.container.querySelector('[data-element-id="title"]')!, { clientX: 40, clientY: 40, button: 0, ctrlKey: true });
    fireEvent.mouseMove(canvas, { clientX: 80, clientY: 90, ctrlKey: true });
    fireEvent.mouseUp(canvas, { clientX: 80, clientY: 90 });
    const events = h.onDocumentEdit.mock.calls.map(([event]) => event);
    expect(events.length).toBeGreaterThanOrEqual(2);
    const copy = events[0]; const moved = events.at(-1)!;
    expect(moved.groupId).toBe(copy.groupId);
    expect(moved.edit.after.variants.default.templates['page-0'].elements).toHaveLength(2);
    expect(copy.selection.after.selectedElementIds).toHaveLength(1);
    expect(copy.selection.after.selectedElementIds[0]).not.toBe('title');
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    expect(h.onDocumentEdit.mock.calls.at(-1)![0].edit.after).toBe(copy.edit.before);
    fireEvent.doubleClick(h.container.querySelector('[data-element-id="title"]')!);
    const input = screen.getByTestId('overlay-text-editor');
    fireEvent.input(input, { target: { innerText: 'First text' } });
    fireEvent.input(input, { target: { innerText: 'Final text' } });
    const text = h.onDocumentEdit.mock.calls.at(-1)![0];
    expect(text.edit.after.variants.default.templates['page-0'].elements[0].text).toBe('Final text');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByTestId('overlay-text-editor')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    expect(h.onDocumentEdit.mock.calls.at(-1)![0].edit.after).toBe(copy.edit.before);
  });

  it('G5 net-zero pointer geometry restores retained records and pointercancel cannot mutate afterward', () => {
    const h = renderIncrementalEditor(); h.setZoom(1);
    const canvas = h.container.querySelector('.canvas-scroll-container')!;
    const text = () => h.container.querySelector('[data-element-id="title"]')!;
    fireEvent.mouseDown(text(), { clientX: 40, clientY: 40, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 60, clientY: 70 });
    const first = h.onDocumentEdit.mock.calls[0][0];
    fireEvent.mouseMove(canvas, { clientX: 40, clientY: 40 });
    expect(h.onDocumentEdit.mock.calls[1][0].edit.after.variants.default.templates['page-0'])
      .toBe(first.edit.before.variants.default.templates['page-0']);
    fireEvent.mouseUp(canvas, { clientX: 40, clientY: 40 });
    expect(screen.getByTitle('Undo (Ctrl+Z)')).toBeDisabled();
    fireEvent.mouseDown(text(), { clientX: 40, clientY: 40, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 60, clientY: 70 });
    fireEvent.pointerCancel(canvas);
    expect(h.onDocumentEdit.mock.calls.at(-1)![0].origin).toBe('cancel');
    const calls = h.onDocumentEdit.mock.calls.length;
    fireEvent.mouseMove(canvas, { clientX: 80, clientY: 90 });
    fireEvent.mouseUp(canvas, { clientX: 80, clientY: 90 });
    expect(h.onDocumentEdit).toHaveBeenCalledTimes(calls);
  });

  it.each(['absent', 'undefined', 'present'] as const)('G5 net-zero pivot restores %s own fields rather than creating history', presence => {
    const project = makeIncrementalProject(); const element = project.initialState.variants.default.templates['page-0'].elements[0];
    Object.assign(element, { type: 'rect', x: 20, y: 20, w: 100, h: 100, rotation: 0 });
    if (presence === 'absent') delete element.transformOrigin;
    else element.transformOrigin = presence === 'present' ? { x: .5, y: .5 } : undefined;
    const h = renderIncrementalEditor(project); h.setZoom(1); fireEvent.click(screen.getByTitle('Layers')); fireEvent.click(screen.getByTestId('element-row-title'));
    const canvas = h.container.querySelector('.canvas-scroll-container')!;
    fireEvent.mouseDown(h.container.querySelector('[data-pivot-handle]')!, { clientX: 70, clientY: 70, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 95, clientY: 95 });
    const first = h.onDocumentEdit.mock.calls[0][0];
    fireEvent.mouseMove(canvas, { clientX: 70, clientY: 70 }); fireEvent.mouseUp(canvas);
    expect(h.onDocumentEdit.mock.calls.at(-1)![0].edit.after.variants.default.templates['page-0']).toBe(first.edit.before.variants.default.templates['page-0']);
    expect(screen.getByTitle('Undo (Ctrl+Z)')).toBeDisabled();
  });

  it('G5 no-op pointer and group pivot preserve redo and remain session-only', () => {
    const project = makeIncrementalProject(); const template = project.initialState.variants.default.templates['page-0'];
    template.elements.push({ ...template.elements[0], id: 'other', x: 300 });
    const h = renderIncrementalEditor(project); h.setZoom(1); fireEvent.click(screen.getByTitle('Layers')); fireEvent.click(screen.getByTestId('element-row-title'));
    fireEvent.keyDown(window, { key: 'ArrowRight' }); const changed = h.onDocumentEdit.mock.calls[0][0];
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)')); h.onDocumentEdit.mockClear(); h.onPreferencesChange.mockClear();
    const canvas = h.container.querySelector('.canvas-scroll-container')!;
    fireEvent.mouseDown(h.container.querySelector('[data-element-id="title"]')!, { clientX: 40, clientY: 40, button: 0 }); fireEvent.mouseUp(canvas);
    fireEvent.click(screen.getByTestId('element-row-other'), { ctrlKey: true });
    fireEvent.mouseDown(h.container.querySelector('[data-pivot-handle]')!, { clientX: 100, clientY: 50, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 200, clientY: 100 }); fireEvent.mouseUp(canvas);
    expect(h.onDocumentEdit).not.toHaveBeenCalled(); expect(h.onPreferencesChange).not.toHaveBeenCalled();
    expect(screen.getByTitle('Redo (Ctrl+Y)')).not.toBeDisabled(); fireEvent.click(screen.getByTitle('Redo (Ctrl+Y)'));
    expect(h.onDocumentEdit.mock.calls[0][0].edit.after).toBe(changed.edit.after);
  });

  it.each(['hierarchy', 'templates'] as const)('G5 history resolves selection in current %s mode for ordinary and bulk crossings', currentMode => {
    const project = makeIncrementalProject(); project.initialState.nodes.root.type = 'page-1';
    Object.values(project.initialState.variants.default.templates).forEach((template, i) => { template.elements[0].id = `element-${i}`; });
    const h = renderIncrementalEditor(project); h.setZoom(1); fireEvent.click(screen.getByTitle('Layers'));
    if (currentMode === 'hierarchy') h.selectTemplate('page-0');
    fireEvent.click(screen.getByTestId(`element-row-element-${currentMode === 'hierarchy' ? 0 : 1}`));
    fireEvent.keyDown(window, { key: 'ArrowRight' }); const edit = h.onDocumentEdit.mock.calls[0][0];
    fireEvent.click(screen.getByRole('button', { name: currentMode === 'hierarchy' ? 'Hierarchy' : 'Templates' }));
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)')); fireEvent.click(screen.getByTitle('Redo (Ctrl+Y)'));
    for (const [event] of h.onDocumentEdit.mock.calls.slice(1)) {
      expect(event.selection.after.selectedElementIds).toEqual([]); expect(event.preferencePatch).not.toHaveProperty('viewMode');
    }
    expect(h.onDocumentEdit.mock.calls.at(-1)![0].edit.after).toBe(edit.edit.after);
    replaceJson(h.container, raw => { raw.nodes.root.title = 'Bulk history'; });
    h.setZoom(2);
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)')); fireEvent.click(screen.getByTitle('Redo (Ctrl+Y)'));
    const bulk = h.onDocumentEdit.mock.calls.at(-1)![0];
    expect(bulk.kind).toBe('replace'); expect(bulk.state.viewMode).toBe(currentMode); expect(bulk.state.scale).toBe(2);
    expect(bulk.selection.after.selectedElementIds).toEqual([]); expect(screen.getByText('200%')).toBeInTheDocument();
  });

  it.each(['hierarchy', 'templates'] as const)('G5 switching to %s during gesture closes old cancel ownership and undo uses current selection context', mode => {
    const project = makeIncrementalProject(); project.initialState.nodes.root.type = 'page-1';
    Object.values(project.initialState.variants.default.templates).forEach((template, i) => { template.elements[0].id = `element-${i}`; });
    const h = renderIncrementalEditor(project); h.setZoom(1);
    if (mode === 'hierarchy') h.selectTemplate('page-0');
    const canvas = h.container.querySelector('.canvas-scroll-container')!;
    fireEvent.mouseDown(h.container.querySelector(`[data-element-id="element-${mode === 'hierarchy' ? 0 : 1}"]`)!, { clientX: 40, clientY: 40, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 60, clientY: 60 }); const moved = h.onDocumentEdit.mock.calls[0][0];
    fireEvent.click(screen.getByRole('button', { name: mode === 'hierarchy' ? 'Hierarchy' : 'Templates' }));
    fireEvent.pointerCancel(canvas); fireEvent.pointerCancel(h.container.querySelector('.canvas-scroll-container')!);
    expect(h.onDocumentEdit).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    const undo = h.onDocumentEdit.mock.calls[1][0]; expect(undo.edit.after).toBe(moved.edit.before);
    expect(undo.selection.after.selectedElementIds).toEqual([]); expect(undo.preferencePatch).not.toHaveProperty('viewMode');
  });

  it.each(['single', 'roundtrip'] as const)('I4 rejects reentrant Canvas geometry after %s selection change before rerender', change => {
    const project = makeIncrementalProject(); const template = project.initialState.variants.default.templates['page-0'];
    template.elements.push({ ...template.elements[0], id: 'other', x: 300, y: 400 });
    const h = renderIncrementalEditor(project); h.setZoom(1); fireEvent.click(screen.getByTitle('Layers'));
    const canvas = h.container.querySelector('.canvas-scroll-container')!;
    const other = screen.getByTestId('element-row-other'); const title = screen.getByTestId('element-row-title');
    h.onDocumentEdit.mockImplementationOnce(() => {
      fireEvent.click(other); if (change === 'roundtrip') fireEvent.click(title);
      fireEvent.mouseMove(canvas, { clientX: 90, clientY: 100 });
    });
    fireEvent.mouseDown(h.container.querySelector('[data-element-id="title"]')!, { clientX: 40, clientY: 40, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 60, clientY: 70 });
    expect(h.onDocumentEdit).toHaveBeenCalledOnce();
    const moved = h.onDocumentEdit.mock.calls[0][0];
    expect(moved.edit.after.variants.default.templates['page-0'].elements[0]).toMatchObject({ x: 32, y: 54 });
    fireEvent.mouseUp(canvas); fireEvent.pointerCancel(canvas);
    expect(h.onDocumentEdit).toHaveBeenCalledOnce();
    expect(screen.getByTestId(`element-row-${change === 'single' ? 'other' : 'title'}`)).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    expect(h.onDocumentEdit.mock.calls[1][0].edit.after).toBe(moved.edit.before);
    expect(screen.getByTitle('Undo (Ctrl+Z)')).toBeDisabled();
  });

  it.each(['end', 'cancel'] as const)('I4 stale Canvas %s cannot close another property group during reentrant delivery', ending => {
    vi.useFakeTimers();
    try {
    const project = makeIncrementalProject(); const template = project.initialState.variants.default.templates['page-0'];
    template.elements[0] = { ...template.elements[0], type: 'svg', svgContent: '<svg/>' };
    const h = renderIncrementalEditor(project); h.setZoom(1); fireEvent.click(screen.getByTitle('Layers'));
    fireEvent.click(screen.getByTestId('element-row-title'));
    const canvas = h.container.querySelector('.canvas-scroll-container')!;
    fireEvent.mouseDown(h.container.querySelector('[data-element-id="title"]')!, { clientX: 40, clientY: 40, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 60, clientY: 70 });
    const input = screen.getByTestId('svg-source-textarea'); fireEvent.focus(input);
    h.onDocumentEdit.mockImplementationOnce(() => {
      if (ending === 'end') fireEvent.mouseUp(canvas); else fireEvent.pointerCancel(canvas);
    });
    for (const n of [1, 2]) {
      fireEvent.change(input, { target: { value: `<svg><path d="M0 0L${n} ${n}"/></svg>` } });
      act(() => vi.advanceTimersByTime(400));
    }
    expect(h.onDocumentEdit).toHaveBeenCalledTimes(3);
    const [drag, first, second] = h.onDocumentEdit.mock.calls.map(([event]) => event);
    expect(first.groupId).toBe(second.groupId);
    expect(first.groupId).not.toBe(drag.groupId);
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    expect(h.onDocumentEdit.mock.calls.at(-1)![0].edit.after).toBe(drag.edit.after);
    } finally { vi.useRealTimers(); }
  });

  it.each(['drag', 'creation'] as const)('I4 fences %s before its first checkpoint on a synchronous selection roundtrip', kind => {
    const project = makeIncrementalProject(); const template = project.initialState.variants.default.templates['page-0'];
    template.elements.push({ ...template.elements[0], id: 'other', x: 300, y: 400 });
    const h = renderIncrementalEditor(project); h.setZoom(1); fireEvent.click(screen.getByTitle('Layers'));
    fireEvent.click(screen.getByTestId('element-row-title'));
    if (kind === 'creation') fireEvent.click(screen.getByTitle('Rectangle (R)'));
    const canvas = h.container.querySelector('.canvas-scroll-container')!;
    fireEvent.mouseDown(kind === 'drag' ? h.container.querySelector('[data-element-id="title"]')! : canvas,
      { clientX: 40, clientY: 40, button: 0 });
    act(() => {
      fireEvent.click(screen.getByTestId('element-row-other')); fireEvent.click(screen.getByTestId('element-row-title'));
      fireEvent.mouseMove(canvas, { clientX: 90, clientY: 100 }); fireEvent.mouseUp(canvas, { clientX: 90, clientY: 100 });
    });
    expect(h.onDocumentEdit).not.toHaveBeenCalled(); expect(screen.getByTitle('Undo (Ctrl+Z)')).toBeDisabled();
  });

  it('I4 atomic Ctrl-copy selection continuation cannot adopt a consumer selection roundtrip', () => {
    const project = makeIncrementalProject(); const template = project.initialState.variants.default.templates['page-0'];
    template.elements.push({ ...template.elements[0], id: 'other', x: 300, y: 400 });
    const h = renderIncrementalEditor(project); h.setZoom(1); fireEvent.click(screen.getByTitle('Layers'));
    fireEvent.click(screen.getByTestId('element-row-title'));
    h.onDocumentEdit.mockImplementationOnce(() => {
      fireEvent.click(screen.getByTestId('element-row-other')); fireEvent.click(screen.getByTestId('element-row-title'));
    });
    const canvas = h.container.querySelector('.canvas-scroll-container')!;
    fireEvent.mouseDown(h.container.querySelector('[data-element-id="title"]')!, { clientX: 40, clientY: 40, button: 0, ctrlKey: true });
    fireEvent.mouseMove(canvas, { clientX: 90, clientY: 100 }); fireEvent.pointerCancel(canvas);
    expect(h.onDocumentEdit).toHaveBeenCalledOnce();
    const copied = h.onDocumentEdit.mock.calls[0][0];
    expect(copied.edit.after.variants.default.templates['page-0'].elements).toHaveLength(3);
    expect(copied.selection.after.selectedElementIds).toEqual([copied.edit.after.variants.default.templates['page-0'].elements[2].id]);
    expect(screen.getByTestId('element-row-title')).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)')); expect(h.onDocumentEdit.mock.calls[1][0].edit.after).toBe(copied.edit.before);
  });

  it.each([false, true])('I4-R1 retained inline input rejects selection roundtrip after first input=%s', typed => {
    const project = makeIncrementalProject(); const template = project.initialState.variants.default.templates['page-0'];
    template.elements.push({ ...template.elements[0], id: 'other', x: 300, y: 400 });
    const h = renderIncrementalEditor(project); fireEvent.click(screen.getByTitle('Layers'));
    fireEvent.click(screen.getByTestId('element-row-title'));
    fireEvent.doubleClick(h.container.querySelector('[data-element-id="title"]')!);
    const input = screen.getByTestId('overlay-text-editor');
    if (typed) fireEvent.input(input, { target: { innerText: 'Admitted text' } });
    act(() => {
      fireEvent.click(screen.getByTestId('element-row-other')); fireEvent.click(screen.getByTestId('element-row-title'));
    });
    expect(screen.getByTestId('overlay-text-editor')).toBe(input);
    fireEvent.input(input, { target: { innerText: 'STALE AFTER ROUNDTRIP' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(h.onDocumentEdit).toHaveBeenCalledTimes(typed ? 1 : 0);
    if (typed) {
      const admitted = h.onDocumentEdit.mock.calls[0][0];
      expect(admitted.edit.after.variants.default.templates['page-0'].elements[0].text).toBe('Admitted text');
      fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
      expect(h.onDocumentEdit.mock.calls[1][0].edit.after).toBe(admitted.edit.before);
    }
    expect(screen.getByTitle('Undo (Ctrl+Z)')).toBeDisabled();
    expect(screen.getByTestId('element-row-title')).toHaveAttribute('aria-selected', 'true');
  });

  it.each(['click', 'drag'] as const)('I4-R1 %s text creation rejects consumer-invalidated inline continuation', kind => {
    const project = makeIncrementalProject(); const template = project.initialState.variants.default.templates['page-0'];
    template.elements.push({ ...template.elements[0], id: 'other', x: 300, y: 400 });
    const h = renderIncrementalEditor(project); h.setZoom(1); fireEvent.click(screen.getByTitle('Layers'));
    fireEvent.click(screen.getByTestId('element-row-title')); fireEvent.click(screen.getByTitle('Text Box (T)'));
    h.onDocumentEdit.mockImplementationOnce(() => {
      fireEvent.click(screen.getByTestId('element-row-other')); fireEvent.click(screen.getByTestId('element-row-title'));
    });
    const canvas = h.container.querySelector('.canvas-scroll-container')!;
    fireEvent.mouseDown(canvas, { clientX: 300, clientY: 300, button: 0 });
    if (kind === 'drag') fireEvent.mouseMove(canvas, { clientX: 400, clientY: 400 });
    fireEvent.mouseUp(canvas, { clientX: kind === 'drag' ? 400 : 300, clientY: kind === 'drag' ? 400 : 300 });
    const creation = h.onDocumentEdit.mock.calls[0][0];
    const created = creation.edit.after.variants.default.templates['page-0'].elements.at(-1);
    expect(creation.selection.after.selectedElementIds).toEqual([created.id]);
    expect(screen.getByTestId('element-row-title')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId(`element-row-${created.id}`)).toHaveAttribute('aria-selected', 'false');
    // Exercise the actual bad overlay if installed; a rejected handoff must not install it.
    const stale = screen.queryByTestId('overlay-text-editor');
    if (stale) fireEvent.input(stale, { target: { innerText: 'STALE NEW ELEMENT' } });
    expect(h.onDocumentEdit).toHaveBeenCalledOnce();
    expect(stale).not.toBeInTheDocument();
    expect(created.text).toBe('');
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    expect(h.onDocumentEdit.mock.calls[1][0].edit.after).toBe(creation.edit.before);
    expect(screen.getByTitle('Undo (Ctrl+Z)')).toBeDisabled();
    fireEvent.click(screen.getByTitle('Redo (Ctrl+Y)'));
    expect(h.onDocumentEdit.mock.calls[2][0].edit.after).toBe(creation.edit.after);
  });

  it.each(['existing', 'click', 'drag'] as const)('I4-R1 normal %s text types and accepts Escape with exact grouped undo redo', kind => {
    const h = renderIncrementalEditor(); h.setZoom(1); fireEvent.click(screen.getByTitle('Layers'));
    fireEvent.click(screen.getByTestId('element-row-title'));
    if (kind === 'existing') fireEvent.doubleClick(h.container.querySelector('[data-element-id="title"]')!);
    else {
      fireEvent.click(screen.getByTitle('Text Box (T)'));
      const canvas = h.container.querySelector('.canvas-scroll-container')!;
      fireEvent.mouseDown(canvas, { clientX: 300, clientY: 300, button: 0 });
      if (kind === 'drag') fireEvent.mouseMove(canvas, { clientX: 400, clientY: 400 });
      fireEvent.mouseUp(canvas, { clientX: kind === 'drag' ? 400 : 300, clientY: kind === 'drag' ? 400 : 300 });
    }
    const creation = kind === 'existing' ? undefined : h.onDocumentEdit.mock.calls[0][0];
    const input = screen.getByTestId('overlay-text-editor');
    fireEvent.input(input, { target: { innerText: 'First text' } });
    fireEvent.input(input, { target: { innerText: 'Final text' } });
    const [first, last] = h.onDocumentEdit.mock.calls.slice(-2).map(([event]) => event);
    expect(first.groupId).toBeDefined(); expect(last.groupId).toBe(first.groupId);
    expect(last.edit.after.variants.default.templates['page-0'].elements.at(-1).text).toBe('Final text');
    if (creation) {
      expect(first.groupId).not.toBe(creation.groupId);
      expect(first.edit.before).toBe(creation.edit.after);
      expect(last.selection.after.selectedElementIds).toEqual(creation.selection.after.selectedElementIds);
    }
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByTestId('overlay-text-editor')).not.toBeInTheDocument();
    expect(screen.getByTitle('Select Tool (V)').className).toContain('bg-blue-600');
    expect(h.onDocumentEdit).toHaveBeenCalledTimes(creation ? 3 : 2);
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    expect(h.onDocumentEdit.mock.calls.at(-1)![0].edit.after).toBe(first.edit.before);
    if (creation) {
      fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
      expect(h.onDocumentEdit.mock.calls.at(-1)![0].edit.after).toBe(creation.edit.before);
      expect(screen.getByTitle('Undo (Ctrl+Z)')).toBeDisabled();
      fireEvent.click(screen.getByTitle('Redo (Ctrl+Y)'));
      expect(h.onDocumentEdit.mock.calls.at(-1)![0].edit.after).toBe(creation.edit.after);
    } else expect(screen.getByTitle('Undo (Ctrl+Z)')).toBeDisabled();
    fireEvent.click(screen.getByTitle('Redo (Ctrl+Y)'));
    expect(h.onDocumentEdit.mock.calls.at(-1)![0].edit.after).toBe(last.edit.after);
  });

  it.each((['existing', 'click', 'drag'] as const).flatMap(kind =>
    [false, true].flatMap(typed => (['caret', 'contextmenu', 'selection-drag'] as const).map(route => ({ kind, typed, route }))),
  ))('I4-R2 $kind inline $route before/after first checkpoint=$typed preserves native routing and exact history', ({ kind, typed, route }) => {
    const h = renderIncrementalEditor(); h.setZoom(1); fireEvent.click(screen.getByTitle('Layers'));
    fireEvent.click(screen.getByTestId('element-row-title'));
    const canvas = h.container.querySelector('.canvas-scroll-container')!;
    if (kind === 'existing') {
      const element = h.container.querySelector('[data-element-id="title"]')!;
      for (let detail = 1; detail <= 2; detail++) {
        fireEvent.mouseDown(element, { clientX: 40, clientY: 40, button: 0, detail });
        fireEvent.mouseUp(element, { clientX: 40, clientY: 40, button: 0, detail });
        fireEvent.click(element, { clientX: 40, clientY: 40, button: 0, detail });
      }
      fireEvent.doubleClick(element, { clientX: 40, clientY: 40, button: 0 });
    } else {
      fireEvent.click(screen.getByTitle('Text Box (T)'));
      fireEvent.mouseDown(canvas, { clientX: 300, clientY: 300, button: 0, buttons: 1 });
      if (kind === 'drag') fireEvent.mouseMove(canvas, { clientX: 400, clientY: 400, buttons: 1 });
      const end = kind === 'drag' ? 400 : 300;
      fireEvent.mouseUp(canvas, { clientX: end, clientY: end, button: 0 });
      fireEvent.click(canvas, { clientX: end, clientY: end, button: 0 });
    }
    const creation = kind === 'existing' ? undefined : h.onDocumentEdit.mock.calls[0][0];
    const id = creation ? creation.selection.after.selectedElementIds[0] : 'title';
    const input = screen.getByTestId('overlay-text-editor');
    const typeText = (text: string) => {
      // jsdom does not synchronize innerText and textContent like a browser.
      fireEvent.input(input, { target: { textContent: text, innerText: text } });
      expect(input).toHaveTextContent(text); expect(input.innerText).toBe(text);
    };
    if (typed) typeText('First text');
    const beforePointer = h.onDocumentEdit.mock.calls.length;
    const preferences = h.onPreferencesChange.mock.calls.length;
    const tool = screen.getByTitle(kind === 'existing' ? 'Select Tool (V)' : 'Text Box (T)');
    const toolClass = tool.className;
    const undoDisabled = (screen.getByTitle('Undo (Ctrl+Z)') as HTMLButtonElement).disabled;
    const point = kind === 'existing' ? 40 : 305;
    // Descendant targets must resolve to the editable surface too.
    const target = route === 'selection-drag' ? document.createElement('span') : input;
    if (target !== input) { target.textContent = input.textContent; input.replaceChildren(target); }
    if (route === 'contextmenu') {
      expect(fireEvent.contextMenu(target, { clientX: point, clientY: point, button: 2 })).toBe(true);
    } else {
      expect(fireEvent.mouseDown(target, { clientX: point, clientY: point, button: 0, buttons: 1 })).toBe(true);
      if (route === 'selection-drag') {
        // Emulate the native range, then verify bubbling does not clear it or transform artwork.
        const range = document.createRange(); range.selectNodeContents(target);
        const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
        expect(fireEvent.mouseMove(target, { clientX: point + 30, clientY: point + 10, buttons: 1 })).toBe(true);
        expect(selection.rangeCount).toBe(1); expect(selection.getRangeAt(0)).toBe(range);
      }
      expect(fireEvent.mouseUp(target, { clientX: point + (route === 'selection-drag' ? 30 : 0), clientY: point, button: 0 })).toBe(true);
      expect(fireEvent.click(target, { clientX: point, clientY: point, button: 0 })).toBe(true);
    }
    expect(screen.getByTestId('overlay-text-editor')).toBe(input);
    expect(screen.queryByTestId('select-under-menu')).not.toBeInTheDocument();
    expect(h.onDocumentEdit).toHaveBeenCalledTimes(beforePointer);
    expect(h.onPreferencesChange).toHaveBeenCalledTimes(preferences);
    expect(tool.className).toBe(toolClass);
    expect((screen.getByTitle('Undo (Ctrl+Z)') as HTMLButtonElement).disabled).toBe(undoDisabled);
    expect(screen.getByTestId(`element-row-${id}`)).toHaveAttribute('aria-selected', 'true');
    if (!typed) typeText('First text');
    typeText('Final text');
    expect(h.onDocumentEdit).toHaveBeenCalledTimes(creation ? 3 : 2);
    const [first, last] = h.onDocumentEdit.mock.calls.slice(-2).map(([event]) => event);
    expect(first.groupId).toBeDefined(); expect(last.groupId).toBe(first.groupId);
    const elementText = (state: any) => state.variants.default.templates['page-0'].elements.find((element: any) => element.id === id).text;
    expect(elementText(first.edit.after)).toBe('First text');
    expect(elementText(last.edit.after)).toBe(input.innerText);
    if (creation) {
      expect(first.groupId).not.toBe(creation.groupId); expect(first.edit.before).toBe(creation.edit.after);
      expect(last.selection.after.selectedElementIds).toEqual(creation.selection.after.selectedElementIds);
    }
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByTestId('overlay-text-editor')).not.toBeInTheDocument();
    expect(screen.getByTitle('Select Tool (V)').className).toContain('bg-blue-600');
    expect(elementText(openRawJson(h.container).raw)).toBe('Final text');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(h.onDocumentEdit).toHaveBeenCalledTimes(creation ? 3 : 2);
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    expect(h.onDocumentEdit.mock.calls.at(-1)![0].edit.after).toBe(first.edit.before);
    if (creation) {
      fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
      expect(h.onDocumentEdit.mock.calls.at(-1)![0].edit.after).toBe(creation.edit.before);
      expect(screen.getByTitle('Undo (Ctrl+Z)')).toBeDisabled();
      fireEvent.click(screen.getByTitle('Redo (Ctrl+Y)'));
      expect(h.onDocumentEdit.mock.calls.at(-1)![0].edit.after).toBe(creation.edit.after);
    } else expect(screen.getByTitle('Undo (Ctrl+Z)')).toBeDisabled();
    fireEvent.click(screen.getByTitle('Redo (Ctrl+Y)'));
    expect(h.onDocumentEdit.mock.calls.at(-1)![0].edit.after).toBe(last.edit.after);
    expect(screen.getByTitle('Redo (Ctrl+Y)')).toBeDisabled();
    expect(elementText(openRawJson(h.container).raw)).toBe('Final text');
  });

  it.each((['existing', 'click', 'drag'] as const).flatMap(kind =>
    [false, true].flatMap(typed => (['click', 'contextmenu'] as const).map(route => ({ kind, typed, route }))),
  ))('I4-R3 $kind focus-box $route before/after first checkpoint=$typed retains inline ownership', ({ kind, typed, route }) => {
    const h = renderIncrementalEditor(); h.setZoom(1); fireEvent.click(screen.getByTitle('Layers'));
    fireEvent.click(screen.getByTestId('element-row-title'));
    const canvas = h.container.querySelector('.canvas-scroll-container')!;
    if (kind === 'existing') fireEvent.doubleClick(h.container.querySelector('[data-element-id="title"]')!);
    else {
      fireEvent.click(screen.getByTitle('Text Box (T)'));
      fireEvent.mouseDown(canvas, { clientX: 300, clientY: 300, button: 0, buttons: 1 });
      if (kind === 'drag') fireEvent.mouseMove(canvas, { clientX: 400, clientY: 400, buttons: 1 });
      const end = kind === 'drag' ? 400 : 300;
      fireEvent.mouseUp(canvas, { clientX: end, clientY: end, button: 0 });
      fireEvent.click(canvas, { clientX: end, clientY: end, button: 0 });
    }
    const creation = kind === 'existing' ? undefined : h.onDocumentEdit.mock.calls[0][0];
    const id = creation ? creation.selection.after.selectedElementIds[0] : 'title';
    const input = screen.getByTestId('overlay-text-editor');
    const box = screen.getByTestId('overlay-text-editor-box');
    // Routing must work without testing attributes, on the actual blank focus area.
    input.removeAttribute('data-testid'); box.removeAttribute('data-testid');
    const typeText = (text: string) => fireEvent.input(input, { target: { textContent: text, innerText: text } });
    if (typed) typeText('First text');
    const beforePointer = h.onDocumentEdit.mock.calls.length;
    const preferences = h.onPreferencesChange.mock.calls.length;
    const tool = screen.getByTitle(kind === 'existing' ? 'Select Tool (V)' : 'Text Box (T)');
    const toolClass = tool.className;
    const undoDisabled = (screen.getByTitle('Undo (Ctrl+Z)') as HTMLButtonElement).disabled;
    const point = kind === 'existing' ? 40 : 305;
    const range = document.createRange(); range.selectNodeContents(input); range.collapse(false);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    if (route === 'contextmenu') {
      expect.soft(fireEvent.contextMenu(box, { clientX: point, clientY: point, button: 2 })).toBe(true);
    } else {
      expect.soft(fireEvent.mouseDown(box, { clientX: point, clientY: point, button: 0, buttons: 1 })).toBe(true);
      expect.soft(fireEvent.mouseUp(box, { clientX: point, clientY: point, button: 0 })).toBe(true);
      expect.soft(fireEvent.click(box, { clientX: point, clientY: point, button: 0 })).toBe(true);
    }
    expect.soft(input).toBeInTheDocument(); expect.soft(input).toHaveFocus();
    expect.soft(selection.rangeCount).toBe(1);
    expect.soft(selection.rangeCount && selection.getRangeAt(0)).toBe(range);
    expect.soft(screen.queryByTestId('select-under-menu')).not.toBeInTheDocument();
    expect.soft(h.onDocumentEdit).toHaveBeenCalledTimes(beforePointer);
    expect.soft(h.onPreferencesChange).toHaveBeenCalledTimes(preferences);
    expect.soft(tool.className).toBe(toolClass);
    expect.soft((screen.getByTitle('Undo (Ctrl+Z)') as HTMLButtonElement).disabled).toBe(undoDisabled);
    expect.soft(screen.getByTestId(`element-row-${id}`)).toHaveAttribute('aria-selected', 'true');
    if (!typed) typeText('First text');
    const finalText = 'Full final text — not a clipped display';
    typeText(finalText);
    expect(input.textContent).toBe(finalText); expect(input.innerText).toBe(finalText);
    const elementText = (state: any) => state.variants.default.templates['page-0'].elements.find((element: any) => element.id === id).text;
    const lastAdmitted = h.onDocumentEdit.mock.calls.at(-1)?.[0];
    expect.soft(lastAdmitted && elementText(lastAdmitted.edit.after)).toBe(finalText);
    expect.soft(h.onDocumentEdit).toHaveBeenCalledTimes(creation ? 3 : 2);
    fireEvent.keyDown(input, { key: 'Escape' });
    const raw = openRawJson(h.container).raw;
    expect.soft(raw.variants.default.templates['page-0'].elements).toHaveLength(creation ? 2 : 1);
    expect(elementText(raw)).toBe(finalText);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    const [first, last] = h.onDocumentEdit.mock.calls.slice(-2).map(([event]) => event);
    expect(first.groupId).toBeDefined(); expect(last.groupId).toBe(first.groupId);
    expect(elementText(first.edit.after)).toBe('First text');
    const original = first.edit.before.variants.default.templates['page-0'].elements.find((element: any) => element.id === id);
    expect(last.edit.after.variants.default.templates['page-0'].elements.find((element: any) => element.id === id))
      .toEqual({ ...original, text: finalText, ...(original.autoWidth ? { w: 25, h: 20 } : {}) });
    expect(last.selection.after.selectedElementIds).toEqual([id]);
    expect(h.onPreferencesChange).toHaveBeenCalledTimes(preferences);
    expect(h.onStateChange).not.toHaveBeenCalled(); expect(h.onNameChange).not.toHaveBeenCalled();
    expect(input).not.toBeInTheDocument();
    expect(screen.getByTitle('Select Tool (V)').className).toContain('bg-blue-600');
    if (creation) {
      expect(first.groupId).not.toBe(creation.groupId); expect(first.edit.before).toBe(creation.edit.after);
    }
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    expect(h.onDocumentEdit.mock.calls.at(-1)![0].edit.after).toBe(first.edit.before);
    if (creation) {
      fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
      expect(h.onDocumentEdit.mock.calls.at(-1)![0].edit.after).toBe(creation.edit.before);
      expect(screen.getByTitle('Undo (Ctrl+Z)')).toBeDisabled();
      fireEvent.click(screen.getByTitle('Redo (Ctrl+Y)'));
      expect(h.onDocumentEdit.mock.calls.at(-1)![0].edit.after).toBe(creation.edit.after);
    } else expect(screen.getByTitle('Undo (Ctrl+Z)')).toBeDisabled();
    fireEvent.click(screen.getByTitle('Redo (Ctrl+Y)'));
    expect(h.onDocumentEdit.mock.calls.at(-1)![0].edit.after).toBe(last.edit.after);
    expect(screen.getByTitle('Redo (Ctrl+Y)')).toBeDisabled();
    expect(elementText(openRawJson(h.container).raw)).toBe(finalText);
  });

  it.each(['click', 'contextmenu'] as const)('I4-R3 legacy focus-box %s preserves visible and full JSON text', route => {
    const project = makeIncrementalProject(); const onStateChange = vi.fn();
    const h = render(<ProjectEditor projectId={project.id} projectName={project.name} initialState={project.initialState}
      isActive onStateChange={onStateChange} onNameChange={vi.fn()} onCreateGeneratedProject={vi.fn(async () => true)}
      onSaveCustomPreset={vi.fn(async () => true)} />);
    fireEvent.click(screen.getByTitle('Layers')); fireEvent.click(screen.getByTestId('element-row-title'));
    fireEvent.doubleClick(h.container.querySelector('[data-element-id="title"]')!);
    const input = screen.getByTestId('overlay-text-editor'); const box = screen.getByTestId('overlay-text-editor-box');
    fireEvent.input(input, { target: { textContent: 'First text', innerText: 'First text' } });
    if (route === 'contextmenu') fireEvent.contextMenu(box, { clientX: 40, clientY: 40, button: 2 });
    else {
      expect(fireEvent.mouseDown(box, { clientX: 40, clientY: 40, button: 0 })).toBe(true);
      expect(fireEvent.mouseUp(box, { clientX: 40, clientY: 40, button: 0 })).toBe(true);
      expect(fireEvent.click(box, { clientX: 40, clientY: 40, button: 0 })).toBe(true);
    }
    expect(screen.getByTestId('overlay-text-editor')).toBe(input);
    const finalText = 'Full legacy text — still editable';
    fireEvent.input(input, { target: { textContent: finalText, innerText: finalText } });
    expect(input.textContent).toBe(finalText);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(openRawJson(h.container).raw.variants.default.templates['page-0'].elements[0].text).toBe(finalText);
  });

  it.each(['input', 'finish', 'escape'] as const)('I4-R1 stale inline %s cannot borrow or finish a later pointer owner', action => {
    const h = renderIncrementalEditor(); h.setZoom(1); fireEvent.click(screen.getByTitle('Layers'));
    fireEvent.click(screen.getByTestId('element-row-title'));
    fireEvent.doubleClick(h.container.querySelector('[data-element-id="title"]')!);
    const input = screen.getByTestId('overlay-text-editor');
    fireEvent.input(input, { target: { innerText: 'Admitted text' } });
    const text = h.onDocumentEdit.mock.calls[0][0];
    const canvas = h.container.querySelector('.canvas-scroll-container')!;
    fireEvent.mouseDown(h.container.querySelector('[data-element-id="title"]')!, { clientX: 40, clientY: 40, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 60, clientY: 70 });
    const first = h.onDocumentEdit.mock.calls[1][0];
    expect(screen.getByTestId('overlay-text-editor')).toBe(input);
    if (action === 'input') fireEvent.input(input, { target: { innerText: 'STALE BORROWED OWNER' } });
    else if (action === 'escape') fireEvent.keyDown(input, { key: 'Escape' });
    else fireEvent.blur(input);
    expect(h.onDocumentEdit).toHaveBeenCalledTimes(2);
    fireEvent.mouseMove(canvas, { clientX: 90, clientY: 100 }); fireEvent.mouseUp(canvas);
    expect(h.onDocumentEdit).toHaveBeenCalledTimes(3);
    const last = h.onDocumentEdit.mock.calls[2][0];
    expect(last.groupId).toBe(first.groupId); expect(last.groupId).not.toBe(text.groupId);
    expect(last.edit.after.variants.default.templates['page-0'].elements[0]).toMatchObject({ text: 'Admitted text', x: 62, y: 84 });
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    expect(h.onDocumentEdit.mock.calls.at(-1)![0].edit.after).toBe(text.edit.after);
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    expect(h.onDocumentEdit.mock.calls.at(-1)![0].edit.after).toBe(text.edit.before);
    expect(screen.getByTitle('Undo (Ctrl+Z)')).toBeDisabled();
  });

  it.each(['template', 'source'] as const)('I4-R1 retained inline callbacks reject %s replacement', change => {
    const h = renderIncrementalEditor(); fireEvent.click(screen.getByTitle('Layers'));
    fireEvent.click(screen.getByTestId('element-row-title'));
    fireEvent.doubleClick(h.container.querySelector('[data-element-id="title"]')!);
    const input = screen.getByTestId('overlay-text-editor');
    if (change === 'template') h.selectTemplate('page-1');
    else h.rerender(<ProjectEditor key="new-inline-source" {...h.props} incremental={{ ...h.incremental, source: {} }} />);
    fireEvent.input(input, { target: { innerText: 'STALE SOURCE' } }); fireEvent.blur(input);
    expect(h.onDocumentEdit).not.toHaveBeenCalled();
    expect(screen.queryByTestId('overlay-text-editor')).not.toBeInTheDocument();
    expect(screen.getByTitle('Undo (Ctrl+Z)')).toBeDisabled();
  });

  it('G5 external selection change closes pointer context instead of moving old selection', () => {
    const project = makeIncrementalProject();
    const template = project.initialState.variants.default.templates['page-0'];
    template.elements.push({ ...template.elements[0], id: 'other', x: 300, y: 400 });
    const h = renderIncrementalEditor(project); h.setZoom(1);
    fireEvent.click(screen.getByTitle('Layers'));
    const canvas = h.container.querySelector('.canvas-scroll-container')!;
    fireEvent.mouseDown(h.container.querySelector('[data-element-id="title"]')!, { clientX: 40, clientY: 40, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 60, clientY: 70 });
    expect(h.onDocumentEdit).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByTestId('element-row-other'));
    fireEvent.mouseMove(canvas, { clientX: 90, clientY: 100 });
    fireEvent.mouseUp(canvas, { clientX: 90, clientY: 100 });
    expect(h.onDocumentEdit).toHaveBeenCalledOnce();
  });

  it('G4 displays historical non-record cells safely and edits numeric-ID occurrences without normalizing raw export', () => {
    const project = makeIncrementalProject();
    const layers = [null, 7, { id: 42, name: 'Numeric layer', order: 1, visible: true, locked: false, collapsed: 'raw' },
      { id: 'layer-1', name: 'Valid layer', order: 0, visible: true, locked: false }];
    project.initialState.variants.default.templates['page-0'].layers = layers as any;
    const h = renderIncrementalEditor(project);
    fireEvent.click(screen.getByTitle('Layers'));
    const row = h.container.querySelector('[data-layer-position="2"]')! as HTMLElement;
    expect(within(row).getByText('Numeric layer')).toBeInTheDocument();
    fireEvent.click(within(row).getByTitle('Toggle lock'));
    expect(h.onDocumentEdit).toHaveBeenCalledOnce();
    const event = h.onDocumentEdit.mock.calls[0][0];
    expect(event.edit.after.variants.default.templates['page-0'].layers.slice(0, 2)).toEqual([null, 7]);
    expect(event.edit.after.variants.default.templates['page-0'].layers[2]).toMatchObject({ id: 42, locked: true });
    expect(event.correspondence.mappings).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'JSON' })); fireEvent.click(screen.getByRole('button', { name: 'Text' }));
    const raw = JSON.parse(h.container.querySelector('textarea')!.value);
    expect(raw.variants.default.templates['page-0'].layers).toEqual([null, 7, { ...layers[2] as object, locked: true }, layers[3]]);
    expect(layers[2]).toMatchObject({ locked: false, collapsed: 'raw' });
  });

  it('G4 retags selection against latest elements during a reentrant geometry checkpoint', () => {
    const project = makeIncrementalProject();
    project.initialState.variants.default.templates['page-0'].layers!.push({ id: 'destination', name: 'Destination', order: 1, visible: true, locked: false });
    const h = renderIncrementalEditor(project); fireEvent.click(screen.getByTitle('Layers'));
    fireEvent.click(screen.getByTestId('element-row-title'));
    const move = screen.getByTestId('move-selection-select');
    h.onDocumentEdit.mockImplementationOnce(() => fireEvent.change(move, { target: { value: 'destination' } }));
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(h.onDocumentEdit).toHaveBeenCalledTimes(2);
    const [nudge, retag] = h.onDocumentEdit.mock.calls.map(([event]) => event);
    const template = retag.edit.after.variants.default.templates['page-0'];
    expect(template.elements[0]).toMatchObject({ x: 13, layerId: 'destination' });
    expect(template.layers).toBe(nudge.edit.before.variants.default.templates['page-0'].layers);
    expect(retag.correspondence.mappings).toEqual([]);
    expect(nudge.edit.after.variants.default.templates['page-0'].elements[0].layerId).not.toBe('destination');
  });

  it.each(['fields', 'traversal'] as const)('G4 merges reentrant nested grid %s intent without restoring stale siblings', kind => {
    const project = makeIncrementalProject(); const template = project.initialState.variants.default.templates['page-0'];
    const opaque = { retained: ['extension'] };
    template.elements[0] = { ...template.elements[0], type: 'grid', gridConfig: {
      sourceType: 'current', cols: 2, gapX: 4, gapY: 5, traversalPath: [{ sliceStart: 0, sliceCount: 1 }], opaque,
    } as any };
    const h = renderIncrementalEditor(project); fireEvent.click(screen.getByTitle('Layers')); fireEvent.click(screen.getByTestId('element-row-title'));
    const field = (label: string) => screen.getByText(label, { selector: 'label' }).parentElement!.querySelector('input')!;
    const first = kind === 'fields' ? field('Cols') : screen.getByPlaceholderText('Start');
    const second = kind === 'fields' ? field('Gap X') : screen.getByPlaceholderText('Count');
    h.onDocumentEdit.mockImplementationOnce(() => fireEvent.change(second, { target: { value: '9' } }));
    fireEvent.change(first, { target: { value: '3' } });
    expect(h.onDocumentEdit).toHaveBeenCalledTimes(2);
    const [one, two] = h.onDocumentEdit.mock.calls.map(([event]) => event);
    const before = one.edit.before.variants.default.templates['page-0'].elements[0].gridConfig;
    const after = two.edit.after.variants.default.templates['page-0'].elements[0].gridConfig;
    expect(after).toMatchObject(kind === 'fields' ? { cols: 3, gapX: 9, gapY: 5 } : { traversalPath: [{ sliceStart: 3, sliceCount: 9 }] });
    expect(after.opaque).toBe(before.opaque);
    expect(before).toMatchObject({ cols: 2, gapX: 4, traversalPath: [{ sliceStart: 0, sliceCount: 1 }] });
    expect(one.edit.after.variants.default.templates['page-0'].elements[0].gridConfig).toMatchObject(kind === 'fields' ? { cols: 3, gapX: 4 } : { traversalPath: [{ sliceStart: 3, sliceCount: 1 }] });
    expect(two.edit.before).toBe(one.edit.after);
  });

  it.each(['template', 'roundtrip', 'replacement'] as const)('I3 rejects rendered Properties delete after reentrant %s change', change => {
    const project = makeIncrementalProject(2); const template = project.initialState.variants.default.templates['page-0'];
    template.elements.push({ ...template.elements[0], id: 'other', x: 300 });
    project.initialState.variants.default.templates['page-1'].elements = [{ ...template.elements[0], x: 200 }];
    const h = renderIncrementalEditor(project); h.selectTemplate('page-0');
    fireEvent.click(screen.getByTitle('Layers')); fireEvent.click(screen.getByTestId('element-row-title'));
    const remove = screen.getByText('Element Properties').querySelector('button')!;
    const x = labeledInput('X');
    const other = screen.getByTestId('element-row-other'); const title = screen.getByTestId('element-row-title');
    const page = h.container.querySelector('[data-template-id="page-1"]')!;
    let apply: HTMLElement | undefined;
    if (change === 'replacement') {
      const { input, raw } = openRawJson(h.container); raw.nodes.root.title = 'Replacement';
      fireEvent.change(input, { target: { value: JSON.stringify(raw) } });
      apply = screen.getByRole('button', { name: 'Apply Changes' });
    }
    h.onDocumentEdit.mockImplementationOnce(() => {
      if (change === 'template') fireEvent.click(page);
      else if (change === 'roundtrip') { fireEvent.click(other); fireEvent.click(title); }
      else fireEvent.click(apply!);
      fireEvent.click(remove);
    });
    fireEvent.change(x, { target: { value: '25' } });
    expect(h.onDocumentEdit).toHaveBeenCalledTimes(change === 'replacement' ? 2 : 1);
    const edited = h.onDocumentEdit.mock.calls[0][0];
    expect(edited.edit.after.variants.default.templates['page-0'].elements[0].x).toBe(25);
    expect(edited.edit.after.variants.default.templates['page-1']).toBe(edited.edit.before.variants.default.templates['page-1']);
    if (change === 'replacement') {
      expect(h.onDocumentEdit.mock.calls[1][0]).toMatchObject({ kind: 'replace', state: { nodes: { root: { title: 'Replacement' } } } });
      fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    }
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    expect(h.onDocumentEdit.mock.calls.at(-1)![0].edit.after).toBe(edited.edit.before);
    expect(screen.getByTitle('Undo (Ctrl+Z)')).toBeDisabled();
  });

  it('G4 fences a reentrant same-template selection roundtrip before stale property callback', () => {
    const project = makeIncrementalProject(); const template = project.initialState.variants.default.templates['page-0'];
    template.elements.push({ ...template.elements[0], id: 'other', x: 300 });
    const h = renderIncrementalEditor(project); fireEvent.click(screen.getByTitle('Layers')); fireEvent.click(screen.getByTestId('element-row-title'));
    const x = screen.getByText('X', { selector: 'label' }).parentElement!.querySelector('input')!;
    const y = screen.getByText('Y', { selector: 'label' }).parentElement!.querySelector('input')!;
    h.onDocumentEdit.mockImplementationOnce(() => {
      fireEvent.click(screen.getByTestId('element-row-other'));
      fireEvent.click(screen.getByTestId('element-row-title'));
      fireEvent.change(y, { target: { value: '99' } });
    });
    fireEvent.change(x, { target: { value: '25' } });
    expect(h.onDocumentEdit).toHaveBeenCalledOnce();
    const event = h.onDocumentEdit.mock.calls[0][0];
    expect(event.edit.after.variants.default.templates['page-0'].elements[0]).toMatchObject({ x: 25, y: template.elements[0].y });
    expect(event.edit.after.variants.default.templates['page-0'].elements[1]).toBe(event.edit.before.variants.default.templates['page-0'].elements[1]);
  });

  it('G4 atomic duplicate selection fences stale property controls while keeping valid copied edit', () => {
    const h = renderIncrementalEditor(); fireEvent.click(screen.getByTitle('Layers')); fireEvent.click(screen.getByTestId('element-row-title'));
    const y = labeledInput('Y');
    h.onDocumentEdit.mockImplementationOnce(() => {
      fireEvent.keyDown(window, { key: 'd', ctrlKey: true });
      fireEvent.change(y, { target: { value: '99' } });
    });
    fireEvent.change(labeledInput('X'), { target: { value: '25' } });
    expect(h.onDocumentEdit).toHaveBeenCalledTimes(2);
    const duplicate = h.onDocumentEdit.mock.calls[1][0];
    expect(duplicate.edit.after.variants.default.templates['page-0'].elements.map((element: any) => [element.x, element.y])).toEqual([[25, 24], [45, 44]]);
    expect(duplicate.selection.after.selectedElementIds).toEqual([duplicate.edit.after.variants.default.templates['page-0'].elements[1].id]);
  });

  it('G4 reentrant unlinked padding edits preserve latest sides and nested extensions on every selected text', () => {
    const project = makeIncrementalProject(); const template = project.initialState.variants.default.templates['page-0'];
    template.elements = [0, 1].map(i => ({ ...template.elements[0], id: `text-${i}`, textPadding: {
      top: i, right: 2, bottom: 3, left: 4, opaque: { source: i },
    } as any }));
    const h = renderIncrementalEditor(project); fireEvent.click(screen.getByTitle('Layers'));
    template.elements.forEach((element, i) => fireEvent.click(screen.getByTestId(`element-row-${element.id}`), { ctrlKey: i > 0 }));
    fireEvent.click(screen.getByLabelText('Link padding sides'));
    const right = screen.getByLabelText('Padding right');
    h.onDocumentEdit.mockImplementationOnce(() => fireEvent.change(right, { target: { value: '8' } }));
    fireEvent.change(screen.getByLabelText('Padding top'), { target: { value: '7' } });
    expect(h.onDocumentEdit).toHaveBeenCalledTimes(2);
    const [first, second] = h.onDocumentEdit.mock.calls.map(([event]) => event);
    second.edit.after.variants.default.templates['page-0'].elements.forEach((element: any, i: number) => {
      expect(element.textPadding).toEqual({ top: 7, right: 8, bottom: 3, left: 4, opaque: { source: i } });
      expect(element.textPadding.opaque).toBe(first.edit.before.variants.default.templates['page-0'].elements[i].textPadding.opaque);
    });
    expect(first.edit.after.variants.default.templates['page-0'].elements[0].textPadding.right).toBe(2);
  });

  it('G4 reentrant border-side edits and removal merge only touched side fields', () => {
    const project = makeIncrementalProject(); const element = project.initialState.variants.default.templates['page-0'].elements[0];
    element.borderSides = { top: { width: 1, color: '#000000', style: 'solid' }, right: { width: 2, color: '#000000', style: 'solid' } };
    const h = renderIncrementalEditor(project); fireEvent.click(screen.getByTitle('Layers')); fireEvent.click(screen.getByTestId('element-row-title'));
    const width = screen.getByTitle('top border').parentElement!.querySelector('input[type="number"]')!;
    const right = screen.getByTitle('right border');
    h.onDocumentEdit.mockImplementationOnce(() => fireEvent.click(right));
    fireEvent.change(width, { target: { value: '7' } });
    expect(h.onDocumentEdit).toHaveBeenCalledTimes(2);
    const [first, second] = h.onDocumentEdit.mock.calls.map(([event]) => event);
    expect(second.edit.after.variants.default.templates['page-0'].elements[0].borderSides).toEqual({ top: { width: 7, color: '#000000', style: 'solid' } });
    expect(first.edit.after.variants.default.templates['page-0'].elements[0].borderSides.right.width).toBe(2);
    expect(first.edit.before.variants.default.templates['page-0'].elements[0].borderSides.top.width).toBe(1);
  });

  it('G4 grouped real property families update exact fields with immutable prior payloads and explicit delete', () => {
    const h = renderIncrementalEditor(); fireEvent.click(screen.getByTitle('Layers')); fireEvent.click(screen.getByTestId('element-row-title'));
    const set = (label: string, value: string) => fireEvent.change(labeledInput(label), { target: { value } });
    for (const [label, value] of [['X', '25'], ['Y', '30'], ['W', '140'], ['H', '55'], ['Rot', '12'], ['Z-Index', '9'], ['Radius', '6'], ['Opacity', '0.5']]) set(label, value);
    fireEvent.click(screen.getByTitle('Bring Forward')); fireEvent.click(screen.getByTitle('Send Backward'));
    const appearance = screen.getByTestId('appearance-section');
    fireEvent.input(appearance.querySelectorAll('input[type="color"]')[0], { target: { value: '#ff0000' } });
    fireEvent.input(appearance.querySelectorAll('input[type="color"]')[1], { target: { value: '#00ff00' } });
    fireEvent.change(screen.getByPlaceholderText('Text content or {{field}}'), { target: { value: 'Typed content' } });
    fireEvent.click(screen.getByLabelText('Auto width'));
    const changed = h.onDocumentEdit.mock.calls.at(-1)![0]; const element = changed.edit.after.variants.default.templates['page-0'].elements[0];
    expect(element).toMatchObject({ x: 25, y: 30, rotation: 12, zIndex: 9, borderRadius: 6, opacity: .5, fill: '#ff0000', stroke: '#00ff00', text: 'Typed content', autoWidth: true });
    expect(element.w).toBeGreaterThan(0); expect(element.h).toBeGreaterThan(0);
    expect(h.onDocumentEdit.mock.calls[0][0].edit.after.variants.default.templates['page-0'].elements[0]).toMatchObject({ x: 25, y: 24 });
    fireEvent.click(screen.getByText('Element Properties').querySelector('button')!);
    const deleted = h.onDocumentEdit.mock.calls.at(-1)![0]; expect(deleted.edit.after.variants.default.templates['page-0'].elements).toEqual([]);
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)')); expect(h.onDocumentEdit.mock.calls.at(-1)![0].edit.after).toBe(deleted.edit.before);
  });

  it('G4 typography appearance patterns interaction and multi-geometry controls emit bounded field patches', () => {
    const project = makeIncrementalProject(); const template = project.initialState.variants.default.templates['page-0'];
    template.elements.push({ ...template.elements[0], id: 'second', x: 200 });
    const h = renderIncrementalEditor(project); fireEvent.click(screen.getByTitle('Layers')); fireEvent.click(screen.getByTestId('element-row-title'));
    const typography = screen.getByTestId('typography-section');
    fireEvent.change(within(typography).getByLabelText('Overflow'), { target: { value: 'ellipsis' } });
    fireEvent.click(within(typography).getByLabelText('Wrap'));
    fireEvent.click(within(typography).getByTitle('Align Right')); fireEvent.click(within(typography).getByTitle('Align Bottom'));
    fireEvent.click(typography.querySelector('.lucide-bold')!.closest('button')!);
    fireEvent.click(typography.querySelector('.lucide-italic')!.closest('button')!);
    fireEvent.click(typography.querySelector('.lucide-underline')!.closest('button')!);
    const appearance = screen.getByTestId('appearance-section');
    fireEvent.change(appearance.querySelector('select')!, { target: { value: 'pattern' } });
    const pattern = within(appearance).getByRole('option', { name: 'Dots' }).parentElement!;
    fireEvent.change(pattern, { target: { value: 'dots' } });
    fireEvent.change(labeledInput('Gap'), { target: { value: '15' } }); fireEvent.change(labeledInput('Weight'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Customize' })); fireEvent.click(screen.getByRole('button', { name: 'Reset to uniform' }));
    fireEvent.change(screen.getByText('On Click').parentElement!.querySelector('select')!, { target: { value: 'url' } });
    fireEvent.change(labeledInput('URL'), { target: { value: 'https://example.test/page' } });
    const styled = h.onDocumentEdit.mock.calls.at(-1)![0];
    expect(styled.edit.after.variants.default.templates['page-0'].elements[0]).toMatchObject({
      textOverflow: 'ellipsis', textWrap: false, align: 'right', verticalAlign: 'bottom', fontWeight: 'bold', fontStyle: 'italic',
      textDecoration: 'underline', fillType: 'pattern', patternType: 'dots', patternSpacing: 15, patternWeight: 2,
      borderSides: undefined, linkTarget: 'url', linkValue: 'https://example.test/page',
    });
    fireEvent.click(screen.getByTestId('element-row-second'), { ctrlKey: true });
    fireEvent.change(labeledInput('W'), { target: { value: '180' } });
    const multi = h.onDocumentEdit.mock.calls.at(-1)![0];
    expect(multi.edit.changes).toHaveLength(1); expect(multi.edit.after.variants.default.templates['page-0'].elements.map((element: any) => element.w)).toEqual([180, 180]);
    expect(multi.edit.after.variants.default.templates['page-0'].elements[1].x).toBe(200);
    expect(styled.edit.after.variants.default.templates['page-0'].elements[1]).toBe(styled.edit.before.variants.default.templates['page-0'].elements[1]);
  });

  it('G4 grid subset display source and styling families retain untouched traversal and opaque fields', () => {
    const project = makeIncrementalProject(); const element = project.initialState.variants.default.templates['page-0'].elements[0];
    element.type = 'grid'; element.gridConfig = { sourceType: 'current', cols: 2, gapX: 4, gapY: 5, traversalPath: [{ sliceStart: 1 }], opaque: { retained: true } } as any;
    const h = renderIncrementalEditor(project); fireEvent.click(screen.getByTitle('Layers')); fireEvent.click(screen.getByTestId('element-row-title'));
    fireEvent.change(labeledInput('Gap Y'), { target: { value: '8' } });
    fireEvent.change(screen.getByPlaceholderText('Start (0)'), { target: { value: '2' } });
    fireEvent.change(screen.getByPlaceholderText('Count (All)'), { target: { value: '4' } });
    const grid = screen.getByTestId('grid-configuration-section');
    fireEvent.change(labeledInput('Display Template'), { target: { value: '{{title}} / {{label}}' } });
    fireEvent.change(within(grid).getByRole('option', { name: 'Children of Specific Page...' }).parentElement!, { target: { value: 'specific' } });
    const event = h.onDocumentEdit.mock.calls.at(-1)![0]; const before = event.edit.before.variants.default.templates['page-0'].elements[0].gridConfig;
    const after = event.edit.after.variants.default.templates['page-0'].elements[0].gridConfig;
    expect(after).toMatchObject({ gapY: 8, dataSliceStart: 2, dataSliceCount: 4, displayField: '{{title}} / {{label}}', sourceType: 'specific' });
    expect(after.traversalPath).toBe(before.traversalPath); expect(after.opaque).toBe(before.opaque);
  });

  it('G4 repeated reentrant fold intent is a no-op without clearing redo or writing display booleans', () => {
    const h = renderIncrementalEditor(); renameRoot(h.container, 'Checkpoint'); fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    fireEvent.click(screen.getByTitle('Layers')); h.onDocumentEdit.mockClear(); h.onPreferencesChange.mockClear();
    const fold = screen.getByTitle('Collapse layer'); h.onPreferencesChange.mockImplementationOnce(() => fireEvent.click(fold));
    fireEvent.click(fold);
    expect(h.onPreferencesChange).toHaveBeenCalledOnce(); expect(h.onDocumentEdit).not.toHaveBeenCalled();
    expect(fold.querySelector('.lucide-chevron-right')).not.toBeNull(); expect(screen.getByTitle('Redo (Ctrl+Y)')).not.toBeDisabled();
  });

  it('G5 latest unrelated property survives a reentrant Canvas geometry callback', () => {
    const h = renderIncrementalEditor(); h.setZoom(1); fireEvent.click(screen.getByTitle('Layers')); fireEvent.click(screen.getByTestId('element-row-title'));
    const opacity = labeledInput('Opacity');
    h.onDocumentEdit.mockImplementationOnce(() => fireEvent.change(opacity, { target: { value: '0.5' } }));
    const canvas = h.container.querySelector('.canvas-scroll-container')!;
    fireEvent.mouseDown(h.container.querySelector('[data-element-id="title"]')!, { clientX: 40, clientY: 40, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 60, clientY: 60 }); fireEvent.mouseMove(canvas, { clientX: 80, clientY: 80 }); fireEvent.mouseUp(canvas);
    const [first, property, last] = h.onDocumentEdit.mock.calls.map(([event]) => event);
    expect(last.edit.after.variants.default.templates['page-0'].elements[0]).toMatchObject({ x: 52, y: 64, opacity: .5 });
    expect(property.edit.after.variants.default.templates['page-0'].elements[0]).toMatchObject({ x: 32, y: 44, opacity: .5 });
    expect(first.edit.after.variants.default.templates['page-0'].elements[0].opacity).not.toBe(.5);
  });

  it('G5 click-text creation closes its history group and ghost cancellation creates no content', () => {
    const h = renderIncrementalEditor(); h.setZoom(1); const canvas = h.container.querySelector('.canvas-scroll-container')!;
    fireEvent.click(screen.getByTitle('Rectangle (R)')); fireEvent.mouseDown(canvas, { clientX: 200, clientY: 200, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 210, clientY: 210 }); fireEvent.keyDown(window, { key: 'Escape' });
    expect(h.onDocumentEdit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTitle('Text Box (T)')); fireEvent.mouseDown(canvas, { clientX: 300, clientY: 300, button: 0 }); fireEvent.mouseUp(canvas, { clientX: 300, clientY: 300 });
    expect(h.onDocumentEdit).toHaveBeenCalledOnce(); const created = h.onDocumentEdit.mock.calls[0][0];
    expect(created.edit.after.variants.default.templates['page-0'].elements.at(-1)).toMatchObject({ type: 'text', x: 300, y: 300 });
    expect(created.selection.after.selectedElementIds).toEqual([created.edit.after.variants.default.templates['page-0'].elements.at(-1).id]);
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)')); expect(h.onDocumentEdit.mock.calls.at(-1)![0].edit.after).toBe(created.edit.before);
  });

  it.each(['append', 'remove'] as const)('G4 traversal %s preserves a reentrant step edit rather than replaying rendered path', kind => {
    const project = makeIncrementalProject(); const template = project.initialState.variants.default.templates['page-0'];
    template.elements[0] = { ...template.elements[0], type: 'grid', gridConfig: {
      sourceType: 'current', cols: 2, gapX: 4, gapY: 5, traversalPath: [{ sliceStart: 0, sliceCount: 1 }, { sliceStart: 2, sliceCount: 3 }],
    } as any };
    const h = renderIncrementalEditor(project); fireEvent.click(screen.getByTitle('Layers')); fireEvent.click(screen.getByTestId('element-row-title'));
    const secondStep = screen.getAllByPlaceholderText('Start')[1].parentElement!.parentElement!;
    const control = kind === 'append' ? screen.getByRole('button', { name: 'Add Level' }) : secondStep.querySelector('button')!;
    h.onDocumentEdit.mockImplementationOnce(() => fireEvent.click(control));
    fireEvent.change(screen.getAllByPlaceholderText('Count')[0], { target: { value: '9' } });
    const [first, second] = h.onDocumentEdit.mock.calls.map(([event]) => event);
    expect(h.onDocumentEdit).toHaveBeenCalledTimes(2);
    const path = second.edit.after.variants.default.templates['page-0'].elements[0].gridConfig.traversalPath;
    expect(path).toHaveLength(kind === 'append' ? 3 : 1);
    expect(path[0]).toEqual({ sliceStart: 0, sliceCount: 9 });
    expect(first.edit.before.variants.default.templates['page-0'].elements[0].gridConfig.traversalPath[0].sliceCount).toBe(1);
  });

  it('G4 traversal sequence change fences stale positional step callback without retargeting another step', () => {
    const project = makeIncrementalProject(); const template = project.initialState.variants.default.templates['page-0'];
    template.elements[0] = { ...template.elements[0], type: 'grid', gridConfig: { sourceType: 'current', cols: 2, gapX: 4, gapY: 5,
      traversalPath: [1, 2, 3].map(sliceCount => ({ sliceStart: 0, sliceCount })),
    } as any };
    const h = renderIncrementalEditor(project); fireEvent.click(screen.getByTitle('Layers')); fireEvent.click(screen.getByTestId('element-row-title'));
    const counts = screen.getAllByPlaceholderText('Count');
    h.onDocumentEdit.mockImplementationOnce(() => fireEvent.change(counts[1], { target: { value: '9' } }));
    fireEvent.click(counts[0].parentElement!.parentElement!.querySelector('button')!);
    expect(h.onDocumentEdit).toHaveBeenCalledOnce();
    expect(h.onDocumentEdit.mock.calls[0][0].edit.after.variants.default.templates['page-0'].elements[0].gridConfig.traversalPath)
      .toEqual([{ sliceStart: 0, sliceCount: 2 }, { sliceStart: 0, sliceCount: 3 }]);
  });

  it('G4 mixed multi-grid edits preserve independent maps and append valid traversal intent to each live sequence', () => {
    const project = makeIncrementalProject(); const template = project.initialState.variants.default.templates['page-0'];
    template.elements = [0, 1].map(i => ({ ...template.elements[0], id: `grid-${i}`, type: 'grid', gridConfig: {
      sourceType: 'current', cols: 2 + i, gapX: 4 + i, gapY: 5, traversalPath: [{ sliceStart: i, sliceCount: i + 1 }],
    } as any }));
    const h = renderIncrementalEditor(project); fireEvent.click(screen.getByTitle('Layers'));
    template.elements.forEach((element, i) => fireEvent.click(screen.getByTestId(`element-row-${element.id}`), { ctrlKey: i > 0 }));
    fireEvent.change(labeledInput('Cols'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Level' }));
    expect(h.onDocumentEdit).toHaveBeenCalledTimes(2);
    const event = h.onDocumentEdit.mock.calls[1][0];
    event.edit.after.variants.default.templates['page-0'].elements.forEach((element: any, i: number) => {
      expect(element.gridConfig).toEqual({ sourceType: 'current', cols: 9, gapX: 4 + i, gapY: 5,
        traversalPath: [{ sliceStart: i, sliceCount: i + 1 }, { sliceStart: 0, sliceCount: undefined }] });
    });
  });

  it('G4 traversal levels and cleared data subsets stay storable JSON', () => {
    // The workspace store rejects undefined values: Add Level's open-ended count and a cleared
    // Final Data Subset box must leave the field unset rather than write undefined into it.
    const project = makeIncrementalProject(); const template = project.initialState.variants.default.templates['page-0'];
    template.elements[0] = { ...template.elements[0], type: 'grid', gridConfig: {
      sourceType: 'current', cols: 2, gapX: 4, gapY: 5, dataSliceStart: 1, dataSliceCount: 2,
    } as any };
    const h = renderIncrementalEditor(project); fireEvent.click(screen.getByTitle('Layers')); fireEvent.click(screen.getByTestId('element-row-title'));
    const grid = () => h.onDocumentEdit.mock.calls.at(-1)![0].edit.after.variants.default.templates['page-0'].elements[0].gridConfig;
    fireEvent.click(screen.getByRole('button', { name: 'Add Level' }));
    expect(grid().traversalPath).toEqual([{ sliceStart: 0 }]);
    expect(Object.hasOwn(grid().traversalPath[0], 'sliceCount')).toBe(false);
    fireEvent.change(screen.getByPlaceholderText('Count'), { target: { value: '3' } });
    fireEvent.change(screen.getByPlaceholderText('Count'), { target: { value: '' } });
    expect(Object.hasOwn(grid().traversalPath[0], 'sliceCount')).toBe(false);
    fireEvent.change(screen.getByPlaceholderText('Count (All)'), { target: { value: '' } });
    expect(Object.hasOwn(grid(), 'dataSliceCount')).toBe(false);
    expect(grid()).toMatchObject({ dataSliceStart: 1, cols: 2 });
    expect(() => canonicalStringify(grid())).not.toThrow();
  });

  it('G4 deletes one layer and retags orphans atomically preserving relative zIndex rather than array order', () => {
    const project = makeIncrementalProject(); const template = project.initialState.variants.default.templates['page-0'];
    template.layers = [{ id: 'remove', name: 'Remove', order: 1, visible: true, locked: false }, { id: 'keep', name: 'Keep', order: 0, visible: true, locked: false }];
    const element = template.elements[0];
    template.elements = [{ ...element, id: 'front', layerId: 'remove', zIndex: 20 }, { ...element, id: 'back', layerId: 'remove', zIndex: 3 }, { ...element, id: 'existing', layerId: 'keep', zIndex: 10 }];
    const h = renderIncrementalEditor(project); fireEvent.click(screen.getByTitle('Layers'));
    fireEvent.click(within(screen.getByTestId('layer-row-remove')).getByTitle('Delete layer'));
    expect(h.onDocumentEdit).toHaveBeenCalledOnce();
    const event = h.onDocumentEdit.mock.calls[0][0]; const after = event.edit.after.variants.default.templates['page-0'];
    expect(after.elements.map((item: any) => [item.id, item.layerId, item.zIndex])).toEqual([
      ['front', 'keep', 12], ['back', 'keep', 11], ['existing', 'keep', 10],
    ]);
    expect(after.elements[2]).toBe(event.edit.before.variants.default.templates['page-0'].elements[2]);
    expect(event.edit.changes).toHaveLength(1); expect(screen.getByTitle('Delete layer')).toBeDisabled();
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)')); expect(h.onDocumentEdit.mock.calls.at(-1)![0].edit.after).toBe(event.edit.before);
  });

  it.each(['grid', 'link'] as const)('G4 %s NodeSelector patches current target and cancels on element selection change', mode => {
    const project = makeIncrementalProject(); const initial = project.initialState;
    initial.nodes.child = { ...initial.nodes.root, id: 'child', title: 'Target child', parentId: 'root', children: [] }; initial.nodes.root.children = ['child'];
    const template = initial.variants.default.templates['page-0']; const original = template.elements[0];
    template.elements = [{ ...original, type: mode === 'grid' ? 'grid' : 'rect', linkTarget: 'specific_node', linkValue: '',
      ...(mode === 'grid' ? { gridConfig: { sourceType: 'specific', sourceId: '', cols: 2, gapX: 4, gapY: 5 } as any } : {}) },
      { ...original, id: 'other' }];
    const h = renderIncrementalEditor(project); fireEvent.click(screen.getByTitle('Layers')); fireEvent.click(screen.getByTestId('element-row-title'));
    const section = screen.getByTitle(mode === 'grid' ? 'Grid Configuration' : 'Interaction');
    if (section.getAttribute('aria-expanded') === 'false') fireEvent.click(section);
    fireEvent.click(screen.getByRole('button', { name: mode === 'grid' ? 'Select Page...' : 'Select Target Page...' }));
    const modal = screen.getByText('Select Source Node').closest('.max-w-lg')! as HTMLElement;
    fireEvent.click(within(modal).getByText('Target child'));
    expect(h.onDocumentEdit).toHaveBeenCalledOnce();
    const event = h.onDocumentEdit.mock.calls[0][0]; const element = event.edit.after.variants.default.templates['page-0'].elements[0];
    expect(mode === 'grid' ? element.gridConfig : element).toMatchObject(mode === 'grid' ? { sourceType: 'specific', sourceId: 'child', cols: 2, gapX: 4, gapY: 5 } : { linkTarget: 'specific_node', linkValue: 'child' });
    expect(event.edit.before.variants.default.templates['page-0'].elements[0]).toEqual(template.elements[0]);
    const targetButton = [...h.container.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Target child')!;
    fireEvent.click(targetButton);
    expect(screen.getByText('Select Source Node')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('element-row-other'));
    expect(screen.queryByText('Select Source Node')).not.toBeInTheDocument();
    expect(h.onDocumentEdit).toHaveBeenCalledOnce();
  });

  it('G4 invalidates rename color and drag state when layer sequence changes', () => {
    const h = renderIncrementalEditor(); fireEvent.click(screen.getByTitle('Layers'));
    fireEvent.click(screen.getByTitle('Add layer'));
    const row = () => h.container.querySelector('[data-layer-position="0"]')! as HTMLElement;
    fireEvent.doubleClick(within(row()).getByTestId('layer-name'));
    fireEvent.change(row().querySelector('input')!, { target: { value: 'Stale rename' } });
    fireEvent.click(within(row()).getByTitle('Layer color'));
    fireEvent.dragStart(row());
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    expect(row().querySelector('input')).toBeNull();
    expect(screen.queryByTestId('layer-color-swatch-#ef4444')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Redo (Ctrl+Y)'));
    const calls = h.onDocumentEdit.mock.calls.length;
    fireEvent.drop(h.container.querySelector('[data-layer-position="1"]')!);
    expect(h.onDocumentEdit).toHaveBeenCalledTimes(calls);
  });

  it('G4 layer rename color row-drop filter and active-layer controls preserve raw folds and ownership', () => {
    const project = makeIncrementalProject(); const template = project.initialState.variants.default.templates['page-0'];
    template.layers!.push({ id: 'target', name: 'Target', order: 1, visible: true, locked: false, collapsed: 'raw' as any });
    const h = renderIncrementalEditor(project); fireEvent.click(screen.getByTitle('Layers')); h.onPreferencesChange.mockClear();
    const target = () => screen.getByTestId('layer-row-target');
    fireEvent.doubleClick(within(target()).getByTestId('layer-name'));
    fireEvent.change(target().querySelector('input')!, { target: { value: 'Renamed' } });
    fireEvent.keyDown(target().querySelector('input')!, { key: 'Enter' });
    fireEvent.click(within(target()).getByTitle('Layer color')); fireEvent.click(screen.getByTestId('layer-color-swatch-#ef4444'));
    const color = h.onDocumentEdit.mock.calls.at(-1)![0];
    expect(color.edit.after.variants.default.templates['page-0'].layers[1]).toMatchObject({ name: 'Renamed', color: '#ef4444' });
    expect(Object.hasOwn(color.edit.after.variants.default.templates['page-0'].layers[1], 'collapsed')).toBe(false);
    expect(color.correspondence.mappings.map((mapping: any) => mapping.type)).toEqual(['continue', 'continue']);
    fireEvent.dragStart(screen.getByTestId('element-row-title')); fireEvent.drop(target());
    const drop = h.onDocumentEdit.mock.calls.at(-1)![0];
    expect(drop.edit.after.variants.default.templates['page-0'].elements[0]).toMatchObject({ layerId: 'target', x: 12, y: 24 });
    expect(drop.edit.after.variants.default.templates['page-0'].layers).toBe(color.edit.after.variants.default.templates['page-0'].layers);
    fireEvent.change(screen.getByPlaceholderText('Filter elements…'), { target: { value: 'does not match' } });
    expect(screen.queryByTestId('element-row-title')).not.toBeInTheDocument();
    fireEvent.click(within(target()).getByTestId('layer-name')); expect(target()).toHaveClass('bg-blue-50');
    expect(h.onDocumentEdit).toHaveBeenCalledTimes(3); expect(h.onPreferencesChange).not.toHaveBeenCalled();
    const { raw } = openRawJson(h.container); fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(raw.variants.default.templates['page-0'].layers[1].collapsed).toBe('raw');
    expect(color.edit.before.variants.default.templates['page-0'].layers[1]).not.toHaveProperty('color');
  });

  it.each(['template', 'variant', 'selection', 'source', 'replacement'] as const)('G5 pending SVG timer is disposed across %s boundary with reused IDs', boundary => {
    vi.useFakeTimers();
    try {
      const project = makeIncrementalProject();
      for (const template of Object.values(project.initialState.variants.default.templates)) template.elements = [{
        ...template.elements[0], id: 'same-svg', type: 'svg', svgContent: '<svg xmlns="http://www.w3.org/2000/svg"/>',
      }, { ...template.elements[0], id: 'other', type: 'rect' }];
      project.initialState.variants.other = { ...project.initialState.variants.default, id: 'other', name: 'Other' };
      const h = renderIncrementalEditor(project); h.selectTemplate('page-0'); fireEvent.click(screen.getByTitle('Layers'));
      fireEvent.click(screen.getByTestId('element-row-same-svg'));
      const input = screen.getByTestId('svg-source-textarea'); fireEvent.focus(input);
      fireEvent.change(input, { target: { value: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L5 5"/></svg>' } });
      if (boundary === 'template') h.selectTemplate('page-1');
      if (boundary === 'variant') fireEvent.change(screen.getByTitle('Default'), { target: { value: 'other' } });
      if (boundary === 'selection') fireEvent.click(screen.getByTestId('element-row-other'));
      if (boundary === 'source') h.rerender(<ProjectEditor key="new-source" {...h.props} incremental={{ ...h.incremental, source: {} }} />);
      if (boundary === 'replacement') replaceJson(h.container, raw => { raw.nodes.root.title = 'Same IDs replacement'; });
      act(() => vi.advanceTimersByTime(1000));
      expect(h.onDocumentEdit).toHaveBeenCalledTimes(boundary === 'replacement' ? 1 : 0);
      if (boundary === 'replacement') expect(h.onDocumentEdit.mock.calls[0][0].state.variants.default.templates['page-0'].elements[0].svgContent).toBe(project.initialState.variants.default.templates['page-0'].elements[0].svgContent);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('G5 same-ID bulk replacement terminates old Canvas gesture and chains consecutive replacements structural edits and folds', () => {
    const h = renderIncrementalEditor(); h.setZoom(1); fireEvent.click(screen.getByTitle('Layers'));
    const canvas = () => h.container.querySelector('.canvas-scroll-container')!;
    fireEvent.mouseDown(h.container.querySelector('[data-element-id="title"]')!, { clientX: 40, clientY: 40, button: 0 });
    fireEvent.mouseMove(canvas(), { clientX: 60, clientY: 70 });
    const moved = h.onDocumentEdit.mock.calls[0][0];
    replaceJson(h.container, raw => { raw.nodes.root.title = 'Bulk one'; raw.variants.default.templates['page-0'].elements[0].x = 99; });
    const first = h.onDocumentEdit.mock.calls[1][0];
    fireEvent.mouseMove(canvas(), { clientX: 120, clientY: 150 }); fireEvent.mouseUp(canvas());
    expect(h.onDocumentEdit).toHaveBeenCalledTimes(2); expect(first.state.variants.default.templates['page-0'].elements[0].x).toBe(99);
    replaceJson(h.container, raw => { raw.nodes.root.title = 'Bulk two'; });
    const second = h.onDocumentEdit.mock.calls[2][0];
    expect(second.foldBasis).toEqual({ type: 'after-replacement', editorGeneration: first.editorGeneration });
    if (!screen.queryByTitle('Add layer')) fireEvent.click(screen.getByTitle('Layers'));
    fireEvent.click(screen.getByTitle('Add layer')); const structure = h.onDocumentEdit.mock.calls[3][0];
    expect(structure.foldBasis).toEqual({ type: 'after-replacement', editorGeneration: second.editorGeneration });
    fireEvent.click(screen.getAllByTitle('Collapse layer')[0]);
    expect(h.onPreferencesChange.mock.calls.at(-1)![1].folds.basis).toEqual({ type: 'after-structural', editorGeneration: structure.editorGeneration });
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)')); fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    expect(h.onDocumentEdit.mock.calls.at(-1)![0]).toMatchObject({ kind: 'replace', origin: 'undo', state: { nodes: { root: { title: 'Bulk one' } } } });
    fireEvent.click(screen.getByTitle('Redo (Ctrl+Y)'));
    expect(h.onDocumentEdit.mock.calls.at(-1)![0]).toMatchObject({ kind: 'replace', origin: 'redo', state: { nodes: { root: { title: 'Bulk two' } } } });
    expect(h.onDocumentEdit.mock.calls.every(([event]) => event.source === h.incremental.source)).toBe(true);
    expect(moved.edit.after.variants.default.templates['page-0'].elements[0].x).toBe(32);
  });

  it.each(['finish', 'cancel'] as const)('G5 long gesture %s keeps current folds preferences and immutable intermediate checkpoints', ending => {
    const h = renderIncrementalEditor(); h.setZoom(1); fireEvent.click(screen.getByTitle('Layers'));
    const canvas = h.container.querySelector('.canvas-scroll-container')!;
    fireEvent.mouseDown(h.container.querySelector('[data-element-id="title"]')!, { clientX: 40, clientY: 40, button: 0 });
    for (let i = 1; i <= 12; i++) {
      fireEvent.mouseMove(canvas, { clientX: 40 + i * 2, clientY: 40 + i });
      if (i === 4) { fireEvent.click(screen.getByTitle('Collapse layer')); h.resizeSidebar(375); }
    }
    const events = h.onDocumentEdit.mock.calls.map(([event]) => event);
    expect(events).toHaveLength(12); expect(new Set(events.map(event => event.groupId)).size).toBe(1);
    events.forEach((event, i) => expect(event.edit.after.variants.default.templates['page-0'].elements[0]).toMatchObject({ x: 12 + (i + 1) * 2, y: 24 + i + 1 }));
    if (ending === 'finish') { fireEvent.mouseUp(canvas); expect(h.onDocumentEdit).toHaveBeenCalledTimes(12); fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)')); }
    else fireEvent.pointerCancel(canvas);
    const reverted = h.onDocumentEdit.mock.calls.at(-1)![0]; expect(reverted.edit.after).toBe(events[0].edit.before);
    expect(screen.getByTitle('Collapse layer').querySelector('.lucide-chevron-right')).not.toBeNull();
    expect(h.onPreferencesChange.mock.calls.at(-1)![0]).toEqual({ sidebarWidth: 375 });
    expect(reverted.preferencePatch).not.toHaveProperty('sidebarWidth');
    expect(screen.getByTitle('Undo (Ctrl+Z)')).toBeDisabled();
  });

  it('G6 real controller bounds history at 50 and drains effects without cloning inactive artwork or rebuilding reference index', () => {
    const project = makeIncrementalProject(); let armed = false;
    project.initialState.nodes.target = { ...project.initialState.nodes.root, id: 'target', title: 'Target', parentId: 'root', children: [] };
    project.initialState.nodes.root.children = ['target'];
    Object.assign(project.initialState.variants.default.templates['page-0'].elements[0], { linkTarget: 'specific_node', linkValue: 'target' });
    const inactive = project.initialState.variants.default.templates['page-1'];
    Object.defineProperty(inactive.elements[0], 'svgContent', { enumerable: true, get() { if (armed) throw new Error('inactive artwork read'); return '<svg/>'; } });
    const observeOwner = vi.spyOn(editorHook, 'useDocumentEditor');
    const h = renderIncrementalEditor(project); fireEvent.click(screen.getByTitle('Layers')); fireEvent.click(screen.getByTestId('element-row-title'));
    const rebuild = references.buildReferenceIndex;
    const build = vi.spyOn(references, 'buildReferenceIndex'); const update = vi.spyOn(references, 'updateReferenceIndex');
    const clone = vi.spyOn(globalThis, 'structuredClone'); const assemble = vi.spyOn(partition, 'assembleState');
    const snapshot = vi.spyOn(snapshots, 'snapshotDocument'); const restore = vi.spyOn(snapshots, 'restoreDocument');
    armed = true;
    h.onDocumentEdit.mockImplementation(event => {
      expect(update.mock.calls.at(-1)![1]).toBe(event.edit);
      expect(update.mock.calls.at(-1)![0]).toEqual(rebuild(event.edit.after));
    });
    for (let i = 0; i < 55; i++) fireEvent.keyDown(window, { key: 'ArrowRight' });
    const latest = h.onDocumentEdit.mock.calls.at(-1)![0];
    expect(latest.edit.after.variants.default.templates['page-0'].elements[0].x).toBe(67);
    expect(latest.edit.after.variants.default.templates['page-1']).toBe(latest.edit.before.variants.default.templates['page-1']);
    for (let i = 0; i < 50; i++) fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    expect(screen.getByTitle('Undo (Ctrl+Z)')).toBeDisabled();
    expect(h.onDocumentEdit.mock.calls.at(-1)![0].edit.after.variants.default.templates['page-0'].elements[0].x).toBe(17);
    const owner = observeOwner.mock.results.at(-1)!.value;
    expect(owner.getCurrent().effects).toEqual([]);
    expect(update.mock.calls.every(([index]) => index === update.mock.calls[0][0])).toBe(true);
    expect(build).not.toHaveBeenCalled(); expect(clone).not.toHaveBeenCalled(); expect(assemble).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled(); expect(restore).not.toHaveBeenCalled();
    armed = false;
    const cache = update.mock.calls[0][0];
    h.onDocumentEdit.mockImplementation(event => {
      if (event.kind === 'incremental') expect(update.mock.calls.at(-1)![0]).toEqual(rebuild(event.edit.after));
      else expect(build.mock.results.at(-1)!.value).toEqual(rebuild(partitionState(event.state).document));
    });
    const canvas = h.container.querySelector('.canvas-scroll-container')!;
    fireEvent.mouseDown(h.container.querySelector('[data-element-id="title"]')!, { clientX: 40, clientY: 40, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 60, clientY: 60 }); fireEvent.pointerCancel(canvas);
    expect(h.onDocumentEdit.mock.calls.at(-1)![0].origin).toBe('cancel'); expect(update.mock.calls.at(-1)![0]).toBe(cache);
    replaceJson(h.container, raw => { raw.variants.default.templates['page-0'].elements[0].linkValue = 'root'; });
    const replacement = h.onDocumentEdit.mock.calls.at(-1)![0]; expect(replacement.kind).toBe('replace');
    const replacementCache = build.mock.results.at(-1)!.value; expect(replacementCache).not.toBe(cache);
    expect([...references.affectedReferences(replacementCache, [{ kind: 'node', nodeId: 'target' }])].filter(owner => owner.kind === 'template')).toEqual([]);
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)')); fireEvent.click(screen.getByTitle('Redo (Ctrl+Y)'));
    expect(h.onDocumentEdit.mock.calls.at(-1)![0].state.variants.default.templates['page-0'].elements[0].linkValue).toBe('root');
    const rebuiltCache = build.mock.results.at(-1)!.value;
    if (!screen.queryByTestId('element-row-title')) fireEvent.click(screen.getByTitle('Layers'));
    fireEvent.click(screen.getByTestId('element-row-title')); fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(update.mock.calls.at(-1)![0]).toBe(rebuiltCache);
    expect(observeOwner.mock.results.at(-1)!.value.getCurrent().effects).toEqual([]);
  });

  it('G5 same-ID undo terminates canvas pointer ownership before later movement', () => {
    const h = renderIncrementalEditor(); h.setZoom(1);
    fireEvent.click(screen.getByTitle('Layers')); fireEvent.click(screen.getByTestId('element-row-title'));
    const canvas = () => h.container.querySelector('.canvas-scroll-container')!;
    fireEvent.mouseDown(h.container.querySelector('[data-element-id="title"]')!, { clientX: 40, clientY: 40, button: 0 });
    fireEvent.mouseMove(canvas(), { clientX: 60, clientY: 70 });
    expect(h.onDocumentEdit).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    expect(h.onDocumentEdit).toHaveBeenCalledTimes(2);
    fireEvent.mouseMove(canvas(), { clientX: 90, clientY: 100 }); fireEvent.mouseUp(canvas());
    expect(h.onDocumentEdit).toHaveBeenCalledTimes(2);
    expect(screen.getByTitle('Redo (Ctrl+Y)')).not.toBeDisabled();
  });

  it('I1 raw cells survive real reorder undo redo and export without phantom rows', async () => {
    const project = makeIncrementalProject();
    const rawArray = [1, { untouched: true }];
    const layers = [null, 'raw cell', rawArray,
      { id: 42, name: 'Numeric', order: 2, visible: true, locked: false, collapsed: undefined },
      { id: 'same', name: 'First', order: 0, visible: true, locked: false, collapsed: 'raw fold' },
      { id: 'same', name: 'Second', order: 1, visible: true, locked: false }];
    project.initialState.variants.default.templates['page-0'].layers = layers as any;
    const h = renderIncrementalEditor(project); fireEvent.click(screen.getByTitle('Layers'));
    expect(h.container.querySelectorAll('[data-layer-position]')).toHaveLength(3);
    const row = (position: number) => h.container.querySelector(`[data-layer-position="${position}"]`)!;
    fireEvent.dragStart(row(4)); fireEvent.drop(row(5));
    expect(h.onDocumentEdit).toHaveBeenCalledOnce();
    const moved = h.onDocumentEdit.mock.calls[0][0];
    const destinations = [0, 1, 2, 5, 4, 3];
    expect(moved.correspondence.mappings).toEqual(destinations.map((position, from) => ({ type: 'continue',
      from: { variantId: 'default', templateId: 'page-0', position: from },
      to: { variantId: 'default', templateId: 'page-0', position } })));
    const pdf = vi.mocked(generatePDF); pdf.mockClear(); pdf.mockResolvedValue(undefined);
    for (const phase of ['move', 'undo', 'redo']) {
      if (phase !== 'move') fireEvent.click(screen.getByTitle(phase === 'undo' ? 'Undo (Ctrl+Z)' : 'Redo (Ctrl+Y)'));
      const event = h.onDocumentEdit.mock.calls.at(-1)![0];
      const stored = event.edit.after.variants.default.templates['page-0'].layers;
      expect(stored.slice(0, 3)).toEqual([null, 'raw cell', rawArray]);
      expect(stored[2]).toBe(rawArray); expect(Array.isArray(stored[2])).toBe(true);
      expect(event.correspondence.mappings).toHaveLength(6);
      expect(h.container.querySelectorAll('[data-layer-position]')).toHaveLength(3);
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Export PDF' })));
      const exported = pdf.mock.calls.at(-1)![0].variants.default.templates['page-0'].layers!;
      expect(exported[2]).toBe(rawArray);
      const numeric = exported.find((layer: any) => layer?.id === 42)!;
      expect(Object.hasOwn(numeric, 'collapsed')).toBe(true); expect(numeric.collapsed).toBeUndefined();
      expect(exported.find((layer: any) => layer?.name === 'First')!.collapsed).toBe('raw fold');
      expect(Object.hasOwn(exported.find((layer: any) => layer?.name === 'Second')!, 'collapsed')).toBe(false);
    }
    expect(h.onDocumentEdit.mock.calls[1][0].edit.after).toBe(moved.edit.before);
    expect(h.onDocumentEdit.mock.calls[2][0].edit.after).toBe(moved.edit.after);
    expect(rawArray).toEqual([1, { untouched: true }]);
  });

  it('G4 duplicate-ID occurrence folds follow real reordering and latest choice survives undo', () => {
    const project = makeIncrementalProject();
    project.initialState.variants.default.templates['page-0'].layers = [
      { id: 'same', name: 'First', order: 0, visible: true, locked: false, collapsed: 'raw' as unknown as boolean },
      { id: 'same', name: 'Second', order: 1, visible: true, locked: false },
    ];
    const h = renderIncrementalEditor(project);
    fireEvent.click(screen.getByTitle('Layers'));
    const row = (position: number) => h.container.querySelector(`[data-layer-position="${position}"]`)! as HTMLElement;
    fireEvent.click(within(row(1)).getByTitle('Collapse layer'));
    expect(h.onPreferencesChange.mock.calls.at(-1)![1].folds.updates[0].occurrence.position).toBe(1);
    fireEvent.dragStart(row(0)); fireEvent.drop(row(1));
    expect(h.onDocumentEdit).toHaveBeenCalledOnce();
    const moved = h.onDocumentEdit.mock.calls[0][0];
    expect(moved.correspondence.mappings[0]).toMatchObject({ type: 'continue', from: { position: 0 }, to: { position: 1 } });
    fireEvent.click(within(row(1)).getByTitle('Collapse layer'));
    expect(h.onPreferencesChange.mock.calls.at(-1)![1].folds.basis).toEqual({ type: 'after-structural', editorGeneration: moved.editorGeneration });
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    expect(within(row(0)).getByTitle('Collapse layer').querySelector('.lucide-chevron-right')).not.toBeNull();
    expect(within(row(1)).getByTitle('Collapse layer').querySelector('.lucide-chevron-right')).not.toBeNull();
    expect(h.onStateChange).not.toHaveBeenCalled();
  });

  it.each(['template', 'variant'] as const)('G3 %s copy keeps independent latest folds and emits replayable directional ownership', kind => {
    const project = makeIncrementalProject(); project.initialState.variants.default.templates['page-0'].layers![0].collapsed = true;
    (project.initialState.variants.default as any).opaque = { nested: ['variant extension'] };
    const h = renderIncrementalEditor(project); h.selectTemplate('page-0'); fireEvent.click(screen.getByTitle('Layers'));
    if (kind === 'template') fireEvent.keyDown(window, { key: 'd', ctrlKey: true });
    else fireEvent.click(screen.getByTitle('Duplicate Variant'));
    const copy = h.onDocumentEdit.mock.calls[0][0];
    const copiedAt = { variantId: copy.selection.after.activeVariantId, templateId: copy.selection.after.selectedTemplateId, position: 0 };
    const sourceAt = { variantId: 'default', templateId: 'page-0', position: 0 };
    expect(copy.correspondence.mappings).toContainEqual({ type: 'copy', from: sourceAt, to: copiedAt });
    if (kind === 'variant') expect(copy.edit.after.variants[copiedAt.variantId].opaque).toBe(copy.edit.before.variants.default.opaque);
    fireEvent.click(screen.getByTitle('Collapse layer')); // copy false
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    const undo = h.onDocumentEdit.mock.calls[1][0];
    fireEvent.click(screen.getByTitle('Collapse layer')); fireEvent.click(screen.getByTitle('Collapse layer')); // source false -> true
    fireEvent.click(screen.getByTitle('Redo (Ctrl+Y)'));
    const redo = h.onDocumentEdit.mock.calls[2][0];
    expect(redo.correspondence.mappings).toContainEqual({ type: 'create', to: copiedAt, cell: { present: true, value: false } });
    const { raw } = openRawJson(h.container); fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(raw.variants[copiedAt.variantId].templates[copiedAt.templateId].layers[0].collapsed).toBe(false);
    expect(raw.variants.default.templates['page-0'].layers[0].collapsed).toBe(true);
    // Independent authoritative witness, never used to render or control the editor.
    let witness = createLayerFoldState({ ...partitionState(project.initialState), document: copy.edit.before });
    witness = setLayerCollapsed(witness, sourceAt, false).state;
    witness = reconcileLayerFolds(witness, copy.edit, copy.correspondence).after;
    expect(readLayerFoldCell(witness, copiedAt)).toEqual({ present: true, value: false }); // reads latest source, not local true
    witness = reconcileLayerFolds(witness, undo.edit, undo.correspondence).after;
    witness = setLayerCollapsed(witness, sourceAt, true).state;
    witness = reconcileLayerFolds(witness, redo.edit, redo.correspondence).after;
    expect(readLayerFoldCell(witness, sourceAt)).toEqual({ present: true, value: true });
    expect(readLayerFoldCell(witness, copiedAt)).toEqual({ present: true, value: false });
    expect(copy.edit.after).toBe(undo.edit.before); expect(redo.edit.after).toBe(copy.edit.after);
  });

  it.each(['layer', 'template', 'variant'] as const)('G3 %s delete restore toggle redo undo retains displaced choice and unrelated authoritative fold', kind => {
    const project = makeIncrementalProject(); const initial = project.initialState;
    initial.variants.default.templates['page-0'].layers = [
      { id: 'remove', name: 'Remove', order: 1, visible: true, locked: false, collapsed: 'legacy' as any },
      { id: 'keep', name: 'Keep', order: 0, visible: true, locked: false },
    ];
    initial.variants.other = { ...initial.variants.default, id: 'other', name: 'Other', templates: {
      'page-0': { ...initial.variants.default.templates['page-0'], layers: [{ id: 'other', name: 'Other layer', order: 0, visible: true, locked: false }] },
    } };
    const h = renderIncrementalEditor(project); h.selectTemplate('page-0'); fireEvent.click(screen.getByTitle('Layers'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    if (kind === 'layer') fireEvent.click(within(screen.getByTestId('layer-row-remove')).getByTitle('Delete layer'));
    else if (kind === 'template') fireEvent.click(h.container.querySelector('[data-template-id="page-0"] [title="Delete"]')!);
    else fireEvent.click(screen.getByTitle('Delete Variant'));
    const deleted = h.onDocumentEdit.mock.calls[0][0];
    fireEvent.click(screen.getByTitle('Collapse layer'));
    const unrelated = h.onPreferencesChange.mock.calls.at(-1)![1].folds.updates[0].occurrence;
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    fireEvent.click(within(screen.getByTestId('layer-row-remove')).getByTitle('Collapse layer'));
    fireEvent.click(screen.getByTitle('Redo (Ctrl+Y)')); fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    const restored = h.onDocumentEdit.mock.calls.at(-1)![0];
    expect(restored.correspondence.mappings).toContainEqual({ type: 'create', to: { variantId: 'default', templateId: 'page-0', position: 0 }, cell: { present: true, value: true } });
    const { raw } = openRawJson(h.container); fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(raw.variants.default.templates['page-0'].layers[0].collapsed).toBe(true);
    const finalUnrelated = kind === 'layer' ? { ...unrelated, position: 1 } : unrelated;
    expect(raw.variants[finalUnrelated.variantId].templates[finalUnrelated.templateId].layers[finalUnrelated.position].collapsed).toBe(true);
    let witness = createLayerFoldState({ ...partitionState(initial), document: deleted.edit.before });
    witness = reconcileLayerFolds(witness, deleted.edit, deleted.correspondence).after;
    witness = setLayerCollapsed(witness, unrelated, false).state; // newer authoritative value differs from editor
    for (const [event] of h.onDocumentEdit.mock.calls.slice(1)) witness = reconcileLayerFolds(witness, event.edit, event.correspondence).after;
    expect(readLayerFoldCell(witness, finalUnrelated)).toEqual({ present: true, value: false });
    expect(readLayerFoldCell(witness, { variantId: 'default', templateId: 'page-0', position: 0 })).toEqual({ present: true, value: true });
  });

  it.each([
    ['absent', {}], ['undefined', { collapsed: undefined }], ['string', { collapsed: 'raw' }], ['null', { collapsed: null }],
    ['object', { collapsed: { unknown: true } }], ['false', { collapsed: false }], ['true', { collapsed: true }],
  ])('G4 exceptional %s fold exports own presence and toggles only numeric occurrence amid raw array cells', async (_name, cell) => {
    const project = makeIncrementalProject(); const layers = [null, 'raw cell', [1, { untouched: true }],
      { id: 42, name: 'Numeric', order: 2, visible: true, locked: false, ...cell as object },
      { id: 'same', name: 'First', order: 1, visible: true, locked: false, collapsed: 'keep' },
      { id: 'same', name: 'Second', order: 0, visible: true, locked: false }];
    project.initialState.variants.default.templates['page-0'].layers = layers as any;
    const h = renderIncrementalEditor(project); fireEvent.click(screen.getByTitle('Layers')); h.onPreferencesChange.mockClear();
    const pdf = vi.mocked(generatePDF); pdf.mockClear(); pdf.mockResolvedValue(undefined);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Export PDF' })));
    const before = pdf.mock.calls[0][0].variants.default.templates['page-0'].layers!;
    expect(before).toEqual(layers); expect(Object.hasOwn(before[3], 'collapsed')).toBe(Object.hasOwn(cell as object, 'collapsed'));
    fireEvent.click(within(h.container.querySelector('[data-layer-position="3"]')! as HTMLElement).getByTitle('Collapse layer'));
    const expected = (cell as any).collapsed !== true;
    expect(h.onPreferencesChange).toHaveBeenCalledWith({}, expect.objectContaining({ folds: expect.objectContaining({ updates: [
      { occurrence: { variantId: 'default', templateId: 'page-0', position: 3 }, collapsed: expected },
    ] }) }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Export PDF' })));
    const after = pdf.mock.calls[1][0].variants.default.templates['page-0'].layers!;
    expect(after).toEqual(layers.map((layer, i) => i === 3 ? { ...layer as object, collapsed: expected } : layer));
    expect(before).toEqual(layers); expect(h.onDocumentEdit).not.toHaveBeenCalled();
  });

  it('G5 cancels pending SVG timer across same-ID undo even when SVG bytes and selection are unchanged', () => {
    vi.useFakeTimers();
    try {
      const h = renderIncrementalEditor();
      fireEvent.click(screen.getByTitle('SVG Tools')); fireEvent.click(screen.getByRole('button', { name: 'Insert placeholder SVG' }));
      renameRoot(h.container, 'Unrelated title');
      const input = screen.getByTestId('svg-source-textarea');
      fireEvent.focus(input); fireEvent.change(input, { target: { value: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L5 5"/></svg>' } });
      fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
      const calls = h.onDocumentEdit.mock.calls.length;
      act(() => vi.advanceTimersByTime(400));
      expect(h.onDocumentEdit).toHaveBeenCalledTimes(calls);
      expect(screen.getByTitle('Redo (Ctrl+Y)')).not.toBeDisabled();
    } finally { vi.useRealTimers(); }
  });

  it('G5 groups contiguous SVG focus commits but starts fresh after intervening content', () => {
    vi.useFakeTimers();
    try {
      const h = renderIncrementalEditor();
      fireEvent.click(screen.getByTitle('SVG Tools')); fireEvent.click(screen.getByRole('button', { name: 'Insert placeholder SVG' }));
      const input = screen.getByTestId('svg-source-textarea'); fireEvent.focus(input);
      const commit = (n: number) => {
        fireEvent.change(input, { target: { value: `<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L${n} ${n}"/></svg>` } });
        act(() => vi.advanceTimersByTime(400));
      };
      commit(1); commit(2);
      expect(h.onDocumentEdit).toHaveBeenCalledTimes(3);
      const first = h.onDocumentEdit.mock.calls[1][0], second = h.onDocumentEdit.mock.calls[2][0];
      expect(first.groupId).toBeDefined(); expect(first.groupId).toBe(second.groupId);
      renameRoot(h.container, 'Intervening content'); commit(3);
      const third = h.onDocumentEdit.mock.calls.at(-1)![0];
      expect(third.groupId).not.toBe(first.groupId);
      fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
      expect(h.onDocumentEdit.mock.calls.at(-1)![0].edit.after).toBe(third.edit.before);
    } finally { vi.useRealTimers(); }
  });

  it('G5 exports raw folds through real PDF and preset controls without editor saves', async () => {
    const project = makeIncrementalProject();
    const layer = project.initialState.variants.default.templates['page-0'].layers![0];
    layer.collapsed = { historical: 'raw' } as any;
    project.initialState.variants.other = { ...project.initialState.variants.default, id: 'other', name: 'Other' };
    const h = renderIncrementalEditor(project);
    const pdf = vi.mocked(generatePDF); pdf.mockClear(); pdf.mockResolvedValue(undefined);
    fireEvent.click(screen.getByTitle('Greyscale Export: OFF'));
    await act(async () => fireEvent.click(screen.getByTitle('Export All Variants (one PDF per variant)')));
    expect(pdf).toHaveBeenCalledTimes(2);
    expect(pdf.mock.calls.map(call => call[1].variantId)).toEqual(['default', 'other']);
    expect(pdf.mock.calls[0][1].isGreyscale).toBe(true);
    expect(pdf.mock.calls[0][0].variants.default.templates['page-0'].layers![0].collapsed).toEqual({ historical: 'raw' });
    fireEvent.click(screen.getByTitle('Save current project as a reusable preset'));
    fireEvent.change(screen.getByLabelText('Preset Name'), { target: { value: 'Raw preset' } });
    await act(async () => fireEvent.click(within(screen.getByRole('dialog', { name: 'Save As Preset' })).getByRole('button', { name: 'Save Preset' })));
    expect(h.props.onSaveCustomPreset).toHaveBeenCalledOnce();
    const payload = (h.props.onSaveCustomPreset.mock.calls[0] as unknown as [string, string, typeof h.props.initialState])[2];
    expect(payload.variants.default.templates['page-0'].layers![0].collapsed).toEqual({ historical: 'raw' });
    expect(payload.clipboard).toEqual([]); expect(payload.selectedElementIds).toEqual([]);
    expect(payload.variants.default.templates['page-0']).not.toBe(pdf.mock.calls[0][0].variants.default.templates['page-0']);
    expect(h.onDocumentEdit).not.toHaveBeenCalled(); expect(h.onPreferencesChange).not.toHaveBeenCalled();
  });

  it.each(['pdf', 'preset-false', 'preset-reject'] as const)('G5 %s export failure preserves document history form and external payload ownership', mode => {
    // Async effects are awaited below; editor/controller remains real.
    return (async () => {
      const project = makeIncrementalProject(); const initial = project.initialState;
      (initial as any).opaque = { source: ['extension'] }; initial.generator = {
        templateScript: 'return templates;', hierarchyScript: 'return hierarchy;', generatedAt: '2026-09-15T00:00:00.000Z',
      } as any;
      initial.variants.default.templates['page-0'].layers![0].collapsed = undefined;
      const h = renderIncrementalEditor(project); renameRoot(h.container, 'Unsaved before export'); const edited = h.onDocumentEdit.mock.calls[0][0];
      h.onDocumentEdit.mockClear(); h.onPreferencesChange.mockClear();
      const failure = new Error('external export failed');
      if (mode === 'pdf') {
        const pdf = vi.mocked(generatePDF); pdf.mockClear(); pdf.mockRejectedValueOnce(failure);
        const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
        const error = vi.spyOn(console, 'error');
        await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Export PDF' })));
        expect(pdf).toHaveBeenCalledOnce(); expect(alert).toHaveBeenCalledWith('Failed to export PDF'); expect(error).toHaveBeenCalledWith(failure);
        expect(screen.getByRole('button', { name: 'Export PDF' })).not.toBeDisabled();
        expect(pdf.mock.calls[0][0]).toMatchObject({ opaque: (initial as any).opaque, generator: initial.generator });
        expect(Object.hasOwn(pdf.mock.calls[0][0].variants.default.templates['page-0'].layers![0], 'collapsed')).toBe(true);
      } else {
        if (mode === 'preset-false') h.props.onSaveCustomPreset.mockResolvedValueOnce(false);
        else h.props.onSaveCustomPreset.mockRejectedValueOnce(failure);
        fireEvent.click(screen.getByTitle('Save current project as a reusable preset'));
        fireEvent.change(screen.getByLabelText('Preset Name'), { target: { value: 'Retained draft' } });
        await act(async () => fireEvent.click(within(screen.getByRole('dialog', { name: 'Save As Preset' })).getByRole('button', { name: 'Save Preset' })));
        expect(screen.getByLabelText('Preset Name')).toHaveValue('Retained draft'); expect(screen.getByRole('alert')).toBeInTheDocument();
        const payload = (h.props.onSaveCustomPreset.mock.calls[0] as any)[2];
        expect(payload).toMatchObject({ opaque: (initial as any).opaque, generator: initial.generator, clipboard: [], selectedElementIds: [] });
        expect(Object.hasOwn(payload.variants.default.templates['page-0'].layers[0], 'collapsed')).toBe(true);
        expect(payload.variants.default.templates['page-0'].elements).not.toBe(edited.edit.after.variants.default.templates['page-0'].elements);
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      }
      expect(h.onDocumentEdit).not.toHaveBeenCalled(); expect(h.onPreferencesChange).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)')); expect(h.onDocumentEdit.mock.calls[0][0].edit.after).toBe(edited.edit.before);
    })();
  });

  it('G5 real generator preview replacement retains source timestamp through undo redo with one bulk event', async () => {
    const timestamp = '2026-09-15T09:00:00.000Z';
    vi.spyOn(Date.prototype, 'toISOString').mockReturnValue(timestamp);
    const h = renderIncrementalEditor();
    const generated = { id: 'generated', name: 'Generated page', width: 500, height: 700, elements: [] };
    vi.mocked(runGeneratorSandbox).mockResolvedValue({ ok: true, value: {
      templates: { generated }, hierarchy: { rootId: 'generated-root', nodes: {
        'generated-root': { id: 'generated-root', parentId: null, title: 'Generated root', type: 'generated', children: [], data: {} },
      } },
    } });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByTitle('Generate Hierarchy via Script'));
    const templateScript = 'return generatedTemplates;'; const hierarchyScript = 'return generatedHierarchy;';
    fireEvent.change(screen.getByLabelText('Template script'), { target: { value: templateScript } });
    fireEvent.change(screen.getByLabelText('Hierarchy script'), { target: { value: hierarchyScript } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Preview' })));
    expect(h.onDocumentEdit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Replace Current Project' }));
    expect(h.onDocumentEdit).toHaveBeenCalledOnce();
    const event = h.onDocumentEdit.mock.calls[0][0];
    expect(event).toMatchObject({ kind: 'replace', linkedProjectName: { name: 'Generated root' }, source: h.incremental.source });
    expect(event.state.generator).toMatchObject({ templateScript, hierarchyScript });
    expect(Number.isFinite(Date.parse(event.state.generator.generatedAt))).toBe(true);
    expect(event.state.generator.generatedAt).toBe(timestamp);
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)')); fireEvent.click(screen.getByTitle('Redo (Ctrl+Y)'));
    expect(h.onDocumentEdit.mock.calls[1][0]).toMatchObject({ kind: 'replace', origin: 'undo' });
    expect(h.onDocumentEdit.mock.calls[2][0].state.generator).toEqual(event.state.generator);
    expect(h.onNameChange).not.toHaveBeenCalled(); expect(h.onStateChange).not.toHaveBeenCalled();
  });

  it('G5 real JSON replacement emits one bulk/root event and subsequent folds use replacement basis', () => {
    const h = renderIncrementalEditor();
    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
    fireEvent.click(screen.getByRole('button', { name: 'Text' }));
    const input = h.container.querySelector('textarea')!;
    const raw = JSON.parse(input.value);
    expect(Object.hasOwn(raw.variants.default.templates['page-0'].layers[0], 'collapsed')).toBe(false);
    raw.nodes.root.title = 'Imported title';
    raw.variants.default.templates['page-0'].layers[0].collapsed = true;
    fireEvent.change(input, { target: { value: JSON.stringify(raw) } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Changes' }));
    expect(h.onDocumentEdit).toHaveBeenCalledOnce();
    const replacement = h.onDocumentEdit.mock.calls[0][0];
    expect(replacement).toMatchObject({ kind: 'replace', linkedProjectName: { name: 'Imported title' }, source: h.incremental.source });
    fireEvent.click(screen.getByTitle('Layers'));
    fireEvent.click(screen.getByTitle('Collapse layer'));
    expect(h.onPreferencesChange.mock.calls.at(-1)![1].folds.basis).toEqual({ type: 'after-replacement', editorGeneration: replacement.editorGeneration });
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    expect(h.onDocumentEdit.mock.calls[1][0]).toMatchObject({ kind: 'replace', origin: 'undo', source: h.incremental.source });
    fireEvent.click(screen.getByTitle('Redo (Ctrl+Y)'));
    expect(h.onDocumentEdit.mock.calls[2][0]).toMatchObject({ kind: 'replace', origin: 'redo', source: h.incremental.source });
    expect(h.onNameChange).not.toHaveBeenCalled(); expect(h.onStateChange).not.toHaveBeenCalled();
  });

  it('does not report mount in StrictMode and emits one logical root/name edit', () => {
    const h = renderIncrementalEditor(makeIncrementalProject(), true);
    expect(h.onDocumentEdit).not.toHaveBeenCalled(); expect(h.onPreferencesChange).not.toHaveBeenCalled();
    const root = h.container.querySelector('[data-node-id="root"]')!;
    fireEvent.click(root.querySelector('[title="Edit Title"]')!);
    fireEvent.change(root.querySelector('input')!, { target: { value: 'Renamed root' } });
    fireEvent.keyDown(root.querySelector('input')!, { key: 'Enter' });
    expect(h.onDocumentEdit).toHaveBeenCalledOnce();
    expect(h.onDocumentEdit).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'incremental', source: h.incremental.source, editorGeneration: 11,
      linkedProjectName: { name: 'Renamed root' },
    }));
    expect(h.onStateChange).not.toHaveBeenCalled(); expect(h.onNameChange).not.toHaveBeenCalled();
  });
});

// Exact-path discovery keeps missing implementation RED an assertion failure,
// not a loader error. Once present these tests call the actual production hook.
const hooks = import.meta.glob('../../hooks/useDocumentEditor.ts', { eager: true });
async function hookModule() {
  expect(hooks['../../hooks/useDocumentEditor.ts'], 'Task 10 hook exists').toBeDefined();
  return hooks['../../hooks/useDocumentEditor.ts'] as typeof import('../../hooks/useDocumentEditor');
}

describe('incremental owner', () => {
  it('exposes current immutable snapshot to synchronous controller callbacks before React rerenders', async () => {
    const { useDocumentEditor } = await hookModule();
    const { result } = renderHook(() => useDocumentEditor(makeIncrementalProject().initialState));
    const owner = result.current;
    expect(owner).toHaveProperty('getCurrent');
    act(() => {
      owner.updateSession({ tool: 'hand' });
      expect(owner.getCurrent().session.tool).toBe('hand');
      owner.updatePreferences({ scale: 2 });
      expect(owner.getCurrent().renderState.scale).toBe(2);
    });
  });
  it('does not rehydrate serialized transient preview fields through the compatibility render spread', async () => {
    const { useDocumentEditor } = await hookModule();
    const initial = makeIncrementalProject().initialState;
    initial.templatePreviewNodeId = 'serialized-old-preview';
    const { result } = renderHook(() => useDocumentEditor(initial));
    expect(result.current.session).not.toHaveProperty('templatePreviewNodeId');
    expect(result.current.renderState).not.toHaveProperty('templatePreviewNodeId');
    expect(result.current.exportState().templatePreviewNodeId).toBe('serialized-old-preview');
  });

  it('keeps an active gesture token usable after its net-zero history entry disappears', async () => {
    const { useDocumentEditor } = await hookModule();
    const initial = makeIncrementalProject().initialState;
    const { result } = renderHook(() => useDocumentEditor(initial));
    const root = result.current.document.nodes.root;
    act(() => {
      const groupId = result.current.beginGroup();
      const put = (node: typeof root) => result.current.edit(() => ({ changes: [{ type: 'put-node', node }], mappings: [] }), { groupId });
      put({ ...root, title: 'Dragged' }); put(root);
      expect(() => put({ ...root, title: 'Dragged again' })).not.toThrow();
      result.current.cancelGroup(groupId);
    });
    expect(result.current.document.nodes.root).toBe(root);
    expect(result.current.historyStatus).toEqual({ canUndo: false, canRedo: false });
  });

  it('retains same-source readback history and rejects exhausted generations without changing references', async () => {
    const { useDocumentEditor } = await hookModule();
    const initial = makeIncrementalProject().initialState;
    const binding = { source: {}, editorGenerationFloor: Number.MAX_SAFE_INTEGER, foldStructureGeneration: 0 };
    const { result, rerender } = renderHook(({ state }) => useDocumentEditor(state, binding), { initialProps: { state: initial } });
    const original = result.current.document;
    expect(() => result.current.updatePreferences({ scale: 7 })).toThrow(/exhausted/i);
    expect(() => result.current.edit(current => ({ changes: [{ type: 'put-node', node: { ...current.document.nodes.root, title: 'Too late' } }], mappings: [] }))).toThrow(/exhausted/i);
    rerender({ state: structuredClone(initial) });
    expect(result.current.document).toBe(original); expect(result.current.effects).toEqual([]);
    expect(result.current.historyStatus.canUndo).toBe(false);
    expect(result.current.editorGeneration).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('keeps folds occurrence-only and session/navigation out of history, preserving raw absence', async () => {
    const { useDocumentEditor } = await hookModule();
    const initial = makeIncrementalProject().initialState;
    const template = initial.variants.default.templates['page-0'];
    template.layers = [
      { id: 'same', name: 'First', order: 0, visible: true, locked: false, collapsed: 'raw' as unknown as boolean },
      { id: 'same', name: 'Second', order: 1, visible: true, locked: false },
    ];
    delete initial.activeLayerId;
    const { result } = renderHook(() => useDocumentEditor(initial));
    const original = result.current.document;
    const at = { variantId: 'default', templateId: 'page-0', position: 1 };
    act(() => {
      result.current.updateSession({ tool: 'hand' });
      result.current.setLayerCollapsed(at, false);
      result.current.setLayerCollapsed(at, false);
      result.current.updatePreferences({ scale: 2 });
    });
    expect(result.current.document).toBe(original); expect(result.current.editorGeneration).toBe(2);
    expect(result.current.historyStatus).toEqual({ canUndo: false, canRedo: false });
    expect(result.current.effects[0]).toMatchObject({ type: 'preferences', event: { patch: {}, folds: {
      basis: { type: 'generation', generation: 0 }, updates: [{ occurrence: at, collapsed: false }],
    } } });
    expect(result.current.preferences.layerCollapsed).toEqual({});
    const raw = result.current.exportState();
    expect(raw.variants.default.templates['page-0'].layers!.map(layer => layer.collapsed)).toEqual(['raw', false]);
    expect(Object.hasOwn(raw, 'activeLayerId')).toBe(false);
    expect(() => result.current.updatePreferences({ layerCollapsed: {} } as never)).toThrow(/layerCollapsed/);
  });

  it('cancels one structural group with latest folds and current-viewMode selection, maintaining one live reference index', async () => {
    const { useDocumentEditor } = await hookModule();
    const initial = makeIncrementalProject().initialState;
    const template = initial.variants.default.templates['page-0'];
    template.layers = [
      { id: 'A', name: 'A', order: 0, visible: true, locked: false },
      { id: 'B', name: 'B', order: 1, visible: true, locked: false },
    ];
    const build = vi.spyOn(references, 'buildReferenceIndex');
    const update = vi.spyOn(references, 'updateReferenceIndex');
    const { result } = renderHook(() => useDocumentEditor(initial));
    const ingressBuilds = build.mock.calls.length;
    const before = result.current.document;
    const at = (position: number) => ({ variantId: 'default', templateId: 'page-0', position });
    act(() => {
      const groupId = result.current.beginGroup();
      result.current.edit(current => {
        const old = current.document.variants.default.templates['page-0'];
        return { changes: [{ type: 'put-template', variantId: 'default', template: { ...old, layers: [old.layers![1], old.layers![0]] } }],
          mappings: [{ type: 'continue', from: at(0), to: at(1) }, { type: 'continue', from: at(1), to: at(0) }] };
      }, { groupId });
      result.current.setLayerCollapsed(at(1), true);
      result.current.updatePreferences({ viewMode: 'templates', scale: 3 });
      result.current.cancelGroup(groupId);
    });
    expect(result.current.document).toBe(before);
    expect(readLayerFoldCell(result.current.foldState, at(0))).toEqual({ present: true, value: true });
    expect(result.current.preferences).toMatchObject({ scale: 3, viewMode: 'templates' });
    expect(result.current.historyStatus).toEqual({ canUndo: false, canRedo: false });
    expect(build).toHaveBeenCalledTimes(ingressBuilds); expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[0][0]).toBe(update.mock.calls[1][0]);
    expect([...update.mock.calls[1][0]]).toEqual([...references.buildReferenceIndex(before)]);
    const event = result.current.effects.at(-1)!;
    expect(event).toMatchObject({ type: 'document', event: { origin: 'cancel', foldBasis: { type: 'after-structural', editorGeneration: 1 } } });
  });

  it('binds post-bulk folds and structures to editor-only replacement dependencies without changing source', async () => {
    const { useDocumentEditor } = await hookModule();
    const initial = makeIncrementalProject().initialState;
    const replacement = makeIncrementalProject().initialState;
    replacement.nodes.root = { ...replacement.nodes.root, title: 'Replacement' };
    const source = {};
    const { result } = renderHook(() => useDocumentEditor(initial, { source, editorGenerationFloor: 20, foldStructureGeneration: 8 }));
    const at = { variantId: 'default', templateId: 'page-0', position: 0 };
    act(() => {
      result.current.replace(replacement);
      result.current.setLayerCollapsed(at, true);
      result.current.edit(current => {
        const old = current.document.variants.default.templates['page-0'];
        return { changes: [{ type: 'put-template', variantId: 'default', template: { ...old, layers: [{ ...old.layers![0], name: 'Layer renamed' }] } }],
          mappings: [{ type: 'continue', from: at, to: at }] };
      });
      result.current.setLayerCollapsed(at, false);
      result.current.replace(initial);
      result.current.replace(replacement);
      result.current.undo(); result.current.redo();
    });
    const events = result.current.effects.map(effect => effect.event);
    expect(events.map(event => event.source)).toEqual(Array(8).fill(source));
    expect(events[0]).toMatchObject({ kind: 'replace', foldBasis: { type: 'generation', generation: 8 }, linkedProjectName: { name: 'Replacement' } });
    expect(events[1]).toMatchObject({ folds: { basis: { type: 'after-replacement', editorGeneration: 21 } } });
    expect(events[2]).toMatchObject({ foldBasis: { type: 'after-replacement', editorGeneration: 21 } });
    expect(events[3]).toMatchObject({ folds: { basis: { type: 'after-structural', editorGeneration: 23 } } });
    expect(events[5]).toMatchObject({ kind: 'replace', foldBasis: { type: 'after-replacement', editorGeneration: 25 } });
    expect(events[6]).toMatchObject({ kind: 'replace', origin: 'undo', foldBasis: { type: 'after-replacement', editorGeneration: 26 } });
    expect(events[7]).toMatchObject({ kind: 'replace', origin: 'redo', foldBasis: { type: 'after-replacement', editorGeneration: 27 } });
  });

  it('rejects invalid provenance atomically and fences actions after unmount', async () => {
    const { useDocumentEditor } = await hookModule();
    const initial = makeIncrementalProject().initialState;
    const { result, unmount } = renderHook(() => useDocumentEditor(initial));
    const original = result.current.document;
    expect(() => result.current.edit(current => {
      const old = current.document.variants.default.templates['page-0'];
      return { changes: [{ type: 'put-template', variantId: 'default', template: { ...old, layers: [...old.layers!] } }], mappings: [] };
    })).toThrow(/correspondence/i);
    expect(result.current.document).toBe(original); expect(result.current.effects).toEqual([]);
    expect(result.current.editorGeneration).toBe(0); expect(result.current.historyStatus.canUndo).toBe(false);
    const stale = result.current;
    unmount();
    expect(() => stale.updatePreferences({ scale: 4 })).toThrow(/detached/i);
  });

  it('publishes synchronous edits once, preserves immutable history and never clones ordinary work', async () => {
    const { useDocumentEditor } = await hookModule();
    const initial = makeIncrementalProject().initialState;
    const binding = { source: {}, editorGenerationFloor: 5, foldStructureGeneration: 2 };
    const { result } = renderHook(() => useDocumentEditor(initial, binding), { wrapper: React.StrictMode });
    const original = result.current.document;
    const delivered = vi.fn();
    const clone = vi.spyOn(globalThis, 'structuredClone').mockImplementation(() => { throw new Error('ordinary clone'); });
    const rename = (title: string) => result.current.edit(current => ({
      changes: createEditOperations(current.document, current.preferences, current.references).updateNode('root', { title }), mappings: [],
    }));
    act(() => {
      rename('First'); rename('Second');
      result.current.drainEffects(delivered); result.current.drainEffects(delivered);
    });
    expect(delivered).toHaveBeenCalledTimes(2);
    const first = delivered.mock.calls[0][0].event;
    const second = delivered.mock.calls[1][0].event;
    expect(first.edit.before).toBe(original); expect(first.edit.after.nodes.root.title).toBe('First');
    expect(second.edit.before).toBe(first.edit.after); expect(second.editorGeneration).toBe(7);
    expect(result.current.historyStatus.canUndo).toBe(true);
    act(() => { result.current.undo(); result.current.drainEffects(delivered); });
    expect(result.current.document).toBe(first.edit.after);
    expect(delivered.mock.calls[2][0].event).toMatchObject({ origin: 'undo', editorGeneration: 8 });
    expect(clone).not.toHaveBeenCalled();
  });

  it('drains reentrant effects in generation order and marks a throwing callback attempted', async () => {
    const { useDocumentEditor } = await hookModule();
    const { result } = renderHook(() => useDocumentEditor(makeIncrementalProject().initialState));
    const generations: number[] = [];
    act(() => {
      result.current.updatePreferences({ scale: 2 });
      result.current.drainEffects(effect => {
        generations.push(effect.event.editorGeneration);
        result.current.updatePreferences({ showGrid: true });
        result.current.drainEffects(() => { throw Error('nested pump'); });
      });
    });
    expect(generations).toEqual([1, 2]);
    act(() => {
      result.current.updatePreferences({ scale: 3 });
      expect(() => result.current.drainEffects(() => { throw Error('consumer'); })).toThrow('consumer');
      result.current.drainEffects(() => { throw Error('must not replay'); });
    });
    expect(result.current.preferences.scale).toBe(3); expect(result.current.effects).toEqual([]);
  });
});
