// Episode 9 — Variants & export: one document, every device.
// Continues the recipe notebook: a reMarkable variant made from the A4 one
// (reflowed templates, shared pages), fixing what the reflow stretched, units
// that convert, Save Preset, a look at the JSON, and Export All Variants.
import { episodeMeta } from './series.js';
import * as app from '../lib/app.js';

export const meta = episodeMeta(9, {
    description: 'The recipe notebook is A4, perfect for printing. Variants put the same pages on a reMarkable tablet too, without a '
        + 'second project. We make one, fix what the automatic reflow stretched, check the units, save the whole thing as a '
        + 'starting point, peek at the JSON underneath, and export every variant at once.',
    learn: [
        'What a variant is: templates per page size, pages shared',
        'Creating a variant with Auto-Reflow and Scale Typography',
        'Fixing what reflow distorts',
        'The unit selector converts, it does not relabel',
        'Save Preset and the JSON editor',
        'Export All Variants: one PDF per device',
    ],
    docs: ['/docs/editor/variants-svg-json-export', '/docs/reference/variants'],
    thumbnail: { beat: 5, headline: 'Variants & export' },
});

const at = (page, x, y, w = 595.28) => app.pagePoint(page, x, y, w);
const variantSelect = (page) => app.sidebarColumn(page).locator('select:has(option)').first();
const geometryInput = (page, i) => app.section(page, 'geometry').locator('input').nth(i);
const settings = (page) => app.section(page, 'template-settings');
const newVariant = (page) => page.locator('div.fixed', { has: page.locator('h2:has-text("New Variant")') });

export async function setup(ctx) {
    await ctx.goto('/app');
    await app.editorReady(ctx.page);
    await app.loadFixture(ctx, '06-recipe-styled');
    await ctx.click(app.sidebarTab(ctx.page, 'Templates'));
    await app.selectTemplate(ctx, 'Recipe');
    await ctx.pick(app.previewSelect(ctx.page), 'Tomato Soup');
    await ctx.wait(1200);
    await ctx.titleCard();
    await ctx.wait(900);
}

export const teardown = (ctx) => app.saveFixture(ctx, '09-recipe-variants');

