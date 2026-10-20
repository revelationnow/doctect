import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NodeItem } from '../../components/sidebar/NodeItem';
import { TemplateItem } from '../../components/sidebar/TemplateItem';
import { FormFactorProvider } from '../../components/editor-layout/FormFactorContext';
import type { FormFactor } from '../../hooks/useEditorFormFactor';
import type { AppNode, AppState, PageTemplate } from '../../types';

const LONG = 'Family Archive – Grandparents on the maternal side';
const node = (id: string, parentId: string | null, title: string, children: string[] = [], referenceId?: string): AppNode =>
    ({ id, parentId, type: 't', title, data: {}, children, ...(referenceId ? { referenceId } : {}) });
const state = {
    rootId: 'root', viewMode: 'hierarchy', selectedNodeId: null, selectedNodeIds: [],
    nodes: {
        root: node('root', null, 'Book', ['long', 'ref']),
        long: node('long', 'root', LONG, ['leaf']),
        leaf: node('leaf', 'long', 'Person 01'),
        ref: node('ref', 'root', 'Linked chart', [], 'leaf'),
    },
} as unknown as AppState;

function renderTree(formFactor: FormFactor, input?: 'mouse' | 'touch') {
    const handlers = {
        onSelect: vi.fn(), onAdd: vi.fn(), onAddRef: vi.fn(), onDelete: vi.fn(), onDuplicate: vi.fn(), onUpdate: vi.fn(),
    };
    render(<FormFactorProvider value={formFactor} input={input}><NodeItem nodeId="root" state={state} depth={0} {...handlers} /></FormFactorProvider>);
    return handlers;
}

const actionLabels = (sheet: HTMLElement) => within(sheet).getAllByRole('button').map(button => button.textContent);

describe('sidebar rows on desktop', () => {
    it('keeps the hover actions and has no ⋯ button', () => {
        renderTree('desktop');
        expect(screen.getAllByTitle('Add New Page').length).toBeGreaterThan(0);
        expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /^(Expand|Collapse) / })).toBeNull();
    });
});

describe.each(['phone', 'tablet'] as const)('sidebar rows in a narrow mouse window (%s layout)', formFactor => {
    it('keeps the hover actions and has no ⋯ button', () => {
        renderTree(formFactor, 'mouse');
        expect(screen.getAllByTitle('Add New Page').length).toBeGreaterThan(0);
        expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull();
    });
});

