# Buried elements and stacking

*Episode 18 · In depth · 02:58*

## Welcome

Episode 6 put the dotted card on a locked Background layer, under everything else. Today I'll lighten its dots without touching the lock or nudging what sits on top. And we'll see what decides which element ends up in front.

## Click again

First, the cover. Nothing is locked here, and the card lies under the title. Click the title, and you get the title. Click again on the same spot, and the selection steps down a level, to the card.

One more click wraps back to the title. That's the quickest way when you're already on the top element. One catch: a click on the dot in the middle doesn't step down. That's the pivot, so click beside it.

## Alt-click

Alt-click, or Option-click on a Mac, digs the same way but never grabs, so nothing can move by accident. Alt-click the subtitle: you get the subtitle. Again, same spot: the card.

## The right-click menu

When the pile is deep, or things look alike, right-click, or two-finger click on a trackpad. The menu lists everything under the pointer, top to bottom, with its type and its layer.

Hover a row, and its element is outlined on the page, so you know which is which. Click Rect, and the card is selected.

Now the job. In Appearance, Fill, I'll take the paler peach of the circle. The dots step back, and the title hasn't moved.

## The Layers panel

On to the recipe pages. Here the card sits on Background, which we locked in episode 6. Right-click the title, and only the title is listed.

All three canvas tricks skip locked and hidden layers. That's what locking is for. Escape closes the menu.

The Layers panel skips nothing. Under Background, click Rect, and the card is selected, even though its layer is locked.

No handles, so it can't be dragged or resized. But Element Properties works as usual. Fill: the same paler peach.

Background is still locked, and nothing else has moved.

## Layer order beats Z-Index

While the card's selected, look at Geometry. Its Z-Index is 1. Click the title's row: its Z-Index is 1 as well.

Same number, yet the title is on top, because layer order counts first. Everything on Content sits in front of everything on Background.

Z-Index only sorts elements within one layer. Watch: I'll give the card 99. Nothing moves; it stays under Content. Control Z puts it back.

To bring something forward past a layer, move it there with Move to, or drag its layer up by the grip.

## The result

Let's export. The PDF is drawn a layer at a time, back to front, in the same order as the canvas.

On the cover, lighter dots. And on a recipe page, lighter dots too, still under every word.

So: click again for what's right underneath. Alt-click when nothing may move. Right-click to see the whole pile, and use the Layers panel for anything locked or hidden. Next time: the order a grid does things in.
