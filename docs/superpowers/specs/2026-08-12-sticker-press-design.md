# The Sticker Press — design

**Date:** 2026-08-12 (revised 2026-08-22 after the IndexedDB local-workspace round)
**Status:** design approved, plan not yet written
**Slot:** `gallery-samples/21-sticker-press/`

## What this is

A sticker catalogue for e-note devices, delivered like every other flagship: two generator
scripts the user pastes into the Hierarchy Generator, previews, and applies.

It is not a planner. The other twenty products are hierarchies of pages you write *into*.
This one is a **source book** — every page is a sheet of artwork laid out to be lassoed with
the device's selection tool, screenshotted, and pasted into some other PDF or notebook.
That single difference drives most of the decisions below: there is no data binding on the
sheets, no per-page writing area, and the page chrome is deliberately kept out of the way of
a crop.

500 distinct stickers, each available in several colours and sizes, across four device
variants. Colours, sizes and variants do not count toward the 500.

## Device variants

One project, four variants. Exporting produces one PDF per variant, so a single download
covers every supported device.

| Variant | Page (pt) | Device | Panel | Pixels | PPI | Sheets | Pages |
|---|---|---|---|---|---:|---:|---:|
| `paper_pro` | 509×679 | reMarkable Paper Pro | 11.8″ 3:4 colour | 1620×2160 | 229 | ~62 | ~80 |
| `move` | 260×463 | reMarkable Paper Pro Move | 7.3″ 16:9 colour | 954×1696 | 264 | ~143 | ~158 |
| `note_air` | 446×595 | Boox Note Air 5C | 10.3″ 4:3 colour | 1860×2480 | 300 | ~115 | ~132 |
| `pure` | 447×596 | reMarkable Paper Pure | 10.3″ 4:3 **mono** | 1404×1872 | 226 | ~115 | ~132 |

Points at 72/inch, portrait. 509×679 matches the app's existing `RM_PP_WIDTH`/`RM_PP_HEIGHT`
constants (`types.ts:207-208`).

Note Air 5C and Paper Pure compute to 446×595 and 447×596 — one point apart, invisible in use.
They nonetheless get **separate variants**, because Paper Pure is monochrome and earns a
different treatment set (see Colourways). The one-point page difference is incidental; the ink
treatment is the reason.

The template script returns the documented multi-device shape,
`{ variants, activeVariantId }` (`services/generatorTemplates.ts:37,42-54`), which
`validateGeneratedProject` already understands (`:143-147`). `MAX_VARIANTS` is 50, so four is
not close to any limit.

### Why variants cannot share bytes

`Variant` carries its own complete `templates` map (`types.ts:151-155`), and the state cap is
measured on `JSON.stringify`. JSON has no back-references, so two variants holding the same
object in memory serialise as two full copies.

The one mechanism that could have avoided this does not apply: `svgContent` is read raw at both
render sites (`components/canvas/CanvasElement.tsx:461`, `services/pdfService.ts:1165`), and
data binding is text-only (`services/previewText.ts:96` takes
`Pick<TemplateElement, 'text' | 'dataBinding'>`). There is no asset library, symbol table, or
shared-element concept in the schema. Storing each sticker's markup once in shared node data
and binding it into four variants is not possible today.

Four variants therefore cost roughly four times one variant, and the state cap has to
accommodate that directly. See Prerequisite A.

## Inventory

### Structural — 180 stickers × 6 colourways × 3 sizes = 3,240 placements per variant

| # | Category | n | Contents |
|---|---|---:|---|
| 1 | Index tabs & flags | 28 | rounded and notched tabs, ribbon flags, bookmarks, corner triangles, dog-ears, numbered side tabs |
| 2 | Banners & ribbons | 24 | straight banners, tailed ribbons, pennants, scrolls, folded bands, award rosettes |
| 3 | Labels & plates | 22 | tape strips, torn-paper strips, price and luggage tags, sticky notes (square, portrait, lined, torn), speech-bubble labels |
| 4 | Arrows & pointers | 28 | straight, curved, doodle, looping, dashed, block, U-turn, branch, elbow, pointing hand |
| 5 | Boxes, bullets, markers | 24 | empty, checked and crossed boxes, dots, star and arrow bullets, diamonds, progress pips, priority flags |
| 6 | Stars, sparkles, bursts | 22 | 4/5/6/8-point stars, twinkle clusters, starbursts, sunbursts, seals, medals |
| 7 | Dividers, corners, frames | 32 | dotted, dashed, wave and zigzag rules, floral dividers, corner flourishes, bracket pairs, box frames, washi strips |

