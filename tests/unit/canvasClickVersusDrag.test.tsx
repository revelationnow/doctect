import { describe, it, expect } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { TemplateElement } from '../../types';
import { renderCanvas, makeEl, makeLayer } from './canvasTestUtils';

// A press only becomes a drag once the pointer passes the drag threshold (5 units). Below it,
// the press is still a click: nothing moves, and Ctrl/Cmd makes no copy.
describe('click versus drag on the canvas', () => {
    const layers = [makeLayer('back', 0), makeLayer('front', 1)];
    // Same bounds, so both overlap at (50,50). Stack top -> bottom = [top, bottom].
    const stack = [
        makeEl('bottom', { layerId: 'back', zIndex: 1 }),
        makeEl('top', { layerId: 'front', zIndex: 1 }),
    ];

    it('a wobble within the threshold moves nothing, and the click still cycles the stack', () => {
        const { container, outer, onUpdateElements, onSelectElements } = renderCanvas(stack, layers, { selectedElementIds: ['top'] });
        fireEvent.mouseDown(container.querySelector('[data-element-id="top"]')!, { clientX: 50, clientY: 50, button: 0 });
        fireEvent.mouseMove(outer, { clientX: 53, clientY: 52 });
        fireEvent.mouseUp(outer, { clientX: 53, clientY: 52 });

        expect(onUpdateElements).not.toHaveBeenCalled();
        expect(onSelectElements.mock.calls.at(-1)![0]).toEqual(['bottom']);
    });

    it('a drag past the threshold moves the selection the whole distance', () => {
        const { container, outer, onUpdateElements } = renderCanvas(stack, layers, { selectedElementIds: ['top'] });
        fireEvent.mouseDown(container.querySelector('[data-element-id="top"]')!, { clientX: 50, clientY: 50, button: 0 });
        fireEvent.mouseMove(outer, { clientX: 70, clientY: 50 });

        const moved: TemplateElement[] = onUpdateElements.mock.calls.at(-1)![0];
        expect(moved.find(e => e.id === 'top')!.x).toBe(20);
        expect(moved.find(e => e.id === 'bottom')!.x).toBe(0);
    });

    it('a Ctrl-click without a drag selects and leaves no copy behind', () => {
        const els = [makeEl('a', { layerId: 'front', zIndex: 1 })];
        const { container, outer, onUpdateElements, onSelectElements } = renderCanvas(els, layers);
        fireEvent.mouseDown(container.querySelector('[data-element-id="a"]')!, { clientX: 50, clientY: 50, button: 0, ctrlKey: true });
        fireEvent.mouseMove(outer, { clientX: 52, clientY: 51, ctrlKey: true });
        fireEvent.mouseUp(outer, { clientX: 52, clientY: 51 });

        expect(onUpdateElements).not.toHaveBeenCalled();
        expect(onSelectElements.mock.calls.at(-1)![0]).toEqual(['a']);
    });

    it('a Ctrl-drag copies the selection in place and selects the copy to drag', () => {
        const els = [makeEl('a', { layerId: 'front', zIndex: 1, x: 10, y: 20 })];
        const { container, outer, onUpdateElements, onSelectElements } = renderCanvas(els, layers);
        fireEvent.mouseDown(container.querySelector('[data-element-id="a"]')!, { clientX: 50, clientY: 50, button: 0, metaKey: true });
        fireEvent.mouseMove(outer, { clientX: 80, clientY: 50, metaKey: true });

        // The copy is appended where the original stands...
        const appended: TemplateElement[] = onUpdateElements.mock.calls[0][0];
        expect(appended).toHaveLength(2);
        const copy = appended.find(e => e.id !== 'a')!;
        expect(copy).toMatchObject({ x: 10, y: 20, layerId: 'front' });
        expect(onSelectElements.mock.calls.at(-1)![0]).toEqual([copy.id]);
        // ...and the same move drags it, leaving the original in place.
        const moved: TemplateElement[] = onUpdateElements.mock.calls.at(-1)![0];
        expect(moved.find(e => e.id === copy.id)).toMatchObject({ x: 40, y: 20 });
        expect(moved.find(e => e.id === 'a')).toMatchObject({ x: 10, y: 20 });
    });
});
