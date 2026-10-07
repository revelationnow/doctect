# Private Bulk Replacement and Recovery Implementation Plan — Milestone C

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Implement inline; read-only review is allowed. No implementation handoffs, staging or commits. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Persist whole-document replacement and recovery-as-copies without losing working edits, Undo/Redo history or immutable recovery sources.

**Architecture:** Follow sections 8–10 of the approved `../specs/2026-09-26-normalized-workspace-authority-design.md`. Keep `normalized/repository.ts` the sole normalized writer; reuse its scoped capture/seal machinery and the existing worker FIFO. A replacement is a project-lane boundary, not project retirement or a workspace revision change. Recovery is a separately admitted workspace command, not a historical writer fallback.

**Tech Stack:** Existing TypeScript, cooperative Work, IndexedDB/module worker, Vitest/fake IndexedDB, React integration fixtures. No new dependencies.

**Authorization:** On2026-10-02 the user approved advancing missing private functionality before further optimization. This plan implements that sequencing. Existing B timing/native failures remain release blockers, not prerequisites for private C development. D/live integration and production cutover remain separate.

## Global Constraints

- Workdir `.worktrees/incremental-local-persistence`, branch `feat/incremental-local-persistence`, HEAD `8a2872d9a5acae1be3022923c4c515c70212de83`. Preserve dirty predecessor work and empty index. Immediate snapshot: `/tmp/opencode/doctect-incremental-sdd/task-14-workspace-bulk-recovery-baseline`.
- Starting application/test/config stamp: `191c08e02d3f9d6cb7c193e72a61887a5bc2bec3141e5666b78c67edb385a5fc`/1182files. Current accepted evidence remains blocked: connected2453PASS/1timeout; migration642PASS/18timeouts. Isolated diagnostics are not replacement acceptance.
- Production `WORKSPACE_DB_VERSION=2`; private physical version3/fourteen stores. No profile migration, historical-source mutation, extra store, generation switch, fallback writer or live production selection.
- Preserve32MiB AppState/depth512/history50; Work1024visits/64KiB; JSON64UTF16units/max192UTF8bytes; SHA<=192bytes/600visits; count-only127units; migration stage64records/256KiB; receipt windows32entries/64KiB; retries<=8.
- Existing5000ms test limits and worker30000ms transport limit remain. Only the already-approved named32MiB migration case has600000ms. No retry-until-green or performance redesign in C.
- Ordinary writes remain selected-record-only, manifest-free and bulk-transfer-free. Replacement and recovery are explicit bulk boundaries; transaction cost is not hidden by migration staging or weaker assertions.
- No asynchronous hash/yield/passive observer inside IDB transactions. Acquired resources are registered inside charged operations before their post-operation guard, and released in finalizers. Raw clone/read values use charged void assignment, not thenable-probing Work return values.
- Public IDs remain nonempty, with no new256-byte cap. Private command IDs retain256UTF8-byte bounds. All counters use safe integers and fail on overflow.
- Keep original sources/archives, wrapper extensions, cloud metadata, raw folds and property order. Timeout/termination means unknown outcome, not rollback.
- Preserve read-only sibling, launcher2397595/ports3000–3001, stopped4310–4311 and retained SQLite. No installs, destructive operations, commits or deployment.

## File Responsibilities

| Files | C responsibility |
| --- | --- |
| New `services/localWorkspace/normalized/bulkProject.ts` | Pure bulk contracts, detached input, replacement preparation, request/baseline framing and independent component verification. No IDB or worker ownership. |
| `normalized/schema.ts`, `commitProof.ts`, `codec.ts`, `projectBaseline.ts` | Tagged bulk head, one current baseline, matching preference boundary, strict shape/lineage checks and dedicated non-self-referential frames. Old delta grammar unchanged. |
| `normalized/repository.ts` | Atomic project-only replacement through existing capture/seal writer; durable attempt inspection, reset both windows, fresh readback and complete cache rebinding. Current-source admission recognizes bulk baseline without changing birth. |
| `services/document/references.ts`, `normalized/validateChanges.ts` | Cooperatively build replacement reference/fold indexes if existing synchronous builders cannot satisfy bulk-work bounds. Preserve existing incremental update behavior. |
| `workspaceWorkerProtocol.ts`, `workspaceWorkerClient.ts`, `normalized/coordinator.ts` | Correlated replacement/inspection messages through existing project admission and worker FIFO. Protocol version and deadlines unchanged. |
| `incrementalQueue.ts`, `incrementalCommandAdmission.ts`, `projectWriteRecovery.ts`, `projectAuthority.ts` | Ordered replacement segment, both-lane authority advancement, authentic recovery receipts and post-boundary dependencies. Never retire membership for replacement. |
| `contracts.ts`, `commandDispatcher.ts`, `hooks/useIncrementalProjectWrites.ts`, `services/document/contracts.ts`, `hooks/useDocumentEditor.ts` | Typed private replacement command; immutable event carries complete preference semantics; hook maps replacement dependencies and consumes paired preference effect once. Historical dispatcher rejects unsupported private command before payload access. |
| New `services/localWorkspace/normalized/workspaceRecovery.ts` | Pure normalized recovery preparation and validated accepted-source data, reusing existing changed-only legacy-copy semantics. |
| New `services/localWorkspace/workspaceRecoveryAdmission.ts` | Private browser-only capture/recapture bridge and opaque recovery capability; delegates all durable writes to worker. |
| `recovery.ts`, `historicalBootstrap.ts`, `normalized/migration.ts`, `normalized/workspaceCommands.ts`, `workspaceCommandAdmission.ts` | Expose only necessary pure preparation/source-capture seams; normalized acceptance and receipt inspection. Never call historical project writer. |
| Tests in `tests/unit/localWorkspace/normalized/`, existing queue/hook/editor suites, `tests/helpers/workspaceCommandHarness.ts` | Pure shape tests plus actual normalization→replacement/recovery→ordinary write→reopen and failure cases. No synthetic successful receipts. |
| `tests/unit/localWorkspaceBoundary.test.ts` | Exact new import/capability grants only. |

