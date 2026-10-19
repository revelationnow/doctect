# Device Template Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export chosen template/page combinations as note templates for reMarkable, Supernote, Boox and Bigme models in one zip, and add a "Note templates" gallery category.

**Architecture:** A new `services/deviceExport/` package. `generatePDF` draws only the chosen pages (new `pageNodeIds` option). pdf.js turns each page into a device-sized PNG with fit-and-centre, and separately reads the page's drawing operations back out to build reMarkable Methods `.template` files. JSZip packs everything into per-platform folders with install guides. A new dialog drives it from the desktop export button and the touch ⋯ menu. The gallery category is a rule change in `shared/galleryFacets.js` plus an index version bump.

**Tech Stack:** React 19, TypeScript, jsPDF 3, pdfjs-dist 5.4.624 (pinned), JSZip 3, Vitest (jsdom; node environment for pdf.js tests), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-12-device-template-export-design.md`

## Global Constraints

- Work in `/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/device-template-export` on branch `feat/device-template-export`. Never `cd` to the main checkout.
- Every vitest and playwright run is prefixed with `TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp` (absolute; a relative TMPDIR makes a deploy test run a real `gcloud auth login`).
- E2E runs use `E2E_WEB_PORT=4410 E2E_API_PORT=4411`. After any e2e run, `git checkout -- server/analytics.db` in the worktree. Never commit `server/analytics.db`.
- No new dependencies. Do not change the `pdfjs-dist` version (`5.4.624`).
- Desktop UI changes only where Task 10 says. **Never update desktop snapshots** (`tests/e2e/desktop_layout_guard.spec.js-snapshots/`). If the guard fails because of the new Devices button, stop and report it; the user decides.
- Gallery work is derivation only: never write projects, commits or `published_*` columns.
- Unit tests that call `generatePDF` stub `fetch` to reject, so no font is fetched from the network.
- Exact UI copy:
  - **Entry points:** desktop button "Devices", title "Export templates for e-ink devices"; overflow item "Export for device…".
  - **Dialog:** title "Export for device"; checkboxes "Force greyscale" and "Also include a PDF template".
  - **Count line:** "Pick at least one page and one device." when nothing is picked; "Too many files: pick fewer pages or devices." above the cap; otherwise "`<n>` page(s) × `<d>` device(s) = `<m>` template(s) (.zip)".
  - **Progress:** "Preparing pages…", "Rendering `<done>` / `<total>`", "Packaging…".
  - **Errors:** "Export failed: `<message>`".
- Limits: `MAX_EXPORT_IMAGES = 400`; `.template` skipped above `MAX_METHODS_ITEMS = 20_000` items or `MAX_METHODS_BYTES = 4 * 1024 * 1024` bytes; curve flatten tolerance `0.25` pt.
- Zip name: `<project-slug>_device_templates.zip`. Folder names per spec section 6.
- Analytics event: `device_templates_exported` with `{ pageCount, deviceIds, imageCount, forcedGreyscale, includePdf, failures }`. No titles.
- Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The last commit on the branch regenerates the onboarding bundle (`node onboarding/build.mjs`).

## Review Focus

1. **PDF template option with detached buffers:**
   - pdf.js transfers (detaches) the ArrayBuffer it is given.
   - If the job hands pdf.js the original PDF bytes, the optional PDF lands in the zip empty.
   - Expected: the PDF in the zip is byte-identical to the generated PDF.
   - Pinned in Task 8 (`keeps the PDF bytes intact after pdf.js has read them`).
2. **Page titles with no ASCII:**
   - Examples: `日記`, an emoji-only title, or a title made only of `?`.
   - Expected: a `page-<n>` file name, never an empty name or a lone `.png`.
   - Pinned in Task 2 and Task 7.
3. **Landscape pages:**
   - Example: a template wider than tall, exported for a portrait device.
   - Expected:
     - the PNG is landscape (width and height swapped);
     - the legacy entry has `landscape: true`;
     - the Methods file has `orientation: "landscape"`.
   - Pinned in Tasks 6, 7 and 8 and the desktop e2e.
4. **Stored settings unreadable:**
   - Example: a corrupt or throwing `localStorage` entry, or a remembered device id that no longer exists.
   - Expected: the dialog opens with defaults and unknown ids are dropped.
   - Pinned in Task 4 and Task 9.
5. **Cancel, then export again:**
   - Expected: the first run never downloads, the second run downloads once, and progress from the cancelled run never overwrites the picker.
   - Pinned in Task 9 (`cancel returns to the picker and a second export still works`).

---

## File Structure

| File | Responsibility |
|---|---|
| `shared/galleryFacets.js` (modify) | Add `templates` category first; `INDEX_VERSION` 2 |
| `services/deviceExport/deviceProfiles.ts` | Device table, platform labels, `targetBox`, `fitRect`, `keepsColour` |
| `services/deviceExport/fileNames.ts` | `slugify`, `createNameAllocator` |
| `services/pdfService.ts` (modify) | `pageNodeIds` option on `generatePDF` |
| `services/deviceExport/selection.ts` | Page groups, default ticks, search filter, counts and cap |
| `services/deviceExport/settings.ts` | Remembered devices/greyscale/PDF option |
| `services/browserPreferences.ts` (modify) | New fixed key `doctect-device-export` |
| `services/deviceExport/pdfDrawing.ts` | pdf.js operator list + text content to a neutral `Drawing` |
| `services/deviceExport/remarkableTemplate.ts` | `Drawing` to Methods `.template`/`.metadata`/`.content` |
| `services/deviceExport/bundle.ts` | Zip layout, install guides, README, report, `templates.json` |
| `services/deviceExport/pdfRuntime.ts` | Browser pdf.js wiring: open, render PNG, read drawing |
| `services/deviceExport/exportJob.ts` | Orchestration, progress, cancel, failures |
| `components/export/DeviceExportDialog.tsx` | Picker dialog |
| `components/ProjectEditor.tsx`, `components/editor-layout/OverflowMenu.tsx`, `components/editor-layout/touchActions.ts` (modify) | Entry points and wiring |
| Tests | `tests/unit/galleryFacets.test.ts` (modify), `tests/unit/deviceExport/*.test.ts(x)`, `tests/unit/pdfPageSubset.test.ts`, `tests/unit/touchChrome.test.tsx` (modify), `tests/helpers/touchActions.ts` (modify), `tests/e2e/device_export.spec.js`, `tests/e2e/mobile_editor.spec.js` (modify) |

Test command, used in every task:

```bash
TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run <paths>
```

---

### Task 1: Gallery "Note templates" category

**Files:**
- Modify: `shared/galleryFacets.js:8` (`INDEX_VERSION`), `shared/galleryFacets.js:21-29` (`CATEGORIES`)
- Test: `tests/unit/galleryFacets.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: category key `'templates'`, label `'Note templates'`, emoji `'📄'`; `INDEX_VERSION === 2`.

- [ ] **Step 1: Write the failing tests.** Add `INDEX_VERSION` to the existing import list at the top of `tests/unit/galleryFacets.test.ts`, then add this block after the `categorize` describe:

```ts
describe('Note templates category', () => {
    it('is listed first, so it wins a score tie', () => {
        expect(CATEGORIES[0]).toMatchObject({ key: 'templates', label: 'Note templates', emoji: '📄' });
        expect(categorize([], 'Planner Template')).toBe('templates');
    });

    it('loses to a stronger score', () => {
        expect(categorize([], 'Weekly Planner Template')).toBe('planners');
        expect(categorize(['planner', 'weekly'], 'Planner Template')).toBe('planners');
    });

    it('matches template tags in their common spellings', () => {
        expect(categorize(['Templates'], 'Lined pages')).toBe('templates');
        expect(categorize(['dot-grid', 'paper'], 'Untitled')).toBe('templates');
        expect(categorize(['stationery'], '')).toBe('templates');
    });

    it('rebuilds the derived gallery index', () => {
        expect(INDEX_VERSION).toBe(2);
    });
});
```

- [ ] **Step 2: Run to verify failure.** Run: `TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/unit/galleryFacets.test.ts`. Expected: FAIL. `CATEGORIES[0]` is `planners`, and `INDEX_VERSION` is 1.

- [ ] **Step 3: Implement.** In `shared/galleryFacets.js` set `export const INDEX_VERSION = 2;` and make this the first entry of `CATEGORIES`:

```js
    { key: 'templates', label: 'Note templates', emoji: '📄', keywords: ['template', 'background', 'paper', 'ruled', 'lined', 'dot-grid', 'graph-paper', 'stationery', 'insert'] },
```

- [ ] **Step 4: Run the gallery suites.** Run: `TMPDIR=… npx vitest run tests/unit/galleryFacets.test.ts tests/unit/GalleryDirectory.test.tsx tests/unit/cloudApi.test.ts`. Expected: PASS. The existing "never lists one keyword under two categories" test also passes, because none of the new keywords is used elsewhere and each is already in `normalizeTag` form.

- [ ] **Step 5: Run the server gallery tests.** Run: `TMPDIR=… npx vitest run $(grep -rl "gallery" tests/unit --include=*.test.* | tr '\n' ' ')`. Expected: PASS. If a server test pins the number of categories, update that expected count by one and say so in the report.

- [ ] **Step 6: Commit.**

```bash
git add shared/galleryFacets.js tests/unit/galleryFacets.test.ts
git commit -m "feat(gallery): add a Note templates category

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Device profiles, fit geometry and file names

**Files:**
- Create: `services/deviceExport/deviceProfiles.ts`, `services/deviceExport/fileNames.ts`
- Test: `tests/unit/deviceExport/deviceProfiles.test.ts`, `tests/unit/deviceExport/fileNames.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type DevicePlatform = 'remarkable' | 'supernote' | 'boox' | 'bigme'`
  - `interface DeviceProfile { id; platform; name; folder; width; height; colour; remarkableScreen?; rotateMethods?; source; verified: 'device' | 'docs' }`
  - `DEVICE_PROFILES`, `PLATFORMS`, `PLATFORM_LABELS`, `getProfile(id)`
  - `interface Size { width: number; height: number }`, `isLandscape(page)`, `targetBox(profile, page): Size`
  - `interface FitRect { scale; x; y; width; height }`, `fitRect(page, box): FitRect`
  - `keepsColour(profile, forceGreyscale): boolean`
  - `slugify(raw: string, fallback: string): string`, `MAX_NAME_LENGTH = 80`
  - `createNameAllocator(): (base: string) => string`

- [ ] **Step 1: Write the failing profile tests** in `tests/unit/deviceExport/deviceProfiles.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEVICE_PROFILES, PLATFORMS, fitRect, getProfile, keepsColour, targetBox } from '../../../services/deviceExport/deviceProfiles';

describe('device profiles', () => {
    it('are well formed', () => {
        const ids = DEVICE_PROFILES.map(p => p.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const p of DEVICE_PROFILES) {
            expect(PLATFORMS).toContain(p.platform);
            expect(Number.isInteger(p.width) && p.width > 0, p.id).toBe(true);
            expect(Number.isInteger(p.height) && p.height >= p.width, p.id).toBe(true);
            expect(p.source, p.id).toMatch(/^https:\/\//);
            expect(p.folder, p.id).toMatch(/^[A-Za-z0-9_]+$/);
            if (p.platform === 'remarkable') expect(p.remarkableScreen, p.id).toBeTruthy();
            else expect(p.remarkableScreen, p.id).toBeUndefined();
        }
        const folders = DEVICE_PROFILES.map(p => `${p.platform}/${p.folder}`);
        expect(new Set(folders).size).toBe(folders.length);
    });

    it('pins the sizes the manufacturers document', () => {
        expect(getProfile('rm2')).toMatchObject({ width: 1404, height: 1872, colour: false, remarkableScreen: 'rm2', rotateMethods: true });
        expect(getProfile('rm_pp')).toMatchObject({ width: 1620, height: 2160, colour: true, remarkableScreen: 'rmPP' });
        expect(getProfile('supernote_a5x_a6x_nomad')).toMatchObject({ width: 1404, height: 1872, colour: false });
        expect(getProfile('supernote_manta')).toMatchObject({ width: 1920, height: 2560, colour: false });
        expect(getProfile('nope')).toBeUndefined();
    });

    it('swaps the box for landscape pages', () => {
        const rm2 = getProfile('rm2')!;
        expect(targetBox(rm2, { width: 500, height: 700 })).toEqual({ width: 1404, height: 1872 });
        expect(targetBox(rm2, { width: 700, height: 500 })).toEqual({ width: 1872, height: 1404 });
        expect(targetBox(rm2, { width: 600, height: 600 })).toEqual({ width: 1404, height: 1872 });
    });

    it('fits the page inside the box, centred', () => {
        expect(fitRect({ width: 468, height: 624 }, { width: 1404, height: 1872 })).toEqual({ scale: 3, x: 0, y: 0, width: 1404, height: 1872 });
        // A 3:4 page on a 9:16 screen: width limits, white bands top and bottom.
        const tall = fitRect({ width: 600, height: 800 }, { width: 900, height: 1600 });
        expect(tall).toEqual({ scale: 1.5, x: 0, y: 200, width: 900, height: 1200 });
        // A tall page on a wider box: height limits, bands left and right.
        const wide = fitRect({ width: 300, height: 800 }, { width: 900, height: 1600 });
        expect(wide).toEqual({ scale: 2, x: 150, y: 0, width: 600, height: 1600 });
    });

    it('keeps colour only on colour screens unless greyscale is forced', () => {
        expect(keepsColour(getProfile('rm_pp')!, false)).toBe(true);
        expect(keepsColour(getProfile('rm_pp')!, true)).toBe(false);
        expect(keepsColour(getProfile('rm2')!, false)).toBe(false);
    });
});
```

- [ ] **Step 2: Write the failing name tests** in `tests/unit/deviceExport/fileNames.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MAX_NAME_LENGTH, createNameAllocator, slugify } from '../../../services/deviceExport/fileNames';

describe('slugify', () => {
    it('keeps readable ASCII and drops what devices reject', () => {
        expect(slugify('Jan 1: Plan?', 'x')).toBe('Jan_1_Plan');
        expect(slugify('a\\b/c*d"e<f>g|h', 'x')).toBe('abcdefgh');
        expect(slugify('Café  déjà vu', 'x')).toBe('Cafe_deja_vu');
        expect(slugify('../secret', 'x')).toBe('secret');
    });

    it('falls back when nothing usable is left', () => {
        expect(slugify('日記', 'page-3')).toBe('page-3');
        expect(slugify('🎉🎉', 'page-1')).toBe('page-1');
        expect(slugify('???', 'page-2')).toBe('page-2');
        expect(slugify('   ', 'page-4')).toBe('page-4');
    });

    it('caps the length', () => {
        expect(slugify('a'.repeat(200), 'x')).toHaveLength(MAX_NAME_LENGTH);
    });
});

describe('createNameAllocator', () => {
    it('de-duplicates case-insensitively, never reusing a name', () => {
        const next = createNameAllocator();
        expect(['Day', 'day', 'Day-2', 'Day'].map(next)).toEqual(['Day', 'day-2', 'Day-2-2', 'Day-3']);
    });
});
```

- [ ] **Step 3: Run to verify failure.** Run: `TMPDIR=… npx vitest run tests/unit/deviceExport`. Expected: FAIL (modules not found).

- [ ] **Step 4: Implement `services/deviceExport/fileNames.ts`:**

```ts
// File and folder names inside the device zip. Devices copy these onto FAT/exFAT storage
// (Supernote rejects \ / : * ?), so names are plain printable ASCII with no reserved characters.

const RESERVED = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;
export const MAX_NAME_LENGTH = 80;

/** A device-safe name for `raw`, or `fallback` when nothing usable is left. */
export function slugify(raw: string, fallback: string): string {
    const ascii = String(raw ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    const cleaned = ascii
        .replace(RESERVED, '')
        .replace(/[^\x20-\x7e]/g, '')
        .trim()
        .replace(/\s+/g, '_')
        .slice(0, MAX_NAME_LENGTH)
        .replace(/^[._-]+|[._-]+$/g, '');
    return cleaned || fallback;
}

/** Hands out unique names within one folder; case-insensitive, as the device filesystems are. */
export function createNameAllocator(): (base: string) => string {
    const used = new Set<string>();
    return base => {
        let name = base;
        for (let n = 2; used.has(name.toLowerCase()); n += 1) name = `${base}-${n}`;
        used.add(name.toLowerCase());
        return name;
    };
}
```

- [ ] **Step 5: Implement `services/deviceExport/deviceProfiles.ts`:**

```ts
// The e-ink models the device export targets. Pixel sizes are portrait; a landscape page swaps
// them (targetBox). `verified` records whether a size was checked on hardware or only against
// the source URL. See docs/superpowers/specs/2026-10-12-device-template-export-design.md §2–3.

export type DevicePlatform = 'remarkable' | 'supernote' | 'boox' | 'bigme';

export interface DeviceProfile {
    id: string;
    platform: DevicePlatform;
    name: string;
    /** Folder name inside the zip. */
    folder: string;
    width: number;
    height: number;
    /** Colour screen: exports keep colour unless greyscale is forced. */
    colour: boolean;
    /** Methods `.template` supportedScreens value (reMarkable only). */
    remarkableScreen?: string;
    /** The device draws the Methods canvas rotated 90° (rM2). */
    rotateMethods?: boolean;
    source: string;
    verified: 'device' | 'docs';
}

export const PLATFORMS: readonly DevicePlatform[] = ['remarkable', 'supernote', 'boox', 'bigme'];

export const PLATFORM_LABELS: Record<DevicePlatform, string> = {
    remarkable: 'reMarkable', supernote: 'Supernote', boox: 'Boox', bigme: 'Bigme',
};

const SUPERNOTE_SIZES = 'https://support.supernote.com/en_US/faq/how-to-create-a-custom-note-template';

export const DEVICE_PROFILES: readonly DeviceProfile[] = [
    { id: 'rm2', platform: 'remarkable', name: 'reMarkable 2', folder: 'reMarkable_2', width: 1404, height: 1872, colour: false,
        remarkableScreen: 'rm2', rotateMethods: true, source: 'https://remarkable.jms1.info/templates/', verified: 'docs' },
    { id: 'rm_pp', platform: 'remarkable', name: 'Paper Pro', folder: 'Paper_Pro', width: 1620, height: 2160, colour: true,
        remarkableScreen: 'rmPP', source: 'https://github.com/chrissyhroberts/remarkable_2_and_paper_pro_custom_templates', verified: 'docs' },
    { id: 'rm_pp_move', platform: 'remarkable', name: 'Paper Pro Move', folder: 'Paper_Pro_Move', width: 954, height: 1696, colour: true,
        remarkableScreen: 'rmPPM', source: 'https://remarkable.com/products/remarkable-paper/pro-move', verified: 'docs' },
    { id: 'supernote_a5x_a6x_nomad', platform: 'supernote', name: 'A5 X / A6 X / Nomad (A6 X2)', folder: 'A5X_A6X_Nomad',
        width: 1404, height: 1872, colour: false, source: SUPERNOTE_SIZES, verified: 'docs' },
    { id: 'supernote_manta', platform: 'supernote', name: 'Manta (A5 X2)', folder: 'Manta', width: 1920, height: 2560, colour: false,
        source: SUPERNOTE_SIZES, verified: 'docs' },
    { id: 'boox_note_air3_nova_air', platform: 'boox', name: 'Note Air 3 / Nova Air', folder: 'Note_Air_3_Nova_Air',
        width: 1404, height: 1872, colour: false, source: 'https://shop.boox.com/products/noteair3', verified: 'docs' },
    { id: 'boox_note_air4c_tab_ultra_c_pro', platform: 'boox', name: 'Note Air 4C / Tab Ultra C Pro', folder: 'Note_Air_4C_Tab_Ultra_C_Pro',
        width: 1860, height: 2480, colour: true, source: 'https://shop.boox.com/products/noteair4c', verified: 'docs' },
    { id: 'boox_go_10_3', platform: 'boox', name: 'Go 10.3', folder: 'Go_10_3', width: 1860, height: 2480, colour: false,
        source: 'https://shop.boox.com/products/go103', verified: 'docs' },
    { id: 'boox_go_7', platform: 'boox', name: 'Go 7', folder: 'Go_7', width: 1264, height: 1680, colour: false,
        source: 'https://shop.boox.com/products/go7', verified: 'docs' },
    { id: 'boox_go_color_7', platform: 'boox', name: 'Go Color 7', folder: 'Go_Color_7', width: 1264, height: 1680, colour: true,
        source: 'https://shop.boox.com/products/gocolor7', verified: 'docs' },
    { id: 'boox_note_max', platform: 'boox', name: 'Note Max', folder: 'Note_Max', width: 2400, height: 3200, colour: false,
        source: 'https://shop.boox.com/products/notemax', verified: 'docs' },
    { id: 'boox_palma', platform: 'boox', name: 'Palma', folder: 'Palma', width: 824, height: 1648, colour: false,
        source: 'https://shop.boox.com/products/palma', verified: 'docs' },
    { id: 'bigme_inknote_color', platform: 'bigme', name: 'inkNote Color+ / Color Lite', folder: 'inkNote_Color',
        width: 1860, height: 2480, colour: true, source: 'https://ewritable.net/brands/bigme/tablets/bigme-inknote-color/', verified: 'docs' },
    { id: 'bigme_b751c', platform: 'bigme', name: 'B751c (7.8″)', folder: 'B751c', width: 1404, height: 1872, colour: true,
        source: 'https://ewritable.net/brands/bigme/', verified: 'docs' },
];

export interface Size { width: number; height: number }

export const getProfile = (id: string): DeviceProfile | undefined => DEVICE_PROFILES.find(profile => profile.id === id);

export const isLandscape = (page: Size): boolean => page.width > page.height;

/** The pixel box a page is rendered into: the profile's size, turned to match the page. */
export const targetBox = (profile: DeviceProfile, page: Size): Size => (
    isLandscape(page) ? { width: profile.height, height: profile.width } : { width: profile.width, height: profile.height }
);

export interface FitRect { scale: number; x: number; y: number; width: number; height: number }

/** Scale `page` to fit inside `box` without distortion, centred (white bands on the short sides). */
export function fitRect(page: Size, box: Size): FitRect {
    const scale = Math.min(box.width / page.width, box.height / page.height);
    const width = page.width * scale;
    const height = page.height * scale;
    return { scale, x: (box.width - width) / 2, y: (box.height - height) / 2, width, height };
}

export const keepsColour = (profile: DeviceProfile, forceGreyscale: boolean): boolean => profile.colour && !forceGreyscale;
```

- [ ] **Step 6: Verify the unconfirmed rows (spec section 3, rows marked †).**
  - Rows to check: `rm_pp_move`, every `boox_*` row and every `bigme_*` row.
  - Method: use web search to find the manufacturer's spec page (or the ewritable.net device page when the manufacturer has none) for the screen resolution.
  - If the source shows a different size, update `width`/`height` (portrait order) and `source`.
  - If a product URL in the table above does not exist, replace it with the page you used.
  - List every change, and every row you could not confirm, in your report.
  - Do not change the four rows pinned by the test.

- [ ] **Step 7: Run tests.** Run: `TMPDIR=… npx vitest run tests/unit/deviceExport`. Expected: PASS.

- [ ] **Step 8: Commit.**

```bash
git add services/deviceExport tests/unit/deviceExport
git commit -m "feat(device-export): device profiles, fit geometry and file names

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `generatePDF` draws only chosen pages

**Files:**
- Modify: `services/pdfService.ts:797-802` (`GeneratePDFOptions`), `services/pdfService.ts:824-825` (page list)
- Test: `tests/unit/pdfPageSubset.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `generatePDF(state, { pageNodeIds?: string[] })`. When set, only those pages are drawn, in that order:
  - unknown ids and reference nodes are dropped;
  - duplicates are dropped;
  - internal links resolve within the subset;
  - a link to a page outside the subset gets no annotation, but its element is still drawn.

- [ ] **Step 1: Write the failing test** `tests/unit/pdfPageSubset.test.ts`:

```ts
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generatePDF } from '../../services/pdfService';
import type { AppState } from '../../types';

