import { WEEKDAYS_SHORT, type Page } from '../lib/page';
import type { TemplateDefinition } from '../lib/project';

const GROUPS: Array<[string, number]> = [
    ['Produce', 0.28], ['Dairy & eggs', 0.16], ['Meat & fish', 0.16], ['Pantry', 0.24], ['Other', 0.16],
];

// Grocery groups stacked in one column, sharing `height` by weight.
const groceryColumn = (p: Page, groups: Array<[string, number]>, x: number, y: number, w: number, height: number, rule: number) => {
    const total = groups.reduce((sum, [, weight]) => sum + weight, 0);
    const captionBlock = 5.5;
    const gap = 2;
    const rowsAvailable = Math.floor((height - groups.length * (captionBlock + gap)) / rule);
    let remaining = rowsAvailable;
    groups.forEach(([name, weight], i) => {
        const rows = i === groups.length - 1 ? remaining : Math.max(2, Math.round(rowsAvailable * weight / total));
        remaining -= rows;
        const top = p.caption(name, x, y, w);
        p.checklist(name.toLowerCase().replace(/\W+/g, '_'), x, top, w, rows, rule);
        y = top + rows * rule + gap;
    });
};

export const mealPlanGroceryList: TemplateDefinition = {
    slug: '07-meal-plan-grocery-list',
    listing: {
        name: 'Meal Plan & Grocery List',
        description: 'Plan breakfast, lunch and dinner for the week and build the shopping list beside it, grouped by '
            + 'aisle so the shop goes quicker. Undated. Sized for reMarkable Paper Pro, Paper Pro Move, and 10.3″ '
            + 'devices (reMarkable 2, Supernote, Boox).',
        tags: ['template', 'insert', 'meal-plan', 'grocery', 'cooking', 'weekly'],
    },
    draw(p) {
        p.heading('Meal Plan', ['Week of']);
        const b = p.box;
        const meals = ['Breakfast', 'Lunch', 'Dinner'];
        const headerHeight = 5;
        if (p.compact) {
            const dayColumn = 8;
            const rowHeight = 9;
            const mealWidth = (b.w - dayColumn) / 3;
            p.table('meals', b.x, b.y, [dayColumn, mealWidth, mealWidth, mealWidth], headerHeight, 7, rowHeight,
                ['', ...meals], { firstColumnLabels: WEEKDAYS_SHORT });
            const top = b.y + headerHeight + 7 * rowHeight + 4;
            const gap = 3;
            const half = (b.w - gap) / 2;
            groceryColumn(p, GROUPS.slice(0, 2), b.x, top, half, b.y + b.h - top, 5.5);
            groceryColumn(p, GROUPS.slice(2), b.x + half + gap, top, half, b.y + b.h - top, 5.5);
            return;
        }
        const gap = 5;
        const gridWidth = b.w * 0.6;
        const dayColumn = 11;
        const mealWidth = (gridWidth - dayColumn) / 3;
        const rowHeight = (b.h - headerHeight) / 7;
        p.table('meals', b.x, b.y, [dayColumn, mealWidth, mealWidth, mealWidth], headerHeight, 7, rowHeight,
            ['', ...meals], { firstColumnLabels: WEEKDAYS_SHORT });
        const listX = b.x + gridWidth + gap;
        groceryColumn(p, GROUPS, listX, b.y, b.x + b.w - listX, b.h, 7);
    },
};
