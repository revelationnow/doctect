# Layer-fold History Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Execute this as the expanded Task 4 checkpoint; no automatic commits.

**Goal:** Implement structurally shared history that restores document records and preserves logical layer fold ownership through edits, grouping, undo, and redo.

**Architecture:** Keep the approved document-only editing/history APIs. Add a template-indexed fold reconciler and an atomic partitioned-history facade, with explicit occurrence correspondence and immutable displaced cells rather than whole-preference snapshots. Live editor and persistence integration remain gated.

**Tech Stack:** Existing TypeScript, Vitest, immutable object maps. No new runtime dependencies.

## Global Constraints

All Global Constraints in `2026-09-13-incremental-local-persistence.md` apply verbatim. This is an approved scope extension for Task 4, not a replacement of database, timing, lineage, size, public-format, or isolation requirements.

- Approved supplement: `../specs/2026-09-14-layer-fold-history-ownership-design.md`.
- Preserve the existing `50`-entry undo bound; ordinary history operations must not deep-clone documents.
- No whole-document diff/clone/hash/validation, whole-workspace read-back, or full-project worker round trip on ordinary saves.
- No commits, staging, branch integration, deployment, or destructive operations without explicit user authorization. Task review checkpoints replace automatic commits in this plan.
- If delegating, honor the user's Astra High requirement: verify `openai/gpt-6-astra` with variant `high`; do not silently use an unverified default subagent.
- Feature worktree only. Never use ports 3000/3001, the source worktree, or the user's browser data. No production editor/storage wiring.

## Files and interfaces

Create:
- `services/document/history.ts`: document snapshots, address-derived effects, grouping, cancellation and selection resolution.
- `services/document/layerFolds.ts`: template-scoped overlay index, fold cells, provenance validation, forward/reverse reconciliation.
- `services/document/partitionedHistory.ts`: atomic document/fold history owner; no parallel independently writable history stacks.
- `tests/unit/document/history.test.ts`, `tests/unit/document/layerFolds.test.ts`, `tests/unit/document/partitionedHistory.test.ts`.

Narrow changes allowed:
- `services/document/contracts.ts`: additive shared types below; existing types/signatures remain intact.
- `services/document/partition.ts`: export/reuse fold addressing/projection internals if needed, without changing lossless ingress or safe hydration.
- `services/document/editOperations.ts`: additive provenance adapter only if needed; existing callbacks unchanged.
- `tests/unit/document/partition.test.ts`, `tests/unit/document/applyChanges.test.ts`: covering regressions only if those implementations change.
- `services/projectDocumentSnapshot.ts`, `tests/unit/projectDocumentSnapshot.test.ts`, `tests/unit/incrementalFixtures.test.ts`: optional targeted absence fix with red/green proof; never remove live defensive clones. Otherwise retain old failure characterization and add passing new-path regression.

Do not change Task 3 `applyChanges.ts`/`references.ts` absent a demonstrated blocking defect and controller review. Helpers may remain private to their owner; do not export implementation bookkeeping merely to inspect it in tests.

### Document history API

Define/export history types with the history module (shared contracts may re-export types without a runtime cycle):

```ts
type HistorySelection = Pick<AppState,
  'activeVariantId' | 'selectedNodeId' | 'selectedNodeIds' |
  'selectedTemplateId' | 'selectedTemplateIds' | 'selectedElementIds' | 'activeLayerId'>;
interface HistorySelectionPair { before: HistorySelection; after: HistorySelection }
interface HistoryResult {
  history: DocumentHistory;
  document: DocumentState;
  changes: readonly DocumentChange[];
  selection?: HistorySelection;
  replacement?: DocumentState; // Only explicit bulk restoration; never both ordinary changes and replacement.
}
function createDocumentHistory(limit?: number): DocumentHistory;
function recordDocumentEdit(history: DocumentHistory, edit: DocumentEdit,
  groupId?: string, selection?: HistorySelectionPair): DocumentHistory;
function undoDocument(history: DocumentHistory, current: DocumentState): HistoryResult;
function redoDocument(history: DocumentHistory, current: DocumentState): HistoryResult;
function recordDocumentReplacement(history: DocumentHistory, before: DocumentState,
  after: DocumentState, selection?: HistorySelectionPair): DocumentHistory;
function finishDocumentGroup(history: DocumentHistory, groupId: string): DocumentHistory;
function cancelDocumentGroup(history: DocumentHistory, current: DocumentState,
  groupId: string): HistoryResult;
```

