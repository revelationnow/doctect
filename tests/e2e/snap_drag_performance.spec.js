import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { openFreshEditor, readActiveProject } from './localWorkspaceHelpers.js';

// Opt-in drag benchmark (SNAP_PERF=1). Phase "baseline" runs on the code before smart guides,
// "final" after. Each page size is filled with rects laid out on a regular lattice so many edges
// line up — the worst case for merged snap targets. Every measured drag starts from a quiet editor:
// the local save a JSON apply or a snapping toggle queues is awaited (see settle) before throttling.
const OUT = process.env.SNAP_PERF_OUTPUT;
const PHASE = process.env.SNAP_PERF_PHASE;
const SIZES = [40, 500, 2000];
// 80 samples per config. At 4x throttle a geometry-changing move costs ~1.6s of frame at 500
// elements and ~6s at 2000 (baseline run, 2026-11-02), so 120 steps x 3 repeats overran the test.
const STEPS = 40;
const REPEATS = 2;
// The dragged rect's shorter side is zoomed to at least this many screen px. A selected element's
// touch resize zones (44px, outset 14px) reach 8px into it from each corner, and the 2000-element
// lattice is ~11px at the default zoom, so a finger at its centre would resize instead of move.
const MIN_TARGET_PX = 32;

const stats = values => {
    const sorted = [...values].sort((a, b) => a - b);
    const at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    return { p50: at(0.5), p95: at(0.95), mean: values.reduce((s, v) => s + v, 0) / values.length };
};

const pane = page => page.locator('[data-testid="project-pane"][data-active="true"]');
const benchTarget = page => pane(page).locator('[data-element-id="bench-0"]');

const isTouchProject = info => info.project.name.endsWith('tablet');

// Main-thread long tasks (>50 ms) since the last settle, so a toggle's save cost is read as blocking
// time, not only as the debounced wall time to "Saved locally". Installed once per editor page.
async function observeLongTasks(page) {
    await page.evaluate(() => {
        window.__snapLongTasks = [];
        window.__snapLongTaskObserver = new PerformanceObserver(list => {
            for (const entry of list.getEntries()) window.__snapLongTasks.push(entry.duration);
        });
        window.__snapLongTaskObserver.observe({ type: 'longtask' });
    });
}

const clearLongTasks = page => page.evaluate(() => { window.__snapLongTasks = []; });

// The editor persists edits and setting changes through a debounced local save (document lane 0.5 s
// trailing / 2 s maximum, preferences lane 1 s / 5 s; services/localWorkspace/incrementalQueue.ts).
// A save left running by the JSON apply or by a snapping toggle would otherwise land inside the
// first throttled drag and widen that config's tail — in the final phase every config toggles a
// setting, in the baseline only "grid" does. The header's save pill shows the document lane only
// (EditorPage feeds it saveStates, not preferenceStates), and nothing the page exposes reports a
// preference write's completion: readActiveProject sees the toggle as soon as the store admits it,
// before the debounced write. So: the pill must read "Saved locally" (what
// tests/e2e/incrementalBrowserHarness.ts waits on), the toggled settings must be in the store, and
// after a toggle click the drag waits a further TOGGLE_SAVE_MS — the lane's 1 s trailing debounce
// plus margin for the write (~0.2 s of main thread at 500 elements, unthrottled) — so the save's
// task lands here, not in the first measured frame; the logged long tasks show that it did. A
// config that changed nothing passes at once.
const TOGGLE_SAVE_MS = 2500;
async function settle(page, label, persisted = {}, changed = false) {
    const t0 = Date.now();
    const saving = await page.getByRole('status').filter({ hasText: 'Saving locally' }).count();
    await expect(page.getByRole('status').filter({ hasText: 'Saved locally' }).first()).toBeVisible({ timeout: 120_000 });
    const keys = Object.keys(persisted);
    if (keys.length) {
        await expect.poll(async () => {
            const stored = (await readActiveProject(page)).initialState;
            return Object.fromEntries(keys.map(key => [key, stored[key]]));
        }, { timeout: 120_000, message: `${label}: toggled settings persisted` }).toEqual(persisted);
    }
    if (changed) await page.waitForTimeout(TOGGLE_SAVE_MS);
    const wait = Date.now() - t0;
    const tasks = await page.evaluate(() => {
        const durations = window.__snapLongTasks ?? [];
        window.__snapLongTasks = [];
        return { count: durations.length, ms: Math.round(durations.reduce((sum, d) => sum + d, 0)) };
    });
    console.info(`[snap-perf] settle ${label} saving=${saving} wait=${wait}ms longTasks=${tasks.count}/${tasks.ms}ms`);
    return wait;
}

