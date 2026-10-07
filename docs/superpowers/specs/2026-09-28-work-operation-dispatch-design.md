# Work Operation Capture and Scalar Dispatch

Date: 2026-09-28
Status: Approved on 2026-09-28. The user explicitly approved this written design. Concrete inline execution planning is authorized; the external correctness/performance gates still precede any application promotion. No candidate code or performance result is claimed by this document.

Predecessor: [full-size normalization diagnosis](../plans/2026-09-28-full-size-normalization-diagnosis.md). The [bounded normalization contract](2026-09-16-bounded-normalization-design.md), [admission amendment](2026-09-16-normalization-admission-amendment-design.md), [workspace-authority contract](2026-09-26-normalized-workspace-authority-design.md), and existing source-retention/validation/emission rules remain binding. This is a proposed, separate Work-runtime scope amendment; earlier token-only approval did not authorize it.

Concrete inline plan: [Work operation capture and scalar dispatch implementation](../plans/2026-09-28-work-operation-dispatch.md). User authorized inline execution on2026-09-29. External characterization/core/smoke proof passed, but the fixed full-sizeABBA screen rejected the candidate:4.288%median reduction versus required10%, and second candidate slower than its matched baseline. Original/native gates were not run; application promotion is blocked. No application implementation or acceptance improvement.

## 1. Decision and scope

Propose a narrow change inside `shared/cooperativeWork.js`: separate operation field capture, validation and callback-receiver construction. Each driver captures the five fields once into local values, validates those captured values through one private validation-only helper, uses the locals for admission/accounting, and constructs the same fresh receiver immediately before invoking its captured `run` function.

The public `Work`, `Operation`, `effect`, `primitive`, `retainWork`, `runSync` and `WorkRuntime` interfaces do not change. This is not a new operation protocol, trusted mode, bulk opcode, traversal engine, scheduler or producer-side factory.

Approved conditional application scope:

| File | Allowed change |
| --- | --- |
| `shared/cooperativeWork.js` | Replace the private capture-and-return helper with validation of captured values; use local values in `runSync` and the cooperative `run` loop; construct the compatible invocation receiver at the call site. |
| `tests/unit/localWorkspace/normalized/work.test.ts` | Add characterization/differential tests for field capture, mutation, receiver semantics and error/cancellation order. Preserve every existing test body, fixture and deadline. |

Declarations, JSON producers/cursors/comparators/counters, SHA, canonical hashing, codec/emission adapters, validators/loaders, repository, schema, worker protocol, editor, dependencies and capability grants remain unchanged. No cleanup or unrelated refactor is included. `nonnegativeInteger` and other helpers used by ownership/metrics keep their behavior.

The completed design step changed only this spec, a link in the predecessor plan, and `.superpowers/sdd/progress.md`. External document checks live under `/tmp/opencode`. The next planning step adds the concrete inline execution plan; runtime implementation remains unstarted.

## 2. Evidence, hypothesis and alternatives

Baseline: `.worktrees/incremental-local-persistence`, branch `feat/incremental-local-persistence`, HEAD `8a2872d9a5acae1be3022923c4c515c70212de83`, empty index and intentionally dirty predecessor work. Application/runtime/test/config stamp `062de1ac74c376e26effe619bf96d203ff21cd290b9573de1181f1179b49db18` /1170files. Official migration acceptance remains636PASS/24timeouts across660cases.

Full-size Node profile `task-13-fullsize-cpu-CCt5bM` attributes47.929s of sample-weighted self time to `operationFields`,41.629s to asynchronous execution, and11.618s to synchronous execution. Work-runtime self samples total32.07%; JSON processing28.43%. These are sampled locations, not a breakdown proving how much allocation, validation or property access costs. The compiler may already optimize some proposed work away.

The current helper captures fields, validates them, then returns a new object. The cooperative driver repeatedly reads that object for budget admission and counter updates before calling its `run` method. The proposed change removes the returned-object handoff from validation and uses captured locals directly in the hot driver. It delays creation of the callback receiver until execution actually occurs.

