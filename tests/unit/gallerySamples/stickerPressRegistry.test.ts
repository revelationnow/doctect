import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const REGISTRY_PATH = 'gallery-samples/21-sticker-press/registry.json';
const MANIFEST_PATH = 'gallery-samples/21-sticker-press/vendor/manifest.json';

type Source = 'lucide' | 'twemoji' | 'furniture';
interface Entry {
    id: string;
    name: string;
    cat: string;
    source: Source;
    upstream: string;
    keywords: string[];
}

const registry = (): Entry[] => JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
const manifest = () => JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));

// The 17 categories and their curated counts. The house-drawn furniture band
// (50 entries, 3 of these categories) was dropped entirely after a human
// review of the full contact sheet found it padded with argument-variation
// near-duplicates (three scalloped seals differing only in scallop count,
// three rosettes differing only in petal count, a "medal disc" that was a
// circle) while the sourced Lucide/Twemoji pages read well. Categories 1-3
// (index-tabs-flags, banners-ribbons, labels-tape) were re-sourced from real
// Lucide/Twemoji marker, tab, flag, ribbon and label artwork; banners-ribbons
// could not be filled to a sensible size on its own (no literal "ribbon
// bunting" or "wax seal" exists in either source — only two Twemoji ribbon
// emoji total) and was merged into labels-tape rather than padded with
// near-duplicates. The resulting shortfall against the old 50-entry band was
// backfilled into categories with genuine spare supply of good, distinct,
// under-cap candidates. See taskB-report.md for the full account.
const EXPECTED_CATEGORY_COUNTS: Record<string, number> = {
    'index-tabs-flags': 15,
    'labels-tape': 17,
    'arrows-pointers': 36,
    'boxes-bullets-markers': 33,
    'stars-sparkles-awards': 27,
    'dividers-corners-frames': 27,
    'weather-sky': 28,
    botanical: 23,
    animals: 34,
    'food-drink': 37,
    'faces-moods': 24,
    'study-work': 43,
    'health-self-care': 30,
    'travel-places': 31,
    'celebration-seasons': 27,
    'money-home': 38,
    'symbols-misc': 30,
};

describe('sticker press registry', () => {
    it('has exactly 500 entries', () => {
        expect(registry()).toHaveLength(500);
    });

    it('is sourced entirely from Lucide and Twemoji — no furniture — split 330/170', () => {
        const r = registry();
        expect(r.filter(e => e.source === 'furniture')).toHaveLength(0);
        expect(r.filter(e => e.source === 'lucide')).toHaveLength(330);
        expect(r.filter(e => e.source === 'twemoji')).toHaveLength(170);
    });

    it('covers exactly the 17 expected categories, with counts summing to 500 and matching membership', () => {
        const r = registry();
        const cats = Object.keys(EXPECTED_CATEGORY_COUNTS);
        expect(cats).toHaveLength(17);
        expect(Object.values(EXPECTED_CATEGORY_COUNTS).reduce((a, b) => a + b, 0)).toBe(500);

        const actualCats = new Set(r.map(e => e.cat));
        expect([...actualCats].sort()).toEqual([...cats].sort());

        cats.forEach(cat => {
            const actual = r.filter(e => e.cat === cat).length;
            expect(actual, `category ${cat}`).toBe(EXPECTED_CATEGORY_COUNTS[cat]);
        });
    });

    it('has unique ids and unique names', () => {
        const r = registry();
        expect(new Set(r.map(e => e.id)).size).toBe(r.length);
        expect(new Set(r.map(e => e.name)).size).toBe(r.length);
    });

    it('gives every entry a manifest counterpart, and no orphans either way', () => {
        const r = registry();
        const m = manifest();
        const manifestIds = new Set(m.icons.map((i: any) => i.id));

        r.forEach(e => {
            expect(manifestIds.has(e.id), `registry entry ${e.id} has no manifest counterpart`).toBe(true);
        });

        const registryIds = new Set(r.map(e => e.id));
        m.icons.forEach((i: any) => {
            expect(registryIds.has(i.id), `manifest entry ${i.id} is not named by the registry`).toBe(true);
        });
    });

    it('gives every entry at least one keyword', () => {
        registry().forEach(e => {
            expect(Array.isArray(e.keywords), e.id).toBe(true);
            expect(e.keywords.length, `${e.id} keywords`).toBeGreaterThan(0);
            e.keywords.forEach(k => expect(typeof k, `${e.id} keyword`).toBe('string'));
        });
    });

    it('names every sticker for a human — no raw codepoints, no kebab-case leaking through', () => {
        const HEX_CODEPOINT = /^[0-9a-f]{4,7}$/i;
        const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)+$/; // all-lowercase, hyphen-joined, no spaces
        registry().forEach(e => {
            expect(HEX_CODEPOINT.test(e.name), `${e.id} name "${e.name}" looks like a raw codepoint`).toBe(false);
            expect(KEBAB_CASE.test(e.name), `${e.id} name "${e.name}" looks like kebab-case`).toBe(false);
            // A human name has at least one letter and starts capitalised.
            expect(/[a-zA-Z]/.test(e.name), `${e.id} name "${e.name}" has no letters`).toBe(true);
            expect(e.name[0], `${e.id} name "${e.name}" should start capitalised`).toBe(e.name[0].toUpperCase());
        });
    });

    it('every entry’s id is prefixed by its source', () => {
        registry().forEach(e => {
            expect(e.id.startsWith(`${e.source}-`), e.id).toBe(true);
        });
    });
});