describe.each(['phone', 'tablet'] as const)('sidebar rows on %s', formFactor => {
    it('replaces the hover actions with one ⋯ button per row', () => {
        renderTree(formFactor);
        expect(screen.queryByTitle('Add New Page')).toBeNull();
        expect(screen.getByRole('button', { name: 'Actions for Book' })).toBeTruthy();
        expect(screen.getByRole('button', { name: `Actions for ${LONG}` })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Actions for Linked chart' })).toBeTruthy();
    });

    it('offers the actions each row supports, under the row\'s full name', () => {
        renderTree(formFactor);
        fireEvent.click(screen.getByRole('button', { name: 'Actions for Book' }));
        const root = screen.getByRole('dialog', { name: 'Actions for Book' });
        // The root can be neither duplicated nor deleted.
        expect(actionLabels(root)).toEqual(['Rename', 'Add child page', 'Link existing page']);
        fireEvent.click(screen.getByTestId('row-action-sheet-backdrop'));
        expect(screen.queryByRole('dialog')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: `Actions for ${LONG}` }));
        const page = screen.getByRole('dialog', { name: `Actions for ${LONG}` });
        expect(within(page).getByRole('heading').textContent).toBe(LONG);
        expect(actionLabels(page)).toEqual(['Rename', 'Add child page', 'Link existing page', 'Duplicate', 'Delete']);
        fireEvent.click(screen.getByTestId('row-action-sheet-backdrop'));

        // A reference is only duplicated or deleted, like on desktop.
        fireEvent.click(screen.getByRole('button', { name: 'Actions for Linked chart' }));
        expect(actionLabels(screen.getByRole('dialog', { name: 'Actions for Linked chart' }))).toEqual(['Duplicate', 'Delete']);
    });

    it.each([
        ['Add child page', 'onAdd'],
        ['Link existing page', 'onAddRef'],
        ['Duplicate', 'onDuplicate'],
        ['Delete', 'onDelete'],
    ] as const)('%s acts on its row, closes the sheet and does not select the row', (label, handler) => {
        const handlers = renderTree(formFactor);
        fireEvent.click(screen.getByRole('button', { name: `Actions for ${LONG}` }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: label }));
        expect(handlers[handler]).toHaveBeenCalledWith('long');
        expect(handlers.onSelect).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('opening the sheet does not select the row; tapping the name still does', () => {
        const handlers = renderTree(formFactor);
        fireEvent.click(screen.getByRole('button', { name: `Actions for ${LONG}` }));
        expect(handlers.onSelect).not.toHaveBeenCalled();
        fireEvent.click(screen.getByTestId('row-action-sheet-backdrop'));
        fireEvent.click(screen.getByText(LONG));
        expect(handlers.onSelect).toHaveBeenCalledWith('long', false, false);
    });

    it('Rename edits the title in place, with the field focused', () => {
        const handlers = renderTree(formFactor);
        fireEvent.click(screen.getByRole('button', { name: `Actions for ${LONG}` }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Rename' }));
        const input = screen.getByDisplayValue(LONG);
        expect(document.activeElement).toBe(input);
        // The ⋯ button steps aside while the field is open.
        expect(screen.queryByRole('button', { name: `Actions for ${LONG}` })).toBeNull();
        fireEvent.change(input, { target: { value: 'Grandparents' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(handlers.onUpdate).toHaveBeenCalledWith('long', { title: 'Grandparents' });
    });

    it('Escape closes only the sheet and returns focus to its ⋯ button', () => {
        renderTree(formFactor);
        const trigger = screen.getByRole('button', { name: `Actions for ${LONG}` });
        trigger.focus();
        fireEvent.click(trigger);
        const sheet = screen.getByRole('dialog');
        expect(document.activeElement).toBe(sheet);
        const reachedWindow = vi.fn((event: KeyboardEvent) => event.defaultPrevented);
        window.addEventListener('keydown', reachedWindow);
        try {
            fireEvent.keyDown(sheet, { key: 'Escape' });
        } finally {
            window.removeEventListener('keydown', reachedWindow);
        }
        expect(screen.queryByRole('dialog')).toBeNull();
        // The drawer listens on window and ignores an Escape that is already handled.
        expect(reachedWindow).toHaveReturnedWith(true);
        expect(document.activeElement).toBe(trigger);
    });

    it('expands and collapses with a labelled chevron button', () => {
        renderTree(formFactor);
        // Depth 0 starts expanded, deeper rows collapsed.
        expect(screen.queryByText('Person 01')).toBeNull();
        const expand = screen.getByRole('button', { name: `Expand ${LONG}` });
        expect(expand.getAttribute('aria-expanded')).toBe('false');
        fireEvent.click(expand);
        expect(screen.getByText('Person 01')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: `Collapse ${LONG}` }));
        expect(screen.queryByText('Person 01')).toBeNull();
    });
});

describe('template rows', () => {
    const template = { id: 'tpl', name: 'A4 Blank', width: 100, height: 100, elements: [], layers: [] } as unknown as PageTemplate;
    const renderTemplate = (formFactor: FormFactor, input?: 'mouse' | 'touch') => {
        const handlers = { onSelect: vi.fn(), onDelete: vi.fn(), onDuplicate: vi.fn(), onUpdateName: vi.fn() };
        render(<FormFactorProvider value={formFactor} input={input}><TemplateItem template={template} isSelected={false} {...handlers} /></FormFactorProvider>);
        return handlers;
    };

    it('keep the hover actions on desktop', () => {
        renderTemplate('desktop');
        expect(screen.getByTitle('Duplicate')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Actions for A4 Blank' })).toBeNull();
    });

    it('keep the hover actions in a narrow mouse window', () => {
        renderTemplate('tablet', 'mouse');
        expect(screen.getByTitle('Duplicate')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Actions for A4 Blank' })).toBeNull();
    });

    it('put rename, duplicate and delete behind ⋯ on touch', () => {
        const handlers = renderTemplate('phone');
        expect(screen.queryByTitle('Duplicate')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Actions for A4 Blank' }));
        const sheet = screen.getByRole('dialog', { name: 'Actions for A4 Blank' });
        expect(actionLabels(sheet)).toEqual(['Rename', 'Duplicate', 'Delete']);
        fireEvent.click(within(sheet).getByRole('button', { name: 'Duplicate' }));
        expect(handlers.onDuplicate).toHaveBeenCalledTimes(1);
        expect(handlers.onSelect).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Actions for A4 Blank' }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Rename' }));
        const input = screen.getByDisplayValue('A4 Blank');
        expect(document.activeElement).toBe(input);
        fireEvent.change(input, { target: { value: 'Cover' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(handlers.onUpdateName).toHaveBeenCalledWith('Cover');
    });
});
