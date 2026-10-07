# Normalization Source Reads and Prepared Emission

Date: 2026-09-26
Status: Written optimization amendment approved on 2026-09-26. Concrete plan approved for inline execution on 2026-09-27. No budget change is authorized.

Implementation plan: `../plans/2026-09-27-normalization-emission-work.md` (execution in progress; completion requires its verification gates).

## 1. Goal

Remove demonstrated redundant normalization work without reducing validation, cancellation, atomicity or data-retention guarantees. Address the extra staging derivation and avoid deriving normalized targets for read-only retained-source consumers.

Binding background:

- `2026-09-13-incremental-local-persistence-design.md`: responsive changed-record editing, honest saves, compatibility, no dual writers.
- `2026-09-16-bounded-normalization-design.md`, sections5–7: at most four source/target derivations, independent verification/activation/reopen, metadata plus source/current-project/batch working set.
- `2026-09-16-normalization-admission-amendment-design.md`: immutable retained source, distinct current/source authority, no historical editing fallback.
- `2026-09-26-normalized-workspace-authority-design.md`: current manifest and immutable source are distinct; production remains v2.

No dependency, physical schema, durable record format, public storage interface, worker transport, cloud format or production entrypoint change. No commits, existing-profile migration or retained-source deletion.

## 2. Evidence and exact redundancy

The covering baseline recorded all641 migration cases:589 pass,43 timeout and9 assertion failures. Follow-up corrected eight non-budget assertions, including a real retained-export defect, and added six tests. Of42 short-timeout retries,26 still exceeded5000ms. The32MiB baseline timed out360000ms. Current success-path target derivations remain5 versus required4. Full boundary940 cases and connected511-case serial regression pass; these do not waive the failed gates.

Current source paths:

- `normalized/repository.ts` session `stageNext` creates a new `createTargetCursor(prepared.source)` and increments `targetDerivations` after preparation already traversed the target.
- `normalized/codec.ts:34–69` recreates each normalized project during that cursor pass.
- `codec.ts:207–253` calls full external validation, partitioning, byte accounting and size-ledger derivation, not merely record emission.
- Retained-source `derive(..., 'retained')` still constructs a target cursor, expected target manifest and initial current-workspace manifest even though its caller returns only `NormalizationSource`.

An80-template CPU sample attributes substantial time to cooperative generator dispatch/guards and JSON/source/target traversal. SHA compression itself is a small part. Sampling and post-timeout work prevent using that profile as acceptance timing or summing nested inclusive samples.

## 3. Alternatives

1. **Selected: source-only retained reads plus preparation-owned emission recipes.** Keep phase ordering and durable contracts. Make staging a genuine emission traversal rather than another semantic derivation.
2. Fuse first target derivation with staging. This could also avoid the duplicate pass, but would change reservation/expected-manifest availability and interrupted-prefix semantics. Larger redesign, not selected.
3. Optimize generic Work dispatch only. May improve wall time, but leaves the fifth semantic derivation. Defer until the redundant path is removed and fresh profiles identify remaining cost.

Explicitly rejected shortcuts: retaining all normalized project payloads between phases; skipping independent verification/activation/reopen; caching durable authority across invocations; omitting counter increments while performing the same work; increasing test timeouts, Work quanta or stage limits.

## 4. Separate source-only derivation

Factor the existing captured-source/archive derivation from target planning. Both branches remain private to the existing repository owner and consume the same bounded capture/session runtime.

### Retained-source consumers

`readRetainedSource` and the strict source-read adapter must:

1. Preserve the existing fresh-seed eligibility rules. No unreserved speculative seed becomes a recovery export.
2. Recognize marker shape/version and phase invariants before using its archive reference. Malformed source references and unsupported marker shapes still fail closed.
3. Independently validate original project records, original ancillary envelopes, source lineage/provenance and referenced backups; compute the existing source/content/archive digests.
4. Match source-bearing marker fields to those independently derived facts: source kind, generation/attempt, source projects and revisions, source workspace/ledger revisions, archive identity/digest and source/content digests.
5. Perform the existing final readonly source seal, including the recognized marker, original projects and exact archive-referenced backup set. Unrelated later backups remain outside retained-source dependencies.
6. Return only the retained source, never current membership, current project admission or a verified/active target result.

