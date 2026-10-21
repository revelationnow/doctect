# Data grids: an index page and tables

*Episode 4 · Building blocks · 03:33*

## Welcome

Our recipe book has a cover and three recipes. Today the cover gets an index: a list of every recipe, with each line a link to its page. Lists like that are what data grids are for.

## Drawing a grid

The index goes on the cover, so I'll open the cover's template, A4 Blank. The preview shows it as Family Recipes.

Press G for the grid tool, and drag out some room. The grid fills itself with one cell for each child of the page. The cover has three children, the recipes, so there are three cells.

## Columns and cell size

Cols sets how many cells sit side by side. For a list, I want just one.

Now they're narrow. A grid's width and height, in Geometry, are the size of one cell, not the whole grid. So a width of 300 makes every row 300 points wide. A height of 30, and I'll center it with X.

Gap Y puts a little air between the rows.

## What each cell says

Display Template decides what each cell says, and it starts out as title. I'd like the time in there too. The buttons underneath insert fields: title, a separator, then time.

The text itself is styled like any text box: Playfair Display, 15 points, in the brown from the cover. A grid has one style for all its cells, so every line changes at once.

## Table styling

The grid has a white background and a black outline, which looks heavy on this paper. Clearing the fill and the stroke lets the dots show through.

Cell Border Mode draws lines between and around cells. Inside Only puts them between the rows. But look: nothing's there.

This is the first trap. The color and width shown here are borrowed from the outline, just for show. Until you set them yourself, cell borders have no color and no width. A color, a width, Dashed for the style, and there they are.

Alternate Rows shades every other row. And here is the same trap again: the switch alone does nothing, until you pick its color.

Header Row is the one that surprises people. It doesn't add a row of headings. It restyles whatever lands in the first row, here, Tomato Soup, and the shading moves down to start after it. That's not what an index needs, so it stays off.

A heading above the list is just a text box. I'll call it Recipes, in italics.

## A fixed source

One more grid. I want every recipe page to list all the recipes along the bottom, so you can jump between them. On the Recipe template, I'll drag one out above the author line.

Item 1 to Item 6? Those are placeholders. The source is Children of Current Page, and a recipe has no children, so there is nothing to show. In the PDF it would come out empty.

Children of Specific Page pins the source to one page instead. Select Page, then Family Recipes, and every recipe lists the same three. Pinning is the right choice for anything that should look the same on every page, like a menu.

Smaller text, no backgrounds, and no outline, so it sits quietly at the foot of the page.

## Cells are links

Every cell in a grid is a link to the page it shows. There's nothing to set up, but the canvas doesn't follow links, so let's export and try them.

Here's the index. Click Banana Bread, and we land on its page.

And from the strip along the bottom, the Pad Thai, on page four.

Next time: links you make yourself, starting with a way back to the cover from every page.
