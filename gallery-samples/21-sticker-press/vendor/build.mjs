#!/usr/bin/env node
// The Sticker Press — artwork vendoring pipeline.
//
// Fetches a named subset of Lucide and Twemoji SVG artwork from upstream,
// minifies each icon so it renders correctly under svg2pdf, and writes the
// result plus both upstream licence files and a manifest into this
// directory (gallery-samples/21-sticker-press/vendor/).
//
// Usage:
//   node gallery-samples/21-sticker-press/vendor/build.mjs           full vendor run
//   node gallery-samples/21-sticker-press/vendor/build.mjs --check   pre-flight only: HEAD-checks
//                                                                    every id in WANTED and reports
//                                                                    every missing one, without
//                                                                    downloading or writing anything.
//                                                                    Use this before a big curation
//                                                                    pass (Task B's 500-id list) so
//                                                                    bad ids surface as one report
//                                                                    instead of one slow full rerun
//                                                                    per discovery.
//
// Design notes — read before touching the minifier.
//
// 1. Flatten root presentation attributes (fill, stroke, stroke-width,
//    stroke-linecap, stroke-linejoin, stroke-miterlimit) onto every drawable
//    descendant (path, circle, ellipse, rect, line, polyline, polygon, g)
//    that doesn't already carry its own value, respecting any override along
//    the way (an element's own attribute always wins over an ancestor's).
//    The reason is narrower than "svg2pdf can't inherit from the root" —
//    verified directly, it can, for both single- and multi-child icons.
//    Flattening is required for two things that have nothing to do with
//    inheritance breaking: (a) `currentColor` has no other path to the
//    intended colour — nobody downstream can tell svg2pdf "use the
//    colourway's colour" except by putting that literal string on the
//    attribute it reads, and the only reliable place to guarantee that
//    attribute exists on every element is to put it there explicitly; and
//    (b) the six-colourway substitution mechanism (one stroke colour, one
//    string swap) only works if PLACEHOLDER_STROKE is sitting on every
//    drawable child for a later find-and-replace to reach. (Historical note:
//    an earlier "renders as a solid black blob" framing for this step traced
//    to a different, unrelated bug in this project's abandoned hand-drawn
//    SVG builders — open subpaths being implicitly closed and filled — not
//    to anything about root-attribute inheritance. Don't go looking for that
//    symptom here.)
//
// 2. Never call setAttribute('xmlns', ...) after stripping root attributes.
//    XMLSerializer emits the SVG namespace itself from the element's parsed
//    namespaceURI, regardless of whether an `xmlns` attribute is present —
//    calling setAttribute('xmlns', ...) as well adds a second, literal
//    `xmlns` attribute alongside the one the serializer emits on its own.
//    Verified directly: the serialized output is `<svg xmlns="..."
//    viewBox="..." xmlns="...">` — a duplicate attribute, which is an XML
//    well-formedness violation. Reparsing that string (exactly what
//    pdfService.ts's `DOMParser().parseFromString(el.svgContent, ...)` does
//    at render time) fails and yields a `<parsererror>` node instead of
//    `<svg>`. Also verified directly: svg2pdf does not throw on that
//    `<parsererror>` root, it just silently draws nothing for it — no
//    exception, no console output, no visible error, the sticker is simply
//    absent from the page. This script never calls setAttribute('xmlns',
//    ...); it only ever removes attributes and lets the serializer do its
//    job.
//
// 3. currentColor is resolved here, not left in the file. Lucide's single
//    stroke colour is the recolouring mechanism for the six sticker
//    colourways applied by a later build step, so every occurrence is
//    replaced with the placeholder token PLACEHOLDER_STROKE (see below). A
//    later build step substitutes that token per colourway. Note this isn't
//    about rendering safety either: an unresolved `currentColor` reaching
//    svg2pdf renders with correct geometry in svg2pdf's own default colour
//    (black), not invisibly and not as a filled blob — verified directly.
//    It has to be resolved because nothing else will pick the *intended*
//    colour, not because leaving it in would break the render.
//
// 4. Byte caps are enforced per icon (LUCIDE_MAX_BYTES / TWEMOJI_MAX_BYTES).
//    An over-cap icon aborts the whole build with the offending id and its
//    size named, rather than being written silently — curation needs
//    honest feedback about what the sets actually contain.
//
// 5. The whole pipeline is computed in memory first; files are only written
//    once every requested icon has been fetched, minified, and has passed
//    its cap check, and both licence files have downloaded successfully.
//    A failed fetch throws immediately and nothing is written. That keeps
//    reruns deterministic for a given upstream snapshot and never leaves a
//    partial manifest or an orphaned .svg on disk.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const VENDOR_DIR = dirname(fileURLToPath(import.meta.url));

