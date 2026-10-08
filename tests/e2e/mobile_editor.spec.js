import { test, expect } from '@playwright/test';
import { seedNativeProject } from './localWorkspaceHelpers.js';
import { layoutFixture as fixture } from './fixtures/layoutFixture.js';

// Touch editor flows on phone and tablet emulation (the mobile-* projects in playwright.config.cjs).
// The desktop projects ignore this file; desktop_layout_guard.spec.js pins the desktop editor.

const activePane = page => page.locator('[data-testid="project-pane"][data-active="true"]');
const isPhone = testInfo => testInfo.project.name.startsWith('mobile-phone');
const topBar = page => page.locator('[data-touch-chrome="top-bar"]');
const formatBar = page => page.getByRole('toolbar', { name: 'Text formatting' });
const overflowMenu = page => page.getByRole('dialog', { name: 'More actions' });
const viewport = page => page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
const horizontalOverflow = page => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const SHEET_PEEK_PX = 72; // PropertiesSheet.SHEET_PEEK_PX
const SHEET_FULL_INSET_PX = 56; // PropertiesSheet full detent: calc(100dvh - 56px)

// The desktop guard's fixture plus a text column spanning most of the page: once selected, its
// format bar has no room above it and clamps to the bottom of the visible band, where the phone
// tool pill lives. It sits right of the guard's elements so their taps are unaffected.
const mobileFixture = structuredClone(fixture);
mobileFixture.variants.default.templates.page.elements.push({
    id: 'tall', type: 'text', layerId: 'base', x: 380, y: 20, w: 200, h: 800, rotation: 0,
    fill: '', stroke: '', strokeWidth: 0, opacity: 1, text: 'Tall', autoWidth: false,
    fontSize: 18, fontFamily: 'helvetica', fontWeight: 'normal', fontStyle: 'normal',
    textColor: '#000000', textOverflow: 'clip', textWrap: true,
    textPadding: { top: 0, right: 0, bottom: 0, left: 0 },
});

const box = async locator => {
    const b = await locator.boundingBox();
    if (!b) throw new Error(`no bounding box for ${locator}`);
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
};

const within = (inner, outer) => inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * Multi-finger touch input. On Chromium every step goes through CDP as a real touch event, so the
 * browser produces the same `pointerType: 'touch'` events a device does, with live pointer ids.
 * Elsewhere PointerEvents are dispatched at the element under the finger, which is what the hook
 * consumes; the browser refuses pointer capture for such a pointer (NotFoundError), which the hook
 * tolerates. That path is validated by forcing it on mobile-phone-chromium: the whole spec passes.
 * Each CDP call carries the full set of fingers still down: the browser derives press/move/release
 * per finger from the difference to the previous call.
 */
class Fingers {
    constructor(page, browserName) {
        this.page = page;
        this.down_ = new Map();
        this.cdp = browserName === 'chromium' ? page.context().newCDPSession(page) : null;
    }

    async down(id, x, y) { this.down_.set(id, { x, y }); await this.send('touchStart', 'pointerdown', id, x, y); }
    async move(id, x, y) { this.down_.set(id, { x, y }); await this.send('touchMove', 'pointermove', id, x, y); }
    async up(id, x, y) { this.down_.delete(id); await this.send('touchEnd', 'pointerup', id, x, y); }

