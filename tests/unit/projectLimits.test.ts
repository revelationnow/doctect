import { describe, expect, it } from 'vitest';
import { MAX_STATE_BYTES, MAX_GENERATOR_OUTPUT_BYTES } from '../../shared/projectLimits.js';

describe('project limits', () => {
    it('allows a four-variant sticker book to be stored', () => {
        expect(MAX_STATE_BYTES).toBe(32 * 1024 * 1024);
    });

    it('bounds generator output separately from stored state', () => {
        expect(MAX_GENERATOR_OUTPUT_BYTES).toBe(32 * 1024 * 1024);
    });

    it('leaves headroom above the measured sticker book size', () => {
        // Measured: 13.16 MB of variant state plus ~4.24 MB of navigation chrome, ~17.4 MB total.
        const measuredStickerBookBytes = 17.4 * 1024 * 1024;
        expect(MAX_GENERATOR_OUTPUT_BYTES).toBeGreaterThan(measuredStickerBookBytes * 1.5);
    });
});
