# Work Operation Capture and Scalar Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Inline controller execution is already selected; no implementation subagents or handoff. Read-only review is allowed. Steps use checkbox (`- [ ]`) syntax for tracking. No commits or staging.

**Goal:** Test the approved captured-local/late-receiver Work implementation against its exact compatibility and full-workflow gates, promoting it only if those gates pass.

**Architecture:** Keep the structural `Operation` interface and every existing validation/guard/scheduler rule. Capture fields once in each driver, validate captured values centrally, use locals for accounting, and construct the same fresh mutable callback receiver immediately before invocation. First use an external one-file overlay; application runtime and tests stay untouched until the explicit promotion gate.

**Tech Stack:** JavaScript generators, TypeScript, Node22.23.2, Vitest4.0.16, Vite6.4.1, existing fake IndexedDB and fresh Chromium/native IndexedDB tooling. No dependencies added.

**Status:** Inline execution authorized by the user's “Continue” on 2026-09-29, following approval of the [written design](../specs/2026-09-28-work-operation-dispatch-design.md). Tasks1–2 passed review and focused verification. Task3's fixed ABBA screen rejected the candidate on both matched-pair and ten-percent-median rules; independent rejection review found no actionable issue. Original/native gates and Task4 promotion are blocked and unexecuted. Application source and official acceptance remain unchanged.

## Global Constraints

- Execution root: `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence`; branch `feat/incremental-local-persistence`; HEAD `8a2872d9a5acae1be3022923c4c515c70212de83`. Reuse this worktree; preserve dirty predecessor work and empty index.
- Starting application/runtime/test/config stamp: `062de1ac74c376e26effe619bf96d203ff21cd290b9573de1181f1179b49db18` /1170files. Official migration result remains636PASS/24timeouts/660cases.
- Quantum1024visits/64KiB, frame64UTF16units/max192UTF8bytes, SHA step<=192bytes/600visits, count-only scan127units, AppState32MiB/depth512. All stage/read/derivation/retry limits, fresh seals and source/current-authority rules remain unchanged.
- Original32MiB case360000ms; fresh/historical wide cases5000ms. The separately named900s diagnostic ceiling is never an acceptance pass or replacement test.
- Capture `visits`, `utf8Bytes`, `nativeKind`, `metric`, `run` once and in that order, before validating anything. Keep validation/builtin-call order, error routing, receiver reflection/mutation/escape, thenable handling, lifecycle precedence and current-phase accounting.
- No pooled receiver, descriptor alias, validation cache, trusted flag, opcode/brand, producer change, guard removal, scheduler change, counter relabeling or bundled JSON/hash experiment.
- Successful operations still allocate one fresh receiver. No promised speedup, zero-allocation claim or native-heap proof.
- Application promotion scope: only `shared/cooperativeWork.js` and appended cases in `tests/unit/localWorkspace/normalized/work.test.ts`. Declarations, capability grants, original tests/fixtures/config and all other application files stay unchanged.
- Inline implementation only. Do not stage, commit, merge, update dependencies, delete artifacts, migrate existing profiles or switch production fromv2. Ask before any destructive operation.
- Preserve launcherPID2397595, ports3000/3001, stopped4310/4311 preview and `/tmp/opencode/doctect-local-preview-20260919/api.sqlite`. Native trials use fresh nonpersistent contexts and checked alternate4320/4321 only.
- Use `apply_patch` for source/tool edits. Run commands with the execution root as `workdir`, not with `cd`. Before artifact creation, verify `/tmp/opencode/doctect-incremental-sdd` using `ls -d`.
- Keep original Task11b/batching baselines and allowlists immutable. Every new baseline/output uses a new name and exclusive creation; never overwrite a receipt to rerun a failed experiment.

## File Map and Decision Points

All external paths below use `/tmp/opencode/doctect-incremental-sdd/` as `D` in prose. Shell commands retain full paths. These tools are not production imports.

| File | Responsibility |
| --- | --- |
| `D/dispatch-cases.ts.txt` | Exact append-only Vitest characterization block, shared by baseline/variant and later application promotion. |
| `D/dispatch-variant.mjs` | Fail-closed source transforms: baseline, five negative controls, then the approved scalar candidate. |
| `D/dispatch.config.mjs` | Original-config overlay; optional appended cases or full diagnostic instrumentation, never a timeout override. |
| `D/dispatch-tools.test.mjs` | Source preservation, complete-phase collector and decision-rule tests. |
| `D/dispatch-evidence.mjs` | Receipt parsing, all-phase parity and fixed benefit/acceptance predicates. |
| `D/dispatch-runner-source.mjs` | Pure, fail-closed derivation of the existing Node/native runner source. |
| `D/dispatch-run.mjs` | Exclusive trial outputs, frozen tool provenance, reused Node/native runners and serial campaign steps. |
| `D/task-13-work-dispatch-baseline/` | Fresh immutable snapshot of the current dirty worktree. |
| `D/task-13-work-dispatch-01/` | Generated full-phase collector/platform adapters, receipts and trial artifacts. |
| Existing spec, this plan, predecessor link and ledger | Approval, checked steps, evidence and stop decisions. Never stage the ledger. |

**Stop points:** characterization/tool failure → fix only the harness or approved candidate; first pair without gain → reject early; ABBA screen failure/inconclusive → reject; original gate failure → stop without promotion; native failure/absent benefit → stop; regression/new scope mismatch → do not claim acceptance. No failed gate authorizes another optimization.

---

### Task 1: Characterize the Existing Operation Interface

**Files:** Create external `dispatch-cases.ts.txt`, `dispatch-variant.mjs`, `dispatch.config.mjs`. Snapshot current dirty files using existing `review-artifacts.mjs`. No application edit.

**Interfaces:** Consume actual `runSync`, `createWorkRuntime`, `effect`, `retainWork`, `Operation`, `Work`, `WorkControl`, `WorkRuntime` already imported by `normalized/work.test.ts`. Produce the append-only suite named `operation capture and scalar dispatch compatibility` and `variantSource(source, variant): string` for baseline/negative controls.

- [x] **Step 1: Freeze the starting worktree and inventory.** Verify HEAD/index/stamp using the current plan checker. Run:

```bash
ls -d /tmp/opencode/doctect-incremental-sdd
node /tmp/opencode/doctect-incremental-sdd/review-artifacts.mjs snapshot task-13-work-dispatch
```

Expected: a newly created `task-13-work-dispatch-baseline/manifest.json`. Existing output is an error, not permission to replace it. Retain the known original360s/5s failures as the optimization RED signal. Compatibility cases below should be GREEN on the unchanged implementation; negative controls prove sensitivity without inventing changed semantics.

- [x] **Step 2: Write the complete characterization block to `D/dispatch-cases.ts.txt`.** Its imports come from the existing Work test file; do not add a dependency on `/tmp` to application tests.

