# Smart guides, absolute grid snapping and a settable grid size — design

Date: 2026-11-02. Branch: `feat/smart-guides`. Approved in conversation section by section (rules, performance, controls/edge cases/testing).

## Intent

What the user asked for:

- **Smart guides** — while moving, resizing or drawing, objects snap to other objects' edges and centres and to the page's edges and centre, with guide lines showing what snapped. Extras chosen: **equal spacing**, **size matching on resize**, **distance labels**. (Data Grid inner cell lines as targets: not chosen.)
- **Absolute grid snapping** — an object's edge lands on a grid line. Today only the drag *displacement* is rounded (`Canvas.tsx` move :1209, resize :1253, line end :1278), so an off-grid object stays off-grid.
- **A settable grid size** — today `effectiveGridSize` (`Canvas.tsx:444`) follows zoom (10/5/1 pt).
- Robust across layers, on busy pages, and on desktop, tablet and phone.
- **Must not slow the UI** (explicit user concern) — see Performance; this is a hard requirement with a measured budget.

Decisions made with the user:

- Snap targets: **all visible layers, including locked ones**; hidden layers never.
- Grid size: **per project, pt only**.
- Smart guides get their **own switch**, default on.
- Align/distribute buttons are fixed to respect rotation, sharing the new bounds helper.

## Global constraints

- Units: page units (pt) everywhere in the engine; screen-px thresholds are divided by the current `scale`.
- Pull distance: **6 screen px for mouse input, 10 screen px for touch input** (input mode from `useInputMode()`, not layout).
- `gridSize` range **1–200 pt, step 0.5**, default **10**. `smartGuides` default **true** (also for existing projects with no stored value).
- Snapped coordinates are rounded to **0.01 pt**.
- Temporary bypass: **Alt/⌥ held**, sampled on every move event.
- No change to the document schema (`CURRENT_SCHEMA_VERSION` stays 12); the new fields are preferences.
- Performance budget (Performance section) is a release gate.

## Architecture

A pure engine plus thin integrations.

### `services/geometry/elementBox.ts` (new, shared)

- `elementAabb(el, nodes, currentNodeId): Box` — axis-aligned outer box of an element in page units, honouring `rotation` and `transformOrigin` (default 0.5/0.5) and Data Grid expansion via `getElementBounds` (`components/canvas/elementBounds.ts:67`). `Box = { x, y, w, h }`.
- `unionBox(boxes): Box`.
- Replaces the private copies in `Canvas.tsx` (`getGroupBounds` :377-423, rotated bounds :519-560) where behaviour is identical; `services/alignElements.ts` switches from raw `x/y/w/h` to `elementAabb` (align/distribute move by the AABB delta, so a rotated element's visible box is what aligns).

### `services/snapping/` (new, pure, no React)

- `types.ts` — `SnapTargets`, `SnapSettings { grid: number | null; guides: boolean; threshold: number }`, `Guide` (discriminated union: `align` line with span, `spacing` brackets with gap, `size` label with matched element ids, `distance` label).
- `targets.ts` — `buildSnapTargets({ elements, layers, excludeIds, page: {w,h}, nodes, currentNodeId }): SnapTargets`.
  - Includes elements whose layer is visible (locked included; untagged elements count as visible, matching `sortElementsForRender`), excluding `excludeIds`.
  - Per axis: sorted `Float64Array` of unique positions (edges and centres) with, per value, kind (`edge` | `centre` | `page`) and up to 20 source boxes (nearest kept) for drawing guide spans.
  - Page targets: 0, w/2, w and 0, h/2, h.
  - Zero-width/height boxes contribute one position on that axis (edge = centre).
  - Sorted widths and heights with source ids (size matching).
  - Rows/columns for equal spacing: for each target box, its nearest neighbour gaps along x among boxes overlapping it in y (and vice versa), precomputed once, nearest 8 per box.
- `snapMove(targets, box, settings): SnapResult` — moving box at its raw position → `{ dx, dy, guides }` correction.
- `snapResize(targets, box, movingEdges, settings)` — only the moving edges snap; size matching applies to the dimension being resized.
- `snapPoint(targets, point, settings, constraint?)` — line ends and drawing; with a 45°/square constraint only the dominant axis snaps and the other is derived.
- Per axis, candidates are collected and the **closest within threshold wins**; ties break **object edge > centre > page > equal spacing > size match**. With `grid` set, **the grid always wins** (amended 2026-11-02 after user testing; it replaced "a guide within reach wins over the grid"): only candidates whose result keeps the grid's feature (move: left/top edge; resize: moving edge; point: the point) on a grid line are considered, the best of those wins by the same priority, and when none is in range the feature snaps to the nearest grid line. Off-grid candidates (a Letter page centre at 306, a 55 pt object's centre at x.5) never pull. Alignment guides are still drawn when the grid-snapped box lines up with a target. Grid origin is the page's top-left.
- Equal spacing (move only): snap the gap to an existing neighbouring gap in the same row/column, or centre between the two nearest neighbours.
- Guide output capped: at most 2 align guides per axis plus the winning spacing/size marker.

