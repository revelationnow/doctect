# Pages, templates & data binding

*Episode 3 · Foundations · 05:38*

## Welcome

Here's the cover we made last time. A recipe book needs recipes, so in this episode we'll add pages, give them a design of their own, and have each page fill in its own details.

## Pages and templates

Two ideas carry the whole app. The first is the hierarchy, on the left. Every page in your document is a node in this tree, and right now there's just one: Family Recipes.

The second idea is templates. A node doesn't hold a design itself. It points at a template, which holds the shapes and the text. This cover points at one called A4 Blank.

## Adding pages

To add a page inside the cover, hover its row and click the plus. There is the new page, tucked underneath. Select it, and it looks exactly like the cover.

That's because a new page borrows the first template in the project, and so far there's only one. I'll give it a name before we fix that: Tomato Soup.

## A recipe template

Templates live behind this switch at the top. New Template adds an empty one, and the pencil renames it. I'll call it Recipe.

One thing to watch for. New templates start at the size of a reMarkable Paper Pro, not A4. Page Presets, in Template Settings, makes it A4 to match the cover.

I'd like the same dotted card as the cover. So I'll open the cover's template, click the card, and copy it with Control C.

Back to Recipe, and paste with Control V. Pasted things always land twenty points down and to the right, even on a different template, so I'll set X and Y back to 24.

## Assigning it

Now the template needs a page to use it. Back in the hierarchy, select Tomato Soup, and set its Assigned Template to Recipe. The cover keeps its own design.

## Placeholders

Every recipe needs its name at the top. But if I type Tomato Soup into the template, every recipe will be called Tomato Soup. What the template needs is a placeholder.

Drag out a text box, and type the word title inside double curly braces. Press Escape, and the placeholder turns into the name of the page: Tomato Soup.

And which page is it showing? The one picked in Preview, up here. While you design, it decides whose details fill the placeholders. And title works everywhere, because every page has one.

Now to style it like the cover: Playfair Display, 34 points, bold, and the same deep brown. The styling lives on the template too, so every recipe page gets it.

## More pages, quickly

On to the other recipes. In the hierarchy, Duplicate, on the row, copies a page along with its template. The copy arrives with Copy on the end of its name, so I'll rename it Banana Bread, then duplicate that one for a Weeknight Pad Thai.

Click through them, and each one shows its own name. One template, three pages, and nothing on the template had to change.

## Data fields

A recipe card wants more than a name, though: how many it serves, and how long it takes. Those go in data fields. Select Tomato Soup, click Add, and call the field servings.

Give it a value: 4. And a second field, time, set to 35 minutes. Values are plain text, so write them however reads best.

Over in the template, I'll add a second line, under the title: a text box that starts with the word Serves. It picked up the title's style, so I'll make it 16 points, and not bold.

Now the fields. The buttons under Insert Data Field add placeholders for you, so there's nothing to misspell. Servings, a separator, and time.

Here's the catch. Switch the preview to Banana Bread, and the line just says Serves. Banana Bread has no fields yet, and a missing field comes out blank. No error, and no warning. So it pays to flip through the preview now and then.

Fields belong to each page, so Banana Bread gets its own: servings 8, and an hour and ten minutes. Field names have to match exactly, capitals included. Servings with a capital S would be a different field.

And the same two fields for the Pad Thai: serves 2, in 25 minutes. For three recipes, typing fields in by hand is fine. For dozens, the generator in episode 10 builds the pages and their fields from code.

## Fields from further up

One more idea, and it's a handy one. I'd like each card to say whose recipe it is. So the template gets a small line at the bottom: From the kitchen of, and an author placeholder.

No page has an author, so it's blank. Rather than adding one to every recipe, I'll add it once, to the cover: author, Grandma Rose.

And every recipe picks it up. When a page doesn't have a field, the app asks its parent, then the parent's parent, all the way up the tree.

A page's own value still wins. The Pad Thai is Dad's recipe, so it gets an author field of its own, and only that page changes.

## The result

Let's export it and flip through. Export PDF builds the whole document right in your browser.

The cover, then three recipes, each one filled in from its own fields, with Grandma Rose on two of them and Dad on the third. The rest of each page stays empty, for writing the recipe out by hand.

Next time, the cover gets an index: a data grid that lists every recipe, and links straight to it.
