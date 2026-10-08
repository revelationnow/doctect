import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuickFormatBar } from '../../components/canvas/QuickFormatBar';
import { TabletToolbar } from '../../components/editor-layout/TabletToolbar';
import { TouchOverlayHostContext } from '../../components/editor-layout/TouchOverlayHost';
import { makeActions } from '../helpers/touchActions';
import type { TemplateElement } from '../../types';

const text: TemplateElement = {
    id: 't', type: 'text', x: 0, y: 0, w: 100, h: 20, rotation: 0, fill: '', stroke: '', strokeWidth: 0,
    opacity: 1, text: 'Hi', fontSize: 14, fontWeight: 'normal', fontStyle: 'normal', textDecoration: 'none',
    align: 'left', textColor: '#000000',
};
const anchor = { left: 100, top: 300, bottom: 320, width: 100 };

/** A touch chrome element with a fixed viewport rect, appended to the body until the test ends. */
const chromeNode = (kind: string, rect: Partial<DOMRect>) => {
    const node = document.createElement('div');
    node.setAttribute('data-touch-chrome', kind);
    node.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, ...rect } as DOMRect);
    document.body.appendChild(node);
    return node;
};

const withInnerWidth = (value: number, run: () => void) => {
    const original = Object.getOwnPropertyDescriptor(window, 'innerWidth');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value });
    try { run(); } finally {
        if (original) Object.defineProperty(window, 'innerWidth', original); else delete (window as any).innerWidth;
    }
};

afterEach(() => {
    // Only the body-level stand-ins from chromeNode: a rendered TabletToolbar is React's to remove.
    document.querySelectorAll('body > [data-touch-chrome]').forEach(node => node.remove());
    delete (globalThis as any).ResizeObserver;
});