Do not refactor unrelated repository code or production `EditorPage`/store startup. Record any genuinely required additional seam before using it.

## Shared Bulk Contract

Types belong in `normalized/schema.ts`; implementation belongs in `bulkProject.ts`. The supplied state is the complete public state including raw fold values. Explicit preferences must match its partitioned scalar/fold semantics; `panelsExpanded`, which has no public-state representation, is supplied separately within that complete preference object. Wrapper metadata is copied from the independently validated current project, not caller-supplied stale wrappers.

```ts
export interface BulkDocumentBatch {
  scope: ProjectScope;
  clientId: string;
  commitGeneration: number;
  commitId: string;
  editorGeneration: number;
  expected: AuthorityStamp;
  state: AppState;
  preferences: EditorPreferences;
  metadata?: Extract<ProjectMetadataEdit, { kind: 'linked-root' }>;
}
export interface BulkCommitProof extends CommitProof { kind: 'bulk-document' }
export interface BulkProjectBaseline {
  proof: BulkCommitProof;
  digests: ProjectBaselineDigests;
}
export interface BulkDocumentAck {
  type: 'document-replaced';
  projectId: string;
  incarnation: string;
  commitId: string;
  editorGeneration: number;
  authority: AuthorityStamp;
  boundaryDigest: string;
}
```

`ProjectHeader.bulkBaseline` holds exactly one current baseline. `ProjectPreferences.bulkBoundary` holds its `manifestDigest`. Both head proofs initially contain the same tagged bulk proof; neither window contains a bulk delta or replaced-address list. `kind` is allowed only on the tagged bulk head; old `CommitDelta.proof` validation continues to reject it. Subsequent ordinary proofs bind the retained boundary through their existing record-core digests.

Replacement accepts current-schema prepared state through `validatePreparedWorkspaceProjectWork`, never loader normalization that can rewrite valid extension fields. Only linked-root renaming is bundled; ordinary name/cloud metadata patches remain separate ordered operations. Before a new replacement mutation, require the executing cache's exact authority to match the captured expected authority, then compare every captured record to that admitted cache using cooperative frames. A deferred/stale cache requires explicit fresh admission; do not run ordinary synchronous catch-up inside this bulk boundary. Independently verified same-attempt replay precedes this new-mutation cache check.

Dedicated bulk image/lane frames omit only outer `commitProof`, `commitWindow`, header `bulkBaseline` and preference `bulkBoundary`; similarly named external payload fields remain. Bulk core frames use a separate domain and the same omissions, preventing a digest cycle. The bulk proof manifest hashes scope, identity, request digest, before/after stamps, core digests and component digests/count. Initial birth frames and old delta frames remain byte-compatible.

Shape validation requires all three counters to advance exactly once; both floors start at the new lane revisions. Every later head/delta must be at or above both boundary revisions. Header baseline and preference boundary must match even when only one lane advances. At the boundary document revision, independently recompute document digest; at the boundary preference revision, independently recompute preference and raw-fold digests. When both remain at the boundary, recompute full image and record count.

Repository surface:

```ts
commitReplacement(batch: BulkDocumentBatch): Promise<BulkDocumentAck>;
inspectReplacement(batch: BulkDocumentBatch): Promise<
  | { type: 'committed'; ack: BulkDocumentAck }
  | { type: 'not-committed' }
  | { type: 'conflict'; reason: 'authority-changed' | 'identity-mismatch'
      | 'proof-unavailable' | 'verification-failed' | 'incarnation-changed' }
>;
```

Unavailable inspection throws to the existing transport's unknown-outcome path. Non-commit needs authentic old-owner aborted/not-posted evidence and exact unchanged authority; a fresh repository cannot infer absence. Committed inspection requires the current boundary, exact request identity and independent sealed image verification; later edits/replacement produce conflict rather than stale success.

Pure module interface:

```ts
interface PreparedBulkProject {
  project: NormalizedProject;
  ack: BulkDocumentAck;
  release(): void;
}
captureBulkDocumentBatch(input: unknown, work: WorkRuntime): Promise<{ batch: BulkDocumentBatch; release(): void }>;
hashBulkDocumentRequest(batch: BulkDocumentBatch, work: WorkRuntime): Promise<string>;
prepareBulkProject(current: NormalizedProject, batch: BulkDocumentBatch, now: string, work: WorkRuntime): Promise<PreparedBulkProject>;
verifyBulkProjectBaseline(project: NormalizedProject, work: WorkRuntime): Promise<void>;
```

**Exact cut authority:** Existing document acknowledgements do not carry preference revision, even when structural document work also changes folds/preferences. Do not infer that revision from their fold generation or from the queue's preference lower bound. Add a private correlated `project-cut-authority` request under the existing project admission. It returns `readAdmittedProjectAuthority(scope): AuthorityStamp`: the repository owner's last independently verified full pair stamp, maintained separately from its potentially deferred cache stamp. This accessor performs no storage read/rebase and is unavailable after owner invalidation. Initialize it on genuine bootstrap and update only after verified local commit/readback (including replacement), never from an unverified header. The queue requests it after its pre-cut work drains and before posting replacement; require matching document/fold authority and a preference revision at least its acknowledged lower bound. Any subsequent foreign change fails the exact replacement CAS. Unknown earlier work must complete inspection/fresh admission first. Keep ordinary acknowledgement shapes unchanged. Mandatory regression: structural fold rewrite→replacement with no intervening preference acknowledgement, including the inspected/re-admitted path.

