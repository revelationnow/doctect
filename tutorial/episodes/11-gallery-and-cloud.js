// Episode 11 — Gallery, accounts & cloud history.
// A first visit to the gallery (seeded off camera by two other members):
// search, a project page, Open in editor. Then an account for our recipe book:
// sign up, verify, Save to cloud twice, Version history, Restore, My projects.
import { episodeMeta } from './series.js';
import * as app from '../lib/app.js';
import * as cloud from '../lib/cloud.js';

export const meta = episodeMeta(11, {
    description: 'Everything so far has lived in one browser. This episode steps outside it: the gallery, where people share '
        + 'what they make and anyone can borrow it, and an account, which gives our recipe book a history in the cloud that '
        + 'we can step back through.',
    learn: [
        'Browsing and searching the gallery, no account needed',
        'Open in editor: a copy that is yours',
        'Signing up, verifying, and why the username is public',
        'Cloud saves are deliberate snapshots with a message',
        'Version history and Restore',
        'My projects and the storage meter',
    ],
    docs: ['/docs/gallery/browsing-without-an-account', '/docs/gallery/cloud-saves-and-history'],
    thumbnail: { beat: 11, headline: 'Gallery & cloud' },
});

const { you, sam } = cloud.PEOPLE;

const mealCard = (page) => page.locator('main a', { hasText: /Meal/ }).first();
const detail = (page) => page.getByTestId('modal-backdrop');
const cloudButton = (page) => page.getByTitle('Cloud').first();
const historyDialog = (page) => page.getByRole('dialog', { name: 'Version history' });

/** Opens the Cloud menu and clicks the item named `name`. */
async function cloudItem(ctx, name) {
    await ctx.click(cloudButton(ctx.page));
    await ctx.click(ctx.page.getByRole('button', { name }).first());
}

/** Clicks into a login form field and types into it. */
async function fill(ctx, label, text, wpm = 150) {
    await ctx.click(ctx.page.getByLabel(label, { exact: true }));
    await ctx.type(text, { wpm });
}

export async function setup(ctx) {
    await ctx.goto('/app');
    await app.editorReady(ctx.page);
    await cloud.seedGallery(ctx);
    await app.loadFixture(ctx, '09-recipe-variants');
    await app.sidebarTab(ctx.page, 'Hierarchy').click();
    await ctx.wait(1200);
    await ctx.titleCard();
    await ctx.wait(900);
}