### Canvas integration (`components/Canvas.tsx`)

- A `snapSessionRef` holds `SnapTargets` for the current gesture. Built **lazily on the first move past the drag threshold** (never on press), only if `snapToGrid || smartGuides`; cleared on mouseup, `cancelInteraction`, Escape, `onMouseLeave` end, touch long-press cancel, and pinch takeover.
- Move (:1160-1230): replace delta rounding with `snapMove` on the selection's union AABB (single or multi; Ctrl-drag copies included, originals are targets). Custom pivot follows the corrected delta.
- Resize (:1240-1300): axis-aligned elements (rotation ≡ 0 mod 90) use `snapResize`; other rotations keep today's local-delta grid behaviour and show no guides. Group resize uses the group box.
- Line endpoint (:1278): `snapPoint` on the dragged end.
- Creation (:725, :984): `snapPoint` for start and current point, honouring the existing Ctrl/Meta/Shift constraint.
- Rotation, pivot drag and marquee: unchanged.
- Alt held on a move event → settings with `grid: null, guides: false` for that event.
- Guides are React state set **in the same event as `updateGeometry`** so React renders once per move.
- Threshold = (input is touch ? 10 : 6) / `scale`, recomputed per move (zoom can change mid-drag).

### Guide overlay (`components/canvas/SnapGuides.tsx`, new)

- One absolutely positioned `<svg>` child of `ReadOnlyPagePreview` (page units, inside the scaled layer), `pointer-events: none`, above selection handles.
- Stroke width 1/scale (mouse) or 1.5/scale (touch); one accent colour token; labels with font size and padding divided by `scale` so they read the same at any zoom.
- Distance labels: gap in pt to the neighbour aligned with, whole numbers when whole, else one decimal.
- On touch, labels are placed to avoid a 44-screen-px circle around the active pointer.
- `React.memo` on the guides array identity; renders nothing when empty.

### Grid display (`Canvas.tsx:1936-1945`)

- Dots at `gridSize`. When `gridSize × scale < 8` px, draw every k-th dot with k the smallest of 2, 5, 10, 20, 50… making spacing ≥ 8 px. Snapping always uses `gridSize`.
- `effectiveGridSize` is removed.

### Arrow nudge (`ProjectEditor.tsx:235-255` legacy, :1542-1547 incremental)

- Snap on: Arrow moves the selection's AABB edge to the next grid line in that direction (if already on a line, one step); Shift+Arrow moves 10 grid steps.
- Snap off: unchanged (1 pt, Shift 10 pt). Guides never affect nudging.

## Preferences

- `AppState.gridSize?: number`, `AppState.smartGuides?: boolean` (`types.ts` beside `snapToGrid` :186).
- Classified `'preference'` in `services/document/partition.ts` (exhaustive map :8-35; defaults :309), `EditorPreferences`/patch types (`services/document/contracts.ts`), preference-lane allow lists (`services/localWorkspace/incrementalQueue.ts:250`, `services/localWorkspace/normalized/repository.ts:2766`, `services/document/layerFolds.ts:178`), history defaults (`services/document/history.ts:26`).
- Read through one helper `snapSettingsOf(state)` that applies defaults (`gridSize ?? 10`, `smartGuides ?? true`) and clamps `gridSize` to 1–200 rounded to 0.5.
- Not part of the document: cloud saves, gallery, generator and PDF output are unaffected.

## Controls

### Desktop (`components/EditorToolbar.tsx:153-156`)

- Magnet and Show Grid buttons unchanged.
- New chevron button next to the magnet (`aria-haspopup`, title "Snapping options") opens a **Snapping** popover: switches Snap to grid / Smart guides / Show grid; **Grid size** number input (pt, 1–200, step 0.5, invalid input reverts on blur) with quick picks 2 · 5 · 10 · 20; hint "Hold Alt to move without snapping" (⌥ on macOS). Escape and outside click close it.
- Both the incremental (`preferences(...)`) and legacy (`setState`) paths are wired, like the existing buttons.

