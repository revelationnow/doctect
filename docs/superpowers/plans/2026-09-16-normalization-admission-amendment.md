# Normalization Admission Amendment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete original Task 11 with shared historical admission, preserved migration revision evidence, and durable retained-source exports.

**Architecture:** The existing normalized repository remains the sole normalized transaction writer. A shared historical bootstrap helper exposes existing prerequisite safety rules without installing historical editing authority. One resumable normalization orchestrator stages, independently verifies, activates, and reopens the target; explicit baseline evidence and an immutable ancillary archive preserve source lineage and recovery.

**Tech Stack:** TypeScript, IndexedDB, existing injected adapter/hash environment, Vitest and fake-indexeddb, Vite.

## Global Constraints

- The approved main plan, `2026-09-13-incremental-local-persistence.md`, Task 11 and global/shared contracts remain binding.
- Amendment design: `../specs/2026-09-16-normalization-admission-amendment-design.md`, approved by the user in both direction and written form.
- Production `WORKSPACE_DB_VERSION` remains `2` through Task 11.
- No additional physical store is introduced.
- No UI/editor changes, public store/facade cutover, worker transport changes, dependency updates, production version bump, or source cleanup is included.
- No commits/staging. All edits use apply_patch. Existing feature work remains uncommitted; review against the captured Task 11 dirty baseline, not HEAD~1.
- All databases are injected isolated test databases. No existing profile or ports3000/3001. Use TMPDIR=/tmp/opencode and unique retained external build outputs.

---

## File structure and interfaces

Create `services/localWorkspace/historicalBootstrap.ts` for shared historical prerequisite admission; `services/localWorkspace/normalized/migration.ts` for normalization orchestration; `tests/unit/localWorkspace/normalized/migration.test.ts` for the real injected migration harness/fault matrix.

Modify historical `LocalWorkspaceStore.ts`, `migration.ts`, `recovery.ts`, `schema.ts`, and `indexedDbAdapter.ts` only for extracted shared behavior, private historical access, archive discrimination, and explicit physical-v3 creation. Conditional `lineageRepair.ts` change is limited to separating historical format constants.

Modify normalized `schema.ts`, `repository.ts`, `coordinator.ts`, `codec.ts`, and `commitProof.ts` for the eight Task 7-deferred normalization operations, complete ledger types, explicit migration baseline, and serialized private entry. Extend `tests/helpers/incrementalStoreHarness.ts` and normalized `codec.test.ts`/`repository.test.ts` without weakening ordinary-save budgets.

The public algorithm is private-to-persistence `normalizeWorkspace(environment: NormalizationEnvironment): Promise<NormalizationResult>`; active results contain storage generation and independently verified workspace. Nonready results retain existing recovery/unavailable status shapes with private distinct export selectors. Resume means calling the same function again.

Retain `NormalizedRecord<K,V>`; add `TaggedNormalizedRecord`. Use Task 7's eight operation names and signatures, substituting this additive tagged name only for the already-colliding staging record type. Source, attempt, and active-authority types live in normalized/schema.ts. Do not create a second private command vocabulary.

## Group A: Historical exposure and physical layout

- [ ] Start the real normalization test file and establish the required intended RED with `TMPDIR=/tmp/opencode npx vitest run tests/unit/localWorkspace/normalized/migration.test.ts`. Build `createNormalizationHarness` on the actual injected repository factory and original historical fixture envelopes, not mocked normalization decisions.
- [ ] Cover explicit v1/v2→v3 store creation preserving original payloads, default-v2 open, blocked upgrade/versionchange, and historical admission failures before any normalized authority.
- [ ] Extract existing strict ledger/backup/capture/repair/drift prerequisites into the shared helper, preserving v2 store delegation and stable recapture/lifecycle behavior. Add atomic normalization-absence guards to prerequisite writes. Do not invoke the existing destructive copied-source replacement from this path.
- [ ] Run historical regression command: `TMPDIR=/tmp/opencode npx vitest run tests/unit/localWorkspace/bootstrap.test.ts tests/unit/localWorkspace/lineageRepair.test.ts tests/unit/localWorkspace/drift.test.ts tests/unit/localWorkspace/migrationPreparation.test.ts tests/unit/localWorkspace/recovery.test.ts`. Baseline is193 passing tests; existing behavior must stay green.

## Group B: Source archive, lineage baseline, and reservation

