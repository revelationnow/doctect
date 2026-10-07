# Normalized Workspace Authority and Lifecycle

Date: 2026-09-26
Status: Written specification approved by the user on 2026-09-26; implementation planning authorized. Production cutover and migration of existing browser profiles remain unauthorized.

## 1. Purpose and constraints

Complete the missing workspace authority contract so the private incremental editor can eventually become the live editor without mixing normalized document writes with historical workspace writes. Preserve the measured changed-record save path; do not move whole-workspace work back into navigation or ordinary editing.

This amends Tasks 12/13 of `../plans/2026-09-13-incremental-local-persistence.md`. The original design, layer-fold/history ownership design, normalization admission amendment and bounded-normalization requirements remain binding except for the explicitly changed active-membership model described here.

Unchanged restrictions:

- Production `WORKSPACE_DB_VERSION` remains 2 during private implementation. The proposed layout uses the existing private physical v3 stores, not v4 or an extra store.
- No existing-profile migration, destructive cleanup, deletion of historical sources, commits, deployment or dependency changes.
- One worker owns normalized persistence. React uses the existing `LocalWorkspaceStore` interface: bootstrap, typed commit and recovery export. No fourth public raw-storage method and no mixed historical/normalized writer.
- Ordinary edits, preferences and metadata retain their selected-record transactions, small acknowledgements and debounce limits. No workspace reconstruction, full-project transfer or manifest traversal on their normal path.
- Existing public document formats, unknown extensions, scripts, cloud metadata, PDF behavior, 32MiB state/depth limits, 50-entry history, cooperative work/staging limits and proof/retry bounds remain unchanged.
- No automatic cross-tab merge, lazy project loading, general event sourcing, generation replacement or garbage collection.

The approved choice is an explicit current manifest. Inferring membership from headers leaves order/deletion/recovery coordination implicit. Rebuilding a storage generation for each membership change copies unchanged projects. Neither alternative is selected.

## 2. Existing seams and gaps

Verified against the incremental-local-persistence worktree:

- `normalized/repository.ts:701–714,865–900`: active images and reconstructed project rows come from immutable migration source membership. This cannot represent later create/close operations.
- `schema.ts:55–60`: historical `StoredWorkspace` has order, active ID and revision, but no normalized membership incarnation or command outcome evidence.
- `workspaceWorkerProtocol.ts:5–12`: the current `structural-command` is an occurrence edit within one document, not a workspace lifecycle command.
- `incrementalQueue.ts:632–679`: existing global barrier rejects later enqueue, drains all work, and retires close/replace targets before execution. A failed retired target is not automatically reinstated.
- `useDocumentEditor.ts:177–205,275–287`: full replacement, including undo/redo of replacement, belongs to editor history. `useIncrementalProjectWrites` currently rejects it.
- `LocalWorkspaceStore.ts:1347–1367`: legacy recovery is dispatched under recovery authority before ready-state command dispatch. The unavailable branch inside normal command execution is not evidence that recovery is globally unsupported.

The implementation must deepen these existing modules rather than introduce a second transaction owner or a generic storage framework.

## 3. Authority vocabulary

- **Migration source:** immutable retained baseline and its archive. It proves what was normalized and remains a historical export, not the current project list.
- **Current manifest:** durable normalized workspace membership, ordering, active project, ancillary descriptors and workspace-command evidence.
- **Workspace admission:** process-local capability installed only by independently verified worker bootstrap/recovery. A caller-supplied manifest, revision or digest is not admission.
- **Project admission:** existing process-local capability for one storage generation/project/incarnation and verified project lineage.
- **Workspace revision:** monotonic counter for workspace commands, independent of document, preference, fold, editor and write generations.
- **Project birth:** immutable ancestry for one admitted membership incarnation. It is migration-backed or created by a committed workspace command.
- **Document replacement:** explicit bulk replacement within a live project, including JSON/generator apply and replacement undo/redo. It is not membership replacement.
- **Retirement:** closing a membership incarnation. Reusing its public project ID creates a different incarnation.

One active storage generation remains fixed after activation. A future operation that switches an already-active generation needs its own design; this specification does not permit leaving old writable headers behind a switched generation pointer.

## 4. Durable representation

### 4.1 Current manifest in the existing workspace store

