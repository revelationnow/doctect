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

const within = (inner, outer) => inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
/** The control is visible and its whole box lies inside `screen`; returns the box. */
const onScreen = async (locator, screen, label) => {
    await expect(locator, label).toBeVisible();
    const b = await locator.boundingBox();
    expect(within(b, screen), `${label} inside the ${screen.width}px viewport`).toBe(true);
    return b;
};

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

    // The tablet toolbar's natural row (☰, eight tools, Fit, Undo, Redo, Export PDF, ⋯: 768px with the
    // label, 684px without) is wider than the narrowest tablet-layout windows. The tools scroll
    // sideways in the same scroller as the phone pill, so the trailing controls (⋯ is the only way
    // to the export, project and canvas actions) and the pinned Fit never leave the screen; Export
    // PDF keeps only its icon below 840px. At 700px everything then fits; at 640px the tools scroll.
    test('640 and 700px: the tablet toolbar keeps ☰, Fit, Undo, Redo, Export PDF and ⋯ on screen and scrolls the tools', async ({ page, browserName }) => {
        test.skip(!['chromium', 'firefox'].includes(browserName), 'WebKit cannot launch on the dev host');
        const bar = topBar(page);
        const scroller = bar.locator('[data-touch-pill-scroller]');
        const menu = page.getByRole('dialog', { name: 'More actions' });
        for (const width of [700, 640]) {
            const height = 800;
            await page.setViewportSize({ width, height });
            const screen = { x: 0, y: 0, width, height };
            await expect(html(page)).toHaveAttribute('data-form-factor', 'tablet');
            const boxes = [];
            for (const name of ['Open pages and templates', 'Fit page to width', 'Undo', 'Redo', 'Export PDF', 'More actions']) {
                boxes.push(await onScreen(bar.getByRole('button', { name }), screen, `${name} at ${width}px`));
            }
            // Pinned and trailing controls keep their full width: nothing is squeezed or stacked.
            for (const [i, b] of boxes.entries()) {
                expect(b.width, `control ${i} width at ${width}px`).toBeGreaterThanOrEqual(40);
                for (const other of boxes.slice(i + 1)) expect(b.x + b.width <= other.x, `controls in order at ${width}px`).toBe(true);
            }
            await expect(bar.getByRole('button', { name: 'Export PDF' }).getByText('Export PDF'), `icon-only Export PDF at ${width}px`).toBeHidden();
            expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `no horizontal scroll at ${width}px`).toBeLessThanOrEqual(0);

            // At 640px the tool row is narrower than its tools: it scrolls, says so with the end fade,
            // and every tool can be brought on screen (the last one is Grid), Fit staying put meanwhile.
            // At 700px the icon-only row still fits whole, so nothing scrolls and no fade shows.
            const scrolls = await scroller.evaluate(el => el.scrollWidth > el.clientWidth);
            expect(scrolls, `tools scroll only at 640px (at ${width}px)`).toBe(width === 640);
            if (scrolls) {
                await expect(bar.getByTestId('tool-pill-fade-end')).toBeVisible();
                const fitBefore = await bar.getByRole('button', { name: 'Fit page to width' }).boundingBox();
                await scroller.evaluate(el => { el.scrollLeft = el.scrollWidth; });
                await expect.poll(async () => within(await bar.getByRole('button', { name: 'Grid', exact: true }).boundingBox(), screen), `Grid scrolls into view at ${width}px`).toBe(true);
                expect(await bar.getByRole('button', { name: 'Fit page to width' }).boundingBox(), `Fit pinned at ${width}px`).toEqual(fitBefore);
                await scroller.evaluate(el => { el.scrollLeft = 0; });
            } else {
                await expect(bar.getByTestId('tool-pill-fade-end')).toBeHidden();
                await onScreen(bar.getByRole('button', { name: 'Grid', exact: true }), screen, `Grid at ${width}px`);
            }

            // ⋯ opens the menu from here.
            await bar.getByRole('button', { name: 'More actions' }).click();
            await expect(menu).toBeVisible();
            await page.getByTestId('overflow-menu-backdrop').click();
            await expect(menu).toBeHidden();
        }
        // Back at 900px the label is shown again (the row has room for it from 840px up).
        await page.setViewportSize({ width: 900, height: 800 });
        await expect(bar.getByRole('button', { name: 'Export PDF' }).getByText('Export PDF')).toBeVisible();
        await expect(bar.getByTestId('tool-pill-fade-end')).toBeHidden();
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

    test('the properties panel drags wider with the mouse, keeps the canvas 320px, and collapses to a rail', async ({ page, browserName }) => {
        test.skip(browserName !== 'chromium', 'the dock is the same DOM on every engine; recorded on Chromium');
        const dock = activePane(page).locator('[data-properties-dock="open"]');
        const handle = dock.locator('[data-properties-resize-handle]');
        const width = async () => (await dock.boundingBox()).width;
        expect(Math.abs(await width() - 320)).toBeLessThanOrEqual(1);

        const drag = async toX => {
            const h = await handle.boundingBox();
            await page.mouse.move(h.x + h.width / 2, h.y + 200);
            await page.mouse.down();
            await page.mouse.move(toX, h.y + 220, { steps: 6 });
            await page.mouse.up();
        };
        await drag(900 - 420);
        await expect.poll(width).toBeGreaterThan(415);
        expect(await width()).toBeLessThan(425);
        // As far left as it goes: the panel stops where the canvas would drop below 320px.
        await drag(40);
        await expect.poll(width).toBeGreaterThan(575);
        const canvasColumn = activePane(page).locator('.canvas-scroll-container');
        expect((await canvasColumn.boundingBox()).width).toBeGreaterThanOrEqual(319);

        // Desktop and tablet share the dragged width.
        await drag(900 - 400);
        await page.setViewportSize({ width: 1440, height: 900 });
        await expect(html(page)).not.toHaveAttribute('data-form-factor', /.+/);
        await expect.poll(async () => Math.abs(await width() - 400)).toBeLessThanOrEqual(2);

        // Hidden on the desktop stays hidden in the tablet layout and after a reload; the rail brings it back.
        await activePane(page).getByRole('button', { name: 'Hide properties panel' }).click();
        await expect(activePane(page).locator('[data-properties-dock="collapsed"]')).toBeVisible();
        await expect(activePane(page).locator('[data-prevent-finish-edit="true"]')).toHaveCount(0);
        await page.setViewportSize({ width: 900, height: 800 });
        await expect(html(page)).toHaveAttribute('data-form-factor', 'tablet');
        await expect(activePane(page).locator('[data-properties-dock="collapsed"]')).toBeVisible();
        await page.reload();
        await expect(activePane(page).getByTestId('editor-canvas')).toBeVisible();
        await activePane(page).getByRole('button', { name: 'Show properties panel' }).click();
        await expect(dock).toBeVisible();
        await expect(activePane(page).locator('[data-prevent-finish-edit="true"]')).toBeVisible();
    });

    test('desktop: the sidebar hides to a rail and comes back, remembered across reloads; narrow layouts keep their drawer', async ({ page, browserName }) => {
        test.skip(browserName !== 'chromium', 'the dock is the same DOM on every engine; recorded on Chromium');
        await page.setViewportSize({ width: 1440, height: 900 });
        const dock = activePane(page).locator('[data-sidebar-dock="open"]');
        await expect(dock).toBeVisible();
        expect(Math.abs((await dock.boundingBox()).width - 288)).toBeLessThanOrEqual(1);
        const canvasColumn = activePane(page).locator('.canvas-scroll-container');
        const before = (await canvasColumn.boundingBox()).width;

        // The edge still drags with the mouse.
        const h = await dock.locator('[data-sidebar-resize-handle]').boundingBox();
        await page.mouse.move(h.x + h.width / 2, h.y + 200);
        await page.mouse.down();
        await page.mouse.move(340, h.y + 220, { steps: 6 });
        await page.mouse.up();
        await expect.poll(async () => Math.abs((await dock.boundingBox()).width - 340)).toBeLessThanOrEqual(2);

        await activePane(page).getByRole('button', { name: 'Hide pages and templates' }).click();
        await expect(activePane(page).locator('[data-sidebar-dock="collapsed"]')).toBeVisible();
        await expect(activePane(page).getByRole('button', { name: 'Hierarchy' })).toHaveCount(0);
        await expect.poll(async () => (await canvasColumn.boundingBox()).width).toBeGreaterThan(before);

        // The tablet layout still opens pages and templates from its drawer.
        await page.setViewportSize({ width: 900, height: 800 });
        await expect(html(page)).toHaveAttribute('data-form-factor', 'tablet');
        await expect(activePane(page).locator('[data-sidebar-dock]')).toHaveCount(0);
        await page.getByRole('button', { name: 'Open pages and templates' }).click();
        await expect(drawer(page).getByRole('button', { name: 'Hierarchy' })).toBeVisible();
        await page.keyboard.press('Escape');

        await page.setViewportSize({ width: 1440, height: 900 });
        await page.reload();
        await expect(activePane(page).getByTestId('editor-canvas')).toBeVisible();
        await activePane(page).getByRole('button', { name: 'Show pages and templates' }).click();
        await expect(dock).toBeVisible();
        await expect(activePane(page).getByRole('button', { name: 'Hierarchy' })).toBeVisible();
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
