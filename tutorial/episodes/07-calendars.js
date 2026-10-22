// Episode 7 — Grids from the ground up.
// A month calendar built on an empty template, one grid setting at a time:
// one cell per child and the Source, Cols, W and H as one cell, gaps, the
// Display Template and its field buttons, a static then a dynamic offset (and
// November's Sunday wrap), Final Data Subset as a window of the list, Deep
// Traversal from the cover down to the days, and cells as links in the PDF.
//
// The project it starts from, Q4 2026 (tutorial/fixtures/07-q4-2026.json), was
// made once off camera with the app's own generator: makeFixture() below runs
// FIXTURE_TEMPLATES and FIXTURE_HIERARCHY through Generator → Preview → Create
// As New Project, then sets the zoom to 90%. To make it again, run the recorder
// (--dry) on a throwaway module:
//   import * as app from '<repo>/tutorial/lib/app.js';
//   import { meta as m, makeFixture } from '<repo>/tutorial/episodes/07-calendars.js';
//   export const meta = { ...m, id: 'scratch-07-fixture' };
//   export const setup = makeFixture;
//   export const beats = [{ do: async () => {} }];
//   export const teardown = (ctx) => app.saveFixture(ctx, '07-q4-2026');
import { episodeMeta } from './series.js';
import * as app from '../lib/app.js';

export const meta = episodeMeta(7, {
    description: 'Every calendar in a planner is a grid. On a small Q4 2026 project with an empty Month template, we build a '
        + 'month calendar one grid setting at a time: the source, columns, cell size and gaps, what each cell says, a static '
        + 'and then a dynamic offset, a window of the list, and traversal from the cover down to its days. Then the links, '
        + 'in the exported PDF.',
    learn: [
        'One cell per child, and what the Source decides',
        'Cols and gaps, and why W and H are one cell',
        'Display Template and the field buttons',
        'Static and dynamic offsets, and the Sunday wrap',
        'Final Data Subset: a window of the list',
        'Deep Traversal: from a cover down to its days',
    ],
    docs: ['/docs/editor/grids-basics-and-styling', '/docs/editor/grids-calendars-and-data-shaping'],
    thumbnail: { beat: 24, headline: 'Grids from the ground up' },
});

// ---- the starting project (off camera, once) --------------------------------

// Four plain templates at the 2026 Planner's page size. No grids: those are built on camera.
export const FIXTURE_TEMPLATES = `// Four plain templates, the 2026 Planner's page size. No grids: those are built on camera.
const t = {};
const page = (id, name, elements) => ({ id, name, width: RM_PP_WIDTH, height: RM_PP_HEIGHT, elements });
const lines = (y) => ({ type: 'rect', x: 44, y, w: 421, h: 640 - y, fill: '#94a3b8',
  fillType: 'pattern', patternType: 'lines-h', patternSpacing: 24 });
t.cover = page('cover', 'Cover', [
  { type: 'text', x: 44, y: 40, w: 421, h: 60, text: '{{title}}', fontSize: 40, fontWeight: 'bold', align: 'left' },
]);
t.month = page('month', 'Month', [
  { type: 'text', x: 44, y: 20, w: 421, h: 36, text: '{{title}} {{year}}', fontSize: 26, fontWeight: 'bold', align: 'left' },
  ...['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((letter, i) => ({ type: 'text', x: 44 + 60 * i, y: 64, w: 58, h: 16,
    text: letter, fontSize: 12, textColor: '#64748b', align: 'center' })),
]);
t.day = page('day', 'Day', [
  { type: 'text', x: 44, y: 30, w: 421, h: 36, text: '{{title}}', fontSize: 24, fontWeight: 'bold', align: 'left' },
  { type: 'text', x: 44, y: 66, w: 421, h: 20, text: '{{day_name}}', fontSize: 14, textColor: '#64748b', align: 'left' },
  lines(100),
]);
t.notes = page('notes', 'Notes', [
  { type: 'text', x: 44, y: 30, w: 421, h: 36, text: '{{title}}', fontSize: 24, fontWeight: 'bold', align: 'left' },
  lines(80),
]);
return t;`;

