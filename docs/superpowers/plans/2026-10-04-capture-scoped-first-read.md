# Capture-Scoped First Read Implementation Plan

> **For agentic workers:** Use executing-plans and TDD inline. Read-only review allowed; no implementation handoff, staging, commits, installs, deployment or existing-profile access.

**Goal:** Remove repeated same-capture source-to-target work while preserving independent integrity checks, then verify the actual21MB default-app editing/durability workflow.

**Architecture:** `codec.ts` owns a scope that validates source records and supplies one lifetime-bound target projector. Repository source derivation and target construction execute inside that scope; all other ingress stays self-validating. Neither a scope nor its emitted data grants storage authority.

**Tech Stack:** TypeScript, existing cooperative Work/JSON/SHA, Vitest, real module worker and disposable native IndexedDB.

## Global Constraints

- Follow `../specs/2026-10-04-capture-scoped-first-read-design.md`; approved direction on2026-10-04.
- Preserve32MiB/depth512/history50;1024visits/64KiB Work;64UTF16/192UTF8/600visits SHA; migration64records/256KiB with existing oversized singleton;30000ms RPC and120000ms opening;5000/10000ms unit defaults and existing named exceptions.
- Every independent capture/phase validates afresh. No generic trusted flag, cross-read cache, dropped loader/hash/current/seal check, new writer/store or import optimization.
- Worktree `incremental-local-persistence`, HEAD8a2872d; immediate baseline `task-20-capture-scoped-first-read-baseline` at8b92d4d…/1211. Preserve dirty predecessor and empty index. Use unique external receipts.

## Files and interfaces

- `services/localWorkspace/normalized/codec.ts`: add capture scope; separate private projection from validated standalone ingress; keep cursor custody/frames.
- `services/localWorkspace/normalized/repository.ts`: continuation-scoped source/target flow; no persistence/proof/seal policy change.
- `tests/unit/localWorkspace/normalized/sourcePipeline.test.ts`: independent-frame, work-count, scope/lifecycle/cancellation tests.
- `tests/unit/localWorkspace/normalized/migration.test.ts`: assert actual per-phase projection/validation work at the new seam rather than obsolete public wrapper call counts.
- `tests/unit/localWorkspaceBoundary.test.ts`: exact codec-to-existing-source-validator dependency only; no storage capability relaxation.

```ts
export interface SourceTargetCursors {
  create(source: NormalizationSource): TargetCursor;
  plan(source: NormalizationSource): PlannedTargetCursor;
}
export async function withSourceRecords<T>(
  input: WorkspaceRecordCandidates,
  work: WorkRuntime,
  consume: (records: WorkspaceRecords, cursors: SourceTargetCursors) => Promise<T>,
): Promise<T>;
```

### Task1: Self-validating scoped target projection

- [x] Add tests that assert `withSourceRecords` exists, executes the real stored validator, and produces byte-identical frames to `prepareNormalizationTarget` without another canonical/AppState check during projection. Use `makeEmissionSource`, `makeWorkHarness`, `collectTarget` and existing raw fixture/validation helpers.
- [x] Run `npx vitest run tests/unit/localWorkspace/normalized/sourcePipeline.test.ts --maxWorkers=1` and retain intended missing-interface RED.
- [x] Implement the above interface. Capture own-data array/row/project identities before `validateWorkspaceRecordsWork` under charged metadata custody. Bind factory to exact checked records/project-array identities, runtime and phase; require an own-data `source.records`, allow one cursor, and reject replaced row/project references and scope escape. Guard every operation and plan transfer. Execute consumer under lifecycle checking; unconditionally dispose the cursor, including exhausted cursors. Clear/release the private identity index.
- [x] Keep taken emission plans in scope failure custody until the entire scope completes. Register each transfer before a post-operation guard can fail. Dispose on callback error/final lifecycle loss; successful scope completion transfers existing stage-plan ownership to the recipient.
- [x] Split `decomposeWork` so its standalone entry still performs scope/id and `validateExternalWork`, then calls private projection. Scoped target cursor performs scope/id checks and calls only that private projection for eligible own-data-property captured payloads. Preserve accessor compatibility through ordinary validation.
- [x] Add/refine tests for all lifetime and malformed-input cases listed in the design, transferred/abandoned recipes, and independent subsequent scopes. Run sourcePipeline and complete existing codec tests. No untested generic escape hatch.

### Task2: Keep source and target inside one scope

- [x] Add a real repository normalization/open test that counts the source checks and rejects duplicate target payload validation. Keep expected source bytes and independently sealed snapshot/target outputs unchanged. Observe RED before wiring.
- [x] Change private `prepareSourceWork` to take a continuation receiving its existing result plus `SourceTargetCursors`. Execute hash/ledger/backups work in the validator scope. Change `deriveCapturedSource` to pass its complete checked result through a continuation. `deriveTarget` uses `cursors.create` or `cursors.plan` inside it; retained/strict callers return data only.
- [x] Update existing phase test to observe real `partitionStateWork` and `createEmissionBuilder` calls: four independent projection phases and one staging plan. Preserve all source/target derivation, capture, stage and custody assertions.
- [x] Add only the exact new pure codec dependency to the static boundary registry. Run complete boundary, startup, store, normal editor, source digest, Work/SHA and targeted normalization source/target/race/replay tests with unique stamped receipts.

### Task3: Native first-read and final verification

- [x] Run actual unchanged saved-workspace control and21MB `/app` scenario using `/tmp/opencode/doctect-incremental-sdd/saved-workspace-browser.mjs`; each uses separate absent disposable DB and closes its owned resources.
- [x] If large opening still fails, preserve failure and collect native phase/CPU evidence before any further first-read consolidation. Do not turn a faster subphase into acceptance or add another timeout/work-dispatch/import workaround.
- [x] Obtain read-only immediate-baseline diff review; reproduce and test any actionable finding before fixing.
- [x] Run `npx tsc --noEmit --pretty false`, `git diff --check`, and `TMPDIR=/tmp/opencode npm run build --legacy-peer-deps -- --outDir /tmp/opencode/doctect-incremental-sdd/task-20-first-read-build-01`. Report existing StickerPress793:36TS2339 separately.
- [x] Reconcile test inventories/results/stamps, source scope and protected resources; update this plan and execution ledger. Keep preview on its prior verified build until the full replacement is verified. No commits or branch integration.
- [x] Full acceptance: actual21MB workspace opens within120s and completes autosave/switch/Undo/Redo/reload/native failed-save retry with durable readback. Verified Task26 under the explicitly approved confirmed-rollback continuation amendment; see checkpoint below.

## Checkpoint — 2026-10-04

