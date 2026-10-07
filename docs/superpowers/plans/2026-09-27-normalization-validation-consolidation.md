# Stored-Project Validation Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. The user selected inline controller implementation, not implementation subagents or handoffs. Read-only investigation/review is permitted. Steps use checkbox (`- [ ]`) syntax for tracking. Do not stage or commit.

**Goal:** Remove three duplicate canonical scans from validation-only stored-project checks while preserving all three AppState checks, one disposable clone, the real loader, errors and independent normalization phases.

**Architecture:** Add one purpose-specific `Work<void>` export in the existing validation module. Share only existing private semantic predicates; public validators retain their original clone/traversal behavior. Route the cooperative discard-only project-record branch through the new composition; no cached validation fact leaves the call.

**Tech Stack:** TypeScript, existing cooperative Work/JSON/loader modules, Vitest 4, fake-indexeddb 6, Vite 6. Installed dependencies unchanged.

## Global Constraints

- Contract: [approved validation design](../specs/2026-09-27-normalization-validation-consolidation-design.md). User authorized proceeding after the milestone clarification on 2026-09-27. Execute inline in one connected batch; do not reopen the execution-style choice.
- Worktree `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence`; branch `feat/incremental-local-persistence`; HEAD `8a2872d9a5acae1be3022923c4c515c70212de83`. Preserve the dirty tree and empty index. No commits, staging, merges, dependency changes, destructive cleanup, deployment, existing-profile migration or source/sibling-worktree edits.
- Preserve launcher PID2397595/ports3000/3001 and stopped4310/4311 preview with its retained SQLite database. Production `WORKSPACE_DB_VERSION=2`; private version3/fourteen stores unchanged.
- No JSON/AppState/loader policy, schema, hash/frame, authority, worker protocol, UI or build/test configuration change. No global receipt/cache or trusted-caller flag. Presets, pending imports, historical preparation and returning reconstruction stay on existing paths.
- Original state, complete wrapper, clone-before-loader and loaded result are distinct validation contexts. Six canonical scans become three, but all three AppState validations remain. Preserve non-enumerable array-index clone behavior, accessor behavior, errors/cause chains and stage precedence.
- AppState32MiB/depth512/history50 remain; no aggregate wrapper/workspace/backup cap. External IDs remain nonempty and uncapped by private command-ID limits.
- Work quantum1024visits/64KiB; JSON fragments64UTF16units/max192UTF8bytes; SHA step<=192bytes/600visits; count-only string scans127units. Charge actual work; logical ownership is not native heap evidence.
- Stage<=64records/256KiB except one valid oversized singleton. Success<=8full-set reads/4source and target derivations; legacy captures<=5uncontended/2active; retries<=8. Preserve prefix checks, fresh phase captures/seals, quiet publication fences, cancellation and lost-acknowledgement semantics.
- No old fixture/assertion/deadline/budget reduction or relaxation. Existing5000ms and original32MiB360000ms gates remain. New explicit large-state equivalence cases use the same360000ms stress ceiling, not an override of old tests.
- Known unrelated tsc error: `tests/unit/gallerySamples/stickerPress.test.ts(793,36): TS2339 Property 'length' does not exist on type 'never'`. Do not suppress it or claim a green full typecheck.
- Baseline: `/tmp/opencode/doctect-incremental-sdd/task-13-validation-consolidation-baseline/{manifest.json,files/}`. Starting runtime/test/config hash012966351b041366b4106959901e315db22e057ca3fac73a06c5c00c74b0b975/1169files. Keep original Task11b and emission baselines/allowlists immutable. Ledger `.superpowers/sdd/progress.md` remains untracked and never staged.

---

## Exact file map

