import { useState, useSyncExternalStore } from 'react';
import type { AppState, PageTemplate } from '../types';
import type {
  DocumentChange, DocumentEdit, DocumentState, EditorDocumentMetadata, EditorEffect, EditorFoldBasis,
  EditorPreferences, EditorScalarPreferencePatch, EditorSourceBinding,
} from '../services/document/contracts';
import { applyDocumentChanges } from '../services/document/applyChanges';
import { APP_STATE_FIELD_CLASSIFICATION, assembleState, hydrateState, partitionState, resolvePreferences } from '../services/document/partition';
import { buildReferenceIndex, updateReferenceIndex, type ReferenceIndex } from '../services/document/references';
import { createLayerFoldState, isLayerCollapsed, reconcileLayerFolds, setLayerCollapsed, updateLayerFoldPreferences,
  type LayerFoldState, type LayerMapping, type LayerOccurrence } from '../services/document/layerFolds';
import { createPartitionedHistory, recordPartitionedEdit, recordPartitionedReplacement, undoPartitioned,
  redoPartitioned, cancelPartitionedGroup, finishPartitionedGroup, getPartitionedHistoryStatus,
} from '../services/document/partitionedHistory';
import type { HistorySelection } from '../services/document/history';
import { resolveActiveLayerId } from '../services/layers';

export type EditorSessionState = Pick<AppState, 'selectedNodeIds' | 'selectedTemplateIds' | 'selectedElementIds' |
  'tool' | 'showJsonModal' | 'activeLayerId' | 'showLayersPanel' | 'showNodeSelector' | 'nodeSelectorMode' |
  'editingElementId' | 'clipboard' | 'templatePreviewNodeId'>;
export interface PreparedEditorEdit {
  readonly changes: readonly DocumentChange[];
  readonly mappings: readonly LayerMapping[];
  readonly selection?: HistorySelection;
  readonly sessionPatch?: Partial<EditorSessionState>;
}
export interface EditorEditContext {
  readonly document: DocumentState;
  readonly preferences: EditorPreferences;
  readonly session: EditorSessionState;
  /** Short-lived constructor dependency, never passed to editor children/history. */
  readonly references: ReferenceIndex;
}
export interface EditorHistoryStatus { readonly canUndo: boolean; readonly canRedo: boolean; readonly openGroupId?: string }
interface EditorSnapshot {
  readonly document: DocumentState;
  readonly preferences: EditorPreferences;
  readonly session: EditorSessionState;
  readonly renderState: AppState;
  readonly currentTemplate: PageTemplate | undefined;
  readonly foldState: LayerFoldState;
  readonly historyStatus: EditorHistoryStatus;
  readonly editorGeneration: number;
  readonly effects: readonly EditorEffect[];
}
interface EditorActions {
  /** O(1), event-time read; avoids stale render closures during reentrancy. */
  getCurrent(): EditorSnapshot;
  isBusy(): boolean;
  edit(prepare: (current: EditorEditContext) => PreparedEditorEdit, options?: { readonly groupId?: string }): DocumentEdit | undefined;
  updatePreferences(patch: EditorScalarPreferencePatch): void;
  updateSession(patch: Partial<EditorSessionState>): void;
  setLayerCollapsed(occurrence: LayerOccurrence, value: boolean): void;
  beginGroup(): string;
  finishGroup(groupId: string): void;
  cancelGroup(groupId: string): void;
  undo(): void;
  redo(): void;
  replace(state: AppState): void;
  exportState(): AppState;
  drainEffects(deliver: (effect: EditorEffect) => void, throughGeneration?: number): void;
}
export interface DocumentEditor extends EditorSnapshot, EditorActions {}

const sessionKeys = Object.entries(APP_STATE_FIELD_CLASSIFICATION).filter(([, owner]) => owner === 'transient').map(([key]) => key);
const locationKeys = ['activeVariantId', 'selectedNodeId', 'selectedTemplateId'] as const;
const selectionKeys = [...locationKeys, 'selectedNodeIds', 'selectedTemplateIds', 'selectedElementIds', 'activeLayerId'] as const;
const copyOwn = <T extends object>(value: T, keys: readonly string[]) => Object.fromEntries(keys
  .filter(key => Object.hasOwn(value, key)).map(key => {
    const item = (value as Record<string, unknown>)[key];
    return [key, Array.isArray(item) ? [...item] : item];
  }));
