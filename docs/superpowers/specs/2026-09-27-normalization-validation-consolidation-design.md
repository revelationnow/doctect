# Current-Schema Stored-Project Validation Consolidation

Date: 2026-09-27
Status: Approved on 2026-09-27. After clarification of the exact optimization milestone, the user authorized proceeding inline. Creation of the document alone did not authorize runtime changes; this subsequent instruction did.

Predecessor plan and measurements: [normalization emission work](../plans/2026-09-27-normalization-emission-work.md), especially “Current verification evidence” and “Post-emission diagnosis.” Concrete inline execution plan: [validation consolidation](../plans/2026-09-27-normalization-validation-consolidation.md). All verification gates remain required.

## 1. Goal and limits

Reduce repeated work within one validation-only, current-schema stored-project check. Preserve the decisions made by the existing checks, the disposable loader pass, original captured data, and independent validation in every normalization phase. This is an implementation-composition amendment, not permission to accept different project data or loosen a runtime budget.

The incremental persistence, bounded normalization, source-admission, workspace-authority and prepared-emission specifications remain binding:

- [Incremental local persistence](2026-09-13-incremental-local-persistence-design.md).
- [Bounded normalization](2026-09-16-bounded-normalization-design.md), especially sections 5–8.
- [Normalization admission](2026-09-16-normalization-admission-amendment-design.md).
- [Normalized workspace authority](2026-09-26-normalized-workspace-authority-design.md).
- [Normalization emission work](2026-09-26-normalization-emission-work-design.md).

Production remains on `WORKSPACE_DB_VERSION=2`; private normalized physical version 3 and its fourteen stores remain unchanged. No durable schema, frame, digest, public storage interface, worker protocol, external format, authority rule or writer changes. Workspace lifecycle B/C/D, live editor cutover and native release acceptance remain separate work.

Work is restricted to `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence`, branch `feat/incremental-local-persistence`, HEAD `8a2872d9a5acae1be3022923c4c515c70212de83`. Preserve the intentionally dirty tree and empty index. No staging, commits, merges, dependency changes, destructive cleanup, source/sibling-worktree edits, deployment or existing-profile migration. Preserve launcher PID 2397595, ports 3000/3001, stopped preview 4310/4311 and its retained SQLite database. Read-only investigation/review is allowed; implementation handoffs are not.

## 2. Evidence, not a speedup claim

The current runtime/test/config stamp is `012966351b041366b4106959901e315db22e057ca3fac73a06c5c00c74b0b975`, covering 1169 files. The latest complete migration covering set is **632 passes / 27 timeouts across 659 cases**. The original 32 MiB case still exceeds 360000 ms. Four actual source/target derivations and zero stage semantic derivations are already established; the former fifth derivation is not the current blocker.

External phase-only probes of the 130-node fixture measured verification about 1.89 s, activation 2.06 s and reopen 2.18 s. One verification captured about 76 KB but performed 6.78 million lifecycle checks. JSON traversal and Work execution dominated sampled CPU; capture, sealing and asynchronous waiting did not explain most of the cost. These are diagnostics, not end-to-end timing acceptance. Nested inclusive spans must not be added together.

At `services/localWorkspace/migration.ts`, `validateProjectRecords` currently composes:

1. `checkMigratedStateWork(project.initialState)`.
2. `checkWorkspaceProjectWork(project, { warningPolicy: 'reject' })`.

For one successful current-schema project in the discard-only branch, this composition performs six canonical traversals, three `validateAppStateWork(..., 'plain')` validations and one native working-state clone, besides the loader's own traversals. Ordered JSON sizing inside AppState validation and the loader's traversals are not included in the six-count description.

The proposed successful path has three canonical traversals, all three AppState validations and the same one working clone. This is a local work-removal target, not a prediction of total phase time, a linear extrapolation to 32 MiB, or a claim that all remaining timeouts will close.

An initially considered two-AppState-check path was rejected during design self-review. Native cloning can change representation: a dense array's non-enumerable index becomes a hole, changing ordered JSON from `[""]` to `[null]`. Original-graph validation therefore cannot generally replace the existing pre-loader validation of the clone, including its byte count and error precedence. This amendment does not introduce a descriptor fast path or a new “safe to clone” receipt.

