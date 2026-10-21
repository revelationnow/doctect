// Episode 8 — References & referrer formulas.
// The 2026 Planner again: week pages hold references to days that live under
// their months; making references of our own (a Birthdays list), Go to
// Referrer and its "first reference wins" rule, the child_referrer formula
// behind Month View's week labels, and the whole chain clicked through in
// the exported PDF.
import { episodeMeta } from './series.js';
import * as app from '../lib/app.js';

export const meta = episodeMeta(8, {
    description: 'Some pages belong in two places: March 14 belongs to March, and to Week 11. In the 2026 Planner we look at the '
        + 'references that make that possible, make a few of our own, and follow the links and labels that work across them, '
        + 'right through to the exported PDF.',
    learn: [
        'What a reference is, and why it beats a copy',
        'Creating references with Link Existing Page',
        'Grids and links go straight through a reference',
        'Go to Referrer, and why the first reference wins',
        'The child_referrer formula behind the week labels',
        'Following the chain in the exported PDF',
    ],
    docs: ['/docs/editor/references-and-referrer-formulas', '/docs/reference/child-referrer-formula'],
    thumbnail: { beat: 7, headline: 'References' },
});

const PAGE_W = 509;
const at = (page, x, y) => app.pagePoint(page, x, y, PAGE_W);
const interaction = (page) => app.section(page, 'interaction');
const subset = (page) => app.section(page, 'grid-configuration').locator('label', { hasText: 'Final Data Subset' }).locator('xpath=..');
const picker = (page) => page.locator('div.fixed', { has: page.locator('h2:text-is("Select Reference Target")') });
const pickerRow = (page, title) => picker(page).locator('div.flex.items-center', { has: page.locator(`span.truncate:text-is("${title}")`) }).first();

/** In the reference picker: unfold each ancestor by its chevron, then (after `beforePick`) pick the target. */
async function pickReference(ctx, path, { beforePick } = {}) {
    const { page } = ctx;
    await picker(page).waitFor();
    for (const title of path.slice(0, -1)) await ctx.click(pickerRow(page, title).locator(':scope > div').first());
    await beforePick?.();
    await ctx.click(pickerRow(page, path.at(-1)).locator('span.truncate'));
    await picker(page).waitFor({ state: 'detached' });
}

async function rowAction(ctx, row, title) {
    await ctx.hover(row.locator('span.truncate').first(), 350);
    await ctx.click(row.locator(`button[title="${title}"]`).first());
}

export async function setup(ctx) {
    await ctx.goto('/app');
    await app.editorReady(ctx.page);
    await app.newProjectFromPreset(ctx, '2026 Planner');
    await ctx.wait(1500);
    await ctx.titleCard();
    await ctx.wait(900);
}

