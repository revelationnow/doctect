import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Canvas, CANVAS_CONTENT_ATTR, type CanvasInteraction } from '../../components/Canvas';
import type { EditorElementIntent } from '../../services/document/contracts';
import type { PageTemplate, TemplateElement } from '../../types';

const pointer = (target: Element, type: string, id: number, x: number, y: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperties(event, { pointerId: { value: id }, pointerType: { value: 'touch' } });
    act(() => { target.dispatchEvent(event); });
    return event;
};

const trackScroll = (el: HTMLElement, left = 0, top = 0) => {
    const pos = { left, top };
    Object.defineProperty(el, 'scrollLeft', { configurable: true, get: () => pos.left, set: v => { pos.left = v; } });
    Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => pos.top, set: v => { pos.top = v; } });
    return pos;
};

const rect = (id: string, x: number, y: number): TemplateElement => ({
    id, type: 'rect', x, y, w: 100, h: 60, rotation: 0, layerId: 'l1',
    fill: '#eeeeee', stroke: '#000000', strokeWidth: 1, opacity: 1, zIndex: 1,
});
const textElement = (id: string, x: number, y: number): TemplateElement => ({
    id, type: 'text', x, y, w: 200, h: 40, rotation: 0, layerId: 'l1',
    fill: '', stroke: '', strokeWidth: 0, opacity: 1, text: 'Hello', fontSize: 16,
    fontFamily: 'helvetica', textOverflow: 'clip', textWrap: true,
});
const tap = (target: Element, id: number, x: number, y: number) => {
    pointer(target, 'pointerdown', id, x, y);
    pointer(target, 'pointerup', id, x, y);
};
const doubleTap = (target: Element, x: number, y: number) => { tap(target, 1, x, y); tap(target, 2, x, y); };
const inlineEditor = (container: HTMLElement) => container.querySelector('[contenteditable="true"]');
// A tap on a `data-touch-gesture-ignore` subtree is left to the browser, which then emits the
// compatibility mouse events the canvas's mouse handlers see.
const compatClick = (target: Element, x = 0, y = 0) => {
    fireEvent.mouseDown(target, { clientX: x, clientY: y, button: 0 });
    fireEvent.mouseUp(target, { clientX: x, clientY: y, button: 0 });
    fireEvent.click(target, { clientX: x, clientY: y, button: 0 });
};

const template: PageTemplate = {
    id: 'page', name: 'Page', width: 500, height: 700,
    layers: [{ id: 'l1', name: 'Layer 1', order: 0, visible: true, locked: false }],
    elements: [],
};

const renderCanvas = (overrides: Partial<React.ComponentProps<typeof Canvas>> = {}) => {
    const props = {
        template, elements: [rect('a', 20, 20), rect('b', 200, 200)], selectedElementIds: [] as string[],
        scale: 1, tool: 'select', nodes: {}, currentNodeId: 'root', snapToGrid: false, showGrid: false,
        onUpdateElements: vi.fn(), onSelectElements: vi.fn(), onZoom: vi.fn(), onInteractionStart: vi.fn(),
        onSwitchToSelect: vi.fn(), activeLayerId: 'l1', inputMode: 'touch' as const,
        ...overrides,
    };
    const utils = render(<Canvas {...props} />);
    const surface = utils.container.querySelector('.canvas-scroll-container') as HTMLElement;
    const elementNode = (id: string) => utils.container.querySelector(`[data-element-id="${id}"]`) as HTMLElement;
    return { ...utils, props, surface, elementNode };
};

// Zone rectangles in canvas px, relative to the selection overlay, from the rendered inline styles:
// centre = (left% of the overlay + marginLeft, top% + marginTop); the zone is translate(-50%, -50%).
const zoneRects = (container: HTMLElement, w: number, h: number) =>
    Array.from(container.querySelectorAll<HTMLElement>('[data-resize-handle]')).map(zone => {
        const { left, top, marginLeft, marginTop, width, height } = zone.style;
        const cx = parseFloat(left) / 100 * w + (parseFloat(marginLeft) || 0);
        const cy = parseFloat(top) / 100 * h + (parseFloat(marginTop) || 0);
        const hw = parseFloat(width) / 2, hh = parseFloat(height) / 2;
        return { handle: zone.dataset.resizeHandle!, x1: cx - hw, y1: cy - hh, x2: cx + hw, y2: cy + hh, w: parseFloat(width) };
    });
const covers = (r: { x1: number; y1: number; x2: number; y2: number }, x: number, y: number) =>
    x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2;

// Minimal stand-in for the incremental editor's CanvasInteraction (see createInteraction in
// ProjectEditor): each capture invalidates the previous owner; edits land in a working copy that
// end() commits and cancel() discards.
const makeEditorStub = (initial: TemplateElement[]) => {
    let committed = initial;
    let working = initial;
    let active: object | null = null;
    const calls = { start: 0, end: 0, cancel: 0, selects: [] as string[][], intents: [] as EditorElementIntent[] };
    const capture = (): CanvasInteraction => {
        const token = {};
        active = token;
        const isCurrent = () => active === token;
        const owner: CanvasInteraction = {
            isCurrent,
            start() { if (isCurrent()) calls.start++; },
            edit(intent) {
                if (!isCurrent()) return;
                calls.intents.push(intent);
                if (intent.type === 'patch') {
                    working = working.map(el => {
                        const update = intent.updates.find(u => u.id === el.id);
                        return update ? { ...el, ...update.patch } : el;
                    });
                }
            },
            select(ids) { if (isCurrent()) calls.selects.push(ids); },
            handoffToInline() { return isCurrent() ? capture() : undefined; },
            end() { if (!isCurrent()) return; active = null; calls.end++; committed = working; },
            cancel() { if (!isCurrent()) return; active = null; calls.cancel++; working = committed; },
        };
        return owner;
    };
    return { capture, calls, committed: () => committed, working: () => working };
};
const find = (elements: TemplateElement[], id: string) => elements.find(el => el.id === id)!;

afterEach(() => vi.restoreAllMocks());

