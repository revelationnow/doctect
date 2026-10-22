// Episode 16 — Finding the right planner.
// A first-time visitor shops the gallery for a 2026 planner that fits a
// reMarkable Paper Pro. Off camera, five members publish six projects (two of
// them through the generator, from the app's gallery samples) and two get
// rated and reviewed through the API. On camera: Category, Size or device,
// Sort, 4+, List view and the address; tags and search; a project page's sizes
// and reviews; a profile; signing in to leave a review; then Download all
// variants, the Paper Pro edition in a PDF reader, and an older version from
// Version history.
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { episodeMeta } from './series.js';
import * as app from '../lib/app.js';
import * as cloud from '../lib/cloud.js';
import { ROOT } from '../lib/episode.js';
import { ZOOM } from '../lib/browser.js';

export const meta = episodeMeta(16, {
    description: 'The gallery has filled up. This time I shop it for one thing, a 2026 planner for a reMarkable Paper Pro: '
        + 'narrow it down with the filters the gallery works out for itself, judge what is left by its sizes, rating and reviews, '
        + 'leave a review of my own, and take every edition home in one zip.',
    learn: [
        'Category and Size or device: filters the gallery works out itself',
        'Trending, Top rated, and why the number of reviews matters',
        '4+ stars, List view, and an address that keeps every filter',
        'Tags and search, and which to use first',
        'Judging a project by its sizes, page count, rating and reviews',
        'Profiles, and leaving a review of your own',
        'Download all variants, and opening an older version',
    ],
    docs: ['/docs/reference/gallery-filters-and-sorting', '/docs/gallery/ratings-reviews-profiles'],
    thumbnail: { beat: 9, headline: 'Filters & reviews' },
});

const { you, sam, priya } = cloud.PEOPLE;
const mei = { name: 'Mei Lin', username: 'mei_saves', email: 'mei@example.com', password: 'Sinking-funds-2026' };
const theo = { name: 'Theo Marsh', username: 'theo_works', email: 'theo@example.com', password: 'Kanban-and-coffee-26' };

const sample = (dir, file) => fs.readFileSync(path.join(ROOT, 'gallery-samples', dir, file), 'utf8');
const pause = (ms) => new Promise(r => setTimeout(r, ms));

// ---- off camera: six listings by five members ---------------------------------

/** Priya's second publish: three editions of the planner, the Paper Pro one active for the previews. */
async function publishEditions(ctx) {
    await cloud.renameVariant(ctx, 'reMarkable Paper Pro');
    await cloud.addVariant(ctx, 'reMarkable 2', 'reMarkable 2 (445×592)');
    await cloud.saveToCloud(ctx, 'Add a reMarkable 2 size');
    await cloud.addVariant(ctx, 'Kindle Scribe', 'Kindle Scribe (432×576)');
    await cloud.selectVariant(ctx, 'reMarkable Paper Pro');
    await cloud.saveToCloud(ctx, 'Kindle Scribe and reMarkable 2 editions');
    await cloud.publish(ctx, {
        description: 'A linked planner for the whole of 2026: years, quarters, months, weeks and days, all one tap apart. '
            + 'Editions for the reMarkable Paper Pro, reMarkable 2 and Kindle Scribe.',
        tags: ['planner', '2026', 'remarkable', 'kindle'],
    });
}

/** A member who builds a gallery sample with the generator and publishes it. */
async function seedGenerated(ctx, person, { dir, name, description, tags }) {
    await cloud.signUp(ctx, person);
    await cloud.newGeneratedProject(ctx, { templates: sample(dir, 'templates.js'), hierarchy: sample(dir, 'hierarchy.js'), name });
    await cloud.saveToCloud(ctx, 'First version');
    await cloud.publish(ctx, { description, tags });
}

