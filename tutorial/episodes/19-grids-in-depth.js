// Episode 19 — Grids in depth: the order of operations.
// The 2026 Planner's Quarter View: a recap of the order a grid runs its steps
// (source, Deep Traversal, Final Data Subset, then the offset), a slice that
// trims a day where a month was meant, Empty Cell Borders to count the blank
// cells (and the real cell border they need first), the fix in traversal, and
// a Display Template typo that empties every cell. The last episode: the end
// card says the series is over.
import { episodeMeta } from './series.js';
import * as app from '../lib/app.js';
import { ZOOM } from '../lib/browser.js';

export const meta = episodeMeta(19, {
    description: 'When a grid looks wrong, it is usually doing exactly what it was told, in an order you did not expect. '
        + "On the 2026 Planner's Quarter View we recap that order, make a slicing mistake on purpose, count the blank cells "
        + 'with Empty Cell Borders, fix it in the right step, and track down a typo that empties every cell.',
    learn: [
        'The order a grid runs its steps in',
        'Why Final Data Subset trimmed a day, not a month',
        'The offset is read after the slice',
        'Empty Cell Borders, and the cell border they need first',
        'Picking a month is Deep Traversal\'s job',
        'A blank grid: check the steps, then the Display Template',
    ],
    docs: ['/docs/editor/grids-calendars-and-data-shaping', '/docs/reference/data-slicing'],
    thumbnail: { beat: 6, headline: 'Grids in depth' },
});

const PAGE_W = 509; // the planner's pages are reMarkable Paper Pro sized
const at = (page, x, y) => app.pagePoint(page, x, y, PAGE_W);
const grid = (page) => app.section(page, 'grid-configuration');
const gridInput = (page, label) => grid(page).locator(`label:text-is("${label}") + input`);
const sourceBlock = (page) => grid(page).locator('label:text-is("Source")').locator('xpath=..');
const traversalBlock = (page) => grid(page).locator('label', { hasText: 'Deep Traversal' }).locator('xpath=../..');
const subset = (page) => grid(page).locator('label', { hasText: 'Final Data Subset' }).locator('xpath=..');
const subsetStart = (page) => subset(page).locator('input[placeholder="Start (0)"]');
const offsetRow = (page) => grid(page).locator('label', { hasText: 'Offset (Skip items)' }).locator('xpath=..');
/** A Deep Traversal level's Start box (0-based level). */
const levelStart = (page, i) => grid(page).locator('input[placeholder="Start"]').nth(i);
const formatting = (page) => grid(page).getByText('Grid Formatting', { exact: true });
const cellBorder = (page) => grid(page).locator('label:text-is("Cell Border")').locator('xpath=..');
const emptyBorders = (page) => grid(page).locator('label:text-is("Empty Cell Borders")').locator('xpath=..');

// April's mini calendar on Quarter View: 7 columns of 17 × 15 pt cells at x 50, y 82.
const cell = (page, c, r) => at(page, 50 + 17 * c + 8.5, 82 + 15 * r + 7.5);
/** Just under a cell's number, so the pointer doesn't hide it. */
const under = (page, c, r) => at(page, 50 + 17 * c + 9, 82 + 15 * r + 14);
const CALENDAR = [42, 62, 177, 176]; // April's calendar and its weekday letters, in points

/** The union of several locators' boxes (CSS px), for one spotlight over neighbouring rows. */
async function boxOf(...locators) {
    const boxes = (await Promise.all(locators.map(l => l.boundingBox()))).filter(Boolean);
    const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
    const right = Math.max(...boxes.map(b => b.x + b.width)), bottom = Math.max(...boxes.map(b => b.y + b.height));
    return { x, y, width: right - x, height: bottom - y };
}

/** A post-production close-up on a page rectangle (points). */
async function closeUp(ctx, [x1, y1, x2, y2], scale = 1.6) {
    const a = await at(ctx.page, x1, y1), b = await at(ctx.page, x2, y2);
    await ctx.zoom({ x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y }, { scale });
}

/** Scrolls the properties panel with the wheel until `target` sits near the top of it. */
async function scrollPanelTo(ctx, target, top = 150) {
    const box = await target.boundingBox();
    if (!box || Math.abs(box.y - top) < 30) return;
    const panel = await app.propertiesColumn(ctx.page).boundingBox();
    // a wheel over a focused number box changes its value instead of scrolling: let go of the field first
    await ctx.page.evaluate(() => document.activeElement?.blur());
    // wheel deltas are screen pixels; the page scrolls them divided by the page zoom
    await ctx.wheel((box.y - top) * ZOOM, { at: { x: panel.x + panel.width * 0.55, y: panel.y + panel.height * 0.6 }, steps: 8 });
}

