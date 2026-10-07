# Normal Editor Incremental Autosaves — Milestone D

> **For agentic workers:** Execute inline with executing-plans and TDD. Read-only review allowed; no implementation handoff, staging, commits, installs, deployment or existing-profile access.

**Goal:** The normal editor must stop performing full-project work on frequent autosaves. Normal document/preference events use the already-verified changed-record worker pipeline, preserving working state and Undo.

**Authorization and priorities:** User clarified that200ms navigation is fine and specifically asked whether massive frequent-autosave delays were addressed. After being told the missing step was normal-editor integration, user asked to continue. This authorizes that development wiring, not deployment or opening/migrating a real profile. The earlier<100ms navigation target is no longer a blocker or a reason for further rendering work. Follow the approved normalized-authority design, especially §§7–10 and MilestoneD; no new product-design interview is needed.

**Latest direction:** User rejected the proposed final-seal optimization with “No, focus on the real final goal.” Stop import/seal tuning and its design/approval gates. Verify steady-state autosaves directly: normal-page/default-store integration plus the existing independently admitted native21MB editor fixture, with setup excluded. Add a native default-app control where feasible. Report these layers separately; a preloaded project test is not large-import/startup acceptance. Keep the import failure recorded, but do not make its optimization the next work item. Fix only actual recurring-save, typing, durable-state or history failures exposed by these checks.

**Combined-app follow-up authorized:** User said “proceed” to testing an already-saved large workspace through the actual default `/app`, fixing only exposed workflow failures, and providing an isolated preview. Prepare a disposable full-layout fixture using production codec/manifest helpers, including retained source and matching digests, then let the unmodified normal store independently validate and admit it. Fixture data is not a fabricated runtime acknowledgement or admission. Exercise autosaves, project switching, reload durability and failed-save retry. No JSON import benchmark, timeout increase, real-profile access, merge or deployment. Immediate snapshot: `task-17-normal-large-workspace-baseline` at7e0f971…/1209.

**Observed startup integration gap:** Native saved-workspace control opens/switches/reloads, but performs a full active read for the snapshot, another for workspace admission, and one per project. The pinned21MB saved workspace still performs its first read at the unchanged120s opening limit (`doctect-saved-workspace-large-1791085187449`). Implement existing authority spec§5.2's single coupled read: an explicit startup `editor` operation returns current snapshot and genuine workspace/project admissions from the same fully validated, sealed capture. Build indexes before sealing; publish owner capabilities only afterward. Browser keeps a one-use client/snapshot-bound receipt, consumed by initial session/restart. Ordinary read/export paths never install that receipt. Existing independent fallback project admission remains for later new members. Keep every source, manifest, project, ancillary, aggregate and seal check; no generic cache/trusted flag, lazy loading, timeout increase or import optimization. Primary runtime seams: repository, coordinator/startup protocol/facade, editing session and normalized-store initialization. Add regression and exact boundary grants.

**First-pass follow-up authorized:** User asked to continue toward a large saved workspace opening normally, editing/saving smoothly and surviving reload. Task18 baseline `task-18-cold-start-validation-baseline` starts at2e098d7…/1209. Profile the actual first `editor` validation pass using external diagnostic-only function spans and native worker CPU samples; keep the120s opening/30s RPC limits. Remove only demonstrated redundant work after regression tests, preserving complete source/current validation and exact data identity. No new planning interview, import benchmark, general Work-dispatch experiment or hidden validation shortcut.

Native diagnostic `doctect-saved-workspace-large-1791099836562` remains inside the first stored-project check at120s: raw canonical28.467s, raw AppState16.214s, wrapper canonical31.385s, clone AppState17.006s, then loaded-state canonical still running. Target only producer-side redundant operations first: count JSON structural/numeric tokens directly because they are ASCII by construction, and batch primitive-string prefix comparisons in exponentially sized chunks capped64code units. Keep non-string compatibility path, lexical result, exact compared-code-unit metric, JSON/schema traversal order, UTF-8 totals, all limits and Work executor unchanged. Small comparison batches reserve conservative bounded visits, like existing short-token probes; do not add native whole-string sorting/comparison or skip validation.

The next diagnostic (`1791101933326`) completes that source-project check at103.933s, but opening still fails120s. Remove demonstrated same-image rescans in `checkStoredWorkspaceProjectWork`: a combined canonical inspection/schema check privately reuses its own measured bytes for the32MiB check; no caller-supplied size or validation token is accepted. Raw and loaded states are still independently inspected, and the native clone still gets its separate pre-loader validation. Within that one immutable-capture program, wrapper validation reuses only the exact `initialState` field's complete JSON inspection/depth facts. All other wrapper fields, including aliases, receive full canonical checking at nesting1 with the actual wrapper in their ancestor context. Preserve state-before-wrapper error precedence, metadata validation, getter refusal, loader warnings, depth512 and clone/output-size checks. Existing independent old composition remains test oracle. No cross-call cache, generic skip flag, storage proof shortcut or lossless-data transformation.

