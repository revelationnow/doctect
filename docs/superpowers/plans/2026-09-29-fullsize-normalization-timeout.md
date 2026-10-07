# Full-Size Normalization Timeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Inline implementation is already approved; no implementation subagents, staging or commits. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the existing full32MiB acceptance test ten minutes while preserving every correctness assertion and other timeout.

**Architecture:** Change one test timeout literal. Preserve the historical external campaign runner and derive a versioned copy differing only in its full-size process ceiling and evidence prefix. Run the real test without instrumentation or runtime overlays.

**Tech Stack:** Existing Node22, Vitest4, Vite6, Node test runner and per-case reporter. No new dependency.

**Spec:** [Approved timeout amendment](../specs/2026-09-29-fullsize-normalization-timeout-design.md). User approved writing this plan and immediate inline implementation; no additional execution-mode handoff.

## Global Constraints

- Workdir `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence`; HEAD `8a2872d9a5acae1be3022923c4c515c70212de83`; preserve dirty predecessors and empty index.
- Starting application/test/config stamp `062de1ac74c376e26effe619bf96d203ff21cd290b9573de1181f1179b49db18`/1170files. A changed test means a new stamp, not a runtime optimization.
- Named32MiB case only:360000→600000ms. All other test bodies, fixtures, assertions, defaults5000ms, runtime and config unchanged.
- Versioned runner: full-size process430000→670000ms; other processes180000ms; child cleanup5000ms unchanged. Preserve historical runner and receipts.
- No rejected scalar promotion, profiling, global timeout override, repeated attempts seeking a pass, production cutover, existing-profile migration, commits, dependency changes or destructive cleanup.
- Preserve launcher2397595, ports3000/3001, stopped4310/4311 preview, retained SQLite and protected sibling. Use `apply_patch`; verify artifact parent with `ls -d` before creating outputs.

## File Map

- Modify only timeout in `tests/unit/localWorkspace/normalized/migration.test.ts`.
- Add amendment pointer to `docs/superpowers/specs/2026-09-16-bounded-normalization-design.md`; update this plan, new amendment and untracked `.superpowers/sdd/progress.md` with results.
- External prefix `D=/tmp/opencode/doctect-incremental-sdd`:
  - `fullsize-timeout.test.mjs`: exact one-literal diff, runner derivation, selection/coverage and unchanged config checks.
  - `foundation-batch-runner-10m.mjs`: complete predecessor runner with exactly two approved substitutions.
  - `fullsize-timeout-case-names.json`: exact selected case, no fixture substitution.
  - `task-13-fullsize-timeout-baseline/`: immutable dirty-tree snapshot.
  - `task-13-migration-10m-cases-*`: unique source-stamped test receipts.
  - `task-13-fullsize-timeout-build-01/`: unique production build output.

### Task 1: Amend and Verify the Full-Size Deadline

**Interfaces:** Existing runner exports `exactPattern(names)` and `summarize(inventory, events)`; command line accepts numeric inventory range/batch size, with `FOUNDATION_CASE_NAMES` selecting exact names. Consume original660-case inventory, not any appended diagnostic661-case inventory.

- [x] **Step 1: Snapshot current dirty files.** Run with the execution workdir:

```bash
ls -d /tmp/opencode/doctect-incremental-sdd
node /tmp/opencode/doctect-incremental-sdd/review-artifacts.mjs snapshot task-13-fullsize-timeout
```

Output must be newly created, never replaced.

- [x] **Step 2: Write and run these external regression checks before editing the test/runner.** Save as `D/fullsize-timeout.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';
const root = '/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence';
const d = '/tmp/opencode/doctect-incremental-sdd';
const testPath = 'tests/unit/localWorkspace/normalized/migration.test.ts';
const read = path => readFileSync(path, 'utf8');
const baseline = path => read(`${d}/task-13-fullsize-timeout-baseline/files/${path}`);
const runner = `${d}/foundation-batch-runner-10m.mjs`;
const oldDeadline = '  }, 360_000); // Real maximum-size bulk path, not the ordinary-save performance budget.';
test('only the full32MiB deadline changes to 600000ms', () => {
  const before = baseline(testPath);
  assert.equal(before.split(oldDeadline).length, 2);
  assert.ok(read(`${root}/${testPath}`) === before.replace(oldDeadline, oldDeadline.replace('360_000', '600_000')),
    'Expected exactly the named deadline change from 360_000 to 600_000');
});
test('versioned runner changes only full-size process ceiling and evidence prefix', () => {
  assert.ok(existsSync(runner), 'Versioned runner missing');
  const before = read('/tmp/opencode/foundation-batch-runner.mjs');
  const ceiling = 'group.some(row => /32MiB/.test(row.name)) ? 430_000 : 180_000';
  assert.equal(before.split(ceiling).length, 2);
  assert.equal(before.split('task-13-migration-cases-${from}-${to}-').length, 2);
  assert.equal(read(runner), before.replace(ceiling, ceiling.replace('430_000', '670_000'))
    .replace('task-13-migration-cases-${from}-${to}-', 'task-13-migration-10m-cases-${from}-${to}-'));
});
test('versioned runner retains exact selection and honest incomplete coverage', async () => {
  assert.ok(existsSync(runner), 'Versioned runner missing');
  const { exactPattern, summarize } = await import(runner);
  const expression = new RegExp(exactPattern(['suite literal [x]', 'a.b (c)']));
  assert.ok(expression.test('a.b (c)')); assert.ok(!expression.test('aZb c'));
  const result = summarize(['a', 'b', 'c', 'd'].map(id => ({ id })), [
    { kind: 'result', id: 'a', state: 'passed' }, { kind: 'result', id: 'b', state: 'failed' },
    { kind: 'result', id: 'c', state: 'skipped' },
  ]);
  assert.deepEqual([result.passed.length, result.failed.length, result.skipped.length, result.missing.length], [1, 1, 1, 1]);
  assert.equal(result.allPassed, false); assert.equal(result.complete, false);
});
test('repository configuration does not introduce a global timeout override', () => {
  assert.doesNotMatch(read(`${root}/vite.config.ts`), /testTimeout\s*:/);
});
```

