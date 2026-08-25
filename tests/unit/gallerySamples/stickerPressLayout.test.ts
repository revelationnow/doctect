import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadStickerPressScope } from './stickerPressScope';

const REGISTRY_PATH = 'gallery-samples/21-sticker-press/registry.json';
const TEMPLATES_PATH = 'gallery-samples/21-sticker-press/templates.js';
const MANIFEST_PATH = 'gallery-samples/21-sticker-press/vendor/manifest.json';

type Source = 'lucide' | 'twemoji';
interface Entry {
    id: string;
    name: string;
    cat: string;
    source: Source;
    upstream: string;
    keywords: string[];
}

const registry = (): Entry[] => JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
const manifest = (): { icons: Array<{ id: string; source: string; licence: string }> } =>
    JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));

const scope = loadStickerPressScope([
    'DEVICES', 'COLOURWAYS', 'CATEGORY_ORDER', 'STICKER_ART', 'STICKER_KEYWORDS',
    'planSheets', 'buildStickerElements', 'resetElementIds', 'nextElementId',
    'SIDE_MARGIN', 'TOP_MARGIN', 'BOTTOM_MARGIN', 'PER_SHEET',
    'buildRail', 'buildSwitcher', 'buildIndexPages', 'buildCreditsPage',
]);

const DEVICE_IDS = ['paper_pro', 'move', 'note_air', 'pure'];
const device = (id: string) => scope.DEVICES.find((d: any) => d.id === id);

describe('sticker press sheet layout — data', () => {
    it('STICKER_ART carries every registry entry exactly once, keyed by id', () => {
        const entries = registry();
        expect(Object.keys(scope.STICKER_ART).sort()).toEqual(entries.map(e => e.id).sort());
    });

    it('CATEGORY_ORDER covers exactly the categories registry.json declares', () => {
        const entries = registry();
        expect(new Set(scope.CATEGORY_ORDER)).toEqual(new Set(entries.map(e => e.cat)));
        expect(scope.CATEGORY_ORDER).toHaveLength(new Set(scope.CATEGORY_ORDER).size); // no repeats
    });

    it('colourway hexes match the fixed palette exactly', () => {
        const byId = Object.fromEntries(scope.COLOURWAYS.map((c: any) => [c.id, c.hex]));
        expect(byId).toEqual({
            outline: '#23292f',
            amber: '#f0c674',
            green: '#86c08e',
            blue: '#5b93c4',
            red: '#b04a46',
            ink: '#3d4650',
        });
    });
});

