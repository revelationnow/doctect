# Private Workspace Lifecycle Implementation Plan — Milestone B

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Controller implements inline; no implementation subagents, staging or commits. Read-only review is permitted. Steps use checkbox (`- [ ]`) syntax. This plan is not authorization to switch production persistence.

**Goal:** Implement real normalized create/activate/close, preset and staged-import commands, with atomic receipts, safe queue cuts, outcome inspection and private catalog publication.

**Architecture:** Keep `normalized/repository.ts` as the sole normalized transaction writer. Put declarative command contracts and cooperative preparation in one private module; use the existing coordinator FIFO for workspace and project requests. Add a retaining workspace-barrier entrypoint beside the existing queue barrier, plus a private main-thread admission/catalog owner. Preserve editor-owned working state/history and unchanged ordinary-save acknowledgements.

**Tech Stack:** Existing TypeScript, cooperative Work, IndexedDB, module worker protocol, Vitest/fake IndexedDB and React integration fixtures. No new dependency, durable store or database version.

**Status:** Private lifecycle implementation and expanded receipt/fault coverage are implemented and reviewed; B acceptance remains blocked, not complete. Validation added260tests without application-runtime changes. Current connected covering set:2453PASS/1UI timeout/2454cases across20files. Fresh full migration campaign:642PASS/18timeouts/660cases; full32MiB casePASS437492.74169ms under approved600000ms. No missing/non-timeout/module/unhandled outcomes. Native Chromium6/6PASS including genuine quota rollback; Firefox5functionalPASS/quota unavailable; WebKit unavailable because three host libraries are missing. Pinned42interaction checks pass functionally but include527ms long tasks, not responsiveness/p95 acceptance. BuildPASS; typecheck only known StickerPressTS2339. All failed receipts/default deadlines remain intact. No dependencies were installed, no runtime optimization or production cutover is authorized by this validation checkpoint.

## Global Constraints

- Workdir: `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence`; branch `feat/incremental-local-persistence`; HEAD `8a2872d9a5acae1be3022923c4c515c70212de83`. Preserve dirty predecessor work and empty index.
- Pre-B application/test/config baseline stamp: `b7acaf92b38f389bf338b6ff2b79987769532b93d680bc880ea9cfcc1c920b5d`/1170files. Pre-B full campaign: **649PASS/11timeouts/660cases**,37complete batches,0missing/non-timeout/module/unhandled failures. Evidence: `task-13-migration-10m-cases-0-660-0MVFy5` and `task-13-ten-minute-campaign-01.json` under `/tmp/opencode/doctect-incremental-sdd`. Worker checkpoint stamp: `52904fff8de5b0510159d8bcb024e8b5748ef8f1f817fb3bb64a4606d27ac612`/1176files. Current cuts checkpoint stamp: `5dd15abe7cce7041550358987fcbfba9e73fabc372c8226469f7e7e12bf07a10`/1176files; full migration campaign has not been rerun on either implementation checkpoint.
- Current normal-admission checkpoint stamp: **569d5a168ebc1f14a6a2fba7615ae5d7a44f53031c80c102eca13be596fd7938/1180files**. Neither the prior migration result nor the prior cuts UI timeout is silently relabeled as a result on this stamp.
- Readmission-core checkpoint stamp: **c2453a32894175b21585c59eff80266b117c1e78cf455dbcd7090f065c96371f/1181files**. Immediate immutable baseline is `task-13-workspace-lifecycle-readmission-baseline`; the complete2150/3 result is separate from the incomplete600000ms shell-cutoff receipt and the earlier1947PASS checkpoint. No current full migration campaign or full-green acceptance is claimed.
- Current workspace-restart checkpoint stamp: **b5dae3ad67d04f1ff2fa5cf759a7b6e73282bd38c9c27c70147b3efba40ecdda/1181files**. Immediate baseline is `task-13-workspace-lifecycle-restart-baseline`;2181connected cases pass at unchanged deadlines. This is not full migration/native or production acceptance, and prior timing failures are not relabeled as fixed.
- Current validation stamp: **191c08e02d3f9d6cb7c193e72a61887a5bc2bec3141e5666b78c67edb385a5fc/1182files**. Immediate `task-13-workspace-lifecycle-validation-baseline` starts at the restart checkpoint. Only two test paths and this plan changed, plus the ledger; native runner assets stay external. Current2453/1 connected and642/18 migration outcomes are failed timing gates, not superseded by older passes or diagnostic runs.
- Full32MiB acceptance uses600000ms under the [approved amendment](../specs/2026-09-29-fullsize-normalization-timeout-design.md); all other existing deadlines remain unchanged. Its campaign result401481.622311ms is not a speedup claim. Eleven5000ms failures remain release blockers, not a reason to resume speculative Work optimization.
- Production `WORKSPACE_DB_VERSION=2`; private normalized physical version3/fourteen total stores. No existing-profile migration, runtime writer-selection flag, historical editing fallback, second transaction writer or production cutover.
- Immutable migration source/archive stays separate from current manifest. Never write historical `projects`, `migrationLedger` or retained `legacyBackup` in B. Recovery-as-copies/acceptance changes belong to C.
- Preserve32MiB AppState/depth512/history50, Work1024visits/64KiB, JSON64UTF16units/max192UTF8bytes, SHA<=192bytes/600visits, count-only127units, migration stage64records/256KiB and existing read/derivation/retry limits. No aggregate workspace/wrapper/backup/physical-record cap.
- External IDs stay nonempty without the private256UTF8-byte command-ID cap. Private command IDs/client IDs remain bounded; all durable counters use safe integers and explicit overflow refusal.
- Workspace receipt window remains32entries/64KiB. Project birth survives receipt eviction. Each new accepted workspace attempt increments revision exactly once, including already-satisfied intents; inspecting/replaying the same proven committed attempt never increments it again.
- No async hash, yield or passive observer inside IndexedDB transactions. Reuse the permitted synchronous exact-record seal, not an unbounded synchronous preparation pipeline.
- Register acquired resources inside the charged operation before its post-operation guard. Use charged void assignment for arbitrary clone/read values, not a Work return value that accidentally probes `.then`. Release all leases in finalizers.
- Ordinary document/preferences/metadata saves must not consult the workspace manifest, unrelated projects or ancillary/historical payloads. Project navigation remains an ordinary preference operation; workspace activation is a distinct operation.
- Existing worker30-second transport behavior is unchanged. A timeout/termination is unknown outcome, not rollback. Large bulk transport/native-budget acceptance stays explicit; the ten-minute test amendment does not change transport policy.
- No changes to `shared/cooperativeWork.js`, `shared/jsonWork.js`, SHA, frame limits, dependencies, production `EditorPage`/bootstrap/import callers or protected sibling. Preserve launcher2397595, ports3000/3001, stopped4310/4311, retained SQLite and all historical artifacts. Use `apply_patch`; ask before destructive operations.

## Milestone Boundaries and Existing Seams

| Current seam | Reuse / B change |
| --- | --- |
| `normalized/workspaceManifest.ts` | Existing manifest, member birth, ancillary descriptors and deterministic incarnation allocation; do not add a competing manifest shape. |
| `normalized/workspaceCommitProof.ts` | Existing core/receipt frames and bounded append/verification. New request/postcondition frames belong to command preparation. |
| `normalized/projectBaseline.ts` | Independent image/document/preferences/raw-fold birth digests. New commands must produce real birth rows, not call synthetic layout helpers. |
| `normalized/repository.ts:67–100,257+,1960–2047` | Add workspace admission/commands/inspection inside the existing writer. Existing full active read is an admission boundary, not the implementation of every activate/preset command. |
| `LocalWorkspaceStore.ts:590–745,850–981`; `indexedDbAdapter.ts:1458–1983` | Read-only compatibility references for validation/order/import outcomes. Do not call their historical writers from normalized code or refactor production dispatch incidentally. |
| `incrementalQueue.ts:78–91,585–679` | Existing barrier rejects later enqueue; preserve this compatibility entrypoint. Add workspace-specific submission cuts retaining later surviving-project edits. |
| `workspaceWorkerProtocol.ts`; `normalized/coordinator.ts` | Separate workspace request family, correlated replies and same existing FIFO. `structural-command` remains occurrence-edit only. |
| `projectAuthority.ts`; `incrementalCommandAdmission.ts` | Existing authentic project installation/ack advancement; expose shared private queue access and forward verified ack events without payload inspection. |
| `useDocumentEditor.ts`; `document/contracts.ts` | Add optional stable edit guard checked before state/history mutation. Existing consumers without this guard behave exactly as before. |
| `ProjectEditor.incrementalPersistence.test.tsx` | Real private editor→admission→queue→worker→repository composition, not a fake successful lifecycle adapter. |

B does not implement same-incarnation bulk document replacement, replacement Undo/Redo, recovery-as-copies/source acceptance, live normalized bootstrap/progress transport or production publication/export conversion. Those remain C/D. B may expose private interfaces required by those milestones, but must not claim their implementation.

## File Map

| Path | Responsibility |
| --- | --- |
| New `services/localWorkspace/normalized/workspaceCommands.ts` | Command/batch/result/inspection contracts; strict framing; cooperative request preparation, transition projection and postconditions. No IndexedDB or worker imports. |
| Existing `services/localWorkspace/normalized/repository.ts` | Workspace capability registration, bounded captures/seals, sole atomic writer, independent readback/inspection and scoped owner invalidation. |
| Existing `services/localWorkspace/normalized/codec.ts` | Reuse exported cooperative decomposition; no producer/runtime changes. Extend only if an existing birth-preparation output cannot be consumed without a copy; stop/review before widening behavior. |
| Existing `services/localWorkspace/workspaceWorkerProtocol.ts`, `workspaceWorkerClient.ts`, `normalized/coordinator.ts` | Workspace admission/commit/inspection/fence framing and FIFO; retain project protocol and transport defaults. |
| Existing `services/localWorkspace/incrementalQueue.ts`, `incrementalCommandAdmission.ts` | Retaining cuts, immediate target retirement, post-drain expectations and verified project-ack forwarding. |
| New `services/localWorkspace/workspaceCatalog.ts` | Metadata-only catalog projection and guarded delta application; no document assembly or persistence. |
| New `services/localWorkspace/workspaceCommandAdmission.ts` | Private lifecycle admission, immutable queued intents/attempts, exact target provenance, transport/inspection and publish-once state. |
| New `services/localWorkspace/projectInstallationRegistry.ts` | Shared private installation table and revocable same-realm liveness leases; metadata only, no storage writer. Required to detect replacement/removal without calling reentrant resolvers in the final publication fence. |
| New `services/localWorkspace/projectWriteRecovery.ts` | Opaque retained write-owner/verified readmission bridge. Correlates genuine queue receipts with the same source and fresh installation lease; no payload ownership, editor replacement or storage writer. |
| Existing `services/localWorkspace/contracts.ts`, `commandDispatcher.ts` | New explicitly tagged lifecycle command/result overload; historical snapshot commands remain unchanged and unsupported new handler has no fallback. |
| Existing `services/document/contracts.ts`, `hooks/useDocumentEditor.ts`, `components/ProjectEditor.tsx` | Optional stable edit guard and private registration of generation-bounded outgoing-effect drain; no production-page wiring or layout change. |
| Existing `hooks/useIncrementalProjectWrites.ts` | Captured-generation persistence-cut completion covering both lanes, early admission failure and older metadata obligations; existing update/flush semantics remain. |
| New `tests/helpers/workspaceCommandHarness.ts` | Real normalized fixture and command helpers. Existing synthetic fixtures remain corruption/admission tests, not success-path writers. |
| New `tests/unit/localWorkspace/normalized/workspaceCommands.test.ts`, `workspaceTransactions.test.ts` | Framing/compatibility, real transitions, failure matrix and current-versus-retained verification. |
| New `tests/unit/localWorkspace/normalized/workspaceEvidence.test.ts` | Final real worker count/byte eviction, old-fence capability eviction, all-intent write-ordinal fault matrix and independent postcommit/readback failure inspection. Genuine bounded fixture transitions only; no synthetic success rows or changed deadlines. |
| New `tests/unit/localWorkspace/workspaceCatalog.test.ts`, `workspaceCommandAdmission.test.ts` | Metadata publication, scope/epoch checks, idempotency and retained unknown attempts. |
| Existing queue/worker/store/editor tests and `tests/unit/localWorkspaceBoundary.test.ts` | Exact new integrations/import grants and original behavior preservation. No wildcard capability grant. |
| External `/tmp/opencode/doctect-incremental-sdd/workspace-lifecycle-native-{entry,worker}.ts` and `run-workspace-lifecycle-native.mjs` | Isolated real-browser/worker lifecycle verification assets; unique output/profile, no production-page startup. |

At execution start capture `task-13-workspace-lifecycle-baseline` using `review-artifacts.mjs snapshot task-13-workspace-lifecycle`. The existing `task-13-workspace-lifecycle-planning-baseline` is documentation-only context, not the future implementation baseline. Use the execution workdir and verify artifact parent first. Never compare this feature against HEAD alone.

## Shared Contracts

These contracts are the implementation target, not already-exported APIs. Put storage-facing types in `normalized/workspaceCommands.ts`; import existing durable types rather than duplicate them. The repository capability/fence objects remain same-realm private objects tracked by WeakMap/WeakSet; neither a caller-shaped object nor a wire string can mint them.

```typescript
import type { SnapshotWorkspaceCommand, WorkspaceProject, WorkspaceCustomPreset,
  WorkspacePendingImport } from '../contracts';
import type { AuthorityStamp, ProjectScope, NormalizedProject } from './schema';
import type { WorkspaceCommandIdentity, WorkspaceStamp, WorkspaceReceipt,
  PresetDescriptor, ImportDescriptor } from './workspaceManifest';

export type WorkspaceLifecycleIntent = Exclude<SnapshotWorkspaceCommand,
  { type: 'save-project' | 'recover-legacy-as-copies' }>;
export type WorkspaceTarget =
  | { readonly type: 'member'; readonly scope: ProjectScope }
  | { readonly type: 'lineage'; readonly scope: ProjectScope; readonly authority: AuthorityStamp };
export interface WorkspaceBatch {
  readonly storageGeneration: string;
  readonly identity: WorkspaceCommandIdentity;
  readonly expected: WorkspaceStamp;
  readonly targets: readonly WorkspaceTarget[];
  readonly intent: WorkspaceLifecycleIntent;
}
export interface WorkspaceCatalog {
  readonly storageGeneration: string;
  readonly stamp: WorkspaceStamp;
  readonly members: readonly ProjectScope[];
  readonly activeProjectId: string;
  readonly presets: readonly PresetDescriptor[];
  readonly pendingImports: readonly ImportDescriptor[];
}
export interface WorkspaceCatalogDelta {
  readonly storageGeneration: string;
  readonly before: WorkspaceStamp;
  readonly after: WorkspaceStamp;
  readonly removed: readonly ProjectScope[];
  readonly added: readonly { readonly index: number; readonly scope: ProjectScope }[];
  readonly activeProjectId: string;
  readonly presets: { readonly remove: readonly string[]; readonly upsert: readonly PresetDescriptor[] };
  readonly pendingImports: { readonly remove: readonly string[]; readonly upsert: readonly ImportDescriptor[] };
}
export interface WorkspaceProjectMaterialization {
  readonly scope: ProjectScope;
  readonly authority: AuthorityStamp;
  readonly records: NormalizedProject;
}
export interface WorkspaceCommandResult {
  readonly type: 'workspace-committed';
  readonly outcome: 'created' | 'activated' | 'closed' | 'preset-saved' | 'preset-deleted'
    | 'staged' | 'replaced' | 'consumed' | 'already-staged' | 'already-consumed';
  readonly receipt: WorkspaceReceipt;
  readonly delta: WorkspaceCatalogDelta;
  readonly projects: readonly WorkspaceProjectMaterialization[];
  readonly presets: readonly WorkspaceCustomPreset[];
  readonly pendingImports: readonly WorkspacePendingImport[];
}
export interface WorkspaceInspectedResult extends Omit<WorkspaceCommandResult, 'type' | 'delta'> {
  readonly type: 'workspace-inspected-current';
  readonly catalog: WorkspaceCatalog;
}
declare const workspaceAdmissionBrand: unique symbol;
declare const workspaceFenceBrand: unique symbol;
export interface WorkspaceRepositoryAdmission { readonly [workspaceAdmissionBrand]: true }
export interface WorkspaceRepositoryFence { readonly [workspaceFenceBrand]: true }
export interface WorkspaceAdmission {
  readonly token: WorkspaceRepositoryAdmission;
  readonly catalog: WorkspaceCatalog;
  readonly projectAuthorities: readonly { readonly scope: ProjectScope; readonly authority: AuthorityStamp }[];
}
export type WorkspaceInspection =
  | { readonly type: 'committed'; readonly result: WorkspaceInspectedResult }
  | { readonly type: 'not-committed' }
  | { readonly type: 'conflict'; readonly reason: 'authority-changed' | 'identity-mismatch'
      | 'proof-unavailable' | 'verification-failed' | 'incarnation-changed' }
  | { readonly type: 'unknown' };
export interface WorkspaceRepositoryMethods {
  admitWorkspace(): Promise<WorkspaceAdmission>;
  commitWorkspace(admission: WorkspaceRepositoryAdmission, batch: WorkspaceBatch): Promise<WorkspaceCommandResult>;
  fenceWorkspace(admission: WorkspaceRepositoryAdmission): Promise<WorkspaceRepositoryFence>;
  inspectWorkspaceAttempt(batch: WorkspaceBatch, fence?: WorkspaceRepositoryFence): Promise<WorkspaceInspection>;
}
```