**Exact structural readmission evidence:** Genuine editor regressions reproduce refusal for both an acknowledged structural save and an independently inspected lost reply. Retain one metadata-only `DocumentCommitReceipt` (scope, complete document commit identity, correlated document ACK) in the authenticated queue checkpoint; do not retain its batch/state/changes. During recovery only, if fresh preferences exceed the acknowledged lower bound, request `document-readmission-authority` with that receipt and the fresh project admission. Repository `readDocumentReadmissionAuthority(receipt)` reuses existing independent commit inspection: match complete identity and ACK, require the current full pair to equal the retained proof's after-stamp, validate manifest/core/selected postconditions, then return that exact after-stamp. A missing/evicted/superseded proof, foreign preference save, corrupted selected record or receipt mismatch refuses recovery. Unknown document attempts first pass the existing full-batch inspection (including request digest); only its committed result can mint the corresponding retained receipt. The new response correlates scope, fresh admission, complete identity and all ACK-known counters; queue still requires exact equality with fresh D/P/fold authority. No inference from fold generation, equality relaxation, foreign rebasing, ordinary ACK/protocol-version/deadline change, additional normal-save request or durable store. Existing ordinary inspection replies keep their original shapes.

## Task 1: Bulk Proof and Pure Replacement Preparation

**Files:** `schema.ts`, `commitProof.ts`, `codec.ts`, `projectBaseline.ts`, new `bulkProject.ts`, new `tests/unit/localWorkspace/normalized/bulkProject.test.ts`, boundary tests.

- [x] Write failing tests for tagged heads, same-incarnation preparation, exact D/P/fold increments, both empty windows/floors, wrapper preservation, raw folds, explicit panels, invalid preference/state mismatch, overflow and hostile private metadata.

```ts
const prepared = await prepareBulkProject(current, batch, now, work);
const header = prepared.project.projectHeaders.values().next().value!;
const preferences = prepared.project.projectPreferences.values().next().value!;
expect(header.incarnation).toBe(current.scope.incarnation);
expect(header.commitWindow).toEqual({ floorRevision: batch.expected.documentRevision + 1, entries: [] });
expect(preferences.commitWindow).toEqual({ floorRevision: batch.expected.preferenceRevision + 1, entries: [] });
expect(preferences.bulkBoundary).toBe(header.bulkBaseline!.proof.manifestDigest);
await verifyBulkProjectBaseline(prepared.project, work);
```

- [x] Run `npx vitest run tests/unit/localWorkspace/normalized/bulkProject.test.ts --maxWorkers=1`; observe missing-interface/behavior RED before runtime changes.
- [x] Implement `captureBulkDocumentBatch`, `hashBulkDocumentRequest`, `prepareBulkProject` and `verifyBulkProjectBaseline`. Capture immutable input before suspension, retain measured ownership, validate complete replacement with existing validators, preserve admitted ancestry, derive all digests outside transactions. Returned prepared image has explicit `release()` custody.
- [x] Extend strict codec/lineage validation and dedicated frames. Reject forged null-proof, mismatched boundaries, old deltas crossing the boundary, unknown tags/fields and asymmetric-baseline corruption. Returning a prepared image grants no storage admission.
- [x] Run bulk/codec/proof/birth suites and exact boundary checks. Check Work cancellation and zero retained temporary ownership on refusal.

## Task 2: Atomic Replacement, Inspection and Cache Boundary

**Files:** `repository.ts`, reference/fold index helpers if required, new `tests/unit/localWorkspace/normalized/bulkTransactions.test.ts`.

- [x] Add real normalization/command-fixture tests before implementing repository methods. Use `createWorkspaceCommandHarness`; read actual records and bind genuine project admission. Never seed bulk success records manually.

```ts
const beforeWorkspace = await physicalRows(h, ['workspace', 'projects', 'migrationLedger', 'legacyBackup']);
const ack = await h.repository.commitReplacement(batch);
expect(ack.authority).toEqual({ documentRevision: 1, preferenceRevision: 1, foldStructureGeneration: 1 });
expect(await physicalRows(h, ['workspace', 'projects', 'migrationLedger', 'legacyBackup'])).toEqual(beforeWorkspace);
expect((await h.repository.exportProjectForRecovery(batch.scope)).project.initialState.nodes.root.title).toBe('Replacement');
```

- [x] Run `npx vitest run tests/unit/localWorkspace/normalized/bulkTransactions.test.ts --maxWorkers=1`; preserve intended RED. Expensive immutable fixture setup can use existing10000ms hooks; do not move the actual replacement/assertions out of5000ms test bodies.
- [x] Reuse scoped capture/seal machinery to enumerate only the target incarnation, including range EOF. Verify captured current records and admitted immutable ancestry, prepare replacement, seal all before rows and exact authority in one transaction, delete those exact rows and add the complete replacement. Do not clear stores or mutate workspace/history sources.
- [x] Mark the executing cached owner nonwritable synchronously at durable completion. Independently recapture, validate baseline/components and seal the target; then install records/reference/fold indexes together. Any postcommit failure retains unknown outcome and invalidates caches. Another owner with a different boundary fails `ingress-required` before any ordinary selected catch-up, including scalar-only preferences.
- [x] Implement inspection and replay protection; cover faults at every actual put/delete, source/epoch changes, lost reply, postcommit corruption, repeated replacement, old aborted attempts, receipt eviction, asymmetric ordinary saves and fresh active reopen. Old saved attempts cannot become not-committed across a new floor.

## Task 3: Worker/Store Replacement Protocol

**Files:** protocol/client/coordinator, contracts/dispatcher, worker tests and private store tests.

- [x] Add a RED real-worker roundtrip using the genuine normalized fixture and project bootstrap:

```ts
const response = await client.request({ type: 'replace-document', admissionId: binding.admissionId, batch });
expect(response.type).toBe('replacement-result');
```

- [x] Add `project-cut-authority`, `replace-document` and `inspect-replacement` request families and correlated authority/replacement/inspection responses. Validate framing/identity before bulk payload access, then delegate to repository through the shared FIFO. The cut response exposes only the already independently verified owner stamp, not newly read foreign authority. Keep protocolVersion1 and30000ms transport.
- [x] Add typed private `replace-document` store commit alongside existing overloads; historical dispatcher rejects it without inspecting `state`. Bootstrap remains the sole project-admission minting path.
- [x] Test stale admission/epoch, clone failure, timeout, wrong response identity/stamp, termination and lost committed reply. Acknowledgement is metadata-only; no unchanged project graph in normal replies.
- [x] Run worker, dispatcher and exact boundary suites; update no production entrypoint.