| Path | Responsibility |
| --- | --- |
| `services/localWorkspace/validation.ts` | New stored-project check; extract existing current-state and pre-loader semantic sequences into private helpers |
| `services/localWorkspace/migration.ts` | New helper import and cooperative discard-only project branch |
| `tests/unit/localWorkspace/storedProjectValidation.test.ts` | New independent old-composition oracle, real call counts, adversarial/error/ownership/size equivalence |
| `tests/unit/localWorkspace/migrationPreparation.test.ts` | Aggregate/streamed routing and returning-path isolation |
| `tests/unit/localWorkspace/normalized/migration.test.ts` | Real phase re-entry and raw retained-source preservation |
| This plan, approved spec, predecessor plan and ledger | Status/evidence links; no runtime acceptance inferred from documentation |

Reuse all existing fixtures/harnesses unchanged. Static capability permissions already cover the existing runtime import edges; no boundary-test grant change is required.

## Task 1: Add an equivalent three-scan stored-project validator

**Files:** `validation.ts`, new `storedProjectValidation.test.ts`.

**Interfaces:** consumes existing `inspectJsonObject`, `workspaceProjectRecord`, Work ownership, plain AppState validation and `loadOwnedProjectStateWork`. Produces `checkStoredWorkspaceProjectWork(raw: unknown): Work<void>`; no options, trusted byte count or return payload.

- [x] **1. Add the independent reference and failing work-removal test.** Import the validation namespace so absence of the new function fails an assertion, not test-module collection. Use real imported canonical/AppState/loader spies, restored after each test.

```ts
// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as validation from '../../../services/localWorkspace/validation';
import * as json from '../../../shared/jsonWork.js';
import * as app from '../../../shared/validateAppState.js';
import * as loader from '../../../services/loadProjectState';
import type { Work } from '../../../shared/cooperativeWork.js';
import { currentState } from '../../helpers/localWorkspaceFixtures';
import { makeWorkHarness } from '../../helpers/normalizationWorkHarness';

const project = () => ({ id: 'project-1', name: '', initialState: currentState(),
  cloud: { projectId: 'cloud-1', lastSyncedCommitId: 'commit-1' }, revision: 0,
  retained: { data: ['Café', '\ud800'] } });
function* reference(raw: any): Work<void> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || Object.getPrototypeOf(raw) !== Object.prototype) throw new Error('Project payload must be an object.');
  yield* validation.checkMigratedStateWork(raw.initialState);
  yield* validation.checkWorkspaceProjectWork(raw, { warningPolicy: 'reject' });
}
beforeEach(() => vi.spyOn(console, 'log').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());
it('removes only duplicate canonical scans from stored-project checks', async () => {
  expect(validation.checkStoredWorkspaceProjectWork).toBeTypeOf('function');
  const raw = project(), before = structuredClone(raw);
  const canonical = vi.spyOn(json, 'canonicalBytesWork');
  const semantic = vi.spyOn(app, 'validateAppStateWork');
  const load = vi.spyOn(loader, 'loadOwnedProjectStateWork');
  const clone = vi.spyOn(globalThis, 'structuredClone');
  const old = makeWorkHarness(); await old.runtime.run(reference(raw));
  expect(canonical).toHaveBeenCalledTimes(6); expect(semantic).toHaveBeenCalledTimes(3);
  canonical.mockClear(); semantic.mockClear(); load.mockClear(); clone.mockClear();
  const h = makeWorkHarness();
  expect(await h.runtime.run(validation.checkStoredWorkspaceProjectWork(raw))).toBeUndefined();
  expect(canonical).toHaveBeenCalledTimes(3); expect(semantic).toHaveBeenCalledTimes(3);
  expect(canonical.mock.calls[0][0]).toBe(raw.initialState);
  expect(canonical.mock.calls[1][0]).toBe(raw);
  expect(load).toHaveBeenCalledTimes(1); expect(clone.mock.calls).toEqual([[raw.initialState]]);
  expect(raw).toEqual(before); expect(h.runtime.snapshot().ownedBytes).toBe(0);
  expect(h.runtime.snapshot().projectReconstructions).toBe(0);
  expect(h.runtime.snapshot().visits).toBeLessThan(old.runtime.snapshot().visits);
});
```

