import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadStickerPressScope } from './stickerPressScope';

const REGISTRY_PATH = 'gallery-samples/21-sticker-press/registry.json';
const TEMPLATES_PATH = 'gallery-samples/21-sticker-press/templates.js';

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

const scope = loadStickerPressScope([
    'DEVICES', 'COLOURWAYS', 'CATEGORY_ORDER', 'STICKER_ART',
    'planSheets', 'buildStickerElements', 'resetElementIds', 'nextElementId',
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
});
