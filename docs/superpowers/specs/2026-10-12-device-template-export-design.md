# Device template export — design

Date: 2026-10-12
Branch: `feat/device-template-export`
Status: draft, awaiting review

## 1. Intent

Users build planners and notebooks in the editor and want individual pages as **note templates**
on their e-ink tablets: reMarkable, Supernote, Boox and Bigme. A note template is a single page the
device draws behind the user's handwriting.

What the user asked for:

- Export support for these platforms, in formats each device actually accepts.
- When a project has several templates, each with several pages (nodes), the user picks which
  template/page combinations to export.
- Several files are zipped into one download.
- Several platforms can be targeted in one export.
- Entry point next to the existing Export button.
- A new gallery category for templates.

Decisions made while brainstorming (user choices):

| Topic | Decision |
|---|---|
| Device granularity | Specific models, grouped by platform; multi-select across platforms |
| Shape mismatch | Fit: scale the page to fit inside the screen, centred, white margins |
| Link elements | Kept as drawn (same as the PDF); they are decoration in a template |
| reMarkable output | **Both, always**: PNG + `templates.json` fragment (legacy install), and a Methods `.template` set |
| Colour | Per-device default (colour screen keeps colour, B&W screen gets greyscale) + "Force greyscale" override |
| Picker | Pages grouped by template; each template starts with its first page ticked |
| PDF templates | Optional "Also include a PDF template" for Supernote/Boox/Bigme, off by default |
| Gallery | New "Note templates" category, keyword-derived, wins score ties |
| Gallery device export | Out of scope (later, separate step) |

Assumptions (not stated by the user; correct here if wrong):

- The export uses the **active variant**, like Export PDF.
- Nothing is written to the project. No schema change. No server change except the gallery
  category rule.
- Available on desktop, tablet and phone.
- The download is always a zip, even for one page on one device: reMarkable needs its json and
  install guide beside the image, and one shape for every export is simpler to explain.

## 2. Platform facts

Sources were checked on 2026-10-11/12. reMarkable `.template` facts are community reverse
engineering; the user owns rM2, Paper Pro and Paper Pro Move and will verify those (section 9).
Supernote, Boox and Bigme rows are **unverified on device** (no device available) and rest on
manufacturer documentation.

**reMarkable, legacy templates**

- PNG at screen size, plus an entry in `/usr/share/remarkable/templates/templates.json`:
  `name`, `filename` (no extension), `iconCode`, `categories`, optional `landscape`.
- Installed over SSH (or RCU), then `systemctl restart xochitl`.
- Firmware updates wipe them.
- Sources: remarkable.jms1.info/templates; github.com/chrissyhroberts/remarkable_2_and_paper_pro_custom_templates.

**reMarkable, Methods `.template`** (rM2 software ≥ 3.17, Paper Pro)

- Three files share one stem in `/home/root/.local/share/remarkable/xochitl/`:
  - `.content`: `{}`.
  - `.metadata`: `type: "TemplateType"`, `visibleName`, ms timestamps as strings, `parent: ""`,
    `pinned: false`, `source`, `new`.
  - `.template`: `name`, `author`, `iconData` (base64 150×200 SVG), `templateVersion`,
    `formatVersion: 1`, non-empty `categories` and `labels`, `orientation`,
    `supportedScreens`, `constants`, `items`.
- They survive firmware updates. No `templates.json` is involved.
- Item types:
  - `path`: `data` uses only `M`/`L`/`Z`; `C`/`A` blank the whole template. Supports
    `strokeWidth` and `fillColor` (`#RRGGBB`, grey shades work). Strokes always render dark.
    Even-odd holes work.
  - `text`: `text`, `fontSize`, `position{x,y}`, optional `bold`.
  - `group`: `boundingBox`, `children`.
- Every item needs a unique `id`.
- Coordinates:
  - Coordinates are device template-canvas pixels. The device supplies the constants
    `templateWidth` and `templateHeight`, and expressions may use them.
  - The rM2 draws the canvas rotated 90° relative to the Paper Pro.
- The device caches the picker icon by file stem.
- Sources: spacepanda.se/articles/rm_methods.html;
  github.com/Martes-Delta-Co/Remarkable-Mobile-Prototyping-Templates (docs/methods-format-notes.md).

**Supernote**

- Images: PNG/JPG/JPEG/WEBP in `Note/MyStyle`; subfolders work.
- Recommended size is 1404×1872 (Manta native 1920×2560). Since Chauvet 2.10.25 any size is
  accepted; the device scales proportionally and centres the image.