Extend `NormalizedRepository` with these four methods; do not widen ordinary commit methods. Admission performs one existing full active-validation/seal boundary and returns metadata/project stamps, not editing authority synthesized from headers. Collect those stamps during that same sealed active capture; never combine metadata from different observations. Existing `readActiveSnapshot` result shape/behavior remains unchanged.

`WorkspaceBatch.targets` rules are exact: activate has one `member` target, close has one `lineage` target; other B intents have no existing-project targets. Every scope uses the batch generation and the captured member incarnation. There are no optional caller digests, arbitrary addresses, clocks, revisions or writer flags inside `intent`.

Created project material contains the independently read normalized records, including private birth/lineage fields, as one explicit bulk result—not a second duplicate public-state graph and not a project worker admission. Pass those actual records to the existing explicit project bootstrap before ordinary editing; a fresh `decomposeProject(publicProject, scope)` lacks durable birth/proof fields and is not a substitute. Assemble the new editor's initial wrapper cooperatively with existing `reconstructProjectWork` at this explicit ingress point, then drop transient record material after bootstrap. Do not sneak bootstrap/readback into a later ordinary save or grant a queue token from an unverified result. Activate, close-with-survivors and preset/import staging results contain no unchanged project payload.

## Compatibility and Store Matrix

Every command writes the current manifest/receipt for a new accepted attempt. The table lists additional writes. Read exact metadata plus only affected ancillary/project records; never reconstruct all unchanged projects for activate/preset acknowledgements.

| Intent | Extra writes and exact compatibility |
| --- | --- |
| Create/activate | New target's seven project stores; public ID supplied, incarnation derived from generation/next revision/member ordinal0; reject occupied ID, append and activate. Validate with reject-warnings policy. |
| Activate | No project writes. Require captured incarnation/current membership; change active ID even if already selected only through a new receipt/revision. |
| Close | Delete exact retiring header and its incarnation's records. Capture complete key membership/prefix EOF; never `clear()` a store. Select `remainingOrder[Math.max(0, oldIndex - 1)]`, including when closed project was inactive. |
| Close last | Require a distinct-ID, unoccupied, validated successor. Add successor and delete old member atomically; never publish empty membership. Validate a supplied successor even when unused, matching current preparation behavior. |
| Save preset | Upsert `presets`; retain existing position, append new at max+1. Validate uniqueness excluding same ID and reject warnings. |
| Delete preset | Reject missing ID; delete selected row, decrement later positions and update their descriptor digests atomically. No document writes. |
| Stage import | Validate/load with retained warnings. Compare canonical prepared-pending digest plus exact provenance, not the raw input payload hash alone. Preserve matching already-staged/already-consumed outcomes; reject collisions/ambiguous evidence. |
| Replace staged | Same source-key digest, changed payload digest, new import and target IDs. Verify old expected provenance and recomputed pending digest; retain position for existing old row. Preserve historical absent-old append behavior only after old-target reuse/consumption checks. Preserve already-staged/already-consumed outcomes; do not replace a colliding project. |
| Consume import | Add new project records/member/birth and immutable consumed provenance; remove pending, compact later positions, append/activate. A repeat must independently identify one current consumed target; it does not reactivate that target. |

Public IDs, long IDs, unknown wrapper/state/cloud/variant fields, property order, scripts, generator provenance and raw fold cells retain existing validation/codec behavior. Preset/import positions may have historically valid gaps; preserve upsert positions and existing compaction semantics rather than globally renumbering every command.

For stage/replace idempotency, canonical prepared-pending identity and stored `attemptProvenance.pendingImportDigest` remain distinct from caller `payloadDigest`. Validate any supplied provenance fields before storage access. Missing pending import without independent consumed provenance is an error, never manufactured success.

## Task 1: Real Fixture, Contracts and Admission Boundary

**Files:** new command types/helper/test; repository admission extension; exact boundary grants. **Deliverable:** authenticated workspace admission and first failing real lifecycle test, without a synthetic success writer.

- [x] **Step 1: Freeze baseline and add a real command fixture.** Reuse `createNormalizationHarness`/`makeIncrementalProject`/`LEGACY_KEYS`; normalizer is the only fixture bootstrap writer. Put this fixture in `tests/helpers/workspaceCommandHarness.ts` after adding the shared types:

```typescript
import { expect } from 'vitest';
import { createNormalizationHarness } from './normalizationHarness';
import { makeIncrementalProject } from './incrementalFixtures';
import { LEGACY_KEYS } from './localWorkspaceFixtures';
import { applyWorkspaceCatalogDeltaWork } from '../../services/localWorkspace/workspaceCatalog';
import { createWorkRuntime } from '../../shared/cooperativeWork.js';
import type { DocumentSaveAck, PreferenceSaveAck, ProjectScope } from '../../services/localWorkspace/normalized/schema';
import type { WorkspaceBatch, WorkspaceLifecycleIntent, WorkspaceTarget } from '../../services/localWorkspace/normalized/workspaceCommands';

export async function createWorkspaceCommandHarness() {
  const a = makeIncrementalProject(2), b = { ...makeIncrementalProject(2), id: 'second' };
  const h = await createNormalizationHarness({ legacyValues: {
    [LEGACY_KEYS.projects]: JSON.stringify([a, b]), [LEGACY_KEYS.activeProject]: a.id,
  } });
  expect((await h.run()).status).toBe('active');
  const admission = await h.repository.admitWorkspace();
  let catalog = admission.catalog, sequence = 0;
  const authorities = new Map(admission.projectAuthorities.map(row => [row.scope.projectId, row]));
  const request = (intent: WorkspaceLifecycleIntent): WorkspaceBatch => {
    const targets: WorkspaceTarget[] = [];
    if (intent.type === 'activate-project' || intent.type === 'close-project') {
      const scope = catalog.members.find(row => row.projectId === intent.projectId);
      if (!scope) throw new Error('Fixture target missing');
      targets.push(intent.type === 'activate-project' ? { type: 'member', scope }
        : { type: 'lineage', scope, authority: authorities.get(scope.projectId)!.authority });
    }
    const commandSequence = ++sequence;
    return { storageGeneration: catalog.storageGeneration, expected: catalog.stamp, targets,
      identity: { clientId: 'workspace-test', commandSequence, commandId: `workspace-${commandSequence}` }, intent };
  };
  const commit = async (intent: WorkspaceLifecycleIntent) => {
    const result = await h.repository.commitWorkspace(admission.token, request(intent));
    const work = createWorkRuntime({ assertCurrent() {} });
    try { catalog = await work.run(applyWorkspaceCatalogDeltaWork(catalog, result.delta)); }
    finally { work.dispose(); }
    for (const removed of result.delta.removed) authorities.delete(removed.projectId);
    for (const added of result.projects) authorities.set(added.scope.projectId, { scope: added.scope, authority: added.authority });
    return result;
  };
  const noteAck = (scope: ProjectScope, ack: DocumentSaveAck | PreferenceSaveAck) => {
    const previous = authorities.get(scope.projectId)!;
    expect(previous.scope).toEqual(scope);
    expect([ack.projectId, ack.incarnation]).toEqual([scope.projectId, scope.incarnation]);
    authorities.set(scope.projectId, { scope, authority: { ...previous.authority,
      ...(ack.type === 'document-saved' ? { documentRevision: ack.revision } : { preferenceRevision: ack.preferenceRevision }),
      foldStructureGeneration: ack.foldStructureGeneration } });
  };
  return { ...h, a, b, admission, request, commit, noteAck, catalog: () => catalog };
}
```

The helper intentionally does not refresh target expectations from arbitrary physical reads. Tests needing stale-close protection leave its captured authority untouched while another repository edits. Helpers for current local writes may forward their verified acknowledgements, not invent newer revisions.

- [ ] **Step 2: Add admission/activation tests through actual repository interface.** Admission/catalog coverage and the first activation RED are present; remaining command-framing/forgery cases are completed with Tasks2–3. First REDs are absent methods/modules, not altered migration fixtures. Test forged capability rejection before a payload getter, wrong generation, malformed/unrecognized intent, unsafe counters, long public IDs, nonempty workspace and same-capture project stamps. The first real transition case is:

```typescript
it('activates current membership without rewriting project payload or retained source', async () => {
  const h = await createWorkspaceCommandHarness();
  try {
    const retained = (await h.repository.readRetainedSource()).snapshot;
    const before = await physicalRows(h);
    const result = await h.commit({ type: 'activate-project', projectId: h.b.id });
    expect(result.outcome).toBe('activated');
    expect(result.projects).toEqual([]);
    expect(await physicalRows(h)).toEqual(before);
    expect((await h.repository.readActiveSnapshot())!.snapshot.activeProjectId).toBe(h.b.id);
    expect((await h.repository.readRetainedSource()).snapshot).toEqual(retained);
  } finally { h.adapter.close(); }
});
```

Imports for this test: Vitest `it/expect`, `physicalRows` from the existing normalization harness and the new helper. `physicalRows(h)` covers normalized stores, not the workspace manifest; the manifest revision/receipt must change separately. The activation test remains RED until Task3, not greened with a fake commit implementation.

- [x] **Step 3: Implement strict contracts/admission and catalog projection.** Register repository admission tokens only after existing full active admission/seal succeeds. Store immutable generation/activation facts and current admitted manifest metadata in the private token record. Capture project scope/authority pairs during the same full active-read operation before release. No `readActiveSnapshot` call in each command. Define `WorkspaceCatalog` as metadata only; catalog projection borrows no project payload and does not install project queue authority.

`workspaceCatalog.ts` exports `projectWorkspaceCatalogWork(manifest): Work<WorkspaceCatalog>`, `diffWorkspaceCatalogWork(before, after): Work<WorkspaceCatalogDelta>` and `applyWorkspaceCatalogDeltaWork(current, delta): Work<WorkspaceCatalog>`. All membership/descriptor traversal, comparison and candidate allocation uses charged Work, because metadata cardinality/public IDs are not bounded. Diff compares metadata only at an explicit workspace publication seam; unchanged descriptors/scopes do not become upserts. Delta application requires exact generation/before-stamp, revision+1, valid unique insert/remove targets, valid active membership and sorted unique descriptor positions. Preserve unchanged scope/descriptor references; reject a stale delta instead of rebasing it. No payload getter, whole-document copy or `WorkspaceSnapshot` cast.

Prepare the candidate catalog cooperatively against a captured immutable current-catalog identity. Before synchronous pointer publication recheck store/source/epoch and that exact identity; cancellation or a competing publication discards the candidate and releases its temporary ownership. Work guards run across every yield; no unbounded synchronous diff/apply is hidden behind the final pointer assignment. Ordinary project acknowledgement updates remain O(1) in the separate known-authority map, not catalog rebuilds.

- [x] **Step 4: Verify admission/pure catalog tests and boundary grants.** Run:

```bash
npx vitest run tests/unit/localWorkspace/normalized/workspaceCommands.test.ts tests/unit/localWorkspace/workspaceCatalog.test.ts tests/unit/localWorkspace/normalized/workspaceManifest.test.ts tests/unit/localWorkspace/normalized/workspaceCommitProof.test.ts --maxWorkers=1 --testNamePattern="^(?!.*activates current membership without rewriting).*$"
```

Select admission/catalog cases while the intentionally absent commit case remains RED. Record exactly which cases were selected; do not claim lifecycle support at this checkpoint.

Task1 checkpoint:26intended REDs (22catalog/4admission) observed, then65selected catalog/admission/manifest/proof testsPASS. The real activation case separately remains intendedRED until Task3; no fake successful writer. Two new exact capability cases added; seven selected boundary casesPASS, full boundary inventory947. Typecheck reports only the established Sticker PressTS2339. Command framing/forged-token cases are tested with the actual command/preparation implementation in Tasks2–3, not satisfied by admission metadata alone. New source-scoped catalog/projection code and same-capture admission are private; no production entrypoint change.

## Task 2: Cooperative Command Preparation and Durable Postconditions

**Files:** `normalized/workspaceCommands.ts`, its tests; consume existing codec/validation/birth/proof modules. **Deliverable:** detached immutable input → exact affected mutation/manifest/receipt, with no storage writer in this module.

- [ ] **Step 1: Test preparation before implementing it.** Matrix includes all eight intents, validation-before-storage, input mutation after suspension, getters/then hazards, warnings, external depth/size boundaries, long IDs, counter overflow, duplicate IDs, wrong target scope and malformed optional fields. Tests assert inputs unchanged, exact prepared rows and released ownership on each cancellation point. Run sync/async validation parity against existing helpers; do not create a miniature alternate validator.

- [ ] **Step 2: Implement the preparation interfaces below.** `CapturedWorkspaceCommand` is repository-owned input, not caller authority. `PreparedWorkspaceMutation` stays within one serialized operation; readback does not trust it instead of rereading storage.

```typescript
import type { WorkRuntime } from '../../../shared/cooperativeWork.js';
import type { NormalizedWorkspaceManifest } from './workspaceManifest';
import type { NormalizedProject, ProjectHeader, ProjectScope } from './schema';
import type { StoredPreset, StoredPendingImport } from '../schema';

export interface CapturedWorkspaceCommand {
  readonly manifest: NormalizedWorkspaceManifest;
  readonly initial: WorkspaceStamp;
  readonly memberHeaders: readonly ProjectHeader[];
  readonly projects: readonly NormalizedProject[];
  readonly presets: readonly StoredPreset[];
  readonly pendingImports: readonly StoredPendingImport[];
}
export interface PreparedWorkspaceMutation {
  readonly batch: WorkspaceBatch;
  readonly requestDigest: string;
  readonly manifest: NormalizedWorkspaceManifest;
  readonly outcome: WorkspaceCommandResult['outcome'];
  readonly addProjects: readonly NormalizedProject[];
  readonly removeProjects: readonly ProjectScope[];
  readonly putPresets: readonly StoredPreset[];
  readonly deletePresetIds: readonly string[];
  readonly putImports: readonly StoredPendingImport[];
  readonly deleteImportIds: readonly string[];
  readonly delta: WorkspaceCatalogDelta;
  release(): void;
}
export interface WorkspacePreparation {
  capture(batch: unknown, work: WorkRuntime): Promise<{ batch: WorkspaceBatch; release(): void }>;
  prepare(captured: CapturedWorkspaceCommand, batch: WorkspaceBatch, now: string,
    work: WorkRuntime): Promise<PreparedWorkspaceMutation>;
  verifyPostconditions(batch: WorkspaceBatch, current: CapturedWorkspaceCommand,
    receipt: WorkspaceReceipt, work: WorkRuntime): Promise<WorkspaceInspectedResult>;
}
```

Use module exports `captureWorkspaceBatch`, `prepareWorkspaceMutation` and `verifyWorkspacePostconditions` implementing those signatures. Only repository code supplies current captures. `memberHeaders` supports metadata-only activation. `projects` contains complete affected-incarnation captures only for close/create/readback; an empty map image is usable solely as independently sealed absence evidence, not a valid editable project. Activation must not populate/reconstruct a full target image. Admission/framing is checked before touching bulk payload. Detach the request with a permitted native clone as the first charged operation of a fresh command runtime before suspension; register capture ownership in that operation, then measure/validate the detached graph cooperatively. Do not borrow mutable caller input across a yield, or return raw clone values through `synchronousResult`.

- [ ] **Step 3: Implement each transition using the compatibility matrix.** Preparation algorithm, in order:

