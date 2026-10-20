import React from 'react';
import { act, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectEditorMode, KEYBOARD_SETTLE_MS, MOUSE_PHONE_QUERY, MOUSE_TABLET_QUERY, PHONE_QUERY, useEditorFormFactor } from '../../hooks/useEditorFormFactor';
import { FormFactorProvider, useFormFactor, useInputMode } from '../../components/editor-layout/FormFactorContext';

type Listener = () => void;
const installMatchMedia = (initial: { coarse: boolean; width: number; height: number }) => {
    const env = { ...initial };
    const listeners = new Set<Listener>();
    (window as any).matchMedia = (query: string) => ({
        get matches() {
            if (query === '(pointer: coarse)') return env.coarse;
            // The hook's phone query is a list: either side under 640px, i.e. the shorter side is.
            if (query === PHONE_QUERY) return env.width < 640 || env.height < 640;
            if (query === MOUSE_PHONE_QUERY) return env.width < 640;
            if (query === MOUSE_TABLET_QUERY) return env.width < 1024;
            return false;
        },
        media: query,
        addEventListener: (_: string, fn: Listener) => listeners.add(fn),
        removeEventListener: (_: string, fn: Listener) => listeners.delete(fn),
    });
    return {
        set(next: Partial<typeof env>) { Object.assign(env, next); listeners.forEach(fn => fn()); },
    };
};

afterEach(() => {
    delete (window as any).matchMedia;
    document.documentElement.removeAttribute('data-form-factor');
    document.documentElement.removeAttribute('data-input');
});

describe('detectEditorMode', () => {
    it('subscribes to the queries the plan names', () => {
        expect(PHONE_QUERY).toBe('(max-width: 639px), (max-height: 639px)');
        expect(MOUSE_PHONE_QUERY).toBe('(max-width: 639px)');
        expect(MOUSE_TABLET_QUERY).toBe('(max-width: 1023px)');
    });

    it.each([
        // A fine pointer: the width alone decides; a short, wide window stays desktop.
        [false, 600, 900, 'phone'], [false, 639, 900, 'phone'], [false, 640, 900, 'tablet'], [false, 800, 900, 'tablet'],
        [false, 1023, 900, 'tablet'], [false, 1024, 900, 'desktop'], [false, 1440, 900, 'desktop'], [false, 1440, 500, 'desktop'],
        [false, 844, 390, 'tablet'], [false, 390, 844, 'phone'],
        // Coarse: the shorter side decides, whichever way the device is held.
        [true, 390, 844, 'phone'], [true, 844, 390, 'phone'], [true, 740, 360, 'phone'], [true, 360, 740, 'phone'],
        [true, 639, 1000, 'phone'], [true, 1000, 639, 'phone'], [true, 639, 639, 'phone'],
        [true, 640, 640, 'tablet'], [true, 640, 1000, 'tablet'], [true, 1000, 640, 'tablet'],
        [true, 768, 1024, 'tablet'], [true, 1024, 768, 'tablet'], [true, 1366, 1024, 'tablet'], [true, 1440, 900, 'tablet'],
    ] as const)('coarse=%s %sx%s -> %s', (coarse, width, height, layout) => {
        expect(detectEditorMode(coarse, { width, height })).toEqual({ layout, input: coarse ? 'touch' : 'mouse' });
    });

    it('never gives a touch device the desktop layout', () => {
        for (const width of [320, 639, 640, 1023, 1024, 1440, 2560]) {
            for (const height of [320, 639, 640, 1024, 1600]) {
                expect(detectEditorMode(true, { width, height }).layout).not.toBe('desktop');
            }
        }
    });
});

