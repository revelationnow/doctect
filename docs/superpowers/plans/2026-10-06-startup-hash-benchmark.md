# Startup Hash Benchmark Plan

> **For agentic workers:** Execute inline using systematic-debugging, writing-plans and TDD for benchmark tooling. Read-only review permitted. No production implementation or dependency installation is authorized by this benchmark.

**Goal:** Decide whether startup work should prioritize the hash engine or repeated traversal/formatting/composition, using real browser-worker measurements on the pinned21MB workspace.

**Architecture:** Isolated benchmark worker imports the actual source-image hashing and target frame-comparison producers. An external build transform changes only the synchronous SHA factory, never application files. Compare valid JS/WASM digests, plus an explicitly invalid no-SHA counterfactual that retains scheduling charges. Native Web Crypto is measured separately on complete encoded input because its whole-buffer interface is not a drop-in replacement for the production streaming contract.

**Tech Stack:** Existing Node22, esbuild/Vite, Playwright/Chromium, actual cooperative Work and frame producers. Pinned MIT `hash-wasm@4.12.0` browser artifact is downloaded only into the external benchmark directory and verified against published package integrity; no npm install, package/lockfile change or package scripts.

## Baseline and constraints

- Worktree `incremental-local-persistence`, branch `feat/incremental-local-persistence`, HEAD8a2872d. Immediate snapshot `task-27-hash-benchmark-baseline`; production/runtime/test/config stamp **cb3eb92553f2244454afc9b95c1269e5df8fda25891fa4a6c6b7d03ee76f94d1/1221** must remain unchanged.
- Task26 actual saved-workspace workflow already passes. Preserve that acceptance separately; benchmark outputs cannot mint editing authority or qualify app readiness.
- Runtime1024visits/64KiB; JSON64UTF16/max192UTF8; streamed SHA192bytes/max600visits. No Work-driver, guard, scheduler, source/current validation or seal change. Large-block WASM and whole-buffer Web Crypto are explicitly kernel experiments outside that drop-in interface.
- Browser worker, not Node throughput, is primary performance evidence. Input loading, canonical-byte preparation, WASM initialization and optional whole-input buffering are recorded separately from timed hashing.
- Existing saved fixture `/tmp/opencode/doctect-saved-workspace-large-1791270465663/saved-workspace.json` and pinned original AppState SHA604d08…8a22. Use retained source and current normalized records, not a repeated toy string.
- Fresh nonpersistent contexts; checked4320/4321 only. Block nonlocal browser network. No existing browser profile, preview restart, deployment, commits/staging, installs or deletion. Ask before further destructive cleanup.
- Keep every failure and raw timing. Fixed serial order; no retry-until-green. Report inconclusive differences rather than extending a campaign until a preferred engine wins.

## External files

All helpers and generated outputs live under `/tmp/opencode/doctect-incremental-sdd/task-27-hash-tools/` or unique sibling result directories. Only this plan, its result notes and the execution ledger may change in the repository.

- `fetch-vendor.mjs`: fetch exact4.12.0 tarball, verify SHA-512 integrity, extract only browser ESM/package metadata/license using existing tar-stream, preserve provenance. Do not execute package scripts.
- `contract.mjs` / `contract.test.mjs`: cost formulas, fixed trial order, digest/result classification and decision checks, including negative controls.
- `adapters.mjs` / `adapters.test.mjs`: stock SHA factory; preinitialized WASM pool bound to at most3simultaneous states; non-cryptographic elision control. Exact update/finish accounting and lifecycle refusal; record actual WASM linear memory separately from JS logical buffers.
- `worker.ts`: actual source/target frame producers, native browser correctness vectors, byte-only kernels, serial timed pipeline tasks and cancellation/custody checks. No IndexedDB writer or application admission import.
- `run.mjs`: exclusive outputs, source/tool/vendor hashes, minimal publicDir:false worker build, isolated local serving/fixture route, fresh browser contexts and serial campaign. Preserve raw results before summarizing.

