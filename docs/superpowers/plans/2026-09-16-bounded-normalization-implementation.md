# Bounded Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The controller dispatches sequential workers and reviews each group. Do not commit, stage, install dependencies, or skip dependency gates.

**Goal:** Remove batch/project-multiplied normalization work while preserving independently sealed physical authority and all accepted historical/current-proof semantics.

**Architecture:** A repository-owned invocation session reuses preparation, never durable authority. Shared generator programs have both synchronous and cooperative drivers; canonical framing feeds byte-identical incremental SHA-256 outside transactions. Each authority transition seals its independently validated candidate against all physical rows in one transaction. The approved five-file loader extension is included; there is no remaining loader approval gate.

**Tech Stack:** TypeScript, existing Vitest/fake-indexeddb, IndexedDB, existing browser/worker runtime; dependency-free SHA-256. Production database version remains 2.

## Global Constraints

- Authority: `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/docs/superpowers/specs/2026-09-16-bounded-normalization-design.md`, plus its allocation and the accepted Task 11 contracts where not amended.
- Worktree only: `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence`. Use absolute tool paths and this exact command working directory. No parent checkout or protected sibling access.
- “Outside transactions, traversal yields after at most **1,024 graph/element visits or 64 KiB emitted UTF-8**, whichever comes first.” Sorting/comparison/string traversal must be accounted, not hidden in one visit.
- “Stage transactions retain the **64-record / 256 KiB** framed-payload limit and one legal oversized record alone.”
- Keep depth 512, exact digest domains/bytes, historical nonempty-string identifiers, own-property absence/order and fold exceptions. The 32 MiB limit is AppState-only, not a physical-record or workspace cap.
- No normalized writer outside `createNormalizedRepository`; no new worker protocol/UI, durable fields/formats, source cleanup, ordinary-save policy changes, or production version bump.
- Keep eight strict one-shot methods; no hidden cross-call trust. New session is private and invocation-scoped.
- Keep D6/current-proof/BOTH-window behavior, D7 immutable collision-safe archive allocation, nonzero source baselines, six-point-read/one-preference-put scalar saves, and zero scalar template/extension reads/fold hashing.
- Native materialization/cloning/engine primitives and synchronous exact comparison of ONE physical row are explicit exceptions. Application loops, complete loaders/validators and workspace joins are not exceptions.
- No commits, staging, installs, cleanup, servers, profiles or baseline recapture. Fresh Task11b dirty baseline already exists. Controller owns cumulative review, not HEAD~1.
- This planning invocation performs no tests/builds and makes no verification claim. Commands below are future worker/controller instructions.

---

## Status: frozen execution plan; group review gates required

**2026-09-17 user-approved YAGNI amendment:** Remove only G2a's scheduler-specific semantic analyzer and artificial source-mutation tests from T02. Preserve its dependency-free S02 import entry, existing storage/worker ownership checks, G1 checks, and all runtime tests. Do not replace the analyzer with snapshots, another resolver, or broader sandbox rules. Review actual scheduler behavior through its interface. This amendment supersedes conflicting scheduler AST/prototype/cleanup-proof language below and in earlier group briefs/reviews; R2/R5's remaining mutated-source proof demands are withdrawn requirements, not fixed runtime defects. No Node ref/unref behavior change is needed. Continue the approved bounded-migration work with YAGNI; do not expand unrelated checker machinery. The user requested direct continuation without a handoff.

The controller stopped the documentation-only planning process after its continued refinements changed the G2a ownership interface during implementation. No background planner may change an active group's interface. G1 is accepted; G2a is accepted under the user-approved YAGNI amendment, retaining the earlier independent assessment of unchanged runtime code. G2b's canonical-traversal slice is controller-verified, not whole-G2b acceptance. Later group and cumulative review gates remain; this status is not whole-Task11b acceptance.

G2a ownership contract is the `Ownership`/`retainWork` interface declared below, selected to support incrementally measured capture ownership without per-row release-callback retention. This replaces the initial release-function draft; no caller has adopted either interface. Operation callbacks receive the authentic runtime only under cooperative execution. Synchronous `retainWork` returns an inert lease. Grow/release accounting remains tied to the allocating phase; release is idempotent and remains usable after lifecycle loss. Growth after release or lifecycle loss is rejected.

G2a's harness must return the nested observer result so the existing executor can suppress passive Promise rejections. That correction preserves the approved observer-isolation contract. Scheduler lifecycle and numeric wakeups are runtime-test requirements, not static semantic-proof requirements (see the YAGNI amendment).

The approved specification now expressly authorizes the five loader seams below. Preserve synchronous APIs, migration order/defaults/warnings/rejections, reference semantics and ID-generation order. Do not request the same approval again. Rendering/editing layer functions remain outside scope. This plan is not an implementation or verification receipt; controller supplied baseline 2072 tests/21 files PASS in 298.68s, not rerun here.

Group 1 remains independently dispatchable. Follow-up groups are split into bounded source-worker assignments. Each group's interfaces, replacement algorithm, tests and command are binding together with the shared protocol and retained critical algorithms below; references to existing checks mean move those exact checks into stepped traversal, not call the old whole helper as one step.

### Actual mandatory call paths and approved scope

| Exact file/function | Actual work reached by normalization | Disposition |
| --- | --- | --- |
| `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/localWorkspace/normalized/repository.ts:265–303`, `prepareSource` | Calls `reconstructWorkspaceRecords` at 275; then discards hydrated snapshot and retains raw records at 294–303. Discarding the result does not eliminate validation work or make skipping it equivalent. | Approved repository seam. |
| `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/localWorkspace/migration.ts:455–683`, `validateProjectRecords`, `validatePresetRecords`, `validatePendingRecords`, `reconstructWorkspaceRecords` | Projects call `validateMigratedState` then `validateWorkspaceProject`; presets call `validateCustomPreset`; imports call `preparePendingImport`. All three routes reach `prepareProjectState`. Position sorting and membership loops also need accounting. | Approved shared historical seam; cannot replace with codec-only validation. |
| `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/localWorkspace/validation.ts:81–110`, `prepareProjectState` | Performs canonical checking/cloning, schema checks, pre-migration validation for schema ≥10, then **unconditionally** calls `loadProjectState` at 103, rejects warnings, validates loaded state. | Approved shared validation seam. |
| `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/loadProjectState.ts:7–13`, `loadProjectState` | Clones, invokes `migrateState`, normalizes generator provenance, copies root, potentially removes generator and returns warning. | Approved loader extension. |
| `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/migration.ts:85–163`, `migrateState`; `migrateV0ToV1` through `migrateV10ToV11` | Even schema 11 executes `normalizeTextOverflow` then `normalizeProjectTextPadding` at 160–162. Older versions also clone and traverse templates/elements, and v7→8 calls layer repair. | Approved loader extension; no current-schema bypass. |
| `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/textOverflow.ts:21–55`, `normalizeTextOverflowElement`, `normalizeTextOverflowTemplate`, `normalizeTextOverflowTemplates`, `normalizeTextOverflow` | Whole-project clone plus variant/template/element loops; element/root spreads can copy wide compatibility objects. Runs on schema 11 too. | Approved loader extension. |
| `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/textPadding.ts:56–86`, `normalizeTextPaddingElement`, `normalizeTextPaddingTemplate`, `normalizeTextPaddingTemplates`, `normalizeProjectTextPadding` | Another whole-project clone plus maps over every template/element. Missing padding is legal before loading and hydrated on text elements. | Approved loader extension. |
| `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/layers.ts:19–33`, `ensureTemplateLayers` | v7→8: layer indexing/sort, element search/map, fallback default-layer ID allocation. Older admission reaches this before final state limits. | Approved migration helper only, not render/edit layer functions. |

This is not speculative: current-schema source validation already reaches the first four extra files. Narrow source-only optimization cannot close M1. Calling their unchanged synchronous entry points inside a work quantum, duplicating their rules inside the repository, skipping loading because raw bytes are eventually retained, or weakening warning rejection would all violate the approved spec.

### Other shared traversal dependencies concretely located

These are the necessary shared traversal seams, not extra policy permissions. The file manifest and group assignments below lock their narrow responsibilities.

| Exact file/functions | Required preservation/accounting |
| --- | --- |
| `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/localWorkspace/historicalBootstrap.ts`, `bootstrap`, `readVerificationInputs`, `validateHistoricalBackup`, `captureObservedLegacy` | Copied/verified/v1 repair and drift/recovery paths stay distinct. Backup validation once per captured row, with every ledger reference's kind/time/digest checked against that result. All prerequisite work counted separately, not hidden. |
| `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/localWorkspace/lineageRepair.ts:55–135`, `prepareLineageRepair` | Two reconstructions/digest checks, project maps/clones, expected-original rows and generated incarnations. Shared historical-preparation extraction only; preserve the two checks and repair policy. |
| `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/localWorkspace/legacy.ts:38–77`, `captureStableLegacySnapshot`, `captureStableLegacySnapshotWithDigest` | Stable capture currently reads keys three times and hashes three times through the with-digest wrapper. Count these actual operations. Keep generation plus exact raw/presence checks; not epoch-only equality. |
| `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/shared/validateAppState.js:25–124`, `validateAppNode`, `validatePageTemplate`, `validateAppState` | JSON size pass; node children; all variants/templates/elements; current failure ordering and schema rules. A 50,000-element template is not one work unit. Share synchronous and stepped rules rather than cloning validation policy. |
| `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/shared/generatorMetadata.js:10–38`, `validateGeneratorProvenance`, `normalizeGeneratorProvenance` | Long script byte counting, unknown-key scan, timestamp and detach-warning rules. Share bounded UTF-8 length traversal; a complete script must not become one nominal encoding visit. |
| `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/localWorkspace/canonical.ts:13–86`, `serialize`, `canonicalStringify` | Recursive key sorting, descriptor checks, escaping, depth and cycle tracking; synchronous API should drain shared cursor. Do not retain separate subtly different canonicalizers. |
| `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/document/partition.ts:55–143`, `mapTemplates`, `partitionState`, `projectTemplate`, `assembleState` | Per-template duplicate-ID counting, raw positional fold exceptions, absence, original field order, template/layer loops. `hydrateState` is not the raw codec path and must not replace it. |
| `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/localWorkspace/normalized/codec.ts`, `prepareNormalizationTarget`, `decomposeProject`, `validateRecords`, `orderedState`, `validateOverlays`, `reconstructProject` | One project index; stepped validation/size/partition/reconstruction; existing project → store → map-insertion order. Avoid all-target arrays and project-count-multiplied filters. |
| `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/localWorkspace/normalized/sizeLedger.ts:24–74`, `contribution`, `createSizeLedger`, `applySizeChanges` | Bulk accumulator shares formulas with selected arithmetic. Long historical key and preference-value sizing must cooperate. Ordinary selected-record API/budget unchanged. |
| `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/localWorkspace/normalized/commitProof.ts`, `frameRecord`, `frameManifest`, `validateCommitWindow`, `validateLineage` | Exact independently depth-reset field framing and proof validation. Window byte cap does not bound malformed input before validation. No proof-format change or silently synchronous bulk proof validator. |

## Group partition and dependencies

**43 exact implementation paths: 27 source/declaration files and 16 test/helper files.** Six source/declaration files and four test/helper files are new; all other changes are narrow extractions/integration. Paths outside this manifest are read-only regression inputs. The two planning/report artifacts are not implementation source scope. No schema, worker/client/protocol, public facade, coordinator or live UI edits are needed: the existing coordinator already composes its captured-epoch guard into `NormalizationEnvironment.assertCurrent`.

| Group | Independently testable outcome | Dependencies/status |
| --- | --- | --- |
| 1 | Dependency-free, bounded-step incremental SHA-256; known vectors and differential hashing of current exact frames; isolated leaf capability policy. | **Ready for controller review/dispatch. Three files.** No repository caller switched yet. |
| 2a | Shared work protocol and real-task driver. | G1. |
| 2b | Shared canonical/UTF-8/JSON traversal and exact frame hashing. | G2a. |
| 3a | Overflow/padding/layer traversal; reference and ID-order parity. | G2b. |
| 3b | Versioned migration and loader traversal. | G3a. |
| 3c | Shared AppState/generator/project validation. | G3b. |
| 3d | Historical preparation/reconstruction/lineage traversal. | G3c. |
| 3e | Historical bootstrap, stable captures and prerequisite transaction lifecycle. | G3d. |
| 4a | Partition/assembly and bulk size arithmetic. | G3e. |
| 4b | Codec and proof traversal; streamed target iterator. | G4a. |
| 5a | Paginated candidates/exact seals; owned prepare/reserve session. | G4b. |
| 5b | Streamed stage/resume; marker-only stage CAS. | G5a. |
| 5c | Independent verify/activate/active-read/export, proof/D6 matrix. | G5b. |
| 6a | Normalizer lifecycle/fences/retry/recovery integration. | G5c. |
| 6b | Cumulative counters, fault matrix and final review gate. | G6a. |

No parallel source writers. Each group gets a tests-first worker and its own review gate; later groups must preserve earlier tests. M1 remains open after any partial group.

### Locked source manifest (IDs below are exact-path references)

| ID | Absolute path | Change boundary |
| --- | --- | --- |
| S01 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/localWorkspace/normalized/incrementalSha256.ts` | New pure hash leaf; Group 1. |
| S02 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/shared/cooperativeWork.js` | New dependency-free work drivers, effects, counters. |
| S03 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/shared/cooperativeWork.d.ts` | New shared protocol declarations; JS runtime also works in Node/server imports. |
| S04 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/shared/jsonWork.js` | New canonical/ordered JSON/string/UTF-8/sort/copy programs. |
| S05 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/shared/jsonWork.d.ts` | New traversal declarations. |
| S06 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/localWorkspace/canonical.ts` | Synchronous canonical API delegates to shared traversal; optional work-aware existing async digests. |
| S07 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/localWorkspace/normalized/work.ts` | New private frame/hash adapters and normalization metrics helpers; no IDB capability. |
| S08 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/loadProjectState.ts` | Shared load generator and synchronous wrapper. |
| S09 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/migration.ts` | Versioned generators only; no migration rule edits. |
| S10 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/textOverflow.ts` | Normalization helpers only. |
| S11 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/textPadding.ts` | Normalization helpers only; geometry/resolvers unchanged. |
| S12 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/layers.ts` | `ensureTemplateLayers` extraction only. |
| S13 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/shared/validateAppState.js` | Shared validation generators; same predicates/error order. |
| S14 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/shared/generatorMetadata.js` | Shared source-byte and metadata validation generators. |
| S15 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/localWorkspace/validation.ts` | Shared strict project/preset/import preparation. |
| S16 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/localWorkspace/migration.ts` | Preparation/reconstruction loops and hash plumbing, no admission policy change. |
| S17 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/localWorkspace/lineageRepair.ts` | Shared stepped preparation; preserve both digest checks. |
| S18 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/localWorkspace/legacy.ts` | Optional runtime for captures/hashes/exact equality; same three-read stable protocol. |
| S19 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/localWorkspace/historicalBootstrap.ts` | Thread runtime through existing prerequisite state machine; shared ledger/backup checks. |
| S20 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/localWorkspace/indexedDbAdapter.ts` | Only normalization-reached `inspect`, prerequisite read methods, `enqueuePreparedCopy`, `writeInitialCopy`, `repairHistoricalLineage`, `markVerified`, `markLegacyDrift`: optional lifecycle/counters and per-row IDB callbacks. No new writer/store/write policy; ordinary/destructive methods unchanged. |
| S21 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/document/partition.ts` | Shared partition/raw assembly only; hydration/render/edit helpers unchanged. |
| S22 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/localWorkspace/normalized/sizeLedger.ts` | Shared contribution traversal; selected arithmetic/budgets unchanged. |
| S23 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/localWorkspace/normalized/codec.ts` | Shared validation/decompose/reconstruct and project-at-a-time target iterator. |
| S24 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/localWorkspace/normalized/commitProof.ts` | Shared bulk proof/lineage traversal and exact frame programs; no proof-field/ordinary-save change. |
| S25 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/localWorkspace/normalized/repository.ts` | Sole normalized writer; private sessions, candidates/seals and independent admission. |
| S26 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/localWorkspace/recovery.ts` | Normalization selectors/exports only, combined read and optional runtime. |
| S27 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/localWorkspace/normalized/migration.ts` | Session orchestration, exact phase fences and cancellation outcome. |

S20 is a necessary **shared prerequisite loop seam**, not a new loader/policy expansion: `inspect:498–503` scans all backups, `enqueuePreparedCopy:524–537` queues all records synchronously, and `repairHistoricalLineage:649–664` sorts all keys/queues all replacements. Leaving these unchanged would hide application loops and cancellation opportunities. Extract only those loops and thread guards into their existing transactions under spec §2; keep `prerequisiteTransaction`/`requireUnreservedNormalization` exact capability semantics. Do not implement adapter normalized writes or copied-source replacement through this path.

### Locked test/helper manifest

| ID | Absolute path |
| --- | --- |
| T01 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/normalized/incrementalSha256.test.ts` (new) |
| T02 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspaceBoundary.test.ts` |
| T03 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/normalized/work.test.ts` (new) |
| T04 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/canonical.test.ts` |
| T05 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/cooperativeLoader.test.ts` (new) |
| T06 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/validation.test.ts` |
| T07 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/server/validateAppState.test.js` |
| T08 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/generatorMetadata.test.ts` |
| T09 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/migrationPreparation.test.ts` |
| T10 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/lineageRepair.test.ts` |
| T11 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/bootstrap.test.ts` |
| T12 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/normalized/codec.test.ts` |
| T13 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/normalized/commitProof.test.ts` |
| T14 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/normalized/migration.test.ts` |
| T15 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/document/partition.test.ts` |
| T16 | `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/helpers/normalizationWorkHarness.ts` (new) |

Use this explicit manifest, not a directory grant. Repeated assignments to a file in sequential groups do not add paths to the 43-file total.

---

## Group 1: Bounded incremental SHA-256 leaf

### Exact file scope and interfaces

- Create `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/localWorkspace/normalized/incrementalSha256.ts`: pure SHA-256 state, at most one input-block compression per update, at most two padding-block compressions at finish, no dependencies or persistence access.
- Create `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/normalized/incrementalSha256.test.ts`: known vectors, differential current frames, fragmentation, counters and ownership/closed-instance behavior.
- Modify `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspaceBoundary.test.ts`: only `workerRuntimeEdges` near 2415–2454 and a focused pure-helper positive/mutation-negative suite near 3621. No directory exemption, writer permission or live import edge.

Consumes existing `frameRecord(store, record, core?)` and `canonicalStringify(value)` **only as test oracles**. Neither is modified or used in production by this group. Existing `NormalizedEnvironment.hash(input: string): string | Promise<string>` remains unchanged, so all existing race hooks stay effective during this group.

Produces these types, defined once in the new source file:

```ts
export interface HashWork {
  inputBytes: number; // Real message bytes, never padding.
  blocks: number;     // Compression calls, including padding at finish.
  visits: number;     // Copy bytes, schedule words, rounds, state words, hex words, release slots.
}
export interface HashFinish { digest: string; work: HashWork }
export interface NormalizationSha256 {
  update(bytes: Uint8Array): HashWork; // 0..64 bytes only; copies before return.
  finish(): HashFinish;               // Closes instance and releases owned buffers.
  dispose(): HashWork;                // Idempotent; closes without returning a digest.
  retainedBytes(): number;            // 352 while live; 0 after finish/dispose.
}
```

The factory signature is `createNormalizationSha256(): NormalizationSha256`; its implementation appears in §1.2. The 64-byte update limit is a private stepping API, **not a new document/record size limit**. Future framing driver splits arbitrarily large frames into these updates. Reserve 200 visits before `update`, 488 before `finish`, and 136 before `dispose`, or the exact cost predicted from the adapter's own pending-byte count; yield first if remaining quantum is smaller, then charge actual work. G2b gives that exact prediction. This keeps ordinary application hash loops counted; no new primitive exception is claimed. Constructor owns a fixed 352-byte scratch set (8 state words, 64 schedule words, 64 input bytes); constants are shared, not per-instance. Numeric counters are internal, not authority receipts or public diagnostics.

### 1.1 Write tests first

- [ ] Create the new test file with this concrete suite (relative imports are code module specifiers, not filesystem tool paths):

```ts
// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createNormalizationSha256 } from '../../../../services/localWorkspace/normalized/incrementalSha256';
import { canonicalStringify } from '../../../../services/localWorkspace/canonical';
import { frameRecord } from '../../../../services/localWorkspace/normalized/commitProof';

const encode = (text: string) => new TextEncoder().encode(text);
const oracle = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function digest(bytes: Uint8Array, width: number) {
  const hash = createNormalizationSha256();
  let inputs = 0;
  let blocks = 0;
  expect(hash.retainedBytes()).toBe(352);
  for (let offset = 0; offset < bytes.length; offset += width) {
    const chunk = bytes.subarray(offset, offset + width);
    const work = hash.update(chunk);
    expect(work.inputBytes).toBe(chunk.length);
    expect(work.blocks).toBeLessThanOrEqual(1);
    expect(work.visits).toBe(chunk.length + 136 * work.blocks);
    expect(work.visits).toBeLessThanOrEqual(200);
    inputs += work.inputBytes;
    blocks += work.blocks;
  }
  const final = hash.finish();
  expect(final.work.inputBytes).toBe(0);
  expect(final.work.blocks).toBeGreaterThanOrEqual(1);
  expect(final.work.blocks).toBeLessThanOrEqual(2);
  expect(final.work.visits).toBeLessThanOrEqual(488);
  expect(blocks + final.work.blocks).toBe(Math.ceil((bytes.length + 9) / 64));
  expect(inputs).toBe(bytes.length);
  expect(hash.retainedBytes()).toBe(0);
  return final.digest;
}

describe('bounded incremental SHA-256', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
  ])('matches known vector %j', (text, expected) => {
    for (const width of [1, 7, 55, 56, 63, 64]) expect(digest(encode(text), width)).toBe(expected);
  });
  it('matches the million-a vector without retaining input', () => {
    const hash = createNormalizationSha256();
    const chunk = new Uint8Array(64).fill(97);
    for (let offset = 0; offset < 1_000_000; offset += 64) hash.update(chunk);
    expect(hash.retainedBytes()).toBe(352);
    expect(hash.finish().digest).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
    expect(hash.retainedBytes()).toBe(0);
  });
  it.each([0, 1, 55, 56, 63, 64, 65, 127, 128, 129, 4097])('handles padding/fragmentation at %i bytes', length => {
    const bytes = Uint8Array.from({ length }, (_, index) => (index * 37 + 255) & 255);
    for (const width of [1, 7, 55, 56, 63, 64]) expect(digest(bytes, width)).toBe(oracle(bytes));
  });
  it('copies a caller chunk immediately, rejects oversized steps without consuming them', () => {
    const hash = createNormalizationSha256();
    const first = encode('a');
    hash.update(first); first[0] = 122;
    expect(() => hash.update(new Uint8Array(65))).toThrow(RangeError);
    expect(hash.update(new Uint8Array(0))).toEqual({ inputBytes: 0, blocks: 0, visits: 0 });
    hash.update(encode('bc'));
    expect(hash.finish().digest).toBe(oracle(encode('abc')));
    expect(() => hash.update(encode('x'))).toThrow('closed');
    expect(() => hash.finish()).toThrow('closed');
    expect(hash.dispose()).toEqual({ inputBytes: 0, blocks: 0, visits: 0 });
  });
  it('releases its fixed buffers on explicit disposal', () => {
    const hash = createNormalizationSha256(); hash.update(encode('ab'));
    expect(hash.dispose()).toEqual({ inputBytes: 0, blocks: 0, visits: 136 });
    expect(hash.retainedBytes()).toBe(0);
    expect(() => hash.finish()).toThrow('closed');
  });
  it('matches current canonical and record/core frame hash bytes', () => {
    const payload = { text: '\u0000\b\t\n\f\r"\\ café 😀 \ud800 \udc00', n: -0, empty: '',
      array: [false, null, { z: 1, a: 2 }], long: '😀x'.repeat(30_000) };
    const record = { key: ['g', 'p', 'i', 'n'], formatVersion: 3, value: payload,
      encodedSize: { valueBytes: 1 }, commitProof: null, commitWindow: { entries: [], floorRevision: 0 } };
    const frames = [canonicalStringify(payload), frameRecord('projectNodes', record), frameRecord('projectNodes', record, true)];
    for (const frame of frames) expect(digest(encode(frame), 63)).toBe(oracle(encode(frame)));
    expect(digest(encode(frames[1]), 64)).not.toBe(digest(encode(frames[2]), 64));
  });
});
```

These tests deliberately frame an arbitrary object rather than asserting it is an admitted normalized record. Schema/size validation is not the hasher's responsibility. Test oracle whole-frame encoding is allowed; production traversal is not switched by this group.

- [ ] Run RED with working directory `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence`:

```bash
NO_COLOR=1 FORCE_COLOR=0 TMPDIR=/tmp/opencode node /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/node_modules/vitest/vitest.mjs run /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/normalized/incrementalSha256.test.ts --silent --reporter=dot
```

Expected RED: unresolved new `incrementalSha256` module. Save actual failure evidence in controller-authorized artifacts; do not create arbitrary report files under this planning authorization.

### 1.2 Implement the complete bounded hash algorithm

- [ ] Create the source file. Prepend the interfaces above, then implement the following code. No WebCrypto delegation, whole-input accumulator, third-party dependency or alternate digest construction.

```ts
const INITIAL = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const rotr = (word: number, count: number) => (word >>> count) | (word << (32 - count));
const emptyWork = (): HashWork => ({ inputBytes: 0, blocks: 0, visits: 0 });

export function createNormalizationSha256(): NormalizationSha256 {
  let state: Uint32Array | undefined = new Uint32Array(INITIAL);
  let schedule: Uint32Array | undefined = new Uint32Array(64);
  let block: Uint8Array | undefined = new Uint8Array(64);
  let used = 0; let bytesLow = 0; let bytesHigh = 0;
  const assertOpen = () => { if (!state) throw new Error('SHA-256 instance is closed'); };
  const compress = (work: HashWork) => {
    const h = state!; const w = schedule!; const b = block!;
    for (let i = 0; i < 16; i++) {
      const j = i * 4;
      w[i] = ((b[j] << 24) | (b[j + 1] << 16) | (b[j + 2] << 8) | b[j + 3]) >>> 0;
      work.visits++;
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15]; const y = w[i - 2];
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      work.visits++;
    }
    let [a, b0, c, d, e, f, g, h0] = h;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h0 + s1 + ch + K[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b0) ^ (a & c) ^ (b0 & c);
      const t2 = (s0 + maj) >>> 0;
      h0 = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b0; b0 = a; a = (t1 + t2) >>> 0;
      work.visits++;
    }
    const next = [a, b0, c, d, e, f, g, h0];
    for (let i = 0; i < 8; i++) { h[i] = (h[i] + next[i]) >>> 0; work.visits++; }
    used = 0; work.blocks++;
  };
  const append = (byte: number, work: HashWork) => {
    block![used++] = byte; work.visits++;
    if (used === 64) compress(work);
  };
  const dispose = (): HashWork => {
    const work = emptyWork();
    if (!state) return work;
    for (let i = 0; i < state.length; i++) { state[i] = 0; work.visits++; }
    for (let i = 0; i < schedule!.length; i++) { schedule![i] = 0; work.visits++; }
    for (let i = 0; i < block!.length; i++) { block![i] = 0; work.visits++; }
    state = undefined; schedule = undefined; block = undefined;
    used = 0; bytesLow = 0; bytesHigh = 0;
    return work;
  };
  return {
    update(bytes) {
      assertOpen();
      if (bytes.length > 64) throw new RangeError('SHA-256 update step exceeds 64 bytes');
      const work = emptyWork(); work.inputBytes = bytes.length;
      const previous = bytesLow;
      bytesLow = (bytesLow + bytes.length) >>> 0;
      if (bytesLow < previous) bytesHigh = (bytesHigh + 1) >>> 0;
      for (let i = 0; i < bytes.length; i++) append(bytes[i], work);
      return work;
    },
    finish() {
      assertOpen(); const work = emptyWork();
      const highBits = ((bytesHigh << 3) | (bytesLow >>> 29)) >>> 0;
      const lowBits = (bytesLow << 3) >>> 0;
      append(0x80, work);
      while (used !== 56) append(0, work);
      for (let shift = 24; shift >= 0; shift -= 8) append((highBits >>> shift) & 255, work);
      for (let shift = 24; shift >= 0; shift -= 8) append((lowBits >>> shift) & 255, work);
      let digest = '';
      for (let i = 0; i < 8; i++) { digest += state![i].toString(16).padStart(8, '0'); work.visits++; }
      work.visits += dispose().visits;
      return { digest, work };
    },
    dispose,
    retainedBytes: () => state ? 352 : 0,
  };
}
```

Length encoding preserves the SHA-256 64-bit bit-length trailer using two 32-bit byte counters. Additions are normalized modulo 2^32; signed bitwise intermediates are safe before final `>>> 0`. Only fixed-size scratch arrays and an eight-word local array are allocated; no retained list of input chunks. `retainedBytes()` measures owned buffers only, not actual heap or secure memory erasure.

- [ ] Rerun the exact 1.1 command. Expected GREEN: all new hasher tests pass. Do not change known vectors to fit implementation.

### 1.3 Pin the narrow helper capability boundary

- [ ] In the existing boundary test, add this suite before changing `workerRuntimeEdges`:

```ts
describe('normalization incremental hash leaf capability', () => {
  const path = `${normalizedPath}incrementalSha256.ts`;
  const actual = () => readFileSync(join(root, path), 'utf8');
  it('allows the dependency-free production helper', () => {
    expect(analyzeProductionSource(path, actual())).toEqual([]);
  });
  it.each([
    "import './unreviewedNormalizationCapability';",
    "import './repository';",
    "import '../indexedDbAdapter';",
    'void import(unknownModule);',
    'self.localStorage.getItem("unreviewed");',
    'new Worker(unknownWorkerUrl);',
  ])('rejects added capability: %s', addition => {
    const findings = analyzeProductionSource(path, `${actual()}\n${addition}`);
    expect(findings.some(finding => finding.includes('could not be parsed'))).toBe(false);
    expect(findings).not.toEqual([]);
  });
});
```

- [ ] Run the focused boundary command; record actual RED behavior before policy edit. If existing blanket protection already rejects all mutations, preserve those GREEN probes and record that there is no new failing capability rule to repair; never weaken them to manufacture RED.

```bash
NO_COLOR=1 FORCE_COLOR=0 TMPDIR=/tmp/opencode node /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/node_modules/vitest/vitest.mjs run /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspaceBoundary.test.ts -t 'normalization incremental hash leaf capability' --silent --reporter=dot
```

