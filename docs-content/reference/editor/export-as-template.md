---
title: Export as Template
summary: The Export as template segment of the export button (⋯ › Export as template… on touch) renders chosen pages as note templates sized for reMarkable, Supernote, Boox and Bigme e-ink tablets, and downloads them as one zip with install notes.
aliases: e-ink templates, note templates, device templates, remarkable template, supernote template, boox template, bigme template, methods template, png template, export for device
keywords: export, device, devices, e-ink, eink, remarkable, paper pro, supernote, manta, nomad, boox, note air, palma, bigme, template, png, zip, methods, templates.json, mystyle, notetemplate, install, greyscale, conversion report
---

**Export as template** turns pages of your project into the note *templates* an e-ink tablet draws behind your handwriting: one PNG per page at the exact pixel size of each device you pick, in the folder layout that device expects, plus a short INSTALL.txt per model. Everything renders in the browser and arrives as a single `.zip`; nothing is sent to a device for you.

## Opening it

On a computer the export controls at the top bar's right end are a split button: [**Export PDF**](/docs/reference/export-pdf), the **All** half, and a third segment, **Export as template**, with a tablet icon — its tooltip reads "Export templates for e-ink devices". On a [phone or tablet](/docs/reference/editor-on-phones-and-tablets) the **⋯** menu's Export group has an **Export as template…** row between *Export all variants* and *Greyscale export*. Both open the **Export as template** dialog: a centred modal on desktop and tablet, full screen on a phone, where the back gesture closes it.

The export uses the *active* [variant](/docs/reference/variants), as it is when the dialog opens.

## Choosing pages

The **Pages** list shows every page of the active variant grouped by template — groups in the order they first appear, pages in page order. Reference nodes and nodes whose template is missing from the active variant are left out, because the PDF cannot draw them either. A page with no title is listed as *Untitled page*.

Each group starts with its **first page ticked**, so a fresh dialog exports one representative of every template — the usual want for a template library, where a daily page is the same design 365 times. Beyond that:

- A group shows its first three pages; **… N more** expands it.
- **all** and **none** tick or clear one whole group.
- The **Search pages** box filters page titles across every group. `kbd:Escape` in the box clears the search (your ticks stay); `kbd:Escape` with an empty box closes the dialog.

## Choosing devices

The **Devices** section lists models by platform:

| Platform | Models | Pixels (portrait) |
| --- | --- | --- |
| reMarkable | reMarkable 2 · Paper Pro · Paper Pro Move | 1404×1872 · 1620×2160 · 954×1696 |
| Supernote | A5 X / A6 X / Nomad (A6 X2) · Manta (A5 X2) | 1404×1872 · 1920×2560 |
| Boox | Note Air 3 / Nova Air · Note Air 4C / Tab Ultra C Pro · Go 10.3 · Go 7 · Go Color 7 · Note Max · Palma | 1404×1872 · 1860×2480 · 1860×2480 · 1264×1680 · 1264×1680 · 2400×3200 · 824×1648 |
| Bigme | inkNote Color+ / Color Lite · B751c (7″) | 1860×2480 · 1264×1680 |

Each page is scaled to fit that box without distortion and centred on white; a page wider than it is tall is exported landscape, with the width and height swapped.

**Colour.** Models with a colour screen — Paper Pro, Paper Pro Move, Note Air 4C / Tab Ultra C Pro, Go Color 7, inkNote Color+ / Color Lite and B751c — receive colour templates; every other model receives greyscale, converted the same way as the [greyscale export](/docs/reference/greyscale-export). Tick **Force greyscale** to make every model greyscale. The first time, that box starts from the editor's greyscale toggle; after that the dialog remembers your own choice.

**Also include a PDF template** appears once a Supernote, Boox or Bigme model is ticked. It adds the selected pages as one PDF, `<project>.pdf`, beside the PNGs in each of those model folders, in that model's colour mode. Pages keep their own size (the device fits PDF pages itself) and the links from [Linking](/docs/editor/linking) stay live between selected pages; a link to a page you did not select is still drawn, just not linked. reMarkable folders never get a PDF.

Ticked devices, **Force greyscale** and **Also include a PDF template** are remembered in this browser when you press **Export**; the page selection starts fresh each time.

The line above the buttons keeps count — *3 pages × 3 devices = 9 templates (.zip)* — and **Export** stays disabled while it reads *Pick at least one page and one device.* or *Too many files: pick fewer pages or devices.* The cap is **400 images** (pages × devices) per export, which is what a phone browser can build into a zip without running out of memory; split a larger library across two exports.

While it runs the line reads *Preparing pages…*, then *Rendering 37 / 90*, then *Packaging…*. **Cancel** stops between images, downloads nothing and returns you to the picker; closing the dialog cancels too. If nothing could be produced the dialog shows *Export failed:* with the reason and lets you try again.

## What the zip contains

The download is `<project>_device_templates.zip`, with one folder per ticked model:

```
<project>_device_templates.zip
  README.txt                    what is inside, one line per folder
  CONVERSION-REPORT.txt         only when something was simplified or skipped
  reMarkable/<Model>/
    INSTALL.txt                 both install routes, step by step
    png/<page>.png              exact-look templates
    png/templates.json          {"templates":[…]} entries to merge on the tablet
    methods/<stem>.template     Methods templates (plus .metadata and .content)
  Supernote/<Model>/
    INSTALL.txt
    MyStyle/<project>/<page>.png
    MyStyle/<project>/<project>.pdf     optional PDF
  Boox/<Model>/
    INSTALL.txt
    noteTemplate/<page>.png
    noteTemplate/<project>.pdf          optional PDF
  Bigme/<Model>/
    INSTALL.txt
    noteTemplate/<page>.png
    noteTemplate/<project>.pdf          optional PDF
```

`<project>` and `<page>` are the project and page titles made safe for a device's storage: transliterated to ASCII, with `\ / : * ? " < > |` and control characters removed, spaces turned into `_`, and at most 80 characters. Two pages with the same title in one folder become `Day.png` and `Day-2.png`; a title with nothing usable left (or a name Windows reserves, such as `CON`) falls back to `page-<n>`. In the zip, an untitled page is `Page <n>`.

## Installing on a reMarkable

> [!WARNING]
> **Installing on a reMarkable is at your own risk.** reMarkable does not support adding your own templates: both routes log in to the tablet as root over SSH and change its system files. A mistake can stop the tablet's interface from starting, or hide your other templates, until it is put right over SSH or the tablet is factory reset. On a Paper Pro or Paper Pro Move, SSH needs developer mode, and turning it on factory-resets the tablet. Only do this if you are comfortable with a terminal, SSH and scp, and know how to undo each step.

reMarkable has no official way to add templates, so both routes in INSTALL.txt need SSH access to the tablet (or a tool such as RCU). Over USB the tablet is `root@10.11.99.1`; the password is in *Settings › Help › Copyrights and licenses*, under GPLv3 Compliance (on software 3.9 to 3.18: *Settings › Help › About › Copyrights and licenses*).

**Option A — Methods templates** (`methods/`). These `.template` files survive software updates; on a reMarkable 2 they need software 3.17 or later. Copy every file in `methods/` to `/home/root/.local/share/remarkable/xochitl/` and restart the interface (`systemctl restart xochitl`). Each file is a vector *line drawing* of the page rebuilt from the greyscale export: shapes and text become template items, fills become grey shades, and the device draws every line dark — so a page that leans on colour or fine grey lines looks different here than in its PNG. The file's stem includes a hash of its content, so a page you change and export again gets a fresh picker icon instead of the tablet's cached one. A page the format cannot hold — more than 20,000 shapes, or a file over 4 MB — is skipped for Methods, keeps its PNG, and is listed in the report; when that happens to every page of a model, its INSTALL.txt says so and points you to Option B.

**Option B — PNG templates** (`png/`). The exact look of the page, but every software update removes them. On a Paper Pro or Paper Pro Move first make the system folder writable (`mount -o remount,rw /`); then copy `png/*.png` to `/usr/share/remarkable/templates/`, add the entries from `png/templates.json` to the `"templates"` list of `/usr/share/remarkable/templates/templates.json` on the tablet, and restart xochitl. INSTALL.txt spells this out command by command: it downloads the tablet's list, keeps a backup, merges the new entries with `jq` (re-running it replaces rather than duplicates), copies the result back, and says how to restore the backup if anything goes wrong. The new pages then appear in a notebook's Templates picker under *Custom*. Each entry carries the page title as its name, the file name without extension, a stock icon code, the category *Custom*, and `landscape` for landscape pages.

## Installing on Supernote, Boox and Bigme

- **Supernote:** connect by USB, or use Browse & Access, Supernote Partner or Supernote Cloud, and copy the folder `MyStyle/<project>/` into `Note/MyStyle/` on the device. In a note, open *Templates › Customization* and pick a page. A PDF template is picked the same way; its links work when the linked pages are also applied as template pages, and a PDF cannot be the default template for new notes.
- **Boox:** connect by USB or send the files with BOOXDrop, and copy the files in `noteTemplate/` into `Storage/noteTemplate/`. In a note, tap the template icon and open the *Local* tab. PDF templates work on the device but do not sync through BOOX cloud.
- **Bigme:** connect by USB and copy the files in `noteTemplate/` into `Storage/noteTemplate/`. In a note, open the template picker and choose a page from the local templates.

> [!NOTE]
> The reMarkable routes are community-documented (reMarkable publishes none); the Supernote, Boox and Bigme sizes and folders follow the manufacturers' own documentation. If a model you own is not listed, pick the listed model of the same platform with the same pixel size.

## Limits and the conversion report

`CONVERSION-REPORT.txt` is written only when something was not exported exactly, one line per page and device:

- A page that failed to render for one device is **skipped** for that device, with the reason; the rest of the export continues. Only when nothing at all could be produced does the export fail.
- Methods templates that had to be **simplified**: images left out (the format cannot draw images); clipping ignored, so some shapes may extend past their frames; gradient shading or pattern fills left out; light-coloured lines drawn dark; text drawn in the tablet's own font, italic text drawn upright, rotated text drawn horizontally.
- Methods templates **skipped** for size — too many shapes, or a `.template` over 4 MB — where only the PNG is included.

PNG templates are never simplified: they are the same rendering as [Export PDF](/docs/reference/export-pdf), rasterised. See also [Exporting](/docs/editor/variants-svg-json-export#exporting).
