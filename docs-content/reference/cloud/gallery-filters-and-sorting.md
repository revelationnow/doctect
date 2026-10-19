---
title: Gallery Filters and Sorting
summary: Category, size-or-device, rating and tag filters plus Trending, Newest, Top rated and Most downloaded sorts — all worked out by the gallery itself and written into a shareable URL.
aliases: categories, category, filters, sorting, sort, trending, top rated, device filter, page size filter
keywords: gallery, filter, category, categories, device, page size, a4, a5, letter, remarkable, kindle scribe, boox, supernote, rating, 4 stars, sort, trending, newest, top rated, most downloaded, best match, grid, list, url
---

The gallery's filter row sits under the search box on every gallery view. Each control writes a URL parameter, so any combination is a link you can share:

| Control | URL | Notes |
| --- | --- | --- |
| **Category** | `?category=planners` | Note templates, Planners, Trackers & habits, Journals & writing, Learning & study, Work & money, Home & hobbies, Games & play, or Other. |
| **Size or device** | `?format=a5` | The page size of the project's first page, per variant. A project with A4 and reMarkable editions is listed under both. Devices with identical screens share one entry. |
| **4+ stars** | `?rating=4` | Plain average of four stars or more. |
| **Tag** | `?tag=weekly` | Repeatable; see [Gallery Tags](/docs/reference/gallery-tags). |
| **Sort** | `?sort=trending` | `trending` (default), `recent` (Newest), `rating` (Top rated), `popular` (Most downloaded), and `relevance` (Best match, the default while searching). |
| **Grid / list** | `?view=list` | Same results, as cards or as a compact table. |

**Nobody files a project by hand.** The category comes from the project's tags and name; the size and page count come from its published templates and pages. Both are worked out by the gallery when a project is published or its listing edited, and existing projects were sorted the same way. Templates-style projects — lined, ruled or dot-grid paper, page backgrounds — land in **Note templates**. A project whose tags don't suggest any category lands in **Other** — adding a clear tag through **Edit listing** moves it.

**Trending** favours projects being opened and forked lately, with forks counting most, and lets activity fade as a project ages. **Top rated** weighs each average by how many reviews stand behind it, so a single five-star review can't outrank a hundred averaging 4.8; unrated projects come last. **Most downloaded** is the all-time total of downloads and forks. Downloads count once per visitor per day.

See [Search, filters, and shareable links](/docs/gallery/browsing-without-an-account#search-filters-and-shareable-links).
