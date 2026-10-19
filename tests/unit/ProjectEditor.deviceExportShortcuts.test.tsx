import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProjectEditor } from '../../components/ProjectEditor';
import { makeIncrementalProject } from '../helpers/incrementalFixtures';

// Both editors' window keydown shortcut handlers bail out while "Export as template" is open, as they do
// for the JSON, preset and variant modals. The keys here are dispatched on window directly, past the
// dialog's own stopPropagation, so a key that reaches the handler with focus outside the dialog is covered.
const editorProps = () => {
    const project = makeIncrementalProject(1);
    return {
        projectId: project.id, projectName: project.name, initialState: project.initialState, isActive: true,
        onNameChange: vi.fn(), onCreateGeneratedProject: vi.fn(async () => true), onSaveCustomPreset: vi.fn(async () => true),
    };
};
const selectTitleElement = () => {
    fireEvent.click(screen.getByTitle('Layers'));
    fireEvent.click(screen.getByTestId('element-row-title'));
};
const deviceDialog = () => screen.queryByRole('dialog', { name: 'Export as template' });
const openDeviceExport = () => fireEvent.click(screen.getByTitle('Export templates for e-ink devices'));
const closeDeviceExport = () => fireEvent.click(screen.getByRole('button', { name: 'Close export for device' }));

describe('Export as template dialog and the editor shortcuts', () => {
    it('legacy editor: Delete on window leaves the selection alone while the dialog is open', () => {
        render(<ProjectEditor {...editorProps()} />);
        selectTitleElement();
        openDeviceExport();
        expect(deviceDialog()).not.toBeNull();
        fireEvent.keyDown(window, { key: 'Delete' });
        fireEvent.keyDown(window, { key: 'Backspace' });
        expect(screen.getByTestId('element-row-title')).toBeInTheDocument();
        closeDeviceExport();
        expect(deviceDialog()).toBeNull();
        fireEvent.keyDown(window, { key: 'Delete' });
        expect(screen.queryByTestId('element-row-title')).toBeNull();
    });

    it('legacy editor: Delete on window leaves the selection alone while New Variant is open (matches the incremental list)', () => {
        render(<ProjectEditor {...editorProps()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Templates' }));
        selectTitleElement();
        fireEvent.click(screen.getByTitle('Add New Variant'));
        expect(screen.getByText('New Variant')).toBeInTheDocument();
        // Focus on <body>, as after a click on the modal's backdrop: the handler's input/textarea check does not apply.
        (document.activeElement as HTMLElement | null)?.blur();
        fireEvent.keyDown(window, { key: 'Delete' });
        fireEvent.keyDown(window, { key: 'Backspace' });
        expect(screen.getByTestId('element-row-title')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByText('New Variant')).toBeNull();
        fireEvent.keyDown(window, { key: 'Delete' });
        expect(screen.queryByTestId('element-row-title')).toBeNull();
    });

    it('incremental editor: Delete and undo on window emit no document edit while the dialog is open', () => {
        const onDocumentEdit = vi.fn();
        render(
            <ProjectEditor {...editorProps()} incremental={{ source: {}, editorGenerationFloor: 10, foldStructureGeneration: 4 }}
                onDocumentEdit={onDocumentEdit} onPreferencesChange={vi.fn()} />,
        );
        selectTitleElement();
        openDeviceExport();
        expect(deviceDialog()).not.toBeNull();
        fireEvent.keyDown(window, { key: 'Delete' });
        fireEvent.keyDown(window, { key: 'Backspace' });
        fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
        expect(onDocumentEdit).not.toHaveBeenCalled();
        expect(screen.getByTestId('element-row-title')).toBeInTheDocument();
        closeDeviceExport();
        expect(deviceDialog()).toBeNull();
        fireEvent.keyDown(window, { key: 'Delete' });
        expect(onDocumentEdit).toHaveBeenCalledOnce();
        expect(screen.queryByTestId('element-row-title')).toBeNull();
    });
});
