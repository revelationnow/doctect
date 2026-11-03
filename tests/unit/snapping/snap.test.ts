import { describe, it, expect } from 'vitest';
import { buildSnapTargets } from '../../../services/snapping/targets';
import { snapMove, snapPoint, snapResize } from '../../../services/snapping/snap';
import { round2, type SnapSettings } from '../../../services/snapping/types';
import type { TemplateElement } from '../../../types';

const el = (id: string, x: number, y: number, w: number, h: number) =>
    ({ id, type: 'rect', x, y, w, h, rotation: 0, fill: '', stroke: '', strokeWidth: 0, opacity: 1 }) as TemplateElement;
const T = (...elements: TemplateElement[]) =>
    buildSnapTargets({ elements, excludeIds: [], page: { w: 500, h: 700 }, nodes: {}, currentNodeId: 'root' });
const guides: SnapSettings = { grid: null, guides: true, threshold: 6 };
const both: SnapSettings = { grid: 10, guides: true, threshold: 6 };

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
    it('lets a guide in range win over the grid only when it lands on the grid', () => {
        // a's left edge (40) is 6 from the box's (34): it wins over the nearer grid line (30).
        expect(snapMove(T(el('a', 40, 300, 30, 30)), { x: 34, y: 500, w: 30, h: 30 }, both).dx).toBeCloseTo(6);
        // a's left edge at 34 is 2 from the box's (32) but off the grid: the grid takes the box to 30.
        expect(snapMove(T(el('a', 34, 300, 50, 50)), { x: 32, y: 500, w: 20, h: 20 }, both).dx).toBeCloseTo(-2);
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

// With Snap to grid on, the feature the grid snaps (a move's left/top edge, a resize's dragged edge, a
// point) always lands on the grid: guides only pull to results that keep it there.
describe('grid wins with Snap to grid on', () => {
    // The user's live repro: Letter page, 10 pt grid, a 55 pt wide rect (centre 227.5, right edge 255)
    // and the page centre (306, 396) all pull a 60 x 30 box off the grid.
    const letter = buildSnapTargets({ elements: [el('r', 200, 300, 55, 40)], excludeIds: [], page: { w: 612, h: 792 }, nodes: {}, currentNodeId: 'root' });
    const drop = (x: number, y: number, s = both) => { const r = snapMove(letter, { x, y, w: 60, h: 30 }, s); return [round2(x + r.dx), round2(y + r.dy)]; };
    it('ignores the page centre when it would leave the left edge off the grid', () => {
        expect(drop(281, 152)).toEqual([280, 150]); // centre 311 -> 306 would put the left edge at 276
    });
    it('falls back to the grid on both axes when every guide in reach is off-grid', () => {
        expect(drop(250, 381)).toEqual([250, 380]); // page centres 306 / 396, r's right edge 255
    });
    it('keeps the plain grid result where no on-grid guide is in reach', () => {
        expect(drop(221, 152)).toEqual([220, 150]);
    });
    it('still aligns to anything with Snap off', () => {
        expect(drop(281, 152, guides)).toEqual([276, 152]);
    });
    it('prefers an on-grid alignment over a closer off-grid one', () => {
        // b's left edge (36) is 2 from the box's (34) but off-grid; a (40, same width) is 6 away and on it.
        const r = snapMove(T(el('a', 40, 300, 30, 30), el('b', 36, 500, 30, 30)), { x: 34, y: 100, w: 30, h: 30 }, both);
        expect(r.dx).toBeCloseTo(6);
        expect(r.guides).toContainEqual(expect.objectContaining({ kind: 'align', axis: 'x', at: 40 }));
    });
    it('a resized edge lands on the grid when the size match and edge in reach are off-grid', () => {
        // Right edge 117 -> a's right edge / width 123 would end off-grid: the edge takes the grid line 120.
        const t = T(el('a', 0, 300, 123, 40)), box = { x: 0, y: 0, w: 117, h: 50 }, edges = { x: 'max', y: null } as const;
        const r = snapResize(t, box, edges, both);
        expect(r.dx).toBeCloseTo(3);
        expect(r.guides.some(g => g.kind === 'size')).toBe(false);
        expect(snapResize(t, box, edges, guides).dx).toBeCloseTo(6); // Snap off: the guide still pulls
    });
    it('a size match that ends on the grid still wins over the nearest grid line', () => {
        const r = snapResize(T(el('a', 200, 300, 120, 40)), { x: 0, y: 0, w: 114, h: 50 }, { x: 'max', y: null }, both);
        expect(r.dx).toBeCloseTo(6); // width 114 -> 120, not the grid's 110
        expect(r.guides.find(g => g.kind === 'size')).toMatchObject({ size: 120 });
    });
    it('a line end lands on the grid when the edges in reach are off-grid', () => {
        const r = snapPoint(T(el('a', 103, 205, 50, 50)), { x: 98, y: 203 }, both);
        expect(r).toMatchObject({ dx: 2, dy: -3 }); // 103 and 205 are in reach but off-grid: 100, 200
    });
    it('draws the align guide when a grid line beyond the pull distance lines up with a target', () => {
        // 20 pt grid: the left edge (287) is 7 from c's (280), out of a guide's reach, but the grid lands there.
        const t = T(el('c', 280, 400, 50, 50)), box = { x: 287, y: 600, w: 20, h: 20 };
        const r = snapMove(t, box, { grid: 20, guides: true, threshold: 6 });
        expect(r.dx).toBeCloseTo(-7);
        expect(r.guides).toContainEqual({ kind: 'align', axis: 'x', at: 280, from: 400, to: 620 });
        expect(snapMove(t, box, { grid: 20, guides: false, threshold: 6 }).guides).toEqual([]);
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
