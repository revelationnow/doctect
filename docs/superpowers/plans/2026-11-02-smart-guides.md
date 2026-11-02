# Smart Guides and Grid Snapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Objects snap to other objects (edges, centres, equal spacing, matching sizes) and to the page while moving, resizing and drawing; grid snapping lands edges on grid lines; the grid size is settable per project — on desktop, tablet and phone, without slowing the canvas.

**Architecture:** A pure engine in `services/snapping/` builds a sorted target index once per gesture and answers each pointer move with a few binary searches, returning a position correction plus guides to draw. `components/Canvas.tsx` calls it from its move, resize, line-end and creation paths (mouse and touch share these handlers) and draws the result with a memoised SVG overlay. Two new per-project preferences (`gridSize`, `smartGuides`) ride the existing preference lane; a desktop popover and the touch ⋯ sheet edit them.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest + Testing Library (jsdom), Playwright (Chromium desktop + iPhone/iPad emulation).

**Spec:** `docs/superpowers/specs/2026-11-02-smart-guides-grid-snapping-design.md` (read it first; it is the authority where this plan is silent).

## Global Constraints

- Worktree: `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/smart-guides`, branch `feat/smart-guides`. Never work in the main checkout; its `.env` is production — never start servers from it.
- Run unit tests as `env -u DATABASE_URL TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run <paths>`. `node_modules` must be a real `npm ci --legacy-peer-deps` install, never a symlink (a symlink fails `localWorkspaceBoundary.test.ts`).
- Units: page units (pt) everywhere in the engine; screen-px thresholds are divided by the current `scale`.
- Pull distance: **6 screen px for mouse input, 10 screen px for touch input** (from `inputMode`, not layout).
- `gridSize` range **1–200 pt, step 0.5**, default **10**. `smartGuides` default **true** (also for existing projects with no stored value).
- Snapped coordinates are rounded to **0.01 pt**.
- Temporary bypass: **Alt/⌥ held**, sampled on every move event.
- No document schema change: `CURRENT_SCHEMA_VERSION` stays **12**.
- Performance budget (Task 14) is a release gate: engine ≤ 1 ms per move at 2,000 elements on a 4× throttled CPU; p95 drag frame time ≤ 5% worse than baseline at 40/500/2,000 elements; snapping-off and click paths unchanged.
- Do not update `tests/e2e/desktop_layout_guard.spec.js-snapshots` without asking the user first (standing instruction). If that guard fails because the toolbar gained a button, stop and report.
- Do not loosen security-boundary tests (`tests/unit/localWorkspaceBoundary.test.ts`); add no new `window` globals.
- Commit trailer on every commit:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_016CZ6oYo4VzPnW7azRr7jQJ
  ```
- The onboarding bundle (`node onboarding/build.mjs`) is regenerated only once, as the branch's last commit (Task 14); `tests/unit/onboarding/bundle.test.js` is expected to fail until then.
- Never use bare `git stash`. Never commit `server/analytics.db` or anything under `.superpowers/` (benchmark output lives there, untracked).
- Copy rules: UI says "Snap to grid", "Smart guides", "Show grid", "Grid size", "Snapping options"; the Data Grid element and pattern fills keep their own names.

## Review Focus

1. **Existing drags that now snap.** Smart guides default on in the app, so an existing e2e or unit test that drags an object and expects an exact coordinate may now be pulled by a guide. Expected: each such test is changed deliberately (turn guides off for that test, or assert the snapped value) and listed in the task report — never by loosening tolerance. Pinned by Task 12 Step 6 (full e2e run) and Task 7 Step 7 (full unit run).
2. **A click must cost nothing.** Pressing and releasing on an element without passing the drag threshold must not build targets or render guides. Pinned by Task 7 test "a click builds no targets and shows no guides".
3. **Cancelled gestures leave no guides behind.** Escape, pointer cancel, long press, pinch takeover and mouse-leave must clear guides. Pinned by Task 7 tests "Escape clears guides" and "mouse leaving the canvas clears guides" and Task 7 touch test "a long press clears guides".
4. **Hidden layers never pull; locked layers do.** Pinned by Task 4 targets tests and Task 7 canvas tests.
5. **Zoom changes the pull distance.** At scale 2 the mouse pull is 3 pt, not 6. Pinned by Task 7 test "pull distance is 6 screen px at any zoom".

---

## File Structure

New:
- `services/geometry/elementBox.ts` — `Box`, `elementAabb`, `unionBox`, `rotateVector`, `isRightAngle`.
- `services/snapping/types.ts` — engine types and axis helpers.
- `services/snapping/targets.ts` — `buildSnapTargets`, neighbour lookups.
- `services/snapping/snap.ts` — `snapMove`, `snapResize`, `snapPoint`.
- `services/snapping/extras.ts` — equal spacing and size matching candidates.
- `services/snapping/settings.ts` — defaults, clamping, pull distance, grid display step.
- `services/snapping/resize.ts` — `computeResizedBox`, `worldEdgesForHandle`, `rightAngleAabb` (resize math moved out of Canvas).
- `services/snapping/nudge.ts` — `nudgeDelta`.
- `components/canvas/SnapGuides.tsx` — guide overlay.
- `components/SnappingPopover.tsx` — desktop popover.
- Tests under `tests/unit/snapping/`, `tests/unit/canvasSnapping.test.tsx`, `tests/unit/editorToolbarSnapping.test.tsx`, `tests/e2e/editor_snapping.spec.js`, `tests/e2e/snap_drag_performance.spec.js`.
- Docs: `docs-content/reference/editor/smart-guides.md`.

Modified: `types.ts`, `services/document/{partition,contracts,layerFolds}.ts`, `services/localWorkspace/incrementalQueue.ts`, `services/localWorkspace/normalized/repository.ts`, `services/alignElements.ts`, `components/Canvas.tsx`, `components/ProjectEditor.tsx`, `components/EditorToolbar.tsx`, `components/editor-layout/{OverflowMenu.tsx,touchActions.ts}`, `playwright.config.*`, `tests/helpers/touchActions.ts`, docs pages, `onboarding/index.html`.

---

### Task 1: Drag-performance benchmark and baseline (before any product change)

**Files:**
- Create: `tests/e2e/snap_drag_performance.spec.js`
- Modify: `playwright.config.*` (the file at the repo root; `ls playwright.config.*`)

**Interfaces:**
- Produces: a Playwright spec that writes `${SNAP_PERF_OUTPUT}/${SNAP_PERF_PHASE}-${project}.json` with per-size, per-config `{ handler: {p50,p95,mean}, frame: {p50,p95,mean} }` in ms. Task 14 reruns it unchanged with `SNAP_PERF_PHASE=final`.

- [ ] **Step 1: Install dependencies in the worktree**

```bash
cd /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/smart-guides && npm ci --legacy-peer-deps --no-audit --no-fund
```

- [ ] **Step 2: Add opt-in Playwright projects**

In `playwright.config.*`, add `/snap_drag_performance\.spec\.js$/` to the `testIgnore` arrays of the `chromium`, `firefox` and `webkit` projects, and append to `projects`:

```js
        ...(process.env.SNAP_PERF ? [{
            name: 'snap-perf-desktop',
            testMatch: /snap_drag_performance\.spec\.js$/,
            use: { ...devices['Desktop Chrome'], trace: 'off' },
        }, {
            name: 'snap-perf-tablet',
            testMatch: /snap_drag_performance\.spec\.js$/,
            use: { ...devices['iPad (gen 7)'], browserName: 'chromium', trace: 'off' },
        }] : []),
```

- [ ] **Step 3: Write the benchmark spec**

```js
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { openFreshEditor } from './localWorkspaceHelpers.js';

// Opt-in drag benchmark (SNAP_PERF=1). Phase "baseline" runs on the code before smart guides,
// "final" after. Each page size is filled with rects laid out on a regular lattice so many edges
// line up — the worst case for merged snap targets.
const OUT = process.env.SNAP_PERF_OUTPUT;
const PHASE = process.env.SNAP_PERF_PHASE;
const SIZES = [40, 500, 2000];
const STEPS = 120;
const REPEATS = 3;

const stats = values => {
    const sorted = [...values].sort((a, b) => a - b);
    const at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    return { p50: at(0.5), p95: at(0.95), mean: values.reduce((s, v) => s + v, 0) / values.length };
};

const pane = page => page.locator('[data-testid="project-pane"][data-active="true"]');

