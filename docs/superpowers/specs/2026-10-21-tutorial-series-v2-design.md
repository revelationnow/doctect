# Tutorial Video Series v2 — Design

**Date:** 2026-10-21
**Status:** Approved by the requester ("create a plan and then execute on that"); supersedes
`2026-07-10-tutorial-video-series-design.md`.

## Goal

A narrated, screen-recorded tutorial series that takes a viewer from "what is this?" to the
most intricate parts of PDF Architect: simple projects first, then the machinery (grids,
links, layers), then the nuanced mechanics (dynamic offsets, traversal paths, references and
referrer formulas, variants, the generator), then sharing and collaboration. Every episode
ships with a clear written description, chapters, captions, and a transcript, and its voice
over should sound like a person demoing their own tool, not a synthesizer reading a manual.

## Why a v2

The July pipeline (`tutorial/`) produced five episodes against a UI that has since changed
substantially (IndexedDB workspace, gallery tabs, narrow layouts, export split button, …).
Re-running it today also fails for environmental reasons that v2 fixes at the source:

| Problem found | v2 fix |
|---|---|
| `tutorial/lib/servers.js` never set `VITE_API_BASE`, so every recorded page showed "Unable to verify account authority" | Set it (and the full e2e env: both origins trusted, configurable ports) |
| `cdn.tailwindcss.com` is unreachable from sandboxed recorders → unstyled app | Compile the identical Tailwind v3 + typography sheet locally and serve it via request routing |
| Playwright's `recordVideo` encodes VP8 at ~1 Mbps: UI text smears | Capture raw CDP screencast frames and encode H.264 ourselves (CRF 18) |
| UI text too small at 1920×1080 for phone viewers | Record at 133% browser zoom: layout is 1440×810 CSS px, frames stay 1920×1080 and crisp |
| Edge TTS / Google Chirp need network or credentials the sandbox lacks | Local Kokoro-82M voice (Apache-2.0), Chirp kept as an optional provider |
| One narration clip per scene: actions drift away from the words describing them | Sentence-timed "beats": actions start on the sentence that names them |

## Curriculum (12 episodes, ~110 minutes)

Each episode is self-contained (its sandbox is seeded off-camera), but Episodes 2–6 share one
running project — a recipe notebook — so the series reads as one continuous build.

### Level 1 — Foundations (beginner)

1. **Your first planner, start to finish** (~6 min). Create a project from the 2026 Planner
   preset, learn the three panels, drill Year → Quarter → Month → Day, see that 1,733 pages
   come from ten templates, export, and click through the real links in the exported PDF.
2. **Canvas essentials: designing a cover page** (~8 min). Blank project → a recipe-book
   cover. Drag-to-create (and why a click makes nothing), the sticky tool, handles, pivot and
   rotation, nudging, Ctrl-drag duplicate, text and fonts, fill/stroke/radius/opacity, dot
   pattern fills, align/distribute, zoom/pan/snap, undo/redo.
3. **Pages, templates & data binding: a recipe notebook** (~9 min). Nodes vs templates, adding
   and renaming pages, a second template, `{{title}}`, custom data fields and Insert Data
   Field, the Preview selector, and why a missing field renders blank instead of erroring.

### Level 2 — Building blocks (intermediate)

4. **Data grids: an index page and tables** (~9 min). One cell per child; `w`/`h` are one
   cell; current vs specific source; columns, gaps, display templates; cells are links; table
   styling with its two traps (cell border width is stored as 0 until typed, header-row toggle
   does nothing until a swatch is set); empty-cell borders.
5. **Links: making every page navigable** (~9 min). Logical links instead of page numbers;
   parent, sibling (and the cousin fallback across months), specific page, child by index,
   ancestor levels, external URLs; the resolve-or-disappear rule; verified by clicking through
   the exported PDF.
