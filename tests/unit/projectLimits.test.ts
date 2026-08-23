import { describe, expect, it } from 'vitest';
import { MAX_STATE_BYTES, MAX_GENERATOR_OUTPUT_BYTES } from '../../shared/projectLimits.js';

describe('project limits', () => {
    it('allows a four-variant sticker book to be stored', () => {
        expect(MAX_STATE_BYTES).toBe(16 * 1024 * 1024);
    });

    it('bounds generator output separately from stored state', () => {
        expect(MAX_GENERATOR_OUTPUT_BYTES).toBe(16 * 1024 * 1024);
    });

    it('leaves headroom above the projected sticker book size', () => {
        const projectedStickerBookBytes = 9.65 * 1024 * 1024;
        expect(MAX_GENERATOR_OUTPUT_BYTES).toBeGreaterThan(projectedStickerBookBytes * 1.5);
    });
});
