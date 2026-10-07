# Workspace Authority Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. The user selected inline controller implementation, not implementation subagents or handoffs. Read-only investigation/review is permitted. Steps use checkbox (`- [ ]`) syntax for tracking. Do not stage or commit.

**Goal:** Establish an independently verified current-workspace manifest, atomic activation and manifest-driven reopen without adding whole-workspace work to ordinary project saves.

**Architecture:** Keep the existing normalized repository as the sole transaction owner. Add private pure/work-driven modules for manifest metadata, bounded workspace receipts and independent project birth baselines; install the initial manifest with the active marker in one sealed transaction. Reopen validates retained migration ancestry separately from current membership and returns manifest metadata with the existing coupled snapshot.

**Tech Stack:** TypeScript, native IndexedDB, existing cooperative Work/SHA runtime, Vitest 4, fake-indexeddb 6, Vite 6. No new dependency.

## Global Constraints

- Approved spec: `docs/superpowers/specs/2026-09-26-normalized-workspace-authority-design.md`, approved 2026-09-26. Original incremental/fold/normalization specifications remain binding.
- Worktree: `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence`; branch `feat/incremental-local-persistence`; HEAD `8a2872d9a5acae1be3022923c4c515c70212de83` must remain unchanged.
- Production `WORKSPACE_DB_VERSION` remains 2. Private physical schema remains v3 with the existing fourteen stores. No new physical store or production entrypoint.
- No commits, staging, merges, dependency changes, source/sibling-worktree edits, existing-profile migration, or destructive cleanup. Preserve the intentionally dirty tree and empty index.
- Preserve protected launcher PID2397595 and ports3000/3001. Do not restart stopped4310/4311 preview or modify its SQLite data. Browser experiments require fresh disposable contexts and separately verified alternate ports.
- Ordinary document/preference/metadata saves must not read/write the manifest, reconstruct unrelated projects, transfer whole projects, or consult historical/ancillary payloads.
- One worker owns normalized writes. No historical/normalized mixed writer, fallback editing, automatic merge, generation switch or garbage collection.
- State limit32MiB, depth512, history50. External IDs remain nonempty strings; private command identities are at most256UTF8bytes.
- Cooperative quantum1024visits/64KiB emitted bytes; JSON fragments64UTF16units/max192UTF8bytes; SHA step<=192bytes/600visits; count-only quoted scans127units. Charge all work and ownership.
- Migration staging<=64records/256KiB except one valid oversized singleton. Independent source/target capture and final quiet exact seal remain mandatory.
- No asynchronous hashing, yield or passive observer inside IDB transactions; only the approved synchronous exact single-record seal exception.
- Migration success budgets<=8full-set reads/<=4source and target derivations; legacy captures<=5uncontended/2active. Current targetDerivations5-vs4 remains a known blocker, not an allowance of5.
- Proof windows<=32entries/64KiB; retries<=8. Do not relax deadlines, fixtures, assertions or budgets.
- Focused tests during development; connected gates with at most2workers. Known unrelated typecheck error: `tests/unit/gallerySamples/stickerPress.test.ts(793,36): TS2339 Property 'length' does not exist on type 'never'`.
- Original Task11b81-file baseline and47-path allowlist remain immutable. Extend audit scope explicitly; `.superpowers/sdd/progress.md` is untracked and must never be staged.

---

## Execution checkpoint — 2026-09-26

User authorized inline execution. Foundation implementation is present; full acceptance remains open. Task-level status below records actual work, while the detailed task recipes remain available for verification follow-through.

- [x] Task1 manifest/receipt primitives, strict metadata checks, bounded proof windows, cooperative identity comparisons and ownership.
- [x] Task2 independent workspace-born image/document/preference/raw-fold baselines; private origin validation in codec/lineage, no generic null-proof relaxation.
- [x] Task3 behavior-preserving fixture extraction, stored workspace union and checked historical-writer refusal. The v2 tagged-row overwrite regression was RED then GREEN; private v3 prerequisite writer was already unavailable and was not used as a false-positive oracle.
- [x] Task4 marker/manifest activation in one sealed transaction, independent initial reopen, before/after-write rollback and lost-ack tests. Marker verification frame is `normalization-verification-v2`.
- [x] Task5 current-manifest membership and birth validation, current acceptance independent from source origin, retained/current export separation, complete ancillary descriptor verification and ordinary-write isolation.
- [ ] Task6 acceptance. Complete boundary and migration case inventories/results are now available (follow-up below); normalization derivation/runtime gates still fail. No lifecycle or production cutover follows from coverage alone.

### Per-case verification follow-up — 2026-09-26

This supersedes the earlier missing-result status, not the original limits or release restrictions.

- External `/tmp/opencode/foundation-case-reporter.mjs` writes each collected/start/result/end event immediately. Reporter/selection/coverage helpers have four passing Node tests. `/tmp/opencode/foundation-batch-runner.mjs` runs exact-name groups in fresh Vitest processes, one worker, with unchanged test deadlines; stress cases are isolated. Runtime/test source hashes are checked before/after each campaign. No application test config or fixture is changed by this tooling.
- Initial covering migration campaign accounted for every one of641 cases with no missing results or unhandled errors:589 passed,43 timed out,9 assertion failures. Source stamp `710c50a57368c9f663c308debb4f2a9b25f1dde49698082ef5ab726a70b21a1f` covers1165 runtime/test/config files. The aggregate is a covering set of runs, not one all-green run. Exact case evidence and campaign paths: `/tmp/opencode/doctect-incremental-sdd/task-13-covering-baseline.json`.
- One assertion exposed a real recovery bug: retained-source export wrongly required the target verification digest to match. `derive(..., 'retained')` now skips only that target-readiness equality; source/archive identity/digests, marker shape and final source seal remain enforced. Activation and active reopen still verify target proof. A new active-marker regression was RED then GREEN and proves no editing authority or marker rewrite; the existing corrupted verified-marker case also passes.
- Seven assertions expected obsolete generic `Source changed` text. Six malformed-envelope cases now assert their specific independent-preparation refusal and keep exact no-write/no-marker assertions. Six additional valid same-revision mutation cases prove valid changed sources cannot reuse stale reservation input, with unchanged project/workspace/ledger counters and exact storage preservation. The reserved ancillary-change case asserts the existing `Normalization live source mismatch` and additionally checks all source/marker records unchanged. These14 targeted migration cases pass; collection now647 cases. No production error was reclassified merely to satisfy a test.
- Isolated reruns of the42 short-timeout cases:16 passed and26 still timed out at5000ms. Source stamp `05e6291ebc06cdc3ac58fe37943614d589b0240f6ddcc647e3ef5bfc2f309244`; evidence `/tmp/opencode/doctect-incremental-sdd/task-13-migration-cases-0-647-nCLit4/summary.json`. Original32MiB case definitively timed out at360000ms in its isolated baseline run; it was not rerun after the retained-only fix. The derivation assertion was rechecked after the fix and remains5 versus4. These remain failed gates, not accepted timeouts.
- Full boundary940/940 passed twice. Final post-fix run took221.8s, no unhandled errors, original5000ms default and all per-test overrides unchanged. Its prior120s shell cutoff had prevented aggregate completion, not demonstrated a boundary failure. Final log: `/tmp/opencode/doctect-incremental-sdd/task-13-boundary-stream-02.jsonl`.
- Final connected511 tests/11 files PASS160.53s with one worker. An earlier two-worker run passed509/511 with two5000ms descriptor-case timeouts; no fixture/timeout changes were used for the successful serial run. Build `task-13-workspace-foundation-build-02` PASS18.02s/2468modules; typecheck still only known Sticker Press TS2339.
- Scoped read-only reviewer found no issues in the retained-only change or strengthened source mutation coverage; independently ran17 focused tests with one worker. No independent full performance acceptance is claimed.
- Final evidence index: `/tmp/opencode/doctect-incremental-sdd/task-13-covering-followup.json`. Baseline coverage and post-fix subsets have different source stamps; do not sum their pass counts into a purported single current gate. An exploratory `--bail=1` run was interrupted with cancellation errors and is excluded from result evidence; only its collected names seeded the independently checked subsequent inventory.

