import { describe, it, expect } from 'vitest';
import { clampGridSize, formatGuideValue, gridDisplayStep, parseGridSize, pullDistancePx, snapSettingsOf } from '../../../services/snapping/settings';

describe('snapping settings', () => {
    it('defaults grid size to 10 and guides to on', () => {
        expect(snapSettingsOf({ snapToGrid: false, showGrid: false })).toEqual({ snapToGrid: false, showGrid: false, gridSize: 10, smartGuides: true });
        expect(snapSettingsOf({ snapToGrid: true, showGrid: true, gridSize: 20, smartGuides: false }).smartGuides).toBe(false);
    });
    it('clamps to 1–200 in steps of 0.5', () => {
        expect(clampGridSize(0)).toBe(1); expect(clampGridSize(500)).toBe(200);
        expect(clampGridSize(2.3)).toBe(2.5); expect(clampGridSize(7.74)).toBe(7.5); expect(clampGridSize(NaN)).toBe(10);
    });
    it('parses typed sizes, rejecting non-numbers', () => {
        expect(parseGridSize('12')).toBe(12); expect(parseGridSize(' 0.5 ')).toBe(1); expect(parseGridSize('900')).toBe(200);
        expect(parseGridSize('')).toBeNull(); expect(parseGridSize('abc')).toBeNull();
    });
    it('formats guide labels and grid sizes: whole points without decimals, else one decimal', () => {
        expect(formatGuideValue(12)).toBe('12'); expect(formatGuideValue(12.34)).toBe('12.3'); expect(formatGuideValue(11.96)).toBe('12');
        expect(formatGuideValue(2.5)).toBe('2.5');
    });
    it('pulls 6 px with a mouse and 10 px with touch', () => {
        expect(pullDistancePx('mouse')).toBe(6); expect(pullDistancePx('touch')).toBe(10);
    });
    it('thins the drawn grid until dots are at least 8 screen px apart', () => {
        expect(gridDisplayStep(10, 1)).toBe(10);
        expect(gridDisplayStep(10, 0.5)).toBe(20);   // 5 px apart -> every 2nd
        expect(gridDisplayStep(2, 0.5)).toBe(20);    // 1 px apart; 2x5 is still 5 px, so every 10th
        expect(gridDisplayStep(1, 4)).toBe(2);
    });
});