6. **Layers, stacking & fine styling** (~10 min). Layers panel, active layer, hide vs lock
   (hide removes from canvas, PDF and thumbnails alike), layer order beats Z-index, four ways
   to reach a buried element (click-cycle, Alt-click, right-click stack menu, Layers rows),
   per-side borders and the stroke-width gotcha, text overflow modes, SVG import and live SVG
   source editing, greyscale proofing.

### Level 3 — Advanced structures

7. **Real calendars: offsets, slicing & traversal** (~10 min). Why day 1 lands in the wrong
   column, static vs dynamic offset with `weekday_num` and a −1 adjustment for Monday-first
   weeks, February's single wraparound, empty-cell borders as a debugging aid, Final Data
   Subset windows, the slice-then-offset gotcha, Deep Traversal to grandchildren (Quarter
   View's three mini-months differ by one index), order of operations.
8. **References & referrer formulas** (~10 min). One page in two places, reference nodes
   (never printed, asymmetric deletion), building a week from seven references, grids that
   read through references, Go to Referrer, Go to Child's Referrer, and
   `{{child_referrer:Start:Count:Type:Field}}` from the worked example to the shipped
   `6-month_start_offset:-7` formula.
9. **Variants & export: one document, every device** (~8 min). Variants share one hierarchy,
   the New Variant dialog (device presets, Auto-Reflow, Scale Typography), unit conversion,
   greyscale proofing, Export PDF vs Export All Variants vs Export as template, presets,
   tabs and Save-JSON-on-close, and the JSON inspector as a one-undo-step escape hatch.
10. **The generator: building documents in code** (~12 min). The two-script model, templates
    and hierarchy in code, `createId`, calendar math for a dated planner, the sandboxed
    preview, apply modes, and scripts that travel with the project.

### Level 4 — Share & collaborate

11. **Gallery, accounts & cloud history** (~10 min). Browsing signed out (rows, forgiving
    search, filters as shareable URLs), project pages, Open in editor, download all variants,
    cloning old versions; sign-up, email verification, usernames; explicit cloud saves as
    immutable commits, restore as a purely local act, My Projects.
12. **Publishing, forks & merge requests** (~11 min). What publishing exposes, the wizard
    (description, tags that get found, preview pages), editing a listing without
    republishing, reviews and profiles, fork vs open, proposing (save to cloud first), the
    live diff, merging as an overlay of the fork's change set, and conflicts precisely.

Stretch (only if time allows): 13. *The editor on phones and tablets.*

## Production pipeline

```
episode storyboard (beats) ──► narrate ──► record ──► assemble ──► QA
   tutorial/episodes/*.js       Kokoro      Chromium     compositor    Whisper round trip,
                                sentences   screencast   + mix + mux   contact sheets,
                                + timing    + overlays   + captions    loudness, dead air
```

### Storyboards

An episode module exports `meta` (number, level, title, summary, learn bullets, docs links,
thumbnail beat), an optional `setup(ctx)` that seeds the sandbox off camera, and `beats`:

```js
{ chapter: 'Data binding',          // optional: opens a YouTube chapter + lower third
  say: 'Now the useful part. Instead of typing a title, I type a placeholder.',
  at: 1,                            // start actions on sentence 1 (default 0 = with the first word)
  do: async (page, ctx) => { … } }  // Playwright, through human-paced helpers
```

`say` is the caption text; `[shown](=spoken)` overrides pronunciation inline, and a shared
lexicon handles recurring words (e.g. reMarkable). A beat ends when both its narration and its
actions have finished, plus a short breath, so words and clicks stay together.

### Sandbox

Throwaway API + production bundle per run (scratch SQLite, empty `RESEND_API_KEY` and
`DATABASE_URL`, console mailer for verification links), the Tailwind sheet served locally,
Chromium from `/opt/pw-browsers` with a 133% default zoom profile. The app is warmed up before
capture so no recording shows a cold Vite or font load.

### Capture and overlays

CDP `Page.startScreencast` JPEG frames (q92) with wall-clock timestamps. Overlays live in the
page DOM, outside React's root, with `pointer-events: none`: an arrow cursor with click
ripples, keystroke chips, chapter lower thirds, title and end cards, spotlight callouts, and
stand-ins for browser UI that headless Chromium never paints (native `<select>` lists, prompt
dialogs, file pickers, the download bubble). A minimal pdf.js reader page shows exported PDFs
and their working links.

### Voice

Kokoro-82M (`af_heart`, the model's highest-rated voice) via `kokoro-onnx`, misaki G2P with
espeak fallback, one clip per sentence, cached by content hash. Natural delivery comes from:

- **Writing for the ear** (style guide below) — the largest factor by far.
- **Sentence-level synthesis** with variable pauses (≈0.3–0.45 s between sentences, longer at
  topic shifts) instead of one long clip.
- **Speed 0.94** — about 155 wpm once pauses are included.
- **Light post-processing**: high-pass, gentle compression, −16 LUFS loudness, a −60 dBFS room
  tone so silence is never digitally dead, and quiet mouse/keyboard foley under real actions.

Optional premium path: `TUTORIAL_TTS=chirp` (Google Chirp 3 HD) when credentials exist.

### Assembly

A Python compositor resamples the timestamped frames to constant 30 fps (and applies any
logged zooms), x264 CRF 18. Narration is laid at recorded sentence times. Outputs per episode
in `tutorial-videos/<id>/`: `<id>.mp4`, `.vtt`, `.srt`, `chapters.txt`, `transcript.md`,
`description.md`, `thumbnail.png`. Text deliverables are copied to `tutorial/published/<id>/`
and committed; videos are not committed (size) and are delivered separately.

### QA gates (every episode)

1. **Dry run**: actions only, fast, catches broken selectors before a real-time recording.
2. **Whisper round trip**: every sentence is transcribed; mismatches become lexicon entries
   or rewrites.
3. **Contact sheets**: frames at every beat midpoint are reviewed for wrong state, error
   banners, misplaced cursor, unreadable regions.
4. **Automated checks**: red `role=alert` text during capture fails the run; dead air > 2.5 s
   is reported; loudness and duration are logged.

## Narration style guide

The voice is synthetic; the script must not be. Rules every beat follows:

1. **Talk to one person.** "I", "we", "you", contractions. A colleague showing you their screen.
2. **Why before how**, one idea per beat; never stack more than three items in a sentence.
3. **Only narrate what is visible** (or about to be). The cursor moves when the words do.
4. **Short sentences, varied length.** Read it aloud; if you run out of breath, split it.
5. **No hype.** Banned: powerful, seamless, effortless, unlock, supercharge, dive in,
   game-changer, simply, just (as filler), awesome, amazing.
6. **Admit the sharp edges.** "This one trips people up." Honesty is what sounds human.
7. **Concrete over abstract.** "Banana Bread serves eight", not "a data value".
8. **Let results land.** A short pause after a key click before explaining what happened.
9. **Write for the ear**; captions carry the symbols. Say "title in double curly braces",
   caption `{{title}}`.
10. **UI labels verbatim**, as printed on screen.
11. **Short intros and outros** (≤ 20 s). No "don't forget to like and subscribe".

## Visual language

- Brand: PDF Architect blue `#2563eb`, the layered-square mark, Inter.
- Title card (≈4 s, under the opening line), chapter lower third (≈3 s), end card naming the
  next episode.
- Keystroke chips for every shortcut used; spotlight callouts for small panel fields; zooms
  only where text would otherwise be too small.

## Risks

- **Selector drift** while the app evolves: storyboards prefer roles, labels, titles and
  test ids; dry runs catch breakage cheaply.
- **Real-time recording cost**: an episode records at 1× speed; only dry runs are fast.
- **Synthetic voice ceiling**: Kokoro is among the most natural local voices but is still
  TTS. The provider seam allows a re-voice (re-record, since pacing follows audio length).
- **Gallery episodes need content**: seeded via the API from `gallery-samples/` in `setup`.
