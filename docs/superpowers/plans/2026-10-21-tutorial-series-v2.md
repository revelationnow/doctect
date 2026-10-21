# Tutorial Series v2 — Implementation Plan

> Executed inline by the session controller: the pipeline is one evolving media harness and
> the review gates are perceptual (pacing, legibility, sync), so tasks run in order.

**Spec:** `docs/superpowers/specs/2026-10-21-tutorial-series-v2-design.md`

**Tech:** Playwright + CDP screencast, Kokoro-82M (`kokoro-onnx`, misaki), Whisper small.en
(`sherpa-onnx`) for QA, OpenCV compositor, ffmpeg (x264, AAC, loudnorm).

## Global constraints

- Recording servers are sealed: scratch SQLite, `RESEND_API_KEY=''`, `DATABASE_URL=''`.
- `tutorial-videos/`, `tutorial/.venv/`, `tutorial/.models/`, `tutorial/.cache/` gitignored.
- No storyboard edits the app's source; everything app-facing goes through its real UI.
- Narration follows the spec's style guide; every sentence passes the Whisper round trip.

---

### Task 1: Sandbox fixes
- [x] `servers.js`: `VITE_API_BASE`, both origins in `TRUSTED_ORIGINS`, configurable ports.
- [x] Local Tailwind build (`tutorial/styles/`), served by request routing.
- [x] Chromium from `/opt/pw-browsers/chromium`; 133% zoom profile verified (1440×810 CSS,
      1920×1080 frames, input mapping intact).

### Task 2: Narration engine
- [ ] `voice/tts.py` (Kokoro + misaki, trimmed, cached) and `voice/asr.py` (Whisper).
- [ ] `lib/speech.js`: sentence split, `[shown](=spoken)` overrides, lexicon, pause model.
- [ ] `narrate.js`: storyboard → `narration.json` (per-beat sentences, offsets, durations).
- [ ] `qa-voice.js`: Whisper round trip with a word-level diff report.

### Task 3: Capture engine
- [ ] `lib/browser.js`: zoom profile, CDN routing, PDF viewer route, dialog/download hooks.
- [ ] `lib/overlay.js`: cursor, ripple, key chips, lower thirds, cards, spotlight, stand-ins
      for native select lists / prompts / file pickers / downloads.
- [ ] `lib/human.js`: eased curved moves, clicks, drags, typing with jitter, wheel zoom.
- [ ] `lib/screencast.js`: JPEG frames + timestamps to disk, ack-driven.
- [ ] `record.js`: warm-up, setup, beat scheduler, alert watchdog, timeline, `--dry` mode.

### Task 4: Assembly
- [ ] `video/compose.py`: CFR 30 fps, eased zooms, pipe to ffmpeg x264.
- [ ] `video/mix.py`: narration at sentence times, room tone, foley, then loudnorm.
- [ ] `assemble.js`: mux, captions (VTT/SRT), chapters, transcript, description, thumbnail.
- [ ] `qa-frames.js`: contact sheets at beat midpoints.

### Task 5: Episodes (per episode: storyboard → dry run → narrate → record → assemble → QA)
- [ ] 01 First planner · [ ] 02 Canvas · [ ] 03 Templates & binding · [ ] 04 Grids
- [ ] 05 Links · [ ] 06 Layers & styling · [ ] 07 Calendars · [ ] 08 References
- [ ] 09 Variants & export · [ ] 10 Generator · [ ] 11 Gallery & cloud · [ ] 12 Publishing & MRs

### Task 6: Delivery
- [ ] `tutorial/README.md` (setup, model downloads, commands), retire v1 episodes.
- [ ] Commit text deliverables to `tutorial/published/`; push the branch.
- [ ] Hand the rendered videos to the requester; publish a private library page.
