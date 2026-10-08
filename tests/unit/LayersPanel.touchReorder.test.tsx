import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LayersPanel, type LayerPanelActions } from '../../components/LayersPanel';
import { FormFactorProvider } from '../../components/editor-layout/FormFactorContext';
import type { Layer, PageTemplate } from '../../types';

const template: PageTemplate = {
    id: 'p', name: 'P', width: 100, height: 100, elements: [],
    layers: [
        { id: 'back', name: 'Back', order: 0, visible: true, locked: false },
        { id: 'front', name: 'Front', order: 1, visible: true, locked: false },
    ],
};
const props = (t: PageTemplate = template) => ({
    template: t, selectedElementIds: [], activeLayerId: 'back', onUpdateTemplate: vi.fn(),
    onUpdateElements: vi.fn(), onSelectElements: vi.fn(), onSetActiveLayer: vi.fn(),
});
const orders = (layers: Layer[]) => Object.fromEntries(layers.map(l => [l.id, l.order]));

describe('LayersPanel touch reorder', () => {
    it('moves a layer forward with the up button on touch', () => {
        const p = props();
        render(<FormFactorProvider value="tablet"><LayersPanel {...p} /></FormFactorProvider>);
        fireEvent.click(screen.getByRole('button', { name: 'Move Back forward' }));
        const order = orders(p.onUpdateTemplate.mock.calls[0][0].layers);
        expect(order.back).toBeGreaterThan(order.front);
    });

    it('moves a layer backward with the down button on touch', () => {
        const p = props();
        render(<FormFactorProvider value="phone"><LayersPanel {...p} /></FormFactorProvider>);
        fireEvent.click(screen.getByRole('button', { name: 'Move Front backward' }));
        const order = orders(p.onUpdateTemplate.mock.calls[0][0].layers);
        expect(order.front).toBeLessThan(order.back);
    });

    it('disables moves past the ends', () => {
        render(<FormFactorProvider value="phone"><LayersPanel {...props()} /></FormFactorProvider>);
        expect(screen.getByRole('button', { name: 'Move Front forward' })).toHaveProperty('disabled', true);
        expect(screen.getByRole('button', { name: 'Move Back backward' })).toHaveProperty('disabled', true);
    });

    it('renders no reorder buttons on desktop', () => {
        render(<LayersPanel {...props()} />);
        expect(screen.queryByRole('button', { name: /Move .* forward/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /Move .* backward/ })).toBeNull();
    });
});

describe('LayersPanel touch reorder with layerActions (incremental editor)', () => {
    // Array occurrence order deliberately differs from `order`, so the assertions prove the
    // intent carries template.layers positions (what layerActions.edit expects), not sorted indices.
    const shuffled: PageTemplate = {
        ...template,
        layers: [
            { id: 'front', name: 'Front', order: 1, visible: true, locked: false },
            { id: 'back', name: 'Back', order: 0, visible: true, locked: false },
        ],
    };
    const actions = (): LayerPanelActions => ({
        sequence: shuffled.layers, moveElements: vi.fn(), setCollapsed: vi.fn(), edit: vi.fn(),
    });

    it('up button issues a move intent from the layer position to the next-frontmost position', () => {
        const p = props(shuffled);
        const layerActions = actions();
        render(<FormFactorProvider value="tablet"><LayersPanel {...p} layerActions={layerActions} /></FormFactorProvider>);
        fireEvent.click(screen.getByRole('button', { name: 'Move Back forward' }));
        expect(layerActions.edit).toHaveBeenCalledTimes(1);
        expect(layerActions.edit).toHaveBeenCalledWith({ type: 'move', position: 1, targetPosition: 0 });
        expect(p.onUpdateTemplate).not.toHaveBeenCalled();
    });

    it('down button issues a move intent to the next-backmost position', () => {
        const p = props(shuffled);
        const layerActions = actions();
        render(<FormFactorProvider value="phone"><LayersPanel {...p} layerActions={layerActions} /></FormFactorProvider>);
        fireEvent.click(screen.getByRole('button', { name: 'Move Front backward' }));
        expect(layerActions.edit).toHaveBeenCalledWith({ type: 'move', position: 0, targetPosition: 1 });
        expect(p.onUpdateTemplate).not.toHaveBeenCalled();
    });

    it('disables the end buttons by order, not by array position', () => {
        render(<FormFactorProvider value="phone"><LayersPanel {...props(shuffled)} layerActions={actions()} /></FormFactorProvider>);
        expect(screen.getByRole('button', { name: 'Move Front forward' })).toHaveProperty('disabled', true);
        expect(screen.getByRole('button', { name: 'Move Back backward' })).toHaveProperty('disabled', true);
        expect(screen.getByRole('button', { name: 'Move Back forward' })).toHaveProperty('disabled', false);
    });

    it('drag-drop between rows issues the same move intent as the buttons (desktop drag path)', () => {
        const p = props(shuffled);
        const layerActions = actions();
        render(<LayersPanel {...p} layerActions={layerActions} />);
        fireEvent.dragStart(screen.getByTestId('layer-row-back'));
        fireEvent.dragOver(screen.getByTestId('layer-row-front'));
        fireEvent.drop(screen.getByTestId('layer-row-front'));
        expect(layerActions.edit).toHaveBeenCalledTimes(1);
        expect(layerActions.edit).toHaveBeenCalledWith({ type: 'move', position: 1, targetPosition: 0 });
        expect(p.onUpdateTemplate).not.toHaveBeenCalled();
    });
});