With same-image checking, the large stored-project check finishes in~58s (`1791105941657`). Later profile `1791106578748` identifies per-fragment encoding/hash work: first project digest67.642–106.342s; content digest still active at120s. Pack JSON-produced small tokens inside each canonical/ordered traversal into existing≤64UTF16-unit fragments, flushing before every traversal returns so per-record hash counters remain exact. Keep exact output/prefix-on-validation-error, surrogate safety, hash algorithm/frames and all traversal checks. Bound scratch to1024logical bytes, register custody inside charged operation and release on all exits; never yield in cancellation cleanup. JSON punctuation/scalar output can use its known ASCII length rather than encoding it twice. No digest buffering across records, SHA change, transaction scheduling change or larger fragments.

**Architecture:** One normalized worker writer and existing workspace/queue/write-owner capabilities. Browser owns legacy-source capture and current editor exports; worker owns normalized preparation, validation, transactions and readback. The default app switches once after connected integration checks; it never falls back to historical project writes. Historical constructors/tests may remain explicitly injected for compatibility, but normalized instances reject `save-project` without reading its payload.

### Task19: Shared source serialization

User approved sharing serialization across required startup hashes, with the overarching real-app opening/editing/durability goal unchanged. Immediate baseline `task-19-shared-source-digests-baseline` at ee5a84f…/1209. Implement inline; no new approval interview.

1. Add independent old-frame SHA-256 oracle tests for project, content and archive digests, including historical/fresh sources, Unicode/extensions, multiple projects and differing storage/workspace order. Count actual project canonical traversals; test cancellation and zero temporary custody.
2. Factor existing bounded SHA receiver in `canonical.ts` into a scoped group with at most three live hash states. A shared fragment is encoded once, then charged and fed independently to each required hash. Preserve≤64UTF16/192UTF8 fragments,≤600visits per SHA update, exact per-hash byte counters and allocation/finalization guards. No full serialized payload cache, new hash format or storage authority.
3. Add pure `normalized/sourceDigests.ts`: stream each validated project body once into its stored-record digest and content digest; also feed fresh archive when its seed order matches workspace order. When orders differ, preserve original archive sequence with a separate bounded pass. Historical archive has no project payload. Construct exact existing archive envelopes and metadata, then compute existing aggregate source digest from resulting project digests as before. Connect only `prepareSourceWork`/`deriveCapturedSource`; retain all validation, source/marker comparisons, target/current checks and seals.
4. Run focused/boundary/build/typecheck and read-only review, then the unchanged actual saved21MB `/app` scenario. A faster subphase is not completion; require opening and subsequent autosave/switch/reload/retry before claiming full acceptance. Keep existing preview and all failed evidence until a verified replacement is available.

Task19 native profile `1791133709353` confirms shared source hashing completes32.322s and total source preparation finishes97.633s. The next stall is whole-archive equality: freshly constructed archive borrows the same `seed`, workspace, presets/imports and ledger values from the already validated immutable capture, yet compares their serialized bytes again. Replace only this redundant comparison with exact root-key-order checking, identity equality for those known borrowed fields, and full ordered comparison for all derived metadata or distinct payload objects. Do not change physical seal equality, source hashing/validation or any immutable-capture precondition. Retain copied/changed/reordered archive regression oracles.

**Tech stack:** Existing TypeScript/React, module worker, cooperative Work, IndexedDB, Vitest and isolated browser fixtures. No new package or format/store.

## Constraints

- Worktree `.worktrees/incremental-local-persistence`, branch `feat/incremental-local-persistence`, HEAD `8a2872d9a5acae1be3022923c4c515c70212de83`. Preserve dirty predecessor and empty index. Immediate baseline `task-16-normal-editor-integration-baseline` under `/tmp/opencode/doctect-incremental-sdd`.
- Keep32MiB AppState/depth512/history50,1024visits/64KiB Work, JSON64UTF16units, SHA192bytes/600visits, receipt32entries/64KiB, migration64records/256KiB and retry bounds. No new aggregate cap.
- Ordinary request timeout remains30000ms; unit defaults5000/10000ms remain. Long startup work yields correlated progress replies at existing cooperative yield points and continues via separate requests; no ordinary-save timer relaxation.
- Historical projects, migration ledger and normalization archive remain immutable after reservation. Never instantiate a fallback writer on worker failure. Protect sibling/scripts/SQLite/ports and test only isolated data.
- No frequent full-state callbacks, wrapper `initialState` getters, workspace reconstructions, or project remounts on acknowledgements. Explicit JSON/cloud/recovery exports and bulk replacements are separate boundaries.

## File Responsibilities