## Task 4: Ordered Queue Segment and Actual Editor History

**Files:** queue/admission/recovery bridge, project authority, hook/editor contracts, actual editor integration suites.

- [x] Add failing real editor cases: replacement→edit→Undo/Redo, replacement Undo/Redo, current scalar/raw-fold preservation, paired preference delivery, queued earlier metadata, late edits behind replacement, and lost reply/restart with same editor/history owner.
- [x] Add a `replacement` queue segment with opaque per-submission receipt. Seal earlier document/preferences work, obtain the exact verified cut authority described above, retain later work, never coalesce across the segment. Advance document/preference/fold authority once from the correlated bulk acknowledgement.
- [x] Capture complete immutable replacement preferences in the editor event. Hook admits replacement instead of refusing it; maps `after-replacement` through its verified write generation, consumes that event's paired preference patch exactly once, and preserves separate local/write clocks.
- [x] Extend authentic retained-write recovery to inspect replacement attempts, bind exact fresh boundary and replay only proven not-posted/noncommitted work. Preserve original failed promises, unsaved replacement/history and later edits. No remount or retirement-token reuse.
- [x] Run `npx vitest run tests/unit/useIncrementalProjectWrites.test.tsx tests/unit/ProjectEditor.incrementalPersistence.test.tsx --maxWorkers=1` plus queue/admission suites. Do not relabel the existing G6 timing failure as fixed.

## Task 5: Recovery-as-Copies and Accepted-Source Bridge

**Files:** new recovery preparation/admission modules, existing recovery/historical/normalization/workspace command seams, new real recovery transaction/bridge tests.

**Concrete private seam:** `prepareWorkspaceRecovery(workspaceToken, batch)` validates and retains one complete sealed current capture plus prepared additions under an opaque repository capability; `commitWorkspaceRecovery(workspaceToken, capability)` consumes that preparation through the existing workspace FIFO/sealer. Ordinary `commitWorkspace` rejects recovery intents. Preparation does not write or grant project editing authority. Disposal, a new preparation or owner fencing releases retained resources. The recovery batch carries recovery ID, raw current source and its digest; its exact before-manifest binds accepted-source identity. Copy IDs derive from the immutable request digest with collision suffixing; incarnations use the existing workspace-revision/member-ordinal derivation. Recovery leaves the active project and existing member records unchanged. Existing workspace attempt inspection verifies the recovery receipt, created births, ancillary descriptors and exact conflict backup independently, including after worker restart. Reuse active-reader validation with retained capture custody rather than validating one image and sealing a different image. The browser bridge uses the existing workspace barrier for preparation and commit, with final synchronous raw-source/lifecycle comparison immediately before transport posting. No browser IDB capability or historical writer is added.

**Quiet lifecycle pin:** the browser bridge requires an `AbortSignal` pinned to the confirmed source/lifecycle epoch, aborted by that owner on revocation. Callback-bearing ownership/generation checks precede the final raw captures. After those captures, inspect the pinned signal with the native `AbortSignal.prototype.aborted` getter and check only callback-free queue/installation facts before posting. Re-running an arbitrary ownership callback after the final raw read is not a valid quiet fence: that callback can itself change same-tab legacy storage without advancing a storage-event generation. No production lifecycle wiring is added in C.

- [x] Add RED real scenarios where valid normalized current membership coexists with changed legacy projects/presets/imports. Pin current source, accepted backup, recovery ID and current workspace admission independently; invalid current target must refuse recovery.
- [x] Factor only the pure changed-copy selection from `prepareLegacyRecovery`: reserve all current/accepted/durable IDs; copy changed projects/presets/pending import with fresh identities; preserve established recovered naming, provenance and import cloud stripping. Supply current normalized compatibility records without treating them as immutable source records.
- [x] Add dedicated opaque recovery admission and worker preparation/commit messages. Browser bridge captures/recaptures legacy values; worker owns all normalized validation/preparation/writes. A final quiet source/lifecycle fence immediately precedes the admitted commit with no intervening observer.
- [x] In one repository transaction add copies, update ancillary descriptors/order, add conflict backup and update manifest acceptance/receipt. Leave historical projects/ledger and immutable normalization archive untouched. Reopen validates later backup evidence separately and uses current accepted-source state, not original ledger acceptance for live admission.
- [x] Cover changed source before/after commit, stale recovery ID, each write-fault ordinal, quota/clone failure, concurrent workspace command, lost reply, independent inspection and confirmation-required new drift. Tests assert no overwritten current member and byte-identical retained source.

## Task 6: Connected Verification and Review

- [x] Run focused tests during each task; run complete affected storage/worker/queue/hook/editor suites at connected milestones, with one worker. Keep every failed receipt and unchanged deadline.
- [x] Run full exact boundary suite, `npx tsc --noEmit --pretty false`, and a fresh production build with unique `/tmp/opencode/doctect-incremental-sdd/task-14-...` output. Report known StickerPressTS2339 separately; never suppress it.
- [x] Read-only review against the immediate dirty baseline; independently inspect transaction scope, baseline/lane integrity, resource custody and publication/history behavior. Address reproduced findings with regression tests.
- [x] Record source stamp, exact changed files, test outcomes and remaining gates in this plan/ledger. Native C/recovery acceptance and eventual D integration remain explicit follow-ups; missing WebKit libraries/Firefox quota proof stay unresolved without authorization.

No full-C completion claim until Tasks1–5 are connected and verified. No B or release acceptance claim from C progress. The next implementation checkpoint is a coherent bulk boundary, not more performance tooling.

## Verified Backend Checkpoint — C Still In Progress

Pure replacement preparation, tagged baseline/lane validation, target-only atomic writer, cache reset, exact admitted cut stamp and replacement/inspection worker families are implemented. Private store/queue/hook/editor integration and recovery-as-copies remain unimplemented; Tasks3–5 are not complete. No production switch.