- [ ] Add failing cases for nonzero historical revision/ISO timestamp, forged baseline evidence, private import provenance, and ancillary-source mutation after reservation. Source export must equal the captured original representation, not hydrated editor defaults.
- [ ] Introduce the explicit header baseline and stored backup discriminator. Keep nonmigration null-proof revision-zero rule. Bind migrated baseline to the source identity and normalized authority; do not fabricate an ordinary commit.
- [ ] Implement repository source reread and atomic reservation/archive insertion under captured-source CAS. A fresh seed is retained once without manufacturing legacy migration. Test competing fresh IDs, source mismatch, generation collision, quota abort, and lost reservation acknowledgement.
- [ ] Run migration plus normalized codec/repository suites. Existing normal commits and proof validation remain valid; weakened expectations are not a migration fix.

## Group C: Bounded stage, independent verification, and cutover

- [ ] Add durable-phase interruption tests with the original Task11 oracle:

```ts
it.each(['after-stage', 'after-verify', 'after-cutover'])('resumes safely: %s', async faultAt => {
  const h = await createNormalizationHarness({ faultAt });
  const original = await h.exportSource();
  await h.runUntilInterrupted();
  h.clearFault();
  const result = await h.bootstrapFresh();
  expect(result.status).toBe('ready');
  expect(await h.exportActive()).toEqual(original);
  expect(await h.exportSource()).toEqual(original);
  expect(await h.countActiveAuthorities()).toBe(1);
});
```

- [ ] Implement stage CAS over attempt identity/generation/progress/cursor, deterministic target plan, and bounded transactions; ledger tags are not stage payloads. Prepare/hash outside transactions and commit records/cursor atomically.
- [ ] Verify independently reread physical records, exact membership/key agreement, reconstructed content/order/size/private provenance, source archive, and captured source. Mark verified only at the expected final staging revision.
- [ ] Activate in one transaction comparing the verified marker and full captured source, including ancillary envelopes without counters. Reopen and revalidate marker/current records before returning active. Resolve competing winners and lost acknowledgements from durable independently validated state.
- [ ] Add stale stage/verification/source CAS, missing/extra/corrupt record, archive corruption, quota/clone/abort, simultaneous bootstrap, and no-retry-copy-growth cases. GREEN the complete migration suite.

## Group D: Active reopen, recovery exports, and owner integration

- [ ] Add tests for migrated ordinary document and preference edits followed by independent reopen, proof/baseline corruption, concurrent edits during bulk verification, and historical export after ancillary changes.
- [ ] Implement distinct active-normalized and historical-source export selectors/envelopes in private recovery paths. Never advertise half-staged current state or label historical data rollback-ready. Failed validation preserves sources and returns typed recovery/unavailable outcomes.
- [ ] Expose normalization through the existing private serialized coordinator owner with injected lifecycle/progress. Keep incoming worker protocol and fixed transport deadline unchanged. Test interruption/cancellation/observer isolation without claiming native worker-migration transport coverage.

## Group E: Verification and independent task review

- [ ] Run the full new migration suite, all normalized tests, historical193-test regressions, and `npm run check:workspace-boundary`; preserve exact commands/results and intended RED evidence.
- [ ] Run `TMPDIR=/tmp/opencode npx tsc --noEmit --pretty false`. The pre-existing `tests/unit/gallerySamples/stickerPress.test.ts(793,36)` TS2339 is not a passing global typecheck; report any new diagnostic as task-local.
- [ ] Run `TMPDIR=/tmp/opencode npm run build --legacy-peer-deps -- --outDir <fresh external task11 build directory>`, after checking its parent. Never empty an old output directory.
- [ ] Audit original dirty-baseline bytes, authorized file scope, untouched HEAD/index/protected sibling, and actual Astra High runtime metadata. Capture full cumulative Task11 delta; independent reviewer returns separate spec and quality verdicts.
- [ ] Fix concrete findings tests-first and re-review cumulative delta. Acceptance requires controller adjudication of every remaining cross-task verification limit. Save ledger/handoff; production remains uncut.

## Self-review

The three approved amendments map to groups A/B/D. Original Task11 staging/verification/recovery requirements map to groups B–D. Existing method/result/tagged-type names stay consistent; no new public API or early transport rollout. Groups are execution checkpoints within Task11, not independent task acceptances. Final Task11 review remains cumulative.