Run `npx vitest run tests/unit/localWorkspace/storedProjectValidation.test.ts --maxWorkers=1 --silent=passed-only`. Expected RED: missing new function. Keep that result before runtime changes.

- [x] **2. Add differential and lifecycle cases before implementation.** Build every case twice using factories, never structured-clone an accessor-bearing/cyclic fixture to obtain its oracle. Compare recursive `{name,message,cause}` errors, success versus failure, clone inputs and outstanding ownership. Valid cases also compare raw values/order/alias identity before and after.

```ts
const errorShape = (error: unknown): unknown => error instanceof Error
  ? { name: error.name, message: error.message, cause: errorShape(error.cause) }
  : error;
async function outcome(program: Work<void>) {
  const h = makeWorkHarness();
  try { return { result: await h.runtime.run(program) }; }
  catch (error) { return { error: errorShape(error) }; }
  finally { expect(h.runtime.snapshot().ownedBytes).toBe(0); }
}
const mutations: [string, (raw: any) => void][] = [
  ['missing schema', raw => { delete raw.initialState.schemaVersion; }],
  ['old schema', raw => { raw.initialState.schemaVersion = 10; }],
  ['future schema', raw => { raw.initialState.schemaVersion = 12; }],
  ['missing root', raw => { raw.initialState.rootId = 'missing'; }],
  ['missing active variant', raw => { raw.initialState.activeVariantId = 'missing'; }],
  ['bad original text', raw => { raw.initialState.variants.default.templates.page.elements[0].textWrap = 'bad'; }],
  ['non-enumerable index', raw => {
    raw.initialState.opaque = [''];
    Object.defineProperty(raw.initialState.opaque, '0', { enumerable: false });
  }],
  ['source before wrapper', raw => { raw.initialState.rootId = 'missing'; raw.id = ''; }],
];
it.each(mutations)('matches the existing composition for %s', async (_name, mutate) => {
  const left = project(), right = project(); mutate(left); mutate(right);
  expect(await outcome(validation.checkStoredWorkspaceProjectWork(right)))
    .toEqual(await outcome(reference(left)));
});
```

Extend that same table with negative/fractional/string schema, invalid nodes/template dimensions/textOverflow/textPadding, generator fields/unknown key/timestamp, id/name/cloud/revision errors, nonfinite/undefined/function/symbol/bigint/cycle/prototype/hidden fields, sparse/extra-key arrays, wrapper and state `then`/`toJSON`/ordinary getters, plus entry `initialState` getter invocation parity. Success cases include missing text/grid defaults, valid generator/script boundaries, aliases/frozen descriptors, long external IDs, Unicode, raw folds and opaque extensions. Assert actual getter counts; no “throws for any reason” oracle.

Use delegating real-loader faults to prove warning rejection and malformed output checks, not a replacement loader stub. Use clone injection to corrupt the private clone and prove pre-loader rejection before loader invocation. Lifecycle fixtures cancel before reserve, at reserve operation completion, immediately after native clone, during loader work, during final AppState work and terminal return. Each must reject with `AbortError`, retain original data and end with zero owned bytes. Include throwing clone/loader and throwing passive observer cases.

Depth fixtures use nested opaque objects at exact state-root and wrapper512/513 contexts. Size fixtures measure UTF8 JSON independently: pad an ASCII opaque state field to32MiB−1/32MiB/32MiB+1, retain real limits, and separately exercise post-hydration growth and an oversized wrapper extension. Isolate these expensive new cases under the existing360000ms stress ceiling; do not add extra passes to or alter the original normalization stress case.