New suites now contain129cases (26pure/preparation/index,24repository,66actual write-position rollback cases using three injected errors,10protocol,3real worker cases), all passing in the final complete covering set. Earlier focused125PASS receipt predates the final four corruption-classification regressions and is preserved separately. Shared-writer fault matrix covers all22delete/add positions, preserving all old project/source rows after each abort. Injection is not native quota evidence.

Review`ses_f041c4076ffee7D3xadK95hwl7` found three issues reproduced by intended RED tests: loader normalization dropped valid padding extensions, deterministic postcommit corruption escaped inspection's conflict result, and ordinary cache synchronization performed four non-Work hash calls. Corrections use lossless prepared-state validation, tag only in-memory validation failures while leaving storage I/O outside that boundary, and require exact cached authority with cooperative full-record comparison rather than synchronous catch-up. Same committed-attempt replay remains allowed before that cache check. Separate RED fixes prevent concealing same-size pre-replacement corruption and reject changed-payload identity reuse after a proven abort.

The first14-file connected command reached its420000ms controller ceiling before a terminal reporter event. Its partial receipt`task-14-bulk-connected-01.jsonl` is retained and excluded from passing verification. No test deadline changed; complete bounded file groups replaced that incomplete command, not individual failed test outcomes.

Final three disjoint receipts under `/tmp/opencode/doctect-incremental-sdd`:

| Receipt | Result |
| --- | --- |
| `task-14-bulk-workspace-regression-01.jsonl` | 189PASS /3files |
| `task-14-bulk-core-regression-01.jsonl` | 470PASS /11files, including all129new cases |
| `task-14-bulk-boundary-01.jsonl` | 954PASS /1file |
| **Complete covering set** | **1613PASS /15files**, zero skipped, retries, missing, module or unhandled outcomes |

Existing evidence parser independently reconciles inventory IDs, terminal counts, unchanged default budgets and matching source stamps. Current application/test/config stamp: **1f2848ac7fd1835de8fdb744c25451972b8591052c0fee9066f49ce79665ead4/1188files**. Scope:17paths plus the untracked ledger, relative to the immediate baseline. Build`task-14-bulk-backend-build-01` passes11.49s/2468modules with existing warnings. Typecheck reports only the known StickerPress793:36TS2339.

Final review by`ses_f041c4076ffee7D3xadK95hwl7` is scoped clear. Its remaining P2 was reproduced for missing header/preferences, foreign-incarnation records and a missing manifest; pure active-target assertions now return typed verification conflicts while preserving baseline/staging behavior and leaving I/O/cancellation outside conversion. All four regressions pass, as does the unavailable-IDB unknown-outcome case.

HEAD/empty index/whitespace and three protected sibling hashes are unchanged. Launcher2397595 remains alive on3000/3001;4310/4311/4320/4321 are unused and no owned test process remains. No staging, commits, dependency installs, browser-profile migration or production cutover.

**Remaining C work:** typed store command, ordered replacement queue/hook/editor/history integration, extended replacement-window/restart/cross-owner coverage, recovery-as-copies/source bridge, then connected C/native acceptance. The previous full660-case migration/native/interaction receipts belong to the predecessor stamp, not this new source; their open release gates are not waived or relabeled. C and release acceptance remain incomplete. Continue implementation under existing approval; no new broad planning approval is needed.

## Verified Replacement Integration Checkpoint — C Still In Progress

The preceding backend checkpoint is historical. Typed store dispatch and the ordered replacement queue are now connected to the actual editor, write hook, workspace lifecycle observer and authenticated replacement recovery. The immediate integration baseline is `/tmp/opencode/doctect-incremental-sdd/task-14-replacement-integration-baseline`, captured before this slice at the backend stamp above.

Implemented:

- `ReplacementWorkspaceCommand` has a correlated `BulkDocumentAck` overload. Historical dispatch refuses unsupported replacement without inspecting its state. Private admission associates the exact command with one opaque queue receipt.
- Replacement seals both earlier lanes, requests the exact last-verified cut, checks scope/admission and all authority counters, and retains later edits behind the boundary. Neither membership nor editor source is retired. Read-only cut failure/freeze retains an unposted replacement, not a fabricated mutation attempt.
- Immutable editor replacement events include complete preferences. The hook marks both lanes pending/covered from the one bulk receipt, maps local replacement generations to write generations, consumes duplicate paired preference delivery, and rejects payload accessors without evaluating them.
- Real editor tests exercise replacement → late edit → Undo/Redo, Undo/Redo of replacement, preserved current scalar preferences, linked root metadata, later folds after metadata separates the clocks, and lost committed replacement with retained later work and the same editor/history/write owner.
- Queue recovery inspects replacement attempts, binds the exact fresh bulk authority, preserves original rejected promises and replays only later or genuinely unposted work. Workspace observers advance all three counters together. No production entrypoint changed.

Two correctness issues were reproduced and fixed: ordinary template saves discarded the still-needed replacement fold dependency, and a second recovery candidate compared nested authority stamps by object identity. The queue now retains one current replacement acknowledgement (metadata only) alongside existing dependency metadata; repeated verified receipts compare all three authority counters by value. A genuine-worker test rejects the first recovery candidate, then readmits the same original checkpoint without posting another replacement. Read-only review `ses_f02593af2ffe9kfKQPTgDV4r9n` is scoped clear after this correction; packages `task-14-replacement-integration-review-01/02.md` preserve the reviewed source.

New coverage: **14 cases** (11 in `bulkQueue.test.ts`, 3 real editor integration cases), plus an updated existing accessor-refusal test. Earlier fixture REDs are retained: direct editor calls needed actual effect draining, and replacement resets session selection, requiring normal selection before typing. Corrected tests then failed on missing behavior before implementation.

Final complete disjoint covering set, all at application/test/config stamp **d6ffe51b03160ed900ca40e6091afae723123ef7d33c18f003fffeea25cadd27/1189files**:

| Receipt under `/tmp/opencode/doctect-incremental-sdd` | Result |
| --- | --- |
| `task-14-replacement-core-final-01.jsonl` | 273PASS /4files |
| `task-14-replacement-editor-final-01.jsonl` | 329PASS /3files |
| `task-14-replacement-workspace-final-01.jsonl` | 63PASS /3files |
| `task-14-replacement-boundary-final-01.jsonl` | 954PASS /1file |
| **Complete covering set** | **1619PASS /11files**, zero skipped, retries, missing, module or unhandled outcomes |