// A cover, three months with a page per day (the 2026 Planner's day fields, same names and formats), and Notes.
export const FIXTURE_HIERARCHY = `// Q4 2026: a cover, three months with a page per day, and a notes page.
const nodes = {};
nodes.root = { id: 'root', parentId: null, type: 'cover', title: 'Q4 2026', data: { year: '2026' }, children: [] };
const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
[['October', 9], ['November', 10], ['December', 11]].forEach(([month, m]) => {
  const id = createId('month');
  nodes[id] = { id, parentId: 'root', type: 'month', title: month, data: { year: '2026', month_name: month }, children: [] };
  nodes.root.children.push(id);
  for (let d = 1; new Date(2026, m, d).getMonth() === m; d++) {
    const wd = new Date(2026, m, d).getDay(); // 0 = Sunday, as in the 2026 Planner
    const day = createId('day');
    nodes[day] = { id: day, parentId: id, type: 'day', title: \`\${month} \${d}, 2026\`, children: [], data: {
      year: '2026', month_name: month, day_num: String(d).padStart(2, '0'),
      day_name: names[wd], day_short: names[wd].slice(0, 3), weekday_num: String(wd) } };
    nodes[id].children.push(day);
  }
});
nodes.notes = { id: 'notes', parentId: 'root', type: 'notes', title: 'Notes', data: {}, children: [] };
nodes.root.children.push('notes');
return { nodes, rootId: 'root' };`;

/**
 * Off camera, once: builds Q4 2026 through the app's generator (Create As New Project) and leaves it
 * open at 90%, in Hierarchy mode with the cover selected, ready for app.saveFixture(ctx, '07-q4-2026').
 */
export async function makeFixture(ctx) {
    const { page } = ctx;
    await ctx.goto('/app');
    await app.editorReady(page);
    await app.toolbarButton(page, 'Generate Hierarchy via Script').click();
    const generator = page.locator('div.fixed', { has: page.getByLabel('Template script') }).first();
    await generator.waitFor();
    for (const [label, code] of [['Template script', FIXTURE_TEMPLATES], ['Hierarchy script', FIXTURE_HIERARCHY]]) {
        await page.getByLabel(label).click();
        await page.keyboard.press('Control+a');
        await page.keyboard.insertText(code);
    }
    await generator.getByRole('button', { name: 'Preview', exact: true }).click();
    const preview = page.locator('div.fixed', { has: page.getByRole('button', { name: 'Create As New Project' }) }).first();
    for (const summary of ['4 templates', '97 nodes', '97 estimated pages']) {
        await preview.getByText(summary, { exact: true }).waitFor({ timeout: 30000 });
    }
    await preview.getByRole('button', { name: 'Create As New Project' }).click();
    await page.locator('#generated-project-name').fill('Q4 2026');
    await page.getByRole('button', { name: 'Create Project' }).click();
    await app.projectTab(page, 'Q4 2026').waitFor({ timeout: 60000 });
    await app.editorReady(page);
    const zoom = app.pane(page).locator('span.font-mono', { hasText: /^\d+%$/ }).first();
    for (let i = 0; i < 20 && (await zoom.textContent()) !== '90%'; i++) {
        const below = parseInt(await zoom.textContent(), 10) < 90;
        await (below ? app.zoomInButton(page) : app.zoomOutButton(page)).click();
    }
    await app.sidebarTab(page, 'Hierarchy').click();
    await page.getByRole('status').filter({ hasText: 'Saved locally' }).first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(1500);
}

// ---- the episode ----------------------------------------------------------------