Remaining runtime diagnosis: `/tmp/opencode/doctect-incremental-sdd/task-13-timing-cpu-01/` profiles the80-template observer/hash test at its original5000ms deadline. Diagnostic sampling adds overhead and is not acceptance. Test-dominant sampled work centers on cooperative dispatch/guards, canonical traversal/sorting/UTF8 work and repeated source/target validation; SHA implementation self time is small (~41ms). Inclusive stack times overlap and cannot be summed, and reporter wall time cannot be exactly aligned with V8 monotonic samples. This does not establish which validation pass is redundant. No traversal/guard/accounting removal, budget change or unapproved emission redesign was applied.

Approved optimization amendment after code tracing: `../specs/2026-09-26-normalization-emission-work-design.md` separates source-only retained reads from unused target derivation and makes staging replay preparation-owned projection recipes instead of re-running validation/partition/size-ledger derivation. Written amendment approved on2026-09-26 and concrete inline execution on2026-09-27. Independent prefix/verify/activate/reopen and all budgets remain binding.

Concrete follow-up: `2026-09-27-normalization-emission-work.md` defines six test-first tasks, exact private interfaces/file scope and the original acceptance commands. Inline execution approved2026-09-27; this foundation's remaining runtime/derivation gate is not marked complete by approval.

Latest emission implementation supersedes the five-derivation status: four actual target derivations now pass with independent producer observations; stage replay performs zero semantic derivations. Current migration covering set659=632PASS/27timeouts, with original32MiB still timing out360s. Connected672, historical331 and boundary945 pass in separate commands; build passes. Full details/source stamp/artifacts are in the emission plan. Foundation acceptance and lifecycle B/C/D remain open; no production cutover.

Evidence:

- Connected510 tests/11 files PASS67.96s, including100 new tests in four foundation suites. Tests cover source-member closure/recreation, initial lane corruption with valid sizes, receipt eviction, raw folds, historical import compatibility, all manifest activation write-fault points, lost acknowledgement, stale admitted writes and zero ordinary manifest/ancillary operations.
- Production build `task-13-workspace-foundation-build-01` PASS11.86s/2468modules. No production store/version/entrypoint switch. Typecheck has only known Sticker Press TS2339.
- Scoped boundary6 PASS16.32s, including three new pure-helper restrictions. Explicit filename edges only; no new writer/global capability allowance. Full940-case boundary command hit120s shell limit without final result.
- Initial fixture-extraction26 migration cases PASS51.29s. Historical bootstrap/commit/repair plus tagged-row checks254 PASS6.93s. Later focused source/cutover/handoff/native-source checks6 PASS16.56s. Counts overlap; do not sum into a claimed single gate.
- Full641-case migration command hit1200s shell limit without final summary. Retained output: `/home/anoop/.local/share/opencode/tool-output/tool_0e036724a001UiH6c9SJ2DW9hn`. No current32MiB acceptance result can be inferred. A focused invocation still proves targetDerivations5 versus required4; a later focused archive recovery case still timed out at its unchanged5s limit.
- Read-only reviews found and closed: historical import collision/provenance over-validation, birth metadata getter execution, missing temporary-buffer ownership/long-ID charges, a360-byte reservation leak on immediate guard cancellation, incomplete import-descriptor checking, and unused malformed backup blocking retained export. Reviewer independently verified16 targeted cases and six source-seal fault/cancellation probes; this is scoped evidence, not full acceptance.
- Audit `/tmp/opencode/doctect-incremental-sdd/audit-workspace-foundation.mjs`:84 authorized changed paths,51-of81 prior blobs retained; original baseline/list, HEAD, empty index and protected hashes intact. No owned Vitest/Chromium processes remained after timed-out commands.

Compatibility clarifications proven by tests against the existing historical validator: ID-only and ID+timestamp consume provenance remain valid; historically admitted pending imports may share targets, overlap consumed IDs, or retain an older attempt digest. Manifest admission preserves these values, records a separate actual body digest, and verifies descriptor equality to the stored row. Future command-time collision/provenance CAS remains strict. No source is rewritten to make admission pass.

Retained-source backup seal now point-reads exactly the independently validated archive and its referenced backups in the same readonly transaction as all other retained-source dependencies. Active/write seals remain complete; a partial backup seal explicitly refuses write callbacks. Unused later BigInt/cyclic backups cannot poison historical export, but still refuse active editing. This changes only retained-source dependency selection, not source/target write authority.

Test maintenance preserves fixtures/assertions/limits: immutable historical workspace is compared against `archive.workspace` after activation and live manifest checked separately; ancillary layout fixtures also seed their manifest receipts/descriptors. The canonical cutover equality and byte-preservation consumers are separate cases under the previously approved scenario-split rule. A stale handoff test that spied on now-unused `readNormalizationSource` observes actual completed capture pages instead; ownership assertion remains unchanged. No budget or test timeout was increased.

## Scope and milestone sequence

This is **Milestone A**, not a plan to ship the whole feature. It produces a testable private authority foundation. The later milestones depend on the interfaces below and must receive detailed plans before their code changes:

| Milestone | Deliverable | Dependency / explicit exclusion from A |
| --- | --- | --- |
| A: this plan | Manifest/schema, receipt validation, project births, atomic activation, current-member reopen, unchanged ordinary-save cost | No live workspace command writer or React hookup |
| B: [workspace lifecycle plan](2026-09-29-workspace-lifecycle.md) | Actual create/activate/close, preset/import transactions; queue cuts; worker inspection; typed public catalog deltas | Consumes A; must replace synthetic physical fixtures with real command integration tests; concrete plan awaiting execution approval |
| C: replacement/recovery | Ordered bulk document replacement, both-window reset/cache rebinding, history continuity, recovery authority/source bridge | Consumes A/B; no generic null-proof or ordinary-save bulk catch-up shortcut |
| D: live integration | Workspace bootstrap/progress transport, working-owner publication, export/status/retry/navigation integration | Consumes A–C and all original migration/compatibility/native gates; single cutover remains separately gated |

Do not treat successful synthetic active-layout fixtures in A as proof that create/close/import transactions exist. Do not wire a partial normalized production store. The existing private-first authorization permits this work while migration acceptance remains open; it does not turn known failures into passing gates.

Current verification checkpoint: the separately approved ten-minute full-size policy now yields a complete649PASS/11timeouts/660-case campaign (`task-13-migration-10m-cases-0-660-0MVFy5`), with32MiB PASS401481.622311ms and all remaining failures at unchanged5000ms. No missing/non-timeout/module/unhandled failures, no best-of substitution, and no full-green release claim. MilestoneB is planned, not implemented; details and limits are in the linked plan and [timeout follow-up](2026-09-29-fullsize-normalization-timeout.md).

## File map and permitted foundation scope

| Path | Responsibility |
| --- | --- |
| Create `services/localWorkspace/normalized/workspaceManifest.ts` | Manifest/birth types, strict cooperative shape checks, core frame, initial manifest, compatibility projection; no IDB |
| Create `services/localWorkspace/normalized/workspaceCommitProof.ts` | Bounded workspace receipt/window framing, append and chain validation; no transaction execution or command dispatch |
| Create `services/localWorkspace/normalized/projectBaseline.ts` | Workspace-born image/lane frames, digest creation and independent initial-lane verification; no cache or IDB |
| Modify `services/localWorkspace/normalized/schema.ts` | Required initial-manifest marker fields and optional workspace birth identity on headers |
| Modify `services/localWorkspace/schema.ts` | Historical/normalized workspace stored-value union through a type-only import; keep `StoredWorkspace` and archive historical shape |
| Modify `services/localWorkspace/indexedDbAdapter.ts` | Only historical type narrowing/refusal needed by that union; preserve v2 behavior and normalized-reservation guards |
| Modify `services/localWorkspace/normalized/repository.ts` | Integrate pure modules into existing capture/seal/activation/reopen/admission; remain sole writer |
| Modify `services/localWorkspace/normalized/codec.ts`, `commitProof.ts` | Exact allowed header metadata/birth rules; reject incompatible ancestry; keep ordinary framing and payload preservation |
| Modify `services/localWorkspace/normalized/migration.ts` | Return verified current manifest from the coupled active result; no added reads or publication fence bypass |
| Create `tests/helpers/normalizationHarness.ts` | Move existing normalization fixture constructors/physical inspection helpers, preserving behavior |
| Create `tests/unit/localWorkspace/normalized/workspaceManifest.test.ts` | Manifest shape, initial projection and hostile metadata |
| Create `tests/unit/localWorkspace/normalized/workspaceCommitProof.test.ts` | Receipt chain/digest/window bounds |
| Create `tests/unit/localWorkspace/normalized/projectBaseline.test.ts` | Independent document/preference/raw-fold baselines |
| Create `tests/unit/localWorkspace/normalized/workspaceAuthority.test.ts` | Real activation/reopen, synthetic current layouts, races, faults and ordinary-operation isolation |
| Modify existing normalized `migration.test.ts`, `codec.test.ts`, `commitProof.test.ts`, `repository.test.ts` | Fixture extraction, required marker/header fields and retained regression assertions |
| Modify `tests/unit/localWorkspaceBoundary.test.ts` | Exact new private module edges; no wildcard allowance |
| Documentation only | This plan, approved spec status/clarifications, original Task12/13 link, execution ledger |