| Files | Responsibility |
| --- | --- |
| New `services/localWorkspace/workspaceStartupProtocol.ts` | Bounded startup request/progress/result framing, independent of payload traversal |
| New `services/localWorkspace/normalized/startup.ts` | Worker normalization-session ownership, cooperative progress/continue gates and cancellation |
| `workspaceWorkerProtocol.ts`, `normalized/coordinator.ts`, `workspaceWorker.ts`, `normalized/repository.ts`, `normalized/migration.ts` | Shared worker ordering; real worker prerequisites; explicit project opening; source-safe normalization transport |
| New `services/localWorkspace/workspaceStartup.ts` | Browser-side normalization-session facade and source/progress orchestration; no normalized writer |
| New `services/localWorkspace/workspaceEditingSession.ts` | Installed project registry, lifecycle/queue wiring, metadata catalog, working exports and authentic restart |
| New `services/localWorkspace/NormalizedWorkspaceStore.ts`, existing `index.ts`, `contracts.ts` | Default worker-backed store; bootstrap/recovery publication and explicit bulk compatibility boundaries |
| New `hooks/useNormalizedWorkspace.ts`, `pages/EditorPage.tsx` | Normal page uses incremental per-project writer hooks; metadata-only status/catalog updates and stable source keys |
| `services/document/contracts.ts`, `components/ProjectEditor.tsx` | Source-bound explicit working export/replacement registration, never per-keystroke assembly |
| `components/workspace/WorkspaceBootstrapGate.tsx`, optional small normalized-gate component | Preserve live owners beneath recovery; retry without losing unsaved state |
| `components/cloud/CloudMenu.tsx`, import/recovery presentation seams as needed | Explicit current working snapshots for cloud/publish/download; correct normalized/retained export names |
| Tests beside these modules; `tests/unit/localWorkspaceBoundary.test.ts` | Real store/normal EditorPage composition, exact capability edges, concurrency and regression coverage |

## Task 1: Worker Startup and Project Admission

**Measured bulk integration correction:** the actual normal-app21MB JSON replacement reached the unchanged30000ms transport timeout before acknowledging. Reuse the cooperative progress/continue owner for explicit replacement, passing that owner's Work runtime into the existing repository replacement method. A store-owned transport serializes only around this explicit bulk stream, so later ordinary requests are posted after it rather than timing out in a worker backlog. Every actual request still uses30000ms; one atomic replacement transaction and its proof/readback remain unchanged. No ordinary-save heartbeat or timeout increase.

**Bulk validation duplication:** native worker profiles at5s and45s show repeated complete scans in `validatePreparedWorkspaceProjectWork`, immediately before `decomposeProjectWork` performs the same strict wrapper/current-schema/AppState validation again. At this private seam the repository already detached the batch before suspension. Remove only the redundant returning validator at this call site; keep the codec's unconditional validation, capture clone, independent output reconstruction and durable readback. No trusted flag, validation receipt, loader normalization, global validator change, or Work-budget change. Regression tests must prove no additional full-input clone, unchanged extensions/order, and rejection of invalid captured data, including clone-produced array holes and wrapper depth.

The resulting normal-app run `doctect-normal-autosave-1791076671445` reached durable readback about104s earlier, but still exhausted600s during verification; autosave acceptance remains open. `replacementImage` reconstructs each private capture, then `verifyBulk` reconstructs that same unchanged image again despite already accepting an optional external result. Return that exact validated external value and pass it to `verifyBulk`. Each pre-write and post-write capture remains independent and fully validated; all baseline/core/image hashes, transaction sealing and reference/fold admission remain. Do not reuse the pre-write result for readback.

- [ ] Add real normalization-fixture tests before implementation. New messages open a normalization session, perform a named step, continue a yielded step, and close/dispose. Unknown/stale tokens refuse before work. Ordinary commands cannot interleave with an active startup owner.
- [ ] Implement a worker-owned `NormalizationPreparationSession` with one authentic Work runtime. At a cooperative yield, sufficiently long operations may return a metadata-only progress response and pause until a correlated continuation. Each transport request retains the existing deadline. Disposal rejects a paused continuation and releases the session.
- [ ] Browser facade implements existing `openNormalizationSession(work)` contract for the existing normalization controller; browser historical source capture/quiet fences remain unchanged. No normalized IDB operation is exposed to UI.
- [ ] Add explicit `open-project` under workspace admission. Repository independently reads/adopts current records and returns one public project, scope, authority and fresh project admission. No caller-supplied snapshot can mint authority.

```ts
const opened = await client.request({ type: 'normalization-open' });
expect(opened.type).toBe('normalization-opened');
// Run existing normalizeWorkspace against the remote session facade.
const project = await client.request({ type: 'open-project', workspaceAdmissionId, scope });
expect(project.type).toBe('project-opened');
```

## Task 2: Normalized Store and Editing Session

- [ ] Create one authenticated editing session per store lifetime using existing command admission, queue, installation registry and workspace lifecycle APIs. Ordinary command results stay small. `save-project` always refuses on this store.
- [ ] Keep immutable bootstrap initializers separate from current working exports. Register source-bound `exportState`, `replace` and generation access explicitly. Metadata/status notifications never assemble documents.
- [ ] Install new projects only after real worker admission; apply catalog deltas by identity. Close flushes its captured cut and does not retire surviving histories. Explicit snapshot-shaped compatibility operations outside the editor are bulk boundaries, not ordinary saves or alternate writers.
- [ ] Retry via existing retained queue/workspace/write-owner proofs; preserve original rejected promises and local work. Unexplained authority, unavailable inspection or foreign changes stay blocked/exportable.

