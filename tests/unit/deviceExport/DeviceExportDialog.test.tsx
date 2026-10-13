import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppState } from '../../../types';

const trackEvent = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../../../services/analytics', () => ({ trackEvent }));

import { DeviceExportDialog } from '../../../components/export/DeviceExportDialog';
import { FormFactorProvider } from '../../../components/editor-layout/FormFactorContext';

const node = (id: string, type: string, title: string, children: string[] = []) => ({ id, parentId: null, type, title, data: {}, children });
const makeState = (dailyCount: number) => {
    const days = Array.from({ length: dailyCount }, (_, i) => `d${i + 1}`);
    return {
        rootId: 'idx', activeVariantId: 'v',
        nodes: { idx: node('idx', 'index', 'Index', days), ...Object.fromEntries(days.map((id, i) => [id, node(id, 'daily', `Jan ${i + 1}`)])) },
        variants: { v: { id: 'v', name: 'V', templates: {
            index: { id: 'index', name: 'Month index', width: 100, height: 100, layers: [], elements: [] },
            daily: { id: 'daily', name: 'Daily', width: 100, height: 100, layers: [], elements: [] },
        } } },
    } as unknown as AppState;
};

const setup = (overrides: Partial<React.ComponentProps<typeof DeviceExportDialog>> = {}, dailyCount = 5) => {
    const props = {
        isOpen: true, onClose: vi.fn(), getState: () => makeState(dailyCount), projectName: 'Plan', initialForceGreyscale: false,
        runExport: vi.fn(async () => ({ blob: new Blob(['zip']), fileName: 'Plan_device_templates.zip', imageCount: 2, failures: 0 })),
        download: vi.fn(),
        ...overrides,
    };
    render(<DeviceExportDialog {...props} />);
    return { props, dialog: screen.getByRole('dialog', { name: 'Export as template' }) };
};
const box = (dialog: HTMLElement, name: string) => within(dialog).getByRole('checkbox', { name }) as HTMLInputElement;
const status = (dialog: HTMLElement) => within(dialog).getByRole('status').textContent;

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('DeviceExportDialog', () => {
    it('ticks the first page of each template and collapses long groups', () => {
        const { dialog } = setup();
        expect(box(dialog, 'Index').checked).toBe(true);
        expect(box(dialog, 'Jan 1').checked).toBe(true);
        expect(box(dialog, 'Jan 2').checked).toBe(false);
        expect(within(dialog).queryByRole('checkbox', { name: 'Jan 4' })).toBeNull();
        fireEvent.click(within(dialog).getByRole('button', { name: '… 2 more' }));
        expect(box(dialog, 'Jan 5')).toBeTruthy();
    });

    it('counts templates and blocks an export with no device', () => {
        const { dialog } = setup();
        expect(status(dialog)).toBe('Pick at least one page and one device.');
        expect((within(dialog).getByRole('button', { name: 'Export' }) as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(box(dialog, 'reMarkable 2'));
        expect(status(dialog)).toBe('2 pages × 1 device = 2 templates (.zip)');
        fireEvent.click(box(dialog, 'Manta (A5 X2)'));
        expect(status(dialog)).toBe('2 pages × 2 devices = 4 templates (.zip)');
    });

    it('selects and clears a whole group, and searches across groups', () => {
        const { dialog } = setup();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Select all pages of Daily' }));
        // "all" ticks the collapsed pages too; the list itself stays collapsed until "… 2 more" opens it.
        expect(box(dialog, 'Daily (5)').checked).toBe(true);
        fireEvent.click(within(dialog).getByRole('button', { name: '… 2 more' }));
        expect(box(dialog, 'Jan 5').checked).toBe(true);
        fireEvent.click(within(dialog).getByRole('button', { name: 'none (clear pages of Daily)' }));
        expect(box(dialog, 'Jan 1').checked).toBe(false);
        expect(box(dialog, 'Jan 5').checked).toBe(false);
        fireEvent.change(within(dialog).getByRole('searchbox', { name: 'Search pages' }), { target: { value: 'jan 4' } });
        expect(within(dialog).getAllByRole('checkbox', { name: /^Jan/ }).map(el => el.getAttribute('aria-label') ?? el.closest('label')?.textContent)).toHaveLength(1);
    });

    it('stops at the image cap', () => {
        const { dialog } = setup({}, 400);
        fireEvent.click(box(dialog, 'reMarkable 2'));
        fireEvent.click(within(dialog).getByRole('button', { name: 'Select all pages of Daily' }));
        expect(status(dialog)).toBe('Too many files: pick fewer pages or devices.');
        expect((within(dialog).getByRole('button', { name: 'Export' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('offers the PDF template only for Supernote, Boox and Bigme', () => {
        const { dialog } = setup();
        fireEvent.click(box(dialog, 'reMarkable 2'));
        expect(within(dialog).queryByRole('checkbox', { name: 'Also include a PDF template' })).toBeNull();
        fireEvent.click(box(dialog, 'Manta (A5 X2)'));
        expect(box(dialog, 'Also include a PDF template')).toBeTruthy();
    });

    it('exports, downloads, tracks, remembers settings and closes', async () => {
        const { dialog, props } = setup();
        fireEvent.click(box(dialog, 'Manta (A5 X2)'));
        fireEvent.click(box(dialog, 'Force greyscale'));
        fireEvent.click(box(dialog, 'Also include a PDF template'));
        await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Export' })); });
        const [req] = (props.runExport as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(new Set(req.pageNodeIds)).toEqual(new Set(['idx', 'd1']));
        expect(req).toMatchObject({ projectName: 'Plan', deviceIds: ['supernote_manta'], forceGreyscale: true, includePdf: true });
        expect(props.download).toHaveBeenCalledWith(expect.any(Blob), 'Plan_device_templates.zip');
        expect(trackEvent).toHaveBeenCalledWith('device_templates_exported', { pageCount: 2, deviceIds: ['supernote_manta'], imageCount: 2, forcedGreyscale: true, includePdf: true, failures: 0 });
        expect(props.onClose).toHaveBeenCalled();
        expect(JSON.parse(localStorage.getItem('doctect-device-export')!)).toEqual({ devices: ['supernote_manta'], forceGreyscale: true, includePdf: true });
    });

    it('opens with remembered settings, and with defaults when storage is unreadable', () => {
        localStorage.setItem('doctect-device-export', JSON.stringify({ devices: ['rm2', 'gone'], forceGreyscale: true, includePdf: false }));
        const first = setup();
        expect(box(first.dialog, 'reMarkable 2').checked).toBe(true);
        expect(box(first.dialog, 'Force greyscale').checked).toBe(true);
        cleanup();
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
        const second = setup({ initialForceGreyscale: true });
        expect(box(second.dialog, 'reMarkable 2').checked).toBe(false);
        expect(box(second.dialog, 'Force greyscale').checked).toBe(true);
    });

    it('shows the error and allows a retry', async () => {
        const runExport = vi.fn()
            .mockRejectedValueOnce(new Error('No templates could be produced: boom'))
            .mockResolvedValueOnce({ blob: new Blob(['zip']), fileName: 'f.zip', imageCount: 1, failures: 0 });
        const { dialog, props } = setup({ runExport });
        fireEvent.click(box(dialog, 'reMarkable 2'));
        await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Export' })); });
        expect(within(dialog).getByRole('alert').textContent).toBe('Export failed: No templates could be produced: boom');
        await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Export' })); });
        expect(props.download).toHaveBeenCalledTimes(1);
    });

    it('cancel returns to the picker and a second export still works', async () => {
        let progress!: (p: { phase: 'rendering'; done: number; total: number }) => void;
        const runExport = vi.fn()
            .mockImplementationOnce((_req, { signal, onProgress }) => new Promise((_resolve, reject) => {
                progress = onProgress;
                signal.addEventListener('abort', () => reject(new DOMException('Export cancelled', 'AbortError')));
            }))
            .mockResolvedValueOnce({ blob: new Blob(['zip']), fileName: 'f.zip', imageCount: 1, failures: 0 });
        const { dialog, props } = setup({ runExport });
        fireEvent.click(box(dialog, 'reMarkable 2'));
        act(() => { fireEvent.click(within(dialog).getByRole('button', { name: 'Export' })); });
        act(() => progress({ phase: 'rendering', done: 1, total: 2 }));
        expect(status(dialog)).toBe('Rendering 1 / 2');
        await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' })); });
        expect(status(dialog)).toBe('2 pages × 1 device = 2 templates (.zip)');
        act(() => progress({ phase: 'rendering', done: 2, total: 2 }));
        expect(status(dialog)).toBe('2 pages × 1 device = 2 templates (.zip)');
        await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Export' })); });
        expect(props.download).toHaveBeenCalledTimes(1);
        expect(props.onClose).toHaveBeenCalledTimes(1);
    });

    it('moves focus to the first revealed page when a group is expanded', () => {
        const { dialog } = setup();
        const more = within(dialog).getByRole('button', { name: '… 2 more' });
        more.focus();
        fireEvent.click(more);
        expect(document.activeElement).toBe(box(dialog, 'Jan 4'));
    });

    it('keeps focus inside the dialog during a run and puts it on Export after a failure', async () => {
        const runExport = vi.fn().mockRejectedValueOnce(new Error('boom'));
        const { dialog } = setup({ runExport });
        fireEvent.click(box(dialog, 'reMarkable 2'));
        const exportButton = within(dialog).getByRole('button', { name: 'Export' });
        exportButton.focus();
        act(() => { fireEvent.click(exportButton); });
        expect(within(dialog).queryByRole('button', { name: 'Export' })).toBeNull();
        expect(document.activeElement).toBe(dialog);
        await act(async () => {});
        expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Export' }));
    });

    it('keeps keys away from the editor, and Escape closes', () => {
        const { dialog, props } = setup();
        const editorKeys = vi.fn();
        window.addEventListener('keydown', editorKeys);
        try {
            fireEvent.keyDown(box(dialog, 'Index'), { key: 'Delete' });
            fireEvent.keyDown(dialog, { key: 'Escape' });
        } finally {
            window.removeEventListener('keydown', editorKeys);
        }
        expect(editorKeys).not.toHaveBeenCalled();
        expect(props.onClose).toHaveBeenCalled();
    });

    it('Escape in the search box clears the query and keeps the dialog (and its ticks); Escape again closes', () => {
        const { dialog, props } = setup();
        fireEvent.click(within(dialog).getByRole('button', { name: '… 2 more' }));
        fireEvent.click(box(dialog, 'Jan 4'));
        const search = within(dialog).getByRole('searchbox', { name: 'Search pages' }) as HTMLInputElement;
        fireEvent.change(search, { target: { value: 'jan 4' } });
        expect(within(dialog).queryByRole('checkbox', { name: 'Index' })).toBeNull();
        fireEvent.keyDown(search, { key: 'Escape' });
        expect(search.value).toBe('');
        expect(props.onClose).not.toHaveBeenCalled();
        expect(box(dialog, 'Index')).toBeTruthy();
        expect(box(dialog, 'Jan 4').checked).toBe(true);
        fireEvent.keyDown(search, { key: 'Escape' });
        expect(props.onClose).toHaveBeenCalledTimes(1);
    });

    it('keeps the progress live region outside any aria-busy subtree during a run', () => {
        let progress!: (p: { phase: 'rendering'; done: number; total: number }) => void;
        const runExport = vi.fn().mockImplementationOnce((_req, { onProgress }) => new Promise(() => { progress = onProgress; }));
        const { dialog } = setup({ runExport });
        fireEvent.click(box(dialog, 'reMarkable 2'));
        act(() => { fireEvent.click(within(dialog).getByRole('button', { name: 'Export' })); });
        act(() => progress({ phase: 'rendering', done: 1, total: 2 }));
        const live = within(dialog).getByRole('status');
        expect(live.textContent).toBe('Rendering 1 / 2');
        // NVDA and VoiceOver mute live-region changes inside an aria-busy="true" subtree.
        expect(live.closest('[aria-busy="true"]')).toBeNull();
        expect(dialog).not.toHaveAttribute('aria-busy');
    });

    it('gives "all", "none" and "… N more" touch-sized targets on phone only', () => {
        const desktop = setup();
        const links = (dialog: HTMLElement) => ['Select all pages of Daily', 'none (clear pages of Daily)', '… 2 more']
            .map(name => within(dialog).getByRole('button', { name }));
        for (const link of links(desktop.dialog)) expect(link).not.toHaveClass('min-h-11');
        cleanup();
        render(
            <FormFactorProvider value="phone">
                <DeviceExportDialog isOpen onClose={vi.fn()} getState={() => makeState(5)} projectName="Plan" initialForceGreyscale={false} />
            </FormFactorProvider>,
        );
        const phone = screen.getByRole('dialog', { name: 'Export as template' });
        for (const link of links(phone)) expect(link).toHaveClass('min-h-11', 'px-2');
    });

    it('keeps focus and key isolation after a click on the backdrop', () => {
        const { dialog } = setup();
        const page = box(dialog, 'Index');
        page.focus();
        const editorKeys = vi.fn();
        window.addEventListener('keydown', editorKeys);
        try {
            // A browser moves focus to <body> on a mousedown over a non-focusable element unless the
            // event is cancelled; jsdom leaves focus alone, so replay that default here.
            const notCancelled = fireEvent.mouseDown(dialog.parentElement!);
            if (notCancelled) (document.activeElement as HTMLElement | null)?.blur();
            fireEvent.keyDown(document.activeElement!, { key: 'Delete' });
        } finally {
            window.removeEventListener('keydown', editorKeys);
        }
        expect(editorKeys).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(page);
        expect(dialog.contains(document.activeElement)).toBe(true);
    });

    it('renders nothing when closed', () => {
        render(<DeviceExportDialog isOpen={false} onClose={vi.fn()} getState={() => makeState(1)} projectName="P" initialForceGreyscale={false} />);
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});
