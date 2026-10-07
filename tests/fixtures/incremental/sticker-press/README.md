# Trusted Sticker Press fixture inputs

Captured 2026-09-13 from read-only source worktree:
`/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/sticker-press-redesign/gallery-samples/21-sticker-press/`.

| Input | Bytes | SHA-256 |
| --- | ---: | --- |
| `templates.js` | 435865 | `ba0e0b6f9432375f42f887e89085b882f1e0d0bf6483db15f43f4e77d06f9c50` |
| `hierarchy.js` | 4752 | `7c47c3b419ae03767db0f79aaef38a8390f5c35e2a2434534855fb6ef2da3693` |

These are exact source bytes, not the older gallery scripts at the execution
worktree's base HEAD. `scripts/capture-incremental-inputs.mjs` verifies the
handoff. Only these pinned, trusted scripts may execute in the fixture helper;
no downloaded/user script execution is supported. Generated JSON is deliberately
not checked in. Generation uses a fixed provenance timestamp and deterministic IDs.

Artwork provenance is retained verbatim in `templates.js`, including all generated
SVG strings and the `creditsParagraphs` notices: 330 Lucide line icons (ISC;
Feather-derived icons under MIT, copyright Cole Bemis) and 170 Twemoji graphics
(CC-BY 4.0, Twitter, Inc and other contributors). Lucide strokes use the source's
six colours; Twemoji graphics retain original colours and geometry. Generated
credit pages retain the full notices and source/license links to lucide.dev,
github.com/jdecked/twemoji, and the license references. Artwork is not original
to this project. Do not remove notices or hand-edit generated artwork/navigation.
