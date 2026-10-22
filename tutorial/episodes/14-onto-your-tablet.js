// Episode 14 — Onto your tablet.
// The 2026 Planner two ways: the linked PDF (episode 1's export) or note
// templates. The Export as template dialog: pages (one of each design, search,
// Escape, and why dated pages make poor templates), Rescale to (a grey screen,
// a colour screen, a model that can take a PDF), the count line and its
// 400-image cap, the export itself, then the zip: its folders, one exported
// page full size, the Manta's INSTALL.txt, and why reMarkable is the hard one.
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { episodeMeta } from './series.js';
import * as app from '../lib/app.js';
import { ZOOM } from '../lib/browser.js';

export const meta = episodeMeta(14, {
    description: 'Two ways to put a planner or a notebook on an e-ink tablet, for two different jobs: the linked PDF, or note '
        + 'templates your tablet draws behind your handwriting. I export the 2026 Planner\'s undated pages as templates for a '
        + 'Paper Pure, a Boox Note Air C and a Supernote Manta in one zip, then look inside: one folder per model, a page at '
        + 'the tablet\'s exact size, an INSTALL.txt each, and why the reMarkable is the hard one.',
    learn: [
        'The linked PDF or note templates: which job each one does',
        'Picking pages: one of each design, search, and why dated pages make poor templates',
        'Rescale to: one option per screen, and which screens get color',
        'Force greyscale, and the optional PDF template',
        'The count line and the 400-image cap',
        'What is in the zip, and installing on Supernote, Boox and reMarkable',
    ],
    docs: ['/docs/reference/export-as-template', '/docs/reference/greyscale-export'],
    thumbnail: { beat: 9, headline: 'Onto your tablet' },
});

// ---- the Export as template dialog --------------------------------------------------

const dialog = (page) => page.getByRole('dialog', { name: 'Export as template' });
/** The dialog's scrolling middle: Pages, then Rescale to. */
const list = (page) => dialog(page).locator('div.overflow-y-auto').first();
const group = (page, name) => dialog(page).locator(`[role="group"][aria-label="${name}"]`);
/** A group's header row: its box and "Name (count)". */
const groupHead = (page, name) => group(page, name).locator('label').first();
const allOf = (page, name) => group(page, name).getByRole('button', { name: `Select all pages of ${name}` });
const noneOf = (page, name) => group(page, name).getByRole('button', { name: `none (clear pages of ${name})` });
const moreOf = (page, name) => group(page, name).getByRole('button', { name: /more$/ });
const pageRow = (page, groupName, title) => group(page, groupName).locator('li label', { hasText: new RegExp(`^${app.escapeRe(title)}$`) }).first();
const searchBox = (page) => dialog(page).getByRole('searchbox', { name: 'Search pages' });
/** A Rescale to option (one screen) by the model printed as its name. */
const device = (page, name) => dialog(page).locator('label', {
    has: page.locator('span[id$="-name"]', { hasText: new RegExp(`^${app.escapeRe(name)}$`) }),
}).first();
const tick = (page, label) => label.locator('input[type="checkbox"]').first();
const forceGrey = (page) => dialog(page).locator('label', { hasText: 'Force greyscale' }).first();
const pdfOption = (page) => dialog(page).locator('label', { hasText: 'Also include a PDF template' }).first();
const countLine = (page) => dialog(page).getByRole('status');
const exportButton = (page) => dialog(page).getByRole('button', { name: 'Export', exact: true });
const legend = (page, text) => dialog(page).locator('legend', { hasText: text }).first();

/** The editor's split export button and its three segments. */
const exportPdf = (page) => page.getByRole('button', { name: 'Export PDF' }).first();
const exportAll = (page) => page.locator('button[title="Export All Variants (one PDF per variant)"]').first();
const asTemplate = (page) => page.getByRole('button', { name: 'Export as template' }).first();
const variantSelect = (page) => app.sidebarColumn(page).locator('select:has(option)').first();
const settings = (page) => app.section(page, 'template-settings');

/** One box around several locators. */
async function boxAround(...targets) {
    const boxes = [];
    for (const t of targets) boxes.push(typeof t?.boundingBox === 'function' ? await t.boundingBox() : t);
    const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
    const r = Math.max(...boxes.map(b => b.x + b.width)), btm = Math.max(...boxes.map(b => b.y + b.height));
    return { x, y, width: r - x, height: btm - y };
}