## Task1 — correctness and provenance

- [x] Verify vendor integrity before extraction. Expected npm integrity: `sha512-+/2B2rYLb48I/evdOIhP+K/DD2ca2fgBjp6O+GBEnCDk2e4rpeXIK8GvIyRPjTezgmWn9gmKwkQjjx6BtqDHVQ==`; npm gitHead373b796205ab55fb4a657374dad6ea589bf75815. Record extracted hashes and license.
- [x] Write and observe helper REDs before implementation. Test false digest success, missing/duplicate trials, non-cryptographic-control exclusion, wrong counter parity, malformed transform anchors and wrong vendor integrity.
- [x] Verify empty/abc, UTF-8 and SHA padding/block boundaries, segmented input,192-byte edge/refusal, concurrent independent states, close/dispose/error/cancellation cleanup. Compare real JS and WASM to native SHA-256, not to themselves.
- [x] Source and target results must equal the existing persisted fixture digests. Verify input identity and byte/work counter parity; do not count an elided digest as a valid result. No timing accepted before these checks pass.

## Task2 — fixed browser campaign

### Byte-only kernels

Encode the exact canonical large project body once outside the kernel timer. Record its byte length and SHA-256. Record all WASM compilation/instance initialization separately.

- Current JS with64-byte updates.
- Current JS with192-byte updates.
- WASM with64-byte updates.
- WASM with192-byte updates.
- WASM with16384-byte updates: diagnostic chunk-size experiment, not production-compatible.
- Browser Web Crypto on the entire byte buffer: includes its call/return but excludes prior encoding, and requires whole-input buffering.

Use one warm-up and five measured rounds, rotating variant order. Report all samples, median/range and initialization/buffer costs; no end-to-end claim from this layer.

### Real hash pipelines

For each of source-image hashing and target-record comparison/hash emission, use actual imported production producers and default authentic Work. Use fresh contexts for trials, small-data warm-up, same input and exact normal-size fragment limits. WASM is preinitialized; cold initialization remains a separately reported cost.

Fixed order: **JS, WASM, WASM, JS, JS, elided, elided, JS**. Thus valid-engine AB/BA pairs and separate JS/elision pairs have fixed endpoints. No simultaneous throughput jobs. A120s per-job diagnostic ceiling is not an application timeout change.

The elided factory consumes every input and returns the same logical work charges without executing SHA compression. Its digest is deliberately invalid. Label it `non-cryptographic-control`, never a candidate, never use its output in storage, and preserve identical producer/hash-byte/work counts. Its purpose is to bound the benefit of removing hash computation while retaining the existing pipeline/scheduling interface.

- [x] Run the fixed byte-only campaign with native/JS/WASM equality checks on every result.
- [x] Run both fixed pipeline orders; require real-engine digest equality and non-memory counter parity. Record WASM resident linear-memory pool, full-byte buffer requirement, and lack of a complete native heap measurement.
- [x] If WASM wins both matched pairs by at least10% on both real pipelines, collect a separate paired actual-app cold-open experiment before making an end-to-end recommendation. Otherwise do not spend further app runs seeking a win; report marginal/inconclusive or prioritize pipeline work. **Gate not met; no cold-open variant run or promotion.**

## Task3 — decision and preservation

- [x] Obtain read-only review of harness fairness, classification, digest oracles, source transform and summaries. Fix tool defects with tests and retain invalidated receipts.
- [x] Reconcile all planned samples, failures and provenance; distinguish kernel speed, hash-stage speed and app-level evidence. No extrapolated single-digit startup promise.
- [x] Map measured residual cost to already shared work versus still-separate inspections/projections. Describe reuse opportunities without silently adopting a validation cache or new integrity policy.
- [ ] Verify unchanged production stamp/empty index/protected resources/preview and released owned ports. Keep source/task fixtures and all previous acceptance artifacts. Record a recommendation; do not promote benchmark code automatically. **Source/index/sibling hashes/preview/ports verified; historical protected SQLite presence check failed. See audit exception below.**

