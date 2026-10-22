// Episode 4 — Data grids: an index page and tables.
// Continues the recipe notebook: a grid on the cover lists every recipe (one
// cell per child, w/h are one cell, columns and gaps, display templates),
// table styling and its two traps (cell borders and row shading stay off until
// their own values are set; Header Row restyles, it never adds labels), a
// second grid pinned to a specific page, and cells as links in the PDF.
import { episodeMeta } from './series.js';
import * as app from '../lib/app.js';

export const meta = episodeMeta(4, {
    description: 'The recipe notebook gets an index. One data grid on the cover lists every recipe and links to it; a second, '
        + 'pinned to a specific page, runs along the bottom of every recipe. Along the way: why a grid\'s width is one cell, '
        + 'display templates, and the two table-styling settings that do nothing until you give them a value.',
    learn: [
        'One cell per child: what a grid shows, and where it gets it',
        'Cols and gaps, and why Geometry sizes a single cell',
        'Display templates built from data fields',
        'Cell borders and row shading, and why they start switched off',
        'What Header Row really does',
        'Children of Specific Page, and cells as links in the PDF',
    ],
    docs: ['/docs/editor/grids-basics-and-styling', '/docs/reference/grid-source'],
    thumbnail: { beat: 12, headline: 'Data grids' },
});

const PALETTE = ['#fdba74', '#fed7aa', '#ea580c', '#9a3412', '#7c2d12', '#0f172a', '#64748b', '#ffffff'];
const at = (page, x, y) => app.pagePoint(page, x, y);
const grid = (page) => app.section(page, 'grid-configuration');
const gridInput = (page, label) => grid(page).locator(`label:text-is("${label}") + input`);
const geometryInput = (page, i) => app.section(page, 'geometry').locator('input').nth(i);
const appearance = (page) => app.section(page, 'appearance');
const typography = (page) => app.section(page, 'typography');
/** A Grid Formatting block (Header Row, Alternate Rows…): its toggle, swatches and Bold button. */
const formatting = (page, name) => grid(page).locator(`label:text-is("${name}")`).locator('xpath=../..');
const cellBorder = (page) => grid(page).locator('label:text-is("Cell Border")').locator('xpath=..');

async function chooseFont(ctx, search, name) {
    const ty = typography(ctx.page);
    await ctx.click(ty.locator('button:has(span:text-is("▼"))').first());
    await ctx.click(ty.getByPlaceholder('Search fonts...'));
    await ctx.type(search);
    await ctx.wait(400);
    await ctx.click(ty.getByRole('button', { name, exact: true }).first());
}

export async function setup(ctx) {
    await ctx.goto('/app');
    await app.editorReady(ctx.page);
    await app.loadFixture(ctx, '03-recipe-notebook');
    await ctx.wait(1200);
    await ctx.titleCard();
    await ctx.wait(900);
}

// Episode 5 links these pages together.
export const teardown = (ctx) => app.saveFixture(ctx, '04-recipe-index');

