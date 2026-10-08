import { useEffect, useState } from 'react';

export type FormFactor = 'desktop' | 'tablet' | 'phone';

/**
 * A coarse-pointer viewport whose shorter side is at most this many px is a phone, whichever way
 * it is held: 390×844 and 844×390 are the same phone. Larger touch viewports are tablets.
 */
export const PHONE_MAX_SHORT_SIDE = 639;
const COARSE_QUERY = '(pointer: coarse)';
/** Matches when either side is at most PHONE_MAX_SHORT_SIDE, i.e. the shorter side is. */
export const PHONE_QUERY = `(max-width: ${PHONE_MAX_SHORT_SIDE}px), (max-height: ${PHONE_MAX_SHORT_SIDE}px)`;

/** Elements the user types into; while one has focus the soft keyboard may be resizing the viewport. */
const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
const isEditable = (target: EventTarget | null): boolean =>
    target instanceof Element && (target.matches(EDITABLE_SELECTOR) || (target as HTMLElement).isContentEditable === true);

export function detectFormFactor(coarsePointer: boolean, viewport: { width: number; height: number }): FormFactor {
    if (!coarsePointer) return 'desktop';
    return Math.min(viewport.width, viewport.height) <= PHONE_MAX_SHORT_SIDE ? 'phone' : 'tablet';
}

const read = (): FormFactor => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'desktop';
    const coarse = window.matchMedia(COARSE_QUERY).matches;
    const phone = window.matchMedia(PHONE_QUERY).matches;
    // The query has already compared the shorter side; hand the rule an equivalent square viewport.
    const side = phone ? PHONE_MAX_SHORT_SIDE : PHONE_MAX_SHORT_SIDE + 1;
    return detectFormFactor(coarse, { width: side, height: side });
};

/**
 * The editor's form factor, re-read when either media query changes, except while the user is
 * typing (ruling R40): on browsers that resize the viewport for the soft keyboard, the
 * `(max-height)` term flips for the keyboard alone, and swapping the tablet layout for the
 * phone one would unmount the field under the user. A change that arrives while an editable
 * element has focus is held until focus leaves editable elements, and the queries are read
 * afresh then, so a keyboard that has closed again by that time changes nothing.
 */
export function useEditorFormFactor(): FormFactor {
    const [formFactor, setFormFactor] = useState<FormFactor>(read);

    useEffect(() => {
        if (typeof window.matchMedia !== 'function') return;
        const queries = [window.matchMedia(COARSE_QUERY), window.matchMedia(PHONE_QUERY)];
        let held = false;
        const onFocusOut = (event: FocusEvent) => {
            if (isEditable(event.relatedTarget)) return; // moving between fields is still typing
            document.removeEventListener('focusout', onFocusOut);
            held = false;
            setFormFactor(read());
        };
        const update = () => {
            if (isEditable(document.activeElement)) {
                if (!held) {
                    held = true;
                    document.addEventListener('focusout', onFocusOut);
                }
                return;
            }
            setFormFactor(read());
        };
        queries.forEach(query => query.addEventListener('change', update));
        update();
        return () => {
            queries.forEach(query => query.removeEventListener('change', update));
            document.removeEventListener('focusout', onFocusOut);
        };
    }, []);

    return formFactor;
}
