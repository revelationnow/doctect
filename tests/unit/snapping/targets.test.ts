import { describe, it, expect } from 'vitest';
import { buildSnapTargets, MAX_SOURCES, RANK_CENTRE, RANK_EDGE, RANK_PAGE } from '../../../services/snapping/targets';
import type { Layer, TemplateElement } from '../../../types';

const el = (id: string, x: number, y: number, w: number, h: number, extra: Partial<TemplateElement> = {}) =>
    ({ id, type: 'rect', x, y, w, h, rotation: 0, fill: '', stroke: '', strokeWidth: 0, opacity: 1, ...extra }) as TemplateElement;
const layer = (id: string, o: Partial<Layer> = {}): Layer => ({ id, name: id, order: 0, visible: true, locked: false, ...o });
const build = (elements: TemplateElement[], layers?: Layer[], excludeIds: string[] = []) =>
    buildSnapTargets({ elements, layers, excludeIds, page: { w: 500, h: 700 }, nodes: {}, currentNodeId: 'root' });
const rankOf = (t: { values: number[]; ranks: number[] }, v: number) => t.ranks[t.values.indexOf(v)];

describe('buildSnapTargets', () => {
    it('collects edges, centres and the page', () => {
        const T = build([el('a', 10, 20, 100, 50)]);
        expect(T.x.values).toEqual([0, 10, 60, 110, 250, 500]);
        expect(rankOf(T.x, 10)).toBe(RANK_EDGE); expect(rankOf(T.x, 60)).toBe(RANK_CENTRE); expect(rankOf(T.x, 250)).toBe(RANK_PAGE);
        expect(T.y.values).toEqual([0, 20, 45, 70, 350, 700]);
    });
    it('leaves out the moving elements and hidden layers, keeps locked and untagged ones', () => {
        const layers = [layer('hidden', { visible: false }), layer('locked', { locked: true })];
        const T = build([el('m', 30, 0, 10, 10), el('h', 40, 0, 10, 10, { layerId: 'hidden' }),
            el('l', 70, 0, 10, 10, { layerId: 'locked' }), el('u', 90, 0, 10, 10)], layers, ['m']);
        expect(T.x.values).not.toContain(30); expect(T.x.values).not.toContain(40);
        expect(T.x.values).toContain(70); expect(T.x.values).toContain(90);
    });
    it('merges positions shared by many objects and caps their sources', () => {
        const T = build(Array.from({ length: 30 }, (_, i) => el(`c${i}`, 10, i * 20, 50, 10)));
        expect(T.x.values.filter(v => v === 10)).toHaveLength(1);
        expect(T.x.sources[T.x.values.indexOf(10)]).toHaveLength(MAX_SOURCES);
    });
    it('counts a zero-width line once on that axis', () => {
        const T = build([el('v', 40, 100, 0, 50, { type: 'line' })]);
        expect(T.x.values.filter(v => v === 40)).toHaveLength(1);
        expect(rankOf(T.x, 40)).toBe(RANK_EDGE);
    });
    it('measures rotated elements by their outer box', () => {
        const T = build([el('r', 0, 100, 100, 20, { rotation: 90 })]);
        expect(T.x.values).toContain(40); expect(T.x.values).toContain(60);
    });
    it('records sizes for matching', () => {
        const T = build([el('a', 0, 0, 120, 40), el('b', 200, 0, 120, 60)]);
        expect(T.w.values).toEqual([120]); expect(T.h.values).toEqual([40, 60]);
    });
});
