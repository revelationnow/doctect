// Reads one PDF page's vector drawing back out of pdf.js, for the reMarkable Methods converter.
// The PDF is the single source of layout (grids, bindings, wrapping, patterns, SVG artwork), so
// nothing here re-implements the editor's rendering. Output is page points, origin top-left, with
// curves flattened and dashes split: the Methods format draws only straight lines.

export type Point = [number, number];
export interface SubPath { points: Point[]; closed: boolean }
export interface FillItem { kind: 'fill'; subpaths: SubPath[]; grey: string; evenOdd: boolean }
export interface StrokeItem { kind: 'stroke'; subpaths: SubPath[]; width: number; grey: string }
export interface TextItem { kind: 'text'; text: string; x: number; baseline: number; size: number; bold: boolean }
export type DrawingItem = FillItem | StrokeItem | TextItem;
export type DrawingNote = 'image' | 'clip' | 'shading' | 'pattern' | 'light-stroke' | 'device-font' | 'italic' | 'rotated-text';
export interface Drawing { width: number; height: number; items: DrawingItem[]; notes: DrawingNote[] }

export interface OperatorListLike { fnArray: ArrayLike<number>; argsArray: ArrayLike<unknown> }
export interface TextItemLike { str: string; transform: number[]; fontName: string }
export interface PdfPageLike {
    view: number[];
    getOperatorList(): Promise<OperatorListLike>;
    getTextContent(): Promise<{ items: unknown[] }>;
    commonObjs: { get(id: string): unknown };
}

/** Maximum distance (pt) between a curve and its flattened polyline. */
export const FLATTEN_TOLERANCE = 0.25;
/** Hairline (width 0) strokes are drawn at this width. */
const HAIRLINE = 0.5;
const MAX_CURVE_STEPS = 100;
/** PDF line cap style 1 (`J` operator / ExtGState `LC`). */
const ROUND_CAP = 1;
const MIN_DOT_SIDES = 8;

type Matrix = [number, number, number, number, number, number];
const apply = (m: Matrix, x: number, y: number): Point => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
/** `m` applied first, then `t` (PDF's CTM' = M × CTM). */
const concat = (m: Matrix, t: Matrix): Matrix => [
    m[0] * t[0] + m[1] * t[2], m[0] * t[1] + m[1] * t[3],
    m[2] * t[0] + m[3] * t[2], m[2] * t[1] + m[3] * t[3],
    m[4] * t[0] + m[5] * t[2] + t[4], m[4] * t[1] + m[5] * t[3] + t[5],
];
const scaleOf = (m: Matrix): number => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
/** A six-number array or typed array (pdf.js passes form XObject matrices as Float32Array) as a matrix, else null. */
const toMatrix = (value: unknown): Matrix | null => {
    const list = Array.isArray(value) || ArrayBuffer.isView(value) ? Array.from(value as ArrayLike<unknown>) : null;
    return list?.length === 6 && list.every(n => typeof n === 'number') ? (list as Matrix) : null;
};

/** A grey `#rrggbb` of the colour's luminance, alpha-blended onto white. */
export function greyHex(hex: string, alpha: number): string {
    const match = /^#?([0-9a-f]{6})$/i.exec(hex);
    const value = match ? parseInt(match[1], 16) : 0;
    const luminance = 0.2126 * ((value >> 16) & 255) + 0.7152 * ((value >> 8) & 255) + 0.0722 * (value & 255);
    const a = Math.min(1, Math.max(0, Number.isFinite(alpha) ? alpha : 1));
    const channel = Math.round(255 - a * (255 - luminance)).toString(16).padStart(2, '0');
    return `#${channel}${channel}${channel}`;
}

const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const secondDiff = (a: Point, b: Point, c: Point): number => Math.hypot(a[0] - 2 * b[0] + c[0], a[1] - 2 * b[1] + c[1]);

function cubic(p0: Point, p1: Point, p2: Point, p3: Point): Point[] {
    const spread = Math.max(secondDiff(p0, p1, p2), secondDiff(p1, p2, p3));
    const steps = Math.min(MAX_CURVE_STEPS, Math.max(1, Math.ceil(Math.sqrt((0.75 * spread) / FLATTEN_TOLERANCE))));
    const out: Point[] = [];
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const a = lerp(p0, p1, t), b = lerp(p1, p2, t), c = lerp(p2, p3, t);
        out.push(lerp(lerp(a, b, t), lerp(b, c, t), t));
    }
    return out;
}

