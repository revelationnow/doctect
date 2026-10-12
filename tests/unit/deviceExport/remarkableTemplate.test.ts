import { describe, expect, it } from 'vitest';
import { getProfile } from '../../../services/deviceExport/deviceProfiles';
import type { Drawing, DrawingItem } from '../../../services/deviceExport/pdfDrawing';
import { MAX_METHODS_ITEMS, buildMethodsTemplate, fnv1a8, mergeItems, rotateForCanvas } from '../../../services/deviceExport/remarkableTemplate';

const rmPP = getProfile('rm_pp')!;
const rm2 = getProfile('rm2')!;
const square = (x: number, y: number, size = 10) => ({ closed: true, points: [[x, y], [x + size, y], [x + size, y + size], [x, y + size]] as [number, number][] });
const fill = (x: number, y: number, grey = '#808080'): DrawingItem => ({ kind: 'fill', grey, evenOdd: false, subpaths: [square(x, y)] });
const stroke = (y: number, width = 1): DrawingItem => ({ kind: 'stroke', grey: '#000000', width, subpaths: [{ closed: false, points: [[0, y], [100, y]] }] });
const drawing = (items: DrawingItem[], width = 500, height = 700, notes: Drawing['notes'] = []): Drawing => ({ width, height, items, notes });
const options = (profile = rmPP) => ({ profile, pageTitle: 'Jan 1', projectName: 'Planner', projectSlug: 'Planner', pageSlug: 'Jan_1', now: 1760000000000 });
const parse = (result: ReturnType<typeof buildMethodsTemplate>) => JSON.parse(result.files!.template);
const strings = (value: unknown): string[] => Array.isArray(value) ? value.flatMap(strings)
    : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : typeof value === 'string' ? [value] : [];

