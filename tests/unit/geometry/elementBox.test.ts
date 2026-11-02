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