describe('sticker press sheet layout — placement', () => {
    it.each(DEVICE_IDS)('%s places every Lucide sticker in all 6 colourways and every Twemoji sticker once', id => {
        const entries = registry();
        const lucideCount = entries.filter(e => e.source === 'lucide').length;
        const twemojiCount = entries.filter(e => e.source === 'twemoji').length;

        const sheets = scope.planSheets(device(id));
        const placed = new Set<string>();
        sheets.forEach((sheet: any) => sheet.clusters.forEach((cluster: any) => {
            placed.add(`${cluster.sticker.id}:${sheet.colourway ?? 'full-colour'}`);
        }));
        expect(placed.size).toBe(lucideCount * 6 + twemojiCount * 1);
    });

    it.each(DEVICE_IDS)('%s keeps every cluster cell inside the page', id => {
        const profile = device(id);
        const sheets = scope.planSheets(profile);
        expect(sheets.length).toBeGreaterThan(0);
        sheets.forEach((sheet: any) => {
            expect(sheet.clusters.length).toBeGreaterThan(0);
            sheet.clusters.forEach((cluster: any) => cluster.cells.forEach((cell: any) => {
                expect(cell.x).toBeGreaterThanOrEqual(0);
                expect(cell.y).toBeGreaterThanOrEqual(0);
                expect(cell.x + cell.size).toBeLessThanOrEqual(profile.width);
                expect(cell.y + cell.size).toBeLessThanOrEqual(profile.height);
            }));
        });
    });

    it.each(DEVICE_IDS)('%s fills its own full page on a full sheet — same membership as move, different geometry', id => {
        const profile = device(id);
        const sheets = scope.planSheets(profile);
        // study-work is 100% Lucide with 43 entries, so its first page (the
        // shared PER_SHEET boundary) is full on every device.
        const sheet = sheets.find((s: any) => s.category === 'study-work' && s.colourway === 'outline' && !s.id.includes('_p'));
        expect(sheet).toBeTruthy();
        expect(sheet.clusters.length).toBe(scope.PER_SHEET);

        const artworkBottomEdge = Math.max(...sheet.clusters.flatMap((c: any) => c.cells.map((cell: any) => cell.y + cell.size)));
        const rightEdge = Math.max(...sheet.clusters.flatMap((c: any) => c.cells.map((cell: any) => cell.x + cell.size)));
        // The stretched gutter formula fills the usable area exactly, on
        // every device — not just the one (move) that defines PER_SHEET.
        expect(rightEdge).toBeCloseTo(profile.width - scope.SIDE_MARGIN, 5);
        expect(artworkBottomEdge).toBeLessThanOrEqual(profile.height - scope.BOTTOM_MARGIN);
    });

    it('paper_pro, note_air and pure now use more of their page than a naive per-device pagination would (regression guard)', () => {
        // Before the fix, a full study-work outline page on paper_pro used
        // only ~5 of its 8 natural rows (21 of 40 natural capacity), stopping
        // around y=24+5*64+4*8=376 rather than reaching the reserved bottom
        // margin near y=659. Assert the *label* row (the true bottom of
        // content) now lands close to the reserved bottom margin instead.
        ['paper_pro', 'note_air', 'pure'].forEach(id => {
            const profile = device(id);
            const sheets = scope.planSheets(profile);
            const sheet = sheets.find((s: any) => s.category === 'study-work' && s.colourway === 'outline' && !s.id.includes('_p'));
            const lastCluster = sheet.clusters[sheet.clusters.length - 1];
            const bottomOfLastCluster = Math.max(...lastCluster.cells.map((c: any) => c.y + c.size));
            const usableBottom = profile.height - scope.BOTTOM_MARGIN;
            // Within one label-gutter's worth of the true reserved edge.
            expect(usableBottom - bottomOfLastCluster).toBeLessThan(20);
        });
    });

    it('every cluster has exactly 2 cells — the furniture band (3 cells) no longer exists; Lucide and Twemoji both use the 2-size ladder', () => {
        const sheets = scope.planSheets(device('paper_pro'));
        sheets.forEach((sheet: any) => sheet.clusters.forEach((cluster: any) => {
            expect(cluster.cells).toHaveLength(2);
        }));
    });

    it('cells within a cluster are largest-first and bottom-aligned', () => {
        const sheets = scope.planSheets(device('paper_pro'));
        sheets.forEach((sheet: any) => sheet.clusters.forEach((cluster: any) => {
            const [first, second] = cluster.cells;
            expect(first.size).toBeGreaterThan(second.size);
            expect(first.y + first.size).toBe(second.y + second.size); // shared bottom edge
        }));
    });

    it('Twemoji sheets carry no colourway duplication', () => {
        const sheets = scope.planSheets(device('paper_pro'));
        const twemojiSheets = sheets.filter((s: any) => s.source === 'twemoji');
        expect(twemojiSheets.length).toBeGreaterThan(0);
        twemojiSheets.forEach((sheet: any) => expect(sheet.colourway).toBeNull());

        const seen = new Map<string, number>();
        twemojiSheets.forEach((sheet: any) => sheet.clusters.forEach((cluster: any) => {
            seen.set(cluster.sticker.id, (seen.get(cluster.sticker.id) ?? 0) + 1);
        }));
        const twemojiCount = registry().filter(e => e.source === 'twemoji').length;
        expect(seen.size).toBe(twemojiCount);
        [...seen.values()].forEach(count => expect(count).toBe(1));
    });

    it('sheet ids are unique within a device', () => {
        DEVICE_IDS.forEach(id => {
            const sheets = scope.planSheets(device(id));
            const ids = sheets.map((s: any) => s.id);
            expect(new Set(ids).size).toBe(ids.length);
        });
    });

    it('all four variants expose an identical sheet id set (Global Constraint — sheet ids become template ids)', () => {
        const idSets = DEVICE_IDS.map(id => scope.planSheets(device(id)).map((s: any) => s.id).sort());
        const serialized = idSets.map((ids: string[]) => JSON.stringify(ids));
        expect(new Set(serialized).size).toBe(1);
        // Sanity: this only proves something if pagination actually differs in
        // capacity across devices, which it does (move is far narrower).
        expect(idSets[0].length).toBeGreaterThan(0);
    });

    it('labels each sticker exactly once per device: the reference (first) colourway sheet for Lucide, always for Twemoji', () => {
        const profile = device('paper_pro');
        const sheets = scope.planSheets(profile);
        const labelCounts = new Map<string, number>();
        sheets.forEach((sheet: any) => {
            if (!sheet.labelled) return;
            sheet.clusters.forEach((cluster: any) => {
                labelCounts.set(cluster.sticker.id, (labelCounts.get(cluster.sticker.id) ?? 0) + 1);
            });
        });
        const entries = registry();
        expect(labelCounts.size).toBe(entries.length);
        [...labelCounts.values()].forEach(count => expect(count).toBe(1));

        // Only the outline (first) colourway is labelled for Lucide.
        const labelledLucideColourways = new Set(
            sheets.filter((s: any) => s.source === 'lucide' && s.labelled).map((s: any) => s.colourway),
        );
        expect(labelledLucideColourways).toEqual(new Set(['outline']));
    });
});

