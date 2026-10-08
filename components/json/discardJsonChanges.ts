/** The prompt shown before unapplied JSON editor changes are thrown away (back gesture; Escape in Task 21). */
export const DISCARD_JSON_CHANGES_MESSAGE = 'Discard JSON changes?';

/** Asks whether unapplied JSON editor changes may be discarded; true means close. */
export const confirmDiscardJsonChanges = (): boolean => window.confirm(DISCARD_JSON_CHANGES_MESSAGE);