describe('Canvas touch mode', () => {
    it('selects the tapped element without starting a drag', () => {
        const { props, elementNode } = renderCanvas();
        pointer(elementNode('b'), 'pointerdown', 1, 210, 210);
        pointer(elementNode('b'), 'pointerup', 1, 210, 210);
        expect(props.onSelectElements).toHaveBeenLastCalledWith(['b']);
        expect(props.onUpdateElements).not.toHaveBeenCalled();
    });

    it('clears the selection when empty canvas is tapped', () => {
        const { props, surface } = renderCanvas({ selectedElementIds: ['a'] });
        pointer(surface, 'pointerdown', 1, 450, 650);
        pointer(surface, 'pointerup', 1, 450, 650);
        expect(props.onSelectElements).toHaveBeenLastCalledWith([]);
    });

    it('moves the selected element with a one-finger drag, saving history once', () => {
        const { props, elementNode } = renderCanvas({ selectedElementIds: ['a'] });
        pointer(elementNode('a'), 'pointerdown', 1, 30, 30);
        pointer(elementNode('a'), 'pointermove', 1, 60, 50);
        pointer(elementNode('a'), 'pointerup', 1, 60, 50);
        const moved = vi.mocked(props.onUpdateElements).mock.calls.at(-1)![0].find((el: TemplateElement) => el.id === 'a');
        expect(moved).toMatchObject({ x: 50, y: 40 });
        expect(props.onInteractionStart).toHaveBeenCalledTimes(1);
    });

    it('pans instead of moving when dragging an unselected element', () => {
        const { props, surface, elementNode } = renderCanvas({ selectedElementIds: ['a'] });
        trackScroll(surface, 100, 0);
        pointer(elementNode('b'), 'pointerdown', 1, 210, 210);
        pointer(elementNode('b'), 'pointermove', 1, 180, 210);
        pointer(elementNode('b'), 'pointerup', 1, 180, 210);
        expect(props.onUpdateElements).not.toHaveBeenCalled();
        expect(surface.scrollLeft).toBe(130);
    });

    it('resizes through an enlarged touch handle', () => {
        const { props, container } = renderCanvas({ selectedElementIds: ['a'] });
        const handle = container.querySelector('[data-resize-handle="se"]') as HTMLElement;
        expect(handle.style.width).toBe('44px');
        expect(container.querySelector('[data-rotate-handle]')).toBeNull();
        expect(container.querySelector('[data-pivot-handle]')).toBeNull();
        pointer(handle, 'pointerdown', 1, 120, 80);
        pointer(handle, 'pointermove', 1, 150, 100);
        pointer(handle, 'pointerup', 1, 150, 100);
        const resized = vi.mocked(props.onUpdateElements).mock.calls.at(-1)![0].find((el: TemplateElement) => el.id === 'a');
        expect(resized.w).toBeGreaterThan(100);
        expect(resized.h).toBeGreaterThan(60);
    });

    it('does not select on a hand-tool tap, matching desktop hand-tool clicks', () => {
        const { props, elementNode } = renderCanvas({ tool: 'hand' });
        pointer(elementNode('b'), 'pointerdown', 1, 210, 210);
        pointer(elementNode('b'), 'pointerup', 1, 210, 210);
        expect(props.onSelectElements).not.toHaveBeenCalled();
    });

    it('outsets touch zones so the centre of a 100x60 element at scale 0.7 is free to move, with no mid-edge zones', () => {
        const { container } = renderCanvas({ selectedElementIds: ['a'], scale: 0.7 });
        const rects = zoneRects(container, 100, 60);
        expect(rects.map(r => r.handle).sort()).toEqual(['ne', 'nw', 'se', 'sw']);
        rects.forEach(r => expect(r.w * 0.7).toBeCloseTo(44, 6)); // 44 screen px at this scale
        expect(rects.some(r => covers(r, 50, 30))).toBe(false);
        // Each corner zone's centre sits 14 screen px (20 canvas px) outside the box diagonally.
        const se = rects.find(r => r.handle === 'se')!;
        expect((se.x1 + se.x2) / 2).toBeCloseTo(120, 6);
        expect((se.y1 + se.y2) / 2).toBeCloseTo(80, 6);
    });

    it('adds mid-edge zones once an edge is at least 132 screen px long', () => {
        const big = { ...rect('a', 20, 20), w: 300, h: 200 };
        const { container } = renderCanvas({ selectedElementIds: ['a'], elements: [big, rect('b', 400, 400)], scale: 1 });
        const rects = zoneRects(container, 300, 200);
        expect(rects.map(r => r.handle).sort()).toEqual(['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);
        const n = rects.find(r => r.handle === 'n')!;
        expect((n.x1 + n.x2) / 2).toBeCloseTo(150, 6);
        expect((n.y1 + n.y2) / 2).toBeCloseTo(-14, 6);
        expect(rects.some(r => covers(r, 150, 100))).toBe(false);
    });

    it('moves through the captured interaction on the incremental path and ends it exactly once', () => {
        const editor = makeEditorStub([rect('a', 20, 20), rect('b', 200, 200)]);
        const { props, elementNode } = renderCanvas({
            selectedElementIds: ['a'], captureInteraction: editor.capture, onEditElements: vi.fn(),
        });
        pointer(elementNode('a'), 'pointerdown', 1, 30, 30);
        pointer(elementNode('a'), 'pointermove', 1, 60, 50);
        pointer(elementNode('a'), 'pointerup', 1, 60, 50);
        expect(editor.calls.intents).toContainEqual({ type: 'patch', updates: [{ id: 'a', patch: { x: 50, y: 40 } }] });
        expect(find(editor.committed(), 'a')).toMatchObject({ x: 50, y: 40 });
        expect(editor.calls).toMatchObject({ start: 1, end: 1, cancel: 0 });
        expect(props.onUpdateElements).not.toHaveBeenCalled();
        expect(props.onEditElements).not.toHaveBeenCalled();
    });

    it('selects a tapped element through a captured interaction on the incremental path', () => {
        const editor = makeEditorStub([rect('a', 20, 20), rect('b', 200, 200)]);
        const { props, elementNode } = renderCanvas({ captureInteraction: editor.capture, onEditElements: vi.fn() });
        pointer(elementNode('b'), 'pointerdown', 1, 210, 210);
        pointer(elementNode('b'), 'pointerup', 1, 210, 210);
        expect(editor.calls.selects).toEqual([['b']]);
        expect(editor.calls.end).toBe(1);
        expect(props.onSelectElements).not.toHaveBeenCalled();
    });

    it('reverts a touch drag on pointercancel without committing', () => {
        const editor = makeEditorStub([rect('a', 20, 20), rect('b', 200, 200)]);
        const { elementNode, surface } = renderCanvas({
            selectedElementIds: ['a'], captureInteraction: editor.capture, onEditElements: vi.fn(),
        });
        pointer(elementNode('a'), 'pointerdown', 1, 30, 30);
        pointer(elementNode('a'), 'pointermove', 1, 60, 50);
        expect(find(editor.working(), 'a')).toMatchObject({ x: 50, y: 40 });
        pointer(surface, 'pointercancel', 1, 60, 50);
        expect(find(editor.working(), 'a')).toMatchObject({ x: 20, y: 20 });
        expect(find(editor.committed(), 'a')).toMatchObject({ x: 20, y: 20 });
        expect(editor.calls).toMatchObject({ end: 0, cancel: 1 });
    });

    it('reverts a touch drag when a second finger lands', () => {
        const editor = makeEditorStub([rect('a', 20, 20), rect('b', 200, 200)]);
        const { elementNode, surface } = renderCanvas({
            selectedElementIds: ['a'], captureInteraction: editor.capture, onEditElements: vi.fn(),
        });
        pointer(elementNode('a'), 'pointerdown', 1, 30, 30);
        pointer(elementNode('a'), 'pointermove', 1, 60, 50);
        pointer(surface, 'pointerdown', 2, 300, 300);
        expect(find(editor.working(), 'a')).toMatchObject({ x: 20, y: 20 });
        expect(editor.calls).toMatchObject({ end: 0, cancel: 1 });
    });

    it('cancels a legacy-path touch drag exactly once on pointercancel', () => {
        const { props, elementNode, surface } = renderCanvas({ selectedElementIds: ['a'], onInteractionCancel: vi.fn() });
        pointer(elementNode('a'), 'pointerdown', 1, 30, 30);
        pointer(elementNode('a'), 'pointermove', 1, 60, 50);
        pointer(surface, 'pointercancel', 1, 60, 50);
        expect(props.onInteractionCancel).toHaveBeenCalledTimes(1);
        expect(vi.mocked(props.onUpdateElements).mock.calls.every(call => call[1] !== true)).toBe(true);
    });

    it('sets touch-action none on the viewport in touch mode', () => {
        const { surface } = renderCanvas();
        expect(surface.style.touchAction).toBe('none');
    });

    it('keeps desktop handles and mouse behaviour in mouse mode', () => {
        const { container } = renderCanvas({ inputMode: 'mouse', selectedElementIds: ['a'] });
        expect(container.querySelector('[data-rotate-handle]')).not.toBeNull();
        // jsdom's cssstyle has no touch-action property, so an unset value reads undefined rather than ''.
        expect((container.querySelector('.canvas-scroll-container') as HTMLElement).style.touchAction).toBeFalsy();
    });
});

describe('Canvas touch creation and gestures', () => {
    afterEach(() => vi.useRealTimers());

    it('creates a default-size rect when tapping with the rect tool', () => {
        const { props, surface } = renderCanvas({ tool: 'rect', elements: [] });
        pointer(surface, 'pointerdown', 1, 300, 400);
        pointer(surface, 'pointerup', 1, 300, 400);
        const created = vi.mocked(props.onUpdateElements).mock.calls.at(-1)![0][0];
        expect(created).toMatchObject({ type: 'rect', x: 300, y: 400, w: 120, h: 80 });
    });

    it('draws a text box by dragging with the text tool', () => {
        const { props, surface } = renderCanvas({ tool: 'text', elements: [] });
        pointer(surface, 'pointerdown', 1, 100, 100);
        pointer(surface, 'pointermove', 1, 260, 140);
        pointer(surface, 'pointerup', 1, 260, 140);
        expect(vi.mocked(props.onUpdateElements).mock.calls.at(-1)![0][0]).toMatchObject({ type: 'text', w: 160, h: 40 });
    });

    it('starts inline editing on double tap of a text element', () => {
        const text: TemplateElement = {
            id: 't', type: 'text', x: 20, y: 20, w: 200, h: 40, rotation: 0, layerId: 'l1',
            fill: '', stroke: '', strokeWidth: 0, opacity: 1, text: 'Hello', fontSize: 16,
            fontFamily: 'helvetica', textOverflow: 'clip', textWrap: true,
        };
        const { container, elementNode } = renderCanvas({ elements: [text] });
        for (let i = 0; i < 2; i++) {
            pointer(elementNode('t'), 'pointerdown', i + 1, 40, 30);
            pointer(elementNode('t'), 'pointerup', i + 1, 40, 30);
        }
        expect(container.querySelector('[contenteditable="true"]')).not.toBeNull();
    });

    it('opens the select-under menu on long press over stacked elements', () => {
        vi.useFakeTimers();
        const { elementNode, getByTestId, surface } = renderCanvas({ elements: [rect('a', 20, 20), rect('c', 40, 30)] });
        pointer(elementNode('c'), 'pointerdown', 1, 60, 50);
        act(() => { vi.advanceTimersByTime(600); });
        const menu = getByTestId('select-under-menu');
        expect(menu).toBeTruthy();
        // The menu is the scroll container's child beside the page's content wrapper, not inside it;
        // only the wrapper carries the mark the phone CSS pads for the tool pill.
        expect(menu.parentElement).toBe(surface);
        expect(menu.hasAttribute(CANVAS_CONTENT_ATTR)).toBe(false);
        expect(surface.querySelector(`:scope > [${CANVAS_CONTENT_ATTR}] [data-testid="editor-canvas"]`)).not.toBeNull();
        vi.useRealTimers();
    });

    it('zooms around the pinch centre via onZoom', () => {
        const { props, surface } = renderCanvas({ scale: 1 });
        pointer(surface, 'pointerdown', 1, 100, 100);
        pointer(surface, 'pointerdown', 2, 200, 100);
        pointer(surface, 'pointermove', 2, 300, 100);
        expect(props.onZoom).toHaveBeenLastCalledWith(2);
    });

    it('fits the page width when fitSignal changes', () => {
        const { props, surface, rerender } = renderCanvas({ fitSignal: 1 });
        Object.defineProperty(surface, 'clientWidth', { configurable: true, value: 532 });
        rerender(<Canvas {...props} fitSignal={2} />);
        expect(props.onZoom).toHaveBeenLastCalledWith((532 - 2 * 16) / 500);
    });

    it('appends a default-size rect through the captured interaction on a tap (incremental path)', () => {
        const editor = makeEditorStub([]);
        const { props, surface } = renderCanvas({ tool: 'rect', elements: [], captureInteraction: editor.capture, onEditElements: vi.fn() });
        tap(surface, 1, 300, 400);
        const append = editor.calls.intents.find(intent => intent.type === 'append');
        expect(append).toMatchObject({ type: 'append', elements: [expect.objectContaining({ type: 'rect', x: 300, y: 400, w: 120, h: 80 })] });
        if (append?.type === 'append') expect(append.selectedElementIds).toEqual([append.elements[0].id]);
        expect(editor.calls).toMatchObject({ start: 1, end: 1, cancel: 0 });
        expect(props.onUpdateElements).not.toHaveBeenCalled();
        expect(props.onEditElements).not.toHaveBeenCalled();
    });

    it('leaves native dblclick and contextmenu to the gesture hook in touch mode', () => {
        const elements = [textElement('t', 20, 20), rect('a', 300, 300), rect('c', 320, 310)];
        const { container, elementNode, surface, queryByTestId } = renderCanvas({ elements });
        fireEvent.doubleClick(elementNode('t'), { clientX: 40, clientY: 30 });
        expect(inlineEditor(container)).toBeNull();
        // Suppressed native menu (default prevented), but no select-under menu from this path.
        expect(fireEvent.contextMenu(surface, { clientX: 330, clientY: 320 })).toBe(false);
        expect(queryByTestId('select-under-menu')).toBeNull();
    });

    it('keeps native double-click editing and the right-click menu in mouse mode', () => {
        const elements = [textElement('t', 20, 20), rect('a', 300, 300), rect('c', 320, 310)];
        const { container, elementNode, surface, getByTestId } = renderCanvas({ inputMode: 'mouse', elements });
        expect(fireEvent.contextMenu(surface, { clientX: 330, clientY: 320 })).toBe(false);
        expect(getByTestId('select-under-menu')).toBeTruthy();
        fireEvent.doubleClick(elementNode('t'), { clientX: 40, clientY: 30 });
        expect(inlineEditor(container)).not.toBeNull();
    });

    it('keeps editing when tapping inside the inline editor', () => {
        const { container, elementNode, props } = renderCanvas({ elements: [textElement('t', 20, 20)] });
        doubleTap(elementNode('t'), 40, 30);
        const editable = inlineEditor(container)!;
        expect(document.activeElement).toBe(editable);
        const selects = vi.mocked(props.onSelectElements).mock.calls.length;
        tap(editable, 3, 60, 30);
        compatClick(editable, 60, 30);
        expect(inlineEditor(container)).toBe(editable);
        expect(document.activeElement).toBe(editable);
        expect(props.onSelectElements).toHaveBeenCalledTimes(selects);
    });

    it('commits the inline edit when tapping outside the editor', () => {
        const { container, elementNode, surface, props } = renderCanvas({ elements: [textElement('t', 20, 20)] });
        doubleTap(elementNode('t'), 40, 30);
        expect(inlineEditor(container)).not.toBeNull();
        tap(surface, 3, 450, 650);
        expect(inlineEditor(container)).toBeNull();
        expect(props.onSelectElements).toHaveBeenLastCalledWith([]);
    });

    it('double-tap selects through the captured interaction and hands editing off to it (incremental path)', () => {
        const elements = [textElement('t', 20, 20), rect('b', 300, 300)];
        const editor = makeEditorStub(elements);
        const { container, elementNode, surface, props } = renderCanvas({ elements, captureInteraction: editor.capture, onEditElements: vi.fn() });
        doubleTap(elementNode('t'), 40, 30);
        expect(inlineEditor(container)).not.toBeNull();
        expect(editor.calls.selects).toEqual([['t'], ['t']]);
        // The inline session owns the current interaction: a tap outside ends it, then the tap's own select/end runs.
        tap(surface, 3, 450, 650);
        expect(inlineEditor(container)).toBeNull();
        expect(editor.calls.selects).toEqual([['t'], ['t'], []]);
        expect(editor.calls).toMatchObject({ end: 3, cancel: 0 });
        expect(props.onSelectElements).not.toHaveBeenCalled();
    });

    it('selects a menu row after a long press through a captured interaction (incremental path)', () => {
        vi.useFakeTimers();
        const elements = [rect('a', 20, 20), rect('c', 40, 30)];
        const editor = makeEditorStub(elements);
        const { elementNode, getByTestId, queryByTestId, props } = renderCanvas({ elements, captureInteraction: editor.capture, onEditElements: vi.fn() });
        pointer(elementNode('c'), 'pointerdown', 1, 60, 50);
        act(() => { vi.advanceTimersByTime(600); });
        pointer(elementNode('c'), 'pointerup', 1, 60, 50); // release after a long press is inert
        const row = getByTestId('select-under-menu').querySelector('[data-menu-element-id="a"]')!;
        compatClick(row, 70, 60);
        expect(editor.calls.selects).toEqual([['a']]);
        expect(queryByTestId('select-under-menu')).toBeNull();
        expect(props.onSelectElements).not.toHaveBeenCalled();
    });

    it('selects a menu row after a real right-click sequence on the incremental path (mouse mode)', () => {
        const elements = [rect('a', 20, 20), rect('c', 40, 30)];
        const editor = makeEditorStub(elements);
        const { elementNode, getByTestId } = renderCanvas({ inputMode: 'mouse', elements, captureInteraction: editor.capture, onEditElements: vi.fn() });
        const target = elementNode('c');
        fireEvent.mouseDown(target, { clientX: 60, clientY: 50, button: 2 });
        fireEvent.contextMenu(target, { clientX: 60, clientY: 50 });
        fireEvent.mouseUp(target, { clientX: 60, clientY: 50, button: 2 });
        compatClick(getByTestId('select-under-menu').querySelector('[data-menu-element-id="a"]')!, 70, 60);
        expect(editor.calls.selects.at(-1)).toEqual(['a']);
    });

    it('keeps the ctrl+wheel zoom maths in mouse mode', () => {
        const { props, surface } = renderCanvas({ inputMode: 'mouse', scale: 1 });
        const lastZoom = () => vi.mocked(props.onZoom).mock.calls.at(-1)![0];
        fireEvent.wheel(surface, { ctrlKey: true, deltaY: -100, clientX: 10, clientY: 20 });
        expect(lastZoom()).toBeCloseTo(1.2, 12);
        fireEvent.wheel(surface, { metaKey: true, deltaY: 100 });
        expect(lastZoom()).toBeCloseTo(0.8, 12);
        fireEvent.wheel(surface, { ctrlKey: true, deltaY: -100000 });
        expect(lastZoom()).toBe(10);
        fireEvent.wheel(surface, { ctrlKey: true, deltaY: 100000 });
        expect(lastZoom()).toBe(0.2);
        vi.mocked(props.onZoom).mockClear();
        fireEvent.wheel(surface, { ctrlKey: true, deltaY: -0.4 }); // within the 0.001 dead band
        fireEvent.wheel(surface, { deltaY: -100 });               // no modifier: plain scroll
        expect(props.onZoom).not.toHaveBeenCalled();
    });
});

describe('Canvas touch mode: inline edit commit, no tap-cycling, long-press on the selection, pinch scroll', () => {
    afterEach(() => vi.useRealTimers());

    it('commits an open inline edit when a direct touch begins on a resize handle', () => {
        const elements = [textElement('t', 20, 20), rect('b', 300, 300)];
        const editor = makeEditorStub(elements);
        const { container, elementNode } = renderCanvas({
            elements, selectedElementIds: ['t'], captureInteraction: editor.capture, onEditElements: vi.fn(),
        });
        doubleTap(elementNode('t'), 40, 30);
        expect(inlineEditor(container)).not.toBeNull();
        const ends = editor.calls.end;
        const handle = container.querySelector('[data-resize-handle="se"]') as HTMLElement;
        pointer(handle, 'pointerdown', 3, 234, 74);
        expect(inlineEditor(container)).toBeNull();
        expect(editor.calls.end).toBe(ends + 1);
        pointer(handle, 'pointerup', 3, 234, 74);
        expect(editor.calls.intents.filter(intent => intent.type === 'patch')).toEqual([]);
    });

    it('commits an open inline edit when a long press begins elsewhere', () => {
        vi.useFakeTimers();
        const elements = [textElement('t', 20, 20), rect('a', 300, 300), rect('c', 320, 310)];
        const editor = makeEditorStub(elements);
        const { container, elementNode, getByTestId } = renderCanvas({ elements, captureInteraction: editor.capture, onEditElements: vi.fn() });
        doubleTap(elementNode('t'), 40, 30);
        expect(inlineEditor(container)).not.toBeNull();
        const ends = editor.calls.end;
        pointer(elementNode('c'), 'pointerdown', 3, 330, 320);
        act(() => { vi.advanceTimersByTime(600); });
        expect(inlineEditor(container)).toBeNull();
        expect(editor.calls.end).toBe(ends + 1);
        expect(getByTestId('select-under-menu')).toBeTruthy();
    });

    it('double-tap edits an already-selected text over another element without tap-cycling the selection', () => {
        const elements = [{ ...textElement('t', 20, 20), zIndex: 2 }, rect('a', 20, 20)];
        const { container, elementNode, props } = renderCanvas({ elements, selectedElementIds: ['t'] });
        doubleTap(elementNode('t'), 40, 30);
        expect(inlineEditor(container)).not.toBeNull();
        expect(vi.mocked(props.onSelectElements).mock.calls.map(([ids]) => ids)).toEqual([['t'], ['t'], ['t']]);
    });

    it('opens the select-under menu on a long press over the selected element, reverting the direct drag', () => {
        vi.useFakeTimers();
        const elements = [rect('a', 20, 20), rect('c', 40, 30)];
        const editor = makeEditorStub(elements);
        const { elementNode, getByTestId } = renderCanvas({
            elements, selectedElementIds: ['c'], captureInteraction: editor.capture, onEditElements: vi.fn(),
        });
        pointer(elementNode('c'), 'pointerdown', 1, 60, 50);
        pointer(elementNode('c'), 'pointermove', 1, 65, 55); // within the tap slop: the drag has moved 'c'
        expect(find(editor.working(), 'c')).toMatchObject({ x: 45, y: 35 });
        act(() => { vi.advanceTimersByTime(600); });
        expect(getByTestId('select-under-menu')).toBeTruthy();
        pointer(elementNode('c'), 'pointerup', 1, 65, 55);
        expect(find(editor.working(), 'c')).toMatchObject({ x: 40, y: 30 }); // reverted by the cancel
        expect(editor.calls).toMatchObject({ end: 0, cancel: 1 });
        expect(editor.calls.selects).toEqual([['c']]); // the direct down's keep-selection only; nothing cycled
    });

    it('resizes after holding a touch handle zone instead of opening the select-under menu', () => {
        vi.useFakeTimers();
        const { props, container, queryByTestId } = renderCanvas({ selectedElementIds: ['a'], elements: [rect('a', 20, 20), rect('c', 40, 30)] });
        const handle = container.querySelector('[data-resize-handle="se"]') as HTMLElement;
        pointer(handle, 'pointerdown', 1, 120, 80);
        act(() => { vi.advanceTimersByTime(600); }); // press-and-hold before dragging the handle
        expect(queryByTestId('select-under-menu')).toBeNull();
        pointer(handle, 'pointermove', 1, 150, 100);
        pointer(handle, 'pointerup', 1, 150, 100);
        const resized = vi.mocked(props.onUpdateElements).mock.calls.at(-1)![0].find((el: TemplateElement) => el.id === 'a');
        expect(resized.w).toBeGreaterThan(100);
        expect(resized.h).toBeGreaterThan(60);
        expect(queryByTestId('select-under-menu')).toBeNull();
    });

    it('draws with a shape tool after a held press instead of treating the hold as a long press', () => {
        vi.useFakeTimers();
        const { props, surface, queryByTestId } = renderCanvas({ tool: 'rect', elements: [rect('a', 20, 20)] });
        pointer(surface, 'pointerdown', 1, 30, 30); // over 'a', held
        act(() => { vi.advanceTimersByTime(600); });
        pointer(surface, 'pointermove', 1, 130, 90);
        pointer(surface, 'pointerup', 1, 130, 90);
        expect(queryByTestId('select-under-menu')).toBeNull();
        expect(vi.mocked(props.onUpdateElements).mock.calls.at(-1)![0].at(-1)).toMatchObject({ type: 'rect', x: 30, y: 30, w: 100, h: 60 });
    });

    it('corrects the scroll around the pinch midpoint once the zoomed scale renders, keeping the midpoint pan', () => {
        const { props, surface, rerender } = renderCanvas({ scale: 1 });
        const pos = trackScroll(surface, 50, 30);
        pointer(surface, 'pointerdown', 1, 100, 100);
        pointer(surface, 'pointerdown', 2, 200, 100);
        pointer(surface, 'pointermove', 2, 300, 100); // midpoint 150 -> 200 (pan +50), distance doubled
        expect(props.onZoom).toHaveBeenLastCalledWith(2);
        expect(pos).toEqual({ left: 0, top: 30 }); // the pan applies immediately
        rerender(<Canvas {...props} scale={2} />);
        // The content under the old midpoint, ((150 + 50) / 1, (100 + 30) / 1) = (200, 130), must now sit
        // under the new midpoint (200, 100) at scale 2: scroll = (200 * 2 - 200, 130 * 2 - 100).
        expect(pos).toEqual({ left: 200, top: 160 });
    });
});

describe('Canvas touch mode: quick format bar and keyboard-aware editing', () => {
    afterEach(() => { vi.useRealTimers(); delete (window as any).visualViewport; });
    const bar = () => screen.queryByRole('toolbar', { name: 'Text formatting' });
    const barButton = (name: string) => screen.getByRole('button', { name });
    const gridElement = (id: string): TemplateElement => ({
        id, type: 'grid', x: 20, y: 100, w: 60, h: 30, rotation: 0, layerId: 'l1', fill: '', stroke: '#000000',
        strokeWidth: 1, opacity: 1, fontSize: 12, gridConfig: { cols: 2, gapX: 2, gapY: 2, sourceType: 'current' },
    });

    it('shows the bar for a single selected text or grid element in touch mode only', () => {
        const elements = [textElement('t', 20, 20), gridElement('g'), rect('a', 300, 300)];
        const { props, rerender } = renderCanvas({ elements, selectedElementIds: ['t'] });
        expect(bar()).not.toBeNull();
        rerender(<Canvas {...props} selectedElementIds={['g']} />);
        expect(bar()).not.toBeNull();
        rerender(<Canvas {...props} selectedElementIds={['a']} />);
        expect(bar()).toBeNull();
        rerender(<Canvas {...props} selectedElementIds={['t', 'a']} />);
        expect(bar()).toBeNull();
        rerender(<Canvas {...props} selectedElementIds={[]} />);
        expect(bar()).toBeNull();
        rerender(<Canvas {...props} selectedElementIds={['t']} inputMode="mouse" />);
        expect(bar()).toBeNull();
    });

    it('commits a bold tap as one edit intent through a captured interaction (incremental path)', () => {
        const elements = [textElement('t', 20, 20), rect('b', 300, 300)];
        const editor = makeEditorStub(elements);
        const { props } = renderCanvas({ elements, selectedElementIds: ['t'], captureInteraction: editor.capture, onEditElements: vi.fn() });
        compatClick(barButton('Bold'));
        expect(editor.calls.intents).toEqual([{ type: 'patch', updates: [{ id: 't', patch: { fontWeight: 'bold' } }] }]);
        expect(editor.calls).toMatchObject({ start: 1, end: 1, cancel: 0, selects: [] });
        expect(find(editor.committed(), 't')).toMatchObject({ fontWeight: 'bold' });
        expect(props.onUpdateElements).not.toHaveBeenCalled();
        expect(props.onEditElements).not.toHaveBeenCalled();
        // A second tap is its own interaction and its own history step.
        compatClick(barButton('Align center'));
        expect(editor.calls.intents.at(-1)).toEqual({ type: 'patch', updates: [{ id: 't', patch: { align: 'center' } }] });
        expect(editor.calls).toMatchObject({ start: 2, end: 2, cancel: 0 });
    });

    it('commits a bold tap through onUpdateElements with history on the legacy path', () => {
        const { props } = renderCanvas({ elements: [textElement('t', 20, 20)], selectedElementIds: ['t'] });
        compatClick(barButton('Bold'));
        expect(props.onUpdateElements).toHaveBeenCalledTimes(1);
        const [next, save] = vi.mocked(props.onUpdateElements).mock.calls[0];
        expect(find(next, 't')).toMatchObject({ fontWeight: 'bold', text: 'Hello' });
        expect(save).toBe(true);
        expect(props.onSelectElements).not.toHaveBeenCalled();
    });

    it('does not remove the bar from the DOM, even transiently, on a tap on the element or on the bar', () => {
        const elements = [textElement('t', 20, 20), rect('b', 300, 300)];
        const { elementNode } = renderCanvas({ elements, selectedElementIds: ['t'] });
        const node = bar()!;
        const observer = new MutationObserver(() => {});
        observer.observe(node.parentElement!, { childList: true });
        tap(elementNode('t'), 1, 40, 30);      // direct press on the selected element (sets isDragging and back)
        compatClick(barButton('Italic'));       // press on the bar itself
        expect(bar()).toBe(node);
        expect(observer.takeRecords().flatMap(record => Array.from(record.removedNodes))).not.toContain(node);
        observer.disconnect();
    });

    it('hides the bar only while a pan, a direct drag past the tap slop, or a pinch is in progress', () => {
        const elements = [textElement('t', 20, 20), rect('b', 300, 300)];
        const { elementNode, surface } = renderCanvas({ elements, selectedElementIds: ['t'] });
        pointer(surface, 'pointerdown', 1, 450, 650);
        expect(bar()).not.toBeNull();
        pointer(surface, 'pointermove', 1, 450, 600); // pan
        expect(bar()).toBeNull();
        pointer(surface, 'pointerup', 1, 450, 600);
        expect(bar()).not.toBeNull();

        pointer(elementNode('t'), 'pointerdown', 2, 40, 30);
        pointer(elementNode('t'), 'pointermove', 2, 43, 33); // within the slop: still a possible tap
        expect(bar()).not.toBeNull();
        pointer(elementNode('t'), 'pointermove', 2, 80, 60); // a real drag of the selected element
        expect(bar()).toBeNull();
        pointer(elementNode('t'), 'pointerup', 2, 80, 60);
        expect(bar()).not.toBeNull();

        pointer(surface, 'pointerdown', 3, 100, 100);
        pointer(surface, 'pointerdown', 4, 200, 100);
        pointer(surface, 'pointermove', 4, 300, 100); // pinch
        expect(bar()).toBeNull();
        pointer(surface, 'pointerup', 3, 100, 100);
        pointer(surface, 'pointerup', 4, 300, 100);
        expect(bar()).not.toBeNull();
    });

    it('positions the bar from the element rect and re-measures on canvas scroll', () => {
        const { elementNode, surface } = renderCanvas({ elements: [textElement('t', 20, 20)], selectedElementIds: ['t'] });
        const rectSpy = vi.spyOn(elementNode('t'), 'getBoundingClientRect')
            .mockReturnValue({ left: 100, top: 300, bottom: 340, right: 300, width: 200, height: 40 } as DOMRect);
        act(() => { surface.dispatchEvent(new Event('scroll')); });
        expect(bar()!.style.top).toBe(`${300 - 48 - 8}px`);
        rectSpy.mockReturnValue({ left: 100, top: 20, bottom: 60, right: 300, width: 200, height: 40 } as DOMRect);
        act(() => { surface.dispatchEvent(new Event('scroll')); });
        expect(bar()!.style.top).toBe(`${60 + 8}px`);
    });

    it('keeps an open inline edit alive and routes the format tap through its session (incremental path)', () => {
        const elements = [textElement('t', 20, 20), rect('b', 300, 300)];
        const editor = makeEditorStub(elements);
        const { container, elementNode, surface, props, rerender } = renderCanvas({ elements, captureInteraction: editor.capture, onEditElements: vi.fn() });
        doubleTap(elementNode('t'), 40, 30);
        const editable = inlineEditor(container)!;
        expect(editable).not.toBeNull();
        // Selection is a controlled prop here: mirror the select the stub received so the bar has its target.
        rerender(<Canvas {...props} selectedElementIds={['t']} />);
        expect(inlineEditor(container)).toBe(editable);
        const ends = editor.calls.end;
        compatClick(barButton('Bold'));
        expect(inlineEditor(container)).toBe(editable);
        expect(document.activeElement).toBe(editable);
        expect(editor.calls.intents).toEqual([{ type: 'patch', updates: [{ id: 't', patch: { fontWeight: 'bold' } }] }]);
        expect(editor.calls.end).toBe(ends); // the inline session stays open ...
        expect(find(editor.working(), 't')).toMatchObject({ fontWeight: 'bold' });
        expect(find(editor.committed(), 't')).not.toHaveProperty('fontWeight');
        tap(surface, 3, 450, 650); // ... and commits the formatting with the edit when it finishes
        expect(inlineEditor(container)).toBeNull();
        expect(find(editor.committed(), 't')).toMatchObject({ fontWeight: 'bold' });
        expect(editor.calls.cancel).toBe(0);
    });

    it('scrolls the edited element above the on-screen keyboard', () => {
        const listeners: Record<string, () => void> = {};
        Object.defineProperty(window, 'visualViewport', { configurable: true, value: {
            offsetTop: 0, height: 300,
            addEventListener: (type: string, fn: () => void) => { listeners[type] = fn; },
            removeEventListener: () => {},
        } });
        const text: TemplateElement = {
            id: 't', type: 'text', x: 20, y: 20, w: 200, h: 40, rotation: 0, layerId: 'l1', fill: '', stroke: '',
            strokeWidth: 0, opacity: 1, text: 'Hi', fontSize: 16, fontFamily: 'helvetica', textOverflow: 'clip', textWrap: true,
        };
        const { surface, elementNode } = renderCanvas({ elements: [text] });
        trackScroll(surface);
        vi.spyOn(elementNode('t'), 'getBoundingClientRect').mockReturnValue({ top: 500, bottom: 540, left: 0, right: 200, width: 200, height: 40 } as DOMRect);
        for (let i = 0; i < 2; i++) {
            pointer(elementNode('t'), 'pointerdown', i + 1, 40, 30);
            pointer(elementNode('t'), 'pointerup', i + 1, 40, 30);
        }
        expect(surface.scrollTop).toBe(540 - (300 - 16));
    });

    it('re-runs the keyboard scroll when the visual viewport resizes, and only in touch mode', () => {
        const listeners: Record<string, () => void> = {};
        const removed: string[] = [];
        Object.defineProperty(window, 'visualViewport', { configurable: true, value: {
            offsetTop: 0, height: 300,
            addEventListener: (type: string, fn: () => void) => { listeners[type] = fn; },
            removeEventListener: (type: string) => { removed.push(type); },
        } });
        const { surface, elementNode, unmount } = renderCanvas({ elements: [textElement('t', 20, 20)] });
        const pos = trackScroll(surface);
        const rectSpy = vi.spyOn(elementNode('t'), 'getBoundingClientRect')
            .mockReturnValue({ top: 100, bottom: 140, left: 0, right: 200, width: 200, height: 40 } as DOMRect);
        doubleTap(elementNode('t'), 40, 30);
        expect(pos.top).toBe(0); // already visible: nothing to do
        rectSpy.mockReturnValue({ top: 400, bottom: 440, left: 0, right: 200, width: 200, height: 40 } as DOMRect);
        act(() => { listeners.resize(); }); // the keyboard shrank the viewport
        expect(pos.top).toBe(440 - (300 - 16));
        unmount();
        expect(removed).toContain('resize');

        const mouse = renderCanvas({ inputMode: 'mouse', elements: [textElement('t', 20, 20)] });
        const mousePos = trackScroll(mouse.surface);
        vi.spyOn(mouse.elementNode('t'), 'getBoundingClientRect').mockReturnValue({ top: 500, bottom: 540, left: 0, right: 200, width: 200, height: 40 } as DOMRect);
        fireEvent.doubleClick(mouse.elementNode('t'), { clientX: 40, clientY: 30 });
        expect(inlineEditor(mouse.container)).not.toBeNull();
        expect(mousePos.top).toBe(0);
    });

    it('holds one interaction across a colour pick: a stream of inputs, one start/end (incremental path)', () => {
        const elements = [textElement('t', 20, 20), rect('b', 300, 300)];
        const editor = makeEditorStub(elements);
        const { props, rerender } = renderCanvas({ elements, selectedElementIds: ['t'], captureInteraction: editor.capture, onEditElements: vi.fn() });
        const colour = screen.getByLabelText('Text colour');
        // The element prop follows the working copy, as the incremental editor's state does, so the
        // controlled input keeps the picked value and the picker's closing `change` repeats it.
        const pick = (value: string) => { fireEvent.input(colour, { target: { value } }); rerender(<Canvas {...props} elements={editor.working()} />); };
        pick('#ff0000');
        pick('#00ff00');
        expect(editor.calls.intents).toEqual([
            { type: 'patch', updates: [{ id: 't', patch: { textColor: '#ff0000' } }] },
            { type: 'patch', updates: [{ id: 't', patch: { textColor: '#00ff00' } }] },
        ]);
        expect(editor.calls).toMatchObject({ start: 1, end: 0, cancel: 0 });
        expect(find(editor.committed(), 't')).not.toHaveProperty('textColor');
        fireEvent.change(colour, { target: { value: '#00ff00' } }); // the picker closes
        expect(editor.calls).toMatchObject({ start: 1, end: 1, cancel: 0 });
        expect(find(editor.committed(), 't')).toMatchObject({ textColor: '#00ff00' });
        expect(props.onUpdateElements).not.toHaveBeenCalled();
        pick('#0000ff'); // the next pick is its own interaction
        fireEvent.change(colour, { target: { value: '#0000ff' } });
        expect(editor.calls).toMatchObject({ start: 2, end: 2, cancel: 0 });
        expect(editor.calls.intents).toHaveLength(3);
    });

    it('saves history once for a colour pick on the legacy path', () => {
        const { props, rerender } = renderCanvas({ elements: [textElement('t', 20, 20)], selectedElementIds: ['t'] });
        const colour = screen.getByLabelText('Text colour');
        const updates = vi.mocked(props.onUpdateElements);
        const pick = (value: string) => { fireEvent.input(colour, { target: { value } }); rerender(<Canvas {...props} elements={updates.mock.calls.at(-1)![0]} />); };
        pick('#ff0000');
        pick('#00ff00');
        fireEvent.change(colour, { target: { value: '#00ff00' } });
        expect(updates.mock.calls.map(([next, save]) => [find(next, 't').textColor, save])).toEqual([['#ff0000', true], ['#00ff00', false]]);
        expect(props.onInteractionStart).not.toHaveBeenCalled();
    });

    it('balances a pick left open when the selection changes: cancelled by the selection effect, not ended twice', () => {
        const elements = [textElement('t', 20, 20), rect('b', 300, 300)];
        const editor = makeEditorStub(elements);
        const { props, rerender } = renderCanvas({ elements, selectedElementIds: ['t'], captureInteraction: editor.capture, onEditElements: vi.fn() });
        fireEvent.input(screen.getByLabelText('Text colour'), { target: { value: '#ff0000' } });
        expect(editor.calls).toMatchObject({ start: 1, end: 0, cancel: 0 });
        rerender(<Canvas {...props} elements={editor.working()} selectedElementIds={['b']} />);
        // Canvas's selection layout effect cancels the stale interaction first (as it does for a
        // drag); the unmounting bar's end then finds its owner superseded and is a no-op.
        expect(editor.calls).toMatchObject({ start: 1, end: 0, cancel: 1 });
        expect(find(editor.committed(), 't')).not.toHaveProperty('textColor');
        expect(bar()).toBeNull();
    });

    it('closes an open select-under menu when the bar is pressed', () => {
        vi.useFakeTimers();
        const elements = [textElement('t', 20, 20), rect('c', 40, 30)];
        const { elementNode, getByTestId, queryByTestId } = renderCanvas({ elements, selectedElementIds: ['t'] });
        pointer(elementNode('c'), 'pointerdown', 1, 60, 50);
        act(() => { vi.advanceTimersByTime(600); });
        pointer(elementNode('c'), 'pointerup', 1, 60, 50);
        expect(getByTestId('select-under-menu')).toBeTruthy();
        expect(bar()).not.toBeNull();
        fireEvent.pointerDown(barButton('Bold'), { pointerType: 'touch' }); // the bar stops propagation; the closer is capture-phase
        expect(queryByTestId('select-under-menu')).toBeNull();
        expect(bar()).not.toBeNull();
    });
});

describe('Canvas touch Select multiple', () => {
    it('adds a tapped element, ignores empty canvas and never commits anything', () => {
        const { props, elementNode, surface } = renderCanvas({ multiSelect: true, selectedElementIds: ['a'] });
        tap(elementNode('b'), 1, 210, 210); // clear of 'a': a pending tap
        expect(props.onSelectElements).toHaveBeenLastCalledWith(['a', 'b']);
        tap(surface, 2, 450, 650);
        expect(props.onSelectElements).toHaveBeenCalledTimes(1);
        expect(props.onUpdateElements).not.toHaveBeenCalled();
    });

    it('removes a selected element on a clean press (a direct drag that never moved)', () => {
        const { props, elementNode } = renderCanvas({ multiSelect: true, selectedElementIds: ['a', 'b'] });
        tap(elementNode('a'), 1, 30, 30);
        expect(props.onSelectElements).toHaveBeenLastCalledWith(['b']);
        expect(props.onUpdateElements).not.toHaveBeenCalled();
        expect(props.onInteractionStart).not.toHaveBeenCalled();
    });

    it('leaves a press on a group resize handle to the resize path', () => {
        const { props, container } = renderCanvas({ multiSelect: true, selectedElementIds: ['a', 'b'] });
        const handle = container.querySelector('[data-resize-handle="se"]')!;
        tap(handle, 1, 300, 260);
        expect(vi.mocked(props.onSelectElements).mock.calls.every(([ids]) => ids.length === 2)).toBe(true);
    });

    it('replaces the selection as before while the mode is off', () => {
        const { props, elementNode, surface } = renderCanvas({ multiSelect: false, selectedElementIds: ['a'] });
        tap(elementNode('b'), 1, 210, 210);
        expect(props.onSelectElements).toHaveBeenLastCalledWith(['b']);
        tap(surface, 2, 450, 650);
        expect(props.onSelectElements).toHaveBeenLastCalledWith([]);
    });

    it('toggles through captured interactions on the incremental path, ending each one', () => {
        const editor = makeEditorStub([rect('a', 20, 20), rect('b', 200, 200)]);
        const { props, elementNode, surface } = renderCanvas({
            multiSelect: true, selectedElementIds: ['a'], captureInteraction: editor.capture, onEditElements: vi.fn(),
        });
        tap(elementNode('b'), 1, 210, 210);
        expect(editor.calls.selects).toEqual([['a', 'b']]);
        expect(editor.calls.end).toBe(1);
        tap(surface, 2, 450, 650);
        expect(editor.calls.selects).toEqual([['a', 'b']]);
        expect(props.onSelectElements).not.toHaveBeenCalled();
    });

    it('removes on a clean direct press on the incremental path once the press\'s own interaction has ended', () => {
        const editor = makeEditorStub([rect('a', 20, 20), rect('b', 200, 200)]);
        const { elementNode } = renderCanvas({
            multiSelect: true, selectedElementIds: ['a', 'b'], captureInteraction: editor.capture, onEditElements: vi.fn(),
        });
        tap(elementNode('a'), 1, 30, 30);
        expect(editor.calls.selects.at(-1)).toEqual(['b']);
        expect(editor.calls).toMatchObject({ start: 0, end: 2, cancel: 0, intents: [] });
    });

    it('adds the element picked from the long-press menu', () => {
        vi.useFakeTimers();
        const elements = [rect('a', 20, 20), rect('c', 40, 30)];
        const { props, elementNode, getByTestId, queryByTestId } = renderCanvas({ multiSelect: true, selectedElementIds: ['c'], elements });
        pointer(elementNode('c'), 'pointerdown', 1, 60, 50);
        act(() => { vi.advanceTimersByTime(600); });
        pointer(elementNode('c'), 'pointerup', 1, 60, 50);
        compatClick(getByTestId('select-under-menu').querySelector('[data-menu-element-id="a"]')!, 70, 60);
        expect(props.onSelectElements).toHaveBeenLastCalledWith(['c', 'a']);
        expect(queryByTestId('select-under-menu')).toBeNull(); // a plain pick still closes the menu
    });
});

describe('Canvas touch group drag', () => {
    it('moves every selected element with a one-finger drag on any of them, saving history once (legacy path)', () => {
        const { props, elementNode } = renderCanvas({ selectedElementIds: ['a', 'b'] });
        pointer(elementNode('b'), 'pointerdown', 1, 210, 210);
        pointer(elementNode('b'), 'pointermove', 1, 240, 230);
        pointer(elementNode('b'), 'pointerup', 1, 240, 230);
        const moved = vi.mocked(props.onUpdateElements).mock.calls.at(-1)![0] as TemplateElement[];
        expect(find(moved, 'a')).toMatchObject({ x: 50, y: 40 });
        expect(find(moved, 'b')).toMatchObject({ x: 230, y: 220 });
        expect(props.onInteractionStart).toHaveBeenCalledTimes(1);
    });

    it('ignores a mouseleave on the container mid-drag on touch, which still ends a mouse drag', () => {
        // Chrome reports mouse boundary events for a touch even when pointerdown was cancelled, and a
        // group move that pushes an element past the page edge makes it re-evaluate hover mid-gesture.
        const editor = makeEditorStub([rect('a', 20, 20), rect('b', 200, 200)]);
        const { elementNode, surface } = renderCanvas({ selectedElementIds: ['a', 'b'], captureInteraction: editor.capture, onEditElements: vi.fn() });
        pointer(elementNode('a'), 'pointerdown', 1, 30, 30);
        pointer(elementNode('a'), 'pointermove', 1, 40, 30);
        fireEvent.mouseLeave(surface);
        pointer(elementNode('a'), 'pointermove', 1, 60, 50);
        expect(editor.calls.end).toBe(0);
        pointer(elementNode('a'), 'pointerup', 1, 60, 50);
        expect(editor.calls).toMatchObject({ start: 1, end: 1, cancel: 0 });
        expect(find(editor.committed(), 'a')).toMatchObject({ x: 50, y: 40 });
        expect(find(editor.committed(), 'b')).toMatchObject({ x: 230, y: 220 });

        const mouse = makeEditorStub([rect('a', 20, 20), rect('b', 200, 200)]);
        const desktop = renderCanvas({ inputMode: 'mouse', selectedElementIds: ['a', 'b'], captureInteraction: mouse.capture, onEditElements: vi.fn() });
        fireEvent.mouseDown(desktop.elementNode('a'), { clientX: 30, clientY: 30, button: 0 });
        fireEvent.mouseMove(desktop.surface, { clientX: 40, clientY: 30 });
        fireEvent.mouseLeave(desktop.surface);
        expect(mouse.calls.end).toBe(1); // desktop: leaving the canvas still ends the drag
    });

    it('moves every selected element in one interaction with one patch intent per move (incremental path)', () => {
        const editor = makeEditorStub([rect('a', 20, 20), rect('b', 200, 200)]);
        const { elementNode } = renderCanvas({ selectedElementIds: ['a', 'b'], captureInteraction: editor.capture, onEditElements: vi.fn() });
        pointer(elementNode('a'), 'pointerdown', 1, 30, 30);
        pointer(elementNode('a'), 'pointermove', 1, 60, 50);
        pointer(elementNode('a'), 'pointerup', 1, 60, 50);
        expect(editor.calls).toMatchObject({ start: 1, end: 1, cancel: 0 });
        const patches = editor.calls.intents.filter(intent => intent.type === 'patch');
        expect(patches).toHaveLength(1);
        expect(patches[0].type === 'patch' && patches[0].updates.map(update => update.id).sort()).toEqual(['a', 'b']);
        expect(find(editor.committed(), 'a')).toMatchObject({ x: 50, y: 40 });
        expect(find(editor.committed(), 'b')).toMatchObject({ x: 230, y: 220 });
    });
});
