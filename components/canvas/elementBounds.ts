import { AppNode, TemplateElement, TraversalStep } from '../../types';

export const traverseGridData = (
    currentNodes: string[],
    steps: TraversalStep[],
    depth: number,
    nodes: Record<string, AppNode>
): string[] => {
    if (depth >= steps.length) return currentNodes;
    if (!currentNodes || currentNodes.length === 0) return [];

    const step = steps[depth];
    const nextLevelNodes: string[] = [];

    currentNodes.forEach(nodeId => {
        const node = nodes[nodeId];
        if (!node) return;

        let targetNode = node;
        if (node.referenceId && nodes[node.referenceId]) {
            targetNode = nodes[node.referenceId];
        }

        const children = targetNode.children || [];

        const start = step.sliceStart || 0;
        const end = step.sliceCount !== undefined ? start + step.sliceCount : undefined;
        const sliced = children.slice(start, end);

        nextLevelNodes.push(...sliced);
    });

    return traverseGridData(nextLevelNodes, steps, depth + 1, nodes);
};

/**
 * Empty cells before a grid's first item: its static offset, or in dynamic mode the first item's
 * offset field (read through a reference) plus the adjustment; a negative offset wraps by one row.
 * The cells, the element's bounds and the PDF all lay a grid out with this number.
 */
export const gridLeadingOffset = (
    gridConfig: NonNullable<TemplateElement['gridConfig']>,
    items: string[],
    nodes: Record<string, AppNode>,
    colCount: number
): number => {
    let offset = gridConfig.offsetStart || 0;
    const { offsetMode, offsetField, offsetAdjustment } = gridConfig;
    if (offsetMode === 'dynamic' && offsetField && items.length > 0) {
        let firstNode = nodes[items[0]];
        if (firstNode && firstNode.referenceId && nodes[firstNode.referenceId]) {
            firstNode = nodes[firstNode.referenceId];
        }
        if (firstNode && firstNode.data && firstNode.data[offsetField]) {
            const parsed = parseInt(firstNode.data[offsetField], 10);
            if (!isNaN(parsed)) {
                offset = parsed + (offsetAdjustment || 0);
            }
        }
    }
    if (offset < 0) {
        offset += colCount;
    }
    return offset;
};

export const getElementBounds = (
    el: TemplateElement,
    nodes: Record<string, AppNode>,
    currentNodeId: string
): { w: number; h: number } => {
    if (el.type === 'grid' && el.gridConfig) {
        const { cols, gapX, gapY, sourceType, sourceId, dataSliceStart, dataSliceCount, traversalPath } = el.gridConfig;
        let items: any[] = [];

        if (sourceType === 'current') {
            items = nodes[currentNodeId] ? [currentNodeId] : [];
            if (!traversalPath || traversalPath.length === 0) {
                items = nodes[currentNodeId]?.children || [];
            }
        } else if (sourceType === 'specific' && sourceId) {
            items = [sourceId];
            if (!traversalPath || traversalPath.length === 0) {
                items = nodes[sourceId]?.children || [];
            }
        }

        if (traversalPath && traversalPath.length > 0) {
            items = traverseGridData(items, traversalPath, 0, nodes);
        }

        const start = dataSliceStart || 0;
        const limit = dataSliceCount;
        if (start > 0 || limit !== undefined) {
            const end = limit !== undefined ? start + limit : undefined;
            items = items.slice(start, end);
        }

        const displayCount = items.length > 0 ? items.length : 6;
        const colCount = Math.max(1, cols || 3);
        const offset = gridLeadingOffset(el.gridConfig, items, nodes, colCount);
        const rowCount = Math.max(1, Math.ceil((displayCount + offset) / colCount));

        // Gaps default to 10, as the cells and the PDF lay them out.
        const totalW = colCount * el.w + (colCount - 1) * (gapX ?? 10);
        const totalH = rowCount * el.h + (rowCount - 1) * (gapY ?? 10);

        return { w: totalW, h: totalH };
    }
    return { w: el.w, h: el.h };
};
