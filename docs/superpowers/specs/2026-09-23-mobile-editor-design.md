# Mobile & Tablet Editor — Design

**Date:** 2026-09-23
**Branch:** `feat/mobile-editor` (worktree `.worktrees/mobile-editor`)
**Status:** Design approved in brainstorming; awaiting written-spec review

## Problem

The project editor is a fixed three-column layout (`components/ProjectEditor.tsx`, the
`flex flex-1 overflow-hidden` block): sidebar at `state.sidebarWidth` (default 288px), canvas
`flex-1`, properties panel at `state.propertiesPanelWidth` (default 320px). On a 390px phone the
two side columns alone need ~608px, so the canvas collapses and every area overlaps. Canvas input is
mouse-only (`onMouseDown/Move/Up`, wheel zoom), hover-revealed row actions are unreachable, and the
page header hides the Cloud and Account menus below `sm`, so on phones they cannot be reached at all.

## Goals

- Phones and tablets get a usable editor: navigate pages/templates, select, **move, resize**, edit
  text inline, change properties, create text boxes and shapes, format text quickly, export PDF,
  reach cloud/account actions, and use the Generator.
- **The desktop UI does not change.** Mouse/trackpad users see today's editor at every window size.
- Structure the work so fuller touch editing (multi-select, rotation, alignment) can be added later
  without reshaping it.

## Non-goals

- Touch marquee multi-select, modifier-key behaviours (Alt/Shift/Ctrl), rotation handles.
  (Tap-based multi-select and alignment/distribute on touch were added by the 2026-10-08
  follow-ups; see "Select multiple" under Tablet.)
- Keyboard-shortcut hints on touch.
- Phone-optimised code editing in the Generator beyond the pane toggle and full-screen layout.
- Changing narrow *desktop* windows — they keep today's layout (see Form-factor detection).
- Any schema or persisted-state change.

## Decisions

| Question | Decision |
|---|---|
| Capability level | Light edits now, structured for full touch editing later — expanded during review to include move, resize, text/shape creation and a quick formatting bar |
| Devices | Phones and tablets |
| Phone layout | Full-screen canvas + properties bottom sheet + sidebar drawer |
| Layout trigger | Touch-primary device first (`(pointer: coarse)`), then the viewport's shorter side picks phone vs tablet |
| Architecture | Layout-slot shell (`EditorLayout`) reusing existing panels; not CSS-only, not a forked mobile editor |
| Generator on touch | Template and Hierarchy become separate views with a toggle |
| Sequencing | Spec and plan now; implementation starts from `main` after `feat/incremental-local-persistence` merges |

## Architecture

### Form-factor detection — `useEditorFormFactor()`

Returns `'desktop' | 'tablet' | 'phone'`:

- `matchMedia('(pointer: coarse)')` false → always `desktop`, regardless of width.
- Coarse pointer and the viewport's *shorter* side `< 640px` → `phone`, i.e.
  `(max-width: 639px), (max-height: 639px)`, so a phone held in landscape (844×390) keeps the phone
  layout; coarse pointer otherwise → `tablet`.
- Subscribes to both media queries so rotation and resizes update it.
- Sets `data-form-factor="<value>"` on `document.documentElement` for `tablet` and `phone` only;
  the attribute is absent on desktop. All touch CSS is scoped under it, so desktop CSS is unaffected.
  Setting it on `<html>` (not the layout root) lets it reach modals, which render outside the layout.
- The editor route is the only consumer; the attribute is removed when the editor unmounts so other
  routes (gallery, docs, landing) are unaffected.

### `EditorLayout` (new, `components/editor-layout/`)

`ProjectEditor` replaces its three-column block with
`<EditorLayout formFactor sidebar canvas properties toolbar actions … />`. Slots are the existing
elements (`<Sidebar/>`, `<Canvas/>`, `<PropertiesPanel/>`, `<EditorToolbar/>`); `actions` is a
plain object of the existing handlers (undo, redo, export, export all variants, greyscale toggle,
open JSON, open Generator, save preset, import SVG, insert SVG placeholder, toggle snap/grid,
preview-node selection).

