import type { AppState } from '../../types';
import { computePageOrder } from '../pdfService';

/** Images per export (pages × devices). Above this a phone browser runs out of memory building the zip. */
export const MAX_EXPORT_IMAGES = 400;

export interface PageChoice { nodeId: string; title: string }
export interface TemplateGroup { templateId: string; name: string; pages: PageChoice[] }

/**
 * The picker's rows: the active variant's pages grouped by template, groups in order of first
 * appearance, pages in page order. References and pages whose template is missing are not pages
 * the PDF can draw, so they are left out.
 */
export function buildPageGroups(state: AppState): TemplateGroup[] {
    const templates = state.variants?.[state.activeVariantId]?.templates ?? {};
    const groups = new Map<string, TemplateGroup>();
    for (const nodeId of computePageOrder(state)) {
        const node = state.nodes[nodeId];
        if (!node || !Object.hasOwn(templates, node.type)) continue;
        let group = groups.get(node.type);
        if (!group) {
            group = { templateId: node.type, name: templates[node.type].name?.trim() || node.type, pages: [] };
            groups.set(node.type, group);
        }
        group.pages.push({ nodeId, title: node.title?.trim() || 'Untitled page' });
    }
    return [...groups.values()];
}

/** One representative page per template. */
export const defaultSelection = (groups: TemplateGroup[]): Set<string> =>
    new Set(groups.flatMap(group => group.pages.slice(0, 1).map(page => page.nodeId)));

export function filterGroups(groups: TemplateGroup[], query: string): TemplateGroup[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return groups;
    return groups
        .map(group => ({ ...group, pages: group.pages.filter(page => page.title.toLowerCase().includes(needle)) }))
        .filter(group => group.pages.length > 0);
}

export const imageCount = (pageCount: number, deviceCount: number): number => pageCount * deviceCount;

/** Why Export is disabled, or null when it is allowed. */
export function exportBlockReason(pageCount: number, deviceCount: number): string | null {
    if (pageCount === 0 || deviceCount === 0) return 'Pick at least one page and one device.';
    if (imageCount(pageCount, deviceCount) > MAX_EXPORT_IMAGES) return 'Too many files: pick fewer pages or devices.';
    return null;
}
