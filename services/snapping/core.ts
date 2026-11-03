import type { Box, Guide } from './types';

/** One candidate correction on one axis. `make` draws its guide once the final box is known. */
export interface Win { delta: number; rank: number; kind: 'align' | 'spacing' | 'size' | 'square' | 'grid'; make?: (finalBox: Box) => Guide }

/** Whether a correction of `delta` may win. With Snap to grid on: only one that keeps the grid's feature on a grid line. */
export type Accept = (delta: number) => boolean;

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

/**
 * The nearest value within `threshold` on either side of `v` (one or two indices): both are candidates, so
 * equal distances tie-break by rank. A value `accept` rejects is skipped for the next one out on its side.
 */
export function bracket(values: number[], v: number, threshold = Infinity, accept: Accept | null = null): number[] {
    const l = lowerIndex(values, v), out: number[] = [];
    const first = (from: number, step: number) => {
        for (let i = from; i >= 0 && i < values.length; i += step) {
            const d = values[i] - v;
            if (Math.abs(d) > threshold) return;
            if (!accept || accept(d)) { out.push(i); return; }
        }
    };
    first(l - 1, -1); first(l, 1);
    return out;
}

/** Closer wins; at the same distance the lower rank (edge, centre, page, spacing, size) wins. */
export const better = (c: Win, best: Win | null) => !best
    || Math.abs(c.delta) < Math.abs(best.delta) - 1e-9
    || (Math.abs(Math.abs(c.delta) - Math.abs(best.delta)) <= 1e-9 && c.rank < best.rank);
