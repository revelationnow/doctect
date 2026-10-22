# Grids in depth: the order of operations

*Episode 19 · In depth · 02:00*

## Welcome

When a grid looks wrong, it's usually doing what it was told, in an order you didn't expect. Today: that order, on the Quarter View, and a switch that shows every cell.

## Four steps, in order

I'll click April's calendar. As in episode 7, its steps run in the order they're listed. The source and Deep Traversal find April's days, Final Data Subset, empty here, would trim them, and the offset comes last. April starts on a Wednesday, so two blank cells.

## Slice, then offset

Here's a mistake I've made. I want this calendar to show the next month, and Final Data Subset sounds right: Start Index, one.

It's still April, minus the first. The subset runs after traversal, so it trimmed a day, not a month.

Did the offset change too? The second stayed under Thursday, but blank cells don't show here, so there's nothing to count.

## Seeing every cell

Empty Cell Borders, under Grid Formatting, draws them. It needs a real cell border first, and as in episode 4, the color and width shown here are only borrowed.

So: a gray, half a point, and the switch. Three empty cells now. The offset re-read the first day left, Thursday the second. The slice ran first.

## The right step

Picking a month is traversal's job. Clear the subset, and give the first level a Start of one.

That's May. It starts on a Friday, so four bordered blanks: a first row that's mostly empty, for a good reason.

Back to zero, and April's offset is two again.

## Blank cells

Borders help with a blank grid too. A typo in Display Template, day_number instead of day_num, and every cell goes empty.

The cells are all still there, so the steps above are fine; it's what they print. Fix the name, and the numbers come back.

So: traversal, then the subset, then the offset. The export runs the same steps, and the borders print too, so keep them or switch them off.
