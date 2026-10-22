# When changes collide

*Episode 17 · In depth · 03:12*

## Welcome

In episode twelve, I asked Sam to merge orange day titles into the meal planner. Sam hasn't yet, and has been busy too. This time: what happens when two people change the same thing.

## A conflict

Here's what Sam did meanwhile: roomier writing lines on the Day pages, saved and then published as a new version. I'll reload my request's page.

It says conflicted now. Sam's save didn't change my request. A request is checked when it's made, every time its page opens, and when the owner presses Merge. So one that was fine last week can be conflicted today.

The line under the title says it can't be merged as-is. The red Conflicts box says why: the Day template, in the default variant, was changed on both sides.

We didn't touch the same thing on the page: I colored the title, Sam spaced out the lines. But changes are compared a whole template at a time, so two different edits to the Day template collide. An edit to the Week page wouldn't have.

The page hierarchy is a single unit too, including what's typed into the pages. If we'd both added a page, that would collide as well.

## Why it won't merge

Here's why it can't merge. Merging doesn't copy my fork over Sam's project. It takes what I changed since forking, the Day template, and lays it over Sam's latest version. That would quietly undo the new lines.

So nothing is merged by guesswork. A conflicted request has no Merge button, not even for Sam, only Close. And the server checks again before any merge.

## Starting again

There's no button that fixes a conflict. As the page says, I fork the latest version and propose my changes again: that's the fork author's job. First, I'll close this request: it can't be merged as it stands.

Then I fork Sam's planner again. Fork copies the published version, so the new lines come with it. Had Sam only saved them, a new request would be conflicted the moment I made it.

In Templates, the Day template already has Sam's roomier lines. Now I make my change again, on top of Sam's: the title, orange.

Save to cloud first, because a request always proposes the latest save, never what's only in this tab. Then Propose changes to upstream. The note tells Sam it's the same change, redone on top of Sam's.

## A clean request

The new request is open: the same single change, and no conflicts. Render before and after shows Sam's current page, then the same page with my title.

When Sam merges, my change set is laid over Sam's latest version. I made it on top of that, so both survive: roomy lines, orange titles.

Sam merges it from the other side. One reload, and my request says merged.

So: requests are checked every time they open, conflicts are never merged by guesswork, and the fork author fixes them with a fresh fork. Next time: reaching elements buried under others.
