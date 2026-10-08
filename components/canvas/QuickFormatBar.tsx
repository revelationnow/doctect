import React, { useEffect, useReducer, useRef } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { AlignCenter, AlignLeft, AlignRight, Bold, Italic, Minus, Plus, Underline } from 'lucide-react';
import type { TemplateElement } from '../../types';
import { GESTURE_IGNORE_ATTR } from '../../hooks/useCanvasTouchGestures';
import { useTouchOverlayHost } from '../editor-layout/TouchOverlayHost';

export const QUICK_FORMAT_BAR_HEIGHT = 48; // one row: a 44px control row inside the frame
const GAP = 8;
const MAX_WIDTH = 468; // 9 controls at the 44px touch minimum + size readout + colour swatch
const CONTROL = 44;      // h-11 / w-11
const CONTROL_GAP = 2;   // gap-0.5
const READOUT = 28;      // w-7
const FRAME = 2 * 4 + 2; // px-1 + a 1px border each side
// Ten items in one row (eight buttons, the readout, the colour control) have nine gaps between them: 442.
const CONTENT_WIDTH = 9 * CONTROL + READOUT + 9 * CONTROL_GAP;
/** The touch chrome the bar keeps clear of (see visibleBand): the phone top bar / tablet toolbar, the sheet, the tool pill. */
const TOUCH_CHROME_SELECTOR = '[data-touch-chrome]';

export interface QuickFormatAnchor { left: number; top: number; bottom: number; width: number }

interface Props {
    element: TemplateElement;
    anchor: QuickFormatAnchor;
    /** A discrete control was tapped: the host commits `updates` as one history step. */
    onChange: (updates: Partial<TemplateElement>) => void;
    /**
     * The colour picker streams one value per native `input` while the user drags inside it. The
     * host holds a single history step from the first `onPickChange` until `onPickEnd`, which fires
     * once per pick: on the picker's native `change`, on blur, or when the bar unmounts mid-pick.
     * Without `onPickChange` every picked value goes through `onChange` instead.
     */
    onPickChange?: (updates: Partial<TemplateElement>) => void;
    onPickEnd?: () => void;
}

// The part of the viewport the bar may occupy: the visual viewport (shrunk by the on-screen
// keyboard, when the browser reports one) minus the phone top bar, the properties sheet and the
// tool pill floating above the sheet, which tag themselves with data-touch-chrome. Chrome that is
// not mounted takes nothing away.
const visibleBand = () => {
    const viewport = window.visualViewport;
    let top = viewport?.offsetTop ?? 0;
    let bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
    const topBar = document.querySelector('[data-touch-chrome="top-bar"]')?.getBoundingClientRect();
    if (topBar) top = Math.max(top, topBar.bottom);
    const sheet = document.querySelector('[data-touch-chrome="sheet"]')?.getBoundingClientRect();
    if (sheet) bottom = Math.min(bottom, sheet.top);
    const pill = document.querySelector('[data-touch-chrome="tool-pill"]')?.getBoundingClientRect();
    if (pill) bottom = Math.min(bottom, pill.top);
    return { top, bottom };
};

