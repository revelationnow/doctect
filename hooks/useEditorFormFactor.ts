import { useEffect, useState } from 'react';

export type FormFactor = 'desktop' | 'tablet' | 'phone';

export const PHONE_MAX_WIDTH = 639;
const COARSE_QUERY = '(pointer: coarse)';
const PHONE_QUERY = `(max-width: ${PHONE_MAX_WIDTH}px)`;

export function detectFormFactor(coarsePointer: boolean, viewportWidth: number): FormFactor {
    if (!coarsePointer) return 'desktop';
    return viewportWidth <= PHONE_MAX_WIDTH ? 'phone' : 'tablet';
}

const read = (): FormFactor => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'desktop';
    const coarse = window.matchMedia(COARSE_QUERY).matches;
    const phone = window.matchMedia(PHONE_QUERY).matches;
    return detectFormFactor(coarse, phone ? 0 : PHONE_MAX_WIDTH + 1);
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
