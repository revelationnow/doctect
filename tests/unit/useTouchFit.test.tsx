import React, { useRef, useState } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MOUSE_CANVAS_GUTTER, TOUCH_CANVAS_GUTTER, useTouchFit } from '../../hooks/useTouchFit';

// jsdom lays nothing out, so the container's clientWidth is stubbed per test; a fake
// ResizeObserver records the observed element and lets the test fire a resize.
const observed: Array<{ target: Element; callback: () => void; disconnect: () => void }> = [];
class FakeResizeObserver {
    private readonly entry: { target: Element; callback: () => void; disconnect: () => void };
    constructor(private readonly callback: () => void) {
        this.entry = { target: document.body, callback, disconnect: vi.fn() };
    }
    observe(target: Element) { this.entry.target = target; observed.push(this.entry); }
    disconnect() { this.entry.disconnect(); }
}

const widthOf = (el: HTMLElement, width: number) => Object.defineProperty(el, 'clientWidth', { configurable: true, value: width });

/** A canvas stand-in: the scale lives in state like the touch viewport's, so the prop lags onZoom by a render. */
function Probe({ enabled, fitSignal, pageWidth, onZoom, width, scaleRef }: {
    enabled: boolean; fitSignal: number | undefined; pageWidth: number; onZoom: (s: number) => void;
    width: number; scaleRef: { current: (s: number) => void };
}) {
    const [scale, setScale] = useState(1);
    scaleRef.current = setScale;
    const outer = useRef<HTMLDivElement>(null);
    useTouchFit(outer, { enabled, fitSignal, pageWidth, scale, onZoom: s => { onZoom(s); setScale(s); } });
    return <div ref={el => { outer.current = el; if (el) widthOf(el, width); }} />;
}

afterEach(() => {
    observed.length = 0;
    delete (globalThis as any).ResizeObserver;
});

describe('useTouchFit', () => {
    it('fits the page to the container width minus the gutters as soon as a request arrives', () => {
        const onZoom = vi.fn();
        const setScale = { current: (_: number) => {} };
        const view = render(<Probe enabled fitSignal={1} pageWidth={595} onZoom={onZoom} width={390} scaleRef={setScale} />);
        expect(onZoom).toHaveBeenCalledWith((390 - 2 * TOUCH_CANVAS_GUTTER) / 595);
        view.rerender(<Probe enabled fitSignal={2} pageWidth={595} onZoom={onZoom} width={390} scaleRef={setScale} />);
        expect(onZoom).toHaveBeenCalledTimes(2);
        // Without ResizeObserver (jsdom) the request is applied once and nothing else is wired.
        expect(observed).toEqual([]);
    });

    it('does nothing on the mouse canvas or without a request', () => {
        const onZoom = vi.fn();
        const setScale = { current: (_: number) => {} };
        render(<Probe enabled={false} fitSignal={1} pageWidth={595} onZoom={onZoom} width={390} scaleRef={setScale} />);
        render(<Probe enabled fitSignal={undefined} pageWidth={595} onZoom={onZoom} width={390} scaleRef={setScale} />);
        expect(onZoom).not.toHaveBeenCalled();
    });

    it('refits when the container settles at another width after the request, until the user zooms', () => {
        (globalThis as any).ResizeObserver = FakeResizeObserver;
        const onZoom = vi.fn();
        const setScale = { current: (_: number) => {} };
        const view = render(<Probe enabled fitSignal={1} pageWidth={595} onZoom={onZoom} width={595} scaleRef={setScale} />);
        // The first reading is of an unsettled layout (the Tailwind runtime has not styled the fresh markup yet).
        expect(onZoom).toHaveBeenLastCalledWith((595 - 32) / 595);
        expect(observed).toHaveLength(1);
        const outer = observed[0].target as HTMLElement;
        widthOf(outer, 390);
        act(() => observed[0].callback());
        expect(onZoom).toHaveBeenLastCalledWith((390 - 32) / 595);
        expect(onZoom).toHaveBeenCalledTimes(2);

        // A pinch (any scale the hook did not issue) spends the request: later width changes leave it alone.
        act(() => setScale.current(2));
        widthOf(outer, 300);
        act(() => observed[0].callback());
        expect(onZoom).toHaveBeenCalledTimes(2);
        expect(observed[0].disconnect).toHaveBeenCalled();

        // A new request (rotation, the Fit button) fits again and observes afresh.
        view.rerender(<Probe enabled fitSignal={2} pageWidth={595} onZoom={onZoom} width={300} scaleRef={setScale} />);
        expect(onZoom).toHaveBeenLastCalledWith((300 - 32) / 595);
        expect(observed).toHaveLength(2);
    });

    it('keeps refitting while the prop still lags behind the fit it issued', () => {
        (globalThis as any).ResizeObserver = FakeResizeObserver;
        const onZoom = vi.fn();
        const setScale = { current: (_: number) => {} };
        // onZoom here never reaches the scale prop (it stays at its pre-fit value, as it does for the
        // render between onZoom and the state update): the request must stay in force regardless.
        function Lagging() {
            const outer = useRef<HTMLDivElement>(null);
            useTouchFit(outer, { enabled: true, fitSignal: 1, pageWidth: 595, scale: 1, onZoom });
            return <div ref={el => { outer.current = el; if (el) widthOf(el, 595); }} />;
        }
        render(<Lagging />);
        widthOf(observed[0].target as HTMLElement, 390);
        act(() => observed[0].callback());
        expect(onZoom).toHaveBeenLastCalledWith((390 - 32) / 595);
        expect(observed[0].disconnect).not.toHaveBeenCalled();
    });

    it('subtracts the gutter it is given (the mouse canvas keeps its wider padding)', () => {
        const onZoom = vi.fn();
        function Mouse() {
            const outer = useRef<HTMLDivElement>(null);
            useTouchFit(outer, { enabled: true, fitSignal: 1, pageWidth: 595, scale: 1, onZoom, gutter: MOUSE_CANVAS_GUTTER });
            return <div ref={el => { outer.current = el; if (el) widthOf(el, 700); }} />;
        }
        render(<Mouse />);
        expect(MOUSE_CANVAS_GUTTER).toBe(48);
        expect(onZoom).toHaveBeenLastCalledWith((700 - 96) / 595);
    });
});
