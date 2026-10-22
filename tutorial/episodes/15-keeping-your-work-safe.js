// Episode 15 — Keeping your work safe.
// Where projects live (tabs, Saved locally, a reload), what closing a tab does
// (Close without Saving on a fresh planner, Save JSON & Close on the recipe
// book), bringing the book back from its JSON file through the JSON editor,
// then a cloud save, a Close without Saving that loses nothing, and My
// projects' Open bringing the cookbook back as a tab still linked to its cloud
// project.
import fs from 'node:fs';
import path from 'node:path';
import { episodeMeta } from './series.js';
import * as app from '../lib/app.js';
import * as cloud from '../lib/cloud.js';

export const meta = episodeMeta(15, {
    description: 'Everything you make lives in your browser, and it saves as you work. This episode is about what that means: '
        + 'tabs and the Saved locally badge, what closing a tab really removes, Save JSON & Close and how to bring a project '
        + 'back from its file, and a cloud save that My projects can open in any browser where you sign in.',
    learn: [
        'Project tabs, and what each one keeps',
        'Saved locally: when your work is saved, and where',
        'What closing a tab removes, and Save JSON & Close',
        'Bringing a project back from its JSON file',
        'A cloud save, and opening it again from My projects',
    ],
    docs: ['/docs/reference/project-tabs', '/docs/reference/my-projects'],
    thumbnail: { beat: 6, headline: 'Keep your work safe' },
});

const { you } = cloud.PEOPLE;

const badge = (page) => page.locator('header > [role="status"]').first();
const cloudButton = (page) => page.getByTitle('Cloud').first();
const closeX = (page, name) => app.projectTab(page, name).locator('button[title="Close Project"]');
const closeDialog = (page) => page.locator('div.fixed', { has: page.getByRole('heading', { name: 'Close Project?' }) }).first();
const dialogButton = (page, name) => closeDialog(page).getByRole('button', { name, exact: true });
const jsonEditor = (page) => page.locator('.editor-dialog-panel', { has: page.locator('h2:text-is("Project JSON Editor")') }).first();
const projectRow = (page, name) => page.locator('main li', { hasText: name }).first();

/** Waits until the badge reads Saved locally (any pending write has landed). */
const savedLocally = (page) => badge(page).filter({ hasText: 'Saved locally' }).waitFor({ timeout: 30000 });

/** The on-screen box of the first `needle` in the text inside `selector` (a word in a line, not the whole element). */
async function textBox(page, selector, needle) {
    const box = await page.evaluate(([sel, text]) => {
        const walker = document.createTreeWalker(document.querySelector(sel), NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const i = n.data.indexOf(text);
            if (i < 0) continue;
            const range = document.createRange();
            range.setStart(n, i);
            range.setEnd(n, i + text.length);
            const r = range.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
        }
        return null;
    }, [selector, needle]);
    if (!box) throw new Error(`no "${needle}" in ${selector}`);
    return box;
}

/** Hovers a tab until its cross shows, then clicks the cross; resolves once the dialog is up. */
async function closeTab(ctx, name) {
    await ctx.hover(app.projectTab(ctx.page, name), 450);
    await ctx.click(closeX(ctx.page, name));
    await closeDialog(ctx.page).waitFor();
}

export async function setup(ctx) {
    const { page } = ctx;
    await ctx.goto('/app');
    await app.editorReady(page);
    await cloud.signUp(ctx, you);
    await app.loadFixture(ctx, '09-recipe-variants');
    await app.sidebarTab(page, 'Hierarchy').click();
    await cloud.newProject(ctx, '2026 Planner');
    await app.projectTab(page, 'Family Recipes').click();
    await app.editorReady(page);
    await app.nodeRow(page, 'Family Recipes').waitFor();
    await ctx.wait(800);
    await savedLocally(page);
    await ctx.wait(1200);
    await ctx.titleCard();
    await ctx.wait(900);
}

