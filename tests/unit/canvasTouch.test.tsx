import React from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Canvas } from '../../components/Canvas';
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
