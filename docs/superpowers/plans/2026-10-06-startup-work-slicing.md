# Startup Work Slicing Implementation Plan

> **For agentic workers:** Execute inline with executing-plans and TDD. User approved this work-budget amendment. Read-only review allowed; no implementation handoff, staging or commits.

**Goal:** Remove excessive startup task handoffs while preserving all validation, hashes, cancellation and storage integrity; prove the gain on the actual21MB workflow.

**Architecture:** One shared executor with two explicit factories. Default quantum stays unchanged. A purpose-named startup runtime uses a4ms target,64KiB byte ceiling and65536visit fallback. Only the coupled editor read owns that runtime; write/replacement sessions never inherit it.

**Tech Stack:** Existing JS Work runtime, TypeScript startup owner, Vitest, isolated browser-worker benchmarks and actual `/app` runner. No new dependencies.

**Status:** Runtime candidate and fixed pipeline gate completed. The gate failed: no matched pair reached2×. Task3 integration and candidate-dependent Task4 app qualification are cancelled, not pending permission to promote. Only the candidate's own runtime/declaration changes were reversed; its new tests were moved intact to an external artifact. Current app source is restored byte-for-byte tocb3eb925…/1221.

## Constraints

Follow `../specs/2026-10-06-startup-work-slicing-design.md`. Immediate baseline `task-28-startup-slicing-baseline`, sourcecb3eb925…/1221, HEAD8a2872d, branch `feat/incremental-local-persistence`. Preserve dirty predecessor, empty index, every failed receipt and existing preview. The missing historical temporary SQLite remains an explicit unresolved exception, not something to restore silently.

## Task1 — Runtime policy with existing execution semantics

Files: `shared/cooperativeWork.js`, `.d.ts`; new `tests/unit/localWorkspace/normalized/startupWork.test.ts`.

Interface:
```ts
export interface StartupWorkControl extends WorkControl { now?(): number }
export function createStartupWorkRuntime(control: StartupWorkControl): WorkRuntime;
```

- [x] Write REDs for factory existence, default quantum compatibility, time/byte/hard-visit boundaries, native-operation expiry and consecutive runs.
- [x] Factor only runtime construction. Keep `operationFields`, receiver behavior, generator advancement, all existing guard positions, cleanup and metrics. Add private clock validation and startup slice state without touching the default path's observable contract.
- [x] Test clock failure/lifecycle precedence, stale/frozen clocks, per-operation refusal, read-only phase restriction, cancellation and zero residual ownership. Run complete existing Work tests.

## Task2 — Fixed real-pipeline performance gate

Files: external Task28 tools/results under `/tmp/opencode/doctect-incremental-sdd/`; original Task27 tools/receipts stay frozen.

- [x] Reuse frozen corpus and Node/browser digest oracles. Build baseline with Task28's captured old runtime; build candidate with `createStartupWorkRuntime`. Keep real JS SHA and all producers identical. No WASM/elision implementation in this comparison.
- [x] Run one small correctness/control pass, then fixed A/B/B/A per source/target pipeline, serial and in fresh contexts. Preserve each complete/failed/unattempted trial; bind source/tool/input provenance.
- [x] Evaluate identical valid digests/logical work and the at-least2× requirement in every matched pair. Correctness and counter parity passed; **performance requirement failed**. Record initialization, slice/cancellation observations separately from performance samples.

## Task3 — Startup-only integration

**Cancelled after gate failure. Do not wire the archived candidate.**

Files: `services/localWorkspace/normalized/startup.ts`; new or existing startup tests; exact usage checks in `tests/unit/localWorkspaceBoundary.test.ts`.

- [ ] Observe a RED showing `editor` still takes the default quantum while non-editor operations must keep it.
- [ ] Factor owner-local Work creation so each runtime's progress closure reads its own counters. Create/dispose the startup runtime only around `openEditor`; stop/close must also revoke it and wake paused progress.
- [ ] Verify error, cancellation, disposal and successive operation behavior. Keep source/current validation, final seals, write operations, replacement and request deadlines unchanged.

## Task4 — Qualification

**Candidate integration/native qualification cancelled.** Restoration verification and evidence reconciliation were performed instead, below.

- [ ] Obtain read-only immediate-baseline review; reproduce/fix findings with tests.
- [ ] Run affected runtime/JSON/validation/codec/source/reconstruction/migration selections/worker/startup/authority/editor/retry/boundary suites using original limits and stamped receipts. Distinguish selections from full suites.
- [ ] Run `npx tsc --noEmit --pretty false`, `git diff --check`, and `TMPDIR=/tmp/opencode npm run build --legacy-peer-deps -- --outDir /tmp/opencode/doctect-incremental-sdd/task-28-startup-slicing-build-01`. Preserve known StickerPress793:36TS2339 separately.
- [ ] Run the unchanged saved-workspace browser runner and small control. Require actual opening speedup plus editing/switch/UndoRedo/reload/native failed-save retry/durable readback. No background completion or longer timeout substitutes.
- [ ] Reconcile source/test/benchmark/native receipts, protected resources and preview. Update this plan/spec/ledger, record the unresolved historical SQLite exception, and leave branch/worktree uncommitted.

