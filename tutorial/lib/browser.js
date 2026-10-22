// The recording browser: Chromium with a persistent profile whose default
// page zoom is 133%, so the app lays out at 1440×810 CSS px while the
// captured surface stays a crisp 1920×1080 (device-scale tricks don't work:
// CDP screencasts capture at CSS-pixel size).
//
// Routes (answered locally; fonts are fetched once, then served from cache):
//   cdn.tailwindcss.com      → the compiled sheet from tutorial/styles (the
//                              Play CDN is unreachable from sandboxed hosts)
//   /__tutorial/viewer/*     → tutorial/viewer (the PDF reader page, and text.html for text files and images)
//   /__tutorial/pdfjs/*      → node_modules/pdfjs-dist (flattened: the reader's
//                              URLs must not contain an excluded segment
//                              such as build/ — see the workspace-boundary test)
//   /__tutorial/files/<name> → files registered with studio.serveFile()
//   cdn.jsdelivr.net/fontsource/fonts/* → the same Google fonts as static TTFs
import { chromium } from 'playwright';
import { execFile, execFileSync } from 'node:child_process';
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
    '.wasm': 'application/wasm', '.map': 'application/json', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream',
    '.txt': 'text/plain; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.zip': 'application/zip' };

const PDFJS = path.join(ROOT, 'node_modules', 'pdfjs-dist');
const pdfjsFile = (name) => {
    if (name === 'pdf.mjs' || name === 'pdf.worker.mjs') return path.join(PDFJS, 'build', name);
    if (name.startsWith('standard_fonts/')) return path.join(PDFJS, name);
    return path.join(PDFJS, 'web', name);
};

// The PDF exporter embeds most Google fonts from jsDelivr's fontsource TTF
// endpoint, which sandboxed recorders can't reach (a real browser can). The
// same fonts come from Google's own CSS API as static TTFs when the client
// doesn't advertise WOFF2, so the recorder answers fontsource requests with
// those, cached in tutorial/build/cache/fonts. Without this, every recorded
// export silently falls back to Helvetica.
const FONT_FAMILY_NAMES = { 'eb-garamond': 'EB Garamond', 'source-sans-3': 'Source Sans 3', 'pt-sans': 'PT Sans', 'pt-serif': 'PT Serif' };
const familyName = (slug) => FONT_FAMILY_NAMES[slug] ?? slug.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
const curl = (args) => new Promise((resolve, reject) => {
    execFile('curl', ['-sS', '--fail', '--max-time', '60', ...args], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 },
        (err, stdout) => (err ? reject(err) : resolve(stdout)));
});
async function googleFontTtf(slug, weight, style) {
    const dir = path.join(CACHE_DIR, 'fonts');
    const file = path.join(dir, `${slug}-${weight}-${style}.ttf`);
    if (fs.existsSync(file)) return file;
    const variant = `${weight}${style === 'italic' ? 'italic' : ''}`;
    const css = (await curl(['-A', 'Mozilla/4.0', `https://fonts.googleapis.com/css?family=${encodeURIComponent(familyName(slug))}:${variant}`])).toString();
    const url = css.match(/url\((https:[^)]+\.ttf)\)/)?.[1];
    if (!url) throw new Error(`no TTF for ${slug} ${variant}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, await curl([url]));
    return file;
}

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
    // Copy buttons in the app (the generator's LLM prompt) write to the clipboard.
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    const css = tailwindSheet();
    await context.route('https://cdn.tailwindcss.com/**', route => route.fulfill({
        contentType: 'text/javascript',
        body: `(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};(document.head||document.documentElement).prepend(s);})();`,
    }));
    await context.route('https://cdn.jsdelivr.net/fontsource/fonts/**', async route => {
        const m = new URL(route.request().url()).pathname.match(/fonts\/([a-z0-9-]+)@[^/]+\/[a-z0-9-]+?-(\d+)-(normal|italic)\.ttf$/);
        try {
            if (!m) throw new Error('unrecognised fontsource path');
            await route.fulfill({ body: fs.readFileSync(await googleFontTtf(m[1], m[2], m[3])), contentType: 'font/ttf' });
        } catch (err) {
            process.stderr.write(`font route: ${route.request().url()}: ${err.message}\n`);
            await route.abort();
        }
    });
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