/** Fails the run (dry or real) when a box doesn't hold what the narration says it holds. */
async function expectValue(locator, expected) {
    const value = await locator.inputValue();
    if (value !== String(expected)) throw new Error(`expected "${expected}" in the box, found "${value}"`);
}

export async function setup(ctx) {
    const { page } = ctx;
    await ctx.goto('/app');
    await app.editorReady(page);
    await app.newProjectFromPreset(ctx, '2026 Planner');
    await app.sidebarTab(page, 'Templates').click();
    const row = app.templateRow(page, 'Quarter View');
    await row.locator('span.truncate').first().click();
    await app.previewSelect(page).selectOption({ label: 'Quarter 2' });
    // Template Settings folded, so Grid Configuration fits the panel when the calendar is selected
    await app.section(page, 'template-settings').getByRole('button', { name: 'Template Settings' }).click();
    const zoom = app.pane(page).locator('span.font-mono', { hasText: /^\d+%$/ }).first();
    for (let i = 0; i < 30 && (await zoom.textContent()) !== '150%'; i++) {
        const below = parseInt(await zoom.textContent(), 10) < 150;
        await (below ? app.zoomInButton(page) : app.zoomOutButton(page)).click();
    }
    // the top of the page in view: April, May and June across the top
    await app.canvasColumn(page).evaluate(el => { el.scrollTop = 0; });
    await ctx.wait(1500);
    await ctx.titleCard();
    await ctx.wait(900);
}