Existing evidence parsers independently reconcile inventory IDs, terminal counts, default5000ms/10000ms budgets and matching source stamps. Build `task-14-replacement-integration-build-01` passes11.24s/2468modules with existing chunk warnings. Typecheck still reports only StickerPress793:36TS2339. The integration review delta contains15 application/test paths before this plan update; no normalized repository/protocol/backend runtime changed in this slice.

Preserved nonpassing evidence:

- `task-14-replacement-editor-regression-01.jsonl`:328PASS/1timeout in the existing preference-conflict rejection case at unchanged5000ms. The later whole-suite run follows the actual recovery-receipt correction and additional assertions; it is not a causal timing fix or replacement of the earlier failure. G6 passing here does not waive previous timing or responsiveness gates.
- `task-14-replacement-boundary-01.jsonl`: incomplete command at120000ms controller ceiling, without terminal reporter event. Excluded from acceptance. The later complete command uses a larger shell allowance, not altered test limits.

HEAD, empty index, whitespace and all three protected sibling hashes remain unchanged. At the final observation, prior launcherPID2397595 is absent and none of3000/3001/4310/4311/4320/4321 listens. This session did not stop or restart that launcher; its stop time/cause is not established. No owned test process remains. No installs, commits, migration of existing profiles or production cutover.

**Remaining functionality, before full Task4/C completion:** the mandatory structural fold save → replacement after inspection/readmission path still needs exact preference authority. Existing strict readmission compares its fresh full stamp with an acknowledged preference lower bound; an ordinary structural document acknowledgement does not supply the missing preference revision. Do not infer it from fold generation, relax equality, silently adopt a foreign revision or claim this case covered by the normal structural→cut test. Add authenticated evidence for that path and its regression, then finish extended restart/window/cross-owner coverage and Task5 recovery-as-copies/source bridge. Full current migration/native/interaction acceptance and eventual D integration remain separate. Existing approval continues; no new broad planning approval or performance detour is needed.

## Verified Structural Readmission Checkpoint — Exact Preference Gap Closed

The preceding checkpoint's exact-preference recovery gap is now fixed. Both actual-editor scenarios were reproduced as `source-changed` failures before runtime changes: an acknowledged structural fold save and an independently inspected lost structural reply, each followed by retained replacement. Recovery now preserves the same editor/history/write owner, proves preference revision1 from the actual committed proof, applies replacement with exact1/1/1 preconditions, and permits subsequent Undo. No earlier structural save or committed replacement is posted twice.

Implementation follows the readmission-evidence contract above. The queue retains exactly one immutable metadata-only `DocumentCommitReceipt`, replacing it on verified ordinary document success and clearing it on verified bulk success. Unknown document attempts still pass existing full-batch digest-checked inspection first. Only a recovery preference gap triggers the new fresh-admission-correlated request. `readDocumentReadmissionAuthority` returns a copied after-stamp from the same independently verified proof, never a later cache/header read. Original ordinary acknowledgements and inspection response shapes remain unchanged; normal saves send no additional request. The recovery await is counted for quiescence and fenced before/after suspension and callback-bearing installation checks.

New coverage totals **26 cases**:20 repository/real-worker evidence and correlation cases,3 queue interruption/source/false-stamp cases,3 actual editor success/conflict cases. Coverage includes full identity/ACK mismatch, stale admission, wrong response scope/identity/counters/epoch, accessors, unavailable IDB, selected-record corruption, foreign preference advancement, actual eviction from both lane windows and a later bulk baseline. Conflicted local replacement stays unsaved; fabricated preference stamps, changed source or freeze during readmission cannot post it. Failed worker inspection preserves its typed domain cause rather than being mislabeled malformed input.

Read-only review `ses_f006fcb26ffeq1D8qPRmEnMRsP` is scoped clear. Its P2 concerned the test fixture, not an unsafe runtime acceptance: advancing only document writes leaves the structural proof in the preference lane, so `authority-changed` was correct. The original failed receipt is retained as `task-14-structural-eviction-fixture-01.jsonl`; the corrected case advances both lanes and asserts absence from both heads/windows before expecting `proof-unavailable`. No deadline or expected safety outcome was weakened.

Immediate baseline: `/tmp/opencode/doctect-incremental-sdd/task-14-structural-readmission-baseline`. Current application/test/config stamp: **945cb92a513f5c480437b9d4cdbffc30ef0f78a9440bc655e23588adc4fccd7b/1190files**. Nine paths changed versus that baseline (five runtime files, three test files, this plan), plus the untracked ledger. Review packages `task-14-structural-readmission-review-01/02.md` preserve the runtime delta.

| Complete disjoint receipt under `/tmp/opencode/doctect-incremental-sdd` | Result |
| --- | --- |
| `task-14-structural-core-final-01.jsonl` | 363PASS /5files |
| `task-14-structural-editor-final-01.jsonl` | 109PASS /2files |
| `task-14-structural-worker-final-01.jsonl` | 109PASS /3files, including actual Vite worker-edge build |
| `task-14-structural-boundary-final-01.jsonl` | 954PASS /1file |
| **Complete affected covering set** | **1535PASS /11files**, zero skipped, retries, missing, module or unhandled outcomes |

Existing evidence parser independently reconciles inventories, terminal counts, exact matching stamps and original5000ms/10000ms defaults. Build `task-14-structural-readmission-build-01` passes10.89s/2468modules with existing warnings. Typecheck reports only known StickerPress793:36TS2339. HEAD, empty index, whitespace and protected sibling hashes remain unchanged; protected ports remain unused and no owned test process remains. No service restart, install, staging/commit, existing-profile migration or production cutover.

