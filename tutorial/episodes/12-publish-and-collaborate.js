// Episode 12 — Publishing, forks & merge requests.
// The recipe book (in the cloud since episode 11) goes public. We fork Sam's
// meal planner and propose a change to it; Sam forks the book and proposes a
// recipe (staged off camera through the API, mid-episode); we review and merge
// it, then bring the merge into the editor with Reload cloud version.
import { episodeMeta } from './series.js';
import * as app from '../lib/app.js';
import * as cloud from '../lib/cloud.js';

export const meta = episodeMeta(12, {
    description: 'Our recipe book has a history in the cloud, but only we can see it. This time we share it: publish it to the '
        + "gallery, fork someone else's project and propose a change to it, then review and merge a change a friend proposes "
        + 'to ours, and bring it safely into the editor.',
    learn: [
        'Publishing: description, tags and preview pages',
        'Your listing, and Edit listing',
        'Forking: a copy that remembers where it came from',
        'Proposing changes with a merge request',
        'Reviewing: the change list and the before and after preview',
        'Merging, and Reload cloud version',
    ],
    docs: ['/docs/gallery/publishing', '/docs/gallery/merge-requests-reviewing'],
    thumbnail: { beat: 13, headline: 'Forks & merges' },
});

const { you, sam } = cloud.PEOPLE;

const detail = (page) => page.getByTestId('modal-backdrop');
const cloudButton = (page) => page.getByTitle('Cloud').first();
const publishDialog = (page) => page.getByRole('dialog', { name: 'Publish to gallery' });
const proposeDialog = (page) => page.getByRole('dialog', { name: 'Propose changes to upstream' });
const card = (page, name) => page.locator('main a', { hasText: name }).first();

/** Opens the Cloud menu and clicks the item named `name`. */
async function cloudItem(ctx, name) {
    await ctx.click(cloudButton(ctx.page));
    await ctx.click(ctx.page.getByRole('button', { name }).first());
}

/**
 * Off camera, through the API as Sam: fork the published recipe book, add a
 * Shakshuka page in the fork, and propose it back as a merge request.
 */
async function samProposesARecipe(ctx) {
    const api = await cloud.apiAs(ctx, sam);
    const { items } = await api.get('/api/gallery?q=Family%20Recipes');
    const target = items.find(i => i.author === you.username);
    const { project: fork } = await api.post(`/api/projects/${target.id}/fork`, {});
    const { commit } = await api.get(`/api/projects/${fork.id}/commits/${fork.headCommitId}`);
    const state = structuredClone(commit.state);
    const recipe = Object.values(state.nodes).find(n => n.title === 'Tomato Soup');
    state.nodes.node_shakshuka = {
        id: 'node_shakshuka', parentId: state.rootId, type: recipe.type, title: 'Shakshuka',
        data: { servings: '4', time: '30 minutes', author: 'Sam' }, children: [],
    };
    state.nodes[state.rootId].children.push('node_shakshuka');
    await api.post(`/api/projects/${fork.id}/commits`, { state, message: 'Add a Shakshuka recipe' },
        { 'If-Match': `"${fork.headCommitId}"` });
    await api.post('/api/merge-requests', {
        sourceProjectId: fork.id, title: 'Add a Shakshuka recipe',
        description: 'Eggs poached in a spiced tomato sauce. Our Sunday favourite.',
    });
}

export async function setup(ctx) {
    await ctx.goto('/app');
    await app.editorReady(ctx.page);
    await cloud.seedGallery(ctx);
    await cloud.signUp(ctx, you);
    await app.loadFixture(ctx, '09-recipe-variants');
    await app.sidebarTab(ctx.page, 'Hierarchy').click();
    await cloud.saveToCloud(ctx, 'First cloud copy');
    // that save's prompt must not be acted out by the first replay on camera
    await ctx.page.evaluate(() => { window.__studioDialogs.log.length = 0; });
    await ctx.wait(1200);
    await ctx.titleCard();
    await ctx.wait(900);
}