- [x] **3. Extract existing private rules, then add the new composition.** Move only the current-schema/AppState/active-variant statements from `migratedStateTraversal` into `migratedStateRules(state, mode): Work<void>`. Its caller still does both original canonical checks and returns its clone. Move only schema-version/pre-loader AppState/active-variant statements from `projectStateTraversal` into `beforeLoadRules(source, mode): Work<void>`. Preserve the exact messages and sync-versus-Work calls.

```ts
export function* checkStoredWorkspaceProjectWork(raw: unknown): Work<void> {
  if (!isPlainObject(raw)) throw new Error('Project payload must be an object.');
  let state: unknown;
  yield* effect(1, () => { state = raw.initialState; });
  let inspected = yield* inspectJsonObject(state, 'Migrated project state', 'check');
  yield* migratedStateRules(inspected.value, 'check');
  yield* workspaceProjectRecord(raw, 'check');
  let source: Record<string, unknown> | undefined;
  let loaded: ProjectLoadResult | undefined;
  let ownership: Ownership | undefined;
  try {
    yield { visits: 1, utf8Bytes: 0, run(runtime) { ownership = runtime?.own(inspected.bytes); } };
    source = yield* primitive('clone', () => structuredClone(inspected.value));
    yield* beforeLoadRules(source, 'check');
    loaded = yield* loadOwnedProjectStateWork(source);
    source = undefined;
    if (loaded.warnings.length > 0) throw new Error(loaded.warnings.join(' '));
    const output = yield* inspectJsonObject(loaded.state, 'Migrated project state', 'check');
    yield* migratedStateRules(output.value, 'check');
  } finally {
    source = undefined;
    loaded = undefined;
    state = undefined;
    ownership?.release();
  }
}
```

Keep borrowed raw references local; no maps/cache/result receipt. Use the existing protected-allocation pattern, not `yield* retainWork` followed by late ownership assignment. Do not expose unvalidated values as operation returns. Extracted rule helpers are private and do not accept proof/skip flags.

- [x] **4. Run focused GREEN and unchanged validation regressions.** Run the new file plus `validation.test.ts`, `cooperativeLoader.test.ts`, `generatorMetadata.test.ts`, `server/validateAppState.test.js` and `canonical.test.ts` with one worker. Keep the expensive size cases separately identified. Record exact counts and any failure rather than adjusting policies to hit scan counts.

## Task 2: Route discard-only records and prove independent phase re-entry

**Files:** `migration.ts`, `migrationPreparation.test.ts`, normalized `migration.test.ts`.

**Interfaces:** consumes `checkStoredWorkspaceProjectWork`; preserves `validateWorkspaceRecordsWork` and `createWorkspaceRecordValidator` return types and all existing normalized repository interfaces.

- [x] **1. Add failing aggregate/streamed routing tests.** Spy on the new validation export after real historical fixture preparation. Aggregate validation returns the original records; streamed validation returns no payload. Both invoke the new helper once per project; returning sync/Work reconstruction, preparation, presets and pending imports do not. Keep the original clone-order assertions.

```ts
const spy = vi.spyOn(validationModule, 'checkStoredWorkspaceProjectWork');
const h = makeWorkHarness();
expect(await h.runtime.run(validateWorkspaceRecordsWork(records))).toBe(records);
expect(spy.mock.calls.map(call => call[0])).toEqual(records.projects.map(row => row.project));
spy.mockClear();
const validator = createWorkspaceRecordValidator();
for (const row of records.projects) await h.runtime.run(validator.project(row));
await h.runtime.run(validator.ancillary(records));
expect(spy).toHaveBeenCalledTimes(records.projects.length);
spy.mockClear();
await h.runtime.run(reconstructWorkspaceRecordsWork(records));
reconstructWorkspaceRecords(records);
expect(spy).not.toHaveBeenCalled();
```

Run `npx vitest run tests/unit/localWorkspace/migrationPreparation.test.ts --testNamePattern='consolidated stored-project' --maxWorkers=1 --silent=passed-only`. Expected RED: helper receives zero calls. Add multi-fault record/current-state/wrapper/ID-equality precedence comparisons with the unchanged returning Work path.

