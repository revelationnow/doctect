# Bounded Short JSON Token Batching

Date: 2026-09-27
Status: Approved on 2026-09-27. The user explicitly selected “Approve token batching (Recommended)” for this written token-only scope and inline implementation. Comparator and Work-runtime changes remain excluded.

Predecessor: [validation consolidation](../plans/2026-09-27-normalization-validation-consolidation.md). The incremental persistence, bounded normalization, source-admission, workspace-authority and prepared-emission contracts remain binding. No timeout, quantum, schema, authority or production-cutover amendment.

Concrete execution plan: [short JSON token batching](../plans/2026-09-27-short-json-token-batching.md).

## 1. Selected change

Optimize the existing `quoteWork` implementation in `shared/jsonWork.js`. When a primitive string is at most 62 UTF-16 units and needs no JSON escaping, emit its opening quote, body and closing quote as **one existing-format fragment**, at most 64 UTF-16 units. Keep the existing implementation as the fallback for longer strings, strings needing escaping and non-string arguments.

This is batching within one already bounded JSON token, not buffering a document or combining separate producer emissions. It introduces no worker, transport, cache, durable representation, capability, public interface or dependency.

Runtime scope: `shared/jsonWork.js` only. Add focused tests in `tests/unit/localWorkspace/normalized/work.test.ts`; reuse existing canonical/codec/hash/source/repository/migration tests without weakening them. No change to `cooperativeWork.js`, `compareStringsWork`, `equalFrameWork`, `textWork`, JSON byte counters, SHA, validators, record codec, repository, schema or build/test configuration. Declarations and capability grants do not need widening.

Worktree remains `.worktrees/incremental-local-persistence`, branch `feat/incremental-local-persistence`, HEAD `8a2872d9a5acae1be3022923c4c515c70212de83`. Inline controller implementation only; read-only review permitted. Preserve the dirty tree, empty index, original baselines, protected launcher/ports, stopped preview and retained database. No staging, commits, merges, dependency changes, cleanup, deployment or existing-profile migration.

## 2. Investigation and alternatives

The current application stamp is `d5ee878940ba31bf9b67dd17f3747de360dc6ff992fba7c271ada996858887d6` /1170 files. Current application migration acceptance remains634PASS/26timeouts across660 cases; no application source was changed during these probes.

Read-only inspection corrected the initial hypothesis: `equalFrameWork` already compares up to64 code-unit pairs per operation. `compareStringsWork` still performs one operation per pair. Short `quoteWork` strings currently emit separate quote/body/quote fragments; their sinks incur three fragment handoffs and associated hash/comparison dispatch.

1. **Selected: short unescaped token batching.** Clear phase-level benefit and repeatable improvement in the historical wide completion probe; one runtime file, unchanged fragment format and limit.
2. **Defer: 32-pair string-comparison batching.** Preserves exact comparison results and actual compared-unit counts, but showed only small/no consistent gain in the tested phase. It adds conservative reserved visits. Do not bundle it into the selected change merely because its microbenchmark improves.
3. **Do not select: combined comparator/token change or broader Work-runtime rewrite.** The combined probe did not close the wide or32MiB gates. Keeping runtime guards, scheduler and frame cursor untouched narrows the proof obligation. No generator dispatch/cancellation rule is relaxed.

### Measurements and limitations

Fresh130-node verification, separate processes, baseline→comparator→token→combined followed by reverse order; no CPU sampler or retained observer:

| Variant | Verification wall ms, two runs | Visits | Lifecycle checks | Yields |
| --- | --- | ---: | ---: | ---: |
| Existing code | 1780 /1886 | 3649495 | 6197821 | 3652 |
| Comparator only | 1765 /1774 | 3738399 | 5819681 | 3737 |
| Short token only | 1418 /1469 | 3714364 | 5050477 | 3754 |
| Combined | 1363 /1417 | 3803268 | 4672353 | 3843 |

All variants retained candidate/seal rows141/142, compared units417662, emitted bytes905586, hash bytes111862 and one source/target derivation in this phase. Lower operation/guard count is real; reserved visits and yields increase slightly. Do not describe this as fewer safety checks on document validity or a larger Work quantum.