const layer = { id: 'main', name: 'Main', order: 0, visible: true, locked: false };
const rect = (id: string, fill: string, extra: Record<string, unknown> = {}) => ({
    id, type: 'rect', x: 10, y: 10, w: 50, h: 50, rotation: 0, fill, stroke: '#000000', strokeWidth: 1,
    opacity: 1, layerId: 'main', zIndex: 0, ...extra,
});
const template = (id: string, width: number, height: number, elements: unknown[]) => ({ id, name: id, width, height, layers: [layer], elements });

const state = {
    schemaVersion: 12, rootId: 'root', activeVariantId: 'default',
    nodes: {
        root: { id: 'root', parentId: null, type: 'a', title: 'Root', data: {}, children: ['b', 'c', 'ref'] },
        b: { id: 'b', parentId: 'root', type: 'b', title: 'B', data: {}, children: [] },
        c: { id: 'c', parentId: 'root', type: 'b', title: 'C', data: {}, children: [] },
        ref: { id: 'ref', parentId: 'root', type: 'b', title: 'Ref', data: {}, children: [], referenceId: 'b' },
    },
    variants: { default: { id: 'default', name: 'Default', templates: {
        // The root page links to page c.
        a: template('a', 500, 700, [rect('link', '#ff0000', { linkTarget: 'specific_node', linkValue: 'c' })]),
        b: template('b', 300, 400, [rect('plain', '#0000ff')]),
    } } },
} as unknown as AppState;

const load = async (pageNodeIds?: string[]) => {
    const data = (await generatePDF(state, { output: 'arraybuffer', pageNodeIds })) as ArrayBuffer;
    const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
    return pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
};
const bytes = async (pageNodeIds?: string[]) =>
    new TextDecoder('latin1').decode(new Uint8Array((await generatePDF(state, { output: 'arraybuffer', pageNodeIds })) as ArrayBuffer));
const fills = async (pdf: any, pageNumber: number) => {
    const ops = await (await pdf.getPage(pageNumber)).getOperatorList();
    return ops.argsArray.filter((args: unknown) => Array.isArray(args) && typeof args[0] === 'string' && args[0].startsWith('#')).map((args: string[]) => args[0]);
};

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('generatePDF pageNodeIds', () => {
    it('draws every page without the option', async () => {
        expect((await load()).numPages).toBe(3);
    });

    it('draws only the chosen pages, in the order given', async () => {
        const pdf = await load(['c', 'root']);
        expect(pdf.numPages).toBe(2);
        expect((await pdf.getPage(1)).view).toEqual([0, 0, 300, 400]);
        expect((await pdf.getPage(2)).view).toEqual([0, 0, 500, 700]);
    });

    it('drops unknown ids, references and duplicates', async () => {
        expect((await load(['root', 'nope', 'ref', 'root'])).numPages).toBe(1);
    });

    it('links between chosen pages within the subset', async () => {
        expect(await bytes(['root', 'c'])).toContain('/Dest');
    });

    it('draws a link to a page outside the subset, without a link annotation', async () => {
        expect(await bytes(['root'])).not.toContain('/Dest');
        expect(await fills(await load(['root']), 1)).toContain('#ff0000');
    });
});
```

- [ ] **Step 2: Run to verify failure.** Run: `TMPDIR=… npx vitest run tests/unit/pdfPageSubset.test.ts`. Expected: FAIL. The subset cases produce 3 pages. TypeScript accepts the call only after Step 3; vitest still runs it.

- [ ] **Step 3: Implement.** In `services/pdfService.ts`:
  - Add `pageNodeIds?: string[];` to `interface GeneratePDFOptions`, with this comment above the field: `/** Draw only these pages, in this order (device export). Links resolve within the subset. */`
  - Replace the first line of `generatePDF` (`const pageNodes = computePageOrder(state);`) with:

```ts
    const pageNodes = options.pageNodeIds
        ? [...new Set(options.pageNodeIds)].filter(id => Object.hasOwn(state.nodes, id) && !state.nodes[id].referenceId)
        : computePageOrder(state);
```

  Then confirm, with `grep -n "computePageOrder(" services/pdfService.ts`, that `generatePDF` uses no other page list. If it does, switch that use to `pageNodes` too.

- [ ] **Step 4: Run tests.** Run: `TMPDIR=… npx vitest run tests/unit/pdfPageSubset.test.ts tests/unit/pdfLinks.test.ts tests/unit/thumbnailService.test.ts tests/unit/generateVariantsZip.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add services/pdfService.ts tests/unit/pdfPageSubset.test.ts
git commit -m "feat(pdf): draw only chosen pages with generatePDF pageNodeIds

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Page groups, counts and remembered settings

**Files:**
- Create: `services/deviceExport/selection.ts`, `services/deviceExport/settings.ts`
- Modify: `services/browserPreferences.ts:1-11` (add the key `'doctect-device-export'` to `fixedBrowserPreferenceKeys`)
- Test: `tests/unit/deviceExport/selection.test.ts`, `tests/unit/deviceExport/settings.test.ts`

**Interfaces:**
- Consumes: `computePageOrder` from `services/pdfService.ts`; `getProfile` (Task 2).
- Produces:
  - `MAX_EXPORT_IMAGES = 400`
  - `interface PageChoice { nodeId: string; title: string }`
  - `interface TemplateGroup { templateId: string; name: string; pages: PageChoice[] }`
  - `buildPageGroups(state: AppState): TemplateGroup[]`
  - `defaultSelection(groups): Set<string>`
  - `filterGroups(groups, query: string): TemplateGroup[]`
  - `imageCount(pageCount, deviceCount): number`
  - `exportBlockReason(pageCount, deviceCount): string | null`
  - `interface DeviceExportSettings { devices: string[]; forceGreyscale: boolean; includePdf: boolean }`
  - `readDeviceExportSettings(defaultForceGreyscale: boolean): DeviceExportSettings`
  - `writeDeviceExportSettings(settings): boolean`

- [ ] **Step 1: Write the failing selection test** `tests/unit/deviceExport/selection.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { AppState } from '../../../types';
import { MAX_EXPORT_IMAGES, buildPageGroups, defaultSelection, exportBlockReason, filterGroups, imageCount } from '../../../services/deviceExport/selection';

const node = (id: string, type: string, title: string, children: string[] = [], referenceId?: string) =>
    ({ id, parentId: null, type, title, data: {}, children, ...(referenceId ? { referenceId } : {}) });
const tpl = (id: string, name: string) => ({ id, name, width: 100, height: 100, layers: [], elements: [] });

const state = {
    rootId: 'idx', activeVariantId: 'v1',
    nodes: {
        idx: node('idx', 'index', 'Index', ['d1', 'w1', 'd2', 'ref', 'ghost']),
        d1: node('d1', 'daily', 'Jan 1'), d2: node('d2', 'daily', 'Jan 2'),
        w1: node('w1', 'weekly', '  '),
        ref: node('ref', 'daily', 'Linked', [], 'd1'),
        ghost: node('ghost', 'missing', 'No template'),
    },
    variants: {
        v1: { id: 'v1', name: 'A', templates: { index: tpl('index', 'Month index'), daily: tpl('daily', 'Daily'), weekly: tpl('weekly', '') } },
        v2: { id: 'v2', name: 'B', templates: { daily: tpl('daily', 'Daily B') } },
    },
} as unknown as AppState;

describe('buildPageGroups', () => {
    it('groups pages by template in first-appearance order, skipping references and template-less pages', () => {
        expect(buildPageGroups(state)).toEqual([
            { templateId: 'index', name: 'Month index', pages: [{ nodeId: 'idx', title: 'Index' }] },
            { templateId: 'daily', name: 'Daily', pages: [{ nodeId: 'd1', title: 'Jan 1' }, { nodeId: 'd2', title: 'Jan 2' }] },
            { templateId: 'weekly', name: 'weekly', pages: [{ nodeId: 'w1', title: 'Untitled page' }] },
        ]);
    });

    it('follows the active variant', () => {
        const groups = buildPageGroups({ ...state, activeVariantId: 'v2' } as AppState);
        expect(groups.map(g => g.name)).toEqual(['Daily B']);
    });

    it('ticks the first page of each group by default', () => {
        expect([...defaultSelection(buildPageGroups(state))]).toEqual(['idx', 'd1', 'w1']);
    });

    it('filters pages by title and drops empty groups', () => {
        expect(filterGroups(buildPageGroups(state), ' jan 2 ')).toEqual([
            { templateId: 'daily', name: 'Daily', pages: [{ nodeId: 'd2', title: 'Jan 2' }] },
        ]);
        expect(filterGroups(buildPageGroups(state), '')).toHaveLength(3);
    });
});

describe('counts', () => {
    it('counts images and blocks empty or oversized exports', () => {
        expect(imageCount(3, 4)).toBe(12);
        expect(exportBlockReason(0, 2)).toBe('Pick at least one page and one device.');
        expect(exportBlockReason(2, 0)).toBe('Pick at least one page and one device.');
        expect(exportBlockReason(MAX_EXPORT_IMAGES, 1)).toBeNull();
        expect(exportBlockReason(MAX_EXPORT_IMAGES + 1, 1)).toBe('Too many files: pick fewer pages or devices.');
    });
});
```