```ts
await expect(store.commit({ type: 'save-project', get project() { throw Error('payload read'); } } as never)).rejects.toThrow();
expect(messages.filter(row => row.type === 'document-batch')).toHaveLength(1);
expect(messages.some(row => row.type === 'save-project')).toBe(false);
```

## Task 3: Normal Editor and Explicit Consumers

**Observed autosave integration correction:** real typing emits a complete identity layer-transfer proof even when the immutable layer sequence is unchanged. The queue currently seals every such input, producing three writes for three rapid edits. Extend `services/document/layerFolds.ts` and `incrementalQueue.ts` only to brand reference-proven, all-template, unchanged-sequence transfers in a weak registry. Adjacent pending transfers may coalesce only when both proofs cover exactly the same actual change objects/addresses/layer references, have the same fold basis, and have not been forced by another cut. Unbranded proofs, genuine topology changes, in-flight work, metadata/preferences and workspace cuts keep their existing barriers. No main-thread traversal of opaque mapping arrays or protocol relaxation.

- [x] Add a real normal-EditorPage test: rapid typing coalesces changed-record saves; typing during an in-flight save remains responsive/unsaved until its own receipt. Preference navigation produces no document write and no unsaved-document prompt.
- [x] Connect per-project `useIncrementalProjectWrites` to `ProjectEditor` incremental bindings. Key by project/incarnation/source epoch, not document revision. Keep status and preference failures distinct.
- [ ] Downloads, cloud save/publish, save-and-close and recovery exports request the actual current working state explicitly. Cloud restoration uses editor replacement/history, not remounting stale `initialState`.
- [ ] Keep working owners mounted and noneditable on storage/source failure so retry/export can operate safely. Close/navigation/visibility use finite cuts or best-effort flush as appropriate.

## Task 4: Default Selection and Verification

The normal-app autosave scenario separates its one-off bulk fixture preparation from ordinary editing. It uses the existing Sticker Press600000ms total browser-scenario allowance from `tests/e2e/incremental_performance.spec.ts`, without changing the original120000ms import helper or30000ms request limits. The observed120s bulk-import failure stays an open bulk-performance result, not relabeled a pass. Steady-state autosave evidence must report setup duration separately and prove changed-record traffic during continuing edits.

- [x] After Tasks1–3 are connected, make the normal singleton use the normalized store. No feature flag, dual writer or per-command legacy fallback. Existing historical implementation remains only explicit compatibility/test construction and migration prerequisites.
- [ ] Run normal startup/create/edit/navigate/Undo/Redo/close/import/cloud/export/retry tests plus existing worker/queue/editor/boundary suites. Preserve failures and deadlines; no blanket baseline rewrite.
- [ ] Run isolated normal-app large-project continuous editing while autosaves are pending; verify latest durable state, small changed-record traffic, zero ordinary whole-project save requests and retained Undo. Do not divert into a100ms navigation campaign.
- [ ] Run build/typecheck and read-only review. Report known StickerPressTS2339 and unavailable native engines separately. Record exact source/scope/evidence; do not claim enabled normal-app behavior while default wiring remains absent.

## Development Checkpoint — 2026-10-03

- Default singleton and real EditorPage now use the normalized worker pipeline. Startup progress, explicit project admission, working-state export registration, retained retry custody, source confirmation fences, and identity-layer-transfer coalescing are connected. Historical `save-project` refuses before payload access. This is development wiring, not deployment or acceptance on existing profiles.
- Current source stamp: `9acd0e3afee03aeb8ddc16acdddce6ed2ae3e24935d49f1a4b139bb7a2fa3b6f` /1209 application/test/config files. Task16 baseline remains `24cb334690d00441c3022a3fd1f126f719f7ab398309e7e860b6421e8993184e` /1197. Immediate bulk-follow-up snapshot: `task-16-bulk-validation-baseline`; latest broad review package03 covers37paths against original Task16 baseline.
- Current focused run `task-16-review-current-01.jsonl`: **144PASS/6files**, no skipped/failed/unhandled cases: normal page8, normalized gate2, store5, bulk preparation34, replacement transactions29, rollback faults66. New tests observed RED before fixes. Retryable recovery now covers both thrown readmission failures and returned prerequisite `unavailable`; concurrent retries share one initialization promise; newer authority loss wins over pending import success or failure.
- `task-16-boundary-worker-final-02.jsonl`: **1057PASS/3files** (957boundary,96worker,4startup) at preceding stamp `af79e2367cdd1a4058c618c33de216c43d591cf246d9d5261a57b34ab5aec95b`. The later two-file store/test change covers returned `unavailable` and is included in the144current run. These are separate receipts, not one current-stamp full campaign. `...final-01` hit240s outer shell ceiling without END; retained/excluded. The complete rerun used a sufficient shell allowance; all test/hook/RPC limits unchanged.
- Production build `task-16-checkpoint-build-01` passed11.65s/2486modules. Typecheck still reports only pre-existing `tests/unit/gallerySamples/stickerPress.test.ts:793:36` TS2339. Whitespace check and empty index verified. Protected sibling hashes unchanged; ports3000/3001/4310/4311/4320/4321 unused. No deployment, installs, destructive cleanup, staging/commits, or real-profile access.
- Review `ses_efb82e10dffesE2DWj8a5mntd7` scoped clear after the three retry/publication fixes and returned-result follow-up. Narrow bulk duplicate-removal review `ses_efb6e492bffes8hjYa0qrwhDXu` found no actionable issue. These reviews do not substitute for large-project acceptance or remaining lifecycle/export/cancellation matrices.