### Pictorial — 320 stickers × 3 treatments × 2 sizes = 1,920 placements per variant

| # | Category | n | Contents |
|---|---|---:|---|
| 8 | Weather & sky | 24 | sun, clouds, rain, storm, snowflakes, moon phases, rainbow, wind, umbrella |
| 9 | Botanical | 34 | leaves, ferns, branches, flowers, sprigs, mushrooms, acorns, cacti, succulents, trees |
| 10 | Animals | 34 | cats, dogs, birds, butterflies, bee, ladybug, snail, fox, bear, rabbit, whale, fish, owl |
| 11 | Food & drink | 32 | coffee, teapot, water bottle, cake, cupcake, donut, croissant, pizza, fruit, vegetables, ice cream |
| 12 | Faces & moods | 22 | smile, laugh, wink, sad, angry, sleepy, love-eyes, thinking, mood blobs |
| 13 | Study & work | 30 | pencil, brush, ruler, scissors, paperclip, pushpin, notebooks, folder, calendar, clocks, laptop, envelope, gear, bulb, charts |
| 14 | Health & self-care | 26 | hearts, heartbeat, water drop, pill, bandage, dumbbell, running shoe, bicycle, sleep moon, candle, timer |
| 15 | Travel & places | 24 | plane, suitcase, backpack, map pins, compass, globe, camera, ticket, passport, train, tent, mountains |
| 16 | Celebration & seasons | 24 | gifts, balloons, party hat, confetti, fireworks, pumpkin, holly, snowman, ornaments, shamrock |
| 17 | Money & home | 22 | coins, banknote, wallet, piggy bank, receipt, shopping bag, houses, door, lamp, bed, tools |
| 18 | Symbols & misc | 30 | exclamation, question, warning, hourglass, battery, wifi, sync, infinity, hashtag, music notes, dice, puzzle, flame |

**Total: 500 stickers, 5,160 placements per variant, 20,640 across the project.**

## Art style

Bold dark outline around flat fill — the dominant planner-sticker idiom, and the one that
survives e-ink rendering and small crops best, because the outline holds the shape when the
fill greys out. Outline is always `#23292f`.

One path carries both `fill` and `stroke`, so the style costs one element, not two.

## Colourways and treatments

### Colour variants: six colourways (structural)

| Colourway | Fill | Luminance |
|---|---|---:|
| Outline | none (paper) | 255 |
| Amber | `#f0c674` | 201 |
| Green | `#86c08e` | 169 |
| Blue | `#5b93c4` | 136 |
| Red | `#b04a46` | 104 |
| Ink | `#3d4650` | 68 |

Luminance under the exporter's own formula, `y = 0.299r + 0.587g + 0.114b`
(`services/svgColorNormalize.ts:198`, `services/pdfService.ts:600`). Minimum separation between
adjacent fills is 32, and the outline (`#23292f`, luminance 40) stays 28 below the darkest fill.

The separation is retained even though Paper Pure now has its own variant, for two reasons: the
app's own greyscale *export* toggle applies the same desaturation to any variant, and a colour
device rendering in a low-contrast mode benefits equally.

Pale fills are not a compromise — a light fill under a heavy dark outline is the classic sticker
look, and it is also what makes the luminance ladder possible.

### Colour variants: three treatments (pictorial)

- **Natural** — per-sticker authored colours (a leaf is green, a coffee is brown).
- **Mono** — outline only, no fill. This is why the outline style was worth paying for: the mono
  treatment is a genuine second look, not a degraded fallback.
- **Pastel** — natural, lightened.

### The `pure` variant: six ink treatments

Paper Pure is monochrome, so six hues there would be six greys pretending to be colours. The
variant keeps the same six switcher slots and the same sheet structure, substituting ink
treatments for hues:

