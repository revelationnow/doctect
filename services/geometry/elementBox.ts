import type { AppNode, TemplateElement } from '../../types';
import { getElementBounds } from '../../components/canvas/elementBounds';

/** An axis-aligned rectangle in page units (pt). */
export interface Box { x: number; y: number; w: number; h: number }

/** Rotate a vector by `deg` in the canvas's y-down frame (positive = clockwise on screen). */
export const rotateVector = (x: number, y: number, deg: number) => {
    const r = deg * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
    return { x: x * cos - y * sin, y: x * sin + y * cos };
};

export const isRightAngle = (deg: number) => {
    const m = ((deg % 90) + 90) % 90;
    return m < 1e-6 || 90 - m < 1e-6;
};

/**
 * The axis-aligned outer box of an element as drawn: Data Grids at full table size, rotation about
 * `transformOrigin` (default centre). Align, distribute and snapping all measure this box.
 */
export function elementAabb(el: TemplateElement, nodes: Record<string, AppNode>, currentNodeId: string): Box {
    const { w, h } = getElementBounds(el, nodes, currentNodeId);
    const deg = el.rotation || 0;
    if (!deg) return { x: el.x, y: el.y, w, h };
    const ox = el.transformOrigin?.x ?? 0.5, oy = el.transformOrigin?.y ?? 0.5;
    const ax = el.x + w * ox, ay = el.y + h * oy;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [px, py] of [[el.x, el.y], [el.x + w, el.y], [el.x + w, el.y + h], [el.x, el.y + h]]) {
        const v = rotateVector(px - ax, py - ay, deg);
        minX = Math.min(minX, ax + v.x); maxX = Math.max(maxX, ax + v.x);
        minY = Math.min(minY, ay + v.y); maxY = Math.max(maxY, ay + v.y);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function unionBox(boxes: Box[]): Box | null {
    if (boxes.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const b of boxes) {
        minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
