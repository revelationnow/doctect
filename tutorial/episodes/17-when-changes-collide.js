// Episode 17 — When changes collide.
// Jamie's merge request from episode 12 (orange day titles, restaged off camera
// through the API) turns conflicted when Sam, through the API mid-episode, gives
// the same Day template roomier writing lines and publishes them. Why it can't
// merge, closing the stale request, a fresh fork, the change made again, a clean
// request with its before/after preview, and Sam's merge.
import { episodeMeta } from './series.js';
import * as app from '../lib/app.js';
import * as cloud from '../lib/cloud.js';

export const meta = episodeMeta(17, {
    description: 'In episode 12 I asked Sam to merge orange day titles into the meal planner. Sam has been busy too, and '
        + "now my request says conflicted. This episode is about why a merge request turns conflicted, why it can't be merged, "
        + 'and how a fresh fork fixes it.',
    learn: [
        'When a merge request is checked, and why it can turn conflicted later',
        'What counts as the same change: whole templates, and the page hierarchy',
        "Why a conflicted request can't be merged, not even by the owner",
        'Closing a stale request',
        'Forking the latest version and making the change again',
        'A clean request, its before and after, and the merge',
    ],
    docs: ['/docs/reference/merge-conflict', '/docs/gallery/merge-requests-proposing'],
    thumbnail: { beat: 3, headline: 'Merge conflicts' },
});

const { you, sam } = cloud.PEOPLE;
const DAY_TITLE = 'gen_day_0_zed58';   // the Day template's {{title}} (tutorial/fixtures/10-meal-planner.json)
const DAY_LINES = 'gen_day_3_qnb9h';   // its writing lines: lines-h, 24 pt apart
const ORANGE = '#ea580c';              // what episode 12's color pick set

/** An element of the Day template, in the planner's only variant. */
const dayElement = (state, id) => state.variants.default.templates.day.elements.find(e => e.id === id);

/** Off camera, through the API as Jamie: episode 12's fork, change and merge request. */
async function proposeOrangeTitles(ctx, mealsId) {
    const api = await cloud.apiAs(ctx, you);
    const { project: fork } = await api.post(`/api/projects/${mealsId}/fork`, {});
    const { commit } = await api.get(`/api/projects/${fork.id}/commits/${fork.headCommitId}`);
    const state = structuredClone(commit.state);
    dayElement(state, DAY_TITLE).textColor = ORANGE;
    await api.post(`/api/projects/${fork.id}/commits`, { state, message: 'Orange day titles' },
        { 'If-Match': `"${fork.headCommitId}"` });
    const { mergeRequest } = await api.post('/api/merge-requests', {
        sourceProjectId: fork.id, title: 'Orange day titles', description: 'Easier to spot at a glance.',
    });
    return mergeRequest.id;
}

/**
 * Through the API as Sam: the Day template's writing lines go from 24 to 36 points apart,
 * saved, then published under the existing listing (same description, tags and previews).
 */
async function samSpacesTheLines(ctx, mealsId) {
    const api = await cloud.apiSession(ctx, sam);
    const { project } = await api.get(`/api/projects/${mealsId}`);
    const { commit } = await api.get(`/api/projects/${mealsId}/commits/${project.headCommitId}`);
    const state = structuredClone(commit.state);
    dayElement(state, DAY_LINES).patternSpacing = 36;
    const { commit: saved } = await api.post(`/api/projects/${mealsId}/commits`, { state, message: 'Roomier writing lines' },
        { 'If-Match': `"${project.headCommitId}"` });
    const { project: listing } = await api.get(`/api/gallery/${mealsId}`);
    const thumbnails = [];
    for (const preview of listing.previews) {
        const { type, data } = await api.bytes(`/api/thumbnails/${preview.id}`);
        thumbnails.push(`data:${type.split(';')[0]};base64,${data.toString('base64')}`);
    }
    const nodeIds = listing.previews.map(p => p.nodeId);
    await api.post(`/api/projects/${mealsId}/publish`, {
        description: listing.description, tags: listing.tags, thumbnails,
        ...(nodeIds.every(Boolean) ? { previewNodeIds: nodeIds } : {}),
    }, { 'If-Match': `"${saved.id}"` });
}

