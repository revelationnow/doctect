import { describe, it, expect } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { renderCanvas, makeEl, makeLayer } from './canvasTestUtils';
import type { TemplateElement } from '../../types';

// jsdom: client px == page units * scale (bounding rect at 0,0). Template is 500 x 700.
const layers = [makeLayer('back', 0), makeLayer('front', 1)];
const lastMoved = (fn: any, id: string): TemplateElement => fn.mock.calls.at(-1)![0].find((e: TemplateElement) => e.id === id);
const guidesIn = (c: HTMLElement) => c.querySelector('[data-testid="snap-guides"]');
const press = (c: HTMLElement, id: string, x: number, y: number, extra = {}) =>
    fireEvent.mouseDown(c.querySelector(`[data-element-id="${id}"]`)!, { clientX: x, clientY: y, button: 0, ...extra });

// a: 100..200 x 0..100 (back). b: 300..400 x 300..400 (front), selected. Pressing b at (350, 350) and
// moving to clientX 153 puts b's left edge at 103: 3 from a's left edge, far from the page edges.
const scene = () => [makeEl('a', { layerId: 'back', x: 100 }), makeEl('b', { layerId: 'front', x: 300, y: 300 })];

describe('canvas move snapping', () => {
    it('pulls the dragged edge onto a nearby edge and shows the guide', () => {
        const { container, outer, onUpdateElements } = renderCanvas(scene(), layers, { selectedElementIds: ['b'], smartGuides: true });
        press(container, 'b', 350, 350);
        fireEvent.mouseMove(outer, { clientX: 153, clientY: 350 }); // b.x 103 -> 100
        expect(lastMoved(onUpdateElements, 'b').x).toBe(100);
        expect(guidesIn(container)?.querySelector('line[data-guide-kind="align"]')).toBeTruthy();
        fireEvent.mouseUp(outer, { clientX: 153, clientY: 350 });
        expect(guidesIn(container)).toBeNull();
    });
    it('does not snap with guides off (the component default)', () => {
        const { container, outer, onUpdateElements } = renderCanvas(scene(), layers, { selectedElementIds: ['b'] });
        press(container, 'b', 350, 350);
        fireEvent.mouseMove(outer, { clientX: 153, clientY: 350 });
        expect(lastMoved(onUpdateElements, 'b').x).toBe(103);
    });
    it('Alt held moves freely and hides guides', () => {
        const { container, outer, onUpdateElements } = renderCanvas(scene(), layers, { selectedElementIds: ['b'], smartGuides: true, snapToGrid: true });
        press(container, 'b', 350, 350);
        fireEvent.mouseMove(outer, { clientX: 153, clientY: 351, altKey: true });
        expect(lastMoved(onUpdateElements, 'b')).toMatchObject({ x: 103, y: 301 });
        expect(guidesIn(container)).toBeNull();
    });
    it('snaps the left edge to an absolute grid line', () => {
        const els = [makeEl('b', { layerId: 'front', x: 203, y: 300 })];
        const { container, outer, onUpdateElements } = renderCanvas(els, layers, { selectedElementIds: ['b'], snapToGrid: true, gridSize: 20 });
        press(container, 'b', 250, 350);
        fireEvent.mouseMove(outer, { clientX: 280, clientY: 350 }); // raw x 233 -> line 240 (rounding the delta gave 243)
        expect(lastMoved(onUpdateElements, 'b').x).toBe(240);
    });
    it('ignores objects on hidden layers but snaps to locked ones', () => {
        for (const [over, expected] of [[{ visible: false }, 103], [{ locked: true }, 100]] as const) {
            const ls = [makeLayer('back', 0, over), makeLayer('front', 1)];
            const { container, outer, onUpdateElements, unmount } = renderCanvas(scene(), ls, { selectedElementIds: ['b'], smartGuides: true });
            press(container, 'b', 350, 350);
            fireEvent.mouseMove(outer, { clientX: 153, clientY: 350 });
            expect(lastMoved(onUpdateElements, 'b').x).toBe(expected);
            unmount();
        }
    });
    it('a click builds no targets and shows no guides', () => {
        const { container, outer, onUpdateElements } = renderCanvas(scene(), layers, { selectedElementIds: ['b'], smartGuides: true });
        press(container, 'b', 350, 350);
        fireEvent.mouseMove(outer, { clientX: 352, clientY: 351 }); // inside the 5 pt drag threshold
        fireEvent.mouseUp(outer, { clientX: 352, clientY: 351 });
        expect(onUpdateElements).not.toHaveBeenCalled();
        expect(guidesIn(container)).toBeNull();
    });
    it('Escape clears guides', () => {
        const { container, outer } = renderCanvas(scene(), layers, { selectedElementIds: ['b'], smartGuides: true });
        press(container, 'b', 350, 350);
        fireEvent.mouseMove(outer, { clientX: 153, clientY: 350 });
        expect(guidesIn(container)).toBeTruthy();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(guidesIn(container)).toBeNull();
    });
    it('mouse leaving the canvas clears guides', () => {
        const { container, outer } = renderCanvas(scene(), layers, { selectedElementIds: ['b'], smartGuides: true });
        press(container, 'b', 350, 350);
        fireEvent.mouseMove(outer, { clientX: 153, clientY: 350 });
        fireEvent.mouseLeave(outer);
        expect(guidesIn(container)).toBeNull();
    });
    it('pull distance is 6 screen px at any zoom', () => {
        // scale 2: 6 px = 3 pt. b starts at page x 300; a's left edge is at 100.
        const run = (pageX: number) => {
            const { container, outer, onUpdateElements, unmount } = renderCanvas(scene(), layers, { selectedElementIds: ['b'], smartGuides: true, scale: 2 });
            press(container, 'b', 700, 700);
            fireEvent.mouseMove(outer, { clientX: 700 + (pageX - 300) * 2, clientY: 700 });
            const x = lastMoved(onUpdateElements, 'b').x; unmount(); return x;
        };
        expect(run(102.5)).toBe(100); // 2.5 pt = 5 px away: snaps
        expect(run(104)).toBe(104);   // 4 pt = 8 px away: free
    });
    it('snaps a multi-selection as one box', () => {
        const els = [...scene(), makeEl('c', { layerId: 'front', x: 420, y: 300, w: 50, h: 50 })];
        const { container, outer, onUpdateElements } = renderCanvas(els, layers, { selectedElementIds: ['b', 'c'], smartGuides: true });
        press(container, 'b', 350, 350);
        fireEvent.mouseMove(outer, { clientX: 153, clientY: 350 }); // union left 103 -> 100
        expect(lastMoved(onUpdateElements, 'b').x).toBe(100);
        expect(lastMoved(onUpdateElements, 'c').x).toBe(220);
    });
    it('a Ctrl-drag copy snaps to its original', () => {
        const els = [makeEl('a', { layerId: 'front', x: 0, y: 0 })];
        const { container, outer, onUpdateElements } = renderCanvas(els, layers, { smartGuides: true });
        press(container, 'a', 50, 50, { ctrlKey: true });
        fireEvent.mouseMove(outer, { clientX: 148, clientY: 50, ctrlKey: true }); // copy left 98 -> original right 100
        const moved: TemplateElement[] = onUpdateElements.mock.calls.at(-1)![0];
        expect(moved.find(e => e.id !== 'a')!.x).toBe(100);
        expect(moved.find(e => e.id === 'a')!.x).toBe(0);
    });
    it('draws the grid at the set size, thinned when zoomed out', () => {
        const near = renderCanvas([], layers, { showGrid: true, gridSize: 10, scale: 1 });
        expect(near.container.innerHTML).toContain('background-size: 10px 10px');
        near.unmount();
        const far = renderCanvas([], layers, { showGrid: true, gridSize: 10, scale: 0.5 });
        expect(far.container.innerHTML).toContain('background-size: 20px 20px');
    });
});
