---
title: Using the Editor on Phones and Tablets
summary: On a touch device the editor switches to a canvas-first layout — a pages drawer, a properties sheet or docked panel, and touch gestures for moving, resizing and editing — while desktop stays exactly as it is.
aliases: mobile, phone, tablet, iPad, touch, touchscreen
keywords: touch, pinch, zoom, fit, drawer, bottom sheet, quick format, generator toggle, long-press, double-tap, overflow menu
---

On a phone or tablet the editor rearranges itself around the canvas. Nothing changes on a computer with a mouse or trackpad, at any window size — the layout follows the device's pointer, not its width.

**Phones** show the canvas full screen under a single top bar: **☰** opens pages and templates, the project name opens your open projects (with New and Close), then a save-status icon (tap it for Retry or Download JSON if a save fails), Undo, Redo and **⋯**. The **⋯** menu holds everything else — Duplicate and Delete for the current selection, Export (PDF, all variants, greyscale), Canvas (snap, grid, preview node), Project (JSON, Generator, Save preset, SVG import and placeholder), Cloud, Account, and Home / Gallery / Docs. Properties, Layers included, live in a sheet at the bottom: tap its handle to step from a one-line summary to half height, full height and back, or drag it to the height you want. Tools sit in a floating strip above the sheet (it wraps to two rows on narrow screens), ending in a **Fit** button that refits the page to the screen width.

**Tablets** keep the page header and tab strip, dock properties on the right, and gather the tools, Undo/Redo, Export PDF and **⋯** into one toolbar row; pages and templates open from **☰**.

| Gesture | What it does |
| --- | --- |
| Tap an element | Select it |
| Tap empty canvas | Clear the selection |
| Drag the selected element | Move it |
| Drag a corner or edge handle | Resize it (holding a handle still just resizes) |
| Drag anywhere else | Scroll the page |
| Double-tap text | Edit it in place; tap outside to finish |
| Long-press | Pick from the elements stacked under your finger — tapping never cycles through a stack on touch |
| Pinch / two-finger drag | Zoom and scroll |
| Tap or drag with Text or a shape tool | Create one — a tap gives a shape its default size, or a text box ready to type |

While a text or grid element is selected, a small bar floats beside it with font size −/+, bold, italic, underline, alignment and text colour. Each tap is one undo step, and so is a colour pick, however long you drag around inside the picker.

In the **Generator**, Template and Hierarchy become two tabs at the top of a full-screen dialog; both scripts are kept when you switch, and a red dot marks the tab whose script has an error.

**Not available on touch yet:** selecting several elements at once, rotating, align and distribute, and keyboard shortcuts. Layers reorder with ▲/▼ instead of drag-and-drop. Zooming on a phone or tablet is for your screen only — it never changes the zoom saved with the project.

See [Canvas basics](/docs/editor/canvas-basics).