const own = <T>(map: Record<string, T>, id: string): T | undefined => Object.hasOwn(map, id) ? map[id] : undefined;
const equalFields = (a: object, patch: object) => Object.entries(patch).every(([key, value]) =>
  Object.hasOwn(a, key) && Object.is((a as Record<string, unknown>)[key], value));
function initialSession(state: AppState, folds: LayerFoldState): EditorSessionState {
  const session = copyOwn(hydrateState(folds.parts), sessionKeys) as EditorSessionState;
  // Display/placement may resolve a fallback without changing retained raw absence.
  if (!Object.hasOwn(state, 'activeLayerId')) delete session.activeLayerId;
  return session;
}
function templateAddress(document: DocumentState, preferences: EditorPreferences) {
  const variantId = preferences.activeVariantId;
  const templateId = preferences.viewMode === 'hierarchy'
    ? own(document.nodes, preferences.selectedNodeId)?.type : preferences.selectedTemplateId;
  const variant = own(document.variants, variantId);
  const template = variant && typeof templateId === 'string' ? own(variant.templates, templateId) : undefined;
  return { variantId, templateId, template };
}
function capture(folds: LayerFoldState, session: EditorSessionState): HistorySelection {
  return copyOwn({ ...folds.parts.preferences, ...session }, selectionKeys) as HistorySelection;
}
function resolveSelection(folds: LayerFoldState, selected: HistorySelection): HistorySelection {
  const document = folds.parts.document;
  const preferences = resolvePreferences(document, { ...folds.parts.preferences,
    ...copyOwn(selected, locationKeys) });
  const template = templateAddress(document, preferences).template;
  const templates = own(document.variants, preferences.activeVariantId)?.templates ?? {};
  const result = { ...copyOwn(selected, selectionKeys), ...copyOwn(preferences, locationKeys) } as HistorySelection;
  if (Object.hasOwn(result, 'selectedNodeIds')) result.selectedNodeIds = result.selectedNodeIds.filter(id => Object.hasOwn(document.nodes, id));
  if (Object.hasOwn(result, 'selectedTemplateIds')) result.selectedTemplateIds = result.selectedTemplateIds.filter(id => Object.hasOwn(templates, id));
  if (Object.hasOwn(result, 'selectedElementIds')) {
    const ids = new Set(template?.elements.map(element => element?.id) ?? []);
    result.selectedElementIds = result.selectedElementIds.filter(id => ids.has(id));
  }
  if (Object.hasOwn(result, 'activeLayerId')) result.activeLayerId = template
    ? resolveActiveLayerId({ layers: template.layers?.filter(layer => layer && typeof layer.id === 'string') } as PageTemplate, result.activeLayerId) : '';
  return result;
}
function installSelection(folds: LayerFoldState, session: EditorSessionState, selection: HistorySelection) {
  const next = { ...session };
  for (const key of selectionKeys) if (!locationKeys.includes(key as typeof locationKeys[number]))
    delete (next as unknown as Record<string, unknown>)[key];
  Object.assign(next, copyOwn(selection, selectionKeys.filter(key => !locationKeys.includes(key as typeof locationKeys[number]))));
  return { folds: updateLayerFoldPreferences(folds, copyOwn(selection, locationKeys)), session: next };
}
function preferenceDelta(before: EditorPreferences, after: EditorPreferences): EditorScalarPreferencePatch {
  return Object.fromEntries(Object.entries(after).filter(([key, value]) => key !== 'layerCollapsed'
    && (!Object.hasOwn(before, key) || !Object.is((before as unknown as Record<string, unknown>)[key], value))));
}

