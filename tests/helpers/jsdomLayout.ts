import { afterAll, beforeAll } from 'vitest';

/**
 * jsdom lays nothing out, so `getClientRects()` is empty for every element and code that reads
 * it as "is this rendered?" (focusTrap's tabbable filter) sees nothing. Within the calling
 * describe/file, every element reports one box unless it, or an ancestor, is hidden one of the
 * ways jsdom can express: the `hidden` attribute or an inline `display: none`.
 */
export function layOutEveryElement(): void {
    let original: (this: Element) => DOMRectList;
    beforeAll(() => {
        original = Element.prototype.getClientRects;
        Element.prototype.getClientRects = function (this: Element): DOMRectList {
            for (let node: Element | null = this; node; node = node.parentElement) {
                if (node.hasAttribute('hidden') || (node instanceof HTMLElement && node.style.display === 'none')) {
                    return original.call(this);
                }
            }
            const rect = { x: 0, y: 0, top: 0, left: 0, width: 1, height: 1, right: 1, bottom: 1, toJSON: () => ({}) } as DOMRect;
            return { length: 1, 0: rect, item: () => rect, [Symbol.iterator]: function* () { yield rect; } } as unknown as DOMRectList;
        };
    });
    afterAll(() => { Element.prototype.getClientRects = original; });
}