describe('QuickFormatBar', () => {
    it.each([
        ['Increase font size', { fontSize: 15 }],
        ['Decrease font size', { fontSize: 13 }],
        ['Bold', { fontWeight: 'bold' }],
        ['Italic', { fontStyle: 'italic' }],
        ['Underline', { textDecoration: 'underline' }],
        ['Align center', { align: 'center' }],
        ['Align right', { align: 'right' }],
    ])('%s issues %o', (label, patch) => {
        const onChange = vi.fn();
        render(<QuickFormatBar element={text} anchor={anchor} onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: label }));
        expect(onChange).toHaveBeenCalledWith(patch);
    });

    it('toggles bold off and changes colour', () => {
        const onChange = vi.fn();
        render(<QuickFormatBar element={{ ...text, fontWeight: 'bold' }} anchor={anchor} onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
        expect(onChange).toHaveBeenCalledWith({ fontWeight: 'normal' });
        fireEvent.change(screen.getByLabelText('Text colour'), { target: { value: '#ff0000' } });
        expect(onChange).toHaveBeenCalledWith({ textColor: '#ff0000' });
    });

    it('sits above the element, or below when there is no room, and keeps edits alive', () => {
        const { rerender } = render(<QuickFormatBar element={text} anchor={anchor} onChange={() => {}} />);
        const bar = screen.getByRole('toolbar', { name: 'Text formatting' });
        expect(bar.style.top).toBe(`${300 - 48 - 8}px`);
        expect(bar.hasAttribute('data-prevent-finish-edit')).toBe(true);
        expect(bar.hasAttribute('data-touch-gesture-ignore')).toBe(true);
        rerender(<QuickFormatBar element={text} anchor={{ ...anchor, top: 20, bottom: 40 }} onChange={() => {}} />);
        expect(bar.style.top).toBe(`${40 + 8}px`);
    });

    // R19: a press on the bar must never reach the canvas's React mouse handlers (which would start
    // a marquee or drag) nor the gesture hook; the bar is portaled, so React synthetic events are the
    // path that remains and must be stopped at the bar root.
    it('stops mousedown and pointerdown at its root and prevents the pointerdown default', () => {
        const onMouseDown = vi.fn();
        const onPointerDown = vi.fn();
        render(
            <div onMouseDown={onMouseDown} onPointerDown={onPointerDown}>
                <QuickFormatBar element={text} anchor={anchor} onChange={() => {}} />
            </div>,
        );
        const bold = screen.getByRole('button', { name: 'Bold' });
        expect(fireEvent.pointerDown(bold, { pointerType: 'touch' })).toBe(false);
        fireEvent.mouseDown(bold);
        expect(onMouseDown).not.toHaveBeenCalled();
        expect(onPointerDown).not.toHaveBeenCalled();
    });

    it('renders every control at the 44px touch minimum with a 16px form control and reflects state', () => {
        render(<QuickFormatBar element={{ ...text, fontStyle: 'italic', align: 'center' }} anchor={anchor} onChange={() => {}} />);
        const bar = screen.getByRole('toolbar', { name: 'Text formatting' });
        const buttons = screen.getAllByRole('button');
        expect(buttons).toHaveLength(8);
        buttons.forEach(button => expect(button.className).toMatch(/\bh-11\b.*\bw-11\b|\bw-11\b.*\bh-11\b/));
        const colour = screen.getByLabelText('Text colour') as HTMLInputElement;
        expect(colour.type).toBe('color');
        expect(colour.className).toMatch(/\btext-base\b/);
        expect(colour.className).toMatch(/\bh-11\b/);
        expect(bar.style.height).toBe('48px');
        expect(screen.getByRole('button', { name: 'Italic' }).getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByRole('button', { name: 'Align center' }).getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByRole('button', { name: 'Align left' }).getAttribute('aria-pressed')).toBe('false');
        expect(screen.getByRole('button', { name: 'Bold' }).getAttribute('aria-pressed')).toBe('false');
        expect(bar.textContent).toContain('14');
    });

    it('streams a colour pick and ends it exactly once on the picker\'s native change', () => {
        const onChange = vi.fn(); const onPickChange = vi.fn(); const onPickEnd = vi.fn();
        const at = (textColor: string) =>
            <QuickFormatBar element={{ ...text, textColor }} anchor={anchor} onChange={onChange} onPickChange={onPickChange} onPickEnd={onPickEnd} />;
        const { rerender } = render(at('#000000'));
        const colour = screen.getByLabelText('Text colour');
        // A host applies each streamed value, so the controlled input keeps it (a static prop would
        // make React restore the old value and report the picker's closing `change` as new).
        const pick = (value: string) => { fireEvent.input(colour, { target: { value } }); rerender(at(value)); };
        pick('#ff0000');
        pick('#00ff00');
        expect(onPickChange.mock.calls).toEqual([[{ textColor: '#ff0000' }], [{ textColor: '#00ff00' }]]);
        expect(onPickEnd).not.toHaveBeenCalled();
        fireEvent.change(colour, { target: { value: '#00ff00' } }); // the picker closes, repeating the last value
        expect(onPickEnd).toHaveBeenCalledTimes(1);
        fireEvent.change(colour, { target: { value: '#00ff00' } }); // a stray change outside a pick is inert
        expect(onPickEnd).toHaveBeenCalledTimes(1);
        expect(onChange).not.toHaveBeenCalled();
        fireEvent.change(colour, { target: { value: '#0000ff' } }); // a lone new value (typed, no drag): discrete
        expect(onChange).toHaveBeenCalledWith({ textColor: '#0000ff' });
        expect(onPickChange).toHaveBeenCalledTimes(2);
        expect(onPickEnd).toHaveBeenCalledTimes(1);
    });

    it('ends an open pick on blur and on unmount, never twice', () => {
        const onPickEnd = vi.fn();
        const { unmount } = render(
            <QuickFormatBar element={text} anchor={anchor} onChange={() => {}} onPickChange={() => {}} onPickEnd={onPickEnd} />,
        );
        const colour = screen.getByLabelText('Text colour');
        fireEvent.input(colour, { target: { value: '#ff0000' } });
        fireEvent.blur(colour);
        expect(onPickEnd).toHaveBeenCalledTimes(1);
        fireEvent.blur(colour);
        expect(onPickEnd).toHaveBeenCalledTimes(1);
        fireEvent.input(colour, { target: { value: '#00ff00' } });
        unmount();
        expect(onPickEnd).toHaveBeenCalledTimes(2);
    });

    it('lets the colour input take focus: its pointerdown default is kept while a button\'s is prevented', () => {
        const onPointerDown = vi.fn();
        render(
            <div onPointerDown={onPointerDown}>
                <QuickFormatBar element={text} anchor={anchor} onChange={() => {}} />
            </div>,
        );
        expect(fireEvent.pointerDown(screen.getByLabelText('Text colour'), { pointerType: 'touch' })).toBe(true);
        expect(fireEvent.pointerDown(screen.getByRole('button', { name: 'Bold' }), { pointerType: 'touch' })).toBe(false);
        expect(onPointerDown).not.toHaveBeenCalled();
    });

    it('wraps onto two rows at phone widths instead of scrolling, keeping every 44px control', () => {
        withInnerWidth(360, () => {
            render(<QuickFormatBar element={text} anchor={anchor} onChange={() => {}} />);
            const bar = screen.getByRole('toolbar', { name: 'Text formatting' });
            expect(bar.className).toMatch(/\bflex-wrap\b/);
            expect(bar.className).not.toMatch(/overflow-x/);
            expect(bar.style.width).toBe('344px');
            expect(bar.style.height).toBe('94px');
            expect(bar.style.top).toBe(`${300 - 94 - 8}px`);
            expect(screen.getAllByRole('button')).toHaveLength(8);
            expect(screen.getByLabelText('Text colour')).toBeTruthy();
        });
    });

    // Ten items (eight 44px buttons, the 28px readout, the 44px colour control) with nine 2px gaps
    // need 442px of content, plus the 10px frame: a 452px bar (a 468px viewport) is one row; a
    // pixel narrower wraps. (The former 444 wrapped bars that in fact fit.)
    it('wraps exactly when the content box drops below 442px', () => {
        withInnerWidth(468, () => {
            const { unmount } = render(<QuickFormatBar element={text} anchor={anchor} onChange={() => {}} />);
            const bar = screen.getByRole('toolbar', { name: 'Text formatting' });
            expect(bar.style.width).toBe('452px');
            expect(bar.style.height).toBe('48px');
            unmount();
        });
        withInnerWidth(467, () => {
            render(<QuickFormatBar element={text} anchor={anchor} onChange={() => {}} />);
            const bar = screen.getByRole('toolbar', { name: 'Text formatting' });
            expect(bar.style.width).toBe('451px');
            expect(bar.style.height).toBe('94px');
        });
    });

    it('draws a 24px swatch of the current colour inside the 44px colour control, inert to the pointer', () => {
        render(<QuickFormatBar element={{ ...text, textColor: '#ff8800' }} anchor={anchor} onChange={() => {}} />);
        const colour = screen.getByLabelText('Text colour') as HTMLInputElement;
        expect(colour.value).toBe('#ff8800');
        expect(colour.className).toMatch(/\bh-11\b/);
        expect(colour.className).toMatch(/\bw-11\b/);
        expect(colour.className).toMatch(/\babsolute\b/);
        expect(colour.className).toMatch(/\binset-0\b/);
        const target = colour.parentElement!;
        expect(target.className).toMatch(/\bh-11\b/);
        expect(target.className).toMatch(/\bw-11\b/);
        expect(target.className).toMatch(/\brelative\b/);
        const swatch = screen.getByTestId('quick-format-colour-swatch');
        expect(swatch.parentElement).toBe(target);
        expect(swatch.getAttribute('aria-hidden')).toBe('true');
        expect(swatch.className).toMatch(/\bh-6\b/);
        expect(swatch.className).toMatch(/\bw-6\b/);
        expect(swatch.className).toMatch(/\bpointer-events-none\b/);
        expect(swatch.style.backgroundColor).toBe('rgb(255, 136, 0)');
        expect(swatch.className).toMatch(/\bpeer-focus-visible:/);
        expect(colour.className).toMatch(/\bpeer\b/);
    });

    // Browsers deliver one notification when an element is first observed, so the fake does too:
    // a discovery pass that re-observed every element on each notification would never settle.
    class FakeResizeObserver {
        static instances: FakeResizeObserver[] = [];
        readonly targets = new Set<Element>();
        observeCalls = 0;
        notifications = 0;
        constructor(private readonly callback: () => void) { FakeResizeObserver.instances.push(this); }
        observe(target: Element) {
            this.targets.add(target);
            this.observeCalls += 1;
            queueMicrotask(() => this.notify());
        }
        notify() { this.notifications += 1; this.callback(); }
        disconnect() { this.targets.clear(); }
    }
    const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

    it('re-clamps when the sheet or the pill resizes, observing chrome that appears later, without an observe loop', async () => {
        (globalThis as any).ResizeObserver = FakeResizeObserver;
        FakeResizeObserver.instances = [];
        chromeNode('top-bar', { top: 0, bottom: 56 });
        const sheet = chromeNode('sheet', { top: 328, bottom: 400 });
        Object.defineProperty(window, 'visualViewport', {
            configurable: true, value: { offsetTop: 0, height: 400, addEventListener() {}, removeEventListener() {} },
        });
        try {
            render(<QuickFormatBar element={text} anchor={{ left: 100, top: 700, bottom: 720, width: 100 }} onChange={() => {}} />);
            await settle();
            const bar = screen.getByRole('toolbar', { name: 'Text formatting' });
            expect(bar.style.top).toBe(`${328 - 48 - 8}px`); // bottom-clamped above the sheet at peek
            expect(FakeResizeObserver.instances).toHaveLength(1);
            const observer = FakeResizeObserver.instances[0];
            expect(Array.from(observer.targets).map(node => node.getAttribute('data-touch-chrome'))).toEqual(['top-bar', 'sheet']);
            expect(observer.observeCalls).toBe(2); // the initial notifications did not re-observe anything
            expect(observer.notifications).toBe(2);

            // The sheet rises to half: nothing else about the bar changed, yet it must move up.
            sheet.getBoundingClientRect = () => ({ top: 200, bottom: 400, left: 0, right: 0, width: 0, height: 200 } as DOMRect);
            act(() => observer.notify());
            expect(bar.style.top).toBe(`${200 - 48 - 8}px`);

            // Back to peek: the sheet shrinks and the pill mounts in the same commit. The sheet's
            // notification brings the pill under observation; the pill's own initial notification
            // then re-clamps above it, and the sequence ends there.
            sheet.getBoundingClientRect = () => ({ top: 328, bottom: 400, left: 0, right: 0, width: 0, height: 72 } as DOMRect);
            const pill = chromeNode('tool-pill', { top: 236, bottom: 316 });
            act(() => observer.notify());
            await settle();
            expect(observer.targets.has(pill)).toBe(true);
            expect(observer.observeCalls).toBe(3);
            expect(observer.notifications).toBe(5);
            expect(bar.style.top).toBe(`${236 - 48 - 8}px`);

            // The pill wraps to two rows (taller, higher top): re-clamped again from the same observer.
            pill.getBoundingClientRect = () => ({ top: 192, bottom: 316, left: 0, right: 0, width: 0, height: 124 } as DOMRect);
            act(() => observer.notify());
            expect(bar.style.top).toBe(`${192 - 48 - 8}px`);
            await settle();
            expect(observer.observeCalls).toBe(3);
        } finally {
            delete (window as any).visualViewport;
        }
    });

    it('disconnects its chrome observer on unmount', async () => {
        (globalThis as any).ResizeObserver = FakeResizeObserver;
        FakeResizeObserver.instances = [];
        chromeNode('sheet', { top: 328, bottom: 400 });
        const { unmount } = render(<QuickFormatBar element={text} anchor={anchor} onChange={() => {}} />);
        await settle();
        const observer = FakeResizeObserver.instances[0];
        const disconnect = vi.spyOn(observer, 'disconnect');
        unmount();
        expect(disconnect).toHaveBeenCalledTimes(1);
    });

    it('clamps into the visible band: under the top bar, above the sheet and keyboard, never off-screen', () => {
        const chrome = chromeNode;
        const topBar = chrome('top-bar', { top: 0, bottom: 56 });
        const sheet = chrome('sheet', { top: 328, bottom: 400 });
        Object.defineProperty(window, 'visualViewport', {
            configurable: true, value: { offsetTop: 0, height: 400, addEventListener() {}, removeEventListener() {} },
        });
        const at = (top: number, bottom: number) => <QuickFormatBar element={text} anchor={{ left: 100, top, bottom, width: 100 }} onChange={() => {}} />;
        try {
            const { rerender } = render(at(20, 40));
            const bar = screen.getByRole('toolbar', { name: 'Text formatting' });
            expect(bar.style.top).toBe(`${56 + 8}px`);        // "below" would be 48px, under the top bar
            rerender(at(700, 720));
            expect(bar.style.top).toBe(`${328 - 48 - 8}px`);  // "above" would be 644px, under the sheet / keyboard
            rerender(at(200, 220));
            expect(bar.style.top).toBe(`${200 - 48 - 8}px`);  // inside the band: untouched
            // R33: the phone tool pill floats above the sheet; a bottom-clamped bar stops above it.
            const pill = chrome('tool-pill', { top: 236, bottom: 316 });
            rerender(at(700, 720));
            expect(bar.style.top).toBe(`${236 - 48 - 8}px`);
            pill.remove();
            rerender(at(700, 720));
            expect(bar.style.top).toBe(`${328 - 48 - 8}px`);  // pill unmounted (sheet raised): the sheet bounds again
            sheet.getBoundingClientRect = () => ({ top: 80, bottom: 400, left: 0, right: 0, width: 0, height: 0 } as DOMRect);
            rerender(at(200, 220));
            expect(bar.style.top).toBe(`${56 + 8}px`);        // band shorter than the bar: pinned to its top
        } finally {
            topBar.remove(); sheet.remove();
            document.querySelector('[data-touch-chrome="tool-pill"]')?.remove();
            delete (window as any).visualViewport;
        }
    });

    // M1: the tablet toolbar is the top bar of its layout; the band must stop under it as it does
    // under the phone top bar, so a text element panned up under the toolbar never gets a bar
    // over the tool buttons.
    it('clamps under the tablet toolbar, which tags itself as the top bar', () => {
        const { container } = render(<TabletToolbar actions={makeActions()} onOpenSidebar={() => {}} />);
        const toolbar = container.firstElementChild as HTMLElement;
        toolbar.getBoundingClientRect = () => ({ top: 0, bottom: 56, left: 0, right: 0, width: 0, height: 56 } as DOMRect);
        render(<QuickFormatBar element={text} anchor={{ left: 100, top: 20, bottom: 40, width: 100 }} onChange={() => {}} />);
        const bar = screen.getByRole('toolbar', { name: 'Text formatting' });
        expect(bar.style.top).toBe(`${56 + 8}px`); // "below" would be 48px, under the toolbar
    });

    // I1: the bar lives in the project pane's stacking context, between the phone tool pill (z-20)
    // and the properties sheet (z-30), so the sheet, the drawer (z-40), the in-pane dialogs (z-50)
    // and every body-level overlay (which out-ranks the pane) cover it. The touch layouts provide
    // the host; without one (tests rendering the bar alone) it falls back to document.body.
    it('portals into the touch layout\'s overlay host at a z-index between the tool pill and the sheet', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        try {
            const { container } = render(
                <TouchOverlayHostContext.Provider value={host}>
                    <QuickFormatBar element={text} anchor={anchor} onChange={() => {}} />
                </TouchOverlayHostContext.Provider>,
            );
            const bar = screen.getByRole('toolbar', { name: 'Text formatting' });
            expect(container.contains(bar)).toBe(false);
            expect(bar.parentElement).toBe(host);
            expect(bar.className).toMatch(/\bfixed\b/);
            expect(bar.className.split(/\s+/)).toContain('z-[25]');
            expect(bar.className).not.toMatch(/z-\[200\]/);
        } finally {
            host.remove();
        }
    });

    it('falls back to a portal on document.body when no touch layout hosts it', () => {
        const { container } = render(<QuickFormatBar element={text} anchor={anchor} onChange={() => {}} />);
        const bar = screen.getByRole('toolbar', { name: 'Text formatting' });
        expect(container.contains(bar)).toBe(false);
        expect(bar.parentElement).toBe(document.body);
    });
});
