// Facts the gallery derives from a published project — category, page formats, page count,
// normalized tags. Shared because the server computes and stores them (server/galleryIndex.js)
// and the client renders their labels and filter options.
//
// Everything here is DERIVED: it never writes back to the project, its commits or its
// published_* columns. Changing a rule below only needs INDEX_VERSION bumped; the startup
// sweep then rebuilds the side tables from the untouched published data.
export const INDEX_VERSION = 1;

// Folds case, spacing and simple plurals so "Planners", "planner" and " planner " land on
// one filter. Applied to the index only — the author's original spelling is kept for display.
export function normalizeTag(raw) {
    let t = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '-');
    if (t.length > 4 && t.endsWith('ies')) t = t.slice(0, -3) + 'y';
    else if (t.length > 3 && t.endsWith('s') && !/(ss|us|is)$/.test(t)) t = t.slice(0, -1);
    return t;
}

// Ordered: on a score tie the earlier category wins. Keywords are matched after
// normalizeTag, so list the singular form only.
export const CATEGORIES = [
    { key: 'planners', label: 'Planners', emoji: '📋', keywords: ['planner', 'planning', 'calendar', 'agenda', 'schedule', 'daily', 'weekly', 'monthly', 'yearly', 'organization', 'organizer', 'productivity', 'dated', 'undated', 'goal'] },
    { key: 'trackers', label: 'Trackers & habits', emoji: '📈', keywords: ['tracker', 'tracking', 'habit', 'log', 'logbook', 'fitness', 'workout', 'wellness', 'health', 'motivation', 'gamified', 'mood', 'sleep'] },
    { key: 'journals', label: 'Journals & writing', emoji: '✍️', keywords: ['journal', 'journaling', 'diary', 'writing', 'reflection', 'gratitude', 'story', 'fiction', 'novel', 'book', 'reading', 'quote', 'memoir', 'poetry'] },
    { key: 'learning', label: 'Learning & study', emoji: '🎓', keywords: ['study', 'learning', 'school', 'student', 'semester', 'academic', 'note', 'notebook', 'cornell', 'flashcard', 'education', 'language', 'vocabulary', 'grammar', 'science', 'practice', 'music', 'instrument', 'lesson'] },
    { key: 'work', label: 'Work & money', emoji: '💼', keywords: ['work', 'business', 'career', 'job-search', 'interview', 'meeting', 'project', 'kanban', 'finance', 'budget', 'money', 'invoice', 'client'] },
    { key: 'home', label: 'Home & hobbies', emoji: '🏡', keywords: ['home', 'house', 'maintenance', 'garden', 'planting', 'vegetable', 'recipe', 'cooking', 'kitchen', 'family', 'genealogy', 'ancestry', 'heritage', 'travel', 'hobby', 'craft', 'sticker', 'decoration', 'creative', 'art', 'sketch', 'sketchbook', 'astronomy', 'stargazing', 'telescope'] },
    { key: 'games', label: 'Games & play', emoji: '🎲', keywords: ['game', 'gamebook', 'rpg', 'ttrpg', 'dnd', 'chess', 'trivia', 'quiz', 'puzzle', 'adventure', 'party', 'campaign', 'quest'] },
];
export const OTHER_CATEGORY = { key: 'other', label: 'Other', emoji: '📁', keywords: [] };
export const ALL_CATEGORIES = [...CATEGORIES, OTHER_CATEGORY];

const KEYWORD_CATEGORY = new Map();
for (const c of CATEGORIES) for (const k of c.keywords) KEYWORD_CATEGORY.set(k, c.key);

// Tags are the author's deliberate labels, so they outweigh incidental words in the name.
export function categorize(tags, name) {
    const scores = new Map();
    const add = (word, weight) => {
        const key = KEYWORD_CATEGORY.get(normalizeTag(word));
        if (key) scores.set(key, (scores.get(key) ?? 0) + weight);
    };
    for (const t of tags ?? []) add(t, 2);
    for (const w of String(name ?? '').split(/[^\p{L}\p{N}-]+/u)) if (w) add(w, 1);
    let best = OTHER_CATEGORY.key, bestScore = 0;
    for (const c of CATEGORIES) {
        const s = scores.get(c.key) ?? 0;
        if (s > bestScore) { best = c.key; bestScore = s; }
    }
    return best;
}

