import type { AppNode, AppState, TemplateElement } from '../types';
import { elementAabb, type Box } from './geometry/elementBox';

export type AlignType = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'dist-h' | 'dist-v';

/** The align/distribute actions in the desktop toolbar's order, with the labels the touch Arrange menu shows. */
export const ALIGN_ACTIONS: ReadonlyArray<{ type: AlignType; label: string }> = [
    { type: 'left', label: 'Align left' },
    { type: 'center', label: 'Align center' },
    { type: 'right', label: 'Align right' },
    { type: 'top', label: 'Align top' },
    { type: 'middle', label: 'Align middle' },
    { type: 'bottom', label: 'Align bottom' },
    { type: 'dist-h', label: 'Distribute horizontally' },
    { type: 'dist-v', label: 'Distribute vertically' },
];

/**
 * How far each selected element moves to align or distribute their visible boxes. The outermost
 * two stay put when distributing. Shared by the legacy editor and the incremental editor.
 */
export function alignmentOffsets(items: { id: string; box: Box }[], type: AlignType): Map<string, { dx: number; dy: number }> {
    const out = new Map<string, { dx: number; dy: number }>();
    if (items.length < 2) return out;
    const horizontal = type === 'left' || type === 'center' || type === 'right' || type === 'dist-h';
    const lo = (b: Box) => horizontal ? b.x : b.y;
    const len = (b: Box) => horizontal ? b.w : b.h;
    const set = (id: string, d: number) => out.set(id, horizontal ? { dx: d, dy: 0 } : { dx: 0, dy: d });
    const min = Math.min(...items.map(i => lo(i.box)));
    const max = Math.max(...items.map(i => lo(i.box) + len(i.box)));
    if (type === 'dist-h' || type === 'dist-v') {
        const sorted = [...items].sort((a, b) => lo(a.box) - lo(b.box));
        const gap = (max - min - sorted.reduce((s, i) => s + len(i.box), 0)) / (sorted.length - 1);
        let cursor = min;
        sorted.forEach((item, index) => {
            const last = index === sorted.length - 1;
            set(item.id, last ? 0 : cursor - lo(item.box));
            cursor += len(item.box) + gap;
        });
        return out;
    }
    for (const { id, box } of items) {
        const target = type === 'left' || type === 'top' ? min
            : type === 'right' || type === 'bottom' ? max - len(box)
            : (min + max - len(box)) / 2;
        set(id, target - lo(box));
    }
    return out;
}

/**
 * The legacy editor's align/distribute (desktop toolbar and touch Arrange alike): the template's
 * elements with the selected ones aligned by their visible boxes. Returns the input array when
 * fewer than two selected elements exist in it.
 */
export function alignElements(elements: TemplateElement[], selectedElementIds: string[], type: AlignType,
    nodes: Record<string, AppNode> = {}, currentNodeId = ''): TemplateElement[] {
    const items = elements.filter(el => selectedElementIds.includes(el.id))
        .map(el => ({ id: el.id, box: elementAabb(el, nodes, currentNodeId) }));
    if (items.length < 2) return elements;
    const offsets = alignmentOffsets(items, type);
    return elements.map(el => {
        const o = offsets.get(el.id);
        return o && (o.dx || o.dy) ? { ...el, x: el.x + o.dx, y: el.y + o.dy } : el;
    });
}

/** The template the legacy editor shows: the selected node's in hierarchy view, else the selected template. */
const currentTemplateIdOf = (state: AppState) =>
    state.viewMode === 'hierarchy' ? state.nodes[state.selectedNodeId]?.type : state.selectedTemplateId;

/**
 * The legacy editor's state update for an align action (desktop toolbar and touch Arrange alike).
 * Returns the same state when fewer than two elements are selected or the shown template is missing.
 */
export function alignSelectedElements(state: AppState, type: AlignType): AppState {
    const { selectedElementIds, activeVariantId, variants } = state;
    if (selectedElementIds.length < 2) return state;
    const templateId = currentTemplateIdOf(state);
    const variant = variants[activeVariantId];
    if (!templateId || !variant) return state;
    const template = variant.templates?.[templateId];
    if (!template) return state;
    const finalElements = alignElements(template.elements, selectedElementIds, type, state.nodes, state.selectedNodeId);
    if (finalElements === template.elements) return state;
    return {
        ...state,
        variants: {
            ...variants,
            [activeVariantId]: {
                ...variant,
                templates: { ...variant.templates, [templateId]: { ...template, elements: finalElements } },
            },
        },
    };
}
