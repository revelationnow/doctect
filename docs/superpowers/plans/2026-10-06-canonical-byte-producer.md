# Canonical Byte Producer Implementation Plan

> Execute inline with TDD and read-only review. User requested producer consolidation; no implementation handoff, commits or staging.

**Goal:** Reduce per-field/fragment processing in the real21MB startup path, then verify actual app latency and durability behavior.

**Architecture:** A purpose-owned bounded byte processor reuses existing JSON validation/order rules, fuses comparison with expected-byte generation, and feeds actual bytes directly into existing digest fan-out. Legacy text producers remain available as oracles/fallbacks. Work executor, SHA algorithm and storage checks stay unchanged.

## Constraints and baseline

Follow `../specs/2026-10-06-canonical-byte-producer-design.md`. Baseline `task-29-bounded-producer-baseline`, sourcecb3eb925…/1221, HEAD8a2872d. Original1024visit/64KiB quanta,192byte SHA updates, text fragment64UTF16 limits, data/storage/timeout rules remain. Preserve old scheduling candidate as rejected and the historical SQLite absence as unresolved.

## Task1: Evidence and byte interface

- [x] Capture current source/target CPU profiles with the original runtime and verified fixture digests. Profile1791350767100 is diagnostic-only; first profile launcher1791350723576 failed before browser work because an unused startup bundle route remained, and is retained.
- [x] Add `JsonByteEmit` and `utf8JsonOutput(text, bytes)` declarations/tests. Add REDs for byte delivery and actual dispatch reduction; use current text/canonical/native digest oracles.
- [x] Implement the bounded iterative single/paired processor in `shared/jsonWork.js`, reusing its private JSON rules and order cache. Explicitly account scratch, metadata/reflection, character reads/writes and actual emitted bytes. Keep larger payloads streamed.
- [x] Exhaustively cover Unicode, numeric boundaries, nesting, invalid inputs, mutation/cancellation boundaries, consumer errors and borrow lifetime. Do not weaken text APIs or use reported sizes as trust.

## Task2: Hash integration

Files: `services/localWorkspace/canonical.ts`, `shared/jsonWork.js/.d.ts`, tests under `tests/unit/localWorkspace/normalized/` and existing canonical/source/frame tests.

- [x] Wire genuine digest outputs through `utf8JsonOutput`; factor private encoded-byte fan-out while retaining scope/runtime/state checks and existing SHA work accounting.
- [x] Route canonical output and hash-only paired comparison through the new processor only for associated outputs. Other callbacks continue through old text implementations.
- [x] Compare full source/target digests and record grammars with independent fixture goldens. Verify no intermediate text encoder/packer chain on the new path and no usable digest on mismatch/failure.

## Task3: Measured qualification

- [x] Use fixed A/B/B/A source and target comparisons against the Task29 snapshot. Record producer operation counts, work/bytes/custody and all failed samples. Do not infer app timing from these isolated stages.
- [x] If producer performance warrants integration, run unchanged actual21MB `/app` and control workflows, including reload and native failed-save retry with durable readback. Preserve every deadline and failed receipt.
- [x] Run affected Work/JSON/canonical/codec/stored validation/source/target/reconstruction/migration selections/startup/editor/authority/boundary suites, build/typecheck and read-only diff review. No full-suite claim from selected tests.
- [x] Reconcile scope/stamps/receipts, update plan/ledger and verify current preview/protected sibling hashes/empty index. Retain the preexisting missing-SQLite exception separately.

## First candidate checkpoint

Fixed campaign `task-29-byte-benchmark-1791356800550` is valid but fails the predeclared stage gate. Source pairs2.15876x/2.32405x (mean16.91595→7.55620s); target1.99136x/1.89096x (18.07585→9.31215s). No actual-app trial or startup-speedup claim. Full digests and hash byte counts match; all diagnostics include terminal quanta, remain≤1024visits/64KiB and release ownership. Original runtime and SHA unchanged. Candidate archived as `task-29-byte-candidate-v1`.

Next bounded refinement: paired encoding currently dispatches `note('comparedCodeUnits', 2)` for each character (about12million calls in the target stage). Aggregate those metric writes within the existing producer operation, flushing before subsequent input reflection and in `finally`. Preserve exact counts, including unequal/error prefixes, every processing reservation, bytes, guards and scheduling policy. Test actual call reduction and counter visibility before running a separate fixed campaign; do not repeat the unchanged candidate or relax the gate.

## Final qualification — 2026-10-07

Current source is `3e31cdb110f7b5be5b1584ec4b93a59ab8506049ec76b489e1abc0ab659d8896` /1222files. Task29 changes three runtime/declaration files, one95-case test file, this plan and its design. The controller ledger is separate. Work executor, SHA implementation, codec, repository, startup authority, storage formats and all deadlines remain unchanged.

### Corrections and retained failures