**Partial, not the final goal.** Capture-scoped source-to-target projection is implemented and reviewed. Current source `d3d04a2a00d0ad0136fb79f025c9e352c2b7de442dacc4ed4482097420c1a102` /1212files. No source/current/loader/hash/seal check, Work budget, schema or deadline was relaxed. Standalone codec ingress remains self-validating; ordinary autosaves are unchanged.

### Safety and tests

- 36new scope cases plus one real repository regression. Independent target-frame/replay oracles, real source validation, malformed input, separate original/current checks, exact capture/runtime/phase binding, late substitution, cancellation and provisional emission-plan ownership covered.
- Read-only reviewer `ses_ef7c3b840ffeJAvNCstTHpfw79` scoped clear at package03 after four actionable runtime findings were reproduced and fixed: late row/project substitution; caught transfer error leaking a plan; source-root replacement after cursor disposal; escaped transfer during final audit. New tests also cover exhausted-cursor runtime binding and late array membership. Independent final probes show zero residual custody.
- `task-20-connected-final-01.jsonl`: **1606PASS/11files**, complete inventory/results/terminal reconciliation, no skipped/retried/failed/unhandled cases. Includes scope36, codec188, source digests11, Work260, SHA24, canonical65, startup22, store6, normal page11, manifest26 and boundary957.
- `task-20-migration-final-01.jsonl`: **88PASS/573unselected** from661cases. Independent phases, source/target/seal races, archive/backup compatibility and emission replay checked. Not a full migration rerun. Both receipts use current stamp and existing limits.
- All RED receipts remain. First integration RED01 had an incorrect one-image assertion: active reading independently validates retained source and reconstructed current state; corrected RED02 targets only redundant source payload traversal. Initial integration GREEN01 retained5PASS/1FAIL from a cancellation spy on the replaced public cursor constructor; moved the spy to actual emission-builder transfer, preserving cancellation and unchanged-durable-rows assertions.
- Build `task-20-first-read-build-01` passes15.62s/2486modules; typecheck only known StickerPress793:36TS2339. Exact new runtime edge is codec→existing workspace migration validator. No general storage capability grants.

### Native result and next measured work

- Current small actual `/app` control `/tmp/opencode/doctect-saved-workspace-control-1791144681188/report.json` passes opening2733ms,30edits, switching, Undo/Redo, reload, native failed-save rollback, explicit retry and final durable text. No page/cleanup errors; unpaired timing, not a causal speedup claim.
- Current uninstrumented21MB run `/tmp/opencode/doctect-saved-workspace-large-1791144717148/report.json` **fails opening at120000ms**, `actions:[]`; no large-app editing/durability acceptance. Source stable and cleanup clean.
- Diagnostic `/tmp/opencode/doctect-saved-workspace-large-1791142723390/report.json` at preceding ffe2d159…/1212 shows large source validation65.798s, second project89.2ms, source-image hashing35.010s. Target `projectWork` begins116.838s without the former `validateExternalWork` pass, and has not finished by120.644s. Both85s/105s profiles still sample source hashing, not target sizing/partition/ledger. Thus the precise last target substage is not established. These unpaired measurements include host/instrumentation variation and do not show end-to-end latency improvement.
- Scope continuations make `prepareSourceWork`/`deriveCapturedSource`/`deriveTarget` return-Promise end spans unreliable; `digestFrame` had the same limitation already. Use internally awaited `hashSourceImages`/`withSourceRecords`, generator completion spans and native CPU samples.
- Remaining approved work is first-read consolidation, especially the still-separate source integrity inspection and hash serialization. The new capture-owned seam does not remove those passes. Define exact byte/error/lifecycle equivalence before further producer integration; do not guess a target sizing hotspot, skip clone/loader checks, tune generic Work dispatch, revisit import sealing or change deadlines. Broad scope approval remains in force; no new product interview is needed.

Preview4322/4323/PID2512304 remains on Task17 build2e098d7… pending actual large-workspace acceptance. Protected sibling hashes, empty index, whitespace and released test ports checked. No staging/commits, dependency changes, deployment or existing-profile access.

## Task21 continuation: test repeated key-order computation against the real goal

User again requested continuation without deviating from the large-workspace goal. Immediate baseline `task-21-source-traversal-consolidation-baseline` at d3d04a2…/1212. A read-only census of the actual pinned AppState finds58,490plain objects but only21key layouts. Nineteen eligible layouts occupy13,716logical metadata bytes under a16KiB budget and cover58,466repeat sorts per traversal. Actual85/105s source-hash profiles attribute3.255% inclusive samples directly to sorting; associated suspended-Work dispatch cost is not attributed by that number, so it is not a speedup prediction.

- [x] Test a diagnostic-only Vite worker transform in the existing disposable actual-app scenario before changing production. Reuse only computed lexical key order for an exact length-prefixed key sequence, locally within one canonical traversal. Bound admission to32keys,64UTF16units/key,384units total and16KiB retained metadata; oversized keys/shapes retain ordinary sorting. These are cache-admission limits, not data limits. Every current descriptor/value/prototype/depth/cycle check still runs; no validation result or project payload is cached.
- [x] Keep all Work/fragments/SHA/source/current/seal/deadline contracts unchanged. Charge bounded signature construction/lookup and metadata custody; release on success/error/cancellation. No generic Work executor or scheduling experiment. Diagnostic flag and variant identity must distinguish transformed build from unchanged source stamp.
- [x] Judge actual21MB first-read progress, not a tiny benchmark. If useful, write permanent output/error/budget/custody regression tests before promotion, run affected suites/review/build, and rerun unmodified production browser scenario. If not useful, retain failed experiment evidence and do not promote it. Full editing/switch/reload/retry remains acceptance gate.

Diagnostic1791146792327 advances materially: source validator42.775s vs65.798s in the earlier unpaired baseline; source hashing26.754s vs35.010s. First target projection now finishes at114.811s instead of merely starting near116.838s. Opening still fails120s, so no acceptance/speedup guarantee. Both85/105s samples now identify ordered record-size counting inside `projectWork`, not partition or the final size ledger. Promote the tested ordering-only optimization, preserving every JSON check and exact frames.

The codec then measures each entire original template again solely to compute the byte delta from removing `layer.collapsed`. Partitioning retains every other field/value unchanged. Replace this demonstrated redundant full-template walk with exact removed-member arithmetic: JSON bytes of each removed `collapsed` value plus `"collapsed":` and a comma iff another member remains. Preserve raw/non-boolean folds, duplicates/non-string IDs, collapsed-only/empty layers, absent layers and all counters. Standalone/source validation remains unconditional where already required. Add independent native JSON byte-difference oracles and a spy proving original template is not rescanned; verify encoded records, size ledgers, reconstruction and existing fold/bulk tests. No input cap or payload cache.

