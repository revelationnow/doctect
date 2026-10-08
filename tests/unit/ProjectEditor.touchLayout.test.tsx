import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppState, TemplateElement } from '../../types';

let canvasProps: any = null;
let sidebarProps: any = null;
const modals: Record<string, boolean> = {};
vi.mock('../../components/Canvas', () => ({ Canvas: (props: any) => { canvasProps = props; return <div data-testid="editor-canvas" />; } }));
vi.mock('../../components/Sidebar', () => ({
    Sidebar: (props: any) => {
        sidebarProps = props;
        return <div data-testid="sidebar"><button type="button" onClick={() => props.onSelectNode('n2', false, false)}>Go to n2</button></div>;
    },
}));
vi.mock('../../components/PropertiesPanel', () => ({ PropertiesPanel: () => <div data-testid="properties-panel" /> }));
vi.mock('../../components/LayersPanel', () => ({ LayersPanel: () => <div /> }));
vi.mock('../../components/CollapsibleSection', () => ({ CollapsibleSection: () => <div /> }));
vi.mock('../../components/JsonModal', () => ({ JsonModal: ({ isOpen }: any) => { modals.json = isOpen; return null; } }));
vi.mock('../../components/NodeSelectorModal', () => ({ NodeSelectorModal: () => null }));
vi.mock('../../components/DeleteConfirmModal', () => ({ DeleteConfirmModal: () => null }));
vi.mock('../../components/SavePresetModal', () => ({ SavePresetModal: ({ isOpen }: any) => { modals.preset = isOpen; return null; } }));
vi.mock('../../components/NewVariantModal', () => ({ NewVariantModal: () => null }));
vi.mock('../../components/EditorToolbar', () => ({ EditorToolbar: () => <div data-mock="desktop-toolbar" /> }));
vi.mock('../../components/HierarchyGeneratorModal', () => ({ HierarchyGeneratorModal: ({ isOpen }: any) => { modals.generator = isOpen; return null; } }));
vi.mock('../../services/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('../../services/pdfService', () => ({ generatePDF: vi.fn(async () => {}) }));

import { ProjectEditor } from '../../components/ProjectEditor';
import { FormFactorProvider } from '../../components/editor-layout/FormFactorContext';
import { editorState } from '../helpers/editorFixtures';
import { makeIncrementalProject } from '../helpers/incrementalFixtures';

type FormFactor = 'desktop' | 'tablet' | 'phone';

const rect = (id: string): TemplateElement => ({
    id, type: 'rect', x: 10, y: 10, w: 50, h: 40, rotation: 0, fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1, zIndex: 0, layerId: 'l1',
} as TemplateElement);

const legacyState = (overrides: Partial<AppState> = {}): AppState => {
    const state = editorState();
    state.nodes.n2 = { id: 'n2', parentId: 'root', type: 'page', title: 'Second', data: {}, children: [] };
    state.nodes.root.children = ['n2'];
    state.variants.default.templates.page.elements = [rect('r1')];
    return { ...state, ...overrides };
};

const renderLegacy = (formFactor: FormFactor, overrides: Partial<AppState> = {}) => render(
    <FormFactorProvider value={formFactor}>
        <ProjectEditor projectId="p" projectName="Root" initialState={legacyState(overrides)} isActive
            onNameChange={() => {}} onStateChange={() => {}}
            onCreateGeneratedProject={async () => false} onSaveCustomPreset={async () => false} />
    </FormFactorProvider>,
);

const renderIncremental = (formFactor: FormFactor) => {
    const project = makeIncrementalProject(1);
    const onPreferencesChange = vi.fn();
    const onDocumentEdit = vi.fn();
    render(
        <FormFactorProvider value={formFactor}>
            <ProjectEditor projectId={project.id} projectName={project.name} initialState={project.initialState} isActive
                incremental={{ source: {}, editorGenerationFloor: 10, foldStructureGeneration: 4 }}
                onDocumentEdit={onDocumentEdit} onPreferencesChange={onPreferencesChange}
                onStateChange={() => { throw new Error('Full-state autosave reached the incremental editor.'); }}
                onNameChange={() => {}} onCreateGeneratedProject={async () => true} onSaveCustomPreset={async () => true} />
        </FormFactorProvider>,
    );
    return { project, onPreferencesChange, onDocumentEdit };
};

// The sidebar sits in the closed drawer on touch, so element state is read from the canvas props.
const legacyElements = (): TemplateElement[] => canvasProps.elements;
const openOverflow = () => fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
const sheetTitle = () => screen.getByRole('button', { name: 'Resize properties sheet' }).textContent;

beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        font: '12px sans-serif', measureText: (text: string) => ({ width: text.length * 6 }),
    } as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    document.documentElement.removeAttribute('data-form-factor');
    canvasProps = null;
    sidebarProps = null;
    for (const key of Object.keys(modals)) delete modals[key];
});