export const beats = [
    {
        chapter: 'Welcome', lowerThird: false,
        say: 'Our recipe book has a cover and three recipes. Today the cover gets an index: a list of every recipe, '
            + 'with each line a link to its page. Lists like that are what data grids are for.',
        do: async (page, ctx) => {
            await ctx.wait(2500);
            await ctx.cardOut();
            await ctx.move(app.canvas(page), { ay: 0.6 });
        },
    },
    {
        chapter: 'Drawing a grid',
        say: "The index goes on the cover, so I'll open the cover's template, A4 Blank. The preview shows it as Family Recipes.",
        do: async (page, ctx) => {
            await ctx.click(app.sidebarTab(page, 'Templates'));
            await app.selectTemplate(ctx, 'A4 Blank');
            await ctx.atSentence(1);
            await ctx.move(app.previewSelect(page));
        },
    },
    {
        say: 'Press G for the grid tool, and drag out some room. The grid fills itself with one cell for each child of the page. '
            + 'The cover has three children, the recipes, so there are three cells.',
        do: async (page, ctx) => {
            await ctx.tool('g');
            await ctx.drag(await at(page, 148, 512), await at(page, 448, 590), { duration: 1100 });
            await ctx.atSentence(2);
            await ctx.move(await at(page, 300, 540));
        },
    },
    {
        chapter: 'Columns and cell size',
        say: '[Cols](=Columns) sets how many cells sit side by side. For a list, I want just one.',
        do: async (page, ctx) => {
            await ctx.move(grid(page), { ay: 0.1 });
            await app.retype(ctx, gridInput(page, 'Cols'), 1);
        },
    },
    {
        say: "Now they're narrow. A grid's width and height, in Geometry, are the size of one cell, not the whole grid. "
            + 'So a width of 300 makes every row 300 points wide. A height of 30, and I\'ll center it with X.',
        do: async (page, ctx) => {
            await ctx.move(app.section(page, 'geometry'), { ay: 0.2 });
            await ctx.atSentence(1);
            await app.retype(ctx, geometryInput(page, 2), 300, { commit: 'Enter' });
            await ctx.atSentence(2);
            await app.retype(ctx, geometryInput(page, 3), 30, { commit: 'Enter' });
            await app.retype(ctx, geometryInput(page, 0), 148, { commit: 'Enter' });
        },
    },
    {
        say: 'Gap Y puts a little air between the rows.',
        do: async (page, ctx) => {
            await app.retype(ctx, gridInput(page, 'Gap Y'), 6);
        },
    },
    {
        chapter: 'What each cell says',
        say: "Display Template decides what each cell says, and it starts out as title. I'd like the time in there too. "
            + 'The buttons underneath insert fields: title, a separator, then time.',
        do: async (page, ctx) => {
            const field = gridInput(page, 'Display Template');
            await ctx.atSentence(1);
            await ctx.click(field);
            await page.keyboard.press('Control+a');
            await page.keyboard.press('Backspace');
            await ctx.atSentence(2);
            await ctx.click(grid(page).locator('button[title="Insert {{title}}"]'));
            await ctx.click(field);
            await page.keyboard.press('End');
            await ctx.type(' · ', { wpm: 120 });
            await ctx.click(grid(page).locator('button[title="Insert {{time}}"]'));
        },
    },
    {
        say: 'The text itself is styled like any text box: Playfair Display, 15 points, in the brown from the cover. '
            + 'A grid has one style for all its cells, so every line changes at once.',
        do: async (page, ctx) => {
            await chooseFont(ctx, 'play', 'Playfair Display');
            const ty = typography(page);
            await app.retype(ctx, ty.locator('input[type=number]').first(), 15);
            await ctx.pickColor(ty.locator('input[type=color]').first(), '#7c2d12', PALETTE);
        },
    },
    {
        chapter: 'Table styling',
        say: 'The grid has a white background and a black outline, which looks heavy on this paper. '
            + 'Clearing the fill and the stroke lets the dots show through.',
        do: async (page, ctx) => {
            await ctx.atSentence(1);
            await ctx.click(appearance(page).locator('button[title="Clear fill color"]'));
            await ctx.click(appearance(page).locator('button[title="Clear stroke color"]'));
        },
    },
    {
        say: "Cell Border Mode draws lines between and around cells. Inside Only puts them between the rows. But look: nothing's there.",
        do: async (page, ctx) => {
            await ctx.move(grid(page).getByText('Grid Formatting'));
            await ctx.pick(grid(page).locator('select:has(option[value="inside"])'), 'Inside Only');
            await ctx.atSentence(2);
            await ctx.move(await at(page, 300, 548));
        },
    },
    {
        say: 'This is the first trap. The color and width shown here are borrowed from the outline, just for show. '
            + 'Until you set them yourself, cell borders have no color and no width. A color, a width, Dashed for the style, and there they are.',
        do: async (page, ctx) => {
            await ctx.move(cellBorder(page));
            await ctx.atSentence(2);
            await ctx.pickColor(cellBorder(page).locator('input[type=color]'), '#ea580c', PALETTE);
            await app.retype(ctx, cellBorder(page).locator('input[type=number]').first(), 1);
            await ctx.pick(cellBorder(page).locator('select'), 'Dashed');
        },
    },
    {
        say: 'Alternate Rows shades every other row. And here is the same trap again: the switch alone does nothing, until you pick its color.',
        do: async (page, ctx) => {
            const rows = formatting(page, 'Alternate Rows');
            await ctx.click(rows.locator('button').first());
            await ctx.atSentence(1, { offset: 1.5 });
            await ctx.pickColor(rows.locator('input[type=color]'), '#fed7aa', PALETTE);
            await ctx.move(await at(page, 300, 556));
        },
    },
    {
        say: "Header Row is the one that surprises people. It doesn't add a row of headings. It restyles whatever lands in the first row, "
            + "here, Tomato Soup, and the shading moves down to start after it. That's not what an index needs, so it stays off.",
        do: async (page, ctx) => {
            const header = formatting(page, 'Header Row');
            await ctx.click(header.locator('button').first());
            await ctx.click(header.locator('button').nth(1));
            await ctx.move(await at(page, 300, 527));
            // off on the last sentence, once the narration has finished describing what it did
            await ctx.atSentence(3);
            await ctx.click(header.locator('button').first());
        },
    },
    {
        say: "A heading above the list is just a text box. I'll call it Recipes, in italics.",
        do: async (page, ctx) => {
            await ctx.tool('t');
            await ctx.drag(await at(page, 148, 474), await at(page, 448, 500), { duration: 900 });
            await ctx.type('Recipes', { wpm: 150 });
            await ctx.press('Escape');
            await ctx.click(typography(page).locator('button:has(svg.lucide-italic)').first());
        },
    },
    {
        chapter: 'A fixed source',
        say: 'One more grid. I want every recipe page to list all the recipes along the bottom, so you can jump between them. '
            + "On the Recipe template, I'll drag one out above the author line.",
        do: async (page, ctx) => {
            await app.selectTemplate(ctx, 'Recipe');
            await ctx.atSentence(1);
            await ctx.tool('g');
            await ctx.drag(await at(page, 60, 706), await at(page, 536, 756), { duration: 1000 });
        },
    },
    {
        say: 'Item 1 to Item 6? Those are placeholders. The source is Children of Current Page, and a recipe has no children, '
            + 'so there is nothing to show. In the PDF it would come out empty.',
        do: async (page, ctx) => {
            await ctx.move(await at(page, 200, 720));
            await ctx.atSentence(1);
            await ctx.move(grid(page).locator('select:has(option[value="specific"])'));
        },
    },
    {
        say: 'Children of Specific Page pins the source to one page instead. Select Page, then Family Recipes, '
            + 'and every recipe lists the same three. Pinning is the right choice for anything that should look the same on every page, like a menu.',
        do: async (page, ctx) => {
            await ctx.pick(grid(page).locator('select:has(option[value="specific"])'), 'Children of Specific Page...');
            await ctx.click(grid(page).getByText('Select Page...'));
            await ctx.atSentence(1);
            const modal = page.locator('div.fixed', { has: page.locator('h2:text-is("Select Source Node")') });
            await ctx.click(modal.locator('span', { hasText: /^Family Recipes$/ }).first());
            await ctx.move(await at(page, 300, 720));
        },
    },
    {
        say: 'Smaller text, no backgrounds, and no outline, so it sits quietly at the foot of the page.',
        do: async (page, ctx) => {
            await app.retype(ctx, typography(page).locator('input[type=number]').first(), 11);
            await ctx.click(appearance(page).locator('button[title="Clear fill color"]'));
            await ctx.click(appearance(page).locator('button[title="Clear stroke color"]'));
        },
    },
    {
        chapter: 'Cells are links',
        say: "Every cell in a grid is a link to the page it shows. There's nothing to set up, but the canvas doesn't follow links, "
            + "so let's export and try them.",
        do: async (page, ctx) => {
            await ctx.atSentence(1);
            ctx.state.pdf = await ctx.download(() => ctx.click(page.getByRole('button', { name: 'Export PDF' }).first()));
            await ctx.wait(1200);
            await ctx.openPdf(ctx.state.pdf, { title: 'Family Recipes.pdf' });
            await ctx.move({ x: 1000, y: 500 });
        },
    },
    {
        say: "Here's the index. Click Banana Bread, and we land on its page.",
        do: async (page, ctx) => {
            await ctx.atSentence(1);
            await ctx.clickPdfLink({ near: [0.5, (512 + 36 + 15) / 842] });
        },
    },
    {
        say: 'And from the strip along the bottom, the Pad Thai, on page four.',
        do: async (page, ctx) => {
            await ctx.clickPdfLink({ near: [0.78, 0.86] });
        },
    },
    {
        say: 'Next time: links you make yourself, starting with a way back to the cover from every page.',
        hold: 3,
        do: async (page, ctx) => {
            await ctx.atSentence(0, { offset: 1.2 });
            await ctx.endCard();
        },
    },
];
