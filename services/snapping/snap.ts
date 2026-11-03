import { RANK_CENTRE, RANK_EDGE, RANK_SQUARE, type SnapTargets } from './targets';
import { type Axis, type Box, type EdgeSide, type Guide, type Point, type ResizeEdges, type SnapResult,
    type SnapSettings, hi, len, lo, other, round2 } from './types';
import { type Accept, better, bracket, nearestIndex, type Win } from './core';
import { sizeWin, spacingWin } from './extras';

export type Mode = { kind: 'move' } | { kind: 'resize'; edge: EdgeSide } | { kind: 'point' };

export const gridLine = (v: number, g: number) => round2(Math.round(v / g) * g);
/** Whether `v` sits on a grid line: results are rounded to 0.01, so allow half of that. */
const onGrid = (v: number, g: number) => Math.abs(gridLine(v, g) - v) < 0.005;

type Feature = { v: number; rank: number };
/** The first feature is the one the grid snaps: the left/top edge, the dragged edge, or the point. */
const features = (b: Box, a: Axis, mode: Mode): Feature[] => {
    if (mode.kind === 'resize') return [{ v: mode.edge === 'min' ? lo(b, a) : hi(b, a), rank: RANK_EDGE }];
    if (mode.kind === 'point' || len(b, a) === 0) return [{ v: lo(b, a), rank: RANK_EDGE }];
    return [{ v: lo(b, a), rank: RANK_EDGE }, { v: lo(b, a) + len(b, a) / 2, rank: RANK_CENTRE }, { v: hi(b, a), rank: RANK_EDGE }];
};

function alignWin(T: SnapTargets, fs: Feature[], a: Axis, threshold: number, accept: Accept | null): Win | null {
    const t = T[a];
    let best: Win | null = null;
    for (const f of fs) {
        for (const i of bracket(t.values, f.v, threshold, accept)) {
            const c: Win = { delta: t.values[i] - f.v, rank: Math.max(t.ranks[i], f.rank), kind: 'align' };
            if (better(c, best)) best = c;
        }
    }
    return best;
}

const separation = (p: Box, q: Box, axis: Axis) => Math.max(0, lo(q, axis) - hi(p, axis), lo(p, axis) - hi(q, axis));

function alignGuides(T: SnapTargets, fb: Box, a: Axis, mode: Mode): Guide[] {
    const t = T[a], cross = other(a), out: Guide[] = [];
    let aligned = 0;
    for (const f of features(fb, a, mode)) {
        if (aligned >= 2) break;
        const i = nearestIndex(t.values, f.v);
        if (i < 0 || Math.abs(t.values[i] - f.v) > 0.01) continue;
        const at = t.values[i];
        if (out.some(g => g.kind === 'align' && g.at === at)) continue;
        let src = t.sources[i][0], gap = Infinity;
        for (const s of t.sources[i]) { const d = separation(fb, s, cross); if (d < gap) { gap = d; src = s; } }
        out.push({ kind: 'align', axis: a, at, from: Math.min(lo(fb, cross), lo(src, cross)), to: Math.max(hi(fb, cross), hi(src, cross)) });
        aligned++;
        if (src !== T.page && gap > 0 && !out.some(g => g.kind === 'distance')) {
            const below = lo(src, cross) >= hi(fb, cross);
            out.push({ kind: 'distance', axis: cross, at, from: below ? hi(fb, cross) : hi(src, cross), to: below ? lo(src, cross) : lo(fb, cross) });
        }
    }
    return out;
}

function resolveAxis(T: SnapTargets, b: Box, a: Axis, mode: Mode, s: SnapSettings, extra: Win | null = null): Win | null {
    const fs = features(b, a, mode), anchor = fs[0].v, g = s.grid;
    // With Snap to grid on the grid always wins: a guide may only pull to where the grid's own feature
    // still lands on a grid line, and the best such candidate wins by the usual priority.
    const accept: Accept | null = g ? delta => onGrid(anchor + delta, g) : null;
    let best: Win | null = null;
    if (s.guides) {
        const al = alignWin(T, fs, a, s.threshold, accept);
        if (al && better(al, best)) best = al;
        if (mode.kind === 'move') { const sp = spacingWin(T, b, a, s.threshold, accept); if (sp && better(sp, best)) best = sp; }
        if (mode.kind === 'resize') { const sz = sizeWin(T, b, a, mode.edge, s.threshold, accept); if (sz && better(sz, best)) best = sz; }
        // A caller's candidate (the square snap) is a tier of its own: in reach and under the same
        // predicate, it beats any size match whatever the distances, and never beats an alignment.
        if (extra && Math.abs(extra.delta) <= s.threshold && (!accept || accept(extra.delta)) && (!best || best.kind === 'size')) best = extra;
    }
    if (!best && g) best = { delta: gridLine(anchor, g) - anchor, rank: 9, kind: 'grid' };
    return best;
}

const sign = (mode: Mode) => mode.kind === 'resize' && mode.edge === 'min' ? -1 : 1;
/** A dragged axis's length once its win is applied (a min edge shortens as its delta grows). */
const finalLen = (b: Box, a: Axis, mode: Mode | null, w: Win | null) => len(b, a) + (mode && w ? sign(mode) * w.delta : 0);

