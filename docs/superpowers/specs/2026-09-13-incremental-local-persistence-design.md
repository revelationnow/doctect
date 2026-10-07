# Incremental Local Persistence and Responsive Editing

Date: 2026-09-13
Status: Written specification approved by the user on 2026-09-13; implementation planning authorized.

## 1. Goal and approved scope

Keep large projects interactive during navigation, editing, and automatic local saving. Normal save work must follow the records changed, not the size of the complete project or workspace.

The user chose incremental persistence over merely increasing the autosave interval. Approved scope includes separate editor preferences, batched record updates, immutable editing, removal of whole-document undo cloning, and a verified migration. Reload should restore the last page/template, variant, and zoom through lightweight preference persistence.

This is a coordinated editor/persistence redesign, not an autosave timer patch. No implementation or database upgrade is authorized by this document until the written-spec review and implementation-planning gates are complete. No existing user database is to be migrated during development without explicit approval; tests use isolated databases/browser profiles.

### Non-goals

- Per-element database records, artwork deduplication, compression, or asset garbage collection.
- Incremental cloud synchronization, automatic cross-tab merging, or collaboration.
- Changing public JSON, generator, PDF, or cloud document formats.
- Increasing project limits or presenting local storage as a backup.
- Lazy project loading, unrelated rendering improvements, or a general event-sourcing system.
- Deleting retained legacy data, migration sources, or unrelated working-tree changes.

## 2. Existing behavior and evidence

Inspection was against `.worktrees/sticker-press-redesign`. Browser performance attribution remains to be measured; these are verified code paths, not measured percentages of freeze time.

- `components/ProjectEditor.tsx` reports every changed `AppState`, including navigation and layout changes, to its parent.
- `pages/EditorPage.tsx` and `hooks/useWorkspaceProjectWrites.ts` submit these as complete project saves.
- `services/localWorkspace/mutationQueue.ts` clones the complete project at admission, before coalescing. Its current one-second timer is not an incremental-save solution.
- `projectPreparationClient.ts` creates a preparation worker per request, sends/receives the complete project, then validates its returned content on the main thread.
- `validation.ts` performs whole-value canonical serialization, cloning, and state validation.
- `LocalWorkspaceStore.ts` reads and reconstructs workspace records after a project save. Publication clones the workspace through `projectAuthority.ts`.
- `services/projectDocumentSnapshot.ts` deep-clones document state for history and restoration. Autosave changes alone will not remove this editing cost.
- Current physical IndexedDB version is 2, with project incarnation/revision protection and migration/recovery machinery.

Related historical plans:

- `docs/superpowers/plans/2026-08-14-indexeddb-local-persistence-migration.md`
- `docs/superpowers/plans/2026-08-16-lineage-admission-fixes.md`
- `docs/superpowers/plans/2026-08-18-indexeddb-v2-lineage-repair-recovery-ux.md`

No existing plan covers this redesign. Their safety requirements remain applicable; their monolithic storage layout, fixed store count, and whole-snapshot publication requirements are superseded by this design. Historical documents remain unchanged.

## 3. State ownership

### Document content

Nodes, root identity, variants, templates and elements, output-affecting layer settings, generator provenance, project name, and preserved document extensions are durable content. Document changes create undo entries and document-save work as appropriate. Cloud linkage and other wrapper metadata remain durable but do not become document undo operations merely because they are stored.

### Editor preferences

Active variant, selected node/template, zoom, view mode, panel sizes, grid/snap preferences, and panel expansion are lightweight preferences. Layer-panel expansion must be distinguished from layer visibility, locking, or ordering. Restore usable preferences after reload; references to removed nodes, variants, templates, or layers resolve to existing safe defaults.

Preference updates do not increment document storage revision, trigger document validation, enter document undo, update document modification time, or rewrite content records. Preference failure is reported separately from document-save status.

