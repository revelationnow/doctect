/**
 * The selection update behind a desktop Ctrl/Cmd-click on a Layers row, a Shift-click in the
 * canvas's select-under menu, and a tap while the touch "Select multiple" toggle is on: the id
 * leaves the selection when it is in it, else joins it at the end.
 */
export const toggleSelection = (selectedIds: readonly string[], id: string): string[] =>
    selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id];
