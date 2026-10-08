import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorLayout } from '../../components/editor-layout/EditorLayout';
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
});
