# Confirmed Rollback Retry

## Goal and approval

Finish the actual saved21MB `/app` workflow, including explicit failed-save retry, durable readback and retained Undo/Redo. Task25 opens in117011ms and completes editing/switching/reload, but retry starts another full workspace read and misses the unchanged5000ms saved-status assertion. The user approved the following narrow policy amendment after a plain-language explanation: retry a save without reopening everything only when the same live worker can prove that the transaction changed nothing and the saved version remains unchanged. Uncertain outcomes retain full re-admission.

This is a continuation of an existing live repository owner, not a new full admission or a reusable validation certificate. Normal opening, reload, worker replacement, unknown-outcome recovery, bulk replacement and all independent full-read validation/seals are unchanged. Old failed public bindings remain invalid.

## Repository-owned proof

The existing bounded attempt ledger is insufficient by itself: `aborted: true` also covers failures before a transaction starts. Add private, non-serializable continuation evidence only after an ordinary document/preferences transaction actually fires `onabort`. The write promise still rejects only after settlement. No error name, caller flag or timeout grants this evidence.

Evidence belongs to the exact retained attempt record and records the existing project owner's opaque identity, workspace/connection epochs, workspace stamp and before-project authority. It contains no document payload or strong reference to an obsolete project owner. Evicting the existing32-entry/64KiB attempt record loses the evidence. Replacing an owner, closing/changing the connection, replacing/fencing the workspace, or advancing relevant authority makes it unusable. A successful transaction followed by a readback/transport failure has no rollback continuation evidence.

`resumeAbortedWorkspace(token, failures, work)` authenticates the live workspace token and every coordinator-retained failed identity against this private evidence. It refuses an empty list, missing/evicted evidence, identity mismatch, an invalid or replaced project owner, changed epochs, a changed workspace stamp or mismatched before-authority. Cached project records must agree with their last verified authority; deferred or uncertain caches use full recovery instead.

The method captures only the active normalization marker, current workspace manifest, and exact header/preferences rows of current live members. It compares complete metadata records with the live owners, not just revision numbers, and seals that exact metadata capture atomically using the existing readonly seal. It checks liveness, pending operations and owner identities before publication. It does not read historical archives or unchanged node/template/extension payloads. Those remain under the original still-live admission, just as for ordinary saves; this exemption applies only to the approved proven-rollback continuation, never to a new admission.

Success rotates the workspace capability and returns its unchanged catalog plus current per-project authorities. The previous capability and all old public project bindings are retired. Nothing is saved or acknowledged by this operation: the existing queue replays the failed edit with a fresh commit identity through normal validation, CAS and independent readback.

The complete continuation also pins a monotonic project-operation epoch. Any intervening project operation revokes it even if that operation finishes before the next guard, preventing a completed owner replacement or attempt eviction from escaping a mere pending-queue check. Original failure frames are checked before copying: capture only exact own enumerable scalar scope/identity fields in a bounded operation; native cloning must not sanitize getters, symbols, hidden fields or custom prototypes into accepted evidence.

## Worker and transport

Add `workspace-resume-aborted { storageGeneration, admissionId }` and a correlated `workspace-resumed { admissionId, catalog, projectAuthorities }` response. The new admission ID is the request ID. Keep protocolVersion1 and the30000ms posted-request deadline.

The worker retains only failed ordinary request identity/scope metadata under its FIFO ordering owner. It never accepts caller-supplied rollback claims or payload-based authority. Every current member must still have either its live binding or the exact failed binding; unsupported mutation failures and missing ownership refuse continuation. The repository independently proves each retained failed identity. Success installs new public workspace/project bindings together and consumes the failed-identity set. Old IDs remain stale before and after success. Replacement failures, startup failures and lost workers take the existing path.

## Editor recovery

The store tries this continuation only on explicit Retry while its current ready session and legacy-source lifetime remain live. Existing initialization single-flight also covers this attempt. Quiesce/freeze the old queue before requesting continuation. Do not dispose its lifecycle or consume retained obligations until a valid reply is available.

A private session recovery composition installs the returned metadata bindings for the same existing project/source identities and invokes existing queue and write-owner recovery. Preserve working state, later pending edits, metadata, editor generations, fold dependencies and Undo history. The continuation carries no project snapshots and cannot replace working content.

If the probe is unavailable or refused, retain the original queue/lifecycle custody and execute existing full re-admission. If adoption fails after capability rotation, preserve the matching successor checkpoint and use full recovery; never reactivate the old bindings. Existing attempt inspection still resolves each retained queue attempt before replay. An unexpected committed/conflicting/unknown result cannot be treated as rollback.

## Verification

- Real IDB before/after-put/before-complete aborts produce eligible evidence; a successful commit followed by failure, pre-transaction exceptions, missing/forged/evicted evidence and new repositories do not.
- Guard same-revision metadata corruption, changed project/workspace revision, closed/recreated scope, owner replacement, workspace fence, connection loss, cancellation and capture/seal races. No partial bindings or leaked custody on rejection.
- Assert exact selected read stores and no unchanged document/archive read, clone or hash. Ordinary retry still validates changed records and independently reads them back.
- Wire tests cover malformed/stale IDs, epoch/request correlation and invalidated old bindings. Editor tests cover held work/later typing, Undo/Redo, concurrent Retry, false save status, full-recovery fallback and failed adoption custody.
- Run affected repository/worker/protocol/queue/lifecycle/store/page tests, strict static boundaries, build/typecheck and read-only review against Task26's immediate baseline.
- Run unchanged actual saved21MB scenario:120000ms opening/reload, existing5000ms saved-status assertions,30000ms RPC. Do not accept a background completion after a failed gate. Preserve all failed receipts.

## Unchanged constraints

No new writer/store/schema, persisted proof/cache, aggregate input cap, public-ID limit, automatic merge, import detour, UI polishing, generic Work tuning or longer deadlines. Preserve32MiB/depth512/history50,1024visits/64KiB Work,64UTF16/192UTF8 frame bounds,600visits SHA updates and5000/10000ms unit defaults. Implement inline; read-only review permitted. No staging, commits, installs, deployment, existing-profile access or destructive operations. Preview remains Task17 until the complete replacement is verified.
