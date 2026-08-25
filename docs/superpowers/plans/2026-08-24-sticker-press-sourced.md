# The Sticker Press (sourced artwork) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship gallery flagship 21 — a 500-sticker book built entirely on Lucide and Twemoji artwork, with real navigation and complete attribution.

**Architecture:** A committed vendor step fetches and minifies only the icons the registry names, writing them plus upstream licence files and a manifest into `gallery-samples/21-sticker-press/vendor/`. A build step inlines that vendored artwork into `templates.js`, which carries the 500-entry registry, the layout engine and the navigation chrome — and no hand-drawn artwork at all. `hierarchy.js` builds one node tree shared by four device variants.

**Spec:** `docs/superpowers/specs/2026-08-24-sticker-press-sourced-artwork-design.md`

**Supersedes:** `docs/superpowers/plans/2026-08-22-sticker-press.md` Tasks 4–8. Its Tasks 1–3 are DONE and must not be redone.

## Global Constraints

- Page sizes, exact: `paper_pro` 509×679, `move` 260×463, `note_air` 446×595, `pure` 447×596. `activeVariantId` is `paper_pro`.
- All four variants expose an identical template id set.
- 500 stickers: **~330 Lucide** (6 colourways × 2 sizes) and **~170 Twemoji** (full colour × 2 sizes). **No house-drawn artwork at all** — the furniture band was dropped 2026-08-24 on the user's review of the contact sheet: the sourced pages read well, the house shapes did not, and several were near-duplicate argument variants (three scalloped seals, three rosettes differing only in petal count, a 'medal disc' that was a circle). Categories 1-3 are re-sourced from Lucide and Twemoji, which supply bookmark, tag, label, flag, paperclip, pin, ribbon and similar.
- Colourways: Outline (none), Amber `#f0c674`, Green `#86c08e`, Blue `#5b93c4`, Red `#b04a46`, Ink `#3d4650`. Outline ink is `#23292f`. Adjacent luminances must differ by ≥25 under `y = 0.299r + 0.587g + 0.114b`.
- **Twemoji is never recoloured.**
- Twemoji stickers must each minify to **≤1,500 bytes**. Lucide to **≤1,200 bytes**.
  (Revised 2026-08-24 from 700 B. The original figure came from a random 300-icon sample whose
  mean is 165 B — but that sample is dominated by simple UI glyphs, and a sticker book wants
  the detailed end of the set: vehicles, furniture, animals. Across an actual 300-sticker
  curation the median is 365 B, p90 733 B, max 1205 B. Raising the cap admits essentially every
  desirable icon for roughly 25 KB against a 512 KiB budget.)
- `templates.js` and `hierarchy.js` are each capped at **512 KiB** (`shared/generatorMetadata.js:2`). Target ≤450 KiB for `templates.js`, and report the real figure after vendoring rather than assuming it.
- Generated state must serialise under **28 MiB** (cap raised to 32 MiB on 2026-08-25, `shared/projectLimits.js`).
  The laid-out stickers alone measure 13.1 MB and per-sheet navigation chrome adds several MB
  more, which would have blocked generation at the previous 16 MiB. The user decided the size
  is acceptable rather than reduce colourway depth, size variants, or device count, so the cap
  moves instead of the product. Both `MAX_STATE_BYTES` and `MAX_GENERATOR_OUTPUT_BYTES` go to
  32 MiB; they remain separate constants because they guard unrelated things.
- **Import rule:** flatten root presentation attributes (`fill, stroke, stroke-width, stroke-linecap, stroke-linejoin, stroke-miterlimit`) onto every drawable child (`path, circle, ellipse, rect, line, polyline, polygon, g`). svg2pdf does not inherit them from the root.
- **Never** `setAttribute('xmlns', …)` after stripping root attributes — the serializer emits it, and setting it by hand yields a document svg2pdf silently refuses to draw.
- Ship `viewBox`; omit root `width`/`height`. 6-digit hex or `rgb()` only. No `<use>`, `<script>`, `<style>`, `<foreignObject>`, `on*`.
- Element ids deterministic — monotonic counter, never `Math.random()`.
- Skip link text exactly `Skip to blank workspace →`.
- Tests: `npx vitest run tests/unit/gallerySamples/`. Full suite has two known-bad files (`onboarding/bundle.test.js`, `accountModeration.test.js`) — a third failure is yours.
- **Every task that changes artwork ends with a rendered contact-sheet PDF** at 56pt and the smallest tier. No artwork task is done until that PDF exists and has been looked at.

