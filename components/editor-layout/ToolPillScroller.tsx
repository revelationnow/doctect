import React, { useLayoutEffect, useRef, useState } from 'react';
import clsx from 'clsx';

/** Attribute on the pill's scrolling row; the touch CSS hides its scrollbar and snaps its buttons. */
export const PILL_SCROLLER_ATTR = 'data-touch-pill-scroller';

/**
 * The phone tool pill's swipeable row: one line of 44px tools that scrolls sideways when the
 * screen is narrower than the row, so no tool is ever dropped or shrunk. `touch-action: pan-x`
 * keeps a swipe on the row a row scroll (the canvas is a sibling, so it never sees the gesture).
 * Edge fades appear only on a side with more tools to reveal, and the pressed tool is scrolled
 * into view whenever `activeKey` changes (a tool picked elsewhere, e.g. after a drawing ends).
 */
export function ToolPillScroller({ activeKey, children }: { activeKey: string; children: React.ReactNode }) {
    const scrollerRef = useRef<HTMLDivElement>(null);
    const [edges, setEdges] = useState({ start: false, end: false });

    useLayoutEffect(() => {
        const scroller = scrollerRef.current;
        if (!scroller) return;
        const update = () => {
            const max = scroller.scrollWidth - scroller.clientWidth;
            const next = { start: scroller.scrollLeft > 1, end: max - scroller.scrollLeft > 1 };
            setEdges(current => current.start === next.start && current.end === next.end ? current : next);
        };
        update();
        scroller.addEventListener('scroll', update, { passive: true });
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
        observer?.observe(scroller);
        return () => { scroller.removeEventListener('scroll', update); observer?.disconnect(); };
    }, []);

    useLayoutEffect(() => {
        const scroller = scrollerRef.current;
        const pressed = scroller?.querySelector<HTMLElement>('[aria-pressed="true"]');
        if (!scroller || !pressed) return;
        // Measured against the row rather than scrollIntoView, which would also scroll the page.
        const row = scroller.getBoundingClientRect();
        const button = pressed.getBoundingClientRect();
        if (button.left < row.left) scroller.scrollLeft -= row.left - button.left;
        else if (button.right > row.right) scroller.scrollLeft += button.right - row.right;
    }, [activeKey]);

    const fade = 'pointer-events-none absolute inset-y-0 w-6 from-white/95 to-transparent';
    return (
        <div className="relative min-w-0">
            <div ref={scrollerRef} {...{ [PILL_SCROLLER_ATTR]: '' }} className="overflow-x-auto overscroll-x-contain touch-pan-x">
                {children}
            </div>
            <span aria-hidden data-testid="tool-pill-fade-start" hidden={!edges.start} className={clsx(fade, 'left-0 bg-gradient-to-r')} />
            <span aria-hidden data-testid="tool-pill-fade-end" hidden={!edges.end} className={clsx(fade, 'right-0 bg-gradient-to-l')} />
        </div>
    );
}
