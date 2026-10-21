---
title: Browsing the Gallery Without an Account
difficulty: beginner
time: 8 min
summary: Search, filters, and curated rows; open any public project in your editor, download every variant, or clone a past version — no sign-in needed.
keywords: gallery, browse, anonymous, search, tags, categories, filters, sort, trending, device, page size, open in editor, download, zip, version history, clone
prerequisites: getting-started/first-project-from-preset
---

Everything in this tutorial works signed out. That's worth saying up front, because the gallery looks like the kind of feature that would demand an account before letting you touch anything — and it doesn't. Browsing, searching, opening a community project in your own editor, downloading its PDFs, even cloning an old version of it: all of it is open to anyone who clicks **Gallery** in the top bar. The main things that genuinely need an account are forking and writing reviews, and this tutorial will point at them exactly once, near the end, so you know where the line sits.

Signing up is covered later in this track. For now, stay logged out on purpose — it makes the boundary obvious.

## The gallery in one look

Click **Gallery** in the header (it's there on the landing page, the docs, and this same top bar across the app), or go straight to `/gallery`. Two things sit at the top of every gallery view, and stay pinned there as you scroll:

- **A search box.**
- **A row of filter controls**: a **category** menu, a **size or device** menu, a **4+ stars** toggle, a **sort** menu, and a **grid / list** switch on the right.

![The gallery landing view, signed out: search and filter controls pinned at the top, the spotlight, and the curated rows of project cards](/docs-assets/gallery/gallery-home.png "No account, no prompt — the full gallery, with curated rows under the search and filter controls")

Below them, the landing view is a set of curated rows:

- **In the spotlight** — one project picked from the best rated, changing once a day, with its own **Open in editor** button.
- **Trending** — projects people are opening and forking right now. New projects get a fair shot here, and old favourites gradually make room.
- **New** — the most recently published.
- **One row per category** — Note templates, Planners, Trackers & habits, Journals & writing, Learning & study, Work & money, Home & hobbies, Games & play. The gallery works out each project's category by itself from its tags and name, so nobody has to file anything.

Each row holds up to eight cards, and its **See all →** link opens the full, pageable list behind it. At the bottom, **Browse all projects** opens everything, and a cloud of the most-used [**tag chips**](/docs/reference/gallery-tags) shows how many projects carry each tag.

Each card shows the project's preview image, name and author. Under those sit its page size or device and its page count ("A5 · 10.3″ e-ink · 120 pages"), a line of its description, and up to three of its tags. Once anyone has rated it, a star score appears too, plus small fork and download counts along the bottom. The tags on a card are themselves clickable: they filter the gallery rather than opening the project.

## Search, filters, and shareable links

Type into the search box, or touch any filter, and the curated rows give way to a single grid of results. Above the grid you'll see how many projects match and a removable chip for each filter in force. **Clear all** takes you back to the curated rows.

Search matches **names, tags, and descriptions**, and it's forgiving: words can come in any order, and a partial word counts, so "plan wee" finds a "Weekly Planner". The best matches come first — a project with your words in its name ranks above one that only mentions them in its description.

The filters narrow things down, and they combine:

| Control | What it does |
| --- | --- |
| **Category** | One of the categories from the landing rows, with a count of how many projects it holds. |
| **Size or device** | The page size the project was built for: A4, A5, US Letter, a reMarkable, a Kindle Scribe, a 10.3″ Boox or Supernote, and so on. Projects that ship several editions appear under each of them. Devices that share a screen size share one entry, because a file made for one fits all of them. |
| **4+ stars** | Only projects averaging four stars or more. |
| **Tags** | Click any tag chip — on a card, a project page, or the landing — to filter by it. Click a second one later and you get projects carrying **both**. |

The **sort** menu orders the results: **Trending** (the default), **Newest**, **Top rated**, **Most downloaded**, and **Best match** while you're searching. **Top rated** is fair to newcomers *and* resistant to flukes: a project with a single five-star review won't outrank one with a hundred reviews averaging 4.8. The **grid / list** switch shows the same results either as cards or as a compact table with category, size, rating, downloads, and dates side by side. Long result lists page with **Previous / Next**, and say which page you're on out of how many.

Here's the part worth noticing: everything you pick is written into the page's address. Type "notebook" and the URL becomes `/gallery?q=notebook`. Pick the A5 size and it's `/gallery?q=notebook&format=a5`. Click **See all →** on the Games row and it's `/gallery?category=games`. These compose — a search within a category, two tags, sorted by rating, pages deep — and the URL keeps up.

> [!TIP]
> Because filters live in the URL, a filtered view is a link like any other. Bookmark `/gallery?format=a5&tag=weekly`, or send it to someone, and they land on exactly the grid you were looking at — signed out, no setup. This is also why the browser back button behaves sensibly here: each filter, sort, or page change is a step it can retrace (typed searches update the address in place rather than piling up a history entry per keystroke).

If nothing matches, the gallery says so and offers a one-click button to drop each filter in turn, so you can see which one was too strict.

## A project page

Click any card and the project opens. Two things happen at once: the project's page appears as an **overlay** — a panel floating above the gallery, with the grid still dimly visible behind it — and the URL changes to that project's own address, `/gallery/` followed by its id. Press `kbd:Esc`, click the **×**, or click the dimmed background to drop back to the gallery exactly where you left it.

> [!NOTE]
> That URL in the address bar is the project's real, permanent address — copy it, bookmark it, share it. Anyone who opens it directly (or refreshes while the overlay is up) gets the same content as a full standalone page instead of an overlay, complete with the normal header. Same information either way; the overlay is just the gentler presentation when you're already mid-browse.

![The standalone project page: preview pages on the left, title, author, tags, and the action buttons on the right](/docs-assets/gallery/project-page.png "One public project — previews, description, stats, and every action an anonymous visitor can take")

A project page collects everything its owner chose to publish:

| On the page | What it is |
| --- | --- |
| **Preview pages** | Up to six page images the owner picked when publishing — a cover, a divider, an inside page. |
| **Title and author** | The author's name links to their public profile and their other published work. |
| **Rating and reviews** | The star average, count, and written reviews are visible to everyone — signed out included. Writing one is where "Sign in to review" appears. |
| **Description and tags** | The owner's pitch, plus clickable tags that jump back to a filtered gallery. |
| **Category, size, and page count** | The category and page sizes the gallery worked out from the project itself, each a link to everything else that shares it. |
| **Fork and download counts** | Small live tallies of how often this project has been forked and downloaded. |
| **Report** | A quiet link at the bottom of the actions. It asks for a reason and sends the project to the moderators — also available signed out. |

And then there's the column of action buttons — [**Open in editor**](/docs/reference/open-in-editor), [**Download all variants (.zip)**](/docs/reference/download-all-variants), **Version history** — which the next three sections take one at a time. Signed out, a fourth line reads "Sign in to fork"; that's the one locked door, and we'll get to it.

## Open in Editor — yours, instantly

**Open in editor** does exactly what it says: it loads the project's published version into your own editor as a new tab, sitting alongside whatever you already had open. No account, no confirmation, no waiting. From that moment it behaves like any project you built yourself — the same sidebar hierarchy, templates, and export buttons you used in [your first preset project](/docs/getting-started/first-project-from-preset), except the pages were designed by someone else.

The important word is *yours*. What lands in your editor is a **copy with no strings attached**: it lives in your browser like any local project, and it keeps **no link back to the original**. Edit every page, delete half the hierarchy, export PDFs — the published project never knows, and nothing you do can touch it. There is deliberately no "update from the original" or "send changes back" on a copy like this.

That last part is the difference between opening and [*forking*](/docs/reference/fork). A fork — the signed-in feature — creates a copy that **remembers where it came from**: it carries a "forked from" line, and it can propose its changes back to the original for the owner to review. Forking, and the merge requests it unlocks, get their own tutorials later in this track. If you just want the design, **Open in editor** is the whole story.

## Download all variants

Maybe you don't want to edit anything — you want the PDFs on your tablet. **Download all variants (.zip)** renders every [variant](/docs/editor/variants-svg-json-export) the project defines — device sizes, color schemes, whatever the owner set up — as **one PDF each**, named after the variant, and hands you a single zip file. The rendering happens right in your browser (the button reads "Generating…" while it works), so give a large planner a moment.

A project with just one variant still works — the zip simply holds one PDF. For something like a planner published in A4, A5, and e-ink editions, this is the fastest possible path from "found it in the gallery" to "on my device": one click, one zip, every edition.

Projects filed under **Note templates** — single pages meant to sit behind your handwriting — have one more button above it, **Download as template**. It opens the editor's [Export as template](/docs/reference/export-as-template) dialog on the published version: pick the variant, the pages and your e-ink devices, and you get one zip of templates sized for each device, with install notes. No account needed here either.

## Time-travel: public version history

The third button, **Version history**, opens a list of the project's published versions — newest first, the current one marked **HEAD** — each with the owner's own message describing what changed, and a timestamp.

![The Version history modal over the project page, listing two published versions with an Open in editor action on each](/docs-assets/gallery/version-history-clone.png "Every published version is one click from becoming a fresh local project")

Every row has its own **Open in editor**. Click one on an older version and that snapshot — not the current one — opens as a brand-new local project in your editor. It's the same no-strings copy as before: nothing you have open is touched or replaced, which is why there's no "are you sure?" step, and the cloned old version has no link back either. Grabbed the current version earlier and preferred how the cover looked two releases ago? Clone both and compare them side by side, tab against tab.

> [!NOTE]
> The history you see here is the list of versions the owner **published** — each entry is a deliberate release. The private saves an owner makes between publishes never appear; work in progress stays theirs until they choose to publish again.

## Where the line actually is

You've now used everything the gallery offers an anonymous visitor: curated rows, search that reads names, descriptions, and tags, filters by category, device, rating, and tag, shareable filtered URLs, overlay and standalone project pages, no-strings copies via **Open in editor**, zipped PDFs of every variant, and clones of any published version. The only things that asked you to sign in were the ones that *say* something to other people — rating, reviewing, forking, publishing your own work. Those are what the rest of this track is about, starting with creating an account and saving your first project to the cloud.
