# Tutorial videos

Narrated, screen-recorded tutorials of PDF Architect, produced entirely from code:
storyboards drive the real app in Chromium, a local voice reads the script, and ffmpeg
assembles the result. Series plan and style guide:
`docs/superpowers/specs/2026-10-21-tutorial-series-v2-design.md`.

```
episodes/NN-*.js ─► narrate.js ─► record.js ─► assemble.js
 (storyboard)       voice + QA    capture       video, captions, chapters,
                                                description, thumbnail, QA sheets
```

## One-time setup

```bash
npm ci --legacy-peer-deps                    # the app (repo root)
(cd tutorial && npm ci)                      # Tailwind, compiled for the recorder

python3 -m venv tutorial/build/venv
tutorial/build/venv/bin/pip install -r tutorial/requirements.txt
tutorial/build/venv/bin/pip install https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl

mkdir -p tutorial/build/models && cd tutorial/build/models
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
curl -L https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-small.en.tar.bz2 | tar xj
```

Also needed: `ffmpeg`/`ffprobe` on `PATH`, and a Chromium for Playwright (the recorder uses
`/opt/pw-browsers/chromium` when present, or set `TUTORIAL_CHROMIUM`).

Everything generated or downloaded lives in `tutorial/build/` (gitignored); rendered episodes
go to `tutorial-videos/<id>/` (gitignored); text deliverables and thumbnails are mirrored to
`tutorial/published/<id>/` (committed).

## Rendering an episode

```bash
E=tutorial/episodes/01-first-planner.js
node tutorial/record.js $E --dry          # fast selector check, no capture (--until N to stop early)
node tutorial/narrate.js $E               # voice, then a Whisper round trip of every sentence
node tutorial/record.js $E                # real-time capture (needs narration.json)
node tutorial/assemble.js $E              # mp4 + captions + chapters + description + thumbnail + QA sheets
```

Narration is cached per sentence, so editing a few lines only re-synthesizes those. Pacing
follows narration length, so any narration change needs a re-record.

## Storyboards

```js
export const meta = { id, number, level, title, summary, learn: [...], docs: [...], next, thumbnail };
export async function setup(ctx) { /* off camera: seed accounts, projects, starting page */ }
export const beats = [
    { chapter: 'Data binding',     // opens a chapter: lower third + YouTube chapter
      say: 'Instead of typing a title, I type a placeholder.',
      at: 1,                       // actions start on sentence 1 ('1.5s', 'end', 'before' also work)
      do: async (page, ctx) => { await ctx.click(page.getByText('Templates')); } },
];
```

- `say` is the caption text. `[shown](=spoken)` changes what the voice reads, e.g.
  `[{{title}}](=title in double curly braces)`; recurring fixes go in `LEXICON` in `lib/speech.js`.
- `ctx` (see `record.js`): `click`, `drag`, `type`, `paste`, `press`, `wheel`, `hover`,
  `pick` (native `<select>`), `pickColor`, `chooseFile`, `dialogs.arm`/`dialogs.replay`
  (prompt/confirm/alert), `download`, `openPdf`, `spotlight`, `zoom`, `titleCard`, `endCard`,
  `goto`, `state`.
- Follow the narration style guide in the spec. Talk to one person, why before how, no hype,
  admit the sharp edges.

## How it works

- **Sandbox** (`lib/servers.js`): scratch SQLite, empty `RESEND_API_KEY`/`DATABASE_URL`
  (verification links land in the API log), and a production bundle served by `vite preview`.
- **Browser** (`lib/browser.js`): a 133% default-zoom profile. The app lays out at 1440×810
  CSS px while frames stay 1920×1080. The Tailwind Play CDN is replaced by a locally compiled
  sheet. `/__tutorial/*` serves the PDF reader page and files.
- **Overlay** (`lib/overlay.js`): cursor, ripples, key chips, lower thirds, cards, spotlights,
  and stand-ins for native UI that headless Chromium never paints.
- **Capture** (`lib/screencast.js`): CDP screencast JPEGs with timestamps; `video/compose.py`
  resamples them to constant 30 fps and applies zooms.
- **Voice** (`voice/tts.py`): Kokoro-82M (`af_heart`), misaki G2P, one clip per sentence.
  `TUTORIAL_TTS=chirp` switches to Google Chirp 3 HD if gcloud credentials are available.
- **Mix** (`video/mix.py`): sentences at their recorded times, faint room tone, quiet click
  foley, then two-pass loudness normalization to −16 LUFS.
