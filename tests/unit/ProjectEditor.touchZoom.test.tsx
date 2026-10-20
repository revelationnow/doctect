import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppState } from '../../types';

let canvasProps: any = null;
let sidebarProps: any = null;
vi.mock('../../components/Canvas', () => ({ Canvas: (props: any) => { canvasProps = props; return <div />; } }));
vi.mock('../../components/Sidebar', () => ({ Sidebar: (props: any) => { sidebarProps = props; return <div />; } }));
vi.mock('../../components/PropertiesPanel', () => ({ PropertiesPanel: () => <div /> }));
vi.mock('../../components/LayersPanel', () => ({ LayersPanel: () => <div /> }));
vi.mock('../../components/CollapsibleSection', () => ({ CollapsibleSection: () => <div /> }));
vi.mock('../../components/JsonModal', () => ({ JsonModal: () => null }));
vi.mock('../../components/NodeSelectorModal', () => ({ NodeSelectorModal: () => null }));
vi.mock('../../components/DeleteConfirmModal', () => ({ DeleteConfirmModal: () => null }));
vi.mock('../../components/SavePresetModal', () => ({ SavePresetModal: () => null }));
vi.mock('../../components/NewVariantModal', () => ({ NewVariantModal: () => null }));
vi.mock('../../components/EditorToolbar', () => ({ EditorToolbar: () => <div /> }));
vi.mock('../../components/HierarchyGeneratorModal', () => ({ HierarchyGeneratorModal: () => null }));

import { ProjectEditor } from '../../components/ProjectEditor';
import { FormFactorProvider } from '../../components/editor-layout/FormFactorContext';
import { editorState } from '../helpers/editorFixtures';

const state = editorState({ scale: 1.5 });

const renderEditor = (formFactor: 'desktop' | 'tablet' | 'phone', onStateChange = vi.fn(), input?: 'mouse' | 'touch') => {
    render(
        <FormFactorProvider value={formFactor} input={input}>
            <ProjectEditor projectId="p" projectName="Root" initialState={state} isActive
                onNameChange={() => {}} onStateChange={onStateChange}
                onCreateGeneratedProject={async () => false} onSaveCustomPreset={async () => false} />
        </FormFactorProvider>,
    );
    return onStateChange;
};

afterEach(() => {
    cleanup();
    document.documentElement.removeAttribute('data-form-factor');
    canvasProps = null;
    sidebarProps = null;
});

describe('touch zoom isolation', () => {
    it.each(['phone', 'tablet'] as const)('keeps %s zoom out of the persisted project state', (formFactor) => {
        const onStateChange = renderEditor(formFactor);
        expect(canvasProps.inputMode).toBe('touch');
        expect(canvasProps.fitSignal).toBeTruthy();
        act(() => canvasProps.onZoom(3));
        expect(canvasProps.scale).toBe(3);
        // The editor's own state (what the legacy editor reports and the sidebar sees) is untouched.
        // On touch the sidebar lives in the drawer, so open it to read what it is given.
        fireEvent.click(screen.getByRole('button', { name: 'Open pages and templates' }));
        expect(sidebarProps.state.scale).toBe(1.5);
        const persisted = onStateChange.mock.calls.map(([s]) => s as AppState);
        expect(persisted.every(s => s.scale === 1.5 && s.sidebarWidth === 280 && s.propertiesPanelWidth === 320)).toBe(true);
    });

    it('keeps desktop zoom writing to state.scale', () => {
        const onStateChange = renderEditor('desktop');
        expect(canvasProps.inputMode).toBe('mouse');
        expect(canvasProps.fitSignal).toBeUndefined();
        expect(canvasProps.scale).toBe(1.5);
        act(() => canvasProps.onZoom(2));
        expect(canvasProps.scale).toBe(2);
        expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ scale: 2 }));
    });
});

describe('narrow mouse windows', () => {
    it.each(['phone', 'tablet'] as const)('%s layout: mouse input, fitted session zoom kept out of the project', (formFactor) => {
        const onStateChange = renderEditor(formFactor, vi.fn(), 'mouse');
        expect(canvasProps.inputMode).toBe('mouse');
        expect(canvasProps.fitSignal).toBeTruthy();
        act(() => canvasProps.onZoom(3));
        expect(canvasProps.scale).toBe(3);
        const persisted = onStateChange.mock.calls.map(([s]) => s as AppState);
        expect(persisted.every(s => s.scale === 1.5)).toBe(true);
    });

    it('shows the narrow chrome without the Select multiple toggle, and keeps multi-select off', () => {
        renderEditor('tablet', vi.fn(), 'mouse');
        expect(screen.getByRole('button', { name: 'Open pages and templates' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Select' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Select multiple' })).toBeNull();
        expect(canvasProps.multiSelect).toBe(false);
    });

    it('touch keeps the Select multiple toggle', () => {
        renderEditor('tablet');
        expect(screen.getByRole('button', { name: 'Select multiple' })).toBeTruthy();
    });

    it('closes the drawer after a pick, as on touch', () => {
        renderEditor('tablet', vi.fn(), 'mouse');
        fireEvent.click(screen.getByRole('button', { name: 'Open pages and templates' }));
        expect(screen.getByRole('dialog')).toBeTruthy();
        act(() => sidebarProps.onSelectNode('root', false, false));
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});