### Tablet and phone (`components/editor-layout/OverflowMenu.tsx:121-123`)

- Canvas group: Snap to grid, **Smart guides**, Show grid (checked items), and a **Grid size** row: − / value / + stepper (step 1 pt, 0.5 below 2) and quick-pick chips 2 · 5 · 10 · 20, all ≥ 44 px targets. Toggles keep the sheet open, as today.
- `TouchEditorActions` (`touchActions.ts`) gains `toggleGuides`, `setGridSize`, `gridSize`, `smartGuides`; built in `ProjectEditor.tsx:1809`.
- Narrow mouse windows use these layouts and get the same controls; their pull distance follows input mode (6 px).

## Edge cases

- **Layers**: hidden layers never targets; locked layers are targets but their elements cannot be dragged; layer visibility changes during a gesture apply from the next gesture.
- **Busy pages**: equal positions merged; ≤ 20 sources per position (nearest kept) for drawing; ≤ 2 align guides per axis; off-page elements remain targets.
- **Shapes**: zero-size lines one position; rotated elements by AABB; Data Grids by full table size; text by its box.
- **Multi-select / Ctrl-drag**: union box snaps; Ctrl-drag originals are targets; the clone race fix (`cloneDragRef`) is preserved.
- **Wobble**: no snapping below `MIN_DRAG_THRESHOLD`; a click never builds targets.
- **Cancel paths**: Escape, pointer cancel, long press, second finger (pinch), mouse leaving the canvas — guides cleared, geometry reverted/kept exactly as today.
- **Undo**: one group per gesture as today; guides never stored.
- **First move off-grid**: the object jumps onto the grid (expected); rounding to 0.01 pt.
- **Empty page**: page edges/centre still snap.
- **Existing projects**: defaults apply (`gridSize` 10, guides on); stored projects need no migration.
- **Zoom mid-gesture**: threshold recomputed each move.
- **Alt on Linux desktops** that use Alt+drag for window moves: those grab Alt held *at press*; pressing Alt after the drag starts reaches the page. Documented.

## Performance (release gate)

- Engine idle when both switches are off; no work on press, click or sub-threshold wobble.
- Target build once per gesture, O(n log n); per-move query O(log n) per feature + ≤ 8 spacing neighbours.
- One React render per move (guides set with geometry); overlay ≤ ~12 SVG elements.
- **Baseline first** on current `main`: Playwright benchmark dragging on pages with 40, 500 and 2,000 elements, Chromium, CPU throttled 4×, desktop and touch emulation; records per-move handler time and frame time p50/p95.
- **Budget**: engine adds ≤ 1 ms per move at 2,000 elements (throttled); p95 drag frame time ≤ 5% worse than baseline at every size; snapping-off and click paths unchanged.
- **CI guard**: unit micro-benchmark, 1,000 queries against 2,000 targets under a generous limit.
- Before/after numbers reported to the user. Memoising `CanvasElement` during drags is a separate optional follow-up, not part of this work.

## Testing

- Engine unit tests: every snap kind, priority and ties, thresholds at several scales, rotated/zero-size/Data Grid boxes, merged targets, caps, grid rounding, Alt settings, micro-benchmark.
- `elementBox` tests; `alignElements` tests extended for rotated elements.
- Canvas integration (`tests/unit/canvasTestUtils.tsx`): move/resize/line end/draw, multi-select, Ctrl-drag, Alt, locked vs hidden layers, cancel paths, guides rendered then cleared; touch via the existing touch test harness.
- Preferences: `gridSize`/`smartGuides` persist through the incremental lane and reload; popover and ⋯ sheet stay in sync; nudge follows grid.
- E2E (Chromium): desktop drag onto a guide and onto the grid with a custom size; mobile and tablet emulation finger drag snaps and the ⋯ sheet controls work.
- Benchmark before/after.
- Docs: `docs-content/reference/editor/snap-to-grid.md`, `docs-content/reference/shortcuts/delete-and-nudge.md` updated; new `docs-content/reference/editor/smart-guides.md`; screenshots refreshed via the docs-capture pipeline.

## Out of scope

Data Grid inner cell lines as targets; pivot snapping; marquee snapping; guide snapping during rotation; haptics; memoising canvas elements; user-placed ruler guides.