## Task27 measured result — prioritize pipeline work, not a drop-in SHA rewrite

**Production unchanged:** cb3eb92553f2244454afc9b95c1269e5df8fda25891fa4a6c6b7d03ee76f94d1/1221. No runtime/test/config/package/lockfile changes, installs, application rollout or new app-acceptance claim. Benchmark code, vendor artifact, builds and receipts are external. Current saved-workspace acceptance remains Task26's uninstrumented110950ms/full-flow pass.

### Evidence and integrity

- Fixed campaign: `/tmp/opencode/doctect-incremental-sdd/task-27-hash-benchmark-1791302745986/report.json`; completed/valid, no cleanup errors, no unattempted pipeline cases. Chromium143.0.7499.4, fresh contexts/workers, serial execution.
- **30kernel measurements**,6kernel warm-ups,16full-size pipeline samples,16small pipeline warm-ups,111browser digest vectors and6cancellation cases. All valid-engine digests agree with independent Node/native/persisted fixture oracles. Intentional source-oracle and kernel-failure controls retain their failed status and available measurements; they are not performance candidates.
- Actual canonical large-project body: **21,152,361bytes**, SHA`f9226de58dd2b5ec7302382c07c821e76d10ab3146de61d8e006cfd4205feab2`; original AppState remains21,152,284bytes and pinned SHA604d08…8a22. Target stage covers2208normalized records. Source stage hashes63,546,370bytes across independent digest domains; target stage hashes21,852,461bytes.
- **13Node tooling/adapter tests pass** after missing-helper REDs and review-driven negative tests. Read-only reviewer `ses_eee25c7b3ffeDAW28WtKeHtuvZ` verified all trials, counters, goldens, source/tool/vendor/fixture hashes and summary arithmetic; final review clear.
- Initial harness review found three reporting weaknesses, fixed before timing: recommendation needed final provenance/cleanup gates; row-supplied oracles needed binding to controller-held corpus goldens; failed samples needed structured timing/digest/counter retention. RED/early correctness receipts are preserved. Final runner invalidates changed source/tools/vendor/input or failed cleanup, records failed/started/unattempted trials, and never promotes the elision control.
- Reconciled summary: `task-27-hash-summary-01.json`, generated by external `task-27-hash-summary.mjs`. Source/tool integrity and exact fixed sample inventory are asserted, not inferred from a fastest run.

### Raw hashing: five measured rounds per variant

These timers begin with the complete canonical UTF-8 byte buffer already prepared. They include hash initialization/update/final result, plus the relevant JS/WASM input copies or native digest call, but not earlier formatting/encoding.

| Kernel | Median | Observed range |
| --- | ---: | ---: |
| Current JS,64-byte updates | 691.7ms | 664.6–706.8ms |
| Current JS,192-byte updates | 664.7ms | 632.4–715.8ms |
| WASM,64-byte updates | 204.3ms | 202.1–219.8ms |
| WASM,192-byte updates | 164.8ms | 158.2–167.6ms |
| WASM,16KiB updates | 140.9ms | 137.2–151.6ms |
| Browser Web Crypto,whole buffer | 376.8ms | 372.3–381.0ms |

WASM192 achieves approximately4.03× raw throughput versus JS192 here. Native Web Crypto is faster than the current JS kernel but **not the fastest implementation in this environment**. No general cross-browser ranking is inferred.

The raw-kernel worker took1085.7ms to synchronously canonicalize/encode the project beforehand. That is a diagnostic setup measurement, not the production cooperative encoder. Whole-buffer Web Crypto requires the21.15MB encoded input resident before invocation; additional native buffering/peak heap was not measured.

### Real production producers: fixed JS/WASM/WASM/JS pairs

Matched-pair means, not complete application opening:

| Pipeline | Current JS | WASM,unchanged192-byte cap/Work charges | Savings | Individual matched-pair savings |
| --- | ---: | ---: | ---: | --- |
| Source-image hashing | 16.8939s | 15.52425s | **8.107%** | 6.645%,9.515% |
| Target record comparison/hash | 18.05875s | 17.6311s | **2.368%** | 3.028%,1.740% |

