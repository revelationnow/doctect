import { useEffect, useRef } from 'react';

export type ResizablePanel = 'sidebar' | 'properties';
export type PanelWidthPatch = { sidebarWidth: number } | { propertiesPanelWidth: number };

/** The tablet layout never lets the properties panel squeeze the canvas below this width. */
export const MIN_CANVAS_WIDTH = 320;

/** Width of a panel whose inner edge is at `clientX`: the sidebar grows from the left, properties from the right. */
export function panelWidthAt(panel: ResizablePanel, clientX: number, viewportWidth: number): number {
    if (panel === 'sidebar') return Math.max(200, Math.min(600, clientX));
    return Math.max(250, Math.min(600, viewportWidth - MIN_CANVAS_WIDTH, viewportWidth - clientX));
}

/**
 * Follows a panel edge drag with pointer events, so a finger drags the edge as a mouse does.
 * The handle that starts the drag sets `touch-action: none`; touch pointers are implicitly
 * captured by it, and their events bubble here.
 */
export function usePanelResize(panel: ResizablePanel | null, onStop: () => void, onResize: (patch: PanelWidthPatch) => void) {
    const callbacks = useRef({ onStop, onResize });
    callbacks.current = { onStop, onResize };
    useEffect(() => {
        if (!panel) return;
        const move = (event: PointerEvent) => {
            event.preventDefault();
            const width = panelWidthAt(panel, event.clientX, window.innerWidth);
            callbacks.current.onResize(panel === 'sidebar' ? { sidebarWidth: width } : { propertiesPanelWidth: width });
        };
        const end = () => callbacks.current.onStop();
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', end);
        document.addEventListener('pointercancel', end);
        document.body.style.cursor = 'col-resize';
        return () => {
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerup', end);
            document.removeEventListener('pointercancel', end);
            document.body.style.cursor = '';
        };
    }, [panel]);
}
