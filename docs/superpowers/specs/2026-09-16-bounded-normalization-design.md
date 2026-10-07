# Task 11b: bounded normalization work

## Status and authority

The user approved the recommended design direction and four amendments: a private invocation-scoped preparation session, explicit indivisible-operation exceptions, phase-boundary legacy recapture, and necessary shared traversal changes. The user subsequently approved this written specification. Implementation planning and tests-first execution are authorized; acceptance remains subject to the gates below.

This supplements `../plans/2026-09-16-bounded-normalization-follow-up.md` and the approved normalization-admission amendment. It changes only the private interface and scheduling constraints named below. Task 11's correctness acceptance does not close M1. Task 11b blocks Tasks 12/13 integration; production database default stays version 2.

No commits, existing browser-profile migration, protected-sibling changes, live protocol/UI wiring, new normalized writer, dependency installation, durable-format change, or source cleanup is authorized.

### Approved full-size timeout amendment — 2026-09-29

The user approved the [ten-minute full-size acceptance amendment](2026-09-29-fullsize-normalization-timeout-design.md). Only `normalization preserves original 32MiB state boundary and refuses one extra UTF-8 byte` changes from360000ms to600000ms for its complete existing test body. All other timeouts, fixtures, assertions, correctness/resource budgets and runtime behavior remain unchanged. A versioned external runner uses a 670000ms process ceiling for that case; historical360s results remain intact. This narrowly supersedes earlier unchanged-timeout language for the named case, not short5000ms gates or the rejected scalar-dispatch promotion decision.

### Approved YAGNI amendment — 2026-09-17

The user approved removing the new scheduler-specific semantic analyzer and its artificial source-mutation requirements. Keep existing storage-ownership/import checks and meaningful work-runtime tests. The cooperative helper executes trusted application code; it is not a JavaScript sandbox. Test yielding, cancellation, cleanup, observer isolation and bounded work through its interface instead of attempting to prove those behaviors for arbitrary altered source. This supersedes the G2a scheduler AST/prototype/cleanup-proof requirements, not migration data-integrity or independent physical-verification requirements. The separate proposal to change Node ref/unref behavior is not required or adopted by this amendment. Apply YAGNI to subsequent implementation: add only what the approved migration path needs.

### Approved execution-order amendment

The user approved continuing remaining G5c strict adapters and G6 invocation-scoped orchestration as a connected implementation milestone while the80-template5000ms timeout remains an explicitly open blocker. Intermediate performance failure does not prevent implementing the session integration intended to remove repeated work. This changes execution order only: no correctness gate is waived, no timeout or fixture is weakened, and no G5c/G6 acceptance is implied. Track deterministic read/derivation/staging/lifecycle budgets during integration, then profile residual active-read traversal. The original80-template and32MiB performance gates, fault matrices, cumulative accounting and native responsiveness requirements still apply before acceptance; Tasks12/13 production wiring remains blocked.

Following the Sticker Press interaction diagnosis and recalibration, the user additionally selected **“Private integration first (Recommended)”**: private Task12/13 editor/store implementation and isolated interaction tests may proceed while migration acceptance is open. This supersedes any blanket prohibition on starting those private tasks, not their production-cutover gate. Production stays on v2; no existing-profile migration, arbitrary runtime editing-authority flag, weakened verification, or budget change. The first slice and its unit-versus-browser proof limits are specified under Task12 in the original incremental-persistence plan.

## Problem and chosen approach

### Fragment sizing amendment — approved written specification

The user explicitly retained every existing test timeout and fixture, then approved increasing the internal JSON/frame fragment cap from 16 to **64 UTF-16 units**. The scheduler quantum remains **1,024 visits / 64 KiB emitted UTF-8**. This supersedes implementation-plan references to 16-unit fragments, not the work, read, derivation, staging, authority, or native responsiveness budgets.

Use one shared 64-unit constant for raw text/quoted-string producers and frame counting/comparison/hashing consumers. Preserve surrogate-pair boundaries and byte-for-byte canonical/ordered JSON output. A malformed producer emitting 65 units must still fail closed. No full-frame buffering, wider source authority cache, new transaction await, or skipped validation is permitted.

