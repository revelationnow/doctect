# Grids from the ground up

*Episode 7 · Building blocks · 06:00*

## Welcome

The calendars in a planner are grids. Today we'll build one on an empty page, one setting at a time, and look at what each setting does before adding the next.

## The project

Here's the project, made ahead of time with the generator, which episode 10 covers. A cover called Q4 2026, three months under it, and a Notes page. Every month has a page for each of its days.

Click a day, and its data fields show on the right. Two matter today. day_num is the date, and weekday_num is the day of the week as a number: four, for this Thursday.

## One cell per child

The months share a template called Month, and it's nearly empty: a title, and a row of weekday letters, Monday first. I'll fold Template Settings away to make room.

G for the grid tool, and drag out a box under the letters.

A grid draws one cell for each child of its page. October's children are its 31 days, so there are 31 cells, each showing a title.

The Source decides whose children a grid shows. The other option pins a grid to one fixed page. We'll keep Children of Current Page.

Current means whichever page is being drawn. Preview November, and the grid follows: 30 cells now. Then back to October.

## Columns, cells and gaps

First, let's make the cells visible. White cells on white paper are hard to see, so they get a pale grey fill. And the black outline round the whole grid can go.

Cols sets how many cells sit in a row. A week has seven days, so: seven.

They're far too wide, because W and H, in Geometry, are the size of one cell, not the whole grid. The letters are 60 points apart. So W is 58, leaving two for a gap, and H is 60.

Gap X and Gap Y are the space between cells. Two points each. Fifty-eight plus two is sixty, and every column now sits under its letter.

## What each cell says

Display Template decides what each cell says, and it starts as title. The buttons below insert the days' fields, but they add to what's in the box, so I'll clear it first.

Now day_num. Each cell reads it from its own day page: 01 to 31.

A planner prints these smaller, in the top-left corner, to leave room for writing. In Typography: 12 points, Align Left, and Align Top.

## Static offset

But look where the first is: under Monday. October the first, 2026, is a Thursday.

Offset (Skip items) leaves blank cells before the first item. Three, for Monday to Wednesday, and October starts on a Thursday.

But a static offset is the same on every page. Preview December. Its first is a Tuesday, yet it's still under Thursday.

## Dynamic offset

Each month needs its own number, and its first day already knows it. Switch Static to Dynamic, and the offset is read from a field on the first item.

The field is weekday_num. Until the name is complete, nothing moves: Dynamic falls back to the number in the box. Then the first jumps to Wednesday.

One column out. weekday_num counts from Sunday, which is zero, so Tuesday is two. But our columns start with Monday, so every day sits one column left of its number.

The plus-minus box adds to the field's value: minus one. Two minus one is one blank cell, and the first is under Tuesday.

Same settings, every month. Back to October: four minus one is three, and it's under Thursday again.

## The Sunday wrap

November is the one to watch. It starts on a Sunday, weekday zero, and zero minus one is minus one.

There's no column minus one, so a negative offset wraps round once: add the seven columns, and it's six. The first lands under Sunday, and the 30th starts a sixth row.

## A window of the list

On to the cover. I'd like the three months there, in a row, as links. G again, and a strip under the title.

One cell per child again: three months, and Notes. Final Data Subset takes a window of that list. Start skips from the front, and Count keeps that many.

Count three, and Notes drops out.

## Reaching the days

Now a calendar for the cover. Rather than build it again, I'll copy ours. On Month, V, drag a box across the letters and the calendar, and Control C.

On the cover, Control V. Pasted things land 20 points down and to the right, so I'll drag them under the months.

The copy reads the cover's children: three months and Notes, so four cells. A month has no day_num of its own, so it borrows its first day's.

Deep Traversal walks further down the tree, one level at a time. Add Level, and give it a Count of one: of the cover's children, take the first, October.

Add Level again, and leave its Count empty: every child of October. The days are back, starting on Thursday.

Level one's Start picks the month, counting from zero. One is November, wrapped round to Sunday as it was on its own page.

Start three is Notes, which has no pages under it. With nothing to show, the editor fills the grid with Item placeholders, and the PDF prints nothing there. Back to one.

Grid Configuration lists its steps in the order they run. The source first, then Deep Traversal. Then Final Data Subset, and the offset last. Episode 19 uses that order to fix grids that look wrong.

## Cells are links

Every cell is a link to the page it shows, with nothing to set up. The canvas doesn't follow links, so let's export and try them.

December, in the month row, opens December's page, starting on a Tuesday.

And every day opens its own page. Christmas Day is a Friday.

That's a grid built up from one cell per child. Next time: references, and how one page can appear in two places at once.
