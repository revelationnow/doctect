# Mobile editor follow-ups — implementation plan

**Branch:** `feat/mobile-editor` (worktree `.worktrees/mobile-editor`), on top of 2b82b02.
**Spec:** `docs/superpowers/specs/2026-09-23-mobile-editor-design.md` (binding), amended by the user decisions below.
**Previous plan + ledger:** `docs/superpowers/plans/2026-09-23-mobile-editor.md`; rulings R1–R38 in `.superpowers/sdd/2026-09-23-mobile-editor/progress.md` still hold unless this plan overrides them.

## User decisions (2026-10-08)

1. Touch gets **multi-select**: a "Select multiple" toggle in the touch tool strip. While it is on, tapping an element adds it to the selection or removes it.
2. Touch gets **touch-sized −/+ steppers** beside numeric property fields. They replace the hidden micro-steppers (this overrides R24's "hide only").
   - A tap nudges by one step; holding repeats.
   - With several elements selected, every selected element is nudged by the same delta (relative), exactly like the desktop micro-steppers.
3. On touch, the **back gesture closes the open overlay** instead of leaving the editor.
   - Overlays covered: full-screen dialogs (JSON, Generator, visual preview, New project), the ⋯ overflow sheet, the pages drawer and the project switcher.
   - The JSON editor asks before discarding unapplied changes.
   - Desktop is unchanged: no history entries.
4. Fix the remaining minor issues (Tasks 21–23).

## Global constraints (unchanged from the first plan)

- **Desktop must not change.** The desktop DOM snapshot (`tests/unit/ProjectEditor.desktopLayout.test.tsx`) and `tests/e2e/desktop_layout_guard.spec.js` (chromium) pass after every task. Never update their snapshots.
  - Exception: the JSON modal's Escape key (Task 21) is an approved desktop behaviour change.
  - Accessibility-only attributes on desktop are acceptable but must be reported.
- **Touch commits.** Every touch edit commits through the existing Canvas/ProjectEditor commit helpers and the interaction lifecycle. The incremental editor (production) emits intents, and the legacy path still works. Never call `onUpdateElements` directly from new touch code.
- **No persisted-state or schema change.** Touch never writes `state.scale`, `sidebarWidth` or `propertiesPanelWidth`.
- **Scoped CSS.** Touch CSS stays inside the `/* touch-editor:start|end */` block in `index.html`, scoped under `[data-form-factor]`. It is guarded by `tests/unit/touchCss.test.ts`.
- **Touch sizing.** Touch targets are ≥ 44px; touch form controls use a 16px font.
- **Thin hunks.** Keep hunks in `ProjectEditor.tsx`, `Canvas.tsx`, `PropertiesPanel.tsx`, `LayersPanel.tsx` and `EditorPage.tsx` thin. New behaviour goes in new files under `components/editor-layout/`, `components/canvas/` or `hooks/`.
- **Security boundary.** `tests/unit/localWorkspaceBoundary.test.ts` must pass. If it flags new browser-global use, restructure the code. Never loosen a pin silently.

---

### Task 18: Touch −/+ steppers for numeric fields

**Files:**
- Modify: `components/properties/SingleElementEditor.tsx` (the numeric input with `data-micro-stepper`).
- Modify: `components/properties/TextPaddingControls.tsx`.
- Possibly create: `components/properties/TouchStepper.tsx`.
- Modify: the touch CSS block.
- Tests: unit.

**Requirements:**
- On touch (`useFormFactor() !== 'desktop'`), each numeric field that has a desktop micro-stepper renders as `[−] [input] [+]`.
  - The buttons are 44×44px. The input stays editable with a 16px font.
  - The field must still fit the properties sheet (phone, 320–430px wide) and the docked tablet panel. Where the current grid is too tight, the field may take a full row on touch.
  - Desktop markup and classes are unchanged.
- **Interaction:**
  - Use pointer events (`pointerdown` starts, `pointerup`/`pointercancel`/`pointerleave` stop).
  - A tap calls the existing `onNudge(±step)` once. Holding repeats with the same delay and rate as desktop.
  - The buttons must not focus the input or open the on-screen keyboard (`preventDefault` on `pointerdown`).
  - The buttons carry `aria-label`s, e.g. "Decrease X" / "Increase X".
- **Undo:** match how desktop's stepper commits history (one undo step per press, or per hold if desktop groups holds). Verify on both editor paths and with a multi-element selection: every element moves by the same delta, and mixed values stay mixed.
- Remove the `[data-micro-stepper]` hide rule only if the desktop stepper is no longer rendered on touch. Either way, the hidden 12px steppers must not be tappable on touch.
- **Tests:**
  - Touch renders the −/+ buttons and desktop doesn't.
  - Tap nudges once; hold repeats (fake timers).
  - Multi-selection nudges each element relatively.
  - Incremental path emits intents.
  - Desktop snapshot unchanged.

### Task 19: Touch multi-select

**Files:**
- New: hook/state in `components/editor-layout/`.
- Modify: `TouchToolButtons`, `Canvas.tsx` (thin), `LayersPanel.tsx` (thin), `OverflowMenu.tsx`, `TabletToolbar.tsx`.
- Modify: docs (`docs-content/reference/editor/editor-on-phones-and-tablets.md`).
- Tests: unit + mobile e2e.

**The toggle:**
- A **Select multiple** toggle button (44px, `aria-pressed`) sits in the phone tool pill and in the tablet toolbar row.
- It is session-only editor state, never persisted.
- Turning it off keeps the current selection. Switching to a non-select tool turns it off.

**While the toggle is on:**
- Tapping an element toggles it in or out of the selection, using the same selection-update path as desktop Ctrl/Cmd-click.
- Tapping empty canvas does nothing. Clearing the selection needs a dedicated **Clear selection** action, shown in the selection label or the ⋯ menu.
- Tapping a Layers row toggles that element.
- Choosing from the long-press stack menu adds the picked element.

**With 2+ elements selected:**
- **Moving:** dragging any selected element moves all of them, reusing Canvas's existing multi-element drag path (desktop already supports it). Multi-element moves still emit intents on the incremental path.
- **Resizing:** the group selection box shows the touch-sized handles if desktop supports group resize; otherwise it shows no handles. Match desktop capability; don't invent new behaviour.
- **Properties:** the sheet or panel shows the existing multi-edit properties ("N items selected", mixed values). The Task 18 steppers nudge every element.
- **Quick format bar:** stays single-element only (unchanged).
- **Delete/Duplicate:** the ⋯ "Delete selection" / "Duplicate" actions apply to the whole selection.
- **Align & distribute:** now reachable on touch, so expose the existing desktop actions:
  - phone: an "Arrange" group in ⋯;
  - tablet: in its ⋯ or toolbar.
  - Use the same handlers as `EditorToolbar`, no duplicated logic.
  - Update the spec's "not shown on touch" line and the docs page.

**Tests:**
- Unit: toggle, tap-toggle, empty-tap no-op, Layers toggle, multi drag (one interaction, intents), Arrange visibility at ≥2.
- Mobile e2e (phone + tablet chromium): enable Select multiple, tap two elements, drag one and both move, then Arrange → Align left lines them up.

### Task 20: Back gesture closes touch overlays

**Files:**
- New: `components/editor-layout/useBackDismiss.ts` (or similar).
- Modify: `JsonModal`, `HierarchyGeneratorModal`, `GeneratorVisualPreviewModal`, `NewProjectModal`, `OverflowMenu`, `SidebarDrawer`, `ProjectSwitcher`. Each gets a one-line hook call that is a no-op on desktop.
- Tests: unit + e2e.

**Requirements:**
- On touch, opening an overlay pushes one history entry. Back (`popstate`) closes the topmost open overlay and stays on `/app`.
- Closing the overlay any other way (X, Cancel, Apply, backdrop, selection) consumes its history entry, so history does not accumulate. Use `history.back()` guarded by "our entry is current".
- Nested overlays (⋯ menu → JSON dialog) unwind one per back.
- **Router interop is the main risk.** The app uses `createBrowserRouter` (react-router v6 data router) and `EditorPage` uses `useBlocker(hasUnsavedWork)`.
  - Raw `pushState` without the router's `idx`/`key` state can break its popstate delta handling or trigger the blocker.
  - Investigate first. Prefer pushing through the router (e.g. `navigate(sameLocation, { state: { ...current, overlay: id } })`), or carry the router's history state forward.
  - Prove that back with an overlay open neither triggers the unsaved-work blocker nor remounts the editor.
  - Prove that back with no overlay open behaves exactly as before, including the blocker.
- **JSON editor:** when it has unapplied changes, back asks for confirmation ("Discard JSON changes?"). Cancelling keeps the dialog open and restores the history entry.
- **Desktop:** the hook does nothing (no history entries).
- **E2E (phone + tablet chromium):**
  - Open ⋯ → JSON, `page.goBack()`: the JSON dialog closes, ⋯ is still open (or closed, per nesting rule) and the URL stays `/app`.
  - Back again closes ⋯.
  - Open the drawer, back: it closes.
  - The editor state is intact throughout.

### Task 21: Minor fixes A

1. **Landscape phones.** The form factor is phone when the pointer is coarse and the viewport's *shorter* side is < 640px, i.e. `(max-width: 639px), (max-height: 639px)`. Otherwise it is tablet when coarse.
   - Update `hooks/useEditorFormFactor.ts`, `detectFormFactor` and its tests.
   - Update the spec line and the docs.
   - Check the phone layout at 844×390: top bar, pill, sheet peek and canvas all usable. Add a landscape e2e (phone chromium with a landscape viewport).
2. **JSON modal Escape key.** Escape closes the JSON modal on all form factors (approved desktop change). With unapplied changes, it confirms the same way Task 20's back does. Unit test.
3. **Cloud and Account in the phone ⋯ sheet** render as sheet rows instead of the desktop popovers that open in-flow over other groups.
   - Reuse the same actions and handlers; give `CloudMenu`/`AccountMenu` an "inline/list" rendering mode or extract their items.
   - Desktop and tablet unchanged. Unit + e2e (rows visible, an action fires).
4. **`EditorChrome` value** in `pages/EditorPage.tsx` is memoised with the correct deps (behaviour-neutral).

### Task 22: Minor fixes B

1. **Focus traps.** `SidebarDrawer` and `OverflowMenu` (`role="dialog" aria-modal="true"`) trap Tab focus while open. `ProjectSwitcher` uses consistent menu roles: either all rows are `menuitem`s including close, or it becomes a listbox/dialog. Unit tests.
2. **Drawer close on re-select.** Re-selecting the already-selected page or template in the drawer closes it (bump a counter folded into `navigationKey`, per the T12 review note). Unit test.
3. **Format bar re-clamp.** The quick format bar re-clamps when the sheet detent changes or the pill resizes; observe the `[data-touch-chrome]` elements with `ResizeObserver`. Fix the `CONTENT_WIDTH` 444 vs 442 constant and the wrong "248px" comment in `QuickFormatBar.tsx`. Unit test.
4. **Colour chip.** The format bar's colour control keeps a 44px hit target but draws a smaller swatch (e.g. 24px) inside it.

### Task 23: Test hardening, docs, verification

1. **Double-tap e2e.** Dispatch both taps within one CDP/`evaluate` sequence (or with explicit timestamps) so the 300ms window can't be missed under load.
2. **Generator dialog e2e.** Run the sandbox preview only at the device width; keep the layout and hit-target assertions at all five widths.
3. **Docs.** `docs-content/reference/editor/editor-on-phones-and-tablets.md` covers:
   - multi-select;
   - steppers;
   - Arrange;
   - back gesture;
   - landscape phones use the phone layout.
   Update the device checklist with: back gesture on iOS swipe-back and Android back, multi-select drag, steppers hold-to-repeat, and landscape phone. `docsAntiRot` passes.
4. **Full verification:**
   - full unit suite;
   - `tsc`;
   - `localWorkspaceBoundary`;
   - mobile spec (both chromium mobile projects);
   - chromium `desktop_layout_guard`;
   - full desktop `--project=chromium` suite.
5. **Onboarding bundle.** Regenerate it with `node onboarding/build.mjs` as the branch's final commit.
