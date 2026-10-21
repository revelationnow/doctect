import { MARK, type Page } from '../lib/page';
import type { TemplateDefinition } from '../lib/project';

const ASPECT = 9 / 16;

// A 16:9 frame with shot and time write-ins and two caption lines beneath.
const panel = (p: Page, x: number, y: number, w: number, frameHeight: number, rule: number, meta: number) => {
    p.rect('frame', x, y, w, frameHeight, { stroke: MARK, strokeWidth: 0.8 });
    const metaTop = y + frameHeight + 0.5;
    const half = w / 2;
    p.field('Shot', x, metaTop, half - 2, meta);
    p.field('Time', x + half + 2, metaTop, half - 2, meta);
    p.ruled('caption', x, metaTop + meta + rule, w, rule + 0.5, rule);
};

export const storyboard: TemplateDefinition = {
    slug: '08-storyboard',
    listing: {
        name: 'Storyboard',
        description: 'Sketch a video, animation or comic shot by shot: 16:9 frames, each with shot number, timing and '
            + 'room for the action and dialogue. Sized for reMarkable Paper Pro, Paper Pro Move, and 10.3″ devices '
            + '(reMarkable 2, Supernote, Boox).',
        tags: ['template', 'insert', 'storyboard', 'film', 'animation', 'sketch'],
    },
    draw(p) {
        p.heading('Storyboard', ['Project', 'Page']);
        const b = p.box;
        const rule = p.compact ? 6 : 6.5;
        const meta = p.compact ? 4.5 : 5;
        const captionBlock = 0.5 + meta + 2 * rule + 0.5;
        const columns = p.compact ? 1 : 2;
        const rows = p.compact ? 2 : 3;
        const gapX = 6;
        const gapY = 4;
        // Widest frame that fits both the column width and the page height.
        const byWidth = (b.w - gapX * (columns - 1)) / columns;
        const byHeight = ((b.h - gapY * (rows - 1)) / rows - captionBlock) / ASPECT;
        const frameWidth = Math.min(byWidth, byHeight);
        const frameHeight = frameWidth * ASPECT;
        const cellHeight = frameHeight + captionBlock;
        const usedWidth = frameWidth * columns + gapX * (columns - 1);
        const x0 = b.x + (b.w - usedWidth) / 2;
        const spareY = b.h - cellHeight * rows - gapY * (rows - 1);
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < columns; c++) {
                panel(p, x0 + c * (frameWidth + gapX), b.y + spareY / 2 + r * (cellHeight + gapY), frameWidth, frameHeight, rule, meta);
            }
        }
    },
};