Combined isolated-stage saving: **1.7973s**. This must not be translated into a promised111→109s app opening: these workers do not include complete repository orchestration, IndexedDB admission, current-state validation or final seals. All four matched comparisons fall below the predefined10% gate, so no additional full-app candidate run was earned.

### Counterfactual: remove SHA computation, retain existing interface costs

| Pipeline | Paired JS baseline | No-SHA control | Reduction |
| --- | ---: | ---: | ---: |
| Source | 16.85855s | 14.40365s | **14.562%** |
| Target | 18.33675s | 17.36375s | **5.306%** |

The control deliberately produces invalid zero digests and is never a usable implementation. It preserves original logical SHA charges and Work yields. Approximately85.4%/94.7% remains under that interface even without the actual SHA computation. This identifies a limited benefit ceiling for speeding up the hash leaf alone; it does **not** bound a redesigned batching/native interface that changes how work is organized.

All engines perform the same measured logical work per stage:

| Pipeline | Logical visits | Cooperative yields |
| --- | ---: | ---: |
| Source | 487,009,622 | 535,546 |
| Target | 388,882,791 | 450,952 |

Nearly one million cooperative task yields occur across these two stages. Counts establish substantial coordination activity; they do not separately measure time spent in scheduling versus traversal, formatting, encoding, allocation or checking. The rejected prior generic Work-executor experiment is not revived by this evidence.

WASM initialization in pipeline workers took2.2–2.4ms; the kernel worker's initialization took8.8ms. The prepared three-instance WASM pool retains **393,216bytes (384KiB)** even after active Work ownership reaches zero. Logical ownership counters are not a complete heap measurement, and pooled instance disposal is not a secure-erasure claim.

### Decision and next investigation

1. **Do not prioritize a drop-in WASM SHA replacement.** Raw hashing improves substantially, but current pipeline organization absorbs most of the benefit. No benchmark adapter is promoted.
2. **Investigate producer/capture composition and useful work per dispatch.** Existing source SHA fan-out, same-capture source validation/projection and reconstruction compositions already remove some duplicated work. Remaining scope is sharing compatible traversal/measurement/encoding results through one owner, rather than calling shared helpers repeatedly over the same immutable data.
3. **Separate a batching/native-interface experiment from an engine swap.** Larger bounded processing blocks, fewer transient fragments and native whole-buffer/per-record approaches could reduce overhead, but require explicit memory/cancellation/accounting design. These results neither prove nor rule out such a redesign.
4. **Keep integrity policy changes separate.** Reusing facts within one immutable capture or an authenticated live owner differs from trusting stored validation across reloads. Moving historical-source audits out of normal opening, or adopting a different persisted digest organization, needs an explicit design amendment and corruption/concurrency tests.

No new latency target is claimed. The evidence selects the next area to investigate; it does not show that the remaining pipeline cost has already been removed. Preview4322/4323, benchmark fixtures, protected sibling hashes, empty index and earlier failure/acceptance receipts remain intact. The historical SQLite exception is recorded below. No cleanup or destructive operation occurred in Task27.

### Final preservation audit exception

The strict final audit failed because `/tmp/opencode/doctect-local-preview-20260919/api.sqlite` is absent; its parent directory currently contains only `build/`. The preceding Task26 presence check passed. This benchmark did not read, write or delete that SQLite file, and no Task27 cleanup command ran. The cause and time of its disappearance are not established; do not attribute it to a specific cleanup process or recreate an empty replacement.

The benchmark source, input, vendor and timing evidence still reconcile. Protected sibling content hashes match; current previewPID2512304 on4322/4323 returnsHTTP200;4320/4321 are released. `task-27-verification-01.json` records `preservationAuditPassed:false` and retains nonzero audit exit status. Preservation of this historical temporary database **cannot be verified**. User was notified; this exception is not hidden by the benchmark result.
