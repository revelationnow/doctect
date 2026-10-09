import React, { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hexToHsv, hsvToHex, normalizeHex } from '../../components/color/colorMath';
import { COLOUR_PALETTE, TouchColorPicker } from '../../components/color/TouchColorPicker';
import { commitToColourInput, resetTouchColourRecents, TouchColorPickerHost } from '../../components/color/TouchColorPickerHost';
import { FormFactorProvider } from '../../components/editor-layout/FormFactorContext';
import type { FormFactor } from '../../hooks/useEditorFormFactor';

afterEach(() => { resetTouchColourRecents(); });

describe('colour math', () => {
    it.each(['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#3b82f6', '#b32424', '#94a3b8'])('round-trips %s', hex => {
        expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    });

    it('normalises short, unprefixed and upper-case hex and rejects the rest', () => {
        expect(normalizeHex('ABC')).toBe('#aabbcc');
        expect(normalizeHex('#3B82F6')).toBe('#3b82f6');
        expect(normalizeHex(' 3b82f6 ')).toBe('#3b82f6');
        for (const bad of ['', '#12', '12345', 'ggg', '#1234567']) expect(normalizeHex(bad), bad).toBeNull();
    });

    it('keeps the hint hue and saturation for greys and black', () => {
        expect(hexToHsv('#808080', { h: 200, s: 0.5, v: 1 }).h).toBe(200);
        expect(hexToHsv('#000000', { h: 120, s: 0.7, v: 1 })).toEqual({ h: 120, s: 0.7, v: 0 });
    });
});

const box = (el: Element, width: number, height: number) => {
    el.getBoundingClientRect = () => ({ left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0, toJSON: () => ({}) });
};
const pointer = (type: string, el: Element, clientX: number, clientY: number) =>
    fireEvent(el, new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY }));

