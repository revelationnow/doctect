# Single-page gallery templates

Eleven one-page note templates, each published as its own gallery listing, each sized for three
devices: reMarkable Paper Pro (509 × 679 pt), 10.3″ e-ink (445 × 592 pt — reMarkable 2, Supernote
A5 X / Manta, Boox Note Air) and reMarkable Paper Pro Move (260 × 463 pt). Spec:
`docs/superpowers/specs/2026-10-20-single-page-templates-design.md`.

- `lib/page.ts` — devices, millimetre layout kit (`Page`), greyscale palette, row-size floors.
- `lib/project.ts` — turns a template into an `AppState` through the app's own
  `validateGeneratedProject` + `createGeneratedAppState`.
- `templates/NN-slug.ts` — one template each: listing (name, description, six tags) + `draw(page)`.
- Tests: `tests/unit/galleryTemplates/templates.test.ts` (bounds, margins, text overlap, row floors,
  greyscale, valid state, Note templates category, three formats).

## Build, preview, publish

1. Start a dev server for this checkout (any origin that serves the app).
2. Render — builds every project in a real browser and makes the gallery previews with the app's
   own thumbnail code; `--review` also writes full-size PNGs to check by eye:

       node scripts/gallery-templates/render.mjs https://localhost:4510 --review /some/dir

3. Publish locally (SQLite) to look the listings over in a local gallery:

       env -u DATABASE_URL SQLITE_PATH=$PWD/gallery-templates/out/local.db OWNER_EMAILS=<email> \
         node scripts/gallery-templates/publish.mjs --owner-email <email>

4. Publish to production — only with the owner's go-ahead. Needs `DATABASE_URL` and
   `OWNER_EMAILS` (the owner is exempt from the per-user listing limits):

       node --env-file=<path to .env> scripts/gallery-templates/publish.mjs --production --owner-email <email>

   `manifest.production.json` maps each slug to its project id: commit it after publishing so a
   later run updates the same listings. A re-run commits changed pages and republishes; an
   identical listing is left alone. Undo through the app (unpublish or delete in My Projects).
