// @vitest-environment node
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import type { AppState } from '../../../types';
import { DeviceExportError, runDeviceExport, type DeviceExportProgress, type ExportDeps } from '../../../services/deviceExport/exportJob';

const node = (id: string, type: string, title: string, children: string[] = [], referenceId?: string) =>
    ({ id, parentId: null, type, title, data: {}, children, ...(referenceId ? { referenceId } : {}) });
const state = {
    rootId: 'root', activeVariantId: 'v',
    nodes: { root: node('root', 'a', 'Root', ['p2', 'ref', 'p3']), p2: node('p2', 'a', 'Second'), p3: node('p3', 'wide', 'Wide'), ref: node('ref', 'a', 'Ref', [], 'p2') },
    variants: { v: { id: 'v', name: 'V', templates: { a: { id: 'a', name: 'A', width: 468, height: 624, layers: [], elements: [] }, wide: { id: 'wide', name: 'Wide', width: 624, height: 468, layers: [], elements: [] } } } },
} as unknown as AppState;

type FakePage = { n: number; grey: boolean };
// Keyed by position in the subset PDF: page 1 is Root (portrait), page 2 is Wide (landscape).
const sizes: Record<number, { width: number; height: number }> = { 1: { width: 468, height: 624 }, 2: { width: 624, height: 468 } };

function fakeDeps(overrides: Partial<ExportDeps<FakePage>> = {}) {
    const calls = { generate: [] as { pageNodeIds: string[]; isGreyscale: boolean }[], render: [] as { page: FakePage; box: unknown }[], destroyed: 0 };
    const deps: ExportDeps<FakePage> = {
        async generatePdf(_state, options) { calls.generate.push(options); return new Uint8Array([options.isGreyscale ? 7 : 9, 1, 2]).buffer; },
        async openPdf(data) {
            const grey = new Uint8Array(data)[0] === 7;
            // pdf.js transfers the buffer it is given; do the same so a caller relying on the bytes afterwards fails.
            structuredClone(data, { transfer: [data] });
            return { getPage: async n => ({ n, grey }), destroy: () => { calls.destroyed += 1; } };
        },
        pageSize: page => sizes[page.n],
        async renderPng(page, box) { calls.render.push({ page, box }); return new Blob([new Uint8Array([137, 80])], { type: 'image/png' }); },
        async readDrawing() { return { width: 468, height: 624, notes: ['image'], items: [{ kind: 'fill', grey: '#000000', evenOdd: false, subpaths: [{ closed: true, points: [[0, 0], [10, 0], [10, 10]] }] }] }; },
        ...overrides,
    };
    return { deps, calls };
}
const request = (extra: Partial<Parameters<typeof runDeviceExport>[0]> = {}) => ({
    state, projectName: 'Plan', pageNodeIds: ['p3', 'root'], deviceIds: ['rm2', 'supernote_manta'], forceGreyscale: false, includePdf: false, ...extra,
});
const entries = async (blob: Blob) => Object.keys((await JSZip.loadAsync(await blob.arrayBuffer())).files).filter(name => !name.endsWith('/')).sort();

