# Canvas Font Readiness Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans and test-driven-development. Implement inline; no implementation handoff, staging or commits. Read-only review is allowed.

**Goal:** Remove redundant canvas text-layout invalidation during normal navigation without retaining fallback font measurements or changing document/history behavior.

**Status:** The readiness-shortcut experiment below is rejected, not promoted. Native p95 did not improve (208ms baseline,216ms intermediate,536ms final experimental run), while profiling identified the synchronous `FontFaceSet.ready` getter—not its promise callback—as the expensive acquisition. Original hook restored exactly; its conservative font-loading semantics remain. Experiment/review/benchmark artifacts are retained. Execute Task2 instead: move existing session ownership outside the gesture-reset key, using the already-supported injection seam.

**Architecture:** An internal stable `EditorCanvas` owns the existing text-layout session and injects it into the unchanged keyed Canvas. Gesture ownership still remounts with the same context key; bounded text metrics and the font subscription survive normal navigation until the stable owner unmounts. Original readiness, later font-load invalidation and cleanup remain unchanged. No global readiness tracker or new cache is introduced.

**Tech Stack:** Existing React hook, Font Loading API, Vitest/Testing Library and isolated Chromium fixture. No new dependency or browser install.

## Global Constraints

- Continue `.worktrees/incremental-local-persistence`, branch `feat/incremental-local-persistence`, HEAD `8a2872d9a5acae1be3022923c4c515c70212de83`; preserve dirty predecessor and empty index.
- Baseline: `/tmp/opencode/doctect-incremental-sdd/task-15-font-readiness-baseline`, application/test/config `c5b9651f6c8c24461a523630295e7405a3ea0ec1b17eb894b09a4982b21ac554`/1197files.
- Promoted runtime scope only `components/ProjectEditor.tsx`; tests `tests/unit/ProjectEditor.incrementalChanges.test.tsx` and `tests/unit/canvasFixedTextLayout.test.tsx`. The original hook is restored byte-for-byte. Plans/ledger and external diagnostic assets are separate.
- Do not remove Canvas context-epoch remounts: they fence stale gestures and editor ownership. No visual redesign, data-model change, persistence change, cross-editor cache, deadline increase or production cutover. Existing bounded caches remain per stable editor-canvas owner.
- Existing5000ms/10000ms test defaults,30000ms transport, history50,32MiB/depth512 and all storage/Work budgets remain unchanged.
- Original responsiveness target remains p95 input-to-next-paint below100ms. Whole-page long tasks and instrumented profiles are not persistence attribution or release acceptance.

## Measured Basis

`/tmp/opencode/doctect-sticker-private-1791024358100/report.json` passes all42 functional actions on pinned21,152,284-byte fixture. Five measured Templates/Hierarchy samples contain10 observed interactions: Event Timing durations64–208ms, subset p95208ms, max whole-page long task187ms. Command `node /tmp/opencode/doctect-incremental-sdd/check-sticker-navigation.mjs /tmp/opencode/doctect-sticker-private-1791024358100/report.json` fails the existing100ms target.

Focused current-build profiles `/tmp/opencode/doctect-sticker-nav-profile-1791024976484/{1,2}-navigation.cpuprofile` and matching traces exclude automation role queries from the sampled click. React root work accounts for68.7–73.7% of active samples; the font-ready effect accounts for16.6–19.9%; document snapshot projection is≤0.6%. JS-only trace time is113.7–123.3ms versus47ms rendering. Profiles are diagnostic, not speed measurements. No storage or cooperative Work redesign follows from these findings.

## Rejected Task 1: Guard Redundant Initial Readiness Invalidation

Historical experiment only; do not execute or promote these steps. Its runtime and experiment-specific tests were removed; source/patches and every result remain in external artifacts. The injected-session ownership regression remains relevant to Task2.

**Files:** modify `components/canvas/useCanvasTextLayoutSession.ts` and `tests/unit/canvasFixedTextLayout.test.tsx`.

**Interface preserved:** `useCanvasTextLayoutSession(injectedSession?: CanvasTextLayoutSession): CanvasTextLayoutSession`.

- [ ] Add a failing hook regression with a genuinely already-loaded font set. After awaiting its already-resolved readiness, render count stays1, session identity stays stable, and a second identical layout request hits the existing measurement cache:

