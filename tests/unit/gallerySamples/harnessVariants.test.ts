import { describe, expect, it } from 'vitest';
import { executeGallerySample, validateSharedGalleryInvariants } from '../../helpers/gallerySampleHarness';

const HIERARCHY = `
    const nodes = {
        root: { id: 'root', parentId: null, type: 'sheet', title: 'Root', data: {}, children: [] },
    };
    return { nodes, rootId: 'root' };
`;

const twoVariants = (secondSheetElements: string) => `
    const sheet = (w, h, elements) => ({ id: 'sheet', name: 'Sheet', width: w, height: h, elements });
    const templates = {
        big: { templates: { sheet: sheet(509, 679, [
            { id: 'e1', type: 'rect', x: 10, y: 10, w: 100, h: 20, rotation: 0, fill: '#fff', stroke: '', strokeWidth: 0, opacity: 1 },
        ]) } },
        small: { templates: { sheet: sheet(260, 463, ${secondSheetElements}) } },
    };
    return { variants: templates, activeVariantId: 'big' };
`;

describe('harness variant support', () => {
    it('loads every variant, not only the active one', () => {
        const inBounds = `[{ id: 'e1', type: 'rect', x: 10, y: 10, w: 100, h: 20, rotation: 0, fill: '#fff', stroke: '', strokeWidth: 0, opacity: 1 }]`;
        const sample = executeGallerySample(twoVariants(inBounds), HIERARCHY);

        expect(sample.variants.map(variant => variant.id)).toEqual(['big', 'small']);
        expect(sample.activeVariantId).toBe('big');
        expect(sample.variants[1].pageWidth).toBe(260);
        expect(sample.variants[1].pageHeight).toBe(463);
    });

    it('keeps sample.templates pointing at the active variant', () => {
        const inBounds = `[{ id: 'e1', type: 'rect', x: 10, y: 10, w: 100, h: 20, rotation: 0, fill: '#fff', stroke: '', strokeWidth: 0, opacity: 1 }]`;
        const sample = executeGallerySample(twoVariants(inBounds), HIERARCHY);

        expect(sample.templates.sheet.width).toBe(509);
    });

    it('catches an element that overflows a non-active variant page', () => {
        const overflowing = `[{ id: 'e1', type: 'rect', x: 200, y: 10, w: 100, h: 20, rotation: 0, fill: '#fff', stroke: '', strokeWidth: 0, opacity: 1 }]`;
        const sample = executeGallerySample(twoVariants(overflowing), HIERARCHY);
        const errors = validateSharedGalleryInvariants(sample);

        expect(errors.join('\n')).toMatch(/variant 'small'.*'e1'.*overflows width/);
    });

    it('allows sibling variants to reuse element ids', () => {
        const inBounds = `[{ id: 'e1', type: 'rect', x: 10, y: 10, w: 100, h: 20, rotation: 0, fill: '#fff', stroke: '', strokeWidth: 0, opacity: 1 }]`;
        const sample = executeGallerySample(twoVariants(inBounds), HIERARCHY);
        const errors = validateSharedGalleryInvariants(sample);

        expect(errors.join('\n')).not.toMatch(/duplicated/);
    });

    it('still rejects a duplicate element id inside one variant', () => {
        const source = `
            const elements = [
                { id: 'dupe', type: 'rect', x: 0, y: 0, w: 10, h: 10, rotation: 0, fill: '#fff', stroke: '', strokeWidth: 0, opacity: 1 },
            ];
            return {
                sheet: { id: 'sheet', name: 'A', width: 509, height: 679, elements },
                other: { id: 'other', name: 'B', width: 509, height: 679, elements },
            };
        `;
        const sample = executeGallerySample(source, HIERARCHY);
        const errors = validateSharedGalleryInvariants(sample);

        expect(errors.join('\n')).toMatch(/element id 'dupe' is duplicated/);
    });

    it('rejects a variant whose templates disagree on page size', () => {
        const source = `
            const el = [{ id: 'e1', type: 'rect', x: 0, y: 0, w: 10, h: 10, rotation: 0, fill: '#fff', stroke: '', strokeWidth: 0, opacity: 1 }];
            return {
                sheet: { id: 'sheet', name: 'A', width: 509, height: 679, elements: el },
                other: { id: 'other', name: 'B', width: 260, height: 463, elements: el },
            };
        `;
        const sample = executeGallerySample(source, HIERARCHY);
        const errors = validateSharedGalleryInvariants(sample);

        expect(errors.join('\n')).toMatch(/must be 509x679/);
    });

    it('does not prefix determinism or JSON-clonable errors with a variant label for a single-variant sample', () => {
        // No explicit element id (so normalization auto-generates a fresh random one on every
        // execution) plus a function-valued field (not JSON-clonable) — trips both
        // validateDeterministicIds and validateJsonClonable on a plain, non-`variants`-shaped
        // sample, which the twenty existing gallery products all are.
        const source = `
            return {
                sheet: {
                    id: 'sheet', name: 'Sheet', width: 509, height: 679, elements: [
                        { type: 'rect', x: 10, y: 10, w: 100, h: 20, rotation: 0, fill: '#fff', stroke: '', strokeWidth: 0, opacity: 1, badFn: () => {} },
                    ],
                },
            };
        `;
        const sample = executeGallerySample(source, HIERARCHY);
        expect(sample.variants).toHaveLength(1);

        const errors = validateSharedGalleryInvariants(sample);

        expect(errors.some(error => error.includes('is not deterministic across repeated execution'))).toBe(true);
        expect(errors.some(error => error.includes('is a non-JSON function value'))).toBe(true);
        expect(errors.every(error => !error.startsWith("variant '"))).toBe(true);
    });
});
