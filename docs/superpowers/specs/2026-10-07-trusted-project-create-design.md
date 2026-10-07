# Trusted Project Create

Date: 2026-10-07
Status: Approved by the user on 2026-10-07 ("Trusted create").
Follows: [Trusted Active Open](2026-10-07-trusted-active-open-design.md).

## Problem

After the incremental-persistence merge, creating a project went through one
`workspace-command` request that proved the new project twice, entirely in the
metered cooperative Work interpreter:

| 2026 Planner preset (1.3MB, 1751 records) | ms |
|---|---|
| request digest (computed 3×) | ~1,900 |
| input validation (2×) | ~2,400 |
| birth digests in prepare | 4,800 |
| post-write birth digest recomputation | 4,000 |
| post-write reconstruct + re-validate + compare | 3,200 |
| readback (one transaction per row) + final seal | ~2,700 |
| **workspace-command total** | **19,400–25,200** |

Before the merge the same create took 718ms. The 21MB Sticker Press project
took 21s before the merge and now exceeds the 30s worker request deadline, so
create/import of any project above ~2MB fails.

The generators themselves are the cost: draining the same frames with
`runSync` is only 1.6× faster. Native twins of the same frames (the
`frameRecord`/`recordFrame` pattern already in `commitProof.ts`) run the
planner's records in ~150ms.

## Decision

The worker trusts its own fresh write the way editor open trusts an activated
generation.

1. **Request digest once, natively.** `commitWorkspace` computes the request
   digest once with a native twin of `hashWorkspaceRequest` (canonical/ordered
   text plus `crypto.subtle` SHA-256) and passes it to preparation and
   postcondition verification.
2. **Native birth digests.** `createProjectBirthDigests` uses a native twin of
   `projectBirthFrame` built from `frameRecord`. Digests are byte-identical to
   the generator frames; equivalence tests pin this.
3. **Validate once.** New projects are validated with the synchronous
   `validateWorkspaceProject` (same traversal, `'sync'` mode).
4. **Atomic readback, no final seal.** After the write, verification reads the
   selected rows in one readonly transaction. IndexedDB gives that transaction
   a consistent snapshot, so the per-row transactions and the closing seal are
   not needed.
5. **Compare to what was written.** For projects this command added, the
   readback records must equal the written records record-for-record
   (`frameRecord` text equality), replacing the post-write birth digest
   recomputation, reconstruction, input re-validation and payload compare.
   Reconstruction still happens when the editor opens the new project.

## Unchanged

- The prepare-read capture and the compare-and-swap seal inside the write
  transaction (the concurrency guarantee).
- Stored formats, digests, manifests, receipts and commit windows.
- `inspectWorkspaceAttempt` and retry/recovery verification, which have no
  in-memory written records and keep the full metered verification.
- Recovery-as-copies and all other workspace intents keep their existing
  verification of anything they did not just write.
