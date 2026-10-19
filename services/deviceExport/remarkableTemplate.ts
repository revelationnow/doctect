// reMarkable "Methods" templates (.template + .metadata + .content), reverse-engineered by the
// community (spacepanda.se/articles/rm_methods.html; Martes-Delta-Co/Remarkable-Mobile-Prototyping-
// Templates docs/methods-format-notes.md). Paths may only use M/L/Z (curves blank the template),
// strokes always render dark, positions are device pixels and may be expressions over the device's
// templateWidth/templateHeight. Values marked "device checklist" are confirmed on hardware (spec §9).

import { targetBox, type DeviceProfile } from './deviceProfiles';
import type { Drawing, DrawingItem, DrawingNote, Point, SubPath } from './pdfDrawing';

/** Logical canvas width that strokeWidth and fontSize are scaled to (device checklist item 4). */
export const REMARKABLE_CANVAS_WIDTH = 1404;
/** A text item's position is the top of its line: baseline − this × size (device checklist item 4). */
export const TEXT_TOP_FROM_BASELINE = 0.8;
export const MAX_METHODS_ITEMS = 20_000;
export const MAX_METHODS_BYTES = 4 * 1024 * 1024;
const MAX_MERGED_SUBPATHS = 500;
const ICON_BUDGET = 100_000;

export const NOTE_TEXT: Record<DrawingNote, string> = {
    image: 'images were left out (the format cannot draw images)',
    clip: 'clipping was ignored, so some shapes may extend past their frames',
    shading: 'gradient shading was left out',
    pattern: 'pattern fills were left out',
    'light-stroke': 'light-coloured lines are drawn dark (line colour cannot be set)',
    'device-font': "text is drawn in the tablet's own font",
    italic: 'italic text is drawn upright',
    'rotated-text': 'rotated text is drawn horizontally',
};

export interface MethodsFiles { stem: string; template: string; metadata: string; content: string }
export interface MethodsResult { files: MethodsFiles | null; notes: string[]; itemCount: number }
export interface MethodsOptions { profile: DeviceProfile; pageTitle: string; projectName: string; projectSlug: string; pageSlug: string; now: number }

const round = (n: number): number => Math.round(n * 100) / 100;

/**
 * The rM2 draws the Methods canvas turned 90° from the Paper Pro, so its points are pre-turned
 * (x, y) → (y, W − x); the device's own rotation brings the page upright. If a device shows the
 * page upside down, this is the one line to change (device checklist item 2).
 */
export const rotateForCanvas = ([x, y]: Point, page: { width: number; height: number }): Point => [y, page.width - x];

/** FNV-1a 32-bit as 8 hex digits: a content hash that needs no secure context. */
export function fnv1a8(text: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

type Bounds = [number, number, number, number];
const boundsOf = (subpaths: SubPath[]): Bounds => {
    const b: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
    for (const sp of subpaths) for (const [x, y] of sp.points) { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); }
    return b;
};
const overlaps = (a: Bounds, b: Bounds): boolean => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/**
 * Joins consecutive items of one style into one item with several sub-paths, which keeps grids and
 * dot patterns from becoming thousands of items. Fills merge only when they do not overlap: the
 * device fills even-odd, so two overlapping shapes in one path would punch a hole.
 */
export function mergeItems(items: DrawingItem[]): DrawingItem[] {
    const out: DrawingItem[] = [];
    let boxes: Bounds[] = [];
    for (const item of items) {
        const last = out[out.length - 1];
        if (item.kind !== 'text' && last && last.kind === item.kind && last.subpaths.length + item.subpaths.length <= MAX_MERGED_SUBPATHS) {
            if (item.kind === 'stroke' && last.kind === 'stroke' && round(last.width) === round(item.width)) {
                last.subpaths = [...last.subpaths, ...item.subpaths];
                continue;
            }
            if (item.kind === 'fill' && last.kind === 'fill' && last.grey === item.grey && last.evenOdd === item.evenOdd) {
                const box = boundsOf(item.subpaths);
                if (!boxes.some(other => overlaps(other, box))) {
                    last.subpaths = [...last.subpaths, ...item.subpaths];
                    boxes.push(box);
                    continue;
                }
            }
        }
        const copy: DrawingItem = item.kind === 'text' ? { ...item } : { ...item, subpaths: [...item.subpaths] };
        out.push(copy);
        boxes = copy.kind === 'fill' ? [boundsOf(copy.subpaths)] : [];
    }
    return out;
}

const base64Utf8 = (text: string): string => {
    let binary = '';
    for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
    return btoa(binary);
};