## 3. Alternatives

1. **Recommended: one purpose-specific stored-project check.** Consolidate the existing composition in `validation.ts`; call it only from the cooperative discard-only project-record branch in `migration.ts`. Keep original-state, whole-wrapper and loaded-state checks. This has the smallest interface and scope, preserves loader behavior, and provides a direct differential test oracle.
2. **Fuse canonical JSON safety, byte counting and semantic validation.** Potentially removes more traversals, but expands shared JSON/AppState implementation scope and couples traversal/error-order policies used by other callers. Not selected for this amendment.
3. **Optimize shared dispatch/quotation/comparison first.** External comparison batching showed only a small probe improvement, while quotation results were inconsistent. Such changes affect every Work consumer and do not remove this demonstrated same-pass composition overhead. Not selected.

Cross-phase receipts, cached authority, trusted-caller flags, skipping the loader, validating only the normalized result, and relaxing tests or limits are not alternatives within this contract.

## 4. Module interface and integration seam

Add one validation-module export, conceptually:

```ts
export function checkStoredWorkspaceProjectWork(raw: unknown): Work<void>;
```

This name means a `WorkspaceProject` payload read from a stored project record, not the outer `StoredProject` envelope. The function validates its input itself. It requires the current schema and rejects loader warnings; callers cannot choose a weaker mode, supply a validation receipt, inject byte counts or request a trusted fast path. It returns no project, state, certificate, authority or reusable validation result.

The sole production consumer is `validateProjectRecords` when `cooperative && !retainSnapshot`. Both `validateWorkspaceRecordsWork` and `createWorkspaceRecordValidator().project` reach that branch. Each invocation checks its own private captured graph; the caller continues to own and keep that capture immutable while the Work program runs. No fact survives the call or certifies a different graph, later phase or durable read.

Implementation equivalence safeguard: consolidate only when the outer stored record's `project` is an own data property, as in native captures. Accessor-backed envelopes retain the previous composition and exact Get ordering; a getter can return a different payload or throw on a later read. This is an internal charged descriptor check, not a caller-supplied trust flag or permission to skip validation.

All returning branches remain on the existing composition, including synchronous and cooperative reconstruction. Existing standalone `checkMigratedStateWork`, `checkWorkspaceProjectWork`, returning project validators, historical import/preparation, preset validation and pending-import validation keep their interfaces, clone boundaries and behavior. There is no new public store method or normalized-repository option.

Outer record responsibilities stay in `migration.ts`: exact envelope fields, nonempty IDs/incarnation, revisions/timestamps, consume provenance and uniqueness, stored/project ID equality, membership metadata and `target-invalid` wrapping. No normalized repository, codec, manifest or loader caller is changed to bypass those checks.

## 5. Ordered validation pipeline

### A. Validate the original current state

After the existing project-payload object requirement, inspect the original `initialState` using the existing plain-object and canonical JSON rules with the `Migrated project state` context. Retain the resulting logical serialized byte count locally for the later clone reservation; it is not a validity receipt.

Require `CURRENT_SCHEMA_VERSION`, then run the existing plain-mode AppState validator and active-variant membership rule. Invalid current text/generator/structural data must fail before the loader can repair or detach it. Missing, old, negative, fractional, string and future versions remain rejected at the same current-state requirement.

The semantic rule sequence may be factored into a module-private helper shared with the existing migrated-state traversal. That helper still executes the real rules; it accepts no “already validated” flag. Existing exported traversals retain their current behavior and traversal/clone boundaries.

### B. Validate the complete wrapper

Keep a full canonical check of the `WorkspaceProject` wrapper, followed by its existing id/name/cloud/revision rules. Preserve empty names, nonempty uncapped external IDs, absent optional fields and opaque JSON extensions.

Do not replace this with a shallow wrapper check or a copy with `initialState` removed. The wrapper introduces a different nesting and ancestor context; its depth/cycle checks are not redundant with the state-root check. There is no 32 MiB cap on the whole wrapper, workspace, backup or physical record.

### C. Clone once and run the real loader

