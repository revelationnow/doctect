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
});