export const beats = [
    {
        chapter: 'Welcome', lowerThird: false,
        say: 'Everything you make here lives in your browser, and it saves as you work. '
            + 'This episode is about what that means, the one place it can bite, and how to keep a copy somewhere safer.',
        do: async (page, ctx) => {
            await ctx.wait(2500);
            await ctx.cardOut();
            await ctx.move(badge(page));
            await ctx.atSentence(1, { offset: 1.5 });
            await ctx.move(app.projectTab(page, 'Family Recipes'));
        },
    },
    {
        chapter: 'Tabs',
        say: "Every open project is a tab: here's the recipe book, and here's the 2026 planner. "
            + "Each one keeps its own page, zoom and undo history while you're away.",
        do: async (page, ctx) => {
            await ctx.move(app.projectTab(page, 'Family Recipes'), { ax: 0.4 });
            await ctx.atSentence(0, { offset: 2.6 });
            await ctx.click(app.projectTab(page, 'Planner 2026'), { ax: 0.4 });
            await app.editorReady(page);
            await ctx.atSentence(1, { offset: 0.8 });
            await ctx.click(app.projectTab(page, 'Family Recipes'), { ax: 0.4 });
            await app.editorReady(page);
            await ctx.move(app.nodeRow(page, 'Family Recipes'));
        },
    },
    {
        say: "The plus opens New Project, from episode one. Each tab shows its project's name, "
            + 'and renaming the top page in the tree renames the tab.',
        do: async (page, ctx) => {
            await ctx.move(page.locator('button[title="New Project"]').first());
            await ctx.atSentence(1);
            await ctx.move(app.projectTab(page, 'Family Recipes'), { ax: 0.4 });
            await ctx.atSentence(1, { offset: 1.6 });
            await ctx.move(app.nodeRow(page, 'Family Recipes'));
        },
    },
    {
        chapter: 'Saved locally',
        say: 'Watch the badge beside the tabs while I rename this to Family Cookbook. '
            + 'Saving locally while I type, then Saved locally.',
        do: async (page, ctx) => {
            await ctx.spotlight(badge(page), '', 6);
            await ctx.atSentence(0, { offset: 0.5 });
            await ctx.click(app.nodeTitleInput(page));
            await ctx.press('Control+a');
            await ctx.type('Family Cookbook', { wpm: 60 });
            await savedLocally(page);
        },
    },
    {
        say: "There's nothing to press. Every change is written into this browser's own storage a moment later. "
            + 'Reload, and both tabs come straight back.',
        do: async (page, ctx) => {
            await ctx.unspotlight();
            await ctx.move(app.canvas(page), { ay: 0.3 });
            await ctx.atSentence(2, { offset: -0.3 });
            await savedLocally(page);
            await ctx.showKeys(['F5']);
            await ctx.wait(400);
            await ctx.goto('/app');
            await app.editorReady(page);
            await ctx.move(app.projectTab(page, 'Planner 2026'), { ax: 0.4 });
        },
    },
    {
        say: "Locally is the word to notice. It means this browser, on this computer. Clear the site's data, or switch computers, "
            + "and these tabs won't be there. Nor will any presets you've saved.",
        do: async (page, ctx) => {
            await ctx.spotlight(badge(page), '', 6);
            await ctx.move(badge(page));
            await ctx.atSentence(2);
            await ctx.unspotlight();
            await ctx.move(app.projectTab(page, 'Family Cookbook'), { ax: 0.08 });
            await ctx.move(app.projectTab(page, 'Planner 2026'), { ax: 0.92, duration: 1500 });
            await ctx.atSentence(3);
            await ctx.move(page.locator('button[title="New Project"]').first());
        },
    },
    {
        chapter: 'Closing a tab',
        say: 'Closing a tab is where work gets lost, so the app asks first. Hover a tab, and its cross appears.',
        do: async (page, ctx) => {
            await ctx.atSentence(1);
            await closeTab(ctx, 'Planner 2026');
        },
    },
    {
        say: 'As it says, closing removes the whole project from this browser, and Close without Saving keeps no copy. '
            + "This planner came straight from a preset, so here that's fine.",
        do: async (page, ctx) => {
            const text = closeDialog(page).locator('p.font-medium').locator('..');
            await ctx.spotlight(text, '', 8);
            await ctx.atSentence(0, { offset: 3.2 });
            await ctx.move(dialogButton(page, 'Close without Saving'));
            await ctx.atSentence(1, { offset: 1.9 });
            await ctx.unspotlight();
            await ctx.click(dialogButton(page, 'Close without Saving'));
            await closeDialog(page).waitFor({ state: 'detached' });
            await app.projectTab(page, 'Planner 2026').waitFor({ state: 'detached' });
        },
    },
    {
        say: "Anything you've worked on deserves Save JSON & Close. It downloads the project as one file, then closes the tab.",
        do: async (page, ctx) => {
            await closeTab(ctx, 'Family Cookbook');
            await ctx.move(dialogButton(page, 'Save JSON & Close'));
            await ctx.atSentence(1);
            ctx.state.json = await ctx.download(() => ctx.click(dialogButton(page, 'Save JSON & Close')));
            await app.projectTab(page, 'Blank Project').waitFor();
            await app.editorReady(page);
        },
    },
    {
        say: "Closing the last tab leaves a blank project behind. And here's the file: plain text, holding every page, template and variant. "
            + "Keep it somewhere that isn't this browser.",
        do: async (page, ctx) => {
            await ctx.move(app.projectTab(page, 'Blank Project'), { ax: 0.4 });
            await savedLocally(page);
            await ctx.atSentence(1);
            await ctx.openFile(ctx.state.json, { title: path.basename(ctx.state.json) });
            await ctx.move(await textBox(page, 'pre', '"nodes"'), { ax: 0.9 });
            await ctx.move(await textBox(page, 'pre', '"Family Cookbook"'), { ax: 0.95, duration: 900 });
        },
    },
    {
        chapter: 'Getting it back',
        say: 'The app has no Open button for these files. Instead, copy the whole file, and paste it into the JSON editor, in a fresh tab.',
        do: async (page, ctx) => {
            await ctx.atSentence(1);
            // Ctrl+A as a text editor does it: the file's text only (a page-wide select-all
            // would also highlight the chapter lower third on the overlay)
            await ctx.showKeys(['Ctrl', '+', 'A']);
            await page.evaluate(() => {
                const range = document.createRange();
                range.selectNodeContents(document.querySelector('pre'));
                getSelection().removeAllRanges();
                getSelection().addRange(range);
            });
            await ctx.wait(450);
            await ctx.press('Control+c');
            await ctx.wait(500);
            await ctx.goto('/app');
            await app.editorReady(page);
            await ctx.click(app.pane(page).getByRole('button', { name: 'JSON', exact: true }));
            await jsonEditor(page).waitFor();
            await ctx.click(jsonEditor(page).getByRole('button', { name: 'Text', exact: true }));
        },
    },
    {
        say: 'In Text mode, select all, paste, and Apply Changes. The recipe book is back, and the tab reads Family Cookbook again.',
        do: async (page, ctx) => {
            const editor = jsonEditor(page);
            await ctx.click(editor.locator('textarea'), { ay: 0.3 });
            await ctx.press('Control+a');
            await ctx.paste(fs.readFileSync(ctx.state.json, 'utf8'));
            await ctx.click(editor.getByRole('button', { name: 'Apply Changes', exact: true }));
            await editor.waitFor({ state: 'detached' });
            await app.projectTab(page, 'Family Cookbook').waitFor();
            await ctx.atSentence(1);
            await ctx.move(app.nodeRow(page, 'Weeknight Pad Thai with Crispy Tofu'), { ax: 0.3 });
            await ctx.move(app.projectTab(page, 'Family Cookbook'), { ax: 0.4 });
        },
    },
    {
        say: 'Apply replaces whatever the tab held, so use a blank one. Paste into the wrong tab, and one Ctrl+Z takes it back.',
        do: async (page, ctx) => {
            await ctx.move(app.canvas(page), { ay: 0.25 });
            await ctx.atSentence(1);
            await ctx.move(app.pane(page).locator('button[title="Undo (Ctrl+Z)"]'));
        },
    },
    {
        chapter: 'A copy in the cloud',
        say: "The other copy outside your browser is a cloud save, from episode eleven. I'm signed in, so Cloud offers "
            + 'Save to cloud (new): a version on the server, with a message.',
        do: async (page, ctx) => {
            await savedLocally(page);
            await ctx.move(cloudButton(page));
            await ctx.atSentence(1);
            await ctx.click(cloudButton(page));
            const item = page.getByRole('button', { name: 'Save to cloud (new)' });
            await ctx.move(item);
            await ctx.dialogs.arm({ text: 'Back from the JSON file' });
            await ctx.click(item);
            await ctx.dialogs.replay();
            await item.waitFor({ state: 'detached' });
        },
    },
    {
        say: "Closing a tab never deletes those versions. The cookbook hasn't changed since I saved it, "
            + 'so this time Close without Saving loses nothing.',
        do: async (page, ctx) => {
            await closeTab(ctx, 'Family Cookbook');
            await ctx.atSentence(1);
            await ctx.move(dialogButton(page, 'Close without Saving'));
            await ctx.atSentence(1, { offset: 2.4 });
            await ctx.click(dialogButton(page, 'Close without Saving'));
            await closeDialog(page).waitFor({ state: 'detached' });
            await app.projectTab(page, 'Blank Project').waitFor();
        },
    },
    {
        say: "My projects, in the account menu, lists everything you've saved to the cloud. Here's the cookbook: private, with one version.",
        do: async (page, ctx) => {
            await savedLocally(page);
            await ctx.click(page.getByTitle('Account'));
            await ctx.click(page.getByRole('link', { name: 'My projects' }));
            await projectRow(page, 'Family Cookbook').waitFor();
            await ctx.atSentence(1);
            const row = projectRow(page, 'Family Cookbook');
            await ctx.move(row.getByText('Family Cookbook', { exact: true }));
            await ctx.move(row.getByText('private', { exact: true }));
            await ctx.move(await textBox(page, 'main li', 'versions'), { ax: 0.3 });
        },
    },
    {
        say: 'Open loads its latest version into a new tab, in any browser where you sign in. And here it is, back in the editor.',
        do: async (page, ctx) => {
            const open = projectRow(page, 'Family Cookbook').getByRole('button', { name: 'Open', exact: true });
            await ctx.move(open);
            await ctx.atSentence(0, { offset: 1.2 });
            await ctx.click(open);
            await page.waitForURL(url => new URL(url).pathname === '/app', { timeout: 30000 });
            await app.editorReady(page);
            await app.projectTab(page, 'Family Cookbook').waitFor();
            await page.locator('#workspace-bootstrap-heading').waitFor({ state: 'detached', timeout: 30000 });
            await ctx.atSentence(1);
            await ctx.move(app.projectTab(page, 'Family Cookbook'), { ax: 0.4 });
        },
    },
    {
        say: "It's still linked to its cloud project: Cloud offers Save to cloud, not new, and Version history. "
            + 'The next save adds to the same history.',
        do: async (page, ctx) => {
            await ctx.click(cloudButton(page));
            await ctx.move(page.getByRole('button', { name: 'Save to cloud', exact: true }));
            await ctx.atSentence(0, { offset: 4.2 });
            await ctx.move(page.getByRole('button', { name: 'Version history', exact: true }));
            await ctx.atSentence(1, { offset: 1.2 });
            await ctx.click(cloudButton(page));
        },
    },
    {
        say: 'So: let it save as you work, close tabs with Save JSON & Close, and cloud-save the milestones. See you in the next one.',
        hold: 3,
        do: async (page, ctx) => {
            await ctx.atSentence(1, { offset: 0.3 });
            await ctx.endCard();
        },
    },
];
