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

test('phone tool pill keeps all ten controls, Select multiple and Fit included, inside the viewport', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), 'phone only');
    const pill = page.getByTestId('touch-tool-pill');
    const tools = pill.getByRole('button');
    for (const { width, height } of await phoneWidths(page)) {
        await page.setViewportSize({ width, height });
        await expect(tools).toHaveCount(10);
        await expect(pill.getByRole('button', { name: 'Select multiple' })).toBeVisible();
        await expect(pill.getByRole('button', { name: 'Fit page to width' })).toBeVisible();
        const screen = { x: 0, y: 0, width, height };
        const pillBox = await pill.boundingBox();
        expect(within(pillBox, screen), `pill inside the ${width}px viewport`).toBe(true);
        for (let i = 0; i < 10; i++) {
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
        // its own Close must be reachable too.
        await generator.getByRole('button', { name: 'Preview', exact: true }).click();
        const preview = page.getByRole('dialog', { name: 'Generated Project Preview' });
        await expect(preview).toBeVisible();
        expect(await sidewaysOverflow(preview), `preview panel overflow at ${width}px`).toBeLessThanOrEqual(0);
        await onScreen(preview.getByRole('button', { name: 'Close preview' }), screen, 'Close preview');
        await preview.getByRole('button', { name: 'Close preview' }).click();
        await expect(preview).toBeHidden();
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
        // button: the value changes once at most (the press itself) and the sheet scrolls.
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
        expect(after - y).toBeGreaterThanOrEqual(0);
        expect(after - y).toBeLessThanOrEqual(1);
        await page.waitForTimeout(300);
        await expect(field('Y')).toHaveValue(String(after));
    }
});