test.beforeEach(async ({ page }, info) => {
    if (!isTouchProject(info)) return;
    // Emulated browsers don't reliably report a coarse pointer (as in mobile_editor.spec.js); the
    // touch layout and the canvas touch gestures both hinge on this query.
    await page.addInitScript(() => {
        const original = window.matchMedia.bind(window);
        window.matchMedia = query => (query === '(pointer: coarse)'
            ? { matches: true, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }
            : original(query));
    });
});

async function applyElements(page, info, count, cdp) {
    if (isTouchProject(info)) {
        // Tablet keeps JSON in the ⋯ sheet (portalled to body, outside the pane).
        await page.getByRole('button', { name: 'More actions' }).click();
        await page.getByRole('dialog', { name: 'More actions' }).getByRole('button', { name: 'JSON', exact: true }).click();
    } else {
        await pane(page).getByRole('button', { name: 'JSON', exact: true }).click();
    }
    const dialog = page.locator('.editor-dialog-panel').filter({ has: page.getByRole('heading', { name: 'Project JSON Editor' }) });
    await expect(dialog.getByRole('heading', { name: 'Project JSON Editor' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Text', exact: true }).click();
    const area = dialog.locator('textarea');
    const state = JSON.parse(await area.inputValue());
    const template = state.variants[state.activeVariantId].templates[state.nodes[state.rootId].type];
    const layerId = template.layers?.[0]?.id;
    const cols = Math.ceil(Math.sqrt(count * template.width / template.height));
    const rows = Math.ceil(count / cols);
    const cw = template.width / cols, ch = template.height / rows;
    const w = Math.max(2, cw - 2), h = Math.max(2, ch - 2);
    template.elements = Array.from({ length: count }, (_, i) => ({
        id: `bench-${i}`, type: 'rect', layerId,
        x: (i % cols) * cw + 1, y: Math.floor(i / cols) * ch + 1, w, h,
        rotation: 0, fill: '#e2e8f0', stroke: '#334155', strokeWidth: 0.5, opacity: 1,
    }));
    state.scale = Math.max(state.scale ?? 0.8, MIN_TARGET_PX / Math.min(w, h));
    await area.fill(JSON.stringify(state));
    await dialog.getByRole('button', { name: 'Apply Changes', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Project JSON Editor' })).toHaveCount(0, { timeout: 120_000 });
    await expect(pane(page).locator('[data-element-id]')).toHaveCount(count, { timeout: 120_000 });
    if (isTouchProject(info)) await zoomTouchTarget(page, cdp);
    const b = await benchTarget(page).boundingBox();
    expect(Math.min(b.width, b.height), 'the drag target is large enough to grab clear of its handles').toBeGreaterThanOrEqual(MIN_TARGET_PX - 1);
    await settle(page, `${info.project.name} ${count} apply`);
}

// The touch layout fits the page to its canvas column on load, ignoring the JSON's scale, so a
// small lattice is pinched up (real CDP two-finger gesture) until bench-0 is large enough; the
// canvas is then scrolled back to its origin so bench-0 stays in view.
async function zoomTouchTarget(page, cdp) {
    const surface = pane(page).locator('.canvas-scroll-container');
    const points = (type, fingers) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: fingers });
    for (let attempt = 0; attempt < 6; attempt++) {
        const b = await benchTarget(page).boundingBox();
        const have = Math.min(b.width, b.height);
        if (have >= MIN_TARGET_PX) return;
        const ratio = Math.min(4, (MIN_TARGET_PX * 1.15) / have);
        const c = await surface.boundingBox();
        const cx = c.x + c.width / 2, cy = c.y + c.height / 2;
        const d0 = 60;
        const f1 = { id: 1, x: cx - d0 / 2, y: cy };
        const f2 = d => ({ id: 2, x: cx - d0 / 2 + d, y: cy });
        await points('touchStart', [f1]);
        await points('touchStart', [f1, f2(d0)]);
        for (let i = 1; i <= 5; i++) await points('touchMove', [f1, f2(d0 + (d0 * ratio - d0) * i / 5)]);
        await points('touchEnd', [f1]);
        await points('touchEnd', []);
        await surface.evaluate(el => { el.scrollLeft = 0; el.scrollTop = 0; });
        await expect.poll(async () => { const n = await benchTarget(page).boundingBox(); return Math.min(n.width, n.height); }).toBeGreaterThan(have);
    }
}

// Sets snapping through the UI and asserts the resulting state, so a measured config is what its
// name says. The Smart guides control does not exist in the baseline phase and is skipped there;
// in the final phase it must exist (a locator that silently misses would measure guides off).
async function setSnapping(page, info, { name, grid, guides }, size) {
    const guidesRequired = PHASE === 'final';
    const label = `${info.project.name} ${size} ${name}`;
    // What the store must hold before the drag; the Smart guides preference only exists in the final phase.
    const persisted = { snapToGrid: grid, ...(guidesRequired ? { smartGuides: guides } : {}) };
    await clearLongTasks(page); // so the logged long tasks are the toggles and their saves, not the previous drag
    let changed = false;
    if (isTouchProject(info)) {
        await page.getByRole('button', { name: 'More actions' }).click();
        const menu = page.getByRole('dialog', { name: 'More actions' });
        const toggle = async (name, want, required) => {
            const item = menu.getByRole('button', { name, exact: true });
            if (required) await expect(item).toHaveCount(1);
            else if (await item.count() === 0) return;
            if ((await item.getAttribute('aria-pressed')) !== String(want)) { await item.click(); changed = true; }
            await expect(item).toHaveAttribute('aria-pressed', String(want));
        };
        await toggle('Snap to grid', grid, true);
        await toggle('Smart guides', guides, guidesRequired);
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
        await settle(page, label, persisted, changed);
        return;
    }
    const magnet = page.getByTitle('Snap to Grid', { exact: true });
    await expect(magnet).toHaveCount(1);
    if ((await magnet.getAttribute('class')).includes('bg-blue-600') !== grid) { await magnet.click(); changed = true; }
    if (grid) await expect(magnet).toHaveClass(/bg-blue-600/);
    else await expect(magnet).not.toHaveClass(/bg-blue-600/);
    const options = page.getByTitle('Snapping options', { exact: true });
    if (guidesRequired) await expect(options).toHaveCount(1);
    if (await options.count()) {
        await options.click();
        const sw = page.getByRole('switch', { name: 'Smart guides' });
        await expect(sw).toHaveCount(1);
        if ((await sw.isChecked()) !== guides) { await sw.click(); changed = true; }
        await expect(sw).toBeChecked({ checked: guides });
        await page.keyboard.press('Escape');
        await expect(sw).toBeHidden(); // the popover closed
    }
    await settle(page, label, persisted, changed);
}

// Desktop: a selected element carries its pivot handle at its centre (and corner handles), so a
// mousedown there would drag the pivot, not the element. A click in the canvas wrapper's padding
// (top-left of the scroll container at scroll 0,0) is a zero-area marquee that empties the selection.
// Touch has no pivot handle and its drag must start from a tap-selected element, so it skips this.
async function clearSelection(page, info) {
    if (isTouchProject(info)) return;
    const c = await pane(page).locator('.canvas-scroll-container').boundingBox();
    await page.mouse.click(c.x + 12, c.y + 12);
    await expect(pane(page).locator('[data-resize-handle], [data-pivot-handle]')).toHaveCount(0);
}

// Desktop: real mousedown, then synthetic mousemoves timed in the page. `handler` is the synchronous
// dispatch time (the canvas handler, including any snapping); `frame` runs to the next animation frame.
async function measureMouseDrag(page) {
    const target = benchTarget(page);
    const b = await target.boundingBox();
    const x0 = b.x + b.width / 2, y0 = b.y + b.height / 2;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    const samples = await page.evaluate(async ({ x0, y0, steps }) => {
        const surface = document.querySelector('[data-testid="project-pane"][data-active="true"] .canvas-scroll-container');
        const rect = () => surface.querySelector('[data-element-id="bench-0"]').getBoundingClientRect();
        const before = rect();
        const out = { handler: [], frame: [] };
        for (let i = 1; i <= steps; i++) {
            const t0 = performance.now();
            surface.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x0 + i * 2, clientY: y0 + i }));
            out.handler.push(performance.now() - t0);
            await new Promise(r => requestAnimationFrame(() => r()));
            out.frame.push(performance.now() - t0);
        }
        const after = rect();
        out.moved = { dx: after.x - before.x, dy: after.y - before.y };
        return out;
    }, { x0, y0, steps: STEPS });
    await page.mouse.up();
    // The synthetic moves must have dragged the element, not merely been dispatched.
    expect(samples.moved.dx, 'synthetic mousemoves moved bench-0 horizontally').toBeGreaterThan(STEPS);
    expect(samples.moved.dy, 'synthetic mousemoves moved bench-0 vertically').toBeGreaterThan(STEPS / 4);
    return samples;
}