Separate diagnostic copies of the **entire original wide replay body**, including all its fixture construction and assertions, measured completion beyond the unchanged five-second gate:

| Source | Existing code ms | Short token ms |
| --- | --- | --- |
| Fresh | 7790 /7492 | 6183 /10628 |
| Historical | 7317 /7371 | 6251 /6215 |

Historical completion improves about15% in these two comparisons. Fresh measurements include a10628ms candidate outlier; keep it, and do not claim a consistent fresh-path improvement or use a best-of result. The diagnostic copies have separate names and an explicit30s measurement ceiling; original tests remain unchanged at5000ms. These diagnostic passes are **not acceptance passes**.

Legal1MiB historical-padding verification: existing2531ms, token2410ms, combined2582ms, one sample each. This is not a32MiB substitute or a reliable extrapolation. Original wide tests still timed out with both the baseline and combined prototype; the combined prototype's original32MiB test still timed out360000ms (360013ms reported). A token-only full32MiB outcome is not yet established. The selected change is useful but is not claimed to close normalization acceptance alone.

## 3. Exact token eligibility and output

The public `quoteWork(text, emit)` interface remains unchanged. Its new path is eligible only for `typeof text === 'string'` and `text.length <= 62`.

Inspect the eligible string in one bounded Work operation. Return to the existing implementation, with **no output emitted by the probe**, if any of these occur:

- Code unit below U+0020.
- Double quote or backslash.
- A high surrogate without an immediately following low surrogate.
- A low surrogate not consumed as part of a valid pair.

All other code units are emitted unchanged between quotes, including U+2028/U+2029, non-ASCII text and valid surrogate pairs. Empty input emits `""`. No normalization, replacement, locale comparison, key reordering, getter or `toJSON` invocation is added.

For an eligible unescaped string, build exactly `'"' + text + '"'`. Output length is at most64 UTF-16 units and at most188 UTF-8 bytes, within the existing192-byte fragment maximum. No valid surrogate pair is split. Existing fallback handles escaping and longer values exactly as before.

The failed short-string probe may perform extra bounded inspection before the original path. Account that work; do not hide or subtract it. Do not scan long strings speculatively.

## 4. Work, accounting and memory

Keep quantum1024visits/64KiB emitted bytes, frame64UTF16units/max192UTF8bytes, SHA step<=192bytes/600visits, count-only scan127units, AppState32MiB/depth512 and every stage/read/derivation/retry limit unchanged.

For input length `n <= 62`, reserve `4*n + 3` visits for the probe and successful token construction: at most `2*n` code-unit probes plus bounded concatenation traversals of lengths `n+1` and `n+2`. Maximum operation cost is251 visits. This is an explicit conservative reservation, not a claim that every reserved visit was necessarily executed after an early escape rejection.

Calculate actual UTF-8 byte length during inspection: start at2 for the quotes; add1/2/3 for valid BMP code units or4 for a valid surrogate pair. After successful construction, emit the exact byte-accounting Work operation before invoking the existing emitter. Never place an upper-bound byte count in `emittedBytes`, precompute payload work outside its reservation, modify counters afterward to claim savings or bypass the runtime's normal quantum checks.

Return only a boolean from the charged inspection operation; keep token/byte locals private. No unvalidated arbitrary object is returned to the runtime's `.then` probe. Temporary strings are bounded by63/64 units; no source-sized serialized cache, new retained graph, global mutable token cache or additional authority handle.

## 5. Scheduling and error contracts

The emitter may receive one fragment instead of three for eligible strings. Fragment segmentation is intentionally changed; concatenated UTF-16 text and independently encoded UTF-8 bytes must remain identical. No caller is promised quote/body/quote boundaries.

Do not buffer across JSON values, resume a frame producer after emission before its fragment is consumed, modify `frameCursor`/`nextFragment`, or defer producer finalizers. First-mismatch behavior, producer error forwarding, callback exceptions and closing both frame generators remain covered by the existing tests.

The short path reads only immutable primitive-string code units inside its bounded operation. Descriptor checks on document graphs, canonical validation/error ordering and unsupported object behavior remain in their existing owners. Non-string arguments bypass the shortcut rather than receiving new coercion or acceptance rules.