export const beats = [
    {
        chapter: 'Welcome', lowerThird: false,
        say: 'Our recipe book has a history in the cloud now, but only we can see it. This episode is about sharing: '
            + "publishing to the gallery, forking someone else's work, and taking in changes a friend proposes to ours.",
        do: async (page, ctx) => {
            await ctx.wait(2500);
            await ctx.cardOut();
            await ctx.move(cloudButton(page));
        },
    },
    {
        chapter: 'Publishing',
        say: 'Publish to gallery, in the Cloud menu, puts the latest cloud version on a public page. '
            + 'A description and a few tags are how people will find it: search reads both, and every tag becomes a link '
            + "to everything else that shares it. There's no category to pick. The gallery works that out from the tags and the name.",
        do: async (page, ctx) => {
            await cloudItem(ctx, 'Publish to gallery…');
            await publishDialog(page).waitFor();
            await ctx.atSentence(1);
            await ctx.click(publishDialog(page).getByPlaceholder('What is this planner for?'));
            await ctx.type('Family recipes for A4 and the reMarkable: a cover with an index, and a page for every dish.', { wpm: 230 });
            await ctx.click(publishDialog(page).getByPlaceholder('planner, 2026, remarkable'));
            await ctx.type('recipes, cooking, remarkable', { wpm: 190 });
        },
    },
    {
        say: 'Then the preview pages, up to six. The first one you tick becomes the cover on the gallery card, '
            + "and the cover page is ticked already. I'll add Tomato Soup.",
        do: async (page, ctx) => {
            await ctx.move(publishDialog(page).getByText('Preview pages (up to 6)'));
            await ctx.atSentence(2);
            await ctx.click(publishDialog(page).locator('label', { hasText: 'Tomato Soup' }).locator('input'));
        },
    },
    {
        say: 'Publish draws the previews, uploads them, and the book is live. '
            + 'Each preview is a real render of the page, made in your browser, so a big project takes a moment.',
        do: async (page, ctx) => {
            await ctx.click(publishDialog(page).getByRole('button', { name: 'Publish', exact: true }));
            await publishDialog(page).waitFor({ state: 'detached', timeout: 60000 });
            await ctx.dialogs.replay();
        },
    },
    {
        say: "Here it is in the gallery, under New. Its page shows exactly what we chose. And because it's ours, there's an "
            + 'Edit listing button, which changes the description, tags and previews without publishing anything new.',
        do: async (page, ctx) => {
            await ctx.click(page.getByRole('link', { name: 'Gallery', exact: true }).first());
            await page.getByLabel('Search the gallery').waitFor();
            const ours = page.locator('main section', { has: page.locator('h2', { hasText: /New$/ }) })
                .locator('a', { hasText: 'Family Recipes' }).first();
            await ctx.move(ours, { ay: 0.4 });
            await ctx.atSentence(1);
            await ctx.click(ours, { ay: 0.4 });
            await detail(page).getByRole('button', { name: 'Open in editor' }).waitFor();
            await ctx.move(detail(page).locator('img').first());
            await ctx.atSentence(2);
            await ctx.move(detail(page).getByRole('button', { name: 'Edit listing' }));
        },
    },
    {
        say: 'One thing to remember: the gallery shows the version you published. '
            + 'Anything you save after that stays private, until you publish again.',
        do: async (page, ctx) => {
            await ctx.move(detail(page).getByRole('heading', { name: 'Family Recipes' }));
            await ctx.atSentence(1);
            await ctx.move(detail(page).getByRole('button', { name: 'Version history' }));
        },
    },
    {
        chapter: 'Forking',
        say: "Now someone else's work. Sam's meal planner could do with brighter day titles. "
            + 'Signed in, its page offers one more button: Fork this project.',
        do: async (page, ctx) => {
            await ctx.press('Escape');
            await ctx.click(page.getByLabel('Search the gallery'));
            await ctx.type('meal', { wpm: 120 });
            await page.getByLabel('Remove filter “meal”').waitFor(); // the results have replaced the home rows
            await ctx.wait(400);
            await ctx.click(card(page, /Meal/), { ay: 0.4 });
            await detail(page).getByRole('button', { name: 'Fork this project' }).waitFor();
            await ctx.atSentence(1);
            await ctx.move(detail(page).getByRole('button', { name: 'Fork this project' }));
        },
    },
    {
        say: 'A fork is a copy in your own cloud that remembers where it came from. It opens in the editor like any other project.',
        do: async (page, ctx) => {
            await ctx.click(detail(page).getByRole('button', { name: 'Fork this project' }));
            await app.editorReady(page);
            await ctx.wait(700);
            await ctx.move(page.locator('[data-testid="project-tab"]').last());
            await ctx.move(app.canvas(page), { ay: 0.3 });
        },
    },
    {
        say: "The Cloud menu knows the difference. It says this is forked from upstream, with a link back to Sam's page, "
            + 'and it offers Propose changes to upstream.',
        do: async (page, ctx) => {
            await ctx.click(cloudButton(page));
            await ctx.move(page.getByRole('link', { name: /forked from upstream/ }));
            await ctx.atSentence(1);
            await ctx.move(page.getByRole('button', { name: 'Propose changes to upstream…' }));
            await ctx.wait(1200);
            await ctx.click(cloudButton(page));
        },
    },
    {
        say: "First, the change itself. In Templates, I'll open the Day template and select its title. Orange, from the color picker. "
            + "Then it has to be saved to the cloud, because a merge request always proposes your latest save, never what's only in this tab.",
        do: async (page, ctx) => {
            await ctx.click(app.sidebarTab(page, 'Templates'));
            await app.selectTemplate(ctx, 'Day');
            await ctx.click(await app.pagePoint(page, 120, 64));
            const ty = app.section(page, 'typography');
            await ty.scrollIntoViewIfNeeded();
            await ctx.atSentence(2);
            await ctx.pickColor(ty.locator('input[type=color]').first(), '#ea580c');
            await ctx.atSentence(3);
            await ctx.dialogs.arm({ text: 'Orange day titles' });
            await cloudItem(ctx, 'Save to cloud');
            await ctx.dialogs.replay();
        },
    },
    {
        say: 'Propose changes to upstream asks for a title and a short note about what changed, and why. '
            + "Sam will read it before he sees a single page, so write it the way you'd want to receive it.",
        do: async (page, ctx) => {
            await cloudItem(ctx, 'Propose changes to upstream…');
            await proposeDialog(page).waitFor();
            await ctx.click(proposeDialog(page).getByPlaceholder("Title, e.g. 'Add iPad variant'"));
            await ctx.type('Orange day titles', { wpm: 170 });
            await ctx.click(proposeDialog(page).getByPlaceholder('What changed and why?'));
            await ctx.type('Easier to spot at a glance.', { wpm: 190 });
            await ctx.click(proposeDialog(page).getByRole('button', { name: 'Create merge request' }));
            await page.waitForURL(url => new URL(url).pathname.startsWith('/mr/'), { timeout: 20000 });
        },
    },
    {
        say: "That makes a merge request, with a page of its own. It lists the changes, here one template, and it waits for Sam: "
            + "he can merge it, or close it. It's his project, so it's his call.",
        do: async (page, ctx) => {
            await page.getByRole('heading', { name: 'Proposed changes' }).waitFor();
            await ctx.move(page.getByText(/Template modified/).first());
            await ctx.atSentence(1);
            await ctx.move(page.getByText('open', { exact: true }).first());
        },
    },
    {
        chapter: 'Reviewing a merge request',
        say: 'Meanwhile, Sam forked our book too. He added a recipe, and proposed it back to us. '
            + 'Merge requests for your projects are listed on their gallery pages, where only you can see them.',
        do: async (page, ctx) => {
            await samProposesARecipe(ctx);
            await ctx.click(page.getByRole('link', { name: 'Gallery', exact: true }).first());
            await page.getByLabel('Search the gallery').waitFor();
            await ctx.click(card(page, 'Family Recipes'), { ay: 0.4 });
            const requests = detail(page).getByRole('heading', { name: 'Merge requests' });
            await requests.waitFor();
            await ctx.atSentence(1);
            await requests.scrollIntoViewIfNeeded();
            await ctx.move(detail(page).getByRole('link', { name: /Add a Shakshuka recipe/ }));
        },
    },
    {
        say: 'Its page lists what changed: the page hierarchy, because Sam added a page. '
            + 'Render before and after draws a page both ways, so you can see the change, not just read about it.',
        do: async (page, ctx) => {
            await ctx.click(detail(page).getByRole('link', { name: /Add a Shakshuka recipe/ }));
            await page.getByRole('heading', { name: 'Proposed changes' }).waitFor();
            await ctx.move(page.getByText(/Page hierarchy/).first());
            await ctx.atSentence(1);
            await ctx.click(page.getByRole('button', { name: 'Render before/after preview' }));
            await page.getByAltText('after').waitFor({ timeout: 30000 });
            await ctx.move(page.getByAltText('before'));
            await ctx.move(page.getByAltText('after'), { duration: 900 });
        },
    },
    {
        say: "Merge makes a new version of our project with Sam's recipe in it. It asks first.",
        do: async (page, ctx) => {
            await ctx.dialogs.arm({});
            await ctx.click(page.getByRole('button', { name: 'Merge', exact: true }));
            await ctx.dialogs.replay();
            await page.getByText('merged', { exact: true }).first().waitFor({ timeout: 20000 });
            await ctx.move(page.getByText('merged', { exact: true }).first());
        },
    },
    {
        chapter: 'Bringing it home',
        say: "The merge happened in the cloud. The book open in our editor hasn't changed, and that's on purpose: "
            + 'nothing changes your work behind your back. Try to save, and the cloud says it has moved on, and overwrites nothing.',
        do: async (page, ctx) => {
            await ctx.click(page.getByRole('link', { name: 'Editor', exact: true }).first());
            await app.editorReady(page);
            await ctx.click(app.projectTab(page, 'Family Recipes'));
            await app.editorReady(page);
            await ctx.atSentence(2);
            await ctx.dialogs.arm({ text: 'Update' });
            await cloudItem(ctx, 'Save to cloud');
            await ctx.dialogs.replay();
            await ctx.move(page.getByText(/Cloud project changed since your last save/));
        },
    },
    {
        say: "Reload cloud version brings the merged book into the editor. And there's Sam's Shakshuka: "
            + "on the cover's index, and as a page of its own.",
        do: async (page, ctx) => {
            await ctx.click(page.getByRole('button', { name: 'Reload cloud version' }));
            await app.editorReady(page);
            await ctx.click(app.sidebarTab(page, 'Hierarchy'));
            await app.selectNode(ctx, 'Family Recipes');
            await ctx.atSentence(1);
            await ctx.move(app.nodeRow(page, 'Shakshuka'));
            await ctx.move(app.canvas(page), { ay: 0.55 });
        },
    },
    {
        say: "Because the book is published, the merge has already updated it in the gallery: anyone who opens or downloads it "
            + "gets Sam's recipe. That's the core series. The in-depth episodes start next, with every kind of link.",
        hold: 3,
        do: async (page, ctx) => {
            await ctx.atSentence(1, { offset: 0.3 });
            await ctx.endCard();
        },
    },
];
