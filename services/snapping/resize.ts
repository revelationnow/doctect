import { rotateVector, type Box } from '../geometry/elementBox';
import type { ResizeEdges } from './types';

/** The resized box for a handle drag of (localDx, localDy) in the element's own axes (Canvas's math). */
export function computeResizedBox(start: { x: number; y: number; w: number; h: number; rotation?: number }, handle: string,
    localDx: number, localDy: number, minSize = 5): Box {
    const { x: startX, y: startY, w: startW, h: startH } = start;
    const angle = start.rotation || 0;
    let newW = startW, newH = startH, deltaXLocal = 0, deltaYLocal = 0;
    if (handle.includes('e')) newW = Math.max(minSize, startW + localDx);
    if (handle.includes('w')) { newW = Math.max(minSize, startW - localDx); deltaXLocal = startW - newW; }
    if (handle.includes('s')) newH = Math.max(minSize, startH + localDy);
    if (handle.includes('n')) { newH = Math.max(minSize, startH - localDy); deltaYLocal = startH - newH; }
    const mid = rotateVector((deltaXLocal + newW / 2) - startW / 2, (deltaYLocal + newH / 2) - startH / 2, angle);
    const cx = startX + startW / 2 + mid.x, cy = startY + startH / 2 + mid.y;
    return { x: cx - newW / 2, y: cy - newH / 2, w: newW, h: newH };
}

/** Which world edges a handle drags once the element is turned by a right angle. */
export function worldEdgesForHandle(handle: string, deg: number): ResizeEdges {
    const edges: ResizeEdges = { x: null, y: null };
    const dirs: Record<string, [number, number]> = { e: [1, 0], w: [-1, 0], s: [0, 1], n: [0, -1] };
    for (const letter of handle) {
        const d = dirs[letter]; if (!d) continue;
        const v = rotateVector(d[0], d[1], deg);
        const rx = Math.round(v.x), ry = Math.round(v.y);
        if (rx) edges.x = rx > 0 ? 'max' : 'min';
        if (ry) edges.y = ry > 0 ? 'max' : 'min';
    }
    return edges;
}

/** The world box of a box turned by a right angle about its centre. */
export function rightAngleAabb(b: Box, deg: number): Box {
    const quarter = Math.round((((deg % 360) + 360) % 360) / 90) % 2 === 1;
    if (!quarter) return { ...b };
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    return { x: cx - b.h / 2, y: cy - b.w / 2, w: b.h, h: b.w };
}