**Next:** implement Task5 normalized recovery-as-copies and accepted-source bridge; finish remaining replacement acceptance-matrix items and connected current C/native verification. The structural readmission gap is no longer a prerequisite. No full-C, migration/performance or release acceptance claim follows from these affected tests; older failed/timed-out and unavailable-browser evidence remains preserved. Continue approved implementation inline without another broad planning or optimization cycle.

## Verified Recovery-as-Copies Checkpoint — Private C Functionality Connected

All preceding remaining-functionality notes are historical. Tasks1–5 are now connected and covered by the private implementation; Task6's affected unit/build/review work is complete. This is not native C acceptance, responsiveness acceptance, a production cutover or release approval.

### Implemented

- `normalized/workspaceRecovery.ts` and the factored pure `prepareLegacyRecoveryCopies` share changed-only legacy selection. IDs reserve current, accepted and durable identities; copied projects retain recovered naming and wrapper extensions, while copied project/import cloud authority is stripped. Preset/import positions append without overwriting current rows. Historical preparation retains its prior detached-input semantics.
- Repository recovery preparation authenticates the existing workspace admission, independently validates the complete current normalized target and accepted backup, and retains that exact capture under one opaque preparation capability. No preparation writes occur. Commit consumes the capability through the same FIFO and atomic sealer. All additions, ancillary descriptors, conflict backup, acceptance and receipt commit together. Ordinary workspace dispatch refuses recovery intents.
- Existing current projects, active selection, historical project rows, migration ledger, original backups and normalization archive remain unchanged. Recovery uses normalized current records only as current compatibility data, never as immutable migration source. Fresh-origin workspaces can accept drift without fabricating historical ledger rows.
- Worker preparation and metadata-only commit/discard messages are correlated with owner, identity, before-stamp, recovery ID and digest. Browser confirmation is an opaque one-use capability. Preparation and commit run inside the existing workspace cut; earlier edits drain and later edits stay behind it. Current installed editor owners remain intact.
- Final source fence runs callback-bearing checks before raw capture; a genuine native `AbortSignal` supplies callback-free lifecycle validation afterward. D must wire that signal to source/lifecycle revocation. No production caller is added here.
- Fresh inspection verifies current receipt, created births, ancillary state and exact accepted conflict backup. Unknown outcomes do not imply rollback; lost replies recover once without replaying copies. Later target edits/workspace advancement, reused recovery IDs, changed source, malformed backups or unsupported authority fail closed. Postcommit drift requires a new confirmation rather than reversing successful recovery.
- Remaining replacement matrix now includes a distinct second replacement through a freshly admitted owner, asymmetric document/preference window eviction, old aborted attempts across new floors, stale admission, wrong response epoch/identity/stamp, actual clone failure, termination and the unchanged30000ms timeout.

### Regression and review evidence

**121 new cases:**108 recovery cases across five new files,11 replacement matrix cases,2 exact boundary cases. Recovery fault coverage is **60 fault-injection cases across15 actual write ordinals**: before/after AbortError plus after QuotaExceededError/DataCloneError. Calibration proves those ordinals include every project record, both ancillary rows, conflict backup and manifest. This is injected atomicity evidence, not native quota acceptance.

Read-only review `ses_f00075201ffe06ifwu96E7nsSW` is scoped clear. Reproduced findings and fixes include: lifecycle observer mutating source after final reads; revocation during final read; cleanup when editor ownership changes as preparation returns; wrapper references retaining an already-accounted-as-released capture; backup corruption incorrectly returning unknown; and tampered recovered material metadata reaching publication. Intended REDs, follow-up REDs and corresponding GREENs remain under `/tmp/opencode/doctect-incremental-sdd/task-14-recovery-*`. Fixture mistakes (pending input wrongly carrying `warnings`, incomplete cloud metadata) are preserved separately rather than treated as runtime defects. No timeout was raised.

### Complete affected covering set

| Receipt under `/tmp/opencode/doctect-incremental-sdd` | Result | Source |
| --- | --- | --- |
| `task-14-recovery-storage-final-01.jsonl` | 146PASS /7files | A |
| `task-14-recovery-workspace-final-01.jsonl` | 419PASS /6files | A |
| `task-14-recovery-editor-final-01.jsonl` | 392PASS /5files | A |
| `task-14-recovery-core-final-01.jsonl` | 347PASS /6files | A |
| `task-14-recovery-worker-final-02.jsonl` | 242PASS /4files | B |
| `task-14-recovery-boundary-final-01.jsonl` | 956PASS /1file | B |
| **Qualified aggregate** | **2502PASS /29files** | Identical runtime/config; fixture-only transition |

- **A:** `d70673bdc5933cec6724f6163970ae36bec8ab6005dcf07c23397439e5fde5c4`/1197files.
- **B, current:** `c5b9651f6c8c24461a523630295e7405a3ea0ec1b17eb894b09a4982b21ac554`/1197files.
- This is deliberately **not described as a single-stamp campaign**. `task-14-recovery-worker-final-01.jsonl` recorded236PASS/6FAIL: the allocator-seeding helper's exact bundled-input fixture still expected only client/protocol, but the protocol now imports the existing pure `legacyTypes.ts` leaf. The sole A→B change is the explicit55-byte test assertion addition of that filename. `task-14-recovery-worker-fixture-baseline` and `task-14-recovery-worker-fixture-review-01.md` prove the one-file delta; no application/config code or deadlines changed. The entire affected242-case group was rerun, not individual retries. The failed receipt remains preserved and excluded from the passing aggregate.
- Existing evidence parsers independently reconcile all2502 disjoint inventory IDs, terminal counts and default5000ms tests/10000ms hooks/one worker, with zero skipped, repeated, missing, module or unhandled outcomes. The actual private Vite client→module-worker build is included. Current G6 pass does not establish a timing fix for earlier failures.
- Production build `task-14-recovery-copies-build-01` passes **15.28s/2468modules**, with existing chunk warnings. `npx tsc --noEmit --pretty false` reports only known StickerPress793:36TS2339.

### Exact scope and remaining gates

