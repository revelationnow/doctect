import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorLayout, PILL_INSET_VAR } from '../../components/editor-layout/EditorLayout';
import { TOUCH_OVERLAY_HOST_ATTR, useTouchOverlayHost } from '../../components/editor-layout/TouchOverlayHost';
import { makeActions } from '../helpers/touchActions';

const slots = {
    editorBar: <div data-testid="desktop-editor-bar" />,
    toolbar: <div data-testid="desktop-toolbar" />,
    sidebar: <div data-testid="sidebar" />,
    canvas: <div data-testid="canvas" />,
    properties: <div data-testid="properties" />,
    sidebarWidth: 288, propertiesPanelWidth: 320, onStartResize: vi.fn(),
};

// jsdom has no matchMedia; rotation tests install a stub that records listeners and remove it after.
afterEach(() => {
    delete (window as any).matchMedia;
});

describe('EditorLayout touch branches', () => {
    it('tablet docks properties, hides desktop chrome and drawers the sidebar', () => {
        render(<EditorLayout formFactor="tablet" {...slots} touchActions={makeActions()} navigationKey="n1" />);
        expect(screen.queryByTestId('desktop-editor-bar')).toBeNull();
        expect(screen.queryByTestId('desktop-toolbar')).toBeNull();
        expect(screen.getByTestId('properties')).toBeTruthy();
        expect(screen.queryByTestId('sidebar')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Open pages and templates' }));
        expect(screen.getByTestId('sidebar')).toBeTruthy();
    });

    it('phone closes the drawer when navigation changes', () => {
        const { rerender } = render(<EditorLayout formFactor="phone" {...slots} touchActions={makeActions()} navigationKey="n1" selectionLabel="Page · Root" />);
        fireEvent.click(screen.getByRole('button', { name: 'Open pages and templates' }));
        expect(screen.getByTestId('sidebar')).toBeTruthy();
        rerender(<EditorLayout formFactor="phone" {...slots} touchActions={makeActions()} navigationKey="n2" selectionLabel="Page · Root" />);
        expect(screen.queryByTestId('sidebar')).toBeNull();
    });

    it('phone sheet peeks on selection, hides the tool pill at half, and drops to peek while editing text', () => {
        const { rerender } = render(<EditorLayout formFactor="phone" {...slots} touchActions={makeActions()} navigationKey="n1" selectionLabel="Page · Root" />);
        expect(screen.getByTestId('properties-sheet').style.height).toBe('72px');
        expect(screen.getByTestId('touch-tool-pill')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Resize properties sheet' }));
        expect(screen.getByTestId('properties-sheet').style.height).toBe('50dvh');
        expect(screen.queryByTestId('touch-tool-pill')).toBeNull();

        const editable = document.createElement('div');
        editable.contentEditable = 'true';
        screen.getByTestId('canvas').appendChild(editable);
        act(() => { editable.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); });
        expect(screen.getByTestId('properties-sheet').style.height).toBe('72px');

        rerender(<EditorLayout formFactor="phone" {...slots} touchActions={makeActions({ hasSelection: true })} navigationKey="n1" selectionLabel="Rectangle" />);
        expect(screen.getByText('Rectangle')).toBeTruthy();
    });

    it('desktop still renders the desktop markup', () => {
        render(<EditorLayout formFactor="desktop" {...slots} />);
        expect(screen.getByTestId('desktop-editor-bar')).toBeTruthy();
        expect(screen.getByTestId('sidebar')).toBeTruthy();
    });

    it('falls back to the desktop markup on touch form factors without actions', () => {
        // Defensive: the view always supplies actions on touch; without them there is no touch chrome to render.
        render(<EditorLayout formFactor="phone" {...slots} />);
        expect(screen.getByTestId('desktop-editor-bar')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Open pages and templates' })).toBeNull();
    });

    it.each(['tablet', 'phone'] as const)('%s rotation closes the drawer, keeps the sheet detent and refits the canvas', (formFactor) => {
        const listeners = new Set<() => void>();
        (window as any).matchMedia = (query: string) => ({
            matches: false, media: query, onchange: null,
            addEventListener: (_: string, listener: () => void) => { listeners.add(listener); },
            removeEventListener: (_: string, listener: () => void) => { listeners.delete(listener); },
            addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
        });
        const actions = makeActions();
        const { unmount } = render(<EditorLayout formFactor={formFactor} {...slots} touchActions={actions} navigationKey="n1" selectionLabel="Page · Root" />);
        fireEvent.click(screen.getByRole('button', { name: 'Open pages and templates' }));
        expect(screen.getByTestId('sidebar')).toBeTruthy();
        if (formFactor === 'phone') {
            fireEvent.click(screen.getByRole('button', { name: 'Resize properties sheet' }));
            expect(screen.getByTestId('properties-sheet').style.height).toBe('50dvh');
        }
        expect(listeners.size).toBeGreaterThan(0);
        act(() => { listeners.forEach(listener => listener()); });
        expect(screen.queryByTestId('sidebar')).toBeNull();
        expect(actions.fitToWidth).toHaveBeenCalledTimes(1);
        if (formFactor === 'phone') expect(screen.getByTestId('properties-sheet').style.height).toBe('50dvh');
        unmount();
        expect(listeners.size).toBe(0);
    });

    it('phone pill offers all ten controls (tools, Select multiple, Fit) by wrapping, never by horizontal scrolling', () => {
        render(<EditorLayout formFactor="phone" {...slots} touchActions={makeActions()} navigationKey="n1" selectionLabel="Page · Root" />);
        const pill = screen.getByTestId('touch-tool-pill');
        expect(pill.className).not.toMatch(/overflow-x/);
        expect(pill.firstElementChild!.className).toMatch(/\bflex-wrap\b/);
        expect(within(pill).getAllByRole('button')).toHaveLength(10);
        expect(within(pill).getByRole('button', { name: 'Select multiple' })).toBeTruthy();
        expect(within(pill).getByRole('button', { name: 'Fit page to width' })).toBeTruthy();
        // R33: the quick format bar reads the pill as bottom chrome through this tag.
        expect(pill.getAttribute('data-touch-chrome')).toBe('tool-pill');
    });

    it('phone publishes the pill height plus gap as scroll room for the canvas, 0 once the pill unmounts', () => {
        const observed: Array<{ target: Element; callback: () => void }> = [];
        class FakeResizeObserver {
            constructor(private readonly callback: () => void) {}
            observe(target: Element) { observed.push({ target, callback: this.callback }); }
            disconnect() {}
        }
        (globalThis as any).ResizeObserver = FakeResizeObserver;
        try {
            render(<EditorLayout formFactor="phone" {...slots} touchActions={makeActions()} navigationKey="n1" selectionLabel="Page · Root" />);
            const wrapper = screen.getByTestId('canvas').parentElement!;
            const pill = screen.getByTestId('touch-tool-pill');
            expect(wrapper.style.getPropertyValue(PILL_INSET_VAR)).toBe('12px'); // jsdom lays out 0px tall
            expect(observed.map(entry => entry.target)).toEqual([pill]);
            Object.defineProperty(pill, 'offsetHeight', { configurable: true, value: 92 }); // two rows at phone width
            act(() => observed[0].callback());
            expect(wrapper.style.getPropertyValue(PILL_INSET_VAR)).toBe('104px');
            fireEvent.click(screen.getByRole('button', { name: 'Resize properties sheet' })); // half: pill unmounts
            expect(screen.queryByTestId('touch-tool-pill')).toBeNull();
            expect(wrapper.style.getPropertyValue(PILL_INSET_VAR)).toBe('0px');
        } finally {
            delete (globalThis as any).ResizeObserver;
        }
    });

    it('phone keeps the sheet at the user detent when a non-editable canvas child takes focus', () => {
        render(<EditorLayout formFactor="phone" {...slots} touchActions={makeActions()} navigationKey="n1" selectionLabel="Page · Root" />);
        fireEvent.click(screen.getByRole('button', { name: 'Resize properties sheet' }));
        const button = document.createElement('button');
        screen.getByTestId('canvas').appendChild(button);
        act(() => { button.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); });
        expect(screen.getByTestId('properties-sheet').style.height).toBe('50dvh');
    });

    it('touch layout roots are positioned so the absolute drawer and sheet stay inside the editor', () => {
        const { container, rerender } = render(<EditorLayout formFactor="phone" {...slots} touchActions={makeActions()} navigationKey="n1" />);
        expect(container.firstElementChild!.className).toMatch(/\brelative\b/);
        rerender(<EditorLayout formFactor="tablet" {...slots} touchActions={makeActions()} navigationKey="n1" />);
        expect(container.firstElementChild!.className).toMatch(/\brelative\b/);
    });

    // I1: the canvas slot can portal floating touch UI (the quick format bar) into a host inside
    // the layout root, so it stacks with the pill, sheet and drawer rather than over everything.
    it('touch layouts host canvas overlays inside their root; desktop provides no host', () => {
        let seen: HTMLElement | null | undefined;
        const Probe = () => { seen = useTouchOverlayHost(); return <div data-testid="canvas" />; };
        const probeSlots = { ...slots, canvas: <Probe /> };
        const { container, rerender } = render(<EditorLayout formFactor="phone" {...probeSlots} touchActions={makeActions()} navigationKey="n1" />);
        const root = container.firstElementChild!;
        expect(seen).toBeInstanceOf(HTMLElement);
        expect(root.contains(seen!)).toBe(true);
        expect(seen!.getAttribute(TOUCH_OVERLAY_HOST_ATTR)).toBe('');
        expect(seen!.className).toMatch(/\bcontents\b/); // takes no room in the flex column
        rerender(<EditorLayout formFactor="tablet" {...probeSlots} touchActions={makeActions()} navigationKey="n1" />);
        expect(seen).toBeInstanceOf(HTMLElement);
        expect(container.firstElementChild!.contains(seen!)).toBe(true);
        rerender(<EditorLayout formFactor="desktop" {...probeSlots} navigationKey="n1" />);
        expect(seen).toBeNull();
        expect(container.querySelector(`[${TOUCH_OVERLAY_HOST_ATTR}]`)).toBeNull();
    });
});
