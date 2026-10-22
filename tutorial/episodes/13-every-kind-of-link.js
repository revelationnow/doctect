// Episode 13 — Every kind of link.
// The 2026 Planner again: the five On Click targets the core series skipped
// (a fixed page, a child by position, an ancestor by level, a child's
// referrer and a web address), Go to Sibling past the end of a list, what
// deleting a reference, a page and a link's target does, and the whole set
// clicked through in the exported PDF.
import { episodeMeta } from './series.js';
import * as app from '../lib/app.js';

export const meta = episodeMeta(13, {
    description: 'Episodes 5 and 8 used three of the eight link targets. This one covers the other five on the 2026 Planner: '
        + 'a fixed page, a child by position, an ancestor by level, a child\'s referrer and a web address. Along the way: '
        + 'what Go to Sibling does at the end of a list, which pages drop a link, what deleting a reference or a page '
        + 'does to the links around it, and a click through every one of them in the exported PDF.',
    learn: [
        'Go to Specific Page for home links and jumps across the tree',
        'Go to Child (by Index) stores a position, not a page',
        'Go to Sibling past the end of a list, and where it stops',
        'Go to Ancestor (Level) counts from the page that draws it',
        'Go to Child\'s Referrer: Start Index, Count / Direction and the filter',
        'Open URL, and what deleting does to links and references',
    ],
    docs: ['/docs/editor/linking', '/docs/reference/on-click-interaction'],
    thumbnail: { beat: 11, headline: 'Every kind of link' },
});

const PAGE_W = 509; // the planner's pages are reMarkable Paper Pro sized
const PAGE_H = 679;
const at = (page, x, y) => app.pagePoint(page, x, y, PAGE_W);
const interaction = (page) => app.section(page, 'interaction');
const typography = (page) => app.section(page, 'typography');
const onClick = (page) => interaction(page).locator('select').first();
/** An Interaction field's block (its label and control), by the label's exact text. */
const fieldBlock = (page, label) => interaction(page).locator(`label:text-is("${label}")`).locator('xpath=..');
/** Start Index / Count / Direction: the label row with its Static / Field/Expr switch, and the box under it. */
const smartBlock = (page, label) => interaction(page).locator('div.mb-2', { has: page.locator(`label:text-is("${label}")`) }).first();
const targetChild = (page) => interaction(page).locator('div.mb-2', { has: page.locator('label:text-is("Target Child")') }).locator('select');
/** Go to Specific Page's dashed button (Select Target Page..., or the page picked). */
const targetButton = (page) => interaction(page).locator('button.border-dashed').first();
const picker = (page) => page.locator('div.fixed', { has: page.locator('h2:text-is("Select Source Node")') });
const pickerRow = (page, title) => picker(page).locator('div.flex.items-center', { has: page.locator(`span.truncate:text-is("${title}")`) }).first();
const deleteDialog = (page, heading) => page.locator('div.fixed', { has: page.locator(`h2:text-is("${heading}")`) });

/** A locator's box once the panel has stopped moving (a new selection re-lays out Element Properties). */
async function settledBox(locator) {
    let prev = null;
    for (let i = 0; i < 30; i++) {
        const box = await locator.boundingBox();
        if (box && prev && Math.abs(box.x - prev.x) < 0.5 && Math.abs(box.y - prev.y) < 0.5 && Math.abs(box.height - prev.height) < 0.5) return box;
        prev = box;
        await locator.page().waitForTimeout(80);
    }
    return prev;
}

/** One box around several locators (for a spotlight over a label and its control). */
async function boxAround(...targets) {
    const boxes = [];
    for (const t of targets) boxes.push(await settledBox(t));
    const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
    const r = Math.max(...boxes.map(b => b.x + b.width)), btm = Math.max(...boxes.map(b => b.y + b.height));
    return { x, y, width: r - x, height: btm - y };
}

/** Spotlights a properties-panel block once it has scrolled into view and settled. */
async function spot(ctx, ...targets) {
    await targets[0].scrollIntoViewIfNeeded();
    await ctx.spotlight(await boxAround(...targets), '', 6);
}

/** A box on the canvas page, from page points. */
async function pageBox(page, x0, y0, x1, y1) {
    const a = await at(page, x0, y0), b = await at(page, x1, y1);
    return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
}

