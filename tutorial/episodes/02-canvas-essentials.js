// Episode 2 — Canvas essentials: designing a cover page.
// A blank A4 page becomes the cover of a family recipe book: the tools and
// their shortcuts, drag-to-create, selection and nudging, exact geometry,
// pattern fills and borders, text and fonts, alignment, zoom/pan/snap, undo.
import { episodeMeta } from './series.js';
import * as app from '../lib/app.js';

export const meta = episodeMeta(2, {
    description: 'We start from an empty A4 page and design the cover of a family recipe book. You\'ll learn every drawing tool '
        + 'and its shortcut, why a single click draws nothing, how selection, nudging and exact geometry work, pattern fills and '
        + 'borders, text and fonts, lining things up, and getting around the canvas with zoom, pan and snapping.',
    learn: [
        'Every drawing tool and its single-key shortcut',
        'Why you drag to draw, and why the tool stays active',
        'Handles, nudging, and exact sizes in Geometry',
        'Pattern fills, dashed borders and rounded corners',
        'Text boxes, searchable fonts, and remembered text settings',
        'Aligning a selection, zooming, panning and snapping',
    ],
    docs: ['/docs/editor/canvas-basics', '/docs/editor/elements-and-properties'],
    thumbnail: { beat: 20, headline: 'Canvas essentials' },
});

const PALETTE = ['#fdba74', '#fed7aa', '#ea580c', '#9a3412', '#7c2d12', '#0f172a', '#64748b', '#ffffff'];
const at = (page, x, y) => app.pagePoint(page, x, y);
const appearance = (page) => app.section(page, 'appearance');
const typography = (page) => app.section(page, 'typography');
const geometryInput = (page, i) => app.section(page, 'geometry').locator('input').nth(i);

async function chooseFont(ctx, search, name) {
    const ty = typography(ctx.page);
    await ctx.click(ty.locator('button:has(span:text-is("▼"))').first());
    await ctx.click(ty.getByPlaceholder('Search fonts...'));
    await ctx.type(search);
    await ctx.wait(400);
    await ctx.click(ty.getByRole('button', { name, exact: true }).first());
}

export async function setup(ctx) {
    await ctx.goto('/app');
    await app.editorReady(ctx.page);
    await ctx.wait(1200);
    await ctx.titleCard();
    await ctx.wait(900);
}

// Episode 3 carries on with this book.
export const teardown = (ctx) => app.saveFixture(ctx, '02-family-recipes-cover');

