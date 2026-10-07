# Full-Size Normalization Diagnosis

Status: User approved the diagnostic milestone: attribute the complete32MiB workflow, compare with a fresh browser worker/native IndexedDB, then recommend one measured next change. No application optimization or acceptance-budget amendment authorized by this plan.

## Baseline and isolation

- Worktree `.worktrees/incremental-local-persistence`, branch `feat/incremental-local-persistence`, HEAD8a2872d9a5acae1be3022923c4c515c70212de83. Runtime/test/config stamp062de1ac74c376e26effe619bf96d203ff21cd290b9573de1181f1179b49db18/1170files.
- Current official campaign636PASS/24timeouts; original32MiB gate remains360s. A separate uninstrumented diagnostic completed745701ms with all assertions passing under900s. Artifact `task-13-extended-32mib-x88iUw`.
- No runtime, application-test, schema, protocol, config, dependency, staging, commit, migration or production-cutover change. External diagnostic tools/builds/artifacts only under `/tmp/opencode`; documentation updates limited to this plan, predecessor link and untracked execution ledger.
- Preserve launcherPID2397595, ports3000/3001, stopped4310/4311 preview and retainedSQLite. Browser uses a checked free alternate loopback port, fresh nonpersistent context, real module worker and no backend/network access outside its diagnostic origin. Never open an existing profile.
- Full fixtures, original assertions and all Work/read/hash/frame/stage limits remain. Extended diagnostic ceiling900s is not an acceptance pass. Do not minimise the requested32MiB workload; small smoke scenarios validate only the tools.

## Ranked hypotheses and distinguishing evidence

1. CPU traversal/hash/reconstruction dominates: high work-active/synchronous time in both platforms, with matching work and payload facts.
2. Scheduler overhead dominates: cumulative awaited yield time explains substantial wall time; compare actual defaults rather than substituting an immediate yield.
3. Fake-IDB/clone overhead dominates: native database/clone portions materially shrink while logical work stays comparable.
4. Test composition dominates: setup, explicit synchronous validation, export/readback or oversized-input rejection outweigh main normalization.

Do not infer a database-only cause from a Node-versus-browser difference: V8/runtime, module loading, assertion wrapper and backend can also differ. Do not sum nested inclusive spans or overlapping transaction/request times.

## Measurement design

- Derive the stress body from the actual current `migration.test.ts` case. Add coarse checkpoints without removing/reordering application calls, fixture construction or assertions. Node executes it in its original suite with Vitest.
- Browser uses that same derived body and the actual `createNormalizationHarness` function body, with platform plumbing for native IndexedDB isolation and native crypto. Reuse the existing pure fixture module and application modules; do not substitute a simplified project or alternate normalizer.
- Use the same Vitest matcher implementation in the browser through standalone `@vitest/expect`/Chai where supported. Record assertion and setup work separately. Verify the browser harness's small fixture against the original Node harness before a full run.
- Native factory wrappers may map the fixed logical DB name into two unique physical names for valid/invalid fixtures. Records, stores, keys and versions remain identical; application code continues receiving the fixed logical name. Fresh browser-context disposal owns cleanup.
- Instrument only external builds/in-memory transforms. Timers cover high-level disjoint stages; nested repository operation, source derivation, capture, target derivation and seal spans are explicitly inclusive.
- Keep default Work scheduling/guards/counters. Aggregate yield wait, async Work-active wall, synchronous Work time and final numeric Work counters; never retain per-operation events or payloads. CPU process time is Node-only unless worker profiler support is available. State unsupported metrics as unavailable.
- Wrap native clone calls and IndexedDB operations passively, without examining payloads. Transaction wall time includes synchronous seal CPU and is not pure I/O wait; request intervals can overlap. Do not add hashing/yields inside transactions.
- Record matched fixture/state facts and existing derived result identity to verify comparable input/output. Avoid an extra full-payload measurement walk inside timed application phases. No content/credentials in progress logs.
- Sample CPU only after wall-time tooling is validated; use modest sampling frequency and report profiler overhead/limitations. Native heap sampling is optional and is not ownership-counter proof.

## Execution and verification

