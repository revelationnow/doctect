// Episode 10 — The generator, step by step.
// Both scripts are written from empty editors and read line by line: the smallest
// pair that previews, a Day template element by element, a Week template and a
// loop that makes seven dated days, a grid that lists them and a link back, the
// two errors people meet most (an unknown template type, a missing comma), then
// Create As New Project, where the scripts are saved, the exported PDF's links,
// and the LLM Helper: a real chatbot's answer to the generator's own prompt,
// pasted and previewed.
//
// Every intermediate script is checked against the step texts that were run
// through the app's own validation (expectScript), so the screen can't drift
// from them. The project this builds is tutorial/fixtures/10-meal-planner.json,
// kept as committed (episode 17 names its element ids), so there's no teardown.
// The chatbot's answer is tutorial/fixtures/10-habit-tracker-answer.json.
import fs from 'node:fs';
import path from 'node:path';
import { episodeMeta } from './series.js';
import * as app from '../lib/app.js';
import { fixturePath } from '../lib/episode.js';
import { ZOOM } from '../lib/browser.js';

export const meta = episodeMeta(10, {
    description: 'Two short scripts, written from empty editors and read line by line, build a dated week of meal pages. '
        + 'The template script says how pages look; the hierarchy script lists the pages, with a loop that makes the seven '
        + 'days and their dates. We preview in the sandbox, fix the two errors you will meet most, open the result as a new '
        + 'project, and follow its links in the exported PDF. Then the LLM Helper: the generator\'s own prompt, a chatbot\'s '
        + 'answer for a November habit tracker, pasted in and previewed. Both finished scripts are below, ready to copy.',
    learn: [
        'The smallest template script and hierarchy script that preview',
        'Text, placeholders, data fields, a lined page and a grid, written as code',
        'A loop that makes a week of dated pages',
        'Reading the two errors you will meet most',
        'Create As New Project, and where the scripts are saved',
        'Letting a chatbot write the scripts with the LLM Helper prompt',
    ],
    docs: ['/docs/generator/templates-in-code', '/docs/generator/hierarchy-in-code'],
    thumbnail: { beat: 47, headline: 'The generator, step by step' },
});

// ---- the scripts, step by step ------------------------------------------------
// Typed or pasted exactly as below; the line numbers in the comments are the
// editor's lines once each piece is in.

const L = (...lines) => lines.join('\n');
const DAY_OPEN = "t.day = { id: 'day', name: 'Day', width: A4_WIDTH, height: A4_HEIGHT, elements: [";
const DAY_TITLE = ["  { type: 'text', x: 40, y: 40, w: 400, h: 50,", "    text: '{{title}}', fontSize: 32, fontWeight: 'bold' },"];
const DAY_DATE = L("  { type: 'text', x: 40, y: 92, w: 400, h: 24,", "    text: '{{date}}', fontSize: 14, textColor: '#64748b' },");
const DAY_LINES = L("  { type: 'rect', x: 40, y: 140, w: 515, h: 660, fill: '#94a3b8',",
    "    fillType: 'pattern', patternType: 'lines-h', patternSpacing: 24 },");
const DAY_BACK = L("  { type: 'text', x: 455, y: 50, w: 100, h: 24,", "    text: '← Week', fontSize: 14, linkTarget: 'parent' },");
const WEEK = L("t.week = { id: 'week', name: 'Week', width: A4_WIDTH, height: A4_HEIGHT, elements: [",
    "  { type: 'text', x: 40, y: 40, w: 515, h: 50,", "    text: '{{title}}', fontSize: 32, fontWeight: 'bold' },", '] };');
const WEEK_GRID = L("  { type: 'grid', x: 40, y: 120, w: 515, h: 56, fontSize: 18, fill: '#f1f5f9',",
    "    gridConfig: { cols: 1, gapX: 0, gapY: 8, sourceType: 'current',", "      displayField: '{{title}} · {{date}}' } },");
const ROOT_OPEN = (type) => `nodes.root = { id: 'root', parentId: null, type: '${type}',`;
const MONDAY = "  title: 'Monday', data: {}, children: [] };";
const ROOT_TITLE = "  title: 'Meals this week', data: {}, children: [] };";
const DAYS = L("const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday',", "  'Friday', 'Saturday', 'Sunday'];");
const LOOP = (type) => L(
    'for (let i = 0; i < 7; i++) {',
    '  const date = new Date(2026, 9, 26 + i);',
    "  const dateText = date.toLocaleDateString('en-US',",
    "    { month: 'long', day: 'numeric' });",
    "  const id = createId('day');",
    `  nodes[id] = { id, parentId: 'root', type: '${type}', title: days[i], children: [],`,
    '    data: { date: dateText } };',
    '  nodes.root.children.push(id);',
    '}',
);
const RETURN_NODES = "return { nodes, rootId: 'root' };";

// What each editor holds after each step (the texts scratchpad/ep10/stages.mjs ran through the app).
const T = {
    pair: L('const t = {};', DAY_OPEN, '] };', 'return t;'),
    title: L('const t = {};', DAY_OPEN, ...DAY_TITLE, '] };', 'return t;'),
    date: L('const t = {};', DAY_OPEN, ...DAY_TITLE, DAY_DATE, '] };', 'return t;'),
    lines: L('const t = {};', DAY_OPEN, ...DAY_TITLE, DAY_DATE, DAY_LINES, '] };', 'return t;'),
    week: L('const t = {};', WEEK, DAY_OPEN, ...DAY_TITLE, DAY_DATE, DAY_LINES, '] };', 'return t;'),
    grid: L('const t = {};', WEEK.replace("bold' },\n] };", `bold' },\n${WEEK_GRID}\n] };`), DAY_OPEN, ...DAY_TITLE, DAY_DATE, DAY_LINES, '] };', 'return t;'),
};
T.final = T.grid.replace(DAY_DATE, `${DAY_DATE}\n${DAY_BACK}`);
T.comma = T.final.replace("fontSize: 14, textColor", 'fontSize: 14 textColor');
const ROOT_WEEK = L('const nodes = {};', ROOT_OPEN('week'), ROOT_TITLE);
const H = {
    pair: L('const nodes = {};', ROOT_OPEN('day'), MONDAY, RETURN_NODES),
    monday: L('const nodes = {};', ROOT_OPEN('day'), MONDAY.replace('data: {}', "data: { date: 'October 26' }"), RETURN_NODES),
    week: L(ROOT_WEEK, RETURN_NODES),
    days: L(ROOT_WEEK, DAYS, RETURN_NODES),
    final: L(ROOT_WEEK, DAYS, LOOP('day'), RETURN_NODES),
    typo: L(ROOT_WEEK, DAYS, LOOP('dya'), RETURN_NODES),
};
/** Every step, and the finished pair as saved with the project (and in tutorial/fixtures/10-meal-planner.json). */
export const SCRIPT_STEPS = { T, H };
export const FINAL_SCRIPTS = { templateScript: T.final, hierarchyScript: H.final };

/** A real chatbot's answer for beats 55–57 (its two code blocks, verbatim). */
const answer = () => JSON.parse(fs.readFileSync(fixturePath('10-habit-tracker-answer'), 'utf8'));
const PLACEHOLDER = '[DESCRIBE YOUR DOCUMENT STRUCTURE HERE]';

// ---- the generator on screen --------------------------------------------------

