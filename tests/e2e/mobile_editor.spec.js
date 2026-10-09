import { test, expect } from '@playwright/test';
import { apiSignUpAndVerify } from './helpers.js';
import { readActiveProject, seedNativeProject } from './localWorkspaceHelpers.js';
import { layoutFixture as fixture } from './fixtures/layoutFixture.js';

const API_BASE = process.env.E2E_API_BASE || 'http://localhost:3001';

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

// The desktop guard's fixture plus two elements of its own, placed so the guard elements' own taps
// are unaffected: a text column spanning most of the page (once selected, its format bar has no
// room above it and clamps to the bottom of the visible band, where the phone tool pill lives), and
// a small rect over the top-left corner of the guard's box, clear of the box's centre (a long press
// on the badge finds two stacked elements).
const mobileFixture = structuredClone(fixture);
mobileFixture.variants.default.templates.page.elements.push({
    id: 'tall', type: 'text', layerId: 'base', x: 380, y: 20, w: 200, h: 800, rotation: 0,
    fill: '', stroke: '', strokeWidth: 0, opacity: 1, text: 'Tall', autoWidth: false,
    fontSize: 18, fontFamily: 'helvetica', fontWeight: 'normal', fontStyle: 'normal',
    textColor: '#000000', textOverflow: 'clip', textWrap: true,
    textPadding: { top: 0, right: 0, bottom: 0, left: 0 },
}, {
    id: 'badge', type: 'rect', layerId: 'base', x: 70, y: 90, w: 60, h: 60, rotation: 0,
    fill: '#fde68a', stroke: '#000000', strokeWidth: 1, opacity: 1,
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
 * tolerates. Each CDP call carries the full set of fingers still down: the browser derives
 * press/move/release per finger from the difference to the previous call.
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

    /**
     * Two taps at one point, issued as one sequence so the gesture hook's DOUBLE_TAP_MS window
     * (measured between the two lifts, wall clock) cannot be missed under load: on Chromium the
     * four CDP commands are queued back to back (a session handles them in order) rather than
     * each awaiting its round trip; elsewhere the four pointer events are dispatched in one
     * evaluate. Nothing is down before or after.
     */
    async doubleTap(x, y) {
        if (this.down_.size) throw new Error('doubleTap with fingers down');
        if (this.cdp) {
            const client = await this.cdp;
            const touchPoints = [{ id: 1, x, y }];
            await Promise.all([
                client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints }),
                client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
                client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints }),
                client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
            ]);
            return;
        }
        await this.page.evaluate(([clientX, clientY]) => {
            const target = document.elementFromPoint(clientX, clientY);
            for (const type of ['pointerdown', 'pointerup', 'pointerdown', 'pointerup']) {
                target?.dispatchEvent(new PointerEvent(type, {
                    bubbles: true, cancelable: true, composed: true, clientX, clientY,
                    pointerId: 1, pointerType: 'touch', isPrimary: true,
                    button: 0, buttons: type === 'pointerup' ? 0 : 1,
                }));
            }
        }, [x, y]);
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
    // Both touch layouts tag their top row as the top bar (the quick format bar keeps clear of it).
    // Phone replaces the page header and editor bar with a bar that holds the project switcher;
    // tablet keeps the page header and has Export PDF in its single toolbar row.
    await expect(topBar(page)).toHaveCount(1);
    await expect(topBar(page).getByRole('button', { name: 'Mobile' })).toHaveCount(phone ? 1 : 0);
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

test('double tap edits text; quick format bar applies bold', async ({ page, browserName }) => {
    const fingers = new Fingers(page, browserName);
    const pane = activePane(page);
    const title = await box(pane.locator('[data-element-id="title"]'));
    await fingers.doubleTap(title.x, title.y);
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

// R43 (supersedes R29's wrapping): the tools sit in one row that swipes sideways when the screen is
// narrower than it, with Fit pinned outside the scroller so it never scrolls away.
test('phone tool pill keeps all ten controls in one swipeable row, Fit pinned, inside the viewport', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), 'phone only');
    const pill = page.getByTestId('touch-tool-pill');
    const tools = pill.getByRole('button');
    const scroller = pill.locator('[data-touch-pill-scroller]');
    const fit = pill.getByRole('button', { name: 'Fit page to width' });
    for (const { width, height } of await phoneWidths(page)) {
        await page.setViewportSize({ width, height });
        await expect(tools).toHaveCount(10);
        const screen = { x: 0, y: 0, width, height };
        const pillBox = await pill.boundingBox();
        expect(within(pillBox, screen), `pill inside the ${width}px viewport`).toBe(true);
        expect(pillBox.height, `pill is one row at ${width}px`).toBeLessThan(2 * 44);
        for (let i = 0; i < 10; i++) {
            const b = await tools.nth(i).boundingBox();
            expect(b.width, `tool ${i} width at ${width}px`).toBeGreaterThanOrEqual(44);
            expect(b.height, `tool ${i} height at ${width}px`).toBeGreaterThanOrEqual(44);
        }
        // The row is wider than any phone: it scrolls, and says so with the end fade.
        expect(await scroller.evaluate(el => el.scrollWidth > el.clientWidth), `row overflows at ${width}px`).toBe(true);
        await expect(pill.getByTestId('tool-pill-fade-end')).toBeVisible();
        // Every tool can be scrolled into the pill; Fit stays put while the row moves.
        const fitBefore = await fit.boundingBox();
        expect(within(fitBefore, pillBox), `Fit inside the pill at ${width}px`).toBe(true);
        for (const [name, edge] of [['Grid', 'end'], ['Select', 'start']]) {
            await scroller.evaluate((el, toEnd) => { el.scrollLeft = toEnd ? el.scrollWidth : 0; }, edge === 'end');
            const row = await scroller.boundingBox();
            await expect.poll(async () => within(await pill.getByRole('button', { name, exact: true }).boundingBox(), row), `${name} scrolls into view at ${width}px`).toBe(true);
            expect(await fit.boundingBox(), `Fit pinned at ${width}px`).toEqual(fitBefore);
        }
        // The pill floats above the properties sheet's grabber, never under it.
        const sheet = await page.getByTestId('properties-sheet').boundingBox();
        expect(pillBox.y + pillBox.height, `pill clears the sheet at ${width}px`).toBeLessThanOrEqual(sheet.y);
        expect(await horizontalOverflow(page), `no horizontal scroll at ${width}px`).toBeLessThanOrEqual(0);
    }
});