- [ ] **Step 2: Write the failing settings test** `tests/unit/deviceExport/settings.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readDeviceExportSettings, writeDeviceExportSettings } from '../../../services/deviceExport/settings';

const KEY = 'doctect-device-export';
afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe('device export settings', () => {
    it('defaults when nothing is stored', () => {
        expect(readDeviceExportSettings(true)).toEqual({ devices: [], forceGreyscale: true, includePdf: false });
    });

    it('round-trips and drops device ids that no longer exist', () => {
        expect(writeDeviceExportSettings({ devices: ['rm2', 'gone'], forceGreyscale: false, includePdf: true })).toBe(true);
        expect(readDeviceExportSettings(true)).toEqual({ devices: ['rm2'], forceGreyscale: false, includePdf: true });
    });

    it('survives corrupt JSON and a throwing storage', () => {
        localStorage.setItem(KEY, '{not json');
        expect(readDeviceExportSettings(false)).toEqual({ devices: [], forceGreyscale: false, includePdf: false });
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
        expect(readDeviceExportSettings(false)).toEqual({ devices: [], forceGreyscale: false, includePdf: false });
    });
});
```

- [ ] **Step 3: Run to verify failure.** Run: `TMPDIR=… npx vitest run tests/unit/deviceExport/selection.test.ts tests/unit/deviceExport/settings.test.ts`. Expected: FAIL (modules not found).

- [ ] **Step 4: Implement `services/deviceExport/selection.ts`:**

```ts
import type { AppState } from '../../types';
import { computePageOrder } from '../pdfService';

/** Images per export (pages × devices). Above this a phone browser runs out of memory building the zip. */
export const MAX_EXPORT_IMAGES = 400;

export interface PageChoice { nodeId: string; title: string }
export interface TemplateGroup { templateId: string; name: string; pages: PageChoice[] }

/**
 * The picker's rows: the active variant's pages grouped by template, groups in order of first
 * appearance, pages in page order. References and pages whose template is missing are not pages
 * the PDF can draw, so they are left out.
 */
export function buildPageGroups(state: AppState): TemplateGroup[] {
    const templates = state.variants?.[state.activeVariantId]?.templates ?? {};
    const groups = new Map<string, TemplateGroup>();
    for (const nodeId of computePageOrder(state)) {
        const node = state.nodes[nodeId];
        if (!node || !Object.hasOwn(templates, node.type)) continue;
        let group = groups.get(node.type);
        if (!group) {
            group = { templateId: node.type, name: templates[node.type].name?.trim() || node.type, pages: [] };
            groups.set(node.type, group);
        }
        group.pages.push({ nodeId, title: node.title?.trim() || 'Untitled page' });
    }
    return [...groups.values()];
}

/** One representative page per template. */
export const defaultSelection = (groups: TemplateGroup[]): Set<string> =>
    new Set(groups.flatMap(group => group.pages.slice(0, 1).map(page => page.nodeId)));

export function filterGroups(groups: TemplateGroup[], query: string): TemplateGroup[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return groups;
    return groups
        .map(group => ({ ...group, pages: group.pages.filter(page => page.title.toLowerCase().includes(needle)) }))
        .filter(group => group.pages.length > 0);
}

export const imageCount = (pageCount: number, deviceCount: number): number => pageCount * deviceCount;

/** Why Export is disabled, or null when it is allowed. */
export function exportBlockReason(pageCount: number, deviceCount: number): string | null {
    if (pageCount === 0 || deviceCount === 0) return 'Pick at least one page and one device.';
    if (imageCount(pageCount, deviceCount) > MAX_EXPORT_IMAGES) return 'Too many files: pick fewer pages or devices.';
    return null;
}
```

- [ ] **Step 5: Implement `services/deviceExport/settings.ts`** and add `'doctect-device-export',` to the end of `fixedBrowserPreferenceKeys` in `services/browserPreferences.ts`:

```ts
import { readBrowserPreference, writeBrowserPreference } from '../browserPreferences';
import { getProfile } from './deviceProfiles';

export interface DeviceExportSettings { devices: string[]; forceGreyscale: boolean; includePdf: boolean }

const KEY = 'doctect-device-export';

/** The picker's remembered choices in this browser; anything unreadable falls back to defaults. */
export function readDeviceExportSettings(defaultForceGreyscale: boolean): DeviceExportSettings {
    const fallback: DeviceExportSettings = { devices: [], forceGreyscale: defaultForceGreyscale, includePdf: false };
    const raw = readBrowserPreference(KEY);
    if (!raw) return fallback;
    try {
        const value = JSON.parse(raw) as Partial<Record<keyof DeviceExportSettings, unknown>>;
        return {
            devices: Array.isArray(value?.devices)
                ? value.devices.filter((id): id is string => typeof id === 'string' && getProfile(id) !== undefined)
                : [],
            forceGreyscale: typeof value?.forceGreyscale === 'boolean' ? value.forceGreyscale : defaultForceGreyscale,
            includePdf: value?.includePdf === true,
        };
    } catch {
        return fallback;
    }
}

export const writeDeviceExportSettings = (settings: DeviceExportSettings): boolean =>
    writeBrowserPreference(KEY, JSON.stringify(settings));
```

- [ ] **Step 6: Run tests.** Run: `TMPDIR=… npx vitest run tests/unit/deviceExport $(ls tests/unit | grep -i browserPreference | sed 's#^#tests/unit/#')`. Expected: PASS. If a test pins the list of preference keys, add the new key to it.

- [ ] **Step 7: Commit.**

```bash
git add services/deviceExport services/browserPreferences.ts tests/unit/deviceExport
git commit -m "feat(device-export): page groups, export counts and remembered settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Read a PDF page's drawing back out (pdf.js to `Drawing`)

**Files:**
- Create: `services/deviceExport/pdfDrawing.ts`
- Test: `tests/unit/deviceExport/pdfDrawing.test.ts` (node environment)

**Interfaces:**
- Consumes: pdf.js `OPS` codes (passed in; values below are pdfjs-dist 5.4.624).
- Produces:

```ts
export type Point = [number, number];
export interface SubPath { points: Point[]; closed: boolean }
export interface FillItem { kind: 'fill'; subpaths: SubPath[]; grey: string; evenOdd: boolean }
export interface StrokeItem { kind: 'stroke'; subpaths: SubPath[]; width: number; grey: string }
export interface TextItem { kind: 'text'; text: string; x: number; baseline: number; size: number; bold: boolean }
export type DrawingItem = FillItem | StrokeItem | TextItem;
export type DrawingNote = 'image' | 'clip' | 'shading' | 'pattern' | 'light-stroke' | 'device-font' | 'italic' | 'rotated-text';
export interface Drawing { width: number; height: number; items: DrawingItem[]; notes: DrawingNote[] }
export interface OperatorListLike { fnArray: ArrayLike<number>; argsArray: ArrayLike<unknown> }
export interface TextItemLike { str: string; transform: number[]; fontName: string }
export interface PdfPageLike { view: number[]; getOperatorList(): Promise<OperatorListLike>; getTextContent(): Promise<{ items: unknown[] }>; commonObjs: { get(id: string): unknown } }
export const FLATTEN_TOLERANCE = 0.25;
export function greyHex(hex: string, alpha: number): string;
export function extractDrawing(input: { ops: OperatorListLike; text: TextItemLike[]; view: number[]; OPS: Record<string, number>; fontNameOf(id: string): string | undefined }): Drawing;
export function readPdfPageDrawing(page: PdfPageLike, OPS: Record<string, number>): Promise<Drawing>;
```

All coordinates in a `Drawing` are page points with the origin at the top-left. Curves are already flattened and dashes already split.

What pdf.js 5.4.624 delivers (confirmed by a probe on 2026-10-12):
- `constructPath` args are `[paintOp, [pathData], minMax]`. `pathData` is a Float32Array of DrawOPS codes: `0` moveTo x y, `1` lineTo x y, `2` curveTo x1 y1 x2 y2 x y, `3` quadraticCurveTo x1 y1 x y, `4` closePath.
- `paintOp` is one of `OPS.stroke`, `fill`, `eoFill`, `fillStroke`, `eoFillStroke`, `closeStroke`, `closeFillStroke`, `closeEOFillStroke`, `endPath`.
- Colours arrive as `setFillRGBColor ['#rrggbb']` and `setStrokeRGBColor ['#rrggbb']`.
- `setGState` args are `[[[key, value], …]]`.
- Coordinates are in PDF user space, with the origin bottom-left.
- Text content items carry `transform [a,b,c,d,e,f]` in page space. `commonObjs.get(fontName).name` is the PostScript name, for example `Helvetica-Bold`.

- [ ] **Step 1: Write the failing tests** `tests/unit/deviceExport/pdfDrawing.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { jsPDF } from 'jspdf';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { FLATTEN_TOLERANCE, extractDrawing, greyHex, readPdfPageDrawing, type Drawing, type FillItem, type StrokeItem, type TextItemLike } from '../../../services/deviceExport/pdfDrawing';

const OPS = pdfjs.OPS as Record<string, number>;
const VIEW = [0, 0, 200, 300];
const list = (...ops: [number, unknown][]) => ({ fnArray: ops.map(op => op[0]), argsArray: ops.map(op => op[1]) });
const path = (paint: number, data: number[]): [number, unknown] => [OPS.constructPath, [paint, [Float32Array.from(data)], null]];
const draw = (ops: [number, unknown][], text: TextItemLike[] = [], fonts: Record<string, string> = {}): Drawing =>
    extractDrawing({ ops: list(...ops), text, view: VIEW, OPS, fontNameOf: id => fonts[id] });

describe('greyHex', () => {
    it('converts to grey and blends alpha with white', () => {
        expect(greyHex('#000000', 1)).toBe('#000000');
        expect(greyHex('#000000', 0.5)).toBe('#808080');
        expect(greyHex('#ffffff', 1)).toBe('#ffffff');
        expect(greyHex('#ff0000', 1)).toBe('#363636');
    });
});

describe('extractDrawing', () => {
    it('turns a filled rectangle into a closed sub-path in top-left page space', () => {
        const { items } = draw([[OPS.setFillRGBColor, ['#808080']], path(OPS.fill, [0, 10, 290, 1, 60, 290, 1, 60, 250, 1, 10, 250, 4])]);
        expect(items).toEqual([{ kind: 'fill', grey: '#808080', evenOdd: false,
            subpaths: [{ closed: true, points: [[10, 10], [60, 10], [60, 50], [10, 50]] }] }]);
    });

    it('applies fill alpha from the graphics state and keeps even-odd fills', () => {
        const { items } = draw([
            [OPS.setFillRGBColor, ['#000000']], [OPS.setGState, [[['ca', 0.5]]]],
            path(OPS.eoFill, [0, 0, 300, 1, 10, 300, 1, 10, 290, 4]),
        ]);
        expect(items[0]).toMatchObject({ kind: 'fill', grey: '#808080', evenOdd: true });
    });

    it('scales stroke width by the transform and restores state', () => {
        const { items } = draw([
            [OPS.save, null], [OPS.transform, [2, 0, 0, 2, 0, 0]], [OPS.setLineWidth, [1.5]],
            path(OPS.stroke, [0, 0, 100, 1, 10, 100]), [OPS.restore, null],
            path(OPS.stroke, [0, 0, 100, 1, 10, 100]),
        ]);
        const [scaled, plain] = items as StrokeItem[];
        expect(scaled.width).toBe(3);
        expect(scaled.subpaths[0].points).toEqual([[0, 100], [20, 100]]);
        expect(plain.width).toBe(1);
        expect(plain.subpaths[0].points).toEqual([[0, 200], [10, 200]]);
    });

    it('flattens curves within tolerance', () => {
        const { items } = draw([path(OPS.stroke, [0, 0, 300, 2, 0, 200, 100, 200, 100, 300])]);
        const points = (items[0] as StrokeItem).subpaths[0].points;
        expect(points.length).toBeGreaterThan(4);
        expect(points[0]).toEqual([0, 0]);
        expect(points[points.length - 1]).toEqual([100, 0]);
        // Every chord midpoint stays near the true curve (page space: y = 300 - pdf y).
        const curve = (t: number): [number, number] => {
            const u = 1 - t;
            return [3 * u * t * t * 100 + t * t * t * 100, 300 - (u * u * u * 300 + 3 * u * u * t * 200 + 3 * u * t * t * 200 + t * t * t * 300)];
        };
        const dense = Array.from({ length: 2001 }, (_, i) => curve(i / 2000));
        for (let i = 1; i < points.length; i++) {
            const mid = [(points[i - 1][0] + points[i][0]) / 2, (points[i - 1][1] + points[i][1]) / 2];
            const nearest = Math.min(...dense.map(p => Math.hypot(p[0] - mid[0], p[1] - mid[1])));
            expect(nearest).toBeLessThanOrEqual(FLATTEN_TOLERANCE + 0.05);
        }
    });

    it('splits dashed strokes into separate segments', () => {
        const { items } = draw([[OPS.setDash, [[10, 5], 0]], path(OPS.stroke, [0, 0, 100, 1, 100, 100])]);
        const pieces = (items[0] as StrokeItem).subpaths;
        expect(pieces).toHaveLength(7);
        expect(pieces[0]).toEqual({ closed: false, points: [[0, 200], [10, 200]] });
        expect(pieces[6]).toEqual({ closed: false, points: [[90, 200], [100, 200]] });
    });

    it('emits fill and stroke for fill-and-stroke paths', () => {
        const { items } = draw([path(OPS.closeFillStroke, [0, 0, 300, 1, 10, 300, 1, 10, 290])]);
        expect(items.map(item => item.kind)).toEqual(['fill', 'stroke']);
        expect((items[1] as StrokeItem).subpaths[0].closed).toBe(true);
    });

    it('notes what it cannot represent', () => {
        const { items, notes } = draw([
            [OPS.paintImageXObject, ['img1', 10, 10]], [OPS.clip, null], [OPS.shadingFill, ['sh']],
            [OPS.setFillColorN, ['Pattern']], path(OPS.fill, [0, 0, 300, 1, 10, 300, 1, 10, 290, 4]),
            [OPS.setStrokeRGBColor, ['#eeeeee']], path(OPS.stroke, [0, 0, 300, 1, 10, 300]),
        ]);
        expect(items.map(item => item.kind)).toEqual(['stroke']);
        expect(new Set(notes)).toEqual(new Set(['image', 'clip', 'shading', 'pattern', 'light-stroke']));
    });

    it('ignores empty paths and endPath', () => {
        expect(draw([[OPS.constructPath, [OPS.fill, [null], null]], path(OPS.endPath, [0, 0, 0, 1, 1, 1])]).items).toEqual([]);
    });

    it('reads text runs with bold, italic and rotation notes', () => {
        const { items, notes } = draw([], [
            { str: 'Hello', transform: [14, 0, 0, 14, 20, 150], fontName: 'f1' },
            { str: '   ', transform: [14, 0, 0, 14, 20, 120], fontName: 'f1' },
            { str: 'Slant', transform: [10, 0, 0, 10, 5, 100], fontName: 'f2' },
            { str: 'Up', transform: [0, 10, -10, 0, 50, 50], fontName: 'f2' },
        ], { f1: 'Helvetica-Bold', f2: 'NimbusSans-Italic' });
        expect(items[0]).toEqual({ kind: 'text', text: 'Hello', x: 20, baseline: 150, size: 14, bold: true });
        expect(items[1]).toMatchObject({ text: 'Slant', bold: false });
        expect(items).toHaveLength(3);
        expect(new Set(notes)).toEqual(new Set(['device-font', 'italic', 'rotated-text']));
    });
});

