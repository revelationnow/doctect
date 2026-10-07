# Normalization Source Reads and Prepared Emission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. The user selected inline controller implementation, not implementation subagents or handoffs. Read-only investigation/review is permitted. Steps use checkbox (`- [ ]`) syntax for tracking. Do not stage or commit.

**Goal:** Remove unused target derivation from retained-source reads and the fifth success-path target derivation from staging without weakening independent durable verification or any existing limit.

**Architecture:** Factor source/archive derivation inside the existing repository owner. During the first target pass, the existing codec records metadata-only projection recipes against its private immutable source capture; a private emission module replays those recipes for bounded stage batches. Verification, activation and active reopen keep their own captures, untraced derivations, comparisons and seals.

**Tech Stack:** TypeScript, existing cooperative Work runtime, IndexedDB, Vitest 4, fake-indexeddb 6, Vite 6. No new dependency.

## Global Constraints

- Written contract: `docs/superpowers/specs/2026-09-26-normalization-emission-work-design.md`, approved2026-09-26. Original incremental, fold, bounded-normalization, source-admission and workspace-authority specifications remain binding.
- Inline execution approved2026-09-27 after the overall-scope explanation. Task completion still requires actual implementation and verification; approval does not waive any gate.
- Worktree `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence`; branch `feat/incremental-local-persistence`; HEAD `8a2872d9a5acae1be3022923c4c515c70212de83` unchanged.
- Inline controller implementation; no commits, staging, merges, dependency changes, destructive cleanup, source/sibling-worktree edits, deployment or existing-profile migration. Preserve the intentionally dirty tree and empty index.
- Preserve protected launcher PID2397595 and ports3000/3001. Do not restart the stopped4310/4311 preview or modify its retained SQLite database. No browser experiment is needed to implement this private slice.
- Production `WORKSPACE_DB_VERSION=2`; private normalized physical version3 and existing fourteen stores unchanged. No durable field, frame domain, public storage interface, transport or external-format change.
- One normalized writer. No fallback historical editing, mixed writer, new authority cache, retained-source deletion or current-membership workaround.
- State limit32MiB, depth512, history50; external IDs nonempty and uncapped by private command-ID limits. No project/workspace/physical-record cap inferred from the AppState limit.
- Work quantum1024visits/64KiB emitted bytes; JSON fragments64UTF16units/max192UTF8bytes; SHA step<=192bytes/600visits; count-only quoted scans127units. Charge actual lookups, constructions, comparisons, hashes, buffers and retained metadata.
- Stage<=64records/256KiB framed payload except one valid oversized singleton. Preserve exact project/store/record order and existing record/frame bytes.
- Success budgets<=8full-set reads/<=4source and target derivations; legacy captures<=5uncontended/2active; retries<=8. A genuine second emission traversal is allowed; another semantic derivation is not.
- Preserve complete independent resumed-prefix validation, fresh verify/activate/reopen captures and final exact seals. No cached preparation hash or recipe certifies a later phase.
- No asynchronous hashing, yield or passive observer inside IDB transactions. The already approved synchronous exact single-record seal exception is unchanged.
- Preserve quiet final legacy/publication fences, cancellation precedence and old/new durable outcomes after lost acknowledgement. Rejection does not imply rollback.
- No deadlines, fixtures, assertions, Work quanta or budgets reduced/relaxed. Existing5000ms cases and original360000ms32MiB case remain acceptance gates.
- Proof windows<=32entries/64KiB and private command IDs<=256UTF8bytes unchanged. Ordinary incremental saves retain their existing operation budgets and never consult this plan.
- Logical ownership is not native heap evidence. Retain one source graph plus metadata/current-project/batch; no all-project normalized payload cache, serialization cache or uncharged reference index.
- Focused RED/GREEN runs use one worker; connected runs use at most2workers. Record isolated and connected timing separately.
- Known unrelated typecheck failure: `tests/unit/gallerySamples/stickerPress.test.ts(793,36): TS2339 Property 'length' does not exist on type 'never'`. Do not suppress it or claim a green full typecheck.
- Original Task11b81-file baseline and47-path allowlist remain immutable. Extend audits by exact paths only. `.superpowers/sdd/progress.md` is untracked and must never be staged.

---

## Planning verification — 2026-09-27

This is documentation verification, not implementation or runtime acceptance. All25 execution steps remain unchecked.

Execution baseline: `/tmp/opencode/doctect-incremental-sdd/task-13-emission-baseline/manifest.json` captures the pre-execution dirty tree, not HEAD-only history. Fresh original derivation test fails5-versus4 in1415ms,647 cases collected/no unhandled errors; `task-13-emission-baseline-gate-01.jsonl`. Runtime/test/config stamp matches the planning checkpoint below. No dependency installation or new worktree was needed.

- `/tmp/opencode/doctect-incremental-sdd/check-normalization-emission-plan.mjs` passes: six tasks,25 steps,35 balanced fenced blocks,26 TypeScript examples parsed without syntax diagnostics, required contracts/links present. Parsing examples is not an application typecheck or proof that the future implementation passes.
- Eight external diagnostic tests pass: four new plan-checker tests plus four existing reporter/batch-runner tests. One initial negative test incorrectly edited the header's inline checkbox example instead of a task checkbox; anchoring the mutation to a line-start task corrected that diagnostic fixture without weakening validation.
- Exact scope audit passes:86 authorized cumulative changed paths,51-of81 prior blobs retained; HEAD/empty index/whitespace/protected hashes intact. Original baseline/allowlist untouched.
- Runtime/test/config source stamp remains `05e6291ebc06cdc3ac58fe37943614d589b0240f6ddcc647e3ef5bfc2f309244` across1165 files. No runtime, application-test, schema or configuration change in this planning checkpoint. Application tests/build not rerun for these documentation-only changes; existing migration failures remain open.

## Starting evidence and execution sequence

### Current execution checkpoint

Task-level status here is authoritative; detailed task recipes below remain available as implementation/verification references.

Latest follow-up: [validation consolidation](2026-09-27-normalization-validation-consolidation.md) is implemented and separately verified at stampd5ee878940ba31bf9b67dd17f3747de360dc6ff992fba7c271ada996858887d6. Current migration covering set is634PASS/26timeouts across660 cases, including the original32MiB360s failure. The emission-only checkpoint below remains historical evidence; Tasks5/6 are still open, not closed by reduced scan counts.

- [x] Task1 source-only derivation and safety coverage (details below).
- [x] Task2 optional partition decision recording;12 new cases,73 partition/fold cases pass. One earlier unchanged pinned-artwork5s timeout passed cold3753ms and in the final connected run3862ms. No fixture/deadline changes.
- [x] Task3 opaque source-bound recipe owner/replay;43 tests pass. RED96-byte initial-suspension leak fixed with guarded allocation. Read-only review identified final-yield disposal, Work thenable-probe getter execution and missing second merge buffer; seven RED regressions now pass, re-review no findings. Exact capability checks39PASS; no shared Work/hash changes.
- [x] Task4 first-pass codec provenance/finalized recipes;12 new cases. Connected286 codec/partition/emission cases PASS20.63s, original pinned fixtures retained; tsc known Sticker Press TS2339 only. Read-only codec review no findings. Private partitioned/template binding helpers connect metadata to actual result containers; separate weak indexes prevent payload/template alias-role confusion. External raw-fold values are identical and exported property order matches the untraced codec's existing collapsed-at-end policy; normalized record frame bytes remain exact.
- [ ] Task5 integration verification: session and strict-stage replay implemented. Actual4-target/source4 gate PASS1579ms with planned1+untraced3 phases, zero stage semantic calls; stage batching regression PASS2867ms. Prefix/cancellation/strict replay4 new cases pass. Review requested stronger negative batch and release-before-recapture coverage; six added cases plus original budget gate pass. Two new130-node end-to-end physical parity cases still time out5000ms, including isolated attempts. Diagnostic fresh path: prepared1206ms, oracle2035ms, staged2112ms, physical assertions2144ms, verified4066ms; activation exceeded deadline. Temporary timing instrumentation removed. No acceptance or timeout amendment.
- [ ] Task6 acceptance remains blocked by runtime limits. Full current covering evidence, connected suites, historical suites, boundary checks, build and scope audit have run; results below are not a green normalization milestone.

Evidence: `task-13-emission-budget-01.jsonl` (647-case inventory), `task-13-emission-integration-01.jsonl` (653 inventory,4PASS/2timeouts), isolated `task-13-emission-{fresh,historical}-parity-01.jsonl`, and `task-13-emission-review-regressions-01.jsonl` (659 inventory,7PASS). Artifact paths are under `/tmp/opencode/doctect-incremental-sdd`. Do not merge results from different source states into a purported single green gate.

### Current verification evidence — source stamp012966351b041366b4106959901e315db22e057ca3fac73a06c5c00c74b0b975

- All659 current migration cases have outcomes at unchanged deadlines:632PASS/27timeouts, no missing cases, other assertion failures or unhandled/module errors in the covering set. The105-case focused run contributed102PASS/3timeouts; isolated original32MiB contributed one360000ms timeout; a disjoint553-case campaign contributed530PASS/23timeouts. Exact merged evidence: `/tmp/opencode/doctect-incremental-sdd/task-13-emission-covering-01.json`; campaign `task-13-migration-cases-0-659-qoiiT5`. Runtime/test/config hash stayed identical before/after;1169 files.
- Separately, the42 original short-timeout comparison cases ran one per fresh process:22PASS/20timeouts at5000ms, campaign `task-13-migration-cases-0-659-XA7nHS`. Some cases pass warm and fail cold or vice versa; do not replace the covering set with a best-of-reruns total or infer a controlled speedup from differing cohorts.
- Original32MiB gate still TIMEOUT360004ms under360000ms. No size/depth/fixture/assertion/deadline change. Read-only phase diagnosis of the new wide case identifies independent verification/activation after fast stage replay; broader remaining CPU/source/seal attribution needs fresh profiling before another optimization proposal.
- Connected672 tests/15files PASS150.07s, including private real-editor/worker paths, ordinary-save isolation, source retention, workspace authority and codec/emission/partition tests. Historical331 tests/4files PASS11.27s. Full boundary945PASS/no unhandled errors. These commands overlap earlier focused evidence; do not sum into a claimed single suite run.
- Build `/tmp/opencode/doctect-incremental-sdd/task-13-emission-build-01` PASS12.41s/2468modules. Only existing bundle-size warnings; no production entrypoint/version change. Typecheck retains only known Sticker Press TS2339 at the latest implementation check.
- Runtime scope audit `audit-normalization-emission-runtime.mjs` PASS90 authorized cumulative paths/51-of81 retained blobs; original baseline/allowlist, HEAD, empty index, whitespace and protected hashes intact. Planning-only checker remains a historical receipt, not an execution checker.
- Source-only, primitive/projection, codec and repository integration received read-only reviews. Concrete primitive defects had RED→GREEN tests; integration coverage gaps gained exact negative batch and temporal release tests. Final scoped rechecks report no remaining findings, not performance acceptance.

