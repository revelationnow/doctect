import type { TemplateDefinition } from '../lib/project';

export const chessScoreSheet: TemplateDefinition = {
    slug: '10-chess-score-sheet',
    listing: {
        name: 'Chess Score Sheet',
        description: 'Record your games move by move: event, round, board and players at the top and numbered rows '
            + 'for 60 moves (40 on the Paper Pro Move). Sized for reMarkable Paper Pro, Paper Pro Move, and 10.3″ '
            + 'devices (reMarkable 2, Supernote, Boox).',
        tags: ['template', 'insert', 'stationery', 'chess', 'score-sheet', 'tournament'],
    },
    draw(p) {
        p.heading('Chess Score Sheet');
        const b = p.box;
        const fieldRow = p.compact ? 6 : 7;
        const gap = 4;
        const pairs: string[][] = p.compact
            ? [['Event'], ['Date', 'Round'], ['White'], ['Black'], ['Result', 'Board']]
            : [['Event', 'Date'], ['Round', 'Board'], ['White', 'Black'], ['Result']];
        let y = b.y;
        for (const pair of pairs) {
            const w = (b.w - gap * (pair.length - 1)) / pair.length;
            pair.forEach((label, i) => p.field(label, b.x + i * (w + gap), y, w, fieldRow));
            y += fieldRow;
        }
        y += 5;

        const blocks = p.compact ? 2 : 3;
        const movesPerBlock = 20;
        const headerHeight = 5;
        const blockGap = p.compact ? 2.5 : 4;
        const blockWidth = (b.w - blockGap * (blocks - 1)) / blocks;
        const numberColumn = p.compact ? 6 : 8;
        const moveColumn = (blockWidth - numberColumn) / 2;
        const rowHeight = (b.y + b.h - y - headerHeight) / movesPerBlock;
        for (let block = 0; block < blocks; block++) {
            const first = block * movesPerBlock + 1;
            p.table(`moves_${block}`, b.x + block * (blockWidth + blockGap), y, [numberColumn, moveColumn, moveColumn],
                headerHeight, movesPerBlock, rowHeight, ['', 'White', 'Black'],
                { firstColumnLabels: Array.from({ length: movesPerBlock }, (_, i) => String(first + i)) });
        }
    },
};
