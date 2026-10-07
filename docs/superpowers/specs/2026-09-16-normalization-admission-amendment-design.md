# Normalization admission and source retention amendment

## Status and scope

The user approved the three recommended Task 11 amendments on 2026-09-16: shared historical-bootstrap extraction, verified migration-baseline evidence preserving revisions, and one retained ancillary-source archive. This document makes those decisions concrete. The approved incremental local persistence design and Task 11 remain binding; this amendment does not authorize a production cutover, a public API rollout, or migration of an existing browser profile.

Tasks 1–10 are accepted. Production `WORKSPACE_DB_VERSION` remains `2` through Task 11. Only the private normalization path and isolated tests explicitly request physical version `3`. No additional physical store is introduced. Existing project JSON, generator, cloud, and PDF formats remain unchanged.

## 1. Shared historical admission

Task 11's original exposure list omitted `LocalWorkspaceStore.ts`, which contains private strict ledger, backup, drift, repair, and admission decisions needed by normalization. Extract those prerequisites into `services/localWorkspace/historicalBootstrap.ts`, with behavior-preserving delegation from the existing store. Do not duplicate the decision tree or call public bootstrap merely to obtain and discard historical editing authority.

The shared helper returns validated historical records or existing recovery/unavailable outcomes. It does not install public project capabilities or grant normalized authority. Reuse existing stable legacy capture/recapture, lifecycle checks, strict original/accepted backup verification, v1 lineage repair, CAS, and concurrent-winner validation. Unknown or invalid present incarnations are not repaired by assigning new identities.

Physical database version and historical ledger format are separate. A valid historical v1 repair yields historical format 2 inside physical v3; an old `verified` ledger is never normalized authority. Default v2 bootstrap must remain behavior-compatible.

The private v3 historical adapter exposes prerequisites, not an alternate editor writer. Prerequisite write transactions must reject an already reserved normalization attempt atomically. A pre-transaction absence check is insufficient. Normalization retries must not invoke destructive replacement/clearing of historical stores.

## 2. Explicit migration-baseline evidence

Preserve each validated source project's incarnation, numeric storage revision, and canonical ISO `updatedAt`. Public wrapper revision and unknown wrapper timestamp fields remain distinct and unchanged. Preferences begin at their independent initial revision, and migration does not fabricate an ordinary document commit or editor generation.

Add optional private migration-baseline metadata to `ProjectHeader`. It identifies the source project/revision and the reserved normalization generation/attempt, with digest evidence anchored to the independently verified normalization source and active authority. Exact types belong to `normalized/schema.ts` and must be reused rather than shadowed.

An initial migrated header may have a nonzero document revision with null last-commit/proof, an empty commit window whose floor is that source revision, and fold-structure generation zero. This exception is valid only with explicit migration-baseline evidence. Existing non-migrated initial records still require revision zero; a generic null-proof relaxation is forbidden.

Bulk admission verifies the baseline against durable normalization authority and retained source identity. Merely adding a field to a forged header must not make it admissible. After ordinary commits, existing commit proof/window rules remain in force. Baseline metadata remains private ancestry, not a replacement for commit proofs or permission to replay a source revision.

Migration initializes the private timestamp from the validated source. Fresh initialization may retain the codec's null timestamp. Ordinary saves must not reread historical workspaces or archives to validate each edit; full baseline/authority validation belongs to admitted ingress and bulk recovery boundaries.

## 3. Immutable retained ancillary-source archive

Historical `projects` remain untouched recovery sources after normalization. Shared workspace, preset, and pending-import stores can change later, so their current contents cannot stand in for the original source.

Store one immutable, explicitly discriminated normalization-source archive in the existing `legacyBackup` store. It is not a legacy-localStorage backup and must not pass that validator by accident. Keep legacy backup validation strict, with an explicit stored-record union and unknown-candidate checks at inspection boundaries.

The archive retains the original workspace/preset/import envelopes, historical ledger, private metadata and source identity manifest needed to reconstruct and verify the captured source. Preserve import timestamps and consumed-import provenance omitted from older public-content digests. Do not duplicate large historical project payloads; reference the retained original project records and verify their identities/content.

Reserve archive and normalization attempt atomically. Reuse that archive on matching interrupted attempts. Quota failure aborts reservation; retries must not create an unbounded series of archives or target generations. Existing original/accepted backups remain untouched. No cleanup or garbage collection is authorized.

