# Confirmed Rollback Retry Implementation Plan

> **For agentic workers:** Execute inline with executing-plans and TDD. User approved the narrowed retry design; no further product interview or implementation handoff. Do not stage or commit.

**Goal:** Pass failed-save retry and durable readback in the real21MB app without repeating full admission after a proven ordinary transaction rollback.

**Architecture:** The repository owns private abort evidence and guarded continuation. The FIFO worker rotates public bindings only after that evidence and a metadata seal succeed. The session reuses existing queue/write-owner recovery without replacing working content.

**Tech Stack:** TypeScript, existing Work/IndexedDB/worker protocol, Vitest/fake-indexeddb, native Chromium runner.

## Global constraints

Follow `../specs/2026-10-05-confirmed-rollback-retry-design.md`, including unknown-outcome handling and all unchanged budgets. Worktree `incremental-local-persistence`, HEAD8a2872d, immediate `task-26-confirmed-rollback-retry-baseline` atc04963d…/1219. Preserve all dirty predecessor files and the empty index. Use unique stamped external evidence; no destructive cleanup.

## Task1: Repository evidence and continuation

Files: `services/localWorkspace/normalized/repository.ts`; new `tests/unit/localWorkspace/normalized/rollbackContinuation.test.ts`.

Interface:

```ts
resumeAbortedWorkspace(
  token: WorkspaceRepositoryAdmission,
  failures: readonly { scope: ProjectScope; identity: CommitIdentity }[],
  work: WorkRuntime,
): Promise<WorkspaceAdmission>;
```

- [x] Add real-normalization/abort RED tests asserting the method exists, returns unchanged authorities with a new token, and only reads/seals normalizationLedger/workspace/projectHeaders/projectPreferences. Assert original token retirement and a normal retry's durable changed value.
- [x] Retain native `onabort` settlement evidence privately on the existing bounded attempt record, using weak owner identities and exact epochs/stamps. Do not classify by exception name or alter existing inspection outcomes.
- [x] Implement token/evidence/cache guards, selected metadata capture, full metadata equality and existing atomic readonly seal. Final liveness check precedes one capability rotation; release every temporary owner on failure.
- [x] Test no attempt, bad identity, pre-transaction/post-commit failure, altered metadata/revisions, superseded owner, cancellation and evicted evidence. Run the new file plus repository/workspace transaction fault suites with original limits.

## Task2: Correlated worker binding rotation

Files: `services/localWorkspace/{workspaceWorkerProtocol,workspaceWorkerClient}.ts`, `services/localWorkspace/normalized/coordinator.ts`; tests alongside rollback continuation and existing worker/protocol tests.

Wire interface:

```ts
{ type: 'workspace-resume-aborted', storageGeneration: string, admissionId: number }
{ type: 'workspace-resumed', admissionId: number, catalog: WorkspaceCatalog,
  projectAuthorities: WorkspaceAdmission['projectAuthorities'] }
```

- [x] Add intended framing/coordinator REDs: genuine failed binding stays stale, continuation returns request-correlated new bindings, old workspace binding cannot repeat the continuation, and a subsequent ordinary save succeeds.
- [x] Extend exact framing/response validation and receipt invalidation. No blanket field allowance or protocol deadline change.
- [x] Keep bounded failed-identity metadata inside the FIFO worker. Verify coverage of existing members and pass only authentic recorded failures to the repository. Publish new workspace/project IDs together, retaining no document payload or old live token.
- [x] Reject empty, stale, unsupported, lost-owner and malformed continuations without partial publication. Verify metadata preparation uses existing Work and is disposed on every exit.

## Task3: Existing editor recovery on the live worker

Files: `services/localWorkspace/{workspaceEditingSession,NormalizedWorkspaceStore}.ts`; `tests/unit/EditorPage.normalized.test.tsx` and `tests/unit/localWorkspace/normalized/normalEditorStore.test.ts`.

Session interface:

```ts
tryResumeAborted(assertSourceCurrent: () => void): Promise<boolean>;
```

- [x] Add a real store/page RED: native ordinary put abort, explicit retry, same worker count, no new `editor`/workspace-bootstrap/open-project read, saved working text and retained Undo/Redo. Preserve existing unknown/client-loss readmission tests.
- [x] Factor private binding installation/recovery so an authenticated continuation reply supplies only metadata for existing owners. Existing public full restart remains self-validating and uses the existing startup receipt path.
- [x] Freeze/quiesce first; probe before disposing lifecycle. On refusal keep original custody and return false. On accepted rotation use existing recovery constructor/attempt inspection/write-owner attachment and drain before reporting success. On failed adoption retain matched queue/lifecycle custody for full recovery.
- [x] Try continuation inside the store's existing single-flight retry only for a ready live session and unchanged legacy lifetime. All uncertain/refused paths retain existing full initialization. No automatic retry, rebase or false Saved status.

## Task4: Final verification and real goal

- [x] Run connected affected tests with stamped receipts: repository/worker/framing/queue/lifecycle/startup/store/page/boundaries, original5000/10000ms limits and one worker. Reconcile complete inventories and distinguish any selected subset.
- [x] Read-only immediate-baseline review; fix reproduced findings with RED tests. Run `npx tsc --noEmit --pretty false`, `git diff --check`, and `TMPDIR=/tmp/opencode npm run build --legacy-peer-deps -- --outDir /tmp/opencode/doctect-incremental-sdd/task-26-rollback-retry-build-01`. Known StickerPress793:36TS2339 remains separate.
- [x] Run `node --experimental-strip-types /tmp/opencode/doctect-incremental-sdd/saved-workspace-browser.mjs` and its `control` mode unchanged. Require opening/editing/switch/UndoRedo/reload/native failed-save Retry/durable readback, not a later passive completion.
- [x] Update this plan, first-read checkpoint and ledger with actual outcomes; verify current stamp, empty index, protected sibling hashes, preview health and released owned ports. No integration/deployment implied by passing private tests.

