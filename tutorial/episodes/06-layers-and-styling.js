// Episode 6 — Layers, stacking & fine styling.
// Continues the recipe notebook: a locked Background layer under a Content
// layer, a hidden Notes layer that never prints, a one-sided border, text
// overflow on a long title, an imported SVG, and a greyscale proof for e-ink.
import path from 'node:path';
import { episodeMeta } from './series.js';
import * as app from '../lib/app.js';
import { TUTORIAL_DIR } from '../lib/episode.js';

export const meta = episodeMeta(6, {
    description: 'Finishing touches for the recipe notebook. Layers keep the background out of the way and hold notes that never '
        + 'print; then a one-sided border, a long title that has to fit, artwork imported as SVG, and a greyscale proof '
        + 'before the notebook goes onto an e-ink tablet.',
    learn: [
        'The Layers panel: renaming, adding, and moving elements between layers',
        'Locked layers print but ignore the mouse',
        'Hidden layers never reach the PDF',
        'Per-side borders',
        'Text overflow: clip, ellipsis and shrink',
        'Importing SVG artwork, and checking a greyscale proof',
    ],
    docs: ['/docs/editor/layers', '/docs/reference/text-overflow'],
    thumbnail: { beat: 13, headline: 'Layers & styling' },
});

const PALETTE = ['#fdba74', '#fed7aa', '#ea580c', '#9a3412', '#7c2d12', '#0f172a', '#64748b', '#ffffff'];
const at = (page, x, y) => app.pagePoint(page, x, y);
const layers = (page) => app.pane(page).getByTestId('layers-panel');
const layerRow = (page, name) => layers(page).locator('[data-testid^="layer-row-"]', { has: page.locator(`[data-testid="layer-name"]:text-is("${name}")`) }).first();
const elementRows = (page) => layers(page).locator('[data-testid^="element-row-"]');
const appearance = (page) => app.section(page, 'appearance');
const typography = (page) => app.section(page, 'typography');
const geometryInput = (page, i) => app.section(page, 'geometry').locator('input').nth(i);

/** Double-clicks a layer's name and types a new one. */
async function renameLayer(ctx, from, to) {
    await ctx.click(layerRow(ctx.page, from).getByTestId('layer-name'), { count: 2 });
    await ctx.page.keyboard.press('Control+a');
    await ctx.type(to, { wpm: 160 });
    await ctx.press('Enter', { chip: false });
}

export async function setup(ctx) {
    await ctx.goto('/app');
    await app.editorReady(ctx.page);
    await app.loadFixture(ctx, '05-recipe-links');
    await ctx.click(app.sidebarTab(ctx.page, 'Templates'));
    await app.selectTemplate(ctx, 'Recipe');
    await ctx.wait(1200);
    await ctx.titleCard();
    await ctx.wait(900);
}

export const teardown = (ctx) => app.saveFixture(ctx, '06-recipe-styled');