/** Reviews (oldest first, so Sam's shows first) and forks, through the API. */
async function rateAndFork(ctx) {
    const planner = await cloud.listingId(ctx, 'Planner 2026', priya.username);
    const moneyMap = await cloud.listingId(ctx, 'Money Map', mei.username);
    const desk = await cloud.listingId(ctx, 'Project Desk', theo.username);
    const [asMei, asTheo, asSam, asPriya] = await Promise.all([mei, theo, sam, priya].map(p => cloud.apiSession(ctx, p)));
    const reviews = [
        [asMei, planner, 4, "Lovely layout. I'd love dot grids on the notes pages."],
        [asTheo, planner, 5, 'The week pages fit my meetings perfectly.'],
        [asSam, planner, 5, 'Every date is one tap from its day. I use the reMarkable 2 edition every morning.'],
        [asPriya, moneyMap, 4, 'Clear monthly pages, and sinking funds are a great idea.'],
        [asSam, moneyMap, 4, 'Took ten minutes to set up my first month.'],
    ];
    for (const [api, id, rating, body] of reviews) {
        await api.put(`/api/gallery/${id}/review`, { rating, body });
        await pause(40); // distinct timestamps: reviews list newest first
    }
    await asSam.post(`/api/projects/${desk}/fork`, {});
    await asPriya.post(`/api/projects/${desk}/fork`, {});
    await asTheo.post(`/api/projects/${moneyMap}/fork`, {});
    return planner;
}

export async function setup(ctx) {
    const { page } = ctx;
    await ctx.goto('/app');
    await app.editorReady(page);
    const [planner, sketchbook] = cloud.GALLERY.find(([person]) => person === priya)[1];
    // the Sketchbook first, so the profile lists the planner (published last) first
    await cloud.seedMember(ctx, priya, [sketchbook, planner]);
    await publishEditions(ctx);
    await cloud.freshVisitor(ctx);
    await cloud.seedMember(ctx, sam, cloud.GALLERY.find(([person]) => person === sam)[1]);
    await cloud.freshVisitor(ctx);
    await seedGenerated(ctx, mei, {
        dir: '03-personal-finance-planner', name: 'Money Map',
        description: 'A personal finance planner: a plan for every month, transaction logs and sinking funds.',
        tags: ['planner', 'budget', 'monthly'],
    });
    await cloud.freshVisitor(ctx);
    await seedGenerated(ctx, theo, {
        dir: '02-work-project-hub', name: 'Project Desk',
        description: 'A work planner: project briefs, a paper Kanban board, meeting logs and weekly reviews.',
        tags: ['planner', 'work', 'weekly'],
    });
    await cloud.freshVisitor(ctx);
    await cloud.seedMember(ctx, you, [{
        fixture: '09-recipe-variants', message: 'First cloud copy',
        description: 'Family recipes for A4 and the reMarkable: a cover with an index, and a page for every dish.',
        tags: ['recipes', 'cooking', 'remarkable'], previews: ['Tomato Soup'],
    }]);
    ctx.state.plannerId = await rateAndFork(ctx);
    await cloud.freshVisitor(ctx);
    await ctx.goto('/gallery');
    await page.getByText('In the spotlight').waitFor({ timeout: 30000 });
    await page.locator('main a.group').first().waitFor();
    await ctx.wait(1200);
    await ctx.titleCard();
    await ctx.wait(900);
}

// ---- on camera -------------------------------------------------------------------

const categoryMenu = (page) => page.locator('select[aria-label="Category"]');
const sizeMenu = (page) => page.locator('select[aria-label="Page size or device"]');
const sortMenu = (page) => page.locator('select[aria-label="Sort"]');
const fourPlus = (page) => page.getByRole('button', { name: '4+' });
const gridView = (page) => page.getByRole('button', { name: 'Grid view' });
const listView = (page) => page.getByRole('button', { name: 'List view' });
const search = (page) => page.getByLabel('Search the gallery');
const resultCount = (page) => page.locator('main span[aria-live="polite"]');
const resultsLine = (page) => resultCount(page).locator('xpath=..');
const card = (page, name) => page.locator('main a.group', { has: page.locator('div.font-semibold', { hasText: name }) }).first();
const detail = (page) => page.getByTestId('modal-backdrop');
const reviewForm = (page) => page.locator('div.bg-white.border.rounded-xl', { has: page.getByRole('radiogroup', { name: 'Rating' }) });
const historyDialog = (page) => page.getByRole('dialog', { name: 'Version history' });

