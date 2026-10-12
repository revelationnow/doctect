import { describe, expect, it } from 'vitest';
import { MAX_NAME_LENGTH, createNameAllocator, slugify } from '../../../services/deviceExport/fileNames';

describe('slugify', () => {
    it('keeps readable ASCII and drops what devices reject', () => {
        expect(slugify('Jan 1: Plan?', 'x')).toBe('Jan_1_Plan');
        expect(slugify('a\\b/c*d"e<f>g|h', 'x')).toBe('abcdefgh');
        expect(slugify('Café  déjà vu', 'x')).toBe('Cafe_deja_vu');
        expect(slugify('../secret', 'x')).toBe('secret');
    });

    it('keeps hyphens (guards the accent-stripping range against collapsing to [-])', () => {
        expect(slugify('Dot-grid page', 'x')).toBe('Dot-grid_page');
    });

    it('falls back when nothing usable is left', () => {
        expect(slugify('日記', 'page-3')).toBe('page-3');
        expect(slugify('🎉🎉', 'page-1')).toBe('page-1');
        expect(slugify('???', 'page-2')).toBe('page-2');
        expect(slugify('   ', 'page-4')).toBe('page-4');
    });

    it('caps the length', () => {
        expect(slugify('a'.repeat(200), 'x')).toHaveLength(MAX_NAME_LENGTH);
    });
});

describe('createNameAllocator', () => {
    it('de-duplicates case-insensitively, never reusing a name', () => {
        const next = createNameAllocator();
        expect(['Day', 'day', 'Day-2', 'Day'].map(next)).toEqual(['Day', 'day-2', 'Day-2-2', 'Day-3']);
    });

    it('keeps de-duplicated names within MAX_NAME_LENGTH', () => {
        const next = createNameAllocator();
        const long = slugify('a'.repeat(200), 'x');
        const first = next(long);
        const second = next(long);
        expect(first).toHaveLength(MAX_NAME_LENGTH);
        expect(second).toBe(`${'a'.repeat(MAX_NAME_LENGTH - 2)}-2`);
        expect(second.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
        expect(second.toLowerCase()).not.toBe(first.toLowerCase());
    });

    it('drops trailing punctuation left where the base is cut for the suffix', () => {
        const next = createNameAllocator();
        const base = `${'a'.repeat(MAX_NAME_LENGTH - 3)}-xy`; // 80 chars; the cut lands right after the dash
        next(base);
        expect(next(base)).toBe(`${'a'.repeat(MAX_NAME_LENGTH - 3)}-2`);
    });
});