- [x] Build external collector/source transforms/platform harness and tests. Test exact-body preservation, source-anchor failure, counter aggregation, clone/transaction cleanup and both assertion drivers. Smoke test Node and native worker with small original fixtures.
- [x] Run the complete instrumented Node/fake-IDB workflow serially, with all assertions and900s ceiling. Compare with745701ms uninstrumented baseline; classify instrumentation overhead rather than claiming a regression.
- [x] Run the same full workflow in a fresh native browser worker, serially with no competing controller benchmark. Record completed/partial outcome, phase times, work facts and supported CPU/clone/database evidence.
- [x] Independently review comparability and interpretation. Deliver a phase timing table, native-versus-test comparison, limitations and one evidence-backed recommendation. No new optimization without a separate scope decision.
- [x] Verify unchanged application stamp, HEAD/index/whitespace/protected scope; retain artifacts and update ledger. Do not rerun the entire application suite for documentation/external-tool changes, and do not relabel official acceptance from diagnostic outcomes.

## Results: full-size matched workflow

Both full diagnostic runs completed with every original assertion passing. Application/runtime/test/config stamp remained062de1ac74c376e26effe619bf96d203ff21cd290b9573de1181f1179b49db18/1170files. Native run used fresh Chromium143.0.7499.4, dedicated module worker and real IndexedDB at an isolated4320 origin; no existing browser profile, backend or application page was opened.

| Disjoint workflow stage | Node / fake IndexedDB | Browser worker / native IndexedDB |
| --- | ---: | ---: |
| Main normalization | 314.575s | 378.390s |
| Active export/readback | 95.328s | 111.863s |
| Oversized-input normalization refusal | 9.763s | 12.111s |
| Setup, explicit validation, assertions, writes and cleanup | 5.330s | 5.962s |
| **Complete diagnostic workflow** | **424.996s (7m05s)** | **508.326s (8m28s)** |

Normalization plus active export account for about96.4% of total time in both runs. The fixture/assertion harness is not the dominant cost. Native IndexedDB does not remove the multi-minute behavior.

### Main-normalization phase breakdown

These session intervals are successive phases within main normalization, not additional costs to add to that total. Small residual time covers discovery, legacy fences and publication.

| Session phase | Node | Native worker |
| --- | ---: | ---: |
| Prepare | 35.559s | 54.691s |
| Reserve | 8.520s | 7.617s |
| Stage, three batches | 0.135s | 0.495s |
| Verify | 80.902s | 101.928s |
| Activate | 95.297s | 105.996s |
| Reopen for publication | 94.030s | 107.510s |

Staging writes are already inexpensive here. The dominant phases are independent verification, activation and reopening, including the separate export's fresh reopening.

### Processing and scheduling evidence

| Whole-workflow aggregate | Node | Native worker |
| --- | ---: | ---: |
| Awaited Work-yield intervals | 62.534s | 152.850s |
| Async Work-loop wall time excluding its measured yields | 296.065s | 276.640s |
| Outermost synchronous Work wall time | 62.518s | 72.708s |
| JS-visible structuredClone duration | 4.953s | 1.739s |
| Number of Work yields | 17,014,820 | 17,014,820 |

The native-versus-Node yield-time difference is90.3s, larger than the83.3s total difference. Do not attribute the latter to a database penalty. Yield intervals include scheduling/descheduling/GC activity while awaiting resumption; they are not necessarily pure idle time. Browser Work-active/synchronous measurements are wall-time proxies, not process CPU measurements. Node process CPU was432.031s, including runtime/background threads; it can exceed wall time.

In native main normalization, `deriveTarget` spans total248.935s, **including**140.956s in captured-source derivation. Do not add those values. The target-hash span includes lazy target production, validation/framing, encoding/comparison, hashing and yields—not pure SHA compression. Existing target hashing/comparison already share expected fragments; that optimization is not missing.

Native main-normalization seals total54.618s, including53.209s synchronous Work. Export's seal takes15.843s, including15.524s synchronous Work. Transaction wall time therefore largely overlaps application comparison work; it cannot be summed as separate I/O wait. The global clone hook also cannot see native IndexedDB's internal cloning, unlike some fake-IDB internals.

### Matched data and logical work

Small smoke runs first passed in both environments with matching source identity and work facts. Full runs also matched the existing derived source/generation identity and all compared logical-work fields:

- Reserved/logical visits:16,250,518,197. These are not hardware instructions.
- Cumulative byte accounting:4,397,071,730bytes. This includes repeated sizing/framing/accounting; it is not disk writes, unique payload size or retained heap.
- Hash input:503,694,259bytes, split into335,722,667source bytes,167,793,890target bytes and other small domains.
- Candidate rows93 /369,226,562 logical bytes; sealed rows94 /302,113,926 measured bytes.
- Seven completed source derivations, five completed target derivations, six legacy captures/72reads across the **whole workflow**, including initial exports, main normalization, export and refusal. Main normalization itself remains four source/four target derivations. Failed derivation attempts can traverse data before the success counter increments.

Observed transaction counts differ271versus267 because fake IndexedDB exposes four upgrade transactions through the JavaScript `transaction` method hook, while native upgrades do not. This observation difference is not a different application workload. Native fallback environment-hash calls were0; no different browser hash implementation was used by this scenario.

## Interpretation and recommended next change

The supported conclusion is **large-record application processing plus scheduling overhead**, not a fake-IndexedDB-only problem or costly test assertions. Directly observed cloning is not the dominant measured bucket, although internal native cloning and downstream allocation/GC are not separately resolved.

**Recommendation: design and prototype one dedicated bounded large-record processing path, rather than another short-string micro-optimization or a storage-backend rewrite.** Target remaining phase-local scanning/framing/counting and general generator/operation handoffs in the verification/reopen path. Where equivalence is proved, share work within the same captured phase rather than serializing/scanning the same large value again for separate consumers. Preserve every independent phase, fresh seal, source/current-authority distinction, exact byte grammar and1024visit/64KiB/64unit contract. No cross-phase cache, trusted-caller shortcut, larger quantum or skipped validation.

This is a measured subsystem recommendation, **not a proven algorithm or promised speedup**. Before implementation, identify the exact shareable traversal/operation sequence; existing target hash/comparison tee must not be re-proposed. A candidate must demonstrate real full-size improvement with equivalent outputs/accounting/cancellation, not merely fewer bookkeeping calls. Exclusive CPU/GC versus dispatch attribution and a controlled before/after remain necessary to choose and validate that concrete candidate.

Do not raise the official360s gate to call this complete. Both instrumented full workflows still exceed it. The prior uninstrumented745.701s versus current instrumented424.996s is an unpaired comparison: timing variability and instrumentation/JIT effects are unresolved. Per-yield timing touches17million boundaries; matching counters proves workload equivalence, not timing neutrality. No improvement/regression percentage is inferred from that difference.

## Verification, review and artifacts

- Seven external tooling tests pass: original statement/assertion preservation, source-anchor failure, browser helper reuse, parsing, unchanged Work limits/scheduler/guards, numeric aggregation, nested synchronous timing, clone and transaction observer restoration.
- Independent read-only review found no high-severity comparability/correctness defect. It confirmed the subsystem recommendation while requiring the overlap, visibility, counter and uncalibrated-instrumentation qualifications recorded above. No application fix was reviewed or implemented.
- Node full: `/tmp/opencode/doctect-incremental-sdd/task-13-fullsize-node-xybRKu/`.
- Native full: `/tmp/opencode/doctect-incremental-sdd/task-13-fullsize-native-full-RAeOzK/`.
- Matched comparison: `task-13-fullsize-comparison-01.json`; smoke comparison: `task-13-fullsize-smoke-comparison-01.json`.
- Smoke artifacts: `task-13-fullsize-node-Ui2Yz5`, `task-13-fullsize-native-smoke-h5pQWr`.
- Tools: `fullsize-{collector,tools}.mjs`, `fullsize-tools.test.mjs`, `fullsize-node-setup.mjs`, `fullsize-node.config.mjs`, `run-fullsize-node.mjs`, `fullsize-worker.ts`, `fullsize-native-entry.ts`, `run-fullsize-native.mjs`, `compare-fullsize.mjs`, `fullsize-span-summary.mjs`. All remain external and clearly diagnostic.
- CPU sampling and browser heap/process-CPU collection were intentionally absent from these wall-time runs. No native heap, p95/INP, production UI or release-acceptance claim.

Official application acceptance remains636PASS/24timeouts. No runtime/test/config change, new optimization, dependency update, commit, deployment or existing-profile migration occurred.