Each operation remains independently below the unchanged visit ceiling:

| Operation | Worst-case visits at 64 units |
| --- | ---: |
| String copy and escape/UTF-8 inspection | 192 |
| Native escape fallback, excluding the separately charged copy/inspection | 836 |
| Raw text copy and UTF-8 encoding | 128 |
| Compare both fragments | 128 |
| SHA-256 update: at most 192 input bytes plus three 136-visit compression blocks | 600 |

SHA update accounting must use `inputBytes + 136 * floor((pendingBytes + inputBytes) / 64)` instead of the previous one-block boolean. Padding/finalization accounting stays unchanged. UTF-8 counting scratch grows only from 48 to 192 bytes; the separate 512-unit raw-length scratch and 128-unit count-only JSON scan do not change. Each comparison retains at most one fragment per side. G6 must include changed fixed temporary sizes; this amendment is not a heap or native-latency acceptance claim.

Tests must prove exact output/digest parity across ASCII, BMP, astral, controls and lone surrogates; split-pair boundaries; multi-block hash updates including pending partial blocks; producer overflow refusal; cancellation/finalizer cleanup; unchanged work-quantum limits and accurate byte/prefix accounting. Verify actual bulk cases under their original timeouts. Retain exact architecture allowlists and relevant mutation probes; update only assumptions directly tied to the explicitly amended fragment cap. Do not revive the withdrawn scheduler semantic analyzer.

Alternatives considered: keeping 16-unit fragments and batching SHA inputs adds buffer/accounting complexity without reducing comparison/traversal dispatch; further isolated micro-optimizations already reduced count-only serialization work but have not cleared the bulk timeout gate. The user selected the bounded 64-unit design and subsequently approved this written amendment with “Approve and continue.”

### Count-only scan packing — approved written amendment

The current count-only JSON string scan charges four visits per UTF-16 unit, followed by one visit for byte accounting. A128-unit scan therefore costs513 visits: two scans cannot fit the1024-visit quantum. This is avoidable scheduling waste, not excessive work within a quantum.

Recommended change: use at most127 units per count-only quoted-string scan, retaining the existing surrogate-pair boundary adjustment. Two ordinary scans then cost1018 visits. This narrowly supersedes the preceding amendment's unchanged128-unit count-only scan; it does not change64-unit serialization fragments,512-unit raw-length counting, scratch allocations, work limits, validation order, error handling, authority checks, transaction boundaries, or test timeouts/fixtures. Charge actual scan lengths and every accounting operation; do not suppress yields or discount visits. Cancellation still occurs at normal runtime boundaries.

Tests must first demonstrate excessive yield count on a64KiB ASCII string, then verify native canonical/ordered byte-count parity, actual visit/byte accounting and both unchanged quantum ceilings after the change. Include paired and lone surrogates around positions125–129, existing all-UTF-16 parity, cancellation and ownership cleanup. Run the original32MiB gate only after focused checks; smaller diagnostic inputs never replace acceptance coverage.

Evidence: an in-memory1MiB boundary probe (not acceptance) measured140053136 visits/244944 yields per active read before,140054761 visits/143503 yields after changing only128 to127. Hash bytes remained3180717, with the same33 pages, one derivation/reconstruction/seal. Yields decreased41.4%; whole-test elapsed time was noisy (10.35s versus10.36s), so no wall-time or timeout-closure claim is justified. The separate80-template failure remains a canonical-traversal/dispatch bottleneck, not established as this scan-packing issue.

Alternatives: keep128-unit scans and prioritize the already-approved remaining adapters/G6 (avoids this amendment but preserves demonstrated scheduling waste); restructure count/emit accounting to batch more operations (larger change and more complex exact-byte/lifecycle reasoning). Prefer127-unit scans because the adjustment is local, preserves accounting, reduces rather than enlarges individual operations, and has a deterministic regression test. The user reviewed this written proposal and selected “Approve (Recommended)”; tests-first inline implementation is authorized, without commits or relaxed acceptance gates.

### Invocation-scoped preparation

