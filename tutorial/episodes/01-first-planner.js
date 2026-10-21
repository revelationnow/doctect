// Episode 1 — Your first planner, start to finish.
// Landing → editor → 2026 Planner preset → the three columns → drilling down
// → templates and the Preview menu → export → clicking through the real PDF.
import { episodeMeta } from './series.js';
import * as app from '../lib/app.js';

export const meta = episodeMeta(1, {
    description: 'Start here. We create a complete 2026 planner from a built-in preset: more than thirteen hundred pages, '
        + 'where every date links to its own page. Along the way you learn the three columns of the editor, how pages '
        + '(nodes) relate to page designs (templates), and how a single export turns it all into a PDF with working links. '
        + 'No account needed.',
    learn: [
        'Creating a project from a preset',
        'The editor\'s three columns: pages, canvas, properties',
        'Drilling from a year down to a single day',
        'Why ten templates are enough for 1,368 pages',
        'Previewing a template against different pages',
        'Exporting a PDF and checking that its links work',
    ],
    docs: ['/docs/getting-started/what-is-pdf-architect', '/docs/getting-started/first-project-from-preset'],
    thumbnail: { beat: 9, headline: 'Your first planner' },
});

export async function setup(ctx) {
    await ctx.goto('/');
    await ctx.page.getByRole('link', { name: /Start Building Now/ }).waitFor();
    await ctx.wait(1500); // let the landing animations finish before the card covers them
    await ctx.titleCard();
    await ctx.wait(900);
}

