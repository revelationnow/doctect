import { MARK, WEEKDAYS, type Page } from '../lib/page';
import type { TemplateDefinition } from '../lib/project';

// A framed block with its title in the first row and rules every `rule` mm below it.
const block = (p: Page, title: string, x: number, y: number, w: number, h: number, rule: number) => {
    p.rect('block_frame', x, y, w, h, { stroke: MARK, strokeWidth: 0.6, radius: 1 });
    p.caption(title, x + 2, y + 0.5, w - 4);
    const top = y;
    const rows = Math.floor((y + h - top - 1) / rule);
    if (rows > 0) p.ruled('block_lines', x + 2, top + rule, w - 4, (rows - 1) * rule + 0.5, rule);
    else p.row(y + h - top);
};

export const weekOnOnePage: TemplateDefinition = {
    slug: '04-week-on-one-page',
    listing: {
        name: 'Week on One Page',
        description: 'An undated week at a glance: a block for each day from Monday to Sunday and a focus box for what '
            + 'matters this week. Sized for reMarkable Paper Pro, Paper Pro Move, and 10.3″ devices '
            + '(reMarkable 2, Supernote, Boox).',
        tags: ['template', 'insert', 'weekly', 'undated', 'week', 'overview'],
    },
    draw(p) {
        p.heading('Week on One Page', ['Week of']);
        const b = p.box;
        const gap = 2.5;
        if (p.compact) {
            const rule = 6;
            const focusHeight = 3 * rule + 1;
            block(p, 'This week', b.x, b.y, b.w, focusHeight, rule);
            const dayHeight = (b.h - focusHeight - gap * 7) / 7;
            WEEKDAYS.forEach((day, i) => block(p, day, b.x, b.y + focusHeight + gap + i * (dayHeight + gap), b.w, dayHeight, rule));
            return;
        }
        const rule = 7;
        const columnWidth = (b.w - gap) / 2;
        const rowHeight = (b.h - gap * 3) / 4;
        ['This week', ...WEEKDAYS].forEach((title, i) => {
            const column = i % 2;
            const row = Math.floor(i / 2);
            block(p, title, b.x + column * (columnWidth + gap), b.y + row * (rowHeight + gap), columnWidth, rowHeight, rule);
        });
    },
};
