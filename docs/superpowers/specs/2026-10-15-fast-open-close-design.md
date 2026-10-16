# Fast Open and Close

Date: 2026-10-15
Status: Approach approved by the user on 2026-10-15 ("Go ahead with 1 and 2").
Follows: [Trusted Import](2026-10-14-trusted-import-design.md).

## Problem

After Trusted Import shipped, the live site (doctect.app, desktop Chromium) still takes 6.8s to open the
2026 Planner gallery project in the editor and 9.2s to close it with "Close without Saving". A phone is several
times slower. Worker request timings on the same code (local dev build, desktop):

| step | time |
|---|---|
| gallery: workspace bootstrap | 0.7s |
| `stage-import` | 1.2s |
| navigate + editor workspace bootstrap | 0.35s |
| `consume-import` | 2.7s |
| `open-project` | 0.3s |
| editor mount | 0.5s |
| `close-project` ("Close without Saving") | 9.3s |

- **Close re-verifies the project it deletes.** `prepareWorkspaceMutation` reconstructs the closing project
  through the metered codec (`reconstructProjectWork`) and re-proves its birth digests (`verifyProjectBirth`),
  and the compare-and-swap seal compares every captured project row through metered frames. The records are
  deleted by the same commit; only the project's identity and authority (header and preferences rows) matter.
- **Every workspace command re-validates every ancillary row.** `validateCapture` runs twice per command
  (before the write and in post-write verification). For each stored pending import and each custom preset it
  runs the full content validation (migrated-state check, pending-import or preset traversal: canonical checks,
  clones, `validateAppState`, the project loader) and then the descriptor digest check. A user with saved
  presets pays this on every open, close, activate and save of a preset.
- **Consume hashes the same content three times.** The descriptor check computes the canonical text of the
  pending import twice (inside the record envelope and on its own), and `consumedImportDigest` computes it a
  third time, although it equals the descriptor's `pendingImportDigest` that was just checked.

## Decision

The worker's own commit (`commitWorkspace`, the `trusted` path) changes as follows. Recovery, inspection,
retry and restart keep the full metered path, as in Trusted Import.

1. **Fast close.** For `close-project` on the trusted path, `prepareWorkspaceMutation` keeps every identity
   and authority check (member, incarnation, header and preferences authority, successor rules) and no longer
   reconstructs the closing project or re-proves its birth. `commitWorkspace` seals with the native project-row
   compare (`nativeProjectCompare`, the byte-identical twin Trusted Document Replace uses), so a concurrent
   change to any captured row is still refused.
2. **Digest-proved ancillary rows.** On the trusted path `validateCapture` proves each stored pending import and
   preset that this commit did not write by its manifest descriptor, computed natively (record digest over the
   envelope text, and for imports the `pendingImportDigest`), after the cheap shape checks (exact fields, id,
   position, warnings list, attempt provenance). It no longer re-runs the content validation. The manifest is
   validated against its receipts as before; a row whose content differs from what its descriptor digests is
   refused (`Preset descriptor mismatch` / `Import descriptor mismatch`). A pending import's content is still
   validated once when it is consumed: `addProject` validates the project built from it, as before.
   New preset descriptors (save-custom-preset) use the same native twin.
3. **One canonical text per pending import.** The native import descriptor computes the pending import's
   canonical text once and reuses it inside the record envelope text; the consume digest reuses the verified
   descriptor's `pendingImportDigest` instead of hashing the pending import again.

## Targets

| 2026 Planner, desktop | before | target |
|---|---|---|
| close without saving, live-equivalent dev build | 9.3s | ≤ 1s |
| click → editor, live-equivalent dev build | 7.0s | ≤ 5s |
| Node bench `close-project` | 21.7s | ≤ 3s |
| Node bench `consume-import` | 2.9s | ≤ 2s |

## Tests

- Trusted and metered preparation of `close-project`, `consume-import` (beside a kept import and with a saved
  preset) and `save-custom-preset` produce identical manifests, rows and digests.
- The trusted close does not run `reconstructProjectWork` or `verifyProjectBirth`; a close whose header or
  preferences authority changed is still refused; a captured project row changed between capture and seal is
  still refused (native compare).
- A stored preset or pending import whose content was changed (descriptor intact) is refused on the trusted path
  with the descriptor-mismatch message; a trusted command with stored presets does not call the metered preset
  content checks.
- The native preset descriptor and the spliced import envelope text equal their metered frames byte for byte.
- Existing workspace transaction, evidence and e2e tests pass unchanged.

## Unchanged

- Stored formats, digests, manifests, receipts and proofs.
- The metered path (`trusted` undefined): recovery, inspection, retry, restart.
- Stage validation of new input; consume's validation of the project it creates.