`DocumentHistory` is an immutable typed state with private/internal entry layout. Default limit 50; require an integer in [1, 50], rejecting invalid limits. Retain first-before/latest-after document references and affected-address union. New committed edits clear redo; no-op/navigation does not. A group is the current contiguous nonempty group ID only, not all entries ever using that string. Finish closes that group; another edit/group or traversal closes it. Cancellation is allowed only for the current open matching group; retain its pre-group redo for cancellation, release that retention on finish. Stale document reference and mismatched cancellation reject without mutation. Net-zero grouped edits restore pre-group history/redo and preserve preference actions in the partition owner.

Read target values only at affected addresses. Filter net-zero touched effects by reference/own presence or bounded variant metadata comparison, not payload equality. Generate parent metadata before child puts and child deletes before parent deletion. Use bulk `replacement` for explicit full replacement/schema changes. Undo/redo must return the retained document itself, not replay-created clones. Copy only small selection arrays; preserve optional own-property absence and resolve IDs against the restored document.

Selection-context refinement from Task 4 review R1: the unchanged document-only API has no current view preferences, so its element/layer selection result is a template-context candidate, not permission to publish UI preferences in hierarchy mode. The partitioned facade is the UI-publication owner. Its internal timeline/resolver receives the current partition's viewMode on each undo/redo/cancel, and resolves the retained raw selection directly against the rendered template (selected node's type in hierarchy mode, selectedTemplateId in templates mode) before filtering element/layer IDs. Do not first filter under the default template context and then attempt recovery; valid IDs would already be lost. Public signatures and HistorySelection stay unchanged; never store/reset viewMode in history. Explicit bulk restoration uses the same contextual path. A stale/missing hierarchy template resolves to no element selection and a safe absent/empty active layer rather than an inactive template's layer. Document-only callers requiring actual UI restoration must use the partitioned facade or supply equivalent context before publication.

### Fold reconciliation API

```ts
type FoldCell = { present: false } | { present: true; value: unknown };
interface LayerOccurrence { variantId: string; templateId: string; position: number }
type LayerMapping =
  | { type: 'continue' | 'copy'; from: LayerOccurrence; to: LayerOccurrence }
  | { type: 'create'; to: LayerOccurrence; cell: FoldCell }
  | { type: 'remove'; from: LayerOccurrence };
interface LayerCorrespondence {
  before: DocumentState;
  after: DocumentState;
  mappings: readonly LayerMapping[];
}
interface FoldOverlayEffect {
  variantId: string;
  templateId: string;
  // Complete current fold cells of this affected template, not its artwork/content.
  cells: readonly FoldCell[];
}
interface LayerFoldState { readonly parts: PartitionedState; /* private template index */ }
interface PartitionedEdit {
  documentEdit: DocumentEdit;
  before: LayerFoldState;
  after: LayerFoldState;
  correspondence: LayerCorrespondence;
  overlayEffects: readonly FoldOverlayEffect[];
}
interface FoldUpdate { state: LayerFoldState; overlayEffects: readonly FoldOverlayEffect[] }
function createLayerFoldState(parts: PartitionedState): LayerFoldState;
function readLayerFoldCell(state: LayerFoldState, occurrence: LayerOccurrence): FoldCell;
function isLayerCollapsed(state: LayerFoldState, occurrence: LayerOccurrence): boolean;
function setLayerCollapsed(state: LayerFoldState, occurrence: LayerOccurrence, value: boolean): FoldUpdate;
function updateLayerFoldPreferences(state: LayerFoldState,
  patch: Partial<Omit<EditorPreferences, 'layerCollapsed'>>): LayerFoldState;
function reconcileLayerFolds(state: LayerFoldState, edit: DocumentEdit,
  correspondence: LayerCorrespondence): PartitionedEdit;
```