describe('phone layout wired through the legacy editor', () => {
    it('replaces the desktop chrome with the top bar, tool pill and properties sheet', () => {
        const { container } = renderLegacy('phone');
        expect(container.querySelector('[data-mock="desktop-toolbar"]')).toBeNull();
        expect(screen.queryByRole('button', { name: /Export PDF/ })).toBeNull();
        expect(screen.queryByTestId('sidebar')).toBeNull();
        expect(screen.getByRole('button', { name: 'Open pages and templates' })).toBeTruthy();
        expect(screen.getByTestId('touch-tool-pill')).toBeTruthy();
        expect(sheetTitle()).toBe('Page · Root');
        expect(screen.getByTestId('properties-panel')).toBeTruthy();
        expect(canvasProps.inputMode).toBe('touch');
    });

    it('switches tools from the pill', () => {
        renderLegacy('phone');
        fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }));
        expect(canvasProps.tool).toBe('rect');
        expect(screen.getByRole('button', { name: 'Rectangle' }).getAttribute('aria-pressed')).toBe('true');
        fireEvent.click(screen.getByRole('button', { name: 'Pan' }));
        expect(canvasProps.tool).toBe('hand');
    });

    it('labels the sheet with the selection and duplicates, deletes and undoes it from the overflow menu', () => {
        renderLegacy('phone', { selectedElementIds: ['r1'] });
        expect(sheetTitle()).toBe('Rect');

        openOverflow();
        fireEvent.click(screen.getByRole('button', { name: 'Duplicate selection' }));
        expect(legacyElements()).toHaveLength(2);
        const [duplicateId] = canvasProps.selectedElementIds as string[];
        expect(duplicateId).toBeDefined();
        expect(duplicateId).not.toBe('r1');
        expect(sheetTitle()).toBe('Rect');

        openOverflow();
        fireEvent.click(screen.getByRole('button', { name: 'Delete selection' }));
        expect(legacyElements().map(element => element.id)).toEqual(['r1']);
        expect(canvasProps.selectedElementIds).toEqual([]);
        expect(sheetTitle()).toBe('Page · Root');

        // Both actions recorded history: two undos walk back through the delete and the duplicate.
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        expect(legacyElements()).toHaveLength(2);
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        expect(legacyElements().map(element => element.id)).toEqual(['r1']);
        expect(screen.getByRole('button', { name: 'Undo' })).toHaveProperty('disabled', true);
        expect(screen.getByRole('button', { name: 'Redo' })).toHaveProperty('disabled', false);
    });

    it('labels a multi-selection by count', () => {
        const state = legacyState();
        state.variants.default.templates.page.elements = [rect('r1'), rect('r2')];
        renderLegacy('phone', { ...state, selectedElementIds: ['r1', 'r2'] });
        expect(sheetTitle()).toBe('2 elements');
    });

    it('mirrors the desktop snap and grid toggles', () => {
        renderLegacy('phone');
        expect(canvasProps.snapToGrid).toBe(true);
        expect(canvasProps.showGrid).toBe(false);
        openOverflow();
        fireEvent.click(screen.getByRole('button', { name: 'Snap to grid' }));
        expect(canvasProps.snapToGrid).toBe(false);
        expect(canvasProps.showGrid).toBe(false);
        // Turning snap on also reveals the grid, exactly like the desktop toolbar's magnet button.
        fireEvent.click(screen.getByRole('button', { name: 'Snap to grid' }));
        expect(canvasProps.snapToGrid).toBe(true);
        expect(canvasProps.showGrid).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Show grid' }));
        expect(canvasProps.showGrid).toBe(false);
        expect(canvasProps.snapToGrid).toBe(true);
    });

    it('toggles greyscale preview and opens the JSON, generator and preset dialogs from the overflow menu', () => {
        renderLegacy('phone');
        openOverflow();
        fireEvent.click(screen.getByRole('button', { name: 'Greyscale export' }));
        expect(canvasProps.greyscalePreview).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
        expect(modals.json).toBe(true);
        openOverflow();
        fireEvent.click(screen.getByRole('button', { name: 'Generator' }));
        expect(modals.generator).toBe(true);
        openOverflow();
        fireEvent.click(screen.getByRole('button', { name: 'Save preset' }));
        expect(modals.preset).toBe(true);
    });

    it('offers no preview-node choice in hierarchy view', () => {
        renderLegacy('phone');
        openOverflow();
        expect(screen.queryByRole('combobox', { name: 'Preview node' })).toBeNull();
    });

    it('offers the preview-node choice in templates view and routes it to the canvas', () => {
        renderLegacy('phone', { viewMode: 'templates', selectedTemplateId: 'page', selectedTemplateIds: ['page'] });
        expect(canvasProps.currentNodeId).toBe('root');
        openOverflow();
        const select = screen.getByRole('combobox', { name: 'Preview node' }) as HTMLSelectElement;
        expect([...select.options].map(option => option.textContent)).toEqual(['Root', 'Second']);
        fireEvent.change(select, { target: { value: 'n2' } });
        expect(canvasProps.currentNodeId).toBe('n2');
    });

    it('closes the drawer when a page is picked', () => {
        renderLegacy('phone');
        fireEvent.click(screen.getByRole('button', { name: 'Open pages and templates' }));
        expect(screen.getByTestId('sidebar')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Go to n2' }));
        expect(canvasProps.currentNodeId).toBe('n2');
        expect(screen.queryByTestId('sidebar')).toBeNull();
    });

    it('fits the page from the pill without touching the persisted scale', () => {
        const onStateChange = vi.fn();
        render(
            <FormFactorProvider value="phone">
                <ProjectEditor projectId="p" projectName="Root" initialState={legacyState({ scale: 1.5 })} isActive
                    onNameChange={() => {}} onStateChange={onStateChange}
                    onCreateGeneratedProject={async () => false} onSaveCustomPreset={async () => false} />
            </FormFactorProvider>,
        );
        const before = canvasProps.fitSignal;
        fireEvent.click(screen.getByRole('button', { name: 'Fit page to width' }));
        expect(canvasProps.fitSignal).toBe(before + 1);
        expect(onStateChange.mock.calls.every(([state]) => (state as AppState).scale === 1.5)).toBe(true);
    });
});

