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