They must not invoke target decomposition/cursors, calculate normalized record sizes, build an initial current-workspace manifest, reconstruct current target projects, or validate target-readiness hashes. Those outputs are unused by a source-only consumer.

This makes the existing retained-only target-proof exception explicit: source export may succeed while syntactically recognized target evidence is wrong. It does **not** permit activation or staging with that evidence. Target-bearing marker fields retain structural validation, but their semantic agreement with normalized bytes belongs to the target branch. A corrupted source digest/archive identity still prevents retained export.

### Target consumers

Preparation/resume, strict stage validation, verify, activate and active reopen still independently derive the expected target and applicable current manifest from their own required capture. They validate every target-bearing marker field, target/current records and proofs as before. Source-only results never substitute for this validation.

## 5. Preparation-owned emission plan

The successful preparation pass already derives each normalized record for the target manifest, byte sizes and resumed-prefix comparison. Extend that pass to record how to emit the same record later from its immutable captured source.

The emission plan is private, invocation-local and opaque. It is not persisted, sent over a worker message, included in a progress event or accepted as caller-supplied authority. Its lifetime is exactly the preparation source lease. A new invocation must build a new plan from a new independently validated capture.

### Allowed recipe contents

- Project/store/record ordinals and exact key/field order.
- Locations of values in the captured source, expressed as private source-address metadata.
- Presence/hole information and the already-decided structural projection operations.
- Private envelope constants, lineage/baseline metadata, encoded sizes, counters and overlay contributions already computed by preparation.

Not allowed: copied SVG/text/script payloads, copied opaque extension or raw-fold values, retained normalized project images for every project, payload-sized serialized strings, or a generic full-document diff used to discover recipes.

Source addresses refer only to the private immutable capture, not live IndexedDB rows or provider-owned objects. User strings—even header names or generator strings—remain source-referenced rather than copied into recipe literals. Structural keys/IDs may be unbounded under existing historical rules; their traversal and retained size must still be charged.

### Preserve the actual codec semantics

Recipe generation follows the same projection decisions used by the real partition/codec producer, not a separately maintained serializer:

- Unchanged nodes, elements, scripts and extension values borrow their source values.
- Template/layer containers retain the exact existing field order and sparse-array presence semantics.
- Layer `collapsed` extraction records its already-decided boolean-map or positional-exception placement. Replay must not recount duplicate layer IDs or reclassify raw folds.
- Header order, cloud/wrapper/state/variant extensions, unknown fields, raw transient compatibility data and all private size/lineage fields remain byte-equivalent.

Capture codec-specific projection provenance during the first derivation. Shared partition traversal may expose a private metadata-only result or recorder to the codec, but it must not import storage concepts or change live editor partition behavior. Do not reverse-engineer provenance with another payload walk. Detailed interfaces/file edits belong in the implementation plan after this contract is approved.

Finalize each record recipe only after project counters, preference overlay contributions and migration-baseline lineage are installed. Header placeholders from early record construction are not final emission metadata.

## 6. Replay and stage behavior

Open a replay cursor at the already-validated durable prefix ordinal. Preparation still independently checks every prefix record; direct seeking is not permission to trust an old marker alone.

For each next record, replay reads only recipe-selected source locations and materializes the required shallow containers/envelope. It must not call external project validation, `partitionStateWork`, full `decomposeProjectWork`, a size-ledger derivation, target-manifest derivation or payload hashing merely to rediscover facts already established by this preparation.

The existing stage builder uses the prepared framed byte sizes and preserves exact project/store/record ordering. Limits remain64records/256KiB, with a valid oversized singleton alone. Replay cannot expose mutable recipe internals; missing/invalid source locations or invalid cursor state fail before any planned write. Tests independently measure emitted frame bytes rather than trusting recipe-reported sizes.

Every actual lookup, construction, emitted byte, required comparison, hash and ownership operation remains charged. IDB structured-clone/native transaction costs retain their existing documented limitations. Removing repeated work is not removing Work accounting.

The strict `stageNormalization(attempt, records)` adapter also uses the plan produced by its fresh validation pass to obtain expected records. It still detaches caller input, checks the actual supplied batch byte/count limit, compares supplied versus expected records and commits under the existing marker CAS. No caller-supplied payload is trusted because a recipe exists.

