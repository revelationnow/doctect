# Every kind of link

*Episode 13 · In depth · 04:41*

## Welcome

Episode five used two link targets, and episode eight added a third. Five are left, and Go to Sibling has an edge case worth knowing. Most of them sit on this day page's top bar.

## A fixed page

Click 2026: Go to Specific Page. It names one page, 2026 Planner, instead of a relationship. Home would be three levels up from a day, but four from a journal. A fixed page is right on every template.

It's also how you jump across the tree. On Week View, a Notes chip: T for text, and a box at the end of the top bar.

Go to Specific Page, then Select Target Page, and pick Notes from the tree. Now all fifty-three weeks open the same Notes list.

## By position

On Day View, the Journal chip is Go to Child (by Index). Target Child lists this day's pages, but it stores a position: zero, the first.

So every day's chip opens that day's own Journal. Use it when every page of a kind has the same sub-pages, in the same order.

## Past the end of a list

The right arrow is Go to Sibling, plus one. But January 31 is the last day in January. The link doesn't wrap around; it climbs to Quarter 1 and takes the next month's first day.

One level only. March 31's next day sits under Quarter 2, two levels away, so March 31 gets no right arrow. The editor still draws it; the PDF won't. Any next sibling will do, though: Quarter 4's right arrow opens the Weeks list.

## Levels up

Q1 is Go to Ancestor (Level), two levels up: from a day to its month, then its quarter. Use it when the page you want is further up than the parent.

The count starts from the page that draws the chip. Journals sit a level lower, so the Journal template's Q1 says three. Ask for more levels than a page has, and the chip is left off.

## Children's referrers

Month View's week labels need something else. No week references a month; weeks reference its days. So Go to Child's Referrer asks about the month's children.

Start Index is the last day in the label's row: 6-month_start_offset. Count / Direction, minus seven, walks back up to a week. The first day a week references wins.

The filter prefers references on one template, and falls back to any. One trap: the count is ignored until Start Index holds a value, though that box shows zero when it's empty.

## Leaving the document

Open URL is the one target that leaves the PDF. On the Year View template, the cover gets a web address near the bottom, black on black until I make it white.

On Click, Open URL, and the whole address, starting with https. It's stored exactly as typed, and most readers can't open a bare address.

There's nothing in the tree to resolve, so the exporter never hides it. With the box empty, the line would still print, as plain text.

## Deleting

Deleting is where links and references part ways. In Hierarchy, I'll select Week 2: our Notes chip, and January 5 and 6 in its top row.

First, the reference to January 5. The dialog says only the reference goes, and the page stays where it is. The week loses its Monday, and January keeps its fifth.

Now the real January 6. Its Journal and Daily Notes go with it, and so does its reference in Week 2. Nothing is left pointing at a missing page.

And a fixed link can't outlive its page. Delete Notes, and the chip's On Click drops back to None. The chip still prints, as plain text.

Control Z, three times, and all three come back, link included.

## In the PDF

Let's export and check. Thirteen hundred pages take a moment. Links are only worked out here, page by page, so the PDF is the only place to test them.

The cover's address line is a live link, but it would leave the reader, so I won't click it.

Quarter 1, then January 31 in its little calendar. The right arrow lands on February 1, the next month's first day.

Journal opens this day's own journal, and its Q1, three levels up, goes back to the quarter.

Now March 31. There's a left arrow, but no right one: the next day lives in another quarter.

Mar goes up to March. Its sixth week label scans back to March 31 and finds Week 14. And Week 14's Notes chip opens the Notes list.

That's every kind of link, and what each does when there's nowhere to go. Next time: getting your planner onto a tablet.
