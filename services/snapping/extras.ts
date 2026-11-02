import { RANK_SIZE, RANK_SPACING, nextNeighbour, previousNeighbour, type SnapTargets } from './targets';
import { type Axis, type Box, type EdgeSide, type Guide, hi, len, lo, other } from './types';
import { better, nearestIndex, type Win } from './core';

const crossMid = (p: Box, q: Box, axis: Axis) => {
    const c = other(axis);
    return (Math.max(lo(p, c), lo(q, c)) + Math.min(hi(p, c), hi(q, c))) / 2;
};
const segment = (first: Box, second: Box, axis: Axis) => ({ at: crossMid(first, second, axis), from: hi(first, axis), to: lo(second, axis) });

/** Equal spacing for a moving box: centre it between its neighbours, or repeat a gap already on the page. */
export function spacingWin(T: SnapTargets, b: Box, a: Axis, threshold: number): Win | null {
    const prev = previousNeighbour(T, b, a, lo(b, a) + threshold);
    const next = nextNeighbour(T, b, a, hi(b, a) - threshold);
    let best: Win | null = null;
    const consider = (delta: number, make: (fb: Box) => Guide) => {
        if (Math.abs(delta) > threshold) return;
        const c: Win = { delta, rank: RANK_SPACING, kind: 'spacing', make };
        if (better(c, best)) best = c;
    };
    if (prev && next && prev !== next) {
        const target = (hi(prev, a) + lo(next, a) - len(b, a)) / 2;
        const gap = target - hi(prev, a);
        if (gap >= 0) consider(target - lo(b, a), fb => ({ kind: 'spacing', axis: a, gap,
            segments: [segment(prev, fb, a), segment(fb, next, a)] }));
    }
    const gaps = T.gaps[a];
    if (prev) {
        const current = lo(b, a) - hi(prev, a);
        const j = nearestIndex(gaps.values, current);
        if (j >= 0) {
            const g = gaps.values[j], [p0, p1] = gaps.pairs[j];
            consider(g - current, fb => ({ kind: 'spacing', axis: a, gap: g, segments: [segment(prev, fb, a), segment(p0, p1, a)] }));
        }
    }
    if (next) {
        const current = lo(next, a) - hi(b, a);
        const j = nearestIndex(gaps.values, current);
        if (j >= 0) {
            const g = gaps.values[j], [p0, p1] = gaps.pairs[j];
            consider(current - g, fb => ({ kind: 'spacing', axis: a, gap: g, segments: [segment(fb, next, a), segment(p0, p1, a)] }));
        }
    }
    return best;
}

/** Size matching for a resize: the dimension being dragged snaps to another object's width/height. */
export function sizeWin(T: SnapTargets, b: Box, a: Axis, edge: EdgeSide, threshold: number): Win | null {
    const sizes = a === 'x' ? T.w : T.h;
    const i = nearestIndex(sizes.values, len(b, a));
    if (i < 0) return null;
    const diff = sizes.values[i] - len(b, a);
    if (Math.abs(diff) > threshold) return null;
    const size = sizes.values[i];
    return { delta: edge === 'max' ? diff : -diff, rank: RANK_SIZE, kind: 'size',
        make: fb => ({ kind: 'size', axis: a, size, boxes: [fb, ...sizes.sources[i].slice(0, 3)] }) };
}
