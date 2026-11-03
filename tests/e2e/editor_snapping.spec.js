import { test, expect } from '@playwright/test';
import { openFreshEditor, readActiveProject } from './localWorkspaceHelpers.js';

// Smart guides and grid snapping with a mouse (the touch counterparts live in mobile_editor.spec.js).
// A fresh Blank Project opens at 0.8 zoom with smart guides on and grid snapping off, so the
// screen-pixel coordinates below are 1.25x in page units; every assertion is in screen pixels or
// reads the stored element back.

const pane = page => page.locator('[data-testid="project-pane"][data-active="true"]');

// A selected element's centre is its transform-origin pivot handle (a drag there moves the pivot,
// not the element), so drags press at a quarter point of the box.
const grabPoint = b => ({ x: b.x + b.width / 4, y: b.y + b.height / 4 });

async function drawRect(page, from, to) {
    await page.getByTitle('Rectangle (R)').click();
    const canvas = await page.getByTestId('editor-canvas').boundingBox();
    await page.mouse.move(canvas.x + from.x, canvas.y + from.y);
    await page.mouse.down();
    await page.mouse.move(canvas.x + to.x, canvas.y + to.y, { steps: 4 });
    await page.mouse.up();
    await page.getByTitle('Select Tool (V)').click();
}

test.describe('Snapping', () => {
    test.beforeEach(async ({ page }) => {
        await openFreshEditor(page);
        await expect(page.getByTestId('project-tab').filter({ hasText: 'Blank Project' })).toBeVisible();
    });

    test('a dragged rectangle lines up with another and shows a guide', async ({ page }) => {
        await drawRect(page, { x: 120, y: 120 }, { x: 220, y: 180 });
        await drawRect(page, { x: 300, y: 300 }, { x: 360, y: 340 });
        const [a, b] = await pane(page).locator('[data-element-id]').all();
        const ab = await a.boundingBox(), bb = await b.boundingBox();
        const grab = grabPoint(bb);
        await page.mouse.move(grab.x, grab.y);
        await page.mouse.down();
        // Stop with b's left edge 3 screen px right of a's: inside the 6 px mouse pull.
        await page.mouse.move(grab.x - (bb.x - ab.x) + 3, grab.y, { steps: 8 });
        // The overlay is visible; its vertical align line has a zero-width client rect, which
        // Playwright's visibility check would call hidden, so the line is asserted as attached.
        await expect(pane(page).locator('[data-testid="snap-guides"]')).toBeVisible();
        await expect(pane(page).locator('[data-testid="snap-guides"] line[data-guide-kind="align"]').first()).toBeAttached();
        await page.mouse.up();
        await expect(pane(page).locator('[data-testid="snap-guides"]')).toHaveCount(0);
        expect(Math.abs((await b.boundingBox()).x - ab.x)).toBeLessThan(0.75);
    });

    test('Alt moves without snapping', async ({ page }) => {
        await drawRect(page, { x: 120, y: 120 }, { x: 220, y: 180 });
        await drawRect(page, { x: 300, y: 300 }, { x: 360, y: 340 });
        const [a, b] = await pane(page).locator('[data-element-id]').all();
        const ab = await a.boundingBox(), bb = await b.boundingBox();
        const grab = grabPoint(bb);
        await page.mouse.move(grab.x, grab.y);
        await page.mouse.down();
        await page.mouse.move(grab.x - 20, grab.y, { steps: 2 });
        await page.keyboard.down('Alt');
        await page.mouse.move(grab.x - (bb.x - ab.x) + 3, grab.y, { steps: 4 });
        await page.mouse.up();
        await page.keyboard.up('Alt');
        // b followed the pointer to 3 px right of a's edge and stayed there instead of snapping onto it.
        const offset = (await b.boundingBox()).x - ab.x;
        expect(offset).toBeGreaterThan(2);
        expect(offset).toBeLessThan(4);
    });

    test('a custom grid size lands edges on its lines', async ({ page }) => {
        await drawRect(page, { x: 123, y: 131 }, { x: 207, y: 189 });
        await page.getByTitle('Snapping options').click();
        await page.getByRole('switch', { name: 'Smart guides' }).click();
        await page.getByRole('button', { name: '20 pt' }).click();
        await page.getByRole('switch', { name: 'Snap to grid' }).click();
        await page.keyboard.press('Escape');
        const rect = pane(page).locator('[data-element-id]').first();
        const grab = grabPoint(await rect.boundingBox());
        await page.mouse.move(grab.x, grab.y);
        await page.mouse.down();
        await page.mouse.move(grab.x + 47, grab.y + 33, { steps: 6 });
        await page.mouse.up();
        await expect.poll(async () => {
            const state = (await readActiveProject(page)).initialState;
            const tpl = state.variants[state.activeVariantId].templates[state.nodes[state.rootId].type];
            const el = tpl.elements[0];
            return [el.x % 20, el.y % 20];
        }).toEqual([0, 0]);
    });
});