/** Waits for the results line to read `n projects`. */
const showing = (page, n) => resultCount(page).filter({ hasText: new RegExp(`^${n} projects?$`) }).waitFor({ timeout: 15000 });

/** Milliseconds until sentence k of the running beat starts (plus `offset` seconds); 0 in dry runs. */
function msUntil(ctx, k, offset = 0) {
    const b = ctx.beat;
    const s = b?.sentences?.[k];
    if (ctx.dry || !b || b.narrationStart === null || !s) return 0;
    return Math.max(0, (b.narrationStart + s.start + offset) * 1000 - Date.now());
}

/**
 * ctx.pick, with the stand-in list held open until `until` ms from now while the pointer
 * visits the options named in `via`; the highlight follows the pointer, as in a real list.
 */
async function pickVia(ctx, select, choice, { via = [], until = 0 } = {}) {
    const { page } = ctx;
    const labels = await select.evaluate(s => [...s.options].map(o => o.label || o.text));
    const picking = ctx.pick(select, choice, { dwell: Math.max(until - 700, 600 + via.length * 1100) });
    await page.waitForFunction(() => !!window.__studio?._dd);
    await page.evaluate(() => {
        const studio = window.__studio;
        const follow = setInterval(() => {
            if (!studio._dd) { clearInterval(follow); return; }
            const p = studio.pos;
            const i = studio.dropdownRects().findIndex(r => p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height);
            if (i >= 0) studio.dropdownHighlight(i);
        }, 16);
    });
    for (const label of via) {
        const r = (await page.evaluate(() => window.__studio.dropdownRects()))[labels.indexOf(label)];
        await ctx.move({ x: r.x + Math.min(r.width / 2, 70), y: r.y + r.height / 2 }, { duration: 520 });
        await ctx.wait(550);
    }
    await picking;
}

/** Scrolls the gallery page (or the project overlay, under the pointer) by `dy` CSS pixels. */
const scroll = (ctx, dy, at) => ctx.wheel(dy * ZOOM, { at, steps: 10 });

