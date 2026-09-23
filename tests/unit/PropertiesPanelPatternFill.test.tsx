import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PropertiesPanel } from '../../components/PropertiesPanel';
import type { AppState, TemplateElement } from '../../types';

const patterned: TemplateElement = {
    id: 'fill', type: 'rect', x: 10, y: 10, w: 200, h: 120, rotation: 0,
    fill: '#334155', fillType: 'pattern', patternType: 'lines-h',
    patternSpacing: 12, patternWeight: 1, stroke: '', strokeWidth: 0, opacity: 1,
};

const stateFor = (element: TemplateElement): AppState => ({
    nodes: { root: { id: 'root', parentId: null, type: 'page', title: 'Root', data: {}, children: [] } },
    rootId: 'root', variants: {
        default: { id: 'default', name: 'Default', templates: {
            page: { id: 'page', name: 'Page', width: 500, height: 700, elements: [element] },
        } },
    },
    activeVariantId: 'default', viewMode: 'hierarchy', selectedNodeId: 'root',
    selectedNodeIds: ['root'], selectedTemplateId: '', selectedTemplateIds: [],
    selectedElementIds: [element.id], scale: 1, tool: 'select', showJsonModal: false,
    sidebarWidth: 240, propertiesPanelWidth: 300, snapToGrid: false, showGrid: false,
    showNodeSelector: false, nodeSelectorMode: 'grid_source', editingElementId: null,
    clipboard: [], schemaVersion: 12,
});

const callbacks = () => ({
    onUpdateElements: vi.fn(), onUpdateNode: vi.fn(), onDeleteElements: vi.fn(),
    onOpenNodeSelector: vi.fn(), onUpdateTemplate: vi.fn(),
});

const patternSelect = () => screen.getByDisplayValue('Horizontal Lines') as HTMLSelectElement;

afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
});

describe('PropertiesPanel pattern fill', () => {
    it('offers Grid alongside the line and dot patterns', () => {
        render(<PropertiesPanel state={stateFor(patterned)} {...callbacks()} />);

        expect([...patternSelect().options].map(option => [option.value, option.text])).toEqual([
            ['lines-h', 'Horizontal Lines'],
            ['lines-v', 'Vertical Lines'],
            ['grid', 'Grid'],
            ['dots', 'Dots'],
        ]);
    });

    it('saves grid as the pattern type and keeps gap and weight', () => {
        const props = callbacks();
        render(<PropertiesPanel state={stateFor(patterned)} {...props} />);

        fireEvent.change(patternSelect(), { target: { value: 'grid' } });

        expect(props.onUpdateElements).toHaveBeenCalledOnce();
        expect(props.onUpdateElements).toHaveBeenCalledWith([{ ...patterned, patternType: 'grid' }], true);
    });
});
