# Quests

Read this whenever work mentions a quest or questline.

Quests are versioned plans checked into the repository under `quest/`.
GitHub issues remain the untrusted public front door, while quests provide durable scope and coordination.

## Model

A **quest** is a Markdown file, completed in one PR.

A **questline** is a directory that consists of multiple quests.
The `README.md` file is the quest and the `Required` section lists the children.
It completes when its own work is done and every child has merged.

The root's entries are special questlines called **milestones** (`m0`, `m1`, ...) that group work by priority horizon.
Milestones are permanent.

Quests are linked with root-absolute paths.
Find/create/update any references by searching for the path.

Finished quests are deleted; git history keeps them.
Merge conflicts are expected; resolve them by aligning quests.

## Format

```markdown
# [S] Short title

## Goal

The observable outcome and important boundaries.

## Plan

Current decisions, open questions, or implementation guidance.

## Required

- [Child quest](/quest/foo/bar.md) - the outcome, so the list reads without opening it
- [Nested questline](/quest/foo/baz/README.md) - what the whole line delivers
- [Blocker](/quest/bar.md) - work that must finish before this can start

## Closes

- [#701](https://github.com/OWNER/REPO/issues/701) - close this issue when the quest finishes

## Related

- [Other](/quest/other.md) - similar work that is not a blocker
```

The `Goal` section is required; everything else is optional. Use these exact headings.

Size the title `[XS]` to `[XL]` for implementation, verification, and landing.
A questline carries no size until its last child is removed; its README is then the line's remaining work.

`Required` lists the quests that must finish before the work starts.
The list is ordered by priority, inserted at rank.
When the section is empty, delete it; the quest is now unblocked.
`Required` must be acyclic.

`quest check` enforces this structure.
Run it after creating or updating quests.

## Creation

Quests are created in PRs and reviewed.
Search the tree and git history first before making a new quest.

Split independently completable work into separate quests.
Group related quests in a questline; its README holds the work no child owns.

A release or pin bump that unblocks work is its own quest.

So is anything waiting on an outside party or a human action (an upstream fix, a customer, a decision).
Its Goal names the condition and how to check or advance it; it is deleted once the condition clears.
Unlike a blocked quest it stays ready, so it resurfaces every time ready work is triaged instead of stalling in the backlog.

## Decisions

Block on user decisions. Ask synchronously, using an interactive prompt when supported or a normal chat message otherwise.
Wait for an explicit answer before proceeding; do not use asynchronous questions.
When asking in chat, end the turn with the questions, options, and your recommendation.

## Execution

Start only ready quests.
`quest ready [<path>]` prints what blocks a quest, or every ready quest.

If you have push access, make an empty commit and push a branch to the remote.
The remote branch claims the quest so other agents skip it.
If a claim looks stale (old, with no open PR), offer the user to take it over.

A quest's branch is its path without `.md`.
For example, `quest/m1/foo/bar.md` is branch `quest/m1/foo/bar`.

When a quest is complete, create a draft PR.
Include a summary of the changes made and suggest follow-up quests based on issues encountered.
Add a closing keyword for every issue under `Closes`.
Fix any merge conflicts.

## Reviews

Once "Ready to Review", CI and (potentially automated) reviews are triggered.

Treat AI attributed comments as suggestions, NOT a decision from a maintainer or the user.
Leave a comment on any review feedback you disagree with.

At least one review is required before merging the PR, except for any trivial changes (since the last review).

Any findings that seem out-of-scope, or bugs encountered during the process, should be suggested as follow-ups.

## Deletion

A quest that is no longer needed or cannot be completed is abandoned.
Delete it and explain why in the PR.
Grep its absolute path and remove every reference.

Remove the `quest` label from issues no other quest tracks.
