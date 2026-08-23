// The Sticker Press — hierarchy script.
// Minimal placeholder for Task 3 (the measurement spike). Task 4 onward
// builds out the real node tree (cover, start-here, category sheets,
// example/blank workspace pair). Nothing in this task reads this file;
// it exists only so the generator pair is present as a matched set.

const nodes = {
    root: { id: 'root', parentId: null, type: 'sheet', title: 'The Sticker Press', data: {}, children: [] },
};

return { nodes, rootId: 'root' };