describe('sticker press sheet layout — element construction', () => {
    it('produces deterministic element ids across independent runs', () => {
        const profile = device('paper_pro');
        const sheet = scope.planSheets(profile)[0];
        scope.resetElementIds();
        const first = scope.buildStickerElements(profile, sheet).map((e: any) => e.id);
        scope.resetElementIds();
        const second = scope.buildStickerElements(profile, sheet).map((e: any) => e.id);
        expect(first).toEqual(second);
        expect(first.length).toBeGreaterThan(0);
        expect(new Set(first).size).toBe(first.length);
    });

    it('never uses Math.random for element ids', () => {
        const source = readFileSync(TEMPLATES_PATH, 'utf8');
        expect(source).not.toContain('Math.random');
    });

    it('emits only svg and text elements — no rects or boxes around a cluster (crop hygiene)', () => {
        const profile = device('paper_pro');
        scope.resetElementIds();
        scope.planSheets(profile).forEach((sheet: any) => {
            scope.buildStickerElements(profile, sheet).forEach((el: any) => {
                expect(['svg', 'text']).toContain(el.type);
            });
        });
    });

    it('resolves {{STROKE}} to the sheet colourway for Lucide svg elements', () => {
        const profile = device('paper_pro');
        scope.resetElementIds();
        const sheet = scope.planSheets(profile).find((s: any) => s.source === 'lucide' && s.colourway === 'amber');
        const elements = scope.buildStickerElements(profile, sheet);
        const svgs = elements.filter((e: any) => e.type === 'svg');
        expect(svgs.length).toBeGreaterThan(0);
        svgs.forEach((element: any) => {
            expect(element.svgContent).toMatch(/viewBox="[^"]+"/);
            expect(element.svgContent).not.toMatch(/<svg[^>]*\swidth=/);
            expect(element.svgContent).not.toMatch(/<svg[^>]*\sheight=/);
            expect(element.svgContent).not.toContain('{{STROKE}}');
            expect(element.svgContent).toContain('#f0c674');
        });
    });

    it('never recolours Twemoji artwork', () => {
        const profile = device('paper_pro');
        scope.resetElementIds();
        const sheet = scope.planSheets(profile).find((s: any) => s.source === 'twemoji');
        const elements = scope.buildStickerElements(profile, sheet);
        const svgs = elements.filter((e: any) => e.type === 'svg');
        expect(svgs.length).toBeGreaterThan(0);
        svgs.forEach((element: any) => {
            expect(element.svgContent).not.toContain('{{STROKE}}');
            expect(element.svgContent).toMatch(/viewBox="[^"]+"/);
        });
    });

    it('labels sit below the artwork with clearance, never overlapping a cell', () => {
        const profile = device('paper_pro');
        scope.resetElementIds();
        const sheet = scope.planSheets(profile).find((s: any) => s.labelled);
        const elements = scope.buildStickerElements(profile, sheet);
        const labels = elements.filter((e: any) => e.type === 'text');
        expect(labels.length).toBe(sheet.clusters.length);
        // One label per cluster, emitted in cluster order (cells then label,
        // per cluster) — pair by index rather than by x, since neighbouring
        // rows share the same column x values.
        sheet.clusters.forEach((cluster: any, index: number) => {
            const bottomOfArt = Math.max(...cluster.cells.map((c: any) => c.y + c.size));
            const label = labels[index];
            expect(label.x).toBeCloseTo(cluster.x, 5);
            expect(label.text).toBe(cluster.sticker.name);
            expect(label.y).toBeGreaterThan(bottomOfArt);
        });
    });

    // Carried finding from Task D's review: the placement suite above bounds-checks
    // artwork CELLS but never the text elements buildStickerElements actually emits —
    // and labels are exactly what clipped on `move` before the textOverflow:'shrink'
    // fix. This closes that gap, and folds in Task E's new rail/switcher chips too,
    // since they are also text elements that must stay inside the reserved margins.
    it.each(DEVICE_IDS)('%s keeps every element — sticker svg, sticker label, rail chip, switcher chip — inside the page', id => {
        const profile = device(id);
        scope.resetElementIds();
        const sheets = scope.planSheets(profile);
        expect(sheets.length).toBeGreaterThan(0);
        sheets.forEach((sheet: any) => {
            const elements = [
                ...scope.buildStickerElements(profile, sheet),
                ...scope.buildRail(profile, sheet),
                ...scope.buildSwitcher(profile, sheet),
            ];
            expect(elements.length).toBeGreaterThan(0);
            elements.forEach((el: any) => {
                expect(['svg', 'text']).toContain(el.type);
                expect(el.x, `${sheet.id} ${el.type} ${el.id} x`).toBeGreaterThanOrEqual(0);
                expect(el.y, `${sheet.id} ${el.type} ${el.id} y`).toBeGreaterThanOrEqual(0);
                expect(el.x + el.w, `${sheet.id} ${el.type} ${el.id} right edge`).toBeLessThanOrEqual(profile.width + 1e-6);
                expect(el.y + el.h, `${sheet.id} ${el.type} ${el.id} bottom edge`).toBeLessThanOrEqual(profile.height + 1e-6);
            });
        });
    });
});