| Slot | Treatment |
|---|---|
| 1 | Outline only |
| 2 | Light halftone (sparse dot fill) |
| 3 | Medium halftone |
| 4 | Dense halftone |
| 5 | Solid mid-grey `#7a8290` |
| 6 | Solid ink `#3d4650` |

Its pictorial treatments become Outline / Halftone / Solid rather than
Natural / Mono / Pastel.

Halftone fills are emitted as SVG `<pattern>` definitions, which both DOMPurify's SVG profile
and svg2pdf support. One pattern definition per density is declared once per sheet and
referenced by every sticker on it, so the cost is per-sheet, not per-sticker.

### Sizes

| Variant | Structural | Pictorial |
|---|---|---|
| `paper_pro` | L 48 / M 32 / S 20 pt | L 48 / S 24 pt |
| `note_air`, `pure` | L 42 / M 28 / S 18 pt | L 42 / S 21 pt |
| `move` | L 36 / M 24 / S 16 pt | L 36 / S 18 pt |

Wide structural stickers (banners, dividers, rules, tape) use L 192×24 / M 128×16 / S 80×10 on
`paper_pro`, scaled proportionally on the others.

Smaller points on the smaller variants are not a downgrade: at 264 PPI on Move, a 16pt sticker
carries more pixels than a 20pt sticker at 229 PPI on Paper Pro.

## Sheet layout and crop hygiene

The product's whole purpose is that a crop comes out clean. Three rules follow, and they are
requirements, not preferences:

1. **Pure white sheet ground.** A cream or tinted ground would be captured by every screenshot
   and carried into whatever the user pastes into.
2. **No borders or boxes around sticker cells.** A cell border lands inside the crop.
3. **Labels sit in a gutter strip below the artwork**, never touching it, with enough clearance
   that a slightly generous lasso still misses them.

Sheets are organised one per (category, colourway) for structural and one per
(category, treatment) for pictorial. Wide categories (Banners, Dividers) take two sheets per
colourway on `paper_pro` and more on the smaller variants.

Each sticker occupies one **cluster** — its size variants laid out left to right, largest
first, sharing one label. A cluster is the crop unit.

## Navigation

Roughly 1,500 validated links on `paper_pro`, 1,700 on `move`, per variant.

- **Family rail**, top of every sheet. On structural sheets, chips for the 7 structural
  categories; on pictorial sheets, chips for the 11 pictorial categories; plus one chip
  crossing to the other family. `paper_pro`, `note_air` and `pure` carry the full rail — 14
  chips on a structural sheet, 18 on a pictorial one, counting the switcher below. **`move`
  carries a reduced 8-chip rail**: the six switcher chips plus two family arrows. Rail cost
  scales with sheet count, and `move` has 2.3× the sheets.
- **Colourway switcher**, bottom of every sheet. Six chips that jump to *this same sheet* in
  another colourway, via `specific_node`. Two taps from any sticker to the same sticker in any
  colour.
- **A–Z index**, 6 pages, 500 entries, each a `specific_node` link to the sheet its sticker
  lives on.

All links resolve **within** a variant. Nothing links across variants, because a node's page
is resolved per variant and cross-variant navigation is not a concept the schema has.

## Required chrome

The harness requires `root`, `start_here`, `example_workspace` and `blank_workspace`
(`tests/helpers/gallerySampleHarness.ts:24`).

- **Cover** → full-page tap link and a CTA into `start_here`.
- **`start_here`** — how to crop on each device, how the rail and switcher work, what the
  colourways mean, and which variant the reader is in.
- **Contents** — 18 category chips.
- **Colour guide** — the six colourways and three treatments, with the ink-treatment table on
  the `pure` variant instead.
- **`example_workspace`** — two pages: a decorated weekly spread with stickers actually
  applied, then an annotated copy naming which sticker went where. Both carry the `EXAMPLE`
  eyebrow and the `Skip to blank workspace →` link, per the harness's chrome rules
  (`gallerySampleHarness.ts:524-563`).
- **`blank_workspace`** — three undecorated pages to decorate: weekly grid, dot grid, ruled.

The node hierarchy is shared across variants — nodes are project-level, not per-variant — so
this chrome is authored once and each variant supplies its own template for it.

