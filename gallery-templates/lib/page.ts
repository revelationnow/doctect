// Shared layout kit for the single-page gallery templates. Everything is measured in millimetres
// and converted to PDF points, so a 7 mm rule is 7 mm on every device; each template reflows its
// regions per device rather than shrinking one layout.

export const PT_PER_MM = 72 / 25.4;
export const mm = (value: number) => value * PT_PER_MM;

export interface Device {
    id: 'paper_pro' | 'eink_10_3' | 'move';
    name: string;
    width: number;  // pt
    height: number; // pt
    compact: boolean; // the Move: narrow enough that layouts change shape
    marginX: number;     // mm
    marginTop: number;   // mm
    marginBottom: number; // mm
    titleBand: number;   // mm, height of the heading row
}

export const DEVICES: Device[] = [
    { id: 'paper_pro', name: 'reMarkable Paper Pro', width: 509, height: 679, compact: false,
        marginX: 8, marginTop: 10, marginBottom: 8, titleBand: 8 },
    { id: 'eink_10_3', name: 'reMarkable 2 · Supernote · Boox 10.3″', width: 445, height: 592, compact: false,
        marginX: 8, marginTop: 10, marginBottom: 8, titleBand: 8 },
    { id: 'move', name: 'reMarkable Paper Pro Move', width: 260, height: 463, compact: true,
        marginX: 6, marginTop: 7, marginBottom: 6, titleBand: 7 },
];

// Greyscale, light guides so handwriting stands out on e-ink.
export const INK = '#1f1f1f';
export const LABEL = '#5a5a5a';
export const GUIDE = '#b3b3b3';
export const FAINT = '#d9d9d9';
export const TINT = '#f1f1f1';
export const MARK = '#8c8c8c';
export const FONT = 'inter';

// Smallest writing row each device allows (mm). Tests read rowsMm against these.
export const MIN_ROW_MM = { regular: 5, compact: 4.5 };

export interface RawElement {
    id: string;
    type: 'rect' | 'ellipse' | 'text' | 'line' | 'svg';
    x: number; y: number; w: number; h: number;
    rotation: number;
    fill: string; stroke: string; strokeWidth: number; opacity: number;
    [key: string]: unknown;
}

interface TextOptions {
    size?: number;
    bold?: boolean;
    color?: string;
    align?: 'left' | 'center' | 'right';
    valign?: 'top' | 'middle' | 'bottom';
}

// A page under construction. Coordinates passed to the drawing methods are millimetres from
// the page's top-left corner; `box` gives the writable region inside the margins and heading.
export class Page {
    readonly elements: RawElement[] = [];
    readonly rowsMm: number[] = [];
    private sequence = 0;

    constructor(readonly device: Device) {}

    get widthMm() { return this.device.width / PT_PER_MM; }
    get heightMm() { return this.device.height / PT_PER_MM; }
    get compact() { return this.device.compact; }
    get labelSize() { return this.compact ? 6.5 : 7; }

    // Writable region below the heading rule.
    get box() {
        const d = this.device;
        const top = d.marginTop + d.titleBand + 2;
        return {
            x: d.marginX,
            y: top,
            w: this.widthMm - 2 * d.marginX,
            h: this.heightMm - top - d.marginBottom,
        };
    }

    private add(type: RawElement['type'], role: string, x: number, y: number, w: number, h: number, extra: Record<string, unknown>) {
        const element: RawElement = {
            id: `${role}_${String(++this.sequence).padStart(3, '0')}`,
            type, x: mm(x), y: mm(y), w: mm(w), h: mm(h), rotation: 0,
            fill: '', stroke: '', strokeWidth: 0, opacity: 1,
            ...extra,
        };
        this.elements.push(element);
        return element;
    }

    // Records a writing row so tests can hold every template to the size floor.
    row(heightMm: number) { this.rowsMm.push(heightMm); }

    rect(role: string, x: number, y: number, w: number, h: number, style: { fill?: string; stroke?: string; strokeWidth?: number; radius?: number } = {}) {
        return this.add('rect', role, x, y, w, h, {
            fill: style.fill ?? '', stroke: style.stroke ?? '', strokeWidth: style.strokeWidth ?? 0,
            ...(style.radius ? { borderRadius: mm(style.radius) } : {}),
        });
    }

    hline(role: string, x: number, y: number, w: number, color = GUIDE, weight = 0.5) {
        return this.add('line', role, x, y, w, 0, { stroke: color, strokeWidth: weight });
    }

    vline(role: string, x: number, y: number, h: number, color = GUIDE, weight = 0.5) {
        return this.add('line', role, x, y, 0, h, { stroke: color, strokeWidth: weight });
    }

    circle(role: string, cx: number, cy: number, r: number, color = MARK, weight = 0.6) {
        return this.add('ellipse', role, cx - r, cy - r, 2 * r, 2 * r, { stroke: color, strokeWidth: weight });
    }

    checkbox(role: string, x: number, cy: number, size = this.compact ? 2.4 : 2.8) {
        return this.rect(role, x, cy - size / 2, size, size, { stroke: MARK, strokeWidth: 0.6, radius: 0.4 });
    }