test('swiping the tool pill scrolls the row, not the canvas', async ({ page, browserName }, testInfo) => {
    test.skip(!isPhone(testInfo), 'phone only');
    test.skip(browserName !== 'chromium', 'CDP touch input');
    const scroller = page.getByTestId('touch-tool-pill').locator('[data-touch-pill-scroller]');
    const canvasScroll = activePane(page).locator('.canvas-scroll-container');
    const canvasBefore = await canvasScroll.evaluate(el => [el.scrollLeft, el.scrollTop]);
    const canvasBox = await activePane(page).getByTestId('editor-canvas').boundingBox();
    const box = await scroller.boundingBox();
    const client = await page.context().newCDPSession(page);
    const y = box.y + box.height / 2;
    const at = x => [{ id: 1, x, y }];
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(box.x + box.width - 10) });
    for (let step = 1; step <= 10; step++) {
        await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(box.x + box.width - 10 - step * 15) });
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => scroller.evaluate(el => el.scrollLeft), 'row scrolled').toBeGreaterThan(0);
    expect(await canvasScroll.evaluate(el => [el.scrollLeft, el.scrollTop]), 'canvas not panned').toEqual(canvasBefore);
    expect(await activePane(page).getByTestId('editor-canvas').boundingBox(), 'canvas not zoomed or moved').toEqual(canvasBox);
    await expect(page.getByTestId('tool-pill-fade-start')).toBeVisible();
});

/** The page is fitted: its box spans the scroll container's width minus the 16px gutter each side (TOUCH_CANVAS_GUTTER). */
const expectPageFitted = async (page, label) => {
    const pane = activePane(page);
    const canvas = pane.getByTestId('editor-canvas');
    const outer = pane.locator('.canvas-scroll-container');
    await expect.poll(async () => {
        const c = await canvas.boundingBox();
        const o = await outer.boundingBox();
        if (!c || !o) return 'no box';
        const inner = await outer.evaluate(el => el.clientWidth);
        return Math.abs(c.width - (inner - 32)) <= 1 && c.x >= o.x && c.x + c.width <= o.x + o.width ? 'fitted' : `page ${c.x}..${c.x + c.width} in container ${o.x}..${o.x + o.width} (inner ${inner})`;
    }, label).toBe('fitted');
};

// Task 24: a page that is wider than the phone must not load cut off at the right edge (fit runs
// on first load, on a project switch and on rotation, not only from the Fit button).
test('phone fits the page to the width on first load, on a project switch and after rotation', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), 'phone only');
    const device = await viewport(page);
    // Every open project keeps its pane (and top bar) mounted; only the active one is on screen.
    const activeBar = () => activePane(page).locator('[data-touch-chrome="top-bar"]');
    await expectPageFitted(page, 'first load');
    // A fresh Blank Project (A4) from the switcher: a new pane whose canvas mounts while the switch happens.
    await activeBar().getByRole('button', { name: 'Mobile' }).click();
    await page.getByRole('menuitem', { name: 'New project' }).click();
    await page.getByRole('dialog', { name: 'Create New Project' }).getByRole('button', { name: /^Blank Project/ }).click();
    await expect(activeBar().getByRole('button', { name: 'Blank Project' })).toBeVisible();
    await expectPageFitted(page, 'new blank project');
    // Back to the first project through the switcher, then rotate both ways.
    await activeBar().getByRole('button', { name: 'Blank Project' }).click();
    await page.getByRole('menuitem', { name: /^Mobile/ }).click();
    await expect(activeBar().getByRole('button', { name: 'Mobile' })).toBeVisible();
    await expectPageFitted(page, 'switched back');
    await page.setViewportSize({ width: device.height, height: device.width });
    await expectPageFitted(page, 'landscape');
    await page.setViewportSize(device);
    await expectPageFitted(page, 'portrait again');
});

/** Refit the page to the canvas container (the layout refits on rotation, not on a plain resize). */
const fitPage = async page => {
    const pane = activePane(page);
    const canvas = pane.getByTestId('editor-canvas');
    const outer = pane.locator('.canvas-scroll-container');
    await page.getByRole('button', { name: 'Fit page to width' }).click();
    await expect.poll(async () => Math.abs((await canvas.boundingBox()).width - ((await outer.evaluate(el => el.clientWidth)) - 32)))
        .toBeLessThanOrEqual(1);
};

test('phone quick format bar clamps above the tool pill, never over it', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), 'phone only');
    const pane = activePane(page);
    const bar = formatBar(page);
    const pill = page.getByTestId('touch-tool-pill');
    for (const { width, height } of await phoneWidths(page)) {
        await page.setViewportSize({ width, height });
        await fitPage(page);
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
        await fitPage(page);
        await outer.evaluate(el => { el.scrollTop = el.scrollHeight; });
        const p = await pill.boundingBox();
        await expect.poll(async () => { const c = await canvas.boundingBox(); return c.y + c.height; }, `page bottom above the pill at ${width}px`)
            .toBeLessThanOrEqual(p.y);
    }
});

test('long press over stacked elements opens a menu sized to its rows', async ({ page, browserName }) => {
    // The menu renders beside the page's content wrapper, inside the same scroll container, so the
    // phone's scroll room for the tool pill (bottom padding on the wrapper) must never reach it.
    const fingers = new Fingers(page, browserName);
    const pane = activePane(page);
    await fitPage(page);
    const badge = await box(pane.locator('[data-element-id="badge"]'));
    const menu = page.getByTestId('select-under-menu');
    await fingers.down(1, badge.x, badge.y);
    await expect(menu).toBeVisible(); // opens LONG_PRESS_MS after the finger lands, before it lifts
    await fingers.up(1, badge.x, badge.y);
    await expect(menu).toBeVisible(); // the release after a long press is inert
    const rows = menu.locator('[data-menu-element-id]');
    await expect(rows).toHaveCount(2);
    expect(await rows.evaluateAll(els => els.map(el => el.getAttribute('data-menu-element-id')))).toEqual(expect.arrayContaining(['badge', 'box']));
    const fit = await menu.evaluate(el => {
        const own = el.getBoundingClientRect();
        const last = el.lastElementChild.getBoundingClientRect();
        return { paddingBottom: parseFloat(getComputedStyle(el).paddingBottom), underLastRow: own.bottom - last.bottom, overflow: el.scrollHeight - el.clientHeight };
    });
    expect(fit.paddingBottom, 'menu bottom padding').toBeLessThanOrEqual(8);
    expect(fit.underLastRow, 'blank space under the last row').toBeLessThanOrEqual(8);
    expect(fit.overflow, 'no row needs scrolling').toBeLessThanOrEqual(0);
    await page.touchscreen.tap(6, badge.y); // a tap outside closes it
    await expect(menu).toBeHidden();
});