describe('useEditorFormFactor', () => {
    it('is desktop when matchMedia is unavailable', () => {
        const { result } = renderHook(() => useEditorFormFactor());
        expect(result.current).toEqual({ layout: 'desktop', input: 'mouse' });
    });

    it('keeps the phone layout when a phone rotates to landscape and back', () => {
        const media = installMatchMedia({ coarse: true, width: 390, height: 844 });
        const { result } = renderHook(() => useEditorFormFactor());
        expect(result.current.layout).toBe('phone');
        act(() => media.set({ width: 844, height: 390 }));
        expect(result.current.layout).toBe('phone');
        act(() => media.set({ width: 390, height: 844 }));
        expect(result.current.layout).toBe('phone');
    });

    it('keeps the tablet layout when a tablet rotates, and follows a resize across the phone bound', () => {
        const media = installMatchMedia({ coarse: true, width: 768, height: 1024 });
        const { result } = renderHook(() => useEditorFormFactor());
        expect(result.current.layout).toBe('tablet');
        act(() => media.set({ width: 1024, height: 768 }));
        expect(result.current.layout).toBe('tablet');
        // A split-screen tablet window narrower than 640px is a phone, and widens back to a tablet.
        act(() => media.set({ width: 600, height: 768 }));
        expect(result.current.layout).toBe('phone');
        act(() => media.set({ width: 1024, height: 768 }));
        expect(result.current.layout).toBe('tablet');
    });

    it('follows a mouse window across the width breakpoints, ignoring its height', () => {
        const media = installMatchMedia({ coarse: false, width: 1200, height: 800 });
        const { result } = renderHook(() => useEditorFormFactor());
        expect(result.current).toEqual({ layout: 'desktop', input: 'mouse' });
        act(() => media.set({ width: 900 }));
        expect(result.current).toEqual({ layout: 'tablet', input: 'mouse' });
        act(() => media.set({ width: 600 }));
        expect(result.current).toEqual({ layout: 'phone', input: 'mouse' });
        act(() => media.set({ width: 1200, height: 400 }));
        expect(result.current).toEqual({ layout: 'desktop', input: 'mouse' });
    });

    it('keeps the same object when a query change leaves the mode as it was', () => {
        const media = installMatchMedia({ coarse: false, width: 1200, height: 800 });
        const { result } = renderHook(() => useEditorFormFactor());
        const first = result.current;
        act(() => media.set({ height: 500 }));
        expect(result.current).toBe(first);
    });

    // Ruling R40: the layout must not swap under a user who is typing. A soft keyboard that
    // resizes the viewport flips the (max-height) term on a tablet; the change waits for focus
    // to leave editable elements and the queries are read afresh then.
    describe('while the user is typing (R40)', () => {
        const field = <T extends HTMLElement>(tag: string) => {
            const element = document.createElement(tag) as T;
            document.body.appendChild(element);
            return element;
        };
        beforeEach(() => { vi.useFakeTimers(); });
        afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });
        const settle = () => act(() => { vi.advanceTimersByTime(KEYBOARD_SETTLE_MS); });

        it('holds a height-only change while an input has focus, and applies it once the input blurs', () => {
            const media = installMatchMedia({ coarse: true, width: 1280, height: 800 });
            const input = field<HTMLInputElement>('input');
            const { result } = renderHook(() => useEditorFormFactor());
            expect(result.current.layout).toBe('tablet');
            act(() => input.focus());
            act(() => media.set({ height: 500 })); // the keyboard opened
            expect(result.current.layout).toBe('tablet');
            act(() => input.blur());
            expect(result.current.layout).toBe('tablet'); // the keyboard may still be closing
            settle();
            expect(result.current.layout).toBe('phone');
            expect(document.documentElement.hasAttribute('data-form-factor')).toBe(false); // the hook alone sets nothing
        });

        it('keeps holding while focus moves between fields, textarea, select and contenteditable included', () => {
            const media = installMatchMedia({ coarse: true, width: 1280, height: 800 });
            const input = field<HTMLInputElement>('input');
            const textarea = field<HTMLTextAreaElement>('textarea');
            const select = field<HTMLSelectElement>('select');
            const editable = field<HTMLDivElement>('div');
            editable.setAttribute('contenteditable', 'true');
            editable.tabIndex = 0;
            const { result } = renderHook(() => useEditorFormFactor());
            act(() => input.focus());
            act(() => media.set({ height: 500 }));
            for (const next of [textarea, select, editable]) {
                act(() => next.focus());
                expect(result.current.layout, next.tagName).toBe('tablet');
            }
            const button = field<HTMLButtonElement>('button');
            act(() => button.focus()); // leaving the fields for a control applies the change
            settle();
            expect(result.current.layout).toBe('phone');
        });

        it('reads the queries afresh when focus leaves: a keyboard closed again by then changes nothing', () => {
            const media = installMatchMedia({ coarse: true, width: 1280, height: 800 });
            const input = field<HTMLInputElement>('input');
            const { result } = renderHook(() => useEditorFormFactor());
            act(() => input.focus());
            act(() => media.set({ height: 500 }));
            act(() => media.set({ height: 800 })); // the keyboard closed before the field blurred
            expect(result.current.layout).toBe('tablet');
            act(() => input.blur());
            settle();
            expect(result.current.layout).toBe('tablet');
        });

        it('waits for the keyboard to finish closing after a blur instead of flipping twice', () => {
            const media = installMatchMedia({ coarse: true, width: 1280, height: 800 });
            const input = field<HTMLInputElement>('input');
            const seen: string[] = [];
            const { result } = renderHook(() => { const value = useEditorFormFactor().layout; seen.push(value); return value; });
            act(() => input.focus());
            act(() => media.set({ height: 500 })); // keyboard open: held
            act(() => input.blur()); // focusout fires before the keyboard has gone
            act(() => { vi.advanceTimersByTime(KEYBOARD_SETTLE_MS / 2); });
            act(() => media.set({ height: 800 })); // the viewport is restored
            settle();
            expect(result.current).toBe('tablet');
            expect(seen).not.toContain('phone');
        });

        it('re-holds when focus lands in another field before the settle delay ends', () => {
            const media = installMatchMedia({ coarse: true, width: 1280, height: 800 });
            const input = field<HTMLInputElement>('input');
            const other = field<HTMLInputElement>('input');
            const button = field<HTMLButtonElement>('button');
            const { result } = renderHook(() => useEditorFormFactor());
            act(() => input.focus());
            act(() => media.set({ height: 500 }));
            act(() => button.focus());
            act(() => other.focus());
            settle();
            expect(result.current.layout).toBe('tablet'); // still typing
            act(() => other.blur());
            settle();
            expect(result.current.layout).toBe('phone');
        });

        it('does not hold for inputs nobody types into', () => {
            const media = installMatchMedia({ coarse: true, width: 1280, height: 800 });
            const checkbox = field<HTMLInputElement>('input');
            checkbox.type = 'checkbox';
            const { result } = renderHook(() => useEditorFormFactor());
            act(() => checkbox.focus());
            act(() => media.set({ height: 500 }));
            expect(result.current.layout).toBe('phone');
        });

        it('does not hold a change that arrives while a non-editable element has focus, and drops its listener on unmount', () => {
            const media = installMatchMedia({ coarse: true, width: 1280, height: 800 });
            const button = field<HTMLButtonElement>('button');
            const input = field<HTMLInputElement>('input');
            const { result, unmount } = renderHook(() => useEditorFormFactor());
            act(() => button.focus());
            act(() => media.set({ height: 500 }));
            expect(result.current.layout).toBe('phone');
            act(() => input.focus());
            act(() => media.set({ height: 800 }));
            expect(result.current.layout).toBe('phone'); // held
            const removed = vi.spyOn(document, 'removeEventListener');
            unmount();
            expect(removed.mock.calls.some(([type]) => type === 'focusout')).toBe(true);
            removed.mockRestore();
        });

        it('applies a mouse window resize at once, even while an input has focus', () => {
            const media = installMatchMedia({ coarse: false, width: 1280, height: 800 });
            const input = field<HTMLInputElement>('input');
            const { result } = renderHook(() => useEditorFormFactor());
            act(() => input.focus());
            act(() => media.set({ width: 900 }));
            expect(result.current).toEqual({ layout: 'tablet', input: 'mouse' });
            act(() => media.set({ width: 1280 }));
            expect(result.current).toEqual({ layout: 'desktop', input: 'mouse' });
        });

        it('applies a pointer change at once, even while an input has focus', () => {
            const media = installMatchMedia({ coarse: true, width: 1280, height: 800 });
            const input = field<HTMLInputElement>('input');
            const { result } = renderHook(() => useEditorFormFactor());
            act(() => input.focus());
            act(() => media.set({ coarse: false }));
            expect(result.current).toEqual({ layout: 'desktop', input: 'mouse' });
        });
    });
});

