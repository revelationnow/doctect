import React, { useRef } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    DOUBLE_TAP_MS, DOUBLE_TAP_SLOP_PX, LONG_PRESS_MS, TAP_SLOP_PX, TouchGestureHandlers, useCanvasTouchGestures,
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

    it('cancels a direct drag and switches to pinch when a second finger lands', () => {
        const h = { ...makeHandlers(true), onDirectCancel: vi.fn() };
        const { getByTestId } = render(<Harness handlers={h} />);
        const s = getByTestId('surface');
        pointer(s, 'pointerdown', 1, 100, 100);
        const move = pointer(s, 'pointermove', 1, 120, 100);
        pointer(s, 'pointerdown', 2, 200, 100);
        expect(h.onDirectCancel).toHaveBeenCalledTimes(1);
        expect(vi.mocked(h.onDirectCancel).mock.calls[0][0]).toBe(move);
        expect(h.onDirectUp).not.toHaveBeenCalled();
        pointer(s, 'pointermove', 2, 300, 100);
        // Pinch pairs finger 1 at its last position (120) with finger 2: 80 -> 180 px, centre 210.
        expect(h.onPinch).toHaveBeenCalledWith(2.25, 210, 100);
        pointer(s, 'pointerup', 1, 120, 100);
        pointer(s, 'pointerup', 2, 300, 100);
        expect(h.onDirectCancel).toHaveBeenCalledTimes(1);
        expect(h.onDirectUp).not.toHaveBeenCalled();
        expect(h.onGestureEnd).toHaveBeenCalledTimes(1);
    });

    it('falls back to onDirectUp when a second finger lands and no onDirectCancel is provided', () => {
        const h = makeHandlers(true);
        const { getByTestId } = render(<Harness handlers={h} />);
        const s = getByTestId('surface');
        pointer(s, 'pointerdown', 1, 100, 100);
        pointer(s, 'pointerdown', 2, 200, 100);
        expect(h.onDirectUp).toHaveBeenCalledTimes(1);
        pointer(s, 'pointerup', 1, 100, 100);
        pointer(s, 'pointerup', 2, 200, 100);
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

    // Thresholds (spec §Testing "drag thresholds")

    it('reports two single taps when the second tap is later than the double-tap window', () => {
        const h = makeHandlers();
        const { getByTestId } = render(<Harness handlers={h} />);
        const s = getByTestId('surface');
        pointer(s, 'pointerdown', 1, 50, 50); pointer(s, 'pointerup', 1, 50, 50);
        act(() => { vi.advanceTimersByTime(DOUBLE_TAP_MS + 1); });
        pointer(s, 'pointerdown', 2, 50, 50); pointer(s, 'pointerup', 2, 50, 50);
        expect(h.onTap).toHaveBeenCalledTimes(2);
        expect(h.onDoubleTap).not.toHaveBeenCalled();
    });

    it('reports two single taps when the second tap is farther than the double-tap slop', () => {
        const h = makeHandlers();
        const { getByTestId } = render(<Harness handlers={h} />);
        const s = getByTestId('surface');
        const farX = 50 + DOUBLE_TAP_SLOP_PX + 1;
        pointer(s, 'pointerdown', 1, 50, 50); pointer(s, 'pointerup', 1, 50, 50);
        pointer(s, 'pointerdown', 2, farX, 50); pointer(s, 'pointerup', 2, farX, 50);
        expect(h.onTap).toHaveBeenCalledTimes(2);
        expect(h.onDoubleTap).not.toHaveBeenCalled();
    });

    it('still reports a tap when the finger wobbles within the tap slop', () => {
        const h = makeHandlers();
        const { getByTestId } = render(<Harness handlers={h} />);
        const s = getByTestId('surface');
        pointer(s, 'pointerdown', 1, 10, 10);
        pointer(s, 'pointermove', 1, 10 + TAP_SLOP_PX, 10);
        pointer(s, 'pointerup', 1, 10 + TAP_SLOP_PX, 10);
        expect(h.onTap).toHaveBeenCalledTimes(1);
        expect(h.onTap).toHaveBeenCalledWith(expect.objectContaining({ clientX: 10, clientY: 10 }));
        expect(h.onPan).not.toHaveBeenCalled();
    });

    it('does not fire a long press once the finger has moved past the tap slop', () => {
        const h = makeHandlers();
        const { getByTestId } = render(<Harness handlers={h} />);
        const s = getByTestId('surface');
        const pastSlop = 10 + TAP_SLOP_PX + 1;
        pointer(s, 'pointerdown', 1, 10, 10);
        pointer(s, 'pointermove', 1, pastSlop, 10);
        act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
        pointer(s, 'pointerup', 1, pastSlop, 10);
        expect(h.onLongPress).not.toHaveBeenCalled();
        expect(h.onPan).toHaveBeenCalledWith(TAP_SLOP_PX + 1, 0);
        expect(h.onTap).not.toHaveBeenCalled();
    });

    // Second pointer cancels one-finger actions (spec §Testing)

    it('turns a pending tap into a pinch when a second finger lands, with no tap or long press on lift', () => {
        const h = makeHandlers();
        const { getByTestId } = render(<Harness handlers={h} />);
        const s = getByTestId('surface');
        pointer(s, 'pointerdown', 1, 100, 100);
        pointer(s, 'pointerdown', 2, 200, 100);
        act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
        pointer(s, 'pointermove', 2, 250, 100);
        expect(h.onPinch).toHaveBeenCalledWith(1.5, 175, 100);
        pointer(s, 'pointerup', 1, 100, 100);
        pointer(s, 'pointerup', 2, 250, 100);
        expect(h.onTap).not.toHaveBeenCalled();
        expect(h.onLongPress).not.toHaveBeenCalled();
        expect(h.onDirectDown).not.toHaveBeenCalled();
        expect(h.onGestureStart).toHaveBeenCalledTimes(1);
        expect(h.onGestureEnd).toHaveBeenCalledTimes(1);
    });

    it('ignores a third finger so lifting one of the pinch pair cannot jump the zoom', () => {
        const h = makeHandlers();
        const { getByTestId } = render(<Harness handlers={h} />);
        const s = getByTestId('surface');
        pointer(s, 'pointerdown', 1, 100, 100);
        pointer(s, 'pointerdown', 2, 200, 100);
        pointer(s, 'pointermove', 2, 300, 100);
        expect(h.onPinch).toHaveBeenCalledTimes(1);
        const third = pointer(s, 'pointerdown', 3, 500, 500);
        expect(third.defaultPrevented).toBe(true);
        pointer(s, 'pointermove', 3, 600, 600);
        pointer(s, 'pointerup', 1, 100, 100);
        pointer(s, 'pointermove', 3, 650, 650);
        pointer(s, 'pointermove', 2, 320, 100);
        expect(h.onPinch).toHaveBeenCalledTimes(1);
        expect(h.onPan).toHaveBeenCalledTimes(1);
        pointer(s, 'pointerup', 3, 650, 650);
        expect(h.onGestureEnd).not.toHaveBeenCalled();
        pointer(s, 'pointerup', 2, 320, 100);
        expect(h.onGestureEnd).toHaveBeenCalledTimes(1);
    });


    // Long press during a direct drag (selected element / handle under the finger)

    it('fires a long press during a direct drag that stays put, cancelling the direct drag first', () => {
        const h = { ...makeHandlers(true), onDirectCancel: vi.fn() };
        const order: string[] = [];
        h.onDirectCancel.mockImplementation(() => { order.push('cancel'); });
        vi.mocked(h.onLongPress).mockImplementation(() => { order.push('longPress'); });
        const { getByTestId } = render(<Harness handlers={h} />);
        const s = getByTestId('surface');
        pointer(s, 'pointerdown', 1, 30, 40);
        const wobble = pointer(s, 'pointermove', 1, 30 + TAP_SLOP_PX, 40); // within slop keeps the timer
        act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
        expect(order).toEqual(['cancel', 'longPress']);
        expect(vi.mocked(h.onDirectCancel).mock.calls[0][0]).toBe(wobble);
        expect(h.onLongPress).toHaveBeenCalledWith(expect.objectContaining({ clientX: 30, clientY: 40 }));
        pointer(s, 'pointermove', 1, 80, 40);
        pointer(s, 'pointerup', 1, 80, 40);
        expect(h.onDirectMove).toHaveBeenCalledTimes(1); // only the wobble; nothing after the long press
        expect(h.onDirectUp).not.toHaveBeenCalled();
        expect(h.onTap).not.toHaveBeenCalled();
        expect(h.onPan).not.toHaveBeenCalled();
        expect(h.onGestureEnd).toHaveBeenCalledTimes(1);
    });

    it('does not fire a long press once a direct drag has moved past the tap slop', () => {
        const h = { ...makeHandlers(true), onDirectCancel: vi.fn() };
        const { getByTestId } = render(<Harness handlers={h} />);
        const s = getByTestId('surface');
        pointer(s, 'pointerdown', 1, 10, 10);
        pointer(s, 'pointermove', 1, 10 + TAP_SLOP_PX + 1, 10);
        act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
        pointer(s, 'pointerup', 1, 40, 10);
        expect(h.onLongPress).not.toHaveBeenCalled();
        expect(h.onDirectCancel).not.toHaveBeenCalled();
        expect(h.onDirectMove).toHaveBeenCalledTimes(1);
        expect(h.onDirectUp).toHaveBeenCalledTimes(1);
    });


    it('keeps a direct drag alive when canLongPress declines, so a held press can still drag', () => {
        const h = { ...makeHandlers(true), onDirectCancel: vi.fn(), canLongPress: vi.fn(() => false) };
        const { getByTestId } = render(<Harness handlers={h} />);
        const s = getByTestId('surface');
        pointer(s, 'pointerdown', 1, 10, 10);
        act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
        expect(h.canLongPress).toHaveBeenCalledWith(expect.objectContaining({ clientX: 10, clientY: 10 }));
        expect(h.onLongPress).not.toHaveBeenCalled();
        expect(h.onDirectCancel).not.toHaveBeenCalled();
        pointer(s, 'pointermove', 1, 60, 40);
        pointer(s, 'pointerup', 1, 60, 40);
        expect(h.onDirectMove).toHaveBeenCalledTimes(1);
        expect(h.onDirectUp).toHaveBeenCalledTimes(1);
        expect(h.onGestureEnd).toHaveBeenCalledTimes(1);
    });

    it('lets a pending press become a tap when canLongPress declines', () => {
        const h = { ...makeHandlers(), canLongPress: vi.fn(() => false) };
        const { getByTestId } = render(<Harness handlers={h} />);
        const s = getByTestId('surface');
        pointer(s, 'pointerdown', 1, 10, 10);
        act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
        pointer(s, 'pointerup', 1, 10, 10);
        expect(h.onLongPress).not.toHaveBeenCalled();
        expect(h.onTap).toHaveBeenCalledTimes(1);
    });

    // Cancel path

    it('routes pointercancel during a direct drag to onDirectCancel with the last direct event', () => {
        const h = { ...makeHandlers(true), onDirectCancel: vi.fn() };
        const { getByTestId } = render(<Harness handlers={h} />);
        const s = getByTestId('surface');
        pointer(s, 'pointerdown', 1, 10, 10);
        const move = pointer(s, 'pointermove', 1, 40, 10);
        pointer(s, 'pointercancel', 1, 0, 0);
        expect(h.onDirectCancel).toHaveBeenCalledTimes(1);
        // Reference identity: two MouseEvents have no own enumerable props, so toHaveBeenCalledWith can't tell them apart.
        expect(vi.mocked(h.onDirectCancel).mock.calls[0][0]).toBe(move);
        expect(h.onDirectUp).not.toHaveBeenCalled();
        expect(h.onGestureEnd).toHaveBeenCalledTimes(1);
    });

    it('falls back to onDirectUp on pointercancel when no onDirectCancel is provided', () => {
        const h = makeHandlers(true);
        const { getByTestId } = render(<Harness handlers={h} />);
        const s = getByTestId('surface');
        pointer(s, 'pointerdown', 1, 10, 10);
        const move = pointer(s, 'pointermove', 1, 40, 10);
        pointer(s, 'pointercancel', 1, 0, 0);
        expect(h.onDirectUp).toHaveBeenCalledTimes(1);
        expect(vi.mocked(h.onDirectUp).mock.calls[0][0]).toBe(move);
        expect(h.onGestureEnd).toHaveBeenCalledTimes(1);
    });

    it('cancels a direct drag and ends the gesture when disabled mid-drag', () => {
        const h = { ...makeHandlers(true), onDirectCancel: vi.fn() };
        const { getByTestId, rerender } = render(<Harness handlers={h} />);
        const s = getByTestId('surface');
        pointer(s, 'pointerdown', 1, 10, 10);
        const move = pointer(s, 'pointermove', 1, 40, 10);
        rerender(<Harness handlers={h} enabled={false} />);
        expect(h.onDirectCancel).toHaveBeenCalledTimes(1);
        expect(vi.mocked(h.onDirectCancel).mock.calls[0][0]).toBe(move);
        expect(h.onDirectUp).not.toHaveBeenCalled();
        expect(h.onGestureEnd).toHaveBeenCalledTimes(1);
        pointer(s, 'pointerup', 1, 40, 10);
        expect(h.onGestureEnd).toHaveBeenCalledTimes(1);
    });

    it('ends a pending gesture on unmount without reporting a tap or long press', () => {
        const h = makeHandlers();
        const { getByTestId, unmount } = render(<Harness handlers={h} />);
        pointer(getByTestId('surface'), 'pointerdown', 1, 10, 10);
        unmount();
        expect(h.onGestureEnd).toHaveBeenCalledTimes(1);
        expect(h.onDirectUp).not.toHaveBeenCalled();
        act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
        expect(h.onTap).not.toHaveBeenCalled();
        expect(h.onLongPress).not.toHaveBeenCalled();
    });

    it('does not report a gesture end when disabled while idle', () => {
        const h = makeHandlers();
        const { getByTestId, rerender } = render(<Harness handlers={h} />);
        const s = getByTestId('surface');
        pointer(s, 'pointerdown', 1, 10, 10); pointer(s, 'pointerup', 1, 10, 10);
        expect(h.onGestureEnd).toHaveBeenCalledTimes(1);
        rerender(<Harness handlers={h} enabled={false} />);
        expect(h.onGestureEnd).toHaveBeenCalledTimes(1);
        expect(h.onDirectUp).not.toHaveBeenCalled();
    });
});
