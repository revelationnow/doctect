import { test, expect } from '@playwright/test';
import { seedNativeProject } from './localWorkspaceHelpers.js';
import { layoutFixture as fixture } from './fixtures/layoutFixture.js';

// A mouse/trackpad window narrower than 1024px uses the tablet layout, narrower than 640px the phone
// layout, and keeps desktop input throughout (spec 2026-10-19-narrow-window-layouts-design.md).
// Runs in the desktop projects: no touch emulation, so the browser reports a fine pointer.

const activePane = page => page.locator('[data-testid="project-pane"][data-active="true"]');
const topBar = page => page.locator('[data-touch-chrome="top-bar"]');
const drawer = page => page.getByRole('dialog', { name: 'Pages and templates' });
const html = page => page.locator('html');
const MOUSE_CANVAS_GUTTER = 48; // hooks/useTouchFit.ts: a mouse fit leaves this much each side

test.describe('narrow mouse window', () => {
    test.beforeEach(async ({ page }) => {
        await seedNativeProject(page, { id: 'narrow', name: 'Narrow', initialState: fixture });
        await page.setViewportSize({ width: 900, height: 800 });
        await page.goto('/app');
        await expect(activePane(page).getByTestId('editor-canvas')).toBeVisible();
    });

    test('900px: tablet layout with mouse input', async ({ page, browserName }) => {
        test.skip(browserName !== 'chromium', 'the narrow chrome is the same DOM on every engine; recorded on Chromium');
        await expect(html(page)).toHaveAttribute('data-form-factor', 'tablet');
        await expect(html(page)).not.toHaveAttribute('data-input', 'touch');
        await expect(topBar(page)).toHaveCount(1);
        await expect(page.getByRole('button', { name: 'Select multiple' })).toHaveCount(0);

        // Normal-size controls: no 44px floor on an ordinary panel button.
        const bringForward = activePane(page).getByTitle('Bring Forward');
        await activePane(page).locator('[data-element-id="box"]').click();
        await expect(bringForward).toBeVisible();
        expect((await bringForward.boundingBox()).height).toBeLessThan(44);

        // The page is fitted to the width with the mouse gutter, so there is no sideways scroll. The
        // saved 0.8 zoom would leave the page ~8px narrower than a fit.
        const outer = activePane(page).locator('.canvas-scroll-container');
        const canvas = activePane(page).getByTestId('editor-canvas');
        await expect.poll(async () => Math.abs((await canvas.boundingBox()).width
            - ((await outer.evaluate(el => el.clientWidth)) - 2 * MOUSE_CANVAS_GUTTER))).toBeLessThan(2);
        expect(await outer.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);

        // Mouse drag moves the selected element. A selected element's centre is its transform-origin
        // pivot handle (dragging there moves the pivot, not the element), so press at a quarter point.
        const rect = activePane(page).locator('[data-element-id="box"]');
        const before = await rect.boundingBox();
        const grab = { x: before.x + before.width / 4, y: before.y + before.height / 4 };
        await page.mouse.move(grab.x, grab.y);
        await page.mouse.down();
        await page.mouse.move(grab.x + 40, grab.y + 30, { steps: 5 });
        await page.mouse.up();
        await expect.poll(async () => (await rect.boundingBox()).x).toBeGreaterThan(before.x + 20);

        // Sidebar rows in the drawer keep their hover actions, no ⋯ button.
        await page.getByRole('button', { name: 'Open pages and templates' }).click();
        await expect(drawer(page)).toBeVisible();
        const row = drawer(page).getByText('Guard Page');
        await row.hover();
        await expect(drawer(page).getByTitle('Add New Page')).toBeVisible();
        await expect(page.getByRole('button', { name: /^Actions for/ })).toHaveCount(0);
    });

    test('600px: phone layout; back to 1440px restores the desktop with its saved zoom', async ({ page, browserName }) => {
        test.skip(browserName !== 'chromium', 'the narrow chrome is the same DOM on every engine; recorded on Chromium');
        await page.setViewportSize({ width: 600, height: 800 });
        await expect(html(page)).toHaveAttribute('data-form-factor', 'phone');
        await expect(topBar(page).getByRole('button', { name: 'Narrow' })).toHaveCount(1);

        await page.setViewportSize({ width: 1440, height: 900 });
        await expect(html(page)).not.toHaveAttribute('data-form-factor', /.+/);
        await expect(topBar(page)).toHaveCount(0);
        // The fixture's saved zoom is 0.8; narrow-window fitting never wrote it.
        await expect(activePane(page).getByText('80%')).toBeVisible();
        // The desktop panels are back at the fixture's saved widths (288 / 320).
        const sidebar = activePane(page).getByRole('button', { name: 'Hierarchy' })
            .locator('xpath=ancestor::*[contains(@class, "border-r")][1]');
        const properties = activePane(page).locator('[data-prevent-finish-edit="true"]');
        expect(Math.abs((await sidebar.boundingBox()).width - 288)).toBeLessThanOrEqual(1);
        expect(Math.abs((await properties.boundingBox()).width - 320)).toBeLessThanOrEqual(1);
    });

    test('an inline text edit survives crossing a breakpoint', async ({ page, browserName }) => {
        // The swap removes the focused editor. Chromium blurs it (the overlay's onFinish runs);
        // Firefox does not, so the canvas must end the session itself. Both engines run this test.
        test.skip(!['chromium', 'firefox'].includes(browserName), 'WebKit cannot launch on the dev host');
        const title = activePane(page).locator('[data-element-id="title"]');
        // Off-centre: the first click selects the text, which puts the pivot handle at its centre.
        await title.dblclick({ position: { x: 40, y: 20 } });
        const editor = activePane(page).locator('[data-canvas-event-owner="inline-text"] [contenteditable]');
        await expect(editor).toBeFocused();
        await page.keyboard.press('End');
        await page.keyboard.type(' edited');
        await page.setViewportSize({ width: 1440, height: 900 });
        await expect(title).toHaveText('Guard edited');
        // The text edit is in history before any further interaction.
        await expect(activePane(page).getByTitle('Undo (Ctrl+Z)')).toBeEnabled();

        // A second, independent edit (the still-selected title's X in the properties panel) must be
        // its own history step: one undo takes back only the move, the next takes back the text.
        const restingX = (await title.boundingBox()).x;
        const xInput = activePane(page).locator('.group:has(> label:text-is("X")) input');
        await xInput.fill('160');
        await expect.poll(async () => (await title.boundingBox()).x).toBeGreaterThan(restingX + 40);
        await activePane(page).getByTestId('editor-canvas').click({ position: { x: 5, y: 5 } }); // focus off the input
        await page.keyboard.press('Control+z');
        await expect.poll(async () => Math.abs((await title.boundingBox()).x - restingX)).toBeLessThan(1);
        await expect(title).toHaveText('Guard edited');
        await page.keyboard.press('Control+z');
        await expect(title).toHaveText('Guard');
    });
});
