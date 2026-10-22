import { describe, it, expect } from 'vitest';
import { hitTestPoint } from '../../services/hitTest';
import { getElementBounds } from '../../components/canvas/elementBounds';
import { AppNode, Layer, TemplateElement } from '../../types';

const makeEl = (id: string, overrides: Partial<TemplateElement> = {}): TemplateElement => ({
    id, type: 'rect', x: 0, y: 0, w: 100, h: 100, rotation: 0,
    fill: '#fff', stroke: '#000', strokeWidth: 1, opacity: 1, ...overrides
});
const makeLayer = (id: string, order: number, overrides: Partial<Layer> = {}): Layer => ({
    id, name: id, order, visible: true, locked: false, ...overrides
});
const nodes: Record<string, AppNode> = {
    root: { id: 'root', parentId: null, type: 'page', title: 'Root', data: {}, children: [] },
};

describe('getElementBounds (extracted)', () => {
    it('returns w/h for plain elements', () => {
        expect(getElementBounds(makeEl('a', { w: 40, h: 30 }), nodes, 'root')).toEqual({ w: 40, h: 30 });
    });

    // A month of 30 days in a 7-column calendar; the 1st falls in the last column (offset 6), so
    // the days need six rows, not five. The cells use the dynamic offset, and so must the bounds.
    const month = (firstDayData: Record<string, string>, extra: Record<string, AppNode> = {}): Record<string, AppNode> => {
        const days = Array.from({ length: 30 }, (_, i) => `d${i + 1}`);
        const out: Record<string, AppNode> = {
            month: { id: 'month', parentId: null, type: 'month', title: 'November', data: {}, children: days },
            ...extra,
        };
        days.forEach((id, i) => {
            out[id] = { id, parentId: 'month', type: 'day', title: String(i + 1), data: i === 0 ? firstDayData : {}, children: [] };
        });
        return out;
    };
    const calendar = (gridConfig: Partial<NonNullable<TemplateElement['gridConfig']>> = {}) => makeEl('cal', {
        type: 'grid', w: 70, h: 100,
        gridConfig: { cols: 7, gapX: 4, gapY: 4, sourceType: 'current', displayField: 'title',
            offsetMode: 'dynamic', offsetField: 'startWeekday', ...gridConfig } as TemplateElement['gridConfig'],
    });

    it('counts the dynamic offset when it adds a row', () => {
        expect(getElementBounds(calendar(), month({ startWeekday: '6' }), 'month')).toEqual({ w: 7 * 70 + 6 * 4, h: 6 * 100 + 5 * 4 });
        expect(getElementBounds(calendar(), month({ startWeekday: '0' }), 'month').h).toBe(5 * 100 + 4 * 4);
    });

    it('reads the dynamic offset through a reference, and wraps a negative one', () => {
        const nodesWithRef = month({}, { real: { id: 'real', parentId: null, type: 'day', title: 'Real', data: { startWeekday: '6' }, children: [] } });
        nodesWithRef.d1 = { ...nodesWithRef.d1, referenceId: 'real' };
        expect(getElementBounds(calendar(), nodesWithRef, 'month').h).toBe(6 * 100 + 5 * 4);
        // -1 wraps to 6 empty cells: still six rows
        expect(getElementBounds(calendar({ offsetAdjustment: -7 }), month({ startWeekday: '6' }), 'month').h).toBe(6 * 100 + 5 * 4);
    });

    it('uses the cells\' default gap of 10 when a grid sets none', () => {
        const grid = calendar({ gapX: undefined, gapY: undefined, offsetMode: 'static' });
        expect(getElementBounds(grid, month({}), 'month')).toEqual({ w: 7 * 70 + 6 * 10, h: 5 * 100 + 4 * 10 });
    });

    it('lets a click on the row the offset adds hit the grid', () => {
        const nodesForMonth = month({ startWeekday: '6' });
        // the sixth row starts at y = 5 * (100 + 4) = 520; "30" sits in its first cell
        expect(hitTestPoint({ x: 30, y: 560 }, [calendar()], [], nodesForMonth, 'month').map(e => e.id)).toEqual(['cal']);
    });
});

describe('hitTestPoint', () => {
    const layers = [makeLayer('back', 0), makeLayer('front', 1)];

    it('returns the stack under the point ordered top -> bottom', () => {
        const els = [
            makeEl('bottom', { layerId: 'back', zIndex: 1 }),
            makeEl('middle', { layerId: 'back', zIndex: 2 }),
            makeEl('top', { layerId: 'front', zIndex: 1 }),
            makeEl('elsewhere', { layerId: 'front', x: 500, y: 500 }),
        ];
        expect(hitTestPoint({ x: 50, y: 50 }, els, layers, nodes, 'root').map(e => e.id))
            .toEqual(['top', 'middle', 'bottom']);
    });

    it('is rotation-aware (point inside the rotated box, outside the AABB corner)', () => {
        // 100x20 bar centered at (50,50), rotated 90deg: occupies x 40..60, y 0..100
        const bar = makeEl('bar', { x: 0, y: 40, w: 100, h: 20, rotation: 90, layerId: 'back' });
        expect(hitTestPoint({ x: 50, y: 5 }, [bar], layers, nodes, 'root').map(e => e.id)).toEqual(['bar']);
        expect(hitTestPoint({ x: 5, y: 45 }, [bar], layers, nodes, 'root')).toEqual([]); // inside unrotated box, outside rotated
    });

    it('excludes elements on hidden and locked layers', () => {
        const specialLayers = [
            makeLayer('ok', 0),
            makeLayer('hid', 1, { visible: false }),
            makeLayer('lock', 2, { locked: true }),
        ];
        const els = [
            makeEl('visible', { layerId: 'ok' }),
            makeEl('hiddenEl', { layerId: 'hid' }),
            makeEl('lockedEl', { layerId: 'lock' }),
        ];
        expect(hitTestPoint({ x: 50, y: 50 }, els, specialLayers, nodes, 'root').map(e => e.id))
            .toEqual(['visible']);
    });

    it('treats untagged elements as hittable (legacy safety)', () => {
        expect(hitTestPoint({ x: 50, y: 50 }, [makeEl('legacy')], layers, nodes, 'root').map(e => e.id))
            .toEqual(['legacy']);
    });
});