**Falsifiable hypothesis:** this arrangement reduces execution overhead on the complete large-record workflow while preserving the same operation stream and observable semantics. Successful callbacks still require one fresh receiver; this design does **not** claim to eliminate their allocation, numeric validation, guard calls or generator steps. The47.929s hotspot is not47.929s of removable work, and this change is not promised to close the360s gate.

| Approach | Decision and trade-off |
| --- | --- |
| Captured locals, shared validation-only helper, late fresh receiver | **Selected for the gated experiment.** One runtime file, unchanged producer/executor interface and checks. Potential reduction in object handoff/property indirection; JIT benefit remains unproved. |
| Reuse one capture cell, pool receivers, or return the original descriptor | **Reject.** Callbacks can observe/retain/mutate `this`; descriptors can change during guards or suspension. Reuse or aliasing changes identity, field values and later operations. |
| Branded/prevalidated descriptors or a new bulk-operation protocol | **Defer.** Construction-time validation changes error timing; immutability/branding interacts with structural operations and spread-and-wrap adapters. Requires a separate interface and wider proof, not a flag added to this optimization. |

Phase-local traversal sharing remains a different design question. No additional redundant validation traversal has been proved, and expected-target hashing/comparison already share fragments. Do not add either traversal sharing or another JSON/hash micro-optimization to this experiment if its result is weak.

## 3. Existing observable interface

The implementation in `shared/cooperativeWork.js:40–52,83–103,238–296` establishes these behaviors even where current tests do not explicitly pin them:

1. Read `step.value` once at the existing point in the driver. Read the operation fields once in this exact order: `visits`, `utf8Bytes`, `nativeKind`, `metric`, `run`. Ordinary property access includes inherited properties and Proxy/getter behavior. Do not substitute own-descriptor inspection, enumeration, spreading, coercion or branding.
2. Capture all five fields before validating any captured value. A later field getter can therefore throw before a previously captured invalid cost is rejected. If a getter throws, subsequent fields remain unread.
3. Validate captured visits as finite/nonnegative/integer, then bytes likewise, then the existing quantum bounds, then optional native enum, optional metric enum, and callable `run`. Preserve explicit error classes/messages and validation ordering. Optional enum values are absent only when `undefined`, not when falsy.
4. After validation, source-descriptor mutations cannot change this operation's admitted costs, tags or selected callback. Yielding that same source descriptor again causes a new capture and validation.
5. Invoke the callback as a method on a **fresh ordinary object**, not on the source descriptor and not unbound. That receiver has exactly five own enumerable/writable/configurable data properties in order: `visits`, `utf8Bytes`, `nativeKind`, `metric`, `run`; both optional properties exist even when their value is `undefined`. It uses the ordinary object prototype and does not copy source extras/symbols/prototype.
6. The receiver is not frozen. A callback can mutate or retain it, return it, or trigger a nested synchronous driver. Earlier receivers must never be overwritten by later operations or another runtime. Callback argument remains `undefined` in `runSync`, and the authentic runtime in cooperative execution.
7. Apply `synchronousResult` to the callback result exactly as today, including the observable `.then` probe and native-Promise rejection suppression. Do not probe the input descriptor, add a result wrapper, or postpone result checking.
8. Application failures enter the generator through its existing `throw` path. Cooperative lifecycle loss remains latched, bypasses application catches, and wins over scheduler/callback/cleanup errors. Finalizers, reentrancy refusal and terminal checks remain unchanged.

Explicit validation error messages remain `Work counter must be finite`, `Invalid work cost`, `Work operation exceeds quantum`, `Invalid work protocol enum`, and `Work operation must be synchronous`. Errors thrown by getters/callbacks must preserve the same object identity. Native malformed-input TypeErrors remain TypeErrors without execution; keep the capture operand named `operation` to avoid gratuitous destructuring-message changes. Internal stack frames/source locations are not a stable interface.

## 4. Proposed execution sequence

### Shared private validation