const SCRIPT = { T: 'Template script', H: 'Hierarchy script' };
const PANE = { T: 'template', H: 'hierarchy' };
const editor = (page, w) => page.getByLabel(SCRIPT[w], { exact: true });
const generator = (page) => page.locator('[aria-labelledby="hierarchy-generator-title"]');
const previewButton = (page) => generator(page).getByRole('button', { name: 'Preview', exact: true });
const alertText = (page) => generator(page).locator('[role="alert"]');
const preview = (page) => page.locator('[aria-labelledby="generator-preview-title"]');
const previewCard = (page, name) => preview(page).locator(`button[aria-label^="${name}, "]`);
/** A card's caption under its drawn page: the page it was drawn for, and its uses. */
const cardPage = (page, name) => previewCard(page, name).locator('div.mt-3 span.truncate');
const cardUses = (page, name) => previewCard(page, name).locator('div.mt-3 span.shrink-0');
const cardUnused = (page, name) => previewCard(page, name).locator('div.mt-3 span', { hasText: 'Unused' });
const lightbox = (page) => page.locator('[aria-labelledby="generator-lightbox-title"]');
const naming = (page) => page.locator('[aria-labelledby="generator-name-title"]');
const helpBar = (page) => generator(page).getByRole('button', { name: 'LLM Helper & Schema Documentation' });
const promptBlock = (page) => generator(page).locator('pre', { hasText: 'You are helping a user create scripts' });
const fieldRow = (page, name) => app.propertiesColumn(page).locator(`label:text-is("${name}")`).locator('xpath=../..');

const lineOf = (text, n) => {
    const lines = text.split('\n');
    let start = 0;
    for (let i = 0; i < n - 1; i++) start += lines[i].length + 1;
    return { start, end: start + lines[n - 1].length, text: lines[n - 1] };
};
/** Offsets of the nth `needle` on line n (1-based) of `text`. */
function find(text, n, needle, nth = 0) {
    const line = lineOf(text, n);
    let i = -1;
    for (let k = 0; k <= nth; k++) {
        i = line.text.indexOf(needle, i + 1);
        if (i < 0) throw new Error(`"${needle}" is not on line ${n}: ${line.text}`);
    }
    return { start: line.start + i, end: line.start + i + needle.length };
}

/**
 * Screen rects of characters [start, end) of a script, read from the syntax-coloured
 * copy the editor lays under its transparent textarea (same font, same wrapping).
 */
async function charRects(page, w, start, end) {
    const rects = await editor(page, w).evaluate((ta, [s, e]) => {
        const pre = ta.parentElement.querySelector('pre');
        const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
        const range = document.createRange();
        let pos = 0, started = false, node;
        while ((node = walker.nextNode())) {
            const len = node.data.length;
            if (!started && s < pos + len) { range.setStart(node, s - pos); started = true; }
            if (started && e <= pos + len) { range.setEnd(node, e - pos); break; }
            pos += len;
        }
        return [...range.getClientRects()].map(r => ({ x: r.x, y: r.y, width: r.width, height: r.height }));
    }, [start, end]);
    return rects.filter(r => r.width > 0.5);
}

/** One box around [start, end), a whole line of the editor tall. */
async function textBox(page, w, start, end) {
    const rects = await charRects(page, w, start, end);
    if (!rects.length) throw new Error(`${SCRIPT[w]}: nothing on screen at ${start}-${end}`);
    const lineHeight = 18;
    const cy = (r) => r.y + r.height / 2;
    const x1 = Math.min(...rects.map(r => r.x)), x2 = Math.max(...rects.map(r => r.x + r.width));
    const y1 = Math.min(...rects.map(cy)) - lineHeight / 2, y2 = Math.max(...rects.map(cy)) + lineHeight / 2;
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** A spotlight on `needle` (line n), or on lines n..to without their indentation. */
async function spot(ctx, w, n, needle, { label = '', nth = 0, to } = {}) {
    const text = await editor(ctx.page, w).inputValue();
    let box;
    if (needle) {
        const { start, end } = find(text, n, needle, nth);
        box = await textBox(ctx.page, w, start, end);
    } else {
        const boxes = [];
        for (let k = n; k <= (to ?? n); k++) {
            const line = lineOf(text, k);
            boxes.push(await textBox(ctx.page, w, line.start + (line.text.length - line.text.trimStart().length), line.end));
        }
        const x1 = Math.min(...boxes.map(b => b.x)), x2 = Math.max(...boxes.map(b => b.x + b.width));
        box = { x: x1, y: boxes[0].y, width: x2 - x1, height: boxes.at(-1).y + boxes.at(-1).height - boxes[0].y };
    }
    await ctx.spotlight(box, label, 5);
}

/** Fails a dry run (and warns, then corrects, in a real one) unless the caret or selection is start..end. */
async function expectSelection(ctx, w, start, end) {
    const [s, e, focused] = await editor(ctx.page, w).evaluate(ta => [ta.selectionStart, ta.selectionEnd, document.activeElement === ta]);
    if (s === start && e === end && focused) return;
    const problem = `${SCRIPT[w]}: expected the selection at ${start}-${end}, found ${s}-${e}${focused ? '' : ' (not focused)'}`;
    if (ctx.dry) throw new Error(problem);
    console.warn(`${problem}; corrected`);
    await editor(ctx.page, w).evaluate((ta, [a, b]) => { ta.focus(); ta.setSelectionRange(a, b); }, [start, end]);
}

/** Clicks the caret into place: at the end of line n, or just before character `offset`. */
async function clickCaret(ctx, w, { endOfLine, before }) {
    const text = await editor(ctx.page, w).inputValue();
    let offset, point;
    if (endOfLine) {
        offset = lineOf(text, endOfLine).end;
        const [r] = (await charRects(ctx.page, w, offset - 1, offset)).slice(-1);
        point = { x: r.x + r.width + 7, y: r.y + r.height / 2 };
    } else {
        offset = before;
        const [r] = await charRects(ctx.page, w, offset, offset + 1);
        point = { x: r.x, y: r.y + r.height / 2 };
    }
    await ctx.click(point);
    await expectSelection(ctx, w, offset, offset);
    return offset;
}

/** Double-clicks a word to select it. */
async function selectWord(ctx, w, n, word, nth = 0) {
    const text = await editor(ctx.page, w).inputValue();
    const { start, end } = find(text, n, word, nth);
    const box = await textBox(ctx.page, w, start, end);
    await ctx.click({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, { count: 2 });
    await expectSelection(ctx, w, start, end);
}

/** Moves the pointer off the code, to the empty lower right of an editor. */
const park = (ctx, w) => ctx.move(editor(ctx.page, w), { ax: 0.86, ay: 0.82 });

/** The editor must hold exactly the storyboard's step. */
async function expectScript(page, w, expected) {
    const actual = await editor(page, w).inputValue();
    if (actual === expected) return;
    const a = actual.split('\n'), b = expected.split('\n');
    const k = a.findIndex((line, i) => line !== b[i]);
    throw new Error(`${SCRIPT[w]} differs from the step at line ${k + 1}:\n  on screen: ${a[k]}\n  expected:  ${b[k]}`);
}

/** Post-production close-up on one editor, centred a little high so its header shows. */
async function closeUp(ctx, w) {
    const box = await ctx.page.locator(`[data-generator-pane="${PANE[w]}"]`).boundingBox();
    const cy = box.y - 14 + 810 / 1.6 / 2;
    await ctx.zoom({ x: box.x, y: cy - 1, width: box.width, height: 2 }, { scale: 1.6 });
}

/** Runs `fn` once sentence k (plus offset) starts, alongside whatever the beat does meanwhile. */
const when = (ctx, k, offset, fn) => (async () => { await ctx.atSentence(k, { offset }); await fn(); })();

/** Empty toolbar space left of Reset, where the red message sat. */
async function messageSpot(page) {
    const b = await previewButton(page).boundingBox();
    return { x: b.x - 260, y: b.y + b.height / 2 };
}

/** Clicks Preview and waits for the Generated Project Preview and its counts. */
async function runPreview(ctx, counts) {
    const { page } = ctx;
    await ctx.click(previewButton(page));
    await preview(page).waitFor({ timeout: 30000 });
    for (const c of counts) await preview(page).getByText(c, { exact: true }).waitFor({ timeout: 10000 });
}

/** The pointer reads along the preview's counts, first to last. */
async function readCounts(ctx) {
    const spans = preview(ctx.page).locator('header span');
    await ctx.move(spans.first(), { ax: 0.2 });
    await ctx.move(spans.last(), { ax: 0.8, duration: 1400 });
}

/** The box of `phrase` inside an element's text. */
async function phraseBox(locator, phrase) {
    return locator.evaluate((el, p) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            const i = node.data.indexOf(p);
            if (i < 0) continue;
            const range = document.createRange();
            range.setStart(node, i);
            range.setEnd(node, i + p.length);
            const rects = [...range.getClientRects()].filter(r => r.width > 0);
            return rects.map(r => ({ x: r.x, y: r.y, width: r.width, height: r.height }));
        }
        return null;
    }, phrase);
}