describe('sticker press navigation chrome — category rail', () => {
    it('carries all 17 category chips on the wide devices, in canonical CATEGORY_ORDER', () => {
        ['paper_pro', 'note_air', 'pure'].forEach(id => {
            const profile = device(id);
            scope.resetElementIds();
            const sheet = scope.planSheets(profile)[0];
            const chips = scope.buildRail(profile, sheet);
            expect(chips).toHaveLength(scope.CATEGORY_ORDER.length);
            expect(chips).toHaveLength(17);
        });
    });

    it('gives move a reduced rail that still always includes the sheet\'s own current category', () => {
        const profile = device('move');
        scope.resetElementIds();
        const sheets = scope.planSheets(profile);
        sheets.filter((s: any) => s.labelled).forEach((sheet: any) => {
            const chips = scope.buildRail(profile, sheet);
            expect(chips.length).toBeLessThanOrEqual(8);
            expect(chips.length).toBeGreaterThan(1);
            const current = chips.filter((c: any) => c.fontWeight === 'bold');
            expect(current).toHaveLength(1);
            // The active chip always names the CURRENT sheet's own category — its
            // target is that category's canonical home page, which for a mixed
            // Lucide+Twemoji category is the Lucide-outline reference sheet even
            // when the sheet being viewed right now is the Twemoji one.
            const target = sheets.find((s: any) => s.id === current[0].linkValue);
            expect(target.category).toBe(sheet.category);
        });
    });

    it('every rail chip is an unfilled text chip (no fill, no stroke) with a link that resolves to a real sheet of its own category', () => {
        const profile = device('paper_pro');
        scope.resetElementIds();
        const sheets = scope.planSheets(profile);
        const sheet = sheets.find((s: any) => s.labelled);
        const chips = scope.buildRail(profile, sheet);
        expect(chips.length).toBeGreaterThan(0);
        chips.forEach((c: any) => {
            expect(c.fill).toBe('');
            expect(c.stroke).toBe('');
            expect(c.text.length).toBeGreaterThan(0);
            expect(c.linkTarget).toBe('specific_node');
            const destination = sheets.find((s: any) => s.id === c.linkValue);
            expect(destination, `rail chip '${c.text}' -> '${c.linkValue}'`).toBeTruthy();
            expect(destination.labelled).toBe(true);
        });
    });

    it('marks exactly the current sheet\'s own category chip as active, on every labelled sheet, including paginated continuation pages', () => {
        const profile = device('paper_pro');
        scope.resetElementIds();
        const sheets = scope.planSheets(profile);
        sheets.filter((s: any) => s.labelled).forEach((sheet: any) => {
            const chips = scope.buildRail(profile, sheet);
            const active = chips.filter((c: any) => c.fontWeight === 'bold');
            expect(active).toHaveLength(1);
            const activeTarget = sheets.find((s: any) => s.id === active[0].linkValue);
            expect(activeTarget.category).toBe(sheet.category);
        });
        // A page-2 continuation sheet keeps the same category, so the rail
        // must still highlight it correctly there too.
        const continuation = sheets.find((s: any) => s.id.endsWith('_p2'));
        expect(continuation).toBeTruthy();
        const chips = scope.buildRail(profile, continuation);
        const active = chips.filter((c: any) => c.fontWeight === 'bold');
        expect(active).toHaveLength(1);
        expect(sheets.find((s: any) => s.id === active[0].linkValue).category).toBe(continuation.category);
    });
});