describe('buildMethodsTemplate', () => {
    it('writes the three files with the fields the device requires', () => {
        const result = buildMethodsTemplate(drawing([fill(10, 10)]), options());
        const template = parse(result);
        expect(template).toMatchObject({ name: 'Jan 1', formatVersion: 1, categories: ['Custom'], labels: ['Planner'],
            orientation: 'portrait', supportedScreens: ['rmPP'] });
        expect(JSON.parse(result.files!.metadata)).toMatchObject({ type: 'TemplateType', visibleName: 'Jan 1', parent: '', pinned: false,
            createdTime: '1760000000000', lastModified: '1760000000000' });
        expect(result.files!.content).toBe('{}');
        expect(result.files!.stem).toMatch(/^doctect-planner-jan_1-rm_pp-[0-9a-f]{8}$/);
    });

    it('draws only M/L/Z with positions as expressions over the fit constants', () => {
        const template = parse(buildMethodsTemplate(drawing([fill(10, 10), stroke(50)]), options()));
        const data = template.items.flatMap((item: { data: unknown[] }) => item.data);
        for (const token of data) {
            expect(typeof token).toBe('string');
            if ((token as string).length === 1) expect(['M', 'L', 'Z']).toContain(token);
            else expect(token).toMatch(/^-?\d+(\.\d+)? \* s \+ o[xy]$/);
        }
        expect(template.items[0]).toMatchObject({ id: 'i1', type: 'path', fillColor: '#808080' });
        expect(template.items[1]).toMatchObject({ id: 'i2', type: 'path' });
    });

    it('fits on the limiting axis and centres', () => {
        // 500x700 on the Paper Pro (1620x2160): height limits.
        expect(parse(buildMethodsTemplate(drawing([fill(0, 0)], 500, 700), options())).constants).toEqual([
            { s: 'templateHeight / 700' }, { ox: '(templateWidth - 500 * s) / 2' }, { oy: '(templateHeight - 700 * s) / 2' },
        ]);
        // 600x700: width limits.
        expect(parse(buildMethodsTemplate(drawing([fill(0, 0)], 600, 700), options())).constants[0]).toEqual({ s: 'templateWidth / 600' });
    });

    it('marks landscape pages and fits them against the turned box', () => {
        const template = parse(buildMethodsTemplate(drawing([fill(0, 0)], 700, 500), options()));
        expect(template.orientation).toBe('landscape');
        expect(template.constants[0]).toEqual({ s: 'templateWidth / 700' });
    });

    it('scales stroke width and font size to the logical canvas, and places text by its top', () => {
        // 468x624 on the rM2 (1404x1872): fit scale 3, canvas factor 1404/1404.
        const template = parse(buildMethodsTemplate(drawing([
            stroke(50, 0.2), stroke(60, 2),
            { kind: 'text', text: 'Hi', x: 10, baseline: 40, size: 10, bold: true },
        ], 468, 624), options(rm2)));
        expect(template.items.map((item: { strokeWidth?: number }) => item.strokeWidth)).toEqual([1, 6, undefined]);
        expect(template.items[2]).toMatchObject({ type: 'text', text: 'Hi', fontSize: 30, bold: true });
        // rM2 is rotated: the text top (10, 32) maps to (32, 468 - 10).
        expect(template.items[2].position).toEqual({ x: '32 * s + ox', y: '458 * s + oy' });
    });

    it('pre-rotates every point for rotated canvases', () => {
        expect(rotateForCanvas([10, 20], { width: 100, height: 200 })).toEqual([20, 90]);
        const template = parse(buildMethodsTemplate(drawing([stroke(20)], 100, 200), options(rm2)));
        expect(template.items[0].data.slice(0, 3)).toEqual(['M', '20 * s + ox', '100 * s + oy']);
    });

    it('fits rotated canvases against the turned page (spec 5.4: W and H swap)', () => {
        // 100x200 on the rM2 turns into a 200-wide, 100-tall drawing on a 1872x1404 canvas: width limits.
        const template = parse(buildMethodsTemplate(drawing([stroke(20)], 100, 200), options(rm2)));
        expect(template.constants).toEqual([
            { s: 'templateWidth / 200' }, { ox: '(templateWidth - 200 * s) / 2' }, { oy: '(templateHeight - 100 * s) / 2' },
        ]);
        expect(template.orientation).toBe('portrait');
    });

    it('reports what was simplified, in words', () => {
        const result = buildMethodsTemplate(drawing([fill(0, 0)], 500, 700, ['image', 'device-font']), options());
        expect(result.notes).toEqual(['images were left out (the format cannot draw images)', "text is drawn in the tablet's own font"]);
    });

    it('skips pages that are too large and says only the PNG is included', () => {
        const items = Array.from({ length: MAX_METHODS_ITEMS + 1 }, (_, i) => fill(i % 400, Math.floor(i / 400) * 12, i % 2 ? '#000000' : '#808080'));
        const result = buildMethodsTemplate(drawing(items, 5000, 7000), options());
        expect(result.files).toBeNull();
        expect(result.notes.at(-1)).toMatch(/only the PNG is included/);
    });

    it('changes the stem when the drawing changes', () => {
        const a = buildMethodsTemplate(drawing([fill(10, 10)]), options()).files!.stem;
        const b = buildMethodsTemplate(drawing([fill(11, 10)]), options()).files!.stem;
        expect(a).not.toBe(b);
        expect(fnv1a8('abc')).toBe('1a47e90b');
    });

    it('embeds a 150x200 SVG icon', () => {
        const icon = atob(parse(buildMethodsTemplate(drawing([fill(10, 10)]), options())).iconData);
        expect(icon).toMatch(/^<svg [^>]*width="150" height="200"/);
        const tokens = strings(parse(buildMethodsTemplate(drawing([fill(10, 10)]), options())).items);
        expect(tokens).not.toContain('C');
        expect(tokens).not.toContain('A');
    });
});

describe('mergeItems', () => {
    it('merges consecutive strokes of one width and keeps others apart', () => {
        const merged = mergeItems([stroke(10), stroke(20), stroke(30, 2), { kind: 'text', text: 't', x: 0, baseline: 0, size: 5, bold: false }, stroke(40)]);
        expect(merged.map(item => item.kind === 'text' ? 'text' : `${item.kind}:${item.subpaths.length}`)).toEqual(['stroke:2', 'stroke:1', 'text', 'stroke:1']);
    });

    it('merges same-grey fills only when they do not overlap', () => {
        expect(mergeItems([fill(0, 0), fill(20, 0)])).toHaveLength(1);
        expect(mergeItems([fill(0, 0), fill(5, 5)])).toHaveLength(2);
        expect(mergeItems([fill(0, 0), fill(20, 0, '#000000')])).toHaveLength(2);
    });

    it('does not mutate its input', () => {
        const input = [stroke(10), stroke(20)];
        mergeItems(input);
        expect((input[0] as { subpaths: unknown[] }).subpaths).toHaveLength(1);
    });
});