describe('readPdfPageDrawing (real jsPDF + pdf.js)', () => {
    it('reads fills, dashed strokes, curves and bold text from a jsPDF page', async () => {
        const doc = new jsPDF({ unit: 'pt', format: [200, 300] });
        doc.setFillColor(128, 128, 128); doc.rect(10, 10, 50, 40, 'F');
        doc.setLineWidth(2); doc.setLineDashPattern([3, 2], 0); doc.line(10, 100, 150, 100);
        doc.setLineDashPattern([], 0); doc.ellipse(100, 200, 30, 20, 'S');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text('Hello', 20, 150);
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(doc.output('arraybuffer')) }).promise;
        const drawing = await readPdfPageDrawing(await pdf.getPage(1) as never, OPS);
        expect(drawing).toMatchObject({ width: 200, height: 300 });
        const fill = drawing.items.find((item): item is FillItem => item.kind === 'fill')!;
        expect(fill.grey).toBe('#808080');
        expect(fill.subpaths[0].points).toEqual([[10, 10], [60, 10], [60, 50], [10, 50]]);
        const strokes = drawing.items.filter((item): item is StrokeItem => item.kind === 'stroke');
        expect(strokes[0].subpaths.length).toBeGreaterThan(20);
        expect(strokes[1].subpaths[0].points.length).toBeGreaterThan(8);
        expect(drawing.items.find(item => item.kind === 'text')).toEqual({ kind: 'text', text: 'Hello', x: 20, baseline: 150, size: 14, bold: true });
    });
});
```

- [ ] **Step 2: Run to verify failure.** Run: `TMPDIR=… npx vitest run tests/unit/deviceExport/pdfDrawing.test.ts`. Expected: FAIL (module not found). If `import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'` has no types, add `// @ts-expect-error legacy build has no bundled types` above that import. Vitest ignores type errors, but `tsc` later does not.

- [ ] **Step 3: Implement `services/deviceExport/pdfDrawing.ts`:**

```ts
// Reads one PDF page's vector drawing back out of pdf.js, for the reMarkable Methods converter.
// The PDF is the single source of layout (grids, bindings, wrapping, patterns, SVG artwork), so
// nothing here re-implements the editor's rendering. Output is page points, origin top-left, with
// curves flattened and dashes split: the Methods format draws only straight lines.

export type Point = [number, number];
export interface SubPath { points: Point[]; closed: boolean }
export interface FillItem { kind: 'fill'; subpaths: SubPath[]; grey: string; evenOdd: boolean }
export interface StrokeItem { kind: 'stroke'; subpaths: SubPath[]; width: number; grey: string }
export interface TextItem { kind: 'text'; text: string; x: number; baseline: number; size: number; bold: boolean }
export type DrawingItem = FillItem | StrokeItem | TextItem;
export type DrawingNote = 'image' | 'clip' | 'shading' | 'pattern' | 'light-stroke' | 'device-font' | 'italic' | 'rotated-text';
export interface Drawing { width: number; height: number; items: DrawingItem[]; notes: DrawingNote[] }

export interface OperatorListLike { fnArray: ArrayLike<number>; argsArray: ArrayLike<unknown> }
export interface TextItemLike { str: string; transform: number[]; fontName: string }
export interface PdfPageLike {
    view: number[];
    getOperatorList(): Promise<OperatorListLike>;
    getTextContent(): Promise<{ items: unknown[] }>;
    commonObjs: { get(id: string): unknown };
}

/** Maximum distance (pt) between a curve and its flattened polyline. */
export const FLATTEN_TOLERANCE = 0.25;
/** Hairline (width 0) strokes are drawn at this width. */
const HAIRLINE = 0.5;
const MAX_CURVE_STEPS = 100;

type Matrix = [number, number, number, number, number, number];
const apply = (m: Matrix, x: number, y: number): Point => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
/** `m` applied first, then `t` (PDF's CTM' = M × CTM). */
const concat = (m: Matrix, t: Matrix): Matrix => [
    m[0] * t[0] + m[1] * t[2], m[0] * t[1] + m[1] * t[3],
    m[2] * t[0] + m[3] * t[2], m[2] * t[1] + m[3] * t[3],
    m[4] * t[0] + m[5] * t[2] + t[4], m[4] * t[1] + m[5] * t[3] + t[5],
];
const scaleOf = (m: Matrix): number => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
const isMatrix = (value: unknown): value is Matrix => Array.isArray(value) && value.length === 6 && value.every(n => typeof n === 'number');

/** A grey `#rrggbb` of the colour's luminance, alpha-blended onto white. */
export function greyHex(hex: string, alpha: number): string {
    const match = /^#?([0-9a-f]{6})$/i.exec(hex);
    const value = match ? parseInt(match[1], 16) : 0;
    const luminance = 0.2126 * ((value >> 16) & 255) + 0.7152 * ((value >> 8) & 255) + 0.0722 * (value & 255);
    const a = Math.min(1, Math.max(0, Number.isFinite(alpha) ? alpha : 1));
    const channel = Math.round(255 - a * (255 - luminance)).toString(16).padStart(2, '0');
    return `#${channel}${channel}${channel}`;
}

const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const secondDiff = (a: Point, b: Point, c: Point): number => Math.hypot(a[0] - 2 * b[0] + c[0], a[1] - 2 * b[1] + c[1]);

function cubic(p0: Point, p1: Point, p2: Point, p3: Point): Point[] {
    const spread = Math.max(secondDiff(p0, p1, p2), secondDiff(p1, p2, p3));
    const steps = Math.min(MAX_CURVE_STEPS, Math.max(1, Math.ceil(Math.sqrt((0.75 * spread) / FLATTEN_TOLERANCE))));
    const out: Point[] = [];
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const a = lerp(p0, p1, t), b = lerp(p1, p2, t), c = lerp(p2, p3, t);
        out.push(lerp(lerp(a, b, t), lerp(b, c, t), t));
    }
    return out;
}

function quadratic(p0: Point, p1: Point, p2: Point): Point[] {
    const steps = Math.min(MAX_CURVE_STEPS, Math.max(1, Math.ceil(Math.sqrt((0.25 * secondDiff(p0, p1, p2)) / FLATTEN_TOLERANCE))));
    const out: Point[] = [];
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        out.push(lerp(lerp(p0, p1, t), lerp(p1, p2, t), t));
    }
    return out;
}

/** DrawOPS path data (pdf.js 5.x) to page-space sub-paths. */
function toSubpaths(data: ArrayLike<number>, m: Matrix): SubPath[] {
    const out: SubPath[] = [];
    let current: SubPath | null = null;
    const at = (): Point => current?.points[current.points.length - 1] ?? [0, 0];
    for (let i = 0; i < data.length;) {
        switch (data[i++]) {
            case 0: current = { points: [apply(m, data[i++], data[i++])], closed: false }; out.push(current); break;
            case 1: current ??= (out.push({ points: [at()], closed: false }), out[out.length - 1]); current.points.push(apply(m, data[i++], data[i++])); break;
            case 2: { const from = at(); const c1 = apply(m, data[i++], data[i++]); const c2 = apply(m, data[i++], data[i++]); const to = apply(m, data[i++], data[i++]);
                current ??= (out.push({ points: [from], closed: false }), out[out.length - 1]); current.points.push(...cubic(from, c1, c2, to)); break; }
            case 3: { const from = at(); const c1 = apply(m, data[i++], data[i++]); const to = apply(m, data[i++], data[i++]);
                current ??= (out.push({ points: [from], closed: false }), out[out.length - 1]); current.points.push(...quadratic(from, c1, to)); break; }
            case 4: if (current) { current.closed = true; current = { points: [current.points[0]], closed: false }; out.push(current); } break;
            default: return out.filter(sp => sp.points.length >= 2);
        }
    }
    return out.filter(sp => sp.points.length >= 2);
}

/** Splits one sub-path by a dash pattern (lengths already in page points). */
function dashSubpath(subpath: SubPath, dash: number[], phase: number): SubPath[] {
    const pattern = dash.filter(n => Number.isFinite(n) && n >= 0);
    const total = pattern.reduce((sum, n) => sum + n, 0);
    if (pattern.length === 0 || total <= 0) return [subpath];
    const points = subpath.closed ? [...subpath.points, subpath.points[0]] : subpath.points;
    const pieces: SubPath[] = [];
    let index = 0;
    let left = pattern[0];
    let on = true;
    for (let skip = ((phase % total) + total) % total; skip > 0;) {
        if (skip < left) { left -= skip; break; }
        skip -= left; index = (index + 1) % pattern.length; left = pattern[index]; on = !on;
    }
    let piece: Point[] | null = on ? [points[0]] : null;
    for (let i = 1; i < points.length; i++) {
        let from = points[i - 1];
        const to = points[i];
        let length = Math.hypot(to[0] - from[0], to[1] - from[1]);
        while (length > 0) {
            if (length < left) { left -= length; if (piece) piece.push(to); break; }
            const cut = lerp(from, to, left / length);
            length -= left; from = cut;
            if (piece) { piece.push(cut); pieces.push({ points: piece, closed: false }); piece = null; }
            else piece = [cut];
            on = !on; index = (index + 1) % pattern.length; left = pattern[index];
            if (left === 0 && on) { piece = null; on = false; index = (index + 1) % pattern.length; left = pattern[index]; }
        }
    }
    if (piece && piece.length >= 2) pieces.push({ points: piece, closed: false });
    return pieces;
}

interface GraphicsState { ctm: Matrix; fill: string | null; fillAlpha: number; stroke: string; strokeAlpha: number; lineWidth: number; dash: number[]; dashPhase: number }

