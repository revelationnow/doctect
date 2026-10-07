# Layer-fold ownership across structural edits and history

Date: 2026-09-14
Status: Written supplement approved by the user with “Proceed”; implementation planning and Task 4 execution authorized. No commits or live cutover authorized.

## 1. Scope and authority

This supplements `2026-09-13-incremental-local-persistence-design.md`, state ownership and history sections, and Task 4 of `../plans/2026-09-13-incremental-local-persistence.md`.

The user approved proceeding with explicit structural provenance and displaced compatibility values, while keeping ordinary preferences outside document undo. This document defines that behavior before implementation. It does not authorize commits, live editor cutover, database upgrades, user-data migration, or edits to the protected Sticker Press worktree.

Tasks 1–3 remain accepted primitive checkpoints. Their unchanged-state round trips and immutable record edits do not establish correctness of partition-aware structural editing. This supplement resolves that missing ownership boundary; implementation and integration still require tests.

## 2. Problem and selected approach

`partition.ts` removes `collapsed` from document layers. Unique string IDs with boolean folds use `preferences.layerCollapsed`; duplicate/non-string IDs and non-boolean values use positional `compatibility.layerCollapsedExceptions`. An unchanged partition assembles losslessly, but positional values can attach to different layers after reorder, deletion, replacement, or copying. ID-keyed values also need protection from ID reuse.

Select explicit, operation-supplied layer correspondence plus bounded reversible fold effects. Keep document-only editing/history primitives usable, but require a partition-aware owner for integrated structural changes.

Rejected alternatives:

- Inferring identity from IDs, positions, or deep equality: ambiguous for duplicate IDs, replacement, and copies. Object references can validate a supplied mapping but cannot establish every mapping.
- Restoring complete preference snapshots: undoes unrelated UI choices and retains unnecessarily broad state.
- Deferring ownership until editor cutover: builds history without a required reversal contract and postpones already-known data-loss cases.

No public layer IDs are changed. No persistent per-layer records, general event log, global identity registry, or whole-document provenance scan is introduced.

## 3. Logical fold cells and structural correspondence

A logical fold cell distinguishes absent `collapsed` from present `collapsed` with its exact value, including an own `undefined` where historical in-memory compatibility supports it. Preservation does not relax existing persistence admission: values rejected by canonical serialization remain rejected.

A layer occurrence is addressed by variant ID, template ID, and array position within an exact immutable document snapshot. Positions identify occurrences on one side of a transition; they are not identities across transitions.

An operation supplies explicit correspondence for affected layer sequences:

- **Continue:** one before occurrence maps to one after occurrence. Reorder, ID rename, and ordinary property edits continue the logical layer, even when the operation allocates a new object.
- **Copy:** an after occurrence is a new logical layer initialized from a named before occurrence. The source and copy are independent thereafter. One source may initialize multiple copies.
- **Create:** an after occurrence is new, initialized from an explicitly supplied fold cell, including absence.
- **Remove:** a before occurrence has no continuing after occurrence. Its current fold cell is retained only where reversal requires it.

Correspondence covers all occurrences of each changed layer sequence, including absence-valued cells. Untouched sequences require no mapping. Template/variant copies carry source addresses as well as layer positions. Same-ID replacement is remove/create unless explicitly declared to continue; never infer continuation from matching IDs.

Validation rejects duplicate continuing sources, duplicate destinations, missing coverage, invalid positions, mismatched source/target snapshots, and missing structural provenance before publishing document or overlay changes. Checking an affected layer sequence is permitted; reading unrelated templates is not. Elements/artwork/opaque payloads are not copied to build provenance.

Semantic constructors must emit or be adapted to supply this information where structural intent is known. Generic template replacement must declare correspondence or explicit replacement; it cannot silently guess. Existing document-only primitives remain private and must not bypass this requirement in the integrated owner.

## 4. Reconciliation and usable fold actions

The partition-aware owner reads current fold cells for affected occurrences, applies correspondence, and re-encodes only affected templates' overlays. It clears obsolete keys in those templates so deleted IDs and reused positions do not inherit stale data. Unrelated overlays retain values and shared references where the representation permits.