- Read-only review reproduced cancellation between two array-length reads and a counting test wrapper that failed to forward operation errors. Both fixed with RED/GREEN cases. Reflection is now guarded for both reads, preserving synchronous behavior and read order.
- Metric batching removes actual recorder calls without discounting work:4096→22 calls for8192comparison units;2049→11 for4098units on mismatch. Review checked120small differential cases against archived v1, including counters/guard visibility/errors/cancellation.
- Benchmark review fixed incomplete snapshot dependency resolution, omitted terminal diagnostic quanta and missing early/interrupted receipts before timing. Snapshot fallback uses the recorded immutable git object, never current files. Nine external helper tests pass.
- The second campaign1791358112411 passed its stage gate, and pre-brand-fix native runs1791358331364/1791358561522 passed (85.088s/1.609s opening). These are not the final source stamp.
- Broader `task-29-connected-final-01.jsonl` exposed47jsdom editor bootstrap failures and was interrupted by the600s outer shell allowance without a terminal receipt. A host Node TextEncoder returns another realm's Uint8Array; the new `instanceof` check wrongly rejected it. Native brand and attachment checks now accept cross-realm packets while rejecting DataView, other array kinds, proxies/impostors, spoofed tags, detached buffers and oversized packets. Three targeted REDs and all earlier artifacts remain. No test deadline changed; the final disjoint regression run received a larger outer process allowance only.

### Final fixed producer campaign

`/tmp/opencode/doctect-incremental-sdd/task-29-byte-benchmark-1791360897629/report.json` is valid, with8uninstrumented ABBA measurements and8separate diagnostics. All four pairs exceed the unchanged2x stage threshold:

| Stage | Baseline mean | Candidate mean | Paired speedups |
| --- | ---: | ---: | --- |
| Source | 17.1108s | 7.8552s | 2.17418x / 2.18240x |
| Target | 18.2527s | 7.6437s | 2.38625x / 2.38962x |

Actual operation counts fall from8,077,977→1,023,336(source) and10,607,283→2,857,273(target). These counts come from separate diagnostic bundles, not timing instrumentation. Complete digests and actual hash bytes match independent goldens. Final candidate counters match v1 exactly despite metric-call batching and the realm correction. Source yields increase535546→574416; target yields decrease450952→370682. This is producer-work removal, not a scheduler promotion.

Diagnostics include terminal tails, stay≤1024visits/510emitted bytes per observed quantum, and release all ownership. Candidate logical scratch high-water is85,901Bsource/79,076Btarget; this is not a measured native-heap bound. Requested25ms cancellation timers arrive25.1/25.2ms, followed by0.3ms cleanup. No claimed hard wall-clock slice bound.

### Actual saved workspace and verification

- Final large `/tmp/opencode/doctect-saved-workspace-large-1791361080655/report.json`: normal `/app`, genuine admission,21,152,284BAppState, **86,797ms opening**,30edits/autosaves, switching, Undo/Redo, reload, native failed save, explicit retry and independent durable readback all pass. Initial worker editor interval85,111.9ms; reload81,185.7ms; rollback continuation105.5ms without full reopening. No page or cleanup errors.
- Final control `/tmp/opencode/doctect-saved-workspace-control-1791361314051/report.json`: **1700ms opening**, same full flow passes; continuation96.1ms.
- Compared with the prior qualified110,950ms opening, the final observed opening is24,153ms/21.77%lower. This is a historical comparison, not a paired end-to-end benchmark. Cold opening remains slow; no claim that all performance work is finished.
- **2725PASS/32affected files**, disjoint current-stamp receipts `task-29-byte-realm-green-01.jsonl`(484/5) and `task-29-connected-final-02.jsonl`(2241/27). **114selected migration PASS/548unselected** of662. Original5000ms tests/10000ms hooks, named exceptions, one worker and zero retries retained. No full-project/full-migration-suite claim.
- Source-stamped production build `task-29-byte-producer-build-02` passes,11.55s/2486modules. Typecheck exits2 with only the unrelated `tests/unit/gallerySamples/stickerPress.test.ts(793,36)` TS2339 error. `task-29-build-types-01.json` retains exact commands/status/stdout/stderr and matching before/after stamps; its controller initially expected the wrong typecheck exit1. `task-29-build-types-02.json` reconciles those same raw results with the correct exit2, explicitly without rerunning or rewriting them. Earlier build01 also passed. Read-only reviewer `ses_eeb02a3c3ffeNM1uBZZcXNSix4` cleared implementation and runtime corrections; the final review requested this durable build/typecheck evidence instead of inferring success from an output directory.
- `task-29-verification-03.json` reconciles source/bundle/tool/test/native/build/typecheck evidence, unchanged critical modules, protected sibling hashes and empty index. Preview remains the old Task17build at4322/4323, PID2512304, HTTP200; test ports4320/4321 released. Historical `/tmp/opencode/doctect-local-preview-20260919/api.sqlite` remains absent with unknown cause; `preservationAuditPassed:false` stays explicit. No cleanup, install, commit, staging, deployment or existing-profile access.
