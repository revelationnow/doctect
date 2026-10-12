---
title: Using the Editor on Phones and Tablets
summary: On a touch device the editor switches to a canvas-first layout — a pages drawer, a properties sheet or docked panel, and touch gestures for moving, resizing and editing — while desktop stays exactly as it is.
aliases: mobile, phone, tablet, iPad, touch, touchscreen
keywords: touch, pinch, zoom, fit, drawer, bottom sheet, quick format, generator toggle, long-press, double-tap, overflow menu, select multiple, multi-select, align, distribute, arrange, stepper, nudge, back gesture, back button, escape, landscape
---

On a phone or tablet the editor rearranges itself around the canvas. Nothing changes on a computer with a mouse or trackpad, at any window size — the layout follows the device's pointer, not its width. A touch screen whose shorter side is under 640px is treated as a phone, so a phone keeps the phone layout when you turn it sideways (the tool strip then usually shows every tool without swiping); larger touch screens get the tablet layout whichever way they are held.

**Phones** show the canvas full screen under a single top bar: **☰** opens pages and templates, the project name opens your open projects (with New and Close), then a save-status icon (if a save fails, a panel with Retry and Download JSON appears under the bar), Undo, Redo and **⋯**. The **⋯** menu holds everything else — Duplicate, Delete and Clear for the current selection, Arrange (align and distribute, once two or more elements are selected), Export (PDF, all variants, [**Export for device…**](/docs/reference/export-for-device) for e-ink note templates, greyscale), Canvas (snap, grid, preview node), Project (JSON, Generator, Save preset, SVG import and placeholder), the Cloud and Account actions as plain rows, and Home / Gallery / Docs. Properties, Layers included, live in a sheet at the bottom: tap **Edit** at the right of its bottom bar to open it to half height and **Done** to close it again, tap the handle to step through half height, full height and closed, or drag it between those heights. With an element selected, the sheet shows that element's settings first; the page's **Node Properties** sit below them, collapsed until you tap them. While the sheet is collapsed, tools sit in a floating strip above it: Select, **Select multiple**, the pan and drawing tools in one row — swipe it sideways to reach the rest on a narrow screen — and, pinned at its right end, a **Fit** button that refits the page to the screen width. The page is also fitted to the width when a project opens and when you turn the phone.

**Tablets** keep the page header and tab strip, dock properties on the right, and gather the tools, Undo/Redo, Export PDF and **⋯** into one toolbar row; pages and templates open from **☰**.

| Gesture | What it does |
| --- | --- |
| Tap an element | Select it |
| Tap empty canvas | Clear the selection |
| Drag a selected element | Move it — and everything else that is selected with it |
| Drag a corner or edge handle | Resize it (holding a handle still just resizes) |
| Drag anywhere else | Scroll the page |
| Double-tap text | Edit it in place; tap outside to finish |
| Long-press | Pick from the elements stacked under your finger — tapping never cycles through a stack on touch |
| Pinch / two-finger drag | Zoom and scroll |
| Tap or drag with Text or a shape tool | Create one — a tap gives a shape its default size, or a text box ready to type |
| Back (the phone's back gesture or the browser's Back button) | Close what is open over the editor — a dialog, the **⋯** menu, the pages drawer or the project list — rather than leave the editor |

**Going back:** the back gesture closes one thing at a time and only leaves the editor once nothing is open. The JSON editor asks before discarding changes you have not applied — as it does when you press Escape on a device with a keyboard.

**Numbers:** position, size, rotation, Z-index, text padding and the pattern gap and weight fields get big **−** / **+** buttons on touch. A tap changes the value by one step, holding a button keeps it going, and a finger that lands on a button and slides off nudges once and then scrolls instead of holding. Each tap, and each step of a hold, is its own undo step.

**Selecting several elements:** turn on **Select multiple** in the tool strip (beside Select). While it is on, each tap adds an element to the selection or takes it out again, tapping a row in Layers does the same, and picking from the long-press menu adds that element; tapping empty canvas changes nothing, so use **Clear selection** in **⋯** to start over. Turning the toggle off, or switching to a drawing tool, leaves the selection as it is. With two or more elements selected, dragging any of them moves them all, the properties edit all of them at once (the −/+ steppers nudge every element), **⋯ → Arrange** aligns or distributes them, and Duplicate and Delete apply to the whole selection.

While a single text or grid element is selected, a small bar floats beside it with font size −/+, bold, italic, underline, alignment and text colour. Each tap is one undo step, and so is a colour pick, however long you drag around inside the picker.

**Colours:** tapping any colour swatch — Fill, Stroke, text colour, grid colours — opens a colour picker at the bottom of the screen: drag in the square to set saturation and brightness, drag the rainbow bar to set the hue, tap a recent colour or one from the palette, or type a hex code. Each pick applies straight away and is one undo step; the picker stays open for further picks until you tap **Done**, tap outside it or go back. Recent colours are remembered until you close the tab.

In the **Generator**, Template and Hierarchy become two tabs at the top of a full-screen dialog; both scripts are kept when you switch, and a red dot marks the other tab when its script has an error.

**Not available on touch yet:** rotating by dragging (the **Rot** field's −/+ still turn an element), and drawing a selection box around several elements. Layers reorder with ▲/▼ instead of drag-and-drop. Zooming on a phone or tablet is for your screen only — it never changes the zoom saved with the project.

See [Canvas basics](/docs/editor/canvas-basics).