Re-encoding uses the current partition rules: boolean cells on unique string IDs use the preference map; exceptional present cells use the compatibility map; absence creates neither entry. Changing duplicate-ID membership can move a cell between maps without changing its external value.

A fold action targets a concrete occurrence in the current snapshot, not just a possibly duplicated layer ID. It sets a boolean cell, replacing any prior exceptional value for that occurrence. For duplicate/non-string IDs that boolean may still need positional storage. An explicit fold action is a preference operation regardless of which internal map encodes it.

Live display treats absent or non-boolean raw values as expanded; actual booleans determine collapse. Merely displaying a historical value never normalizes it. Only an explicit fold action replaces that value with a boolean. This safe display rule applies in the new partition-aware UI adapter, not by rewriting raw export data.

## 5. History behavior, including intervening preferences

Document history retains immutable before/after document references and exact affected addresses, with the existing 50-entry bound. Ordinary navigation, zoom, panel changes, and fold actions do not create entries, clear redo, or change document revision/modification time.

Partition-aware history additionally owns structural correspondence and displaced fold cells. It does not retain complete preference snapshots. Every forward or reverse transition reads the current cells of continuing layers, so later fold choices follow those layers instead of being overwritten by historical preferences.

Rules:

| Scenario | Required behavior |
| --- | --- |
| Reorder A/B; toggle A; undo reorder | A returns to its old position with its latest fold choice. |
| Delete A; toggle unrelated B; undo deletion | A returns with the value captured when removed; B keeps its latest choice. |
| Undo deletion; toggle restored A; redo deletion; undo again | Redo captures A's new choice; the next undo restores that choice. |
| Copy A to C | C starts with A's fold value at copy time, but future changes to A and C are independent. |
| Toggle C; undo copy; toggle A; redo copy | C returns with its own last value, not A's current value or its original copied value. |
| Delete A; create another A with reused ID | New A starts from explicit create data, never the deleted layer's stored value. |
| Explicitly toggle a historical non-boolean value | Undoing unrelated content does not bring that raw value back onto the continuing layer. |

Crossing a history edge captures cells that disappear on that crossing for the next inverse crossing. Updated retention belongs to the returned immutable history value; older history values and receipts remain unchanged. Nothing is stored in a global mutable tombstone cache. No-op undo/redo changes neither content nor overlays.

Gesture grouping retains the first before document/selection and latest after document/selection. Compose correspondence across the group rather than storing every pointer event. Drop intermediate-only occurrences when they are neither reachable nor needed for reversal. Net-zero content gestures create no content history entry and preserve legitimate preference actions. Canceled gestures reconcile back to the initial document while preserving current preferences on surviving layers; abandoned content does not clear pre-gesture redo.

Discarding redo, trimming history, replacing the history owner, or closing a project releases displaced references not reachable from the remaining history/current partition. The bound limits entry count, not the size of one legitimate bulk replacement.

## 6. API and module boundary amendment

Keep approved `DocumentState`, `DocumentChange`, and `DocumentEdit` contracts document-only. Keep `createDocumentHistory`, `recordDocumentEdit`, `undoDocument`, and `redoDocument` usable with their approved document-only signatures. Do not add all preferences to `DocumentEdit` or disguise compatibility values as content changes.

Add a typed partition-aware editing/history boundary alongside those primitives:

- A partitioned edit combines the `DocumentEdit`, validated structural correspondence, and reconciliation receipt for affected overlays.
- A partitioned history owns the document history and its aligned structural reversal data. One public owner operation advances both atomically; callers cannot independently push/pop companion stacks.
- Record, undo, and redo operations consume the current partition and return the next partition, next history, exact document effects, exact overlay effects, and optional resolved selection. They must not restore `edit.before.preferences` wholesale.
- Explicit fold operations use the same fold-cell accessors but return preference-only effects and no history entry.