describe('sticker press navigation chrome — colourway switcher', () => {
    it('gives a Lucide sheet 6 colourway chips (self included) plus a Credits chip, all resolving within the same category', () => {
        const profile = device('paper_pro');
        scope.resetElementIds();
        const sheets = scope.planSheets(profile);
        const sheet = sheets.find((s: any) => s.source === 'lucide' && s.labelled);
        const chips = scope.buildSwitcher(profile, sheet);

        const colourwayChips = chips.filter((c: any) => c.linkValue !== 'credits');
        expect(colourwayChips).toHaveLength(6);
        colourwayChips.forEach((c: any) => {
            expect(c.fill).toBe('');
            const destination = sheets.find((s: any) => s.id === c.linkValue);
            expect(destination, `switcher chip '${c.text}' -> '${c.linkValue}'`).toBeTruthy();
            expect(destination.category).toBe(sheet.category);
        });
        expect(new Set(colourwayChips.map((c: any) => c.text)).size).toBe(6);
        const current = colourwayChips.filter((c: any) => c.fontWeight === 'bold');
        expect(current).toHaveLength(1);
        expect(current[0].linkValue).toBe(sheet.id);

        const creditsChip = chips.find((c: any) => c.linkValue === 'credits');
        expect(creditsChip).toBeTruthy();
        expect(creditsChip.fill).toBe('');
    });

    it('preserves a paginated category\'s page suffix when switching colourway', () => {
        const profile = device('paper_pro');
        scope.resetElementIds();
        const sheets = scope.planSheets(profile);
        // study-work is all-Lucide with 43 entries — more than one page.
        const page2 = sheets.find((s: any) => s.category === 'study-work' && s.colourway === 'outline' && s.id.endsWith('_p2'));
        expect(page2).toBeTruthy();
        const chips = scope.buildSwitcher(profile, page2).filter((c: any) => c.linkValue !== 'credits');
        chips.forEach((c: any) => expect(c.linkValue).toMatch(/_p2$/));
    });

    it('gives a Twemoji sheet a full-colour note instead of colourway chips, plus a Credits chip — no dead-end fill', () => {
        const profile = device('paper_pro');
        scope.resetElementIds();
        const sheets = scope.planSheets(profile);
        const sheet = sheets.find((s: any) => s.source === 'twemoji');
        const chips = scope.buildSwitcher(profile, sheet);
        expect(chips.every((c: any) => c.fill === '')).toBe(true);
        expect(chips.some((c: any) => /full colour/i.test(c.text))).toBe(true);
        expect(chips.some((c: any) => c.linkTarget === 'specific_node' && c.linkValue !== 'credits')).toBe(false);
        expect(chips.some((c: any) => c.linkValue === 'credits')).toBe(true);
    });
});