1. Validate generation/identity/expected stamp/targets and the current manifest/receipt chain; reject overflow before allocating a new incarnation. Match exact expected manifest revision/core and target incarnation. Preparation performs no implicit retry/rebase.
2. Validate detached ingress using `validateWorkspaceProjectWork`, `validateCustomPresetWork` or `preparePendingImportWork` with the established warning policies. Reject unsupported snapshot/recovery/replacement intents before payload access. Preserve unknown admitted fields/raw folds/order.
3. Compute request identity over versioned canonical metadata plus explicit payload frames/digests. Use `doctect-workspace-request-v1`; include generation, command identity, expected stamp, targets, complete intent and every supplied payload. Preserve observable payload field order and external-depth resets in payload framing; do not frame a32MiB AppState beneath extra depth-counted wrappers. Keep canonical prepared-pending digest/provenance comparison separate from command-request identity.
4. For each actual new member use `deriveWorkspaceIncarnation(generation, nextRevision, 0, work)`, cooperative project decomposition, zero initial document/preferences/fold revisions and a `WorkspaceBirthOrigin` in its header. Then call `createProjectBirthDigests` and install the matching manifest member. Do not install `migrationBaseline` on a workspace birth.
5. Apply only affected membership/ancillary changes. Recompute changed preset/import envelope digests with the existing `workspace-preset-v1` / `workspace-import-v1` domains. Preserve consumed provenance in the member and future stored-project reconstruction.
6. Compute next core using `workspaceManifestCoreFrame`. Compute `postconditionDigest` using `doctect-workspace-postconditions-v1`; its projection names the intent/outcome, exact after-stamp, affected scopes/absence predicates, current applicable ancillary descriptors and initial authorities/digests of created members. Exclude the before/after catalog diff: that diff cannot be reconstructed from an evicted old catalog. Store only the digest in the bounded receipt, not an unbounded address list.
7. Build `WorkspaceReceipt`, hash `workspaceReceiptFrame`, call `appendWorkspaceReceipt`, validate final manifest and return the owned mutation. A distinct already-satisfied attempt still advances revision/receipt once without rewriting project/pending payloads. All allocations/traversals/hashes stay charged; release borrowed/captured/prepared ownership separately on success and failure.

Inspection must reconstruct postconditions from the frozen batch and independently read current state, not a retained preparation cache. The projection uses created members whose birth identity/revision matches this batch, absence of a retired incarnation/pending/preset ID, and current applicable ancillary rows/descriptors. For delete/compaction, include all current descriptors/validated rows of that ancillary kind so no unknown old position is needed. Create/activate/close/preset have one possible outcome tag. Stage/replace have at most the three stated tags; consume has two. Try only those finite valid postcondition tags against the stored digest and require exactly one match. This recovers an already-staged versus newly-staged outcome without adding a durable outcome field or guessing from current presence alone.

Return `WorkspaceInspectedResult` with verified current catalog metadata, not a fabricated original delta. The main owner retains its before-catalog metadata with the one unresolved attempt and derives a guarded diff using `diffWorkspaceCatalogWork`; no historical workspace is reconstructed from durable receipts. Direct commit compares independent postconditions/outcome against preparation before returning its delta. Created targets must still have the committed initial authority before their old bulk material can be published; legitimate later target edits produce superseded/conflict. Already-consumed outcomes do not return old project material.

- [ ] **Step 4: Verify preparation/birth compatibility.** Run command preparation, catalog, codec, birth and proof suites with one worker. Assert no IndexedDB capability in the new pure module. Keep original tests intact and record any newly exposed compatibility mismatch before transaction work.

## Task 3: Atomic Repository Commands, Independent Readback and Inspection

**Files:** `normalized/repository.ts`, `workspaceTransactions.test.ts`, real fixture; command module only for pure helpers. **Deliverable:** all eight intents commit through one writer and independently verify their durable result.

- [ ] **Step 1: Add real success-path and rollback tests.** Use `createWorkspaceCommandHarness`; never `seedCurrentLayout`, `refreshAncillaryManifestFixture`, `clear()` or prewritten receipts to make a successful command pass. Keep those older helpers only for explicit corruption fixtures. Core sequence:

```typescript
it('creates, closes and recreates one public ID without reviving old incarnation', async () => {
  const h = await createWorkspaceCommandHarness();
  try {
    const retained = (await h.repository.readRetainedSource()).snapshot;
    const project = { ...makeIncrementalProject(2), id: 'created' };
    const first = await h.commit({ type: 'create-and-activate-project', project });
    const oldScope = first.projects[0].scope;
    const admitted = await h.repository.bindAdmittedProject(first.projects[0].records);
    const writable = await h.repository.commitDocument({ scope: oldScope, clientId: 'old', commitGeneration: 1,
      commitId: 'before-close', editorGeneration: 1, expectedRevision: admitted.documentRevision,
      changes: [{ type: 'put-node', node: { ...project.initialState.nodes.root, title: 'Saved before close' } }] });
    h.noteAck(oldScope, writable);
    await h.commit({ type: 'close-project', projectId: project.id });
    const second = await h.commit({ type: 'create-and-activate-project', project });
    expect(second.projects[0].scope.incarnation).not.toBe(oldScope.incarnation);
    expect((await h.repository.readActiveSnapshot())!.snapshot.projects.map(row => row.id))
      .toEqual([h.a.id, h.b.id, project.id]);
    expect((await h.repository.readRetainedSource()).snapshot).toEqual(retained);
    await expect(h.repository.commitDocument({ scope: oldScope, clientId: 'old', commitGeneration: 2,
      commitId: 'old-write', editorGeneration: 2, expectedRevision: writable.revision,
      changes: [{ type: 'put-node', node: { ...project.initialState.nodes.root, title: 'stale' } }] })).rejects.toThrow();
  } finally { h.adapter.close(); }
});
```

Additional mandatory cases: last-close successor atomicity; stale close after another repository document/preference/fold write; close/ordinary-save races in both commit orders; create→both ordinary lanes via explicit project bootstrap→fresh reopen; source scripts/extensions/raw folds retained; preset order/upsert/delete; full historical stage/replace/consume matrix; already-consumed without reactivation; no unchanged-project payload readback for activate/preset.

- [ ] **Step 2: Implement bounded captures and the transaction sequence inside the repository.** One workspace serial tail per generation coordinates repository workspace operations; the coordinator's existing global FIFO still orders same-worker ordinary requests. Cross-owner safety comes from the actual transaction CAS, not this in-memory tail.

For a token admitted by Task1, read current workspace/active marker metadata and only required target/ancillary rows. Validate current manifest against admitted activation facts/initial core, and independently verify any receipt chain changes. A stale expected stamp fails; do not silently reinstall authority from arbitrary surviving headers. Close capture enumerates the exact target incarnation range and EOF; compaction captures every affected ancillary row and its physical key. Reject key/envelope mismatch and duplicate rows. Keep the existing page/ownership/seal discipline; factor only private capture mechanics genuinely reused, not a new database-owning adapter.

Within one readwrite transaction: recheck lifecycle, active generation, exact captured marker/manifest, all expected target lineages, affected ancillary rows, absence/collision conditions and captured key membership/EOF. Creation additionally captures/seals absence of the proposed new header and complete incarnation prefix, including orphan rows; use `add` for initial project insertion, never overwrite an unrecognized row. Queue only the prepared manifest/evidence plus affected puts/deletes. Hashing/preparation already happened outside; use existing allowed synchronous exact-record equality for transaction seals. Any callback/fault/request error aborts the entire mutation.

Add these workspace-specific observation/fault types in the repository rather than weakening ordinary selected-record observation:

```typescript
export type WorkspaceStoreName = ProjectStoreName | 'workspace' | 'presets' | 'pendingImports' | 'normalizationLedger';
export interface WorkspaceRepositoryOperation {
  readonly phase: 'prepare-read' | 'cas-read' | 'write' | 'verify-read' | 'inspect-read';
  readonly transactionId: number;
  readonly connectionId: number;
  readonly store: WorkspaceStoreName;
  readonly method: 'get' | 'openCursor' | 'add' | 'put' | 'delete';
  readonly key?: IDBValidKey;
}
export interface WorkspaceRepositoryFault {
  readonly phase: 'before-cas' | 'after-cas' | 'before-put' | 'after-put' | 'before-delete'
    | 'after-delete' | 'before-complete' | 'after-commit' | 'before-readback' | 'after-readback';
  readonly ordinal?: number;
  readonly store?: WorkspaceStoreName;
  readonly key?: IDBValidKey;
}
export interface WorkspaceRepositoryTestSeams {
  workspaceFault?(point: WorkspaceRepositoryFault): void;
  onWorkspaceOperation?(operation: WorkspaceRepositoryOperation): void;
  workspaceReadResult?(operation: WorkspaceRepositoryOperation, value: unknown): unknown;
}
```

Extend `NormalizedEnvironment` with these optional test seams. Count `add` in the same put fault ordinal sequence. Fault hooks are deliberate test-only interruption points; read-result hooks are test-only corruption, not alternate writers. Buffer passive operation observations when a test observer is present, then deliver outside transaction completion/abort with thrown observer errors isolated; allocate no such log when absent. Fault points cover every actual put/delete ordinal as well as before/after CAS and independent readback. A throwing postcommit hook is not rollback evidence.

After commit invalidate retired target owners even if readback/ack later fails. Read committed manifest and affected rows in a fresh consistent capture, verify core/receipt/request/postconditions and exact seals, then return metadata delta and only explicitly created/changed bulk material. Ordinary project bootstrap remains explicit; do not materialize surviving documents. No historical source/ledger/archive write is permitted.

- [ ] **Step 3: Implement workspace fencing and inspection without absence guesses.** `fenceWorkspace(token)` synchronously disables future commits using that token, then waits behind all already-started workspace work before minting a same-realm fence object. A new token or a caller boolean is not evidence that an old token was fenced. Retain bounded attempt metadata only; no forever-growing command log or authority cache.

Before suspension reserve the authentic admission, framed attempt identity and detached input; do not claim a complete bulk request digest already exists. Include queued/preparing work in the fenced serial lifetime, compute the digest cooperatively, then attach it to that same reservation before any transaction can begin. Fence waits for incomplete reservations and prevents them writing later; test fence-during-hashing and cancellation before digest attachment. Fence evidence must belong to that same admission/attempt, not a newly admitted or unrelated fenced owner. Do not evict active reservations; bound settled inspection metadata and return unknown when required ownership evidence is unavailable. `inspectWorkspaceAttempt(batch, fence?)` recomputes request identity from the detached original batch, independently reads current manifest/affected postconditions and returns:

| Outcome | Required evidence |
| --- | --- |
| committed | Matching identity/request digest and receipt, exact current after-stamp, independently verified affected postconditions; publish once. |
| not-committed | Authentic matching repository fence, exact unchanged before-stamp and absent attempt; main-thread authentic not-posted evidence is handled separately, never a wire boolean. |
| conflict | Changed generation/incarnation, advanced workspace/target authority, mismatched digest, evicted receipt or unverifiable postconditions. |
| unknown | Unavailable storage or absent old-owner fence when absence would otherwise be the only evidence. |

Receipt retained but workspace advanced is not permission to return its old catalog. No replay after eviction, no recomputed historical workspace, no implicit newer-before rebasing. Restart can prove a current committed receipt or conflict; it cannot manufacture a fence for a dead unknown owner. A same-attempt repeated commit with still-current independently verified evidence returns its prior result without a new revision; ambiguous cases inspect rather than apply again.

- [x] **Step 4: Run full repository/fault matrix.** For each actual put/delete ordinal inject clone/quota/abort faults and compare independent physical rows before/after. Repeat lost acknowledgement at transaction completion and after commit, readback corruption, concurrent workspace commands, and receipt count/byte eviction. Assert exactly one live incarnation and no historical writes. Run:

```bash
npx vitest run tests/unit/localWorkspace/normalized/workspaceCommands.test.ts tests/unit/localWorkspace/normalized/workspaceTransactions.test.ts tests/unit/localWorkspace/normalized/workspaceAuthority.test.ts tests/unit/localWorkspace/normalized/repository.test.ts --maxWorkers=1
```

No lifecycle support-complete claim until every intent and inspection branch has real transaction coverage. Existing migration timing failures are reported separately, not accepted or hidden.

Validation checkpoint: new `workspaceEvidence.test.ts` contributes259cases:7real worker receipt/fence-eviction cases,216write-ordinal rollback cases covering all eight intent families plus last-close succession with DataCloneError/QuotaExceededError/AbortError, and36postcommit/readback failure cases. Successful fixture history is produced only by actual normalization and commands. Each history transition has its own bounded setup hook under the unchanged10000ms hook default; no ready-made normalized success rows or deadline changes. A separate byte-pressure proof test uses valid255-byte escaped private IDs to force eviction below32entries. Combined evidence/proof/original transaction/worker suites:422PASS. Application writer/runtime unchanged.

## Task 4: Workspace Worker Family and Correlated Fence/Inspection

**Files:** protocol/client/coordinator and existing worker tests. **Deliverable:** same real worker owner serializes project and workspace work, with no structural-tag overloading or automatic replay.

- [x] **Step 1: Add protocol-negative and real worker integration tests.** Reject malformed admission IDs, generation/stamps/targets/identity, mismatched replies, unknown/accessor fields and unsupported intent before payload/storage access. Test workspace/project FIFO in both directions and stale workspace admission after rebootstrap. Existing occurrence-edit and project-ACK tests must keep passing.

- [x] **Step 2: Add the request/response variants.** Keep protocolVersion1 and current project fields unchanged; no version change or reuse of `structural-command` is authorized.

```typescript
export type WorkspaceLifecycleWorkerRequest =
  | { readonly type: 'workspace-bootstrap'; readonly storageGeneration: string }
  | { readonly type: 'workspace-command'; readonly admissionId: number; readonly batch: WorkspaceBatch }
  | { readonly type: 'workspace-fence'; readonly storageGeneration: string; readonly admissionId: number }
  | { readonly type: 'inspect-workspace-command'; readonly admissionId: number; readonly batch: WorkspaceBatch };
export type WorkspaceLifecycleWorkerResponse =
  | { readonly type: 'workspace-bootstrapped'; readonly admissionId: number; readonly catalog: WorkspaceCatalog;
      readonly projectAuthorities: WorkspaceAdmission['projectAuthorities'] }
  | { readonly type: 'workspace-command-result'; readonly admissionId: number; readonly result: WorkspaceCommandResult }
  | { readonly type: 'workspace-fenced'; readonly storageGeneration: string; readonly admissionId: number }
  | { readonly type: 'workspace-inspection'; readonly identity: WorkspaceCommandIdentity; readonly result: WorkspaceInspection };
export type WorkspaceLifecycleWorkerContext =
  | { readonly requestType: 'workspace-bootstrap'; readonly storageGeneration: string }
  | { readonly requestType: 'workspace-fence'; readonly storageGeneration: string; readonly admissionId: number }
  | { readonly requestType: 'workspace-command' | 'inspect-workspace-command'; readonly storageGeneration: string;
      readonly admissionId: number; readonly identity: WorkspaceCommandIdentity; readonly expected: WorkspaceStamp };
```

Existing envelope worker epoch/request ID remains mandatory and uses positive safe integers. Workspace bootstrap admission ID equals its numeric request ID, matching the existing protocol. Extend the context union with the exact variants above. The wire carries no `WorkspaceRepositoryAdmission` or `WorkspaceRepositoryFence` object. Coordinator maps its installed wire admission to repository capability and retains authentic attempt-bound fence evidence internally. On restart an old admission ID may locate no fence; inspection can still establish a current committed receipt/conflict, but absence stays unknown.

- [x] **Step 3: Extend the same coordinator FIFO and client validation.** Workspace bootstrap calls real full admission, registers the capability and returns only catalog/stamps. Commit resolves installed workspace admission at execution time and calls the sole repository writer. Fence blocks later writes from that admission and waits for already-started work before acknowledging; inspection runs on that same FIFO. Disposal rejects pending work and never claims a fence if it did not complete. Terminal client failures still terminate/reject without restart/replay;30-second timeout remains unchanged.

Correlate generation, admission, request/epoch, command identity and before/after stamp for successful responses. A stale reply cannot publish even if its transaction committed. Unknown-outcome errors retain the original immutable batch; malformed/unavailable inspection remains unknown, never not-committed. Repository token invalidation must not silently refresh foreign stale commands.

- [x] **Step 4: Verify real-port loss/restart behavior.** Existing inline worker harness must structured-clone both directions. Cover not-posted, posted timeout, commit-before-lost-ack, old-owner-fenced absence, restart without fence, later workspace command, later created-target edit and receipt eviction. Check that a later project save cannot overtake a queued workspace operation, and vice versa. Run existing `workspaceWorker.test.ts` and new workspace transaction tests together, not only mocked reply tests.

