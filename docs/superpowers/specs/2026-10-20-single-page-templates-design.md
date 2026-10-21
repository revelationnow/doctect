# Single-Page Templates — Design

Date: 2026-10-20 · Branch `feat/single-page-templates`

## Goal

Eleven curated, single-page note templates, each its own gallery listing on doctect.app, published
straight to the production database by a script running as the owner's account. Each listing
carries the same page for three device sizes, so a person can export it as a native device
template (the device-template export) or use it as a PDF page.

## Decisions (from the brainstorm)

- **Single page, no links.** One template, one node per project. No navigation chrome, no
  hyperlinks, no example branch. This is deliberately unlike the flagships in `gallery-samples/`.
- **One listing per template.**
- **Three device variants per listing:**

  | Variant id | Name | Size (pt) | Physical | Gallery format facet |
  |---|---|---|---|---|
  | `paper_pro` | reMarkable Paper Pro | 509 × 679 | 179.6 × 239.5 mm | `rm_pp` |
  | `eink_10_3` | reMarkable 2 · Supernote · Boox 10.3″ | 445 × 592 | 157.0 × 208.8 mm | `eink_10_3` |
  | `move` | reMarkable Paper Pro Move | 260 × 463 | 91.7 × 163.3 mm | `rm_pp_move` |

  The Supernote Manta (A5 X2) has no page preset; it is 3:4 like the 10.3″ size and about 3.5%
  larger, so the 10.3″ variant serves it. Adding a Manta preset is a separate code change, out
  of scope. `paper_pro` is the active variant.
- **Built by code, not pasted.** A TypeScript builder in this repo emits each project's
  `AppState` directly. Nothing goes through the Hierarchy Generator, because publishing is
  scripted.
- **Published by script, straight to the database**, through the server's own functions (see
  Publishing). Never raw hand-written SQL for the writes.

## The eleven templates

Names are plain on purpose: they are what people search for. Every page has a small heading
(the template name, left) and, where it fits, a date or month line (right). "Ruled" means a
`lines-h` pattern area; ruling is in millimetres (see Layout rules).

1. **Cornell Notes** — topic + date header; cue column (≈30% width, ≈28% on Move) beside a
   ruled notes area; summary box across the bottom (≈20% height, ≈18% on Move).
2. **Meeting Notes** — meeting, date and attendees lines; Agenda (ruled), Notes (ruled, the
   largest area), Decisions (3 lines); Actions table with Action / Owner / Due columns, 5 rows
   (3 on Move).
3. **Daily Page** (undated) — date line + Mon–Sun weekday row to circle; Top 3 (three checkbox
   lines); hourly schedule 06:00–21:00 with light half-hour lines (07:00–20:00 on Move); to-do
   checklist; dot-grid notes area. Move stacks the sections vertically.
4. **Week on One Page** (undated) — seven day blocks Mon–Sun plus a "This week" focus box.
   Paper Pro and 10.3″: 2 columns × 4 rows. Move: focus box on top, then seven stacked day rows.
5. **Monthly Habit Tracker** — month line; habit-name column; one column per day 1–31 with
   weekend columns lightly shaded. 12 habits on Paper Pro, 10 on 10.3″. Move turns the grid:
   days 1–31 as rows, 5 habit columns.
6. **Family Week Board** — rows Mon–Sun; columns for 4 family members (blank name headers) plus
   an "Everyone" column; a reminders strip along the bottom. Move: 3 member columns, no
   "Everyone" column.
7. **Meal Plan & Grocery List** — 7 days × Breakfast / Lunch / Dinner grid; grocery checklist
   grouped Produce, Dairy & eggs, Meat & fish, Pantry, Other. Paper Pro and 10.3″ place them
   side by side; Move puts the meal grid on top and the groceries below in two columns.
8. **Storyboard** — 16:9 frames, each with shot number, duration and two caption lines.
   6 frames (2 × 3) on Paper Pro and 10.3″; 3 stacked frames on Move.
9. **Isometric Dot Paper** — triangular dot lattice, 5 mm between neighbouring dots, full page
   under a slim heading. The `dots` pattern only draws square lattices, so the lattice is drawn
   another way (an SVG element, or two offset `dots` rects if that reproduces the lattice
   exactly); the implementation plan proves the chosen method renders identically on the
   canvas and in the PDF before building on it.
10. **Chess Score Sheet** — Event, Date, Round, Board, White, Black, Result lines; move table
    with No. / White / Black columns. Paper Pro and 10.3″: moves 1–30 and 31–60 side by side.
    Move: 1–20 and 21–40.
