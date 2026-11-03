import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { renderCanvas, makeEl, makeLayer } from './canvasTestUtils';
import type { CanvasInteraction } from '../../components/Canvas';
import type { TemplateElement } from '../../types';

// Minimal stand-in for the editor's CanvasInteraction: each capture supersedes the previous owner,
// whose later edits are dropped. `patches` keeps the updates the current owner accepted.
const makeOwnerStub = () => {
    let active: object | null = null;
    const patches: ReadonlyArray<{ readonly id: string; readonly patch: Partial<TemplateElement> }>[] = [];
    const capture = (): CanvasInteraction => {
        const token = {}; active = token;
        const isCurrent = () => active === token;
        return {
            isCurrent, start() {}, select() {},
            edit(intent) { if (isCurrent() && intent.type === 'patch') patches.push(intent.updates); },
            handoffToInline() { return isCurrent() ? capture() : undefined; },
            end() { if (isCurrent()) active = null; },
            cancel() { if (isCurrent()) active = null; },
        };
    };
    return { capture, patches };
};

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
    it('with Snap and guides on, a drag near the page centre lands on a grid line, not the off-grid centre', () => {
        // b (50 wide) centred on the page (250) would sit at x 225, off the 10 pt grid: the grid takes it to 220.
        const els = [makeEl('b', { layerId: 'front', x: 300, y: 300, w: 50 })];
        const { container, outer, onUpdateElements } = renderCanvas(els, layers, { selectedElementIds: ['b'], smartGuides: true, snapToGrid: true });
        press(container, 'b', 325, 350);
        fireEvent.mouseMove(outer, { clientX: 248, clientY: 350 }); // raw x 223, centre 248
        expect(lastMoved(onUpdateElements, 'b').x).toBe(220);
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
    it('a superseded owner mid-drag still clears guides on release, and the next drag snaps from its own start box', () => {
        const editor = makeOwnerStub();
        const { container, outer, rerenderWith } = renderCanvas(scene(), layers,
            { selectedElementIds: ['b'], smartGuides: true, captureInteraction: editor.capture, onEditElements: vi.fn() });
        press(container, 'b', 350, 350);
        fireEvent.mouseMove(outer, { clientX: 153, clientY: 350 });
        expect(guidesIn(container)).toBeTruthy();
        // The editor captures a new owner mid-drag (a panel edit, a shortcut, a context-menu pick):
        // the drag's owner is superseded, so its later moves and its release are ignored.
        editor.capture();
        fireEvent.mouseMove(outer, { clientX: 160, clientY: 350 });
        fireEvent.mouseUp(outer, { clientX: 160, clientY: 350 });
        expect(guidesIn(container)).toBeNull();
        // b now rests at 310. Moving 207 left puts its edge at 103 -> 100; a start box kept from the
        // first gesture (300) would put the box at 93, out of range, and leave x at 103.
        rerenderWith([makeEl('a', { layerId: 'back', x: 100 }), makeEl('b', { layerId: 'front', x: 310, y: 300 })]);
        press(container, 'b', 360, 350);
        fireEvent.mouseMove(outer, { clientX: 153, clientY: 350 });
        expect(editor.patches.at(-1)!.find(u => u.id === 'b')!.patch.x).toBe(100);
    });
    it('a drag whose release never arrived does not leak its start box or guides into the next press', () => {
        // A right-click on empty canvas mid-drag opens the native menu, and the browser swallows the
        // mouseup and mouseleave while it is open: the next press must start from its own geometry.
        const { container, outer, onUpdateElements, rerenderWith } = renderCanvas(scene(), layers, { selectedElementIds: ['b'], smartGuides: true });
        press(container, 'b', 350, 350);
        fireEvent.mouseMove(outer, { clientX: 153, clientY: 350 });
        expect(guidesIn(container)).toBeTruthy();
        rerenderWith([makeEl('a', { layerId: 'back', x: 100 }), makeEl('b', { layerId: 'front', x: 310, y: 300 })]);
        press(container, 'b', 360, 350);
        expect(guidesIn(container)).toBeNull();
        fireEvent.mouseMove(outer, { clientX: 153, clientY: 350 }); // 310 - 207 = 103 -> 100 from b's own start box
        expect(lastMoved(onUpdateElements, 'b').x).toBe(100);
    });
    it('a press the editor refuses still clears guides left by a swallowed release', () => {
        const editor = makeOwnerStub();
        let refuse = false;
        const { container, outer } = renderCanvas(scene(), layers, { selectedElementIds: ['b'], smartGuides: true,
            captureInteraction: () => (refuse ? undefined : editor.capture()), onEditElements: vi.fn() });
        press(container, 'b', 350, 350);
        fireEvent.mouseMove(outer, { clientX: 153, clientY: 350 });
        expect(guidesIn(container)).toBeTruthy();
        refuse = true;
        press(container, 'b', 350, 350); // the release never arrived; this press gets no interaction
        expect(guidesIn(container)).toBeNull();
    });
    it('moves that keep the same guides stop re-rendering the canvas', () => {
        const commits = vi.fn();
        const { container, outer } = renderCanvas(scene(), layers, { selectedElementIds: ['b'], smartGuides: true },
            canvas => <React.Profiler id="canvas" onRender={commits}>{canvas}</React.Profiler>);
        press(container, 'b', 350, 350);
        fireEvent.mouseMove(outer, { clientX: 153, clientY: 350 }); // b.x 103 -> 100: guides appear
        expect(guidesIn(container)).toBeTruthy();
        // 104 -> 100 draws the same guides, so the state keeps its array. React may still call the
        // component once after a real update before discarding an equal result, so the count is
        // taken after this move; every later unchanged move must then commit nothing.
        fireEvent.mouseMove(outer, { clientX: 154, clientY: 350 });
        const settled = commits.mock.calls.length;
        fireEvent.mouseMove(outer, { clientX: 155, clientY: 350 });
        fireEvent.mouseMove(outer, { clientX: 156, clientY: 350 });
        expect(commits.mock.calls.length).toBe(settled);
    });
    it('draws the grid at the set size, thinned when zoomed out', () => {
        const near = renderCanvas([], layers, { showGrid: true, gridSize: 10, scale: 1 });
        expect(near.container.innerHTML).toContain('background-size: 10px 10px');
        near.unmount();
        const far = renderCanvas([], layers, { showGrid: true, gridSize: 10, scale: 0.5 });
        expect(far.container.innerHTML).toContain('background-size: 20px 20px');
    });
});