Full-path diagnostic1791148526579 records the original120s opening failure before240s additional passive observation. It never resumes editing or relabels acceptance. The read continues through source validation42.125s, source hashes32.615s, target projection17.018s, target logical weighting10.197s, target records through~184s, current reconstruction72.708s and current stored validation56.885s. Progress stops at315.988s, then the unchanged30s RPC timer terminates the worker. Code points to the final all-store synchronous seal, but no final CPU sample distinguishes IndexedDB materialization from comparator work. Do not replace the atomic seal with a marker-only check or persist new digests.

The same JSON producers dominate several stages. Consolidate one short escape-free ASCII object key/scalar field into a single≤64-unit token instead of separately dispatching comma/key/colon/scalar steps. Retain every descriptor/value/prototype/depth/cycle check; preserve original fallback and error prefix for escapes, Unicode, long strings, non-scalars and invalid values. Count-only writers receive known-ASCII token lengths, output writers keep exact bytes/fragments, and numeric native conversion remains counted. This is bounded producer fusion, not a Work-executor/scheduler change. Tests first: actual yielded-operation counts plus independent canonical/ordered byte, scalar-boundary and error-prefix oracles; existing exhaustive UTF16/frame/cancellation suites remain gates.

Further producer-only consolidation keeps the same contract: inspect native key-list membership in≤64-key/128-visit groups before reading any payload descriptor, and construct eligible order-cache signatures with≤32keys/384input units in one charged≤897-visit operation. Signature lookup remains≤960visits. All key checks/order and errors remain; no generic operation batching or executor change. For primitive UTF-8 inputs already fitting the existing512-unit scratch, count directly without first copying the entire identical string. Longer and string-like inputs retain the old path. Permanent RED tests pin metadata-operation reduction, symbol-before-getter refusal, and actual eliminated-copy visits with native UTF-8 byte oracles.

## Task21 verified checkpoint — goal still incomplete

Current source **`9745d1f069ddb113d075c87e253d1d34d78c52da4ca877fcef54ec6dbb272a1d` /1214files**. Seven changed paths against the immediate Task21 baseline: two runtime files, four test files and this plan; ledger separate. Source/target/current validation, exact digest bytes, atomic seals, schemas and deadlines remain unchanged. No generic Work driver or scheduling modification.

### Verification

- **1879PASS/18files**, independently reconciled complete/disjoint inventories, terminal results, source stamps and original limits: `task-21-connected-final-02.jsonl`1739 plus `task-21-bulk-final-01.jsonl`140. No skipped/retried/failed/unhandled cases in these final receipts. Includes real32MiB boundary/clone-growth/loader-growth checks,957static boundary cases, current editor/startup/store flows, exact hashes,195codec cases and131bulk preparation/transaction/rollback cases. Full661-case migration suite was not rerun.
- 42new regression cases:17key-order/membership,14scalar-field,7overlay arithmetic and4bounded UTF-8 copy cases. Intended REDs retained. Reviewer reproduced a25-unit negative-decimal case that exceeded the initial24-unit estimate; permanent35/36-unit-key cases now cover it, bound25 plus actual-length fallback fixes it. Prefix, Unicode, field-order, current-descriptor validation and custody oracles pass.
- Read-only review `ses_ef71f7210ffe3D4n7mTEUPIvKj`, package04, scoped clear. Independent final probes covered52UTF-8 cases,33key/membership cases and6cancellation points, with zero abandoned custody.
- Production build `task-21-source-producers-build-01` passes11.23s/2486modules. Typecheck only known StickerPress793:36TS2339. Three temporary test-generator narrowing errors were corrected with explicit `done === true`; no runtime type errors remain.

### Native results

- Current uninstrumented small actual-app control `/tmp/opencode/doctect-saved-workspace-control-1791164232004/report.json` passes the complete30edit/autosave/switch/Undo/Redo/reload/native failed-save/retry/durable-readback workflow. Open2643ms; no page/cleanup errors. Not a controlled timing comparison or large-workspace acceptance.
- Current uninstrumented21MB run `/tmp/opencode/doctect-saved-workspace-large-1791164266005/report.json` **still fails120000ms opening**, with `actions:[]`, stable source and clean cleanup. Do not claim completion or update the preview on that basis.
- Preceding full-path diagnostic `/tmp/opencode/doctect-saved-workspace-large-1791150832431/report.json` at fc421245… records the original120s failure, then240s passive observation, never resumes editing and remains `completed:false`. Compared with earlier unpaired1791148526579: source checker31.708s vs42.125s; source hashing22.800s vs32.615s; projection9.402s vs17.018s; target-record interval48.645s vs68.182s; reconstruction40.296s vs72.708s; post-reconstruction stored checker31.768s vs56.885s. Last progress shifts315.988s→215.251s, then unchanged30s RPC termination occurs. These are diagnostic observations, not controlled causal speedup or acceptance, and precede final metadata/UTF-8 refinements.
- The whole-path trace exposes remaining duplicated reconstruction/current-validation work and the final synchronous full-record seal. Do not guess that the final silence is solely JS rather than IndexedDB delivery; no late CPU sample distinguishes them. Preserve atomic same-marker content-race detection; a paged comparison plus marker-only CAS is not equivalent. Next work must consolidate that first-read pipeline with equivalence tests, not add more tiny tuning, relax checks, revisit import benchmarks or extend limits. Existing broad scope approval remains in force.

### Temporary quota incident and authorized cleanup

`task-21-connected-final-01.jsonl` remains a **failed infrastructure run**:1700cases passed but EditorPage/store/startup modules could not load, with3EDQUOT(-122) write errors. `/tmp` is a usrquota-enabled tmpfs; free filesystem space did not exclude per-user quota. Vitest's unchanged fork pool writes transformed modules under `os.tmpdir()`. No test limit or pool change was used to hide the failure.

User explicitly authorized cleaning regenerable task-owned outputs. `cleanup-task21-generated.mjs` first verified966files byte-for-byte against current repository `public/docs-assets` and `public/walkthroughs`, then removed only those28copied subdirectories from14obsolete Task10builds: **738,172,596bytes**. Receipt `task-21-cleanup-01.json` records exact paths/hashes. Every build index/code bundle/map, report, profile, fixture, baseline, SQLite/project database and running preview was preserved. The successful rerun kept the original fork pool/one worker/default deadlines and used `TMPDIR=/tmp/opencode` for owned temporary transport files.

Preview4322/4323/PID2512304 remains on Task17 build2e098d7…, HTTP200. Protected sibling hashes, index, whitespace and released diagnostic ports checked. No installs, staging, commits, deployment or existing-profile access; the only deletion was the explicitly authorized regenerable-copy cleanup above.