Worker validation checkpoint: count and exact serialized-byte eviction now run through the real workspace worker family. Evicted attempts return proof-unavailable without replay; current head remains inspectable; durable birth survives eviction and admits both ordinary lanes. A separate33-owner history proves an authentic old fence is lost after coordinator capability eviction and cannot be manufactured again. These extend, rather than substitute for, ordinary-project receipt tests.

## Task 5: Retaining Queue Cuts and Immediate Editor Retirement

**Files:** queue, incremental admission, document contracts/hook, optional private `ProjectEditor` drain registration, queue/editor tests. **Deliverable:** workspace operations cannot drop survivor edits or close a project after an accepted unguarded editor mutation.

- [x] **Step 1: Write controlled scheduling tests.** Hold the first project write acknowledgement, submit workspace barrier, then submit newer survivor edits. Assert the barrier waits only for the captured cut, executes before those newer edits, and releases them afterwards. Add two queued workspace barriers with edits before/between/after them; verify exact order and no coalescing across either cut. Add failure/unknown paths retaining survivor edits and immediate target retirement before any history change.

- [x] **Step 2: Add the workspace barrier contract without changing the old compatibility barrier.** Import `AuthorityStamp`/`ProjectScope` from normalized schema. Extend `IncrementalQueue` and the private incremental-admission return value with:

```typescript
export interface WorkspaceQueueCut {
  readonly targets: readonly { readonly authority: InstalledQueueAuthority; readonly stamp: AuthorityStamp }[];
}
export interface WorkspaceQueueBarrier<T> {
  readonly targets: readonly InstalledQueueAuthority[];
  readonly retireScopes: readonly ProjectScope[];
  run(cut: WorkspaceQueueCut): Promise<QueueBarrierOutcome<T>>;
}
export interface WorkspaceQueueMethods {
  workspaceBarrier<T>(operation: WorkspaceQueueBarrier<T>): Promise<T>;
}
```

Assign a monotonically increasing submission order to queue segments and workspace barriers. Seal all pending segments when a barrier enters the queue. Only dispatch segments at or before the earliest pending cut; newer survivor edits remain admissible, tagged and retained behind it. A second barrier captures its own cut and prevents later work from slipping ahead when the first releases. Existing `barrier` retains its original rejection behavior; overlapping old/new barrier modes must refuse rather than race.

Retire requested scopes synchronously when the workspace barrier is admitted, not after drain. Reject new target enqueues without mutating their working document. Captured targets must still match their original installation/incarnation after drain. Return conservative expected document/preference/fold stamps from verified queue coverage. Treat the existing preference lower bound as an exact CAS expectation for close; do not refresh it from an arbitrary worker read to authorize deleting unseen remote edits. Unmounted targets use the sealed workspace-admission stamp, also conservatively; a newer remote edit causes conflict.

Workspace unknown/conflict holds post-cut work unsaved and retained. Freeze includes all pending project work and active barrier in quiescence. The lifecycle admission owns the one actually posted workspace attempt separately. Queued lifecycle intents that never posted are explicitly failed as not-posted and retained for deliberate retry, not automatically replayed under a new owner; their cuts cannot silently disappear while reporting success. Restoring project work waits for the posted workspace outcome and fresh compatible admissions. Do not resurrect a retired token after a rejected promise.

- [x] **Step 3: Add the stable editor guard and persistence-cut handshake before mutation/cut.** Extend `EditorSourceBinding` with optional `assertEditable(): void`, `capturePersistenceCut?(editorGeneration: number): Promise<boolean>` and `registerPersistenceDrain?(handle: EditorPersistenceDrain): () => void`. Lifecycle drain registration requires the capture callback; `void` delivery is never evidence of successful handoff. Define the metadata-only handle in document contracts:

```typescript
export interface EditorPersistenceDrain {
  generation(): number;
  drainThrough(editorGeneration: number): Promise<boolean>;
}
```

At `createOwner`, capture/validate these optional functions once; `checkBinding` rejects changed guard/capture/registrar identities rather than requiring remount for changes inside their stable lifecycle closures. Do not add the guard to `requireAttached`, because `drainEffects` must still deliver already-produced edits after retirement. Mutating actions use a distinct guard:

```typescript
const requireEditable = () => {
  requireAttached();
  assertEditable?.();
};
```

Use it for edit/preferences/session/folds/groups/Undo/Redo/replacement before state/history/effect mutation. Recheck after the caller's `prepare` callback and immediately before mutating the reference index/public owner state, so reentrant close during preparation cannot accept a later edit. Read/export and delivery of existing effects remain available.

Extend `drainEffects(deliver, throughGeneration?)` to stop before effects above the supplied captured generation while retaining the existing default behavior. In a source-keyed incremental `ProjectEditor` layout effect, optionally register a stable drain handle which synchronously uses the same committed callback/source checks as `run`, then returns `capturePersistenceCut(throughGeneration)`. Updating the committed callback ref on a normal rerender must not unregister/replace this handle or invalidate a captured cut. Unregister only that exact handle on actual source cleanup. No alternate persistence callback path or production page change.

Add `capturePersistenceCut(projectId: string, throughEditorGeneration: number): Promise<boolean>` to `IncrementalProjectWrites`. It synchronously captures a finite set of handoff/settlement obligations, then resolves only when they succeed. Track actual local editor generations from the binding floor; retain unresolved receipts and a contiguous completed watermark, not a lifetime event/payload log. Missing/skipped generation, early `false` before enqueue, source loss, unresolved replacement/fold mapping and a failure latched at capture make the cut false. Duplicates cannot overwrite an earlier authentic receipt. This coverage tracking must not change existing update methods' return semantics or reject previously accepted ordinary writes merely because their supplied generation skipped; an unprovable lifecycle cut is refused instead.

For each document event include **both** the document submission and any paired preference obligation, even if the old `updateDocument` return promise covers only document success. A required paired preference patch suppressed by a failure is a failed obligation, not no work. Include older document/preference/metadata submissions already admitted at capture. Capture their promises/coverage, not future pending sets: later survivor typing or a later failure cannot continually delay or retroactively redefine this earlier cut. Source/lifecycle must still match when it resolves. Do not reuse `flushPendingProject`, whose latest-generation/no-new-work condition intentionally has different semantics.

Lifecycle submission captures the target/source and marks its edit guard retired synchronously. Before sealing the queue cut, drain the finite captured generations of registered editor effects while the queue still accepts these already-produced target events, retaining every returned cut-completion promise. If called during an editor action/delivery, defer cut acquisition to the end of that synchronous action rather than capture a cut before its accepted effects reach persistence. Admit the queue barrier without awaiting those promises first; its pre-cut flush drives pending submissions. Inside the barrier callback, require every captured persistence cut to resolve true and the same registrations/sources still to match **before constructing/posting the workspace batch**. Empty queue or completed delivery alone is insufficient. False cut fails close without a workspace transaction, preserves state/history/unsaved flags and retains retirement pending verified readmission. Then drain deferred newer survivor effects behind the already-captured cut. Do not allow callback reentry to overtake earlier lifecycle intents or put the retiring guard on effect delivery itself.

Mandatory regressions: reentrant close during `prepare`, document/preference delivery and between state publication/persistence dispatch; failed mapping/authority capture before enqueue with an otherwise empty queue; document ACK success plus failed/skipped paired preferences; missing handoff generation; older metadata failure; later survivor edits/failures not part of the captured cut. Every refused close proves zero workspace writes and unchanged working/history identity.

The private lifecycle admission supplies stable closures keyed by generation/project/incarnation. Every existing caller without these callbacks retains current behavior; this is not a general “invalid save means forbid optimistic edits” change. On close failure preserve owner/history and keep retirement until explicit verified readmission. Do not remount a surviving editor to update this guard. Rejected edit/Undo leaves state identity, history and emitted callbacks unchanged; unrelated project edits still work.

Task5/6 checkpoint: optional guards, bounded drains, stable component registration and finite both-lane handoff proof now compose with real lifecycle submission and verified restart. Private React tests verify reentrant prepare/delivery, zero workspace posts on failed handoff, ordered close, surviving history/unsaved work and genuine readmission without remount. No test fabricates a successful lifecycle storage write.

- [x] **Step 4: Run queue/editor regressions.** Cover observer reentry, both lanes, metadata between edits, fold dependencies, freeze during active barrier, cancellation, failed drain and failed retirement. All original debounce500/2000ms and1000/5000ms behavior remains. Run:

```bash
npx vitest run tests/unit/localWorkspace/normalized/incrementalQueue.test.ts tests/unit/localWorkspace/normalized/storeCommands.test.ts tests/unit/useIncrementalProjectWrites.test.tsx tests/unit/ProjectEditor.incrementalChanges.test.tsx --maxWorkers=1
```

These suites were run with connected editor/worker/document-model/boundary suites at the cuts checkpoint, yielding1721PASS/1inline-text timeout at unchanged5000ms. That full-run receipt and isolated diagnostics remain intact. The later normal-admission1947-case run includes the entire editor suite and passes; it does not establish a fix or cause for the earlier timing event.

## Task 6: Typed Private Lifecycle Admission and Catalog Publication

**Files:** new main-thread admission/catalog tests, contracts/dispatcher, existing private editor fixture. **Deliverable:** real lifecycle commands compose with existing private incremental persistence without touching production store selection.

- [x] **Step 1: Add public typing and refusal tests first.** Add a new explicitly tagged command, not an overload that gives the same historical discriminator a different return type:

```typescript
export interface WorkspaceLifecycleCommand {
  readonly type: 'workspace-lifecycle';
  readonly intent: WorkspaceLifecycleIntent;
}
export type WorkspaceLifecycleCommit = (command: WorkspaceLifecycleCommand) => Promise<WorkspaceCommandResult>;
```

Extend `WorkspaceCommand`, `WorkspaceCommandResult` and `WorkspaceCommit` with this correlated family, naming the imported normalized result alias distinctly to avoid a recursive type alias. Add optional `workspace?: WorkspaceLifecycleCommit` handler to `WorkspaceCommandHandlers`. Default production dispatcher remains snapshot-only and rejects this family before reading its payload. Private fixture installs incremental and workspace handlers and rejects historical snapshot/recovery/full-replacement commands; no mixed writers or snapshot-shaped acknowledgements.

- [x] **Step 2: Implement private admission state and target provenance.** `createWorkspaceCommandAdmission` owns the installed workspace binding, metadata catalog, an O(1) per-project known-authority map, queued immutable intents and any posted unresolved batch. It consumes the same queue/transport as incremental admission. Its public/private surface is:

```typescript
export interface WorkspaceCommandAdmissionOptions {
  readonly binding: Extract<WorkspaceLifecycleWorkerResponse, { type: 'workspace-bootstrapped' }>;
  readonly queue: IncrementalQueue & WorkspaceQueueMethods;
  readonly transport: QueueTransport;
  readonly installations: ProjectInstallationRegistry;
  readonly clientId: string;
  uuid(): string;
  assertCurrent(): void;
  resolveInstalled(scope: ProjectScope): InstalledQueueAuthority | undefined;
  onCatalog(result: WorkspaceCommandResult): void;
  readonly recovery?: RetainedWorkspaceWork;
}
declare const retainedWorkspaceBrand: unique symbol;
export interface RetainedWorkspaceWork { readonly [retainedWorkspaceBrand]: true }
export interface WorkspaceCommandAdmission {
  workspace(command: WorkspaceLifecycleCommand): Promise<WorkspaceCommandResult>;
  persistEditor(scope: ProjectScope, source: object, editorGeneration: number | undefined,
    submit: () => Promise<boolean>): Promise<boolean>;
  catalog(): WorkspaceCatalog;
  observeProject(event: QueueEvent): void;
  assertEditable(scope: ProjectScope): void;
  registerEditor(scope: ProjectScope, source: object, drain: EditorPersistenceDrain): () => void;
  registerWrites(scope: ProjectScope, owner: ProjectWriteOwner): () => void;
  resumeRecovery(prepareWrites: (scope: ProjectScope, writes: RetainedProjectWrites,
    queue: RetainedQueueWork) => Promise<VerifiedProjectWriteRecovery>): Promise<void>;
  blockedAttempt(): { readonly storageGeneration: string; readonly identity: WorkspaceCommandIdentity;
    readonly expected: WorkspaceStamp } | undefined;
  inspectBlocked(): Promise<WorkspaceInspection>;
  dispose(): RetainedWorkspaceWork;
}
```

Implementation seam review (2026-09-30, read-only `ses_f0aeb5d5affef47JK4RRc8vIH6`): construct with `await createWorkspaceCommandAdmission(options)`. The factory validates/captures/indexes bootstrap metadata cooperatively before exposing the owner; composition must not expose producers earlier. The plan previously left factory return timing unspecified. `persistEditor` is a private pre-hook producer gate, not another writer: outside cut acquisition/release it invokes `submit` synchronously; during acquisition it admits captured-generation effects and defers newer survivor effects plus reentrant metadata. Deferred release remains FIFO under reentry. Private composition routes document, preference and metadata producers through this gate before invoking the save hook, so deferred work cannot contaminate its captured obligations.

The registered drain additionally exposes optional metadata-only `isBusy(): boolean`, implemented by the real editor owner around synchronous mutation/delivery. This lets the lifecycle owner seal ordinary submissions immediately, while deferring a reentrant submission until its current editor action completes. It must not treat a false handoff as a busy signal or defer every ordinary command indiscriminately, which would erase ordering between same-turn commands and edits. Older/test handles without this optional method are treated as idle; real private composition always supplies it. Generations/registration references are pinned at submission, and the producer gate holds newer work until the reserved cut is sealed.

Installation-liveness correction from scoped code review: a resolver callback alone cannot supply a callback-free final check when another resolver replaces/removes an already-checked installation. Both private admissions therefore share `ProjectInstallationRegistry` as their sole installation table. Its `set`/`delete` operations synchronously revoke prior same-realm leases; `captureProjectInstallation` and `isProjectInstallationCurrent` use private WeakMaps, not caller-supplied liveness booleans. Lifecycle pins combine this registry lease with immutable source/binding/authority facts. All installation replacement/removal in private composition must pass through this table; no parallel raw Map may act as installation authority. Conditional deletion can require the exact expected installation so stale cleanup cannot remove its successor. The registry has no payload, worker or storage capability, and its production import edge remains closed.

Add `holdWorkspaceRecovery(): () => void` to the existing private queue surface. Its authentic idempotent release closure removes only its own hold, never revives a stopped owner, and does not flush recovered work automatically. Acquire synchronously before recovery awaits; block enqueue/flush/pump/both barrier entrypoints and recovered-ACK activation until workspace inspection and exact fresh document/preference/fold authorities agree. Existing project-only recovery semantics remain unchanged without this hold. A higher fresh preference revision or merely equal incarnation is not proof. Failed/unknown recovery initialization keeps the hold closed. These are narrow composition seams required by the approved handoff/recovery rules, not production cutover or new durable formats.

#### Verified write-owner readmission — core and private lifecycle integration implemented

Read-only follow-up `ses_f0aeb5d5affef47JK4RRc8vIH6` confirmed that a recovery queue hold alone is insufficient. The save hook has separate local/write clocks and structural mapping; its original failed promises/cuts stay false and its failure latch cannot be cleared from a queue high-water mark. Queue restoration has no original hook waiters, and a pre-enqueue failure may have no represented queue segment. Replacing the hook with one generation floor cannot reconstruct these facts. The private protocol below is now implemented at queue/hook, project-only editor and workspace-restart boundaries. Recovery construction returns a paused owner only after independent outcome/authority checks; explicit `resumeRecovery` installs genuine hook attachments before replay and activates editing only after settlement. Current-owner outcome inspection alone still does not resume saving.

Required narrow extension: authenticated in-place `IncrementalProjectWrites.readmit(recovery: VerifiedProjectWriteRecovery): Promise<boolean>`. The opaque runtime-branded recovery session is bound to the exact write owner/source, genuine retained queue checkpoint and independently admitted fresh installation. Its creator belongs to private composition, never a public caller-shaped boolean or header-shaped object.

