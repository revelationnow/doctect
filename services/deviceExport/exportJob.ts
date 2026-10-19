import type { AppState } from '../../types';
import { computePageOrder, generatePDF } from '../pdfService';
import { createDeviceZip } from './bundle';
import { getProfile, keepsColour, targetBox, type DeviceProfile } from './deviceProfiles';
import { createNameAllocator, slugify } from './fileNames';
import type { Drawing } from './pdfDrawing';
import { buildMethodsTemplate } from './remarkableTemplate';

export interface DeviceExportRequest { state: AppState; projectName: string; pageNodeIds: string[]; deviceIds: string[]; forceGreyscale: boolean; includePdf: boolean }
export interface DeviceExportProgress { phase: 'preparing' | 'rendering' | 'packaging'; done: number; total: number }
export interface DeviceExportResult { blob: Blob; fileName: string; imageCount: number; failures: number }
export class DeviceExportError extends Error {}

export interface ExportDeps<P = unknown> {
    generatePdf(state: AppState, options: { pageNodeIds: string[]; isGreyscale: boolean }): Promise<ArrayBuffer>;
    openPdf(data: ArrayBuffer): Promise<{ getPage(pageNumber: number): Promise<P>; destroy(): void | Promise<void> }>;
    pageSize(page: P): { width: number; height: number };
    renderPng(page: P, box: { width: number; height: number }): Promise<Blob>;
    readDrawing(page: P): Promise<Drawing>;
    /** Release a page's resources once every device has rendered it (pdf.js `page.cleanup()`). */
    cleanupPage?(page: P): void | Promise<void>;
}

const runtime = () => import('./pdfRuntime');
// pdf.js and its worker load only when someone exports.
const defaultDeps: ExportDeps = {
    generatePdf: async (state, options) => (await generatePDF(state, { ...options, output: 'arraybuffer' })) as ArrayBuffer,
    openPdf: async data => (await runtime()).openPdf(data),
    pageSize: page => {
        const [x0, y0, x1, y1] = (page as { view: number[] }).view;
        return { width: x1 - x0, height: y1 - y0 };
    },
    renderPng: async (page, box) => (await runtime()).renderPng(page as never, box),
    readDrawing: async page => (await runtime()).readDrawing(page as never),
    cleanupPage: async page => (await runtime()).cleanupPage(page as never),
};

const isAbort = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError';
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Builds the device zip: one subset PDF per colour mode, then for each page and device a fitted
 * PNG (plus Methods files on reMarkable). A failure on one page/device is reported in the zip and
 * the rest continue; cancelling between images rejects with an AbortError.
 */
