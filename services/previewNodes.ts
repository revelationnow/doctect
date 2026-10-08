import type { AppNode, AppState } from '../types';

/**
 * Pure helper behind the touch overflow menu's "Preview node" choice: in templates view, the
 * nodes rendered by the selected template (what the desktop EditorToolbar's preview select
 * lists). `null` means the control should not be shown at all.
 */
export function listPreviewNodes(
    state: AppState,
    effectivePreviewNodeId: string,
): { options: { id: string; title: string }[]; selectedId: string } | null {
    if (state.viewMode !== 'templates') return null;
    const options = (Object.values(state.nodes) as AppNode[])
        .filter(node => node.type === state.selectedTemplateId)
        .map(node => ({ id: node.id, title: node.title }));
    if (options.length === 0) return null;
    return { options, selectedId: effectivePreviewNodeId };
}
