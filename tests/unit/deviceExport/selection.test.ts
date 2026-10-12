import { describe, expect, it } from 'vitest';
import type { AppState } from '../../../types';
import { MAX_EXPORT_IMAGES, buildPageGroups, defaultSelection, exportBlockReason, filterGroups, imageCount } from '../../../services/deviceExport/selection';

const node = (id: string, type: string, title: string, children: string[] = [], referenceId?: string) =>
    ({ id, parentId: null, type, title, data: {}, children, ...(referenceId ? { referenceId } : {}) });
const tpl = (id: string, name: string) => ({ id, name, width: 100, height: 100, layers: [], elements: [] });

const state = {
    rootId: 'idx', activeVariantId: 'v1',
    nodes: {
        idx: node('idx', 'index', 'Index', ['d1', 'w1', 'd2', 'ref', 'ghost']),
        d1: node('d1', 'daily', 'Jan 1'), d2: node('d2', 'daily', 'Jan 2'),
        w1: node('w1', 'weekly', '  '),
        ref: node('ref', 'daily', 'Linked', [], 'd1'),
        ghost: node('ghost', 'missing', 'No template'),
    },
    variants: {
        v1: { id: 'v1', name: 'A', templates: { index: tpl('index', 'Month index'), daily: tpl('daily', 'Daily'), weekly: tpl('weekly', '') } },
        v2: { id: 'v2', name: 'B', templates: { daily: tpl('daily', 'Daily B') } },
    },
} as unknown as AppState;

describe('buildPageGroups', () => {
    it('groups pages by template in first-appearance order, skipping references and template-less pages', () => {
        expect(buildPageGroups(state)).toEqual([
            { templateId: 'index', name: 'Month index', pages: [{ nodeId: 'idx', title: 'Index' }] },
            { templateId: 'daily', name: 'Daily', pages: [{ nodeId: 'd1', title: 'Jan 1' }, { nodeId: 'd2', title: 'Jan 2' }] },
            { templateId: 'weekly', name: 'weekly', pages: [{ nodeId: 'w1', title: 'Untitled page' }] },
        ]);
    });

    it('follows the active variant', () => {
        const groups = buildPageGroups({ ...state, activeVariantId: 'v2' } as AppState);
        expect(groups.map(g => g.name)).toEqual(['Daily B']);
    });

    it('ticks the first page of each group by default', () => {
        expect([...defaultSelection(buildPageGroups(state))]).toEqual(['idx', 'd1', 'w1']);
    });

    it('filters pages by title and drops empty groups', () => {
        expect(filterGroups(buildPageGroups(state), ' jan 2 ')).toEqual([
            { templateId: 'daily', name: 'Daily', pages: [{ nodeId: 'd2', title: 'Jan 2' }] },
        ]);
        expect(filterGroups(buildPageGroups(state), '')).toHaveLength(3);
    });
});

describe('counts', () => {
    it('counts images and blocks empty or oversized exports', () => {
        expect(imageCount(3, 4)).toBe(12);
        expect(exportBlockReason(0, 2)).toBe('Pick at least one page and one device.');
        expect(exportBlockReason(2, 0)).toBe('Pick at least one page and one device.');
        expect(exportBlockReason(MAX_EXPORT_IMAGES, 1)).toBeNull();
        expect(exportBlockReason(MAX_EXPORT_IMAGES + 1, 1)).toBe('Too many files: pick fewer pages or devices.');
    });
});