No `ProjectEditor`, live hook, `EditorPage`, worker protocol/client, dependency or build-config changes in A. If a necessary runtime seam lies outside this list, identify the concrete dependency before expanding scope.

## Shared contracts: names used by every task

Put metadata types in `workspaceManifest.ts`; imports from historical/normalized schema are type-only. `workspaceCommitProof.ts` imports the manifest types type-only, so runtime shape validation can call its proof validator without a runtime cycle. Put the small birth-origin validator in existing `commitProof.ts` beside its private framing primitives, importing its origin type type-only. `codec.ts` and `workspaceManifest.ts` can call it; `commitProof.ts` must not runtime-import the higher-level manifest module.

```ts
export interface WorkspaceCommandIdentity {
  clientId: string;
  commandSequence: number;
  commandId: string;
}
export interface WorkspaceStamp { revision: number; coreDigest: string }
export interface WorkspaceReceipt {
  identity: WorkspaceCommandIdentity;
  requestDigest: string;
  before: WorkspaceStamp;
  after: WorkspaceStamp;
  postconditionDigest: string;
  proofDigest: string;
}
export interface WorkspaceCommitWindow {
  floorRevision: number;
  floorCoreDigest: string;
  entries: readonly WorkspaceReceipt[];
}
export interface WorkspaceActivation {
  attemptId: string;
  sourceKind: 'historical' | 'fresh';
  sourceDigest: string;
  sourceArchiveId: string;
  sourceArchiveDigest: string;
  sourceWorkspaceRevision: number;
}
export interface ProjectBaselineDigests {
  imageDigest: string;
  documentDigest: string;
  preferenceDigest: string;
  foldDigest: string;
  recordCount: number;
}
export interface WorkspaceBirthOrigin {
  kind: 'workspace-command';
  identity: WorkspaceCommandIdentity;
  requestDigest: string;
  workspaceRevision: number;
  memberOrdinal: number;
  createdAt: string;
  authority: AuthorityStamp;
}
export type WorkspaceProjectBirth =
  | { kind: 'migration'; sourceRevision: number;
      sourceUpdatedAt: string; projectDigest: string }
  | (WorkspaceBirthOrigin & { digests: ProjectBaselineDigests });
export type ConsumedImportMetadata = Pick<StoredProject,
  'consumedImportId' | 'consumedImportCreatedAt' |
  'consumedImportDigest' | 'consumedImportAttempt'>;
export interface WorkspaceMember {
  projectId: string;
  incarnation: string;
  birth: WorkspaceProjectBirth;
  consumedImport: ConsumedImportMetadata;
}
export interface PresetDescriptor {
  id: string; position: number; recordDigest: string;
}
export interface ImportDescriptor {
  id: string; position: number; targetProjectId: string;
  createdAt: string; recordDigest: string;
  pendingImportDigest: string;
  attemptProvenance?: StoredImportAttemptProvenance;
}
export interface WorkspaceManifestCore {
  id: 'current';
  kind: 'normalized-workspace';
  formatVersion: 3;
  manifestVersion: 1;
  storageGeneration: string;
  activation: WorkspaceActivation;
  revision: number;
  members: readonly WorkspaceMember[];
  activeProjectId: string;
  presets: readonly PresetDescriptor[];
  pendingImports: readonly ImportDescriptor[];
  legacyAcceptance:
    | { kind: 'fresh' }
    | { kind: 'accepted'; digest: string; backupId: string };
}
export interface NormalizedWorkspaceManifest extends WorkspaceManifestCore {
  coreDigest: string;
  lastCommit: WorkspaceReceipt | null;
  commitWindow: WorkspaceCommitWindow;
}
```

`consumedImport` is an exact small object containing only the existing source metadata fields that are present, not a spread of `StoredProject`. Validate the same combinations/provenance as the existing historical record validator. Do not silently strip a present source field or invent provenance.

Required schema changes:

```ts
// normalized/schema.ts, NormalizationLedger:
workspaceManifestVersion: 1;
initialWorkspaceDigest: string;

// normalized/schema.ts, ProjectHeader:
workspaceBirth?: WorkspaceBirthOrigin;

// schema.ts: retain StoredWorkspace unchanged.
export type StoredWorkspaceRecord = StoredWorkspace | NormalizedWorkspaceManifest;
// LocalWorkspaceDatabase.workspace.value becomes StoredWorkspaceRecord.
// NormalizationSourceArchive.workspace remains StoredWorkspace.

// normalized/repository.ts:
export interface ActiveRead {
  authority: ActiveAuthority;
  workspace: NormalizedWorkspaceManifest;
  snapshot: WorkspaceSnapshot;
  source: SourceInfo;
}
```

The active result is verified data, not a public workspace capability. Worker/facade admission installation belongs to B/D. Normalized-only repository fixtures remain explicitly test-only; a database containing historical stores cannot use that fixture shortcut.

### Frames and exact exclusions

All hashes use the existing cooperative `hashFrame`, not `environment.hash` or synchronous `canonicalStringify` on the normalization path. Domain tags:

| Frame | Tag / covered data |
| --- | --- |
| Manifest core | `doctect-workspace-core-v1`, canonical core fields only |
| Receipt proof | `doctect-workspace-receipt-v1`, all receipt fields except `proofDigest` |
| Preset/import descriptor digest | Existing per-field-depth envelope frame with distinct `workspace-preset-v1` / `workspace-import-v1` labels |
| Pending import digest | Existing canonical pending-import digest semantics, preserving stage/replace/consume compatibility |
| Incarnation | `doctect-workspace-incarnation-v1`, `[storageGeneration, nextRevision, memberOrdinal]` |
| Baseline image | `doctect-project-birth-image-v1`, ordered store/key/record projections |
| Baseline document | `doctect-project-birth-document-v1`, document-only record projections |
| Baseline preferences | `doctect-project-birth-preferences-v1`, preference projection |
| Baseline folds | `doctect-project-birth-folds-v1`, exact folds record projection |

Manifest/receipt framing omits only named top-level private fields. Baseline projection omits `commitProof` and `commitWindow` from header/preferences, includes `workspaceBirth` origin, and never omits similarly named properties inside `value`. Header birth identity has no digest fields: compute its digests afterward into the manifest member, avoiding a circular hash. Store order is `NORMALIZED_STORE_NAMES` excluding ledger; keys are sorted lexicographically by their tuple fields using cooperative string comparison, not concatenated delimiters. Reject duplicate physical keys before hashing.

Document projection excludes `projectPreferences` and `projectExtensions` with owner `folds`; it includes all other project records and document/header bookkeeping. Preference and folds projections are independent. `recordCount` counts all project records, not ledger/manifest. Scalar preference saves do not change the document projection.

## Task 1: Strict manifest and workspace receipt module

**Files:** Create `workspaceManifest.ts`, `workspaceCommitProof.ts` and their two unit test files from the scope table. No database integration yet.

**Interfaces produced:**