Type declarations above describe the public surface; put actual private index fields behind a non-exported/opaque implementation type, not literal comment-only types. No independently mutable index is exposed. Ingress may traverse all templates/maps once. Ordinary reconciliation uses `edit.affected`, explicit source addresses, and per-template overlay-key buckets. Top-level shallow map copying is permitted; enumerating all overlay keys to discover affected buckets is not. A source template used for a copy is relevant and may be read, but must not be rewritten unless affected.

Changed layer-array references require complete correspondence for those sequences, including cells with absent values. Same array reference can implicitly continue at identical occurrences in an unchanged owning template. Template/variant removal uses Task 3's expanded affected template addresses. Each before occurrence must have exactly one continue/remove disposition; copies are additional non-consuming reads. Each after occurrence must have exactly one continue/copy/create origin. Mapping endpoints outside affected sequences are allowed only as read-only copy sources. Validate snapshots, integer positions, duplicate coverage and all mappings before creating/publishing any next state.

Re-encode touched templates using existing unique-ID/boolean versus exceptional positional rules. Always clear touched old keys. A removed template emits an empty cells effect so downstream persistence removes its overlays. Explicit preference changes on exceptional/duplicate occurrences still emit only fold effects, not document changes. `isLayerCollapsed` returns true only for a present boolean true, preserving raw data. A set-to-same-present-boolean is a reference-identical no-op; setting absent to false is not. `updateLayerFoldPreferences` changes only named non-fold preference fields, retaining the index/document without rebuilding or creating history; reject a runtime layerCollapsed key rather than letting it bypass reconciliation.

### Partitioned history API

```ts
interface PartitionedHistoryResult extends FoldUpdate {
  history: PartitionedHistory;
  changes: readonly DocumentChange[];
  selection?: HistorySelection;
  replacement?: DocumentState;
}
function createPartitionedHistory(limit?: number): PartitionedHistory;
function recordPartitionedEdit(history: PartitionedHistory, edit: PartitionedEdit,
  groupId?: string, selection?: HistorySelectionPair): PartitionedHistory;
function undoPartitioned(history: PartitionedHistory, current: LayerFoldState): PartitionedHistoryResult;
function redoPartitioned(history: PartitionedHistory, current: LayerFoldState): PartitionedHistoryResult;
function finishPartitionedGroup(history: PartitionedHistory, groupId: string): PartitionedHistory;
function cancelPartitionedGroup(history: PartitionedHistory, current: LayerFoldState,
  groupId: string): PartitionedHistoryResult;
function recordPartitionedReplacement(history: PartitionedHistory, before: LayerFoldState,
  after: LayerFoldState, selection?: HistorySelectionPair): PartitionedHistory;
```

Partition history retains only document references, correspondence, affected addresses, needed displaced cells and selection—not `PartitionedEdit.before`/`after` wrappers or whole preference snapshots. Continuations read current cells in either direction. New-side and old-side disappearing cells are captured on each crossing into the returned history edge so copies/restored deletions preserve intervening fold choices. Unrelated preferences and `compatibility.state` stay current. Replacement here changes document plus layer-fold population; importing other top-level compatibility is an explicit bulk-ingress owner's responsibility, not an implicit navigation undo.

Compose group mappings from first to latest occurrences; no unbounded per-event chain. Preserve intermediate-origin copy initialization if its source later disappears. Drop unreachable transient-only cells. Keep document and structural entry lifecycles aligned, including finish/cancel, net-zero group, history trim and redo invalidation. Reject a foreign/stale document and invalid correspondence before changing either state.

## Task 4A: Document-only history

- [ ] Write `history.test.ts` beginning with the original Task 4 reference/effect regression:

