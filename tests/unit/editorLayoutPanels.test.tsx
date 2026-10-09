import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SidebarDrawer } from '../../components/editor-layout/SidebarDrawer';
import { PropertiesSheet, SHEET_PEEK_PX } from '../../components/editor-layout/PropertiesSheet';
import { layOutEveryElement } from '../helpers/jsdomLayout';

// The drawer's Tab trap skips controls that are not rendered; jsdom renders nothing (see the helper).
layOutEveryElement();

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

    it('leaves focus alone on close when something outside the drawer already holds it', () => {
        // e.g. a confirm dialog that opened on top while the drawer closed underneath it on rotation.
        function Owner() {
            const [open, setOpen] = useState(false);
            return (
                <>
                    <button type="button" onClick={() => setOpen(true)}>Open pages and templates</button>
                    <button type="button" onClick={() => setOpen(false)}>Dialog confirm</button>
                    <SidebarDrawer open={open} onClose={() => setOpen(false)}><p>tree</p></SidebarDrawer>
                </>
            );
        }
        render(<Owner />);
        const trigger = screen.getByRole('button', { name: 'Open pages and templates' });
        trigger.focus();
        fireEvent.click(trigger);
        const confirm = screen.getByRole('button', { name: 'Dialog confirm' });
        confirm.focus();
        fireEvent.click(confirm);
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.activeElement).toBe(confirm);
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

    // The drawer is aria-modal, but nothing behind it is inert: Tab must wrap inside the panel
    // instead of walking out to the canvas. Children that cannot take focus — disabled, hidden
    // (attribute or display:none), aria-hidden, inert, visibility:hidden, tabindex -1 — are not
    // wrap targets: a prevented Tab plus a no-op focus() would otherwise strand the key.
    it('traps Tab inside the open panel, wrapping at both ends and from the panel itself', () => {
        render(
            <>
                <button type="button">Outside</button>
                <SidebarDrawer open onClose={() => {}}>
                    <button type="button">First</button>
                    <input aria-label="Rename" />
                    <button type="button" disabled>Disabled</button>
                    <input hidden aria-label="File" />
                    <span aria-hidden="true"><button type="button">Decorative</button></span>
                    <div style={{ display: 'none' }}><button type="button">Collapsed</button></div>
                    <div inert><button type="button">Inert</button></div>
                    <button type="button" style={{ visibility: 'hidden' }}>Invisible</button>
                    <button type="button" tabIndex={-1}>Programmatic</button>
                    <button type="button">Last</button>
                    <button type="button" style={{ display: 'none' }}>Trailing collapsed</button>
                </SidebarDrawer>
            </>,
        );
        const panel = screen.getByRole('dialog', { name: 'Pages and templates' });
        const first = screen.getByRole('button', { name: 'First' });
        const last = screen.getByRole('button', { name: 'Last' });
        expect(document.activeElement).toBe(panel);
        expect(fireEvent.keyDown(panel, { key: 'Tab' })).toBe(false);
        expect(document.activeElement).toBe(first);
        expect(fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })).toBe(false);
        expect(document.activeElement).toBe(last);
        expect(fireEvent.keyDown(last, { key: 'Tab' })).toBe(false);
        expect(document.activeElement).toBe(first);
        // Between two inner controls the browser moves focus itself: nothing is prevented.
        screen.getByLabelText('Rename').focus();
        expect(fireEvent.keyDown(screen.getByLabelText('Rename'), { key: 'Tab' })).toBe(true);
        expect(document.activeElement).toBe(screen.getByLabelText('Rename'));
        panel.focus();
        expect(fireEvent.keyDown(panel, { key: 'Tab', shiftKey: true })).toBe(false);
        expect(document.activeElement).toBe(last);
        // Other keys pass through.
        expect(fireEvent.keyDown(last, { key: 'Enter' })).toBe(true);
        expect(document.activeElement).toBe(last);
    });

    it('leaves a Tab that a child already handled alone, even at the panel edge', () => {
        // A nested dialog with its own trap (the cloud modals a sheet row opens) prevents the
        // key before the panel's handler runs; the panel must not then wrap focus on top of it.
        render(
            <SidebarDrawer open onClose={() => {}}>
                <button type="button">First</button>
                <button type="button" onKeyDown={event => { if (event.key === 'Tab') event.preventDefault(); }}>Consumer</button>
            </SidebarDrawer>,
        );
        const consumer = screen.getByRole('button', { name: 'Consumer' });
        consumer.focus();
        expect(fireEvent.keyDown(consumer, { key: 'Tab' })).toBe(false); // prevented by the child
        expect(document.activeElement).toBe(consumer);                  // not wrapped to First
        screen.getByRole('button', { name: 'First' }).focus();
        expect(fireEvent.keyDown(screen.getByRole('button', { name: 'First' }), { key: 'Tab', shiftKey: true })).toBe(false);
        expect(document.activeElement).toBe(consumer); // an unhandled edge Tab still wraps
    });

    it('leaves a Tab whose focus sits in a child portal outside the panel to the browser', () => {
        // DOM-outside but React-inside: the keydown bubbles to the panel's handler, which sees
        // the panel holds nothing tabbable and must still not swallow the key or take focus.
        const Portalled = () => createPortal(<button type="button">Portalled</button>, document.body);
        render(<SidebarDrawer open onClose={() => {}}><p>tree</p><Portalled /></SidebarDrawer>);
        const panel = screen.getByRole('dialog', { name: 'Pages and templates' });
        const portalled = screen.getByRole('button', { name: 'Portalled' });
        portalled.focus();
        expect(fireEvent.keyDown(portalled, { key: 'Tab' })).toBe(true);
        expect(document.activeElement).toBe(portalled);
        expect(document.activeElement).not.toBe(panel);
    });

    it('keeps focus on the panel when it holds nothing tabbable', () => {
        render(<SidebarDrawer open onClose={() => {}}><p>tree</p></SidebarDrawer>);
        const panel = screen.getByRole('dialog', { name: 'Pages and templates' });
        expect(fireEvent.keyDown(panel, { key: 'Tab' })).toBe(false);
        expect(document.activeElement).toBe(panel);
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

    // Task 24: the bare grabber did not read as "this opens"; a labelled toggle does.
    it('has a labelled Edit/Done toggle that opens to half and closes to peek', () => {
        const onDetentChange = vi.fn();
        const sheet = (detent: 'peek' | 'half' | 'full') => (
            <PropertiesSheet detent={detent} onDetentChange={onDetentChange} title="x"><p>props</p></PropertiesSheet>
        );
        const { rerender } = render(sheet('peek'));
        const toggle = () => screen.getByTestId('properties-sheet-toggle');
        expect(toggle()).toHaveTextContent('Edit');
        expect(toggle()).toHaveAttribute('aria-expanded', 'false');
        expect(toggle()).toHaveAttribute('aria-controls', screen.getByTestId('properties-sheet-content').id);
        expect(screen.getByTestId('properties-sheet-content')).not.toBeVisible(); // nothing to tab into at peek
        fireEvent.click(toggle());
        expect(onDetentChange).toHaveBeenLastCalledWith('half');
        for (const detent of ['half', 'full'] as const) {
            rerender(sheet(detent));
            expect(toggle()).toHaveTextContent('Done');
            expect(toggle()).toHaveAttribute('aria-expanded', 'true');
            expect(screen.getByTestId('properties-sheet-content')).toBeVisible();
            fireEvent.click(toggle());
            expect(onDetentChange).toHaveBeenLastCalledWith('peek');
        }
        expect(toggle().className).toContain('min-h-11');
    });
});
