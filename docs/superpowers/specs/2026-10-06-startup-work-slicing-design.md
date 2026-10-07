# Startup Work Slicing

**Result:** Candidate implemented and safety-tested, then rejected at the predefined performance gate. Production/runtime/tests restored to the immediate baseline. Candidate source, tests, builds and measurements remain external; this document records a tested but unpromoted design, not current production behavior.

## Goal and authorization

The user approved a startup-only work-budget amendment after Task27 showed that faster SHA alone saves little pipeline time. Implement a focused scheduling change, not a different validator, storage format or integrity policy. First require at least2× improvement in the actual source-hash and target-comparison pipelines, then measure the normal21MB opening/edit/reload/retry workflow. No timeout increase or WASM dependency.

Starting source cb3eb925…/1221; immediate snapshot `task-28-startup-slicing-baseline`. Existing111s saved-workspace acceptance remains evidence for the predecessor, not the new candidate.

## Scoped interface

Add `createStartupWorkRuntime(control: StartupWorkControl): WorkRuntime` beside the unchanged public `createWorkRuntime`. Both use the same private executor, operation validation, counters, guard ordering, error routing, ownership and scheduler. `StartupWorkControl` adds only an optional monotonic `now(): number` for deterministic testing; production uses `performance.now`. Callers cannot choose arbitrary slice limits.

The ordinary factory retains1024visits/64KiB per quantum. The startup factory uses:

- **4ms elapsed slice target**, checked before operations at no more than1024additional logical visits between clock samples, and before/after tagged native operations.
- **64KiB emitted-byte ceiling**, unchanged.
- **65536logical-visit hard ceiling**, so a frozen/coarse clock cannot prevent yielding indefinitely.
- Individual operations remain at most1024visits/64KiB. JSON fragments remain64UTF16/max192UTF8; SHA updates remain192bytes/max600visits.

The time target is not a universal hard wall-clock guarantee: one bounded operation/probe interval, a permitted native primitive, garbage collection or host scheduling can overshoot. The policy must not describe native clone/key enumeration/atomic record seals as preemptible work. Slice state survives successive `run()` calls, and time restarts only after an actual task yield. Work counters remain honest; fewer yield-specific checks/yields are expected, not concealed.

Clock results must be finite, nonnegative and monotonic. Clock faults or lifecycle loss during a clock callback latch the runtime stopped, bypass application catches and run unconditional cleanup. Clock callbacks cannot enable successful continuation after disposal. Normal factory ignores the extra clock field and never reads it.

The new factory accepts only `prepare` and `reopen` phases. It supplies no storage authority and is not a trusted-input flag. Production use is initially limited to the worker startup owner's coupled **`editor` operation**. Reserve, stage, verify, activate, replacement, exports, ordinary saves and rollback continuation retain their existing runtime.

## Startup ownership

The normalization owner retains its original runtime/session. For an `editor` operation, create a separate operation-owned startup runtime using the existing message-channel progress scheduler. Progress reads that actual runtime's phase/counters. Stop/close/dispose must dispose both runtimes and wake any pending task or protocol continuation. Every operation exit disposes and drops the temporary read runtime before the owner can accept another operation.

No policy toggle is left enabled on a reusable write-capable session. The existing50ms progress cadence, request correlation and30000ms RPC deadline stay unchanged. Repository opening still validates all source/current images and performs its complete atomic seal before publication.

## Verification and rollout gate

- TDD factory tests: ordinary behavior unchanged, reduced startup yields, exact byte/hard-visit ceilings, time expiry, native-operation checks, budget continuity across runs, invalid/backward/frozen clocks, thrown/rejected clocks, lifecycle precedence, cancellation cleanup, invalid-operation priority and phase refusal.
- Startup-owner tests: only `editor` uses the new policy; mutation/replacement operations retain the default; close/dispose and failed operations release all temporary ownership; correlated progress remains usable.
- Existing Work/frame/hash/validation/source/reconstruction/authority/startup/worker/editor tests remain gates. Exact new factory usage is constrained to the startup owner; no broad storage capability grant.
- Reuse Task27's real corpus and source/target producers for a fixed serial baseline/candidate/candidate/baseline comparison. Baseline loads the immediate old Work module; candidate loads the new startup factory. Compare identical digests and logical counters, excluding intentionally changed yield/check bookkeeping. Require at least2× in both matched pairs for both stages; no retry-until-green or helper-count-only acceptance.
- If the pipeline gate passes, wire the editor operation and run the unchanged actual21MB scenario. Require material cold-open improvement plus all saves/switching/history/reload/native failure/retry/durable readback. Measure cancellation responsiveness separately; do not add per-operation timers to timed comparisons.
- If the candidate fails a gate, preserve evidence and do not promote an unused scheduling path. No source/validation reuse or additional engine optimization is bundled into this slice.

## Preserved resources and limits

No commits/staging/merges, installs, deployment, existing-profile access or destructive cleanup. Implement inline; read-only review allowed. Keep preview4322/4323/PID2512304 and protected sibling files unchanged. Historical `/tmp/opencode/doctect-local-preview-20260919/api.sqlite` is already absent with unknown cause; do not recreate it or claim preservation. Keep that audit exception separate from performance results.

AppState32MiB/depth512/history50, receipt windows32entries/64KiB, migration64records/256KiB, unit defaults5000/10000ms and existing named exceptions, opening120000ms and saved-status5000ms remain unchanged. This amendment changes only the named startup runtime's cumulative yield policy.
