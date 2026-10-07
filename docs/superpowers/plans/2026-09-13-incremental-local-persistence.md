# Incremental Local Persistence Implementation Plan

## Local Task 1 execution addendum (2026-09-13)

The controller approved `scripts/capture-incremental-inputs.mjs` and
`tests/unit/incrementalInputCapture.test.ts` as a narrow artifact-generation
deviation. Text tools truncate the source template's generated navigation line.
The tested utility captures only the four exact approved inputs as byte buffers,
checks all destinations before generation, refuses differing existing bytes,
allows identical retries, and verifies byte identity and SHA-256. The source
worktree remains read-only. The approved plan was captured with SHA-256
`5efab6694ea0f587b772d0f55dbfafb60b4493a5d07574f0b020bf037d4b576c`
before this local-only addendum. No application behavior is added by this utility.

## Approved Task 4 ownership addendum (2026-09-14)

The user approved `../specs/2026-09-14-layer-fold-history-ownership-design.md`.
Execute Task 4 with `2026-09-14-layer-fold-history-ownership.md`, which adds
explicit layer correspondence, reversible fold effects and a partition-aware
history owner. Its expanded file scope and additive APIs supplement Task 4
below; document-only shared contracts stay intact. The addendum also binds
downstream codec, validation, atomic persistence and stale-preference gates.
No production cutover or user database operation is authorized.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make large-project navigation and editing responsive by persisting changed records, separating preferences, batching writes, and removing whole-document history/save cloning.

**Architecture:** A pure immutable document-editing module produces explicit record changes and structurally shared history. `LocalWorkspaceStore` admits ordered batches and publishes small acknowledgements; one long-lived worker owns normalized IndexedDB storage, validation, transactions, migration, and durable authority. A verified v3 cutover retains historical data and keeps existing external project formats compatible.

**Tech Stack:** React 19, TypeScript 5.8, Vite 6, IndexedDB through `idb` 8, module workers, Web Crypto, Vitest 4, fake-indexeddb 6, Testing Library, Playwright Chromium/Firefox/WebKit; Node 22. No new runtime dependency is required.

## Global Constraints

- Approved spec: `docs/superpowers/specs/2026-09-13-incremental-local-persistence-design.md`.
- Database name remains `doctect-local-workspace`; normalized physical schema version is exactly `3`.
- Document scheduling: trailing debounce `500 ms`, maximum pending wait `2 seconds`.
- Preference scheduling: trailing debounce `1 second`, maximum pending wait `5 seconds`.
- Preserve the existing `50`-entry undo bound; ordinary history operations must not deep-clone documents.
- Keep project/generator limits unchanged. Incremental accounting must agree with the complete persisted external representation, including UTF-8 encoding and preserved extensions.
- Keep public project JSON, generator, PDF, and cloud snapshot formats compatible. No incremental cloud sync or automatic cross-tab merge.
- Initial storage granularity is node/template, not individual elements. No artwork deduplication, compression, or garbage collection.
- Preferences restore page/template, variant, and zoom without changing document revision, modification time, or undo history.
- No whole-document diff/clone/hash/validation, whole-workspace read-back, or full-project worker round trip on ordinary saves.
- Normalize behind the existing persistence seam. No React access to raw IndexedDB; keep capability-policy tests meaningful.
- Preserve incarnation/revision admission, atomic multi-record writes, unknown fields, generator scripts, cloud links, import provenance, recovery capabilities, and strict historical-source validation.
- Retain source records. No dual-writing, silent fallback editing, arbitrary conflict winner, site-data clearing, or destructive cleanup.
- Never automatically migrate the user's existing browser profile during development. New isolated worktree, alternate localhost ports, and fresh Playwright contexts are mandatory before production-code edits.
- Do not disturb the Sticker Press worktree, its uncommitted files, `.superpowers/sdd/task-6-report.md`, or its running localhost app.
- No commits, staging, branch integration, deployment, or destructive operations without explicit user authorization. Task review checkpoints replace automatic commits in this plan.
- If delegating, honor the user's Astra High requirement: verify `openai/gpt-6-astra` with variant `high`; do not silently use an unverified default subagent.
- Dependency installation, if needed: `npm ci --legacy-peer-deps`. Production build: `npm run build --legacy-peer-deps`.

---

## Execution isolation and baseline

Source worktree for the approved documents and latest sample:

`/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/sticker-press-redesign`

Use `using-git-worktrees` before execution to establish a separate worktree/branch from the source HEAD. Carry only these approved plan/spec documents and explicitly named fixture inputs into it; do not copy all dirty changes or snapshot the source index. The source worktree remains read-only. Do not use ports 3000/3001 for verification.

The sample's newest scripts are uncommitted in the source worktree. Task 1 captures their exact bytes as named test fixture inputs, avoiding reliance on a different checkout's current gallery state. The feature itself must not modify Sticker Press.

Fresh planning baseline, 2026-09-13:

```bash
npx vitest run tests/unit/localWorkspace/mutationQueue.test.ts tests/unit/localWorkspace/projectPreparationClient.test.ts tests/unit/useWorkspaceProjectWrites.test.tsx tests/unit/projectDocumentSnapshot.test.ts
```

Result: **81 tests passed in 4 files**. `useWorkspaceProjectWrites.test.tsx` emitted React `act(...)` warnings in its authoritative-readback test. No performance claim follows from this unit baseline. A previously reported onboarding generated-bundle mismatch is not accepted as a current baseline failure until reproduced in the execution worktree.

## File structure

### Document module: no browser storage or worker imports

| File | Responsibility |
| --- | --- |
| `services/document/contracts.ts` | Document changes, preferences, effects, history types |
| `services/document/partition.ts` | Lossless document/preferences/transient classification and external assembly |
| `services/document/applyChanges.ts` | Immutable record application and exact changed-address receipts |
| `services/document/editOperations.ts` | Existing semantic editing behavior expressed as explicit changes |
| `services/document/history.ts` | Structurally shared undo/redo and gesture grouping |
| `services/document/references.ts` | Dependency index and affected-reference selection |

### Private persistence implementation

| File | Responsibility |
| --- | --- |
| `services/localWorkspace/normalized/schema.ts` | v3 stores, physical keys, generation/ledger/record types |
| `services/localWorkspace/normalized/codec.ts` | Pure lossless decomposition/reconstruction |
| `services/localWorkspace/normalized/sizeLedger.ts` | Exact incremental serialized-size accounting |
| `services/localWorkspace/normalized/validateChanges.ts` | Changed-record and affected-relationship validation |
| `services/localWorkspace/normalized/repository.ts` | Atomic IDB operations, CAS, selected read-back; sole normalized writer |
| `services/localWorkspace/normalized/migration.ts` | Staging, independent verification, authority cutover |
| `services/localWorkspace/normalized/coordinator.ts` | Worker-side command ordering and durable state |
| `services/localWorkspace/incrementalQueue.ts` | Main-thread dirty batching, deadlines, single-flight admission |
| `services/localWorkspace/workspaceWorkerProtocol.ts` | Closed typed request/response protocol |
| `services/localWorkspace/workspaceWorkerClient.ts` | Long-lived worker lifecycle, IDs, bounded response checks |
| `services/localWorkspace/workspaceWorker.ts` | Worker entry; delegates to the coordinator |

Modify `contracts.ts`, `LocalWorkspaceStore.ts`, `index.ts`, `projectAuthority.ts`, `schema.ts`, `indexedDbAdapter.ts`, legacy migration/recovery helpers, and existing preparation/queue modules only where their current responsibilities transfer. Do not build a second public storage facade.

### Integration and verification

- Modify `components/ProjectEditor.tsx`, `pages/EditorPage.tsx`, `hooks/useWorkspaceProjectWrites.ts`, `services/projectDocumentSnapshot.ts` and child callback types where required.
- Modify `components/Canvas.tsx` for explicit gesture completion/cancel signals if current callback contract cannot delimit history groups; preserve gesture behavior.
- Modify `components/workspace/LocalSaveStatus.tsx`, bootstrap/progress/recovery screens, and navigation guards for small acknowledgements and separate preference status.
- Modify `tests/helpers/fakeLocalWorkspaceStore.ts` and current authority/history/workspace tests with the new public contracts.
- Add `tests/helpers/incrementalFixtures.ts`, `tests/helpers/incrementalStoreHarness.ts`, `tests/helpers/incrementalWorkerHarness.ts`.
- Add task-named tests under `tests/unit/document/` and `tests/unit/localWorkspace/normalized/` plus the integration/browser files named below.
- Add `tests/e2e/incremental_local_persistence.spec.ts`, `tests/e2e/incremental_migration.spec.ts`, `tests/e2e/incremental_performance.spec.ts`, and `tests/e2e/incrementalBrowserHarness.ts`.
- Modify `tests/unit/localWorkspaceBoundary.test.ts` narrowly for authorized private files/worker capabilities; add negative fixtures proving unauthorized access is still rejected.
- Update `docs/1-high-level-architecture.md`, `docs/3-state-management.md`, and record measurements in `docs/superpowers/plans/2026-09-13-incremental-local-persistence-results.md`.

## Dependency graph and rollout gates

```text
1 baseline/fixtures
  -> 2 state partition -> 3 changes/references -> 4 history
  -> 5 normalized codec -> 6 incremental validation/size
3 + 6 -> 7 transactions -> 8 worker owner
3 -> 9 scheduling
2 + 4 -> 10 editor mutation routes (not publicly enabled)
7 + 8 -> 11 migration/recovery -> 12 store authority/structural commands
9 + 10 + 12 -> 13 UI integration and single cutover
13 -> 14 compatibility/browser failures -> 15 performance/release verification
```

Tasks 2–10 can be reviewed independently behind private test seams. Do not change the production database version or mount the new editor write path until Task 13. The v3 repository accepts an injected factory/name for isolated tests; its schema definition alone must not trigger opening a user's database.

Checkpoint A after Task 4: immutable editing/history correct. Checkpoint B after Task 9: incremental engine correct under fake storage and worker faults. Checkpoint C after Task 12: historical recovery and all structural commands correct. Checkpoint D after Task 15: production browser evidence and rollout approval required.

## Shared contracts: define once, reuse exact names

Task 2 defines these types in `services/document/contracts.ts`. Existing `AppNode`, `PageTemplate`, `Variant`, `GeneratorProvenance`, and `AppState` come from `types.ts`.

```ts
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
```

Schema-version changes and whole-document JSON/generator replacement use an explicit bulk command, not a disguised ordinary edit. Wrapper metadata is a separate typed metadata command; do not lose cloud updates because they are not undoable document content.

Task 7 defines private storage commands; Task 12 exposes the admitted public equivalents through `contracts.ts`:

```ts
export interface ProjectScope {
  storageGeneration: string;
  projectId: string;
  incarnation: string;
}
export interface DocumentBatch {
  scope: ProjectScope;
  commitId: string;
  editorGeneration: number;
  expectedRevision: number;
  changes: readonly DocumentChange[];
}
export interface DocumentSaveAck {
  type: 'document-saved';
  projectId: string;
  incarnation: string;
  commitId: string;
  editorGeneration: number;
  revision: number;
}
export interface PreferenceBatch {
  scope: ProjectScope;
  commitId: string;
  editorGeneration: number;
  patch: Partial<EditorPreferences>;
}
export interface PreferenceSaveAck {
  type: 'preferences-saved';
  projectId: string;
  incarnation: string;
  commitId: string;
  editorGeneration: number;
  preferenceRevision: number;
}
```

`storageGeneration` is private migration namespace, `incarnation` distinguishes reused project IDs, `revision` is durable CAS order, and `editorGeneration` identifies in-memory edits. Never substitute one for another. Public callers obtain opaque authority from installed projects; they cannot grant themselves a `ProjectScope` by supplying arbitrary strings. The store resolves public admission into these private envelopes.

