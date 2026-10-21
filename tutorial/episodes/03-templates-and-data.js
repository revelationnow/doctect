// Episode 3 — Pages, templates & data binding: a recipe notebook.
// Continues Episode 2's cover: pages as nodes, templates as designs, a second
// template sized and furnished by copy and paste, {{title}} placeholders and
// the Preview selector, per-page data fields (and the blank a missing one
// leaves), then a field inherited from the cover and overridden on one page.
import { episodeMeta } from './series.js';
import * as app from '../lib/app.js';

export const meta = episodeMeta(3, {
    description: 'The recipe-book cover from Episode 2 becomes a notebook. We add pages to the hierarchy, give them a template of '
        + 'their own, and use placeholders and data fields so every page fills in its own name, servings and cooking time, '
        + 'plus a field every page inherits from the cover.',
    learn: [
        'How pages (nodes) and templates fit together',
        'Adding, renaming and duplicating pages',
        'Creating a template, sizing it, and copying elements between templates',
        'Placeholders like {{title}}, and the Preview selector',
        'Data fields, Insert Data Field, and why a missing field comes out blank',
        'Fields inherited from parent pages, and overriding them on one page',
    ],
    docs: ['/docs/editor/data-binding', '/docs/reference/node-data-fields'],
    thumbnail: { beat: 25, headline: 'Templates & data' },
});

const PALETTE = ['#fdba74', '#fed7aa', '#ea580c', '#9a3412', '#7c2d12', '#0f172a', '#64748b', '#ffffff'];
const at = (page, x, y) => app.pagePoint(page, x, y);
const typography = (page) => app.section(page, 'typography');
const geometryInput = (page, i) => app.section(page, 'geometry').locator('input').nth(i);
const textContent = (page) => app.propertiesColumn(page).getByPlaceholder('Text content or {{field}}');
const fieldInput = (page, name) => app.propertiesColumn(page).locator(`label:text-is("${name}")`).locator('xpath=../../input');

async function chooseFont(ctx, search, name) {
    const ty = typography(ctx.page);
    await ctx.click(ty.locator('button:has(span:text-is("▼"))').first());
    await ctx.click(ty.getByPlaceholder('Search fonts...'));
    await ctx.type(search);
    await ctx.wait(400);
    await ctx.click(ty.getByRole('button', { name, exact: true }).first());
}

/** Hovers a sidebar row so its action buttons appear, then clicks one. */
async function rowAction(ctx, row, title) {
    await ctx.hover(row.locator('span.truncate').first(), 350);
    await ctx.click(row.locator(title ? `button[title="${title}"]` : 'button').first());
}

/** Node Properties → Data Fields → Add, then the field's value. */
async function addField(ctx, name, value) {
    await ctx.click(app.propertiesColumn(ctx.page).getByRole('button', { name: 'Add', exact: true }).first());
    await ctx.type(name, { wpm: 190 });
    await ctx.press('Enter', { chip: false });
    await ctx.click(fieldInput(ctx.page, name));
    await ctx.type(value, { wpm: 190 });
}

const showTemplates = async (ctx, name) => {
    await ctx.click(app.sidebarTab(ctx.page, 'Templates'));
    if (name) await app.selectTemplate(ctx, name);
};
const showHierarchy = (ctx) => ctx.click(app.sidebarTab(ctx.page, 'Hierarchy'));

export async function setup(ctx) {
    await ctx.goto('/app');
    await app.editorReady(ctx.page);
    await app.loadFixture(ctx, '02-family-recipes-cover');
    await ctx.wait(1200);
    await ctx.titleCard();
    await ctx.wait(900);
}

// Episode 4 adds an index page to this notebook.
export const teardown = (ctx) => app.saveFixture(ctx, '03-recipe-notebook');

