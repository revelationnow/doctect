import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { editorState } from '../helpers/editorFixtures';

vi.mock('../../components/Sidebar', () => ({ Sidebar: () => <div data-mock="sidebar" /> }));
vi.mock('../../components/Canvas', () => ({ Canvas: () => <div data-mock="canvas" /> }));
vi.mock('../../components/PropertiesPanel', () => ({ PropertiesPanel: () => <div data-mock="properties" /> }));
vi.mock('../../components/LayersPanel', () => ({ LayersPanel: () => <div /> }));
vi.mock('../../components/CollapsibleSection', () => ({ CollapsibleSection: () => <div /> }));
vi.mock('../../components/JsonModal', () => ({ JsonModal: () => null }));
vi.mock('../../components/NodeSelectorModal', () => ({ NodeSelectorModal: () => null }));
vi.mock('../../components/DeleteConfirmModal', () => ({ DeleteConfirmModal: () => null }));
vi.mock('../../components/SavePresetModal', () => ({ SavePresetModal: () => null }));
vi.mock('../../components/NewVariantModal', () => ({ NewVariantModal: () => null }));
vi.mock('../../components/EditorToolbar', () => ({ EditorToolbar: () => <div data-mock="toolbar" /> }));
vi.mock('../../components/HierarchyGeneratorModal', () => ({ HierarchyGeneratorModal: () => null }));

import { ProjectEditor } from '../../components/ProjectEditor';

const state = editorState();

describe('ProjectEditor desktop layout', () => {
    it('renders the desktop editor markup unchanged', () => {
        const { container } = render(
            <ProjectEditor
                projectId="11111111-2222-3333-4444-555555555555"
                projectName="Root"
                initialState={state}
                isActive
                onNameChange={() => {}}
                onCreateGeneratedProject={async () => false}
                onSaveCustomPreset={async () => false}
            />,
        );
        expect(container.innerHTML).toMatchSnapshot();
    });
});
