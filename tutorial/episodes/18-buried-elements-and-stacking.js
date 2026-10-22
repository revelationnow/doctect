// Episode 18 — Buried elements and stacking.
// The recipe notebook as episode 6 left it: the cover's dotted card sits under
// the title, and the recipe pages' card sits on a locked Background layer. Four
// ways to reach it without moving anything (click again, Alt-click, the
// right-click menu, the Layers panel), a paler fill for both cards, and why
// layer order beats Z-Index on the canvas and in the PDF.
import { episodeMeta } from './series.js';
import * as app from '../lib/app.js';

export const meta = episodeMeta(18, {
    description: 'Episode 6 put the recipe pages\' dotted card on a locked Background layer, under everything else. Here we reach it, '
        + 'and the cover\'s card under the title, four ways: clicking again, Alt-click, the right-click menu and the Layers panel, '
        + 'without unlocking anything or nudging what sits on top. Then why the title stays in front of a card with the same '
        + 'Z-Index, or any Z-Index: layer order counts first, on the canvas and in the PDF.',
    learn: [
        'Click again to step down through a stack, and the one spot where it doesn\'t',
        'Alt-click (Option-click on a Mac) to dig without grabbing',
        'The right-click menu: everything under the pointer, with its type and layer',
        'The Layers panel reaches locked and hidden elements',
        'Editing a locked element from Element Properties',
        'Why layer order beats Z-Index',
    ],
    docs: ['/docs/editor/selecting-overlapped-elements', '/docs/editor/layers'],
    thumbnail: { beat: 4, headline: 'Buried elements' },
});

const PALETTE = ['#fdba74', '#fed7aa', '#ea580c', '#9a3412', '#7c2d12', '#0f172a', '#64748b', '#ffffff'];
const PALER_PEACH = '#fed7aa'; // the cover circle's fill
const at = (page, x, y) => app.pagePoint(page, x, y);
const layers = (page) => app.pane(page).getByTestId('layers-panel');
const layerRow = (page, name) => layers(page).locator('[data-testid^="layer-row-"]', { has: page.locator(`[data-testid="layer-name"]:text-is("${name}")`) }).first();
const elementRow = (page, label) => layers(page).locator('[data-testid^="element-row-"]', { has: page.locator(`span.truncate:text-is("${label}")`) }).first();
const menu = (page) => page.getByTestId('select-under-menu');
const menuRow = (page, label) => menu(page).locator('button', { has: page.locator(`span.truncate:text-is("${label}")`) }).first();
const appearance = (page) => app.section(page, 'appearance');
const fillSwatch = (page) => appearance(page).locator('input[type=color]').first();
const zIndexField = (page) => app.section(page, 'geometry').locator('label:text-is("Z-Index")').locator('xpath=..');

// Click spots in page points: on the word "Family", on the subtitle, on "Tomato". All
// stay clear of a selected element's centre, where its pivot dot takes the press.
const FAMILY = [200, 318];
const SUBTITLE = [200, 377];
const TOMATO = [230, 88];
const TITLE_CENTRE = [297.5, 317.3];

/** Spotlights a properties-panel block once it has scrolled into view and stopped moving. */
async function spot(ctx, locator) {
    await locator.scrollIntoViewIfNeeded();
    let prev = null, box = null;
    for (let i = 0; i < 30; i++) {
        box = await locator.boundingBox();
        if (box && prev && Math.abs(box.y - prev.y) < 0.5 && Math.abs(box.x - prev.x) < 0.5) break;
        prev = box;
        await ctx.page.waitForTimeout(80);
    }
    await ctx.spotlight(box, '', 6);
}

async function pickFill(ctx, hex) {
    const swatch = fillSwatch(ctx.page);
    await swatch.scrollIntoViewIfNeeded();
    await ctx.move(appearance(ctx.page).getByText('Fill', { exact: true }).first());
    await ctx.pickColor(swatch, hex, PALETTE);
}

export async function setup(ctx) {
    const { page } = ctx;
    await ctx.goto('/app');
    await app.editorReady(page);
    await app.loadFixture(ctx, '06-recipe-styled');
    await ctx.click(app.sidebarTab(page, 'Templates'));
    await app.selectTemplate(ctx, 'A4 Blank');
    // Template Settings folded and Layers open, so every row of Layer 1 is in view.
    await ctx.click(app.section(page, 'template-settings').locator('button').first());
    await ctx.click(app.section(page, 'layers').locator('button').first());
    await layers(page).waitFor();
    await ctx.move(await at(page, 420, 640));
    await ctx.wait(1200);
    await ctx.titleCard();
    await ctx.wait(900);
}