Replace the private helper's object input/object output with five already captured values and no returned object. Its ordered validation body remains semantically identical. It performs no property reads from the original operation and keeps the existing numeric/enum helpers. Do not add a common-case numeric shortcut, alter builtin-call order, cache validation, or move validation into `effect`/`primitive` construction.

This keeps validation in one module location. The small, explicit capture sequence appears in each of the two drivers; avoiding a returned container is the reason for that limited duplication. Do not introduce a shared mutable capture slot or another tuple/array allocation to avoid it.

### Synchronous driver

Within the existing per-operation `try` block:

1. Bind `operation` to the current `step.value`.
2. Destructure all five fields in the established order into local values, giving the callback a local alias if needed.
3. Validate those values.
4. Construct a fresh ordinary invocation receiver from those exact values.
5. Call `receiver.run(undefined)` and apply the existing result check.
6. Keep the existing `next`/`throw`/`return` flow and finalization.

### Cooperative driver

At the current `operationFields(step.value)` position:

1. Bind the raw operation and capture all five fields once, then validate them.
2. Execute the existing post-validation guard.
3. Test remaining quantum using the captured visit/byte values. Keep notify, guard, awaited yield, post-yield guard, yield increment and quantum reset in their existing order.
4. Execute the existing pre-charge guard. Update quantum/global/current-phase counters from captured values in the existing order; keep metric aliases and native-exception accounting unchanged.
5. Immediately before the callback invocation, construct the fresh five-property receiver. Call `receiver.run(runtime)` inside the existing callback `try/finally`, followed by the same result check and post-callback guard.
6. Keep application-error routing, generator advancement, terminal checks, cancellation latching and cleanup unchanged.

Use a direct method call. Do not use the callback's `.call` or `.apply` properties, bind it, or install it onto the original descriptor. Such alternatives can introduce new observable property accesses or change the receiver.

Do not hoist/cache the current phase-counter object across guards or callbacks: valid application activity can change the phase. Do not change the number/location of guards, notifications, yields or successful accounting operations. Ownership APIs and the scheduler are outside this change.

## 5. Equivalence and resource argument

At each operation, both drivers obtain the same five captured values by the same ordered reads. The validation-only helper applies the same predicates in the same order. Before callback execution, the old captured object is private and has not escaped; guard/observer/scheduler code cannot access it. Budget decisions can therefore use equivalent local values without consulting a mutable source descriptor.

The late receiver contains the same captured values, property order/descriptors and prototype as the old returned object, and is exposed at the same first observable point: the callback's method invocation. A callback which returns or retains its receiver sees a fresh, stable-per-invocation object, not a shared cell. Mutations after callback entry remain visible through that receiver but cannot retroactively alter already-charged work, just as before.

Rejected/cancelled operations may avoid constructing an unexposed receiver. This is an allocation-lifetime change, not a removed validation or payload traversal. Both success paths still construct one receiver. No payload graph is copied or retained beyond the existing iterator/callback references; no new ownership lease, global buffer or counter category is needed. Logical counters are not native heap measurements.

The operation stream itself stays identical. Quantum1024visits/64KiB, frame64UTF16units/max192UTF8bytes, SHA step<=192bytes/600visits, count-only scan127units, AppState32MiB/depth512 and all stage/read/derivation/retry limits remain unchanged. Independent phases/fresh seals, source/current-authority separation, real loaders and transaction rules are untouched. Production remains legacyv2.

The equivalence argument excludes nondeterministic GC timing and internal stack/source-text inspection; it does not exclude ordinary getters, Proxy traps, receiver reflection, mutation, thenables, observer activity or cancellation. Any mismatch in those supported behaviors rejects the candidate rather than becoming a new exception to the contract.

## 6. Test-first characterization and regression matrix

The unchanged original performance failure is the optimization's RED signal. Compatibility tests should pass on the current baseline before the candidate exists; do not invent a semantic failure just to make a refactor test red. Prove new tests can detect the relevant wrong behavior using isolated negative controls such as descriptor rereading, original-descriptor receivers or a reused receiver cell. Do not install those controls in application code.

