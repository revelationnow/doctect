import React from 'react';
import { act, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectFormFactor, PHONE_QUERY, useEditorFormFactor } from '../../hooks/useEditorFormFactor';
import { FormFactorProvider, useFormFactor } from '../../components/editor-layout/FormFactorContext';

type Listener = () => void;
const installMatchMedia = (initial: { coarse: boolean; width: number; height: number }) => {
    const env = { ...initial };
    const listeners = new Set<Listener>();
    (window as any).matchMedia = (query: string) => ({
        get matches() {
            if (query === '(pointer: coarse)') return env.coarse;
            // The hook's phone query is a list: either side under 640px, i.e. the shorter side is.
            if (query === PHONE_QUERY) return env.width < 640 || env.height < 640;
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
});

describe('detectFormFactor', () => {
    it('subscribes to the shorter-side phone query the plan names', () => {
        expect(PHONE_QUERY).toBe('(max-width: 639px), (max-height: 639px)');
    });

    it.each([
        // A fine pointer is desktop at every size, landscape phones included.
        [false, 390, 844, 'desktop'], [false, 844, 390, 'desktop'], [false, 1440, 900, 'desktop'], [false, 500, 500, 'desktop'],
        // Coarse: the shorter side decides, whichever way the device is held.
        [true, 390, 844, 'phone'], [true, 844, 390, 'phone'], [true, 740, 360, 'phone'], [true, 360, 740, 'phone'],
        [true, 639, 1000, 'phone'], [true, 1000, 639, 'phone'], [true, 639, 639, 'phone'],
        [true, 640, 640, 'tablet'], [true, 640, 1000, 'tablet'], [true, 1000, 640, 'tablet'],
        [true, 768, 1024, 'tablet'], [true, 1024, 768, 'tablet'], [true, 1366, 1024, 'tablet'],
    ] as const)('coarse=%s %sx%s -> %s', (coarse, width, height, expected) => {
        expect(detectFormFactor(coarse, { width, height })).toBe(expected);
    });
});

describe('useEditorFormFactor', () => {
    it('is desktop when matchMedia is unavailable', () => {
        const { result } = renderHook(() => useEditorFormFactor());
        expect(result.current).toBe('desktop');
    });

    it('keeps the phone layout when a phone rotates to landscape and back', () => {
        const media = installMatchMedia({ coarse: true, width: 390, height: 844 });
        const { result } = renderHook(() => useEditorFormFactor());
        expect(result.current).toBe('phone');
        act(() => media.set({ width: 844, height: 390 }));
        expect(result.current).toBe('phone');
        act(() => media.set({ width: 390, height: 844 }));
        expect(result.current).toBe('phone');
    });

    it('keeps the tablet layout when a tablet rotates, and follows a resize across the phone bound', () => {
        const media = installMatchMedia({ coarse: true, width: 768, height: 1024 });
        const { result } = renderHook(() => useEditorFormFactor());
        expect(result.current).toBe('tablet');
        act(() => media.set({ width: 1024, height: 768 }));
        expect(result.current).toBe('tablet');
        // A split-screen tablet window narrower than 640px is a phone, and widens back to a tablet.
        act(() => media.set({ width: 600, height: 768 }));
        expect(result.current).toBe('phone');
        act(() => media.set({ width: 1024, height: 768 }));
        expect(result.current).toBe('tablet');
    });

    it('never leaves desktop for a fine pointer at narrow or short sizes', () => {
        const media = installMatchMedia({ coarse: false, width: 1200, height: 800 });
        const { result } = renderHook(() => useEditorFormFactor());
        act(() => media.set({ width: 400 }));
        expect(result.current).toBe('desktop');
        act(() => media.set({ width: 1200, height: 400 }));
        expect(result.current).toBe('desktop');
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
        afterEach(() => { document.body.innerHTML = ''; });

        it('holds a height-only change while an input has focus, and applies it once the input blurs', () => {
            const media = installMatchMedia({ coarse: true, width: 1280, height: 800 });
            const input = field<HTMLInputElement>('input');
            const { result } = renderHook(() => useEditorFormFactor());
            expect(result.current).toBe('tablet');
            act(() => input.focus());
            act(() => media.set({ height: 500 })); // the keyboard opened
            expect(result.current).toBe('tablet');
            act(() => input.blur());
            expect(result.current).toBe('phone');
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
                expect(result.current, next.tagName).toBe('tablet');
            }
            const button = field<HTMLButtonElement>('button');
            act(() => button.focus()); // leaving the fields for a control applies the change
            expect(result.current).toBe('phone');
        });

        it('reads the queries afresh when focus leaves: a keyboard closed again by then changes nothing', () => {
            const media = installMatchMedia({ coarse: true, width: 1280, height: 800 });
            const input = field<HTMLInputElement>('input');
            const { result } = renderHook(() => useEditorFormFactor());
            act(() => input.focus());
            act(() => media.set({ height: 500 }));
            act(() => media.set({ height: 800 })); // the keyboard closed before the field blurred
            expect(result.current).toBe('tablet');
            act(() => input.blur());
            expect(result.current).toBe('tablet');
        });

        it('does not hold a change that arrives while a non-editable element has focus, and drops its listener on unmount', () => {
            const media = installMatchMedia({ coarse: true, width: 1280, height: 800 });
            const button = field<HTMLButtonElement>('button');
            const input = field<HTMLInputElement>('input');
            const { result, unmount } = renderHook(() => useEditorFormFactor());
            act(() => button.focus());
            act(() => media.set({ height: 500 }));
            expect(result.current).toBe('phone');
            act(() => input.focus());
            act(() => media.set({ height: 800 }));
            expect(result.current).toBe('phone'); // held
            const removed = vi.spyOn(document, 'removeEventListener');
            unmount();
            expect(removed.mock.calls.some(([type]) => type === 'focusout')).toBe(true);
            removed.mockRestore();
        });
    });
});

describe('FormFactorProvider', () => {
    const Probe = () => <span>{useFormFactor()}</span>;

    it('defaults to desktop without a provider', () => {
        const { container } = render(<Probe />);
        expect(container.textContent).toBe('desktop');
    });

    it('sets the html attribute for touch form factors and removes it on unmount', () => {
        const { rerender, unmount } = render(<FormFactorProvider value="phone"><Probe /></FormFactorProvider>);
        expect(document.documentElement.getAttribute('data-form-factor')).toBe('phone');
        rerender(<FormFactorProvider value="desktop"><Probe /></FormFactorProvider>);
        expect(document.documentElement.hasAttribute('data-form-factor')).toBe(false);
        rerender(<FormFactorProvider value="tablet"><Probe /></FormFactorProvider>);
        expect(document.documentElement.getAttribute('data-form-factor')).toBe('tablet');
        unmount();
        expect(document.documentElement.hasAttribute('data-form-factor')).toBe(false);
    });
});
