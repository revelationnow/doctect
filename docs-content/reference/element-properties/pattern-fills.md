---
title: Pattern Fills
summary: Switch a shape's Fill from Solid Color to Pattern for horizontal lines, vertical lines, a grid, or dots, with Gap and Weight setting spacing and thickness.
aliases: dots, lines pattern, grid pattern, graph paper, bullet journal, dotted background
keywords: pattern, patternType, lines-h, lines-v, grid, dots, patternSpacing, patternWeight, gap, weight, bullet journal, dot grid, hatching
---

Set **Fill**'s dropdown (in **Element Properties → Appearance**) to **Pattern** and two more controls appear: a pattern-type dropdown offering **Horizontal Lines**, **Vertical Lines**, **Grid**, or **Dots** (the `patternType` field, values `lines-h`, `lines-v`, `grid`, `dots`), plus two number fields — **Gap** (`patternSpacing`, the distance between repeats) and **Weight** (`patternWeight`, line thickness for the line and grid patterns, or dot diameter for Dots). Grid is square: one Gap sets both the row and column spacing, which makes it the pattern for graph paper.

![Three rectangles showing horizontal lines, vertical lines, and dots side by side](/docs-assets/editor/pattern-fills.png "Three of the four pattern fills the dropdown can select")

Dots with a generous Gap makes a convincing bullet-journal dot grid, stored as one small repeating instruction rather than thousands of individual dot elements, so the exported PDF stays tiny no matter how fine the grid looks. **One honest gap:** the file format also defines a diagonal-line pattern (`lines-d`), and it renders correctly wherever a generator script sets it — but this dropdown does not offer it as a click-to-pick option. Only the four patterns above are reachable from the panel.

**Where the pattern lands:** every pattern is measured from the shape's top-left outer corner, under any border. Lines sit at 0, one Gap, two Gaps and so on across the shape, and dots sit where Grid lines would cross, so a dot or line falls on the shape's edge (half hidden there) whenever its size is a whole number of Gaps. The canvas, the exported PDF and the e-ink templates all place them at the same points, so a pattern you line up in the editor lines up in the export.

See [Fills and patterns](/docs/editor/elements-and-properties#fills-and-patterns).
