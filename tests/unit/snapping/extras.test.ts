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