Final diagnostic verification: seven external tool tests pass; matched full-workflow comparison checks identity and every listed logical-work fact. `audit-fullsize-diagnosis.mjs` passes96authorized cumulative paths/51-of81 retained, unchanged1170-file application stamp, HEAD/empty index/whitespace/protected hashes intact. Ports4320/4321 are released, stopped4310/4311 preview remains stopped, protected launcherPID2397595 remains alive (not a health check). Application suites/build were not rerun for these documentation/external-tool changes; the isolated worker diagnostic bundle built and executed successfully.

## Follow-up: bounded prototype screening and CPU attribution

Status: External prototype screening and the full-size Node CPU profile are complete. The user authorized continuing the investigation; no application prototype is selected or promoted. Runtime design approval remains a separate gate.

Three isolated alternatives have now been screened: bounded native ASCII counting, a reusable bounded hash-encoding buffer, and fewer frame-cursor generator handoffs. Their small-kernel gains are not enough evidence to change the application. The reusable-buffer full pair completed at411.131s baseline versus438.079s candidate. The subsequent flat-cursor full pair completed at451.770s baseline versus480.283s candidate, both with the original assertions passing. These single pairs do not establish causal regressions; they do not demonstrate a benefit either.

The next diagnostic step closes the CPU-attribution gap identified above rather than attempting a fourth speculative optimization:

- [x] Recheck the unchanged application stamp and protected worktree; rerun all23external prototype/attribution tests and a cursor smoke run.
- [x] Run a fresh, serial full-size cursor baseline/candidate pair under the existing900s diagnostic ceiling. Keep the original360s acceptance gate untouched.
- [x] Check cursor logical-work parity across all recorded runtime/phase counters; preserve prior alternatives' measurements. Comparison `task-13-bulk-cursor-comparison-02.json` passes exact identity/recorded-work checks and discloses filtered phase coverage. Hash-buffer prototype explicitly adds192reserved visits/bytes of scratch per digest and changes some yields; it is not operation-stream-equivalent.
- [x] Add tested external Node inspector tooling, sampling the unchanged full workload at a10ms interval. Reuse the existing derived stress body, phase instrumentation and default scheduling. Report sample-weighted self time separately from overlapping inclusive stacks; do not equate samples with exact CPU instruction counts or native-worker behavior. Six new tooling tests passed after intended missing-helper RED failures. Profiler smoke `task-13-fullsize-cpu-b5kcID` passes with a253-sample profile.
- [x] Smoke-test the profiler, then run one complete baseline profile with all original assertions. Compare its identity/work facts with the unprofiled baseline and disclose timing/instrumentation limitations.
- [x] Review the evidence and update this plan and the ledger. Recommend the next architectural investigation or design; do not implement an unsupported optimization.

All profiler code, configurations, tests, raw profiles and summaries remain under `/tmp/opencode`. Only this existing plan and the untracked ledger may change in the execution worktree. No application build/full acceptance rerun is warranted for these documentation/external-tool changes.

### Screening results: no candidate promoted

| External candidate | Isolated32MiB kernel observations | Complete original workflow |
| --- | --- | --- |
| Bounded ASCII quote-byte counting | Baseline805.9/837.7ms; candidate753.8/717.7ms. Same operation trace,134,481,931visits/132,104yields. | Not measured; modest kernel gain alone is insufficient. |
| Reusable192-byte hash encoding buffer, with interleaving lease/fallback | Baseline3991.6/4286.8ms; candidate3641.1/3607.4ms. Exact digest/byte semantics; explicit+192allocation visits and352→544scratch highwater per isolated digest. | Baseline411.131s; candidate438.079s. Original assertions pass;18additional Work yields in the complete candidate. No demonstrated benefit. |
| Flat frame-cursor generator handoffs | Sync baseline2356.3/2113.5ms; candidate2002.2/1836.6ms. Work baseline3817.9/3704.9ms; candidate3538.3/3588.7ms. Exact270,532,612visits/314,572yields in Work micro. | Baseline451.770s; candidate480.283s. Original assertions pass; all recorded runtime/phase counters and derived identity match exactly. No demonstrated benefit. |

