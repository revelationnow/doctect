import type { AppState } from '../../types';

export const DEFAULT_GRID_SIZE = 10;
export const MIN_GRID_SIZE = 1;
export const MAX_GRID_SIZE = 200;
export const GRID_QUICK_PICKS = [2, 5, 10, 20] as const;

export const clampGridSize = (value: number): number => {
    if (!Number.isFinite(value)) return DEFAULT_GRID_SIZE;
    return Math.min(MAX_GRID_SIZE, Math.max(MIN_GRID_SIZE, Math.round(value * 2) / 2));
};

/** A typed grid size, clamped; null when the text is not a number (the field reverts). */
export const parseGridSize = (text: string): number | null => {
    const trimmed = text.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? clampGridSize(n) : null;
};

/** The snapping preferences with their defaults applied (stored projects may lack the newer two). */
export const snapSettingsOf = (state: Pick<AppState, 'snapToGrid' | 'showGrid' | 'gridSize' | 'smartGuides'>) => ({
    snapToGrid: !!state.snapToGrid,
    showGrid: !!state.showGrid,
    gridSize: clampGridSize(state.gridSize ?? DEFAULT_GRID_SIZE),
    smartGuides: state.smartGuides ?? true,
});

/** How far, in screen pixels, a guide pulls: wider for a finger. */
export const pullDistancePx = (input: 'mouse' | 'touch') => input === 'touch' ? 10 : 6;

const DISPLAY_MULTIPLIERS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
/** The drawn grid's spacing: the grid size, or a multiple once dots would sit closer than 8 screen px. */
export const gridDisplayStep = (gridSize: number, scale: number): number => {
    for (const m of DISPLAY_MULTIPLIERS) if (gridSize * m * scale >= 8) return gridSize * m;
    return gridSize * DISPLAY_MULTIPLIERS[DISPLAY_MULTIPLIERS.length - 1];
};