describe('runDeviceExport', () => {
    it('renders every page for every device in page order, with methods files for reMarkable', async () => {
        const { deps, calls } = fakeDeps();
        const result = await runDeviceExport(request(), { deps, now: () => 1 });
        expect(calls.generate).toEqual([{ pageNodeIds: ['root', 'p3'], isGreyscale: true }]);
        expect(result).toMatchObject({ fileName: 'Plan_device_templates.zip', imageCount: 4, failures: 0 });
        const names = await entries(result.blob);
        expect(names).toContain('reMarkable/reMarkable_2/png/Root.png');
        expect(names).toContain('reMarkable/reMarkable_2/png/Wide.png');
        expect(names).toContain('Supernote/Manta/MyStyle/Plan/Wide.png');
        expect(names.filter(name => name.endsWith('.template'))).toHaveLength(2);
        expect(names).toContain('CONVERSION-REPORT.txt');
        expect(calls.destroyed).toBe(1);
    });

    it('turns the box for landscape pages', async () => {
        const { deps, calls } = fakeDeps();
        await runDeviceExport(request({ deviceIds: ['rm2'] }), { deps });
        expect(calls.render.map(call => call.box)).toEqual([{ width: 1404, height: 1872 }, { width: 1872, height: 1404 }]);
    });

    it('uses the colour PDF for colour screens unless greyscale is forced', async () => {
        const colour = fakeDeps();
        await runDeviceExport(request({ deviceIds: ['boox_note_air4c_tab_ultra_c_pro'] }), { deps: colour.deps });
        expect(colour.calls.generate.map(call => call.isGreyscale)).toEqual([false]);
        expect(colour.calls.render.every(call => !call.page.grey)).toBe(true);
        const forced = fakeDeps();
        await runDeviceExport(request({ deviceIds: ['boox_note_air4c_tab_ultra_c_pro'], forceGreyscale: true }), { deps: forced.deps });
        expect(forced.calls.generate.map(call => call.isGreyscale)).toEqual([true]);
    });

    it('renders a colour reMarkable from the colour PDF but reads its .template drawing from the grey one', async () => {
        const drawn: FakePage[] = [];
        const { deps, calls } = fakeDeps({ async readDrawing(page) {
            drawn.push(page);
            return { width: 468, height: 624, notes: [], items: [] };
        } });
        const result = await runDeviceExport(request({ deviceIds: ['rm_pp'] }), { deps });
        expect(calls.generate).toEqual([{ pageNodeIds: ['root', 'p3'], isGreyscale: false }, { pageNodeIds: ['root', 'p3'], isGreyscale: true }]);
        expect(calls.render).toHaveLength(2);
        expect(calls.render.every(call => call.page.grey === false)).toBe(true);
        expect(drawn).toHaveLength(2);
        expect(drawn.every(page => page.grey === true)).toBe(true);
        expect(calls.destroyed).toBe(2);
        expect((await entries(result.blob)).filter(name => name.endsWith('.template'))).toHaveLength(2);
    });

    it('keeps the PDF bytes intact after pdf.js has read them', async () => {
        const { deps } = fakeDeps();
        const result = await runDeviceExport(request({ deviceIds: ['supernote_manta', 'rm2'], includePdf: true }), { deps });
        const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
        expect(Array.from(await zip.file('Supernote/Manta/MyStyle/Plan/Plan.pdf')!.async('uint8array'))).toEqual([7, 1, 2]);
        expect(Object.keys(zip.files).some(name => name.startsWith('reMarkable/') && name.endsWith('.pdf'))).toBe(false);
    });

    it('skips a failing page for one device and reports it', async () => {
        const { deps } = fakeDeps({ async renderPng(page, box) {
            if ((box as { width: number }).width === 1920 && page.n === 1) throw new Error('canvas lost');
            return new Blob([new Uint8Array([1])]);
        } });
        const result = await runDeviceExport(request(), { deps });
        expect(result).toMatchObject({ imageCount: 3, failures: 1 });
        const report = await (await JSZip.loadAsync(await result.blob.arrayBuffer())).file('CONVERSION-REPORT.txt')!.async('string');
        expect(report).toContain('Root (Manta (A5 X2)): skipped: canvas lost');
    });

    it('keeps the PNG when only the .template fails', async () => {
        const { deps } = fakeDeps({ async readDrawing() { throw new Error('bad ops'); } });
        const result = await runDeviceExport(request({ deviceIds: ['rm2'] }), { deps });
        expect(result).toMatchObject({ imageCount: 2, failures: 0 });
        const names = await entries(result.blob);
        expect(names.filter(name => name.endsWith('.template'))).toHaveLength(0);
    });

    it('gives pages with the same title distinct methods files, with one slug per page across devices', async () => {
        // The fake drawing and the title are identical for both pages, so the content hash in the
        // stem collides too: only a per-run page slug keeps the second page's files from replacing the first's.
        const twins = {
            ...state,
            nodes: { root: node('root', 'a', 'Same', ['p2']), p2: node('p2', 'a', 'Same') },
        } as unknown as AppState;
        const rm2Only = await runDeviceExport(request({ state: twins, pageNodeIds: ['root', 'p2'], deviceIds: ['rm2'] }), { deps: fakeDeps().deps });
        const templates = (await entries(rm2Only.blob)).filter(name => name.endsWith('.template'));
        expect(templates).toHaveLength(2);
        expect(templates.map(name => name.replace(/-[0-9a-f]{8}\.template$/, ''))).toEqual([
            'reMarkable/reMarkable_2/methods/doctect-plan-same-2-rm2',
            'reMarkable/reMarkable_2/methods/doctect-plan-same-rm2',
        ]);

        const both = await runDeviceExport(request({ state: twins, pageNodeIds: ['root', 'p2'], deviceIds: ['rm2', 'rm_pp'] }), { deps: fakeDeps().deps });
        const stems = (await entries(both.blob)).filter(name => name.endsWith('.template')).map(name => name.replace(/^.*\/methods\//, '').replace(/-[0-9a-f]{8}\.template$/, ''));
        expect(stems).toEqual(['doctect-plan-same-2-rm_pp', 'doctect-plan-same-rm_pp', 'doctect-plan-same-2-rm2', 'doctect-plan-same-rm2']);
    });

    it('fails when nothing could be produced', async () => {
        const { deps } = fakeDeps({ async renderPng() { throw new Error('no canvas'); } });
        await expect(runDeviceExport(request(), { deps })).rejects.toThrow(DeviceExportError);
        await expect(runDeviceExport(request({ pageNodeIds: [] }), { deps })).rejects.toThrow('Pick at least one page and one device.');
    });

    it('reports progress and stops when cancelled', async () => {
        const controller = new AbortController();
        const seen: DeviceExportProgress[] = [];
        const { deps, calls } = fakeDeps();
        const run = runDeviceExport(request(), { deps, signal: controller.signal, onProgress: progress => {
            seen.push(progress);
            if (progress.phase === 'rendering' && progress.done === 1) controller.abort();
        } });
        await expect(run).rejects.toMatchObject({ name: 'AbortError' });
        expect(seen[0]).toEqual({ phase: 'preparing', done: 0, total: 4 });
        expect(calls.render).toHaveLength(1);
        expect(calls.destroyed).toBe(1);

        const finished: DeviceExportProgress[] = [];
        await runDeviceExport(request(), { deps: fakeDeps().deps, onProgress: progress => finished.push(progress) });
        expect(finished.map(progress => `${progress.phase}:${progress.done}`)).toEqual(['preparing:0', 'rendering:1', 'rendering:2', 'rendering:3', 'rendering:4', 'packaging:4']);
    });
});