function quadratic(p0: Point, p1: Point, p2: Point): Point[] {
    const steps = Math.min(MAX_CURVE_STEPS, Math.max(1, Math.ceil(Math.sqrt((0.25 * secondDiff(p0, p1, p2)) / FLATTEN_TOLERANCE))));
    const out: Point[] = [];
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        out.push(lerp(lerp(p0, p1, t), lerp(p1, p2, t), t));
    }
    return out;
}

/** DrawOPS path data (pdf.js 5.x) to page-space sub-paths. */
function toSubpaths(data: ArrayLike<number>, m: Matrix): SubPath[] {
    const out: SubPath[] = [];
    let current: SubPath | null = null;
    const at = (): Point => current?.points[current.points.length - 1] ?? [0, 0];
    for (let i = 0; i < data.length;) {
        switch (data[i++]) {
            case 0: current = { points: [apply(m, data[i++], data[i++])], closed: false }; out.push(current); break;
            case 1: current ??= (out.push({ points: [at()], closed: false }), out[out.length - 1]); current.points.push(apply(m, data[i++], data[i++])); break;
            case 2: { const from = at(); const c1 = apply(m, data[i++], data[i++]); const c2 = apply(m, data[i++], data[i++]); const to = apply(m, data[i++], data[i++]);
                current ??= (out.push({ points: [from], closed: false }), out[out.length - 1]); current.points.push(...cubic(from, c1, c2, to)); break; }
            case 3: { const from = at(); const c1 = apply(m, data[i++], data[i++]); const to = apply(m, data[i++], data[i++]);
                current ??= (out.push({ points: [from], closed: false }), out[out.length - 1]); current.points.push(...quadratic(from, c1, to)); break; }
            case 4: if (current) { current.closed = true; current = { points: [current.points[0]], closed: false }; out.push(current); } break;
            default: return out.filter(sp => sp.points.length >= 2);
        }
    }
    return out.filter(sp => sp.points.length >= 2);
}

/** A closed polygon inscribed in a circle, within FLATTEN_TOLERANCE of it. */
function circle([cx, cy]: Point, r: number): SubPath {
    const sides = r > FLATTEN_TOLERANCE
        ? Math.min(MAX_CURVE_STEPS, Math.max(MIN_DOT_SIDES, Math.ceil(Math.PI / Math.acos(1 - FLATTEN_TOLERANCE / r))))
        : MIN_DOT_SIDES;
    const points: Point[] = [];
    for (let i = 0; i < sides; i++) {
        const angle = (2 * Math.PI * i) / sides;
        points.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
    }
    return { points, closed: true };
}

/**
 * Splits one sub-path by a dash pattern (lengths already in page points). A zero-length "on" entry
 * yields no piece but a dot position: under round caps PDF paints it as a dot (the editor draws its
 * dot grid that way), under butt caps nothing.
 */
function dashSubpath(subpath: SubPath, dash: number[], phase: number): { pieces: SubPath[]; dots: Point[] } {
    const pattern = dash.filter(n => Number.isFinite(n) && n >= 0);
    const total = pattern.reduce((sum, n) => sum + n, 0);
    if (pattern.length === 0 || total <= 0) return { pieces: [subpath], dots: [] };
    const points = subpath.closed ? [...subpath.points, subpath.points[0]] : subpath.points;
    const pieces: SubPath[] = [];
    const dots: Point[] = [];
    let index = 0;
    let left = pattern[0];
    let on = true;
    const advance = () => { index = (index + 1) % pattern.length; left = pattern[index]; on = !on; };
    /** Enters the current pattern entry at `at`: the piece it starts, or null when off; zero-length "on" entries are dots. */
    const enter = (at: Point): Point[] | null => {
        while (on && left === 0) { dots.push(at); advance(); }
        return on ? [at] : null;
    };
    for (let skip = ((phase % total) + total) % total; skip > 0;) {
        if (skip < left) { left -= skip; break; }
        skip -= left; advance();
    }
    let piece = enter(points[0]);
    for (let i = 1; i < points.length; i++) {
        let from = points[i - 1];
        const to = points[i];
        let length = Math.hypot(to[0] - from[0], to[1] - from[1]);
        while (length > 0) {
            if (length < left) { left -= length; if (piece) piece.push(to); break; }
            const cut = lerp(from, to, left / length);
            length -= left; from = cut;
            if (piece) { piece.push(cut); pieces.push({ points: piece, closed: false }); }
            advance();
            piece = enter(cut);
        }
    }
    if (piece && piece.length >= 2) pieces.push({ points: piece, closed: false });
    return { pieces, dots };
}