- [x] **2. Replace only the discard branch.** Add the new import; remove the now-unused `checkWorkspaceProjectWork` import only if no remaining call uses it. Preserve outer payload/object checks, ID comparison, `accountOutput`, reconstruction metrics, catch/wrapping and all preset/import branches.

```ts
let project: WorkspaceProject | undefined;
if (cooperative && !retainSnapshot) {
  yield* checkStoredWorkspaceProjectWork(rawRecord.project);
} else {
  if (cooperative) yield* checkMigratedStateWork(rawRecord.project.initialState);
  else validateMigratedState(rawRecord.project.initialState);
  if (!retainSnapshot) yield* checkWorkspaceProjectWork(rawRecord.project, REJECT_WARNINGS);
  else project = cooperative
    ? yield* validateWorkspaceProjectWork(rawRecord.project, REJECT_WARNINGS)
    : validateWorkspaceProject(rawRecord.project, REJECT_WARNINGS);
}
```

Keep the old composition as the fallback. Review found that outer `rawRecord.project` accessors can return different values or throw on later Gets; the new path originally reduced four Gets to three. A charged own-property descriptor check selects consolidation only for data-property envelopes. Accessor envelopes keep the exact previous Get/validation sequence, including the noncooperative discard fallback. No record metadata validation is moved into the payload helper.

- [x] **3. Add one real-session re-entry/source-retention regression.** Use `boundedSessionHarness`, its invocation Work runtime and the real repository. Wrap the new helper with a delegating generator that records `work.context().phase`; normalization must call it in prepare/verify/activate/reopen and never stage. Independently read retained source after activation and compare it with the original historical project records. Keep adapter cleanup in `finally`.

```ts
const calls: string[] = [];
const original = validationModule.checkStoredWorkspaceProjectWork;
const checked = vi.spyOn(validationModule, 'checkStoredWorkspaceProjectWork')
  .mockImplementation(function* (raw) {
    calls.push(w.runtime.context().phase);
    yield* original(raw);
  });
const result = await normalizeWorkspace({ repository: h.repository, historical: h.historical,
  ensurePhysicalLayout: () => h.adapter.open(), work: w.runtime });
expect(result.status).toBe('active');
expect(new Set(calls)).toEqual(new Set(['prepare', 'verify', 'activate', 'reopen']));
expect(calls).not.toContain('stage');
checked.mockRestore();
const retained = await h.repository.readRetainedSource(makeWorkHarness('retained').runtime);
expect(retained.records.projects).toEqual(h.prepared.projects);
expect(w.runtime.snapshot().ownedBytes).toBe(0);
```

Run the new real-session test plus the existing four-derivation test at their original5000ms limits. Then run complete migrationPreparation tests and scoped retained-source/corruption/resume/stage tests. Request read-only review against the fresh validation baseline, not HEAD; fix concrete findings with regression tests.

## Task 3: Verify correctness, unchanged gates and exact scope

**Files:** evidence/status documentation only unless a verified defect requires a scoped test-first correction.

- [x] **1. Freeze source after review and run affected regression suites.** Use one worker for focused runs, at most two for connected suites. Run full `tests/unit/localWorkspaceBoundary.test.ts` with existing permissions. Record source hash before and after each acceptance campaign. Do not combine differing-source outcomes.

```sh
npx vitest run tests/unit/localWorkspace/validation.test.ts tests/unit/localWorkspace/migrationPreparation.test.ts tests/unit/localWorkspace/canonical.test.ts tests/unit/cooperativeLoader.test.ts tests/unit/generatorMetadata.test.ts tests/unit/server/validateAppState.test.js --maxWorkers=1 --silent=passed-only
npx vitest run tests/unit/localWorkspace/normalized/sourceReads.test.ts tests/unit/localWorkspace/normalized/codec.test.ts tests/unit/localWorkspace/normalized/emissionPlan.test.ts tests/unit/localWorkspace/normalized/workspaceAuthority.test.ts tests/unit/localWorkspace/normalized/repository.test.ts --maxWorkers=1 --silent=passed-only
npx vitest run tests/unit/localWorkspaceBoundary.test.ts --maxWorkers=1 --silent=passed-only
```

