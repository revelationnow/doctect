// App-specific locators and moves shared by the storyboards. Locators prefer
// what a user can see (titles, labels, roles) over implementation details,
// with the editor's own data attributes for rows the screen can't name.
// Every open project tab keeps its own mounted pane, so editor locators are
// scoped to the active one.

export const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exact = (s) => new RegExp(`^${escapeRe(s)}$`);

/** The active project tab's editor. */
export const pane = (page) => page.locator('[data-testid="project-pane"][data-active="true"]').first();

/** The visible editor canvas page. */
export const canvas = (page) => pane(page).locator('[data-testid="editor-canvas"]').first();

/** The three desktop columns. */
export const sidebarColumn = (page) => pane(page).locator('[data-sidebar-dock="open"]').first();
export const canvasColumn = (page) => pane(page).locator('[data-sidebar-dock="open"] + div .bg-slate-200').first();
export const propertiesColumn = (page) => pane(page).locator('[data-properties-dock="open"]').first();

/** A node row in the Hierarchy sidebar, by its exact title. */
export const nodeRow = (page, title) =>
    pane(page).locator('[data-node-id]', { has: page.locator('span.truncate', { hasText: exact(title) }) }).first();

/** A template row in the Templates sidebar, by its exact name. */
export const templateRow = (page, name) =>
    pane(page).locator('[data-template-id]', { has: page.locator('span.truncate', { hasText: exact(name) }) }).first();

/** The Hierarchy / Templates switch at the top of the sidebar. */
export const sidebarTab = (page, name) => pane(page).getByRole('button', { name, exact: true }).first();

/** Templates mode's "Preview:" node selector in the toolbar. */
export const previewSelect = (page) => pane(page).locator('div:has(> span:text-is("Preview:")) > select').first();

/** The top-bar tab for an open project. */
export const projectTab = (page, title) => page.locator('[data-testid="project-tab"]', { hasText: exact(title) }).first();

/** Waits until the active editor has mounted its canvas. */
export async function editorReady(page) {
    await canvas(page).waitFor({ timeout: 60000 });
}

/** Clicks a node row's chevron to unfold (or fold) it. */
export async function toggleNode(ctx, title) {
    const row = nodeRow(ctx.page, title);
    await row.scrollIntoViewIfNeeded();
    await ctx.click(row.locator(':scope > div').first(), { exact: true });
}

/** Selects a node row by clicking its label (the row's hover actions sit on its right). */
export async function selectNode(ctx, title) {
    const row = nodeRow(ctx.page, title);
    await row.scrollIntoViewIfNeeded();
    const box = await row.locator('span.truncate').first().boundingBox();
    await ctx.click({ x: box.x + Math.min(box.width * 0.5, 60), y: box.y + box.height / 2 });
}

export async function selectTemplate(ctx, name) {
    const row = templateRow(ctx.page, name);
    await row.scrollIntoViewIfNeeded();
    const box = await row.locator('span.truncate').first().boundingBox();
    await ctx.click({ x: box.x + Math.min(box.width * 0.5, 60), y: box.y + box.height / 2 });
}

/** The New Project dialog's preset card. */
export const presetCard = (page, title) =>
    page.getByRole('dialog', { name: 'Create New Project' }).getByRole('button', { name: new RegExp(`^${escapeRe(title)}`) }).first();

/** Creates a project from one of the New Project dialog's preset cards. */
export async function newProjectFromPreset(ctx, presetTitle) {
    const { page } = ctx;
    await ctx.click(page.locator('button[title="New Project"]').first());
    await presetCard(page, presetTitle).waitFor();
    await ctx.wait(500);
    await ctx.click(presetCard(page, presetTitle));
    await page.getByText('Create New Project').waitFor({ state: 'hidden', timeout: 60000 });
    await editorReady(page);
}
