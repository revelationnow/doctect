import React from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { AlignCenter, AlignLeft, AlignRight, Bold, Italic, Minus, Plus, Underline } from 'lucide-react';
import type { TemplateElement } from '../../types';
import { GESTURE_IGNORE_ATTR } from '../../hooks/useCanvasTouchGestures';

export const QUICK_FORMAT_BAR_HEIGHT = 48;
const GAP = 8;
const MAX_WIDTH = 468; // 9 controls at the 44px touch minimum + size readout + colour swatch

export interface QuickFormatAnchor { left: number; top: number; bottom: number; width: number }

interface Props {
    element: TemplateElement;
    anchor: QuickFormatAnchor;
    onChange: (updates: Partial<TemplateElement>) => void;
}

// Touch-only floating format bar over the selected text/grid element. Portaled to document.body
// like the other touch overlays, so no stacking context in the editor chrome can trap it; its
// `fixed` coordinates are viewport coordinates either way. The bar root:
// - carries data-touch-gesture-ignore, so a press on it is never a canvas gesture;
// - stops mousedown/pointerdown at the root: the portal still bubbles React synthetic events to
//   the canvas container, whose mouse handlers would otherwise start a marquee or drag;
// - prevents the pointerdown default so the press never moves focus: an open inline editor keeps
//   its caret and the keyboard stays up (data-prevent-finish-edit covers a blur that happens anyway).
export function QuickFormatBar({ element, anchor, onChange }: Props) {
    const above = anchor.top - QUICK_FORMAT_BAR_HEIGHT - GAP;
    const top = above >= GAP ? above : anchor.bottom + GAP;
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : MAX_WIDTH + 2 * GAP;
    const width = Math.min(MAX_WIDTH, viewportWidth - 2 * GAP);
    const left = Math.max(GAP, Math.min(viewportWidth - width - GAP, anchor.left + anchor.width / 2 - width / 2));
    const size = element.fontSize ?? 16;
    const button = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-md';
    const toggle = (active: boolean, label: string, icon: React.ReactNode, patch: Partial<TemplateElement>) => (
        <button type="button" aria-label={label} aria-pressed={active} onClick={() => onChange(patch)}
            className={clsx(button, active ? 'bg-blue-100 text-blue-700' : 'text-slate-600')}>
            {icon}
        </button>
    );

    return createPortal(
        <div role="toolbar" aria-label="Text formatting" data-prevent-finish-edit {...{ [GESTURE_IGNORE_ATTR]: '' }}
            onPointerDown={event => { event.preventDefault(); event.stopPropagation(); }}
            onMouseDown={event => event.stopPropagation()}
            className="fixed z-[200] flex items-center gap-0.5 overflow-x-auto rounded-xl border bg-white px-1 shadow-xl"
            style={{ top: `${top}px`, left: `${left}px`, width, height: QUICK_FORMAT_BAR_HEIGHT }}>
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
            <input type="color" aria-label="Text colour" value={element.textColor || '#000000'}
                onChange={event => onChange({ textColor: event.target.value })}
                className="h-11 w-11 shrink-0 rounded border-0 bg-transparent p-1 text-base" />
        </div>,
        document.body,
    );
}