const PALETTE = ['#0f172a', '#334155', '#64748b', '#94a3b8', '#cbd5e1', '#e2e8f0', '#f1f5f9', '#ffffff'];
const PAGE_W = 509; // the planner's pages are reMarkable Paper Pro sized
const at = (page, x, y) => app.pagePoint(page, x, y, PAGE_W);
const grid = (page) => app.section(page, 'grid-configuration');
const gridInput = (page, label) => grid(page).locator(`label:text-is("${label}") + input`);
const geometryInput = (page, i) => app.section(page, 'geometry').locator('input').nth(i);
const appearance = (page) => app.section(page, 'appearance');
const typography = (page) => app.section(page, 'typography');
const sourceBlock = (page) => grid(page).locator('label:text-is("Source")').locator('xpath=..');
const sourceSelect = (page) => grid(page).locator('select:has(option[value="specific"])');
const traversalBlock = (page) => grid(page).locator('label', { hasText: 'Deep Traversal' }).locator('xpath=../..');
const subset = (page) => grid(page).locator('label', { hasText: 'Final Data Subset' }).locator('xpath=..');
const offsetRow = (page) => grid(page).locator('label', { hasText: 'Offset (Skip items)' }).locator('xpath=..');
const offsetBox = (page) => offsetRow(page).locator('input[type=number]').first();
const offsetMode = (page) => offsetRow(page).locator('select');
const fieldButton = (page, name) => grid(page).locator(`button[title="Insert {{${name}}}"]`);
/** A Deep Traversal level's row (0-based). */
const level = (page, i) => grid(page).locator('input[placeholder="Start"]').nth(i).locator('xpath=../..');
/** A Data Fields row in Node Properties: its name and its value box. */
const fieldRow = (page, name) => app.propertiesColumn(page).locator(`label:text-is("${name}")`).locator('xpath=../..');

// The Month calendar, once it has its final shape: cells 58 × 60 at x 44, y 84, gaps of 2.
const COL = (c) => 44 + 60 * c; // a column's left edge, in points
const ROW = (r) => 84 + 62 * r; // a row's top edge on the Month template
const LETTER_Y = 72;
/** Where a cell's number sits once it prints top left (beat 15 on). */
const num = (page, c, r, top = ROW(r)) => at(page, COL(c) + 11, top + 9);
const letter = (page, c) => at(page, COL(c) + 29, LETTER_Y);

/** A post-production close-up framing page rectangles (points), optionally with panel elements beside them. */
async function closeUp(ctx, [x1, y1, x2, y2], { scale = 1.5, with: extra = [] } = {}) {
    const a = await at(ctx.page, x1, y1), b = await at(ctx.page, x2, y2);
    let box = { x: a.x, y: a.y, right: b.x, bottom: b.y };
    for (const loc of extra) {
        const r = await loc.boundingBox();
        if (!r) continue;
        box = { x: Math.min(box.x, r.x), y: Math.min(box.y, r.y), right: Math.max(box.right, r.x + r.width), bottom: Math.max(box.bottom, r.y + r.height) };
    }
    const width = box.right - box.x, height = box.bottom - box.y;
    // never closer than fits the whole region, with a margin (the frame is 1440 × 810 CSS px)
    const fit = Math.min(1440 / (width + 80), 810 / (height + 80));
    await ctx.zoom({ x: box.x, y: box.y, width, height }, { scale: Math.max(1, Math.min(scale, fit)) });
}

/** Scrolls the properties panel with the wheel until `target` sits near the top of it. */
async function scrollPanelTo(ctx, target, top = 140) {
    const box = await target.boundingBox();
    if (!box || Math.abs(box.y - top) < 30) return;
    const panel = await app.propertiesColumn(ctx.page).boundingBox();
    await ctx.wheel(box.y - top, { at: { x: panel.x + panel.width * 0.55, y: panel.y + panel.height * 0.6 }, steps: 8 });
}

export async function setup(ctx) {
    await ctx.goto('/app');
    await app.editorReady(ctx.page);
    await app.loadFixture(ctx, '07-q4-2026');
    await ctx.wait(1200);
    await ctx.titleCard();
    await ctx.wait(900);
}