/** A box on the PDF reader's current page, from page points. */
async function pdfBox(page, x0, y0, x1, y1) {
    const r = await page.evaluate(() => {
        const div = document.querySelector(`.pdfViewer .page[data-page-number="${window.__viewer.state.page}"]`);
        const b = div.getBoundingClientRect();
        return { x: b.x, y: b.y, width: b.width, height: b.height };
    });
    const sx = r.width / PAGE_W, sy = r.height / PAGE_H;
    return { x: r.x + x0 * sx, y: r.y + y0 * sy, width: (x1 - x0) * sx, height: (y1 - y0) * sy };
}

/**
 * Clicks the smallest PDF link under a point (page points) and waits for the jump. A Quarter
 * page's mini calendar is one link to its month laid over a link per day, and ctx.clickPdfLink
 * takes the first of overlapping links, which is the month.
 */
async function clickPdfCell(ctx, x, y) {
    const { page } = ctx;
    const target = await pdfBox(page, x, y, x, y);
    const rect = await page.evaluate(({ x: px, y: py }) => window.__viewer.links()
        .filter(l => px >= l.x && px <= l.x + l.width && py >= l.y && py <= l.y + l.height)
        .sort((a, b) => a.width * a.height - b.width * b.height)[0] ?? null, target);
    if (!rect) throw new Error(`no PDF link at ${x}, ${y}`);
    const before = await page.evaluate(() => window.__viewer.state.jumps);
    await ctx.click(rect);
    await page.waitForFunction(b => window.__viewer.state.jumps > b, before, { timeout: 10000 });
    await page.waitForTimeout(500);
    return page.evaluate(() => window.__viewer.state.page);
}

/** Brings Element Properties' Interaction section into view (expanding it if it was folded). */
async function showInteraction(ctx) {
    const section = interaction(ctx.page);
    await section.scrollIntoViewIfNeeded();
    if (!(await onClick(ctx.page).isVisible().catch(() => false))) await ctx.click(section.getByText('Interaction').first());
    await onClick(ctx.page).scrollIntoViewIfNeeded();
}

/** Waits until the edit just made has reached local storage. */
async function savedLocally(page) {
    await page.getByRole('status').filter({ hasText: 'Saving locally' }).first().waitFor({ timeout: 1500 }).catch(() => {});
    await page.getByRole('status').filter({ hasText: 'Saved locally' }).first().waitFor({ timeout: 30000 });
}

async function rowAction(ctx, row, title) {
    await row.scrollIntoViewIfNeeded();
    await ctx.hover(row.locator('span.truncate').first(), 350);
    await ctx.click(row.locator(`button[title="${title}"]`).first());
}

const PAGE_ZOOM = 4 / 3; // the studio browser's page zoom (lib/browser.js): wheel deltas are divided by it

/** Scrolls the Hierarchy sidebar with the wheel until `row` sits a little below its middle. */
async function scrollSidebarTo(ctx, row) {
    const side = await app.sidebarColumn(ctx.page).boundingBox();
    const box = await row.boundingBox();
    const dy = box.y - (side.y + side.height * 0.55);
    if (Math.abs(dy) > 20) await ctx.wheel(dy * PAGE_ZOOM, { at: { x: side.x + side.width * 0.45, y: side.y + side.height * 0.5 }, steps: 10 });
}

export async function setup(ctx) {
    const { page } = ctx;
    await ctx.goto('/app');
    await app.editorReady(page);
    await app.newProjectFromPreset(ctx, '2026 Planner');
    await ctx.click(app.sidebarTab(page, 'Templates'));
    await app.selectTemplate(ctx, 'Day View');
    await app.previewSelect(page).selectOption({ label: 'January 31, 2026' });
    await ctx.move(app.canvas(page), { ay: 0.6 });
    await ctx.wait(1500);
    await ctx.titleCard();
    await ctx.wait(900);
}