```typescript
describe.each(['sync', 'async'] as const)('operation capture and scalar dispatch compatibility %s', mode => {
  const keys = ['visits', 'utf8Bytes', 'nativeKind', 'metric', 'run'] as const;
  const one = function* (raw: unknown): Work<unknown> { return yield raw as Operation; };
  async function drive<T>(make: (runtime?: WorkRuntime) => Work<T>, control: Partial<WorkControl> = {}) {
    if (mode === 'sync') return runSync(make());
    const runtime = createWorkRuntime({ assertCurrent() {}, ...control });
    try { return await runtime.run(make(runtime)); }
    finally { runtime.dispose(); }
  }

  it.each(['own', 'inherited', 'proxy'] as const)('captures exactly once from %s fields', async shape => {
    const reads: PropertyKey[] = []; let raw: object, valueReads = 0;
    await drive(runtime => {
      const values: Record<string, unknown> = { visits: 2, utf8Bytes: 3, nativeKind: undefined, metric: undefined,
        run(this: Operation, received?: WorkRuntime) {
          expect(received).toBe(runtime); expect(this === raw).toBe(false);
          expect(typeof this).toBe('object'); expect(this).not.toBeNull();
          expect(Reflect.ownKeys(this)).toEqual(keys);
          expect(Object.getPrototypeOf(this)).toBe(Object.prototype);
          expect(Object.isFrozen(this)).toBe(false);
          for (const key of keys) expect(Object.getOwnPropertyDescriptor(this, key)).toEqual({
            value: values[key], writable: true, enumerable: true, configurable: true,
          });
          return 7;
        } };
      const descriptors = Object.fromEntries(keys.map(key => [key, {
        configurable: true, get() { reads.push(key); return values[key]; },
      }]));
      raw = shape === 'proxy' ? new Proxy({ ...values }, {
        get(target, key, receiver) { reads.push(key); return Reflect.get(target, key, receiver); },
      }) : shape === 'own' ? Object.defineProperties({}, descriptors) : Object.create(Object.defineProperties({}, descriptors));
      Object.defineProperty(raw, 'then', { get() { throw new Error('input then read'); } });
      Object.defineProperty(raw, 'extra', { get() { throw new Error('extra read'); } });
      Reflect.set(raw, Symbol('extra'), 1);
      const inner = one(raw);
      const program = {
        next(value?: unknown) {
          const step = inner.next(value);
          return step.done ? step : new Proxy(step, { get(target, key, receiver) {
            if (key === 'value') valueReads++; return Reflect.get(target, key, receiver);
          } });
        },
        throw(error?: unknown) { return inner.throw(error); },
        return(value: unknown) { return inner.return(value); },
        [Symbol.iterator]() { return this; },
      } as Work<unknown>;
      return (function* () { expect(yield* program).toBe(7); })();
    });
    expect(reads).toEqual(keys); expect(valueReads).toBe(1);
  });

  it.each(keys)('stops at throwing %s getter before validating captured values', async stop => {
    const reads: string[] = [], sentinel = new Error('getter');
    const raw = Object.defineProperties({}, Object.fromEntries(keys.map(key => [key, { get() {
      reads.push(key); if (key === stop) throw sentinel;
      return key === 'visits' ? NaN : key === 'utf8Bytes' ? 0 : key === 'run' ? () => 0 : undefined;
    } }])));
    await expect(drive(() => one(raw))).rejects.toBe(sentinel);
    expect(reads).toEqual(keys.slice(0, keys.indexOf(stop) + 1));
  });

  const badCosts: [unknown, unknown, string][] = [
    [undefined, 0, 'Work counter must be finite'], ['1', 0, 'Work counter must be finite'],
    [new Number(1), 0, 'Work counter must be finite'], [1n, 0, 'Work counter must be finite'],
    [NaN, 0, 'Work counter must be finite'], [Infinity, 0, 'Work counter must be finite'],
    [-1, 0, 'Invalid work cost'], [0.5, 0, 'Invalid work cost'], [0, 0, 'Work operation exceeds quantum'],
    [-0, 0, 'Work operation exceeds quantum'], [1025, NaN, 'Work counter must be finite'],
    [0, -1, 'Invalid work cost'], [1025, 0, 'Work operation exceeds quantum'],
    [1, '0', 'Work counter must be finite'], [1, 1n, 'Work counter must be finite'],
    [1, 0.5, 'Invalid work cost'], [1, 65537, 'Work operation exceeds quantum'],
  ];
  it.each(badCosts)('preserves invalid-cost precedence %#', async (visits, utf8Bytes, message) => {
    let calls = 0, runtime: WorkRuntime | undefined;
    await expect(drive(value => { runtime = value; return one({ visits, utf8Bytes, run() { calls++; } }); }))
      .rejects.toThrow(message);
    expect(calls).toBe(0); if (runtime) expect(runtime.snapshot().visits).toBe(0);
  });
  it.each([null, undefined, {}])('refuses malformed descriptors %#', async raw => {
    await expect(drive(() => one(raw))).rejects.toBeInstanceOf(TypeError);
  });
  it.each([false, null, 0, '', 'invalid'])('does not treat falsy enum %# as absent', async bad => {
    for (const property of ['nativeKind', 'metric']) {
      await expect(drive(() => one({ visits: 1, utf8Bytes: 0, run() {}, [property]: bad })))
        .rejects.toThrow('Invalid work protocol enum');
    }
  });
  it('checks enums before callability and permits exact cost edges without coercion', async () => {
    await expect(drive(() => one({ visits: 1, utf8Bytes: 0, nativeKind: 'bad', metric: 'bad', run: null })))
      .rejects.toThrow('Invalid work protocol enum');
    await expect(drive(() => one({ visits: 1, utf8Bytes: 0, run: null })))
      .rejects.toThrow('Work operation must be synchronous');
    expect(await drive(() => one({ visits: 1024, utf8Bytes: 65536, run() { return 3; } }))).toBe(3);
    await drive(() => one({ visits: 1, utf8Bytes: -0, run(this: Operation) { expect(Object.is(this.utf8Bytes, -0)).toBe(true); } }));
  });

  it.each([false, true])('keeps fresh escaping receivers and direct callback invocation, proxy=%s', async proxy => {
    const receivers: Operation[] = []; let nested: unknown;
    await drive(runtime => {
      function callback(this: Operation, received?: WorkRuntime) {
        expect(received).toBe(runtime); expect(receivers).not.toContain(this);
        receivers.push(this); const originalVisits = this.visits;
        nested = runSync(effect(1, function (this: Operation) { return this; }));
        expect(nested).not.toBe(this); expect(this.visits).toBe(originalVisits);
        this.visits = 99; return this;
      }
      Object.defineProperties(callback, {
        call: { get() { throw new Error('callback.call read'); } },
        apply: { get() { throw new Error('callback.apply read'); } },
      });
      const run = proxy ? new Proxy(callback, { apply(target, receiver, args) {
        return Reflect.apply(target, receiver, args);
      } }) : callback;
      const raw = { visits: 1, utf8Bytes: 0, run };
      return (function* (): Work<void> {
        expect(yield raw).toBe(receivers[0]); raw.visits = 2;
        expect(yield raw).toBe(receivers[1]);
      })();
    });
    expect(receivers).toHaveLength(2); expect(receivers[0]).not.toBe(receivers[1]);
    expect(receivers.map(value => value.visits)).toEqual([99, 99]);
  });

  it('routes callable class/revoked-proxy failures after admission', async () => {
    const revoked = Proxy.revocable(function () {}, {}); revoked.revoke();
    for (const run of [class OperationClass {}, revoked.proxy]) {
      let runtime: WorkRuntime | undefined;
      await expect(drive(value => { runtime = value; return one({ visits: 1, utf8Bytes: 0, run }); }))
        .rejects.toBeInstanceOf(TypeError);
      if (runtime) expect(runtime.snapshot().visits).toBe(1);
    }
  });
  it('forwards result then-getter identity and allows application recovery', async () => {
    const sentinel = new Error('then getter');
    expect(await drive(() => (function* (): Work<string> {
      try { yield* effect(1, () => ({ get then() { throw sentinel; } })); }
      catch (error) { expect(error).toBe(sentinel); }
      return yield* effect(1, () => 'recovered');
    })())).toBe('recovered');
  });

  if (mode === 'async') {
    it('keeps successful guard counts unchanged', async () => {
      let runtime: WorkRuntime | undefined;
      await drive(value => { runtime = value; return (function* () { yield* effect(1, () => {}); yield* effect(1, () => {}); })(); });
      expect(runtime!.snapshot()).toMatchObject({ visits: 2, checks: 15, yields: 0 });
    });
    it('isolates guard-time mutations, recaptures later yields and uses the current phase', async () => {
      let runtime: WorkRuntime | undefined, armed = false, changed = false;
      const called: string[] = [];
      const raw: Record<string, unknown> = { visits: 1, utf8Bytes: 2, nativeKind: 'keys', metric: 'visits' };
      const second = function (this: Operation) { called.push('second'); expect(this.visits).toBe(3); };
      Object.defineProperty(raw, 'run', { configurable: true, get() { armed = true; return function (this: Operation) {
        called.push('first'); expect(this.visits).toBe(1); expect(this.metric).toBe('visits'); runtime!.setContext('verify');
      }; } });
      await drive(value => { runtime = value; return (function* () { yield raw as unknown as Operation; yield raw as unknown as Operation; })(); }, {
        assertCurrent() { if (armed && !changed) {
          changed = true; Object.assign(raw, { visits: 3, utf8Bytes: 4, nativeKind: undefined, metric: undefined });
          Object.defineProperty(raw, 'run', { value: second, configurable: true }); runtime!.setContext('reserve');
        } },
      });
      expect(called).toEqual(['first', 'second']);
      expect(runtime!.snapshot()).toMatchObject({ visits: 5, emittedBytes: 6, primitiveExceptions: 1 });
      expect(runtime!.snapshot('reserve').visits).toBe(2); expect(runtime!.snapshot('verify').visits).toBe(3);
    });
    it.each(['visits-observer', 'bytes-observer', 'visits-yield', 'bytes-yield'])('isolates suspension mutation at %s', async point => {
      let armed = false, mutated = false, calls = 0;
      const raw: Record<string, unknown> = { visits: 1, utf8Bytes: 1 };
      Object.defineProperty(raw, 'run', { configurable: true, get() { armed = true; return function (this: Operation) {
        calls++; expect(this.visits).toBe(1); expect(this.utf8Bytes).toBe(1);
      }; } });
      const mutate = () => { if (armed && !mutated) {
        mutated = true; Object.assign(raw, { visits: 0, utf8Bytes: Infinity });
        Object.defineProperty(raw, 'run', { value() { throw new Error('replacement ran'); } });
      } };
      await drive(() => (function* () {
        yield* effect(point.startsWith('visits') ? 1024 : 1, () => {}, point.startsWith('bytes') ? 65536 : 0);
        yield raw as unknown as Operation;
      })(), { assertCurrent() {}, observe() { if (point.endsWith('observer')) mutate(); },
        async yieldTask() { if (point.endsWith('yield')) mutate(); } });
      expect(mutated).toBe(true); expect(calls).toBe(1);
    });
    it.each(['getter', 'after-capture', 'observer', 'yield', 'callback', 'then', 'generator', 'finally'])
    ('retains cancellation precedence and ownership at %s', async point => {
      const lifecycle = new Error('lifecycle'); let current = true, armed = false, caught = 0, closed = 0, calls = 0;
      let runtime: WorkRuntime | undefined;
      const raw = { visits: 1, utf8Bytes: 0, get run() {
        armed = true; if (point === 'getter') current = false;
        return () => { calls++; if (point === 'callback') { current = false; throw new Error('application'); }
          if (point === 'then') return { get then() { current = false; throw new Error('application'); } }; };
      } };
      await expect(drive(value => { runtime = value; return (function* () {
        const lease = yield* retainWork(7);
        try {
          yield* effect(1023, () => {});
          try { yield raw; } catch { caught++; }
          if (point === 'generator') { current = false; throw new Error('application'); }
        } finally { lease.release(); closed++; if (point === 'finally') { current = false; throw new Error('cleanup'); } }
      })(); }, { assertCurrent() {
        if (armed && point === 'after-capture') current = false;
        if (!current) throw lifecycle;
      }, observe() { if (armed && point === 'observer') current = false; },
      async yieldTask() { if (armed && point === 'yield') { current = false; throw new Error('scheduler'); } } }))
        .rejects.toBe(lifecycle);
      expect(armed).toBe(true); expect(caught).toBe(0); expect(closed).toBe(1);
      const executed = ['callback', 'then', 'generator', 'finally'].includes(point);
      expect(calls).toBe(executed ? 1 : 0);
      expect(runtime!.snapshot()).toMatchObject({ ownedBytes: 0, observedAborts: 1, visits: executed ? 1025 : 1024 });
    });
  }
});
```