## Generator architecture

500 stickers cannot be 500 string literals — `GENERATOR_SCRIPT_MAX_BYTES` is 512 KiB per script
(`shared/generatorMetadata.js:2`), applied independently to `templateScript` and
`hierarchyScript`. The cap is on source text, not emitted output, so parametric construction
solves it — and it is what makes four variants nearly free in source terms, since all four run
the same builders through a different device profile.

`templates.js` contains, in order:

1. **A `DEVICES` table** — page size, size ladder, rail width and treatment set per variant.
2. **~90 parametric shape builders** — `star(points, innerRatio)`, `tab(style, notch)`,
   `leaf(veins, curl)`, `arrow(curve, head, tail)`, each returning path data for a 24×24
   viewBox.
3. **A 500-entry registry** naming, per sticker, its builder, arguments, natural colours,
   category, and cell aspect (square, wide, tall).
4. **A layout engine** that walks the registry once per device profile, packs clusters into
   sheets, emits templates with rail and switcher chrome, and returns
   `{ variants, activeVariantId: 'paper_pro' }`.

Estimated source: ~185 KB, comfortably inside 512 KiB.

`hierarchy.js` builds the node tree once — cover, guide pages, one node per sheet, the A–Z index
pages, and the example/blank workspaces. **Because every variant must render every node, all
four variants must expose the same template id set**, differing only in geometry and treatment.

## Byte budget

Estimated per variant:

| Component | Count | Bytes each | Total |
|---|---:|---:|---:|
| SVG placements | 4,440 | ~405 (175 element JSON + ~230 markup) | 1.80 MB |
| Primitive placements | 720 | ~190 | 0.14 MB |
| Labels (first sheet per category only) | 500 | ~230 | 0.12 MB |
| Rail and switcher chrome | ~1,000–1,150 | ~250 | 0.25–0.29 MB |
| A–Z index | 500 | ~250 | 0.13 MB |
| Cover, guides, example, blank | — | — | 0.10 MB |
| **Per variant** | | | **~2.4 MB** |

| Variant | Estimate |
|---|---:|
| `paper_pro` | ~2.40 MB |
| `move` | ~2.50 MB |
| `note_air` | ~2.45 MB |
| `pure` | ~2.30 MB |
| **Project total** | **~9.65 MB** |

Against a raised 16 MiB cap that is 58% — deliberate headroom, because every figure here is
arithmetic (see Task 1).

Four economies are load-bearing and belong in the implementation, not left to chance:

- **Tight markup.** `viewBox="0 0 24 24"`, integer coordinates, one path carrying both `fill`
  and `stroke`, no whitespace, 6-digit hex. Hard budget: **230 bytes average, 400 bytes
  maximum** per sticker's markup.
- **Native primitives where they genuinely win.** Only for one-shape stickers — plain boxes,
  dots, thin rules, tape strips, rounded labels: about 40 of the 180 structural stickers. This
  was scoped down during design after checking: a checked checkbox is a `rect` plus two `line`
  elements, three elements at ~570 bytes, *worse* than one 250-byte SVG path. Multi-shape
  stickers stay as SVG.
- **Labels on the first sheet of each category only** — the Ink sheet for structural
  categories, the Natural sheet for pictorial ones. Every other sheet in that category is the
  same grid in the same order, so the label is recoverable by position, and the A–Z index names
  every sticker regardless.
- **Reduced rail on `move`.** At 143 sheets the full 18-chip rail would cost ~0.64 MB against
  the reduced rail's 0.29 MB.

### Storage reality after the IndexedDB round

Local persistence now runs through `services/localWorkspace/`, IndexedDB-backed, with no byte
cap of its own — the adapter surfaces the browser's own `QuotaExceededError` as a typed
`'quota'` error (`services/localWorkspace/indexedDbAdapter.ts:201`). IndexedDB receives the
percentage-of-disk Storage API quotas (roughly 60% of disk on Chromium and WebKit, the lesser of
10% of disk or 10 GiB on Firefox), so a ~10 MB project is not remotely near a local limit.