Preferences are scoped to a project and guarded by project incarnation so delayed writes cannot resurrect settings for a deleted/recreated project. Across tabs, the last committed preference batch wins; this must not confer document write authority. Different open tabs keep their live navigation independent rather than forcibly applying another tab's selection.

### Transient session state

Open dialogs, active gestures, active tool, temporary selection/multiselection, and clipboard remain session state unless explicitly listed as restored preferences. Durable selected node/template describes the current location; temporary element selection need not survive reload. Transient changes never submit document writes.

Migration preserves the old serialized representation, including supported unknown fields and legacy UI values. Live hydration applies existing safe-reset rules for transient fields; it must not silently remove source data to make migration pass. Format compatibility and runtime restoration are tested separately.

## 4. Document editing module and history

Introduce one document-editing interface that applies semantic edits and returns the next immutable document plus an explicit set of changed records. Callers never learn IndexedDB stores or transaction details.

The interface covers node/template updates, structural changes, variant operations, generator-source updates, and full-document replacement. Every existing mutation route must use it before the incremental backend becomes authoritative: properties, gestures, layers, hierarchy operations, duplicate/paste, JSON replacement, generator application, undo/redo, and project-level metadata operations.

- Copy only changed objects and their ancestor containers. Reuse unchanged node/template objects.
- Do not discover dirty records using a full-document deep diff, stringify, hash, or clone after each edit.
- Dirty records carry immutable values or deletion markers. Later edits cannot mutate an already admitted batch.
- Semantic operations produce complete affected-record sets, including reference repairs required by existing behavior.
- Preserve existing edit grouping: a drag is one undoable operation, even if persistence checkpoints occur during the drag.

Use immutable document references with structural sharing for history, retaining the existing 50-entry bound. Undo/redo entries also retain the affected-record set needed to persist the restored values. Small selection context may be stored for useful restoration without making navigation itself undoable. Audit and eliminate mutation of shared objects before removing defensive full clones. Full replacement can retain an old immutable document, but normal edits and restoration must not deep-clone it.

Object-map ancestor copies and React rendering still have costs; this design does not claim every edit becomes strictly constant-time. The prohibited behavior is traversing/copying unrelated document payloads for normal persistence or history.

## 5. Normalized local representation

Use the same `doctect-local-workspace` database with physical schema version 3. Add normalized stores while retaining the six existing stores for their required migration/recovery and ancillary roles.

| Logical record | Identity | Content |
| --- | --- | --- |
| Project header | Project ID | Incarnation, document storage revision, name/root/schema, cloud linkage, ordering/size metadata |
| Node | Project ID + incarnation + node ID | Complete node |
| Variant header | Project ID + incarnation + variant ID | Variant metadata and reconstruction order |
| Template | Project ID + incarnation + variant ID + template ID | Complete template, elements, output-affecting layers |
| Generator source | Project ID + incarnation | Current scripts and provenance |
| Preserved extensions | Project ID + incarnation + owning-record identity | Supported fields not represented by the normalized schema |
| Editor preferences | Project ID + incarnation | Small restored editor state and independent preference revision |
| Normalization ledger | Migration identity | Source revisions/digests, target generation, verification and authority status |

The implementation plan specifies exact store names and key types. Prefix normalized data identities with a private storage-generation ID so staged migration records cannot overwrite a published generation. The ledger selects the active generation; this namespace is separate from editor generations and project incarnations. Opaque extensions must not be copied into a frequently updated small header if doing so would repeatedly copy large values. Unknown fields within nodes/templates remain part of those records. Preserve array order and reconstruction semantics; record-ID collisions across variants/projects must be impossible.

IndexedDB `put()` replaces a record, not bytes within a JSON document. Template-level granularity is deliberate: changing a label writes its template and bounded bookkeeping, not other templates, variants, or projects.

Custom presets, pending imports, legacy backups, and existing provenance remain compatible. They may remain monolithic because ordinary editor autosave must not read, clone, validate, or rewrite them. Their structural commands still respect workspace transaction ordering.

