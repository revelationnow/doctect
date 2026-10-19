import { describe, it, expect } from 'vitest';
import { PAGE_PRESETS } from '../../constants/editor';
import {
    CATEGORIES, INDEX_VERSION, categorize, deriveFacets, formatForSize, normalizeTag,
} from '../../shared/galleryFacets.js';

describe('normalizeTag', () => {
    it('folds case, spacing and simple plurals', () => {
        expect(normalizeTag(' Planners ')).toBe('planner');
        expect(normalizeTag('Habit Trackers')).toBe('habit-tracker');
        expect(normalizeTag('diaries')).toBe('diary');
    });

    it('leaves words that only look plural alone', () => {
        expect(normalizeTag('chess')).toBe('chess');
        expect(normalizeTag('focus')).toBe('focus');
        expect(normalizeTag('analysis')).toBe('analysis');
        expect(normalizeTag('dnd')).toBe('dnd');
    });
});

describe('categorize', () => {
    it('lets tags outweigh incidental words in the name', () => {
        expect(categorize(['garden', 'planting', 'vegetables', 'planner'], 'Garden Almanac')).toBe('home');
        expect(categorize(['habits', 'gamified', 'rpg', 'quests', 'motivation', 'tracker'], 'Habit Quest')).toBe('trackers');
        expect(categorize([], 'Weekly Planner 2027')).toBe('planners');
    });

    it('falls back to other', () => {
        expect(categorize(['zzz'], 'Untitled')).toBe('other');
        expect(categorize(undefined, undefined)).toBe('other');
    });

    it('never lists one keyword under two categories', () => {
        const all = CATEGORIES.flatMap(c => c.keywords);
        expect(new Set(all).size).toBe(all.length);
        for (const k of all) expect(normalizeTag(k)).toBe(k);
    });
});

describe('Note templates category', () => {
    it('is listed first, so it wins a score tie', () => {
        expect(CATEGORIES[0]).toMatchObject({ key: 'templates', label: 'Note templates', emoji: '📄' });
        expect(categorize([], 'Planner Template')).toBe('templates');
    });

    it('loses to a stronger score', () => {
        expect(categorize([], 'Weekly Planner Template')).toBe('planners');
        expect(categorize(['planner', 'weekly'], 'Planner Template')).toBe('planners');
    });

    it('matches template tags in their common spellings', () => {
        expect(categorize(['Templates'], 'Lined pages')).toBe('templates');
        expect(categorize(['dot-grid', 'paper'], 'Untitled')).toBe('templates');
        expect(categorize(['stationery'], '')).toBe('templates');
    });

    it('rebuilds the derived gallery index', () => {
        expect(INDEX_VERSION).toBe(2);
    });
});

describe('formatForSize', () => {
    it('maps every editor page preset to a named format, in either orientation', () => {
        for (const [key, preset] of Object.entries(PAGE_PRESETS)) {
            expect(formatForSize(preset.w, preset.h), key).not.toBe('custom');
            expect(formatForSize(preset.h, preset.w), key).toBe(formatForSize(preset.w, preset.h));
        }
    });

    it('calls anything else custom, and garbage null', () => {
        expect(formatForSize(500, 700)).toBe('custom');
        expect(formatForSize(NaN, 700)).toBeNull();
    });
});

describe('deriveFacets', () => {
    it('reads a pre-variant (schema v0) state with top-level templates', () => {
        const legacy = {
            nodes: { r: { id: 'r', parentId: null, type: 't', title: 'R', data: {}, children: ['c'] },
                c: { id: 'c', parentId: 'r', type: 't', title: 'C', data: {}, children: [] } },
            rootId: 'r',
            templates: { t: { id: 't', name: 'T', width: 612, height: 792, elements: [] } },
        };
        expect(deriveFacets(legacy, { name: 'Notes', tags: [] })).toEqual({ category: 'learning', formats: ['letter'], pageCount: 2 });
    });

    it('degrades unreadable states to listing-only facts instead of throwing', () => {
        expect(deriveFacets(null, { name: 'Chess drills', tags: [] })).toEqual({ category: 'games', formats: [], pageCount: null });
        expect(deriveFacets({ nodes: 'nope', variants: 5 }, { name: '', tags: [] }))
            .toEqual({ category: 'other', formats: [], pageCount: null });
        const cyclic = { nodes: { a: { id: 'a', type: 'x', children: ['a'] } }, rootId: 'a', variants: {} };
        expect(deriveFacets(cyclic, { name: '', tags: [] }).pageCount).toBe(1);
    });
});
