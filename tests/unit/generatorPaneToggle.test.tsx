import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { generatorErrorPane } from '../../services/generatorErrorPane';
import { HierarchyGeneratorModal } from '../../components/HierarchyGeneratorModal';
import { FormFactorProvider } from '../../components/editor-layout/FormFactorContext';

describe('generatorErrorPane', () => {
    it.each([
        ['Template: page elements must be an array.', 'template'],
        ['Template script exceeds 512 KiB.', 'template'],
        ['Hierarchy: Node x parentId does not match.', 'hierarchy'],
        ['Hierarchy script exceeds 512 KiB.', 'hierarchy'],
        ['Runtime: boom', null],
        ['Combined generator source exceeds 1 MiB.', null],
    ] as const)('%s -> %s', (message, pane) => {
        expect(generatorErrorPane(message)).toBe(pane);
    });
});

const renderModal = (formFactor: 'desktop' | 'phone') => render(
    <FormFactorProvider value={formFactor}>
        <HierarchyGeneratorModal isOpen projectName="P" onClose={vi.fn()}
            onApplyGenerated={vi.fn(() => true)} onCreateGeneratedProject={vi.fn(async () => false)} />
    </FormFactorProvider>,
);

describe('Generator pane toggle', () => {
    it('shows one pane at a time on touch and keeps both drafts', () => {
        renderModal('phone');
        const template = screen.getByLabelText('Template script') as HTMLTextAreaElement;
        const hierarchy = screen.getByLabelText('Hierarchy script') as HTMLTextAreaElement;
        expect(template.closest('[data-generator-pane]')!.className).not.toContain('hidden');
        expect(hierarchy.closest('[data-generator-pane]')!.className).toContain('hidden');
        fireEvent.change(template, { target: { value: 'return { templates: {} };' } });
        fireEvent.click(screen.getByRole('tab', { name: 'Hierarchy' }));
        expect(template.closest('[data-generator-pane]')!.className).toContain('hidden');
        expect(template.value).toBe('return { templates: {} };');
    });

    it('shows a red dot on the hidden segment whose script has the run error', () => {
        renderModal('phone');
        fireEvent.change(screen.getByLabelText('Template script'), { target: { value: 'x'.repeat(512 * 1024 + 1) } });
        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
        expect(screen.getByRole('alert').textContent).toContain('Template script exceeds 512 KiB.');
        // The erroring script is the visible one: no dot anywhere.
        expect(screen.queryByLabelText('Has error')).toBeNull();
        fireEvent.click(screen.getByRole('tab', { name: 'Hierarchy' }));
        const templateTab = screen.getByRole('tab', { name: /^Template/ });
        expect(templateTab.querySelector('[aria-label="Has error"]')).not.toBeNull();
        expect(screen.getByRole('tab', { name: 'Hierarchy' }).querySelector('[aria-label="Has error"]')).toBeNull();
        fireEvent.click(templateTab);
        expect(screen.queryByLabelText('Has error')).toBeNull();
    });

    it('keeps side-by-side panes and no toggle on desktop', () => {
        renderModal('desktop');
        expect(screen.queryByRole('tab', { name: 'Hierarchy' })).toBeNull();
        const panes = document.querySelectorAll('[data-generator-pane]');
        expect(panes[0].className).toBe('flex-1 flex flex-col border-r-4 border-slate-500');
        expect(panes[1].className).toBe('flex-1 flex flex-col');
    });
});