### Confirmed remaining blocker

Actual `/app` pinned21,152,284-byte fixture replacement still prevents steady-state autosave measurement. Report `doctect-normal-autosave-1791078021011` reaches final verification, then request9911 receives no response for30000ms and worker is terminated. No subsequent typing actions ran. The earlier600s setup failures remain retained, not relabeled successful imports.

External diagnostic-only bundle `doctect-normal-autosave-1791079889729` adds row start/end console markers solely inside `sealWorkspaceCapture`; application source is unchanged. It confirms the **final all-row readonly seal**, not one huge blocked row, consumes the entire request deadline. Second seal observes1893completed row comparisons (header1/nodes437/variants4/templates1451),18,524,395compared bytes,29,982.1ms span. All compared rows equal;297of1748templates remain when the worker terminates. Actual individual row maximum122.1ms; last row16.9ms. The diagnostic has `actions:[]`, `autosave:{}`, `diagnosticOnly:true`; no autosave latency/durability acceptance. Its first instrumentation build failed an overly broad marker-match assertion (`1791079503742`); corrected scoped transform and failed receipt retained. Matching before/after hashes prove source stability only, not unchanged durable records. Timeout after mutation is unknown outcome, never proof of rollback.

The proposed next seal-optimization scope was rejected by the user. No new comparator, descriptor shortcut, transaction scheduling change, heartbeat inside a transaction, or timeout relaxation has been implemented. Import failure remains recorded separately; steady-state autosaves are the current goal.

## Steady-State Autosave Verification — 2026-10-03

No application runtime changes in this follow-up. Two permanent normal-page tests cover automatic debounce without a forced flush, later typing while a genuine earlier reply is held, fresh durable text readback, and automatic preference-only navigation without document writes or an unload prompt. Existing normal-page tests also cover coalescing, in-flight unsaved state, Undo and retry continuity.

Two native Chromium runs exercise60continuous edits each using the actual editor, module worker, queue and native IndexedDB. They deliberately separate ordinary autosaves from large import preparation:

| Evidence | Coverage | Document saves / acknowledgements during typing | Input-to-next-frame p95 / maximum | Largest request |
| --- | --- | --- | --- | --- |
| `/tmp/opencode/doctect-steady-autosave-large-1791082023364/report.json` | Preloaded21,152,284-byte Sticker Press; standalone actual ProjectEditor/hook/queue, genuine independent worker admission | 6 / 5 | 59.2ms /62.7ms | 29,158bytes |
| `/tmp/opencode/doctect-steady-autosave-control-1791082094474/report.json` | Actual root `/app`, default singleton/normal EditorPage;29,244-byte control derived from pinned root template | 5 / 4 | 61.7ms /91.2ms | 29,238bytes |

Both runs passed latest physical durable text, Undo and Redo checks. Large run additionally verified admission of persisted records through a fresh native worker; control verified current Save JSON & Close download. Document writes touched only selected template and header; large run also wrote one separate preference record. No worker `getAll` or historical/workspace/ledger reads occurred during ordinary autosaves. Both recorded zero main-thread long tasks, no page errors and no cleanup errors. Setup was13,781ms/4,945ms and excluded. Input timing includes automation and two animation frames, with IDB counting enabled; this is not INP or a controlled before/after speedup claim.

Large run uses the existing normalized-only fixture boundary, not default-store startup, migration or workspace membership admission. Control covers the real default-app route but uses a small project. Together they verify recurring-save behavior without claiming that21MB default-app startup/import has passed. The known bulk-import timeout stays open and is not a prerequisite for further autosave measurements.

- Both browser runs used unchanged application/test source `9acd0e3afee03aeb8ddc16acdddce6ed2ae3e24935d49f1a4b139bb7a2fa3b6f` /1209files. Only the two added tests change the current stamp to `7e0f971a55d8f32bc9f27f5765eb661fb578a0a8763e57028947ce66c28be9d1` /1209files; runtime is identical.
- **1594PASS/10files** in `task-16-steady-connected-final-01.jsonl`, independently reconciled inventories/results/terminal counts: boundary957, editor persistence43, editor changes224, worker96, normal page10, normal store5, queue189, hook66, normalized gate2, coalescing2. No missing/skipped/retried/failed/unhandled cases;5000/10000ms defaults and one worker unchanged.
- Production build `task-16-steady-build-01` passed11.49s/2486modules. Typecheck only known StickerPress793:36TS2339. Read-only review `ses_efb2afdc6ffev7t9T6rmNEv2E2` scoped clear for test/evidence integrity and coverage distinctions.
- External reproducible tools: `/tmp/opencode/steady-autosave-browser.mjs` (`360cd395628bc90c6bef900520799effe56aa9994f017e9acf1655e9f2ab04a8`), `/tmp/opencode/steady-autosave-entry.tsx` (`02bfa3531db69322029ad13f96449cfe87d645f00ee534bbbcf7fe4364037ccd`). Run modes `large` and `control`; old failed import tools/results untouched.
- Protected hashes, empty index, whitespace and six protected/diagnostic ports checked. No application runtime/sealing changes, deployment, real-profile access, installs or commits in this follow-up. Remaining full MilestoneD/release checks are not claimed complete by the autosave evidence.

