# Short JSON Token Batching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. The user approved token-only inline implementation through the written-scope question. No implementation subagents, handoffs, staging or commits; read-only review is allowed. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Emit eligible short JSON strings as one bounded fragment, reducing real dispatch/fragment handoff work while retaining exact text/bytes and existing limits.

**Architecture:** Add one private helper in `shared/jsonWork.js`, used only by the existing `quoteWork` entrypoint for primitive strings of at most62 UTF-16 units. Escape-requiring and long values retain the original path. No comparator, runtime, scheduler, cursor, byte-counter or hash changes.

**Tech Stack:** Existing JavaScript Work generators, TypeScript/Vitest tests, fake-indexeddb and Vite. No dependency changes.

## Global Constraints

- Contract: [short token design](../specs/2026-09-27-short-json-token-batching-design.md), explicitly approved2026-09-27. Keep every predecessor safety/authority/ownership contract.
- Worktree `.worktrees/incremental-local-persistence`, branch `feat/incremental-local-persistence`, HEAD `8a2872d9a5acae1be3022923c4c515c70212de83`; preserve dirty tree and empty index. No staging, commits, merges, dependencies, destructive cleanup, source/sibling edits, deployment or profile migration. Protected launcher/ports/preview database untouched.
- Runtime edit only `shared/jsonWork.js`; tests only `tests/unit/localWorkspace/normalized/work.test.ts`. Documentation: this plan, approved spec, predecessor-plan link and execution ledger. No capability grant/config/declaration/schema change.
- Primitive strings<=62units, no escaping, become one quoted fragment<=64units/188UTF8bytes. Max permitted frame remains64units/192bytes. Preserve Unicode, JSON conversion, ordering, first-mismatch tails and finalization.
- Inspect/construct in a charged operation reserving4*n+3visits<=251. Exact emitted byte count is a separate operation before emitter invocation. Reserve conservatively; never relabel counters or charge speculative output as actual bytes.
- Work quantum1024visits/64KiB; SHA<=192bytes/600visits; count scans127units. AppState32MiB/depth512/history50. Stage64records/256KiB with legal oversized singleton. Success8full-set reads/4derivations, legacy captures5uncontended/2active, retries8. No limit/deadline/assertion/fixture relaxation.
- Fresh byte-exact baseline: `/tmp/opencode/doctect-incremental-sdd/task-13-json-batching-baseline/{manifest.json,files/}`. Starting runtime stampd5ee878940ba31bf9b67dd17f3747de360dc6ff992fba7c271ada996858887d6/1170files. Preserve all previous baselines/artifacts.
- Baseline blockers:660migration cases634PASS/26timeouts including32MiB360s; stale generator encoder-spy test; known Sticker Press TS2339 at793:36. Do not suppress or silently change them.

---

## Task 1: Prove and implement bounded token emission

**Files:** modify `shared/jsonWork.js`, append tests to `tests/unit/localWorkspace/normalized/work.test.ts`.

**Interface:** public `quoteWork(text: string, emit: JsonEmit): Work<void>` unchanged. Private `shortQuotedTokenWork(text, emit)` returns boolean: true after emitting one token, false before any output when fallback is needed.

- [x] **1. Add failing batching, accounting and boundary tests.** Reuse imports/harnesses already present in the Work suite. Observe actual operation and fragment counts.

```ts
it.each(['', 'key', '根'.repeat(62), '😀'.repeat(31)])
('short JSON token batches eligible input %#', text => {
  const parts: string[] = [];
  const program = quoteWork(text, function* (part) { parts.push(part); });
  let operations = 0, visits = 0, bytes = 0;
  for (let step = program.next(); step.done === false; step = program.next(step.value.run())) {
    operations++; visits += step.value.visits; bytes += step.value.utf8Bytes;
    expect(step.value.visits).toBeLessThanOrEqual(251);
  }
  expect(parts).toEqual([JSON.stringify(text)]);
  expect(operations).toBe(2); expect(visits).toBe(4 * text.length + 4);
  expect(bytes).toBe(Buffer.byteLength(JSON.stringify(text)));
});
```

Add exact61/62/63/64/65-unit cases, all65536 individual UTF-16 code units in bounded test groups, escaping/mixed/lone surrogate cases and fragment UTF8 concatenation checks. Assert old quote/body/quote fallback for long, escaped and boxed/string-like arguments, with no new coercion callback.

Cancellation cases use authentic WorkRuntime: preload1000visits to cancel before inspection; preload773visits so construction reaches1024 and cancellation happens before byte accounting; preload1visit/65500bytes so token construction completes but the64-byte charge needs another quantum. Require `AbortError`, exact charged visits/bytes, zero emitter calls and no owned bytes. Keep exact-fit byte-quantum success and emitter failure/cancellation/finalizer cases.

Run `npx vitest run tests/unit/localWorkspace/normalized/work.test.ts --testNamePattern='short JSON token' --maxWorkers=1 --silent=passed-only`. Expected RED: eligible strings produce separate fragments/extra operations and old prefix output appears before cancellation. Do not change existing tests to manufacture a failure or pass.