Add cases through the real `runSync` and `createWorkRuntime().run` interfaces in the existing Work test file. Do not export a private validation hook or test only a copied replacement loop.

| Contract | Required cases |
| --- | --- |
| Once-only capture | Own/inherited getters and Proxy traps record exactly `visits → utf8Bytes → nativeKind → metric → run`; extra properties and input `.then` stay unread. All fields are captured before validation. |
| Throwing getters | Throw at each field; no later Gets/callback; same error object reaches the generator. Combine earlier invalid values with later throwing getters to pin precedence. |
| Invalid descriptors | Null/undefined, missing fields, noncallable/class/revoked-callable values where applicable; zero/negative/fractional/NaN/infinite/string/boxed/BigInt costs, signed zero and exact1024/65536 edges. No coercion or premature charging. |
| Validation order | Multiple invalid fields; native/metric absent, valid and invalid including falsy non-undefined values. Explicit error class/message and recoverability match baseline. |
| Fresh receiver | `this` differs from original and prior receivers; exact keys/order/descriptors/prototype; original extras/symbols omitted; optional keys present. Test regular and Proxy callbacks, retained/mutated/returned receivers and nested `runSync`. |
| Captured callback identity | A callback with throwing own `.call`/`.apply` properties still uses ordinary method invocation; replacing the descriptor's `run` after capture cannot select a different callback. |
| Guard-time mutation | A real control guard mutates descriptor fields after capture/validation but before execution. Charges, selected callback and receiver retain captured values; next yield of that descriptor captures the changes. |
| Suspension mutation | Exhaust visits and separately bytes so real Work scheduling occurs between capture and execution. Mutate descriptor in observer/injected yield; compare calls, values, event/counter sequence and final state with baseline. |
| Cancellation precedence | Cancel during a getter, post-validation guard, observer, awaited yield, callback/result `.then`, and generator/finalizer. Assert no later execution, no swallowed lifecycle loss, proper closure, exact counters and released ownership. |
| Accounting/context | Metric aliases `visits`/`emittedBytes`, native operations, phase changes from guards/callbacks, successive runs sharing remaining quantum and separate runtime instances. No cached phase attribution. |
| Application unwinding | Getter/validation/callback/thenable failures, generator catches that recover, yielding `finally` on application failure, throwing cleanup and rejected scheduler/Promise paths. |
| Structural adapters | Existing raw operations and codec/emission spread-and-wrap adapters continue through the same protocol; their own callback receiver/late original-operation access must not be silently changed. |

Existing coverage anchors include `work.test.ts:487–586,733–743,815–863,947–1022`; operation getter ordering and receiver identity/reflection are newly explicit gaps. Reuse the existing loader/emission ownership and `.then`-hazard tests, not substitute fake callbacks for those connected paths.

## 7. Performance experiment and rejection rules

Written approval authorizes planning this exact candidate, not broader tuning. Before changing application runtime, the plan must create a source-stamped in-memory overlay for this one Work file and run the characterization/affected correctness suites against it. Capture a fresh immutable dirty-tree baseline; do not compare against HEAD alone, rewrite older baselines or combine this variant with prior ASCII/hash/cursor experiments.

### Diagnostic screen

1. Use the complete original32MiB stress body and assertions in fresh serial processes, default scheduler, same configuration and no concurrent benchmark. Retain the separately named900s diagnostic ceiling only to measure full completion; never replace the original360s case.
2. Use a fixed ABBA order: baseline, candidate, candidate, baseline. No CPU sampler during timing. Record all outcomes and the same coarse attribution in both variants. A first pair with no improvement or a correctness/parity failure can stop the experiment early; a promising first pair cannot justify promotion without the mirrored pair.
3. Compare derived identity/bytes/hashes and **all runtime and phase counters**, including check-only/abort-only phases. The old collector filters such phases, so a new external capture version must retain every phase snapshot for both sides; do not relabel old partial receipts as complete coverage. Keep original artifacts unchanged.
4. Predeclare this engineering screen: each candidate must beat its order-matched baseline, and candidate median complete-workflow time must be at least10% below baseline median. This threshold is a go/no-go rule for the experiment, not statistical proof or an acceptance-budget change. Keep outliers; no best-of substitution or repeated reruns until a pass appears.
5. If the screen fails or is inconclusive, reject this candidate for application promotion and report why. Stop for a scope decision; do not bundle another optimization or weaken a contract. Small-kernel/counter improvements alone do not pass.