describe('sticker press navigation chrome — A-Z and keyword indexes', () => {
    it('A-Z index carries every one of the 500 stickers exactly once, alphabetically, each resolving to its labelled sheet', () => {
        const profile = device('paper_pro');
        scope.resetElementIds();
        const sheets = scope.planSheets(profile);
        const pages = scope.buildIndexPages('alpha').paper_pro;
        expect(pages.length).toBeGreaterThan(0);

        const rows = pages.flatMap((p: any) => p.elements.slice(1)); // [0] is the page title
        expect(rows).toHaveLength(500);
        const names = rows.map((r: any) => r.text);
        expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));

        rows.forEach((row: any) => {
            expect(row.fill).toBe('');
            expect(row.linkTarget).toBe('specific_node');
            const destination = sheets.find((s: any) => s.id === row.linkValue);
            expect(destination, `A-Z row '${row.text}' -> '${row.linkValue}'`).toBeTruthy();
            expect(destination.labelled).toBe(true);
        });
    });

    it('keyword index groups keywords alphabetically, and every entry resolves to a labelled sheet', () => {
        const profile = device('paper_pro');
        scope.resetElementIds();
        const sheets = scope.planSheets(profile);
        const pages = scope.buildIndexPages('keyword').paper_pro;
        expect(pages.length).toBeGreaterThan(0);

        const rows = pages.flatMap((p: any) => p.elements.slice(1));
        expect(rows.length).toBeGreaterThan(0);
        const labels = rows.map((r: any) => r.text);
        expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));

        rows.forEach((row: any) => {
            expect(row.fill).toBe('');
            expect(row.linkTarget).toBe('specific_node');
            const destination = sheets.find((s: any) => s.id === row.linkValue);
            expect(destination, `keyword row '${row.text}' -> '${row.linkValue}'`).toBeTruthy();
            expect(destination.labelled).toBe(true);
        });
    });

    it('every device produces the identical page id set for both indexes (Global Constraint)', () => {
        ['alpha', 'keyword'].forEach(kind => {
            scope.resetElementIds();
            const byDevice = scope.buildIndexPages(kind);
            const idSets = DEVICE_IDS.map(id => byDevice[id].map((p: any) => p.id).sort().join(','));
            expect(new Set(idSets).size).toBe(1);
        });
    });

    it('drops off-context inherited keywords from the index (e.g. a medical-themed sticker keeps no cybersecurity/antivirus tag)', () => {
        scope.resetElementIds();
        const rows = scope.buildIndexPages('keyword').paper_pro.flatMap((p: any) => p.elements.slice(1));
        const rawLabels = rows.map((r: any) => r.text as string);
        const labels = rawLabels.map(l => l.toUpperCase());
        expect(labels.some(l => l.startsWith('ANTIVIRUS'))).toBe(false);
        expect(labels.some(l => l.startsWith('CYBERSECURITY'))).toBe(false);
        expect(labels.some(l => l.startsWith('VPN'))).toBe(false);
        // 'admin' is dropped from the shield trio specifically (bundled with
        // the same software-security jargon cluster) but survives overall
        // because lucide-lock / lucide-lock-keyhole legitimately carry it —
        // a padlock literally illustrates "admin-only" access.
        const adminRow = rawLabels.find(l => l.toUpperCase().startsWith('ADMIN'));
        expect(adminRow).toBeTruthy();
        expect(adminRow).not.toMatch(/\bShield\b/);
        // But a literally-accurate, jargon-*sounding* keyword survives.
        expect(labels.some(l => l.startsWith('WIFI'))).toBe(true);
        expect(labels.some(l => l.startsWith('NOTIFICATION'))).toBe(true);
    });
});

