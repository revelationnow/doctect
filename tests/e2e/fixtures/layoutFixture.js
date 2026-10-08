// Shared editor state for the desktop layout guard (Task 2) and its touch
// counterparts (Task 16). schemaVersion tracks CURRENT_SCHEMA_VERSION in
// services/migration.ts so the seeded project loads without a migration.
export const layoutFixture = {
    nodes: { root: { id: 'root', parentId: null, type: 'page', title: 'Guard Page', data: {}, children: [] } },
    rootId: 'root',
    variants: { default: { id: 'default', name: 'Default', templates: { page: {
        id: 'page', name: 'Page', width: 595, height: 842,
        layers: [{ id: 'base', name: 'Base', order: 0, visible: true, locked: false }],
        elements: [
            { id: 'box', type: 'rect', layerId: 'base', x: 60, y: 80, w: 200, h: 120, rotation: 0,
              fill: '#e2e8f0', stroke: '#000000', strokeWidth: 1, opacity: 1 },
            { id: 'title', type: 'text', layerId: 'base', x: 60, y: 240, w: 300, h: 40, rotation: 0,
              fill: '', stroke: '', strokeWidth: 0, opacity: 1, text: 'Guard', autoWidth: false,
              fontSize: 24, fontFamily: 'helvetica', fontWeight: 'bold', fontStyle: 'normal',
              textColor: '#000000', textOverflow: 'clip', textWrap: true,
              textPadding: { top: 0, right: 0, bottom: 0, left: 0 } },
        ],
    } } } },
    activeVariantId: 'default', viewMode: 'hierarchy', selectedNodeId: 'root', selectedNodeIds: ['root'],
    selectedTemplateId: '', selectedTemplateIds: [], selectedElementIds: [], activeLayerId: 'base',
    scale: 0.8, tool: 'select', showJsonModal: false, showNodeSelector: false,
    nodeSelectorMode: 'grid_source', editingElementId: null, sidebarWidth: 288,
    propertiesPanelWidth: 320, snapToGrid: false, showGrid: false, clipboard: [],
    schemaVersion: 12,
};