Immediate baseline: `task-14-recovery-copies-baseline`, captured at the prior1190-file structural-readmission checkpoint. Final package `task-14-recovery-copies-review-04.md` covers18paths: eight runtime files (`recovery.ts`; `normalized/{workspaceRecovery,workspaceCommands,repository,coordinator}.ts`; `{workspaceRecoveryAdmission,workspaceCommandAdmission,workspaceWorkerProtocol}.ts`), five new recovery test files, existing `bulkTransactions.test.ts`, `bulkWorker.test.ts`, `workspaceWorker.test.ts`, the exact boundary suite and this plan. The untracked controller ledger is separate.

HEAD remains `8a2872d9a5acae1be3022923c4c515c70212de83`; index empty; whitespace clean; all three protected sibling hashes unchanged. Protected ports3000/3001/4310/4311/4320/4321 remain unused; prior launcher absent as previously observed; no owned test process remains. No staging, commits, installs, profile migration, service restart or production entrypoint change.

**Next goal-aligned work:** native C replacement/recovery acceptance and remaining performance/release gates, followed by separately authorized D startup/status/export/retry/navigation integration. Earlier18 migration timeouts, prior G6 timing failure, unaccepted responsiveness, unavailable WebKit dependencies and unavailable Firefox safe quota proof are not waived. No broad redesign or new feature detour is implied by this checkpoint.

## Native C Acceptance Slice

Continue under the existing approval. Immediate source is `c5b9651f6c8c24461a523630295e7405a3ea0ec1b17eb894b09a4982b21ac554`/1197files, captured in `/tmp/opencode/doctect-incremental-sdd/task-14-native-c-acceptance-baseline`. Reuse the established isolated native-browser runner and cleanup/quota primitives, but leave B's runner sources and historical reports unchanged. New C-specific runner, entry, worker, tools and tests live under `/tmp/opencode/doctect-incremental-sdd/workspace-bulk-recovery-native-*` and `run-workspace-bulk-recovery-native.mjs`; no production entrypoint, dependency or database version change.

- [x] Test the C runner's exact scenario inventory, environment isolation, output ownership, result accounting and quota classification before implementing it.
- [x] Exercise real module worker and native IndexedDB: replacement→ordinary saves→reopen; lost replacement reply; cross-owner replacement; changed-only recovery with presets/imports; source changes before and after worker preparation; postcommit drift; lost recovery reply and authenticated restart; real editor/history and write hooks across replacement, later edit, recovery, Undo/Redo. The editor case uses a minimal test-only shell, not production UI or latency acceptance.
- [x] Obtain separate native quota rollback evidence for replacement and recovery, comparing all physical stores. Chromium uses the existing one-byte origin quota override and31-second cached-grant expiry **before** mutation dispatch. Recovery may pause after its read-only preparation response; neither a transport request nor its30000ms deadline is extended. Other engines remain explicitly unavailable if no safe verified quota mechanism exists.
- [x] Run each engine in fresh nonpersistent contexts, isolated4320/4321, sanitized environment, exclusive artifact paths and source/tool fingerprints. Use unchanged180000ms native scenario ceilings,60000ms fixture controls and30000ms worker transport. Preserve every failed/unavailable outcome; no retry-until-green or installs.
- [x] Recheck the pinned actual-editor large-project interaction fixture after native validation. Report functional/work evidence separately from automation-plus-two-frame timings; change runtime only for a reproduced, measured blocker under a focused amendment, not speculative Work redesign.
- [x] Run applicable unit/build/typecheck checks, read-only review and scope/resource audit; record exact current evidence. Native/performance/production acceptance stay distinct.

## Native C Checkpoint

Final reports under `/tmp/opencode/doctect-incremental-sdd`, at source **c5b9651f6c8c24461a523630295e7405a3ea0ec1b17eb894b09a4982b21ac554/1197**:

| Artifact | Result |
| --- | --- |
| `task-14-workspace-bulk-native-chromium-ORszLp/report.json` | **11PASS**, accepted for this native C scenario set |
| `task-14-workspace-bulk-native-firefox-Vp1NdG/report.json` | **9PASS /2 quota unavailable**, not full acceptance |
| `task-14-workspace-bulk-native-webkit-Cp5ScS/report.json` | **11 unavailable at launch**, same three missing host libraries |

Both Chromium quota cases produce genuine `quota-exceeded` replies after the verified one-byte override/cache expiry, with **all14 physical stores unchanged** and origin usage unchanged. No injected exception or unlimited-storage flag substitutes for native quota. Normalization/archive, cloud/raw-fold/script preservation, current acceptance, lost replies/restart and actual editor-hook Undo/Redo are exercised. The minimal hook shell is explicitly not the production UI. Source/tool hashes reconcile before/after and across the final campaigns; console/network/cleanup errors are empty. Eighteen current tooling tests pass, including five C-specific cases.

Preserved earlier receipts: `chromium-Re7WRb` stopped before build because whole-object environment equality wrongly compared Node's exotic `process.env` prototype; a regression now checks exact keys/values. `chromium-7Ye2o3` recorded8PASS/3fixtureFAIL from reused client identities after restart and checking transport outcome on a wrapped queue error; fresh per-owner IDs and the actual transport failure receipt corrected those without weakening runtime guards. `chromium-KNw2O3`, `firefox-qZUywI`, `webkit-FNu83T` predate strengthened payload/preference assertions and are not the final acceptance receipts. All remain intact.

Read-only native reviewer `ses_efeaf9d05ffe8diM5sn1gLXOlv` is scoped clear. Its two assertion gaps were closed: replacement preference/content is checked before a later edit can overwrite it; recovered project/preset/import contents are compared with confirmed source before editing and after independent reopen.

The subsequent [font ownership follow-up](2026-10-03-canvas-font-readiness.md) changes only rendering lifetime, not native C's storage/history fixture closure. Do not relabel these native reports with its later source stamp. Current qualified affected unit coverage is1476PASS/18files; latest pinned actual-editor42actions pass, but navigation subset p95 is200ms and the100ms target remains open. A more complex readiness heuristic was rejected and removed. Original font hook, deadlines, persistence, production selection and historical source remain unchanged.
