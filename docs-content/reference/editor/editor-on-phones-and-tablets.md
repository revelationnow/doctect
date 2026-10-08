---
title: Using the Editor on Phones and Tablets
summary: On a touch device the editor switches to a canvas-first layout — a pages drawer, a properties sheet or docked panel, and touch gestures for moving, resizing and editing — while desktop stays exactly as it is.
aliases: mobile, phone, tablet, iPad, touch, touchscreen
keywords: touch, pinch, zoom, fit, drawer, bottom sheet, quick format, generator toggle, long-press, double-tap, overflow menu, select multiple, multi-select, align, distribute, arrange
---

On a phone or tablet the editor rearranges itself around the canvas. Nothing changes on a computer with a mouse or trackpad, at any window size — the layout follows the device's pointer, not its width.

**Phones** show the canvas full screen under a single top bar: **☰** opens pages and templates, the project name opens your open projects (with New and Close), then a save-status icon (if a save fails, a panel with Retry and Download JSON appears under the bar), Undo, Redo and **⋯**. The **⋯** menu holds everything else — Duplicate, Delete and Clear for the current selection, Arrange (align and distribute, once two or more elements are selected), Export (PDF, all variants, greyscale), Canvas (snap, grid, preview node), Project (JSON, Generator, Save preset, SVG import and placeholder), Cloud, Account, and Home / Gallery / Docs. Properties, Layers included, live in a sheet at the bottom: tap its handle to step from a one-line summary to half height, full height and back, or drag it between those heights. While the sheet is collapsed, tools sit in a floating strip above it (it wraps to two rows on narrow screens): Select, **Select multiple**, the pan and drawing tools, and a **Fit** button that refits the page to the screen width.

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

**Selecting several elements:** turn on **Select multiple** in the tool strip (beside Select). While it is on, each tap adds an element to the selection or takes it out again, tapping a row in Layers does the same, and picking from the long-press menu adds that element; tapping empty canvas changes nothing, so use **Clear selection** in **⋯** to start over. Turning the toggle off, or switching to a drawing tool, leaves the selection as it is. With two or more elements selected, dragging any of them moves them all, the properties edit all of them at once (the −/+ steppers nudge every element), **⋯ → Arrange** aligns or distributes them, and Duplicate and Delete apply to the whole selection.

While a single text or grid element is selected, a small bar floats beside it with font size −/+, bold, italic, underline, alignment and text colour. Each tap is one undo step, and so is a colour pick, however long you drag around inside the picker.

In the **Generator**, Template and Hierarchy become two tabs at the top of a full-screen dialog; both scripts are kept when you switch, and a red dot marks the other tab when its script has an error.

**Not available on touch yet:** rotating, and drawing a selection box around several elements. Layers reorder with ▲/▼ instead of drag-and-drop. Zooming on a phone or tablet is for your screen only — it never changes the zoom saved with the project.

See [Canvas basics](/docs/editor/canvas-basics).