Microbenchmarks use ABBA ordering but only two observations per variant. Complete-workflow pairs use separate serial processes in baseline-then-candidate order, one pair per candidate; they are not randomized/repeated estimates. Do not claim a6–7% causal regression from those observations or combine the two baselines into a controlled trend. All artifacts, including slower observations, remain retained. No candidate changed the application source stamp.

The hash prototype initially failed an interleaved-emitter test: one scratch buffer could overwrite an earlier fragment before it was hashed. The external revision holds a per-emission scratch lease through immediate encoding/hash consumption and falls back to the original allocation while that lease is busy. The table uses this guarded revision, not the earlier faster but incorrect variant. Its optional prefix-length hash interface and increased ownership require additional compatibility work if ever reconsidered; they were not added to the application.

### Full-size Node profile

The unchanged baseline completed the instrumented workflow in442.915s; the Vitest case took443.700s including profiler setup/export/summary work. All original assertions pass, and `task-13-fullsize-cpu-comparison-02.json` proves exact source identity and parity of all recorded runtime/phase counters with the fresh451.770s unprofiled baseline. The difference is **not** a speedup or measured profiler overhead; order/load/JIT/GC variability remains uncontrolled.

Counter-coverage limitation: the existing collector retains phase entries only when visits, candidateRows or hashBytes are nonzero. Check-only/abort-only phases can therefore be absent from the phase breakdown, while full runtime totals still contain their contributions. In these three reports, export has3checks and refusal has9checks/1observedAbort outside the recorded phase entries. Equality of the recorded structures is not proof that every omitted phase has equal attribution. Version02 comparison receipts disclose this explicitly; version01 receipts remain retained, with their `exactWorkParity` field limited to recorded data.

The inspector requested10,000microsecond sampling and collected44,569samples over443.054s. Below are disjoint **sample-weighted self** categories, not exact process CPU durations. Profile time includes a small amount of setup/report-export outside the collector's workflow window.

| Sample category | Weighted self time | Share of sampled intervals |
| --- | ---: | ---: |
| `shared/cooperativeWork.js` | 142.079s | 32.07% |
| `shared/jsonWork.js` | 125.961s | 28.43% |
| Other application modules | 59.754s | 13.49% |
| Unattributed/native frames | 45.401s | 10.25% |
| Node internals | 22.401s | 5.06% |
| SHA implementation | 18.515s | 4.18% |
| Canonical hashing wrapper | 12.937s | 2.92% |
| Idle | 8.884s | 2.01% |
| Explicit GC samples | 6.631s | 1.50% |
| External diagnostic module | 0.394s | 0.09% |
| Dependency modules | 0.097s | 0.02% |

The diagnostic-module category does not isolate all instrumentation overhead: injected timing/wrappers execute under application-module locations, and native/inlined work can be attributed to callers. The small GC category does not prove negligible allocation cost, background collection or browser heap use. Native IndexedDB internals and other process threads are outside this isolate profile. No native-worker CPU profile was collected in this continuation.

Notable named self samples: `operationFields`47.929s, asynchronous Work execution41.629s, SHA `compress`18.483s, `quoteWork`15.858s, lifecycle `assertCurrent`14.764s, synchronous Work execution11.618s, `equalFrameWork`9.595s, and `nextFragment`5.385s. Inclusive values in the raw summary overlap and must not be added. Locations are Vite-transformed/instrumented script coordinates, not original source lines.

### Next design decision

**Recommendation: investigate a deeper Work execution module at the producer/executor seam, before another runtime prototype.** The measured runtime/JSON pair accounts for60.50% of self samples, and operation validation/capture is a larger named hotspot than the cursor handoff just tested. This is stronger evidence for where to design, not a demonstrated replacement algorithm or a promise that60% can be removed.

The next design must compare these approaches:

1. **Execution-interface redesign (recommended design focus):** determine whether operation construction, field capture/validation and delivery can do less work while retaining their observable contract. `operationFields` currently captures each field once before budget checks and execution. Getters, mutation during suspension, the receiver used for `run`, thenable rejection, application-error forwarding and latched cancellation must be explicitly modeled. Do not replace this with a trusted-caller flag, stale validation cache or skipped guards.
2. **Phase-local traversal sharing:** potentially larger algorithmic savings, but no additional exactly redundant traversal has been proved. Preserve original/wrapper/loaded-state checks, clone/loader ordering and independent prepare/verify/activate/reopen captures. The existing target hash/comparison tee is not new work to discover.
3. **Continue isolated kernel tweaks:** lowest interface risk, but the tested micro-to-workflow mismatch makes this the least justified use of another implementation cycle. Do not promote the ASCII/encoding/cursor variants solely from their small-kernel gains.

