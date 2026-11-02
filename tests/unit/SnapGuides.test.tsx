import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SnapGuides, formatGuideValue } from '../../components/canvas/SnapGuides';
import type { Guide } from '../../services/snapping/types';

const renderGuides = (guides: Guide[], extra: Partial<React.ComponentProps<typeof SnapGuides>> = {}) =>
    render(<SnapGuides guides={guides} scale={1} touch={false} pointer={null} width={500} height={700} {...extra} />);

describe('SnapGuides', () => {
    it('renders nothing without guides', () => {
        expect(renderGuides([]).container.querySelector('[data-testid="snap-guides"]')).toBeNull();
    });
    it('draws an align line in page units', () => {
        const { container } = renderGuides([{ kind: 'align', axis: 'x', at: 100, from: 20, to: 300 }]);
        const line = container.querySelector('line[data-guide-kind="align"]')!;
        expect(line.getAttribute('x1')).toBe('100'); expect(line.getAttribute('y1')).toBe('20');
        expect(line.getAttribute('x2')).toBe('100'); expect(line.getAttribute('y2')).toBe('300');
    });
    it('keeps strokes one screen pixel wide at any zoom, 1.5 on touch', () => {
        const at2 = renderGuides([{ kind: 'align', axis: 'y', at: 50, from: 0, to: 100 }], { scale: 2 });
        expect(at2.container.querySelector('line')!.getAttribute('stroke-width')).toBe('0.5');
        const touch = renderGuides([{ kind: 'align', axis: 'y', at: 50, from: 0, to: 100 }], { scale: 1, touch: true });
        expect(touch.container.querySelector('line')!.getAttribute('stroke-width')).toBe('1.5');
    });
    it('labels distances, spacing gaps and matched sizes', () => {
        const { container } = renderGuides([
            { kind: 'distance', axis: 'y', at: 100, from: 150, to: 200 },
            { kind: 'spacing', axis: 'x', gap: 30, segments: [{ at: 25, from: 100, to: 130 }] },
            { kind: 'size', axis: 'x', size: 120, boxes: [{ x: 0, y: 300, w: 120, h: 40 }] },
        ]);
        const labels = [...container.querySelectorAll('[data-guide-label]')].map(n => n.textContent);
        expect(labels).toEqual(expect.arrayContaining(['50', '30', '= 120']));
    });
    it('formats whole points without decimals', () => {
        expect(formatGuideValue(12)).toBe('12'); expect(formatGuideValue(12.34)).toBe('12.3'); expect(formatGuideValue(11.96)).toBe('12');
    });
    it('moves a touch label away from the finger', () => {
        const guide: Guide = { kind: 'distance', axis: 'y', at: 100, from: 150, to: 200 };
        const free = renderGuides([guide], { touch: true });
        const near = renderGuides([guide], { touch: true, pointer: { x: 106, y: 175 } });
        const xOf = (c: HTMLElement) => Number(c.querySelector('[data-guide-label]')!.getAttribute('x'));
        expect(xOf(near.container)).toBeLessThan(xOf(free.container));
    });
    it('prefers the first clear side on touch, else the side farther from the finger', () => {
        const guide: Guide = { kind: 'distance', axis: 'y', at: 100, from: 150, to: 200 };
        const xOf = (c: HTMLElement) => Number(c.querySelector('[data-guide-label]')!.getAttribute('x'));
        const free = xOf(renderGuides([guide], { touch: true }).container);
        expect(free).toBeGreaterThan(100); // preferred side is to the right of the segment
        // Finger left of the segment covers both candidates (22 px and 2 px away): take the farther, right one.
        expect(xOf(renderGuides([guide], { touch: true, pointer: { x: 90, y: 175 } }).container)).toBe(free);
        // Finger to the right covers only the right candidate (38 px): the clear left one wins despite being second choice.
        expect(xOf(renderGuides([guide], { touch: true, pointer: { x: 150, y: 175 } }).container)).toBeLessThan(100);
        // Finger far right leaves both clear: keep the preferred right side rather than the farther left one.
        expect(xOf(renderGuides([guide], { touch: true, pointer: { x: 200, y: 175 } }).container)).toBe(free);
    });
    it('never shifts a label for the mouse, even when a pointer is passed', () => {
        const guide: Guide = { kind: 'distance', axis: 'y', at: 100, from: 150, to: 200 };
        const xOf = (c: HTMLElement) => Number(c.querySelector('[data-guide-label]')!.getAttribute('x'));
        const free = xOf(renderGuides([guide]).container);
        expect(xOf(renderGuides([guide], { touch: false, pointer: { x: 106, y: 175 } }).container)).toBe(free);
    });
    it('sits an x-size label entirely above its box with a gap', () => {
        const { container } = renderGuides([{ kind: 'size', axis: 'x', size: 120, boxes: [{ x: 0, y: 300, w: 120, h: 40 }] }]);
        const rect = container.querySelector('rect')!;
        expect(Number(rect.getAttribute('y')) + Number(rect.getAttribute('height'))).toBeLessThanOrEqual(300 - 4);
    });
    it('clamps labels inside the page', () => {
        const rectOf = (c: HTMLElement) => c.querySelector('rect')!;
        const right = rectOf(renderGuides([{ kind: 'distance', axis: 'y', at: 495, from: 150, to: 200 }]).container);
        expect(Number(right.getAttribute('x'))).toBeGreaterThanOrEqual(0);
        expect(Number(right.getAttribute('x')) + Number(right.getAttribute('width'))).toBeLessThanOrEqual(500);
        const top = rectOf(renderGuides([{ kind: 'size', axis: 'x', size: 120, boxes: [{ x: 0, y: 5, w: 120, h: 40 }] }]).container);
        expect(Number(top.getAttribute('y'))).toBeGreaterThanOrEqual(0);
    });
});
