---
title: Delete and Nudge
summary: Remove selected elements, and move them by keyboard — one point at a time, or ten.
aliases: backspace, arrow keys, move by pixel
keywords: delete, backspace, nudge, arrow keys, move, snap, points
---

Both `kbd:Delete` **and** `kbd:Backspace` remove the selected element(s) from the canvas — no confirmation, but always undoable with `kbd:Ctrl+Z`. With nothing selected on the canvas they fall through to the sidebar: a confirmation prompt for a selected node, immediately (but still undoable) for a selected template.

**Nudge** with any arrow key moves the selection **1pt** per press, `kbd:Shift+Arrow` **10pt**. With Snap to Grid on, an arrow key moves to the next grid line instead, and `kbd:Shift+Arrow` ten grid lines. Like every shortcut here, nudging is suppressed while your cursor is in a text field.

See [Undo, clipboard, and nudging](/docs/editor/canvas-basics#undo-clipboard-and-nudging).
