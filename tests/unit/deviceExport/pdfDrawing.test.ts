// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { jsPDF } from 'jspdf';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { FLATTEN_TOLERANCE, extractDrawing, greyHex, readPdfPageDrawing, type Drawing, type FillItem, type StrokeItem, type TextItemLike } from '../../../services/deviceExport/pdfDrawing';

const OPS = pdfjs.OPS as Record<string, number>;
const VIEW = [0, 0, 200, 300];
const list = (...ops: [number, unknown][]) => ({ fnArray: ops.map(op => op[0]), argsArray: ops.map(op => op[1]) });
const path = (paint: number, data: number[]): [number, unknown] => [OPS.constructPath, [paint, [Float32Array.from(data)], null]];
const draw = (ops: [number, unknown][], text: TextItemLike[] = [], fonts: Record<string, string> = {}): Drawing =>
    extractDrawing({ ops: list(...ops), text, view: VIEW, OPS, fontNameOf: id => fonts[id] });

describe('greyHex', () => {
    it('converts to grey and blends alpha with white', () => {
        expect(greyHex('#000000', 1)).toBe('#000000');
        expect(greyHex('#000000', 0.5)).toBe('#808080');
        expect(greyHex('#ffffff', 1)).toBe('#ffffff');
        expect(greyHex('#ff0000', 1)).toBe('#363636');
    });
});

