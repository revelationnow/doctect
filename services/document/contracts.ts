import type { AppNode, AppState, GeneratorProvenance, PageTemplate, Variant } from '../../types';
import type { HistorySelectionPair } from './history';
import type { FoldOverlayEffect, LayerCorrespondence, LayerOccurrence } from './layerFolds';

export type DocumentState = Pick<AppState,
  'nodes' | 'rootId' | 'variants' | 'schemaVersion' | 'generator'>;

export type EditorPreferences = Pick<AppState,
  'activeVariantId' | 'selectedNodeId' | 'selectedTemplateId' | 'scale'
  | 'viewMode' | 'sidebarWidth' | 'propertiesPanelWidth'
  | 'snapToGrid' | 'showGrid'> & {
    layerCollapsed: Readonly<Record<string, boolean>>;
    panelsExpanded: Readonly<Record<string, boolean>>;
  };

export interface PartitionedState {
  document: DocumentState;
  preferences: EditorPreferences;
  compatibility: Readonly<Record<string, unknown>>;
}

export type RecordAddress =
  | { kind: 'node'; nodeId: string }
  | { kind: 'variant'; variantId: string }
  | { kind: 'template'; variantId: string; templateId: string }
  | { kind: 'root' }
  | { kind: 'generator' };

export type DocumentChange =
  | { type: 'put-node'; node: AppNode }
  | { type: 'delete-node'; nodeId: string }
  | { type: 'put-variant'; variant: Omit<Variant, 'templates'> }
  | { type: 'delete-variant'; variantId: string }
  | { type: 'put-template'; variantId: string; template: PageTemplate }
  | { type: 'delete-template'; variantId: string; templateId: string }
  | { type: 'set-root'; rootId: string }
  | { type: 'set-generator'; generator: GeneratorProvenance | undefined };

export interface DocumentEdit {
  before: DocumentState;
  after: DocumentState;
  changes: readonly DocumentChange[];
  affected: readonly RecordAddress[];
}

/** Editor dependencies are not private durable authority/revision guesses. */
export type EditorFoldBasis =
  | { readonly type: 'generation'; readonly generation: number }
  | { readonly type: 'after-structural'; readonly editorGeneration: number }
  // Resolved through the ordered replacement segment, never a guessed revision.
  | { readonly type: 'after-replacement'; readonly editorGeneration: number };

export interface EditorPersistenceDrain {
  generation(): number;
  isBusy?(): boolean;
  drainThrough(editorGeneration: number): Promise<boolean>;
}
export interface EditorWorkingState {
  exportState(): AppState;
  replace(state: AppState): void;
  generation(): number;
}
export interface EditorSourceBinding {
  readonly source: object;
  readonly editorGenerationFloor: number;
  readonly foldStructureGeneration: number;
  readonly assertEditable?: () => void;
  readonly capturePersistenceCut?: (editorGeneration: number) => Promise<boolean>;
  readonly registerPersistenceDrain?: (handle: EditorPersistenceDrain) => () => void;
  readonly registerWorkingState?: (handle: EditorWorkingState) => () => void;
}
export type EditorScalarPreferencePatch = Partial<Omit<EditorPreferences, 'layerCollapsed'>>;
export interface EditorEventIdentity { readonly source: object; readonly editorGeneration: number }
export interface EditorDocumentMetadata extends EditorEventIdentity {
  readonly origin: 'edit' | 'undo' | 'redo' | 'cancel';
  readonly selection: HistorySelectionPair;
  readonly preferencePatch: EditorScalarPreferencePatch;
  readonly groupId?: string;
  /** Root content and linked wrapper name must be admitted atomically by Task 12. */
  readonly linkedProjectName?: { readonly name: string };
}
export type EditorDocumentEvent = EditorDocumentMetadata & (
  | { readonly kind: 'incremental'; readonly edit: DocumentEdit;
      readonly correspondence: LayerCorrespondence; readonly foldBasis: EditorFoldBasis;
      /** Local receipt only. Never overwrite durable folds with this snapshot. */
      readonly overlayEffects: readonly FoldOverlayEffect[] }
  | { readonly kind: 'replace'; readonly state: AppState; readonly preferences: EditorPreferences; readonly foldBasis: EditorFoldBasis }
);
export interface EditorPreferenceMetadata extends EditorEventIdentity {
  readonly folds?: { readonly basis: EditorFoldBasis; readonly updates: readonly {
    readonly occurrence: LayerOccurrence; readonly collapsed: boolean;
  }[] };
}
export interface EditorPreferenceEvent extends EditorPreferenceMetadata { readonly patch: EditorScalarPreferencePatch }
export type EditorEffect =
  | { readonly type: 'document'; readonly event: EditorDocumentEvent }
  | { readonly type: 'preferences'; readonly event: EditorPreferenceEvent };
export interface IncrementalEditorCallbacks {
  onDocumentEdit(event: EditorDocumentEvent): void;
  onPreferencesChange(patch: EditorScalarPreferencePatch, metadata: EditorPreferenceMetadata): void;
}

export type EditorElementIntent =
  | { readonly type: 'append'; readonly elements: readonly import('../../types').TemplateElement[]; readonly selectedElementIds?: readonly string[] }
  | { readonly type: 'patch'; readonly updates: readonly { readonly id: string; readonly patch: Partial<import('../../types').TemplateElement> }[] };
