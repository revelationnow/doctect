// Browser-only pdf.js wiring for the device export (worker set up as in thumbnailService.ts).
import * as pdfjsLib from 'pdfjs-dist';
// Vite resolves the worker as an asset URL:
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { fitRect, type Size } from './deviceProfiles';
import { readPdfPageDrawing, type Drawing } from './pdfDrawing';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

type Page = pdfjsLib.PDFPageProxy;

/** Opens PDF bytes. pdf.js takes ownership of (detaches) the buffer it is given: pass a copy. */
export async function openPdf(data: ArrayBuffer): Promise<{ getPage(pageNumber: number): Promise<Page>; destroy(): Promise<void> }> {
    const task = pdfjsLib.getDocument({ data: new Uint8Array(data) });
    const doc = await task.promise;
    // `destroy()` lives on the loading task (terminates the worker); the document itself only has `cleanup()`.
    return { getPage: pageNumber => doc.getPage(pageNumber), destroy: () => task.destroy() };
}

export const pageSize = (page: Page): Size => {
    const [x0, y0, x1, y1] = page.view;
    return { width: x1 - x0, height: y1 - y0 };
};

/** Renders the page fitted and centred in a white box of exactly `box` pixels, as a PNG. */
export async function renderPng(page: Page, box: Size): Promise<Blob> {
    const fit = fitRect(pageSize(page), box);
    const canvas = document.createElement('canvas');
    canvas.width = box.width;
    canvas.height = box.height;
    try {
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas is not available');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, box.width, box.height);
        const viewport = page.getViewport({ scale: fit.scale, offsetX: fit.x, offsetY: fit.y });
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))), 'image/png'));
    } finally {
        // Release the backing store now; at 2400x3200 a few lingering canvases exhaust a phone.
        canvas.width = 0;
        canvas.height = 0;
    }
}

export const readDrawing = (page: Page): Promise<Drawing> => readPdfPageDrawing(page, pdfjsLib.OPS as Record<string, number>);
