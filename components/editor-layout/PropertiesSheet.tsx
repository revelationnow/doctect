import React, { useId, useRef } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

export type SheetDetent = 'peek' | 'half' | 'full';
export const SHEET_PEEK_PX = 72;
const HEIGHT: Record<SheetDetent, string> = {
    peek: `${SHEET_PEEK_PX}px`, half: '50dvh', full: 'calc(100dvh - 56px)',
};
const NEXT: Record<SheetDetent, SheetDetent> = { peek: 'half', half: 'full', full: 'peek' };
/** Pointer travel below this is a tap (cycles detents); at or above it is a drag (lands on a detent). */
const DRAG_THRESHOLD_PX = 24;
/** jsdom's MouseEvent has no `isPrimary`; only an explicit `false` marks a second finger. */
const isSecondaryPointer = (event: React.PointerEvent): boolean => event.isPrimary === false;

/**
 * Bottom sheet that hosts the unchanged `PropertiesPanel` on phone. Presentational only:
 * the owner holds the detent. The grabber row is always visible (it is the whole sheet at
 * peek); a tap on the grabber cycles peek → half → full → peek, a drag lands on the detent
 * nearest the release point, and the labelled toggle at its right end ("Edit" at peek, "Done"
 * once open) says that the row opens: it takes peek to half and half or full back to peek.
 */
export function PropertiesSheet({ detent, onDetentChange, title, actions, children }: {
    detent: SheetDetent; onDetentChange: (d: SheetDetent) => void; title: string;
    actions?: React.ReactNode; children: React.ReactNode;
}) {
    const dragStartY = useRef<number | null>(null);
    const suppressClick = useRef(false);
    const contentId = useId();
    const open = detent !== 'peek';

    const onPointerDown = (event: React.PointerEvent) => {
        if (isSecondaryPointer(event)) return;
        // A touch drag gets no trailing click, so a flag left over from the last gesture would
        // swallow this one's tap. Every gesture starts clean.
        suppressClick.current = false;
        dragStartY.current = event.clientY;
    };
    const onPointerCancel = (event: React.PointerEvent) => {
        if (isSecondaryPointer(event)) return;
        dragStartY.current = null;
    };
    const onPointerUp = (event: React.PointerEvent) => {
        if (isSecondaryPointer(event)) return;
        const startY = dragStartY.current;
        dragStartY.current = null;
        if (startY === null || Math.abs(event.clientY - startY) < DRAG_THRESHOLD_PX) return; // a tap: let onClick cycle
        suppressClick.current = true; // mouse browsers still fire click after a drag that ends on the button
        const fromTop = event.clientY / window.innerHeight;
        onDetentChange(fromTop > 0.75 ? 'peek' : fromTop > 0.3 ? 'half' : 'full');
    };
    const onClick = () => {
        if (suppressClick.current) { suppressClick.current = false; return; }
        onDetentChange(NEXT[detent]);
    };

    return (
        <section data-testid="properties-sheet" data-touch-chrome="sheet" aria-label="Properties"
            className="absolute inset-x-0 bottom-0 z-30 flex flex-col rounded-t-2xl border-t bg-white shadow-[0_-8px_24px_rgba(15,23,42,0.12)] transition-[height] duration-200"
            style={{ height: HEIGHT[detent] }}>
            <div className="flex items-center gap-2 pl-3 pr-2" style={{ minHeight: SHEET_PEEK_PX }}>
                <button type="button" aria-label="Resize properties sheet"
                    className="flex min-h-11 min-w-0 flex-1 self-stretch items-center gap-3 text-left touch-none"
                    onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} onClick={onClick}>
                    <span className="h-1.5 w-10 shrink-0 rounded-full bg-slate-300" />
                    <span className="truncate text-sm font-semibold text-slate-700">{title}</span>
                </button>
                {actions}
                <button type="button" data-testid="properties-sheet-toggle" aria-expanded={open} aria-controls={contentId}
                    className="flex min-h-11 shrink-0 items-center gap-1 rounded-xl border border-blue-200 bg-blue-50 px-4 text-sm font-semibold text-blue-700"
                    onClick={() => onDetentChange(open ? 'peek' : 'half')}>
                    {open ? <>Done <ChevronDown size={16} aria-hidden /></> : <>Edit <ChevronUp size={16} aria-hidden /></>}
                </button>
            </div>
            <div id={contentId} data-testid="properties-sheet-content" className="min-h-0 flex-1 overflow-y-auto overscroll-contain" hidden={!open}>{children}</div>
        </section>
    );
}
