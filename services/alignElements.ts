import type { AppState, TemplateElement } from '../types';

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
 * The legacy editor's align/distribute, as EditorToolbar computed it before the touch Arrange menu
 * needed the same handler: the template's elements with the selected ones aligned. Returns the
 * input array when fewer than two selected elements exist in it.
 */
export function alignElements(elements: TemplateElement[], selectedElementIds: string[], type: AlignType): TemplateElement[] {
    const selectedElements = elements.filter(el => selectedElementIds.includes(el.id));
    if (selectedElements.length < 2) return elements;

    let finalElements = [...elements];

    if (type === 'left') {
        const minX = Math.min(...selectedElements.map(el => el.x));
        finalElements = finalElements.map(el =>
            selectedElementIds.includes(el.id) ? { ...el, x: minX } : el
        );
    } else if (type === 'right') {
        const maxRight = Math.max(...selectedElements.map(el => el.x + el.w));
        finalElements = finalElements.map(el =>
            selectedElementIds.includes(el.id) ? { ...el, x: maxRight - el.w } : el
        );
    } else if (type === 'center') {
        const minX = Math.min(...selectedElements.map(el => el.x));
        const maxRight = Math.max(...selectedElements.map(el => el.x + el.w));
        const centerX = (minX + maxRight) / 2;
        finalElements = finalElements.map(el =>
            selectedElementIds.includes(el.id) ? { ...el, x: centerX - (el.w / 2) } : el
        );
    } else if (type === 'top') {
        const minY = Math.min(...selectedElements.map(el => el.y));
        finalElements = finalElements.map(el =>
            selectedElementIds.includes(el.id) ? { ...el, y: minY } : el
        );
    } else if (type === 'bottom') {
        const maxBottom = Math.max(...selectedElements.map(el => el.y + el.h));
        finalElements = finalElements.map(el =>
            selectedElementIds.includes(el.id) ? { ...el, y: maxBottom - el.h } : el
        );
    } else if (type === 'middle') {
        const minY = Math.min(...selectedElements.map(el => el.y));
        const maxBottom = Math.max(...selectedElements.map(el => el.y + el.h));
        const centerY = (minY + maxBottom) / 2;
        finalElements = finalElements.map(el =>
            selectedElementIds.includes(el.id) ? { ...el, y: centerY - (el.h / 2) } : el
        );
    } else if (type === 'dist-h') {
        const sorted = [...selectedElements].sort((a, b) => a.x - b.x);
        const minX = sorted[0].x;
        const maxRight = sorted[sorted.length - 1].x + sorted[sorted.length - 1].w;
        const totalWidth = sorted.reduce((sum, el) => sum + el.w, 0);
        const totalGap = (maxRight - minX) - totalWidth;
        const gap = totalGap / (sorted.length - 1);

        // Id -> new x. The first and last elements define the range and stay where they are.
        const newXById: Record<string, number> = {};
        let currentX = minX;
        sorted.forEach((el, i) => {
            if (i === 0) {
                newXById[el.id] = el.x;
                currentX += el.w + gap;
                return;
            }
            newXById[el.id] = currentX;
            currentX += el.w + gap;
        });
        newXById[sorted[sorted.length - 1].id] = sorted[sorted.length - 1].x;

        finalElements = finalElements.map(el =>
            newXById[el.id] !== undefined ? { ...el, x: newXById[el.id] } : el
        );
    } else if (type === 'dist-v') {
        const sorted = [...selectedElements].sort((a, b) => a.y - b.y);
        const minY = sorted[0].y;
        const maxBottom = sorted[sorted.length - 1].y + sorted[sorted.length - 1].h;
        const totalHeight = sorted.reduce((sum, el) => sum + el.h, 0);
        const totalGap = (maxBottom - minY) - totalHeight;
        const gap = totalGap / (sorted.length - 1);

        const newYById: Record<string, number> = {};
        let currentY = minY;
        sorted.forEach((el, i) => {
            if (i === 0) {
                currentY += el.h + gap;
                return;
            }
            newYById[el.id] = currentY;
            currentY += el.h + gap;
        });
        newYById[sorted[sorted.length - 1].id] = sorted[sorted.length - 1].y;

        finalElements = finalElements.map(el =>
            newYById[el.id] !== undefined ? { ...el, y: newYById[el.id] } : el
        );
    }

    return finalElements;
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
    const template = templateId ? variant?.templates?.[templateId] : undefined;
    if (!variant || !template) return state;
    const finalElements = alignElements(template.elements, selectedElementIds, type);
    if (finalElements === template.elements) return state;
    return {
        ...state,
        variants: {
            ...variants,
            [activeVariantId]: {
                ...variant,
                templates: { ...variant.templates, [templateId!]: { ...template, elements: finalElements } },
            },
        },
    };
}
