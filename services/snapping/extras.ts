import { RANK_SIZE, RANK_SPACING, nextNeighbour, previousNeighbour, type SnapTargets } from './targets';
import { type Axis, type Box, type EdgeSide, type Guide, hi, len, lo, other } from './types';
import { type Accept, better, bracket, type Win } from './core';

const crossMid = (p: Box, q: Box, axis: Axis) => {
    const c = other(axis);
    return (Math.max(lo(p, c), lo(q, c)) + Math.min(hi(p, c), hi(q, c))) / 2;
};
const segment = (first: Box, second: Box, axis: Axis) => ({ at: crossMid(first, second, axis), from: hi(first, axis), to: lo(second, axis) });

/**
 * Equal spacing for a moving box: centre it between its two neighbours, or repeat the gap of its own
 * row or column: after `prev`, the gap between prev and previousNeighbour(prev); before `next`, the
 * gap between next and nextNeighbour(next). Only the neighbour chain the box sits in is consulted.
 * `accept` (the grid's on-grid test) can veto a candidate; the others still compete.
 */
export function spacingWin(T: SnapTargets, b: Box, a: Axis, threshold: number, accept: Accept | null = null): Win | null {
    const prev = previousNeighbour(T, b, a, lo(b, a) + threshold);
    const next = nextNeighbour(T, b, a, hi(b, a) - threshold);
    let best: Win | null = null;
    const consider = (delta: number, make: (fb: Box) => Guide) => {
        if (Math.abs(delta) > threshold || (accept && !accept(delta))) return;
        const c: Win = { delta, rank: RANK_SPACING, kind: 'spacing', make };
        if (better(c, best)) best = c;
    };
    if (prev && next && prev !== next) {
        const target = (hi(prev, a) + lo(next, a) - len(b, a)) / 2;
        const gap = target - hi(prev, a);
        if (gap >= 0) consider(target - lo(b, a), fb => ({ kind: 'spacing', axis: a, gap,
            segments: [segment(prev, fb, a), segment(fb, next, a)] }));
    }
    // Repeat a gap already in this row/column: the one between prev and its own previous neighbour, or
    // between next and its own next neighbour. A box overlapping the neighbour (current < 0) is not spaced.
    if (prev) {
        const pp = previousNeighbour(T, prev, a);
        const current = lo(b, a) - hi(prev, a);
        if (pp && current >= 0) {
            const g = lo(prev, a) - hi(pp, a);
            if (g > 0) consider(g - current, fb => ({ kind: 'spacing', axis: a, gap: g, segments: [segment(prev, fb, a), segment(pp, prev, a)] }));
        }
    }
    if (next) {
        const nn = nextNeighbour(T, next, a);
        const current = lo(next, a) - hi(b, a);
        if (nn && current >= 0) {
            const g = lo(nn, a) - hi(next, a);
            if (g > 0) consider(current - g, fb => ({ kind: 'spacing', axis: a, gap: g, segments: [segment(fb, next, a), segment(next, nn, a)] }));
        }
    }
    return best;
}

/**
 * Size matching for a resize: the dimension being dragged snaps to another object's width/height. A min
 * edge moves the opposite way to the size difference; `accept` judges that edge movement. The guide
 * labels the resized box only: a label on the matched object elsewhere on the page just confused.
 */
export function sizeWin(T: SnapTargets, b: Box, a: Axis, edge: EdgeSide, threshold: number, accept: Accept | null = null): Win | null {
    const sizes = (a === 'x' ? T.w : T.h).values, sign = edge === 'max' ? 1 : -1;
    const fits: Accept | null = accept && (diff => accept(sign * diff));
    let best: Win | null = null;
    for (const i of bracket(sizes, len(b, a), threshold, fits)) {
        const size = sizes[i];
        const c: Win = { delta: sign * (size - len(b, a)), rank: RANK_SIZE, kind: 'size',
            make: fb => ({ kind: 'size', axis: a, size, boxes: [fb] }) };
        if (better(c, best)) best = c;
    }
    return best;
}
