import { RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TAP_SLOP_PX, type TouchGestureHandlers } from '../../hooks/useCanvasTouchGestures';
import type { QuickFormatAnchor } from './QuickFormatBar';

// Touch-only support for the quick format bar and keyboard-aware inline editing (Canvas keeps
// only the wiring). Every hook is a no-op when disabled, so the desktop path is untouched.

const elementSelector = (id: string) => `[data-element-id="${id.replace(/["\\]/g, '\\$&')}"]`;

/**
 * Whether a touch gesture that moves content is in progress: a pan, a pinch, or a direct
 * drag/resize that has left the tap slop. Taps (pointerdown → pointerup inside the slop) never
 * count, so UI gated on `active` (the quick format bar) does not blink on every tap — the hook's
 * onGestureStart fires for taps too, which is why it is not used here. Cleared on onGestureEnd,
 * which the hook guarantees for every started gesture, including cancels and a disable mid-drag.
 */
export function useTouchGestureActivity(): { active: boolean; track: (handlers: TouchGestureHandlers) => TouchGestureHandlers } {
    const [active, setActive] = useState(false);
    const directStart = useRef<{ x: number; y: number } | null>(null);
    const track = (handlers: TouchGestureHandlers): TouchGestureHandlers => ({
        ...handlers,
        onDirectDown: event => {
            directStart.current = { x: event.clientX, y: event.clientY };
            handlers.onDirectDown(event);
        },
        onDirectMove: event => {
            const start = directStart.current;
            if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_SLOP_PX) setActive(true);
            handlers.onDirectMove(event);
        },
        onPan: (dx, dy) => { setActive(true); handlers.onPan(dx, dy); },
        onPinch: (factor, centerX, centerY) => { setActive(true); handlers.onPinch(factor, centerX, centerY); },
        onGestureEnd: () => {
            directStart.current = null;
            setActive(false);
            handlers.onGestureEnd?.();
        },
    });
    return { active, track };
}

const sameAnchor = (a: QuickFormatAnchor | null, b: QuickFormatAnchor) =>
    !!a && a.left === b.left && a.top === b.top && a.bottom === b.bottom && a.width === b.width;

/**
 * Viewport rect of the target element's canvas node, for anchoring the quick format bar. Measured
 * in a layout effect (so the bar never paints at a stale spot) whenever the target or `deps`
 * change, and again on canvas scroll and viewport resize. While `enabled` is false (a gesture is
 * moving the content and the bar is hidden) nothing is measured; the next enable re-measures.
 */
export function useQuickFormatAnchor(
    outerRef: RefObject<HTMLElement | null>,
    targetId: string | null,
    enabled: boolean,
    deps: unknown[],
): QuickFormatAnchor | null {
    const [anchor, setAnchor] = useState<QuickFormatAnchor | null>(null);
    // Mirror of `anchor` for the effect, so a run with nothing to change (every desktop run: no
    // target, nothing set) touches no state at all.
    const current = useRef<QuickFormatAnchor | null>(null);
    const update = (next: QuickFormatAnchor | null) => {
        if (next ? sameAnchor(current.current, next) : current.current === null) return;
        current.current = next;
        setAnchor(next);
    };
    useLayoutEffect(() => {
        const outer = outerRef.current;
        if (!targetId || !outer) { update(null); return; }
        if (!enabled) return;
        const measure = () => {
            const node = outer.querySelector(elementSelector(targetId));
            if (!node) { update(null); return; }
            const r = node.getBoundingClientRect();
            update({ left: r.left, top: r.top, bottom: r.bottom, width: r.width });
        };
        measure();
        const viewport = window.visualViewport;
        outer.addEventListener('scroll', measure);
        window.addEventListener('resize', measure);
        viewport?.addEventListener('resize', measure);
        viewport?.addEventListener('scroll', measure);
        return () => {
            outer.removeEventListener('scroll', measure);
            window.removeEventListener('resize', measure);
            viewport?.removeEventListener('resize', measure);
            viewport?.removeEventListener('scroll', measure);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [outerRef, targetId, enabled, ...deps]);
    return targetId ? anchor : null;
}

const KEYBOARD_MARGIN = 16;

/**
 * Keeps the element being edited inline inside the visual viewport, which shrinks when the
 * on-screen keyboard opens: scrolls the canvas container when editing starts and again on every
 * visual viewport resize. Touch only; browsers without visualViewport are left alone.
 */
export function useKeepEditedElementVisible(outerRef: RefObject<HTMLElement | null>, editingElementId: string | null, enabled: boolean): void {
    useEffect(() => {
        if (!enabled || !editingElementId) return;
        const viewport = window.visualViewport;
        const outer = outerRef.current;
        if (!viewport || !outer) return;
        const ensureVisible = () => {
            const node = outer.querySelector(elementSelector(editingElementId));
            if (!node) return;
            const r = node.getBoundingClientRect();
            const visibleTop = viewport.offsetTop + KEYBOARD_MARGIN;
            const visibleBottom = viewport.offsetTop + viewport.height - KEYBOARD_MARGIN;
            if (r.bottom > visibleBottom) outer.scrollTop += r.bottom - visibleBottom;
            else if (r.top < visibleTop) outer.scrollTop -= visibleTop - r.top;
        };
        ensureVisible();
        viewport.addEventListener('resize', ensureVisible);
        return () => viewport.removeEventListener('resize', ensureVisible);
    }, [outerRef, enabled, editingElementId]);
}