## Combined Saved-Workspace Checkpoint — Task17

**Status: partial.** Coupled startup, current-admission safety and retry continuity are implemented and reviewed. The actual21MB saved-workspace cold-open test still exceeds120000ms; full large-workspace acceptance is not complete. No import/seal algorithm, budget or timeout was changed to hide that failure.

### Implemented

- `openEditingWorkspace(work)` performs one fully validated, sealed active read and installs workspace/project owners together. Reference and fold indexes are built before the seal under caller-owned startup custody, transferred to installed repository caches only after verification. Ordinary reads/exports do not install these admissions.
- Startup `editor` operation returns public snapshot plus correlated metadata, not normalized record maps. Browser checks catalog/project/snapshot identity agreement cooperatively, pins private material, exposes a detached snapshot and consumes one client-bound receipt. Worker stop, replacement admission, project reopen and actual bulk replacement revoke unused receipts. An old receipt cannot revoke a newer one.
- Initial session/restart checks receipt liveness across asynchronous preparation and immediately before publication. Stopped clients release unused pinned material. Failed successor construction/adoption preserves the new lifecycle recovery handle with its matching queue checkpoint and original-client attempt provenance, allowing another genuine retry without losing local edits.
- Source-drift, disposal, corruption, replacement, cancellation, receipt substitution and retry-custody regressions ran RED before their fixes. Latest read-only review `ses_efae7e5d7ffeXqJzuefkYKupsO` scoped clear; independent probe also covered two consecutive pre-adoption worker failures followed by successful retry and durable readback.

### Verification and remaining gap

- Current source: `2e098d7b44754e1de3e6922e200c278e81b3da254402526b80325bd2d2da31e4` /1209files. Immediate Task17 baseline7e0f971… remains preserved. Review package04 covers17paths (10runtime,6test/helper,plan), plus untracked ledger.
- **1230PASS/9files**, complete inventory/result reconciliation, no skipped/retried/failed/unhandled cases: `task-17-coupled-connected-final-01.jsonl`. Boundary957, replacement transactions29, worker96, startup22, store6, rollback66, normal page11, bulk preparation36, references7. Existing5000/10000ms defaults, one worker and30000ms RPC unchanged. Typecheck only known StickerPress793:36TS2339.
- Native actual default `/app` with a saved two-project control passed30continuous edits, switching away/back, Undo/Redo, browser reload, injected native failed template write with unchanged durable text, explicit retry, retained Undo and final durable text: `/tmp/opencode/doctect-saved-workspace-control-1791094058941/report.json`. Open3739ms; build11.18s/2486modules; no page/cleanup errors. This is a small-workspace control, not the21MB result. Earlier control receipts `1791085125239`, `1791086710276` and `1791090444215` retain their narrower coverage/source stamps.
- Actual pinned21MB saved-workspace runs `/tmp/opencode/doctect-saved-workspace-large-1791085187449/report.json` (before coupling) and `...1791086828317/report.json` (initial coupling) both fail the unchanged120s opening limit while the first integrity read is still progressing. No editing actions ran. Later safety/custody fixes do not establish a cold-open performance improvement, and no successful large default-app run is claimed.
- Test data comes from external `saved-workspace-fixture.ts` using production codec/manifest helpers and exact persisted source/archive digests. It seeds only a new disposable14-store database; actual app independently validates and mints every admission. Five fixture integrity tests pass in `task-17-saved-fixture-01.tap`. Initial combined fixture test exceeded5s; independent snapshot/workspace/project checks were split without changing timeout. No fabricated runtime acknowledgements or existing-profile migration.

### Isolated preview

- Running at **http://localhost:4322/app**, API4323, owned PID**2512304**. Build/source pinned to current2e098d7….
- Output/database: `/tmp/opencode/doctect-autosave-preview-1791093816790/`; SQLite `api.sqlite` is new and separate from protected preview data. Launcher: `/tmp/opencode/doctect-incremental-sdd/autosave-preview.mjs`; sanitized environment, loopback listeners, no production credentials.
- Fresh nonpersistent Chromium smoke: app200, auth/session200, editor pane visible, saved status visible, zero page errors. Use a private browser window and disposable documents; do not treat this as large-project release acceptance.
- Protected sibling hashes and empty index verified. Ports3000/3001/4310/4311 untouched/unoccupied;4322/4323 intentionally remain for user preview. No merge, commit, deployment, installs or real-profile access.

## First-Pass Validation Checkpoint — Task18

**Status: improvements verified, end-to-end cold opening still fails.** Current source `ee5a84fc53e51e2debe86aa89c198087f3320ec8250e1799b8ac7a8024626b9b` /1209files. Seven changed paths against Task18 baseline: four runtime/declaration files, two test files and this plan; ledger separate. No repository/writer/schema/Work-executor/deadline change.

