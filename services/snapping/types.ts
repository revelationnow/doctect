import type { Box } from '../geometry/elementBox';
export type { Box };

export interface Point { x: number; y: number }
export type Axis = 'x' | 'y';
export type EdgeSide = 'min' | 'max';
export interface ResizeEdges { x: EdgeSide | null; y: EdgeSide | null }
/** `threshold` is in page units (screen px / scale). `grid` null = grid snapping off. */
export interface SnapSettings { grid: number | null; guides: boolean; threshold: number }

export type Guide =
    | { kind: 'align'; axis: Axis; at: number; from: number; to: number }
    | { kind: 'distance'; axis: Axis; at: number; from: number; to: number }
    | { kind: 'spacing'; axis: Axis; gap: number; segments: { at: number; from: number; to: number }[] }
    | { kind: 'size'; axis: Axis; size: number; boxes: Box[] };

export interface SnapResult { dx: number; dy: number; snappedX: boolean; snappedY: boolean; guides: Guide[] }

export const lo = (b: Box, a: Axis) => a === 'x' ? b.x : b.y;
export const len = (b: Box, a: Axis) => a === 'x' ? b.w : b.h;
export const hi = (b: Box, a: Axis) => lo(b, a) + len(b, a);
export const other = (a: Axis): Axis => a === 'x' ? 'y' : 'x';
export const round2 = (v: number) => Math.round(v * 100) / 100;

type Segment = { at: number; from: number; to: number };
const sameSegment = (p: Segment, q: Segment) => p.at === q.at && p.from === q.from && p.to === q.to;
const sameBox = (p: Box, q: Box) => p.x === q.x && p.y === q.y && p.w === q.w && p.h === q.h;

/** Whether two guides draw the same thing: kind, axis, positions, label values and boxes. */
export const sameGuide = (a: Guide, b: Guide): boolean => {
    if (a.kind !== b.kind || a.axis !== b.axis) return false;
    switch (a.kind) {
        case 'align': case 'distance': {
            const o = b as typeof a;
            return a.at === o.at && a.from === o.from && a.to === o.to;
        }
        case 'spacing': {
            const o = b as typeof a;
            return a.gap === o.gap && a.segments.length === o.segments.length && a.segments.every((s, i) => sameSegment(s, o.segments[i]));
        }
        case 'size': {
            const o = b as typeof a;
            return a.size === o.size && a.boxes.length === o.boxes.length && a.boxes.every((x, i) => sameBox(x, o.boxes[i]));
        }
    }
};

/** Structural equality of two guide lists (the same array, or the same guides in order). */
export const sameGuides = (a: Guide[], b: Guide[]) => a === b || (a.length === b.length && a.every((g, i) => sameGuide(g, b[i])));
