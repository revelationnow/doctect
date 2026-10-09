import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PILL_SCROLLER_ATTR, ToolPillScroller } from '../../components/editor-layout/ToolPillScroller';

// jsdom lays nothing out: the row's scroll metrics and the buttons' boxes are stubbed per test.
const metrics = (el: HTMLElement, { scrollWidth, clientWidth }: { scrollWidth: number; clientWidth: number }) => {
    Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth });
    Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth });
};
const box = (el: Element, left: number, width: number) => {
    el.getBoundingClientRect = () => ({ left, right: left + width, width, top: 0, bottom: 44, height: 44, x: left, y: 0, toJSON: () => ({}) });
};

function Row({ active }: { active: string }) {
    return (
        <ToolPillScroller activeKey={active}>
            {['a', 'b', 'c'].map(key => <button key={key} type="button" aria-pressed={key === active}>{key}</button>)}
        </ToolPillScroller>
    );
}

const scroller = () => document.querySelector(`[${PILL_SCROLLER_ATTR}]`) as HTMLElement;
const fadeShown = (edge: 'start' | 'end') => !screen.getByTestId(`tool-pill-fade-${edge}`).hidden;

describe('ToolPillScroller', () => {
    it('shows an edge fade only on a side with more tools to reveal', () => {
        render(<Row active="a" />);
        // A row that fits shows no fades.
        expect(fadeShown('start')).toBe(false);
        expect(fadeShown('end')).toBe(false);
        metrics(scroller(), { scrollWidth: 440, clientWidth: 300 });
        act(() => { fireEvent.scroll(scroller()); });
        expect([fadeShown('start'), fadeShown('end')]).toEqual([false, true]);
        act(() => { scroller().scrollLeft = 70; fireEvent.scroll(scroller()); });
        expect([fadeShown('start'), fadeShown('end')]).toEqual([true, true]);
        act(() => { scroller().scrollLeft = 140; fireEvent.scroll(scroller()); });
        expect([fadeShown('start'), fadeShown('end')]).toEqual([true, false]);
    });

    it('scrolls the pressed tool into view when the active tool changes, and leaves a visible one alone', () => {
        const view = render(<Row active="a" />);
        const row = scroller();
        box(row, 0, 300);
        const [, b, c] = screen.getAllByRole('button');
        box(b, 150, 44);
        box(c, 380, 44); // past the right edge
        view.rerender(<Row active="b" />);
        expect(row.scrollLeft).toBe(0);
        view.rerender(<Row active="c" />);
        expect(row.scrollLeft).toBe(124);
        // Scrolled to the far end, a tool off the left edge comes back the other way.
        row.scrollLeft = 200;
        box(b, -50, 44);
        view.rerender(<Row active="b" />);
        expect(row.scrollLeft).toBe(150);
    });
});
