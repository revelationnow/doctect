# Canonical Byte Producer

## Goal and authorization

User requested continued producer-level consolidation after the scheduling-only candidate missed its gate. Reduce actual21MB cold-open processing while preserving the qualified editing/reload/retry behavior. Do not revive the rejected scheduler or introduce WASM, cached validation certificates or weaker storage checks.

Task29 baseline iscb3eb925…/1221, snapshot `task-29-bounded-producer-baseline`. Current source/target CPU profiles1791350767100 locate substantial self time in canonical traversal, packing, encoding and paired comparison; generic driver/guard cost also accumulates around their tiny operations. These samples identify a concrete seam, not an end-to-end speedup prediction.

## Selected interface

Keep existing text APIs and their independent synchronous/string oracles. Add a byte-oriented canonical producer inside `shared/jsonWork.js`, using the same private kind/container/descriptor/order rules. It owns a bounded iterative traversal, ancestors, existing order-only cache and one192-byte output buffer. It validates and encodes multiple fields/characters per charged operation instead of generating many tiny Work operations and intermediate strings.

Each processing batch reserves at most1024visits before execution; an internal meter prevents exceeding that reservation. Native key enumeration remains explicitly charged/tagged, and callback-capable reflection is guarded before/after. Sorting may delegate to the existing bounded order-cache/sort program. No generic inner-Work interpreter or executor change is allowed.

Output consists of borrowed UTF-8 packets of at most192bytes, valid only until the consumer finishes and the producer resumes. They are not UTF-16 text fragments; existing public text emitters remain capped at64units. All SHA updates remain at most192bytes/600visits. No complete project/frame buffer is built. Output byte accounting uses actual packet lengths; unequal/error prefixes cannot authorize anything.

Single and paired traversal share this processor. Paired traversal validates both representations, sorts expected keys once, checks actual membership/descriptors and compares primitive/string content while encoding expected bytes. No identity success shortcut. Preserve finite-number/negative-zero behavior, Unicode/lone-surrogate escapes, dense-array rules, prototypes/accessors/symbol refusal, cycles and depth512. Standalone count-only/text APIs remain unchanged initially.

## Output adapter and composition

Add `utf8JsonOutput(textEmit, byteEmit): JsonEmit`, an immutable forwarding function associated privately with its byte consumer. This is output representation selection, not an input-validity flag: either route performs full JSON checks. Unrecognized/wrapped emitters retain the old text path. No caller-provided size or validator is accepted.

`withFrameDigests` creates these outputs for its own genuine digest states. Its private byte consumer uses the existing runtime-bound SHA update accounting and fan-out. The byte buffer never becomes available to application input callbacks; it stays borrowed for the complete consumer operation. Closed digest scopes still reject, and all custody releases on success/error/cancellation.

`canonicalWork` and the hash-only `emitComparedCanonicalWork` choose the byte route only for this associated output. Source-image hashing and target record framing therefore retain their existing callers, complete grammar, per-field depth resets and exact digest domains. Record/envelope/archive validation and final atomic seals are not replaced. Plain text collectors and comparison-only byte counters remain independent oracles.

## Tests and acceptance

- RED tests for the missing byte-output interface and reduced actual operation dispatch, not a smaller reported counter alone.
- Exact output/SHA parity against existing `canonicalText`, text producers and native SHA across primitive/numeric/Unicode/surrogate/escape/buffer boundaries, nested arrays/objects/aliases and depth512/513.
- Refusal parity for unsupported values, descriptors/prototypes/symbols/density/cycles; paired unequal membership/types/strings and invalid equal inputs. Error/mismatch prefixes are never successful digests.
- Guard every callback-capable native/reflection boundary. Test cancellation, reentrancy, consumer exceptions, closed digest scope, borrowed buffer lifetime and zero abandoned ownership; no yield during cancellation cleanup.
- Verify emitted packets≤192bytes, processing batches≤1024visits and runtime quanta≤1024visits/64KiB. No scheduling or deadline amendment is part of this candidate.
- Fixed producer comparisons use the same real corpus/oracles. Before timing, retain the threshold of at least2x in both baseline/candidate pairs for both source and target as the gate for actual-app trials. Then judge the actual uninstrumented21MB opening/edit/switch/history/reload/retry workflow. No partial producer improvement is presented as an application speedup. Task28's rejected gate remains unchanged and its code remains archived.

## Preserved constraints

AppState32MiB/depth512/history50, existing migration/receipt limits, all independent raw/clone/loader-output/source/current checks, complete atomic seals, sole writer, and30000ms RPC/120000ms opening/5000ms saved-status deadlines remain. No new storage format, aggregate input cap, import/UI detour, dependency installation, staging/commits/deployment or existing-profile access. Implement inline; read-only review allowed.

The old temporary SQLite file was already missing before this task. Do not recreate it or claim preservation. Keep current preview and all existing artifacts; ask before destructive cleanup.

## Qualified implementation

Task29's final source `3e31cdb1…/1222` uses the bounded byte producer and batches comparison metric writes before reflection/at operation exit. Digest packet validation uses intrinsic typed-array brand and attachment checks rather than realm-specific constructor identity. Existing text/measurement/comparison-only paths remain available, including full atomic seals.

Final fixed producer campaign1791360897629 meets the2x paired gate in both stages. Actual saved21MB opening is86.797s with the complete editing/reload/retry/durable-readback flow passing; small control1.700s. This improves the prior110.950s observation but does not finish the broader cold-open performance goal. The accompanying plan records all failed/intermediate candidates, test/build evidence and preservation limitations.
