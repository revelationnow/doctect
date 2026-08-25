# The Sticker Press — revised design: sourced artwork

**Date:** 2026-08-24
**Supersedes:** the artwork sections of `2026-08-12-sticker-press-design.md`
**Status:** design, pending approval
**Slot:** `gallery-samples/21-sticker-press/`

## Why this revision exists

The original design had the project draw all 500 stickers itself, as parametric SVG path
builders. Sixty builders were written and 220 argument cases were passing every test in the
suite. A rendered contact sheet — the first one anybody produced — showed the artwork was not
good enough to ship, for two separate reasons.

**A systemic bug.** `svgMarkup(pathData, fill, stroke)` emits one path carrying one fill and
one stroke. The arrow builders drew shafts as *open* subpaths intending them as lines, and SVG
implicitly closes open subpaths for filling — so all 28 arrow stickers rendered as amorphous
filled blobs. The same mechanism damaged `hand`, `rule('dotted')` and `rule('dashed')`.

**Craft.** `succulent` rendered as a star, `snail` as a balloon, `tree('palm')` as a spider,
`cactus(0)` as a plain green rectangle. `bookmark(false)`, `flag('straight')`, `tape(false)`
and `banner(false,false)` were all the same plain rectangle. `tab('rounded')` had no rounding.

The process lesson is recorded here because it shaped this revision: **the test suite checked
bytes, bounds, determinism and winding directions, none of which can see an unrecognisable
drawing.** Green tests carried the work forward for three tasks past the point where a single
rendered page would have stopped it.

## What changes

Artwork comes from established icon sets instead of being drawn here. The product becomes a
**curation, layout and navigation** exercise rather than an illustration one, and it must say
so plainly in its README and gallery listing.

## Sources and licences

Two sources, and both of them are attributed — including the permissive one.

| Source | Count | Licence | Attribution required? |
|---|---:|---|---|
| **Lucide** | 2,034 icons (1,776 tagged) | ISC **and** MIT | Yes — both notices |
| **Twemoji** | 3,720 emoji | Graphics CC-BY 4.0 | Yes |

**UPDATE, post-implementation:** the house furniture band described below (index tabs, banners,
ribbons, washi tape, pennants, rosettes, bookmarks) was cut entirely during a human design
review — see "House furniture stays..." further down, now superseded. Every one of the 500
shipped stickers is sourced artwork; there is no house-drawn content in the final product.

**Lucide's licence has two parts and both must ship.** ISC, copyright 2026 Lucide Icons and
Contributors, covers the set; MIT, copyright 2013-present Cole Bemis, covers roughly 115 icons
derived from the Feather project, which Lucide's `LICENSE` lists by name. Reproducing that one
file whole satisfies both.

**Twemoji's graphics are CC-BY 4.0, not MIT.** The npm package `@twemoji/svg` declares MIT, but
it is a third-party repackage, and a repackager cannot relicense another party's artwork. The
official project ships `LICENSE-GRAPHICS` (CC-BY 4.0) alongside `LICENSE` (MIT, code only).
`1f431.svg` from the official `jdecked/twemoji` repository was compared byte-for-byte against
the repackage and is identical, so the artwork is authentic — but it is sourced upstream and
the real licence is honoured. Attribution is to **"Twitter, Inc and other contributors"**;
there is no individual artist, it is a collective work. Their README explicitly accepts a
mention in a README, About section, or footer.

**SUPERSEDED — house furniture was cut, not kept.** This section originally argued for keeping
index tabs, banners, ribbons, washi tape, pennants, rosettes and bookmarks as house-drawn
"sticker furniture" since no icon set supplies them, reused minus whatever the contact sheet
showed as a plain rectangle or a failed silhouette. A later human design review killed the whole
band anyway: three near-identical scalloped seals, three rosettes differing only in petal count,
and a "medal disc" that was a plain circle. Nothing house-drawn shipped in the final product —
see the corrected inventory below.

## Inventory — 500 stickers

| Band | n | Source | Colourways | Sizes |
|---|---:|---|---|---|
| Marks & symbols | 330 | Lucide | 6 | 2 |
| Picture stickers | 170 | Twemoji | 1 (full colour) | 2 |

Twemoji is deliberately not recoloured. Recolouring a picture of a cat is not a thing sticker
books do, and the artwork is multi-colour by design.