describe('TouchColorPicker', () => {
    const renderPicker = (value = '#ff0000', recents: string[] = []) => {
        const onCommit = vi.fn();
        const onClose = vi.fn();
        render(<TouchColorPicker value={value} label="Fill" recents={recents} onCommit={onCommit} onClose={onClose} />);
        return { onCommit, onClose };
    };

    it('previews a drag on the square live and commits once, on release', () => {
        const { onCommit } = renderPicker('#ff0000');
        const square = screen.getByTestId('colour-picker-square');
        box(square, 200, 100);
        pointer('pointerdown', square, 100, 50);
        pointer('pointermove', square, 150, 25);
        expect(onCommit).not.toHaveBeenCalled();
        expect(screen.getByTestId('colour-picker-preview').style.backgroundColor).toBe('rgb(191, 48, 48)');
        pointer('pointerup', square, 200, 0);
        expect(onCommit).toHaveBeenCalledTimes(1);
        expect(onCommit).toHaveBeenLastCalledWith('#ff0000'); // full saturation, full brightness
    });

    it('maps the hue bar inside its thumb insets and commits on release', () => {
        const { onCommit } = renderPicker('#ff0000');
        const hue = screen.getByTestId('colour-picker-hue');
        box(hue, 392, 44); // 16px inset each side: a 360px track
        pointer('pointerdown', hue, 16 + 120, 22);
        pointer('pointerup', hue, 16 + 120, 22);
        expect(onCommit).toHaveBeenCalledTimes(1);
        expect(onCommit).toHaveBeenLastCalledWith('#00ff00');
        expect(hue).toHaveAttribute('aria-valuenow', '120');
    });

    it('commits a palette or recent swatch tap and a valid hex, and restores an invalid one', () => {
        const { onCommit } = renderPicker('#ff0000', ['#123456']);
        fireEvent.click(within(screen.getByRole('group', { name: 'Palette' })).getByRole('button', { name: `Palette ${COLOUR_PALETTE[12]}` }));
        expect(onCommit).toHaveBeenLastCalledWith(COLOUR_PALETTE[12]);
        fireEvent.click(within(screen.getByRole('group', { name: 'Recent colours' })).getByRole('button', { name: 'Recent #123456' }));
        expect(onCommit).toHaveBeenLastCalledWith('#123456');
        const hex = screen.getByRole('textbox', { name: 'Hex colour' });
        fireEvent.change(hex, { target: { value: '#0f0' } });
        fireEvent.keyDown(hex, { key: 'Enter' });
        expect(onCommit).toHaveBeenLastCalledWith('#00ff00');
        fireEvent.change(hex, { target: { value: 'nope' } });
        fireEvent.keyDown(hex, { key: 'Enter' });
        expect(onCommit).toHaveBeenCalledTimes(3);
        expect(hex).toHaveValue('00ff00');
    });

    it('nudges with arrow keys, one commit per press', () => {
        const { onCommit } = renderPicker('#ff0000');
        fireEvent.keyDown(screen.getByTestId('colour-picker-hue'), { key: 'ArrowRight', shiftKey: true });
        expect(onCommit).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('colour-picker-hue')).toHaveAttribute('aria-valuenow', '10');
    });

    it('closes from Done, the backdrop and Escape, without committing', () => {
        const { onCommit, onClose } = renderPicker();
        fireEvent.click(screen.getByRole('button', { name: 'Done' }));
        fireEvent.click(screen.getByTestId('colour-picker-backdrop'));
        fireEvent.keyDown(screen.getByRole('dialog', { name: 'Fill' }), { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(3);
        expect(onCommit).not.toHaveBeenCalled();
    });

    it('keeps every swatch and control at the 44px touch minimum', () => {
        renderPicker('#ff0000', ['#123456']);
        for (const button of screen.getAllByRole('button')) expect(button.className, button.textContent ?? '').toMatch(/\b(h-11|min-h-11)\b/);
        expect(screen.getByTestId('colour-picker-hue').className).toMatch(/\bh-11\b/);
    });
});

/** A field the way SingleElementEditor writes them: a native colour input with React handlers. */
function Field({ onInput, onChange }: { onInput: (v: string) => void; onChange: (v: string) => void }) {
    const [value, setValue] = useState('#ffffff');
    return (
        <div>
            <div>Fill</div>
            <div><input type="color" value={value}
                onInput={e => { setValue((e.target as HTMLInputElement).value); onInput((e.target as HTMLInputElement).value); }}
                onChange={e => onChange(e.target.value)} /></div>
        </div>
    );
}

describe('TouchColorPickerHost', () => {
    const mount = (formFactor: FormFactor) => {
        const onInput = vi.fn();
        const onChange = vi.fn();
        const view = render(<FormFactorProvider value={formFactor}><TouchColorPickerHost /><Field onInput={onInput} onChange={onChange} /></FormFactorProvider>);
        const input = view.container.querySelector('input[type="color"]') as HTMLInputElement;
        return { onInput, onChange, input };
    };

    it.each(['phone', 'tablet'] as const)('%s: a tap on a colour input opens the picker instead of the native one, named after the field', formFactor => {
        const { input } = mount(formFactor);
        const click = new MouseEvent('click', { bubbles: true, cancelable: true });
        act(() => { input.dispatchEvent(click); });
        expect(click.defaultPrevented).toBe(true);
        expect(screen.getByRole('dialog', { name: 'Fill' })).toBeTruthy();
    });

    it('desktop leaves the native picker alone', () => {
        const { input } = mount('desktop');
        const click = new MouseEvent('click', { bubbles: true, cancelable: true });
        act(() => { input.dispatchEvent(click); });
        expect(click.defaultPrevented).toBe(false);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('writes a pick into the input once (React onInput and onChange both fire), remembers it, and refocuses the field on close', () => {
        const { input, onInput, onChange } = mount('phone');
        act(() => { fireEvent.click(input); });
        fireEvent.click(screen.getByRole('button', { name: 'Palette #3b82f6' }));
        expect(onInput).toHaveBeenCalledTimes(1);
        expect(onInput).toHaveBeenLastCalledWith('#3b82f6');
        expect(onChange).toHaveBeenLastCalledWith('#3b82f6');
        expect(input.value).toBe('#3b82f6');
        // Picking the colour the field already has is not a change.
        fireEvent.click(screen.getByRole('button', { name: 'Palette #3b82f6' }));
        expect(onInput).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', { name: 'Done' }));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.activeElement).toBe(input);
        // Reopened: the pick is listed under Recent.
        act(() => { fireEvent.click(input); });
        expect(within(screen.getByRole('group', { name: 'Recent colours' })).getByRole('button', { name: 'Recent #3b82f6' })).toBeTruthy();
    });

    it('commitToColourInput ignores disabled and detached inputs', () => {
        const input = document.createElement('input');
        input.type = 'color';
        const seen = vi.fn();
        input.addEventListener('input', seen);
        commitToColourInput(input, '#123456'); // detached
        document.body.appendChild(input);
        input.disabled = true;
        commitToColourInput(input, '#123456');
        expect(seen).not.toHaveBeenCalled();
        input.disabled = false;
        commitToColourInput(input, '#123456');
        expect(seen).toHaveBeenCalledTimes(1);
        input.remove();
    });
});