Use the existing `workspace` store and `id: 'current'` key. Its value becomes an explicitly discriminated union of historical `StoredWorkspace` and a normalized manifest. Historical validation remains strict and unchanged; normalized records must never pass through it as if they were historical records.

The normalized branch contains:

| Field | Contract |
| --- | --- |
| `id`, `kind`, `formatVersion`, `manifestVersion` | `current`, `normalized-workspace`, 3, 1; exact recognized fields |
| `storageGeneration`, `activation` | The active normalization generation, attempt and retained-source identity |
| `revision` | Safe nonnegative integer; initialized from source workspace revision |
| `members` | Ordered entries of project ID, incarnation, immutable birth and consumed-import provenance, when present |
| `activeProjectId` | Exactly one existing member; workspace is never empty |
| `presets` | Ordered ID/position/digest descriptors for live `presets` records, not their payloads |
| `pendingImports` | Ordered identity/position/digest/provenance descriptors for live `pendingImports` records |
| `legacyAcceptance` | Accepted legacy digest and backup reference, or explicit fresh-source absence |
| `coreDigest`, `lastCommit`, `commitWindow` | Verified workspace core and bounded command outcome evidence |

Order is represented once in `members`; compatibility projections derive historical-shaped `projectOrder` when an existing validator needs it. Do not retain two independently mutable order lists. Reject duplicate project IDs, invalid/duplicate ancillary positions, missing active IDs, malformed descriptors and unknown versions.

Manifest fields are private metadata, never project JSON. A descriptor may refer to a large preset/import, but cannot embed it. Existing external IDs retain their nonempty-string contract; do not quietly introduce a 256-byte cap for historical project IDs. New private command identities keep the existing 256-UTF8-byte limit.

Every accepted new workspace attempt increments revision exactly once, including an already-satisfied operation that needs a new durable receipt. Reinspection of the same committed attempt is not a new command and does not increment it. Counter overflow fails closed. Ordinary document/preference/metadata saves do not change workspace revision or rewrite the manifest.

### 4.2 Birth and import provenance

Migration births refer to the immutable source project/incarnation/revision/digest and retain existing `migrationBaseline` rules. Workspace-created births record the creation command identity, request digest, committed workspace revision, initial normalized-image digest, independent lane baseline digests and initial project authority. The header carries the matching private birth identity; it cannot authorize itself without the independently admitted manifest.

New membership incarnations are worker-assigned, not supplied by a caller. Allocate them deterministically from the domain-separated active generation, next workspace revision and member ordinal. This prevents reuse across close/recreate and retry without an ever-growing tombstone list. Conflicting attempts at the same revision cannot both commit. Incarnations remain opaque private strings.

Initial-image digests use a versioned normalized-record frame with exact order, keys, values, counters and private origin metadata. Exclude only the named private digest/proof/window fields that would otherwise refer to themselves; never omit similarly named external payload fields. Migration births continue to use the existing retained-source evidence instead of fabricating an ordinary document save.

Whole-image equality is only an initial/bulk verification check, not a substitute for independent lane baselines:

- The **document baseline digest** covers the document projection of normalized records, including header document/wrapper content, document counters and order, but excluding preferences, the folds extension and private mutable proof/window metadata. Preference-only writes cannot change that projection.
- The **preference baseline digest** covers the initial preference record projection independently of current document content. The **initial-fold digest** covers the exact raw folds extension. Neither is inferred from a document proof.
- If document revision is still its baseline revision, bulk admission recomputes the document baseline digest even when preferences have advanced. A scalar preference proof cannot authorize altered document bytes.
- If preference revision is still its baseline revision, bulk admission verifies its preference and raw-fold baselines independently even when document revision has advanced. Any operation changing stored fold values must advance/write preferences atomically.
- Once preferences advance, retain the verified current `foldRecordDigest` through scalar saves and proof-window eviction, as the existing fold contract requires. Advancing one lane never supplies the other lane's missing baseline evidence.

These fixed-size baseline digests remain in the member's birth metadata for its lifetime, independent of the bounded workspace command window. Project bulk replacement installs an analogous current project baseline as described in section 8; it does not rewrite the birth. Computing baseline digests is permitted at creation/replacement and full admission, never on ordinary saves.