```ts
const fonts = Object.assign(new EventTarget(), { status: 'loaded', ready: Promise.resolve() });
// First mount observes fulfillment; the next mount represents real navigation.
// Install the same document.fonts fixture and measurement spy used by existing hook tests.
session.layout(baseRequest, 'first');
await act(async () => { await fonts.ready; });
expect(renderCount).toBe(1);
session.layout(baseRequest, 'cached');
expect(fakeCanvas.context.measureText).toHaveBeenCalledTimes(1);
```

- [ ] Add safety cases for loading at first measurement but loaded before effect attachment; a readiness-promise change while status returns to loaded before effect attachment; later `loadingdone`; injected-session ownership; and returning from injection to an owned session. Existing missing-API, deduplication and unmount contracts stay intact.
- [ ] Run `npx vitest run tests/unit/canvasFixedTextLayout.test.tsx --maxWorkers=1`; preserve intended RED before changing the hook.
- [ ] Store the font snapshot alongside the owned session. Refresh that snapshot before the first measurement of each ownership period, not on every render. Use the exact guard below around the existing `ready.then` callback; leave the existing event listener and cleanup path unchanged:

```ts
const alreadyReady = initialFonts?.loaded === true
    && initialFonts.fulfilledBeforeMeasurement
    && fonts === initialFonts.fonts
    && fonts?.status === 'loaded'
    && ready === initialFonts.ready;
if (!alreadyReady) {
    void ready?.then(() => {
        if (initialReadinessHandled) return;
        initialReadinessHandled = true;
        refreshLayout();
    });
}
```

- [ ] Run the full hook/layout suite and affected Canvas/preview/editor/history suites at unchanged limits. Run typecheck, build and exact boundary checks; report known StickerPressTS2339 separately.
- [ ] Rebuild and rerun `node --experimental-strip-types /tmp/opencode/sticker-private-browser.mjs` on the same pinned fixture. Compare functional outcomes, native Event Timing and whole-page long tasks; do not substitute automation-plus-two-frame duration for INP or erase remaining threshold failures.
- [ ] Obtain read-only review against the immediate snapshot, record exact source/test/native evidence and preserve all failed receipts. Promote only a correctness-preserving change with demonstrated work/performance benefit; do not claim all responsiveness or release gates closed.

**Reviewed race refinement:** `FontFaceSet.ready` may synchronously flush layout and start a load, so acquire its promise before reading status. Also, status can initially be loaded while readiness is pending; that pending promise may be reused when measurement starts a load. Status/promise identity alone is insufficient. Preserve the old refresh unless fulfillment was observed before measurement. Both races have explicit failing regressions; the optimization applies to subsequent known-ready mounts, not an unproven first observation.

## Task 2: Stable Session Owner Outside the Gesture Key

This supersedes Task1; no readiness heuristic or global promise tracker remains. Runtime scope is now only `components/ProjectEditor.tsx`, plus `tests/unit/ProjectEditor.incrementalChanges.test.tsx` and one injected-session ownership test in `tests/unit/canvasFixedTextLayout.test.tsx`. `useCanvasTextLayoutSession.ts`, cache limits, Canvas implementation and persistence stay unchanged.

- [x] Add a real ProjectEditor regression that switches Hierarchy/Templates: Canvas DOM must still be replaced by its context key, but the real text-layout factory and font-readiness getter must not run again; cache is cleared on actual font load and owner unmount, not navigation. Assert no document write from font events.
- [x] Observe RED with `npx vitest run tests/unit/ProjectEditor.incrementalChanges.test.tsx --maxWorkers=1 -t 'text-layout ownership'`.
- [x] Add an internal stable wrapper and pass the existing session injection prop to the keyed Canvas. It adds no DOM node and leaves interaction remount semantics intact:

```tsx
function EditorCanvas({ contextKey, ...props }: React.ComponentProps<typeof Canvas> & { contextKey?: string }) {
    const textLayoutSession = useCanvasTextLayoutSession();
    return <Canvas key={contextKey} {...props} textLayoutSession={textLayoutSession} />;
}
// In the unchanged conditional render position:
// <EditorCanvas contextKey={contextKey} ...existingCanvasProps />
```

