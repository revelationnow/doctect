import { RefObject, useEffect, useRef } from 'react';

export interface TouchPoint { clientX: number; clientY: number; target: EventTarget | null; }

export interface TouchGestureHandlers {
    claimDirectDrag: (event: PointerEvent) => boolean;
    onDirectDown: (event: PointerEvent) => void;
    onDirectMove: (event: PointerEvent) => void;
    onDirectUp: (event: PointerEvent) => void;
    onTap: (point: TouchPoint) => void;
    onDoubleTap: (point: TouchPoint) => void;
    onLongPress: (point: TouchPoint) => void;
    onPan: (dx: number, dy: number) => void;
    onPinch: (factor: number, centerX: number, centerY: number) => void;
    onGestureStart?: () => void;
    onGestureEnd?: () => void;
}

export const TAP_SLOP_PX = 8;
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_SLOP_PX = 24;
export const LONG_PRESS_MS = 500;
export const GESTURE_IGNORE_ATTR = 'data-touch-gesture-ignore';

type Mode = 'idle' | 'pending' | 'pan' | 'direct' | 'pinch' | 'done';
type Point = { x: number; y: number };

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export function useCanvasTouchGestures(
    ref: RefObject<HTMLElement>,
    handlers: TouchGestureHandlers,
    enabled: boolean,
): void {
    const handlersRef = useRef(handlers);
    handlersRef.current = handlers;

    useEffect(() => {
        const el = ref.current;
        if (!el || !enabled) return;

        const pointers = new Map<number, Point>();
        let mode: Mode = 'idle';
        let start: (TouchPoint & { time: number }) | null = null;
        let last: Point = { x: 0, y: 0 };
        let lastDirectEvent: PointerEvent | null = null;
        let longPressTimer: ReturnType<typeof setTimeout> | null = null;
        let lastTap: { x: number; y: number; time: number } | null = null;
        let pinchDistance = 0;
        let pinchCenter: Point = { x: 0, y: 0 };

        const clearLongPress = () => {
            if (longPressTimer) clearTimeout(longPressTimer);
            longPressTimer = null;
        };

        const registerTap = (point: TouchPoint, notify: boolean) => {
            const now = Date.now();
            if (lastTap && now - lastTap.time <= DOUBLE_TAP_MS
                && Math.hypot(point.clientX - lastTap.x, point.clientY - lastTap.y) <= DOUBLE_TAP_SLOP_PX) {
                lastTap = null;
                handlersRef.current.onDoubleTap(point);
                return;
            }
            lastTap = { x: point.clientX, y: point.clientY, time: now };
            if (notify) handlersRef.current.onTap(point);
        };

        const finishIfIdle = () => {
            if (pointers.size > 0) return;
            clearLongPress();
            mode = 'idle';
            start = null;
            lastDirectEvent = null;
            handlersRef.current.onGestureEnd?.();
        };

        const onDown = (event: PointerEvent) => {
            if (event.pointerType !== 'touch') return;
            if ((event.target as Element | null)?.closest?.(`[${GESTURE_IGNORE_ATTR}]`)) return;
            event.preventDefault();
            el.setPointerCapture?.(event.pointerId);
            pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

            if (pointers.size === 1) {
                start = { clientX: event.clientX, clientY: event.clientY, target: event.target, time: Date.now() };
                last = { x: event.clientX, y: event.clientY };
                handlersRef.current.onGestureStart?.();
                if (handlersRef.current.claimDirectDrag(event)) {
                    mode = 'direct';
                    lastDirectEvent = event;
                    handlersRef.current.onDirectDown(event);
                    return;
                }
                mode = 'pending';
                longPressTimer = setTimeout(() => {
                    longPressTimer = null;
                    if (mode === 'pending' && start) {
                        mode = 'done';
                        handlersRef.current.onLongPress(start);
                    }
                }, LONG_PRESS_MS);
                return;
            }

            if (pointers.size === 2) {
                clearLongPress();
                if (mode === 'direct' && lastDirectEvent) handlersRef.current.onDirectUp(lastDirectEvent);
                const [a, b] = [...pointers.values()];
                pinchDistance = distance(a, b);
                pinchCenter = midpoint(a, b);
                mode = 'pinch';
            }
        };

        const onMove = (event: PointerEvent) => {
            if (event.pointerType !== 'touch' || !pointers.has(event.pointerId)) return;
            pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

            if (mode === 'direct') {
                lastDirectEvent = event;
                handlersRef.current.onDirectMove(event);
                return;
            }
            if (mode === 'pending' && start
                && Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) > TAP_SLOP_PX) {
                clearLongPress();
                mode = 'pan';
            }
            if (mode === 'pan') {
                handlersRef.current.onPan(event.clientX - last.x, event.clientY - last.y);
                last = { x: event.clientX, y: event.clientY };
                return;
            }
            if (mode === 'pinch' && pointers.size >= 2) {
                const [a, b] = [...pointers.values()];
                const nextDistance = distance(a, b);
                const nextCenter = midpoint(a, b);
                if (pinchDistance > 0 && nextDistance > 0) {
                    handlersRef.current.onPinch(nextDistance / pinchDistance, nextCenter.x, nextCenter.y);
                }
                const dx = nextCenter.x - pinchCenter.x;
                const dy = nextCenter.y - pinchCenter.y;
                if (dx !== 0 || dy !== 0) handlersRef.current.onPan(dx, dy);
                pinchDistance = nextDistance;
                pinchCenter = nextCenter;
            }
        };

        const onUp = (event: PointerEvent) => {
            if (event.pointerType !== 'touch' || !pointers.has(event.pointerId)) return;
            pointers.delete(event.pointerId);

            if (mode === 'direct') {
                handlersRef.current.onDirectUp(event);
                if (start && Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) <= TAP_SLOP_PX) {
                    registerTap(start, false);
                }
                mode = 'done';
            } else if (mode === 'pending' && start) {
                clearLongPress();
                registerTap(start, true);
                mode = 'done';
            } else if (mode === 'pinch' && pointers.size < 2) {
                mode = 'done';
            }
            finishIfIdle();
        };

        const onCancel = (event: PointerEvent) => {
            if (event.pointerType !== 'touch' || !pointers.has(event.pointerId)) return;
            pointers.delete(event.pointerId);
            if (mode === 'direct') handlersRef.current.onDirectUp(event);
            mode = 'done';
            finishIfIdle();
        };

        el.addEventListener('pointerdown', onDown, { passive: false });
        el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerup', onUp);
        el.addEventListener('pointercancel', onCancel);
        return () => {
            clearLongPress();
            el.removeEventListener('pointerdown', onDown);
            el.removeEventListener('pointermove', onMove);
            el.removeEventListener('pointerup', onUp);
            el.removeEventListener('pointercancel', onCancel);
        };
    }, [ref, enabled]);
}