Consumed-import ID, timestamp, payload digest and attempt provenance move into current member metadata for normalized projects. Closing that member removes its current provenance with it; historical records and the immutable archive are untouched. A delayed old command still fails its workspace revision fence. A new explicit import attempt follows current collision/provenance rules, not inferred historical membership.

### 4.3 Bounded receipts

Reuse the existing limits: at most 32 workspace receipt entries and 64KiB of encoded receipt-window data. Do not store payloads, complete manifests, or unbounded affected-ID lists in the window. A receipt contains private command identity, request digest, before/after revision and core digest, and a digest of the command's postconditions. Postcondition details are derived from the captured attempt and verified records during inspection.

Appending may evict oldest entries and advance the floor; it may not relax either bound. A missing/evicted receipt never proves non-commit. This is bounded outcome evidence, not an event log from which the workspace is reconstructed.

## 5. Activation and active reopen

### 5.1 Activation

Derive the initial manifest from the already validated source workspace, project metadata and ancillary envelopes. Include its digest/version in the normalization attempt and verification frame. Charge this work honestly through the existing work runtime; do not add an uncounted derivation or relax the unresolved four-target-derivation gate.

Activation writes the initial manifest and active normalization marker in the same sealed transaction. A historical workspace row is replaced by its normalized branch; the archive still contains the original historical workspace envelope. Fresh activation adds the manifest. Marker-only or manifest-only activation cannot publish authority.

This is a private format amendment, not an automatic repair of old experimental v3 data. An active marker lacking the required manifest contract fails closed with recovery/export, rather than manufacturing membership from surviving headers. No existing browser profile is upgraded during development.

### 5.2 Reopen

Use one coupled, independently sealed active read, retaining the existing all-store capture discipline:

1. Validate active marker, activation evidence and immutable archive/source. Retained source reconstruction uses exactly the archive's source identities and referenced backups, not mutable current ancillary records or later recovery backups.
2. Validate current manifest, its core digest and receipt/window invariants. An unchanged initial manifest must match activation evidence; an advanced one needs valid current workspace receipt evidence.
3. Allocate current images from manifest members, not `sourceProjects`. Require exactly one matching header per member and matching incarnation on every project record. Missing members, extra headers, wrong-incarnation rows and unowned normalized payloads refuse current editing authority.
4. Validate each current project, aggregate limits, references, raw folds and current project proof/baseline. A migrated member must match its source birth; a later member must match its workspace birth. A closed source project is still validated as retained history but is not required among current targets.
5. Validate every live preset/import against manifest descriptors and existing compatibility/provenance rules. Reject missing or extra live ancillary rows. Validate later backup records separately; they cannot silently become part of the original source digest.
6. Seal captured records and authority after validation, then return current snapshot plus workspace admission and per-project admission. Selected admission still validates the whole workspace but retains only its selected image/private per-read admission.

Readiness never falls back to historical editing when normalized data is invalid. Original migration target counts/digests remain baseline evidence, not current membership totals. Full bootstrap remains an explicit bulk operation; this is not lazy loading.

### 5.3 Constant-scope membership enforcement for normal saves

An admitted project does not reread the manifest on every edit. Its existing point-read header/incarnation CAS is the liveness fence because all authorized membership removals atomically remove the header, and all additions atomically install header plus manifest membership. Retained payloads alone grant no authority.

Close and a document save both transact on `projectHeaders`: if save wins, close's captured lineage fails; if close wins, save finds no matching header. Close/recreate produces a new incarnation. Changes to other members or the active project do not invalidate an unchanged project's document authority. Dormant corruption checks remain at full admission/recovery boundaries, not hidden whole-workspace scans per keystroke.

## 6. Workspace command interface

Keep workspace lifecycle distinct from the existing occurrence-edit protocol tag. Add a private workspace request family with:

- Installed workspace admission ID and worker epoch/request correlation.
- Generation and expected workspace revision/core digest captured by the owning facade.
- Bounded `clientId`, command sequence and command ID.
- One discriminated lifecycle intent; destructive targets additionally carry the post-drain project incarnation and document/preference/fold stamps.
- A worker-computed canonical request digest over intent, preconditions and explicit bulk payloads. Callers cannot supply a digest instead of validation.