- [x] **2. Run all current migration cases with unchanged deadlines.** Collect a fresh inventory using the existing external case reporter, then run `/tmp/opencode/foundation-batch-runner.mjs` with `FOUNDATION_INVENTORY` pointing to that inventory and batch size20. The existing runner isolates the original32MiB case without changing its360000ms test timeout. Run the original wide cases and derivation gate in a separately labeled cold check; do not replace failures with best-of outcomes. Count all original659 cases plus additions, with no missing/unhandled/module errors required for complete covering evidence. Retain any runtime failures honestly.

- [x] **3. Typecheck, build and audit.** Verify the external parent before creating a unique build output. Existing known TS2339 is not green typecheck. Reuse the immutable-baseline scope audit with exact new plan/test paths added; compare the two runtime files against this slice's baseline. Check retained old assertions/deadlines, HEAD, empty index, protected hashes and `git diff --check`.

```sh
npx tsc --noEmit
TMPDIR=/tmp/opencode npm run build --legacy-peer-deps -- --outDir /tmp/opencode/doctect-incremental-sdd/task-13-validation-build-01
git diff --check
git diff --cached --name-only
```

- [x] **4. Record the milestone result.** Record new helper/route implementation, actual6→3canonical and3AppState/1clone/1loader evidence, focused RED/GREEN, review outcome, regression/build/typecheck and full migration outcomes. If runtime gates remain red, leave predecessor emission Tasks5/6 and normalization acceptance open. No production responsiveness, rollout, lifecycle completion or native heap claim follows from this private optimization.

## Execution checkpoint

Starting state: written design approved through the user's “Ok proceed” following the exact milestone clarification. Existing linked worktree reused, dependencies already installed, HEAD/index verified. Fresh pre-implementation dirty baseline captured. Runtime unchanged at this checkpoint; no implementation step marked complete.

Implementation checkpoint: Tasks1/2 code and focused tests are present; Task3 broad verification is running. Missing-function RED and missing-routing RED were observed. Real work assertions pass6→3canonical/3AppState/1clone/1loader; returning exports retain their old composition. Initial159focused cases passed, six separate full-size cases passed76.18s, and final pre-type-fix292focused cases passed. Review found outer-envelope accessor parity and missing in-flight cancellation proof: two accessor regressions first failed3-versus4Gets, then passed with the descriptor-selected old-path fallback; added authentic in-flight loader/post-load guard tests pass. Read-only recheck reports no remaining scoped findings. One new test-only TypeScript cast error was identified alongside known Sticker Press TS2339 and corrected; recheck follows. These are not normalization timing acceptance.

### Final verification checkpoint — implementation present, normalization acceptance open

Source stamp `d5ee878940ba31bf9b67dd17f3747de360dc6ff992fba7c271ada996858887d6` /1170files stayed unchanged throughout final verification. All implementation/verification actions above were performed; checked boxes do **not** mean the remaining runtime gates passed.