    async drag(from, to, steps = 6) {
        await this.down(1, from.x, from.y);
        for (let i = 1; i <= steps; i++) {
            await this.move(1, from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
        }
        await this.up(1, to.x, to.y);
    }

    async send(cdpType, domType, id, x, y) {
        if (this.cdp) {
            const client = await this.cdp;
            const touchPoints = [...this.down_].map(([pointId, point]) => ({ id: pointId, x: point.x, y: point.y }));
            await client.send('Input.dispatchTouchEvent', { type: cdpType, touchPoints });
            return;
        }
        await this.page.evaluate(([type, pointerId, clientX, clientY]) => {
            const targets = (window.__touchTargets ??= new Map());
            const target = type === 'pointerdown' ? document.elementFromPoint(clientX, clientY) : targets.get(pointerId);
            if (type === 'pointerdown') targets.set(pointerId, target);
            if (type === 'pointerup') targets.delete(pointerId);
            target?.dispatchEvent(new PointerEvent(type, {
                bubbles: true, cancelable: true, composed: true, clientX, clientY,
                pointerId, pointerType: 'touch', isPrimary: pointerId === 1,
                button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1,
            }));
        }, [domType, id, x, y]);
    }
}

test.beforeEach(async ({ page }) => {
    // Emulated browsers don't reliably report a coarse pointer; detection itself is unit-tested.
    await page.addInitScript(() => {
        const original = window.matchMedia.bind(window);
        window.matchMedia = query => (query === '(pointer: coarse)'
            ? { matches: true, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }
            : original(query));
    });
    await seedNativeProject(page, { id: 'mobile', name: 'Mobile', initialState: mobileFixture });
    await page.goto('/app');
    await expect(activePane(page).getByTestId('editor-canvas')).toBeVisible();
});

test('uses the touch layout for the device', async ({ page }, testInfo) => {
    const phone = isPhone(testInfo);
    await expect(page.locator('html')).toHaveAttribute('data-form-factor', phone ? 'phone' : 'tablet');
    // Phone replaces the page header and editor bar with the top bar; tablet keeps the page header
    // and has Export PDF in its single toolbar row.
    await expect(topBar(page)).toHaveCount(phone ? 1 : 0);
    await expect(page.getByRole('button', { name: 'Export PDF' })).toHaveCount(phone ? 0 : 1);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test('tap selects, drag moves, handle resizes', async ({ page, browserName }) => {
    const fingers = new Fingers(page, browserName);
    const pane = activePane(page);
    const rect = pane.locator('[data-element-id="box"]');
    const start = await box(rect);
    await page.touchscreen.tap(start.x, start.y);
    await expect(pane.locator('[data-resize-handle="se"]')).toBeVisible();

    await fingers.drag(start, { x: start.x + 40, y: start.y + 30 });
    await expect.poll(async () => (await box(rect)).b.x).toBeGreaterThan(start.b.x + 20);
    const moved = await box(rect);
    expect(moved.b.y).toBeGreaterThan(start.b.y + 10);

    const handle = await box(pane.locator('[data-resize-handle="se"]'));
    await fingers.drag(handle, { x: handle.x + 40, y: handle.y + 40 });
    await expect.poll(async () => (await box(rect)).b.width).toBeGreaterThan(moved.b.width + 20);
    const resized = await box(rect);
    expect(resized.b.height).toBeGreaterThan(moved.b.height + 20);
    // A resize from the south-east corner keeps the origin where the move left it.
    expect(Math.abs(resized.b.x - moved.b.x)).toBeLessThan(2);
    expect(Math.abs(resized.b.y - moved.b.y)).toBeLessThan(2);
});

test('double tap edits text; quick format bar applies bold', async ({ page }) => {
    const pane = activePane(page);
    const title = await box(pane.locator('[data-element-id="title"]'));
    await page.touchscreen.tap(title.x, title.y);
    await page.touchscreen.tap(title.x, title.y);
    const editor = pane.locator('[contenteditable="true"]');
    await expect(editor).toBeVisible();
    await expect(editor).toHaveCSS('font-weight', '700'); // the fixture title is bold

    const bold = formatBar(page).getByRole('button', { name: 'Bold' });
    await expect(bold).toHaveAttribute('aria-pressed', 'true');
    await bold.click();
    await expect(bold).toHaveAttribute('aria-pressed', 'false');
    await expect(editor).toHaveCSS('font-weight', '400');
    await expect(editor).toBeVisible(); // formatting from the bar never closes the inline editor
});

test('pinch zooms the canvas without scrolling the page', async ({ page, browserName }) => {
    const fingers = new Fingers(page, browserName);
    const canvas = activePane(page).getByTestId('editor-canvas');
    const before = (await canvas.boundingBox()).width;
    const c = await box(activePane(page).locator('.canvas-scroll-container'));
    await fingers.down(1, c.x - 40, c.y);
    await fingers.down(2, c.x + 40, c.y);
    for (let i = 1; i <= 5; i++) await fingers.move(2, c.x + 40 + i * 20, c.y);
    await fingers.up(2, c.x + 140, c.y);
    await fingers.up(1, c.x - 40, c.y);
    await expect.poll(async () => (await canvas.boundingBox()).width).toBeGreaterThan(before * 1.2);
    expect(await page.evaluate(() => window.scrollX + window.scrollY)).toBe(0);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test('drawer, sheet and overflow menu', async ({ page }, testInfo) => {
    const phone = isPhone(testInfo);
    await page.getByRole('button', { name: 'Open pages and templates' }).click();
    const drawer = page.getByRole('dialog', { name: 'Pages and templates' });
    await expect(drawer).toBeVisible();
    await page.getByTestId('sidebar-drawer-backdrop').click();
    await expect(drawer).toBeHidden();

    if (phone) {
        const sheet = page.getByTestId('properties-sheet');
        const grabber = page.getByRole('button', { name: 'Resize properties sheet' });
        const content = page.getByTestId('properties-sheet-content');
        const height = async () => (await sheet.boundingBox()).height;
        const { height: inner } = await viewport(page);
        expect(await height()).toBe(SHEET_PEEK_PX);
        await expect(content).toBeHidden();
        // A tap on the grabber cycles peek → half → full → peek.
        await grabber.click();
        await expect.poll(async () => Math.abs((await height()) - inner / 2)).toBeLessThanOrEqual(1);
        await expect(content).toBeVisible();
        await grabber.click();
        await expect.poll(async () => Math.abs((await height()) - (inner - SHEET_FULL_INSET_PX))).toBeLessThanOrEqual(1);
        await grabber.click();
        await expect.poll(height).toBe(SHEET_PEEK_PX);
        await expect(content).toBeHidden();
    }

    await page.getByRole('button', { name: 'More actions' }).click();
    const menu = overflowMenu(page);
    await expect(menu).toBeVisible();
    for (const group of ['Export', 'Canvas', 'Project']) await expect(menu.getByRole('heading', { name: group })).toBeVisible();
    const download = page.waitForEvent('download');
    if (phone) {
        await menu.getByRole('button', { name: 'Export PDF' }).click();
    } else {
        // Tablet keeps Export PDF in its toolbar row; the sheet closes from its backdrop.
        await page.getByTestId('overflow-menu-backdrop').click();
        await expect(menu).toBeHidden();
        await page.getByRole('button', { name: 'Export PDF' }).click();
    }
    expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
    await expect(menu).toBeHidden(); // a one-shot action closes the sheet
});

/** The device width first, then the narrower phones the layout must also serve. */
const phoneWidths = async page => {
    const device = await viewport(page);
    return [device.width, 360, 320].filter((w, i, all) => all.indexOf(w) === i).map(width => ({ width, height: device.height }));
};

test('phone top bar controls do not overlap', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), 'phone only');
    const bar = topBar(page);
    for (const { width, height } of await phoneWidths(page)) {
        await page.setViewportSize({ width, height });
        await expect(bar.getByRole('status')).toBeVisible();
        await expect(bar.getByRole('status')).toHaveText(/Sav(ed|ing) locally/);
        for (const name of ['Open pages and templates', 'Undo', 'Redo', 'More actions']) {
            await expect(bar.getByRole('button', { name })).toBeVisible();
        }
        const projectName = bar.getByRole('button', { name: 'Mobile' });
        await expect(projectName).toBeVisible();
        // The whole project name shows: not ellipsised, not squeezed under a neighbour.
        const label = projectName.locator('span').first();
        await expect.poll(() => label.evaluate(el => el.scrollWidth - el.clientWidth), `name intact at ${width}px`).toBeLessThanOrEqual(0);

        const controls = bar.locator('button, [role="status"], [role="alert"]');
        const count = await controls.count();
        expect(count).toBeGreaterThanOrEqual(6);
        const boxes = [];
        for (let i = 0; i < count; i++) boxes.push(await controls.nth(i).boundingBox());
        for (let i = 0; i < boxes.length; i++) {
            expect(within(boxes[i], { x: 0, y: 0, width, height }), `control ${i} inside the ${width}px viewport`).toBe(true);
            for (let j = i + 1; j < boxes.length; j++) {
                expect(overlaps(boxes[i], boxes[j]), `controls ${i} and ${j} overlap at ${width}px`).toBe(false);
            }
        }
    }
});

test('phone tool pill keeps all nine tools, Fit included, inside the viewport', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), 'phone only');
    const pill = page.getByTestId('touch-tool-pill');
    const tools = pill.getByRole('button');
    for (const { width, height } of await phoneWidths(page)) {
        await page.setViewportSize({ width, height });
        await expect(tools).toHaveCount(9);
        await expect(pill.getByRole('button', { name: 'Fit page to width' })).toBeVisible();
        const screen = { x: 0, y: 0, width, height };
        const pillBox = await pill.boundingBox();
        expect(within(pillBox, screen), `pill inside the ${width}px viewport`).toBe(true);
        for (let i = 0; i < 9; i++) {
            const b = await tools.nth(i).boundingBox();
            expect(b.width, `tool ${i} width at ${width}px`).toBeGreaterThanOrEqual(44);
            expect(b.height, `tool ${i} height at ${width}px`).toBeGreaterThanOrEqual(44);
            expect(within(b, pillBox), `tool ${i} inside the pill at ${width}px`).toBe(true);
        }
        // The pill floats above the properties sheet's grabber, never under it.
        const sheet = await page.getByTestId('properties-sheet').boundingBox();
        expect(pillBox.y + pillBox.height, `pill clears the sheet at ${width}px`).toBeLessThanOrEqual(sheet.y);
        expect(await horizontalOverflow(page), `no horizontal scroll at ${width}px`).toBeLessThanOrEqual(0);
    }
});

