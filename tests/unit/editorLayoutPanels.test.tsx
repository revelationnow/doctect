import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SidebarDrawer } from '../../components/editor-layout/SidebarDrawer';
import { PropertiesSheet, SHEET_PEEK_PX } from '../../components/editor-layout/PropertiesSheet';

// jsdom has no PointerEvent; like useCanvasTouchGestures.test, dispatch MouseEvents under the
// pointer event names so clientY survives (fireEvent.pointerUp would drop it). `isPrimary` is
// absent on jsdom's MouseEvent, so it is defined explicitly only when a test needs a second finger.
const pointer = (target: Element, type: 'pointerdown' | 'pointerup' | 'pointercancel', clientY: number, isPrimary?: boolean) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY });
    if (isPrimary !== undefined) Object.defineProperty(event, 'isPrimary', { value: isPrimary });
    target.dispatchEvent(event);
};

describe('SidebarDrawer', () => {
    it('renders children only while open and closes on backdrop and Escape', () => {
        const onClose = vi.fn();
        const { rerender } = render(<SidebarDrawer open={false} onClose={onClose}><p>tree</p></SidebarDrawer>);
        expect(screen.queryByText('tree')).toBeNull();
        rerender(<SidebarDrawer open onClose={onClose}><p>tree</p></SidebarDrawer>);
        expect(screen.getByRole('dialog', { name: 'Pages and templates' })).toBeTruthy();
        fireEvent.click(screen.getByTestId('sidebar-drawer-backdrop'));
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('stops listening for Escape once closed', () => {
        const onClose = vi.fn();
        const { rerender } = render(<SidebarDrawer open onClose={onClose}><p>tree</p></SidebarDrawer>);
        rerender(<SidebarDrawer open={false} onClose={onClose}><p>tree</p></SidebarDrawer>);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('keeps the drawer when Escape is aimed at an editable field inside it', () => {
        // The Sidebar's rename input cancels its edit on Escape without stopping propagation.
        const onClose = vi.fn();
        render(
            <SidebarDrawer open onClose={onClose}>
                <input aria-label="Rename page" />
                <textarea aria-label="Notes" />
                <div contentEditable data-testid="rich" />
                <button type="button">Plain</button>
            </SidebarDrawer>,
        );
        fireEvent.keyDown(screen.getByLabelText('Rename page'), { key: 'Escape' });
        fireEvent.keyDown(screen.getByLabelText('Notes'), { key: 'Escape' });
        fireEvent.keyDown(screen.getByTestId('rich'), { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();
        // A non-editable child still lets Escape through to the drawer.
        fireEvent.keyDown(screen.getByRole('button', { name: 'Plain' }), { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('moves focus into the panel on open and restores it to the opener on close', () => {
        function Owner() {
            const [open, setOpen] = useState(false);
            return (
                <>
                    <button type="button" onClick={() => setOpen(true)}>Open pages and templates</button>
                    <SidebarDrawer open={open} onClose={() => setOpen(false)}><button type="button">Page</button></SidebarDrawer>
                </>
            );
        }
        render(<Owner />);
        const trigger = screen.getByRole('button', { name: 'Open pages and templates' });
        trigger.focus();
        fireEvent.click(trigger);
        const dialog = screen.getByRole('dialog', { name: 'Pages and templates' });
        expect(document.activeElement).toBe(dialog);
        // Focus moved on by the user inside the drawer still comes back to the opener on close.
        screen.getByRole('button', { name: 'Page' }).focus();
        fireEvent.click(screen.getByTestId('sidebar-drawer-backdrop'));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.activeElement).toBe(trigger);
    });

    it('does not restore focus to an opener that has since left the document', () => {
        function Owner({ keepTrigger }: { keepTrigger: boolean }) {
            const [open, setOpen] = useState(false);
            return (
                <>
                    {keepTrigger && <button type="button" onClick={() => setOpen(true)}>Open pages and templates</button>}
                    <button type="button" onClick={() => setOpen(false)}>Elsewhere</button>
                    <SidebarDrawer open={open} onClose={() => setOpen(false)}><p>tree</p></SidebarDrawer>
                </>
            );
        }
        const { rerender } = render(<Owner keepTrigger />);
        const trigger = screen.getByRole('button', { name: 'Open pages and templates' });
        trigger.focus();
        fireEvent.click(trigger);
        rerender(<Owner keepTrigger={false} />);
        const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
        elsewhere.focus();
        fireEvent.click(elsewhere);
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.activeElement).toBe(elsewhere);
    });

    it('keeps the drawer when a child already consumed Escape', () => {
        const onClose = vi.fn();
        render(
            <SidebarDrawer open onClose={onClose}>
                <button type="button" onKeyDown={(e) => { if (e.key === 'Escape') e.preventDefault(); }}>Consumer</button>
            </SidebarDrawer>,
        );
        fireEvent.keyDown(screen.getByRole('button', { name: 'Consumer' }), { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

describe('PropertiesSheet', () => {
    const grabber = () => screen.getByRole('button', { name: 'Resize properties sheet' });

    it('shows peek height and cycles detents from the grabber', () => {
        const onDetentChange = vi.fn();
        render(<PropertiesSheet detent="peek" onDetentChange={onDetentChange} title="Rectangle"><p>props</p></PropertiesSheet>);
        const sheet = screen.getByTestId('properties-sheet');
        expect(sheet.style.height).toBe(`${SHEET_PEEK_PX}px`);
        expect(screen.getByText('Rectangle')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Resize properties sheet' }));
        expect(onDetentChange).toHaveBeenCalledWith('half');
    });

    it('uses dynamic viewport heights for half and full', () => {
        const { rerender } = render(<PropertiesSheet detent="half" onDetentChange={() => {}} title="x"><p /></PropertiesSheet>);
        expect(screen.getByTestId('properties-sheet').style.height).toBe('50dvh');
        rerender(<PropertiesSheet detent="full" onDetentChange={() => {}} title="x"><p /></PropertiesSheet>);
        expect(screen.getByTestId('properties-sheet').style.height).toBe('calc(100dvh - 56px)');
    });

    it('cycles half → full → peek on successive taps and hides content only at peek', () => {
        const onDetentChange = vi.fn();
        const { rerender } = render(<PropertiesSheet detent="half" onDetentChange={onDetentChange} title="x"><p>props</p></PropertiesSheet>);
        expect(screen.getByText('props').closest('[hidden]')).toBeNull();
        fireEvent.click(grabber());
        expect(onDetentChange).toHaveBeenLastCalledWith('full');
        rerender(<PropertiesSheet detent="full" onDetentChange={onDetentChange} title="x"><p>props</p></PropertiesSheet>);
        fireEvent.click(grabber());
        expect(onDetentChange).toHaveBeenLastCalledWith('peek');
        rerender(<PropertiesSheet detent="peek" onDetentChange={onDetentChange} title="x"><p>props</p></PropertiesSheet>);
        expect(screen.getByText('props').closest('[hidden]')).not.toBeNull();
    });

    it('lands a drag on the detent nearest the release point and swallows the trailing click', () => {
        const onDetentChange = vi.fn();
        render(<PropertiesSheet detent="peek" onDetentChange={onDetentChange} title="x"><p /></PropertiesSheet>);
        const button = grabber();
        const innerHeight = window.innerHeight;
        // A mouse drag: browsers fire click after pointerup even when the pointer moved.
        const drag = (fromY: number, toY: number) => { pointer(button, 'pointerdown', fromY); pointer(button, 'pointerup', toY); fireEvent.click(button); };

        // Drag from the bottom of the screen up to 10% from the top → full.
        drag(innerHeight * 0.95, innerHeight * 0.1);
        expect(onDetentChange).toHaveBeenCalledTimes(1);
        expect(onDetentChange).toHaveBeenLastCalledWith('full');

        // Release in the middle band → half.
        drag(innerHeight * 0.95, innerHeight * 0.5);
        expect(onDetentChange).toHaveBeenCalledTimes(2);
        expect(onDetentChange).toHaveBeenLastCalledWith('half');

        // Release near the bottom → peek.
        drag(innerHeight * 0.2, innerHeight * 0.9);
        expect(onDetentChange).toHaveBeenCalledTimes(3);
        expect(onDetentChange).toHaveBeenLastCalledWith('peek');

        // A short press (< 24px of travel) is a tap: the click cycles instead.
        drag(innerHeight * 0.95, innerHeight * 0.95 - 10);
        expect(onDetentChange).toHaveBeenCalledTimes(4);
        expect(onDetentChange).toHaveBeenLastCalledWith('half');
    });

    it('does not swallow the tap that follows a touch drag (touch fires no trailing click)', () => {
        const onDetentChange = vi.fn();
        render(<PropertiesSheet detent="peek" onDetentChange={onDetentChange} title="x"><p /></PropertiesSheet>);
        const button = grabber();
        const innerHeight = window.innerHeight;

        // Touch drag: pointerdown → pointerup ≥ 24px away, and NO click afterwards.
        pointer(button, 'pointerdown', innerHeight * 0.95);
        pointer(button, 'pointerup', innerHeight * 0.1);
        expect(onDetentChange).toHaveBeenCalledTimes(1);
        expect(onDetentChange).toHaveBeenLastCalledWith('full');

        // The next real tap must cycle, not be eaten by a stale suppress flag.
        pointer(button, 'pointerdown', innerHeight * 0.95);
        pointer(button, 'pointerup', innerHeight * 0.95 - 5);
        fireEvent.click(button);
        expect(onDetentChange).toHaveBeenCalledTimes(2);
        expect(onDetentChange).toHaveBeenLastCalledWith('half');
    });

    it('forgets the start of a cancelled pointer so the next release is not read as a drag', () => {
        const onDetentChange = vi.fn();
        render(<PropertiesSheet detent="peek" onDetentChange={onDetentChange} title="x"><p /></PropertiesSheet>);
        const button = grabber();
        const innerHeight = window.innerHeight;

        pointer(button, 'pointerdown', innerHeight * 0.95);
        pointer(button, 'pointercancel', innerHeight * 0.5);
        // Without the reset this release would read as a 0.95h → 0.1h drag and land on 'full'.
        pointer(button, 'pointerup', innerHeight * 0.1);
        fireEvent.click(button);
        expect(onDetentChange).toHaveBeenCalledTimes(1);
        expect(onDetentChange).toHaveBeenLastCalledWith('half');
    });

    it('ignores a second finger on the grabber', () => {
        const onDetentChange = vi.fn();
        render(<PropertiesSheet detent="peek" onDetentChange={onDetentChange} title="x"><p /></PropertiesSheet>);
        const button = grabber();
        const innerHeight = window.innerHeight;

        // A non-primary pointer dragging the full height must neither land a detent nor arm the
        // click suppressor; the primary tap that follows cycles as normal.
        pointer(button, 'pointerdown', innerHeight * 0.95, false);
        pointer(button, 'pointerup', innerHeight * 0.1, false);
        expect(onDetentChange).not.toHaveBeenCalled();
        fireEvent.click(button);
        expect(onDetentChange).toHaveBeenCalledTimes(1);
        expect(onDetentChange).toHaveBeenLastCalledWith('half');
    });

    it('renders the actions slot beside the title', () => {
        render(
            <PropertiesSheet detent="peek" onDetentChange={() => {}} title="x" actions={<button type="button">Delete</button>}>
                <p />
            </PropertiesSheet>,
        );
        expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
    });
});