## Task28 result — meaningful partial gain, below the agreed gate

Fixed campaign: `/tmp/opencode/doctect-incremental-sdd/task-28-slice-benchmark-1791347204538/report.json`, `valid:true`, `earnedIntegration:false`. All8individual trial receipts match report/context records, Task27 fixture goldens and logical counters. Only `checks` and `yields` intentionally differ; the other42counters agree and ownership finishes at zero.

| Pipeline | Baseline mean | Candidate mean | Matched speedups |
| --- | ---: | ---: | --- |
| Source hashing | 16.94585s | 11.84405s | 1.46088×,1.39984× |
| Target comparison/hash | 17.77660s | 14.30930s | 1.22726×,1.25818× |

Summed stage means improve34.72245→26.15335s: **8.5691s /24.68% less time**, or1.32765× speedup. Mean combined cooperative handoffs fall986498→13486, **98.63% fewer**. This shows yielding has a material cost, but removing most task handoffs does not remove most pipeline time. The residual does not identify exact traversal, formatting, allocation, generator or guard costs separately.

No pair reached2×. The threshold was not lowered after seeing results, and no candidate `/app` run or startup wiring was performed. There is **no measured improvement to the live application's111s opening** from this task.

### Safety and responsiveness

- Initial RED:29missing-factory failures and1unchanged-default pass. Candidate final `task-28-runtime-green-02.jsonl`: **363PASS/3files** (34candidate cases,264existing Work,65canonical), original test/hook limits unchanged.
- Read-only review `ses_eeb997811ffeChlSZTSpPjot7I` found a missing immediate post-native clock check. Four permanent REDs covered terminal success, native exception, producer continuation and callback erasing its native tag. Capturing the tag before invocation and checking time in `finally` before producer resumption fixed them. The original RED and all intermediate artifacts remain.
- Reviewer independently matched47ordinary-runtime traces against baseline. Final code/gate/restoration reviews clear; no implementation edits delegated.
- Separate full-size diagnostics measured yield-ended slice maxima4.8ms(source)/5.3ms(target), max65536logical visits and bytes below64KiB. **Terminal tails are not included**; these are observations, not hard real-time guarantees for native operations/GC/host scheduling.
- Requested25ms cancellation timers fired at27.7ms/32.8ms; cancellation cleanup completed0.3ms/0.4ms after delivery. Both ended with zero owned bytes. A separate source cancellation sample observed a5.0ms yield-ended slice.

### Restoration and retained evidence

- `task-28-rejected-candidate-01.md` and its full before/after files preserve the final implementation, declarations and tests. Candidate benchmark bundles/source maps are also retained. `task-28-startupWork.candidate.test.ts.txt` is byte-identical to the candidate test file, moved outside the active suite rather than discarded.
- `shared/cooperativeWork.js`, `.d.ts` and startup owner match the immediate Task28 baseline byte-for-byte. Restored runtime/test/config fingerprint is **cb3eb92553f2244454afc9b95c1269e5df8fda25891fa4a6c6b7d03ee76f94d1/1221**. Benchmark replay must use the archived candidate overlay, not assume the restored tree still exports its factory.
- Restored `task-28-restored-regression-01.jsonl`: **351PASS/3files** (Work264/canonical65/startup22), complete/default-limit/current-stamp results. Typecheck remains only known StickerPress793:36TS2339. Benchmark worker builds compiled; a new full app build/native qualification was not run after rejection because app bytes are unchanged.
- `task-28-verification-01.json` reconciles the failed performance gate, preserved candidate and restored source. The branch/index remain uncommitted/empty; preview remains the prior verified build. No installs, data cleanup, migrations or deployment.
- Historical `/tmp/opencode/doctect-local-preview-20260919/api.sqlite` was already absent before this task and remains an unresolved preservation exception. No replacement, access to existing profiles, or cleanup was attempted.

### Next architectural question

Do not spend another iteration merely increasing the yield ceiling: the candidate already removed98.6%of handoffs. Any next implementation should address the amount of per-operation traversal/formatting work itself—for example a purpose-owned bounded processor that shares compatible validation/measurement/byte-production work—while preserving current checks and exact frames. That is a deeper producer/interface change, not a claimed result of this scheduling experiment. The archived partial improvement may be reconsidered only with an explicit change to the acceptance decision; it is not silently shipped.