```ts
const document = partitionState(makeIncrementalProject().initialState).document;
const node = document.nodes[document.rootId];
const edit = applyDocumentChanges(document, [{ type: 'put-node', node: { ...node, title: 'New' } }]);
const h = recordDocumentEdit(createDocumentHistory(), edit);
const result = undoDocument(h, edit.after);
expect(result.document).toBe(document);
expect(result.changes).toEqual([{ type: 'put-node', node }]);
expect(redoDocument(result.history, result.document).document).toBe(edit.after);
```

- [ ] Run `npx vitest run tests/unit/document/history.test.ts tests/unit/projectDocumentSnapshot.test.ts` and capture intended missing-API RED before source.
- [ ] Implement the history API above. Start with immutable empty past/future, then target-address effect generation, record/undo/redo, grouping/cancel and explicit bulk entries. Reject stale references and invalid limits rather than trying whole-state equality.
- [ ] Add behavioral cases before their implementation: add/delete/recreate, variant metadata and children, generator absence/replacement, 50-entry trimming, selection-only no-op, finished/reused group IDs, cancellation preserving redo, net-zero group, full replacement including schemaVersion, own-absent activeLayerId, frozen earlier snapshots, unrelated-template getter traps. For replayable ordinary effects assert `applyDocumentChanges(current, result.changes).after` equals the target value as well as retained result identity.
- [ ] GREEN focused tests and existing generator-history tests. Keep current live clone path safe.

## Task 4B: Indexed fold cells and forward reconciliation

- [ ] Write `layerFolds.test.ts`: use two frozen layers with duplicate ID `same`, first own `collapsed: 'legacy'`, second absent, partition them, reorder the stripped layer objects, and supply explicit continue mappings 0→1 and 1→0. Assert assembled position 1 owns exact legacy value and position 0 lacks `collapsed`.

```ts
expect(Object.hasOwn(assembledLayers[0], 'collapsed')).toBe(false);
expect(assembledLayers[1].collapsed).toBe('legacy');
expect(next.after.parts.document).toBe(edit.after);
expect(next.after.parts.document.nodes).toBe(initial.parts.document.nodes);
```

- [ ] Run `npx vitest run tests/unit/document/layerFolds.test.ts` RED before implementing `layerFolds.ts` and additive types.
- [ ] Implement cells/index, safe display/explicit fold action, preflight correspondence coverage, touched-template encoding and immutable updates in that order. Use `Object.hasOwn`/safe key writes for unusual IDs. Never normalize raw values on display.
- [ ] Add RED/GREEN tests for all mapping kinds; duplicate→unique and unique→duplicate; non-string IDs; absence versus own undefined; ID rename/reuse; copy source in another variant; deletion and template/variant copy; malformed/missing/duplicate mappings; stale snapshots; preference-only exceptional updates; unrelated-template and global-map discovery traps. Assert rejection leaves original state/index usable on a subsequent valid edit.
- [ ] GREEN `npx vitest run tests/unit/document/layerFolds.test.ts tests/unit/document/partition.test.ts tests/unit/document/applyChanges.test.ts`.

## Task 4C: Atomic partitioned history and intervening preferences

- [ ] Write `partitionedHistory.test.ts` for reorder→toggle→undo. Toggle on the reordered layer using `setLayerCollapsed`; pass that returned current state to undo, rather than the edit's stale after wrapper.

```ts
const h = recordPartitionedEdit(createPartitionedHistory(), reordered);
const toggled = setLayerCollapsed(reordered.after, movedOccurrence, true).state;
const undone = undoPartitioned(h, toggled);
expect(undone.state.parts.document).toBe(reordered.documentEdit.before);
expect(readLayerFoldCell(undone.state, originalOccurrence)).toEqual({ present: true, value: true });
```

