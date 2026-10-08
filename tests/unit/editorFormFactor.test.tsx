import React from 'react';
import { act, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { detectFormFactor, useEditorFormFactor } from '../../hooks/useEditorFormFactor';
import { FormFactorProvider, useFormFactor } from '../../components/editor-layout/FormFactorContext';

type Listener = () => void;
const installMatchMedia = (initial: { coarse: boolean; width: number }) => {
    const env = { ...initial };
    const listeners = new Set<Listener>();
    (window as any).matchMedia = (query: string) => ({
        get matches() {
            if (query === '(pointer: coarse)') return env.coarse;
            if (query === '(max-width: 639px)') return env.width < 640;
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
    it.each([
        [false, 390, 'desktop'], [false, 1440, 'desktop'], [false, 500, 'desktop'],
        [true, 390, 'phone'], [true, 639, 'phone'], [true, 640, 'tablet'], [true, 1366, 'tablet'],
    ] as const)('coarse=%s width=%s -> %s', (coarse, width, expected) => {
        expect(detectFormFactor(coarse, width)).toBe(expected);
    });
});

describe('useEditorFormFactor', () => {
    it('is desktop when matchMedia is unavailable', () => {
        const { result } = renderHook(() => useEditorFormFactor());
        expect(result.current).toBe('desktop');
    });

    it('follows rotation between phone and tablet', () => {
        const media = installMatchMedia({ coarse: true, width: 390 });
        const { result } = renderHook(() => useEditorFormFactor());
        expect(result.current).toBe('phone');
        act(() => media.set({ width: 844 }));
        expect(result.current).toBe('tablet');
    });

    it('never leaves desktop for a fine pointer at narrow widths', () => {
        const media = installMatchMedia({ coarse: false, width: 1200 });
        const { result } = renderHook(() => useEditorFormFactor());
        act(() => media.set({ width: 400 }));
        expect(result.current).toBe('desktop');
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