export const beats = [
    {
        chapter: 'Welcome', lowerThird: false,
        say: "Here's the cover we made last time. A recipe book needs recipes, so in this episode we'll add pages, give them a design "
            + 'of their own, and have each page fill in its own details.',
        do: async (page, ctx) => {
            await ctx.wait(2500);
            await ctx.cardOut();
            await ctx.move(app.canvas(page), { ay: 0.45 });
        },
    },
    {
        chapter: 'Pages and templates',
        say: 'Two ideas carry the whole app. The first is the hierarchy, on the left. Every page in your document is a node in this tree, '
            + "and right now there's just one: Family Recipes.",
        do: async (page, ctx) => {
            await ctx.atSentence(1);
            await ctx.move(app.sidebarColumn(page), { ay: 0.3 });
            await ctx.atSentence(2);
            await ctx.spotlight(app.nodeRow(page, 'Family Recipes'), '', 6);
            await ctx.move(app.nodeRow(page, 'Family Recipes').locator('span.truncate'));
        },
    },
    {
        say: "The second idea is templates. A node doesn't hold a design itself. It points at a template, which holds the shapes and the text. "
            + 'This cover points at one called A4 Blank.',
        do: async (page, ctx) => {
            await ctx.unspotlight();
            await ctx.atSentence(2);
            await ctx.spotlight(app.assignedTemplateSelect(page), '', 6);
            await ctx.move(app.assignedTemplateSelect(page));
        },
    },
    {
        chapter: 'Adding pages',
        say: 'To add a page inside the cover, hover its row and click the plus. There is the new page, tucked underneath. '
            + 'Select it, and it looks exactly like the cover.',
        do: async (page, ctx) => {
            await ctx.unspotlight();
            await rowAction(ctx, app.nodeRow(page, 'Family Recipes'), 'Add New Page');
            await ctx.atSentence(1);
            await ctx.move(app.nodeRow(page, 'New Page').locator('span.truncate'));
            await ctx.atSentence(2);
            await app.selectNode(ctx, 'New Page');
            await ctx.move(app.canvas(page), { ay: 0.4 });
        },
    },
    {
        say: "That's because a new page borrows the first template in the project, and so far there's only one. "
            + "I'll give it a name before we fix that: Tomato Soup.",
        do: async (page, ctx) => {
            await ctx.atSentence(1);
            await app.retype(ctx, app.nodeTitleInput(page), 'Tomato Soup');
        },
    },
    {
        chapter: 'A recipe template',
        say: 'Templates live behind this switch at the top. New Template adds an empty one, and the pencil renames it. '
            + "I'll call it Recipe.",
        do: async (page, ctx) => {
            await showTemplates(ctx);
            await ctx.atSentence(1);
            await ctx.click(app.sidebarColumn(page).getByRole('button', { name: 'New Template' }));
            await rowAction(ctx, app.templateRow(page, 'New Template'));
            await ctx.page.keyboard.press('Control+a');
            await ctx.type('Recipe', { wpm: 170 });
            await ctx.press('Enter', { chip: false });
        },
    },
    {
        say: 'One thing to watch for. New templates start at the size of a [reMarkable](=remarkable) Paper Pro, not A4. '
            + 'Page Presets, in Template Settings, makes it A4 to match the cover.',
        do: async (page, ctx) => {
            await ctx.move(app.canvas(page), { ax: 0.9, ay: 0.5 });
            await ctx.atSentence(2);
            await ctx.pick(app.propertiesColumn(page).locator('label:text-is("Page Presets") + select'), 'A4');
        },
    },
    {
        say: "I'd like the same dotted card as the cover. So I'll open the cover's template, click the card, and copy it with Control C.",
        do: async (page, ctx) => {
            await ctx.atSentence(1);
            await app.selectTemplate(ctx, 'A4 Blank');
            await ctx.click(await at(page, 110, 640));
            await ctx.press('Control+c');
        },
    },
    {
        say: 'Back to Recipe, and paste with Control V. Pasted things always land twenty points down and to the right, '
            + "even on a different template, so I'll set X and Y back to 24.",
        do: async (page, ctx) => {
            await app.selectTemplate(ctx, 'Recipe');
            await ctx.press('Control+v');
            await ctx.atSentence(1, { end: true });
            await app.retype(ctx, geometryInput(page, 0), 24, { commit: 'Enter' });
            await app.retype(ctx, geometryInput(page, 1), 24, { commit: 'Enter' });
        },
    },
    {
        chapter: 'Assigning it',
        say: 'Now the template needs a page to use it. Back in the hierarchy, select Tomato Soup, and set its Assigned Template to Recipe. '
            + 'The cover keeps its own design.',
        do: async (page, ctx) => {
            await ctx.atSentence(1);
            await showHierarchy(ctx);
            await app.selectNode(ctx, 'Tomato Soup');
            await ctx.pick(app.assignedTemplateSelect(page), 'Recipe');
            await ctx.atSentence(2);
            await app.selectNode(ctx, 'Family Recipes');
        },
    },
    {
        chapter: 'Placeholders',
        say: 'Every recipe needs its name at the top. But if I type Tomato Soup into the template, every recipe will be called Tomato Soup. '
            + 'What the template needs is a placeholder.',
        do: async (page, ctx) => {
            await showTemplates(ctx, 'Recipe');
            await ctx.move(await at(page, 300, 90));
        },
    },
    {
        say: 'Drag out a text box, and type the word title inside double curly braces. Press Escape, and the placeholder turns into '
            + 'the name of the page: Tomato Soup.',
        do: async (page, ctx) => {
            await ctx.tool('t');
            await ctx.drag(await at(page, 60, 66), await at(page, 536, 112), { duration: 1000 });
            await ctx.type('{{title}}', { wpm: 120 });
            await ctx.atSentence(1);
            await ctx.press('Escape');
        },
    },
    {
        say: 'And which page is it showing? The one picked in Preview, up here. While you design, it decides whose details fill the placeholders. '
            + 'And title works everywhere, because every page has one.',
        do: async (page, ctx) => {
            await ctx.spotlight(app.previewSelect(page), '', 6);
            await ctx.move(app.previewSelect(page));
            await ctx.atSentence(2);
            await ctx.unspotlight();
            await ctx.move(await at(page, 300, 92));
        },
    },
    {
        say: 'Now to style it like the cover: Playfair Display, 34 points, bold, and the same deep brown. '
            + 'The styling lives on the template too, so every recipe page gets it.',
        do: async (page, ctx) => {
            await chooseFont(ctx, 'play', 'Playfair Display');
            const ty = typography(page);
            await app.retype(ctx, ty.locator('input[type=number]').first(), 34);
            await ctx.click(ty.locator('button:has(svg.lucide-bold)').first());
            await ctx.pickColor(ty.locator('input[type=color]').first(), '#7c2d12', PALETTE);
        },
    },
    {
        chapter: 'More pages, quickly',
        say: 'On to the other recipes. In the hierarchy, Duplicate, on the row, copies a page along with its template. '
            + "The copy arrives with Copy on the end of its name, so I'll rename it Banana Bread, then duplicate that one for a Weeknight Pad Thai.",
        do: async (page, ctx) => {
            await showHierarchy(ctx);
            await ctx.atSentence(1, { offset: 1.5 });
            await rowAction(ctx, app.nodeRow(page, 'Tomato Soup'), 'Duplicate');
            await ctx.atSentence(2);
            await app.selectNode(ctx, 'Tomato Soup (Copy)');
            await app.retype(ctx, app.nodeTitleInput(page), 'Banana Bread');
            await rowAction(ctx, app.nodeRow(page, 'Banana Bread'), 'Duplicate');
            await app.selectNode(ctx, 'Banana Bread (Copy)');
            await app.retype(ctx, app.nodeTitleInput(page), 'Weeknight Pad Thai');
        },
    },
    {
        say: 'Click through them, and each one shows its own name. One template, three pages, and nothing on the template had to change.',
        do: async (page, ctx) => {
            for (const title of ['Tomato Soup', 'Banana Bread', 'Weeknight Pad Thai']) {
                await app.selectNode(ctx, title);
                await ctx.wait(700);
            }
        },
    },
    {
        chapter: 'Data fields',
        say: 'A recipe card wants more than a name, though: how many it serves, and how long it takes. Those go in data fields. '
            + 'Select Tomato Soup, click Add, and call the field servings.',
        do: async (page, ctx) => {
            await app.selectNode(ctx, 'Tomato Soup');
            await ctx.atSentence(1);
            await ctx.move(app.propertiesColumn(page).locator('label:text-is("Data Fields")'));
            await ctx.atSentence(2, { offset: 1.2 });
            await ctx.click(app.propertiesColumn(page).getByRole('button', { name: 'Add', exact: true }).first());
            await ctx.type('servings', { wpm: 170 });
            await ctx.press('Enter', { chip: false });
        },
    },
    {
        say: 'Give it a value: 4. And a second field, time, set to 35 minutes. Values are plain text, so write them however reads best.',
        do: async (page, ctx) => {
            await ctx.click(fieldInput(page, 'servings'));
            await ctx.type('4');
            await ctx.atSentence(1);
            await addField(ctx, 'time', '35 minutes');
        },
    },
    {
        say: "Over in the template, I'll add a second line, under the title: a text box that starts with the word Serves. "
            + "It picked up the title's style, so I'll make it 16 points, and not bold.",
        do: async (page, ctx) => {
            await showTemplates(ctx, 'Recipe');
            await ctx.tool('t');
            await ctx.drag(await at(page, 60, 118), await at(page, 536, 146), { duration: 900 });
            await ctx.type('Serves ', { wpm: 150 });
            await ctx.press('Escape');
            await ctx.atSentence(1);
            const ty = typography(page);
            await app.retype(ctx, ty.locator('input[type=number]').first(), 16);
            await ctx.click(ty.locator('button:has(svg.lucide-bold)').first());
        },
    },
    {
        say: "Now the fields. The buttons under Insert Data Field add placeholders for you, so there's nothing to misspell. "
            + 'Servings, a separator, and time.',
        do: async (page, ctx) => {
            await ctx.move(app.propertiesColumn(page).getByText('Insert Data Field:'));
            await ctx.atSentence(1);
            await ctx.click(app.propertiesColumn(page).locator('button[title="Insert {{servings}}"]'));
            const box = await textContent(page).boundingBox();
            await ctx.click({ x: box.x + box.width - 14, y: box.y + box.height - 12 });
            await ctx.page.keyboard.press('Control+End');
            await ctx.type(' · ', { wpm: 120 });
            await ctx.click(app.propertiesColumn(page).locator('button[title="Insert {{time}}"]'));
            await ctx.move(await at(page, 300, 133));
        },
    },
    {
        say: "Here's the catch. Switch the preview to Banana Bread, and the line just says Serves. Banana Bread has no fields yet, "
            + 'and a missing field comes out blank. No error, and no warning. So it pays to flip through the preview now and then.',
        do: async (page, ctx) => {
            await ctx.pick(app.previewSelect(page), 'Banana Bread');
            await ctx.move(await at(page, 200, 134));
        },
    },
    {
        say: 'Fields belong to each page, so Banana Bread gets its own: servings 8, and an hour and ten minutes. '
            + 'Field names have to match exactly, capitals included. Servings with a capital S would be a different field.',
        do: async (page, ctx) => {
            await showHierarchy(ctx);
            await app.selectNode(ctx, 'Banana Bread');
            await addField(ctx, 'servings', '8');
            await addField(ctx, 'time', '1 hour 10 minutes');
        },
    },
    {
        say: 'And the same two fields for the Pad Thai: serves 2, in 25 minutes. For three recipes, typing fields in by hand is fine. '
            + 'For dozens, the generator in episode 10 builds the pages and their fields from code.',
        do: async (page, ctx) => {
            await app.selectNode(ctx, 'Weeknight Pad Thai');
            await addField(ctx, 'servings', '2');
            await addField(ctx, 'time', '25 minutes');
        },
    },
    {
        chapter: 'Fields from further up',
        say: "One more idea, and it's a handy one. I'd like each card to say whose recipe it is. So the template gets a small line "
            + 'at the bottom: From the kitchen of, and an author placeholder.',
        do: async (page, ctx) => {
            await showTemplates(ctx, 'Recipe');
            await ctx.atSentence(2);
            await ctx.tool('t');
            await ctx.drag(await at(page, 60, 772), await at(page, 536, 796), { duration: 900 });
            await ctx.type('From the kitchen of {{author}}', { wpm: 170 });
            await ctx.press('Escape');
        },
    },
    {
        say: "No page has an author, so it's blank. Rather than adding one to every recipe, I'll add it once, to the cover: "
            + 'author, Grandma Rose.',
        do: async (page, ctx) => {
            await showHierarchy(ctx);
            await ctx.atSentence(1);
            await app.selectNode(ctx, 'Family Recipes');
            await addField(ctx, 'author', 'Grandma Rose');
        },
    },
    {
        say: "And every recipe picks it up. When a page doesn't have a field, the app asks its parent, then the parent's parent, "
            + 'all the way up the tree.',
        do: async (page, ctx) => {
            await app.selectNode(ctx, 'Tomato Soup');
            await ctx.move(await at(page, 300, 784));
            await ctx.atSentence(1);
            await app.selectNode(ctx, 'Banana Bread');
            await ctx.move(await at(page, 320, 786));
        },
    },
    {
        say: "A page's own value still wins. The Pad Thai is Dad's recipe, so it gets an author field of its own, and only that page changes.",
        do: async (page, ctx) => {
            await app.selectNode(ctx, 'Weeknight Pad Thai');
            await ctx.atSentence(1);
            await addField(ctx, 'author', 'Dad');
            await ctx.move(await at(page, 300, 784));
        },
    },
    {
        chapter: 'The result',
        say: "Let's export it and flip through. Export PDF builds the whole document right in your browser.",
        do: async (page, ctx) => {
            ctx.state.pdf = await ctx.download(() => ctx.click(page.getByRole('button', { name: 'Export PDF' }).first()));
            await ctx.wait(1200);
            await ctx.openPdf(ctx.state.pdf, { title: 'Family Recipes.pdf' });
            await ctx.move({ x: 1000, y: 500 });
        },
    },
    {
        say: 'The cover, then three recipes, each one filled in from its own fields, with Grandma Rose on two of them and Dad on the third. '
            + 'The rest of each page stays empty, for writing the recipe out by hand.',
        do: async (page, ctx) => {
            await ctx.wait(900);
            for (let i = 0; i < 3; i++) {
                await ctx.pdfNextPage();
                await ctx.wait(2200);
            }
        },
    },
    {
        say: 'Next time, the cover gets an index: a data grid that lists every recipe, and links straight to it.',
        hold: 3,
        do: async (page, ctx) => {
            await ctx.atSentence(0, { offset: 1.2 });
            await ctx.endCard();
        },
    },
];
