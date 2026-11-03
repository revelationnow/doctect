import { round2 } from './types';

export type ArrowKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

export const isArrowKey = (key: string): key is ArrowKey =>
    key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown';

/**
 * How far an arrow key moves the selection. Snap off: 1 pt, Shift 10 pt. Snap on: to the next grid
 * line in that direction (one full step when already on a line), Shift for ten steps. `start` is the
 * selection box's left (horizontal keys) or top (vertical keys); `grid` null = snapping off.
 */
export function nudgeDelta(key: ArrowKey, shift: boolean, start: number, grid: number | null): number {
    const dir = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
    if (!grid) return dir * (shift ? 10 : 1);
    const eps = 1e-6;
    const first = dir > 0 ? (Math.floor(start / grid + eps) + 1) * grid : (Math.ceil(start / grid - eps) - 1) * grid;
    return round2(first - start + dir * ((shift ? 10 : 1) - 1) * grid);
}