- [x] **2. Add the private helper and entry guard.** Use the measured prototype, not the deferred comparator variant. The implementation is:

```js
function* shortQuotedTokenWork(text, emit) {
  let fragment, bytes = 2;
  const safe = yield* effect(4 * text.length + 3, () => {
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      if (code < 32 || code === 34 || code === 92) return false;
      if (highSurrogate(code)) {
        if (index + 1 === text.length || !lowSurrogate(text.charCodeAt(index + 1))) return false;
        index++; bytes += 4;
      } else if (lowSurrogate(code)) return false;
      else bytes += code < 128 ? 1 : code < 2048 ? 2 : 3;
    }
    fragment = '"' + text + '"';
    return true;
  });
  if (!safe) return false;
  yield* effect(1, () => {}, bytes);
  yield* emit(fragment);
  return true;
}
```

At the start of existing `quoteWork`, add only:

```js
if (typeof text === 'string' && text.length <= JSON_FRAME_UNITS - 2
  && (yield* shortQuotedTokenWork(text, emit))) return;
```

Keep the entire old body after that guard. Comment the eligibility/fragment bounds and conservative scan/concatenation reservation. No public export or mutable global cache.

- [x] **3. Run GREEN plus original byte/cursor/hash regressions.** Also add source/target frame oracle assertions through actual `digestFrame`, `frameBytesWork` and `equalFrameWork`, comparing native JSON/Node SHA-256 and differently segmented expected fragments. Test first-mismatch tails with real quoted tokens; both producers must finalize without executing either tail.

```ts
const text = 'Aé根😀', expected = JSON.stringify(text);
const frame: Frame = emit => quoteWork(text, emit);
const h = makeWorkHarness();
expect(await digestFrame(frame, h.runtime, 'source'))
  .toBe(createHash('sha256').update(expected).digest('hex'));
expect(await h.runtime.run(frameBytesWork(frame))).toBe(Buffer.byteLength(expected));
expect(await h.runtime.run(equalFrameWork(frame, emit => textWork(expected, emit)))).toBe(true);
expect(h.runtime.snapshot().ownedBytes).toBe(0);
```

Run the complete Work/canonical/codec/proof/SHA group with original configuration and one worker. Request read-only scoped review against the JSON-batching baseline; fix concrete findings test-first. Original producer error forwarding, malformed65-unit fragments and text-fragment exact counters must still pass unchanged.

## Task 2: Verify actual runtime and unchanged acceptance gates

**Files:** documentation/evidence only unless a scoped, reproduced defect requires a test-first correction.

- [x] **1. Freeze reviewed source and collect fresh migration inventory.** Run the original four-derivation and wide physical-parity cases with the existing external case reporter and no timeout overrides. Prototype results are not implementation acceptance.

```sh
npx vitest run tests/unit/localWorkspace/normalized/migration.test.ts --testNamePattern='prepared replay preserves independent physical|five fences and four independent' --maxWorkers=1 --includeTaskLocation --silent=passed-only
```

Run all660 current migration cases via `/tmp/opencode/foundation-batch-runner.mjs` with the fresh `FOUNDATION_INVENTORY`, groups of20, same source stamp throughout. Isolate the original32MiB case using the runner's existing360000ms test ceiling. A shell-interrupted batch is excluded in full and rerun separately; no cherry-picking its passing outcomes.

- [x] **2. Run affected regressions, boundary, typecheck and build.** Keep existing fixtures, source/proof safety tests and original limits.

```sh
npx vitest run tests/unit/localWorkspace/normalized/work.test.ts tests/unit/localWorkspace/canonical.test.ts tests/unit/localWorkspace/normalized/codec.test.ts tests/unit/localWorkspace/normalized/commitProof.test.ts tests/unit/localWorkspace/normalized/incrementalSha256.test.ts tests/unit/localWorkspace/normalized/sourceReads.test.ts tests/unit/localWorkspace/normalized/workspaceAuthority.test.ts tests/unit/localWorkspace/normalized/repository.test.ts --maxWorkers=1 --silent=passed-only
npx vitest run tests/unit/localWorkspace/validation.test.ts tests/unit/localWorkspace/migrationPreparation.test.ts tests/unit/cooperativeLoader.test.ts tests/unit/generatorMetadata.test.ts tests/unit/server/validateAppState.test.js --maxWorkers=1 --silent=passed-only
npx vitest run tests/unit/localWorkspaceBoundary.test.ts --maxWorkers=1 --silent=passed-only
npx tsc --noEmit
TMPDIR=/tmp/opencode npm run build --legacy-peer-deps -- --outDir /tmp/opencode/doctect-incremental-sdd/task-13-short-token-build-01
```

Check external build parent first; never `--emptyOutDir`. Classify the confirmed generator-spy baseline failure and Sticker Press TS2339 without suppressing them. Counts from overlapping commands must not be summed into a single-suite claim.

