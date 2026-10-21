import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '../../../gallery-templates';
import { DEVICES, MIN_ROW_MM, PT_PER_MM } from '../../../gallery-templates/lib/page';
import { buildProjectState, drawPage, TEMPLATE_ID } from '../../../gallery-templates/lib/project';
import { isometricLattice } from '../../../gallery-templates/templates/09-isometric-dot-paper';
import { deriveFacets } from '../../../shared/galleryFacets.js';
import { validateAppState } from '../../../shared/validateAppState.js';

const EPSILON = 0.01; // pt

describe('single-page gallery templates', () => {
    it('ships eleven templates with unique slugs and names', () => {
        expect(TEMPLATES).toHaveLength(11);
        expect(new Set(TEMPLATES.map(t => t.slug)).size).toBe(11);
        expect(new Set(TEMPLATES.map(t => t.listing.name)).size).toBe(11);
    });

    describe.each(TEMPLATES.map(t => [t.slug, t] as const))('%s', (_slug, definition) => {
        it('builds a valid single-page, three-device project', () => {
            const state = buildProjectState(definition);
            expect(validateAppState(state)).toEqual({ ok: true });
            expect(Object.keys(state.nodes)).toEqual([state.rootId]);
            expect(state.generator).toBeUndefined();
            expect(Object.keys(state.variants).sort()).toEqual(DEVICES.map(d => d.id).sort());
            for (const variant of Object.values(state.variants)) {
                expect(Object.keys(variant.templates)).toEqual([TEMPLATE_ID]);
            }
        });

        it('lists under Note templates for all three page formats', () => {
            const state = buildProjectState(definition);
            const facets = deriveFacets(state, { name: definition.listing.name, tags: definition.listing.tags });
            expect(facets.category).toBe('templates');
            expect([...facets.formats].sort()).toEqual(['eink_10_3', 'rm_pp', 'rm_pp_move']);
            expect(facets.pageCount).toBe(1);
        });

        it('has a complete listing', () => {
            const { name, description, tags } = definition.listing;
            expect(name.length).toBeGreaterThan(0);
            expect(description.length).toBeGreaterThan(80);
            expect(description.length).toBeLessThanOrEqual(2000);
            expect(tags).toHaveLength(6);
            expect(new Set(tags).size).toBe(6);
            for (const tag of tags) expect(tag).toMatch(/^[a-z0-9-]{1,30}$/);
            // Plain logging only on the cycle page; nothing that reads as a prediction or advice.
            if (definition.slug === '11-cycle-tracker') {
                expect(description).not.toMatch(/predict(?!ions)|fertil|ovulat|due date|diagnos/i);
            }
        });

        describe.each(DEVICES.map(d => [d.id, d] as const))('on %s', (_deviceId, device) => {
            const page = drawPage(definition, device);

            it('keeps every element on the page', () => {
                for (const el of page.elements) {
                    expect(el.x, el.id).toBeGreaterThanOrEqual(-EPSILON);
                    expect(el.y, el.id).toBeGreaterThanOrEqual(-EPSILON);
                    expect(el.x + el.w, el.id).toBeLessThanOrEqual(device.width + EPSILON);
                    expect(el.y + el.h, el.id).toBeLessThanOrEqual(device.height + EPSILON);
                    expect(el.w, el.id).toBeGreaterThanOrEqual(0);
                    expect(el.h, el.id).toBeGreaterThanOrEqual(0);
                }
            });

            it('keeps everything inside the side margins', () => {
                const margin = device.marginX * PT_PER_MM;
                for (const el of page.elements) {
                    expect(el.x, el.id).toBeGreaterThanOrEqual(margin - EPSILON);
                    expect(el.x + el.w, el.id).toBeLessThanOrEqual(device.width - margin + EPSILON);
                }
            });

            it('never overlaps two pieces of text', () => {
                const texts = page.elements.filter(el => el.type === 'text' && el.text);
                for (let i = 0; i < texts.length; i++) {
                    for (let j = i + 1; j < texts.length; j++) {
                        const a = texts[i];
                        const b = texts[j];
                        const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
                        const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
                        expect(overlapX > 0.1 && overlapY > 0.1, `${a.id} "${a.text}" overlaps ${b.id} "${b.text}"`).toBe(false);
                    }
                }
            });

            it('keeps writing rows at or above the size floor', () => {
                expect(page.rowsMm.length).toBeGreaterThan(0);
                const floor = device.compact ? MIN_ROW_MM.compact : MIN_ROW_MM.regular;
                for (const row of page.rowsMm) expect(row).toBeGreaterThanOrEqual(floor - 1e-9);
            });

            it('uses only greyscale colours', () => {
                const colours = JSON.stringify(page.elements).match(/#[0-9a-f]{6}/gi) ?? [];
                for (const colour of colours) {
                    const [r, g, b] = [1, 3, 5].map(i => colour.slice(i, i + 2).toLowerCase());
                    expect(r === g && g === b, colour).toBe(true);
                }
            });
        });
    });
});

describe('isometric lattice', () => {
    it('places neighbouring dots 5 mm apart with alternate rows offset by half a step', () => {
        const svg = isometricLattice(30, 20);
        const dots = [...svg.matchAll(/cx="([\d.]+)" cy="([\d.]+)"/g)].map(m => [Number(m[1]), Number(m[2])]);
        const rowY = [...new Set(dots.map(([, y]) => y))].sort((a, b) => a - b);
        const row0 = dots.filter(([, y]) => y === rowY[0]).map(([x]) => x);
        const row1 = dots.filter(([, y]) => y === rowY[1]).map(([x]) => x);
        expect(row0[1] - row0[0]).toBeCloseTo(5, 3);
        expect(row1[0] - row0[0]).toBeCloseTo(2.5, 3);
        expect(Math.hypot(row1[0] - row0[0], rowY[1] - rowY[0])).toBeCloseTo(5, 2);
        for (const [x, y] of dots) {
            expect(x).toBeLessThanOrEqual(30);
            expect(y).toBeLessThanOrEqual(20);
        }
    });
});