- [ ] Add exactly this leaf entry to `workerRuntimeEdges`; no runtime caller edges are introduced in Group 1:

```ts
[`${normalizedPath}incrementalSha256.ts`, []],
```

The future work/framing helper will need a separately named edge to this leaf in Group 2. Do not grant `normalized/` imports generally. The existing `workerPrivateCallers` and adapter capability rules remain unchanged.

- [ ] Rerun the focused boundary command. Expected GREEN for positive and all mutation-negative probes.

### 1.4 Regression gate and handoff

- [ ] Run focused compatibility regressions and full static boundary (same exact workdir):

```bash
NO_COLOR=1 FORCE_COLOR=0 TMPDIR=/tmp/opencode node /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/node_modules/vitest/vitest.mjs run /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/normalized/incrementalSha256.test.ts /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/canonical.test.ts /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/normalized/commitProof.test.ts /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspaceBoundary.test.ts --silent --reporter=dot
```

Expected GREEN, preserving every retained test. The existing `commitProof.test.ts` path was confirmed during planning. Group 1 has no repository integration and cannot satisfy read-pass, lifecycle or whole-normalization budgets by itself.

- [ ] Run full typecheck and build using the cumulative command policy at the end of this plan. Report actual outcomes; known unrelated typecheck failure is not GREEN.
- [ ] Controller review Group 1's dirty-baseline delta and raw RED/GREEN evidence. Check constants, modulo arithmetic, padding, input ownership, exact byte differential tests, and no new runtime capability. No commit. Hand off `createNormalizationSha256` exactly as typed above; proceed only through the sequential review gates below.

---

## Shared protocol and executable follow-up groups

### Shared types — define once, do not rename in later groups

S03 declares the JS protocol. Every source program imports these types only where TypeScript needs annotations. S02 is real JavaScript so existing server imports of shared validators do not acquire a runtime TypeScript dependency.

```ts
export type Phase = 'discovery' | 'prerequisite' | 'prepare' | 'reserve' | 'stage'
  | 'verify' | 'activate' | 'reopen' | 'retained' | 'recovery' | 'legacy-fence';
export type StoreClass = 'none' | 'source' | 'backup' | 'target' | 'marker';
export type FrameKind = 'none' | 'source' | 'target' | 'proof' | 'stage' | 'marker' | 'legacy';
export type NativeKind = 'clone' | 'parse' | 'keys' | 'scalar' | 'sort' | 'idb-record'
  | 'record-compare' | 'release' | 'compat-json';
export type Metric = 'visits' | 'emittedBytes' | 'sortComparisons' | 'comparedCodeUnits'
  | 'yields' | 'checks' | 'observedAborts' | 'primitiveExceptions'
  | 'candidateRows' | 'candidateBytes' | 'sealRows' | 'sealBytes' | 'metadataRows' | 'metadataBytes'
  | 'pageTransactions' | 'sealTransactions' | 'eofChecks' | 'markerCasRows'
  | 'markerBytes' | 'markerWorkBytes' | 'writes' | 'stageTransactions' | 'stageRecords'
  | 'sourceDerivations' | 'targetDerivations' | 'projectReconstructions'
  | 'frameBytes' | 'hashBytes' | 'sourceHashBytes' | 'targetHashBytes'
  | 'proofHashBytes' | 'stageHashBytes' | 'markerHashBytes' | 'legacyHashBytes'
  | 'legacyCaptures' | 'legacyReads' | 'legacyReadBytes' | 'backupValidations'
  | 'retries' | 'ownedBytes' | 'ownedHighWater' | 'captureGraphs' | 'captureHighWater';
export type Counters = Readonly<Record<Metric, number>>;
export interface WorkEvent {
  phase: Phase; storeClass: StoreClass; frameKind: FrameKind;
  kind: 'work' | 'durable'; counters: Counters;
}
export interface Operation {
  visits: number; utf8Bytes: number; nativeKind?: NativeKind;
  metric?: Metric;
  run(runtime?: WorkRuntime): unknown; // Synchronous only. No promise/IDB transaction escapes here.
}
export type Work<T> = Generator<Operation, T, unknown>;
export interface Ownership {
  grow(bytes: number): void;
  release(): void;
}
export interface WorkControl {
  assertCurrent(): void;
  yieldTask?(): Promise<void>; // Default: owned local MessageChannel task queue, timer fallback.
  observe?(event: WorkEvent): void;
}
export interface WorkRuntime {
  run<T>(program: Work<T>): Promise<T>;
  wait<T>(operation: () => Promise<T>): Promise<T>;
  assertCurrent(): void;
  addGuard(guard: () => void): () => void;
  setContext(phase?: Phase, storeClass?: StoreClass, frameKind?: FrameKind): void;
  context(): Readonly<Pick<WorkEvent, 'phase' | 'storeClass' | 'frameKind'>>;
  note(metric: Metric, amount?: number): void;
  snapshot(phase?: Phase): Counters;
  notify(kind?: 'work' | 'durable'): void;
  quiet<T>(operation: () => Promise<T>): Promise<T>;
  own(bytes: number, captureGraph?: boolean): Ownership;
  stopped(): boolean;
  dispose(): void; // Close owned scheduler; snapshot remains readable; no persistence.
}
export function effect<T>(visits: number, run: () => T, utf8Bytes?: number,
  metric?: Operation['metric']): Work<T>;
export function primitive<T>(kind: NativeKind, run: () => T): Work<T>;
export function retainWork(bytes: number): Work<Ownership>;
export function runSync<T>(program: Work<T>): T;
export function createWorkRuntime(control: WorkControl): WorkRuntime;
export function assertWorkRuntime(value: unknown): asserts value is WorkRuntime;
```

`Operation` describes work **before it executes**, not a receipt after an unlimited callback. Each application effect does at most its declared scalar/element/hash-block work. Work generator code between yields is O(1) cursor bookkeeping; every input-sized loop delegates/yields. A native operation contains exactly its named primitive, never a loader/validator. Creating an operation does not execute its closure. Public observers receive frozen copies of numeric counters and fixed enums only, not operations/programs/runtime objects.

`createWorkRuntime` captures control callbacks once, registers the returned object in a module-private WeakSet and freezes its methods. `assertWorkRuntime` rejects forged/unregistered executors; repository sessions and normalizer validate injected runtime before use. Otherwise a caller could supply a fake `run` that skips validation and returns invented data. This brand certifies only executor implementation, never payload validity/current authority. Guards use unique registration tokens so removing one cannot remove another owner's guard. Reject reentrant CPU `run` on the same runtime. `setContext` validates enums at runtime: a provided phase resets omitted classes to `none`; omitted phase changes only provided classes. `note` validates a declared metric and finite numeric increment; snapshot enumerates only declared keys. Observer objects cannot change internal counters/context. Never pass runtime/operations or a validation graph to a progress callback.

S05 declares traversal programs used by S06/S07 and all extracted rule owners:

```ts
import type { Work } from './cooperativeWork.js';
export type JsonEmit = (text: string) => Work<void>; // Fragments <=16 UTF-16 units; never split a pair.
export type Frame = (emit: JsonEmit) => Work<void>;
export type JsonMode = 'compat' | 'plain';
export function canonicalWork(value: unknown, emit: JsonEmit, nesting?: number): Work<void>;
export function orderedJsonWork(value: unknown, emit: JsonEmit): Work<void>;
export function quoteWork(text: string, emit: JsonEmit): Work<void>;
export function textWork(text: string, emit: JsonEmit): Work<void>;
export function utf8LengthWork(text: string): Work<number>;
export function plainJsonBytesWork(value: unknown): Work<number>;
export function jsonTextWork(value: unknown): Work<string>;
export function jsonCloneWork<T>(value: T, mode: JsonMode): Work<T>;
export function normalizeOwnedJsonWork<T>(value: T): Work<T>;
export function copyEnumerableWork<T extends object>(value: T): Work<T>;
export function compareStringsWork(left: string, right: string): Work<number>;
export function stableSortWork<T>(values: readonly T[], compare: (a: T, b: T) => Work<number>): Work<T[]>;
export function equalFrameWork(left: Frame, right: Frame): Work<boolean>;
```

`plain` selects the resumable plain-object/array JSON algorithm, not a durable validation receipt. Normalization first establishes canonical input safety, but transformations/native clones can subsequently produce holes, undefined or nonfinite numbers; ordered JSON/JSON-clone mode must still apply native JSON conversion rules to those values. `compat` preserves standalone arbitrary-prototype/getter/toJSON behavior through the original native JSON.stringify/parse operation. **Normalization always establishes JSON safety then passes `plain`; it never takes `compat-json` to serialize an entire project.** Canonical validation remains strictly finite/dense/accessor-free. Both modes use the same migration/validation predicates; only the serialization primitive differs.

S07 exports these private adapters; existing `ProjectStoreName`, `Work`, `Frame`, `FrameKind`, `WorkRuntime` are the types above/existing schema, not new durable types:

```ts
export const canonicalFrame: (value: unknown) => Frame;
export const orderedFrame: (value: unknown) => Frame;
export const envelopeFrame: (label: string, value: object) => Frame;
export const listFrame: (label: string, values: readonly object[]) => Frame;
export const frameBytesWork: (frame: Frame) => Work<number>;
export const hashFrame: (work: WorkRuntime, kind: Exclude<FrameKind, 'none'>, frame: Frame) => Promise<string>;
```

S07 re-exports `equalFrameWork` from S04; there is one token-comparison implementation, also usable by historical adapter record comparisons without an adapter→normalized runtime edge.

S24 additionally exports `recordFrame(store: ProjectStoreName, record: object, core?: boolean): Frame` and `manifestFrame` with the existing `frameManifest` parameters/return changed only to `Frame`. Old `frameRecord`/`frameManifest` retain their signatures and drain these programs into strings. S25's source/manifest grammar composes frames directly; no whole-workspace frame string is built.

One shared incremental frame-hash implementation lives in S06, exported as `digestFrame(frame: Frame, work: WorkRuntime, kind: Exclude<FrameKind, 'none'>): Promise<string>`. S07 `hashFrame(work,kind,frame)` delegates to it; S06's work-aware legacy/workspace digest helpers use it too. This prevents duplicated encoder/hash loops and avoids a S06↔S07 cycle: S06 imports S01/S02/S04, while S07 imports S06, never the reverse. Existing no-work `sha256Hex` still uses supplied SubtleCrypto. Work-aware raw `sha256Hex` and historical workspace-content hashing count as source; stable legacy snapshot hashing counts as legacy. Backup validation explicitly uses `digestFrame(legacySnapshotFrame(...),work,'source')`. Record/proof framing remains owned by S24, not copied into S07.

### Group 2a — work protocol, guards and counters

**Files:** create S02/S03/T03/T16; modify T02 only for exact helper edges. Consumes G1. Produces `effect`, `primitive`, `runSync`, `createWorkRuntime` above.

- [ ] Add T16 test helper, used unchanged by later groups:

```ts
import { afterEach } from 'vitest';
import { createWorkRuntime, type Phase, type WorkEvent, type WorkRuntime } from '../../shared/cooperativeWork.js';
const runtimes: WorkRuntime[] = [];
afterEach(() => { for (const runtime of runtimes) runtime.dispose(); runtimes.length = 0; });
export function makeWorkHarness(phase: Phase = 'prepare', timerTasks = false) {
  let cancelled = false;
  let observer: ((event: WorkEvent) => void) | undefined;
  const events: WorkEvent[] = [];
  const runtime = createWorkRuntime({
    assertCurrent: () => { if (cancelled) throw new DOMException('cancelled', 'AbortError'); },
    ...(timerTasks ? { yieldTask: () => new Promise<void>(resolve => setTimeout(resolve, 0)) } : {}),
    observe: event => { events.push(event); return observer?.(event); },
  });
  runtime.setContext(phase); runtimes.push(runtime);
  return { runtime, events, cancel: () => { cancelled = true; },
    observe: (next?: typeof observer) => { observer = next; } };
}
```

- [ ] Add T03 REDs (imports `describe/expect/it` from Vitest, `effect/runSync` from S02 and `makeWorkHarness` from T16):

```ts
describe('work driver', () => {
  function* count(count: number) {
    let result = 0;
    for (let i = 0; i < count; i++) result = yield* effect(1, () => result + 1);
    return result;
  }
  it('shares synchronous semantics and yields a real task at the quantum', async () => {
    expect(runSync(count(2050))).toBe(2050);
    const h = makeWorkHarness('prepare', true); let taskRan = false;
    setTimeout(() => { taskRan = true; }, 0);
    expect(await h.runtime.run(count(2050))).toBe(2050);
    expect(taskRan).toBe(true); expect(h.runtime.snapshot().yields).toBeGreaterThanOrEqual(2);
  });
  it('stops before executing more effects after task cancellation', async () => {
    const h = makeWorkHarness('prepare', true); let writes = 0;
    function* program() { for (let i = 0; i < 5000; i++) yield* effect(1, () => { writes++; }); }
    setTimeout(h.cancel, 0);
    await expect(h.runtime.run(program())).rejects.toMatchObject({ name: 'AbortError' });
    expect(writes).toBeLessThanOrEqual(1024);
    expect(h.runtime.stopped()).toBe(true);
  });
  it('isolates observers and keeps budgets across successive run calls', async () => {
    const h = makeWorkHarness(); h.observe(() => { throw new Error('passive'); });
    await h.runtime.run(count(1000)); await h.runtime.run(count(1000));
    expect(h.runtime.snapshot().visits).toBe(2000);
    expect(h.runtime.snapshot().yields).toBeGreaterThan(0);
  });
  it('returns errors through generator catch but never swallows lifecycle loss', async () => {
    function* caught() { try { yield* effect(1, () => { throw new TypeError('x'); }); }
      catch { return 'caught'; } return 'missed'; }
    const h = makeWorkHarness(); expect(await h.runtime.run(caught())).toBe('caught');
    h.cancel(); await expect(h.runtime.run(caught())).rejects.toMatchObject({ name: 'AbortError' });
  });
});
```

- [ ] RED command (workdir is the absolute worktree specified globally):

```bash
NO_COLOR=1 FORCE_COLOR=0 TMPDIR=/tmp/opencode node /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/node_modules/vitest/vitest.mjs run /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/normalized/work.test.ts -t 'work driver' --silent --reporter=dot
```

Expected RED: missing work module/exports. Implement driver using this exact dispatch logic; pseudocode uses declared methods/types:

```text
effect(v, fn, b=0, metric): return generator { return yield {visits:v, utf8Bytes:b, run:fn, metric} }
primitive(kind, fn): same generator, visits=1, utf8Bytes=0, nativeKind=kind
runSync:
  result = program.next()
  while !result.done:
    execute result.value.run(undefined); reject thenable results
    pass its return through program.next(value)
    application exception -> program.throw(error), preserving generator catches
  return result.value

cooperative run:
  share quantumVisits/quantumBytes across every run on THIS runtime
  assertCurrent before program.next and before/after every operation
  validate op: integer nonnegative cost, 1<=visits<=1024, 0<=utf8Bytes<=65536
  if next cost exceeds either remaining budget:
    assertCurrent; notify('work'); assertCurrent
    assertCurrent; await yieldTask(); assertCurrent
    increment yields; reset quantum counters
  execute exactly this operation.run(runtime); reject thenable; charge visits/bytes/optional metric
  nativeKind -> primitiveExceptions++; guards immediately around primitive
  application exception -> program.throw(error) (do not turn validation errors into cancellation)
  lifecycle exception -> latch stopped, observedAborts++ once, program.return(undefined), rethrow
  next result via program.next(value); return final value after assertCurrent
  finally close unfinished generator; finalizers only release references, never yield/write

wait(factory): assertCurrent; try await factory(); finally assertCurrent; return result
notify: assertCurrent; if not quiet, pass Object.freeze({enums, counters:Object.freeze(copyOfNumbers)})
  catch observer exception; then assertCurrent outside catch
quiet(factory): increment quietDepth; await factory(); decrement in finally; no trailing notification
own(bytes, captureGraph): increment logical counters/highwater; remember allocating phase;
  return {grow(delta): increment this lease + global/allocating-phase weights,
    release(): idempotent decrement of its accumulated weight and graph count}
addGuard(g): register synchronous guard; returned closure removes only this guard
assertCurrent: if latched stopped rethrow captured lifecycle error; otherwise call all guards
  on thrown guard error latch and rethrow; no callback exposes the error
```

`snapshot` returns a fresh frozen numeric copy, globally or for one phase. No opaque fields, IDs or error strings. `note` never invokes observers. `own` releases without checking the stopped guard so cancellation cannot prevent disposal. Record callback code may call `note`/`assertCurrent`, but never `run`/`wait`/task yield. Native primitives are counted without pretending they meet cooperative byte latency. Initialize all declared metric keys to zero; highwater counters only increase.

`retainWork(bytes)` yields one one-visit operation whose run(runtime) returns runtime.own(bytes), or an inert `{grow(){},release(){}}` under runSync. Generators retain that lease across their actual working-image lifetime and release it directly in finally (no yield on disposal). S15's single owned validation clone uses it; S23 target cursor keeps its image lease across next() calls, releasing before the next project/dispose. S25 starts a capture lease at zero with captureGraph=true, grows it per measured physical row, and releases in O(1) counter work while clearing graph containers through native release primitives. Hash adapters own their fixed buffers similarly. Ownership is never exposed to observers; Operation's optional runtime argument is used by this internal instrumentation, not user-data callbacks. Numerical weights are explicit logical payload/metadata weights, not claimed allocator/heap measurements.

Observer calls remain synchronous/passive and are never awaited. Isolate thrown exceptions; if a JavaScript caller nevertheless returns a thenable, attach rejection suppression without awaiting or using its result. Perform the following lifecycle assertion outside the observer catch. Do not use observer returns to control validation, transaction continuation or publication.

Default real-task scheduler: lazily create one local `MessageChannel`; queue at most one pending resolver because runtime CPU programs are serial; `port2.postMessage(0)` and `port1.onmessage` resolve that pending task, never forward payloads. Keep ports referenced while a task is pending; optional Node `ref/unref` feature checks may unref idle ports, not pending work. `dispose` closes both ports and rejects pending yield with AbortError; no port escapes. Where MessageChannel is unavailable, use setTimeout(0). This avoids a timer-clamp cost per tiny quantum while remaining a real task yield. It is not a worker/protocol/UI transport. T02 permits only this exact local numeric scheduler context if its AST rules require an adjustment; reject Worker construction, arbitrary postMessage payloads/port escape and storage access. Test both default channel task scheduling and injected timer path. Normalizer disposes only a runtime it created; caller-supplied runtime is caller-owned (T16 afterEach closes it).

- [ ] GREEN: rerun RED command. Add test for 65,536-byte budget using effects of `(1, noop, 32768)` and confirm yield before third effect; add rejection of an operation claiming >1024 visits. Test `quiet` with a throwing observer and mutation-after-observer guard. Use `function*(){ yield* effect(...) }`, no whole-loop effect.
- [ ] Boundary: add S02 runtime leaf `[]`; S03 is declarations only. Add T16 tests only, never production helper imports from tests. Use G1's positive/mutation-negative pattern for S02 (unreviewed import/storage/Worker denied). Review G2a independently before JSON extraction.

### Group 2b — canonical bytes, comparison and frame/hash adapters

**Files:** create S04/S05/S07; modify S06, T03/T04/T02. G2a types are fixed. No historical/codec callers switch yet.

Execute incrementally under the YAGNI amendment: first S04/S05's canonical, string and sorting traversal, S06's synchronous canonical wrapper, T04 parity/cancellation tests and exact T02 import edges. Do not add ordered-JSON/cloning utilities or frame adapters before implementing their concrete callers in the remaining G2b work. This first slice is not G2b completion; frame hashing, ordered JSON and later migration integration retain their gates. G2a's unchanged runtime/declarations/harness/tests retain review03's behavioral assessment; its remaining static proof findings were withdrawn by the user. Controller verified the amended checks with 987 tests/5 files, build11.80s, baseline-only TS2339, and identical runtime blobs before this slice.

String implementation refinement: native JSON escaping may process bounded chunks of at most16 UTF-16 input units without splitting a pair, rather than allocating work operations per character. Reserve the bounded copy/read/escape cost before each chunk; the temporary escaped string is at most96 units and emissions remain at most16 units. This shares native JSON escaping semantics without a whole-string exception. A deterministic operation-count regression and the existing large Sticker Press round-trip guard against the observed per-character dispatch slowdown. Do not increase test timeouts to accommodate it.

Synchronous compatibility refinement: S06 delegates to `canonicalText` in S04. That function privately drains the same descriptor/depth/cycle/container traversal with native string escaping/key sorting, as the old synchronous API did. `canonicalWork` always uses bounded strings/comparisons/sorting, including when a test drains it synchronously. No caller-visible fast-mode flag or unbounded cooperative program is added. Only native scalar/sort choices differ; validation rules are shared. Routing existing synchronous callers through tiny string/sort work operations caused the pinned codec test to exceed its unchanged30s limit (initial109.72s, bounded-string batching alone still failed); the shared synchronous strategy passed the105-test focused run in15.71s. Broader verification remains required. This refines the earlier literal wrapper requirement; it does not permit calling `canonicalText` as a whole cooperative work operation.

Final slice verification: the shared synchronous traversal also avoids per-step dispatch; only cooperative execution creates bounded work operations. After this correction,1957 covering tests/17 files passed315.00s with existing timeouts unchanged; build passed11.36s and typecheck failed only on known Sticker Press TS2339. Canonical source/tests were controller-reviewed; no fresh independent G2b review, native performance result or whole-group completion is claimed. Remaining G2b framing/hash/ordered-JSON work is still pending.

Next narrow slice: implement S06 `digestFrame`, S07 canonical/envelope/list frames and byte counting, and optional work-aware raw/legacy digest calls. Preserve exact source-envelope/list bytes, including empty-list punctuation and independent payload depth. Hashing owns only fixed scratch buffers and bounded UTF-8 fragments; cancellation releases scratch without yielding in finalizers (fixed-size cleanup is a release exception). Keep no-work SubtleCrypto behavior. Ordered JSON, cloning, frame equality, workspace-envelope traversal and repository adoption remain subsequent work; do not add unused stubs. Cover exact hashes, padding boundaries, counters, lifecycle cleanup and unchanged architecture checks in T03/T04/T02.

Streaming slice implemented and controller-verified:2000 covering tests/17 files PASS322.10s, build11.61s, tsc sole known Sticker Press TS2339. No changes to G1, the work runtime, synchronous canonical traversal or repository callers. Frame equality/ordered JSON/workspace traversal and later integration remain pending; this is not whole-G2b or Task11b acceptance. Execution evidence is recorded in the ledger, without a handoff or new worker invocation.

Next slice: S04 frame comparison plus plain ordered-JSON traversal, S05 declarations and S07 re-export/orderedFrame adapter. Compare incrementally with at most one fragment per producer and close both on every exit. Preserve operation return/error routing. Ordered JSON preserves enumeration order, omission/null/nonfinite conversion and cycle handling, never invokes user toJSON, and remains separate from standalone compatibility-mode APIs. Add only the byte-counting helpers with concrete frame/size consumers; cloning/copy helpers stay deferred. Existing synchronous canonical behavior stays unchanged.

Comparison/ordered slice implemented and controller-verified:2054 covering tests/17 files PASS322.80s, build10.83s, tsc sole known baseline TS2339. Existing frameBytesWork already measures orderedFrame, so no duplicate byte-counting helper was added. Comparator batches up to16 code-unit pairs per operation, reserving the maximum step cost and counting actual inspected units; offset/mismatch/cleanup semantics remain unchanged. Plain ordered JSON accepts plain/null-prototype maps, omits unsupported root values as empty output, and imposes no additional framing-depth cap; it is not a validation receipt or a replacement for standalone compatibility APIs. Copy/clone helpers and work-aware workspace composition remain pending, to be implemented with their concrete consumers. No whole-G2b acceptance or fresh independent review claimed.

Copy/workspace slice implemented and controller-verified:2088 covering tests/17 files PASS322.85s, build11.59s, tsc sole known baseline TS2339. Shared JSON copying/owned normalization implements the algorithms below, including safe data-property definition, alias duplication and separate tagged compatibility mode. Ordered output and copying share scalar/prototype/descriptor rules. Workspace digest gains the trailing optional runtime and reusable frame exports; it streams project IDs and one pending-import shallow projection at a time, preserving canonical nesting offsets and the createdAt exclusion. Historical workspace hash bytes count as source, as specified in S06. Existing no-work digest callers remain unchanged. Thin text/byte convenience adapters remain deferred to their concrete loader/size/index consumers under YAGNI; do not add a second byte-counter implementation. Next integration scope is approved G3a, not production cutover. Independent/cumulative review gates remain; this checkpoint does not accept all G2b or close M1.

- [ ] Add concrete T03/T04 REDs with imports from S04, S07, S06 and T16:

```ts
describe('cooperative canonical bytes', () => {
  async function collect(value: unknown) {
    const h = makeWorkHarness(); const chunks: string[] = [];
    function* emit(text: string) { yield* effect(1, () => { chunks.push(text); }); }
    await h.runtime.run(canonicalWork(value, emit)); return { text: chunks.join(''), h };
  }
  it('pins byte grammar instead of comparing two changed implementations only', async () => {
    const value = { z: -0, a: ['😀', '\ud800', '\u0000', '"\\'], n: null };
    expect((await collect(value)).text).toBe('{"a":["😀","\\ud800","\\u0000","\\\"\\\\"],"n":null,"z":0}');
  });
  it('resumes key comparison inside long equal prefixes', async () => {
    const prefix = 'k'.repeat(30_000);
    const value = { [prefix + 'z']: 1, [prefix + 'a']: 2 };
    const { text, h } = await collect(value);
    expect(text).toBe(`{${JSON.stringify(prefix + 'a')}:2,${JSON.stringify(prefix + 'z')}:1}`);
    expect(h.runtime.snapshot().comparedCodeUnits).toBeGreaterThanOrEqual(prefix.length);
    expect(h.runtime.snapshot().yields).toBeGreaterThan(0);
  });
  it('cancels within a long value before completion', async () => {
    const h = makeWorkHarness(); setTimeout(h.cancel, 0);
    await expect(hashFrame(h.runtime, 'source', canonicalFrame({ value: '😀'.repeat(100_000) })))
      .rejects.toMatchObject({ name: 'AbortError' });
  });
  it('keeps the historical per-payload depth accounting', async () => {
    const chain = (n: number) => { let v: unknown = {}; for (let i = 0; i < n; i++) v = { child: v }; return v; };
    expect((await collect(chain(512))).text).toBe(canonicalStringify(chain(512)));
    await expect(collect(chain(513))).rejects.toThrow(/nesting/);
    const value = { payload: chain(512) };
    const h = makeWorkHarness();
    expect(await hashFrame(h.runtime, 'source', envelopeFrame('envelope', value)))
      .toBe(createHash('sha256').update(`["envelope",{"payload":${canonicalStringify(value.payload)}}]`).digest('hex'));
  });
});
```

Also extend existing canonical rejection table through both drivers: undefined, nonfinite, bigint, function, symbols, sparse/custom arrays, custom prototypes, hidden object property, getter (zero invocations), cycle, and repeated acyclic reference. Test raw UTF-8 length of paired/lone surrogates against TextEncoder; test **all code units 0..65535** in bounded fixture chunks rather than one huge assertion string. Test `equalFrameWork` with equal text but different fragment boundaries. Existing goldens in T04 stay unchanged.

- [ ] RED/GREEN command:

```bash
NO_COLOR=1 FORCE_COLOR=0 TMPDIR=/tmp/opencode node /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/node_modules/vitest/vitest.mjs run /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/normalized/work.test.ts /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/canonical.test.ts --silent --reporter=dot
```

Expected RED: missing traversal/frame exports; existing T04 stays green. Implement the canonical/string/sort state machines in the critical-algorithms section, with these additional exact rules:

```text
canonicalWork(value, emit, depth=0):
  scalar: null/boolean/finite number -> bounded token; -0 -> "0"
  string: quoteWork; unsupported scalar -> existing JSON-compatible TypeError
  container: depth>512 fails; ancestor cycle fails; exact Array/Object prototype required
  keys = primitive('keys', Reflect.ownKeys); scan each key, reject symbols
  arrays: old dense count+length checks; for each index get own data descriptor;
    emit '[' / commas / ']'; recurse into descriptor.value at depth+1
  objects: stableSortWork(keys, compareStringsWork); then each descriptor must be
    enumerable data; emit '{', quoted key, ':', recursively canonical value, separators, '}'
  finally remove this ancestor; no global seen set rejecting shared acyclic objects

orderedJsonWork on prevalidated plain data:
  same token escaping; object keys in Object.keys enumeration order
  JSON conversion: object undefined/function/symbol fields omitted; corresponding array values/holes
    become null; nonfinite numbers become null, -0 becomes 0; bigint/cycles throw
  no added ancestry for framing; preserves integer-key enumeration and insertion order
  plain mode does not invoke user toJSON; standalone compatibility APIs use compat mode

jsonCloneWork(value, 'plain'):
  iterative stack of (source,target,keys,index), preserve original enumeration/array order
  allocate one container at a time; each own element/property copy is an effect
  apply the same JSON conversion rules above (including transform-produced nonfinite/undefined);
  duplicate repeated acyclic references like JSON.parse(JSON.stringify()), not structuredClone sharing
  define enumerable writable configurable data properties (including '__proto__')
  no joined JSON string, no stringify/parse for this mode
jsonCloneWork(value, 'compat'):
  one explicitly tagged compat-json primitive containing original JSON.parse(JSON.stringify(value))
  ONLY existing standalone synchronous loader behavior; not normalization-safe input path

normalizeOwnedJsonWork(value), ONLY on a private mutable working clone:
  shared JSON conversion rules, mutate first occurrence of each container in place;
  DFS active-ancestor set still rejects cycles; completed-object set detects repeated aliases;
  when a completed object appears again, jsonCloneWork its already normalized subtree and
    replace that alias edge (JSON stringify/parse duplicates aliases rather than preserving them);
  delete omitted fields, replace nonfinite/-0/array-hole values per JSON rules, retain enumeration order;
  do not clone the whole root at every historical version; any new alias branch is part of the
    required final working tree, not another complete historical working image.

copyEnumerableWork:
  Reflect.ownKeys native; inspect one descriptor at a time; skip nonenumerable keys;
  Get and define each enumerable value once in original order, including symbols
  return plain object like spread, not Object.assign with '__proto__' setter behavior
  normalization inputs are already accessor-free; standalone sync APIs retain their Get behavior
```

