import type { AppNode, Layer, TemplateElement } from '../../types';
import { elementAabb } from '../geometry/elementBox';
import { type Axis, type Box, hi, len, lo, other, round2 } from './types';

export const MAX_SOURCES = 20;
export const NEIGHBOUR_SCAN = 64;
export const RANK_EDGE = 0, RANK_CENTRE = 1, RANK_PAGE = 2, RANK_SPACING = 3, RANK_SIZE = 4;

export interface AxisTargets { values: number[]; ranks: number[]; sources: Box[][] }
export interface SizeTargets { values: number[] }
export interface SnapTargets {
    page: Box;
    x: AxisTargets; y: AxisTargets;
    w: SizeTargets; h: SizeTargets;
    byLo: Record<Axis, Box[]>;
    byHi: Record<Axis, Box[]>;
}
export interface TargetInput {
    elements: TemplateElement[]; layers?: Layer[]; excludeIds: Iterable<string>;
    page: { w: number; h: number }; nodes: Record<string, AppNode>; currentNodeId: string;
}

type Entry = { v: number; rank: number; box: Box };
const merge = (entries: Entry[]): AxisTargets => {
    entries.sort((a, b) => a.v - b.v || a.rank - b.rank);
    const values: number[] = [], ranks: number[] = [], sources: Box[][] = [];
    for (const e of entries) {
        const v = round2(e.v), last = values.length - 1;
        if (last >= 0 && values[last] === v) {
            ranks[last] = Math.min(ranks[last], e.rank);
            if (sources[last].length < MAX_SOURCES) sources[last].push(e.box);
        } else { values.push(v); ranks.push(e.rank); sources.push([e.box]); }
    }
    return { values, ranks, sources };
};

const axisEntries = (boxes: Box[], page: Box, a: Axis): Entry[] => {
    const out: Entry[] = [];
    for (const b of boxes) {
        out.push({ v: lo(b, a), rank: RANK_EDGE, box: b });
        if (len(b, a) > 0) {
            out.push({ v: lo(b, a) + len(b, a) / 2, rank: RANK_CENTRE, box: b });
            out.push({ v: hi(b, a), rank: RANK_EDGE, box: b });
        }
    }
    for (const v of [0, len(page, a) / 2, len(page, a)]) out.push({ v, rank: RANK_PAGE, box: page });
    return out;
};

/** Sorted distinct widths or heights: the size guide labels only the resized box, so no sources. */
const sizes = (boxes: Box[], a: Axis): SizeTargets =>
    ({ values: [...new Set(boxes.filter(b => len(b, a) > 0).map(b => round2(len(b, a))))].sort((p, q) => p - q) });

export const overlaps = (a: Box, b: Box, axis: Axis) => lo(a, axis) <= hi(b, axis) && lo(b, axis) <= hi(a, axis);

const lowerBound = (list: Box[], key: (b: Box) => number, v: number) => {
    let l = 0, h = list.length;
    while (l < h) { const m = (l + h) >> 1; if (key(list[m]) < v) l = m + 1; else h = m; }
    return l;
};

/** The nearest box starting at or after `from` along `axis` that overlaps `b` across it (bounded scan). */
export function nextNeighbour(T: Pick<SnapTargets, 'byLo'>, b: Box, axis: Axis, from = hi(b, axis)): Box | null {
    const list = T.byLo[axis], cross = other(axis);
    for (let i = lowerBound(list, x => lo(x, axis), from), n = 0; i < list.length && n < NEIGHBOUR_SCAN; i++, n++)
        if (list[i] !== b && overlaps(list[i], b, cross)) return list[i];
    return null;
}

/** The nearest box ending at or before `from` along `axis` that overlaps `b` across it (bounded scan). */
export function previousNeighbour(T: Pick<SnapTargets, 'byHi'>, b: Box, axis: Axis, from = lo(b, axis)): Box | null {
    const list = T.byHi[axis], cross = other(axis);
    for (let i = lowerBound(list, x => hi(x, axis), from + 1e-9) - 1, n = 0; i >= 0 && n < NEIGHBOUR_SCAN; i--, n++)
        if (list[i] !== b && overlaps(list[i], b, cross)) return list[i];
    return null;
}

/** Everything a gesture can snap to, built once when the gesture starts snapping. */
export function buildSnapTargets(input: TargetInput): SnapTargets {
    const hidden = new Set((input.layers ?? []).filter(l => l && l.visible === false).map(l => l.id));
    const exclude = new Set(input.excludeIds);
    const boxes = input.elements
        .filter(el => !exclude.has(el.id) && !(el.layerId && hidden.has(el.layerId)))
        .map(el => elementAabb(el, input.nodes, input.currentNodeId));
    const page: Box = { x: 0, y: 0, w: input.page.w, h: input.page.h };
    const sorted = (key: (b: Box) => number) => [...boxes].sort((p, q) => key(p) - key(q));
    return {
        page,
        x: merge(axisEntries(boxes, page, 'x')), y: merge(axisEntries(boxes, page, 'y')),
        w: sizes(boxes, 'x'), h: sizes(boxes, 'y'),
        byLo: { x: sorted(b => b.x), y: sorted(b => b.y) },
        byHi: { x: sorted(b => b.x + b.w), y: sorted(b => b.y + b.h) },
    };
}