Reserve the already measured logical state-image bytes before the native `structuredClone` of `initialState`. Register the ownership handle inside its charged operation, under `try/finally`, so lifecycle loss immediately after allocation cannot strand it. Clone failure retains the existing refusal and cleanup behavior.

Before loading, retain the existing schema-version checks, plain-mode AppState validation and active-variant check on that clone, with the existing `Project state is invalid before migration` error context. This independently checks the clone's representation; do not assume original-state validation covers it.

Pass only that disposable mutable clone to `loadOwnedProjectStateWork`. Keep the loader's real current-schema text-overflow, text-wrap, text-padding, generator normalization and warning behavior. Current schema is not evidence that hydration is unnecessary. Reject any returned warnings with the existing joined warning text, before post-load state validation.

The original capture is never passed to an owned/mutating loader. No loaded state is installed into the raw record, emitted as a source replacement, cached, returned or used as later phase authority.

### D. Validate the loaded result, then discard it

Check the loaded state's plain-object/canonical JSON/current-schema rules, run the real plain-mode AppState validator and check active-variant membership. The post-load 32 MiB limit remains independent: defaults may increase size even when the input fit. A valid input does not certify its transformed output.

Clear private working references and release ownership on success and every error/cancellation path. Return `undefined`. This operation is still validation-only and does not increment `projectReconstructions`.

### E. Exact work removed

| Existing work | New treatment | Required justification |
| --- | --- | --- |
| Original-state canonical check before semantics | Keep | Proves JSON/depth/descriptor safety of the original graph |
| Original-state canonical recheck after read-only semantics | Remove in the new composition only | No mutation or representation change occurred |
| Whole-wrapper canonical check | Keep | Independent wrapper/ancestor context and metadata |
| Project-state canonical reinspection before the clone | Reuse the local original-state byte measurement | Same immutable state already checked; wrapper check also completed |
| Pre-loader schema/AppState/active-variant checks on the private clone | Keep | Native cloning can change representation and byte size; preserve error precedence |
| Actual owned loader | Keep once | Compatibility transformations and warning behavior are not redundant |
| Loaded-state canonical check before semantics | Keep | Loader produced a potentially different graph |
| Loaded-state AppState and active-variant checks | Keep | Includes post-load size and validity |
| Loaded-state canonical recheck after read-only semantics | Remove in the new composition only | No mutation or representation change occurred |

Differential coverage must include aliases and unusual descriptors, including dense arrays with non-enumerable indices. The three remaining canonical checks cover original state, complete wrapper and loaded state; the three remaining AppState checks cover original state, native clone before loading and loaded state. If an omitted canonical check cannot meet equivalence within this scope, retain the necessary check and bring the measured limitation back for design review rather than weakening policy or silently broadening JSON/loader code.

## 6. Errors, lifecycle and accounting

Preserve the order of distinct validation stages: outer record/provenance, original current state, complete wrapper/metadata, clone and pre-loader validation, loader warnings, loaded state, stored/project ID comparison, then workspace membership. Multi-fault fixtures pin error precedence rather than asserting only that something threw. Existing `WorkspaceMigrationError` category, affected-record message and nested cause remain intact; data errors must not replace a latched lifecycle failure.

Canonical-covered getters/setters, `toJSON`, non-JSON values and custom prototypes remain governed by existing descriptor-based JSON validation, not compatibility serialization. Characterize accessor behavior at entry properties against the existing composition as well; this optimization must not introduce new getter executions or silently redefine a pre-existing entry-access behavior. Never return an unvalidated arbitrary object from a Work operation, where the runtime's `.then` probe could invoke a getter. Use charged void assignments for such reads.

All work that still occurs remains charged. Keep the 1024-visit/64 KiB Work quantum, 64-UTF16-unit JSON fragments, 192-byte SHA input fragments/600-visit compression step and 127-unit count-only string scans. No shared runtime, hasher, serializer, observer or scheduling change is authorized. Ownership uses the existing logical input-image convention, not a native heap estimate; the clone and existing loader allocations retain their documented native-cost limitations.