/** Refit the page to the current width (the layout refits on rotation, not on a plain resize). */
const fitPage = async (page, width) => {
    const canvas = activePane(page).getByTestId('editor-canvas');
    await page.getByRole('button', { name: 'Fit page to width' }).click();
    await expect.poll(async () => Math.abs((await canvas.boundingBox()).width - (width - 32))).toBeLessThanOrEqual(1);
};

test('phone quick format bar clamps above the tool pill, never over it', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), 'phone only');
    const pane = activePane(page);
    const bar = formatBar(page);
    const pill = page.getByTestId('touch-tool-pill');
    for (const { width, height } of await phoneWidths(page)) {
        await page.setViewportSize({ width, height });
        await fitPage(page, width);
        const tall = await box(pane.locator('[data-element-id="tall"]'));
        await page.touchscreen.tap(tall.x, tall.y);
        await expect(bar).toBeVisible();
        const b = await bar.boundingBox();
        const p = await pill.boundingBox();
        const sheet = await page.getByTestId('properties-sheet').boundingBox();
        expect(within(b, { x: 0, y: 0, width, height }), `bar inside the ${width}px viewport`).toBe(true);
        expect(b.y + b.height, `bar clears the pill at ${width}px`).toBeLessThanOrEqual(p.y);
        expect(p.y + p.height, `pill clears the sheet at ${width}px`).toBeLessThanOrEqual(sheet.y);
        await page.touchscreen.tap(6, tall.y); // the gutter beside the page: deselects, the bar goes
        await expect(bar).toBeHidden();
    }
});

