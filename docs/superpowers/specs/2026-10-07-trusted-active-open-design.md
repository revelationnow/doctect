# Trusted Active Open

Date: 2026-10-07
Status: Approved by the user on 2026-10-07 ("trust-once rescue").

## Problem

Opening the saved 21MB workspace in `/app` took 86.8s after Task29 (111s after
Task26). Every editor admission re-ran the complete migration proof:
re-normalising the retained legacy archive, re-hashing every source and target
record, re-checking commit-proof windows and bulk baselines per project, and
re-comparing every captured row in a final seal — all through the metered
cooperative Work interpreter, one IndexedDB transaction per captured row.

The same AppState parses, validates (`validateAppState`), clones, stringifies
and SHA-256 hashes in about 0.8s of plain Node work. Tasks18–29 tuned the
interpreter and hash producer; that path cannot reach an interactive open.

## Decision

Verification of the migration happens once, when a generation is activated.
The `normalizationLedger` marker in state `active` is the durable record of
that verification. Ordinary editor/workspace admission of an active generation
trusts it and does not re-derive or re-prove it.

`workspaceAdmission` (editor open, workspace admission) and the single-project
editor admissions `openAdmittedProject`/`bindAdmittedProject` now:

1. Reads `normalizationLedger`, `workspace`, `presets`, `pendingImports` and the
   project stores (all projects, or one project's key range) with `getAll()` in
   one readonly transaction. IndexedDB gives
   that transaction a consistent snapshot, so no post-read seal is needed.
2. Validates the ledger and workspace manifest structure and requires matching
   storage generations.
3. Groups records by manifest member and rejects records outside membership or
   scope.
4. Reconstructs every project with the plain codec (`reconstructProject`),
   which still runs `validateAppState`, record-membership checks and the
   aggregate size counters.
5. Keeps the cheap fold-record digest check and ancillary id/position checks.
6. Builds the same editing owners/snapshot as before.
7. Exhausts the Work quantum after the read and before each project, so progress
   replies, cancellation and the existing `after-page` test pause still work.

Failures are reported as `verification-failed`, unchanged for callers.

## Unchanged

- Write paths: revision/incarnation fences, commit proofs written on save,
  atomic transactions, confirmed-rollback retry, and Saved only after durable
  acknowledgement.
- Migration staging/verify/activate, which still performs the full proof.
- Recovery capture, exports (`readActiveSnapshot`, `readRetainedSource`,
  `exportProjectForRecovery`) and the bulk-replacement current read keep the
  full verified `activeRead`.

## Dropped at open

Detection at open of tampering that leaves records structurally valid (for
example an edited record whose commit-proof digest no longer matches). The
previous design treated IndexedDB contents as untrusted on every read; the
legacy store on `main` never did. Corrupt or structurally invalid records are
still rejected by reconstruction/validation.

## Results (2026-10-07)

Real `/app`, saved 21,152,284-byte workspace, complete edit/switch/Undo/Redo/
reload/failed-save/retry/durable-readback scenario:

| Run | Open | Report |
| --- | --- | --- |
| Task29 large | 86,797ms | `/tmp/opencode/doctect-saved-workspace-large-1791361080655/report.json` |
| Trusted open large | 4,608ms | `/tmp/opencode/doctect-saved-workspace-large-1791367616721/report.json` |
| Task29 control | 1,700ms | `/tmp/opencode/doctect-saved-workspace-control-1791361314051/report.json` |
| Trusted open control | 1,059ms | `/tmp/opencode/doctect-saved-workspace-control-1791367700630/report.json` |

Worker editor admission is about 2.8s of the large open. Single unpaired runs.

Tests changed to the new contract: open-time seal/contention cases for `bind`
and workspace admission (now one atomic transaction), and startup cancellation
cases that relied on the old `before-seal` pause or on the open being slow.
