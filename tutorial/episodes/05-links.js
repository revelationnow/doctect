// Episode 5 — Links: making every page navigable.
// Continues the recipe notebook: a back link (Go to Parent Page), previous and
// next (Go to Sibling, ±1), why links name relationships instead of page
// numbers, and the resolve-or-disappear rule, checked by clicking through the
// exported PDF.
import { episodeMeta } from './series.js';
import * as app from '../lib/app.js';

export const meta = episodeMeta(5, {
    description: 'Every recipe page gets a navigation bar: back to the index, previous and next. One template element per link, '
        + 'each naming a relationship rather than a page number, and a look at what happens to a link with nowhere to go.',
    learn: [
        'Where links live: Interaction, On Click',
        'Go to Parent Page for back buttons',
        'Go to Sibling with +1 and -1 for next and previous',
        'Why links name relationships, not page numbers',
        'The rule: a link that resolves to nothing removes its element',
        'Testing links in the exported PDF',
    ],
    docs: ['/docs/editor/linking', '/docs/reference/on-click-interaction'],
    thumbnail: { beat: 6, headline: 'Links' },
});

const PALETTE = ['#fdba74', '#fed7aa', '#ea580c', '#9a3412', '#7c2d12', '#0f172a', '#64748b', '#ffffff'];
const at = (page, x, y) => app.pagePoint(page, x, y);
const typography = (page) => app.section(page, 'typography');
const interaction = (page) => app.section(page, 'interaction');
const onClick = (page) => interaction(page).locator('select').first();

/** A small nav label at the top of the Recipe template. */
async function navLabel(ctx, from, to, text) {
    await ctx.tool('t');
    await ctx.drag(await at(ctx.page, ...from), await at(ctx.page, ...to), { duration: 700 });
    await ctx.type(text, { wpm: 150 });
    await ctx.press('Escape');
}

async function showInteraction(ctx) {
    const section = interaction(ctx.page);
    await section.scrollIntoViewIfNeeded();
    if (!(await onClick(ctx.page).isVisible().catch(() => false))) await ctx.click(section.getByText('Interaction').first());
    await ctx.move(onClick(ctx.page));
}

export async function setup(ctx) {
    await ctx.goto('/app');
    await app.editorReady(ctx.page);
    await app.loadFixture(ctx, '04-recipe-index');
    await ctx.click(app.sidebarTab(ctx.page, 'Templates'));
    await app.selectTemplate(ctx, 'Recipe');
    await ctx.wait(1200);
    await ctx.titleCard();
    await ctx.wait(900);
}

export const teardown = (ctx) => app.saveFixture(ctx, '05-recipe-links');

export const beats = [
    {
        chapter: 'Welcome', lowerThird: false,
        say: "Last time, the cover's index started linking to every recipe. But once you're on a recipe, there's no way back, "
            + 'and no way to the next one. Today we add the links you set yourself.',
        do: async (page, ctx) => {
            await ctx.wait(2500);
            await ctx.cardOut();
            await ctx.move(await at(page, 300, 90));
        },
    },
    {
        chapter: 'A back link',
        say: "On the Recipe template, I'll start a small navigation bar along the top: a text box that says All recipes. "
            + 'Small, and in the same brown.',
        do: async (page, ctx) => {
            await navLabel(ctx, [236, 34], [360, 52], 'All recipes');
            await ctx.atSentence(1);
            const ty = typography(page);
            await app.retype(ctx, ty.locator('input[type=number]').first(), 11);
            await ctx.pickColor(ty.locator('input[type=color]').first(), '#9a3412', PALETTE);
        },
    },
    {
        say: 'Links live at the very bottom of Element Properties, under Interaction. The On Click menu has eight targets. '
            + 'This one is Go to Parent Page.',
        do: async (page, ctx) => {
            await showInteraction(ctx);
            await ctx.atSentence(2);
            await ctx.pick(onClick(page), 'Go to Parent Page');
        },
    },
    {
        say: "Notice it never asks for a page number. This template draws all three recipes, so a page number would be right on one "
            + 'and wrong on the other two. Instead, a link names a relationship, my parent, and each page works out where that is when you export.',
        do: async (page, ctx) => {
            await ctx.move(await at(page, 298, 44));
            await ctx.atSentence(1);
            await ctx.move(app.previewSelect(page));
            await ctx.atSentence(2);
            await ctx.move(await at(page, 298, 44));
        },
    },
    {
        chapter: 'Next and previous',
        say: "Now sideways. A Next label on the right, and its target is Go to Sibling, with an offset of 1: "
            + 'one step forward among the pages that share its parent.',
        do: async (page, ctx) => {
            await navLabel(ctx, [452, 34], [552, 52], 'Next →');
            await showInteraction(ctx);
            await ctx.pick(onClick(page), 'Go to Sibling (Offset)');
            await app.retype(ctx, interaction(page).locator('input[type=number]'), 1);
        },
    },
    {
        say: 'And Previous on the left: the same target, with an offset of minus 1. It takes a minute to set up, '
            + 'but it happens once, on the template, and every recipe gets the whole bar.',
        do: async (page, ctx) => {
            await navLabel(ctx, [44, 34], [144, 52], '← Previous');
            await showInteraction(ctx);
            await ctx.pick(onClick(page), 'Go to Sibling (Offset)');
            await app.retype(ctx, interaction(page).locator('input[type=number]'), -1);
        },
    },
    {
        chapter: 'Links with nowhere to go',
        say: "One rule is worth knowing before you export. Tomato Soup is the first recipe, so it has no previous page. "
            + "A link like that isn't left pointing at nothing. The whole element is left off that page.",
        do: async (page, ctx) => {
            await ctx.move(await at(page, 94, 44));
            await ctx.atSentence(2);
            await ctx.spotlight(await (async () => {
                const a = await at(page, 40, 30), b = await at(page, 148, 56);
                return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
            })(), '', 4);
            await ctx.wait(1800);
            await ctx.unspotlight();
        },
    },
    {
        chapter: 'Trying them',
        say: "Let's export and check. Page one is still the cover, so I'll scroll on to Tomato Soup. "
            + 'It has All recipes, and Next, but no Previous.',
        do: async (page, ctx) => {
            ctx.state.pdf = await ctx.download(() => ctx.click(page.getByRole('button', { name: 'Export PDF' }).first()));
            await ctx.wait(1000);
            await ctx.openPdf(ctx.state.pdf, { title: 'Family Recipes.pdf' });
            await ctx.atSentence(1, { offset: 1.5 });
            await ctx.pdfNextPage();
            await ctx.atSentence(2);
            await ctx.move({ x: 720, y: 140 });
        },
    },
    {
        say: 'Next takes us to Banana Bread, the middle recipe, which has both.',
        do: async (page, ctx) => {
            await ctx.clickPdfLink({ near: [0.84, 0.052] });
            await ctx.move({ x: 620, y: 140 });
        },
    },
    {
        say: 'And All recipes goes back to the cover, with its index, ready for the next pick.',
        do: async (page, ctx) => {
            await ctx.clickPdfLink({ near: [0.5, 0.052] });
            await ctx.move({ x: 720, y: 520 });
        },
    },
    {
        say: 'Next time: layers, stacking, and the finer points of styling.',
        hold: 3,
        do: async (page, ctx) => {
            await ctx.atSentence(0, { offset: 1.2 });
            await ctx.endCard();
        },
    },
];