/** The picker thumbnail: a 150x200 SVG of the page's shapes (curves are fine here). */
function iconSvg(drawing: Drawing): string {
    const w = round(drawing.width), h = round(drawing.height);
    const parts: string[] = [];
    let size = 0;
    for (const item of drawing.items) {
        if (item.kind === 'text') continue;
        const d = item.subpaths.map(sp => `M${sp.points.map(([x, y]) => `${round(x)} ${round(y)}`).join('L')}${sp.closed ? 'Z' : ''}`).join('');
        const element = item.kind === 'fill'
            ? `<path d="${d}" fill="${item.grey}" fill-rule="${item.evenOdd ? 'evenodd' : 'nonzero'}"/>`
            : `<path d="${d}" fill="none" stroke="#000" stroke-width="${round(item.width)}"/>`;
        size += element.length;
        if (size > ICON_BUDGET) break;
        parts.push(element);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="200" viewBox="0 0 ${w} ${h}">`
        + `<rect width="${w}" height="${h}" fill="#fff" stroke="#000"/>${parts.join('')}</svg>`;
}

export function buildMethodsTemplate(drawing: Drawing, options: MethodsOptions): MethodsResult {
    const page = { width: drawing.width, height: drawing.height };
    const rotate = options.profile.rotateMethods === true;
    // The frame the position expressions are evaluated in. On a rotated canvas the pre-turned points
    // span H across and W down, so the fit constants use the turned page (spec §5.4: W and H swap).
    const frame = rotate ? { width: page.height, height: page.width } : page;
    const box = targetBox(options.profile, frame);
    const fit = Math.min(box.width / frame.width, box.height / frame.height);
    const byWidth = box.width / frame.width <= box.height / frame.height;
    const sizeScale = fit * (REMARKABLE_CANVAS_WIDTH / options.profile.width);
    const notes = drawing.notes.map(note => NOTE_TEXT[note]);
    const at = (point: Point): [string, string] => {
        const [x, y] = rotate ? rotateForCanvas(point, page) : point;
        return [`${round(x)} * s + ox`, `${round(y)} * s + oy`];
    };
    const pathData = (subpaths: SubPath[]): string[] => subpaths.flatMap(sp => [
        ...sp.points.flatMap((point, i) => [i === 0 ? 'M' : 'L', ...at(point)]),
        ...(sp.closed ? ['Z'] : []),
    ]);

    const merged = mergeItems(drawing.items);
    if (merged.length > MAX_METHODS_ITEMS) {
        return { files: null, itemCount: merged.length, notes: [...notes, `too many shapes (${merged.length}) for a .template; only the PNG is included`] };
    }
    const items = merged.map((item, index) => {
        const id = `i${index + 1}`;
        if (item.kind === 'text') {
            const [x, y] = at([item.x, item.baseline - item.size * TEXT_TOP_FROM_BASELINE]);
            return { id, type: 'text', text: item.text, fontSize: round(item.size * sizeScale), position: { x, y }, ...(item.bold ? { bold: true } : {}) };
        }
        if (item.kind === 'fill') return { id, type: 'path', fillColor: item.grey, data: pathData(item.subpaths) };
        return { id, type: 'path', strokeWidth: Math.max(1, round(item.width * sizeScale)), data: pathData(item.subpaths) };
    });
    const template = {
        name: options.pageTitle,
        author: 'Doctect',
        iconData: base64Utf8(iconSvg(drawing)),
        templateVersion: '1.0.0',
        formatVersion: 1,
        categories: ['Custom'],
        labels: [options.projectName || 'Doctect'],
        orientation: page.width > page.height ? 'landscape' : 'portrait',
        supportedScreens: [options.profile.remarkableScreen],
        constants: [
            { s: byWidth ? `templateWidth / ${round(frame.width)}` : `templateHeight / ${round(frame.height)}` },
            { ox: `(templateWidth - ${round(frame.width)} * s) / 2` },
            { oy: `(templateHeight - ${round(frame.height)} * s) / 2` },
        ],
        items,
    };
    const json = JSON.stringify(template);
    if (new TextEncoder().encode(json).length > MAX_METHODS_BYTES) {
        return { files: null, itemCount: items.length, notes: [...notes, 'the .template would be larger than 4 MB; only the PNG is included'] };
    }
    const stamp = String(options.now);
    return {
        itemCount: items.length,
        notes,
        files: {
            stem: `doctect-${options.projectSlug}-${options.pageSlug}-${options.profile.id}-${fnv1a8(json)}`.toLowerCase(),
            template: json,
            metadata: JSON.stringify({ createdTime: stamp, lastModified: stamp, parent: '', pinned: false, type: 'TemplateType',
                visibleName: options.pageTitle, source: 'doctect', new: true }, null, 2),
            content: '{}',
        },
    };
}