// --- Placeholder token -----------------------------------------------------
//
// Chosen deliberately: curly-brace-delimited so it reads unmistakably as a
// template placeholder rather than a real colour; all-caps and
// prefixed/suffixed identically so it is easy to grep for or regex-replace;
// short, so it doesn't meaningfully affect the 700-byte Lucide cap.
//
// It is not valid CSS, and that matters for a *static* check, not a
// rendering one: verified directly, a renderer left holding an unsubstituted
// `{{STROKE}}` does not fail loudly — it renders exactly like an unresolved
// `currentColor` would, a visible stroke in whatever colour happened to be
// ambient in the surrounding graphics context (svg2pdf sets no colour for
// either unparseable value, so it inherits whatever was already active).
// The advantage of the placeholder over leaving `currentColor` in place is
// that it can never validly appear in shipped output, so a test or lint
// (`not.toMatch(/currentColor/)` is not enough on its own; grepping for
// `{{STROKE}}` in a would-be-final file is what actually catches a missed
// substitution) can catch a forgotten substitution before anything is
// rendered — not that the renderer itself will complain if one slips
// through.
export const PLACEHOLDER_STROKE = '{{STROKE}}';

// --- Upstream sources --------------------------------------------------------

const LUCIDE_OWNER = 'lucide-icons';
const LUCIDE_REPO = 'lucide';
const LUCIDE_BRANCH = 'main';
const LUCIDE_ICON_BASE = `https://raw.githubusercontent.com/${LUCIDE_OWNER}/${LUCIDE_REPO}/${LUCIDE_BRANCH}/icons`;
const LUCIDE_LICENSE_URL = `https://raw.githubusercontent.com/${LUCIDE_OWNER}/${LUCIDE_REPO}/${LUCIDE_BRANCH}/LICENSE`;

const TWEMOJI_OWNER = 'jdecked';
const TWEMOJI_REPO = 'twemoji';
const TWEMOJI_BRANCH = 'main';
const TWEMOJI_SVG_BASE = `https://raw.githubusercontent.com/${TWEMOJI_OWNER}/${TWEMOJI_REPO}/${TWEMOJI_BRANCH}/assets/svg`;
const TWEMOJI_LICENSE_GRAPHICS_URL = `https://raw.githubusercontent.com/${TWEMOJI_OWNER}/${TWEMOJI_REPO}/${TWEMOJI_BRANCH}/LICENSE-GRAPHICS`;

const LUCIDE_MAX_BYTES = 700;
const TWEMOJI_MAX_BYTES = 1500;