## Task22: Combine current reconstruction and stored validation

User requested continued focus on the actual large-workspace goal. Immediate baseline `task-22-current-reconstruction-baseline` at9745d1f…/1214. Full-path evidence identifies current reconstruction followed by another full stored-project check, including repeated validation of the same assembled original image. Implement inline within the approved first-read consolidation; do not weaken independent source/current, clone/loader/output, proof or seal checks.

### Interface and ownership

Add a purpose-specific self-validating codec composition. The existing standalone `reconstructProject`/`reconstructProjectWork` keep their validation. Only private assembly/counter helpers are shared; no unchecked decoder, supplied validator or trusted flag is exported.

```ts
export function createWorkspaceReconstructor(): {
  project(records: NormalizedProject, metadata: Omit<StoredProject, 'project'>): Work<WorkspaceProject>;
  ancillary(records: Omit<WorkspaceRecordCandidates, 'projects'>): Work<Omit<WorkspaceRecords, 'projects'>>;
  dispose(): void;
};
```

The factory creates its own real `createWorkspaceRecordValidator`. `project` validates physical envelopes/values/sizes/lineage, assembles exact membership/order/folds, then runs the real streamed stored-record validator once before checking final contribution/aggregate counters and returning the original assembled project. Metadata must match physical scope/revision; the loader's disposable result never replaces the assembled image. Membership and consumed-import uniqueness remain in the genuine validator. `ancillary` validates the complete workspace order and live presets/imports. Failure poisons this one builder; disposal/finish drops its references. Nothing here grants storage admission.

Project and ancillary operations share one builder-local single-flight guard, including across different runtimes. Every operation checks liveness before/after execution and forwards ordinary exceptions into the real validator so cleanup/cause wrapping remain active. Ancillary accepts exactly three own-data fields, captures them, and returns that same validated envelope—not the original caller envelope or an arbitrary thenable. Nested input remains immutable for the operation as in existing captured-read contracts.

The old codec external-project check is subsumed by the stronger stored-project check only inside this composition. Every physical/counter/fold rule remains. For the private active-read path, in-memory failures continue to block admission through the existing verification boundary; historical/standalone validator interfaces and cause contracts remain unchanged. No partial project/workspace owner may be published before all checks and the original seal complete.

### Files and steps

- `services/localWorkspace/normalized/codec.ts`: factor private assembly and reconstructed-counter checks; add the self-validating factory. Reuse the already-tested removed-fold byte arithmetic when verifying external template contributions: stored payload bytes were independently checked and assembly changes only collapsed fields, so do not rescan unchanged template content again.
- `services/localWorkspace/normalized/repository.ts`: one builder per `activeRead`; reconstruct/validate each current project once before birth/bulk proof verification, retain current editing/index setup, then validate ancillary metadata through that same builder. Dispose on every exit; keep source derivation, captures, proof verification and atomic seals unchanged.
- New `tests/unit/localWorkspace/normalized/workspaceReconstruction.test.ts`: compare with independent old `reconstructProjectWork` plus actual streamed record validation, including extensions/order, folds, duplicate identities/provenance, malformed records/state/metadata, clone/loader/output failures, cancellation and builder lifecycle. Assert no duplicate full-original-image validation, real loader execution, unchanged inputs and zero abandoned custody.
- `tests/unit/localWorkspace/normalized/migration.test.ts`: real active-read regression must still independently validate retained source and reconstructed current state, but must not also pass the current original through the standalone codec payload validator. Add no-publication/corruption checks as needed. Existing boundary registry already permits codec→migration; no new storage capability.

- [x] Write and observe failing composition and actual-read traversal-count tests.
- [x] Implement the self-validating composition and contribution reuse, preserving standalone behavior.
- [x] Wire current reads and verify exact snapshots, current corruption refusal, membership/provenance, cancellation, bulk/Undo/retry and boundary suites.
- [x] Run the unchanged actual saved21MB app scenario, plus small control, build/typecheck and read-only immediate-baseline review. Preserve failures and do not claim success from subphase timings or small fixtures.
- [ ] If opening still fails, use the measured whole-read path to choose the next consolidation. The final atomic all-content seal remains required; no marker-only replacement or extended deadline.

Within the same physical-record validation program, the mandatory canonical inspection already computes exact JSON byte lengths, then the codec immediately traverses each `value`/header `document` again with ordered JSON solely to check encoded sizes. Reuse those private measurements for the exact same immutable field objects; strictly validated JSON has identical byte length regardless of object key order. Retain shallow identity checks, all physical/schema/encoded-size/counter rules and the unchanged synchronous compatibility path. No caller can inject sizes or choose a trusted mode. Permanent regression must prove no second payload-size traversal and continued refusal of false encoded-size metadata.

## Task22 checkpoint — combined reconstruction verified, large opening still blocked

Current source **`31613d7a37519774feb33f01c361922fd2ae044c3cd7ca276b20207c6e6530ab` /1215files**. Six changed paths versus immediate9745d1f… baseline: codec/repository, new reconstruction tests, existing codec/migration tests and this plan; ledger separate. No writer, frame/hash format, Work/transport budget or atomic-seal algorithm change.

### Verified implementation

- Current reads now use one self-validating reconstruction builder. Physical record validation, exact assembly, the real stored-project check with native clone/loader/output validation, contribution/aggregate checks and workspace membership/provenance all remain. The same assembled original no longer passes through a second standalone codec payload validator.
- Independent standalone reconstruction still validates external input; cooperative physical validation reuses only its own exact-field canonical byte measurement. Reconstructed fold contribution uses exact removed-member arithmetic instead of another whole-template scan.
- 25new builder cases plus one encoded-size regression; real active-read regression now checks both retained source and reconstructed current original avoid redundant codec validation. Read-only reviewer `ses_ef4ce32fcffeFhmG6UPcFw8jHq` scoped clear at package03. Ancillary getter/thenable/caller-replacement finding reproduced in three RED cases, then fixed by exact own-data capture and returning the validated envelope. Single-flight guard prevents cross-runtime project/ancillary interleaving.
- **1550PASS/14files** in `task-22-connected-final-01.jsonl`, complete inventory/results/terminal/source/default-limit reconciliation, no skips/retries/errors. Includes957boundary,91stored-validator cases with real32MiB/clone/output-growth,196codec,25new reconstruction,40workspace authority and complete startup/store/page/bulk/fault/size coverage.
- **88PASS/573unselected** from661migration cases in `task-22-migration-final-01.jsonl`: independent phases, current read/source-target counts, archive collisions, source/target races, resumed replay and ownership checks. Not a full migration rerun.
- Build `task-22-current-reconstruction-build-01` passes11.74s/2486modules. Typecheck only known StickerPress793:36TS2339. Earlier22missing-interface RED, duplicate-current-scan RED, size-rescan RED, ancillary RED and one corrected test harness `Invalid work control` failure remain preserved.
- Current small actual-app run `/tmp/opencode/doctect-saved-workspace-control-1791194499369/report.json` passes complete30edit/autosave/switch/Undo/Redo/reload/native failed-save/retry/durable-readback flow, open2626ms, no page/cleanup errors. Current uninstrumented21MB run `/tmp/opencode/doctect-saved-workspace-large-1791191513478/report.json` still **fails120000ms opening**, `actions:[]`.

