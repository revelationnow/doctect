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
        expect(nudgeDelta('ArrowRight', false, 1.2, 0.5)).toBe(0.3);
    });
});