export const beats = [
    {
        chapter: 'Welcome', lowerThird: false,
        say: "When a grid looks wrong, it's usually doing what it was told, in an order you didn't expect. "
            + 'Today: that order, on the Quarter View, and a switch that shows every cell.',
        do: async (page, ctx) => {
            await ctx.wait(2500);
            await ctx.cardOut();
            await ctx.move(await cell(page, 3, 2));
        },
    },
    {
        chapter: 'Four steps, in order',
        say: "I'll click April's calendar. As in episode 7, its steps run in the order they're listed. "
            + "The source and Deep Traversal find April's days, Final Data Subset, empty here, would trim them, and the offset comes last. "
            + 'April starts on a Wednesday, so two blank cells.',
        do: async (page, ctx) => {
            await ctx.click(await cell(page, 2, 2)); // 15
            await grid(page).waitFor();
            await ctx.atSentence(1);
            await scrollPanelTo(ctx, sourceBlock(page), 160); // Source to Offset, all in view
            await ctx.atSentence(2);
            await ctx.spotlight(await boxOf(sourceBlock(page), traversalBlock(page)), '', 6);
            await ctx.move(traversalBlock(page), { ay: 0.3 });
            await ctx.atSentence(2, { offset: 2.3 });
            await ctx.spotlight(subset(page), '', 6);
            await ctx.atSentence(2, { offset: 4.6 });
            await ctx.spotlight(offsetRow(page), '', 6);
            await ctx.atSentence(3);
            await ctx.unspotlight();
            await ctx.move(await cell(page, 0, 0));
            await ctx.move(await cell(page, 1, 0), { duration: 600 });
        },
    },
    {
        chapter: 'Slice, then offset',
        say: "Here's a mistake I've made. I want this calendar to show the next month, "
            + 'and Final Data Subset sounds right: Start Index, one.',
        do: async (page, ctx) => {
            await ctx.move(subsetStart(page));
            await ctx.atSentence(1, { offset: 2.4 });
            await app.retype(ctx, subsetStart(page), 1);
        },
    },
    {
        say: "It's still April, minus the first. The subset runs after traversal, so it trimmed a day, not a month.",
        do: async (page, ctx) => {
            await closeUp(ctx, CALENDAR);
            await ctx.move(await under(page, 3, 0)); // 02
            await ctx.atSentence(1);
            await ctx.move(await under(page, 3, 4), { duration: 900 });
        },
    },
    {
        say: "Did the offset change too? The second stayed under Thursday, but blank cells don't show here, so there's nothing to count.",
        do: async (page, ctx) => {
            await ctx.move(await under(page, 3, 0));
            await ctx.atSentence(1, { offset: 1.6 });
            await ctx.move(await cell(page, 2, 0), { duration: 500 });
            await ctx.move(await cell(page, 0, 0), { duration: 900 });
        },
    },
    {
        chapter: 'Seeing every cell',
        say: 'Empty Cell Borders, under Grid Formatting, draws them. It needs a real cell border first, '
            + 'and as in episode 4, the color and width shown here are only borrowed.',
        do: async (page, ctx) => {
            ctx.unzoom();
            await scrollPanelTo(ctx, formatting(page));
            await expectValue(subset(page).locator('input[placeholder="Count (All)"]'), '');
            await ctx.spotlight(await boxOf(cellBorder(page), emptyBorders(page)), '', 6);
            await ctx.move(emptyBorders(page).locator('button'));
            await ctx.atSentence(1, { offset: 1.5 });
            await ctx.move(cellBorder(page).locator('input[type=color]'));
            await ctx.move(cellBorder(page).locator('input[type=number]').first(), { ax: 0.3 });
        },
    },
    {
        say: 'So: a gray, half a point, and the switch. Three empty cells now. '
            + 'The offset re-read the first day left, Thursday the second. The slice ran first.',
        do: async (page, ctx) => {
            await ctx.unspotlight();
            await ctx.pickColor(cellBorder(page).locator('input[type=color]'), '#64748b');
            const width = cellBorder(page).locator('input[type=number]').first();
            await ctx.click(width, { ax: 0.3 }); // left of the number spinner, which a click would step
            await ctx.page.keyboard.press('Control+a');
            await ctx.type('0.5');
            await ctx.page.keyboard.press('Tab');
            await expectValue(width, '0.5');
            await ctx.click(emptyBorders(page).locator('button'));
            await ctx.atSentence(1);
            await closeUp(ctx, CALENDAR);
            await ctx.move(await cell(page, 0, 0));
            await ctx.move(await cell(page, 2, 0), { duration: 700 });
            await ctx.atSentence(2);
            await ctx.move(await under(page, 3, 0));
        },
    },
    {
        chapter: 'The right step',
        say: "Picking a month is traversal's job. Clear the subset, and give the first level a Start of one.",
        do: async (page, ctx) => {
            ctx.unzoom();
            await scrollPanelTo(ctx, traversalBlock(page));
            await ctx.atSentence(1);
            await ctx.click(subsetStart(page));
            await ctx.press('Control+a');
            await ctx.press('Backspace');
            await expectValue(subsetStart(page), '');
            await app.retype(ctx, levelStart(page, 0), 1);
        },
    },
    {
        say: "That's May. It starts on a Friday, so four bordered blanks: a first row that's mostly empty, for a good reason.",
        do: async (page, ctx) => {
            await closeUp(ctx, CALENDAR);
            await ctx.move(await under(page, 4, 0)); // 01
            await ctx.atSentence(1, { offset: 1.2 });
            await ctx.move(await cell(page, 0, 0), { duration: 900 });
            await ctx.move(await cell(page, 3, 0), { duration: 800 });
        },
    },
    {
        say: "Back to zero, and April's offset is two again.",
        do: async (page, ctx) => {
            ctx.unzoom();
            await app.retype(ctx, levelStart(page, 0), 0);
            await ctx.move(await cell(page, 0, 0));
            await ctx.move(await cell(page, 1, 0), { duration: 500 });
        },
    },
    {
        chapter: 'Blank cells',
        say: 'Borders help with a blank grid too. A typo in Display Template, '
            + '[day_number](=day number) instead of [day_num](=day num), and every cell goes empty.',
        do: async (page, ctx) => {
            const template = gridInput(page, 'Display Template');
            await ctx.move(template);
            await ctx.atSentence(1);
            await ctx.click(template, { ax: 0.9 });
            await ctx.page.keyboard.press('End');
            await ctx.type('ber', { wpm: 120 });
            await expectValue(template, 'day_number');
            await closeUp(ctx, CALENDAR);
            await ctx.move(await cell(page, 3, 2));
        },
    },
    {
        say: "The cells are all still there, so the steps above are fine; it's what they print. Fix the name, and the numbers come back.",
        do: async (page, ctx) => {
            await ctx.move(await cell(page, 6, 3), { duration: 1200 });
            await ctx.atSentence(1);
            for (let i = 0; i < 3; i++) await ctx.press('Backspace');
            await expectValue(gridInput(page, 'Display Template'), 'day_num');
            await ctx.move(await under(page, 2, 0));
        },
    },
    {
        say: 'So: traversal, then the subset, then the offset. The export runs the same steps, '
            + 'and the borders print too, so keep them or switch them off.',
        hold: 3,
        do: async (page, ctx) => {
            ctx.unzoom();
            await scrollPanelTo(ctx, sourceBlock(page));
            await ctx.move(traversalBlock(page), { ay: 0.2 });
            await ctx.move(subset(page), { duration: 700 });
            await ctx.move(offsetRow(page), { duration: 700 });
            await ctx.atSentence(1, { offset: 1.5 });
            await ctx.endCard();
        },
    },
];
