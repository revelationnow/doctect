import { FAINT, GUIDE, type Page } from '../lib/page';
import type { TemplateDefinition } from '../lib/project';

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

// A row of weekday letters in circles, to circle today's.
const weekdayRow = (p: Page, x: number, y: number, h: number) => {
    const r = h / 2 - 0.4;
    DAY_LETTERS.forEach((letter, i) => {
        const cx = x + r + i * (2 * r + 1.6);
        p.circle('weekday', cx, y + h / 2, r, FAINT, 0.5);
        p.text('weekday_letter', cx - r, y, 2 * r, h, letter, { align: 'center', size: p.labelSize - 0.5 });
    });
};

// Hour labels with a write-on line per hour and a faint half-hour line between.
const schedule = (p: Page, x: number, y: number, w: number, firstHour: number, hours: number, rowHeight: number) => {
    const labelWidth = p.compact ? 7 : 9;
    for (let i = 0; i < hours; i++) {
        const top = y + i * rowHeight;
        const hour = String(firstHour + i).padStart(2, '0');
        p.text('hour', x, top, labelWidth - 1, rowHeight / 2, `${hour}:00`, { size: p.labelSize - 0.5, valign: 'top' });
        p.hline('hour_line', x + labelWidth, top + rowHeight, w - labelWidth, GUIDE);
        p.hline('half_hour_line', x + labelWidth, top + rowHeight / 2, w - labelWidth, FAINT, 0.4);
    }
    p.row(rowHeight);
};

export const dailyPage: TemplateDefinition = {
    slug: '03-daily-page',
    listing: {
        name: 'Daily Page',
        description: 'An undated daily page: circle the weekday, pick your top three, plan the day hour by hour, keep a '
            + 'to-do list and jot notes on dot grid. Sized for reMarkable Paper Pro, Paper Pro Move, and 10.3″ devices '
            + '(reMarkable 2, Supernote, Boox).',
        tags: ['template', 'insert', 'stationery', 'daily', 'undated', 'to-do'],
    },
    draw(p) {
        p.heading('Daily Page', ['Date']);
        const b = p.box;
        weekdayRow(p, b.x, b.y, p.compact ? 4.5 : 5);
        let y = b.y + (p.compact ? 4.5 : 5) + 3;

        if (p.compact) {
            const rule = 6;
            const top3 = p.caption('Top 3', b.x, y, b.w);
            p.checklist('top3', b.x, top3, b.w, 3, rule);
            y = top3 + 3 * rule + 3;
            const scheduleTop = p.caption('Schedule', b.x, y, b.w);
            const half = (b.w - 3) / 2;
            schedule(p, b.x, scheduleTop, half, 7, 7, 6);
            schedule(p, b.x + half + 3, scheduleTop, half, 14, 7, 6);
            y = scheduleTop + 7 * 6 + 3;
            const todoTop = p.caption('To do', b.x, y, b.w);
            p.checklist('todo', b.x, todoTop, b.w, 4, rule);
            y = todoTop + 4 * rule + 3;
            const notesTop = p.caption('Notes', b.x, y, b.w);
            p.dots('notes', b.x, notesTop, b.w, b.y + b.h - notesTop, 5);
            return;
        }

        const rule = 7;
        const leftWidth = b.w * 0.55;
        const rightX = b.x + leftWidth + 5;
        const rightWidth = b.x + b.w - rightX;
        const hours = 16;
        const hourHeight = Math.min(9, (b.h * 0.62) / hours);
        const scheduleTop = p.caption('Schedule', b.x, y, leftWidth);
        schedule(p, b.x, scheduleTop, leftWidth, 6, hours, hourHeight);
        const columnBottom = scheduleTop + hours * hourHeight;

        const top3 = p.caption('Top 3', rightX, y, rightWidth);
        p.checklist('top3', rightX, top3, rightWidth, 3, rule);
        const todoY = top3 + 3 * rule + 5;
        const todoTop = p.caption('To do', rightX, todoY, rightWidth);
        const todoRows = Math.floor((columnBottom - todoTop) / rule);
        p.checklist('todo', rightX, todoTop, rightWidth, todoRows, rule);

        const notesTop = p.caption('Notes', b.x, columnBottom + 5, b.w);
        p.dots('notes', b.x, notesTop, b.w, b.y + b.h - notesTop, 5);
        p.vline('column_divider', rightX - 2.5, y, columnBottom - y, FAINT);
    },
};
