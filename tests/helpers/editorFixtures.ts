import type { AppState } from '../../types';
import { CURRENT_SCHEMA_VERSION } from '../../services/migration';

export const editorState = (overrides: Partial<AppState> = {}): AppState => ({
    nodes: { root: { id: 'root', parentId: null, type: 'page', title: 'Root', data: {}, children: [] } },
    rootId: 'root',
    variants: { default: { id: 'default', name: 'Default', templates: {
        page: { id: 'page', name: 'Page', width: 509, height: 679,
            layers: [{ id: 'l1', name: 'Layer 1', order: 0, visible: true, locked: false }], elements: [] },
    } } },
    activeVariantId: 'default', viewMode: 'hierarchy', selectedNodeId: 'root', selectedNodeIds: ['root'],
    selectedTemplateId: '', selectedTemplateIds: [], selectedElementIds: [], activeLayerId: 'l1',
    scale: 1, tool: 'select', showJsonModal: false, sidebarWidth: 280, propertiesPanelWidth: 320,
    snapToGrid: true, showGrid: false, showNodeSelector: false, nodeSelectorMode: 'grid_source',
    editingElementId: null, clipboard: [], schemaVersion: CURRENT_SCHEMA_VERSION,
    ...overrides,
} as AppState);