No choice may enlarge1024visit/64KiB quanta or64-unit fragments, remove fresh seals/independent phases, reinterpret existing counters, or weaken the original acceptance gates. A specific interface/equivalence argument and a representative whole-workflow experiment must precede any application implementation. This report requests that architectural design decision; it does not authorize or contain a fourth fix.

### Follow-up artifacts

All paths below are relative to `/tmp/opencode/doctect-incremental-sdd/`:

- ASCII micro: `task-13-bulk-ascii-micro-x5Mafc/report.json`.
- Guarded hash micro: `task-13-bulk-hash-micro-HKEEIY/report.json`; full pair `task-13-bulk-hash-baseline-n0lfAy/`, `task-13-bulk-hash-reusable-9vBjA3/`.
- Cursor micro: `task-13-bulk-cursor-micro-ZRGaSb/report.json`; full pair `task-13-bulk-cursor-baseline-QhYpyO/`, `task-13-bulk-cursor-flat-cursor-yXT033/`; recorded-work comparison `task-13-bulk-cursor-comparison-02.json`; smoke `task-13-bulk-cursor-flat-cursor-U1cpwZ/`.
- Full baseline CPU profile: `task-13-fullsize-cpu-CCt5bM/{workflow.cpuprofile,cpu-summary.json,report.json,run.json,cases.jsonl}`; recorded-work parity `task-13-fullsize-cpu-comparison-02.json`; smoke `task-13-fullsize-cpu-b5kcID/`.
- External CPU tools: `fullsize-cpu-tools{,.test}.mjs`, `fullsize-cpu-setup.mjs`, `fullsize-cpu.config.mjs`, `run-fullsize-cpu.mjs`, `compare-bulk-runs.mjs`. Six tests cover exact body preservation, weighted/recursive accounting, malformed profiles, real-isolate capture, inspector cleanup and recorded-counter parity/coverage disclosure.

Independent read-only review reproduced the raw profile summary exactly and confirmed the qualified Work-interface design recommendation. One P2 reporting overstatement about complete phase coverage was corrected above and in the comparison receipt metadata; no underlying workload/profiler defect was found. The focused metadata regression first failed as intended; final all29external checks and both version02 comparisons pass. Cumulative scope audit remains96authorized paths/51-of81 retained, HEAD/empty index/whitespace/protected hashes intact; no diagnostic test/browser processes remain and4310/4311/4320/4321 are not listening.

Official acceptance remains636PASS/24timeouts. Application/runtime/test/config files remain at062de1ac74c376e26effe619bf96d203ff21cd290b9573de1181f1179b49db18/1170files. No commit, staging, dependency change, production cutover or existing-profile migration.

## Successor design, not implementation

The user approved preparing, then explicitly approved the written [Work operation capture and scalar dispatch](../specs/2026-09-28-work-operation-dispatch-design.md) design. It specifies once-only field capture into locals, unchanged ordered validation and late construction of the same fresh callback receiver. Receiver reuse, descriptor aliasing and prevalidated/brand shortcuts are excluded. The [concrete inline plan](2026-09-28-work-operation-dispatch.md) defines characterization, the external candidate, complete-phase ABBA/original/native gates and conditional two-file promotion.

On2026-09-29 the authorized external experiment passed90compatibility and623core cases per variant, five negative controls and complete-phase smoke parity. FullABBA baseline/candidate/candidate/baseline measured468.957/427.927/434.658/432.275s with exact identity and all5-runtime/11-phase/44-counter parity. Baseline median450.616s versus candidate431.292s gives4.288%reduction, below required10%; second candidate also lost its matched pair. Candidate rejected, no outlier replacement or retry. `task-13-work-dispatch-01/rejection.json` retains complete evidence. Original360s/5s gates and native confirmation were not run; application source remains unchanged, official636PASS/24timeouts remains, and no optimization was promoted. This engineering-screen rejection is not causal proof of a speedup or regression. Another optimization needs a separate scope decision.
