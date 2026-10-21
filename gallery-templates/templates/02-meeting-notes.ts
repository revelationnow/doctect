import type { TemplateDefinition } from '../lib/project';

export const meetingNotes: TemplateDefinition = {
    slug: '02-meeting-notes',
    listing: {
        name: 'Meeting Notes',
        description: 'One page per meeting: who was there, the agenda, your notes, the decisions made and an action table '
            + 'with owners and due dates. Sized for reMarkable Paper Pro, Paper Pro Move, and 10.3″ devices '
            + '(reMarkable 2, Supernote, Boox).',
        tags: ['template', 'insert', 'meeting', 'notes', 'minutes', 'agenda'],
    },
    draw(p) {
        p.heading('Meeting Notes', ['Date']);
        const b = p.box;
        const rule = p.compact ? 6 : 7;
        let y = b.y;
        p.field('Meeting', b.x, y, b.w, rule); y += rule;
        const attendeeLines = p.compact ? 1 : 2;
        for (let i = 0; i < attendeeLines; i++) { p.field(i ? '' : 'Attendees', b.x, y, b.w, rule); y += rule; }
        y += 3;

        const agendaRows = p.compact ? 3 : 4;
        const decisionRows = 3;
        const actionRows = p.compact ? 3 : 5;
        const tableRow = p.compact ? 6 : 7;
        const tableHeader = 5;
        const captionBlock = 5.5;
        const gap = 3;
        const fixed = captionBlock * 4 + agendaRows * rule + decisionRows * rule + tableHeader + actionRows * tableRow + gap * 3;
        const noteRows = Math.floor((b.y + b.h - y - fixed) / rule);

        const section = (title: string, rows: number) => {
            const top = p.caption(title, b.x, y, b.w);
            p.ruled(title.toLowerCase(), b.x, top + rule, b.w, (rows - 1) * rule + 0.5, rule);
            y = top + rows * rule + gap;
        };
        section('Agenda', agendaRows);
        section('Notes', noteRows);
        section('Decisions', decisionRows);

        const tableTop = p.caption('Actions', b.x, y, b.w);
        const owner = p.compact ? 18 : 30;
        const due = p.compact ? 14 : 22;
        p.table('actions', b.x, tableTop, [b.w - owner - due, owner, due], tableHeader, actionRows, tableRow,
            ['Action', 'Owner', 'Due']);
    },
};