export function extractDrawing({ ops, text, view, OPS, fontNameOf }: {
    ops: OperatorListLike; text: TextItemLike[]; view: number[]; OPS: Record<string, number>; fontNameOf(id: string): string | undefined;
}): Drawing {
    const [x0, , x1, y1] = view;
    const width = view[2] - view[0];
    const height = view[3] - view[1];
    let gs: GraphicsState = { ctm: [1, 0, 0, -1, -x0, y1], fill: '#000000', fillAlpha: 1, stroke: '#000000', strokeAlpha: 1, lineWidth: 1, dash: [], dashPhase: 0 };
    const stack: GraphicsState[] = [];
    const items: DrawingItem[] = [];
    const notes = new Set<DrawingNote>();
    const push = () => stack.push({ ...gs, dash: [...gs.dash] });
    const pop = () => { gs = stack.pop() ?? gs; };
    const imageOps = new Set(['paintImageXObject', 'paintInlineImageXObject', 'paintInlineImageXObjectGroup', 'paintImageMaskXObject',
        'paintImageMaskXObjectGroup', 'paintImageXObjectRepeat', 'paintImageMaskXObjectRepeat', 'paintSolidColorImageMask'].map(name => OPS[name]));
    const fillOps = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
    const strokeOps = new Set([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
    const closingOps = new Set([OPS.closeStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
    const evenOddOps = new Set([OPS.eoFill, OPS.eoFillStroke, OPS.closeEOFillStroke]);

    const paint = (args: unknown[] | null) => {
        const op = args?.[0] as number;
        const data = (args?.[1] as unknown[] | undefined)?.[0] as ArrayLike<number> | null | undefined;
        if (!data || op === OPS.endPath) return;
        const subpaths = toSubpaths(data, gs.ctm);
        if (subpaths.length === 0) return;
        if (fillOps.has(op) && gs.fill && gs.fillAlpha > 0) {
            items.push({ kind: 'fill', subpaths: subpaths.map(sp => ({ points: sp.points, closed: true })), grey: greyHex(gs.fill, gs.fillAlpha), evenOdd: evenOddOps.has(op) });
        }
        if (strokeOps.has(op) && gs.strokeAlpha > 0) {
            const grey = greyHex(gs.stroke, gs.strokeAlpha);
            if (parseInt(grey.slice(1, 3), 16) > 128) notes.add('light-stroke');
            const scale = scaleOf(gs.ctm);
            const close = closingOps.has(op);
            const pieces = subpaths.flatMap(sp => dashSubpath({ points: sp.points, closed: sp.closed || close }, gs.dash.map(n => n * scale), gs.dashPhase * scale));
            if (pieces.length) items.push({ kind: 'stroke', subpaths: pieces, width: gs.lineWidth > 0 ? gs.lineWidth * scale : HAIRLINE, grey });
        }
    };

    for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i];
        const args = (ops.argsArray[i] ?? null) as unknown[] | null;
        if (imageOps.has(fn)) { notes.add('image'); continue; }
        switch (fn) {
            case OPS.save: push(); break;
            case OPS.restore: pop(); break;
            case OPS.transform: if (isMatrix(args)) gs.ctm = concat(args, gs.ctm); break;
            case OPS.paintFormXObjectBegin: push(); if (isMatrix(args?.[0])) gs.ctm = concat(args[0] as Matrix, gs.ctm); break;
            case OPS.paintFormXObjectEnd: pop(); break;
            case OPS.beginGroup: { push(); const matrix = (args?.[0] as { matrix?: unknown } | undefined)?.matrix; if (isMatrix(matrix)) gs.ctm = concat(matrix, gs.ctm); break; }
            case OPS.endGroup: pop(); break;
            case OPS.setLineWidth: gs.lineWidth = Number(args?.[0]) || 0; break;
            case OPS.setDash: gs.dash = Array.isArray(args?.[0]) ? (args[0] as unknown[]).map(Number) : []; gs.dashPhase = Number(args?.[1]) || 0; break;
            case OPS.setGState:
                for (const entry of (Array.isArray(args?.[0]) ? args[0] : []) as [string, unknown][]) {
                    const [key, value] = entry;
                    if (key === 'LW') gs.lineWidth = Number(value) || 0;
                    else if (key === 'CA') gs.strokeAlpha = Number(value);
                    else if (key === 'ca') gs.fillAlpha = Number(value);
                    else if (key === 'D' && Array.isArray(value)) { gs.dash = Array.isArray(value[0]) ? value[0].map(Number) : []; gs.dashPhase = Number(value[1]) || 0; }
                }
                break;
            case OPS.setFillRGBColor: if (typeof args?.[0] === 'string') gs.fill = args[0]; break;
            case OPS.setStrokeRGBColor: if (typeof args?.[0] === 'string') gs.stroke = args[0]; break;
            case OPS.setFillTransparent: gs.fill = null; break;
            case OPS.setFillColorN: notes.add('pattern'); gs.fill = null; break;
            case OPS.clip: case OPS.eoClip: notes.add('clip'); break;
            case OPS.shadingFill: notes.add('shading'); break;
            case OPS.constructPath: paint(args); break;
            default: break;
        }
    }

    for (const run of text) {
        const str = run.str.replace(/\s+/g, ' ').trim();
        const [, b, c, d, e, f] = run.transform;
        const size = Math.hypot(c, d);
        if (!str || !(size > 0)) continue;
        if (Math.abs(b) > 1e-3 || Math.abs(c) > 1e-3) notes.add('rotated-text');
        const font = fontNameOf(run.fontName) ?? '';
        if (/italic|oblique/i.test(font)) notes.add('italic');
        notes.add('device-font');
        items.push({ kind: 'text', text: str, x: e - x0, baseline: y1 - f, size, bold: /bold|black|heavy|semibold|demi/i.test(font) });
    }

    return { width, height, items, notes: [...notes] };
}

export async function readPdfPageDrawing(page: PdfPageLike, OPS: Record<string, number>): Promise<Drawing> {
    const ops = await page.getOperatorList();
    const content = await page.getTextContent();
    const text = content.items.filter((item): item is TextItemLike =>
        typeof (item as TextItemLike)?.str === 'string' && Array.isArray((item as TextItemLike).transform));
    return extractDrawing({
        ops, text, view: page.view, OPS,
        fontNameOf: id => {
            try { return (page.commonObjs.get(id) as { name?: string } | undefined)?.name; } catch { return undefined; }
        },
    });
}
```

- [ ] **Step 4: Run tests.** Run: `TMPDIR=… npx vitest run tests/unit/deviceExport/pdfDrawing.test.ts`. Expected: PASS.
  - If the dashed-line case fails by one segment, check the dash walker against the test's arithmetic (100 pt line, 10 on / 5 off: segments start at 0, 15, …, 90, so 7 pieces). Fix the walker, not the test.
  - If the jsPDF integration test finds the dashed line split into a different count, `> 20` still holds for a 140 pt line with a 3/2 pattern: 28 pieces.

- [ ] **Step 5: Commit.**

```bash
git add services/deviceExport/pdfDrawing.ts tests/unit/deviceExport/pdfDrawing.test.ts
git commit -m "feat(device-export): read a PDF page's vector drawing through pdf.js

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Build reMarkable Methods `.template` files

**Files:**
- Create: `services/deviceExport/remarkableTemplate.ts`
- Test: `tests/unit/deviceExport/remarkableTemplate.test.ts`

**Interfaces:**
- Consumes: `Drawing`, `DrawingItem`, `DrawingNote`, `Point`, `SubPath` (Task 5); `DeviceProfile`, `targetBox`, `getProfile` (Task 2).
- Produces:

```ts
export const REMARKABLE_CANVAS_WIDTH = 1404;
export const TEXT_TOP_FROM_BASELINE = 0.8;
export const MAX_METHODS_ITEMS = 20_000;
export const MAX_METHODS_BYTES = 4 * 1024 * 1024;
export const NOTE_TEXT: Record<DrawingNote, string>;
export interface MethodsFiles { stem: string; template: string; metadata: string; content: string }
export interface MethodsResult { files: MethodsFiles | null; notes: string[]; itemCount: number }
export interface MethodsOptions { profile: DeviceProfile; pageTitle: string; projectName: string; projectSlug: string; pageSlug: string; now: number }
export function rotateForCanvas(point: Point, page: { width: number; height: number }): Point;
export function mergeItems(items: DrawingItem[]): DrawingItem[];
export function fnv1a8(text: string): string;
export function buildMethodsTemplate(drawing: Drawing, options: MethodsOptions): MethodsResult;
```

- [ ] **Step 1: Write the failing tests** `tests/unit/deviceExport/remarkableTemplate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getProfile } from '../../../services/deviceExport/deviceProfiles';
import type { Drawing, DrawingItem } from '../../../services/deviceExport/pdfDrawing';
import { MAX_METHODS_ITEMS, buildMethodsTemplate, fnv1a8, mergeItems, rotateForCanvas } from '../../../services/deviceExport/remarkableTemplate';

const rmPP = getProfile('rm_pp')!;
const rm2 = getProfile('rm2')!;
const square = (x: number, y: number, size = 10) => ({ closed: true, points: [[x, y], [x + size, y], [x + size, y + size], [x, y + size]] as [number, number][] });
const fill = (x: number, y: number, grey = '#808080'): DrawingItem => ({ kind: 'fill', grey, evenOdd: false, subpaths: [square(x, y)] });
const stroke = (y: number, width = 1): DrawingItem => ({ kind: 'stroke', grey: '#000000', width, subpaths: [{ closed: false, points: [[0, y], [100, y]] }] });
const drawing = (items: DrawingItem[], width = 500, height = 700, notes: Drawing['notes'] = []): Drawing => ({ width, height, items, notes });
const options = (profile = rmPP) => ({ profile, pageTitle: 'Jan 1', projectName: 'Planner', projectSlug: 'Planner', pageSlug: 'Jan_1', now: 1760000000000 });
const parse = (result: ReturnType<typeof buildMethodsTemplate>) => JSON.parse(result.files!.template);
const strings = (value: unknown): string[] => Array.isArray(value) ? value.flatMap(strings)
    : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : typeof value === 'string' ? [value] : [];

describe('buildMethodsTemplate', () => {
    it('writes the three files with the fields the device requires', () => {
        const result = buildMethodsTemplate(drawing([fill(10, 10)]), options());
        const template = parse(result);
        expect(template).toMatchObject({ name: 'Jan 1', formatVersion: 1, categories: ['Custom'], labels: ['Planner'],
            orientation: 'portrait', supportedScreens: ['rmPP'] });
        expect(JSON.parse(result.files!.metadata)).toMatchObject({ type: 'TemplateType', visibleName: 'Jan 1', parent: '', pinned: false,
            createdTime: '1760000000000', lastModified: '1760000000000' });
        expect(result.files!.content).toBe('{}');
        expect(result.files!.stem).toMatch(/^doctect-planner-jan_1-rm_pp-[0-9a-f]{8}$/);
    });

    it('draws only M/L/Z with positions as expressions over the fit constants', () => {
        const template = parse(buildMethodsTemplate(drawing([fill(10, 10), stroke(50)]), options()));
        const data = template.items.flatMap((item: { data: unknown[] }) => item.data);
        for (const token of data) {
            expect(typeof token).toBe('string');
            if ((token as string).length === 1) expect(['M', 'L', 'Z']).toContain(token);
            else expect(token).toMatch(/^-?\d+(\.\d+)? \* s \+ o[xy]$/);
        }
        expect(template.items[0]).toMatchObject({ id: 'i1', type: 'path', fillColor: '#808080' });
        expect(template.items[1]).toMatchObject({ id: 'i2', type: 'path' });
    });

    it('fits on the limiting axis and centres', () => {
        // 500x700 on the Paper Pro (1620x2160): height limits.
        expect(parse(buildMethodsTemplate(drawing([fill(0, 0)], 500, 700), options())).constants).toEqual([
            { s: 'templateHeight / 700' }, { ox: '(templateWidth - 500 * s) / 2' }, { oy: '(templateHeight - 700 * s) / 2' },
        ]);
        // 600x700: width limits.
        expect(parse(buildMethodsTemplate(drawing([fill(0, 0)], 600, 700), options())).constants[0]).toEqual({ s: 'templateWidth / 600' });
    });

    it('marks landscape pages and fits them against the turned box', () => {
        const template = parse(buildMethodsTemplate(drawing([fill(0, 0)], 700, 500), options()));
        expect(template.orientation).toBe('landscape');
        expect(template.constants[0]).toEqual({ s: 'templateWidth / 700' });
    });

    it('scales stroke width and font size to the logical canvas, and places text by its top', () => {
        // 468x624 on the rM2 (1404x1872): fit scale 3, canvas factor 1404/1404.
        const template = parse(buildMethodsTemplate(drawing([
            stroke(50, 0.2), stroke(60, 2),
            { kind: 'text', text: 'Hi', x: 10, baseline: 40, size: 10, bold: true },
        ], 468, 624), options(rm2)));
        expect(template.items.map((item: { strokeWidth?: number }) => item.strokeWidth)).toEqual([1, 6, undefined]);
        expect(template.items[2]).toMatchObject({ type: 'text', text: 'Hi', fontSize: 30, bold: true });
        // rM2 is rotated: the text top (10, 32) maps to (32, 468 - 10).
        expect(template.items[2].position).toEqual({ x: '32 * s + ox', y: '458 * s + oy' });
    });

    it('pre-rotates every point for rotated canvases', () => {
        expect(rotateForCanvas([10, 20], { width: 100, height: 200 })).toEqual([20, 90]);
        const template = parse(buildMethodsTemplate(drawing([stroke(20)], 100, 200), options(rm2)));
        expect(template.items[0].data.slice(0, 3)).toEqual(['M', '20 * s + ox', '100 * s + oy']);
    });

    it('reports what was simplified, in words', () => {
        const result = buildMethodsTemplate(drawing([fill(0, 0)], 500, 700, ['image', 'device-font']), options());
        expect(result.notes).toEqual(['images were left out (the format cannot draw images)', "text is drawn in the tablet's own font"]);
    });

    it('skips pages that are too large and says only the PNG is included', () => {
        const items = Array.from({ length: MAX_METHODS_ITEMS + 1 }, (_, i) => fill(i % 400, Math.floor(i / 400) * 12, i % 2 ? '#000000' : '#808080'));
        const result = buildMethodsTemplate(drawing(items, 5000, 7000), options());
        expect(result.files).toBeNull();
        expect(result.notes.at(-1)).toMatch(/only the PNG is included/);
    });

    it('changes the stem when the drawing changes', () => {
        const a = buildMethodsTemplate(drawing([fill(10, 10)]), options()).files!.stem;
        const b = buildMethodsTemplate(drawing([fill(11, 10)]), options()).files!.stem;
        expect(a).not.toBe(b);
        expect(fnv1a8('abc')).toBe('1a47e90b');
    });

    it('embeds a 150x200 SVG icon', () => {
        const icon = atob(parse(buildMethodsTemplate(drawing([fill(10, 10)]), options())).iconData);
        expect(icon).toMatch(/^<svg [^>]*width="150" height="200"/);
        const tokens = strings(parse(buildMethodsTemplate(drawing([fill(10, 10)]), options())).items);
        expect(tokens).not.toContain('C');
        expect(tokens).not.toContain('A');
    });
});

describe('mergeItems', () => {
    it('merges consecutive strokes of one width and keeps others apart', () => {
        const merged = mergeItems([stroke(10), stroke(20), stroke(30, 2), { kind: 'text', text: 't', x: 0, baseline: 0, size: 5, bold: false }, stroke(40)]);
        expect(merged.map(item => item.kind === 'text' ? 'text' : `${item.kind}:${item.subpaths.length}`)).toEqual(['stroke:2', 'stroke:1', 'text', 'stroke:1']);
    });

    it('merges same-grey fills only when they do not overlap', () => {
        expect(mergeItems([fill(0, 0), fill(20, 0)])).toHaveLength(1);
        expect(mergeItems([fill(0, 0), fill(5, 5)])).toHaveLength(2);
        expect(mergeItems([fill(0, 0), fill(20, 0, '#000000')])).toHaveLength(2);
    });

    it('does not mutate its input', () => {
        const input = [stroke(10), stroke(20)];
        mergeItems(input);
        expect((input[0] as { subpaths: unknown[] }).subpaths).toHaveLength(1);
    });
});
```

The rM2 text case, worked through: text top y = 40 − 0.8 × 10 = 32, so the point is (10, 32). `rotateForCanvas` gives (32, 468 − 10) = (32, 458). Font size = 10 × fit 3 × 1404/1404 = 30. Stroke widths are 0.2 × 3 = 0.6, raised to the minimum of 1, and 2 × 3 = 6.

- [ ] **Step 2: Run to verify failure.** Run: `TMPDIR=… npx vitest run tests/unit/deviceExport/remarkableTemplate.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `services/deviceExport/remarkableTemplate.ts`:**

```ts
// reMarkable "Methods" templates (.template + .metadata + .content), reverse-engineered by the
// community (spacepanda.se/articles/rm_methods.html; Martes-Delta-Co/Remarkable-Mobile-Prototyping-
// Templates docs/methods-format-notes.md). Paths may only use M/L/Z (curves blank the template),
// strokes always render dark, positions are device pixels and may be expressions over the device's
// templateWidth/templateHeight. Values marked "device checklist" are confirmed on hardware (spec §9).

import { targetBox, type DeviceProfile } from './deviceProfiles';
import type { Drawing, DrawingItem, DrawingNote, Point, SubPath } from './pdfDrawing';

/** Logical canvas width that strokeWidth and fontSize are scaled to (device checklist item 4). */
export const REMARKABLE_CANVAS_WIDTH = 1404;
/** A text item's position is the top of its line: baseline − this × size (device checklist item 4). */
export const TEXT_TOP_FROM_BASELINE = 0.8;
export const MAX_METHODS_ITEMS = 20_000;
export const MAX_METHODS_BYTES = 4 * 1024 * 1024;
const MAX_MERGED_SUBPATHS = 500;
const ICON_BUDGET = 100_000;

export const NOTE_TEXT: Record<DrawingNote, string> = {
    image: 'images were left out (the format cannot draw images)',
    clip: 'clipping was ignored, so some shapes may extend past their frames',
    shading: 'gradient shading was left out',
    pattern: 'pattern fills were left out',
    'light-stroke': 'light-coloured lines are drawn dark (line colour cannot be set)',
    'device-font': "text is drawn in the tablet's own font",
    italic: 'italic text is drawn upright',
    'rotated-text': 'rotated text is drawn horizontally',
};

export interface MethodsFiles { stem: string; template: string; metadata: string; content: string }
export interface MethodsResult { files: MethodsFiles | null; notes: string[]; itemCount: number }
export interface MethodsOptions { profile: DeviceProfile; pageTitle: string; projectName: string; projectSlug: string; pageSlug: string; now: number }

const round = (n: number): number => Math.round(n * 100) / 100;

/**
 * The rM2 draws the Methods canvas turned 90° from the Paper Pro, so its points are pre-turned
 * (x, y) → (y, W − x); the device's own rotation brings the page upright. If a device shows the
 * page upside down, this is the one line to change (device checklist item 2).
 */
export const rotateForCanvas = ([x, y]: Point, page: { width: number; height: number }): Point => [y, page.width - x];

/** FNV-1a 32-bit as 8 hex digits: a content hash that needs no secure context. */
export function fnv1a8(text: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

type Bounds = [number, number, number, number];
const boundsOf = (subpaths: SubPath[]): Bounds => {
    const b: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
    for (const sp of subpaths) for (const [x, y] of sp.points) { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); }
    return b;
};
const overlaps = (a: Bounds, b: Bounds): boolean => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/**
 * Joins consecutive items of one style into one item with several sub-paths, which keeps grids and
 * dot patterns from becoming thousands of items. Fills merge only when they do not overlap: the
 * device fills even-odd, so two overlapping shapes in one path would punch a hole.
 */
export function mergeItems(items: DrawingItem[]): DrawingItem[] {
    const out: DrawingItem[] = [];
    let boxes: Bounds[] = [];
    for (const item of items) {
        const last = out[out.length - 1];
        if (item.kind !== 'text' && last && last.kind === item.kind && last.subpaths.length + item.subpaths.length <= MAX_MERGED_SUBPATHS) {
            if (item.kind === 'stroke' && last.kind === 'stroke' && round(last.width) === round(item.width)) {
                last.subpaths = [...last.subpaths, ...item.subpaths];
                continue;
            }
            if (item.kind === 'fill' && last.kind === 'fill' && last.grey === item.grey && last.evenOdd === item.evenOdd) {
                const box = boundsOf(item.subpaths);
                if (!boxes.some(other => overlaps(other, box))) {
                    last.subpaths = [...last.subpaths, ...item.subpaths];
                    boxes.push(box);
                    continue;
                }
            }
        }
        const copy: DrawingItem = item.kind === 'text' ? { ...item } : { ...item, subpaths: [...item.subpaths] };
        out.push(copy);
        boxes = copy.kind === 'fill' ? [boundsOf(copy.subpaths)] : [];
    }
    return out;
}

const base64Utf8 = (text: string): string => {
    let binary = '';
    for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
    return btoa(binary);
};

const escapeXml = (text: string): string => text.replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[ch]!);

/** The picker thumbnail: a 150x200 SVG of the page's shapes (curves are fine here). */
function iconSvg(drawing: Drawing): string {
    const w = round(drawing.width), h = round(drawing.height);
    const parts: string[] = [];
    let size = 0;
    for (const item of drawing.items) {
        if (item.kind === 'text') continue;
        const d = item.subpaths.map(sp => `M${sp.points.map(([x, y]) => `${round(x)} ${round(y)}`).join('L')}${sp.closed ? 'Z' : ''}`).join('');
        const element = item.kind === 'fill'
            ? `<path d="${d}" fill="${item.grey}" fill-rule="${item.evenOdd ? 'evenodd' : 'nonzero'}"/>`
            : `<path d="${d}" fill="none" stroke="#000" stroke-width="${round(item.width)}"/>`;
        size += element.length;
        if (size > ICON_BUDGET) break;
        parts.push(element);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="200" viewBox="0 0 ${w} ${h}">`
        + `<rect width="${w}" height="${h}" fill="#fff" stroke="#000"/>${parts.join('')}</svg>`;
}

export function buildMethodsTemplate(drawing: Drawing, options: MethodsOptions): MethodsResult {
    const page = { width: drawing.width, height: drawing.height };
    const box = targetBox(options.profile, page);
    const fit = Math.min(box.width / page.width, box.height / page.height);
    const byWidth = box.width / page.width <= box.height / page.height;
    const sizeScale = fit * (REMARKABLE_CANVAS_WIDTH / options.profile.width);
    const notes = drawing.notes.map(note => NOTE_TEXT[note]);
    const rotate = options.profile.rotateMethods === true;
    const at = (point: Point): [string, string] => {
        const [x, y] = rotate ? rotateForCanvas(point, page) : point;
        return [`${round(x)} * s + ox`, `${round(y)} * s + oy`];
    };
    const pathData = (subpaths: SubPath[]): string[] => subpaths.flatMap(sp => [
        ...sp.points.flatMap((point, i) => [i === 0 ? 'M' : 'L', ...at(point)]),
        ...(sp.closed ? ['Z'] : []),
    ]);

    const merged = mergeItems(drawing.items);
    if (merged.length > MAX_METHODS_ITEMS) {
        return { files: null, itemCount: merged.length, notes: [...notes, `too many shapes (${merged.length}) for a .template; only the PNG is included`] };
    }
    const items = merged.map((item, index) => {
        const id = `i${index + 1}`;
        if (item.kind === 'text') {
            const [x, y] = at([item.x, item.baseline - item.size * TEXT_TOP_FROM_BASELINE]);
            return { id, type: 'text', text: item.text, fontSize: round(item.size * sizeScale), position: { x, y }, ...(item.bold ? { bold: true } : {}) };
        }
        if (item.kind === 'fill') return { id, type: 'path', fillColor: item.grey, data: pathData(item.subpaths) };
        return { id, type: 'path', strokeWidth: Math.max(1, round(item.width * sizeScale)), data: pathData(item.subpaths) };
    });
    const template = {
        name: options.pageTitle,
        author: 'Doctect',
        iconData: base64Utf8(iconSvg(drawing)),
        templateVersion: '1.0.0',
        formatVersion: 1,
        categories: ['Custom'],
        labels: [options.projectName || 'Doctect'],
        orientation: page.width > page.height ? 'landscape' : 'portrait',
        supportedScreens: [options.profile.remarkableScreen],
        constants: [
            { s: byWidth ? `templateWidth / ${round(page.width)}` : `templateHeight / ${round(page.height)}` },
            { ox: `(templateWidth - ${round(page.width)} * s) / 2` },
            { oy: `(templateHeight - ${round(page.height)} * s) / 2` },
        ],
        items,
    };
    const json = JSON.stringify(template);
    if (json.length > MAX_METHODS_BYTES) {
        return { files: null, itemCount: items.length, notes: [...notes, `the .template would be larger than 4 MB; only the PNG is included`] };
    }
    const stamp = String(options.now);
    return {
        itemCount: items.length,
        notes,
        files: {
            stem: `doctect-${options.projectSlug}-${options.pageSlug}-${options.profile.id}-${fnv1a8(json)}`.toLowerCase(),
            template: json,
            metadata: JSON.stringify({ createdTime: stamp, lastModified: stamp, parent: '', pinned: false, type: 'TemplateType',
                visibleName: options.pageTitle, source: 'doctect', new: true }, null, 2),
            content: '{}',
        },
    };
}
```

`escapeXml` is not used by the icon, because the icon has no text. Delete it if `tsc` or lint flags it as unused.

- [ ] **Step 4: Run tests.** Run: `TMPDIR=… npx vitest run tests/unit/deviceExport/remarkableTemplate.test.ts`. Expected: PASS. If `fnv1a8('abc')` differs from `'1a47e90b'`, check the implementation against the FNV-1a 32-bit reference (offset basis `0x811c9dc5`, prime `0x01000193`). The reference value of FNV-1a("abc") is `0x1a47e90b`.

- [ ] **Step 5: Commit.**

```bash
git add services/deviceExport/remarkableTemplate.ts tests/unit/deviceExport/remarkableTemplate.test.ts
git commit -m "feat(device-export): build reMarkable Methods .template files

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Zip layout, install guides and report

**Files:**
- Create: `services/deviceExport/bundle.ts`
- Test: `tests/unit/deviceExport/bundle.test.ts`

**Interfaces:**
- Consumes: `DeviceProfile`, `PLATFORM_LABELS`, `getProfile` (Task 2); `slugify`, `createNameAllocator` (Task 2); `MethodsFiles` (Task 6).
- Produces:

```ts
export const LEGACY_ICON_CODE = '\ue9fe';
export interface DeviceZip {
    readonly fileName: string;
    addPng(profile: DeviceProfile, pageTitle: string, png: Blob, landscape: boolean): void;
    addMethods(profile: DeviceProfile, files: MethodsFiles): void;
    addPdf(profile: DeviceProfile, pdf: ArrayBuffer): void;
    report(line: string): void;
    finish(): Promise<Blob>;
}
export function createDeviceZip(projectName: string): DeviceZip;
```

- [ ] **Step 1: Write the failing tests** `tests/unit/deviceExport/bundle.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { getProfile } from '../../../services/deviceExport/deviceProfiles';
import { LEGACY_ICON_CODE, createDeviceZip } from '../../../services/deviceExport/bundle';

const rm2 = getProfile('rm2')!;
const manta = getProfile('supernote_manta')!;
const air = getProfile('boox_note_air4c_tab_ultra_c_pro')!;
const bigme = getProfile('bigme_inknote_color')!;
const png = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
const open = async (blob: Blob) => JSZip.loadAsync(await blob.arrayBuffer());
const methods = { stem: 'doctect-x-guard-rm2-00000000', template: '{"formatVersion":1}', metadata: '{}', content: '{}' };

describe('createDeviceZip', () => {
    it('lays files out per platform and model', async () => {
        const zip = createDeviceZip('Device Export');
        expect(zip.fileName).toBe('Device_Export_device_templates.zip');
        zip.addPng(rm2, 'Guard Page', png(), false);
        zip.addMethods(rm2, methods);
        zip.addPng(manta, 'Guard Page', png(), false);
        zip.addPdf(manta, new Uint8Array([1, 2, 3]).buffer);
        zip.addPng(air, 'Cover', png(), true);
        zip.addPng(bigme, 'Cover', png(), true);
        const files = Object.keys((await open(await zip.finish())).files).filter(name => !name.endsWith('/')).sort();
        expect(files).toEqual([
            'Bigme/inkNote_Color/INSTALL.txt',
            'Bigme/inkNote_Color/noteTemplate/Cover.png',
            'Boox/Note_Air_4C_Tab_Ultra_C_Pro/INSTALL.txt',
            'Boox/Note_Air_4C_Tab_Ultra_C_Pro/noteTemplate/Cover.png',
            'README.txt',
            'Supernote/Manta/INSTALL.txt',
            'Supernote/Manta/MyStyle/Device_Export/Device_Export.pdf',
            'Supernote/Manta/MyStyle/Device_Export/Guard_Page.png',
            'reMarkable/reMarkable_2/INSTALL.txt',
            'reMarkable/reMarkable_2/methods/doctect-x-guard-rm2-00000000.content',
            'reMarkable/reMarkable_2/methods/doctect-x-guard-rm2-00000000.metadata',
            'reMarkable/reMarkable_2/methods/doctect-x-guard-rm2-00000000.template',
            'reMarkable/reMarkable_2/png/Guard_Page.png',
            'reMarkable/reMarkable_2/png/templates.json',
        ]);
    });

    it('writes a templates.json fragment with landscape flags', async () => {
        const zip = createDeviceZip('P');
        zip.addPng(rm2, 'Guard Page', png(), false);
        zip.addPng(rm2, 'Cover', png(), true);
        const json = JSON.parse(await (await open(await zip.finish())).file('reMarkable/reMarkable_2/png/templates.json')!.async('string'));
        expect(json).toEqual({ templates: [
            { name: 'Guard Page', filename: 'Guard_Page', iconCode: LEGACY_ICON_CODE, categories: ['Custom'] },
            { name: 'Cover', filename: 'Cover', iconCode: LEGACY_ICON_CODE, categories: ['Custom'], landscape: true },
        ] });
    });

    it('names duplicate and non-Latin titles safely, per folder', async () => {
        const zip = createDeviceZip('P');
        zip.addPng(manta, 'Day', png(), false);
        zip.addPng(manta, 'Day', png(), false);
        zip.addPng(manta, '日記', png(), false);
        zip.addPng(air, 'Day', png(), false);
        const names = Object.keys((await open(await zip.finish())).files).filter(name => name.endsWith('.png')).sort();
        expect(names).toEqual([
            'Boox/Note_Air_4C_Tab_Ultra_C_Pro/noteTemplate/Day.png',
            'Supernote/Manta/MyStyle/P/Day-2.png',
            'Supernote/Manta/MyStyle/P/Day.png',
            'Supernote/Manta/MyStyle/P/page-3.png',
        ]);
    });

    it('adds a conversion report only when there is something to report', async () => {
        const quiet = createDeviceZip('P');
        quiet.addPng(manta, 'Day', png(), false);
        expect((await open(await quiet.finish())).file('CONVERSION-REPORT.txt')).toBeNull();
        const noisy = createDeviceZip('P');
        noisy.addPng(manta, 'Day', png(), false);
        noisy.report('Day (reMarkable 2, .template): images were left out');
        expect(await (await open(await noisy.finish())).file('CONVERSION-REPORT.txt')!.async('string')).toContain('images were left out');
    });

    it('writes install guides that name each device folder', async () => {
        const zip = createDeviceZip('P');
        zip.addPng(rm2, 'A', png(), false);
        zip.addPng(manta, 'A', png(), false);
        zip.addPng(air, 'A', png(), false);
        zip.addPng(bigme, 'A', png(), false);
        const out = await open(await zip.finish());
        const read = (path: string) => out.file(path)!.async('string');
        const rm = await read('reMarkable/reMarkable_2/INSTALL.txt');
        expect(rm).toContain('/home/root/.local/share/remarkable/xochitl/');
        expect(rm).toContain('/usr/share/remarkable/templates/');
        expect(rm).toContain('templates.json');
        expect(await read('Supernote/Manta/INSTALL.txt')).toContain('Note/MyStyle');
        expect(await read('Boox/Note_Air_4C_Tab_Ultra_C_Pro/INSTALL.txt')).toContain('Storage/noteTemplate');
        expect(await read('Bigme/inkNote_Color/INSTALL.txt')).toContain('Storage/noteTemplate');
        expect(await read('README.txt')).toContain('Supernote/Manta');
    });
});
```

- [ ] **Step 2: Run to verify failure.** Run: `TMPDIR=… npx vitest run tests/unit/deviceExport/bundle.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `services/deviceExport/bundle.ts`:**

```ts
import JSZip from 'jszip';
import { PLATFORM_LABELS, type DeviceProfile } from './deviceProfiles';
import { createNameAllocator, slugify } from './fileNames';
import type { MethodsFiles } from './remarkableTemplate';

/** Icon of the stock "Blank" template in templates.json (device checklist item 1). */
export const LEGACY_ICON_CODE = '\ue9fe';

export interface DeviceZip {
    readonly fileName: string;
    addPng(profile: DeviceProfile, pageTitle: string, png: Blob, landscape: boolean): void;
    addMethods(profile: DeviceProfile, files: MethodsFiles): void;
    addPdf(profile: DeviceProfile, pdf: ArrayBuffer): void;
    report(line: string): void;
    finish(): Promise<Blob>;
}

interface LegacyEntry { name: string; filename: string; iconCode: string; categories: string[]; landscape?: true }
interface ModelFolder { profile: DeviceProfile; root: string; nextName: (base: string) => string; pngCount: number; legacy: LegacyEntry[]; hasPdf: boolean }

function installGuide(folder: ModelFolder, projectSlug: string): string {
    const { profile } = folder;
    if (profile.platform === 'remarkable') {
        return [
            `reMarkable: ${profile.name}`,
            '',
            'reMarkable has no official way to add templates. Both routes below need SSH access',
            '(Settings > Help > About > Copyrights and licenses shows the password; the USB address is',
            '10.11.99.1) or a tool such as RCU (https://www.davisr.me/projects/rcu/).',
            '',
            'Option A: Methods templates (survive software updates; reMarkable 2 needs software 3.17+)',
            '1. Copy every file in methods/ to /home/root/.local/share/remarkable/xochitl/',
            '     scp methods/* root@10.11.99.1:/home/root/.local/share/remarkable/xochitl/',
            '2. Restart the interface:  ssh root@10.11.99.1 systemctl restart xochitl',
            '   Methods templates are line drawings: see CONVERSION-REPORT.txt for anything simplified.',
            '',
            'Option B: PNG templates (exact look; every software update removes them)',
            '1. Paper Pro and Paper Pro Move only: ssh root@10.11.99.1 mount -o remount,rw /',
            '2. scp png/*.png root@10.11.99.1:/usr/share/remarkable/templates/',
            '3. Add the entries in png/templates.json to the "templates" list of',
            '   /usr/share/remarkable/templates/templates.json on the tablet.',
            '4. ssh root@10.11.99.1 systemctl restart xochitl',
            '',
        ].join('\n');
    }
    if (profile.platform === 'supernote') {
        return [
            `Supernote: ${profile.name}`,
            '',
            '1. Connect the Supernote by USB, or use Supernote Partner or Supernote Cloud.',
            `2. Copy the folder MyStyle/${projectSlug}/ into Note/MyStyle/ on the device.`,
            '3. In a note, open Templates > Customization and pick a page.',
            ...(folder.hasPdf ? [
                '',
                `The PDF template (${projectSlug}.pdf) is picked the same way. Links between its pages work`,
                'when the linked pages are also applied as template pages. A PDF cannot be the default',
                'template for new notes.',
            ] : []),
            '',
        ].join('\n');
    }
    return [
        `${PLATFORM_LABELS[profile.platform]}: ${profile.name}`,
        '',
        '1. Connect the device by USB (or use the maker\'s transfer app).',
        '2. Copy the files in noteTemplate/ into Storage/noteTemplate/ on the device.',
        '3. In a note, open the template picker and choose a page from the local templates.',
        ...(folder.hasPdf && profile.platform === 'boox' ? ['', 'PDF templates work on the device but do not sync through BOOX cloud.'] : []),
        '',
    ].join('\n');
}

function readme(projectName: string, folders: ModelFolder[]): string {
    return [
        `Note templates exported from Doctect: ${projectName}`,
        '',
        'Each folder holds the templates for one device model, with an INSTALL.txt:',
        ...folders.map(folder => `  ${folder.root}/  (${folder.profile.width} x ${folder.profile.height} px)`),
        '',
    ].join('\n');
}

export function createDeviceZip(projectName: string): DeviceZip {
    const zip = new JSZip();
    const projectSlug = slugify(projectName, 'project');
    const folders = new Map<string, ModelFolder>();
    const reportLines: string[] = [];

    const folderFor = (profile: DeviceProfile): ModelFolder => {
        let folder = folders.get(profile.id);
        if (!folder) {
            folder = { profile, root: `${PLATFORM_LABELS[profile.platform]}/${profile.folder}`, nextName: createNameAllocator(), pngCount: 0, legacy: [], hasPdf: false };
            folders.set(profile.id, folder);
        }
        return folder;
    };
    const templateDir = (folder: ModelFolder): string => {
        switch (folder.profile.platform) {
            case 'remarkable': return `${folder.root}/png`;
            case 'supernote': return `${folder.root}/MyStyle/${projectSlug}`;
            default: return `${folder.root}/noteTemplate`;
        }
    };

    return {
        fileName: `${projectSlug}_device_templates.zip`,
        addPng(profile, pageTitle, png, landscape) {
            const folder = folderFor(profile);
            folder.pngCount += 1;
            const name = folder.nextName(slugify(pageTitle, `page-${folder.pngCount}`));
            zip.file(`${templateDir(folder)}/${name}.png`, png, { compression: 'STORE' });
            if (profile.platform === 'remarkable') {
                folder.legacy.push({ name: pageTitle, filename: name, iconCode: LEGACY_ICON_CODE, categories: ['Custom'], ...(landscape ? { landscape: true as const } : {}) });
            }
        },
        addMethods(profile, files) {
            const dir = `${folderFor(profile).root}/methods`;
            zip.file(`${dir}/${files.stem}.template`, files.template);
            zip.file(`${dir}/${files.stem}.metadata`, files.metadata);
            zip.file(`${dir}/${files.stem}.content`, files.content);
        },
        addPdf(profile, pdf) {
            const folder = folderFor(profile);
            folder.hasPdf = true;
            zip.file(`${templateDir(folder)}/${projectSlug}.pdf`, pdf, { compression: 'STORE' });
        },
        report(line) { reportLines.push(line); },
        async finish() {
            for (const folder of folders.values()) {
                if (folder.legacy.length > 0) zip.file(`${folder.root}/png/templates.json`, JSON.stringify({ templates: folder.legacy }, null, 2));
                zip.file(`${folder.root}/INSTALL.txt`, installGuide(folder, projectSlug));
            }
            zip.file('README.txt', readme(projectName, [...folders.values()]));
            if (reportLines.length > 0) {
                zip.file('CONVERSION-REPORT.txt', ['Some pages were simplified or skipped:', '', ...reportLines.map(line => `- ${line}`), ''].join('\n'));
            }
            return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        },
    };
}
```

- [ ] **Step 4: Run tests.** Run: `TMPDIR=… npx vitest run tests/unit/deviceExport/bundle.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add services/deviceExport/bundle.ts tests/unit/deviceExport/bundle.test.ts
git commit -m "feat(device-export): zip layout with install guides and conversion report

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Export job and pdf.js runtime

**Files:**
- Create: `services/deviceExport/exportJob.ts`, `services/deviceExport/pdfRuntime.ts`
- Test: `tests/unit/deviceExport/exportJob.test.ts`

**Interfaces:**
- Consumes:
  - `generatePDF` (with `pageNodeIds`) and `computePageOrder` from `services/pdfService.ts`;
  - `getProfile`, `keepsColour`, `targetBox`, `fitRect` (Task 2); `slugify` (Task 2);
  - `buildMethodsTemplate` (Task 6); `createDeviceZip` (Task 7);
  - `readPdfPageDrawing`, `Drawing` (Task 5).
- Produces:

```ts
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
}
export function runDeviceExport(request: DeviceExportRequest, options?: { signal?: AbortSignal; onProgress?: (progress: DeviceExportProgress) => void; deps?: ExportDeps; now?: () => number }): Promise<DeviceExportResult>;
```

- `pdfRuntime.ts` exports `openPdf`, `renderPng` and `readDrawing`, used by the default deps. It is browser-only (canvas plus the pdf.js worker), so it is not unit-tested; the e2e tests in Task 11 cover it.

- [ ] **Step 1: Write the failing tests** `tests/unit/deviceExport/exportJob.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure.** Run: `TMPDIR=… npx vitest run tests/unit/deviceExport/exportJob.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `services/deviceExport/pdfRuntime.ts`:**

```ts
// Browser-only pdf.js wiring for the device export (worker set up as in thumbnailService.ts).
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { fitRect, type Size } from './deviceProfiles';
import { readPdfPageDrawing, type Drawing } from './pdfDrawing';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

type Page = pdfjsLib.PDFPageProxy;

/** Opens PDF bytes. pdf.js takes ownership of (detaches) the buffer it is given: pass a copy. */
export async function openPdf(data: ArrayBuffer): Promise<{ getPage(pageNumber: number): Promise<Page>; destroy(): Promise<void> }> {
    const task = pdfjsLib.getDocument({ data: new Uint8Array(data) });
    const doc = await task.promise;
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

export const readDrawing = (page: Page): Promise<Drawing> =>
    readPdfPageDrawing(page as unknown as Parameters<typeof readPdfPageDrawing>[0], pdfjsLib.OPS as unknown as Record<string, number>);
```

- [ ] **Step 4: Implement `services/deviceExport/exportJob.ts`:**

```ts
import type { AppState } from '../../types';
import { computePageOrder, generatePDF } from '../pdfService';
import { createDeviceZip } from './bundle';
import { getProfile, keepsColour, targetBox, type DeviceProfile } from './deviceProfiles';
import { slugify } from './fileNames';
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
        let done = 0;
        let images = 0;
        let failures = 0;
        let firstError: unknown = null;
        for (let index = 0; index < pages.length; index++) {
            const title = request.state.nodes[pages[index]]?.title?.trim() || `Page ${index + 1}`;
            const pageSlug = slugify(title, `page-${index + 1}`);
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
        await Promise.all(opened.map(doc => doc.destroy()));
    }
}
```

- [ ] **Step 5: Run tests and typecheck.** Run: `TMPDIR=… npx vitest run tests/unit/deviceExport && npx tsc --noEmit`. Expected: PASS, and no type errors in `services/deviceExport/`. If `pdfjsLib.PDFPageProxy` is not exported as a type, use `type Page = Awaited<ReturnType<pdfjsLib.PDFDocumentProxy['getPage']>>`.

- [ ] **Step 6: Commit.**

```bash
git add services/deviceExport tests/unit/deviceExport/exportJob.test.ts
git commit -m "feat(device-export): export job with progress, cancel and per-page failures

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Device export dialog

**Files:**
- Create: `components/export/DeviceExportDialog.tsx`
- Test: `tests/unit/deviceExport/DeviceExportDialog.test.tsx`

**Interfaces:**
- Consumes:
  - `buildPageGroups`, `defaultSelection`, `filterGroups`, `imageCount`, `exportBlockReason`, `TemplateGroup` (Task 4);
  - `readDeviceExportSettings`, `writeDeviceExportSettings` (Task 4);
  - `DEVICE_PROFILES`, `PLATFORMS`, `PLATFORM_LABELS`, `getProfile` (Task 2);
  - `runDeviceExport`, `DeviceExportProgress` (Task 8);
  - `downloadBlob` (`services/browserDownload.ts`), `trackEvent` (`services/analytics.ts`);
  - `useFormFactor` (`components/editor-layout/FormFactorContext`), `useBackDismiss`, `trapTab`.
- Produces: `DeviceExportDialog(props: { isOpen: boolean; onClose(): void; getState(): AppState; projectName: string; initialForceGreyscale: boolean; runExport?: typeof runDeviceExport; download?: typeof downloadBlob })`.

Behaviour:
- **Opening:** the dialog snapshots `getState()` when it opens.
- **Keys:** keydown events stop at the dialog root, so editor shortcuts (Delete, Ctrl+Z) never see them. Escape closes; Tab is trapped.
- **Closing:** closing during a run aborts it.
- **Cancel during a run:** returns to the picker.
- **Saving settings:** the remembered devices, greyscale and PDF settings are saved when Export is pressed.
- **Layout:** full screen on phone, a centred modal elsewhere.

- [ ] **Step 1: Write the failing tests** `tests/unit/deviceExport/DeviceExportDialog.test.tsx`:

```tsx
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppState } from '../../../types';

const trackEvent = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../../../services/analytics', () => ({ trackEvent }));

import { DeviceExportDialog } from '../../../components/export/DeviceExportDialog';

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
    return { props, dialog: screen.getByRole('dialog', { name: 'Export for device' }) };
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
        expect(box(dialog, 'Jan 5').checked).toBe(true);
        fireEvent.click(within(dialog).getByRole('button', { name: 'Clear pages of Daily' }));
        expect(box(dialog, 'Jan 1').checked).toBe(false);
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

    it('renders nothing when closed', () => {
        render(<DeviceExportDialog isOpen={false} onClose={vi.fn()} getState={() => makeState(1)} projectName="P" initialForceGreyscale={false} />);
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});
```

- [ ] **Step 2: Run to verify failure.** Run: `TMPDIR=… npx vitest run tests/unit/deviceExport/DeviceExportDialog.test.tsx`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `components/export/DeviceExportDialog.tsx`:**

```tsx
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { Tablet, X } from 'lucide-react';
import type { AppState } from '../../types';
import { useFormFactor } from '../editor-layout/FormFactorContext';
import { useBackDismiss } from '../editor-layout/useBackDismiss';
import { trapTab } from '../editor-layout/focusTrap';
import { DEVICE_PROFILES, PLATFORMS, PLATFORM_LABELS, getProfile } from '../../services/deviceExport/deviceProfiles';
import { buildPageGroups, defaultSelection, exportBlockReason, filterGroups, imageCount, type TemplateGroup } from '../../services/deviceExport/selection';
import { readDeviceExportSettings, writeDeviceExportSettings } from '../../services/deviceExport/settings';
import { runDeviceExport, type DeviceExportProgress } from '../../services/deviceExport/exportJob';
import { downloadBlob } from '../../services/browserDownload';
import { trackEvent } from '../../services/analytics';

const COLLAPSED_PAGES = 3;

export interface DeviceExportDialogProps {
    isOpen: boolean;
    onClose: () => void;
    /** Read when the dialog opens: the export uses the project as it was then. */
    getState: () => AppState;
    projectName: string;
    /** "Force greyscale" starts here until the picker has remembered its own choice. */
    initialForceGreyscale: boolean;
    runExport?: typeof runDeviceExport;
    download?: typeof downloadBlob;
}

type Phase = { kind: 'idle' } | { kind: 'running'; progress: DeviceExportProgress } | { kind: 'error'; message: string };

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const toggled = (set: ReadonlySet<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
};

/**
 * "Export for device": pick template/page combinations and e-ink models, then download one zip.
 * A centred modal on desktop and tablet, full screen on phone. Keydown stops at the dialog so the
 * editor's shortcuts (Delete, undo) never act on the canvas behind it.
 */
export function DeviceExportDialog(props: DeviceExportDialogProps) {
    if (!props.isOpen) return null;
    return <OpenDeviceExportDialog {...props} />;
}

function OpenDeviceExportDialog({ onClose, getState, projectName, initialForceGreyscale, runExport = runDeviceExport, download = downloadBlob }: DeviceExportDialogProps) {
    const phone = useFormFactor() === 'phone';
    const [state] = useState(getState);
    const groups = useMemo(() => buildPageGroups(state), [state]);
    const [settings] = useState(() => readDeviceExportSettings(initialForceGreyscale));
    const [pages, setPages] = useState(() => defaultSelection(groups));
    const [devices, setDevices] = useState<Set<string>>(() => new Set(settings.devices));
    const [forceGreyscale, setForceGreyscale] = useState(settings.forceGreyscale);
    const [includePdf, setIncludePdf] = useState(settings.includePdf);
    const [query, setQuery] = useState('');
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
    const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
    const run = useRef<AbortController | null>(null);
    const dialog = useRef<HTMLDivElement>(null);

    const running = phase.kind === 'running';
    const visible = filterGroups(groups, query);
    const count = imageCount(pages.size, devices.size);
    const blocked = exportBlockReason(pages.size, devices.size);
    const pdfCapable = [...devices].some(id => getProfile(id)?.platform !== 'remarkable');

    const close = () => { run.current?.abort(); run.current = null; onClose(); };
    useBackDismiss(true, () => { close(); });
    useLayoutEffect(() => {
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialog.current?.focus();
        return () => { if (previous?.isConnected) previous.focus(); };
    }, []);
    useEffect(() => () => run.current?.abort(), []);

    const setGroup = (group: TemplateGroup, on: boolean) => setPages(current => {
        const next = new Set(current);
        for (const page of group.pages) if (on) next.add(page.nodeId); else next.delete(page.nodeId);
        return next;
    });

    const startExport = async () => {
        if (blocked || running) return;
        const withPdf = includePdf && pdfCapable;
        writeDeviceExportSettings({ devices: [...devices], forceGreyscale, includePdf });
        const controller = new AbortController();
        run.current = controller;
        setPhase({ kind: 'running', progress: { phase: 'preparing', done: 0, total: count } });
        try {
            const result = await runExport(
                { state, projectName, pageNodeIds: [...pages], deviceIds: [...devices], forceGreyscale, includePdf: withPdf },
                { signal: controller.signal, onProgress: progress => { if (!controller.signal.aborted) setPhase({ kind: 'running', progress }); } },
            );
            if (controller.signal.aborted) return;
            download(result.blob, result.fileName);
            void trackEvent('device_templates_exported', {
                pageCount: pages.size, deviceIds: [...devices], imageCount: result.imageCount,
                forcedGreyscale: forceGreyscale, includePdf: withPdf, failures: result.failures,
            });
            onClose();
        } catch (error) {
            if (controller.signal.aborted) return;
            setPhase({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
        } finally {
            if (run.current === controller) run.current = null;
        }
    };
    const cancelRun = () => { run.current?.abort(); run.current = null; setPhase({ kind: 'idle' }); };

    const progressText = phase.kind !== 'running' ? null
        : phase.progress.phase === 'preparing' ? 'Preparing pages…'
            : phase.progress.phase === 'packaging' ? 'Packaging…'
                : `Rendering ${phase.progress.done} / ${phase.progress.total}`;
    const statusText = progressText ?? blocked ?? `${plural(pages.size, 'page')} × ${plural(devices.size, 'device')} = ${plural(count, 'template')} (.zip)`;
    const row = clsx('flex items-center gap-2 text-sm text-slate-700', phone && 'min-h-11');

    return createPortal(
        <div className={clsx('fixed inset-0 z-50 flex bg-black/50', !phone && 'items-center justify-center p-4')}>
            <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="device-export-title" aria-busy={running || undefined} tabIndex={-1}
                onKeyDown={event => {
                    event.stopPropagation();
                    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
                    trapTab(event, dialog.current);
                }}
                className={clsx('flex flex-col bg-white outline-none', phone ? 'h-full w-full' : 'max-h-[90dvh] w-full max-w-2xl rounded-xl shadow-2xl')}>
                <div className="flex items-center justify-between border-b px-4 py-3">
                    <h2 id="device-export-title" className="flex items-center gap-2 text-lg font-bold text-slate-800">
                        <Tablet size={18} className="text-blue-600" /> Export for device
                    </h2>
                    <button type="button" onClick={close} aria-label="Close export for device"
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100">
                        <X size={20} />
                    </button>
                </div>
                <div className="flex-1 space-y-5 overflow-y-auto px-4 py-3">
                    <section aria-labelledby="device-export-pages">
                        <div className="mb-2 flex items-center justify-between gap-3">
                            <h3 id="device-export-pages" className="text-sm font-semibold text-slate-800">Pages</h3>
                            <input type="search" aria-label="Search pages" placeholder="Search pages" value={query} onChange={event => setQuery(event.target.value)}
                                className="w-48 rounded border border-slate-300 px-2 py-1 text-sm" />
                        </div>
                        {groups.length === 0 && <p className="text-sm text-slate-500">This project has no pages to export.</p>}
                        {visible.map(group => (
                            <PageGroup key={group.templateId} group={group} selected={pages} disabled={running} rowClass={row}
                                showAll={query.trim() !== '' || expanded.has(group.templateId)}
                                onToggle={id => setPages(current => toggled(current, id))}
                                onSetAll={on => setGroup(group, on)}
                                onExpand={() => setExpanded(current => new Set(current).add(group.templateId))} />
                        ))}
                    </section>
                    <section aria-labelledby="device-export-devices">
                        <h3 id="device-export-devices" className="mb-2 text-sm font-semibold text-slate-800">Devices</h3>
                        {PLATFORMS.map(platform => (
                            <fieldset key={platform} className="mb-2">
                                <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400">{PLATFORM_LABELS[platform]}</legend>
                                <div className="flex flex-wrap gap-x-4">
                                    {DEVICE_PROFILES.filter(profile => profile.platform === platform).map(profile => (
                                        <label key={profile.id} className={row}>
                                            <input type="checkbox" checked={devices.has(profile.id)} disabled={running}
                                                onChange={() => setDevices(current => toggled(current, profile.id))} />
                                            {profile.name}
                                        </label>
                                    ))}
                                </div>
                            </fieldset>
                        ))}
                        <label className={row}>
                            <input type="checkbox" checked={forceGreyscale} disabled={running} onChange={event => setForceGreyscale(event.target.checked)} />
                            Force greyscale
                        </label>
                        {pdfCapable && (
                            <label className={row}>
                                <input type="checkbox" checked={includePdf} disabled={running} onChange={event => setIncludePdf(event.target.checked)} />
                                Also include a PDF template
                            </label>
                        )}
                    </section>
                </div>
                <div className="space-y-2 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                    <p role="status" className="text-sm text-slate-600">{statusText}</p>
                    {phase.kind === 'error' && <p role="alert" className="text-sm text-red-600">Export failed: {phase.message}</p>}
                    <div className="flex justify-end gap-2">
                        <button type="button" onClick={running ? cancelRun : close}
                            className="min-h-11 rounded px-4 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
                        {!running && (
                            <button type="button" onClick={() => { void startExport(); }} disabled={blocked !== null}
                                className="min-h-11 rounded bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">Export</button>
                        )}
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
}

function PageGroup({ group, selected, disabled, rowClass, showAll, onToggle, onSetAll, onExpand }: {
    group: TemplateGroup; selected: ReadonlySet<string>; disabled: boolean; rowClass: string; showAll: boolean;
    onToggle: (nodeId: string) => void; onSetAll: (on: boolean) => void; onExpand: () => void;
}) {
    const ticked = group.pages.filter(page => selected.has(page.nodeId)).length;
    const all = useRef<HTMLInputElement>(null);
    useEffect(() => { if (all.current) all.current.indeterminate = ticked > 0 && ticked < group.pages.length; });
    const shown = showAll ? group.pages : group.pages.slice(0, COLLAPSED_PAGES);
    const hidden = group.pages.length - shown.length;
    return (
        <div role="group" aria-label={group.name} className="mb-2">
            <div className="flex items-center gap-3">
                <label className={clsx(rowClass, 'font-medium')}>
                    <input ref={all} type="checkbox" checked={ticked === group.pages.length} disabled={disabled} onChange={event => onSetAll(event.target.checked)} />
                    {group.name} ({group.pages.length})
                </label>
                <button type="button" disabled={disabled} onClick={() => onSetAll(true)} aria-label={`Select all pages of ${group.name}`} className="text-xs text-blue-600 hover:underline">all</button>
                <button type="button" disabled={disabled} onClick={() => onSetAll(false)} aria-label={`Clear pages of ${group.name}`} className="text-xs text-blue-600 hover:underline">none</button>
            </div>
            <ul className="ml-6">
                {shown.map(page => (
                    <li key={page.nodeId}>
                        <label className={rowClass}>
                            <input type="checkbox" checked={selected.has(page.nodeId)} disabled={disabled} onChange={() => onToggle(page.nodeId)} />
                            {page.title}
                        </label>
                    </li>
                ))}
            </ul>
            {hidden > 0 && (
                <button type="button" onClick={onExpand} className="ml-6 text-xs text-blue-600 hover:underline">… {hidden} more</button>
            )}
        </div>
    );
}
```

- [ ] **Step 4: Run tests.** Run: `TMPDIR=… npx vitest run tests/unit/deviceExport/DeviceExportDialog.test.tsx`. Expected: PASS.
  - If `'Index'` matches both the page checkbox and the group checkbox: the group checkbox's name is "Month index (1)", so `{ name: 'Index' }` (exact by default) matches only the page.
  - If the search test's selector is awkward, assert `within(dialog).getAllByRole('checkbox').filter(el => /^Jan/.test(el.closest('label')!.textContent!.trim()))` has length 1. Change only the assertion, not the behaviour.

- [ ] **Step 5: Commit.**

```bash
git add components/export/DeviceExportDialog.tsx tests/unit/deviceExport/DeviceExportDialog.test.tsx
git commit -m "feat(device-export): Export for device dialog

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Entry points in the editor

**Files:**
- Modify: `components/editor-layout/touchActions.ts:6`, `components/editor-layout/OverflowMenu.tsx:114-119`, `components/ProjectEditor.tsx`. The spots in `ProjectEditor.tsx`:
  - the `useLegacyEditor` return object (around line 1066);
  - the incremental editor's model object (the one with `handleSelectVariant, handleAddVariant`, around line 1590);
  - the `ProjectEditorView` parameter list (around line 1630);
  - the desktop export split button (around lines 1682-1704);
  - `touchActions` (around line 1805);
  - the modal list (around line 1877).
- Modify: `tests/helpers/touchActions.ts`, `tests/unit/touchChrome.test.tsx`

**Interfaces:**
- Consumes: `DeviceExportDialog` (Task 9).
- Produces:
  - `TouchEditorActions.exportForDevice: () => void`;
  - `EditorViewModel.exportSnapshot: () => AppState`:
    - legacy: the current `state`;
    - incremental: `editor.exportState()`, the same raw state Export PDF uses.

- [ ] **Step 1: Write the failing overflow test.**
  - In `tests/helpers/touchActions.ts`, add `exportForDevice: vi.fn(),` to the object `makeActions` builds, next to `exportPdf`.
  - In `tests/unit/touchChrome.test.tsx`, inside `describe('OverflowMenu', …)`, add:

```tsx
    it('opens Export for device from the Export group and closes the sheet', () => {
        const actions = makeActions();
        const onClose = vi.fn();
        render(<OverflowMenu open onClose={onClose} actions={actions} chrome={chrome} />);
        const item = screen.getByRole('button', { name: 'Export for device…' });
        expect(item.previousElementSibling?.textContent).toContain('Export all variants');
        fireEvent.click(item);
        expect(actions.exportForDevice).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalled();
    });
```

- [ ] **Step 2: Run to verify failure.** Run: `TMPDIR=… npx vitest run tests/unit/touchChrome.test.tsx`. Expected: FAIL (no "Export for device…" button).

- [ ] **Step 3: Implement touch wiring.**
  - In `components/editor-layout/touchActions.ts`, change the export line to:

```ts
    exportPdf: () => void; exportAllVariants: () => void; exportForDevice: () => void; canExportAllVariants: boolean; isExporting: boolean;
```

  - In `components/editor-layout/OverflowMenu.tsx`, inside `<Group title="Export">`, add this after the "Export all variants" item:

```tsx
                    <Item label="Export for device…" onClick={run(actions.exportForDevice)} disabled={actions.isExporting} />
```

- [ ] **Step 4: Implement editor wiring** in `components/ProjectEditor.tsx`:
  1. Imports: add `import { DeviceExportDialog } from './export/DeviceExportDialog';` and add `Tablet` to the existing `lucide-react` import.
  2. In the `useLegacyEditor` return object, after `jsonState: state, toolbarStateSetter: setState,`, add: `exportSnapshot: () => state,`
  3. In the incremental editor's model object (it contains `exportGreyscale, setExportGreyscale, handleExportPDF, isExporting` or spreads them; find it with `grep -n "handleExportPDF, isExporting" components/ProjectEditor.tsx`), add: `exportSnapshot: editor.exportState,`
  4. In `ProjectEditorView`'s destructured parameters, add `exportSnapshot,` after `handleExportPDF, isExporting,`.
  5. At the top of `ProjectEditorView`'s body, after `const isTouch = formFactor !== 'desktop';`, add: `const [showDeviceExport, setShowDeviceExport] = useState(false);`
  6. Desktop split button:
     - Remove `rounded-r` from the "All" button's class string.
     - Add this button directly after the "All" button, inside the same `flex items-stretch ml-2 shadow-sm rounded` div:

```tsx
                        <button
                            onClick={() => setShowDeviceExport(true)}
                            disabled={isExporting}
                            className={clsx(
                                "text-white bg-blue-600 hover:bg-blue-700 px-2 py-1 rounded-r border-l border-blue-500/50 flex items-center justify-center gap-1 text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed",
                                isExporting && "opacity-75 bg-blue-700"
                            )}
                            title="Export templates for e-ink devices"
                        >
                            <Tablet size={14} /> Devices
                        </button>
```

  7. In `touchActions`, after `exportAllVariants: …,`, add: `exportForDevice: () => setShowDeviceExport(true),`
  8. In the JSX after `<SavePresetModal … />`, add:

```tsx
            <DeviceExportDialog
                isOpen={showDeviceExport}
                onClose={() => setShowDeviceExport(false)}
                getState={exportSnapshot}
                projectName={projectName}
                initialForceGreyscale={exportGreyscale}
            />
```

  If `projectName` is not destructured in `ProjectEditorView`, use the prop name it does destructure. It is already listed (`state, projectId, projectName, …`).

- [ ] **Step 5: Typecheck and run the affected suites.** Run: `npx tsc --noEmit && TMPDIR=… npx vitest run tests/unit/touchChrome.test.tsx tests/unit/backDismissHandlers.test.tsx tests/unit/CloudMenu.test.tsx $(grep -rl "ProjectEditor" tests/unit | tr '\n' ' ')`. Expected: PASS. Every fixture `tsc` flags for a missing `exportForDevice` gets `exportForDevice: vi.fn()` (or `() => {}` outside vitest).

- [ ] **Step 6: Run the desktop layout guard.** Run: `E2E_WEB_PORT=4410 E2E_API_PORT=4411 TMPDIR=… npx playwright test tests/e2e/desktop_layout_guard.spec.js --project=chromium; git checkout -- server/analytics.db`. Expected: the screenshots differ only by the new "Devices" segment of the export button.
  - Do **not** update the snapshots.
  - Report the diff images (paths under `test-results/`) as `DONE_WITH_CONCERNS`; the controller asks the user.
  - If the guard passes (the header is masked or cropped), say so.

- [ ] **Step 7: Commit.**

```bash
git add components/ProjectEditor.tsx components/editor-layout/OverflowMenu.tsx components/editor-layout/touchActions.ts tests/helpers/touchActions.ts tests/unit/touchChrome.test.tsx
git commit -m "feat(device-export): open Export for device from the desktop export button and the touch menu

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: End-to-end tests (desktop and touch)

**Files:**
- Create: `tests/e2e/device_export.spec.js`
- Modify: `tests/e2e/mobile_editor.spec.js` (add `JSZip` and `readFile` imports and one test)

**Interfaces:**
- Consumes: everything above, through the UI.
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the desktop e2e test** `tests/e2e/device_export.spec.js`:

```js
import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';
import { seedNativeProject } from './localWorkspaceHelpers.js';
import { layoutFixture } from './fixtures/layoutFixture.js';

// Device template export from the desktop editor: picker defaults, a multi-platform zip, PNG pixel
// sizes per model, landscape handling, the legacy templates.json fragment and Methods files.
const fixture = structuredClone(layoutFixture);
const page = (id, type, title) => ({ id, parentId: 'root', type, title, data: {}, children: [] });
fixture.nodes.root.children = ['day1', 'day2', 'cover'];
fixture.nodes.day1 = page('day1', 'page', 'Day 1');
fixture.nodes.day2 = page('day2', 'page', 'Day 2');
fixture.nodes.cover = page('cover', 'cover', 'Cover');
fixture.variants.default.templates.cover = {
    id: 'cover', name: 'Cover', width: 842, height: 595,
    layers: [{ id: 'base', name: 'Base', order: 0, visible: true, locked: false }],
    elements: [{ id: 'band', type: 'rect', layerId: 'base', x: 40, y: 40, w: 300, h: 80, rotation: 0,
        fill: '#94a3b8', stroke: '#000000', strokeWidth: 2, opacity: 1 }],
};

const activePane = p => p.locator('[data-testid="project-pane"][data-active="true"]');
const pngSize = bytes => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });
const pathLetters = value => Array.isArray(value) ? value.flatMap(pathLetters)
    : value && typeof value === 'object' ? Object.entries(value).flatMap(([key, v]) => (key === 'data' ? v.filter(t => /^[A-Z]$/.test(t)) : pathLetters(v)))
        : [];

test.beforeEach(async ({ page: browserPage }) => {
    await seedNativeProject(browserPage, { id: 'device-export', name: 'Device Export', initialState: fixture });
    await browserPage.goto('/app');
    await expect(activePane(browserPage).getByTestId('editor-canvas')).toBeVisible();
});

test('exports chosen pages for several devices as one zip', async ({ page: browserPage }) => {
    await browserPage.getByRole('button', { name: 'Devices' }).click();
    const dialog = browserPage.getByRole('dialog', { name: 'Export for device' });
    await expect(dialog.getByRole('checkbox', { name: 'Guard Page' })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: 'Day 1' })).not.toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: 'Cover', exact: true })).toBeChecked();

    for (const name of ['reMarkable 2', 'Manta (A5 X2)', 'Note Air 4C / Tab Ultra C Pro']) {
        await dialog.getByRole('checkbox', { name }).check();
    }
    await dialog.getByRole('checkbox', { name: 'Also include a PDF template' }).check();
    await expect(dialog.getByRole('status')).toHaveText('2 pages × 3 devices = 6 templates (.zip)');

    const downloadPromise = browserPage.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Export', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('Device_Export_device_templates.zip');
    await expect(dialog).toBeHidden();

    const zip = await JSZip.loadAsync(await readFile(await download.path()));
    const size = async path => pngSize(Buffer.from(await zip.file(path).async('uint8array')));
    expect(await size('reMarkable/reMarkable_2/png/Guard_Page.png')).toEqual({ width: 1404, height: 1872 });
    expect(await size('reMarkable/reMarkable_2/png/Cover.png')).toEqual({ width: 1872, height: 1404 });
    expect(await size('Supernote/Manta/MyStyle/Device_Export/Guard_Page.png')).toEqual({ width: 1920, height: 2560 });
    expect(await size('Boox/Note_Air_4C_Tab_Ultra_C_Pro/noteTemplate/Cover.png')).toEqual({ width: 2480, height: 1860 });
    expect((await zip.file('Supernote/Manta/MyStyle/Device_Export/Device_Export.pdf').async('uint8array')).length).toBeGreaterThan(100);
    expect(zip.file('README.txt')).toBeTruthy();

    const legacy = JSON.parse(await zip.file('reMarkable/reMarkable_2/png/templates.json').async('string'));
    expect(legacy.templates.map(t => [t.filename, Boolean(t.landscape)])).toEqual([['Guard_Page', false], ['Cover', true]]);

    const methods = zip.file(/^reMarkable\/reMarkable_2\/methods\/.*\.template$/);
    expect(methods).toHaveLength(2);
    for (const file of methods) {
        const template = JSON.parse(await file.async('string'));
        expect(template).toMatchObject({ formatVersion: 1, supportedScreens: ['rm2'], categories: ['Custom'] });
        expect(new Set(pathLetters(template.items)).size).toBeGreaterThan(0);
        for (const letter of pathLetters(template.items)) expect(['M', 'L', 'Z']).toContain(letter);
    }
});
```

- [ ] **Step 2: Add the touch e2e test** to `tests/e2e/mobile_editor.spec.js`. Add the imports at the top (`import JSZip from 'jszip';` and `import { readFile } from 'node:fs/promises';`), then add this test after the "drawer rows keep their names visible" test:

```js
test('Export for device opens from the ⋯ menu, closes on back, and downloads a zip', async ({ page }) => {
    const open = async () => {
        await page.getByRole('button', { name: 'More actions' }).click();
        await overflowMenu(page).getByRole('button', { name: 'Export for device…' }).click();
    };
    const dialog = page.getByRole('dialog', { name: 'Export for device' });
    await open();
    await expect(dialog).toBeVisible();
    await expect.poll(() => overlayDepth(page)).toBe(1);
    await page.goBack();
    await expect(dialog).toBeHidden();
    await expect(activePane(page).getByTestId('editor-canvas')).toBeVisible();
    await expect.poll(() => overlayDepth(page)).toBe(0);

    await open();
    await dialog.getByRole('checkbox', { name: 'Paper Pro', exact: true }).check();
    const downloadPromise = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Export', exact: true }).click();
    const zip = await JSZip.loadAsync(await readFile(await (await downloadPromise).path()));
    const bytes = Buffer.from(await zip.file('reMarkable/Paper_Pro/png/Guard_Page.png').async('uint8array'));
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([1620, 2160]);
    expect(zip.file(/^reMarkable\/Paper_Pro\/methods\/.*\.template$/)).toHaveLength(1);
});
```

  If the tablet layout has no "More actions" button, find the control that opens `OverflowMenu` on tablet with `grep -n "More actions" components/editor-layout/*.tsx` and use it. Do not skip the tablet run.

- [ ] **Step 3: Run desktop e2e.** Run: `E2E_WEB_PORT=4410 E2E_API_PORT=4411 TMPDIR=… npx playwright test tests/e2e/device_export.spec.js --project=chromium; git checkout -- server/analytics.db`. Expected: PASS.

- [ ] **Step 4: Run touch e2e.** Run: `E2E_WEB_PORT=4410 E2E_API_PORT=4411 TMPDIR=… npx playwright test tests/e2e/mobile_editor.spec.js --project=mobile-phone-chromium --project=mobile-tablet-chromium; git checkout -- server/analytics.db`. Expected: PASS. If the project names differ, list them with `npx playwright test --list --project='mobile-*' | head`.

- [ ] **Step 5: Run the full suites.** Run:
  - `TMPDIR=… npx vitest run`
  - `npx tsc --noEmit`
  - `E2E_WEB_PORT=4410 E2E_API_PORT=4411 TMPDIR=… npx playwright test --project=chromium; git checkout -- server/analytics.db`

  Expected: all pass, except the desktop layout guard if Task 10 Step 6 reported the screenshot difference awaiting the user's decision. Report any other failure with its output. A failure that passes on a lone rerun is reported as flaky, with both outputs.

- [ ] **Step 6: Commit.**

```bash
git add tests/e2e/device_export.spec.js tests/e2e/mobile_editor.spec.js
git commit -m "test(device-export): desktop and touch end-to-end exports

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Regenerate the onboarding bundle

**Files:**
- Modify: whatever `node onboarding/build.mjs` regenerates.

- [ ] **Step 1: Regenerate.** Run: `node onboarding/build.mjs && git status --short`. Expected: only onboarding bundle files change.
- [ ] **Step 2: Run the onboarding tests.** Run: `TMPDIR=… npx vitest run $(grep -rl "onboarding" tests/unit --include=*.test.* | tr '\n' ' ')`. Expected: PASS.
- [ ] **Step 3: Commit.**

```bash
git add -A onboarding
git commit -m "chore(onboarding): regenerate bundle

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After the plan: device checklist (user)

The user runs spec section 9's checklist on the rM2, Paper Pro and Paper Pro Move, using a zip from this branch. The results go into the spec, and the `verified` field of each confirmed row in `deviceProfiles.ts` becomes `'device'`. Fixes that follow from the checklist are small changes to single constants:
- `rotateForCanvas`;
- `REMARKABLE_CANVAS_WIDTH`;
- `TEXT_TOP_FROM_BASELINE`;
- `LEGACY_ICON_CODE`;
- `remarkableScreen` for the Move.

Merge waits for that checklist.