// Handle drags snap only once the handle has moved past the 5 pt drag threshold (the wobble rule
// that move snapping follows), so each drag below moves 8 pt to land 3 pt from its target.
describe('canvas resize, line and drawing snapping', () => {
    const handle = (c: HTMLElement, h: string) => c.querySelector(`[data-resize-handle="${h}"]`)!;
    it('snaps a dragged edge to a nearby edge', () => {
        const els = [makeEl('a', { layerId: 'back', x: 205, y: 0, w: 100, h: 50 }), makeEl('b', { layerId: 'front', x: 200, y: 300 })];
        const { container, outer, onUpdateElements } = renderCanvas(els, layers, { selectedElementIds: ['b'], smartGuides: true });
        fireEvent.mouseDown(handle(container, 'e'), { clientX: 300, clientY: 350, button: 0 });
        fireEvent.mouseMove(outer, { clientX: 308, clientY: 350 }); // right 308 -> 305
        expect(lastMoved(onUpdateElements, 'b')).toMatchObject({ x: 200, w: 105 });
        expect(guidesIn(container)?.querySelector('line[data-guide-kind="align"]')).toBeTruthy();
    });
    it('a handle wobble below the drag threshold resizes raw and shows no guides', () => {
        const els = [makeEl('a', { layerId: 'back', x: 205, y: 0, w: 100, h: 50 }), makeEl('b', { layerId: 'front', x: 200, y: 300 })];
        const { container, outer, onUpdateElements } = renderCanvas(els, layers, { selectedElementIds: ['b'], smartGuides: true });
        fireEvent.mouseDown(handle(container, 'e'), { clientX: 300, clientY: 350, button: 0 });
        fireEvent.mouseMove(outer, { clientX: 303, clientY: 350 }); // 3 pt: inside the threshold
        expect(lastMoved(onUpdateElements, 'b').w).toBe(103);
        expect(guidesIn(container)).toBeNull();
        fireEvent.mouseMove(outer, { clientX: 308, clientY: 350 }); // past it: 308 -> 305
        expect(lastMoved(onUpdateElements, 'b').w).toBe(105);
    });
    it('Alt held during a handle drag resizes raw and hides guides', () => {
        const els = [makeEl('a', { layerId: 'back', x: 205, y: 0, w: 100, h: 50 }), makeEl('b', { layerId: 'front', x: 200, y: 300 })];
        const { container, outer, onUpdateElements } = renderCanvas(els, layers, { selectedElementIds: ['b'], smartGuides: true, snapToGrid: true });
        fireEvent.mouseDown(handle(container, 'e'), { clientX: 300, clientY: 350, button: 0 });
        fireEvent.mouseMove(outer, { clientX: 308, clientY: 350, altKey: true });
        expect(lastMoved(onUpdateElements, 'b').w).toBe(108);
        expect(guidesIn(container)).toBeNull();
    });
    it('a group resize snaps the group box edge and scales its members', () => {
        // Group b + c = 200..300 x 300..400; its right edge dragged to 308 lands on a's right edge (305).
        const els = [makeEl('a', { layerId: 'back', x: 205, y: 0, w: 100, h: 50 }), makeEl('b', { layerId: 'front', x: 200, y: 300 }),
            makeEl('c', { layerId: 'front', x: 220, y: 320, w: 40, h: 20 })];
        const { container, outer, onUpdateElements } = renderCanvas(els, layers, { selectedElementIds: ['b', 'c'], smartGuides: true });
        fireEvent.mouseDown(handle(container, 'e'), { clientX: 300, clientY: 350, button: 0 });
        fireEvent.mouseMove(outer, { clientX: 308, clientY: 350 });
        expect(lastMoved(onUpdateElements, 'b')).toMatchObject({ x: 200, w: 105 });
        expect(lastMoved(onUpdateElements, 'c').w).toBeCloseTo(42);
        expect(guidesIn(container)?.querySelector('line[data-guide-kind="align"]')).toBeTruthy();
    });
    it('matches another object\'s width', () => {
        const els = [makeEl('a', { layerId: 'back', x: 0, y: 500, w: 120, h: 40 }), makeEl('b', { layerId: 'front', x: 200, y: 300 })];
        const { container, outer, onUpdateElements } = renderCanvas(els, layers, { selectedElementIds: ['b'], smartGuides: true });
        fireEvent.mouseDown(handle(container, 'e'), { clientX: 300, clientY: 350, button: 0 });
        fireEvent.mouseMove(outer, { clientX: 317, clientY: 350 });
        expect(lastMoved(onUpdateElements, 'b').w).toBe(120);
        expect(container.querySelector('[data-guide-label]')?.textContent).toBe('= 120');
    });
    it('snaps a quarter-turned element through its rotated edges', () => {
        // b: 100x40 rotated 90 -> world box x 230..270, y 270..370. a's top edge at y=375.
        const els = [makeEl('a', { layerId: 'back', x: 0, y: 375, w: 50, h: 50 }),
            makeEl('b', { layerId: 'front', x: 200, y: 300, w: 100, h: 40, rotation: 90 })];
        const { container, outer, onUpdateElements } = renderCanvas(els, layers, { selectedElementIds: ['b'], smartGuides: true });
        fireEvent.mouseDown(handle(container, 'e'), { clientX: 250, clientY: 370, button: 0 });
        fireEvent.mouseMove(outer, { clientX: 250, clientY: 378 }); // local width 108 -> 105 (world bottom 378 -> 375)
        expect(lastMoved(onUpdateElements, 'b').w).toBeCloseTo(105);
        expect(guidesIn(container)?.querySelector('line[data-guide-kind="align"]')).toBeTruthy();
    });
    it('leaves other rotations to the old grid behaviour, with no guides', () => {
        const els = [makeEl('a', { layerId: 'back', x: 205, y: 0, w: 100, h: 50 }), makeEl('b', { layerId: 'front', x: 200, y: 300, rotation: 30 })];
        const { container, outer, onUpdateElements } = renderCanvas(els, layers, { selectedElementIds: ['b'], smartGuides: true });
        fireEvent.mouseDown(handle(container, 'e'), { clientX: 300, clientY: 350, button: 0 });
        fireEvent.mouseMove(outer, { clientX: 303, clientY: 350 });
        expect(container.querySelector('[data-testid="snap-guides"]')).toBeNull();
    });
    it('snaps a dragged line end as a point', () => {
        const els = [makeEl('a', { layerId: 'back', x: 305, y: 0, w: 50, h: 50 }),
            makeEl('l', { layerId: 'front', type: 'line', x: 100, y: 200, w: 100, h: 0 })];
        const { container, outer, onUpdateElements } = renderCanvas(els, layers, { selectedElementIds: ['l'], smartGuides: true });
        fireEvent.mouseDown(handle(container, 'end'), { clientX: 200, clientY: 200, button: 0 });
        fireEvent.mouseMove(outer, { clientX: 302, clientY: 200 }); // end x 302 -> 305
        const line = lastMoved(onUpdateElements, 'l');
        expect(line.x + line.w).toBeCloseTo(305);
    });
    it('snaps a new shape\'s corners while drawing', () => {
        const els = [makeEl('a', { layerId: 'back', x: 100, y: 100, w: 100, h: 100 })];
        const { container, outer, onUpdateElements } = renderCanvas(els, layers, { tool: 'rect', smartGuides: true });
        fireEvent.mouseDown(outer, { clientX: 103, clientY: 300, button: 0 });
        fireEvent.mouseMove(outer, { clientX: 198, clientY: 400 });
        fireEvent.mouseUp(outer, { clientX: 198, clientY: 400 });
        const created = (onUpdateElements.mock.calls.at(-1)![0] as TemplateElement[]).find(e => e.id !== 'a')!;
        expect(created).toMatchObject({ x: 100, w: 100 });
    });
    it('a Shift-constrained drag snaps its start and the dominant axis of its end', () => {
        const els = [makeEl('a', { layerId: 'back', x: 100, y: 100, w: 100, h: 100 })];
        const { outer, onUpdateElements } = renderCanvas(els, layers, { tool: 'rect', smartGuides: true });
        fireEvent.mouseDown(outer, { clientX: 103, clientY: 300, button: 0 });
        fireEvent.mouseMove(outer, { clientX: 198, clientY: 380, shiftKey: true }); // start 103 -> 100; x 198 -> 200 leads
        fireEvent.mouseUp(outer, { clientX: 198, clientY: 380, shiftKey: true });
        const created = (onUpdateElements.mock.calls.at(-1)![0] as TemplateElement[]).find(e => e.id !== 'a')!;
        expect(created).toMatchObject({ x: 100, y: 300, w: 100, h: 100 });
    });
    // Two targets 10 pt apart (a's right edge at 100, c's left at 110): a snapped press lands on 100
    // and a 3 pt wobble on 110, a 10 x 1 sliver if the tap were judged on the snapped corners.
    const twoTargets = () => [makeEl('a', { layerId: 'back', x: 0, y: 0 }), makeEl('c', { layerId: 'back', x: 110, y: 0 })];
    it('a click with the rect tool beside two targets is a click: no sliver, no targets, no guides', () => {
        const { container, outer, onUpdateElements } = renderCanvas(twoTargets(), layers, { tool: 'rect', smartGuides: true });
        fireEvent.mouseDown(outer, { clientX: 104, clientY: 300, button: 0 });
        fireEvent.mouseMove(outer, { clientX: 107, clientY: 301 });
        expect(guidesIn(container)).toBeNull();
        fireEvent.mouseUp(outer, { clientX: 107, clientY: 301 });
        expect(onUpdateElements).not.toHaveBeenCalled();
    });
    // A click builds no targets, so guides never move it; only the grid does, when Snap is on.
    const textClick = (extra: Record<string, unknown>, x: number, y: number, mods = {}) => {
        const { outer, onUpdateElements } = renderCanvas(twoTargets(), layers, { tool: 'text', smartGuides: true, ...extra });
        fireEvent.mouseDown(outer, { clientX: x, clientY: y, button: 0, ...mods });
        fireEvent.mouseUp(outer, { clientX: x, clientY: y, ...mods });
        return (onUpdateElements.mock.calls.at(-1)![0] as TemplateElement[]).find(e => e.type === 'text')!;
    };
    it('a click with the text tool places the text box at the raw click point with Snap off', () => {
        expect(textClick({}, 104, 300)).toMatchObject({ x: 104, y: 300 });
    });
    it('a click with the text tool lands on the grid with Snap on', () => {
        expect(textClick({ snapToGrid: true }, 103, 107)).toMatchObject({ x: 100, y: 110 });
    });
    it('an Alt-click with the text tool stays raw with Snap on', () => {
        expect(textClick({ snapToGrid: true }, 103, 107, { altKey: true })).toMatchObject({ x: 103, y: 107 });
    });
    it('a release exactly at the drag threshold is still a click, not a sliver', () => {
        const { outer, onUpdateElements } = renderCanvas(twoTargets(), layers, { tool: 'rect', smartGuides: true });
        fireEvent.mouseDown(outer, { clientX: 100, clientY: 300, button: 0 });
        fireEvent.mouseMove(outer, { clientX: 105, clientY: 300 }); // 5 pt: the threshold itself
        fireEvent.mouseUp(outer, { clientX: 105, clientY: 300 });
        expect(onUpdateElements).not.toHaveBeenCalled();
    });
});