test('layer colour swatches stay reachable', async ({ page }, testInfo) => {
    if (isPhone(testInfo)) {
        await page.getByRole('button', { name: 'Resize properties sheet' }).click();
        await expect(page.getByTestId('properties-sheet-content')).toBeVisible();
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

/**
 * Widths the dialog headers must fit: the device, then the narrower phones (as phoneWidths) or
 * the classic 768px iPad in portrait, which has the same tablet layout and less room.
 */
const dialogWidths = async (page, testInfo) => {
    if (isPhone(testInfo)) return phoneWidths(page);
    const device = await viewport(page);
    return [device.width, 768].filter((w, i, all) => all.indexOf(w) === i).map(width => ({ width, height: device.height }));
};

/** The control is visible and its whole box lies inside `screen`; returns the box. */
const onScreen = async (locator, screen, label) => {
    await expect(locator, label).toBeVisible();
    const b = await locator.boundingBox();
    expect(within(b, screen), `${label} inside the ${screen.width}px viewport`).toBe(true);
    return b;
};
const sidewaysOverflow = panel => panel.evaluate(el => el.scrollWidth - el.clientWidth);
/** aria-label of the button a tap at the centre of `b` reaches (null when something covers it). */
const buttonAt = (page, b) => page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label') ?? null,
    [b.x + b.width / 2, b.y + b.height / 2]);
const openFromOverflow = async (page, item) => {
    await page.getByRole('button', { name: 'More actions' }).click();
    await overflowMenu(page).getByRole('button', { name: item }).click();
};

test('dialogs keep Close and their primary actions inside the viewport, with no sideways overflow', async ({ page }, testInfo) => {
    const phone = isPhone(testInfo);
    const device = await viewport(page);
    for (const { width, height } of await dialogWidths(page, testInfo)) {
        await page.setViewportSize({ width, height });
        const screen = { x: 0, y: 0, width, height };

        // Generator: its header is wider than any phone, so on touch it wraps with Close pinned to
        // the title row's right end and Preview / Apply in the row below. Touch has no Escape, so a
        // Close that is off-screen traps the user.
        await openFromOverflow(page, 'Generator');
        const generator = page.getByRole('dialog', { name: 'Hierarchy Generator' });
        await expect(generator).toBeVisible();
        expect(await sidewaysOverflow(generator), `generator panel overflow at ${width}px`).toBeLessThanOrEqual(0);
        const close = await onScreen(generator.getByRole('button', { name: 'Close generator' }), screen, 'Close generator');
        const title = await generator.getByRole('heading', { name: 'Hierarchy Generator' }).boundingBox();
        expect(close.y, `Close shares the title row at ${width}px`).toBeLessThan(title.y + title.height);
        expect(close.x + close.width, `Close at the right edge at ${width}px`).toBeGreaterThan(width - 32);
        // On tablet the page header (root z-20) out-ranks the project pane, so a full-screen panel
        // must not put Close under it: the tap must reach the button itself.
        expect(await buttonAt(page, close), `Close generator is the hit target at ${width}px`).toBe('Close generator');
        await onScreen(generator.getByRole('combobox', { name: 'Preset:' }), screen, 'Preset');
        await onScreen(generator.getByRole('button', { name: 'Preview', exact: true }), screen, 'Preview');
        await onScreen(generator.getByRole('button', { name: 'Apply Generated Project' }), screen, 'Apply');
        // Preview runs the preset in the sandbox and opens the visual preview over the generator;
        // its own Close must be reachable too. The sandbox run is the slow part and does not
        // depend on the width, so it runs once, at the device width; the layout and hit-target
        // checks above and below still run at every width.
        if (width === device.width) {
            await generator.getByRole('button', { name: 'Preview', exact: true }).click();
            const preview = page.getByRole('dialog', { name: 'Generated Project Preview' });
            await expect(preview).toBeVisible();
            expect(await sidewaysOverflow(preview), `preview panel overflow at ${width}px`).toBeLessThanOrEqual(0);
            await onScreen(preview.getByRole('button', { name: 'Close preview' }), screen, 'Close preview');
            await preview.getByRole('button', { name: 'Close preview' }).click();
            await expect(preview).toBeHidden();
        }
        await generator.getByRole('button', { name: 'Close generator' }).click();
        await expect(generator).toBeHidden();

        // JSON editor: the mode toggle drops below the title on phones so Close stays on-screen.
        await openFromOverflow(page, 'JSON');
        const json = page.locator('.editor-dialog-panel', { has: page.getByRole('heading', { name: 'Project JSON Editor' }) });
        await expect(json).toBeVisible();
        expect(await sidewaysOverflow(json), `JSON panel overflow at ${width}px`).toBeLessThanOrEqual(0);
        const jsonClose = await onScreen(json.getByRole('button', { name: 'Close JSON editor' }), screen, 'Close JSON editor');
        expect(await buttonAt(page, jsonClose), `Close JSON editor is the hit target at ${width}px`).toBe('Close JSON editor');
        for (const name of ['Visual', 'Text', 'Cancel', 'Apply Changes']) await onScreen(json.getByRole('button', { name }), screen, name);
        await json.getByRole('button', { name: 'Close JSON editor' }).click();
        await expect(json).toBeHidden();

        // Save preset
        await openFromOverflow(page, 'Save preset');
        const preset = page.getByRole('dialog', { name: /Save.*Preset/i });
        await expect(preset).toBeVisible();
        expect(await sidewaysOverflow(preset), `preset panel overflow at ${width}px`).toBeLessThanOrEqual(0);
        await onScreen(preset.getByRole('button', { name: 'Close save preset' }), screen, 'Close save preset');
        await onScreen(preset.getByRole('button', { name: 'Save Preset', exact: true }), screen, 'Save Preset');
        await preset.getByRole('button', { name: 'Close save preset' }).click();
        await expect(preset).toBeHidden();

        // New project (page-level, also an editor-dialog-panel): from the phone's project switcher
        // or the tablet's tab strip.
        if (phone) {
            await topBar(page).getByRole('button', { name: 'Mobile' }).click();
            await page.getByRole('menuitem', { name: 'New project' }).click();
        } else {
            await page.getByTitle('New Project').click();
        }
        const newProject = page.getByRole('dialog', { name: 'Create New Project' });
        await expect(newProject).toBeVisible();
        expect(await sidewaysOverflow(newProject), `new project panel overflow at ${width}px`).toBeLessThanOrEqual(0);
        await onScreen(newProject.getByRole('button', { name: 'Close new project' }), screen, 'Close new project');
        await newProject.getByRole('button', { name: 'Close new project' }).click();
        await expect(newProject).toBeHidden();
    }
});

test('quick format bar is never the hit target under the overflow sheet, the drawer or a dialog', async ({ page }) => {
    const pane = activePane(page);
    const bar = formatBar(page);
    const title = await box(pane.locator('[data-element-id="title"]'));
    await page.touchscreen.tap(title.x, title.y);
    await expect(bar).toBeVisible();
    const centre = await box(bar);
    // What a tap at the bar's centre reaches: the bar's own toolbar label, or whatever covers it.
    const hit = () => page.evaluate(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return el?.closest('[role="toolbar"]')?.getAttribute('aria-label') ?? el?.tagName?.toLowerCase() ?? null;
    }, [centre.x, centre.y]);
    expect(await hit(), 'the bar is reachable on its own').toBe('Text formatting');

    await page.getByRole('button', { name: 'More actions' }).click();
    await expect(overflowMenu(page)).toBeVisible();
    expect(await hit(), 'the overflow sheet covers the bar').not.toBe('Text formatting');
    await page.getByTestId('overflow-menu-backdrop').click();
    await expect(overflowMenu(page)).toBeHidden();
    expect(await hit(), 'the bar is reachable again once the sheet closes').toBe('Text formatting');

    await page.getByRole('button', { name: 'Open pages and templates' }).click();
    const drawer = page.getByRole('dialog', { name: 'Pages and templates' });
    await expect(drawer).toBeVisible();
    expect(await hit(), 'the drawer covers the bar').not.toBe('Text formatting');
    await page.getByTestId('sidebar-drawer-backdrop').click();
    await expect(drawer).toBeHidden();

    await openFromOverflow(page, 'Generator');
    const generator = page.getByRole('dialog', { name: 'Hierarchy Generator' });
    await expect(generator).toBeVisible();
    expect(await hit(), 'the generator dialog covers the bar').not.toBe('Text formatting');
    await generator.getByRole('button', { name: 'Close generator' }).click();
    await expect(generator).toBeHidden();
    expect(await hit(), 'the bar is reachable again once the dialog closes').toBe('Text formatting');
});

test('phone overflow menu offers Home, Gallery and Docs; a followed row replaces the sheet\'s history entry', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), 'phone only');
    await page.getByRole('button', { name: 'More actions' }).click();
    const menu = overflowMenu(page);
    await expect(menu.getByRole('heading', { name: 'Navigate' })).toBeVisible();
    for (const [name, href] of [['Home', '/'], ['Gallery', '/gallery'], ['Docs', '/docs']]) {
        const link = menu.getByRole('link', { name, exact: true });
        await expect(link).toBeVisible();
        await expect(link).toHaveAttribute('href', href);
    }
    // The open sheet holds one history entry above the editor's. Following a row leaves the editor
    // in the same render, so that entry is replaced by the destination rather than left behind:
    // history is no longer than it was with the sheet open, and one back lands on the bare editor.
    await expect.poll(() => overlayDepth(page)).toBe(1);
    const length = await page.evaluate(() => history.length);
    await menu.getByRole('link', { name: 'Docs', exact: true }).click();
    await expect.poll(() => pathname(page)).toBe('/docs');
    expect(await page.evaluate(() => history.length)).toBe(length);
    await page.goBack();
    await expect(activePane(page).getByTestId('editor-canvas')).toBeVisible();
    expect(pathname(page)).toBe('/app');
    await expect.poll(() => overlayDepth(page)).toBe(0);
    await expect(menu).toBeHidden();
});