- **96 new tests pass:**88 in the new validator suite, seven record-routing/accessor tests and one real normalization-phase/source-retention test. The88 include six full32MiB/oversized-wrapper cases, pre-loader clone-size expansion, post-loader hydration growth, actual3canonical/3AppState/1clone/1loader calls, preserved getter behavior and authenticated in-flight cancellation. No old test body was reduced or rewritten.
- Affected regression command:517PASS/1FAIL across518 cases/7files,116.15s. Sole failure is pre-existing `generatorMetadata.test.ts:81`, whose test spies on `TextEncoder.encode` with a16-unit expectation while existing cooperative raw-byte counting uses `encodeInto`. It fails identically when the actual pre-change snapshot is overlaid read-only by external `validation-baseline.config.mjs`; neither test nor shared implementation was changed. Evidence `task-13-validation-regression-01.jsonl`, `task-13-validation-generator-baseline-01.jsonl`. This command is not green.
- Connected source/codec/emission/workspace-authority/repository regression:374PASS/5files,119.97s. Full capability boundary:945PASS,214.30s, no permissions changed. Both had zero unhandled/module errors. Evidence `task-13-validation-connected-01.jsonl`, `task-13-validation-boundary-01.jsonl`.
- **All660 migration cases covered:634PASS/26timeouts**, no missing cases or non-timeout failures in the complete covering set. Original659 case names/options and both modified files' complete pre-existing test bodies are independently checked unchanged. The new case is the real phase/source-retention regression. Original32MiB still fails360000ms (360037ms reported); both wide physical-parity cases still fail5000ms. Four actual source/target derivations remain proven (1340ms in the campaign).
- Campaign `task-13-migration-cases-0-660-nw22Hs` hit the shell1200s ceiling during batch32. The **entire interrupted batch**, including its completed partial outcomes, is excluded from the complete covering set and retained as failed/incomplete evidence. Completed batches supplied561 cases; campaign `task-13-migration-cases-0-660-WUhJkd` supplied the disjoint remaining99. Merger `validation-covering-evidence.mjs` checks source stamps, complete batch endings, unique case IDs and absent unhandled errors. Result `task-13-validation-covering-01.json`. No best-of result replacement or test-timeout override.
- Build `task-13-validation-build-01` PASS12.34s/2468modules, existing bundle-size warnings only. Final `npx tsc --noEmit` reports only the known Sticker Press TS2339; full typecheck is not green.
- Exact runtime/scope audit PASS93authorized cumulative paths/51-of81 preserved. Immediate slice touches only the two runtime files, three test files and listed documentation; HEAD/empty index/whitespace/protected hashes intact. Original baselines/allowlists unchanged. `validation-verification-summary.mjs` verifies original case options, byte-identical old test bodies and same-stamp evidence.

### Remaining-cost diagnostic, not acceptance

After the gate runs, one fresh130-node verification CPU probe (`task-13-phase-YFh8AE`) measured1879ms wall: capture109ms, target derivation1081ms including captured-source533ms, reconstruction258ms, seal340ms and yield waits36ms. These inclusive spans overlap; do not sum nested source/hash spans into their parents. Actual work was3,649,495visits/6,197,821checks; candidate bytes76138, hash bytes111862, reads/seal/derivation counts match the prior fixture. JSON helpers and Work execution still dominate sampled self time (652ms/487ms). This one phase-only sampled run is not controlled timing improvement, original32MiB acceptance or production responsiveness.

The diagnostic reuses the old external probe with only its expected source-stamp/import wrapper updated; old scripts/artifacts are retained. One wrapper startup attempt failed before spawning Vitest because a data-URL import needed an explicit `file:` URL; corrected externally, with no application changes. No comparison/quotation experiment was enabled or promoted. Original application limits/config remain unchanged.

This slice removes demonstrated duplicate work but does not close normalization runtime acceptance. Next work must target remaining measured traversal/dispatch cost under a separately reviewed scope; the unchanged generator test mismatch also needs its own scope decision. No lifecycle B/C/D work, production cutover, data migration, staging or commit occurred.

Follow-up: [short JSON token batching](2026-09-27-short-json-token-batching.md) was explicitly approved and implemented in the shared quotation module only.48new tests and533core checks pass; complete current migration campaign is636PASS/24timeouts at stamp062de1ac74c376e26effe619bf96d203ff21cd290b9573de1181f1179b49db18. Prototype timings remain diagnostic, including the retained fresh outlier. Comparator/runtime changes are still excluded, and original deadline gates remain open. Full actual implementation evidence is in that plan.