export const beats = [
    {
        chapter: 'Welcome', lowerThird: false,
        say: "Our recipe book is A4, which is perfect for printing. But I'd like it on a [reMarkable](=remarkable) tablet too, and that's a different shape. "
            + 'This episode is about variants: one document, in several sizes.',
        do: async (page, ctx) => {
            await ctx.wait(2500);
            await ctx.cardOut();
            await ctx.move(await at(page, 300, 300));
        },
    },
    {
        chapter: 'Variants',
        say: 'In Templates mode, the bar at the top lists variants. There is one so far, called Default. '
            + 'A variant is a complete set of templates for one page size. The pages and their fields are shared by every variant.',
        do: async (page, ctx) => {
            await ctx.spotlight(variantSelect(page).locator('xpath=..'), '', 6);
            await ctx.move(variantSelect(page));
            await ctx.atSentence(2);
            await ctx.unspotlight();
            await ctx.move(app.sidebarColumn(page).locator('[data-template-id]').first());
        },
    },
    {
        say: "The plus adds one. I'll call it [reMarkable](=remarkable), and choose the Paper Pro from the size list. "
            + 'Auto-Reflow scales every element to the new page, and Scale Typography shrinks the text along with it.',
        do: async (page, ctx) => {
            await ctx.click(app.sidebarColumn(page).locator('button[title="Add New Variant"]'));
            await newVariant(page).waitFor();
            await ctx.click(newVariant(page).getByPlaceholder('e.g. iPad Version'));
            await ctx.press('Control+a');
            await ctx.type('reMarkable', { wpm: 150 });
            await ctx.pick(newVariant(page).locator('select'), 'reMarkable Paper Pro (509×679)');
            await ctx.atSentence(1);
            await ctx.move(newVariant(page).locator('button[title="Disable reflow"]'));
            await ctx.atSentence(2, { offset: 1 });
            await ctx.move(newVariant(page).locator('button[title="Disable font scaling"]'));
        },
    },
    {
        say: 'Create Variant copies every template, fitted to the new size, and switches to it.',
        do: async (page, ctx) => {
            await ctx.click(newVariant(page).getByRole('button', { name: 'Create Variant' }));
            await newVariant(page).waitFor({ state: 'detached' });
            await ctx.move(await at(page, 300, 300, 509));
        },
    },
    {
        say: "Here's the recipe page at the tablet's size. The [reMarkable](=remarkable) page is wider for its height than A4, "
            + 'and reflow scales width and height separately, so the whisk got squashed. I\'ll make it square again: 34 by 34.',
        do: async (page, ctx) => {
            await app.selectTemplate(ctx, 'Recipe');
            await ctx.move(await at(page, 254, 150, 509));
            await ctx.atSentence(2);
            await ctx.click(await at(page, 254.5, 150, 509));
            await app.retype(ctx, geometryInput(page, 2), 34, { commit: 'Enter' });
            await app.retype(ctx, geometryInput(page, 3), 34, { commit: 'Enter' });
        },
    },
    {
        say: 'The A4 version is still there, untouched: switching between them is just this dropdown. '
            + 'Each variant keeps its own templates, so a fix in one never touches the other.',
        do: async (page, ctx) => {
            await ctx.pick(variantSelect(page), 'Default');
            await ctx.wait(1500);
            await ctx.pick(variantSelect(page), 'reMarkable');
        },
    },
    {
        chapter: 'Units',
        say: 'Sizes are stored in points, and the unit menu in Template Settings converts them. Switch to millimeters, '
            + 'and the tablet page reads about 180 by 240.',
        do: async (page, ctx) => {
            await ctx.click(await at(page, -40, 400, 509));
            const unit = settings(page).locator('select[title="Dimension unit"]');
            await ctx.move(unit);
            await ctx.atSentence(1);
            await ctx.pick(unit, 'mm');
            await ctx.move(settings(page).locator('label:text-is("Width") + input'));
        },
    },
    {
        chapter: 'Starting points',
        say: "If you'll make more books like this one, Save Preset turns the whole project into a starting point. "
            + 'Give it a name and a short description. Everything comes along: both variants, every template, and the pages too.',
        do: async (page, ctx) => {
            await ctx.click(page.getByRole('button', { name: 'Save Preset' }).first());
            await ctx.atSentence(1);
            await ctx.click(page.getByPlaceholder('My Custom Project'));
            await ctx.press('Control+a');
            await ctx.type('Recipe notebook', { wpm: 170 });
            await ctx.click(page.getByPlaceholder('A short description of this template...'));
            await ctx.type('Cover, index and recipe pages', { wpm: 190 });
            await ctx.click(page.locator('form').getByRole('button', { name: 'Save Preset' }));
        },
    },
    {
        say: 'It now waits in the New Project dialog, beside the built-in presets. Every project made from it is an independent copy.',
        do: async (page, ctx) => {
            await ctx.click(page.locator('button[title="New Project"]').first());
            const dialog = page.getByRole('dialog', { name: 'Create New Project' });
            await dialog.waitFor();
            await ctx.move(app.presetCard(page, 'Recipe notebook'));
            await ctx.atSentence(1);
            await ctx.press('Escape');
        },
    },
    {
        chapter: 'Under the hood',
        say: 'Everything you have built is one JSON document. The JSON button opens it, as a tree you can browse, or as plain text. '
            + 'It is handy for bulk changes, and Apply Changes lands any edit as a single undo step.',
        do: async (page, ctx) => {
            await ctx.click(app.pane(page).getByRole('button', { name: 'JSON', exact: true }));
            const editor = page.locator('.editor-dialog-panel', { has: page.locator('h2:text-is("Project JSON Editor")') });
            await editor.waitFor();
            await ctx.move(editor.getByText('Variants').first());
            await ctx.atSentence(1);
            await ctx.click(editor.getByRole('button', { name: 'Text', exact: true }));
            await ctx.atSentence(2, { offset: 1.5 });
            await ctx.click(editor.getByRole('button', { name: 'Cancel', exact: true }));
        },
    },
    {
        chapter: 'Exporting every device',
        say: 'Export PDF prints the variant you are looking at. The All button beside it prints every variant, one PDF each, '
            + 'named after its variant. And the greyscale button from episode six works on all of them at once.',
        do: async (page, ctx) => {
            await ctx.move(page.getByRole('button', { name: 'Export PDF' }).first());
            await ctx.atSentence(1);
            await ctx.move(page.locator('button[title="Export All Variants (one PDF per variant)"]'));
            await ctx.atSentence(2);
            await ctx.move(page.locator('button[title="Greyscale Export: OFF"]'));
            await ctx.atSentence(2, { end: true });
            ctx.state.pdfs = await ctx.downloads(
                () => ctx.click(page.locator('button[title="Export All Variants (one PDF per variant)"]')), 2);
        },
    },
    {
        say: "Here's the [reMarkable](=remarkable) copy: the same pages, with the same links, shaped for the tablet.",
        do: async (page, ctx) => {
            const tablet = ctx.state.pdfs.find(f => /reMarkable/i.test(f)) ?? ctx.state.pdfs.at(-1);
            await ctx.openPdf(tablet, { title: 'Family Recipes (reMarkable).pdf' });
            await ctx.move({ x: 1000, y: 500 });
            await ctx.pdfNextPage();
        },
    },
    {
        say: 'Next time: the generator, where a few lines of code build a whole planner.',
        hold: 3,
        do: async (page, ctx) => {
            await ctx.atSentence(0, { offset: 1.2 });
            await ctx.endCard();
        },
    },
];