// Tablet: real CDP touch events; frame intervals recorded by an in-page rAF loop.
async function measureTouchDrag(page, cdp) {
    const target = benchTarget(page);
    const b = await target.boundingBox();
    const x0 = b.x + b.width / 2, y0 = b.y + b.height / 2;
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    await touch('touchStart', x0, y0); await touch('touchEnd', x0, y0); // select
    // claimDirectDrag reads the rendered selection: wait for its handles, then past the double-tap window.
    await expect(pane(page).locator('[data-resize-handle]').first()).toBeAttached();
    await page.waitForTimeout(400);
    // The gesture start runs unthrottled: the gesture hook's long press (500ms) cancels a direct drag
    // whose finger has not yet passed the 8px tap slop, and under throttle the press's own render
    // alone exceeds that at 2000 elements. The first move therefore lands straight on the step-5
    // position (11px out); the measured moves, throttled again, continue the same path from step 6,
    // and the frame loop records only those.
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await touch('touchStart', x0, y0);
    await touch('touchMove', x0 + 10, y0 + 5);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.evaluate(() => {
        window.__benchFrames = []; let last = performance.now();
        const loop = now => { window.__benchFrames.push(now - last); last = now; if (window.__benchFrames.length < 100000 && !window.__benchStop) requestAnimationFrame(loop); };
        window.__benchStop = false; requestAnimationFrame(loop);
    });
    for (let i = 6; i <= STEPS; i++) await touch('touchMove', x0 + i * 2, y0 + i);
    await touch('touchEnd', x0 + STEPS * 2, y0 + STEPS);
    const frames = await page.evaluate(() => { window.__benchStop = true; return window.__benchFrames.slice(2); });
    return { handler: [], frame: frames };
}

