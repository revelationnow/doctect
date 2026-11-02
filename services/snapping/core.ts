import type { Box, Guide } from './types';

/** One candidate correction on one axis. `make` draws its guide once the final box is known. */
export interface Win { delta: number; rank: number; kind: 'align' | 'spacing' | 'size' | 'grid'; make?: (finalBox: Box) => Guide }

const lowerIndex = (values: number[], v: number) => {
    let l = 0, h = values.length;
    while (l < h) { const m = (l + h) >> 1; if (values[m] < v) l = m + 1; else h = m; }
    return l;
};

/** Index of the value closest to `v` (-1 when empty). */
export function nearestIndex(values: number[], v: number): number {
    if (values.length === 0) return -1;
    const l = lowerIndex(values, v);
    if (l === 0) return 0;
    if (l === values.length) return l - 1;
    return v - values[l - 1] <= values[l] - v ? l - 1 : l;
}

/** The indices on either side of `v` (one or two): both are candidates, so equal distances tie-break by rank. */
export function bracket(values: number[], v: number): number[] {
    const l = lowerIndex(values, v);
    return [l - 1, l].filter(i => i >= 0 && i < values.length);
}

/** Closer wins; at the same distance the lower rank (edge, centre, page, spacing, size) wins. */
export const better = (c: Win, best: Win | null) => !best
    || Math.abs(c.delta) < Math.abs(best.delta) - 1e-9
    || (Math.abs(Math.abs(c.delta) - Math.abs(best.delta)) <= 1e-9 && c.rank < best.rank);
