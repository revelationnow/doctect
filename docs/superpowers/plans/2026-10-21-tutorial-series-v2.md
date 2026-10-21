# Tutorial Series v2 — Implementation Plan

> Executed inline by the session controller: the pipeline is one evolving media harness and
> the review gates are perceptual (pacing, legibility, sync), so tasks run in order.

**Spec:** `docs/superpowers/specs/2026-10-21-tutorial-series-v2-design.md`

**Tech:** Playwright + CDP screencast, Kokoro-82M (`kokoro-onnx`, misaki), Whisper small.en
(`sherpa-onnx`) for QA, OpenCV compositor, ffmpeg (x264, AAC, loudnorm).

## Global constraints

- Recording servers are sealed: scratch SQLite, `RESEND_API_KEY=''`, `DATABASE_URL=''`.
- `tutorial-videos/` and `tutorial/build/` (venv, models, caches, bundles) gitignored.
- No storyboard edits the app's source; everything app-facing goes through its real UI.
- Narration follows the spec's style guide; every sentence passes the Whisper round trip.

---

### Task 1: Sandbox fixes
- [x] `servers.js`: `VITE_API_BASE`, both origins in `TRUSTED_ORIGINS`, configurable ports.
- [x] Local Tailwind build (`tutorial/styles/`), served by request routing.
- [x] Chromium from `/opt/pw-browsers/chromium`; 133% zoom profile verified (1440×810 CSS,
      1920×1080 frames, input mapping intact).

### Task 2: Narration engine
- [x] `voice/tts.py` (Kokoro + misaki, trimmed, cached) and `voice/asr.py` (Whisper).
- [x] `lib/speech.js`: sentence split, `[shown](=spoken)` overrides, lexicon, pause model.
- [x] `narrate.js`: storyboard → `narration.json` (per-beat sentences, offsets, durations).
- [x] `qa-voice.js`: Whisper round trip with a word-level diff report.

### Task 3: Capture engine
- [x] `lib/browser.js`: zoom profile, CDN routing, PDF viewer route, dialog/download hooks.
- [x] `lib/overlay.js`: cursor, ripple, key chips, lower thirds, cards, spotlight, stand-ins
      for native select lists / prompts / file pickers / downloads.
- [x] `lib/human.js`: eased curved moves, clicks, drags, typing with jitter, wheel zoom.
- [x] `lib/screencast.js`: JPEG frames + timestamps to disk, ack-driven.
- [x] `record.js`: warm-up, setup, beat scheduler, alert watchdog, timeline, `--dry` mode.

### Task 4: Assembly
- [x] `video/compose.py`: CFR 30 fps, eased zooms, pipe to ffmpeg x264.
- [x] `video/mix.py`: narration at sentence times, room tone, foley, then loudnorm.
- [x] `assemble.js`: mux, captions (VTT/SRT), chapters, transcript, description, thumbnail.
- [x] `qa-frames.js`: contact sheets at beat midpoints.

### Task 5: Episodes (per episode: storyboard → dry run → narrate → record → assemble → QA)
- [x] 01 First planner · [x] 02 Canvas · [x] 03 Templates & binding · [x] 04 Grids
- [x] 05 Links · [x] 06 Layers & styling · [x] 07 Calendars · [x] 08 References
- [x] 09 Variants & export · [x] 10 Generator · [x] 11 Gallery & cloud · [x] 12 Publishing & MRs

### Task 6: Delivery
- [x] `tutorial/README.md` (setup, model downloads, commands), retire v1 episodes.
- [x] Commit text deliverables to `tutorial/published/`; push the branch.
- [x] Hand the rendered videos to the requester; publish a private library page.

## Notes from production

- **Episodes run from about 2 to 6 minutes** (12 in all). Each starts from the project the previous one left
  behind (`teardown` → `tutorial/fixtures/`), so the recipe notebook grows from episode 2 to 12.
- **Pacing check before every recording.** The dry timeline × 4 estimates each beat's action
  time; any beat whose actions outlast its narration got more (useful) narration, not a cut.
- **No backdrop blur in the studio.** Software compositing recomputed the blur behind every
  dialog each frame (~90 ms per mouse move instead of ~16 ms): the cursor crawled and capture
  dropped to a few frames a second. The overlay now switches it off (episodes 8–12; earlier
  episodes show the few dialogs they open at a lower frame rate).
- **App bugs found on camera and fixed in their own commits, with regression tests:** the
  second edit to a new template conflicting in storage; greyscale export leaving line strokes
  in colour; Add Level / a cleared data subset writing `undefined` and stopping local saves.
- **Found, not fixed (reported):** clearing a numeric field writes `NaN` and stops local
  saves; auto-width text is not re-measured after a font or size change; a zero-height line is
  invisible on the canvas; exported PDF files are named after the internal project id; Insert
  Data Field on a title-bound text box replaces the binding; the README's "H / Space" pan
  shortcut is out of date.
