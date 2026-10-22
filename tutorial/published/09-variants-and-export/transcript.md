# Variants & export: one document, every device

*Episode 9 · Advanced · 02:28*

## Welcome

Our recipe book is A4, which is perfect for printing. But I'd like it on a reMarkable tablet too, and that's a different shape. This episode is about variants: one document, in several sizes.

## Variants

In Templates mode, the bar at the top lists variants. There is one so far, called Default. A variant is a complete set of templates for one page size. The pages and their fields are shared by every variant.

The plus adds one. I'll call it reMarkable, and choose the Paper Pro from the size list. Auto-Reflow scales every element to the new page, and Scale Typography shrinks the text along with it.

Create Variant copies every template, fitted to the new size, and switches to it.

Here's the recipe page at the tablet's size. The reMarkable page is wider for its height than A4, and reflow scales width and height separately, so the whisk got squashed. I'll make it square again: 34 by 34.

The A4 version is still there, untouched: switching between them is just this dropdown. Each variant keeps its own templates, so a fix in one never touches the other.

## Units

Sizes are stored in points, and the unit menu in Template Settings converts them. Switch to millimeters, and the tablet page reads about 180 by 240.

## Starting points

If you'll make more books like this one, Save Preset turns the whole project into a starting point. Give it a name and a short description. Everything comes along: both variants, every template, and the pages too.

It now waits in the New Project dialog, beside the built-in presets. Every project made from it is an independent copy.

## Under the hood

Everything you have built is one JSON document. The JSON button opens it, as a tree you can browse, or as plain text. It is handy for bulk changes, and Apply Changes lands any edit as a single undo step.

## Exporting every device

Export PDF prints the variant you are looking at. The All button beside it prints every variant, one PDF each, named after its variant. And the greyscale button from episode six works on all of them at once.

Here's the reMarkable copy: the same pages, with the same links, shaped for the tablet.

Next time: the generator, where a few lines of code build a whole planner.
