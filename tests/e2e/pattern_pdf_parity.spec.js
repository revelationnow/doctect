import { test, expect } from '@playwright/test';
import { seedNativeProject } from './localWorkspaceHelpers.js';
import { layoutFixture } from './fixtures/layoutFixture.js';

// Pattern fills and borders land on the same points on the canvas as in the exported PDF (and so
// in the device templates, which are made from the PDF). The canvas is screenshotted at 300% and
// the PDF rendered with pdf.js at the same size; feature positions are compared in points from
// each element's top-left corner. At an integer zoom both renderings are exact to a fraction of a
// screen pixel; a mismatch shows up as whole points (a border width, half a pattern spacing).

const SCALE = 3;
const TOLERANCE_PT = 0.25;
const TYPES = ['lines-h', 'lines-v', 'grid', 'lines-d', 'dots'];
const PATTERNS = TYPES.flatMap((patternType, i) => [false, true].map(bordered => ({
    id: `${patternType}${bordered ? '-bordered' : ''}`, type: 'rect', layerId: 'base', rotation: 0, opacity: 1,
    x: 10 + i * 60, y: bordered ? 70 : 10, w: 50, h: 40,
    fillType: 'pattern', patternType, fill: '#000000', patternSpacing: 10, patternWeight: patternType === 'dots' ? 3 : 1,
    stroke: bordered ? '#ff0000' : '', strokeWidth: bordered ? 3 : 0,
})));
const BORDERED = ['rect', 'ellipse'].map((type, i) => ({
    id: `${type}-border`, type, layerId: 'base', rotation: 0, opacity: 1,
    x: 10 + i * 60, y: 130, w: 50, h: 40, fill: '', stroke: '#000000', strokeWidth: 3,
}));

test.use({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });

test('pattern fills and borders line up between the canvas and the PDF', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'pixel measurements are recorded on Chromium');
    const state = structuredClone(layoutFixture);
    state.variants.default.templates.page.elements = [...PATTERNS, ...BORDERED];
    state.scale = SCALE;
    await seedNativeProject(page, { id: 'parity', name: 'Parity', initialState: state });
    await page.goto('/app');
    const pane = page.locator('[data-testid="project-pane"][data-active="true"]');
    await expect(pane.getByTestId('editor-canvas')).toBeVisible();
    await page.mouse.move(0, 0);

    const boxes = {};
    for (const el of [...PATTERNS, ...BORDERED]) {
        const box = await pane.locator(`[data-element-id="${el.id}"]`).boundingBox();
        expect(Number.isInteger(box.x) && Number.isInteger(box.y), `${el.id} sits on whole screen pixels`).toBe(true);
        boxes[el.id] = box;
    }
    const shot = await page.screenshot();

    const measured = await page.evaluate(async ({ state, scale, shotB64, boxes, patterns, bordered }) => {
        const { generatePDF } = await import('/services/pdfService.ts');
        const { openPdf, renderPng } = await import('/services/deviceExport/pdfRuntime.ts');
        const pdf = await openPdf(await generatePDF(state, { output: 'arraybuffer' }));
        const pdfBlob = await renderPng(await pdf.getPage(1), { width: 595 * scale, height: 842 * scale });
        const pixels = async (source) => {
            const bitmap = await createImageBitmap(source);
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
            const context = canvas.getContext('2d');
            context.drawImage(bitmap, 0, 0);
            return context.getImageData(0, 0, bitmap.width, bitmap.height);
        };
        const images = {
            canvas: await pixels(await (await fetch(`data:image/png;base64,${shotB64}`)).blob()),
            pdf: await pixels(pdfBlob),
        };
        const dark = (img, x, y) => { const i = (y * img.width + x) * 4; return 255 - Math.min(img.data[i], img.data[i + 1], img.data[i + 2]); };
        const origin = (source, el) => (source === 'canvas' ? [boxes[el.id].x, boxes[el.id].y] : [el.x * scale, el.y * scale]);

        // Darkness of the element's inside (4pt clear of its edges, so borders drop out) projected onto
        // one axis — 'row' (y), 'col' (x) or 'diag' (x + y) — then the centre of each peak, in points.
        const peaks = (source, el, axis) => {
            const img = images[source];
            const [ox, oy] = origin(source, el);
            const margin = 4 * scale;
            const bins = new Map();
            for (let py = margin; py < el.h * scale - margin; py++) {
                for (let px = margin; px < el.w * scale - margin; px++) {
                    const key = axis === 'row' ? py : axis === 'col' ? px : px + py;
                    const bin = bins.get(key) ?? [0, 0];
                    bin[0] += dark(img, ox + px, oy + py); bin[1] += 1;
                    bins.set(key, bin);
                }
            }
            const keys = [...bins.keys()].sort((a, b) => a - b);
            const level = keys.map(key => bins.get(key)[0] / bins.get(key)[1]);
            const threshold = Math.max(...level) * 0.35;
            const found = []; let run = null;
            keys.forEach((key, i) => {
                if (level[i] > threshold) {
                    run ??= { mass: 0, moment: 0 };
                    run.mass += level[i]; run.moment += level[i] * (key + 0.5);
                } else if (run) { found.push(run); run = null; }
            });
            if (run) found.push(run);
            const unit = axis === 'diag' ? scale * Math.SQRT2 : scale;
            return found.map(p => p.moment / p.mass / unit);
        };

        // Dark bands along the element's middle row, as [from, to] in points (anti-aliased edges
        // count by coverage, so a band's ends are fractional where the PDF edge falls mid-pixel).
        const bands = (source, el) => {
            const img = images[source];
            const [ox, oy] = origin(source, el);
            const y = oy + Math.round(el.h * scale / 2);
            const found = []; let run = null;
            for (let px = -2 * scale; px < (el.w + 2) * scale; px++) {
                const d = dark(img, ox + px, y) / 255;
                if (d > 0.05) {
                    run ??= { start: px, mass: 0 };
                    run.mass += d; run.end = px + 1;
                } else if (run) { found.push(run); run = null; }
            }
            if (run) found.push(run);
            return found.map(r => {
                const leadingGap = (r.end - r.start) - r.mass; // uncovered fraction, split over both ends
                return [(r.start + leadingGap / 2) / scale, (r.end - leadingGap / 2) / scale];
            });
        };

        const out = {};
        for (const el of patterns) {
            const axes = el.patternType === 'lines-h' ? ['row'] : el.patternType === 'lines-v' ? ['col']
                : el.patternType === 'lines-d' ? ['diag'] : ['row', 'col'];
            for (const axis of axes) out[`${el.id} ${axis}`] = { canvas: peaks('canvas', el, axis), pdf: peaks('pdf', el, axis) };
        }
        for (const el of bordered) out[`${el.id} band`] = { canvas: bands('canvas', el).flat(), pdf: bands('pdf', el).flat() };
        return out;
    }, { state, scale: SCALE, shotB64: shot.toString('base64'), boxes, patterns: PATTERNS, bordered: BORDERED });

    for (const [feature, { canvas, pdf }] of Object.entries(measured)) {
        const shown = values => values.map(v => v.toFixed(2)).join(', ');
        expect(canvas.length, `${feature}: canvas [${shown(canvas)}] vs PDF [${shown(pdf)}]`).toBe(pdf.length);
        expect(canvas.length, `${feature} has features to compare`).toBeGreaterThan(1);
        canvas.forEach((at, i) => {
            expect(Math.abs(at - pdf[i]), `${feature} #${i}: canvas [${shown(canvas)}] vs PDF [${shown(pdf)}]`).toBeLessThanOrEqual(TOLERANCE_PT);
        });
    }
});