- [x] **3. Audit and record the precise result.** Require same source stamp, unchanged old test bodies/options, one runtime file, one test file, exact documentation scope, unchanged HEAD/empty index/whitespace/protected hashes. Keep prototype timings and actual application gates separate. Record any remaining timeouts honestly; no production responsiveness, native memory, lifecycle B/C/D or cutover claim. Do not commit or clean up automatically.

## Execution status

Written token-only contract explicitly approved through the user's scope selection. Plan self-review preserves primitive-only eligibility, Unicode fallback, emitted-byte versus reserved-visit distinction, real post-construction cancellation tests and strict one-runtime-file scope. Implementation has not started at this checkpoint.

### Completed token-only implementation and verification

Current runtime/test/config stamp: `062de1ac74c376e26effe619bf96d203ff21cd290b9573de1181f1179b49db18` /1170files. Only `shared/jsonWork.js` and the named Work test file changed in application scope. Comparator, runtime, frame cursor, fallback body, declarations, byte counters, hashing, schema and permissions remain unchanged.

- 48 new cases added. Initial RED:13 intended batching/operation/cancellation/emitter-fragment failures and35 existing-behavior parity passes. After implementation, all245 Work cases pass; complete Work/canonical/codec/proof/SHA command533PASS/5files in22.94s, including pinned Sticker Press and every individual UTF-16 code unit.
- Independent read-only implementation review found no issues. Exact audit removes only the new helper/entry guard and new test block, then compares the remaining full files byte-for-byte with the pre-change snapshot. Both old implementation and old test bodies are preserved.
- Actual migration campaign `task-13-migration-cases-0-660-DSDn3n`: **636PASS/24timeouts/0missing across all660cases**, same source before/after, all37batches complete, no unhandled/module errors or non-timeout assertion failures. Original32MiB still times out360000ms (360009ms reported); original wide cases still exceed5000ms. Four-derivation cold gate passed1493ms. No test deadline, fixture or assertion changed.
- Compared with the prior634/26 campaign, eight previously timed-out cases passed and six previously passing cases timed out. This is **not a controlled speedup or regression attribution**. All six additional timeouts passed individually at original limits in separate campaign `task-13-migration-cases-0-660-T7O7PL` (1328/3047/3018/3786/2823/2144ms). Those reruns remain diagnostic; they do not replace full-campaign failures or produce a best-of642/18 claim.
- Affected historical/loader/AppState regression:364PASS/1confirmed pre-existing generator encoder-spy FAIL across365cases/5files in14.49s. Connected source-retention/workspace-authority/repository/emission suites:186PASS/4files in127.06s. Full boundary945PASS in206.81s. All completed without unhandled/module errors. Logs: `task-13-short-token-{regression,connected,boundary}-01.jsonl`.
- Build `task-13-short-token-build-01` PASS13.87s/2468modules, existing bundle-size warnings only. Final `npx tsc --noEmit` reports only the known Sticker Press TS2339 at793:36. Full typecheck remains non-green; neither baseline issue was suppressed.
- `audit-short-json-token-runtime.mjs` verifies the exact slice and95authorized cumulative paths/51-of81 retained blobs; HEAD/empty index/whitespace/protected hashes intact. `short-token-verification-summary.mjs` validates all660 original case names/options, complete run endings, timeout-only failures and separate cold-rerun provenance. Original baselines/allowlists and previous artifacts remain untouched.

All listed implementation/verification actions are complete; this does **not** close normalization/runtime acceptance. Prototype timing gains remain diagnostic evidence, not browser latency, native memory or release acceptance. No comparator promotion, new runtime architecture, lifecycle B/C/D work, production cutover, existing-profile migration, staging or commit occurred. Remaining24timeouts and the two separately recorded baseline issues stay open.

### User-requested extended completion measurement

The user asked how long the360-second case would take if allowed to finish. A separately named diagnostic copy retained the **complete original32MiB test body and all assertions**, in the same suite, with a900000ms measurement ceiling. Original test/config files and the official360000ms gate were not modified. Three external tooling tests verify exact original-module/body preservation, fail-closed source anchors and parsing with only the added case's timeout changed.

Measured result: **745701.159ms —12min25.7s — all assertions passed**, no unhandled/module errors. Total runner wall time including startup was752354ms. Artifact: `/tmp/opencode/doctect-incremental-sdd/task-13-extended-32mib-x88iUw/{summary.json,cases.jsonl,vitest.log}`. Driver/config/tools: `run-extended-32mib.mjs`, `extended-32mib.config.mjs`, `extended-32mib-tools{,.test}.mjs` in the artifact directory. Before/after application stamp remains062de1ac74c376e26effe619bf96d203ff21cd290b9573de1181f1179b49db18/1170files.

This single measurement is about2.07times the official limit; meeting360s would require about52% less total test time relative to this run. It includes setup, normalization, active export/readback and separate oversized-source rejection—not one ordinary edit/save or a separately measured single startup. Other23 timeouts use5000ms limits and were not extended in this diagnostic. Official acceptance remains636PASS/24timeouts; this result is not substituted into that campaign.

User approved the next [full-size attribution/native comparison](2026-09-28-full-size-normalization-diagnosis.md). That milestone is diagnostic only; no further micro-optimization or official deadline change is included.