### Whole-read and final-seal diagnosis

Diagnostic `/tmp/opencode/doctect-saved-workspace-large-1791192178904/report.json` uses current source and retains the original120s failure before passive observation. No editing or acceptance is claimed. Initial instrumentation build1791192058004 failed an overbroad end-marker assertion; scoped transform fixed, failed receipt preserved.

| Reliable stage | Observed duration |
| --- | ---: |
| Initial capture | 9.886s |
| Large source stored checker | 21.670s |
| Source image hashes | 20.143s |
| Large target projection | 8.750s |
| Target logical image weighting | 8.795s |
| First target record interval (bounded) | 40.596s |
| Large current assembly including physical validation | 13.240s |
| Assembled stored-project check | 31.597s |
| Final current contribution checks | 0.119s |
| Final seal starts | 156.560s from worker start |

The earlier~215s pre-seal trace preceded final Task21 metadata/UTF-8 refinements, so this~157s observation must not be attributed solely to Task22 or presented as a controlled speedup. At120s the current run is still checking physical current records. Full startup remains incomplete.

New per-record spans now distinguish the seal bottleneck: the21MB retained archive arrives within an observed≤98.1ms transition/materialization interval, then its synchronous JavaScript canonical comparison takes **17.4602s**, matching21,182,764frame bytes. The transaction next compares438nodes,5variants and1284of1749template rows. All1731completed row comparisons are equal. Worker termination occurs after the unchanged30s no-reply interval while the seal is still processing;465templates plus later stores remain,480physical rows total unstarted. This is cumulative synchronous comparison work, not an idle database wait or one unresolved record request.

Next first-read work must remove repeated JSON serialization from equivalent record comparisons, with exact existing frame/depth/container/byte-accounting oracles, while retaining the same atomic transaction, complete membership and all live-versus-capture checks. Target-record comparison is also a substantial measured interval. No structural comparator or seal change is implemented by this checkpoint. Do not use marker-only CAS, new persisted digests, larger deadlines, background admission or an import benchmark as a substitute for the actual21MB workflow.

Preview remains Task17 build2e098d7… on4322/4323/PID2512304. Protected resources, empty index and whitespace remain required final checks. No installs, commits, deployment, existing-profile access or further cleanup in Task22.

## Task23: Compare canonical content without duplicate text generation

Immediate baseline `task-23-canonical-comparison-baseline` at31613d7…/1215. The measured40.596s target-record interval and17.460s archive seal comparison justify replacing comparison-only serialization, not changing the transaction or required data checks. Continue inline under existing first-read approval.

- Reuse the existing canonical traversal as a typed token producer: ASCII JSON syntax/scalar-field tokens and borrowed raw string tokens. Compare corresponding tokens with bounded string comparison; the same traversal still checks every value, descriptor, prototype, cycle, array membership and depth on equal inputs. Do not cache validation results, construct full JSON strings, or compare unbounded strings in one operation.
- `compareCanonicalWork(expected, actual, emitExpected?)` returns equality plus exact canonical UTF-8 bytes for a completed equal value. If requested, emit the unchanged expected JSON stream through existing≤64-unit quoting/packing for the required hash. Unequal inputs may stop early; rejected/partial comparisons cannot authorize anything. Cancellation closes both producers and releases fixed scratch. Borrowed string views are not new payload copies.
- Add pure normalized frame comparators for complete records, enumerable-field envelopes and the special normalization archive grammar. Preserve labels, per-field external-depth resets, strict record/archive containers, dense archive lists, enumerable-envelope behavior and historical empty-list grammar. Independent old frame producers are the output/byte/equality oracle.
- Wire target comparison so expected bytes still feed the existing SHA once, while actual content is compared without escaping/encoding it into a second JSON stream. Wire the final seal's one-record synchronous comparison to the same equivalent comparator; keep the exact IDB transaction, stores, key/membership checks, source absence guards and source/live content checks. Full successful seal byte counts remain exact; failed prefix counts are marked unmeasured as before.
- Test primitive/Unicode/surrogate/25-unit-number boundaries, differing key order, arbitrary/empty/long keys, nested arrays/aliases, invalid JSON/descriptors/prototypes,512depth, archive field depth resets, altered metadata/payload/membership, exact expected hash bytes, cancellation and zero temporary custody. Then run real repository corruption/race/seal cases, full boundaries, build/typecheck/review and unchanged21MB app workflow. No marker-only CAS, new store/digest, timeout change or import benchmark.

Planned files: `shared/jsonWork.js`/`.d.ts` for token comparison; new `services/localWorkspace/normalized/frameComparison.ts` for existing frame grammars; `normalized/repository.ts` for two comparison call sites; tests alongside and exact boundary registry grant for the new pure module. Existing arbitrary `equalFrameWork` and persisted frame producers remain independent reference paths.

Target hashing already owns exact emitted-byte accounting. Its comparison path uses a separate boolean-returning `emitComparedCanonicalWork`/`emitComparedRecordWork`, avoiding a redundant quoted-byte measurement during the same hash emission. Comparison-only seals retain the exact byte-counting API. Both paths run identical canonical validation and output the same required hash bytes; no size or validity fact is supplied by a caller.

## Task23 checkpoint — atomic seal completes; opening deadline still missed

Current source **`b2b8b9b52765bc666afac34ad148e137aa0ea364240c1ca252fa956e100f10d3` /1218files**. Nine paths against Task23 baseline: four runtime/declaration files, four test files and this plan; ledger separate.

