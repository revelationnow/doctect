import { describe, expect, it } from 'vitest';
import { loadStickerPressScope, runStickerPressGenerator } from './stickerPressScope';

const scope = loadStickerPressScope(['builders', 'svgMarkup', 'DEVICES']);

const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9 .,-]+$/;

const TAB_BUILDERS: Array<[string, unknown[]]> = [
    ['tab', ['rounded', false]], ['tab', ['square', true]], ['tab', ['angled', false]],
    ['flag', ['swallow']], ['flag', ['point']], ['flag', ['straight']],
    ['bookmark', [true]], ['cornerTriangle', [false]], ['dogEar', [2]],
    ['banner', [true, false]], ['pennant', [true]], ['scroll', [2]], ['rosette', [12]],
    ['tape', [true]], ['tag', [true]], ['stickyNote', ['lined']], ['speechBubble', ['left']],
];

describe('sticker press structural builders', () => {
    it.each(TAB_BUILDERS)('%s produces valid path data', (name, args) => {
        const result = scope.builders[name](...(args as unknown[]));
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
        expect(result).toMatch(PATH_DATA);
    });

    it.each(TAB_BUILDERS)('%s stays inside the 24x24 viewBox', (name, args) => {
        const result = scope.builders[name](...(args as unknown[]));
        const numbers = result.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
        expect(Math.min(...numbers)).toBeGreaterThanOrEqual(0);
        expect(Math.max(...numbers)).toBeLessThanOrEqual(24);
    });

    it.each(TAB_BUILDERS)('%s fits the markup byte budget', (name, args) => {
        const markup = scope.svgMarkup(scope.builders[name](...(args as unknown[])), '#f0c674', '#23292f');
        expect(Buffer.byteLength(markup, 'utf8')).toBeLessThanOrEqual(400);
    });

    it.each(TAB_BUILDERS)('%s is deterministic', (name, args) => {
        expect(scope.builders[name](...(args as unknown[])))
            .toBe(scope.builders[name](...(args as unknown[])));
    });
});