describe('tablet layout wired through the legacy editor', () => {
    it('collapses the bars into one toolbar row and docks the properties panel', () => {
        const { container } = renderLegacy('tablet');
        expect(container.querySelector('[data-mock="desktop-toolbar"]')).toBeNull();
        expect(screen.getByRole('button', { name: 'Export PDF' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Fit page to width' })).toBeTruthy();
        expect(screen.getByTestId('properties-panel')).toBeTruthy();
        expect(screen.queryByTestId('properties-sheet')).toBeNull();
        expect(screen.queryByTestId('touch-tool-pill')).toBeNull();
        expect(screen.queryByTestId('sidebar')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Open pages and templates' }));
        expect(screen.getByTestId('sidebar')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Text' }));
        expect(canvasProps.tool).toBe('text');
    });
});

describe('phone layout wired through the incremental editor', () => {
    it('keeps pinch zoom and fit out of the preferences lane', () => {
        const { onPreferencesChange } = renderIncremental('phone');
        expect(canvasProps.inputMode).toBe('touch');
        expect(canvasProps.fitSignal).toBeTruthy();
        act(() => canvasProps.onZoom(2));
        expect(canvasProps.scale).toBe(2);
        fireEvent.click(screen.getByRole('button', { name: 'Fit page to width' }));
        expect(onPreferencesChange.mock.calls.every(([patch]) => !Object.hasOwn(patch, 'scale'))).toBe(true);
    });

    it('duplicates, deletes and undoes the selection through document edits', () => {
        const { onDocumentEdit } = renderIncremental('phone');
        expect(sheetTitle()).toBe('Page · Racine 根');
        act(() => canvasProps.onSelectElements(['title']));
        expect(sheetTitle()).not.toMatch(/^Page ·/);

        openOverflow();
        fireEvent.click(screen.getByRole('button', { name: 'Duplicate selection' }));
        expect(canvasProps.elements).toHaveLength(2);
        expect(onDocumentEdit).toHaveBeenCalled();
        const [duplicateId] = canvasProps.selectedElementIds as string[];
        expect(duplicateId).toBeDefined();
        expect(duplicateId).not.toBe('title');

        openOverflow();
        fireEvent.click(screen.getByRole('button', { name: 'Delete selection' }));
        expect(canvasProps.elements.map((element: TemplateElement) => element.id)).toEqual(['title']);
        expect(canvasProps.selectedElementIds).toEqual([]);

        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        expect(canvasProps.elements).toHaveLength(2);
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        expect(canvasProps.elements.map((element: TemplateElement) => element.id)).toEqual(['title']);
    });

    it('routes tool changes to the session and snap/grid to the preferences lane', () => {
        const { onPreferencesChange } = renderIncremental('phone');
        fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }));
        expect(canvasProps.tool).toBe('rect');
        expect(onPreferencesChange.mock.calls.every(([patch]) => !Object.hasOwn(patch, 'tool'))).toBe(true);
        openOverflow();
        fireEvent.click(screen.getByRole('button', { name: 'Snap to grid' }));
        expect(canvasProps.snapToGrid).toBe(true);
        expect(canvasProps.showGrid).toBe(true);
        expect(onPreferencesChange).toHaveBeenLastCalledWith({ snapToGrid: true, showGrid: true }, expect.anything());
    });
});
