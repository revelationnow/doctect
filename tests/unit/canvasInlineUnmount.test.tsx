import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Canvas, type CanvasInteraction } from '../../components/Canvas';
import type { PageTemplate, TemplateElement } from '../../types';

// A layout swap (a mouse window crossing a breakpoint) remounts the canvas under a new parent while
// an inline text edit may be open. Chromium blurs a focused element it removes, which runs the
// overlay's onFinish; Firefox and jsdom do not, so the canvas itself must end the session on unmount,
// and must not end it twice on engines that did blur.

const textElement: TemplateElement = {
    id: 't', type: 'text', x: 20, y: 20, w: 200, h: 40, rotation: 0, layerId: 'l1',
    fill: '', stroke: '', strokeWidth: 0, opacity: 1, text: 'Hello', fontSize: 16,
    fontFamily: 'helvetica', textOverflow: 'clip', textWrap: true,
};
const template: PageTemplate = {
    id: 'page', name: 'Page', width: 500, height: 700,
    layers: [{ id: 'l1', name: 'Layer 1', order: 0, visible: true, locked: false }],
    elements: [textElement],
};

// Minimal stand-in for ProjectEditor's createInteraction: end() is idempotent there too.
const makeOwnerStub = () => {
    let active: object | null = null;
    const calls = { end: 0, cancel: 0 };
    const capture = (): CanvasInteraction => {
        const token = {};
        active = token;
        const isCurrent = () => active === token;
        return {
            isCurrent,
            start() {},
            edit() {},
            select() {},
            handoffToInline() { return isCurrent() ? capture() : undefined; },
            end() { if (!isCurrent()) return; active = null; calls.end++; },
            cancel() { if (!isCurrent()) return; active = null; calls.cancel++; },
        };
    };
    return { capture, calls };
};

const renderMouseCanvas = (overrides: Partial<React.ComponentProps<typeof Canvas>> = {}) => {
    const utils = render(
        <Canvas
            template={template} elements={[textElement]} selectedElementIds={[]} scale={1} tool="select"
            nodes={{}} currentNodeId="root" snapToGrid={false} showGrid={false} activeLayerId="l1" inputMode="mouse"
            onUpdateElements={vi.fn()} onSelectElements={vi.fn()} onZoom={vi.fn()} onInteractionStart={vi.fn()}
            {...overrides}
        />,
    );
    const openEditor = () => {
        fireEvent.doubleClick(utils.container.querySelector('[data-element-id="t"]')!, { clientX: 40, clientY: 30 });
        const editor = utils.container.querySelector('[contenteditable="true"]') as HTMLElement | null;
        expect(editor).not.toBeNull();
        return editor!;
    };
    return { ...utils, openEditor };
};

afterEach(() => vi.restoreAllMocks());

describe('Canvas unmount with an open inline edit', () => {
    it('ends the captured interaction so the typed text is one committed step (no blur on removal)', () => {
        const owner = makeOwnerStub();
        const { openEditor, unmount } = renderMouseCanvas({ captureInteraction: owner.capture, onEditElements: vi.fn() });
        openEditor();
        expect(owner.calls.end).toBe(0);
        unmount();
        expect(owner.calls).toEqual({ end: 1, cancel: 0 });
    });

    it('ends the legacy session on unmount, and only once when the engine already blurred the editor', () => {
        const onInteractionEnd = vi.fn();
        const first = renderMouseCanvas({ onEditElements: vi.fn(), onInteractionEnd });
        first.openEditor();
        first.unmount();
        expect(onInteractionEnd).toHaveBeenCalledTimes(1);

        // Chromium: removing the focused editor fires blur, which already finished the session.
        onInteractionEnd.mockClear();
        const second = renderMouseCanvas({ onEditElements: vi.fn(), onInteractionEnd });
        const editor = second.openEditor();
        fireEvent.blur(editor);
        expect(onInteractionEnd).toHaveBeenCalledTimes(1);
        second.unmount();
        expect(onInteractionEnd).toHaveBeenCalledTimes(1);
    });
});
