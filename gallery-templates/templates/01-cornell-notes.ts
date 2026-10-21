import { INK, MARK } from '../lib/page';
import type { TemplateDefinition } from '../lib/project';

export const cornellNotes: TemplateDefinition = {
    slug: '01-cornell-notes',
    listing: {
        name: 'Cornell Notes',
        description: 'The classic Cornell note-taking page: a cue column for questions and keywords beside ruled notes, '
            + 'and a summary box to sum up the page. Sized for reMarkable Paper Pro, Paper Pro Move, and 10.3″ '
            + 'devices (reMarkable 2, Supernote, Boox).',
        tags: ['template', 'insert', 'ruled', 'stationery', 'cornell', 'notes'],
    },
    draw(p) {
        p.heading('Cornell Notes', ['Date']);
        const b = p.box;
        const rule = p.compact ? 6 : 7;
        p.field('Topic', b.x, b.y, b.w, rule);

        const top = b.y + rule + 3;
        const summaryHeight = Math.round(b.h * (p.compact ? 0.18 : 0.2) / rule) * rule;
        const notesBottom = b.y + b.h - summaryHeight - 3;
        const cueWidth = b.w * (p.compact ? 0.28 : 0.3);
        const captionBottom = p.caption('Cues', b.x, top, cueWidth - 2);
        p.caption('Notes', b.x + cueWidth + 2, top, b.w - cueWidth - 2);
        const rows = Math.floor((notesBottom - captionBottom) / rule);
        p.ruled('notes', b.x, captionBottom + rule, b.w, rows * rule - rule + 0.5, rule);
        p.vline('cue_divider', b.x + cueWidth, top, captionBottom + rows * rule - top, MARK, 0.8);

        const summaryTop = b.y + b.h - summaryHeight;
        p.hline('summary_rule', b.x, summaryTop - 1.5, b.w, INK, 0.8);
        const summaryCaption = p.caption('Summary', b.x, summaryTop, b.w);
        const summaryRows = Math.floor((b.y + b.h - summaryCaption) / rule);
        p.ruled('summary', b.x, summaryCaption + rule, b.w, (summaryRows - 1) * rule + 0.5, rule);
    },
};