describe('extractDrawing', () => {
    it('turns a filled rectangle into a closed sub-path in top-left page space', () => {
        const { items } = draw([[OPS.setFillRGBColor, ['#808080']], path(OPS.fill, [0, 10, 290, 1, 60, 290, 1, 60, 250, 1, 10, 250, 4])]);
        expect(items).toEqual([{ kind: 'fill', grey: '#808080', evenOdd: false,
            subpaths: [{ closed: true, points: [[10, 10], [60, 10], [60, 50], [10, 50]] }] }]);
    });

    it('applies fill alpha from the graphics state and keeps even-odd fills', () => {
        const { items } = draw([
            [OPS.setFillRGBColor, ['#000000']], [OPS.setGState, [[['ca', 0.5]]]],
            path(OPS.eoFill, [0, 0, 300, 1, 10, 300, 1, 10, 290, 4]),
        ]);
        expect(items[0]).toMatchObject({ kind: 'fill', grey: '#808080', evenOdd: true });
    });

    it('scales stroke width by the transform and restores state', () => {
        const { items } = draw([
            [OPS.save, null], [OPS.transform, [2, 0, 0, 2, 0, 0]], [OPS.setLineWidth, [1.5]],
            path(OPS.stroke, [0, 0, 100, 1, 10, 100]), [OPS.restore, null],
            path(OPS.stroke, [0, 0, 100, 1, 10, 100]),
        ]);
        const [scaled, plain] = items as StrokeItem[];
        expect(scaled.width).toBe(3);
        expect(scaled.subpaths[0].points).toEqual([[0, 100], [20, 100]]);
        expect(plain.width).toBe(1);
        expect(plain.subpaths[0].points).toEqual([[0, 200], [10, 200]]);
    });

    it('flattens curves within tolerance', () => {
        const { items } = draw([path(OPS.stroke, [0, 0, 300, 2, 0, 200, 100, 200, 100, 300])]);
        const points = (items[0] as StrokeItem).subpaths[0].points;
        expect(points.length).toBeGreaterThan(4);
        expect(points[0]).toEqual([0, 0]);
        expect(points[points.length - 1]).toEqual([100, 0]);
        // Every chord midpoint stays near the true curve (page space: y = 300 - pdf y).
        const curve = (t: number): [number, number] => {
            const u = 1 - t;
            return [3 * u * t * t * 100 + t * t * t * 100, 300 - (u * u * u * 300 + 3 * u * u * t * 200 + 3 * u * t * t * 200 + t * t * t * 300)];
        };
        const dense = Array.from({ length: 2001 }, (_, i) => curve(i / 2000));
        for (let i = 1; i < points.length; i++) {
            const mid = [(points[i - 1][0] + points[i][0]) / 2, (points[i - 1][1] + points[i][1]) / 2];
            const nearest = Math.min(...dense.map(p => Math.hypot(p[0] - mid[0], p[1] - mid[1])));
            expect(nearest).toBeLessThanOrEqual(FLATTEN_TOLERANCE + 0.05);
        }
    });

    it('splits dashed strokes into separate segments', () => {
        const { items } = draw([[OPS.setDash, [[10, 5], 0]], path(OPS.stroke, [0, 0, 100, 1, 100, 100])]);
        const pieces = (items[0] as StrokeItem).subpaths;
        expect(pieces).toHaveLength(7);
        expect(pieces[0]).toEqual({ closed: false, points: [[0, 200], [10, 200]] });
        expect(pieces[6]).toEqual({ closed: false, points: [[90, 200], [100, 200]] });
    });

    it('turns zero-length round-capped dashes into dots (the editor dot grid), and nothing under butt caps', () => {
        // services/pdfService.ts drawDotsOptimized: round cap + [0, spacing] dash, one stroked line per row.
        const dotted = (cap: [number, unknown]) =>
            draw([[OPS.setLineWidth, [1]], cap, [OPS.setDash, [[0, 10], 0]], path(OPS.stroke, [0, 10, 280, 1, 50, 280])]);
        const { items } = dotted([OPS.setLineCap, [1]]);
        expect(items.map(item => item.kind)).toEqual(['fill']);
        const dots = (items[0] as FillItem).subpaths;
        expect(dots).toHaveLength(5);
        dots.forEach((dot, i) => {
            expect(dot.closed).toBe(true);
            expect(dot.points.length).toBeGreaterThanOrEqual(8);
            for (const [x, y] of dot.points) expect(Math.hypot(x - (10 + 10 * i), y - 20)).toBeCloseTo(0.5, 6);
        });
        expect(dotted([OPS.setLineCap, [0]]).items).toEqual([]);
        expect(dotted([OPS.setGState, [[['LC', 1]]]]).items.map(item => item.kind)).toEqual(['fill']);
    });

    it('applies a form XObject matrix (a Float32Array) exactly once, also inside a transparency group', () => {
        // pdf.js 5.4.624 emits beginGroup [{ matrix, bbox, … }] and then paintFormXObjectBegin [Float32Array matrix, bbox]
        // for the same form; canvas.js applies the matrix only at paintFormXObjectBegin.
        const matrix = Float32Array.from([2, 0, 0, 2, 10, 0]);
        const line = path(OPS.stroke, [0, 0, 100, 1, 10, 100]);
        const { items } = draw([
            [OPS.beginGroup, [{ matrix: Array.from(matrix), bbox: [0, 0, 40, 40], isolated: true, knockout: false }]],
            [OPS.paintFormXObjectBegin, [matrix, null]], line, [OPS.paintFormXObjectEnd, []], [OPS.endGroup, [{}]],
            [OPS.paintFormXObjectBegin, [matrix, Float32Array.from([0, 0, 40, 40])]], line, [OPS.paintFormXObjectEnd, []],
            line,
        ]);
        const [grouped, plain, outer] = items as StrokeItem[];
        for (const inner of [grouped, plain]) {
            expect(inner.subpaths[0].points).toEqual([[10, 100], [30, 100]]);
            expect(inner.width).toBe(2);
        }
        expect(outer.subpaths[0].points).toEqual([[0, 200], [10, 200]]);
        expect(outer.width).toBe(1);
    });

    it('emits fill and stroke for fill-and-stroke paths', () => {
        const { items } = draw([path(OPS.closeFillStroke, [0, 0, 300, 1, 10, 300, 1, 10, 290])]);
        expect(items.map(item => item.kind)).toEqual(['fill', 'stroke']);
        expect((items[1] as StrokeItem).subpaths[0].closed).toBe(true);
    });

    it('notes what it cannot represent', () => {
        const { items, notes } = draw([
            [OPS.paintImageXObject, ['img1', 10, 10]], [OPS.clip, null], [OPS.shadingFill, ['sh']],
            [OPS.setFillColorN, ['Pattern']], path(OPS.fill, [0, 0, 300, 1, 10, 300, 1, 10, 290, 4]),
            [OPS.setStrokeRGBColor, ['#eeeeee']], path(OPS.stroke, [0, 0, 300, 1, 10, 300]),
        ]);
        expect(items.map(item => item.kind)).toEqual(['stroke']);
        expect(new Set(notes)).toEqual(new Set(['image', 'clip', 'shading', 'pattern', 'light-stroke']));
    });

    it('ignores empty paths and endPath', () => {
        expect(draw([[OPS.constructPath, [OPS.fill, [null], null]], path(OPS.endPath, [0, 0, 0, 1, 1, 1])]).items).toEqual([]);
    });

    it('reads text runs with bold, italic and rotation notes', () => {
        const { items, notes } = draw([], [
            { str: 'Hello', transform: [14, 0, 0, 14, 20, 150], fontName: 'f1' },
            { str: '   ', transform: [14, 0, 0, 14, 20, 120], fontName: 'f1' },
            { str: 'Slant', transform: [10, 0, 0, 10, 5, 100], fontName: 'f2' },
            { str: 'Up', transform: [0, 10, -10, 0, 50, 50], fontName: 'f2' },
        ], { f1: 'Helvetica-Bold', f2: 'NimbusSans-Italic' });
        expect(items[0]).toEqual({ kind: 'text', text: 'Hello', x: 20, baseline: 150, size: 14, bold: true });
        expect(items[1]).toMatchObject({ text: 'Slant', bold: false });
        expect(items).toHaveLength(3);
        expect(new Set(notes)).toEqual(new Set(['device-font', 'italic', 'rotated-text']));
    });
});