11. **Cycle Tracker** — month line; one row per day 1–31; columns Day, Flow, Pain, Mood,
    Energy, Temp, Notes. Flow, Pain, Mood and Energy cells hold small empty circles to fill or
    tick (shapes, not font glyphs). 10.3″ drops Energy. Move keeps Day, Flow, Mood, Notes.
    Plain logging only: no predictions, fertile-window shading, due dates or health advice
    anywhere on the page or in the listing.

## Layout rules

- **Physical units.** Everything is laid out in millimetres and converted to points
  (1 mm = 72 / 25.4 pt), so a 7 mm rule is 7 mm on every device. Default rule 7 mm; dense
  tables no tighter than 5 mm rows on Paper Pro / 10.3″ and 4.5 mm on Move.
- **Reflow, not shrink.** Each variant gets a layout that is usable at its physical size (the
  per-template notes above). Shared code computes regions; variants differ only in parameters.
- **Margins.** 8 mm sides and bottom, 10 mm top; 6 mm sides on Move.
- **E-ink style.** Greyscale only. Guides in light grey (thin, so ink stands out); headings and
  labels mid grey to near-black; no large dark fills; at most a light tint for shading. One
  heading font and one body font, both verified to embed in the PDF.
- **No glyph risks.** Labels use plain ASCII plus the PDF-safe characters already used by the
  flagships (`–`, `·`); markers such as circles and checkboxes are drawn shapes.

## Gallery listing

- **Name:** the template name above. **Description:** two or three sentences — what the page is
  for, what is on it, which devices it comes sized for.
- **Tags:** six per listing. Every listing carries `template` and `insert` so it lands in the
  gallery's **Note templates** category (`shared/galleryFacets.js`), which exists for exactly this
  and has no listings today; the remaining four are topic words people search for (e.g.
  `cornell`, `meeting`, `habit`, `cycle`). Tag choices are checked against `categorize()` in a
  test so a topic tag never pulls a listing into another category.
- **Previews:** three — the page in each variant (`generateThumbnails(state, [nodeId], variantId)`),
  Paper Pro first.

## Code layout

- `gallery-templates/` — new top-level folder.
  - `lib/` — device table, mm↔pt, element helpers (ruled area, table, checkbox, circle row,
    heading), a `buildProject(spec)` that wraps one template per variant into a single-node
    `AppState` at the current schema version.
  - `templates/NN-slug.ts` — one file per template: listing metadata + a function
    `(device) => elements`.
  - `README.md` — how to build, preview and publish.
  - `out/` — build output (state JSON, previews), git-ignored.
  - `manifest.json` — committed after a production publish: slug → project id, so a re-run
    updates the same listing instead of creating a duplicate.
- `scripts/gallery-templates/` — `build`, `render-previews` (headless Chromium against a local
  vite server, calling the app's own `generateThumbnails`), `publish` (Node, server modules).

## Publishing

1. **Build** every project; each state must pass the server's `validateAppState`, and
   `deriveFacets` must give exactly the three expected format keys and the `templates` category.
2. **Render previews** with the app's own thumbnail code, as the in-app publish does.
3. **Dry run on SQLite.** The publish script runs against a fresh local SQLite database with a
   local test user; the owner reviews the local gallery in a browser.
4. **Pre-flight against Neon, read-only:** find the owner's user row (by their account email),
   count their projects and public projects, and compare with the limits —
   `MAX_PROJECTS_PER_USER` (default 25) and `MAX_PUBLIC_PROJECTS_PER_USER` (default 20). If
   eleven more would exceed either, stop and report; the owner chooses what to do (raise the
   deploy's limits, unpublish or delete old projects, or publish from a separate account). The
   script never skips the limit checks.
5. **Production run, after the owner's explicit go-ahead.** For each template, in one
   transaction per project, mirroring the API routes: allowance checks
   (`assertProjectAllowance`, `assertStorageAllowance`, `assertPublishAllowance`), project row,
   `insertCommit`, publish columns, `project_publications`, `replaceThumbnails`,
   `reindexProject`. Projects listed in `manifest.json` get a new commit and a republish instead.
   The script prints each listing's gallery URL.
6. **Undo** is the normal app path: unpublish or delete from My Projects.

The script reads `DATABASE_URL` from the main checkout's `.env` only for steps 4–5 and only when
invoked with an explicit `--production` flag; without it, it refuses any non-SQLite URL.

## Testing

- Per template, per variant: every element inside the page; no two text elements overlapping;
  rule spacing and row heights within the Layout rules floors; all three variants share the one
  template id; exactly one node.
- Per listing: `validateAppState` passes; facets give the expected formats and the `templates`
  category; six tags; non-empty description.
- Visual check: rendered PNG of each variant reviewed before the SQLite dry run.
- The publish script's create and republish paths tested against SQLite in vitest.

## Out of scope

- Hyperlinked or multi-page templates; a Supernote Manta page preset; any app code change; the
  eleven unpublished flagships; fixing tag typos on existing live listings.
