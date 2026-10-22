# The generator, step by step

*Episode 10 · Advanced · 09:28*

## Welcome

Some documents are too big to click together. The 2026 planner's 365 day pages came from a script. Today we write one ourselves, a week of meal pages, and read every line of it.

## Two editors

The purple Generator button opens two editors. The left one, Define Templates, describes how pages look. The right one, Build Hierarchy, lists the pages and says which template each one uses.

They're simple editors, with no line numbers and no autocomplete. Tab won't indent either, so I use spaces. The Preset menu loads working samples; I'll start from empty.

## The smallest pair

First, the smallest pair that works. On the left, t is an empty object that will hold my templates, and t.day is the first one.

Its id is day: that's the name pages use to ask for it. Its name, Day, is what the app shows. A4_WIDTH and A4_HEIGHT come built into this script: the page size in points.

Elements, everything on the page, is an empty list for now. And the script must hand its templates back: return t.

On the right, nodes will hold every page, by its id. nodes.root is the first page.

Id root. parentId null, because nothing sits above it. Type day: the template's id, which ties this page to its template. Title Monday, empty data, no children.

This script returns the pages, and which one is the root. nodes on its own is short for nodes: nodes.

Preview runs both scripts in a sealed sandbox: no network, ten seconds at most, and your project isn't touched.

One template, used by one page. The card is the Day template, drawn for Monday. It's blank, because elements is empty.

## The day page

Now the elements, one at a time. Inside the brackets, a text element. X 40, y 40 is its top left corner: 40 points from the left edge and from the top.

W 400 and h 50 are the size of its box, also in points. The text is {{title}}: each page fills in its own title.

Font size 32, and bold. There's no id: the generator gives each element one. Anything I leave out gets a default, so this text sits centered in its box.

The date line I'll paste. Same shape, at y 92, under the title: {{date}}, 14 point, in gray.

Title comes with every page. Date doesn't: it's a field I made up, so Monday has to supply it. In its data: date, October 26.

Then the lined paper, pasted: one rectangle, 515 by 660 points. Fill type pattern, with lines h, horizontal lines, every 24 points. Fill is the color of the lines.

Preview again, and open the card to see it larger. Monday, October 26, and lines to write on.

One page proves the template. Now the real shape: a week page, with seven days under it.

## A week of pages

The week needs a template of its own, pasted above the day so it's listed first: id week, name Week, and a wider title. Its list comes later.

Preview shows something new. The Week card says Unused: the template exists, but no page asks for it yet. It's a hint, not an error.

So the root becomes the week: type week. Its title, Meals this week, and no date of its own.

Next, the day names, pasted: a list of seven, counted from zero. Days of zero is Monday, and days of six is Sunday.

And the loop, pasted. for (let i = 0; i < 7; i++): the lines inside run seven times, once per day.

New Date, with year 2026, month nine, and day 26 plus i. Months count from zero, so nine is October.

When i is six, that's October the 32nd. Date rolls it over to November the 1st, so the end of the month takes care of itself.

dateText turns that into words: toLocaleDateString, in US English, with the long month name and the day number. October 26.

createId, with the prefix day, makes a new id every time: day, an underscore, and random letters and digits. It only exists in this script.

Then the page itself: parentId root, and type day. Its title is days of i, and the dateText goes in its data. id on its own is short for id: id.

Push adds the new id to the root's children. That list is the page order, and it has to agree with each page's parentId.

Preview: two templates and eight pages. Meals this week uses the Week template, and seven pages use Day.

## The list and the way back

The week page needs its list: a grid, pasted under its title. For a grid, w and h are the size of one cell, 515 by 56.

cols: 1: one cell per row, 8 points apart. Source type current: the cells come from the children of the page being drawn. On Meals this week, that's the seven days.

Display field is the pattern for each cell: {{title}} · {{date}}. Each cell fills it in from its own day, and links to that page.

Now the way back. On the day page, after the date, a small text, an arrow and Week, pasted. Its link target is parent.

Parent means the page this one sits under. For every day, that's the week. No page numbers anywhere: the export works them out when it writes the PDF.

Preview. The week lists all seven days with their dates. And each day has its way back, at the top right.

## When it goes wrong

Before I make this real, a mistake on purpose. In the loop, I'll misspell day as 'dya'.

This time no preview opens. The red text says hierarchy: a node, by its id, references unknown template type 'dya'.

It names the page that failed, and the name it couldn't find. A misspelled template name stops the run like this. It never shows up as Unused.

Three letters fix it, and the red text goes as soon as I type.

The other mistake you'll make is a missing comma. I'll take out the one after font size 14, in the date line.

Template script, line 13: Unexpected identifier 'textColor'. It names the script and the line.

On line 13, the trouble sits just before the word it names: the comma I took out. Comma back, and it's gone.

## Making it real

Preview once more. There are two ways to use the result. Replace Current Project swaps it into this project, after a confirmation, as one step you can undo.

Create As New Project leaves Kitchen notes alone and opens a new project. I'll call it Meal planner.

Here it is, in its own tab: eight pages from 34 lines of code. Wednesday has its date, in the data field the loop wrote.

## Where the scripts live

The scripts are saved with this project. Open the generator here, and the Preset menu reads Current saved source, with a Saved Generator mark.

The note above the editors says the rest. Publish the project, and the scripts go public with it. Opening them never runs them; only Preview does.

And hand edits on the canvas aren't written back here. Run Replace again later, and it rebuilds from these scripts, over those edits.

## The result

Export PDF, and every link works. Friday's row goes to Friday, and the arrow comes back to the week.

## Letting an LLM help

You don't have to write every line yourself, either. At the bottom of the generator, LLM Helper & Schema Documentation holds a prompt written for chatbots.

It teaches a chatbot everything we did today: both scripts, every kind of element, link targets, and what each script has to return. Copy puts all of it on your clipboard.

Schema Reference, the other tab, is the short version: every property of a template and of a page, in two tables.

Paste it into the chatbot you use, and replace the placeholder on its last line with what you want. Mine asks for a habit tracker for November: a month page that links to every day, and a page for each day with ten habits to tick.

The answer is two scripts. The first goes in Define Templates, the second in Build Hierarchy. Then Preview, as always: nothing runs before that, and the project isn't touched.

Two templates, a month calendar and a day page, and 31 pages: November and its 30 days. If Preview goes red instead, paste the message back to the chatbot and ask for a fix. And read what it wrote before you use it. After today, you know what every line does.

Another week is one changed date and a Preview away. Next time, we leave the editor: the gallery, accounts, and saving to the cloud.