- [ ] Run `npx vitest run tests/unit/document/partitionedHistory.test.ts` RED, then implement the atomic owner and reversible displaced-cell retention. No history entry stores full partition wrappers.
- [ ] Add each section 5 supplement scenario as a real assembled-state assertion: delete/toggle unrelated/undo; restore/toggle/redo/undo; copy/toggle copy/undo/toggle source/redo; delete/reuse ID; historical raw value explicitly toggled before content undo. Check previous history remains immutable after subsequent crossings.
- [ ] Add grouping/cancel/redo restoration, copied-then-deleted intermediate source, net-zero gesture preference survival, trim/release structure, replacement/undo/redo, stale rejection, and independent untouched preferences. Assert exact overlay effects, not merely returned documents.
- [ ] Add new history→assembly→existing save-admission regression with absent activeLayerId. If fixing old helper's own-property bug, write its failing regression first, preserve deep clone and turn original characterization into positive coverage only after the old path passes.
- [ ] GREEN `npx vitest run tests/unit/document tests/unit/incrementalFixtures.test.ts tests/unit/projectDocumentSnapshot.test.ts tests/unit/ProjectEditor.generatorHistory.test.tsx tests/unit/layers.test.ts`.

## Task 4D: Review and verification checkpoint

- [ ] Self-review against all eight supplement test gates; report actual test evidence and remaining downstream ownership obligations. No broad production changes to make a unit test pass.
- [ ] Run covering command above, `npx tsc --noEmit --pretty false`, tracked and newly-created-file whitespace checks, and `npm run build --legacy-peer-deps -- --outDir /tmp/opencode/doctect-incremental-sdd/task-4-build-01` after checking output parent exists and output path is fresh. Existing baseline stickerPress.test.ts:793 TS2339 is not a passing typecheck; allow no new diagnostics. Do not run expensive browser baselines for unwired modules.
- [ ] Controller generates cumulative dirty-baseline package; fresh verified Astra High reviewer judges both spec and quality. Resolve blockers and re-review before marking expanded Task 4 complete. Do not commit.

## Downstream protocol requirements (binding handoff, not Task 4 storage implementation)

Task 5 encodes current fold overlays, not history mappings/cells. Task 6 accounts exact external serialized values/absence. Task 7 structural transactions atomically relocate overlay keys with template content and update fold-address structural generation. Task 8 protocol carries that generation for occurrence-targeted fold commands; stale generation aborts preference operation without touching a reused layer. Task 9 queues do not silently rebase old occurrences and preserve ordering around structural commands. Task 12 admission resolves worker-authoritative generations, and Task 10 emits explicit correspondence at structural callback boundaries.

Use a per-project monotonic fold-structure generation scoped by incarnation, advanced only when occurrence addressing changes (reorder, layer identity/membership, template ownership or bulk replacement), never rewound by undo. Independent fold commands carry the generation their occurrence was resolved against. A stale command is rejected as a preference conflict; no automatic cross-tab merge. Structural commands carry correspondence so the worker relocates its latest authoritative fold cells instead of overwriting another tab's committed fold with stale client snapshots. Copies initialize from that authoritative source cell; creates use supplied cells; explicit history restoration carries displaced cells for resurrected occurrences. New-side local fold intent is queued after the structural command against its admitted generation. Generation bookkeeping is private normalized metadata, not public JSON, and shares the existing content transaction/revision checks.

Tasks 7–9/12 must refine concrete storage/message field additions in their briefs before implementation and test both orders of fold versus structural commits, failed structural writes, undo/redo generation monotonicity, stale delayed fold commands, incarnation change and retries. Do not enable cutover until these pass. The pure Task 4 overlay snapshots are exact local effects, not authorization to blindly overwrite durable preferences.

## Plan self-review

- Supplement sections 3–4 map to 4B; section 5 to 4A/4C; section 6 to the three exact APIs; section 7 to 4C bulk handling and downstream protocol; section 8 to 4D and named later gates.
- All original history interfaces remain present. Additive cancellation/bulk and partition-aware interfaces resolve capabilities not expressible by the original four functions alone.
- Implementation stays within the approved expanded Task 4 scope. Existing live history, user data, schema version and autosave behavior remain unchanged unless the narrowly optional snapshot absence fix is proven.