- [x] Verify actual editor navigation/Undo/Redo, text-layout/font-loading/injected ownership and unmount cleanup. Rebuild/repeat the same pinned42-action browser fixture and its native Event Timing gate.
- [x] Review this smaller ownership delta, run affected tests/typecheck/build/boundary checks, and report exact evidence without claiming remaining performance or release gates closed.

## Verified Ownership Checkpoint

Promoted code adds only an internal wrapper, import and prop handoff in `ProjectEditor.tsx`. `git diff --exit-code -- components/canvas/useCanvasTextLayoutSession.ts` confirms the original font hook is unchanged. No speculative readiness state, WeakMap or render-time readiness getter remains. Tests demonstrate **three→one** session constructions/readiness acquisitions across initial render plus Templates/Hierarchy navigation, while the inner Canvas DOM is genuinely replaced. Existing font events invalidate metrics; owner unmount clears caches/removes its listener; font events emit no document changes.

Read-only review `ses_efe786f14ffeq16bywsl26GRNE` is scoped clear for the smaller ownership delta (`task-15-font-owner-review-01.md`). Full normalized text-layout request keys and width keys support reuse; cache bounds and gesture guards remain unchanged. Earlier readiness experiments were reviewed/fixed but rejected on measured outcome, not silently left in production. Their RED/GREEN receipts, `task-15-font-readiness-review-01..04.md`, source snapshots and browser artifacts remain preserved.

### Verification

| Complete disjoint receipt under `/tmp/opencode/doctect-incremental-sdd` | Result | Source |
| --- | --- | --- |
| `task-15-font-owner-canvas-final-01.jsonl` | 187PASS /14files | A |
| `task-15-font-owner-editor-final-02.jsonl` | 333PASS /3files | B |
| `task-15-font-owner-boundary-final-01.jsonl` | 956PASS /1file | A |
| **Qualified aggregate** | **1476PASS /18files** | Same runtime; test-only correction |

- A: `89b42341e3902e2a8efc991bc4e0b04e7b9995790789450d07af12f28f17082f`/1197files.
- B, current: `24cb334690d00441c3022a3fd1f126f719f7ab398309e7e860b6421e8993184e`/1197files.
- A→B only removes two unsupported Testing Library `exact` options from the new test; string role-name matching is already exact. No application/config change. Entire333-case editor group rerun; earlier333PASS receipt preserved. Aggregate is explicitly not a single-stamp campaign. Existing parsers independently reconcile disjoint inventories, terminal counts, unchanged5000/10000 defaults and one worker, with no skipped/retry/missing/module/unhandled outcomes.
- Production build `task-15-font-owner-build-01`: **PASS11.43s/2468modules**, existing warnings. Fresh typecheck: only known StickerPress793:36TS2339. Impeccable detector over changed UI file returns `[]`; no design/visual changes made.

### Browser evidence and open goal

All use identical pinned21,152,284-byte fixture SHA `604d08d40fa4e4641d50d8cefc708a91ff946b3a3185ffb90b4cb6fb3b4e8a22` and42 actual ProjectEditor actions. Five measured navigation samples provide10 uncensored Event Timing interactions; no zero timings fabricated.

| Artifact directory under `/tmp/opencode` | Functional | Navigation subset p95 | Decision |
| --- | --- | --- | --- |
| `doctect-sticker-private-1791024358100` | 42PASS | 208ms | Current baseline |
| `doctect-sticker-private-1791026247884` | 42PASS | 216ms | Intermediate readiness heuristic, rejected |
| `doctect-sticker-private-1791059340326` | 42PASS | 536ms | Final readiness heuristic, rejected |
| `doctect-sticker-private-1791060364911` | 42PASS | 200ms | Stable ownership; deterministic work benefit |

Final owner run's measured navigation whole-page max long task is175ms. The **<100ms navigation gate remains red**. The unpaired208→200ms observation is not a statistically established speedup, whole-page INP, persistence-attributed timing or release acceptance. The stable owner is justified by the direct real-editor work regression and preserved functional behavior, not a claim that responsiveness is finished. Further work must address measured render/DOM costs; neither persistence budgets nor previous migration/timing/browser limitations are waived.
