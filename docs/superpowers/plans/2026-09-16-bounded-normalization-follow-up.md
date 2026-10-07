# Blocking normalization follow-up — Task 11b

## Authorized allocation

On 2026-09-16, after cumulative Task 11 review02 identified the still-unmet bounded-preparation requirement, the user selected **“Separate blocking follow-up (Recommended)”**. This explicitly allocates review finding M1 to Task 11b rather than waiving it or treating bounded payload writes as complete bounded-work compliance.

Task 11 may be accepted only as a **private, unwired correctness checkpoint**, after all blocking integrity/compatibility findings pass independent review. Its acceptance must not claim bounded preparation, bounded whole-operation memory, measured cancellation responsiveness, migration performance readiness, or production readiness.

Execute Task 11b next after Task 11 correctness acceptance, before proceeding to live integration in Tasks 12/13. The original 15-task plan remains otherwise intact. Production database default remains version2 until the existing Task13 gate; no existing browser profile migration is authorized.

## Problem and retained evidence

Current normalization repeatedly captures, reconstructs and hashes the full source/target during staging and again per project during verification. Approximate repeated work is O((B + P) × W), for B batches, P projects, and workspace size W. Multiple full source/target/frame representations can coexist. The64-record/256KiB stage-write budget does not bound preparation, full CAS reads/framing, memory, or intervals between lifecycle/progress callbacks. One legal larger record must remain supported.

Review evidence: `/tmp/opencode/doctect-incremental-sdd/task-11-review-02.md`, M1 and acceptance obligations. Correctness fixture around32MiB takes roughly four minutes including preparation/export/refusal; it is not an isolated native migration benchmark or a heap measurement.

## Mandatory Task 11b deliverables

- Define preparation and verification work units and explicit lifecycle/progress opportunities. Resolve actual code seams and approve any needed contract changes before implementation; this document records allocation and acceptance gates, not a preapproved replacement storage design.
- Consolidate repeated derivation within each captured validation pass. Remove or explicitly bound/justify redundant full-workspace scans across projects and batches. Avoid retaining unnecessary duplicate complete representations.
- Preserve independent durable target rereads and reconstruction, exact source/target identity, immutable archive, source-revision/incarnation/ancillary CAS, atomic verified cutover, final reopen, and valid edited-authority admission. A writer cache is not an independent verification oracle.
- Preserve all historical, source/target mutation, quota/clone/termination, lost-ack, current-proof, fold-integrity, size/depth, and compatibility tests. Do not lower existing limits, remove the legal single-large-record exception, change external formats, or grant a second normalized writer.
- Add deterministic work/read/hash counters for multiple projects and batches, including continuous lifecycle/progress checks during preparation and verification rather than only after durable stage writes. Keep diagnostics free of document content and identifiers.
- Verify cancellation/source/epoch loss during each long phase leaves a resumable durable attempt or typed recovery, never false readiness, stale acknowledgement, rollback assumption, or retained-copy proliferation.
- Run targeted tests first, all affected regressions, typecheck with baseline failures explicitly classified, and build. Require independent spec/quality review against a fresh Task11b dirty baseline. No automatic commit or cleanup.

## Live integration and rollout gates

Tasks12/13 must review the actual legacy-capture bridge, correlated progress, cancellation, owner/source invalidation, and migration-specific timeout behavior together with Task11b's work-unit design. Simply extending or retaining the ordinary30-second request deadline does not satisfy this requirement. No production/editor mounting while authority is uncertain.

Before rollout and final acceptance, measure preparation, staging, verification, activation/reopen, and recovery separately in fresh isolated browser contexts on alternate ports. Include peak heap/RSS, cancellation responsiveness, a legal maximum-size single record, and multi-project/multi-batch workspaces. Native worker/browser crash/quota/versionchange and acknowledgement-loss evidence remains required by Tasks14/15; fake-IDB timings are not substitutes.

## Completion rule

M1 stays open until these deterministic bounded-work/progress/lifecycle requirements pass Task11b review. Native phase/heap/performance and transport integration obligations remain separately tracked until their owning gates pass. Neither a later DONE label nor Task11's correctness tests may implicitly close them.
