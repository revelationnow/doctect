/**
 * The selection update behind a desktop Ctrl/Cmd-click on a Layers row, a Shift-click in the
 * canvas's select-under menu, and a tap while the touch "Select multiple" toggle is on: the id
 * leaves the selection when it is in it, else joins it at the end.
 */
export const toggleSelection = (selectedIds: readonly string[], id: string): string[] =>
    selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id];

/**
 * The selection update behind a pick from the canvas's long-press stack menu while the touch
 * "Select multiple" toggle is on: the id joins the selection at the end and is never removed, so
 * picking something already selected leaves the selection as it is.
 */
export const addToSelection = (selectedIds: readonly string[], id: string): string[] =>
    selectedIds.includes(id) ? [...selectedIds] : [...selectedIds, id];