// Page-size groups, in PDF points. Devices that share one size share one group — a filter
// for "reMarkable 2" that hid an identical Boox file would be wrong. Every PAGE_PRESETS entry
// in constants/editor.ts must land in a group here (tests/unit/galleryFacets.test.ts).
export const PAGE_FORMATS = [
    { key: 'a4', label: 'A4', short: 'A4', sizes: [[595.28, 841.89]] },
    { key: 'letter', label: 'US Letter', short: 'Letter', sizes: [[612, 792]] },
    { key: 'legal', label: 'US Legal', short: 'Legal', sizes: [[612, 1008]] },
    { key: 'a5', label: 'A5', short: 'A5', sizes: [[419.53, 595.28]] },
    { key: 'rm_pp', label: 'reMarkable Paper Pro', short: 'rM Paper Pro', sizes: [[509, 679]] },
    { key: 'eink_10_3', label: '10.3″ e-ink (reMarkable 2, Boox, Supernote)', short: '10.3″ e-ink', sizes: [[445, 592]] },
    { key: 'kindle_scribe', label: 'Kindle Scribe', short: 'Kindle Scribe', sizes: [[432, 576]] },
    { key: 'eink_13_3', label: '13.3″ e-ink (Boox Tab X / Note Max)', short: '13.3″ e-ink', sizes: [[574, 765]] },
    { key: 'eink_7_8', label: '7.8″ e-ink (Supernote Nomad, Boox Nova)', short: '7.8″ e-ink', sizes: [[336, 448]] },
    { key: 'rm_pp_move', label: 'reMarkable Paper Pro Move', short: 'rM Move', sizes: [[462.55, 260.18]] },
];
export const CUSTOM_FORMAT = { key: 'custom', label: 'Custom size', short: 'Custom size' };
export const ALL_FORMATS = [...PAGE_FORMATS, CUSTOM_FORMAT];

const SIZE_TOLERANCE = 1.5;
const near = (a, b) => Math.abs(a - b) <= SIZE_TOLERANCE;

// Orientation-agnostic: a landscape A4 is still A4.
export function formatForSize(width, height) {
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    for (const f of PAGE_FORMATS) {
        for (const [w, h] of f.sizes) {
            if ((near(width, w) && near(height, h)) || (near(width, h) && near(height, w))) return f.key;
        }
    }
    return CUSTOM_FORMAT.key;
}

export const categoryLabel = key => ALL_CATEGORIES.find(c => c.key === key)?.label ?? key;
export const formatLabel = key => ALL_FORMATS.find(f => f.key === key)?.label ?? key;
export const formatShortLabel = key => ALL_FORMATS.find(f => f.key === key)?.short ?? key;

const MAX_WALK = 100000;

// Same traversal as computePageOrder in services/pdfService.ts: depth-first from the root,
// reference nodes are pointers and not pages.
function pageNodes(state) {
    const nodes = state?.nodes;
    if (!nodes || typeof nodes !== 'object' || !state.rootId) return [];
    const out = [];
    const seen = new Set();
    const pending = [state.rootId];
    while (pending.length > 0 && seen.size < MAX_WALK) {
        const id = pending.pop();
        if (seen.has(id) || !Object.hasOwn(nodes, id)) continue;
        seen.add(id);
        const node = nodes[id];
        if (!node || node.referenceId) continue;
        out.push(node);
        const children = Array.isArray(node.children) ? node.children : [];
        for (let i = children.length - 1; i >= 0; i--) pending.push(children[i]);
    }
    return out;
}

// Reads a published AppState of ANY schema version without migrating it: pre-variant saves
// (schema v0) keep `templates` at the top level instead of under `variants[*].templates`.
// Anything unreadable degrades to "no format / no page count", never to an error.
export function deriveFacets(state, { name, tags }) {
    const facets = { category: categorize(tags, name), formats: [], pageCount: null };
    if (!state || typeof state !== 'object') return facets;
    const pages = pageNodes(state);
    facets.pageCount = pages.length || null;

    const variantTemplates = state.variants && typeof state.variants === 'object'
        ? Object.values(state.variants).map(v => v?.templates)
        : [state.templates];
    const formats = new Set();
    for (const templates of variantTemplates) {
        if (!templates || typeof templates !== 'object') continue;
        // The first page decides, as it does for the exported PDF's page size.
        const tpl = (pages[0] && templates[pages[0].type]) || Object.values(templates)[0];
        const key = tpl ? formatForSize(Number(tpl.width), Number(tpl.height)) : null;
        if (key) formats.add(key);
    }
    facets.formats = [...formats];
    return facets;
}