/**
 * Wheel-scrolls the dialog's list until `target` sits at `frac` of its height (as far as the list
 * goes). Wheel deltas are divided by the studio's page zoom, hence the × ZOOM.
 */
async function scrollTo(ctx, target, frac = 0.35, steps = 8) {
    const { page } = ctx;
    const box = await list(page).boundingBox();
    const t = await target.boundingBox();
    const dy = t.y + t.height / 2 - (box.y + box.height * frac);
    if (Math.abs(dy) < 20) return;
    await ctx.wheel(dy * ZOOM, { at: { x: box.x + box.width * (0.6 + ctx.human.rnd() * 0.08), y: box.y + box.height * 0.55 }, steps });
    await page.waitForTimeout(150); // let the scroll settle before the next box is measured
}

/** Waits for the count line to read `text` (the narration quotes these numbers). */
async function expectCount(page, text) {
    await countLine(page).filter({ hasText: text }).waitFor({ timeout: 10000 })
        .catch(async () => { throw new Error(`count line reads "${await countLine(page).innerText()}", expected "${text}"`); });
}

/** Moves to `target` only if it is still on screen (the export can finish, and close the dialog, before the pointer gets there). */
async function moveIfThere(ctx, target, opts = {}) {
    const box = await target.boundingBox({ timeout: 300 }).catch(() => null);
    if (box) await ctx.move(box, opts);
}

// ---- files from the zip ---------------------------------------------------------------

/** The zip's files as a short, folder-by-folder listing for the on-screen card. */
function zipCard(names) {
    const top = names.filter(n => !n.includes('/')).sort((a, b) => (a === 'README.txt' ? -1 : b === 'README.txt' ? 1 : a.localeCompare(b)));
    const folders = [...new Set(names.filter(n => n.includes('/')).map(n => n.split('/').slice(0, 2).join('/')))];
    const lines = top.map(n => ({ text: n, key: n }));
    for (const folder of folders) {
        lines.push({ text: `${folder}/`, key: folder });
        const inside = names.filter(n => n.startsWith(`${folder}/`)).map(n => n.slice(folder.length + 1));
        const methods = inside.filter(n => n.startsWith('methods/'));
        // INSTALL.txt first, then each template folder's pictures, then its other files (templates.json, the PDF)
        const rank = (n) => (n === 'INSTALL.txt' ? 0 : n.endsWith('.png') ? 1 : 2);
        const rest = inside.filter(n => !n.startsWith('methods/')).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
        for (const n of rest) lines.push({ text: `    ${n}`, key: `${folder}/${n}` });
        if (methods.length) lines.push({ text: `    methods/  ${methods.length} files (.template, .metadata, .content)`, key: `${folder}/methods/` });
    }
    return lines;
}

/** Dims every line of the on-screen card except those `keep` accepts (the overlay's own dim style). */
async function focusCard(page, keys) {
    await page.evaluate((k) => {
        const lines = document.getElementById('__studio')?.shadowRoot?.querySelectorAll('.note .ln') ?? [];
        lines.forEach((line) => {
            line.style.transition = 'color .3s ease';
            line.classList.toggle('dim', k !== null && !k.includes(line.dataset.key));
        });
    }, keys);
}

/**
 * Shows the zip card, each line tagged with its path so focusCard can pick lines out. The card
 * lets the page through, so the drawn cursor would take the shape of whatever is under it: keep
 * it an arrow until the card goes (hideZipCard).
 */
async function showZipCard(ctx) {
    const { page } = ctx;
    await ctx.note({ title: path.basename(ctx.state.zip), lines: ctx.state.card.map(l => l.text), mono: true });
    await page.evaluate((keys) => {
        const lines = document.getElementById('__studio')?.shadowRoot?.querySelectorAll('.note .ln') ?? [];
        lines.forEach((line, i) => { line.dataset.key = keys[i]; });
        window.__studio.lockShape('arrow');
    }, ctx.state.card.map(l => l.key));
}

async function hideZipCard(ctx) {
    await ctx.noteClose();
    await ctx.page.evaluate(() => window.__studio?.lockShape(null));
}