- Canonical comparison reuses the existing checked traversal, compares deterministic literal/raw-string tokens with bounded Work, and does not generate the actual side's escaped JSON text. Equal comparison-only results report exact canonical/frame byte counts. Hashing comparisons emit unchanged expected bytes and let the existing SHA receiver own byte accounting. No payload buffer, validation receipt, trusted flag or persistent cache.
- Record/envelope/archive comparison retains existing labels, per-field depth resets, strict record/archive containers, dense archive lists, enumerable-envelope semantics and historical empty-list syntax. The same atomic transaction, stores, physical keys, membership/absence checks and complete live-versus-capture comparisons remain. The separate workspace-mutation seal still uses its original frame comparator; its required `archiveSealFrame` was retained after typecheck caught the shared use.
- 53new cases:30canonical,21frame,1real repository comparison and1pure-module boundary case. Independent old text/frame/SHA oracles cover equivalence, exact bytes, Unicode/surrogates/numbers, key order, aliases, invalid data, depth512/513, strict containers, cancellation and custody. Old migration spy targeted `recordFrame`; updated it to the actual combined hash/comparison producer without weakening one-traversal assertions. All REDs and the7PASS/1obsolete-spy failure remain retained.
- **1454PASS/11files** in `task-23-connected-final-01.jsonl`, complete inventory/results/source/default-limit reconciliation; no skips/retries/errors. **106PASS/556unselected** from662migration cases in `task-23-migration-final-01.jsonl`, covering source/current corruption, same-marker content and membership races, archive seals, retained reads, replay and cancellation. Not a full migration rerun.
- Read-only review `ses_ef30a1041ffeU6WrpTlmQvUyqa` scoped clear at package02. Additional probes:578comparison pairs,34SHA/byte-parity cases,28invalid values,4strict-container refusals,14cancellation points and consumer/mismatch cleanup. No abandoned custody. Build `task-23-comparison-build-01` passes11.76s/2486modules; typecheck only known StickerPress793:36TS2339.

### Actual-app result

Current small control `/tmp/opencode/doctect-saved-workspace-control-1791222130161/report.json` passes opening2629ms and the full30edit/autosave/switch/Undo/Redo/reload/native failed-save/retry/durable-readback workflow. Current uninstrumented21MB run `/tmp/opencode/doctect-saved-workspace-large-1791222163983/report.json` **still fails120000ms opening**, `actions:[]`; full goal is not accepted. Earlier current-comparison run1791219335956 also remains a failed opening.

Diagnostic `/tmp/opencode/doctect-saved-workspace-large-1791219697986/report.json` at preceding2ad9f0a…/1218 provides a new functional milestone: after the original120s failure, passive observation sees **all2211physical seal rows complete**, the worker returns its editor result at184.350s, and the app pane is later observed visible. The report remains `completed:false`, with no editing actions; this is not a deadline pass or the full large-app workflow. It predates the final hash-only byte-count elimination.

The diagnostic seal completes in22.926s rather than hitting the30s request termination. Archive JS comparison is12.182s versus17.460s in the prior unpaired trace; all1749templates finish in10.308s. Atomic consistency checks were not reduced. Pre-seal time in that trace is160.597s versus156.560s previously, and the target-record interval is42.794s versus40.596s; do not claim target/startup speedup from those numbers. The later hash-only path removes unnecessary measurement but has no complete current-stamp phase timing yet.

The immediate next goal remains reducing total first-read time below120s and then passing editing/reload/retry on that same large app. Startup no longer necessarily dies at the final seal in the observed diagnostic, but remains too slow. Do not widen deadlines, reinterpret background observation as acceptance, or switch to unrelated UI/import work. Preview remains on Task17 build2e098d7… until a verified replacement is ready; no installs, commits, deployment, existing-profile access or cleanup in Task23.

## Task24: One paired comparison walk

Immediate baseline `task-24-first-read-costs-baseline` atb2b8b9…/1218. Current-stamp diagnostic1791237841874 still fails120s; worker returns editor result185.529s only during passive observation. Target-record work remains45.369s, current checker31.276s and seal25.061s. No target speedup is established by the earlier hash-only counting change.

Replace the two canonical-token producer pipelines with one paired traversal. Share the existing container/descriptor validation rules with canonical output rather than introduce a weaker validator. On equal inputs, every type/prototype/descriptor/symbol/density/cycle/depth check still runs on both graphs. Sort expected keys once; exact actual key count plus checked own-property lookup establishes matching membership without sorting actual keys or comparing generated punctuation. Scalars compare by JSON meaning (`-0`/`0` equal), strings by bounded≤64-unit chunks. Required expected hash output and exact comparison-only byte counts remain the original canonical grammar. Invalid or unequal inputs cannot produce successful comparison/admission.

Preserve bounded Work, lifecycle cleanup, no full buffers, per-field512depth resets, record/archive container checks, atomic transactions and all deadlines. Existing canonical text and frame producers stay independent oracles. New regressions must demonstrate eliminated second key sort/actual scalar formatting/syntax comparison, plus hostile keys, unequal membership, nested invalid data, boundary depth, Unicode and cancellation. Run frame/hash/repository race tests and unchanged actual21MB workflow before claiming an improvement. No generic Work-driver/scheduler change or validation cache.

**Investigated, not promoted:** replacing the current reconstructor's per-operation proxy with the existing runtime guard registry. The experiment preserved checks in focused tests, but native157.026s versus155.644s editor-result observations were unpaired and did not establish a material gain. Restore the original codec implementation; retain experiment review/RED/GREEN/profile artifacts and the useful ordinary-failure runtime-reuse regression. Avoid adding another execution path or changing disposal semantics without sufficient benefit. No Work executor/budget change.

## Task24 checkpoint — paired comparison faster, startup still above120s

Current source **`718dd70e5867909348e27d1bbed37a81fce0f2e5a3db184c1cc26542c9a49b78` /1218files**. Four paths against immediate b2b8b9… baseline: one runtime file (`shared/jsonWork.js`), two test files and this plan; ledger separate. Codec and cooperative Work runtime match the baseline byte-for-byte.

- Comparison now walks paired values directly. Shared canonical kind/container/descriptor rules preserve strict equal-input validation. Only expected keys are sorted; exact actual key count and checked own-property lookup verify membership. Numeric/boolean/null values compare directly, strings in≤64-unit chunks. Expected canonical output and measured equal byte totals retain independent existing text/frame/SHA oracles. No transaction, hash format, schema, Work budget or deadline change.
- Two intended RED cases demonstrated duplicate key sorting/syntax comparison and formatting equal numbers twice. Existing comparison/frame/Unicode/invalid/depth/cancellation tests passed after replacement. One useful ordinary-error/runtime-reuse test remains from the rejected guard experiment; its operation-forwarding test and runtime changes were not promoted.
- **1743PASS/13files**, complete current-stamp inventory/results/terminal/default-limit reconciliation in `task-24-connected-final-01.jsonl`, no skips/retries/errors. Includes958boundary,91stored-project validation cases with real32MiB/clone-growth/loader-growth,196codec,26reconstruction,32canonical-comparison and21frame-comparison cases. **106PASS/556unselected** from662migration cases in `task-24-migration-final-01.jsonl`; not a full migration rerun.
- Read-only reviewer `ses_ef1c83d3dffe5RaQCIGa3fZaRc` scoped clear; probes823equality pairs,227byte/SHA cases,198invalid pairs,6depth cases,23cancellation points and8error/mismatch exits. Final review independently confirmed no remaining codec/Work guard experiment. Build `task-24-paired-build-01` passes11.93s/2486modules; typecheck only known StickerPress793:36TS2339.
- Current actual small-app control `/tmp/opencode/doctect-saved-workspace-control-1791244042428/report.json` passes complete30edit/autosave/switch/Undo/Redo/reload/native failed-save/retry/durable-readback flow, open1779ms, no page/cleanup errors. Current uninstrumented21MB `/tmp/opencode/doctect-saved-workspace-large-1791244076099/report.json` still **fails120000ms opening**, `actions:[]`; full goal remains incomplete.

