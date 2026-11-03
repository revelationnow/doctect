import { describe, it, expect } from 'vitest';
import { sameGuides, type Guide } from '../../../services/snapping/types';

const align: Guide = { kind: 'align', axis: 'x', at: 100, from: 0, to: 400 };
const distance: Guide = { kind: 'distance', axis: 'y', at: 100, from: 100, to: 300 };
const spacing: Guide = { kind: 'spacing', axis: 'x', gap: 30, segments: [{ at: 25, from: 100, to: 130 }, { at: 25, from: 230, to: 260 }] };
const size: Guide = { kind: 'size', axis: 'x', size: 120, boxes: [{ x: 0, y: 300, w: 120, h: 40 }] };

describe('sameGuides', () => {
    it('is true for the same list, a structural copy, and two empty lists', () => {
        const list = [align, distance, spacing, size];
        expect(sameGuides(list, list)).toBe(true);
        expect(sameGuides(list, JSON.parse(JSON.stringify(list)))).toBe(true);
        expect(sameGuides([], [])).toBe(true);
    });
    it('is false when the length, kind, axis, a position, a label or a box differs', () => {
        expect(sameGuides([align], [align, distance])).toBe(false);
        expect(sameGuides([align], [{ ...align, kind: 'distance' }])).toBe(false);
        expect(sameGuides([align], [{ ...align, axis: 'y' }])).toBe(false);
        expect(sameGuides([align], [{ ...align, to: 401 }])).toBe(false);
        expect(sameGuides([spacing], [{ ...spacing, gap: 31 }])).toBe(false);
        expect(sameGuides([spacing], [{ ...spacing, segments: [spacing.segments[0], { ...spacing.segments[1], to: 261 }] }])).toBe(false);
        expect(sameGuides([spacing], [{ ...spacing, segments: spacing.segments.slice(0, 1) }])).toBe(false);
        expect(sameGuides([size], [{ ...size, size: 121 }])).toBe(false);
        expect(sameGuides([size], [{ ...size, boxes: [{ ...size.boxes[0], w: 121 }] }])).toBe(false);
    });
});
