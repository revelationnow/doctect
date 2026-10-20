import { useEffect, useRef, useState } from 'react';

export type FormFactor = 'desktop' | 'tablet' | 'phone';
/** How the user points: a coarse pointer (finger) is touch; anything else (mouse, trackpad, pen) is mouse. */
export type InputMode = 'mouse' | 'touch';
/**
 * The editor's layout (from the viewport, and for touch the device) and its input (from the pointer),
 * decided separately: a narrow mouse window gets a narrow layout but keeps mouse behaviour.
 */
export interface EditorMode { layout: FormFactor; input: InputMode }

/**
 * A coarse-pointer viewport whose shorter side is at most this many px is a phone, whichever way
 * it is held: 390×844 and 844×390 are the same phone. Larger touch viewports are tablets.
 */
export const PHONE_MAX_SHORT_SIDE = 639;
/** A mouse window at most this wide gets the phone layout; its height is never read. */
export const MOUSE_PHONE_MAX_WIDTH = 639;
/** A mouse window at most this wide (and wider than MOUSE_PHONE_MAX_WIDTH) gets the tablet layout. */
export const MOUSE_TABLET_MAX_WIDTH = 1023;
const COARSE_QUERY = '(pointer: coarse)';
/** Matches when either side is at most PHONE_MAX_SHORT_SIDE, i.e. the shorter side is. */
export const PHONE_QUERY = `(max-width: ${PHONE_MAX_SHORT_SIDE}px), (max-height: ${PHONE_MAX_SHORT_SIDE}px)`;
export const MOUSE_PHONE_QUERY = `(max-width: ${MOUSE_PHONE_MAX_WIDTH}px)`;
export const MOUSE_TABLET_QUERY = `(max-width: ${MOUSE_TABLET_MAX_WIDTH}px)`;

/** Elements the user types into; while one has focus the soft keyboard may be resizing the viewport. */
const NON_TEXT_INPUT_TYPES = ['checkbox', 'radio', 'range', 'color', 'button', 'submit', 'reset', 'file', 'image'];
const EDITABLE_SELECTOR = [
    `input${NON_TEXT_INPUT_TYPES.map(type => `:not([type="${type}"])`).join('')}`,
    'textarea',
    'select',
    '[contenteditable]:not([contenteditable="false"])',
].join(', ');
/**
 * How long after focus leaves the fields the queries are re-read. On browsers that resize the
 * viewport for the soft keyboard, `focusout` fires before the keyboard has gone; reading at once
 * would apply the keyboard-sized viewport and flip back a moment later (two remounts).
 */
export const KEYBOARD_SETTLE_MS = 400;
const isEditable = (target: EventTarget | null): boolean =>
    target instanceof Element && (target.matches(EDITABLE_SELECTOR) || (target as HTMLElement).isContentEditable === true);

export function detectEditorMode(coarsePointer: boolean, viewport: { width: number; height: number }): EditorMode {
    if (coarsePointer) {
        return { layout: Math.min(viewport.width, viewport.height) <= PHONE_MAX_SHORT_SIDE ? 'phone' : 'tablet', input: 'touch' };
    }
    const layout = viewport.width <= MOUSE_PHONE_MAX_WIDTH ? 'phone' : viewport.width <= MOUSE_TABLET_MAX_WIDTH ? 'tablet' : 'desktop';
    return { layout, input: 'mouse' };
}

const DESKTOP: EditorMode = { layout: 'desktop', input: 'mouse' };

const read = (): EditorMode => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return DESKTOP;
    const matches = (query: string) => window.matchMedia(query).matches;
    // The queries have already compared the sides; hand the rule an equivalent viewport: the touch
    // rule reads its shorter side, the mouse rule its width.
    const width = matches(MOUSE_PHONE_QUERY) ? MOUSE_PHONE_MAX_WIDTH
        : matches(MOUSE_TABLET_QUERY) ? MOUSE_TABLET_MAX_WIDTH : MOUSE_TABLET_MAX_WIDTH + 1;
    const height = matches(PHONE_QUERY) ? PHONE_MAX_SHORT_SIDE : PHONE_MAX_SHORT_SIDE + 1;
    return detectEditorMode(matches(COARSE_QUERY), { width, height });
};

const same = (a: EditorMode, b: EditorMode) => a.layout === b.layout && a.input === b.input;

/**
 * The editor's layout and input, re-read when any of the media queries changes.
 *
 * Touch only (ruling R40): on browsers that resize the viewport for the soft keyboard, the
 * `(max-height)` term flips for the keyboard alone, and swapping the tablet layout for the phone
 * one would unmount the field under the user. While the pointer is coarse (before and after the
 * change), a change that arrives while an editable element has focus is held until focus leaves
 * editable elements, and the queries are read afresh KEYBOARD_SETTLE_MS later (or at the next query
 * change, whichever comes first), so a keyboard that has closed again by then changes nothing.
 * A mouse window has no soft keyboard: its resize is real and applies at once.
 */
export function useEditorFormFactor(): EditorMode {
    const [mode, setMode] = useState<EditorMode>(read);
    const applied = useRef(mode);

    useEffect(() => {
        if (typeof window.matchMedia !== 'function') return;
        const queries = [COARSE_QUERY, PHONE_QUERY, MOUSE_PHONE_QUERY, MOUSE_TABLET_QUERY].map(query => window.matchMedia(query));
        let held = false;
        let settle: ReturnType<typeof setTimeout> | undefined;
        const onFocusOut = (event: FocusEvent) => {
            if (isEditable(event.relatedTarget)) return; // moving between fields is still typing
            document.removeEventListener('focusout', onFocusOut);
            held = false;
            settle = setTimeout(update, KEYBOARD_SETTLE_MS);
        };
        function update() {
            clearTimeout(settle);
            settle = undefined;
            const next = read();
            if (applied.current.input === 'touch' && next.input === 'touch' && isEditable(document.activeElement)) {
                if (!held) {
                    held = true;
                    document.addEventListener('focusout', onFocusOut);
                }
                return;
            }
            if (same(applied.current, next)) return;
            applied.current = next;
            setMode(next);
        }
        queries.forEach(query => query.addEventListener('change', update));
        update();
        return () => {
            clearTimeout(settle);
            queries.forEach(query => query.removeEventListener('change', update));
            document.removeEventListener('focusout', onFocusOut);
        };
    }, []);

    return mode;
}