/** One imperative owner; React subscribes to immutable cached snapshots only. */
function createOwner(initial: AppState, input: EditorSourceBinding) {
  const binding: EditorSourceBinding = { source: input.source, editorGenerationFloor: input.editorGenerationFloor,
    foldStructureGeneration: input.foldStructureGeneration, assertEditable: input.assertEditable,
    capturePersistenceCut: input.capturePersistenceCut, registerPersistenceDrain: input.registerPersistenceDrain, registerWorkingState: input.registerWorkingState };
  if (!binding.source || typeof binding.source !== 'object'
    || !Number.isSafeInteger(binding.editorGenerationFloor) || binding.editorGenerationFloor < 0
    || !Number.isSafeInteger(binding.foldStructureGeneration) || binding.foldStructureGeneration < 0
    || [binding.assertEditable, binding.capturePersistenceCut, binding.registerPersistenceDrain, binding.registerWorkingState].some(fn => fn !== undefined && typeof fn !== 'function')
    || binding.registerPersistenceDrain !== undefined && binding.capturePersistenceCut === undefined)
    throw Error('Invalid editor source binding.');
  let folds = createLayerFoldState(partitionState(initial));
  let session = initialSession(initial, folds);
  let history = createPartitionedHistory();
  let references = buildReferenceIndex(folds.parts.document);
  let editorGeneration = binding.editorGenerationFloor;
  let foldBasis: EditorFoldBasis = { type: 'generation', generation: binding.foldStructureGeneration };
  let effects: readonly EditorEffect[] = [];
  let draining = false;
  let activity = 0;
  let preparing = false;
  let nextGroup = 0;
  let group: { id: string; selection: HistorySelection } | undefined;
  const listeners = new Set<() => void>();
  const requireAttached = () => {
    if (!listeners.size) throw Error('Editor source is detached.');
    if (preparing) throw Error('Reentrant editor preparation is not allowed.');
  };
  const requireEditable = () => { requireAttached(); binding.assertEditable?.(); requireAttached(); };
  const nextGeneration = () => {
    if (!Number.isSafeInteger(editorGeneration + 1)) throw Error('Editor generation exhausted.');
    return editorGeneration + 1;
  };
  function snapshot(): EditorSnapshot {
    const document = folds.parts.document;
    const preferences = resolvePreferences(document, folds.parts.preferences);
    const { variantId, templateId, template } = templateAddress(document, preferences);
    // Safe display is occurrence-based; raw exception cells never enter content.
    const currentTemplate = template && { ...template, layers: template.layers?.map((layer, position) =>
      layer && typeof layer === 'object' && !Array.isArray(layer) ? { ...layer, collapsed: isLayerCollapsed(folds, { variantId, templateId: templateId!, position }) } : layer) };
    const displayPreferences = copyOwn(preferences, Object.entries(APP_STATE_FIELD_CLASSIFICATION)
      .filter(([, owner]) => owner === 'preference').map(([key]) => key));
    const renderState = { ...(folds.parts.compatibility.state as object), ...document, ...displayPreferences, ...session } as AppState;
    // Compatibility retains serialized session fields for raw export, but absent
    // live fields must not leak back through this shallow rendering projection.
    for (const key of sessionKeys) if (!Object.hasOwn(session, key)) delete (renderState as unknown as Record<string, unknown>)[key];
    return { document, preferences: folds.parts.preferences, session, foldState: folds,
      renderState,
      currentTemplate, historyStatus: getPartitionedHistoryStatus(history), editorGeneration, effects };
  }
  let current = snapshot();
  const publish = () => { current = snapshot(); listeners.forEach(listener => listener()); };
  function metadata(before: LayerFoldState, after: LayerFoldState, beforeSelection: HistorySelection,
    afterSelection: HistorySelection, origin: EditorDocumentMetadata['origin'], generation: number, groupId?: string): EditorDocumentMetadata {
    const oldRoot = before.parts.document.nodes[before.parts.document.rootId];
    const newRoot = after.parts.document.nodes[after.parts.document.rootId];
    return { source: binding.source, editorGeneration: generation, origin,
      selection: { before: beforeSelection, after: afterSelection },
      preferencePatch: preferenceDelta(before.parts.preferences, after.parts.preferences),
      ...(groupId ? { groupId } : {}),
      ...(newRoot && oldRoot?.title !== newRoot.title ? { linkedProjectName: { name: newRoot.title } } : {}) };
  }
  const enqueue = (effect: EditorEffect) => { editorGeneration = effect.event.editorGeneration; effects = [...effects, effect]; };
  function traverse(direction: 'undo' | 'redo' | 'cancel', groupId?: string) {
    requireEditable();
    if (direction === 'cancel' && group?.id === groupId && !getPartitionedHistoryStatus(history).openGroupId) {
      group = undefined; return;
    }
    const before = folds; const selected = capture(folds, session);
    const result = direction === 'undo' ? undoPartitioned(history, folds) : direction === 'redo' ? redoPartitioned(history, folds)
      : cancelPartitionedGroup(history, folds, groupId!);
    const next = result.selection ? installSelection(result.state, session, result.selection) : { folds: result.state, session };
    let event: EditorEffect | undefined;
    let newReferences = references;
    if (result.edit || result.replacement) {
      const generation = nextGeneration();
      const common = metadata(before, next.folds, selected, capture(next.folds, next.session), direction, generation, groupId);
      if (result.replacement) {
        event = { type: 'document', event: { ...common, kind: 'replace', state: assembleState(next.folds.parts), preferences: next.folds.parts.preferences, foldBasis } };
        newReferences = buildReferenceIndex(result.replacement);
      } else {
        event = { type: 'document', event: { ...common, kind: 'incremental', edit: result.edit!,
          correspondence: result.correspondence!, overlayEffects: result.overlayEffects, foldBasis } };
      }
    }
    requireEditable();
    if (result.edit && !result.replacement) updateReferenceIndex(references, result.edit);
    folds = next.folds; session = next.session; history = result.history; references = newReferences; group = undefined;
    if (event) {
      enqueue(event);
      if (result.replacement) foldBasis = { type: 'after-replacement', editorGeneration };
      else if (result.overlayEffects.length) foldBasis = { type: 'after-structural', editorGeneration };
    }
    publish();
  }
  const actions: EditorActions = {
    getCurrent: () => current,
    isBusy: () => activity > 0,
    edit(prepare, options) {
      requireEditable();
      let input: PreparedEditorEdit;
      preparing = true;
      try { input = prepare({ document: folds.parts.document, preferences: resolvePreferences(folds.parts.document, folds.parts.preferences), session, references }); }
      finally { preparing = false; }
      requireEditable();
      const edit = applyDocumentChanges(folds.parts.document, input.changes);
      const receipt = reconcileLayerFolds(folds, edit, { before: edit.before, after: edit.after, mappings: input.mappings });
      if (edit.before === edit.after) return undefined;
      const generation = nextGeneration();
      const groupId = options?.groupId;
      if (groupId && group?.id !== groupId) throw Error('Unknown editor group.');
      const beforeSelection = groupId ? group!.selection : capture(folds, session);
      const patchedSession = { ...session, ...input.sessionPatch };
      const selected = resolveSelection(receipt.after, input.selection ?? capture(receipt.after, patchedSession));
      const next = installSelection(receipt.after, patchedSession, selected);
      const nextHistory = recordPartitionedEdit(history, receipt, groupId, { before: beforeSelection, after: selected });
      const event: EditorEffect = { type: 'document', event: {
        ...metadata(folds, next.folds, beforeSelection, selected, 'edit', generation, groupId), kind: 'incremental',
        edit, correspondence: receipt.correspondence, overlayEffects: receipt.overlayEffects, foldBasis,
      } };
      requireEditable(); updateReferenceIndex(references, edit);
      folds = next.folds; session = next.session; history = nextHistory;
      // Net-zero drops the content edge, not the still-active pointer session.
      // A later move may open another contiguous edge using this same token.
      if (!groupId) group = undefined;
      enqueue(event);
      if (receipt.overlayEffects.length) foldBasis = { type: 'after-structural', editorGeneration };
      publish(); return edit;
    },
    updatePreferences(patch) {
      requireEditable();
      const next = updateLayerFoldPreferences(folds, patch);
      if (next === folds) return;
      const generation = nextGeneration();
      const actual = preferenceDelta(folds.parts.preferences, next.parts.preferences);
      requireEditable();
      folds = next; enqueue({ type: 'preferences', event: { source: binding.source, editorGeneration: generation, patch: actual } }); publish();
    },
    updateSession(patch) {
      requireEditable();
      if (Object.keys(patch).some(key => !sessionKeys.includes(key))) throw Error('Unknown editor session field.');
      if (equalFields(session, patch)) return;
      const next = { ...session, ...copyOwn(patch, sessionKeys) };
      requireEditable(); session = next; publish();
    },
    setLayerCollapsed(occurrence, value) {
      requireEditable(); const update = setLayerCollapsed(folds, occurrence, value);
      if (update.state === folds) return;
      const generation = nextGeneration();
      requireEditable();
      folds = update.state;
      enqueue({ type: 'preferences', event: { source: binding.source, editorGeneration: generation, patch: {},
        folds: { basis: foldBasis, updates: [{ occurrence: { ...occurrence }, collapsed: value }] } } }); publish();
    },
    beginGroup() {
      requireEditable();
      if (!Number.isSafeInteger(nextGroup + 1)) throw Error('Editor group counter exhausted.');
      const nextHistory = group ? finishPartitionedGroup(history, group.id) : history, selection = capture(folds, session);
      requireEditable(); history = nextHistory;
      group = { id: `editor-group-${++nextGroup}`, selection }; publish(); return group.id;
    },
    finishGroup(groupId) {
      requireEditable(); const nextHistory = finishPartitionedGroup(history, groupId);
      requireEditable(); history = nextHistory;
      if (group?.id === groupId) group = undefined; publish();
    },
    cancelGroup: groupId => traverse('cancel', groupId),
    undo: () => traverse('undo'), redo: () => traverse('redo'),
    replace(state) {
      requireEditable(); const generation = nextGeneration();
      const nextFolds = createLayerFoldState(partitionState(state));
      const nextSession = initialSession(state, nextFolds);
      const selected = resolveSelection(nextFolds, capture(nextFolds, nextSession));
      const next = installSelection(nextFolds, nextSession, selected);
      const beforeSelection = capture(folds, session);
      const nextHistory = recordPartitionedReplacement(history, folds, next.folds, { before: beforeSelection, after: selected });
      const nextReferences = buildReferenceIndex(next.folds.parts.document);
      const event: EditorEffect = { type: 'document', event: { ...metadata(folds, next.folds, beforeSelection, selected, 'edit', generation),
        kind: 'replace', state: assembleState(next.folds.parts), preferences: next.folds.parts.preferences, foldBasis } };
      requireEditable();
      folds = next.folds; session = next.session; history = nextHistory; references = nextReferences; group = undefined;
      enqueue(event); foldBasis = { type: 'after-replacement', editorGeneration }; publish();
    },
    exportState: () => assembleState(folds.parts),
    drainEffects(deliver, throughGeneration) {
      requireAttached(); if (draining) return;
      if (throughGeneration !== undefined && (!Number.isSafeInteger(throughGeneration) || throughGeneration < 0)) throw Error('Invalid editor drain generation.');
      draining = true;
      try {
        while (effects.length) {
          if (throughGeneration !== undefined && effects[0].event.editorGeneration > throughGeneration) break;
          const effect = effects[0]; effects = effects.slice(1);
          // Mark attempted before invoking an external/reentrant consumer.
          publish(); deliver(effect);
        }
      } finally { draining = false; }
    },
  };
  const duringActivity = <Args extends unknown[], Result>(action: (...args: Args) => Result) => (...args: Args): Result => {
    activity++;
    try { return action(...args); } finally { activity--; }
  };
  return { actions: { ...actions, edit: duringActivity(actions.edit), updatePreferences: duringActivity(actions.updatePreferences),
    updateSession: duringActivity(actions.updateSession), setLayerCollapsed: duringActivity(actions.setLayerCollapsed),
    beginGroup: duringActivity(actions.beginGroup), finishGroup: duringActivity(actions.finishGroup), cancelGroup: duringActivity(actions.cancelGroup),
    undo: duringActivity(actions.undo), redo: duringActivity(actions.redo), replace: duringActivity(actions.replace), drainEffects: duringActivity(actions.drainEffects) },
    getSnapshot: () => current,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    checkBinding(next?: EditorSourceBinding) {
      if (next && (next.source !== binding.source || next.editorGenerationFloor !== binding.editorGenerationFloor
        || next.foldStructureGeneration !== binding.foldStructureGeneration || next.assertEditable !== binding.assertEditable
        || next.capturePersistenceCut !== binding.capturePersistenceCut || next.registerPersistenceDrain !== binding.registerPersistenceDrain
        || next.registerWorkingState !== binding.registerWorkingState)) {
        throw Error('Editor source binding requires a remount.');
      }
    } };
}

export function useDocumentEditor(initialState: AppState, binding?: EditorSourceBinding): DocumentEditor {
  const [owner] = useState(() => createOwner(initialState, binding ?? { source: {}, editorGenerationFloor: 0, foldStructureGeneration: 0 }));
  owner.checkBinding(binding);
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  return { ...state, ...owner.actions };
}
