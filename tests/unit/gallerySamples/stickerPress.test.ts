import { readFileSync, statSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { GENERATOR_SCRIPT_MAX_BYTES } from '../../../shared/generatorMetadata.js';
import { MAX_STATE_BYTES } from '../../../shared/projectLimits.js';
import { CURRENT_SCHEMA_VERSION } from '../../../services/migration';
import { computePageOrder } from '../../../services/pdfService';
import {
    expectValidGallerySample,
    loadGallerySample,
    type GallerySampleContract,
    type LoadedGallerySample,
} from '../../helpers/gallerySampleHarness';
import { loadStickerPressScope } from './stickerPressScope';

const SAMPLE_DIR = 'gallery-samples/21-sticker-press';
const TEMPLATES_PATH = `${SAMPLE_DIR}/templates.js`;
const HIERARCHY_PATH = `${SAMPLE_DIR}/hierarchy.js`;
const REGISTRY_PATH = `${SAMPLE_DIR}/registry.json`;
const MANIFEST_PATH = `${SAMPLE_DIR}/vendor/manifest.json`;
const VENDOR_DIR = `${SAMPLE_DIR}/vendor`;

// Generated from a real run of the assembled generator (scratch/dump_template_ids.mjs) —
// not hand-maintained. 190 = 10 front-matter/workspace pages + 6 A-Z index pages + 21
// keyword index pages + 153 sticker sheets. Regenerate this list (and the counts above)
// if templates.js's registry, category set or index pagination ever changes.
const EXPECTED_TEMPLATE_IDS = [
    'cover',
    'start_here',
    'credits',
    'contents',
    'colour_guide',
    'example_workspace',
    'example_workspace_annotated',
    'blank_workspace',
    'blank_workspace_dots',
    'blank_workspace_ruled',
    'alpha_index_1',
    'alpha_index_2',
    'alpha_index_3',
    'alpha_index_4',
    'alpha_index_5',
    'alpha_index_6',
    'keyword_index_1',
    'keyword_index_2',
    'keyword_index_3',
    'keyword_index_4',
    'keyword_index_5',
    'keyword_index_6',
    'keyword_index_7',
    'keyword_index_8',
    'keyword_index_9',
    'keyword_index_10',
    'keyword_index_11',
    'keyword_index_12',
    'keyword_index_13',
    'keyword_index_14',
    'keyword_index_15',
    'keyword_index_16',
    'keyword_index_17',
    'keyword_index_18',
    'keyword_index_19',
    'keyword_index_20',
    'keyword_index_21',
    'index-tabs-flags_outline',
    'index-tabs-flags_amber',
    'index-tabs-flags_green',
    'index-tabs-flags_blue',
    'index-tabs-flags_red',
    'index-tabs-flags_ink',
    'index-tabs-flags_twemoji',
    'labels-tape_outline',
    'labels-tape_amber',
    'labels-tape_green',
    'labels-tape_blue',
    'labels-tape_red',
    'labels-tape_ink',
    'labels-tape_twemoji',
    'arrows-pointers_outline',
    'arrows-pointers_outline_p2',
    'arrows-pointers_amber',
    'arrows-pointers_amber_p2',
    'arrows-pointers_green',
    'arrows-pointers_green_p2',
    'arrows-pointers_blue',
    'arrows-pointers_blue_p2',
    'arrows-pointers_red',
    'arrows-pointers_red_p2',
    'arrows-pointers_ink',
    'arrows-pointers_ink_p2',
    'boxes-bullets-markers_outline',
    'boxes-bullets-markers_outline_p2',
    'boxes-bullets-markers_amber',
    'boxes-bullets-markers_amber_p2',
    'boxes-bullets-markers_green',
    'boxes-bullets-markers_green_p2',
    'boxes-bullets-markers_blue',
    'boxes-bullets-markers_blue_p2',
    'boxes-bullets-markers_red',
    'boxes-bullets-markers_red_p2',
    'boxes-bullets-markers_ink',
    'boxes-bullets-markers_ink_p2',
    'stars-sparkles-awards_outline',
    'stars-sparkles-awards_outline_p2',
    'stars-sparkles-awards_amber',
    'stars-sparkles-awards_amber_p2',
    'stars-sparkles-awards_green',
    'stars-sparkles-awards_green_p2',
    'stars-sparkles-awards_blue',
    'stars-sparkles-awards_blue_p2',
    'stars-sparkles-awards_red',
    'stars-sparkles-awards_red_p2',
    'stars-sparkles-awards_ink',
    'stars-sparkles-awards_ink_p2',
    'dividers-corners-frames_outline',
    'dividers-corners-frames_outline_p2',
    'dividers-corners-frames_amber',
    'dividers-corners-frames_amber_p2',
    'dividers-corners-frames_green',
    'dividers-corners-frames_green_p2',
    'dividers-corners-frames_blue',
    'dividers-corners-frames_blue_p2',
    'dividers-corners-frames_red',
    'dividers-corners-frames_red_p2',
    'dividers-corners-frames_ink',
    'dividers-corners-frames_ink_p2',
    'weather-sky_outline',
    'weather-sky_amber',
    'weather-sky_green',
    'weather-sky_blue',
    'weather-sky_red',
    'weather-sky_ink',
    'weather-sky_twemoji',
    'botanical_outline',
    'botanical_amber',
    'botanical_green',
    'botanical_blue',
    'botanical_red',
    'botanical_ink',
    'botanical_twemoji',
    'animals_twemoji',
    'animals_twemoji_p2',
    'food-drink_outline',
    'food-drink_amber',
    'food-drink_green',
    'food-drink_blue',
    'food-drink_red',
    'food-drink_ink',
    'food-drink_twemoji',
    'food-drink_twemoji_p2',
    'faces-moods_twemoji',
    'faces-moods_twemoji_p2',
    'study-work_outline',
    'study-work_outline_p2',
    'study-work_outline_p3',
    'study-work_amber',
    'study-work_amber_p2',
    'study-work_amber_p3',
    'study-work_green',
    'study-work_green_p2',
    'study-work_green_p3',
    'study-work_blue',
    'study-work_blue_p2',
    'study-work_blue_p3',
    'study-work_red',
    'study-work_red_p2',
    'study-work_red_p3',
    'study-work_ink',
    'study-work_ink_p2',
    'study-work_ink_p3',
    'health-self-care_outline',
    'health-self-care_amber',
    'health-self-care_green',
    'health-self-care_blue',
    'health-self-care_red',
    'health-self-care_ink',
    'health-self-care_twemoji',
    'travel-places_outline',
    'travel-places_amber',
    'travel-places_green',
    'travel-places_blue',
    'travel-places_red',
    'travel-places_ink',
    'travel-places_twemoji',
    'celebration-seasons_outline',
    'celebration-seasons_amber',
    'celebration-seasons_green',
    'celebration-seasons_blue',
    'celebration-seasons_red',
    'celebration-seasons_ink',
    'celebration-seasons_twemoji',
    'money-home_outline',
    'money-home_outline_p2',
    'money-home_amber',
    'money-home_amber_p2',
    'money-home_green',
    'money-home_green_p2',
    'money-home_blue',
    'money-home_blue_p2',
    'money-home_red',
    'money-home_red_p2',
    'money-home_ink',
    'money-home_ink_p2',
    'money-home_twemoji',
    'symbols-misc_outline',
    'symbols-misc_outline_p2',
    'symbols-misc_amber',
    'symbols-misc_amber_p2',
    'symbols-misc_green',
    'symbols-misc_green_p2',
    'symbols-misc_blue',
    'symbols-misc_blue_p2',
    'symbols-misc_red',
    'symbols-misc_red_p2',
    'symbols-misc_ink',
    'symbols-misc_ink_p2',
    'symbols-misc_twemoji',
];

const contract: GallerySampleContract = {
    slug: '21-sticker-press',
    expectedTemplateIds: EXPECTED_TEMPLATE_IDS,
    pageCount: [190, 190],
    palette: ['#f0c674', '#86c08e', '#5b93c4', '#b04a46', '#3d4650', '#23292f'],
    requiredStableNodeIds: ['root', 'start_here', 'example_workspace', 'blank_workspace'],
    expectedVariants: {
        paper_pro: { width: 509, height: 679 },
        move: { width: 260, height: 463 },
        note_air: { width: 446, height: 595 },
        pure: { width: 447, height: 596 },
    },
};

describe('The Sticker Press gallery sample', () => {
    it('generates all four device variants with an identical 190-page tree', () => {
        const sample = expectValidGallerySample(contract.slug, contract);
        const exportedPageCount = computePageOrder({ rootId: sample.rootId, nodes: sample.nodes } as any).length;

        expect(exportedPageCount).toBe(190);
        expect(sample.variants.map(v => v.id).sort()).toEqual(['move', 'note_air', 'paper_pro', 'pure']);
        expect(sample.activeVariantId).toBe('paper_pro');
    });

    it('orders the front matter cover, start_here, credits, contents, colour_guide', () => {
        const sample = loadGallerySample(contract.slug);
        const order: string[] = [];
        const walk = (id: string) => {
            order.push(id);
            (sample.nodes[id]?.children || []).forEach(walk);
        };
        walk(sample.rootId);

        expect(order.slice(0, 10)).toEqual([
            'root', 'start_here', 'credits', 'contents', 'colour_guide',
            'example_workspace', 'example_workspace_annotated',
            'blank_workspace', 'blank_workspace_dots', 'blank_workspace_ruled',
        ]);
        expect(sample.nodes.root.type).toBe('cover');
        // Credits sits right after start_here (user decision 2026-08-25) — not at the back.
        expect(order.indexOf('credits')).toBe(order.indexOf('start_here') + 1);
    });

    it('keeps the credits page reachable from every sheet footer', () => {
        const sample = loadGallerySample(contract.slug);
        const sheetIds = Object.keys(sample.templates).filter(id => !/^(cover|start_here|credits|contents|colour_guide|example_workspace.*|blank_workspace.*|alpha_index_\d+|keyword_index_\d+)$/.test(id));

        expect(sheetIds.length).toBe(153);
        sheetIds.forEach(templateId => {
            const elements = sample.templates[templateId].elements;
            const creditsLink = elements.find((element: any) => element.linkTarget === 'specific_node' && element.linkValue === 'credits');
            expect(creditsLink, `${templateId} footer Credits link`).toBeTruthy();
        });
    });
});

// Task G: product guards. An earlier round of this project shipped unusable
// artwork through 220 green tests — the assertions below exist to catch what
// a passing suite would otherwise hide (silent recolouring, a surviving
// template token, a missing licence notice, a budget quietly exceeded), not
// to re-prove things the structural harness and stickerPressLayout.test.ts's
// scope-level tests already cover.
describe('The Sticker Press product guards', () => {
    // Built exactly once and shared by every assertion below. The full
    // four-variant document is ~24 MB of state with ~17,000 svg/text
    // elements; an earlier draft of this task plan called the generator
    // once per assertion, which would have rebuilt it fourteen times for no
    // benefit, since nothing here mutates the sample.
    let sample: LoadedGallerySample;
    // svgContent depends only on (sticker id, colourway) — never on device —
    // so the same ~2,150 distinct strings (330 Lucide x 6 colourways + 170
    // Twemoji, full colour) recur across all four variants and ~17,000
    // placements. Deduplicating up front lets every hygiene/content check
    // below examine each distinct string once instead of every placement.
    let svgContentsByVariant: Record<string, Set<string>>;
    let allSvgContents: Set<string>;

    beforeAll(() => {
        sample = loadGallerySample(contract.slug);
        svgContentsByVariant = {};
        allSvgContents = new Set();
        sample.variants.forEach(variant => {
            const contents = new Set<string>();
            Object.values(variant.templates).forEach((template: any) => {
                template.elements.forEach((element: any) => {
                    if (element.type === 'svg' && typeof element.svgContent === 'string') {
                        contents.add(element.svgContent);
                        allSvgContents.add(element.svgContent);
                    }
                });
            });
            svgContentsByVariant[variant.id] = contents;
        });
    });

    // --- Budgets -------------------------------------------------------
    // The state cap is 32 MiB and the script cap is a hard 512 KiB
    // (shared/projectLimits.js MAX_STATE_BYTES, shared/generatorMetadata.js
    // GENERATOR_SCRIPT_MAX_BYTES) — both enforced by the real
    // import/generation pipeline, not just convention. Each guard below
    // checks the real hard cap (must never be crossed, or the product
    // literally cannot generate or import) AND a tighter soft ceiling picked
    // to fail with real runway left before that wall.

    it('serialises the full four-variant state comfortably under the 32 MiB state cap', () => {
        const variants: Record<string, unknown> = {};
        sample.variants.forEach(variant => {
            variants[variant.id] = { id: variant.id, name: variant.name, templates: variant.templates };
        });
        const state = {
            nodes: sample.nodes,
            rootId: sample.rootId,
            variants,
            activeVariantId: sample.activeVariantId,
            schemaVersion: CURRENT_SCHEMA_VERSION,
        };
        const bytes = new TextEncoder().encode(JSON.stringify(state)).byteLength;
        const mib = (n: number) => (n / (1024 * 1024)).toFixed(2);

        expect(bytes, `state is ${mib(bytes)} MiB, hard cap is ${mib(MAX_STATE_BYTES)} MiB`).toBeLessThan(MAX_STATE_BYTES);
        // Soft ceiling at 28 MiB: measured today at ~24.4 MiB. This leaves
        // several MiB of room to grow (more colourways, sizes or stickers)
        // while still tripping ~4 MiB (12%) before the real 32 MiB wall —
        // enough runway to notice and fix before generation actually breaks.
        expect(bytes, `state is ${mib(bytes)} MiB, soft budget is 28 MiB`).toBeLessThan(28 * 1024 * 1024);
    });

    it('keeps templates.js and hierarchy.js under their hard 512 KiB script cap, with an early-warning soft budget', () => {
        const templatesBytes = statSync(TEMPLATES_PATH).size;
        const hierarchyBytes = statSync(HIERARCHY_PATH).size;
        const kib = (n: number) => (n / 1024).toFixed(1);

        expect(templatesBytes, `templates.js is ${kib(templatesBytes)} KiB`).toBeLessThan(GENERATOR_SCRIPT_MAX_BYTES);
        expect(hierarchyBytes, `hierarchy.js is ${kib(hierarchyBytes)} KiB`).toBeLessThan(GENERATOR_SCRIPT_MAX_BYTES);

        // templates.js soft budget: measured today at 479.4 KiB against a
        // hard 512 KiB cap — only ~33 KiB of headroom left. 500 KiB leaves
        // ~20 KiB to keep adding stickers (each adds one raw SVG record,
        // median 365 B, p90 733 B — room for dozens more) while still
        // tripping with ~12 KiB to spare before the file can't generate.
        expect(templatesBytes, `templates.js is ${kib(templatesBytes)} KiB, soft budget is 500 KiB`).toBeLessThan(500 * 1024);
        // hierarchy.js soft budget: measured today at ~4.1 KiB, nowhere near
        // its cap. 64 KiB (16x today's size) still catches a genuine runaway
        // (e.g. data that belongs in registry.json ending up inlined here)
        // long before it threatens the hard cap.
        expect(hierarchyBytes, `hierarchy.js is ${kib(hierarchyBytes)} KiB, soft budget is 64 KiB`).toBeLessThan(64 * 1024);
    });

    // --- Structural: one shared node tree, four variants -----------------

    it('exposes an identical template id set across all four variants — a template missing from one device breaks only that device, silently', () => {
        const idSets = sample.variants.map(variant => Object.keys(variant.templates).sort());
        const serialized = idSets.map(ids => JSON.stringify(ids));
        const summary = sample.variants.map((variant, index) => `${variant.id}: ${idSets[index].length} templates`).join('; ');

        expect(new Set(serialized).size, summary).toBe(1);
        expect(idSets[0].length).toBeGreaterThan(0);
    });

    // --- SVG hygiene, across every distinct emitted svgContent ------------
    // These fail silently in the exporter rather than loudly, which is
    // exactly why a grep-style assertion earns its keep here.

    it('parses every emitted svgContent as SVG with a viewBox and no root width/height', () => {
        const errors: string[] = [];
        allSvgContents.forEach(content => {
            const doc = new DOMParser().parseFromString(content, 'image/svg+xml');
            if (doc.querySelector('parsererror') || doc.documentElement?.nodeName !== 'svg') {
                errors.push(`does not parse as SVG: ${content.slice(0, 80)}`);
                return;
            }
            const root = doc.documentElement;
            if (!root.hasAttribute('viewBox')) errors.push(`missing viewBox: ${content.slice(0, 80)}`);
            if (root.hasAttribute('width')) errors.push(`root has a width attribute: ${content.slice(0, 80)}`);
            if (root.hasAttribute('height')) errors.push(`root has a height attribute: ${content.slice(0, 80)}`);
        });
        expect(errors).toEqual([]);
    });

    it('never emits hsl()/hsla(), 4- or 8-digit hex, <use>/<script>/<style>/<foreignObject>, or on* handler attributes', () => {
        const errors: string[] = [];
        const forbiddenTag = /<(use|script|style|foreignObject)\b/i;
        const eventHandlerAttr = /\son[a-z]+\s*=/i;
        const hslFunc = /hsla?\(/i;

        allSvgContents.forEach(content => {
            if (hslFunc.test(content)) errors.push(`hsl()/hsla(): ${content.slice(0, 80)}`);
            if (forbiddenTag.test(content)) errors.push(`forbidden tag: ${content.slice(0, 80)}`);
            if (eventHandlerAttr.test(content)) errors.push(`on* handler attribute: ${content.slice(0, 80)}`);
            (content.match(/#[0-9a-f]+/gi) ?? []).forEach(hex => {
                const digits = hex.length - 1;
                if (digits !== 3 && digits !== 6) errors.push(`${digits}-digit hex '${hex}': ${content.slice(0, 80)}`);
            });
        });
        expect(errors).toEqual([]);
    });

    it('never lets an unsubstituted {{STROKE}} token survive into emitted svgContent', () => {
        // An unsubstituted token does not throw — it renders in whatever
        // colour was ambient, silently. Only a grep-style sweep catches it.
        const offenders = [...allSvgContents].filter(content => content.includes('{{STROKE}}'));
        expect(offenders).toEqual([]);
    });

    // --- Twemoji is never recoloured ---------------------------------------

    it('keeps every Twemoji sticker byte-identical to its vendored file, at every placement, in every variant', () => {
        const twemojiEntries = (JSON.parse(readFileSync(REGISTRY_PATH, 'utf8')) as Array<{ id: string; source: string }>)
            .filter(entry => entry.source === 'twemoji');
        expect(twemojiEntries.length).toBeGreaterThan(0);

        const vendorContentById = new Map(twemojiEntries.map(entry => [
            entry.id,
            readFileSync(`${VENDOR_DIR}/twemoji/${entry.id}.svg`, 'utf8'),
        ]));

        sample.variants.forEach(variant => {
            const placed = svgContentsByVariant[variant.id];
            twemojiEntries.forEach(entry => {
                const expected = vendorContentById.get(entry.id)!;
                expect(placed.has(expected), `variant '${variant.id}' has no byte-identical placement of '${entry.id}'`).toBe(true);
            });
        });
    });

    // --- Attribution: structural, not remembered ---------------------------
    // Driven from vendor/manifest.json rather than a hardcoded licence list,
    // so this keeps working (and keeps failing when it should) as the
    // roster of sourced artwork changes. This is a licence obligation, not
    // a style preference — a source that contributes a sticker but loses
    // its credit is a real legal gap, not a cosmetic one.

    it('credits every licence a vendored sticker contributes, on every variant\'s actual generated credits page', () => {
        const licences = new Set(
            (JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as { icons: Array<{ licence: string }> })
                .icons.map(icon => icon.licence),
        );
        expect(licences.size).toBeGreaterThan(0);

        // Lucide's licence has two halves that must BOTH appear: ISC for
        // "Lucide Icons and Contributors" plus MIT for "Cole Bemis", which
        // covers its Feather-derived icons. Twemoji needs CC-BY 4.0
        // attribution to "Twitter, Inc and other contributors".
        const REQUIRED_SUBSTRINGS: Record<string, string[]> = {
            ISC: ['ISC License', 'Lucide Icons and Contributors'],
            MIT: ['MIT License', 'Cole Bemis'],
            'CC-BY-4.0': ['CC-BY 4.0', 'Twitter, Inc'],
        };
        licences.forEach(licence => {
            expect(REQUIRED_SUBSTRINGS[licence], `no required-substring rule for licence '${licence}' — add one`).toBeTruthy();
        });

        sample.variants.forEach(variant => {
            const creditsTemplate = variant.templates.credits;
            expect(creditsTemplate, `variant '${variant.id}' has no 'credits' template`).toBeTruthy();
            const text = creditsTemplate.elements.map((element: any) => element.text ?? '').join('\n');
            licences.forEach(licence => {
                REQUIRED_SUBSTRINGS[licence].forEach(substring => {
                    expect(text, `variant '${variant.id}' credits page missing '${substring}' for licence '${licence}'`).toContain(substring);
                });
            });
        });
    });

    // --- Colourway legibility in greyscale ----------------------------------

    it('keeps adjacent colourways separated by >=25 luminance under y = 0.299r + 0.587g + 0.114b', () => {
        const scope = loadStickerPressScope(['COLOURWAYS']);
        const colourways: Array<{ id: string; hex: string }> = scope.COLOURWAYS;
        expect(colourways.length).toBeGreaterThan(1);

        const luminance = (hex: string): number => {
            const n = parseInt(hex.slice(1), 16);
            const r = (n >> 16) & 0xff;
            const g = (n >> 8) & 0xff;
            const b = n & 0xff;
            return 0.299 * r + 0.587 * g + 0.114 * b;
        };

        for (let index = 1; index < colourways.length; index += 1) {
            const prev = colourways[index - 1];
            const curr = colourways[index];
            const diff = Math.abs(luminance(prev.hex) - luminance(curr.hex));
            expect(diff, `${prev.id} (${prev.hex}) vs ${curr.id} (${curr.hex}): luminance diff ${diff.toFixed(1)}`)
                .toBeGreaterThanOrEqual(25);
        }
    });
});