Successful worker results contain receipt, a manifest delta, changed ancillary descriptors and any explicitly requested/new bulk project material. Activate/close do not return unchanged documents. New project/import payload publication is an explicit bulk boundary; ordinary saves retain their existing acknowledgement types.

The public typed `commit` interface gains correlated lifecycle results rather than pretending a catalog patch is a fully current `WorkspaceSnapshot`. The historical implementation can retain its snapshot overload privately during development. Normalized callers are converted together before cutover; no production instance selects different writers per command.

### Command semantics

| Intent | Required durable effect |
| --- | --- |
| Create and activate | Validate full ingress, reject an occupied ID, add new-incarnation normalized records, append member, activate it, write receipt atomically |
| Activate | Require current membership; change active ID and receipt only; no project payload readback when existing admission remains valid |
| Close | Require post-drain target lineage; remove target member/header and all its normalized incarnation records; choose the preceding surviving member using existing ordering behavior |
| Close last project | Require and validate a distinct-ID successor; add successor, remove target and replace membership atomically; never expose an empty workspace |
| Save/delete preset | Apply existing validation/upsert/delete semantics and update descriptor order/digests with receipt; no document writes |
| Stage import | Preserve canonical identity/provenance idempotency, consumed-target checks, collision rejection and append position |
| Replace staged import | Same source-key digest, changed payload digest, new import ID and target ID; exact expected staged provenance; retain position and atomically replace old record |
| Consume import | Validate staged identity; add fresh normalized member and consumed provenance, remove pending import, compact later positions, append/activate target, write receipt atomically |
| Recover legacy as copies | Separate recovery admission; validated additions and updated acceptance/backup evidence in one normalized workspace transaction; never overwrite current members or historical source projects |

Stage/replace/consume preserve their existing already-staged/already-consumed outcomes. A matching payload without matching provenance is not an idempotent success. Missing imports without independently verified current consumed provenance cannot manufacture success. Import consumption does not replace a colliding project.

`save-project` is not a normalized ordinary-save fallback. Explicit full document replacement has the contract in section 8; unknown or unsupported commands fail before payload/storage access.

## 7. Execution, barriers and publication

### 7.1 Worker transaction phases

1. Admit command framing and installed workspace capability, detach the command before suspension, and capture metadata/target records under the existing worker ordering owner.
2. Outside write transactions, validate payloads/provenance, prepare affected rows/deletions, compute digests, next manifest and receipt. Cooperative work includes every traversal/hash/clone and owned buffer.
3. In one readwrite transaction, compare captured workspace generation/revision/core and exact sealed manifest record. Compare target lineage and expected ancillary records in that transaction. Use the existing permitted synchronous exact-record seal where needed, never asynchronous hashing, yields or passive observers inside transactions.
4. Write only manifest/evidence plus affected project/ancillary/backup records. Any failure aborts the whole mutation. Close deletion is scoped to the retiring project/incarnation, never all stores or historical projects.
5. Independently read committed manifest and affected records consistently; verify all command postconditions before returning success. Bulk-created projects may require full target-project verification. Unchanged projects are not reconstructed to acknowledge activation or a preset command.

Migration's 64-record/256KiB staging limits are unchanged. Lifecycle create/consume/close/recovery and document replacement are explicit atomic bulk transactions, not migration staging batches. Their quota, transaction duration and native memory costs need separate tests; do not label a large operation an ordinary save or hide it behind a deadline increase.

### 7.2 Barrier cuts, not dropped editor events

Extend queue behavior with a captured submission cut. A workspace barrier drains work admitted before that cut and serializes the workspace operation. New work for surviving projects is retained behind the cut with its original source/generation and changed payloads; it cannot overtake the operation or continually delay it. Existing `barrier-active` rejection is not sufficient for a live editor that has already changed its local state.

Closing a target first installs a synchronous retiring guard shared with its editor actions, before history/state mutation can occur. Its pending pre-cut work must save before close commits. No new local edit can be accepted into a project that is being discarded; other projects can retain post-cut edits. If close fails, preserve the working editor/history and require verified fresh admission before lifting retirement. Do not resurrect the retired queue token merely because a promise rejected.

