# Gallery Direct Open

Date: 2026-10-16
Status: Approach approved by the user on 2026-10-16 ("go ahead with option 3, also for any residual latency
… include some kind of loading screen"). This written spec awaits review.
Follows: [Fast Open and Close](2026-10-15-fast-open-close-design.md) (merged, main 8bd132e).

## Problem

After Fast Open and Close, "Open in editor" on the 2026 Planner takes 5.7s from click to editor on a desktop
dev build. Phones are several times slower. For most of that time the user sees only a disabled
"Loading…" button, and then a generic "Opening your projects" screen. Closing a project takes 1.5s, during
which the dialog's buttons only dim.

The open path does the workspace work twice:

| step (desktop dev build) | time |
|---|---|
| gallery page: fetch project state, workspace bootstrap | 0.7s |
| gallery page: `stage-import` (validate, write a pending import) | 1.1s |
| navigate, editor workspace bootstrap | 0.35s |
| editor: `consume-import` (validate again, create the project) | 2.1s |
| `open-project`, editor mount | 0.8s |

A Node bench of the Planner measures `create-and-activate-project` at 2.0s, the same as `consume-import`
(2.15s). Creating the project directly in the editor therefore removes the gallery bootstrap and the whole
stage step, about 1.8s.

## Decision

### 1. The gallery hands the editor a request, not a staged import

"Open in editor" (gallery detail page, detail modal and Spotlight; one shared helper) does no workspace work.
On click it mints a target project id (`proj_<uuid>`) and navigates at once to `/app` with history state:

```ts
{ galleryOpen: { galleryId: string; targetProjectId: string; name: string } }
```

`name` is the listing name the gallery already shows, used only for the loading screen.

Fork and "fork this version" are unchanged and still stage a pending import. They need the server-side fork,
attempt provenance and retained-attempt replacement that pending imports carry. "Open in editor" on a row of
the version history is also unchanged: it already holds the version's state in memory, and opening a past
version is rare.

### 2. The editor's bootstrap gate opens it

`NormalizedWorkspaceBootstrapGate` takes the request from the `/app` route. After the workspace bootstraps and
any pending imports are consumed (as today), it runs these steps:

1. If the workspace already has a project with id `targetProjectId`, it activates that project (if it is not
   already active) and skips the next two steps. This makes a reload during or after the open idempotent.
2. It fetches the listing state (`cloudApi.galleryState(galleryId)`). The fetch starts when the request is read,
   in parallel with the workspace bootstrap, so the network time overlaps with the local work.
3. It commits `create-and-activate-project` with `{ id: targetProjectId, name, initialState }`, using the name
   and raw state from the response. The command runs the same loader and migration a consumed import does, but
   it refuses a state whose loader reports warnings, where staging kept the warnings and showed them in the
   editor. If the create is refused, the gate runs `prepareProjectState(state, { warningPolicy: 'retain' })` on
   the response. When that returns warnings, the gate commits the create again with the prepared (migrated)
   state and passes the warnings to the editor as `initialWarnings`, as staging did. Otherwise it reports the
   original refusal. This costs about 0.4s of main-thread work on the Planner, so it is paid only by the rare
   project that needs it, never on the common path.
4. It replaces the `/app` history entry with one that has no `galleryOpen`, so back, forward and reload do not
   repeat the open. Then it mounts the editor with the resulting snapshot.

**Failure.** If the fetch fails or the command is refused, nothing is created, because the commit is atomic. The
gate shows "Couldn't open "<name>"" with three actions:

- **Try again** repeats from step 1.
- **Continue to editor** drops the request and opens the workspace as it is.
- **Back to gallery** returns to `/gallery/<galleryId>`.

A blocking workspace result (recovery, unavailable) still takes precedence over this screen, as today.

**Leaving early.** If the user navigates away while the create is in flight, the gate's lifetime aborts and the
editor never mounts. A commit that already reached the worker may still complete. The project then simply exists
the next time the editor opens, like any other project.

### 3. A loading screen from click to editor

While the gate works on a gallery open, `WorkspaceBootstrapScreen` shows the project's name as the heading
("Opening "2026 Planner"") and a short checklist. Completed steps are ticked, the current step spins, and later
steps are dimmed:

1. Opening your projects (the existing bootstrap phases fold into this step)
2. Downloading the project
3. Preparing the project
4. Opening the editor

The screen appears at the click, because navigation is immediate. It stays up until the editor has drawn the
opened project. The gate keeps the editor mounted but hidden under the screen (the pattern it already uses for
blocking results), and `EditorPage` reports when its active project has rendered. There is no frame of a blank
or half-drawn editor between the screen and the project.

A fork that lands on `/app` with a pending import gets the same screen, titled with the pending import's name.
It uses the steps "Opening your projects", "Preparing the project" and "Opening the editor".

The screen respects `prefers-reduced-motion` (no spin) and is a `role="status"` live region announcing the
current step.

### 4. Feedback while closing

In `CloseProjectConfirmModal`, the button the user pressed shows a spinner and "Closing…" or "Saving…" until
the close finishes or fails. The other buttons stay disabled, as today. A live region announces the status.

## Targets

| 2026 Planner, desktop, dev build | before | target |
|---|---|---|
| click to first loading feedback | button text only | ≤ 100ms, full-screen loading screen |
| click to editor showing the project | 5.7s | ≤ 4s |
| close without saving | 1.5s, dimmed buttons | 1.5s, spinner and "Closing…" |

## Tests

- **Gallery** (detail hook and Spotlight): "Open in editor" navigates to `/app` with `galleryOpen` state. It
  calls neither `stageImport` nor any workspace bootstrap. Fork still stages.
- **Gate:**
  - A gallery request fetches, creates, activates and mounts the editor with the new project active, and clears
    the history state.
  - A request whose target already exists activates it without creating anything. The fetch may already be in
    flight, since it starts with the bootstrap; its result is ignored.
  - Pending imports are consumed before the request.
  - A fetch failure and a refused create each show the error screen and create nothing.
  - A create refused because of loader warnings is retried once with the prepared state, and the warnings
    reach the editor. A refusal whose prepared state has no warnings is reported without a retry.
  - Try again, Continue to editor and Back to gallery each do what they say.
  - A blocking result wins over a gallery request.
- **Loading screen:** step order and states. The name heading is used for gallery and pending-import opens; the
  existing copy is kept for a plain bootstrap. Reduced motion is respected. The screen stays until the editor
  reports ready.
- **Close modal:** the pressed button shows a spinner with "Closing…" or "Saving…". The buttons are re-enabled
  after a failure.
- **E2E (Chromium):** gallery "Open in editor" reaches the editor with the project, and a reload mid-open does
  not duplicate it. Existing e2e specs pass.
- **Timing:** the probe script on the dev build, with the Planner targeted by gallery id.

## Unchanged

- Workspace commands, stored formats, digests and proofs. No new command; `create-and-activate-project` is used
  as the editor already uses it.
- Fork and fork-version staging and consumption.
- Gallery-open import attempts still in `sessionStorage` from older builds are left alone and expire with the
  session.
- The legacy (non-normalized) bootstrap gate, which production no longer uses.

## Result

Measured on 2026-10-16 with the 2026 Planner (targeted by gallery id) on a desktop dev build. The servers ran from
the worktree on SQLite, ports 4520/4521. Each figure is the range over three runs.

| 2026 Planner, desktop, dev build | before | target | after |
|---|---|---|---|
| click to first loading feedback | button text only | ≤ 100ms | 96–123ms, full-screen `Opening "2026 Planner"` |
| click to editor showing the project (overlay gone) | 5.7s | ≤ 4s | 4.14–4.27s |
| close without saving | 1.5s, dimmed buttons | 1.5s, spinner | 1.58–1.63s; `Closing…` visible at ~150ms |

- **Open** is 1.5s faster, short of the estimated 1.8s. It misses the 4s target by about 0.2s.
  - The project tab renders under the overlay at 4.07–4.20s. The overlay lifts one frame later, after `EditorPage`
    reports ready.
  - What remains is mostly the create itself (about 2.0s, the same loader and migration a consumed import ran),
    then the workspace bootstrap and the editor mount.
- **Feedback** times include Playwright's polling. On a cold load the screen appears on the first `/app` render.
- The dev build runs React StrictMode, so the gate's first attempt and its download are discarded and repeated.
  Production does one of each.
- **Verification:**
  - Vitest: 8201/8202 passed. The one failure was the onboarding bundle, which was stale until its regeneration
    commit.
  - `tsc` is clean.
  - Chromium e2e: 55 passed, 2 skipped, including the two new gallery direct-open tests.