No commits, profile migration, production cutover or lifecycle B/C/D work. Four real derivations are now proven, but Tasks5/6 remain incomplete until unchanged runtime gates close.

### Post-emission diagnosis — no application changes

Source stamp remains012966351b041366b4106959901e315db22e057ca3fac73a06c5c00c74b0b975/1169files. Fresh original wide-workspace repro again failed5000ms (5146ms reported), `task-13-emission-diagnosis-repro-01.jsonl`. This diagnosis does not supersede the659-case acceptance results above.

External tools `/tmp/opencode/normalization-phase-{tools.mjs,tools.test.mjs,probe.ts}`, `normalization-phase.config.mjs` and `run-normalization-phase.mjs` isolate one real session phase after real preparation/staging. Vite applies instrumentation in memory; no repository runtime/test/config file is edited. Each diagnostic adds one skipped-by-default measurement case to the existing module (660 collected,659 original cases skipped). Preparation occurs in the diagnostic setup hook; these phase-only passes are **not** end-to-end5000ms acceptance. No original timeout, fixture or32MiB limit is changed.

#### Measured phase decomposition

130-node fresh-source diagnostic, original runtime/algorithms, one worker:

| Phase/run | Wall ms | Capture ms | Target derivation ms, including source | Reconstruct ms | Seal ms | Yield wait ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Verify, no CPU sampler (`9A8yXD`) | 1886 | 102 | 1188 (source651) | 237 | 293 | 34 |
| Verify, sampled (`POkpOb`) | 1929 | 117 | 1225 (source682) | 238 | 286 | 35 |
| Activate, sampled (`1QsiAW`) | 2060 | 113 | 1339 (source686) | 246 | 294 | 39 |
| Reopen, sampled (`yN04xt`) | 2177 | 103 | 1180 (source638) | 223 | 319 | 38 |

Directories are `/tmp/opencode/doctect-incremental-sdd/task-13-phase-<suffix>/`, containing `phase.json`, command/source-stamp receipts and, when sampled, `phase.cpuprofile`/`cpu-summary.json`. Labels such as source/hash/decomposition are nested inside target derivation; **do not sum nested inclusive spans**. Reopen also performs current-workspace admission outside the displayed major spans. Inspector stop/start contributes roughly90–120ms to sampled profile totals but lies outside recorded phase wall time. Source-map/transformed line numbers are diagnostic, not direct source locations.

One verify phase captures about76KB, yet performs3,893,795 visits,6,776,551 lifecycle checks and3892 yields. Reopen performs7,905,458 checks. JSON helpers plus Work execution account for roughly1.1–1.25s of sampled self time; independent no-span sampling (`4mT2rM`) confirms the same dominant modules without the diagnostic generator wrappers. Captures are roughly0.1s; seals roughly0.3s; yield waits roughly0.035s. This is primarily CPU/traversal/dispatch cost, not a slow asynchronous IndexedDB wait or SHA compression bottleneck.

#### Larger-payload diagnostic, not the boundary gate