- [x] **Step 3: Write baseline/negative-control transforms and overlay config.** `dispatch-variant.mjs` initially contains only this code; the scalar transform is added in Task2 after baseline characterization passes.

```javascript
import assert from 'node:assert/strict';
export const root = '/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence';
export const directory = '/tmp/opencode/doctect-incremental-sdd';
export const session = process.env.DISPATCH_SESSION ?? `${directory}/task-13-work-dispatch-01`;
assert.match(session, new RegExp(`^${directory}/task-13-work-dispatch-[0-9]+$`));
export const workPath = `${root}/shared/cooperativeWork.js`;
export const workTestPath = `${root}/tests/unit/localWorkspace/normalized/work.test.ts`;
export function once(source, from, to) {
  assert.equal(source.split(from).length, 2, `Dispatch anchor changed: ${from}`);
  return source.replace(from, to);
}
export function variantSource(source, variant) {
  if (variant === 'baseline') return source;
  const returned = '  return { visits, utf8Bytes, nativeKind, metric, run };';
  if (variant === 'raw-receiver') return once(source, returned, '  return operation;');
  if (variant === 'pooled-receiver') return 'const __dispatchReceiver = {};\n' + once(source, returned,
    '  return Object.assign(__dispatchReceiver, { visits, utf8Bytes, nativeKind, metric, run });');
  if (variant === 'early-validation') return once(source,
    '  const { visits, utf8Bytes, nativeKind, metric, run } = operation;',
    '  const visits = operation.visits; nonnegativeInteger(visits);\n  const { utf8Bytes, nativeKind, metric, run } = operation;');
  if (variant === 'unbound') return once(once(source, 'operation.run(undefined)', '(0, operation.run)(undefined)'),
    'operation.run(runtime)', '(0, operation.run)(runtime)');
  if (variant === 'missing-guard') return once(source,
    '          try { value = synchronousResult(operation.run(runtime)); }\n          finally { assertCurrent(); }',
    '          try { value = synchronousResult(operation.run(runtime)); }\n          finally {}');
  throw new Error(`Unknown dispatch variant: ${variant}`);
}
```

`dispatch.config.mjs`:

```javascript
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import baseConfig from '/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/vite.config.ts';
import { root, directory, session, workPath, workTestPath, variantSource } from './dispatch-variant.mjs';
import { testPath, appendNodeDiagnostic, instrument } from './fullsize-tools.mjs';
export default environment => {
  const base = baseConfig(environment), mode = process.env.DISPATCH_MODE ?? 'contracts';
  const variant = process.env.DISPATCH_VARIANT ?? 'baseline';
  assert.ok(['contracts', 'core', 'original', 'diagnostic'].includes(mode));
  if (mode === 'original' || mode === 'diagnostic') assert.ok(['baseline', 'scalar'].includes(variant));
  return { ...base, root, cacheDir: `/tmp/opencode/dispatch-${mode}-${variant}-cache`,
    test: { ...base.test, ...(mode === 'diagnostic' ? { setupFiles: [
      `${root}/tests/setup.ts`, `${session}/node-setup.mjs`,
    ] } : {}) },
    plugins: [...base.plugins, { name: 'external-work-dispatch', enforce: 'pre', transform(code, id) {
      let changed = code;
      if (id === workTestPath && ['contracts', 'core'].includes(mode)) {
        assert.ok(!code.includes('operation capture and scalar dispatch compatibility'));
        changed += '\n' + readFileSync(`${directory}/dispatch-cases.ts.txt`, 'utf8');
      }
      if (id === workPath) changed = variantSource(changed, variant);
      if (mode === 'diagnostic') {
        if (id === testPath) changed = appendNodeDiagnostic(changed, process.env.FULLSIZE_MODE === 'smoke');
        else changed = instrument(changed, id) ?? changed;
      }
      return changed === code ? undefined : { code: changed, map: null };
    } }] };
};
```

- [x] **Step 4: Run baseline characterization, then each negative control in a separate process.** Use the real Work module through the original test file. Do not instantiate a copied miniature executor. Capture each run with exclusive reporter output; these commands intentionally select only the appended group:

```bash
FOUNDATION_CASE_LOG=/tmp/opencode/doctect-incremental-sdd/dispatch-contract-baseline-01.jsonl DISPATCH_VARIANT=baseline npx vitest run tests/unit/localWorkspace/normalized/work.test.ts --config=/tmp/opencode/doctect-incremental-sdd/dispatch.config.mjs --testNamePattern="operation capture and scalar dispatch compatibility" --maxWorkers=1 --reporter=/tmp/opencode/foundation-case-reporter.mjs
```

Run the finite negative matrix, preserving each failure log:

```bash
for variant in raw-receiver pooled-receiver early-validation unbound missing-guard; do if FOUNDATION_CASE_LOG="/tmp/opencode/doctect-incremental-sdd/dispatch-contract-${variant}-01.jsonl" DISPATCH_VARIANT="$variant" npx vitest run tests/unit/localWorkspace/normalized/work.test.ts --config=/tmp/opencode/doctect-incremental-sdd/dispatch.config.mjs --testNamePattern="operation capture and scalar dispatch compatibility" --maxWorkers=1 --reporter=/tmp/opencode/foundation-case-reporter.mjs; then exit 1; fi; done
```

Expected: baseline all90selected cases pass; every mutant has a failed characterization assertion, not a module/parse/unhandled failure. Inspect every terminal event; Task2's runner also validates these logs before timing. This is a finite matrix, not retries. Existing original performance failures are separate; negative controls are never benchmark candidates.

- [x] **Step 5: Review the characterization deliverable.** Confirm same original Work test prefix, once-only capture and receiver cases reach the intended points, authentic cancellation fires after descriptor capture, and all runtimes dispose. Record actual case inventory/counts and negative-control failures in the ledger. Stop if baseline fails; fix the harness, not application semantics.

Task1 evidence2026-09-29: baseline receipt01 initially had88PASS/2FAIL. Vitest4's `toBe` performs deep equality when identities differ even under `.not`; passing the raw Proxy to that matcher introduced eight diagnostic Gets. The identity assertion now passes only `this === raw` to `expect`, preserving the intended identity check without inspecting the descriptor. Receipt02 has90PASS/245original skipped, inventory335. No runtime change. All five negative01receipts have90selected/no unhandled or module errors: raw-receiver15FAIL, pooled-receiver4FAIL, early-validation8FAIL, unbound17FAIL, missing-guard1FAIL. Each has intended assertion failures; no timeout or parse/module failure substitutes for sensitivity. The original Work file and imports remain untouched, authentic runtime guards/ownership/disposal are exercised. Snapshot and failed receipt01 remain retained.

### Task 2: Build the Exact External Candidate and Complete-Phase Evidence

**Files:** Extend `D/dispatch-variant.mjs`; create `D/dispatch-evidence.mjs`, `D/dispatch-tools.test.mjs`, `D/dispatch-runner-source.mjs`, `D/dispatch-run.mjs`. Generated collector/setup/native files belong under `D/task-13-work-dispatch-01/`. Existing `fullsize-*` tools/receipts remain immutable.

**Interfaces:** Consume `once`, `variantSource`, the characterization block, `appendNodeDiagnostic`, `instrument`, existing Node/native runners and `sourceStamp()`. Produce `scalarSource(source): string`, `fullCollector(source): string`, receipt checks, and exclusive serial trial commands. No application writes.

- [x] **Step 1: Add failing source/collector/decision tests before the implementations.** The missing exports are the intended tooling RED; baseline characterization stays green. Create `dispatch-tools.test.mjs` with the following tests, adding imports as the exports become available:

```javascript
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { root, directory, session, workPath } from './dispatch-variant.mjs';
const variants = await import('./dispatch-variant.mjs');
const evidence = await import('./dispatch-evidence.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {}; throw error;
});
const runners = await import('./dispatch-runner-source.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {}; throw error;
});
const source = readFileSync(workPath, 'utf8');
test('candidate changes only capture/validation/dispatch and keeps guards and scheduler', () => {
  assert.equal(typeof variants.scalarSource, 'function');
  const changed = variants.scalarSource(source);
  const ts = createRequire(`${root}/package.json`)('typescript');
  assert.equal(ts.createSourceFile('candidate.js', changed, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS).parseDiagnostics.length, 0);
  for (const expression of [/assertCurrent\(\)/g, /await yieldTask\(\)/g, /increment\('yields'\)/g]) {
    assert.equal([...changed.matchAll(expression)].length, [...source.matchAll(expression)].length);
  }
  for (const text of ['const visitLimit = 1024;', 'const byteLimit = 65536;', 'Object.freeze(runtime);']) assert.ok(changed.includes(text));
  assert.throws(() => variants.scalarSource(''), /anchor changed/);
  assert.throws(() => variants.scalarSource(changed), /anchor changed/);
  assert.equal(variants.variantSource(source, 'baseline'), source);
});
test('complete collector retains check-only, abort-only and zero phases', async () => {
  assert.equal(typeof evidence.fullCollector, 'function');
  const original = readFileSync(`${directory}/fullsize-collector.mjs`, 'utf8');
  const changed = evidence.fullCollector(original);
  const { createCollector } = await import(`data:text/javascript;base64,${Buffer.from(changed).toString('base64')}`);
  const diagnostic = createCollector(); diagnostic.begin('probe');
  const phases = new Map(evidence.phaseNames.map(phase => [phase, { visits: 0, checks: 0, observedAborts: 0 }]));
  phases.get('verify').checks = 3; phases.get('reopen').observedAborts = 1;
  diagnostic.runtimeEnd({ visits: 0, checks: 3, observedAborts: 1 }, phases);
  const report = diagnostic.finish('passed');
  assert.equal(report.phaseCoverage, 'all-phases-v1');
  assert.deepEqual(report.runtimeCounters[0].phases.map(row => row.phase), evidence.phaseNames);
  assert.equal(report.runtimeCounters[0].phases.find(row => row.phase === 'verify').counters.checks, 3);
  assert.throws(() => evidence.fullCollector(changed), /anchor changed/);
});
test('screen rejects weak/mixed results and any recorded work mismatch', () => {
  assert.equal(typeof evidence.screen, 'function');
  const runtimeCounters = [{ parent: 'probe', counters: { checks: 3 }, phases: evidence.phaseNames.map(phase => ({ phase, counters: { checks: phase === 'verify' ? 3 : 0 } })) }];
  const report = ms => ({ outcome: 'passed', identity: 'fixture', phaseCoverage: 'all-phases-v1',
    platform: 'node-fake-indexeddb', stages: [{ label: 'probe' }], runtimeCounters: structuredClone(runtimeCounters), ms });
  assert.equal(evidence.screen([report(100), report(80), report(85), report(100)]).passed, true);
  assert.throws(() => evidence.screen([report(100), report(95), report(95), report(100)]), /ten-percent/);
  assert.throws(() => evidence.screen([report(100), report(80), report(101), report(100)]), /matched pair/);
  const changed = report(80); changed.runtimeCounters[0].phases[0].counters.checks++;
  assert.throws(() => evidence.screen([report(100), changed, report(80), report(100)]), /work differs/);
  assert.throws(() => evidence.parity(report(100), { ...report(80), phaseCoverage: undefined }), /coverage/);
});
test('Node/native runner derivation retains timeout/cleanup paths and fails closed', () => {
  assert.equal(typeof runners.deriveRunnerSource, 'function');
  const ts = createRequire(`${root}/package.json`)('typescript');
  for (const kind of ['node', 'native']) {
    const original = readFileSync(`${directory}/run-fullsize-${kind}.mjs`, 'utf8');
    const options = { kind, output: `${session}/probe`, variant: 'scalar', mode: 'full', metadata: { variant: 'scalar' } };
    const changed = runners.deriveRunnerSource(original, options);
    assert.equal(ts.createSourceFile('runner.mjs', changed, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS).parseDiagnostics.length, 0);
    for (const text of kind === 'node' ? ['960000', "process.kill(-child.pid, 'SIGTERM')", 'assert.deepEqual(after, before)']
      : ['900000', 'await context?.close(); await browser?.close();', 'assert.deepEqual(after, before)']) assert.ok(changed.includes(text));
    assert.throws(() => runners.deriveRunnerSource('', options), /anchor changed/);
    assert.throws(() => runners.deriveRunnerSource(changed, options), /anchor changed/);
  }
});
test('report parser refuses missing end, unhandled/module errors and failed selected cases', () => {
  assert.equal(typeof evidence.parseCases, 'function');
  const good = [{ kind: 'result', state: 'passed' }, { kind: 'end', errors: [], moduleErrors: [] }];
  assert.equal(evidence.requirePassed(evidence.parseCases(good), 1).results.length, 1);
  assert.throws(() => evidence.parseCases(good.slice(0, 1)), /terminal/);
  for (const key of ['errors', 'moduleErrors']) assert.throws(() => evidence.parseCases([
    good[0], { ...good[1], [key]: [{ message: 'unexpected' }] },
  ]));
  assert.throws(() => evidence.requirePassed(evidence.parseCases([{ ...good[0], state: 'failed' }, good[1]]), 1), /case failed/);
});
```

Run `node --test /tmp/opencode/doctect-incremental-sdd/dispatch-tools.test.mjs`. Expected initial failures identify missing candidate/evidence helpers. Do not interpret a missing external dependency or syntax error as the intended RED.

- [x] **Step 2: Implement only the approved scalar transformation.** Add `if (variant === 'scalar') return scalarSource(source);` immediately after the baseline branch of `variantSource`, and append this complete function:

```javascript
export function scalarSource(source) {
  let code = once(source, `function operationFields(operation) {
  // Capture once: budget validation and execution use exactly the same fields.
  const { visits, utf8Bytes, nativeKind, metric, run } = operation;`,
  'function validateOperationFields(visits, utf8Bytes, nativeKind, metric, run) {');
  code = once(code, '  return { visits, utf8Bytes, nativeKind, metric, run };\n}', '}');
  code = once(code, `        const operation = operationFields(step.value);
        value = synchronousResult(operation.run(undefined));`, `        const operation = step.value;
        const { visits, utf8Bytes, nativeKind, metric, run: execute } = operation;
        validateOperationFields(visits, utf8Bytes, nativeKind, metric, execute);
        const receiver = { visits, utf8Bytes, nativeKind, metric, run: execute };
        value = synchronousResult(receiver.run(undefined));`);
  code = once(code, '          const operation = operationFields(step.value);', `          const operation = step.value;
          const { visits, utf8Bytes, nativeKind, metric, run: execute } = operation;
          validateOperationFields(visits, utf8Bytes, nativeKind, metric, execute);`);
  for (const field of ['visits', 'utf8Bytes', 'nativeKind', 'metric']) {
    assert.ok(code.includes(`operation.${field}`), `Missing accounting field ${field}`);
    code = code.replaceAll(`operation.${field}`, field);
  }
  return once(code, '          try { value = synchronousResult(operation.run(runtime)); }', `          try {
            const receiver = { visits, utf8Bytes, nativeKind, metric, run: execute };
            value = synchronousResult(receiver.run(runtime));
          }`);
}
```

No numeric fast path, prototype change, `Function.call`, callback rebinding, capture-slot reuse or changed guard is allowed. Inspect the complete generated source against the immutable baseline before executing it. The helper's argument named `run` remains the captured callback; exported `runSync`/runtime interfaces are unchanged.

- [x] **Step 3: Implement complete phase capture and deterministic comparison helpers in `dispatch-evidence.mjs`.** This creates a new collector version, not a reinterpretation of filtered old reports.

```javascript
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { once } from './dispatch-variant.mjs';
export const phaseNames = ['discovery', 'prerequisite', 'prepare', 'reserve', 'stage', 'verify', 'activate', 'reopen', 'retained', 'recovery', 'legacy-fence'];
export function fullCollector(source) {
  let changed = once(source,
    '[...phases].filter(([, value]) => value.visits || value.candidateRows || value.hashBytes)', '[...phases]');
  return once(changed, 'const result = { diagnosticOnly: true, outcome,',
    "const result = { diagnosticOnly: true, phaseCoverage: 'all-phases-v1', outcome,");
}
export function parseCases(rows) {
  const end = rows.findLast(row => row.kind === 'end');
  assert.ok(end, 'Missing terminal reporter event');
  assert.equal(end.errors.length, 0); assert.equal(end.moduleErrors.length, 0);
  return { rows, end, results: rows.filter(row => row.kind === 'result' && row.state !== 'skipped'),
    inventory: rows.filter(row => row.kind === 'inventory').flatMap(row => row.tests) };
}
export function casesAt(path) {
  return parseCases(readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)));
}
export function requirePassed(parsed, expected) {
  assert.ok(parsed.results.length > 0, 'No selected cases');
  if (expected !== undefined) assert.equal(parsed.results.length, expected, 'Wrong selected count');
  assert.ok(parsed.results.every(row => row.state === 'passed'), 'Selected case failed');
  return parsed;
}
export function passedCases(path, expected) { return requirePassed(casesAt(path), expected); }
export function complete(report) {
  assert.equal(report.outcome, 'passed'); assert.equal(typeof report.identity, 'string');
  assert.ok(Number.isFinite(report.ms) && report.ms > 0, 'Invalid elapsed time');
  assert.equal(report.phaseCoverage, 'all-phases-v1', 'Incomplete phase coverage');
  assert.ok(report.runtimeCounters.length > 0);
  for (const runtime of report.runtimeCounters) {
    assert.deepEqual(runtime.phases.map(row => row.phase), phaseNames, 'Incomplete phase coverage');
    for (const phase of runtime.phases) assert.deepEqual(Object.keys(phase.counters).sort(), Object.keys(runtime.counters).sort());
  }
}
export function parity(baseline, candidate) {
  complete(baseline); complete(candidate);
  assert.equal(candidate.platform, baseline.platform); assert.equal(candidate.identity, baseline.identity);
  assert.deepEqual(candidate.stages.map(row => row.label), baseline.stages.map(row => row.label));
  assert.deepEqual(candidate.runtimeCounters, baseline.runtimeCounters, 'Recorded work differs');
}
export function screen(reports) {
  assert.equal(reports.length, 4);
  for (const report of reports) parity(reports[0], report);
  const [a1, b1, b2, a2] = reports.map(report => report.ms);
  assert.ok(b1 < a1 && b2 < a2, 'Candidate did not beat each matched pair');
  const baselineMedianMs = (a1 + a2) / 2, candidateMedianMs = (b1 + b2) / 2;
  assert.ok(candidateMedianMs <= 0.9 * baselineMedianMs, 'Candidate failed ten-percent screen');
  return { passed: true, diagnosticOnly: true, baselineMedianMs, candidateMedianMs, pairedMs: [a1, b1, b2, a2] };
}
```

- [x] **Step 4: Create the pure runner-source module and command runner below, then run `init`.** The runner reuses existing tested body derivation, per-case reporter, child cleanup and native isolation. `init` creates only external adapters, reviewable source copies and a manifest; it must refuse an existing session directory. It does not run the candidate. A correctness-tool correction needs a new numbered `DISPATCH_SESSION`, retained old evidence and a new frozen manifest; a failed performance gate does not authorize another session to search for a pass. Pass the same `DISPATCH_SESSION` explicitly in every subsequent call when not using the default01session.

`dispatch-runner-source.mjs`:

```javascript
import assert from 'node:assert/strict';
import { directory, session, once } from './dispatch-variant.mjs';
export function deriveRunnerSource(source, { kind, output, variant, mode, metadata }) {
  assert.ok(['node', 'native'].includes(kind)); assert.ok(['baseline', 'scalar'].includes(variant));
  assert.ok(['full', 'smoke'].includes(mode)); assert.ok(output.startsWith(session + '/'));
  source = once(source, "from './check-normalization-emission-plan.mjs'", `from 'file://${directory}/check-normalization-emission-plan.mjs'`);
  source = once(source, "from './fullsize-tools.mjs'", `from 'file://${directory}/fullsize-tools.mjs'`);
  source = once(source, "const mode = process.argv[2] ?? 'full';", `const mode = ${JSON.stringify(mode)};`);
  if (kind === 'node') {
    source = once(source, "const output = mkdtempSync('/tmp/opencode/doctect-incremental-sdd/task-13-fullsize-node-');",
      `const output = ${JSON.stringify(output)}; __dispatchMkdir(output);`);
    source = once(source, '--config=/tmp/opencode/doctect-incremental-sdd/fullsize-node.config.mjs', `--config=${directory}/dispatch.config.mjs`);
    source = once(source, '{ diagnosticOnly: true, mode, before, after, args, result, killed, wallMs:',
      `{ diagnosticOnly: true, ...${JSON.stringify(metadata)}, mode, before, after, args, result, killed, wallMs:`);
  } else {
    source = once(source, 'const output = mkdtempSync(`/tmp/opencode/doctect-incremental-sdd/task-13-fullsize-native-${mode}-`);',
      `const output = ${JSON.stringify(output)}; __dispatchMkdir(output);`);
    source = once(source, 'browserHarnessSource, instrument }', 'browserHarnessSource, instrument as __baseInstrument }');
    source = `import { variantSource as __variantSource, workPath as __workPath } from 'file://${directory}/dispatch-variant.mjs';\n`
      + `const instrument = (code, id) => { const next = id === __workPath ? __variantSource(code, ${JSON.stringify(variant)}) : code; return __baseInstrument(next, id) ?? (next === code ? undefined : next); };\n` + source;
    source = once(source, '/tmp/opencode/doctect-incremental-sdd/fullsize-native-entry.ts', `${session}/entry.ts`);
    source = once(source, '{ diagnosticOnly: true, mode, before, after, wallMs:',
      `{ diagnosticOnly: true, ...${JSON.stringify(metadata)}, mode, before, after, wallMs:`);
  }
  return "import { mkdirSync as __dispatchMkdir } from 'node:fs';\n" + source;
}
```

`dispatch-run.mjs`:

```javascript
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { root, directory, session, workPath, once, variantSource } from './dispatch-variant.mjs';
import { sourceStamp } from './check-normalization-emission-plan.mjs';
import { fullCollector, casesAt, passedCases, parity, screen } from './dispatch-evidence.mjs';
import { deriveRunnerSource } from './dispatch-runner-source.mjs';
const [command, argument] = process.argv.slice(2);
const expectedStamp = { sha256: '062de1ac74c376e26effe619bf96d203ff21cd290b9573de1181f1179b49db18', files: 1170 };
const read = path => readFileSync(path, 'utf8');
const json = path => JSON.parse(read(path));
const write = (path, value) => writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2), { flag: 'wx' });
const hash = value => createHash('sha256').update(value).digest('hex');
const files = [
  'dispatch-variant.mjs', 'dispatch.config.mjs', 'dispatch-cases.ts.txt', 'dispatch-evidence.mjs', 'dispatch-tools.test.mjs', 'dispatch-runner-source.mjs', 'dispatch-run.mjs',
  'fullsize-tools.mjs', 'fullsize-collector.mjs', 'fullsize-node-setup.mjs', 'run-fullsize-node.mjs',
  'run-fullsize-native.mjs', 'fullsize-worker.ts', 'fullsize-native-entry.ts', 'check-normalization-emission-plan.mjs',
].map(name => `${directory}/${name}`).concat('/tmp/opencode/foundation-case-reporter.mjs',
  ['collector.mjs', 'node-setup.mjs', 'worker.ts', 'entry.ts', 'baseline-work.js', 'scalar-work.js'].map(name => `${session}/${name}`));
const assetHashes = () => Object.fromEntries(files.map(path => [path, hash(readFileSync(path))]));
const sourceSha = variant => hash(variantSource(read(workPath), variant));
const assertFrozen = () => {
  assert.deepEqual(sourceStamp(), expectedStamp, 'Application changed during experiment');
  const manifest = json(`${session}/manifest.json`);
  assert.deepEqual(manifest.stamp, expectedStamp); assert.deepEqual(manifest.assets, assetHashes(), 'Diagnostic assets changed');
  return manifest;
};
const trial = name => `${session}/${name}`;
function successful(name) {
  assertFrozen(); const run = json(`${trial(name)}/run.json`);
  const baselines = ['A1', 'A2', 'smoke-baseline', 'native-baseline'];
  assert.ok([...baselines, 'B1', 'B2', 'smoke-scalar', 'native-scalar'].includes(name));
  assert.equal(run.variant, baselines.includes(name) ? 'baseline' : 'scalar');
  assert.equal(run.mode, name.startsWith('smoke-') ? 'smoke' : 'full');
  assert.deepEqual(run.before, expectedStamp); assert.deepEqual(run.after, expectedStamp);
  assert.deepEqual(run.dispatchAssets, assetHashes());
  assert.equal(run.variantSourceSha256, sourceSha(run.variant));
  if (name.startsWith('native-')) assert.equal(run.error, undefined);
  else { assert.equal(run.result?.code, 0); assert.equal(run.killed, false); }
  const report = json(`${trial(name)}/report.json`);
  if (existsSync(`${trial(name)}/cases.jsonl`)) passedCases(`${trial(name)}/cases.jsonl`, 1);
  return report;
}
function verifyNegatives() {
  for (const variant of ['raw-receiver', 'pooled-receiver', 'early-validation', 'unbound', 'missing-guard']) {
    const run = json(`${trial(`negative-${variant}`)}/run.json`);
    assert.equal(run.result.code, 1); assert.equal(run.killed, false); assert.equal(run.expectedFailure, true);
    assert.equal(run.variant, variant); assert.deepEqual(run.before, expectedStamp); assert.deepEqual(run.after, expectedStamp);
    assert.deepEqual(run.dispatchAssets, assetHashes()); assert.equal(run.variantSourceSha256, sourceSha(variant));
    const parsed = casesAt(`${trial(`negative-${variant}`)}/cases.jsonl`);
    assert.equal(parsed.results.length, 90);
    const failures = parsed.results.filter(row => row.state === 'failed');
    assert.ok(failures.some(row => row.errors?.some(error => error.name === 'AssertionError')), `Insensitive control ${variant}`);
    assert.ok(!failures.some(row => row.errors?.some(error => /timed out/i.test(error.message))), 'Timeout is not a negative-control proof');
  }
}
async function vitest(name, variant, mode, selectedFiles, pattern, expectedCount, wallMs, expectedFailure = false) {
  assertFrozen(); const output = trial(name); mkdirSync(output);
  const args = ['run', ...selectedFiles, `--config=${directory}/dispatch.config.mjs`, '--maxWorkers=1',
    '--includeTaskLocation', '--silent=passed-only', '--reporter=/tmp/opencode/foundation-case-reporter.mjs',
    ...(pattern ? [`--testNamePattern=${pattern}`] : [])];
  const before = sourceStamp(), assets = assetHashes(), started = Date.now();
  const log = createWriteStream(`${output}/vitest.log`, { flags: 'wx' });
  const child = spawn(process.execPath, [`${root}/node_modules/vitest/vitest.mjs`, ...args], {
    cwd: root, detached: true, env: { ...process.env, TMPDIR: '/tmp/opencode', DISPATCH_SESSION: session,
      DISPATCH_MODE: mode, DISPATCH_VARIANT: variant, FOUNDATION_CASE_LOG: `${output}/cases.jsonl`, FOUNDATION_SOURCE_STAMP: before.sha256 },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let killed = false, hard;
  const stop = () => { killed = true; try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    hard = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 5000); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const timer = setTimeout(stop, wallMs);
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { log.write(chunk); process.stdout.write(chunk); });
  let result;
  try { result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); }); }
  finally { clearTimeout(timer); clearTimeout(hard); log.end(); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
  const after = sourceStamp();
  write(`${output}/run.json`, { diagnosticOnly: mode !== 'original', expectedFailure, variant, mode, before, after, args, result, killed,
    wallMs: Date.now() - started, dispatchAssets: assets, variantSourceSha256: sourceSha(variant) });
  assert.deepEqual(after, before); assertFrozen(); assert.equal(killed, false); assert.equal(result.code, expectedFailure ? 1 : 0);
  if (expectedFailure) {
    const parsed = casesAt(`${output}/cases.jsonl`); assert.equal(parsed.results.length, expectedCount);
    assert.ok(parsed.results.some(row => row.state === 'failed' && row.errors?.some(error => error.name === 'AssertionError')));
    return parsed;
  }
  return passedCases(`${output}/cases.jsonl`, expectedCount);
}
async function derivedRunner(kind, name, variant, mode) {
  assertFrozen(); assert.ok(['baseline', 'scalar'].includes(variant));
  const output = trial(name); assert.ok(!existsSync(output));
  const metadata = { variant, dispatchAssets: assetHashes(), variantSourceSha256: sourceSha(variant) };
  const source = deriveRunnerSource(read(`${directory}/run-fullsize-${kind}.mjs`), { kind, output, variant, mode, metadata });
  process.env.DISPATCH_SESSION = session; process.env.DISPATCH_VARIANT = variant; process.env.DISPATCH_MODE = 'diagnostic';
  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  assertFrozen(); return successful(name);
}

if (command === 'init') {
  assert.deepEqual(sourceStamp(), expectedStamp); mkdirSync(session);
  write(`${session}/collector.mjs`, fullCollector(read(`${directory}/fullsize-collector.mjs`)));
  write(`${session}/node-setup.mjs`, once(read(`${directory}/fullsize-node-setup.mjs`), "'./fullsize-collector.mjs'", "'./collector.mjs'"));
  write(`${session}/worker.ts`, once(read(`${directory}/fullsize-worker.ts`), "'./fullsize-collector.mjs'", "'./collector.mjs'"));
  write(`${session}/entry.ts`, once(read(`${directory}/fullsize-native-entry.ts`), "'./fullsize-worker.ts'", "'./worker.ts'"));
  for (const variant of ['baseline', 'scalar']) write(`${session}/${variant}-work.js`, variantSource(read(workPath), variant));
  write(`${session}/manifest.json`, { stamp: expectedStamp, assets: assetHashes(), createdAt: new Date().toISOString() });
  console.log('DISPATCH_SESSION', session);
} else if (command === 'verify-negatives') {
  assertFrozen(); verifyNegatives(); console.log('NEGATIVE_CONTROLS_PASS');
} else if (command === 'negative') {
  assert.ok(['raw-receiver', 'pooled-receiver', 'early-validation', 'unbound', 'missing-guard'].includes(argument));
  await vitest(`negative-${argument}`, argument, 'contracts', ['tests/unit/localWorkspace/normalized/work.test.ts'],
    'operation capture and scalar dispatch compatibility', 90, 240000, true);
} else if (command === 'contracts' || command === 'core') {
  assert.ok(['baseline', 'scalar'].includes(argument));
  const selected = command === 'contracts' ? ['tests/unit/localWorkspace/normalized/work.test.ts'] : [
    'tests/unit/localWorkspace/normalized/work.test.ts', 'tests/unit/localWorkspace/canonical.test.ts',
    'tests/unit/localWorkspace/normalized/codec.test.ts', 'tests/unit/localWorkspace/normalized/incrementalSha256.test.ts',
    'tests/unit/localWorkspace/normalized/commitProof.test.ts',
  ];
  await vitest(`${command}-${argument}`, argument, command, selected,
    command === 'contracts' ? 'operation capture and scalar dispatch compatibility' : undefined,
    command === 'contracts' ? 90 : 623, 240000);
} else if (command === 'smoke') {
  await derivedRunner('node', `smoke-${argument}`, argument, 'smoke');
} else if (command === 'smoke-parity') {
  parity(successful('smoke-baseline'), successful('smoke-scalar')); console.log('SMOKE_PARITY_PASS');
} else if (command === 'full') {
  const order = ['A1', 'B1', 'B2', 'A2']; assert.ok(order.includes(argument)); verifyNegatives();
  for (const name of ['contracts-baseline', 'contracts-scalar', 'core-baseline', 'core-scalar']) {
    const run = json(`${trial(name)}/run.json`); assert.equal(run.result.code, 0); assert.equal(run.killed, false);
    assert.deepEqual(run.before, expectedStamp); assert.deepEqual(run.after, expectedStamp);
    assert.deepEqual(run.dispatchAssets, assetHashes()); assert.equal(run.variant, name.split('-').at(-1));
    assert.equal(run.variantSourceSha256, sourceSha(run.variant));
    passedCases(`${trial(name)}/cases.jsonl`, name.startsWith('core') ? 623 : 90);
  }
  parity(successful('smoke-baseline'), successful('smoke-scalar'));
  for (const prior of order.slice(0, order.indexOf(argument))) successful(prior);
  if (argument === 'B2' || argument === 'A2') {
    parity(successful('A1'), successful('B1')); assert.ok(successful('B1').ms < successful('A1').ms, 'First pair has no improvement; stop');
  }
  await derivedRunner('node', argument, argument.startsWith('A') ? 'baseline' : 'scalar', 'full');
} else if (command === 'first-pair') {
  const baseline = successful('A1'), candidate = successful('B1'); parity(baseline, candidate);
  assert.ok(candidate.ms < baseline.ms, 'First pair has no improvement; stop'); console.log('FIRST_PAIR_PASS');
} else if (command === 'screen') {
  const reports = ['A1', 'B1', 'B2', 'A2'].map(successful);
  const result = screen(reports); write(`${session}/screen.json`, result); console.log(result);
} else if (command === 'gates') {
  assert.equal(json(`${session}/screen.json`).passed, true);
  const parsed = await vitest('gates', 'scalar', 'original', ['tests/unit/localWorkspace/normalized/migration.test.ts'],
    'normalization preserves original 32MiB state boundary and refuses one extra UTF-8 byte|prepared replay preserves independent physical rows and batch order for (fresh|historical) source', 3, 430000);
  const runConfig = parsed.rows.find(row => row.kind === 'run').config;
  assert.equal(runConfig.testTimeout, 5000);
  for (const row of parsed.results) assert.equal(row.options.timeout ?? runConfig.testTimeout, row.name.includes('32MiB') ? 360000 : 5000);
  write(`${session}/gates-passed.json`, { passed: true });
} else if (command === 'native') {
  assert.equal(json(`${session}/gates-passed.json`).passed, true); assertFrozen();
  if (argument === 'scalar') successful('native-baseline');
  await derivedRunner('native', `native-${argument}`, argument, 'full');
} else if (command === 'native-screen') {
  const baseline = successful('native-baseline'), candidate = successful('native-scalar'); parity(baseline, candidate);
  assert.equal(candidate.browserVersion, baseline.browserVersion);
  assert.ok(candidate.ms < baseline.ms, 'No native benefit; promotion blocked');
  write(`${session}/promotion-eligible.json`, { eligible: true, baselineMs: baseline.ms, candidateMs: candidate.ms });
} else throw new Error(`Unknown dispatch command: ${command}`);
```

The five tool tests above cover the candidate, full-phase collector, screen, pure Node/native runner derivation and malformed reporter outcomes. Keep platform launch/execution outside unit tests. Also rerun existing `fullsize-tools.test.mjs`: its exact-body tests prove the reused diagnostic machinery preserves every original statement/assertion. No tool pass replaces the real smoke/correctness runs below.

- [x] **Step 5: Run focused external proof, baseline/variant core suites and two smoke workflows.** Run serially, with original configuration/deadlines:

```bash
node --test /tmp/opencode/doctect-incremental-sdd/dispatch-tools.test.mjs
node /tmp/opencode/doctect-incremental-sdd/dispatch-run.mjs init
node /tmp/opencode/doctect-incremental-sdd/dispatch-run.mjs contracts baseline
node /tmp/opencode/doctect-incremental-sdd/dispatch-run.mjs contracts scalar
for variant in raw-receiver pooled-receiver early-validation unbound missing-guard; do node /tmp/opencode/doctect-incremental-sdd/dispatch-run.mjs negative "$variant" || exit 1; done
node /tmp/opencode/doctect-incremental-sdd/dispatch-run.mjs verify-negatives
node /tmp/opencode/doctect-incremental-sdd/dispatch-run.mjs core baseline
node /tmp/opencode/doctect-incremental-sdd/dispatch-run.mjs core scalar
node /tmp/opencode/doctect-incremental-sdd/dispatch-run.mjs smoke baseline
node /tmp/opencode/doctect-incremental-sdd/dispatch-run.mjs smoke scalar
node /tmp/opencode/doctect-incremental-sdd/dispatch-run.mjs smoke-parity
```

Expected: all selected cases pass; core includes existing533cases plus the new characterization inventory; no module/unhandled failures; original Work prefix unchanged; source stamp still062de1ac...db18/1170; complete-phase smoke parity. A tool/characterization failure stops timing work. Review exact candidate diff and these receipts before Task3 performance runs.

Task2 evidence2026-09-29: five helper tests showed intended missing-export RED, then all five and seven reused fullsize tests passed. Session01 freezes tool hashes plus reviewable baseline/scalar source copies; the latter are supplemental external review artifacts, not application edits. Exact generated diff inspected before execution. Frozen contracts baseline/scalar90PASS each; all five repeated negative controls validated; core baseline/scalar623PASS each; smoke baseline2254.964ms/scalar2226.331ms with exact identity/all-runtime/all11-phase/all44-counter parity. Smoke times are not a benefit gate. No unhandled/module failure. Read-only reviewer `ses_f13ecde33ffe0ilpffDkMnFi5S` found no actionable issue and judged Task3 timing ready, not promotion accepted. Appstamp062de1ac...db18/1170 and original636/24 remain unchanged.

### Task 3: Run the Fixed Performance Screen and Original Gates

**Files:** Read frozen `D/dispatch-*` tools and `D/task-13-work-dispatch-01/manifest.json`; create exclusive trial receipts under that session directory. Update only this plan and the ledger with observations. No application edit.

**Interfaces:** Consume successful90-case characterization,623-case core, negative-control and complete-phase smoke receipts. Produce either a rejection/stop decision or `promotion-eligible.json`, backed by ABBA, original-case and native receipts. Eligibility is not a production rollout or full660-case acceptance result.

- [x] **Step 1: Run the first pair serially.** Each full invocation may take up to960s including the runner hard stop; give each Bash call at least1020000ms, not the default120s. Do not run a competing benchmark/build/review test job.

```bash
node /tmp/opencode/doctect-incremental-sdd/dispatch-run.mjs full A1
node /tmp/opencode/doctect-incremental-sdd/dispatch-run.mjs full B1
node /tmp/opencode/doctect-incremental-sdd/dispatch-run.mjs first-pair
```

Expected: all original diagnostic assertions pass, identity/all runtime/all phase counters match, and B1 is faster than A1. On failure, retain both complete/partial artifacts, record the failure and stop without B2/A2 or application promotion. Do not rename the variant, choose a different baseline or repeat the pair looking for a win.

First pair2026-09-29: A1 baseline468956.839ms, B1 scalar427927.126ms, both complete with all diagnostic assertions and all-runtime/all-phase parity. B1 is faster, so the predeclared reverse-order pair proceeds. This pair alone is not the>=10%screen, original-limit acceptance or native confirmation; no application promotion.

- [x] **Step 2: Complete the predeclared reverse-order pair and screen.** Executed; screen failed both predicates. Only after first-pair success:

```bash
node /tmp/opencode/doctect-incremental-sdd/dispatch-run.mjs full B2
node /tmp/opencode/doctect-incremental-sdd/dispatch-run.mjs full A2
node /tmp/opencode/doctect-incremental-sdd/dispatch-run.mjs screen
```

Expected: B1<A1 and B2<A2; median(B1,B2)<=0.90*median(A1,A2), plus complete logical parity. `screen.json` is created only on success. This is a fixed engineering screen with two observations per variant, not statistical certainty. Retain outliers and never substitute best-of results. A failed/inconclusive screen ends this candidate's promotion path.

**Observed rejection2026-09-29:** all four complete diagnostics pass original-body assertions; identical identity and every counter across5runtimes/11phases/44metrics, including zero/check-only/abort-only phases. Frozen tools/source hashes and serialABBA order are intact. No CPU sampler or competing controller benchmark was run.

| Fixed order | Variant | Complete workflow |
| --- | --- | ---: |
| A1 | Baseline | 468956.839ms |
| B1 | Scalar | 427927.126ms |
| B2 | Scalar | 434657.538ms |
| A2 | Baseline | 432274.907ms |

Baseline median450615.873ms; candidate median431292.332ms: measured4.288%lower, below the required10%. B2 is also slower than its matched A2. The frozen `screen` command failed with `Candidate did not beat each matched pair`; the supplemental post-run analyzer verifies both failed predicates against that same frozen function. Four new analysis tests passed after missing-export REDs. `task-13-work-dispatch-01/rejection.json` retains raw-receipt hashes, source/tool identities, ordering, full counter coverage and explicit `promotionEligible:false`. No `screen.json`, original-gate/native output or promotion-eligibility file exists. No outlier removed or rerun attempted. Two observations per variant do not establish a causal speedup/regression; this is rejection under the predeclared engineering screen.

- [ ] **Step 3: Run the actual uninstrumented original cases.** This uses the runtime-only scalar overlay; it does not append the900s diagnostic case or change any original definition/configuration.

Blocked by Step2 rejection; not run. Diagnostic completion is not original360s/5s acceptance.

```bash
node /tmp/opencode/doctect-incremental-sdd/dispatch-run.mjs gates
```

Expected: exactly3selected cases pass: original32MiB at360000ms; fresh/historical130-node replay cases at5000ms. No unhandled/module failures. The fixture size and all assertions remain exact. `gates-passed.json` exists only after deadline metadata checks. Any failure blocks application promotion under this plan, even when relative improvement passed. Report a measured but insufficient candidate and stop for a scope decision.

- [ ] **Step 4: Confirm the same full workload in a fresh native worker.** Give each call at least1020000ms. No existing browser profile, app page, backend or SQLite is opened. The reused native runner checks both4320/4321loopback addresses, builds an isolated worker, blocks non-diagnostic network requests and owns cleanup.

Blocked by Step2 rejection; not run. No new native benefit/production UI/native-heap claim.

```bash
TMPDIR=/tmp/opencode node /tmp/opencode/doctect-incremental-sdd/dispatch-run.mjs native baseline
TMPDIR=/tmp/opencode node /tmp/opencode/doctect-incremental-sdd/dispatch-run.mjs native scalar
node /tmp/opencode/doctect-incremental-sdd/dispatch-run.mjs native-screen
```

Expected: same browser version, original assertions passing, complete-phase parity and candidate faster than native baseline. A single native pair is confirmation, not p95/INP/native-heap or isolated-backend attribution. Any error or absent benefit stops promotion. Inspect owned processes/listeners after completion or interruption; never terminate protected/unrelated processes by port or broad name.

- [x] **Step 5: Review the go/no-go receipt.** Independent read-only review checks exact source/tool fingerprints, case inventories/deadlines, all phase coverage, ordering/outliers and whether the eligibility file is backed by every prerequisite. Record timings and limitations in this plan/ledger. If rejected, application stamp must still equal062de1ac...db18/1170, index/HEAD/protected scope unchanged; do not proceed to Task4.

Rejection review2026-09-29: `ses_f13ecde33ffe0ilpffDkMnFi5S` independently checked raw receipts/tool hashes, chronologicalABBA/zero retries, four complete diagnostics and all counter coverage. No actionable findings; both failed predicates support rejection and application promotion remains blocked. Review package `task-13-work-dispatch-experiment-review-01.md` contains the exact3-document slice against the immediate dirty baseline; external source/receipts are separately hashed. No original/native/full660 acceptance claimed. Final verification uses `dispatch-result.mjs` in read-only mode and `dispatch-audit-unchanged.mjs`; historical draft/unchecked-plan checker entrypoints are not current execution checks.

Final checkpoint2026-09-29:16external testsPASS; read-only rejection/negative-control receipts validate; characterization typechecks in memory with0diagnostics. Scope audit98authorized cumulative paths/51-of81 retained, unchanged appstamp062de1ac...db18/1170, HEAD/empty index/whitespace/protected hashes intact. No owned benchmark remains; diagnostic4320/4321 and stopped4310/4311 have no listeners. Protected launcher2397595alive, not a health check. This execution changed only the three documentation files and untracked ledger in the worktree; tools/candidate/tests/receipts remain external. No application build/full660/native/original-gate run after rejection, no staging/commit/dependency change/cutover. Experiment closed as rejected; further optimization needs a separate scope decision.

### Task 4: Conditional Application Promotion and Full Verification

**Not authorized to proceed:** Task3 screen failed. Every Task4 step remains unexecuted; do not apply the retained external candidate or characterization to application files. Another optimization requires a separate scope decision, not a retry, relaxed gate or bundled change.

**Files:** Only after Task3 passes and evidence review agrees: modify `shared/cooperativeWork.js` and append `D/dispatch-cases.ts.txt` to `tests/unit/localWorkspace/normalized/work.test.ts`. Update spec/plan/ledger execution status. No other application path.

**Interfaces:** Consume the exact frozen `scalarSource` output, unchanged baseline file copies, tested characterization suffix and reviewed `promotion-eligible.json`. Produce the same public Work interface with verified execution internals and a full original-limit acceptance record.

- [ ] **Step 1: Apply the tested candidate exactly using `apply_patch`.** The validation helper becomes:

```javascript
function validateOperationFields(visits, utf8Bytes, nativeKind, metric, run) {
  nonnegativeInteger(visits);
  nonnegativeInteger(utf8Bytes);
  if (visits < 1 || visits > visitLimit || utf8Bytes > byteLimit) {
    throw new RangeError('Work operation exceeds quantum');
  }
  if (nativeKind !== undefined) enumValue(natives, nativeKind);
  if (metric !== undefined) enumValue(metricNames, metric);
  if (typeof run !== 'function') throw new TypeError('Work operation must be synchronous');
}
```

Inside the existing `runSync` per-operation `try`, replace only capture/invocation:

```javascript
const operation = step.value;
const { visits, utf8Bytes, nativeKind, metric, run: execute } = operation;
validateOperationFields(visits, utf8Bytes, nativeKind, metric, execute);
const receiver = { visits, utf8Bytes, nativeKind, metric, run: execute };
value = synchronousResult(receiver.run(undefined));
```

Inside the existing cooperative loop's per-operation `try`, use this complete body; leave its surrounding application/lifecycle catches, advancement and finalizers untouched:

```javascript
assertCurrent();
const operation = step.value;
const { visits, utf8Bytes, nativeKind, metric, run: execute } = operation;
validateOperationFields(visits, utf8Bytes, nativeKind, metric, execute);
assertCurrent();
if (quantumVisits + visits > visitLimit
  || quantumBytes + utf8Bytes > byteLimit) {
  notify();
  assertCurrent();
  try { await yieldTask(); }
  finally { assertCurrent(); }
  increment('yields');
  quantumVisits = 0;
  quantumBytes = 0;
}
assertCurrent();
quantumVisits += visits;
quantumBytes += utf8Bytes;
globalCounters.visits += visits;
phaseCounters.get(phase).visits += visits;
globalCounters.emittedBytes += utf8Bytes;
phaseCounters.get(phase).emittedBytes += utf8Bytes;
if (metric !== undefined) increment(metric);
if (nativeKind !== undefined) increment('primitiveExceptions');
try {
  const receiver = { visits, utf8Bytes, nativeKind, metric, run: execute };
  value = synchronousResult(receiver.run(runtime));
}
finally { assertCurrent(); }
```

Preserve original wrapping/indentation from the generated candidate so the runtime is byte-identical to `scalarSource(baselineWork)`. Append the exact tested characterization text with one separating newline, without replacing any existing test/import. No handwritten variation from the measured candidate is permitted merely for cleanup.

- [ ] **Step 2: Check exact two-file promotion and dirty-baseline preservation.** Create external `audit-dispatch-promotion.mjs` with this complete check. It must not call the pre-promotion stamp checker expecting062de1ac...db18 as if runtime were unchanged.

```javascript
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { root, directory, session, scalarSource } from './dispatch-variant.mjs';
const baseline = `${directory}/task-13-work-dispatch-baseline`;
const manifest = JSON.parse(readFileSync(`${baseline}/manifest.json`, 'utf8'));
const git = args => execFileSync('git', args, { cwd: root, maxBuffer: 100 * 1024 * 1024 });
assert.equal(git(['rev-parse', 'HEAD']).toString().trim(), manifest.head);
assert.equal(manifest.head, '8a2872d9a5acae1be3022923c4c515c70212de83');
assert.equal(git(['diff', '--cached', '--name-only']).toString(), '');
assert.equal(JSON.parse(readFileSync(`${session}/promotion-eligible.json`, 'utf8')).eligible, true);
const assets = JSON.parse(readFileSync(`${session}/manifest.json`, 'utf8')).assets;
for (const [path, expected] of Object.entries(assets)) assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), expected);
const original = path => Object.hasOwn(manifest.files, path)
  ? manifest.files[path].present ? readFileSync(`${baseline}/files/${path}`) : Buffer.alloc(0)
  : git(['show', `${manifest.head}:${path}`]);
const work = 'shared/cooperativeWork.js', test = 'tests/unit/localWorkspace/normalized/work.test.ts';
assert.equal(readFileSync(`${root}/${work}`, 'utf8'), scalarSource(original(work).toString()));
assert.equal(readFileSync(`${root}/${test}`, 'utf8'), original(test).toString() + '\n' + readFileSync(`${directory}/dispatch-cases.ts.txt`, 'utf8'));
const allowed = new Set([work, test,
  'docs/superpowers/specs/2026-09-28-work-operation-dispatch-design.md',
  'docs/superpowers/plans/2026-09-28-work-operation-dispatch.md',
  'docs/superpowers/plans/2026-09-28-full-size-normalization-diagnosis.md']);
const current = [...new Set([...Object.keys(manifest.files),
  ...git(['diff', '--name-only', '-z', 'HEAD']).toString().split('\0'),
  ...git(['ls-files', '--others', '--exclude-standard', '-z']).toString().split('\0')])].filter(path => path && !path.startsWith('.superpowers/'));
const tracked = new Set(git(['ls-tree', '-r', '--name-only', '-z', manifest.head]).toString().split('\0'));
for (const path of current) {
  const before = Object.hasOwn(manifest.files, path) || tracked.has(path) ? original(path) : Buffer.alloc(0);
  const after = existsSync(`${root}/${path}`) ? readFileSync(`${root}/${path}`) : Buffer.alloc(0);
  if (!before.equals(after)) assert.ok(allowed.has(path), `Out-of-scope change: ${path}`);
}
for (const [path, expected] of [
  ['.superpowers/sdd/task-6-report.md', '577c6b0696eeca3a1b47072cdd98ff1c39195521f12b42f0c53140108f6b5e8c'],
  ['gallery-samples/21-sticker-press/templates.js', 'ba0e0b6f9432375f42f887e89085b882f1e0d0bf6483db15f43f4e77d06f9c50'],
  ['gallery-samples/21-sticker-press/hierarchy.js', '7c47c3b419ae03767db0f79aaef38a8390f5c35e2a2434534855fb6ef2da3693'],
]) assert.equal(createHash('sha256').update(readFileSync(`${root}/${path}`)).digest('hex'), expected);
git(['diff', '--check']); console.log('EXACT_DISPATCH_PROMOTION_PASS');
```

Run `node /tmp/opencode/doctect-incremental-sdd/audit-dispatch-promotion.mjs`. Record the new application stamp with the existing `sourceStamp()` utility; all post-promotion evidence must use that stamp, not the pre-promotion stamp or an external variant flag.

- [ ] **Step 3: Run application suites without the external overlay.** Each command is a separate serial call; no increased test timeout. Record complete per-case output with unique reporter files where a long suite risks losing its final summary.

```bash
npx vitest run tests/unit/localWorkspace/normalized/work.test.ts tests/unit/localWorkspace/canonical.test.ts tests/unit/localWorkspace/normalized/codec.test.ts tests/unit/localWorkspace/normalized/incrementalSha256.test.ts tests/unit/localWorkspace/normalized/commitProof.test.ts --maxWorkers=1
npx vitest run tests/unit/localWorkspace/normalized/emissionPlan.test.ts tests/unit/localWorkspace/normalized/sourceReads.test.ts tests/unit/localWorkspace/normalized/repository.test.ts tests/unit/localWorkspace/normalized/workspaceAuthority.test.ts --maxWorkers=1
npx vitest run tests/unit/localWorkspace/storedProjectValidation.test.ts tests/unit/localWorkspace/migrationPreparation.test.ts tests/unit/localWorkspace/validation.test.ts tests/unit/cooperativeLoader.test.ts tests/unit/generatorMetadata.test.ts tests/unit/server/validateAppState.test.js --maxWorkers=1
npx vitest run tests/unit/localWorkspaceBoundary.test.ts --maxWorkers=1
```

Expected core623cases, with the old533unchanged and90new cases; full boundary945cases unchanged. Do not assert connected counts without reading actual inventory. Known generator encoder-spy failure is separately retained; any new assertion/type/boundary failure blocks completion. Do not change its `encode` expectation in this scope.

- [ ] **Step 4: Run the complete original migration inventory at original limits.** The external gate receipt contains the unchanged660-case inventory even though only3cases ran. The promotion audit proves the migration test file unchanged. Use it solely as the case-name/options inventory for the real, now-promoted source:

```bash
FOUNDATION_INVENTORY="${DISPATCH_SESSION:-/tmp/opencode/doctect-incremental-sdd/task-13-work-dispatch-01}/gates/cases.jsonl" node /tmp/opencode/foundation-batch-runner.mjs 0 660 20
```

Allow a sufficiently long shell timeout (1980000ms). Reporter/batch runner retains individual results, original360s/5s deadlines and source stamps. If interrupted, exclude the entire incomplete batch; resume only disjoint missing cases using a new explicit names file and keep original receipts. No best-of substitution from successful reruns. Report all660outcomes and every remaining timeout; an open original gate is not green acceptance.

- [ ] **Step 5: Typecheck, build, review and close the exact scope.** Run separately so the known type error does not suppress the build:

```bash
npx tsc --noEmit --pretty false
ls -d /tmp/opencode/doctect-incremental-sdd
test ! -e /tmp/opencode/doctect-incremental-sdd/task-13-work-dispatch-build-01
TMPDIR=/tmp/opencode npm run build --legacy-peer-deps -- --outDir /tmp/opencode/doctect-incremental-sdd/task-13-work-dispatch-build-01
node /tmp/opencode/doctect-incremental-sdd/audit-dispatch-promotion.mjs
```

Expected typecheck: only the established Sticker Press `tests/unit/gallerySamples/stickerPress.test.ts(793,36)` TS2339, unless separately fixed by the user. Build must succeed; existing size warnings are not new scope. Never use `--emptyOutDir` or reuse/delete old build output.

Create a new review package from the immutable dirty baseline with `review-artifacts.mjs package task-13-work-dispatch task-13-work-dispatch-review-01`; request read-only review of that exact slice and all receipts, not HEAD~1. Record reviewer findings/corrections and final verification in the spec/plan/ledger. Do not mark performance acceptance complete from relative timings alone, and do not advance workspace lifecycle/production cutover under this plan.

## Plan Self-Review and Execution Boundary

The four deliverables are independently rejectable: compatible characterization, exact external candidate/tools, complete performance evidence, and conditional application promotion. The Work interface/equivalence requirements map to Task1's new90cases plus existing regression coverage; complete phase capture and metadata safeguards are in Task2; every performance stop rule is in Task3; exact source scope and original full gates are in Task4.

Before execution, the planning checker must parse every JavaScript/TypeScript block, verify approved spec status, four task headers, unchecked execution steps, complete runner/evidence definitions, original deadlines and no unresolved placeholders. Typecheck the characterization block appended to the current Work test through an in-memory TypeScript host; do not write it to application source merely to validate the plan. These are planning checks, not candidate execution.

Inline execution remains selected. No subagent execution choice, handoff, commit or new worktree is requested. The next execution milestone is Tasks1–3, with hard stop on rejection; Task4 is conditional on their reviewed success. At this planning checkpoint, application code and all official acceptance results remain unchanged.

### Planning verification checkpoint

Self-review checked every spec requirement against the four tasks, source-transform/runner interfaces, original versus diagnostic deadlines, failure paths, frozen negative controls, and source/mode/variant receipt checks. Callable class/revoked-proxy failures remain charged execution errors, not incorrectly reclassified validation errors. The example characterization block contains90planned cases; they have not executed.

External `check-work-operation-plan{,.test}.mjs` passes five tests after missing-helper REDs and a corrected negative fixture that initially changed the header's inline checkbox instead of a task checkbox. It validates4tasks/20unchecked steps, parses11JavaScript and1TypeScript examples across23fenced blocks, and typechecks the characterization block appended to the actual Work imports entirely in memory with0diagnostics. No candidate/tool implementation from the code examples was materialized or run.

The planning-only audit passes98authorized cumulative paths/51-of81 retained, with unchanged application stamp062de1ac74c376e26effe619bf96d203ff21cd290b9573de1181f1179b49db18/1170, HEAD/empty index/whitespace/protected hashes. Changes are limited to this plan, approval/link updates in the existing spec/predecessor, and the untracked ledger. No application suite/build rerun, runtime promotion, dependency change, commit or acceptance improvement is claimed. The draft-only design checker is historical; use the planning checker for this approved-spec state.