Maintain aggregate encoded-size accounting and membership metadata incrementally. Updating a template must not require serializing all templates to enforce `MAX_STATE_BYTES`. Accounting includes reconstruction overhead and preserved fields; prove equivalence to the external serialized representation with boundary tests. Preference records maintain their own encoded contribution; preference and document transactions read the relevant small counters consistently so concurrent writes cannot bypass the complete-state limit. An oversized preference change may remain session-local with a preference-save error, without making saved document content unsaved. Keep existing project/generator limits unchanged.

## 6. Persistence interface and acknowledgements

Keep persistence implementation behind `LocalWorkspaceStore`; do not expose a parallel raw database interface to React. Bootstrap and recovery export remain deep operations. Evolve `commit` with typed incremental-document and preference commands and small results for those commands. Existing structural commands may retain full snapshot results when necessary; ordinary saves may not.

An incremental command identifies the project/incarnation, editor generation, expected durable document revision, and record puts/deletes. A preference command contains only its small preference changes and independent ordering information.

An ordinary successful save returns project identity, admitted generation, committed revision, and bounded verification metadata. It never returns the document or workspace. The editor already owns its immutable working document and advances authority using the acknowledgement, not a replacement snapshot.

Preserve lineage protection across pending generations, close/delete/recreate, imports, and authority loss. Exported private persistence metadata must not leak into project JSON, generator source, or analytics.

## 7. Scheduling and worker execution

Use an initial trailing debounce of 500 ms and a maximum pending wait of 2 seconds for document edits. Preference writes use a separate 1-second debounce and 5-second maximum pending wait. These are scheduling targets in an active tab, not durability guarantees or promises about suspended tabs.

- Start timing at the first pending change; continuing edits must not reset the maximum-wait deadline.
- Coalesce the latest value per record. Handle create/update/delete/recreate sequences explicitly.
- Permit only one in-flight document batch per project. Keep later edits in a separate pending batch.
- If a batch is in flight when the deadline expires, flush pending work promptly after completion; do not queue obsolete complete snapshots.
- Validate dependencies and assign expected durable revision when the ordered batch is ready for execution.
- Structural commands form barriers where needed. Close/navigation flows cannot outrun required document persistence. Mere page/template navigation never creates such a barrier.
- Explicit save/retry and guarded project-close flows flush pending work. Visibility changes may request a best-effort flush; `beforeunload` is not an asynchronous durability mechanism.

Use a long-lived, private persistence worker to own normalized IndexedDB transactions, changed-record validation/preparation, read-back verification, and durable ordering. Send only changed payloads for ordinary saves. The main-thread module owns editor admission, dirty batching, and acknowledgement publication; it must not run competing normalized database writes. Bootstrap/recovery uses the same worker owner, with legacy localStorage capture bridged from the main thread where browser capability requires it. Explicit bulk import, migration, and export may transfer full data outside the ordinary-save path.

Worker messages have request IDs, bounded acknowledgements, timeout/error handling, and project-incarnation guards. Worker restart cannot blindly replay an uncertain commit: re-read authoritative revision/commit identity first and either acknowledge the completed batch or report conflict. Preserve latest unsaved in-memory content on failure.

## 8. Atomicity, validation, and save status

One logical batch commits all affected records, deletion/reference repairs, size bookkeeping, and the new project revision in one transaction. Compare expected revision and incarnation in that same transaction. Conflicting writes abort rather than silently merge.

Normal read-back verifies the committed revision and changed records without reconstructing the whole workspace. Verify the selected records in a consistent read transaction. If another tab has advanced authority, reconcile using existing conflict rules rather than publishing a stale acknowledgement as current authority. Do not claim this detects unrelated dormant corruption on every save: full workspace/project integrity checks remain at bootstrap, migration, explicit full-document ingress, and recovery/export boundaries where required.