test('Select multiple: taps build the selection, a drag moves all of it, Arrange aligns it', async ({ page, browserName }, testInfo) => {
    const phone = isPhone(testInfo);
    const fingers = new Fingers(page, browserName);
    const pane = activePane(page);
    await fitPage(page);
    const rect = pane.locator('[data-element-id="box"]');
    const tall = pane.locator('[data-element-id="tall"]');
    const handles = pane.locator('[data-resize-handle]');
    // Phone labels the sheet "2 elements"; tablet's docked panel shows the multi-edit banner.
    const twoSelected = phone ? page.getByRole('button', { name: 'Resize properties sheet' }) : page.getByText('2 items selected');
    const expectTwoSelected = () => phone ? expect(twoSelected).toContainText('2 elements') : expect(twoSelected).toBeVisible();

    const toggle = page.getByRole('button', { name: 'Select multiple' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');

    const rectStart = await box(rect);
    const tallStart = await box(tall);
    await page.touchscreen.tap(rectStart.x, rectStart.y);
    await page.touchscreen.tap(tallStart.x, tallStart.y);
    await expectTwoSelected();
    await page.touchscreen.tap(6, rectStart.y); // the gutter beside the page: inert while the toggle is on
    await expectTwoSelected();

    // Dragging either selected element moves both by the same amount.
    await fingers.drag(rectStart, { x: rectStart.x + 40, y: rectStart.y + 30 });
    await expect.poll(async () => (await box(rect)).b.x).toBeGreaterThan(rectStart.b.x + 20);
    const rectMoved = await box(rect);
    const tallMoved = await box(tall);
    expect(Math.abs((tallMoved.b.x - tallStart.b.x) - (rectMoved.b.x - rectStart.b.x))).toBeLessThan(2);
    expect(Math.abs((tallMoved.b.y - tallStart.b.y) - (rectMoved.b.y - rectStart.b.y))).toBeLessThan(2);
    expect(rectMoved.b.y).toBeGreaterThan(rectStart.b.y + 10);
    await expectTwoSelected();

    // Arrange → Align left: the text column lines up with the rect, the leftmost, which stays put.
    await page.getByRole('button', { name: 'More actions' }).click();
    const menu = overflowMenu(page);
    await expect(menu.getByRole('heading', { name: 'Arrange' })).toBeVisible();
    await menu.getByRole('button', { name: 'Align left' }).click();
    await expect(menu).toBeHidden();
    await expect.poll(async () => Math.abs((await box(tall)).b.x - (await box(rect)).b.x)).toBeLessThan(2);
    expect(Math.abs((await box(rect)).b.x - rectMoved.b.x)).toBeLessThan(2);
    await expectTwoSelected();

    // Tapping a selected element takes it out; turning the toggle off keeps what is left; Clear
    // selection in ⋯ empties it, after which Arrange is gone.
    const tallAligned = await box(tall);
    await page.touchscreen.tap(tallAligned.x, tallAligned.y + 120); // the column, below the rect
    if (phone) await expect(twoSelected).not.toContainText('2 elements');
    await expect(page.getByText('2 items selected')).toHaveCount(0);
    await expect(handles.first()).toBeVisible(); // one element still selected
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(handles.first()).toBeVisible();
    await page.getByRole('button', { name: 'More actions' }).click();
    await expect(menu.getByRole('heading', { name: 'Arrange' })).toHaveCount(0);
    await menu.getByRole('button', { name: 'Clear selection' }).click();
    await expect(menu).toBeHidden();
    await expect(handles).toHaveCount(0);
    if (phone) await expect(twoSelected).toContainText('Page ·');
});

test('numeric fields get touch −/+ steppers that fit their scroller, tap once, hold to repeat, scroll on a drag and undo per nudge', async ({ page, browserName }, testInfo) => {
    const phone = isPhone(testInfo);
    const fingers = new Fingers(page, browserName);
    const pane = activePane(page);
    // The fixed-size text: its Typography section carries the padding steppers as well.
    const start = await box(pane.locator('[data-element-id="title"]'));
    await page.touchscreen.tap(start.x, start.y);
    await expect(pane.locator('[data-resize-handle="se"]')).toBeVisible();
    if (phone) {
        const grabber = page.getByRole('button', { name: 'Resize properties sheet' });
        await grabber.click(); // half
        await grabber.click(); // full
    }
    const control = name => page.getByRole('button', { name });
    const field = name => page.getByLabel(name, { exact: true });
    const input = field('X');

    // Each target is measured against the scroll container it lives in (the phone sheet's content
    // or the tablet panel): a document-level overflow check cannot see sideways overflow inside a
    // scroller. Phone repeats the check down to 320px.
    const scrollerHandle = locator => locator.evaluateHandle(el => {
        let node = el.parentElement;
        while (node && !/(auto|scroll)/.test(getComputedStyle(node).overflowY)) node = node.parentElement;
        if (!node) throw new Error('no scroll container');
        return node;
    });
    const scrollerOf = async locator => (await scrollerHandle(locator)).evaluate(node => {
        const r = node.getBoundingClientRect();
        return { x: r.x, width: r.width, sideways: node.scrollWidth - node.clientWidth };
    });
    const fits = async () => {
        const { width } = await viewport(page);
        const buttons = ['Decrease X', 'Increase X', 'Decrease Z-Index', 'Increase Z-Index', 'Decrease left padding', 'Increase left padding'].map(control);
        buttons.push(page.getByTitle('Bring Forward'), page.getByTitle('Send Backward'));
        const inputs = [input, field('Z-Index'), field('Padding left')];
        for (const target of [...buttons, ...inputs]) {
            await target.scrollIntoViewIfNeeded();
            const name = `${await target.evaluate(el => el.getAttribute('aria-label') || el.title || el.id)} at ${width}px`;
            const b = await target.boundingBox();
            const s = await scrollerOf(target);
            if (buttons.includes(target)) expect(b.width, name).toBeGreaterThanOrEqual(44);
            expect(b.height, name).toBeGreaterThanOrEqual(44);
            expect(b.x, name).toBeGreaterThanOrEqual(s.x);
            expect(b.x + b.width, name).toBeLessThanOrEqual(s.x + s.width + 0.5);
            expect(s.sideways, name).toBeLessThanOrEqual(0);
        }
        expect(await input.evaluate(el => getComputedStyle(el).fontSize)).toBe('16px');
        expect(await page.locator('[data-micro-stepper]').count()).toBe(0);
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    };
    if (phone) {
        for (const { width, height } of await phoneWidths(page)) {
            await page.setViewportSize({ width, height });
            await fits();
        }
    } else {
        await fits();
    }

    // A real touch tap (pointerdown, pointerup, then click) nudges exactly once, without focusing
    // the input (which would raise the on-screen keyboard).
    const increase = control('Increase X');
    await increase.scrollIntoViewIfNeeded();
    const before = Number(await input.inputValue());
    const plus = await box(increase);
    await page.touchscreen.tap(plus.x, plus.y);
    await expect(input).toHaveValue(String(before + 1));
    expect(await input.evaluate(el => document.activeElement === el)).toBe(false);

    // A finger that stays put repeats after the initial delay; lifting it stops the repeat.
    await fingers.down(1, plus.x, plus.y);
    await page.waitForTimeout(600);
    await fingers.up(1, plus.x, plus.y);
    await expect.poll(async () => Number(await input.inputValue())).toBeGreaterThan(before + 3);
    const held = Number(await input.inputValue());
    await page.waitForTimeout(300);
    await expect(input).toHaveValue(String(held));

    // Every nudge is its own undo step.
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(input).toHaveValue(String(held - 1));

    if (phone) {
        // A finger that lands on a stepper and moves on is scrolling the sheet, not holding the
        // button: the press itself nudges once (pointerdown runs the action before the browser
        // can claim the finger), the scroll's pointercancel ends the hold before its first
        // repeat, and the sheet scrolls.
        const increaseY = control('Increase Y');
        await increaseY.scrollIntoViewIfNeeded();
        const scroller = await scrollerHandle(increaseY);
        const from = await box(increaseY);
        const y = Number(await field('Y').inputValue());
        const scrolled = await scroller.evaluate(el => el.scrollTop);
        await fingers.down(1, from.x, from.y);
        for (let step = 1; step <= 6; step++) await fingers.move(1, from.x, from.y - 25 * step);
        await page.waitForTimeout(500);
        await fingers.up(1, from.x, from.y - 150);
        await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBeGreaterThan(scrolled);
        const after = Number(await field('Y').inputValue());
        expect(after - y).toBe(1);
        await page.waitForTimeout(300);
        await expect(field('Y')).toHaveValue(String(after));
    }
});

// Task 20: the browser/phone back gesture closes the open overlay and stays in the editor.
// Overlays are same-URL router entries; `history.state.usr` is the router's `location.state`.
const overlayDepth = page => page.evaluate(() => (history.state && history.state.usr && history.state.usr.touchOverlays) || 0);
const pathname = page => new URL(page.url()).pathname;
const leavePrompt = page => page.getByRole('alertdialog', { name: 'Leave editor?' });

test('back gesture closes the open overlay and keeps the editor; any other close consumes the entry', async ({ page, browserName }, testInfo) => {
    const phone = isPhone(testInfo);
    const pane = activePane(page);
    const canvas = pane.getByTestId('editor-canvas');
    // A property on the live canvas node: a remount would hand back a fresh node without it.
    await canvas.evaluate(node => { node.__backDismissProbe = true; });
    const probeIntact = () => canvas.evaluate(node => node.__backDismissProbe === true);
    const undo = page.getByRole('button', { name: 'Undo' });

    // An edit first, so the editor holds state the overlays must not disturb, and so that work
    // may still be unsaved while the overlays open and close: the unsaved-work prompt must never
    // appear for an overlay entry.
    const fingers = new Fingers(page, browserName);
    const rect = pane.locator('[data-element-id="box"]');
    const start = await box(rect);
    await page.touchscreen.tap(start.x, start.y);
    await fingers.drag(start, { x: start.x + 40, y: start.y + 30 });
    await expect.poll(async () => (await box(rect)).b.x).toBeGreaterThan(start.b.x + 20);
    const moved = (await box(rect)).b;
    await expect(undo).toBeEnabled();
    const editorIntact = async () => {
        expect(await probeIntact(), 'the canvas node survived (no remount)').toBe(true);
        const now = (await box(rect)).b;
        expect(Math.abs(now.x - moved.x)).toBeLessThan(2);
        expect(Math.abs(now.y - moved.y)).toBeLessThan(2);
        await expect(undo).toBeEnabled();
        await expect(leavePrompt(page)).toHaveCount(0);
        expect(pathname(page)).toBe('/app');
    };

    // ⋯ → JSON: the sheet closes itself when it launches a dialog, so the dialog takes over the
    // one entry; back closes the dialog and nothing of the sheet remains.
    await openFromOverflow(page, 'JSON');
    const json = page.getByRole('heading', { name: 'Project JSON Editor' });
    await expect(json).toBeVisible();
    await expect(overflowMenu(page)).toBeHidden();
    await expect.poll(() => overlayDepth(page)).toBe(1);
    await page.goBack();
    await expect(json).toBeHidden();
    await expect(overflowMenu(page)).toBeHidden();
    await expect.poll(() => overlayDepth(page)).toBe(0);
    await editorIntact();

    // Closing with the X button consumes the entry instead of leaving it behind.
    await openFromOverflow(page, 'JSON');
    await expect(json).toBeVisible();
    await expect.poll(() => overlayDepth(page)).toBe(1);
    await page.getByRole('button', { name: 'Close JSON editor' }).click();
    await expect(json).toBeHidden();
    await expect.poll(() => overlayDepth(page)).toBe(0);
    await editorIntact();

    // The ⋯ sheet on its own.
    await page.getByRole('button', { name: 'More actions' }).click();
    await expect(overflowMenu(page)).toBeVisible();
    await expect.poll(() => overlayDepth(page)).toBe(1);
    await page.goBack();
    await expect(overflowMenu(page)).toBeHidden();
    await editorIntact();

    // ⋯ → Save preset: the same handoff for a dialog outside the brief's first list (R39).
    await openFromOverflow(page, 'Save preset');
    const preset = page.getByRole('dialog', { name: 'Save As Preset' });
    await expect(preset).toBeVisible();
    await expect(overflowMenu(page)).toBeHidden();
    await expect.poll(() => overlayDepth(page)).toBe(1);
    await page.goBack();
    await expect(preset).toBeHidden();
    await expect.poll(() => overlayDepth(page)).toBe(0);
    await editorIntact();

    // The pages drawer.
    await page.getByRole('button', { name: 'Open pages and templates' }).click();
    const drawer = page.getByRole('dialog', { name: 'Pages and templates' });
    await expect(drawer).toBeVisible();
    await expect.poll(() => overlayDepth(page)).toBe(1);
    await page.goBack();
    await expect(drawer).toBeHidden();
    await editorIntact();

    if (phone) {
        // The project switcher.
        await topBar(page).getByRole('button', { name: 'Mobile' }).click();
        const menu = page.getByRole('menu');
        await expect(menu).toBeVisible();
        await expect.poll(() => overlayDepth(page)).toBe(1);
        await page.goBack();
        await expect(menu).toBeHidden();
        await editorIntact();
    }

    // Unapplied JSON changes: back asks first. Cancelling keeps the dialog and restores its
    // entry; agreeing closes it.
    await openFromOverflow(page, 'JSON');
    await expect(json).toBeVisible();
    const jsonPanel = page.locator('.editor-dialog-panel', { has: json }); // the tool pill has a Text tool too
    await jsonPanel.getByRole('button', { name: 'Text' }).click();
    const textarea = jsonPanel.locator('textarea');
    await textarea.fill(`${await textarea.inputValue()}\n`);
    const prompts = [];
    page.once('dialog', dialog => { prompts.push(dialog.message()); void dialog.dismiss(); });
    await page.goBack();
    await expect.poll(() => prompts).toEqual(['Discard JSON changes?']);
    await expect(json).toBeVisible();
    await expect.poll(() => overlayDepth(page)).toBe(1);
    expect(pathname(page)).toBe('/app');
    page.once('dialog', dialog => { prompts.push(dialog.message()); void dialog.accept(); });
    await page.goBack();
    await expect.poll(() => prompts).toEqual(['Discard JSON changes?', 'Discard JSON changes?']);
    await expect(json).toBeHidden();
    await expect.poll(() => overlayDepth(page)).toBe(0);
    await editorIntact();

    // Nothing open: back leaves the editor exactly as before. The work is saved first, so no
    // unsaved-work prompt is due (that interplay is pinned by EditorPage.backDismiss.test.tsx).
    await expect(page.getByText('Saved locally')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(pane).toHaveCount(0);
});

// Task 21: a coarse-pointer viewport whose shorter side is under 640px is a phone whichever way it
// is held, so a phone turned sideways keeps the phone layout — and so does the tablet project at
// these sizes, where the rule is the same. Both devices start portrait: the first resize rotates.
test('landscape phone keeps the phone layout, with the top bar, a one-row pill, the sheet and the canvas usable', async ({ page }, testInfo) => {
    const html = page.locator('html');
    const device = await viewport(page);
    const pane = activePane(page);
    const bar = topBar(page);
    const pill = page.getByTestId('touch-tool-pill');
    const sheet = page.getByTestId('properties-sheet');
    const grabber = page.getByRole('button', { name: 'Resize properties sheet' });
    for (const { width, height } of [{ width: 844, height: 390 }, { width: 740, height: 360 }]) {
        await page.setViewportSize({ width, height });
        const size = `${width}×${height}`;
        const screen = { x: 0, y: 0, width, height };
        await expect(html).toHaveAttribute('data-form-factor', 'phone');

        // Top bar: every control on screen, the project switcher among them.
        for (const name of ['Open pages and templates', 'Mobile', 'Undo', 'Redo', 'More actions']) {
            await onScreen(bar.getByRole('button', { name }), screen, `${name} at ${size}`);
        }
        await expect(bar.getByRole('status')).toBeVisible();

        // Pill: all ten tools in a single row, floating above the sheet's peek row.
        await expect(pill.getByRole('button')).toHaveCount(10);
        const pillBox = await onScreen(pill, screen, `tool pill at ${size}`);
        expect(pillBox.height, `one-row pill at ${size}`).toBeLessThan(2 * 44);
        const peek = await onScreen(sheet, screen, `properties sheet at ${size}`);
        expect(peek.height, `sheet at peek at ${size}`).toBe(SHEET_PEEK_PX);
        expect(pillBox.y + pillBox.height, `pill clears the sheet at ${size}`).toBeLessThanOrEqual(peek.y);

        // Canvas: a band of page stays between the bar and the pill, and a tap in it still selects.
        const barBox = await bar.boundingBox();
        expect(pillBox.y - (barBox.y + barBox.height), `canvas band at ${size}`).toBeGreaterThanOrEqual(120);
        await fitPage(page);
        const rect = pane.locator('[data-element-id="box"]');
        const b = await rect.boundingBox();
        // Just inside the box's top-left corner: the page is scrolled to its top, and the box's
        // centre may already sit under the pill at these heights.
        await page.touchscreen.tap(b.x + 20, b.y + 20);
        await expect(pane.locator('[data-resize-handle="se"]')).toBeVisible();

        // Sheet: half height (after its 200ms height transition) shows the properties inside the
        // viewport; back to peek afterwards.
        await grabber.click();
        await expect.poll(async () => Math.abs((await sheet.boundingBox()).height - height / 2), `half sheet height at ${size}`).toBeLessThanOrEqual(1);
        await onScreen(sheet, screen, `half sheet at ${size}`);
        await onScreen(page.getByTestId('properties-sheet-content'), screen, `sheet content at ${size}`);
        await grabber.click(); // full
        await grabber.click(); // peek
        await expect.poll(async () => (await sheet.boundingBox()).height).toBe(SHEET_PEEK_PX);
        expect(await horizontalOverflow(page), `no horizontal scroll at ${size}`).toBeLessThanOrEqual(0);
        await page.touchscreen.tap(6, b.y + 20); // the gutter beside the page: deselects for the next size
        await expect(pane.locator('[data-resize-handle]')).toHaveCount(0);
    }
    // Back at the device's own size the layout is the device's again.
    await page.setViewportSize(device);
    await expect(html).toHaveAttribute('data-form-factor', isPhone(testInfo) ? 'phone' : 'tablet');
});

// Task 21: the phone sheet shows Cloud and Account as rows of its own (no trigger, no popover
// opening over the groups below), driven by the same handlers as the header's menus.
test('phone overflow menu lists Cloud and Account as rows, and Save to cloud runs from its row', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), 'phone only: tablet keeps cloud and account in the page header');
    const menu = overflowMenu(page);
    const { width, height } = await viewport(page);
    const screen = { x: 0, y: 0, width, height };
    // The sheet scrolls (max 85dvh) and these groups sit below its fold: bring each row into view,
    // then expect a 44px row inside the viewport, to within a pixel (a row scrolled to the sheet's
    // bottom edge can overhang it by a sub-pixel fraction under the integer scroll offset).
    const row = async (locator, label) => {
        await expect(locator, label).toBeVisible();
        await expect.poll(async () => {
            await locator.scrollIntoViewIfNeeded();
            const b = await locator.boundingBox();
            const inside = b.x >= -1 && b.y >= -1 && b.x + b.width <= screen.width + 1 && b.y + b.height <= screen.height + 1;
            return { inside, tall: b.height >= 44 };
        }, label).toEqual({ inside: true, tall: true });
    };

    // Signed out: both groups are sign-in rows (links), not the header's trigger buttons.
    await page.getByRole('button', { name: 'More actions' }).click();
    await expect(menu.getByRole('heading', { name: 'Cloud' })).toBeVisible();
    await expect(menu.getByRole('heading', { name: 'Account' })).toBeVisible();
    await expect(menu.getByTitle('Cloud')).toHaveCount(0);
    await expect(menu.getByTitle('Account')).toHaveCount(0);
    await row(menu.getByRole('link', { name: 'Sign in to save to cloud' }), 'cloud sign-in row');
    await row(menu.getByRole('link', { name: 'Sign in', exact: true }), 'account sign-in row');
    await page.getByTestId('overflow-menu-backdrop').click();
    await expect(menu).toBeHidden();

    // Signed in (through the API: the page's request context shares the browser's cookies), the
    // rows carry the signed-in actions, and Save to cloud runs from its row with the usual prompt.
    const unique = `${Date.now()}${testInfo.workerIndex}`;
    await apiSignUpAndVerify(page.request, API_BASE, {
        email: `phone-cloud-${unique}@test.dev`, name: 'Phone Cloud', username: `phonecloud_${unique}`,
    });
    await page.reload();
    await expect(activePane(page).getByTestId('editor-canvas')).toBeVisible();
    await page.getByRole('button', { name: 'More actions' }).click();
    const save = menu.getByRole('button', { name: 'Save to cloud (new)' });
    await row(save, 'Save to cloud row');
    await expect(menu.getByText(`Signed in as phonecloud_${unique}`)).toBeVisible();
    await row(menu.getByRole('link', { name: 'My profile' }), 'My profile row');
    await row(menu.getByRole('button', { name: 'Sign out' }), 'Sign out row');
    page.once('dialog', dialog => dialog.accept('From the phone')); // the commit-message prompt
    const [createRes] = await Promise.all([
        page.waitForResponse(res => res.url().includes('/api/projects') && res.request().method() === 'POST', { timeout: 15000 }),
        save.click(),
    ]);
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();
    await expect(menu).toBeHidden(); // a completed one-shot action closes the sheet, as it would close the popover
    await expect.poll(async () => (await readActiveProject(page)).cloud)
        .toEqual({ projectId: created.project.id, lastSyncedCommitId: created.commit.id });
    await page.getByRole('button', { name: 'More actions' }).click();
    await row(menu.getByRole('button', { name: 'Save to cloud', exact: true }), 'Save to cloud row once linked');
    await row(menu.getByRole('button', { name: 'Version history' }), 'Version history row');

    // A Cloud modal opened from the sheet takes its own back entry above the sheet's: back closes
    // the modal alone and the sheet stays; closing it with its button returns to the sheet too.
    const history = page.getByRole('heading', { name: 'Version history' });
    await menu.getByRole('button', { name: 'Version history' }).click();
    await expect(history).toBeVisible();
    await expect.poll(() => overlayDepth(page)).toBe(2);
    await page.goBack();
    await expect(history).toBeHidden();
    await expect(menu).toBeVisible();
    await expect.poll(() => overlayDepth(page)).toBe(1);
    expect(pathname(page)).toBe('/app');
    await menu.getByRole('button', { name: 'Version history' }).click();
    await expect(history).toBeVisible();
    await expect.poll(() => overlayDepth(page)).toBe(2);
    await page.getByRole('button', { name: 'Close version history' }).click();
    await expect(history).toBeHidden();
    await expect(menu).toBeVisible();
    await expect.poll(() => overlayDepth(page)).toBe(1);
    await page.getByTestId('overflow-menu-backdrop').click();
    await expect(menu).toBeHidden();
    await expect.poll(() => overlayDepth(page)).toBe(0);
    expect(pathname(page)).toBe('/app');
});