Cancellation/epoch loss before the clone, immediately after reservation or native clone, during loader traversal, during post-load validation and before final return must release the private lease. The raw capture and caller-owned runtime remain usable when the existing contract allows it. No additional read, write, hash or cleanup scan is added after cancellation.

## 7. Independent phases and immutable data

Preparation/resume, verification, activation and active reopen continue independently capturing and validating their required source/target/current records. Retained-source reads still validate source ancestry and seal it without deriving a target. No validation result, byte count or working clone from this helper is shared between invocations or phases.

Keep complete independent resumed-prefix checks, current manifests/proofs, expected-target versus durable-target comparison, reconstructed-target versus source comparison, source/archive retention and final live-versus-capture seals. Keep exact stage ordering/framing, 64 records/256 KiB per batch with the existing legal oversized-singleton exception, eight-retry cap, quiet final legacy/publication fences and lost-acknowledgement old/new durable outcomes.

The successful invocation still allows at most eight full-set reads and four source/target derivations; five uncontended legacy captures/two active captures remain unchanged. Ordinary project saves do not enter this path, read a whole-workspace manifest or revalidate historical/ancillary payloads.

## 8. Test-first equivalence and work evidence

The reference oracle is the existing cooperative composition of `checkMigratedStateWork` followed by `checkWorkspaceProjectWork` with warning rejection, not the new helper invoked twice. Keep those exports behaviorally unchanged. Compare success/refusal, meaningful error/cause chains, raw data and alias identity, clone inputs, loader behavior and ownership. Synchronous/returning paths provide additional regression coverage, not a substitute for the actual old Work composition.

| Matrix | Required evidence |
| --- | --- |
| Ordinary current-schema payload | Three actual canonical traversals, three actual AppState validations on their distinct input stages, one real loader call and exactly one state clone; `undefined` result and zero outstanding ownership |
| Missing text/grid defaults; existing valid text settings | Real loader still executes its existing hydration; raw capture and its field order/values remain untouched |
| Malformed current textOverflow/textWrap/textPadding; invalid generator, unknown generator fields, script limits/timestamp | Reject before loader normalization could hide original invalid data |
| Loader warnings and malformed post-load result | Retain the real loader, then use a delegating fault injection where necessary to prove warnings and output failures are checked; do not replace all behavior with a stub |
| Schema variants, broken root/node/template/active-variant references, wrapper/record multi-fault cases | Same refusal, error label/cause and stage precedence as the old composition |
| Getters/setters, `then`/`toJSON` traps, functions/symbols/bigints/undefined/nonfinite values, cycles, prototypes, sparse arrays and extra array keys | Preserve acceptance/refusal and accessor behavior; no new callback execution or compatibility-JSON fallback |
| Aliases, frozen/read-only input, hidden properties and non-enumerable array indices | Preserve native clone and error behavior; never treat arbitrary descriptors as an established JSON-roundtrip invariant |
| Depth 512/513 at state root and inside wrapper | Preserve both nesting contexts, including a state acceptable alone but too deep when wrapped |
| At/below/above the 32 MiB AppState limit; loader defaults crossing the limit; wrapper extensions beyond that limit | Preserve original and post-load state checks without introducing a wrapper/workspace cap; original large fixture/deadline remains intact |
| Unicode/lone surrogates, long keys/IDs, scripts, cloud/provenance, opaque extensions and raw folds | Preserve raw values, key order and external IDs; no clone-cache or normalized-source replacement |
| Cancellation and clone/loader exceptions at allocation, traversal and terminal boundaries | Latched lifecycle error wins, raw capture unchanged, lease released, no later writes/reconstruction |
| Streamed and aggregate record validation | Both take the new discard-only path; preserve outer envelope/provenance, uniqueness, ID equality and membership checks |
| Returning/public preparation, historical imports, presets and pending imports | Existing path, output, warning policies and mutation/clone behavior unchanged |
| Retained export and real normalized session | Raw historical source remains exact; new helper is re-entered per independent source validation; target/seal corruption and stage isolation tests remain effective |

Observe real imported canonical/AppState/loader functions and clone inputs, not newly invented counters or relabeled derivation totals. Existing field-order, size, hash, ownership and fault assertions remain. Long-payload tests retain authentic quantum cancellation. Reuse existing fixtures/harnesses and add focused fixtures rather than shrinking old ones.