---

## Task A: Vendor the artwork

**Files:** Create `gallery-samples/21-sticker-press/vendor/build.mjs`, `vendor/manifest.json`, `vendor/lucide/*.svg`, `vendor/twemoji/*.svg`, `vendor/LICENSE-lucide`, `vendor/LICENSE-twemoji-graphics`. Test: `tests/unit/gallerySamples/stickerPressVendor.test.ts`.

**Interfaces produced:** `manifest.json` = `{ generatedFrom: {lucide: {version, url}, twemoji: {ref, url}}, icons: [{ id, source: 'lucide'|'twemoji', upstream, bytes, licence }] }`, where `id` is the registry key, `upstream` the source path, `bytes` the minified byte count.

- [ ] **Step 1: Write the failing test**

```ts
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DIR = 'gallery-samples/21-sticker-press/vendor';
const manifest = () => JSON.parse(readFileSync(`${DIR}/manifest.json`, 'utf8'));

describe('sticker press vendor', () => {
    it('ships both upstream licence files, non-empty', () => {
        ['LICENSE-lucide', 'LICENSE-twemoji-graphics'].forEach(f => {
            expect(existsSync(`${DIR}/${f}`), f).toBe(true);
            expect(readFileSync(`${DIR}/${f}`, 'utf8').trim().length).toBeGreaterThan(200);
        });
    });

    it('carries both halves of the Lucide licence', () => {
        const t = readFileSync(`${DIR}/LICENSE-lucide`, 'utf8');
        expect(t).toContain('ISC License');
        expect(t).toContain('Lucide Icons and Contributors');
        expect(t).toContain('Cole Bemis');           // the Feather-derived MIT half
        expect(t).toContain('MIT License');
    });

    it('carries the Twemoji CC-BY 4.0 graphics licence', () => {
        expect(readFileSync(`${DIR}/LICENSE-twemoji-graphics`, 'utf8')).toContain('Attribution 4.0 International');
    });

    it('has a file on disk for every manifest entry, and no orphans', () => {
        const m = manifest();
        m.icons.forEach((i: any) => {
            expect(existsSync(`${DIR}/${i.source}/${i.id}.svg`), `${i.source}/${i.id}`).toBe(true);
        });
        (['lucide', 'twemoji'] as const).forEach(src => {
            const onDisk = readdirSync(`${DIR}/${src}`).filter(f => f.endsWith('.svg')).map(f => f.replace('.svg', ''));
            const named = new Set(m.icons.filter((i: any) => i.source === src).map((i: any) => i.id));
            onDisk.forEach(id => expect(named.has(id), `orphan ${src}/${id}`).toBe(true));
        });
    });

    it('records byte sizes that match the files, within their per-source cap', () => {
        manifest().icons.forEach((i: any) => {
            const actual = Buffer.byteLength(readFileSync(`${DIR}/${i.source}/${i.id}.svg`, 'utf8'), 'utf8');
            expect(actual, `${i.id} recorded size`).toBe(i.bytes);
            expect(actual, `${i.id} cap`).toBeLessThanOrEqual(i.source === 'twemoji' ? 1500 : 1200);
        });
    });

    it('labels every icon with the licence it falls under', () => {
        manifest().icons.forEach((i: any) => {
            expect(['ISC', 'MIT', 'CC-BY-4.0']).toContain(i.licence);
        });
    });

    it('contains no markup the renderers reject', () => {
        manifest().icons.forEach((i: any) => {
            const s = readFileSync(`${DIR}/${i.source}/${i.id}.svg`, 'utf8');
            expect(s, i.id).toContain('viewBox');
            expect(s, i.id).not.toMatch(/<svg[^>]*\swidth=/);
            expect(s, i.id).not.toMatch(/<(use|script|style|foreignObject)\b/i);
            expect(s, i.id).not.toMatch(/\son[a-z]+=/i);
            expect(s, i.id).not.toMatch(/hsla?\(/i);
            expect(s, i.id).not.toMatch(/currentColor/);   // resolved at vendor time
        });
    });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/unit/gallerySamples/stickerPressVendor.test.ts`. Expected: manifest missing.

- [ ] **Step 3: Write `vendor/build.mjs`**

It reads a plain list of wanted icon ids (Task B supplies the real one; start with ~20 to prove the pipeline), fetches each from upstream, minifies, flattens root presentation attributes onto drawable children per the Global Constraints, resolves `currentColor` to a placeholder token the build step substitutes per colourway, writes the file, and appends a manifest entry. Fetch Lucide from `https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/<id>.svg` and Twemoji from `https://raw.githubusercontent.com/jdecked/twemoji/main/assets/svg/<codepoint>.svg`. Download both licence files verbatim.