- PDFs in MyStyle work as templates (since Chauvet 2.9.24). Links stay live when the linked-to
  pages are also applied as template pages. A PDF cannot be the default template.
- Sources: support.supernote.com (Layers and Templates; A5 X & A6 X changelog; custom template FAQ).

**Boox**

- PNG (best) or PDF in `Storage/noteTemplate`; cloud sync does not carry PDF templates.
- Source: onyxboox.medium.com "Uncovering Hacks of Note-taking Templates for BOOX".

**Bigme**

- PNG or PDF in `Storage/noteTemplate`.
- Source: ewritable.net Bigme firmware 5.7 and inkNote Color+ pages.

## 3. Device profiles

`services/deviceExport/deviceProfiles.ts` is a plain data table. Each row:

| Field | Meaning |
|---|---|
| `id` | Stable key, e.g. `rm2`, `supernote_manta` (used in storage, analytics, folder names) |
| `platform` | `remarkable` \| `supernote` \| `boox` \| `bigme` |
| `name` | Display name |
| `width`, `height` | Portrait pixel size the PNG is rendered at |
| `colour` | `true` for colour screens (default keeps colour) |
| `outputs` | Which files this model gets (see section 6) |
| `remarkableScreen` | Methods `supportedScreens` value (reMarkable rows only) |
| `rotateMethods` | `true` where the Methods canvas is rotated (rM2) |
| `source` | URL the size came from |
| `verified` | `'device'` once checked on hardware, else `'docs'` |

