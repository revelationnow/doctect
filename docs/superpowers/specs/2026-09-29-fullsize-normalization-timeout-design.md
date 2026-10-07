# Full-Size Normalization: Ten-Minute Acceptance Limit

Date: 2026-09-29
Status: Written amendment approved on 2026-09-29 through “Approve and implement (Recommended)”. The single timeout change and versioned runner are implemented. Eight focused checks pass; the actual uninstrumented full-size case passes in426387.315529ms under600000ms, and the build passes. This does not establish full-suite acceptance. See the [execution plan](../plans/2026-09-29-fullsize-normalization-timeout.md).

## Decision

Accept a longer completion budget for the existing maximum-size normalization workflow rather than promote the rejected scalar-dispatch experiment. Change only the explicit timeout of `normalization preserves original 32MiB state boundary and refuses one extra UTF-8 byte` in `tests/unit/localWorkspace/normalized/migration.test.ts` from `360_000` to `600_000` milliseconds.

This is a test acceptance-policy change, not a performance optimization or a new production timeout. The ten minutes cover the entire existing test body: fixture construction, normalization, active export/readback, and refusal of a separate source one UTF-8 byte above the limit.

The user selected this narrow alternative over giving all normalization tests ten minutes. Every other test timeout remains unchanged, including the default 5,000 ms for fresh/historical wide replay cases. Their outstanding failures are not waived.

## Scope and preserved contracts

- Application-tree executable change: exactly the one numeric timeout literal in `tests/unit/localWorkspace/normalized/migration.test.ts`. Preserve the test name, complete body, fixture sizes, assertions, cleanup, all other test bodies and configuration.
- Current runtime remains unchanged. No scalar overlay or appended scalar characterization is promoted. Production remains database v2; no existing browser profile or user data is touched.
- Validation, independent captures/seals, authority, cancellation, ownership, Work quantum, JSON/SHA chunk sizes, staging/read/derivation/retry limits and ordinary-save responsiveness requirements remain binding.
- Supplement the [bounded-normalization contract](2026-09-16-bounded-normalization-design.md) only by replacing the named test's 360-second acceptance limit. Earlier “unchanged timeout” constraints continue to apply to all other tests and budgets.
- The [Work-dispatch rejection](../plans/2026-09-28-work-operation-dispatch.md) remains final for that candidate. This amendment does not waive its failed ABBA requirements or retroactively change frozen measurements.
- Retain historical 636-pass/24-timeout results, original 360-second failures, and 900-second diagnostic receipts unchanged. A new isolated pass is not a recomputed full-suite result or proof of a speedup.
- Reuse the existing `feat/incremental-local-persistence` worktree at HEAD `8a2872d9a5acae1be3022923c4c515c70212de83`; preserve dirty predecessor files and empty index. No staging, commits, dependencies, deployment, protected-sibling changes or destructive cleanup.

## External runner

The existing `/tmp/opencode/foundation-batch-runner.mjs` independently stops full-size processes after 430,000 ms. Preserve that historical tool and its receipts. Create a versioned runner under `/tmp/opencode/doctect-incremental-sdd/` for the amended policy:

- Full-size process ceiling: **670,000 ms**, preserving the existing 70-second allowance beyond the test's deadline for startup, reporting and shutdown.
- Other process ceilings stay **180,000 ms**. Existing 5-second SIGTERM-to-SIGKILL cleanup remains unchanged and applies only to the runner's own child group.
- Preserve exact test-name selection, batching, source stamps, reporter, incomplete-run detection and failure retention. Give new output artifacts a distinct ten-minute-policy prefix; no receipt overwrite or diagnostic substitution.
- Run the actual amended test with the original repository Vitest configuration. No runtime transform, profiling, diagnostic copy, global `testTimeout` override or smaller fixture.

Older tools that assert the old application/test stamp or parse the old `360_000` literal remain historical. Do not weaken their assertions or rerun them as current acceptance. New verification records the changed test-source stamp while proving runtime files unchanged.

## Verification and result handling

1. Capture a fresh immutable dirty-tree baseline and preserve the original external runner bytes.
2. Write focused external checks first: the timeout must be exactly 600,000 ms for the named case; reversing that single literal change must restore the entire original test file. Compare the versioned runner against its predecessor, allowing only the full-size ceiling and evidence-prefix changes.
3. Verify runner selection/coverage behavior and unchanged short-case/global timeout policy. Run the actual uninstrumented full-size case once, serially, with source-stamped exclusive per-case output and a shell allowance above the 670-second process ceiling.
4. Record a pass or failure under the new 600-second policy honestly. Earlier diagnostic timings do not guarantee this pass. A timeout or other failure is retained; do not raise the limit again or retry until a pass appears without further authorization.
5. Run a build to a fresh external output, verify the exact one-literal test diff and documentation-only remainder, unchanged HEAD/index/protected resources, and update the plan/ledger. No full 660-case green claim from the focused run.

The build is a regression check, not performance evidence. Broader migration acceptance and production integration remain separate work.