## Verified Task26 checkpoint

Source **`cb3eb92553f2244454afc9b95c1269e5df8fda25891fa4a6c6b7d03ee76f94d1` /1221files**. Six runtime files, five test/helper files and four plan/spec files changed against the immediate c04963d… baseline; controller ledger/authorized cleanup records separate. `shared/cooperativeWork.js`, `shared/jsonWork.js` and codec remain byte-identical to that baseline. No schema, digest format, writer, Work budget or deadline change.

### Real goal result

**Uninstrumented actual21MB workflow PASS:** `/tmp/opencode/doctect-saved-workspace-large-1791270465663/report.json`, `completed:true`, `reloadVerified:true`, `retryVerified:true`.

- Exact pinned AppState21,152,284bytes; actual normal `/app`, native module worker and disposable IndexedDB, no fabricated editing admission.
- Opening **110950ms**, inside unchanged120000ms gate.30edits/autosaves, switching, Undo/Redo and reload preserve the latest text.
- Native `projectTemplates.put` AbortError leaves working text intact and durable text at the preceding value. Explicit Retry succeeds; subsequent Undo/Redo and independent durable readback pass.
- Retry uses one `workspace-resume-aborted` request, **107.4ms** through its correlated response. First retry inspection through verified save reply is **317.9ms**. No normalization-open/step, workspace-bootstrap or open-project request occurs after the failure. This is an RPC interval, not a claimed exact click-to-paint measurement.
- Typing action-through-next-frame p95 **114.7ms**, maximum **116.4ms** in this run. These are observed browser/driver-inclusive action measurements, not a controlled causal benchmark or zero-long-task claim.
- No page or cleanup errors. All existing5000ms saved-status assertions and30000ms RPC deadlines remain unchanged.

Small control `/tmp/opencode/doctect-saved-workspace-control-1791270812004/report.json` also passes the complete flow: opening1724ms, continuation86ms, first inspection through verified reply247ms. Final current-stamp results are separate from the earlier diagnostic pass.

### Tests and review

`task-26-connected-final-01.jsonl`: **1820PASS/19files**, complete inventory/results/terminal reconciliation, no skipped/retried/failed/unhandled cases. Original5000/10000ms defaults, one fork worker and preexisting named exceptions unchanged. Includes958static boundaries, repository/worker/queue/lifecycle/bulk/authority/startup/store/editor/history coverage. **35new cases**:25repository continuation,4wire/worker and6page recovery cases. Full repository and full662-case migration suites were not rerun.

Read-only reviewer `ses_ef038eb04ffekKMmyqgvecFUCM` is clear at package02. Four findings were reproduced before correction: completed owner replacement/evidence eviction escaping pending-queue checks; raw cloning sanitizing malformed evidence frames; missing exact coordinator→pure JSON boundary edge; unbounded member argument spread. Permanent REDs and all failed runs remain. Independent final8probes pass (owner/eviction, four hostile-frame forms, seal race, cancellation). Page controls also cover client loss after rotation, legacy lifetime loss, a second replay abort, concurrent Retry and preserved recovery custody.

Build `task-26-rollback-retry-build-01` passes11.91s/2486modules. Typecheck reports only the known `tests/unit/gallerySamples/stickerPress.test.ts(793,36)` TS2339. Initial editor-green01 tested a detached React textarea after Undo; corrected test queries the live control. Initial adoption-red01 used a recursively intercepted global Array.push spy; corrected RED02 directly wraps/restores the native method and reproduces exactly one unbounded push. Neither correction weakens product assertions.

### Failed/incomplete runs and quota recovery

- Uninstrumented1791267414560 opened113130ms and passed editing/reload, but failed to observe the Retry button; subsequent page evaluation/body inspection was unavailable. It remains a failed run; its exact page-loss cause was not established.
- Diagnostic1791268304949 failed before build/browser execution with **EDQUOT122** while writing its fixture/report. Partial files and console evidence remain; no successful receipt is invented. `/tmp` is usrquota-enabled despite available filesystem blocks; `quota` utility is unavailable.
- User explicitly approved deleting only verified duplicate documentation/walkthrough assets in16obsolete Task11b builds. `cleanup-task26-copies.mjs` rechecked1104files byte-for-byte, then removed32allowlisted directories: **843625824bytes (~805MiB)**. It preserved every code bundle, source map, index, report, profile, fixture, baseline, database and preview. Manifest exists both at `.superpowers/sdd/task-26-cleanup-01.json` and external `task-26-cleanup-01.json`; do not rerun blindly.
- Diagnostic1791269028899, after quota recovery, passed the complete native flow with passive message/crash observation and unchanged assertions. It remains diagnostic-only; final uninstrumented1791270465663 above is the actual qualification.

`task-26-verification-01.json` and final02 reconcile native stamps/outcomes, selected RPCs, all1820test results, preserved failures, exact allowed source scope, protected hashes and empty index. Preview remains Task17 build2e098d7… on4322/4323/PID2512304, HTTP200. Test ports4320/4321 released; protected SQLite remains present. Worktree/branch kept as-is: no staging, commits, merge, deployment, installs or existing-profile access. Historical import, browser-availability, quota-qualification and other release limitations are not relabeled fixed by this saved-workspace workflow result.