An in-flight unknown save blocks close/consume/replacement dependencies until inspected. Navigation within pages/templates remains an ordinary preference update, never a workspace barrier. Concurrent workspace commands serialize through the same owner; each command receives preconditions from its admitted order, not by silently rebasing a stale foreign caller.

### 7.3 Main-thread publication

Maintain a workspace catalog of ordered identities, active ID, ancillary descriptors and installed project handles. The editor remains owner of working document/preferences/history. Apply verified workspace deltas by identity; preserve unchanged editor owners and immutable document references. Adding or activating another project does not remount existing editor history.

A structural acknowledgement may update membership, but cannot replace surviving working content with a stale durable snapshot. A document acknowledgement advances only its verified lineage/generation coverage. Results from an obsolete workspace owner/worker epoch cannot install new handles or mark current work saved, even if storage committed.

Public consumers that need complete state—JSON, PDF, generator, cloud, preset creation or unsaved-work export—must request explicit assembly from the current editor owner. Inactive mounted projects use their retained owners; bootstrap material is valid only before that project has a working owner. Do not disguise a stale `initialState` as current by returning a snapshot-shaped patch, and do not introduce payload getters that secretly assemble full projects during ordinary admission.

## 8. Bulk document replacement preserves history

JSON/generator application and undo/redo of replacement retain the same project incarnation, editor source and local history owner. Each bulk replacement increments document revision, preference revision and fold-structure generation exactly once, even if some preference values are unchanged. Its immutable editor event supplies the intended complete preference state, including preserved current scalars and raw fold values; a paired preference delta from that same event is consumed in this transaction, not posted again. Member birth, import provenance and workspace revision remain unchanged. Wrapper cloud/name metadata survives unless the explicit command carries an authorized linked-root/metadata change.

Add a private bulk document queue segment and typed command. Capture the immutable replacement event, explicit preference semantics and local generation, then run it as an ordered per-project cut. Earlier segments drain; later edits remain queued, never coalesced across replacement. The worker validates the complete supplied image, prepares a complete replacement of only that project's records, and commits under existing project CAS. No main-thread whole-document diff is introduced.

Use a tagged bulk project proof with request identity, before/after authority, full normalized-image digest, the independent document/preference/fold baseline digests from section 4.2, and record count. Retain one current fixed-size bulk baseline in the project header and a matching boundary identity in preferences; both current head proofs refer to the same replacement. Do not put every replaced address into a 64KiB proof window. Independent bulk readback recomputes the full image and component digests outside the transaction. Its versioned frame excludes only named private self-referential proof fields as in section 4.2. Subsequent ordinary proofs bind the retained bulk baseline without rehashing that image on each edit.

Replacement is an explicit **verification and cache reset boundary**, not just one more delta:

1. Atomically clear both pre-replacement delta windows and set their floors to the new document/preference revisions. Their tagged bulk head proofs and current baseline supply initial evidence; an empty window is not a generic null-proof exception.
2. Bulk admission never applies pre-boundary selected-record postconditions to the replacement image. New deltas must be at or above both current baseline revisions. Independent lane verification still applies after only one lane advances or evicts entries.
3. After independent readback, the executing worker installs the new verified project image, reference index and fold index together before allowing queued later work. This changes worker caches, not the editor's working/history owner.
4. Another admitted owner whose cached boundary differs receives explicit `ingress-required`/cache-boundary failure. It cannot cross a bulk boundary using address-level delta refresh and cannot silently reconstruct a full project inside an ordinary save. Explicit re-admission rebuilds its caches; remote unsaved editor content remains preserved and conflicted, never automatically merged.
5. Attempts predating the boundary inspect as superseded/proof-unavailable, never not-committed. A later replacement replaces the previous bulk baseline and resets both windows again; no baseline chain or snapshot archive grows with Undo/Redo.

The hook maps `after-replacement` local dependencies to the verified replacement write generation/fold basis, just as it maps `after-structural`. A later ordinary edit cannot be posted before replacement acknowledgement/inspection. On failure or unknown outcome, retain local replacement/history and later pending work; do not remount, reset history, restore an older snapshot, claim saved or blindly replay.

This is a distinct ordered document operation, not the existing queue's membership-retiring `replace` barrier. Creating a genuinely new membership incarnation remains a workspace operation.

## 9. Lost acknowledgement, retry and cross-tab conflict

