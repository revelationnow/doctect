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
// short, so it doesn't meaningfully affect the 1,200-byte Lucide cap.
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

const LUCIDE_MAX_BYTES = 1200;
const TWEMOJI_MAX_BYTES = 1500;

// --- Curated wanted list -----------------------------------------------------
//
// Task B's curated registry: every non-furniture entry in registry.json
// (furniture is generated by templates.js's builders, not fetched). 300
// Lucide ids + 150 Twemoji codepoints, grouped by the category they serve
// so this list reads the same way the registry does. Regenerated from
// gallery-samples/21-sticker-press/registry.json — keep the two in sync;
// registry.json is the source of truth for id/name/keywords, this file only
// needs id/source/upstream to fetch and vendor the artwork.
//
// `id` is the registry key this icon will be referenced by. `upstream` is
// the path segment fetched from each source's base URL above (no
// extension): for Lucide, its icon slug; for Twemoji, its codepoint.
const WANTED = [
    // Arrows & pointers (36)
    { id: 'lucide-arrow-big-up', source: 'lucide', upstream: 'arrow-big-up' },
    { id: 'lucide-arrow-big-down', source: 'lucide', upstream: 'arrow-big-down' },
    { id: 'lucide-arrow-big-left', source: 'lucide', upstream: 'arrow-big-left' },
    { id: 'lucide-arrow-big-right', source: 'lucide', upstream: 'arrow-big-right' },
    { id: 'lucide-arrow-up-right', source: 'lucide', upstream: 'arrow-up-right' },
    { id: 'lucide-arrow-up-left', source: 'lucide', upstream: 'arrow-up-left' },
    { id: 'lucide-arrow-down-right', source: 'lucide', upstream: 'arrow-down-right' },
    { id: 'lucide-arrow-down-left', source: 'lucide', upstream: 'arrow-down-left' },
    { id: 'lucide-arrow-up-down', source: 'lucide', upstream: 'arrow-up-down' },
    { id: 'lucide-arrow-left-right', source: 'lucide', upstream: 'arrow-left-right' },
    { id: 'lucide-corner-up-right', source: 'lucide', upstream: 'corner-up-right' },
    { id: 'lucide-corner-up-left', source: 'lucide', upstream: 'corner-up-left' },
    { id: 'lucide-corner-down-right', source: 'lucide', upstream: 'corner-down-right' },
    { id: 'lucide-corner-down-left', source: 'lucide', upstream: 'corner-down-left' },
    { id: 'lucide-chevron-up', source: 'lucide', upstream: 'chevron-up' },
    { id: 'lucide-chevron-down', source: 'lucide', upstream: 'chevron-down' },
    { id: 'lucide-chevron-left', source: 'lucide', upstream: 'chevron-left' },
    { id: 'lucide-chevron-right', source: 'lucide', upstream: 'chevron-right' },
    { id: 'lucide-chevrons-up', source: 'lucide', upstream: 'chevrons-up' },
    { id: 'lucide-chevrons-down', source: 'lucide', upstream: 'chevrons-down' },
    { id: 'lucide-circle-arrow-up', source: 'lucide', upstream: 'circle-arrow-up' },
    { id: 'lucide-circle-arrow-down', source: 'lucide', upstream: 'circle-arrow-down' },
    { id: 'lucide-circle-arrow-left', source: 'lucide', upstream: 'circle-arrow-left' },
    { id: 'lucide-circle-arrow-right', source: 'lucide', upstream: 'circle-arrow-right' },
    { id: 'lucide-mouse-pointer', source: 'lucide', upstream: 'mouse-pointer' },
    { id: 'lucide-mouse-pointer-click', source: 'lucide', upstream: 'mouse-pointer-click' },
    { id: 'lucide-trending-up', source: 'lucide', upstream: 'trending-up' },
    { id: 'lucide-trending-down', source: 'lucide', upstream: 'trending-down' },
    { id: 'lucide-navigation', source: 'lucide', upstream: 'navigation' },
    { id: 'lucide-navigation-2', source: 'lucide', upstream: 'navigation-2' },
    { id: 'lucide-redo', source: 'lucide', upstream: 'redo' },
    { id: 'lucide-undo', source: 'lucide', upstream: 'undo' },
    { id: 'lucide-refresh-cw', source: 'lucide', upstream: 'refresh-cw' },
    { id: 'lucide-rotate-cw', source: 'lucide', upstream: 'rotate-cw' },
    { id: 'lucide-expand', source: 'lucide', upstream: 'expand' },
    { id: 'lucide-shrink', source: 'lucide', upstream: 'shrink' },
    // Boxes, bullets, markers (31)
    { id: 'lucide-box', source: 'lucide', upstream: 'box' },
    { id: 'lucide-package', source: 'lucide', upstream: 'package' },
    { id: 'lucide-archive', source: 'lucide', upstream: 'archive' },
    { id: 'lucide-inbox', source: 'lucide', upstream: 'inbox' },
    { id: 'lucide-layers', source: 'lucide', upstream: 'layers' },
    { id: 'lucide-grid-3x3', source: 'lucide', upstream: 'grid-3x3' },
    { id: 'lucide-list', source: 'lucide', upstream: 'list' },
    { id: 'lucide-list-checks', source: 'lucide', upstream: 'list-checks' },
    { id: 'lucide-list-todo', source: 'lucide', upstream: 'list-todo' },
    { id: 'lucide-check', source: 'lucide', upstream: 'check' },
    { id: 'lucide-circle-check', source: 'lucide', upstream: 'circle-check' },
    { id: 'lucide-square-check', source: 'lucide', upstream: 'square-check' },
    { id: 'lucide-circle', source: 'lucide', upstream: 'circle' },
    { id: 'lucide-square', source: 'lucide', upstream: 'square' },
    { id: 'lucide-triangle', source: 'lucide', upstream: 'triangle' },
    { id: 'lucide-hexagon', source: 'lucide', upstream: 'hexagon' },
    { id: 'lucide-pentagon', source: 'lucide', upstream: 'pentagon' },
    { id: 'lucide-octagon', source: 'lucide', upstream: 'octagon' },
    { id: 'lucide-diamond', source: 'lucide', upstream: 'diamond' },
    { id: 'lucide-disc', source: 'lucide', upstream: 'disc' },
    { id: 'lucide-target', source: 'lucide', upstream: 'target' },
    { id: 'lucide-crosshair', source: 'lucide', upstream: 'crosshair' },
    { id: 'lucide-badge', source: 'lucide', upstream: 'badge' },
    { id: 'lucide-badge-check', source: 'lucide', upstream: 'badge-check' },
    { id: 'lucide-tag', source: 'lucide', upstream: 'tag' },
    { id: 'lucide-tags', source: 'lucide', upstream: 'tags' },
    { id: 'lucide-bookmark', source: 'lucide', upstream: 'bookmark' },
    { id: 'lucide-flag', source: 'lucide', upstream: 'flag' },
    { id: 'lucide-pin', source: 'lucide', upstream: 'pin' },
    { id: 'lucide-map-pin', source: 'lucide', upstream: 'map-pin' },
    { id: 'lucide-shapes', source: 'lucide', upstream: 'shapes' },
    // Stars, sparkles, awards (27)
    { id: 'lucide-star', source: 'lucide', upstream: 'star' },
    { id: 'lucide-vote', source: 'lucide', upstream: 'vote' },
    { id: 'lucide-sparkle', source: 'lucide', upstream: 'sparkle' },
    { id: 'lucide-sparkles', source: 'lucide', upstream: 'sparkles' },
    { id: 'lucide-award', source: 'lucide', upstream: 'award' },
    { id: 'lucide-trophy', source: 'lucide', upstream: 'trophy' },
    { id: 'lucide-medal', source: 'lucide', upstream: 'medal' },
    { id: 'lucide-crown', source: 'lucide', upstream: 'crown' },
    { id: 'lucide-gem', source: 'lucide', upstream: 'gem' },
    { id: 'lucide-ribbon', source: 'lucide', upstream: 'ribbon' },
    { id: 'lucide-shield', source: 'lucide', upstream: 'shield' },
    { id: 'lucide-shield-check', source: 'lucide', upstream: 'shield-check' },
    { id: 'lucide-heart', source: 'lucide', upstream: 'heart' },
    { id: 'lucide-heart-handshake', source: 'lucide', upstream: 'heart-handshake' },
    { id: 'lucide-thumbs-up', source: 'lucide', upstream: 'thumbs-up' },
    { id: 'lucide-zap', source: 'lucide', upstream: 'zap' },
    { id: 'lucide-square-star', source: 'lucide', upstream: 'square-star' },
    { id: 'lucide-asterisk', source: 'lucide', upstream: 'asterisk' },
    { id: 'lucide-flame', source: 'lucide', upstream: 'flame' },
    { id: 'lucide-diamond-plus', source: 'lucide', upstream: 'diamond-plus' },
    { id: 'lucide-moon-star', source: 'lucide', upstream: 'moon-star' },
    { id: 'lucide-handshake', source: 'lucide', upstream: 'handshake' },
    { id: 'lucide-stamp', source: 'lucide', upstream: 'stamp' },
    { id: 'lucide-podium', source: 'lucide', upstream: 'podium' },
    { id: 'lucide-circle-star', source: 'lucide', upstream: 'circle-star' },
    { id: 'lucide-spotlight', source: 'lucide', upstream: 'spotlight' },
    { id: 'lucide-circle-gauge', source: 'lucide', upstream: 'circle-gauge' },
    // Dividers, corners, frames (25)
    { id: 'lucide-separator-horizontal', source: 'lucide', upstream: 'separator-horizontal' },
    { id: 'lucide-separator-vertical', source: 'lucide', upstream: 'separator-vertical' },
    { id: 'lucide-minus', source: 'lucide', upstream: 'minus' },
    { id: 'lucide-frame', source: 'lucide', upstream: 'frame' },
    { id: 'lucide-crop', source: 'lucide', upstream: 'crop' },
    { id: 'lucide-scan', source: 'lucide', upstream: 'scan' },
    { id: 'lucide-scan-line', source: 'lucide', upstream: 'scan-line' },
    { id: 'lucide-ruler', source: 'lucide', upstream: 'ruler' },
    { id: 'lucide-ellipsis', source: 'lucide', upstream: 'ellipsis' },
    { id: 'lucide-ellipsis-vertical', source: 'lucide', upstream: 'ellipsis-vertical' },
    { id: 'lucide-square-round-corner', source: 'lucide', upstream: 'square-round-corner' },
    { id: 'lucide-rows-2', source: 'lucide', upstream: 'rows-2' },
    { id: 'lucide-layout-grid', source: 'lucide', upstream: 'layout-grid' },
    { id: 'lucide-grip-horizontal', source: 'lucide', upstream: 'grip-horizontal' },
    { id: 'lucide-grip-vertical', source: 'lucide', upstream: 'grip-vertical' },
    { id: 'lucide-dot', source: 'lucide', upstream: 'dot' },
    { id: 'lucide-slash', source: 'lucide', upstream: 'slash' },
    { id: 'lucide-columns-2', source: 'lucide', upstream: 'columns-2' },
    { id: 'lucide-waypoints', source: 'lucide', upstream: 'waypoints' },
    { id: 'lucide-spline', source: 'lucide', upstream: 'spline' },
    { id: 'lucide-diameter', source: 'lucide', upstream: 'diameter' },
    { id: 'lucide-ratio', source: 'lucide', upstream: 'ratio' },
    { id: 'lucide-ruler-dimension-line', source: 'lucide', upstream: 'ruler-dimension-line' },
    { id: 'lucide-square-slash', source: 'lucide', upstream: 'square-slash' },
    { id: 'lucide-square-dashed-bottom', source: 'lucide', upstream: 'square-dashed-bottom' },
    // Weather & sky (26)
    { id: 'lucide-sun', source: 'lucide', upstream: 'sun' },
    { id: 'lucide-moon', source: 'lucide', upstream: 'moon' },
    { id: 'lucide-cloud', source: 'lucide', upstream: 'cloud' },
    { id: 'lucide-cloud-rain', source: 'lucide', upstream: 'cloud-rain' },
    { id: 'lucide-cloud-snow', source: 'lucide', upstream: 'cloud-snow' },
    { id: 'lucide-cloud-lightning', source: 'lucide', upstream: 'cloud-lightning' },
    { id: 'lucide-cloud-sun', source: 'lucide', upstream: 'cloud-sun' },
    { id: 'lucide-wind', source: 'lucide', upstream: 'wind' },
    { id: 'lucide-umbrella', source: 'lucide', upstream: 'umbrella' },
    { id: 'lucide-rainbow', source: 'lucide', upstream: 'rainbow' },
    { id: 'lucide-thermometer-snowflake', source: 'lucide', upstream: 'thermometer-snowflake' },
    { id: 'lucide-thermometer', source: 'lucide', upstream: 'thermometer' },
    { id: 'lucide-sunrise', source: 'lucide', upstream: 'sunrise' },
    { id: 'lucide-sunset', source: 'lucide', upstream: 'sunset' },
    { id: 'twemoji-sun', source: 'twemoji', upstream: '2600' },
    { id: 'twemoji-cloud', source: 'twemoji', upstream: '2601' },
    { id: 'twemoji-cloud-rain', source: 'twemoji', upstream: '1f327' },
    { id: 'twemoji-cloud-lightning', source: 'twemoji', upstream: '1f329' },
    { id: 'twemoji-rainbow', source: 'twemoji', upstream: '1f308' },
    { id: 'twemoji-snowflake', source: 'twemoji', upstream: '2744' },
    { id: 'twemoji-umbrella-rain', source: 'twemoji', upstream: '2614' },
    { id: 'twemoji-water-wave', source: 'twemoji', upstream: '1f30a' },
    { id: 'twemoji-droplet', source: 'twemoji', upstream: '1f4a7' },
    { id: 'twemoji-high-voltage', source: 'twemoji', upstream: '26a1' },
    { id: 'twemoji-comet', source: 'twemoji', upstream: '2604' },
    { id: 'twemoji-sun-behind-cloud', source: 'twemoji', upstream: '26c5' },
    // Botanical (22)
    { id: 'lucide-tree-deciduous', source: 'lucide', upstream: 'tree-deciduous' },
    { id: 'lucide-tree-palm', source: 'lucide', upstream: 'tree-palm' },
    { id: 'lucide-tree-pine', source: 'lucide', upstream: 'tree-pine' },
    { id: 'lucide-trees', source: 'lucide', upstream: 'trees' },
    { id: 'lucide-citrus', source: 'lucide', upstream: 'citrus' },
    { id: 'lucide-flower-2', source: 'lucide', upstream: 'flower-2' },
    { id: 'lucide-leaf', source: 'lucide', upstream: 'leaf' },
    { id: 'lucide-leafy-green', source: 'lucide', upstream: 'leafy-green' },
    { id: 'lucide-sprout', source: 'lucide', upstream: 'sprout' },
    { id: 'lucide-cherry', source: 'lucide', upstream: 'cherry' },
    { id: 'lucide-clover', source: 'lucide', upstream: 'clover' },
    { id: 'lucide-shrub', source: 'lucide', upstream: 'shrub' },
    { id: 'twemoji-seedling', source: 'twemoji', upstream: '1f331' },
    { id: 'twemoji-tulip', source: 'twemoji', upstream: '1f337' },
    { id: 'twemoji-shamrock', source: 'twemoji', upstream: '2618' },
    { id: 'twemoji-maple-leaf', source: 'twemoji', upstream: '1f341' },
    { id: 'twemoji-rose', source: 'twemoji', upstream: '1f339' },
    { id: 'twemoji-mushroom', source: 'twemoji', upstream: '1f344' },
    { id: 'twemoji-cactus', source: 'twemoji', upstream: '1f335' },
    { id: 'twemoji-four-leaf-clover', source: 'twemoji', upstream: '1f340' },
    { id: 'twemoji-deciduous-tree', source: 'twemoji', upstream: '1f333' },
    { id: 'twemoji-sunflower', source: 'twemoji', upstream: '1f33b' },
    // Animals (34)
    { id: 'twemoji-monkey-face', source: 'twemoji', upstream: '1f435' },
    { id: 'twemoji-cow-face', source: 'twemoji', upstream: '1f42e' },
    { id: 'twemoji-pig-face', source: 'twemoji', upstream: '1f437' },
    { id: 'twemoji-elephant', source: 'twemoji', upstream: '1f418' },
    { id: 'twemoji-bison', source: 'twemoji', upstream: '1f9ac' },
    { id: 'twemoji-water-buffalo', source: 'twemoji', upstream: '1f403' },
    { id: 'twemoji-rabbit-face', source: 'twemoji', upstream: '1f430' },
    { id: 'twemoji-koala', source: 'twemoji', upstream: '1f428' },
    { id: 'twemoji-panda', source: 'twemoji', upstream: '1f43c' },
    { id: 'twemoji-chicken', source: 'twemoji', upstream: '1f414' },
    { id: 'twemoji-penguin', source: 'twemoji', upstream: '1f427' },
    { id: 'twemoji-duck', source: 'twemoji', upstream: '1f986' },
    { id: 'twemoji-frog', source: 'twemoji', upstream: '1f438' },
    { id: 'twemoji-turtle', source: 'twemoji', upstream: '1f422' },
    { id: 'twemoji-snake', source: 'twemoji', upstream: '1f40d' },
    { id: 'twemoji-dolphin', source: 'twemoji', upstream: '1f42c' },
    { id: 'twemoji-tropical-fish', source: 'twemoji', upstream: '1f420' },
    { id: 'twemoji-octopus', source: 'twemoji', upstream: '1f419' },
    { id: 'twemoji-snail', source: 'twemoji', upstream: '1f40c' },
    { id: 'twemoji-leopard', source: 'twemoji', upstream: '1f406' },
    { id: 'twemoji-ox', source: 'twemoji', upstream: '1f402' },
    { id: 'twemoji-ewe', source: 'twemoji', upstream: '1f411' },
    { id: 'twemoji-rat', source: 'twemoji', upstream: '1f400' },
    { id: 'twemoji-rooster', source: 'twemoji', upstream: '1f413' },
    { id: 'twemoji-dove', source: 'twemoji', upstream: '1f54a' },
    { id: 'twemoji-swan', source: 'twemoji', upstream: '1f9a2' },
    { id: 'twemoji-crocodile', source: 'twemoji', upstream: '1f40a' },
    { id: 'twemoji-whale', source: 'twemoji', upstream: '1f40b' },
    { id: 'twemoji-shark', source: 'twemoji', upstream: '1f988' },
    { id: 'twemoji-squid', source: 'twemoji', upstream: '1f991' },
    { id: 'twemoji-eagle', source: 'twemoji', upstream: '1f985' },
    { id: 'twemoji-camel', source: 'twemoji', upstream: '1f42a' },
    { id: 'twemoji-two-hump-camel', source: 'twemoji', upstream: '1f42b' },
    { id: 'twemoji-paw-prints', source: 'twemoji', upstream: '1f43e' },
    // Food & drink (35)
    { id: 'lucide-chef-hat', source: 'lucide', upstream: 'chef-hat' },
    { id: 'lucide-utensils', source: 'lucide', upstream: 'utensils' },
    { id: 'lucide-soup', source: 'lucide', upstream: 'soup' },
    { id: 'lucide-salad', source: 'lucide', upstream: 'salad' },
    { id: 'lucide-ice-cream-cone', source: 'lucide', upstream: 'ice-cream-cone' },
    { id: 'lucide-martini', source: 'lucide', upstream: 'martini' },
    { id: 'lucide-cake', source: 'lucide', upstream: 'cake' },
    { id: 'lucide-sandwich', source: 'lucide', upstream: 'sandwich' },
    { id: 'twemoji-watermelon', source: 'twemoji', upstream: '1f349' },
    { id: 'twemoji-lemon', source: 'twemoji', upstream: '1f34b' },
    { id: 'twemoji-banana', source: 'twemoji', upstream: '1f34c' },
    { id: 'twemoji-red-apple', source: 'twemoji', upstream: '1f34e' },
    { id: 'twemoji-green-apple', source: 'twemoji', upstream: '1f34f' },
    { id: 'twemoji-pear', source: 'twemoji', upstream: '1f350' },
    { id: 'twemoji-cherries', source: 'twemoji', upstream: '1f352' },
    { id: 'twemoji-tomato', source: 'twemoji', upstream: '1f345' },
    { id: 'twemoji-avocado', source: 'twemoji', upstream: '1f951' },
    { id: 'twemoji-carrot', source: 'twemoji', upstream: '1f955' },
    { id: 'twemoji-hot-pepper', source: 'twemoji', upstream: '1f336' },
    { id: 'twemoji-bread', source: 'twemoji', upstream: '1f35e' },
    { id: 'twemoji-croissant', source: 'twemoji', upstream: '1f950' },
    { id: 'twemoji-pizza', source: 'twemoji', upstream: '1f355' },
    { id: 'twemoji-egg', source: 'twemoji', upstream: '1f95a' },
    { id: 'twemoji-chocolate-bar', source: 'twemoji', upstream: '1f36b' },
    { id: 'twemoji-honey-pot', source: 'twemoji', upstream: '1f36f' },
    { id: 'twemoji-hot-beverage', source: 'twemoji', upstream: '2615' },
    { id: 'twemoji-wine-glass', source: 'twemoji', upstream: '1f377' },
    { id: 'twemoji-beer-mug', source: 'twemoji', upstream: '1f37a' },
    { id: 'twemoji-fork-knife', source: 'twemoji', upstream: '1f374' },
    { id: 'twemoji-spoon', source: 'twemoji', upstream: '1f944' },
    { id: 'twemoji-grapes', source: 'twemoji', upstream: '1f347' },
    { id: 'twemoji-tangerine', source: 'twemoji', upstream: '1f34a' },
    { id: 'twemoji-bowl-with-spoon', source: 'twemoji', upstream: '1f963' },
    { id: 'twemoji-butter', source: 'twemoji', upstream: '1f9c8' },
    { id: 'twemoji-salt', source: 'twemoji', upstream: '1f9c2' },
    // Faces & moods (24)
    { id: 'twemoji-grinning-face', source: 'twemoji', upstream: '1f600' },
    { id: 'twemoji-grinning-smiling-eyes', source: 'twemoji', upstream: '1f604' },
    { id: 'twemoji-beaming-face', source: 'twemoji', upstream: '1f601' },
    { id: 'twemoji-dizzy-face', source: 'twemoji', upstream: '1f635' },
    { id: 'twemoji-slightly-smiling', source: 'twemoji', upstream: '1f642' },
    { id: 'twemoji-winking-face', source: 'twemoji', upstream: '1f609' },
    { id: 'twemoji-smiling-face', source: 'twemoji', upstream: '1f60a' },
    { id: 'twemoji-heart-eyes', source: 'twemoji', upstream: '1f60d' },
    { id: 'twemoji-star-struck', source: 'twemoji', upstream: '1f929' },
    { id: 'twemoji-savoring-food', source: 'twemoji', upstream: '1f60b' },
    { id: 'twemoji-tongue', source: 'twemoji', upstream: '1f61b' },
    { id: 'twemoji-neutral', source: 'twemoji', upstream: '1f610' },
    { id: 'twemoji-smirking', source: 'twemoji', upstream: '1f60f' },
    { id: 'twemoji-rolling-eyes', source: 'twemoji', upstream: '1f644' },
    { id: 'twemoji-grimacing', source: 'twemoji', upstream: '1f62c' },
    { id: 'twemoji-relieved', source: 'twemoji', upstream: '1f60c' },
    { id: 'twemoji-medical-mask', source: 'twemoji', upstream: '1f637' },
    { id: 'twemoji-nauseated', source: 'twemoji', upstream: '1f922' },
    { id: 'twemoji-pouting', source: 'twemoji', upstream: '1f621' },
    { id: 'twemoji-angry', source: 'twemoji', upstream: '1f620' },
    { id: 'twemoji-crying', source: 'twemoji', upstream: '1f622' },
    { id: 'twemoji-fearful', source: 'twemoji', upstream: '1f628' },
    { id: 'twemoji-sunglasses-face', source: 'twemoji', upstream: '1f60e' },
    { id: 'twemoji-no-mouth', source: 'twemoji', upstream: '1f636' },
    // Study & work (43)
    { id: 'lucide-book', source: 'lucide', upstream: 'book' },
    { id: 'lucide-book-open', source: 'lucide', upstream: 'book-open' },
    { id: 'lucide-notebook', source: 'lucide', upstream: 'notebook' },
    { id: 'lucide-pencil', source: 'lucide', upstream: 'pencil' },
    { id: 'lucide-pen', source: 'lucide', upstream: 'pen' },
    { id: 'lucide-pen-tool', source: 'lucide', upstream: 'pen-tool' },
    { id: 'lucide-highlighter', source: 'lucide', upstream: 'highlighter' },
    { id: 'lucide-eraser', source: 'lucide', upstream: 'eraser' },
    { id: 'lucide-clipboard-pen', source: 'lucide', upstream: 'clipboard-pen' },
    { id: 'lucide-backpack', source: 'lucide', upstream: 'backpack' },
    { id: 'lucide-graduation-cap', source: 'lucide', upstream: 'graduation-cap' },
    { id: 'lucide-school', source: 'lucide', upstream: 'school' },
    { id: 'lucide-briefcase', source: 'lucide', upstream: 'briefcase' },
    { id: 'lucide-folder', source: 'lucide', upstream: 'folder' },
    { id: 'lucide-folder-open', source: 'lucide', upstream: 'folder-open' },
    { id: 'lucide-file', source: 'lucide', upstream: 'file' },
    { id: 'lucide-file-text', source: 'lucide', upstream: 'file-text' },
    { id: 'lucide-clipboard', source: 'lucide', upstream: 'clipboard' },
    { id: 'lucide-clipboard-list', source: 'lucide', upstream: 'clipboard-list' },
    { id: 'lucide-clipboard-check', source: 'lucide', upstream: 'clipboard-check' },
    { id: 'lucide-paperclip', source: 'lucide', upstream: 'paperclip' },
    { id: 'lucide-scissors', source: 'lucide', upstream: 'scissors' },
    { id: 'lucide-laptop', source: 'lucide', upstream: 'laptop' },
    { id: 'lucide-monitor', source: 'lucide', upstream: 'monitor' },
    { id: 'lucide-keyboard', source: 'lucide', upstream: 'keyboard' },
    { id: 'lucide-mouse', source: 'lucide', upstream: 'mouse' },
    { id: 'lucide-printer', source: 'lucide', upstream: 'printer' },
    { id: 'lucide-presentation', source: 'lucide', upstream: 'presentation' },
    { id: 'lucide-chart-bar', source: 'lucide', upstream: 'chart-bar' },
    { id: 'lucide-chart-line', source: 'lucide', upstream: 'chart-line' },
    { id: 'lucide-chart-pie', source: 'lucide', upstream: 'chart-pie' },
    { id: 'lucide-library', source: 'lucide', upstream: 'library' },
    { id: 'lucide-microscope', source: 'lucide', upstream: 'microscope' },
    { id: 'lucide-flask-conical', source: 'lucide', upstream: 'flask-conical' },
    { id: 'lucide-atom', source: 'lucide', upstream: 'atom' },
    { id: 'lucide-globe', source: 'lucide', upstream: 'globe' },
    { id: 'lucide-compass', source: 'lucide', upstream: 'compass' },
    { id: 'lucide-calendar', source: 'lucide', upstream: 'calendar' },
    { id: 'lucide-clock', source: 'lucide', upstream: 'clock' },
    { id: 'lucide-alarm-clock', source: 'lucide', upstream: 'alarm-clock' },
    { id: 'lucide-timer', source: 'lucide', upstream: 'timer' },
    { id: 'lucide-lightbulb', source: 'lucide', upstream: 'lightbulb' },
    { id: 'lucide-puzzle', source: 'lucide', upstream: 'puzzle' },
    // Health & self-care (29)
    { id: 'lucide-activity', source: 'lucide', upstream: 'activity' },
    { id: 'lucide-bandage', source: 'lucide', upstream: 'bandage' },
    { id: 'lucide-bath', source: 'lucide', upstream: 'bath' },
    { id: 'lucide-bed', source: 'lucide', upstream: 'bed' },
    { id: 'lucide-bike', source: 'lucide', upstream: 'bike' },
    { id: 'lucide-brain', source: 'lucide', upstream: 'brain' },
    { id: 'lucide-cross', source: 'lucide', upstream: 'cross' },
    { id: 'lucide-dumbbell', source: 'lucide', upstream: 'dumbbell' },
    { id: 'lucide-footprints', source: 'lucide', upstream: 'footprints' },
    { id: 'lucide-heart-pulse', source: 'lucide', upstream: 'heart-pulse' },
    { id: 'lucide-pill', source: 'lucide', upstream: 'pill' },
    { id: 'lucide-scale', source: 'lucide', upstream: 'scale' },
    { id: 'lucide-stethoscope', source: 'lucide', upstream: 'stethoscope' },
    { id: 'lucide-syringe', source: 'lucide', upstream: 'syringe' },
    { id: 'lucide-weight', source: 'lucide', upstream: 'weight' },
    { id: 'lucide-accessibility', source: 'lucide', upstream: 'accessibility' },
    { id: 'lucide-ambulance', source: 'lucide', upstream: 'ambulance' },
    { id: 'lucide-eye', source: 'lucide', upstream: 'eye' },
    { id: 'lucide-glasses', source: 'lucide', upstream: 'glasses' },
    { id: 'lucide-hand-heart', source: 'lucide', upstream: 'hand-heart' },
    { id: 'twemoji-pill', source: 'twemoji', upstream: '1f48a' },
    { id: 'twemoji-hospital', source: 'twemoji', upstream: '1f3e5' },
    { id: 'twemoji-adhesive-bandage', source: 'twemoji', upstream: '1fa79' },
    { id: 'twemoji-tooth', source: 'twemoji', upstream: '1f9b7' },
    { id: 'twemoji-toothbrush', source: 'twemoji', upstream: '1faa5' },
    { id: 'twemoji-bathtub', source: 'twemoji', upstream: '1f6c1' },
    { id: 'twemoji-zzz', source: 'twemoji', upstream: '1f4a4' },
    { id: 'twemoji-lotion-bottle', source: 'twemoji', upstream: '1f9f4' },
    { id: 'twemoji-petri-dish', source: 'twemoji', upstream: '1f9eb' },
    // Travel & places (30)
    { id: 'lucide-plane', source: 'lucide', upstream: 'plane' },
    { id: 'lucide-car', source: 'lucide', upstream: 'car' },
    { id: 'lucide-train-front', source: 'lucide', upstream: 'train-front' },
    { id: 'lucide-bus', source: 'lucide', upstream: 'bus' },
    { id: 'lucide-ship', source: 'lucide', upstream: 'ship' },
    { id: 'lucide-map', source: 'lucide', upstream: 'map' },
    { id: 'lucide-tent', source: 'lucide', upstream: 'tent' },
    { id: 'lucide-mountain', source: 'lucide', upstream: 'mountain' },
    { id: 'lucide-luggage', source: 'lucide', upstream: 'luggage' },
    { id: 'lucide-anchor', source: 'lucide', upstream: 'anchor' },
    { id: 'lucide-sailboat', source: 'lucide', upstream: 'sailboat' },
    { id: 'lucide-rocket', source: 'lucide', upstream: 'rocket' },
    { id: 'lucide-ferris-wheel', source: 'lucide', upstream: 'ferris-wheel' },
    { id: 'lucide-camera', source: 'lucide', upstream: 'camera' },
    { id: 'lucide-binoculars', source: 'lucide', upstream: 'binoculars' },
    { id: 'lucide-landmark', source: 'lucide', upstream: 'landmark' },
    { id: 'lucide-castle', source: 'lucide', upstream: 'castle' },
    { id: 'lucide-signpost', source: 'lucide', upstream: 'signpost' },
    { id: 'twemoji-globe-africa', source: 'twemoji', upstream: '1f30d' },
    { id: 'twemoji-compass', source: 'twemoji', upstream: '1f9ed' },
    { id: 'twemoji-mountain', source: 'twemoji', upstream: '26f0' },
    { id: 'twemoji-tent', source: 'twemoji', upstream: '26fa' },
    { id: 'twemoji-anchor', source: 'twemoji', upstream: '2693' },
    { id: 'twemoji-sailboat', source: 'twemoji', upstream: '26f5' },
    { id: 'twemoji-ship', source: 'twemoji', upstream: '1f6a2' },
    { id: 'twemoji-airplane', source: 'twemoji', upstream: '2708' },
    { id: 'twemoji-rocket', source: 'twemoji', upstream: '1f680' },
    { id: 'twemoji-luggage', source: 'twemoji', upstream: '1f9f3' },
    { id: 'twemoji-beach-umbrella', source: 'twemoji', upstream: '1f3d6' },
    { id: 'twemoji-train', source: 'twemoji', upstream: '1f686' },
    // Celebration & seasons (26)
    { id: 'lucide-balloon', source: 'lucide', upstream: 'balloon' },
    { id: 'lucide-cake-slice', source: 'lucide', upstream: 'cake-slice' },
    { id: 'lucide-candy-cane', source: 'lucide', upstream: 'candy-cane' },
    { id: 'lucide-gift', source: 'lucide', upstream: 'gift' },
    { id: 'lucide-venetian-mask', source: 'lucide', upstream: 'venetian-mask' },
    { id: 'lucide-drum', source: 'lucide', upstream: 'drum' },
    { id: 'lucide-music', source: 'lucide', upstream: 'music' },
    { id: 'lucide-wand-sparkles', source: 'lucide', upstream: 'wand-sparkles' },
    { id: 'twemoji-2nd-place-medal', source: 'twemoji', upstream: '1f948' },
    { id: 'twemoji-firecracker', source: 'twemoji', upstream: '1f9e8' },
    { id: 'twemoji-balloon', source: 'twemoji', upstream: '1f388' },
    { id: 'twemoji-wrapped-gift', source: 'twemoji', upstream: '1f381' },
    { id: 'twemoji-crystal-ball', source: 'twemoji', upstream: '1f52e' },
    { id: 'twemoji-bullseye', source: 'twemoji', upstream: '1f3af' },
    { id: 'twemoji-yo-yo', source: 'twemoji', upstream: '1fa80' },
    { id: 'twemoji-3rd-place-medal', source: 'twemoji', upstream: '1f949' },
    { id: 'twemoji-pool-8-ball', source: 'twemoji', upstream: '1f3b1' },
    { id: 'twemoji-admission-tickets', source: 'twemoji', upstream: '1f39f' },
    { id: 'twemoji-ticket', source: 'twemoji', upstream: '1f3ab' },
    { id: 'twemoji-wind-chime', source: 'twemoji', upstream: '1f390' },
    { id: 'twemoji-carp-streamer', source: 'twemoji', upstream: '1f38f' },
    { id: 'twemoji-basketball', source: 'twemoji', upstream: '1f3c0' },
    { id: 'twemoji-american-football', source: 'twemoji', upstream: '1f3c8' },
    { id: 'twemoji-trophy', source: 'twemoji', upstream: '1f3c6' },
    { id: 'twemoji-1st-place-medal', source: 'twemoji', upstream: '1f947' },
    { id: 'twemoji-military-medal', source: 'twemoji', upstream: '1f396' },
    // Money & home (33)
    { id: 'lucide-dollar-sign', source: 'lucide', upstream: 'dollar-sign' },
    { id: 'lucide-credit-card', source: 'lucide', upstream: 'credit-card' },
    { id: 'lucide-wallet', source: 'lucide', upstream: 'wallet' },
    { id: 'lucide-piggy-bank', source: 'lucide', upstream: 'piggy-bank' },
    { id: 'lucide-banknote', source: 'lucide', upstream: 'banknote' },
    { id: 'lucide-coins', source: 'lucide', upstream: 'coins' },
    { id: 'lucide-receipt', source: 'lucide', upstream: 'receipt' },
    { id: 'lucide-percent', source: 'lucide', upstream: 'percent' },
    { id: 'lucide-hand-coins', source: 'lucide', upstream: 'hand-coins' },
    { id: 'lucide-circle-dollar-sign', source: 'lucide', upstream: 'circle-dollar-sign' },
    { id: 'lucide-building-2', source: 'lucide', upstream: 'building-2' },
    { id: 'lucide-house', source: 'lucide', upstream: 'house' },
    { id: 'lucide-door-open', source: 'lucide', upstream: 'door-open' },
    { id: 'lucide-key', source: 'lucide', upstream: 'key' },
    { id: 'lucide-key-round', source: 'lucide', upstream: 'key-round' },
    { id: 'lucide-lamp', source: 'lucide', upstream: 'lamp' },
    { id: 'lucide-sofa', source: 'lucide', upstream: 'sofa' },
    { id: 'lucide-armchair', source: 'lucide', upstream: 'armchair' },
    { id: 'lucide-plug', source: 'lucide', upstream: 'plug' },
    { id: 'lucide-wrench', source: 'lucide', upstream: 'wrench' },
    { id: 'lucide-hammer', source: 'lucide', upstream: 'hammer' },
    { id: 'lucide-paintbrush', source: 'lucide', upstream: 'paintbrush' },
    { id: 'lucide-fan', source: 'lucide', upstream: 'fan' },
    { id: 'lucide-washing-machine', source: 'lucide', upstream: 'washing-machine' },
    { id: 'lucide-refrigerator', source: 'lucide', upstream: 'refrigerator' },
    { id: 'lucide-trash-2', source: 'lucide', upstream: 'trash-2' },
    { id: 'lucide-recycle', source: 'lucide', upstream: 'recycle' },
    { id: 'lucide-toilet', source: 'lucide', upstream: 'toilet' },
    { id: 'lucide-lock-keyhole', source: 'lucide', upstream: 'lock-keyhole' },
    { id: 'lucide-fence', source: 'lucide', upstream: 'fence' },
    { id: 'lucide-bell', source: 'lucide', upstream: 'bell' },
    { id: 'lucide-blinds', source: 'lucide', upstream: 'blinds' },
    { id: 'lucide-warehouse', source: 'lucide', upstream: 'warehouse' },
    // Symbols & misc (29)
    { id: 'lucide-infinity', source: 'lucide', upstream: 'infinity' },
    { id: 'lucide-hash', source: 'lucide', upstream: 'hash' },
    { id: 'lucide-at-sign', source: 'lucide', upstream: 'at-sign' },
    { id: 'lucide-plus', source: 'lucide', upstream: 'plus' },
    { id: 'lucide-x', source: 'lucide', upstream: 'x' },
    { id: 'lucide-equal', source: 'lucide', upstream: 'equal' },
    { id: 'lucide-circle-question-mark', source: 'lucide', upstream: 'circle-question-mark' },
    { id: 'lucide-circle-alert', source: 'lucide', upstream: 'circle-alert' },
    { id: 'lucide-info', source: 'lucide', upstream: 'info' },
    { id: 'lucide-lock', source: 'lucide', upstream: 'lock' },
    { id: 'lucide-lock-open', source: 'lucide', upstream: 'lock-open' },
    { id: 'lucide-link', source: 'lucide', upstream: 'link' },
    { id: 'lucide-share-2', source: 'lucide', upstream: 'share-2' },
    { id: 'lucide-wifi', source: 'lucide', upstream: 'wifi' },
    { id: 'lucide-bluetooth', source: 'lucide', upstream: 'bluetooth' },
    { id: 'lucide-battery', source: 'lucide', upstream: 'battery' },
    { id: 'lucide-battery-charging', source: 'lucide', upstream: 'battery-charging' },
    { id: 'lucide-volume-2', source: 'lucide', upstream: 'volume-2' },
    { id: 'lucide-mic', source: 'lucide', upstream: 'mic' },
    { id: 'lucide-video', source: 'lucide', upstream: 'video' },
    { id: 'lucide-phone', source: 'lucide', upstream: 'phone' },
    { id: 'lucide-message-circle', source: 'lucide', upstream: 'message-circle' },
    { id: 'lucide-usb', source: 'lucide', upstream: 'usb' },
    { id: 'lucide-barcode', source: 'lucide', upstream: 'barcode' },
    { id: 'lucide-settings', source: 'lucide', upstream: 'settings' },
    { id: 'twemoji-warning', source: 'twemoji', upstream: '26a0' },
    { id: 'twemoji-no-entry', source: 'twemoji', upstream: '26d4' },
    { id: 'twemoji-radioactive', source: 'twemoji', upstream: '2622' },
    { id: 'twemoji-wheelchair', source: 'twemoji', upstream: '267f' },
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
