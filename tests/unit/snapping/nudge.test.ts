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
        expect(nudgeDelta('ArrowRight', false, 1.2, 0.5)).toBeCloseTo(0.3);
    });
    it('lands exactly on the line from off-grid starts, treating within 0.005 pt of a line as on it', () => {
        const lands = (key: 'ArrowLeft' | 'ArrowRight', start: number, grid: number, line: number) =>
            expect(start + nudgeDelta(key, false, start, grid)).toBeCloseTo(line, 9);
        lands('ArrowRight', 23.4927, 10, 30);
        lands('ArrowRight', 19.9987, 10, 30); // just below 20: on it, so the next line is 30
        lands('ArrowRight', 19.99873, 10, 30); // a 30° 100×50 box dragged to x 20 has this AABB.x
        lands('ArrowRight', 19.996, 10, 30);
        lands('ArrowLeft', 20.00323, 10, 10);
        lands('ArrowRight', 40.000000000000004, 10, 50);
        lands('ArrowRight', 1.5000000000000002, 0.5, 2);
    });
    it('never answers a press with zero or negative zero', () => {
        const left = nudgeDelta('ArrowLeft', false, 20.004, 10);
        expect(20.004 + left).toBeCloseTo(10, 9);
        expect(left).toBeLessThan(0); expect(Object.is(left, -0)).toBe(false);
        expect(nudgeDelta('ArrowRight', false, 19.99873, 10)).toBeGreaterThan(0);
    });
});
