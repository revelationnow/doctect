# The generator: building documents in code

*Episode 10 · Advanced · 02:19*

## Welcome

Some documents are too big to click together. The 2026 planner has 365 day pages, and nobody made those one at a time: a short script built them. This episode is about the generator, and writing a script of your own.

## Two scripts

The purple Generator button opens two editors side by side. The left script returns templates, the designs. The right one returns pages: the hierarchy, with each page naming its template.

I'll paste in a script for the templates. Two A4 templates: a week page, with a grid listing its days, and a day page, with the date, a link back to the week, and lined paper. They are the same elements you draw by hand, written as data.

And a hierarchy script. A top page for the week, then a loop that makes seven days, each with a title, a template, and a date field, worked out from the start of the week.

## Preview

Preview runs both scripts in a sealed sandbox, with no network and a ten second limit. Your project is not touched.

The preview has one card per template, each drawn with real generated data: the week, and a day. A card marked Unused would mean no page asked for that template, which is usually a typo.

## Applying it

Create As New Project opens the result in its own tab, and leaves this project alone. Replace Current Project swaps it in here instead, as one step you can undo.

Here it is, in a new tab: eight pages from about thirty lines of code. The week page lists its days, and each day page has its date.

## Where the scripts live

The scripts are saved with the project. Open the generator again, and the preset menu offers Current saved source. Opening it never runs it. Nothing runs until you press Preview.

From here, the canvas works as usual: let code build the structure, then polish the design by hand. Just remember that running the scripts again with Replace starts over from the code.

## The result

Let's export it. The week page lists all seven days, and each one is a link. Every date came from the script, so planning another week is a matter of changing one date and running it again.

Next time, we leave the editor: the gallery, accounts, and saving to the cloud.