// bench-0's position as a fraction of the page's rendered width: zoom-independent, so the undo check
// holds on touch, where an undo remounts the canvas and useTouchFit refits the page to its column.
const pagePosition = page => pane(page).evaluate(root => {
    const canvas = root.querySelector('[data-testid="editor-canvas"]').getBoundingClientRect();
    const el = root.querySelector('[data-element-id="bench-0"]').getBoundingClientRect();
    return { x: (el.x - canvas.x) / canvas.width, y: (el.y - canvas.y) / canvas.width };
});

// Before each repeat: desktop empties the selection (see clearSelection); touch restores the zoom
// the previous undo's refit discarded. Returns bench-0's screen box and page position.
async function prepareDrag(page, info, cdp) {
    if (isTouchProject(info)) await zoomTouchTarget(page, cdp);
    else await clearSelection(page, info);
    return { box: await benchTarget(page).boundingBox(), position: await pagePosition(page) };
}

// After a measured drag the element must have moved (not resized), and the undo that follows must
// put it back, so every repeat and config drags the same lattice from the same place. Were the drag
// a no-op, the undo would instead revert the JSON apply and empty the page.
async function expectDraggedThenUndo(page, before) {
    const after = await benchTarget(page).boundingBox();
    expect(after.x - before.box.x, 'bench-0 moved right').toBeGreaterThan(STEPS);
    expect(after.y - before.box.y, 'bench-0 moved down').toBeGreaterThan(STEPS / 4);
    expect(Math.abs(after.width - before.box.width), 'bench-0 kept its width').toBeLessThan(1.5);
    expect(Math.abs(after.height - before.box.height), 'bench-0 kept its height').toBeLessThan(1.5);
    await page.keyboard.press('Control+z');
    await expect.poll(async () => {
        const p = await pagePosition(page);
        return Math.abs(p.x - before.position.x) + Math.abs(p.y - before.position.y);
    }, { message: 'undo returned bench-0 to its lattice cell' }).toBeLessThan(0.002);
}

test('drag frame times by page size and snapping', async ({ page }, info) => {
    test.setTimeout(1_800_000);
    expect(['baseline', 'final']).toContain(PHASE);
    expect(OUT).toBeTruthy();
    mkdirSync(OUT, { recursive: true }); // fail here, not after a 10-minute run
    const configs = PHASE === 'baseline'
        ? [{ name: 'off', grid: false, guides: false }, { name: 'grid', grid: true, guides: false }]
        : [{ name: 'off', grid: false, guides: false }, { name: 'grid', grid: true, guides: false },
            { name: 'guides', grid: false, guides: true }, { name: 'both', grid: true, guides: true }];
    const cdp = await page.context().newCDPSession(page);
    const results = {};
    for (const size of SIZES) {
        await openFreshEditor(page);
        await expect(page.getByTestId('project-tab').filter({ hasText: 'Blank Project' })).toBeVisible();
        await observeLongTasks(page);
        await applyElements(page, info, size, cdp);
        results[size] = {};
        for (const config of configs) {
            await setSnapping(page, info, config, size);
            await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
            const handler = [], frame = [];
            for (let r = 0; r < REPEATS; r++) {
                const before = await prepareDrag(page, info, cdp);
                const s = isTouchProject(info) ? await measureTouchDrag(page, cdp) : await measureMouseDrag(page);
                handler.push(...s.handler); frame.push(...s.frame);
                await expectDraggedThenUndo(page, before);
            }
            await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
            results[size][config.name] = { handler: handler.length ? stats(handler) : null, frame: stats(frame) };
            console.info(`[snap-perf] ${info.project.name} ${size} ${config.name}`, JSON.stringify(results[size][config.name]));
        }
    }
    writeFileSync(`${OUT}/${PHASE}-${info.project.name}.json`, JSON.stringify(results, null, 2));
});