- **desktop** — renders today's markup exactly, including `state.sidebarWidth`,
  `state.propertiesPanelWidth` and the mouse resize handles. Guarded by a DOM snapshot recorded
  before the refactor.
- **tablet** — canvas + properties docked right at a fixed 320px (no resize handle). Sidebar is an
  overlay drawer from the left, opened by ☰, closed by outside tap, Escape, or selecting a
  page/template.
- **phone** — full-screen canvas. Sidebar is the same left drawer. Properties live in a bottom
  sheet with detents *peek* (selected element name/type), *half* (canvas above, properties below)
  and *full*. Selecting an element opens the sheet at peek; tapping empty canvas closes it. Layers
  stays inside the sheet (it is already a `PropertiesPanel` slot). The peek row ends in a labelled
  **Edit**/**Done** toggle (peek ↔ half), because a bare grabber did not read as openable (T24).
- On touch with a selection, `PropertiesPanel` shows the element's settings first and Node/Template
  Settings below, collapsed (session-only state; desktop order and expansion unchanged) (T24).
- Drawer and sheet are presentational wrappers; their content is the unchanged `Sidebar` and
  `PropertiesPanel`.
- On rotation: close the drawer, keep the sheet detent, re-fit the canvas.

### Viewport zoom on touch

`state.scale` is part of the persisted project `AppState`. Touch layouts therefore own a local
viewport scale inside `EditorLayout` and pass it to `Canvas` as `scale`/`onZoom`; they never write
`state.scale`, `state.sidebarWidth` or `state.propertiesPanelWidth`. A phone pinch must not change
how the project opens on desktop. The page fits the canvas width on first load and on rotation; a
fit button resets it. On phone the canvas wrapper's `p-12` becomes a small gutter (scoped CSS).

### Touch CSS

Tailwind is loaded from the CDN (`index.html`) and there is no CSS build step, so scoped touch rules
live in the existing `<style>` block of `index.html`, all under `[data-form-factor]` selectors:

- interactive controls get a minimum 44px hit area;
- `input`, `select`, `textarea` get a 16px font size so iOS Safari does not auto-zoom on focus;
- hover-revealed controls become visible (see Hover-only controls);
- `.editor-dialog-panel` goes full-screen on phone (see Dialogs).

## Touch input

### `useCanvasTouchGestures(viewportRef, handlers)`

A pointer-event hook that only reacts to `pointerType === 'touch'` and normalises input into
`tap`, `doubleTap`, `longPress`, `pan` and `pinch`, with explicit movement and time thresholds.
A second pointer cancels any in-progress one-finger interaction and becomes pinch/pan. Future
full-touch editing adds handlers here without changing the hook's shape.

### Canvas integration

`Canvas` gains `inputMode: 'mouse' | 'touch'` (default `'mouse'`, so desktop takes exactly today's
code path). In touch mode:

- The viewport gets `touch-action: none`; compatibility mouse events emitted after touches are
  ignored so they cannot start drags or marquees.
- One-finger drags are routed into the **existing** `handleMouseDown/Move/Up` as pointer events with
  pointer capture. Those handlers read only `clientX/Y`, `button`, modifier keys and `target`, all of
  which `PointerEvent` provides, so move, resize, snapping and history reuse the desktop code.
- Hit-testing, locked/hidden-layer rules and the existing double-click edit path are reused through
  small extracted helpers, not duplicated.
- `SelectionHandles` gains a `touch` prop that adds invisible 44px hit zones around each handle;
  the visible handles are unchanged and desktop output is identical.

### Gesture mapping

| Gesture | Select tool | Text / shape tool |
|---|---|---|
| Tap element | Select; sheet opens at peek | – |
| Tap empty canvas | Deselect; close sheet | Create default-size element at the tap point |
| One-finger drag on the selected element | Move | – |
| One-finger drag on a resize handle | Resize | – |
| One-finger drag on empty canvas or an unselected element | Pan | Draw the element |
| Double-tap text or grid | Inline text edit | – |
| Long-press | Open existing `SelectUnderMenu` for stacked elements | – |
| Two fingers | Pinch-zoom around the midpoint + pan | Same |

Only the already-selected element is draggable, so scrolling a crowded page never moves things by
accident. Tools available on touch: Select, Hand, Text, rect, ellipse, triangle, line, grid. After
creating an element the tool reverts to Select, as on desktop.

### Quick formatting bar

When a text or grid element is selected or being edited, a floating bar appears just above it
(below if there is no room): font size −/+, bold, italic, underline, left/center/right alignment,
text colour. It calls the existing `onUpdateElements` only (no new state), tracks the element through
pan and zoom, and hides during drags and pinches.

### Inline editing baseline

Double-tap goes through the gesture hook (iOS does not fire `dblclick` reliably). While
`OverlayTextEditor` is active, the sheet drops to peek and the edited element is scrolled into the
`visualViewport` area not covered by the keyboard. Tapping outside commits the edit.

## Toolbars and header

New touch-only components call the same `actions`; desktop JSX is untouched.

### Phone

- One ~48px top bar that **replaces both** the `EditorPage` header and the `ProjectEditor` editor
  bar on phone: ☰ (drawer) · project name ▾ (project-tab switcher with New/Close, replacing the
  tab strip) · save-status dot (tap for retry/download on failure) · undo · redo · ⋯.
- ⋯ opens an overflow sheet grouped as **Export** (Export PDF, Export all variants, Greyscale),
  **Canvas** (Snap to grid, Show grid, Preview node), **Project** (JSON, Generator, Save Preset,
  Import SVG, SVG placeholder), **Cloud** (existing `CloudMenu` actions), **Account** (existing
  `AccountMenu`), **Navigate** (Home, Gallery, Docs — the page header's links, since the top bar
  replaces that header on phone).
- A floating tool pill sits above the sheet while it is at peek or closed:
  Select · Hand · Text · rect · ellipse · triangle · line · grid · fit. Hidden when the sheet is at
  half or full. One row at every width (R43, superseding R29's wrapping): the tools swipe sideways
  inside the pill when the screen is narrower than them, with edge fades on the side that has more,
  and Fit is pinned outside the scrolling part.

### Tablet

- Keeps the desktop page header including the tab strip.
- The editor bar and `EditorToolbar` collapse into one row: ☰, tools, undo/redo, Export PDF, ⋯ for
  the rest. No floating pill.

Alignment/distribute requires two or more selected elements. The 2026-10-08 follow-ups added a
**Select multiple** toggle beside Select in the tool strip (phone pill and tablet toolbar; session
state, never persisted, off whenever the tool is not Select): while it is on, canvas taps and
Layers rows toggle elements in and out of the selection, a long-press pick adds the picked
element, and empty-canvas taps are inert. The ⋯ sheet then gains **Clear selection** (in the Selection group) and, at two or more
selected, an **Arrange** group running the desktop toolbar's align/distribute handlers.

## Dialogs, panels, hover-only controls

- **Large dialogs** (`JsonModal`, `HierarchyGeneratorModal`, `GeneratorVisualPreviewModal`,
  `NewProjectModal`) get a shared `editor-dialog-panel` class. Under
  `[data-form-factor="phone"]` it makes them full-screen with `dvh` heights and no rounding. Small
  confirm dialogs already fit (`w-full max-w-md p-4`) and are unchanged.
- **Generator on touch (phone and tablet):** full-screen, with a **Template | Hierarchy** segmented
  toggle in the header showing one editor pane at full width. The inactive pane stays mounted but
  hidden, preserving cursor, scroll and drafts. Scripts already live in `templateScript` /
  `hierarchyScript` state, so Run, Apply and dirty tracking are unchanged. If a run error belongs to
  the hidden script, its toggle segment shows a red dot. Desktop keeps the side-by-side panes.
- **Hover-only controls** (`sidebar/NodeItem`, `sidebar/TemplateItem`, `TabBar`, `json/JsonTreeItem`,
  `json/MainCollectionItem`, `properties/SingleElementEditor`, `properties/TextPaddingControls`):
  one scoped rule makes `opacity-0 group-hover:*` controls visible under `[data-form-factor]`.
- **Layer reordering:** `LayersPanel` uses HTML5 drag-and-drop, which is unreliable on phones. Touch
  adds ▲/▼ buttons per row that call the same reorder logic.
- **Context menus:** only the canvas has one (`SelectUnderMenu`), covered by long-press.

## Testing

### Desktop-unchanged guards (written first)

- DOM snapshot of `ProjectEditor`'s layout under a fine pointer, recorded before the refactor; the
  `EditorLayout` desktop branch must match it exactly.
- Playwright `toHaveScreenshot` baselines of the desktop editor (blank project, planner preset,
  element selected, Generator open), recorded from `main` before any mobile code.
- A unit test proving touch pinch and fit never modify `state.scale`, `sidebarWidth` or
  `propertiesPanelWidth`.
- Existing e2e specs keep running on the desktop Chrome/Firefox/Safari projects unchanged.

### Unit (vitest + jsdom)

- `useEditorFormFactor`: pointer × width matrix, rotation, `<html>` attribute set/cleared, attribute
  removed on unmount.
- `useCanvasTouchGestures`: synthetic pointer events with fake timers; tap / double-tap / long-press
  / drag thresholds; second pointer cancels one-finger actions.
- `Canvas` touch mode: drag selected element moves it with exactly one history entry; handle drag
  resizes; drag on an unselected element pans; Text tool creates on tap and on drag; compatibility
  mouse events are ignored.
- `EditorLayout` phone/tablet: drawer open/close paths, sheet detents on select/deselect, drawer
  closes on page pick.
- Quick formatting bar: each control issues the expected `onUpdateElements` patch.
- Generator toggle: switching keeps both drafts; error dot on the hidden pane.
- Hover-reveal guard: fails on any new `opacity-0 group-hover` in the listed components without the
  touch fallback.

### Mobile e2e (Playwright)

- New `mobile-phone` (iPhone 13) and `mobile-tablet` (iPad) projects with `hasTouch`, on Chromium and
  WebKit.
- Flows: open project, tap-select, drag-move, handle-resize, double-tap text edit, pinch zoom (via a
  CDP session `Input.dispatchTouchEvent` on Chromium, as Playwright has no multi-touch API; pinch is
  Chromium-only), drawer, sheet, ⋯ menu, Export PDF.
- Layout assertions at 390px and 768px: no horizontal document scroll; top-bar controls do not
  overlap.

### Manual device checklist

iOS Safari and Android Chrome: keyboard covering the edited element, focus zoom, address-bar
resize, rotation, long-press not triggering the system selection callout.

### Docs

New reference entry `docs-content/reference/editor/editor-on-phones-and-tablets.md` (gestures,
intentional gaps, Generator toggle), covered by `tests/unit/docsAntiRot.test.ts`.

## Merge-conflict constraints

`feat/incremental-local-persistence` has large uncommitted edits to `ProjectEditor.tsx`,
`Canvas.tsx`, `PropertiesPanel.tsx`, `LayersPanel.tsx`, `EditorToolbar.tsx` and
`playwright.config.cjs`. Therefore:

- Implementation starts from `main` **after** that branch merges.
- Touches to those files are kept to thin hunks: `ProjectEditor` swaps one JSX block for
  `EditorLayout`; `Canvas` gains the `inputMode` prop, the touch branch and extracted helpers;
  `LayersPanel` gains the touch ▲/▼ buttons; new behaviour lives in new files.
- `EditorPage.tsx`, `index.html` and the modal files are not touched by that branch.

## New files (expected)

- `hooks/useEditorFormFactor.ts`
- `hooks/useCanvasTouchGestures.ts`
- `components/editor-layout/EditorLayout.tsx` (desktop/tablet/phone branches)
- `components/editor-layout/SidebarDrawer.tsx`, `PropertiesSheet.tsx`
- `components/editor-layout/TouchTopBar.tsx`, `TouchToolPill.tsx`, `OverflowSheet.tsx`,
  `ProjectSwitcher.tsx`
- `components/canvas/QuickFormatBar.tsx`
- `tests/e2e/mobile_editor.spec.js` and the unit tests above
- `docs-content/reference/editor/editor-on-phones-and-tablets.md`