Current preparation, staging, per-project verification and reopen repeatedly reconstruct and hash the full workspace. The approximate cost is O((B + P) × W), where B is batch count, P is project count and W is workspace size. The stage payload limit does not bound preparation or memory.

Use a repository-owned session to reuse preparation within one invocation, then perform a constant number of independent physical validation passes and exact transactional comparisons at authority transitions. Cooperative CPU traversal runs outside transactions. A preparation session never certifies current durable data.

Rejected alternatives:

- Adding yields to the existing repeated-pass algorithm improves scheduling but leaves the main work amplification; it cannot close M1.
- Durable chunk/manifests require broader storage and writer changes. They are outside this task and would not eliminate the initial monolithic legacy read or justify trusting metadata after raw physical mutation.

## 1. Private interface and ownership

`createNormalizedRepository` remains the sole normalized writer. Add a private invocation-scoped session with these responsibilities:

| Operation | Contract |
| --- | --- |
| Prepare | Capture and validate source, compute immutable preparation metadata, and independently validate any existing prefix. Return only small source-kind/legacy-fence information. |
| Reserve | Compare actual source and relevant target records atomically with the prepared candidate; reserve archive and attempt together. |
| Stage next | Emit the next bounded batch and atomically compare the expected marker, add records and advance progress. |
| Verify | Independently reread and reconstruct all projects once in a verification pass; seal the exact candidate before marking verified. |
| Activate | Validate a fresh candidate, including live ancillary source; seal it before atomic activation. |
| Reopen | Independently validate current active storage and return authority plus its verified snapshot from one combined read. |
| Dispose | Release invocation-owned graphs, indexes, buffers and preparation state on every exit. |

The existing eight one-shot repository methods retain strict validation for their callers. They may delegate to shared internals but cannot acquire hidden cross-call trust or infer that caller-owned objects are immutable. The normalizer uses the session instead of invoking independent full preparation per batch/project. This explicitly amends the earlier prohibition on an additional private command vocabulary; it adds no worker message family or second ordering owner.

One-shot active-read/export calls remain independently validated. Internal normalizer/recovery paths may use a combined fresh authority-and-snapshot read to avoid discarding a verified snapshot and immediately rereading it. A cached last-admitted snapshot is not current authority.

Work control provides cancellation/owner-epoch assertion, a real task-yield operation and passive numeric progress observation. The existing coordinator tail and captured epoch remain the ordering authority. No payload, opaque validation receipt or mutable preparation graph escapes to progress observers.

## 2. CPU work units and shared semantics

Outside transactions, traversal yields after at most **1,024 graph/element visits or 64 KiB emitted UTF-8**, whichever comes first. Check lifecycle before and after work quanta, awaits and actual task yields. A microtask-only `Promise.resolve()` is not a task yield.

The work cursor covers validation, partitioning, reconstruction, framing, encoding and hashing, including long strings and wide containers. Canonical key sorting needs resumable comparison/merge work with its cost counted separately. Do not call an unchanged whole-project serializer, loader, validator or codec inside a nominally bounded step and count it as one visit.

Extract/share traversal rules with existing synchronous APIs rather than maintaining a second validator with subtly different compatibility semantics. Preserve ordering arrays, fold exceptions, own-property absence, JSON escaping, UTF-8 surrogate handling, negative-zero canonicalization, finite-number rules and existing depth accounting.

Normalization hashes are incrementally fed the **same bytes** as existing digest frames. Preserve SHA-256, domains, ordering and digest output; no hash-of-hashes or Merkle reinterpretation. Reuse the result of a distinct required frame only within its captured pass. Ordinary selected-record hashing and save budgets are unchanged. Any incremental hash implementation must pass known vectors and differential tests against existing framing/hash results; no new dependency is implicitly approved.

Historical prerequisite validation and shared loops reached by normalization belong in work accounting. Necessary shared traversal seams are authorized, but historical admission, repair and warning policy must not change. A whole historical helper is not an indivisible primitive exception. If additional loader modules or policy changes become necessary, stop for a scoped design amendment rather than quietly broadening the work.

### Approved loader-scope amendment