export async function runDeviceExport(request: DeviceExportRequest, {
    signal, onProgress = () => {}, deps = defaultDeps, now = Date.now,
}: { signal?: AbortSignal; onProgress?: (progress: DeviceExportProgress) => void; deps?: ExportDeps; now?: () => number } = {}): Promise<DeviceExportResult> {
    const throwIfAborted = () => { if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError'); };
    const wanted = new Set(request.pageNodeIds);
    const pages = computePageOrder(request.state).filter(id => wanted.has(id));
    const profiles = request.deviceIds.map(getProfile).filter((profile): profile is DeviceProfile => profile !== undefined);
    if (pages.length === 0 || profiles.length === 0) throw new DeviceExportError('Pick at least one page and one device.');

    const total = pages.length * profiles.length;
    onProgress({ phase: 'preparing', done: 0, total });
    const colourFor = (profile: DeviceProfile) => keepsColour(profile, request.forceGreyscale);
    const colourPdf = profiles.some(colourFor) ? await deps.generatePdf(request.state, { pageNodeIds: pages, isGreyscale: false }) : null;
    throwIfAborted();
    // Methods templates are monochrome line drawings, so every reMarkable also needs the grey PDF.
    const greyPdf = profiles.some(profile => !colourFor(profile) || profile.platform === 'remarkable')
        ? await deps.generatePdf(request.state, { pageNodeIds: pages, isGreyscale: true }) : null;
    throwIfAborted();

    const opened: { destroy(): void | Promise<void> }[] = [];
    try {
        // Copies: pdf.js detaches what it is given, and the optional PDF template needs the bytes after.
        const colourDoc = colourPdf ? await deps.openPdf(colourPdf.slice(0)) : null;
        if (colourDoc) opened.push(colourDoc);
        const greyDoc = greyPdf ? await deps.openPdf(greyPdf.slice(0)) : null;
        if (greyDoc) opened.push(greyDoc);

        const zip = createDeviceZip(request.projectName);
        const projectSlug = slugify(request.projectName, 'project');
        // One slug per page for the whole run: two pages with the same title would otherwise share a
        // Methods stem (the content hash collides when their drawings match) and the later overwrite the earlier.
        const nextPageSlug = createNameAllocator();
        let done = 0;
        let images = 0;
        let failures = 0;
        let firstError: unknown = null;
        for (let index = 0; index < pages.length; index++) {
            const title = request.state.nodes[pages[index]]?.title?.trim() || `Page ${index + 1}`;
            const pageSlug = nextPageSlug(slugify(title, `page-${index + 1}`));
            const loaded = new Map<object, Promise<unknown>>();
            const pageOf = (doc: { getPage(pageNumber: number): Promise<unknown> }) => {
                let page = loaded.get(doc);
                if (!page) { page = doc.getPage(index + 1); loaded.set(doc, page); }
                return page;
            };
            let drawing: Promise<Drawing> | null = null;
            for (const profile of profiles) {
                throwIfAborted();
                try {
                    const page = await pageOf((colourFor(profile) ? colourDoc : greyDoc)!);
                    const size = deps.pageSize(page);
                    const png = await deps.renderPng(page, targetBox(profile, size));
                    zip.addPng(profile, title, png, size.width > size.height);
                    images += 1;
                    if (profile.platform === 'remarkable') {
                        try {
                            drawing ??= pageOf(greyDoc!).then(greyPage => deps.readDrawing(greyPage));
                            const result = buildMethodsTemplate(await drawing, {
                                profile, pageTitle: title, projectName: request.projectName, projectSlug, pageSlug, now: now(),
                            });
                            if (result.files) zip.addMethods(profile, result.files);
                            for (const note of result.notes) zip.report(`${title} (${profile.name}, .template): ${note}`);
                        } catch (error) {
                            if (isAbort(error)) throw error;
                            zip.report(`${title} (${profile.name}, .template): skipped: ${messageOf(error)}`);
                        }
                    }
                } catch (error) {
                    if (isAbort(error)) throw error;
                    failures += 1;
                    firstError ??= error;
                    zip.report(`${title} (${profile.name}): skipped: ${messageOf(error)}`);
                }
                done += 1;
                onProgress({ phase: 'rendering', done, total });
            }
            // Every render and drawing read for this page was awaited above. Release its proxies now:
            // pdf.js otherwise holds each page's operator list until destroy(), and 400 pages of that
            // is the memory curve the image cap exists to protect on phones. Best effort only.
            for (const page of loaded.values()) {
                await page.then(loadedPage => deps.cleanupPage?.(loadedPage)).catch(() => undefined);
            }
        }
        if (images === 0) throw new DeviceExportError(`No templates could be produced: ${messageOf(firstError)}`);
        if (request.includePdf) {
            for (const profile of profiles) {
                if (profile.platform === 'remarkable') continue;
                const bytes = colourFor(profile) ? colourPdf : greyPdf;
                if (bytes) zip.addPdf(profile, bytes);
            }
        }
        throwIfAborted();
        onProgress({ phase: 'packaging', done, total });
        const blob = await zip.finish();
        throwIfAborted();
        return { blob, fileName: zip.fileName, imageCount: images, failures };
    } finally {
        // Always release the worker; a failing destroy must not hide the error (or result) of the run.
        await Promise.allSettled(opened.map(doc => doc.destroy()));
    }
}