interface GraphicsState {
    ctm: Matrix; fill: string | null; fillAlpha: number; stroke: string; strokeAlpha: number;
    lineWidth: number; lineCap: number; dash: number[]; dashPhase: number;
}

export function extractDrawing({ ops, text, view, OPS, fontNameOf }: {
    ops: OperatorListLike; text: TextItemLike[]; view: number[]; OPS: Record<string, number>; fontNameOf(id: string): string | undefined;
}): Drawing {
    const [x0, , x1, y1] = view;
    const width = x1 - x0;
    const height = y1 - view[1];
    let gs: GraphicsState = {
        ctm: [1, 0, 0, -1, -x0, y1], fill: '#000000', fillAlpha: 1, stroke: '#000000', strokeAlpha: 1,
        lineWidth: 1, lineCap: 0, dash: [], dashPhase: 0,
    };
    const stack: GraphicsState[] = [];
    const items: DrawingItem[] = [];
    const notes = new Set<DrawingNote>();
    const push = () => stack.push({ ...gs, dash: [...gs.dash] });
    const pop = () => { gs = stack.pop() ?? gs; };
    // Op codes are looked up by name so an `OPS` record missing a name can never match a real code.
    const codes = (...names: string[]) => new Set(names.map(name => OPS[name]).filter((code): code is number => typeof code === 'number'));
    const imageOps = codes('paintImageXObject', 'paintInlineImageXObject', 'paintInlineImageXObjectGroup', 'paintImageMaskXObject',
        'paintImageMaskXObjectGroup', 'paintImageXObjectRepeat', 'paintImageMaskXObjectRepeat', 'paintSolidColorImageMask');
    const fillOps = codes('fill', 'eoFill', 'fillStroke', 'eoFillStroke', 'closeFillStroke', 'closeEOFillStroke');
    const strokeOps = codes('stroke', 'closeStroke', 'fillStroke', 'eoFillStroke', 'closeFillStroke', 'closeEOFillStroke');
    const closingOps = codes('closeStroke', 'closeFillStroke', 'closeEOFillStroke');
    const evenOddOps = codes('eoFill', 'eoFillStroke', 'closeEOFillStroke');

    const paint = (args: unknown[] | null) => {
        const op = args?.[0] as number;
        const data = (args?.[1] as unknown[] | undefined)?.[0] as ArrayLike<number> | null | undefined;
        if (!data || op === OPS.endPath) return;
        const subpaths = toSubpaths(data, gs.ctm);
        if (subpaths.length === 0) return;
        if (fillOps.has(op) && gs.fill && gs.fillAlpha > 0) {
            items.push({ kind: 'fill', subpaths: subpaths.map(sp => ({ points: sp.points, closed: true })), grey: greyHex(gs.fill, gs.fillAlpha), evenOdd: evenOddOps.has(op) });
        }
        if (strokeOps.has(op) && gs.strokeAlpha > 0) {
            const grey = greyHex(gs.stroke, gs.strokeAlpha);
            if (parseInt(grey.slice(1, 3), 16) > 128) notes.add('light-stroke');
            const scale = scaleOf(gs.ctm);
            const width = gs.lineWidth > 0 ? gs.lineWidth * scale : HAIRLINE;
            const close = closingOps.has(op);
            const dashed = subpaths.map(sp => dashSubpath({ points: sp.points, closed: sp.closed || close }, gs.dash.map(n => n * scale), gs.dashPhase * scale));
            const pieces = dashed.flatMap(d => d.pieces);
            if (pieces.length) items.push({ kind: 'stroke', subpaths: pieces, width, grey });
            // Zero-length dashes are dots under round caps and nothing otherwise (PDF 32000-1 section 8.4.3.3).
            const dots = gs.lineCap === ROUND_CAP ? dashed.flatMap(d => d.dots) : [];
            if (dots.length) items.push({ kind: 'fill', subpaths: dots.map(dot => circle(dot, width / 2)), grey, evenOdd: false });
        }
    };

    for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i];
        const args = (ops.argsArray[i] ?? null) as unknown[] | null;
        if (imageOps.has(fn)) { notes.add('image'); continue; }
        switch (fn) {
            case OPS.save: push(); break;
            case OPS.restore: pop(); break;
            case OPS.transform: { const matrix = toMatrix(args); if (matrix) gs.ctm = concat(matrix, gs.ctm); break; }
            case OPS.paintFormXObjectBegin: { push(); const matrix = toMatrix(args?.[0]); if (matrix) gs.ctm = concat(matrix, gs.ctm); break; }
            case OPS.paintFormXObjectEnd: pop(); break;
            // A transparency group's matrix is applied once, by the paintFormXObjectBegin that follows it
            // (pdf.js canvas.js captures the pre-matrix transform for the group's context).
            case OPS.beginGroup: push(); break;
            case OPS.endGroup: pop(); break;
            case OPS.setLineWidth: gs.lineWidth = Number(args?.[0]) || 0; break;
            case OPS.setLineCap: gs.lineCap = Number(args?.[0]) || 0; break;
            case OPS.setDash: gs.dash = Array.isArray(args?.[0]) ? (args[0] as unknown[]).map(Number) : []; gs.dashPhase = Number(args?.[1]) || 0; break;
            case OPS.setGState:
                for (const entry of (Array.isArray(args?.[0]) ? args[0] : []) as [string, unknown][]) {
                    const [key, value] = entry;
                    if (key === 'LW') gs.lineWidth = Number(value) || 0;
                    else if (key === 'LC') gs.lineCap = Number(value) || 0;
                    else if (key === 'CA') gs.strokeAlpha = Number(value);
                    else if (key === 'ca') gs.fillAlpha = Number(value);
                    else if (key === 'D' && Array.isArray(value)) { gs.dash = Array.isArray(value[0]) ? value[0].map(Number) : []; gs.dashPhase = Number(value[1]) || 0; }
                }
                break;
            case OPS.setFillRGBColor: if (typeof args?.[0] === 'string') gs.fill = args[0]; break;
            case OPS.setStrokeRGBColor: if (typeof args?.[0] === 'string') gs.stroke = args[0]; break;
            case OPS.setFillTransparent: gs.fill = null; break;
            case OPS.setFillColorN: notes.add('pattern'); gs.fill = null; break;
            case OPS.clip: case OPS.eoClip: notes.add('clip'); break;
            case OPS.shadingFill: notes.add('shading'); break;
            case OPS.constructPath: paint(args); break;
            default: break;
        }
    }

    for (const run of text) {
        const str = run.str.replace(/\s+/g, ' ').trim();
        const [, b, c, d, e, f] = run.transform;
        const size = Math.hypot(c, d);
        if (!str || !(size > 0)) continue;
        if (Math.abs(b) > 1e-3 || Math.abs(c) > 1e-3) notes.add('rotated-text');
        const font = fontNameOf(run.fontName) ?? '';
        if (/italic|oblique/i.test(font)) notes.add('italic');
        notes.add('device-font');
        items.push({ kind: 'text', text: str, x: e - x0, baseline: y1 - f, size, bold: /bold|black|heavy|semibold|demi/i.test(font) });
    }

    return { width, height, items, notes: [...notes] };
}

export async function readPdfPageDrawing(page: PdfPageLike, OPS: Record<string, number>): Promise<Drawing> {
    const ops = await page.getOperatorList();
    const content = await page.getTextContent();
    const text = content.items.filter((item): item is TextItemLike =>
        typeof (item as TextItemLike)?.str === 'string' && Array.isArray((item as TextItemLike).transform));
    return extractDrawing({
        ops, text, view: page.view, OPS,
        fontNameOf: id => {
            try { return (page.commonObjs.get(id) as { name?: string } | undefined)?.name; } catch { return undefined; }
        },
    });
}