export const beats = [
    {
        chapter: 'Welcome', lowerThird: false,
        say: "The gallery has filled up since episode eleven. Today I'm shopping for a 2026 planner for my reMarkable Paper Pro. "
            + "We'll narrow the gallery down, judge what's left, and take one home.",
        do: async (page, ctx) => {
            await ctx.wait(2500);
            await ctx.cardOut();
            await ctx.move(page.getByText('In the spotlight'));
            await ctx.atSentence(1);
            const trending = page.locator('main h2', { hasText: 'Trending' }).first();
            await scroll(ctx, (await trending.boundingBox()).y - 135, { x: 900, y: 520 });
            await ctx.move(trending, { ax: 0.2 });
            await ctx.move(page.locator('main h2', { hasText: /New$/ }).first(), { ax: 0.2 });
            await ctx.atSentence(2);
            await ctx.move(categoryMenu(page));
        },
    },
    {
        chapter: 'Narrowing it down',
        say: 'These controls sit above every gallery view. Category comes first. '
            + "Nobody files anything here: the gallery works out each project's category from its tags and name. Planners.",
        do: async (page, ctx) => {
            for (const control of [sizeMenu(page), fourPlus(page), sortMenu(page), gridView(page), listView(page)]) {
                await ctx.move(control, { duration: 420 });
            }
            await ctx.atSentence(1);
            await pickVia(ctx, categoryMenu(page), 'Planners (4)', { until: msUntil(ctx, 3) });
            await showing(page, 4);
            await ctx.move(resultCount(page));
        },
    },
    {
        say: 'Size or device matters most for a tablet. Some entries cover several devices that share a screen, '
            + 'like the [10.3-inch](=ten-point-three-inch) one, because one file fits them all. Mine\'s the Paper Pro.',
        do: async (page, ctx) => {
            await ctx.move(sizeMenu(page));
            await ctx.atSentence(1);
            await pickVia(ctx, sizeMenu(page), 'reMarkable Paper Pro (5)', {
                via: ['10.3″ e-ink (reMarkable 2, Boox, Supernote) (1)'], until: msUntil(ctx, 2, 0.4),
            });
            await showing(page, 3);
            await ctx.move(card(page, 'Project Desk'), { ay: 0.35 });
        },
    },
    {
        say: 'Results start sorted by Trending: what people are opening and forking lately. Newest and Most downloaded are here too. '
            + "Top rated weighs each average by how many reviews back it, so one lucky five-star review can't outrank lots of good ones.",
        do: async (page, ctx) => {
            await ctx.move(card(page, 'Money Map'), { ay: 0.35 });
            await ctx.move(card(page, 'Planner 2026'), { ay: 0.35 });
            await ctx.atSentence(1);
            await pickVia(ctx, sortMenu(page), 'Top rated', { via: ['Newest', 'Most downloaded'], until: msUntil(ctx, 2) });
            await card(page, 'Planner 2026').locator('[aria-label^="Rated"]').waitFor();
            await page.waitForFunction(() => document.querySelector('main a.group')?.textContent.includes('Planner 2026'));
            await ctx.move(card(page, 'Planner 2026').locator('[aria-label^="Rated"]'));
            await ctx.move(card(page, 'Money Map').locator('[aria-label^="Rated"]'));
            await ctx.move(card(page, 'Project Desk'), { ay: 0.85 });
        },
    },
    {
        say: '[4+](=Four plus) keeps projects averaging four stars or more. Notice what else drops out: anything nobody has rated yet.',
        do: async (page, ctx) => {
            await ctx.click(fourPlus(page));
            await showing(page, 2);
            await ctx.move(page.getByLabel('Remove filter 4★ and up'), { ax: 0.1 });
            await ctx.atSentence(1);
            await ctx.move(card(page, 'Money Map'), { ay: 0.35 });
        },
    },
    {
        say: 'List view puts the same results in a table, so sizes and ratings sit side by side.',
        do: async (page, ctx) => {
            await ctx.click(listView(page));
            const row = page.getByTestId('directory-row').filter({ hasText: 'Planner 2026' });
            await row.waitFor();
            for (const cell of [1, 4, 5]) await ctx.move(row.locator('td').nth(cell), { ax: cell === 4 ? 0.85 : 0.4, duration: 650 });
        },
    },
    {
        say: "Everything I've picked is written into the page's address. Bookmark it, or send it to a friend, "
            + 'and it opens this exact list, signed in or not.',
        do: async (page, ctx) => {
            const url = new URL(page.url());
            // zero-width spaces let the address wrap inside the label at ? and &
            const address = (url.pathname + url.search).replace(/([?&])/g, '$1\u200b');
            await ctx.spotlight(resultsLine(page), address, 6);
            await ctx.move(resultCount(page));
        },
    },
    {
        say: 'Back in the grid, tags are filters too. But a tag click starts a fresh view: planner is now the only filter, '
            + 'and the A4 and unrated planners are back. So pick a tag first, then narrow.',
        do: async (page, ctx) => {
            await ctx.unspotlight();
            await ctx.click(gridView(page));
            const tag = card(page, 'Planner 2026').getByRole('button', { name: 'planner', exact: true });
            await tag.waitFor();
            await ctx.atSentence(1);
            await ctx.click(tag);
            await showing(page, 4);
            await ctx.move(page.getByLabel('Remove filter #planner'), { ax: 0.1 });
            await ctx.atSentence(1, { offset: 3.6 });
            await ctx.move(card(page, 'Meals this week'), { ay: 0.35 });
            await ctx.move(card(page, 'Project Desk'), { ay: 0.35 });
        },
    },
    {
        say: "I want a 2026 planner, so I'll search for 2026. While there's a search, Sort switches to Best match, "
            + 'which puts names that match first.',
        do: async (page, ctx) => {
            await ctx.click(search(page));
            await ctx.type('2026', { wpm: 110 });
            await showing(page, 1);
            await ctx.move(page.getByLabel('Remove filter “2026”'), { ax: 0.1 });
            await ctx.atSentence(1);
            await ctx.move(sortMenu(page));
        },
    },
    {
        chapter: 'Is it any good?',
        say: 'Its page answers the first question: will it fit? It lists every size it comes in, the Paper Pro among them, '
            + 'and its page count: [1,368](=thirteen hundred and sixty-eight).',
        do: async (page, ctx) => {
            await ctx.click(card(page, 'Planner 2026'), { ay: 0.35 });
            await detail(page).getByRole('button', { name: 'Version history' }).waitFor();
            await ctx.move(detail(page).locator('img').first(), { ay: 0.4 });
            await ctx.move(detail(page).getByRole('link', { name: priya.username }));
            await ctx.atSentence(1);
            for (const name of ['Planners', '10.3″ e-ink (reMarkable 2, Boox, Supernote)', 'Kindle Scribe', 'reMarkable Paper Pro']) {
                await ctx.move(detail(page).getByRole('link', { name, exact: true }), { duration: 500 });
            }
            await ctx.move(detail(page).getByText('1368 pages'));
        },
    },
    {
        say: 'Then: is it any good? It averages [4.7](=four point seven) stars, from three reviews, and anyone can read them. '
            + 'Mei gave four, and wants dot grids on the notes pages. Stars alone can\'t tell you that.',
        do: async (page, ctx) => {
            await ctx.move(detail(page).locator('h1 + div + div [aria-label^="Rated"]'));
            await ctx.atSentence(0, { offset: 3.4 });
            const heading = detail(page).getByRole('heading', { name: 'Reviews' });
            const box = await heading.boundingBox();
            await scroll(ctx, box.y - 150, { x: 1000, y: 480 });
            await ctx.move(detail(page).getByRole('link', { name: 'Sign in to review' }));
            await ctx.atSentence(1);
            const meiReview = detail(page).locator('div.bg-white.border.rounded-xl', { has: page.getByRole('link', { name: mei.username }) });
            await ctx.move(meiReview.locator('p'), { ax: 0.3 });
        },
    },
    {
        say: "The author's name links to a profile. Priya's shows a username, a join date, and what Priya has published. "
            + "That's all: no real name, no email.",
        do: async (page, ctx) => {
            await scroll(ctx, -800, { x: 1000, y: 400 });
            await ctx.click(detail(page).getByRole('link', { name: priya.username }));
            await page.getByRole('heading', { name: priya.username }).waitFor();
            await card(page, 'Sketchbook').waitFor();
            await ctx.move(page.getByRole('heading', { name: priya.username }));
            await ctx.move(page.getByText(/^Joined /));
            await ctx.atSentence(1, { offset: 2.2 });
            await ctx.move(card(page, 'Planner 2026'), { ay: 0.3 });
            await ctx.move(card(page, 'Sketchbook'), { ay: 0.3 });
        },
    },
    {
        chapter: 'Leaving a review',
        say: 'Back to Priya\'s planner, to add a review of my own. Writing one takes an account: '
            + 'Sign in to review goes to the sign-in page.',
        do: async (page, ctx) => {
            await ctx.click(card(page, 'Planner 2026'), { ay: 0.3 });
            const signIn = detail(page).getByRole('link', { name: 'Sign in to review' });
            await signIn.waitFor();
            const box = await signIn.boundingBox();
            await scroll(ctx, box.y - 420, { x: 1000, y: 480 });
            await ctx.atSentence(1);
            await ctx.click(signIn);
            await page.getByRole('heading', { name: 'Sign In' }).waitFor();
            await ctx.move(page.getByLabel('Email', { exact: true }));
        },
    },
    {
        say: 'My email and password, then Sign In. That lands me in the editor, though, not back on the planner. '
            + "The browser's Back button returns me to it.",
        do: async (page, ctx) => {
            await ctx.click(page.getByLabel('Email', { exact: true }));
            await ctx.type(you.email, { wpm: 200 });
            await ctx.click(page.getByLabel('Password', { exact: true }));
            await ctx.type(you.password, { wpm: 220 });
            const shots = [];
            if (process.env.EP16_DEBUG) {
                const t0 = Date.now();
                const timer = setInterval(() => shots.push(page.screenshot({ path: path.join(ctx.outDir, `debug-signin-${Date.now() - t0}.png`) }).catch(() => {})), 120);
                ctx.state.stopShots = () => clearInterval(timer);
            }
            await ctx.click(page.getByRole('button', { name: 'Sign In', exact: true }));
            await page.waitForURL(url => new URL(url).pathname === '/app', { timeout: 20000 });
            await app.editorReady(page);
            if (ctx.state.stopShots) { await ctx.wait(800); ctx.state.stopShots(); await Promise.all(shots); }
            await ctx.atSentence(2);
            await ctx.showKeys(['Alt', '+', '←']);
            await page.goBack();
            if (process.env.EP16_DEBUG) console.log('after Back:', page.url());
            ctx.human.resetDialogs();
            await ctx.human.ensure();
            await reviewForm(page).waitFor({ timeout: 20000 });
            const form = await reviewForm(page).boundingBox();
            await scroll(ctx, form.y - 260, { x: 1000, y: 480 });
            await ctx.move(page.getByText('Rate this project'));
        },
    },
    {
        say: 'Reviews are signed with your username. The stars are the only required part; the words are optional. '
            + 'Five stars, and one line about why.',
        do: async (page, ctx) => {
            await ctx.move(reviewForm(page).getByRole('radiogroup', { name: 'Rating' }));
            await ctx.atSentence(1, { offset: 1.2 });
            await ctx.move(reviewForm(page).getByPlaceholder('Share what you think (optional)'));
            await ctx.atSentence(2);
            await ctx.click(reviewForm(page).getByRole('radio', { name: '5 stars' }));
            await ctx.click(reviewForm(page).getByPlaceholder('Share what you think (optional)'));
            await ctx.type('Exactly what I wanted on my Paper Pro. Every date is one tap away.', { wpm: 240 });
        },
    },
    {
        say: 'Save review, and the average moves straight away: [4.8](=four point eight), from four reviews. '
            + "The heading now says Your review: there's one per person, and saving again replaces it.",
        do: async (page, ctx) => {
            await ctx.click(reviewForm(page).getByRole('button', { name: 'Save review' }));
            await page.getByText('Your review', { exact: true }).waitFor({ timeout: 15000 });
            const ours = page.locator('div.bg-white.border.rounded-xl', { has: page.getByRole('link', { name: you.username }) });
            await ours.waitFor();
            await ctx.move(ours.locator('p'), { ax: 0.3 });
            await ctx.move(page.getByRole('heading', { name: 'Reviews' }).locator('xpath=..').getByText('4.8 (4)'));
            await ctx.atSentence(1);
            await ctx.move(page.getByText('Your review', { exact: true }));
            await ctx.move(reviewForm(page).getByRole('button', { name: 'Delete review' }));
        },
    },
    {
        say: "One more rule: you can't review your own work. On your own projects this form never appears, "
            + 'and the server turns the review away anyway.',
        do: async (page, ctx) => {
            await ctx.move(reviewForm(page), { ax: 0.7, ay: 0.3 });
            await ctx.atSentence(1);
            await ctx.move(reviewForm(page), { ax: 0.55, ay: 0.55 });
        },
    },
    {
        chapter: 'Taking it home',
        say: 'Now, taking it home. Download all variants renders every edition right here in the browser, and hands over one zip. '
            + 'A planner this size takes a few seconds.',
        do: async (page, ctx) => {
            await scroll(ctx, -900, { x: 1000, y: 400 });
            const download = page.getByRole('button', { name: /Download all variants/ });
            await ctx.move(download);
            await ctx.atSentence(1);
            ctx.state.zip = await ctx.download(() => ctx.click(download), { timeout: 240000 });
        },
    },
    {
        say: "Inside, there's one PDF per variant, named after it. The Paper Pro one is mine.",
        do: async (page, ctx) => {
            const zip = await JSZip.loadAsync(fs.readFileSync(ctx.state.zip));
            const names = Object.keys(zip.files).filter(n => !zip.files[n].dir);
            await ctx.note({ title: path.basename(ctx.state.zip), lines: names, mono: true });
            const mine = names.find(n => /Paper Pro/.test(n));
            ctx.state.pdf = path.join(path.dirname(ctx.state.zip), mine);
            fs.writeFileSync(ctx.state.pdf, await zip.file(mine).async('nodebuffer'));
        },
    },
    {
        say: "Here's that one in a PDF reader: the same linked planner, at my tablet's size.",
        do: async (page, ctx) => {
            await ctx.noteClose();
            await ctx.openPdf(ctx.state.pdf, { title: path.basename(ctx.state.pdf) });
            await ctx.move({ x: 760, y: 420 });
            await ctx.atSentence(0, { offset: 2.4 });
            await ctx.clickPdfLink({ text: 'Quarter 2' });
            await ctx.move({ x: 900, y: 520 });
        },
    },
    {
        say: 'Version history lists the versions Priya published, newest first, each with its note. '
            + "Saves that were never published don't appear.",
        do: async (page, ctx) => {
            await ctx.goto(`/gallery/${ctx.state.plannerId}`);
            const open = page.getByRole('button', { name: 'Version history' });
            await open.waitFor();
            await ctx.click(open);
            await historyDialog(page).getByText('The 2026 planner').waitFor();
            await ctx.move(historyDialog(page).getByText('Kindle Scribe and reMarkable 2 editions'));
            await ctx.move(historyDialog(page).getByText('HEAD'));
            await ctx.move(historyDialog(page).getByText('The 2026 planner'));
            await ctx.atSentence(1);
            const older = historyDialog(page).locator('div.flex.items-center.justify-between', { hasText: 'The 2026 planner' });
            await ctx.move(older.getByRole('button', { name: 'Open in editor' }));
            await ctx.move(older.getByRole('button', { name: 'Fork' }));
        },
    },
    {
        say: 'Open in editor on the older one puts that exact version in my editor, as a new tab. '
            + "Like any Open in editor copy, it's mine, with no link back.",
        do: async (page, ctx) => {
            const older = historyDialog(page).locator('div.flex.items-center.justify-between', { hasText: 'The 2026 planner' });
            await ctx.click(older.getByRole('button', { name: 'Open in editor' }));
            await page.waitForURL(url => new URL(url).pathname === '/app', { timeout: 30000 });
            await app.editorReady(page);
            await ctx.wait(600);
            await ctx.move(app.projectTab(page, 'Planner 2026'));
            await ctx.atSentence(1);
            await ctx.move(app.canvas(page), { ay: 0.35 });
        },
    },
    {
        say: "That's a planner found, checked and taken home. Next time: what happens when two people change the same thing.",
        hold: 3,
        do: async (page, ctx) => {
            await ctx.atSentence(0, { offset: 1.2 });
            await ctx.endCard();
        },
    },
];
