import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { generatorErrorPane } from '../../services/generatorErrorPane';
import { HierarchyGeneratorModal } from '../../components/HierarchyGeneratorModal';
import { FormFactorProvider } from '../../components/editor-layout/FormFactorContext';

const runGeneratorSandbox = vi.hoisted(() => vi.fn());
vi.mock('../../services/generatorSandbox', () => ({ runGeneratorSandbox }));

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

    it('prefers the sandbox phase and falls back to the message prefix without one', () => {
        expect(generatorErrorPane('Runtime: boom', 'hierarchy')).toBe('hierarchy');
        expect(generatorErrorPane('Clone: cyclic value', 'template')).toBe('template');
        expect(generatorErrorPane('Template: bad', undefined)).toBe('template');
        expect(generatorErrorPane('Timeout: Generator exceeded the 10000 ms execution limit.', null)).toBeNull();
    });
});

const renderModal = (formFactor: 'desktop' | 'tablet' | 'phone') => render(
    <FormFactorProvider value={formFactor}>
        <HierarchyGeneratorModal isOpen projectName="P" onClose={vi.fn()}
            onApplyGenerated={vi.fn(() => true)} onCreateGeneratedProject={vi.fn(async () => false)} />
    </FormFactorProvider>,
);

const pane = (label: string) => screen.getByLabelText(label).closest('[data-generator-pane]') as HTMLElement;
const dot = (tab: HTMLElement) => tab.querySelector('[data-error-dot]');