Following inspection of the unconditional historical load path, the user approved behavior-preserving resumable extraction in `services/loadProjectState.ts`, `services/migration.ts`, `services/textOverflow.ts`, `services/textPadding.ts`, and the migration-used `ensureTemplateLayers` helper in `services/layers.ts`. This includes current-schema overflow/padding normalization and old-schema migration traversal. Preserve existing synchronous APIs, migration order, defaults, warning/rejection rules, unchanged-reference behavior where specified, and ID-generation call order. Rendering/editing layer functions and policy changes remain outside scope. These five named seams no longer require another scope approval; additional unrelated modules still do.

## 3. Physical reads and exact transactional seals

Read candidate data using one cursor row per short readonly page with an exclusive continuation key and explicit store-end evidence. This bounds each page by one actual physical record, not its untrusted declared size. Do not reread the complete marker for every page. Starting/ending marker checks can detect contention early but do not establish a coherent snapshot.

Candidates are untrusted until an exact seal. A change to an already-read page, insertion behind a cursor, same-revision replacement or ancillary mutation must be caught by comparing **all physical rows, keys and membership** in one transaction spanning the relevant stores.

During a seal:

- Cursor through one current physical row at a time; compare it synchronously with the captured candidate and verify exact end-of-store membership.
- Preserve the existing comparison semantics, including canonical equivalence where previously used and order-sensitive equality where required. Matching revisions, counts, supplied hashes or marker identity alone is insufficient.
- Avoid constructing a second complete capture or joined workspace-sized comparison frame.
- Check cancellation synchronously between records and immediately before writes. Passive synchronous numeric observation is allowed, with observer exceptions isolated.
- Do not yield, await asynchronous hashing/observers, use keepalive requests, or split an authority-transition seal across transactions.
- Publish durable progress only after the transaction completes.

Reservation, verification and activation use readwrite seals. Active reopen and retained-source export use coherent readonly seals after asynchronous validation and before returning their result. A torn paginated candidate either matches a real simultaneous state at its seal or is rejected; a second unsealed paginated pass is not a substitute.

## 4. Explicit indivisible-operation limits

IndexedDB materialization/structured cloning, exact in-transaction comparison of one physical record, and indivisible engine primitives cannot be interrupted by the cooperative scheduler. Record these exceptions, with lifecycle checks immediately before and after wherever JavaScript control permits. Do not broaden the exception to application loops that can be stepped.

A seal still takes O(workspace size) total work. A single callback may take O(largest physical record) work. Native cursor events permit opportunities between records, not a fixed millisecond guarantee. Cancellation cannot interrupt an in-progress native clone or synchronous record comparison.

The 32 MiB limit applies to AppState, **not** the entire workspace, retained backups, wrapper extensions, archive, or historical identifier lengths. Do not claim that every physical record is at most 32 MiB or introduce a new cap. Keep depth 512 and the legal oversized single-record exception. Native phase/heap/cancellation measurements remain later rollout gates.

## 5. Preparation, staging, verification and resume

Prepare source once per captured validation pass, validate each captured backup row once, then check each reference's required kind/time/digest against that result. Compute project indexes once; do not filter all workspace records separately for each project.

Preparation may traverse target output twice: once for metadata/manifest and once for emission. Keep metadata plus the current project and batch, not two complete target arrays. Preserve the existing manifest's project/store/record order and exact frame bytes.

Stage transactions retain the **64-record / 256 KiB** framed-payload limit and one legal oversized record alone. Within the session, batches read/compare the expected marker and append records; they do not rehash the entire source or reread the entire staged prefix. Stage progress is never active authority.

On resume, independently validate the complete durable prefix once before appending. Missing, extra, misplaced, incorrectly keyed or mismatched records fail closed. If another actor advances the expected marker, dispose the session and start a fresh bounded attempt; do not splice its cursor into cached preparation. Preserve the existing eight-retry limit and count failed attempts.

Verification, activation and reopen read actual durable data independently of the preparation graph. Each required pass reconstructs each project once. Verification seals before the verified marker; activation validates again and seals before active publication. A verified marker from an earlier process does not certify current target bytes.

