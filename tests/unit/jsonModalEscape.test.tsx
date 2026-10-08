import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JsonModal } from '../../components/JsonModal';
import { FormFactorProvider } from '../../components/editor-layout/FormFactorContext';
import { BackDismissProvider, overlayDepthOf } from '../../components/editor-layout/useBackDismiss';
import { DISCARD_JSON_CHANGES_MESSAGE } from '../../components/json/discardJsonChanges';

// Task 21: Escape closes the JSON editor on every form factor (an approved desktop change). With
// unapplied changes it asks the same "Discard JSON changes?" question as the touch back gesture.

const state = {
    nodes: { root: { id: 'root', parentId: null, type: 'page', title: 'Root', data: {}, children: [] } },
    rootId: 'root',
    variants: { default: { id: 'default', name: 'Default', templates: { page: { id: 'page', name: 'Page', width: 500, height: 700, elements: [] } } } },
    activeVariantId: 'default',
    schemaVersion: 12,
} as any;

const renderModal = (formFactor: 'desktop' | 'tablet' | 'phone', onClose = vi.fn()) => {
    render(
        <FormFactorProvider value={formFactor}>
            <JsonModal isOpen currentState={state} onSave={vi.fn()} onClose={onClose} />
        </FormFactorProvider>,
    );
    return onClose;
};
const escape = (target: Element | Window = window) => fireEvent.keyDown(target, { key: 'Escape' });
const editText = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Text' }));
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: `${textarea.value}\n` } });
    return textarea;
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); document.documentElement.removeAttribute('data-form-factor'); });

describe('JsonModal Escape', () => {
    it.each(['desktop', 'tablet', 'phone'] as const)('closes the editor on %s when nothing is unapplied, without asking', formFactor => {
        const confirm = vi.spyOn(window, 'confirm');
        const onClose = renderModal(formFactor);
        escape();
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(confirm).not.toHaveBeenCalled();
    });

    it('asks before discarding unapplied text edits: cancelling keeps the editor and its text, agreeing closes it', () => {
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        const onClose = renderModal('desktop');
        const textarea = editText();
        escape(textarea); // Escape pressed inside the text editor reaches the dialog's handler
        expect(confirm).toHaveBeenCalledWith(DISCARD_JSON_CHANGES_MESSAGE);
        expect(onClose).not.toHaveBeenCalled();
        expect(textarea.value.endsWith('\n')).toBe(true);
        confirm.mockReturnValue(true);
        escape(textarea);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('asks before discarding unapplied visual edits', () => {
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        const onClose = renderModal('desktop');
        fireEvent.click(screen.getByRole('button', { name: 'Add Variant' }));
        escape();
        expect(confirm).toHaveBeenCalledWith(DISCARD_JSON_CHANGES_MESSAGE);
        expect(onClose).not.toHaveBeenCalled();
    });

    it('leaves an Escape alone that a child already handled, and marks its own as handled', () => {
        const onClose = renderModal('desktop');
        const handled = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true });
        handled.preventDefault();
        act(() => { window.dispatchEvent(handled); });
        expect(onClose).not.toHaveBeenCalled();
        const own = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true });
        act(() => { window.dispatchEvent(own); });
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(own.defaultPrevented).toBe(true);
    });

    it('leaves an Escape alone that comes from a <select>, which closes its own dropdown with it', () => {
        const onClose = renderModal('desktop');
        // The visual editor's "Add" type picker: expand the root node and start adding a property.
        fireEvent.click(screen.getByText('Root'));
        fireEvent.click(screen.getAllByRole('button', { name: 'Add Property' })[0]); // the node's own; its data object has one too
        const select = screen.getByRole('combobox');
        expect(select.tagName).toBe('SELECT');
        const fromSelect = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true });
        act(() => { select.dispatchEvent(fromSelect); });
        expect(onClose).not.toHaveBeenCalled();
        expect(fromSelect.defaultPrevented).toBe(false);
        escape(); // from anywhere else it still closes (the open add form has changed nothing)
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('ignores other keys and does nothing once closed', () => {
        const onClose = vi.fn();
        const { rerender } = render(<JsonModal isOpen currentState={state} onSave={vi.fn()} onClose={onClose} />);
        fireEvent.keyDown(window, { key: 'Enter' });
        expect(onClose).not.toHaveBeenCalled();
        rerender(<JsonModal isOpen={false} currentState={state} onSave={vi.fn()} onClose={onClose} />);
        escape();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('on a phone, closing with Escape consumes the dialog\'s back-gesture entry like any other close', () => {
        function Host() {
            const [open, setOpen] = useState(true);
            return <JsonModal isOpen={open} currentState={state} onSave={vi.fn()} onClose={() => setOpen(false)} />;
        }
        const router = createMemoryRouter([
            { path: '/app', element: <FormFactorProvider value="phone"><BackDismissProvider><Host /></BackDismissProvider></FormFactorProvider> },
            { path: '/', element: <div>home route</div> },
        ], { initialEntries: ['/', '/app'], initialIndex: 1 });
        render(<RouterProvider router={router} />);
        expect(overlayDepthOf(router.state.location)).toBe(1);
        escape();
        expect(screen.queryByRole('heading', { name: 'Project JSON Editor' })).toBeNull();
        expect(overlayDepthOf(router.state.location)).toBe(0);
        expect(router.state.location.pathname).toBe('/app');
    });
});