## 7. Independence, invalidation and ownership

Verification, activation and active reopen keep their fresh captures, independent derivation/current-proof checks and final seals. They do not reuse preparation recipes, computed payload hashes or cached project authority. Reservation still validates and seals the captured source/archive before writes; final legacy/publication fences remain unchanged.

If another actor advances the marker, cancel/dispose the old cursor and recipe plan, then retry with a fresh independently validated capture under the existing eight-attempt limit. A failed/lost stage acknowledgement cannot advance replay based on guessed durability. Existing owner logic must reconcile the durable prefix before reuse or create a new session.

The plan owns its metadata/reference buffers, while payloads remain borrowed from one source graph. Emitted record containers belong to the current project/batch working set. Charge metadata growth as it is allocated, including long keys/paths; do not call the working set constant-size merely because payloads are borrowed.

Release recipe metadata, indexes, cursor containers and source leases on cancellation, source/epoch loss, failed retry and all terminal outcomes. Release preparation before allocating independent verification capture. Guard failure immediately after lease acquisition must not leak accounting; use the tested protected-allocation pattern. Logical ownership is not native heap evidence.

## 8. Acceptance and tests

No existing fixture, assertion, deadline or budget is reduced. Add intended failing tests before implementation:

- Successful normalizer performs exactly the allowed four target derivations, and stage replay performs zero semantic rederivations. Observe real producer/validation/partition calls as well as counters; deleting an increment cannot satisfy this test.
- Source-only read/export performs zero target derivations or current-workspace-manifest builds while retaining independent source validation and final seal. Bad target proof does not block valid retained export; bad source/archive evidence does.
- Feeding a valid retained-source result back into reserve/stage/activate cannot bypass corrupt durable target evidence. Those write/admission paths still perform their full independent target checks.
- Every replayed record/key/order/frame byte matches the established codec oracle for fresh and historical sources, multiple projects, empty/optional records, scripts/cloud/unknown extensions, sparse/raw layers and duplicate/non-string IDs.
- Parity is not the same recipe run twice: compare the untraced bulk codec path, independently read physical records and reconstructed external source data. Existing pinned fixtures and exact-order assertions remain intact.
- First/last records, batch boundaries, oversized singleton, resumed prefix and strict caller batch comparisons preserve exact byte budgets. Skipped prefix emission cannot bypass independent prefix validation.
- Forged/disposed/foreign plans, altered source/provider inputs, stale marker/source epoch, getter-bearing metadata and failed/lost acknowledgements cannot publish or append stale data.
- Owned high-water metadata grows with records/structural projection entries, not SVG/script body size. Opaque payloads remain borrowed; cancellation at allocation/emission/transaction boundaries releases ownership. Compare logical and native measurements separately.
- Existing normalized record/proof/manifest, recovery, migration-race, source-retention and ordinary-save isolation suites remain valid.

Run the per-case verifier with no test-timeout changes. Require actual closure of the5-vs4 gate, then remeasure affected5-second cases and the original360-second32MiB test. Record cold/isolated and connected outcomes separately. No synthetic benchmark or CPU-profile timing substitutes for these gates.

Meeting four derivations does not by itself establish responsive production editing or full release acceptance. If deadlines remain red, gather fresh evidence before proposing another optimization. Lifecycle B/C/D and production cutover remain separate work.

## 9. Expected scope and execution order

1. Source-only derivation separation in normalized repository and source/recovery tests.
2. Private codec/partition projection provenance and emission-plan module, plus byte-parity/ownership tests.
3. Session and strict-stage replay integration with source/prefix/fault/cancellation tests.
4. Original deterministic/runtime gates, connected regressions, build/typecheck and exact capability/scope audit.

Expected runtime seams: `services/localWorkspace/normalized/{repository,codec}.ts`, a new private normalized emission-plan module, and a narrowly scoped provenance addition to `services/document/partition.ts` if required by the shared producer. Work/hash primitives and durable schemas are not broadened by default. Test/helper and filename-specific boundary edges must be listed in the implementation plan. No UI/store cutover, second writer, global cache, new durable store, source cleanup or budget amendment.

Only this proposal, its planning link and the execution ledger change during design review. Implementation starts only after the written amendment and its concrete plan are approved for execution.