describe('LayersPanel row layout per form factor', () => {
    const ROW = 'group flex items-center gap-1 px-2 py-1.5 border-b border-slate-50 text-sm';
    const DELETE = 'p-0.5 text-slate-300 hover:text-red-500 disabled:opacity-30 disabled:hover:text-slate-300';
    const parts = (row: HTMLElement) => ({
        grip: row.querySelector('[title="Reorder layer"]')!,
        collapse: row.querySelector('[title="Collapse layer"]')!,
        name: row.querySelector('[data-testid="layer-name"]')!,
        eye: row.querySelector('[title="Toggle visibility"]')!,
        lock: row.querySelector('[title="Toggle lock"]')!,
        color: row.querySelector('[data-color-popover]')!,
        del: row.querySelector('[title="Delete layer"]')!,
    });

    it('desktop rows keep the original single-line markup and class strings', () => {
        render(<LayersPanel {...props()} />);
        expect(screen.getByTestId('layer-row-back').className).toBe(`${ROW} bg-blue-50`);
        const row = screen.getByTestId('layer-row-front');
        expect(row.className).toBe(`${ROW} hover:bg-slate-50`);
        const { eye, lock, color, del } = parts(row);
        expect(eye.className).toBe('text-slate-500');
        expect(lock.className).toBe('text-slate-500');
        expect(color.className).toBe('relative');
        expect(del.className).toBe(DELETE);
        expect(row.querySelector('.basis-full')).toBeNull();
        expect(row.children).toHaveLength(7); // grip, collapse, eye, lock, color, name, delete
    });

    it('touch rows wrap: grip, collapse and name on line 1, the actions on a full-width line 2', () => {
        render(<FormFactorProvider value="phone"><LayersPanel {...props()} /></FormFactorProvider>);
        const row = screen.getByTestId('layer-row-front');
        expect(row.className).toBe(`${ROW} flex-wrap hover:bg-slate-50`);
        const { grip, collapse, name, eye, lock, color, del } = parts(row);
        const up = screen.getByRole('button', { name: 'Move Front forward' });
        const down = screen.getByRole('button', { name: 'Move Front backward' });
        for (const el of [grip, collapse, name]) expect(el.className).not.toMatch(/\border-\d/);
        expect(row.querySelector('.basis-full')!.className).toContain('order-1');
        for (const el of [eye, lock, color, up, down, del]) expect(el.className).toContain('order-2');
        expect(name.className).toContain('flex-1');
        expect(row.children).toHaveLength(10); // 7 desktop parts + break + up + down
    });
});