test('phone canvas scrolls the page bottom clear of the tool pill', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), 'phone only');
    const outer = activePane(page).locator('.canvas-scroll-container');
    const canvas = activePane(page).getByTestId('editor-canvas');
    const pill = page.getByTestId('touch-tool-pill');
    for (const { width, height } of await phoneWidths(page)) {
        await page.setViewportSize({ width, height });
        await fitPage(page, width);
        await outer.evaluate(el => { el.scrollTop = el.scrollHeight; });
        const p = await pill.boundingBox();
        await expect.poll(async () => { const c = await canvas.boundingBox(); return c.y + c.height; }, `page bottom above the pill at ${width}px`)
            .toBeLessThanOrEqual(p.y);
    }
});

test('layer colour swatches stay reachable', async ({ page }, testInfo) => {
    if (isPhone(testInfo)) {
        await page.getByRole('button', { name: 'Resize properties sheet' }).click();
        await expect(page.getByTestId('properties-sheet').locator(':scope > div').last()).toBeVisible();
    }
    const toggle = page.getByTestId('layers-section').getByRole('button', { name: 'Layers' });
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    const row = page.getByTestId('layer-row-base');
    await row.scrollIntoViewIfNeeded();
    await row.getByTitle('Layer color').click();
    const swatches = row.locator('[data-testid^="layer-color-swatch-"]');
    await expect(swatches).toHaveCount(6);
    await swatches.first().scrollIntoViewIfNeeded();
    const { width, height } = await viewport(page);
    for (let i = 0; i < 6; i++) {
        const b = await swatches.nth(i).boundingBox();
        expect(b.width, `swatch ${i} width`).toBeGreaterThanOrEqual(44);
        expect(b.height, `swatch ${i} height`).toBeGreaterThanOrEqual(44);
        expect(within(b, { x: 0, y: 0, width, height }), `swatch ${i} inside the viewport`).toBe(true);
        // Nothing clips or covers it: the swatch is what a tap at its centre reaches.
        const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.getAttribute('data-testid') ?? null,
            [b.x + b.width / 2, b.y + b.height / 2]);
        expect(hit, `swatch ${i} under its own centre`).toMatch(/^layer-color-swatch-/);
    }
    await row.getByTestId('layer-color-swatch-#ef4444').click();
    await expect(swatches).toHaveCount(0);
    await expect(row.getByTitle('Layer color')).toHaveCSS('background-color', 'rgb(239, 68, 68)');
});

test('phone overflow menu offers Home, Gallery and Docs', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), 'phone only');
    await page.getByRole('button', { name: 'More actions' }).click();
    const menu = overflowMenu(page);
    await expect(menu.getByRole('heading', { name: 'Navigate' })).toBeVisible();
    for (const [name, href] of [['Home', '/'], ['Gallery', '/gallery'], ['Docs', '/docs']]) {
        const link = menu.getByRole('link', { name, exact: true });
        await expect(link).toBeVisible();
        await expect(link).toHaveAttribute('href', href);
    }
});