Cancellation before inspection, at the quantum boundary after construction, before byte accounting, during the emitter and at terminal return must prevent later planned output, preserve lifecycle-error precedence and release producer state under the existing rules. No asynchronous work or callbacks are introduced inside IndexedDB transactions. The approved synchronous single-record seal exception remains the same `runSync` interface and limits.

## 6. Required test-first proof

- Short safe strings, including empty/ASCII/multibyte/paired-surrogate input, emit one fragment and fewer actual Work operations than the old implementation. Count operations independently of counters.
- Inputs at61/62/63/64/65 units select the correct path. Exhaustive single UTF-16 units, controls, quotes, backslashes, lone/mixed surrogates and boundary pairs produce exactly native JSON text and identical per-fragment UTF-8 concatenation.
- Every operation stays within1024visits; the new probe stays<=251. Exact emitted byte counts and max64-unit/192-byte output hold for success and fallback. Real runtime cancellation works with nearly exhausted visit and byte quanta.
- Escaped and long strings retain the old fallback's output and refusal behavior. Boxed/string-like arguments must not acquire new coercions/getter effects through the shortcut.
- Emitter throws, cancellation after token construction, malformed foreign fragments, producer recovery/finalizers and first-mismatch tails remain correct in both synchronous and cooperative drivers.
- Canonical/ordered frame bytes, source/target/proof hashes, pinned Sticker Press reconstruction, original fault hooks, independent phases and all existing normalization budgets remain unchanged.

Run focused RED/GREEN first, then existing Work/canonical/codec/proof/SHA/source-retention and affected historical suites, capability checks, typecheck and build. Original wide5000ms and32MiB360000ms cases remain mandatory gates on the actual implementation. Full migration covering verification follows the reviewed source, with no selective substitution of prior passes.

The stale generator `encode`-spy test and known Sticker Press TS2339 are separately recorded baseline issues; this scope does not change either to obtain a green report.

## 7. Diagnostic provenance and implementation gate

All experiments live under `/tmp/opencode/doctect-incremental-sdd`; application runtime/tests/config remain at the stamp above. `json-batching-variants{,.test}.mjs` has nine passing external tests, including exhaustive code-unit output checks and proof that wide measurement copies append without modifying original test definitions. `json-batching-correctness.config.mjs` applied only the selected token variant in memory against the original configuration:485 existing Work/canonical/codec/proof/SHA tests passed, no unhandled/module errors. This is prototype evidence, not an application implementation result.

Artifacts are `task-13-json-batching-<suffix>` directories. `run.json` records the authoritative experimental variant; `phase.json`'s older comparison/quotation flags describe disabled predecessor experiments, not the new `JB_VARIANT`. Phase runs: baseline `l637kx`/`SKkutH`, comparator `RpUfKp`/`BtBTA5`, token `iwnlFA`/`uDnrVy`, combined `Yh34WF`/`Yz9mjy`. Wide original gates: combined `FVF1Ta`, baseline `RhxveC`; original32MiB combined `CjTW7g`. Full-body wide diagnostics: baseline `cxD99e`/`qf7PV9`, token `HSioql`/`HiHHBh`. Legal1MiB: `FYKxCk`/`LRBmQZ`/`Pxi2lt`. Correctness log: `task-13-json-batching-correctness-01.jsonl`.

Fresh pre-change dirty baseline: `task-13-json-batching-baseline/{manifest.json,files/}`. Never rewrite it or original Task11b/other execution baselines. During design review only this spec, its predecessor-plan link and the execution ledger changed in the worktree. Subsequent explicit approval authorized the linked inline test-first plan for the one-runtime-file scope. No broad Work-runtime change, commit or production acceptance follows from prototype results.

Design-review checkpoint: independent read-only review found no contract blocker and one prototype coverage gap: the original1000-visit cancellation preload stopped before construction, not after it. Retained that case and added773-visit and byte-quantum preloads; nine external tests passed. Design audit94paths/51-of81 preserved is a historical receipt, not the current execution checker. After explicit approval, the token-only implementation and48new tests were completed; current application verification is recorded in the linked plan at stamp062de1ac74c376e26effe619bf96d203ff21cd290b9573de1181f1179b49db18. Migration acceptance remains636PASS/24timeouts across660cases, not green.