describe('readPdfPageDrawing (real jsPDF + pdf.js)', () => {
    it('reads fills, dashed strokes, curves and bold text from a jsPDF page', async () => {
        const doc = new jsPDF({ unit: 'pt', format: [200, 300] });
        doc.setFillColor(128, 128, 128); doc.rect(10, 10, 50, 40, 'F');
        doc.setLineWidth(2); doc.setLineDashPattern([3, 2], 0); doc.line(10, 100, 150, 100);
        doc.setLineDashPattern([], 0); doc.ellipse(100, 200, 30, 20, 'S');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text('Hello', 20, 150);
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(doc.output('arraybuffer')) }).promise;
        const drawing = await readPdfPageDrawing(await pdf.getPage(1) as never, OPS);
        expect(drawing).toMatchObject({ width: 200, height: 300 });
        const fill = drawing.items.find((item): item is FillItem => item.kind === 'fill')!;
        expect(fill.grey).toBe('#808080');
        expect(fill.subpaths[0].points).toEqual([[10, 10], [60, 10], [60, 50], [10, 50]]);
        const strokes = drawing.items.filter((item): item is StrokeItem => item.kind === 'stroke');
        expect(strokes[0].subpaths.length).toBeGreaterThan(20);
        expect(strokes[1].subpaths[0].points.length).toBeGreaterThan(8);
        expect(drawing.items.find(item => item.kind === 'text')).toEqual({ kind: 'text', text: 'Hello', x: 20, baseline: 150, size: 14, bold: true });
    });

    it('reads the editor dot-grid recipe (round cap + zero-length dashes) as dots', async () => {
        // Mirrors services/pdfService.ts drawDotsOptimized.
        const doc = new jsPDF({ unit: 'pt', format: [200, 300] });
        doc.saveGraphicsState(); doc.setDrawColor(100, 100, 100); doc.setLineWidth(1); doc.setLineCap('round'); doc.setLineDashPattern([0, 10], 0);
        doc.moveTo(10, 20); doc.lineTo(50, 20); doc.stroke();
        doc.setLineCap('butt'); doc.setLineDashPattern([], 0); doc.restoreGraphicsState();
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(doc.output('arraybuffer')) }).promise;
        const drawing = await readPdfPageDrawing(await pdf.getPage(1) as never, OPS);
        expect(drawing.items.map(item => item.kind)).toEqual(['fill']);
        const { subpaths: dots, grey } = drawing.items[0] as FillItem;
        expect(grey).toBe('#636363');
        expect(dots).toHaveLength(5);
        dots.forEach((dot, i) => { for (const [x, y] of dot.points) expect(Math.hypot(x - (10 + 10 * i), y - 20)).toBeCloseTo(0.5, 6); });
    });
});