Initial rows (sizes marked † are re-checked against the manufacturer spec page during
implementation, and the row's `source` is filled in then):

| Platform | Model | Pixels (portrait) | Colour |
|---|---|---|---|
| reMarkable | reMarkable 2 | 1404×1872 | no |
| reMarkable | Paper Pro | 1620×2160 | yes |
| reMarkable | Paper Pro Move | 954×1696 † | yes |
| Supernote | A5 X / A6 X / Nomad (A6 X2) | 1404×1872 | no |
| Supernote | Manta (A5 X2) | 1920×2560 | no |
| Boox | Note Air 3 / Nova Air | 1404×1872 † | no |
| Boox | Note Air 4C / Tab Ultra C Pro | 1860×2480 † | yes |
| Boox | Go 10.3 | 1860×2480 † | no |
| Boox | Go 7 / Go Color 7 | 1264×1680 † | no / yes (two rows) |
| Boox | Note Max | 2400×3200 † | no |
| Boox | Palma | 824×1648 † | no |
| Bigme | inkNote Color+ / inkNote Color Lite | 1860×2480 † | yes |
| Bigme | B751c (7.8″) | 1404×1872 † | yes |

**Orientation.** A page wider than it is tall is exported landscape: the profile's width and
height are swapped for that page. The reMarkable legacy entry then gets `landscape: true`, and
the Methods file gets `orientation: "landscape"`.

## 4. User experience

**Entry points**

- Desktop:
  - The export split button (`Export PDF` | `All`) in `components/ProjectEditor.tsx` gains a
    third segment, "Devices", with a tablet icon and the title "Export templates for e-ink
    devices".
  - This is a deliberate desktop UI change. If a desktop snapshot covers the header, the user is
    asked before that snapshot is updated.
- Phone and tablet:
  - The overflow menu's Export group (`components/editor-layout/OverflowMenu.tsx`) gains
    "Export for device…", between "Export all variants" and "Greyscale export".
  - It goes through a new `TouchEditorActions.exportForDevice`.

**Dialog** (`components/export/DeviceExportDialog.tsx`): a modal on desktop; full screen on
phone, with `useBackDismiss` and `trapTab` like the other touch overlays.

```
Export for device

Pages            [search........]
[-] Daily (365)        all · none
    [x] Jan 1
    [ ] Jan 2
    [ ] Jan 3   … 362 more
[x] Month index (1)
[-] Weekly (52)        all · none
    [x] Week 1
    [ ] Week 2  …

Devices
reMarkable  [x] rM2 [x] Paper Pro [ ] Move
Supernote   [ ] A5 X / A6 X / Nomad [x] Manta
Boox        [ ] Note Air 4C [ ] Go 10.3 …
Bigme       [ ] inkNote Color+ …
[ ] Force greyscale
[ ] Also include a PDF template   (shown only when a Supernote/Boox/Bigme model is ticked)

3 pages × 3 devices = 9 templates (.zip)
                 [Cancel] [Export]
```

**Page groups** (`services/deviceExport/selection.ts`)

- Built from `computePageOrder` on the active variant.
- Reference nodes and nodes without a template in the active variant are excluded.
- Groups are ordered by first appearance; pages keep page order.
- Each group starts with its first page ticked.

**Long groups**

- A group's row list is collapsed beyond its first 3 pages ("… N more" expands it).
- Search filters page titles across all groups.
- "all" and "none" act on one group.

**Counting and limits**

- The count line counts images: pages × ticked devices. The reMarkable Methods files ride with
  each reMarkable PNG.
- Export is disabled with no page, no device, or more than **400** images. Above the limit the
  message reads "Too many files: pick fewer pages or devices."

**Remembered settings**

- Ticked devices, "Force greyscale" and "Also include a PDF template" are remembered in this
  browser through `services/browserPreferences.ts`, with a new fixed key.
- "Force greyscale" starts from the editor's greyscale-export toggle the first time.

**Progress**

- The dialog shows "Preparing pages…", then "Rendering 37 / 90", with Cancel.
- Cancel is checked between images; nothing downloads.

## 5. Rendering pipeline

Everything runs in the browser.

### 5.1 Subset PDF

`generatePDF` (`services/pdfService.ts`) gains an option `pageNodeIds?: string[]`.

- When set, only those pages are drawn, in that order.
- The internal page map is built from that list, so a link between two selected pages points to
  the right page of the subset PDF.
- A link to an unselected page gets no link annotation. Its element is still drawn, which follows
  "kept as drawn".
- Font loading is unchanged.

The export generates at most two subset PDFs: one in colour, if any ticked device keeps colour,
and one greyscale (`isGreyscale: true`), if any device needs greyscale or the Methods output is
produced.

### 5.2 PNG (`rasterize.ts`)

For each selected page and each ticked device:

1. Open the matching subset PDF page in pdf.js (worker setup as in `thumbnailService.ts`).
2. Target box: the profile size, swapped for landscape pages.
3. Scale = min(boxW / pageW, boxH / pageH). Render the page at that scale onto a canvas of
   exactly the box size, filled white, centred.
4. `canvas.toBlob('image/png')`, add it to the zip, then release the canvas (width and height set
   to 0).

### 5.3 PDF template (optional)

When "Also include a PDF template" is ticked, each ticked Supernote/Boox/Bigme model folder gets
one PDF: the subset PDF in that model's colour mode.

- Pages keep their own size; the devices fit PDF pages themselves.
- Links between selected pages stay live.

### 5.4 Methods `.template` (`remarkableTemplate.ts`)

The input is the greyscale subset PDF page, read through pdf.js `getOperatorList()` and
`getTextContent()`. No layout logic is duplicated: grids, data bindings, text wrapping, borders,
patterns and SVG elements (already turned into vector paths by svg2pdf) arrive as drawing
operations.

**Graphics state.** The converter tracks save/restore and the transform (`cm`), and maps every
point into page space (origin top-left, PDF points).

**Paths**

- Moves, lines, rectangles and closes map to `M`/`L`/`Z`.
- Bézier curves are flattened to line segments, with a tolerance of 0.25 pt.

**Fills**

- Fills become `fillColor`: the PDF fill colour converted to grey hex.
- Fill alpha is pre-blended with white.
- Even-odd fills keep their sub-paths together in one item.

**Strokes**

- Strokes become `strokeWidth`: the line width scaled by the transform and the device scale.
- Stroke colour is dropped (always dark on the device). A stroke lighter than 50% grey is listed
  in the report.
- A dash pattern is applied by splitting the path into separate `M`/`L` segments.

**Merging.** Consecutive drawing operations with identical style become one item with several
sub-paths.

**Text**

- Each text run from `getTextContent` becomes a `text` item at its baseline position, with
  `fontSize` from the transform.
- `bold: true` is set when the run's font name contains "Bold" (best effort).
- Font family, italic, colour and rotation are not representable and are listed in the report.

**Not representable**

- Images are dropped and listed in the report.
- Clip paths are ignored; pages that use them are listed.
- Shading operations are dropped and listed.

**Coordinates**

- Constants:
  - `{"s": "templateWidth / W"}` or `{"s": "templateHeight / H"}`, picking whichever axis limits
    the fit for that model's aspect ratio, so the page fits like the PNG;
  - `{"ox": "(templateWidth - W * s) / 2"}`;
  - `{"oy": "(templateHeight - H * s) / 2"}`.
- Each point is emitted as `"<x> * s + ox"` and `"<y> * s + oy"`, with numbers rounded to 0.01.
- For `rotateMethods` models (rM2), points are pre-rotated 90° clockwise in page space before
  emission, and W and H are swapped. The rotation is one function, `rotateForCanvas`, so if the
  device shows it the wrong way the fix is one line.

**Files**

- One set per page and reMarkable model: stem `doctect-<project-slug>-<page-slug>-<model>-<hash8>`.
- `hash8` is the first 8 hex characters of SHA-256 over the `.template` JSON. A changed page
  therefore gets a new stem and a fresh picker icon.
- `supportedScreens` holds the model's screen code. `categories` is `["Custom"]` and `labels` is
  `[<project name>]`.
- `iconData` is a 150×200 SVG drawn from the same paths, scaled; curves are allowed in the icon.

**Size guard.** A page whose `.template` exceeds 20,000 items or 4 MB is skipped for Methods,
keeps its PNG, and is listed in the report.

## 6. Zip layout (`bundle.ts`)

```
<project-slug>_device_templates.zip
  README.txt                      what is inside, one line per folder
  CONVERSION-REPORT.txt           only when something was approximated, dropped or skipped
  reMarkable/<Model>/
    INSTALL.txt                   both install routes, step by step
    png/<page>.png
    png/templates.json            {"templates":[…]} fragment to merge
    methods/<stem>.template
    methods/<stem>.metadata
    methods/<stem>.content
  Supernote/<Model>/
    INSTALL.txt                   copy MyStyle/<project>/ into Note/MyStyle on the device
    MyStyle/<project-slug>/<page>.png
    MyStyle/<project-slug>/<project-slug>.pdf     (optional PDF)
  Boox/<Model>/
    INSTALL.txt                   copy into Storage/noteTemplate
    noteTemplate/<page>.png
    noteTemplate/<project-slug>.pdf               (optional PDF)
  Bigme/<Model>/
    INSTALL.txt
    noteTemplate/<page>.png
    noteTemplate/<project-slug>.pdf               (optional PDF)
```

**File names**

- Page title, transliterated to ASCII, with `\ / : * ? " < > |` and control characters removed,
  spaces collapsed to `_`, and at most 80 characters.
- Duplicates within a folder get `-2`, `-3`.
- An empty result falls back to `page-<n>`.

**Legacy `templates.json` entries**

- `name`: the page title.
- `filename`: `<page>`, without extension.
- `iconCode`: a stock code (chosen during implementation from a stock `templates.json`, then
  verified on device).
- `categories`: `["Custom"]`.
- `landscape`: set for landscape pages.

The zip is built with JSZip (already a dependency), using STORE for PNG and PDF and DEFLATE for
text. It downloads through `downloadBlob` in `services/browserDownload.ts`.

## 7. Errors

- **Font fetch failure:** handled inside `generatePDF`, which falls back to the built-in font.
- **One page fails for one device** (render, toBlob or Methods conversion): it is skipped, the
  failure is listed in `CONVERSION-REPORT.txt`, and the rest continue.
- **Nothing produced, or PDF generation itself fails:** the dialog shows "Export failed:
  <message>", Export can be retried, and nothing downloads.
- **Cancel:** the job stops between images, canvases and the zip are released, and nothing
  downloads.
- **Analytics:** one `device_templates_exported` event with `{ pageCount, deviceIds, imageCount,
  forcedGreyscale, includePdf, failures }`. No titles or content.

## 8. Gallery category

In `shared/galleryFacets.js`:

- Add `{ key: 'templates', label: 'Note templates', emoji: '📄', keywords: ['template',
  'background', 'paper', 'ruled', 'lined', 'dot-grid', 'graph-paper', 'stationery', 'insert'] }`
  as the **first** entry of `CATEGORIES`, so it wins score ties.
- Bump `INDEX_VERSION` from 1 to 2. The startup sweep then re-derives every published project's
  category from the untouched published data. No project, commit or `published_*` column is
  written.

Expected effect: a project named "Weekly Planner Template" (name scores 1:1) moves from Planners
to Note templates. A project tagged `planner, weekly` with "template" only in its name stays in
Planners (4:1).

Tests:

- The keyword-uniqueness test covers the new keywords.
- New cases cover the tie and non-tie examples above.

## 9. Testing

**Unit (vitest)**

- `deviceProfiles`:
  - every row has a positive integer size, portrait (`height ≥ width`), a known platform, and a
    `source`;
  - reMarkable rows have a `remarkableScreen`;
  - ids are unique.
- `selection`:
  - grouping, ordering, and exclusion of references and template-less nodes;
  - first-page default ticks, search, all and none;
  - counts and the 400 cap.
- Fit math:
  - portrait, landscape and mismatched aspect;
  - landscape swap.
- File names: sanitising, de-duplication, fallback.
- `bundle` with a fake rasteriser:
  - folder layout per platform;
  - optional PDF present or absent;
  - report only when needed;
  - `templates.json` fragment shape.
- `remarkableTemplate`, fed recorded operator lists and text content:
  - lines and rectangles become `M`/`L`/`Z`;
  - curves are flattened within tolerance;
  - dashes are split;
  - alpha is pre-blended;
  - even-odd sub-paths stay together;
  - merging works;
  - text items, including bold;
  - images and clips are reported;
  - rM2 rotation;
  - the size guard;
  - the stem hash changes with content;
  - the required fields are present (`formatVersion: 1`, non-empty `categories` and `labels`).
- `generatePDF({ pageNodeIds })`:
  - only the selected pages, in order;
  - a link between selected pages targets the right subset page;
  - a link to an unselected page has no annotation but its element is drawn.
- Gallery: categorize cases from section 8; `INDEX_VERSION` is 2.

**Component tests** (`DeviceExportDialog`)

- Default ticks, group all/none, collapse and expand, search.
- Count line and cap message.
- PDF checkbox shown only for Supernote/Boox/Bigme.
- Greyscale override, and remembered settings with storage throwing.
- Cancel; phone back gesture closes the dialog.

**End-to-end** (Playwright, chromium desktop and the mobile project)

- Open the entry point, pick 2 pages and 3 devices across platforms, export, and read the
  downloaded zip in the test.
- Check that the folder layout matches section 6.
- Check that each PNG's pixel size (from its header) matches its profile.
- Check that the `.template` JSON parses with required fields and only `M`/`L`/`Z` in path data.

**Device checklist** (user, on rM2, Paper Pro and Paper Pro Move; results recorded here before
merge)

1. Legacy PNG route: install per INSTALL.txt; the template appears in the picker and fills the
   screen; the landscape flag works.
2. Methods route: copy `methods/` files and restart; the template appears and is drawn upright on
   all three devices. Record the correct rM2 rotation direction.
3. Paper Pro Move's `supportedScreens` code. The candidate is read from a stock Methods template
   on the Move (`grep supportedScreens` in xochitl); record the value.
4. Methods fidelity on one grid page and one text-heavy page: line weights, grey fills, text size
   and position against the PNG.
5. Picker responsiveness with the largest exported page (item count noted).
6. Whether Paper Pro shows colour `fillColor` values. This is informational: v1 emits grey.

Supernote, Boox and Bigme stay `verified: 'docs'`.

## 10. Out of scope

- Device export from the gallery detail page (planned later, separately).
- Kindle Scribe (no custom template support) and a free-form custom pixel size.
- Colour fills in Methods templates (pending checklist item 6).
- Pushing files to devices or their clouds; editing the device's `templates.json` for the user.
- Changes to the existing Export PDF behaviour.

## 11. Units and boundaries

| Unit | Depends on | Used by |
|---|---|---|
| `deviceProfiles.ts` | nothing | dialog, rasterize, bundle |
| `selection.ts` | `computePageOrder`, `AppState` types | dialog |
| `generatePDF` `pageNodeIds` option | existing PDF code | export job |
| `rasterize.ts` | pdf.js, profiles | export job |
| `remarkableTemplate.ts` | pdf.js page API (operator list, text content) | export job |
| `bundle.ts` | JSZip, file-name helper | export job |
| `exportJob.ts` | all of the above; abort signal; progress callback | dialog |
| `DeviceExportDialog.tsx` | selection, profiles, preferences, exportJob | ProjectEditor, OverflowMenu |

The pdf.js operator codes come from the installed `pdfjs-dist` (5.4.624, pinned in
`package.json`). `remarkableTemplate.ts` reads them through `pdfjsLib.OPS`, and a unit test fails
if the path-construction argument shape it relies on changes.