export const beats = [
    {
        chapter: 'Welcome', lowerThird: false,
        say: 'Episode five used two link targets, and episode eight added a third. Five are left, and Go to Sibling has an edge case worth knowing. '
            + "Most of them sit on this day page's top bar.",
        do: async (page, ctx) => {
            await ctx.wait(2500);
            await ctx.cardOut();
            await ctx.atSentence(2);
            // ◀, Jan 31, ▶, 2026, Q1, Jan, Journal / Daily Notes, Sat
            for (const x of [9, 99, 180, 238, 306, 356, 416, 474]) {
                await ctx.move(await at(page, x, 21), { duration: 300 });
                await ctx.wait(110);
            }
        },
    },
    {
        chapter: 'A fixed page',
        say: 'Click 2026: Go to Specific Page. It names one page, 2026 Planner, instead of a relationship. '
            + 'Home would be three levels up from a day, but four from a journal. A fixed page is right on every template.',
        do: async (page, ctx) => {
            await ctx.click(await at(page, 238, 20));
            await showInteraction(ctx);
            await spot(ctx, fieldBlock(page, 'On Click'), targetButton(page));
            await ctx.atSentence(1);
            await ctx.move(targetButton(page));
            await ctx.atSentence(2);
            await ctx.move(app.templateRow(page, 'Day View'), { ax: 0.3 });
            await ctx.atSentence(2, { offset: 1.6 });
            await ctx.move(app.templateRow(page, 'Journal'), { ax: 0.3 });
            await ctx.atSentence(3);
            await ctx.move(await at(page, 238, 20));
        },
    },
    {
        say: "It's also how you jump across the tree. On Week View, a Notes chip: T for text, and a box at the end of the top bar.",
        do: async (page, ctx) => {
            await ctx.unspotlight();
            await ctx.atSentence(1);
            await app.selectTemplate(ctx, 'Week View');
            await ctx.tool('t');
            await ctx.drag(await at(page, 378, 7), await at(page, 476, 33), { duration: 700 });
            await ctx.type('Notes', { wpm: 150 });
            await ctx.press('Escape');
        },
    },
    {
        say: 'Go to Specific Page, then Select Target Page, and pick Notes from the tree. Now all fifty-three weeks open the same Notes list.',
        do: async (page, ctx) => {
            await showInteraction(ctx);
            await ctx.pick(onClick(page), 'Go to Specific Page');
            await ctx.click(targetButton(page));
            await picker(page).waitFor();
            await ctx.wait(500);
            await ctx.click(pickerRow(page, 'Notes').locator('span.truncate'));
            await picker(page).waitFor({ state: 'detached' });
            await ctx.atSentence(1);
            await ctx.move(targetButton(page));
            await ctx.move(await at(page, 427, 20));
        },
    },
    {
        chapter: 'By position',
        say: "On Day View, the Journal chip is [Go to Child (by Index)](=Go to Child, by Index). Target Child lists this day's pages, "
            + 'but it stores a position: zero, the first.',
        do: async (page, ctx) => {
            await app.selectTemplate(ctx, 'Day View');
            await ctx.click(await at(page, 416, 10));
            await showInteraction(ctx);
            await ctx.move(onClick(page));
            await ctx.atSentence(1);
            await ctx.pick(targetChild(page), '0: Journal');
        },
    },
    {
        say: "So every day's chip opens that day's own Journal. Use it when every page of a kind has the same sub-pages, in the same order.",
        do: async (page, ctx) => {
            await ctx.move(await at(page, 416, 10));
            await ctx.atSentence(1);
            await ctx.move(await at(page, 416, 30));
        },
    },
    {
        chapter: 'Past the end of a list',
        say: 'The right arrow is Go to Sibling, plus one. But January 31 is the last day in January. '
            + "The link doesn't wrap around; it climbs to Quarter 1 and takes the next month's first day.",
        do: async (page, ctx) => {
            await ctx.click(await at(page, 180, 20));
            await showInteraction(ctx);
            await spot(ctx, fieldBlock(page, 'Offset (+1 Next, -1 Prev)'));
            await ctx.atSentence(1);
            await ctx.move(await at(page, 99, 20));
            await ctx.atSentence(2);
            await ctx.move(await at(page, 180, 20));
        },
    },
    {
        say: "One level only. March 31's next day sits under Quarter 2, two levels away, so March 31 gets no right arrow. "
            + "The editor still draws it; the PDF won't. Any next sibling will do, though: Quarter 4's right arrow opens the Weeks list.",
        do: async (page, ctx) => {
            await ctx.unspotlight();
            await ctx.pick(app.previewSelect(page), 'March 31, 2026');
            await ctx.move(await at(page, 99, 20));
            await ctx.atSentence(2);
            await ctx.spotlight(await pageBox(page, 170, 1, 190, 39), '', 4);
            await ctx.move(await at(page, 180, 20));
            await ctx.atSentence(3);
            await ctx.unspotlight();
            await ctx.move(app.templateRow(page, 'Quarter View'), { ax: 0.3 });
            await ctx.atSentence(3, { offset: 2.2 });
            await ctx.move(app.templateRow(page, 'List Index'), { ax: 0.3 });
        },
    },
    {
        chapter: 'Levels up',
        say: '[Q1](=Q one) is [Go to Ancestor (Level)](=Go to Ancestor, by Level), two levels up: from a day to its month, then its quarter. '
            + 'Use it when the page you want is further up than the parent.',
        do: async (page, ctx) => {
            await ctx.click(await at(page, 306, 20));
            await showInteraction(ctx);
            await spot(ctx, fieldBlock(page, 'Levels Up (1 = Parent, 2 = Grandparent)'));
            await ctx.atSentence(0, { offset: 3.4 });
            await ctx.move(await at(page, 356, 20));
            await ctx.wait(500);
            await ctx.move(await at(page, 306, 20));
        },
    },
    {
        say: "The count starts from the page that draws the chip. Journals sit a level lower, so the Journal template's [Q1](=Q one) says three. "
            + 'Ask for more levels than a page has, and the chip is left off.',
        do: async (page, ctx) => {
            await ctx.unspotlight();
            await ctx.atSentence(1);
            await app.selectTemplate(ctx, 'Journal');
            await ctx.click(await at(page, 312, 20));
            await showInteraction(ctx);
            await spot(ctx, fieldBlock(page, 'Levels Up (1 = Parent, 2 = Grandparent)'));
        },
    },
    {
        chapter: "Children's referrers",
        say: "Month View's week labels need something else. No week references a month; weeks reference its days. "
            + "So Go to Child's Referrer asks about the month's children.",
        do: async (page, ctx) => {
            await ctx.unspotlight();
            await app.selectTemplate(ctx, 'Month View');
            await ctx.click(await at(page, 478, 112));
            await showInteraction(ctx);
            await ctx.move(await at(page, 250, 200));
            await ctx.atSentence(2);
            await spot(ctx, fieldBlock(page, 'On Click'));
            await ctx.move(onClick(page));
        },
    },
    {
        say: "Start Index is the last day in the label's row: [6-month_start_offset](=six, minus the blank cells before day one). "
            + '[Count / Direction](=Count, direction), minus seven, walks back up to a week. The first day a week references wins.',
        do: async (page, ctx) => {
            await smartBlock(page, 'Start Index').scrollIntoViewIfNeeded();
            await spot(ctx, smartBlock(page, 'Start Index'));
            await ctx.move(smartBlock(page, 'Start Index').locator('input'));
            await ctx.atSentence(1);
            await spot(ctx, smartBlock(page, 'Count / Direction'));
            await ctx.move(smartBlock(page, 'Count / Direction').locator('input'));
            await ctx.atSentence(2);
            await ctx.move(await at(page, 478, 112));
        },
    },
    {
        say: 'The filter prefers references on one template, and falls back to any. '
            + "One trap: the count is ignored until Start Index holds a value, though that box shows zero when it's empty.",
        do: async (page, ctx) => {
            await spot(ctx, fieldBlock(page, 'Filter by Parent Template (Optional)'));
            await ctx.move(fieldBlock(page, 'Filter by Parent Template (Optional)').locator('select'));
            await ctx.atSentence(1);
            await spot(ctx, smartBlock(page, 'Start Index'));
            await ctx.move(smartBlock(page, 'Start Index').locator('input'));
        },
    },
    {
        chapter: 'Leaving the document',
        say: 'Open URL is the one target that leaves the PDF. On Year View, the cover gets a web address near the bottom, '
            + 'black on black until I make it white.',
        do: async (page, ctx) => {
            await ctx.unspotlight();
            await app.selectTemplate(ctx, 'Year View');
            await ctx.atSentence(0, { offset: 2.4 });
            await ctx.tool('t');
            await ctx.drag(await at(page, 130, 612), await at(page, 380, 640), { duration: 800 });
            await ctx.type('example.com/planner', { wpm: 200 });
            await ctx.press('Escape');
            const color = typography(page).locator('input[type=color]').first();
            await color.scrollIntoViewIfNeeded();
            await ctx.pickColor(color, '#ffffff');
        },
    },
    {
        say: 'On Click, Open URL, and the whole address, starting with [https](=H T T P S). '
            + "It's stored exactly as typed, and most readers can't open a bare address.",
        do: async (page, ctx) => {
            await showInteraction(ctx);
            await ctx.pick(onClick(page), 'Open URL');
            await ctx.click(fieldBlock(page, 'URL').locator('input'));
            await ctx.type('https://example.com/planner', { wpm: 220 });
        },
    },
    {
        say: "There's nothing in the tree to resolve, so the exporter never hides it. With the box empty, the line would still print, as plain text.",
        do: async (page, ctx) => {
            await ctx.move(await at(page, 255, 626));
            await ctx.atSentence(1);
            await ctx.move(fieldBlock(page, 'URL').locator('input'));
            await ctx.atSentence(1, { offset: 1.6 });
            await ctx.move(await at(page, 255, 626));
        },
    },
    {
        chapter: 'Deleting',
        say: "Deleting is where links and references part ways. In Hierarchy, I'll select Week 2: our Notes chip, and January 5 and 6 in its top row.",
        do: async (page, ctx) => {
            await ctx.atSentence(0, { offset: 1.4 });
            await ctx.click(app.sidebarTab(page, 'Hierarchy'));
            await app.toggleNode(ctx, 'Weeks');
            await app.toggleNode(ctx, 'Week 2');
            await app.selectNode(ctx, 'Week 2');
            await ctx.move(await at(page, 427, 20));
            await ctx.move(await at(page, 110, 70));
            await ctx.move(await at(page, 345, 70));
        },
    },
    {
        say: 'First, the reference to January 5. The dialog says only the reference goes, and the page stays where it is. '
            + 'The week loses its Monday, and January keeps its fifth.',
        do: async (page, ctx) => {
            await rowAction(ctx, app.nodeRow(page, 'January 5, 2026'), 'Delete');
            const dialog = deleteDialog(page, 'Delete Reference?');
            await dialog.waitFor();
            await ctx.atSentence(1);
            await ctx.move(dialog.getByText('Only the reference goes', { exact: false }));
            await ctx.atSentence(1, { offset: 2.6 });
            await ctx.click(dialog.getByRole('button', { name: 'Delete Reference', exact: true }));
            await dialog.waitFor({ state: 'detached' });
            await ctx.move(await at(page, 110, 70));
            await app.toggleNode(ctx, 'Quarter 1');
            await app.toggleNode(ctx, 'January');
            await ctx.move(app.nodeRow(page, 'January 5, 2026'), { ax: 0.3 });
        },
    },
    {
        say: 'Now the real January 6. Its Journal and Daily Notes go with it, and so does its reference in Week 2. '
            + 'Nothing is left pointing at a missing page.',
        do: async (page, ctx) => {
            await rowAction(ctx, app.nodeRow(page, 'January 6, 2026'), 'Delete');
            const dialog = deleteDialog(page, 'Delete Page?');
            await dialog.waitFor();
            await ctx.atSentence(1);
            await ctx.move(dialog.getByText('All child pages within this section'));
            await ctx.atSentence(1, { offset: 1.8 });
            await ctx.click(dialog.getByRole('button', { name: 'Delete Everything', exact: true }));
            await dialog.waitFor({ state: 'detached' });
            await ctx.move(await at(page, 345, 70));
            // on to Notes, so the next beat's delete lands with its words
            await ctx.atSentence(2, { offset: 1.0 });
            await scrollSidebarTo(ctx, app.nodeRow(page, 'Notes'));
        },
    },
    {
        say: "And a fixed link can't outlive its page. Delete Notes, and the chip's On Click drops back to None. The chip still prints, as plain text.",
        do: async (page, ctx) => {
            const notes = app.nodeRow(page, 'Notes');
            await scrollSidebarTo(ctx, notes); // already in view after the previous beat
            await rowAction(ctx, notes, 'Delete');
            const dialog = deleteDialog(page, 'Delete Page?');
            await dialog.waitFor();
            await ctx.wait(300);
            await ctx.click(dialog.getByRole('button', { name: 'Delete Everything', exact: true }));
            await dialog.waitFor({ state: 'detached' });
            await ctx.click(await at(page, 427, 20));
            await showInteraction(ctx);
            // the delete's local save re-lays out the panel when it lands: measure after it
            await savedLocally(page);
            await spot(ctx, fieldBlock(page, 'On Click'));
            await ctx.atSentence(2);
            await ctx.move(await at(page, 427, 20));
        },
    },
    {
        say: 'Control Z, three times, and all three come back, link included.',
        do: async (page, ctx) => {
            await ctx.unspotlight();
            for (let i = 0; i < 3; i++) {
                await ctx.press('Control+z');
                await ctx.wait(450);
            }
            await ctx.move(app.nodeRow(page, 'Notes'), { ax: 0.3 });
            await ctx.move(await at(page, 230, 70));
        },
    },
    {
        chapter: 'In the PDF',
        // The export runs several seconds: this beat's words cover it, and the next beat
        // (the address line) only starts once the PDF is open.
        say: "Let's export and check. Thirteen hundred pages take a moment. "
            + 'Links are only worked out here, page by page, so the PDF is the only place to test them.',
        do: async (page, ctx) => {
            ctx.state.pdf = await ctx.download(() => ctx.click(page.getByRole('button', { name: 'Export PDF' }).first()));
            await ctx.wait(800);
            await ctx.openPdf(ctx.state.pdf, { title: '2026 Planner.pdf' });
            await ctx.move({ x: 1000, y: 420 });
        },
    },
    {
        say: "The cover's address line is a live link, but it would leave the reader, so I won't click it.",
        do: async (page, ctx) => {
            const link = await page.evaluate(() => window.__viewer.links().find(l => l.href?.startsWith('https://')));
            if (!link) throw new Error('no URL link on the cover');
            await ctx.hover(link, 300);
            await ctx.spotlight(link, 'https://example.com/planner', 6);
        },
    },
    {
        say: "Quarter 1, then January 31 in its little calendar. The right arrow lands on February 1, the next month's first day.",
        do: async (page, ctx) => {
            await ctx.unspotlight();
            await ctx.clickPdfLink({ text: 'Quarter 1' });
            await clickPdfCell(ctx, 143.5, 149.5);
            await ctx.atSentence(1);
            await clickPdfCell(ctx, 179.5, 20);
            await ctx.move(await pdfBox(page, 30, 0, 169, 40));
        },
    },
    {
        say: "Journal opens this day's own journal, and its [Q1](=Q one), three levels up, goes back to the quarter.",
        do: async (page, ctx) => {
            await ctx.clickPdfLink({ text: 'Journal' });
            await ctx.atSentence(0, { offset: 2.6 });
            await ctx.clickPdfLink({ text: 'Q1' });
        },
    },
    {
        say: "Now March 31. There's a left arrow, but no right one: the next day lives in another quarter.",
        do: async (page, ctx) => {
            await clickPdfCell(ctx, 353.5, 164.5);
            await ctx.atSentence(1);
            await ctx.move(await pdfBox(page, 0, 0, 20, 40));
            await ctx.spotlight(await pdfBox(page, 168, 1, 191, 39), '', 4);
            await ctx.move(await pdfBox(page, 168, 1, 191, 39));
        },
    },
    {
        say: "Mar goes up to March. Its sixth week label scans back to March 31 and finds Week 14. And Week 14's Notes chip opens the Notes list.",
        do: async (page, ctx) => {
            await ctx.unspotlight();
            await ctx.clickPdfLink({ text: 'Mar' });
            await ctx.atSentence(1);
            await clickPdfCell(ctx, 478.5, 434);
            await ctx.atSentence(2);
            await ctx.clickPdfLink({ text: 'Notes' });
            await ctx.move({ x: 1180, y: 470 }); // the margin, off the list's links
        },
    },
    {
        say: "That's every kind of link, and what each does when there's nowhere to go. Next time: getting your planner onto a tablet.",
        hold: 3,
        do: async (page, ctx) => {
            await ctx.atSentence(1);
            await ctx.endCard();
        },
    },
];