## 9. Exact proposed implementation scope

| Path | Permitted change |
| --- | --- |
| `services/localWorkspace/validation.ts` | Purpose-specific discard-only helper and minimal private rule factoring; no existing exported behavior change |
| `services/localWorkspace/migration.ts` | Replace only the cooperative discard-only stored-project composition; preserve returning/preset/import branches and record checks |
| `tests/unit/localWorkspace/storedProjectValidation.test.ts` | New focused differential/work/ownership/adversarial matrix |
| `tests/unit/localWorkspace/migrationPreparation.test.ts` | Streamed/aggregate routing, error precedence and preserved returning-path regression coverage |
| `tests/unit/localWorkspace/normalized/migration.test.ts` | Focused real-session/raw-retention/phase-independence regression coverage without weakening existing cases |
| This amendment, predecessor plan link and `.superpowers/sdd/progress.md` | Design/approval/verification status only; ledger remains untracked and never staged |

Existing helpers, `validation.test.ts`, loader/JSON/AppState modules, canonicalization, normalized repository/codec, schema/protocol, UI and build/test configuration are read/run but not edited by default. Existing filename-specific capability grants already cover the two runtime modules; no directory grant, new capability or static-check weakening is required. Any necessary scope extension must be reviewed explicitly before edits.

Before implementation, record a fresh dirty-tree baseline and exact file map. Do not overwrite the original Task11b 81-file baseline/47-path allowlist, prepared-emission baseline, existing measurement artifacts or protected hashes. Compare this slice against its immediate pre-implementation tree, not HEAD alone.

## 10. Verification and approval gates

1. Add failing differential/routing/work-removal tests before changing runtime code. Demonstrate intended failures, then implement inline and run the focused tests with one worker.
2. Run affected validation, migration preparation, canonical, cooperative loader, generator, shared AppState and normalized codec/source/authority regressions. Run full static capability checks without altering permissions.
3. Remeasure the original derivation gate, unchanged short-timeout cases and the original 32 MiB/360000 ms case. Preserve every old fixture/assertion/deadline; no test-timeout override, fixture reduction or best-of-reruns total. Record cold/isolated and connected results separately with one source stamp.
4. Run the complete affected migration covering campaign with all original cases plus additions accounted for, connected regressions, typecheck and build. Build output goes to a new external path, never destructive cleanup. Classify the existing Sticker Press `tests/unit/gallerySamples/stickerPress.test.ts(793,36)` TS2339 separately; do not suppress it or call the full typecheck green.
5. Review the scoped diff and equivalence evidence, then run exact scope/HEAD/index/whitespace/protected-file audits. No commit, merge, rollout or cleanup follows automatically.

Local work-removal correctness and whole-normalization runtime acceptance are separate conclusions. If the helper meets equivalence but original gates still time out, report the actual failures and profile the remaining cost; do not mark emission Tasks 5/6, normalization acceptance or production responsiveness complete.

Only this amendment, its predecessor-plan link and the execution ledger changed during design review. Written design approval is now recorded above; the concrete plan governs inline execution. No application test/build result or runtime speedup is claimed by drafting or approving this document.

Design verification on 2026-09-27: self-review retained the clone's pre-loader AppState check; a separate read-only source/design review found no remaining actionable issues. External documentation checker `/tmp/opencode/doctect-incremental-sdd/check-normalization-validation-design.mjs` and its five tests pass: ten sections, balanced interface example, six existing document links and unchanged 1169-file runtime/test/config stamp. The exact audit adds only this document to the prior scope: 91 authorized cumulative paths, 51/81 original blobs retained, HEAD/empty index/whitespace/protected hashes intact. Original baseline and allowlist are untouched. These are documentation/scope checks, not application equivalence or performance evidence; no application suite/build rerun was needed for this documentation-only step.

Implementation verification is now recorded in the linked plan. The design-only checker above is a historical receipt, not the current execution checker. Local6→3canonical scan consolidation and96new tests are verified; complete migration covering evidence remains634PASS/26timeouts across660 cases. Normalization/runtime and production release acceptance remain open.
