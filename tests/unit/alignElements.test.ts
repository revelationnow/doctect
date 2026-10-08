import { describe, expect, it } from 'vitest';
import { ALIGN_ACTIONS, alignElements, alignSelectedElements } from '../../services/alignElements';
import { toggleSelection } from '../../services/selection';
import { editorState } from '../helpers/editorFixtures';
import type { TemplateElement } from '../../types';

const rect = (id: string, x: number, y: number, w = 50, h = 40): TemplateElement => ({
    id, type: 'rect', x, y, w, h, rotation: 0, fill: '#fff', stroke: '#000', strokeWidth: 1, opacity: 1, layerId: 'l1',
});
const positions = (elements: TemplateElement[]) => Object.fromEntries(elements.map(el => [el.id, { x: el.x, y: el.y }]));

describe('alignElements (the desktop toolbar handler, shared with touch Arrange)', () => {
    const elements = [rect('a', 10, 10), rect('b', 100, 60, 30, 20), rect('c', 300, 200), rect('other', 500, 500)];
    const ids = ['a', 'b', 'c'];

    it('lists the eight desktop actions in toolbar order for the touch menu', () => {
        expect(ALIGN_ACTIONS.map(action => action.type)).toEqual(['left', 'center', 'right', 'top', 'middle', 'bottom', 'dist-h', 'dist-v']);
    });

    it('aligns only the selected elements', () => {
        expect(positions(alignElements(elements, ids, 'left'))).toMatchObject({ a: { x: 10 }, b: { x: 10 }, c: { x: 10 }, other: { x: 500 } });
        expect(positions(alignElements(elements, ids, 'right'))).toMatchObject({ a: { x: 300 }, b: { x: 320 }, c: { x: 300 } });
        expect(positions(alignElements(elements, ids, 'center'))).toMatchObject({ a: { x: 155 }, b: { x: 165 }, c: { x: 155 } });
        expect(positions(alignElements(elements, ids, 'top'))).toMatchObject({ a: { y: 10 }, b: { y: 10 }, c: { y: 10 } });
        expect(positions(alignElements(elements, ids, 'bottom'))).toMatchObject({ a: { y: 200 }, b: { y: 220 }, c: { y: 200 } });
        expect(positions(alignElements(elements, ids, 'middle'))).toMatchObject({ a: { y: 105 }, b: { y: 115 }, c: { y: 105 } });
    });

    it('distributes between the outermost elements, which stay put', () => {
        // Free space between a.x=10 and c's right edge 350: 340 - (50 + 30 + 50) = 210, so one 105 gap each.
        expect(positions(alignElements(elements, ids, 'dist-h'))).toMatchObject({ a: { x: 10 }, b: { x: 165 }, c: { x: 300 } });
        // Vertically: a.y=10 to c's bottom 240: 230 - (40 + 20 + 40) = 130, 65 each.
        expect(positions(alignElements(elements, ids, 'dist-v'))).toMatchObject({ a: { y: 10 }, b: { y: 115 }, c: { y: 200 } });
    });

    it('returns the input array untouched with fewer than two selected elements present', () => {
        expect(alignElements(elements, ['a'], 'left')).toBe(elements);
        expect(alignElements(elements, ['a', 'missing'], 'left')).toBe(elements);
    });
});

describe('alignSelectedElements (legacy editor state update)', () => {
    const withElements = (overrides = {}) => {
        const state = editorState({ selectedElementIds: ['a', 'b'], ...overrides });
        state.variants.default.templates.page.elements = [rect('a', 10, 10), rect('b', 100, 60)];
        return state;
    };

    it('aligns the shown template in hierarchy view, where selectedTemplateId may be empty', () => {
        const state = withElements({ viewMode: 'hierarchy', selectedTemplateId: '' });
        const next = alignSelectedElements(state, 'left');
        expect(positions(next.variants.default.templates.page.elements)).toMatchObject({ a: { x: 10 }, b: { x: 10 } });
        expect(next.selectedElementIds).toEqual(['a', 'b']); // nothing but the template changes
        expect(state.variants.default.templates.page.elements[1].x).toBe(100); // input untouched
    });

    it('aligns the selected template in templates view', () => {
        const state = withElements({ viewMode: 'templates', selectedTemplateId: 'page' });
        expect(positions(alignSelectedElements(state, 'top').variants.default.templates.page.elements)).toMatchObject({ a: { y: 10 }, b: { y: 10 } });
    });

    it('returns the same state when fewer than two elements are selected or the template is missing', () => {
        const single = withElements({ selectedElementIds: ['a'] });
        expect(alignSelectedElements(single, 'left')).toBe(single);
        const missing = withElements({ viewMode: 'templates', selectedTemplateId: 'nope' });
        expect(alignSelectedElements(missing, 'left')).toBe(missing);
    });
});

describe('toggleSelection', () => {
    it('adds an absent id at the end and removes a present one', () => {
        expect(toggleSelection(['a'], 'b')).toEqual(['a', 'b']);
        expect(toggleSelection(['a', 'b'], 'a')).toEqual(['b']);
        expect(toggleSelection([], 'a')).toEqual(['a']);
    });
});
