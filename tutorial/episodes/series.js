// The series running order. Each episode's meta is built from its entry here,
// so titles, numbering and "up next" stay consistent across all twelve.
export const SERIES = [
    { id: '01-first-planner', level: 'Foundations', title: 'Your first planner, start to finish',
        summary: 'Create a 1,368-page linked planner from a preset, find your way around the editor, and export it.' },
    { id: '02-canvas-essentials', level: 'Foundations', title: 'Canvas essentials: designing a cover page',
        summary: 'Shapes, text and styling on a blank page, and the few rules the canvas plays by.' },
    { id: '03-templates-and-data', level: 'Foundations', title: 'Pages, templates & data binding',
        summary: 'Turn one page into a recipe notebook with nodes, templates, placeholders and data fields.' },
    { id: '04-data-grids', level: 'Building blocks', title: 'Data grids: an index page and tables',
        summary: 'One grid, one cell per page: sources, layout, links, and table styling without the traps.' },
    { id: '05-links', level: 'Building blocks', title: 'Links: making every page navigable',
        summary: 'Back buttons, next and previous, home links and sub-pages that work on every page.' },
    { id: '06-layers-and-styling', level: 'Building blocks', title: 'Layers, stacking & fine styling',
        summary: 'Layers, buried elements, borders, overflow, SVG artwork and greyscale proofs.' },
    { id: '07-calendars', level: 'Advanced', title: 'Real calendars: offsets, slicing & traversal',
        summary: 'Put day 1 under the right weekday, slice lists into windows, and reach grandchildren.' },
    { id: '08-references', level: 'Advanced', title: 'References & referrer formulas',
        summary: 'One page in two places, links back through references, and labels that name them.' },
    { id: '09-variants-and-export', level: 'Advanced', title: 'Variants & export: one document, every device',
        summary: 'Device variants, real unit conversion, greyscale proofs, presets and the JSON inspector.' },
    { id: '10-generator', level: 'Advanced', title: 'The generator: building documents in code',
        summary: 'Write templates and hierarchy in JavaScript, preview them, and apply a dated planner.' },
    { id: '11-gallery-and-cloud', level: 'Share & collaborate', title: 'Gallery, accounts & cloud history',
        summary: 'Browse and borrow without an account, then save versions to the cloud and restore them.' },
    { id: '12-publish-and-collaborate', level: 'Share & collaborate', title: 'Publishing, forks & merge requests',
        summary: 'Publish a listing, take a fork, propose changes, and merge them without losing work.' },
];

/** Builds an episode's meta from its series entry plus episode-specific fields. */
export function episodeMeta(number, extra = {}) {
    const entry = SERIES[number - 1];
    const neighbour = (n) => (SERIES[n - 1] ? { number: n, title: SERIES[n - 1].title, summary: SERIES[n - 1].summary } : undefined);
    return { ...entry, number, seriesLength: SERIES.length, prev: neighbour(number - 1), next: neighbour(number + 1), ...extra };
}