export const beats = [
    {
        chapter: 'Welcome', lowerThird: false,
        say: "Hi. Let's make a planner. Not a mock-up, a real one: more than thirteen hundred pages, where every date links to "
            + "its own page. We'll start from a preset, look around the editor, and export it. You won't need an account for any of this.",
    },
    {
        say: 'This is PDF Architect. The idea is simple. You design a handful of page layouts once, and the app turns them into '
            + 'hundreds of pages, with the links worked out for you.',
        do: async (page, ctx) => {
            await ctx.cardOut();
            await ctx.wait(900);
            await ctx.move(page.getByText('Interlinked Documents').first());
            await ctx.atSentence(2);
            await ctx.move(page.getByText(/Define your structure once/).first(), { ax: 0.3 });
        },
    },
    {
        say: "Let's open the editor.",
        do: async (page, ctx) => {
            await ctx.click(page.getByRole('link', { name: /Start Building Now/ }));
            await app.editorReady(page);
        },
    },
    {
        chapter: 'Creating a project',
        say: 'The first time you open it, you get a blank project to play with. I want something with content in it, '
            + "so I'll click the plus, next to the tab.",
        do: async (page, ctx) => {
            await ctx.move(app.projectTab(page, 'Blank Project'));
            await ctx.atSentence(1, { offset: 1.2 });
            await ctx.click(page.locator('button[title="New Project"]').first());
            await app.presetCard(page, '2026 Planner').waitFor();
        },
    },
    {
        say: 'There are three presets. Blank is a single, empty A4 page. Simple Notebook has a cover and a few section dividers. '
            + 'And the 2026 Planner is the big one: a year, broken into quarters, months and days, all linked together. '
            + "That's the one we want.",
        do: async (page, ctx) => {
            await ctx.atSentence(1);
            await ctx.move(app.presetCard(page, 'Blank Project'));
            await ctx.atSentence(2);
            await ctx.move(app.presetCard(page, 'Simple Notebook'));
            await ctx.atSentence(3);
            await ctx.move(app.presetCard(page, '2026 Planner'));
            await ctx.atSentence(4);
            await ctx.click(app.presetCard(page, '2026 Planner'));
            await page.getByText('Create New Project').waitFor({ state: 'hidden', timeout: 60000 });
            await app.editorReady(page);
        },
    },
    {
        say: 'It takes a few seconds to build. And there it is: a new tab, with every page already in place.',
        do: async (page, ctx) => {
            await app.nodeRow(page, 'Quarter 1').waitFor({ timeout: 60000 });
            await ctx.atSentence(1);
            await ctx.move(app.projectTab(page, 'Planner 2026'));
        },
    },
    {
        chapter: 'Finding your way around',
        say: 'The editor has three columns. On the left is the structure of the document: a tree of pages, which the app calls nodes. '
            + "In the middle, the canvas shows one page at a time. And on the right are the properties of whatever you've selected.",
        do: async (page, ctx) => {
            await ctx.atSentence(1);
            await ctx.spotlight(app.sidebarColumn(page), 'Pages, called nodes', 0);
            await ctx.move(app.nodeRow(page, 'Quarter 2'), { ax: 0.4 });
            await ctx.atSentence(2);
            await ctx.spotlight(app.canvasColumn(page), 'The canvas', 0);
            await ctx.move(app.canvas(page), { ay: 0.35 });
            await ctx.atSentence(3);
            await ctx.spotlight(app.propertiesColumn(page), 'Properties', 0);
            await ctx.move(app.propertiesColumn(page).getByText('Node Properties').first());
            await ctx.atSentence(3, { end: true, offset: 0.3 });
            await ctx.unspotlight();
        },
    },
    {
        say: 'Right now the top node is selected, so the canvas shows the year page. The properties panel says this node uses a template '
            + 'called Year View, and it carries one piece of data: the year.',
        do: async (page, ctx) => {
            await ctx.move(app.canvas(page), { ay: 0.2 });
            await ctx.atSentence(1);
            await ctx.move(app.propertiesColumn(page).locator('select').first());
            await ctx.atSentence(1, { offset: 2.4 });
            await ctx.move(app.propertiesColumn(page).locator('input[value="2026"]').first());
        },
    },
    {
        chapter: 'Drilling down',
        say: 'Under the year sit four quarters, then pages for weeks, notes, and to-do lists. The little arrow unfolds a node. '
            + 'Inside Quarter 1 are January, February and March.',
        do: async (page, ctx) => {
            await ctx.move(app.nodeRow(page, 'Quarter 1'), { ax: 0.35 });
            await ctx.move(app.nodeRow(page, 'Quarter 4'), { ax: 0.35, duration: 900 });
            await ctx.move(app.nodeRow(page, 'To-Do Lists'), { ax: 0.35 });
            await ctx.atSentence(1);
            await app.toggleNode(ctx, 'Quarter 1');
        },
    },
    {
        say: 'Click January, and the canvas switches to a month: a calendar where every day is a link, and the week numbers '
            + 'down the side are links too.',
        do: async (page, ctx) => {
            await app.selectNode(ctx, 'January');
            await ctx.wait(900);
            await ctx.move(app.canvas(page), { ax: 0.45, ay: 0.3 });
            await ctx.atSentence(0, { offset: 4.2 });
            await ctx.move(app.canvas(page), { ax: 0.95, ay: 0.36 });
        },
    },
    {
        say: "Unfold January and there's a page for every day. Here's January the first. And each day has two pages of its own "
            + 'underneath it: a journal, and daily notes.',
        do: async (page, ctx) => {
            await app.toggleNode(ctx, 'January');
            await ctx.atSentence(1);
            await app.selectNode(ctx, 'January 1, 2026');
            await ctx.atSentence(2);
            await app.toggleNode(ctx, 'January 1, 2026');
            await ctx.move(app.nodeRow(page, 'Journal'), { ax: 0.4 });
        },
    },
    {
        chapter: 'Templates do the work',
        say: "Now, here's the part that matters. Nobody sat down and drew 365 day pages. Switch the sidebar to Templates, "
            + 'and you can see the entire planner comes from just ten layouts.',
        do: async (page, ctx) => {
            await ctx.atSentence(2);
            await ctx.click(app.sidebarTab(page, 'Templates'));
            await ctx.move(app.templateRow(page, 'Year View'), { ax: 0.3 });
            await ctx.move(app.templateRow(page, 'To-Do Page'), { ax: 0.3, duration: 1300 });
        },
    },
    {
        say: "I'll pick Month View. Up in the toolbar there's now a Preview menu. It lists every node that uses this template, "
            + 'and if I choose June, the same layout fills in with June.',
        do: async (page, ctx) => {
            await app.selectTemplate(ctx, 'Month View');
            await ctx.atSentence(1);
            await ctx.move(app.previewSelect(page));
            await ctx.atSentence(2, { offset: 1.6 });
            await ctx.pick(app.previewSelect(page), 'June');
            await ctx.move(app.canvas(page), { ax: 0.3, ay: 0.1 });
        },
    },
    {
        say: "That's really the whole model. Nodes hold the structure and the data. Templates hold the design. "
            + 'Change a template once, and every page that uses it changes with it.',
        do: async (page, ctx) => {
            await ctx.atSentence(1);
            await ctx.move(app.sidebarTab(page, 'Hierarchy'));
            await ctx.atSentence(2);
            await ctx.move(app.sidebarTab(page, 'Templates'));
            await ctx.atSentence(3);
            await ctx.move(app.canvas(page), { ax: 0.4, ay: 0.45 });
        },
    },
    {
        chapter: 'Exporting',
        say: "Let's export it. The Export PDF button, up in the corner, runs every node through its template and gives you a single file.",
        do: async (page, ctx) => {
            await ctx.atSentence(1);
            ctx.state.pdf = ctx.download(() => ctx.click(page.getByRole('button', { name: 'Export PDF' }).first()));
            await page.getByText('Generating...').first().waitFor({ timeout: 10000 }).catch(() => {});
        },
    },
    {
        say: 'Even at this size it only takes a few seconds, and it all happens right here in the browser, so nothing is uploaded anywhere. '
            + "The buttons next to it handle greyscale and other devices. We'll get to those later in the series.",
        do: async (page, ctx) => {
            ctx.state.pdf = await ctx.state.pdf;
            await ctx.atSentence(1);
            await ctx.move(page.locator('button[title^="Greyscale Export"]').first());
            await ctx.move(page.locator('button[title="Export templates for e-ink devices"]').first());
        },
    },
    {
        chapter: 'Trying the links',
        say: "Here's the file, open in a PDF reader. Page one is the year. These boxes aren't just labels. "
            + 'Click Quarter 2, and you land on its page.',
        do: async (page, ctx) => {
            await ctx.openPdf(ctx.state.pdf);
            await ctx.move({ x: 720, y: 420 });
            await ctx.atSentence(3);
            await ctx.clickPdfLink({ text: 'Quarter 2' });
        },
    },
    {
        say: 'Each of these little calendars is clickable too. Here is the second of May. From a day, the arrows step forward or back, '
            + 'and the chips along the top jump up to the month, the quarter, or the year.',
        do: async (page, ctx) => {
            await ctx.atSentence(1);
            await ctx.clickPdfLink({ text: '02', nth: 1 });
            await ctx.atSentence(2);
            await ctx.clickPdfLink({ near: [0.35, 0.03] });
            await ctx.atSentence(2, { offset: 2.6 });
            await ctx.clickPdfLink({ text: 'May' });
        },
    },
    {
        say: "None of these links were drawn by hand. They're worked out from the structure, which is why they're right on every single page.",
        do: async (page, ctx) => {
            await ctx.move({ x: 640, y: 520 });
        },
    },
    {
        chapter: "What's next",
        say: "So that's a complete planner, start to finish. In the next episode, we'll start from a blank page and learn the canvas: "
            + 'shapes, text, and styling. See you there.',
        hold: 3,
        do: async (page, ctx) => {
            await ctx.atSentence(1);
            await ctx.endCard();
        },
    },
];
