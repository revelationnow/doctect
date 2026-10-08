import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SidebarDrawer } from '../../components/editor-layout/SidebarDrawer';
import { PropertiesSheet, SHEET_PEEK_PX } from '../../components/editor-layout/PropertiesSheet';

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
});

describe('PropertiesSheet', () => {
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
        const grabber = () => screen.getByRole('button', { name: 'Resize properties sheet' });
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
        const grabber = screen.getByRole('button', { name: 'Resize properties sheet' });
        const innerHeight = window.innerHeight;
        // jsdom has no PointerEvent; like useCanvasTouchGestures.test, dispatch MouseEvents under the
        // pointer event names so clientY survives (fireEvent.pointerUp would drop it).
        const pointer = (type: 'pointerdown' | 'pointerup', clientY: number) =>
            grabber.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientY }));
        const drag = (fromY: number, toY: number) => { pointer('pointerdown', fromY); pointer('pointerup', toY); fireEvent.click(grabber); };

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

        // A cancelled pointer leaves no stale start: the next click is a plain tap.
        pointer('pointerdown', innerHeight * 0.95);
        grabber.dispatchEvent(new MouseEvent('pointercancel', { bubbles: true, cancelable: true }));
        fireEvent.click(grabber);
        expect(onDetentChange).toHaveBeenCalledTimes(5);
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