describe('sticker press navigation chrome — credits', () => {
    it('carries both halves of the Lucide notice and the Twemoji attribution', () => {
        scope.resetElementIds();
        const page = scope.buildCreditsPage().paper_pro;
        const text = page.elements.map((e: any) => e.text).join('\n');
        expect(text).toContain('ISC License');
        expect(text).toContain('Lucide Contributors');
        expect(text).toContain('Cole Bemis');
        expect(text).toContain('MIT License');
        expect(text).toContain('CC-BY 4.0');
        expect(text).toContain('Twitter, Inc');
    });

    it('is present, correctly sized, for all four devices', () => {
        scope.resetElementIds();
        const byDevice = scope.buildCreditsPage();
        DEVICE_IDS.forEach(id => {
            const profile = device(id);
            const page = byDevice[id];
            expect(page.id).toBe('credits');
            expect(page.width).toBe(profile.width);
            expect(page.height).toBe(profile.height);
            page.elements.forEach((el: any) => {
                expect(el.x).toBeGreaterThanOrEqual(0);
                expect(el.y).toBeGreaterThanOrEqual(0);
                expect(el.x + el.w).toBeLessThanOrEqual(profile.width + 1e-6);
                expect(el.y + el.h).toBeLessThanOrEqual(profile.height + 1e-6);
            });
        });
    });

    // Attribution completeness, driven from vendor/manifest.json (not hardcoded)
    // — this is what makes the licence obligation structural rather than
    // remembered. If a new source/licence is ever vendored without updating
    // buildCreditsPage(), this fails.
    it('fails if a source contributes a sticker but is not credited (driven from vendor/manifest.json)', () => {
        const licences = new Set(manifest().icons.map(i => i.licence));
        expect(licences.size).toBeGreaterThan(0);

        const REQUIRED_SUBSTRINGS: Record<string, string[]> = {
            ISC: ['ISC License', 'Lucide Contributors'],
            MIT: ['MIT License', 'Cole Bemis'],
            'CC-BY-4.0': ['CC-BY 4.0', 'Twitter, Inc'],
        };
        licences.forEach(licence => {
            expect(REQUIRED_SUBSTRINGS[licence], `no required-substring rule for licence '${licence}' — add one`).toBeTruthy();
        });

        scope.resetElementIds();
        const text = scope.buildCreditsPage().paper_pro.elements.map((e: any) => e.text).join('\n');
        licences.forEach(licence => {
            REQUIRED_SUBSTRINGS[licence].forEach(substring => {
                expect(text, `credits page missing '${substring}' for licence '${licence}'`).toContain(substring);
            });
        });
    });

    it('reports real sticker counts, not hardcoded ones', () => {
        const entries = registry();
        const lucideCount = entries.filter(e => e.source === 'lucide').length;
        const twemojiCount = entries.filter(e => e.source === 'twemoji').length;
        scope.resetElementIds();
        const text = scope.buildCreditsPage().paper_pro.elements.map((e: any) => e.text).join('\n');
        expect(text).toContain(`${entries.length} stickers`);
        expect(text).toContain(`${lucideCount} icons`);
        expect(text).toContain(`${twemojiCount} graphics`);
    });
});