/** Scrolls the LLM prompt with the wheel until `heading` sits near the top of the block, then spotlights it. */
async function showHeading(ctx, heading) {
    const block = promptBlock(ctx.page);
    const [rect] = await phraseBox(block, heading);
    const box = await block.boundingBox();
    const delta = rect.y - (box.y + 36);
    if (Math.abs(delta) > 4) await ctx.wheel(delta * ZOOM, { at: { x: box.x + box.width * 0.6, y: box.y + box.height * 0.55 }, steps: 10 });
    await ctx.page.waitForTimeout(150);
    const [now] = await phraseBox(block, heading);
    await ctx.spotlight({ x: now.x - 22, y: now.y, width: now.width + 22, height: now.height }, '', 5);
}

/**
 * Dry runs only: spotlights jump instead of gliding (0.35 s in the overlay), so each beat's
 * screenshot shows where its last spotlight landed. Real recordings keep the glide.
 */
async function stillSpotlights(ctx) {
    if (!ctx.dry) return;
    await ctx.page.evaluate(() => {
        const root = document.getElementById('__studio')?.shadowRoot;
        if (!root || root.getElementById('dry-still')) return;
        const style = document.createElement('style');
        style.id = 'dry-still';
        style.textContent = '.spot, .spotlabel { transition: none !important; }';
        root.appendChild(style);
    });
}

export async function setup(ctx) {
    await ctx.goto('/app');
    await stillSpotlights(ctx);
    await app.editorReady(ctx.page);
    await app.retype(ctx, app.nodeTitleInput(ctx.page), 'Kitchen notes');
    await ctx.wait(1200);
    await ctx.titleCard();
    await ctx.wait(900);
}

