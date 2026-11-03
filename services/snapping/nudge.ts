import { round2 } from './types';

export type ArrowKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

export const isArrowKey = (key: string): key is ArrowKey =>
    key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown';

/**
 * How far an arrow key moves the selection. Snap off: 1 pt, Shift 10 pt. Snap on: to the next grid
 * line in that direction (one full step when already on a line), Shift for ten steps. `start` is the
 * selection box's left (horizontal keys) or top (vertical keys); `grid` null = snapping off.
 *
 * A start within 0.005 pt of a line (half of `round2`'s resolution, so anything that would display as
 * on the line) counts as on it, and the delta is to the rounded destination, so the edge lands exactly
 * on the line however many decimals the start carries. Never 0 (or -0): there is always a next line.
 */
export function nudgeDelta(key: ArrowKey, shift: boolean, start: number, grid: number | null): number {
    const dir = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
    const steps = shift ? 10 : 1;
    if (!grid) return dir * steps;
    const eps = 0.005 / grid;
    const q = start / grid;
    const line = dir > 0 ? Math.floor(q + eps) + steps : Math.ceil(q - eps) - steps;
    return round2(line * grid) - start || 0;
}