    text(role: string, x: number, y: number, w: number, h: number, value: string, options: TextOptions = {}) {
        return this.add('text', role, x, y, w, h, {
            text: value,
            fontSize: options.size ?? this.labelSize,
            fontFamily: FONT,
            fontWeight: options.bold ? 'bold' : 'normal',
            textColor: options.color ?? LABEL,
            align: options.align ?? 'left',
            verticalAlign: options.valign ?? 'middle',
            textOverflow: 'clip',
            textWrap: false,
            textPadding: { top: 0, right: 0, bottom: 0, left: 0 },
        });
    }

    // Horizontal rules every `spacing` mm, the first on the area's top edge.
    ruled(role: string, x: number, y: number, w: number, h: number, spacing: number) {
        this.row(spacing);
        return this.add('rect', role, x, y, w, h, {
            fill: GUIDE, fillType: 'pattern', patternType: 'lines-h',
            patternSpacing: mm(spacing), patternWeight: 0.5,
        });
    }

    dots(role: string, x: number, y: number, w: number, h: number, spacing = 5) {
        this.row(spacing);
        return this.add('rect', role, x, y, w, h, {
            fill: MARK, fillType: 'pattern', patternType: 'dots',
            patternSpacing: mm(spacing), patternWeight: 0.9,
        });
    }

    svg(role: string, x: number, y: number, w: number, h: number, svgContent: string) {
        return this.add('svg', role, x, y, w, h, { svgContent });
    }

    // Template name on the left, optional write-in fields on the right, a rule beneath.
    heading(title: string, fields: string[] = []) {
        const d = this.device;
        const y = d.marginTop;
        const fullWidth = this.widthMm - 2 * d.marginX;
        const titleWidth = fields.length ? Math.min(fullWidth * 0.5, 60) : fullWidth;
        this.text('title', d.marginX, y, titleWidth, d.titleBand, title,
            { size: this.compact ? 10 : 12, bold: true, color: INK, valign: 'bottom' });
        if (fields.length) {
            const fieldsX = d.marginX + titleWidth + 3;
            const fieldWidth = (this.widthMm - d.marginX - fieldsX) / fields.length;
            fields.forEach((label, i) => this.field(label, fieldsX + i * fieldWidth + (i ? 2 : 0), y + d.titleBand - 5,
                fieldWidth - (i ? 2 : 0), 5));
        }
        this.hline('heading_rule', d.marginX, y + d.titleBand + 0.5, fullWidth, INK, 0.8);
    }

    // A small label followed by a write-on line, `h` mm tall, label sized to its text.
    field(label: string, x: number, y: number, w: number, h: number) {
        const labelWidth = label ? Math.min(w * 0.45, label.length * (this.labelSize * 0.19) + 1.5) : 0;
        if (label) this.text('field_label', x, y, labelWidth, h, label, { valign: 'bottom' });
        this.hline('field_line', x + labelWidth, y + h, w - labelWidth, GUIDE, 0.5);
        this.row(h);
    }

    // A section caption above a region.
    caption(value: string, x: number, y: number, w: number, h = 4.5) {
        this.text('caption', x, y, w, h, value.toUpperCase(), { bold: true, size: this.labelSize - 0.5, valign: 'bottom' });
        return y + h + 1;
    }

    // A checklist: one checkbox per rule.
    checklist(role: string, x: number, y: number, w: number, rows: number, spacing: number) {
        const size = this.compact ? 2.4 : 2.8;
        for (let i = 0; i < rows; i++) {
            const lineY = y + (i + 1) * spacing;
            this.checkbox(`${role}_box`, x, lineY - size / 2 - 0.8, size);
            this.hline(`${role}_line`, x + size + 2, lineY, w - size - 2);
        }
        this.row(spacing);
    }

    // Table rules: outer frame, row rules and column rules, header row labels.
    table(role: string, x: number, y: number, columns: number[], headerHeight: number, rows: number, rowHeight: number,
        headers: string[] = [], options: { firstColumnLabels?: string[]; headerSize?: number } = {}) {
        const w = columns.reduce((a, b) => a + b, 0);
        const h = headerHeight + rows * rowHeight;
        this.rect(`${role}_frame`, x, y, w, h, { stroke: MARK, strokeWidth: 0.6 });
        if (headerHeight > 0) this.hline(`${role}_header_rule`, x, y + headerHeight, w, MARK, 0.6);
        for (let r = 1; r < rows; r++) this.hline(`${role}_row`, x, y + headerHeight + r * rowHeight, w);
        let cx = x;
        columns.forEach((cw, c) => {
            if (c > 0) this.vline(`${role}_col`, cx, y, h, c === 1 && options.firstColumnLabels ? MARK : GUIDE);
            if (headers[c]) this.text(`${role}_head`, cx + 1, y, cw - 2, headerHeight, headers[c],
                { bold: true, size: options.headerSize ?? this.labelSize, align: 'center' });
            cx += cw;
        });
        options.firstColumnLabels?.forEach((label, r) => this.text(`${role}_label`, x + 1, y + headerHeight + r * rowHeight,
            columns[0] - 2, rowHeight, label, { align: 'center', size: this.labelSize }));
        this.row(rowHeight);
        return { w, h };
    }
}

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
