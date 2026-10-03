---
title: Gallery Tags
summary: Comma-separated labels on a published project that power search, one-click filtering, and the project's category — the tag filter matches whole tags, ignoring case and a plural s.
aliases: tags, filtering, gallery tags
keywords: tags, gallery tags, filter, filtering, categories, search, exact match, plural, tag chip, url, q parameter, tag parameter, shareable filter
---

**Tags** are comma-separated labels (lowercased automatically, up to 10 per project, 30 characters each) attached when [publishing](/docs/reference/publish-and-unpublish), and changeable afterwards through **Edit listing** without republishing the project. Every tag renders as a clickable chip — up to three on a gallery card, all of them on the project page — and each chip is a filter: one click shows every project carrying that tag, written into the URL as `?tag=<name>`. Repeat it (`?tag=weekly&tag=a5`) and only projects carrying **every** listed tag remain. Search (`?q=`) is broader, matching **names, tags, and descriptions** together, so "planner" finds projects that never use the word in their title but tagged themselves with it.

The tag *filter* matches **whole tags**. It ignores case and a simple plural, so `Planners` and `planner` are one filter — but `plan` does not match `planner`. A tag has to be the whole word people actually look for (the device they own, the paper size they print, the year, the job to be done), not a fragment of it. Tags also decide the project's [category](/docs/reference/gallery-filters-and-sorting), so a clear, common tag puts a project in the row where people expect it. Because every filter lives in the URL, a filtered view is a shareable link that lands anyone on the same grid, signed out.

See [Search, filters, and shareable links](/docs/gallery/browsing-without-an-account#search-filters-and-shareable-links).