export const beats = [
    {
        chapter: 'Welcome', lowerThird: false,
        say: 'Episode 6 put the dotted card on a locked Background layer, under everything else. '
            + "Today I'll lighten its dots without touching the lock or nudging what sits on top. "
            + "And we'll see what decides which element ends up in front.",
        do: async (page, ctx) => {
            await ctx.wait(2500);
            await ctx.cardOut();
            await ctx.atSentence(1);
            await ctx.move(await at(page, 150, 600));
            await ctx.atSentence(2);
            await ctx.move(elementRow(page, 'Recipes'), { ax: 0.3 });
            await ctx.move(elementRow(page, 'Rect'), { ax: 0.3, duration: 900 });
        },
    },
    {
        chapter: 'Click again',
        say: 'First, the cover. Nothing is locked here, and the card lies under the title. Click the title, and you get the title. '
            + 'Click again on the same spot, and the selection steps down a level, to the card.',
        do: async (page, ctx) => {
            await ctx.move(await at(page, 300, 200));
            await ctx.atSentence(2);
            await ctx.click(await at(page, ...FAMILY));
            await ctx.atSentence(3);
            await ctx.click(await at(page, ...FAMILY));
        },
    },
    {
        say: "One more click wraps back to the title. That's the quickest way when you're already on the top element. "
            + "One catch: a click on the dot in the middle doesn't step down. That's the pivot, so click beside it.",
        do: async (page, ctx) => {
            await ctx.click(await at(page, ...FAMILY));
            await ctx.atSentence(2);
            await ctx.click(await at(page, ...TITLE_CENTRE));
            await ctx.atSentence(3);
            await ctx.move(await at(page, ...FAMILY));
        },
    },
    {
        chapter: 'Alt-click',
        say: 'Alt-click, or Option-click on a Mac, digs the same way but never grabs, so nothing can move by accident. '
            + 'Alt-click the subtitle: you get the subtitle. Again, same spot: the card.',
        do: async (page, ctx) => {
            await ctx.move(await at(page, ...SUBTITLE));
            await ctx.atSentence(1);
            await ctx.click(await at(page, ...SUBTITLE), { hold: 'Alt' });
            await ctx.atSentence(2);
            await ctx.click(await at(page, ...SUBTITLE), { hold: 'Alt' });
        },
    },
    {
        chapter: 'The right-click menu',
        say: 'When the pile is deep, or things look alike, right-click, or two-finger click on a trackpad. '
            + 'The menu lists everything under the pointer, top to bottom, with its type and its layer.',
        do: async (page, ctx) => {
            await ctx.move(await at(page, ...FAMILY));
            await ctx.showKeys(['Right-click']);
            await ctx.click(await at(page, ...FAMILY), { button: 'right' });
            await menu(page).waitFor();
            await ctx.atSentence(1);
            await ctx.move(menuRow(page, 'Family Recipes'), { ax: 0.25 });
        },
    },
    {
        say: 'Hover a row, and its element is outlined on the page, so you know which is which. Click Rect, and the card is selected.',
        do: async (page, ctx) => {
            await ctx.hover(menuRow(page, 'Rect'), 300);
            await ctx.atSentence(1);
            await ctx.click(menuRow(page, 'Rect'));
            await menu(page).waitFor({ state: 'detached' });
            await ctx.move(elementRow(page, 'Rect'), { ax: 0.3 });
        },
    },
    {
        say: "Now the job. In Appearance, Fill, I'll take the paler peach of the circle. The dots step back, and the title hasn't moved.",
        do: async (page, ctx) => {
            await pickFill(ctx, PALER_PEACH);
            await ctx.atSentence(2);
            await ctx.move(await at(page, 420, 600));
            await ctx.move(await at(page, 300, 318));
        },
    },
    {
        chapter: 'The Layers panel',
        say: 'On to the recipe pages. Here the card sits on Background, which we locked in episode 6. '
            + 'Right-click the title, and only the title is listed.',
        do: async (page, ctx) => {
            await app.selectTemplate(ctx, 'Recipe');
            await ctx.move(layerRow(page, 'Background').locator('button[title="Toggle lock"]'));
            await ctx.atSentence(2);
            await ctx.move(await at(page, ...TOMATO));
            await ctx.showKeys(['Right-click']);
            await ctx.click(await at(page, ...TOMATO), { button: 'right' });
            await menu(page).waitFor();
        },
    },
    {
        say: "All three canvas tricks skip locked and hidden layers. That's what locking is for. Escape closes the menu.",
        do: async (page, ctx) => {
            await ctx.move(menuRow(page, '{{title}}'), { ax: 0.3 });
            await ctx.atSentence(2);
            await ctx.press('Escape');
            await menu(page).waitFor({ state: 'detached' });
        },
    },
    {
        say: 'The Layers panel skips nothing. Under Background, click Rect, and the card is selected, even though its layer is locked.',
        do: async (page, ctx) => {
            await ctx.move(layerRow(page, 'Background'), { ax: 0.4 });
            await ctx.atSentence(1);
            await ctx.click(elementRow(page, 'Rect'), { ax: 0.3 });
            await ctx.move(await at(page, 300, 500));
        },
    },
    {
        say: "No handles, so it can't be dragged or resized. But Element Properties works as usual. Fill: the same paler peach.",
        do: async (page, ctx) => {
            await ctx.move(await at(page, 24, 24));
            await ctx.wait(500);
            await ctx.atSentence(2);
            await pickFill(ctx, PALER_PEACH);
        },
    },
    {
        say: 'Background is still locked, and nothing else has moved.',
        do: async (page, ctx) => {
            await ctx.move(layerRow(page, 'Background').locator('button[title="Toggle lock"]'));
            await ctx.wait(600);
            await ctx.move(await at(page, 300, 140));
        },
    },
    {
        chapter: 'Layer order beats Z-Index',
        say: "While the card's selected, look at Geometry. Its [Z-Index](=zee index) is 1. Click the title's row: its Z-Index is 1 as well.",
        do: async (page, ctx) => {
            await zIndexField(page).scrollIntoViewIfNeeded();
            await ctx.atSentence(1);
            await spot(ctx, zIndexField(page));
            await ctx.move(zIndexField(page).locator('input'));
            await ctx.atSentence(2);
            await ctx.unspotlight();
            await ctx.click(elementRow(page, '{{title}}'), { ax: 0.3 });
            await spot(ctx, zIndexField(page));
        },
    },
    {
        say: 'Same number, yet the title is on top, because layer order counts first. Everything on Content sits in front of everything on Background.',
        do: async (page, ctx) => {
            await ctx.unspotlight();
            await ctx.move(layerRow(page, 'Background'), { ax: 0.5 });
            await ctx.atSentence(1);
            await ctx.move(layerRow(page, 'Content'), { ax: 0.5 });
            await ctx.move(await at(page, ...TOMATO));
        },
    },
    {
        say: "Z-Index only sorts elements within one layer. Watch: I'll give the card 99. Nothing moves; it stays under Content. "
            + 'Control Z puts it back.',
        do: async (page, ctx) => {
            await ctx.click(elementRow(page, 'Rect'), { ax: 0.3 });
            const box = zIndexField(page).locator('input');
            await box.scrollIntoViewIfNeeded();
            await ctx.click(box);
            await page.keyboard.press('Control+a');
            // one input event, so one undo step (typing 9, 9 would make two)
            await page.keyboard.insertText('99');
            await ctx.wait(250);
            await page.keyboard.press('Tab');
            await ctx.atSentence(2);
            await ctx.move(await at(page, 300, 300));
            await ctx.atSentence(3);
            await ctx.press('Control+z');
            await ctx.move(box);
        },
    },
    {
        say: 'To bring something forward past a layer, move it there with Move to, or drag its layer up by the grip.',
        do: async (page, ctx) => {
            await ctx.move(layers(page).getByTestId('move-selection-select'));
            await ctx.atSentence(0, { offset: 3.2 });
            await ctx.move(layerRow(page, 'Background').locator('[title="Reorder layer"]'));
        },
    },
    {
        chapter: 'The result',
        // The export and the reader take a few seconds: this beat's words cover them, and the
        // next beat (what the pages show) only starts once the PDF is open.
        say: "Let's export. The PDF is drawn a layer at a time, back to front, in the same order as the canvas.",
        do: async (page, ctx) => {
            ctx.state.pdf = await ctx.download(() => ctx.click(page.getByRole('button', { name: 'Export PDF' }).first()));
            await ctx.wait(800);
            await ctx.openPdf(ctx.state.pdf, { title: 'Family Recipes.pdf' });
            await ctx.move({ x: 860, y: 560 });
        },
    },
    {
        say: 'On the cover, lighter dots. And on a recipe page, lighter dots too, still under every word.',
        do: async (page, ctx) => {
            await ctx.move({ x: 720, y: 330 });
            await ctx.atSentence(1);
            await ctx.pdfNextPage();
            await ctx.move({ x: 760, y: 200 });
        },
    },
    {
        say: "So: click again for what's right underneath. Alt-click when nothing may move. "
            + 'Right-click to see the whole pile, and use the Layers panel for anything locked or hidden. '
            + 'Next time: the order a grid does things in.',
        hold: 3,
        do: async (page, ctx) => {
            await ctx.atSentence(3);
            await ctx.endCard();
        },
    },
];
