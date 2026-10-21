// App-specific locators and moves shared by the storyboards. Locators prefer
// what a user can see (titles, labels, roles) over implementation details,
// with the editor's own data attributes for rows the screen can't name.
// Every open project tab keeps its own mounted pane, so editor locators are
// scoped to the active one.
import fs from 'node:fs';
import { FIXTURES_DIR, fixturePath } from './episode.js';

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

/** Node Properties' Title input and Assigned Template select. */
export const nodeTitleInput = (page) => propertiesColumn(page).locator('label:text-is("Title") + input').first();
export const assignedTemplateSelect = (page) => propertiesColumn(page).locator('label:text-is("Assigned Template") + select').first();

/** A collapsible Element Properties section: 'geometry', 'appearance', 'typography', 'interaction'… */
export const section = (page, name) => pane(page).getByTestId(`${name}-section`);

/** Toolbar buttons by their tooltip, and the zoom steppers. */
export const toolbarButton = (page, title) => pane(page).locator(`button[title="${title}"]`).first();
export const zoomOutButton = (page) => pane(page).locator('button:has(svg.lucide-zoom-out)').first();
export const zoomInButton = (page) => pane(page).locator('button:has(svg.lucide-zoom-in)').first();

/** Converts page coordinates (points) to screen coordinates for the current zoom. */
export async function pagePoint(page, x, y, pageWidth = 595.28) {
    const box = await canvas(page).boundingBox();
    const s = box.width / pageWidth;
    return { x: box.x + x * s, y: box.y + y * s };
}

/** Replaces a field's value the way a person does: click, select all, type. */
export async function retype(ctx, locator, value, { commit = 'Tab' } = {}) {
    await ctx.click(locator);
    await ctx.page.keyboard.press('Control+a');
    await ctx.type(String(value));
    if (commit) await ctx.page.keyboard.press(commit);
}

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

/** The project JSON editor (opened from the editor toolbar's JSON button). */
const jsonEditor = (page) => page.locator('.editor-dialog-panel', { has: page.locator('h2:text-is("Project JSON Editor")') }).first();

/**
 * Off camera: the active project as the JSON editor's Text view shows it, with
 * the selection and clipboard cleared, so the next episode can start from it.
 */
export async function readProjectJson(page) {
    await pane(page).getByRole('button', { name: 'JSON', exact: true }).click();
    const editor = jsonEditor(page);
    await editor.getByRole('button', { name: 'Text', exact: true }).click();
    const state = JSON.parse(await editor.locator('textarea').inputValue());
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    return { ...state, selectedNodeId: state.rootId, selectedNodeIds: [state.rootId], selectedTemplateId: '',
        selectedTemplateIds: [], selectedElementIds: [], clipboard: [] };
}

/** Off camera: replaces the active project with `state` through the JSON editor, then waits for the save. */
export async function loadProjectJson(page, state) {
    await pane(page).getByRole('button', { name: 'JSON', exact: true }).click();
    const editor = jsonEditor(page);
    await editor.getByRole('button', { name: 'Text', exact: true }).click();
    await editor.locator('textarea').fill(JSON.stringify(state, null, 2));
    await editor.getByRole('button', { name: 'Apply Changes', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    await page.getByRole('status').filter({ hasText: 'Saving locally' }).first().waitFor({ timeout: 5000 }).catch(() => {});
    await page.getByRole('status').filter({ hasText: 'Saved locally' }).first().waitFor({ timeout: 30000 });
}

/** Off camera: saves the project the episode left open as tutorial/fixtures/<name>.json. */
export async function saveFixture(ctx, name) {
    await ctx.goto('/app');
    await editorReady(ctx.page);
    const state = await readProjectJson(ctx.page);
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
    fs.writeFileSync(fixturePath(name), `${JSON.stringify(state, null, 2)}\n`);
}

/** Off camera: replaces the open project with a fixture an earlier episode saved. */
export async function loadFixture(ctx, name) {
    await loadProjectJson(ctx.page, JSON.parse(fs.readFileSync(fixturePath(name), 'utf8')));
}