export const beats = [
    {
        chapter: 'Welcome', lowerThird: false,
        say: 'Some pages belong in two places. March the fourteenth belongs to March, and it also belongs to Week 11. '
            + 'This episode is about references: how one page lives in both, and how to link and label across them.',
        do: async (page, ctx) => {
            await ctx.wait(2500);
            await ctx.cardOut();
            await ctx.move(app.sidebarColumn(page), { ay: 0.3 });
        },
    },
    {
        chapter: 'One page, two places',
        say: 'In the hierarchy, open Weeks, then Week 11. Its seven rows are in italics, with a small link icon. '
            + "They aren't pages. They're references: pointers to the real days, which live under March.",
        do: async (page, ctx) => {
            await app.toggleNode(ctx, 'Weeks');
            await app.toggleNode(ctx, 'Week 11');
            await ctx.atSentence(1);
            await ctx.move(app.nodeRow(page, 'March 9, 2026'));
            await ctx.move(app.nodeRow(page, 'March 15, 2026'), { duration: 900 });
        },
    },
    {
        say: 'Select one, and instead of a title and fields there is just a card: this node links to March 14. A reference has nothing of its own. '
            + 'Anything that lands on it goes straight through to the real day.',
        do: async (page, ctx) => {
            await app.selectNode(ctx, 'March 14, 2026');
            await ctx.move(app.propertiesColumn(page).getByText('Reference Node'));
        },
    },
    {
        say: 'Why not simply copy the days? Because a copy is a second page. Write on one, and the other never knows. '
            + 'A reference keeps one page, reachable from two places, and the PDF prints it only once.',
        do: async (page, ctx) => {
            await ctx.move(app.canvas(page), { ay: 0.4 });
        },
    },
    {
        chapter: 'Making references',
        say: "Let's make some of our own. On the top page, Add New Page, and call it Birthdays. "
            + 'It should list its pages the way Weeks and Notes do, so it gets the List Index template. '
            + 'A new page borrows the first template in the project, here Year View, so this step matters.',
        do: async (page, ctx) => {
            await app.toggleNode(ctx, 'Weeks');
            await rowAction(ctx, app.nodeRow(page, '2026 Planner'), 'Add New Page');
            await app.selectNode(ctx, 'New Page');
            await app.retype(ctx, app.nodeTitleInput(page), 'Birthdays');
            await ctx.atSentence(1);
            await ctx.pick(app.assignedTemplateSelect(page), 'List Index');
        },
    },
    {
        say: 'Hover Birthdays, and the link button, Link Existing Page, opens a picker: the same tree as the sidebar. '
            + "I'll unfold Quarter 1, and then March. Every day of March is in here, each one a real page. "
            + 'I want March the fourteenth, and clicking it makes the reference.',
        do: async (page, ctx) => {
            await rowAction(ctx, app.nodeRow(page, 'Birthdays'), 'Link Existing Page (Reference)');
            await ctx.atSentence(1);
            await pickReference(ctx, ['Quarter 1', 'March', 'March 14, 2026'], { beforePick: () => ctx.atSentence(3) });
        },
    },
    {
        say: 'One more, from the summer. Quarter 3, July, and July the second. '
            + 'Each pick is added at the end of the list, so add them in the order you want them to appear. '
            + "And there's no limit: a page can be referenced from as many places as you like.",
        do: async (page, ctx) => {
            await rowAction(ctx, app.nodeRow(page, 'Birthdays'), 'Link Existing Page (Reference)');
            await ctx.atSentence(1);
            await pickReference(ctx, ['Quarter 3', 'July', 'July 2, 2026']);
        },
    },
    {
        say: 'Birthdays now lists both days, and each one is a link to the real day page. In the sidebar, the new rows are italic: references, not copies.',
        do: async (page, ctx) => {
            await app.selectNode(ctx, 'Birthdays');
            await ctx.move(await at(page, 80, 72));
            await ctx.atSentence(1);
            await ctx.move(app.nodeRow(page, 'July 2, 2026'));
        },
    },
    {
        say: "To reach Birthdays from the year page, one change: its second list shows three sections, starting at four. "
            + 'Make that four, and Birthdays joins Weeks, Notes and To-Do Lists.',
        do: async (page, ctx) => {
            await ctx.click(app.sidebarTab(page, 'Templates'));
            await app.selectTemplate(ctx, 'Year View');
            await ctx.click(await at(page, 244, 362));
            await subset(page).scrollIntoViewIfNeeded();
            await ctx.move(subset(page));
            await ctx.atSentence(1);
            await app.retype(ctx, subset(page).locator('input[placeholder="Count (All)"]'), 4);
            await ctx.move(await at(page, 244, 420));
        },
    },
    {
        chapter: 'Getting back',
        say: "From a day, the way back to its week is a link called Go to Referrer. On the Day View template, the weekday chip in the corner uses it: "
            + 'find the reference that points at this day, and go to the page it sits on.',
        do: async (page, ctx) => {
            await app.selectTemplate(ctx, 'Day View');
            await ctx.click(await at(page, 480, 20));
            await interaction(page).scrollIntoViewIfNeeded();
            await ctx.atSentence(1);
            await ctx.spotlight(interaction(page), '', 6);
            await ctx.move(interaction(page).locator('select').first());
        },
    },
    {
        say: "March 14 now has two references, the week's and the birthday list's. Go to Referrer takes the first one ever made, "
            + "which is the week's, so this chip still means: my week.",
        do: async (page, ctx) => {
            await ctx.unspotlight();
            await ctx.move(await at(page, 480, 20));
        },
    },
    {
        chapter: 'Labels from references',
        say: "Month View's week numbers come from a formula instead, called child referrer. It asks which page references "
            + "this month's days, and prints that page's title.",
        do: async (page, ctx) => {
            await app.selectTemplate(ctx, 'Month View');
            await ctx.click(await at(page, 478, 113));
            const text = app.propertiesColumn(page).getByPlaceholder('Text content or {{field}}');
            await text.scrollIntoViewIfNeeded();
            await ctx.atSentence(1);
            await ctx.spotlight(text, '', 6);
            await ctx.move(text);
        },
    },
    {
        say: 'It has four parts: which day to start from, how many to scan, which kind of page to prefer, and which field to print. '
            + "You rarely type it by hand. Insert Referrer Field opens a builder that writes it for you.",
        do: async (page, ctx) => {
            await ctx.atSentence(1);
            await ctx.unspotlight();
            const builder = app.propertiesColumn(page).getByRole('button', { name: 'Insert Referrer Field...' }).first();
            await ctx.click(builder);
            await ctx.wait(1800);
            await ctx.click(builder);
        },
    },
    {
        chapter: 'Following the chain',
        say: "Let's export and follow it all the way. It's a long document, more than thirteen hundred pages, so the export takes a moment. "
            + 'It walks every page in order, skips the references so each day prints only once, and writes every link as a real PDF link.',
        do: async (page, ctx) => {
            ctx.state.pdf = await ctx.download(() => ctx.click(page.getByRole('button', { name: 'Export PDF' }).first()));
            await ctx.wait(800);
            await ctx.openPdf(ctx.state.pdf, { title: '2026 Planner.pdf' });
            await ctx.move({ x: 1000, y: 500 });
        },
    },
    {
        say: 'From the year page, Birthdays, which lists both days. Then March 14, the real day page. '
            + 'And the weekday chip, Sat, goes to Week 11, the page that holds its reference.',
        do: async (page, ctx) => {
            await ctx.clickPdfLink({ text: 'Birthdays' });
            await ctx.atSentence(1);
            await ctx.clickPdfLink({ text: 'March 14, 2026' });
            await ctx.atSentence(2);
            await ctx.clickPdfLink({ text: 'Sat' });
            await ctx.move({ x: 760, y: 500 });
        },
    },
    {
        say: 'One page, two ways in, and a way back from each. Next time: variants, and one document for every device.',
        hold: 3,
        do: async (page, ctx) => {
            await ctx.atSentence(1);
            await ctx.endCard();
        },
    },
];