export const beats = [
    {
        chapter: 'Welcome', lowerThird: false,
        say: 'So far, everything on a page has lived on one layer, stacked in the order we drew it. This time: layers, '
            + 'and a few finishing touches. A border on one side, a title that is too long, some artwork, and a greyscale proof.',
        do: async (page, ctx) => {
            await ctx.wait(2500);
            await ctx.cardOut();
            await ctx.move(await at(page, 300, 300));
        },
    },
    {
        chapter: 'Layers',
        say: "Here's the Recipe template, and the Layers panel, just above Element Properties. Every template starts with one layer, "
            + "and everything we've drawn is on it, listed front to back.",
        do: async (page, ctx) => {
            const header = app.propertiesColumn(page).getByText('Layers', { exact: true }).first();
            await ctx.click(header);
            await layers(page).waitFor();
            await ctx.atSentence(1);
            await ctx.move(elementRows(page).first());
            await ctx.move(elementRows(page).last(), { duration: 900 });
        },
    },
    {
        say: "I'll make it two. Double-click the name to rename it: Background. The plus adds a new layer on top, which I'll call Content.",
        do: async (page, ctx) => {
            await ctx.atSentence(1);
            await renameLayer(ctx, 'Layer 1', 'Background');
            await ctx.atSentence(2);
            await ctx.click(layers(page).locator('button[title="Add layer"]'));
            await renameLayer(ctx, 'Layer 2', 'Content');
        },
    },
    {
        say: 'The card stays on Background, and everything else moves up. Click the first row, Shift-click the last one above the card, '
            + 'and then Move to, Content.',
        do: async (page, ctx) => {
            const rows = elementRows(page);
            const n = await rows.count();
            await ctx.click(rows.first());
            await ctx.page.keyboard.down('Shift');
            await ctx.showKeys(['Shift', '+', 'Click']);
            await ctx.click(rows.nth(n - 2));
            await ctx.page.keyboard.up('Shift');
            await ctx.atSentence(1);
            await ctx.pick(layers(page).getByTestId('move-selection-select'), 'Content');
        },
    },
    {
        say: 'Now lock Background. A locked layer still prints. It just ignores the mouse, so clicking the page no longer grabs the card, '
            + 'and I can work on top of it without nudging it by accident.',
        do: async (page, ctx) => {
            await ctx.click(layerRow(page, 'Background').locator('button[title="Toggle lock"]'));
            await ctx.atSentence(1);
            await ctx.click(await at(page, 140, 420));
            await ctx.wait(700);
            await ctx.click(await at(page, 420, 520));
        },
    },
    {
        chapter: 'Notes that never print',
        say: "Layers are good for notes to yourself, too. A third layer, Notes, with a reminder on it. "
            + "The newest layer is also the active one, shaded blue, so that's where the text box lands.",
        do: async (page, ctx) => {
            await ctx.click(layers(page).locator('button[title="Add layer"]'));
            await renameLayer(ctx, 'Layer 3', 'Notes');
            await ctx.tool('t');
            await ctx.drag(await at(page, 120, 330), await at(page, 476, 356), { duration: 800 });
            await ctx.type('Add a photo of the finished dish?', { wpm: 190 });
            await ctx.press('Escape');
        },
    },
    {
        say: "Click the eye to hide the layer. It's gone from the canvas, and from the PDF too. Hide your notes before you export, and they never ship.",
        do: async (page, ctx) => {
            await ctx.click(await at(page, -50, 420));
            await ctx.click(layerRow(page, 'Notes').locator('button[title="Toggle visibility"]'));
            await ctx.atSentence(1);
            await ctx.move(await at(page, 300, 343));
        },
    },
    {
        chapter: 'A border on one side',
        say: "I'd like a thin rule under the Serves line. Per-Side Borders, in Appearance, draws a border on just the sides you choose. "
            + 'Customize, then switch off top, right and left, and make the bottom orange.',
        do: async (page, ctx) => {
            await ctx.click(await at(page, 300, 132));
            const ap = appearance(page);
            await ctx.atSentence(1);
            await ctx.click(ap.getByRole('button', { name: 'Customize' }));
            await ctx.atSentence(2);
            for (const side of ['top', 'right', 'left']) await ctx.click(ap.locator(`button[title="${side} border"]`));
            const bottom = ap.locator('button[title="bottom border"]').locator('xpath=..');
            await ctx.pickColor(bottom.locator('input[type=color]'), '#ea580c', PALETTE);
        },
    },
    {
        say: "One trap here. The PDF only draws per-side borders when the box's own Stroke has a color and a width, "
            + 'and a text box starts with neither. The canvas shows the border either way, so give Stroke a color, and a width of 1.',
        do: async (page, ctx) => {
            const ap = appearance(page);
            await ctx.move(ap.locator('input[placeholder="W"]'));
            await ctx.atSentence(2);
            await ctx.pickColor(ap.locator('input[type=color]').nth(1), '#ea580c', PALETTE);
            await app.retype(ctx, ap.locator('input[placeholder="W"]'), 1);
        },
    },
    {
        chapter: 'Long titles',
        say: "Long titles are next. In the hierarchy, I'll give the Pad Thai a longer name: Weeknight Pad Thai with Crispy Tofu. "
            + 'On the page, the end of it is simply cut off.',
        do: async (page, ctx) => {
            await ctx.click(app.sidebarTab(page, 'Hierarchy'));
            await app.selectNode(ctx, 'Weeknight Pad Thai');
            await app.retype(ctx, app.nodeTitleInput(page), 'Weeknight Pad Thai with Crispy Tofu');
            await ctx.atSentence(1);
            await ctx.move(await at(page, 520, 90));
        },
    },
    {
        say: "Back on the template, I'll preview the Pad Thai and select its title. Overflow, under Typography, decides what happens "
            + "when text doesn't fit. Clip is the default. Ellipsis ends it with three dots. "
            + 'Shrink makes the text smaller until it fits, which is usually what a title wants.',
        do: async (page, ctx) => {
            await ctx.click(app.sidebarTab(page, 'Templates'));
            await app.selectTemplate(ctx, 'Recipe');
            await ctx.pick(app.previewSelect(page), 'Weeknight Pad Thai with Crispy Tofu');
            await ctx.click(await at(page, 300, 90));
            const overflow = typography(page).locator('select:has(option[value="shrink"])');
            await ctx.atSentence(1);
            await ctx.move(overflow);
            await ctx.atSentence(3);
            await ctx.pick(overflow, 'Ellipsis');
            await ctx.atSentence(4);
            await ctx.pick(overflow, 'Shrink');
        },
    },
    {
        say: 'The long name spills out of the grids too: the strip along the bottom here, and the index on the cover. '
            + 'Grids have their own setting, Cell text overflow. Shrink, for both. Only the cells that need it get smaller; the rest keep their size.',
        do: async (page, ctx) => {
            await ctx.move(await at(page, 460, 716));
            await ctx.atSentence(1);
            await ctx.click(await at(page, 300, 716));
            const cells = () => typography(page).locator('select:has(option[value="shrink"])');
            await ctx.pick(cells(), 'Shrink');
            await app.selectTemplate(ctx, 'A4 Blank');
            await ctx.click(await at(page, 298, 593));
            await ctx.pick(cells(), 'Shrink');
            await app.selectTemplate(ctx, 'Recipe');
        },
    },
    {
        chapter: 'Artwork',
        say: 'Artwork can come in as SVG. New things land on the active layer, the one shaded blue, and that is still Notes, '
            + 'which is hidden. So first I click Content. Then, from the SVG tools menu, Import SVG file, and pick a whisk.',
        do: async (page, ctx) => {
            await ctx.move(layerRow(page, 'Notes'));
            await ctx.atSentence(2);
            await ctx.click(layerRow(page, 'Content').getByTestId('layer-name'));
            await ctx.atSentence(3);
            await ctx.click(app.toolbarButton(page, 'SVG Tools'));
            await ctx.chooseFile(() => ctx.click(app.pane(page).getByRole('button', { name: 'Import SVG file…' })),
                path.join(TUTORIAL_DIR, 'assets', 'whisk.svg'));
            await ctx.wait(600);
        },
    },
    {
        say: "It's a real vector, so it stays sharp at any size, and it keeps its own colors, so this one arrives in the same brown. "
            + "I'll make it 40 points square, and tuck it under the heading.",
        do: async (page, ctx) => {
            await ctx.atSentence(1);
            await app.retype(ctx, geometryInput(page, 2), 40, { commit: 'Enter' });
            await app.retype(ctx, geometryInput(page, 3), 40, { commit: 'Enter' });
            await app.retype(ctx, geometryInput(page, 0), 277.6, { commit: 'Enter' });
            await app.retype(ctx, geometryInput(page, 1), 166, { commit: 'Enter' });
        },
    },
    {
        chapter: 'A greyscale proof',
        say: 'Most e-ink tablets show only shades of grey. The contrast button beside Export PDF switches the export to greyscale, '
            + 'so you can check that pale colors still show up before the file goes onto a device.',
        do: async (page, ctx) => {
            await ctx.click(await at(page, -60, 400));
            await ctx.move(page.locator('button[title="Greyscale Export: OFF"]'));
            await ctx.atSentence(1, { offset: 1.5 });
            await ctx.click(page.locator('button[title="Greyscale Export: OFF"]'));
            ctx.state.pdf = await ctx.download(() => ctx.click(page.getByRole('button', { name: 'Export PDF' }).first()));
            await ctx.wait(800);
            await ctx.openPdf(ctx.state.pdf, { title: 'Family Recipes (greyscale).pdf' });
            await ctx.move({ x: 1000, y: 500 });
        },
    },
    {
        say: 'The peach becomes a light grey, the orange rules turn grey too, and the shaded row in the index still stands out. On the last page, the long title fits, '
            + 'the whisk is crisp, and the note we hid is nowhere to be seen.',
        do: async (page, ctx) => {
            await ctx.move({ x: 720, y: 600 });
            await ctx.atSentence(1);
            for (let i = 0; i < 3; i++) await ctx.pdfNextPage();
            await ctx.move({ x: 760, y: 330 });
        },
    },
    {
        say: 'Next time: real calendars, where every month starts on the right weekday.',
        hold: 3,
        do: async (page, ctx) => {
            await ctx.atSentence(0, { offset: 1.2 });
            await ctx.endCard();
        },
    },
];
