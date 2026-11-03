import { describe, it, expect } from 'vitest';
import { computeResizedBox, rightAngleAabb, worldEdgesForHandle } from '../../../services/snapping/resize';

describe('resize geometry', () => {
    it('matches the canvas math for an unrotated east drag', () => {
        expect(computeResizedBox({ x: 10, y: 20, w: 100, h: 50 }, 'e', 7, 0)).toEqual({ x: 10, y: 20, w: 107, h: 50 });
    });
    it('keeps the minimum size when dragging west past the far edge', () => {
        const b = computeResizedBox({ x: 10, y: 20, w: 100, h: 50 }, 'w', 200, 0);
        expect(b.w).toBe(5); expect(b.x).toBeCloseTo(105);
    });
    it('maps handles to world edges through right-angle rotations', () => {
        expect(worldEdgesForHandle('e', 0)).toEqual({ x: 'max', y: null });
        expect(worldEdgesForHandle('e', 90)).toEqual({ x: null, y: 'max' });
        expect(worldEdgesForHandle('nw', 180)).toEqual({ x: 'max', y: 'max' });
        expect(worldEdgesForHandle('s', 270)).toEqual({ x: 'max', y: null });
    });
    it('swaps width and height for quarter turns about the centre', () => {
        expect(rightAngleAabb({ x: 200, y: 300, w: 100, h: 40 }, 90)).toEqual({ x: 230, y: 270, w: 40, h: 100 });
        expect(rightAngleAabb({ x: 200, y: 300, w: 100, h: 40 }, 180)).toEqual({ x: 200, y: 300, w: 100, h: 40 });
    });
});