Validate changed records and affected graph relationships. Maintain/rebuild a dependency index so a normal edit does not scan every template to find references. Expensive relationship-wide validation is allowed for genuinely structural bulk operations, but runs off the interaction-critical path. Never validate or hash inside an active transaction using asynchronous non-IDB work.

Save status distinguishes pending/saving, saved, failed, and conflict. A completion clears only the generation it acknowledges; newer edits remain pending. Preference failures cannot label durable document content unsaved or falsely claim preferences were retained. Existing unsaved-work export and navigation guards remain available.

## 9. Verified migration and compatibility

Separate physical v3 store creation from logical normalization. Physical upgrade does not authorize normalized editing and does not delete old records. Existing open connections handle `versionchange` and stop writing; blocked upgrade offers explicit close-other-tabs guidance. Old v2 code cannot open v3 and must not become a competing writer.

For a valid v2 workspace:

1. Keep the editor behind the bootstrap gate. Capture authoritative source revisions/incarnations and original data.
2. Prepare normalized records, reconstruction metadata, and expected canonical digests outside write transactions, using bounded work/worker execution with progress.
3. Write a staged target generation. Interrupted staging is not an editing authority and is safe to retry. Reuse a matching recorded attempt when source identity is unchanged; do not create unbounded new retained copies on each retry. Never reuse a published generation as staging space.
4. Independently reconstruct and verify all migrated project content, ordering, generator source, cloud linkage, supported unknown fields, and ancillary preservation.
5. Atomically publish the verified target authority and normalization ledger only if captured source revisions still match. Never mount an editable mix of source and target records.
6. Reopen/read back the authority marker before granting editing authority. Resume or enter recovery after an interrupted cutover, based on committed ledger state.

Retain existing v1 repair and legacy localStorage admission rules as prerequisites; an invalid historical source does not become valid merely because v3 stores exist. Update older ledger-version checks explicitly rather than reinterpreting an old verified ledger as normalized authority. Fresh installs initialize verified normalized storage without manufacturing a legacy migration.

Quota failure, corrupt records, missing target records, interrupted verification, or uncertain authority stop cutover and expose recovery/export. Preserve source content; do not clear site data, select an arbitrary winner, or delete partial data without the approved recovery policy. Retention temporarily increases storage use and must be included in quota tests and user-facing migration errors.

Do not dual-write old and new project representations during normal editing. After cutover, old project records are historical recovery sources, not a live rollback copy. Downgrading must never silently replace newer normalized edits with those stale sources. Recovery exports identify the active normalized data and retained historical source distinctly.

External `AppState`/project JSON remains compatible through assembly/disassembly at explicit load, export, import, generator, and cloud boundaries. Full-document operations may be proportional to document size; routine autosave must not invoke them. Purely local decomposition alone does not require a public document-schema bump.

## 10. Delivery stages and affected areas

1. Establish browser baseline and isolated large-project fixtures; inventory all mutation paths and state classifications.
2. Implement immutable document changes/history and preference separation, with existing storage still behind its current authority rules during development.
3. Implement normalized records, incremental validation/accounting, transactions, worker protocol, and verified migration behind the bootstrap gate.
4. Integrate batching and small acknowledgements; remove monolithic ordinary-save preparation/read-back/publication. Enable only when every editor mutation path is covered.
5. Verify browser performance, cross-tab behavior, migration/recovery, external-format compatibility, and current build/tests before any rollout.

Primary affected files/modules: `types.ts` and document-state helpers; `ProjectEditor.tsx`; editor child callbacks where semantic edits originate; `projectDocumentSnapshot.ts`; `EditorPage.tsx`; `useWorkspaceProjectWrites.ts`; `services/localWorkspace/` contracts, authority, queue, schema, adapter, validation, worker, bootstrap, migration and recovery; workspace save/migration UI; JSON/import/export/cloud adapters where assembly is needed; architecture/state-management documentation and tests.