describe('Generator pane toggle', () => {
    it('shows one pane at a time on touch and keeps both drafts', () => {
        renderModal('phone');
        const template = screen.getByLabelText('Template script') as HTMLTextAreaElement;
        const hierarchy = screen.getByLabelText('Hierarchy script') as HTMLTextAreaElement;
        expect(pane('Template script').className).not.toContain('hidden');
        expect(pane('Hierarchy script').className).toContain('hidden');
        expect(document.body.contains(pane('Hierarchy script'))).toBe(true);
        fireEvent.change(template, { target: { value: 'return { templates: {} };' } });
        fireEvent.change(hierarchy, { target: { value: 'return { nodes: {} };' } });
        fireEvent.click(screen.getByRole('tab', { name: 'Hierarchy' }));
        expect(pane('Template script').className).toContain('hidden');
        expect(pane('Hierarchy script').className).not.toContain('hidden');
        expect(document.body.contains(pane('Template script'))).toBe(true);
        expect(template.value).toBe('return { templates: {} };');
        expect(hierarchy.value).toBe('return { nodes: {} };');
    });

    it('wires each tab to its panel on touch', () => {
        renderModal('phone');
        for (const [name, label] of [['Template', 'Template script'], ['Hierarchy', 'Hierarchy script']] as const) {
            const tab = screen.getByRole('tab', { name });
            const panel = pane(label);
            expect(tab.id).not.toBe('');
            expect(tab.getAttribute('aria-controls')).toBe(panel.id);
            expect(panel.getAttribute('role')).toBe('tabpanel');
            expect(panel.getAttribute('aria-labelledby')).toBe(tab.id);
        }
        expect(screen.getByRole('tab', { name: 'Template' }).getAttribute('aria-selected')).toBe('true');
        expect(screen.getByRole('tab', { name: 'Hierarchy' }).getAttribute('aria-selected')).toBe('false');
    });

    it('shows the toggle and the full-screen panel classes on tablet too', () => {
        renderModal('tablet');
        expect(screen.getByRole('tablist', { name: 'Generator scripts' })).not.toBeNull();
        expect(screen.getAllByRole('tab')).toHaveLength(2);
        expect(pane('Hierarchy script').className).toContain('hidden');
        expect(screen.getByRole('dialog').className).toContain('editor-dialog-panel generator-dialog-panel');
    });

    it('shows a red dot on the hidden segment whose script has the run error', () => {
        renderModal('phone');
        fireEvent.change(screen.getByLabelText('Template script'), { target: { value: 'x'.repeat(512 * 1024 + 1) } });
        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
        expect(screen.getByRole('alert').textContent).toContain('Template script exceeds 512 KiB.');
        // The erroring script is the visible one: no dot anywhere.
        expect(document.querySelector('[data-error-dot]')).toBeNull();
        fireEvent.click(screen.getByRole('tab', { name: 'Hierarchy' }));
        const templateTab = screen.getByRole('tab', { name: /^Template/ });
        expect(dot(templateTab)).not.toBeNull();
        expect(dot(templateTab)!.getAttribute('aria-hidden')).toBe('true');
        expect(templateTab.textContent).toBe('Template, has error');
        expect(dot(screen.getByRole('tab', { name: 'Hierarchy' }))).toBeNull();
        fireEvent.click(templateTab);
        expect(document.querySelector('[data-error-dot]')).toBeNull();
        expect(templateTab.textContent).toBe('Template');
    });

    it('attributes a sandbox runtime error to the hidden script via its phase', async () => {
        runGeneratorSandbox.mockResolvedValueOnce({ ok: false, category: 'runtime', message: 'boom', phase: 'hierarchy' });
        renderModal('phone');
        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
        expect((await screen.findByRole('alert')).textContent).toContain('Runtime: boom');
        const hierarchyTab = screen.getByRole('tab', { name: /^Hierarchy/ });
        expect(dot(hierarchyTab)).not.toBeNull();
        expect(hierarchyTab.textContent).toBe('Hierarchy, has error');
        expect(dot(screen.getByRole('tab', { name: 'Template' }))).toBeNull();
        fireEvent.click(hierarchyTab);
        expect(document.querySelector('[data-error-dot]')).toBeNull();
        expect(pane('Hierarchy script').className).not.toContain('hidden');
    });

    // C1: the two header rows are ~880px wide, so on touch they wrap: Close stays on the title row
    // at its right end, the preset box drops to its own full-width line with a shrinkable select,
    // and the Preview / Apply group wraps and right-aligns. Desktop keeps its class strings.
    it('wraps both header rows on touch with Close pinned to the title row, and leaves desktop classes alone', () => {
        const header = () => screen.getByRole('heading', { name: 'Hierarchy Generator' }).closest('.border-b') as HTMLElement;
        const toolbar = () => screen.getByRole('button', { name: 'Preview' }).closest('.border-b') as HTMLElement;
        const presetBox = () => screen.getByLabelText('Preset:').parentElement as HTMLElement;
        const close = () => screen.getByRole('button', { name: 'Close generator' });

        for (const formFactor of ['phone', 'tablet'] as const) {
            const { unmount } = renderModal(formFactor);
            expect(header().className, formFactor).toMatch(/\bflex-wrap\b/);
            expect(presetBox().className, formFactor).toMatch(/\border-last\b/);
            expect(presetBox().className, formFactor).toMatch(/\bw-full\b/);
            expect(presetBox().className, formFactor).toMatch(/\bmin-w-0\b/);
            expect((screen.getByLabelText('Preset:') as HTMLSelectElement).className, formFactor).toMatch(/\bmin-w-0\b/);
            expect(close().className, formFactor).toMatch(/\bshrink-0\b/);
            expect(close().previousElementSibling, `${formFactor}: Close follows the preset box in DOM order`).toBe(presetBox());
            // The group around the preset box and Close dissolves (display: contents) so Close is a
            // header flex item of its own and can sit on the title row while the box wraps.
            expect(close().parentElement!.className, formFactor).toMatch(/\bcontents\b/);
            expect(toolbar().className, formFactor).toMatch(/\bflex-wrap\b/);
            expect(screen.getByRole('button', { name: 'Apply Generated Project' }).parentElement!.className, formFactor).toMatch(/\bflex-wrap\b/);
            expect(screen.getByRole('button', { name: 'Wrap' }).parentElement!.className, formFactor).toMatch(/\bflex-wrap\b/);
            unmount();
        }

        renderModal('desktop');
        expect(header().className).toBe('flex justify-between items-center p-4 border-b bg-slate-50');
        expect(close().parentElement!.className).toBe('flex items-center gap-3');
        expect(presetBox().className).toBe('flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 shadow-sm');
        expect((screen.getByLabelText('Preset:') as HTMLSelectElement).className).toBe('text-sm font-medium text-slate-700 bg-transparent border-none focus:outline-none cursor-pointer');
        expect(close().className).toBe('p-2 hover:bg-slate-200 rounded-full text-slate-500 transition-colors');
        expect(toolbar().className).toBe('flex items-center justify-between px-4 py-2 border-b bg-white');
        expect(screen.getByRole('button', { name: 'Apply Generated Project' }).parentElement!.className).toBe('flex items-center gap-3');
        expect(screen.getByRole('button', { name: 'Wrap' }).parentElement!.className).toBe('flex items-center gap-4');
    });

    it('keeps side-by-side panes and no toggle on desktop', () => {
        renderModal('desktop');
        expect(screen.queryByRole('tab', { name: 'Hierarchy' })).toBeNull();
        expect(screen.queryByRole('tablist')).toBeNull();
        const panes = document.querySelectorAll('[data-generator-pane]');
        expect(panes[0].className).toBe('flex-1 flex flex-col border-r-4 border-slate-500');
        expect(panes[1].className).toBe('flex-1 flex flex-col');
        for (const wrapper of panes) expect(wrapper.getAttributeNames().sort()).toEqual(['class', 'data-generator-pane']);
    });
});
