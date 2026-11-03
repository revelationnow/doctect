import { describe, it, expect } from 'vitest';
import { buildSnapTargets } from '../../../services/snapping/targets';
import { snapResize } from '../../../services/snapping/snap';
import type { SnapSettings } from '../../../services/snapping/types';
import type { TemplateElement } from '../../../types';

const el = (id: string, x: number, y: number, w: number, h: number) =>
    ({ id, type: 'rect', x, y, w, h, rotation: 0, fill: '', stroke: '', strokeWidth: 0, opacity: 1 }) as TemplateElement;
const T = (...elements: TemplateElement[]) =>
    buildSnapTargets({ elements, excludeIds: [], page: { w: 1000, h: 1000 }, nodes: {}, currentNodeId: 'root' });
const guides: SnapSettings = { grid: null, guides: true, threshold: 6 };
const both: SnapSettings = { grid: 10, guides: true, threshold: 6 };
const square = { square: true };
const sizeGuides = (r: { guides: { kind: string }[] }) => r.guides.filter(g => g.kind === 'size');

// A rect or ellipse whose width and height come within the pull distance snaps square, with a
// "= N" label on its width side and its height side (two size guides on the shape itself).
describe('square snap on resize', () => {
    it('a single dragged edge takes the other dimension', () => {
        const r = snapResize(T(), { x: 100, y: 100, w: 97, h: 100 }, { x: 'max', y: null }, guides, square);
        expect(r.dx).toBeCloseTo(3); expect(r.dy).toBe(0);
        expect(sizeGuides(r)).toEqual([
            { kind: 'size', axis: 'x', size: 100, boxes: [{ x: 100, y: 100, w: 100, h: 100 }] },
            { kind: 'size', axis: 'y', size: 100, boxes: [{ x: 100, y: 100, w: 100, h: 100 }] },
        ]);
    });
    it('a dragged min edge moves the other way', () => {
        const r = snapResize(T(), { x: 103, y: 100, w: 97, h: 100 }, { x: 'min', y: null }, guides, square);
        expect(r.dx).toBeCloseTo(-3); // left 103 -> 100, width 100
    });
    it('does nothing outside the pull distance, or when square is off', () => {
        expect(snapResize(T(), { x: 100, y: 100, w: 93, h: 100 }, { x: 'max', y: null }, guides, square)).toMatchObject({ dx: 0, guides: [] });
        expect(snapResize(T(), { x: 100, y: 100, w: 97, h: 100 }, { x: 'max', y: null }, guides)).toMatchObject({ dx: 0, guides: [] });
    });
    it('a corner drag with no other win adjusts the height to the width', () => {
        const r = snapResize(T(), { x: 100, y: 100, w: 98, h: 103 }, { x: 'max', y: 'max' }, guides, square);
        expect(r.dx).toBe(0); expect(r.dy).toBeCloseTo(-5);
        expect(sizeGuides(r)).toHaveLength(2);
        expect(sizeGuides(r)[0]).toMatchObject({ size: 98, boxes: [{ x: 100, y: 100, w: 98, h: 98 }] });
    });
    it('a corner drag keeps the axis that aligned and squares the other to it', () => {
        // Right edge 197 -> a's right edge 200 (align): the width becomes 100 and the height follows it.
        const r = snapResize(T(el('a', 150, 500, 50, 50)), { x: 100, y: 100, w: 97, h: 103 }, { x: 'max', y: 'max' }, guides, square);
        expect(r.dx).toBeCloseTo(3); expect(r.dy).toBeCloseTo(-3);
        expect(r.guides).toContainEqual(expect.objectContaining({ kind: 'align', axis: 'x', at: 200 }));
        expect(sizeGuides(r)).toHaveLength(2);
    });
    it('a corner drag with a size match on one axis squares the other to the matched size', () => {
        // Width 97 -> a's width 100 (size match, 3 away); the height (103) then needs -3 to follow, not -6.
        const r = snapResize(T(el('a', 500, 500, 100, 30)), { x: 100, y: 100, w: 97, h: 103 }, { x: 'max', y: 'max' }, guides, square);
        expect(r.dx).toBeCloseTo(3); expect(r.dy).toBeCloseTo(-3);
        // One label per side: the size match's own label would duplicate the square's width label.
        expect(sizeGuides(r)).toHaveLength(2);
    });
    it('beats another object\'s size whenever it is in reach, even when the size match is closer', () => {
        // Height 97: a's height 94 and the square (100) are both 3 away -> square.
        expect(snapResize(T(el('a', 500, 500, 50, 94)), { x: 100, y: 100, w: 100, h: 97 }, { x: null, y: 'max' }, guides, square).dy).toBeCloseTo(3);
        // a's height 95 is only 2 away: the square still wins, a tier above size matching.
        const r = snapResize(T(el('a', 500, 500, 50, 95)), { x: 100, y: 100, w: 100, h: 97 }, { x: null, y: 'max' }, guides, square);
        expect(r.dy).toBeCloseTo(3);
        expect(sizeGuides(r)).toHaveLength(2);
    });
    it('loses to an edge alignment in reach, even a farther one', () => {
        // Bottom 197 -> b's top 194 (align) and the square (200) are both 3 away -> align.
        const r = snapResize(T(el('b', 300, 194, 50, 50)), { x: 100, y: 100, w: 100, h: 97 }, { x: null, y: 'max' }, guides, square);
        expect(r.dy).toBeCloseTo(-3);
        expect(sizeGuides(r)).toEqual([]);
        // b's top at 192 is 5 away and the square 3: alignment still wins.
        expect(snapResize(T(el('b', 300, 192, 50, 50)), { x: 100, y: 100, w: 100, h: 97 }, { x: null, y: 'max' }, guides, square).dy).toBeCloseTo(-5);
    });
    it('with Snap to grid on, squares only when the dragged edge stays on the grid', () => {
        // Right edge 202 -> square would be 205 (off-grid): the grid takes it to 200.
        expect(snapResize(T(), { x: 105, y: 100, w: 97, h: 100 }, { x: 'max', y: null }, both, square).dx).toBeCloseTo(-2);
        // Right edge 197 -> square 200 is on the grid: it wins, with its labels.
        const r = snapResize(T(), { x: 100, y: 100, w: 97, h: 100 }, { x: 'max', y: null }, both, square);
        expect(r.dx).toBeCloseTo(3); expect(sizeGuides(r)).toHaveLength(2);
    });
});