export const beats = [
    {
        chapter: 'Welcome', lowerThird: false,
        say: 'So far, everything we have made has lived in this one browser. This episode steps outside it: '
            + 'the gallery, where people share what they make, and an account, which gives your work a history in the cloud.',
        do: async (page, ctx) => {
            await ctx.wait(2500);
            await ctx.cardOut();
            await ctx.move(page.getByRole('link', { name: 'Gallery', exact: true }).first());
        },
    },
    {
        chapter: 'The gallery',
        say: 'Gallery, at the top, is open to everyone. No account, no sign in. '
            + "It opens on a spotlight, then rows: what's trending, what's new, and a row for each kind of project.",
        do: async (page, ctx) => {
            await ctx.click(page.getByRole('link', { name: 'Gallery', exact: true }).first());
            await page.getByLabel('Search the gallery').waitFor();
            await ctx.wait(800);
            await ctx.atSentence(2);
            await ctx.move(page.getByText('In the spotlight'));
            await ctx.move(page.locator('main h2', { hasText: 'Trending' }).first(), { ax: 0.1 });
        },
    },
    {
        say: "Search reads names, tags and descriptions. I'm after something for dinners, so: meal.",
        do: async (page, ctx) => {
            await ctx.click(page.getByLabel('Search the gallery'));
            await ctx.type('meal', { wpm: 120 });
            await mealCard(page).waitFor();
            await ctx.move(mealCard(page), { ay: 0.4 });
        },
    },
    {
        say: 'Every project has a page: the preview pages its author picked, who made it, and its tags. '
            + 'Download all variants gets every PDF in one zip, and Version history opens any version the author published.',
        do: async (page, ctx) => {
            await ctx.click(mealCard(page), { ay: 0.4 });
            await detail(page).getByRole('button', { name: 'Open in editor' }).waitFor();
            await ctx.move(detail(page).locator('img').first());
            await ctx.move(detail(page).getByRole('link', { name: sam.username }));
            await ctx.atSentence(1);
            await ctx.move(detail(page).getByRole('button', { name: /Download all variants/ }));
            await ctx.move(detail(page).getByRole('button', { name: 'Version history' }), { duration: 900 });
        },
    },
    {
        say: 'Open in editor copies the project into your own editor, as a new tab. The copy is yours: '
            + 'change anything you like, and the original never knows.',
        do: async (page, ctx) => {
            await ctx.click(detail(page).getByRole('button', { name: 'Open in editor' }));
            await app.editorReady(page);
            await ctx.wait(600);
            await ctx.move(page.locator('[data-testid="project-tab"]').last());
            await ctx.atSentence(1);
            await ctx.move(app.canvas(page), { ay: 0.3 });
        },
    },
    {
        chapter: 'An account',
        say: 'Our recipe book, though, is still only in this browser. On its tab, the Cloud menu has just one thing to offer '
            + 'while we are signed out: Sign in to save to cloud.',
        do: async (page, ctx) => {
            await ctx.click(app.projectTab(page, 'Family Recipes'));
            await app.editorReady(page);
            await ctx.atSentence(0, { offset: 3.5 });
            await ctx.click(cloudButton(page));
            await ctx.move(page.getByRole('link', { name: 'Sign in to save to cloud' }));
            await ctx.atSentence(1, { end: true, offset: -0.6 });
            await ctx.click(page.getByRole('link', { name: 'Sign in to save to cloud' }));
            await page.getByRole('heading', { name: 'Sign In' }).waitFor();
        },
    },
    {
        say: 'Sign Up turns the form into Create Account. Your name and your email stay private. '
            + 'The username is public: it is the name the gallery shows on everything you share.',
        do: async (page, ctx) => {
            await ctx.click(page.getByRole('button', { name: 'Sign Up' }));
            await page.getByRole('heading', { name: 'Create Account' }).waitFor();
            await fill(ctx, 'Name', you.name);
            await ctx.atSentence(2);
            await fill(ctx, 'Username', you.username);
            await fill(ctx, 'Email', you.email, 170);
        },
    },
    {
        say: 'The password needs at least twelve characters. Then Sign Up, and instead of signing you in, '
            + 'it sends a link to your email.',
        do: async (page, ctx) => {
            await fill(ctx, 'Password', you.password, 190);
            await ctx.atSentence(1);
            ctx.state.staleLink = ctx.servers.lastVerificationLink();
            await ctx.click(page.getByRole('button', { name: 'Sign Up' }));
            await page.getByRole('heading', { name: 'Verify your email' }).waitFor({ timeout: 15000 });
            await ctx.move(page.getByText(you.email).first());
        },
    },
    {
        say: 'Here it is. Clicking the link confirms the address and signs you in, all in one go.',
        do: async (page, ctx) => {
            const link = await cloud.nextVerificationLink(ctx.servers, ctx.state.staleLink);
            await page.evaluate(() => window.__studio.mail({ from: 'PDF Architect', subject: 'Verify your email address',
                body: 'Click the link below to finish signing in.', action: 'Verify email' }));
            await ctx.wait(900);
            await ctx.human.fakeClick(await page.evaluate(() => {
                const r = window.__studio.mailActionRect();
                return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
            }));
            await ctx.atSentence(1);
            await ctx.goto(link);
            await page.waitForURL(url => new URL(url).pathname === '/app', { timeout: 20000 });
            await app.editorReady(page);
            await ctx.move(page.getByTitle('Account'));
        },
    },
    {
        chapter: 'Saving to the cloud',
        say: "We're back in the editor, signed in, and the Cloud menu now offers Save to cloud. "
            + 'Nothing is ever uploaded behind your back. Each save is a snapshot you choose to make, with a message that says what it is.',
        do: async (page, ctx) => {
            await ctx.wait(500);
            await ctx.click(cloudButton(page));
            await ctx.move(page.getByRole('button', { name: 'Save to cloud (new)' }));
            await ctx.atSentence(2);
            await ctx.dialogs.arm({ text: 'First cloud copy' });
            await ctx.click(page.getByRole('button', { name: 'Save to cloud (new)' }));
            await ctx.dialogs.replay();
            await page.getByRole('button', { name: 'Save to cloud (new)' }).waitFor({ state: 'detached' });
        },
    },
    {
        say: "Let's change something we can see. Tomato Soup becomes Roasted Tomato Soup, and we save again, "
            + 'with a message that says so. The message is for future you: in a few months, '
            + "Roast the tomatoes will still mean something, and Update won't.",
        do: async (page, ctx) => {
            await app.selectNode(ctx, 'Tomato Soup');
            await app.retype(ctx, app.nodeTitleInput(page), 'Roasted Tomato Soup');
            await ctx.atSentence(1);
            await ctx.dialogs.arm({ text: 'Roast the tomatoes' });
            await cloudItem(ctx, 'Save to cloud');
            await ctx.dialogs.replay();
        },
    },
    {
        say: 'Version history lists every save, newest first. The top one is marked HEAD: the latest version in the cloud.',
        do: async (page, ctx) => {
            await cloudItem(ctx, 'Version history');
            await historyDialog(page).getByText('First cloud copy').waitFor();
            await ctx.move(historyDialog(page).getByText('Roast the tomatoes'));
            await ctx.atSentence(1);
            await ctx.move(historyDialog(page).getByText('HEAD'));
        },
    },
    {
        say: 'Restore puts an older version back in the editor. It asks first, because anything you had not saved would be lost. '
            + 'And there is plain Tomato Soup again.',
        do: async (page, ctx) => {
            const older = historyDialog(page).locator('div.flex.items-center.justify-between', { hasText: 'First cloud copy' });
            await ctx.dialogs.arm({});
            await ctx.click(older.getByRole('button', { name: 'Restore' }));
            await ctx.dialogs.replay();
            await historyDialog(page).waitFor({ state: 'detached' });
            await ctx.atSentence(1);
            await ctx.move(app.nodeRow(page, 'Tomato Soup'));
        },
    },
    {
        say: 'Restoring only changed this tab. The cloud still has both versions, and saving now would simply add a third, '
            + 'so you can step back and forth as often as you like.',
        do: async (page, ctx) => {
            await cloudItem(ctx, 'Version history');
            await historyDialog(page).getByText('First cloud copy').waitFor();
            await ctx.move(historyDialog(page).getByText('Roast the tomatoes'));
            await ctx.atSentence(1);
            await ctx.click(historyDialog(page).getByRole('button', { name: 'Close version history' }));
        },
    },
    {
        chapter: 'My projects',
        say: 'Everything the cloud holds for you is on one page: My projects, in the account menu. '
            + 'Each project is private until you publish it, and the bar on top is your storage: fifty megabytes for every account.',
        do: async (page, ctx) => {
            await ctx.click(page.getByTitle('Account'));
            await ctx.click(page.getByRole('link', { name: 'My projects' }));
            await page.getByText('Family Recipes').first().waitFor();
            await ctx.atSentence(1);
            await ctx.move(page.getByText('private', { exact: true }).first());
            await ctx.move(page.getByText(/MB of .* MB used/).first(), { duration: 900 });
        },
    },
    {
        say: 'Next time: publishing the recipe book to the gallery, and what happens when somebody forks it.',
        hold: 3,
        do: async (page, ctx) => {
            await ctx.atSentence(0, { offset: 1.2 });
            await ctx.endCard();
        },
    },
];