Merge sort comparison is resumable UTF-16 code-unit comparison, not native lexical compare per long key. Charge comparison count separately from code units and key movements. For numeric sort callbacks, normalize NaN comparator result to zero (Array.sort's equality behavior), stable left-first ties. Retain sparse-array holes for standalone map wrappers: check `index in array` before invoking element transformer; normalized inputs are dense after validation.

S07 composition and hash algorithm:

```text
canonicalFrame(v) = emit => canonicalWork(v, emit)
orderedFrame(v) = emit => orderedJsonWork(v, emit)
envelopeFrame(label, row): emit '['; quote label; emit ',{'; enumerate/sort enumerable own
  fields exactly as old captureFrame; for each field quote key, ':', canonicalWork(value, depth=0);
  emit '}]'
listFrame(label, rows): emit '['; quote label; emit ','; each envelopeFrame('envelope', row)
  separated by ','; emit ']'; KEEP the existing trailing comma for an empty list
digestFrame(frame, runtime, kind) / delegating hashFrame(runtime, kind, frame):
  create Group1 hasher; emit fragments through UTF-8 encoding (<=16 code units, <=48 bytes)
  adapter keeps pending byte count b; reserve exact update visits n+136*Number(b+n>=64)
  update inside that effect, assert returned cost agrees, b=(b+n)%64; charge emitted n bytes
  note actual frameBytes/hashBytes and kind-specific input bytes, NOT SHA padding bytes
  finish cost=(b<56?64-b:128-b)+136*(b<56?1:2)+8+136 (<=488)
  finish through that effect; valid 64-character lowercase digest required
  finally dispose hasher even on cancellation; no array of all fragments
frameBytesWork(frame): same UTF-8 emitter but count instead of hash
equalFrameWork(left,right): two incremental token producers, at most one <=16-unit fragment
  pending from each; compare code units/offsets stepwise until mismatch or both end;
  advance producer by one Operation at a time, delegating costs, never materialize full frame
```

Implement token-producer adapter in S04 and re-export through S07: frame emitter yields an effect whose execution sets one pending fragment; `advance` delegates one producer operation at a time and stops once pending text exists or producer is done. Compare leftover fragments using per-character offsets, clearing only consumed fragments. Close both generators on early mismatch/error. Emitters must not overwrite pending text before it is consumed. `canonicalStringify` is `runSync` over this same canonical program with a collecting emitter; its whole-string return is intentionally unchanged for existing callers, never used by cooperative normalization. `jsonTextWork` likewise collects ordered JSON only for required physical/index key strings; its output is metadata I, not a workspace-sized frame buffer.

- [ ] GREEN above command plus G1 test. Add differential hashes against node crypto for every source/list/record/core/manifest domain as those consumers arrive; legacy digest tests already pin absence/raw text. No dependency install.
- [ ] Boundary exact edges: S04→S02; S06→S01/S02/S04 plus existing legacyTypes; S07→S06/S02/S04 only (schema imports type-only). Pure-helper mutation probes use G1 pattern. Do not add any helper→repository/adapter edge.

### Group 3a — shared overflow, padding and migration-layer programs

Controller implementation checkpoint: all three service extractions below are implemented; synchronous APIs drain the shared programs and private owned overflow/padding paths omit only the outer clone. Added enumerableEntriesWork for the two concrete services, preserving Object.entries/Object.values value-capture timing before transformation. Finite numeric layer sorting is resumable; malformed/coercing orders retain tagged native sorting. New25 behavior tests plus6 narrow architecture tests; final2184/24 covering PASS332.30s, build15.43s, tsc sole known baseline TS2339. Existing layer render/edit functions and fixed resolvers/defaults unchanged. No fresh independent group acceptance or end-to-end responsiveness claim; G3b orchestration and cumulative review remain pending.

**Files:** S10/S11/S12, create T05, T02 edges. Depends G2b. Existing geometry/render/edit functions remain byte-for-byte outside the extraction.

**Interfaces:** for every existing `normalizeTextOverflowElement/Template/Templates`, `normalizeTextOverflow`, `normalizeTextPaddingElement/Template/Templates`, `normalizeProjectTextPadding`, add the same-name `Work` suffix with the same generic parameters/arguments, returning `Work<T>` instead of `T`. Add `ensureTemplateLayersWork(template: PageTemplate): Work<PageTemplate>`. Existing synchronous exports become `return runSync(nameWork(arguments))`. Fixed-size resolvers/default values stay shared and unchanged.

Also export internal `normalizeOwnedTextOverflowWork<T extends Record<string,any>>(state:T): Work<T>` and `normalizeOwnedProjectTextPaddingWork<T extends Record<string,any>>(state:T): Work<T>`. These consume a private mutable working clone, omit only the outer structuredClone, and delegate the exact same template/element programs. Borrowed/public APIs keep their clone/reference semantics. No caller input is inferred immutable/owned.

- [ ] Add concrete T05 tests (imports from S10–S12, S02 and T16; Vitest `vi` restores random spy in finally):

```ts
describe('cooperative normalization helpers', () => {
  it('preserves element and repaired-template reference semantics', async () => {
    const h = makeWorkHarness();
    const rect = { type: 'rect', extension: { keep: true } };
    expect(await h.runtime.run(normalizeTextOverflowElementWork(rect))).toBe(rect);
    expect(await h.runtime.run(normalizeTextPaddingElementWork(rect))).toBe(rect);
    const template: any = { id: 'p', name: 'P', width: 10, height: 10,
      layers: [{ id: 'l', order: 0 }], elements: [{ id: 'e', type: 'rect', layerId: 'l' }] };
    expect(await h.runtime.run(ensureTemplateLayersWork(template))).toBe(template);
  });
  it('clones the project but retains standalone non-text element semantics', async () => {
    const raw = { variants: { v: { templates: { p: { elements: [{ type: 'text' }, { type: 'grid' }] } } } } };
    const before = structuredClone(raw); const h = makeWorkHarness();
    const out = await h.runtime.run(normalizeProjectTextPaddingWork(
      await h.runtime.run(normalizeTextOverflowWork(raw))));
    expect(out).not.toBe(raw); expect(raw).toEqual(before);
    expect(out.variants.v.templates.p.elements[0]).toMatchObject({ textOverflow: 'clip', textWrap: true,
      textPadding: { top: 0, right: 0, bottom: 0, left: 0 } });
    expect(out.variants.v.templates.p.elements[1]).toMatchObject({ textOverflow: 'clip', textWrap: false });
  });
  it('yields inside a wide template before random ID generation can repeat', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.25);
    try {
      const template: any = { id: 'p', name: 'P', width: 10, height: 10,
        elements: Array.from({ length: 4000 }, (_, i) => ({ id: String(i), type: 'rect' })) };
      const h = makeWorkHarness(); const out = await h.runtime.run(ensureTemplateLayersWork(template));
      expect(random).toHaveBeenCalledTimes(1); expect(h.runtime.snapshot().yields).toBeGreaterThan(0);
      expect(out.elements.every((e: any) => e.layerId === out.layers[0].id)).toBe(true);
      expect(ensureTemplateLayers(out)).toBe(out);
    } finally { random.mockRestore(); }
  });
});
```

- [ ] RED/GREEN command:

```bash
NO_COLOR=1 FORCE_COLOR=0 TMPDIR=/tmp/opencode node /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/node_modules/vitest/vitest.mjs run /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/cooperativeLoader.test.ts /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/textOverflowSettings.test.ts /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/textPadding.test.ts /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/layers.test.ts --silent --reporter=dot
```

Expected RED: missing Work exports. Replacement logic:

```text
Element overflow: call unchanged resolveTextOverflowSettings in one constant effect;
  null settings -> return original reference; else stepped shallow spread, then overwrite settings.
Element padding: if type != text -> original reference; else stepped shallow spread,
  assign result of unchanged four-side normalizeTextPaddingValue.
Template: stepped shallow copy; allocate elements array with original length;
  for each present index delegate ElementWork, retaining holes exactly as Array.map.
Templates dictionary: enumerate original entries; for each Get+delegate TemplateWork;
  construct own data properties in original order, matching Object.fromEntries.
Project: primitive structuredClone exactly where old API cloned; enumerate variants
  in original Object.values order; replace each templates dictionary; then legacy flat templates.
  Never combine overflow and padding into one transform: clone/order semantics stay separate.

ensureTemplateLayersWork:
  existing = Array.isArray(template.layers) ? template.layers : []
  layers = existing.length ? existing : [createDefaultLayer()] (ONE effect, original timing)
  build Set of layer.id via one effect per layer
  produce the exact stable numeric-order fallback of old [...layers].sort((a,b)=>a.order-b.order)[0]
  scan elements with old short-circuit predicate (!el.layerId || !ids.has(el.layerId))
  existing.length && no fix -> return ORIGINAL template
  otherwise shallow-copy template; reuse layers reference; map present element slots,
    retaining valid element references, stepped-spreading only invalid elements with fallback layerId
```

For valid finite own data-property numeric layer orders use `stableSortWork` with numeric comparator. Inspect descriptors without invoking getters when selecting that branch. For historically accepted malformed orders whose subtraction is non-transitive/NaN, retain **one native Array.sort operation** on the copied layer reference array, with lifecycle checks immediately around it and explicit `sort` native-operation counter. This is the existing engine primitive, not an exemption for element/template loops; canonical key sorting never uses it. Do not “repair” missing/non-numeric orders or replace the native result with a min-reduction that can change fallback IDs. Test `[2, missing, 1]`, equal orders, string orders and duplicate IDs against the preexisting synchronous result pinned before extraction. Standalone accessors/coercions use this same native compatibility branch without extra Get calls. Normalization's finite-order branch remains resumable.

- [ ] GREEN command above; inspect unchanged layer render/edit functions. T02 exact edges S10/S11/S12→S02/S04 only, keeping their existing imports. Add positive and arbitrary-import negative probes for each changed actual source.

### Group 3b — versioned migration and loader

Controller implementation checkpoint: all version programs and borrowed/owned loader paths below are implemented; synchronous public APIs use compat-mode Work programs. Owned paths preserve historical JSON conversion boundaries without full-tree clone/string round trips. Added38 behavior tests across all schemas, clone/identity rules, warning text, ID order, cancellation and historically boxed malformed variants;4 narrow architecture tests. Final2226/24 covering PASS329.69s, build14.02s, tsc sole known baseline TS2339. Generator provenance still uses its existing synchronous implementation, with an explicit G3c dependency comment in finishLoadWork; no whole-loader boundedness or independent acceptance is claimed. Next: G3c shared validation rules and concrete byte-counting adapters, before storage/session adoption.

**Files:** S08/S09, T05/T02. Depends G3a. No changes to preset selection/render policy.

**Interfaces:** `migrateStateWork(state: any, mode: JsonMode = 'compat'): Work<AppState>` and `loadProjectStateWork(raw: unknown, mode: JsonMode = 'compat'): Work<ProjectLoadResult>`. Add local `migrateVxToVyWork(state, mode)` functions for existing version functions; synchronous main wrappers call `runSync`. Normalization supplies `'plain'` only after canonical validation in G3c; standalone synchronous behavior keeps `'compat'`.

Internal ownership variants: `migrateOwnedStateWork(state: Record<string,any>): Work<AppState>` and `loadOwnedProjectStateWork(state: Record<string,any>): Work<ProjectLoadResult>`. They share version/element rules with borrowed programs, replacing each JSON-clone boundary by `normalizeOwnedJsonWork` and final overflow/padding outer clones by the owned variants. Entry is allowed only on S15's newly cloned mutable state; never on retained raw source. Public synchronous and borrowed Work APIs remain unchanged. This avoids retaining sourceClone→loaderClone→overflowClone→paddingClone→validationClone across cooperative yields during normalization checks.

- [ ] Add T05 REDs using existing `historicalState` from `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/helpers/localWorkspaceFixtures.ts`:

```ts
describe('cooperative loader', () => {
  it.each(Array.from({ length: 12 }, (_, i) => i))('matches schema %i and ID call order', async version => {
    const raw = historicalState(version); const before = structuredClone(raw);
    let calls = 0; const random = vi.spyOn(Math, 'random').mockImplementation(() => (++calls) / 100);
    try {
      const expected = loadProjectState(raw); const expectedCalls = calls; calls = 0;
      const h = makeWorkHarness(); const result = await h.runtime.run(loadProjectStateWork(raw, 'plain'));
      expect(result).toEqual(expected); expect(calls).toBe(expectedCalls); expect(raw).toEqual(before);
    } finally { random.mockRestore(); }
  });
  it('does not skip schema-11 hydration or detach warnings', async () => {
    const raw: any = historicalState(11);
    delete raw.variants.default.templates.page.elements[0].textPadding;
    raw.generator.hierarchyScript = 42;
    const h = makeWorkHarness(); const out = await h.runtime.run(loadProjectStateWork(raw, 'plain'));
    expect(out.warnings).toEqual(['Saved generator was detached: Hierarchy script must be text.']);
    expect(out.state.generator).toBeUndefined();
    expect(out.state.variants.default.templates.page.elements[0].textPadding)
      .toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
  it('cancels inside schema-11 template traversal', async () => {
    const raw: any = historicalState(11); const template = raw.variants.default.templates.page;
    template.elements = Array.from({ length: 5000 }, (_, i) => ({ ...template.elements[0], id: `e${i}` }));
    const h = makeWorkHarness(); setTimeout(h.cancel, 0);
    await expect(h.runtime.run(loadProjectStateWork(raw, 'plain'))).rejects.toMatchObject({ name: 'AbortError' });
  });
});
```

Expected RED: Work exports absent. Exact command:

```bash
NO_COLOR=1 FORCE_COLOR=0 TMPDIR=/tmp/opencode node /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/node_modules/vitest/vitest.mjs run /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/cooperativeLoader.test.ts /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/loadProjectState.test.ts /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/migration.test.ts /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/textOverflowPersistence.test.ts --silent --reporter=dot
```

- [ ] Replace version traversal with these exact rules; keep logging and error strings where they already occur, never forward them to diagnostics:

| Step | Clone/loop replacement and unchanged transformation |
| --- | --- |
| Entry | Same invalid-state throw; `version=state.schemaVersion ?? 0`; future version returns same reference immediately. |
| v0→1 | `yield* jsonCloneWork(state,mode)`; flat templates only; each present text element lacking autoWidth gets shallow copy plus false. |
| v1→2, v2→3 | Same JSON clone; bump version only. |
| v3→4 | Same clone; `{ default: {id:'default',name:'Default',templates:migrated.templates || {}} }`, activeVariantId default, delete flat templates. |
| v4→5 | Same clone; singular-selection truthiness determines one-element selectedNodeIds/selectedTemplateIds arrays. |
| v5→6 | Same clone; version bump only. |
| v6→7 | Same clone; variants first, flat templates second. Per element preserve exact stroke/Number(strokeWidth)/borderStyle conditions and gridConfig/borderSides assignment rules from current function. Four sides remain separate copies. |
| v7→8 | Same clone; variants first then flat templates; delegate `ensureTemplateLayersWork` once per applicable template, preserving random-ID order. |
| v8→9 | Same clone; bump only. |
| v9→10 | Same clone; variants then flat templates; overwrite text visible/true and grid ellipsis/false, not current defaults. |
| v10→11 | Same clone; variants then flat templates; every text element gets new ZERO_TEXT_PADDING copy. |
| Final | **Always** overflow ProjectWork then padding ProjectWork, even schema 11. |

Move each current version's scalar body unchanged into one-element effects; replace every `.forEach/.map/Object.values` loop with enumerated/indexed effects. Do not use one effect for a whole version. Preserve sparse-map/forEach behavior and `.type` throws for malformed null elements rather than silently skipping them.

`loadProjectStateWork`: native structuredClone(raw), delegate migration, then shared generator provenance normalization (G3c adds bounded source validation; until then leave its fixed interface and mark G3c dependency before normalization integration), shallow-copy migrated root in original order; normalized generator overwrites existing slot or appends; warning path deletes generator and returns exact one warning. Test future-version direct `migrateState` reference identity and `loadProjectState` clone independence separately. Standalone compat JSON conversion of undefined/nonfinite values remains unchanged; plain mode never substitutes structuredClone for the old JSON-clone semantics of `-0`.

- [ ] GREEN above. T02 add only S08/S09→S02/S04 and existing loader helper imports. Existing generatorMetadata edge remains. G3b is loader traversal parity; complete generator metadata work in G3c before claiming whole load bounded.

### Group 3c — one set of validation rules, two drivers

Project/check checkpoint: S15's six returning Work APIs and four discard-only check APIs are implemented with shared private predicates and native synchronous wrappers. Project/preset/import checks clone the state once, not the wrapper/extensions, and use owned loading followed by clone-free post-validation. Current migrated-state checking is read-only. Logical ownership reserves canonical input-state bytes and releases in finally; tests separately verify actual clone count and raw immutability. This is not an intermediate heap-peak estimate or completion of later session/heap budgets. Added30 behavior/2 architecture tests; final2354/26 covering PASS333.22s, build15.13s, tsc sole known baseline TS2339. G3c implementation is now present; independent/cumulative review remains unclaimed. Next integration: G3d historical record preparation using discard-only checks.

AppState/record checkpoint: S13 now shares node, template and whole-state rule traversals between native synchronous wrappers and bounded Work exports. Added plainJsonBytesWork with S13 as its concrete consumer, reusing the existing ordered-frame counter. Native JSON compatibility semantics and fast synchronous generator validation remain; Work paths step node children, long node-ID comparisons, templates and enumeration. Public record helpers retain permissive legacy shapes and do not add canonical admission. Added19 behavior/2 architecture tests; final2322/26 covering PASS333.29s, build15.36s, tsc sole known baseline TS2339. S15 project preparation/discard-only validation and ownership regression remain pending; no whole-G3c or independent acceptance claimed.

Generator-first checkpoint: S14 now shares one validation traversal between synchronous and Work exports. utf8LengthWork delegates to the existing frame byte counter, relocated into S04 and re-exported by S07; no duplicate byte algorithm. Both borrowed/owned Work loaders delegate generator validation cooperatively. Preserve the synchronous loader's private native-counting strategy: routing it through tiny byte steps caused the unchanged5000ms generator-boundary test to time out (8198 encoder calls for64KiB). The synchronous API alone selects that strategy; exported Work paths always select bounded generator traversal. This is not a native exception inside cooperative execution and does not duplicate predicates. Added18 behavior/2 architecture tests; final2301/26 covering PASS332.08s, build13.82s, tsc sole known baseline TS2339. S13/S15 AppState/project validation remains pending; no whole-G3c or independent acceptance claimed.

**Files:** S13/S14/S15; T06/T07/T08/T05/T02. Depends G3b. S08 consumes S14's new generator export instead of whole synchronous generator validation; allow this one-line import/delegation in S08 in this group.

**Interfaces:** S13 adds `validateAppNodeWork`, `validatePageTemplateWork`, `validateAppStateWork(state, mode: JsonMode = 'compat')`; same arguments/results as synchronous names, result wrapped in `Work`. S14 adds `validateGeneratorProvenanceWork(value, options?)` and `normalizeGeneratorProvenanceWork(value)` returning `Work<ReturnType<typeof correspondingSynchronousFunction>>`. S15 adds `validateMigratedStateWork`, `prepareProjectStateWork`, `validateWorkspaceProjectWork`, `validatePreparedWorkspaceProjectWork`, `validateCustomPresetWork`, `preparePendingImportWork` with existing parameter lists and `Work<existing result>`; old APIs drain synchronously. No second predicate implementation.

For normalization's discard-only historical validation add `checkMigratedStateWork(state: unknown): Work<void>`, `checkWorkspaceProjectWork(raw: unknown, options?: ProjectPreparationOptions): Work<void>`, `checkCustomPresetWork(raw: unknown, options: CustomPresetValidationOptions): Work<void>`, and `checkPendingImportWork(raw: unknown, options: ProjectPreparationOptions): Work<void>`. Reuse the same wrapper/schema/active-variant/AppState/warning predicates. Check paths validate raw wrapper JSON/descriptors without cloning its extensions, then create **one** native cloned working state and call loadOwnedProjectStateWork; post-validation uses the same rules without cloning again. Dispose working clone immediately after that row. Raw source is never mutated. Return-producing public APIs still make their promised independent copies. These check functions are not opaque validity receipts and are never exposed to progress.

- [ ] Add T06 RED:

```ts
it('cooperative project preparation retains schema-11 strict rejection and loader hydration', async () => {
  const raw: any = historicalState(11);
  delete raw.variants.default.templates.page.elements[0].textPadding;
  const h = makeWorkHarness();
  expect(await h.runtime.run(prepareProjectStateWork(raw, { warningPolicy: 'reject' })))
    .toEqual(prepareProjectState(raw, { warningPolicy: 'reject' }));
  raw.variants.default.templates.page.elements[0].textWrap = 'bad';
  await expect(h.runtime.run(prepareProjectStateWork(raw, { warningPolicy: 'reject' })))
    .rejects.toThrow('invalid before migration');
});
it('cooperative validation yields in a node children array and leaves input unchanged', async () => {
  const raw: any = historicalState(11); raw.nodes.root.children = Array(5000).fill('root');
  const before = structuredClone(raw); const h = makeWorkHarness();
  await h.runtime.run(validateMigratedStateWork(raw));
  expect(h.runtime.snapshot().yields).toBeGreaterThan(0); expect(raw).toEqual(before);
});
```

T07 add an async plain-mode test with 5000 elements to ensure work occurs inside `validatePageTemplateWork`, plus native public JSON.stringify compatibility tests for an otherwise valid state containing undefined extension, nonfinite extension, getter and `toJSON`: sync behavior remains original; normalization rejects unsupported JSON during its prior canonical check. T08 test exact 512 KiB and combined 1 MiB source limits, paired/lone-surrogate UTF-8 length, invalid timestamp and unknown-key strict/lenient modes through both drivers. Existing test fixtures in those files supply valid states/generator objects; add to those fixtures, not a new schema.

Concrete additions use T07's existing `goodState()` and T08's existing `source` constant:

```ts
// T07: import validateAppStateWork from shared/validateAppState.js and T16 helper.
it('steps through template elements under the shared validator', async () => {
  const state = goodState(); state.schemaVersion = 11;
  state.variants.default.templates.page.elements = Array.from({ length: 5000 }, () => ({ type: 'text' }));
  const h = makeWorkHarness();
  expect(await h.runtime.run(validateAppStateWork(state, 'plain'))).toEqual({ ok: true });
  expect(h.runtime.snapshot().yields).toBeGreaterThan(0);
  state.variants.default.templates.page.elements[4999].textWrap = 'invalid';
  expect(await h.runtime.run(validateAppStateWork(state, 'plain'))).toEqual(validateSharedAppState(state));
});
// T08: import Work variant and T16 helper; no fixture named `validMetadata` is needed.
it.each([
  ['x'.repeat(512 * 1024), 'y'.repeat(512 * 1024), true],
  ['x'.repeat(512 * 1024 + 1), '', false],
  ['☕'.repeat(174_762) + 'ab', 'y'.repeat(512 * 1024), true],
  ['☕'.repeat(174_763), '', false],
] as const)('cooperatively checks script bytes', async (templateScript, hierarchyScript, ok) => {
  const value = { ...source, templateScript, hierarchyScript }; const h = makeWorkHarness();
  const result = await h.runtime.run(validateGeneratorProvenanceWork(value, { strictUnknownFields: true }));
  expect(result.ok).toBe(ok); expect(result).toEqual(validateGeneratorProvenance(value, { strictUnknownFields: true }));
});
```

- [ ] RED/GREEN:

```bash
NO_COLOR=1 FORCE_COLOR=0 TMPDIR=/tmp/opencode node /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/node_modules/vitest/vitest.mjs run /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/validation.test.ts /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/server/validateAppState.test.js /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/generatorMetadata.test.ts /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/cooperativeLoader.test.ts --silent --reporter=dot
```

Expected RED: missing Work exports; old suites retain behavior. Implementation mapping:

```text
validateAppStateWork preserves exact current check order:
  state/nodes/root own-enumerable-data checks
  size: compat uses original native JSON.stringify+UTF8 behavior; plain uses plainJsonBytesWork
  generator -> shared validateGeneratorProvenanceWork(strictUnknownFields:true)
  node count -> each node -> child entries one at a time, same short-circuit errors
  variants nonempty/count -> each variant -> each template -> each element
  layers optional type/count rules exactly as before; schema>=10 overflow/wrap,
  schema>=11 four text padding sides; total element limit checked at original final point
  no new node-graph cycle/reference/layer-id policy

generator work preserves strict unknown-key check BEFORE version/script fields;
  source-byte counts via utf8LengthWork; same per-script, combined, timestamp checks;
  construct exact four-field value or unchanged issue/message; normalize returns warning verbatim.

S15 cloneJsonObjectWork:
  same plain-object predicate; run canonicalWork to discard emitter for safety/depth;
  wrap errors with existing label/message/cause; native structuredClone; return clone.
prepareProjectStateWork:
  same warning-policy check -> clone source -> same schema bounds
  if schema>=10: validateAppStateWork(source,'plain'), activeVariant check
  delegate loadProjectStateWork(native structuredClone(source),'plain')
  reject warnings if requested -> validateMigratedStateWork(loaded.state) -> copy warnings
validateMigratedStateWork:
  cloneJsonObjectWork -> current schema -> AppStateWork('plain') -> active variant -> canonicalWork
wrapper/preset/import work:
  move existing exact checks and error order; step arbitrary own-key/warnings/uniqueness loops;
  delegate preparation, never suppress a loader warning or reuse a caller-supplied validation flag.
```

Add T06 ownership regression using a schema-6 state with two template keys pointing to the same template object and a rect with `strokeWidth:'Infinity'`, `stroke:'#000'`: run public validation and checkWorkspaceProjectWork under identical reset Math.random streams; assert identical acceptance/rejection and random-call sequence, unchanged raw input, and released working-state ownership. This pins alias duplication and JSON nonfinite conversion at old version boundaries. For schema 11, assert owned checking still hydrates on its private clone while raw source's missing padding stays absent. Do not merely lower reported memory counters while keeping all old loader clones alive.

Public S13 record validators remain callable independently with old permissive shapes; moving their loops into generators does not add canonical validation to those public entry points. S15 always establishes strict JSON safety. Broad native operations on normalization's data are limited to clones/enumeration/scalar primitives, not unchanged validators.

- [ ] GREEN command and historical T04. T02 edges S13/S14/S15/S08→S02/S04 as used; shared JS modules have only JS runtime imports. No Node crypto/browser-storage dependency is introduced into shared code.

### Group 3d — historical preparation and raw-record validation

Initial-copy checkpoint: S16 optional WorkRuntime now drives shared validation, per-present-key native parse, sequential exact frame/key hashes, collision search and record construction. Invocation capture stays before first await, guarded/accounted as the existing native legacy-envelope clone. Parsed/migrated payload ownership spans hash waits and releases at return/error/cancellation; not measured heap or caller-lifetime accounting. Added30 initial-copy tests and1 lineage late-await regression; both public preparation functions now recheck lifecycle after their final await. RED19 ignored-work cases, RED hash ownership and RED2 final-await races followed by2415/26 covering PASS345.86s, build12.28s and baseline-only TS2339. All G3d traversal paths are implemented/controller-verified; earlier partial checkpoints below remain chronological evidence, not current pending-work statements. Independent/cumulative review and complete prerequisite ownership integration remain unclaimed. Next G3e.

Lineage checkpoint: S17 optional WorkRuntime now drives row-wise capture, placeholder reconstruction, both exact source-frame hashes, raw-order incarnation allocation and ledger/result construction. Existing no-work two-SubtleCrypto-check contract retained. Loaded snapshot ownership spans each hash wait; first loaded snapshot is released before independent final reconstruction. Full prerequisite raw-capture/replacement/returned-result lifetime accounting remains part of G3e/G6 integration, not a heap claim from these snapshot counters. Added10 behavior/2 architecture tests; extended4 malformed-row tests. RED6 ignored-work cases and RED hash-wait ownership, then2384/26 covering PASS325.45s; build10.79s. Final type-only literal correction followed by18 lineage tests PASS5.96s, tsc baseline-only TS2339. Initial-copy Work preparation below remains pending; no independent/cumulative acceptance claimed.

Raw-record checkpoint: S16 retaining/discard-only Work exports now share record rules with synchronous reconstruction. Discard-only paths use S15 void checks, retaining only IDs/position metadata between loaded payloads; native workspace-order/provenance metadata clone boundaries remain for compatibility. Retaining output serialized bytes are accounted during reconstruction, with finally release on completion/error/cancellation; caller-owned returned-snapshot lifetime still belongs to later prerequisite integration, not this counter scope. Added16 behavior/2 architecture tests and extended15 corruption cases through both Work paths. RED18 missing exports, RED3 ownership/sparse regressions, architecture RED1, then2372/26 covering PASS347.78s; build11.49s. Test-only generic inference correction followed by68 migration tests PASS10.10s and baseline-only TS2339. This is a partial G3d checkpoint: initial-copy and lineage cooperative preparation below remain pending. No independent/cumulative acceptance or heap proof claimed.

**Files:** S16/S17/S06, T09/T10/T02. Depends G3c. S16 `MigrationPreparationEnvironment` and S17 `LineageRepairPreparationEnvironment` gain optional `work?: WorkRuntime` (type-only import). Existing return types and callers remain valid.

**Interfaces:** add `reconstructWorkspaceRecordsWork(records: WorkspaceRecordCandidates): Work<ReconstructedWorkspaceRecords>` and `validateWorkspaceRecordsWork(records: WorkspaceRecordCandidates): Work<WorkspaceRecords>`. Both delegate the same private record-validation generator with a `retainSnapshot` flag; the latter discards one loaded project/preset/import at a time after validating it, retaining only IDs/order metadata. Existing `reconstructWorkspaceRecords` is the synchronous retaining wrapper. No `WorkspaceSnapshot` hydration retained by normalization merely to throw it away.

For `retainSnapshot=false`, use S15's discard-only check programs, not returning validation wrappers that keep multiple cloned states. For `retainSnapshot=true`, keep required loaded output ownership and report it as such. Prerequisite preparation/repair may necessarily own returned historical records/snapshots; count that phase separately, release unused prepared/admitted results before starting normalized capture, and never report its highwater as the main-path one-capture budget.

S06 existing `digestLegacySnapshot`, `digestWorkspaceContent`, `sha256Hex` gain trailing optional work parameter, retaining current first parameters/subtle defaults. Work-aware branch uses exact shared frame traversal and incremental SHA; default branch keeps existing crypto injection. S06 may import S01 directly (pure leaf) to avoid S06→S07→S06 cycles. Frame grammar remains defined in its current owner; export work-frame builders `legacySnapshotFrame(snapshot): Frame` and `workspaceContentFrame(snapshot): Frame` from S06 for S07/repository use. No duplicate envelope rules.

- [x] Add T09/T10 REDs:

```ts
it('prepares the same historical copy under cooperative work', async () => {
  const source = legacySnapshot(validLegacyValues());
  const expected = await prepareInitialCopy(source, deterministicEnvironment({ crypto: webcrypto as unknown as Crypto }));
  const h = makeWorkHarness('prerequisite');
  const observed = await prepareInitialCopy(source,
    { ...deterministicEnvironment({ crypto: webcrypto as unknown as Crypto }), work: h.runtime });
  expect(observed).toEqual(expected);
  expect(h.runtime.snapshot().visits).toBeGreaterThan(0);
  const records = { projects: observed.projects, workspace: observed.workspace,
    presets: observed.presets, pendingImports: observed.pendingImports };
  expect(await h.runtime.run(validateWorkspaceRecordsWork(records))).toEqual(records);
});
```

Pin source content digest and raw returned project order from existing tests rather than only changed-sync-vs-changed-async comparison. T10's actual fixture is `candidate()` at lines 22–40; add:

```ts
it('cooperative lineage preparation preserves both checks and exact original rows', async () => {
  const fixture = await candidate(); const before = structuredClone(fixture.records);
  const expected = await prepareLineageRepair(fixture.ledger, fixture.records, {
    crypto: webcrypto as unknown as Crypto, randomUUID: () => 'repair-incarnation-a',
  });
  const h = makeWorkHarness('prerequisite'); const randomUUID = vi.fn(() => 'repair-incarnation-a');
  const observed = await prepareLineageRepair(fixture.ledger, fixture.records, {
    crypto: webcrypto as unknown as Crypto, randomUUID, work: h.runtime,
  });
  expect(observed).toEqual(expected); expect(fixture.records).toEqual(before);
  expect(randomUUID).toHaveBeenCalledTimes(1);
  expect(observed.ledger.ledgerRevision).toBe(fixture.ledger.ledgerRevision + 1);
  expect(h.runtime.snapshot().sourceHashBytes).toBeGreaterThan(0);
});
```

Retain its existing two-digest SubtleCrypto-spy assertion on the no-work path; the work path independently computes both required checks, counted under source frames. Add cancellation with 1000 projects using `makeIncrementalProject(1)` and unique IDs in legacy JSON; schedule abort before `prepareInitialCopy` completes (this helper is pure preparation).

- [ ] RED/GREEN:

```bash
NO_COLOR=1 FORCE_COLOR=0 TMPDIR=/tmp/opencode node /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/node_modules/vitest/vitest.mjs run /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/migrationPreparation.test.ts /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/lineageRepair.test.ts /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/canonical.test.ts --silent --reporter=dot
```

Expected RED: missing validation Work export or `work` ignored (zero visits). Implement:

```text
prepareInitialCopy remains async; choose run = env.work ? env.work.run : async p=>runSync(p)
  capture source before first await; native JSON.parse per present legacy key, guarded/accounted
  project/preset/import loops execute sequential shared S15 programs, exact uniqueness/order rules
  fingerprints computed sequentially, same project/sourceIndex/key domains, no Promise.all payload frames;
    work-aware item hash = digestFrame(emit=>canonicalWork(item,emit),work,'source'),
    NOT sha256Hex(canonicalStringify(item),subtle,work); raw key fingerprints use stepped raw-text SHA
  source/target digests use cooperative S06 branches if work supplied
  fresh default factory invoked once, guards around it; then shared validation of its returned graph
  retain original UUID/now call order, record construction, backup snapshot and ledger fields

workspace record generator moves ALL checks at S16:455–659 unchanged:
  exact envelopes, provenance dependencies/digests, duplicate consumed IDs, timestamps/counters,
  validateMigratedState then strict wrapper preparation, stored/payload id equality
  workspace projectOrder uniqueness/exact membership/active id
  preset/import position uniqueness and stable numeric sorting, stored warnings retention
  retainSnapshot=false: loaded payload discarded after that row; raw records returned unchanged
  retainSnapshot=true: assemble same loaded snapshot in workspace/position order

prepareLineageRepair:
  step expected/raw project capture, validation placeholders and replacement list construction
  reconstruct through shared retaining program; hash validation snapshot; check old expected digest
  allocate missing incarnations in original projects array order only; reconstruct upgraded snapshot
  hash/check again; preserve expected originals, next ledger and returned snapshot exactly
  runtime guards before/after each await; no UUID allocated after observed cancellation
```

The injected blank-project provider is called as an environment boundary, not misreported as a native validator. Production default is the fixed `blankPresetData` (one node, one empty template), not input-sized preset loading; guard before/after factory and account returned graph through the shared validation. Do not broaden this into an exception for workspace traversal or enumerate arbitrary custom presets synchronously.

- [x] GREEN command. T02 exact S16/S17→S02/S04 and S06→S01/S02/S04. Preserve old historical digest injection tests when work is absent.

### Group 3e — stable captures and historical prerequisite lifecycle

Inspection-classification checkpoint: S19 classifyHistoricalInspectionWork now owns the shared empty/orphan/cardinality/current/v1/unrecognized traversal; synchronous classifier drains it. Reuses existing stepped predicates and preserves ledger identity/states without storage/hash work. Added14 tests, RED14 then GREEN; full2657/27 PASS337.17s, build16.29s, baseline-only TS2339, boundary unchanged. Main bootstrap Work propagation remains pending along with stable-copy/retained-source helpers and complete byte/lifetime accounting. No whole-G3e/native/independent acceptance.

Copy-verification checkpoint: To satisfy G3e's requirement that every bootstrap digest/check receives the same runtime, S16 verifyPreparedCopy now accepts optional fifth WorkRuntime after SubtleCrypto. Both hashes and shared expectation traversal use it; defaults preserve native crypto/comparison behavior, all mismatch predicates, sparse left-order semantics and snapshot identity. Post-hash/final-await guards preserve cancellation. Added17 tests, initial RED15 then GREEN; long-ID tests distinguish post-hash comparison from canonical sorting. Full2643/27 PASS316.59s; build14.98s; baseline-only TS2339; boundary unchanged. S19 caller propagation, main state machine, stable-copy/retained-source integration and complete byte/lifetime accounting remain pending. No whole-G3e/native/independent acceptance.

Drift-helper checkpoint: S19 readRecognizedLedger/recordLegacyDrift optional invocation Work overrides now cover guarded reads, cooperative predicates/comparisons, marker providers, CAS and retry capture. No-work provider order/marker identity and three-attempt/conflict-only policy retained; lifecycle abort escapes read wrapping and retries. Added17 tests, RED11 then GREEN; full2626/27 PASS340.13s, build15.77s, baseline-only TS2339, boundary unchanged. Main bootstrap state machine, retained-legacy/stable-copy integration and prerequisite byte/lifetime accounting remain pending. No whole-G3e/native/independent acceptance claimed.

Cursor-collection checkpoint: S20 inspect/readWorkspaceRecords optional Work path uses one coherent readonly transaction, cursor events per row and sequential store transitions. Preserves native key order, all-workspace inspection versus current-only workspace records, empty/missing values, raw metadata and archive rejection. Guard/failure abort settles before returning lifecycle errors; no partial collection, task yield/hash/observer or input-sized array pass inside transaction. S19 verification reader forwards Work to collection reads. Added17 tests and extended2 forwarding tests, RED17/RED2 then2609/27 covering PASS339.93s; build15.82s; baseline-only TS2339; boundary unchanged. Only row/request/EOF accounting is implemented here. Planned post-transaction byte measurement, capture ownership and bootstrap-wide integration remain incomplete; no independent/cumulative/native acceptance.

Single-row checkpoint: S20 readMigrationLedger/readLegacyBackup optional Work guards acquisition, request and completion, aborts/settles readonly transactions before lifecycle failure and counts native requests/metadata rows. Raw values (including unclassified non-JSON extensions), no-work error behavior and archive rejection preserved. S19 readVerificationInputs forwards Work for both original/accepted backup captures, retaining shared-capture optimization. Added19 tests: RED15 read behavior, RED2 nested forwarding, then2592/27 covering PASS340.43s; build16.37s; baseline-only TS2339. Boundary unchanged. Remaining: cursor collection, full prerequisite byte/lifetime accounting and bootstrap-wide forwarding; byte measurement must not introduce new raw-read admission rules. No independent/cumulative/native acceptance claimed.

Lineage transaction checkpoint: S20 optional Work path cooperatively indexes expected rows before acquisition, retains ledger CAS/reservation prefix, cursor-compares each actual project once and issues replacement puts sequentially before ledger. Native string key equality and full-record canonical depth semantics preserved; duplicate/missing/extra memberships rejected. Fault/callback cancellation aborts and settles before lifecycle failure escapes; durable notification only after tx.done. Added22 behavior/7 exact capability cases, RED11 then GREEN22; boundary RED1 before exact helper/cleanup signature update. Full2573/27 PASS355.74s; build16.02s; baseline-only TS2339. Remaining G3e: Work-aware cursor/single-row reads and bootstrap integration. Source-byte/index/heap accounting and independent/cumulative/native acceptance remain pending.

Marker transaction checkpoint: S20 markVerified/markLegacyDrift now accept optional WorkRuntime, guard request/completion boundaries and preserve lifecycle failure after abort/drain. Same predicates, row spreads, fault point and normalization reservation prefix. Count metadata/CAS rows, per-record transaction work and write attempts; matching drift remains read-only/idempotent. Durable progress occurs only after tx.done. Added22 behavior tests and9 exact storage-boundary regressions; RED13 missing runtime behavior, boundary RED1 cleanup signature, then2544/27 covering PASS338.93s and build16.85s, baseline-only TS2339. Remaining G3e: guarded lineage repair, cursor-based reads and bootstrap-wide forwarding/cancellation integration. Full prerequisite byte/lifetime accounting and native/independent acceptance remain pending.

Initial-copy transaction checkpoint: S20 writeInitialCopy optional Work path uses sequential native request callbacks with per-request/fault guards, synchronous abort on callback failure and lifecycle preservation after transaction settlement. Shared fixed store/fault ordering keeps no-work behavior. Durable notification occurs only after tx.done; pre-commit cancellation rolls back, post-commit cancellation retains a complete copied phase for independent reopening. Added20 behavior/5 storage-boundary tests. Structural guard helper/acquisition prefix remain unchanged; existing checker only recognizes exact updated enqueue/abort Work call signatures. Final2513/27 covering PASS355.83s, build11.80s, baseline-only TS2339. Remaining G3e: guarded lineage/verification/drift adapter writes, cursor-based reads and bootstrap-wide forwarding/cancellation integration. No native quota/performance or independent/cumulative acceptance claimed.

Ledger/backup checkpoint: S19 current/v1 ledger Work predicates and synchronous type guards share one rule traversal, preserving sparse fingerprint semantics and historical identifier rules. Backup header/reference checks are shared; Work path hashes one exact legacy frame, no-work path retains crypto injection/native equality. readVerificationInputs now guards runtime-aware waits and uses a captured-object Map local to that pass; each reference is rechecked and later passes rehash reused objects. Added46 behavior tests, RED29 APIs/RED4 integration cases followed by2488/27 covering PASS342.26s; build11.91s, baseline-only TS2339. Existing boundary test RED then exact S19 imports only. This remains partial G3e: bootstrap-wide Work forwarding/classification/cancellation catches and adapter cursor/transaction internals below are not yet integrated. No independent/cumulative acceptance or full prerequisite lifecycle/heap claim.

Stable-capture checkpoint: S18 Work/expected options and S19 capture forwarding/currentGeneration() are implemented. Source/current comparison precedes a reserved64-visit final read/comparison tail; exact raw/presence/digest/generation checks occur there, with no later successful CPU-work await. Actual reads/three with-digest hashes/retries and raw UTF-8 weights are counted; changed afterHash weights are measured only on failure/retry. Returned observed generation is sampled in the tail, not after await. Per-attempt raw-image ownership is logical, not heap or caller-lifetime proof. Added18 behavior/4 architecture tests; RED13 then GREEN, architecture RED1 then exact S18 imports. Covering command now also includes existing legacy.test.ts:2442/27 PASS345.47s, build11.09s, baseline-only TS2339. This is partial G3e: ledger/backup rule extraction, bootstrap-wide forwarding/lifecycle and adapter transaction work below remain pending. No independent/cumulative acceptance claimed.

**Files:** S18/S19/S20; T11/T14/T02. Depends G3d. This completes accounting through normalization-reached prerequisites, not just repository work.

**Interfaces:** `StableLegacyCaptureOptions.work?: WorkRuntime` and `expected?: {snapshot: LegacySnapshot; digest: string; generation: number}`; `HistoricalBootstrapEnvironment.work?: WorkRuntime`; `captureObservedLegacy(assertCurrent?: () => void, work?: WorkRuntime, expected?: ObservedLegacyCapture): Promise<ObservedLegacyCapture>` and existing bootstrap return type with options `{allowCopiedReplacement?: boolean; work?: WorkRuntime}`. S19 forwards expected to stable capture so the final discovery comparison occurs in its guarded native tail, not a later task. Its returned private helper adds `currentGeneration(): number`, delegating only to existing environment.generation (no storage read/hash). Add optional trailing `work?: WorkRuntime` to S20's normalization-reached methods listed in manifest; default callers unchanged. Existing prerequisite transaction helper and ledger-absence guard stay semantically identical.

S19 adds `isRecognizedLedgerWork(value): Work<boolean>` sharing the exact current predicates with sync `isRecognizedLedger`; similarly historical-v1 classification uses shared stepped ledger rules. Backup validation adds optional work and splits into `validateHistoricalBackup` (one actual snapshot hash) plus local constant/reference checks. A per-pass Map keyed by captured row object validates each backup once; every original/accepted reference still checks its required id/digest/kind/time.

- [ ] Add T14 test using existing `createNormalizationHarness` and new work harness:

```ts
it('accounts stable legacy capture reads and all three hashes without per-batch capture', async () => {
  const h = await createNormalizationHarness(); const w = makeWorkHarness('legacy-fence');
  const get = vi.spyOn(h.legacyStorage, 'getItem');
  const capture = await h.historical.captureObservedLegacy(undefined, w.runtime);
  expect(capture.digest).toBe(h.prepared.sourceDigest);
  expect(get).toHaveBeenCalledTimes(12); // Four keys, three underlying reads.
  expect(w.runtime.snapshot().legacyCaptures).toBe(1);
  expect(w.runtime.snapshot().legacyReads).toBe(12);
  expect(w.runtime.snapshot().legacyHashBytes).toBeGreaterThan(0);
});
```

T11 add runtime to its existing copied/v1/verified bootstrap setup; schedule cancellation through an observer on a real yield during preparation and assert no attempt/normalized archive. For adapter transactional cancellation add concrete T14 race: after the first `lineage-repair.after-project-write` or `copy.after-projects` fault callback sets an AbortController, the next guarded request aborts the same transaction; independent read sees all old or all new historical phase, never partial replacement. Keep existing fault callbacks at original logical points; `copy.after-projects` still means all project writes have been issued/completed, not first project.

Self-contained T11 cancellation fixture (uses its existing IDBFactory, TEST_NOW, currentState, memoryStorage, LEGACY_KEYS imports; add createHistoricalBootstrap and T16 imports):

```ts
it('cooperative prerequisite cancellation never starts copying', async () => {
  const indexedDB = new IDBFactory();
  const adapter = createIndexedDbAdapter({ indexedDB, now: () => TEST_NOW }, 3);
  const projects = Array.from({ length: 1000 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, initialState: currentState() }));
  const legacyStorage = memoryStorage({ [LEGACY_KEYS.projects]: JSON.stringify(projects), [LEGACY_KEYS.activeProject]: 'p0' });
  let id = 0;
  const historical = createHistoricalBootstrap({ adapter: () => adapter, legacyStorage, generation: () => 0,
    crypto: webcrypto as unknown as Crypto, now: () => TEST_NOW, randomUUID: () => `id-${++id}`, createBlankProject: currentState });
  const h = makeWorkHarness('prerequisite');
  try {
    await adapter.open(); setTimeout(h.cancel, 0);
    await expect(historical.bootstrap(() => {}, { allowCopiedReplacement: false, work: h.runtime }))
      .rejects.toMatchObject({ name: 'AbortError' });
    const rows = await adapter.inspect();
    expect(rows.projects).toEqual([]); expect(rows.migrationLedger).toEqual([]); expect(rows.legacyBackup).toEqual([]);
    expect(h.runtime.snapshot().writes).toBe(0);
  } finally { adapter.close(); }
});
```

In S16/S17/S19 asynchronous catch blocks, if work.stopped() then call work.assertCurrent() before wrapping/classifying the caught error, so a lifecycle abort cannot become a plan to repair or be hidden inside WorkspaceMigrationError. Abort/settle an already opened adapter transaction first, then preserve that lifecycle failure. No-work error policy remains unchanged.

- [ ] RED/GREEN:

```bash
NO_COLOR=1 FORCE_COLOR=0 TMPDIR=/tmp/opencode node /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/node_modules/vitest/vitest.mjs run /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/bootstrap.test.ts /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/lineageRepair.test.ts /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/drift.test.ts /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/normalized/migration.test.ts --silent --reporter=dot
```

Expected RED: work counters absent/ignored or cancellation queues later writes. Replacement:

```text
legacy stable capture: keep source/current/afterHash reads and generation retry rule;
  each four-key capture performs its fixed four getItems without a task yield between keys;
  guard native reads; measure source/current raw UTF8 bytes cooperatively after capture;
  hash all three old required frames through S06 work branch;
  cooperatively compare immutable source/current snapshots BEFORE the final afterHash read;
  reserve one fixed 64-visit effect BEFORE the final native tail (yield first if budget needs it);
  inside that effect: final four-key afterHash capture + exact native equality to current and,
    when expected supplied, exact raw/presence/digest/generation equality to discovery;
  count/guard each native get/string comparison separately; no observer/task within this fixed tail;
  NO later CPU-work await on a successful stable result;
  last-read byte weights reuse independently measured current bytes only on exact equality;
    on mismatch measure changed strings on the failure/retry path, never publish readiness;
  sample generation at final comparison; count retries; preserve LegacyCaptureError behavior.
bootstrap: keep existing state machine/repair/recovery decisions;
  options.work overrides env.work for this invocation only, never mutate shared environment;
  delegate every shared validation/preparation/digest/capture using the same runtime;
  guard emit callback and every adapter await, check again before every planned write;
  lifecycle abort escapes broad migration/verification catches, not converted into a plan to repair;
  normalization keeps allowCopiedReplacement:false; no destructive replacement path is introduced.
  preserve the exact awaited `await adapter.open()` form for existing capability policy;
  place guards immediately around it rather than hiding opener acquisition in a new callback.

adapter inspect/readWorkspaceRecords under work:
  coherent readonly transaction; cursor one row per IDB event, record-level guards/counters;
  preserve archive rejection and old result shape; no full array .map/.sort in callback;
  after transaction, cooperatively byte-count captured rows; classify prerequisite counters separately.
enqueuePreparedCopy under work:
  keep single existing prerequisite transaction; issue next add ONLY in prior request success;
  assertCurrent immediately before each request and after each callback/fault;
  preserve store order projects/workspace/presets/imports/backup/ledger and all original fault points;
  never await task yield/hash inside transaction; completion publishes progress only after tx.done.
repairHistoricalLineage under work:
  prepare expected id->row index cooperatively before transaction;
  same ledger CAS and empty-normalization guard; cursor actual projects once in key order;
  compare String(primaryKey) membership as old actualKeys.map(String), AND require native key equality
    with expected string id (preserves old subsequent get(expected.id), which rejects number-vs-string keys);
  compare whole-record canonical equality exactly as the old repair, not normalized per-field-depth framing;
  reject duplicate/missing/extra memberships; synchronous one-record comparison exception only;
  after EOF, issue replacements sequentially via IDB callbacks, then ledger, with original faults.
markVerified/markLegacyDrift under work:
  same existing ledger predicates/fields; guard before request/write and after completion;
  copied marker's wide spread is per-record transaction work, explicitly counted, not a global loop.
```

No normalized payload writer moves to adapter. Its default no-work path may retain existing IDB helper arrangement; **normalization always supplies work**. There is one historical admission policy, with only request scheduling/observation differing. Source-record comparison in repair is the same already-approved per-record exception; key-set sort/join is removed, not mislabeled primitive. Prerequisite read/pass costs are separately reported and included in global totals, not subtracted from evidence.

The final raw string equalities are genuine indivisible engine primitives over a fixed four-key set, explicitly guarded/counted; they are not a “whole capture” exception. Hashing/escaping and earlier comparisons remain cooperative. Moving an asynchronous comparison **after** the last native read would add an unfenced task window and is forbidden. The optional expected/discovery comparison is fused into that tail; normalizer does not run another Work program afterward. No new full capture/hash is hidden in the tail. Without work/expected, existing standalone stable-capture ordering and policy remain unchanged.

Concrete IDB API mapping: S20 currently uses `idb`'s IDBPTransaction/Promise-returning stores, unlike S25's native IDB requests. Import installed `idb`'s named `unwrap` alongside existing `openDB` to get native transactions for these work-aware cursor/request chains; do not assign `.onsuccess` to an IDBP Promise. Keep the original wrapped transaction for `.done`/error mapping. Work-aware enqueue returns a promise settled by the same native transaction's complete/abort events and records its first guard/fault failure before abort; no new transaction is opened. T02 allows only this named unwrap of the already-owned prerequisite/read transaction, never an arbitrary factory or second normalized writer.

Work-aware repair compares one row with `runSync(equalFrameWork(emit=>canonicalWork(current,emit), emit=>canonicalWork(expected.record,emit)))`, under its synchronous one-record comparison guard. This preserves old whole-record depth semantics without constructing two full record strings. Import these generic pure functions from S02/S04, not S07; adapter's normalized-module import restriction at T02's `inspectModuleSpecifier` stays intact.

Repair row accounting reuses this already-required comparison stream: count UTF-8 bytes of the observed/current frame fragments, not the expected operand. This follows the approved preference for exact existing representations over a new memory profiler. Successful comparisons contribute complete canonical-row byte weights to candidateBytes; failed/throwing comparisons contribute only consumed prefix bytes and flag unmeasuredValues. These weights describe the existing serialized comparison, not raw graph ownership or heap size. No second record traversal or additional retained workspace capture solely for accounting. No Work task yield/hash/progress observer inside the transaction; the existing one-record comparison exception remains the only synchronous record-sized operation. G6 must distinguish these canonical-row weights from general raw logical weights when validating its oracle.

- [x] GREEN command plus full boundary. T02 preserves adapter `prerequisiteTransaction`/`requireUnreservedNormalization` mutation-negative probes. Only exact pure imports and guarded cleanup/helper-call shapes were updated. Broader2964/32 regression passes at the lifecycle/accounting milestone; no broad adapter transaction rule or formal independent group acceptance.

G3e bootstrap runtime checkpoint (controller-verified, not whole-group acceptance):
- Invocation runtime forwarded through existing bootstrap state machine and prerequisite helpers; environment unchanged. Guarded phases/awaits/writes, lifecycle escape and final guard cleanup covered.
- Four-key native copied-source reads reuse per-key guards; final source comparison stays within its reserved native tail. Existing no-work behavior and non-replacement normalization policy retained.
- Added14 bootstrap tests, including two RED-to-GREEN per-read cancellation cases. Exact opener boundary shape updated for guarded bootstrap; existing mutation-negative opener probes retained, no scheduler analyzer.
- Covering2671 tests/27 files PASS339.80s; build `task-11b-g3e-bootstrap-build-01` PASS11.83s/2467 modules. Typecheck remains blocked only by known Sticker Press TS2339 at793:36. Audit35 authorized paths,73/81 prior dirty blobs retained; HEAD/index/protected receipts intact.
- Still pending: prerequisite posttransaction byte measurement, complete raw/caller-lifetime ownership, cumulative accounting/budget validation and independent acceptance. Do not mark G3e complete or advance production wiring on this checkpoint alone.

#### Approved pragmatic accounting clarification

Exact RAM/disk precision is not required. Existing JSON/frame/hash/legacy-string byte counters stay exact and unchanged. Raw IndexedDB values use a separate deterministic logical weight, never a serialization or admission check:
- Eight logical bytes per value/reference occurrence; string contents and enumerable string keys add their UTF-8 length. Object contents are visited once per row, including cycles/shared references.
- Map keys/values and Set values are traversed; Date uses its scalar weight. ArrayBuffer adds byteLength; views visit their backing buffer once; Blob adds size without reading its contents. Arrays visit present enumerable properties, not an input-length hole scan.
- BigInt, other opaque values and accessors retain their base weight and increment a numeric `unmeasuredValues` counter. Do not stringify huge integers, invoke getters/toJSON, or silently present incomplete weights as complete memory measurements. Unknown objects' enumerable data properties are still traversed.
- Measure after transaction completion; no yields/hash/observer inside a transaction. Attribute row weights to candidateBytes/metadataBytes; these are logical raw weights, distinct from exact frameBytes/hashBytes. No-work reads remain unchanged. Real browser tests remain the memory/responsiveness gate.
- This slice adds shared bounded traversal, compatibility/cancellation tests and posttransaction collection/point-read accounting. Full caller-lifetime ownership transfer remains a following integration step; temporary counter release must not be reported as full graph-lifetime proof.

Raw-weight slice implemented/controller-verified:16 new tests (helper RED8/GREEN8; adapter RED8/GREEN8), covering2687/27 PASS345.25s. Build `task-11b-g3e-raw-weights-build-01` PASS11.92s/2467 modules; typecheck sole known Sticker Press TS2339. Existing boundary unchanged and passing. Four old no-yield assertions now permit posttransaction measurement; new tests assert transaction completion before observer invocation and cancellation propagation. Added unmeasuredValues to metric initialization contract. Remaining G3e work includes full caller-lifetime ownership and repair/index/transaction metadata accounting; logical weights do not close native memory/performance gates or whole-task acceptance.

Repair-index lifetime checkpoint: S20 now reserves16 logical reference-slot bytes plus UTF-8 key bytes per expected project, without claiming borrowed payload ownership. Reservation spans acquisition, transaction settlement and durable notification; all exits drop the owned index slot and release the lease. Abort is awaited before finally cleanup. Added2 tests, strengthened4 cancellation cases and added1 exact unawaited-abort boundary rejection; initial RED6 then lineage24/Group A117 PASS. Full2690/27 PASS355.40s; build `task-11b-g3e-repair-index-build-01` PASS12.34s/2467 modules; typecheck sole known Sticker Press TS2339. Caller-held graph lifetimes and transaction metadata weights still pending. No whole-G3e acceptance or heap proof.

Marker-read weight checkpoint: successful markVerified/markLegacyDrift and idempotent matching drift now measure the captured ledger after tx.done, preserving opaque extensions and final-await cancellation. Added4 tests RED4 and strengthened idempotent case RED1; marker26 PASS. Full2694/27 PASS359.65s; build `task-11b-g3e-marker-read-weights-build-01` PASS12.00s/2467 modules; baseline-only Sticker Press TS2339. Existing boundary unchanged. Still pending: failed/conflicting transaction read weights, copy/repair transaction reads, marker-operation weights and complete caller graph lifetimes. Cancelled runs have partial counters. G6's older JSON-byte oracle must be reconciled with approved prerequisite logical weights before cumulative totals are accepted; neither mixed-unit sums nor heap precision are claimed here.

Copy/repair ledger-read checkpoint: successful lineage repair and no-write initial-copy outcomes now measure captured ledgers after completion; absent ledger stays zero and malformed opaque ledger retains its original orphan outcome. Index reservation persists through measurement/cancellation cleanup. Added7 cases (initial RED4 and absent control, then cancellation coverage); focused142 prerequisite tests PASS, covering2701/27 PASS350.04s, build `task-11b-g3e-copy-repair-read-weights-build-01` PASS11.84s/2467 modules, baseline-only Sticker Press TS2339. Observer assertions now run outside callbacks where necessary because observer exceptions are intentionally isolated. Existing boundary unchanged. Repair project-row weights, failed/conflicting transaction accounting, marker-operation weights, caller graph lifetimes and phase-aware G6 oracle remain pending.

Repair comparison-weight checkpoint: current project canonical-frame fragments now provide candidateBytes during the existing one-record comparison; full weights only on equal rows, consumed-prefix weights plus unmeasuredValues on failed/throwing comparisons. No extra read/hash/record traversal or retained graph. Added3 tests RED3 then lineage29 PASS; full2704/27 PASS352.78s, build `task-11b-g3e-repair-row-weights-build-01` PASS12.15s/2467 modules, baseline-only Sticker Press TS2339. Boundary unchanged. Caller graph lifetimes, other failed/conflicting transactions, marker-operation weights and phase/representation-aware G6 oracle remain pending; no whole-group acceptance.

#### Larger prerequisite lifecycle/accounting batch

User requested milestone-sized batches: focused tests while developing; full covering regression/build at the milestone, not after each counter edit.

- One transaction-accounting scope covers all four prerequisite writers. Capture at most two ledger-image references, count read/validation and attempted copy/write operations separately, measure only after commit or abort settles, and dispose references/reservations on every exit. Conflict/quota failures retain their original outcome unless lifecycle cancellation intervenes; cancelled measurements flag incomplete values rather than launching uninterruptible scans.
- markerWorkBytes counts the ledger validation/comparison operand plus actual attempted ledger writes; marker update shallow-copy plus put counts twice for the new image. It is not added to the physical-read sum. Reservations are conservative per-image logical weights, not deduplicated heap sizes; shared nested data may overlap between images.
- `retainRawValue` provides a measured, explicitly releasable borrowed image with no clone. Getter access after release fails; release drops its reference slot and remains legal after cancellation/disposal. Measurement is single-flight and stops if its owner is released during a yield.
- Work-aware verification-input and admitted-result facades carry non-enumerable release methods. Bootstrap keeps prerequisite images through their invocation lifetime, releases temporaries on every exit, and transfers only the admitted result to its caller. Output measurement occurs before the final legacy fence, never after it. No-work result shape remains unchanged.
- Necessary consumer edits are limited to `services/localWorkspace/LocalWorkspaceStore.ts` and `services/localWorkspace/normalized/migration.ts`: finally-release after installation, or before the normalizer's independent capture, including a lifecycle failure at handoff. This is cleanup integration, not production normalized-storage activation or G6 session wiring. Both files are added to the explicit audit allowlist; immutable baseline is not recaptured.
- Complete startup-session budgets, representation-aware byte oracle and native memory/performance gates remain later acceptance work. Logical reservation totals are not exact heap measurements.

Batch implemented and controller-verified:22 new tests; broader local-workspace regression2964/32 PASS356.84s, build `task-11b-g3e-lifecycle-batch-build-01` PASS11.85s/2467 modules, baseline-only Sticker Press TS2339. Capture/result release, validation failure, cancellation at handoff, and non-accumulating repair retries are covered. A review-found diagnostic-failure precedence bug was reproduced RED4 and fixed: retain original conflict/quota if post-abort measurement fails without lifecycle cancellation; do not retry failed measurement. All affected writer catches await abort before finally cleanup. Review follow-up found no related defect, but effort metadata was unavailable and no formal independent group acceptance is claimed. One new retry test timed out under full parallel load; its fixture now contains only the project needed for the ownership assertion, with timeouts unchanged. Next planned implementation batch: G4a, followed by codec/session integration. Cumulative/native gates remain blocking production wiring.

### Group 4a — partition, raw assembly and size arithmetic

**Files:** S21/S22; T15/T12/T02. Depends G3e. Preserve `hydrateState`, `resolvePreferences`, `projectActiveTemplate` and all ordinary editor ownership semantics.

**Interfaces:** `partitionStateWork(state: AppState): Work<PartitionedState>`, `assembleStateWork(parts: PartitionedState): Work<AppState>`, `createSizeLedgerWork(project: NormalizedProject): Work<SizeLedger>`, `applySizeChangesWork(ledger: SizeLedger, before: NormalizedProjectSlice, after: NormalizedProjectSlice): Work<SizeLedger>`. Existing sync exports drain these programs. Consume `jsonTextWork` for **required metadata keys only**. Its declared design existed, but the export was absent at G4a entry; this batch implements it in S04 using ordered fragments. Do not use it for whole payload framing/hashing. Ordinary selected-record arithmetic remains shared and synchronous.

- [x] Add T15 RED (fixture based on existing `makeIncrementalProject`, new Work functions, T16):

```ts
it('cooperatively retains positional fold exceptions and own-property absence', async () => {
  const state: any = currentState(); const template = state.variants.default.templates.page;
  template.layers = [
    { id: 'same', name: 'A', order: 0, collapsed: true },
    { id: 'same', name: 'B', order: 1, collapsed: 'raw' },
    { id: 'unique', name: 'C', order: 2, collapsed: false },
    { id: 'absent', name: 'D', order: 3 },
  ];
  const h = makeWorkHarness(); const parts = await h.runtime.run(partitionStateWork(state));
  expect(parts).toEqual(partitionState(state));
  const assembled = await h.runtime.run(assembleStateWork(parts));
  expect(assembled).toEqual(assembleState(parts));
  expect(Object.hasOwn(assembled.variants.default.templates.page.layers![3], 'collapsed')).toBe(false);
  expect(assembled.variants.default.templates.page.layers![1].collapsed).toBe('raw');
});
```

T12 add size parity using `makeIncrementalProject(200)` and `decomposeProject`: `await runtime.run(createSizeLedgerWork(image))` equals existing ledger; selected before/after slices update exactly as retained size tests. Add long multibyte node/template ID (no new cap) and absent/false/raw folds; ordinary `applySizeChanges` must not become workspace reconstruction.

- [x] RED/GREEN:

```bash
NO_COLOR=1 FORCE_COLOR=0 TMPDIR=/tmp/opencode node /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/node_modules/vitest/vitest.mjs run /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/document/partition.test.ts /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/document/partitionedHistory.test.ts /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/document/layerFolds.test.ts /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/normalized/sizeLedger.test.ts /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/normalized/codec.test.ts --silent --reporter=dot
```

Expected RED: missing Work exports. Exact extraction algorithm:

```text
partition:
  enumerate state fields once; classify by unchanged APP_STATE_FIELD_CLASSIFICATION;
  create document/preference/compatibility objects in original entry order, one field per effect;
  for each template: first count string layer IDs; second map layer positions;
  if layer is not object or lacks own collapsed, retain original layer reference;
  otherwise remove collapsed with stepped shallow copy;
  boolean + unique string ID -> boolean preference addressed by JSON tuple;
  all other present values -> raw exception addressed by (variant,template,position), including undefined;
  use jsonTextWork for long tuple keys; no property-presence normalization.
assembly:
  same compatibility/document/preference spread precedence and original field ordering;
  for each layer: positional exception first; then own boolean preference; otherwise original reference;
  shallow-copy only layers receiving a collapsed property, preserve current appended-field behavior.
size contribution:
  convert each existing contribution loop to a generator, preserving arithmetic verbatim;
  member(key,n) = UTF8(JSON.stringify(key))+1+n+1 using quote/UTF8 work;
  fields(n)=n-2+Number(n>2); count nodes/variants from map sizes, elements from array lengths;
  preferences: count only classified own fields; sum overlay contributions one value per effect;
  applySizeChanges uses old/next contribution deltas and exact nonempty-container adjustments;
  createSizeLedger uses the same empty nodes/variants/wrapper initial constants and contribution program.
```

No loader/hydration in raw assembly, no loss of duplicate/non-string layer IDs, no arbitrary new fold validity rule. Metadata key strings and index arrays count as I in ownership accounting; bounded frame buffers do not imply identifier strings are bounded. T02 exact S21/S22→S02/S04, retaining existing pure edges.

#### G4a traversal batch — controller verification

All four Work APIs implemented together with shared synchronous wrappers. Tests pin positional raw/undefined folds, sparse holes, unchanged layer references, appended-field JSON golden, cancellation during partition/assembly/size work, long multibyte node/template IDs, and selected forward/reverse arithmetic. Initial RED3 missing exports; focused263/5 passed before broader checks. Hydration/navigation/active-template code unchanged; no payload traversal added to ordinary selected-record arithmetic. Boundary changes are exactly the four approved pure import edges.

First broader run:2197 passed, one existing Sticker Press timeout. Profiling isolated actual generator overhead: empty-overlay assembly used260169 operations and approximately332ms warm, versus roughly5ms baseline. Fixture loading itself cost approximately2.8s. RED1 pinned unnecessary520 emitted address bytes on ten empty-overlay templates. Invocation-local lazy empty-map probes now avoid nonexistent addresses, preserving template/array copies, borrowed layer references and exception precedence. Each map is probed at most once; no per-template map scan or mutable-authority cache. Fresh probe:17555 assembly operations, approximately49ms first-run. No fixture/timeouts changed; native timing gates remain unproven.

Final regression: `NO_COLOR=1 FORCE_COLOR=0 TMPDIR=/tmp/opencode npx vitest run tests/unit/document tests/unit/localWorkspace/normalized tests/unit/localWorkspaceBoundary.test.ts tests/unit/localWorkspace/canonical.test.ts --silent --reporter=dot` — **2264 tests/19 files PASS405.25s**. Build `task-11b-g4a-traversal-batch-build-01` PASS11.07s/2467modules; tsc reports only baseline Sticker Press TS2339 at793:36. Audit41 authorized paths,67/81 prior dirty blobs retained, HEAD/index/whitespace/protected hashes intact. Immutable baseline not recaptured. Read-only reviewer compared baseline semantics and reported no defects, including shortcut follow-up; model openai/gpt-6-astra, effort unavailable. No formal independent group/whole-task acceptance, production activation, commit or profile migration. Next: G4b codec/proof/cursor implementation, then G5/G6 sessions and cumulative gates.

### Group 4b — codec traversal, proof rules and project-at-a-time target cursor

**Files:** S23/S24/S07; T12/T13/T14/T03/T02. Depends G4a. Ordinary `validateChanges.ts` is read-only; no ordinary-save algorithm change.

**Interfaces:** add `decomposeProjectWork(project,scope): Work<NormalizedProject>`, `validateRecordsWork(records): Work<void>`, `reconstructProjectWork(records): Work<WorkspaceProject>` with the existing parameter types. Add Work variants of S24 `validateCommitWindow`, `validateLineage`, `validateAuthorityPair`, `validateProof`, `validateIdentity`, `denseDataArray`, `dataObject`, `exactFields` with the same arguments and corresponding values/void; sync wrappers share their rules. `recordFrame`/`manifestFrame` factories were defined above.

Define in S23 (type-only exports, no durable changes):

```ts
export type TargetRecord = Exclude<TaggedNormalizedRecord, { store: 'normalizationLedger' }>;
export interface TargetCursor {
  next(): Work<IteratorResult<TargetRecord, void>>;
  dispose(): void;
}
export function createTargetCursor(source: NormalizationSource): TargetCursor;
```

- [x] Add T12 REDs:

```ts
it('reconstructs once through the cooperative codec and preserves external order', async () => {
  const project = makeIncrementalProject(80);
  Object.assign(project, { retainedWrapper: { z: 1, a: '😀'.repeat(20_000) } });
  const scope = { storageGeneration: 'g', projectId: project.id, incarnation: 'i' };
  const h = makeWorkHarness();
  const image = await h.runtime.run(decomposeProjectWork(project, scope));
  const out = await h.runtime.run(reconstructProjectWork(image));
  expect(JSON.stringify(out)).toBe(JSON.stringify(reconstructProject(decomposeProject(project, scope))));
  expect(h.runtime.snapshot().yields).toBeGreaterThan(0);
});
```

In T14, after `h.repository.readNormalizationSource()` on existing admitted harness, compare drained `createTargetCursor(source)` to `prepareNormalizationTarget(source)` record-by-record using existing `frameRecord`. Run this comparison before refactoring old `prepareNormalizationTarget` to drain the same cursor; retain at least one explicit expected header baseline/order golden. Test >64 records, multiple projects, long IDs, large wrapper extension and existing depth/fold cases. T13 pins `recordFrame` and `manifestFrame` byte equality with their existing strings and node SHA; core omission excludes exactly two fields, external depth resets independently for each field.

- [x] RED/GREEN (cursor parity placed in T12 with deterministic source fixture; existing T14 integration matrix also rerun):

```bash
NO_COLOR=1 FORCE_COLOR=0 TMPDIR=/tmp/opencode node /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/node_modules/vitest/vitest.mjs run /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/normalized/codec.test.ts /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/normalized/commitProof.test.ts /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/normalized/migration.test.ts --silent --reporter=dot
```

Expected RED: Work/cursor/frame exports absent. Implement by moving these **specific existing loops**, not wrapping them:

```text
validateExternalWork: canonical project traversal -> existing wrapper/cloud/schema predicates ->
  validateAppStateWork(state,'plain') -> own activeVariant membership. No loader/hydration.
decomposeProjectWork:
  same scope checks; external validation; partitionStateWork;
  step pick/omit field scans, metadata order arrays, node/variant/template/source/extension/preference puts;
  encodedSize uses plainJsonBytesWork (property-order JSON, not private frame bytes);
  overlay bytes = original template JSON bytes - stripped stored template JSON bytes;
  use createSizeLedgerWork and populate exact current header/preference counters.
validateRecordsWork:
  every map/record envelope, descriptor, canonical own field, key length/prefix/mapKey,
  version, value/encodedSize, optional baseline/fold digest, order array and overlay check stays;
  per-field canonical traversal starts at depth 0; lineage delegates shared Work validators;
  duplicate/order membership loops are stepped, not `.every` over unlimited arrays.
reconstructProjectWork:
  validateRecordsWork once; exact `used` membership sets; build variants/templates/nodes by order arrays;
  shared stepped ordered/merge/orderedState and overlay-address verification;
  assembleStateWork; merge wrapper/cloud; reject collisions/missing/extra physical records;
  validateExternalWork; per-template overlay byte equations; aggregate ledger equality;
  return ONE external project. Do not call reconstructProject again in caller.
proof/lineage work:
  preserve check order, exact fields, proof numeric transitions, baseline null-proof exception,
  initial-vs-advanced foldRecordDigest rule, count/64KiB windows, selected/address uniqueness;
  bound malformed arrays/long strings while checking them, not after synchronous full framing;
  `validateCommitWindow` metadata sizing uses ordered JSON Work, canonical comparison uses shared Work.
```

`createTargetCursor` builds one `id→StoredProject` index once, not `.find` per identity. It walks `source.sourceProjects` order, decomposes one project under Work, sets exact migration baseline/nonzero source revision/timestamp/window floor, then yields each map value in `NORMALIZED_STORE_NAMES` order skipping ledger. Drop current project image before creating the next. `next()` itself is a Work program and may yield many CPU operations before one record; `dispose` clears project/index/cursor references synchronously, no persistence. Existing `prepareNormalizationTarget` synchronously drains the cursor into an array **for its existing one-shot API only**. Repository session never calls that array wrapper.

- [x] GREEN above and ordinary repository suite (read-only existing tests): scalar six gets/one put/no fold hash retained. T02 adds exactly S23/S24→S02/S04; S07 unchanged, no new cycle.

#### G4b codec/proof/cursor batch — controller verification

Implemented decompose/validate/reconstruct Work APIs, private data/array/identity/proof/window/lineage/authority Work validators, streamed record/manifest frames, and project-at-a-time target cursor. Shared synchronous entry points retain native canonical/JSON serialization via private strategies; public Work entry points cannot select those strategies. Payload depths reset per physical field, external validation remains raw/no-loader, selected-record ordinary-save algorithm is unchanged.

Cursor builds one borrowed-row index, retains one working image, charges each emitted record, and drops/releases image before the next project. Index reservation counts16 reference-slot bytes plus UTF-8 IDs; image reservation uses approved raw logical graph weights. Both release on EOF, mid-work cancellation and explicit disposal. Measurement follows construction, so these are logical reservations, not continuous allocator/heap proof; caller/session still owns source and must dispose cursor on exit. One-shot target wrapper drains the same cursor using its private synchronous strategy. Initial cooperative-versus-original-array parity passed before replacing the old wrapper; explicit baseline header/order and external JSON checks retained.

Added11 tests. Initial RED2 missing APIs. Read-only review found uncharged emission, missing image ownership and boxed-string baseline comparison acceptance; controller reproduced RED3 and fixed them. Additional index-weight assertion reproduced missing57 logical bytes, then passed. Follow-up reviewer probes covered baseline record order, repeated identities, reentrancy, disposal checkpoints and EOF, no further actionable defects; model openai/gpt-6-astra, effort unavailable, not formal independent acceptance. Tests also cover raw folds, deep500 extensions, long external IDs, input immutability, cancellation in each codec program, accessor/dense-array rejection and Node-SHA frame equality.

Initial combined roundtrip+two-project cursor test cost5.17–5.32s; split into distinct behavior tests with identical payloads and unchanged5000ms timeout. Focused183/2 passed. Broad run then exposed8 ordinary-save/staging timeouts. Deterministic RED showed synchronous32-entry proof-window checking invoked TextEncoder16903 times instead of65. Private synchronous canonical/byte-count/head-comparison strategies restore native counting while sharing validation predicates; codec's synchronous path forwards to them. Focused10 prior-failure/native-count cases passed, no timeout or existing fixture changes.

Final command: `NO_COLOR=1 FORCE_COLOR=0 TMPDIR=/tmp/opencode npx vitest run tests/unit/document tests/unit/localWorkspace/normalized tests/unit/localWorkspaceBoundary.test.ts tests/unit/localWorkspace/canonical.test.ts --silent --reporter=dot` — **2275 tests/19 files PASS423.33s**. Build `task-11b-g4b-codec-cursor-batch-build-01` PASS11.47s/2467modules; tsc sole baseline Sticker Press TS2339 at793:36. Audit45 authorized paths,63/81 original dirty blobs retained, HEAD/index/whitespace/protected hashes intact; baseline unchanged. No repository session adoption, production activation, commit, preview restart or profile migration. Next: G5 capture/seal/preparation/staging sessions, then G6 orchestration and cumulative/native gates.

### Repository session types and one-pass ownership (define once in S25)

These types are private interfaces, not durable schema additions. Existing eight methods keep their original parameter/return types.

```ts
export interface SourceInfo { kind: 'historical' | 'fresh'; acceptedLegacyDigest: string | null }
export type PreparationInfo = { state: 'active' } | { state: 'prepared'; source: SourceInfo };
export interface ActiveRead { authority: ActiveAuthority; snapshot: WorkspaceSnapshot; source: SourceInfo }
export interface NormalizationSession {
  prepare(options?: { allowFresh?: boolean }): Promise<PreparationInfo>;
  reserve(): Promise<NormalizationAttempt>;
  stageNext(): Promise<NormalizationAttempt>;
  verify(): Promise<NormalizationAttempt>;
  activate(): Promise<ActiveAuthority>;
  reopen(): Promise<ActiveRead | undefined>;
  dispose(): void;
}
// Add to NormalizedRepository, all created inside createNormalizedRepository:
// openNormalizationSession(work: WorkRuntime): NormalizationSession;
// readActiveSnapshot(work?: WorkRuntime): Promise<ActiveRead | undefined>;
// readRetainedSource(work?: WorkRuntime): Promise<NormalizationSource>;

type CaptureStore = typeof sourceStores[number] | typeof NORMALIZED_STORE_NAMES[number];
interface CapturedRow { key: IDBValidKey; value: unknown; bytes: number }
interface Capture {
  stores: readonly CaptureStore[];
  rows: Map<CaptureStore, CapturedRow[]>;
  eof: Set<CaptureStore>;
  release(): void;
}
interface ProjectPlan { first: number; count: number }
interface PreparedPass {
  source: NormalizationSource;
  archive: NormalizationSourceArchive;
  attempt: NormalizationAttempt;
  projects: Map<string, ProjectPlan>;
  capturedProjects: Map<string, NormalizedProject>; // Views over this capture, not payload clones.
  recordBytes: number[]; // Numerical metadata only, no whole target image/frame array.
  release(): void;
}
interface BulkAdmission {
  external: WorkspaceProject;
  preferences: ProjectPreferences;
  stamp: AuthorityStamp;
  foldRecordDigest: string;
}
interface VerifiedOutput {
  snapshot?: WorkspaceSnapshot;
  selectedProject?: NormalizedProject;
  selectedAdmission?: BulkAdmission;
}
interface ActiveCaptureResult extends VerifiedOutput {
  authority: ActiveAuthority;
  source: SourceInfo;
}
```

`source.records`, snapshot/raw-source projections and indexes share owned captured payload references, not cloned workspace graphs. `source.snapshot` for normalization is the raw ordered view, not historical loader output. `PreparedPass` retains metadata plus the source; a target cursor owns at most one working project. `CapturedRow.bytes` is independently measured after materialization, never read from encodedSize. `Capture` is untrusted until sealed. Test observers never receive these private types.

Release functions must clear their own reference slots/arrays/maps, not just decrement counters. Use closure-owned optional slots with guarded getters if required by the live interface types; `release` sets slots undefined and session sets its pass/capture variables undefined before a new capture await. Do not mutate payload objects transferred into a returned snapshot/source. Transfer raw source ownership from capture to preparation after reserve rather than double-counting the same referenced graph. Remove S25's duplicate local TargetRecord alias and import S23's type.

Private S25 helper signatures, used only by the writer closure:

```ts
// capture(work, sourceOnly?: boolean): Promise<Capture>
// preparePass(capture, work, mode: 'prepare'|'verify'|'activate'|'active'|'retained'): Promise<PreparedPass>
// seal(capture, work, mode: IDBTransactionMode,
//      write?: (tx: IDBTransaction, guard: (fn:()=>void)=>void) => void): Promise<void>
// independentlyVerify(capture, pass, work, active: boolean, selectedScope?: ProjectScope): Promise<VerifiedOutput>
// activeCapture(work, selectedScope?: ProjectScope): Promise<ActiveCaptureResult | undefined>
```

`write` callbacks only issue IDB requests/chain request success; no async function is accepted. `seal` does not return before transaction completion. `preparePass` computes each distinct required source/archive/manifest frame once per captured pass; it never recursively calls one-shot repository methods. Reuse only exact captured-pass results, never a durable “validated” flag. Authority/prefix/current-target operations always capture/seal all fourteen stores. Retained-source relevant sets are specified immediately below; caller metadata never chooses arbitrary subsets.

`sourceOnly` mirrors actual sourceFromRows dependencies so corrupt **unused live ancillary/target** data cannot suppress valid archived recovery:

- No marker: all six historical stores + normalizationLedger (seven), because current source records supply workspace/presets/imports/ledger.
- Valid historical marker: projects + legacyBackup + normalizationLedger (three); frozen workspace/presets/imports/ledger/projectMetadata are inside the fully validated archived row, and every historical backup row still participates.
- Valid fresh marker: those three + migrationLedger (four), preserving sourceFromRows's additional requirement that no historical ledger/projects exist; seed/frozen ancillary are in archive.

Point marker is only a capture-shape hint. Keep its owned value and require exact agreement with captured/final sealed marker before using that shape; a changed/multiple/malformed marker causes contention/refusal, never omitted-store trust. Seal every row/key/membership in the entire selected set atomically. Seven/thin sets are **only retained-source exports**, which return no current target authority; verification/activation/active read always use fourteen. Do not canonicalize or validate an unused live preset merely to export its immutable archived predecessor.

Use one private `withWork<T>(provided: WorkRuntime | undefined, operation: (work: WorkRuntime) => Promise<T>): Promise<T>` in S25: create default runtime when absent, assert its registered implementation, add repository lifecycle guard, invoke operation, remove guard in finally and dispose only a runtime created here. Eight one-shot adapters use this helper, always capturing caller-owned inputs before their first await. Session owns its guard/preparation only, not the caller's scheduler. No dangling MessageChannel after a one-shot export/read.

### Group 5a — physical capture/seals and prepare/reserve

**Files:** S25/S07; T14/T02. Depends G4b. S07 gains source-frame composition only; no new IDB owner. Implement `openNormalizationSession.prepare/reserve/dispose` first. Its temporary return type is `Pick<NormalizationSession,'prepare'|'reserve'|'dispose'>`; G5b adds `'stageNext'` to that Pick and G5c exposes the full interface. Add combined read methods in G5c only. No dummy methods, throwing placeholders or fallback whole-helper work quanta. Existing eight strict methods stay usable throughout; normalizer does not switch until G6a. This is an independently reviewed intermediate checkpoint, not a final budget claim.

**Concrete fixture helper in T14** (reuses existing local `createNormalizationHarness`, `physicalRows`, `mutateRow`):

```ts
async function boundedHarness(projectCount = 3, templateCount = 70) {
  const projects = Array.from({ length: projectCount }, (_, i) => ({
    ...makeIncrementalProject(templateCount), id: `bounded-${i}`, name: `Bounded ${i}`,
  }));
  const h = await createNormalizationHarness({ legacyValues: {
    [LEGACY_KEYS.projects]: JSON.stringify(projects), [LEGACY_KEYS.activeProject]: projects[0].id,
  } });
  await h.adapter.open();
  expect((await h.historical.bootstrap(() => {}, { allowCopiedReplacement: false })).status).toBe('admitted');
  const w = makeWorkHarness();
  const repository = createNormalizedRepository(h.environment);
  return { ...h, w, repository, session: repository.openNormalizationSession(w.runtime) };
}
```

Add to `NormalizedEnvironment` the private **test fault seam** `normalizationPause?(point: { phase: Phase; point: 'after-page'|'before-hash'|'before-seal'; ordinal: number }): void | Promise<void>`. This is not a progress observer and may throw/await; invoke only outside transactions using `work.wait`. It carries no payload/IDs. Original `normalizationFault` remains synchronous at existing durable ordinals. In-transaction faults never await this hook.

Construct hook phase from `work.context().phase`; maintain numerical ordinals per phase/point within invocation. Add local `validateNormalizationLedgerWork(value: unknown): Work<void>` and have existing asserting synchronous validator drain it. `matchAttemptSource` outside a transaction uses shared frame comparison; full marker comparisons inside stage/seal remain the explicit one-record exception.

- [x] T14 REDs:

```ts
it('prepares once and atomically reserves one immutable archive', async () => {
  const h = await boundedHarness();
  try {
    expect(await h.session.prepare()).toMatchObject({ state: 'prepared', source: { kind: 'historical' } });
    const attempt = await h.session.reserve();
    expect(attempt.nextRecord).toBe(0); expect(attempt.state).toBe('staging');
    expect(h.w.runtime.snapshot().sourceDerivations).toBe(1);
    const rows = await physicalRows(h, ['legacyBackup', 'normalizationLedger']);
    expect(rows.normalizationLedger).toHaveLength(1);
    expect(rows.legacyBackup.filter(row => row.kind === 'normalization-source')).toHaveLength(1);
  } finally { h.session.dispose(); }
  expect(h.w.runtime.snapshot().ownedBytes).toBe(0);
});
it('rejects a same-revision mutation after paging before reservation seal', async () => {
  const h = await boundedHarness(2, 2); let mutated = false;
  h.environment.normalizationPause = async point => {
    if (point.phase !== 'reserve' || point.point !== 'before-seal' || mutated) return;
    mutated = true;
    await mutateRow(h, 'projects', store => {
      const get = store.get('bounded-0');
      get.onsuccess = () => { const row = get.result; row.project.name = 'changed'; store.put(row); };
    });
  };
  try {
    await h.session.prepare(); await expect(h.session.reserve()).rejects.toBeDefined();
    expect((await physicalRows(h, ['normalizationLedger'])).normalizationLedger).toHaveLength(0);
  } finally { h.session.dispose(); }
});
```

- [ ] RED/GREEN:

```bash
NO_COLOR=1 FORCE_COLOR=0 TMPDIR=/tmp/opencode node /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/node_modules/vitest/vitest.mjs run /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/normalized/migration.test.ts --silent --reporter=dot
```

Expected RED: absent session or >1 derivation/current code missing final lifecycle seam. Implement exact candidate/seal algorithm in the critical section plus:

```text
prepare():
  point-read marker metadata. Active -> return {state:'active'}, retain no payload (reopen does admission).
  Absent marker -> point-read historical ledger/count metadata; unsupported/copied/v1 -> historical-admission-required.
  Empty source with options.allowFresh !== false -> generate/capture owned fresh seed once;
    retain physical empty candidate separately. allowFresh=false -> historical-admission-required
    before calling any seed/UUID provider (normalizer discovered present legacy keys).
  capture all 14 stores with 1-row pages + EOF, only beginning/ending marker metadata reads.
  validate physical keys against envelope id/key; build source/backups/project/prefix indexes once.
  derive PreparedPass as below; return only small SourceInfo, no prepared graphs.
reserve():
  seal exact captured all-store candidate in one readwrite transaction.
  if no prior marker: after every EOF, add archive then attempt with original fault sequence.
  if prior marker: its exact source/archive/prefix was independently validated in prepare; no add.
  current marker advance -> normalization-contention; never adopt it into this cached cursor.
  release prefix/candidate target references after completed seal, retain owned raw source+metadata.
  return a clone of internal expected marker, not mutable internal marker reference.
dispose(): idempotently close cursor, clear capture/source/index/batch/hash references and ownership counters.
```

Add a repository-local connection-loss epoch used only as a lifecycle latch, **not** ordering/storage authority. `open` handles unexpected `db.onclose` and `onversionchange` by advancing it and invalidating ordinary owners; session/read captures its current value and registers a synchronous guard with WorkRuntime, removed at disposal. Normal `db.close()` does not constitute unexpected loss. A forced close/versionchange observed during a page/seal stops further planned writes, even if another connection could reopen. Fresh invocation captures fresh lifecycle state and independently rereads. Keep coordinator tail/captured owner epoch as ordering authority. Run `after-page` test pause after transaction completion but before that page connection is closed in finally, so versionchange/forced-close tests can still exercise an actual live connection without holding an active transaction across the pause.

`preparePass` critical source/archive derivation:

1. Validate marker fields/phase with stepped equivalents of S25:98–129. Find **only its recorded archive**; verify discriminant/version/sourceKind/exact fields. Historical projects come from physical historical rows; fresh projects come only from validated archived seed. Unmarked fresh seed is not retained/exportable.
2. Validate source records through `validateWorkspaceRecordsWork`, preserving all loader checks while discarding hydrated copies. Build project ID map once; order raw records by workspace.projectOrder; stable-sort raw presets/imports by position once.
3. Validate every captured historical backup once, including archive-like historical IDs. Check each original/accepted reference against that validated row's id/digest/kind/capturedAt. Compute each backup envelope digest once separately; snapshot hash and envelope hash are distinct required frames.
4. Compute sourceProjects in project order with exact `envelopeFrame('normalization-project-v1', storedRecord)`; compute content/source frames **identically to existing S25:299–302** by streaming their literal punctuation and subframes. Do not substitute digest-of-digests or change empty list punctuation.
5. Allocate lowest unused exact D7 suffix from validated historical backup IDs. Build expected archive with original projectMetadata order and exact backupDigests order, historical ledger or fresh seed as currently encoded. Compute existing `normalization-archive-v1` frame once. For a recorded archive require ordered-JSON equality with the complete expected archive before exclusion; comparing its digest/id alone is insufficient.
6. Walk `createTargetCursor(source)` once for metadata/manifest: for each record feed exact `recordFrame`; use byte-count deltas from that same stream for recordBytes; match captured prefix rows by physical address/full frame equality during this traversal. In verify/activate modes this same traversal compares all baseline records; active mode performs conditional document/fold/baseline checks described in G5c. Every expected physical row must match required membership once; stage prefix rows must be among first marker.nextRecord records. Retained mode derives marker/manifest expectations but never validates corrupt target bytes. Record per-project first/count only. Final expected marker fields use unchanged attempt/storage-generation derivation and domains. **No second expected-target decomposition in independentlyVerify.**
7. Require recorded marker's source fields to equal expected attempt, with only the existing state/progress/verification/cutover fields projected from recorded marker. Pre-active live ancillary rows must equal baseline source (canonical equality as before); active mode permits live workspace/presets/imports to advance while retained baseline remains intact. A marker cannot certify a torn physical capture.

Metadata discovery must use stepped `isRecognizedLedgerWork` when examining a full historical ledger; its P-sized fingerprint arrays are not a constant-time phase check. `validateNormalizationLedger` similarly becomes a shared Work program. Point metadata bytes are counted explicitly; neither validator may be hidden in one discovery visit.

Seals compare one current physical row at a time using a synchronous streaming/structural comparator equivalent to the old per-record frames, including their field depth resets. No second complete graph/string. Full cursor EOF catches insertion behind paging cursor, deletion and extra stores/rows. Ordered expected-archive comparison belongs to derivation; all-store physical seal uses its existing canonical-equivalence semantics rather than inventing stricter key-order CAS. Guard before/after one-row comparison; this exception is explicitly counted.

- [x] GREEN complete migration suite, especially strict one-shot source/archive reservation, D7 collisions and physical-key mismatches. T02 adds repository→S02/S04/S07 plus the existing pure workspace-schema constant `WORKSPACE_MIGRATION_ID` for metadata point reads; no pure helper acquires IDB and no capability rule is broadened.

#### G5a preparation/reservation batch — controller verification

Implemented connected preparation/reservation path in S25, with the minimal `NormalizationPreparationSession` interface (`prepare/reserve/dispose`) rather than unimplemented future methods. Existing eight strict one-shot APIs remain available and the normalizer is not switched yet. Shared marker Work validator now rejects nonprimitive enum values without unbounded `String(array)` coercion. Repository connection-loss epoch invalidates ordinary owners and session guards on unexpected close/versionchange, but is not storage ordering authority.

Preparation performs metadata-only historical admission discovery, one-row transactions plus EOF over all fourteen stores, physical-key checks and beginning/ending marker agreement. It validates raw source/backups, computes existing source/content/archive domains, allocates exact lowest-unused archive suffix, and streams one target cursor for manifest hash, per-record byte deltas, project plans and independent resumed-prefix checks. Backup snapshot validation happens once per row; original/accepted reference checks reuse that validated row, while envelope hashes remain separate. Active discovery returns only a hint for later independent reopen, never editing authority.

Reservation seals every physical row/key and EOF in one readwrite transaction, then atomically adds archive and marker with original fault ordinals. Resumed reservation seals without rewriting archive. Returned metadata/marker are detached from private state; repeated reservation is refused rather than treating cached metadata as current authority. Source candidate containers/prefix references drop after reservation. Cancellation/disposal retain resources until an in-flight operation/abort settles; connection acquisition is enclosed by cleanup even if its completion loses lifecycle ownership.

Accounting remains explicitly logical: points/candidates use raw weights; seals measure their existing current-row comparison streams, with prefix/incomplete diagnostics on failed comparisons. Retained capture lease remains a conservative upper bound after physical/prefix containers drop, with separate metadata and fresh-seed ownership. Measurements follow materialization; no continuous allocator/heap proof or G6 cumulative acceptance is claimed. G5b/c must replace the remaining one-shot orchestration and complete session staging/verification/activation/read/export integration; G6 must reconcile representations and all failure/retry budgets.

Added37 session tests. Initial RED2 missing API. Review/controller reproductions closed fresh-provider aliasing, mutable `allowFresh` policy, added archive ancestry and connection-acquisition leak (RED4), then payload paging before copied-ledger discovery (RED1). Further read-only review found archive type/property aliasing in depth-reset seal, cancellation masked by after-commit fault, and unbounded marker coercion; RED7 then fixed. Archive seal now validates plain envelopes and dense property-exact arrays while preserving canonical key-order equivalence and original external-depth resets. Final read-only probes10/10 passed on those fixes; no formal independent group/whole-task acceptance inferred, reviewer model/effort metadata not provided in receipt.

Coverage includes every reservation fault ordinal, same-revision/membership/ancillary/backup races, insertion behind completed page and exact restoration, corrupt resumed prefix, competing reservation, force-close/versionchange, D7 collisions with archive-like historical IDs, wrong out-of-line physical key, fresh seed ownership and deep509 resume. Existing strict reservation independently confirms exact attempt/archive digests. First broader run had2311 pass and one new multi-project metadata-test timeout; removed unrelated artwork elements while retaining two projects,28 templates each and >64 records, with timeout unchanged.

Final command: `NO_COLOR=1 FORCE_COLOR=0 TMPDIR=/tmp/opencode npx vitest run tests/unit/document tests/unit/localWorkspace/normalized tests/unit/localWorkspaceBoundary.test.ts tests/unit/localWorkspace/canonical.test.ts --silent --reporter=dot` — **2312 tests/19 files PASS432.69s**. Build `task-11b-g5a-preparation-reservation-build-01` PASS11.13s/2467modules; tsc sole baseline Sticker Press TS2339 at793:36. Audit46 authorized paths,62/81 original dirty blobs retained, HEAD/index/whitespace/protected hashes intact. Immutable baseline unchanged. No commits, profile migration, preview restart or production activation.

### Group 5b — bounded stage emission and independently validated resume

**Files:** S25; T14. Depends G5a. No codec/source redecomposition inside a stage transaction.

Before switching the one-shot stage path to incremental hashing, perform the fault-hook adaptation mapped in G5c. The transitional helper must observe **both** old environment.hash and new normalizationPause so retained phase-specific stage tests cannot hang while verify/active paths still use old code. Restore both hooks after each test; do not weaken fired/entered assertions. G5c completes the remaining caller migration.

- [x] Add T14 REDs using the existing session harness:

```ts
it('all session stages reuse one preparation and append only a bounded batch', async () => {
  const h = await boundedHarness(3, 90);
  try {
    await h.session.prepare(); let attempt = await h.session.reserve();
    const prepared = h.w.runtime.snapshot(); let batches = 0;
    while (attempt.nextRecord < attempt.recordCount) {
      const before = attempt.nextRecord; attempt = await h.session.stageNext(); batches++;
      expect(attempt.nextRecord - before).toBeGreaterThan(0);
      expect(attempt.nextRecord - before).toBeLessThanOrEqual(64);
      expect(h.w.runtime.snapshot().sourceDerivations).toBe(prepared.sourceDerivations);
      expect(h.w.runtime.snapshot().candidateRows).toBe(prepared.candidateRows);
      expect(h.w.runtime.snapshot().sealRows).toBe(prepared.sealRows);
    }
    expect(batches).toBeGreaterThan(3);
    expect(h.w.runtime.snapshot().markerCasRows).toBe(batches);
    expect(h.w.runtime.snapshot().stageRecords).toBe(attempt.recordCount);
  } finally { h.session.dispose(); }
  expect(h.w.runtime.snapshot().ownedBytes).toBe(0);
});
it('a competing marker advance invalidates rather than splices a cached session', async () => {
  const h = await boundedHarness();
  const other = createNormalizedRepository(h.environment).openNormalizationSession(makeWorkHarness().runtime);
  try {
    await h.session.prepare(); await h.session.reserve();
    await other.prepare(); await other.reserve(); await other.stageNext();
    await expect(h.session.stageNext()).rejects.toThrow('normalization-contention');
    const rows = await physicalRows(h, ['legacyBackup', 'normalizationLedger']);
    expect(rows.legacyBackup.filter(row => row.kind === 'normalization-source')).toHaveLength(1);
  } finally { h.session.dispose(); other.dispose(); }
});
```

Add fresh-resume corruption table after exactly one stage: delete a prior row; change its value without revision change; add an unexpected row; move envelope key under a wrong physical key using existing `outOfLineNodes` harness; move record to wrong store. A new session's `prepare` rejects before any append. Retain existing every-write-ordinal quota/abort tests and legal oversized-record tests unchanged.

- [x] RED/GREEN (same full migration command as G5a). Missing stage API RED2; session reuse/contention and later completion/accounting regressions now pass. Implement:

```text
stageNext:
  require reserved internal expected marker in staging and nextRecord < recordCount
  create ONE emission TargetCursor lazily, distinct from completed metadata pass
  advance/discard ordinal 0..nextRecord-1 once on resumed emission, under Work
  batch=[]; bytes=0
  while next ordinal exists and batch.length < 64:
    size = prepared numerical recordBytes[ordinal]
    if batch nonempty and bytes+size > 256*1024: break BEFORE constructing next record
    record = await work.run(cursor.next()); require not done
    batch.push(record); bytes += size; ordinal++
    if size > 256*1024: break (the legal oversized record is alone)
  construct next marker with nextRecord += batch.length, progressRevision += 1
  guard; open readwrite transaction over existing NORMALIZED_STORE_NAMES
  cursor normalizationLedger: exact singleton membership, primary key and expected full marker
  after its EOF: add each batch record in original order through success callbacks
    guard before/after add, original stage.before-record/after-record faults at each ordinal
  put next marker; original stage before/after-marker/before-complete faults
  on tx.complete: existing stage.after-commit fault; update internal marker only as durable fact;
    emit durable counters/progress only here, guard; release batch; return marker CLONE
  abort/fault/ack loss: do not assume rollback; caller disposes session and rereads on next invocation
```

Stage uses no full-source/target reads or hashing. Retain full marker compare/clone cost B×M, not constant-size O(B). Marker cursor rejects extra marker rows without `getAll` of untrusted arbitrary membership. Per-record IDB clone and exact marker compare are counted native/record exceptions with guards; application record-issuance loop is callback-stepped. Batch record bytes come from metadata's **same exact frame stream** that fed manifest hash; do not do a second manifest derivation just to size them.

Existing one-shot `stageNormalization(attempt,records)` stays strict: capture both caller objects before first await; validate size/record count/ledger exclusion; independent candidate and pass; complete prefix plus exact next payload comparison; then shared transaction routine. It is intentionally more expensive across independent one-shot calls. Never accept caller-supplied recordBytes/digest or reuse an earlier session invisibly.

- [x] GREEN full migration suite. Existing source/earlier-target mutation cases retained: later bounded stages may commit, but verify/activation must refuse. Stage completion does not imply unchanged source or current authority; independent session verify/activate still belongs to G5c.

#### G5b bounded staging batch — controller verification

Added `stageNext` to the implemented session surface. One lazy emission cursor replays/discards a resumed prefix once, then emits batches capped at64 records/256KiB, with a legal oversized record alone. Limits use preparation's exact record-frame byte array before requesting the next record. Staging does not rederive/read source or hash payload; an independent IDB-method spy pins exactly one normalization-ledger cursor per batch. Shared transaction writer preserves strict one-shot input capture/validation and original fault order. One-shot preflight/hash path remains native/unchanged; its transitional hash-hook migration belongs with G5c's Work adapters, not this extraction.

Session writer checks singleton marker membership, physical key and complete expected marker before issuing any append. Record adds are callback-stepped; marker update and all records remain atomic. Failure/acknowledgement loss disposes session; no cached progress adoption or automatic replay. Completion counters and after-commit fault run in `tx.oncomplete`, before a continuation can lose lifecycle ownership; observers still run only after settlement. Marker comparisons measure both existing streams, including partial/incomplete failures; attempted put and returned clone are charged separately using premeasured canonical marker bytes. This accounts B×M rather than pretending metadata is constant. Batch ownership uses exact prepared frame bytes as a conservative reservation, not heap measurement.

Added33 tests, including every before/after-record write ordinal, marker fault points, completion-event cancellation, competing/extra markers, independent resumed-prefix staging and strict existing verifier acceptance. Initial count fixture with130 templates exceeded default timeout; replaced artwork-heavy templates with130 minimal nodes, retaining >128 records and >2 batches. Existing timeouts unchanged. New genuine >256KiB streaming integration case has explicit30000ms limit from introduction; it is not a native latency benchmark. Review found completion-boundary counter/hook loss and marker-cost gaps; RED2 reproduced them, fixes passed follow-up review. No additional data/lifecycle findings reported; no formal independent group/whole-task acceptance.

Final covering command unchanged from G5a: **2345 tests/19 files PASS425.12s**. Build `task-11b-g5b-bounded-stage-build-01` PASS10.35s/2467modules; tsc sole baseline Sticker Press TS2339 at793:36. Audit46 authorized paths,62/81 original dirty blobs retained, HEAD/index/whitespace/protected hashes intact. No boundary-policy changes needed. G5c independent session verification/activation/combined reads and one-shot Work adaptation remain pending, followed by G6 orchestration and cumulative/native gates. Existing strict verification remains available; stage completion alone is not authority. No commits/profile migration/preview restart/production activation.

### Group 5c — independent verification, activation, active read and retained export

**Files:** S25/S26; T14/T13/T02. Depends G5b. No private proof/durable schema changes.

- [ ] Add T14 helper and REDs:

```ts
async function stageAll(h: Awaited<ReturnType<typeof boundedHarness>>) {
  await h.session.prepare(); let attempt = await h.session.reserve();
  while (attempt.nextRecord < attempt.recordCount) attempt = await h.session.stageNext();
  return attempt;
}
it('verification rereads physical targets and reconstructs each project once', async () => {
  const h = await boundedHarness(3, 4);
  try {
    await stageAll(h); await h.session.verify();
    expect(h.w.runtime.snapshot('verify').projectReconstructions).toBe(3);
    expect(h.w.runtime.snapshot('verify').sourceDerivations).toBe(1);
    expect(h.w.runtime.snapshot('verify').captureHighWater).toBe(1);
    const rows = await physicalRows(h, ['projectNodes']);
    const node = rows.projectNodes[0]; node.value.title = 'corrupt after verified';
    await mutateRow(h, 'projectNodes', store => store.put(node));
    await expect(h.session.activate()).rejects.toBeDefined();
    expect((await physicalRows(h)).normalizationLedger[0].state).toBe('verified');
  } finally { h.session.dispose(); }
});
it('returns active authority and verified snapshot from one fresh read and seal', async () => {
  const h = await boundedHarness(2, 3);
  try {
    await stageAll(h); await h.session.verify(); await h.session.activate();
    const read = await h.session.reopen();
    expect(read?.authority.state).toBe('active'); expect(read?.snapshot.projects).toHaveLength(2);
    expect(h.w.runtime.snapshot('reopen').sourceDerivations).toBe(1);
    expect(h.w.runtime.snapshot('reopen').projectReconstructions).toBe(2);
    expect(h.w.runtime.snapshot('reopen').sealTransactions).toBe(1);
  } finally { h.session.dispose(); }
});
```

Full boundary race matrix must use this concrete mutator (put in T14, stores already exist in harness):

```ts
type TornMutation = 'same-revision' | 'insert-behind' | 'delete' | 'ancillary' | 'archive';
async function corruptCandidate(h: Awaited<ReturnType<typeof boundedHarness>>, kind: TornMutation) {
  if (kind === 'same-revision') {
    const row = (await physicalRows(h, ['projects'])).projects[0]; row.project.name += '!';
    await mutateRow(h, 'projects', store => store.put(row));
  } else if (kind === 'insert-behind') {
    const row = structuredClone((await physicalRows(h, ['projects'])).projects[0]);
    row.id = '!behind'; row.project.id = row.id;
    await mutateRow(h, 'projects', store => store.add(row));
  } else if (kind === 'delete') {
    await mutateRow(h, 'projects', store => store.delete('bounded-0'));
  } else if (kind === 'ancillary') {
    const row = (await physicalRows(h, ['workspace'])).workspace[0]; row.revision++;
    await mutateRow(h, 'workspace', store => store.put(row));
  } else {
    const row = (await physicalRows(h, ['legacyBackup'])).legacyBackup.find(row => row.kind === 'normalization-source');
    row.projectMetadata[0].updatedAt = '2026-09-16T12:00:01.000Z';
    await mutateRow(h, 'legacyBackup', store => store.put(row));
  }
}
```

Run each applicable mutation at `normalizationPause` point `before-seal` for phases `reserve/verify/activate/reopen/retained`. Reserve has no new archive yet, so use historical backup mutation there; archive case applies to resumed reserve. Set `fired=true` before awaiting mutation; assert it fired; one-shot operations reject, normalized orchestrator may retry only on contention and must never admit invalid authority. Add controls restoring exact original row before seal (simultaneous-state semantics), and paging-specific insertion after an `after-page` event, not just before first page. Retain out-of-line-key tests; do not replace them with envelope-only mutations.

- [ ] RED/GREEN:

```bash
NO_COLOR=1 FORCE_COLOR=0 TMPDIR=/tmp/opencode node /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/node_modules/vitest/vitest.mjs run /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/normalized/migration.test.ts /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/normalized/repository.test.ts /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/recovery.test.ts --silent --reporter=dot
```

Expected RED: old fallback double reconstruction/full scans, absent combined interface or missing exact final seals. Implement methods:

```text
verify:
  close emission cursor and RELEASE preparation source/prefix/project/batch before new capture
  capture fresh all stores; require exact internal expected marker, complete staging
  preparePass(mode='verify') from this capture; no cached source graph used
  preparePass already streamed expected target once, comparing baseline records/membership as it hashed;
  independentlyVerify(active=false): reconstruct actual captured project ONCE;
    ordered content comparison to raw source; discard result (no repeated target decomposition)
  compute unchanged verificationDigest domain/array from attempt fields
  seal same candidate, readwrite; put verified marker using old verify fault sequence
  release pass/capture; retain only cloned expected marker and small SourceInfo
activate:
  release any preparation still retained by resumed verified attempt
  fresh capture + preparePass(mode='activate') + independentlyVerify(active=false)
  require LIVE pre-active source/ancillary equals reserved source, including every backup;
    compare candidate live rows to already validated archive baseline without re-preparing source
  fresh path requires exact empty historical stores except recorded archive
  all-store readwrite seal -> add fresh workspace if needed + active marker atomically
  preserve cutover fault points, release pass/capture, return authority clone
reopen/readActiveSnapshot:
  marker point-read: absent/nonactive -> undefined, never scan entire unmarked source for discovery
  fresh capture + preparePass(mode='active'), current physical membership checks
  independentlyVerify(active=true), one reconstruction per actual project
  validate live workspace/presets/imports with shared historical rules, preserving live ancillary policy
  readonly exact all-store seal; return {authority,snapshot,source}, transfer snapshot ownership
  release normalized images/pass/capture; no retained writer-cache authority
readRetainedSource:
  fresh sourceOnly candidate + preparePass(mode='retained'), strict archive/original-source/backup validation
  coherent readonly seal spanning the ENTIRE exact retained-source dependency set before returning source/retainedSeed
  unreserved fresh source may be returned by old readNormalizationSource but never advertised as retained
```

Build a single `projectId→store maps` index over actual captured target rows before preparePass's baseline target walk, checking generation/project/incarnation membership while indexing; independentlyVerify consumes that same index, not a rebuilt one. Map entries reference captured payloads, not a second cloned target. Baseline comparisons are fused with preparePass's single target-manifest walk and happen before actual reconstruction, so an expected decomposed working image and a reconstructed working image are not retained simultaneously. IndependentlyVerify iterates source identities once and never calls createTargetCursor. A view map over captured rows is index metadata, not another payload graph.

Active admission exact rules:

1. Require actual migrationBaseline equal source-derived baseline regardless of preference proof.
2. If preferences have null proof, require current physical folds frame equal source-derived initial folds even if document proof advanced.
3. If header has null document proof, all source-derived document records/membership remain exact. Only existing preference record and folds payload may differ when authenticated preference proof advanced. A preference proof cannot exempt unchanged nodes/templates/extensions.
4. Reconstruct current project once with shared codec; reuse that external result in bulk proof admission.
5. Independently hash physical folds. Advanced preference revision requires matching authenticated `foldRecordDigest`; no backfill when missing. Core framing already includes that digest.
6. Process both retained windows in existing stable order by sum of after document/preference revisions. Verify each required manifest. Only entries above **both** window floors contribute selected postconditions; last applicable address wins. Verify each final selected current record once, current core against exact-stamp latest proof, else require genuine initial baseline/null-preference state. Preserve eviction/self-eviction/proof-unavailable/cache-gap/rebind behavior.

Share these checks with existing `verifyBulk` rather than copy a second proof-admission policy. Extend its private signature to `verifyBulk(fresh, verifiedActive=false, work?: WorkRuntime, external?: WorkspaceProject)`; supplied `external` is only the already reconstructed result of this same captured project, never caller/public input. Default ordinary callers retain environment.hash and synchronous selected frame APIs; work-aware bulk paths use frame programs. Extract selected-prefix/window/current-core loops into shared Work programs as needed. Per-pass frame cache keys are physical record identity+store+core or complete manifest input equality, not commitId/revision alone. No cache survives a pass.

**Actual additional internal consumer, not a new API:** S25 `read(..., bulk=true)` at original 650–656 currently consumes `activeCapture().images`; `bindAdmittedProject` and `exportProjectForRecovery` then call verifyBulk again at 1148/1175. Map them concretely:

```text
activeCapture(work, selectedScope absent): collect returned workspace snapshot; no images escape.
activeCapture(work, selectedScope present): validate ALL projects/current ancillary and the same seal,
  retain ONLY that project's normalized view and its BulkAdmission from this pass;
  discard other external projects after per-project strict historical/load checks;
  validate live workspace membership/order with ID metadata, not by retaining all project images;
  no whole workspace snapshot is needed in selected mode.
read bulk historical-store branch:
  call selected activeCapture, require exact requested generation/id/incarnation;
  add selected project to existing admittedBaselines WeakSet only AFTER completed seal;
  return {records:selectedProject, seen, admission:selectedAdmission} privately.
bindAdmittedProject:
  retain exact caller-vs-fresh record comparison and existing owner publication;
  use this read's admission (or old verifyBulk fallback for non-normalized test layouts),
  not a second reconstruction/proof scan over the already sealed project.
exportProjectForRecovery: same per-read admission reuse; no subsequent unsealed getAll.
```

`BulkAdmission` is scoped to one physical read/return, never global cached authority or observer output. Ordinary selected read/commit paths remain untouched; reference/fold owner indexes are constructed as before. This does not claim cooperative scheduling for unrelated ordinary editor hydration/index creation. Dispose transferred references correctly: clear capture/index containers, not selected row payloads or maps returned to the owner.

Strict adapters (eight original APIs):

| Existing method | Required new delegation |
| --- | --- |
| `readNormalizationSource()` | Independent bounded retained/source capture and readonly seal; fresh speculative flag unchanged. |
| `reserveNormalization(source)` | Clone caller source before first await; revalidate every raw record/frame and claimed digest, then exact reserve seal. No session trust based on object identity. |
| `stageNormalization(attempt,records)` | G5b strict candidate/prefix/payload path; no hidden cross-call session. |
| `readStagedProject(attempt,id)` | Clone marker before await; fresh full candidate/prefix validation and readonly seal; reconstruct selected project once. |
| `markNormalizationVerified(attempt,digest)` | Clone marker; exact supplied digest check; independent verify pass/seal. |
| `activateNormalization(attempt)` | Clone marker; independent activation pass/seal, live source checks. |
| `readActiveAuthority()` | Return authority from **one** `readActiveSnapshot()` call; separate public invocations remain independent. |
| `exportGeneration(generation)` | One fresh combined active read; require matching generation; return its snapshot. |

S26 `normalizationRecoverySources(repository, work?)` uses one retained read and one combined active read; no readAuthority-then-export duplication. `exportNormalizationRecovery(repository,selector,capturedAt,work?)` keeps exact selector/descriptor/timestamp validation and pre-await clone; then exactly one sealed retained read or one combined sealed active read. Keep old external discriminator fields and rollbackReady:false; no ordinary recovery policies edited.

Explicit recovery/export calls have their own runtime/counter totals. For recovery enumeration after a failed normalization attempt, retain before/after numeric snapshots around enumeration and report that delta separately from the successful-path budget; do not reset global counters or claim the failed invocation fits eight reads. Prerequisite captures keep the caller's `prerequisite` phase rather than overwriting it with main-path legacy-fence phase. Main normalizer sets `legacy-fence` itself. `digestFrame` changes only frameKind via `setContext(undefined,undefined,kind)`, restoring `none` afterward, so source/target phase accounting stays intact.

**Retained fault-hook migration is mandatory in this group.** T14 actual locations using `environment.hash` as timing, not crypto oracle: `hashGate:138–144`, transaction-hash guard around 668–677, stale marker around 989–997, during-hash source/target mutation around 1104–1121, fresh absence around 1213–1218, remote preference during active hash around 1637–1648. Move each to the equivalent `normalizationPause(before-hash)` boundary and preserve `fired`/entered assertions and all outcomes. Keep ordinary hash wrappers where tests exercise ordinary saves; digest-oracle calls at 341/455 still use hash normally. Update hashGate to gate either ordinary hash or normalizationPause once, restore both in cleanup, and invoke any original pause hook. Do not make `hashes>0` pass by invoking a redundant full-frame hash solely for instrumentation: count real incremental hasher updates instead and keep writers==0 assertion.

- [ ] GREEN full command and all original queued-transaction CAS, active D6/document/fold/preference matrices, caller-object mutation, archive-collision and lost-ack tests. T02 recovery gets only S02/S07 pure edges and type-only repository interface; it must not acquire repository construction or IDB capability.

### G5c verification/activation checkpoint (remaining G5c pending)

Session `verify` and `activate` now release preparation/emission state before fresh all-store capture, require the exact internal expected marker, independently derive source/archive/manifest and compare baseline targets, then reconstruct each actual project once. Actual target view maps are built during the captured-row index pass and consumed after expected-target streaming ends. Ordered external content is checked against raw source. Final readwrite seal covers all rows/keys/EOF; fresh workspace creation and active marker commit atomically. Verified/active completion faults preserve durable facts and lifecycle precedence. After success, source/capture/index references are dropped; only detached expected marker and small source info remain.

The source discard-only validator incorrectly incremented `projectReconstructions` despite returning no external project; RED metric assertion exposed this. Its existing validation/clone/loader work remains unchanged, but only retained snapshot reconstruction increments that metric. Actual normalized reconstruction is counted at its invocation. This is a diagnostic correction, not removal of validation work or a new CPU/heap budget claim.

Added27 tests: initial missing-API RED2; successful historical verification/activation, single reconstruction/capture counters, post-verification corruption refusal, both phase race matrices (source/target/ancillary/archive/insertion/deletion/extra marker), every marker fault boundary, fresh workspace atomicity, after-commit cancellation and resumed verified activation. Focused static read-only review found no concrete bugs in this scope; active reads/recovery adapters excluded and no formal whole-group acceptance claimed.

Broad19-file run:2370 passed, two boundary failures from auxiliary `Map.clear()`. Replaced clearing with dropping the private map slot; no checker/policy relaxation. Final boundary936/936 PASS187.28s and affected transition31/31 PASS37.33s. Thus1436 runtime cases passed in broad run, with affected31 rechecked after final edit; no claim of a single all-green2372 run. Build `task-11b-g5c-verification-activation-build-01` PASS10.97s/2467modules; tsc sole baseline Sticker Press TS2339 at793:36. Audit46 authorized paths,62/81 original dirty blobs retained; HEAD/index/whitespace/protected hashes intact.

Remaining G5c: active-mode conditional document/fold/proof admission and shared `verifyBulk` Work path; combined active read/reopen; retained-source dependency-shaped capture/export; selected admission reuse; strict one-shot Work adapters and timing-hook migration. Existing APIs remain native/strict and continue to provide independent test oracles. Normalizer still does not use sessions. No production activation, profile migration, commits or preview restart.

#### Approved 64-unit fragment implementation amendment

Follow the approved fragment-sizing amendment in the binding specification. It supersedes earlier 16-unit assumptions in this plan. Inline controller execution only; no commits. All timeouts, fixtures, 1024-visit/64KiB quanta, strict validation and authority checks remain unchanged.

Files: `shared/jsonWork.js/.d.ts` own the shared cap and bounded producers/counting/comparison; `services/localWorkspace/canonical.ts` owns incremental hash consumption; `services/localWorkspace/normalized/incrementalSha256.ts` raises its defensive per-update input cap to192 bytes (still at most600 visits). `tests/unit/localWorkspace/normalized/{work,incrementalSha256}.test.ts` and `tests/unit/localWorkspace/canonical.test.ts` exercise fragmentation/output/hash contracts, including193-byte update rejection without consuming input. No new capability edge or module is needed.

- [x] RED: add direct frame tests using prefixes of0/1/63 ASCII units followed by64 BMP units. Assert independent SHA-256 parity, exact input-byte counters, cleanup and original quantum compliance. Before implementation these fail on the old16-unit rejection.

```ts
const text = 'x'.repeat(prefix) + '根'.repeat(64);
const frame: Frame = function* (emit) {
  if (prefix) yield* emit('x'.repeat(prefix));
  yield* emit('根'.repeat(64));
};
expect(await digestFrame(frame, h.runtime, 'source')).toBe(createHash('sha256').update(text).digest('hex'));
expect(h.runtime.snapshot().hashBytes).toBe(prefix + 192);
expect(h.runtime.snapshot().ownedBytes).toBe(0);
```

- [x] GREEN: export `JSON_FRAME_UNITS = 64` with a literal declaration; use it at both producer chunk boundaries and all consumer admission checks. Allocate `new Uint8Array(JSON_FRAME_UNITS * 3)` for byte-count scratch. Preserve surrogate adjustment and escaping algorithms. Replace one-block hash accounting with:

```ts
const expectedVisits = bytes.length + 136 * Math.floor((pendingBytes + bytes.length) / 64);
```

- [x] Update only old fragment-contract assertions: max chunk length64, malformed fragment65, and exact text-fragment operation charges. Extend native-output boundary probes to positions63/64/65. Keep all digest vectors, failure-prefix, cancellation, ownership, and quantum tests. Run `npx vitest run tests/unit/localWorkspace/normalized/work.test.ts tests/unit/localWorkspace/canonical.test.ts tests/unit/localWorkspace/normalized/incrementalSha256.test.ts --maxWorkers=2 --silent --reporter=dot`.
- [ ] Verify the existing512KiB generator and256KiB staging cases individually under their original5s limits before another broad run. Run full connected gates with at most2 workers, separately run unchanged32MiB and fold-eviction stress cases, and retain genuine failure evidence. Finish build/typecheck/audit and record exact verification scope; baseline Sticker Press TS2339 is not a clean typecheck.

#### Approved count-only scan packing implementation

Goal: remove demonstrated quantum fragmentation without reducing charged work. Controller executes inline in the existing isolated worktree; no commits. Follow the approved count-only amendment in the binding spec. Only implementation file is `shared/jsonWork.js`, private `quotedUtf8LengthWork`; tests belong in `tests/unit/localWorkspace/normalized/work.test.ts`. Public functions/signatures and64-unit fragment cap do not change.

- [x] RED: add canonical/ordered64KiB ASCII count cases using `makeWorkHarness`. Run `await h.runtime.run(count('x'.repeat(64 * 1024)))`; assert65538 returned/emitted bytes, visits>=262144, yields>0 and<=270, ownedBytes0. Existing128-unit scans should exceed270 yields. Assert every observed quantum retains visits<=1024 and emittedBytes<=65536. Add native byte parity for paired/lone surrogates following125/126/127/128/129 ASCII units.
- [x] GREEN: change only `Math.min(offset + 128, text.length)` to `Math.min(offset + 127, text.length)` in `quotedUtf8LengthWork`, with comment explaining two `(4*127)+1` operations fit1024 visits. Retain surrogate boundary adjustment and exact byte accounting.
- [x] Verify focused RED/GREEN: `NO_COLOR=1 FORCE_COLOR=0 npx vitest run tests/unit/localWorkspace/normalized/work.test.ts -t 'packs count-only|count-only JSON preserves' --maxWorkers=1 --silent --reporter=dot`. Then run work/canonical/SHA suites and document/normalized suites excluding migration with `--maxWorkers=2 --silent --reporter=dot`; include validation/preparation/recovery/loader. Existing cancellation, observer and cleanup tests must still pass.
- [x] Run unchanged32MiB case separately with `NO_COLOR=1 FORCE_COLOR=0 npx vitest run tests/unit/localWorkspace/normalized/migration.test.ts -t '32MiB state boundary' --maxWorkers=1 --silent --reporter=dot`; no diagnostic config/timeout override. Do not infer80-template closure from this change. Build to unique `/tmp/opencode/doctect-incremental-sdd/task-11b-g5c-scan-packing-build-01`, run `npx tsc --noEmit`, audit script, `git diff --check`, and `git diff --cached --exit-code`. Record exact evidence and unresolved blockers in this plan and untracked progress ledger; no full-gate acceptance unless actually established.

Checkpoint: user approved the written127-unit amendment. Both new regressions failed on511 yields, then passed the<=270 bound after the single production scan-size change. Native parity at the new boundary and quantum/accounting assertions pass. Connected document/normalized (excluding migration), canonical, preparation, validation, recovery and loader command:1231 tests/21 files PASS53.58s, including work197 cases and SHA tests. Focused architecture21/21 PASS17.01s;915 unselected, not a whole-boundary run.

**Original32MiB test now PASS346.35s under unchanged360s limit** (command348.99s). Headroom is small; not a native performance guarantee. Original80-template observer/hash test still TIMEOUT5000ms. A six-case migration check passed fold-self-eviction, both generator boundaries and both256KiB boundaries, but the compound canonical-source case timed out after stress despite passing alone4.44s. Applied the user's earlier scenario-split approval: unchanged complete source/provenance/order fixture in both cutover and ancillary-edit cases, all prior assertions preserved across branches; no timeout edits. Both split cases PASS6.24s combined (command8.91s). Migration file now627 cases; no complete migration covering gate claimed.

Read-only scoped review found no issues in the scan adjustment, regressions or scenario split; reviewer compared fixture/assertion preservation against supplied pre-change description because the migration file is untracked relative to HEAD, and did not independently run tests. Controller retained the actual patch and RED/GREEN receipts. Build `task-11b-g5c-scan-packing-build-01` PASS11.93s/2467 modules. Typecheck only known Sticker Press TS2339. Audit47 authorized paths/61-of81 baseline blobs retained, HEAD/index/whitespace/protected hashes intact. Remaining80-template performance failure, six strict adapters/hook migration and G6 orchestration/accounting still block Tasks12/13. No full-G5c/native acceptance, commits, production cutover, preview restart or profile migration.

#### G5c selected integration/performance checkpoint — historical before scan packing

Implemented selected sealed capture for bulk bind/recovery export. Every project and live ancillary record is validated and the same all-store seal is completed, but only the selected normalized view and its per-read BulkAdmission escape. A shared streaming historical validator retains ID/provenance metadata rather than every reconstructed project. Caller-versus-fresh comparison and owner publication remain intact; admission is not cached across calls. Added regressions for no native proof rehash/full scans, unselected-row seal races, restoration/retry, and streaming validation parity.

`readActiveAuthority` and `exportGeneration` now each use one combined active read; the old duplicate activeCapture implementation is removed. Normalizer active discovery/publication and its post-cutover read reuse coupled authority/snapshot/source facts instead of separate authority/source/export reads. This is a narrow G6 prerequisite, not session orchestration or budget acceptance. Six strict adapters and their remaining timing-hook migration are still pending. Shared hashGate now gates native hash or before-hash once and restores both hooks; remote-preference active-hash race moved to normalizationPause with an explicit fired assertion.

Performance work: count-only canonical/ordered JSON reuses the original structural traversals but directly counts quoted UTF-8 in bounded128-unit scans. Codec validation no longer emits discarded canonical frames; commit-window validation reuses its measured canonical byte count instead of recounting. Escape-free quoted fragments reuse their scan for UTF-8 accounting. Expected target record fragments feed hashing and comparison together, rather than serializing expected records twice; identical initial-fold checks share the same comparison. Full UTF-16/surrogate parity and no-serialization regressions were RED/GREEN. Counters decrease only for removed work; frame bytes, hashes, validation policy and global quanta remain unchanged.

The user approved splitting compound consumer/scenario tests without changing fixtures/assertions/timeouts, explicitly rejected timeout increases, and approved both direction and written specification of the64-unit fragment amendment above. No additional fixture shrinking was done in this checkpoint. Existing I4 success cases and I3 private-evidence tampering were split by consumer; migrated-edit reopen, remote mutation and corrupt-proof recovery were separated. New fragment tests cover multi-block SHA accounting and65-unit producer rejection in counting/comparison/hashing; hasher193-byte rejection preserves input/state.

Latest verification:1226 tests/21 files PASS49.19s (document/normalized suites excluding migration, plus canonical/preparation/validation/recovery/loader),30 selected-admission/adapter/fused-target/boundary checks PASS16.65s. After adding three overflow regressions, work195/195 PASS1.25s. Earlier fragment/hash281/3 PASS4.45s and codec/proof186/2 PASS15.61s are overlapping evidence, not additive unique totals. Build `task-11b-g5c-selected-fragments-build-01` PASS13.20s/2467modules; typecheck sole known Sticker Press TS2339. Audit47 authorized paths,61/81 original blobs retained; HEAD/index/whitespace/protected receipts intact. A requested read-only reviewer could not launch because its configured `haiku/` model was unavailable; no external review acceptance is claimed.

**Blocking regressions remain:** unchanged32MiB test timed out at360000ms; fold self-eviction passed in the same397.54s command. The80-template hash/observer case still exceeds5000ms, and the canonical-source cutover/recovery/ancillary compound case also timed out.512KiB generator now passes its original5s limit (3.79s test duration); both exact256KiB staging boundary cases and remote proof-eviction case passed their original limits. Oversized-record and durable-prefix cases need fresh default-limit rechecks. No complete current covering gate is claimed. Prior2446-case recovery gate below predates these changes.

Do not repeat broad runs until remaining performance causes are isolated. The80-template timing probe attributed4.54s of6.38s to one active read: derive2.37s, source hashes0.38s, target hash/comparison0.88s; yield waiting0.105s,112 page transactions, one source derivation/reconstruction/seal. Large-string improvements alone therefore do not close the many-small-record case. The32MiB timeout still needs phase attribution, preferably using small-scale diagnostic probes before another six-minute gate. Diagnostic `--testTimeout` runs are not verification passes. Keep all original limits and stress coverage. No whole-G5c/G6/native/Task11b acceptance, commits, production wiring, preview restart or profile migration.

#### G5c recovery consumer verification checkpoint (historical, before selected integration)

Recovery enumeration/export routing and the measured runtime/count-only optimizations now have a complete connected covering gate:2444 tests/19 files PASS332.47s, with exactly two stress cases selected out because they were independently verified on the same production code. Unchanged32MiB acceptance/refusal test PASS299.30s under its existing360s limit. Fold self-eviction test PASS60.18s under its existing120s limit. Thus2446 cases covered across three commands, not a claimed single unfiltered all-green run.

The nine duplicated oversized-fold consumer/state fixtures were recombined into the original sequential immediate/scalar/count scenario, preserving all good/bad, corruption/restoration, eviction and final rebind assertions. Recombined70000-ASCII-unit version still timed out; the final fixture uses24000 multibyte characters (72000 UTF-8 bytes) and explicitly proves its ID alone exceeds64KiB. It therefore retains the oversized UTF-8 proof condition with less unrelated UTF-16 traversal and fixture setup; no production budget, fault assertion or test timeout was relaxed. I1 and initial-preference I3 consumer splits remain.

Build `task-11b-g5c-recovery-integration-build-01` PASS11.44s/2467modules. Typecheck only known `tests/unit/gallerySamples/stickerPress.test.ts(793,36)` TS2339. Audit47 authorized paths,61/81 original blobs retained, HEAD/index/whitespace/protected receipts intact. This supersedes timeout/stress blockers in the historical notes below. Remaining G5c: selected-scope admission reuse, eight strict one-shot Work adapters and hash/pause timing-hook migration. G6 session orchestration/cumulative budgets and native browser evidence remain pending; no whole-G5c/Task11b acceptance, production activation, profile migration or commits.

#### G5c sealed active/retained read checkpoint (historical integration notes)

**Follow-up: focused timeout closure and count-only UTF-8 work.** I4 after-cutover diagnostic completed in5.29s with six sealed reads, no retries. Its identity-allocation fixture now omits unrelated text elements while preserving every collision ID, source category/wrapper, fault and byte-preservation assertion; explicit nonempty project/preset/import assertions added. All18 I4 cases passed32.80s at original timeouts. The durable-prefix test likewise retains all80 templates and exact64-record interruption but omits repeated artwork; final isolated check PASS6.63s (test4.06s). Default rich fixtures and maximum-size tests are unchanged. Before the following helper optimization,72 smaller adversarial cases passed66.66s and106 algorithm/reservation/fencing/layout cases passed54.18s.

Raw UTF-8 measurement unnecessarily used serialization framing and encoded each16-unit fragment twice. `utf8LengthWork` now counts directly in <=512-unit chunks using fixed1536-byte scratch, with separately charged copy/encoding operations, paired-surrogate-safe boundaries, and unchanged1024-visit/64KiB runtime limits. Serialization frames still emit<=16 units. No source-validation pass or lifecycle check removed. Counter totals reflect less actual work: count-only encoding contributes bytes once rather than the old two encodings; raw logical byte totals remain identical. RED8192 encoder calls for64KiB versus budget128; then GREEN with native UTF-8 parity across all UTF-16 units and count-chunk surrogate boundaries. Single1MiB raw-weight probe245.29→74.80ms (~3.3x), visits3276849→2099241, identical1048599 logical bytes; not browser/whole-suite performance proof.

Post-optimization verification:393 work/canonical/loader/recovery/worker tests PASS7.80s;27 routing/I4/prefix tests PASS40.37s;21 focused boundary tests PASS16.82s. Build `task-11b-recovery-count-build-01` PASS11.10s/2467modules. Typecheck only known Sticker Press TS2339 after correcting a fixture-only unknown-value loop. Audit47 paths,61/81 prior blobs retained, HEAD/index/protected hashes and whitespace intact. Combined remaining-case run was terminated at240s without a final result; existing32MiB stress case has its own360s allowance and remains unverified. Full/stress gates and remaining G5c/G6 work are still pending. Fast development runs select smaller cases; do not silently remove stress coverage or claim full acceptance.

**Recovery integration / CPU checkpoint (not group acceptance):** Recovery enumeration/export now use authentic shared lifecycle runtimes and sealed retained/combined active reads. Eight routing regressions cover selector capture, failure isolation and cancellation. Existing I1/I3 compound tests were separated by consumer/state with assertions and timeouts retained; this improved failure isolation, not total suite speed. Full integration remains unverified: I4 after-cutover archive reuse still exceeds its existing 5000ms limit. Do not repeat the full suite while diagnosing this case.

CPU profiling of historical scalar retained-recovery/node-corruption found generic counter dispatch dominated self time (653ms). Fixed-property updates for checks/visits/emittedBytes preserve every guard, operation cost, phase attribution and yield. Bounded UTF-8 byte counting now uses one module-private 48-byte scratch buffer with encodeInto rather than allocating arrays for every <=16-unit fragment; scratch never escapes or grows with input. New tests cover counter metric aliases and in-operation phase changes, all UTF-16 code units plus paired/unpaired surrogates, and zero allocating encoder calls. Allocation test RED8196 calls, then GREEN. Existing I4 referenced ':3' case RED timeout, then GREEN without changing its test.

Same single-case CPU probe measured 2.94s before, 2.18s after counter specialization, 1.96s after both changes (~33% end-to-end reduction in this diagnostic case, not a whole-suite/native-browser guarantee). Probe `/tmp/opencode/recovery-cpu.config.mjs` instruments in memory; no production probe code. Final focused checks:260 runtime/recovery/worker tests PASS8.68s;9 routing/I4 cases PASS12.89s;21 relevant architecture/boundary cases PASS17.46s. Build `task-11b-recovery-cpu-build-01` PASS11.19s/2467 modules. Typecheck retains only known Sticker Press TS2339. Audit47 authorized paths,61/81 original blobs retained; HEAD/index/whitespace/protected receipts intact. Full gate, selected admission reuse, one-shot adapters/hook migration and G6 remain pending. No timeout changes, commits, profile migration or preview restart.

Added `readActiveSnapshot(work?)`, `readRetainedSource(work?)` and session `reopen`. Active discovery avoids payload reads for absent/nonactive marker. Active mode builds actual target views once, fuses unconditional migration-baseline and conditional document/fold anchors into baseline streaming, reconstructs each actual project once, and reuses it in shared `verifyBulk` rules. Work-aware manifest/current-core/selected-postcondition hashing preserves ordinary native hash behavior. Both retained windows, both-floor filtering, stable ordering, independent physical folds and exact-stamp core checks remain shared rather than copied into a second admission policy.

Active reads validate live workspace/presets/imports and seal all fourteen stores before returning coupled authority/snapshot/source metadata. Retained reads select the complete seven-store unmarked, three-store historical-reserved, or four-store fresh-reserved dependency set from validated marker metadata; marker/capture agreement and final readonly seal protect the chosen set. Unused live ancillary/target corruption cannot suppress valid retained exports. Empty unreserved fresh storage is not advertised as retained. Default read runtimes are owned/disposed; provided runtimes stay caller-owned; no cached editing authority is introduced.

Added27 tests. Initial missing-API RED2; new-path coverage includes authenticated document/preference/both edits, document baseline after preference-only proof, physical-fold digest and initial-fold anchors, missing fold evidence, immutable migration baseline, asymmetric34-preference eviction, thin-store native-read spy, live ancillary validation, retained fresh ancestry, late mutation seals, cancellation and metadata-only discovery. New eviction integration case has30000ms allowance from introduction; no existing timeouts changed. Controller found idle close entry bypassing runtime latch/cleanup (RED1); runtime-first guarded entry fixes it. Read-only review found phase-setting guard failure outside operation finally retained8361 logical bytes and left busy set (RED1); phase change moved inside try/finally, independently rechecked passing. No remaining scoped findings; no formal whole-G5c/Task11b acceptance.

Final covering19-file command **2399 tests PASS494.42s**. Build `task-11b-g5c-sealed-reads-build-01` PASS10.71s/2467modules; tsc sole baseline Sticker Press TS2339 at793:36. Audit46 authorized paths,62/81 prior blobs retained, HEAD/index/whitespace/protected hashes intact. Boundary unchanged. Existing native active/source paths remain independent oracles. Remaining integration: selected-scope admission reuse, recovery enumeration/export routing, eight strict one-shot Work adapters and timing-hook migration, then G6 orchestration and cumulative/native gates. No commits, profile migration, preview restart or production activation.

### Approved connected G5c/G6 execution order

User approved implementing remaining strict adapters and G6 while keeping the80-template5000ms timeout open, rather than demanding intermediate performance closure first. Follow the existing strict-adapter contracts and G6a/G6b steps below; correctness checks remain mandatory throughout. Track measured read/derivation/staging and lifecycle budgets; retain every original timeout/fixture and distinguish diagnostic runs from acceptance. Re-run original performance gates after integration and profile remaining active-read cost if needed. This is not permission to mark G5c/G6 accepted or wire Tasks12/13 early. Inline controller implementation, no commits or handoffs.

### Group 6a — normalizer lifecycle, exact fences and bounded recovery

#### Connected integration checkpoint — implemented paths, budget gate RED

The remaining six strict adapters now delegate to bounded private session-context operations. Source reads use an independently sealed retained/source capture with an explicit fresh policy; unreserved fresh seeds remain speculative. Staged reads clone the caller marker before suspension, validate a fresh complete candidate/prefix, reconstruct the selected project, and seal before returning. Verification/activation reuse the independently captured transition path. Reservation detaches and revalidates caller source/digests/snapshot, supplies only that validated raw seed on an empty fresh capture, and shares the atomic reservation seal; staging detaches marker/payload together, checks original record/byte limits, independently derives the existing prefix, compares each supplied record against a fresh target cursor, then performs marker-CAS staging. No cross-call session/cache.

New strict-adapter regressions were RED8 (no bounded seal/race hook), then GREEN; one new race fixture needed its projects read explicitly because default physicalRows contains only normalized stores. Historical/fresh reserve+stage regressions were RED2 then GREEN. Existing concurrent-reservation regression exposed a genuine compatibility loss: a torn paged capture could reject the second identical reservation. Added at most8 independently captured retries inside the same detached-input strict call, retaining accumulated counters. Restored the existing `Orphaned normalization target` error for leftover target rows. These strict-call retries do not replace the normalizer's invocation-level retry policy.

Normalizer now owns/borrows one authentic runtime, composes signal/owner/legacy-generation guards, uses preparation/reserve/stageNext/verify/activate/reopen on one session per attempt, and recreates a session after historical prerequisites or contention. No full-target array, per-project staged reread, per-batch legacy recapture or duplicate active export remains in orchestration. Discovery raw strings have an explicit lifetime reservation derived from the three measured equal captures (conservative if capture retries occurred); release is guaranteed on exit. All final progress/Work notification precedes a quiet exact legacy fence. Cancellation returns unavailable with no recovery enumeration. Recovery uses the same runtime without resetting counters, but the separate failure-recovery delta/report and G6b representation/hash-category accounting still need completion.

Migrated native-hash timing tests to before-hash pauses; kept fired assertions and source/target/stale-marker outcomes. Transaction/hash guard now instruments real incremental SHA update/finish calls rather than inducing unused native hashes. Coupled publication test now observes the actual session reopen seal and prohibits public rereads. Added exact normalizer runtime/legacyTypes import grants with negative repository-construction and jsonWork import probes; no directory-wide grant.

**Deterministic budget blocker:** the full-path test reports sourceDerivations4, legacyCaptures5/legacyReads60, ownedBytes0, borrowed runtime still usable; already-active invocation has2 captures/1 source derivation/ownedBytes0. However targetDerivations is **5**, not required4: preparation, staging cursor emission, verification, activation, reopen. The target assertion remains failing (soft assertion only so remaining lifecycle/active-path assertions still execute); no counter removed, fixture changed or budget relaxed. Read-only scoped review confirms this P1 and reports no additional scoped correctness findings; it did not run tests. Reconcile the preparation/emission architecture before acceptance, not by treating the fifth pass as free.

Latest verification:1231 tests/21 files PASS51.05s excluding migration; final29 strict/race/fresh/lost-ack/coupled/cancellation cases PASS41.20s; architecture24 PASS17.19s (913 unselected). Earlier34 adapter/session cases passed before later orchestration edits, not a current covering gate. Final focused failure command confirms target budget5-versus4 and unchanged80-template5000ms timeout. The prior32MiB346.35s pass predates this integration and is no longer current acceptance evidence; do not rerun it until budget/design and gate strategy are sound. Migration639 cases, boundary937. Build `task-11b-g5c-g6-session-integration-build-01` PASS11.19s/2467modules; typecheck sole known Sticker Press TS2339. Audit47 authorized paths/61-of81 original blobs retained; HEAD/index/whitespace/protected receipts intact.

G5c/G6 not accepted. Remaining: target-pass conflict, full original fault/recovery matrix, actual physical/raw/frame byte reconciliation, hash categories and failure-recovery accounting, removal/review of now-unused legacy one-shot helper chains, original stress/timing gates and native evidence. No commits, deployment, preview restart, profile migration or Tasks12/13 wiring.

**Files:** S27/S19/S26; T14/T02. Depends G5c. Coordinator source unchanged: its existing `assertCurrent` closure is the owner/epoch fence. `NormalizationEnvironment` gains optional `work?: WorkRuntime` for private injection/testing. Normalizer always adds its own composed signal/epoch guard with `work.addGuard(current)`; an injected runtime cannot replace that guard. Default runtime uses G2a's owned real-task scheduler and no public progress transport.

- [ ] Add T14 REDs:

```ts
it('uses five stable legacy captures regardless of project or batch count', async () => {
  const h = await boundedHarness(4, 80); h.session.dispose();
  const w = makeWorkHarness('discovery');
  const result = await normalizeWorkspace({ repository: h.repository, historical: h.historical,
    ensurePhysicalLayout: () => h.adapter.open(), work: w.runtime });
  expect(result.status).toBe('active');
  expect(w.runtime.snapshot().legacyCaptures).toBe(5);
  expect(w.runtime.snapshot().legacyReads).toBe(60);
  expect(w.runtime.snapshot().sourceDerivations).toBe(4);
  expect(w.runtime.snapshot().ownedBytes).toBe(0);
  const again = makeWorkHarness('discovery');
  expect((await normalizeWorkspace({ repository: h.repository, historical: h.historical,
    ensurePhysicalLayout: () => h.adapter.open(), work: again.runtime })).status).toBe('active');
  expect(again.runtime.snapshot().legacyCaptures).toBe(2);
  expect(again.runtime.snapshot().sourceDerivations).toBe(1);
});
it('does not start recovery enumeration after task cancellation', async () => {
  const h = await boundedHarness(2, 90); h.session.dispose();
  const controller = new AbortController(); const w = makeWorkHarness();
  setTimeout(() => controller.abort(), 0);
  const retained = vi.spyOn(h.repository, 'readRetainedSource');
  const result = await normalizeWorkspace({ repository: h.repository, historical: h.historical,
    ensurePhysicalLayout: () => h.adapter.open(), signal: controller.signal, work: w.runtime });
  expect(result.status).toBe('unavailable');
  if (result.status !== 'active') expect(result.normalizationExports).toEqual([]);
  expect(retained).not.toHaveBeenCalled(); expect(w.runtime.snapshot().ownedBytes).toBe(0);
});
```

Keep existing final-active progress callback that changes legacy with constant generation; it must still refuse. Add onWork observer that throws, and one that changes epoch during long-string framing; exception isolation must not suppress following lifecycle checks. Extend existing coordinator disposal/epoch tests using real task scheduling, not Promise.resolve. No new worker request family.

- [ ] RED/GREEN:

```bash
NO_COLOR=1 FORCE_COLOR=0 TMPDIR=/tmp/opencode node /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/node_modules/vitest/vitest.mjs run /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/normalized/migration.test.ts /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/normalized/workspaceWorker.test.ts /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/recovery.test.ts --silent --reporter=dot
```

Expected RED: work not threaded, per-batch recaptures, repeated active export or cancellation recovery scan. Replace S27's run algorithm, preserving typed result/error mapping and retry reason:

```text
normalizeWorkspace(env):
  work = env.work ?? createWorkRuntime({assertCurrent: () => {}})
  assertWorkRuntime(work); ownsWork = env.work === undefined; layoutAvailable = false
  expectedLegacyGeneration initially undefined
  current = assert signal not aborted; env.assertCurrent?.(); if expectedLegacyGeneration is set,
    require historical.currentGeneration() == expectedLegacyGeneration or throw AbortError
  removeGuard = work.addGuard(current)
  try up to EIGHT attempts (count each retry after first; never reset accumulated work):
    session = repository.openNormalizationSession(work)
    try:
      emit discovering (observer exceptions isolated), current
      await work.wait(ensurePhysicalLayout); layoutAvailable=true
      discovery = await historical.captureObservedLegacy(current, work)   // fence 1
      expectedLegacyGeneration = discovery.generation; current()
      hold exact discovery raw/presence/digest/generation through this attempt
      info = await session.prepare({allowFresh: !anyPresentLegacyKey(discovery.snapshot)})
      if historical-admission-required:
        dispose session; run historical.bootstrap(...,{allowCopiedReplacement:false,work})
        non-admitted -> existing nonready outcome; else drop unused admitted result and fresh session.prepare({allowFresh:false})
      if prepared fresh AND discovery has any present key: refuse (defensive; allowFresh already prevented it)
      if info.state == 'active':
        active = await session.reopen(); require active; compare SourceInfo with discovery
        emit all final progress (active + numeric work notification)
        await work.quiet(() => exactLegacyFence(discovery,current,work))  // fence 2
        current; return active result using active.snapshot (NO export reread)
      require historical acceptedLegacyDigest == discovery.digest, or fresh all keys absent
      await exactLegacyFence(...)                                      // fence 2 pre-reserve
      attempt = await session.reserve(); current
      while attempt.state == 'staging' && attempt.nextRecord < attempt.recordCount:
        attempt = await session.stageNext(); current
        emit staging numeric progress; original after-stage checkpoint; current
      if attempt.state == 'staging':
        emit verifying; await exactLegacyFence(...)                    // fence 3
        attempt = await session.verify(); current; after-verify checkpoint; current
      emit activating; await exactLegacyFence(...)                     // fence 4
      await session.activate(); current; after-cutover checkpoint; current
      active = await session.reopen(); require active
      emit all final progress; release all session preparation/capture data
      await work.quiet(() => exactLegacyFence(...))                     // fence 5
      current; return active result with this verified snapshot
    catch normalization-contention:
      dispose all attempt-owned state; retry from durable facts (no cursor adoption)
    catch cancellation/owner loss:
      existing unavailable/typed nonready mapping; normalizationExports=[]; NO new scan
    catch other error:
      existing typed mapping; if layoutAvailable and runtime still current, separately budgeted recovery enumeration
    finally: session.dispose(); release discovery baseline; no observer after final fence
  after retry exhaustion: typed verification-failed; recovery only with valid runtime
  finally: removeGuard(); dispose runtime if created here; no new persistence or progress callback
```

`exactLegacyFence(discovery: ObservedLegacyCapture, current: () => void, work: WorkRuntime): Promise<void>` is the local closure: set legacy-fence context; current(); await `environment.historical.captureObservedLegacy(current, work, discovery)`; current(); return. Generation/digest/**exact raw/presence** equality is performed inside G3e's final native tail. No cached digest or epoch-only shortcut. Its final invocation suppresses progress observers throughout capture/hash so nothing runs after the last source equality check that could mutate source before publication. Counters still accumulate and remain inspectable numerically through the injected runtime after completion; quiet does not discard work. Cheap currentGeneration checks run at every lifecycle guard after discovery; constant generation still requires exact phase fences. Check current after checkpoint callbacks too; they are fault hooks, not passive progress. Keep layoutAvailable=false until physical layout actually opens, so unavailable/blocked initial open does not trigger recovery reads.

Define local `anyPresentLegacyKey(snapshot: LegacySnapshot): boolean` as `LEGACY_DOCUMENT_KEYS.some(key => snapshot[key].present)`, a fixed four-entry metadata check. S27 imports that constant/type from legacyTypes; T02 adds exactly S27→legacyTypes, alongside S27→S02. S27 needs no S07 runtime import. After any session operation rejects, session latches closed and disposes its owned data before rethrowing; callers must create a fresh session even after lost acknowledgement. Numeric write counters distinguish issued requests from committed stageRecords: note committed counts on transaction complete before an after-commit fault can suppress acknowledgement; notify observers only after fault/current checks succeed.

Uncontended new path has five captures; resumed verified path may skip verification fence and has fewer, never more because of B/P. Historical prerequisite capture/repair work is tagged `prerequisite` and separately added to totals; tests above pre-admit fixtures to isolate main-path budget. The four raw legacy strings retained for exact discovery comparison are explicit L-sized fence ownership, not another parsed workspace/image; release them on every attempt exit. Native capture/clone temporaries are later measurement gates. Do not erase this cost from logical highwater accounting.

Recovery after cancellation chooses the approved **no unverified selectors** branch. Independent explicit recovery calls create a new valid bounded runtime, keep retained historical exports available after target corruption, and never claim staged current authority. No speculative fresh-seed export.

- [ ] GREEN command. T02 updates only S27→S02/legacyTypes and already approved repository type use; no worker/facade/adapter constructor import. The coordinator normalizer import itself is unchanged. Keep its exact AST-context mutation-negative probes, not a blanket grant.

### Group 6b — actual-work accounting, full fault matrix and cumulative gate

**Files:** T14/T16/T03/T02 only unless a preceding implementation fails its own contract (fix in its already listed source path, record owning group). Depends G6a. No unrelated performance tuning/cleanup.

**Independent physical-read probe in T16:** use Vitest spies on real IDB request APIs, not repository method counts. Install only after `boundedHarness` finishes prerequisite setup; restore before fixture inspection/oracle reads. No test.concurrent for these global prototype spies.

```ts
import { vi } from 'vitest';
export function probePhysicalReads(databaseName: string) {
  const totals = { rows: 0, bytes: 0, eof: 0, getAllCalls: 0 };
  const encoder = new TextEncoder();
  const count = (value: unknown) => {
    if (value === undefined || value === null) return;
    totals.rows++; totals.bytes += encoder.encode(JSON.stringify(value)).length;
  };
  const cursor = IDBObjectStore.prototype.openCursor;
  const get = IDBObjectStore.prototype.get;
  const all = IDBObjectStore.prototype.getAll;
  const cursorSpy = vi.spyOn(IDBObjectStore.prototype, 'openCursor').mockImplementation(function (...args) {
    const request = cursor.apply(this, args);
    if (this.transaction.db.name === databaseName) request.addEventListener('success', () => {
      if (request.result) count(request.result.value); else totals.eof++;
    });
    return request;
  });
  const getSpy = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (...args) {
    const request = get.apply(this, args);
    if (this.transaction.db.name === databaseName) request.addEventListener('success', () => count(request.result));
    return request;
  });
  const allSpy = vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementation(function (...args) {
    const request = all.apply(this, args);
    if (this.transaction.db.name === databaseName) {
      totals.getAllCalls++;
      request.addEventListener('success', () => { for (const row of request.result) count(row); });
    }
    return request;
  });
  return { totals, stop: () => { cursorSpy.mockRestore(); getSpy.mockRestore(); allSpy.mockRestore(); } };
}
```

This probe's bytes are complete physical-value JSON UTF-8, not encodedSize or native heap. Production `candidateBytes/sealBytes/metadataBytes/markerBytes` use the same physical-value size definition through bounded ordered JSON counting, including all envelope fields; frame/hash bytes remain separate. In a successful exact seal the candidate's independently computed byte weight is reused only after full current-row equality; mismatches are counted as rows/primitive failures, never assigned a trusted declared size. On malformed non-JSON rows, count materialization/error boundaries without fabricating byte sizes. Valid acceptance-budget fixtures must have full measured bytes. EOF is not a returned row.

**Independent hash probe:** in T14 import the S01 module namespace, retain its original factory, spy on `createNormalizationSha256` to return the original instance with `update(bytes)` wrapped to sum bytes.length, then delegate. It must not compute alternate digests or receive whole frame strings. Restore in finally. Assert this total equals runtime.hashBytes including final quiet legacy capture. This catches accidental uncounted hashes; keep the existing zero-write-transaction hash assertion around actual updates and finish.

- [ ] Concrete full-path budget test:

```ts
it.each([[1, 220], [4, 55], [8, 28]])('counts actual work for %i projects/%i templates', async (p, t) => {
  const h = await boundedHarness(p, t); h.session.dispose();
  const w = makeWorkHarness('discovery'); const probe = probePhysicalReads(h.databaseName);
  let result: Awaited<ReturnType<typeof normalizeWorkspace>>;
  try {
    result = await normalizeWorkspace({ repository: h.repository, historical: h.historical,
      ensurePhysicalLayout: () => h.adapter.open(), work: w.runtime });
  } finally { probe.stop(); }
  expect(result!.status).toBe('active'); const c = w.runtime.snapshot();
  const rows = await physicalRows(h, [...historicalStores, ...NORMALIZED_STORE_NAMES]);
  const flat = Object.values(rows).flat(); const n = flat.length;
  const bytes = flat.reduce((sum, row) => sum + new TextEncoder().encode(JSON.stringify(row)).length, 0);
  expect(c.sourceDerivations).toBe(4); expect(c.targetDerivations).toBe(4);
  expect(c.candidateRows + c.sealRows).toBeLessThanOrEqual(8 * n);
  expect(c.candidateBytes + c.sealBytes).toBeLessThanOrEqual(8 * bytes);
  expect(probe.totals.rows).toBe(c.candidateRows + c.sealRows + c.metadataRows + c.markerCasRows);
  expect(probe.totals.bytes).toBe(c.candidateBytes + c.sealBytes + c.metadataBytes + c.markerBytes);
  expect(probe.totals.getAllCalls).toBe(0);
  expect(c.legacyCaptures).toBe(5); expect(c.legacyReads).toBe(60);
  expect(c.stageTransactions).toBeGreaterThan(1);
  expect(c.markerCasRows).toBe(c.stageTransactions);
  expect(c.ownedBytes).toBe(0); expect(c.captureHighWater).toBeLessThanOrEqual(1);
  for (const phase of ['verify', 'activate', 'reopen'] as const)
    expect(w.runtime.snapshot(phase).projectReconstructions).toBe(p);
});
```

`markerBytes` counts **marker CAS read bytes**, not puts or repeated comparison operands; `markerWorkBytes` separately counts complete marker comparisons/clones/writes. Never mix it into physical read sum. B×M remains explicit. `metadataRows/metadataBytes` includes point-read markers/ledger; store count/EOF requests are separate. Snapshot returns numeric metrics after final quiet fence and disposal; do not call a late observer to obtain them.

- [ ] Add an independent frame budget oracle in T14 using these exact current string expressions (test-only whole strings allowed):

```ts
const utf8 = (s: string) => new TextEncoder().encode(s).length;
const envelope = (label: string, value: object) => `[${JSON.stringify(label)},{${Object.entries(value)
  .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  .map(([key, item]) => `${JSON.stringify(key)}:${canonicalStringify(item)}`).join(',')}}]`;
const list = (label: string, values: readonly object[]) => `[${JSON.stringify(label)},${values.map(v => envelope('envelope', v)).join(',')}]`;
```

Before enabling probes, obtain a strict source once and old `prepareNormalizationTarget(source)` as independent fixture expectations. Compute Dsrc by summing UTF-8 lengths of the **distinct required frames**: each normalization-project envelope; normalization-content literal from S25:301; normalization-source literal from S25:302; each legacy-backup snapshot envelope from S06:100–108; each backup envelope; expected normalization-archive literal from S25:326. Build expected archive directly from source records using original sourceKind/ledger/seed, projectMetadata order, backupDigests and D7 ID rule (not a second production preparation call). Compute Dtgt from `['normalization-target-v1', ...recordFrame strings]` using the literal existing comma grammar. Assert sourceHashBytes ≤4×Dsrc, targetHashBytes ≤4×Dtgt; initial active Dproof is each current fold record frame once per project, proof work counted separately. Verification marker hashes are markerHashBytes, actual legacy fences are legacyHashBytes; backup snapshot validation belongs to **sourceHashBytes**, not legacy-capture counters. Assert total actual hash bytes equals the sum of six categories. No B×Dsrc or P×Dtgt allowance.

Concrete oracle body (T14 imports existing NormalizationSource and NormalizationSourceArchive types, LEGACY_DOCUMENT_KEYS and node createHash):

```ts
function frameBudget(source: NormalizationSource) {
  const hash = (text: string) => createHash('sha256').update(text).digest('hex');
  const ids = new Set(source.backups.map(row => row.id));
  const base = `normalization-source:${NORMALIZATION_LEDGER_ID}`; let id = base;
  for (let suffix = 1; ids.has(id); suffix++) id = `${base}:${suffix}`;
  const common = { id, kind: 'normalization-source' as const, formatVersion: 3 as const,
    workspace: source.records.workspace, presets: source.records.presets, pendingImports: source.records.pendingImports,
    projectMetadata: source.records.projects.map(({ project: _project, ...metadata }) => metadata),
    backupDigests: source.backups.map(row => ({ id: row.id, digest: hash(envelope('backup', row)) })) };
  const archive: NormalizationSourceArchive = source.kind === 'historical'
    ? { ...common, sourceKind: 'historical', ledger: source.ledger! }
    : { ...common, sourceKind: 'fresh', ledger: null, seed: source.records.projects };
  const content = `["normalization-content-v1",${list('projects', source.snapshot.projects)},${JSON.stringify(source.snapshot.activeProjectId)},${list('presets', source.snapshot.customPresets)},${list('imports', source.snapshot.pendingImports)}]`;
  const sourceFrame = `["normalization-source-v1",${canonicalStringify(source.sourceProjects)},${envelope('workspace', source.records.workspace)},${list('presets', source.records.presets)},${list('imports', source.records.pendingImports)},${source.ledger ? envelope('ledger', source.ledger) : 'null'},${list('backups', source.backups)}]`;
  const archiveFrame = `["normalization-archive-v1",${envelope('workspace', archive.workspace)},${list('presets', archive.presets)},${list('imports', archive.pendingImports)},${list('metadata', archive.projectMetadata)},${canonicalStringify(archive.backupDigests)},${archive.sourceKind === 'historical' ? envelope('ledger', archive.ledger) : list('fresh-seed', archive.seed)}]`;
  const backupSnapshots = source.backups.map(row => canonicalStringify({ format: 'doctect-legacy-source', version: 1,
    entries: LEGACY_DOCUMENT_KEYS.map(key => ({ key, present: row.snapshot[key].present,
      raw: row.snapshot[key].present ? row.snapshot[key].raw : null })) }));
  const sourceFrames = [content, sourceFrame, archiveFrame,
    ...source.records.projects.map(row => envelope('normalization-project-v1', row)),
    ...source.backups.map(row => envelope('backup', row)), ...backupSnapshots];
  const target = prepareNormalizationTarget(source);
  const targetFrame = `["normalization-target-v1",${target.map(item => frameRecord(item.store, item.record)).join(',')}]`;
  expect(hash(content)).toBe(source.contentDigest); expect(hash(sourceFrame)).toBe(source.sourceDigest);
  return { Dsrc: sourceFrames.reduce((sum, text) => sum + utf8(text), 0), Dtgt: utf8(targetFrame) };
}
```

In each budget case, calculate `const budget = frameBudget(await h.repository.readNormalizationSource())` before installing probes/new work runtime, then assert the two hash-category ceilings against budget after the run. This oracle is test-only; its whole strings/target array must not appear in production. Add an archived-recovery regression after activation: replace a live preset with malformed non-JSON-compatible content while leaving recorded archive/projects/backups untouched; retained source still exports original presets, active read fails. This pins the thin retained dependency-set policy rather than accidentally requiring healthy current ancillary data for historical export.

Keep B×M explicit by asserting `markerWorkBytes >= markerBytes` and by constructing large sourceProjects/identifier metadata (e.g. 40 projects with 1024-character IDs) while holding payload totals similar. No new historical ID cap. A legal >256 KiB record stages alone; existing 32 MiB correctness fixture remains, with no new physical-record cap. Sorting comparisons/code-unit work appears separately in counters, not an unexplained linear complexity claim.

**Required deterministic fault/cancellation table**, all with fresh typed recovery/resume and zero logical owned bytes after exit:

| Boundary | Injection and exact assertions |
| --- | --- |
| Source validation; canonical long value; key comparison; target preparation | `setTimeout(abort,0)` on sufficiently long string/wide object; assert real task ran, no later effect/write after guard observed abort; no reservation before pre-reserve fence. |
| Verification/fold hash/reopen | Use Work event phase plus first real task to abort/lose coordinator epoch; never return active result; no new recovery scan; active marker may remain if already committed. |
| One-row materialization / exact row compare | Count native exception and guard calls around it; cancellation observed only before/after the primitive, never claim interruption inside it. |
| Every candidate/seal transition | G5c torn matrix, including insertion behind cursor, wrong physical key, ancillary/archive mutation and exact-restoration controls. |
| Every original reservation/stage/verify/cutover durable fault point | Existing quota/clone/abort/versionchange/termination/lost-ack assertions retained. One archive/attempt; atomic old/new prefix/phase, fresh invocation inspects committed facts. |
| New after-page and before-seal hooks | Throw QuotaExceededError/DataCloneError/AbortError, forceCloseDatabase/versionchange via existing harness, or dispose captured coordinator; no false readiness or retained-copy proliferation. |
| Caller mutation while one-shot preparation awaits | Existing source/attempt/batch mutation fixtures retained; output must reflect pre-await clone or reject, never accept modified caller proof. |
| Observer throw / source or epoch mutation | Throw isolated; mutation detected by next guard/fence; final callback precedes quiet final capture. Event JSON contains only fixed enum strings, field names and numbers. |
| Retry exhaustion and cancellation | Exactly eight contention attempts, retries counted across failures; no ninth write plan; stopped runtime has empty normalizationExports. |

- [ ] Run new budget assertions before making any source correction in this group. Missing accounting or repeated-pass behavior must fail the actual row/hash assertions, not be normalized away. If prior test-first groups already satisfy a new independent probe, record initial GREEN as added verification, not fabricated RED; retain prior groups' raw failing evidence. Run targeted budget cases first:

```bash
NO_COLOR=1 FORCE_COLOR=0 TMPDIR=/tmp/opencode node /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/node_modules/vitest/vitest.mjs run /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/normalized/migration.test.ts -t 'counts actual work|five stable legacy|recovery enumeration' --silent --reporter=dot
```

- [ ] GREEN full migration suite, then all cumulative regressions/typecheck/build below. Controller reviews all 15 sequential assignments (G1, G2a/b, G3a–e, G4a/b, G5a–c, G6a/b), not just G6b. Preserve the fresh Task11b dirty baseline; no recapture, staging or commits.

## Critical algorithms referenced by all implementation groups

These algorithms are requirements for the executable groups, not optional alternatives. No group may leave a whole synchronous helper inside one work quantum.

### Canonical/framing/work cursor constraints (G2b)

Source seams and helper names are S04/S05/S06/S07/S24. The shared protocol above is their only cooperative work vocabulary.

Required state machine, not a whole-helper wrapper:

1. Maintain explicit traversal stack and ancestor set. A value-entry step handles one scalar or enters one container at its existing depth. Scalars are processed before the container-depth test, preserving current depth semantics. Container at depth 512 is legal; container at 513 is not. Container descendants increment depth; each `frameRecord` own field starts canonical traversal at depth 0.
2. Enumerate own keys as a counted native primitive with checks immediately around it; scan returned keys/descriptors one at a time. Reject symbols/accessors/custom prototypes/hidden object fields without invoking getters. Array acceptance remains dense indexed data, exact own-key count `length + 1`, and an own `length` key. Do not introduce an enumerable-index restriction absent from the old canonical API. Leave ancestor set on container exit, not globally, so shared acyclic subobjects remain legal.
3. Sort object keys with bottom-up stable merge traversal. State is `(runWidth, leftStart, leftIndex, rightIndex, outputIndex, compareOffset)`. Compare UTF-16 code units one at a time, charging each inspected code unit; equal prefixes resume at `compareOffset`. If one string ends, shorter sorts first. Equality selects left entry. Charge each key-array movement separately; swap source/destination arrays after each merge width and release old scratch at completion. No `.sort()` or full-string comparison hidden as one visit in cooperative sorting. Numeric position sorting uses the same merge movement accounting with scalar numeric comparator.
4. String cursor retains UTF-16 offset and pending ≤6-character escape/≤4-byte code-point output. Emit quotes separately. Escape `"`, `\\`, backspace/tab/LF/FF/CR with current short escapes; other U+0000..001F with lowercase `\\u00xx`. Paired surrogates form a four-byte UTF-8 code point; lone surrogates in JSON become lowercase `\\udxxx` escape text. Raw UTF-8 strings use U+FFFD for lone surrogates, matching TextEncoder. Do not split a pair without retaining carry. U+2028/U+2029 stay literal. Finite-number primitive rendering remains JSON.stringify(number), with `-0` → `0`. Arbitrarily long strings/keys are never escaped as one application step.
5. Before each next graph/string/sort/hash step, reserve its visit/output-byte cost. If it would exceed 1,024 visits or 65,536 emitted UTF-8 bytes, flush bounded buffer, lifecycle-check, emit isolated numeric observation, lifecycle-check, `await` a real `setTimeout(..., 0)` task (or injected genuine task scheduler), lifecycle-check, then reset quantum. Also check before/after every await and at disposal. Hash updates use Group 1's costs, not one visit for a whole frame.
6. Shared synchronous APIs drain the same traversal without scheduling. JSON-order byte counting needed by AppState size and encoded contributions is a distinct mode preserving property enumeration order; canonical mode sorts keys. The generic public validator's JSON.stringify compatibility must not silently become stricter. Normalization inputs may use a prevalidated plain-data traversal, but shared rule extraction must preserve public API behavior.
7. Generate frame grammar as tokens, never joined payload strings. Exact `frameRecord` is `[domain,store,{sorted own fields}]`, where domain is `doctect-normalized-record-v1` or `doctect-normalized-core-v1`; core excludes only `commitProof`/`commitWindow`. `captureFrame` resets depth per own payload field; `captureList` emits a label followed by envelope frames, including its existing empty-list punctuation. Target frame is `["normalization-target-v1",` + comma-separated record frames + `]`. Empty-list behavior must be byte-tested, not “fixed.”

G2b's tests pin exact escaped bytes, sorting, descriptors/cycles, depth and repeated references. G4a/G4b add ordering arrays/raw fold exceptions. Differential tests compare retained golden strings as well as shared synchronous APIs, since changing both implementations identically could otherwise mask a regression. G1 alone tests hashing, not framing rules.

### Shared validation and codec ownership constraints (G3a–G4b)

The table above is the concrete call map. Rule generators live with existing synchronous owners; synchronous APIs drain them and normalization uses WorkRuntime. Preserve first-error ordering and wrapper error categories, including pre-migration validation, reject/retain warning policy, copied-ledger refusal, v1 repair and generator detachment. Loader state transformation and raw normalized storage remain separate.

Native cloning/parsing/key enumeration must be identified and guarded explicitly; application map/filter/reduce/sort/template loops must be stepped. Normalization framing, encoding and size computation use the cursor, not whole-project JSON.stringify disguised as a primitive step. A whole historical helper is never the primitive. Copying a wide object one key at a time must preserve original insertion order and own-field semantics, including safe handling of `__proto__` through data property definition rather than prototype-setting assignment.

Preparation metadata indexes each source project once; a target iterator holds one project image and yields in the current project/store/map order. Metadata pass derives exact count/manifest and required source/archive frames. Emission pass re-creates one project at a time from the owned source and keeps only one bounded batch. Prefix validation compares expected emitted records with independent captured rows by exact store/key membership, marking each once; EOF/membership count must agree. No two complete target arrays or repeated workspace filter per project.

Historical regression files already exist at:

- `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/validation.test.ts`
- `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/migrationPreparation.test.ts`
- `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/bootstrap.test.ts`
- `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/lineageRepair.test.ts`
- `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/drift.test.ts`
- `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace/normalized/codec.test.ts`

G3b/G3c tests cover schema 11 with missing text padding/overflow fields: normalization retains raw source bytes while still executing the same historical load/admission checks. Old-schema tests alone are insufficient.

### Physical candidate/seal algorithm (G5a–G5c)

Only S25 owns normalized IDB reads/writes. Its source stores are `projects`, `workspace`, `presets`, `pendingImports`, `migrationLedger`, `legacyBackup`; target stores are all eight `NORMALIZED_STORE_NAMES`, including `normalizationLedger`. Every authority/prefix candidate and seal covers these **14 stores**, including explicit emptiness. A retained-source-only export uses the exact seven/three/four-store dependency sets defined beside Capture, so damaged unused current data cannot suppress valid archived recovery. Each seal spans its entire fixed relevant set in one transaction.

Required candidate/seal algorithm:

```text
candidate:
  point-read discovery marker only (not a full payload scan)
  for each store in the fixed relevant set (14 for authority; retained source as defined above):
    lastKey = absent; rows = []
    repeat:
      lifecycle check
      open short readonly transaction for this store
      openCursor(lastKey absent ? undefined : IDBKeyRange.lowerBound(lastKey, true))
      capture at most ONE cursor {primaryKey, value}; never continue in this page
      wait for transaction COMPLETE, not merely request success
      lifecycle check
      if no row: record explicit EOF and stop this store
      check strictly increasing primaryKey and envelope key/id agreement
      append owned row, lastKey = primaryKey
      account actual row bytes cooperatively, ignoring untrusted encodedSize
  optional ending marker comparison rejects early contention only
  asynchronously validate candidate; it still has NO authority

seal(candidate, mode, finalWrites):
  lifecycle check; open ONE transaction over the ENTIRE candidate.stores set
  cursor each store from beginning, one row per native request event
  for each event, synchronously:
    lifecycle check
    compare current primaryKey with next captured primaryKey
    compare complete row using previously applicable equality semantics
    reject extra/missing/changed/key-mismatched row; never trust marker/count/hash alone
    lifecycle check; advance cursor
  on EOF: require exact captured end and candidate EOF evidence for that store
  after ALL store EOFs in same transaction:
    lifecycle check immediately before each write
    execute finalWrites synchronously via IDB callbacks only
  on COMPLETE: publish durable progress, lifecycle check, return result
  on ABORT: reject; do not infer anything about a previous committed phase
```

Inside seal, use exact per-record canonical-equivalence comparison where `captureFrame`/`frameRecord` was previously used, and insertion-order-sensitive comparison where archive/content used JSON.stringify equality. No joined workspace frame or second complete capture. Comparison of one physical row is the approved indivisible exception, recorded with guards; never split a seal, await hashing/observation, or issue keepalive requests. Readonly active/export seals use the same physical membership algorithm without writes.

Reservation validates the recorded archive completely before excluding it from historical source CAS. Preserve preferred archive ID and lowest free exact numeric suffix, original historical project rows, one fresh seed, atomic archive+attempt `add`. A fresh/resumed session independently validates its captured prefix once, then releases prefix after reserve seal. Marker advance by another actor is contention: dispose and retry from durable facts, never splice its cursor into preparation.

Stage reads/compares expected complete marker once per batch, adds ≤64 records/≤256 KiB framed payload (or exactly one oversized record), then advances marker in the same transaction. No source/prefix rehash per stage. Retain B×M marker-byte cost explicitly. A source/earlier-target mutation may leave more non-authoritative stage rows until independent verification; it cannot publish active authority.

G5a's `normalizationPause` is the deterministic phase/page/seal hook, separate from sanitized diagnostics. Existing helpers `createNormalizationHarness`, `physicalRows`, `mutateRow`, `freshHarness`, `hashGate` live in T14:34–144. G5c maps every old hash timing hook to a real new asynchronous boundary and retains its assertions.

### Independent verification/current authority constraints (G5c)

Repository evidence: `checkedNormalization` currently nests repeated derivations at 453–460; `capturedProject` scans all stores and reconstructs at 443–451; `activeCapture` reconstructs again via `verifyBulk` at 618/1106–1127. Replace these with one per-pass project index and one reconstruction per project, not one full pass per project.

- Release preparation graph before capturing full independent verification data. Verify actual target membership/keys/envelopes, source/archive, exact baseline/content/order and target manifest; compute existing verification digest; readwrite seal before marking verified.
- Activation independently captures/validates target AND live ancillary source. A prior verified marker is not evidence of current rows. Historical live source must match retained baseline excluding only the validated archive; fresh pre-active source must have the exact permitted empty-store state. Seal before atomic active marker/workspace publication.
- Active read validates fresh physical data and permits valid edited authority. Compare migration baseline regardless of preference proof; compare unedited document baseline despite preference-only changes; initial folds stay source-anchored despite document edits. Advanced preferences require authenticated `foldRecordDigest` and independent physical folds hash. Reuse per-pass proof frame results only within that capture; BOTH-window postconditions, eviction and missing-proof failures remain.
- Perform one coherent readonly seal after off-transaction validation. Return active authority and verified snapshot together; normalizer and recovery use that one result. Independent one-shot calls remain independently validated. Do not retain all project images after forming returned workspace.
- Retained-source exports use a readonly seal too. Preserve strict caller-selector capture-before-await and distinct historical/fresh-seed/active discriminators; staged bytes and speculative fresh seeds are never advertised.

Recovery changes are confined to S26:48–93 normalization functions. Do not rewrite other historical export policies. `readActiveSnapshot` is the combined fresh interface; `readActiveAuthority()` then `exportGeneration()` is not an equivalent optimization.

### Exact orchestration fences and budgets (G6a/G6b)

Existing ordering authority is `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/localWorkspace/normalized/coordinator.ts:31–38`: captured epoch and shared tail. It already supplies `assertCurrent`; a new ordering owner is unnecessary. At 40–46 an accepted incoming envelope can change epoch before its queued operation runs, so repository work calls that existing guard inside long phases. Coordinator stays read-only; no protocol expansion.

Required uncontended sequence in `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/services/localWorkspace/normalized/migration.ts`:

```text
discover: legacy stable capture #1, inspect marker metadata
if already active:
  one fresh combined active read + readonly seal
  check legacy/source-kind match from this validated read
  all final progress callbacks
  stable legacy capture #2 equals discovery; final lifecycle assertion; return
else:
  prerequisite admission/repair if required (separately counted)
  owned session prepare and independent prefix validation
  legacy stable capture #2 equals discovery, reserve seal
  stageNext loop: lifecycle checks and stage observers, NO legacy recapture per batch
  before verification: stable capture #3 equals discovery
  dispose preparation payloads; independent verify candidate + seal
  before activation: stable capture #4 equals discovery
  independent activate candidate + seal
  fresh combined active reopen candidate + readonly seal
  all final progress callbacks
  stable capture #5 equals discovery; final lifecycle assertion; return
finally: dispose session and all owned cursors/buffers
```

Source change that persists through the next fence refuses publication; a change/revert between fences is not promised to be observable. Cheap cancellation/owner-source epoch checks remain at every quantum/await/durable boundary. Throwing passive observers cannot alter result; source/epoch mutation by an observer must be caught by following checks. Final observers precede the last fence. Preserve existing after-stage/after-verify/after-cutover fault semantics.

Eight contention attempts maximum. Failed attempt counters are accumulated, never reset to disguise work. Cancellation/epoch loss returns the existing typed non-ready outcome **without new recovery-selector enumeration under invalid control**; selectors may be omitted. A separate recovery invocation may perform a separately budgeted bounded pass. A committed transaction with lost acknowledgement remains committed; fresh invocation inspects durable phase and must reuse archive/seed.

| Successful uninterrupted segment | Full-set reads | Derivation/reconstruction obligations |
| --- | --- | --- |
| Prepare/resume candidate + reserve seal | ≤2 | One source/target derivation and independent complete-prefix validation. |
| All B stages | Marker CAS only | One further target-emission traversal; no B×source term. |
| Verify candidate + seal | 2 | One source/target derivation, one reconstruction per project. |
| Activate candidate + seal | 2 | One fresh source/target validation; no verified-marker trust. |
| Final active candidate + readonly seal | 2 | One fresh baseline/current-proof admission. |

Total ≤8 full-set payload reads and ≤4 derivation passes; explicit fixed metadata/EOF reads, B×M marker work, sorting/comparison cost, ≤5 stable legacy captures. Count actual rows/bytes and all distinct hash inputs (source, target manifest, current proof, stage payload, marker, legacy), not merely helper calls. Prerequisite repair/admission, retries and recovery/export invocations have separate counters but remain included in totals. No finite bound is claimed across arbitrarily many crashes.

Memory ownership gates: prepare holds source + metadata/index + one project + one batch + bounded hash/frame buffers, plus independent prefix until reserve seal. Verify/activate hold one physical candidate + one reconstructed project; seal adds one current row, not a second workspace capture. Active read necessarily returns a complete workspace. Dispose on every terminal/retry path. Logical ownership high-water counters are not native heap measurements.

## Spec coverage and acceptance gates

| Approved spec requirement | Owning group | Current plan readiness |
| --- | --- | --- |
| §1 session, one writer, strict one-shot APIs, combined read | G5a–c/G6a | Session types, ownership, strict adapter table, combined active/recovery paths and caller-mutation tests specified. |
| §2 byte-identical incremental SHA-256 without install | G1 | Fully executable; no production caller switch yet. |
| §2 resumable canonical/string/sort/validation/codec and shared semantics | G2a/b, G3a–e, G4a/b | Shared before-effect protocol, exact loader map, serialization modes, critical algorithms and concrete parity/cancellation tests. |
| §3 one-row candidate pages, all-store exact seals, readonly export/reopen | G5a–c | Capture/store/EOF types, exact seal algorithm, all fourteen authority stores, exact retained-source dependency sets and torn-candidate matrix. |
| §4 explicit exceptions, legal largest record, depth/size limits | G2–G6 | Preserve as written; no blanket helper exception or native timing claim. |
| §5 single preparation, two traversals, independent prefix resume, archive/seed reuse | G4b/G5a/b | Metadata/hash/prefix fused pass, one emission cursor, disposal on contention, D7 source preservation. |
| §6 five/two legacy fences, cancellation/epoch, passive observers, lost ack | G2a/G3e/G6a/b | Exact orchestration, quiet final fence, latched guards, no cancellation recovery scan; fault/observer cases retained. |
| §7 ≤8 reads, ≤4 derivations, B×M, hash inputs, memory release, sanitized diagnostics | G5a–c/G6b | Actual IDB/hash probes, phase counts, metadata/marker/legacy separation, ownership transfers and numeric-only events. |
| §8 D6/document baseline/fold anchoring/proof windows/ordinary-save budgets | G4b/G5c/G6b | Shared proof admission, independent fold hash, both windows, initial baseline rules; existing full matrix/read budgets mandatory. |
| §9 all retained tests, multi-project/batch, faults/caller mutation, boundary/build/typecheck/review | Every group, cumulative G6b | Exact targeted commands and retained suites; cumulative dirty-baseline review required. |
| §10 integration/native performance/browser gates | Later Tasks12–15 | Explicitly not closed by Task11b or fake-IDB results. |

## Future cumulative verification commands and review gate

All commands run with working directory `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence`. Do not execute any during planning. Use installed executables directly; no install/update implicit in `npx`.

Targeted RED/GREEN commands are attached to every group. Use concrete tests and retained regression commands together; record actual outcomes, never declare a phase verified from code inspection. New supplementary tests that already pass are verification evidence, not invented RED evidence.

Affected historical/normalized/boundary regressions (Vitest path substring includes the boundary suite):

```bash
NO_COLOR=1 FORCE_COLOR=0 TMPDIR=/tmp/opencode node /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/node_modules/vitest/vitest.mjs run /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/localWorkspace --silent --reporter=dot
```

Shared loader/overflow/padding/layer/provenance/partition regressions (all existing paths except the new T05):

```bash
NO_COLOR=1 FORCE_COLOR=0 TMPDIR=/tmp/opencode node /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/node_modules/vitest/vitest.mjs run /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/cooperativeLoader.test.ts /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/loadProjectState.test.ts /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/migration.test.ts /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/textOverflowSettings.test.ts /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/textOverflowPersistence.test.ts /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/textPadding.test.ts /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/layers.test.ts /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/generatorMetadata.test.ts /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/server/validateAppState.test.js /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tests/unit/document --silent --reporter=dot
```

Read-only rendering regressions protect the excluded layer/edit policy: run existing `canvasLayers.test.tsx`, `pdfLayers.test.ts`, `pdfFixedTextOverflow.test.ts`, `pdfGridTextOverflow.test.ts`, `PropertiesPanelTextPadding.test.tsx`, `PropertiesPanelTextOverflow.test.tsx`, `SingleElementEditorTextOverflow.test.tsx`, and `canvasElementCreationTextOverflow.test.tsx` with absolute paths under the same worktree tests/unit directory. No edits to those files are authorized. The first cumulative localWorkspace command includes all retained D6/repository/queue/worker/boundary tests, not merely new migration tests.

Full typecheck:

```bash
NO_COLOR=1 FORCE_COLOR=0 TMPDIR=/tmp/opencode node /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/node_modules/typescript/bin/tsc --noEmit --project /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/tsconfig.json
```

Known accepted baseline: `tests/unit/gallerySamples/stickerPress.test.ts(793,36): TS2339`, `length` on `never`. Report full typecheck as FAILED if present, with newly introduced errors distinguished. Never label it GREEN or edit unrelated test.

Build: controller first verifies parent `/tmp/opencode/doctect-incremental-sdd` and that the proposed output path does not exist. If occupied, choose a fresh numbered output, report its exact name, and do not clean an earlier output.

```bash
NO_COLOR=1 FORCE_COLOR=0 TMPDIR=/tmp/opencode node /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence/node_modules/vite/bin/vite.js build --outDir /tmp/opencode/doctect-incremental-sdd/task-11b-controller-build-01
```

No `--emptyOutDir`, servers or profile use. Retain normal external-output/chunk warnings in report. Controller then conducts final independent spec/quality review against the already captured **Task11b dirty baseline**, including all sequential groups and retained race/fault tests. M1 closes only after implementation, deterministic gates and cumulative review; native heap/latency and rollout remain later gates.

## Planning self-review disposition

- Approved direction followed; actual shared validation/loader call graph inspected before prescribing source edits.
- Five-file loader extension is explicitly approved and integrated; no repeated approval prompt. Necessary prerequisite adapter loops are narrowly enumerated rather than hidden inside an opaque bootstrap call.
- Group 1 types have one definition, code and tests use identical names, bounded costs are explicit, and its scope is exactly three paths.
- All fifteen sequential assignments have dependencies, exact manifest IDs, interfaces, tests/RED expectations, algorithms and GREEN gates. Shared protocol, session and cursor types are defined once. Frame grammar/depth, single derivation, source-only export and proof/fold constraints cross-checked; no unresolved incompatible contract identified.
- No source/test/ledger changes, tests/builds, baseline capture, commits/staging, installs, servers, cleanup or profile operations performed by this planning task.
