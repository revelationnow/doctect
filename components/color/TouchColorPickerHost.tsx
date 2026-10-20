import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useInputMode } from '../editor-layout/FormFactorContext';
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

/** Touch slop: a tap within this square around a (20–24px) colour input's centre picks it. */
const TOUCH_TARGET_PX = 44;
const ANCESTOR_SEARCH_DEPTH = 3;
/** Controls that own their taps: a tap on one never becomes a colour pick, however near a swatch. */
const OTHER_CONTROL = 'button, a[href], input, select, textarea, [role="button"], [role="menuitem"], [role="slider"], [role="tab"], [contenteditable="true"]';

/**
 * The colour input a click is for. On touch the inputs take no pointer events (touch CSS), so a tap
 * lands on whatever is under them; this finds the input nearest the tap among the hit element's
 * and its nearest ancestors' colour inputs, within the 44px touch target. A tap on another control
 * (a button beside a swatch) stays that control's. A keyboard activation (Enter/Space on a focused
 * input) targets the input itself.
 */
export function colourInputForClick(event: Pick<MouseEvent, 'target' | 'clientX' | 'clientY'>): HTMLInputElement | null {
    const target = event.target;
    if (target instanceof HTMLInputElement) return target.type === 'color' && !target.disabled ? target : null;
    if (!(target instanceof Element)) return null;
    const control = target.closest(OTHER_CONTROL);
    if (control && !control.querySelector('input[type="color"]')) return null;
    let best: { input: HTMLInputElement; distance: number } | null = null;
    let scope: Element | null = target;
    for (let depth = 0; scope && depth <= ANCESTOR_SEARCH_DEPTH; depth++, scope = scope.parentElement) {
        for (const input of scope.querySelectorAll<HTMLInputElement>('input[type="color"]')) {
            if (input.disabled) continue;
            const box = input.getBoundingClientRect();
            const slopX = Math.max(0, (TOUCH_TARGET_PX - box.width) / 2), slopY = Math.max(0, (TOUCH_TARGET_PX - box.height) / 2);
            const dx = Math.max(box.left - slopX - event.clientX, 0, event.clientX - box.right - slopX);
            const dy = Math.max(box.top - slopY - event.clientY, 0, event.clientY - box.bottom - slopY);
            if (dx > 0 || dy > 0) continue;
            const distance = Math.hypot(event.clientX - (box.left + box.width / 2), event.clientY - (box.top + box.height / 2));
            if (!best || distance < best.distance) best = { input, distance };
        }
        if (best) break;
    }
    return best?.input ?? null;
}

/**
 * On touch, every `<input type="color">` in the editor opens `TouchColorPicker` instead of the
 * platform picker (Android's is a small swatch grid). The touch CSS makes the inputs ignore
 * pointer events, so no engine can open its own picker from a tap (Firefox and WebKit do not all
 * honour a cancelled click); a capture-phase click listener maps the tap to the input under it.
 * Picks are written back into the input. A mouse (desktop or a narrow window) registers nothing
 * and keeps the native picker.
 */
export function TouchColorPickerHost() {
    const touch = useInputMode() === 'touch';
    const [target, setTarget] = useState<HTMLInputElement | null>(null);
    const [openCount, setOpenCount] = useState(0);
    const [recents, setRecents] = useState<string[]>(sessionRecents);

    useEffect(() => {
        if (!touch) return;
        const onClick = (event: MouseEvent) => {
            const input = colourInputForClick(event);
            if (!input) return;
            event.preventDefault();
            event.stopPropagation(); // the tap is the picker's, not the row's
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