// --- Starter list ------------------------------------------------------------
//
// ~20 icons across both sources — enough to prove fetch, minify, licence
// and manifest end to end. Task B replaces this with the curated 500-entry
// registry; nothing here is meant to survive as the final set.
//
// `id` is the registry key this icon will be referenced by. `upstream` is
// the path segment fetched from each source's base URL above (no
// extension): for Lucide, its icon slug; for Twemoji, its codepoint.
const WANTED = [
    // Lucide — plain ISC icons.
    { id: 'heart', source: 'lucide', upstream: 'heart' },
    { id: 'star', source: 'lucide', upstream: 'star' },
    { id: 'gift', source: 'lucide', upstream: 'gift' },
    { id: 'leaf', source: 'lucide', upstream: 'leaf' },
    { id: 'flame', source: 'lucide', upstream: 'flame' },
    { id: 'zap', source: 'lucide', upstream: 'zap' },
    // Lucide — Feather-derived, the MIT half of the licence.
    { id: 'check', source: 'lucide', upstream: 'check' },
    { id: 'circle', source: 'lucide', upstream: 'circle' },
    { id: 'moon', source: 'lucide', upstream: 'moon' },
    { id: 'music', source: 'lucide', upstream: 'music' },
    { id: 'feather', source: 'lucide', upstream: 'feather' },
    // Twemoji — full-colour picture stickers, never recoloured.
    { id: 'grinning-face', source: 'twemoji', upstream: '1f600' },
    { id: 'red-heart', source: 'twemoji', upstream: '2764' },
    { id: 'sparkles', source: 'twemoji', upstream: '2728' },
    { id: 'glowing-star', source: 'twemoji', upstream: '2b50' },
    { id: 'cloud', source: 'twemoji', upstream: '2601' },
    { id: 'wrapped-gift', source: 'twemoji', upstream: '1f381' },
    { id: 'rocket', source: 'twemoji', upstream: '1f680' },
    { id: 'red-apple', source: 'twemoji', upstream: '1f34e' },
    { id: 'musical-note', source: 'twemoji', upstream: '1f3b5' },
];

// --- Fetch helpers -----------------------------------------------------------

async function fetchText(url) {
    let res;
    try {
        res = await fetch(url);
    } catch (err) {
        throw new Error(`fetch failed for ${url}: ${err.message}`);
    }
    if (!res.ok) {
        throw new Error(`fetch failed for ${url}: HTTP ${res.status} ${res.statusText}`);
    }
    return res.text();
}

/** HEAD-only existence check — no response body is downloaded. Returns
 * { ok, status } rather than throwing, since callers (preflightCheck) want
 * to collect every failure rather than stop at the first one. */
async function headCheck(url) {
    try {
        const res = await fetch(url, { method: 'HEAD' });
        return { ok: res.ok, status: String(res.status) };
    } catch (err) {
        return { ok: false, status: `network error: ${err.message}` };
    }
}

/** Best-effort git ref for provenance metadata. Never fails the build: an
 * unresolved ref just falls back to the branch name, since manifest
 * provenance is informational, unlike the icon/licence fetches above which
 * abort the build on failure. */