/**
 * The square candidate for a resize: the axis to adjust, its mode, and the edge delta that makes its
 * length equal the other axis's final length. One dragged edge adjusts its own axis; a corner keeps an
 * axis that aligned (or took the grid) and adjusts the other, else the one needing the smaller change
 * (ties: the height follows the width). The candidate still has to win its axis.
 */
function squareCandidate(b: Box, mx: Mode | null, my: Mode | null, wx: Win | null, wy: Win | null): { axis: Axis; mode: Mode; win: Win } | null {
    if (!mx && !my) return null;
    const modeOf = (a: Axis) => (a === 'x' ? mx : my), winOf = (a: Axis) => (a === 'x' ? wx : wy);
    const kept = (w: Win | null) => !!w && (w.kind === 'align' || w.kind === 'grid');
    const deltaFor = (a: Axis) => { const o = other(a); return sign(modeOf(a)!) * (finalLen(b, o, modeOf(o), winOf(o)) - len(b, a)); };
    let axis: Axis;
    if (!mx || !my) axis = mx ? 'x' : 'y';
    else if (kept(wx) !== kept(wy)) axis = kept(wx) ? 'y' : 'x';
    else axis = Math.abs(deltaFor('x')) < Math.abs(deltaFor('y')) ? 'x' : 'y';
    return { axis, mode: modeOf(axis)!, win: { delta: deltaFor(axis), rank: RANK_SQUARE, kind: 'square' } };
}

/** The "= N" label on one side of a box: the width above it (axis x), the height beside it (axis y). */
const sizeGuide = (axis: Axis, fb: Box): Guide => ({ kind: 'size', axis, size: round2(len(fb, axis)), boxes: [fb] });

/** One axis of the final box: a resize moves only its edge (the other stays), a move or point shifts. */
const applied = (lo: number, len: number, delta: number, mode: Mode | null): [number, number] => {
    if (mode?.kind === 'resize') return mode.edge === 'max' ? [lo, len + delta] : [lo + delta, len - delta];
    return [lo + delta, len];
};

function finish(T: SnapTargets, b: Box, wx: Win | null, wy: Win | null, mx: Mode | null, my: Mode | null, guidesOn: boolean): SnapResult {
    const dx = wx?.delta ?? 0, dy = wy?.delta ?? 0;
    const [x, w] = applied(b.x, b.w, dx, mx), [y, h] = applied(b.y, b.h, dy, my);
    const fb: Box = { x, y, w, h };
    const guides: Guide[] = [];
    for (const [a, w, mode] of [['x', wx, mx], ['y', wy, my]] as const) {
        if (!w || !mode) continue;
        // A grid win whose box happens to line up with a target still earns the alignment guide.
        if (w.kind === 'align' || (w.kind === 'grid' && guidesOn)) guides.push(...alignGuides(T, fb, a, mode));
        else if (w.kind === 'square') guides.push(sizeGuide('x', fb), sizeGuide('y', fb));
        else if (w.make) guides.push(w.make(fb));
    }
    return { dx, dy, snappedX: !!wx, snappedY: !!wy, guides };
}

const MOVE: Mode = { kind: 'move' };
const POINT: Mode = { kind: 'point' };

export function snapMove(T: SnapTargets, box: Box, s: SnapSettings): SnapResult {
    return finish(T, box, resolveAxis(T, box, 'x', MOVE, s), resolveAxis(T, box, 'y', MOVE, s), MOVE, MOVE, s.guides);
}

export interface ResizeOptions {
    /** Snap square once the width and height come within the pull distance: a lone rect or ellipse. */
    square?: boolean;
}

export function snapResize(T: SnapTargets, box: Box, edges: ResizeEdges, s: SnapSettings, opts: ResizeOptions = {}): SnapResult {
    const mx: Mode | null = edges.x ? { kind: 'resize', edge: edges.x } : null;
    const my: Mode | null = edges.y ? { kind: 'resize', edge: edges.y } : null;
    let wx = mx && resolveAxis(T, box, 'x', mx, s), wy = my && resolveAxis(T, box, 'y', my, s);
    if (opts.square && s.guides) {
        // Decided after both axes, since a corner squares to the axis that won; the candidate then
        // takes its own axis unless an alignment holds it (the grid predicate still applies).
        const sq = squareCandidate(box, mx, my, wx, wy);
        if (sq?.axis === 'x') wx = resolveAxis(T, box, 'x', sq.mode, s, sq.win);
        else if (sq) wy = resolveAxis(T, box, 'y', sq.mode, s, sq.win);
    }
    return finish(T, box, wx, wy, mx, my, s.guides);
}

export function snapPoint(T: SnapTargets, p: Point, s: SnapSettings, axes = { x: true, y: true }): SnapResult {
    const b: Box = { x: p.x, y: p.y, w: 0, h: 0 };
    return finish(T, b, axes.x ? resolveAxis(T, b, 'x', POINT, s) : null, axes.y ? resolveAxis(T, b, 'y', POINT, s) : null, POINT, POINT, s.guides);
}