export const beats = [
    {
        chapter: 'Welcome', lowerThird: false,
        say: "The calendars in a planner are grids. Today we'll build one on an empty page, one setting at a time, "
            + 'and look at what each setting does before adding the next.',
        do: async (page, ctx) => {
            await ctx.wait(2500);
            await ctx.cardOut();
            await ctx.move(app.sidebarColumn(page), { ay: 0.3 });
        },
    },
    {
        chapter: 'The project',
        say: "Here's the project, made ahead of time with the generator, which episode 10 covers. A cover called Q4 2026, "
            + 'three months under it, and a Notes page. Every month has a page for each of its days.',
        do: async (page, ctx) => {
            await ctx.move(app.nodeRow(page, 'Q4 2026').locator('span.truncate'));
            await ctx.atSentence(1);
            for (const title of ['October', 'November', 'December', 'Notes']) {
                await ctx.move(app.nodeRow(page, title).locator('span.truncate'), { duration: 450 });
                await ctx.wait(250);
            }
            await ctx.atSentence(2);
            await app.toggleNode(ctx, 'October');
            await ctx.move(app.nodeRow(page, 'October 8, 2026').locator('span.truncate'), { duration: 900 });
        },
    },
    {
        say: 'Click a day, and its data fields show on the right. Two matter today. '
            + '[day_num](=Day num) is the date, and [weekday_num](=weekday num) is the day of the week as a number: four, for this Thursday.',
        do: async (page, ctx) => {
            await app.selectNode(ctx, 'October 1, 2026');
            await ctx.move(fieldRow(page, 'year'), { ay: 0.2 });
            await ctx.atSentence(2);
            await ctx.spotlight(fieldRow(page, 'day_num'), '', 6);
            await ctx.move(fieldRow(page, 'day_num').locator('input'));
            await ctx.atSentence(2, { offset: 1.5 });
            await ctx.spotlight(fieldRow(page, 'weekday_num'), '', 6);
            await ctx.move(fieldRow(page, 'weekday_num').locator('input'));
        },
    },
    {
        chapter: 'One cell per child',
        say: "The months share a template called Month, and it's nearly empty: a title, and a row of weekday letters, Monday first. "
            + "I'll fold Template Settings away to make room.",
        do: async (page, ctx) => {
            await ctx.unspotlight();
            await ctx.click(app.sidebarTab(page, 'Templates'));
            await app.selectTemplate(ctx, 'Month');
            await ctx.move(await at(page, 150, 38));
            await ctx.move(await letter(page, 0), { duration: 500 });
            await ctx.move(await letter(page, 6), { duration: 1200 });
            await ctx.atSentence(1);
            await ctx.click(app.section(page, 'template-settings').getByRole('button', { name: 'Template Settings' }));
        },
    },
    {
        say: 'G for the grid tool, and drag out a box under the letters.',
        do: async (page, ctx) => {
            await ctx.tool('g');
            await ctx.drag(await at(page, 44, 84), await at(page, 462, 194), { duration: 1100 });
        },
    },
    {
        say: "A grid draws one cell for each child of its page. October's children are its 31 days, so there are 31 cells, each showing a title.",
        do: async (page, ctx) => {
            await ctx.move(await at(page, 110, 109));
            await ctx.atSentence(1);
            await ctx.move(await at(page, 253, 109), { duration: 500 });
            await ctx.move(await at(page, 395, 109), { duration: 500 });
            await ctx.move(await at(page, 395, 560), { duration: 1400 });
        },
    },
    {
        say: 'The Source decides whose children a grid shows. The other option pins a grid to one fixed page. '
            + "We'll keep Children of Current Page.",
        do: async (page, ctx) => {
            await ctx.move(sourceSelect(page));
            await ctx.atSentence(1);
            await ctx.pick(sourceSelect(page), 'Children of Current Page', { dwell: 2600 });
        },
    },
    {
        say: 'Current means whichever page is being drawn. Preview November, and the grid follows: 30 cells now. Then back to October.',
        do: async (page, ctx) => {
            await ctx.move(app.previewSelect(page));
            await ctx.atSentence(1);
            await ctx.pick(app.previewSelect(page), 'November');
            await ctx.move(await at(page, 253, 300));
            await ctx.atSentence(2);
            await ctx.pick(app.previewSelect(page), 'October');
        },
    },
    {
        chapter: 'Columns, cells and gaps',
        say: "First, let's make the cells visible. White cells on white paper are hard to see, so they get a pale grey fill. "
            + 'And the black outline round the whole grid can go.',
        do: async (page, ctx) => {
            const fill = appearance(page).locator('input[type=color]').first();
            await ctx.move(fill);
            await ctx.atSentence(1, { offset: 1.6 });
            await ctx.pickColor(fill, '#e2e8f0', PALETTE);
            await ctx.atSentence(2);
            await ctx.click(appearance(page).locator('button[title="Clear stroke color"]'));
        },
    },
    {
        say: '[Cols](=Columns) sets how many cells sit in a row. A week has seven days, so: seven.',
        do: async (page, ctx) => {
            await ctx.move(gridInput(page, 'Cols'));
            await ctx.atSentence(1, { offset: 1 });
            await app.retype(ctx, gridInput(page, 'Cols'), 7);
            await ctx.move(await at(page, 300, 200));
        },
    },
    {
        say: "They're far too wide, because W and H, in Geometry, are the size of one cell, not the whole grid. "
            + 'The letters are 60 points apart. So W is 58, leaving two for a gap, and H is 60.',
        do: async (page, ctx) => {
            await ctx.move(app.section(page, 'geometry'), { ay: 0.3 });
            await ctx.atSentence(1);
            await ctx.move(await letter(page, 0));
            await ctx.move(await letter(page, 1), { duration: 600 });
            await ctx.atSentence(2);
            await app.retype(ctx, geometryInput(page, 2), 58, { commit: 'Enter' });
            await app.retype(ctx, geometryInput(page, 3), 60, { commit: 'Enter' });
        },
    },
    {
        say: 'Gap X and Gap Y are the space between cells. Two points each. Fifty-eight plus two is sixty, and every column now sits under its letter.',
        do: async (page, ctx) => {
            await app.retype(ctx, gridInput(page, 'Gap X'), 2);
            await app.retype(ctx, gridInput(page, 'Gap Y'), 2);
            await ctx.atSentence(2);
            await ctx.move(await letter(page, 0));
            await ctx.move(await letter(page, 6), { duration: 1400 });
        },
    },
    {
        chapter: 'What each cell says',
        say: "Display Template decides what each cell says, and it starts as title. The buttons below insert the days' fields, "
            + "but they add to what's in the box, so I'll clear it first.",
        do: async (page, ctx) => {
            const box = gridInput(page, 'Display Template');
            await ctx.move(box);
            await ctx.atSentence(1);
            await ctx.move(fieldButton(page, 'day_name'));
            await ctx.move(fieldButton(page, 'year'), { duration: 1300 });
            await ctx.atSentence(1, { offset: 3 });
            await ctx.click(box);
            await ctx.press('Control+a');
            await ctx.press('Backspace');
        },
    },
    {
        say: 'Now [day_num](=day num). Each cell reads it from its own day page: [01](=oh one) to 31.',
        do: async (page, ctx) => {
            await ctx.click(fieldButton(page, 'day_num'));
            await ctx.atSentence(1);
            await ctx.move(await at(page, 73, 114));
            await ctx.move(await at(page, 253, 362), { duration: 1300 });
        },
    },
    {
        say: 'A planner prints these smaller, in the top-left corner, to leave room for writing. '
            + 'In Typography: 12 points, Align Left, and Align Top.',
        do: async (page, ctx) => {
            const ty = typography(page);
            await ctx.atSentence(1);
            await app.retype(ctx, ty.locator('input[type=number]').first(), 12);
            await ctx.click(ty.locator('button[title="Align Left"]'));
            await ctx.click(ty.locator('button[title="Align Top"]'));
            await ctx.move(await at(page, 160, 200));
        },
    },
    {
        chapter: 'Static offset',
        say: 'But look where the first is: under Monday. October the first, 2026, is a Thursday.',
        do: async (page, ctx) => {
            await scrollPanelTo(ctx, grid(page).getByText('Display Template', { exact: true }));
            await closeUp(ctx, [30, 56, 476, 400]);
            await ctx.move(await num(page, 0, 0));
            await ctx.atSentence(1);
            await ctx.move(await letter(page, 0));
            await ctx.move(await letter(page, 3), { duration: 1200 });
        },
    },
    {
        say: '[Offset (Skip items)](=Offset, skip items,) leaves blank cells before the first item. '
            + 'Three, for Monday to Wednesday, and October starts on a Thursday.',
        do: async (page, ctx) => {
            await closeUp(ctx, [30, 56, 476, 400], { with: [offsetRow(page)] });
            await ctx.move(offsetBox(page));
            await ctx.atSentence(1);
            await app.retype(ctx, offsetBox(page), 3);
            await ctx.move(await num(page, 3, 0));
            await ctx.move(await num(page, 5, 4), { duration: 1000 });
        },
    },
    {
        say: 'But a static offset is the same on every page. Preview December. '
            + "Its first is a Tuesday, yet it's still under Thursday.",
        do: async (page, ctx) => {
            ctx.unzoom();
            await ctx.atSentence(1);
            await ctx.pick(app.previewSelect(page), 'December');
            await ctx.atSentence(2);
            await ctx.move(await num(page, 3, 0));
        },
    },
    {
        chapter: 'Dynamic offset',
        say: 'Each month needs its own number, and its first day already knows it. '
            + 'Switch Static to Dynamic, and the offset is read from a field on the first item.',
        do: async (page, ctx) => {
            await ctx.move(offsetMode(page));
            await ctx.atSentence(1);
            await ctx.pick(offsetMode(page), 'Dynamic (Field)');
            await ctx.move(offsetRow(page).locator('input[placeholder="Field Name"]'));
        },
    },
    {
        say: 'The field is [weekday_num](=weekday num). Until the name is complete, nothing moves: '
            + 'Dynamic falls back to the number in the box. Then the first jumps to Wednesday.',
        do: async (page, ctx) => {
            await closeUp(ctx, [30, 56, 476, 400], { with: [offsetRow(page)] });
            await ctx.click(offsetRow(page).locator('input[placeholder="Field Name"]'));
            await ctx.type('weekday_nu', { wpm: 70 });
            await ctx.atSentence(2);
            await ctx.type('m');
            await ctx.move(await num(page, 2, 0));
        },
    },
    {
        say: 'One column out. [weekday_num](=Weekday num) counts from Sunday, which is zero, so Tuesday is two. '
            + 'But our columns start with Monday, so every day sits one column left of its number.',
        do: async (page, ctx) => {
            await ctx.move(await letter(page, 2));
            await ctx.atSentence(1, { offset: 1.8 });
            await ctx.move(await letter(page, 1), { duration: 700 });
            await ctx.atSentence(2);
            await ctx.move(await letter(page, 0), { duration: 700 });
        },
    },
    {
        say: "The plus-minus box adds to the field's value: minus one. Two minus one is one blank cell, and the first is under Tuesday.",
        do: async (page, ctx) => {
            await ctx.click(offsetRow(page).locator('input[placeholder="+/-"]'));
            await ctx.press('ArrowDown');
            await ctx.atSentence(1);
            await ctx.move(await num(page, 1, 0));
            await ctx.move(await num(page, 3, 4), { duration: 1000 });
        },
    },
    {
        say: 'Same settings, every month. Back to October: four minus one is three, and it\'s under Thursday again.',
        do: async (page, ctx) => {
            ctx.unzoom();
            await ctx.atSentence(1);
            await ctx.pick(app.previewSelect(page), 'October');
            await ctx.move(await num(page, 3, 0));
        },
    },
    {
        chapter: 'The Sunday wrap',
        say: 'November is the one to watch. It starts on a Sunday, weekday zero, and zero minus one is minus one.',
        do: async (page, ctx) => {
            await ctx.pick(app.previewSelect(page), 'November');
            await closeUp(ctx, [30, 56, 476, 460]);
            await ctx.move(await num(page, 6, 0));
        },
    },
    {
        say: "There's no column minus one, so a negative offset wraps round once: add the seven columns, and it's six. "
            + 'The first lands under Sunday, and the 30th starts a sixth row.',
        do: async (page, ctx) => {
            await ctx.move(await letter(page, 6));
            await ctx.move(await num(page, 6, 0), { duration: 700 });
            await ctx.atSentence(1, { offset: 1.5 });
            await ctx.move(await num(page, 0, 5), { duration: 1100 });
        },
    },
    {
        chapter: 'A window of the list',
        say: "On to the cover. I'd like the three months there, in a row, as links. G again, and a strip under the title.",
        do: async (page, ctx) => {
            ctx.unzoom();
            await app.selectTemplate(ctx, 'Cover');
            await ctx.atSentence(2);
            await ctx.tool('g');
            await ctx.drag(await at(page, 44, 130), await at(page, 462, 180), { duration: 1000 });
        },
    },
    {
        say: 'One cell per child again: three months, and Notes. Final Data Subset takes a window of that list. '
            + 'Start skips from the front, and Count keeps that many.',
        do: async (page, ctx) => {
            await ctx.move(await at(page, 110, 140));
            await ctx.move(await at(page, 110, 170), { duration: 600 });
            await ctx.atSentence(1);
            await subset(page).scrollIntoViewIfNeeded();
            await ctx.spotlight(subset(page), '', 6);
            await ctx.atSentence(2);
            await ctx.move(subset(page).locator('input[placeholder="Start (0)"]'));
            await ctx.atSentence(2, { offset: 1.4 });
            await ctx.move(subset(page).locator('input[placeholder="Count (All)"]'));
        },
    },
    {
        say: 'Count three, and Notes drops out.',
        do: async (page, ctx) => {
            await ctx.unspotlight();
            await app.retype(ctx, subset(page).locator('input[placeholder="Count (All)"]'), 3);
            await ctx.move(await at(page, 253, 140));
        },
    },
    {
        chapter: 'Reaching the days',
        say: "Now a calendar for the cover. Rather than build it again, I'll copy ours. "
            + 'On Month, V, drag a box across the letters and the calendar, and Control C.',
        do: async (page, ctx) => {
            await ctx.atSentence(2);
            await app.selectTemplate(ctx, 'Month');
            await ctx.tool('v');
            await ctx.drag(await at(page, 30, 58), await at(page, 480, 100), { duration: 900 });
            await ctx.press('Control+c');
        },
    },
    {
        say: 'On the cover, Control V. Pasted things land 20 points down and to the right, so I\'ll drag them under the months.',
        do: async (page, ctx) => {
            await app.selectTemplate(ctx, 'Cover');
            await ctx.press('Control+v');
            await ctx.atSentence(1, { offset: 1.5 });
            await ctx.drag(await at(page, 240, 150), await at(page, 220, 246), { duration: 1000 });
        },
    },
    {
        say: "The copy reads the cover's children: three months and Notes, so four cells. "
            + 'A month has no [day_num](=day num) of its own, so it borrows its first day\'s.',
        do: async (page, ctx) => {
            for (const c of [3, 4, 5, 6]) {
                await ctx.move(await num(page, c, 0, 200), { duration: 450 });
                await ctx.wait(300);
            }
        },
    },
    {
        say: 'Deep Traversal walks further down the tree, one level at a time. '
            + "Add Level, and give it a Count of one: of the cover's children, take the first, October.",
        do: async (page, ctx) => {
            await ctx.click(await at(page, -40, 420));
            await ctx.click(await at(page, 254, 230));
            await ctx.atSentence(1);
            await ctx.click(grid(page).getByRole('button', { name: 'Add Level' }));
            await app.retype(ctx, level(page, 0).locator('input[placeholder="Count"]'), 1);
            await ctx.move(await num(page, 3, 0, 200));
        },
    },
    {
        say: 'Add Level again, and leave its Count empty: every child of October. The days are back, starting on Thursday.',
        do: async (page, ctx) => {
            await ctx.click(grid(page).getByRole('button', { name: 'Add Level' }));
            await ctx.atSentence(1);
            await ctx.move(await num(page, 3, 0, 200));
        },
    },
    {
        say: "Level one's Start picks the month, counting from zero. One is November, wrapped round to Sunday as it was on its own page.",
        do: async (page, ctx) => {
            await app.retype(ctx, level(page, 0).locator('input[placeholder="Start"]'), 1);
            await ctx.atSentence(1);
            await closeUp(ctx, [30, 170, 476, 580]);
            await ctx.move(await num(page, 6, 0, 200));
            await ctx.move(await num(page, 0, 5, 200), { duration: 1000 });
        },
    },
    {
        say: 'Start three is Notes, which has no pages under it. With nothing to show, the editor fills the grid with Item placeholders, '
            + 'and the PDF prints nothing there. Back to one.',
        do: async (page, ctx) => {
            ctx.unzoom();
            await app.retype(ctx, level(page, 0).locator('input[placeholder="Start"]'), 3);
            await ctx.atSentence(1);
            await ctx.move(await num(page, 3, 0, 200));
            await ctx.move(await num(page, 1, 1, 200), { duration: 900 });
            await ctx.atSentence(2);
            await app.retype(ctx, level(page, 0).locator('input[placeholder="Start"]'), 1);
        },
    },
    {
        say: 'Grid Configuration lists its steps in the order they run. The source first, then Deep Traversal. '
            + 'Then Final Data Subset, and the offset last. Episode 19 uses that order to fix grids that look wrong.',
        do: async (page, ctx) => {
            await scrollPanelTo(ctx, sourceBlock(page), 150);
            await ctx.move(grid(page).getByRole('button', { name: 'Grid Configuration' }));
            await ctx.atSentence(1);
            await ctx.spotlight(sourceBlock(page), '', 6);
            await ctx.atSentence(1, { offset: 1.2 });
            await ctx.spotlight(traversalBlock(page), '', 6);
            await ctx.atSentence(2);
            await ctx.spotlight(subset(page), '', 6);
            await ctx.atSentence(2, { offset: 1.5 });
            await ctx.spotlight(offsetRow(page), '', 6);
            await ctx.atSentence(3);
            await ctx.unspotlight();
        },
    },
    {
        chapter: 'Cells are links',
        say: "Every cell is a link to the page it shows, with nothing to set up. The canvas doesn't follow links, so let's export and try them.",
        do: async (page, ctx) => {
            await ctx.atSentence(1);
            ctx.state.pdf = await ctx.download(() => ctx.click(page.getByRole('button', { name: 'Export PDF' }).first()));
            await ctx.wait(1000);
            await ctx.openPdf(ctx.state.pdf, { title: 'Q4 2026.pdf' });
            await ctx.move({ x: 1000, y: 500 });
        },
    },
    {
        say: "December, in the month row, opens December's page, starting on a Tuesday.",
        do: async (page, ctx) => {
            await ctx.clickPdfLink({ text: 'December' });
            await ctx.move({ x: 760, y: 330 });
        },
    },
    {
        say: 'And every day opens its own page. Christmas Day is a Friday.',
        do: async (page, ctx) => {
            await ctx.clickPdfLink({ text: '25' });
            await ctx.move({ x: 800, y: 320 });
        },
    },
    {
        say: "That's a grid built up from one cell per child. Next time: references, and how one page can appear in two places at once.",
        hold: 3,
        do: async (page, ctx) => {
            await ctx.atSentence(1);
            await ctx.endCard();
        },
    },
];
