import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PropertiesDock, PROPERTIES_COLLAPSED_KEY } from '../../components/editor-layout/PropertiesDock';
import { panelWidthAt, usePanelResize, MIN_CANVAS_WIDTH } from '../../components/editor-layout/usePanelResize';
import { EditorLayout } from '../../components/editor-layout/EditorLayout';
import { FormFactorProvider } from '../../components/editor-layout/FormFactorContext';
import { makeActions } from '../helpers/touchActions';

afterEach(() => {
    localStorage.clear();
    document.body.style.cursor = '';
});

const dock = (props: Partial<React.ComponentProps<typeof PropertiesDock>> = {}) => (
    <PropertiesDock width={340} onStartResize={vi.fn()} {...props}>
        <div data-testid="properties" />
    </PropertiesDock>
);

describe('PropertiesDock', () => {
    it('shows the panel at the given width with a hide button', () => {
        const { container } = render(dock());
        expect(screen.getByTestId('properties')).toBeTruthy();
        const root = container.querySelector('[data-properties-dock="open"]') as HTMLElement;
        expect(root.style.width).toBe('340px');
        expect(root.style.maxWidth).toBe('');
        expect(screen.getByRole('button', { name: 'Hide properties panel' }).getAttribute('title')).toBe('Hide properties panel');
    });

    it('caps the width so the canvas keeps its minimum when asked', () => {
        const { container } = render(dock({ capToCanvas: true }));
        const root = container.querySelector('[data-properties-dock="open"]') as HTMLElement;
        expect(root.style.maxWidth).toBe(`calc(100% - ${MIN_CANVAS_WIDTH}px)`);
    });

    it('collapses to a rail and expands again, remembering the choice in this browser', () => {
        const { container, unmount } = render(dock());
        fireEvent.click(screen.getByRole('button', { name: 'Hide properties panel' }));
        expect(screen.queryByTestId('properties')).toBeNull();
        expect(container.querySelector('[data-properties-dock="collapsed"]')).toBeTruthy();
        expect(localStorage.getItem(PROPERTIES_COLLAPSED_KEY)).toBe('1');
        unmount();

        render(dock());
        expect(screen.queryByTestId('properties')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Show properties panel' }));
        expect(screen.getByTestId('properties')).toBeTruthy();
        expect(localStorage.getItem(PROPERTIES_COLLAPSED_KEY)).toBe('0');
    });

    it('still works when storage throws', () => {
        const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
        const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
        try {
            render(dock());
            fireEvent.click(screen.getByRole('button', { name: 'Hide properties panel' }));
            expect(screen.queryByTestId('properties')).toBeNull();
        } finally {
            spy.mockRestore();
            setSpy.mockRestore();
        }
    });

    it('starts a resize from a pointer press on the edge handle', () => {
        const onStartResize = vi.fn();
        const { container } = render(dock({ onStartResize }));
        const handle = container.querySelector('[data-properties-resize-handle]') as HTMLElement;
        fireEvent.pointerDown(handle, { pointerType: 'touch' });
        expect(onStartResize).toHaveBeenCalledTimes(1);
        expect(handle.style.touchAction).toBe('none');
    });

    it('widens the grab area for touch input only', () => {
        const { container, unmount } = render(<FormFactorProvider value="tablet" input="touch">{dock()}</FormFactorProvider>);
        expect((container.querySelector('[data-properties-resize-handle]') as HTMLElement).className).toContain('w-11');
        unmount();
        const mouse = render(<FormFactorProvider value="tablet" input="mouse">{dock()}</FormFactorProvider>);
        expect((mouse.container.querySelector('[data-properties-resize-handle]') as HTMLElement).className).not.toContain('w-11');
    });
});

describe('panelWidthAt', () => {
    it('keeps the sidebar between 200 and 600', () => {
        expect(panelWidthAt('sidebar', 100, 1440)).toBe(200);
        expect(panelWidthAt('sidebar', 400, 1440)).toBe(400);
        expect(panelWidthAt('sidebar', 900, 1440)).toBe(600);
    });

    it('keeps the properties panel between 250 and 600, leaving the canvas its minimum', () => {
        expect(panelWidthAt('properties', 1400, 1440)).toBe(250);
        expect(panelWidthAt('properties', 1040, 1440)).toBe(400);
        expect(panelWidthAt('properties', 100, 1440)).toBe(600);
        expect(panelWidthAt('properties', 100, 800)).toBe(800 - MIN_CANVAS_WIDTH);
        expect(panelWidthAt('properties', 0, 500)).toBe(250);
    });
});

function ResizeHarness({ panel, onStop, onResize }: { panel: 'sidebar' | 'properties' | null; onStop: () => void; onResize: (patch: object) => void }) {
    usePanelResize(panel, onStop, onResize);
    return null;
}

describe('usePanelResize', () => {
    it('follows pointer moves until the pointer is released', () => {
        const onStop = vi.fn();
        const onResize = vi.fn();
        render(<ResizeHarness panel="properties" onStop={onStop} onResize={onResize} />);
        expect(document.body.style.cursor).toBe('col-resize');
        act(() => { document.dispatchEvent(new MouseEvent('pointermove', { clientX: window.innerWidth - 420 })); });
        expect(onResize).toHaveBeenLastCalledWith({ propertiesPanelWidth: 420 });
        act(() => { document.dispatchEvent(new MouseEvent('pointerup')); });
        expect(onStop).toHaveBeenCalledTimes(1);
    });

    it('stops on pointer cancel and restores the cursor when it ends', () => {
        const onStop = vi.fn();
        const { rerender } = render(<ResizeHarness panel="sidebar" onStop={onStop} onResize={vi.fn()} />);
        act(() => { document.dispatchEvent(new MouseEvent('pointercancel')); });
        expect(onStop).toHaveBeenCalledTimes(1);
        rerender(<ResizeHarness panel={null} onStop={onStop} onResize={vi.fn()} />);
        expect(document.body.style.cursor).toBe('');
    });
});

const slots = {
    editorBar: <div data-testid="desktop-editor-bar" />,
    toolbar: <div data-testid="desktop-toolbar" />,
    sidebar: <div data-testid="sidebar" />,
    canvas: <div data-testid="canvas" />,
    properties: <div data-testid="properties" />,
    sidebarWidth: 288, propertiesPanelWidth: 380,
};

describe('EditorLayout properties dock', () => {
    it('desktop docks properties at the saved width, resizable and collapsible', () => {
        const onStartResize = vi.fn();
        const { container } = render(<EditorLayout formFactor="desktop" {...slots} onStartResize={onStartResize} />);
        const root = container.querySelector('[data-properties-dock="open"]') as HTMLElement;
        expect(root.style.width).toBe('380px');
        expect(root.style.maxWidth).toBe('');
        fireEvent.pointerDown(container.querySelector('[data-properties-resize-handle]')!);
        expect(onStartResize).toHaveBeenCalledWith('properties');
        expect(screen.getByRole('button', { name: 'Hide properties panel' })).toBeTruthy();
    });

    it('tablet uses the saved width (capped for the canvas) instead of a fixed 320px', () => {
        const onStartResize = vi.fn();
        const { container } = render(
            <FormFactorProvider value="tablet" input="mouse">
                <EditorLayout formFactor="tablet" {...slots} onStartResize={onStartResize} touchActions={makeActions()} navigationKey="n1" />
            </FormFactorProvider>,
        );
        const root = container.querySelector('[data-properties-dock="open"]') as HTMLElement;
        expect(root.style.width).toBe('380px');
        expect(root.style.maxWidth).toBe(`calc(100% - ${MIN_CANVAS_WIDTH}px)`);
        fireEvent.pointerDown(container.querySelector('[data-properties-resize-handle]')!);
        expect(onStartResize).toHaveBeenCalledWith('properties');
        fireEvent.click(screen.getByRole('button', { name: 'Hide properties panel' }));
        expect(screen.queryByTestId('properties')).toBeNull();
    });

    it('phone keeps the bottom sheet with no dock', () => {
        const { container } = render(<EditorLayout formFactor="phone" {...slots} onStartResize={vi.fn()} touchActions={makeActions()} navigationKey="n1" selectionLabel="Page" />);
        expect(container.querySelector('[data-properties-dock]')).toBeNull();
    });

    it('desktop sidebar handle starts a sidebar resize from a pointer press', () => {
        const onStartResize = vi.fn();
        const { container } = render(<EditorLayout formFactor="desktop" {...slots} onStartResize={onStartResize} />);
        fireEvent.pointerDown(container.querySelector('[data-sidebar-resize-handle]')!);
        expect(onStartResize).toHaveBeenCalledWith('sidebar');
    });
});