Fresh seed and archive are reserved once. Preserve D7 collision-safe archive allocation, sourceArchiveId reuse, exact archive validation before exclusion from source CAS, and original project records. Cancellation, retries and lost acknowledgements must not create retained-copy proliferation.

## 6. Legacy fences and cancellation

For an uncontended migration invocation, perform full stable legacy recapture at discovery, immediately before reservation, before verification, before activation and before final publication: **at most five captures**, independent of batch/project count. An already-active path needs discovery and final-publication checks. Count underlying reads and repeated hashes within each capture; one capture is not assumed to be one hash. Separately report prerequisite repair/capture work and retries rather than hiding them in these budgets.

Between these fences, check cancellation and observed owner/source epoch at every work quantum and durable boundary. A source change during staging may leave additional non-authoritative records before the next full fence. Persistent mismatch refuses publication. No promise is made to observe a change that occurs and reverts between fences; unchanged epoch alone is never exact legacy equality.

All final progress observers run before the last legacy fence and final lifecycle assertion. Observers are passive; they cannot certify data or alter payloads. A callback that throws must not change the persistence result. A callback that changes source/epoch must be detected by the appropriate following check.

Once cancellation or epoch loss is observed, perform no further planned writes. A transaction already committed may remain committed while its acknowledgement is suppressed. Cancellation before reservation leaves no attempt; later cancellation leaves an atomic old/new durable phase that a new invocation must inspect. Never infer rollback from rejection or acknowledgement loss.

Cancellation recovery must not trigger a new uncancellable full scan to enumerate exports. Either validate recovery selectors through a separately valid bounded recovery pass, or return the existing typed non-ready outcome without unverified selectors. Never advertise staged target bytes or a speculative fresh seed as current/exportable authority.

## 7. Work and memory acceptance budgets

For one uninterrupted, uncontended invocation define S/T as source/target payload bytes, N as physical row count, M as complete marker size, B as batch count, P as project count, L as legacy capture size and Q as the largest project working image. Source includes retained backups/archive; marker size may grow with P.

| Segment | Required payload passes |
| --- | --- |
| Prepare/resume candidate and reservation seal | At most two full-set reads; one source/target derivation and one prefix validation |
| All stages | B marker CAS operations; one further target-emission traversal; no full-source pass per batch |
| Verification candidate and seal | Two full-set reads; one source/target derivation and one all-project reconstruction |
| Activation candidate and seal | Two full-set reads; one fresh source/target validation |
| Active reopen candidate and seal | Two full-set reads; one fresh baseline/current-proof admission |

Thus the successful path permits at most **eight full-set payload read passes**, plus explicit fixed store-EOF/discovery metadata work and B marker operations. At most four full source/target derivation passes occur; target emission is an additional traversal, not another per-batch manifest derivation. Fixture assertions must count actual rows/bytes/hash inputs, not only method calls. Recovery/export invocations and contention retries have separately identified budgets, and total counters include all work.

Hash input accounting distinguishes source frames, target manifests, current-proof frames, stage payloads and markers. There must be no B-times-full-source or P-times-full-workspace term. Retained B × M marker work, up to five legacy captures, and canonical sorting costs remain explicit. Do not describe B × M as constant-size O(B) when M contains project identities. Arbitrarily many crashes cannot have a finite cumulative resume-work bound.

Memory ownership:

- Preparation retains one source graph, metadata/index, one project image, one batch and bounded frame/hash buffers. Resume may additionally retain the independently captured prefix until its reservation seal.
- Release preparation graphs before allocating a full independent verification capture.
- Verification/activation retain one captured source/target graph, metadata, one reconstructed project and bounded buffers. The seal adds one current row, not another full workspace graph.
- Active reopen necessarily returns a whole workspace snapshot; this is not constant-space migration. Avoid retaining redundant normalized images after producing it.
- Dispose graphs and buffers on cancellation, retry and all terminal outcomes. Logical ownership/high-water counters are not real heap measurements; native clone temporaries require later browser measurements.

Diagnostics contain only phase/store-class enums and numeric aggregates: rows/bytes read, transactions, EOF checks, visits, frame/hash bytes, derivations, project reconstructions, marker bytes, writes, yields, lifecycle checks, retries, observed aborts, primitive exceptions and logical retained high-water marks. No content, names, IDs, keys, digests, incarnations or exception messages appear. Existing key-bearing test observers must not become public progress diagnostics.