1. Retain outstanding logical obligations until durable resolution: local generation, allocated write generation, required/settled lanes and actual queue-admission provenance. Metadata has its own write obligation. Compact successful entries rather than keeping a lifetime event/payload log. Queue-owned payloads stay queue-owned.
2. Add private per-submission receipt identity that survives coalescing, freeze and restoration. Verified replay settlements must identify exact obligations, not infer that missing generations were persisted from segment endpoints or an ACK high-water mark. Preserve all original update/cut promise outcomes; recovery supplies new evidence for future cuts.
3. Fence obsolete completions with a persistence epoch. Await both old queue and hook settlement before attaching readmission; late old callbacks cannot decrement new counts, advance lineage twice or relatch failures.
4. Preserve local/write clocks and local→write structural dependencies. An already-proven structural predecessor may be rebound to its exact verified durable fold generation; a pending predecessor remains linked to its replay obligation. Existing queue checkpoints omit an otherwise-unneeded `latestStructural`, so do not assume that old structural ACK is present in the restored dependency map.
5. Pre-enqueue mapping/authority failures, missing generations and suppressed paired preferences remain blockers unless the exact missing intent is retained and deliberately persisted. An empty/replayed queue is not proof of their completion. Compare coverage with the frozen editor generation and explicitly retained never-invoked ordinary producers.
6. Attach the readmission session synchronously while the recovery hold is closed. Establish exact fresh document/preference/fold stamps using independently verified own late outcomes. Then release the hold and explicitly drive retained queue replay; do not await readmission completion before driving the replay that resolves it. Reconcile verified settlements before releasing never-invoked ordinary producer closures FIFO into the same readmitted hook. Never submit already-queued work twice. Never auto-replay never-posted lifecycle intents.

This is an implementation-interface correction within B's approved transport-recovery goal, not bulk document replacement/recovery-as-copies or a durable-format change. Add regression-first coverage for every step, including metadata-separated clocks, both-lane partial success, an unrepresented early failure, structural predecessor eviction and preserving the surviving editor/history owner. The current normal lifecycle path must remain separate from any claim that this readmission extension is complete.

Task6 checkpoint: async admission, immutable input retention, producer/cut FIFO, revocable installation pins, cooperative catalog publication, current-owner inspection and opaque disposal now compose with paused construction and explicit verified restart. Real editor/history/survivor recovery is covered, including partial attachment failure, repeated recovery, metadata custody and source revocation. This remains private integration, not production bootstrap or native acceptance.

#### Restart composition seams — implementation refinement, 2026-10-01

Read-only review `ses_f0aeb5d5affef47JK4RRc8vIH6` confirmed four remaining composition requirements: genuine synchronous hook attachment, paused-owner acknowledgement observation, partial-recovery custody and non-recycled lifecycle identities. These refine the already-approved protocol; no replacement/remount, new storage writer, automatic lifecycle retry or production entrypoint is added.

- Expose stable opaque `writeOwner: ProjectWriteOwner` from the private hook. Its existing bridge binds actual hook retain/readmit/cut operations, not caller-shaped successful callbacks. Add `registerWrites(scope, writeOwner): () => void` beside drain registration, allowing either React registration order. Track idle installations in the queue. Capture both logical attachments on disposal; cleanup revokes only the exact attachment even after adoption.
- Recovery factory takes the existing opaque retained handle, acquires its candidate queue hold before awaiting, authenticates one claimant, waits old quiescence and verifies workspace outcome/fresh authorities. It returns a **paused** owner before consuming hook handles. Composition installs this owner as the fresh queue's acknowledgement recipient, then calls `resumeRecovery(prepareWrites)`. The preparation callback receives scope, retained hook handle and genuine queue checkpoint, and returns `VerifiedProjectWriteRecovery`; the bridge verifies its exact queue and owner, never trusting a boolean.
- Attach every actual hook synchronously before opening the queue hold. The bridge produces authenticated attachment evidence only after the hook enters its recovering phase, with live source/epoch/installation fences, plus its eventual completion promise. Failed synchronous attachment cannot permit replay. Release the hold and explicitly flush; accept only exact replay ACK identities already included in the fresh baseline without double advancement. Other ACKs must advance normal authority rules.
- Preserve source-keyed drain/writer attachments through a logical continuity cell. Stable edit guards and original cleanup follow that cell; old workspace submissions, producer admissions and transport callbacks remain disposed. Candidate sources receive new installation pins; original attempt identity/preconditions/pins are not rewritten. Reopen editing only after all hook completions, source checks and held-intent coverage succeed. Frozen editor generations must be represented by hook obligations or the exact contiguous never-invoked producer suffix; unrepresented metadata or failed invocation remains blocked.
- Unknown/conflicting workspace outcome or an unexplained fresh D/P/fold revision keeps saving and publication closed. Restart cannot invent an old-owner absence fence. Independently verified close may omit only a closed incarnation with no retained pending/uncertain project work; surviving projects retain exact source identity. Fresh admission metadata is not a substitute for checking every survivor's last known state plus own verified outcomes.
- Constructor failure before attachment leaves original custody intact and candidate queue held. Once returned, the paused owner owns subsequent failure handling: partial attachment/replay freezes that proven queue, retains all genuine hooks again, and `dispose()` yields the next opaque handle, including the original unresolved workspace attempt. A rejected unrelated candidate must not replace retained payloads with an empty checkpoint. Resume is single-flight; stale owners cannot unretire or activate a successor.
- Carry lifecycle client namespace, sequence and unresolved identity reservations forward. Never reuse sequence zero under the same client ID. Keep never-posted lifecycle intents retained but unscheduled; explicit retry remains a caller decision, not an effect of resuming ordinary saves. Drop consumed transient recovery/capture references after successful adoption rather than retaining restart history.

Review corrections make producer custody explicit: validate while the callback remains at the queue head, then atomically transfer it to an invoked-but-unproven record before calling it. Disposal retains those records and the next constructor awaits their completion. Actual synchronous hook queue receipts distinguish represented work from a callback-shaped `true`; unrepresented metadata cannot disappear when flush rejects. Publication and final resolver callbacks may enqueue more producers, so FIFO draining/settlement repeats before activation without publishing twice. Final callback-free checks cover exact drain/writer registrations, hook epoch/lifetime/working lineage and installation leases. A successor handle retires its predecessor only after all outstanding custody is captured.

Retirement follows the approved spec's verified-readmission exception: paused construction and promise rejection never reopen a target; successful explicit `resumeRecovery` may do so after authentic outcome/fresh admission checks. It installs a fresh queue authority and does not revive the retired queue token. No additional lifecycle-cancellation API is implied.

Regression-first order: bridge attachment and wrong-owner/queue refusal; paused factory and known/unknown outcomes; stable registration/cleanup and exact authority fencing; actual editor/metadata/Undo restart; partial failure/repeated restart and held producer coverage. Keep existing timeout receipts and full migration/native gates separate.

Use own-data framing and authenticate the installed owner before reading payload. Capture the target member incarnation/installed editor source at intent submission. Never resolve a later same-public-ID incarnation in its place. A queued intent receives its workspace before-stamp only at its admitted queue position, after earlier **local** commands complete. Once a batch is built/posted, freeze its identity/preconditions/payload and never rebase it. A failed pre-cut drain has an unposted intent, not a fictitious durable attempt.

Advance per-project known stamps only from existing verified queue `acknowledged` events matching installed scope/source, before passive observers. No workspace traversal or payload inspection on an ordinary acknowledgement. Post-drain destructive guards use these conservative expectations; unrelated remote saves may make them stale and must then block close.

For a current successful reply, validate correlation/receipt/delta, apply catalog atomically by exact before-stamp, retain all surviving editor/working-owner references, then notify. Observer reentry cannot publish twice or reorder held work. New bulk material is initial material only until its explicit project bootstrap/owner is installed. Older catalog or worker/store/source completions are refused, even if durable commit happened. Metadata catalog is not a current-document snapshot or a payload getter.

Expose the same queue through a private `queue` property on `createIncrementalCommandAdmission`'s returned object; do not create a second queue in the workspace factory. Forward already-verified `QueueEvent`s to `observeProject` before passive observers. The owning private composition owns queue/client shutdown; lifecycle `dispose` stops its own admission/publication, does not independently dispose a shared client, and returns an opaque WeakMap-backed retained handle containing the original batch, originating admission ID, pending unposted intents, retirement state and quiescence promise. `blockedAttempt` returns metadata only, never a mutable reference to captured bulk payload. A caller-shaped retained handle is refused.

On unknown result, retain original batch and unsaved project work; `inspectBlocked` uses the same worker FIFO and authentic fence path when possible. A newly created client cannot turn absence into not-committed. No automatic replay or automatic lifting of target retirement. Constructor `recovery` waits the authentic old quiescence and leaves publication/flush blocked until inspection and fresh workspace/project admissions agree. Require exact last-known project authorities plus resolved own acknowledgements before replaying retained project work; same incarnation or a merely higher revision is insufficient after remote edits. Pending lifecycle intents that never posted remain explicit retry choices, not automatic replay.

After a committed/current inspection, derive the metadata delta from the retained before-catalog and independently verified current catalog, requiring the receipt's exact before/after stamps. Fresh catalog admission may already be at the after-stamp; validate it and publish the outcome once without applying that delta twice. For verified not-committed/unposted work, require unchanged captured preconditions before any deliberate retry. Preserve stable editor guard closures through the retained lifecycle state and preserve editor source/history for surviving incarnations; sidecar replacement must not key-remount the editor. A disposed old owner cannot clear a new owner's retirement cell or publish later. Bulk document replacement and recovery-as-copies remain unsupported until C; this retained-attempt recovery is transport recovery for B's own commands.

- [x] **Step 3: Connect the real private React composition.** Extend `ProjectEditor.incrementalPersistence.test.tsx` or a new same-boundary fixture with shared private lifecycle admission, edit guard and catalog. Test edit→activate-other→return preserves history; close drains prior document/preferences/metadata, blocks immediate target Undo, and retains newer survivor edits; failed/lost-ack close keeps unsaved content and retiring guard; stale catalog response cannot overwrite newer local state. Create/consume returns explicit new material, followed by real existing project bootstrap before first ordinary edit. No fake `WorkspaceSnapshot` response or synthetic layout mutation in success tests.

- [x] **Step 4: Run connected private milestone tests and review all command families.** Run catalog/admission, queue/worker, real editor, historical commit/import and validation suites serially or with at most two workers. Confirm historical production dispatch remains v2 snapshot-only and unknown families fail before payload access. Store-operation assertions must prove activate/preset/stage do not reconstruct unchanged documents; ordinary edit/navigation remain manifest-free and selected-record-only.

## Task 7: Full Milestone Verification and Release Boundary

**Files:** tests/evidence/docs only unless a scoped review finding needs a regression-first correction. **Deliverable:** reviewed private lifecycle support with explicit unresolved migration/native/live-integration gates.

- [ ] **Step 1: Review the exact implementation slice against its immediate dirty baseline.** Cover all eight intents, queue cuts/retirement, unknown outcomes and payload publication together. Do not call B complete from create/activate alone. Add regression tests for every actionable finding before fixing; do not alter original fixtures/deadlines to obtain green output.
- [ ] **Step 2: Run connected suites, full boundary, typecheck and build.** Exact commands:

```bash
npx vitest run tests/unit/localWorkspace/normalized/workspaceCommands.test.ts tests/unit/localWorkspace/normalized/workspaceTransactions.test.ts tests/unit/localWorkspace/normalized/workspaceAuthority.test.ts tests/unit/localWorkspace/normalized/workspaceWorker.test.ts tests/unit/localWorkspace/normalized/incrementalQueue.test.ts tests/unit/localWorkspace/normalized/storeCommands.test.ts tests/unit/localWorkspace/workspaceCatalog.test.ts tests/unit/localWorkspace/workspaceCommandAdmission.test.ts tests/unit/ProjectEditor.incrementalPersistence.test.tsx --maxWorkers=1
npx vitest run tests/unit/localWorkspace/commit.test.ts tests/unit/localWorkspace/validation.test.ts tests/unit/localWorkspace/migrationPreparation.test.ts tests/unit/importProject.test.ts tests/unit/useIncrementalProjectWrites.test.tsx tests/unit/ProjectEditor.incrementalChanges.test.tsx --maxWorkers=1
npx vitest run tests/unit/localWorkspaceBoundary.test.ts --maxWorkers=1
npx tsc --noEmit --pretty false
```

Run typecheck independently from build so the established Sticker PressTS2339 does not suppress build. New diagnostics are not baseline. Verify a fresh output path before:

```bash
TMPDIR=/tmp/opencode npm run build --legacy-peer-deps -- --outDir /tmp/opencode/doctect-incremental-sdd/task-13-workspace-lifecycle-build-01
```

- [x] **Step 3: Run a fresh complete migration campaign on the implementation stamp.** Use the existing660-case inventory and amended runner, explicitly clear the single-case filter, preserve all results and require every selected outcome. The earlier649/11campaign is a baseline, not postimplementation acceptance. Current campaign is complete at642PASS/18timeouts, not green. No best-of replacement or blanket claim that any new failure is an old timeout.
- [ ] **Step 4: Establish native lifecycle evidence separately from fake IndexedDB.** Add the named external native assets after the real protocol implementation is verified. The worker imports the actual coordinator/repository; its fresh fixture creates the real private layout through the existing normalizer, not a hand-written successful workspace manifest. The entry exposes a single test command/response channel to the runner. The runner builds those assets with an isolated Vite config, checks4320/4321 on IPv4/IPv6, launches a fresh nonpersistent context, blocks non-fixture network requests, records source/tool/browser fingerprints and releases only its own resources. No fake IndexedDB, transformed writer or existing profile.

Run serially with unique artifact directories:

```bash
TMPDIR=/tmp/opencode node /tmp/opencode/doctect-incremental-sdd/run-workspace-lifecycle-native.mjs chromium
TMPDIR=/tmp/opencode node /tmp/opencode/doctect-incremental-sdd/run-workspace-lifecycle-native.mjs firefox
TMPDIR=/tmp/opencode node /tmp/opencode/doctect-incremental-sdd/run-workspace-lifecycle-native.mjs webkit
```

Required named scenarios: `create-edit-close-recreate-reopen`, `preset-upsert-delete-order`, `import-stage-replace-consume-retry`, `worker-loss-inspection`, `closed-project-write-refusal`, and `native-quota`. Seed small exact fixtures with preserved scripts/raw folds; independently inspect actual durable rows and retained source after every scenario. Repeat a pinned Sticker Press interaction run separately after the functional scenario suite, without a sampler for latency claims. No existing fixture is reduced or replaced.

Quota verification uses a genuine safe browser quota control where available, never `unlimited-storage` or a disk-filling loop. Missing engine binaries or unavailable safe native-quota controls are recorded as unavailable/open evidence, not passed via injected exceptions; do not install dependencies/browsers without authorization. New harness tool tests must check isolation, unique receipts, error handling and cleanup before browser launches. Native evidence is not production UI, p95/INP or live-cutover acceptance.

Native execution is now recorded below, but Step4 remains unchecked for cross-engine acceptance: Chromium passes all six scenarios; Firefox lacks verified native quota control; WebKit cannot launch without missing host libraries. No installation or synthetic quota substitute was performed. Pinned interaction checks are functional evidence only and expose remaining long-task/latency work.
- [ ] **Step 5: Close only B's verified scope.** Update this plan, approved spec/roadmap links and ledger with actual counts/source stamps/reviews/build/native evidence. Preserve original baselines, source archives and all artifacts. No commit, dependency update, production switch, same-incarnation replacement or recovery-as-copies. C starts with its own concrete plan; D/cutover still requires all release gates and separate authorization.

## Planning Self-Review and Execution Gate

The command set, historical compatibility, storage ownership, request/receipt identity, target stamps, current-versus-retained source, truthful inspection, queue cuts, synchronous retirement and publication rules map to Tasks1–6; independent scope/regression/native verification is Task7. The existing approved design, not a new product interview, supplies the requirements. This document does not waive the11timing failures or claim any new command exists.

Before execution approval: parse code examples, check planned types against existing numeric protocol admission IDs and actual module exports, review the typed interfaces/fixture and failure matrices, and obtain independent read-only plan review. Any unresolved interface or fence-safety issue blocks execution rather than becoming an implementation guess. No implementation code is changed during this planning checkpoint.

### Expanded Validation and Native Checkpoint — 2026-10-01

Immediate immutable baseline: `task-13-workspace-lifecycle-validation-baseline`, starting at restart stampb5dae3ad…. Exact3workspace paths changed: new `workspaceEvidence.test.ts`, expanded `workspaceCommitProof.test.ts` and this plan, plus the separate untracked ledger. Original B scope is now32paths. Added260cases; no application runtime, existing test body/deadline, schema, dependency, configuration or production entrypoint changed. The byte-proof helper gained an optional client ID with its original default preserved.

#### Transaction, worker and connected evidence

Under `/tmp/opencode/doctect-incremental-sdd`, four disjoint complete receipts form the current connected covering set:

