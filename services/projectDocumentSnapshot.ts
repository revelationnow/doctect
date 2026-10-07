import type { AppState } from '../types';

export type DocumentSnapshot = Pick<AppState,
    'nodes' | 'rootId' | 'variants' | 'activeVariantId' | 'schemaVersion'
    | 'generator' | 'selectedNodeId' | 'selectedNodeIds'
    | 'selectedTemplateId' | 'selectedTemplateIds' | 'selectedElementIds' | 'activeLayerId'>;

export const snapshotDocument = (state: AppState): DocumentSnapshot => structuredClone({
    nodes: state.nodes,
    rootId: state.rootId,
    variants: state.variants,
    activeVariantId: state.activeVariantId,
    schemaVersion: state.schemaVersion,
    ...(Object.hasOwn(state, 'generator') ? { generator: state.generator } : {}),
    selectedNodeId: state.selectedNodeId,
    selectedNodeIds: state.selectedNodeIds,
    selectedTemplateId: state.selectedTemplateId,
    selectedTemplateIds: state.selectedTemplateIds,
    selectedElementIds: state.selectedElementIds,
    ...(Object.hasOwn(state, 'activeLayerId') ? { activeLayerId: state.activeLayerId } : {}),
});

export const restoreDocument = (state: AppState, snapshot: DocumentSnapshot): AppState => {
    const restored = { ...state, ...structuredClone(snapshot) };
    for (const key of ['generator', 'activeLayerId'] as const) {
        if (!Object.hasOwn(snapshot, key)) delete restored[key];
    }
    return restored;
};
