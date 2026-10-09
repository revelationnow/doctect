# Trusted Document Replace

Date: 2026-10-09
Status: Approved by the user on 2026-10-09 ("Trusted replace").
Follows: [Trusted Project Create](2026-10-07-trusted-project-create-design.md).

## Problem

Applying a generated project ("Apply Generated Project") replaces the open project's whole
document through `commitReplacement`. Every step of that command runs in the metered cooperative
Work interpreter, and both the current and the new document are proved several times over:

| 2026 Planner, Node + fake-indexeddb | blank → planner | planner → planner |
|---|---|---|
| prepare (current verification + `prepareBulkProject`) | 8.2s | 32.9s |
| readback re-verification and cache rebuild | ~22s | ~21s |
| **`commitReplacement` total** | **30.5s** | **54.1s** |

In Chromium the same apply takes 22s on a desktop. On a phone it takes 45s or more.

The redundant passes for planner → planner are:

- **Current document:**
  - reconstructed twice: once in `replacementImage`, once in `prepareBulkProject` just to read the wrapper;
  - its whole bulk baseline is re-hashed by `verifyBulk`;
  - it is compared record by record (`equalFrameWork`) with the admitted owner cache, which on its own already proves it is the admitted image.
- **New document:**
  - decomposed (which validates it) and reconstructed again for validation;
  - framed for hashing three times: request digest, four bulk digests, and the post-write baseline re-hash;
  - after the write, reconstructed and fully re-verified again, and its reference and fold indexes rebuilt through metered work.

## Decision

The worker trusts its admitted cache and its own fresh write, as it does for create.

1. **Current side: compare natively, don't re-prove.**
   - The prepare read takes the replacement's rows in one readonly transaction (`captureWorkspaceRowsAtomic`), a consistent snapshot.
   - The compare-and-swap seal inside the write transaction stays. For this command it compares project-store rows by native `frameRecord` text instead of metered frames; workspace-store rows are compared as before.
   - The captured rows are compared with the admitted owner cache record for record, using native `frameRecord` text equality. Equality with the admitted cache is the proof.
   - `verifyBulk(current)` and the metered reconstruct of the current image are skipped.
   - The current wrapper (id, name, unknown fields) is reconstructed once, synchronously.
2. **New side: validate once, hash natively.**
   - The new document is decomposed once, synchronously; decomposition validates the wrapper and the AppState.
   - The produced records are reconstructed once, synchronously, as the single codec/size/lineage validation.
   - The request digest, header/preference core digests, fold digest, the four bulk digests and the manifest digest are computed with native twins of the metered frames. The twins are byte-identical, and equivalence tests pin this.
3. **Atomic readback, compare to what was written.**
   - After the write, verification reads the replacement's rows in one readonly transaction (`captureWorkspaceRowsAtomic`), so no closing seal is needed.
   - The rows must equal the prepared records record for record (native `frameRecord` text equality, same membership).
   - The owner cache is rebuilt from those rows. The reference index and fold overlay are built natively from the written state.

## Result

| 2026 Planner, Chromium dev build, desktop | before | after |
|---|---|---|
| apply 1 (blank → planner) | 21.2s | 2.5s |
| apply 2 (planner → planner) | 36.8s | 3.6s |

## Tests

- Native twins (`projectBulkFrameText`, `createTrustedProjectBulkDigests`, `hashTrustedBulkDocumentRequest`) are byte-identical to their metered frames, including for the planner preset and unicode/escape content.
- `prepareTrustedBulkProject` produces exactly the records and ack of `prepareBulkProject`, and rejects the same invalid inputs.
- A replacement hashes only the fresh write (nine digests, each once) and never re-proves the current image.
- The fresh replacement is reconstructed once, and a durable readback that differs from what was written is refused.

## Unchanged

- Stored formats, digests, proofs, manifests, commit windows and acks.
- Authority, identity, ancestry and attempt checks; the compare-and-swap seal inside the write transaction (only its project-row comparison is native).
- `inspectReplacement`, retry, restart and recovery verification. They have no in-memory written records and keep the full metered verification, as does any replacement whose current rows differ from the admitted cache (that still fails as `verification-failed`).
- Ordinary incremental edits.