Every task below follows RED → GREEN → review. Run the exact listed focused command before production edits and again afterward. A new test must fail for the intended missing behavior, not a broken fixture. Existing passing suites are regression checks, not proof of RED.

---

### Task 1: Reproducible fixtures, baseline, and safe browser harness

**Files:** Create `tests/helpers/incrementalFixtures.ts`, `tests/unit/incrementalFixtures.test.ts`, `tests/fixtures/incremental/sticker-press/templates.js`, `tests/fixtures/incremental/sticker-press/hierarchy.js`, `tests/fixtures/incremental/sticker-press/README.md`, `tests/e2e/incrementalBrowserHarness.ts`, `tests/e2e/incremental_performance.spec.ts`, `scripts/verify-incremental-persistence.mjs`, and `tests/unit/incrementalVerificationLauncher.test.ts`. Modify `playwright.config.cjs` only to add isolated incremental browser projects without unlimited-storage flags for performance/quota runs. The baseline runner and measurement-only test exist now; Task 15 adds final assertions.

**Interfaces:** `makeIncrementalProject(templateCount?: number): WorkspaceProject`; `loadStickerPressProject(): WorkspaceProject`. Browser helper exports `openIncrementalEditor(page: Page): Promise<void>`, `importIncrementalProject(page: Page, project: WorkspaceProject): Promise<void>`, `readDownloadedProject(page: Page): Promise<WorkspaceProject>`, and `observeIncrementalPerformance(page: Page): Promise<void>`; use real UI import/export, not source-module imports in production builds.

- [ ] Copy only the two trusted generator source files from the read-only Sticker Press worktree into the named test fixture files using approved file tools. Record SHA-256 fingerprints, source path/date, and retained artwork-credit provenance in fixture README. Do not check in generated 21 MB JSON.
- [ ] Write the fixture contract and run `npx vitest run tests/unit/incrementalFixtures.test.ts` to verify RED:

```ts
it('reproduces the approved large fixture without a database', () => {
  const project = loadStickerPressProject();
  expect(Object.keys(project.initialState.variants)).toHaveLength(4);
  expect(Object.keys(project.initialState.nodes)).toHaveLength(437);
  const bytes = new TextEncoder().encode(JSON.stringify(project.initialState)).length;
  expect(bytes).toBeGreaterThan(20_000_000);
  expect(bytes).toBeLessThan(MAX_STATE_BYTES);
});
```

- [ ] Implement fixture assembly using the existing `validateGeneratedProject`, `createGeneratedAppState`, and `createBlankProject` functions, preserving the source scripts. Execute only the trusted fixture scripts, never arbitrary downloaded code. Small fixtures build on `currentState()` from `tests/helpers/localWorkspaceFixtures.ts` and create distinct template IDs.
- [ ] Make the browser harness use fresh contexts and actual JSON/modal controls; scope all database inspection to these contexts. Stub authentication/analytics requests for local-only production performance runs. Do not install a production window debug object or import `/services/*.ts` from a built bundle.
- [ ] Implement and test the verification launcher's environment/port contract specified in Task 15 before collecting baseline. Set `INCREMENTAL_PERFORMANCE_PHASE=baseline` for baseline and `final` for final; the browser spec records the same scenarios in both modes but asserts future budgets only in final mode. Give the dedicated performance project exact `testMatch: /incremental_performance\.spec\.ts$/`; exclude that file from generic browser projects to avoid duplicate or accidentally unlimited-quota runs.
- [ ] Run the fixture and launcher tests GREEN, the 81-test baseline command, and `npx vitest run` before production behavior changes. Record fresh failures/warnings. Capture a built-browser baseline with the large fixture, including navigation, one label edit, drag, and undo. Collect timings without asserting the future latency target yet:

```bash
node scripts/verify-incremental-persistence.mjs --phase baseline --web-port 4310 --api-port 4311 --output-dir /tmp/opencode/doctect-incremental-baseline-20260913
```

Baseline mode runs fixture/launcher tests, full unit baseline, production build, and measurement-only performance project. It does not try to run future incremental migration/correctness files. Keep unavailable stage-level baseline counters explicitly absent, not fabricated zeros. Do not add main-thread full serialization merely to measure payload size.
- [ ] Review fixture determinism and browser isolation. No user profile or existing server touched.

### Task 2: Lossless state partition and preference projection

**Files:** Create `services/document/contracts.ts`, `services/document/partition.ts`, `tests/unit/document/partition.test.ts`. Consume Task 1 fixtures.

**Interfaces:** `partitionState(state: AppState): PartitionedState`; `assembleState(parts: PartitionedState): AppState`; `resolvePreferences(document: DocumentState, preferences: EditorPreferences): EditorPreferences`. Assembly is an explicit full-state operation, never a per-keystroke save helper.

- [ ] Write and run `npx vitest run tests/unit/document/partition.test.ts` RED:

```ts
it('round-trips the serialized state without making navigation content', () => {
  const state = makeIncrementalProject().initialState;
  const parts = partitionState(state);
  expect(assembleState(parts)).toEqual(state);
  expect(parts.document).not.toHaveProperty('selectedNodeId');
  expect(parts.document).not.toHaveProperty('scale');
  expect(parts.preferences.activeVariantId).toBe(state.activeVariantId);
});
```

- [ ] Implement an explicit field-classification table. Move nested `layers[].collapsed` into `layerCollapsed` addressed by `JSON.stringify([variantId, templateId, layerId])`. Record field presence so absence remains absence on reconstruction. Preserve all supported unknown fields in compatibility data or their owning record. Do not flatten IDs using delimiters that can collide.
- [ ] Add cases for every `AppState` field, unknown wrapper/state/variant/layer fields, optional generator, false/zero values, removed selections, active variant fallback, transient reset at live hydration, and exact raw round-trip before hydration. Do not tighten accepted historical content silently.
- [ ] GREEN command above. Review that lightweight preference projection does not traverse all templates; perform full nested decomposition once at ingress, then project only the active template's UI fields for rendering.

### Task 3: Explicit immutable changes and reference index

**Files:** Create `services/document/applyChanges.ts`, `services/document/references.ts`, `services/document/editOperations.ts`, `tests/unit/document/applyChanges.test.ts`, `tests/unit/document/references.test.ts`.

**Interfaces:** `applyDocumentChanges(document: DocumentState, changes: readonly DocumentChange[]): DocumentEdit`; `buildReferenceIndex(document: DocumentState): ReferenceIndex`; `updateReferenceIndex(index: ReferenceIndex, edit: DocumentEdit): ReferenceIndex`; `affectedReferences(index: ReferenceIndex, addresses: readonly RecordAddress[]): readonly RecordAddress[]`. `ReferenceIndex` maps referenced IDs to sets of owning addresses and is private to the document/validation implementation. `editOperations.ts` exports the current editor operations as change constructors, preserving their existing argument contracts rather than adding a generic full-state setter.

- [ ] Write and run `npx vitest run tests/unit/document/applyChanges.test.ts tests/unit/document/references.test.ts` RED:

```ts
it('reuses unrelated templates and records only the changed address', () => {
  const document = partitionState(makeIncrementalProject(2).initialState).document;
  const [first, second] = Object.values(document.variants.default.templates);
  const edit = applyDocumentChanges(document, [{
    type: 'put-template', variantId: 'default', template: { ...first, name: 'Edited' },
  }]);
  expect(edit.after.variants.default.templates[second.id]).toBe(second);
  expect(edit.after.nodes).toBe(document.nodes);
  expect(edit.affected).toEqual([{ kind: 'template', variantId: 'default', templateId: first.id }]);
  expect(document.variants.default.templates[first.id].name).toBe(first.name);
});
```

- [ ] Implement copy-on-write at record and ancestor-map granularity. Reject malformed change identity before application; apply an entire logical change set before checking relational validity. Return the original document and no effects for reference-identical no-ops. Do not deep-freeze/traverse the whole document per edit; tests recursively freeze fixtures before editing instead.
- [ ] Build references once at ingress; update entries only for old/new changed records. Cover `AppNode.type`, parent/children, `referenceId`, element links, grid sources, and any existing template fallback rules. Preserve existing allowed unresolved/fallback semantics; do not require every variant to define every node type if current formats permit fallback.
- [ ] Add add/delete/recreate ordering, multiple changes to one record, variant deletion expansion, root changes, generator removal, unknown fields, and reference-repair tests. Deleting a variant must enumerate its templates once as a bulk structural edit, not leave hidden records.
- [ ] GREEN both test files; review absence of full deep comparisons and deep clones.

### Task 4: Structurally shared history with exact persistence effects

**Files:** Create `services/document/history.ts`, `tests/unit/document/history.test.ts`. Modify `services/projectDocumentSnapshot.ts` only after replacing its mutation-isolation contract; retain external helpers until integration migrates callers.

**Interfaces:** `createDocumentHistory(limit?: number): DocumentHistory`; `recordDocumentEdit(history: DocumentHistory, edit: DocumentEdit, groupId?: string, selection?: HistorySelectionPair): DocumentHistory`; `undoDocument(history: DocumentHistory, current: DocumentState): HistoryResult`; `redoDocument(history: DocumentHistory, current: DocumentState): HistoryResult`. `HistoryResult` contains `{ history, document, changes, selection? }`; history entries retain immutable before/after references, affected addresses, and optional small selection context. `HistorySelection` is `Pick<AppState, 'activeVariantId' | 'selectedNodeId' | 'selectedNodeIds' | 'selectedTemplateId' | 'selectedTemplateIds' | 'selectedElementIds' | 'activeLayerId'>`; `HistorySelectionPair` holds `{ before: HistorySelection; after: HistorySelection }`. Grouping retains the first before-selection and latest after-selection; restoration resolves invalid IDs against the restored document before publishing preference changes.

- [ ] Write and run `npx vitest run tests/unit/document/history.test.ts tests/unit/projectDocumentSnapshot.test.ts` RED for the new behavior:

```ts
it('undoes by reference and emits the old value for the changed record', () => {
  const document = partitionState(makeIncrementalProject().initialState).document;
  const node = document.nodes.root;
  const edit = applyDocumentChanges(document, [{ type: 'put-node', node: { ...node, title: 'New' } }]);
  const history = recordDocumentEdit(createDocumentHistory(50), edit);
  const result = undoDocument(history, edit.after);
  expect(result.document).toBe(document);
  expect(result.changes).toEqual([{ type: 'put-node', node }]);
});
```

- [ ] Restore record values by address from the retained target snapshot, not by whole-document comparison. Merge affected-address sets across a gesture group; preserve the first before reference and latest after reference. New edits clear redo. Cap history at 50 and release discarded references.
- [ ] Test redo, add/delete inversion, variant membership, generator replacement, selection-only navigation, group boundaries, canceled gestures, full-document replacement as an explicit bulk history entry, and immutability after later edits. Undoing full replacement is allowed to produce a bulk replacement effect.
- [ ] GREEN focused tests; review with existing `ProjectEditor.generatorHistory.test.tsx` semantics. Do not remove the current safe clone path from live editor before all mutation callers are converted.

### Task 5: Normalized v3 schema and lossless codec

**Files:** Create `services/localWorkspace/normalized/schema.ts`, `services/localWorkspace/normalized/codec.ts`, `tests/unit/localWorkspace/normalized/codec.test.ts`. Do not yet change production `WORKSPACE_DB_VERSION`.

**Interfaces:** `decomposeProject(project: WorkspaceProject, scope: ProjectScope): NormalizedProject`; `reconstructProject(records: NormalizedProject): WorkspaceProject`. `NormalizedProject` owns typed maps for the exact stores below plus ordering, compatibility, and encoded-size contributions. All assembly/disassembly is bulk-only.