Do not ship an intermediate state that mutates shared objects, loses persistence for an editing path, bypasses revision checks, or upgrades user storage before complete recovery support exists.

## 11. Acceptance and verification

### Deterministic work-budget tests

- Navigation, selection, zoom, tools, dialogs, and panel changes cause zero document record writes, document revision changes, or full-document clones.
- Reload restores committed location/variant/zoom, with safe fallbacks after deletion.
- Editing one template writes only that template plus required bounded metadata; unrelated templates/projects/presets/imports are not read, cloned, validated, or written.
- Unchanged document records retain object identity during edits, acknowledgement, undo, and redo.
- Normal undo/redo does not deep-clone the document and emits exactly the affected dirty records.
- Ordinary autosave worker transfers and commit results contain no complete project/workspace; explicit bulk operations are tested separately.
- Fake-timer tests prove debounce, maximum wait, single-flight behavior, coalescing, and preservation of edits made during saves.
- Aggregate size accounting agrees with actual assembled serialization at/over the existing limit, including extensions, escaping, and structural changes.

### Correctness and failure tests

- Round-trip existing valid projects through decomposition/reconstruction, including multiple variants, source scripts, unknown fields, cloud metadata, presets and pending imports.
- Cover multi-record rollback, deletion/reference handling, ID reuse, close/recreate, stale acknowledgements, retries, cross-tab conflicts, worker crash/timeout before and after commit, quota exhaustion, and corrupt read-back.
- Interrupt migration at each durable phase and prove there is exactly one recognized editing authority, no partial editable document, and no lost source data.
- Test direct historical upgrade paths, blocked upgrades, fresh installs, reopening after cutover, and refusal of incompatible old writers.
- Preserve JSON/PDF/generator behavior and cloud snapshot compatibility. Bulk replacement followed by undo must persist and reload correctly.

### Browser performance proof

Use small control, current Sticker Press fixture (approximately 21.2 MB serialized), and several large projects in one workspace. Exercise page/template navigation, zoom/panel resizing, label editing, continuous drag, undo/redo, and bulk replacement. Use isolated profiles, production builds, documented hardware/browser versions, and repeated runs; report development-mode results separately.

Record input-to-next-paint latency, long-task durations, clone/validation/transfer/write/read-back timings, bytes/records processed, heap trend, and time to the newest durable revision. Initial acceptance target on the documented reference environment: p95 input-to-next-paint below 100 ms for normal navigation/editing while autosave is active, and no persistence-attributed main-thread task of 50 ms or longer for ordinary single-record edits. These are targets to demonstrate, not current measurements or guarantees on every device.

If a target fails, identify whether remaining cost is persistence, history, React rendering, or large-record processing; do not call the interaction issue fixed based only on faster database writes. Genuinely bulk operations have explicit progress and are measured separately. Include Chromium, Firefox, and WebKit correctness coverage; report browser-specific performance limitations honestly.

Run focused tests alongside implementation, then repository unit/integration suites, relevant browser suites, and production build. Record pre-existing failures separately; never classify a new failure as pre-existing without baseline evidence. Persist only timing/count diagnostics, not project names, content, scripts, or hashes in analytics.

## 12. Alternatives and review gate

Rejected as the primary solution: longer autosave intervals, `setTimeout` around whole-project work, or worker-only full-project round trips. They postpone or relocate some cost without eliminating write/copy amplification. Worker execution remains useful within the selected incremental design.

Deferred: per-element records, asset deduplication, and incremental cloud sync. Template records are the initial granularity; revisit only if measurements show a single template remains a blocking payload.

Next step after user review: create a dependency-ordered implementation plan with explicit contracts, failing tests, migration fault checkpoints, browser proof commands, and bounded delivery tasks. No commit, deployment, server restart, or user-data migration is part of writing this specification.