## 8. Preserved correctness contracts

Preserve exact source incarnation, revision, canonical timestamps and ancillary/source CAS. No synthetic ordinary commits or revision resets. Independent reads must continue accepting valid edited authority rather than requiring equality with obsolete migration contents.

Preserve document-baseline comparison despite preference-only proofs; initial source-fold anchoring even after document edits; advanced preference `foldRecordDigest` authentication and independent physical fold hashing. Missing advanced private fold evidence remains fail-closed with retained historical recovery. Preserve both proof windows, eviction/self-eviction, proof-unavailable/cache-gap behavior and explicit rebind.

Ordinary scalar preference saves retain six point reads, one preference put, no template/extension reads and no fold hashing, including deferred scalar writes after structural changes. No external JSON/generator/PDF/cloud/provenance format changes. Retained exports remain distinct and not automatically rollback-ready.

## 9. Scope and verification

Primary seams: normalized repository, migration orchestrator, codec, coordinator, recovery and a focused private cooperative work/framing module. Necessary shared canonicalization, validation, historical preparation and document partition traversal may be extracted without policy changes. Schema edits are limited to private interface types, not durable fields/version changes. The concrete implementation plan must enumerate file scope before workers edit it; broader loader changes require explicit scope review.

Preserve existing tests and add tests-first coverage for:

1. Multi-project/multi-batch read/hash/derivation budgets, including legacy work and full marker bytes.
2. Real-task cancellation and epoch changes during source preparation, framing/hash, verification, fold checking and reopen, including within long strings/wide containers.
3. Legal large records, depth boundaries and explicit native/transaction primitive exceptions; no wall-clock assertion substituted for deterministic work accounting.
4. Torn candidates, same-revision replacements, insertion behind page cursors, deletion, ancillary/archive mutation and wrong physical keys before every seal.
5. Source/earlier-target mutation after staging, fresh resume and competing marker progression; no session-cache authority.
6. Quota, clone failure, abort, versionchange, termination and acknowledgement loss at old and new boundaries; one archive/attempt and atomic progress retained.
7. Existing and incrementally framed byte/digest equivalence, Unicode/escaping/order/fold/absence compatibility, known SHA vectors and unchanged accepted historical attempts.
8. Passive/throwing observers, caller-object mutation across awaits, sanitized diagnostics and released logical memory on every exit.
9. Existing D6 current-proof/fold matrix, historical admission/repair behavior and ordinary-save read/write budgets.

Run targeted tests, affected historical/normalized/boundary regressions, typecheck and build. Explicitly classify the existing Sticker Press TS2339 baseline; do not label a failing full typecheck green. Preserve deterministic fault hooks when scheduling changes; do not remove assertions or make race injection inert.

Independent spec and quality review uses a fresh Task11b dirty baseline, not HEAD~1 or the Task11 baseline. No automatic commit or cleanup. M1 closes only after the reviewed implementation and deterministic gates pass.

## 10. Later gates, not claims of this task

Tasks 12/13 own the actual legacy-capture bridge, correlated progress/cancellation, source invalidation and migration-specific transport timeout policy. The ordinary 30-second timeout is not a migration protocol. No editor mounts while authority is uncertain.

Tasks 14/15 own isolated native phase timings, peak heap/RSS, cancellation latency, maximum legal records, multi-project fixtures, browser/worker crash/quota/versionchange and acknowledgement loss, full performance gates and whole-branch review. Use fresh contexts and alternate ports; never touch the protected app or existing profiles. Fake-IDB counters and passing correctness tests do not prove these native properties.

## Supporting investigation

Read-only evidence map and proposed seam analysis: `/tmp/opencode/doctect-incremental-sdd/task-11b-contract.md`. Accepted predecessor evidence: `task-11-accepted-handoff.md`, `task-11-review-04.md` and `task-11-controller-checks.md` in the same artifact directory. After written-spec approval, this repository design is the implementation contract; temporary preflight alternatives are not additional requirements.