Exact new stores: `projectHeaders`, `projectNodes`, `projectVariants`, `projectTemplates`, `projectSources`, `projectExtensions`, `projectPreferences`, `normalizationLedger`. Retain existing stores. Keys begin with storage generation; child keys include project ID/incarnation and then their semantic IDs. Header identity is `[storageGeneration, projectId]`; templates use `[storageGeneration, projectId, incarnation, variantId, templateId]`. Ledger key is `incremental-local-persistence-v3`.

- [ ] Write and run `npx vitest run tests/unit/localWorkspace/normalized/codec.test.ts` RED:

```ts
it('keeps source, cloud linkage, extensions, and array order', () => {
  const project = makeIncrementalProject(2);
  project.retained = { text: 'Café ☕', empty: [] };
  const scope = { storageGeneration: 'g1', projectId: project.id, incarnation: 'i1' };
  expect(reconstructProject(decomposeProject(project, scope))).toEqual(project);
});
```

- [ ] Implement the exact physical key model and record validation. Header stores only small metadata/counters/last commit; potentially large unknown wrapper/state extensions go to `projectExtensions`. Variant ordering is separate from template payloads and changes only on membership/reordering. Preserve numeric-like IDs, array ordering, absent optional values, and duplicate IDs across variants without collisions.
- [ ] Add round-trips of every historical valid state after existing migration, actual Sticker Press, large extensions, nested collapsed preferences, source scripts, and wrapper metadata. Reject unrecognized storage records rather than silently skipping them. Test scoped reads cannot expose another incarnation or generation.
- [ ] GREEN codec tests; review that no code opens/upgrades a database merely by importing schema or codec.

### Task 6: Exact size ledger and incremental validation

**Files:** Create `services/localWorkspace/normalized/sizeLedger.ts`, `services/localWorkspace/normalized/validateChanges.ts`, `tests/unit/localWorkspace/normalized/sizeLedger.test.ts`, `tests/unit/localWorkspace/normalized/validateChanges.test.ts`.

**Interfaces:** `createSizeLedger(project: NormalizedProject): SizeLedger`; `applySizeChanges(ledger: SizeLedger, before: NormalizedProjectSlice, after: NormalizedProjectSlice): SizeLedger`; `validateIncrementalChanges(context: ValidationContext, changes: readonly DocumentChange[]): PreparedChanges`. `NormalizedProjectSlice` contains only selected old/new records and affected container metadata; `ValidationContext` supplies cached membership/references and encoded counters. `PreparedChanges` contains validated puts/deletes, per-record digests/bytes, counter deltas, and affected-reference changes, never a reconstructed project.

- [ ] Write table-driven tests against full `JSON.stringify` byte length and run `npx vitest run tests/unit/localWorkspace/normalized/sizeLedger.test.ts tests/unit/localWorkspace/normalized/validateChanges.test.ts` RED:

```ts
it.each(['plain', 'Café ☕', '"\\\n', '\uD800'])('counts UTF-8 and escaping: %s', title => {
  const project = makeIncrementalProject();
  project.initialState.nodes.root.title = title;
  const scope = { storageGeneration: 'g1', projectId: project.id, incarnation: 'i1' };
  const ledger = createSizeLedger(decomposeProject(project, scope));
  expect(ledger.stateBytes).toBe(new TextEncoder().encode(JSON.stringify(project.initialState)).length);
});
```

- [ ] Track JSON object contributions as encoded key + colon + value, plus container braces and `max(0, memberCount - 1)` commas. Track nested-container deltas up their fixed ancestor path. Maintain field-presence and preference-overlay contributions, including nested layer collapse. Do not approximate bytes using JS string length or reserve arbitrary headroom that rejects previously valid documents.
- [ ] Validate changed payloads with the current schema's rules, changed references via Task 3 index, and aggregate limits via counters. Full ingress/recovery uses current complete validators. Split reusable per-record validators from `shared/validateAppState.js` only if needed, retaining server behavior and tests.
- [ ] Test exact cap/one byte over, add/remove last entry, preference/document concurrent counter effects, repeated edits, extensions, source replacement, invalid layers/SVG/text options, and existing fallback semantics. Spy on selected-record reads to fail if unrelated templates are visited. Session-only clipboard changes do not alter persisted accounting; explicit export still validates its assembled live payload.
- [ ] GREEN both test files and `npx vitest run tests/unit/localWorkspace/validation.test.ts`. Review that validation/preparation performs no async work inside a write transaction.

### Task 7: Atomic changed-record transactions and verified acknowledgements

**Files:** Create `services/localWorkspace/normalized/repository.ts`, `tests/helpers/incrementalStoreHarness.ts`, `tests/unit/localWorkspace/normalized/repository.test.ts`.

**Interfaces:** `createNormalizedRepository(environment: NormalizedEnvironment): NormalizedRepository`; repository methods `commitDocument(batch: DocumentBatch): Promise<DocumentSaveAck>`, `commitPreferences(batch: PreferenceBatch): Promise<PreferenceSaveAck>`, and `inspectCommit(scope: ProjectScope, commitId: string): Promise<CommitInspection>`. `NormalizedEnvironment` injects IDB factory/name, clock, hashing, and synchronous fault hooks. `CommitInspection` is a discriminated committed/conflict/not-committed result, never a guessed success. Test helper `createIncrementalStoreHarness(project?: WorkspaceProject)` returns repository, scope, recorded reads/writes, fault injection, and a fresh-reader export function.

Task 11 extends this same repository with the following private operations, not another database writer: `readNormalizationSource(): Promise<NormalizationSource>`, `reserveNormalization(source: NormalizationSource): Promise<NormalizationAttempt>`, `stageNormalization(attempt: NormalizationAttempt, records: readonly NormalizedRecord[]): Promise<NormalizationAttempt>`, `readStagedProject(attempt: NormalizationAttempt, projectId: string): Promise<NormalizedProject>`, `markNormalizationVerified(attempt: NormalizationAttempt, digest: string): Promise<NormalizationAttempt>`, `activateNormalization(attempt: NormalizationAttempt): Promise<ActiveAuthority>`, `readActiveAuthority(): Promise<ActiveAuthority | undefined>`, and `exportGeneration(storageGeneration: string): Promise<WorkspaceSnapshot>`. Define the types in `normalized/schema.ts`: source holds original validated records/ledger and captured revisions/digests; attempt holds ledger identity, source digest, target generation, phase, and CAS progress revision; active authority holds the verified generation and cutover revision; `NormalizedRecord` is the tagged union of the eight exact physical store value types. Task 12 adds `executeStructural(command: StructuralWorkspaceCommand): Promise<WorkspaceSnapshot>` behind this same owner, consuming the existing non-save command union.

- [ ] Write and run `npx vitest run tests/unit/localWorkspace/normalized/repository.test.ts` RED:

```ts
it('commits one node and a revision without returning document data', async () => {
  const project = makeIncrementalProject();
  const h = await createIncrementalStoreHarness(project);
  h.clearOperations();
  const ack = await h.repository.commitDocument({
    scope: h.scope, commitId: 'c1', editorGeneration: 1, expectedRevision: 0,
    changes: [{ type: 'put-node', node: { ...project.initialState.nodes.root, title: 'Changed' } }],
  });
  expect(ack).toMatchObject({ type: 'document-saved', commitId: 'c1', revision: 1 });
  expect(ack).not.toHaveProperty('project');
  expect(h.operations.some(op => op.store === 'projectTemplates')).toBe(false);
  expect(h.operations.some(op => op.method === 'getAll' && op.store === 'projects')).toBe(false);
});
```

- [ ] Prepare changed records outside transactions. Inside one transaction compare header incarnation/revision, write selected puts/deletes, check current preference contribution/counters, and store updated counters/revision/commit identity atomically. Each retained idempotency identity includes client/commit generation; a replay never applies twice.
- [ ] Read changed records/header in one read transaction; compare prepared digests outside it and publish ack only if verified. If another authority advanced, report conflict; do not publish stale current authority. Never read all legacy projects, presets, pending imports, or unrelated normalized payloads for this operation.
- [ ] Add fault tests at every put/delete/header step, conflict before write, read-back corruption, quota abort, unknown commit after connection loss, same ID/new incarnation, selected-record digest mismatch, and last-committed preference-wins without document revision change. Preference-only writes may read small counters but cannot rewrite document headers.
- [ ] GREEN repository suite. Independently reconstruct via a new reader to prove multi-record atomicity and rollback; do not use the writer's memory cache as proof of durability.

### Task 8: Long-lived worker owns storage and ordering

**Files:** Create `services/localWorkspace/workspaceWorkerProtocol.ts`, `workspaceWorkerClient.ts`, `workspaceWorker.ts`, `normalized/coordinator.ts`, `tests/helpers/incrementalWorkerHarness.ts`, `tests/unit/localWorkspace/normalized/workspaceWorker.test.ts`. Modify `tests/unit/localWorkspaceBoundary.test.ts` narrowly.

**Interfaces:** `createWorkspaceWorkerClient(factory?: WorkspaceWorkerFactory): WorkspaceWorkerClient`; client `request(request: WorkspaceWorkerRequest): Promise<WorkspaceWorkerResponse>` and `dispose(): void`. Protocol is a closed union for bootstrap, document batch, preferences, structural command, inspect-commit, and recovery export. `createWorkspaceWorkerHandler(environment: NormalizedEnvironment)` is the shared implementation used by real worker and inline test transport; no separate fake production algorithm. Every envelope carries monotonically unique request ID and protocol version `1`.

- [ ] Write and run `npx vitest run tests/unit/localWorkspace/normalized/workspaceWorker.test.ts` RED. The harness captures posted envelopes and creates a worker factory spy:

```ts
it('reuses a worker and transfers only a changed record', async () => {
  const h = await createIncrementalWorkerHarness(makeIncrementalProject(20));
  await h.saveNodeTitle('first');
  await h.saveNodeTitle('second');
  expect(h.factory).toHaveBeenCalledTimes(1);
  expect(h.documentMessages).toHaveLength(2);
  for (const message of h.documentMessages) {
    expect(message.batch.changes).toHaveLength(1);
    expect(message).not.toHaveProperty('project');
    expect(message).not.toHaveProperty('snapshot');
  }
});
```

- [ ] Route all normalized repository writes through coordinator. Keep legacy localStorage capture/storage-event subscription in main-thread facade; send captured source only during explicit bootstrap/recovery. Module worker has no React imports or network-dependent initialization. Main thread validates only closed envelopes/expected identity/safe integer revisions, not whole returned projects after ordinary saves.
- [ ] Test malformed/wrong request ID, stale incarnation, worker start failure, error/messageerror, timeout, dispose, abrupt termination before/after commit, pending caller rejection, and restart inspection. Persist commit identity before ack; if later authority hides an uncertain commit, report conflict rather than replaying blindly.
- [ ] Extend static capability policy for the exact worker entry and repository; add negative fixtures for UI IndexedDB, unauthorized `localStorage`, dynamic imports bypassing the seam, and a second normalized writer. Do not relax the policy to whole directories without checking transitive imports.
- [ ] GREEN worker test and `npm run check:workspace-boundary`. Review actual Vite module-worker build resolution at final integration, not only fake transport tests.

### Task 9: Dirty-record batching, deadlines, and single-flight queues

**Files:** Create `services/localWorkspace/incrementalQueue.ts`, `tests/unit/localWorkspace/normalized/incrementalQueue.test.ts`. Keep existing `mutationQueue.ts` active until store cutover.