A genuinely fresh install stores its validated initial seed once so retries and concurrent bootstraps use the same project identities. Label it as a fresh seed, not a manufactured legacy migration or legacy backup. Competing speculative fresh IDs cannot overwrite the reserved seed.

Recovery reconstructs the retained source from old projects plus this immutable archive, never from later mutable ancillary records. Active normalized exports and retained historical exports have distinct selectors/envelopes. Staged data is never exported as current. After cutover, retained sources are labeled historical and not rollback-ready.

## 4. Normalization owner and authority boundaries

Extend the existing normalized repository with the eight private normalization operations specified by Task 7; do not introduce a second normalized transaction writer. `normalizeWorkspace` is the sole orchestration/resumption algorithm. Its result uses `active`; the test harness may map that result to `ready`.

Keep the existing generic `NormalizedRecord<K,V>` and add a noncolliding tagged union, `TaggedNormalizedRecord`, for staging. Ledger writes are owned by reserve/verify/activate CAS methods, never arbitrary staged records.

The normalized ledger has exact phases `staging`, `verified`, and `active`, migration ID `incremental-local-persistence-v3`, captured source identities/digests, target generation, staging progress revision, verification digest, and cutover revision. Validate phase invariants and unknown fields/versions at admission. Reuse matching attempts; never reuse an active generation for staging.

Bound stage transactions by record count and byte budget, allowing one already-valid large record as a single batch rather than changing record granularity or existing size limits. Prepare and hash outside write transactions. Stage writes and cursor advancement commit together under attempt/progress CAS.

Independent fresh reads reconstruct and compare target/source content before verification. Activation atomically checks the verified marker and captured source identity, including ancillary envelopes without revision counters. Reopen and independently validate the active marker/current target before readiness. Lost acknowledgements are resolved from durable state; they are not evidence of rollback.

After normalized edits, the original migration digest describes the baseline, not current content. Reopening must verify current records/proofs without requiring equality to stale source data. An invalid active target enters recovery rather than falling back to historical editing.

Task 11 exposes a private serialized owner entry and injected progress/lifecycle callbacks. It does not add incoming worker message families or wire production bootstrap. Tasks 12/13 own the reviewed legacy-capture bridge, correlated progress/cancellation, and migration timeout policy; the existing fixed 30-second transport deadline is not a migration-progress protocol.

## 5. Authorized file expansion

In addition to the original Task 11 files and Task 7's explicitly deferred repository methods:

- Create `services/localWorkspace/historicalBootstrap.ts`.
- Modify `services/localWorkspace/LocalWorkspaceStore.ts` only for shared historical extraction/delegation, without normalized production activation.
- Extend `normalized/schema.ts`, `repository.ts`, `coordinator.ts`, `codec.ts`, and `commitProof.ts` for the private owner, baseline, and authority contracts above.
- Extend `tests/helpers/incrementalStoreHarness.ts` and focused normalized codec/repository tests for migration integration while preserving existing ordinary-save budgets.
- Existing historical migration/recovery/schema/adapter seams may expose shared validation and archive support. `lineageRepair.ts` may only need explicit historical-format constants, not a new repair algorithm.

No UI/editor changes, public store/facade cutover, worker transport changes, dependency updates, production version bump, or source cleanup is included. Any further required seam must be identified with concrete evidence before expansion.

## 6. Verification requirements

Use the real migration algorithm and existing injected repository adapter in fresh isolated test databases. Write intended failing tests before implementation. Cover:

- Fresh, native/legacy v2, direct v1 repair, unknown/invalid lineage, strict backup/ledger validation, blocked upgrade, and versionchange.
- Nonzero migrated revisions/timestamps, forged/mismatched baseline evidence, ordinary commits and active reopen after migration.
- Complete content, ordering, raw compatibility fields, scripts, cloud/extensions, presets/imports/private provenance, and exact size limits.
- Reservation/staging/verification/cutover CAS, stale source/ancillary changes, competing bootstraps, missing/extra/corrupt targets, interruption after each durable phase, and lost commit acknowledgement.
- Quota/clone/transaction failures without new-copy proliferation or source loss.
- Distinct active/historical exports before/after edits and later ancillary mutations; no staged-current export or stale rollback.
- Lifecycle/source fencing and progress without claiming unimplemented browser transport or native durability evidence.

Run existing bootstrap, lineageRepair, drift, migrationPreparation, recovery, normalized repository/codec/worker, and capability-policy regressions; typecheck and build. Native migration/worker/browser durability remains a later acceptance gate. Record unrelated baseline failures explicitly, not as a passing global check.
