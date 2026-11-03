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
    it('does not repeat a gap from a different row', () => {
        // c-d have a 30 gap at y 400; n is the only thing in the box's row and has nothing before it.
        // The box sits 32 after n: a page-wide gap index would pull it to 30, the row chain must not.
        const r = snapMove(T(el('c', 300, 400, 100, 50), el('d', 430, 400, 100, 50), el('n', 0, 0, 100, 50)),
            { x: 132, y: 0, w: 50, h: 50 }, s);
        expect(r.dx).toBe(0);
        expect(r.guides.some(g => g.kind === 'spacing')).toBe(false);
    });
    it('repeats the gap after the next neighbour when the box is before the row', () => {
        // a-b have a 30 gap; the box is 32 before a and moves right by 2 to match.
        const r = snapMove(T(el('a', 200, 0, 100, 50), el('b', 330, 0, 100, 50)), { x: 118, y: 0, w: 50, h: 50 }, s);
        expect(r.dx).toBeCloseTo(2);
        expect(r.guides.find(g => g.kind === 'spacing')).toEqual({ kind: 'spacing', axis: 'x', gap: 30,
            segments: [{ at: 25, from: 170, to: 200 }, { at: 25, from: 300, to: 330 }] });
    });
    it('with Snap to grid on, only an equal-spacing result on the grid wins', () => {
        const g = { grid: 10, guides: true, threshold: 6 };
        // Centred between a and b the box would sit at 175, off the 10 pt grid: the grid takes it to 170.
        const r = snapMove(T(el('a', 0, 0, 100, 50), el('b', 300, 0, 100, 50)), { x: 173, y: 0, w: 50, h: 50 }, g);
        expect(r.dx).toBeCloseTo(-3);
        expect(r.guides.some(g => g.kind === 'spacing')).toBe(false);
        // With b at 310 the centred position is 180, on the grid: it wins over the nearer grid line (170).
        const r2 = snapMove(T(el('a', 0, 0, 100, 50), el('b', 310, 0, 100, 50)), { x: 174, y: 0, w: 50, h: 50 }, g);
        expect(r2.dx).toBeCloseTo(6);
        expect(r2.guides.find(g => g.kind === 'spacing')).toMatchObject({ gap: 80 });
    });
    it('repeats a gap in a column on the y axis', () => {
        // a above b with a 30 gap; the box is 32 below b and moves up by 2.
        const r = snapMove(T(el('a', 0, 0, 50, 100), el('b', 0, 130, 50, 100)), { x: 0, y: 262, w: 50, h: 50 }, s);
        expect(r.dy).toBeCloseTo(-2);
        expect(r.guides.find(g => g.kind === 'spacing')).toEqual({ kind: 'spacing', axis: 'y', gap: 30,
            segments: [{ at: 25, from: 230, to: 260 }, { at: 25, from: 100, to: 130 }] });
    });
});

describe('size matching', () => {
    it('snaps a resized width to another object\'s width and labels only the resized box', () => {
        const r = snapResize(T(el('a', 0, 300, 120, 40)), { x: 400, y: 10, w: 117, h: 50 }, { x: 'max', y: null }, s);
        expect(r.dx).toBeCloseTo(3);
        expect(r.guides.find(g => g.kind === 'size')).toEqual({ kind: 'size', axis: 'x', size: 120, boxes: [{ x: 400, y: 10, w: 120, h: 50 }] });
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