async function resolveRef(owner, repo, branch) {
    try {
        const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${branch}`, {
            headers: { Accept: 'application/vnd.github+json' },
        });
        if (!res.ok) return branch;
        const data = await res.json();
        return typeof data.sha === 'string' ? `${branch}@${data.sha.slice(0, 7)}` : branch;
    } catch {
        return branch;
    }
}

// --- Licence parsing -----------------------------------------------------

/** Parses the Feather-derived icon list out of Lucide's LICENSE text so the
 * MIT/ISC split is read from the actual downloaded file rather than
 * restated by hand and left to drift. */
function parseFeatherIds(licenseText) {
    const marker = 'are derived from the Feather project:';
    const idx = licenseText.indexOf(marker);
    if (idx === -1) {
        throw new Error('could not find the Feather-derived icon list in the Lucide LICENSE file — upstream format may have changed');
    }
    const after = licenseText.slice(idx + marker.length).replace(/^\s+/, '');
    const listEnd = after.indexOf('\n\n');
    if (listEnd === -1) {
        throw new Error('could not find the end of the Feather-derived icon list in the Lucide LICENSE file');
    }
    const ids = after.slice(0, listEnd).split(',').map(s => s.trim()).filter(Boolean);
    if (ids.length === 0) {
        throw new Error('parsed an empty Feather-derived icon list from the Lucide LICENSE file');
    }
    return new Set(ids);
}

// --- SVG minification ---------------------------------------------------------

const DRAWABLE_TAGS = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'g']);
const FLATTEN_ATTRS = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit'];
const BANNED_MARKUP = /<(use|script|style|foreignObject)\b/i;
const EVENT_HANDLER = /\son[a-z]+=/i;
const NON_HEX_COLOR = /hsla?\(/i;

const dom = new JSDOM();
const domParser = new dom.window.DOMParser();
const XMLSerializerCtor = dom.window.XMLSerializer;

function stripComments(node) {
    const toRemove = [];
    node.childNodes.forEach(child => {
        if (child.nodeType === 8) toRemove.push(child); // Comment
        else if (child.nodeType === 1) stripComments(child);
    });
    toRemove.forEach(c => c.remove());
}

function stripInsignificantWhitespace(node) {
    const toRemove = [];
    node.childNodes.forEach(child => {
        if (child.nodeType === 3) { // Text
            if (child.textContent.trim() === '') toRemove.push(child);
        } else if (child.nodeType === 1) {
            stripInsignificantWhitespace(child);
        }
    });
    toRemove.forEach(t => t.remove());
}

/** Copies root's fill/stroke/stroke-width/stroke-linecap/stroke-linejoin/
 * stroke-miterlimit onto every drawable descendant that doesn't already
 * declare its own value, respecting any override closer to the leaf. Not a
 * fix for broken inheritance (svg2pdf inherits from the root fine) — this is
 * what guarantees PLACEHOLDER_STROKE ends up on every child so a later
 * per-colourway find-and-replace can reach all of them. See design note 1
 * above. */
function flattenPresentationAttrs(root) {
    const rootValues = {};
    FLATTEN_ATTRS.forEach(name => {
        const v = root.getAttribute(name);
        if (v !== null) rootValues[name] = v;
    });

    (function walk(el, inherited) {
        Array.from(el.children).forEach(child => {
            const tag = child.tagName.toLowerCase();
            const childInherited = { ...inherited };
            FLATTEN_ATTRS.forEach(name => {
                const v = child.getAttribute(name);
                if (v !== null) childInherited[name] = v;
            });
            if (DRAWABLE_TAGS.has(tag)) {
                FLATTEN_ATTRS.forEach(name => {
                    if (child.getAttribute(name) === null && childInherited[name] !== undefined) {
                        child.setAttribute(name, childInherited[name]);
                    }
                });
            }
            walk(child, childInherited);
        });
    })(root, rootValues);
}

/** Replaces every literal `currentColor` attribute value with the
 * placeholder token — see design note 3 above. */
function resolveCurrentColor(root) {
    [root, ...Array.from(root.querySelectorAll('*'))].forEach(el => {
        Array.from(el.attributes).forEach(attr => {
            if (attr.value === 'currentColor') el.setAttribute(attr.name, PLACEHOLDER_STROKE);
        });
    });
}

/** Fetches, flattens, resolves currentColor, and minifies whitespace/
 * comments/cruft for one icon. Returns the serialized markup string
 * (without a trailing newline) and throws on anything the renderers would
 * reject. */
function minifySvg(raw, label) {
    const doc = domParser.parseFromString(raw, 'image/svg+xml');
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
        throw new Error(`${label}: not parseable as XML — ${parseError.textContent.trim().slice(0, 200)}`);
    }
    const root = doc.documentElement;
    if (!root || root.tagName.toLowerCase() !== 'svg') {
        throw new Error(`${label}: root element is not <svg>`);
    }
    if (!root.getAttribute('viewBox')) {
        throw new Error(`${label}: source has no viewBox`);
    }

    flattenPresentationAttrs(root);
    resolveCurrentColor(root);
    stripComments(root);
    stripInsignificantWhitespace(root);

    // Strip root cruft (class, width, height, the now-redundant
    // presentation attributes, ...) — keep only viewBox. Never touch
    // xmlns: see design note 2 above.
    Array.from(root.attributes).forEach(attr => {
        if (attr.name.toLowerCase() !== 'viewbox') root.removeAttribute(attr.name);
    });

    const markup = new XMLSerializerCtor().serializeToString(root);

    if (NON_HEX_COLOR.test(markup)) throw new Error(`${label}: contains hsl()/hsla(), only 6-digit hex or rgb() are allowed`);
    if (BANNED_MARKUP.test(markup)) throw new Error(`${label}: contains banned markup (use/script/style/foreignObject)`);
    if (EVENT_HANDLER.test(markup)) throw new Error(`${label}: contains an event handler attribute`);
    if (markup.includes('currentColor')) throw new Error(`${label}: currentColor survived minification`);
    if (/<svg[^>]*\swidth=/.test(markup)) throw new Error(`${label}: root <svg> still carries a width attribute`);

    return markup;
}

// --- Pipeline ------------------------------------------------------------

async function buildIcon(spec, featherIds) {
    const label = `${spec.source}/${spec.id}`;
    const url = spec.source === 'lucide'
        ? `${LUCIDE_ICON_BASE}/${spec.upstream}.svg`
        : `${TWEMOJI_SVG_BASE}/${spec.upstream}.svg`;

    const raw = await fetchText(url);
    const markup = `${minifySvg(raw, label)}\n`;
    const bytes = Buffer.byteLength(markup, 'utf8');

    const cap = spec.source === 'lucide' ? LUCIDE_MAX_BYTES : TWEMOJI_MAX_BYTES;
    if (bytes > cap) {
        throw new Error(`${label}: minified to ${bytes} bytes, exceeding the ${cap}-byte ${spec.source} cap — drop it from the starter list or pick a simpler icon`);
    }

    const licence = spec.source === 'twemoji'
        ? 'CC-BY-4.0'
        : (featherIds.has(spec.upstream) ? 'MIT' : 'ISC');

    return {
        id: spec.id,
        source: spec.source,
        upstream: spec.source === 'lucide' ? `icons/${spec.upstream}.svg` : `assets/svg/${spec.upstream}.svg`,
        bytes,
        licence,
        markup,
    };
}

/** Pre-flight mode (`--check`): HEAD-checks every id in WANTED against its
 * upstream URL, sequentially, and reports every missing one at the end —
 * downloads nothing, writes nothing. This exists because the npm-packaged
 * `lucide-static` and the live `lucide-icons/lucide` `main` icons/ tree have
 * drifted: npm carries deprecated aliases (e.g. `smile`) with no standalone
 * file upstream anymore, so a curated id list built by eye against the npm
 * package can contain several dead ids at once. Discovering those one at a
 * time by running the full sequential fetch-and-minify pipeline over and
 * over is slow; this turns it into a single report. */
async function preflightCheck() {
    console.log(`Pre-flight: HEAD-checking ${WANTED.length} icon ids (no downloads, no writes) ...`);
    const missing = [];
    for (const spec of WANTED) {
        const url = spec.source === 'lucide'
            ? `${LUCIDE_ICON_BASE}/${spec.upstream}.svg`
            : `${TWEMOJI_SVG_BASE}/${spec.upstream}.svg`;
        const { ok, status } = await headCheck(url);
        console.log(`  ${spec.source}/${spec.id} ... ${ok ? 'OK' : `MISSING (${status})`}`);
        if (!ok) missing.push({ ...spec, url, status });
    }

    console.log('');
    if (missing.length === 0) {
        console.log(`Pre-flight OK: all ${WANTED.length} ids resolve upstream.`);
        return;
    }

    console.log(`Pre-flight FAILED: ${missing.length} of ${WANTED.length} ids do not resolve upstream:`);
    missing.forEach(m => console.log(`  ${m.source}/${m.id} -> ${m.url} (${m.status})`));
    process.exitCode = 1;
}

async function main() {
    console.log(`Fetching Lucide LICENSE from ${LUCIDE_LICENSE_URL} ...`);
    const lucideLicenseText = await fetchText(LUCIDE_LICENSE_URL);
    const featherIds = parseFeatherIds(lucideLicenseText);
    console.log(`  parsed ${featherIds.size} Feather-derived icon names (MIT half)`);

    console.log(`Fetching Twemoji LICENSE-GRAPHICS from ${TWEMOJI_LICENSE_GRAPHICS_URL} ...`);
    const twemojiLicenseText = await fetchText(TWEMOJI_LICENSE_GRAPHICS_URL);
    if (!twemojiLicenseText.includes('Attribution 4.0 International')) {
        throw new Error('Twemoji LICENSE-GRAPHICS did not contain the expected CC-BY 4.0 attribution text — refusing to vendor under an unverified licence');
    }

    console.log(`Resolving upstream refs for provenance ...`);
    const lucideRef = await resolveRef(LUCIDE_OWNER, LUCIDE_REPO, LUCIDE_BRANCH);
    const twemojiRef = await resolveRef(TWEMOJI_OWNER, TWEMOJI_REPO, TWEMOJI_BRANCH);

    console.log(`Fetching and minifying ${WANTED.length} icons (sequentially, one request at a time) ...`);
    const icons = [];
    for (const spec of WANTED) {
        process.stdout.write(`  ${spec.source}/${spec.id} ... `);
        const icon = await buildIcon(spec, featherIds);
        console.log(`${icon.bytes} B, ${icon.licence}`);
        icons.push(icon);
    }

    const manifest = {
        generatedFrom: {
            lucide: { version: lucideRef, url: `https://github.com/${LUCIDE_OWNER}/${LUCIDE_REPO}` },
            twemoji: { ref: twemojiRef, url: `https://github.com/${TWEMOJI_OWNER}/${TWEMOJI_REPO}` },
        },
        icons: icons.map(({ id, source, upstream, bytes, licence }) => ({ id, source, upstream, bytes, licence })),
    };

    // Everything above succeeded — only now do we touch disk. Wipe and
    // recreate the per-source directories first so a rerun with a shorter
    // WANTED list never leaves an orphaned .svg behind.
    for (const source of ['lucide', 'twemoji']) {
        const dir = join(VENDOR_DIR, source);
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(dir, { recursive: true });
    }
    for (const icon of icons) {
        writeFileSync(join(VENDOR_DIR, icon.source, `${icon.id}.svg`), icon.markup, 'utf8');
    }
    writeFileSync(join(VENDOR_DIR, 'LICENSE-lucide'), lucideLicenseText, 'utf8');
    writeFileSync(join(VENDOR_DIR, 'LICENSE-twemoji-graphics'), twemojiLicenseText, 'utf8');
    writeFileSync(join(VENDOR_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    const totalBytes = icons.reduce((sum, i) => sum + i.bytes, 0);
    const bySource = source => icons.filter(i => i.source === source);
    const mean = list => (list.length ? Math.round(list.reduce((s, i) => s + i.bytes, 0) / list.length) : 0);
    console.log('');
    console.log(`Wrote ${icons.length} icons, ${totalBytes} bytes total.`);
    console.log(`  lucide:  ${bySource('lucide').length} icons, mean ${mean(bySource('lucide'))} B`);
    console.log(`  twemoji: ${bySource('twemoji').length} icons, mean ${mean(bySource('twemoji'))} B`);
    console.log(`Wrote manifest.json, LICENSE-lucide, LICENSE-twemoji-graphics.`);
}

// Only run the fetch/write pipeline when this file is executed directly
// (`node vendor/build.mjs`). PLACEHOLDER_STROKE is exported for a later
// build step to import without re-triggering a full network vendor run as
// an import side effect.
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
    const task = process.argv.includes('--check') ? preflightCheck() : main();
    task.catch(err => {
        console.error('');
        console.error(`sticker-press vendor build FAILED: ${err.message}`);
        process.exitCode = 1;
    });
}
