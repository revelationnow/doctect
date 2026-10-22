# Links: making every page navigable

*Episode 5 · Building blocks · 01:52*

## Welcome

Last time, the cover's index started linking to every recipe. But once you're on a recipe, there's no way back, and no way to the next one. Today we add the links you set yourself.

## A back link

On the Recipe template, I'll start a small navigation bar along the top: a text box that says All recipes. Small, and in the same brown.

Links live at the very bottom of Element Properties, under Interaction. The On Click menu has eight targets. This one is Go to Parent Page.

Notice it never asks for a page number. This template draws all three recipes, so a page number would be right on one and wrong on the other two. Instead, a link names a relationship, my parent, and each page works out where that is when you export.

## Next and previous

Now sideways. A Next label on the right, and its target is Go to Sibling, with an offset of 1: one step forward among the pages that share its parent.

And Previous on the left: the same target, with an offset of minus 1. It takes a minute to set up, but it happens once, on the template, and every recipe gets the whole bar.

## Links with nowhere to go

One rule is worth knowing before you export. Tomato Soup is the first recipe, so it has no previous page. A link like that isn't left pointing at nothing. The whole element is left off that page.

## Trying them

Let's export and check. Page one is still the cover, so I'll scroll on to Tomato Soup. It has All recipes, and Next, but no Previous.

Next takes us to Banana Bread, the middle recipe, which has both.

And All recipes goes back to the cover, with its index, ready for the next pick.

Next time: layers, stacking, and the finer points of styling.