export const beats = [
    // 1
    {
        chapter: 'Welcome', lowerThird: false,
        say: "Some documents are too big to click together. The 2026 planner's 365 day pages came from a script. "
            + 'Today we write one ourselves, a week of meal pages, and read every line of it.',
        do: async (page, ctx) => {
            await ctx.wait(2500);
            await ctx.cardOut();
            await ctx.atSentence(2);
            await ctx.move(app.toolbarButton(page, 'Generate Hierarchy via Script'));
        },
    },
    // 2
    {
        chapter: 'Two editors',
        say: 'The purple Generator button opens two editors. The left one, Define Templates, describes how pages look. '
            + 'The right one, Build Hierarchy, lists the pages and says which template each one uses.',
        do: async (page, ctx) => {
            await ctx.click(app.toolbarButton(page, 'Generate Hierarchy via Script'));
            await generator(page).waitFor();
            await ctx.atSentence(1);
            await ctx.move(generator(page).getByText('1. Define Templates', { exact: true }));
            await ctx.atSentence(2);
            await ctx.move(generator(page).getByText('2. Build Hierarchy', { exact: true }));
        },
    },
    // 3
    {
        say: "They're simple editors, with no line numbers and no autocomplete. Tab won't indent either, so I use spaces. "
            + "The Preset menu loads working samples; I'll start from empty.",
        do: async (page, ctx) => {
            await ctx.move(editor(page, 'T'), { ax: 0.3, ay: 0.08 });
            await ctx.move(editor(page, 'T'), { ax: 0.34, ay: 0.85, duration: 2600 });
            await ctx.atSentence(2);
            const preset = page.locator('#generator-preset');
            if (await preset.inputValue() !== 'simple') throw new Error('the generator should open on the Simple Book preset');
            await ctx.move(preset);
            await ctx.atSentence(2, { offset: 2.2 });
            for (const w of ['T', 'H']) {
                await ctx.click(editor(page, w), { ax: 0.5, ay: 0.4 });
                await ctx.press('Control+a');
                await ctx.press('Backspace');
            }
            await expectScript(page, 'T', '');
            await expectScript(page, 'H', '');
        },
    },
    // 4
    {
        chapter: 'The smallest pair',
        say: 'First, the smallest pair that works. On the left, t is an empty object that will hold my templates, '
            + 'and [t.day](=t dot day) is the first one.',
        do: async (page, ctx) => {
            const zoom = when(ctx, 0, 3.7, () => closeUp(ctx, 'T'));
            await ctx.click(editor(page, 'T'), { ax: 0.06, ay: 0.04 });
            await expectSelection(ctx, 'T', 0, 0);
            await park(ctx, 'T');
            await ctx.atSentence(1, { offset: 0.6 });
            await ctx.type('const t = {};\n');
            await ctx.atSentence(1, { offset: 3.2 });
            await ctx.type(`${DAY_OPEN}\n] };\nreturn t;`);
            await zoom;
            await expectScript(page, 'T', T.pair);
        },
    },
    // 5
    {
        say: "Its [id](=I D) is day: that's the name pages use to ask for it. Its name, Day, is what the app shows. "
            + '[A4_WIDTH](=A4 width) and [A4_HEIGHT](=A4 height) come built into this script: the page size in points.',
        do: async (page, ctx) => {
            await spot(ctx, 'T', 2, "id: 'day'");
            await ctx.atSentence(1);
            await spot(ctx, 'T', 2, "name: 'Day'");
            await ctx.atSentence(2);
            await spot(ctx, 'T', 2, 'width: A4_WIDTH, height: A4_HEIGHT');
        },
    },
    // 6
    {
        say: 'Elements, everything on the page, is an empty list for now. And the script must hand its templates back: return t.',
        do: async (page, ctx) => {
            await spot(ctx, 'T', 2, 'elements: [');
            await ctx.atSentence(0, { offset: 2.4 });
            await spot(ctx, 'T', 3, ']');
            await ctx.atSentence(1);
            await spot(ctx, 'T', 4, 'return t;');
        },
    },
    // 7
    {
        say: 'On the right, nodes will hold every page, by its [id](=I D). [nodes.root](=Nodes dot root) is the first page.',
        do: async (page, ctx) => {
            await ctx.unspotlight();
            await closeUp(ctx, 'H');
            await ctx.click(editor(page, 'H'), { ax: 0.06, ay: 0.04 });
            await expectSelection(ctx, 'H', 0, 0);
            await park(ctx, 'H');
            await ctx.type('const nodes = {};\n');
            await ctx.atSentence(1);
            await ctx.type(`${ROOT_OPEN('day')}\n${MONDAY}`);
        },
    },
    // 8
    {
        say: '[Id](=I D) root. [parentId](=Parent I D) null, because nothing sits above it. '
            + "Type day: the template's [id](=I D), which ties this page to its template. Title Monday, empty data, no children.",
        do: async (page, ctx) => {
            await spot(ctx, 'H', 2, "id: 'root'");
            await ctx.atSentence(1);
            await spot(ctx, 'H', 2, 'parentId: null');
            await ctx.atSentence(2);
            await spot(ctx, 'H', 2, "type: 'day'");
            await ctx.atSentence(3);
            await spot(ctx, 'H', 3, "title: 'Monday', data: {}, children: []");
        },
    },
    // 9
    {
        say: 'This script returns the pages, and which one is the root. [nodes](=Nodes) on its own is short for [nodes: nodes](=nodes colon nodes).',
        do: async (page, ctx) => {
            await ctx.unspotlight();
            await ctx.type(`\n${RETURN_NODES}`);
            await expectScript(page, 'H', H.pair);
            await spot(ctx, 'H', 4, RETURN_NODES);
            await ctx.atSentence(1);
            await spot(ctx, 'H', 4, '{ nodes,', { label: 'nodes  =  nodes: nodes' });
        },
    },
    // 10
    {
        say: "Preview runs both scripts in a sealed sandbox: no network, ten seconds at most, and your project isn't touched.",
        do: async (page, ctx) => {
            await ctx.unspotlight();
            ctx.unzoom();
            await runPreview(ctx, ['Default variant', '1 variant', '1 template', '1 node', '1 estimated page']);
            await ctx.move(preview(page).getByText('Generated Project Preview', { exact: true }), { ax: 0.7 });
        },
    },
    // 11
    {
        say: "One template, used by one page. The card is the Day template, drawn for Monday. It's blank, because elements is empty.",
        do: async (page, ctx) => {
            await readCounts(ctx);
            await ctx.atSentence(1);
            const card = previewCard(page, 'Day');
            if (await card.getAttribute('aria-label') !== 'Day, Default, 1 use') throw new Error('the Day card should read 1 use');
            await ctx.move(card, { ay: 0.35 });
            await ctx.move(cardPage(page, 'Day'));
            await ctx.atSentence(2, { offset: 1.8 });
            await ctx.click(preview(page).getByRole('button', { name: 'Back to Scripts' }));
        },
    },
    // 12
    {
        chapter: 'The day page',
        say: 'Now the elements, one at a time. Inside the brackets, a text element. '
            + 'X 40, y 40 is its top left corner: 40 points from the left edge and from the top.',
        do: async (page, ctx) => {
            const zoom = when(ctx, 0, 3.7, () => closeUp(ctx, 'T'));
            await ctx.atSentence(1, { offset: -0.6 });
            await clickCaret(ctx, 'T', { endOfLine: 2 });
            await ctx.press('Enter', { chip: false });
            await park(ctx, 'T');
            await ctx.type(DAY_TITLE[0]);
            await zoom;
            await ctx.atSentence(2);
            await spot(ctx, 'T', 3, 'x: 40, y: 40');
        },
    },
    // 13
    {
        say: 'W 400 and h 50 are the size of its box, also in points. '
            + 'The text is [{{title}}](=title in double curly braces): each page fills in its own title.',
        do: async (page, ctx) => {
            await spot(ctx, 'T', 3, 'w: 400, h: 50');
            await ctx.atSentence(0, { end: true, offset: 0.1 });
            await ctx.unspotlight();
            await ctx.press('Enter', { chip: false });
            await ctx.type(DAY_TITLE[1]);
            await expectScript(page, 'T', T.title);
            await spot(ctx, 'T', 4, "text: '{{title}}'");
        },
    },
    // 14
    {
        say: "Font size 32, and bold. There's no [id](=I D): the generator gives each element one. "
            + 'Anything I leave out gets a default, so this text sits centered in its box.',
        do: async (page, ctx) => {
            await spot(ctx, 'T', 4, "fontSize: 32, fontWeight: 'bold'");
            await ctx.atSentence(1);
            await spot(ctx, 'T', 3, null, { to: 4 });
        },
    },
    // 15
    {
        say: "The date line I'll paste. Same shape, at y 92, under the title: "
            + '[{{date}}](=date in double curly braces), 14 point, in gray.',
        do: async (page, ctx) => {
            await ctx.unspotlight();
            await ctx.press('Enter', { chip: false });
            await ctx.paste(DAY_DATE);
            await expectScript(page, 'T', T.date);
            await ctx.atSentence(1);
            await spot(ctx, 'T', 5, null, { to: 6 });
        },
    },
    // 16
    {
        say: "Title comes with every page. Date doesn't: it's a field I made up, so Monday has to supply it. In its data: date, October 26.",
        do: async (page, ctx) => {
            await ctx.atSentence(1);
            await ctx.unspotlight();
            await closeUp(ctx, 'H');
            const text = await editor(page, 'H').inputValue();
            await ctx.atSentence(2, { offset: -0.9 });
            await clickCaret(ctx, 'H', { before: find(text, 3, '{}').start + 1 });
            await park(ctx, 'H');
            await ctx.type(" date: 'October 26' ");
            await expectScript(page, 'H', H.monday);
            await spot(ctx, 'H', 3, "data: { date: 'October 26' }");
        },
    },
    // 17
    {
        say: 'Then the lined paper, pasted: one rectangle, 515 by 660 points. '
            + 'Fill type pattern, with lines h, horizontal lines, every 24 points. Fill is the color of the lines.',
        do: async (page, ctx) => {
            await ctx.unspotlight();
            await closeUp(ctx, 'T');
            await clickCaret(ctx, 'T', { endOfLine: 6 });
            await ctx.press('Enter', { chip: false });
            await park(ctx, 'T');
            await ctx.paste(DAY_LINES);
            await expectScript(page, 'T', T.lines);
            await spot(ctx, 'T', 7, "w: 515, h: 660, fill: '#94a3b8'");
            await ctx.atSentence(1);
            await spot(ctx, 'T', 8, "fillType: 'pattern', patternType: 'lines-h', patternSpacing: 24");
            await ctx.atSentence(2);
            await spot(ctx, 'T', 7, "fill: '#94a3b8'");
        },
    },
    // 18
    {
        say: 'Preview again, and open the card to see it larger. Monday, October 26, and lines to write on.',
        do: async (page, ctx) => {
            await ctx.unspotlight();
            ctx.unzoom();
            await runPreview(ctx, ['1 template', '1 node']);
            await ctx.click(previewCard(page, 'Day'), { ay: 0.35 });
            await lightbox(page).getByText('Day preview', { exact: true }).waitFor();
            await lightbox(page).getByText('Monday · 1 use · Default', { exact: true }).waitFor();
            await ctx.atSentence(1);
            const pageBox = await lightbox(page).locator('div.min-h-0.overflow-auto').boundingBox();
            await ctx.zoom({ x: pageBox.x, y: pageBox.y + pageBox.height * 0.4, width: pageBox.width, height: 2 }, { scale: 1.6 });
            await ctx.move({ x: pageBox.x + pageBox.width * 0.62, y: pageBox.y + pageBox.height * 0.55 });
        },
    },
    // 19
    {
        say: 'One page proves the template. Now the real shape: a week page, with seven days under it.',
        do: async (page, ctx) => {
            await ctx.atSentence(0, { end: true });
            ctx.unzoom();
            await ctx.click(lightbox(page).getByRole('button', { name: 'Close', exact: true }));
            await ctx.atSentence(1);
            await ctx.click(preview(page).getByRole('button', { name: 'Back to Scripts' }));
            await preview(page).waitFor({ state: 'detached' });
        },
    },
    // 20
    {
        chapter: 'A week of pages',
        say: "The week needs a template of its own, pasted above the day so it's listed first: "
            + '[id](=I D) week, name Week, and a wider title. Its list comes later.',
        do: async (page, ctx) => {
            const zoom = when(ctx, 0, 3.7, () => closeUp(ctx, 'T'));
            await ctx.atSentence(0, { offset: 1.2 });
            await clickCaret(ctx, 'T', { endOfLine: 1 });
            await ctx.press('Enter', { chip: false });
            await park(ctx, 'T');
            await ctx.paste(WEEK);
            await expectScript(page, 'T', T.week);
            await zoom;
            await spot(ctx, 'T', 2, null, { to: 5 });
            await ctx.atSentence(0, { offset: 6.4 });
            await spot(ctx, 'T', 3, 'w: 515');
            await ctx.atSentence(1);
            await spot(ctx, 'T', 2, 'elements: [');
        },
    },
    // 21
    {
        say: "Preview shows something new. The Week card says Unused: the template exists, but no page asks for it yet. It's a hint, not an error.",
        do: async (page, ctx) => {
            await ctx.unspotlight();
            ctx.unzoom();
            await runPreview(ctx, ['2 templates', '1 node']);
            if (await previewCard(page, 'Week').getAttribute('aria-label') !== 'Week, Default, unused') throw new Error('the Week card should be unused');
            await ctx.atSentence(1);
            await ctx.move(previewCard(page, 'Week'), { ay: 0.35 });
            await ctx.move(cardUnused(page, 'Week'));
            await ctx.atSentence(2, { offset: 0.6 });
            await ctx.move(cardUses(page, 'Day'));
            await ctx.atSentence(2, { end: true });
            await ctx.click(preview(page).getByRole('button', { name: 'Back to Scripts' }));
        },
    },
    // 22
    {
        say: 'So the root becomes the week: type week. Its title, Meals this week, and no date of its own.',
        do: async (page, ctx) => {
            await closeUp(ctx, 'H');
            await selectWord(ctx, 'H', 2, 'day');
            await ctx.type('week');
            await ctx.atSentence(1);
            const text = await editor(page, 'H').inputValue();
            await ctx.click(await textBox(page, 'H', find(text, 3, "'Monday'").start, find(text, 3, "'Monday'").end));
            await ctx.press('Home');
            await ctx.press('Shift+End');
            const line = lineOf(text, 3);
            await expectSelection(ctx, 'H', line.start, line.end);
            await park(ctx, 'H');
            await ctx.type(ROOT_TITLE);
            await expectScript(page, 'H', H.week);
        },
    },
    // 23
    {
        say: 'Next, the day names, pasted: a list of seven, counted from zero. Days of zero is Monday, and days of six is Sunday.',
        do: async (page, ctx) => {
            await ctx.press('Enter', { chip: false });
            await ctx.paste(DAYS);
            await expectScript(page, 'H', H.days);
            await ctx.atSentence(1);
            await spot(ctx, 'H', 4, "'Monday'");
            await ctx.atSentence(1, { offset: 1.5 });
            await spot(ctx, 'H', 5, "'Sunday'");
        },
    },
    // 24
    {
        say: 'And the loop, pasted. [for (let i = 0; i < 7; i++)](=For i from zero to six): the lines inside run seven times, once per day.',
        do: async (page, ctx) => {
            await ctx.unspotlight();
            await ctx.press('Enter', { chip: false });
            await ctx.paste(LOOP('day'));
            await expectScript(page, 'H', H.final);
            await ctx.atSentence(1);
            await spot(ctx, 'H', 6, 'for (let i = 0; i < 7; i++) {');
        },
    },
    // 25
    {
        say: 'New Date, with year 2026, month nine, and day 26 plus i. Months count from zero, so nine is October.',
        do: async (page, ctx) => {
            await spot(ctx, 'H', 7, 'const date = new Date(2026, 9, 26 + i);');
        },
    },
    // 26
    {
        say: "When i is six, that's October the 32nd. Date rolls it over to November the 1st, so the end of the month takes care of itself.",
        do: async (page, ctx) => {
            await spot(ctx, 'H', 7, 'const date = new Date(2026, 9, 26 + i);', { label: '26 + 6 = 32  →  November 1' });
        },
    },
    // 27
    {
        say: '[dateText](=Date text) turns that into words: [toLocaleDateString](=to locale date string), in US English, '
            + 'with the long month name and the day number. October 26.',
        do: async (page, ctx) => {
            await spot(ctx, 'H', 8, null, { to: 9 });
            await ctx.atSentence(1);
            await spot(ctx, 'H', 8, null, { to: 9, label: '→  October 26' });
        },
    },
    // 28
    {
        say: '[createId](=Create I D), with the prefix day, makes a new [id](=I D) every time: day, an underscore, '
            + 'and random letters and digits. It only exists in this script.',
        do: async (page, ctx) => {
            await spot(ctx, 'H', 10, "const id = createId('day');", { label: 'day_  +  9 random characters' });
        },
    },
    // 29
    {
        say: 'Then the page itself: [parentId](=parent I D) root, and type day. '
            + 'Its title is days of i, and the [dateText](=date text) goes in its data. [id](=I D) on its own is short for [id: id](=I D colon I D).',
        do: async (page, ctx) => {
            await spot(ctx, 'H', 11, null, { to: 12 });
            await ctx.atSentence(2);
            await spot(ctx, 'H', 11, '{ id,', { label: 'id  =  id: id' });
        },
    },
    // 30
    {
        say: "Push adds the new [id](=I D) to the root's children. "
            + "That list is the page order, and it has to agree with each page's [parentId](=parent I D).",
        do: async (page, ctx) => {
            await spot(ctx, 'H', 13, 'nodes.root.children.push(id);');
            await ctx.atSentence(1, { offset: 2.2 });
            await spot(ctx, 'H', 11, "parentId: 'root'");
        },
    },
    // 31
    {
        say: 'Preview: two templates and eight pages. Meals this week uses the Week template, and seven pages use Day.',
        do: async (page, ctx) => {
            await ctx.unspotlight();
            ctx.unzoom();
            await runPreview(ctx, ['2 templates', '8 nodes', '8 estimated pages']);
            await ctx.move(preview(page).getByText('8 estimated pages', { exact: true }));
            await ctx.atSentence(1);
            await ctx.move(cardPage(page, 'Week'));
            await ctx.atSentence(1, { offset: 2.1 });
            await ctx.move(cardUses(page, 'Day'));
            await ctx.atSentence(1, { end: true });
            await ctx.click(preview(page).getByRole('button', { name: 'Back to Scripts' }));
        },
    },
    // 32
    {
        chapter: 'The list and the way back',
        say: 'The week page needs its list: a grid, pasted under its title. For a grid, w and h are the size of one cell, 515 by 56.',
        do: async (page, ctx) => {
            const zoom = when(ctx, 0, 3.7, () => closeUp(ctx, 'T'));
            await ctx.atSentence(0, { offset: 1.2 });
            await clickCaret(ctx, 'T', { endOfLine: 4 });
            await ctx.press('Enter', { chip: false });
            await park(ctx, 'T');
            await ctx.paste(WEEK_GRID);
            await expectScript(page, 'T', T.grid);
            await zoom;
            await ctx.atSentence(1);
            await spot(ctx, 'T', 5, 'w: 515, h: 56');
        },
    },
    // 33
    {
        say: '[cols: 1](=Columns, one): one cell per row, 8 points apart. Source type current: '
            + "the cells come from the children of the page being drawn. On Meals this week, that's the seven days.",
        do: async (page, ctx) => {
            await spot(ctx, 'T', 6, 'cols: 1');
            await ctx.atSentence(0, { offset: 1.5 });
            await spot(ctx, 'T', 6, 'gapY: 8');
            await ctx.atSentence(1);
            await spot(ctx, 'T', 6, "sourceType: 'current'");
        },
    },
    // 34
    {
        say: 'Display field is the pattern for each cell: '
            + '[{{title}} · {{date}}](=title in double curly braces, a dot, then date in double curly braces). '
            + 'Each cell fills it in from its own day, and links to that page.',
        do: async (page, ctx) => {
            await spot(ctx, 'T', 7, "displayField: '{{title}} · {{date}}'");
        },
    },
    // 35
    {
        say: 'Now the way back. On the day page, after the date, a small text, an arrow and Week, pasted. Its link target is parent.',
        do: async (page, ctx) => {
            await ctx.unspotlight();
            await ctx.atSentence(1);
            await clickCaret(ctx, 'T', { endOfLine: 13 });
            await ctx.press('Enter', { chip: false });
            await park(ctx, 'T');
            await ctx.paste(DAY_BACK);
            await expectScript(page, 'T', T.final);
            await spot(ctx, 'T', 14, null, { to: 15 });
        },
    },
    // 36
    {
        say: "Parent means the page this one sits under. For every day, that's the week. "
            + 'No page numbers anywhere: the export works them out when it writes the PDF.',
        do: async (page, ctx) => {
            await spot(ctx, 'T', 15, "linkTarget: 'parent'");
        },
    },
    // 37
    {
        say: 'Preview. The week lists all seven days with their dates, and each day has its way back.',
        do: async (page, ctx) => {
            await ctx.unspotlight();
            ctx.unzoom();
            await runPreview(ctx, ['2 templates', '8 nodes', '8 estimated pages']);
            await ctx.click(previewCard(page, 'Week'), { ay: 0.35 });
            await lightbox(page).getByText('Week preview', { exact: true }).waitFor();
            await lightbox(page).getByText('Meals this week · 1 use · Default', { exact: true }).waitFor();
            const pageBox = await lightbox(page).locator('div.min-h-0.overflow-auto').boundingBox();
            await ctx.zoom({ x: pageBox.x, y: pageBox.y + pageBox.height * 0.4, width: pageBox.width, height: 2 }, { scale: 1.6 });
            await ctx.move({ x: pageBox.x + pageBox.width * 0.4, y: pageBox.y + pageBox.height * 0.2 });
            await ctx.move({ x: pageBox.x + pageBox.width * 0.4, y: pageBox.y + pageBox.height * 0.62 }, { duration: 1500 });
            await ctx.atSentence(1, { offset: 2.6 });
            ctx.unzoom();
            await ctx.click(lightbox(page).getByRole('button', { name: 'Next', exact: true }));
            await lightbox(page).getByText('Day preview', { exact: true }).waitFor();
            const dayBox = await lightbox(page).locator('div.min-h-0.overflow-auto').boundingBox();
            await ctx.move({ x: dayBox.x + dayBox.width * 0.86, y: dayBox.y + dayBox.height * 0.07 });
            await ctx.atSentence(1, { end: true, offset: 0.4 });
            await ctx.click(lightbox(page).getByRole('button', { name: 'Close', exact: true }));
        },
    },
    // 38
    {
        chapter: 'When it goes wrong',
        say: "Before I make this real, a mistake on purpose. In the loop, I'll misspell day as ['dya'](=d y a).",
        do: async (page, ctx) => {
            await ctx.click(preview(page).getByRole('button', { name: 'Back to Scripts' }));
            await preview(page).waitFor({ state: 'detached' });
            const zoom = when(ctx, 0, 3.7, () => closeUp(ctx, 'H'));
            await zoom;
            await ctx.atSentence(1, { offset: 1.2 });
            await selectWord(ctx, 'H', 11, 'day');
            await ctx.type('dya', { wpm: 120 });
            await expectScript(page, 'H', H.typo);
            await park(ctx, 'H');
        },
    },
    // 39
    {
        allowAlert: true,
        say: 'This time no preview opens. The red text says hierarchy: a node, by its [id](=I D), '
            + "references unknown template type ['dya'](=d y a).",
        do: async (page, ctx) => {
            ctx.unzoom();
            await ctx.click(previewButton(page));
            await alertText(page).waitFor({ timeout: 30000 });
            const message = (await alertText(page).textContent()).trim();
            if (!/^Hierarchy: Node day_[a-z0-9]{9} references unknown template type 'dya' in variant 'default'\.$/.test(message)) {
                throw new Error(`unexpected message: ${message}`);
            }
            if (await preview(page).count()) throw new Error('a preview opened');
            await ctx.atSentence(1);
            await ctx.zoom(alertText(page), { scale: 1.6 });
            await ctx.move(alertText(page), { ax: 0.08 });
            await ctx.move(alertText(page), { ax: 0.9, duration: 2600 });
        },
    },
    // 40
    {
        allowAlert: true,
        say: "It names the page that failed, and the name it couldn't find. A misspelled template name stops the run like this. "
            + 'It never shows up as Unused.',
        do: async (page, ctx) => {
            const message = (await alertText(page).textContent()).trim();
            const node = message.match(/Node day_[a-z0-9]{9}/)[0];
            const [nodeRect] = await phraseBox(alertText(page), node);
            await ctx.spotlight(nodeRect, '', 4);
            await ctx.atSentence(0, { offset: 1.6 });
            const [typoRect] = await phraseBox(alertText(page), "'dya'");
            await ctx.spotlight(typoRect, '', 4);
        },
    },
    // 41
    {
        allowAlert: true,
        say: 'Three letters fix it, and the red text goes as soon as I type.',
        do: async (page, ctx) => {
            await ctx.unspotlight();
            await closeUp(ctx, 'H');
            await selectWord(ctx, 'H', 11, 'dya');
            await ctx.type('day', { wpm: 120 });
            await expectScript(page, 'H', H.final);
            if (await alertText(page).count()) throw new Error('the red message should go on typing');
            ctx.unzoom();
            await ctx.move(await messageSpot(page));
        },
    },
    // 42
    {
        allowAlert: true,
        say: "The other mistake you'll make is a missing comma. I'll take out the one after font size 14, in the date line.",
        do: async (page, ctx) => {
            await closeUp(ctx, 'T');
            await ctx.atSentence(1);
            const text = await editor(page, 'T').inputValue();
            const comma = find(text, 13, 'fontSize: 14,');
            await clickCaret(ctx, 'T', { before: comma.end });
            await ctx.press('Backspace');
            await expectScript(page, 'T', T.comma);
            await park(ctx, 'T');
        },
    },
    // 43
    {
        allowAlert: true,
        at: 'before',
        say: "Template script, line 13: [Unexpected identifier 'textColor'](=unexpected identifier, text color). It names the script and the line.",
        do: async (page, ctx) => {
            ctx.unzoom();
            await ctx.click(previewButton(page));
            await alertText(page).waitFor({ timeout: 30000 });
            const message = (await alertText(page).textContent()).trim();
            if (message !== "Template script, line 13: Unexpected identifier 'textColor'") throw new Error(`unexpected message: ${message}`);
            await ctx.zoom(alertText(page), { scale: 1.6 });
            await ctx.move(alertText(page), { ax: 0.3 });
        },
    },
    // 44
    {
        allowAlert: true,
        say: "On line 13, the trouble sits just before the word it names: the comma I took out. Comma back, and it's gone.",
        do: async (page, ctx) => {
            await closeUp(ctx, 'T');
            await spot(ctx, 'T', 13, '14 textColor');
            const text = await editor(page, 'T').inputValue();
            const fourteen = find(text, 13, 'fontSize: 14');
            await ctx.atSentence(0, { end: true, offset: -0.6 });
            await ctx.unspotlight();
            await clickCaret(ctx, 'T', { before: fourteen.end });
            await ctx.atSentence(1);
            await ctx.type(',');
            await expectScript(page, 'T', T.final);
            if (await alertText(page).count()) throw new Error('the red message should go on typing');
            await park(ctx, 'T');
            await ctx.atSentence(1, { offset: 0.9 });
            ctx.unzoom();
            await ctx.move(await messageSpot(page));
        },
    },
    // 45
    {
        chapter: 'Making it real',
        say: 'Preview once more. There are two ways to use the result. '
            + 'Replace Current Project swaps it into this project, after a confirmation, as one step you can undo.',
        do: async (page, ctx) => {
            await runPreview(ctx, ['2 templates', '8 nodes', '8 estimated pages']);
            await ctx.atSentence(2);
            await ctx.move(preview(page).getByRole('button', { name: 'Replace Current Project' }));
        },
    },
    // 46
    {
        say: "Create As New Project leaves Kitchen notes alone and opens a new project. I'll call it Meal planner.",
        do: async (page, ctx) => {
            await ctx.click(preview(page).getByRole('button', { name: 'Create As New Project' }));
            const name = page.locator('#generated-project-name');
            await name.waitFor();
            if (await name.inputValue() !== 'Kitchen notes – Generated') throw new Error(`prefill reads ${await name.inputValue()}`);
            await ctx.move(name, { ax: 0.7 });
            await ctx.atSentence(1);
            await ctx.press('Control+a');
            await ctx.type('Meal planner', { wpm: 160 });
        },
    },
    // 47
    {
        say: 'Here it is, in its own tab: eight pages from 34 lines of code. Wednesday has its date, in the data field the loop wrote.',
        do: async (page, ctx) => {
            await ctx.click(naming(page).getByRole('button', { name: 'Create Project' }));
            await app.projectTab(page, 'Meal planner').waitFor({ timeout: 60000 });
            await generator(page).waitFor({ state: 'detached' });
            await app.editorReady(page);
            await app.nodeRow(page, 'Sunday').waitFor();
            await ctx.move(app.projectTab(page, 'Meal planner'));
            await ctx.move(app.nodeRow(page, 'Meals this week').locator('span.truncate'));
            await ctx.move(app.nodeRow(page, 'Sunday').locator('span.truncate'), { duration: 1100 });
            await ctx.atSentence(1);
            await app.selectNode(ctx, 'Wednesday');
            await fieldRow(page, 'date').waitFor();
            if (await fieldRow(page, 'date').locator('input').inputValue() !== 'October 28') throw new Error('Wednesday should be October 28');
            await ctx.move(await app.pagePoint(page, 200, 104));
            await ctx.atSentence(1, { offset: 2.2 });
            await ctx.spotlight(fieldRow(page, 'date'), '', 6);
        },
    },
    // 48
    {
        chapter: 'Where the scripts live',
        say: 'The scripts are saved with this project. Open the generator here, and the Preset menu reads Current saved source, '
            + 'with a Saved Generator mark.',
        do: async (page, ctx) => {
            await ctx.unspotlight();
            await ctx.atSentence(1);
            await ctx.click(app.toolbarButton(page, 'Generate Hierarchy via Script'));
            await generator(page).waitFor();
            await expectScript(page, 'T', T.final);
            await expectScript(page, 'H', H.final);
            const preset = page.locator('#generator-preset');
            if (await preset.inputValue() !== 'saved') throw new Error('the generator should open on Current saved source');
            await ctx.move(preset);
            await ctx.atSentence(1, { offset: 3.6 });
            await ctx.move(generator(page).getByText('Saved Generator', { exact: true }));
        },
    },
    // 49
    {
        say: 'The note above the editors says the rest. Publish the project, and the scripts go public with it. '
            + 'Opening them never runs them; only Preview does.',
        do: async (page, ctx) => {
            const note = generator(page).locator('p', { hasText: 'Saved generator source is retained' });
            await ctx.move(note, { ax: 0.02, ay: 0.3 });
            await ctx.atSentence(1);
            const [published] = await phraseBox(note, 'becomes public when published');
            await ctx.move({ x: published.x + 4, y: published.y + published.height / 2 });
            await ctx.move({ x: published.x + published.width, y: published.y + published.height / 2 }, { duration: 1100 });
            await ctx.atSentence(2);
            const opening = await phraseBox(note, 'Opening source never runs it; Preview uses the sandbox.');
            await ctx.move({ x: opening[0].x + 4, y: opening[0].y + opening[0].height / 2 });
            const last = opening.at(-1);
            await ctx.move({ x: last.x + last.width, y: last.y + last.height / 2 }, { duration: 1500 });
        },
    },
    // 50
    {
        say: "And hand edits on the canvas aren't written back here. Run Replace again later, and it rebuilds from these scripts, over those edits.",
        do: async (page, ctx) => {
            const note = generator(page).locator('p', { hasText: 'Saved generator source is retained' });
            const manual = await phraseBox(note, 'Manual edits are not written back to JavaScript.');
            await ctx.move({ x: manual[0].x + 4, y: manual[0].y + manual[0].height / 2 });
            const last = manual.at(-1);
            await ctx.move({ x: last.x + last.width, y: last.y + last.height / 2 }, { duration: 1300 });
            await ctx.atSentence(1, { end: true, offset: -0.8 });
            await ctx.click(page.getByRole('button', { name: 'Close generator' }));
            await generator(page).waitFor({ state: 'detached' });
        },
    },
    // 51
    {
        chapter: 'The result',
        say: "Export PDF, and every link works. Friday's row goes to Friday, and the arrow comes back to the week.",
        do: async (page, ctx) => {
            ctx.state.pdf = await ctx.download(() => ctx.click(app.pane(page).getByRole('button', { name: 'Export PDF', exact: true })));
            await ctx.wait(600);
            await ctx.openPdf(ctx.state.pdf, { title: path.basename(ctx.state.pdf) });
            await ctx.move({ x: 900, y: 420 });
            await ctx.atSentence(1);
            if (await ctx.clickPdfLink({ text: 'Friday · October 30' }) !== 6) throw new Error('Friday should be page 6');
            await ctx.atSentence(1, { offset: 2.2 });
            if (await ctx.clickPdfLink({ text: '← Week' }) !== 1) throw new Error('← Week should go back to page 1');
            await ctx.move({ x: 1000, y: 380 });
        },
    },
    // 52
    {
        chapter: 'Letting an LLM help',
        say: "You don't have to write every line yourself, either. "
            + 'At the bottom of the generator, LLM Helper & Schema Documentation holds a prompt written for chatbots.',
        do: async (page, ctx) => {
            await ctx.goto('/app');
            await stillSpotlights(ctx);
            await app.editorReady(page);
            await app.nodeRow(page, 'Meals this week').waitFor({ timeout: 30000 }); // the Meal planner tab is the open one
            await ctx.click(app.toolbarButton(page, 'Generate Hierarchy via Script'));
            await generator(page).waitFor();
            if (await page.locator('#generator-preset').inputValue() !== 'saved') throw new Error('the generator should open on Current saved source');
            await ctx.atSentence(1);
            await ctx.move(helpBar(page), { ax: 0.12 });
            await ctx.atSentence(1, { offset: 3.4 });
            await ctx.click(helpBar(page), { ax: 0.12 });
            await promptBlock(page).waitFor();
            await ctx.move(generator(page).getByText('Copy this prompt to your favorite LLM', { exact: false }), { ax: 0.3 });
        },
    },
    // 53
    {
        say: 'It teaches a chatbot everything we did today: both scripts, every kind of element, link targets, '
            + 'and what each script has to return. Copy puts all of it on your clipboard.',
        do: async (page, ctx) => {
            for (const heading of ['## Template Schema', '## Element Types', '### Link Targets', '## Node Schema', '## Output Format']) {
                await showHeading(ctx, heading);
                await ctx.wait(700);
            }
            await ctx.unspotlight();
            await ctx.atSentence(1);
            const copy = generator(page).getByRole('button', { name: 'Copy', exact: true });
            await ctx.click(copy);
            await generator(page).getByRole('button', { name: 'Copied!', exact: true }).waitFor({ timeout: 1500 });
            const shown = await promptBlock(page).textContent();
            const copied = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
            if (copied !== null && copied !== shown) throw new Error('the clipboard should hold the prompt');
        },
    },
    // 54
    {
        say: 'Schema Reference, the other tab, is the short version: every property of a template and of a page, in two tables.',
        do: async (page, ctx) => {
            await ctx.click(generator(page).getByRole('button', { name: 'Schema Reference', exact: true }));
            const nodeTable = generator(page).locator('div', { has: page.locator('h4:text-is("Node Properties")') }).last();
            await nodeTable.waitFor();
            await ctx.move(generator(page).locator('h4:text-is("Template Properties")'));
            await ctx.atSentence(0, { offset: 3.6 });
            const rows = nodeTable.locator('td.font-mono');
            await ctx.move(rows.first());
            await ctx.move(rows.last(), { duration: 1800 });
            await ctx.atSentence(0, { end: true, offset: -0.4 });
            await ctx.click(generator(page).getByRole('button', { name: 'LLM Prompt', exact: true }));
            await promptBlock(page).waitFor();
        },
    },
    // 55
    {
        say: 'Paste it into the chatbot you use, and replace the placeholder on its last line with what you want. '
            + 'Mine asks for a habit tracker for November: a month page that links to every day, and a page for each day with ten habits to tick.',
        do: async (page, ctx) => {
            const prompt = await promptBlock(page).textContent();
            const lines = prompt.split('\n');
            const last = lines.at(-1);
            if (!last.endsWith(PLACEHOLDER)) throw new Error(`the prompt's last line should end with the placeholder: ${last}`);
            await showHeading(ctx, PLACEHOLDER);
            const [ph] = await phraseBox(promptBlock(page), PLACEHOLDER);
            await ctx.spotlight(ph, '', 5);
            await ctx.move({ x: ph.x + ph.width * 0.5, y: ph.y + ph.height + 10 });
            await ctx.atSentence(1);
            await ctx.unspotlight();
            const sent = last.replace(PLACEHOLDER, answer().request);
            await ctx.note({
                title: 'My message',
                lines: [
                    ...lines.slice(0, 4).map(text => ({ text: text || ' ', dim: true })),
                    { text: '…', dim: true },
                    { text: ' ' },
                    { text: sent },
                ],
            });
        },
    },
    // 56
    {
        say: 'The answer is two scripts. The first goes in Define Templates, the second in Build Hierarchy. '
            + "Then Preview, as always: nothing runs before that, and the project isn't touched.",
        do: async (page, ctx) => {
            const { templateScript, hierarchyScript } = answer();
            await ctx.noteClose();
            await ctx.click(helpBar(page), { ax: 0.12 });
            await promptBlock(page).waitFor({ state: 'detached' });
            await ctx.atSentence(1);
            for (const [w, code] of [['T', templateScript], ['H', hierarchyScript]]) {
                await ctx.click(editor(page, w), { ax: 0.5, ay: 0.45 });
                await ctx.press('Control+a');
                await ctx.paste(code);
                await expectScript(page, w, code);
                if (w === 'T') await ctx.atSentence(1, { offset: 2.4 });
            }
            await ctx.atSentence(2);
            await runPreview(ctx, ['2 templates', '31 nodes', '31 estimated pages']);
            await ctx.move(preview(page).getByText('31 estimated pages', { exact: true }));
        },
    },
    // 57
    {
        say: 'Two templates, a month calendar and a daily habit checklist, and 31 pages: November and its 30 days. '
            + 'If Preview goes red instead, paste the message back to the chatbot and ask for a fix. '
            + 'And read what it wrote before you use it. After today, you know what every line does.',
        do: async (page, ctx) => {
            const month = previewCard(page, 'Month – Calendar'), day = previewCard(page, 'Day – Habit Checklist');
            if (await month.getAttribute('aria-label') !== 'Month – Calendar, Default, 1 use') throw new Error('Month – Calendar should have 1 use');
            if (await day.getAttribute('aria-label') !== 'Day – Habit Checklist, Default, 30 uses') throw new Error('Day – Habit Checklist should have 30 uses');
            await ctx.move(month, { ay: 0.35 });
            await ctx.move(day, { ay: 0.35, duration: 900 });
            await ctx.atSentence(2);
            await ctx.click(preview(page).getByRole('button', { name: 'Create As New Project' }));
            const name = page.locator('#generated-project-name');
            await name.waitFor();
            if (await name.inputValue() !== 'Meal planner – Generated') throw new Error(`prefill reads ${await name.inputValue()}`);
            await ctx.press('Control+a');
            await ctx.type('November habits', { wpm: 160 });
            await ctx.click(naming(page).getByRole('button', { name: 'Create Project' }));
            await app.projectTab(page, 'November habits').waitFor({ timeout: 60000 });
            await generator(page).waitFor({ state: 'detached' });
            await app.editorReady(page);
            await ctx.atSentence(3);
            // November 12th: Monday-first columns, the 1st (a Sunday) in the last one; cells 69 × 100 pt, 4 apart
            const index = 6 + 12 - 1;
            await ctx.move(await app.pagePoint(page, 44 + (index % 7) * 73 + 34, 174 + Math.floor(index / 7) * 104 + 50));
        },
    },
    // 58
    {
        say: 'Another week is one changed date and a Preview away. Next time, we leave the editor: the gallery, accounts, and saving to the cloud.',
        hold: 3,
        do: async (page, ctx) => {
            await ctx.atSentence(1, { offset: 1.2 });
            await ctx.endCard();
        },
    },
];
