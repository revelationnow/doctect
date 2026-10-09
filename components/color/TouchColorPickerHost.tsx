import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFormFactor } from '../editor-layout/FormFactorContext';
import { useBackDismiss } from '../editor-layout/useBackDismiss';
import { normalizeHex } from './colorMath';
import { TouchColorPicker } from './TouchColorPicker';

const MAX_RECENTS = 8;
/** Session-only, shared by every colour field: browser storage keys are a pinned security boundary. */
let sessionRecents: string[] = [];
export const resetTouchColourRecents = () => { sessionRecents = []; };

const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;

/**
 * Writes `hex` into a native colour input the way the browser's own picker does: through the
 * prototype setter (so React's value tracker sees a change) and then one `input` and one `change`
 * event. Every existing handler (onInput, onChange, the quick format bar's pick lifecycle) runs
 * unchanged, once per pick.
 */
export function commitToColourInput(input: HTMLInputElement, hex: string): void {
    if (!input.isConnected || input.disabled || input.value.toLowerCase() === hex) return;
    if (valueSetter) valueSetter.call(input, hex); else input.value = hex;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
}

/** The field's name: its own label, else the nearest short text just before it (e.g. "Fill"). */
const labelOf = (input: HTMLInputElement): string => {
    const own = input.getAttribute('aria-label') || input.title || input.labels?.[0]?.textContent?.trim();
    if (own) return own;
    let node: Element | null = input;
    for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
        const text = node.previousElementSibling?.textContent?.trim();
        if (text && text.length <= 30) return text;
    }
    return 'Colour';
};

/**
 * On touch, every `<input type="color">` in the editor opens `TouchColorPicker` instead of the
 * platform picker (Android's is a small swatch grid). A capture-phase click listener cancels the
 * native activation and remembers the input; picks are written back into it. Desktop registers
 * nothing and keeps the native picker.
 */
export function TouchColorPickerHost() {
    const touch = useFormFactor() !== 'desktop';
    const [target, setTarget] = useState<HTMLInputElement | null>(null);
    const [openCount, setOpenCount] = useState(0);
    const [recents, setRecents] = useState<string[]>(sessionRecents);

    useEffect(() => {
        if (!touch) return;
        const onClick = (event: MouseEvent) => {
            const input = event.target;
            if (!(input instanceof HTMLInputElement) || input.type !== 'color' || input.disabled) return;
            event.preventDefault();
            setRecents(sessionRecents);
            setOpenCount(n => n + 1);
            setTarget(input);
        };
        document.addEventListener('click', onClick, true);
        return () => document.removeEventListener('click', onClick, true);
    }, [touch]);
    useEffect(() => { if (!touch) setTarget(null); }, [touch]);

    const close = useCallback(() => {
        if (target?.isConnected) target.focus({ preventScroll: true });
        setTarget(null);
    }, [target]);
    useBackDismiss(target !== null, close);

    const commit = useCallback((hex: string) => {
        if (!target) return;
        commitToColourInput(target, hex);
        sessionRecents = [hex, ...sessionRecents.filter(colour => colour !== hex)].slice(0, MAX_RECENTS);
        setRecents(sessionRecents);
    }, [target]);

    if (!target) return null;
    return createPortal(
        <TouchColorPicker key={openCount} value={normalizeHex(target.value) ?? '#000000'} label={labelOf(target)}
            recents={recents} onCommit={commit} onClose={close} />,
        document.body,
    );
}