```ts
// workspaceManifest.ts
export function validateWorkspaceManifestWork(value: unknown): Work<NormalizedWorkspaceManifest>;
export function workspaceManifestCoreFrame(value: WorkspaceManifestCore): Frame;
export function projectWorkspaceOrderWork(value: NormalizedWorkspaceManifest): Work<StoredWorkspace>;
export function createInitialWorkspaceManifest(source: NormalizationSource,
  activation: WorkspaceActivation, work: WorkRuntime): Promise<NormalizedWorkspaceManifest>;
export function deriveWorkspaceIncarnation(storageGeneration: string,
  nextRevision: number, memberOrdinal: number, work: WorkRuntime): Promise<string>;

// workspaceCommitProof.ts
export function workspaceReceiptFrame(value: Omit<WorkspaceReceipt, 'proofDigest'>): Frame;
export function validateWorkspaceWindowWork(value: unknown,
  current: WorkspaceStamp, lastCommit: WorkspaceReceipt | null): Work<WorkspaceCommitWindow>;
export function verifyWorkspaceReceipts(value: NormalizedWorkspaceManifest,
  initial: WorkspaceStamp, work: WorkRuntime): Promise<void>;
export function appendWorkspaceReceipt(window: WorkspaceCommitWindow,
  receipt: WorkspaceReceipt, work: WorkRuntime): Promise<WorkspaceCommitWindow>;
```

- [ ] Add a fixture local to `workspaceManifest.test.ts`: construct one exact `WorkspaceManifestCore` with member `p1/i1`, migration birth revision0/timestamp`2026-09-26T00:00:00.000Z`, empty ancillary lists and fresh legacy acceptance. Compute its core digest with the exported frame, then attach null receipt and matching initial floor. Keep malformed variants separate copies.

```ts
it('rejects duplicate current membership even when all IDs are individually valid', async () => {
  const w = makeWorkHarness('reopen');
  const core: WorkspaceManifestCore = {
    id: 'current', kind: 'normalized-workspace', formatVersion: 3, manifestVersion: 1,
    storageGeneration: 'g1', revision: 0, activeProjectId: 'p1',
    activation: { attemptId: 'a1', sourceKind: 'fresh', sourceDigest: 'a'.repeat(64),
      sourceArchiveId: 'archive', sourceArchiveDigest: 'b'.repeat(64), sourceWorkspaceRevision: 0 },
    members: [{ projectId: 'p1', incarnation: 'i1', consumedImport: {},
      birth: { kind: 'migration', sourceRevision: 0,
        sourceUpdatedAt: '2026-09-26T00:00:00.000Z', projectDigest: 'c'.repeat(64) } }],
    presets: [], pendingImports: [], legacyAcceptance: { kind: 'fresh' },
  };
  const coreDigest = await hashFrame(w.runtime, 'proof', workspaceManifestCoreFrame(core));
  const manifest = { ...core, coreDigest, lastCommit: null,
    commitWindow: { floorRevision: 0, floorCoreDigest: coreDigest, entries: [] } };
  await expect(w.runtime.run(validateWorkspaceManifestWork(manifest))).resolves.toEqual(manifest);
  const duplicate = { ...manifest, members: [...manifest.members, manifest.members[0]] };
  await expect(w.runtime.run(validateWorkspaceManifestWork(duplicate))).rejects.toThrow();
});
```

- [ ] Run RED: `npx vitest run tests/unit/localWorkspace/normalized/workspaceManifest.test.ts tests/unit/localWorkspace/normalized/workspaceCommitProof.test.ts --maxWorkers=2`. Expected missing new module/export, then specific failing assertions once interfaces exist. Do not accept a unrelated fixture/loader crash as behavioral RED.

- [ ] Implement exact own-data validation with existing `exactFieldsWork`, `denseDataArrayWork`, `effect`, `privateId`, `safeCounter`, `validDigest`, `canonicalTimestamp` and cooperative string traversal. Reject accessors without invoking them, sparse arrays, duplicate member IDs, missing active member, invalid order/positions, unknown fields/version, malformed consumed-import combinations and inconsistent generation/birth authority. Private identity validation must not truncate external IDs.

Core framing/projection implementation shape:

```ts
export const workspaceManifestCoreFrame = (value: WorkspaceManifestCore): Frame =>
  canonicalFrame(['doctect-workspace-core-v1', {
    id: value.id, kind: value.kind, formatVersion: value.formatVersion,
    manifestVersion: value.manifestVersion, storageGeneration: value.storageGeneration,
    activation: value.activation, revision: value.revision, members: value.members,
    activeProjectId: value.activeProjectId, presets: value.presets,
    pendingImports: value.pendingImports, legacyAcceptance: value.legacyAcceptance,
  }]);

export function* projectWorkspaceOrderWork(value: NormalizedWorkspaceManifest): Work<StoredWorkspace> {
  const projectOrder: string[] = [];
  for (const member of value.members) yield* effect(1, () => { projectOrder.push(member.projectId); });
  return { id: 'current', projectOrder, activeProjectId: value.activeProjectId, revision: value.revision };
}

export async function deriveWorkspaceIncarnation(generation: string, revision: number,
  ordinal: number, work: WorkRuntime): Promise<string> {
  privateId(generation); safeCounter(revision); safeCounter(ordinal);
  requireContract(revision > 0, 'Invalid creation revision');
  return `workspace:${await hashFrame(work, 'proof',
    canonicalFrame(['doctect-workspace-incarnation-v1', generation, revision, ordinal]))}`;
}
```

The frame accepts already shape-validated metadata; storage ingress must call the validator first. Initial construction walks source workspace order and joins by exact project ID to validated source metadata/source digest entries; preserve incarnation, revision, timestamp and all consumed-import fields. Build ancillary descriptors using existing envelope/canonical frames; never stash payloads in descriptors. Sort ancillary positions cooperatively without mutating source arrays.

- [ ] Implement receipt validation and bounded append. Each receipt requires `after.revision === before.revision + 1`; request/proof/postcondition/core digests are valid SHA256; command private IDs/sequence valid. Entries chain from exact floor revision/digest to current revision/core; last entry equals `lastCommit`. Null `lastCommit` requires empty window and initial revision/core. Append rejects a reused command ID, or non-increasing command sequence for the same client within the retained window, wrong starting stamp and overflow. Retain newest receipt while evicting oldest entries until both limits hold; advance floor to the last evicted after-stamp. Never turn eviction into not-committed evidence.

```ts
export const workspaceReceiptFrame = (value: Omit<WorkspaceReceipt, 'proofDigest'>): Frame =>
  canonicalFrame(['doctect-workspace-receipt-v1', {
    identity: value.identity, requestDigest: value.requestDigest,
    before: value.before, after: value.after, postconditionDigest: value.postconditionDigest,
  }]);
```

`verifyWorkspaceReceipts` recomputes core and each retained proof digest; initial state must match the activation-provided initial stamp. Advanced state must have a valid current receipt chain/floor, with no pre-activation revision. Do not trust a caller-provided `coreDigest` or just the last numeric revision. Test 33 valid receipts, malformed floor/gaps/duplicate identity, altered core/proof and independent canonical SHA parity. The fixed-size current receipt schema may reach the count cap before the byte cap: measure exact bytes and test oversized malformed windows; do not invent payload fields to manufacture a valid byte-boundary case.

```ts
it('evicts old receipts without losing the retained chain floor', async () => {
  const w = makeWorkHarness('reopen');
  let stamp = { revision: 0, coreDigest: testHash('core-0') };
  let window: WorkspaceCommitWindow = { floorRevision: 0,
    floorCoreDigest: stamp.coreDigest, entries: [] };
  let last: WorkspaceReceipt | null = null;
  for (let revision = 1; revision <= 33; revision++) {
    const after = { revision, coreDigest: testHash(`core-${revision}`) };
    const core = { identity: { clientId: 'client', commandSequence: revision,
      commandId: `command-${revision}` }, requestDigest: testHash(`request-${revision}`),
      before: stamp, after, postconditionDigest: testHash(`effect-${revision}`) };
    last = { ...core, proofDigest: await hashFrame(w.runtime, 'proof', workspaceReceiptFrame(core)) };
    window = await appendWorkspaceReceipt(window, last, w.runtime);
    stamp = after;
  }
  expect(window.entries).toHaveLength(32);
  expect(window.floorRevision).toBe(1);
  expect(window.floorCoreDigest).toBe(testHash('core-1'));
  await expect(w.runtime.run(validateWorkspaceWindowWork(window, stamp, last))).resolves.toEqual(window);
  await expect(w.runtime.run(validateWorkspaceWindowWork({ ...window, floorRevision: 0 }, stamp, last))).rejects.toThrow();
});
```