Exact TypeScript names/signatures for these additions are fixed in the implementation-plan addendum before coding. Expected new responsibility: a focused `services/document/layerFolds.ts` module for cells, correspondence validation, and reconciliation; `history.ts` owns history composition and retention. No storage/browser imports enter these modules.

Task 4 scope expands to implement and test this partition-aware boundary, in addition to the original document-only history. Narrow changes to contracts, partition projection, and semantic-operation adapters are permitted where needed; live editor wiring remains Task 10. Existing safe snapshot clones remain until live mutation callers are converted.

Selection restoration preserves optional own-property absence, especially `activeLayerId`, and resolves invalid IDs against the restored document. Do not manufacture an own `undefined` in an otherwise serializable state. Preserve the existing historical snapshot failure characterization until the corresponding path has actually been fixed; add successful new-history coverage rather than deleting evidence.

## 7. Bulk replacement and persistence integration

Full JSON/generator replacement is an explicit bulk history operation. Unless the operation explicitly supplies correspondence, old and new layer populations are independent even if IDs match. Incoming partition cells initialize the new side; undo restores the old side's retained cells, and subsequent crossings capture changes made while either side is live. Do not treat incoming serialized navigation/transient values as ordinary content history. Existing safe live hydration and selection policies still apply.

Bulk traversal at explicit ingress/replacement/export is allowed. Ordinary edits and undo/redo reconcile only affected templates and addresses; no full assembly, clone, hash, diff, or global fold-map search to discover affected occurrences. Index overlay keys by owning template once at ingress, or use equivalent template-scoped bookkeeping; update that bookkeeping incrementally.

Structural overlay relocation is part of the same logical content command as its template edit. Tasks 5–9 and 12 must carry its exact overlay effects and size contributions through admission, batching, validation, and the atomic worker transaction. Persisting reordered templates with old positional overlays is forbidden. This differs from independent fold actions, which remain preference-only writes using the existing preference scheduling and revision rules.

The worker serializes structural overlay effects with preference writes against its latest authoritative state. A delayed preference operation must not target a reused ID/position. Bind affected-template fold operations to a structural generation and reject stale operations rather than guessing; the editor may resubmit its latest intended value only after resolving the current occurrence. The final plan must define that generation/ordering protocol before persistence integration. This is not automatic cross-tab merging.

Codec and encoded-size accounting include all current raw overlay values and own-property semantics. Runtime history mappings and displaced history cells do not leak into public JSON and are not persisted as an undo log. Restart creates fresh history from the authoritative reconstructed partition.

## 8. Required tests and review gates

Task 4 tests must include:

1. Original document history cases: reference restoration, exact dirty records, grouping/cancel, redo clearing, 50-entry retention, variant membership, generator changes, bulk replacement, selection resolution, and immutable earlier results.
2. Assembled raw values and own-property presence after reorder, delete, edit, ID rename/reuse, duplicate/non-string IDs, duplicate IDs becoming unique, template/variant copy, replacement, and undo/redo.
3. Every intervening-fold scenario in section 5, including changed raw exceptional values and preference updates while redo is available.
4. Negative provenance tests and atomic failure: rejected edits leave document, overlays, history, and derived bookkeeping unchanged.
5. Frozen fixtures, unrelated-template getter/iteration traps, unchanged-reference assertions, and grouping that does not retain per-event chains.
6. No clone of complete documents in ordinary history; full replacement explicitly identified as bulk.
7. Safe display does not mutate raw values; explicit duplicate-ID fold targeting affects only the chosen occurrence.
8. Absent `activeLayerId` remains absent through the new history/assembly/save-admission path.

Tasks 5/6 must prove codec/accounting equivalence using reconciled overlays. Tasks 7–9/12 must prove atomic structural overlay persistence, preference ordering/stale rejection, and fault behavior. Tasks 10/14 must exercise actual UI mutation routes, export/reload, and folds interleaved with undo/redo. Task 15 retains the original performance targets.

No stage may claim integrated reconstruction or persistence safety solely because document-only history tests pass. All original database, scheduling, size-limit, recovery, isolation, and no-cutover-before-Task-13 constraints remain binding.