**SUPERSEDED counts.** The original plan had eighteen categories with three furniture-sourced
ones (Index tabs & flags, Banners & ribbons, Labels & tape). With furniture cut, Banners &
ribbons was folded into Labels & tape rather than padded out with near-duplicate Lucide/Twemoji
ribbon icons — the curator verified only one Lucide ribbon icon and two Twemoji ribbon emoji
exist in total. The real, shipped breakdown is seventeen categories, read directly off
`registry.json` and a real four-variant build (matches the README's table exactly):

| Category | n | Lucide | Twemoji |
|---|---:|---:|---:|
| Index tabs & flags | 15 | 9 | 6 |
| Labels & tape | 17 | 10 | 7 |
| Arrows & pointers | 36 | 36 | 0 |
| Boxes, bullets, markers | 33 | 33 | 0 |
| Stars, sparkles, awards | 27 | 27 | 0 |
| Dividers, corners, frames | 27 | 27 | 0 |
| Weather & sky | 28 | 15 | 13 |
| Botanical | 23 | 12 | 11 |
| Animals | 34 | 0 | 34 |
| Food & drink | 37 | 9 | 28 |
| Faces & moods | 24 | 0 | 24 |
| Study & work | 43 | 43 | 0 |
| Health & self-care | 30 | 21 | 9 |
| Travel & places | 31 | 19 | 12 |
| Celebration & seasons | 27 | 8 | 19 |
| Money & home | 38 | 36 | 2 |
| Symbols & misc | 30 | 25 | 5 |

Botanical landed at 23, not the 30 this plan originally called for: a genuine supply shortage,
not a shortfall to fix — most plant/flower emoji exceed the per-icon byte cap and Lucide's
botanical range is shallow. The user accepted 23 rather than padding it with off-subject or
over-cap icons.

## The binding constraint has moved

State size is no longer what limits this product; the **512 KiB per-script cap**
(`shared/generatorMetadata.js:2`) is, because the artwork now lives verbatim in the source.

Measured, minified to drawable children with whitespace collapsed:

| Source | Mean | Max | Note |
|---|---:|---:|---|
| Lucide (300 sampled) | **165 B** | 691 B | compact, stroke-based |
| Twemoji (300 sampled) | **2,200 B** | 26,088 B | full colour, multi-path |

An earlier 12-icon sample put Twemoji at 1,050 B. That sample was unrepresentative; the real
mean is more than double it. **Twemoji is therefore curated by complexity as well as by
subject:** of 3,720 emoji, 1,645 are under 1,500 bytes, which is a large enough pool to pick
150 good ones from — and the simpler emoji tend to be the bolder, more legible stickers anyway.

Projected script budget (pre-implementation estimate — furniture was cut before this shipped and
the real numbers ended up materially different; templates.js measures 479.4 KiB and the real
per-variant state is 24.35 MiB, see `tests/unit/gallerySamples/stickerPress.test.ts`):

| Component | Calculation | Bytes |
|---|---|---:|
| Furniture path data | 50 × ~200 B | 10 KB |
| Lucide markup | 300 × 165 B | 50 KB |
| Twemoji markup | 150 × ≤1,500 B | ≤225 KB |
| Registry, layout engine, chrome | — | ~50 KB |
| **templates.js total** | | **~335 KB of 512 KiB** |

Projected state, per device variant:

| Band | Placements | Bytes each | Total |
|---|---:|---:|---:|
| Furniture 50 × 6 × 3 | 900 | ~375 | 0.34 MB |
| Lucide 300 × 6 × 2 | 3,600 | ~340 | 1.22 MB |
| Twemoji 150 × 1 × 2 | 300 | ~1,375 | 0.41 MB |
| Chrome, labels, index | — | — | ~0.35 MB |
| **Per variant** | **4,800** | | **~2.3 MB** |
| **Four variants** | | | **~9.2 MB of 16 MiB** |

## Importing third-party SVG — the rules that make it work

**Root presentation attributes must be flattened onto children.** Lucide (and Tabler) declare
`fill="none" stroke="currentColor" stroke-width="2"` on the root `<svg>` and let children
inherit. **svg2pdf does not implement that inheritance**, so children fall back to solid black
— which is what made the first comparison render come out as black blobs. The importer walks
every drawable child (`path, circle, ellipse, rect, line, polyline, polygon, g`) and copies
down any of `fill, stroke, stroke-width, stroke-linecap, stroke-linejoin, stroke-miterlimit`
the child does not already carry.

**Never `setAttribute('xmlns', …)` after stripping root attributes.** The serializer emits the
namespace itself; setting it by hand produces a document svg2pdf silently refuses to draw, with
no error beyond the swallowed `console.error` at `services/pdfService.ts:1192-1194`. This cost
one entirely blank render to diagnose.

**`currentColor` is resolved at import.** For Lucide this is the recolouring mechanism: one
stroke colour per icon means a colourway is a single string substitution.

The existing SVG rules still bind: ship `viewBox`, omit root `width`/`height`; 6-digit hex or
`rgb()` only, never `hsl()` or 4/8-digit hex; no `<use>`, `<script>`, `<style>`,
`<foreignObject>` or `on*` handlers. Twemoji uses a `0 0 36 36` viewBox and Lucide `0 0 24 24`;
both are honoured as-is rather than normalised.

## Vendoring

A committed build script (`gallery-samples/21-sticker-press/vendor/build.mjs`) fetches the
chosen subset from upstream, minifies it, and writes:

- `vendor/lucide/` and `vendor/twemoji/` — only the icons the registry names
- `vendor/LICENSE-lucide` and `vendor/LICENSE-twemoji-graphics` — verbatim upstream files
- `vendor/manifest.json` — icon id, source, upstream path, byte size, and the licence it falls
  under, so the credits page and the tests are generated from one record rather than restated

Vendoring rather than depending on npm at generate time keeps the generator scripts
self-contained, which the sandbox requires — it has no network and no module loader.

## Navigation

This is now the substance of the product, not chrome around it. Four mechanisms.

**Category rail**, top of every sheet: seventeen category chips (eighteen in the original plan,
before Banners & ribbons was folded into Labels & tape), plus the current category shown as a
title. Reduced to a scrolling subset on the `move` variant, whose page is too narrow.

**Colourway switcher**, bottom of every sheet that has colourways — Lucide bands only, since
furniture was cut and Twemoji is never recoloured. Six chips jumping to the same sheet in
another colourway via `specific_node`. Twemoji sheets show a "full colour" note in that strip
instead, so the layout does not jump.

**A–Z index**, 6 pages (this plan projected ~8; the real page count is read live off the built
product, not hand-maintained): every one of the 500 stickers by name, alphabetically, each a
`specific_node` link to its sheet. Two columns per page.

**Keyword index**, 21 pages (this plan projected ~6; the real count is much larger — every
keyword a sticker carries gets its own index row, and most stickers carry several): this is what
Lucide's `tags.json` buys — 1,776 of its icons carry
search aliases, so "bin" finds `trash`, "hoover" finds `vacuum`. Keywords are grouped
alphabetically with the sticker names they point to. Twemoji entries get hand-written keywords
in the registry, since no equivalent tag file ships with them.

**Credits page**, reachable from every sheet's footer and from the contents page: the three
attributions in full, with the licence names and upstream URLs, generated from
`vendor/manifest.json` so it cannot drift from what is actually vendored.

## Required chrome

`root` (cover), `start_here`, `example_workspace` (+ its annotated second page),
`blank_workspace` (+ dot-grid and ruled pages), contents, colour guide, credits, the A–Z index
and the keyword index. The EXAMPLE chrome rules from the harness apply unchanged: every node in
the `example_workspace` subtree binds `example_label` = `EXAMPLE` and `skip_label` =
`Skip to blank workspace →` with a visible `specific_node` link to `blank_workspace`.

## Testing

Everything the previous plan established still applies — the variant-aware harness, the byte
budget, the state-size ceiling, the SVG hygiene assertions. Three additions specific to this
revision:

- **Vendor integrity**: every icon named by the registry exists in `vendor/`, every vendored
  icon is named by the registry (no orphans), and each one's recorded byte size matches the
  file. Both licence files are present and non-empty.
- **Attribution completeness**: for every source that contributes at least one sticker, the
  credits page contains its required notice. A test that fails if a source is used but not
  credited is the only thing that makes the licence obligation structural rather than
  remembered.
- **A rendered contact sheet, mandatory, human-reviewed.** Every task that touches artwork ends
  by producing a PDF of what it changed, at 56pt and at the smallest tier, and no artwork task
  is complete until that PDF has been looked at. This is the gate whose absence let 220 green
  tests carry unusable drawings through three tasks.

## Non-goals

- **No recolouring of Twemoji.** Multi-colour by design; recolouring a picture is not a sticker
  book idiom.
- **No further hand-drawn pictorial artwork.** There is no house-drawn content at all in the
  shipped product — the furniture band this section originally scoped as the one exception was
  cut entirely during a later human design review (see the superseded note earlier in this
  document). Every one of the 500 stickers is sourced.
- **No npm dependency at generate time.** The sandbox has no network and no module loader; the
  artwork is vendored into the repository.
- **No claim of original artwork.** The README and gallery listing describe this as a curated,
  categorised, navigable collection built on open icon sets, and name them.

## Open decisions

- **Product name.** "The Sticker Press" remains the working title.
- **Per-category counts** sum to 500 and are the target; individual categories may shift by a
  few as curation meets what the sets actually contain. The 50/300/150 band split is fixed.