### Diagnostic progress, not acceptance

Baseline current-build diagnostic1791237841874 at b2b8b9… completed worker startup185.529s after its failed120s gate. Paired-only diagnostic1791240446219 at a0b88abe… (same final production runtime; final stamp differs by tests) returns editor157.026s; the app pane is observed visible later during passive observation. Both remain `completed:false` with no editing actions. Measurements are unpaired, not a controlled speedup claim.

| Stage | Baseline diagnostic | Paired-only diagnostic |
| --- | ---: | ---: |
| Target-record interval | 45.369s | 26.274s |
| Atomic seal | 25.061s | 10.934s |
| Archive comparison | 13.054s | 5.093s |
| All template comparisons | 11.473s | 5.498s |
| Source checker | 21.671s | 22.891s |
| Source hashing | 18.962s | 20.730s |
| Current assembly | 13.111s | 13.575s |
| Current stored checker | 31.276s | 32.359s |

Comparison improvements align with the changed path. Ordinary source/current inspection was modestly slower in this sample; causation by factored helpers is not established. The rejected reconstructor-guard profile1791241628230 at f4de21d8… returned editor155.644s, insufficient evidence to retain that additional path. All experiment source packages and receipts remain preserved.

Next work still targets total first-read latency and the complete large editing/reload/retry workflow. Approximately157s worker-startup diagnostic is not a120s pass. Preserve all integrity and lifecycle checks; do not compensate with longer deadlines or new validation caches. Preview remains Task17 build2e098d7… on4322/4323/PID2512304; no installs, commits, deployment, existing-profile access or cleanup in Task24.

## Task25: Measure JSON directly on the first-read validation paths

Immediate baseline `task-25-first-read-consolidation-baseline` at718dd70e…/1218. Nested Task24 spans place55.250s in the two large stored-project checks:17.492s original inspections,14.687s cloned-source checks,18.007s loader-output inspections,4.714s loader gaps and0.348s clone gaps. Loader-only changes cannot recover the roughly37s opening deficit. The measurement paths still use serialization-oriented scalar-field construction even though they need only JSON byte counts and depth.

- [x] Add RED work/visit regressions to `tests/unit/localWorkspace/normalized/jsonScalarFields.test.ts` for count-only canonical/ordered scalar fields, including strings too long or escaped for the output-token fast path. Compare exact sizes with native JSON and independent canonical text. Keep output-fragment tests unchanged.
- [x] In `shared/jsonWork.js`, let the existing traversals use a private count-only field writer. Count bounded keys/scalars directly without building a combined field string. Share the existing quoted UTF-8 rules, descriptor/container/type validation, key order and depth accounting; preserve fallback for larger fields. No public trusted flag, size input, payload cache or new executor path. All per-operation work remains at most1024visits/64KiB.
- [x] Test Unicode/surrogate/escape/numeric bounds, conversion versus strict rejection, hostile descriptors, error order, cancellation and cleanup. Keep raw/native-clone/loader-output validation independent.
- [x] Run affected stored-project/codec/comparison/Work/boundary and selected repository race suites, read-only immediate-baseline review, build/typecheck and the unchanged native21MB workflow. Use actual native results to select any further first-read consolidation; do not treat a work-count reduction as acceptance.
- [x] Reconcile evidence and update this plan/ledger. Keep the preview and protected resources unchanged; no staging, commits, installations or destructive operations.

The first direct-field change passes638focused cases but diagnostic1791252629478 still misses120s and returns the worker result154.972s. Stored checks total52.036s versus55.358s previously; unpaired observations do not establish a causal gain. Continue the count-only producer consolidation: capture at most16consecutive scalar descriptors in existing key order under a bounded metadata operation, then measure their combined at-most250UTF16units/1008visits in one operation. Invalid descriptors, non-scalars and longer fields return to the unchanged traversal at the exact field; retain a fetched descriptor rather than reading it twice. Fixed charged scratch, no value cache across blocks/traversals, no generic operation executor/budget change. Separate count-only RED assertions must demonstrate the removed per-field dispatch. Output serialization remains untouched.

Batched JSON diagnostic1791253744462 still fails120s but returns the worker result127.866s, versus154.972s in the preceding unpaired run. Read-only review `ses_ef0f4f5e4ffe4fxMbry77dbzRX` found no scoped issues, with independent byte/output/error/cancellation probes. Continue on the measured capture/target-weight costs, not another subsystem: apply bounded scalar-field measurement blocks to `rawValueWeightWork`, preserving exact eight-byte-per-occurrence, identity deduplication, UTF-8, accessor/opaque and binary/container rules. Non-scalars and oversized fields retain the original traversal. New `rawValueWeight.test.ts` must compare independent logical-weight oracles, aliases/cycles, Map/Set/binary/custom objects, Unicode boundaries and cancellation, plus an intended per-field-dispatch RED. No supplied size, cached payload, changed ownership policy or generic Work change.

## Task25 checkpoint — real large opening/editing/reload pass; retry remains blocked

Current source **`c04963d270a2d98a7a54d207651c10892624b7aa41156cbe432e71d553c49258` /1219files**. Four changed paths against Task25 baseline: `shared/jsonWork.js`, existing scalar-field tests, new raw-weight tests and this plan; ledger separate. Codec, repository, coordinator, store/session retry code and cooperative Work runtime remain byte-identical to the baseline.

### Implementation and verification