| Receipt | Result |
| --- | --- |
| `task-13-workspace-lifecycle-validation-faults-01.jsonl` |422PASS/4files:259new evidence,14proof,53original transaction and96worker cases.|
| `task-13-workspace-lifecycle-validation-core-01.jsonl` |492PASS/9files.|
| `task-13-workspace-lifecycle-validation-compatibility-01.jsonl` |586PASS/1timeout/587cases/6files.|
| `task-13-workspace-lifecycle-validation-boundary-01.jsonl` |953PASS/1file.|

Total **2453PASS/1timeout/2454cases/20files**, no missing/skipped/retries/module/unhandled outcomes. Failure: existing `real ProjectEditor incremental boundary > G6 real controller bounds history at 50 and drains effects without cloning inactive artwork or rebuilding reference index`,5213ms at unchanged5000ms. Its code and application runtime are unchanged in this validation slice. Cause remains unclassified; no isolated retry replaces this broad failure. Earlier2181PASS,2150/3 and1721/1receipts remain historical, not merged into a best-of result.

The new real worker histories enforce32-entry and64KiB limits independently. Valid escaped255-byte private IDs trigger byte eviction below the count limit; external IDs remain uncapped by that private limit. Tests verify linked floors, current/evicted inspection outcomes, no replay, immutable historical source, surviving workspace births and real ordinary document/preference saves. Old-owner capability eviction loses an authentic absence fence rather than granting a new one. The216rollback cases exercise every one of72actual mutation positions across eight families and last-close succession with three failure classes;36additional cases independently inspect committed outcomes after lost or corrupted readback. All use the actual writer.

#### Fresh complete migration campaign

`task-13-migration-10m-cases-0-660-g8xSdl`, reconstructed in `task-13-workspace-lifecycle-migration-01.json`: **642PASS/18timeouts/660cases**,37serial complete batches,0missing/skipped/retries/non-timeout/module/unhandled failures. Full32MiB case passes **437492.74169ms** under approved600000ms; the18failures all retain5000ms limits. Runtime/test stamp is identical before/after; original migration test, reporter and amended runner remain unchanged. No sampler or competing owned benchmark ran.

Compared with pre-B649/11, all11old failures fail again and7previously passing cases now time out: two historical scalar active-recovery cases and five archive collision/recovery cases. They are not blanket-labeled baseline failures or attributed to B without causal evidence. Against the older636/24campaign,12of18had failed. Neither comparison is a speedup/regression attribution or permission to widen deadlines. This campaign satisfies complete inventory collection, not timing acceptance.

#### Isolated native lifecycle and quota

External assets: `workspace-lifecycle-native-{entry,worker}.ts`, `workspace-lifecycle-native-tools{,.test}.mjs`, and `run-workspace-lifecycle-native.mjs`. The actual normalizer creates the fresh fixture through the existing historical adapter. Actual `WorkspaceWorkerClient`, module worker, coordinator and repository execute lifecycle commands against native IndexedDB. A separate MessagePort carries fixture initialization and independent readonly physical/current/retained observations, never fabricated mutation success. Native application writer source is bundled normally, not instrumented or patched.

Runner uses unique output/build/profile directories, sanitized provider/preload/proxy/browser environment, isolated Vite envDir, fresh nonpersistent contexts, fixture-origin network restriction and4320/4321IPv4/IPv6 preflight. Reports fingerprint source, tools, Node, Playwright, browser version and executable; cleanup/source changes reject acceptance. Thirteen external tool tests cover isolation, fresh outputs, late resource acquisition, reentrant/single-flight cleanup, frozen-renderer stop and quota-reset deadlines, genuine quota classification and unavailable gates. Read-only review`ses_f056bb7f5ffegBqTrqx7GHJpEi` found an unbounded page-stop cleanup await; regression-first correction now bounds both best-effort operations and always closes the owned context. Final scoped review is clear.

Final reviewed-tool receipts:

| Engine/artifact | Evidence |
| --- | --- |
| Chromium143.0.7499.4 — `task-13-workspace-lifecycle-native-chromium-Cp7Agu` |**6PASS**, including native quota; accepted for these isolated functional scenarios.|
| Firefox144.0.2 — `task-13-workspace-lifecycle-native-firefox-K3wvpB` |**5PASS/1unavailable**. Functional scenarios pass; no verified engine-scoped IndexedDB quota control in this harness.|
| WebKit26.0 package — `task-13-workspace-lifecycle-native-webkit-CaCaxX` |**6unavailable**, not six failures/passes. Launch blocked by missing `libvpx.so.9`, `libavif.so.16`, `libmanette-0.2.so.0`. No dependencies installed.|

Chromium quota uses CDP `Storage.overrideQuotaForOrigin` with quota1, not quota0/unlimited storage or disk filling. After a fixed31-second no-write barrier, the original bounded256KiB operation returns genuine `quota-exceeded`/unknown outcome; every physical store is unchanged, workspace revision remains0 and final Cp7Agu usage remains55667bytes. The barrier derives from Chromium143's30-second IndexedDB allowance cache: [BucketContext constant](https://chromium.googlesource.com/chromium/src/+/refs/tags/143.0.7499.4/content/browser/indexed_db/instance/bucket_context.h#75), [cached grant check](https://chromium.googlesource.com/chromium/src/+/refs/tags/143.0.7499.4/content/browser/indexed_db/instance/bucket_context.cc#315), and [quota override update](https://chromium.googlesource.com/chromium/src/+/refs/tags/143.0.7499.4/storage/browser/quota/quota_manager_impl.cc#2470). Read-only research`ses_f057d0a8dffehscQ0YfezdkXeZ` established this mechanism. Production30-second request timeout and all application test deadlines are untouched; the barrier occurs before issuing the request.

First native Chromium receipt`...chromium-AQwgCr` remains **5PASS/1quota-probe failure**. That harness asserted row equality before recording the reply, so it did not distinguish a fully successful cached-allowance write from partial commit after quota rejection. It establishes neither an application atomicity bug nor quota acceptance. After source-derived precondition/observation correction,`...chromium-ZnrRrO` passes6; final Cp7Agu repeats all scenarios after the separately reviewed cleanup correction. Earlier FirefoxhESXaX and WebKitw3oqARreceipts retain their original tool hashes. No best-of case substitution.

#### Pinned interaction, build and remaining gates

`/tmp/opencode/doctect-sticker-private-1790911839492`: pinned state SHA`604d08d40fa4e4641d50d8cefc708a91ff946b3a3185ffb90b4cb6fb3b4e8a22`,21152284bytes; **42functional interaction checks complete** (7warmup/35measured), no CPU/operation sampling, correct durable edit/Undo/Redo assertions. Maximum measured action-through-next-frame964.8ms and maximum long task527ms. This separate normalized-only private editor fixture is not real source-migration, production UI, controlled performance or p95/INP acceptance; latency work remains visible.

Build`task-13-workspace-lifecycle-validation-build-01` **PASS12.92s/2468modules**, existing warnings only. Final`tsc`: only established StickerPressTS2339 at793:36. New audit/evidence checker tests4 plus native tool tests13 **PASS17**. `audit-workspace-lifecycle-validation.mjs` reconstructs all four connected receipts, all37migration batches, native source/tool/quota evidence and pinned observations; checks exact3/32paths, HEAD/empty index/whitespace, productionv2 and protected sibling hashes. `task-13-workspace-lifecycle-validation-checkpoint-01.json` reports B/release acceptance false, not merely a successful evidence audit.

Final read-only evidence/scope review by`ses_f056bb7f5ffegBqTrqx7GHJpEi` is clear: exact suite identities/tool-hash sets, raw connected and37-batch migration coverage, final native quota observations, unavailable gates and pinned42-action log all match the checkpoint. The audit rejects substituted suites, omitted tool fingerprints and false native acceptance. Protected launcher2397595 remains alive on3000/3001;4310/4311/4320/4321 remain unused. HEAD, empty index, whitespace and protected sibling hashes are unchanged.

Current source stamp **191c08e02d3f9d6cb7c193e72a61887a5bc2bec3141e5666b78c67edb385a5fc/1182files**. Outstanding:18migration timeouts,1connected history timeout, WebKit host dependencies requiring separate authorization, Firefox safe native quota evidence, known unrelated typecheck error, and broader responsiveness/live acceptance. No runtime fixes, deadline relaxation, source/profile migration, dependency installation, staging/commit, C/D implementation or production switch occurred in this validation slice. Implementation/coverage progress is not release acceptance.

## Timing diagnosis follow-up — 2026-10-01

The user approved proceeding with timing diagnosis. This follows the external-only measurement discipline in `2026-09-28-full-size-normalization-diagnosis.md`, not its old source stamp or superseded acceptance budget. No new runtime optimization is authorized. Immediate immutable baseline: `task-13-workspace-timing-diagnosis-baseline`; current application/test/config stamp remains191c08e0…a5fc/1182.

- [x] Reproduce original replay and G6 cases at unchanged5000ms deadlines. Receipts `task-13-workspace-timing-replay-01.jsonl` and `task-13-workspace-timing-history-01.jsonl`: both replay cases time out; isolated G6 times out after17.3s. No module/unhandled failures. These are diagnostic selections, not replacement acceptance campaigns.
- [x] Minimize cross-case interference by running one selected original case per process; retain original fixtures, operations and assertions. Add tested external coarse checkpoints and optional10ms inspector sampling without changing source files, timeouts, Work scheduling or transaction behavior.
- [x] Distinguish ranked hypotheses: repeated normalization processing; DOM/render/query cost in G6; host scheduling pressure; async waits or work continuing after a timeout. Record process CPU and host load, without stopping unrelated processes. Sampling/phase instrumentation is not timing-neutral; partial profiles are not completed workflows.
- [x] Record supported findings, remaining uncertainty and one scoped next step. Preserve all observations, including failures and partial cases. No retry-until-green, budget relaxation, speculative fourth Work optimization or production switch.
- [x] Verify external tools, source/HEAD/index/protected resources and obtain read-only evidence review. Application builds/full suites are not necessary for external tooling and documentation alone; any authorized application change would require regression-first tests and fresh build/relevant suites.

### Diagnostic outcomes, not replacement acceptance

All19 originally failing cases now have one isolated sampled observation at their original5000ms deadline. Migration: **8PASS/10timeouts/18**; G6: **1timeout**. No selected case is missing, retried or replaced. The eight passes do not repair the official642/18 migration campaign. These runs simultaneously differ from that campaign in isolation, host conditions and instrumentation; no single-variable speedup or baseline-regression claim is supported.

| Original migration family | Cases | Isolated sampled outcomes |
| --- | ---: | --- |
| Fresh/historical prepared replay | 2 | 2timeouts |
| Historical scalar active recovery | 2 | 2PASS |
| Archive collision/reuse/preferred-ID recovery | 5 | 4PASS/1timeout (concurrent recovery) |
| Hash/progress observation | 1 | timeout |
| Generator512KiB | 1 | timeout |
| Remote edits/proof eviction | 1 | timeout |
| Exact256KiB stage frame boundary | 2 | 2timeouts |
| Every physical write ordinal | 1 | timeout |
| Bounded-batch resume | 1 | timeout |
| Oversized singleton record | 1 | PASS |
| Current ancillary versus retained source | 1 | PASS |

**Migration attribution:** Work/JSON processing is the largest disjoint self-sample group in every migration observation, **46.59–59.52%** of sampled intervals. Other application/tooling adds23.92–33.85%; do not add overlapping inclusive stacks. The fresh replay's coarse disjoint stages were: fixture14ms; prepare1222ms; reserve4ms; independent source read639ms; synchronous reference derivation8ms; staging plus batch assertions70ms; physical row assertions29ms; verify1638ms; activation still running when observation ended after1390ms. Reopen was not reached. This identifies processing before/during independent verification rather than staging writes as the dominant observed path; it does not justify omitting any verification boundary.

**G6 attribution:** The sampled observation reached the final body checkpoint with every original assertion executed, but still failed its elapsed-time deadline: test5575.99ms; timing-hook window5320.89ms. Initial fixture/render305ms;55edits1268ms;50Undos2417ms; replacement/history1269ms. Disjoint self samples: React development45.40%, DOM/query dependencies34.54%, other dependencies7.17%. This is a synchronous React/jsdom integration workload, not a storage-worker latency measurement. Its uninstrumented17.3s observation and sampled5.58s observation are unpaired and do not demonstrate a fix or profiler benefit.

**Limits and next scope:** No safe implementation defect or removable traversal was proved. Ten migration profiles are deadline-truncated; their unobserved suffixes remain uncharacterized. Host load averaged roughly9.7–18.0 at sampled starts on24available CPUs; no controlled load intervention or scheduling attribution was performed. Isolated timeout reproduction means prior cases are not required for those ten failures, but does not prove absence of carry-over in the original campaign. Process CPU includes background threads and can exceed wall time. Sampling intervals are requested10ms, not exact CPU accounting or timing-neutral observation.

Recommended next scope is a concrete, separately reviewed bounded-normalization processing design, with a demonstrated redundant operation or equivalent lower-cost representation and controlled whole-workflow evidence before any promotion. Do not revive the rejected scalar-dispatch candidate or tune IndexedDB staging based on these profiles. G6's development-renderer/test cost is a separate investigation; caching test queries, splitting assertions or changing deadlines would change the acceptance workload and is not a fix made here. Native UI responsiveness remains a separate open gate.

### Evidence and verification

- Raw initial reproductions: `task-13-workspace-timing-{replay,history}-01.jsonl`.
- Initial profiles: `task-13-workspace-timing-replay-profile-6EfHFf` and `task-13-workspace-timing-history-profile-Aw46En`.
- Remaining17 fixed serial profiles: `task-13-workspace-timing-matrix-QYoyfl`, with original-ID selection, per-process commands/results, unique artifacts and frozen tool copies. Tool snapshots for the initial two profiles were captured afterwards, explicitly not represented as pre-run captures.
- Reconstructed19-case receipt: `task-13-workspace-timing-diagnosis-01.json`. Raw profile summaries, disjoint stage totals, selected identities, unchanged deadlines, zero retries and non-overlapping reporter run windows are checked independently.
- External tools: `workspace-timing-{tools,evidence}{,.test}.mjs`, `workspace-timing-setup.mjs`, `workspace-timing.config.mjs`, `run-workspace-timing-matrix.mjs`, `summarize-workspace-timing{,.test}.mjs`; reuse the existing inspector and owned-process helpers. All stay under `/tmp/opencode/doctect-incremental-sdd`.
- Ten new tool/evidence checks and four selected existing inspector checks pass. Development failures were confined to missing helpers, an ambiguous checkpoint anchor, a syntax typo and Vitest's ready notifications also covering skipped tests. A real-receipt regression locks down the latter; the rejected matrix preflight launched no tests. No diagnostic exception is hidden as an application pass.

Application/runtime/test/config source remains191c08e0…a5fc/1182. Only this plan and the untracked ledger change in the worktree. **B acceptance remains2453PASS/1timeout connected and642PASS/18timeouts migration; milestoneBComplete/releaseAccepted remain false.** No runtime fix, deadline relaxation, dependency installation, staging/commit, C/D implementation or cutover occurred.

Final verification:14external checks pass again; saved19-case diagnosis reconstructs exactly from raw receipts/profiles. Read-only review`ses_f04e54ce6ffe3A87n3j3QpKEGv` reports no actionable standards/evidence findings. Fresh application build at`task-13-workspace-timing-build-01` passes17.75s/2468modules, with existing chunk warnings; typecheck still reports only StickerPress793:36TS2339. Validation audit rechecks original failed acceptance counts, unchanged1182-file source, protected hashes, HEAD and empty index. Protected launcher2397595 remains alive on3000/3001;4310/4311/4320/4321 remain unused. Full acceptance campaigns and browser checks were not rerun or relabeled. Diagnosis is complete at the measured-subsystem level, not a proven optimization or closed timing gate.

### Workspace Restart Integration Checkpoint — 2026-10-01 (prior to expanded validation)

Immediate immutable baseline `task-13-workspace-lifecycle-restart-baseline` starts at readmission stampc2453a32…. Exact11paths changed including this plan, plus the separate untracked ledger; original B scope remains30paths. Runtime changes are limited to the save hook, queue metadata evidence, write-recovery bridge, catalog equality helper and workspace lifecycle owner. Existing worker protocol/coordinator/repository, primitive Work/JSON/SHA code, schemas, dependencies, production entrypoints and test deadlines remain unchanged.

Recovery has two explicit stages. Construction closes the queue hold before any ownership callback, authenticates one retained-handle claimant, waits old queue and invoked-producer quiescence, and verifies the independently inspected workspace outcome against fresh catalog and exact surviving project authorities. A still-live original worker can supply its genuine fence/abort evidence; a terminated worker cannot turn absence into proof. Construction returns a paused owner. Composition installs its acknowledgement observer, then `resumeRecovery` prepares and synchronously attaches genuine write owners, releases/flushes replay, verifies all hook settlements, drains retained ordinary producers and publishes once before opening stable editor guards.

