---
title: My Projects
summary: The /projects page — every cloud project you own, an Open action that loads one's latest save into the editor in any browser, a 50 MB storage meter, and a transactional Delete that removes a project and all its versions at once.
aliases: project list, storage, my projects, projects page, open cloud project, cloud backup
keywords: my projects, projects, project list, open, open in editor, another browser, another computer, backup, linked tab, storage, 50mb, storage meter, delete, visibility, public, private, version count, quota, 25 projects, edit listing
---

**My projects** (in the account menu, or `/projects` directly) is the home for everything the cloud holds under your name — one row per cloud project, showing its name, a **public**/**private** badge (private is the default), its size, how many versions it holds, and when it was last updated. Projects you've only ever kept local never appear; the cloud has never heard of them. The bar on top is your **storage meter**: every account gets **50 MB**, the sum of all commits across all your projects, and it turns red as you approach the limit — a save past it is refused. There's a project-count ceiling too, 25 cloud projects per account.

**Open**, the first action on every row, loads the project's latest save (its **HEAD**) into the editor as a new tab — the way to pick a cloud project up in another browser or on another computer. That tab is linked to the cloud project exactly as if it had been saved from that browser: [Save to cloud](/docs/reference/cloud-save) adds the next version to the same project instead of creating a second one, and [Version history](/docs/reference/version-history-restore) lists all of its versions. If the browser already has a tab linked to the project, Open switches to that tab instead of opening a duplicate and leaves what's in it untouched, including local edits not yet saved to the cloud — if the cloud has moved on since, that tab's next save says so and offers **Reload cloud version**.

A **public** row carries one extra action: **Edit listing**, which opens the same dialog as the editor's **Edit gallery listing…** and changes the published description, tags, and preview pages without [republishing](/docs/reference/publish-and-unpublish) the project.

**Delete** asks once, naming the project and exactly what's at stake, then removes the project, every [commit](/docs/reference/commit) in its history, and its gallery page if it was published — all in one transactional step, with the storage freed immediately. There's deliberately no trash can or grace period, and deleting a cloud project never touches a copy still open in a browser tab.

See [My Projects](/docs/gallery/cloud-saves-and-history#my-projects).