- Count-only canonical/ordered JSON now measures scalar fields without constructing output tokens. Bounded scalar blocks capture at most16descriptors, retain at most one fallback descriptor, and measure at most1008visits before byte accounting. Raw weighting applies the same narrow grouping to scalar occurrences, preserving exact logical weights, object identity deduplication and opaque-value accounting. Each traversal owns2048logical scratch bytes, registered before its post-operation guard and released on every exit. No across-block payload cache, new size authority, output/frame change or generic executor change.
- **37new permanent cases:**17JSON measurement cases and20raw-weight cases. Intended field/block/ownership REDs retained. Initial `task-25-measurement-red-01.jsonl` also contains an erroneous nonexistent event-field assertion and a predecessor rather than current test stamp; it is not valid current-stamp evidence. Corrected RED02 has the intended two dispatch failures. `task-25-raw-weight-green-01.jsonl` is explicitly incomplete: outer120s command cutoff after271passes, no terminal event. No unit/hook deadline was changed; final verification ran with sufficient outer command time.
- **1847PASS/17files** in `task-25-connected-final-01.jsonl`, complete inventory/result/terminal reconciliation, original5000/10000ms defaults, one fork worker, no retries/skips/errors. Includes real32MiB/clone/output-growth checks,958boundary cases,196codec, current startup/editor/store/authority, Work, canonical/frame/source digests and scope/reconstruction coverage.
- **114PASS/548unselected** from662migration cases in `task-25-migration-final-01.jsonl`: preceding106source/target/seal/race/replay cases plus8prerequisite raw-weight/cancellation cases. Not a full migration rerun. `task-25-verification-01.json` reconciles current stamps, selected names, results, incomplete evidence, protected hashes and empty index.
- Read-only reviewer `ses_ef0f4f5e4ffe4fxMbry77dbzRX` scoped clear for review02/03. JSON probes:1579byte cases,381output comparisons,260hostile/error/descriptor cases,13depth/context and722cancellation points. Raw probes:650oracle cases,60descriptor cases,78cancellation points and12injected failures. Exact1008visit raw blocks and2972byte maximum observed charge; zero abandoned ownership. Preset cavecrew reviewer was unavailable (`haiku/` model not found); general read-only reviewer performed the review instead.
- Build `task-25-measurement-build-01` passes11.52s/2486modules. Typecheck only known StickerPress793:36TS2339. No new dependency, storage-boundary grant, schema change, deadline increase or cleanup.

### Actual native workflow

Current uninstrumented `/tmp/opencode/doctect-saved-workspace-large-1791254529403/report.json` opens the actual21,152,284-byte AppState in **117011ms**, inside the unchanged120000ms gate. It completes30typing edits/autosaves, switches projects, verifies Undo/Redo, reloads within the same opening deadline and observes the latest saved text (`reloadVerified:true`). A native `projectTemplates.put` AbortError then preserves the new working text while independent durable readback still shows the preceding saved text.

**The complete goal is still not accepted:** clicking Retry starts another full `editor` startup operation. The unchanged saved-status assertion expires before it completes; `completed:false`, `phase:'failed-save-retry'`. The actual Playwright assertion deadline is **5000ms**, not30000ms: `page.setDefaultTimeout(30000)` does not override `expect`'s default. The RPC deadline remains30000ms. Neither timeout nor the runner was changed. Post-retry durability and Undo/Redo have not been verified on the large default-app run. No page errors or cleanup errors; no repeated unchanged run seeking a pass. One near-boundary opening observation is not a robust startup-latency guarantee.

Current small control `/tmp/opencode/doctect-saved-workspace-control-1791255758255/report.json` passes the complete30edit/switch/UndoRedo/reload/native-failure/retry/durable-readback workflow, opening1729ms. It does not close the large retry gap. Earlier154.972s and127.866s diagnostics retain their original120s failures before passive observation; comparisons are unpaired, not controlled causal speedup claims.

### Next blocker: retry admission, not opening or navigation

Read-only trace `ses_ef0e3d0f1ffeoZhzQRAsYijoNq` confirms:

1. `repository.ts:2194-2235` rejects an in-transaction put fault after IDB abort settlement. `commit()` at2597-2625 retains the attempt with `aborted:true` when no durable commit occurred. Inspection can prove not-committed only with retained authentic attempt evidence and unchanged relevant authority/window.
2. `coordinator.ts:215-217` currently invalidates every failed mutation's project admission and returns `outcome:'unknown'`. This is conservative existing policy, not permission to infer rollback from an arbitrary AbortError.
3. `workspaceEditingSession.ts:178` forwards retry to `NormalizedWorkspaceStore.ts:46-47`; `initialize(true)` pauses/quiesces, creates a fresh worker and performs full normalization/editor re-admission. Existing queue/lifecycle recovery requires new genuine admissions and preserves working state/history.

No retry policy changed in Task25. Do not merely retain/revive an invalidated token, treat timeout/termination as rollback, skip the independent full-admission checks, lengthen the assertion, or claim the eventual background read as a pass. The next implementation needs a narrowly specified, proof-backed recovery path consistent with authority/fence obligations, with RED tests for confirmed rollback versus unknown/committed/conflicting outcomes. Remaining full-flow gate is large native retry completion and durable readback; preserve this failing receipt.

Preview remains verified Task17 build2e098d7… on4322/4323/PID2512304, health HTTP200. Protected sibling hashes and SQLite presence checked; test ports4320/4321 released, index empty and whitespace clean. No installs, staging, commits, deployment, existing-profile access or destructive filesystem operations.

## Task26 — complete saved-workspace goal verified

User approved the narrow confirmed-rollback retry amendment after explanation; implementation/spec and full evidence are in `2026-10-05-confirmed-rollback-retry.md` and its companion design. Same live worker must hold authentic native-abort evidence and unchanged exact authority/metadata; old public bindings stay invalid. Unknown outcomes and independent opening/reload still use full admission. No Work, frame, RPC or assertion deadline changed.

Current **cb3eb92553f2244454afc9b95c1269e5df8fda25891fa4a6c6b7d03ee76f94d1/1221** uninstrumented `/tmp/opencode/doctect-saved-workspace-large-1791270465663/report.json` passes the entire actual21MB `/app` workflow: opening110950ms,30edits/autosaves, switching, Undo/Redo, reload, injected native save failure, explicit retry and independent durable readback (`completed/reloadVerified/retryVerified:true`). Retry has no whole-workspace reopen: continuation107.4ms; first inspection through verified save reply317.9ms. Typing action-to-frame p95114.7/max116.4ms in this run. These measurements are not a guarantee across machines or a controlled causal benchmark.

Final1820PASS/19affected files, clear read-only review, build11.91sPASS and only known StickerPress typecheck error. Small control1791270812004 also completes. Full migration/repository suites and unrelated release/import/browser gates are not claimed complete. Earlier failed page-unavailable run and quota-blocked diagnostic remain recorded; user-approved deletion of805MiB byte-identical copied assets preserved all evidence/data/code. Preview and branch/worktree remain unchanged/uncommitted. This closes the saved-workspace goal, not a deployment or migration of an existing user profile.
