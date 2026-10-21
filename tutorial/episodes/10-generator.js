// Episode 10 — The generator: building documents in code.
// Two short scripts (templates, then pages) build a dated week of meal-plan
// pages: the sandboxed Preview, Create As New Project, the scripts saved with
// the project (and never run by opening them), then the exported PDF.
import { episodeMeta } from './series.js';
import * as app from '../lib/app.js';

export const meta = episodeMeta(10, {
    description: 'Some documents are too big to click together: the 2026 Planner has 365 day pages, and a script built them all. '
        + 'We write two short scripts of our own, one for the templates and one for the pages, preview the result in a sealed '
        + 'sandbox, open it as a new project, and see where the scripts are kept afterwards.',
    learn: [
        'The two scripts: templates, then pages',
        'Data fields and links written in code',
        'Preview runs in a sandbox and changes nothing',
        'Create As New Project versus Replace Current Project',
        'Scripts are saved with the project, and never run on opening',
        'Structure in code, polish on the canvas',
    ],
    docs: ['/docs/generator/generator-basics', '/docs/reference/hierarchy-script'],
    thumbnail: { beat: 5, headline: 'The generator' },
});

// The two scripts the episode pastes in. Short enough to read on screen.
const TEMPLATES = `// One overview page for the week, one page per day.
const t = {};
t.week = { id: 'week', name: 'Week', width: A4_WIDTH, height: A4_HEIGHT, elements: [
  { type: 'text', x: 40, y: 40, w: 515, h: 50, text: '{{title}}', fontSize: 32, fontWeight: 'bold' },
  { type: 'grid', x: 40, y: 120, w: 515, h: 56, fontSize: 18, fill: '#f1f5f9',
    gridConfig: { cols: 1, gapX: 0, gapY: 8, sourceType: 'current', displayField: '{{title}} · {{date}}' } },
] };
t.day = { id: 'day', name: 'Day', width: A4_WIDTH, height: A4_HEIGHT, elements: [
  { type: 'text', x: 40, y: 40, w: 400, h: 50, text: '{{title}}', fontSize: 32, fontWeight: 'bold' },
  { type: 'text', x: 40, y: 92, w: 400, h: 24, text: '{{date}}', fontSize: 14, textColor: '#64748b' },
  { type: 'text', x: 455, y: 50, w: 100, h: 24, text: '← Week', fontSize: 14, linkTarget: 'parent' },
  { type: 'rect', x: 40, y: 140, w: 515, h: 660, fill: '#94a3b8',
    fillType: 'pattern', patternType: 'lines-h', patternSpacing: 24 },
] };
return t;`;

const HIERARCHY = `// A week of meal plans, starting on Monday 26 October 2026.
const nodes = {};
nodes.root = { id: 'root', parentId: null, type: 'week', title: 'Meals this week', data: {}, children: [] };
const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
days.forEach((name, i) => {
  const date = new Date(2026, 9, 26 + i);
  const id = createId('day');
  nodes[id] = { id, parentId: 'root', type: 'day', title: name, children: [],
    data: { date: date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) } };
  nodes.root.children.push(id);
});
return { nodes, rootId: 'root' };`;

const generatorModal = (page) => page.locator('div.fixed', { has: page.getByLabel('Template script') }).first();
const previewModal = (page) => page.locator('div.fixed', { has: page.getByRole('button', { name: 'Create As New Project' }) }).first();

/** Selects a script editor's contents and pastes new code over them. */
async function pasteScript(ctx, label, code) {
    const editor = ctx.page.getByLabel(label);
    await ctx.click(editor, { ay: 0.2 });
    await ctx.press('Control+a');
    await ctx.paste(code);
}

export async function setup(ctx) {
    await ctx.goto('/app');
    await app.editorReady(ctx.page);
    await app.retype(ctx, app.nodeTitleInput(ctx.page), 'Kitchen notes');
    await ctx.wait(1200);
    await ctx.titleCard();
    await ctx.wait(900);
}

export const teardown = (ctx) => app.saveFixture(ctx, '10-meal-planner');