async function applyElements(page, count) {
    await pane(page).getByRole('button', { name: 'JSON', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Project JSON Editor' })).toBeVisible();
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    const area = page.locator('textarea');
    const state = JSON.parse(await area.inputValue());
    const template = state.variants[state.activeVariantId].templates[state.nodes[state.rootId].type];
    const layerId = template.layers?.[0]?.id;
    const cols = Math.ceil(Math.sqrt(count * template.width / template.height));
    const rows = Math.ceil(count / cols);
    const cw = template.width / cols, ch = template.height / rows;
    template.elements = Array.from({ length: count }, (_, i) => ({
        id: `bench-${i}`, type: 'rect', layerId,
        x: (i % cols) * cw + 1, y: Math.floor(i / cols) * ch + 1, w: Math.max(2, cw - 2), h: Math.max(2, ch - 2),
        rotation: 0, fill: '#e2e8f0', stroke: '#334155', strokeWidth: 0.5, opacity: 1,
    }));
    await area.fill(JSON.stringify(state));
    await page.getByRole('button', { name: 'Apply Changes', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Project JSON Editor' })).toHaveCount(0, { timeout: 120_000 });
    await expect(pane(page).locator('[data-element-id]')).toHaveCount(count, { timeout: 120_000 });
}

const isTouchProject = info => info.project.name.endsWith('tablet');

// Sets snapping through the UI. `guides` is ignored where the control does not exist (baseline).
async function setSnapping(page, info, { grid, guides }) {
    if (isTouchProject(info)) {
        await page.getByRole('button', { name: 'More actions' }).click();
        const menu = page.getByRole('dialog', { name: 'More actions' });
        const toggle = async (name, want) => {
            const item = menu.getByRole('button', { name, exact: true });
            if (await item.count() === 0) return;
            if ((await item.getAttribute('aria-pressed')) !== String(want)) await item.click();
        };
        await toggle('Snap to grid', grid);
        await toggle('Smart guides', guides);
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
        return;
    }
    const magnet = page.getByTitle('Snap to Grid', { exact: true });
    if ((await magnet.getAttribute('class')).includes('bg-blue-600') !== grid) await magnet.click();
    const options = page.getByTitle('Snapping options', { exact: true });
    if (await options.count()) {
        await options.click();
        const sw = page.getByRole('switch', { name: 'Smart guides' });
        if ((await sw.isChecked()) !== guides) await sw.click();
        await page.keyboard.press('Escape');
    }
}

// Desktop: real mousedown, then synthetic mousemoves timed in the page. `handler` is the synchronous
// dispatch time (the canvas handler, including any snapping); `frame` runs to the next animation frame.
async function measureMouseDrag(page) {
    const target = pane(page).locator('[data-element-id="bench-0"]');
    const b = await target.boundingBox();
    const x0 = b.x + b.width / 2, y0 = b.y + b.height / 2;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    const samples = await page.evaluate(async ({ x0, y0, steps }) => {
        const surface = document.querySelector('[data-testid="project-pane"][data-active="true"] .canvas-scroll-container');
        const out = { handler: [], frame: [] };
        for (let i = 1; i <= steps; i++) {
            const t0 = performance.now();
            surface.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x0 + i * 2, clientY: y0 + i }));
            out.handler.push(performance.now() - t0);
            await new Promise(r => requestAnimationFrame(() => r()));
            out.frame.push(performance.now() - t0);
        }
        return out;
    }, { x0, y0, steps: STEPS });
    await page.mouse.up();
    return samples;
}

// Tablet: real CDP touch events; frame intervals recorded by an in-page rAF loop.
async function measureTouchDrag(page, cdp) {
    const target = pane(page).locator('[data-element-id="bench-0"]');
    const b = await target.boundingBox();
    const x0 = b.x + b.width / 2, y0 = b.y + b.height / 2;
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    await touch('touchStart', x0, y0); await touch('touchEnd', x0, y0); // select
    await page.waitForTimeout(400); // past the double-tap window
    await page.evaluate(() => {
        window.__benchFrames = []; let last = performance.now();
        const loop = now => { window.__benchFrames.push(now - last); last = now; if (window.__benchFrames.length < 100000 && !window.__benchStop) requestAnimationFrame(loop); };
        window.__benchStop = false; requestAnimationFrame(loop);
    });
    await touch('touchStart', x0, y0);
    for (let i = 1; i <= STEPS; i++) await touch('touchMove', x0 + i * 2, y0 + i);
    await touch('touchEnd', x0 + STEPS * 2, y0 + STEPS);
    const frames = await page.evaluate(() => { window.__benchStop = true; return window.__benchFrames.slice(2); });
    return { handler: [], frame: frames };
}

test('drag frame times by page size and snapping', async ({ page }, info) => {
    test.setTimeout(1_800_000);
    expect(['baseline', 'final']).toContain(PHASE);
    expect(OUT).toBeTruthy();
    const configs = PHASE === 'baseline'
        ? [{ name: 'off', grid: false, guides: false }, { name: 'grid', grid: true, guides: false }]
        : [{ name: 'off', grid: false, guides: false }, { name: 'grid', grid: true, guides: false },
            { name: 'guides', grid: false, guides: true }, { name: 'both', grid: true, guides: true }];
    const cdp = await page.context().newCDPSession(page);
    const results = {};
    for (const size of SIZES) {
        await openFreshEditor(page);
        await expect(page.getByTestId('project-tab').filter({ hasText: 'Blank Project' })).toBeVisible();
        await applyElements(page, size);
        results[size] = {};
        for (const config of configs) {
            await setSnapping(page, info, config);
            await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
            const handler = [], frame = [];
            for (let r = 0; r < REPEATS; r++) {
                const s = isTouchProject(info) ? await measureTouchDrag(page, cdp) : await measureMouseDrag(page);
                handler.push(...s.handler); frame.push(...s.frame);
                await page.keyboard.press(isTouchProject(info) ? 'Escape' : 'Control+z');
            }
            await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
            results[size][config.name] = { handler: handler.length ? stats(handler) : null, frame: stats(frame) };
            console.info(`[snap-perf] ${info.project.name} ${size} ${config.name}`, JSON.stringify(results[size][config.name]));
        }
    }
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/${PHASE}-${info.project.name}.json`, JSON.stringify(results, null, 2));
});
```

- [ ] **Step 4: Run the baseline on unchanged product code**

```bash
cd /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/smart-guides && env -u DATABASE_URL SNAP_PERF=1 SNAP_PERF_PHASE=baseline SNAP_PERF_OUTPUT=$PWD/../../.superpowers/bench/smart-guides npx playwright test --project=snap-perf-desktop --project=snap-perf-tablet --workers=1
```

Expected: PASS; `.superpowers/bench/smart-guides/baseline-snap-perf-desktop.json` and `baseline-snap-perf-tablet.json` exist (in the main checkout's untracked `.superpowers/`). If the tablet project cannot select or drag (layout differs), fix the spec's locators, not product code. Record the p95 frame values in the task report.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/snap_drag_performance.spec.js playwright.config.*
git commit -m "test(perf): opt-in drag benchmark for snapping, by page size

<trailer>"
```

---

### Task 2: Shared element bounds and rotation-aware align

**Files:**
- Create: `services/geometry/elementBox.ts`
- Modify: `services/alignElements.ts`, `components/ProjectEditor.tsx` (incremental `align` at ~:1457-1476)
- Test: `tests/unit/geometry/elementBox.test.ts`, `tests/unit/alignElements.test.ts` (extend)

**Interfaces:**
- Produces:
  - `interface Box { x: number; y: number; w: number; h: number }`
  - `elementAabb(el: TemplateElement, nodes: Record<string, AppNode>, currentNodeId: string): Box`
  - `unionBox(boxes: Box[]): Box | null`
  - `rotateVector(x: number, y: number, deg: number): { x: number; y: number }`
  - `isRightAngle(deg: number): boolean`
  - `alignmentOffsets(items: { id: string; box: Box }[], type: AlignType): Map<string, { dx: number; dy: number }>`
  - `alignElements(elements, selectedElementIds, type, nodes = {}, currentNodeId = '')` (new optional params)

Ruling (from the spec's "where behaviour is identical"): Canvas's private `getGroupBounds` uses one-cell size for rotated Data Grids, so it is not identical; leave Canvas's copies untouched in this plan.

- [ ] **Step 1: Write the failing tests**

`tests/unit/geometry/elementBox.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { elementAabb, isRightAngle, rotateVector, unionBox } from '../../../services/geometry/elementBox';
import type { TemplateElement } from '../../../types';

const el = (o: Partial<TemplateElement>): TemplateElement => ({
    id: 'e', type: 'rect', x: 0, y: 0, w: 100, h: 20, rotation: 0, fill: '', stroke: '', strokeWidth: 0, opacity: 1, ...o,
}) as TemplateElement;

describe('elementAabb', () => {
    it('is the box itself without rotation', () => {
        expect(elementAabb(el({ x: 10, y: 20 }), {}, 'root')).toEqual({ x: 10, y: 20, w: 100, h: 20 });
    });
    it('rotates about the default centre origin', () => {
        const b = elementAabb(el({ rotation: 90 }), {}, 'root');
        expect(b.x).toBeCloseTo(40); expect(b.y).toBeCloseTo(-40); expect(b.w).toBeCloseTo(20); expect(b.h).toBeCloseTo(100);
    });
    it('honours a custom transform origin', () => {
        const b = elementAabb(el({ rotation: 90, transformOrigin: { x: 0, y: 0 } }), {}, 'root');
        expect(b.x).toBeCloseTo(-20); expect(b.y).toBeCloseTo(0); expect(b.w).toBeCloseTo(20); expect(b.h).toBeCloseTo(100);
    });
    it('expands a Data Grid to its full table', () => {
        const grid = el({ type: 'grid', w: 20, h: 10, gridConfig: { cols: 3, gapX: 10, gapY: 5 } as TemplateElement['gridConfig'] });
        const b = elementAabb(grid, {}, 'root');
        expect(b.w).toBe(3 * 20 + 2 * 10);
        expect(b.h).toBe(2 * 10 + 1 * 5); // 6 placeholder items over 3 columns = 2 rows
    });
});

describe('helpers', () => {
    it('unions boxes', () => {
        expect(unionBox([{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: -5, w: 5, h: 5 }])).toEqual({ x: 0, y: -5, w: 25, h: 15 });
        expect(unionBox([])).toBeNull();
    });
    it('rotates vectors like the canvas (y down)', () => {
        const v = rotateVector(1, 0, 90); expect(v.x).toBeCloseTo(0); expect(v.y).toBeCloseTo(1);
    });
    it('recognises right angles', () => {
        expect([0, 90, -90, 180, 270, 360, 450].every(isRightAngle)).toBe(true);
        expect([30, 45, 89.5].some(isRightAngle)).toBe(false);
    });
});
```

Append to `tests/unit/alignElements.test.ts`:

```ts
import { alignElements as alignWithBounds } from '../../services/alignElements';

describe('align uses each element\'s visible (rotated) box', () => {
    const base = { type: 'rect', rotation: 0, fill: '', stroke: '', strokeWidth: 0, opacity: 1 } as const;
    // A 100x20 bar rotated 90° stands 20 wide, centred at x=50: its visible left edge is x=40.
    const bar = { ...base, id: 'bar', x: 0, y: 0, w: 100, h: 20, rotation: 90 } as any;
    const box = { ...base, id: 'box', x: 100, y: 0, w: 30, h: 30 } as any;
    it('aligns left edges by the rotated outline', () => {
        const out = alignWithBounds([bar, box], ['bar', 'box'], 'left');
        expect(out.find(e => e.id === 'bar')!.x).toBeCloseTo(0);
        expect(out.find(e => e.id === 'box')!.x).toBeCloseTo(40);
    });
    it('distributes by visible widths', () => {
        const c = { ...base, id: 'c', x: 300, y: 0, w: 30, h: 30 } as any;
        const out = alignWithBounds([bar, box, c], ['bar', 'box', 'c'], 'dist-h');
        // Visible span 40..330, widths 20+30+30=80, two gaps of (290-80)/2=105: box left = 60+105 = 165.
        expect(out.find(e => e.id === 'box')!.x).toBeCloseTo(165);
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `env -u DATABASE_URL TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/unit/geometry/elementBox.test.ts tests/unit/alignElements.test.ts`
Expected: FAIL — module `services/geometry/elementBox` not found; rotated align expectations differ.

- [ ] **Step 3: Implement `services/geometry/elementBox.ts`**

```ts
import type { AppNode, TemplateElement } from '../../types';
import { getElementBounds } from '../../components/canvas/elementBounds';

/** An axis-aligned rectangle in page units (pt). */
export interface Box { x: number; y: number; w: number; h: number }

/** Rotate a vector by `deg` in the canvas's y-down frame (positive = clockwise on screen). */
export const rotateVector = (x: number, y: number, deg: number) => {
    const r = deg * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
    return { x: x * cos - y * sin, y: x * sin + y * cos };
};

export const isRightAngle = (deg: number) => {
    const m = ((deg % 90) + 90) % 90;
    return m < 1e-6 || 90 - m < 1e-6;
};

/**
 * The axis-aligned outer box of an element as drawn: Data Grids at full table size, rotation about
 * `transformOrigin` (default centre). Align, distribute and snapping all measure this box.
 */
export function elementAabb(el: TemplateElement, nodes: Record<string, AppNode>, currentNodeId: string): Box {
    const { w, h } = getElementBounds(el, nodes, currentNodeId);
    const deg = el.rotation || 0;
    if (!deg) return { x: el.x, y: el.y, w, h };
    const ox = el.transformOrigin?.x ?? 0.5, oy = el.transformOrigin?.y ?? 0.5;
    const ax = el.x + w * ox, ay = el.y + h * oy;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [px, py] of [[el.x, el.y], [el.x + w, el.y], [el.x + w, el.y + h], [el.x, el.y + h]]) {
        const v = rotateVector(px - ax, py - ay, deg);
        minX = Math.min(minX, ax + v.x); maxX = Math.max(maxX, ax + v.x);
        minY = Math.min(minY, ay + v.y); maxY = Math.max(maxY, ay + v.y);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function unionBox(boxes: Box[]): Box | null {
    if (boxes.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const b of boxes) {
        minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
```

- [ ] **Step 4: Rewrite `alignElements` on visible boxes**

In `services/alignElements.ts`, keep `AlignType`, `ALIGN_ACTIONS`, `currentTemplateIdOf` and `alignSelectedElements` (pass `state.nodes, state.selectedNodeId` through), and replace `alignElements` with:

```ts
import type { AppNode, AppState, TemplateElement } from '../types';
import { elementAabb, type Box } from './geometry/elementBox';

/**
 * How far each selected element moves to align or distribute their visible boxes. The outermost
 * two stay put when distributing. Shared by the legacy editor and the incremental editor.
 */
export function alignmentOffsets(items: { id: string; box: Box }[], type: AlignType): Map<string, { dx: number; dy: number }> {
    const out = new Map<string, { dx: number; dy: number }>();
    if (items.length < 2) return out;
    const horizontal = type === 'left' || type === 'center' || type === 'right' || type === 'dist-h';
    const lo = (b: Box) => horizontal ? b.x : b.y;
    const len = (b: Box) => horizontal ? b.w : b.h;
    const set = (id: string, d: number) => out.set(id, horizontal ? { dx: d, dy: 0 } : { dx: 0, dy: d });
    const min = Math.min(...items.map(i => lo(i.box)));
    const max = Math.max(...items.map(i => lo(i.box) + len(i.box)));
    if (type === 'dist-h' || type === 'dist-v') {
        const sorted = [...items].sort((a, b) => lo(a.box) - lo(b.box));
        const gap = (max - min - sorted.reduce((s, i) => s + len(i.box), 0)) / (sorted.length - 1);
        let cursor = min;
        sorted.forEach((item, index) => {
            const last = index === sorted.length - 1;
            set(item.id, last ? 0 : cursor - lo(item.box));
            cursor += len(item.box) + gap;
        });
        return out;
    }
    for (const { id, box } of items) {
        const target = type === 'left' || type === 'top' ? min
            : type === 'right' || type === 'bottom' ? max - len(box)
            : (min + max - len(box)) / 2;
        set(id, target - lo(box));
    }
    return out;
}

export function alignElements(elements: TemplateElement[], selectedElementIds: string[], type: AlignType,
    nodes: Record<string, AppNode> = {}, currentNodeId = ''): TemplateElement[] {
    const items = elements.filter(el => selectedElementIds.includes(el.id))
        .map(el => ({ id: el.id, box: elementAabb(el, nodes, currentNodeId) }));
    if (items.length < 2) return elements;
    const offsets = alignmentOffsets(items, type);
    return elements.map(el => {
        const o = offsets.get(el.id);
        return o && (o.dx || o.dy) ? { ...el, x: el.x + o.dx, y: el.y + o.dy } : el;
    });
}
```

In `alignSelectedElements`, call `alignElements(template.elements, selectedElementIds, type, state.nodes, state.selectedNodeId)`.

- [ ] **Step 5: Use the same offsets in the incremental editor**

In `components/ProjectEditor.tsx`, replace the body of `const align: ToolbarActions['onAlign'] = type => { ... }` (~:1457) with:

```ts
    const align: ToolbarActions['onAlign'] = type => {
        const current = read(); const template = editor.getCurrent().document.variants[current.activeVariantId]?.templates[templateIdFor(current)];
        const items = (template?.elements ?? []).filter(element => current.selectedElementIds.includes(element.id))
            .map(element => ({ id: element.id, box: elementAabb(element, current.nodes, current.selectedNodeId) }));
        if (items.length < 2) return;
        const offsets = alignmentOffsets(items, type);
        patchElements(current.selectedElementIds, element => {
            const o = offsets.get(element.id);
            return o ? { x: element.x + o.dx, y: element.y + o.dy } : {};
        }, true);
        run(finishGroups);
    };
```

Add imports `alignmentOffsets` (from `../services/alignElements`) and `elementAabb` (from `../services/geometry/elementBox`). If `patchElements` rejects an empty patch, return `{ x: element.x }` instead of `{}`.

- [ ] **Step 6: Run tests**

Run: `env -u DATABASE_URL TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/unit/geometry tests/unit/alignElements.test.ts tests/unit/ProjectEditor.incrementalChanges.test.tsx tests/unit/ProjectEditor.touchLayout.test.tsx`
Expected: PASS. Existing unrotated align tests are unchanged in outcome; if one asserts a patch field set (e.g. only `x`), keep the patch to the moved axis: return `{ x: element.x + o.dx }` for horizontal types and `{ y: element.y + o.dy }` for vertical.

- [ ] **Step 7: Commit**

```bash
git add services/geometry services/alignElements.ts components/ProjectEditor.tsx tests/unit/geometry tests/unit/alignElements.test.ts
git commit -m "fix(align): align and distribute by each element's visible, rotated box

<trailer>"
```

---

### Task 3: Snapping preferences (`gridSize`, `smartGuides`)

**Files:**
- Create: `services/snapping/settings.ts`
- Modify: `types.ts:186-187`, `services/document/partition.ts:8-35`, `services/document/contracts.ts:8-14`, `services/document/layerFolds.ts:176-178`, `services/localWorkspace/incrementalQueue.ts:250-251`, `services/localWorkspace/normalized/repository.ts:2766-2767`
- Test: `tests/unit/snapping/settings.test.ts`, `tests/unit/document/partition.test.ts`, `tests/unit/document/layerFolds.test.ts`, `tests/unit/localWorkspace/normalized/incrementalQueue.test.ts`

**Interfaces:**
- Produces:
  - `AppState.gridSize?: number`, `AppState.smartGuides?: boolean`
  - `DEFAULT_GRID_SIZE = 10`, `MIN_GRID_SIZE = 1`, `MAX_GRID_SIZE = 200`, `GRID_QUICK_PICKS = [2, 5, 10, 20]`
  - `clampGridSize(value: number): number`
  - `parseGridSize(text: string): number | null` (null = invalid, revert)
  - `snapSettingsOf(state: Pick<AppState, 'snapToGrid' | 'showGrid' | 'gridSize' | 'smartGuides'>): { snapToGrid: boolean; showGrid: boolean; gridSize: number; smartGuides: boolean }`
  - `pullDistancePx(input: 'mouse' | 'touch'): number`
  - `gridDisplayStep(gridSize: number, scale: number): number`

- [ ] **Step 1: Write the failing tests**

`tests/unit/snapping/settings.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { clampGridSize, gridDisplayStep, parseGridSize, pullDistancePx, snapSettingsOf } from '../../../services/snapping/settings';

describe('snapping settings', () => {
    it('defaults grid size to 10 and guides to on', () => {
        expect(snapSettingsOf({ snapToGrid: false, showGrid: false })).toEqual({ snapToGrid: false, showGrid: false, gridSize: 10, smartGuides: true });
        expect(snapSettingsOf({ snapToGrid: true, showGrid: true, gridSize: 20, smartGuides: false }).smartGuides).toBe(false);
    });
    it('clamps to 1–200 in steps of 0.5', () => {
        expect(clampGridSize(0)).toBe(1); expect(clampGridSize(500)).toBe(200);
        expect(clampGridSize(2.3)).toBe(2.5); expect(clampGridSize(7.74)).toBe(7.5); expect(clampGridSize(NaN)).toBe(10);
    });
    it('parses typed sizes, rejecting non-numbers', () => {
        expect(parseGridSize('12')).toBe(12); expect(parseGridSize(' 0.5 ')).toBe(1); expect(parseGridSize('900')).toBe(200);
        expect(parseGridSize('')).toBeNull(); expect(parseGridSize('abc')).toBeNull();
    });
    it('pulls 6 px with a mouse and 10 px with touch', () => {
        expect(pullDistancePx('mouse')).toBe(6); expect(pullDistancePx('touch')).toBe(10);
    });
    it('thins the drawn grid until dots are at least 8 screen px apart', () => {
        expect(gridDisplayStep(10, 1)).toBe(10);
        expect(gridDisplayStep(10, 0.5)).toBe(20);   // 5 px apart -> every 2nd
        expect(gridDisplayStep(2, 0.5)).toBe(20);    // 1 px apart; 2x5 is still 5 px, so every 10th
        expect(gridDisplayStep(1, 4)).toBe(2);
    });
});
```

In `tests/unit/document/partition.test.ts` ("explicitly classifies every AppState field", ~:200): change the `Object.assign` line to `Object.assign(state, { showLayersPanel: false, templatePreviewNodeId: 'root', gridSize: 10, smartGuides: true });` and the preference list to `['activeVariantId', 'selectedNodeId', 'selectedTemplateId', 'scale', 'viewMode', 'sidebarWidth', 'propertiesPanelWidth', 'snapToGrid', 'showGrid', 'gridSize', 'smartGuides']`.

Append to `tests/unit/document/layerFolds.test.ts` (use the file's existing helper that builds a `LayerFoldState`; if it is named differently than `foldState()`, use that name):

```ts
it('accepts the snapping preferences', () => {
    const state = foldState();
    const next = updateLayerFoldPreferences(state, { gridSize: 20, smartGuides: false });
    expect(next.parts.preferences).toMatchObject({ gridSize: 20, smartGuides: false });
});
```

Append to `tests/unit/localWorkspace/normalized/incrementalQueue.test.ts` (next to the test that enqueues `{ showGrid: true }`, same harness):

```ts
it('sends the snapping preferences on the preference lane', async () => {
    vi.useFakeTimers(); const h = createIncrementalQueueHarness();
    const pref = h.observe(h.queue.enqueuePreferences('p', 1, { gridSize: 20, smartGuides: false }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.requests[0]).toMatchObject({ type: 'preferences', batch: { patch: { gridSize: 20, smartGuides: false } } });
    h.resolveNext(); await pref; h.dispose();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `env -u DATABASE_URL TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/unit/snapping/settings.test.ts tests/unit/document tests/unit/localWorkspace/normalized/incrementalQueue.test.ts`
Expected: FAIL — settings module missing; "Unknown editor preference."; partition key mismatch.

- [ ] **Step 3: Implement `services/snapping/settings.ts`**

```ts
import type { AppState } from '../../types';

export const DEFAULT_GRID_SIZE = 10;
export const MIN_GRID_SIZE = 1;
export const MAX_GRID_SIZE = 200;
export const GRID_QUICK_PICKS = [2, 5, 10, 20] as const;

export const clampGridSize = (value: number): number => {
    if (!Number.isFinite(value)) return DEFAULT_GRID_SIZE;
    return Math.min(MAX_GRID_SIZE, Math.max(MIN_GRID_SIZE, Math.round(value * 2) / 2));
};

/** A typed grid size, clamped; null when the text is not a number (the field reverts). */
export const parseGridSize = (text: string): number | null => {
    const trimmed = text.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? clampGridSize(n) : null;
};

/** The snapping preferences with their defaults applied (stored projects may lack the newer two). */
export const snapSettingsOf = (state: Pick<AppState, 'snapToGrid' | 'showGrid' | 'gridSize' | 'smartGuides'>) => ({
    snapToGrid: !!state.snapToGrid,
    showGrid: !!state.showGrid,
    gridSize: clampGridSize(state.gridSize ?? DEFAULT_GRID_SIZE),
    smartGuides: state.smartGuides ?? true,
});

/** How far, in screen pixels, a guide pulls: wider for a finger. */
export const pullDistancePx = (input: 'mouse' | 'touch') => input === 'touch' ? 10 : 6;

const DISPLAY_MULTIPLIERS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
/** The drawn grid's spacing: the grid size, or a multiple once dots would sit closer than 8 screen px. */
export const gridDisplayStep = (gridSize: number, scale: number): number => {
    for (const m of DISPLAY_MULTIPLIERS) if (gridSize * m * scale >= 8) return gridSize * m;
    return gridSize * DISPLAY_MULTIPLIERS[DISPLAY_MULTIPLIERS.length - 1];
};
```

- [ ] **Step 4: Plumb the two fields**

- `types.ts` after `showGrid: boolean;`: `gridSize?: number;   // Snap grid spacing in pt (1–200, default 10)` and `smartGuides?: boolean;  // Snap to other objects and the page (default on)`.
- `services/document/partition.ts` classification: add `gridSize: 'preference',` and `smartGuides: 'preference',` after `showGrid`.
- `services/document/contracts.ts` `EditorPreferences` Pick: `| 'snapToGrid' | 'showGrid' | 'gridSize' | 'smartGuides'`.
- `services/document/layerFolds.ts:177-178`, `services/localWorkspace/incrementalQueue.ts:250-251`, `services/localWorkspace/normalized/repository.ts:2766-2767`: add `'gridSize', 'smartGuides'` after `'showGrid'` in each list.
- Then `git grep -n "'showGrid', 'panelsExpanded'"` and `git grep -n "\"showGrid\""` across `services/` and `server/`; add the two keys to any further allow-list found and mention it in the report.

- [ ] **Step 5: Run tests**

Run: `env -u DATABASE_URL TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/unit/snapping tests/unit/document tests/unit/localWorkspace`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add types.ts services/snapping/settings.ts services/document services/localWorkspace tests/unit/snapping tests/unit/document tests/unit/localWorkspace
git commit -m "feat(snapping): gridSize and smartGuides preferences

<trailer>"
```

---

### Task 4: Snapping engine — targets, alignment, grid

**Files:**
- Create: `services/snapping/types.ts`, `services/snapping/targets.ts`, `services/snapping/core.ts`, `services/snapping/snap.ts`, `services/snapping/extras.ts` (stub)
- Test: `tests/unit/snapping/targets.test.ts`, `tests/unit/snapping/snap.test.ts`

**Interfaces:**
- Consumes: `Box`, `elementAabb` (Task 2).
- Produces:
  - `types.ts`: `Box` (re-export), `Point`, `Axis`, `EdgeSide = 'min' | 'max'`, `ResizeEdges { x: EdgeSide | null; y: EdgeSide | null }`, `SnapSettings { grid: number | null; guides: boolean; threshold: number }`, `Guide`, `SnapResult { dx; dy; snappedX; snappedY; guides }`, helpers `lo`, `hi`, `len`, `other`, `round2`.
  - `targets.ts`: `buildSnapTargets(input: TargetInput): SnapTargets`, `nextNeighbour`, `previousNeighbour`, `overlaps`, constants `MAX_SOURCES = 20`, `NEIGHBOUR_SCAN = 64`, ranks `RANK_EDGE = 0`, `RANK_CENTRE = 1`, `RANK_PAGE = 2`, `RANK_SPACING = 3`, `RANK_SIZE = 4`.
  - `core.ts`: `Win { delta; rank; kind: 'align' | 'spacing' | 'size' | 'grid'; make?: (finalBox: Box) => Guide }`, `better(c, best)`, `nearestIndex(values, v)`, `bracket(values, v): number[]` (the indices just below and at/above `v` — both are checked so a tie between two targets is decided by rank, not by which side the search landed on).
  - `snap.ts`: `snapMove(T, box, s): SnapResult`, `snapResize(T, box, edges, s): SnapResult`, `snapPoint(T, p, s, axes?): SnapResult`, `gridLine`.

`Guide` semantics: `align` axis `'x'` is a vertical line at x=`at` from y=`from` to y=`to` (axis `'y'` is horizontal). `distance` axis `'y'` is a vertical segment at x=`at` from y=`from` to `to` (value `to - from`). `spacing` axis `'x'` holds horizontal segments `{ at: y, from: x1, to: x2 }` all of length `gap`. `size` axis `'x'` labels each box's width `size`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/snapping/targets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildSnapTargets, MAX_SOURCES, RANK_CENTRE, RANK_EDGE, RANK_PAGE } from '../../../services/snapping/targets';
import type { Layer, TemplateElement } from '../../../types';

const el = (id: string, x: number, y: number, w: number, h: number, extra: Partial<TemplateElement> = {}) =>
    ({ id, type: 'rect', x, y, w, h, rotation: 0, fill: '', stroke: '', strokeWidth: 0, opacity: 1, ...extra }) as TemplateElement;
const layer = (id: string, o: Partial<Layer> = {}): Layer => ({ id, name: id, order: 0, visible: true, locked: false, ...o });
const build = (elements: TemplateElement[], layers?: Layer[], excludeIds: string[] = []) =>
    buildSnapTargets({ elements, layers, excludeIds, page: { w: 500, h: 700 }, nodes: {}, currentNodeId: 'root' });
const rankOf = (t: { values: number[]; ranks: number[] }, v: number) => t.ranks[t.values.indexOf(v)];

describe('buildSnapTargets', () => {
    it('collects edges, centres and the page', () => {
        const T = build([el('a', 10, 20, 100, 50)]);
        expect(T.x.values).toEqual([0, 10, 60, 110, 250, 500]);
        expect(rankOf(T.x, 10)).toBe(RANK_EDGE); expect(rankOf(T.x, 60)).toBe(RANK_CENTRE); expect(rankOf(T.x, 250)).toBe(RANK_PAGE);
        expect(T.y.values).toEqual([0, 20, 45, 70, 350, 700]);
    });
    it('leaves out the moving elements and hidden layers, keeps locked and untagged ones', () => {
        const layers = [layer('hidden', { visible: false }), layer('locked', { locked: true })];
        const T = build([el('m', 30, 0, 10, 10), el('h', 40, 0, 10, 10, { layerId: 'hidden' }),
            el('l', 70, 0, 10, 10, { layerId: 'locked' }), el('u', 90, 0, 10, 10)], layers, ['m']);
        expect(T.x.values).not.toContain(30); expect(T.x.values).not.toContain(40);
        expect(T.x.values).toContain(70); expect(T.x.values).toContain(90);
    });
    it('merges positions shared by many objects and caps their sources', () => {
        const T = build(Array.from({ length: 30 }, (_, i) => el(`c${i}`, 10, i * 20, 50, 10)));
        expect(T.x.values.filter(v => v === 10)).toHaveLength(1);
        expect(T.x.sources[T.x.values.indexOf(10)]).toHaveLength(MAX_SOURCES);
    });
    it('counts a zero-width line once on that axis', () => {
        const T = build([el('v', 40, 100, 0, 50, { type: 'line' })]);
        expect(T.x.values.filter(v => v === 40)).toHaveLength(1);
        expect(rankOf(T.x, 40)).toBe(RANK_EDGE);
    });
    it('measures rotated elements by their outer box', () => {
        const T = build([el('r', 0, 100, 100, 20, { rotation: 90 })]);
        expect(T.x.values).toContain(40); expect(T.x.values).toContain(60);
    });
    it('records gaps between neighbours that face each other', () => {
        const T = build([el('a', 0, 0, 100, 50), el('b', 130, 0, 100, 50), el('c', 300, 200, 50, 50)]);
        expect(T.gaps.x.values).toEqual([30]);
    });
    it('records sizes for matching', () => {
        const T = build([el('a', 0, 0, 120, 40), el('b', 200, 0, 120, 60)]);
        expect(T.w.values).toEqual([120]); expect(T.h.values).toEqual([40, 60]);
    });
});
```

`tests/unit/snapping/snap.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildSnapTargets } from '../../../services/snapping/targets';
import { snapMove, snapPoint, snapResize } from '../../../services/snapping/snap';
import type { SnapSettings } from '../../../services/snapping/types';
import type { TemplateElement } from '../../../types';

const el = (id: string, x: number, y: number, w: number, h: number) =>
    ({ id, type: 'rect', x, y, w, h, rotation: 0, fill: '', stroke: '', strokeWidth: 0, opacity: 1 }) as TemplateElement;
const T = (...elements: TemplateElement[]) =>
    buildSnapTargets({ elements, excludeIds: [], page: { w: 500, h: 700 }, nodes: {}, currentNodeId: 'root' });
const guides: SnapSettings = { grid: null, guides: true, threshold: 6 };

describe('snapMove', () => {
    it('pulls an edge onto a nearby edge and draws the guide', () => {
        const r = snapMove(T(el('a', 100, 100, 100, 50)), { x: 103, y: 400, w: 50, h: 50 }, guides);
        expect(r.dx).toBeCloseTo(-3); expect(r.snappedX).toBe(true);
        expect(r.guides).toContainEqual(expect.objectContaining({ kind: 'align', axis: 'x', at: 100 }));
    });
    it('leaves the box alone beyond the pull distance', () => {
        const r = snapMove(T(el('a', 100, 100, 100, 50)), { x: 110, y: 400, w: 50, h: 50 }, guides);
        expect(r.dx).toBe(0); expect(r.snappedX).toBe(false);
    });
    it('aligns centres', () => {
        const r = snapMove(T(el('a', 100, 100, 100, 50)), { x: 127, y: 400, w: 50, h: 50 }, guides);
        expect(r.dx).toBeCloseTo(-2); // centre 152 -> 150
    });
    it('prefers an object edge over the page at equal distance', () => {
        // Left edge 5 is 5 from the page edge (0) and 5 from a's left edge (10): the object wins.
        const r = snapMove(T(el('a', 10, 300, 50, 50)), { x: 5, y: 500, w: 100, h: 30 }, guides);
        expect(r.dx).toBeCloseTo(5);
    });
    it('snaps to the page centre on an empty page', () => {
        const r = snapMove(T(), { x: 197, y: 500, w: 100, h: 30 }, guides);
        expect(r.dx).toBeCloseTo(3);
    });
    it('snaps the left/top edge onto the grid when no guide is in range', () => {
        const r = snapMove(T(), { x: 33, y: 47, w: 31, h: 31 }, { grid: 10, guides: false, threshold: 6 });
        expect(r.dx).toBeCloseTo(-3); expect(r.dy).toBeCloseTo(3); expect(r.guides).toEqual([]);
    });
    it('lets a guide in range win over the grid', () => {
        const r = snapMove(T(el('a', 34, 300, 50, 50)), { x: 32, y: 500, w: 20, h: 20 }, { grid: 10, guides: true, threshold: 6 });
        expect(r.dx).toBeCloseTo(2);
    });
    it('draws at most two align guides per axis and spans to the nearest source', () => {
        const r = snapMove(T(el('a', 100, 100, 50, 50)), { x: 101, y: 200, w: 50, h: 50 }, guides);
        const xs = r.guides.filter(g => g.kind === 'align' && g.axis === 'x');
        expect(xs).toHaveLength(2);
        expect(xs[0]).toMatchObject({ from: 100, to: 250 });
    });
    it('labels the gap to the aligned neighbour', () => {
        const r = snapMove(T(el('a', 100, 100, 50, 50)), { x: 101, y: 200, w: 50, h: 50 }, guides);
        expect(r.guides).toContainEqual({ kind: 'distance', axis: 'y', at: 100, from: 150, to: 200 });
    });
});

describe('snapResize', () => {
    it('snaps only the moving edge', () => {
        const r = snapResize(T(el('a', 0, 300, 100, 50)), { x: 3, y: 0, w: 94, h: 50 }, { x: 'max', y: null }, guides);
        expect(r.dx).toBeCloseTo(3); expect(r.dy).toBe(0); // right 97 -> 100; left 3 ignored
    });
    it('snaps the moving edge to the grid', () => {
        const r = snapResize(T(), { x: 0, y: 0, w: 47, h: 50 }, { x: 'max', y: null }, { grid: 10, guides: false, threshold: 6 });
        expect(r.dx).toBeCloseTo(3);
    });
});

describe('snapPoint', () => {
    it('snaps a point on both axes, or only the axes asked for', () => {
        const t = T(el('a', 100, 200, 50, 50));
        expect(snapPoint(t, { x: 98, y: 203 }, guides)).toMatchObject({ dx: 2, dy: -3 });
        expect(snapPoint(t, { x: 98, y: 203 }, guides, { x: false, y: true })).toMatchObject({ dx: 0, dy: -3 });
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `env -u DATABASE_URL TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/unit/snapping`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `services/snapping/types.ts`**

```ts
import type { Box } from '../geometry/elementBox';
export type { Box };

export interface Point { x: number; y: number }
export type Axis = 'x' | 'y';
export type EdgeSide = 'min' | 'max';
export interface ResizeEdges { x: EdgeSide | null; y: EdgeSide | null }
/** `threshold` is in page units (screen px / scale). `grid` null = grid snapping off. */
export interface SnapSettings { grid: number | null; guides: boolean; threshold: number }

export type Guide =
    | { kind: 'align'; axis: Axis; at: number; from: number; to: number }
    | { kind: 'distance'; axis: Axis; at: number; from: number; to: number }
    | { kind: 'spacing'; axis: Axis; gap: number; segments: { at: number; from: number; to: number }[] }
    | { kind: 'size'; axis: Axis; size: number; boxes: Box[] };

export interface SnapResult { dx: number; dy: number; snappedX: boolean; snappedY: boolean; guides: Guide[] }

export const lo = (b: Box, a: Axis) => a === 'x' ? b.x : b.y;
export const len = (b: Box, a: Axis) => a === 'x' ? b.w : b.h;
export const hi = (b: Box, a: Axis) => lo(b, a) + len(b, a);
export const other = (a: Axis): Axis => a === 'x' ? 'y' : 'x';
export const round2 = (v: number) => Math.round(v * 100) / 100;
```

- [ ] **Step 4: Implement `services/snapping/targets.ts`**

```ts
import type { AppNode, Layer, TemplateElement } from '../../types';
import { elementAabb } from '../geometry/elementBox';
import { type Axis, type Box, hi, len, lo, other, round2 } from './types';

export const MAX_SOURCES = 20;
export const NEIGHBOUR_SCAN = 64;
export const RANK_EDGE = 0, RANK_CENTRE = 1, RANK_PAGE = 2, RANK_SPACING = 3, RANK_SIZE = 4;

export interface AxisTargets { values: number[]; ranks: number[]; sources: Box[][] }
export interface SizeTargets { values: number[]; sources: Box[][] }
export interface GapTargets { values: number[]; pairs: [Box, Box][] }
export interface SnapTargets {
    page: Box;
    x: AxisTargets; y: AxisTargets;
    w: SizeTargets; h: SizeTargets;
    byLo: Record<Axis, Box[]>;
    byHi: Record<Axis, Box[]>;
    gaps: Record<Axis, GapTargets>;
}
export interface TargetInput {
    elements: TemplateElement[]; layers?: Layer[]; excludeIds: Iterable<string>;
    page: { w: number; h: number }; nodes: Record<string, AppNode>; currentNodeId: string;
}

type Entry = { v: number; rank: number; box: Box };
const merge = (entries: Entry[]): AxisTargets => {
    entries.sort((a, b) => a.v - b.v || a.rank - b.rank);
    const values: number[] = [], ranks: number[] = [], sources: Box[][] = [];
    for (const e of entries) {
        const v = round2(e.v), last = values.length - 1;
        if (last >= 0 && values[last] === v) {
            ranks[last] = Math.min(ranks[last], e.rank);
            if (sources[last].length < MAX_SOURCES) sources[last].push(e.box);
        } else { values.push(v); ranks.push(e.rank); sources.push([e.box]); }
    }
    return { values, ranks, sources };
};

const axisEntries = (boxes: Box[], page: Box, a: Axis): Entry[] => {
    const out: Entry[] = [];
    for (const b of boxes) {
        out.push({ v: lo(b, a), rank: RANK_EDGE, box: b });
        if (len(b, a) > 0) {
            out.push({ v: lo(b, a) + len(b, a) / 2, rank: RANK_CENTRE, box: b });
            out.push({ v: hi(b, a), rank: RANK_EDGE, box: b });
        }
    }
    for (const v of [0, len(page, a) / 2, len(page, a)]) out.push({ v, rank: RANK_PAGE, box: page });
    return out;
};

const sizes = (boxes: Box[], a: Axis): SizeTargets => {
    const m = merge(boxes.filter(b => len(b, a) > 0).map(b => ({ v: len(b, a), rank: 0, box: b })));
    return { values: m.values, sources: m.sources };
};

export const overlaps = (a: Box, b: Box, axis: Axis) => lo(a, axis) <= hi(b, axis) && lo(b, axis) <= hi(a, axis);

const lowerBound = (list: Box[], key: (b: Box) => number, v: number) => {
    let l = 0, h = list.length;
    while (l < h) { const m = (l + h) >> 1; if (key(list[m]) < v) l = m + 1; else h = m; }
    return l;
};

/** The nearest box starting at or after `from` along `axis` that overlaps `b` across it (bounded scan). */
export function nextNeighbour(T: Pick<SnapTargets, 'byLo'>, b: Box, axis: Axis, from = hi(b, axis)): Box | null {
    const list = T.byLo[axis], cross = other(axis);
    for (let i = lowerBound(list, x => lo(x, axis), from), n = 0; i < list.length && n < NEIGHBOUR_SCAN; i++, n++)
        if (list[i] !== b && overlaps(list[i], b, cross)) return list[i];
    return null;
}

/** The nearest box ending at or before `from` along `axis` that overlaps `b` across it (bounded scan). */
export function previousNeighbour(T: Pick<SnapTargets, 'byHi'>, b: Box, axis: Axis, from = lo(b, axis)): Box | null {
    const list = T.byHi[axis], cross = other(axis);
    for (let i = lowerBound(list, x => hi(x, axis), from + 1e-9) - 1, n = 0; i >= 0 && n < NEIGHBOUR_SCAN; i--, n++)
        if (list[i] !== b && overlaps(list[i], b, cross)) return list[i];
    return null;
}

const gapTargets = (T: Pick<SnapTargets, 'byLo'>, boxes: Box[], a: Axis): GapTargets => {
    const found: { v: number; pair: [Box, Box] }[] = [];
    for (const b of boxes) {
        const n = nextNeighbour(T, b, a);
        if (!n) continue;
        const g = round2(lo(n, a) - hi(b, a));
        if (g > 0) found.push({ v: g, pair: [b, n] });
    }
    found.sort((p, q) => p.v - q.v);
    const values: number[] = [], pairs: [Box, Box][] = [];
    for (const f of found) if (values[values.length - 1] !== f.v) { values.push(f.v); pairs.push(f.pair); }
    return { values, pairs };
};

/** Everything a gesture can snap to, built once when the gesture starts snapping. */
export function buildSnapTargets(input: TargetInput): SnapTargets {
    const hidden = new Set((input.layers ?? []).filter(l => l && l.visible === false).map(l => l.id));
    const exclude = new Set(input.excludeIds);
    const boxes = input.elements
        .filter(el => !exclude.has(el.id) && !(el.layerId && hidden.has(el.layerId)))
        .map(el => elementAabb(el, input.nodes, input.currentNodeId));
    const page: Box = { x: 0, y: 0, w: input.page.w, h: input.page.h };
    const sorted = (key: (b: Box) => number) => [...boxes].sort((p, q) => key(p) - key(q));
    const T: SnapTargets = {
        page,
        x: merge(axisEntries(boxes, page, 'x')), y: merge(axisEntries(boxes, page, 'y')),
        w: sizes(boxes, 'x'), h: sizes(boxes, 'y'),
        byLo: { x: sorted(b => b.x), y: sorted(b => b.y) },
        byHi: { x: sorted(b => b.x + b.w), y: sorted(b => b.y + b.h) },
        gaps: { x: { values: [], pairs: [] }, y: { values: [], pairs: [] } },
    };
    T.gaps.x = gapTargets(T, boxes, 'x');
    T.gaps.y = gapTargets(T, boxes, 'y');
    return T;
}
```

- [ ] **Step 5: Implement `services/snapping/core.ts`**

Shared by `snap.ts` and `extras.ts` (kept separate so the two never import each other).

```ts
import type { Box, Guide } from './types';

/** One candidate correction on one axis. `make` draws its guide once the final box is known. */
export interface Win { delta: number; rank: number; kind: 'align' | 'spacing' | 'size' | 'grid'; make?: (finalBox: Box) => Guide }

const lowerIndex = (values: number[], v: number) => {
    let l = 0, h = values.length;
    while (l < h) { const m = (l + h) >> 1; if (values[m] < v) l = m + 1; else h = m; }
    return l;
};

/** Index of the value closest to `v` (-1 when empty). */
export function nearestIndex(values: number[], v: number): number {
    if (values.length === 0) return -1;
    const l = lowerIndex(values, v);
    if (l === 0) return 0;
    if (l === values.length) return l - 1;
    return v - values[l - 1] <= values[l] - v ? l - 1 : l;
}

/** The indices on either side of `v` (one or two): both are candidates, so equal distances tie-break by rank. */
export function bracket(values: number[], v: number): number[] {
    const l = lowerIndex(values, v);
    return [l - 1, l].filter(i => i >= 0 && i < values.length);
}

/** Closer wins; at the same distance the lower rank (edge, centre, page, spacing, size) wins. */
export const better = (c: Win, best: Win | null) => !best
    || Math.abs(c.delta) < Math.abs(best.delta) - 1e-9
    || (Math.abs(Math.abs(c.delta) - Math.abs(best.delta)) <= 1e-9 && c.rank < best.rank);
```

- [ ] **Step 6: Implement `services/snapping/snap.ts`**

```ts
import { RANK_CENTRE, RANK_EDGE, type SnapTargets } from './targets';
import { type Axis, type Box, type EdgeSide, type Guide, type Point, type ResizeEdges, type SnapResult,
    type SnapSettings, hi, len, lo, other, round2 } from './types';
import { better, bracket, nearestIndex, type Win } from './core';
import { sizeWin, spacingWin } from './extras';

export type Mode = { kind: 'move' } | { kind: 'resize'; edge: EdgeSide } | { kind: 'point' };

export const gridLine = (v: number, g: number) => round2(Math.round(v / g) * g);

const features = (b: Box, a: Axis, mode: Mode) => {
    if (mode.kind === 'resize') return [{ v: mode.edge === 'min' ? lo(b, a) : hi(b, a), rank: RANK_EDGE }];
    if (mode.kind === 'point' || len(b, a) === 0) return [{ v: lo(b, a), rank: RANK_EDGE }];
    return [{ v: lo(b, a), rank: RANK_EDGE }, { v: lo(b, a) + len(b, a) / 2, rank: RANK_CENTRE }, { v: hi(b, a), rank: RANK_EDGE }];
};

function alignWin(T: SnapTargets, b: Box, a: Axis, mode: Mode, threshold: number): Win | null {
    const t = T[a];
    let best: Win | null = null;
    for (const f of features(b, a, mode)) {
        for (const i of bracket(t.values, f.v)) {
            const delta = t.values[i] - f.v;
            if (Math.abs(delta) > threshold) continue;
            const c: Win = { delta, rank: Math.max(t.ranks[i], f.rank), kind: 'align' };
            if (better(c, best)) best = c;
        }
    }
    return best;
}

const separation = (p: Box, q: Box, axis: Axis) => Math.max(0, lo(q, axis) - hi(p, axis), lo(p, axis) - hi(q, axis));

function alignGuides(T: SnapTargets, fb: Box, a: Axis, mode: Mode): Guide[] {
    const t = T[a], cross = other(a), out: Guide[] = [];
    let aligned = 0;
    for (const f of features(fb, a, mode)) {
        if (aligned >= 2) break;
        const i = nearestIndex(t.values, f.v);
        if (i < 0 || Math.abs(t.values[i] - f.v) > 0.01) continue;
        const at = t.values[i];
        if (out.some(g => g.kind === 'align' && g.at === at)) continue;
        let src = t.sources[i][0], gap = Infinity;
        for (const s of t.sources[i]) { const d = separation(fb, s, cross); if (d < gap) { gap = d; src = s; } }
        out.push({ kind: 'align', axis: a, at, from: Math.min(lo(fb, cross), lo(src, cross)), to: Math.max(hi(fb, cross), hi(src, cross)) });
        aligned++;
        if (src !== T.page && gap > 0 && !out.some(g => g.kind === 'distance')) {
            const below = lo(src, cross) >= hi(fb, cross);
            out.push({ kind: 'distance', axis: cross, at, from: below ? hi(fb, cross) : hi(src, cross), to: below ? lo(src, cross) : lo(fb, cross) });
        }
    }
    return out;
}

function resolveAxis(T: SnapTargets, b: Box, a: Axis, mode: Mode, s: SnapSettings): Win | null {
    let best: Win | null = null;
    if (s.guides) {
        const al = alignWin(T, b, a, mode, s.threshold);
        if (al && better(al, best)) best = al;
        if (mode.kind === 'move') { const sp = spacingWin(T, b, a, s.threshold); if (sp && better(sp, best)) best = sp; }
        if (mode.kind === 'resize') { const sz = sizeWin(T, b, a, mode.edge, s.threshold); if (sz && better(sz, best)) best = sz; }
    }
    if (!best && s.grid) {
        const f = features(b, a, mode)[0];
        best = { delta: gridLine(f.v, s.grid) - f.v, rank: 9, kind: 'grid' };
    }
    return best;
}

function finish(T: SnapTargets, b: Box, wx: Win | null, wy: Win | null, mx: Mode | null, my: Mode | null): SnapResult {
    const dx = wx?.delta ?? 0, dy = wy?.delta ?? 0;
    const fb: Box = { ...b, x: b.x + dx, y: b.y + dy };
    const guides: Guide[] = [];
    for (const [a, w, mode] of [['x', wx, mx], ['y', wy, my]] as const) {
        if (!w || !mode) continue;
        if (w.kind === 'align') guides.push(...alignGuides(T, fb, a, mode));
        else if (w.make) guides.push(w.make(fb));
    }
    return { dx, dy, snappedX: !!wx, snappedY: !!wy, guides };
}

const MOVE: Mode = { kind: 'move' };
const POINT: Mode = { kind: 'point' };

export function snapMove(T: SnapTargets, box: Box, s: SnapSettings): SnapResult {
    return finish(T, box, resolveAxis(T, box, 'x', MOVE, s), resolveAxis(T, box, 'y', MOVE, s), MOVE, MOVE);
}

export function snapResize(T: SnapTargets, box: Box, edges: ResizeEdges, s: SnapSettings): SnapResult {
    const mx: Mode | null = edges.x ? { kind: 'resize', edge: edges.x } : null;
    const my: Mode | null = edges.y ? { kind: 'resize', edge: edges.y } : null;
    return finish(T, box, mx && resolveAxis(T, box, 'x', mx, s), my && resolveAxis(T, box, 'y', my, s), mx, my);
}

export function snapPoint(T: SnapTargets, p: Point, s: SnapSettings, axes = { x: true, y: true }): SnapResult {
    const b: Box = { x: p.x, y: p.y, w: 0, h: 0 };
    return finish(T, b, axes.x ? resolveAxis(T, b, 'x', POINT, s) : null, axes.y ? resolveAxis(T, b, 'y', POINT, s) : null, POINT, POINT);
}
```

- [ ] **Step 7: Stub `services/snapping/extras.ts`** so this task compiles (Task 5 replaces it):

```ts
import type { SnapTargets } from './targets';
import type { Axis, Box, EdgeSide } from './types';
import type { Win } from './core';

export function spacingWin(_T: SnapTargets, _b: Box, _a: Axis, _threshold: number): Win | null { return null; }
export function sizeWin(_T: SnapTargets, _b: Box, _a: Axis, _edge: EdgeSide, _threshold: number): Win | null { return null; }
```

- [ ] **Step 8: Run tests**

Run: `env -u DATABASE_URL TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/unit/snapping && npx tsc --noEmit -p .`
Expected: PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
git add services/snapping tests/unit/snapping
git commit -m "feat(snapping): target index, edge/centre/page alignment and absolute grid

<trailer>"
```

---

### Task 5: Snapping engine — equal spacing, size matching, micro-benchmark

**Files:**
- Modify: `services/snapping/extras.ts` (replace the stub)
- Test: `tests/unit/snapping/extras.test.ts`, `tests/unit/snapping/performance.test.ts`

**Interfaces:**
- Consumes: `Win`, `better`, `nearestIndex` from `core.ts`; `nextNeighbour`, `previousNeighbour`, `RANK_SPACING`, `RANK_SIZE` from `targets.ts`.
- Produces: `spacingWin(T, b, a, threshold): Win | null`, `sizeWin(T, b, a, edge, threshold): Win | null` (signatures unchanged from the stub).

- [ ] **Step 1: Write the failing tests**

`tests/unit/snapping/extras.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildSnapTargets } from '../../../services/snapping/targets';
import { snapMove, snapResize } from '../../../services/snapping/snap';
import type { TemplateElement } from '../../../types';

const el = (id: string, x: number, y: number, w: number, h: number) =>
    ({ id, type: 'rect', x, y, w, h, rotation: 0, fill: '', stroke: '', strokeWidth: 0, opacity: 1 }) as TemplateElement;
const T = (...elements: TemplateElement[]) =>
    buildSnapTargets({ elements, excludeIds: [], page: { w: 1000, h: 1000 }, nodes: {}, currentNodeId: 'root' });
const s = { grid: null, guides: true, threshold: 6 };

describe('equal spacing', () => {
    it('centres a box between its two neighbours', () => {
        const r = snapMove(T(el('a', 0, 0, 100, 50), el('b', 300, 0, 100, 50)), { x: 173, y: 0, w: 50, h: 50 }, s);
        expect(r.dx).toBeCloseTo(2);
        const g = r.guides.find(g => g.kind === 'spacing')!;
        expect(g).toMatchObject({ axis: 'x', gap: 75 });
        expect(g.kind === 'spacing' && g.segments).toHaveLength(2);
    });
    it('repeats an existing gap after the last neighbour', () => {
        const r = snapMove(T(el('a', 0, 0, 100, 50), el('b', 130, 0, 100, 50)), { x: 262, y: 0, w: 50, h: 50 }, s);
        expect(r.dx).toBeCloseTo(-2);
        expect(r.guides.find(g => g.kind === 'spacing')).toMatchObject({ gap: 30 });
    });
    it('ignores neighbours that do not face the box', () => {
        const r = snapMove(T(el('a', 0, 0, 100, 50), el('b', 300, 400, 100, 50)), { x: 173, y: 0, w: 50, h: 50 }, s);
        expect(r.guides.some(g => g.kind === 'spacing')).toBe(false);
    });
});

describe('size matching', () => {
    it('snaps a resized width to another object\'s width', () => {
        const r = snapResize(T(el('a', 0, 300, 120, 40)), { x: 400, y: 10, w: 117, h: 50 }, { x: 'max', y: null }, s);
        expect(r.dx).toBeCloseTo(3);
        expect(r.guides.find(g => g.kind === 'size')).toMatchObject({ axis: 'x', size: 120 });
    });
    it('moves the left edge the other way when the left edge is being dragged', () => {
        const r = snapResize(T(el('a', 0, 300, 120, 40)), { x: 403, y: 10, w: 117, h: 50 }, { x: 'min', y: null }, s);
        expect(r.dx).toBeCloseTo(-3);
    });
    it('loses to an edge alignment that is closer', () => {
        const r = snapResize(T(el('a', 0, 300, 120, 40), el('e', 518, 0, 10, 10)), { x: 400, y: 10, w: 117, h: 50 }, { x: 'max', y: null }, s);
        expect(r.dx).toBeCloseTo(1); // right 517 -> 518 beats width 117 -> 120
    });
});
```

`tests/unit/snapping/performance.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildSnapTargets } from '../../../services/snapping/targets';
import { snapMove } from '../../../services/snapping/snap';
import type { TemplateElement } from '../../../types';

// CI guard against accidentally slow algorithms: generous limits, not the release budget
// (that is the Playwright benchmark, run on a throttled CPU).
describe('snapping engine speed', () => {
    it('builds 2,000 targets and answers 1,000 moves quickly', () => {
        let seed = 7; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        const elements = Array.from({ length: 2000 }, (_, i) => ({ id: `e${i}`, type: 'rect', x: Math.round(rand() * 2000),
            y: Math.round(rand() * 2800), w: 10 + Math.round(rand() * 80), h: 10 + Math.round(rand() * 40), rotation: 0,
            fill: '', stroke: '', strokeWidth: 0, opacity: 1 }) as TemplateElement);
        const t0 = performance.now();
        const T = buildSnapTargets({ elements, excludeIds: [], page: { w: 2000, h: 2800 }, nodes: {}, currentNodeId: 'root' });
        const built = performance.now() - t0;
        const t1 = performance.now();
        for (let i = 0; i < 1000; i++) snapMove(T, { x: i * 1.7, y: i * 2.3, w: 60, h: 30 }, { grid: 10, guides: true, threshold: 6 });
        const queried = performance.now() - t1;
        expect(built).toBeLessThan(200);
        expect(queried).toBeLessThan(300);
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `env -u DATABASE_URL TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/unit/snapping`
Expected: FAIL in `extras.test.ts` (no spacing/size guides); `performance.test.ts` may already pass.

- [ ] **Step 3: Implement `services/snapping/extras.ts`**

```ts
import { RANK_SIZE, RANK_SPACING, nextNeighbour, previousNeighbour, type SnapTargets } from './targets';
import { type Axis, type Box, type EdgeSide, type Guide, hi, len, lo, other } from './types';
import { better, nearestIndex, type Win } from './core';

const crossMid = (p: Box, q: Box, axis: Axis) => {
    const c = other(axis);
    return (Math.max(lo(p, c), lo(q, c)) + Math.min(hi(p, c), hi(q, c))) / 2;
};
const segment = (first: Box, second: Box, axis: Axis) => ({ at: crossMid(first, second, axis), from: hi(first, axis), to: lo(second, axis) });

/** Equal spacing for a moving box: centre it between its neighbours, or repeat a gap already on the page. */
export function spacingWin(T: SnapTargets, b: Box, a: Axis, threshold: number): Win | null {
    const prev = previousNeighbour(T, b, a, lo(b, a) + threshold);
    const next = nextNeighbour(T, b, a, hi(b, a) - threshold);
    let best: Win | null = null;
    const consider = (delta: number, make: (fb: Box) => Guide) => {
        if (Math.abs(delta) > threshold) return;
        const c: Win = { delta, rank: RANK_SPACING, kind: 'spacing', make };
        if (better(c, best)) best = c;
    };
    if (prev && next && prev !== next) {
        const target = (hi(prev, a) + lo(next, a) - len(b, a)) / 2;
        const gap = target - hi(prev, a);
        if (gap >= 0) consider(target - lo(b, a), fb => ({ kind: 'spacing', axis: a, gap,
            segments: [segment(prev, fb, a), segment(fb, next, a)] }));
    }
    const gaps = T.gaps[a];
    if (prev) {
        const current = lo(b, a) - hi(prev, a);
        const j = nearestIndex(gaps.values, current);
        if (j >= 0) {
            const g = gaps.values[j], [p0, p1] = gaps.pairs[j];
            consider(g - current, fb => ({ kind: 'spacing', axis: a, gap: g, segments: [segment(prev, fb, a), segment(p0, p1, a)] }));
        }
    }
    if (next) {
        const current = lo(next, a) - hi(b, a);
        const j = nearestIndex(gaps.values, current);
        if (j >= 0) {
            const g = gaps.values[j], [p0, p1] = gaps.pairs[j];
            consider(current - g, fb => ({ kind: 'spacing', axis: a, gap: g, segments: [segment(fb, next, a), segment(p0, p1, a)] }));
        }
    }
    return best;
}

/** Size matching for a resize: the dimension being dragged snaps to another object's width/height. */
export function sizeWin(T: SnapTargets, b: Box, a: Axis, edge: EdgeSide, threshold: number): Win | null {
    const sizes = a === 'x' ? T.w : T.h;
    const i = nearestIndex(sizes.values, len(b, a));
    if (i < 0) return null;
    const diff = sizes.values[i] - len(b, a);
    if (Math.abs(diff) > threshold) return null;
    const size = sizes.values[i];
    return { delta: edge === 'max' ? diff : -diff, rank: RANK_SIZE, kind: 'size',
        make: fb => ({ kind: 'size', axis: a, size, boxes: [fb, ...sizes.sources[i].slice(0, 3)] }) };
}
```

- [ ] **Step 4: Run tests**

Run: `env -u DATABASE_URL TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/unit/snapping && npx tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/snapping tests/unit/snapping
git commit -m "feat(snapping): equal spacing and size matching, with a speed guard

<trailer>"
```

---

### Task 6: Guide overlay

**Files:**
- Create: `components/canvas/SnapGuides.tsx`
- Test: `tests/unit/SnapGuides.test.tsx`

**Interfaces:**
- Consumes: `Guide` (Task 4).
- Produces: `SnapGuides` React component, props `{ guides: Guide[]; scale: number; touch: boolean; pointer: Point | null; width: number; height: number }`; renders `<svg data-testid="snap-guides">` with `line[data-guide-kind]` and `text[data-guide-label]`; renders nothing for an empty list. `formatGuideValue(n: number): string` exported.

- [ ] **Step 1: Write the failing tests**

```tsx
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SnapGuides, formatGuideValue } from '../../components/canvas/SnapGuides';
import type { Guide } from '../../services/snapping/types';

const renderGuides = (guides: Guide[], extra: Partial<React.ComponentProps<typeof SnapGuides>> = {}) =>
    render(<SnapGuides guides={guides} scale={1} touch={false} pointer={null} width={500} height={700} {...extra} />);

describe('SnapGuides', () => {
    it('renders nothing without guides', () => {
        expect(renderGuides([]).container.querySelector('[data-testid="snap-guides"]')).toBeNull();
    });
    it('draws an align line in page units', () => {
        const { container } = renderGuides([{ kind: 'align', axis: 'x', at: 100, from: 20, to: 300 }]);
        const line = container.querySelector('line[data-guide-kind="align"]')!;
        expect(line.getAttribute('x1')).toBe('100'); expect(line.getAttribute('y1')).toBe('20');
        expect(line.getAttribute('x2')).toBe('100'); expect(line.getAttribute('y2')).toBe('300');
    });
    it('keeps strokes one screen pixel wide at any zoom, 1.5 on touch', () => {
        const at2 = renderGuides([{ kind: 'align', axis: 'y', at: 50, from: 0, to: 100 }], { scale: 2 });
        expect(at2.container.querySelector('line')!.getAttribute('stroke-width')).toBe('0.5');
        const touch = renderGuides([{ kind: 'align', axis: 'y', at: 50, from: 0, to: 100 }], { scale: 1, touch: true });
        expect(touch.container.querySelector('line')!.getAttribute('stroke-width')).toBe('1.5');
    });
    it('labels distances, spacing gaps and matched sizes', () => {
        const { container } = renderGuides([
            { kind: 'distance', axis: 'y', at: 100, from: 150, to: 200 },
            { kind: 'spacing', axis: 'x', gap: 30, segments: [{ at: 25, from: 100, to: 130 }] },
            { kind: 'size', axis: 'x', size: 120, boxes: [{ x: 0, y: 300, w: 120, h: 40 }] },
        ]);
        const labels = [...container.querySelectorAll('[data-guide-label]')].map(n => n.textContent);
        expect(labels).toEqual(expect.arrayContaining(['50', '30', '= 120']));
    });
    it('formats whole points without decimals', () => {
        expect(formatGuideValue(12)).toBe('12'); expect(formatGuideValue(12.34)).toBe('12.3'); expect(formatGuideValue(11.96)).toBe('12');
    });
    it('moves a touch label away from the finger', () => {
        const guide: Guide = { kind: 'distance', axis: 'y', at: 100, from: 150, to: 200 };
        const free = renderGuides([guide], { touch: true });
        const near = renderGuides([guide], { touch: true, pointer: { x: 106, y: 175 } });
        const xOf = (c: HTMLElement) => Number(c.querySelector('[data-guide-label]')!.getAttribute('x'));
        expect(xOf(near.container)).toBeLessThan(xOf(free.container));
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `env -u DATABASE_URL TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/unit/SnapGuides.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `components/canvas/SnapGuides.tsx`**

```tsx
import React from 'react';
import type { Guide, Point } from '../../services/snapping/types';

const GUIDE_COLOR = '#f43f5e'; // rose-500: distinct from selection blue and the slate grid

export const formatGuideValue = (n: number) => {
    const r = Math.round(n * 10) / 10;
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

interface Props { guides: Guide[]; scale: number; touch: boolean; pointer: Point | null; width: number; height: number }

/**
 * Snap guides over the page, in page units inside the scaled layer. Stroke widths, label sizes and
 * offsets are divided by `scale` so they read the same at every zoom. On touch, a label that would
 * sit under the finger (44 screen px) moves to the other side of its segment.
 */
export const SnapGuides = React.memo(function SnapGuides({ guides, scale, touch, pointer, width, height }: Props) {
    if (guides.length === 0) return null;
    const sw = (touch ? 1.5 : 1) / scale;
    const font = 10 / scale, pad = 2 / scale, gapPx = 4 / scale, avoid = 44 / scale, tick = 3 / scale;

    const label = (key: string, x: number, y: number, text: string, side: 'h' | 'v') => {
        const w = text.length * font * 0.6 + pad * 2, h = font + pad * 2;
        // Candidate anchors: right of / below the point first, then left of / above it.
        const options = side === 'v'
            ? [{ x: x + gapPx, y: y - h / 2 }, { x: x - gapPx - w, y: y - h / 2 }]
            : [{ x: x - w / 2, y: y + gapPx }, { x: x - w / 2, y: y - gapPx - h }];
        const clear = (o: { x: number; y: number }) => !pointer || Math.hypot(o.x + w / 2 - pointer.x, o.y + h / 2 - pointer.y) > avoid;
        const at = options.find(clear) ?? options[options.length - 1];
        return (
            <g key={key}>
                <rect x={at.x} y={at.y} width={w} height={h} rx={pad} fill={GUIDE_COLOR} />
                <text data-guide-label x={at.x + pad} y={at.y + pad + font * 0.85} fontSize={font} fill="#fff"
                    fontFamily="ui-sans-serif, system-ui, sans-serif">{text}</text>
            </g>
        );
    };
    const line = (key: string, kind: string, x1: number, y1: number, x2: number, y2: number) => (
        <line key={key} data-guide-kind={kind} x1={x1} y1={y1} x2={x2} y2={y2} stroke={GUIDE_COLOR} strokeWidth={sw} />
    );
    // A measured segment with end ticks; `along` is the axis the segment runs on.
    const measured = (key: string, kind: string, along: 'x' | 'y', at: number, from: number, to: number, text: string) => {
        const mid = (from + to) / 2;
        return along === 'y'
            ? [line(`${key}l`, kind, at, from, at, to), line(`${key}a`, kind, at - tick, from, at + tick, from),
                line(`${key}b`, kind, at - tick, to, at + tick, to), label(`${key}t`, at, mid, text, 'v')]
            : [line(`${key}l`, kind, from, at, to, at), line(`${key}a`, kind, from, at - tick, from, at + tick),
                line(`${key}b`, kind, to, at - tick, to, at + tick), label(`${key}t`, mid, at, text, 'h')];
    };

    return (
        <svg data-testid="snap-guides" className="absolute left-0 top-0 overflow-visible" width={width} height={height}
            style={{ pointerEvents: 'none', zIndex: 10001 }}>
            {guides.flatMap((g, i) => {
                const k = `g${i}`;
                switch (g.kind) {
                    case 'align':
                        return [g.axis === 'x' ? line(k, 'align', g.at, g.from, g.at, g.to) : line(k, 'align', g.from, g.at, g.to, g.at)];
                    case 'distance':
                        return measured(k, 'distance', g.axis, g.at, g.from, g.to, formatGuideValue(g.to - g.from));
                    case 'spacing':
                        return g.segments.flatMap((s, j) => measured(`${k}s${j}`, 'spacing', g.axis, s.at, s.from, s.to, formatGuideValue(g.gap)));
                    case 'size':
                        return g.boxes.map((b, j) => g.axis === 'x'
                            ? label(`${k}b${j}`, b.x + b.w / 2, b.y - gapPx - font, `= ${formatGuideValue(g.size)}`, 'h')
                            : label(`${k}b${j}`, b.x + b.w, b.y + b.h / 2, `= ${formatGuideValue(g.size)}`, 'v'));
                }
            })}
        </svg>
    );
});
```

- [ ] **Step 4: Run tests**

Run: `env -u DATABASE_URL TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/unit/SnapGuides.test.tsx`
Expected: PASS. If the stroke-width attribute renders as `0.5` vs `"0.5"` differences, compare numerically.

- [ ] **Step 5: Commit**

```bash
git add components/canvas/SnapGuides.tsx tests/unit/SnapGuides.test.tsx
git commit -m "feat(canvas): snap guide overlay

<trailer>"
```

---

### Task 7: Canvas — move snapping, guide lifecycle, Alt, grid display

**Files:**
- Modify: `components/Canvas.tsx` (props ~:43-44 and :229-230; state near :272; `effectiveGridSize` :444-448; `snapVal` :517; `cancelInteraction` :580-588; legacy Escape :600-616; move branch :1164-1230; `handleMouseUp` top ~:1438; grid overlay :1936-1945; overlay children before `{renderCreationPreview()}` ~:2221)
- Modify: `components/ProjectEditor.tsx` (EditorCanvas props ~:1741)
- Test: `tests/unit/canvasSnapping.test.tsx`, `tests/unit/canvasTouch.test.tsx` (append)

**Interfaces:**
- Consumes: `buildSnapTargets`, `snapMove`, `SnapGuides`, `pullDistancePx`, `gridDisplayStep`, `snapSettingsOf`, `elementAabb`, `unionBox`, `round2`.
- Produces: Canvas props `gridSize?: number` (default 10) and `smartGuides?: boolean` (default **false** in the component; ProjectEditor passes the preference, default on). Internal helpers used by Task 8: `snapSettingsFor(e)`, `snapTargetsFor(excludeIds)`, `showGuides(guides)`, `endSnap()`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/canvasSnapping.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { renderCanvas, makeEl, makeLayer } from './canvasTestUtils';
import type { TemplateElement } from '../../types';

// jsdom: client px == page units * scale (bounding rect at 0,0). Template is 500 x 700.
const layers = [makeLayer('back', 0), makeLayer('front', 1)];
const lastMoved = (fn: any, id: string): TemplateElement => fn.mock.calls.at(-1)![0].find((e: TemplateElement) => e.id === id);
const guidesIn = (c: HTMLElement) => c.querySelector('[data-testid="snap-guides"]');
const press = (c: HTMLElement, id: string, x: number, y: number, extra = {}) =>
    fireEvent.mouseDown(c.querySelector(`[data-element-id="${id}"]`)!, { clientX: x, clientY: y, button: 0, ...extra });

// a: 100..200 x 0..100 (back). b: 300..400 x 300..400 (front), selected. Pressing b at (350, 350) and
// moving to clientX 153 puts b's left edge at 103: 3 from a's left edge, far from the page edges.
const scene = () => [makeEl('a', { layerId: 'back', x: 100 }), makeEl('b', { layerId: 'front', x: 300, y: 300 })];

describe('canvas move snapping', () => {
    it('pulls the dragged edge onto a nearby edge and shows the guide', () => {
        const { container, outer, onUpdateElements } = renderCanvas(scene(), layers, { selectedElementIds: ['b'], smartGuides: true });
        press(container, 'b', 350, 350);
        fireEvent.mouseMove(outer, { clientX: 153, clientY: 350 }); // b.x 103 -> 100
        expect(lastMoved(onUpdateElements, 'b').x).toBe(100);
        expect(guidesIn(container)?.querySelector('line[data-guide-kind="align"]')).toBeTruthy();
        fireEvent.mouseUp(outer, { clientX: 153, clientY: 350 });
        expect(guidesIn(container)).toBeNull();
    });
    it('does not snap with guides off (the component default)', () => {
        const { container, outer, onUpdateElements } = renderCanvas(scene(), layers, { selectedElementIds: ['b'] });
        press(container, 'b', 350, 350);
        fireEvent.mouseMove(outer, { clientX: 153, clientY: 350 });
        expect(lastMoved(onUpdateElements, 'b').x).toBe(103);
    });
    it('Alt held moves freely and hides guides', () => {
        const { container, outer, onUpdateElements } = renderCanvas(scene(), layers, { selectedElementIds: ['b'], smartGuides: true, snapToGrid: true });
        press(container, 'b', 350, 350);
        fireEvent.mouseMove(outer, { clientX: 153, clientY: 351, altKey: true });
        expect(lastMoved(onUpdateElements, 'b')).toMatchObject({ x: 103, y: 301 });
        expect(guidesIn(container)).toBeNull();
    });
    it('snaps the left edge to an absolute grid line', () => {
        const els = [makeEl('b', { layerId: 'front', x: 203, y: 300 })];
        const { container, outer, onUpdateElements } = renderCanvas(els, layers, { selectedElementIds: ['b'], snapToGrid: true, gridSize: 20 });
        press(container, 'b', 250, 350);
        fireEvent.mouseMove(outer, { clientX: 280, clientY: 350 }); // raw x 233 -> line 240 (rounding the delta gave 243)
        expect(lastMoved(onUpdateElements, 'b').x).toBe(240);
    });
    it('ignores objects on hidden layers but snaps to locked ones', () => {
        for (const [over, expected] of [[{ visible: false }, 103], [{ locked: true }, 100]] as const) {
            const ls = [makeLayer('back', 0, over), makeLayer('front', 1)];
            const { container, outer, onUpdateElements, unmount } = renderCanvas(scene(), ls, { selectedElementIds: ['b'], smartGuides: true });
            press(container, 'b', 350, 350);
            fireEvent.mouseMove(outer, { clientX: 153, clientY: 350 });
            expect(lastMoved(onUpdateElements, 'b').x).toBe(expected);
            unmount();
        }
    });
    it('a click builds no targets and shows no guides', () => {
        const { container, outer, onUpdateElements } = renderCanvas(scene(), layers, { selectedElementIds: ['b'], smartGuides: true });
        press(container, 'b', 350, 350);
        fireEvent.mouseMove(outer, { clientX: 352, clientY: 351 }); // inside the 5 pt drag threshold
        fireEvent.mouseUp(outer, { clientX: 352, clientY: 351 });
        expect(onUpdateElements).not.toHaveBeenCalled();
        expect(guidesIn(container)).toBeNull();
    });
    it('Escape clears guides', () => {
        const { container, outer } = renderCanvas(scene(), layers, { selectedElementIds: ['b'], smartGuides: true });
        press(container, 'b', 350, 350);
        fireEvent.mouseMove(outer, { clientX: 153, clientY: 350 });
        expect(guidesIn(container)).toBeTruthy();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(guidesIn(container)).toBeNull();
    });
    it('mouse leaving the canvas clears guides', () => {
        const { container, outer } = renderCanvas(scene(), layers, { selectedElementIds: ['b'], smartGuides: true });
        press(container, 'b', 350, 350);
        fireEvent.mouseMove(outer, { clientX: 153, clientY: 350 });
        fireEvent.mouseLeave(outer);
        expect(guidesIn(container)).toBeNull();
    });
    it('pull distance is 6 screen px at any zoom', () => {
        // scale 2: 6 px = 3 pt. b starts at page x 300; a's left edge is at 100.
        const run = (pageX: number) => {
            const { container, outer, onUpdateElements, unmount } = renderCanvas(scene(), layers, { selectedElementIds: ['b'], smartGuides: true, scale: 2 });
            press(container, 'b', 700, 700);
            fireEvent.mouseMove(outer, { clientX: 700 + (pageX - 300) * 2, clientY: 700 });
            const x = lastMoved(onUpdateElements, 'b').x; unmount(); return x;
        };
        expect(run(102.5)).toBe(100); // 2.5 pt = 5 px away: snaps
        expect(run(104)).toBe(104);   // 4 pt = 8 px away: free
    });
    it('snaps a multi-selection as one box', () => {
        const els = [...scene(), makeEl('c', { layerId: 'front', x: 420, y: 300, w: 50, h: 50 })];
        const { container, outer, onUpdateElements } = renderCanvas(els, layers, { selectedElementIds: ['b', 'c'], smartGuides: true });
        press(container, 'b', 350, 350);
        fireEvent.mouseMove(outer, { clientX: 153, clientY: 350 }); // union left 103 -> 100
        expect(lastMoved(onUpdateElements, 'b').x).toBe(100);
        expect(lastMoved(onUpdateElements, 'c').x).toBe(220);
    });
    it('a Ctrl-drag copy snaps to its original', () => {
        const els = [makeEl('a', { layerId: 'front', x: 0, y: 0 })];
        const { container, outer, onUpdateElements } = renderCanvas(els, layers, { smartGuides: true });
        press(container, 'a', 50, 50, { ctrlKey: true });
        fireEvent.mouseMove(outer, { clientX: 148, clientY: 50, ctrlKey: true }); // copy left 98 -> original right 100
        const moved: TemplateElement[] = onUpdateElements.mock.calls.at(-1)![0];
        expect(moved.find(e => e.id !== 'a')!.x).toBe(100);
        expect(moved.find(e => e.id === 'a')!.x).toBe(0);
    });
    it('draws the grid at the set size, thinned when zoomed out', () => {
        const near = renderCanvas([], layers, { showGrid: true, gridSize: 10, scale: 1 });
        expect(near.container.innerHTML).toContain('background-size: 10px 10px');
        near.unmount();
        const far = renderCanvas([], layers, { showGrid: true, gridSize: 10, scale: 0.5 });
        expect(far.container.innerHTML).toContain('background-size: 20px 20px');
    });
});
```

Append to `tests/unit/canvasTouch.test.tsx` (uses that file's `renderCanvas`, `pointer` and `rect` helpers; `a` is at 20,20 and `b` at 200,200, both 100x60):

```tsx
describe('touch snapping', () => {
    it('a finger drag snaps with the wider touch pull and a long press clears guides', () => {
        vi.useFakeTimers();
        const { container, surface, elementNode, props } = renderCanvas({ selectedElementIds: ['b'], smartGuides: true });
        pointer(elementNode('b'), 'pointerdown', 1, 250, 230);
        pointer(surface, 'pointermove', 1, 250 - 172, 230); // b.x 28: 8 pt from a's left edge (20), inside 10 px
        const moved = (props.onUpdateElements as any).mock.calls.at(-1)[0].find((e: any) => e.id === 'b');
        expect(moved.x).toBe(20);
        expect(container.querySelector('[data-testid="snap-guides"]')).toBeTruthy();
        act(() => { vi.advanceTimersByTime(600); }); // long press cancels the drag
        expect(container.querySelector('[data-testid="snap-guides"]')).toBeNull();
        vi.useRealTimers();
    });
});
```

If the long-press path does not fire while the finger has moved (the gesture hook only long-presses a still finger), replace the long-press half with `pointer(surface, 'pointercancel', 1, 78, 230)` and assert guides are cleared; report which path you used.

- [ ] **Step 2: Run to verify failure**

Run: `env -u DATABASE_URL TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/unit/canvasSnapping.test.tsx tests/unit/canvasTouch.test.tsx`
Expected: FAIL (unknown props have no effect; x values are raw; no guides).

- [ ] **Step 3: Props, state and helpers in `components/Canvas.tsx`**

Props interface (after `showGrid: boolean;`):

```ts
    /** Snap grid spacing in pt (default 10). */
    gridSize?: number;
    /** Snap to other objects and the page while moving, resizing and drawing (default off here; the editor passes the preference). */
    smartGuides?: boolean;
```

Destructure `gridSize = 10, smartGuides = false,` next to `snapToGrid, showGrid,`.

Imports:

```ts
import { buildSnapTargets, type SnapTargets } from '../services/snapping/targets';
import { snapMove, snapPoint, snapResize } from '../services/snapping/snap';
import { round2, type Box, type Guide, type Point, type SnapSettings } from '../services/snapping/types';
import { gridDisplayStep, pullDistancePx } from '../services/snapping/settings';
import { elementAabb, unionBox } from '../services/geometry/elementBox';
import { SnapGuides } from './canvas/SnapGuides';
```

Delete `effectiveGridSize` (:444-448) and `snapVal` (:517). Near the other refs (after `cloneDragRef`) add:

```ts
    // Snapping for the current gesture: targets are built once, on the first move that snaps (a
    // click never pays for them), and dropped when the gesture ends or is cancelled.
    const snapSessionRef = useRef<{ targets: SnapTargets; startBox: Box | null } | null>(null);
    const lastPointerRef = useRef<Point | null>(null);
    const [guides, setGuides] = useState<Guide[]>([]);
    const showGuides = (next: Guide[]) => setGuides(prev => (prev.length === 0 && next.length === 0 ? prev : next));
    const endSnap = () => { snapSessionRef.current = null; showGuides([]); };
    const snapSettingsFor = (e: { altKey?: boolean }): SnapSettings | null =>
        (snapToGrid || smartGuides) && !e.altKey
            ? { grid: snapToGrid ? gridSize : null, guides: smartGuides, threshold: pullDistancePx(inputMode) / scale }
            : null;
    const snapTargetsFor = (excludeIds: string[]) => {
        if (!snapSessionRef.current) snapSessionRef.current = {
            targets: buildSnapTargets({ elements, layers: template.layers, excludeIds,
                page: { w: template.width, h: template.height }, nodes, currentNodeId }),
            startBox: null,
        };
        return snapSessionRef.current;
    };
```

- [ ] **Step 4: Move branch**

In `handleMouseMove`, right after `const coords = getMouseCoords(e);` add `lastPointerRef.current = coords;`. In the `isDragging` branch replace

```ts
            const dx = snapToGrid ? Math.round(rawDx / effectiveGridSize) * effectiveGridSize : rawDx;
            const dy = snapToGrid ? Math.round(rawDy / effectiveGridSize) * effectiveGridSize : rawDy;

            const updatedElements = dragged.map(el => {
                if (startPositions[el.id]) {
                    return { ...el, x: startPositions[el.id].x + dx, y: startPositions[el.id].y + dy };
                }
                return el;
            });
```

with

```ts
            let dx = rawDx, dy = rawDy, snappedX = false, snappedY = false;
            const settings = snapSettingsFor(e);
            if (settings) {
                const session = snapTargetsFor(Object.keys(startPositions));
                session.startBox ??= unionBox(dragged.filter(el => startPositions[el.id])
                    .map(el => elementAabb({ ...el, ...startPositions[el.id] }, nodes, currentNodeId)));
                if (session.startBox) {
                    const r = snapMove(session.targets, { ...session.startBox, x: session.startBox.x + rawDx, y: session.startBox.y + rawDy }, settings);
                    dx += r.dx; dy += r.dy; snappedX = r.snappedX; snappedY = r.snappedY;
                    showGuides(r.guides);
                }
            } else showGuides([]);

            const updatedElements = dragged.map(el => {
                const start = startPositions[el.id];
                if (!start) return el;
                return { ...el, x: snappedX ? round2(start.x + dx) : start.x + dx, y: snappedY ? round2(start.y + dy) : start.y + dy };
            });
```

(The custom-pivot update below keeps using `dx`/`dy`.)

- [ ] **Step 5: End and cancel paths**

- `cancelInteraction`: append `endSnap();` to its last line.
- Legacy Escape branch (the `setNewShapeStart(null); ... setIsPanning(false);` list): add `endSnap();`.
- `handleMouseUp`: immediately after `const finishInteraction = ...;` add `endSnap();`.
- `onMouseLeave` already routes to `handleMouseUp` or `cancelInteraction`; confirm by reading :1902 and, if it calls neither, add `endSnap()` to its handler.

- [ ] **Step 6: Grid display and overlay**

Grid overlay (`backgroundOverlay`): replace `${effectiveGridSize}px ${effectiveGridSize}px` with

```ts
`${gridDisplayStep(gridSize, scale)}px ${gridDisplayStep(gridSize, scale)}px`
```

Overlay: immediately before `{renderCreationPreview()}` add

```tsx
                        <SnapGuides guides={guides} scale={scale} touch={isTouch}
                            pointer={isTouch ? lastPointerRef.current : null} width={template.width} height={template.height} />
```

Rotation's cardinal magnet (`if (snapToGrid) { const cardinals = ... }` at ~:1080, ~:1147, ~:1465) stays exactly as is.

In `components/ProjectEditor.tsx`, next to `snapToGrid={state.snapToGrid}` add

```tsx
            gridSize={snapSettingsOf(state).gridSize}
            smartGuides={snapSettingsOf(state).smartGuides}
```

and import `snapSettingsOf` from `../services/snapping/settings`.

- [ ] **Step 7: Run tests (targeted, then the whole unit suite)**

Run: `env -u DATABASE_URL TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/unit/canvasSnapping.test.tsx tests/unit/canvasTouch.test.tsx tests/unit/canvasClickVersusDrag.test.tsx tests/unit/canvasLayers.test.tsx`
Expected: PASS.

Then the full suite: `env -u DATABASE_URL TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run 2>&1 | grep -E 'FAIL|Test Files|Tests '`
Expected: only `tests/unit/onboarding/bundle.test.js` (stale until Task 14) and possibly the known `accountModeration` load flake (re-run that file alone to confirm). Any other failure that comes from a drag now snapping is Review Focus item 1: fix the test deliberately and list it in the report.

- [ ] **Step 8: Commit**

```bash
git add components/Canvas.tsx components/ProjectEditor.tsx tests/unit/canvasSnapping.test.tsx tests/unit/canvasTouch.test.tsx
git commit -m "feat(canvas): smart guides and absolute grid snapping while moving

<trailer>"
```

---

### Task 8: Canvas — resize, line ends and drawing

**Files:**
- Create: `services/snapping/resize.ts`
- Modify: `components/Canvas.tsx` (creation mousedown ~:725, creation mousemove ~:984, resize branch ~:1228-1430)
- Test: `tests/unit/snapping/resize.test.ts`, `tests/unit/canvasSnapping.test.tsx` (append)

**Interfaces:**
- Consumes: Task 7 helpers (`snapSettingsFor`, `snapTargetsFor`, `showGuides`), `snapResize`, `snapPoint`, `rotateVector`, `isRightAngle`, `round2`.
- Produces:
  - `computeResizedBox(start: { x: number; y: number; w: number; h: number; rotation?: number }, handle: string, localDx: number, localDy: number, minSize = 5): Box` — the existing Canvas math, unchanged in behaviour.
  - `worldEdgesForHandle(handle: string, deg: number): ResizeEdges`
  - `rightAngleAabb(box: Box, deg: number): Box` (rotation about the box centre, right angles only)

- [ ] **Step 1: Write the failing tests**

`tests/unit/snapping/resize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeResizedBox, rightAngleAabb, worldEdgesForHandle } from '../../../services/snapping/resize';

describe('resize geometry', () => {
    it('matches the canvas math for an unrotated east drag', () => {
        expect(computeResizedBox({ x: 10, y: 20, w: 100, h: 50 }, 'e', 7, 0)).toEqual({ x: 10, y: 20, w: 107, h: 50 });
    });
    it('keeps the minimum size when dragging west past the far edge', () => {
        const b = computeResizedBox({ x: 10, y: 20, w: 100, h: 50 }, 'w', 200, 0);
        expect(b.w).toBe(5); expect(b.x).toBeCloseTo(105);
    });
    it('maps handles to world edges through right-angle rotations', () => {
        expect(worldEdgesForHandle('e', 0)).toEqual({ x: 'max', y: null });
        expect(worldEdgesForHandle('e', 90)).toEqual({ x: null, y: 'max' });
        expect(worldEdgesForHandle('nw', 180)).toEqual({ x: 'max', y: 'max' });
        expect(worldEdgesForHandle('s', 270)).toEqual({ x: 'max', y: null });
    });
    it('swaps width and height for quarter turns about the centre', () => {
        expect(rightAngleAabb({ x: 200, y: 300, w: 100, h: 40 }, 90)).toEqual({ x: 230, y: 270, w: 40, h: 100 });
        expect(rightAngleAabb({ x: 200, y: 300, w: 100, h: 40 }, 180)).toEqual({ x: 200, y: 300, w: 100, h: 40 });
    });
});
```

Append to `tests/unit/canvasSnapping.test.tsx`:

```tsx
describe('canvas resize, line and drawing snapping', () => {
    const handle = (c: HTMLElement, h: string) => c.querySelector(`[data-resize-handle="${h}"]`)!;
    it('snaps a dragged edge to a nearby edge', () => {
        const els = [makeEl('a', { layerId: 'back', x: 205, y: 0, w: 100, h: 50 }), makeEl('b', { layerId: 'front', x: 200, y: 300 })];
        const { container, outer, onUpdateElements } = renderCanvas(els, layers, { selectedElementIds: ['b'], smartGuides: true });
        fireEvent.mouseDown(handle(container, 'e'), { clientX: 300, clientY: 350, button: 0 });
        fireEvent.mouseMove(outer, { clientX: 303, clientY: 350 }); // right 303 -> 305
        expect(lastMoved(onUpdateElements, 'b')).toMatchObject({ x: 200, w: 105 });
    });
    it('matches another object\'s width', () => {
        const els = [makeEl('a', { layerId: 'back', x: 0, y: 500, w: 120, h: 40 }), makeEl('b', { layerId: 'front', x: 200, y: 300 })];
        const { container, outer, onUpdateElements } = renderCanvas(els, layers, { selectedElementIds: ['b'], smartGuides: true });
        fireEvent.mouseDown(handle(container, 'e'), { clientX: 300, clientY: 350, button: 0 });
        fireEvent.mouseMove(outer, { clientX: 317, clientY: 350 });
        expect(lastMoved(onUpdateElements, 'b').w).toBe(120);
        expect(container.querySelector('[data-guide-label]')?.textContent).toBe('= 120');
    });
    it('snaps a quarter-turned element through its rotated edges', () => {
        // b: 100x40 rotated 90 -> world box x 230..270, y 270..370. a's top edge at y=375.
        const els = [makeEl('a', { layerId: 'back', x: 0, y: 375, w: 50, h: 50 }),
            makeEl('b', { layerId: 'front', x: 200, y: 300, w: 100, h: 40, rotation: 90 })];
        const { container, outer, onUpdateElements } = renderCanvas(els, layers, { selectedElementIds: ['b'], smartGuides: true });
        fireEvent.mouseDown(handle(container, 'e'), { clientX: 250, clientY: 370, button: 0 });
        fireEvent.mouseMove(outer, { clientX: 250, clientY: 373 }); // local width 103 -> 105
        expect(lastMoved(onUpdateElements, 'b').w).toBeCloseTo(105);
    });
    it('leaves other rotations to the old grid behaviour, with no guides', () => {
        const els = [makeEl('a', { layerId: 'back', x: 205, y: 0, w: 100, h: 50 }), makeEl('b', { layerId: 'front', x: 200, y: 300, rotation: 30 })];
        const { container, outer, onUpdateElements } = renderCanvas(els, layers, { selectedElementIds: ['b'], smartGuides: true });
        fireEvent.mouseDown(handle(container, 'e'), { clientX: 300, clientY: 350, button: 0 });
        fireEvent.mouseMove(outer, { clientX: 303, clientY: 350 });
        expect(container.querySelector('[data-testid="snap-guides"]')).toBeNull();
    });
    it('snaps a dragged line end as a point', () => {
        const els = [makeEl('a', { layerId: 'back', x: 305, y: 0, w: 50, h: 50 }),
            makeEl('l', { layerId: 'front', type: 'line', x: 100, y: 200, w: 100, h: 0 })];
        const { container, outer, onUpdateElements } = renderCanvas(els, layers, { selectedElementIds: ['l'], smartGuides: true });
        fireEvent.mouseDown(handle(container, 'end'), { clientX: 200, clientY: 200, button: 0 });
        fireEvent.mouseMove(outer, { clientX: 302, clientY: 200 }); // end x 302 -> 305
        const line = lastMoved(onUpdateElements, 'l');
        expect(line.x + line.w).toBeCloseTo(305);
    });
    it('snaps a new shape\'s corners while drawing', () => {
        const els = [makeEl('a', { layerId: 'back', x: 100, y: 100, w: 100, h: 100 })];
        const { container, outer, onUpdateElements } = renderCanvas(els, layers, { tool: 'rect', smartGuides: true });
        fireEvent.mouseDown(outer, { clientX: 103, clientY: 300, button: 0 });
        fireEvent.mouseMove(outer, { clientX: 198, clientY: 400 });
        fireEvent.mouseUp(outer, { clientX: 198, clientY: 400 });
        const created = (onUpdateElements.mock.calls.at(-1)![0] as TemplateElement[]).find(e => e.id !== 'a')!;
        expect(created).toMatchObject({ x: 100, w: 100 });
    });
});
```

The line end handle name comes from `SelectionHandles` (`data-resize-handle="start"|"end"` per Canvas :1260); if the line handle is rendered with a different attribute, use the attribute `SelectionHandles.tsx` renders for line ends.

- [ ] **Step 2: Run to verify failure**

Run: `env -u DATABASE_URL TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/unit/snapping/resize.test.ts tests/unit/canvasSnapping.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `services/snapping/resize.ts`**

Move the "Standard / Group Resizing" math from Canvas (:1307-1351, from `let newW = startW;` to `const finalY = ...`) into:

```ts
import { rotateVector, type Box } from '../geometry/elementBox';
import type { ResizeEdges } from './types';

/** The resized box for a handle drag of (localDx, localDy) in the element's own axes (Canvas's math). */
export function computeResizedBox(start: { x: number; y: number; w: number; h: number; rotation?: number }, handle: string,
    localDx: number, localDy: number, minSize = 5): Box {
    const { x: startX, y: startY, w: startW, h: startH } = start;
    const angle = start.rotation || 0;
    let newW = startW, newH = startH, deltaXLocal = 0, deltaYLocal = 0;
    if (handle.includes('e')) newW = Math.max(minSize, startW + localDx);
    if (handle.includes('w')) { newW = Math.max(minSize, startW - localDx); deltaXLocal = startW - newW; }
    if (handle.includes('s')) newH = Math.max(minSize, startH + localDy);
    if (handle.includes('n')) { newH = Math.max(minSize, startH - localDy); deltaYLocal = startH - newH; }
    const mid = rotateVector((deltaXLocal + newW / 2) - startW / 2, (deltaYLocal + newH / 2) - startH / 2, angle);
    const cx = startX + startW / 2 + mid.x, cy = startY + startH / 2 + mid.y;
    return { x: cx - newW / 2, y: cy - newH / 2, w: newW, h: newH };
}

/** Which world edges a handle drags once the element is turned by a right angle. */
export function worldEdgesForHandle(handle: string, deg: number): ResizeEdges {
    const edges: ResizeEdges = { x: null, y: null };
    const dirs: Record<string, [number, number]> = { e: [1, 0], w: [-1, 0], s: [0, 1], n: [0, -1] };
    for (const letter of handle) {
        const d = dirs[letter]; if (!d) continue;
        const v = rotateVector(d[0], d[1], deg);
        const rx = Math.round(v.x), ry = Math.round(v.y);
        if (rx) edges.x = rx > 0 ? 'max' : 'min';
        if (ry) edges.y = ry > 0 ? 'max' : 'min';
    }
    return edges;
}

/** The world box of a box turned by a right angle about its centre. */
export function rightAngleAabb(b: Box, deg: number): Box {
    const quarter = Math.round((((deg % 360) + 360) % 360) / 90) % 2 === 1;
    if (!quarter) return { ...b };
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    return { x: cx - b.h / 2, y: cy - b.w / 2, w: b.h, h: b.w };
}
```

- [ ] **Step 4: Resize branch in Canvas**

In the resize branch:

1. Replace the "3. Apply Snap to local dimensions if enabled" block with:

```ts
            const settings = snapSettingsFor(e);
            const elementForResize = isGroup ? null : elements.find(item => item.id === selectedElementIds[0]);
            const guidesFit = isRightAngle(angle) && (isGroup || !elementForResize?.transformOrigin
                || (elementForResize.transformOrigin.x === 0.5 && elementForResize.transformOrigin.y === 0.5));
            // Off a right angle the edges are not horizontal/vertical: keep the local-axis grid rounding.
            if (settings && settings.grid && !guidesFit) {
                localDx = Math.round(localDx / settings.grid) * settings.grid;
                localDy = Math.round(localDy / settings.grid) * settings.grid;
            }
```

2. In the line-endpoint branch, replace the snapped-delta lines and the "Apply Delta" block with:

```ts
                const moving = resizeHandle === 'start' ? pStart : pEnd;
                moving.x += screenDx; moving.y += screenDy;
                if (settings) {
                    const r = snapPoint(snapTargetsFor(selectedElementIds).targets, moving, settings);
                    if (r.snappedX) moving.x = round2(moving.x + r.dx);
                    if (r.snappedY) moving.y = round2(moving.y + r.dy);
                    showGuides(r.guides);
                } else showGuides([]);
```

3. Replace everything from `let newW = startW;` through `const finalY = newCenterWorldY - newH / 2;` with:

```ts
            const startBox = { x: startX, y: startY, w: startW, h: startH, rotation: angle };
            let resized = computeResizedBox(startBox, resizeHandle, localDx, localDy);
            if (settings && guidesFit) {
                const r = snapResize(snapTargetsFor(selectedElementIds).targets, rightAngleAabb(resized, angle),
                    worldEdgesForHandle(resizeHandle, angle), settings);
                const local = rotateVector(r.dx, r.dy, -angle);
                resized = computeResizedBox(startBox, resizeHandle, localDx + local.x, localDy + local.y);
                if (r.snappedX || r.snappedY) resized = { x: round2(resized.x), y: round2(resized.y), w: round2(resized.w), h: round2(resized.h) };
                showGuides(r.guides);
            } else showGuides([]);
            const { x: finalX, y: finalY, w: newW, h: newH } = resized;
```

Add imports `computeResizedBox, rightAngleAabb, worldEdgesForHandle` from `../services/snapping/resize` and `rotateVector, isRightAngle` from `../services/geometry/elementBox`. The group and single-element update code below keeps using `finalX/finalY/newW/newH` unchanged.

- [ ] **Step 5: Creation**

At creation mousedown (~:725) replace `const snappedCoords = { x: snapVal(coords.x), y: snapVal(coords.y) };` with:

```ts
            // A press with a drawing tool always starts a shape, so its targets are built now.
            const settings = snapSettingsFor(e);
            let snappedCoords = coords;
            if (settings) {
                const r = snapPoint(snapTargetsFor([]).targets, coords, settings);
                snappedCoords = { x: r.snappedX ? round2(coords.x + r.dx) : coords.x, y: r.snappedY ? round2(coords.y + r.dy) : coords.y };
                showGuides(r.guides);
            }
```

At creation mousemove (~:984) replace `setNewShapeCurrent({ x: snapVal(coords.x), y: snapVal(coords.y) });` with:

```ts
            const settings = snapSettingsFor(e);
            let current = coords;
            if (settings) {
                const constrained = e.ctrlKey || e.metaKey || e.shiftKey;
                // Square/45° constraint: snap the dominant axis only; the constraint derives the other.
                const axes = constrained
                    ? (Math.abs(coords.x - newShapeStart.x) >= Math.abs(coords.y - newShapeStart.y) ? { x: true, y: false } : { x: false, y: true })
                    : undefined;
                const r = snapPoint(snapTargetsFor([]).targets, coords, settings, axes);
                current = { x: r.snappedX ? round2(coords.x + r.dx) : coords.x, y: r.snappedY ? round2(coords.y + r.dy) : coords.y };
                showGuides(r.guides);
            } else showGuides([]);
            setNewShapeCurrent(current);
```

`handleMouseUp` already calls `endSnap()` (Task 7).

- [ ] **Step 6: Run tests**

Run: `env -u DATABASE_URL TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/unit/snapping tests/unit/canvasSnapping.test.tsx tests/unit/canvasTouch.test.tsx tests/unit/canvas* && npx tsc --noEmit -p .`
Expected: PASS. Existing resize tests must pass unchanged — `computeResizedBox` is the same math; if one differs, the extraction changed behaviour: fix the function, not the test.

- [ ] **Step 7: Commit**

```bash
git add services/snapping/resize.ts components/Canvas.tsx tests/unit/snapping/resize.test.ts tests/unit/canvasSnapping.test.tsx
git commit -m "feat(canvas): snapping for resize, line ends and drawing

<trailer>"
```

---

### Task 9: Arrow nudge on the grid

**Files:**
- Create: `services/snapping/nudge.ts`
- Modify: `components/ProjectEditor.tsx` (legacy keydown ~:235-255, incremental keydown ~:1542-1547)
- Test: `tests/unit/snapping/nudge.test.ts`, `tests/unit/ProjectEditor.incrementalChanges.test.tsx` (~:1000-1002)

**Interfaces:**
- Consumes: `elementAabb`, `unionBox`, `snapSettingsOf`.
- Produces: `nudgeDelta(key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown', shift: boolean, start: number, grid: number | null): number` — `start` is the selection box's left (horizontal keys) or top (vertical keys).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { nudgeDelta } from '../../../services/snapping/nudge';

describe('nudgeDelta', () => {
    it('moves 1 pt, or 10 with Shift, when snap is off', () => {
        expect(nudgeDelta('ArrowRight', false, 44, null)).toBe(1);
        expect(nudgeDelta('ArrowUp', true, 44, null)).toBe(-10);
    });
    it('moves to the next grid line with snap on', () => {
        expect(nudgeDelta('ArrowDown', false, 44, 10)).toBe(6);
        expect(nudgeDelta('ArrowDown', false, 40, 10)).toBe(10);
        expect(nudgeDelta('ArrowLeft', false, 44, 10)).toBe(-4);
        expect(nudgeDelta('ArrowLeft', false, 40, 10)).toBe(-10);
    });
    it('moves ten grid steps with Shift', () => {
        expect(nudgeDelta('ArrowRight', true, 44, 10)).toBe(96); // next line 50, then 9 more steps
    });
    it('copes with fractional grids', () => {
        expect(nudgeDelta('ArrowRight', false, 1.2, 0.5)).toBe(0.3);
    });
});
```

In `tests/unit/ProjectEditor.incrementalChanges.test.tsx` (~:1001), the nudge from y=44 with snap on now lands on the next grid line: change `.toBe(54)` to `.toBe(snap ? 50 : 54)`.

- [ ] **Step 2: Run to verify failure**

Run: `env -u DATABASE_URL TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/unit/snapping/nudge.test.ts tests/unit/ProjectEditor.incrementalChanges.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `services/snapping/nudge.ts`**

```ts
import { round2 } from './types';

/**
 * How far an arrow key moves the selection. Snap off: 1 pt, Shift 10 pt. Snap on: to the next grid
 * line in that direction (one full step when already on a line), Shift for ten steps.
 */
export function nudgeDelta(key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown', shift: boolean, start: number, grid: number | null): number {
    const dir = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
    if (!grid) return dir * (shift ? 10 : 1);
    const eps = 1e-6;
    const first = dir > 0 ? (Math.floor(start / grid + eps) + 1) * grid : (Math.ceil(start / grid - eps) - 1) * grid;
    return round2(first - start + dir * ((shift ? 10 : 1) - 1) * grid);
}
```

- [ ] **Step 4: Wire both editors**

Legacy (~:238-252): replace the `delta`/`dx`/`dy` lines with

```ts
                    const template = getCurrentTemplate();
                    const selected = template?.elements.filter(el => state.selectedElementIds.includes(el.id)) ?? [];
                    const box = unionBox(selected.map(el => elementAabb(el, state.nodes, state.selectedNodeId)));
                    const horizontal = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
                    const snapping = snapSettingsOf(state);
                    const delta = box ? nudgeDelta(e.key as 'ArrowLeft', e.shiftKey, horizontal ? box.x : box.y, snapping.snapToGrid ? snapping.gridSize : null) : 0;
                    const dx = horizontal ? delta : 0;
                    const dy = horizontal ? 0 : delta;
```

and keep the existing `if (template) { ... }` update (drop its now-duplicate `const template = getCurrentTemplate();`).

Incremental (~:1542): replace `const delta = event.shiftKey || current.snapToGrid ? 10 : 1;` and the `dx`/`dy` lines with

```ts
                const template = editor.getCurrent().document.variants[current.activeVariantId]?.templates[templateIdFor(current)];
                const box = unionBox((template?.elements ?? []).filter(element => current.selectedElementIds.includes(element.id))
                    .map(element => elementAabb(element, current.nodes, current.selectedNodeId)));
                const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
                const snapping = snapSettingsOf(current);
                const delta = box ? nudgeDelta(event.key as 'ArrowLeft', event.shiftKey, horizontal ? box.x : box.y, snapping.snapToGrid ? snapping.gridSize : null) : 0;
                const dx = horizontal ? delta : 0, dy = horizontal ? 0 : delta;
```

Imports: `nudgeDelta` from `../services/snapping/nudge`, `unionBox` from `../services/geometry/elementBox`.

- [ ] **Step 5: Run tests**

Run: `env -u DATABASE_URL TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/unit/snapping tests/unit/ProjectEditor*.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/snapping/nudge.ts components/ProjectEditor.tsx tests/unit/snapping/nudge.test.ts tests/unit/ProjectEditor.incrementalChanges.test.tsx
git commit -m "feat(editor): arrow keys nudge onto the grid when snapping

<trailer>"
```

---

### Task 10: Desktop Snapping popover

**Files:**
- Create: `components/SnappingPopover.tsx`
- Modify: `components/EditorToolbar.tsx:153-156`
- Test: `tests/unit/editorToolbarSnapping.test.tsx`, `tests/unit/ProjectEditor.incrementalChanges.test.tsx` (append)

**Interfaces:**
- Consumes: `snapSettingsOf`, `parseGridSize`, `GRID_QUICK_PICKS`, `EditorScalarPreferencePatch`.
- Produces: `SnappingPopover` props `{ snapToGrid: boolean; smartGuides: boolean; showGrid: boolean; gridSize: number; onChange: (patch: EditorScalarPreferencePatch) => void }`; toolbar button `title="Snapping options"`; dialog `role="dialog" aria-label="Snapping"`; switches `role="switch"` named "Snap to grid", "Smart guides", "Show grid"; input `aria-label="Grid size (pt)"`; quick picks named "2 pt", "5 pt", "10 pt", "20 pt".

- [ ] **Step 1: Write the failing tests**

`tests/unit/editorToolbarSnapping.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { EditorToolbar } from '../../components/EditorToolbar';
import { AppState } from '../../types';

const state = {
    tool: 'select', selectedElementIds: [], selectedTemplateId: 'tpl1', activeVariantId: 'v1',
    variants: { v1: { id: 'v1', name: 'V', templates: {} } }, viewMode: 'templates', templatePreviewNodeId: null,
    selectedNodeId: 'root', nodes: {}, rootId: 'root', snapToGrid: false, showGrid: false, scale: 1,
} as unknown as AppState;
const renderToolbar = (overrides: Partial<AppState> = {}) => {
    const onPreferencesChange = vi.fn();
    const actions = { onToolChange: vi.fn(), onPreferencesChange, onAlign: vi.fn() } as any;
    render(<EditorToolbar state={{ ...state, ...overrides }} actions={actions} onImportSvg={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Snapping options'));
    return onPreferencesChange;
};

describe('Snapping popover', () => {
    it('shows the defaults for a project without stored values', () => {
        renderToolbar();
        expect(screen.getByRole('switch', { name: 'Smart guides' })).toBeChecked();
        expect(screen.getByLabelText('Grid size (pt)')).toHaveValue(10);
        expect(screen.getByText(/to move without snapping/)).toBeTruthy();
    });
    it('turning snap on also shows the grid', () => {
        const change = renderToolbar();
        fireEvent.click(screen.getByRole('switch', { name: 'Snap to grid' }));
        expect(change).toHaveBeenLastCalledWith({ snapToGrid: true, showGrid: true });
    });
    it('toggles smart guides', () => {
        const change = renderToolbar();
        fireEvent.click(screen.getByRole('switch', { name: 'Smart guides' }));
        expect(change).toHaveBeenLastCalledWith({ smartGuides: false });
    });
    it('commits a typed size on Enter, clamped, and reverts text that is not a number', () => {
        const change = renderToolbar();
        const input = screen.getByLabelText('Grid size (pt)');
        fireEvent.change(input, { target: { value: '450' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(change).toHaveBeenLastCalledWith({ gridSize: 200 });
        change.mockClear();
        fireEvent.change(input, { target: { value: '' } });
        fireEvent.blur(input);
        expect(change).not.toHaveBeenCalled();
        expect(input).toHaveValue(10);
    });
    it('quick picks set the size', () => {
        const change = renderToolbar();
        fireEvent.click(screen.getByRole('button', { name: '20 pt' }));
        expect(change).toHaveBeenLastCalledWith({ gridSize: 20 });
    });
    it('closes on Escape and outside click', () => {
        renderToolbar();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('dialog', { name: 'Snapping' })).toBeNull();
        fireEvent.click(screen.getByTitle('Snapping options'));
        fireEvent.mouseDown(document.body);
        expect(screen.queryByRole('dialog', { name: 'Snapping' })).toBeNull();
    });
});
```

Append to `tests/unit/ProjectEditor.incrementalChanges.test.tsx` (inside the G2 describe, using `renderIncrementalEditor`):

```tsx
  it('G2 routes the snapping options to the preferences lane', () => {
    const h = renderIncrementalEditor();
    fireEvent.click(screen.getByTitle('Snapping options'));
    fireEvent.click(screen.getByRole('button', { name: '5 pt' }));
    expect(h.onPreferencesChange).toHaveBeenLastCalledWith({ gridSize: 5 }, expect.any(Object));
    fireEvent.click(screen.getByRole('switch', { name: 'Smart guides' }));
    expect(h.onPreferencesChange).toHaveBeenLastCalledWith({ smartGuides: false }, expect.any(Object));
    expect(h.onDocumentEdit).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `env -u DATABASE_URL TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/unit/editorToolbarSnapping.test.tsx`
Expected: FAIL — no "Snapping options" button.

- [ ] **Step 3: Implement `components/SnappingPopover.tsx`**

```tsx
import React, { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { ChevronDown } from 'lucide-react';
import type { EditorScalarPreferencePatch } from '../services/document/contracts';
import { GRID_QUICK_PICKS, parseGridSize } from '../services/snapping/settings';
import { formatGuideValue } from './canvas/SnapGuides';

interface Props { snapToGrid: boolean; smartGuides: boolean; showGrid: boolean; gridSize: number; onChange: (patch: EditorScalarPreferencePatch) => void }

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

const Switch = ({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) => (
    <button type="button" role="switch" aria-checked={checked} onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
        <span>{label}</span>
        <span aria-hidden="true" className={clsx('relative h-4 w-7 rounded-full transition-colors', checked ? 'bg-blue-600' : 'bg-slate-300')}>
            <span className={clsx('absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all', checked ? 'left-3.5' : 'left-0.5')} />
        </span>
    </button>
);

/** The chevron beside the magnet: snapping switches and the grid size, saved per project. */
export const SnappingPopover: React.FC<Props> = ({ snapToGrid, smartGuides, showGrid, gridSize, onChange }) => {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState(String(gridSize));
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => { setDraft(String(gridSize)); }, [gridSize]);
    useEffect(() => {
        if (!open) return;
        const outside = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
        const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', outside); document.addEventListener('keydown', escape);
        return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape); };
    }, [open]);
    const commit = () => {
        const parsed = parseGridSize(draft);
        if (parsed === null) { setDraft(String(gridSize)); return; }
        setDraft(String(parsed));
        if (parsed !== gridSize) onChange({ gridSize: parsed });
    };
    return (
        <div className="relative" ref={ref}>
            <button type="button" title="Snapping options" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(o => !o)}
                className={clsx('p-1.5 rounded transition-all', open ? 'bg-slate-100 text-slate-700' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100')}>
                <ChevronDown size={10} />
            </button>
            {open && (
                <div role="dialog" aria-label="Snapping" className="absolute right-0 top-full z-30 mt-1 w-56 rounded border border-slate-200 bg-white py-1 shadow-lg">
                    <Switch label="Snap to grid" checked={snapToGrid}
                        onToggle={() => onChange(snapToGrid ? { snapToGrid: false } : { snapToGrid: true, showGrid: true })} />
                    <Switch label="Smart guides" checked={smartGuides} onToggle={() => onChange({ smartGuides: !smartGuides })} />
                    <Switch label="Show grid" checked={showGrid} onToggle={() => onChange({ showGrid: !showGrid })} />
                    <div className="border-t border-slate-100 px-3 pb-2 pt-2">
                        <label className="flex items-center justify-between gap-2 text-xs text-slate-700">
                            <span>Grid size</span>
                            <span className="flex items-center gap-1">
                                <input type="number" aria-label="Grid size (pt)" min={1} max={200} step={0.5} value={draft}
                                    onChange={e => setDraft(e.target.value)} onBlur={commit}
                                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
                                    className="w-16 rounded border border-slate-200 px-1 py-0.5 text-right" />
                                <span className="text-slate-400">pt</span>
                            </span>
                        </label>
                        <div className="mt-2 flex gap-1">
                            {GRID_QUICK_PICKS.map(size => (
                                <button key={size} type="button" aria-pressed={gridSize === size} onClick={() => onChange({ gridSize: size })}
                                    className={clsx('flex-1 rounded border px-1 py-0.5 text-[11px]', gridSize === size ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}>
                                    {formatGuideValue(size)} pt
                                </button>
                            ))}
                        </div>
                        <p className="mt-2 text-[11px] text-slate-400">Hold {isMac ? '⌥ Option' : 'Alt'} to move without snapping</p>
                    </div>
                </div>
            )}
        </div>
    );
};
```

- [ ] **Step 4: Put it in the toolbar**

In `components/EditorToolbar.tsx`, inside the magnet/grid group (:153-156), after the Show Grid `ToolButton`:

```tsx
                <SnappingPopover {...snapSettingsOf(state)} onChange={preferences} />
```

Imports: `SnappingPopover` from `./SnappingPopover`, `snapSettingsOf` from `../services/snapping/settings`.

- [ ] **Step 5: Run tests**

Run: `env -u DATABASE_URL TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/unit/editorToolbarSnapping.test.tsx tests/unit/editorToolbarSvgDropdown.test.tsx tests/unit/ProjectEditor.incrementalChanges.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/SnappingPopover.tsx components/EditorToolbar.tsx tests/unit/editorToolbarSnapping.test.tsx tests/unit/ProjectEditor.incrementalChanges.test.tsx
git commit -m "feat(toolbar): snapping options with smart guides and grid size

<trailer>"
```

---

### Task 11: Touch ⋯ sheet controls

**Files:**
- Modify: `components/editor-layout/touchActions.ts`, `components/editor-layout/OverflowMenu.tsx:121-123`, `components/ProjectEditor.tsx:1809-1813`, `tests/helpers/touchActions.ts`
- Test: `tests/unit/ProjectEditor.touchLayout.test.tsx` (append)

**Interfaces:**
- Produces: `TouchEditorActions` gains `smartGuides: boolean; toggleGuides: () => void; gridSize: number; setGridSize: (size: number) => void`. Sheet controls: item "Smart guides" (aria-pressed), a "Grid size" group with buttons "Smaller grid", "Larger grid", an `output` named "Grid size", and quick picks "2 pt", "5 pt", "10 pt", "20 pt".

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/ProjectEditor.touchLayout.test.tsx` (same describe as "routes tool changes to the session and snap/grid to the preferences lane"):

```tsx
    it('edits smart guides and the grid size from the sheet', () => {
        const { onPreferencesChange } = renderIncremental('tablet');
        openOverflow();
        expect(screen.getByRole('button', { name: 'Smart guides' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('status', { name: 'Grid size' })).toHaveTextContent('10 pt');
        fireEvent.click(screen.getByRole('button', { name: 'Smart guides' }));
        expect(onPreferencesChange).toHaveBeenLastCalledWith({ smartGuides: false }, expect.anything());
        fireEvent.click(screen.getByRole('button', { name: 'Larger grid' }));
        expect(onPreferencesChange).toHaveBeenLastCalledWith({ gridSize: 11 }, expect.anything());
        fireEvent.click(screen.getByRole('button', { name: '2 pt' }));
        expect(onPreferencesChange).toHaveBeenLastCalledWith({ gridSize: 2 }, expect.anything());
        expect(canvasProps.gridSize).toBe(2);
        fireEvent.click(screen.getByRole('button', { name: 'Smaller grid' }));
        expect(onPreferencesChange).toHaveBeenLastCalledWith({ gridSize: 1.5 }, expect.anything());
    });
```

If `renderIncremental` does not accept `'tablet'`, use `'phone'` (both layouts share the sheet).

- [ ] **Step 2: Run to verify failure**

Run: `env -u DATABASE_URL TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/unit/ProjectEditor.touchLayout.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`touchActions.ts`: after `snapToGrid: boolean; toggleSnap: () => void; showGrid: boolean; toggleGrid: () => void;` add

```ts
    smartGuides: boolean; toggleGuides: () => void;
    /** Snap grid spacing in pt; `setGridSize` clamps to 1–200 in steps of 0.5. */
    gridSize: number; setGridSize: (size: number) => void;
```

`tests/helpers/touchActions.ts`: add `smartGuides: true, toggleGuides: vi.fn(), gridSize: 10, setGridSize: vi.fn(),` to the defaults.

`ProjectEditor.tsx` (~:1809), replace the snap/grid lines with

```ts
        snapToGrid: state.snapToGrid,
        // Same as EditorToolbar's magnet button: turning snap on also reveals the grid.
        toggleSnap: () => setPreferences({ snapToGrid: !state.snapToGrid, showGrid: !state.snapToGrid ? true : state.showGrid }),
        showGrid: state.showGrid,
        toggleGrid: () => setPreferences({ showGrid: !state.showGrid }),
        smartGuides: snapSettingsOf(state).smartGuides,
        toggleGuides: () => setPreferences({ smartGuides: !snapSettingsOf(state).smartGuides }),
        gridSize: snapSettingsOf(state).gridSize,
        setGridSize: size => setPreferences({ gridSize: clampGridSize(size) }),
```

(import `clampGridSize`).

`OverflowMenu.tsx`: in the Canvas group, after the "Snap to grid" item add

```tsx
                    <Item label="Smart guides" onClick={actions.toggleGuides} checked={actions.smartGuides} />
```

and after "Show grid":

```tsx
                    <GridSizeRow value={actions.gridSize} onChange={actions.setGridSize} />
```

with, near `Item`:

```tsx
// Grid size: − / value / + (steps of 1 pt, 0.5 below 2 pt) and the desktop popover's quick picks.
const GridSizeRow = ({ value, onChange }: { value: number; onChange: (size: number) => void }) => {
    const step = (dir: -1 | 1) => onChange(value + dir * ((dir < 0 ? value <= 2 : value < 2) ? 0.5 : 1));
    const text = `${Number.isInteger(value) ? value : value.toFixed(1)} pt`;
    return (
        <div className="px-4 pb-2">
            <div className="flex min-h-11 items-center justify-between gap-3 text-sm text-slate-700">
                <span>Grid size</span>
                <span className="flex items-center gap-1">
                    <button type="button" aria-label="Smaller grid" onClick={() => step(-1)} disabled={value <= 1}
                        className="min-h-11 min-w-11 rounded border border-slate-200 disabled:opacity-40">−</button>
                    <output role="status" aria-label="Grid size" className="w-14 text-center">{text}</output>
                    <button type="button" aria-label="Larger grid" onClick={() => step(1)} disabled={value >= 200}
                        className="min-h-11 min-w-11 rounded border border-slate-200 disabled:opacity-40">+</button>
                </span>
            </div>
            <div className="flex gap-2">
                {GRID_QUICK_PICKS.map(size => (
                    <button key={size} type="button" aria-pressed={value === size} onClick={() => onChange(size)}
                        className={clsx('min-h-11 flex-1 rounded border text-sm', value === size ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600')}>
                        {size} pt
                    </button>
                ))}
            </div>
        </div>
    );
};
```

(import `GRID_QUICK_PICKS` from `../../services/snapping/settings`.)

- [ ] **Step 4: Run tests**

Run: `env -u DATABASE_URL TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/unit/ProjectEditor.touchLayout.test.tsx tests/unit/OverflowMenu* tests/unit/ProjectEditor.incrementalChanges.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/editor-layout components/ProjectEditor.tsx tests/helpers/touchActions.ts tests/unit/ProjectEditor.touchLayout.test.tsx
git commit -m "feat(touch): smart guides and grid size in the More actions sheet

<trailer>"
```

---

### Task 12: End-to-end coverage and regression run

**Files:**
- Create: `tests/e2e/editor_snapping.spec.js`
- Modify: `tests/e2e/mobile_editor.spec.js` (append one test)

- [ ] **Step 1: Desktop spec**

```js
import { test, expect } from '@playwright/test';
import { openFreshEditor, readActiveProject } from './localWorkspaceHelpers.js';

const pane = page => page.locator('[data-testid="project-pane"][data-active="true"]');

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
        await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
        await page.mouse.down();
        await page.mouse.move(bb.x + bb.width / 2 - (bb.x - ab.x) + 3, bb.y + bb.height / 2, { steps: 8 });
        await expect(pane(page).locator('[data-testid="snap-guides"] line[data-guide-kind="align"]').first()).toBeVisible();
        await page.mouse.up();
        await expect(pane(page).locator('[data-testid="snap-guides"]')).toHaveCount(0);
        expect(Math.abs((await b.boundingBox()).x - ab.x)).toBeLessThan(0.75);
    });

    test('Alt moves without snapping', async ({ page }) => {
        await drawRect(page, { x: 120, y: 120 }, { x: 220, y: 180 });
        await drawRect(page, { x: 300, y: 300 }, { x: 360, y: 340 });
        const [a, b] = await pane(page).locator('[data-element-id]').all();
        const ab = await a.boundingBox(), bb = await b.boundingBox();
        await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
        await page.mouse.down();
        await page.mouse.move(bb.x + bb.width / 2 - 20, bb.y + bb.height / 2, { steps: 2 });
        await page.keyboard.down('Alt');
        await page.mouse.move(bb.x + bb.width / 2 - (bb.x - ab.x) + 3, bb.y + bb.height / 2, { steps: 4 });
        await page.mouse.up();
        await page.keyboard.up('Alt');
        expect((await b.boundingBox()).x - ab.x).toBeGreaterThan(2);
    });

    test('a custom grid size lands edges on its lines', async ({ page }) => {
        await drawRect(page, { x: 123, y: 131 }, { x: 207, y: 189 });
        await page.getByTitle('Snapping options').click();
        await page.getByRole('switch', { name: 'Smart guides' }).click();
        await page.getByRole('button', { name: '20 pt' }).click();
        await page.getByRole('switch', { name: 'Snap to grid' }).click();
        await page.keyboard.press('Escape');
        const rect = pane(page).locator('[data-element-id]').first();
        const r = await rect.boundingBox();
        await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
        await page.mouse.down();
        await page.mouse.move(r.x + r.width / 2 + 47, r.y + r.height / 2 + 33, { steps: 6 });
        await page.mouse.up();
        await expect.poll(async () => {
            const project = await readActiveProject(page);
            const state = project.initialState ?? project.state ?? project;
            const tpl = state.variants[state.activeVariantId].templates[state.nodes[state.rootId].type];
            const el = tpl.elements[0];
            return [el.x % 20, el.y % 20];
        }).toEqual([0, 0]);
    });
});
```

`readActiveProject` returns the stored project; read its shape in `tests/e2e/localWorkspaceHelpers.js:75` and adjust the `state` line to the actual field (e.g. `project.initialState`).

- [ ] **Step 2: Touch test**

Append to `tests/e2e/mobile_editor.spec.js` (it already seeds `box` and `badge` and defines `Fingers`, `box()`, `activePane()`):

```js
test('a finger drag lines the badge up with the box', async ({ page, browserName }) => {
    const fingers = new Fingers(page, browserName);
    const pane = activePane(page);
    const target = await box(pane.locator('[data-element-id="box"]'));
    const badge = pane.locator('[data-element-id="badge"]');
    const start = await box(badge);
    await page.touchscreen.tap(start.x, start.y);
    await expect(pane.locator('[data-resize-handle="se"]')).toBeVisible();
    // Bring the badge's left edge to 6 screen px right of the box's left edge (inside the 10 px pull).
    await fingers.drag(start, { x: start.x - (start.b.x - target.b.x) + 6, y: start.y + 120 });
    await expect.poll(async () => Math.abs((await badge.boundingBox()).x - target.b.x)).toBeLessThan(1);
});

test('the sheet edits smart guides and the grid size', async ({ page }) => {
    await page.getByRole('button', { name: 'More actions' }).click();
    const menu = overflowMenu(page);
    await expect(menu.getByRole('button', { name: 'Smart guides' })).toHaveAttribute('aria-pressed', 'true');
    await menu.getByRole('button', { name: '5 pt' }).click();
    await expect(menu.getByRole('status', { name: 'Grid size' })).toHaveText('5 pt');
    const larger = await menu.getByRole('button', { name: 'Larger grid' }).boundingBox();
    expect(larger.height).toBeGreaterThanOrEqual(44);
});
```

- [ ] **Step 3: Run the new specs**

```bash
env -u DATABASE_URL npx playwright test tests/e2e/editor_snapping.spec.js --project=chromium
env -u DATABASE_URL npx playwright test tests/e2e/mobile_editor.spec.js --project=mobile-phone-chromium --project=mobile-tablet-chromium
```

Expected: PASS.

- [ ] **Step 4: Full e2e regression (Chromium + mobile Chromium)**

```bash
env -u DATABASE_URL npx playwright test --project=chromium --project=mobile-phone-chromium --project=mobile-tablet-chromium
```

Expected: PASS except known environment-only failures that also fail on `main` (verify any failure by running it on `main` in a separate detached worktree before blaming this branch). Per Review Focus 1, a test that now snaps gets a deliberate change, listed in the report. If `desktop_layout_guard.spec.js` fails on its snapshot because of the new chevron, STOP and ask the user before updating snapshots.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/editor_snapping.spec.js tests/e2e/mobile_editor.spec.js
git commit -m "test(e2e): smart guides, Alt bypass, grid size, touch sheet

<trailer>"
```

---

### Task 13: Documentation

**Files:**
- Create: `docs-content/reference/editor/smart-guides.md`
- Modify: `docs-content/reference/editor/snap-to-grid.md`, `docs-content/reference/shortcuts/delete-and-nudge.md`

- [ ] **Step 1: Write `smart-guides.md`**

```markdown
---
title: Smart Guides
summary: While you move, resize or draw, objects snap to other objects' edges and centres, to equal gaps and matching sizes, and to the page — with lines and measurements showing what lined up.
aliases: guides, alignment guides, snapping, equal spacing
keywords: smart guides, snap, align, alignment, guides, equal spacing, distance, match size, alt, option
---

**Smart guides** pull what you're moving into line with what's already on the page. Drag an object near another one's left, right, top or bottom edge, or its centre, and it snaps into line; a pink guide shows which edges lined up, with the gap to that object in points. The page's edges and centre work the same way.

- **Equal spacing** — dragging between two objects centres it between them; dragging past a row repeats a gap that's already there. Brackets show the matching gaps.
- **Matching sizes** — while resizing, the side you're dragging snaps to another object's width or height, labelled `= 120`.
- **Every visible layer counts**, locked ones included, so a locked background frame is a handy alignment reference. Hidden layers never pull.

Hold `kbd:Alt` (`kbd:Option` on a Mac) while dragging to move freely. Turn guides off in the toolbar's **Snapping options** (the small arrow beside the magnet), or on a tablet or phone under **More actions → Canvas**. The setting is saved with the project.

When Snap to Grid is also on, a guide within reach wins; otherwise the object lands on the grid. See [Snap to Grid](/docs/reference/editor/snap-to-grid).
```

Check the link format other reference pages use for reference-to-reference links (`git grep -n "](/docs/" docs-content/reference | head`) and match it; `tests/unit/docsAntiRot.test.ts` fails on unresolved links.

- [ ] **Step 2: Rewrite `snap-to-grid.md` and `delete-and-nudge.md`**

`snap-to-grid.md` body (keep the frontmatter format; update `summary` to "The magnet snaps edges onto a grid of the size you choose; turning it on also shows the grid." and `keywords` to drop `10pt, 5pt, 1pt` and add `grid size`):

```markdown
The two icons just left of the zoom controls are **Snap to Grid** (the magnet) and **Show Grid**. Turning Snap on always turns Show Grid on too, so you can see the grid you're snapping to; turning Snap off leaves the grid as you had it.

With Snap on, a moved object's left and top edges land on grid lines, a resized object's dragged edge lands on a line, and new shapes start and end on lines. Choose the size — **1 to 200 pt**, default **10 pt** — in **Snapping options** (the small arrow beside the magnet), or under **More actions → Canvas** on a tablet or phone. It's saved with the project. When you zoom far out the grid is drawn more sparsely so it stays readable, but snapping still uses the size you chose.

Snap also changes nudging: an arrow key moves the selection to the next grid line, `kbd:Shift+Arrow` ten grid lines. [Smart guides](/docs/reference/editor/smart-guides) win over the grid when one is within reach; hold `kbd:Alt` to move without either.

See [Moving around the canvas](/docs/editor/canvas-basics#moving-around-the-canvas).
```

`delete-and-nudge.md`: replace the Nudge paragraph with

```markdown
**Nudge** with any arrow key moves the selection **1pt** per press, `kbd:Shift+Arrow` **10pt**. With Snap to Grid on, an arrow key moves to the next grid line instead, and `kbd:Shift+Arrow` ten grid lines. Like every shortcut here, nudging is suppressed while your cursor is in a text field.
```

- [ ] **Step 3: Check the editor tutorial for stale statements**

Run `git grep -n -i "10 pt\|10pt\|finer as you zoom\|snap" docs-content/tutorials` and correct any statement that describes the zoom-dependent grid or the old 10 pt snap nudge.

- [ ] **Step 4: Run the docs guards**

Run: `env -u DATABASE_URL TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/unit/docsAntiRot.test.ts tests/unit/docsGeneratorFences.test.ts tests/unit/docs*`
Expected: PASS.

- [ ] **Step 5: Refresh editor screenshots**

Run `node docs-capture/run.js editor` in the foreground. If it fails for environment reasons (servers, fonts), report it and continue; do not commit partial asset churn unrelated to the toolbar.

- [ ] **Step 6: Commit**

```bash
git add docs-content public/docs-assets
git commit -m "docs: smart guides, grid size and grid nudging

<trailer>"
```

---

### Task 14: Final benchmark, budget check, onboarding bundle

**Files:**
- Modify: `onboarding/index.html` (regenerated)

- [ ] **Step 1: Run the final benchmark**

```bash
cd /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/smart-guides && env -u DATABASE_URL SNAP_PERF=1 SNAP_PERF_PHASE=final SNAP_PERF_OUTPUT=$PWD/../../.superpowers/bench/smart-guides npx playwright test --project=snap-perf-desktop --project=snap-perf-tablet --workers=1
```

- [ ] **Step 2: Compare against the budget**

```bash
node -e '
const dir = process.argv[1];
for (const p of ["snap-perf-desktop", "snap-perf-tablet"]) {
  const b = require(`${dir}/baseline-${p}.json`), f = require(`${dir}/final-${p}.json`);
  for (const size of Object.keys(b)) {
    const base = b[size].off.frame.p95, fin = f[size].both.frame.p95;
    const engine = f[size].both.handler && f[size].off.handler ? f[size].both.handler.mean - f[size].off.handler.mean : null;
    console.log(p, size, "p95 frame baseline", base.toFixed(2), "final(both)", fin.toFixed(2),
      "ratio", (fin / base).toFixed(3), engine === null ? "" : `engine +${engine.toFixed(3)} ms`);
  }
}' /media/anoop/ssd_1/Work/doctect/doctect/.superpowers/bench/smart-guides
```

Expected: every `ratio` ≤ 1.05; every desktop `engine` ≤ 1.0 ms; final `off` p95 within 5% of baseline `off`. If a ratio is over budget, re-run once (noise); if it stays over, profile (`snapMove` vs render) and fix before continuing — this is a release gate, not a note.

- [ ] **Step 3: Full unit suite**

Run: `env -u DATABASE_URL TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run 2>&1 | grep -E 'FAIL|Test Files|Tests '` and `npx tsc --noEmit -p .`
Expected: only `tests/unit/onboarding/bundle.test.js` fails (and the `accountModeration` load flake, which passes alone).

- [ ] **Step 4: Regenerate the onboarding bundle (last commit)**

```bash
git status --porcelain -uall | grep -v '^?? node_modules'   # must print nothing: the build includes untracked files
node onboarding/build.mjs
grep -c -E 'key\.pem|BEGIN PRIVATE' onboarding/index.html      # must print 0
env -u DATABASE_URL TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/unit/onboarding/bundle.test.js
git add onboarding/index.html
git commit -m "chore(onboarding): regenerate bundle

<trailer>"
```

- [ ] **Step 5: Report**

Report to the user: before/after p95 frame times per size and device, engine time, any tests changed under Review Focus 1, and anything skipped. Do not merge or push without the user's go-ahead.