**Interfaces:** `createIncrementalQueue(options: IncrementalQueueOptions): IncrementalQueue`; options inject timers/clock, UUID, and worker transport. Queue methods `enqueueDocument(projectId, editorGeneration, changes)`, `enqueuePreferences(projectId, editorGeneration, patch)`, `flush(projectId?)`, `barrier(operation)`, `freeze(error)`, and `dispose()`. Admission requires installed authority supplied by the store; queue resolves current expected durable revision at dispatch, not by incrementing caller-provided guesses. Flush returns only after relevant acknowledged generations or an explicit failure.

- [ ] Write and run `npx vitest run tests/unit/localWorkspace/normalized/incrementalQueue.test.ts` RED. Use fake timers and controllable promises:

```ts
it('cannot postpone continuous edits beyond the maximum pending wait', async () => {
  vi.useFakeTimers();
  const h = createIncrementalQueueHarness();
  for (let generation = 1; generation <= 5; generation++) {
    h.enqueueTitle(generation, String(generation));
    await vi.advanceTimersByTimeAsync(400);
  }
  expect(h.sent).toHaveLength(1);
  expect(h.sent[0].changes[0].node.title).toBe('5');
  h.dispose();
  vi.useRealTimers();
});
```

`createIncrementalQueueHarness()` is a local helper in this test file that injects Task 8's protocol transport and records batches; define it before this test, with `enqueueTitle(generation: number, title: string)`, `sent: DocumentBatch[]`, `resolveNext()`, `rejectNext(error)`, and `dispose()`.

- [ ] Maintain per-project pending address map, first-pending deadline, trailing deadline, and immutable in-flight batch. Latest puts replace pending values; deletes supersede puts, while delete/recreate preserves required structural order and new identities. No clone occurs at admission. Freeze cancels timers and rejects waiters without discarding in-memory work.
- [ ] Test 500/2000 ms document and 1000/5000 ms preference deadlines, quiet periods, edits arriving during an active write, two projects, stale generations, close barriers, source replacement, retry, max-wait after an in-flight completion, disposal, and preference failure independence. Resolve coalesced waiters without causing one full workspace publication per original action.
- [ ] GREEN queue tests. Review CPU cost before timers: no hidden `structuredClone`, stringify, or full-document reference walk.

### Task 10: Convert every editor mutation route without enabling cutover

**Files:** Modify `components/ProjectEditor.tsx`, `components/Canvas.tsx`, `services/document/editOperations.ts`, `services/projectDocumentSnapshot.ts`. Create `hooks/useDocumentEditor.ts`, `tests/unit/ProjectEditor.incrementalChanges.test.tsx`, `tests/unit/document/editOperations.test.ts`. Update existing `ProjectEditor.generatorHistory.test.tsx`, `projectDocumentSnapshot.test.ts`, and child callback types when needed.

**Interfaces:** `useDocumentEditor(initialState: AppState)` returns document, preferences, session state, current render state, dispatch/edit/history actions, and a generation-tagged effect stream. New editor callbacks are `onDocumentEdit(event: EditorDocumentEvent): void` and `onPreferencesChange(patch: Partial<EditorPreferences>): void`. `EditorDocumentEvent` is `{ kind: 'incremental'; edit: DocumentEdit } | { kind: 'replace'; state: AppState }`. Replacement is explicit and bulk; it does not masquerade as a small edit.

- [ ] Write and run `npx vitest run tests/unit/ProjectEditor.incrementalChanges.test.tsx tests/unit/document/editOperations.test.ts` RED. Use a local `renderIncrementalEditor()` helper that renders real `ProjectEditor` with Task 1 fixture and all required existing callback props, returning Testing Library queries and document/preference spies:

```ts
it('navigates without emitting document changes', async () => {
  const h = renderIncrementalEditor(makeIncrementalProject(2));
  await h.selectTemplate('page-1');
  await h.setZoom(1.5);
  await h.resizeSidebar(340);
  expect(h.onDocumentEdit).not.toHaveBeenCalled();
  expect(h.onPreferencesChange).toHaveBeenCalled();
});
```

The helper's actions drive real exposed controls/callbacks, not a second editor reducer. Define `selectTemplate(id)`, `setZoom(scale)`, and `resizeSidebar(width)` in the test file with existing sidebar/canvas test conventions; do not make production controls conditional on test mode.

- [ ] Convert handlers in reviewable groups, adding one behavioral test before each group: (a) selection/view/zoom/tools/dialogs/clipboard; (b) node add/update/reference/move/duplicate/delete; (c) template add/name/duplicate/delete; (d) variant add/reflow/rename/delete/duplicate; (e) element add/update/delete/paste/duplicate/SVG and layer operations; (f) JSON/generator replacement and undo/redo. Existing operations may clone explicitly duplicated content, never unrelated content.
- [ ] Replace the effect that reports every `AppState` with the explicit event stream. Generate effects once, outside React render/updater side effects; StrictMode must not duplicate dispatches. Preserve callback authority epoch checks. Root-title edits must update root and linked project name in one logical persistence batch, not independent racing saves.
- [ ] Wire pointer start/end/cancel to history groups; persistence checkpoints during a long gesture remain valid. Ensure no shared template/element/node object is mutated by child callbacks, restore, clipboard, reflow, or layer helpers. Full reflow/import may process affected bulk records explicitly.
- [ ] Add a mutation-route checklist in the test file and cover every current `setState` path classified in Task 2. Gate production mounting through existing controller until Task 13; a development compatibility adapter may forward explicit edits to old storage temporarily, but must not ship or be mistaken for incremental performance proof.
- [ ] GREEN focused tests plus `npx vitest run tests/unit/ProjectEditor.generatorHistory.test.tsx tests/unit/ProjectEditor.authority.test.tsx tests/unit/ProjectEditor.exportAllVariants.test.tsx`. Review that history clone removal follows proven immutability, not assumption.

### Task 11: Resumable normalization, independent verification, and recovery exports

**Files:** Create `services/localWorkspace/normalized/migration.ts`, `tests/unit/localWorkspace/normalized/migration.test.ts`. Modify existing `migration.ts`, `lineageRepair.ts`, `recovery.ts`, `schema.ts`, `indexedDbAdapter.ts` only to expose historical validated reads/repair to the worker-owned path; do not yet bump production version. Extend Task 7 harness with migration seeding/interruptions and historical-source export.

**Interfaces:** `normalizeWorkspace(environment: NormalizationEnvironment): Promise<NormalizationResult>`; result is `active` with storage generation and verified workspace, or existing typed recovery/unavailable outcome. Ledger has exact states `staging`, `verified`, `active`, migration ID `incremental-local-persistence-v3`, source identities/digests, target generation, staging progress revision, verification digest, and cutover revision. `resumeNormalization` is the same function called again, not an independent algorithm.

- [ ] Write and run `npx vitest run tests/unit/localWorkspace/normalized/migration.test.ts` RED. Define `createNormalizationHarness({ faultAt })` in this file using Task 7 injected adapter, original v2 fixtures, and real migration function:

```ts
it.each(['after-stage', 'after-verify', 'after-cutover'])('resumes safely: %s', async faultAt => {
  const h = await createNormalizationHarness({ faultAt });
  const original = await h.exportSource();
  await h.runUntilInterrupted();
  h.clearFault();
  const result = await h.bootstrapFresh();
  expect(result.status).toBe('ready');
  expect(await h.exportActive()).toEqual(original);
  expect(await h.exportSource()).toEqual(original);
  expect(await h.countActiveAuthorities()).toBe(1);
});
```

- [ ] Add physical stores without deleting/modifying historical project payloads. Worker performs valid historical v1 repair and legacy admission using existing safety semantics before normalization. Ledger-version validation distinguishes historical physical layout from normalized authority; do not simply replace every version literal `2` with `3`.
- [ ] Reserve a staged attempt with CAS. Stage bounded record batches guarded by attempt identity/progress revision so concurrent bootstrap tabs cannot write different targets into one attempt. Reuse matching interrupted attempt; never reuse active generation as staging. Preserve all original sources and stop on quota errors rather than recursively making more copies.
- [ ] Independently read/reconstruct staged records and compare canonical source/target content outside transactions. Mark verified with expected staging revision. Cut over with a single transaction that checks captured source revisions/incarnations, expected verification marker, and current authority. Reopen/read marker before readiness. A competing valid winner is followed only after its independent authority validation.
- [ ] Update recovery export to enumerate active normalized data and retained source distinctly, even after partial staging or failed verification. Never export a half-staged document as current. Once normalized edits exist, retained old records are labeled historical, not rollback-ready.
- [ ] Add fresh install, direct v1/v2 upgrade, native/legacy-origin ledger, unknown incarnation, malformed source, missing target, preserved presets/import attempts/cloud links/extensions, blocked upgrade/versionchange, worker crash, size/quota exhaustion, and dual-bootstrap tests. Run existing `bootstrap`, `lineageRepair`, `drift`, `migrationPreparation`, and `recovery` suites as regression checks.
- [ ] GREEN new and existing suites. Review source retention, single authority, stale rollback prevention, and recovery after a successful commit whose acknowledgement was lost.

### Task 12: Public store admission, small acknowledgements, and structural commands

#### Approved private integration first — interaction diagnosis follow-up

The user explicitly approved private editor/store integration and isolated Sticker Press testing before migration acceptance. This supersedes the blanket Task11b dependency for private implementation/testing only. Production `WORKSPACE_DB_VERSION` remains2; no existing-profile conversion, production bootstrap selection, runtime authority flag, or acceptance-budget relaxation is authorized. Task11b faults/accounting/performance and all original release gates still block cutover. Migration emission redesign is not the immediate interaction milestone.

Start with a private interaction-composition test in `tests/unit/ProjectEditor.incrementalPersistence.test.tsx`. Reuse `ProjectEditor`, `createIncrementalQueue` and `createIncrementalWorkerHarness`: the latter obtains bootstrap acknowledgements from the real coordinator/repository and independently reads persisted records in isolated fake IndexedDB. Never manufacture a bootstrap/save acknowledgement. This fixture proves component/queue/protocol/record-write behavior, not production migration admission, native worker scheduling or browser latency. The production public-store facade is still subsequent work in this task.

- [x] Mount real incremental ProjectEditor with source identity and generation/fold floor taken from the actual worker bootstrap binding. The test-only callback adapter forwards only `event.edit.changes`, explicit correspondence mappings/fold basis when required, and scalar preference patch/source/generation; never transfer document snapshots, editor receipt `before/after`, selection history, or public authority objects. Unsupported replacement/root-metadata paths fail loudly in this narrow fixture rather than pretending those routes are integrated.
- [x] Prove real node/template selection and wheel zoom leave document revision/payloads unchanged; zoom readback reflects latest preference. Example assertion: `expect(after.projectHeaders).toEqual(before.projectHeaders)` after `await queue.flush(project.id)`, with independent `readRecords()` outside operation instrumentation.
- [x] Prove text editing, Undo and Redo each persist exact expected text through actual coordinator commits. Flush each step and assert `worker.messages.slice(bootstrapCount)` contains only scoped mutation requests; no `bootstrap`, `recovery-export`, full `initialState`, or editor receipt document graph. Compare untouched template/node records against independent pre-edit readback.
- [x] Spy on legacy `onStateChange`, `onNameChange` and document snapshot/restore functions after mounting. They must remain unused through the chosen interactions. Test source invalidation/refusal and rejected writes; failed work must not be presented as persisted.
- [x] Run `NO_COLOR=1 FORCE_COLOR=0 npx vitest run tests/unit/ProjectEditor.incrementalPersistence.test.tsx --maxWorkers=1 --silent --reporter=dot`, then the existing `ProjectEditor.incrementalChanges`, `normalized/incrementalQueue`, `normalized/workspaceWorker` suites with at most2 workers. Record missing connections/failures before fixes; existing behavior may already compose successfully and must not be deliberately broken to create RED.

