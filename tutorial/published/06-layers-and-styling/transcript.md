# Layers, stacking & fine styling

*Episode 6 · Building blocks · 03:51*

## Welcome

So far, everything on a page has lived on one layer, stacked in the order we drew it. This time: layers, and a few finishing touches. A border on one side, a title that is too long, some artwork, and a greyscale proof.

## Layers

Here's the Recipe template, and the Layers panel, just above Element Properties. Every template starts with one layer, and everything we've drawn is on it, listed front to back.

I'll make it two. Double-click the name to rename it: Background. The plus adds a new layer on top, which I'll call Content.

The card stays on Background, and everything else moves up. Click the first row, Shift-click the last one above the card, and then Move to, Content.

Now lock Background. A locked layer still prints. It just ignores the mouse, so clicking the page no longer grabs the card, and I can work on top of it without nudging it by accident.

## Notes that never print

Layers are good for notes to yourself, too. A third layer, Notes, with a reminder on it. The newest layer is also the active one, shaded blue, so that's where the text box lands.

Click the eye to hide the layer. It's gone from the canvas, and from the PDF too. Hide your notes before you export, and they never ship.

## A border on one side

I'd like a thin rule under the Serves line. Per-Side Borders, in Appearance, draws a border on just the sides you choose. Customize, then switch off top, right and left, and make the bottom orange.

One trap here. The PDF only draws per-side borders when the box's own Stroke has a color and a width, and a text box starts with neither. The canvas shows the border either way, so give Stroke a color, and a width of 1.

## Long titles

Long titles are next. In the hierarchy, I'll give the Pad Thai a longer name: Weeknight Pad Thai with Crispy Tofu. On the page, the end of it is simply cut off.

Back on the template, I'll preview the Pad Thai and select its title. Overflow, under Typography, decides what happens when text doesn't fit. Clip is the default. Ellipsis ends it with three dots. Shrink makes the text smaller until it fits, which is usually what a title wants.

The long name spills out of the grids too: the strip along the bottom here, and the index on the cover. Grids have their own setting, Cell text overflow. Shrink, for both. Only the cells that need it get smaller; the rest keep their size.

## Artwork

Artwork can come in as SVG. New things land on the active layer, the one shaded blue, and that is still Notes, which is hidden. So first I click Content. Then, from the SVG tools menu, Import SVG file, and pick a whisk.

It's a real vector, so it stays sharp at any size, and it keeps its own colors, so this one arrives in the same brown. I'll make it 40 points square, and tuck it under the heading.

## A greyscale proof

Most e-ink tablets show only shades of grey. The contrast button beside Export PDF switches the export to greyscale, so you can check that pale colors still show up before the file goes onto a device.

The peach becomes a light grey, the orange rules turn grey too, and the shaded row in the index still stands out. On the last page, the long title fits, the whisk is crisp, and the note we hid is nowhere to be seen.

Next time: real calendars, where every month starts on the right weekday.
