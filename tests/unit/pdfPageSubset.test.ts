// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generatePDF } from '../../services/pdfService';
import type { AppState } from '../../types';

const layer = { id: 'main', name: 'Main', order: 0, visible: true, locked: false };
const rect = (id: string, fill: string, extra: Record<string, unknown> = {}) => ({
    id, type: 'rect', x: 10, y: 10, w: 50, h: 50, rotation: 0, fill, stroke: '#000000', strokeWidth: 1,
    opacity: 1, layerId: 'main', zIndex: 0, ...extra,
});
const template = (id: string, width: number, height: number, elements: unknown[]) => ({ id, name: id, width, height, layers: [layer], elements });

const state = {
    schemaVersion: 12, rootId: 'root', activeVariantId: 'default',
    nodes: {
        root: { id: 'root', parentId: null, type: 'a', title: 'Root', data: {}, children: ['b', 'c', 'ref'] },
        b: { id: 'b', parentId: 'root', type: 'b', title: 'B', data: {}, children: [] },
        c: { id: 'c', parentId: 'root', type: 'b', title: 'C', data: {}, children: [] },
        ref: { id: 'ref', parentId: 'root', type: 'b', title: 'Ref', data: {}, children: [], referenceId: 'b' },
    },
    variants: { default: { id: 'default', name: 'Default', templates: {
        // The root page links to page c.
        a: template('a', 500, 700, [rect('link', '#ff0000', { linkTarget: 'specific_node', linkValue: 'c' })]),
        b: template('b', 300, 400, [rect('plain', '#0000ff')]),
    } } },
} as unknown as AppState;

const load = async (pageNodeIds?: string[]) => {
    const data = (await generatePDF(state, { output: 'arraybuffer', pageNodeIds })) as ArrayBuffer;
    const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
    return pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
};
const bytes = async (pageNodeIds?: string[]) =>
    new TextDecoder('latin1').decode(new Uint8Array((await generatePDF(state, { output: 'arraybuffer', pageNodeIds })) as ArrayBuffer));
const fills = async (pdf: any, pageNumber: number) => {
    const ops = await (await pdf.getPage(pageNumber)).getOperatorList();
    return ops.argsArray.filter((args: unknown) => Array.isArray(args) && typeof args[0] === 'string' && args[0].startsWith('#')).map((args: string[]) => args[0]);
};

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('generatePDF pageNodeIds', () => {
    it('draws every page without the option', async () => {
        expect((await load()).numPages).toBe(3);
    });

    it('draws only the chosen pages, in the order given', async () => {
        const pdf = await load(['c', 'root']);
        expect(pdf.numPages).toBe(2);
        expect((await pdf.getPage(1)).view).toEqual([0, 0, 300, 400]);
        expect((await pdf.getPage(2)).view).toEqual([0, 0, 500, 700]);
    });

    it('drops unknown ids, references and duplicates', async () => {
        expect((await load(['root', 'nope', 'ref', 'root'])).numPages).toBe(1);
    });

    it('links between chosen pages within the subset', async () => {
        expect(await bytes(['root', 'c'])).toContain('/Dest');
    });

    it('draws a link to a page outside the subset, without a link annotation', async () => {
        expect(await bytes(['root'])).not.toContain('/Dest');
        expect(await fills(await load(['root']), 1)).toContain('#ff0000');
    });
});