/** The on-screen box of one card line, by its key. */
async function cardLine(page, key) {
    return page.evaluate((k) => {
        const line = [...(document.getElementById('__studio')?.shadowRoot?.querySelectorAll('.note .ln') ?? [])].find(l => l.dataset.key === k);
        if (!line) return null;
        const r = line.getBoundingClientRect();
        return { x: r.x, y: r.y, width: Math.min(r.width, 420), height: r.height };
    }, key);
}

/** The box of `needle` in the plain text viewer (ctx.openFile), for the pointer to follow. */
async function textBox(page, needle) {
    const box = await page.evaluate((n) => {
        const pre = document.querySelector('#doc pre');
        const node = pre?.firstChild;
        const i = node ? node.textContent.indexOf(n) : -1;
        if (i < 0) return null;
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + n.length);
        const r = range.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
    }, needle);
    if (!box) throw new Error(`text viewer: no "${needle}"`);
    return box;
}

export async function setup(ctx) {
    const { page } = ctx;
    await ctx.goto('/app');
    await app.editorReady(page);
    await page.locator('button[title="New Project"]').first().click();
    await app.presetCard(page, '2026 Planner').click();
    await page.getByText('Create New Project').waitFor({ state: 'hidden', timeout: 90000 });
    await app.editorReady(page);
    await app.nodeRow(page, 'Quarter 1').waitFor({ timeout: 60000 });
    // the first-visit Blank Project tab goes, off camera
    const blank = app.projectTab(page, 'Blank Project');
    await blank.hover();
    await blank.locator('button[title="Close Project"]').click();
    await page.getByRole('button', { name: /Close without Saving/ }).click();
    await blank.waitFor({ state: 'detached', timeout: 30000 });
    await app.editorReady(page);
    await ctx.move(app.canvas(page), { ay: 0.55 });
    await ctx.wait(1500);
    await ctx.titleCard();
    await ctx.wait(900);
}

