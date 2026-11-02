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
    it('snaps the min edge and draws its guide', () => {
        // Left 103 -> a's right edge 100; the right edge (200) is not a feature and stays put.
        const r = snapResize(T(el('a', 0, 300, 100, 50)), { x: 103, y: 0, w: 97, h: 50 }, { x: 'min', y: null }, guides);
        expect(r.dx).toBeCloseTo(-3); expect(r.dy).toBe(0); expect(r.snappedY).toBe(false);
        expect(r.guides).toEqual([
            { kind: 'align', axis: 'x', at: 100, from: 0, to: 350 },
            { kind: 'distance', axis: 'y', at: 100, from: 50, to: 300 },
        ]);
    });
    it('measures a corner resize by the resized box, not a shifted one (max edges)', () => {
        // Right 97 -> a's right edge 100, bottom 297 -> b's top 300: the box becomes (0,200,100,100).
        const r = snapResize(T(el('a', 50, 100, 50, 50), el('b', 300, 300, 50, 50)),
            { x: 0, y: 200, w: 97, h: 97 }, { x: 'max', y: 'max' }, guides);
        expect(r.dx).toBeCloseTo(3); expect(r.dy).toBeCloseTo(3);
        // The gap to a is measured from the box's real top (200), not a shifted 203: 50, not 53.
        expect(r.guides).toContainEqual({ kind: 'distance', axis: 'y', at: 100, from: 150, to: 200 });
        // The y guide starts at the box's real left edge (0), not a shifted 3.
        expect(r.guides).toContainEqual({ kind: 'align', axis: 'y', at: 300, from: 0, to: 350 });
    });
    it('measures a corner resize by the resized box, not a shifted one (min edges)', () => {
        // Left 103 -> a's right edge 100, top 203 -> b's bottom 200: the box becomes (100,200,100,100).
        const r = snapResize(T(el('a', 50, 100, 50, 50), el('b', 300, 150, 50, 50)),
            { x: 103, y: 203, w: 97, h: 97 }, { x: 'min', y: 'min' }, guides);
        expect(r.dx).toBeCloseTo(-3); expect(r.dy).toBeCloseTo(-3);
        // The x guide reaches the box's real bottom (300), not a shifted 297.
        expect(r.guides).toContainEqual({ kind: 'align', axis: 'x', at: 100, from: 100, to: 300 });
        // The gap to b is measured from the box's real right edge (200), not a shifted 197.
        expect(r.guides).toContainEqual({ kind: 'distance', axis: 'x', at: 200, from: 200, to: 300 });
    });
});

describe('snapPoint', () => {
    it('snaps a point on both axes, or only the axes asked for', () => {
        const t = T(el('a', 100, 200, 50, 50));
        expect(snapPoint(t, { x: 98, y: 203 }, guides)).toMatchObject({ dx: 2, dy: -3 });
        expect(snapPoint(t, { x: 98, y: 203 }, guides, { x: false, y: true })).toMatchObject({ dx: 0, dy: -3 });
    });
});
