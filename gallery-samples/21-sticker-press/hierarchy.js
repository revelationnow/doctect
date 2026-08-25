// The Sticker Press — hierarchy script.
//
// One shared node tree over the four device variants templates.js builds.
// Page order is a pre-order walk of `children` (services/pdfService.ts
// computePageOrder), so the ORDER nodes are appended below IS the book's
// page order: cover (root) -> start_here -> credits -> contents -> colour
// guide -> example workspace (+ its annotated page) -> blank workspace
// (+ dot-grid and ruled pages) -> the A-Z index -> the keyword index -> one
// node per sticker sheet, in category order. (User decision 2026-08-25:
// credits moved from the back of the book to directly after start_here —
// it stays reachable from every sheet's footer Credits chip, which Task E
// already built; only the page-order position changed.)
//
// `templates` here is the ACTIVE variant's template dict (paper_pro) — the
// harness passes it in directly, and all four variants share one id set
// (Global Constraint) so validating against this one is enough. Sheet ids
// and index-page ids are NOT hand-listed here: templates.js's assembly
// block registers front matter and workspace pages first, then every A-Z
// index page, then every keyword index page, then every sheet, in exactly
// that order, and plain objects preserve string-key insertion order — so
// reading Object.keys(templates) back and bucketing by prefix recovers the
// same order without this file re-deriving CATEGORY_ORDER or hardcoding how
// many index pages exist (6 A-Z, 21 keyword at last count, both bigger than
// an earlier estimate and liable to change again if the registry does).

const nodes = {};
const addNode = (id, parentId, type, title, data = {}) => {
    if (nodes[id]) throw new Error(`sticker press: node id '${id}' is duplicated`);
    if (!templates[type]) throw new Error(`sticker press: template '${type}' does not exist`);
    nodes[id] = { id, parentId, type, title, data, children: [] };
    if (parentId !== null) {
        if (!nodes[parentId]) throw new Error(`sticker press: parent '${parentId}' must exist before '${id}'`);
        nodes[parentId].children.push(id);
    }
    return id;
};

const exampleChrome = { example_label: 'EXAMPLE', skip_label: 'Skip to blank workspace →' };

addNode('root', null, 'cover', 'The Sticker Press');
addNode('start_here', 'root', 'start_here', 'Start Here');
addNode('credits', 'root', 'credits', 'Credits & Sources');
addNode('contents', 'root', 'contents', 'Contents');
addNode('colour_guide', 'root', 'colour_guide', 'Colour Guide');

addNode('example_workspace', 'root', 'example_workspace', 'Example: A Filled Page', exampleChrome);
addNode('example_workspace_annotated', 'example_workspace', 'example_workspace_annotated', 'Example: Annotated', exampleChrome);

addNode('blank_workspace', 'root', 'blank_workspace', 'Your Workspace');
addNode('blank_workspace_dots', 'blank_workspace', 'blank_workspace_dots', 'Your Workspace — Dot Grid');
addNode('blank_workspace_ruled', 'blank_workspace', 'blank_workspace_ruled', 'Your Workspace — Ruled');

const FRONT_MATTER_IDS = new Set([
    'cover', 'start_here', 'credits', 'contents', 'colour_guide',
    'example_workspace', 'example_workspace_annotated',
    'blank_workspace', 'blank_workspace_dots', 'blank_workspace_ruled',
]);
const templateIds = Object.keys(templates);
const alphaIndexIds = templateIds.filter(id => id.startsWith('alpha_index_'));
const keywordIndexIds = templateIds.filter(id => id.startsWith('keyword_index_'));
const sheetIds = templateIds.filter(id => !FRONT_MATTER_IDS.has(id)
    && !id.startsWith('alpha_index_') && !id.startsWith('keyword_index_'));

if (alphaIndexIds.length === 0) throw new Error('sticker press: no A-Z index pages found in templates');
if (keywordIndexIds.length === 0) throw new Error('sticker press: no keyword index pages found in templates');
if (sheetIds.length === 0) throw new Error('sticker press: no sticker sheets found in templates');

alphaIndexIds.forEach(id => addNode(id, 'root', id, templates[id].name || id));
keywordIndexIds.forEach(id => addNode(id, 'root', id, templates[id].name || id));
sheetIds.forEach(id => addNode(id, 'root', id, templates[id].name || id));

return { nodes, rootId: 'root' };