Existing editor/history, local/write clocks, structural dependencies and source identities survive. Original failed save/cut/producer promises remain false. Exact recovered ACK identities already included in fresh baselines do not advance twice. Closed incarnations are omitted only after independently proven close with no retained uncertain/pending target work. Never-posted lifecycle intents stay retained and unscheduled; lifecycle identity sequence/reservations carry forward. Partial attachment/replay failures produce successor custody rather than replacing retained work with an unrelated empty queue.

Real private editor tests cover pending document/preferences/metadata restart with Undo/Redo; a lost close followed by surviving-editor recovery; early unrepresented handoff; FIFO metadata including callback reentry; constructor hold/claim refusal; partial attachment and replay failure; unexplained remote preferences; publication/final-resolver reentry; queued/invoked metadata custody through failure/disposal; and obsolete-handle compaction. Created/consumed material continues to use the real owner/worker bootstrap boundary; production creation/display/bootstrap wiring remains D, not this test fixture.

Read-only design review `ses_f0aeb5d5affef47JK4RRc8vIH6` confirmed the narrow attachment/continuity/paused-observation/custody seams. Runtime reviewer `ses_f068b9d38ffeeoTvwnT1jHES00` found producer-custody gaps before invocation and while pending, final attachment revalidation gaps, publication-time FIFO stranding and obsolete predecessor retention. Controller regressions reproduced every actionable finding before fixes; final scoped recheck is clear. A proposed permanent-retirement finding was withdrawn after comparison with spec178 and Task5's explicit verified-readmission exception. No new cancellation policy or implementation delegation was introduced.

Fresh receipts under `/tmp/opencode/doctect-incremental-sdd`:

- `task-13-workspace-lifecycle-restart-workspace-regression-01.jsonl`: **572PASS/9files**.
- `task-13-workspace-lifecycle-restart-editor-regression-01.jsonl`: **656PASS/8files**.
- `task-13-workspace-lifecycle-restart-boundary-01.jsonl`: **953PASS/1file**. Only exact owner→queue/bridge edges and the bridge's lifecycle caller were added; no directory or storage-writer grant.
- These three disjoint complete batches cover **2181PASS/18files**,0missing/skipped/retries/module/unhandled failures:953boundary,223editor behavior,37real editor integration,66save-hook,189queue,70store-command,36lifecycle owner,3registry,24catalog,27commands,53workspace transaction,40workspace authority,70repository,96worker,75historical commit,79validation,131migration preparation and9import cases.
- `task-13-workspace-lifecycle-restart-build-01`: **buildPASS14.74s/2468modules**, existing output/chunk warnings only. The actual private Vite worker edge also builds in the96worker cases. Final`tsc` reports only established StickerPressTS2339 at793:36; no new suppression.
- Intended RED/fix receipts retained under`...restart-{attachment,owner,editor,faults,review,producer,final-fence,publication,custody,preinvoke,boundary}*`. Initial new fault fixtures had an unbound-`this` callback, missing old quiescence before a remote admission, and an unsafe assumption that a dead worker could prove an aborted project's absence. Fixtures were corrected without runtime proof/deadline relaxation. Corrected fault RED02 isolated the real hold-before-callback defect.
- The predecessor-retention GC test initially retained its own rejected error through Vitest's async assertion bookkeeping and V8 call-site closures. Read-only heap tracing identified that test root. Converting rejection to a primitive before synchronous assertion removes the fixture root. `...restart-gc-corrected-red-01.jsonl` disables only predecessor-handle retirement **in memory**, producing the intended failure; actual runtime passes the corrected case in complete verification. No native-browser heap or overall memory bound is claimed.
- `audit-workspace-lifecycle-restart.mjs` and `...restart-checkpoint-01.json` check exact11/30paths, all2181raw outcomes and18inventories, source stamp, HEAD/empty index/whitespace, protected sibling hashes, productionv2 and retained old failures. Four new checker tests plus four reused evidence testsPASS. Audit reports private restart integration true but `milestoneBComplete`, full migration rerun and native lifecycle acceptance false.

Final read-only evidence/scope review is clear for the11-path package, exact boundary grants, plan/ledger, audit and checkpoint. It confirms2181/18 coverage without treating earlier timing failures as fixed or private creation/bootstrap tests as production UI acceptance. Protected launcher2397595 remains alive on3000/3001;4310/4311/4320/4321 remain unused. HEAD, empty index, whitespace and protected sibling hashes remain intact.

Current stamp **b5dae3ad67d04f1ff2fa5cf759a7b6e73282bd38c9c27c70147b3efba40ecdda/1181files**. Prior2150/3storage timeout cases now pass in these current complete batches, but their cause is not established and no timing fix is claimed. Earlier1721/1UI timeout, the incomplete1283-result process receipt and pre-B649/11migration evidence remain unchanged. Remaining B work: workspace receipt count/byte eviction and expanded fault matrix, final complete migration campaign, isolated native lifecycle/quota checks and release boundary. No commit, staging, dependency change, existing-profile migration, C/D implementation or production switch. Approval continues for the remaining B validation work.

### Write-Owner Readmission Core Checkpoint — 2026-10-01 (prior to workspace restart integration)

Immediate immutable baseline `task-13-workspace-lifecycle-readmission-baseline` starts from the normal-admission stamp569d5a16…. Exact10paths changed including this plan, plus the separate untracked ledger; original B scope is now30paths. Runtime changes are limited to `incrementalQueue.ts`, `incrementalCommandAdmission.ts`, `useIncrementalProjectWrites.ts` and new `projectWriteRecovery.ts`. Repository/coordinator/worker protocol, Work/JSON/SHA, physical schema, original deadlines and production entrypoints remain unchanged.

Every logical queue submission has an opaque receipt, including coalesced writes. Genuine freeze/recovery chains share bounded provenance without a growing ancestry log; an independently inspected/replayed receipt supplies positive settlement without changing original rejected promises. Exact fresh document/preference/fold bases are required for readmission, not merely equal incarnation or higher preference revision. Idle installed projects can be tracked without posting. Startup checkpoint indexes are weak, and live command-admission callbacks do not retain startup recovery payloads.

The bridge binds the exact retained write owner, source, queue checkpoint and fresh installation lease. The hook preserves local/write clocks, both lanes, metadata obligations and local-to-write structural mapping in place. Old completions are epoch-fenced; missing or refused intent remains a blocker. Idle refused intents now visibly latch the affected lane before notification, without recursive notification or dirtying duplicate/foreign callbacks. Completion fences require the adopted working revision, allowing only the exact verified own next-document ACK. Consumed handles are cleared immediately, and identity refusal cannot strand later recapture. Successful sessions release capture/receipt metadata; failure-signal reactions cannot retain completed session closures.

Real project-only editor coverage restarts the worker/client, independently inspects old attempts, explicitly bootstraps actual current records, attaches the existing hook under a queue recovery hold, then releases and explicitly flushes. Undo/Redo and editor/history identity survive; metadata-separated clocks do not reset. This does **not** implement `workspaceCommandAdmission`'s recovery constructor, workspace outcome reconciliation, stable lifecycle-registration adoption or deferred producer release. That constructor still refuses rather than granting unverified editing authority.

Read-only reviewer `ses_f07b67aa3ffedHwIYvoCWRBB1H` rechecked receipt ancestry, missing-intent/notification/liveness fences, settled metadata ownership and consumed-handle recapture. Every actionable correction received a reproducing regression; final scoped review is clear for the readmission core, not whole B. The cavecrew invocation failed before work because its configured model was unavailable; the permitted read-only general reviewer was used instead. No implementation was delegated.

Receipts under `/tmp/opencode/doctect-incremental-sdd`:

- `task-13-workspace-lifecycle-readmission-workspace-regression-01.jsonl`: **548PASS/1timeout/549cases/9files**. Failure: `rejects a rehashed import descriptor with false targetProjectId`,5068ms at unchanged5000ms.
- `task-13-workspace-lifecycle-readmission-editor-regression-01.jsonl`: **650PASS/2timeouts/652cases/8files**. Failures: `independently verifies atomic node/template/variant/extension membership + source put at every write ordinal`,5024ms, and corresponding `delete`,5003ms, both unchanged5000ms. All62save-hook and223editor-behavior cases pass.
- `task-13-workspace-lifecycle-readmission-boundary-01.jsonl`: **952PASS/1file**. Two new capability regressions grant only the bridge's contracts/queue/registry dependencies and exact hook/admission callers; production and unreviewed helper edges remain denied.
- Those three disjoint complete batches cover **2153cases/18files:2150PASS/3timeouts**,0missing/skipped/retries/module/unhandled failures. Queue189,store70,hook62,real-editor20 all pass. `...readmission-regression-01.jsonl` is an earlier incomplete all-in-one attempt terminated by the600000ms shell limit, with no terminal reporter event; it is excluded from acceptance rather than combined with later results.
- Diagnostic-only, fixed one-run-per-version comparison of precisely the three failing cases: `...readmission-timeout-baseline-01.jsonl` and `...readmission-timeout-current-01.jsonl` both **3PASS/107skipped**. Baseline/current timings: targetProjectId2441/2532ms,put3946/3954ms,delete3358/3213ms. The read-only overlay uses the immutable immediate baseline; source files and5000ms deadlines remain unchanged. No timing cause/fix, speedup or replacement of the broad failures is established.
- `...readmission-latest-core-green-01.jsonl`:340PASS before the final recapture regression; `...readmission-consumed-red-01.jsonl` then `...readmission-consumed-green-01.jsonl`: intended consumed-handle failure then62hookPASS. Earlier receipts are retained rather than combined as a fictional single larger run.
- GC regression initially retained its own checkpoint through a fixture-created resolver closure. The resolver was isolated, then the corrected test was run against the pre-fix memory implementations in `...readmission-compaction-corrected-red-01.jsonl` and failed as intended. Corrected runtime passes that test while the same hook and queue remain alive. Earlier diagnostic failures remain preserved; this is Node GC evidence for targeted ownership, not native-browser heap acceptance.
- `task-13-workspace-lifecycle-readmission-build-01`: **buildPASS11.46s/2468modules**, existing output/chunk warnings only. Real private worker edge also builds in the96worker suite. Final`tsc` reports only established StickerPressTS2339 at793:36; no new suppression.
- `audit-workspace-lifecycle-readmission.mjs` preserves previous audits and checks exact10/30paths, complete raw coverage, the incomplete process receipt, diagnostic-only scope, source stamp, protected sibling hashes, HEAD/empty index/whitespace and productionv2/refused lifecycle recovery. Four external checker tests cover missing/duplicate/retried/skipped/module-error/deadline/worker-count evidence. Audit success means evidence/scope consistency; it reports `fullVerificationPassed:false`.

Final scope/evidence review by the same read-only reviewer is clear for the exact boundary grants, plan, external checker and `task-13-workspace-lifecycle-readmission-checkpoint-01.json`. It explicitly retains2150/3, excludes the1283-result incomplete receipt and keeps diagnostic passes separate. Protected launcher2397595 remains alive on3000/3001;4310/4311/4320/4321 remain unused. HEAD, empty index, whitespace and protected sibling hashes are intact.

Current source stamp: **c2453a32894175b21585c59eff80266b117c1e78cf455dbcd7090f065c96371f/1181files**. Remaining: real lifecycle restart/readmission integration, three unclassified broad storage timing failures, receipt-window/full fault coverage, fresh complete migration campaign and isolated native lifecycle/quota gates. Earlier cuts UI timeout and pre-B649/11migration result remain intact. No commit, dependency change, profile migration, C/D implementation or production switch. Approval continues; the next feature step is lifecycle recovery composition, not another broad planning approval.

### Normal Lifecycle Admission Checkpoint — 2026-09-30 (prior to readmission core)

Immediate snapshot `task-13-workspace-lifecycle-admission-baseline` captured before this slice from cuts stamp5dd15abe…. Exact19paths including this plan changed, plus the separate untracked ledger; original B slice now29paths. New runtime modules: `workspaceCommandAdmission.ts` and `projectInstallationRegistry.ts`. New tests cover the owner and registry. Existing public contracts/dispatcher, queue, editor binding/hook/component, protocol correlation and catalog validation were extended only at reviewed private seams. Repository, coordinator, Work/SHA/JSON runtimes, physical stores, database version and production bootstrap remain unchanged in this slice.

The new `workspace-lifecycle` family has its own correlated result type. Snapshot-only production dispatch refuses it before payload access. All eight intents now flow through the private owner and real existing worker/repository. Incoming batches retain their native-detached input before cancellable weighing; capture schedulers close on success, cancellation and unknown outcomes without erasing retained input. Posted identity/preconditions never rebase. Ordered entry-owned retirement, generation-bounded producer gating and FIFO release preserve edits before/between/after cuts; queue reservation must finish before opening the later-producer gate. Unrecognized prolonged busy handles fail closed instead of spinning microtasks.

Catalog candidates validate/diff/apply cooperatively and publish by guarded pointer replacement. Captured source/installation facts are checked after resolver callbacks, with private registry revocation proving replacement/removal without invoking another callback. Publication watches only participating registrations; delayed React cleanup of already-closed/excluded editors cannot abort unrelated survivor work. Current-owner inspection independently verifies the original attempted command, publishes once, and never automatically replays or resumes a frozen queue. The retained handle remains opaque and keeps both unresolved input and queue quiescence; lifecycle disposal does not terminate the shared client.

Real private React composition now covers activation away/back with identical editor/history owner; document/preferences/metadata draining before close; immediate target Undo refusal; close during preparation or document delivery; empty-queue handoff failure retaining unsaved content/history; newer survivor typing held behind close; and lost close acknowledgement followed by current inspection without replay/remount. Create and consume material use real normalized records and explicit project bootstrap, not decomposition of a public wrapper. These tests do not wire production `EditorPage` or claim native-browser acceptance.

Review `ses_f0abc8c7bffeFWM92QlAUT0kLB` found and rechecked input-retention/scheduler cleanup, stale source publication, per-entry retirement, gate-opening order, cross-target source checks and delayed-cleanup races. All actionable findings received explicit RED regressions before correction. Final scoped recheck is clear for normal lifecycle/capture/current-owner inspection; recovery construction is excluded and deliberately unsupported. Design review `ses_f0aeb5d5affef47JK4RRc8vIH6` confirmed the narrow async/producer/hold seams and the remaining verified write-owner readmission gap; the concrete protocol above is the next implementation target.

Receipts under `/tmp/opencode/doctect-incremental-sdd`:

- `task-13-workspace-lifecycle-admission-regression-01.jsonl`: **1947PASS/15files**,0skipped/retries/module/unhandled failures. Includes950boundary,223editor-behavior,30owner,3registry,179queue,64store-command,96worker,40save-hook,17real editor integration,24catalog,27command,131historical migration-preparation,75historical commit,79validation and9import cases. All eight owner intents are exercised against actual normalized transactions.
- After that run, two real editor scenarios were added without runtime changes: `task-13-workspace-lifecycle-admission-editor-final-01.jsonl`: **19PASS**, including survivor typing across a held close and lost-close inspection with unsaved survivor content/history retained. Counts are not added together as if one1949-case run occurred.
- `task-13-workspace-lifecycle-admission-build-01`: **buildPASS13.00s/2468modules**, existing external-output/chunk warnings only. Real private Vite worker edge also builds in worker tests. Final `tsc`: only known StickerPressTS2339 at793:36.
- Intermediate RED/fix receipts retained under`...admission-{dispatch,hold,owner,busy,order,review,survivor,sources,registry,replacement}*`. Fixture-only mistakes were corrected without weakening old data/assertions/deadlines: non-header incarnation comes from physical key[2], and template edits may legitimately use `structural-command` rather than `document-batch`. Ownership instrumentation adds test-only exports to actual source and uses the same bundled registry realm, never production debug exports or a synthetic success writer.
- `audit-workspace-lifecycle-admission.mjs` verifies both immediate and original B baselines, exact paths, raw inventories/results, old1721/1failure retention, HEAD/empty index/whitespace and protected sibling hashes. It reports normal private lifecycle connected, verified write-owner readmission false, full migration rerun false. Current stamp **569d5a168ebc1f14a6a2fba7615ae5d7a44f53031c80c102eca13be596fd7938/1180files**.

Remaining gates: authenticated hook/queue readmission and restart recovery; workspace receipt count/byte eviction and expanded fault coverage; final complete migration campaign; isolated native lifecycle/quota evidence and release boundary. Earlier UI timeout is retained and unattributed, not erased by the latest pass. No commit, dependency update, existing-profile migration, C/D behavior or production switch. Execution approval continues; implement the readmission protocol rather than asking for another broad planning approval.