- [ ] Add adversarial tests: accessor count stays0; unknown symbol/nonenumerable fields rejected; long external ID accepted; private ID257UTF8bytes rejected; mutation of input during suspended initial creation cannot mutate a repository-owned source (detachment is exercised at Task4); descriptor frames preserve original external depth; large metadata yields and cancels using authentic Work.

- [ ] Run both new suites GREEN, record tests/work counters, inspect module imports. Checkpoint without commit. No manifest authority is installed by these pure functions.

## Task 2: Independent workspace-born project baseline proofs

**Files:** Create `projectBaseline.ts`, `projectBaseline.test.ts`; modify normalized schema/codec/commitProof and their existing tests for `workspaceBirth` only.

**Consumes:** `WorkspaceBirthOrigin`, `WorkspaceProjectBirth`, `ProjectBaselineDigests`, existing `NormalizedProject`, `recordFrame`, `WorkRuntime`.

**Produces:**

```ts
export function projectBirthFrame(project: NormalizedProject,
  part: 'image' | 'document' | 'preferences' | 'folds'): Frame;
export function createProjectBirthDigests(project: NormalizedProject,
  work: WorkRuntime): Promise<ProjectBaselineDigests>;
export function verifyProjectBirth(project: NormalizedProject,
  member: WorkspaceMember, work: WorkRuntime): Promise<void>;
// Existing commitProof.ts, called by codec/manifest shape validation:
export function validateWorkspaceBirthOriginWork(value: unknown): Work<WorkspaceBirthOrigin>;
```

- [ ] Add RED independent-lane tests using a small `makeIncrementalProject(2)` image and an explicit `WorkspaceBirthOrigin`. Set header origin before deriving digests; store digests only in member birth. Modify preference values without changing document records, and compare frames independently rather than making one whole-image equality assertion.

```ts
it('keeps document baseline stable across scalar preference changes', async () => {
  const project = makeIncrementalProject(2);
  const image = decomposeProject(project, { storageGeneration: 'g1', projectId: project.id, incarnation: 'i1' });
  const w = makeWorkHarness('reopen');
  const before = await createProjectBirthDigests(image, w.runtime);
  const preferences = image.projectPreferences.values().next().value!;
  preferences.value = { ...preferences.value, zoom: 1.25 };
  const after = await createProjectBirthDigests(image, w.runtime);
  expect(after.documentDigest).toBe(before.documentDigest);
  expect(after.preferenceDigest).not.toBe(before.preferenceDigest);
  expect(after.imageDigest).not.toBe(before.imageDigest);
  expect(after.foldDigest).toBe(before.foldDigest);
});
```

This frame test is not a valid persisted preference mutation: aggregate sizes/proofs remain intentionally untouched. Persisted lane-transition correctness is tested via real commits in Task5.

- [ ] Run RED: `npx vitest run tests/unit/localWorkspace/normalized/projectBaseline.test.ts --maxWorkers=2`.

- [ ] Implement baseline projection using the exact frame table/exclusions above. Iterate only actual project stores; use cooperative key collection/sort and `recordFrame` over a bounded metadata projection per record. Reuse opaque `value` references; do not clone/enumerate payloads to remove private envelope fields.

The per-store inclusion decision is exact:

```ts
const include = (store: ProjectStoreName, record: PhysicalRecord,
  part: 'image' | 'document' | 'preferences' | 'folds'): boolean => {
  const folds = store === 'projectExtensions' && record.key[3] === 'folds';
  if (part === 'image') return true;
  if (part === 'preferences') return store === 'projectPreferences';
  if (part === 'folds') return folds;
  return store !== 'projectPreferences' && !folds;
};
```

Define `PhysicalRecord = NormalizedRecordTypes[ProjectStoreName]` in this private module. Copy own envelope fields cooperatively except the two named proof fields; include every other known field after exact record validation. Frame each external record through existing per-field depth semantics, not one new wrapper that spends external depth.

- [ ] Extend codec/header validation to allow **either** `migrationBaseline` or `workspaceBirth`, never both. Workspace birth begins document/preference/fold revisions0, null head proofs, empty windows/floors0 and a valid creation timestamp/origin. A nonzero null-proof header is still permitted only by the existing verified migration baseline, not by workspace birth. Header origin equality alone does not grant authority: `verifyProjectBirth` requires the independently admitted manifest member.

```ts
export function* validateWorkspaceBirthOriginWork(value: unknown): Work<WorkspaceBirthOrigin> {
  const birth = yield* exactFieldsWork(value, ['kind', 'identity', 'requestDigest',
    'workspaceRevision', 'memberOrdinal', 'createdAt', 'authority']);
  const identity = yield* exactFieldsWork(birth.identity, ['clientId', 'commandSequence', 'commandId']);
  const stamp = yield* exactFieldsWork(birth.authority,
    ['documentRevision', 'preferenceRevision', 'foldStructureGeneration']);
  yield* effect(1, () => {
    requireContract(birth.kind === 'workspace-command', 'Invalid workspace birth');
    privateId(identity.clientId); privateId(identity.commandId); safeCounter(identity.commandSequence);
    validDigest(birth.requestDigest); safeCounter(birth.workspaceRevision); safeCounter(birth.memberOrdinal);
    requireContract((birth.workspaceRevision as number) > 0, 'Invalid creation revision');
    canonicalTimestamp(birth.createdAt);
  });
  for (const name of ['documentRevision', 'preferenceRevision', 'foldStructureGeneration']) {
    yield* effect(1, () => { safeCounter(stamp[name]); requireContract(stamp[name] === 0, 'Invalid initial authority'); });
  }
  return value as WorkspaceBirthOrigin;
}
```

Verification decision code belongs at the bulk seam, not in ordinary commit preparation:

```ts
if (header.storageRevision === birth.authority.documentRevision) {
  requireContract(await hashFrame(work, 'proof', projectBirthFrame(project, 'document'))
    === birth.digests.documentDigest, 'Workspace document baseline mismatch');
}
if (preferences.revision === birth.authority.preferenceRevision) {
  requireContract(await hashFrame(work, 'proof', projectBirthFrame(project, 'preferences'))
    === birth.digests.preferenceDigest, 'Workspace preference baseline mismatch');
  requireContract(await hashFrame(work, 'proof', projectBirthFrame(project, 'folds'))
    === birth.digests.foldDigest, 'Workspace fold baseline mismatch');
}
```

Before those checks, verify exact origin/member scope, safe counters >=baseline, digests and physical record structure. When both lanes are initial, also verify complete image digest/count. When a lane advanced, existing current proof/window rules remain mandatory; advanced preferences retain current `foldRecordDigest` beyond eviction. Do not use the initial record count after document edits legitimately add/delete records. Migration members continue through their retained-source verification, not this workspace-birth exception.

- [ ] Add tests for scalar preference changes, document-only changes, raw nonboolean/cyclic-invalid folds, changed unproved document bytes, forged header birth, unrelated stored extension fields named `commitProof`, 512/513 external depth, omitted/extra records, and fixed-size baseline metadata surviving receipt-window eviction. Pure projection tests may use malformed images; admission tests must use valid sizes/proofs and alter one fact afterward.

- [ ] Run GREEN: `npx vitest run tests/unit/localWorkspace/normalized/projectBaseline.test.ts tests/unit/localWorkspace/normalized/codec.test.ts tests/unit/localWorkspace/normalized/commitProof.test.ts --maxWorkers=2`. Review exact new header fields and no generic lineage relaxation; checkpoint without commit.

## Task 3: Reusable real normalization fixture and stored-value union

**Files:** Create `tests/helpers/normalizationHarness.ts`; modify existing normalized `migration.test.ts`, root `schema.ts`, `indexedDbAdapter.ts`; start `workspaceAuthority.test.ts`.

