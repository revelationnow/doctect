import { GUIDE, WEEKDAYS_SHORT } from '../lib/page';
import type { TemplateDefinition } from '../lib/project';

export const familyWeekBoard: TemplateDefinition = {
    slug: '06-family-week-board',
    listing: {
        name: 'Family Week Board',
        description: 'Everyone\'s week on one page: a column for each family member and one for the whole family, a row '
            + 'for each day, and a strip for reminders. Write the names in once and plan school, clubs, lifts and '
            + 'meals together. Sized for reMarkable Paper Pro, Paper Pro Move, and 10.3″ devices '
            + '(reMarkable 2, Supernote, Boox).',
        tags: ['template', 'insert', 'family', 'weekly', 'household', 'schedule'],
    },
    draw(p) {
        p.heading('Family Week', ['Week of']);
        const b = p.box;
        const members = p.compact ? 3 : 4;
        const together = !p.compact;
        const dayColumn = p.compact ? 9 : 13;
        const reminders = p.compact ? 22 : 34;
        const headerHeight = 9;
        const columnCount = members + (together ? 1 : 0);
        const memberWidth = (b.w - dayColumn) / columnCount;
        const rowHeight = (b.h - reminders - 4 - headerHeight) / 7;

        p.table('board', b.x, b.y, [dayColumn, ...Array(columnCount).fill(memberWidth)], headerHeight, 7, rowHeight,
            ['', ...Array(members).fill(''), ...(together ? ['Everyone'] : [])],
            { firstColumnLabels: WEEKDAYS_SHORT });
        // A write-on line in each member's header for their name.
        for (let m = 0; m < members; m++) {
            const x = b.x + dayColumn + m * memberWidth;
            p.text('name_hint', x + 1.5, b.y + 0.5, memberWidth - 3, 3.5, 'Name', { size: p.labelSize - 1.5 });
            p.hline('name_line', x + 1.5, b.y + headerHeight - 1.5, memberWidth - 3, GUIDE);
        }
        // Light rules inside each day cell for more than one entry.
        const innerRule = 6;
        const innerRows = Math.floor(rowHeight / innerRule);
        if (innerRows > 1) {
            for (let d = 0; d < 7; d++) {
                const top = b.y + headerHeight + d * rowHeight;
                p.ruled('cell_lines', b.x + dayColumn + 1, top + rowHeight / innerRows, b.w - dayColumn - 2,
                    (innerRows - 2) * (rowHeight / innerRows) + 0.5, rowHeight / innerRows);
            }
        }

        const reminderTop = p.caption('Reminders', b.x, b.y + b.h - reminders, b.w);
        const rule = p.compact ? 6 : 7;
        const rows = Math.floor((b.y + b.h - reminderTop) / rule);
        p.ruled('reminders', b.x, reminderTop + rule, b.w, (rows - 1) * rule + 0.5, rule);
    },
};
