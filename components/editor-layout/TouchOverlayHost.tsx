import React, { createContext, useContext, useState } from 'react';

/**
 * Where floating touch UI over the canvas (the quick format bar) is portaled: an empty element the
 * phone and tablet layouts render as the last child of their root, inside the project pane's
 * stacking context. Overlays there keep viewport-fixed coordinates but take part in the pane's
 * z-order, between the tool pill (z-20) and the properties sheet (z-30), so the sheet, the sidebar
 * drawer (z-40), the in-pane dialogs (z-50) and every body-level overlay (which out-ranks the pane
 * itself) cover them. A portal to document.body would float over all of those.
 *
 * The context value is null outside a touch layout (desktop, or a canvas rendered on its own).
 */
export const TouchOverlayHostContext = createContext<HTMLElement | null>(null);
export const useTouchOverlayHost = (): HTMLElement | null => useContext(TouchOverlayHostContext);
export const TOUCH_OVERLAY_HOST_ATTR = 'data-touch-overlay-host';

/** Provides the host to `children` and renders it after them; `contents` keeps it out of the flex column. */
export function TouchOverlayHostProvider({ children }: { children: React.ReactNode }) {
    const [host, setHost] = useState<HTMLElement | null>(null);
    return (
        <TouchOverlayHostContext.Provider value={host}>
            {children}
            <div ref={setHost} {...{ [TOUCH_OVERLAY_HOST_ATTR]: '' }} className="contents" />
        </TouchOverlayHostContext.Provider>
    );
}