Private composition checkpoint: seven cases cover node selection, template navigation/zoom, session-only element selection, persisted text edit/undo/redo, source invalidation, raw-fold preservation and real transaction rollback. Initial text-edit test failed with `Missing before layer correspondence`: in-memory unchanged layer-array identity licenses implicit continuation locally, but independently read/cloned worker records cannot retain that identity. The test adapter now validates the original receipt, preserves explicit mappings, and expands same-address/same-array-reference occurrences to explicit position continuations. It does not infer from IDs or send raw fold values. This translation must move into the real integration seam later; no production function was patched in this slice.

Two initial test issues were corrected separately: expanding Layers emits a legitimate preference before element selection; history can remount the properties textarea, requiring a fresh DOM query. Read-only review found two false-positive paths in refusal/raw-fold tests; setup preferences now flush before invalidation, actual document enqueue is asserted, and the raw-fold case verifies both intermediate durable edited text and two document acknowledgements. Reviewer recheck found no remaining issues in those two findings; no independent test execution claimed. Added node-selection case afterward.

Connected408 tests/4 files PASS98.83s before final assertion strengthening/node case; final seven new tests PASS6.25s. These are not a single final409-test run. Build `task-12-private-interactions-build-01` PASS11.39s/2467modules; typecheck only known Sticker Press TS2339 after fixing a redundant Testing Library option. Task12 audit reuses the immutable Task11b baseline/checker with exactly two explicit additions (this plan and the new test file):49 authorized paths,60/81 prior blobs retained, HEAD/index/protected files intact. Original Task11b baseline and47-path list unchanged. No public-store/EditorPage wiring, native browser speedup, production cutover or Task12 completion claimed.

After this slice, implement public-store small-ack admission and complete event/structural/recovery routes below, then private browser integration using native isolated storage and the pinned Sticker Press fixture. Do not report the unit inline worker/fake database as browser performance evidence or completed public-store wiring. No new application entry point is authorized by the first test-only slice. Controller remains sole writer; no commits/handoffs.

**Files:** Modify `services/localWorkspace/contracts.ts`, `LocalWorkspaceStore.ts`, `index.ts`, `projectAuthority.ts`, existing command preparation/recovery paths; extend `normalized/coordinator.ts` and `repository.ts`. Create `tests/unit/localWorkspace/normalized/storeCommands.test.ts`; update `tests/helpers/fakeLocalWorkspaceStore.ts` and `tests/unit/localWorkspace/commit.test.ts` as needed.

**Interfaces:** Add public commands with these exact names:

```ts
type IncrementalWorkspaceCommand = {
  type: 'save-document-changes';
  authority: WorkspaceProject;
  editorGeneration: number;
  changes: readonly DocumentChange[];
};
type PreferenceWorkspaceCommand = {
  type: 'save-editor-preferences';
  authority: WorkspaceProject;
  editorGeneration: number;
  patch: EditorScalarPreferencePatch;
};
type ProjectMetadataCommand = {
  type: 'update-project-metadata';
  authority: WorkspaceProject;
  editorGeneration: number;
  patch: Partial<Pick<WorkspaceProject, 'name' | 'cloud'>>;
};
```

The `authority` object is an in-memory capability reference inspected by existing WeakMap lineage rules; never clone/serialize/transfer it to the worker. The facade produces private `ProjectScope` and `commitId`. New overloaded `commit` signatures return `DocumentSaveAck` or `PreferenceSaveAck`; metadata returns `DocumentSaveAck` without entering undo. Existing structural commands continue returning `WorkspaceSnapshot`. Keep `bootstrap` and `exportRecoveryBundle` as public entry points; no fourth raw storage method.

Command-boundary implementation details: preserve the existing snapshot-returning command family as `SnapshotWorkspaceCommand`, and define overloaded `WorkspaceCommit` plus the combined `WorkspaceCommand` in contracts. A small `services/localWorkspace/commandDispatcher.ts` routes by command kind and refuses incremental handlers when not installed; production historical store installs only its unchanged snapshot handler. `services/localWorkspace/incrementalCommandAdmission.ts` privately owns the existing incremental queue, admits only WeakMap-installed project capabilities matching the current queue installation/token/incarnation/revision, and updates its revision floor synchronously from actual queue acknowledgement events before passive observers. Returned document/preference receipts are still queue-verified and fenced against replacement installations; coalesced waiters may receive the same later-generation receipt. No public installation/authority-switch method is added.

Document commands may carry explicit `structural` mapping/basis metadata, preference commands occurrence-based `folds`; neither transports the local correspondence snapshots. The optional linked-root-name field and metadata command must fail closed until atomic metadata support is implemented, not fall back to legacy saves. Full structural/recovery/metadata integration remains a release blocker. Tests use the real queue/client/coordinator path and real historical store refusal, not manufactured editing admission. Update snapshot-only queue/hooks/test helpers to the narrower family. Typed fake-store dispatchers preserve command/result correlation; any overload-restoring Vitest assertion wraps a real typed dispatcher, never an untyped success union.

- [ ] Write and run `npx vitest run tests/unit/localWorkspace/normalized/storeCommands.test.ts tests/unit/localWorkspace/commit.test.ts` RED for new commands. Extend `createIncrementalStoreHarness` with `store`, `installedProject`, and `workerMessages`:

  - [x] Typed dispatcher/private document-preference admission slice implemented and tested through `commandFixture` around the existing worker harness (base repository harness remains unchanged). Production constructor uses only the snapshot handler. Normalized production bootstrap installation, metadata and structural/recovery dispatch remain incomplete, so the parent task is not accepted.

```ts
it('uses installed authority but does not transfer its whole project', async () => {
  const h = await createIncrementalStoreHarness(makeIncrementalProject(20));
  const ack = await h.store.commit({
    type: 'save-document-changes', authority: h.installedProject, editorGeneration: 1,
    changes: [{ type: 'put-node', node: { ...h.installedProject.initialState.nodes.root, title: 'New' } }],
  });
  expect(ack.type).toBe('document-saved');
  expect(h.workerMessages.at(-1)).not.toHaveProperty('authority');
  expect(ack).not.toHaveProperty('projects');
});
```

- [ ] Advance installed lineage from small acks without cloning unrelated project wrappers/documents. Pending working generations inherit only compatible authority. Add `advanceInstalledProjectAuthorityFromAck(target, submittedAuthority, ack)` to `projectAuthority.ts` and test stale epoch, wrong incarnation, skipped revision, and newly installed foreign authority.
  - [x] Implement/test the helper itself, including a real queue/coordinator acknowledgement and preserved newer pending content. Public facade/hook invocation remains pending; the parent integration step is not complete.
- [x] Promote the proven test-local wire translation to `materializeLayerMappingsForTransfer(edit, correspondence)` in `services/document/layerFolds.ts`, with focused tests in `tests/unit/document/layerFolds.test.ts`; use it in the private editor composition. Validate original snapshot/coverage rules first, preserve explicit mappings, and add position continuations only for affected same-address templates with identical before/after layer-array references. Deduplicate affected addresses. Do not add continuations for read-only copy sources outside the write set, infer by IDs, or retransmit existing fold snapshots/document graphs. Explicit create-cell values remain required semantic input under the existing LayerMapping contract. This is shared receipt translation for later facade admission, not weaker worker validation or new storage authority.
- [ ] Convert create/activate/close, preset save/delete, import stage/replace/consume, metadata changes, full replacement, and legacy recovery-as-copies to one worker coordinator. Preserve queue barriers and import provenance/idempotency. Creating or replacing a full project is a bulk validated transaction; it is not ordinary autosave. Retain no competing main-thread normalized writer.
- [ ] Eliminate implicit monolithic `save-project` use from ordinary callers. If retained for explicit compatibility bulk replacement, rename/document its intent internally and test ordinary edit paths cannot call it. Whole-workspace bootstrap/recovery stays allowed; normal activation should publish lightweight working references rather than reread all payloads when unchanged authority is already verified.
- [ ] Test two-tab CAS, close/recreate lineage, stale imported-project callbacks, structural failure rollback, source/metadata preservation, and root rename atomicity. Update fake store overloads with typed receipts rather than returning an untyped union or `any`.
- [ ] GREEN new suite and existing `commit`, `useWorkspaceProjectWrites`, `EditorPageWorkspaceCommands`, and `ProjectEditor.authority` suites. Review all existing structural commands are represented; do not ship missing import/recovery behavior.

#### Task12 atomic metadata checkpoint — private persistence implemented

Implemented tagged metadata through admission, queue, retained replay, worker framing, request hashing and selected-record validation. Metadata-only name/cloud updates use the document lane and small document acknowledgements; they do not modify AppState. Cloud omission leaves it alone, a supplied value replaces known fields plus supplied extension fields, and explicit public `undefined` becomes a private removal tag that deletes the cloud extension and wrapper-order entry. Existing wrapper extensions and unrelated records remain untouched. Byte ledgers match independent exports, including UTF-8 data and cloud removal.

Root-linked writes validate the final root/title and include both header and final-root record in one existing transaction/proof. The pointer-only-root test initially exposed a header-only write; final root is now included even when its payload is unchanged, binding it into transaction scope and selected postconditions. Private real-editor root rename/undo/redo tests each verify one atomic pair and no legacy name/save callback. This does not yet publish wrapper-name updates through the live EditorPage hook.

Metadata segments are explicit queue cuts; root rename, independent wrapper rename and subsequent ordinary document work retain order and separate revisions. Pending metadata survives disposal/recovery binding; main-thread framing does not walk cloud payloads. Request identity includes operation kind and cloud presence/removal; external depth512 remains accepted and513 rejected without spending depth on private tags. Invalid metadata, root/name disagreement, post-put/delete faults and corrupted independent readback all refuse acknowledgement. Postcommit failure preserves committed facts rather than claiming rollback. Metadata after a fully normalized migration reopens successfully while retained source stays unchanged.

Verification: initial public API RED5, private-editor linked-root RED, and pointer-only atomic-pair RED each followed by GREEN. Earlier1163/17 PASS105.36s before the pointer-only addition. Latest broad run1163/1164 PASS102.46s, sole failure existing repository multi-write `put` fault scenario at its unchanged5000ms timeout; both put/delete variants then PASS in isolation (2 cases,9.20s command/6.88s tests). No single final all-green broad gate is claimed. New migration-layout metadata case separately PASS5.19s command/2.48s test. Boundary3 PASS16.50s. Build `task-12-atomic-metadata-build-01` PASS14.15s/2468modules; tsc sole known Sticker Press TS2339. Scoped read-only review found no issues, without running tests. Audit71 authorized paths/52-of81 prior blobs retained; HEAD/index/whitespace/protected hashes intact; original baseline/47-path list untouched.

Public store production constructor is still snapshot-only v2. Remaining Task12 work includes worker-backed structural/import/recovery commands, barriers and normalized bootstrap installation. Task13 must coordinate external metadata producers with the live editor's generation clock, update working wrapper references/status without whole snapshots, and preserve history; backend tests with explicit generations do not prove this live path. Native Sticker Press performance and all original migration/release gates remain open. No commits, rollout or existing-profile migration.

#### Task12 typed command boundary checkpoint (before atomic metadata support)

Atomic metadata implementation detail (next connected batch): add optional private `DocumentBatch.metadata` as a tagged `ProjectMetadataEdit`: `{kind:'linked-root',name}` or `{kind:'patch',name?,cloud?:{type:'set',value}|{type:'remove'}}`. Public cloud omission is no-op; own `undefined` is explicit removal; supplied cloud replaces the external cloud value, matching existing EditorPage's `{...project,cloud}` behavior. Preserve unrelated wrapper/state fields; split supplied known cloud fields from unknown extension fields using existing codec ownership. No new durable schema/version or writer.

