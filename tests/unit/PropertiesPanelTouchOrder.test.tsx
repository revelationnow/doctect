import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PropertiesPanel, type IncrementalPropertyActions } from '../../components/PropertiesPanel';
import { FormFactorProvider } from '../../components/editor-layout/FormFactorContext';
import type { FormFactor } from '../../hooks/useEditorFormFactor';
import type { AppState, TemplateElement } from '../../types';

const rect: TemplateElement = {
    id: 'rect', type: 'rect', x: 0, y: 0, w: 100, h: 40, rotation: 0,
    fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1,
};

const stateFor = (selectedElementIds: string[]): AppState => ({
    nodes: { root: { id: 'root', parentId: null, type: 'page', title: 'Root', data: {}, children: [] } },
    rootId: 'root', variants: { default: { id: 'default', name: 'Default', templates: {
        page: { id: 'page', name: 'Page', width: 500, height: 700, elements: [rect] },
    } } },
    activeVariantId: 'default', viewMode: 'hierarchy', selectedNodeId: 'root',
    selectedNodeIds: ['root'], selectedTemplateId: '', selectedTemplateIds: [],
    selectedElementIds, scale: 1, tool: 'select', showJsonModal: false,
    sidebarWidth: 240, propertiesPanelWidth: 300, snapToGrid: false, showGrid: false,
    showNodeSelector: false, nodeSelectorMode: 'grid_source', editingElementId: null,
    clipboard: [], schemaVersion: 10,
});

const callbacks = () => ({
    onUpdateElements: vi.fn(), onUpdateNode: vi.fn(), onDeleteElements: vi.fn(),
    onOpenNodeSelector: vi.fn(), onUpdateTemplate: vi.fn(),
});

const renderAt = (formFactor: FormFactor, selected: string[], extra: { incrementalActions?: IncrementalPropertyActions } = {}) => {
    const props = { ...callbacks(), ...extra };
    const ui = (ids: string[]) => (
        <FormFactorProvider value={formFactor}>
            <PropertiesPanel state={stateFor(ids)} {...props} layersSlot={<div data-testid="layers-slot" />} />
        </FormFactorProvider>
    );
    const view = render(ui(selected));
    return { ...view, props, select: (ids: string[]) => view.rerender(ui(ids)) };
};

const nodeToggle = () => screen.getByRole('button', { name: 'Node Properties' });
const elementHeading = () => screen.getByRole('heading', { name: 'Element Properties' });
const precedes = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

afterEach(() => vi.restoreAllMocks());

describe('PropertiesPanel order on touch (Task 24)', () => {
    it.each(['phone', 'tablet'] as const)('%s with a selection: element settings first, Node Properties below and collapsed', formFactor => {
        renderAt(formFactor, ['rect']);
        expect(precedes(elementHeading(), nodeToggle())).toBe(true);
        expect(precedes(nodeToggle(), screen.getByTestId('layers-slot'))).toBe(true);
        expect(nodeToggle()).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByTestId('template-settings-section-body')).toBeNull();
        // Still expandable, and collapsible again.
        fireEvent.click(nodeToggle());
        expect(nodeToggle()).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByTestId('template-settings-section-body')).toBeVisible();
        fireEvent.click(nodeToggle());
        expect(nodeToggle()).toHaveAttribute('aria-expanded', 'false');
    });

    it('with nothing selected keeps Node Properties first and expanded on touch', () => {
        const { select } = renderAt('phone', []);
        expect(precedes(nodeToggle(), elementHeading())).toBe(true);
        expect(nodeToggle()).toHaveAttribute('aria-expanded', 'true');
        select(['rect']);
        expect(precedes(elementHeading(), nodeToggle())).toBe(true);
        select([]);
        expect(nodeToggle()).toHaveAttribute('aria-expanded', 'true');
    });

    it('desktop keeps the order and expansion with a selection', () => {
        renderAt('desktop', ['rect']);
        expect(precedes(nodeToggle(), screen.getByTestId('layers-slot'))).toBe(true);
        expect(precedes(screen.getByTestId('layers-slot'), elementHeading())).toBe(true);
        expect(nodeToggle()).toHaveAttribute('aria-expanded', 'true');
    });

    it('never writes the touch collapse into the persisted panel state', () => {
        const incrementalActions: IncrementalPropertyActions = {
            contextEpoch: 1, patchElements: vi.fn(), patchNodes: vi.fn(),
            setPanelExpanded: vi.fn(), panelsExpanded: {},
        };
        renderAt('phone', ['rect'], { incrementalActions });
        fireEvent.click(nodeToggle());
        fireEvent.click(nodeToggle());
        expect(incrementalActions.setPanelExpanded).not.toHaveBeenCalled();
    });
});