### Queue/Editor Protection Checkpoint — 2026-09-30 (prior to lifecycle admission)

Immediate immutable baseline: `task-13-workspace-lifecycle-cuts-baseline`, captured from worker stamp52904fff… before changes. Six runtime files changed: `incrementalQueue.ts`, `incrementalCommandAdmission.ts`, `document/contracts.ts`, `useDocumentEditor.ts`, `useIncrementalProjectWrites.ts`, and private incremental composition in `ProjectEditor.tsx`. Five test files changed. No repository, worker/client/protocol, Work/hash implementation, deadline, dependency, production dispatcher or production bootstrap edit in this slice.

`workspaceBarrier` assigns ordered segment/cut numbers, seals pre-cut work, drains only captured obligations, retains later surviving-project segments, and supports ordered multiple cuts. Existing `barrier` still rejects later enqueue and mixed modes refuse overlap. Target scopes retire synchronously; prior work can still drain. Cut stamps come from verified queue acknowledgements, including the conservative preference lower bound, never an arbitrary refreshed header. Failure freezes retained survivors and explicitly rejects unrun cut promises. Active preparation and command callbacks participate in quiescence.

Editor bindings pin optional function identities. A separate editable guard covers every mutation, including after caller preparation and immediately before index/history publication; attachment-only delivery remains available for earlier effects. Bounded `drainEffects` leaves newer effects queued. Source-stable component drain registration uses the existing committed callback ref and returns explicit persistence-cut completion rather than treating `void` delivery as success. Normal callback rerenders do not replace the drain registration/history owner.

The save hook tracks unresolved editor handoffs, contiguous completion and one conservative gap/failure boundary, without keeping a lifetime payload/event log. Cuts include both document and paired preference obligations, older admitted metadata, and early failures/missing generations. Required but suppressed preferences cannot count as saved. Existing document update return semantics remain unchanged. A cut captures finite promises before the caller seals its queue barrier and does not itself flush or wait on future typing; later failures cannot rewrite earlier captured evidence. Attachment/lifetime is rechecked after completion-time resolver callbacks. Incremental admission exposes its existing queue and barrier, forwarding verified events to the private lifecycle observer before passive observers.

Added65cases:32queue,17editor guard/drain,13save-hook handoff,1shared-admission ordering and2real private persistence-cut compositions. Initial intended REDs and all later correction REDs are retained. Read-only reviewer `ses_f0b894569ffey4RU02ZuTY02Kw` exposed admission, dispatch, acknowledgement, cross-target and hook-detachment reentry gaps. Corrections reserve dispatch before resolver/UUID callbacks; fence publication after reentry; preserve exact pending/active ownership; and use final callback-free target validation. A controller-found target-resolution reentry case also proves newly accepted work cannot be overwritten by a cut. Final scoped recheck found no remaining actionable issue in Task5 primitives, explicitly excluding Task6 orchestration.

Verification/evidence under `/tmp/opencode/doctect-incremental-sdd`:

- `task-13-workspace-lifecycle-cuts-final-fence-green-01.jsonl`:**290PASS/4files** (176queue,62store-command,40save-hook,12real private editor),0unhandled/module failures. Earlier full editor run `...cuts-editor-01.jsonl`:222PASS.
- `task-13-workspace-lifecycle-cuts-regression-01.jsonl`:**1721PASS/1timeout/1722cases/14files**,0skipped/retries/module/unhandled failures. Includes947boundary checks,96worker checks and167document-model checks. Failure: `real ProjectEditor incremental boundary > I4-R3 'click' focus-box 'click' before/after first checkpoint=false retains inline ownership`,5277ms at unchanged5000ms body deadline. This is not a green broad gate and is not classified as an established predecessor failure.
- Diagnostic-only fixed baseline→current comparison of exactly that case: `...cuts-ui-baseline-02.jsonl` PASS2470ms using immutable pre-cut source; `...cuts-ui-current-01.jsonl` PASS2438ms using current source. One valid run per version, same5000ms deadline. Neither reproduced the full-run timeout; root cause remains unclassified. No speedup claim, fixture/deadline change, retry-until-green or replacement of the broad failure. The first baseline diagnostic receipt01 is retained as a tooling error: the overlay incorrectly intercepted a`?url`fixture, then was corrected to leave queried assets to Vite before any baseline case executed.
- `task-13-workspace-lifecycle-cuts-build-01`:**buildPASS14.60s/2468modules**, existing external-output/chunk warnings only. Actual private Vite worker-edge build passes in the96worker tests. Final `tsc` reports only established StickerPressTS2339 at793:36; no new diagnostic/suppression.
- `audit-workspace-lifecycle-cuts.mjs` checks both original B and immediate cuts baselines, exact paths, complete raw coverage, the specific retained full-run failure, diagnostic scope/deadlines, HEAD/empty index/whitespace and protected sibling hashes. Its audit success means scope/evidence consistency, not test acceptance; it reports `fullVerificationPassed:false`. Current source stamp **5dd15abe7cce7041550358987fcbfba9e73fabc372c8226469f7e7e12bf07a10/1176files**.

Task6 is still absent: no new public lifecycle dispatcher family, private lifecycle orchestrator, catalog publication/recovery owner or actual editor-close wiring yet. Full workspace receipt-eviction/fault coverage, broad UI timing gate, final migration campaign and isolated native lifecycle evidence remain open. Protected launcher2397595 remains alive, no owned test/benchmark remains and4310/4311/4320/4321 listeners are absent. No commits, live migration, dependency changes or production cutover. Approval continues for remaining inline work; do not repeat a planning approval merely because this checkpoint is incomplete.

### Worker Execution Checkpoint — 2026-09-30 (prior to queue/editor protection)

Fresh immediate snapshot: `task-13-workspace-lifecycle-worker-baseline`, captured from reviewed backend stamp4511e42c… before this slice. Two runtime files changed: `workspaceWorkerProtocol.ts` and `normalized/coordinator.ts`. The client implementation and its30-second timeout, production dispatcher/bootstrap, queue runtime, editor and hooks remain unchanged. One old queue test now discriminates project batch tags explicitly because the wire union also contains workspace batches; its assertions and behavior are unchanged. The boundary allowlist adds only the coordinator→workspaceCommands runtime edge.

The four protocol-v1 workspace request families now use numeric request-derived admission IDs and the existing project FIFO. Repository tokens/fences never cross the wire. Rebootstrap invalidates earlier workspace write admission; failed attempts can still use their original authentic fence for inspection. A fresh admission or restarted worker cannot manufacture absence proof. Coordinator retains at most32old-owner capability records; missing/evicted ownership cannot grant a fence. Disposal synchronously fences installed workspace capabilities and never acknowledges an incomplete queued fence. All eight lifecycle intents use the real writer; new project records require explicit ordinary project bootstrap before editing.

Transport framing checks own-data fields, private IDs, safe counters, target shape, exact generation/admission/request/epoch, command identity, before/after stamps and outcome. Bulk result cardinality is bounded to the actual B contract; occupied slots must hold plain objects, created-project authorities start at zero, and material record scope must match. Unbounded catalog/descriptor contents and document record maps remain opaque here; cooperative catalog validation/publication remains Task6, not a transport-thread traversal. Expanded-year canonical timestamps retain existing24/27-character compatibility.

Tests added:41worker cases, including all eight real command outcomes, both FIFO directions, metadata-only admission, explicit project bootstrap, malformed framing/result refusals, original-owner fencing, restart/lost-ack inspection, later workspace/project supersession, timeout and disposal. Five additional real repository cases cover stale closes after remote document/preferences/structural changes, close winning over a preparing remote save, and concurrent workspace commands sharing a before-stamp. These passed without backend runtime changes.

Read-only review `ses_f0bfd1bf5ffeJzHi1Evi53T71T` found two protocol edge cases: `[undefined]` passing occupied result cardinality, and rejecting valid expanded-year replacement timestamps. Four regression REDs reproduced them across command/inspection; fixes passed and scoped re-review found no remaining actionable findings. This review does not close Tasks5–6 or broader acceptance gates.

Receipts under `/tmp/opencode/doctect-incremental-sdd`:

- `task-13-workspace-lifecycle-races-01.jsonl`:5selected repository casesPASS.
- `task-13-workspace-lifecycle-worker-red-01.jsonl` retained: first real fixture setup lacked fake-IDB browser globals. Adding the same `fake-indexeddb/auto` setup used by transaction tests fixed setup, then `...worker-red-02.jsonl` showed15intended missing-family failures. Further `...worker-red-03/04.jsonl` cover unexpected/wrong project material; `...worker-review-red-01.jsonl`→`...worker-review-green-01.jsonl` records the four review regressions.
- `task-13-workspace-lifecycle-worker-regression-01.jsonl`:289PASS/3files before review corrections.
- `task-13-workspace-lifecycle-worker-regression-02.jsonl`:**1338PASS/7files**,0skipped/retries/module/unhandled failures:96worker,53transaction,144queue,61store-command,10private editor,27save-hook and947boundary cases. This verifies existing editor integration, not the unimplemented B lifecycle editor wiring.
- A subsequent test-only captured-const correction preserves TypeScript narrowing inside a negative assertion callback; `task-13-workspace-lifecycle-worker-final-01.jsonl`:**96PASS**, including the real Vite client→module-worker build. No runtime change followed the1338-case run.
- `task-13-workspace-lifecycle-worker-build-01`:**buildPASS12.77s/2468modules**, only existing external-output/chunk-size warnings. Final `tsc` reports only known StickerPressTS2339 at793:36; new union/callback diagnostics fixed, no suppression added.
- Boundary first run `...worker-boundary-red-01.jsonl` retained, including expected missing exact-edge/Map.clear policy failures and external180-second runner cutoff. Map cleanup restored existing per-key deletion style, exact edge granted. Full947PASS in `...worker-boundary-01.jsonl` and again in regression02. No Vitest deadline/fixture was widened.
- `audit-workspace-lifecycle-worker.mjs` checks both immediate worker and original B execution baselines, exact allowed paths, raw receipts, HEAD/empty index/whitespace and protected sibling hashes. Earlier backend-only checker remains frozen as historical tooling. Current stamp: **52904fff8de5b0510159d8bcb024e8b5748ef8f1f817fb3bb64a4606d27ac612/1176files**.

Remaining: workspace receipt-eviction/full fault coverage, retaining queue cuts, finite both-lane editor handoff and immediate retirement, private admission/catalog publication, final full migration campaign and isolated native lifecycle evidence. Task5 queue interfaces have been inspected; no Task5–6 implementation yet. Production remainsv2 and no commits, dependencies, profile migration or cutover occurred. Execution approval continues; next connected work is queue/editor protection, not another planning approval.

### Backend Execution Checkpoint — 2026-09-30 (prior to worker integration)

Runtime scope so far: `normalized/workspaceCommands.ts`, `workspaceCatalog.ts`, and `normalized/repository.ts` only. The repository now has real `admitWorkspace`, `commitWorkspace`, `fenceWorkspace` and `inspectWorkspaceAttempt`; pure preparation covers all eight intents. `CapturedWorkspaceCommand.initial` is the independently captured active marker's source revision/initial workspace digest, not caller-supplied authority. The existing default read paths and productionv2 entrypoint remain.

Create/close/preset/import transactions use point/prefix captures, exact transaction seals, one atomic affected-row/manifest mutation and independent readback. Write-list traversal is prepared outside the transaction; seal byte counters measure actual framed comparison bytes rather than raw capture weights. Retirement/cache invalidation occurs from guaranteed durable completion before a later lifecycle guard can reject. Same-owner current duplicate results use one retained before-catalog metadata projection solely to rebuild the reply delta, never to skip fresh readback or authorize storage. Restart inspection returns independently verified current catalog evidence rather than guessing an old delta.

Test-first evidence:26initial metadata/admission REDs; real activation RED;17capture/preparation REDs; two independent-postcondition REDs; nine initial real-transaction REDs; regression REDs for loop cancellation, physical incarnation mismatch, failed-attempt identity, shared pending targets, consumed-header liveness, invalid-payload hash normalization, restart input detachment, typed inspection conflicts and durable-completion retirement. All current selected backend tests pass.

Read-only reviews `ses_f0c9e0971ffet4ZcfW5MJcCH3Y` and `ses_f0c561c91ffeErkMt6uNHo3UR7` found and rechecked corrections. Catalog loops now charge every removal-ID/uniqueness iteration. Private admission retains same-capture manifest metadata. New stage/replace reservations reject competing pending targets, while consumption preserves historically admitted collisions. Invalid JSON cannot normalize into a changed retry's digest; failed IDs remain reserved when a digest could not be established. Inspection captures input before asynchronous admission and distinguishes deterministic conflicts from unavailable storage. The final scoped backend recheck has no actionable findings; this is not worker/editor/native acceptance.

Verification receipts under `/tmp/opencode/doctect-incremental-sdd`:

- `task-13-workspace-lifecycle-regression-02.jsonl`: **458PASS/9files**,0unhandled/module failures. Includes48real transaction cases, all12create-put and11close-delete ordinals,27command cases,24catalog cases and existing codec/repository/authority/birth/receipt suites.
- Prior `...regression-01.jsonl` retained:457PASS/1new historical-collision test timeout. That new test unnecessarily built its historical fixture inside the test and also received an unused default fixture. Setup moved to its own `beforeAll`, retaining the same historical records, real normalization, assertions and default5000ms body deadline; complete rerun02passes. No old fixture/deadline or workload was reduced.
- `task-13-workspace-lifecycle-boundary-01.jsonl`: **947PASS**, exact module grants only.
- `task-13-workspace-lifecycle-backend-build-01`: **buildPASS15.92s/2468modules**, existing size warnings only.
- Typecheck: only established `tests/unit/gallerySamples/stickerPress.test.ts(793,36)` TS2339; no new diagnostic.
- `audit-workspace-lifecycle-backend.mjs`: exact nine-path slice against fresh execution baseline, HEAD/empty index/whitespace/protected sibling hashes intact. Current source stamp **4511e42cad3e7f987c7953daaf90d9be8b276acf28e503725550ef2b5acc0a67/1176files**.

The previous complete migration649/11campaign belongs to the pre-B stamp; it has not been rerun on this backend slice. Expanded command race/proof-eviction coverage and final full migration/native acceptance remain open alongside Tasks4–6. No worker/UI connection, dependency update, commit, existing-profile migration or production switch occurred. Execution approval remains in place; the next connected slice is worker protocol plus queue/editor integration, not another planning approval.

### Planning Verification Checkpoint

Self-review maps every B requirement to the seven tasks and preserves C/D exclusions. Independent review `ses_f0f498c20ffeLl6xdDzMH6vqI4` identified four planning gaps: delivery without successful persistence handoff, digest binding before cooperative hashing could finish, uncharged catalog diff/application, and a stale-incarnation test without prior writable admission. The plan now specifies finite both-lane persistence cuts, pre-hash reservations included in fencing, cooperative catalog candidate construction with synchronous guarded publication, and an actual admitted successful write before close/recreate. Created material carries real normalized records including private birth fields for the existing project bootstrap. Re-review found no actionable issue and judged the plan ready for user execution approval, not implementation acceptance.

External `check-workspace-lifecycle-plan{,.test}.mjs` passed five tests after intended missing-checker REDs. It validates7unexecuted tasks/29steps, parses12TypeScript examples across18fenced blocks, checks numeric wire admission IDs and promise-valued persistence-cut evidence, and rejects negative mutations removing critical requirements. This is syntax/declared-contract/document verification, not compilation or runtime verification of the proposed modules.

Application/test/config stamp remainsb7acaf92b38f389bf338b6ff2b79987769532b93d680bc880ea9cfcc1c920b5d/1170. Planning audit compares the immediate `task-13-workspace-lifecycle-planning-baseline`, allows only this new plan and the two predecessor/spec links (ledger separately retained), and verifies HEAD/empty index/whitespace/protected sibling hashes. All execution boxes remain unchecked. No B module, protocol, queue, hook, editor, dependency or configuration change has been made.

Final planning verification:18external timeout/reporter/campaign/document testsPASS; raw campaign reconstruction again confirms649/11,37complete batches, no duplicate/missing/retried/non-timeout/module/unhandled outcomes and unchanged stamp. Exact planning scope is the three documented paths plus ledger. No owned test/benchmark remains; protected launcher2397595alive (not a health check),4310/4311/4320/4321 listeners absent. No application build/native run was repeated for documentation-only planning; the prior same-stamp build remains historical evidence. Ready for user execution approval, not code or release acceptance.
