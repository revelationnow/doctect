import { TINT, type Page } from '../lib/page';
import type { TemplateDefinition } from '../lib/project';

const DAYS = 31;

// Days 8–14 and 22–28 are tinted so a row of 31 ticks is easy to count by week.
const isTintedDay = (day: number) => (day >= 8 && day <= 14) || (day >= 22 && day <= 28);

// Habit names down the side, one column per day.
const wideGrid = (p: Page, habits: number, nameWidth: number) => {
    const b = p.box;
    const dayWidth = (b.w - nameWidth) / DAYS;
    const headerHeight = 5;
    const rowHeight = Math.min(10, (b.h * 0.62 - headerHeight) / habits);
    const top = p.caption('Habits', b.x, b.y, nameWidth);
    const gridHeight = headerHeight + habits * rowHeight;
    for (let d = 1; d <= DAYS; d++) {
        const x = b.x + nameWidth + (d - 1) * dayWidth;
        if (isTintedDay(d)) p.rect('week_tint', x, top, dayWidth, gridHeight, { fill: TINT });
        p.text('day_number', x, top, dayWidth, headerHeight, String(d), { align: 'center', size: 5.5 });
    }
    p.table('habits', b.x, top, [nameWidth, ...Array(DAYS).fill(dayWidth)], headerHeight, habits, rowHeight);
    const reflectionTop = p.caption('Reflection', b.x, top + gridHeight + 5, b.w);
    const rule = 7;
    const rows = Math.floor((b.y + b.h - reflectionTop) / rule);
    p.ruled('reflection', b.x, reflectionTop + rule, b.w, (rows - 1) * rule + 0.5, rule);
};

// The Move is too narrow for 31 columns: number five habits in a key, then list the days
// down the page in two blocks of 16 and 15 with one column per habit.
const compactGrid = (p: Page) => {
    const b = p.box;
    const habits = 5;
    const keyRule = 5.5;
    let y = p.caption('Habits', b.x, b.y, b.w);
    for (let h = 1; h <= habits; h++) {
        p.field(`${h}`, b.x, y, b.w, keyRule);
        y += keyRule;
    }
    y += 3;
    const blockGap = 3;
    const blockWidth = (b.w - blockGap) / 2;
    const dayColumn = 6;
    const habitColumn = (blockWidth - dayColumn) / habits;
    const headerHeight = 5;
    const rows = 16;
    const rowHeight = (b.y + b.h - y - headerHeight) / rows;
    [[1, 16], [17, 31]].forEach(([from, to], blockIndex) => {
        const x = b.x + blockIndex * (blockWidth + blockGap);
        const days = Array.from({ length: to - from + 1 }, (_, i) => from + i);
        days.forEach((day, i) => {
            if (isTintedDay(day)) p.rect('week_tint', x, y + headerHeight + i * rowHeight, blockWidth, rowHeight, { fill: TINT });
        });
        p.table(`days_${blockIndex}`, x, y, [dayColumn, ...Array(habits).fill(habitColumn)], headerHeight, days.length, rowHeight,
            ['', ...Array.from({ length: habits }, (_, i) => String(i + 1))],
            { firstColumnLabels: days.map(String), headerSize: p.labelSize - 0.5 });
    });
};

export const monthlyHabitTracker: TemplateDefinition = {
    slug: '05-monthly-habit-tracker',
    listing: {
        name: 'Monthly Habit Tracker',
        description: 'Track your habits for a whole month on one page: write in your habits, tick each day you keep '
            + 'them, and note how the month went. Undated, so it works for any month. Sized for reMarkable Paper Pro, '
            + 'Paper Pro Move, and 10.3″ devices (reMarkable 2, Supernote, Boox).',
        tags: ['template', 'insert', 'stationery', 'habit', 'monthly', 'undated'],
    },
    draw(p) {
        p.heading('Habit Tracker', ['Month']);
        if (p.compact) compactGrid(p);
        else wideGrid(p, p.device.id === 'paper_pro' ? 12 : 10, p.device.id === 'paper_pro' ? 34 : 30);
    },
};
