import React, { useRef } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    DOUBLE_TAP_MS, LONG_PRESS_MS, TouchGestureHandlers, useCanvasTouchGestures,
} from '../../hooks/useCanvasTouchGestures';

const pointer = (target: Element, type: string, id: number, x: number, y: number, pointerType = 'touch') => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
    Object.defineProperties(event, { pointerId: { value: id }, pointerType: { value: pointerType } });
    target.dispatchEvent(event);
    return event;
};

const makeHandlers = (claim = false): TouchGestureHandlers & Record<string, any> => ({
    claimDirectDrag: vi.fn(() => claim),
    onDirectDown: vi.fn(), onDirectMove: vi.fn(), onDirectUp: vi.fn(),
    onTap: vi.fn(), onDoubleTap: vi.fn(), onLongPress: vi.fn(),
    onPan: vi.fn(), onPinch: vi.fn(), onGestureStart: vi.fn(), onGestureEnd: vi.fn(),
});

const Harness = ({ handlers, enabled = true }: { handlers: TouchGestureHandlers; enabled?: boolean }) => {
    const ref = useRef<HTMLDivElement>(null);
    useCanvasTouchGestures(ref, handlers, enabled);
    return (
        <div ref={ref} data-testid="surface">
            <span data-testid="inner" />
            <div data-touch-gesture-ignore><button data-testid="ignored" /></div>
        </div>
    );
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useCanvasTouchGestures', () => {
    it('reports a tap and prevents compatibility mouse events', () => {
        const h = makeHandlers();
        const { getByTestId } = render(<Harness handlers={h} />);
        const down = pointer(getByTestId('inner'), 'pointerdown', 1, 10, 10);
        pointer(getByTestId('inner'), 'pointerup', 1, 12, 11);
        expect(down.defaultPrevented).toBe(true);
        expect(h.onTap).toHaveBeenCalledWith(expect.objectContaining({ clientX: 10, clientY: 10 }));
        expect(h.onPan).not.toHaveBeenCalled();
    });

    it('recognises a double tap within the time and distance window', () => {
        const h = makeHandlers();
        const { getByTestId } = render(<Harness handlers={h} />);
        const s = getByTestId('surface');
        pointer(s, 'pointerdown', 1, 50, 50); pointer(s, 'pointerup', 1, 50, 50);
        act(() => { vi.advanceTimersByTime(DOUBLE_TAP_MS - 50); });
        pointer(s, 'pointerdown', 2, 55, 52); pointer(s, 'pointerup', 2, 55, 52);
        expect(h.onTap).toHaveBeenCalledTimes(1);
        expect(h.onDoubleTap).toHaveBeenCalledTimes(1);
    });

    it('turns a moving single finger into pan deltas', () => {
        const h = makeHandlers();
        const { getByTestId } = render(<Harness handlers={h} />);
        const s = getByTestId('surface');
        pointer(s, 'pointerdown', 1, 100, 100);
        pointer(s, 'pointermove', 1, 120, 100);
        pointer(s, 'pointermove', 1, 130, 90);
        pointer(s, 'pointerup', 1, 130, 90);
        expect(h.onPan).toHaveBeenNthCalledWith(1, 20, 0);
        expect(h.onPan).toHaveBeenNthCalledWith(2, 10, -10);
        expect(h.onTap).not.toHaveBeenCalled();
    });

    it('fires a long press when the finger stays put', () => {
        const h = makeHandlers();
        const { getByTestId } = render(<Harness handlers={h} />);
        const s = getByTestId('surface');
        pointer(s, 'pointerdown', 1, 30, 40);
        act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
        pointer(s, 'pointerup', 1, 30, 40);
        expect(h.onLongPress).toHaveBeenCalledWith(expect.objectContaining({ clientX: 30, clientY: 40 }));
        expect(h.onTap).not.toHaveBeenCalled();
    });

    it('routes a claimed drag to the direct handlers', () => {
        const h = makeHandlers(true);
        const { getByTestId } = render(<Harness handlers={h} />);
        const s = getByTestId('surface');
        pointer(s, 'pointerdown', 1, 10, 10);
        pointer(s, 'pointermove', 1, 40, 10);
        pointer(s, 'pointerup', 1, 40, 10);
        expect(h.onDirectDown).toHaveBeenCalledTimes(1);
        expect(h.onDirectMove).toHaveBeenCalledTimes(1);
        expect(h.onDirectUp).toHaveBeenCalledTimes(1);
        expect(h.onPan).not.toHaveBeenCalled();
    });

    it('ends a direct drag and switches to pinch when a second finger lands', () => {
        const h = makeHandlers(true);
        const { getByTestId } = render(<Harness handlers={h} />);
        const s = getByTestId('surface');
        pointer(s, 'pointerdown', 1, 100, 100);
        pointer(s, 'pointerdown', 2, 200, 100);
        expect(h.onDirectUp).toHaveBeenCalledTimes(1);
        pointer(s, 'pointermove', 2, 300, 100);
        expect(h.onPinch).toHaveBeenCalledWith(2, 200, 100);
        pointer(s, 'pointerup', 1, 100, 100);
        pointer(s, 'pointerup', 2, 300, 100);
        expect(h.onDirectUp).toHaveBeenCalledTimes(1);
        expect(h.onGestureEnd).toHaveBeenCalledTimes(1);
    });

    it('ignores mouse pointers, ignored subtrees and disabled state', () => {
        const h = makeHandlers();
        const { getByTestId, rerender } = render(<Harness handlers={h} />);
        pointer(getByTestId('surface'), 'pointerdown', 1, 0, 0, 'mouse');
        pointer(getByTestId('surface'), 'pointerup', 1, 0, 0, 'mouse');
        pointer(getByTestId('ignored'), 'pointerdown', 2, 0, 0);
        pointer(getByTestId('ignored'), 'pointerup', 2, 0, 0);
        rerender(<Harness handlers={h} enabled={false} />);
        pointer(getByTestId('surface'), 'pointerdown', 3, 0, 0);
        pointer(getByTestId('surface'), 'pointerup', 3, 0, 0);
        expect(h.onTap).not.toHaveBeenCalled();
    });
});