// Touch colour picker: every native colour input opens the in-app picker (square, hue, palette, hex)
// instead of the platform one; a pick writes through the field's own handlers, one undo step each.
test('colour fields open the touch colour picker; a palette pick fills the element and undoes in one step', async ({ page }, testInfo) => {
    const phone = isPhone(testInfo);
    const pane = activePane(page);
    const rect = pane.locator('[data-element-id="box"]');
    const start = await box(rect);
    await page.touchscreen.tap(start.x, start.y);
    await expect(pane.locator('[data-resize-handle="se"]')).toBeVisible();
    if (phone) await page.getByTestId('properties-sheet-toggle').click();
    const fill = page.getByTestId('appearance-section-body').locator('input[type="color"]').first();
    await fill.scrollIntoViewIfNeeded();
    const original = await fill.inputValue();
    // The native input never takes the tap (no platform picker can open); a tap just beside the
    // small swatch, inside its 44px touch target, still opens the in-app picker.
    expect(await fill.evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none');
    const fillBox = await box(fill);
    await page.touchscreen.tap(fillBox.b.x - 8, fillBox.y);
    const picker = page.getByRole('dialog', { name: 'Fill' });
    await expect(picker).toBeVisible();
    // The picker fits the screen and every swatch keeps a 44px target.
    const { width } = await viewport(page);
    const panel = await picker.boundingBox();
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(width + 0.5);
    for (const swatch of await picker.getByRole('group', { name: 'Palette' }).getByRole('button').all()) {
        const b = await swatch.boundingBox();
        expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44);
    }

    await picker.getByRole('button', { name: 'Palette #3b82f6' }).click();
    await expect(fill).toHaveValue('#3b82f6');
    await expect.poll(() => rect.evaluate(el => [el, ...el.querySelectorAll('*')].some(node => getComputedStyle(node).backgroundColor === 'rgb(59, 130, 246)')), 'canvas shows the pick').toBe(true);
    // A drag on the square commits once, on release.
    const square = await picker.getByTestId('colour-picker-square').boundingBox();
    await page.touchscreen.tap(square.x + square.width * 0.9, square.y + 4);
    await expect(fill).not.toHaveValue('#3b82f6');
    await picker.getByRole('button', { name: 'Done' }).click();
    await expect(picker).toBeHidden();
    const squarePick = await fill.inputValue();

    // The clear-fill button beside the swatch, inside the swatch's touch target, keeps its own tap.
    const beside = { x: fillBox.b.x + fillBox.b.width + 8, y: fillBox.y };
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.title, beside)).toBe('Clear fill color');
    await page.touchscreen.tap(beside.x, beside.y);
    await expect(page.getByTestId('appearance-section-body').getByTitle('No fill to clear')).toBeVisible();
    await expect(picker).toHaveCount(0);

    const undo = page.getByRole('button', { name: 'Undo' });
    await undo.click();
    await expect(fill).toHaveValue(squarePick);
    await undo.click();
    await expect(fill).toHaveValue('#3b82f6');
    await undo.click();
    await expect(fill).toHaveValue(original);
});

test('the quick format bar colour opens the touch colour picker', async ({ page }) => {
    const pane = activePane(page);
    const title = await box(pane.locator('[data-element-id="title"]'));
    await page.touchscreen.tap(title.x, title.y);
    const swatch = page.getByRole('toolbar', { name: 'Text formatting' }).getByLabel('Text colour');
    await expect(swatch).toBeVisible();
    const s = await box(swatch);
    await page.touchscreen.tap(s.x, s.y);
    const picker = page.getByRole('dialog', { name: 'Text colour' });
    await expect(picker).toBeVisible();
    await picker.getByRole('button', { name: 'Palette #ef4444' }).click();
    await expect(swatch).toHaveValue('#ef4444');
    await page.goBack(); // the back gesture closes the picker and stays in the editor
    await expect(picker).toBeHidden();
    await expect(page).toHaveURL(/\/app$/);
});