### Proven work removed

- Known ASCII JSON punctuation/scalar tokens no longer undergo redundant slicing/UTF-8 encoding. Primitive string prefixes compare in bounded growing batches (maximum64pairs/128visits); exact lexical results and compared-code-unit accounting remain. Non-string compatibility path unchanged.
- Stored-project raw and loader-output images each receive complete canonical/schema validation once, with their measured bytes reused internally for the existing32MiB limit. Wrapper inspection retains descriptor/metadata/ancestor/depth checks without walking its exact already-checked `initialState` again. Clone pre-loader validation, loader warnings and clone/output size-growth checks remain.
- Canonical/ordered JSON producers pack small tokens into existing≤64-unit fragments. Every traversal flushes before returning, including its produced prefix on validation failure. Fixed1024-byte scratch is acquired inside a charged operation and released on completion, error and cancellation. All digest bytes/algorithms and per-record accounting boundaries remain unchanged.

### Measurements and limits

| Diagnostic | Observation |
| --- | --- |
| `doctect-saved-workspace-large-1791099836562` | Baseline first stored-project check still running after108.712s at overall120s limit. Raw canonical28.467s, raw AppState16.214s, wrapper canonical31.385s, clone AppState17.006s; loaded-state check unfinished. |
| `1791101933326` | ASCII/prefix changes let large stored-project check finish92.561s after its start. Opening still fails120s. |
| `1791105941657` | Same-image checks finish large project in57.711s; wrapper check0.6ms. Opening still fails later. |
| `1791106578748` | Later profiles identify source hashing, not raw-weight traversal. First large-project digest38.700s; content digest follows; aggregate source digest not reached by120s. |
| `1791108091375` | Token packing: source-project validation55.181s, large-project digest27.339s, content digest starts94.080s and still runs at120s. These are unpaired diagnostic observations, not a controlled full-workflow speedup claim. |

Final **uninstrumented** actual `/app` run `/tmp/opencode/doctect-saved-workspace-large-1791109869053/report.json` still fails opening at120000ms with no editing actions. No first-pass/large-app acceptance is claimed. Profiles make the remaining structural issue explicit: independently required source/content/archive digests serialize large shared payloads in separate traversals, followed by target/current validation. Further scalar tuning is not sufficient; the next focused change must consolidate repeated serialization/validation within the immutable first-read pipeline while preserving every required digest and admission check. No such consolidation beyond the same-image checks above is implemented yet.

### Verification

- **2076PASS/14files**, complete/disjoint inventory and terminal-result reconciliation: `task-18-validation-connected-01.jsonl`804 and `task-18-boundary-migration-final-01.jsonl`1272. No skipped/retried/failed/unhandled cases in these two receipts; existing test limits unchanged. Includes real32MiB boundary/clone-growth/loader-growth checks, depth/ancestor/accessor/error-cause parity, cancellation, codec, hashes, historical bootstrap and957boundary cases.
- Earlier `task-18-same-image-green-01`467PASS/3FAIL preserved: cancellation fixtures targeted obsolete three-call validator composition. They now cancel the actual combined post-loader inspection and assert unfinished traversal/ownership release; full final run passes. All intended RED receipts retained.
- Scoped read-only review `ses_ef9ed2307ffemFiuCL5kUtCmM1` found no actionable correctness issue in same-image checks or additive packing under immutable captured-input contracts.
- Production build `task-18-validation-build-01` passed11.90s/2486modules. Typecheck only known StickerPress793:36TS2339.
- Current native preloaded21MB editor regression `/tmp/opencode/doctect-steady-autosave-large-1791109696483/report.json` passed60edits→6saves,5ACKsduringtyping,p9559.5/max72.6ms,zero observed long tasks; same changed-record traffic and durable Undo/Redo/fresh-worker checks. This remains a standalone preloaded editor, not large default-app startup.
- Actual default-app saved-workspace **control** `/tmp/opencode/doctect-saved-workspace-control-1791109745724/report.json` passes opening, switching, reload, failed-save retry and durable text/Undo; open3632ms, no page/cleanup errors. All browser contexts/data disposable.
- External `cold-start-probe.mjs` supplies diagnostic spans/CPU capture. Initial spans lacked transform sourcemaps; those results used generated-code/spans rather than claimed original line locations. Later probe uses existing MagicString dependency for accurate maps. Diagnostic runs are explicitly marked and never acceptance.
- Preview4322/4323/PID2512304 intentionally remains pinned to prior verified Task17 build2e098d7…; not silently replaced with this incomplete large-startup checkpoint. Protected hashes, index and whitespace verified; diagnostic4320/4321 released. No installs, commits, deployment or existing-profile access.

## Shared Source Serialization Checkpoint — Task19

**Status: shared hashing verified; full large-workspace goal remains incomplete.** Current source `8b92d4d00acee7f4a80d6ece9e0555efad9b2c602553ced02734ffd341cfcb93` /1211files. Immediate baseline remains `task-19-shared-source-digests-baseline` at ee5a84f…/1209. Review package04 covers seven paths: three runtime files, three test files and this plan; ledger separate.