export const beats = [
    {
        chapter: 'Welcome', lowerThird: false,
        say: 'Some documents are too big to click together. The 2026 planner has 365 day pages, and nobody made those one at a time: '
            + 'a short script built them. This episode is about the generator, and writing a script of your own.',
        do: async (page, ctx) => {
            await ctx.wait(2500);
            await ctx.cardOut();
            await ctx.move(app.toolbarButton(page, 'Generate Hierarchy via Script'));
        },
    },
    {
        chapter: 'Two scripts',
        say: "The purple Generator button opens two editors side by side. The left script returns templates, the designs. "
            + 'The right one returns pages: the hierarchy, with each page naming its template.',
        do: async (page, ctx) => {
            await ctx.click(app.toolbarButton(page, 'Generate Hierarchy via Script'));
            await generatorModal(page).waitFor();
            await ctx.atSentence(1);
            await ctx.move(page.getByLabel('Template script'), { ay: 0.3 });
            await ctx.atSentence(2);
            await ctx.move(page.getByLabel('Hierarchy script'), { ay: 0.3 });
        },
    },
    {
        say: "I'll paste in a script for the templates. Two A4 templates: a week page, with a grid listing its days, and a day page, "
            + 'with the date, a link back to the week, and lined paper. They are the same elements you draw by hand, written as data.',
        do: async (page, ctx) => {
            await pasteScript(ctx, 'Template script', TEMPLATES);
            await ctx.atSentence(1);
            await ctx.move(page.getByLabel('Template script'), { ax: 0.35, ay: 0.12 });
            await ctx.move(page.getByLabel('Template script'), { ax: 0.4, ay: 0.4, duration: 1500 });
        },
    },
    {
        say: 'And a hierarchy script. A top page for the week, then a loop that makes seven days, each with a title, a template, '
            + 'and a date field, worked out from the start of the week.',
        do: async (page, ctx) => {
            await pasteScript(ctx, 'Hierarchy script', HIERARCHY);
            await ctx.atSentence(1);
            await ctx.move(page.getByLabel('Hierarchy script'), { ax: 0.4, ay: 0.3 });
        },
    },
    {
        chapter: 'Preview',
        say: 'Preview runs both scripts in a sealed sandbox, with no network and a ten second limit. Your project is not touched.',
        do: async (page, ctx) => {
            await ctx.click(generatorModal(page).getByRole('button', { name: 'Preview', exact: true }));
            await previewModal(page).waitFor({ timeout: 30000 });
            await ctx.move(previewModal(page), { ay: 0.4 });
        },
    },
    {
        say: "The preview has one card per template, each drawn with real generated data: the week, and a day. A card marked Unused "
            + 'would mean no page asked for that template, which is usually a typo.',
        do: async (page, ctx) => {
            await ctx.move(previewModal(page).getByText('Week', { exact: true }).first());
            await ctx.atSentence(1);
            await ctx.move(previewModal(page).getByText('Day', { exact: true }).first());
        },
    },
    {
        chapter: 'Applying it',
        say: 'Create As New Project opens the result in its own tab, and leaves this project alone. Replace Current Project swaps '
            + 'it in here instead, as one step you can undo.',
        do: async (page, ctx) => {
            await ctx.move(previewModal(page).getByRole('button', { name: 'Replace Current Project' }));
            await ctx.atSentence(0, { offset: 0.5 });
            await ctx.click(previewModal(page).getByRole('button', { name: 'Create As New Project' }));
            const name = page.locator('#generated-project-name');
            await name.waitFor();
            await ctx.click(name);
            await page.keyboard.press('Control+a');
            await ctx.type('Meal planner', { wpm: 160 });
            await ctx.atSentence(1, { offset: 1 });
            await ctx.click(page.getByRole('button', { name: 'Create Project' }));
            await app.editorReady(page);
        },
    },
    {
        say: 'Here it is, in a new tab: eight pages from about thirty lines of code. The week page lists its days, and each day page has its date.',
        do: async (page, ctx) => {
            await ctx.wait(800);
            await ctx.move(app.sidebarColumn(page), { ay: 0.2 });
            await ctx.atSentence(1);
            await app.selectNode(ctx, 'Wednesday');
            await ctx.move(await app.pagePoint(page, 120, 100));
        },
    },
    {
        chapter: 'Where the scripts live',
        say: 'The scripts are saved with the project. Open the generator again, and the preset menu offers Current saved source. '
            + 'Opening it never runs it. Nothing runs until you press Preview.',
        do: async (page, ctx) => {
            await ctx.click(app.toolbarButton(page, 'Generate Hierarchy via Script'));
            await generatorModal(page).waitFor();
            await ctx.move(page.locator('#generator-preset'));
            await ctx.atSentence(2);
            await ctx.click(page.getByRole('button', { name: 'Close generator' }));
        },
    },
    {
        say: 'From here, the canvas works as usual: let code build the structure, then polish the design by hand. '
            + 'Just remember that running the scripts again with Replace starts over from the code.',
        do: async (page, ctx) => {
            await ctx.click(app.sidebarTab(page, 'Templates'));
            await app.selectTemplate(ctx, 'Day');
            await ctx.move(await app.pagePoint(page, 300, 400));
        },
    },
    {
        chapter: 'The result',
        say: "Let's export it. The week page lists all seven days, and each one is a link. "
            + 'Every date came from the script, so planning another week is a matter of changing one date and running it again.',
        do: async (page, ctx) => {
            ctx.state.pdf = await ctx.download(() => ctx.click(page.getByRole('button', { name: 'Export PDF' }).first()));
            await ctx.wait(800);
            await ctx.openPdf(ctx.state.pdf, { title: 'Meal planner.pdf' });
            await ctx.atSentence(1);
            await ctx.clickPdfLink({ text: 'Friday · October 30' });
            await ctx.move({ x: 1000, y: 300 });
        },
    },
    {
        say: 'Next time, we leave the editor: the gallery, accounts, and saving to the cloud.',
        hold: 3,
        do: async (page, ctx) => {
            await ctx.atSentence(0, { offset: 1.2 });
            await ctx.endCard();
        },
    },
];