The script must be re-runnable and deterministic: same input list, byte-identical output.

- [ ] **Step 4: Run the build, then the test** — both must pass. Record the total vendored bytes.

- [ ] **Step 5: Commit** — `feat(sticker-press): vendor Lucide and Twemoji artwork with licences`

---

## Task B: Curate the 500-sticker registry

**Files:** Modify `vendor/build.mjs`'s wanted-list input; create `gallery-samples/21-sticker-press/registry.json`. Test: `tests/unit/gallerySamples/stickerPressRegistry.test.ts`.

**Interfaces produced:** `registry.json` = `[{ id, name, cat, source: 'lucide'|'twemoji'|'furniture', upstream, keywords: string[] }]`, 500 entries.

- [ ] **Step 1: Write the failing test** — asserts exactly 500 entries; the band split is 50 furniture / 300 lucide / 150 twemoji; the 18 categories and their counts sum to 500 and match membership; ids and names are unique; every non-furniture entry has a manifest counterpart; every entry has ≥1 keyword; names are human-readable (no raw codepoints, no kebab-case leaking through).

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Curate.** Pick Lucide ids from its 2,034; take keywords from Lucide's `tags.json` where present. Pick Twemoji **only from those minifying to ≤1,500 bytes** and hand-write their keywords. Name every sticker for a human ("Coffee cup", not "coffee" or "2615").

Prefer bold, simple shapes — the reviews on the abandoned artwork established that filled shapes survive downscaling and stroke-only marks do not, and that large holes survive where small ones dissolve.

- [ ] **Step 4: Re-run the vendor build with the real list, then both tests.**

- [ ] **Step 5: Render a contact sheet** of all 500 at 56pt and the smallest tier, and look at it. Replace anything that does not read.

- [ ] **Step 6: Commit** — `feat(sticker-press): curate the 500-sticker registry`

---

## Task C: Delete the house builders

**Files:** Modify `gallery-samples/21-sticker-press/templates.js`, `tests/unit/gallerySamples/stickerPressBuilders.test.ts`.

The house-drawn furniture band was dropped on review — the sourced artwork reads well and the
house shapes did not, and several were near-duplicate argument variants. `templates.js` should
therefore contain **no shape builders at all**; its artwork comes entirely from `vendor/`.

- [ ] **Step 1** Delete every entry from the `builders` object and the `ARG_DOMAINS` table, and
  delete `tests/unit/gallerySamples/stickerPressBuilders.test.ts` outright — it exists only to
  test builders that no longer exist. Keep `svgMarkup`, `round1` and `DEVICES` only if the
  layout engine still uses them; delete whatever it does not.
- [ ] **Step 2** Confirm nothing else references a deleted builder:
  `grep -rn "builders\." gallery-samples/21-sticker-press/ tests/` must come back clean.
- [ ] **Step 3** Run `npx vitest run tests/unit/gallerySamples/`. The registry and vendor suites
  must stay green; no suite may be left asserting against deleted code.
- [ ] **Step 4: Commit** — `refactor(sticker-press): drop the house-drawn builders`


## Task D: Sheet layout engine

**Files:** Modify `templates.js`. Test: `tests/unit/gallerySamples/stickerPressLayout.test.ts`.

**Interfaces produced:** `DEVICES` (unchanged from the earlier work), `planSheets(device)`, `buildStickerElements(device, sheet)`, `resetElementIds()`, `nextElementId()`.

Sheets are one per (category, colourway) for the furniture and Lucide bands, one per category for Twemoji. Each sticker occupies a cluster of its size variants, largest first, sharing one label. Pure white ground, no cell borders, labels in a gutter below the artwork so a generous lasso misses them.

- [ ] **Step 1** Failing test: every sticker placed in every colourway it declares; every cluster inside the page for all four devices; furniture clusters have 3 cells, Lucide 2, Twemoji 2; deterministic element ids; Twemoji sheets carry no colourway duplication.
- [ ] **Step 2–3** Implement, verify.
- [ ] **Step 4** Render one sheet per band per device. Look at it.
- [ ] **Step 5: Commit** — `feat(sticker-press): sheet layout engine`

---

## Task E: Navigation and credits

**Files:** Modify `templates.js`. Test: extend `stickerPressLayout.test.ts`.