export async function setup(ctx) {
    await ctx.goto('/app');
    await app.editorReady(ctx.page);
    await cloud.seedGallery(ctx);
    await cloud.signUp(ctx, you);
    ctx.state.mealsId = await cloud.listingId(ctx, 'Meals this week', sam.username);
    ctx.state.firstRequest = await proposeOrangeTitles(ctx, ctx.state.mealsId);
    await ctx.goto(`/mr/${ctx.state.firstRequest}`);
    await ctx.page.getByRole('heading', { name: 'Proposed changes' }).waitFor({ timeout: 30000 });
    await ctx.wait(1200);
    await ctx.titleCard();
    await ctx.wait(900);
}

const badge = (page) => page.locator('main h1 + span');
const guidance = (page) => page.locator('main p.text-sm.text-slate-500').first();
const changesBox = (page) => page.locator('main div.bg-white.border.rounded-xl', { has: page.getByRole('heading', { name: 'Proposed changes' }) });
const changeRow = (page) => page.getByText('~ Template modified: default/day');
const conflicts = (page) => page.locator('main div.bg-red-50');
const conflictRow = (page) => conflicts(page).locator('li').first();
const hint = (page) => page.getByText('The fork author should fork the latest version again and re-apply their changes.');
const closeButton = (page) => page.getByRole('button', { name: 'Close', exact: true });
const detail = (page) => page.getByTestId('modal-backdrop');
const cloudButton = (page) => page.getByTitle('Cloud').first();
const proposeDialog = (page) => page.getByRole('dialog', { name: 'Propose changes to upstream' });

/** Waits until the status badge reads `status` (it is lowercase in the page, shown in capitals). */
const status = (page, s) => badge(page).filter({ hasText: new RegExp(`^${s}$`) }).waitFor({ timeout: 20000 });

/** The F5 chip, then a reload of the same address (headless Chromium ignores a dispatched F5). */
async function reload(ctx) {
    await ctx.showKeys(['F5']);
    await ctx.wait(600);
    await ctx.goto(ctx.page.url());
}

/** Opens the Cloud menu and clicks the item named `name`. */
async function cloudItem(ctx, name) {
    await ctx.click(cloudButton(ctx.page));
    await ctx.click(ctx.page.getByRole('button', { name }).first());
}