This replaced a much tighter ceiling. The previous `localStorage` persistence had a fixed
5–10 MiB per-origin cap *and* counted UTF-16 code units, two bytes per character, so a project
cost roughly double its measured UTF-8 size. That is what forced the earlier, abandoned design
of two separate ~2.4 MB products.

Cloud storage is unaffected by the raise: commits are gzipped before storage accounting
(`server/stateCodec.js:9` returns `bytes: gzip.length`), and sticker markup is highly
repetitive, so a full snapshot should compress well past 5:1 — roughly 1.5 MB against the
50 MB default per-user quota (`server/middleware/limits.js:31`). Task 1 measures the real
compression ratio rather than assuming it.

## Prerequisites

### A. Raise `MAX_STATE_BYTES` to 16 MiB

`shared/projectLimits.js:1`, currently `5 * 1024 * 1024`. Four variants need ~9.65 MB and the
5 MiB cap rejects the project at generator Preview, before it can be applied.

This is an **app-wide change**, not a sticker-book one, and it affects three enforcement points
that are independent of each other and of local storage:

| Point | What it protects | Effect of the raise |
|---|---|---|
| `services/validateGeneratedProject.ts:168`, `:310` | generator output sanity, pre-apply | The binding one. Rejects the book today. |
| `services/generatorSandbox.ts:416` | DoS bound compiled into the sandboxed evaluator | A hostile script may allocate up to 16 MiB before being cut. The 10 s timeout (`SANDBOX_TIMEOUT_MS`) and worker isolation remain the primary controls; 16 MiB of transient worker memory is not a meaningful browser DoS. |
| `shared/validateAppState.js:38` | stored and published state | Gzipped before quota accounting; a ~10 MB state is ~1.5 MB stored against a 50 MB quota. |

The sandbox's trusted-intrinsics capture (`generatorSandbox.ts:135-138`) is unaffected — it
guards against the cap being *forged*, whatever the cap is.

Worth doing in the same change: the sandbox bound and the storage bound are now unrelated
concerns sharing one constant, which is why nobody noticed the localStorage mismatch for months.
Splitting them into two named constants with the same value is cheap and makes the next change
safe. Recommended but not required.

### B. Teach the gallery harness about variants

`tests/helpers/gallerySampleHarness.ts` needs three additive changes. This is a genuine
prerequisite: without it, three of four variants ship completely unvalidated.

1. **Validate every variant, not just the active one.** Line 138 currently reads
   `normalized.templates ?? normalized.variants![normalized.activeVariantId!].templates` — it
   discards every non-active variant. Structure, bounds, links and chrome must run per variant.
2. **Page size from the variant, not module constants.** `:28-29` hardcode 509×679, which would
   reject three of the four variants outright.
3. **Scope element-id uniqueness per variant.** The current map is global across all templates
   (`:466-471`). Sibling variants legitimately reuse template *and* element ids — that is what
   makes them the same product — so a global map would report false duplicates on every
   element.

Twenty existing sample suites depend on this helper. All three changes are additive and
single-variant behaviour is unchanged, so no existing suite is touched. `collection.test.ts`
gains the new slug in `EXPECTED_SLUGS`.

## SVG authoring rules

Derived from how the two renderers actually behave; violating any of these fails silently
rather than loudly.

- **Ship `viewBox`, omit root `width`/`height`.** The canvas strips them from the root tag
  (`CanvasElement.tsx:461-465`) and PDF export *adds* them from the element box
  (`pdfService.ts:1182-1183`); shipping explicit ones makes the two disagree.
- **No `hsl()`, `hsla()`, `#rgba`, or `#rrggbbaa`.** svg2pdf's colour parser silently drops
  them — the shape renders stroke-only or vanishes, and 8-digit hex loses its alpha
  (`services/svgColorNormalize.ts:44-69`). 6-digit hex or `rgb()` only.
- **No `<use>`.** DOMPurify's SVG profile does not allow it, so it is stripped on canvas
  (`CanvasElement.tsx:473-476`) while still working in PDF export — a canvas/PDF divergence.
  No `<script>`, `<style>`, `<foreignObject>`, or `on*` handlers either.
- **`<pattern>` and `<defs>` are permitted** by both DOMPurify's SVG profile and svg2pdf, and
  the `pure` variant's halftones depend on them. Task 1 must confirm they survive both renderers
  before the variant is built on them.