Add workspace-attempt inspection under the same worker. Preserve the captured immutable attempt and request identity until outcome is resolved. Before inspection/replay, quiesce or fence the old owner so it cannot post a later write, and serialize the inspection behind any already-started transaction. A timeout or worker termination alone is not proof of rollback.

| Inspection outcome | Required evidence and handling |
| --- | --- |
| Committed and current | Matching retained receipt/identity/digest plus independently verified current manifest and affected postconditions; publish once |
| Not committed | Authentic not-posted evidence, or fenced owner plus exact unchanged before-manifest/revision and absence of this attempt; re-admit only after all target guards are rechecked |
| Conflict / superseded / proof unavailable | Advanced authority, changed target, mismatched digest, evicted proof or unverifiable postconditions; preserve local content and require recovery/re-admission, never replay |
| Unknown | Storage/inspection unavailable or owner not fenced; remain unsaved/blocked with explicit retry/export |

A retained receipt is evidence of a durable attempt, not permission to publish its old catalog after later workspace changes. This design does not replay an evicted command or reconstruct historical workspace states. Bulk document replacement inspection follows the same rule and may perform bulk target verification.

**Approved confirmed-rollback amendment:** `2026-10-05-confirmed-rollback-retry-design.md` permits a narrow continuation of the same still-live repository owners after a native ordinary-write transaction is proven aborted. It requires private retained evidence, unchanged epochs/owner identities and exact atomically sealed workspace/project metadata, then retires old public bindings and issues new bindings. It is not a new full admission and does not acknowledge a save: normal changed-record validation, CAS and independent durable readback still follow. Unknown, post-commit, evicted-proof, changed-authority, replacement and lost-worker cases retain the full-admission/recovery policy above. Opening/reload and all independent full reads retain §5.2 in full.

Two tabs may save different still-live projects without a workspace-revision check on each edit. Workspace commands CAS their own revision. A close racing a target edit either sees the new lineage and refuses its stale close or removes the header before the stale edit can commit. Another tab's active-project preference does not rewrite the current tab's live selection. No conflict path automatically merges or replaces unsaved working content.

## 10. Recovery and historical compatibility

Keep distinct export selectors/envelopes for current normalized content, retained migration source and existing legacy sources. Staged data is never current. Export may operate with editing disabled, but cannot grant admission. Unsaved working export comes from the editor owner, not a last-acknowledged wrapper.

Recovery-as-copies is available only when independently validated current normalized membership coexists with a recognized recoverable legacy drift. An invalid current target cannot be made editable merely by copying legacy data into it. Retain the existing capability-driven UI for unsupported or unavailable recovery cases.

Reuse the legacy capture/recapture and recovery preparation semantics: pin recovery ID/source digest and accepted backup, validate additions, allocate fresh IDs/incarnations and preserve provenance. The worker validates current normalized target and prepares additions; the main thread bridges only the browser-only legacy capture. Recheck source/lifecycle at the final quiet fence before mutation, with no late observer between fence and commit.

Commit recovered projects/presets/imports, conflict backup, updated manifest/legacy acceptance and receipt atomically. Do not invoke the historical adapter's project writer, modify its retained `projects`, rewrite the immutable normalization archive, or reinterpret current ancillary data as original source. Later conflict backups are retained and validated separately from the archive's original backup references.

Lost recovery acknowledgement inspects the workspace attempt and accepted-source evidence. A failed transaction leaves prior acceptance unchanged. A changed source requires new confirmation; it cannot reuse the old recovery capability. Postcommit source drift is new recovery work, not evidence that the prior transaction rolled back.

## 11. Verification contract

Write intended failing tests through the repository/coordinator/store interface before each implementation slice. Keep the real editor/queue/worker composition; storage fault injection is an internal test seam, not alternate success logic.

### Manifest, activation and reopen