export const beats = [
    {
        chapter: 'Welcome', lowerThird: false,
        say: 'In episode twelve, I asked Sam to merge orange day titles into the meal planner. Sam hasn\'t yet, and has been busy too. '
            + 'This time: what happens when two people change the same thing.',
        do: async (page, ctx) => {
            await ctx.wait(2500);
            await ctx.cardOut();
            await ctx.move(badge(page));
            await ctx.atSentence(1);
            await ctx.move(guidance(page), { ax: 0.3 });
            await ctx.atSentence(2);
            await ctx.move(changeRow(page), { ax: 0.3 });
        },
    },
    {
        chapter: 'A conflict',
        say: "Here's what Sam did meanwhile: roomier writing lines on the Day pages, saved and then published as a new version. "
            + "I'll reload my request's page.",
        do: async (page, ctx) => {
            await samSpacesTheLines(ctx, ctx.state.mealsId);
            await ctx.move(page.getByRole('heading', { name: 'Orange day titles' }), { ax: 0.8 });
            await ctx.atSentence(1);
            await reload(ctx);
            await page.getByRole('heading', { name: 'Proposed changes' }).waitFor({ timeout: 30000 });
        },
    },
    {
        say: "It says conflicted now. Sam's save didn't change my request. A request is checked when it's made, every time its page opens, "
            + 'and when the owner presses Merge. So one that was fine last week can be conflicted today.',
        do: async (page, ctx) => {
            await status(page, 'conflicted');
            await ctx.move(badge(page));
            await ctx.atSentence(2);
            await ctx.move(badge(page), { ax: 0.35, ay: 0.8 });
        },
    },
    {
        say: "The line under the title says it can't be merged as-is. The red Conflicts box says why: "
            + 'the Day template, in the default variant, was changed on both sides.',
        do: async (page, ctx) => {
            await ctx.move(guidance(page), { ax: 0.05 });
            await ctx.move(guidance(page), { ax: 0.62, duration: 1600 });
            await ctx.atSentence(1);
            await ctx.move(conflicts(page).getByText('Conflicts'));
            await ctx.move(conflictRow(page), { ax: 0.5, duration: 1200 });
        },
    },
    {
        say: "We didn't touch the same thing on the page: I colored the title, Sam spaced out the lines. "
            + 'But changes are compared a whole template at a time, so two different edits to the Day template collide. '
            + "An edit to the Week page wouldn't have.",
        do: async (page, ctx) => {
            await ctx.move(changeRow(page), { ax: 0.4 });
            await ctx.atSentence(1, { offset: 1.5 });
            await ctx.move(conflictRow(page), { ax: 0.4 });
        },
    },
    {
        say: "The page hierarchy is a single unit too, including what's typed into the pages. If we'd both added a page, "
            + 'that would collide as well.',
        do: async (page, ctx) => {
            const box = await changesBox(page).boundingBox();
            const around = [[0.08, 0.12], [0.6, 0.06], [0.95, 0.4], [0.7, 0.92], [0.15, 0.85], [0.06, 0.3]];
            for (const [fx, fy] of around) {
                await ctx.move({ x: box.x + box.width * fx, y: box.y + box.height * fy }, { duration: 700 });
            }
        },
    },
    {
        chapter: "Why it won't merge",
        say: "Here's why it can't merge. Merging doesn't copy my fork over Sam's project. "
            + "It takes what I changed since forking, the Day template, and lays it over Sam's latest version. "
            + 'That would quietly undo the new lines.',
        do: async (page, ctx) => {
            await ctx.spotlight(changesBox(page), '', 8);
            await ctx.atSentence(2);
            await ctx.move(changeRow(page), { ax: 0.4 });
        },
    },
    {
        say: 'So nothing is merged by guesswork. A conflicted request has no Merge button, not even for Sam, only Close. '
            + 'And the server checks again before any merge.',
        do: async (page, ctx) => {
            await ctx.unspotlight();
            await ctx.atSentence(1);
            await ctx.move(closeButton(page));
        },
    },
    {
        chapter: 'Starting again',
        say: "There's no button that fixes a conflict. As the page says, I fork the latest version and propose my changes again: "
            + "that's the fork author's job. First, I'll close this request: it can't be merged as it stands.",
        do: async (page, ctx) => {
            await ctx.move(conflicts(page), { ax: 0.75, ay: 0.3 });
            await ctx.atSentence(1);
            await ctx.move(guidance(page), { ax: 0.72 });
            await ctx.atSentence(1, { offset: 3.6 });
            await ctx.move(hint(page), { ax: 0.35 });
            await ctx.atSentence(2);
            await ctx.dialogs.arm({});
            await ctx.click(closeButton(page));
            await ctx.dialogs.replay();
            await status(page, 'closed');
            await ctx.move(badge(page));
        },
    },
    {
        say: "Then I fork Sam's planner again. Fork copies the published version, so the new lines come with it. "
            + 'Had Sam only saved them, a new request would be conflicted the moment I made it.',
        do: async (page, ctx) => {
            await ctx.click(page.locator('main a', { hasText: 'Meals this week' }).first());
            const fork = detail(page).getByRole('button', { name: 'Fork this project' });
            await fork.waitFor();
            await ctx.atSentence(1);
            await ctx.click(fork);
            await app.editorReady(page);
            await ctx.wait(700);
            await ctx.move(page.locator('[data-testid="project-tab"]').last());
        },
    },
    {
        say: "In Templates, the Day template already has Sam's roomier lines. Now I make my change again, on top of Sam's: the title, orange.",
        do: async (page, ctx) => {
            await ctx.click(app.sidebarTab(page, 'Templates'));
            await app.selectTemplate(ctx, 'Day');
            await ctx.move(await app.pagePoint(page, 300, 180));
            await ctx.move(await app.pagePoint(page, 300, 560), { duration: 1600 });
            await ctx.atSentence(1);
            await ctx.click(await app.pagePoint(page, 120, 64));
            const ty = app.section(page, 'typography');
            await ty.scrollIntoViewIfNeeded();
            await ctx.pickColor(ty.locator('input[type=color]').first(), ORANGE);
        },
    },
    {
        say: "Save to cloud first, because a request always proposes the latest save, never what's only in this tab. "
            + 'Then Propose changes to upstream. '
            + "The note tells Sam it's the same change, redone on top of Sam's.",
        do: async (page, ctx) => {
            await ctx.dialogs.arm({ text: 'Orange day titles, on the new lines' });
            await cloudItem(ctx, 'Save to cloud');
            await ctx.dialogs.replay({ typeWpm: 280 });
            await page.getByRole('button', { name: 'Save to cloud' }).waitFor({ state: 'detached' });
            await ctx.atSentence(1);
            await cloudItem(ctx, 'Propose changes to upstream…');
            await proposeDialog(page).waitFor();
            await ctx.click(proposeDialog(page).getByPlaceholder("Title, e.g. 'Add iPad variant'"));
            await ctx.type('Orange day titles', { wpm: 240 });
            await ctx.click(proposeDialog(page).getByPlaceholder('What changed and why?'));
            await ctx.type('Re-applied on top of your roomier lines.', { wpm: 280 });
            await ctx.move(proposeDialog(page).getByRole('button', { name: 'Create merge request' }));
        },
    },
    {
        chapter: 'A clean request',
        say: 'The new request is open: the same single change, and no conflicts. '
            + "Render before and after shows Sam's current page, then the same page with my title.",
        do: async (page, ctx) => {
            await ctx.click(proposeDialog(page).getByRole('button', { name: 'Create merge request' }));
            await page.waitForURL(url => new URL(url).pathname.startsWith('/mr/'), { timeout: 20000 });
            ctx.state.secondRequest = new URL(page.url()).pathname.split('/').pop();
            await page.getByRole('heading', { name: 'Proposed changes' }).waitFor({ timeout: 30000 });
            await status(page, 'open');
            await ctx.move(badge(page));
            await ctx.move(changeRow(page), { ax: 0.4 });
            await ctx.atSentence(1);
            await ctx.click(page.getByRole('button', { name: 'Render before/after preview' }));
            await page.getByAltText('after').waitFor({ timeout: 30000 });
            await ctx.move(page.getByAltText('before'), { ay: 0.3 });
        },
    },
    {
        say: "When Sam merges, my change set is laid over Sam's latest version. "
            + 'I made it on top of that, so both survive: roomy lines, orange titles.',
        do: async (page, ctx) => {
            await ctx.move(page.getByAltText('before'), { ax: 0.4, ay: 0.55 });
            await ctx.atSentence(1);
            await ctx.move(page.getByAltText('after'), { ax: 0.35, ay: 0.12 });
            await ctx.move(page.getByAltText('after'), { ax: 0.5, ay: 0.55, duration: 900 });
        },
    },
    {
        say: 'Sam merges it from the other side. One reload, and my request says merged.',
        hold: 2.5,
        do: async (page, ctx) => {
            const asSam = await cloud.apiSession(ctx, sam);
            await asSam.post(`/api/merge-requests/${ctx.state.secondRequest}/merge`, {});
            await ctx.atSentence(1);
            await reload(ctx);
            await status(page, 'merged');
            await ctx.move(badge(page));
            await ctx.move(guidance(page), { ax: 0.4 });
        },
    },
    {
        say: 'So: requests are checked every time they open, conflicts are never merged by guesswork, '
            + 'and the fork author fixes them with a fresh fork. Next time: reaching elements buried under others.',
        hold: 3,
        do: async (page, ctx) => {
            await ctx.atSentence(1, { offset: 0.3 });
            await ctx.endCard();
        },
    },
];