export const beats = [
    {
        chapter: 'Welcome', lowerThird: false,
        say: "You've got a planner, or a notebook you made, and an e-ink tablet. There are two ways onto it, for two different jobs. "
            + "I'm starting from the 2026 Planner preset, so there's no design work.",
        do: async (page, ctx) => {
            await ctx.wait(2500);
            await ctx.cardOut();
            await ctx.wait(700);
            await ctx.move(app.canvas(page), { ax: 0.45, ay: 0.3 });
            await ctx.atSentence(2);
            await ctx.move(app.projectTab(page, 'Planner 2026'));
            await ctx.atSentence(2, { offset: 2.2 });
            await ctx.move(page.locator('button[title^="Greyscale Export"]').first(), { ax: -1.5 });
        },
    },
    {
        chapter: 'Two ways onto a tablet',
        say: 'The first is the linked PDF. Export PDF, from episode one, makes the whole planner one file: '
            + 'all [1,368](=thirteen hundred and sixty-eight) pages, every link working. You open it on the tablet and write on its pages.',
        do: async (page, ctx) => {
            await ctx.spotlight(exportPdf(page).locator('xpath=..'), '', 6);
            await ctx.atSentence(1);
            await ctx.move(exportPdf(page));
            await ctx.atSentence(2, { end: true });
            await ctx.unspotlight();
        },
    },
    {
        say: "Its pages come out at the size of the variant you're on. This planner has one, Default, sized for a reMarkable Paper Pro. "
            + "A tablet of another shape needs its own variant: that's episode nine.",
        do: async (page, ctx) => {
            await ctx.click(app.sidebarTab(page, 'Templates'));
            await variantSelect(page).waitFor();
            await ctx.atSentence(1);
            await ctx.spotlight(variantSelect(page).locator('xpath=..'), '', 6);
            await ctx.move(variantSelect(page));
            await ctx.atSentence(1, { offset: 2.4 });
            const width = settings(page).locator('label:text-is("Width") + input');
            const unit = settings(page).locator('select[title="Dimension unit"]');
            await ctx.spotlight(await boxAround(width.locator('xpath=..'), unit.locator('xpath=..')), 'reMarkable Paper Pro: 509 × 679', 6);
            await ctx.move(width);
            await ctx.move(settings(page).locator('label:text-is("Height") + input'));
            await ctx.atSentence(2, { end: true });
            await ctx.unspotlight();
        },
    },
    {
        say: 'The second is note templates: page designs your tablet draws behind your handwriting, in any notebook. '
            + "Each page becomes an image at the tablet's exact pixel size, with no links.",
        do: async (page, ctx) => {
            await ctx.move(asTemplate(page));
            await ctx.atSentence(1);
            await ctx.move(asTemplate(page), { ax: 0.6, ay: 0.55 });
        },
    },
    {
        say: 'So: the PDF when you want the planner itself, dated and linked. '
            + "Templates when you want its page designs in the tablet's own notebooks.",
        do: async (page, ctx) => {
            await ctx.move(exportPdf(page));
            await ctx.atSentence(1);
            await ctx.move(asTemplate(page));
            await ctx.atSentence(1, { end: true, offset: -1.2 });
            await ctx.click(asTemplate(page));
            await dialog(page).waitFor();
        },
    },
    {
        chapter: 'Choosing pages',
        say: 'The picker lists pages first, grouped by template. Each group starts with its first page ticked, so you get one of each design.',
        do: async (page, ctx) => {
            await ctx.move(groupHead(page, 'Year View'), { ax: 0.3 });
            await ctx.move(groupHead(page, 'Month View'), { ax: 0.3 });
            await ctx.move(groupHead(page, 'Day View'), { ax: 0.3 });
            await ctx.atSentence(1);
            await ctx.move(pageRow(page, 'Quarter View', 'Quarter 1'), { ax: 0.2 });
            await ctx.move(pageRow(page, 'Month View', 'January'), { ax: 0.2 });
            await ctx.move(pageRow(page, 'Day View', 'January 1, 2026'), { ax: 0.2 });
            await ctx.atSentence(1, { end: true, offset: -1 });
            await ctx.move(countLine(page), { ax: 0.3 });
        },
    },
    {
        say: "That's the usual want: one page of each design, not 365 copies of the Day View. "
            + "I don't need the year page, so none clears its group.",
        do: async (page, ctx) => {
            await ctx.move(groupHead(page, 'Day View'), { ax: 0.4 });
            await ctx.move(moreOf(page, 'Day View'));
            await ctx.atSentence(1);
            await ctx.click(noneOf(page, 'Year View'));
            await ctx.move(pageRow(page, 'Year View', '2026 Planner'), { ax: 0.3 });
        },
    },
    {
        say: "Search reaches the pages [tucked under more](=tucked under, more). I'd like December's month page too. "
            + 'In the search box, Escape clears it and keeps the tick. Anywhere else, Escape closes the picker.',
        do: async (page, ctx) => {
            await ctx.click(searchBox(page));
            await ctx.type('December', { wpm: 150 });
            await pageRow(page, 'Month View', 'December').waitFor();
            await groupHead(page, 'Day View').filter({ hasText: 'Day View (31)' }).waitFor({ timeout: 5000 });
            await ctx.atSentence(1);
            await ctx.move(groupHead(page, 'Day View'), { ax: 0.35 });
            await ctx.click(tick(page, pageRow(page, 'Month View', 'December')));
            await ctx.atSentence(2);
            await ctx.click(searchBox(page));
            await ctx.press('Escape');
            await groupHead(page, 'Day View').waitFor();
            await ctx.move(groupHead(page, 'Month View'), { ax: 0.12 });
            await ctx.atSentence(3);
            await ctx.move(dialog(page).getByRole('heading', { name: 'Pages' }), { ax: 0.6 });
        },
    },
    {
        say: 'One catch: a template is a picture of a page, so a dated page keeps its date. '
            + "Use December's, and every page you write on says December. "
            + "So I'll keep the note and to-do pages, which suit any day, and none clears the rest. "
            + 'That includes the journal and daily notes pages: their top bar shows the month.',
        do: async (page, ctx) => {
            await ctx.move(pageRow(page, 'Day View', 'January 1, 2026'), { ax: 0.5 });
            await ctx.atSentence(1);
            await ctx.move(groupHead(page, 'Month View'), { ax: 0.1 });
            await ctx.atSentence(1, { offset: 1.6 });
            await ctx.click(noneOf(page, 'Month View'));
            await ctx.atSentence(2, { offset: 2.4 });
            for (const name of ['Quarter View', 'Day View']) await ctx.click(noneOf(page, name));
            await scrollTo(ctx, groupHead(page, 'Journal'), 0.12);
            await ctx.atSentence(3);
            for (const name of ['Journal', 'Daily Notes', 'List Index', 'Week View']) await ctx.click(noneOf(page, name));
            await scrollTo(ctx, groupHead(page, 'To-Do Page'), 0.45);
            await ctx.move(pageRow(page, 'Global Note', 'Note 1'), { ax: 0.3 });
            await ctx.move(pageRow(page, 'To-Do Page', 'To-Do List 1'), { ax: 0.3 });
        },
    },
    {
        chapter: 'Choosing devices',
        say: 'Below the pages, Rescale to lists one option per screen, grouped by brand. Until one is ticked, Export waits. '
            + "I'll tick Paper Pure. The reMarkable 2 under it has the same screen, so it gets the same file.",
        do: async (page, ctx) => {
            await scrollTo(ctx, dialog(page).getByRole('heading', { name: 'Rescale to' }), 0.06, 10);
            await ctx.move(legend(page, 'reMarkable'), { ax: 0.4 });
            await ctx.move(legend(page, 'Boox'), { ax: 0.4 });
            await ctx.atSentence(1);
            await ctx.move(exportButton(page));
            await ctx.atSentence(2);
            await ctx.click(tick(page, device(page, 'Paper Pure')));
            await ctx.move(countLine(page), { ax: 0.3 });
            await ctx.atSentence(3);
            await ctx.move(device(page, 'Paper Pure').getByText('reMarkable 2'));
        },
    },
    {
        say: "Color screens get color templates; every other model gets grey, converted like episode six's greyscale export. "
            + 'So the Paper Pure comes out grey, and the [Boox](=Books) Note Air C keeps its color.',
        do: async (page, ctx) => {
            await ctx.move(device(page, 'Note Air C'), { ax: 0.25 });
            await ctx.move(device(page, 'Tab X C'), { ax: 0.25 });
            await ctx.atSentence(0, { offset: 2.4 });
            await ctx.move(device(page, 'Manta'), { ax: 0.25 });
            await ctx.atSentence(1);
            await ctx.spotlight(device(page, 'Paper Pure'), 'greyscale screen', 6);
            await ctx.move(device(page, 'Paper Pure'), { ax: 0.3 });
            await ctx.atSentence(1, { offset: 2.6 });
            await ctx.click(tick(page, device(page, 'Note Air C')));
            await ctx.spotlight(device(page, 'Note Air C'), 'color screen', 6);
        },
    },
    {
        say: 'Force greyscale makes them all grey. And ticking the [Boox](=Books) brought up a new box: Also include a PDF template.',
        do: async (page, ctx) => {
            await ctx.unspotlight();
            await scrollTo(ctx, pdfOption(page), 0.8, 10);
            await ctx.spotlight(forceGrey(page), '', 3);
            await ctx.move(forceGrey(page), { ax: 0.2 });
            await ctx.atSentence(1);
            await ctx.spotlight(pdfOption(page), '', 3);
            await ctx.move(pdfOption(page), { ax: 0.25 });
        },
    },
    {
        say: 'It puts your pages in one PDF beside the images, with the links between them still working. '
            + "reMarkable folders never get one. I'll add a Supernote Manta, and tick it.",
        do: async (page, ctx) => {
            // "…still working. reMarkable folders never get one." is one narration sentence (no capital after the stop)
            await ctx.atSentence(0, { offset: 5.6 });
            await ctx.unspotlight();
            await scrollTo(ctx, legend(page, 'Supernote'), 0.5, 10);
            await ctx.move(device(page, 'Paper Pure'), { ax: 0.3 });
            await ctx.atSentence(1);
            await ctx.click(tick(page, device(page, 'Manta')));
            await scrollTo(ctx, pdfOption(page), 0.8, 10);
            await ctx.click(tick(page, pdfOption(page)));
        },
    },
    {
        chapter: 'Count and limits',
        say: 'The line at the bottom keeps count: two pages on three devices, six templates. '
            + 'The ceiling is 400 images per export, about what a phone browser can zip.',
        do: async (page, ctx) => {
            await expectCount(page, '2 pages × 3 devices = 6 templates (.zip)');
            await ctx.spotlight(countLine(page), '', 6);
            await ctx.move(countLine(page), { ax: 0.4 });
            await ctx.atSentence(1, { end: true });
            await ctx.unspotlight();
        },
    },
    {
        say: 'Ticking all on the Day View asks for every day of the year: too many files, and Export waits. '
            + "Then none clears the group, and we're back under.",
        do: async (page, ctx) => {
            await scrollTo(ctx, groupHead(page, 'Day View'), 0.4, 12);
            await ctx.click(allOf(page, 'Day View'));
            await expectCount(page, 'Too many files: pick fewer pages or devices.');
            await ctx.move(countLine(page), { ax: 0.3 });
            await ctx.move(exportButton(page));
            await ctx.atSentence(1);
            await ctx.click(noneOf(page, 'Day View'));
            await expectCount(page, '2 pages × 3 devices = 6 templates (.zip)');
            await ctx.move(countLine(page), { ax: 0.35 });
        },
    },
    {
        chapter: 'Export',
        say: 'Export draws every image right here in the browser, and the line counts them off. Cancel would stop it, with nothing downloaded. '
            + 'Your devices and both boxes are remembered for next time; the page ticks start fresh.',
        do: async (page, ctx) => {
            ctx.state.zip = await ctx.download(async () => {
                await ctx.click(exportButton(page));
                await moveIfThere(ctx, countLine(page), { ax: 0.3 });
                await moveIfThere(ctx, dialog(page).getByRole('button', { name: 'Cancel' }), { ax: 0.3 });
            });
            await dialog(page).waitFor({ state: 'detached' });
            const zip = await JSZip.loadAsync(fs.readFileSync(ctx.state.zip));
            const names = Object.keys(zip.files).filter(n => !zip.files[n].dir);
            ctx.state.card = zipCard(names);
            const dir = path.join(path.dirname(ctx.state.zip), 'zip');
            for (const n of names) {
                fs.mkdirSync(path.dirname(path.join(dir, n)), { recursive: true });
                fs.writeFileSync(path.join(dir, n), await zip.file(n).async('nodebuffer'));
            }
            ctx.state.dir = dir;
            await ctx.move(asTemplate(page), { ax: 0.3, ay: 2.5 });
            // reopened, the count line shows both: three devices remembered, one page per template again
            await ctx.atSentence(2);
            await ctx.click(asTemplate(page));
            await dialog(page).waitFor();
            await expectCount(page, '10 pages × 3 devices = 30 templates (.zip)');
            await ctx.spotlight(countLine(page), '', 6);
            await ctx.move(countLine(page), { ax: 0.45 });
            await ctx.atSentence(2, { end: true, offset: -1 });
            await ctx.unspotlight();
            await ctx.click(dialog(page).getByRole('button', { name: 'Cancel' }));
            await dialog(page).waitFor({ state: 'detached' });
        },
    },
    {
        chapter: "What's in the zip",
        say: 'One zip, one folder per model, each laid out the way that device expects. '
            + "That's [png](=P N G) and methods for the reMarkable, [MyStyle](=My Style) for the Manta, "
            + 'and [noteTemplate](=note template) for the [Boox](=Books).',
        do: async (page, ctx) => {
            await showZipCard(ctx);
            await ctx.atSentence(1);
            const rm = ctx.state.card.filter(l => l.key.startsWith('reMarkable/')).map(l => l.key);
            await focusCard(page, rm);
            await ctx.move(await cardLine(page, rm.find(k => k.endsWith('/methods/'))));
            await ctx.atSentence(1, { offset: 2.8 });
            const manta = ctx.state.card.filter(l => l.key.startsWith('Supernote/')).map(l => l.key);
            await focusCard(page, manta);
            await ctx.move(await cardLine(page, manta.find(k => k.includes('/MyStyle/'))));
            await ctx.atSentence(1, { offset: 4.5 });
            const boox = ctx.state.card.filter(l => l.key.startsWith('Boox/')).map(l => l.key);
            await focusCard(page, boox);
            await ctx.move(await cardLine(page, boox.find(k => k.includes('/noteTemplate/'))));
        },
    },
    {
        say: "Here's the Paper Pure's to-do page: [1404 × 1872](=fourteen oh four by eighteen seventy-two) pixels, "
            + "the tablet's exact screen, in grey.",
        hold: 1,
        do: async (page, ctx) => {
            const rel = ctx.state.card.map(l => l.key).find(k => /^reMarkable\/.*\/png\/To-Do_List_1\.png$/.test(k));
            await hideZipCard(ctx);
            await ctx.openFile(path.join(ctx.state.dir, rel), { title: rel });
            await ctx.move({ x: 720, y: 430 });
            await ctx.atSentence(0, { offset: 2.6 });
            await ctx.move(page.locator('#meta'));
            await ctx.atSentence(0, { offset: 5.4 });
            await ctx.move({ x: 760, y: 360 });
        },
    },
    {
        say: 'Each folder has an [INSTALL.txt](=install dot T X T). Here\'s the Manta\'s: connect by USB, copy the [MyStyle](=My Style) folder across, '
            + 'then pick a page under Templates, Customization.',
        do: async (page, ctx) => {
            const rel = ctx.state.card.map(l => l.key).find(k => /^Supernote\/[^/]+\/INSTALL\.txt$/.test(k));
            await ctx.openFile(path.join(ctx.state.dir, rel), { title: rel });
            await ctx.move(await textBox(page, 'Supernote: Manta'), { ax: 0.9 });
            await ctx.atSentence(1, { offset: 1.2 });
            await ctx.move(await textBox(page, 'Connect the Supernote by USB'), { ax: 0.75 });
            await ctx.atSentence(1, { offset: 3.0 });
            await ctx.move(await textBox(page, 'Copy the folder MyStyle/'), { ax: 0.75 });
            await ctx.atSentence(1, { offset: 5.2 });
            await ctx.move(await textBox(page, 'open Templates > Customization'), { ax: 0.7 });
        },
    },
    {
        say: 'That copying is yours to do: the app never touches your tablet. '
            + 'And reMarkable is the hard one, with no official way to add templates at all.',
        do: async (page, ctx) => {
            await ctx.move(await textBox(page, 'Copy the folder MyStyle/'), { ax: 0.4 });
            await ctx.goto('/app');
            await app.editorReady(page);
            await showZipCard(ctx);
            await ctx.move({ x: 1150, y: 300 });
            await ctx.atSentence(1);
            const rm = ctx.state.card.filter(l => l.key.startsWith('reMarkable/')).map(l => l.key);
            await focusCard(page, rm);
            await ctx.move(await cardLine(page, rm[0]));
        },
    },
    {
        say: 'So its [INSTALL.txt](=install dot T X T) opens with a warning: both routes need [SSH](=S S H), at your own risk. '
            + 'Start with methods: line drawings that survive software updates; the PNGs look exact, but an update removes them. '
            + 'On a Paper Pro, getting [SSH](=S S H) at all means a factory reset. The linked PDF needs none of that.',
        do: async (page, ctx) => {
            const keys = ctx.state.card.map(l => l.key);
            const install = keys.find(k => /^reMarkable\/[^/]+\/INSTALL\.txt$/.test(k));
            await focusCard(page, [install]);
            await ctx.move(await cardLine(page, install));
            await ctx.atSentence(1);
            const methods = keys.find(k => /^reMarkable\/.*\/methods\/$/.test(k));
            await focusCard(page, [methods]);
            await ctx.move(await cardLine(page, methods));
            await ctx.atSentence(1, { offset: 3.9 });
            const png = keys.filter(k => /^reMarkable\/[^/]+\/png\//.test(k));
            await focusCard(page, png);
            await ctx.move(await cardLine(page, png[0]));
            await ctx.atSentence(2);
            await focusCard(page, [install]);
            await ctx.move(await cardLine(page, install));
            await ctx.atSentence(3);
            await focusCard(page, null);
            await ctx.move({ x: 985, y: 300 });
        },
    },
    {
        say: "That's both ways onto your tablet. Next time: keeping your work safe, in the browser and out of it.",
        hold: 3,
        do: async (page, ctx) => {
            await ctx.atSentence(0, { offset: 1.2 });
            await hideZipCard(ctx);
            await ctx.endCard();
        },
    },
];