Legal1MiB payload probes stay under the unchanged32MiB cap. Fresh node-data verify (`tVM4mt`):2712ms,126,108,456 visits,133586 yields,4,206,138 hash bytes,412ms yield wait. Historical state-padding verify (`VimiC0`, matching the large gate's source category/padding location):2637ms,110,848,137 visits,116354 yields,3,190,649 hash bytes,368ms yield wait. Historical reopen (`u03Pkv`):2717ms,140,369,767 visits,143834 yields,408ms yield wait.

Historical1MiB sampled self time: JSON helpers861ms, Work execution702ms, SHA compression105ms. These samples support traversal/dispatch amplification and show yield overhead becoming material as payload grows. They do not establish linear32MiB timing or replace the actual360s failure. Fresh256KiB (`DVP1WG`) and fresh1MiB have different archive ancestry from historical padding; do not combine them into a purported controlled boundary benchmark.

#### Same-pass traversal map

Read-only trace identifies a concrete design seam, not authorization to skip checks:

- `services/localWorkspace/migration.ts:644–652` composes `checkMigratedStateWork(raw.initialState)` with `checkWorkspaceProjectWork(raw)` for validation-only stored records.
- `services/localWorkspace/validation.ts:96–105,119–168,187–205` consequently performs six canonical traversals, three AppState validations and one full-state working clone per stored project. The loader still applies text/generator normalization and warning rules to that clone; its result is discarded by the check path while original captured source is retained.
- `normalized/codec.ts` then validates source again for expected decomposition and validates physical target envelopes, reconstructed output and ledgers. Expected-target-vs-durable-target, reconstructed-target-vs-source and final live-vs-captured seals are distinct safety comparisons and must remain.
- Current schema does not mean loader compatibility/warning checks may be omitted. Depth/getter/JSON/size/active-variant/warning behavior and raw-source preservation require an explicit equivalence contract before consolidating the source checks.

#### Isolated hypothesis probes

- Observer retention: paired uninstrumented verify runs with retained events2120/1778ms versus no observer1766/1839ms; work/hash/read counters identical. Effect is noisy and not consistently dominant. Production normalizer's default runtime has no Work observer; removing test observation would not explain or close production/boundary costs.
- Experimental32-code-unit comparator, external only: exact UTF16 comparison equivalence and authentic cancellation/accounting tests pass. Paired baseline1767/1815ms versus experiment1661/1694ms (~6% in this probe). Actual scanned units/visits **increase** by105836, checks fall6776551→6331253, hash/read/derivation facts unchanged. Too small to explain the remaining deficit alone; not promoted.
- Experimental short-string quotation, external only: JSON bytes/Unicode/64-unit/192-byte fragment bounds and1024-visit operation bound tests pass. Timings1520/2568ms versus adjacent baselines1752/1741ms are inconsistent. Conservative visit reservation rises3893795→6015173 and yields3892→6144. No reliable speedup claim; not promoted.

Experimental scripts are explicitly diagnostic: `/tmp/opencode/normalization-{compare,quote}-variant{,.test}.mjs`. They are never imported by application files and do not authorize new runtime behavior. Comparisons use one changed variable at a time; original validators, phase captures, seals and limits remain in the diagnostic path.

**Recommended next bounded design:** consolidate the *validation-only current-schema stored-project* composition in `services/localWorkspace/{validation,migration}.ts`, preserving original-graph checks, disposable loader compatibility/warnings and post-load validity while removing proven duplicate same-pass work. Keep public migration/import behavior, all independent phases and seals unchanged; no global receipts/cache or trusted-caller boolean. Specify equivalence tests for malformed JSON/getters/depth/size/generator/text defaults/active references and retained source before implementation. These files are outside this emission plan's runtime scope, so a written scope/design amendment is required. The small primitive prototypes are secondary evidence, not a substitute for that design or approval.

Diagnostic verification: nine external tool/prototype tests PASS; read-only interpretation review reports no findings. Fresh execution audit still90 authorized paths/51-of81 retained blobs with unchanged1169-file runtime/test/config stamp, HEAD/index/whitespace/protected hashes intact. No application build/test acceptance is inferred from the phase probes; last full app verification remains the recorded emission checkpoint above. Temporary experiments are retained only in the explicitly marked `/tmp/opencode` diagnostic location, never loaded by normal app/test configuration.

Follow-up2026-09-27: [current-schema stored-project validation consolidation](../specs/2026-09-27-normalization-validation-consolidation-design.md) was subsequently approved and implemented through its own bounded plan. Data-property stored-project checks now use3canonical scans while keeping all3AppState checks/oneclone/real loader; accessor envelopes preserve the original composition. No shared primitive/schema change or runtime-budget waiver. Full follow-up evidence is in that plan; Tasks5/6 remain open.

Execution checkpoint2026-09-27: Task1 source-only factoring and safety tests complete. Initial10-case RED had8 intended failures; new suite now33PASS. Selected connected source/recovery regression88PASS/4original5000ms timeouts; all4 passed in fresh isolated processes at3158/3319/3103/3521ms with unchanged limits, no missing/unhandled results. This is covering correctness evidence, not a green connected timing gate. Source stamp8b870b2df13f8d503acebd6c0ceb6ad43151ce1029e3420475cc590a05f440bd; campaign `task-13-migration-cases-0-1-qeVxFW`. Read-only review no findings; tsc only known Sticker Press TS2339. Derivation/runtime acceptance remains Task6.

Foundation tasks1–5 are implemented privately; acceptance remains open. Migration baseline641cases recorded589pass/43timeout/9assertion failures. After the retained-export correction and six added tests, collection is647;14 targeted assertions pass. Of42 isolated short-timeout retries,26 still fail5000ms. Original32MiB failed360000ms. Current success path derives targets5times, not4. Boundary940 and connected511 tests pass in separate recorded runs; these are not migration acceptance.

Execute Tasks1–5 in order, with their focused reviews/tests. Task6 is the connected milestone gate. Do not advance workspace lifecycle B/C/D or production cutover from this plan. If the real four-derivation gate closes but deadlines remain red, retain the failed evidence and diagnose fresh runtime cost before proposing another optimization.

| Task | Independently reviewable deliverable |
| --- | --- |
| 1 | Retained/source reads prove only source ancestry; all target consumers remain strict |
| 2 | Shared partition can report its actual structural decisions without changing the normal path |
| 3 | Private opaque metadata recipe owner, bounded replay and lifetime enforcement |
| 4 | Codec produces finalized recipes during its first real target derivation; independent byte parity |
| 5 | Session and strict stage use prepared replay; actual fifth derivation removed |
| 6 | Original gates, covering evidence, connected regression, build/typecheck and exact scope audit |

## File map and permitted scope

Paths are relative to the worktree above. Line anchors describe the planning baseline; use the named functions after earlier tasks move lines.

| Action/path | Responsibility |
| --- | --- |
| Modify `services/localWorkspace/normalized/repository.ts` | Split captured source facts from target preparation; retain/release private plan; replay in existing session/strict-stage owner only |
| Modify `services/document/partition.ts` | Optional metadata-only projection sink at existing classification/fold decisions; no storage import or live behavior change |
| Create `services/localWorkspace/normalized/emissionPlan.ts` | Private recipe construction, source-address resolution, opaque plan/cursor identity, cooperative materialization and ownership; no IDB or authority validation |
| Modify `services/localWorkspace/normalized/codec.ts` | Optional tracing of the existing producer, select/projection metadata and final record envelopes; keep untraced oracle and ordinary bulk functions |
| Create `tests/unit/localWorkspace/normalized/sourceReads.test.ts` | Zero-target source reads, source/target evidence separation, source seal and recovery eligibility |
| Modify `tests/unit/document/partition.test.ts` | Traced/untraced equality, decision metadata, holes/raw folds and cancellation |
| Create `tests/helpers/normalizationEmissionFixtures.ts` | Explicit non-authoritative pure codec source fixtures and cursor collection; no fake durability |
| Create `tests/unit/localWorkspace/normalized/emissionPlan.test.ts` | Recipe/cursor lifecycle, source identity, malformed metadata, ownership and cancellation |
| Modify `tests/unit/localWorkspace/normalized/codec.test.ts` | Planned/untraced target parity, payload borrowing, late envelope finalization and semantic-call isolation |
| Modify `tests/unit/localWorkspace/normalized/migration.test.ts` | Strengthen existing derivation/stage assertions; independent physical parity, resume/strict-stage/fault evidence |
| Modify `tests/unit/localWorkspaceBoundary.test.ts` | Filename-specific emission module edges and denial tests |
| Documentation | This plan, approved emission spec/link, workspace foundation link and execution ledger |

Existing `tests/helpers/normalizationHarness.ts`, `normalizationWorkHarness.ts` and `incrementalFixtures.ts` are reused unchanged. No Work/hash primitive, durable schema, validator policy, size-ledger algorithm, repository public interface, worker protocol, UI, production store or build/test-config edits. A necessary change outside this map requires a concrete scope review first. Do not clean up the repository's old unused synchronous helper chain as part of this optimization.

## Shared interfaces and ownership rules

### A. Source facts are not target authority

Private to `repository.ts`; do not export these or modify `NormalizedRepository`:

```ts
type SourceMarkerFacts = Pick<NormalizationAttempt,
  'attemptId' | 'storageGeneration' | 'sourceKind' | 'sourceProjects' |
  'sourceDigest' | 'sourceWorkspaceRevision' | 'sourceLedgerRevision' |
  'sourceArchiveId' | 'sourceArchiveDigest' | 'contentDigest'>;

interface CapturedSourcePass {
  source: NormalizationSource;
  archive: NormalizationSourceArchive;
  facts: SourceMarkerFacts;
  marker?: NormalizationAttempt;
  rows: SourceCapture;
  additionalBackups: LegacyBackupRecord[];
}
interface SourceDerivationOptions {
  allowFresh: boolean;
  purpose: 'retained' | 'target';
  suppliedSeed?: SourceRows;
}
interface TargetDerivationOptions {
  allowFresh: boolean;
  collectImages?: boolean;
  mode?: 'baseline' | 'active';
  suppliedSeed?: SourceRows;
  prepareEmission?: boolean;
}
```

`deriveCapturedSource(candidate: PagedCapture, options: SourceDerivationOptions): Promise<CapturedSourcePass>` owns the existing source selection/validation/digests/archive agreement. `deriveTarget(candidate: PagedCapture, options: TargetDerivationOptions): Promise<PreparedPass>` calls it with `purpose:'target'`, then performs the existing target/current-manifest work. `PreparedPass` gains only `emissionPlan?: EmissionPlan`.

### B. Partition reports decisions, not payloads

Export these types from `services/document/partition.ts`. They contain no storage concepts. This is an internal seam for the normalized codec, not a UI callback or public progress event.

```ts
export type PartitionProjectionEvent =
  | { kind: 'state-field'; field: string;
      owner: 'document' | 'preference' | 'compatibility' }
  | { kind: 'template'; variantId: string; templateId: string;
      projection: { kind: 'borrow' } | {
        kind: 'layers'; fieldOrder: readonly string[]; length: number;
        present: readonly { index: number; fieldOrder: readonly string[] | null }[];
        folds: readonly { index: number; key: string; owner: 'boolean' | 'exception' }[];
      } };
export type PartitionProjectionSink = (event: PartitionProjectionEvent) => Work<void>;

export function partitionStateWork(
  state: AppState,
  recordProjection?: PartitionProjectionSink,
): Work<PartitionedState>;
```

`fieldOrder:null` on a present layer means borrow that source layer unchanged. A string list is the exact key sequence emitted by `withoutCollapsedWork`, including an empty list. `present` omits holes and includes present null/primitive entries. A template with a non-array/absent `layers` field uses `kind:'borrow'`. Raw `collapsed` values never appear in events; fold entries give source position plus the address/owner already chosen by partition. `transient` and unknown state fields report `owner:'compatibility'`.

The sink consumes each event before partition continues. Event buffers have a protected temporary lease; the codec creates its own owned recipes before the event lease releases. Untraced `partitionState`/`partitionStateWork` allocate no projection buffers and keep existing copy/reference/presence behavior.

### C. Opaque emission owner

`emissionPlan.ts` imports runtime code only from `shared/cooperativeWork.js`, `shared/jsonWork.js` and normalized `schema.ts`. Schema/codec-facing record types are type-only imports. It imports neither repository/codec nor any validator, partitioner, size ledger, hasher, IDB or browser capability.

```ts
import type { Work } from '../../../shared/cooperativeWork.js';
import type { NormalizationSource, ProjectStoreName, TaggedNormalizedRecord } from './schema';

declare const recipeBrand: unique symbol;
declare const planBrand: unique symbol;
export type EmissionRecipe = { readonly [recipeBrand]: true };
export type EmissionPlan = { readonly [planBrand]: true };
export type SourceAddress = readonly (string | number)[];
export type EmittedTarget = Exclude<TaggedNormalizedRecord, { store: 'normalizationLedger' }>;
export interface EmissionBuilder {
  borrow(address: SourceAddress): Work<EmissionRecipe>;
  literal(value: string | number | boolean | null): Work<EmissionRecipe>;
  object(fields: readonly (readonly [string, EmissionRecipe])[]): Work<EmissionRecipe>;
  array(length: number, present: readonly (readonly [number, EmissionRecipe])[]): Work<EmissionRecipe>;
  append(store: ProjectStoreName, record: EmissionRecipe): Work<void>;
  finish(): EmissionPlan;
  dispose(): void;
}
export interface EmissionCursor {
  next(): Work<IteratorResult<EmittedTarget, void>>;
  dispose(): void;
}
export function createEmissionBuilder(source: NormalizationSource): EmissionBuilder;
export function openEmissionCursor(
  plan: EmissionPlan, source: NormalizationSource, firstOrdinal: number,
): EmissionCursor;
export function disposeEmissionPlan(plan: EmissionPlan): void;
```

Use private WeakMaps for handles and one owner state per builder/plan. No exported constructor, inspect/serialize function or mutable array. Recipe handles from another owner, forged plans, foreign source identity, early/double finish, invalid ordinals, disposed owners and concurrent use fail before a record can be written. A plan permits one active cursor; each repository cursor covers one bounded batch and is disposed in `finally`.

`literal` is for private envelope constants, computed counters/sizes/digests and structural metadata only. User names, scripts, opaque extension/fold values and other source payload fields use `borrow`. This is a private codec contract, not a general caller-provided serializer. Builder input is never accepted through repository/worker interfaces. Missing/accessor source locations fail without invoking getters. Immutability of the private capture is a precondition; do not add a full rehash to police illicit mutation of an internal graph. Public/provider mutation is covered at the existing capture/detachment seams.

Plan metadata, addresses and nodes are charged as allocated. Opaque payloads are borrowed from the separately owned capture. A cursor owns the shallow output containers it materializes for its current batch; it does not clone/hash or charge borrowed SVG/script bodies as new metadata. The existing framed-batch lease remains a separate conservative batch budget, not a heap measurement. Closing a cursor releases its containers, not the plan. Closing the plan invalidates its cursor, clears source references/metadata and releases all plan ownership. Disposal remains legal after runtime cancellation and is idempotent for genuine owners.

Factories create constant-sized handles with no owned buffer yet; their first Work operation registers/protects the lease before growth. `finish`, cursor opening and plan transfer are synchronous reference bookkeeping, charged in an enclosing `effect(1, ...)` that assigns the receiving owner's variable **inside** the effect. This prevents a guard failure after an operation/terminal generator return from stranding newly transferred ownership before an awaiting caller receives it. No payload work or unbounded walk is allowed in these synchronous methods.

### D. Codec produces and transfers a plan once

Add alongside existing `TargetCursor` in `codec.ts`:

```ts
export interface PlannedTargetCursor extends TargetCursor {
  takeEmissionPlan(): EmissionPlan;
}
export function createPlannedTargetCursor(source: NormalizationSource): PlannedTargetCursor;
```

This wraps the same `targetCursor`/`decomposeWork` producer, with recording enabled. `createTargetCursor`, `prepareNormalizationTarget`, `decomposeProject` and `decomposeProjectWork` stay untraced by default. `takeEmissionPlan` succeeds exactly once, only after `next()` has returned `done:true`; ownership transfers to the repository. Disposing an unfinished cursor releases its partial builder; disposing after transfer must not release the transferred plan. The repository never constructs record recipes itself.

## Task 1: Separate source-only derivation from target preparation

**Files:**
- Modify `services/localWorkspace/normalized/repository.ts`: `derive`673–915, `retainedRead`1057–1089, existing target callers.
- Create `tests/unit/localWorkspace/normalized/sourceReads.test.ts`.

**Interfaces:** consumes current bounded captures/seal and A; produces `deriveCapturedSource`/`deriveTarget` while preserving all public methods. `prepareEmission` is not used until Task5.

- [x] **1. Write a failing source-only observation test.** Use node/fake-IDB, real historical admission and real source export. Include `afterEach(() => vi.restoreAllMocks())`; explicitly close adapters in every test.

```ts
// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import * as codec from '../../../../services/localWorkspace/normalized/codec';
import * as manifests from '../../../../services/localWorkspace/normalized/workspaceManifest';
import { createNormalizedRepository } from '../../../../services/localWorkspace/normalized/repository';
import { createNormalizationHarness } from '../../../helpers/normalizationHarness';
import { makeWorkHarness } from '../../../helpers/normalizationWorkHarness';

afterEach(() => vi.restoreAllMocks());
it('retained source validates and seals without deriving a target or manifest', async () => {
  const h = await createNormalizationHarness();
  await h.adapter.open();
  expect((await h.historical.bootstrap(() => {}, { allowCopiedReplacement: false })).status).toBe('admitted');
  const repository = createNormalizedRepository(h.environment);
  const cursor = vi.spyOn(codec, 'createTargetCursor');
  const manifest = vi.spyOn(manifests, 'createInitialWorkspaceManifest');
  const w = makeWorkHarness('retained');
  try {
    const source = await repository.readRetainedSource(w.runtime);
    expect(source.snapshot.projects).toEqual(h.prepared.projects.map(row => row.project));
    expect(w.runtime.snapshot().sourceDerivations).toBe(1);
    expect(w.runtime.snapshot().targetDerivations).toBe(0);
    expect(w.runtime.snapshot().sealTransactions).toBe(1);
    expect(w.runtime.snapshot().ownedBytes).toBe(0);
    expect(cursor).not.toHaveBeenCalled();
    expect(manifest).not.toHaveBeenCalled();
  } finally { h.adapter.close(); }
});
```

Run: `npx vitest run tests/unit/localWorkspace/normalized/sourceReads.test.ts --maxWorkers=1 --silent=passed-only`.
Expected RED: target derivation1/manifest call, not fixture admission failure.

- [x] **2. Extract source facts before the current first manifest creation.** Move the existing `derive` block from source-row collection through archive agreement into `deriveCapturedSource`; preserve each validation/hash/archive-allocation statement. Replace only `mode === 'retained'` source-selection branches with `options.purpose === 'retained'`. Keep additional backup validation for target consumers. Return A plus this exact fact construction/check, using existing frame helpers:

```ts
const facts: SourceMarkerFacts = {
  attemptId: `normalization:${source.sourceDigest}`,
  storageGeneration: `normalized:${source.sourceDigest}`,
  sourceKind: source.kind, sourceProjects: source.sourceProjects,
  sourceDigest: source.sourceDigest,
  sourceWorkspaceRevision: source.records.workspace.revision,
  sourceLedgerRevision: source.ledger?.ledgerRevision ?? null,
  sourceArchiveId: archive.id, sourceArchiveDigest,
  contentDigest: source.contentDigest,
};
if (marker) {
  const observed: Record<string, unknown> = {};
  for (const field of await work.run(primitive('keys', () => Object.keys(facts)))) {
    await work.run(effect(1, () => {
      Object.defineProperty(observed, field, { value: marker[field as keyof SourceMarkerFacts],
        enumerable: true, writable: true, configurable: true });
    }));
  }
  requireContract(await work.run(equalFrameWork(canonicalFrame(observed), canonicalFrame(facts))),
    'Normalization source mismatch');
}
return { source, archive, facts, marker, rows, additionalBackups };
```

`validateNormalizationLedgerWork` still runs before archive selection: target fields/versions/phase counters remain structurally checked. Do not compare `targetManifestDigest`, `initialWorkspaceDigest`, `recordCount` or semantic verification digest here. Source facts are neither a synthesized `NormalizationAttempt` nor a verified target.

- [x] **3. Reconnect the two consumers.** Rename the remaining target body `deriveTarget`; start it as follows, then retain the original initial/current manifest, physical-index, expected-target stream, marker equality, target-verification hash and baseline ancillary checks. Remove its now-impossible retained branches, not any baseline/active checks.

```ts
const { allowFresh, collectImages = false, mode = 'baseline', suppliedSeed } = options;
const basis = await deriveCapturedSource(candidate, { allowFresh, purpose: 'target', suppliedSeed });
const { source, archive, facts, marker, rows, additionalBackups } = basis;
const kind = source.kind;
const sourceArchiveDigest = facts.sourceArchiveDigest;
```

Construct the expected attempt with `...facts` plus the existing target/count/phase fields. After copying the marker's phase fields, compare the **whole** marker/attempt as before. For non-staging markers always validate the semantic verification digest in this branch.

In `retainedRead`, keep capture-store choice/hint agreement/selected-backup readonly seal unchanged; replace only `pass = await derive(...)` with local source facts:

```ts
const retained = await deriveCapturedSource(captured, { allowFresh, purpose: 'retained' });
const result = retained.source.kind === 'fresh' && hint !== undefined
  ? { ...retained.source, retainedSeed: true as const } : retained.source;
```

Use `retained.archive`/`retained.source.backups` in the exact existing backup-key selection. No target-bearing `pass` is installed. Keep `releasePreparation()` after successful seal and failure cleanup in `operation`/`withRead`.

Replace existing target calls with explicit options: prepare `{allowFresh}`; transitions/staged-read `{allowFresh:false,collectImages:true}`; active read additionally `mode:'active'`; strict reserve includes the existing `suppliedSeed`; strict stage `{allowFresh:false}`. `source()` continues calling `retainedRead(true)`; recovery `retained()` continues using defaultfalse.

- [x] **4. Add the source/target non-substitution matrix, then run GREEN.** Keep complete existing migration/recovery tests; new tests use independent `physicalRows` and `mutateRow`, never a repository cache as oracle.

| Case | Required assertion |
| --- | --- |
| Historical source before reservation; staging, verified and active marker | One source derivation/one readonly seal, zero target cursor and zero initial/current-manifest build |
| Strict `readNormalizationSource()` | Same zero target/manifest calls; returned shape/digests unchanged |
| Well-shaped wrong target-manifest, initial-workspace, target count or verification digest | Retained export succeeds unchanged; target reserve/resume/verify/activate/reopen rejects at its applicable full check |
| Wrong source/content/archive digest or source revision/identity | Retained read rejects, no write, no returned recovery authority |
| Wrong marker version/shape/phase counters | Rejected before trusting archive reference; no getter execution |
| Exact referenced archive/backup mutation at `before-seal` | Contention, unchanged storage, ownedBytes0 |
| Unrelated later corrupt backup/live ancillary/target row | Existing retained-only dependency exclusions preserved; active/write checks remain strict |
| Fresh empty DB with no marker | `readRetainedSource` refuses; strict source read may prepare seed without making it retained/exportable |
| Fresh reserved archive | Retained result has `retainedSeed:true`; no second seed/archive |

For non-substitution, first obtain a valid retained result, corrupt well-shaped durable target evidence, then pass that source to `reserveNormalization`; it must not reserve through source-only validation. Use staging marker corruption for reserve/strict-stage and verified-marker corruption for activate, so a wrong-phase rejection cannot falsely satisfy the intended test. Compare every physical row before/after each refused write.

Run: `npx vitest run tests/unit/localWorkspace/normalized/sourceReads.test.ts tests/unit/localWorkspace/normalized/migration.test.ts --testNamePattern='retained|sealed read|source-only|recovery routing|strict source' --maxWorkers=1 --silent=passed-only`.
Expected: source-only new assertions PASS; retain any unchanged runtime failures as failed evidence, not a waiver. Review diff; record RED/GREEN and source-seal evidence in the ledger. No commit.

## Task 2: Record partition's structural decisions without reclassifying them

**Files:** modify `services/document/partition.ts`: `withoutCollapsedWork`, `mapLayersWork`, `partitionStateWork`78–159; modify `tests/unit/document/partition.test.ts`.

**Interfaces:** consumes existing `AppState`/`PartitionedState`; produces B. No storage or emission-module import is permitted here.

- [ ] **1. Add a failing traced/untraced decision test.** Import `type PartitionProjectionEvent` and `partitionStateWork`; retain current sparse/raw compatibility tests unchanged. New test uses a new one-template fixture:

```ts
it('records chosen fold owners and sparse projection without retaining payload values', async () => {
  const state = makeIncrementalProject(1).initialState;
  const template = state.variants.default.templates['page-0'];
  template.layers = [
    { collapsed: true, id: 'dup', name: 'A' },
    { id: 'dup', collapsed: { raw: 'opaque-fold-sentinel' } },
    { id: 'unique', collapsed: false },
    , null,
  ] as unknown as Layer[];
  const events: PartitionProjectionEvent[] = [];
  const w = makeWorkHarness();
  const traced = await w.runtime.run(partitionStateWork(state, function* (event) {
    events.push(structuredClone(event));
  }));
  const plain = await w.runtime.run(partitionStateWork(state));
  expect(traced).toStrictEqual(plain);
  expect(events.find(event => event.kind === 'template')).toEqual({
    kind: 'template', variantId: 'default', templateId: 'page-0', projection: {
      kind: 'layers', fieldOrder: Object.keys(template), length: 5,
      present: [
        { index: 0, fieldOrder: ['id', 'name'] },
        { index: 1, fieldOrder: ['id'] },
        { index: 2, fieldOrder: ['id'] },
        { index: 4, fieldOrder: null },
      ],
      folds: [
        { index: 0, key: '["default","page-0",0]', owner: 'exception' },
        { index: 1, key: '["default","page-0",1]', owner: 'exception' },
        { index: 2, key: '["default","page-0","unique"]', owner: 'boolean' },
      ],
    },
  });
  expect(JSON.stringify(events)).not.toContain('opaque-fold-sentinel');
  expect(w.runtime.snapshot().ownedBytes).toBe(0);
});
```

Run: `npx vitest run tests/unit/document/partition.test.ts --testNamePattern='records chosen fold owners' --maxWorkers=1`.
Expected RED: event absent. New parameter/type alone is not GREEN.

- [ ] **2. Add B and record at the existing decisions.** In the current state-field loop, return the chosen destination from its `effect`, then call the sink. Do not run a second classifier later:

```ts
for (const [field, value] of entries) {
  const destination = yield* effect(1, () => {
    const kind = owner(field);
    defineData(kind === 'document' ? document : kind === 'preference' ? preferences : compatibilityState, field, value);
    return kind === 'document' || kind === 'preference' ? kind : 'compatibility';
  });
  if (recordProjection) yield* recordProjection({ kind: 'state-field', field, owner: destination });
}
```

Within each existing template callback, allocate projection buffers only if a sink exists. Keep the original duplicate-ID count pass. For array templates record `length`, exact copied-template field order and one `present` cell at the same `index in source` decision as `mapLayersWork`. For a stripped layer, collect keys **inside** `withoutCollapsedWork` when each key is defined; do not compare the stripped layer to its source afterward. For untouched layers set `fieldOrder:null`. Add optional private parameters to those two helpers for this collection; default assembly callers do not supply them.

Capture the already computed fold key and owner, at the existing branch:

```ts
const booleanOwner = typeof collapsed === 'boolean' && typeof layer.id === 'string' && counts.get(layer.id) === 1;
const key = yield* jsonTextWork([variantId, templateId, booleanOwner ? layer.id : index]);
if (booleanOwner) layerCollapsed[key] = collapsed as boolean;
else layerCollapsedExceptions[key] = { value: collapsed };
```

When tracing, append `{index,key,owner:booleanOwner?'boolean':'exception'}` to that template's metadata, then deliver one completed `template` event. The source raw value stays only in the normal partition output/source, never in the event. For absent/non-array layers deliver `projection:{kind:'borrow'}` and return the original template as before. For `fieldOrder` snapshots inspect only the shallow copied container's own keys; no nested payload enumeration or provenance diff.

Protect per-template temporary metadata with `yield* retainWork(0)` before growth and `try/finally` release; charge arrays/cells/keys as they grow, using `utf8LengthWork` for unbounded field/address strings. State events borrow their source field string and do not retain it after sink completion; the retaining sink must charge its own copy/reference. Calls to the optional sink remain ordinary cooperative Work, never public progress observers or transaction callbacks.

- [ ] **3. Add adversarial tracing cases and run GREEN.** Parameterize new fixtures for absent/empty/non-array layers, duplicate/string/non-string IDs, raw false/null/object/undefined folds, layer holes, present primitive items, integer/prototype-like keys, unknown state fields and unbounded key strings. Assert exact field order, source object identity for borrowed elements/nodes/scripts, source immutability and zero remaining ownership after a throwing/cancelling sink. Preserve the existing acceptance distinction: partition is lossless and permits raw/sparse input; the normalized codec still refuses anything its original external validator rejects.

Run: `npx vitest run tests/unit/document/partition.test.ts tests/unit/document/layerFolds.test.ts --maxWorkers=1 --silent=passed-only`.
Expected: PASS with original tests/limits. Review that the no-sink branch does not allocate projection arrays or add a second payload traversal. Record checkpoint, no commit.

## Task 3: Implement the private recipe owner and bounded replay module

**Files:** create `services/localWorkspace/normalized/emissionPlan.ts`, `tests/helpers/normalizationEmissionFixtures.ts`, `tests/unit/localWorkspace/normalized/emissionPlan.test.ts`; modify `tests/unit/localWorkspaceBoundary.test.ts`: runtime edge table2406–2473 and pure-helper tests4136–4142.

**Interfaces:** consumes C and the existing Work/Ownership primitives; produces the builder/plan/cursor implementation. It does not derive or admit a normalized project. Codec is its only runtime recipe producer; repository will only open/dispose completed plans.

- [ ] **1. Create explicit non-authoritative fixtures with the first failing module tests.** Fixture helper code:

```ts
import type { WorkspaceProject } from '../../services/localWorkspace/contracts';
import type { NormalizationSource } from '../../services/localWorkspace/normalized/schema';
import type { TargetCursor, TargetRecord } from '../../services/localWorkspace/normalized/codec';
import type { WorkRuntime } from '../../shared/cooperativeWork.js';
import { makeIncrementalProject } from './incrementalFixtures';

/** Pure codec input only: these fixture digests never certify durable state. */
export function makeEmissionSource(projects: readonly WorkspaceProject[] = [makeIncrementalProject(1)]): NormalizationSource {
  if (!projects.length) throw new Error('Emission fixture needs a project');
  const rows = projects.map((project, index) => ({ id: project.id, project,
    incarnation: `fixture-incarnation-${index}`, storageRevision: index + 3,
    updatedAt: '2026-09-26T00:00:00.000Z' }));
  const workspace = { id: 'current' as const, projectOrder: projects.map(project => project.id),
    activeProjectId: projects[0].id, revision: 5 };
  return { kind: 'fresh', records: { projects: rows, workspace, presets: [], pendingImports: [] },
    snapshot: { projects: [...projects], activeProjectId: workspace.activeProjectId, customPresets: [], pendingImports: [] },
    ledger: null, backups: [], sourceProjects: rows.map(row => ({ projectId: row.id,
      incarnation: row.incarnation, revision: row.storageRevision, digest: 'b'.repeat(64) })),
    sourceDigest: 'a'.repeat(64), contentDigest: 'c'.repeat(64) };
}
export async function collectTarget(cursor: TargetCursor, work: WorkRuntime): Promise<TargetRecord[]> {
  const records: TargetRecord[] = [];
  for (;;) {
    const next = await work.run(cursor.next());
    if (next.done === true) return records;
    records.push(next.value);
  }
}
```

The collector does not dispose the cursor: planned cursors must transfer their plan after exhaustion. Every caller supplies `finally` disposal. These fixtures bypass neither source admission nor physical verification in repository tests; those tests continue using `normalizationHarness.ts`.

In the new module test, use a namespace import/`import.meta.glob` assertion for missing implementation, as existing codec/partition tests do. After the module exists, use direct typed imports. This complete low-level test describes the fundamental output/borrowing/ownership contract:

```ts
it('replays a finalized node envelope while borrowing its source payload', async () => {
  const source = makeEmissionSource();
  const w = makeWorkHarness();
  const builder = createEmissionBuilder(source);
  let plan: EmissionPlan | undefined;
  let cursor: EmissionCursor | undefined;
  try {
    const path = ['records', 'projects', 0, 'project', 'initialState', 'nodes', 'root'] as const;
    const value = await w.runtime.run(builder.borrow(path));
    const keyParts = [];
    for (const item of ['g', source.records.projects[0].id, source.records.projects[0].incarnation, 'root']) {
      keyParts.push(await w.runtime.run(builder.literal(item)));
    }
    const key = await w.runtime.run(builder.array(4, keyParts.map((part, index) => [index, part] as const)));
    const valueBytes = new TextEncoder().encode(JSON.stringify(source.records.projects[0].project.initialState.nodes.root)).length;
    const encodedSize = await w.runtime.run(builder.object([
      ['valueBytes', await w.runtime.run(builder.literal(valueBytes))],
    ]));
    const record = await w.runtime.run(builder.object([
      ['key', key], ['formatVersion', await w.runtime.run(builder.literal(3))],
      ['value', value], ['encodedSize', encodedSize],
    ]));
    await w.runtime.run(builder.append('projectNodes', record));
    await w.runtime.run(effect(1, () => { plan = builder.finish(); }));
    builder.dispose(); // Ownership transferred; this must not dispose the plan.
    await w.runtime.run(effect(1, () => { cursor = openEmissionCursor(plan!, source, 0); }));
    const next = await w.runtime.run(cursor!.next());
    expect(next.done).toBe(false);
    if (next.done === true) throw new Error('Expected node');
    expect(next.value.record.value).toBe(source.records.projects[0].project.initialState.nodes.root);
    expect(next.value.record).toEqual({ key: ['g', source.records.projects[0].id,
      source.records.projects[0].incarnation, 'root'], formatVersion: 3,
      value: source.records.projects[0].project.initialState.nodes.root, encodedSize: { valueBytes } });
    expect((await w.runtime.run(cursor!.next())).done).toBe(true);
    expect(w.runtime.snapshot().hashBytes).toBe(0);
  } finally {
    cursor?.dispose(); builder.dispose(); if (plan) disposeEmissionPlan(plan);
  }
  expect(w.runtime.snapshot().ownedBytes).toBe(0);
});
```

Run: `npx vitest run tests/unit/localWorkspace/normalized/emissionPlan.test.ts --maxWorkers=1`.
Expected RED: missing builder/module assertion, then wrong replay/lifetime until implemented.

- [ ] **2. Implement C using a private acyclic node table.** Internal representation, not exported/serialized:

```ts
type Node =
  | { kind: 'borrow'; address: readonly (string | number)[] }
  | { kind: 'literal'; value: string | number | boolean | null }
  | { kind: 'object'; fields: readonly (readonly [string, number])[] }
  | { kind: 'array'; length: number; present: readonly (readonly [number, number])[] };
type RecordRecipe = { store: ProjectStoreName; node: number };
```

Each returned recipe handle maps privately to `{owner,node}`. An object/array can reference only previously registered recipes of that same live owner, so cycles/forward references cannot be constructed. Copy all caller metadata arrays into owned data-only arrays; validate own data descriptors before reading fields, dense tuple shape, unique object fields/array indexes, finite numeric literals, integer lengths/indexes and known store names excluding ledger. Do not invoke accessors through spread, `map`, destructuring or `Reflect.get` before validation. Reject mutated/invalid metadata encountered while copying; no source write is possible in this module.

Use `Object.defineProperty` for all object/array materialization so `__proto__` is data. Preserve present array indexes and holes; do not densify or copy absent fields. Record roots must be object recipes; payload borrow recipes are children of those envelopes. The module does not replace codec/schema validation.

Resolve a stored address with descriptor reads only. This function is complete except for its imports of existing `effect`, `utf8LengthWork` and the C types:

```ts
function* resolveSourceAddressWork(source: NormalizationSource, address: SourceAddress): Work<unknown> {
  let value: unknown = source;
  for (const key of address) {
    if (typeof key === 'string') yield* utf8LengthWork(key);
    value = yield* effect(1, () => {
      if (value === null || typeof value !== 'object') throw new Error('Invalid emission source location');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        throw new Error('Invalid emission source location');
      }
      return descriptor.value;
    });
  }
  return value;
}
```

Resolve/validate borrowed addresses while recording and again when materializing, without walking their values. A path into a missing property or getter cannot emit. Do not store the resolved SVG/script/raw-fold value in the node table. Source identity is checked against the plan's exact captured root, not by digest equality or structure alone.

Materialize iteratively with a protected stack lease: literal returns its already computed private scalar; borrow resolves its address; object allocates a shallow object then visits its recorded child indexes in order; array allocates its recorded length and only defines recorded indexes. Charge each lookup/stack entry/container/property and long key. There is no `partitionStateWork`, validator, `decomposeProjectWork`, size ledger, hash, full payload clone, `JSON.stringify` or payload-diff call in materialization.

Use `yield* retainWork(0)` then grow only inside protected `try/finally`. The builder keeps the owner lease after successful construction; `finish` transfers it rather than duplicating it. Register partial buffers with the owner before a later Work operation can abort. A plan stores only its nodes/record index/source-root reference and lifecycle state; dispose clears those references before releasing the lease. Do not retain every output record in a separate cache.

- [ ] **3. Enforce cursor identity and cleanup at each operation, not only entry.** `openEmissionCursor` verifies genuine live plan, exact source reference, integer ordinal in `[0,records.length]` and absence of another cursor. It directly selects the record recipe by ordinal; no skipped records are materialized. One cursor's `next` is non-reentrant. Wrap yielded operations with the existing cursor pattern so disposal during a yield is observed before the next operation:

```ts
const guarded = { ...operation, run(runtime) {
  assertLive();
  return operation.run(runtime);
} };
yield guarded;
```

Here `operation` is each `Operation` from the current materialization generator, and private `assertLive():void` checks owner/cursor disposal. On incomplete `next`, dispose that cursor in `finally`. Its `dispose` closes the suspended generator and releases materialization stack/container ownership even after runtime stop. Plan disposal also invalidates/disposes its active cursor. Keep completed record containers within the batch lease lifetime; do not retain a cursor between repository stage batches.

Add parameterized tests with these precise inputs/outcomes:

| Input/action | Assertion |
| --- | --- |
| `{}` or `structuredClone(plan)` as plan; equivalent cloned source | Throws before `next`/write; no getter invocation |
| Recipe from builderB supplied to builderA.object/append | Rejected before ownership transfer |
| Negative/fractional/too-large ordinal; firstOrdinal==recordCount | Invalid values reject; exact end yields done without source lookup |
| Source path metadata getter; intermediate/final source getter; missing location | Getter call count0, no record returned, released cursor/temporary ownership |
| Finish before any record, double finish, append after finish, disposed builder | Refused; a transferred plan remains live after builder.dispose |
| Reentrant next/open second cursor, dispose during yield, dispose twice | No stale result; genuine disposal idempotent; ownedBytes returns to pre-plan baseline |
| Sparse array recipe and keys `__proto__`, integer-like and Unicode strings | Exact presence/prototype/order, no prototype mutation |
| Same structure with tiny versus large opaque body | Recipe-held bytes and replay metadata high-water unchanged; payload reference borrowed |
| More records/layer projections or longer keys | Metadata ownership/high-water increases and yields occur |
| Guard fails immediately after initial lease/growth or midway through materialization | No leaked lease; no later materialization operation |

The whole preparation/capture high-water may grow with a large source/current project. Measure **recipe-held ownership after producer exhaustion** and isolated replay metadata, not a falsely payload-independent whole-run high-water.

- [ ] **4. Add exact architecture edges and run GREEN.** Add `${normalizedPath}emissionPlan.ts` with only `shared/cooperativeWork.js`, `shared/jsonWork.js`, `${normalizedPath}schema.ts` runtime edges. Grant future codec/repository runtime imports of that exact module, not a directory wildcard. Type-only C imports remain type-only. Extend the existing pure-helper parameter list with `emissionPlan`; additionally reject an emission-module import of `./codec`, `./sizeLedger`, `./repository` or `services/document/partition`.

Run: `npx vitest run tests/unit/localWorkspace/normalized/emissionPlan.test.ts --maxWorkers=1 --silent=passed-only`.
Run: `npx vitest run tests/unit/localWorkspaceBoundary.test.ts --testNamePattern='pure worker closure|transitive worker runtime edge|normalized worker capability bypass' --maxWorkers=1 --silent=passed-only`.
Expected PASS. Review leases/source-reference clearing and capability diff; record RED/GREEN, no commit.

## Task 4: Produce finalized recipes during the existing codec derivation

**Files:** modify `services/localWorkspace/normalized/codec.ts`: `targetCursor`27–103, `selectWork`139–145, `decomposeWork`207–254; modify `tests/unit/localWorkspace/normalized/codec.test.ts`.

**Interfaces:** consumes B/C and test fixture helper; produces D. Existing untraced codec functions and durable bytes remain unchanged.

- [ ] **1. Add failing first-pass/replay parity with a genuinely untraced oracle.** Import D/C/helper/types alongside existing codec test imports. The test body is:

```ts
it('prepared emission matches untraced finalized records without semantic replay', async () => {
  const source = makeEmissionSource();
  const oracle = codecWork.prepareNormalizationTarget(source);
  const w = makeWorkHarness();
  const prepared = codecWork.createPlannedTargetCursor(source);
  let plan: EmissionPlan | undefined;
  let replay: EmissionCursor | undefined;
  try {
    const firstPass = await collectTarget(prepared, w.runtime);
    await w.runtime.run(effect(1, () => { plan = prepared.takeEmissionPlan(); }));
    prepared.dispose();
    expect(firstPass.map(item => frameRecord(item.store, item.record)))
      .toEqual(oracle.map(item => frameRecord(item.store, item.record)));
    const partitionSpy = vi.spyOn(partitionModule, 'partitionStateWork');
    const validationSpy = vi.spyOn(appStateValidation, 'validateAppStateWork');
    const ledgerSpy = vi.spyOn(sizeLedgerModule, 'createSizeLedgerWork');
    const before = w.runtime.snapshot();
    await w.runtime.run(effect(1, () => { replay = openEmissionCursor(plan!, source, 0); }));
    const actual = await collectTarget(replay!, w.runtime);
    expect(partitionSpy).not.toHaveBeenCalled();
    expect(validationSpy).not.toHaveBeenCalled();
    expect(ledgerSpy).not.toHaveBeenCalled();
    expect(w.runtime.snapshot().hashBytes).toBe(before.hashBytes);
    expect(actual.map(item => frameRecord(item.store, item.record)))
      .toEqual(oracle.map(item => frameRecord(item.store, item.record)));
    expect(actual[0]).toMatchObject({ store: 'projectHeaders', record: {
      storageRevision: 3, commitWindow: { floorRevision: 3, entries: [] },
      migrationBaseline: { sourceRevision: 3, sourceUpdatedAt: '2026-09-26T00:00:00.000Z' },
    } });
  } finally {
    replay?.dispose(); prepared.dispose(); if (plan) disposeEmissionPlan(plan);
  }
  expect(w.runtime.snapshot().ownedBytes).toBe(0);
});
```

New namespace imports: `partitionModule` from `services/document/partition`, `appStateValidation` from `shared/validateAppState.js`, `sizeLedgerModule` from normalized `sizeLedger`. `collectTarget` accepts either cursor structurally. Assertions use established `frameRecord`, not replay-reported sizes.

Run: `npx vitest run tests/unit/localWorkspace/normalized/codec.test.ts --testNamePattern='prepared emission matches' --maxWorkers=1`.
Expected RED: missing planned-cursor function; once present, independently exposes stale header/counter/projection metadata if captured too early.

- [ ] **2. Add a private per-project projection recorder to the existing producer.** Keep `decomposeWork` as the one source of codec decisions. Add an optional private recorder argument; the four existing public bulk entrypoints do not pass it. A planned target cursor creates one C builder lazily on its first Work operation; records/projects advance in the original sourceProjects/NORMALIZED_STORE_NAMES/Map insertion order.

Extend the existing project index entry to retain its source row ordinal as metadata. Every payload source address starts with `['records','projects',rowOrdinal,'project']`. Scope/incarnation/revision/timestamp can reference the stored row. Baseline project digest can reference `['sourceProjects',identityOrdinal,'digest']`. No lookup searches source projects again for each record.

Private recorder operations in `codec.ts`:

```ts
interface CodecProjectionRecorder {
  readonly builder: EmissionBuilder;
  readonly projectAddress: SourceAddress;
  partition(event: PartitionProjectionEvent): Work<void>;
  selected(result: object, sourceAddress: SourceAddress,
    fields: readonly string[], overrides?: ReadonlyMap<string, EmissionRecipe>): Work<void>;
  payload(result: object, recipe: EmissionRecipe): void;
  recipe(result: object): EmissionRecipe;
  finishRecord(item: TargetRecord): Work<void>;
  dispose(): void;
}
```

Implement it privately beside `decomposeWork`; not exported, not a second serializer. Its WeakMap associates only newly projected containers with recipes; its source-address/field buffers have owned leases. `selected` receives the **already selected field names** from the real `selectWork` loop, never reruns `fields.includes`/omit classification. `payload` associates a constructed container with its recipe; `recipe` refuses absent provenance rather than reverse-engineering by graph diff. Clear per-project maps after finalized recipes are appended; the C builder retains recipes, not projected payload objects.

During an existing select, collect selected names inside its decision branch only when tracing. After the result is built, call `selected` with the known original source address. Header selection is the deliberate late case: retain its chosen key list in the protected per-project recorder, perform the real cloud selection/replacement, then register the header-value recipe with the selected cloud recipe as its override. Do not capture the original full cloud object before its extension fields are split. This delays metadata registration only; it does not rerun selection or change the untraced producer's order.

Use this projection map; each entry records the producer's existing decision at its construction point:

| Actual record/field | Recipe source/construction |
| --- | --- |
| Header `value` | Real wrapper selection in source order; `cloud` overridden by real cloud-field selection |
| Header `document` | Real selection of rootId/schemaVersion; borrow those original initialState fields |
| Node `value` | Borrow initialState.nodes[nodeId] as one opaque value |
| Variant `value` / variant extension | Real selected id/name and omitted-field decisions, pointing to original variant fields |
| Template without array layers | Borrow original template wholesale |
| Template with array layers | B fieldOrder; each non-layers field borrowed; replace layers with recorded-length/present-index array; untouched layers borrowed; stripped layers use their recorded key lists |
| Source `value` | Borrow initialState.generator wholesale; never copy script strings into literals |
| Wrapper/cloud extensions | Real omit selection points to original values, including unknown nested extensions |
| State extension | B state-field events whose chosen owner is compatibility; preserve event order |
| Preferences `value` | B preference fields in event order, then layerCollapsed and panelsExpanded in current Object.assign order |
| Boolean fold cell | Recorded B boolean key, borrow source layers[index].collapsed (known boolean from preparation) |
| Raw fold exception cell | Recorded B exception key, object with `value` borrowed from source layers[index].collapsed |

The recorder translates metadata/events to C nodes. It does not run ID counting, determine fold ownership, inspect payload equality or walk opaque element/script/extension bodies. The real partition result continues feeding the existing codec/ledger; no policy forks are introduced.

- [ ] **3. Finalize exact envelopes only after counters/overlays/lineage.** At the existing `produce` loop after `decomposeWork` returns and header migration fields are installed, call `finishRecord` for each final record immediately before yielding that record. `finishRecord` iterates only the final envelope's own fields: substitute recorded `value`/header `document` recipes; encode the other private envelope fields as metadata recipes. Header `updatedAt` and baseline source timestamp may borrow the captured row; source names/cloud/generator strings must never pass through metadata copying.

Use a private metadata-only recursive helper for fixed envelope fields, not for `value` or `document`:

```ts
function* privateMetadataRecipeWork(builder: EmissionBuilder, value: unknown): Work<EmissionRecipe> {
  if (value === null || typeof value === 'string' || typeof value === 'boolean'
    || typeof value === 'number' && Number.isFinite(value)) return yield* builder.literal(value);
  const owner = yield* retainWork(0);
  try {
    yield* effect(1, () => owner.grow(24));
    if (Array.isArray(value)) {
      const present: [number, EmissionRecipe][] = [];
      for (let index = 0; index < value.length; index++) {
        const hasValue = yield* effect(1, () => Object.hasOwn(value, index));
        if (!hasValue) continue;
        const child = yield* privateMetadataRecipeWork(builder, value[index]);
        yield* effect(1, () => { owner.grow(24); present.push([index, child]); });
      }
      return yield* builder.array(value.length, present);
    }
    if (value && typeof value === 'object') {
      const fields: [string, EmissionRecipe][] = [];
      const keys = yield* primitive('keys', () => {
        const result = Object.keys(value); owner.grow(24 + result.length * 8); return result;
      });
      for (const key of keys) {
        const keyBytes = yield* utf8LengthWork(key);
        const item = yield* effect(1, () => Reflect.get(value, key));
        const child = yield* privateMetadataRecipeWork(builder, item);
        yield* effect(1, () => { owner.grow(24 + keyBytes); fields.push([key, child]); });
      }
      return yield* builder.object(fields);
    }
    throw new Error('Invalid private emission metadata');
  } finally { owner.release(); }
}
```

This helper is called only on trusted freshly produced envelope metadata, never caller-controlled/project payload containers. Its temporary key/entry buffers release independently from the builder's owned copies. It does not introduce a new external-depth check: envelope nesting is fixed, while external depth remains validated by the original codec. Final encoded sizes, templateOverlayBytes, preferenceBytes, header counters and migration baseline come from the completed real records; never recompute a ledger or snapshot header placeholders.

`takeEmissionPlan` finishes/transfers the builder only after producer exhaustion. A target cursor's `finally` still releases current image/index leases; it must release an untransferred builder on failure/explicit disposal, but not prematurely on normal exhaustion before `takeEmissionPlan`. Transfer occurs inside a charged effect that assigns the receiving owner synchronously; add a guard-failure regression immediately after this assignment, not only during buffer allocation.

- [ ] **4. Add the full parity/lifetime matrix and run GREEN.** Extend codec tests with distinct project IDs and exact independent `frameRecord`/`Buffer.byteLength` comparisons. Include two projects in reversed source-record versus sourceProjects order; empty optional stores; wrapper/cloud/state/variant extensions with hostile-looking keys; generator scripts; raw folds/duplicate and non-string IDs; Unicode/escaping; absent/false fields; long names/IDs; integer key ordering. For invalid sparse external JSON, both traced and untraced codec must refuse under existing validation; B separately proves sparse projection semantics. Do not broaden historical acceptance to make a parity test pass.

Keep the actual pinned Sticker Press oracle test, existing depth511/512/513 and all prior corruption tests. Add planned-versus-untraced parity assertions to an appropriate existing legal fixture; do not shorten pinned source/scripts or increase its deadline. Reconstruct emitted records by project/store/key and compare to the original external input using existing reconstruction, independently from C. Real fresh/historical repository sources and independent physical rows are covered in Task5.

Ownership tests measure plan-held metadata after first-pass exhaustion with only the current source lease remaining. Increasing opaque body length alone must not retain a second payload graph; more records/fold structural entries/long keys must increase charged metadata. Spy on builder `literal` calls for sentinel user names/scripts/raw values; they must be source borrows. Spy on real imported partition/validation/size-ledger functions during replay, not only `decomposeProjectWork` (the old cursor uses a private same-module `decomposeWork`). Check early take, double take, explicit cancellation/disposal after each yield and abandonment before transfer.

Run: `npx vitest run tests/unit/localWorkspace/normalized/emissionPlan.test.ts tests/unit/localWorkspace/normalized/codec.test.ts tests/unit/document/partition.test.ts --maxWorkers=1 --silent=passed-only`.
Expected PASS at original deadlines; record any timing failure separately. Review byte-oracle independence, exact finalization point and source-graph release; no commit.

## Task 5: Integrate prepared replay into session and strict staging

**Files:** modify `services/localWorkspace/normalized/repository.ts`: `PreparedPass`, `releasePreparation`, `deriveTarget`, `strictStage`, `session.prepare`/`stageNext`; modify `tests/unit/localWorkspace/normalized/migration.test.ts`.

**Interfaces:** consumes A/C/D. No new repository public method, normalizer transport, phase or diagnostic metric. Plan ownership is private to this invocation; marker/source arguments remain detached as before.

- [ ] **1. Strengthen the existing fifth-pass RED before changing staging.** Keep the full130-node fixture/read/byte/durable assertions in `session stages bounded batches without rereading or rehashing its preparation`. Change its current `before.targetDerivations + 1` expectation to equality; after reserve install real imported-function spies, then restore them before the independent `markNormalizationVerified` call:

```ts
const semantics = [
  vi.spyOn(codecModule, 'createTargetCursor'),
  vi.spyOn(codecModule, 'createPlannedTargetCursor'),
  vi.spyOn(partitionModule, 'partitionStateWork'),
  vi.spyOn(appStateValidation, 'validateAppStateWork'),
  vi.spyOn(sizeLedgerModule, 'createSizeLedgerWork'),
];
```

The existing loop still stages all records, requires more than two batches, <=64records per batch, exact marker-only reads and independent verification. Add after the loop:

```ts
expect(after.targetDerivations).toBe(before.targetDerivations);
for (const spy of semantics) expect(spy).not.toHaveBeenCalled();
```

Restore all new spies in `finally` as well. Import namespaces from the same modules as Task4. This strengthens the previously explicit extra-derivation expectation; it does not waive any runtime fixture/budget.

Run: `npx vitest run tests/unit/localWorkspace/normalized/migration.test.ts --testNamePattern='session stages bounded batches without rereading or rehashing its preparation|normalizer shares one invocation runtime with five fences and four independent derivations' --maxWorkers=1 --silent=passed-only`.
Expected RED: real decomposition/partition/ledger calls and target delta1; normalizer5-vs4 remains RED until integration.

- [ ] **2. Build/retain plans only for preparation and strict-stage expected records.** `deriveTarget` selects `createPlannedTargetCursor(source)` only when `options.prepareEmission===true`; otherwise it uses unchanged `createTargetCursor(source)`. Preserve the one target-manifest stream, recordBytes measurements, project ordinals and complete physical-prefix comparison. Add the plan only after all target/marker checks succeed. Keep the cursor's `try/finally` around the whole target tail rather than disposing it immediately after hashing when its builder still needs transfer.

Use a receiver installed before any post-operation guard can fail:

```ts
let prepared: PreparedPass | undefined;
let returned = false;
try {
  // The existing target stream and all marker checks execute here.
  prepared = { source, archive, attempt, recordBytes, projects, images, initialWorkspace, currentWorkspace };
  if (options.prepareEmission) {
    const planned = cursor as PlannedTargetCursor;
    await work.run(effect(1, () => { prepared!.emissionPlan = planned.takeEmissionPlan(); }));
  }
  returned = true;
  return prepared;
} finally {
  cursor.dispose();
  if (!returned && prepared?.emissionPlan) disposeEmissionPlan(prepared.emissionPlan);
}
```

Place the unchanged target stream/checks inside that protected `try`; the comment identifies moved existing code, not omitted validation. Retain the existing `work.note('targetDerivations')` exactly once per actual target pass. No extra increment accompanies replay because no semantic derivation remains there. Disallow `prepareEmission` with active/collectImages mode to prevent accidental later-phase reuse.

Call policy:

| Caller | deriveTarget options |
| --- | --- |
| Session prepare/resume | `{allowFresh,prepareEmission:true}` |
| Strict stage expected batch | `{allowFresh:false,prepareEmission:true}` |
| Strict reserve | Existing source/seed options, no emission plan |
| Verify/activate/staged-read | `{allowFresh:false,collectImages:true}`, no emission plan |
| Active reopen/selected admission | Existing active+collectImages options, no emission plan |
| Retained/strict source read | `deriveCapturedSource` only |

Release plan **before** captured source and before the independent verification capture. Remove persistent `emission`/`emissionOrdinal` session state; replay cursor belongs to a single stage operation. Update existing `releasePreparation` ordering:

```ts
if (pass?.emissionPlan) disposeEmissionPlan(pass.emissionPlan);
pass = undefined;
captured?.release(); captured = undefined;
```

Keep all existing metadata/initialWorkspace/backupSelection/seed release lines. Do not include `emissionPlan` in `rawValueWeightWork(metadata)`: it is opaque and has its own real lease, not zero-byte evidence or a reason to count the source twice. Failure before a pass is installed disposes the local cursor/builder/receiver as above.

- [ ] **3. Replace session's second producer with one batch replay cursor.** Keep the current phase guard/reservation requirement and exact framed-byte array. Replace only cursor creation, prefix skipping and persistent ordinal handling; full batch body:

```ts
const prepared = pass;
requireContract(prepared.emissionPlan, 'Missing prepared emission plan');
let cursor: EmissionCursor | undefined;
let batch: TargetRecord[] = [];
let bytes = 0;
let ordinal = prepared.attempt.nextRecord;
const owner = work.own(0);
try {
  await work.run(effect(1, () => {
    cursor = openEmissionCursor(prepared.emissionPlan!, prepared.source, ordinal);
  }));
  while (ordinal < prepared.recordBytes.length && batch.length < STAGE_RECORD_LIMIT) {
    const size = prepared.recordBytes[ordinal];
    if (batch.length && bytes + size > STAGE_BYTE_LIMIT) break;
    const emitted = await work.run(cursor!.next());
    requireContract(emitted.done === false, 'Missing normalization target');
    batch.push(emitted.value); bytes += size; ordinal++;
    owner.grow(size);
    if (size > STAGE_BYTE_LIMIT) break;
  }
  const next = { ...prepared.attempt, nextRecord: ordinal,
    progressRevision: prepared.attempt.progressRevision + 1 };
  const markerBytes = await writeNormalizationStage(prepared.attempt, batch, next, work);
  prepared.attempt = next;
  work.notify('durable');
  return await work.run(primitive('clone', () => {
    work.note('markerWorkBytes', markerBytes); return structuredClone(next);
  }));
} finally {
  batch = []; cursor?.dispose(); owner.release();
}
```

No target cursor, prefix emission loop, partition, size ledger or payload hash is called here. Only after the existing write settles may `prepared.attempt` advance. If write/CAS/ack/observer cancellation throws, the enclosing `operation` disposes the whole session/plan. Never continue a failed cursor by guessing durability; a fresh session independently validates actual prefix. Exhaustion does not release the source before verification's normal phase transition; bounded-batch cursors always release at each call exit.

- [ ] **4. Replace strict-stage expected emission, preserving strict input validation.** Leave `structuredClone({attempt,records})` before first suspension, caller byte/count framing, fresh capture/marker comparison and the final `writeNormalizationStage` unchanged. Its newly planned pass has independently compared the entire prefix. Expected comparison becomes:

```ts
requireContract(pass.emissionPlan, 'Missing prepared emission plan');
let cursor: EmissionCursor | undefined;
try {
  await work.run(effect(1, () => {
    cursor = openEmissionCursor(pass!.emissionPlan!, pass!.source, input.attempt.nextRecord);
  }));
  for (const item of input.records) {
    const expected = await work.run(cursor!.next());
    requireContract(expected.done === false && expected.value.store === item.store
      && await work.run(equalFrameWork(recordFrame(expected.value.store, expected.value.record),
        recordFrame(item.store as ProjectStoreName, item.record))), 'Unexpected normalization batch');
  }
} finally { cursor?.dispose(); }
```

Delete the strict adapter's second `createTargetCursor`/`targetDerivations` increment and skip loop. Do not replace the actual supplied-batch frame measurement with prepared sizes; hostile input must still pass its own <=64/256KiB/oversized-singleton check and exact expected comparison. No new input parameter accepts a plan, source pointer or trusted ordinal.

- [ ] **5. Add phase, resume, fault and physical-oracle regressions; run GREEN.** Strengthen the original normalizer budget test with real producer observations around its first invocation only: planned producer called once in prepare; untraced producer called once each in verify/activate/reopen. Install spies before `normalizeWorkspace`, not before unrelated fixture construction, and restore before its separate active invocation. Preserve all current five-fence/60legacy-read/source4/target4/owned0/borrowed-runtime and active-two-fence assertions.

```ts
expect(plannedProducer).toHaveBeenCalledTimes(1);
expect(untracedProducer).toHaveBeenCalledTimes(3);
expect(w.runtime.snapshot('stage').targetDerivations).toBe(0);
expect(w.runtime.snapshot('stage').sourceDerivations).toBe(0);
```

Capture phase at each factory call using the real runtime context; expected sequence is `prepare,verify,activate,reopen`. Do not fake counts by wrapping another full producer as “replay.” Imported validator/partition/ledger spies in the stage-only test and C's restricted dependencies are the independent cross-check.

Required matrix additions/strengthenings, keeping all existing data/assertions/deadlines:

| Scenario | Required independent oracle |
| --- | --- |
| Fresh and historical, two projects, multiple batches | Before staging compute untraced oracle from independently read source; after staging compare each actual physical store/key/frame and record membership to oracle; compare original external projects after verify/reopen |
| First/last record, exact64 boundary, exact256KiB plus1, oversized singleton | Actual `frameRecord` UTF8 byte counts of supplied/physical rows, not recipe `recordBytes` alone; preserve existing boundary fixtures |
| Resumed prefix | Prepare independently compares prefix; replay opens exactly at durable nextRecord and emits remaining suffix; corrupted earlier prefix refuses before any replay/write |
| Strict stage batch changed store/key/value/order/size | Refusal and exact before/after rows; expected producer derived once; no second partition/ledger call during replay |
| Caller attempt/records/source/provider changed after first await | Existing detachment/source/fence refusal remains effective; source-only output cannot bypass target checks |
| Marker advanced by another session | Old session rejects, disposes metadata/source, never splices other cursor; fresh owner can inspect/resume within eight retries |
| Same-revision source/archive/ancillary drift at seal | No stale reservation/publication; original exact seals unchanged |
| Stage faults before/after every record and marker, quota/clone/abort/versionchange | Atomic old/new marker+records, no subsequent planned writes, ownedBytes0 |
| Stage/verification/activation lost acknowledgement or cancellation after commit | Durable phase preserved, acknowledgement suppressed, old plan disposed; fresh independent owner decides next step |
| Guard at builder allocation/plan transfer/cursor opening/emission/transaction completion | No orphaned metadata lease, no reused disposed plan, no leak of payloads/keys into public progress events |
| Transition to verification | Plan/source preparation ownership released before new capture; verify/activate/reopen must not call planned producer or reuse prep metadata/hash |

Keep synthetic/current workspace authority tests, full fold/proof-window/recovery matrices and ordinary-save isolation tests untouched. Run focused migration cases first:

`npx vitest run tests/unit/localWorkspace/normalized/migration.test.ts --testNamePattern='normalizer shares one invocation runtime|session stag|session resumes|strict.*stag|normalization batch|resumed|256KiB|oversized|caller|cancellation|lost acknowledgement' --maxWorkers=1 --silent=passed-only`

Expected actual4-target gate PASS and zero stage semantic calls. A focused default-deadline timeout remains a failed gate, not “GREEN except timing.” Record precise tests/calls/counts and proceed to Task6 for full evidence; do not claim normalization acceptance before all required gates.

## Task 6: Verify original budgets, runtime gates and connected behavior

**Files:** tests/docs listed above only. External diagnostics under `/tmp/opencode` are allowed; no test-config or dependency changes. Update this plan and `.superpowers/sdd/progress.md` with actual evidence, not expected results.

**Interfaces:** uses existing per-case reporter/batched runner; produces a current-source evidence index and a truthful accepted-or-blocked milestone result. New case counts are discovered from inventory, not hard-coded647 after tests are added.

- [ ] **1. Run a recorded derivation gate that also captures the current inventory.** Verify the external artifact parent with `ls /tmp/opencode/doctect-incremental-sdd`; use a new numeric suffix if a named output already exists. Reporter files use `wx`; never delete/overwrite old evidence to make a command run.

```bash
FOUNDATION_CASE_LOG=/tmp/opencode/doctect-incremental-sdd/task-13-emission-budget-01.jsonl npx vitest run tests/unit/localWorkspace/normalized/migration.test.ts --testNamePattern='^normalizer shares one invocation runtime with five fences and four independent derivations$' --maxWorkers=1 --includeTaskLocation --silent=passed-only --reporter=/tmp/opencode/foundation-case-reporter.mjs
```

Expected: test passes original5000ms; exactly4source/4target derivations, zero stage semantic rederivations, original fence/read/ownership assertions intact. Its collected inventory includes all cases even though only this test runs. Independently inspect reporter `end` for no module/unhandled errors. If still5, return to actual producer trace; do not alter counters or assertion.

- [ ] **2. Remeasure original failing short cases and original32MiB gate at unchanged deadlines.** The existing names file contains42 short-timeout baseline cases, including16 that later passed isolated; retain that full comparison set. New test names must not replace old ones silently.

```bash
FOUNDATION_INVENTORY=/tmp/opencode/doctect-incremental-sdd/task-13-emission-budget-01.jsonl FOUNDATION_CASE_NAMES=/tmp/opencode/doctect-incremental-sdd/task-13-isolated-timeout-names.json node /tmp/opencode/foundation-batch-runner.mjs 0 1 1
```

When `FOUNDATION_CASE_NAMES` is supplied, the runner selects those exact names from the new inventory; numeric range is validated but does not truncate the selection. Each runs in a fresh one-worker process. Record old/new per-case duration and state without summing results across source stamps.

```bash
FOUNDATION_CASE_LOG=/tmp/opencode/doctect-incremental-sdd/task-13-emission-32mib-01.jsonl npx vitest run tests/unit/localWorkspace/normalized/migration.test.ts --testNamePattern='normalization preserves original 32MiB state boundary and refuses one extra UTF-8 byte' --maxWorkers=1 --includeTaskLocation --silent=passed-only --reporter=/tmp/opencode/foundation-case-reporter.mjs
```

Allow a shell timeout of at least430000ms so the original360000ms test can settle and report. Do not pass `--testTimeout` or edit the test's360000ms. The exact32MiB and one-extra-UTF8-byte assertions and complete original fixture remain. If it times out, keep failure/partial evidence and diagnose separately; no small synthetic benchmark substitutes.

- [ ] **3. Run a complete current migration covering campaign.** After source is stable and short-case investigation is complete:

```bash
FOUNDATION_INVENTORY=/tmp/opencode/doctect-incremental-sdd/task-13-emission-budget-01.jsonl node /tmp/opencode/foundation-batch-runner.mjs
```

Runner defaults to the entire supplied inventory, exact escaped suite-space-joined names, one worker, groups of20 and isolated heavy cases. It records runtime/test/config source hashes before/after. Verify all current IDs have one final outcome, no missing/skipped/unhandled results, and no source change during campaign. If a shell/process cutoff prevents coverage, rerun the missing exact range with the same current inventory/source stamp; do not treat the cutoff or an old inventory as acceptance. Full covering acceptance requires every required current case passing, not merely recorded.

- [ ] **4. Run connected regression, boundary, typecheck and build.** Use one worker initially because the recorded two-worker foundation run exposed default-deadline timeouts; concurrency policy is unchanged. Connected command:

```bash
npx vitest run tests/unit/localWorkspace/normalized/sourceReads.test.ts tests/unit/localWorkspace/normalized/emissionPlan.test.ts tests/unit/document/partition.test.ts tests/unit/document/layerFolds.test.ts tests/unit/localWorkspace/normalized/workspaceManifest.test.ts tests/unit/localWorkspace/normalized/workspaceCommitProof.test.ts tests/unit/localWorkspace/normalized/projectBaseline.test.ts tests/unit/localWorkspace/normalized/workspaceAuthority.test.ts tests/unit/localWorkspace/normalized/codec.test.ts tests/unit/localWorkspace/normalized/commitProof.test.ts tests/unit/localWorkspace/normalized/repository.test.ts tests/unit/localWorkspace/normalized/workspaceWorker.test.ts tests/unit/localWorkspace/normalized/storeCommands.test.ts tests/unit/ProjectEditor.incrementalPersistence.test.tsx tests/unit/useIncrementalProjectWrites.test.tsx --maxWorkers=1 --silent=passed-only
```

```bash
npx vitest run tests/unit/localWorkspace/bootstrap.test.ts tests/unit/localWorkspace/commit.test.ts tests/unit/localWorkspace/lineageRepair.test.ts tests/unit/localWorkspace/validation.test.ts --maxWorkers=1 --silent=passed-only
```

```bash
FOUNDATION_CASE_LOG=/tmp/opencode/doctect-incremental-sdd/task-13-emission-boundary-01.jsonl npx vitest run tests/unit/localWorkspaceBoundary.test.ts --maxWorkers=1 --includeTaskLocation --silent=passed-only --reporter=/tmp/opencode/foundation-case-reporter.mjs
```

Give the boundary shell command enough total time (at least360000ms; prior full run221.8s) without altering individual test deadlines. Required outcomes: all affected/connected/boundary cases pass, no unchecked capability edges. Also run:

```bash
npx tsc --noEmit
```

```bash
TMPDIR=/tmp/opencode npm run build --legacy-peer-deps -- --outDir /tmp/opencode/doctect-incremental-sdd/task-13-emission-build-01
```

Inspect the output parent before build; use a new suffix on collision, never `--emptyOutDir`. Expected build PASS. Classify the known Sticker Press TS2339 separately; any additional type error is a regression. Preserve complete logs/exit codes, distinguish assertions from timing and don't sum overlapping commands into one pass count.

- [ ] **5. Audit exact scope and record final milestone status.** Extend `/tmp/opencode/doctect-incremental-sdd/audit-normalization-emission-design.mjs` through a new external scope wrapper, adding only this plan plus newly created files from the file map when runtime execution is authorized. Do not modify the original81-file baseline/47-path list or grant a normalized-directory wildcard. Verify empty index, unchanged HEAD, `git diff --check`, protected hashes and retained prior blobs. Compare runtime changes to the pre-execution dirty baseline, not `HEAD~1`.

Review source-only authority separation, no payload cache, authentic accounting, late finalization, getter handling, transfer/abort ownership and fresh later phases. Read-only review assistance may inspect the diff; controller remains sole implementation writer. Update task checkboxes only after their tests/review actually pass. No commits or automatic merge/cleanup.

Required evidence fields: current source stamp/case inventory; actual derivation/function-call counts; original short/32MiB results; full migration completeness/pass status; connected/boundary/build/typecheck outcomes; ownership/fault/capability checks; remaining red gates. Four derivations alone is not responsive-production or release acceptance. Native heap/browser lifecycle/INP and workspace lifecycle B/C/D remain separate gates.

## Spec coverage and review checklist

| Written amendment | Plan coverage |
| --- | --- |
| Sections1–3: unchanged contracts, evidence, chosen alternative | Global Constraints, starting evidence, file map; no phase fusion/dispatch redesign |
| Section4: source-only validation, shape/source marker agreement, readonly seal, no authority substitution | Task1, A, source/target corruption matrix |
| Section5: opaque source-address metadata, same projection decisions, raw compatibility, late finalization | B/C/D, Tasks2–4; metadata/payload distinction and untraced oracle |
| Section6: direct prefix seek, true emission, exact batching and strict caller comparisons | Task5 steps1–5, Task3 cursor tests |
| Section7: phase independence, retries, leases, disposal and post-operation guards | C/D lifetime, Tasks3–5; synchronous receiver registration and unchanged eight-retry owner |
| Section8: real producer counts, independent parity, malformed/stale/fault tests, original deadlines | Tasks1–6 and existing retained regression matrices |
| Section9: bounded runtime seams, no UI/schema/second writer | Exact file map and filename-specific capability edges |

Before execution approval, self-review every type/function name and call policy above, scan for unresolved placeholders, and verify this document against the approved amendment. This is a concrete execution plan, not an implementation receipt. Current checkboxes stay unchecked until authorized work and verification occur.
