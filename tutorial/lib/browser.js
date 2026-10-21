// The recording browser: Chromium with a persistent profile whose default
// page zoom is 133%, so the app lays out at 1440×810 CSS px while the
// captured surface stays a crisp 1920×1080 (device-scale tricks don't work:
// CDP screencasts capture at CSS-pixel size).
//
// Routes, all fulfilled locally:
//   cdn.tailwindcss.com      → the compiled sheet from tutorial/styles (the
//                              Play CDN is unreachable from sandboxed hosts)
//   /__tutorial/viewer/*     → tutorial/viewer (the PDF reader page)
//   /__tutorial/pdfjs/*      → node_modules/pdfjs-dist (flattened: the reader's
//                              URLs must not contain an excluded segment
//                              such as build/ — see the workspace-boundary test)
//   /__tutorial/files/<name> → files registered with studio.serveFile()
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installStudio } from './overlay.js';
import { CACHE_DIR, ROOT, TUTORIAL_DIR } from './episode.js';
import { newestSourceMtime } from './servers.js';

export const VIDEO = { width: 1920, height: 1080 };
export const ZOOM = 4 / 3;
export const CSS_VIEWPORT = { width: VIDEO.width / ZOOM, height: VIDEO.height / ZOOM };
const CHROMIUM = process.env.TUTORIAL_CHROMIUM
    || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.pdf': 'application/pdf', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.wasm': 'application/wasm', '.map': 'application/json', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream' };

const PDFJS = path.join(ROOT, 'node_modules', 'pdfjs-dist');
const pdfjsFile = (name) => {
    if (name === 'pdf.mjs' || name === 'pdf.worker.mjs') return path.join(PDFJS, 'build', name);
    if (name.startsWith('standard_fonts/')) return path.join(PDFJS, name);
    return path.join(PDFJS, 'web', name);
};

/** Compiles (once per source change) the Tailwind sheet the app expects from the Play CDN. */
export function tailwindSheet() {
    const out = path.join(CACHE_DIR, 'tailwind.css');
    if (!fs.existsSync(out) || fs.statSync(out).mtimeMs / 1000 < newestSourceMtime()) {
        execFileSync('npx', ['tailwindcss', '-c', 'styles/tailwind.config.cjs', '-i', 'styles/input.css', '-o', out, '--minify'],
            { cwd: TUTORIAL_DIR, stdio: ['ignore', 'ignore', 'inherit'] });
    }
    return fs.readFileSync(out, 'utf8');
}

export async function launchStudio({ headless = true } = {}) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tutorial-profile-'));
    fs.mkdirSync(path.join(profile, 'Default'), { recursive: true });
    fs.writeFileSync(path.join(profile, 'Default', 'Preferences'), JSON.stringify({
        partition: { default_zoom_level: { x: Math.log(ZOOM) / Math.log(1.2) } },
    }));
    const context = await chromium.launchPersistentContext(profile, {
        executablePath: CHROMIUM,
        headless,
        viewport: VIDEO,
        deviceScaleFactor: 1,
        acceptDownloads: true,
        locale: 'en-US',
        colorScheme: 'light',
        args: ['--disable-features=Translate,MediaRouter', '--no-first-run'],
    });

    const css = tailwindSheet();
    await context.route('https://cdn.tailwindcss.com/**', route => route.fulfill({
        contentType: 'text/javascript',
        body: `(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};(document.head||document.documentElement).prepend(s);})();`,
    }));
    const served = new Map();
    await context.route('**/__tutorial/**', async route => {
        const url = new URL(route.request().url());
        const rel = decodeURIComponent(url.pathname.replace(/^\/__tutorial\//, ''));
        let file = null;
        if (rel.startsWith('viewer/')) file = path.join(TUTORIAL_DIR, 'viewer', rel.slice('viewer/'.length) || 'index.html');
        else if (rel.startsWith('pdfjs/')) file = pdfjsFile(rel.slice('pdfjs/'.length));
        else if (rel.startsWith('files/')) file = served.get(rel.slice('files/'.length));
        if (file && fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
        if (!file || !fs.existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
        await route.fulfill({ body: fs.readFileSync(file), contentType: TYPES[path.extname(file)] || 'application/octet-stream' });
    });
    await context.addInitScript(installStudio);

    const page = context.pages()[0] || await context.newPage();
    return {
        context,
        page,
        /** Makes a local file reachable at /__tutorial/files/<name>. */
        serveFile(name, file) { served.set(name, file); return `/__tutorial/files/${encodeURIComponent(name)}`; },
        async close() {
            await context.close().catch(() => {});
            fs.rmSync(profile, { recursive: true, force: true });
        },
    };
}