Run `node --test /tmp/opencode/doctect-incremental-sdd/fullsize-timeout.test.mjs`. Expected3RED: old360000ms and missing versioned runner. Global default check should pass. Preserve output; syntax/import failures are not the intended RED.

- [x] **Step 3: Apply the minimal change and versioned runner using `apply_patch`.** Test diff:

```diff
-  }, 360_000); // Real maximum-size bulk path, not the ordinary-save performance budget.
+  }, 600_000); // Real maximum-size bulk path, not the ordinary-save performance budget.
```

Add the complete `/tmp/opencode/foundation-batch-runner.mjs` contents as `D/foundation-batch-runner-10m.mjs`, preserving every byte except these substitutions:

```diff
-  const output = mkdtempSync(`${evidenceRoot}/task-13-migration-cases-${from}-${to}-`);
+  const output = mkdtempSync(`${evidenceRoot}/task-13-migration-10m-cases-${from}-${to}-`);
-    group.some(row => /32MiB/.test(row.name)) ? 430_000 : 180_000);
+    group.some(row => /32MiB/.test(row.name)) ? 670_000 : 180_000);
```

Create `D/fullsize-timeout-case-names.json`:

```json
["adversarial normalization acceptance normalization preserves original 32MiB state boundary and refuses one extra UTF-8 byte"]
```

Add a short binding-spec paragraph linking the approved amendment: only the named case now uses600000ms; other budgets remain. Do not rewrite historical measurements or rejected candidate requirements.

- [x] **Step 4: Run focused checks, then the real case once.** First command must pass4new checks plus existing reporter/runner checks. Verify the660-case source inventory exists before the long command. The long command needs720000ms Bash allowance:

```bash
node --test /tmp/opencode/doctect-incremental-sdd/fullsize-timeout.test.mjs /tmp/opencode/foundation-batch-runner.test.mjs /tmp/opencode/foundation-case-reporter.test.mjs
FOUNDATION_INVENTORY=/tmp/opencode/doctect-incremental-sdd/task-13-migration-cases-0-660-DSDn3n/0-events.jsonl FOUNDATION_CASE_NAMES=/tmp/opencode/doctect-incremental-sdd/fullsize-timeout-case-names.json node /tmp/opencode/doctect-incremental-sdd/foundation-batch-runner-10m.mjs 0 660 20
```

Require exactly one selected result, terminal reporter event, no module/unhandled errors, complete source-stamped run and unchanged before/after stamp. If timeout/failure occurs, retain it; do not retry or increase600000ms. This is new policy acceptance, not a speedup or a full660-case campaign.

- [x] **Step 5: Build, review scope and record the observed result.** Run build independently even if focused acceptance failed:

```bash
ls -d /tmp/opencode/doctect-incremental-sdd
test ! -e /tmp/opencode/doctect-incremental-sdd/task-13-fullsize-timeout-build-01
TMPDIR=/tmp/opencode npm run build --legacy-peer-deps -- --outDir /tmp/opencode/doctect-incremental-sdd/task-13-fullsize-timeout-build-01
node /tmp/opencode/doctect-incremental-sdd/review-artifacts.mjs package task-13-fullsize-timeout task-13-fullsize-timeout-review-01
git diff --check
git diff --cached --quiet
```

Inspect exact review slice: one test literal and approved documentation only. Record original636/24 as historical, new isolated result separately, new source stamp, checks/build and limitations. Preserve all artifacts; no commit or further optimization.

## Self-Review

All spec requirements map to this single task. No runtime/API change or new library. Numeric limits distinguish600-second test from670-second process ceiling. Literal-reversal test protects every existing assertion/fixture; versioned-runner equality protects selection, non-full-size limits and cleanup. Original versus new policy evidence remains separate. Execution is already authorized inline.

## Execution Evidence