**Fixture interfaces produced:** Preserve the existing constructor signatures and returned properties when moving them. Export `historicalStores`, `request`, `done`, `createNormalizationHarness`, `freshHarness`, `physicalRows`, and `mutateRow` from the helper. Their source is `migration.test.ts:2571–2682` at plan time. `activeImage` and scenario-specific fixtures remain in that test file.

- [ ] Move those helper definitions verbatim, adjusting import paths only. Import Vitest `expect` in the helper because existing fixture assertions use it. Replace local declarations with imports in the migration suite; retain every scenario/assertion/timeout and all `version`, `faultAt`, `legacyValues`, `outOfLineNodes` options. Do not move test registrations or normalize helper behavior while extracting it.

- [ ] Run fixture-preservation checks: `npx vitest run tests/unit/localWorkspace/normalized/migration.test.ts -t 'combined active read|sealed retained read|strict reservation and staging|recovery routing' --maxWorkers=2`. Expected existing focused cases pass at original limits. If timing fails, retain evidence and isolate the unchanged case; do not shorten its fixture or raise its timeout.

- [ ] Add a preservation test that the existing historical workspace validator refuses a normalized-tagged row, while historical v2 bootstrap/create/close tests remain unchanged. This is already-correct behavior, not an invented behavioral RED. Change only the database stored-value type to `StoredWorkspaceRecord`; keep archives and historical `WorkspaceRecords.workspace` typed as `StoredWorkspace`.

Narrow the existing adapter helper at its current `requireWorkspaceRevision` seam:

```ts
const requireWorkspaceRevision = (
  workspace: StoredWorkspaceRecord | undefined,
  expectedRevision: number,
): StoredWorkspace => {
  if (workspace && 'kind' in workspace) {
    throw conflict('Normalized workspace is not historical editing authority.');
  }
  if (!workspace || workspace.revision !== expectedRevision) {
    throw conflict('Workspace revision changed.');
  }
  return workspace;
};
```

This helper retains the old revision check, adds union narrowing and does not replace historical bootstrap validation. That validator already requires exactly `id/projectOrder/activeProjectId/revision` (`migration.ts:667–689`); `kind` was not a valid historical extension. Apply equivalent checked narrowing to existing direct historical reads before writes at adapter lines1438 and recovery admission. No `as StoredWorkspace` cast is an admission check. Existing normalization-reservation rejection remains in the same transaction and cannot be replaced by the discriminant test alone.

- [ ] Run `npx vitest run tests/unit/localWorkspace/commit.test.ts tests/unit/localWorkspace/bootstrap.test.ts tests/unit/localWorkspace/lineageRepair.test.ts --maxWorkers=2` and typecheck. No production behavior/version change is allowed; new compiler errors must be fixed only at checked historical seams. Record the known Sticker Press typecheck error separately.

## Task 4: Initial manifest preparation and atomic activation

**Files:** Modify normalized `schema.ts`, `repository.ts`, `migration.ts`; extend `workspaceAuthority.test.ts` and required marker expectations in existing migration tests.

**Consumes:** Initial manifest constructor/core frame/receipt verifier from Task1; shared real fixture from Task3.

**Produces:** Required marker fields `workspaceManifestVersion:1` / `initialWorkspaceDigest`, coupled `ActiveRead.workspace`, and normalized active result containing `workspace` metadata. This does not install a UI capability.

- [ ] Add RED activation test with independent physical reads:

```ts
it('activates marker and current manifest together', async () => {
  const h = freshHarness();
  try {
    const result = await h.run();
    expect(result.status).toBe('active');
    const rows = await physicalRows(h, ['workspace', 'normalizationLedger']);
    expect(rows.workspace).toHaveLength(1);
    expect(rows.normalizationLedger).toHaveLength(1);
    const manifest = rows.workspace[0];
    const marker = rows.normalizationLedger[0];
    expect(manifest).toMatchObject({ id: 'current', kind: 'normalized-workspace',
      formatVersion: 3, manifestVersion: 1, lastCommit: null });
    expect(marker).toMatchObject({ state: 'active', workspaceManifestVersion: 1,
      initialWorkspaceDigest: manifest.coreDigest });
    expect(manifest.storageGeneration).toBe(marker.storageGeneration);
    expect(manifest.members.map((m: WorkspaceMember) => [m.projectId, m.incarnation]))
      .toEqual(marker.sourceProjects.map((p: NormalizationSourceProject) => [p.projectId, p.incarnation]));
  } finally { h.adapter.close(); }
});
```

- [ ] Run RED: `npx vitest run tests/unit/localWorkspace/normalized/workspaceAuthority.test.ts -t 'activates marker' --maxWorkers=2`.

- [ ] Extend `PreparedPass` with `initialWorkspace: NormalizedWorkspaceManifest`. In existing `derive`, construct it from the already validated source/archive identities before forming the expected marker. Add its version/core digest to strict marker validation, source matching and the versioned normalization verification frame. Use domain tag `normalization-verification-v2`, existing ordered verification fields followed by `workspaceManifestVersion` and `initialWorkspaceDigest`, in both creation and validation; do not silently accept old experimental markers under a changed hash definition.

Use the existing pass, not a new repository read:

```ts
const activation: WorkspaceActivation = {
  attemptId: `normalization:${source.sourceDigest}`, sourceKind: source.kind,
  sourceDigest: source.sourceDigest, sourceArchiveId: archive.id,
  sourceArchiveDigest, sourceWorkspaceRevision: source.records.workspace.revision,
};
const initialWorkspace = await createInitialWorkspaceManifest(source, activation, work);
// The normal expected marker literal includes these required fields:
const workspaceFields = { workspaceManifestVersion: 1 as const,
  initialWorkspaceDigest: initialWorkspace.coreDigest };
```

Charge descriptor hashing/metadata creation/retention through the same invocation runtime. No free cache, hidden extra capture or counter relabeling. Required marker fields are strict in every stage/resume path; missing fields on an existing experimental v3 attempt refuse authority, not silently upgrade it.

- [ ] Add `cutover.before-workspace` and `cutover.after-workspace` to `NormalizationReservationFault`. During `transition('activate')`, the sealed transaction writes manifest then active marker, preserving existing marker fault points and postcommit failure behavior. Historical source uses `put`; fresh source uses `add`. Preserve the exact source/candidate seal; no observer or hash may occur between its final guard and these writes.

```ts
if (phase === 'activate') {
  environment.normalizationFault?.('cutover.before-workspace');
  work.assertCurrent(); work.note('writes');
  const store = tx.objectStore('workspace');
  const request = pass!.source.kind === 'fresh'
    ? store.add(pass!.initialWorkspace) : store.put(pass!.initialWorkspace);
  request.onsuccess = () => guard(() => {
    environment.normalizationFault?.('cutover.after-workspace');
    work.assertCurrent(); issue(); // Existing marker write and fault sequence.
  });
} else issue();
```

- [ ] Add independent rollback tests for before/after workspace, before/after marker, before complete and after commit. Precommit failures preserve prior workspace and verified marker; after-commit failure leaves both active records and a fresh owner can independently resolve them. Test fresh/historical, source drift before seal, concurrent winner, cancellation after observer and lost acknowledgement. Archives/historical project bytes stay exact.

- [ ] Make the initial-layout reopen understand the new manifest in this same task so activation can complete its existing independent reopen before Task5. Validate the manifest/core/activation stamp, require its null receipt and unchanged initial core, then pass `projectWorkspaceOrderWork(manifest)` to the existing historical-shaped ancillary validator instead of the tagged storage row. Preserve current source-based project verification for this initial-only checkpoint; advanced workspace manifests fail closed until Task5.

```ts
const workspace = await work.run(validateWorkspaceManifestWork(live.workspace[0]));
await verifyWorkspaceReceipts(workspace, { revision: pass.attempt.sourceWorkspaceRevision,
  coreDigest: pass.attempt.initialWorkspaceDigest }, work);
requireContract(workspace.lastCommit === null, 'workspace-current-membership-required');
const projectedWorkspace = await work.run(projectWorkspaceOrderWork(workspace));
// Existing workspace validator receives projectedWorkspace, current project rows
// and live ancillary rows. Final ActiveRead returns workspace separately.
```