- **Avoid overlapping shapes inside a semi-transparent sticker.** Element opacity is baked into
  the tree rather than applied as an outer graphics state (`pdfService.ts:1180`), so crossings
  accumulate alpha. Not expected to bite here — stickers are fully opaque — but recorded.
- **svg2pdf failures are swallowed** with a `console.error` (`pdfService.ts:1192-1194`) and the
  element silently disappears. This is why the test suite parses every `svgContent` rather than
  trusting a visual check.

## Testing

`tests/unit/gallerySamples/stickerPress.test.ts`, through `expectValidGallerySample`, which
after Prerequisite B covers structure, per-variant page size, element bounds, deterministic ids,
link resolution, EXAMPLE chrome, and JSON-clonability across all four variants.

Product-specific assertions on top:

- All four variants expose the identical template id set, so every node renders in every
  variant.
- Every one of the 500 stickers resolves in every colourway or treatment its variant declares.
- All 500 A–Z index entries resolve to an existing sheet node, in every variant.
- Every `svgContent` parses as `image/svg+xml` with no `parsererror`, carries a `viewBox`, and
  has no root `width`/`height`.
- No `hsl(`, `hsla(`, 4- or 8-digit hex, `<use`, `<script`, `<style`, or `<foreignObject`
  anywhere in any `svgContent`.
- Per-sticker markup is within the 400-byte maximum, and the set average is within 230.
- **Greyscale separation:** every pair of structural colourway fills differs by at least 25
  luminance under `0.299r + 0.587g + 0.114b`, and the outline differs from every fill by at
  least 25.
- **State size:** the generated `AppState` serialises to under **12 MiB**, failing the build
  rather than a publish.
- Halftone `<pattern>` definitions are declared once per sheet, not once per sticker.

## Implementation notes

**Task 1 is a measurement spike, not a feature.** Build one category — Botanical, 34 stickers,
3 treatments, 2 sizes — across all four device profiles, then:

1. Generate it and weigh the actual serialised state, to check the ~405 bytes-per-placement
   assumption the whole scope rests on. Extrapolate to 500 and compare against 16 MiB.
2. **Gzip the extrapolated state** and confirm the compression ratio, since cloud quota
   accounting uses compressed size and the ~5:1 assumption is untested.
3. **Render a halftone `<pattern>` sticker through both the canvas and a real PDF export.** The
   `pure` variant depends on patterns surviving DOMPurify *and* svg2pdf. If they do not, that
   variant falls back to stippled paths, which cost materially more bytes — a scope change worth
   discovering at 34 stickers rather than 500.

If the real per-sticker cost lands materially above 405 bytes, the sticker count or the
colourway depth is what gives.

Prerequisites A and B both land before Task 1, since neither the project nor its tests can exist
without them.

## Non-goals

- **No hand-drawn or wobbly style.** Costs roughly 900 bytes per sticker in extra path points,
  which would put the project past 16 MiB.
- **No `palette` config knob.** Colours must be in the exported PDF, not behind a re-run. This
  is the whole reason colourways are baked as separate sheets.
- **No cross-variant navigation.** A node's page resolves per variant; the schema has no concept
  of linking from one variant to another.
- **No animation, gradients, or filters** in sticker markup, despite DOMPurify permitting them —
  they cost bytes and degrade unpredictably through svg2pdf. `<pattern>` is the one exception,
  and only for the `pure` variant's halftones.
- **No raise beyond 16 MiB.** 16 MiB is chosen as ~1.65× the project's need. A larger number
  should be argued on its own evidence, not inherited from this product.

## Open decisions

- **Product name.** "The Sticker Press" is the working title. Alternatives considered: The
  Sticker Drawer, Peel & Paste, The Sheet Press.
- **Exact per-category counts.** The 180/320 split and the per-category numbers above sum to
  500 and are the design target, but individual categories may shift by a few stickers during
  authoring as some ideas prove too detailed to draw within the byte budget. The total and the
  structural/pictorial split are fixed; the per-category distribution is not.
- **Whether to split the sandbox and storage bounds** into two constants during Prerequisite A
  (recommended, not required).
