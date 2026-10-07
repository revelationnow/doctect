# Capture-Scoped First Read

## Goal and authorization

Open the actual saved21MB workspace, then edit/autosave, switch projects, reload and retry failed saves without losing durable edits or Undo. On2026-10-04 the user chose **Consolidate pipeline (Recommended)** after being told that this broadens source-to-target validation/serialization, keeps reuse inside one immutable capture, and preserves independent reads, integrity checks and deadlines. Continue inline; no repeated product interview or implementation handoff.

Task19 is a verified partial checkpoint, not large-workspace acceptance. Source stamp8b92d4d…/1211, baseline `task-20-capture-scoped-first-read-baseline`. Actual uninstrumented large run1791137719623 fails120s before editing; small native control1791137638626 passes the complete workflow. Profile1791134897554 finishes source derivation at98.126s;105s CPU samples show target decomposition repeating full canonical validation of the exact original project already checked by source validation.

## Selected architecture

Make one capture-scoped module interface own source-record validation and target projection. `codec.ts` provides `withSourceRecords(input, work, consume)`. It executes the existing complete `validateWorkspaceRecordsWork` itself, then calls `consume(records, cursors)` while the captured input remains immutable. `cursors.create(source)` and `cursors.plan(source)` can create one target cursor for that exact records object. They cannot accept another graph, another Work runtime, a later phase, or a call after the scope closes.

The internal target cursor may use the codec's private projection body without repeating external-project validation because this scope just performed the stronger stored-project checks on those exact payloads. Scope/id checks, partitioning, record sizes, counters, extension/fold preservation, emission recipes and all target bytes remain unchanged. Existing standalone `decomposeProject`, `decomposeProjectWork`, `createTargetCursor`, `createPlannedTargetCursor` and synchronous preparation continue validating their own untrusted inputs unconditionally.

The interface exposes no validation receipt, byte count, trusted flag or callable unchecked decomposition function. Scope factories/cursors are unusable after callback completion. Returned data and transferred completed emission plans are still data, not admission. Repository remains the sole writer and still authenticates all marker/source/target/current/proof/seal facts before admission.

## Lifetime and input rules

- Native database capture, or existing detached strict-ingress capture, owns the graph. Callers preserve its existing immutability contract through the whole scope, not merely the first validator call. No mutation or native clone substitution can reuse its facts.
- Before validation, capture eligible own-data-property array/row/project identities under charged private metadata custody. After validation, a factory requires an own-data-property `source.records` matching the exact checked object, and unchanged project-array identity. Before private projection, require the original row and its exact validated project object; replacements cannot borrow its facts. Nested immutability remains the existing caller obligation, not a new expensive deep freeze. Accessor-based captures receive ordinary self-validating projection instead of this reuse.
- Recheck the active row/slot/project at cursor resumptions; retain the source-root binding independently of cursor disposal. A final cooperative audit checks all captured slots, project references and membership before provisional output escapes. These guards do not make arbitrary mutable input supported: the entire captured graph remains immutable through preparation and emission replay.
- Only one cursor is allowed per scope, preventing competing traversal/ownership. The private identity index is cleared and released on every scope exit.
- Cursor Work operations are bound to the actual original runtime, including exhausted cursors. Synchronous factory/plan-transfer calls preflight the owning runtime's liveness and phase. Work lifecycle loss remains authoritative.
- Close external interfaces immediately when the consumer settles, before the `work.wait` postguard and final cooperative audit. Internal bindings and provisional-plan custody remain until that audit completes; observers cannot use escaped interfaces during cleanup/publication.
- Unconditionally dispose the cursor in `finally`, including an exhausted cursor whose emission plan was not taken; exhaustion alone retains its builder. Cleanup never yields.
- Register a taken plan with scope failure custody inside the transfer method, before any post-operation guard can throw. Transfer ownership to the consumer only after the whole scope completes successfully; on callback error or final lifecycle failure dispose the taken plan too. This closes the new failure window between inner `deriveTarget` return and outer-scope completion. Successfully returned plans retain existing stage-only recipes and explicit disposal.
- Preflight before consuming the builder. Latch any failure after provisional transfer: catching the error and restoring the phase cannot turn an undelivered plan into a successful scope or strand its ownership.
- No fact survives into verification, activation, reopening, retry or another durable capture. Every such scope independently calls the existing real source validator, loader and clone/output checks. Retained-source reads use the scope without constructing a target.
- Accessor-based outer record compatibility must not silently gain reuse: only the validated own-data-property project payloads from immutable native captures may use the private projection. Non-data envelopes retain the standalone validation path or refuse before reuse; preserve existing Get behavior.

## Repository flow

`prepareSourceWork` becomes continuation-scoped: validate source records once, perform existing ledger/backups/snapshot/source hashes, then invoke a consumer before the scope closes. `deriveCapturedSource` keeps archive and marker validation inside that continuation and passes its captured-source result plus scoped cursor factory to its consumer. `deriveTarget` performs existing manifest/membership/target work inside that consumer. Retained-source and strict-reservation callers only return data and cannot retain a live factory.

All target/current validation and physical seals stay in place. This first seam removes a measured redundant pass; it is not evidence that later stages fit120s. Continue the approved first-read consolidation based on new native profiles, not speculative bypasses or unrelated import/scheduler work. Any further changed representation still needs independent validation; measurements and a regression oracle precede each additional consolidation.

## Rejected alternatives

1. More isolated scalar tuning retains repeated full-graph passes and has already produced only partial end-to-end progress.
2. Public trusted-input flags or reusable validation tokens allow caller assertions or stale facts to cross independent captures. They are excluded.
3. Skipping historical source, loader, current record checks, hashing or physical seals changes safety policy and is excluded. Longer timeouts, lazy admission, worker heartbeats inside transactions, source deletion and import tuning are excluded.

## Tests and acceptance

- Compare every emitted record/frame and emission replay with existing independent untraced preparation. Include multiple projects, differing source/storage order, extensions, Unicode, raw fold exceptions, missing optionals and maximum valid depth.
- Count actual canonical/AppState/loader work: source scope checks the original raw project once; target projection does not validate it again. Each new scope still validates afresh. Native-cloned and loader-output states remain distinct independently checked images.
- Malformed source/schema/active variant/metadata/depth, clone representation changes and loader failures must reject before any target is returned. Standalone codec malformed-input refusal remains unchanged.
- Test other records objects, other runtimes, changed phase, second cursor, escaped factory/cursor, callback rejection, validation/projection cancellation, post-allocation cancellation and abandoned/transferred emission-plan cleanup. Require zero abandoned ownership and untouched raw input.
- Repository tests retain independent prepare/verify/activate/reopen counts, source-only retained reads, full target comparisons, corruption/source-race refusal, exact persisted digest bytes and no partial admission.
- Run exact boundary tests, affected codec/migration/startup/editor tests, build/typecheck and read-only review. Preserve failed receipts and original limits.
- Native actual default-app21MB scenario must open within120000ms and finish continuous autosaves, switching, Undo/Redo, reload and native failed-save retry with durable readback before full acceptance. Small controls or faster subphases are not substitutes.

## Unchanged constraints

32MiB AppState, depth512, history50;1024visits/64KiB Work;64UTF16 JSON fragments,192UTF8 SHA input and600visits/update; migration64records/256KiB with existing oversized singleton;30000ms RPC;5000/10000ms unit defaults and existing named exceptions. Keep all14stores/formats/digests/source archives immutable, sole normalized writer, ownership/fence semantics and current preview unchanged until verified replacement. No installs, commits, destructive operations, deployment or existing-profile access.
