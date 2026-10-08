import React from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Canvas, type CanvasInteraction } from '../../components/Canvas';
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
