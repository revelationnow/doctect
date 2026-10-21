// Episode 7 — Real calendars: offsets, slicing & traversal.
// Back to the 2026 Planner preset: why a month's day 1 needs an offset, the
// dynamic offset read from weekday_num (and February's wrap-around), Final
// Data Subset as a window onto one list, then a mini calendar built on the
// year page by traversing year → quarter → month → days.
import { episodeMeta } from './series.js';
import * as app from '../lib/app.js';

export const meta = episodeMeta(7, {
    description: 'Calendars are grids with one extra problem: day 1 has to land under the right weekday. Using the 2026 Planner, '
        + 'we look at the dynamic offset that solves it, slices that turn one list into separate windows, and then build a '
        + 'mini calendar on the year page by reaching three levels down the tree.',
    learn: [
        'Why calendars need an offset, and Static versus Dynamic',
        'How weekday_num and the adjustment put day 1 in the right column',
        'The wrap-around for months that start on a Sunday',
        'Final Data Subset: one source, separate windows',
        'Deep Traversal: grids over grandchildren',
        'Why an empty grid usually means an empty source',
    ],
    docs: ['/docs/editor/grids-calendars-and-data-shaping', '/docs/reference/dynamic-offset'],
    thumbnail: { beat: 12, headline: 'Real calendars' },
});

const PALETTE = ['#0f172a', '#334155', '#64748b', '#cbd5e1', '#ffffff', '#fef3c7', '#b91c1c', '#ea580c'];
const PAGE_W = 509; // the planner's pages are reMarkable Paper Pro sized
const at = (page, x, y) => app.pagePoint(page, x, y, PAGE_W);
const grid = (page) => app.section(page, 'grid-configuration');
const gridInput = (page, label) => grid(page).locator(`label:text-is("${label}") + input`);
const geometryInput = (page, i) => app.section(page, 'geometry').locator('input').nth(i);
const typography = (page) => app.section(page, 'typography');
const offsetRow = (page) => grid(page).locator('label', { hasText: 'Offset (Skip items)' }).locator('xpath=..');
const offsetMode = (page) => offsetRow(page).locator('select');
const subset = (page) => grid(page).locator('label', { hasText: 'Final Data Subset' }).locator('xpath=..');
/** A Deep Traversal level's Start / Count inputs (0-based level). */
const level = (page, i) => grid(page).locator('input[placeholder="Start"]').nth(i).locator('xpath=../..');

async function addLevel(ctx, start, count) {
    const before = await grid(ctx.page).locator('input[placeholder="Start"]').count();
    await ctx.click(grid(ctx.page).getByRole('button', { name: 'Add Level' }));
    const row = level(ctx.page, before);
    await app.retype(ctx, row.locator('input[placeholder="Start"]'), start);
    if (count !== undefined) await app.retype(ctx, row.locator('input[placeholder="Count"]'), count);
}

export async function setup(ctx) {
    await ctx.goto('/app');
    await app.editorReady(ctx.page);
    await app.newProjectFromPreset(ctx, '2026 Planner');
    await ctx.click(app.sidebarTab(ctx.page, 'Templates'));
    await app.selectTemplate(ctx, 'Month View');
    await ctx.pick(app.previewSelect(ctx.page), 'January');
    await ctx.wait(1500);
    await ctx.titleCard();
    await ctx.wait(900);
}

