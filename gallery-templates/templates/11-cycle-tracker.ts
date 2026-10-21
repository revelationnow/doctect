import { TINT, type Page } from '../lib/page';
import type { TemplateDefinition } from '../lib/project';

// Columns whose cells hold three circles to fill: 1 = light/low, 2 = medium, 3 = heavy/high.
const SCALED = new Set(['Flow', 'Pain', 'Mood', 'Energy']);

interface Column { title: string; width: number }

// Three small circles centred in a cell.
const scale = (p: Page, x: number, w: number, cy: number) => {
    const r = p.compact ? 1 : 1.15;
    const step = Math.min(w / 3, 4.2);
    const start = x + w / 2 - step;
    for (let i = 0; i < 3; i++) p.circle('scale', start + i * step, cy, r);
};

const block = (p: Page, columns: Column[], x: number, y: number, days: number[], rowHeight: number) => {
    const headerHeight = 8;
    days.forEach((day, i) => {
        if (i % 2 === 1) p.rect('row_tint', x, y + headerHeight + i * rowHeight, columns.reduce((s, c) => s + c.width, 0), rowHeight, { fill: TINT });
    });
    p.table('days', x, y, columns.map(c => c.width), headerHeight, days.length, rowHeight, [],
        { firstColumnLabels: days.map(String) });
    let cx = x;
    for (const column of columns) {
        const scaled = SCALED.has(column.title);
        p.text('column_title', cx + 0.5, y + 0.5, column.width - 1, scaled ? 4 : headerHeight - 1, column.title,
            { bold: true, align: 'center', size: p.labelSize - 0.5 });
        if (scaled) {
            const step = Math.min(column.width / 3, 4.2);
            ['1', '2', '3'].forEach((n, i) => p.text('scale_number', cx + column.width / 2 - step + i * step - 1.5, y + 4.6,
                3, 3.2, n, { align: 'center', size: p.labelSize - 1.5 }));
            days.forEach((_, i) => scale(p, cx, column.width, y + headerHeight + (i + 0.5) * rowHeight));
        }
        cx += column.width;
    }
    return headerHeight + days.length * rowHeight;
};

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

export const cycleTracker: TemplateDefinition = {
    slug: '11-cycle-tracker',
    listing: {
        name: 'Cycle Tracker',
        description: 'A simple monthly log for your cycle: one row per day to fill in flow, pain, mood and energy on a '
            + 'three-step scale, with room for temperature and notes. Plain logging only — no predictions. Undated. '
            + 'Sized for reMarkable Paper Pro, Paper Pro Move, and 10.3″ devices (reMarkable 2, Supernote, Boox).',
        tags: ['template', 'insert', 'stationery', 'cycle', 'period', 'tracker'],
    },
    draw(p) {
        p.heading('Cycle Tracker', ['Month']);
        const b = p.box;
        const keyHeight = 5;
        p.text('key', b.x, b.y, b.w, keyHeight,
            p.compact ? 'Fill one circle: 1 light/low · 2 medium · 3 heavy/high' : 'Fill one circle per column: 1 = light or low · 2 = medium · 3 = heavy or high',
            { size: p.labelSize - 0.5 });
        const top = b.y + keyHeight + 1.5;

        if (p.compact) {
            const gap = 3;
            const half = (b.w - gap) / 2;
            const columns = [{ title: 'Day', width: 6 }, { title: 'Flow', width: (half - 6) / 2 }, { title: 'Mood', width: (half - 6) / 2 }];
            const rowHeight = 5.5;
            const height = block(p, columns, b.x, top, range(1, 16), rowHeight);
            block(p, columns, b.x + half + gap, top, range(17, 31), rowHeight);
            const notesTop = p.caption('Notes', b.x, top + height + 4, b.w);
            const rule = 6;
            const rows = Math.floor((b.y + b.h - notesTop) / rule);
            p.ruled('notes', b.x, notesTop + rule, b.w, (rows - 1) * rule + 0.5, rule);
            return;
        }

        const wide = p.device.id === 'paper_pro';
        const titles = wide ? ['Day', 'Flow', 'Pain', 'Mood', 'Energy', 'Temp', 'Notes'] : ['Day', 'Flow', 'Pain', 'Mood', 'Temp', 'Notes'];
        const fixed: Record<string, number> = { Day: 9, Flow: 16, Pain: 16, Mood: 16, Energy: 16, Temp: 15 };
        const notesWidth = b.w - titles.filter(t => t !== 'Notes').reduce((sum, t) => sum + fixed[t], 0);
        const columns = titles.map(title => ({ title, width: title === 'Notes' ? notesWidth : fixed[title] }));
        const rowHeight = (b.y + b.h - top - 8) / 31;
        block(p, columns, b.x, top, range(1, 31), rowHeight);
    },
};