export const beats = [
    {
        chapter: 'Welcome', lowerThird: false,
        say: 'Last time we explored a finished planner. This time we start with an empty page and make something of our own: '
            + "the cover of a family recipe book. Along the way you'll meet every drawing tool, and the few rules the canvas plays by.",
    },
    {
        say: "This is a fresh, blank project: one A4 page. First, a name. The tab takes its name from the top page, so I'll call it Family Recipes.",
        do: async (page, ctx) => {
            await ctx.cardOut();
            await ctx.wait(700);
            await ctx.atSentence(2);
            await app.retype(ctx, app.nodeTitleInput(page), 'Family Recipes');
            await ctx.move(app.projectTab(page, 'Family Recipes'));
        },
    },
    {
        say: "And I'll zoom out one step, so the whole page fits on screen.",
        do: async (page, ctx) => {
            await ctx.click(app.zoomOutButton(page));
            await ctx.move(app.canvas(page), { ay: 0.4 });
        },
    },
    {
        chapter: 'The tools',
        say: 'Across the top are the tools. Select, and the hand, for panning. Then text, rectangle, ellipse, triangle, line, '
            + 'and the data grid, which gets an episode of its own. Each one has a single-letter shortcut.',
        do: async (page, ctx) => {
            await ctx.atSentence(1);
            await ctx.move(app.toolbarButton(page, 'Select Tool (V)'));
            await ctx.move(app.toolbarButton(page, 'Pan Tool (H)'));
            await ctx.atSentence(2);
            for (const t of ['Text Box (T)', 'Rectangle (R)', 'Circle/Ellipse (E)', 'Triangle (Y)', 'Line (L)', 'Data Grid (G)']) {
                await ctx.move(app.toolbarButton(page, t), { duration: 380 });
                await ctx.wait(220);
            }
            await ctx.atSentence(3);
            for (const k of ['V', 'H', 'T', 'R', 'E', 'Y', 'L', 'G']) {
                await ctx.showKeys([k]);
                await ctx.wait(260);
            }
        },
    },
    {
        chapter: "Drag, don't click",
        say: "Press R for the rectangle. Now, here's the rule that catches everyone the first time. A single click draws nothing. You have to drag.",
        do: async (page, ctx) => {
            await ctx.tool('r');
            await ctx.atSentence(2);
            await ctx.click(await at(page, 300, 420));
            await ctx.move(await at(page, 330, 470));
        },
    },
    {
        say: 'Press, drag to the opposite corner, and let go.',
        do: async (page, ctx) => {
            await ctx.drag(await at(page, 40, 40), await at(page, 556, 806), { duration: 1300 });
        },
    },
    {
        say: 'The tool stays active after you draw, so dragging again makes a second rectangle, not a moved first one. Control Z takes it back.',
        do: async (page, ctx) => {
            await ctx.drag(await at(page, 180, 200), await at(page, 380, 330), { duration: 900 });
            await ctx.atSentence(1);
            await ctx.press('Control+z');
        },
    },
    {
        chapter: 'Selecting and moving',
        say: 'Press V for the select tool, and click the rectangle. You get eight handles for resizing, a rotate handle on top, '
            + 'and this small dot in the middle: the pivot it turns around.',
        do: async (page, ctx) => {
            await ctx.tool('v');
            await ctx.click(await at(page, 420, 600));
            await ctx.atSentence(1);
            await ctx.move(await at(page, 556, 806));
            await ctx.move(await at(page, 556, 420), { duration: 700 });
            await ctx.move(await at(page, 298, 10), { duration: 800 });
            await ctx.atSentence(2);
            await ctx.move(await at(page, 298, 423));
        },
    },
    {
        say: 'Drag it to move it. The arrow keys nudge it one point at a time, or ten with Shift held.',
        do: async (page, ctx) => {
            await ctx.drag(await at(page, 420, 600), await at(page, 450, 625));
            await ctx.atSentence(1);
            await ctx.press('ArrowLeft');
            await ctx.press('ArrowLeft');
            await ctx.wait(300);
            await ctx.press('Shift+ArrowUp');
        },
    },
    {
        say: 'For exact numbers, Geometry, on the right, takes typed values. I want this card 24 points in from every edge: '
            + 'X and Y of 24, a width of 547, and a height of 794.',
        do: async (page, ctx) => {
            await ctx.move(app.section(page, 'geometry'), { ay: 0.2 });
            await ctx.atSentence(1);
            for (const [i, v] of [[0, 24], [1, 24], [2, 547], [3, 794]]) {
                await app.retype(ctx, geometryInput(page, i), v, { commit: 'Enter' });
                await ctx.wait(200);
            }
        },
    },
    {
        chapter: 'Fills and borders',
        say: "Now the look. Fill can be a color, or a pattern. I'll switch it to Pattern, choose Dots, and pick a soft peach.",
        do: async (page, ctx) => {
            await ctx.move(appearance(page), { ay: 0.1 });
            await ctx.atSentence(1);
            await ctx.pick(appearance(page).locator('select:has(option[value="pattern"])'), 'Pattern');
            await ctx.pick(appearance(page).locator('select:has(option[value="dots"])'), 'Dots');
            await ctx.atSentence(2, { offset: 1.2 });
            await ctx.pickColor(appearance(page).locator('input[type=color]').first(), '#fdba74', PALETTE);
        },
    },
    {
        say: "That's dot grid paper, made from one rectangle. The PDF stores it as a single repeating pattern rather than thousands of dots, so the file stays small.",
        do: async (page, ctx) => {
            await ctx.move(await at(page, 180, 300));
            await ctx.move(await at(page, 420, 520), { duration: 1400 });
        },
    },
    {
        say: 'For the border, a darker orange, two points wide, and dashed. And Radius rounds the corners off.',
        do: async (page, ctx) => {
            const ap = appearance(page);
            await ctx.pickColor(ap.locator('input[type=color]').nth(1), '#ea580c', PALETTE);
            await app.retype(ctx, ap.locator('input[placeholder="W"]'), 2);
            await ctx.pick(ap.locator('select:has(option[value="dashed"])'), 'Dashed');
            await ctx.atSentence(1);
            await app.retype(ctx, ap.locator('label:text-is("Radius") + input'), 16);
        },
    },
    {
        chapter: 'Text and fonts',
        say: 'Press T for text. Text is the one tool where a single click does make something: a small box that grows as you type. '
            + "For a title, though, I'd rather drag out the full width, so it stays centered.",
        do: async (page, ctx) => {
            await ctx.tool('t');
            await ctx.atSentence(2);
            await ctx.drag(await at(page, 64, 286), await at(page, 532, 350), { duration: 1100 });
        },
    },
    {
        say: 'Type the title, then press Escape. That commits the text and drops you back to the select tool.',
        do: async (page, ctx) => {
            await ctx.type('Family Recipes', { wpm: 150 });
            await ctx.atSentence(1);
            await ctx.press('Escape');
        },
    },
    {
        say: "The font picker is searchable. I'll type play, and take Playfair Display. After that, a bigger size, bold, and a deep brown.",
        do: async (page, ctx) => {
            await chooseFont(ctx, 'play', 'Playfair Display');
            await ctx.atSentence(2);
            const ty = typography(page);
            await app.retype(ctx, ty.locator('input[type=number]').first(), 44);
            await ctx.click(ty.locator('button:has(svg.lucide-bold)').first());
            await ctx.pickColor(ty.locator('input[type=color]').first(), '#7c2d12', PALETTE);
        },
    },
    {
        say: 'Now a subtitle, dragged out the same way. Notice it starts with the same font, size and color as the title. '
            + 'The text tool remembers your last settings. This one needs to be smaller, so 18 points, and italic instead of bold.',
        do: async (page, ctx) => {
            await ctx.tool('t');
            await ctx.drag(await at(page, 64, 360), await at(page, 532, 396), { duration: 900 });
            await ctx.type('Tried, tested, and handed down', { wpm: 170 });
            await ctx.press('Escape');
            await ctx.atSentence(2);
            const ty = typography(page);
            await app.retype(ctx, ty.locator('input[type=number]').first(), 18);
            await ctx.click(ty.locator('button:has(svg.lucide-bold)').first());
            await ctx.click(ty.locator('button:has(svg.lucide-italic)').first());
        },
    },
    {
        chapter: 'Shapes and alignment',
        say: 'A circle for a little decoration. E for ellipse, and hold Shift as you drag, to keep it perfectly round.',
        do: async (page, ctx) => {
            await ctx.tool('e');
            await ctx.atSentence(1, { offset: 0.6 });
            await ctx.drag(await at(page, 240, 112), await at(page, 352, 226), { hold: 'Shift', duration: 900 });
        },
    },
    {
        say: 'A solid peach fill, and no border.',
        do: async (page, ctx) => {
            await ctx.pickColor(appearance(page).locator('input[type=color]').first(), '#fed7aa', PALETTE);
            await ctx.click(appearance(page).locator('button[title="Clear stroke color"]'));
        },
    },
    {
        say: 'And a short line under the title. L for line, and drag it across.',
        do: async (page, ctx) => {
            await ctx.tool('l');
            // a hand-drawn line is never perfectly level; a level one (zero height) doesn't show on the canvas
            await ctx.drag(await at(page, 230, 414), await at(page, 366, 415.2), { duration: 800 });
            const ap = appearance(page);
            await ctx.pickColor(ap.locator('input[type=color]').nth(1), '#ea580c', PALETTE);
            await app.retype(ctx, ap.locator('input[placeholder="W"]'), 2);
        },
    },
    {
        say: "Is everything centered? Not quite. I'll select it all by dragging a box from outside the page, and the toolbar grows a row of "
            + 'alignment buttons. Align Center lines up every middle, halfway between the outermost edges, which here are the card\'s.',
        do: async (page, ctx) => {
            await ctx.tool('v');
            await ctx.atSentence(1);
            const tl = await at(page, -40, 60);
            const br = await at(page, 640, 450);
            await ctx.drag(tl, br, { duration: 1200 });
            await ctx.atSentence(2, { offset: 1.5 });
            await ctx.click(app.toolbarButton(page, 'Align Center (Horizontal)'));
        },
    },
    {
        chapter: 'Zoom, pan and snap',
        say: 'To look closer, hold Control and scroll. The zoom centers on wherever the pointer is. The hand tool, H, drags the view around, '
            + 'and so does holding down the middle mouse button.',
        do: async (page, ctx) => {
            await ctx.click(await at(page, -70, 520)); // empty canvas clears the selection
            await ctx.wheel(-420, { at: await at(page, 298, 330), ctrl: true, steps: 8 });
            await ctx.atSentence(2);
            await ctx.tool('h');
            const from = await at(page, 300, 420);
            await ctx.drag(from, { x: from.x - 120, y: from.y - 160 }, { duration: 900 });
            await ctx.tool('v');
        },
    },
    {
        say: "The magnet turns on snapping, and shows the grid it snaps to. The grid gets finer as you zoom in, so it doesn't fight you "
            + "on detail work. I'll switch both off again.",
        do: async (page, ctx) => {
            await ctx.click(app.toolbarButton(page, 'Snap to Grid'));
            await ctx.atSentence(2);
            await ctx.click(app.toolbarButton(page, 'Snap to Grid'));
            await ctx.click(app.toolbarButton(page, 'Show Grid'));
            await ctx.wheel(420, { at: await at(page, 298, 330), ctrl: true, steps: 8 });
        },
    },
    {
        chapter: 'Undo, and saving',
        say: 'If anything goes wrong, Control Z steps back, and Control Y steps forward again. And there is no save button to forget. '
            + 'This badge shows the project is saved in your browser as you work.',
        do: async (page, ctx) => {
            await ctx.press('Control+z');
            await ctx.wait(900);
            await ctx.press('Control+y');
            await ctx.atSentence(2);
            await ctx.move(page.getByText('Saved locally').first());
        },
    },
    {
        chapter: 'The result',
        say: "Let's see it as a PDF.",
        do: async (page, ctx) => {
            ctx.state.pdf = await ctx.download(() => ctx.click(page.getByRole('button', { name: 'Export PDF' }).first()));
            await ctx.wait(1200);
            await ctx.openPdf(ctx.state.pdf, { title: 'Family Recipes.pdf' });
            await ctx.move({ x: 1000, y: 500 });
        },
    },
    {
        say: 'One page, exactly as designed. In the next episode, we turn this cover into a whole recipe notebook, '
            + 'with a page template that fills itself in for every recipe.',
        hold: 3,
        do: async (page, ctx) => {
            await ctx.atSentence(1);
            await ctx.endCard();
        },
    },
];
