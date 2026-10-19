# Narrow desktop windows use the narrow layouts — design

Date: 2026-10-19 · Branch: `feat/narrow-window-layouts` (from `main` 83ca3a4)

## Problem

A mouse/trackpad editor window keeps the three-column desktop layout at every width. Below about
1000px the sidebar (288px default) and properties panel (320px default) squeeze the canvas to
nothing. This was deliberate: the mobile editor spec
(`docs/superpowers/specs/2026-09-23-mobile-editor-design.md`) made "changing narrow *desktop*
windows" a non-goal, because the form factor is decided by the pointer first
(`(pointer: coarse)` false → always `desktop`). The owner now wants narrow desktop windows to fall
into the tablet and phone layouts.

## Goal

- A mouse window narrower than 1024px gets the **tablet layout** (sidebar in a drawer, properties
  docked right, one toolbar row); narrower than 640px it gets the **phone layout** (top bar,
  properties sheet, tool pill).
- **Layout only** (owner's choice "A"): everything about *input* stays desktop — normal-size
  controls, hover row actions, mouse drag/resize/double-click on the canvas, the native colour
  picker, the browser Back button leaving the editor, and keyboard shortcuts.
- A mouse window 1024px or wider renders today's desktop DOM unchanged.
- Touch devices behave exactly as today.

## Non-goals

- Fit-based switching (switching when the canvas would drop below a minimum width given the
  user's panel widths). Owner chose fixed breakpoints.
- Height-based switching for mouse windows: a short, wide window stays desktop.
- New narrow UI: the existing tablet and phone layouts are reused as they are.
- Pages outside the editor.

## Decisions

| Question | Decision |
|---|---|
| What a narrow mouse window changes | Layout only; input stays desktop |
| Breakpoints | Fixed: mouse width ≤ 1023px → tablet, ≤ 639px → phone; height ignored |
| Architecture | Split the form factor into `layout` (from viewport) and `input` (from pointer) |
| Rejected | A responsive desktop layout (collapsing desktop panels): new UI, a second narrow design to maintain |

## Architecture

### Detection — `hooks/useEditorFormFactor.ts`

`useEditorFormFactor()` returns `EditorMode = { layout: FormFactor; input: InputMode }`, where
`FormFactor = 'desktop' | 'tablet' | 'phone'` (unchanged) and `InputMode = 'mouse' | 'touch'`.

Pure rule, `detectEditorMode(coarsePointer, viewport)`:

- `input = coarsePointer ? 'touch' : 'mouse'`.
- Touch: `layout` is today's rule — shorter side ≤ `PHONE_MAX_SHORT_SIDE` (639) → `phone`,
  otherwise `tablet`.
- Mouse: `viewport.width ≤ MOUSE_PHONE_MAX_WIDTH` (639) → `phone`;
  `≤ MOUSE_TABLET_MAX_WIDTH` (1023) → `tablet`; otherwise `desktop`. Height is not read.

Invariant: `input === 'touch'` implies `layout !== 'desktop'`.

The hook reads four media queries — `(pointer: coarse)`, the existing `PHONE_QUERY`,
`(max-width: 639px)` and `(max-width: 1023px)` — and re-reads on a change of any of them.
`detectFormFactor` is replaced by `detectEditorMode`; the `read()` helper hands the rule a
viewport equivalent to what the queries matched, as it does today.

**Keyboard hold (ruling R40) is touch-only.** Today a change that arrives while an editable
element has focus is held until focus leaves (plus `KEYBOARD_SETTLE_MS`), because a soft keyboard
resizes the viewport. That hold applies only when the pointer is coarse — both before and after
the change. A mouse window has no soft keyboard, so its resize applies at once even with a field
focused. A pointer-type change itself (rare: a convertible detaching its keyboard) is applied at
once.

### Context — `components/editor-layout/FormFactorContext.tsx`

- `FormFactorProvider` takes `value: EditorMode`.
- `useFormFactor()` keeps its name and returns the **layout**. Every existing caller that means
  layout keeps working unchanged.
- New `useInputMode(): InputMode` returns the input. Default outside a provider: `'mouse'`
  (matching today's `'desktop'` default).
- `<html>` attributes:
  - `data-form-factor="tablet" | "phone"` carries the layout; absent on desktop. It is now also
    set for narrow mouse windows.
  - New `data-input="touch"`, set only for touch input; absent for mouse.

### Touch CSS — `index.html` (`touch-editor:start` … `touch-editor:end`)

Each rule moves to the attribute matching what it is for:

| Rule | Scope after |
|---|---|
| 44px min size for `button`, `[role="button"]`, `select` | `[data-input="touch"]` |
| 16px text for `input`, `select`, `textarea` (stops iOS zoom) | `[data-input="touch"]` |
| Reveal `group-hover` actions (`.opacity-0[group-hover:opacity-100]`, `.hidden[group-hover:flex]`) | `[data-input="touch"]` |
| `[data-color-popover]` sizing | `[data-input="touch"]` |
| `input[type="color"] { pointer-events: none }` (TouchColorPickerHost owns taps) | `[data-input="touch"]` |
| Phone full-screen `.editor-dialog-panel`; generator dialog panel sizing (phone and tablet) | `[data-form-factor…]` (unchanged) |
| Phone top-bar status/alert rules | `[data-form-factor="phone"]` (unchanged) |
| Phone `[data-canvas-content]` padding | `[data-form-factor="phone"]` (unchanged) |
| Phone `[data-touch-pill-scroller]` rules | `[data-form-factor="phone"]` (unchanged) |
| `[data-editor-shell] { height: 100dvh }` | `[data-form-factor]` (unchanged; `dvh` equals `vh` on desktop browsers) |

The block's comment is updated to describe both attributes.

### Call sites

**Follow layout** (`useFormFactor()`):

- `components/editor-layout/EditorLayout.tsx` — Desktop / Tablet / Phone layout choice.
- `pages/EditorPage.tsx` — hide the page header on phone.
- `components/HierarchyGeneratorModal.tsx` — split panes only on the desktop layout.
- `components/export/DeviceExportDialog.tsx`, `components/JsonModal.tsx` — full screen on phone.
- `components/PropertiesPanel.tsx` — element settings first when an element is selected (the
  narrow docked strip or the sheet). Its other touch uses, if any, follow input.
- `components/ProjectEditor.tsx`:
  - `touchActions` (feeds the tablet toolbar, phone top bar, **⋯** menu and tool pill) is built
    whenever `layout !== 'desktop'`, so the narrow chrome works with a mouse.
  - `useTouchMultiSelect` is enabled whenever `layout !== 'desktop'` (the toolbar's Select
    multiple button needs it; Ctrl/Shift+click keeps working).
  - `countPick` on sidebar picks (closes the drawer) whenever `layout !== 'desktop'`.
  - Zoom: whenever `layout !== 'desktop'` the canvas uses the session viewport
    (`useTouchViewport`: `scale`, `setScale`, `fitSignal`), as touch does today. The saved desktop
    zoom (`state.scale`) is too big for a narrow window; it is neither read nor written while
    narrow, so the desktop gets it back at ≥ 1024px.
  - `inputMode` passed to `Canvas` comes from `useInputMode()`.

**Follow input** (`useInputMode() === 'touch'`):

- `components/Canvas.tsx` `inputMode` behaviours: touch gestures, `touch-action: none`, tap-to-place
  default sizes, the quick format bar, keep-edited-element-visible, double-click to edit, padding,
  `touchScale` on handles.
- `components/LayersPanel.tsx` — wrapped rows and ▲/▼ reorder buttons (a mouse can drag).
- `components/sidebar/NodeItem.tsx`, `components/sidebar/TemplateItem.tsx` — the row **⋯** sheet
  (a mouse gets hover actions).
- `components/properties/SingleElementEditor.tsx`, `components/properties/TextPaddingControls.tsx`
  — 44px stepper grids.
- `components/color/TouchColorPickerHost.tsx` — in-app colour picker (a mouse keeps the native one).
- `components/editor-layout/useBackDismiss.tsx` — `BackDismissProvider` and `useBackDismiss`: to a
  mouse user the browser Back button means "leave". The drawer and sheet already close on Escape
  and a backdrop click.

**Canvas fit decoupled from input.** `useTouchFit` today runs only when `inputMode === 'touch'`.
It runs whenever `fitSignal` is passed (which `ProjectEditor` does exactly when the layout is not
desktop), so a narrow mouse window fits the page to its width on open, on Fit, and on layout
change. Wheel / Ctrl+wheel zoom keeps working through `onZoom`, which writes the session viewport
while narrow.

Keyboard shortcuts are not gated by form factor today and stay available at every width.

## Transitions and edge cases

- Crossing a breakpoint swaps the layout live (media queries fire once per crossing; no debounce).
  Document state, selection, active variant and open dialogs live in `AppState` or above the
  layout and survive. The drawer starts closed and the sheet starts at peek, as on rotation today.
- Panel widths (`sidebarWidth`, `propertiesPanelWidth`) are not touched by the narrow layouts; the
  desktop layout gets them back.
- A panel resize drag in progress when the desktop layout unmounts is cancelled, so the resize
  state cannot stick.
- Inline text editing open while crossing: the canvas remounts under a new parent. The edit must
  be committed, not lost. The plan verifies today's unmount behaviour and fixes it if it drops
  the edit.
- Window crossing 1024px while a modal is open: the modal reflows (phone full-screen rules apply
  below 640px).
- Touch devices: unchanged in every respect, including the R40 hold.

## Testing

Unit (Vitest):

- `detectEditorMode` table: coarse and fine pointer × widths 600, 639, 640, 800, 1023, 1024, 1440;
  a mouse window 1440×500 stays desktop; a touch 844×390 stays phone; the touch ⇒ non-desktop
  invariant.
- Hook: a mouse width change applies immediately with an input focused; the touch hold (R40)
  tests stay green unchanged.
- Provider: `data-form-factor` set for a narrow mouse window; `data-input="touch"` only for touch;
  both removed on unmount.
- Each input-following call site: mouse + tablet/phone layout gives the desktop input behaviour
  (no row ⋯ sheet, no ▲/▼, no 44px grid, native colour input, no back-dismiss history entry).
- `ProjectEditor`/`Canvas`: mouse + narrow layout uses the session viewport and fits; mouse
  `inputMode`.

E2E (Playwright, Chromium, mouse — no `hasTouch`):

- 900×800: tablet toolbar and drawer; sidebar rows show hover actions; buttons are not 44px; a
  canvas element drags with the mouse.
- 600×800: phone top bar and properties sheet.
- Resize 900 → 1440: desktop layout returns with the saved zoom and panel widths.
- `tests/e2e/desktop_layout_guard.spec.js` (1440×900) stays green with no snapshot updates.
- Existing touch e2e suites run unchanged.

## Docs

- Mobile spec (`2026-09-23-mobile-editor-design.md`): amend the goal "Mouse/trackpad users see
  today's editor at every window size" and the narrow-desktop non-goal with a pointer to this spec.
- `docs-content/reference/editor/editor-on-phones-and-tablets.md`: replace "Nothing changes on a
  computer with a mouse or trackpad, at any window size" with the breakpoints, and say that a
  narrow mouse window keeps mouse behaviour (hover actions, normal-size controls, mouse editing).
- Regenerate the onboarding bundle (`node onboarding/build.mjs`) as the last commit.