**Interfaces produced:** `buildRail(device, sheet)`, `buildSwitcher(device, sheet)`, `buildIndexPages(kind)` for `'alpha'` and `'keyword'`, `buildCreditsPage()`, and the `GENERATE_SENTINEL` line before the variant-building block (`tests/unit/gallerySamples/stickerPressScope.ts` cuts the source there).

- [ ] **Step 1** Failing test: rail carries 18 category chips on the wide devices and a reduced set on `move`; switcher has 6 chips resolving to the same category in another colourway, and Twemoji sheets show a full-colour note instead; every A–Z entry resolves; every keyword entry resolves; the credits page contains the ISC notice, the Cole Bemis MIT notice, and the Twemoji CC-BY 4.0 attribution — **and fails if a source contributes a sticker but is not credited**, driven from `vendor/manifest.json`.
- [ ] **Step 2–3** Implement, verify. Chips are unfilled text chips, so a chip whose label is empty leaves no coloured box behind.
- [ ] **Step 4: Commit** — `feat(sticker-press): rail, switcher, indexes and credits`

---

## Task F: Hierarchy and four variants

**Files:** Modify `gallery-samples/21-sticker-press/hierarchy.js`. Test: `tests/unit/gallerySamples/stickerPress.test.ts`.

- [ ] **Step 1** Failing test via `expectValidGallerySample` with `expectedVariants` for all four page sizes and `expectedTemplateIds` generated from a real run.
- [ ] **Step 2** Build the tree: cover → `start_here` → contents, colour guide, credits, `example_workspace` (+ annotated), `blank_workspace` (+ dots, ruled), the A–Z and keyword index pages, and one node per sheet in category order. EXAMPLE chrome per the harness rules.
- [ ] **Step 3** `templates.js` returns `{ variants, activeVariantId: 'paper_pro' }` with all four devices.
- [ ] **Step 4** Run `npx vitest run tests/unit/gallerySamples/`.
- [ ] **Step 5: Commit** — `feat(sticker-press): hierarchy and four device variants`

---

## Task G: Product guards

**Files:** Extend `tests/unit/gallerySamples/stickerPress.test.ts`; modify `collection.test.ts`.

- [ ] **Step 1** Assertions: state serialises under 12 MiB; `templates.js` and `hierarchy.js` each under 512 KiB; identical template id set across variants; every `svgContent` parses with a `viewBox` and no root `width`/`height`; no `hsl(`, 4/8-digit hex, `<use>`, `<script>`, `<style>`, `<foreignObject>`; Twemoji markup appears in exactly one colour treatment; colourway luminances separated by ≥25.
- [ ] **Step 2** Add `'21-sticker-press'` to `EXPECTED_SLUGS`.
- [ ] **Step 3** Run the full suite.
- [ ] **Step 4: Commit** — `test(sticker-press): state size, script cap and svg hygiene guards`

---

## Task H: README and real-browser verification

**Files:** Create `gallery-samples/21-sticker-press/README.md`; modify `gallery-samples/README.md`.

- [ ] **Step 1** README in house style. It must state plainly that the artwork is curated from Lucide and Twemoji, name both licences, and carry the attributions. Every countable claim read off a real run.
- [ ] **Step 2** Publishing section: six tags, at least one from the gallery's `create` or `play` strip lists in `components/gallery/sections.ts`.
- [ ] **Step 3** Drive the real generator in Chromium: paste both scripts, Preview, Apply. Screenshot six template tabs per variant. Export all variants and confirm page counts, that stickers render (not blank boxes — the swallowed-failure signature at `services/pdfService.ts:1192-1194`), and that the credits page is present and legible.
- [ ] **Step 4** Check the browser console for `[PDFService] Error rendering SVG`. Any occurrence means stickers are silently missing.
- [ ] **Step 5: Commit** — `docs(sticker-press): README and rendered samples`

---

## Self-Review

**Spec coverage:** sources and licences → A; inventory and curation → B; furniture → C; script/state budgets → A, B, G; import rules → A; navigation → E; credits → A, E; required chrome → F; testing → A, B, G; contact-sheet gate → B, C, D, H.

**Carried forward, not redone:** Tasks 1–3 of the superseded plan (16 MiB cap and split constant; variant-aware harness; the `<pattern>` and measurement findings). `tests/unit/gallerySamples/stickerPressScope.ts` still exists and Task E must emit its sentinel.

**Known risk:** Task B is the one that decides whether this product is good. Curation quality is not testable — only the contact sheet catches a bad pick, which is why Step 5 of that task is mandatory and human-reviewed.