describe('FormFactorProvider', () => {
    const Probe = () => <span>{`${useFormFactor()}/${useInputMode()}`}</span>;

    it('defaults to desktop and mouse without a provider', () => {
        const { container } = render(<Probe />);
        expect(container.textContent).toBe('desktop/mouse');
    });

    it('sets the layout attribute for narrow layouts and removes it on unmount', () => {
        const { rerender, unmount } = render(<FormFactorProvider value="phone"><Probe /></FormFactorProvider>);
        expect(document.documentElement.getAttribute('data-form-factor')).toBe('phone');
        rerender(<FormFactorProvider value="desktop"><Probe /></FormFactorProvider>);
        expect(document.documentElement.hasAttribute('data-form-factor')).toBe(false);
        rerender(<FormFactorProvider value="tablet"><Probe /></FormFactorProvider>);
        expect(document.documentElement.getAttribute('data-form-factor')).toBe('tablet');
        unmount();
        expect(document.documentElement.hasAttribute('data-form-factor')).toBe(false);
    });

    it('treats a narrow layout without an input as touch, and desktop as mouse', () => {
        const { container, rerender } = render(<FormFactorProvider value="tablet"><Probe /></FormFactorProvider>);
        expect(container.textContent).toBe('tablet/touch');
        expect(document.documentElement.getAttribute('data-input')).toBe('touch');
        rerender(<FormFactorProvider value="desktop"><Probe /></FormFactorProvider>);
        expect(container.textContent).toBe('desktop/mouse');
        expect(document.documentElement.hasAttribute('data-input')).toBe(false);
    });

    it('marks a narrow mouse window with the layout only', () => {
        const { container, unmount } = render(<FormFactorProvider value="tablet" input="mouse"><Probe /></FormFactorProvider>);
        expect(container.textContent).toBe('tablet/mouse');
        expect(document.documentElement.getAttribute('data-form-factor')).toBe('tablet');
        expect(document.documentElement.hasAttribute('data-input')).toBe(false);
        unmount();
        expect(document.documentElement.hasAttribute('data-form-factor')).toBe(false);
    });

    it('removes data-input on unmount', () => {
        const { unmount } = render(<FormFactorProvider value="phone" input="touch"><Probe /></FormFactorProvider>);
        expect(document.documentElement.getAttribute('data-input')).toBe('touch');
        unmount();
        expect(document.documentElement.hasAttribute('data-input')).toBe(false);
    });
});
