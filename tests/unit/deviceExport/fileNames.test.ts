import { describe, expect, it } from 'vitest';
import { MAX_NAME_LENGTH, createNameAllocator, slugify } from '../../../services/deviceExport/fileNames';

describe('slugify', () => {
    it('keeps readable ASCII and drops what devices reject', () => {
        expect(slugify('Jan 1: Plan?', 'x')).toBe('Jan_1_Plan');
        expect(slugify('a\\b/c*d"e<f>g|h', 'x')).toBe('abcdefgh');
        expect(slugify('Café  déjà vu', 'x')).toBe('Cafe_deja_vu');
        expect(slugify('../secret', 'x')).toBe('secret');
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
});