Compare live ancillary descriptors to this verified initial manifest as well; unchanged migration source is not permission to ignore a live preset/import mutation. This temporary initial-only refusal is private staging of implementation, not a production feature flag. Task5 replaces it with full current-member validation.

- [ ] Propagate `workspace` from the same `session.reopen()` result through `NormalizationResult` and `publish`; do not call `readActiveSnapshot` twice. On the active path, validate legacy capture against current manifest acceptance rather than using source origin as an acceptance flag:

```ts
const acceptance = active.workspace.legacyAcceptance;
if (acceptance.kind === 'fresh' ? hasLegacy : capturedLegacy.digest !== acceptance.digest) {
  throw new Error('Legacy source no longer matches normalization');
}
```

Keep pre-activation historical prerequisites unchanged. Keep progress notification, disposal and `work.quiet(fence)` ordering unchanged. This separation is needed for a fresh-origin workspace that later accepts recovered legacy copies; the real recovery command remains C. Run focused activation cases GREEN and existing strict/session/reservation/fence regressions; record real counters including the pre-existing5-vs4 failure when exercised.

## Task 5: Manifest-driven current reopen and initial-lane admission

**Files:** Modify normalized repository and `workspaceAuthority.test.ts`; extend existing migration/repository tests only where the required format changes.

**Consumes:** All preceding interfaces. `readRetainedSource` remains source-only and must ignore corrupt unused live targets as it does now.

**Produces:** Active reopen/selected admission that enumerate current manifest membership, verify births and ancillary descriptors, and return one independently sealed current workspace.

- [ ] Add RED against the exact current bug: activate a two-project source, then use an explicit test-only physical fixture to remove one normalized project and advance a valid manifest receipt, without changing the retained source. A fresh `readActiveSnapshot()` must return only the current member. Reusing source membership currently fails this test.

Fixture construction belongs in this test, not a production command API. It performs one test-only transaction writing the prepared manifest/removing selected normalized rows, using Task1 frames/receipt builder primitives and independent physical reads. Label it `seedCurrentLayout` and define its contract:

```ts
async function seedCurrentLayout(
  h: { indexedDB: IDBFactory; databaseName: string },
  manifest: NormalizedWorkspaceManifest,
  images: readonly NormalizedProject[],
): Promise<void> {
  expect(h.indexedDB).toBeInstanceOf(FakeIDBFactory);
  const stores = NORMALIZED_STORE_NAMES.filter((s): s is ProjectStoreName => s !== 'normalizationLedger');
  const db = await request(h.indexedDB.open(h.databaseName));
  try {
    const tx = db.transaction(['workspace', ...stores], 'readwrite');
    const completion = done(tx);
    for (const store of stores) tx.objectStore(store).clear();
    for (const image of images) for (const store of stores) {
      for (const record of image[store].values()) tx.objectStore(store).put(record);
    }
    tx.objectStore('workspace').put(manifest);
    await completion;
  } finally { db.close(); }
}
```

Import `IDBFactory as FakeIDBFactory` from `fake-indexeddb` for the guard. Implementation opens only this fresh fixture database, replaces rows in the normalized project stores and `workspace` in one transaction, leaves `normalizationLedger` and the other historical stores unchanged, then closes. This is authorized test seeding, not an exported writer or evidence for lifecycle atomicity. Capture the source before mutation; assert `readRetainedSource()` still returns exactly it.

- [ ] Add a workspace-born fixture using real codec, header origin and Task2 digests. Form its receipt with canonical request/postcondition digests, an exact before/after manifest stamp and computed receipt proof; never install an authority token in the fixture. Call the real fresh repository `readActiveSnapshot`/`bindAdmittedProject` to obtain admission. Include close/recreate of a source public ID with a different valid workspace-born incarnation.

- [ ] Run RED: `npx vitest run tests/unit/localWorkspace/normalized/workspaceAuthority.test.ts -t 'current member|workspace-born|recreate' --maxWorkers=2`.

- [ ] Separate retained-source derivation from current-image selection inside the existing captured pass. Keep strict staging/verify/activate baseline comparison unchanged. For active mode:

```ts
const rows = candidate.rows.get('workspace')!;
requireContract(rows.length === 1, 'Invalid active workspace');
const currentWorkspace = await work.run(validateWorkspaceManifestWork(rows[0].value));
await verifyWorkspaceReceipts(currentWorkspace, {
  revision: marker.sourceWorkspaceRevision, coreDigest: marker.initialWorkspaceDigest,
}, work);
requireContract(currentWorkspace.storageGeneration === marker.storageGeneration,
  'Workspace generation mismatch');
requireContract(await work.run(equalFrameWork(canonicalFrame(currentWorkspace.activation),
  canonicalFrame({ attemptId: marker.attemptId, sourceKind: marker.sourceKind,
    sourceDigest: marker.sourceDigest, sourceArchiveId: marker.sourceArchiveId,
    sourceArchiveDigest: marker.sourceArchiveDigest,
    sourceWorkspaceRevision: marker.sourceWorkspaceRevision }))), 'Workspace activation mismatch');
```

Build current images/maps from validated `currentWorkspace.members` with cooperative effects. Before accepting a migration birth, require its ID/incarnation, source revision, timestamp, digest and consumed-import metadata to equal that exact independently validated source project's metadata, and its header `migrationBaseline` to match the expected source baseline. A member merely tagged migration-born cannot skip source anchoring because its incarnation differs. Before accepting a workspace birth, require creation revision above initial workspace revision and at most current revision; recompute its incarnation from generation/creation revision/stored member ordinal. For every captured project record, require exact member/incarnation prefix and recognized store/key shape. Header keys omit incarnation, so compare their explicit `incarnation` too. Reject orphans rather than assigning them to surviving source IDs.

- [ ] Retain migration target-manifest hashing from the original source. During its expected-record stream, compare an active target to its migration baseline only when the current member is migration-born with the exact source incarnation. Closed members and workspace-born replacements do not require old target rows; their expected source records still contribute to the immutable baseline digest. Remaining live rows must belong to verified current members; new births undergo Task2 verification, not a blanket “has header” exemption.

The selection predicate is explicit:

```ts
const member = currentMembers.get(record.key[1]);
const compareMigrated = member?.birth.kind === 'migration'
  && member.incarnation === sourceIdentityById.get(record.key[1])?.incarnation;
// If false: emit/hash the expected baseline record, but do not compare/delete
// the current target at the same header key. A recreated ID has different ancestry.
```

`currentMembers` and `sourceIdentityById` are per-pass maps built cooperatively from the verified manifest/source, not durable caches. Existing independent initial document/fold checks for migrated members remain intact. Do not treat a preference proof as permission to bypass an unchanged document baseline.

- [ ] Reconstruct/validate current projects in manifest order. For each member, derive the historical-shaped validator envelope from current header revision/time, member incarnation/provenance and reconstructed project, not by spreading an unrelated source row. If header timestamp is null, use the validated migration source timestamp or workspace birth `createdAt` for that compatibility envelope. Keep actual header timestamp semantics unchanged.

For workspace-born members, call `verifyProjectBirth` before existing full record/proof verification. Require strict member/header origin equality. Do not create a new general null-proof exception. Selected reads validate every current project but retain only the selected image/admission, releasing per-read ownership exactly as before.

- [ ] Validate current ancillary envelopes against descriptor identity/order/full record digests and existing project/import constraints. Project `WorkspaceSnapshot` order and active ID come from current manifest. An accepted legacy digest requires its referenced recognized legacy backup and independent snapshot-digest validation from the same capture; a manifest digest alone cannot authorize a missing/corrupt backup. Source reconstruction remains archive-based and includes exactly its captured historical project/backup identities; additional valid recovery backups are not silently folded into source digest. Reject active data mismatches, while retained-source export remains available independently when valid.

- [ ] Finish one final seal over the same active capture and return `workspace`, `authority`, `snapshot`, `source`. Current `SourceInfo.acceptedLegacyDigest` comes from verified manifest legacy acceptance, initially identical to source; fresh source handling must not fabricate acceptance. The later recovery plan supplies real acceptance-changing command tests; this milestone cannot claim that recovery writer exists.