### Implemented and checked

- `withFrameDigests` scopes at most three independent SHA states. Compatible project/content/fresh-archive hashes share one canonical payload traversal and fragment encoding; every digest still charges its own byte/compression work. Frames, hashes, fragment/Work limits and exceptional cleanup remain unchanged. Interleaved allocation cannot exceed the three-state scratch cap; finished, foreign, oversized, cancelled and escaped operations refuse without leaked custody.
- `hashSourceImages` preserves original stored-record, content and archive formats. Fresh storage order differing from workspace order retains its independent archive pass; historical archives retain their ledger/backups. Independent old-frame SHA oracles check bytes, Unicode/extensions, record order, collisions, traversal count and cancellation.
- Same-capture archive equality checks exact root key order and descriptors, reusing identity only for known borrowed payload fields. Derived metadata and distinct payloads still receive complete ordered comparison. Source validation, marker comparisons, target/current verification and physical seals are unchanged.
- Final boundary correction renamed pure hash-group `open` to `createDigest`; the strict storage-capability `.open` rule was not weakened. Earlier `task-19-connected-final-01.jsonl` remains **1380PASS/2FAIL**, both naming collisions, not a passing campaign.

### Verification

- `task-19-connected-final-02.jsonl`: **1382PASS/9files**, complete inventory/results/terminal-count reconciliation, zero retries/skips/unhandled errors. Covers grouped Work260, source digests11, SHA24, canonical65, startup22, store6, normal page11, workspace manifest26 and boundary957.
- `task-19-migration-source-01.jsonl`: **84PASS/576unselected** from the660-case migration file. Includes independent phases, source/target seals, actual archive collisions, historical backup identities, resumed prefixes and prepared replay. This is targeted coverage, not a full migration rerun.
- Existing5000/10000ms defaults, named existing exceptions, one worker and30000ms RPC remain unchanged. Build `task-19-shared-source-build-01` passes13.45s/2486modules. Typecheck reports only the known StickerPress793:36TS2339.
- Read-only reviewer `ses_ef965d4ddffeO0FQdqmz0QQkof` scoped clear after reproduced scratch-cap and boundary findings were fixed. Final package04 preserves exact immediate-baseline scope, hashing/lifecycle/custody and boundary restrictions.
- Actual default-app saved two-project **control** `/tmp/opencode/doctect-saved-workspace-control-1791137638626/report.json` passes opening3707ms,30continuous edits, project switching, Undo/Redo, reload, native failed-save rollback, retained local text, explicit retry and final durable readback. No page/cleanup errors. This is not the21MB result.
- Actual uninstrumented21,152,284-byte workspace `/tmp/opencode/doctect-saved-workspace-large-1791137719623/report.json` still fails the unchanged120000ms opening limit, with `actions:[]`. Matching before/after source stamps and clean cleanup do not change that failure. No full large-app acceptance is claimed.

### Remaining architectural boundary

Diagnostic `1791133709353` completes all source-image hashes in32.322s and source preparation at97.633s, then stalls on the redundant same-capture archive comparison. After its removal, `1791134897554` completes `prepareSourceWork` at98.119s and `deriveCapturedSource` at98.126s. These are unpaired diagnostic observations, not controlled end-to-end speedup claims. `digestFrame` end spans now observe Promise return rather than awaited completion; use awaited parent spans and native CPU profiles.

The105s sample maps precisely to `deriveTarget` → target-manifest frame → `TargetCursor.next` → `decomposeWork` → `validateExternalWork` → `canonicalCheckWork(project)`. Record sizing and meaningful target-record hashing have not started. Source preparation already checked this exact immutable raw project; it did not replace it with the loader output. Scope identity checks remain separately necessary.

Avoid stacking another local tuning patch or introducing a trusted-input switch. The next architectural decision is how one capture-owned first-read pipeline can share same-image validation/serialization across source and target construction without reusable validation receipts, cross-read caching, changed loader behavior or weaker independent physical/current checks. Existing standalone codec ingress must continue validating untrusted input. No such source-to-target validation reuse has been implemented or accepted by this checkpoint; broader pipeline design needs to resolve this boundary before code changes.

Preview4322/4323/PID2512304 remains on verified Task17 build2e098d7…; HTTP200, protected sibling hashes, empty index, whitespace and released4320/4321 checked. No installs, commits, deployment, existing-profile access or protected SQLite changes.

**Task20 follow-up:** User explicitly approved broader capture-scoped first-read consolidation on2026-10-04. See [implementation plan](2026-10-04-capture-scoped-first-read.md) and [design](../specs/2026-10-04-capture-scoped-first-read-design.md). Source-to-target projection now shares one validated immutable capture with expiring interfaces and provisional-plan cleanup, while standalone ingress and independent current/physical checks remain. Current d3d04a2…/1212 has1606connected passes plus88targeted migration passes; small native workflow passes. Actual21MB run1791144717148 still fails120s before editing. This remains approved ongoing first-read work, not full acceptance or a new import/performance-policy gate.