// Touch-only floating format bar over the selected text/grid element. Portaled into the touch
// layout's overlay host (see TouchOverlayHost): a `fixed` element with viewport coordinates, but
// one that stacks inside the project pane at z-25, between the tool pill (z-20) and the properties
// sheet (z-30), so the sheet, the drawer, the dialogs and every body-level overlay cover it
// instead of a bar floating over them. Without a host (a bar rendered outside a touch layout, as
// in unit tests) it falls back to document.body. The bar root:
// - carries data-touch-gesture-ignore, so a press on it is never a canvas gesture;
// - stops mousedown/pointerdown at the root: the portal still bubbles React synthetic events to
//   the canvas container, whose mouse handlers would otherwise start a marquee or drag;
// - prevents the pointerdown default on its buttons so a press never moves focus: an open inline
//   editor keeps its caret and the keyboard stays up (data-prevent-finish-edit covers a blur that
//   happens anyway). The colour input is exempt: it must take focus to open its picker.
export function QuickFormatBar({ element, anchor, onChange, onPickChange, onPickEnd }: Props) {
    const host = useTouchOverlayHost();
    // The band is read during render, so the bar must render again when the chrome around it
    // changes size: the sheet moving between detents, the pill wrapping to another row count, or
    // either leaving the DOM (an observed element that is removed reports a 0×0 box). One
    // ResizeObserver for the bar's lifetime watches every chrome element; its notifications only
    // re-render. Chrome that mounts later (the pill, back at the peek detent) is found by a
    // MutationObserver on the layout root (the overlay host's parent; the body without a host) that
    // runs the discovery pass when an added subtree holds chrome. Discovery observes only elements
    // not yet watched, and observing one delivers a single initial notification, so nothing here
    // feeds back into itself: no observe → notify → observe loop, and no mutation of our own.
    const [, chromeResized] = useReducer((version: number) => version + 1, 0);
    useEffect(() => {
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(chromeResized);
        const observed = new WeakSet<Element>();
        const discover = () => {
            for (const node of document.querySelectorAll(TOUCH_CHROME_SELECTOR)) {
                if (observed.has(node)) continue;
                observed.add(node);
                observer.observe(node);
            }
        };
        discover();
        const root = host?.parentElement ?? document.body;
        const holdsChrome = (node: Node) =>
            node instanceof Element && (node.matches(TOUCH_CHROME_SELECTOR) || node.querySelector(TOUCH_CHROME_SELECTOR) !== null);
        const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(records => {
            if (records.some(record => Array.from(record.addedNodes).some(holdsChrome))) discover();
        });
        mutations?.observe(root, { childList: true, subtree: true });
        return () => { mutations?.disconnect(); observer.disconnect(); };
    }, [host]);

    const viewportWidth = window.innerWidth;
    const width = Math.min(MAX_WIDTH, viewportWidth - 2 * GAP);
    // Narrower than the content: wrap onto a second row rather than hide controls behind a scroll.
    // Two rows hold everything down to a 254px viewport (five items a row: 228px of content plus
    // the frame and the side gaps); no phone is narrower.
    const rows = width - FRAME < CONTENT_WIDTH ? 2 : 1;
    const height = QUICK_FORMAT_BAR_HEIGHT + (rows - 1) * (CONTROL + CONTROL_GAP);
    const band = visibleBand();
    const above = anchor.top - height - GAP;
    const preferred = above >= band.top + GAP ? above : anchor.bottom + GAP;
    // Never off-screen or under the chrome: clamp into the band (its top wins when the band is
    // too short for the bar).
    const top = Math.max(band.top + GAP, Math.min(band.bottom - height - GAP, preferred));
    const left = Math.max(GAP, Math.min(viewportWidth - width - GAP, anchor.left + anchor.width / 2 - width / 2));
    const size = element.fontSize ?? 16;
    const colour = element.textColor || '#000000';

    // A colour pick is open from the first React onChange (native `input`) until the picker's own
    // native `change`, which React's onChange normally never reports: it repeats the last `input`'s
    // value and React's value tracker dedupes it. Hence a native listener — on document, which is
    // above React's root/portal containers, so it runs after React's handler: a `change` React does
    // report (value differs) still streams into the open pick before the pick ends. Blur and
    // unmount end a pick too.
    const colourInput = useRef<HTMLInputElement>(null);
    const picking = useRef(false);
    const endPickRef = useRef(onPickEnd);
    useEffect(() => { endPickRef.current = onPickEnd; });
    const endPick = () => {
        if (!picking.current) return;
        picking.current = false;
        endPickRef.current?.();
    };
    useEffect(() => {
        const onNativeChange = (event: Event) => { if (event.target === colourInput.current) endPick(); };
        document.addEventListener('change', onNativeChange);
        return () => { document.removeEventListener('change', onNativeChange); endPick(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const onColour = (event: React.ChangeEvent<HTMLInputElement>) => {
        const patch = { textColor: event.target.value };
        if (event.nativeEvent.type === 'input' || picking.current) {
            picking.current = true;
            (onPickChange ?? onChange)(patch);
        } else onChange(patch); // a lone `change` (typed value, no drag): a discrete step
    };

    const button = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-md';
    const toggle = (active: boolean, label: string, icon: React.ReactNode, patch: Partial<TemplateElement>) => (
        <button type="button" aria-label={label} aria-pressed={active} onClick={() => onChange(patch)}
            className={clsx(button, active ? 'bg-blue-100 text-blue-700' : 'text-slate-600')}>
            {icon}
        </button>
    );

    return createPortal(
        <div role="toolbar" aria-label="Text formatting" data-prevent-finish-edit {...{ [GESTURE_IGNORE_ATTR]: '' }}
            onPointerDown={event => {
                event.stopPropagation();
                if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
            }}
            onMouseDown={event => event.stopPropagation()}
            className="fixed z-[25] flex flex-wrap content-center items-center justify-center gap-0.5 rounded-xl border bg-white px-1 shadow-xl"
            style={{ top: `${top}px`, left: `${left}px`, width, height }}>
            <button type="button" aria-label="Decrease font size" onClick={() => onChange({ fontSize: Math.max(4, size - 1) })}
                className={clsx(button, 'text-slate-600')}><Minus size={16} /></button>
            <span className="w-7 text-center text-xs tabular-nums text-slate-700">{size}</span>
            <button type="button" aria-label="Increase font size" onClick={() => onChange({ fontSize: size + 1 })}
                className={clsx(button, 'text-slate-600')}><Plus size={16} /></button>
            {toggle(element.fontWeight === 'bold', 'Bold', <Bold size={16} />, { fontWeight: element.fontWeight === 'bold' ? 'normal' : 'bold' })}
            {toggle(element.fontStyle === 'italic', 'Italic', <Italic size={16} />, { fontStyle: element.fontStyle === 'italic' ? 'normal' : 'italic' })}
            {toggle(element.textDecoration === 'underline', 'Underline', <Underline size={16} />, { textDecoration: element.textDecoration === 'underline' ? 'none' : 'underline' })}
            {toggle((element.align ?? 'left') === 'left', 'Align left', <AlignLeft size={16} />, { align: 'left' })}
            {toggle(element.align === 'center', 'Align center', <AlignCenter size={16} />, { align: 'center' })}
            {toggle(element.align === 'right', 'Align right', <AlignRight size={16} />, { align: 'right' })}
            {/* A 44px hit target drawing a 24px swatch: the native colour input fills the target
                unseen (it still takes the tap, the focus and opens the picker) and the swatch
                beside it echoes the value, with the input's focus ring. The swatch is inert, so
                every press lands on the input. */}
            <span className="relative flex h-11 w-11 shrink-0 items-center justify-center">
                <input ref={colourInput} type="color" aria-label="Text colour" value={colour}
                    onChange={onColour} onBlur={endPick}
                    className="peer absolute inset-0 h-11 w-11 cursor-pointer opacity-0 text-base" />
                <span aria-hidden="true" data-testid="quick-format-colour-swatch" style={{ backgroundColor: colour }}
                    className="pointer-events-none h-6 w-6 rounded-md border border-slate-300 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500" />
            </span>
        </div>,
        host ?? document.body,
    );
}