Metadata-bearing queue segments are cuts, never coalesced with neighboring document/metadata operations. Propagate metadata through retained work, recovery replay, wire validation and request digests. Cloud payload canonical framing must not charge private tag ancestry against external JSON depth. Worker validates metadata and pairs linked-root name with an actual final-root change/title in the same batch; patch-only metadata must have no document changes. Header value bytes/order, cloud extension lifecycle and ledger deltas are staged with existing selected-record preparation, then the existing CAS/write/readback/proof machinery commits them atomically. Metadata-only operations share document revision/ack sequencing without generating editor history.

Generation integration remains explicit: metadata command callers must use the same source-scoped monotonically increasing write-generation sequence as other document-lane commands. Root-linked editor receipts already use their existing editor generation because both changes are one command. Coordinating standalone cloud/name producers with the live editor's generation clock belongs to Task13; backend tests with explicit generations do not establish that live integration or authorize resetting/remounting history to obtain a counter.

Tests-first sequence: public metadata/linked-root command REDs; repository/queue/protocol support; real root edit/undo/redo integration; name/cloud replacement/removal and raw extensions; mismatch rejection and rollback at actual write faults; queue cut/coalescing and retained replay; request-digest distinction and external-depth bounds; unrelated record-read/write assertions. Files: existing contracts/admission/queue/protocol and normalized schema/commitProof/validateChanges/repository, with storeCommands, incrementalQueue, commitProof/validateChanges and private editor tests. Production v2 remains snapshot-only; full structural/import/recovery conversion and live save hook stay pending.

Contracts now distinguish `SnapshotWorkspaceCommand` from document/preference/metadata commands and expose correlated `WorkspaceCommit` overloads. `commandDispatcher.ts` routes only known own-data discriminators; missing incremental handlers reject before payload inspection or storage work. Production historical store installs its existing snapshot handler only and remains on v2. Snapshot queue/hook types are narrowed so new commands cannot accidentally enter that old queue. Real v2 regression was RED with a TypeError, then GREEN with explicit authority-lost refusal and zero storage operations.

`incrementalCommandAdmission.ts` owns an existing queue privately and admits WeakMap capabilities only when token, project/incarnation and current locally acknowledged revision match the installed queue binding. It captures framing before suspension, keeps authority objects off the wire, updates revision fencing from genuine queue events before passive observers, supports coalesced waiters, and checks installation identity/metadata stamp plus current project ID/token/incarnation before returning a receipt. Late context loss refuses publication without claiming a committed write rolled back. Optional structural/fold framing is forwarded by own-presence, not silently dropped when malformed. Queue failures map to existing public error codes; original failure remains the cause. Metadata and linked-root-name commands still fail closed until atomic support is implemented.

The private real-editor composition now goes through this dispatcher/admitter, registers authority from the actual worker bootstrap, and advances installed lineage from verified receipts. It no longer calls the queue directly. Still an inline worker/fake-IDB composition, not public production bootstrap, a new raw store entry point, or native-browser performance evidence. The live hook's only change in this checkpoint is its snapshot-command type narrowing; live editor still uses the old save path.

Typed mock migration: `fakeLocalWorkspaceStore.ts` wraps a real typed dispatcher and restores overloads lost by Vitest's Mock type. Snapshot-only helpers in generated-project/generator-metadata/workspace-command/useWorkspaceProjectWrites tests are narrowed; fork-import's hoisted proxy preserves the real store's overloads. Exact return-type tests caught an intersection-order error, then passed. Reviewer P2 caught overly broad preference patch typing; compile-time RED led to `EditorScalarPreferencePatch`, with occurrence-targeted folds separate. Reviewer recheck resolved the finding; no tests run by reviewer.

Verification: final414 tests/12 files PASS26.76s, including real command admission, legacy commit/mutation queue, import/fork/bootstrap UI, editor authority, private editor and incremental queue suites. Focused boundary3 cases PASS14.85s. A broader all-localWorkspace sweep exceeded the240s shell deadline with no final result; no pass/count claimed for it. Build `task-12-command-admission-build-01` PASS13.78s/2468modules; tsc sole known Sticker Press TS2339. Scoped audit65 authorized paths/58-of81 baseline blobs retained; HEAD/index/whitespace/protected files intact. Original Task11b baseline/list unchanged. No commits, existing-profile migration, production v3 cutover or measured new editor-speed claim.

Remaining before Task12/13 acceptance: atomic linked-root and metadata writes; worker-backed structural/import/recovery commands and barriers; normalized bootstrap installation; real save-hook/status/navigation integration; native Sticker Press comparison; unresolved migration budgets/performance. Do not mix a real historical snapshot writer with admitted normalized editing handlers in a production instance.

#### Task12 acknowledgement and wire-mapping foundation checkpoint (before command routing)

Two application helpers are implemented, not merely test-local glue. `advanceInstalledProjectAuthorityFromAck` requires both wrappers already installed with matching token/starting lineage, matching project/incarnation, safe counters and exact+1 document revision. It updates only target WeakMap lineage: no payload read/clone, no capability creation and no saved/dirty UI publication. Queue/facade must correlate commitId/editorGeneration before calling it; this helper cannot authenticate a receipt from fields alone. Numeric UI epoch admission remains the hook/facade responsibility. Existing snapshot-returning save path is unchanged.

`materializeLayerMappingsForTransfer` validates the original local receipt, preserves semantic explicit mappings, copies/freezes only known endpoint/cell wrapper fields, and adds implicit position continuations only for affected exact-array-identity sequences. Opaque raw cell values remain borrowed; incidental mapping/document properties are not enumerated or copied. Duplicate affected addresses are deduplicated; unchanged read-only copy sources get no consuming mappings. Private editor composition now calls this shared helper. No worker validation was relaxed.

Both missing-interface regressions were RED, then GREEN. Additional metadata-mutation and incidental-payload getter regressions were RED, then fixed by copying/fixing metadata fields rather than aliasing/spreading input. Ack foundation has27 cases; wire helper adds7 cases to existing fold suite. Real queue save test confirms durable older data and newer pending UI content coexist while compatible lineage advances; it is not a public `store.commit` dispatcher test despite living in the planned storeCommands file.

Verification:731 tests/16 files PASS98.35s across document/editor/history/queue/worker/store/authority suites before final incidental-payload guard; final affected52 tests/3 files PASS6.73s. No claim of one final732-test command. Build `task-12-ack-mapping-foundation-build-01` PASS11.18s/2467modules; typecheck sole known Sticker Press TS2339. Scoped read-only review found no issues before final payload guard; review did not run tests. Audit adds only four newly authorized helper/test paths to the previous Task12 extension:53 changed paths/58-of81 original blobs retained, HEAD/index/whitespace/protected hashes intact. Original Task11b baseline and47-path list unchanged.

Next: public command overloads and actual admission/dispatch, including carrying required fold provenance and atomic root/wrapper metadata; then caller-generation/status handling and all structural/recovery routes. No production constructor/barrel/schema/editor wiring changed in this checkpoint. Task12 remains in progress; native Sticker Press improvement and production cutover remain unproven/unapproved.

### Task 13: UI save integration, preference status, and single cutover

#### Workspace authority design direction (2026-09-26)

After the private native measurement, the user approved proceeding with an explicit versioned current-workspace manifest rather than inferring membership from headers or rebuilding a generation for every workspace command. Concrete storage, command, barrier, replacement-history, recovery and test contracts are in `../specs/2026-09-26-normalized-workspace-authority-design.md`; the user approved that written spec on 2026-09-26 and authorized implementation planning. Current membership must become independent of immutable migration-source membership without adding whole-workspace work to ordinary saves. Production v2 and all existing release/budget restrictions remain unchanged.

Foundation execution plan: `2026-09-26-workspace-authority-foundation.md`. Six test-first tasks cover private manifest/receipt/birth modules, atomic activation, manifest-driven reopen and isolation regressions. It explicitly maps workspace command execution, bulk replacement/recovery and live integration to later connected milestone plans; it does not authorize a partial production store or imply those commands already exist.

Foundation implementation checkpoint: Tasks1–5 implemented privately; current membership no longer derives from immutable source membership, initial manifest activates with marker, and new births retain independent lane/fold baselines. Ordinary writes still use selected header/incarnation fences without reading the manifest. Connected510 tests PASS, production build PASS, scoped boundary6 PASS, typecheck only known Sticker Press TS2339. Full migration641-case run exceeded1200s shell limit with no summary; full boundary940-case run exceeded120s. Known5-vs4 derivation and timing gates remain open, so no full acceptance/cutover claim. See foundation plan for reviews, preserved-source semantics, artifacts and remaining verification.

Verification follow-up supersedes missing-result status: per-case runs accounted for all641 baseline migration cases (589 pass/43 timeout/9 assertion failures); complete boundary940 passes, including post-fix run. Fixed retained-source export being blocked by invalid target verification digest; active/activation proof checks unchanged. Corrected seven stale message assertions and added six valid same-revision/no-write cases;14 targeted migration cases pass, current collection647. Of42 short-timeout retries,16 pass alone and26 still exceed original5s; isolated32MiB baseline times out360s and5-vs4 derivation remains RED. Final connected511/11 pass with one worker; build02 passes; known tsc error only. Complete evidence is not green migration acceptance. No lifecycle implementation or cutover; see foundation follow-up for source stamps, profiling limits and exact artifacts.

#### Structural integration gap and approved private save-hook slice

Read-only follow-up after atomic metadata found a missing design contract, not a safe mechanical routing task. `workspaceWorkerProtocol.ts` currently exposes per-project bootstrap/mutations, occurrence edits, inspection and project export; coordinator has no workspace activate/create/close/import/recovery mutation family. `normalized/repository.ts` active derive allocates images from immutable `source.sourceProjects` and requires those projects/incarnations when reconstructing current workspace. Newly created, closed or replaced projects therefore need an explicit mutable workspace-membership/authority model before those operations can be wired safely. Existing `StoredWorkspace.revision` and queue barriers are useful components, but do not by themselves define admission, durable membership, uncertain-outcome inspection and publication. Do not combine normalized edits with the historical snapshot writer.

The user approved the following private save-hook contract after reviewing the structural gap. The private Task12/13 exception permits this work while that workspace contract remains unresolved:

- A private per-project save hook is a sidecar to the existing real `ProjectEditor`; the editor remains owner of working document/history/selection. Hook retains status, source identity and small submission metadata—not cloned AppState, receipt before/after graphs or a fabricated current WorkspaceSnapshot. Public `LocalWorkspaceStore.commit` remains the persistence seam.
- Resolve installed project capability, source binding and authority epoch before each command and again before publishing completion. A source change requires a new keyed owner, not a silent history reset. Disposed/obsolete completions cannot change current status or retag a new source.
- Keep editor-local receipt generations distinct from monotonically increasing write generations. Standalone metadata commands consume write generations without consuming undo entries or requiring editor remount. Map a local after-structural dependency to its submitted write generation; keep only the latest dependency mapping needed by the synchronous ordered editor-effect stream, with pending dependencies already captured by the queue. Unknown/stale/replacement dependencies fail closed; do not guess durable fold counters.
- Route document changes, explicit wire mappings and linked names through the typed document command. Route scalar/fold preferences separately; document-linked preference deltas share the same logical submission but independent status. Metadata commands use their own write generation and document-lane durability status, without creating a document history event.
- A save result updates verified coverage only. An older or coalesced acknowledgement cannot mark a newer outstanding edit saved; failures retain local edits. Preference failure stays separate from document dirty status. Successful receipts advance only compatible installed lineage using the existing helper.
- Private tests may inject the existing store-owned admission flush control; this is not a fourth public storage API. Flush captures outstanding work and rechecks source/status before allowing a private navigation decision. Exposing lifecycle controls in the eventual full workspace integration must be resolved with the workspace barrier contract.
- First private tests cover edit → metadata → undo/redo generation continuity, late completions, newer edits during a save, independent preference failure, source retirement, explicit fold dependency translation, and zero ordinary full-document serialization/cloning. Then use the pinned Sticker Press fixture in an isolated native browser. Project creation/closing/import/recovery and production bootstrap/cutover remain unavailable until their own contracts and gates pass.