- [ ] Add tests: missing/extra manifest/member/header/incarnation/row; altered birth with unchanged core; altered core/receipt chain; wrong activation; staged marker with manifest; active marker without manifest; missing/extra preset/import; missing/corrupt currently accepted backup; getter never called; selected admission not retaining unselected images; ordinary document save after manifest-driven admission; preference-only save before first document change; document-only save before first preference change; current and retained exports after membership change; cancellation/source change at final seal. Re-run the existing migrated initial-lane corruption matrix, including fold self-eviction, without reducing it.

- [ ] Run new authority suite GREEN and focused existing cases with original limits. Record that synthetic layout acceptance proves reopen/admission, not workspace writer behavior. Checkpoint without commit.

## Task 6: Isolation regression, connected gate and audit

**Files:** Existing boundary/repository/migration tests plus the new authority suite. No additional runtime scope.

- [ ] Add direct operation-count regression after real manifest bootstrap and project binding. Clear bootstrap observations; perform a scalar preference save and one changed node/template save through existing repository/queue seams. Assert no `workspace`, historical source, preset/import or normalization-ledger access, no project `getAll`, and unchanged serialized manifest. Use native/fake IDB method probes for stores outside current `RepositoryOperation.store` typing rather than expanding that observer into a new transaction observer API.

```ts
const before = (await physicalRows(h, ['workspace'])).workspace[0];
const stamp = await h.repository.bindAdmittedProject(image);
ordinaryStoreCalls.length = 0;
await h.repository.commitPreferences({ scope: image.scope, commitId: 'prefs-isolation',
  clientId: 'isolation-client', commitGeneration: 1, editorGeneration: 1,
  observedPreferenceRevision: stamp.preferenceRevision, patch: { zoom: 1.25 } });
await h.repository.commitDocument({ scope: image.scope, commitId: 'doc-isolation',
  clientId: 'isolation-client', commitGeneration: 2, editorGeneration: 2,
  expectedRevision: stamp.documentRevision,
  changes: [{ type: 'put-node', node: { ...project.initialState.nodes.root, title: 'Changed' } }] });
// Restore prototype probes before independent oracle reads.
const after = (await physicalRows(h, ['workspace'])).workspace[0];
expect(after).toEqual(before);
expect(ordinaryStoreCalls.some(call => ['workspace', 'projects', 'presets',
  'pendingImports', 'migrationLedger', 'legacyBackup', 'normalizationLedger'].includes(call.store))).toBe(false);
expect(ordinaryStoreCalls.some(call => call.method === 'getAll')).toBe(false);
```

Define `ordinaryStoreCalls: { store: string; method: string }[]` in the test and wrap `FakeObjectStore.prototype.get/getAll/put/delete` only around actual ordinary commands; forward original methods with `Reflect.apply`. Independent oracle reads run outside that window. No prototype patch in application code.

- [ ] Add exact capability/import-policy edges for the three new private modules. Ordinary UI/root store imports may not reach new private writer internals. Keep `schema.ts` manifest import type-only. Run `npx vitest run tests/unit/localWorkspaceBoundary.test.ts --maxWorkers=2`; no wildcard/transitive bypass.

- [ ] Run focused new-module gate:

```bash
npx vitest run tests/unit/localWorkspace/normalized/workspaceManifest.test.ts tests/unit/localWorkspace/normalized/workspaceCommitProof.test.ts tests/unit/localWorkspace/normalized/projectBaseline.test.ts tests/unit/localWorkspace/normalized/workspaceAuthority.test.ts --maxWorkers=2
```

Expected all new tests pass. Run connected regression:

```bash
npx vitest run tests/unit/localWorkspace/normalized/codec.test.ts tests/unit/localWorkspace/normalized/commitProof.test.ts tests/unit/localWorkspace/normalized/repository.test.ts tests/unit/localWorkspace/normalized/workspaceWorker.test.ts tests/unit/localWorkspace/normalized/storeCommands.test.ts tests/unit/ProjectEditor.incrementalPersistence.test.tsx tests/unit/useIncrementalProjectWrites.test.tsx --maxWorkers=2
```

Any new failure blocks the milestone. Preserve logs/counts and distinguish contention-only reruns from a single green suite.

- [ ] Run full migration regression at original per-test limits:

```bash
npx vitest run tests/unit/localWorkspace/normalized/migration.test.ts --maxWorkers=2
```

Allow sufficient shell wall time for the unchanged360s32MiB case; do not add Vitest timeout flags. Report existing targetDerivations5-vs4,80-template5s failure and any other failures exactly. The pre-integration32MiB pass is not current evidence. A remaining known gate is not accepted by merely renaming it; unexpected new correctness/count failures block A.

- [ ] Run typecheck and build:

```bash
npx tsc --noEmit
ls -ld /tmp/opencode/doctect-incremental-sdd
TMPDIR=/tmp/opencode npm run build --legacy-peer-deps -- --outDir /tmp/opencode/doctect-incremental-sdd/task-13-workspace-foundation-build-01
```

Expect only the known Sticker Press TS2339 from typecheck and successful build. If output directory exists, select a new suffix; never use `--emptyOutDir` or delete it. No server launch or existing-profile opening is required for A's code milestone; native lifecycle tests belong to B/D.

- [ ] Extend read-only scope audit with exactly the paths in this plan, preserving immutable Task11b baseline/list. Run `git diff --check`, `git diff --cached --exit-code`, verify exact HEAD, protected hashes and unchanged production version. Check untracked files with no-index whitespace validation as the existing audit does. Record retained baseline blob count rather than assuming it stays52.

- [ ] Update this checklist, original Task12/13 checkpoint and execution ledger with actual RED/GREEN results, build/typecheck/audit evidence and remaining gates. No commit. Re-enter planning for B only after A's connected review; do not silently proceed into queue/protocol/UI files excluded from A.

## Coverage map for the approved full spec

| Spec section | This plan | Required later milestone |
| --- | --- | --- |
| 1–3 purpose, seams, identities | Constraints, shared types, Tasks1–5 | Capability installation B/D |
| 4.1 current manifest | Tasks1,3–5 | Actual revisions/deltas from commands B |
| 4.2 births/provenance | Tasks1–2,5 | Real creation/consume producers B; current bulk baseline C |
| 4.3 bounded receipts | Task1,5 | Transactional production/inspection B |
| 5 activation/reopen/ordinary liveness | Tasks4–6 | Real close-versus-save transaction race B |
| 6 lifecycle interface/commands | Types/validation only | Complete protocol/facade/writer B; recovery C |
| 7 transactions/barrier cuts/publication | Activation transaction only | Command transaction plans, post-cut admission and deltas B; working-owner UI D |
| 8 bulk replacement/history | Birth primitives only, no bulk exception | Complete two-lane reset and queue/history tests C |
| 9 uncertainty/cross-tab | Activation lost-ack/fences | Workspace inspection B; bulk inspection C; native matrix D |
| 10 recovery/compatibility | Separate retained/current reads and acceptance metadata | Recovery mutation/source bridge C; export/UI routing D |
| 11 verification | Foundation subset and connected original gates | Full command/failure/native performance coverage B–D |
| 12 release boundary | Milestone sequence and explicit file scope | Full integration and independent cutover authorization D |

## Plan self-review and execution status

- [x] Verify function/type names across task interfaces and tests; birth origin includes the member ordinal used by deterministic incarnation verification. No new helper is presented as an already implemented production API.
- [x] Confirm every proposed change is within A's file map and every excluded full-spec requirement is mapped above. Historical validator/schema compatibility and current legacy acceptance are explicit.
- [x] Scan for unresolved placeholders and remove them; B/C/D dependencies are not acceptance of missing production behavior. No application implementation step is marked complete.
- [ ] Execute inline with test-first implementation and connected checkpoints. User's no-commit/no-handoff instructions override generic skill defaults.

Implementation was subsequently authorized and executed inline. The checkpoint above distinguishes implemented foundation behavior from incomplete full covering gates. B/C/D and production cutover remain unimplemented and unauthorized by this checkpoint.
