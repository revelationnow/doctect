// Accounts, cloud saves and gallery seeding for the cloud episodes. Everything
// here runs off camera, through the real UI but with plain Playwright actions
// (no human pacing). The sealed API never sends mail: verification links are
// read back from its log.
import * as app from './app.js';

/** The people in the cloud episodes. `you` is the viewer's account, made on camera in episode 11. */
export const PEOPLE = {
    you: { name: 'Jamie Rivera', username: 'jamie_cooks', email: 'jamie@example.com', password: 'Basil-and-thyme-26' },
    sam: { name: 'Sam Okafor', username: 'sam_cooks', email: 'sam@example.com', password: 'Saffron-and-rice-26' },
    priya: { name: 'Priya Shah', username: 'priya_plans', email: 'priya@example.com', password: 'Paper-planes-2026!' },
};

/** What the other members have published before the cloud episodes start. */
export const GALLERY = [
    [PEOPLE.sam, [{
        fixture: '10-meal-planner', message: 'A week of dinners',
        description: 'A week of dinners on A4: an overview page that links to one lined page per day.',
        tags: ['meals', 'weekly', 'planner'], previews: ['Monday'],
    }]],
    [PEOPLE.priya, [{
        preset: '2026 Planner', message: 'The 2026 planner',
        description: 'A linked planner for the whole of 2026: years, quarters, months, weeks and days, all one tap apart.',
        tags: ['planner', '2026', 'remarkable'],
    }, {
        preset: 'Simple Notebook', title: 'Sketchbook', message: 'Sections for each project',
        description: 'A sketchbook with a divider page for each project.',
        tags: ['notebook', 'sketching'],
    }]],
];

/** Waits for a verification link newer than `previous` in the API log. */
export async function nextVerificationLink(servers, previous) {
    for (let i = 0; i < 100; i++) {
        const link = servers.lastVerificationLink();
        if (link && link !== previous) return link;
        await new Promise(r => setTimeout(r, 200));
    }
    throw new Error('no new verification link in the API log');
}

/** Creates and verifies an account through /login, ending signed in on /app. */
export async function signUp(ctx, { name, username, email, password }) {
    const { page, servers } = ctx;
    await ctx.goto('/login');
    await page.getByRole('button', { name: 'Sign Up' }).click();
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    const stale = servers.lastVerificationLink();
    await page.getByRole('button', { name: 'Sign Up' }).click();
    await page.getByRole('heading', { name: 'Verify your email' }).waitFor({ timeout: 15000 });
    await ctx.goto(await nextVerificationLink(servers, stale));
    await page.waitForURL(url => new URL(url).pathname === '/app', { timeout: 20000 });
    await app.editorReady(page);
}

export async function signIn(ctx, { email, password }) {
    const { page } = ctx;
    await ctx.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await page.waitForURL(url => new URL(url).pathname === '/app', { timeout: 20000 });
    await app.editorReady(page);
}

export async function signOut(ctx) {
    const { page } = ctx;
    await page.getByTitle('Account').click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL(url => new URL(url).pathname === '/login', { timeout: 15000 });
}

/**
 * Forgets everything this browser knows about the app (local projects, presets,
 * the session) and opens the editor as a first-time visitor would.
 */
export async function freshVisitor(ctx) {
    const { page, baseUrl } = ctx;
    await page.goto('about:blank'); // close the app's database connections before clearing them
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'all' });
    await cdp.detach();
    await page.context().clearCookies();
    await ctx.goto('/app');
    await app.editorReady(page);
}

/** A new project tab from a New Project preset card. */
export async function newProject(ctx, preset) {
    const { page } = ctx;
    await page.locator('button[title="New Project"]').first().click();
    await app.presetCard(page, preset).click();
    await page.getByText('Create New Project').waitFor({ state: 'hidden', timeout: 60000 });
    await app.editorReady(page);
}

/** Waits for the edit just made to reach local storage. */
async function savedLocally(page) {
    await page.getByRole('status').filter({ hasText: 'Saving locally' }).first().waitFor({ timeout: 3000 }).catch(() => {});
    await page.getByRole('status').filter({ hasText: 'Saved locally' }).first().waitFor({ timeout: 30000 });
}

/** Cloud → Save to cloud, answering the commit-message prompt; resolves once the menu closes on success. */
export async function saveToCloud(ctx, message) {
    const { page } = ctx;
    await page.evaluate(m => window.__studioDialogs.queue.push({ text: m }), message);
    await page.getByTitle('Cloud').click();
    const item = page.getByRole('button', { name: /^Save to cloud/ });
    await item.click();
    try {
        await item.waitFor({ state: 'detached', timeout: 30000 });
    } catch (error) {
        const shown = await page.locator('.text-red-600').allTextContents().catch(() => []);
        throw new Error(`cloud save did not finish: ${shown.join(' ') || error.message}`);
    }
    await page.waitForTimeout(600);
}

/** Cloud → Publish to gallery…, with a description, tags, and (optionally) extra preview pages by title. */
export async function publish(ctx, { description, tags = [], previews = [] }) {
    const { page } = ctx;
    await page.getByTitle('Cloud').click();
    await page.getByRole('button', { name: /publish to gallery/i }).click();
    const dialog = page.getByRole('dialog', { name: 'Publish to gallery' });
    await dialog.getByPlaceholder('What is this planner for?').fill(description);
    if (tags.length) await dialog.getByPlaceholder('planner, 2026, remarkable').fill(tags.join(', '));
    for (const title of previews) await dialog.locator('label', { hasText: title }).first().locator('input').check();
    await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
    await dialog.waitFor({ state: 'detached', timeout: 60000 });
    await page.waitForTimeout(400);
}

/**
 * Seeds the gallery: signs `person` up, then for each project opens a preset
 * (or a fixture), optionally renames it, saves it to the cloud and publishes it.
 * Leaves the person signed in.
 */
export async function seedMember(ctx, person, projects) {
    await signUp(ctx, person);
    for (const p of projects) {
        await newProject(ctx, p.preset ?? 'Blank Project');
        if (p.fixture) await app.loadFixture(ctx, p.fixture);
        if (p.title) {
            await app.nodeTitleInput(ctx.page).fill(p.title);
            await ctx.page.keyboard.press('Tab');
            await savedLocally(ctx.page);
        }
        await saveToCloud(ctx, p.message ?? 'First version');
        await publish(ctx, p);
    }
}

/**
 * A signed-in API client for `person`, with no browser: for staging another
 * member's side of the story (a fork, a commit, a merge request) mid-episode
 * without touching the page being recorded.
 */
export async function apiAs(ctx, { email, password }) {
    const { servers, baseUrl } = ctx;
    const signIn = await fetch(`${servers.apiOrigin}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: baseUrl },
        body: JSON.stringify({ email, password }),
    });
    if (!signIn.ok) throw new Error(`sign-in failed for ${email}: ${signIn.status} ${await signIn.text()}`);
    const cookie = signIn.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    const call = async (method, path, body, headers = {}) => {
        const res = await fetch(`${servers.apiOrigin}${path}`, {
            method,
            headers: { 'Content-Type': 'application/json', Origin: baseUrl, Cookie: cookie, ...headers },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(json)}`);
        return json;
    };
    return { get: (path) => call('GET', path), post: (path, body, headers) => call('POST', path, body, headers) };
}

/** Publishes GALLERY, then leaves the browser as a first-time visitor would find it. */
export async function seedGallery(ctx) {
    for (const [person, projects] of GALLERY) {
        await seedMember(ctx, person, projects);
        await signOut(ctx);
    }
    await freshVisitor(ctx);
}