The fixed pairs are first baseline/first candidate and last baseline/second candidate. This ordering checks both temporal directions, but two observations per variant do not eliminate runtime/JIT/load/GC variation. The plan must retain source stamps, exact command/config/variant identity, outcomes and unhandled/module failures with each receipt.

### Original gates and native confirmation

Passing the relative screen alone is not enough. Run the actual original32MiB case at360000ms and both original fresh/historical wide cases at5000ms, without diagnostic instrumentation or altered fixtures. If those gates remain red, do not promote the candidate automatically; report it as a measured but insufficient experiment and stop at the scope decision.

Only a candidate passing correctness, parity, the diagnostic screen and those original gates proceeds to a fresh browser-worker/native-IDB baseline/candidate confirmation with the same full body/assertions, default scheduling and a nonpersistent context. Any correctness failure or absent native benefit blocks promotion pending review. This is not a production-UI/p95/native-heap claim. Existing protected origins, profiles and data remain untouched.

No claimed recovery of47.929s or60.50% follows from the profile. The compiler may already optimize the old object accesses, or the new helper's argument passing may cost more. Those are explicit reasons this design can be rejected without expanding its scope.

## 8. Verification and implementation boundary

After a supported external result and the approved inline plan, application implementation is restricted to the two files in section1. Verify exact diffs against the fresh dirty baseline; original Work/migration cases, timeouts and fixtures remain intact. No opcode/brand/cache/helper-framework addition or caller refactor is authorized implicitly.

Run the current core Work/canonical/codec/proof/SHA suites, connected source retention/emission/repository/migration and historical loader/validation regressions, full capability boundary, typecheck and build. Complete the original660-case migration campaign at original limits on the reviewed implementation; report every outcome, with no best-of replacement from cold reruns. Any still-failing original acceptance remains an open blocker, not a green milestone.

Keep the separately established generator encoder-spy failure and Sticker Press TS2339 out of scope; neither test is edited to obtain a green report. Use a unique external build output and keep prior artifacts. No production cutover, existing-profile migration, staging, commit, merge, dependency update or destructive cleanup.

Controller implements inline if later authorized; read-only investigation/review assistance remains allowed. Preserve the original Task11b/batching baselines and allowlists, launcherPID2397595, ports3000/3001, stopped4310/4311 preview and retainedSQLite. Diagnostic browser work uses checked free alternate ports and releases its own resources.

This approved design is a concrete experiment/equivalence contract. The external candidate was tested and rejected under its predeclared screen on2026-09-29. Retain the design and evidence; do not treat written approval as permission to bypass the failed gate. No application runtime optimization, broader-interface redesign or acceptance improvement is claimed.

### Design verification checkpoint

Self-review checked scope, once-only capture, fresh receiver escape/mutation, validation/error order, unchanged guards/counters, and explicit failure/stop criteria. Independent read-only review found no actionable contract gap and judged the spec ready for user review, not implementation acceptance. No candidate code was executed by that review.

External `check-work-operation-design{,.test}.mjs` verifies eight sections, four local links, draft status, required compatibility/gate language and fail-closed audit extension. Five tests passed after intended missing-checker RED failures, including negative document mutations. This is document verification, not proof of runtime equivalence or speed.

The design-only scope audit passed97authorized cumulative paths/51-of81 retained, with unchanged1170-file application stamp, HEAD/empty index/whitespace/protected hashes. The original baselines/allowlists remained untouched. No application suite/build was rerun for that documentation-only work. These draft-checker receipts are historical; subsequent explicit written approval authorized concrete execution planning, not a claim that candidate behavior or speed has been verified.