export const beats = [
    {
        chapter: 'Welcome', lowerThird: false,
        say: "Back to the 2026 planner from episode one. Its calendars are grids, with a problem the recipe index never had: "
            + "day 1 has to land under the right weekday, and that's a different column every month.",
        do: async (page, ctx) => {
            await ctx.wait(2500);
            await ctx.cardOut();
            await ctx.move(await at(page, 250, 200));
        },
    },
    {
        chapter: 'The calendar problem',
        say: "This is the Month View template, previewing January. Thirty-one days in seven columns, with Monday first. "
            + 'And January the first sits under Thursday, after three blank cells.',
        do: async (page, ctx) => {
            await ctx.move(app.previewSelect(page));
            await ctx.atSentence(1);
            await ctx.move(await at(page, 73, 70), { duration: 700 });
            await ctx.move(await at(page, 433, 70), { duration: 1300 });
            await ctx.atSentence(2);
            await ctx.move(await at(page, 253, 112));
            await ctx.zoom(await (async () => {
                const a = await at(page, 30, 50), b = await at(page, 470, 220);
                return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
            })(), { scale: 1.5 });
        },
    },
    {
        chapter: 'Dynamic offset',
        say: 'Click the calendar, and find Offset, under Grid Configuration. Static would skip the same number of cells in every month. '
            + 'This one is set to Dynamic.',
        do: async (page, ctx) => {
            ctx.unzoom();
            await ctx.click(await at(page, 300, 240));
            await offsetRow(page).scrollIntoViewIfNeeded();
            await ctx.move(offsetRow(page));
            await ctx.atSentence(2);
            await ctx.spotlight(offsetRow(page).locator('xpath=..'), '', 6);
        },
    },
    {
        say: 'Dynamic reads a field from the first day, [weekday_num](=weekday num), and adds the number beside it: minus one. '
            + '[weekday_num](=weekday num) starts counting at Sunday, which is zero, so Thursday is 4. This calendar starts on Monday, not Sunday, '
            + 'hence the minus one. Four, minus one: three blank cells.',
        do: async (page, ctx) => {
            await ctx.move(offsetRow(page).locator('xpath=..').locator('input[placeholder="Field Name"]'));
            await ctx.atSentence(1);
            await ctx.move(offsetRow(page).locator('xpath=..').locator('input[placeholder="+/-"]'));
            await ctx.atSentence(3);
            await ctx.unspotlight();
            await ctx.move(await at(page, 253, 112));
        },
    },
    {
        say: 'Switch it to Static, and day 1 drops back into the first cell, under Monday. Back to Dynamic, and it moves to Thursday again. '
            + 'That one setting does all the work.',
        do: async (page, ctx) => {
            await ctx.pick(offsetMode(page), 'Static');
            await ctx.move(await at(page, 73, 112));
            await ctx.atSentence(1);
            await ctx.pick(offsetMode(page), 'Dynamic (Field)');
            await ctx.move(await at(page, 253, 112));
        },
    },
    {
        say: "February is the interesting one. It starts on a Sunday, weekday zero, so the sum is minus one. A negative offset wraps around "
            + "once, by the number of columns, and day 1 lands in the last column, where Sunday belongs.",
        do: async (page, ctx) => {
            await ctx.pick(app.previewSelect(page), 'February');
            await ctx.atSentence(2);
            await ctx.move(await at(page, 433, 112));
        },
    },
    {
        chapter: 'Slicing',
        say: 'Final Data Subset takes a window of a list. The year page shows it best: two grids, one source, the seven sections under the year. '
            + 'The first grid takes four, starting at zero: the quarters.',
        do: async (page, ctx) => {
            await app.selectTemplate(ctx, 'Year View');
            await ctx.atSentence(1);
            await ctx.click(await at(page, 144, 230));
            await subset(page).scrollIntoViewIfNeeded();
            await ctx.atSentence(2);
            await ctx.spotlight(subset(page), '', 6);
            await ctx.move(subset(page));
        },
    },
    {
        say: 'The second skips four and takes three: Weeks, Notes and To-Do Lists. Same children, two windows, no overlap.',
        do: async (page, ctx) => {
            await ctx.unspotlight();
            await ctx.click(await at(page, 244, 362));
            await subset(page).scrollIntoViewIfNeeded();
            await ctx.spotlight(subset(page), '', 6);
            await ctx.move(subset(page));
            await ctx.atSentence(1);
            await ctx.unspotlight();
        },
    },
    {
        chapter: 'Reaching grandchildren',
        say: "Now let's add a little calendar of January to this page. G for grid, and drag out some room under the lists.",
        do: async (page, ctx) => {
            await ctx.click(await at(page, -50, 600));
            await ctx.tool('g');
            await ctx.atSentence(1);
            await ctx.drag(await at(page, 150, 496), await at(page, 360, 650), { duration: 1000 });
        },
    },
    {
        say: "Its source is the year itself, and the year's children are quarters, not days. Deep Traversal walks further down. "
            + 'Add Level, and take one child, starting at zero: Quarter 1.',
        do: async (page, ctx) => {
            await grid(page).getByRole('button', { name: 'Add Level' }).scrollIntoViewIfNeeded();
            await ctx.move(grid(page).getByRole('button', { name: 'Add Level' }));
            await ctx.atSentence(2);
            await addLevel(ctx, 0, 1);
        },
    },
    {
        say: 'Another level, one child again: January. And a third level with no count, so it takes every day. '
            + 'Three levels down, from the year to its days.',
        do: async (page, ctx) => {
            await addLevel(ctx, 0, 1);
            await ctx.atSentence(1);
            await addLevel(ctx, 0);
            await ctx.move(await at(page, 250, 560));
        },
    },
    {
        say: "Now the cells are January's days, showing their full titles. To make a calendar, the Display Template becomes "
            + '[day_num](=day num), just the number. Then seven columns, small gaps, and small cells: 28 by 18 points, with 9 point text.',
        do: async (page, ctx) => {
            await ctx.atSentence(1);
            await app.retype(ctx, gridInput(page, 'Display Template'), 'day_num', { commit: null });
            await ctx.atSentence(2);
            await app.retype(ctx, gridInput(page, 'Cols'), 7);
            await app.retype(ctx, gridInput(page, 'Gap X'), 2);
            await app.retype(ctx, gridInput(page, 'Gap Y'), 2);
            await app.retype(ctx, geometryInput(page, 2), 28, { commit: 'Enter' });
            await app.retype(ctx, geometryInput(page, 3), 18, { commit: 'Enter' });
            await app.retype(ctx, typography(page).locator('input[type=number]').first(), 9);
        },
    },
    {
        say: 'And the same dynamic offset as Month View: [weekday_num](=weekday num), minus one. January the first moves across to Thursday.',
        do: async (page, ctx) => {
            await ctx.pick(offsetMode(page), 'Dynamic (Field)');
            const row = offsetRow(page).locator('xpath=..');
            await ctx.click(row.locator('input[placeholder="Field Name"]'));
            await ctx.type('weekday_num', { wpm: 160 });
            // step down from 0 with the arrow key: typing "-" first would leave the number box empty for a moment
            await ctx.click(row.locator('input[placeholder="+/-"]'));
            await ctx.press('ArrowDown');
            await ctx.move(await at(page, 250, 560));
        },
    },
    {
        say: "Change the second level to start at 1, and it's February, wrapped round to start on Sunday. And every cell is a link to its own day page.",
        do: async (page, ctx) => {
            await app.retype(ctx, level(page, 1).locator('input[placeholder="Start"]'), 1);
            await ctx.move(await at(page, 330, 520));
        },
    },
    {
        chapter: 'When a grid goes blank',
        say: "One last tip. Ask a level for a child that isn't there, a fourth month in a quarter, say, and the grid has nothing to show. "
            + "The editor fills it with Item placeholders, there's no error, and the PDF would show nothing. "
            + 'So when a grid goes blank, check the hierarchy before the grid.',
        do: async (page, ctx) => {
            await app.retype(ctx, level(page, 1).locator('input[placeholder="Start"]'), 3);
            await ctx.move(await at(page, 250, 540));
            await ctx.atSentence(2);
            await app.retype(ctx, level(page, 1).locator('input[placeholder="Start"]'), 0);
        },
    },
    {
        say: 'Next time: references, and how one page can appear in two places at once.',
        hold: 3,
        do: async (page, ctx) => {
            await ctx.atSentence(0, { offset: 1.2 });
            await ctx.endCard();
        },
    },
];
