# Real calendars: offsets, slicing & traversal

*Episode 7 · Advanced · 03:16*

## Welcome

Back to the 2026 planner from episode one. Its calendars are grids, with a problem the recipe index never had: day 1 has to land under the right weekday, and that's a different column every month.

## The calendar problem

This is the Month View template, previewing January. Thirty-one days in seven columns, with Monday first. And January the first sits under Thursday, after three blank cells.

## Dynamic offset

Click the calendar, and find Offset, under Grid Configuration. Static would skip the same number of cells in every month. This one is set to Dynamic.

Dynamic reads a field from the first day, weekday_num, and adds the number beside it: minus one. weekday_num starts counting at Sunday, which is zero, so Thursday is 4. This calendar starts on Monday, not Sunday, hence the minus one. Four, minus one: three blank cells.

Switch it to Static, and day 1 drops back into the first cell, under Monday. Back to Dynamic, and it moves to Thursday again. That one setting does all the work.

February is the interesting one. It starts on a Sunday, weekday zero, so the sum is minus one. A negative offset wraps around once, by the number of columns, and day 1 lands in the last column, where Sunday belongs.

## Slicing

Final Data Subset takes a window of a list. The year page shows it best: two grids, one source, the seven sections under the year. The first grid takes four, starting at zero: the quarters.

The second skips four and takes three: Weeks, Notes and To-Do Lists. Same children, two windows, no overlap.

## Reaching grandchildren

Now let's add a little calendar of January to this page. G for grid, and drag out some room under the lists.

Its source is the year itself, and the year's children are quarters, not days. Deep Traversal walks further down. Add Level, and take one child, starting at zero: Quarter 1.

Another level, one child again: January. And a third level with no count, so it takes every day. Three levels down, from the year to its days.

Now the cells are January's days, showing their full titles. To make a calendar, the Display Template becomes day_num, just the number. Then seven columns, small gaps, and small cells: 28 by 18 points, with 9 point text.

And the same dynamic offset as Month View: weekday_num, minus one. January the first moves across to Thursday.

Change the second level to start at 1, and it's February, wrapped round to start on Sunday. And every cell is a link to its own day page.

## When a grid goes blank

One last tip. Ask a level for a child that isn't there, a fourth month in a quarter, say, and the grid has nothing to show. The editor fills it with Item placeholders, there's no error, and the PDF would show nothing. So when a grid goes blank, check the hierarchy before the grid.

Next time: references, and how one page can appear in two places at once.
