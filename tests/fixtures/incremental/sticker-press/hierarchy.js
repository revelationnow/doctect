// The Sticker Press — one visual Home, browse branches, optional palette bank.
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const fail = message => { throw new Error(`sticker press: ${message}`); };
const nodes = {}, assignedTemplates = new Set();
const categories = [
    'index-tabs-flags', 'labels-tape', 'arrows-pointers', 'boxes-bullets-markers',
    'stars-sparkles-awards', 'dividers-corners-frames', 'weather-sky', 'botanical',
    'animals', 'food-drink', 'faces-moods', 'study-work', 'health-self-care',
    'travel-places', 'celebration-seasons', 'money-home', 'symbols-misc',
];
const utilities = new Set(['cover', 'colour_guide', 'name_index', 'start_here', 'credits',
    'example_workspace', 'example_workspace_annotated', 'blank_workspace', 'blank_workspace_dots', 'blank_workspace_ruled']);
const order = Object.keys(templates), parents = new Map(), groups = new Map();
const sequence = (key, number) => {
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(number);
};
// Classify the entire input before adding any nodes. No unknown template fallback.
for (const id of order) {
    if (templates[id].id !== id) fail(`template '${id}' has mismatched id '${templates[id].id}'`);
    let parent = 'root';
    const browse = /^browse__([a-z]+(?:-[a-z]+)*)__([1-9]\d*)$/.exec(id);
    const palette = /^palette__([a-z]+(?:-[a-z]+)*)__lucide-[a-z0-9]+(?:-[a-z0-9]+)*$/.exec(id);
    const lookup = /^lookup__(0-9|[A-Z])__([1-9]\d*)$/.exec(id);
    const credits = /^credits__([2-9]|[1-9]\d+)$/.exec(id);
    if (utilities.has(id)) {
        if (id === 'cover') parent = null;
        if (id === 'credits') sequence('credits', 1);
        if (id === 'example_workspace_annotated') parent = 'example_workspace';
        if (/^blank_workspace_(dots|ruled)$/.test(id)) parent = 'blank_workspace';
    } else if (browse && categories.includes(browse[1])) {
        sequence(`browse__${browse[1]}`, Number(browse[2]));
        parent = Number(browse[2]) > 1 ? `browse__${browse[1]}__1` : 'root';
    } else if (palette && categories.includes(palette[1])) parent = 'colour_guide';
    else if (lookup) {
        sequence(`lookup__${lookup[1]}`, Number(lookup[2]));
        parent = Number(lookup[2]) > 1 ? `lookup__${lookup[1]}__1` : 'name_index';
    } else if (credits) { sequence('credits', Number(credits[1])); parent = 'credits'; }
    else fail(`unknown or malformed template '${id}'`);
    parents.set(id, parent);
}
for (const id of utilities) if (!own(templates, id)) fail(`missing required template '${id}'`);
for (const category of categories) if (!own(templates, `browse__${category}__1`)) fail(`missing first browse page '${category}'`);
for (const [key, pages] of groups) {
    pages.sort((a, b) => a - b);
    if (pages.some((page, index) => page !== index + 1)) fail(`noncontiguous pages or missing first page '${key}'`);
}
const addNode = (id, parentId, type, title, data = {}) => {
    if (own(nodes, id)) fail(`node id '${id}' is duplicated`);
    if (!own(templates, type)) fail(`template '${type}' does not exist`);
    if (assignedTemplates.has(type)) fail(`template '${type}' is assigned more than once`);
    if (parentId !== null && !own(nodes, parentId)) fail(`parent '${parentId}' must exist before '${id}'`);
    nodes[id] = { id, parentId, type, title, data, children: [] };
    assignedTemplates.add(type);
    if (parentId !== null) nodes[parentId].children.push(id);
};
const exampleChrome = { example_label: 'EXAMPLE', skip_label: 'Skip to blank workspace →' };
addNode('root', null, 'cover', 'The Sticker Press');
for (const id of order.filter(id => id !== 'cover'))
    addNode(id, parents.get(id), id, templates[id].name, /^example_workspace/.test(id) ? exampleChrome : {});

// Match registration order to physical preorder; nesting must never interleave palettes.
const preorder = [];
const visit = id => { preorder.push(nodes[id].type); nodes[id].children.forEach(visit); };
visit('root');
if (preorder.some((id, index) => id !== order[index])) fail('registration order must match physical preorder');
const browseNumbers = order.map((id, i) => id.startsWith('browse__') ? i : -1).filter(i => i >= 0);
const paletteNumbers = order.map((id, i) => id.startsWith('palette__') ? i : -1).filter(i => i >= 0);
if (!paletteNumbers.length || Math.max(...browseNumbers) >= Math.min(...paletteNumbers)) fail('palette order must follow all browse pages');
for (const [id, template] of Object.entries(templates)) for (const element of template.elements || []) {
    if (element.linkTarget === 'specific_node' && !own(nodes, element.linkValue))
        fail(`template '${id}' links to missing node '${element.linkValue}'`);
}
return { nodes, rootId: 'root' };
