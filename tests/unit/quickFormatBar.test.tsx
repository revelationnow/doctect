import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QuickFormatBar } from '../../components/canvas/QuickFormatBar';
import type { TemplateElement } from '../../types';

const text: TemplateElement = {
    id: 't', type: 'text', x: 0, y: 0, w: 100, h: 20, rotation: 0, fill: '', stroke: '', strokeWidth: 0,
    opacity: 1, text: 'Hi', fontSize: 14, fontWeight: 'normal', fontStyle: 'normal', textDecoration: 'none',
    align: 'left', textColor: '#000000',
};
const anchor = { left: 100, top: 300, bottom: 320, width: 100 };

describe('QuickFormatBar', () => {
    it.each([
        ['Increase font size', { fontSize: 15 }],
        ['Decrease font size', { fontSize: 13 }],
        ['Bold', { fontWeight: 'bold' }],
        ['Italic', { fontStyle: 'italic' }],
        ['Underline', { textDecoration: 'underline' }],
        ['Align center', { align: 'center' }],
        ['Align right', { align: 'right' }],
    ])('%s issues %o', (label, patch) => {
        const onChange = vi.fn();
        render(<QuickFormatBar element={text} anchor={anchor} onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: label }));
        expect(onChange).toHaveBeenCalledWith(patch);
    });

    it('toggles bold off and changes colour', () => {
        const onChange = vi.fn();
        render(<QuickFormatBar element={{ ...text, fontWeight: 'bold' }} anchor={anchor} onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
        expect(onChange).toHaveBeenCalledWith({ fontWeight: 'normal' });
        fireEvent.change(screen.getByLabelText('Text colour'), { target: { value: '#ff0000' } });
        expect(onChange).toHaveBeenCalledWith({ textColor: '#ff0000' });
    });

    it('sits above the element, or below when there is no room, and keeps edits alive', () => {
        const { rerender } = render(<QuickFormatBar element={text} anchor={anchor} onChange={() => {}} />);
        const bar = screen.getByRole('toolbar', { name: 'Text formatting' });
        expect(bar.style.top).toBe(`${300 - 48 - 8}px`);
        expect(bar.hasAttribute('data-prevent-finish-edit')).toBe(true);
        expect(bar.hasAttribute('data-touch-gesture-ignore')).toBe(true);
        rerender(<QuickFormatBar element={text} anchor={{ ...anchor, top: 20, bottom: 40 }} onChange={() => {}} />);
        expect(bar.style.top).toBe(`${40 + 8}px`);
    });

    // R19: a press on the bar must never reach the canvas's React mouse handlers (which would start
    // a marquee or drag) nor the gesture hook; the bar is portaled, so React synthetic events are the
    // path that remains and must be stopped at the bar root.
    it('stops mousedown and pointerdown at its root and prevents the pointerdown default', () => {
        const onMouseDown = vi.fn();
        const onPointerDown = vi.fn();
        render(
            <div onMouseDown={onMouseDown} onPointerDown={onPointerDown}>
                <QuickFormatBar element={text} anchor={anchor} onChange={() => {}} />
            </div>,
        );
        const bold = screen.getByRole('button', { name: 'Bold' });
        expect(fireEvent.pointerDown(bold, { pointerType: 'touch' })).toBe(false);
        fireEvent.mouseDown(bold);
        expect(onMouseDown).not.toHaveBeenCalled();
        expect(onPointerDown).not.toHaveBeenCalled();
    });

    it('renders every control at the 44px touch minimum with a 16px form control and reflects state', () => {
        render(<QuickFormatBar element={{ ...text, fontStyle: 'italic', align: 'center' }} anchor={anchor} onChange={() => {}} />);
        const bar = screen.getByRole('toolbar', { name: 'Text formatting' });
        const buttons = screen.getAllByRole('button');
        expect(buttons).toHaveLength(8);
        buttons.forEach(button => expect(button.className).toMatch(/\bh-11\b.*\bw-11\b|\bw-11\b.*\bh-11\b/));
        const colour = screen.getByLabelText('Text colour') as HTMLInputElement;
        expect(colour.type).toBe('color');
        expect(colour.className).toMatch(/\btext-base\b/);
        expect(colour.className).toMatch(/\bh-11\b/);
        expect(bar.style.height).toBe('48px');
        expect(screen.getByRole('button', { name: 'Italic' }).getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByRole('button', { name: 'Align center' }).getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByRole('button', { name: 'Align left' }).getAttribute('aria-pressed')).toBe('false');
        expect(screen.getByRole('button', { name: 'Bold' }).getAttribute('aria-pressed')).toBe('false');
        expect(bar.textContent).toContain('14');
    });

    it('renders in a portal on document.body so canvas stacking contexts cannot trap it', () => {
        const { container } = render(<QuickFormatBar element={text} anchor={anchor} onChange={() => {}} />);
        const bar = screen.getByRole('toolbar', { name: 'Text formatting' });
        expect(container.contains(bar)).toBe(false);
        expect(bar.parentElement).toBe(document.body);
    });
});