- Fresh immutable baseline captured as `task-13-fullsize-timeout-baseline`; HEAD/index unchanged.
- Three intended regression REDs observed: old360000ms deadline and two missing-runner checks; global timeout check passed.
- Single600000ms literal and versioned670000ms runner applied. Eight focused checks pass, including exact full-file comparison and original selection/reporter checks.
- Actual uninstrumented full-size casePASS in **426387.315529ms (7m06.4s)**, one attempt, no retries/repeats, no missing or module/unhandled failures. Artifact `task-13-migration-10m-cases-0-660-zO7dCP`; despite the inventory-range prefix, exact-name selection ran only one of660cases, with659skipped. This is a pass under the amended600000ms policy, not a pass at the historical360000ms limit.
- Before/after application/test/config stamp: `b7acaf92b38f389bf338b6ff2b79987769532b93d680bc880ea9cfcc1c920b5d`/1170files. The changed stamp comes from the test literal, not a runtime change. Historical636PASS/24timeouts remains preserved; do not report637/23by combining overlapping runs or claim full-suite acceptance.
- BuildPASS12.76s/2468modules at `task-13-fullsize-timeout-build-01`, with existing external-output/chunk-size warnings. No dependency, runtime or production change.
- Exact review package `task-13-fullsize-timeout-review-01.md` contains one test literal plus three documentation paths; ledger excluded. Independent read-only reviewer `ses_f0fa68656ffe3VJekmj2X9Ff75` found no actionable issue. Final eight checksPASS; HEAD/index/whitespace unchanged. Protected hashes match the original read-only `../sticker-press-redesign` files, not similarly named execution-checkout files; those execution gallery files also match HEAD. Launcher2397595alive (not a health check), no owned test/benchmark remains,4310/4311/4320/4321 listeners absent. Worktree and uncommitted changes retained; no cleanup, staging or commit.

### Task 2: Fresh Full Migration Campaign

The user subsequently approved one fresh660-case campaign followed by a concrete MilestoneB plan. This is not a retry of a failed isolated test or permission for new runtime changes. Starting stamp remainsb7acaf92b38f389bf338b6ff2b79987769532b93d680bc880ea9cfcc1c920b5d/1170.

- [x] Verify existing linked worktree, HEAD/empty index and eight timeout/runner/reporter checks. Preserve600000ms for the named32MiB test and every other original deadline.
- [x] Run one serial full campaign with explicit removal of the earlier single-name filter. Use2400000ms shell allowance, no concurrent benchmark or application edits:

```bash
env -u FOUNDATION_CASE_NAMES FOUNDATION_INVENTORY=/tmp/opencode/doctect-incremental-sdd/task-13-migration-10m-cases-0-660-zO7dCP/0-events.jsonl node /tmp/opencode/doctect-incremental-sdd/foundation-batch-runner-10m.mjs 0 660 20
```

- [x] Validate all660unique selected outcomes, unchanged before/after source stamp, complete terminal events and absence of module/unhandled/missing errors. Report all remaining failures at their actual deadlines. Never combine a failed result with a better older/cold result. If interrupted, exclude the entire incomplete batch and identify disjoint missing cases before any continuation.
- [x] Record this campaign separately from historical636/24 and isolated full-size pass. Timing failures remain open; unexpected correctness failures require diagnosis. Private MilestoneB planning may proceed under the existing private-first authorization, not as production acceptance.

### Complete campaign result

`task-13-migration-10m-cases-0-660-0MVFy5` completed37serial batches: **649PASS /11timeouts /660cases**,0missing/0selected skipped/0retries/0non-timeout failures/0module or unhandled failures. Full32MiB casePASS401481.622311ms (6m41.5s) at600000ms. Before/after stamp remainsb7acaf92b38f389bf338b6ff2b79987769532b93d680bc880ea9cfcc1c920b5d/1170; runtime/test/config unchanged during campaign. First-start to last-end elapsed1261253ms. This is the new complete campaign result, not all-green acceptance or a controlled speedup claim.

All11remaining failures time out at5000ms and also failed in the historical636/24campaign:

| Cases | Remaining workload |
| ---: | --- |
| 2 | Prepared replay physical-row/batch-order parity, fresh and historical sources |
| 1 | Hashing outside transactions and observer-safe durable progress |
| 1 | Generator UTF-8 exact512KiB boundary |
| 1 | Remote edits across proof-window eviction and forged-baseline refusal |
| 2 | Exact256KiB staging boundary, plus0/1byte |
| 1 | Every multi-record stage write ordinal rolls back records/cursor together |
| 1 | Multiple bounded stages and exact durable-prefix resume |
| 1 | Legal oversized singleton versus illegal grouping |
| 1 | Current ancillary export versus frozen retained recovery |

External `ten-minute-campaign-tools{,.test}.mjs` validates every raw batch/selected ID, complete terminal events, serial order, zero retries, unchanged defaults/source stamp, exact summary reconstruction and timeout-only versus mixed errors. Five missing-export REDs→fivePASS. `summarize-ten-minute-campaign.mjs` created exclusive `task-13-ten-minute-campaign-01.json` with full names/errors/durations and historical comparison. No cold reruns or best-of substitution. Historical636/24 and isolated7m06.4s evidence stay intact. These11timing gates remain release blockers while private lifecycle planning continues.
