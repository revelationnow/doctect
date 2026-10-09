import { useEffect, useRef, type RefObject } from 'react';

/** Space left either side of the page by a touch "fit": the page width fills the container minus this. */
export const TOUCH_CANVAS_GUTTER = 16;
const MIN_SCALE = 0.2;
const MAX_SCALE = 10;

/**
 * Touch "fit": zoom so the page width fills the scroll container minus a gutter on each side.
 *
 * A fit is requested by bumping `fitSignal` (the touch viewport starts it truthy, so every canvas
 * mount fits; rotation and the Fit button bump it). The container's width is read when the request
 * arrives, but on a first load that reading can be of a layout that has not settled: the Tailwind
 * runtime generates the utilities for freshly mounted markup after React's effects have run, so
 * the first phone editor mount measured its container hundreds of px wide and the page loaded cut
 * off at the right edge. The request therefore stays in force while the container's width keeps
 * changing — through a ResizeObserver, which reports after layout — until the user zooms: from
 * then on a width change leaves their zoom alone (rotation still requests a fresh fit).
 */
export function useTouchFit(outerRef: RefObject<HTMLElement | null>, {
    enabled, fitSignal, pageWidth, scale, onZoom,
}: {
    enabled: boolean;
    fitSignal: number | undefined;
    pageWidth: number;
    scale: number;
    onZoom: (scale: number) => void;
}): void {
    const onZoomRef = useRef(onZoom);
    onZoomRef.current = onZoom;
    const scaleRef = useRef(scale);
    scaleRef.current = scale;

    useEffect(() => {
        if (!enabled || !fitSignal || pageWidth <= 0) return;
        const outer = outerRef.current;
        if (!outer) return;
        // Scales the prop can legitimately hold while this request is in force: the one it had when
        // the request arrived (the prop lags a render behind onZoom) and every fit issued since.
        // Anything else came from the user (pinch, wheel) and spends the request.
        const issued = new Set([scaleRef.current]);
        const apply = () => {
            const available = outer.clientWidth - 2 * TOUCH_CANVAS_GUTTER;
            if (available <= 0) return;
            const fitted = Math.max(MIN_SCALE, Math.min(MAX_SCALE, available / pageWidth));
            issued.add(fitted);
            onZoomRef.current(fitted);
        };
        apply();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(() => {
            if (!issued.has(scaleRef.current)) { observer.disconnect(); return; }
            apply();
        });
        observer.observe(outer);
        return () => observer.disconnect();
    }, [enabled, fitSignal, pageWidth, outerRef]);
}
