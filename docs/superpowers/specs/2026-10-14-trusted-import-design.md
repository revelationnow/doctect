# Trusted Import

Date: 2026-10-14
Status: Approach approved by the user on 2026-10-14 ("go with the trusted import"); spec awaiting review.
Follows: [Trusted Document Replace](2026-10-09-trusted-document-replace-design.md),
[Trusted Project Create](2026-10-07-trusted-project-create-design.md),
[Trusted Active Open](2026-10-07-trusted-active-open-design.md).

## Problem

Opening a gallery project in the editor ("Open in editor", fork, fork a version) stages the project as a
pending import, navigates to `/app`, and consumes the import there. For the 2026 Planner gallery project
(1,368 pages, 727 KB, published at schema 7) this takes 33 seconds on a desktop and a minute or more on a
phone. Almost all of it is worker CPU; the download takes 40 ms.

| Click → editor, Chromium dev build, desktop | time |
|---|---|
| `stage-import` commit | 8.9s |
| `snapshot()` re-read after staging (result discarded by `stageImport`) | 4.6s |
| fresh worker bootstrap after navigation | 0.3s |
| `consume-import` commit | 5.9s |
| `snapshot()` re-read after consuming | 12.4s |
| editor mount | 0.2s |
| **total** | **33s** |

Node + fake-indexeddb, same payload: stage 10.3s, consume 5.7s.

The redundant work:

- **Post-commit re-read.** `NormalizedWorkspaceStore.commit` ends every structural command with
  `snapshot()` → `readActiveSnapshot()`: a full metered reopen that re-derives and re-verifies every
  project in the workspace (`deriveTarget`, `verifyBulk`, metered reconstruct), although the command
  was just verified against an atomic readback and ordinary editor opens already use the trusted read.
- **Stage: prepared twice.** `prepareWorkspaceMutation` prepares the pending import through the metered
  `preparePendingImportWork` (v7 → v12 migration, validation, canonical check). After the write,
  `verifyWorkspacePostconditions` prepares the same input again from the batch, hashes it again, and
  deep-compares it with the readback (`same`). Every pass runs in the metered Work interpreter.
- **Consume: metered proof of a row the worker just read.** `prepareWorkspaceMutation` re-validates the
  captured pending-import row (migrated-state check, pending-import check, descriptor digests), hashes it
  again for `consumedImportDigest`, and the compare-and-swap seal compares it through metered frames; each
  is a full pass over 727 KB.

## Decision

The worker trusts its own fresh write and the editing session trusts its verified command result, as
create, open and replace already do.

1. **Trusted post-commit read.** `NormalizedWorkspaceStore`'s `snapshot()` (returned after
   `session.commitStructural`, and on bootstrap re-entry with a live editor) reads the active generation
   the way Trusted Active Open does: one readonly transaction, every project reconstructed once with the
   plain codec, fold records checked, ancillary rows matched to their descriptors. No proof chains,
   `deriveTarget`, `verifyBulk` or metered reconstruct. It is still a fresh durable read, so callers get
   the same snapshot as before. (The session's published view is not used: it holds project
   initializers, which lag behind saved edits.) The repository gains `readTrustedActiveSnapshot`;
   `readActiveSnapshot` keeps the full metered read for recovery export and legacy-drift checks.
2. **Trusted stage.** For `stage-import` and `replace-staged-import`:
   - The pending import is prepared once, synchronously, with `preparePendingImport` (the `'sync'` mode
     of the same traversal as `preparePendingImportWork`).
   - The import descriptor digests (`importDescriptor`: record digest and `pendingImportDigest`) and the
     attempt-provenance `pendingImportDigest` are computed with native twins of their metered frames
     (`hash(canonicalText(...))`), byte-identical to the metered `hashFrame` results. The request digest
     is already native (`hashTrustedWorkspaceRequest`).
   - Post-write verification receives the written import rows (as `written` already does for created
     projects). A readback row must equal the written row by native canonical text; the input is not
     prepared a second time. An outcome of `already-staged` or `already-consumed` (nothing was written)
     keeps the full metered verification.
3. **Trusted consume.** For `consume-import`:
   - The captured pending-import rows that `prepareWorkspaceMutation` re-validates (exact fields,
     `checkMigratedStateWork`, `checkPendingImportWork`, descriptor equality) are validated once,
     synchronously, with the `'sync'` modes of the same traversals; descriptor digests use the native
     twins from 2. This applies to every trusted workspace command that captures pending imports.
   - `consumedImportDigest` is computed with the native twin.
   - The compare-and-swap seal compares the pending-import row by native canonical text, as Trusted
     Document Replace does for project rows.
   - Project creation already takes the trusted create path, and post-write verification of the created
     project already uses `written`; both stay as they are.

## Targets

Measured with the same two harnesses (scratch, never committed): the Node bench of stage then consume,
and the Playwright click-to-`project-tab` timing on the LAN dev build.

| 2026 Planner gallery project | before | target |
|---|---|---|
| click → editor, Chromium dev build, desktop | 33s | ≤ 8s (expected about 4–5s) |
| Node bench `stage-import` | 10.3s | ≤ 2s |
| Node bench `consume-import` | 5.7s | ≤ 2s |

The branch reports the measured numbers in its final commit message and in this spec's Result section.

## Tests

- **Equivalence.** `preparePendingImport` produces exactly the result of `preparePendingImportWork`,
  including for a schema-7 pre-layer state, and rejects the same invalid inputs. Each native digest twin
  equals its metered `hashFrame`, including for unicode and escape content.
- **Stored bytes unchanged.** Staging and consuming the same input through the trusted path writes the same
  rows, digests, manifest and receipt as the metered path.
- **Stage verification.** A trusted stage prepares the input once (the metered preparation does not run).
  A readback row that differs from the written row is refused. The already-staged and already-consumed
  retry outcomes still verify fully.
- **Consume.** A changed pending-import row between capture and seal is refused, and a digest mismatch is
  refused.
- **Post-commit snapshot.** `readTrustedActiveSnapshot` returns exactly what `readActiveSnapshot` returns
  (authority, workspace, snapshot, source) after stage, consume, a preset save and a saved document edit,
  including the planner; it refuses the same corrupt rows that trusted open refuses. `commit` of a
  structural command no longer calls `readActiveSnapshot`.
- **End to end.** The existing gallery e2e ("opens a project published before layers existed in the
  editor") and the fork e2e pass unchanged.

## Unchanged

- Stored formats, digests, proofs, manifests, receipts, commit windows and acks.
- Authority, identity, attempt and provenance checks; the compare-and-swap seal (only the pending-import
  row comparison becomes native).
- `inspectWorkspaceAttempt`, retry, restart, recovery and bootstrap verification: no in-memory written
  rows, so they keep the full metered verification.
- `readActiveSnapshot` and its other callers (recovery export, legacy-drift and recovery checks).
- The cooperative Work runtime and its guard checks. Making them cheaper everywhere is a separate,
  later change.
- Ordinary incremental edits.

## Result

| 2026 Planner gallery project | before | after |
|---|---|---|
| click → editor, Chromium dev build, desktop | 33s | 6.7s |
| Node bench `stage-import` | 10.3s | 1.3s |
| Node bench `consume-import` | 5.7s | 2.9s |

The click-to-editor and stage targets are met. Consume misses its 2s bench target. Its remaining time is
native canonical text work that this design keeps: the trusted project-create birth digests (about 0.85s,
listed under Unchanged) and the synchronous re-validation of the captured pending-import row (about 0.5s),
plus garbage collection. Lowering it further means changing the create path, which is a separate change.
