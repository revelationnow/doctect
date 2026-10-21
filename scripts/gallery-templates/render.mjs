// Builds every single-page template in a real browser with the app's own code and writes, per
// template, gallery-templates/out/<slug>.json: { slug, listing, state, previews }.
// Previews come from services/thumbnailService.ts, exactly as the in-app publish makes them:
// one per device variant, Paper Pro first.
//
// Usage: node scripts/gallery-templates/render.mjs <app-origin> [--review <dir>]
//   <app-origin>  a running dev server, e.g. https://localhost:4510
//   --review      also write a full-size PNG of every page per device, for checking by eye
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const origin = process.argv[2];
if (!origin) throw new Error('usage: render.mjs <app-origin> [--review <dir>]');
const reviewIndex = process.argv.indexOf('--review');
const reviewDir = reviewIndex > 0 ? process.argv[reviewIndex + 1] : null;
const outDir = path.resolve('gallery-templates/out');
fs.mkdirSync(outDir, { recursive: true });
if (reviewDir) fs.mkdirSync(reviewDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ ignoreHTTPSErrors: true });
page.on('pageerror', error => console.error('page error:', error.message));
await page.goto(`${origin}/app`);

const results = await page.evaluate(async ({ review }) => {
    const { TEMPLATES } = await import('/gallery-templates/index.ts');
    const { buildProjectState, ROOT_ID } = await import('/gallery-templates/lib/project.ts');
    const { DEVICES } = await import('/gallery-templates/lib/page.ts');
    const { generateThumbnails } = await import('/services/thumbnailService.ts');
    const { generatePDF } = await import('/services/pdfService.ts');
    const { openPdf, renderPng } = await import('/services/deviceExport/pdfRuntime.ts');
    const toDataUrl = blob => new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
    });
    const out = [];
    for (const definition of TEMPLATES) {
        const state = buildProjectState(definition);
        const previews = [];
        const pages = {};
        for (const device of DEVICES) {
            const [preview] = await generateThumbnails(state, [ROOT_ID], device.id);
            previews.push(preview);
            if (review) {
                const pdf = await openPdf(await generatePDF(state, { variantId: device.id, output: 'arraybuffer' }));
                const scale = 3;
                pages[device.id] = await toDataUrl(await renderPng(await pdf.getPage(1),
                    { width: Math.round(device.width * scale), height: Math.round(device.height * scale) }));
            }
        }
        out.push({ slug: definition.slug, listing: definition.listing, state, previews, pages });
    }
    return out;
}, { review: Boolean(reviewDir) });

for (const { pages, ...result } of results) {
    fs.writeFileSync(path.join(outDir, `${result.slug}.json`), JSON.stringify(result));
    const sizes = result.previews.map(p => `${Math.round(p.dataUrl.length / 1024)}KB`).join(' ');
    console.log(`${result.slug}: ${result.previews.length} previews (${sizes})`);
    if (reviewDir) {
        for (const [deviceId, dataUrl] of Object.entries(pages)) {
            fs.writeFileSync(path.join(reviewDir, `${result.slug}--${deviceId}.png`),
                Buffer.from(dataUrl.split(',')[1], 'base64'));
        }
    }
}
await browser.close();
