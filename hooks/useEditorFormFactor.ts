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

export function useEditorFormFactor(): FormFactor {
    const [formFactor, setFormFactor] = useState<FormFactor>(read);

    useEffect(() => {
        if (typeof window.matchMedia !== 'function') return;
        const queries = [window.matchMedia(COARSE_QUERY), window.matchMedia(PHONE_QUERY)];
        const update = () => setFormFactor(read());
        queries.forEach(query => query.addEventListener('change', update));
        update();
        return () => queries.forEach(query => query.removeEventListener('change', update));
    }, []);

    return formFactor;
}