This sidecar does not claim complete EditorPage working-workspace publication or recovery export wiring. Those paths must use the current editor-owned state at explicit bulk boundaries, not stale admitted snapshots. Implementation of this private slice is approved; no budget relaxation or production cutover is authorized.

##### Private hook implementation steps

Create `hooks/useIncrementalProjectWrites.ts` and `tests/unit/useIncrementalProjectWrites.test.tsx`; adapt only the existing private `ProjectEditor.incrementalPersistence` fixture. Controller implements inline, no commits. The hook is per keyed project/source owner, not an alternative workspace authority.

```ts
interface IncrementalProjectWritesOptions {
  projectId: string;
  authorityEpoch: number;
  binding: EditorSourceBinding;
  store: Pick<LocalWorkspaceStore, 'commit'>;
  resolveAuthority(): WorkspaceProject | undefined;
  flushPending(): Promise<void>; // Private store-owned scheduling control.
}
// Returned methods:
updateDocument(projectId: string, event: EditorDocumentEvent, expectedEpoch: number): Promise<boolean>;
updatePreferences(projectId: string, patch: EditorScalarPreferencePatch,
  metadata: EditorPreferenceMetadata, expectedEpoch: number): Promise<boolean>;
updateMetadata(projectId: string, patch: ProjectMetadataCommand['patch'], expectedEpoch: number): Promise<boolean>;
flushPendingProject(projectId: string): Promise<boolean>;
// Read-only status: documentState, preferenceState, hasUnsavedDocument, hasPendingWrites.
```

- [x] RED interface and status tests using controlled typed store promises. Initial mount/StrictMode must be silent. Resolve an older document save while a newer edit remains outstanding; documentState stays saving. Preference-only failure must leave document status/dirty flag unchanged. Source/epoch mismatch and unmount prevent dispatch/publication. No authority initialState getter may run.
- [x] Implement one pure per-source owner behind `useSyncExternalStore`. Commit resolver/flush callbacks in layout effect; no render-time external calls or automatic writes. Binding/store/project/epoch changes require a keyed remount. Subscription presence gates actions/publication and survives StrictMode effect replay. Use only small mutable sequencing/status data; editor retains actual working state/history.
- [x] Separate `lastEditorGeneration` from `writeGeneration`. Enforce ordered editor receipts; allocate `max(previousWrite + 1, receiptGeneration)` for editor effects and `previousWrite + 1` for standalone metadata. Translate only the latest local structural dependency to its submitted write generation; update that mapping when `overlayEffects.length > 0`, matching the editor's existing rule. Unknown/after-replacement dependencies fail closed. Paired document preference deltas use the same write generation and separate promise/status paths.
- [x] Use existing wire-mapping helper and public commands. Validate source and installed token/incarnation before sending and before completion. Trust only submission-verified store receipts, additionally checking type/project/incarnation/safe counters and generation coverage within admitted lane bounds. Advance compatible current lineage by one; reject unexplained revision gaps. Older/coalesced receipts never replace working content. Keep failures latched for this source; no guessed retry/coverage. A document failure prevents further dependent writes; preference failure alone does not set document dirty state.
- [x] Track pending promises without retaining editor before/after receipt graphs. Saved requires all admitted lane work settled successfully and covered, not merely one acknowledgement. Flush invokes the private scheduling control, waits captured work, and returns false if source changed, failure remains, or newer work arrived. No fourth public storage method.
- [x] Integrate the hook into the real private editor fixture. Test text edit -> metadata update -> Undo -> Redo: durable metadata survives history while wire generations strictly increase. Keep existing selection/preference-only, raw-fold, atomic root rename, invalidation and rollback tests. Add failure/dependency/late-completion cases with no sleeps.
- [x] Verify focused hook/editor/store/queue tests, existing legacy save-hook tests, typecheck, build and scoped audit. Broader gates remain bounded to at most2 workers; no timeout changes. Record native performance as unverified until a separate isolated browser measurement actually runs.
- [x] Measure the private hook/editor path with the pinned Sticker Press fixture in an isolated native browser; do not substitute jsdom/inline-worker timings or claim production migration admission. Diagnostic checkpoint below; release performance acceptance remains open.

Private-hook checkpoint: `useIncrementalProjectWrites` and27 controlled tests added; real private editor fixture now uses the hook (10 cases). The existing manual wiring reproduced metadata/Undo generation collision (RED stale-generation); separate clocks fixed it without a history reset. A real Add Layer/fold-preference sequence verifies dependency translation when metadata shifts write generations. Additional REDs caught stale receipt access, uncommitted resolver replacement and unexplained revision adoption. Source fencing and no-payload-read/clone assertions pass.

Read-only review found P2: notifying saving status before store admission allowed synchronous subscriber reentry to post a later generation first, or unmount before send. Controlled subscriber-boundary tests reproduced both failures. Fix registers complete logical groups, serializes synchronous admission, sends document/paired preference commands before notification, and checks mount/source before each store call. Store-reentry regression also passes. Completion removes pending state before notification and checks source again before resolving success. Reviewer recheck found no remaining scoped findings; reviewer did not run tests.

Final connected530 tests/7 files PASS104.28s; boundary3 PASS19.12s. Typecheck only known Sticker Press TS2339. Build `task-13-private-save-hook-build-01` PASS11.30s/2468modules. Scope audit73 paths/52-of81 baseline blobs retained, HEAD/index/whitespace/protected hashes intact; original baseline/list unchanged. Last change after connected run was readonly status typing only, checked by tsc. No native performance result for this hook yet. No EditorPage/default-store hookup, workspace membership workaround, production cutover or existing-profile migration. Full working-workspace/export/retry/structural integration remains unfinished.

##### Private native Sticker Press measurement checkpoint

This supersedes the preceding checkpoint's pending-native-measurement statement, not its production restrictions. External-only harness `/tmp/opencode/sticker-private-entry.tsx` mounts the real editor/hook/typed admission/queue with a real module worker and native IndexedDB. Fresh nonpersistent Chromium143.0.7499.4 context, loopback4320, no backend or existing profile. Pinned state21152284bytes, SHA256 `604d08d40fa4e4641d50d8cefc708a91ff946b3a3185ffb90b4cb6fb3b4e8a22`. Normalized-only single-project fixture is seeded before real worker bootstrap verifies it; this does not exercise migration or workspace-membership admission.

Unprofiled run `/tmp/opencode/doctect-sticker-private-1790442632689` completed42 actions: seven scenarios, one warmup plus five measured repeats. Independent native selected-row reads verify revisions, selection/mode and edited/undo/redo text outside timed windows; final reset verified, no page errors. Test-only production bundle built in9.97s/2041modules. Warmed action-through-two-animation-frame timings (milliseconds, including automation):

| Interaction | Median | Min–max | Maximum observed long task |
| --- | ---: | ---: | ---: |
| Child node selection | 135.4 | 128.5–449.0 | 262 |
| Root selection | 100.3 | 79.6–214.9 | 98 |
| Templates → Hierarchy | 384.7 | 359.7–428.9 | 175 |
| Element selection | 85.5 | 62.9–116.8 | 50 |
| Text edit | 71.7 | 63.5–95.5 | 0 |
| Undo | 118.2 | 96.3–248.9 | 138 |
| Redo | 136.4 | 89.7–305.2 | 195 |

One warmed Undo long task starts after the action ends; other warmed scenarios have none in their observed drain windows. Do not claim every save drain is task-free. Median worker roundtrips: preferences54ms, document structural-command106.5ms; command completion including debounce/queue: preferences1070.9ms, document606.2ms. Bootstrap roundtrip9765.4ms is excluded from interaction timings, not eliminated startup cost. Earlier legacy control has only one cold selection605.7ms and later5633/12525ms long tasks; private cold selection515.1ms/max265ms. Multi-second legacy-style stalls were not observed in these private interaction windows, but this is not a controlled same-time A/B comparison.

CPU follow-up `/tmp/opencode/doctect-sticker-private-1790443023366` reused the identical bundle in a fresh context:14 actions, seven sampled profiles, durable checks pass. Samples include React render/commit, DOMPurify/SVG parsing, canvas text measurement and Tailwind runtime; native `(program)` samples remain unattributed. Inclusive samples overlap; do not sum them or assign all whole-page long tasks to persistence.

Native worker-operation follow-up `/tmp/opencode/doctect-sticker-private-1790443741982` completed14 actions with all assertions passing. Instrumented object-store methods after bootstrap, retaining real calls/transactions; independent inspector reads occur on the main thread, outside those counts. Navigation writes only one preference record (three header gets plus three preference gets); element selection performs no observed storage operations. Each measured edit/undo/redo writes exactly one template and one header; no `getAll` calls or unrelated document-store writes. The first edit also submits a separate preference request and writes one preference record; later edits/undo/redo do not. Typical document operation reads five headers, five preferences, two templates and one variant. Counts describe this fixture/path, not every IDB API or production layout.

Retained failed probe `/tmp/opencode/doctect-sticker-private-1790443660443` stopped after four actions because the diagnostic incorrectly forbade the first edit's preference write. An initial atomic-overlay explanation was not established: the successful run's request trace shows a separate preference request. Corrected assertion permits preferences while requiring exact selected-document put counts and matching preference revision delta. No application behavior changed or budget relaxed.

Limitations: five samples do not establish stablep95; automation/two-frame timing is not INP. Independent readbacks can affect caches/GC. CPU and operation probes are separate diagnostic runs, not replacements for unprofiled timings. This verifies private partial persistence, not full workspace lifecycle, reload/crash durability, quota, other browsers, migration budgets, or production responsiveness. Production remains legacy v2; membership/authority, live publication/recovery and remaining migration/performance gates still block cutover.

**Files:** Modify `hooks/useWorkspaceProjectWrites.ts`, `pages/EditorPage.tsx`, `components/ProjectEditor.tsx`, `components/workspace/LocalSaveStatus.tsx`, `WorkspaceBootstrapGate.tsx`, `WorkspaceBootstrapScreen.tsx`, `WorkspaceRecoveryScreen.tsx`, `UnsavedNavigationDialog.tsx`, and `services/localWorkspace/schema.ts`/`index.ts`. Create `tests/unit/useIncrementalProjectWrites.test.tsx`, `tests/unit/EditorPage.incrementalPersistence.test.tsx`; update related workspace UI tests.

**Interfaces:** Hook exposes `updateDocument(projectId, event, expectedAuthorityEpoch): Promise<boolean>` and `updatePreferences(projectId, patch, expectedAuthorityEpoch): Promise<boolean>`, with separate document/preference status maps. Keep existing structural/retry commands and authority epoch semantics. Ordinary working-copy publication reuses unchanged references. Internal helper `flushPendingProject(projectId): Promise<boolean>` is used by navigation guards, not exposed as a raw public database method.

- [ ] Write and run `npx vitest run tests/unit/useIncrementalProjectWrites.test.tsx tests/unit/EditorPage.incrementalPersistence.test.tsx` RED. Define the local hook harness using `renderHook` and the updated typed fake store:

```ts
it('an old completion cannot mark a newer edit saved', async () => {
  const h = renderIncrementalWrites();
  await h.editTitle('one');
  await h.startPendingSave();
  await h.editTitle('two');
  await h.resolveStartedSave();
  expect(h.documentStatus()).not.toBe('saved');
  expect(h.currentTitle()).toBe('two');
  await h.flushAndResolveLatest();
  expect(h.documentStatus()).toBe('saved');
});
```

Harness methods are implemented with `act`, fake timers, and controlled ack promises, not sleeps. Match every ack to its submitted authority/generation.

- [ ] Wire new editor event callbacks. Remove the old full-state reporting/compatibility adapter and whole-workspace normal-save read-back path. Update parent working document by reference, preserve newer overlays, and never reset current selection from an older save acknowledgement.
- [ ] Save UI: pending/saving, saved, failed, conflict reflect document generations; preference failures use a separate non-destructive message/retry. Do not trigger unsaved-document navigation prompts for a zoom change alone. Retain export and document unsaved warnings, best-effort visibility flush, and explicit close barriers; do not rely on async `beforeunload` saves.
- [ ] Bootstrap UI reports copying/verifying/cutover and blocked-upgrade recovery through existing accessible patterns. Existing legacy-recovery labels/capabilities remain valid; add distinct active normalized versus historical source exports. No editor mounts while authority is uncertain.
- [ ] After Tasks 1–12 are green, change the production schema to exactly v3 and wire the worker-backed store once. Run only against isolated contexts/alternate ports. No runtime flag that chooses arbitrary editing authority; normalized ledger is the authority gate. Remove obsolete preparation worker wiring from normal saves, but preserve any still-needed historical logic until all imports are accounted for.
- [ ] GREEN focused UI tests and `npm run check:workspace-boundary`; run the production build. Review interaction-independent preference errors, safe restore fallbacks, no phantom dirty state, and strict mode callback behavior.

### Task 14: External compatibility and browser failure matrix

**Files:** Create `tests/e2e/incremental_local_persistence.spec.ts`, `tests/e2e/incremental_migration.spec.ts`, `tests/unit/localWorkspace/normalized/compatibility.test.ts`. Modify `tests/e2e/localWorkspaceHelpers.js` and `tests/e2e/fixtures/localWorkspaceMigration.js` for the new typed commands/versioned fixture seeding; modify adapters in `services/generatedProjectState.ts`, `services/importProject.ts`, `services/forkProject.ts`, `components/JsonModal.tsx`, and cloud/save callers only where state assembly is actually required.

**Interfaces:** Preserve existing external caller signatures. Explicit full-state assembly occurs at import/export/generator/cloud boundaries. Extend Task 1 browser harness with `reopenAndReadProject(page): Promise<WorkspaceProject>` and `openSecondWorkspaceTab(context): Promise<Page>` for independent durability/conflict checks.

- [ ] Write `compatibility.test.ts` before modifying adapters; run `npx vitest run tests/unit/localWorkspace/normalized/compatibility.test.ts` RED. Compare externally assembled payloads, not private storage objects:

```ts
it('preserves source and external project data after incremental edits', async () => {
  const project = loadStickerPressProject();
  const h = await createIncrementalStoreHarness(project);
  const renamed = { ...project.initialState.nodes.root, title: 'Renamed' };
  await h.repository.commitDocument({
    scope: h.scope, commitId: 'compat-1', editorGeneration: 1, expectedRevision: 0,
    changes: [{ type: 'put-node', node: renamed }],
  });
  const exported = await h.exportFresh();
  expect(exported.initialState.generator).toEqual(project.initialState.generator);
  expect(exported.initialState.variants).toEqual(project.initialState.variants);
  expect(exported.initialState.nodes.root).toEqual(renamed);
});
```

- [ ] Add actual browser tests for navigation-only writes, edit/reload, history/reload, full replacement/undo, remembered preferences, stale selected IDs, multi-project switching, two tabs with conflicting edits, blocked upgrades, and interrupted migration. Inspect IDB only inside fresh test contexts; normal test writes use the public seam or actual UI, with legacy malformed seeding confined to the authorized fixture helper.
- [ ] Exercise worker failure before and after durable commit through deterministic browser fault injection available only in test builds/private harness. Verify recovery/export and unsaved state, not only error text. Cover quota with real constrained contexts and injected transaction failures; never run quota acceptance with unlimited-storage flags.
- [ ] Preserve PDF page order, variant dimensions, links, current generator source, and JSON/cloud snapshot semantics. Run existing gallery, export-all-variants, generator history, import/fork ownership, and workspace command suites; do not expand into changing cloud transport format.
- [ ] Run Chromium, Firefox, and WebKit correctness on isolated alternate ports. Production-bundle tests use UI import/export, since current `localWorkspaceHelpers.js` source imports do not work in a built bundle. Keep legacy development-browser helpers only for tests explicitly using the dev server.
- [ ] Review failure matrix coverage and classify any baseline-only failures with retained logs. Successful fake-IDB tests do not replace real transaction/versionchange/worker browser evidence.

### Task 15: Measured performance, documentation, and release gate

**Files:** Extend Task 1's `tests/e2e/incremental_performance.spec.ts`, `scripts/verify-incremental-persistence.mjs`, and `tests/unit/incrementalVerificationLauncher.test.ts`. Create `docs/superpowers/plans/2026-09-13-incremental-local-persistence-results.md`. Update `docs/1-high-level-architecture.md`, `docs/3-state-management.md`, and relevant test-harness docs.

**Interfaces:** Launcher accepts `--phase baseline|final`, `--web-port`, `--api-port`, and `--output-dir`; uses `node:fs` to verify/create only a fresh output directory under `/tmp/opencode`, rejects occupied ports rather than stopping/reusing servers, uses a fresh SQLite path and empty dedicated dotenv file, blanks production DB/email/provider credentials, generates a local runtime secret, and runs the existing test/build tools with captured logs. Unit tests inject process execution rather than actually starting servers. It preserves diagnostic content privacy and does not modify user profiles.

- [ ] Task 1 writes and runs `npx vitest run tests/unit/incrementalVerificationLauncher.test.ts` RED/GREEN for refusing ports 3000/3001, occupied ports, reused output directories, production database environment, and non-isolated browser settings. Here add RED/GREEN coverage for the final-phase command sequence and stop-on-failure behavior. Inspect server environment initialization (`server/index.js`, `server/db.js`, `server/auth.js`) so dotenv cannot reconnect production infrastructure. Use the same safe launcher for baseline and final measurements.
- [ ] Add deterministic work counters and test-only local performance spans around admission, validation, transfer, transaction, read-back, and publication. Do not send identifiers/content/digests to analytics. Assertions must distinguish persistence long tasks from React rendering and explicit bulk work.
- [ ] Turn final performance targets into assertions for the documented reference environment. Test small control, one ~21.2 MB Sticker Press project, and several large open projects. At least five repeated runs per scenario after warmup; report sample counts and raw measurements, not a single best run. Continuous edits must exercise saves in flight.

```ts
expect(report.navigation.documentWrites).toBe(0);
expect(report.singleTemplateEdit.unrelatedPayloadReads).toBe(0);
expect(report.singleTemplateEdit.unrelatedPayloadWrites).toBe(0);
expect(report.singleTemplateEdit.fullDocumentClones).toBe(0);
expect(report.normalInteraction.p95InputToNextPaintMs).toBeLessThan(100);
expect(report.normalInteraction.maxPersistenceMainThreadTaskMs).toBeLessThan(50);
```

`report` is the harness's measured result, assembled from browser event timing/traces and deterministic work counters; do not synthesize values from expected record counts. Unsupported timing APIs in a browser require trace-based alternatives or an explicit unsupported measurement, not fabricated zero values. Bulk import/replacement/migration are separate progress-bearing scenarios, not excluded silently after failures.

- [ ] Run final verification through the launcher after checking parent directory and alternate ports:

```bash
node scripts/verify-incremental-persistence.mjs --phase final --web-port 4310 --api-port 4311 --output-dir /tmp/opencode/doctect-incremental-final-20260913
```

The final phase runs these commands sequentially with its isolated environment, stopping on unexpected failure:

```bash
npx vitest run
npm run check:workspace-boundary
npm run build --legacy-peer-deps
npx playwright test tests/e2e/incremental_local_persistence.spec.ts tests/e2e/incremental_migration.spec.ts --project=chromium --project=firefox --project=webkit
npx playwright test tests/e2e/incremental_performance.spec.ts --project=incremental-performance-chromium
git diff --check
```

The performance project uses a production bundle, ordinary storage quotas, isolated API/DB settings, and no source-module imports. Existing Playwright config sets unlimited storage for its generic built Chromium path; the dedicated performance project must override that behavior. Browser correctness is required across all three engines; document any performance-measurement coverage limitations separately.

- [ ] Results document records code revision/worktree status, fixture hashes/bytes/pages, machine/browser versions, baseline versus final timings, longest pauses, write/read/clone counts, heap trend, latest-revision durability, migration fault evidence, current test counts, warnings, and known failures. Do not claim freeze fixed if only database time improved or UI targets fail.
- [ ] Update architecture/state docs with new seam, schema/migration authority, preference semantics, history immutability, worker ownership, commit acknowledgements, and retained-source limitations. Re-run documentation-sensitive tests and onboarding generation checks; distinguish new file-tree changes from the recorded baseline.
- [ ] Review complete diff and safety/performance evidence. Leave all source/user-data migrations and deployment for explicit approval; offer the isolated verified app for user testing. No automatic commit or merge.

## Spec coverage and final handoff

| Spec requirement | Tasks |
| --- | --- |
| Existing evidence, isolated large fixture, no premature performance claim | 1, 15 |
| Document/preferences/transient separation and reload restoration | 2, 10, 13 |
| Explicit changes, structural sharing, reference effects | 3, 10 |
| Undo clone removal, gesture grouping, 50-entry bound | 4, 10 |
| Normalized records, extensions, reconstruction order | 5 |
| Exact limits, incremental schema/reference validation | 6, 7 |
| Small receipts and preserved installed authority | 7, 8, 12, 13 |
| Debounce, maximum wait, edits in flight, navigation barriers | 9, 13 |
| Worker ownership, restart/uncertain-commit safety | 8, 12, 14 |
| Atomic updates, CAS, read-back verification, preferences concurrency | 7, 12, 14 |
| v1/v2/legacy/fresh migration, retention, recovery, stale rollback | 11, 12, 14 |
| Every structural command/import provenance | 12, 14 |
| External JSON/generator/PDF/cloud compatibility | 5, 14 |
| Measurable responsiveness, real browsers, documentation | 1, 15 |

At each checkpoint, record changed files, RED/GREEN evidence, current failures, and authority/migration state. Do not mark future tasks complete based on intended code. If an unexpected existing mutation contract defeats structural sharing, stop and amend the affected task/spec with evidence rather than removing isolation checks. If the work exceeds one execution session, resume from this dependency graph and the results ledger; do not repeat migrations against a user's profile.

## Plan self-review record

- Coverage mapped to every approved spec section in the table above.
- Physical store names, generation namespaces, worker ownership, command/ack names, timers, schema version, and review gates are fixed here.
- Baseline runner and measurement-only browser spec are created in Task 1, before production changes; Task 15 extends them rather than trying to reconstruct a missing baseline afterward.
- Legacy six-store layout remains a retained source/ancillary representation; normalized child stores are never silently substituted into old ledger validation.
- Existing source-module browser helpers and unlimited-storage flags are explicitly excluded from production performance/quota proof.
- Public whole-snapshot structural operations are distinguished from ordinary incremental acknowledgements; full ingress/export remains intentionally bulk.
- Source worktree and live app remain untouched during implementation through a separate worktree and isolated verification launcher.
