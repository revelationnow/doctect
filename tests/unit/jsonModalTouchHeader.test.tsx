import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JsonModal } from '../../components/JsonModal';
import { FormFactorProvider } from '../../components/editor-layout/FormFactorContext';

// I2: the JSON editor's header (title, Visual|Text toggle, Close) is ~380px wide, so at 320px the
// Close button sat off-screen with nothing but the footer to leave by. On phones the toggle drops
// below the title on its own full-width line and Close stays on the title row; tablets (the
// panel is not full-screen there and the row fits) and desktop keep the one-row header.

const state = {
    nodes: { root: { id: 'root', parentId: null, type: 'page', title: 'Root', data: {}, children: [] } },
    rootId: 'root',
    variants: { default: { id: 'default', name: 'Default', templates: { page: { id: 'page', name: 'Page', width: 500, height: 700, elements: [] } } } },
    activeVariantId: 'default',
    schemaVersion: 12,
} as any;

const renderModal = (formFactor: 'desktop' | 'tablet' | 'phone') => render(
    <FormFactorProvider value={formFactor}>
        <JsonModal isOpen currentState={state} onSave={vi.fn()} onClose={vi.fn()} />
    </FormFactorProvider>,
);

const header = () => screen.getByRole('heading', { name: 'Project JSON Editor' }).closest('.border-b') as HTMLElement;
const toggle = () => screen.getByRole('button', { name: 'Visual' }).parentElement as HTMLElement;
const close = () => screen.getByRole('button', { name: 'Close JSON editor' });

afterEach(() => { document.documentElement.removeAttribute('data-form-factor'); });

describe('JsonModal header on touch', () => {
    it('names the close button for assistive tech on every form factor', () => {
        for (const formFactor of ['desktop', 'tablet', 'phone'] as const) {
            const { unmount } = renderModal(formFactor);
            expect(close().getAttribute('aria-label')).toBe('Close JSON editor');
            unmount();
        }
    });

    it('wraps the header on phones: the mode toggle takes its own line and Close stays on the title row', () => {
        renderModal('phone');
        expect(header().className).toMatch(/\bflex-wrap\b/);
        expect(toggle().className).toMatch(/\border-last\b/);
        expect(toggle().className).toMatch(/\bw-full\b/);
        for (const name of ['Visual', 'Text']) expect(screen.getByRole('button', { name }).className).toMatch(/\bflex-1\b/);
        expect(close().className).toMatch(/\bshrink-0\b/);
        // Title shrinks (wrapping its text) rather than pushing Close off the row.
        expect(screen.getByRole('heading', { name: 'Project JSON Editor' }).parentElement!.parentElement!.className).toMatch(/\bmin-w-0\b/);
    });

    it('keeps the one-row header class strings on tablet and desktop', () => {
        for (const formFactor of ['tablet', 'desktop'] as const) {
            const { unmount } = renderModal(formFactor);
            expect(header().className, formFactor).toBe('flex justify-between items-center p-4 border-b bg-slate-50 flex-shrink-0');
            expect(toggle().className, formFactor).toBe('flex items-center gap-4 bg-white p-1 rounded-lg border border-slate-200');
            expect(close().className, formFactor).toBe('p-2 hover:bg-slate-200 rounded-full text-slate-500 transition-colors');
            expect(screen.getByRole('heading', { name: 'Project JSON Editor' }).parentElement!.parentElement!.className, formFactor).toBe('flex items-center gap-3');
            unmount();
        }
    });
});