- Fresh and migrated activation install marker/manifest atomically; fault after either write aborts both; unknown acknowledgement resolves by fresh read.
- Create → close → recreate the same public ID → reopen uses current members, rejects old incarnation callbacks, and preserves original source byte-for-byte.
- Close the last project installs its successor atomically; stale close cannot erase a newer committed edit.
- Missing/extra member/header/row, wrong incarnation, wrong birth, ancillary mismatch, malformed proof/window, unsupported manifest and active-marker-without-manifest all refuse editing.
- Migration-born nonzero revision, workspace-born revision zero, ordinary edits and bulk replacement each reopen under their correct baseline rules. Forged null-proof exceptions fail.
- New birth → preference-only save → reopen verifies unchanged document baseline; new birth → document-only save → reopen independently verifies initial preference/raw-fold evidence. Repeat after workspace/project receipt eviction and asymmetric lane advancement.
- Current and historical exports diverge after legitimate workspace changes while preserving unknown fields, scripts, cloud data and source provenance.

### Commands, ordering and publication

- Cover every command in section 6, including duplicate IDs, stale workspace revision, counter overflow, deterministic incarnation allocation and affected-store operation counts.
- Stage/replace/consume preserve canonical/provenance idempotency, already-consumed behavior, target collision rules, timestamps and ordering after worker restart.
- Barrier drains only its cut, retains newer edits for surviving projects, forbids target edits before local close mutation, and does not silently reinstate retired authority after failure.
- Activation and workspace deltas preserve surviving editor/history owners and newer local content; stale worker/store/source completions cannot publish.
- Ordinary navigation/document/metadata work does not read/write the manifest or historical/ancillary payloads. Activate uses metadata only with valid existing admission.
- Replacement → ordinary edit → Undo/Redo and replacement Undo/Redo preserve history, wrapper metadata, fold provenance, independent generations and durable state. Failure/unknown outcome retains current local state and pending work.
- Replacement after existing document and fold saves discards superseded postconditions across both windows; repeated replacement and asymmetric eviction retain exactly one current baseline. Remote stale caches fail explicitly rather than performing bulk catch-up on an ordinary save.

### Failure and native evidence

- Inject faults before/after each actual put/delete and transaction completion, plus readback corruption, clone/quota/versionchange failures and stale source fences.
- Test unknown outcomes before posting, during transaction, after commit, after another workspace command, after target edits and after proof eviction. No duplicate creation/import/recovery or false rollback assertion.
- Test two-tab activate/create/close/import races and close-versus-edit at the actual transaction CAS.
- Isolated native Chromium/Firefox/WebKit coverage includes worker restart, reopen, quota without unlimited-storage flags, recovery/export and closed-project write refusal. Fake IndexedDB is not native acceptance.
- Repeat pinned Sticker Press ordinary-interaction measurements after private workspace integration and again after authorized live integration. No relaxed timeouts, budgets or INP/p95 claims from automation-plus-two-frame timings.

Run focused regressions during development; connected milestone tests with at most two workers, typecheck, production build, boundary checks and scope audit. Report the known Sticker Press TS2339 separately. The open migration derivation/timing/accounting gates remain open; this contract does not waive them.

## 12. Planned implementation seams and release boundary

Concrete MilestoneB plan: [Private workspace lifecycle](../plans/2026-09-29-workspace-lifecycle.md). It retains the private-first release boundary and requires execution approval; no lifecycle implementation or production cutover is claimed by that plan.

The later implementation plan should order connected slices as follows:

1. Manifest representation, birth/proof validation, coupled activation/reopen and selected admission. Factor private manifest/proof logic out of the already-large repository; keep all transaction execution in its existing owner.
2. Workspace command preparation/transactions, queue cuts, outcome inspection and typed private store publication; cover create/activate/close and all ancillary/import operations together before calling lifecycle support complete.
3. Ordered bulk document replacement and recovery-as-copies integration, including actual editor history, source bridge and failure/retry tests.
4. Normalized bootstrap/progress transport and live working-owner/publication/export/status integration. Only then consider the single production cutover, subject to every pre-existing release gate.

Expected existing paths: normalized schema/repository/codec/commitProof/migration/coordinator; workspace schema/contracts/dispatcher/admission/queue/protocol/client; store and historical-bootstrap/recovery seams; private hook/document-editor/publication callers and their tests. A detailed file allowlist belongs in the reviewed implementation plan, not an inferred permission to refactor unrelated code now.

Document-only changes for specification approval are this spec, its link/status in the original plan, and the execution ledger. Original Task11b baseline and allowlist remain immutable. No application code, experimental database, build artifact, timeout or production entrypoint changes are part of specification approval. Implementation requires the scoped plan and its verification gates.
